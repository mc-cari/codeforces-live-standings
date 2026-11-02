package org.icpclive.cds.plugins.codeforces

import org.icpclive.cds.api.RunResult
import kotlinx.serialization.SerializationException
import kotlin.test.*

class CFExistingBehaviorAuditTest {
    private val patched=System.getenv("AUDIT_PATCHED")=="true"
    private fun parser()=CFContestInfo().also {it.updateStandings(standingsFixture())}
    @Test fun omissionChangesScoreOnlyWithOriginalParser() {
        val parser=parser()
        val wrong=submissionFixture(101,"WRONG_ANSWER",300)
        val accepted=submissionFixture(102,"OK",600)
        val first=parser.parseSubmissions(listOf(accepted,wrong)).single {it.id.value=="102"}.result as RunResult.IOI
        val second=parser.parseSubmissions(listOf(accepted)).single {it.id.value=="102"}.result as RunResult.IOI
        assertEquals(430.0,first.score.single())
        assertEquals(if(patched)430.0 else 480.0,second.score.single())
        println("AUDIT omission patched=$patched score=${second.score.single()}")
    }
    @Test fun invalidatedSubmissionsHaveDifferentScores() {
        for(verdict in listOf("SKIPPED","CHALLENGED")) {
            val result=parser().parseSubmissions(listOf(submissionFixture(1,verdict,600))).single().result as RunResult.IOI
            assertEquals(if(patched)0.0 else 480.0,result.score.single())
            println("AUDIT verdict=$verdict patched=$patched score=${result.score.single()}")
        }
    }
    @Test fun missingSubmissionProblemPoints() {
        val accepted=submissionFixture(1,"OK",600)
        val value=accepted.copy(problem=accepted.problem.copy(points=null))
        if(patched) {
            val result=parser().parseSubmissions(listOf(value)).single().result as RunResult.IOI
            assertEquals(480.0,result.score.single())
        } else assertFailsWith<NullPointerException> {parser().parseSubmissions(listOf(value))}
        println("AUDIT missing points patched=$patched result=${if(patched)"480" else "NullPointerException"}")
    }
    @Test fun queuedVerdictDecoding() {
        if(patched) assertIs<RunResult.InProgress>(parser().parseSubmissions(listOf(submissionFixture(1,"SUBMITTED",100))).single().result)
        else assertFailsWith<SerializationException> {submissionFixture(1,"SUBMITTED",100)}
        println("AUDIT SUBMITTED patched=$patched result=${if(patched)"InProgress" else "SerializationException"}")
    }
}
