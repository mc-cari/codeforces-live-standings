#!/usr/bin/env python3
"""Characterize original and changed live-v3 behavior in disposable worktrees.

Passing means the recorded behavior was reproduced, including known defects.
No production checkout is modified. Uses only Python's standard library.
"""
import argparse
import datetime
import json
import os
from pathlib import Path
import subprocess
import tempfile
import xml.etree.ElementTree as ET

HERE = Path(__file__).resolve().parent
PLUGIN = Path("src/cds/plugins/codeforces")
TESTS = PLUGIN / "src/test/kotlin"
FIXTURE_COMMIT = "493d07201f437d01b8a27a60ffeeb1fb8d40d1f8"
CASES = [
    ("original", "4afb37ea2bece05f22e208a4a6476caede2fe8a2",
     ["CFExistingBehaviorAuditTest", "CFPhasePipelineAuditTest",
      "CFDecayPublishedStandingsAuditTest", "CFFinishedColdStartAuditTest"],
     {"AUDIT_PATCHED": "false", "PHASE_MAPPING_FIXED": "false", "DECAY_RESULT_EXPECTED": "489"}),
    ("phase_fix", "706a03d076be659aca41a4d63798aa48dd0a1ca5",
     ["CFPhasePipelineAuditTest"], {"PHASE_MAPPING_FIXED": "true"}),
    ("decay_change", "850d64ab2cbb091bdf024ce929eb263b922eb1b2",
     ["CFDecayPublishedStandingsAuditTest"], {"DECAY_RESULT_EXPECTED": "486"}),
    ("current_fork", "f310cc418f4c8f308186945783542bbd3eb7bdad",
     ["CFExistingBehaviorAuditTest", "CFAdapterBoundaryAuditTest"], {"AUDIT_PATCHED": "true"}),
]


def run(command, cwd, **kwargs):
    # RTK is optional for readers; use it when available in the author's environment.
    import shutil
    prefix = ["rtk", "proxy"] if shutil.which("rtk") else []
    return subprocess.run(prefix + command, cwd=cwd, check=True, **kwargs)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--engine", type=Path, default=HERE.parents[3] / "vendor/live-v3")
    parser.add_argument("--output", type=Path, default=HERE / "audit-results.json")
    args = parser.parse_args()
    engine = args.engine.resolve()
    fixture = run(["git", "show", f"{FIXTURE_COMMIT}:{TESTS}/CFPartialHistoryTest.kt"],
                  engine, text=True, stdout=subprocess.PIPE).stdout
    report = {"generated_at_utc": datetime.datetime.now(datetime.timezone.utc).isoformat(),
              "meaning_of_pass": "Observed behavior reproduced; known defects are explicitly asserted.",
              "cases": []}
    failed = False
    with tempfile.TemporaryDirectory(prefix="live-v3-boundary-audits-") as temporary:
        for name, commit, classes, variables in CASES:
            checkout = Path(temporary) / name
            record = {"name": name, "commit": commit, "environment": variables, "suites": []}
            added = False
            try:
                run(["git", "worktree", "add", "--detach", str(checkout), commit], engine)
                added = True
                tests = checkout / TESTS
                tests.mkdir(parents=True, exist_ok=True)
                (tests / "CFPartialHistoryTest.kt").write_text(fixture)
                for test in classes:
                    (tests / f"{test}.kt").write_bytes((HERE / f"{test}.kt").read_bytes())
                command = ["./gradlew", ":cds:plugins:codeforces:test"]
                for test in classes:
                    command.extend(["--tests", f"*{test}"])
                run(command, checkout, env=dict(os.environ, **variables))
                for path in sorted((checkout / PLUGIN / "build/test-results/test").glob("TEST-*.xml")):
                    suite = ET.parse(path).getroot()
                    record["suites"].append({"name": suite.attrib["name"],
                        **{key: int(suite.attrib.get(key, 0)) for key in ("tests", "failures", "errors", "skipped")},
                        "observations": suite.findtext("system-out", "").strip().splitlines()})
                record["status"] = "reproduced"
            except subprocess.CalledProcessError as error:
                record["status"] = "failed"
                record["exit_code"] = error.returncode
                failed = True
            finally:
                report["cases"].append(record)
                if added:
                    run(["git", "worktree", "remove", "--force", str(checkout)], engine)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(report, indent=2) + "\n")
    print(f"Audit evidence written to {args.output}", flush=True)
    return int(failed)


if __name__ == "__main__":
    raise SystemExit(main())
