package org.icpclive.cds.plugins.codeforces

import kotlinx.coroutines.*
import kotlinx.coroutines.flow.*
import org.icpclive.cds.*
import org.icpclive.cds.adapters.autoFinalize
import org.icpclive.cds.api.*
import kotlin.test.*
import kotlin.time.Duration.Companion.milliseconds

class CFFinishedColdStartAuditTest {
    @Test fun originalReloadSourceEmitsFinishedContestRunsBeforeFinalization(): Unit = runBlocking {
        val parser=CFContestInfo()
        parser.updateStandings(standingsFixture(phase="FINISHED"))
        val result=ContestParseResult(parser.toApi(),parser.parseSubmissions(listOf(submissionFixture(1,"OK",600))),emptyList())
        val source=object: FullReloadContestDataSource(20.milliseconds) {
            override suspend fun loadOnce(): ContestParseResult = result
        }
        val updates=withTimeout(5000) {source.getFlow().autoFinalize().toList()}
        assertEquals(1,updates.filterIsInstance<RunUpdate>().size)
        assertIs<ContestStatus.FINALIZED>(updates.filterIsInstance<InfoUpdate>().last().newInfo.status)
        println("AUDIT original source: saved runs=1 delivered runs=1 when autoFinalize enabled")
    }
}
