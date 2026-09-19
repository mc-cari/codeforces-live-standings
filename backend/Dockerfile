FROM golang:1.25-bookworm AS build
WORKDIR /src
ARG TARGETOS
ARG TARGETARCH
COPY go.mod go.sum ./
RUN go mod download
COPY . .
RUN CGO_ENABLED=0 GOOS=${TARGETOS} GOARCH=${TARGETARCH} go build -trimpath -ldflags='-s -w' -o /out/live-backend .

FROM debian:bookworm-slim
RUN useradd --system --uid 10001 --home-dir /nonexistent --shell /usr/sbin/nologin live
RUN mkdir -p /data && chown live:live /data
COPY --from=build /out/live-backend /usr/local/bin/live-backend
USER live
VOLUME ["/data"]
EXPOSE 8080
ENV DATA_DIR=/data LISTEN_ADDR=:8080
ENTRYPOINT ["/usr/local/bin/live-backend"]
