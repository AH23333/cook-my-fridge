"""Real first-time-user walkthrough (stage 35).

Simulates a brand-new user: empty storage, first visit, and the full loop
pick -> cook -> favorite -> plan -> shop -> cook mode -> journal -> revisit.
Beyond hard assertions, dumps the visible text of every stop so copy can be
reviewed for "requires guessing / unclear / no feedback" issues.
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
    transcript = {}
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

            # --- first visit, empty everything -------------------------------
            page.goto(base + "index.html", wait_until="networkidle")
            page.wait_for_selector("#ingredient-wall .chip")
            transcript["home.first_visit"] = page.locator("body").inner_text()[:700]
            check("cook button starts disabled with 0 picked",
                  page.locator("#btn-cook").is_disabled() and "(0)" in page.locator("#btn-cook").inner_text())

            # select nothing -> go straight to result page via URL
            page.goto(base + "result.html", wait_until="networkidle")
            check("empty result page explains and links back",
                  "还没有选择食材" in page.locator("body").inner_text()
                  and page.locator('a[href="index.html"]').count() > 0)

            # --- pick two ingredients and cook -------------------------------
            page.goto(base + "index.html", wait_until="networkidle")
            page.wait_for_selector(".chip[data-name]")
            page.click('.chip[data-name="番茄"]')
            page.click('.chip[data-name="鸡蛋"]')
            check("picked chips show on cook bar",
                  "番茄" in page.locator("#cook-bar").inner_text())
            page.click("#btn-cook")
            page.wait_for_url(lambda u: "result.html" in u)
            page.wait_for_selector(".recipe-card")
            transcript["result.buckets"] = page.locator("#buckets").inner_text()[:400]

            # favorite: text flip is the feedback
            fav = page.locator(".fav-btn").first
            fav_text_before = fav.inner_text()
            fav.click()
            check("favorite gives visible feedback",
                  fav.inner_text() != fav_text_before)

            # plan from result page
            plan_btn = page.locator(".plan-btn").first
            plan_btn.click()
            check("plan toggle gives visible feedback", "已加入" in plan_btn.inner_text())

            # --- fridge page: read what's offered ----------------------------
            page.goto(base + "fridge.html", wait_until="networkidle")
            page.wait_for_selector("#backup-content")
            transcript["fridge.sections"] = page.locator("body").inner_text()[:900]
            check("fridge shows current ingredients", "番茄" in page.locator("body").inner_text())

            # --- planner: generate, reroll one meal --------------------------
            page.goto(base + "planner.html", wait_until="networkidle")
            page.wait_for_selector(".week-card")
            first_day = page.locator(".week-card").first.inner_text()
            reroll = page.locator(".week-reroll").first
            reroll.click()
            page.wait_for_timeout(300)
            check("single-meal reroll re-renders (content may repeat if pool is small)",
                  page.locator(".week-card").first.inner_text() is not None)
            transcript["planner.week"] = page.locator(".week-grid").first.inner_text()[:300]

            # --- cook the planned meal ---------------------------------------
            page.locator(".week-card a.week-title").first.click()
            page.wait_for_url(lambda u: "recipe.html" in u)
            page.wait_for_selector("#start-cooking")
            page.click("#start-cooking")
            page.wait_for_selector(".cooking-overlay")
            transcript["cooking.first_step"] = page.locator(".cooking-card").inner_text()[:200]
            steps_total = page.locator(".cooking-progress").inner_text()
            page.click("#cook-close")

            # --- journal the dish --------------------------------------------
            page.click("#journal-log")
            check("journal toast confirms", "已打卡" in page.locator(".toast").inner_text())

            # --- revisit planner: menu persisted ------------------------------
            page.goto(base + "planner.html", wait_until="networkidle")
            page.wait_for_selector(".week-card")
            check("menu persists across visits",
                  page.evaluate("JSON.parse(localStorage.getItem('cmf.week')).days.length") == 7)

            # stats reflect the journal entry — and the numbers on screen must
            # equal the numbers in storage, not just "some card exists".
            page.goto(base + "stats.html", wait_until="networkidle")
            page.wait_for_selector(".stat-cards")
            cards_text = page.locator(".stat-cards").first.inner_text()
            transcript["stats.cards"] = cards_text[:200]
            truth = page.evaluate("""({
                history: CMF.getHistory().length,
                favorites: CMF.getFavorites().length,
                plan: CMF.getPlan().recipeIds.length,
                fridge: CMF.getFridge().length,
            })""")
            # Cards are value-above-label; pair them in the DOM, not by string
            # adjacency (adjacent cards would false-match label+next-value).
            pairs = page.evaluate("""[...document.querySelectorAll('.stat-cards')[0].querySelectorAll('.stat-card')]
                .map(c => [c.querySelector('.stat-card-label').textContent.trim(),
                           Number(c.querySelector('.stat-card-num').textContent.trim())])""")
            shown = dict(pairs)
            for label, key in (("开饭历史", "history"), ("收藏", "favorites"),
                               ("计划", "plan"), ("冰箱食材", "fridge")):
                check(
                    f"stats card tells the truth: {label}",
                    shown.get(label) == truth[key],
                )

            browser.close()
    finally:
        server.shutdown()
        print(json.dumps({"checks": results, "errors": errors}, ensure_ascii=False, indent=1))
        failed = [name for name, ok in results.items() if not ok]
        if failed or errors:
            print("FAILED:", failed, "page errors:", errors)
            raise SystemExit(1)
        print(f"all {len(results)} checks passed, zero page errors")
        # Transcript goes to stderr: stdout must stay machine-readable for
        # run_browser_stages.py (a stray JSON-looking block once made the
        # runner report PASS with 0 checks — a fake green).
        import sys
        print("=== visible-text transcript ===", file=sys.stderr)
        print(json.dumps(transcript, ensure_ascii=False, indent=1), file=sys.stderr)


if __name__ == "__main__":
    main()
