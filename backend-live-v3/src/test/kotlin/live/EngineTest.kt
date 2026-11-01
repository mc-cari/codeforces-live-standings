package live

import com.sun.net.httpserver.HttpServer
import kotlinx.coroutines.*
import kotlinx.serialization.json.*
import org.junit.jupiter.api.Test
import java.net.InetSocketAddress
import java.net.HttpURLConnection
import java.net.URI
import java.nio.file.Files
import java.nio.file.Path
import java.util.Base64
import java.util.concurrent.atomic.AtomicInteger
import kotlin.test.*

class Fixture : AutoCloseable {
    val server=HttpServer.create(InetSocketAddress("127.0.0.1",0),0)
    @Volatile var recorded: JsonObject?=null
    @Volatile var phase="CODING"
    @Volatile var type="CF"
    @Volatile var fail=false
    @Volatile var submissions=JsonArray(listOf(submission(101,"WRONG_ANSWER",300),submission(102,"OK",600)))
    val requests=AtomicInteger()
    val starts=java.util.Collections.synchronizedList(mutableListOf<Long>())
    val base get()="http://127.0.0.1:${server.address.port}/"
    init {server.createContext("/") { e ->
        requests.incrementAndGet();starts.add(System.nanoTime()/1000000)
        val value=when(e.requestURI.path.substringAfterLast('/')) {
            "contest.standings" -> standings()
            "contest.status" -> recorded?.get("submissions") ?: submissions
            else -> recorded?.get("hacks") ?: JsonArray(emptyList())
        }
        val bytes=if(fail) "upstream failure".toByteArray() else obj("status" to str("OK"),"result" to value).toString().toByteArray()
        e.sendResponseHeaders(if(fail) 503 else 200,bytes.size.toLong());e.responseBody.use {it.write(bytes)}
    };server.start()}
    fun standings(): JsonObject = recorded?.get("standings")?.jsonObject ?: json.parseToJsonElement("""{"contest":{"id":1,"name":"Fixture","type":"$type","phase":"$phase","frozen":false,"durationSeconds":7200,"startTimeSeconds":1700000000},"problems":[{"contestId":1,"index":"A","name":"A","type":"PROGRAMMING","points":500}],"rows":[]}""").jsonObject
    override fun close() {server.stop(0)}
    companion object {
        fun submission(id: Int, verdict: String, time: Int, handle: String="alice", participant: String="CONTESTANT"): JsonObject = json.parseToJsonElement(
            """{"id":$id,"contestId":1,"creationTimeSeconds":${1700000000L+time},"relativeTimeSeconds":$time,"problem":{"contestId":1,"index":"A","name":"A","type":"PROGRAMMING","points":500},"author":{"members":[{"handle":"$handle"}],"participantType":"$participant","ghost":false},"programmingLanguage":"GNU C++17","verdict":"$verdict","testset":"TESTS","passedTestCount":1,"timeConsumedMillis":12,"memoryConsumedBytes":1024}"""
        ).jsonObject
    }
}
class FailingPublishStore(path: Path) : Store(path) {
    @Volatile var failPublish=false
    val publishFailed=CompletableDeferred<Unit>()
    override fun publish(id: Int,snapshot: JsonObject,finishedAt: Long?): Long {
        if(failPublish) {publishFailed.complete(Unit);throw java.sql.SQLException("injected checkpoint failure")}
        return super.publish(id,snapshot,finishedAt)
    }
}
class EngineTest {
    private suspend fun await(test: () -> Boolean) {withTimeout(8000) {while(!test()) delay(10)}}
    private fun config(f: Fixture)=Config(apiBase=f.base,pollMs=20,requestMs=0)
    private fun ids(view: View)=view.snapshot.array("submissions").map {it.jsonObject.number("id")}.toSet()
    @Test fun historyOmissionsRecoveryLateSubscriberAndRestart(): Unit = runBlocking {
        Fixture().use { f ->
            val path=Files.createTempDirectory("live-v3-test").resolve("live-v3.sqlite")
            Store(path).use { store ->
                Manager(store,config(f)).use { manager ->
                    val session=manager.activate(1)
                    assertEquals(setOf(101L,102L),ids(session.view()!!))
                    f.submissions=JsonArray(listOf(Fixture.submission(102,"OK",600),Fixture.submission(103,"TESTING",700)))
                    await {ids(session.view()!!).contains(103L)}
                    val snapshot=project(session.view()!!,setOf("alice"))
                    assertEquals(430.0,snapshot.getValue("standings").jsonObject.array("rows").single().jsonObject.getValue("points").jsonPrimitive.double)
                    val subscriber=session.subscribe()
                    assertEquals(3,subscriber.receive().snapshot.array("submissions").size)
                    session.unsubscribe(subscriber)
                    f.submissions=JsonArray(emptyList())
                    val revision=session.view()!!.revision
                    await {session.view()!!.revision>revision}
                    assertEquals(3,ids(session.view()!!).size)
                    f.fail=true
                    await {session.view()!!.health=="stale"}
                }
            }
            // Restart while the upstream remains unavailable, then recover on a truncated response.
            Store(path).use { store -> Manager(store,config(f)).use { manager ->
                val session=manager.get(1)!!
                assertEquals(3,ids(session.view()!!).size)
                assertEquals("stale",session.view()!!.health)
                f.submissions=JsonArray(listOf(Fixture.submission(103,"OK",700)))
                f.fail=false
                await {session.view()?.health=="live" && session.view()?.snapshot?.array("submissions")?.any {it.jsonObject.number("id")==103L && it.jsonObject.text("verdict")=="OK"}==true}
                assertEquals(3,ids(session.view()!!).size)
            } }
        }
    }
    @Test fun unofficialFriendsAreRankedAndSlowSubscribersGetCompleteViews(): Unit = runBlocking {
        Fixture().use {f ->
            f.submissions=JsonArray(f.submissions+Fixture.submission(104,"OK",100,"Bob","OUT_OF_COMPETITION"))
            Store(Files.createTempDirectory("friends").resolve("db")).use {store ->Manager(store,config(f)).use {manager ->
                val session=manager.activate(1)
                val view=session.view()!!
                val both=project(view,setOf("alice","bob"))
                val rows=both.getValue("standings").jsonObject.array("rows")
                assertEquals("Bob",rows.first().jsonObject.getValue("party").jsonObject.array("members").first().jsonObject.text("handle"))
                assertEquals(1,rows.first().jsonObject.number("rank"))
                assertEquals(2,rows.last().jsonObject.number("rank"))
                assertEquals(1,project(view,setOf("alice")).getValue("standings").jsonObject.array("rows").single().jsonObject.number("rank"))
                val slow=session.subscribe()
                val rev=view.revision
                f.submissions=JsonArray(listOf(Fixture.submission(105,"WRONG_ANSWER",800)))
                await {session.view()!!.revision>=rev+3}
                val current=slow.receive()
                assertTrue(ids(current).containsAll(listOf(101L,102L,104L,105L)))
                session.unsubscribe(slow)
            }}
        }
    }
    @Test fun testingPhasesFinishOnlyAfterTwoCompleteFinalPolls(): Unit = runBlocking {
        Fixture().use {f -> Store(Files.createTempDirectory("phases").resolve("db")).use {store ->Manager(store,config(f)).use {manager ->
            val session=manager.activate(1)
            for(phase in listOf("PENDING_SYSTEM_TEST","SYSTEM_TEST")) {
                f.phase=phase
                await {session.view()!!.snapshot.getValue("contest").jsonObject.text("phase")==phase}
                assertFalse(session.finished())
            }
            f.phase="FINISHED"
            await {session.finished()}
            assertEquals("finished",session.view()!!.health)
            val count=f.requests.get();delay(100);assertEquals(count,f.requests.get())
        }}}
    }
    @Test fun concurrentActivationSharesWorkerAndGlobalPacing(): Unit = runBlocking {
        Fixture().use {f -> Store(Files.createTempDirectory("concurrency").resolve("db")).use {store ->Manager(store,config(f).copy(requestMs=25)).use {manager ->
            val sessions=(1..8).map {async {manager.activate(1)}}.awaitAll()
            assertTrue(sessions.all {it===sessions.first()})
            val gate=RequestGate(25)
            val starts=mutableListOf<Long>()
            (1..4).map {async {gate.acquire();starts.add(System.nanoTime()/1000000)}}.awaitAll()
            assertTrue(starts.zipWithNext().all {(a,b)->b-a>=24},starts.toString())
        }}}
    }
    @Test fun failedPersistenceNeverPublishesNewLiveState(): Unit = runBlocking {
        Fixture().use {f ->FailingPublishStore(Files.createTempDirectory("failure").resolve("db")).use {store ->
            Manager(store,config(f)).use {manager ->
                val session=manager.activate(1)
                val old=session.view()!!.revision
                store.failPublish=true
                f.submissions=JsonArray(listOf(Fixture.submission(104,"OK",800)))
                withTimeout(8000) {store.publishFailed.await()}
                await {store.history(1,"submissions")!!.jsonArray.any {it.jsonObject.number("id")==104L}}
                await {session.view()!!.health=="stale"}
                assertEquals(old,session.view()!!.revision)
                assertEquals(old,store.all().single().revision)
                assertFalse(ids(session.view()!!).contains(104L))
                store.failPublish=false
                await {session.view()!!.health=="live" && 104L in ids(session.view()!!)}
            }
        }}
    }
    @Test fun restoredActivationSurvivesCheckpointFailureAndRecovery(): Unit = runBlocking {
        Fixture().use {f ->
            val path=Files.createTempDirectory("restore-checkpoint").resolve("db")
            Store(path).use {store ->Manager(store,config(f)).use {it.activate(1)}}
            FailingPublishStore(path).use {store ->
                store.failPublish=true
                Manager(store,config(f)).use {manager ->
                    val session=withTimeout(1000) {manager.activate(1)}
                    assertEquals("stale",session.view()!!.health)
                    withTimeout(8000) {store.publishFailed.await()}
                    assertSame(session,withTimeout(1000) {manager.activate(1)})
                    store.failPublish=false
                    await {session.view()!!.health=="live"}
                    assertSame(session,manager.activate(1))
                }
            }
        }
    }
    @Test fun restoredFriendRanksPreserveEngineTiebreaks(): Unit = runBlocking {
        Fixture().use {f ->
            f.type="ICPC"
            val base=f.standings()
            val problemA=base.array("problems").single().jsonObject
            val problemB=JsonObject(problemA+mapOf("index" to str("B"),"name" to str("B")))
            fun accepted(id: Int,handle: String,time: Int,problem: JsonObject)=JsonObject(Fixture.submission(id,"OK",time,handle)+("problem" to problem))
            f.recorded=obj("standings" to JsonObject(base+("problems" to JsonArray(listOf(problemA,problemB)))),
                "submissions" to JsonArray(listOf(accepted(1,"alpha",60,problemA),accepted(2,"alpha",1740,problemB),accepted(3,"beta",900,problemA),accepted(4,"beta",900,problemB))),"hacks" to JsonArray(emptyList()))
            Store(Files.createTempDirectory("restored-ranks").resolve("db")).use {store ->Manager(store,config(f)).use {manager ->
                val view=manager.activate(1).view()!!
                val live=project(view,setOf("alpha","beta"))
                val rows=live.getValue("standings").jsonObject.array("rows")
                assertEquals(listOf("beta","alpha"),rows.map {it.jsonObject.getValue("party").jsonObject.array("members").single().jsonObject.text("handle")})
                assertTrue(rows.all {it.jsonObject.number("penalty")==30L})
                assertEquals(listOf(1L,2L),rows.map {it.jsonObject.number("rank")})
                assertEquals(live,project(view.copy(projection=null),setOf("alpha","beta")))
            }}
        }
    }
    @Test fun failedActivationsExpireWithoutDeletingRecentOrRetriedHistory() {
        Store(Files.createTempDirectory("inactive-history").resolve("db")).use {store ->
            val payload=JsonArray(listOf(Fixture.submission(1,"OK",100)))
            for(id in 1..3) {store.ensure(id);store.merge(id,"submissions",payload)}
            store.deactivate(1,1000);store.deactivate(2,3000);store.deactivate(3,1000)
            store.ensure(3)
            store.cleanup(2000)
            assertTrue(store.history(1,"submissions")!!.jsonArray.isEmpty())
            assertEquals(1,store.history(2,"submissions")!!.jsonArray.size)
            assertEquals(1,store.history(3,"submissions")!!.jsonArray.size)
        }
    }
    @Test fun eventStreamAdmissionReleasesSlotsOnDisconnect(): Unit = runBlocking {
        Fixture().use {f ->Store(Files.createTempDirectory("stream-limit").resolve("db")).use {store ->Manager(store,config(f)).use {manager ->Api(manager,emptyList(),maxStreams=1).use {api ->
            manager.activate(1)
            val server=api.start(InetSocketAddress("127.0.0.1",0))
            val base="http://127.0.0.1:${server.address.port}"
            val url=URI("$base/v1/contests/1/events?h=YWxpY2U")
            val client=java.net.http.HttpClient.newHttpClient()
            fun connect()=client.send(java.net.http.HttpRequest.newBuilder(url).build(),java.net.http.HttpResponse.BodyHandlers.ofInputStream())
            val first=connect()
            assertEquals(200,first.statusCode())
            val rejected=connect()
            assertEquals(429,rejected.statusCode());rejected.body().close()
            first.body().close()
            var accepted: java.net.http.HttpResponse<java.io.InputStream>?=null
            withTimeout(8000) {
                while(accepted==null) {
                    val response=connect()
                    if(response.statusCode()==200)accepted=response else {assertEquals(429,response.statusCode());response.body().close();delay(20)}
                }
            }
            accepted!!.body().close()
        }}}}
    }
    @Test fun educationalRoundUsesTenMinutePenaltyAndMatchingProblemBreakdown(): Unit = runBlocking {
        Fixture().use {f ->
            f.type="ICPC"
            f.submissions=JsonArray(listOf(Fixture.submission(1,"WRONG_ANSWER",60),Fixture.submission(2,"OK",180),Fixture.submission(3,"WRONG_ANSWER",200)))
            Store(Files.createTempDirectory("icpc").resolve("db")).use {store ->Manager(store,config(f)).use {manager ->
                val row=manager.activate(1).view()!!.snapshot.getValue("standings").jsonObject.array("rows").single().jsonObject
                assertEquals(1.0,row.getValue("points").jsonPrimitive.double)
                assertEquals(13,row.number("penalty"))
                assertEquals(13,row.array("problemResults").single().jsonObject.number("penalty"))
            }}
        }
    }
    @Test fun pendingFinalSubmissionsPreventCompletionAndFinishedStateRestores(): Unit = runBlocking {
        Fixture().use {f ->
            val path=Files.createTempDirectory("pending-final").resolve("db")
            f.phase="FINISHED";f.submissions=JsonArray(listOf(Fixture.submission(1,"TESTING",100)))
            Store(path).use {store ->Manager(store,config(f)).use {manager ->
                val session=manager.activate(1)
                val revision=session.view()!!.revision
                await {session.view()!!.revision>=revision+2}
                assertFalse(session.finished())
                f.submissions=JsonArray(listOf(Fixture.submission(1,"OK",100)))
                await {session.finished()}
            }}
            val count=f.requests.get()
            Store(path).use {store ->Manager(store,config(f)).use {manager ->
                val session=manager.activate(1)
                assertEquals("finished",session.view()!!.health)
                await {session.job!!.isCompleted}
                assertEquals(count,f.requests.get())
            }}
        }
    }
    @Test fun capacityAndExpiredRecordsAreEnforced(): Unit = runBlocking {
        Fixture().use {f ->Store(Files.createTempDirectory("capacity").resolve("db")).use {store ->
            Manager(store,config(f).copy(capacity=1)).use {manager ->
                manager.activate(1)
                val error=assertFailsWith<IllegalStateException> {manager.activate(2)}
                assertTrue("capacity" in error.message.orEmpty())
            }
            store.publish(1,obj("contest" to f.standings().getValue("contest"),"standings" to f.standings(),"submissions" to JsonArray(emptyList())),System.currentTimeMillis()-1000)
            Manager(store,config(f).copy(retentionMs=100)).use {manager ->
                assertNull(manager.get(1));assertTrue(store.all().isEmpty())
            }
        }}
    }
    @Test fun recordedOfficialStandingsAreTheScoreOracle(): Unit = runBlocking {
        Fixture().use {f ->
            val resource=checkNotNull(javaClass.getResourceAsStream("/codeforces/1797.json"))
            f.recorded=json.parseToJsonElement(resource.bufferedReader().use {it.readText()}).jsonObject
            Store(Files.createTempDirectory("recorded").resolve("db")).use {store ->Manager(store,config(f)).use {manager ->
                val session=manager.activate(1797)
                val actual=session.view()!!.snapshot.getValue("standings").jsonObject.array("rows").associateBy {it.jsonObject.getValue("party").jsonObject.array("members").first().jsonObject.text("handle").lowercase()}
                for(expected in f.standings().array("rows")) {
                    val row=expected.jsonObject
                    val handle=row.getValue("party").jsonObject.array("members").first().jsonObject.text("handle").lowercase()
                    val result=actual.getValue(handle).jsonObject
                    assertEquals(row.getValue("points"),result.getValue("points"),handle)
                    assertEquals(row.array("problemResults").map {it.jsonObject.getValue("points")},result.array("problemResults").map {it.jsonObject.getValue("points")},handle)
                }
            }}
        }
    }
    @Test fun representativeTenThousandSubmissionContest(): Unit = runBlocking {
        Fixture().use {f ->
            f.submissions=JsonArray((1..10001).map {Fixture.submission(it,"OK",it/2,"user$it")})
            Store(Files.createTempDirectory("scale").resolve("db")).use {store ->Manager(store,config(f).copy(pollMs=60000)).use {manager ->
                val start=System.nanoTime()
                val session=manager.activate(1)
                assertEquals(10001,session.view()!!.snapshot.array("submissions").size)
                val view=session.view()!!
                val global=project(view,(1..10001).map {"user$it"}.toSet())
                assertEquals(10000,global.array("submissions").size)
                assertFalse(global.array("submissions").any {it.jsonObject.number("id")==1L})
                assertEquals(project(view,setOf("user1")),project(view.copy(projection=null),setOf("user1")))
                assertEquals(1L,project(view.copy(projection=null),setOf("user1")).array("submissions").single().jsonObject.number("id"))
                val selected=project(session.view()!!,setOf("user9999","user1"))
                assertEquals(2,selected.array("submissions").size)
                println("10,001 submission initial reload and durable snapshot: ${(System.nanoTime()-start)/1000000}ms")
            }}
        }
    }
    @Test fun httpContractCorsTelemetryAndPrivateMetrics(): Unit = runBlocking {
        Fixture().use {f -> Store(Files.createTempDirectory("http").resolve("db")).use {store ->Manager(store,config(f)).use {manager ->Api(manager,listOf("https://preview-*.example.test"),"secret").use {api ->
            val server=api.start(InetSocketAddress("127.0.0.1",0))
            val metrics=api.start(InetSocketAddress("127.0.0.1",0),true)
            fun request(path: String,method: String="GET",body: String?=null,auth: Boolean=false,port: Int=server.address.port): Pair<Int,String> {
                val connection=URI("http://127.0.0.1:$port$path").toURL().openConnection() as HttpURLConnection
                connection.requestMethod=method;connection.connectTimeout=3000;connection.readTimeout=5000
                connection.setRequestProperty("Origin","https://preview-abc.example.test")
                if(auth)connection.setRequestProperty("Authorization","Bearer secret")
                if(body!=null) {connection.doOutput=true;connection.outputStream.use {it.write(body.toByteArray())}}
                val status=connection.responseCode
                val value=(if(status>=400)connection.errorStream else connection.inputStream)?.bufferedReader()?.use {it.readText()}.orEmpty()
                if(path=="/healthz") assertEquals("https://preview-abc.example.test",connection.getHeaderField("Access-Control-Allow-Origin"))
                connection.disconnect();return status to value
            }
            assertEquals(200,request("/healthz").first)
            assertEquals(404,request("/metrics").first)
            assertEquals(200,request("/metrics",port=metrics.address.port).first)
            assertEquals(200,request("/v1/contests/1/activate","POST").first)
            assertEquals(400,request("/v1/contests/1/events?h=%25%25%25").first)
            val encoded=Base64.getUrlEncoder().withoutPadding().encodeToString("ALICE;alice".toByteArray())
            assertEquals(setOf("alice"),api.decodeHandles("h=$encoded"))
            val payload="""{"id":"abcdefghijklmnop","kind":"page_view","mode":"live"}"""
            assertEquals(401,request("/v1/telemetry","POST",payload).first)
            repeat(2) {assertEquals(204,request("/v1/telemetry","POST",payload,true).first)}
            assertTrue("cf_usage_page_views_total{mode=\"live\"} 1.0" in request("/metrics",port=metrics.address.port).second)
        }}}}
    }
}
