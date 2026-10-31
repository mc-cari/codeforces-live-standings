package live

import kotlinx.coroutines.*
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.flow.collect
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.serialization.json.*
import org.icpclive.cds.adapters.addComputedData
import org.icpclive.cds.api.*
import org.icpclive.cds.plugins.codeforces.*
import org.icpclive.cds.scoreboard.*
import org.icpclive.cds.settings.Credential
import java.util.concurrent.ConcurrentHashMap
import kotlin.time.Duration.Companion.milliseconds

class RequestGate(private val intervalMs: Long) {
    private val mutex = Mutex()
    private var next = 0L
    suspend fun acquire() = mutex.withLock {
        val now = System.nanoTime()/1000000
        if(next>now) delay(next-now)
        next = System.nanoTime()/1000000 + intervalMs
    }
}
data class Config(
    val apiBase: String = "https://codeforces.com/api/", val pollMs: Long = 4200,
    val requestMs: Long = 2100, val capacity: Int = 3, val retentionMs: Long = 7*86400000L,
    val managerMode: Boolean = false, val apiKey: String = "", val apiSecret: String = "",
    val freshConnections: Boolean = true,
) {
    init { require(!managerMode || (apiKey.isNotBlank() && apiSecret.isNotBlank())) { "Manager mode requires Codeforces credentials" } }
}
data class View(val snapshot: JsonObject, val projection: Projection?, val revision: Long, val health: String)

class Session(val id: Int, private val store: Store, private val config: Config, private val gate: RequestGate, private val metrics: Metrics, record: StoredContest? = null) {
    private val lock = Any()
    private val subscribers = mutableSetOf<Channel<View>>()
    private var finishedAt = record?.finishedAt
    private var finishedPolls = 0
    private var current: View? = record?.snapshot?.let { View(it, null, record.revision, if(finishedAt!=null) "finished" else "stale") }
    private var latest: ContestStateWithScoreboard? = null
    val ready = CompletableDeferred<Session>().also { if(current!=null) it.complete(this) }
    var job: Job? = null
    fun finished(): Boolean = synchronized(lock) { finishedAt!=null }
    fun expired(now: Long): Boolean = synchronized(lock) { finishedAt?.let { now-it >= config.retentionMs } ?: false }
    fun view(): View? = synchronized(lock) { current }
    fun subscribe(): Channel<View> = synchronized(lock) {
        Channel<View>(Channel.CONFLATED).also { channel -> subscribers.add(channel);current?.let { channel.trySend(it) } }
    }
    fun unsubscribe(channel: Channel<View>) = synchronized(lock) { subscribers.remove(channel);channel.close() }
    private fun offer(view: View) = synchronized(lock) { current=view;subscribers.forEach { it.trySend(view) }; Unit }
    private fun stale(): Boolean {
        val previous=view() ?: return false
        offer(previous.copy(health="stale"))
        return previous.health!="stale"
    }
    suspend fun run() {
        val settings = CFSettings(id) {
            asManager = config.managerMode
            apiKey = Credential("environment",config.apiKey)
            apiSecret = Credential("environment",config.apiSecret)
        }
        val source = settings.createSource(
            history = store.scoped(id), baseUrl=config.apiBase, includeUnofficial=true, individualsOnly=true,
            supportedTypes=setOf("CF","ICPC"), interval=config.pollMs.milliseconds,
            freshConnections=config.freshConnections, beforeRequest=gate::acquire,
            onReload = { restored ->
                val state=checkNotNull(latest)
                val projection=Projection(state)
                val pending=state.state.runsAfterEvent.values.any { it.result is RunResult.InProgress }
                val nextPolls=if(restored) finishedPolls else if(projection.contest.text("phase")=="FINISHED" && !pending) finishedPolls+1 else 0
                val nextFinished=if(nextPolls>=2) System.currentTimeMillis() else finishedAt
                val health=if(nextFinished!=null) "finished" else if(restored) "stale" else "live"
                val candidate=projection.snapshot(projection.allHandles(),0,health,submissionLimit=null)
                val revision=store.publish(id,candidate,nextFinished)
                synchronized(lock) { finishedAt=nextFinished;finishedPolls=nextPolls }
                val snapshot=JsonObject(candidate + ("revision" to num(revision)))
                offer(View(snapshot,projection,revision,health))
                ready.complete(this)
                if(nextFinished!=null) throw CancellationException("Contest finalized")
            },
            onRequest=metrics::request, onHistory=metrics::history,
            onFailure = { error ->
                val changed=stale()
                if(changed || !ready.isCompleted) System.err.println("contest reload failed contest=$id error=${error.javaClass.simpleName}")
                if(!ready.isCompleted) { if(view()!=null) ready.complete(this) else ready.completeExceptionally(error) }
            }
        )
        try {
            source.getFlow().addComputedData {
                autoFinalize=false
                submissionResultsAfterFreeze=true
                submissionsAfterEnd=false
            }.calculateScoreboard(OptimismLevel.NORMAL).collect { latest=it }
        } catch(e: CancellationException) { throw e }
          catch(e: Exception) { stale();if(!ready.isCompleted) ready.completeExceptionally(e);throw e }
    }
}

class Manager(val store: Store, private val config: Config) : AutoCloseable {
    val metrics=Metrics()
    private val scope=CoroutineScope(SupervisorJob()+Dispatchers.IO)
    private val gate=RequestGate(config.requestMs)
    private val sessions=ConcurrentHashMap<Int,Session>()
    private fun start(session: Session): Session {
        session.job=scope.launch { try { session.run() } catch(e: CancellationException) { throw e } catch(e: Exception) { System.err.println("contest worker stopped contest=${session.id} error=${e.javaClass.simpleName}") } }
        return session
    }
    init {
        cleanup()
        store.all().forEach { record -> sessions[record.id]=start(Session(record.id,store,config,gate,metrics,record)) }
        scope.launch { while(isActive) { delay(60000);cleanup() } }
    }
    private fun cleanup() {
        val now=System.currentTimeMillis()
        synchronized(sessions) { sessions.entries.removeIf { (_,s) -> if(s.expired(now)) {s.job?.cancel();true} else false };store.cleanup(now-config.retentionMs) }
    }
    suspend fun activate(id: Int): Session {
        val session=synchronized(sessions) {
            sessions[id] ?: run {
                check(sessions.values.count { !it.finished() } < config.capacity) { "active contest capacity reached" }
                store.ensure(id)
                start(Session(id,store,config,gate,metrics)).also { sessions[id]=it }
            }
        }
        try { return withTimeout(125000) { session.ready.await() } }
        catch(e: Exception) {
            // Failed initial activation can be retried; existing usable state remains available.
            if(session.view()==null) synchronized(sessions) { if(sessions[id]===session) {sessions.remove(id);session.job?.cancel();store.deactivate(id)} }
            throw e
        }
    }
    fun get(id: Int): Session? = sessions[id]
    override fun close() { runBlocking { scope.coroutineContext[Job]!!.cancelAndJoin() } }
}

/** Restored views can be filtered before the engine is rebuilt; scores are never recalculated. */
fun project(view: View, handles: Set<String>): JsonObject {
    view.projection?.let { return it.snapshot(handles,view.revision,view.health) }
    val source=view.snapshot
    val standings=source.getValue("standings").jsonObject
    fun selected(row: JsonObject, key: String): Boolean = row[key]?.jsonObject?.array("members")?.any { it.jsonObject.text("handle").lowercase() in handles } ?: false
    val rows=standings.array("rows").filter { selected(it.jsonObject,"party") }
    val ranks=mutableMapOf<String,Int>()
    var previousRank: Long?=null
    var rank=0
    val ranked=rows.mapIndexed { index, element ->
        val row=element.jsonObject;val savedRank=row.number("rank")
        if(savedRank!=previousRank) rank=index+1
        previousRank=savedRank
        row.getValue("party").jsonObject.array("members").forEach { ranks[it.jsonObject.text("handle").lowercase()]=rank }
        JsonObject(row + ("rank" to num(rank)))
    }
    val submissions=source.array("submissions").filter { selected(it.jsonObject,"author") }.take(10000).map { value ->
        val row=value.jsonObject;val author=row.getValue("author").jsonObject
        val handle=author.array("members").firstOrNull()?.jsonObject?.text("handle")?.lowercase()
        JsonObject(row + ("author" to JsonObject(author + ("rank" to num(ranks[handle] ?: 0)))))
    }
    return JsonObject(source + mapOf("standings" to JsonObject(standings + ("rows" to JsonArray(ranked))), "submissions" to JsonArray(submissions), "health" to obj("state" to str(view.health))))
}
