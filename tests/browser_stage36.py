"""Real Chromium regression for two survival paths (stage 36).

A) Data migration: a legacy single-meal cmf.week must be upgraded to the
   lunch/dinner shape on next planner visit, keeping the picked dishes,
   telling the user, and persisting the new shape.
B) Clear-site-data re-entry: after the user wipes site data (localStorage +
   Cache Storage + SW registration), the next visit must boot cleanly from
   the network — no white screen, no broken state, storage writable again.
"""
from __future__ import annotations

import functools
import http.server
import json
import threading
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

            # --- A. legacy week migration ----------------------------------
            context = browser.new_context(
                viewport={"width": 1280, "height": 960}, service_workers="block"
            )
            page = context.new_page()
            page.on("pageerror", lambda error: errors.append(str(error)))
            page.goto(base + "index.html", wait_until="domcontentloaded")
            legacy = {
                "seed": 42, "weeks": 1, "startDate": "2026-11-09",
                "days": [
                    {"index": i, "recipeId": r, "title": t}
                    for i, (r, t) in enumerate([
                        ("r001", "番茄炒蛋"), ("r002", "香煎荷包蛋"), ("r003", "微波炉蒸蛋"),
                        ("r004", "鸡蛋羹"), ("r005", "白灼菜心"), ("r006", "生煎包"),
                        ("r007", "清炒土豆丝"),
                    ])
                ],
            }
            page.evaluate(
                "localStorage.setItem('cmf.week', " + json.dumps(json.dumps(legacy)) + ")"
            )
            page.goto(base + "planner.html", wait_until="networkidle")
            page.wait_for_selector(".week-card")
            migrated = page.evaluate("JSON.parse(localStorage.getItem('cmf.week'))")
            check("migration tells the user",
                  "升级" in page.locator(".toast").inner_text() or
                  page.evaluate("document.querySelector('.toast') !== null"))
            check("legacy lunch kept in place",
                  migrated["days"][0]["lunch"]["recipeId"] == "r001")
            check("dinners filled for every day",
                  all(d.get("dinner") and d["dinner"].get("recipeId") for d in migrated["days"]))
            check("migrated shape persisted to storage",
                  all("lunch" in d and "dinner" in d for d in migrated["days"]))
            week_meals = page.evaluate("CMF.weekMeals(JSON.parse(localStorage.getItem('cmf.week')).days)")
            check("14 meals after migration", len(week_meals) == 14)
            context.close()

            # --- B. clear site data, then re-enter --------------------------
            context = browser.new_context(viewport={"width": 1280, "height": 960})
            page = context.new_page()
            page.on("pageerror", lambda error: errors.append(str(error)))
            page.goto(base + "index.html", wait_until="networkidle")
            page.wait_for_function("!!navigator.serviceWorker.ready", timeout=15000)
            page.click('.chip[data-name="番茄"]')
            check("state exists before wipe", page.evaluate("CMF.getFridge()") == ["番茄"])

            # Simulate the browser's "Clear site data": storage, caches, SW.
            page.evaluate("""async () => {
                localStorage.clear();
                const keys = await caches.keys();
                await Promise.all(keys.map((k) => caches.delete(k)));
                const reg = await navigator.serviceWorker.getRegistration();
                if (reg) await reg.unregister();
            }""")
            page.reload(wait_until="networkidle")
            page.wait_for_selector(".chip[data-name]", timeout=15000)
            check("no white screen after site-data wipe",
                  page.locator(".chip[data-name]").count() > 100)
            check("data layer reloaded", page.evaluate("CMF.data.recipes.length") >= 200)
            check("fridge starts empty, not broken", page.evaluate("CMF.getFridge()") == [])
            page.click('.chip[data-name="鸡蛋"]')
            check("storage writable after wipe", page.evaluate("CMF.getFridge()") == ["鸡蛋"])
            check("cook bar reflects new pick", "(1)" in page.locator("#btn-cook").inner_text())
            context.close()

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
