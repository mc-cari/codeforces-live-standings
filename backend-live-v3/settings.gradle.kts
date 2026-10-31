rootProject.name = "live-v3-backend"
val engine = System.getenv("LIVE_V3_SOURCE") ?: file("../vendor/live-v3").absolutePath
includeBuild(engine) {
    dependencySubstitution {
        substitute(module("com.github.icpc.live-v3:org.icpclive.cds.core")).using(project(":cds:core"))
        substitute(module("com.github.icpc.live-v3:org.icpclive.cds.codeforces")).using(project(":cds:plugins:codeforces"))
    }
}
