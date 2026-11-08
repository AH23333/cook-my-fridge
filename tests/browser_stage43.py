"""Corrupt-shape storage robustness (stage 43).

localStorage can hold valid JSON of the WRONG type — hand edits, older app
versions, truncated writes. Before the getters validated shape, cmf.fridge=42
white-screened the home page (new Set(42)) and cmf.favorites="oops" killed
the fridge page (.some on a string). Every key × wrong type × every
state-hungry page must boot clean: no pageerror, main content renders, and
the getters hand back safe defaults.
"""
from __future__ import annotations

import functools
import http.server
import json
import threading
from pathlib import Path

from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]

KEYS = [
    "cmf.fridge", "cmf.history", "cmf.feedback", "cmf.prefs", "cmf.plan",
    "cmf.favorites", "cmf.week", "cmf.urgent", "cmf.goals", "cmf.shareStats",
    "cmf.journal", "cmf.inventory",
]
BAD_VALUES = ['"oops"', "[1,2,3]", "42", "null"]
PAGES = ["index.html", "result.html?i=%E7%95%AA%E8%8C%84", "fridge.html", "planner.html"]


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
            context = browser.new_context(viewport={"width": 1280, "height": 960}, service_workers="block")
            page = context.new_page()
            crashes = []
            page.on("pageerror", lambda e: crashes.append(str(e)))

            for key in KEYS:
                for bad in BAD_VALUES:
                    page.goto(base + "about.html", wait_until="domcontentloaded")
                    page.evaluate("localStorage.clear()")
                    page.evaluate(
                        f"localStorage.setItem({json.dumps(key)}, {json.dumps(bad)})"
                    )
                    for url in PAGES:
                        crashes.clear()
                        try:
                            page.goto(base + url, wait_until="networkidle", timeout=15000)
                            page.wait_for_timeout(200)
                            alive = page.evaluate(
                                "!!document.querySelector('.chip, .recipe-card, .site-header, main')"
                            )
                        except Exception as e:
                            alive = False
                            crashes.append(type(e).__name__)
                        check(f"boots with {key}={bad} on {url.split('?')[0]}",
                              alive and not crashes)
                        if crashes or not alive:
                            errors.append(f"{key}={bad} on {url}: {crashes[:1] or 'blank'}")

            # API-level shape guards: the getter must never hand back the
            # wrong type even though the raw bytes are still in storage.
            page.goto(base + "about.html", wait_until="domcontentloaded")
            page.evaluate("localStorage.clear()")
            guards = page.evaluate("""() => {
                localStorage.setItem('cmf.fridge', '42');
                localStorage.setItem('cmf.favorites', '"oops"');
                localStorage.setItem('cmf.plan', '[1,2]');
                localStorage.setItem('cmf.journal', '"x"');
                return {
                    fridge: CMF.getFridge(),
                    favorites: CMF.getFavorites(),
                    plan: CMF.getPlan(),
                    journal: CMF.getJournal(),
                };
            }""")
            check("getFridge coerces wrong type to []",
                  guards["fridge"] == [])
            check("getFavorites coerces wrong type to []",
                  guards["favorites"] == [])
            check("getPlan coerces wrong type to empty shape",
                  guards["plan"] == {"recipeIds": [], "checked": []})
            check("getJournal coerces wrong type to empty shape",
                  guards["journal"] == {"cooked": [], "ratings": {}, "notes": {}})
            browser.close()
    finally:
        server.shutdown()
        server.server_close()
        print(json.dumps({"checks": results, "errors": errors}, ensure_ascii=False, indent=1))
        failed = [name for name, ok in results.items() if not ok]
        if failed or errors:
            print("FAILED:", len(failed), "cases;", errors[:5])
            raise SystemExit(1)
        print(f"all {len(results)} checks passed, zero page errors")


if __name__ == "__main__":
    main()
