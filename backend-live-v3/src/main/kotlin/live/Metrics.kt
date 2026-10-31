package live

import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.atomic.AtomicLong

/** Bounded Prometheus labels; no handles, URLs, contest IDs, or credentials. */
class Metrics {
    private val counters=ConcurrentHashMap<String,AtomicLong>()
    private val histograms=ConcurrentHashMap<String,Histogram>()
    private val limits=listOf(0.01,0.05,0.1,0.25,0.5,1.0,2.0,5.0,10.0,20.0,30.0,60.0,120.0,300.0)
    init {
        for(method in listOf("contest.status","contest.standings","contest.hacks")) {
            histograms["cf_codeforces_rate_limit_wait_duration_seconds|method=\"$method\""]=Histogram(limits)
            for(outcome in listOf("success","http_error","api_error","decode_error","transport_error","timeout","canceled")) {
                histograms["cf_codeforces_request_duration_seconds|method=\"$method\",outcome=\"$outcome\""]=Histogram(limits)
            }
        }
        for(mode in listOf("live","replay","demo")) histograms["cf_usage_loading_duration_seconds|mode=\"$mode\""]=Histogram(limits)
        increment("cf_codeforces_submission_responses_total","history=\"consistent\"",0)
        increment("cf_codeforces_submission_responses_total","history=\"missing_known\"",0)
        increment("cf_codeforces_submission_omissions_total","",0)
    }
    private class Histogram(val limits: List<Double>) {
        private val buckets=LongArray(limits.size)
        private var count=0L
        private var sum=0.0
        @Synchronized fun observe(value: Double) {count++;sum+=value;limits.forEachIndexed {i,limit->if(value<=limit)buckets[i]++}}
        @Synchronized fun render(name: String,labels: String): String = buildString {
            limits.forEachIndexed {i,limit->append("${name}_bucket{$labels,le=\"$limit\"} ${buckets[i]}\n")}
            append("${name}_bucket{$labels,le=\"+Inf\"} $count\n${name}_count{$labels} $count\n${name}_sum{$labels} $sum\n")
        }
    }
    fun increment(name: String,labels: String,amount: Long=1) {counters.computeIfAbsent("$name{$labels}") {AtomicLong()}.addAndGet(amount)}
    private fun observe(name: String,labels: String,value: Double) {histograms.computeIfAbsent("$name|$labels") {Histogram(limits)}.observe(value)}
    fun request(method: String,outcome: String,duration: Double,wait: Double) {
        val bounded=method.takeIf {it in setOf("contest.status","contest.standings","contest.hacks")} ?: "other"
        val result=outcome.takeIf {it in setOf("success","http_error","api_error","decode_error","transport_error","timeout","canceled")} ?: "other"
        observe("cf_codeforces_request_duration_seconds","method=\"$bounded\",outcome=\"$result\"",duration)
        observe("cf_codeforces_rate_limit_wait_duration_seconds","method=\"$bounded\"",wait)
    }
    fun history(missing: Int) {
        increment("cf_codeforces_submission_responses_total","history=\"${if(missing>0) "missing_known" else "consistent"}\"")
        increment("cf_codeforces_submission_omissions_total","",missing.toLong())
    }
    fun completed(route: String,method: String,status: Int,seconds: Double) {
        increment("cf_backend_requests_total","route=\"$route\",method=\"$method\",status=\"$status\"")
        if(route!="events")observe("cf_backend_request_duration_seconds","route=\"$route\",method=\"$method\"",seconds)
    }
    fun loading(mode: String,seconds: Double) {observe("cf_usage_loading_duration_seconds","mode=\"$mode\"",seconds)}
    fun render(): String = buildString {
        counters.toSortedMap().forEach {(key,value)->append("$key ${value.get()}\n")}
        histograms.toSortedMap().forEach {(key,value)->val (name,labels)=key.split('|',limit=2);append(value.render(name,labels))}
    }
}
