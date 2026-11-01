"""Verify built assets and listener isolation without publishing Docker ports.
Usage: python3 admin/scripts/smoke-image.py [image]
"""
import re
import subprocess
import sys
import time
import uuid

image = sys.argv[1] if len(sys.argv) > 1 else "cf-live-admin:verify"

def docker(*args):
    return subprocess.check_output(["docker", *args], text=True)

def request(name, port, path, method="GET", body="", origin=""):
    # Supply all HTTP bytes over stdin; never interpolate payloads into shell code.
    data = f"{method} {path} HTTP/1.1\r\nHost: localhost:{port}\r\nConnection: close\r\n"
    if body:
        data += f"Content-Type: application/json\r\nContent-Length: {len(body.encode())}\r\n"
    if origin:
        data += f"Origin: {origin}\r\n"
    data += "\r\n" + body
    return subprocess.check_output(
        ["docker", "exec", "-i", name, "bash", "-c", f"exec 3<>/dev/tcp/127.0.0.1/{port}; cat >&3; cat <&3"],
        input=data, text=True, timeout=30,
    )

def check(response, code, content=""):
    assert response.startswith(f"HTTP/1.1 {code}"), response
    assert content in response, response

for development in (False, True):
    name = "cf-admin-smoke-" + uuid.uuid4().hex[:10]
    args = ["run", "-d", "--rm", "--name", name,
            "-e", "CF_API_BASE_URL=http://127.0.0.1:1/",
            "-e", "ADMIN_ORIGIN=https://admin.example.com",
            "-e", "CF_ACCESS_TEAM_DOMAIN=https://example.cloudflareaccess.com",
            "-e", "CF_ACCESS_AUDIENCE=test-audience", "-e", "ADMIN_EMAIL=admin@example.com"]
    if development:
        args += ["-e", "ADMIN_DEV_MODE=true"]
    docker(*args, image)
    try:
        for _ in range(50):
            try:
                response = request(name, 8080, "/healthz")
                if "200 OK" in response:
                    break
            except subprocess.CalledProcessError:
                pass
            time.sleep(.1)
        check(request(name, 8080, "/api/settings"), 404)
        check(request(name, 8080, "/api/contests"), 404)
        if not development:
            for path in ("/", "/api/settings", "/api/contests", "/_astro/missing.js"):
                check(request(name, 8081, path), 401)
            print("Production authentication rejects unauthenticated assets and APIs; public routes isolated.")
        else:
            response = request(name, 8081, "/")
            check(response, 200, "Collection admin")
            script = re.search(r'src="(/_astro/[^"]+\.js)"', response)
            assert script, "Built browser bundle missing"
            check(request(name, 8081, script[1]), 200)
            check(request(name, 8081, "/api/settings"), 200, '"mode":"off"')
            check(request(name, 8081, "/api/settings", "PUT", '{"mode":"selected","selectedContestIds":[42]}', "https://admin.example.com"), 200, '"mode":"selected"')
            check(request(name, 8081, "/api/settings", "PUT", '{"mode":"all"}', "https://evil.example"), 403)
            check(request(name, 8081, "/api/contests"), 200, '"capacity":3')
            check(request(name, 9090, "/metrics"), 200, "cf_collection_waiting_contests")
            print("Production image serves Astro HTML, bundled JS, settings APIs, and collection metrics.")
    finally:
        docker("stop", "-t", "2", name)
