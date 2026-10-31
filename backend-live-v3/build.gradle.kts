plugins {
    kotlin("jvm") version "2.4.21"
    kotlin("plugin.serialization") version "2.4.21"
    application
}
repositories { mavenCentral() }
kotlin { jvmToolchain(17) }
kotlin.compilerOptions.optIn.add("kotlin.time.ExperimentalTime")
application { mainClass.set("live.MainKt") }
dependencies {
    implementation("com.github.icpc.live-v3:org.icpclive.cds.core:pinned")
    implementation("com.github.icpc.live-v3:org.icpclive.cds.codeforces:pinned")
    implementation("org.jetbrains.kotlinx:kotlinx-serialization-json:1.12.0")
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-core:1.11.0")
    implementation("org.xerial:sqlite-jdbc:3.51.1.0")
    runtimeOnly("org.slf4j:slf4j-simple:2.0.20")
    testImplementation(kotlin("test-junit5"))
    testRuntimeOnly("org.junit.platform:junit-platform-launcher")
}
tasks.test { useJUnitPlatform(); systemProperty("sun.net.http.allowRestrictedHeaders", "true") }
