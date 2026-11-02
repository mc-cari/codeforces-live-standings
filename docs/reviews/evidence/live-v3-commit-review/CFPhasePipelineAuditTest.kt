package org.icpclive.cds.plugins.codeforces

import kotlinx.coroutines.*
import kotlinx.coroutines.flow.*
import org.icpclive.cds.*
import org.icpclive.cds.adapters.autoFinalize
import org.icpclive.cds.api.*
import kotlin.test.*
import kotlin.time.Duration.Companion.milliseconds

class CFPhasePipelineAuditTest {
    private fun source() = object : FullReloadContestDataSource(20.milliseconds) {
        private val parser=CFContestInfo()
        private var step=0
        override suspend fun loadOnce(): ContestParseResult {
            val phases=listOf("CODING","PENDING_SYSTEM_TEST","SYSTEM_TEST","FINISHED")
            if(step==phases.size) awaitCancellation()
            val current=step++
            parser.updateStandings(standingsFixture(phase=phases[current]))
            val runs=parser.parseSubmissions(listOf(submissionFixture(1,if(current<2) "OK" else "WRONG_ANSWER",600)))
            return ContestParseResult(parser.toApi(),runs,emptyList())
        }
    }
    @Test fun ordinaryReloadingStillReceivesSystemTestRejudging(): Unit = runBlocking {
        val update=withTimeout(5000) {
            source().getFlow().filterIsInstance<RunUpdate>().first {
                (it.newInfo.result as? RunResult.IOI)?.wrongVerdict == Verdict.WrongAnswer
            }
        }
        assertEquals(0.0,(update.newInfo.result as RunResult.IOI).score.single())
        println("AUDIT ordinary reload: later WRONG_ANSWER received")
    }
    @Test fun autoFinalizationCanStopBeforeSystemTestRejudging(): Unit = runBlocking {
        val updates=withTimeout(5000) {source().getFlow().autoFinalize().toList()}
        val sawRejudge=updates.filterIsInstance<RunUpdate>().any {
            (it.newInfo.result as? RunResult.IOI)?.wrongVerdict == Verdict.WrongAnswer
        }
        val fixed=System.getenv("PHASE_MAPPING_FIXED")=="true"
        assertEquals(fixed,sawRejudge)
        assertIs<ContestStatus.FINALIZED>(updates.filterIsInstance<InfoUpdate>().last().newInfo.status)
        println("AUDIT autoFinalize: mappingFixed=$fixed rejudgeReceived=$sawRejudge")
    }
}
