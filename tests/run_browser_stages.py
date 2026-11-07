"""One-command browser regression: runs every browser_stageNN.py and prints
a combined report. Each stage prints a JSON block {"checks": {...}, "errors":
[...]} followed by a summary line; this runner collects both, names the exact
failed assertions, and exits non-zero if any stage fails.

Usage: python tests/run_browser_stages.py            # all stages
       python tests/run_browser_stages.py 29 32      # selected stages
"""
from __future__ import annotations

import json
import subprocess
import sys
import time
from pathlib import Path

TESTS_DIR = Path(__file__).resolve().parent


def discover(only: list[str] | None) -> list[Path]:
    stages = sorted(TESTS_DIR.glob("browser_stage*.py"))
    if only:
        stages = [s for s in stages if any(f"stage{n}" in s.name for n in only)]
    return stages


def _parse_payload(stdout: str) -> dict | None:
    """Newer stages print a pretty-printed block followed by a summary line;
    older ones print a single-line JSON as their last line."""
    lines = [l for l in stdout.splitlines() if l.strip()]
    if lines:
        try:
            return json.loads(lines[-1])
        except json.JSONDecodeError:
            pass
    # Pretty-printed blocks: decode the first complete JSON value (nested
    # braces safe) instead of a greedy regex that can span unrelated output.
    start = stdout.find("{")
    if start >= 0:
        try:
            payload, _ = json.JSONDecoder().raw_decode(stdout[start:])
            return payload
        except json.JSONDecodeError:
            return None
    return None


def run_stage(path: Path) -> dict:
    started = time.time()
    proc = subprocess.run(
        [sys.executable, str(path), str(ROOT)],
        capture_output=True,
        text=True,
        cwd=str(ROOT),
        timeout=600,
    )
    elapsed = time.time() - started
    payload = _parse_payload(proc.stdout)
    if payload is None or not isinstance(payload, dict) or "checks" not in payload:
        return {
            "stage": path.stem,
            "exit": proc.returncode,
            "elapsed_s": round(elapsed, 1),
            "checks": 0,
            "failed_checks": ["<runner: 输出里没有可读的结构化报告>"],
            "page_errors": [],
            "ok": False,
        }
    checks = payload.get("checks", {})
    if isinstance(checks, dict):
        # stage29+ format: {"checks": {name: bool}, "errors": [...]}
        failed_checks = [name for name, ok in checks.items() if not ok]
        page_errors = payload.get("errors", [])
        total = len(checks)
    else:
        # stage27/28 format: {"ok": bool, "checks": N, "failures": [...]}
        total = int(checks or 0)
        failed_checks = list(payload.get("failures", []))
        page_errors = list(payload.get("console_errors", []))
    if total == 0 and proc.returncode == 0:
        # A stage that reports nothing is broken, not green.
        failed_checks = failed_checks + ["<runner: 0 项检查，疑似台架输出契约被破坏>"]
    return {
        "stage": path.stem,
        "exit": proc.returncode,
        "elapsed_s": round(elapsed, 1),
        "checks": total,
        "failed_checks": failed_checks,
        "page_errors": page_errors,
        "ok": proc.returncode == 0 and not failed_checks and not page_errors,
    }


ROOT = TESTS_DIR.parent


def main() -> None:
    only = sys.argv[1:] or None
    stages = discover(only)
    if not stages:
        print("no stages matched")
        raise SystemExit(2)

    reports = []
    for stage in stages:
        print(f"--- {stage.stem} running ...", flush=True)
        report = run_stage(stage)
        reports.append(report)
        state = "OK  " if report["ok"] else "FAIL"
        print(f"    {state} {report['checks']} checks, {report['elapsed_s']}s", flush=True)
        for name in report["failed_checks"]:
            print(f"      ✗ {name}", flush=True)
        for err in report["page_errors"][:5]:
            print(f"      ✗ page error: {err[:160]}", flush=True)

    total_checks = sum(r["checks"] for r in reports)
    total_bad = sum(len(r["failed_checks"]) + len(r["page_errors"]) for r in reports)
    print("\n=== browser regression summary ===")
    for r in reports:
        mark = "PASS" if r["ok"] else "FAIL"
        print(f"{mark}  {r['stage']:<22} {r['checks']:>3} checks  {r['elapsed_s']:>6}s")
    print(f"total: {total_checks} checks, {total_bad} failures")
    if any(not r["ok"] for r in reports):
        raise SystemExit(1)
    print("all stages green")


if __name__ == "__main__":
    main()
