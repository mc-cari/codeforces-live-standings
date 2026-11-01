package live

import com.sun.net.httpserver.HttpExchange
import com.sun.net.httpserver.HttpServer
import kotlinx.coroutines.*
import kotlinx.serialization.json.*
import java.net.InetSocketAddress
import java.net.URLDecoder
import java.nio.file.Path
import java.util.Base64
import java.util.concurrent.Executors

class Api(private val manager: Manager) : AutoCloseable {
    private val executor=Executors.newCachedThreadPool()
    private val servers=mutableListOf<HttpServer>()
    fun start(address: InetSocketAddress, metrics: Boolean = false): HttpServer {
        val server=HttpServer.create(address,128)
        server.executor=executor
        server.createContext("/") { exchange ->
            try {
                if(metrics && exchange.requestURI.path=="/metrics" && exchange.requestMethod=="GET") {
                    exchange.responseHeaders.set("Content-Type","text/plain; version=0.0.4")
                    send(exchange,200,manager.metrics.render())
                } else if(metrics) send(exchange,404,"not found") else route(exchange)
            } catch(_: java.io.IOException) {
            } catch(error: Exception) {
                System.err.println("engine request failed error=${error.javaClass.simpleName}")
                try {send(exchange,503,"engine unavailable")} catch(_: Exception) { }
            } finally {exchange.close()}
        }
        server.start();servers.add(server);return server
    }
    private fun route(e: HttpExchange) {
        if(e.requestURI.path=="/healthz" && e.requestMethod=="GET") {send(e,200,"ok");return}
        val match=Regex("^/internal/v1/contests/([^/]+)/(activate|view)$").matchEntire(e.requestURI.path)
        if(match==null) {send(e,404,"not found");return}
        val id=match.groupValues[1].toIntOrNull()
        if(id==null || id<=0) {send(e,400,"invalid contest id");return}
        when {
            match.groupValues[2]=="activate" && e.requestMethod=="POST" -> {
                try {
                    val session=runBlocking {manager.activate(id)}
                    val view=checkNotNull(session.view())
                    respond(e,obj("state" to str(view.health),"contest" to view.snapshot.getValue("contest")))
                } catch(error: Exception) {
                    val message=error.message.orEmpty()
                    send(e,when {"capacity" in message ->429;"Unsupported contest" in message ->409;else->502},"activation failed")
                }
            }
            match.groupValues[2]=="view" && e.requestMethod=="GET" -> {
                val session=manager.get(id)
                if(session==null) {send(e,404,"contest is not activated");return}
                val query=e.requestURI.rawQuery.orEmpty().split('&').associate {
                    val pair=it.split('=',limit=2)
                    pair[0] to URLDecoder.decode(pair.getOrElse(1) {""},Charsets.UTF_8)
                }
                val handles=try {
                    String(Base64.getUrlDecoder().decode(query["h"].orEmpty()),Charsets.UTF_8)
                        .split(';').map(String::trim).filter(String::isNotEmpty).map(String::lowercase).toSet()
                        .also {require(it.isNotEmpty() && it.size<=200)}
                } catch(_: IllegalArgumentException) {send(e,400,"invalid handles");return}
                val channel=session.subscribe()
                try {
                    val view=runBlocking {
                        withTimeoutOrNull(15000) {
                            var current=channel.receive()
                            while(current.revision.toString()==query["after"] && current.health==query["health"]) current=channel.receive()
                            current
                        }
                    }
                    if(view==null) send(e,204,"") else respond(e,project(view,handles))
                } finally {session.unsubscribe(channel)}
            }
            else -> send(e,404,"not found")
        }
    }
    private fun respond(e: HttpExchange,value: JsonObject) {
        e.responseHeaders.set("Content-Type","application/json")
        send(e,200,value.toString())
    }
    private fun send(e: HttpExchange,status: Int,body: String) {
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
    val api=Api(manager)
    try {
        api.start(address(env("LISTEN_ADDR","127.0.0.1:8091")))
        api.start(address(env("METRICS_LISTEN_ADDR","127.0.0.1:9091")),true)
    } catch (error: Throwable) {
        api.close()
        manager.close()
        store.close()
        throw error
    }
    Runtime.getRuntime().addShutdownHook(Thread {api.close();manager.close();store.close()})
    println("live-v3 internal engine listening")
}
