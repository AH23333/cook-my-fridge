"""Real Chromium full-journey regression (stage 30).

Walks the actual user path and asserts both sides of every step:
storage really changed AND the screen tells the truth about it.

home select -> result buckets -> plan/favorite -> planner menu/shopping ->
calendar subscription (Cache Storage) -> recipe journal -> share tracking.
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
            page = context.new_page()
            page.on("pageerror", lambda error: errors.append(str(error)))
            page.on(
                "console",
                lambda msg: errors.append(msg.text) if msg.type == "error" else None,
            )

            # --- 1. home: pick ingredients, fridge really persists -----------
            page.goto(base + "index.html", wait_until="networkidle")
            page.wait_for_selector(".chip[data-name]")
            page.click('.chip[data-name="番茄"]')
            page.click('.chip[data-name="鸡蛋"]')
            fridge = page.evaluate("CMF.getFridge()")
            check("fridge persisted to storage", sorted(fridge) == ["番茄", "鸡蛋"])
            check(
                "cook button tells count",
                "(2)" in page.locator("#btn-cook").inner_text(),
            )

            # --- 2. result page: buckets, plan, favorite ----------------------
            page.click("#btn-cook")
            page.wait_for_url(lambda url: "result.html" in url, timeout=5000)
            page.wait_for_selector(".recipe-card")
            history = page.evaluate("CMF.getHistory()")
            check(
                "cook click recorded history",
                len(history) == 1 and sorted(history[0]["selected"]) == ["番茄", "鸡蛋"],
            )
            cards = page.locator(".recipe-card")
            check("result shows recipe cards", cards.count() > 0)
            plan_btn = page.locator(".plan-btn").first
            plan_id = plan_btn.get_attribute("data-plan-id")
            plan_btn.click()
            plan = page.evaluate("CMF.getPlan().recipeIds")
            check("plan persisted", plan_id in plan)
            check("plan button flipped", "已加入" in plan_btn.inner_text())
            fav_btn = page.locator(".fav-btn").first
            fav_id = fav_btn.get_attribute("data-fav-id")
            fav_btn.click()
            check("favorite persisted", fav_id in page.evaluate("CMF.getFavorites()"))
            check("fav button flipped", "已收藏" in fav_btn.inner_text())

            # --- 3. planner: menu generation and shopping list ---------------
            page.goto(base + "planner.html", wait_until="networkidle")
            page.wait_for_selector(".week-card")
            week = page.evaluate("JSON.parse(localStorage.getItem('cmf.week'))")
            check("menu persisted with 7 days", len(week["days"]) == 7)
            seed_before = week["seed"]
            page.click("#btn-shuffle")
            page.wait_for_function(
                "s => JSON.parse(localStorage.getItem('cmf.week')).seed !== s",
                arg=seed_before,
            )
            week = page.evaluate("JSON.parse(localStorage.getItem('cmf.week'))")
            check("shuffle advanced seed in storage", week["seed"] != seed_before)
            check("menu still 7 days after shuffle", len(week["days"]) == 7)
            shop_items = page.locator("input[data-shop-key]")
            if shop_items.count() > 0:
                shop_items.first.check()
                week = page.evaluate("JSON.parse(localStorage.getItem('cmf.week'))")
                check(
                    "shopping check persisted",
                    len(week.get("shopChecked", [])) == 1,
                )
                check(
                    "checked item struck through",
                    page.locator(".shop-item.done").count() == 1,
                )
            else:
                check("shopping list honestly empty", "无需额外采购" in page.content())

            # --- 4. calendar subscription: Cache Storage really holds the ICS -
            page.click("#btn-subscribe")
            page.wait_for_selector(".subscribe-box")
            ics = page.evaluate(
                """async () => {
                    const cache = await caches.open("cmf-calendar-v1");
                    const resp = await cache.match(new Request(
                        new URL("calendar.ics", location.href).href));
                    return resp ? resp.text() : null;
                }"""
            )
            check("calendar really published to cache", ics is not None and "BEGIN:VCALENDAR" in ics)
            check("calendar carries real menu events", ics is not None and "BEGIN:VEVENT" in ics)

            # --- 5. recipe page: journal + share ------------------------------
            page.goto(base + "recipe.html?id=r001", wait_until="networkidle")
            page.wait_for_selector("#journal-log")
            page.click("#journal-log")
            journal = page.evaluate("CMF.getJournal().cooked")
            check("journal entry persisted", len(journal) == 1 and journal[0]["recipeId"] == "r001")
            check(
                "journal toast tells the truth",
                "已打卡" in page.locator(".toast").inner_text(),
            )
            page.click("#btn-share-card")
            page.wait_for_selector(".share-modal img")
            page.click("#share-link")
            stats = page.evaluate("CMF.getShareStats()")
            check("share tracked in storage", stats["total"] == 1 and stats["byKind"].get("link") == 1)
            check("copy attempt produced a toast", page.locator(".toast").inner_text() != "")

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
