#!/usr/bin/env python3
"""Real HTTP/SSE conformance tests. No third-party Python dependencies.

Run after `./gradlew installDist` and `go build -o /tmp/live-go .` in backend/:
  python3 tests/contract.py --go /tmp/live-go
Use --serve for the browser test's deterministic upstream.
"""
import argparse
import base64
import copy
import http.client
import json
import os
from pathlib import Path
import socket
import ssl
import subprocess
import tempfile
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

ROOT = Path(__file__).resolve().parents[2]

def submission(ident, verdict, seconds, handle="alice", participant="CONTESTANT", problem="A"):
    return {"id":ident,"contestId":1,"creationTimeSeconds":1700000000+seconds,"relativeTimeSeconds":seconds,
            "problem":{"contestId":1,"index":problem,"name":problem,"type":"PROGRAMMING","points":500 if problem=="A" else 1000},
            "author":{"members":[{"handle":handle}],"participantType":participant,"ghost":False},
            "programmingLanguage":"GNU C++17","verdict":verdict,"testset":"TESTS","passedTestCount":1,
            "timeConsumedMillis":12,"memoryConsumedBytes":1024}

class Upstream:
    def __init__(self, port=0):
        self.stage=0
        self.status_calls=0
        self.completed_status_stage=-1
        self.fail=False
        self.phase="CODING"
        self.recorded=None
        owner=self
        class Handler(BaseHTTPRequestHandler):
            protocol_version="HTTP/1.1"
            def log_message(self,*args): pass
            def do_POST(self):
                if self.path!="/__stage": self.send_error(404);return
                data=json.loads(self.rfile.read(int(self.headers.get("Content-Length","0"))))
                owner.stage=data.get("stage",owner.stage);owner.phase=data.get("phase",owner.phase)
                owner.fail=data.get("fail",owner.fail)
                self.send_response(204);self.end_headers()
            def do_GET(self):
                method=urllib.parse.urlparse(self.path).path.rsplit("/",1)[-1]
                stage=owner.stage
                if method=="healthz": result={"ok":True}
                elif method=="contest.standings": result=owner.standings()
                elif method=="contest.status": owner.status_calls+=1;result=owner.submissions(stage)
                elif method=="contest.hacks": result=[] if owner.recorded is None else owner.recorded["hacks"]
                elif method=="contest.list": result=[owner.standings()["contest"]]
                elif method=="user.info": result=[{"handle":"alice","rank":"expert"},{"handle":"bob","rank":"master"}]
                else:self.send_error(404);return
                payload=json.dumps({"status":"OK","result":result}).encode()
                self.send_response(503 if owner.fail else 200)
                self.send_header("Content-Type","application/json");self.send_header("Content-Length",str(len(payload)))
                self.end_headers();self.wfile.write(payload);self.wfile.flush()
                if method=="contest.status" and not owner.fail:owner.completed_status_stage=stage
        self.server=ThreadingHTTPServer(("127.0.0.1",port),Handler)
        self.server.daemon_threads=True
        threading.Thread(target=self.server.serve_forever,daemon=True).start()
    @property
    def url(self):return f"http://127.0.0.1:{self.server.server_port}"
    def submissions(self, stage=None):
        stage=self.stage if stage is None else stage
        if self.recorded:return self.recorded["submissions"]
        if stage==0:return [submission(102,"OK",600),submission(101,"WRONG_ANSWER",300),submission(201,"OK",300,"bob","OUT_OF_COMPETITION")]
        if stage==1:return [submission(103,"TESTING",700,problem="B"),submission(102,"OK",600)]
        if stage==2:return []
        return [submission(103,"OK",700,problem="B")]
    def standings(self):
        if self.recorded:return self.recorded["standings"]
        solved=self.stage>=3
        return {"contest":{"id":1,"name":"Shared conformance fixture","type":"CF","phase":self.phase,"frozen":False,"durationSeconds":7200,"startTimeSeconds":1700000000,"relativeTimeSeconds":800+max(0,self.completed_status_stage)},
                "problems":[{"contestId":1,"index":p,"name":p,"type":"PROGRAMMING","points":v} for p,v in [("A",500),("B",1000)]],
                "rows":[{"party":submission(102,"OK",600)["author"],"rank":1,"points":1386 if solved else 430,"penalty":0,"successfulHackCount":0,"unsuccessfulHackCount":0,
                         "problemResults":[{"points":430,"penalty":0,"rejectedAttemptCount":1,"type":"FINAL","bestSubmissionTimeSeconds":600},
                                           {"points":956 if solved else 0,"penalty":0,"rejectedAttemptCount":0,"type":"FINAL","bestSubmissionTimeSeconds":700 if solved else 0}],"lastSubmissionTimeSeconds":700 if solved else 600}]}
    def close(self):self.server.shutdown();self.server.server_close()

def free_port():
    with socket.socket() as s:s.bind(("127.0.0.1",0));return s.getsockname()[1]

def call(url, method="GET"):
    with urllib.request.urlopen(urllib.request.Request(url,method=method),timeout=130) as response:return json.load(response)

def snapshot(base, contest=1, handles=("alice","bob")):
    encoded=base64.urlsafe_b64encode(";".join(handles).encode()).decode().rstrip("=")
    response=urllib.request.urlopen(f"{base}/v1/contests/{contest}/events?h={encoded}",timeout=20)
    try:
        kind=None
        while True:
            line=response.readline().decode().strip()
            if not line:continue
            if line.startswith("event: "):kind=line[7:]
            if line.startswith("data: ") and kind=="snapshot":return json.loads(line[6:])
    finally:response.close()

def wait_snapshot(base, predicate, contest=1, handles=("alice","bob")):
    deadline=time.monotonic()+30
    while time.monotonic()<deadline:
        value=snapshot(base,contest,handles)
        if predicate(value):return value
        time.sleep(.1)
    raise AssertionError("snapshot condition timed out")

def ids(value):return {s["id"] for s in value["submissions"]}

def rows(value):return {r["party"]["members"][0]["handle"].lower():r for r in value["standings"]["rows"]}

def run_provider(name, binary):
    upstream=Upstream();port=free_port();metrics_port=free_port()
    with tempfile.TemporaryDirectory(prefix=f"live-{name}-") as directory:
        log=open(Path(directory)/"process.log","w+")
        env=dict(os.environ,CF_API_BASE_URL=upstream.url+"/",DATA_DIR=directory,LISTEN_ADDR=f"127.0.0.1:{port}",METRICS_LISTEN_ADDR=f"127.0.0.1:{metrics_port}",POLL_INTERVAL_MS="100",CF_REQUEST_INTERVAL_MS="20")
        process=subprocess.Popen([str(binary)],env=env,stdout=log,stderr=log)
        base=f"http://127.0.0.1:{port}"
        try:
            for _ in range(150):
                if process.poll() is not None:raise AssertionError("provider exited")
                try:call(base+"/healthz");break
                except (urllib.error.URLError,ConnectionError):time.sleep(.1)
            call(base+"/v1/contests/1/activate","POST")
            initial=wait_snapshot(base,lambda s:ids(s)=={101,102,201})
            assert rows(initial)["alice"]["points"]==430
            assert rows(initial)["bob"]["points"]==490
            upstream.stage=1
            truncated=wait_snapshot(base,lambda s:103 in ids(s))
            assert ids(truncated)=={101,102,103,201}
            assert rows(truncated)["alice"]["points"]==430
            upstream.stage=2
            # This marker is issued only after a stage-2 status response has completed.
            # Waiting for its published contest metadata also waits for a complete reload.
            empty=wait_snapshot(base,lambda s:s["contest"]["relativeTimeSeconds"]==802)
            assert ids(empty)=={101,102,103,201}
            upstream.stage=3
            changed=wait_snapshot(base,lambda s:s["contest"]["relativeTimeSeconds"]==803 and any(x["id"]==103 and x["verdict"]=="OK" for x in s["submissions"]))
            assert rows(changed)["alice"]["points"]==1386
            assert rows(changed)["alice"]["rank"]==1
            individual=snapshot(base,handles=("BOB",))
            assert ids(individual)=={201} and individual["submissions"][0]["author"]["rank"]==1
            upstream.phase="SYSTEM_TEST"
            wait_snapshot(base,lambda s:s["contest"]["phase"]=="SYSTEM_TEST")
            upstream.phase="FINISHED"
            wait_snapshot(base,lambda s:s.get("health",{}).get("state")=="finished")
            print(f"PASS {name}: omissions, empty response, verdict update, unofficial row, late snapshot, friend filtering/rank, system testing, finalization",flush=True)
        except Exception:
            log.flush();log.seek(0);print(log.read()[-6000:]);raise
        finally:
            process.terminate()
            try:process.wait(timeout=10)
            except subprocess.TimeoutExpired:process.kill();process.wait()
            log.close();upstream.close()

def main():
    parser=argparse.ArgumentParser();parser.add_argument("--go",type=Path);parser.add_argument("--serve",action="store_true");parser.add_argument("--port",type=int,default=19081);parser.add_argument("--tls-cert");parser.add_argument("--tls-key")
    args=parser.parse_args()
    if args.serve:
        server=Upstream(args.port)
        if args.tls_cert:
            context=ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER);context.load_cert_chain(args.tls_cert,args.tls_key)
            server.server.socket=context.wrap_socket(server.server.socket,server_side=True)
        print(server.url,flush=True)
        try:threading.Event().wait()
        except KeyboardInterrupt:pass
        finally:server.close()
    else:
        run_provider("live-v3",ROOT/"backend-live-v3/build/install/live-v3-backend/bin/live-v3-backend")
        if args.go:run_provider("go",args.go.resolve())

if __name__=="__main__":main()
