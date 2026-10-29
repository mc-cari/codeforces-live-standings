"""Isolated Alloy -> remote-write verification. Requires Docker and a built backend image."""
import json
import pathlib
import subprocess
import tempfile
import time
import urllib.parse
import urllib.request
import uuid


def docker(*args, **kwargs):
    return subprocess.check_output(["docker", *args], text=True, **kwargs).strip()


def request(url, payload=None):
    headers = {"Content-Type": "application/json", "Authorization": "Bearer smoke-token"}
    req = urllib.request.Request(url, data=json.dumps(payload).encode() if payload else None, headers=headers)
    with urllib.request.urlopen(req, timeout=5) as response:
        return response.read().decode()


def eventually(check, seconds=65):
    deadline = time.monotonic() + seconds
    last = None
    while time.monotonic() < deadline:
        try:
            result = check()
            if result:
                return result
        except Exception as error:
            last = error
        time.sleep(1)
    raise AssertionError(f"Condition did not become true: {last}")


def main():
    prefix = "cf-usage-check-" + uuid.uuid4().hex[:8]
    backend, alloy, receiver = [prefix + suffix for suffix in ["-backend", "-alloy", "-receiver"]]
    volume = prefix + "-data"
    root = pathlib.Path(__file__).resolve().parent
    containers = []
    docker("network", "create", prefix)
    try:
        docker("volume", "create", volume)
    except Exception:
        docker("network", "rm", prefix)
        raise
    try:
        with tempfile.TemporaryDirectory() as directory:
            config = pathlib.Path(directory)
            config.chmod(0o755)
            (config / "prometheus.yml").write_text("global:\n  scrape_interval: 15s\nscrape_configs: []\n")
            # Exercise the exact committed scrape component with a test receiver.
            (config / "config.alloy").write_text((root / "usage.alloy").read_text() + f'''
prometheus.remote_write "existing" {{
  endpoint {{ url = "http://{receiver}:9090/api/v1/write" }}
}}
''')
            docker("run", "--rm", "-v", f"{config}:/config:ro", "grafana/alloy:v1.14.0", "validate", "/config/config.alloy")
            for name, image, args in [
                (backend, "cf-usage-metrics-check", ["-e", "TELEMETRY_TOKEN=smoke-token", "-e", "METRICS_LISTEN_ADDR=:9090", "-v", f"{volume}:/data", "--network-alias", "cf-live-standings-metrics", "-p", "127.0.0.1::8080"]),
                (receiver, "prom/prometheus:v3.5.0", ["-v", f"{config}:/config:ro", "-p", "127.0.0.1::9090"]),
                (alloy, "grafana/alloy:v1.14.0", ["-v", f"{config}:/config:ro"]),
            ]:
                command = []
                if name == receiver:
                    command = ["--config.file=/config/prometheus.yml", "--web.enable-remote-write-receiver"]
                if name == alloy:
                    command = ["run", "--server.http.listen-addr=0.0.0.0:12345", "/config/config.alloy"]
                docker("run", "-d", "--name", name, "--network", prefix, *args, image, *command)
                containers.append(name)
            def host(name, port):
                return "http://" + docker("port", name, port)
            app = host(backend, "8080")
            prom = host(receiver, "9090")
            eventually(lambda: request(app + "/healthz"))
            def query(expr):
                result = json.loads(request(prom + "/api/v1/query?" + urllib.parse.urlencode({"query": expr})))
                assert result["status"] == "success", result
                return result["data"]["result"]
            eventually(lambda: any(row["value"][1] == "1" for row in query('up{job="cf-live-standings"}')))
            print("PASS: Alloy scrape and remote write", flush=True)
            event = {"id": "smoke-event-00000001", "kind": "page_view", "mode": "live"}
            request(app + "/v1/telemetry", event)
            request(app + "/v1/telemetry", event)
            request(app + "/v1/telemetry", {"id": "smoke-event-00000002", "kind": "view_displayed", "mode": "live", "seconds": 1})
            exported = docker("run", "--rm", "--network", f"container:{backend}",
                              "busybox:1.37", "wget", "-qO-", "http://127.0.0.1:9090/metrics")
            for metric in (
                'cf_codeforces_submission_responses_total{history="consistent"} 0',
                'cf_codeforces_submission_responses_total{history="missing_known"} 0',
                'cf_codeforces_submission_omissions_total 0',
            ):
                assert metric in exported.splitlines(), metric
            for metric in (
                'cf_codeforces_submission_responses_total{job="cf-live-standings",history="consistent"}',
                'cf_codeforces_submission_responses_total{job="cf-live-standings",history="missing_known"}',
                'cf_codeforces_submission_omissions_total{job="cf-live-standings"}',
            ):
                eventually(lambda: any(row["value"][1] == "0" for row in query(metric)))
            expression = 'cf_usage_page_views_total{job="cf-live-standings",mode="live"}'
            eventually(lambda: any(row["value"][1] == "1" for row in query(expression)))
            docker("restart", backend)
            app = host(backend, "8080")
            eventually(lambda: request(app + "/healthz"))
            # Read the restarted exporter directly: Prometheus may still have
            # pre-restart samples, and reposts could hide a lost database.
            retained = docker("run", "--rm", "--network", f"container:{backend}",
                              "busybox:1.37", "wget", "-qO-", "http://127.0.0.1:9090/metrics")
            assert 'cf_usage_page_views_total{mode="live"} 1' in retained.splitlines(), retained
            request(app + "/v1/telemetry", event)
            request(app + "/v1/telemetry", {**event, "id": "smoke-event-00000003"})
            eventually(lambda: any(row["value"][1] == "2" for row in query(expression)))
            dashboard = json.loads((root / "usage-dashboard.json").read_text())
            for panel in dashboard["panels"]:
                for target in panel["targets"]:
                    expr = target["expr"].replace("$__range", "10m").replace("$__rate_interval", "1m")
                    result = query(expr)
                    # Lifetime counters and gauges exist even when their values are zero.
                    # Rate/increase queries need multiple samples, so may be empty.
                    if panel["id"] in (1, 2, 3, 4, 13, 14):
                        assert result, f"No series for panel {panel['id']}: {expr}"
            assert json.loads(docker("inspect", backend))[0]["NetworkSettings"]["Ports"].get("9090/tcp") is None
            print(f"PASS: Alloy scrape, remote write, {len(dashboard['panels'])} dashboard queries, duplicate delivery, backend restart, private metrics port")
    except Exception:
        for name in containers:
            print(docker("logs", "--tail", "20", name, stderr=subprocess.STDOUT))
        raise
    finally:
        for name in reversed(containers):
            docker("rm", "-f", name)
        docker("volume", "rm", volume)
        docker("network", "rm", prefix)


if __name__ == "__main__":
    main()
