"""Multi-tab concurrency (stage 44): two tabs on one localStorage.

The lost-update bug: every page keeps an in-memory snapshot; a stale tab
writing its snapshot back erased whatever the other tab had added
(reproduced: A adds 番茄, B adds 鸡蛋 -> fridge held only 鸡蛋). Single-item
deltas now merge at WRITE time (re-read, apply delta, adopt fresh truth);
whole-state actions (clear, random box) stay intentional replaces.
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
            context = browser.new_context(
                viewport={"width": 1280, "height": 960}, service_workers="block"
            )
            a = context.new_page()
            b = context.new_page()
            for pg in (a, b):
                pg.on("pageerror", lambda error: errors.append(str(error)))
            a.goto(base + "index.html", wait_until="networkidle")
            a.wait_for_selector(".chip[data-name]")
            b.goto(base + "index.html", wait_until="networkidle")
            b.wait_for_selector(".chip[data-name]")
            fridge = lambda: a.evaluate("JSON.parse(localStorage.getItem('cmf.fridge')||'[]')")

            # The original bug: stale tab overwrites the fresh tab's pick.
            a.click('.chip[data-name="番茄"]')
            b.click('.chip[data-name="鸡蛋"]')
            a.wait_for_timeout(150)
            check("stale tab's chip click merges, does not overwrite",
                  set(fridge()) == {"番茄", "鸡蛋"})

            # Same-tab toggle-off still works after the merge.
            a.click('.chip[data-name="番茄"]')
            a.wait_for_timeout(150)
            check("toggle-off on the owner tab still works",
                  set(fridge()) == {"鸡蛋"})
            a.click('.chip[data-name="番茄"]')
            a.wait_for_timeout(150)

            # NL input from a stale tab merges too.
            b.locator("#nl-input").fill("我有土豆")
            b.locator("#nl-add").click()
            b.wait_for_timeout(150)
            check("NL add from stale tab merges",
                  {"番茄", "鸡蛋", "土豆"} <= set(fridge()))

            # Seasonal chip from a stale tab merges.
            first_season = a.locator(".seasonal-chips .chip").first.get_attribute("data-season")
            a.evaluate("CMF.setFridge(['鸡蛋'])")
            b.locator(f'[data-season="{first_season}"]').click()
            b.wait_for_timeout(150)
            check("seasonal chip from stale tab merges",
                  {"鸡蛋", first_season} <= set(fridge()))

            # Favorites toggles from two tabs merge (store-level re-read).
            a.evaluate("CMF.setFavorites([])")
            a.evaluate("CMF.toggleFavorite('r001')")
            b.evaluate("CMF.toggleFavorite('r002')")
            favs = a.evaluate("JSON.parse(localStorage.getItem('cmf.favorites'))")
            check("favorites from two tabs merge",
                  set(favs) == {"r001", "r002"})

            # Plan toggles from two tabs merge.
            a.evaluate("CMF.setPlan({recipeIds: [], checked: []})")
            a.evaluate("CMF.togglePlanRecipe('r001')")
            b.evaluate("CMF.togglePlanRecipe('r002')")
            plan = a.evaluate("CMF.getPlan()")
            check("plan toggles from two tabs merge",
                  set(plan["recipeIds"]) == {"r001", "r002"})

            # Intentional replace stays a replace: clear wipes by design.
            a.locator("#btn-clear").click()
            a.wait_for_timeout(150)
            check("clear remains an intentional wipe", fridge() == [])

            context.close()
            browser.close()
    finally:
        server.shutdown()
        server.server_close()
        print(json.dumps({"checks": results, "errors": errors}, ensure_ascii=False, indent=1))
        failed = [name for name, ok in results.items() if not ok]
        if failed or errors:
            print("FAILED:", failed, "page errors:", errors)
            raise SystemExit(1)
        print(f"all {len(results)} checks passed, zero page errors")


if __name__ == "__main__":
    main()
