"""Performance tripwire (stage 34): generous thresholds that only fire on
catastrophic regressions. Measured baseline (2026-11, local http, Chromium):
home FCP ~28ms; browse with 500 synthetic cards: keystroke ~80ms incl. the
50ms probe settle; 12 wheel scrolls: 0 long tasks.

The AI shards (~2.3 MB, mostly variants.json) are fetched eagerly by design:
the service worker precaches the same bytes at install, so the runtime cost
is paid once and every later load is served from the local cache.
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


def pad_recipes(original, n=500):
    out = list(original)
    i = 0
    while len(out) < n:
        row = dict(original[i % len(original)])
        row["id"] = f"perf-{i}"
        row["title"] = f"压测菜{i}号"
        out.append(row)
        i += 1
    return out


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

            page.goto(base + "index.html", wait_until="networkidle")
            page.goto(base + "index.html", wait_until="networkidle")
            fcp = page.evaluate("""() => {
                const p = performance.getEntriesByType("paint")
                    .find(e => e.name === "first-contentful-paint");
                return p ? p.startTime : null;
            }""")
            check("home first contentful paint < 2s", fcp is not None and fcp < 2000)

            real = json.loads(
                (ROOT / "site" / "data" / "recipes.json").read_text(encoding="utf-8")
            )
            page.route(
                "**/data/recipes.json",
                lambda route: route.fulfill(
                    content_type="application/json",
                    body=json.dumps(pad_recipes(real)),
                ),
            )
            page.goto(base + "browse.html", wait_until="networkidle")
            page.wait_for_selector(".recipe-card")
            check("500 recipes rendered", page.locator(".recipe-card").count() >= 500)

            worst = 0
            for ch in "番茄鸡蛋":
                t0 = time.perf_counter()
                page.type("#browse-search", ch)
                page.wait_for_timeout(50)
                worst = max(worst, (time.perf_counter() - t0) * 1000)
            check("keystroke filter < 500ms on 500 cards", worst < 500)

            page.evaluate("""() => {
                window.__longtasks = 0;
                new PerformanceObserver((list) => {
                    window.__longtasks += list.getEntries().length;
                }).observe({ entryTypes: ["longtask"] });
            }""")
            page.mouse.move(640, 500)
            for _ in range(12):
                page.mouse.wheel(0, 1200)
                page.wait_for_timeout(80)
            check("scroll produces no long tasks",
                  page.evaluate("window.__longtasks") == 0)

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
