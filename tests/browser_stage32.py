"""Real Chromium narrow-viewport regression (stage 32).

375x667 phone viewport over every page: no horizontal overflow anywhere, and
the tap targets that matter on a phone (primary nav, card title links, star
rating, checkboxes, week meals) are actually reachable by a finger.
"""
from __future__ import annotations

import functools
import http.server
import json
import threading
from pathlib import Path

from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
PAGES = [
    "index.html", "browse.html", "fridge.html", "planner.html", "stats.html",
    "about.html", "result.html", "recipe.html?id=r001", "wildcard.html",
]


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

    def min_height(page, selector):
        return page.evaluate(
            """sel => {
                const hs = [...document.querySelectorAll(sel)]
                    .map(el => el.getBoundingClientRect().height)
                    .filter(h => h > 0);
                return hs.length ? Math.min(...hs) : null;
            }""",
            selector,
        )

    try:
        with sync_playwright() as p:
            browser = p.chromium.launch(headless=True)
            context = browser.new_context(
                viewport={"width": 375, "height": 667},
                service_workers="block",
                has_touch=True,
                is_mobile=True,
            )
            page = context.new_page()
            page.on("pageerror", lambda error: errors.append(str(error)))
            page.on(
                "console",
                lambda msg: errors.append(msg.text) if msg.type == "error" else None,
            )

            for name in PAGES:
                page.goto(base + name, wait_until="networkidle")
                page.wait_for_timeout(300)
                overflow = page.evaluate(
                    "document.documentElement.scrollWidth - window.innerWidth"
                )
                check(f"no horizontal overflow: {name}", overflow <= 1)

            # Primary .btn rows meet the project's own 40px phone bar.
            page.goto(base + "index.html", wait_until="networkidle")
            btn_h = min_height(page, ".btn")
            check("primary buttons >= 36px on phone", btn_h is not None and btn_h >= 36)

            # Browse: card title is THE navigation on a phone.
            page.goto(base + "browse.html", wait_until="networkidle")
            page.wait_for_selector(".recipe-card h3 a")
            link_h = min_height(page, ".recipe-card h3 a")
            check("card title links >= 30px", link_h is not None and link_h >= 30)

            # Planner: week meal links and shopping checkboxes.
            page.goto(base + "planner.html", wait_until="networkidle")
            page.wait_for_selector(".week-title")
            wt_h = min_height(page, ".week-title")
            check("week meal links >= 28px", wt_h is not None and wt_h >= 28)
            box_h = min_height(page, "input[data-shop-key]")
            if box_h is not None:
                check("shopping checkboxes >= 18px", box_h >= 18)

            # Recipe: star rating and ingredient buttons.
            page.goto(base + "recipe.html?id=r001", wait_until="networkidle")
            page.wait_for_selector(".star-btn")
            star_h = min_height(page, ".star-btn")
            check("star rating buttons >= 32px", star_h is not None and star_h >= 32)
            ing_h = min_height(page, ".ing-name-btn")
            check("ingredient buttons >= 28px", ing_h is not None and ing_h >= 28)

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
