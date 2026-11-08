"""First-screen request budget (stage 39) on the stage37 slow-3G profile.

Locks in the waterfall shape measured 2026-11-08:
- 5 requests total by networkidle, 4 critical (css, bundle, page, core.json);
- the core-data fetch starts BEFORE bundle.js finishes downloading (the
  build-injected window.__cmfCore prefetch collapses the old serial wave);
- zero data/ai/* bytes before the ingredient wall renders (AI on demand).

The wall itself stays byte-bound (~10.5 s uncompressed local: 358 KB over a
50 KB/s pipe; bundle.js is the long pole — real hosts with gzip see far
less), so the wall assertion stays a generous tripwire only.
"""
from __future__ import annotations

import functools
import http.server
import json
import threading
import time
from pathlib import Path

from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]


class Quiet(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *args):
        pass


def main():
    results = {}
    errors = []
    server = http.server.ThreadingHTTPServer(
        ("127.0.0.1", 0), functools.partial(Quiet, directory=str(ROOT / "site"))
    )
    threading.Thread(target=server.serve_forever, daemon=True).start()
    base = f"http://127.0.0.1:{server.server_port}/"

    def check(name, condition):
        results[name] = bool(condition)

    try:
        with sync_playwright() as p:
            browser = p.chromium.launch(headless=True)
            context = browser.new_context(
                viewport={"width": 1280, "height": 960}, service_workers="block"
            )
            page = context.new_page()
            page.on("pageerror", lambda error: errors.append(str(error)))
            cdp = context.new_cdp_session(page)
            cdp.send("Network.enable")
            cdp.send("Network.emulateNetworkConditions", {
                "offline": False, "latency": 400,
                "downloadThroughput": 400 * 1024 // 8,
                "uploadThroughput": 400 * 1024 // 8,
            })
            cdp.send("Emulation.setCPUThrottlingRate", {"rate": 6})

            t0 = time.perf_counter()
            page.goto(base + "index.html", wait_until="domcontentloaded")
            page.wait_for_selector(".chip[data-name]", timeout=40000)
            wall_ms = (time.perf_counter() - t0) * 1000

            entries = page.evaluate("""() => performance.getEntriesByType("resource")
                .map(e => ({name: e.name.replace(location.origin + "/", ""),
                            start: e.startTime, end: e.responseEnd}))""")
            page.wait_for_load_state("networkidle")
            total = page.evaluate("performance.getEntriesByType('resource').length")
            browser.close()

            critical = [e for e in entries if e["end"] <= wall_ms + 50]
            names = {e["name"] for e in critical}
            check("critical requests <= 5", len(critical) <= 5)
            check("total requests by networkidle <= 6", total <= 6)
            check("no AI shards before the wall",
                  not any(n.startswith("data/ai/") for n in names))
            check("core.json on the critical path", "data/core.json" in names)
            bundle_end = next((e["end"] for e in entries if e["name"] == "js/bundle.js"), None)
            core_start = next((e["start"] for e in entries if e["name"] == "data/core.json"), None)
            check("core fetch starts before bundle download ends",
                  bundle_end is not None and core_start is not None and core_start < bundle_end)
            check(f"wall tripwire ({wall_ms / 1000:.1f}s < 15s)", wall_ms < 15000)
    finally:
        server.shutdown()
        print(json.dumps({"checks": results, "errors": errors}, ensure_ascii=False, indent=1))
        failed = [name for name, ok in results.items() if not ok]
        if failed or errors:
            print("FAILED:", failed, "page errors:", errors)
            raise SystemExit(1)
        print(f"all {len(results)} checks passed, zero page errors")


if __name__ == "__main__":
    main()
