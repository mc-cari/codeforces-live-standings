package live

import com.sun.net.httpserver.HttpExchange
import com.sun.net.httpserver.HttpServer
import kotlinx.coroutines.*
import kotlinx.serialization.json.*
import java.net.InetSocketAddress
import java.net.URLDecoder
import java.nio.file.Path
import java.security.MessageDigest
import java.util.Base64
import java.util.concurrent.Executors
import java.util.concurrent.atomic.AtomicInteger
import java.util.concurrent.ConcurrentHashMap

class Api(private val manager: Manager, private val origins: List<String>, private val token: String = "", private val maxHandles: Int = 200, maxStreams: Int = 128) : AutoCloseable {
    private val executor=Executors.newCachedThreadPool()
    private val connections=AtomicInteger()
    private val streamSlots=java.util.concurrent.Semaphore(maxStreams.also { require(it>0) })
    private val ingesting=java.util.concurrent.Semaphore(1)
    private val servers=mutableListOf<HttpServer>()
    fun start(address: InetSocketAddress, metrics: Boolean = false): HttpServer {
        val server=HttpServer.create(address,128)
        server.executor=executor
        server.createContext("/") { exchange ->
            exchange.setAttribute("started",System.nanoTime())
            try {
                if(metrics) {
                    if(exchange.requestURI.path=="/metrics" && exchange.requestMethod=="GET") {
                        exchange.responseHeaders.set("Content-Type","text/plain; version=0.0.4")
                        send(exchange,200,metricsText())
                    } else send(exchange,404,"not found")
                } else route(exchange)
            } catch(e: java.io.IOException) { /* disconnected client */ }
              catch(e: Exception) {
                System.err.println("http request failed error=${e.javaClass.simpleName}")
                try { send(exchange,503,"service unavailable") } catch(_: Exception) { }
            } finally { exchange.close() }
        }
        server.start();servers.add(server);return server
    }
    private fun route(e: HttpExchange) {
        val origin=e.requestHeaders.getFirst("Origin")
        if(origin!=null && origins.any { pattern ->
                if('*' !in pattern) pattern==origin else {
                    val parts=pattern.split('*',limit=2);origin.startsWith(parts[0]) && origin.endsWith(parts[1]) && origin.length>=parts[0].length+parts[1].length
                }
            }) { e.responseHeaders.set("Access-Control-Allow-Origin",origin);e.responseHeaders.add("Vary","Origin") }
        if(e.requestMethod=="OPTIONS") {
            e.responseHeaders.set("Access-Control-Allow-Methods","GET,POST,OPTIONS")
            e.responseHeaders.set("Access-Control-Allow-Headers","Content-Type,Last-Event-ID")
            send(e,204,"");return
        }
        val path=e.requestURI.path
        when(path) {
            "/healthz" -> { respond(e,200,obj("status" to str("ok")));return }
            "/readyz" -> { respond(e,200,obj("status" to str("ready")));return }
            "/v1/telemetry" -> { telemetry(e);return }
        }
        val match=Regex("^/v1/contests/([^/]+)/(activate|events)$").matchEntire(path)
        if(match==null) { send(e,404,"not found");return }
        val id=match.groupValues[1].toIntOrNull()
        if(id==null || id<=0) {send(e,400,"invalid contest id");return}
        when {
            match.groupValues[2]=="activate" && e.requestMethod=="POST" -> {
                try {
                    val session=runBlocking { manager.activate(id) }
                    val view=checkNotNull(session.view())
                    respond(e,200,obj("state" to str(view.health),"contest" to view.snapshot.getValue("contest")))
                } catch(error: Exception) {
                    val message=error.message.orEmpty()
                    val status=when { "capacity" in message ->429; "Unsupported contest" in message ->409;else->502 }
                    respond(e,status,obj("comment" to str(if(status==502) "Unable to load contest" else message)))
                }
            }
            match.groupValues[2]=="events" && e.requestMethod=="GET" -> {
                val session=manager.get(id)
                if(session==null) {send(e,404,"contest is not activated");return}
                val handles=try { decodeHandles(e.requestURI.rawQuery) } catch(_: IllegalArgumentException) {send(e,400,"invalid handles");return}
                events(e,session,handles)
            }
            else -> send(e,404,"not found")
        }
    }
    fun decodeHandles(query: String?): Set<String> {
        val encoded=query.orEmpty().split('&').map { it.split('=',limit=2) }.firstOrNull { it[0]=="h" }?.getOrNull(1) ?: errorHandles()
        val decoded=String(Base64.getUrlDecoder().decode(URLDecoder.decode(encoded,Charsets.UTF_8)),Charsets.UTF_8)
        val handles=decoded.split(';').map(String::trim).filter(String::isNotEmpty).map(String::lowercase).toSet()
        require(handles.isNotEmpty() && handles.size<=maxHandles)
        return handles
    }
    private fun errorHandles(): Nothing = throw IllegalArgumentException("handles required")
    private fun events(e: HttpExchange, session: Session, handles: Set<String>) {
        if(!streamSlots.tryAcquire()) {
            e.responseHeaders.set("Retry-After","1")
            send(e,429,"event stream capacity reached")
            return
        }
        var subscription: kotlinx.coroutines.channels.Channel<View>?=null
        try {
            e.responseHeaders.set("Content-Type","text/event-stream")
            e.responseHeaders.set("Cache-Control","no-cache, no-transform")
            e.responseHeaders.set("X-Accel-Buffering","no")
            e.sendResponseHeaders(200,0)
            val channel=session.subscribe()
            subscription=channel
            connections.incrementAndGet()
            manager.metrics.completed("events","GET",200,0.0)
            runBlocking {
                val cursor=EventCursor()
                val output=e.responseBody.bufferedWriter(Charsets.UTF_8)
                while(isActive) {
                    val received=withTimeoutOrNull(15000) {channel.receiveCatching()}
                    if(received==null) {output.write(": heartbeat\n\n");output.flush();continue}
                    if(received.isClosed) break
                    val view=received.getOrThrow()
                    for(event in cursor.next(project(view,handles))) {
                        output.write("id: ${event.revision}\nevent: ${event.kind}\ndata: ${event.payload}\n\n")
                        output.flush()
                    }
                }
            }
        } finally {
            subscription?.let {session.unsubscribe(it);connections.decrementAndGet()}
            streamSlots.release()
        }
    }
    private fun telemetry(e: HttpExchange) {
        val auth=e.requestHeaders.getFirst("Authorization").orEmpty()
        if(token.isEmpty() || !MessageDigest.isEqual(auth.toByteArray(),"Bearer $token".toByteArray())) {send(e,401,"unauthorized");return}
        if(e.requestMethod!="POST") {send(e,405,"method not allowed");return}
        val bytes=e.requestBody.readNBytes(1025)
        val event=try { require(bytes.size<=1024);json.parseToJsonElement(bytes.toString(Charsets.UTF_8)).jsonObject } catch(_: Exception) {send(e,400,"invalid event");return}
        val id=event.text("id");val kind=event.text("kind");val mode=event.text("mode")
        val seconds=(event["seconds"] as? JsonPrimitive)?.doubleOrNull
        val valid=when(kind) {
            "page_view" -> mode in setOf("setup","live","replay","demo")
            "setup_completed" -> mode in setOf("live","replay")
            "view_displayed","loading_failed" -> mode in setOf("live","replay","demo")
            "countdown_view" -> mode=="live"
            else -> false
        }
        if(!valid || listOf("id","kind","mode").any { (event[it] as? JsonPrimitive)?.isString!=true } || !id.matches(Regex("^[a-zA-Z0-9_-]{16,64}$")) || event.keys.any {it !in setOf("id","kind","mode","seconds")} ||
            if(kind=="view_displayed") seconds==null || !seconds.isFinite() || seconds !in 0.0..86400.0 || (event["seconds"] as? JsonPrimitive)?.isString==true else event["seconds"]!=null && event["seconds"]!=JsonNull) {send(e,400,"invalid event");return}
        if(!ingesting.tryAcquire()) {e.responseHeaders.set("Retry-After","1");send(e,429,"telemetry busy");return}
        try {val inserted=manager.store.telemetry(id,kind,mode,seconds);if(inserted && kind=="view_displayed")manager.metrics.loading(mode,seconds!!);send(e,204,"")} finally {ingesting.release()}
    }
    private fun metricsText(): String = buildString {
        append("# TYPE cf_backend_sse_connections gauge\ncf_backend_sse_connections ${connections.get()}\n")
        append("# TYPE cf_backend_engine_info gauge\ncf_backend_engine_info{engine=\"live-v3\"} 1\n")
        val names=mapOf("page_view" to "page_views", "setup_completed" to "completed_setups", "view_displayed" to "displayed_views", "countdown_view" to "countdown_views", "loading_failed" to "loading_failures")
        val totals=manager.store.totals().associate {(kind,mode,value)->(kind to mode) to value}
        for((kind,name) in names) {
            val modes=when(kind) {"page_view"->listOf("setup","live","replay","demo");"setup_completed"->listOf("live","replay");"countdown_view"->listOf("live");else->listOf("live","replay","demo")}
            for(mode in modes) append("cf_usage_${name}_total{mode=\"$mode\"} ${totals[kind to mode] ?: 0.0}\n")
        }
        append(manager.metrics.render())
    }
    private fun respond(e: HttpExchange,status: Int,value: JsonObject) {e.responseHeaders.set("Content-Type","application/json");send(e,status,value.toString())}
    private fun send(e: HttpExchange,status: Int,body: String) {
        val route=when {e.requestURI.path.endsWith("activate")->"activate";e.requestURI.path.endsWith("events")->"events";e.requestURI.path=="/v1/telemetry"->"telemetry";e.requestURI.path=="/healthz"->"health";e.requestURI.path=="/readyz"->"ready";else->"other"}
        val method=e.requestMethod.takeIf {it in setOf("GET","POST","OPTIONS")} ?: "other"
        val started=e.getAttribute("started") as? Long ?: System.nanoTime()
        manager.metrics.completed(route,method,status,(System.nanoTime()-started)/1e9)
        val bytes=body.toByteArray()
        e.sendResponseHeaders(status,if(status==204) -1 else bytes.size.toLong())
        if(status!=204) e.responseBody.write(bytes)
    }
    override fun close() {servers.forEach {it.stop(0)};executor.shutdownNow()}
}
fun address(value: String): InetSocketAddress {
    val split=value.lastIndexOf(':');require(split>=0)
    return InetSocketAddress(value.take(split).ifBlank {"0.0.0.0"},value.drop(split+1).toInt())
}
fun main() {
    fun env(name: String,default: String) = System.getenv(name)?.takeIf {it.isNotBlank()} ?: default
    val store=Store(Path.of(env("DATA_DIR","/data"),"live-v3.sqlite"))
    val config=Config(apiBase=env("CF_API_BASE_URL","https://codeforces.com/api/"),pollMs=env("POLL_INTERVAL_MS","4200").toLong(),requestMs=env("CF_REQUEST_INTERVAL_MS","2100").toLong(),
        managerMode=env("CF_MANAGER_MODE","false").toBooleanStrict(),apiKey=env("CF_API_KEY",""),apiSecret=env("CF_API_SECRET",""))
    require(config.pollMs>0 && config.requestMs>=0)
    val manager=Manager(store,config)
    val api=Api(manager,env("ALLOWED_ORIGINS",env("ALLOWED_ORIGIN","")).split(',').map(String::trim).filter(String::isNotEmpty),env("TELEMETRY_TOKEN",""),maxStreams=env("MAX_SSE_CONNECTIONS","128").toInt())
    api.start(address(env("LISTEN_ADDR",":8080")))
    api.start(address(env("METRICS_LISTEN_ADDR","127.0.0.1:9090")),true)
    Runtime.getRuntime().addShutdownHook(Thread {api.close();manager.close();store.close()})
    println("live-v3 backend listening")
}
