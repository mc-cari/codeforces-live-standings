FROM eclipse-temurin:17-jdk AS build
WORKDIR /src
COPY vendor/live-v3 vendor/live-v3
COPY backend-live-v3/gradle backend-live-v3/gradle
COPY backend-live-v3/gradlew backend-live-v3/build.gradle.kts backend-live-v3/settings.gradle.kts backend-live-v3/gradle.properties backend-live-v3/
COPY backend-live-v3/src/main backend-live-v3/src/main
WORKDIR /src/backend-live-v3
RUN ./gradlew --no-daemon installDist -Plive.dev.embedFrontend=false

FROM eclipse-temurin:17-jre
RUN useradd --system --uid 10001 --home-dir /nonexistent live && mkdir /data && chown live:live /data
WORKDIR /app
COPY --from=build /src/backend-live-v3/build/install/live-v3-backend/ ./
COPY vendor/live-v3/LICENSE /app/licenses/live-v3-MIT.txt
USER live
ENV DATA_DIR=/data LISTEN_ADDR=:8080 METRICS_LISTEN_ADDR=127.0.0.1:9090
VOLUME ["/data"]
EXPOSE 8080 9090
ENTRYPOINT ["/app/bin/live-v3-backend"]
