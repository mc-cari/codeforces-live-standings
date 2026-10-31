@file:OptIn(org.icpclive.cds.api.InefficientContestInfoApi::class)
package live

import kotlinx.serialization.json.*
import org.icpclive.cds.api.*
import org.icpclive.cds.scoreboard.*

/** Projection only: all scores, penalties, ordering and ties come from live-v3. */
class Projection(private val state: ContestStateWithScoreboard) {
    private val info = checkNotNull(state.state.infoAfterEvent)
    private val raw = json.parseToJsonElement(info.customFields.getValue("codeforces.standings")).jsonObject
    private val runs = state.state.runsAfterEvent.values.toList()
    private val real = runs.mapNotNull { run -> run.customFields["codeforces.submission"]?.let { run to json.parseToJsonElement(it).jsonObject } }
    private val realByTeam = real.groupBy { it.first.teamId }
    private val hacksByTeam = runs.filter { it.id.value.startsWith("hack-attack-") }.groupBy { it.teamId }
    val contest: JsonObject get() = raw.getValue("contest").jsonObject
    fun snapshot(handles: Set<String>, revision: Long, health: String, submissionLimit: Int? = 10000): JsonObject {
        val teams = info.teamList.filter { it.id.value.lowercase() in handles }
        val view = info.copy(teamList = teams.map { it.copy(isOutOfContest = false) }, awardsSettings = emptyList())
        val rows = teams.associate { it.id to state.scoreboardRowAfter(it.id) }
        val ranking = getScoreboardCalculator(view, OptimismLevel.NORMAL).getRanking(rows)
        val ranks = ranking.order.zip(ranking.ranks).associate { it.first.value.lowercase() to it.second }
        val problems = raw.array("problems")
        val columns = info.scoreboardProblems.withIndex().associate { it.value.id.value to it.index }
        val displayed = ranking.order.map { id ->
            val team = info.teams.getValue(id)
            val row = rows.getValue(id)
            val participant = json.parseToJsonElement(team.customFields.getValue("codeforces.party")).jsonObject
            val participantRuns = realByTeam[id].orEmpty()
            val results = problems.map { problem ->
                val index = problem.jsonObject.text("index")
                val result = row.problemResults[columns.getValue(index)]
                val seconds = result.lastSubmitTime?.inWholeSeconds ?: 0L
                val points = when(result) { is ICPCProblemResult -> if(result.isSolved) 1.0 else 0.0; is IOIProblemResult -> result.score ?: 0.0 }
                val wrongs = when(result) {
                    is ICPCProblemResult -> result.wrongAttempts
                    is IOIProblemResult -> participantRuns.count { (run, submission) ->
                        run.problemId.value == index && (points <= 0 || run.time.inWholeSeconds <= seconds) &&
                            (run.result as? RunResult.IOI)?.wrongVerdict?.isAddingPenalty == true && submission.text("verdict") != "OK"
                    }
                }
                obj("points" to num(points), "penalty" to num(if(result is ICPCProblemResult && result.isSolved) seconds/60 + wrongs*20 else 0),
                    "rejectedAttemptCount" to num(wrongs), "type" to str("FINAL"), "bestSubmissionTimeSeconds" to num(seconds))
            }
            val hacks = hacksByTeam[id].orEmpty().mapNotNull { it.customFields["codeforces.hack"]?.let { raw -> json.parseToJsonElement(raw).jsonObject } }
            obj("party" to participant, "rank" to num(ranks.getValue(id.value.lowercase())), "points" to num(row.totalScore), "penalty" to num(row.penalty.inWholeMinutes),
                "successfulHackCount" to num(hacks.count { it.text("verdict")=="HACK_SUCCESSFUL" }), "unsuccessfulHackCount" to num(hacks.count { it.text("verdict")=="HACK_UNSUCCESSFUL" }),
                "problemResults" to JsonArray(results), "lastSubmissionTimeSeconds" to num(participantRuns.maxOfOrNull { it.first.time.inWholeSeconds } ?: 0))
        }
        val solved = mutableMapOf<String,MutableSet<String>>()
        val submissions = real.filter { it.first.teamId.value.lowercase() in handles }
            .sortedWith(compareBy({ it.first.time }, { it.second.number("id") })).map { (run, submission) ->
                val key = run.teamId.value.lowercase()
                val problemsSolved = solved.getOrPut(key) { mutableSetOf() }
                if(submission.text("verdict")=="OK") problemsSolved.add(run.problemId.value)
                val author = JsonObject(submission.getValue("author").jsonObject + ("rank" to num(ranks[key] ?: 0)))
                JsonObject(submission + mapOf("author" to author, "numberOfProblems" to num(problemsSolved.size)))
            }.asReversed().let { if(submissionLimit==null) it else it.take(submissionLimit) }
        return obj("revision" to num(revision), "contest" to contest,
            "standings" to obj("contest" to contest, "problems" to problems, "rows" to JsonArray(displayed)),
            "submissions" to JsonArray(submissions), "health" to obj("state" to str(health)))
    }
    fun allHandles(): Set<String> = info.teams.keys.map { it.value.lowercase() }.toSet()
}
