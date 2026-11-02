"""Refresh minimized real API snapshots. Run from any directory; no credentials needed."""
import json, pathlib, datetime, urllib.request, time, copy, collections, argparse, urllib.parse

ROOT = pathlib.Path(__file__).resolve().parent / "fixtures"
CONTESTS = json.loads((ROOT.parent / "contests.json").read_text())
CONTEST_IDS = [contest["id"] for contest in CONTESTS]
CACHE_DIR = None
def source_url(method, cid, handle=None):
    query = {"contestId": cid}
    if handle is not None:
        query["handle"] = handle
    return "https://codeforces.com/api/" + method + "?" + urllib.parse.urlencode(query)


def fetch(method, cid, handle=None):
    url = source_url(method, cid, handle)
    suffix = "-" + urllib.parse.quote(handle, safe="") if handle is not None else ""
    cached = CACHE_DIR / f"{cid}-{method}{suffix}.json" if CACHE_DIR else None
    if cached and cached.exists():
        return json.loads(cached.read_text())
    print(f"Fetching {url}", flush=True)
    with urllib.request.urlopen(url, timeout=120) as response:
        result = json.load(response)
    time.sleep(2.1)
    if result.get("status") != "OK":
        raise RuntimeError(f"{url}: {result.get('comment')}")
    if cached:
        cached.parent.mkdir(parents=True, exist_ok=True)
        cached.write_text(json.dumps(result))
    return result

def capture_participants(cid, standings, status):
    """Keep API responses intact; explicit expectedRows describe missing-row scoring.

    Choose one-run parties so the reference score is independently auditable:
    one acceptance (no rejection penalty), or a skipped educational unofficial run.
    """
    data = standings["result"]
    duration = data["contest"]["durationSeconds"]
    groups = collections.defaultdict(list)
    for run in status["result"]:
        party = run["author"]
        if len(party["members"]) == 1 and 0 <= run["relativeTimeSeconds"] <= duration:
            groups[(party["members"][0]["handle"], party["participantType"])].append(run)
    official = json.loads((ROOT / f"{cid}.json").read_text())
    # Use a control without wrong attempts on solved problems, isolating these
    # cases from the educational penalty discrepancy tested in the official fixture.
    def clean_control(row):
        handle = row["party"]["members"][0]["handle"]
        runs = [r for r in official["submissions"]["result"] if r["author"]["members"][0]["handle"] == handle]
        solved = {r["problem"]["index"] for r in runs if r.get("verdict") == "OK"}
        return all(r.get("verdict") == "OK" or r["problem"]["index"] not in solved for r in runs)
    official_row = next(row for row in official["standings"]["result"]["rows"] if clean_control(row))
    official_handle = official_row["party"]["members"][0]["handle"]
    official_runs = [r for r in official["submissions"]["result"] if r["author"]["members"][0]["handle"] == official_handle]
    for kind, suffix in [("OUT_OF_COMPETITION", "unofficial"), ("VIRTUAL", "virtual"), ("PRACTICE", "practice")]:
        candidates = [runs for (handle, typ), runs in groups.items()
                      if typ == kind and len(runs) == 1 and runs[0].get("verdict") == "OK"]
        if not candidates and kind == "OUT_OF_COMPETITION" and cid == 1739:
            # This API snapshot contains only skipped submissions for unofficial parties.
            candidates = [runs for (handle, typ), runs in groups.items()
                          if typ == kind and len(runs) == 1 and runs[0].get("verdict") == "SKIPPED"]
        assert candidates, (cid, kind)
        run = min(candidates, key=lambda runs: runs[0]["id"])[0]
        results = [{"points": 0, "penalty": 0, "rejectedAttemptCount": 0, "type": "FINAL"} for _ in data["problems"]]
        points = penalty = 0
        if run["verdict"] == "OK":
            index = next(i for i, problem in enumerate(data["problems"]) if problem["index"] == run["problem"]["index"])
            minutes = run["relativeTimeSeconds"] // 60
            if data["contest"]["type"] == "ICPC":
                points, penalty = 1, minutes
            else:
                base = data["problems"][index]["points"]
                points = max(base * .3, base - base * minutes / 250)
            results[index].update(points=points, penalty=penalty, bestSubmissionTimeSeconds=run["relativeTimeSeconds"])
        expected = {"party": run["author"], "points": points, "penalty": penalty, "rank": 0, "problemResults": results}
        rows = sorted([copy.deepcopy(official_row), expected], key=lambda row: (-row["points"], row["penalty"]))
        snapshot = copy.deepcopy(official)
        snapshot["standings"]["result"]["rows"] = [copy.deepcopy(official_row)]
        snapshot["submissions"]["result"] = sorted(official_runs + [run], key=lambda r: -r["id"])
        snapshot["expectedRows"] = rows
        snapshot["participantType"] = kind
        snapshot["oracleNote"] = "Unofficial standings unavailable anonymously. Expected missing-row scores use a single real accepted/skipped submission with no rejected attempts; API standings are unmodified apart from filtering official rows."
        (ROOT / f"{cid}-{suffix}.json").write_text(json.dumps(snapshot, indent=2) + "\n")


def capture_official(cid, standings, status=None):
    data = standings["result"]
    assert data["contest"]["phase"] == "FINISHED", "only finished contests are stable oracles"
    expected = next(contest for contest in CONTESTS if contest["id"] == cid)
    assert all(data["contest"][key] == value for key, value in expected.items()), f"{cid}: contest metadata differs from catalog"
    duration = data["contest"]["durationSeconds"]
    by_handle = collections.defaultdict(list)
    for run in status["result"] if status else []:
        party = run["author"]
        if party["participantType"] == "CONTESTANT" and len(party["members"]) == 1 and 0 <= run["relativeTimeSeconds"] <= duration:
            by_handle[party["members"][0]["handle"]].append(run)
    rows = []
    for row in data["rows"]:
        party = row["party"]
        if party["participantType"] != "CONTESTANT" or len(party["members"]) != 1 or row["successfulHackCount"] or row["unsuccessfulHackCount"]:
            continue
        solved = sum(p["points"] > 0 for p in row["problemResults"])
        if not 1 <= solved <= 3 or not any(p["rejectedAttemptCount"] for p in row["problemResults"]):
            continue
        handle = party["members"][0]["handle"]
        if status is None and handle not in by_handle:
            response = fetch("contest.status", cid, handle)
            by_handle[handle] = [run for run in response["result"]
                                 if run["author"]["participantType"] == "CONTESTANT"
                                 and len(run["author"]["members"]) == 1
                                 and run["author"]["members"][0]["handle"] == handle
                                 and 0 <= run["relativeTimeSeconds"] <= duration]
        runs = by_handle[handle]
        accepted = {r["problem"]["index"] for r in runs if r.get("verdict") == "OK"}
        expected_solved = {problem["index"] for problem, result in zip(data["problems"], row["problemResults"]) if result["points"] > 0}
        if accepted != expected_solved:
            continue
        rows.append(row)
        if len(rows) == 4:
            break
    assert len(rows) == 4, f"{cid}: insufficient complete official histories"
    selected = [run for row in rows for run in by_handle[row["party"]["members"][0]["handle"]]]
    envelope = copy.deepcopy(standings)
    envelope["result"]["rows"] = rows
    fixture = {
        "capturedAt": datetime.datetime.now(datetime.timezone.utc).isoformat(),
        "sources": [source_url("contest.standings", cid)] + (
            [source_url("contest.status", cid)] if status else
            [source_url("contest.status", cid, row["party"]["members"][0]["handle"]) for row in rows]),
        "standings": envelope,
        "submissions": {"status": "OK", "result": sorted(selected, key=lambda run: -run["id"])},
    }
    (ROOT / f"{cid}.json").write_text(json.dumps(fixture, indent=2) + "\n")
    print(f"Saved {cid}: {data['contest']['name']}, {duration}s, {len(selected)} submissions", flush=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--contests", nargs="+", type=int, choices=CONTEST_IDS, default=CONTEST_IDS)
    parser.add_argument("--cache-dir", type=pathlib.Path, help="Optional raw API cache; omit for fresh captures")
    args = parser.parse_args()
    global CACHE_DIR
    CACHE_DIR = args.cache_dir
    for cid in args.contests:
        standings = fetch("contest.standings", cid)
        # Only participant-type cases need the bulk history. New official cases
        # fetch each selected handle, avoiding hundreds of MB of unrelated runs.
        bulk_cached = CACHE_DIR and (CACHE_DIR / f"{cid}-contest.status.json").exists()
        status = fetch("contest.status", cid) if cid in [1735, 1739] or bulk_cached else None
        capture_official(cid, standings, status)
        if cid in [1735, 1739]:
            capture_participants(cid, standings, status)


if __name__ == "__main__":
    main()
