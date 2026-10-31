package live

import kotlinx.serialization.json.*

data class FeedEvent(val kind: String, val revision: Long, val payload: JsonObject)

/** A patch can upsert entries, but a skipped revision or retired entry requires replacement. */
class EventCursor {
    private var previous: JsonObject? = null
    fun next(snapshot: JsonObject): List<FeedEvent> {
        val prior=previous
        val revision=snapshot.number("revision")
        val oldRevision=prior?.number("revision") ?: -1L
        val currentIds=snapshot.array("submissions").map {it.jsonObject.number("id")}.toSet()
        val removed=prior?.array("submissions")?.any {it.jsonObject.number("id") !in currentIds} ?: false
        val health=snapshot.getValue("health").jsonObject.text("state")
        val oldHealth=prior?.get("health")?.jsonObject?.text("state")
        val events=buildList {
            if(prior==null || removed || revision!=oldRevision && revision!=oldRevision+1) {
                add(FeedEvent("snapshot",revision,snapshot))
            } else if(revision>oldRevision) {
                val old=prior.array("submissions").associateBy {it.jsonObject.number("id")}
                val upserts=snapshot.array("submissions").filter {old[it.jsonObject.number("id")]!=it}
                add(FeedEvent("patch",revision,obj("revision" to num(revision),"contest" to snapshot.getValue("contest"),"standings" to snapshot.getValue("standings"),"submissionUpserts" to JsonArray(upserts),"health" to snapshot.getValue("health"))))
            }
            if(health!=oldHealth && health in setOf("stale","finished")) add(FeedEvent("state",revision,obj("state" to str(health),"contest" to snapshot.getValue("contest"))))
        }
        previous=snapshot
        return events
    }
}
