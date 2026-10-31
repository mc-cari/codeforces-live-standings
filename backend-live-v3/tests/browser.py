"""Real frontend + real Kotlin SSE; upstream servers managed by with_server.py."""
import base64
import json
import os
import re
from pathlib import Path
import urllib.request
from playwright.sync_api import sync_playwright, expect, TimeoutError

UPSTREAM="http://127.0.0.1:19081"
def stage(value):
    request=urllib.request.Request(UPSTREAM+"/__stage",data=json.dumps(value).encode(),headers={"Content-Type":"application/json"},method="POST")
    urllib.request.urlopen(request).close()
def url(handles):
    encoded=base64.urlsafe_b64encode(";".join(handles).encode()).decode().rstrip("=")
    return "http://127.0.0.1:3002/contests/1/standings?contestType=normal&h="+encoded

with sync_playwright() as p:
    browser=p.chromium.launch(headless=True)
    context=browser.new_context(viewport={"width":1440,"height":1000})
    page=context.new_page()
    errors=[];page.on("pageerror",lambda e:errors.append(str(e)))
    try:
        page.goto(url(["alice","bob"]),wait_until="domcontentloaded")
        # EventSource is intentionally persistent; wait for rendered state instead of network idle.
        expect(page.get_by_role("region",name="Current standings")).to_be_visible(timeout=60000)
        expect(page.locator('a[href$="/submission/101"]')).to_have_count(1)
        expect(page.locator('a[href$="/submission/201"]')).to_have_count(1)
        stage({"stage":1})
        submission=page.locator('a[href$="/submission/103"]')
        expect(submission).to_have_count(1,timeout=15000)
        expect(submission.locator("..").get_by_text(re.compile(r"^\s*T1\s*$"))).to_be_visible()
        page.reload(wait_until="domcontentloaded")
        expect(page.locator('a[href$="/submission/101"]')).to_have_count(1,timeout=15000)
        expect(page.locator('a[href$="/submission/103"]')).to_have_count(1)
        bob=context.new_page();bob.goto(url(["BOB"]),wait_until="domcontentloaded")
        expect(bob.locator('a[href$="/submission/201"]')).to_have_count(1,timeout=15000)
        expect(bob.locator('a[href$="/submission/101"]')).to_have_count(0)
        context.set_offline(True)
        stage({"stage":3})
        context.set_offline(False)
        expect(page.locator('a[href$="/submission/103"]').locator("..")).to_contain_text("AC",timeout=20000)
        expect(page.locator('a[href$="/submission/101"]')).to_have_count(1)
        output=Path(os.getenv("BROWSER_ARTIFACT_DIR","/tmp/live-v3-browser"));output.mkdir(parents=True,exist_ok=True)
        page.screenshot(path=str(output/"live-v3-standings.png"),full_page=True)
        assert not errors,errors
        print("PASS browser: initial snapshot, real patches, exact testing badge, reload/late snapshot, per-friend filtering, reconnect without duplicates")
    finally:
        context.close();browser.close()
