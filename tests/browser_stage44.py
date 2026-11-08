"""Write-safety under concurrent / repeated activation (stage 44).

A) Multi-tab: every page keeps an in-memory snapshot; a stale tab writing
   its snapshot back erased whatever the other tab had added (reproduced:
   A adds 番茄, B adds 鸡蛋 -> fridge held only 鸡蛋). Single-item deltas
   now merge at WRITE time; whole-state actions stay intentional replaces.
B) Rapid re-entry: a dblclick used to log TWO journal entries because each
   dispatched click re-ran the handler; the log button now disables
   synchronously. Inventory add/commit flows were probe-verified guarded
   (preview/receipt gates) and pinned here too.
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

            # --- B. rapid re-entry: one click, one write --------------------
            context2 = browser.new_context(
                viewport={"width": 1280, "height": 960}, service_workers="block"
            )
            page = context2.new_page()
            page.on("pageerror", lambda error: errors.append(str(error)))
            page.goto(base + "recipe.html?id=r001", wait_until="networkidle")
            page.wait_for_selector("#journal-log")
            page.locator("#journal-log").dblclick()
            page.wait_for_timeout(200)
            check("dblclick logs exactly one journal entry",
                  page.evaluate("CMF.getJournal().cooked.length") == 1)
            page.evaluate("""() => {
                const b = document.querySelector('#journal-log');
                for (let i = 0; i < 5 && b; i++) b.click();
            }""")
            page.wait_for_timeout(200)
            check("frantic clicks still produce exactly one entry",
                  page.evaluate("CMF.getJournal().cooked.length") == 1)

            # Inventory batch add: dblclick on submit must not duplicate.
            page.goto(base + "fridge.html", wait_until="networkidle")
            page.wait_for_selector("#inventory-content form")
            ledger = page.locator("#inventory-content")
            ledger.locator('[name="canonical"]').fill("鸡蛋")
            ledger.locator('[name="grams"]').fill("200")
            ledger.locator('button[type="submit"]').dblclick()
            page.wait_for_timeout(200)
            check("inventory submit dblclick adds exactly one batch",
                  page.evaluate("CMF.getInventory().batches.length") == 1)

            # Inventory deduction confirm: receipt-gated, single deduction.
            need = page.evaluate(
                "CMF.inventoryRecipeNeeds(CMF.data.recipes.find(r => r.id === 'r001'), 1)"
                ".find(n => n.canonical === '鸡蛋').grams"
            )
            page.goto(base + "recipe.html?id=r001", wait_until="networkidle")
            page.wait_for_selector(".inventory-use-form")
            page.locator(".inventory-use-form [data-use-preview]").click()
            page.wait_for_timeout(200)
            commit = page.locator("[data-use-commit]")
            if commit.count():
                commit.dblclick()
                page.wait_for_timeout(200)
            grams = page.evaluate(
                "CMF.normalizeInventory(CMF.getInventory()).batches"
                ".filter(b => !b.deleted).reduce((s, b) => s + b.grams, 0)"
            )
            check("deduction confirm dblclick deducts exactly once",
                  abs(grams - (200 - need)) < 0.01)

            # Undo is receipt-gated: dblclick restores exactly once.
            undo = page.locator("[data-use-undo]")
            if undo.count():
                undo.dblclick()
                page.wait_for_timeout(200)
            restored = page.evaluate(
                "CMF.normalizeInventory(CMF.getInventory()).batches"
                ".filter(b => !b.deleted).reduce((s, b) => s + b.grams, 0)"
            )
            check("undo dblclick restores exactly once", abs(restored - 200) < 0.01)

            # goCook dblclick: one history entry, not two.
            page.goto(base + "index.html", wait_until="networkidle")
            page.wait_for_selector(".chip[data-name]")
            page.click('.chip[data-name="番茄"]')
            page.locator("#btn-cook").dblclick()
            page.wait_for_timeout(400)
            check("cook dblclick logs exactly one history entry",
                  page.evaluate("CMF.getHistory().length") == 1)
            context2.close()
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
