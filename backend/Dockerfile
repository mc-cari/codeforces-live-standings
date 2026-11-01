FROM node:24-bookworm-slim AS admin-build
WORKDIR /admin
RUN npm install --global pnpm@11.14.0
COPY admin/package.json admin/pnpm-lock.yaml admin/pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile
COPY admin/ ./
RUN pnpm build

FROM golang:1.25-bookworm AS build
WORKDIR /src
ARG TARGETOS
ARG TARGETARCH
COPY backend/go.mod backend/go.sum ./
RUN go mod download
COPY backend/ .
RUN CGO_ENABLED=0 GOOS=${TARGETOS} GOARCH=${TARGETARCH} go build -trimpath -ldflags='-s -w' -o /out/live-backend .

FROM debian:bookworm-slim
RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates \
    && rm -rf /var/lib/apt/lists/* \
    && useradd --system --uid 10001 --home-dir /nonexistent --shell /usr/sbin/nologin live
RUN mkdir -p /data && chown live:live /data
COPY --from=build /out/live-backend /usr/local/bin/live-backend
COPY --from=admin-build /admin/dist /opt/admin
USER live
VOLUME ["/data"]
EXPOSE 8080 8081 9090
ENV DATA_DIR=/data LISTEN_ADDR=:8080 ADMIN_LISTEN_ADDR=:8081 ADMIN_ASSETS_DIR=/opt/admin
ENTRYPOINT ["/usr/local/bin/live-backend"]
