package org.icpclive.cds.plugins.codeforces

import kotlinx.coroutines.*
import kotlinx.coroutines.flow.*
import kotlinx.serialization.json.encodeToJsonElement
import org.icpclive.cds.*
import org.icpclive.cds.adapters.autoFinalize
import org.icpclive.cds.api.*
import org.icpclive.cds.plugins.codeforces.api.data.*
import kotlin.test.*
import kotlin.time.Duration.Companion.minutes

class CFAdapterBoundaryAuditTest {
    @Test fun restoredFinishedSourceFinalizesBeforeEmittingSavedRuns(): Unit = runBlocking {
        val history=MemoryCFHistoryStore()
        assertNotNull(history.merge("standings",fixtureJson.encodeToJsonElement(standingsFixture(phase="FINISHED"))))
        assertNotNull(history.merge("submissions",fixtureJson.encodeToJsonElement(listOf(submissionFixture(1,"OK",600)))))
        val source=CFSettings(1) {asManager=false}.createSource(history=history)
        val updates=withTimeout(5000) {source.getFlow().autoFinalize().toList()}
        assertEquals(0,updates.filterIsInstance<RunUpdate>().size)
        assertIs<ContestStatus.FINALIZED>(updates.filterIsInstance<InfoUpdate>().last().newInfo.status)
        println("AUDIT new source: saved runs=1 delivered runs=0 when autoFinalize enabled")
    }
    @Test fun inferredGymPenaltyFallsBackAgainWhenNextRowsHaveNoEvidence() {
        val parser=CFContestInfo()
        val base=standingsFixture("ICPC").let {it.copy(contest=it.contest.copy(id=100001))}
        val problemResult=CFProblemResult(1.0,10,1,CFProblemResultType.FINAL,180)
        val row=CFRankListRow(submissionFixture(1,"OK",180).author,1,1.0,10,0,0,listOf(problemResult))
        parser.updateStandings(base.copy(rows=listOf(row)))
        assertEquals(7.minutes,parser.toApi().penaltyPerWrongAttempt)
        parser.updateStandings(base)
        assertEquals(20.minutes,parser.toApi().penaltyPerWrongAttempt)
        println("AUDIT penalty: observed 7 minutes resets to fallback 20 when next standings omit evidence")
    }
}
