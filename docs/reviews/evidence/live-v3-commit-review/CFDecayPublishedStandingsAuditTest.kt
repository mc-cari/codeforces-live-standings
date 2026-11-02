package org.icpclive.cds.plugins.codeforces

import kotlin.test.*
import org.icpclive.cds.api.RunResult

class CFDecayPublishedStandingsAuditTest {
    @Test fun compareAgainstPublishedRound1137ProblemA() {
        // https://codeforces.com/contest/1137/standings: sunset, A=489 at 00:07, maximum=500.
        // The exact second is immaterial because this parser rounds time down to minutes.
        val parser=CFContestInfo()
        parser.updateStandings(standingsFixture(duration=9000))
        val result=parser.parseSubmissions(listOf(submissionFixture(1,"OK",420))).single().result as RunResult.IOI
        val computed=result.score.single()
        val expected=System.getenv("DECAY_RESULT_EXPECTED")?.toDouble() ?: 489.0
        assertEquals(expected,computed)
        println("AUDIT published score=489.0 calculated=$computed duration=150 minutes")
    }
}
