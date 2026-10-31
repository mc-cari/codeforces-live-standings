#!/usr/bin/env python3
"""Start deterministic upstreams, Kotlin backend and Next; run the real browser test."""
import os
from pathlib import Path
import signal
import socket
import ssl
import subprocess
import sys
import tempfile
import time
from contract import ROOT, Upstream

processes=[]
def wait(port, process):
    deadline=time.monotonic()+120
    while time.monotonic()<deadline:
        if process.poll() is not None:raise RuntimeError(f"server on port {port} exited")
        try:
            with socket.create_connection(("127.0.0.1",port),timeout=.5):return
        except OSError:time.sleep(.1)
    raise TimeoutError(f"server on port {port} did not start")

with tempfile.TemporaryDirectory(prefix="live-v3-browser-") as temp:
    root=Path(temp);upstreams=[];logs=[]
    try:
        subprocess.run(["openssl","req","-x509","-newkey","rsa:2048","-nodes","-keyout",str(root/"key.pem"),"-out",str(root/"cert.pem"),"-subj","/CN=localhost","-addext","subjectAltName=DNS:localhost,IP:127.0.0.1","-days","1"],check=True,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
        upstreams.append(Upstream(19081))
        tls=Upstream(19082);upstreams.append(tls)
        context=ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER);context.load_cert_chain(root/"cert.pem",root/"key.pem")
        tls.server.socket=context.wrap_socket(tls.server.socket,server_side=True)
        env=dict(os.environ,DATA_DIR=str(root/"data"),LISTEN_ADDR="127.0.0.1:19080",METRICS_LISTEN_ADDR="127.0.0.1:19090",CF_API_BASE_URL="http://127.0.0.1:19081/",POLL_INTERVAL_MS="200",CF_REQUEST_INTERVAL_MS="20",ALLOWED_ORIGINS="http://127.0.0.1:3002")
        log=open(root/"backend.log","w+");logs.append(log)
        process=subprocess.Popen([str(ROOT/"backend-live-v3/build/install/live-v3-backend/bin/live-v3-backend")],env=env,stdout=log,stderr=log,start_new_session=True)
        processes.append(process);wait(19080,process)
        env.update(NEXT_PUBLIC_LIVE_API_BASE_URL="http://127.0.0.1:19080",CF_API_BASE_URL="https://localhost:19082/",CF_API_KEY="fixture",CF_API_SECRET="fixture",NODE_EXTRA_CA_CERTS=str(root/"cert.pem"))
        log=open(root/"frontend.log","w+");logs.append(log)
        process=subprocess.Popen(["pnpm","dev","--port","3002"],cwd=ROOT/"frontend",env=env,stdout=log,stderr=log,start_new_session=True)
        processes.append(process);wait(3002,process)
        subprocess.run([sys.executable,str(ROOT/"backend-live-v3/tests/browser.py")],check=True)
    except Exception:
        for log in logs:
            log.flush();log.seek(0);print(log.read()[-6000:])
        raise
    finally:
        for process in reversed(processes):
            if process.poll() is None:
                os.killpg(process.pid,signal.SIGTERM)
                try:process.wait(timeout=10)
                except subprocess.TimeoutExpired:os.killpg(process.pid,signal.SIGKILL);process.wait()
        for upstream in upstreams:upstream.close()
        for log in logs:log.close()
