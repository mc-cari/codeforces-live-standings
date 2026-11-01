package live

import kotlinx.serialization.json.*
import org.icpclive.cds.plugins.codeforces.CFHistoryStore
import java.nio.file.Files
import java.nio.file.Path
import java.sql.Connection
import java.sql.DriverManager

val json = Json { ignoreUnknownKeys = true; encodeDefaults = true }
fun JsonObject.text(key: String, default: String = "") = (get(key) as? JsonPrimitive)?.contentOrNull ?: default
fun JsonObject.number(key: String, default: Long = 0) = (get(key) as? JsonPrimitive)?.longOrNull ?: default
fun JsonObject.array(key: String) = get(key) as? JsonArray ?: JsonArray(emptyList())
fun obj(vararg fields: Pair<String, JsonElement?>): JsonObject = JsonObject(fields.filter { it.second != null }.associate { it.first to it.second!! })
fun str(value: String): JsonPrimitive = JsonPrimitive(value)
fun num(value: Number): JsonPrimitive = JsonPrimitive(value)

data class StoredContest(val id: Int, val revision: Long, val snapshot: JsonObject?, val finishedAt: Long?)

open class Store(path: Path) : AutoCloseable {
    private val db: Connection
    init {
        path.toAbsolutePath().parent?.let(Files::createDirectories)
        Class.forName("org.sqlite.JDBC")
        db = DriverManager.getConnection("jdbc:sqlite:${path.toAbsolutePath()}")
        db.createStatement().use { s ->
            listOf("PRAGMA journal_mode=WAL", "PRAGMA synchronous=FULL", "PRAGMA foreign_keys=ON", "PRAGMA busy_timeout=5000",
                "CREATE TABLE IF NOT EXISTS contests(id INTEGER PRIMARY KEY, revision INTEGER NOT NULL DEFAULT 0, snapshot TEXT, finished_at INTEGER, active INTEGER NOT NULL DEFAULT 1, deactivated_at INTEGER)",
                "CREATE TABLE IF NOT EXISTS raw_history(contest INTEGER NOT NULL REFERENCES contests(id) ON DELETE CASCADE, resource TEXT NOT NULL, id TEXT NOT NULL, payload TEXT NOT NULL, PRIMARY KEY(contest,resource,id))"
            ).forEach(s::execute)
            val columns=s.executeQuery("PRAGMA table_info(contests)").use {r -> buildSet {while(r.next())add(r.getString("name"))}}
            if("active" !in columns) s.execute("ALTER TABLE contests ADD COLUMN active INTEGER NOT NULL DEFAULT 1")
            if("deactivated_at" !in columns) {
                s.execute("ALTER TABLE contests ADD COLUMN deactivated_at INTEGER")
                db.prepareStatement("UPDATE contests SET deactivated_at=? WHERE active=0 AND snapshot IS NULL").use {it.setLong(1,System.currentTimeMillis());it.executeUpdate()}
            }
        }
    }
    @Synchronized fun ensure(id: Int) {
        db.prepareStatement("INSERT INTO contests(id) VALUES(?) ON CONFLICT(id) DO UPDATE SET active=1,deactivated_at=NULL").use { it.setInt(1,id); it.executeUpdate() }
    }
    @Synchronized fun deactivate(id: Int, now: Long = System.currentTimeMillis()) {
        db.prepareStatement("UPDATE contests SET active=0,deactivated_at=? WHERE id=?").use {it.setLong(1,now);it.setInt(2,id);it.executeUpdate()}
    }
    @Synchronized fun all(): List<StoredContest> = db.createStatement().use { s ->
        s.executeQuery("SELECT * FROM contests WHERE active=1 OR snapshot IS NOT NULL").use { rs -> buildList { while(rs.next()) {
            val finished = rs.getLong("finished_at").takeUnless { rs.wasNull() }
            add(StoredContest(rs.getInt("id"), rs.getLong("revision"), rs.getString("snapshot")?.let { json.parseToJsonElement(it).jsonObject }, finished))
        } } }
    }
    @Synchronized open fun publish(id: Int, snapshot: JsonObject, finishedAt: Long?): Long = transaction {
        val revision = db.prepareStatement("SELECT revision FROM contests WHERE id=?").use { it.setInt(1,id); it.executeQuery().use { rs -> check(rs.next()); rs.getLong(1)+1 } }
        val payload = JsonObject(snapshot + ("revision" to num(revision)))
        db.prepareStatement("UPDATE contests SET revision=?,snapshot=?,finished_at=?,active=? WHERE id=?").use {
            it.setLong(1,revision); it.setString(2,payload.toString()); if(finishedAt==null) it.setNull(3,java.sql.Types.INTEGER) else it.setLong(3,finishedAt);it.setInt(4,if(finishedAt==null) 1 else 0);it.setInt(5,id);check(it.executeUpdate()==1)
        }
        revision
    }
    @Synchronized fun history(id: Int, resource: String): JsonElement? {
        val rows = db.prepareStatement("SELECT payload FROM raw_history WHERE contest=? AND resource=? ORDER BY id").use {
            it.setInt(1,id);it.setString(2,resource);it.executeQuery().use { rs -> buildList { while(rs.next()) add(json.parseToJsonElement(rs.getString(1))) } }
        }
        return if(resource=="standings") rows.singleOrNull() else JsonArray(rows)
    }
    @Synchronized fun merge(id: Int, resource: String, payload: JsonElement): JsonElement = transaction {
        require(resource in setOf("standings","submissions","hacks"))
        val records = if(resource=="standings") listOf("-" to payload) else payload.jsonArray.map { it.jsonObject["id"]!!.jsonPrimitive.content to it }
        db.prepareStatement("INSERT INTO raw_history(contest,resource,id,payload) VALUES(?,?,?,?) ON CONFLICT(contest,resource,id) DO UPDATE SET payload=excluded.payload WHERE payload<>excluded.payload").use { s ->
            for((key,value) in records) {s.setInt(1,id);s.setString(2,resource);s.setString(3,key);s.setString(4,value.toString());s.addBatch()};s.executeBatch()
        }
        history(id,resource)!!
    }
    fun scoped(id: Int): CFHistoryStore = object : CFHistoryStore {
        override suspend fun read(resource: String): JsonElement? = history(id,resource)
        override suspend fun merge(resource: String, payload: JsonElement): JsonElement = this@Store.merge(id,resource,payload)
    }
    @Synchronized fun cleanup(cutoff: Long) {
        db.prepareStatement("DELETE FROM contests WHERE (finished_at IS NOT NULL AND finished_at < ?) OR (active=0 AND snapshot IS NULL AND deactivated_at < ?)").use {it.setLong(1,cutoff);it.setLong(2,cutoff);it.executeUpdate()}
    }
    private fun <T> transaction(block: () -> T): T {
        check(db.autoCommit);db.autoCommit=false
        try {val result=block();db.commit();return result} catch(t: Throwable) {db.rollback();throw t} finally {db.autoCommit=true}
    }
    @Synchronized override fun close() { db.close() }
}
