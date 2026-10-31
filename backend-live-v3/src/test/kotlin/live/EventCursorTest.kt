package live

import kotlinx.serialization.json.*
import org.junit.jupiter.api.Test
import kotlin.test.*

class EventCursorTest {
    @Test fun genericIncrementalClientDropsRetiredEntriesAndRecoversGaps() {
        val cursor=EventCursor()
        val client=mutableMapOf<Long,JsonElement>()
        fun snapshot(revision: Int,ids: IntRange,verdict: String="TESTING",health: String="live")=obj(
            "revision" to num(revision),"contest" to obj(),"standings" to obj("rows" to JsonArray(emptyList())),
            "submissions" to JsonArray(ids.map {obj("id" to num(it),"verdict" to str(verdict))}),"health" to obj("state" to str(health)))
        fun apply(value: JsonObject): List<FeedEvent> {
            val events=cursor.next(value)
            for(event in events)when(event.kind) {
                "snapshot"->{client.clear();event.payload.array("submissions").forEach {client[it.jsonObject.number("id")]=it}}
                "patch"->event.payload.array("submissionUpserts").forEach {client[it.jsonObject.number("id")]=it}
            }
            assertEquals(value.array("submissions").associateBy {it.jsonObject.number("id")},client)
            return events
        }
        assertEquals("snapshot",apply(snapshot(1,1..10000)).single().kind)
        assertEquals("patch",apply(snapshot(2,1..10000,"OK")).single().kind)
        assertEquals("snapshot",apply(snapshot(3,2..10001,"OK")).single().kind)
        assertFalse(1L in client)
        assertEquals("snapshot",apply(snapshot(5,2..10001,"OK")).single().kind)
        assertEquals("state",apply(snapshot(5,2..10001,"OK","stale")).single().kind)
    }
}
