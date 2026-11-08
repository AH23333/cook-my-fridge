"""First-screen request budget (stage 39) on the stage37 slow-3G profile.

Locks in the waterfall shape after the bundle split (2026-11-08):
- critical requests are css + bundle-boot.js + page script + core.json
  (the ~172 KB bundle-features.js is injected AFTER the first render on
  lean pages and must never appear on the critical path);
- the core-data fetch starts BEFORE bundle-boot.js finishes downloading
  (the build-injected window.__cmfCore prefetch collapses the serial wave);
- zero data/ai/* bytes before the ingredient wall renders (AI on demand).

Serving is the production negotiation handler (precompressed .br/.gz), so
the waterfall reads what a real host delivers: wall ~3.9 s on this profile
(6.9 s uncompressed). The wall assertion stays a generous tripwire.
"""
from __future__ import annotations

import functools
import http.server
import json
import sys
import threading
import time
from pathlib import Path

from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
# Same production negotiation as stage37: precompressed assets or the
# waterfall here measures bytes no real user ever receives.
sys.path.insert(0, str(ROOT / "src"))
from cookmyfridge.serve import PrecompressedHandler  # noqa: E402


def main():
    results = {}
    errors = []
    server = http.server.ThreadingHTTPServer(
        ("127.0.0.1", 0), functools.partial(PrecompressedHandler, directory=str(ROOT / "site"))
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

            critical = [e for e in entries if e["end"] <= wall_ms + 50]
            names = {e["name"] for e in critical}
            core = next((e for e in entries if e["name"] == "data/core.json"), None)
            features = next((e for e in entries if e["name"] == "js/bundle-features.js"), None)
            boot_end = next((e["end"] for e in entries if e["name"] == "js/bundle-boot.js"), None)

            # Forbidden-set budget: the wall may legitimately pass small
            # parallel resources (recipes.json), but the AI shards must
            # never finish before it. End-time membership in "critical" is
            # intentionally NOT asserted for the features bundle: selector
            # polling under 6x CPU observes the wall late and would brand
            # an innocent post-render download as critical.
            check("no AI shards before the wall",
                  not any(n.startswith("data/ai/") for n in names))
            check("core.json on the critical path", "data/core.json" in names)
            check("total requests by networkidle <= 7", total <= 7)
            # The defer design, asserted at start-time (deterministic): the
            # features fetch is issued by boots() after init() renders, and
            # init() runs only after core.json resolves — so features.start
            # must sit after core's responseEnd.
            f_start = features["start"] if features else -1
            c_end = core["end"] if core else -1
            check(f"features fetch starts only after core data landed (f={f_start:.0f}ms c={c_end:.0f}ms)",
                  features is not None and core is not None
                  and features["start"] > core["end"])
            check("core fetch starts before bundle download ends",
                  boot_end is not None and core is not None and core["start"] < boot_end)
            check(f"wall tripwire ({wall_ms / 1000:.1f}s < 15s)", wall_ms < 15000)
            context.close()

            # --- B. the defer promise: wall renders with features BLOCKED ---
            # Timing measurements observe the wall late; refusing the bytes
            # outright is the deterministic proof the first screen does not
            # depend on the features bundle.
            context2 = browser.new_context(
                viewport={"width": 1280, "height": 960}, service_workers="block"
            )
            page2 = context2.new_page()
            page2.on("pageerror", lambda error: errors.append(str(error)))
            page2.route("**/js/bundle-features.js", lambda route: route.abort())
            page2.goto(base + "index.html", wait_until="domcontentloaded")
            page2.wait_for_selector(".chip[data-name]", timeout=30000)
            check("wall renders with features bundle blocked", True)
            page2.click('.chip[data-name="番茄"]')
            page2.click("#btn-cook")
            page2.wait_for_url(lambda u: "result.html" in u)
            page2.wait_for_selector(".recipe-card", timeout=30000)
            check("result buckets render with features blocked",
                  page2.locator(".recipe-card").count() > 0)
            context2.close()
            browser.close()
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
