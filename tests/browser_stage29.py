"""Real Chromium coverage for menu save failures (storage full / blocked).

Scenario under test: localStorage.setItem throws for the cmf.week key while
the user regenerates the menu. The page must tell the user the save failed,
must not show a success toast, must keep the previously saved menu intact,
and must not raise an uncaught page error.
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
            page.goto(base + "planner.html", wait_until="networkidle")
            page.wait_for_selector(".week-card")
            check("menu renders", page.locator(".week-card").count() == 7)

            saved_before = page.evaluate("localStorage.getItem('cmf.week')")
            check("initial menu persisted", saved_before is not None)

            # Pitfall 57: side-effecting assignments must be wrapped in a
            # function body, never returned as an expression.
            page.evaluate("""() => {
                const orig = Storage.prototype.setItem;
                window.__origSetItem = orig;
                Storage.prototype.setItem = function (key, value) {
                    if (key === "cmf.week") throw new Error("QuotaExceededError");
                    return orig.call(this, key, value);
                };
            }""")

            page.click("#btn-shuffle")
            toast = page.locator(".toast.show")
            toast.wait_for(state="visible", timeout=3000)
            check("failure toast mentions save failure", "保存失败" in toast.inner_text())
            check(
                "no success toast after failed save",
                "重新生成" not in toast.inner_text(),
            )
            saved_after = page.evaluate("localStorage.getItem('cmf.week')")
            check("previous menu intact after failed save", saved_before == saved_after)

            # Recovery path: unblock storage, shuffle again, success returns.
            page.evaluate("""() => {
                Storage.prototype.setItem = window.__origSetItem;
            }""")
            page.click("#btn-shuffle")
            toast.wait_for(state="visible", timeout=3000)
            check("success toast after recovery", "重新生成" in toast.inner_text())
            saved_after = page.evaluate("localStorage.getItem('cmf.week')")
            check("menu persisted after recovery", saved_after != saved_before)
            check(
                "seed actually advanced",
                json.loads(saved_after)["seed"] != json.loads(saved_before)["seed"],
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


if __name__ == "__main__":
    main()
