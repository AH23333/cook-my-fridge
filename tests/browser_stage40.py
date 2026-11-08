"""Subpath-hosting acceptance (stage 40): the site mounted under
/cookmyfridge/ — the GitHub Pages project-site layout. Root-path testing
can never see these failure modes: absolute-path assumptions, SW scope,
manifest start_url/icons, deep-link offline fallback, the SW-virtual
calendar.ics endpoint, and every asset URL must all survive the prefix.

Serves site/ through the production handler (precompression + prefix mount)
and walks the deploy checklist end to end.
"""
from __future__ import annotations

import http.server
import json
import sys
import threading
from pathlib import Path

from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))
from cookmyfridge.serve import make_handler  # noqa: E402

PREFIX = "cookmyfridge"


def main():
    results = {}
    errors = []
    server = http.server.ThreadingHTTPServer(
        ("127.0.0.1", 0), make_handler(str(ROOT / "site"), prefix=PREFIX)
    )
    threading.Thread(target=server.serve_forever, daemon=True).start()
    host = f"http://127.0.0.1:{server.server_port}"
    base = f"{host}/{PREFIX}/"
    bad_responses = []

    def check(name, condition):
        results[name] = bool(condition)

    def attach(page):
        page.on("pageerror", lambda error: errors.append(str(error)))
        page.on("console", lambda msg: errors.append(msg.text) if msg.type == "error" else None)
        page.on("response", lambda resp: bad_responses.append(f"{resp.status} {resp.url}") if resp.status >= 400 else None)

    try:
        with sync_playwright() as p:
            browser = p.chromium.launch(headless=True)
            context = browser.new_context(viewport={"width": 1280, "height": 960})
            page = context.new_page()
            attach(page)

            # --- mount-point semantics --------------------------------------
            resp = page.request.get(host + "/", max_redirects=0)
            check("/ redirects into the prefix",
                  resp.status in (301, 302) and f"/{PREFIX}/" in (resp.headers.get("location") or ""))
            resp = page.request.get(host + "/index.html", max_redirects=0)
            check("outside the prefix is 404 (like GitHub Pages)", resp.status == 404)

            # --- first screen under the prefix ------------------------------
            page.goto(base + "index.html", wait_until="networkidle")
            page.wait_for_selector(".chip[data-name]", timeout=15000)
            check("wall renders under prefix", page.locator(".chip[data-name]").count() > 100)
            nav_href = page.locator("header.site-header a").first.get_attribute("href") or ""
            check("header nav stays under prefix",
                  nav_href.startswith(f"/{PREFIX}/") or not nav_href.startswith("/"))

            # --- manifest / icons resolve under prefix ----------------------
            manifest = page.evaluate("""async () => {
                const link = document.querySelector('link[rel="manifest"]');
                const url = new URL(link.getAttribute("href"), location.href).href;
                const resp = await fetch(url);
                const body = await resp.json();
                const icons = [];
                for (const icon of (body.icons || [])) {
                    const iconUrl = new URL(icon.src, url).href;
                    icons.push({url: iconUrl, ok: (await fetch(iconUrl)).ok});
                }
                return {url, ok: resp.ok,
                        start: new URL(body.start_url, url).href,
                        scope: new URL(body.scope, url).href,
                        icons};
            }""")
            check("manifest fetched under prefix",
                  manifest["ok"] and f"/{PREFIX}/" in manifest["url"])
            check("start_url resolves under prefix",
                  manifest["start"].startswith(base))
            check("manifest scope stays inside the prefix",
                  manifest["scope"].startswith(base))
            check("every manifest icon fetchable under prefix",
                  len(manifest["icons"]) >= 3
                  and all(i["ok"] and f"/{PREFIX}/" in i["url"] for i in manifest["icons"]))

            # --- in-app navigation chain ------------------------------------
            page.click('.chip[data-name="番茄"]')
            page.click('.chip[data-name="鸡蛋"]')
            page.click("#btn-cook")
            page.wait_for_url(lambda u: "result.html" in u and f"/{PREFIX}/" in u)
            page.wait_for_selector(".recipe-card", timeout=15000)
            check("result renders under prefix", page.locator(".recipe-card").count() > 0)
            page.click(".recipe-card h3 a >> nth=0")
            page.wait_for_url(lambda u: "recipe.html" in u)
            page.wait_for_selector("#start-cooking", timeout=15000)
            check("recipe detail renders under prefix", True)

            share = page.evaluate(
                "typeof CMF.shareLink === 'function' ? CMF.shareLink(CMF.data.recipes[0]) : ''"
            )
            check("share link carries the prefix", f"/{PREFIX}/recipe.html" in share)

            # --- service worker scope + offline deep link -------------------
            page.goto(base + "index.html", wait_until="networkidle")
            page.wait_for_function("navigator.serviceWorker.controller !== null", timeout=15000)
            scope = page.evaluate("navigator.serviceWorker.controller.scriptURL")
            check("SW script served from prefix", f"/{PREFIX}/sw.js" in scope)
            reg_scope = page.evaluate(
                "navigator.serviceWorker.getRegistration().then(r => r.scope)"
            )
            check("SW scope is the prefix", reg_scope.rstrip("/").endswith(f"/{PREFIX}"))

            # Wait for precache to settle, then go offline and open a deep link.
            page.wait_for_timeout(800)
            page.reload(wait_until="networkidle")
            context.set_offline(True)
            page.goto(base + "recipe.html?id=r001", wait_until="load")
            page.wait_for_selector("#start-cooking", timeout=15000)
            check("offline deep link renders under prefix", True)

            # SW-virtual calendar endpoint under the prefix.
            cal = page.evaluate("""async () => {
                const resp = await fetch("calendar.ics");
                return {ok: resp.ok, type: resp.headers.get("content-type") || "",
                        text: await resp.text()};
            }""")
            check("calendar.ics served by SW under prefix",
                  cal["ok"] and "VCALENDAR" in cal["text"])
            context.set_offline(False)

            # The subscription URL the planner hands to calendar clients
            # must point at the prefixed endpoint (built via new URL against
            # the page location).
            page.goto(base + "planner.html", wait_until="networkidle")
            sub_url = page.evaluate(
                "new URL(CMF.CALENDAR_PATH || 'calendar.ics', location.href).href"
            )
            check("calendar subscription URL carries the prefix",
                  sub_url == base + "calendar.ics")

            # --- static page with inline boots ------------------------------
            page.goto(base + "about.html", wait_until="networkidle")
            check("about boots under prefix",
                  "CookMyFridge" in page.locator("body").inner_text())

            check("zero failed responses across the whole walk", not bad_responses)
            browser.close()
    finally:
        server.shutdown()
        server.server_close()
        payload = {"checks": results, "errors": errors}
        if bad_responses:
            payload["bad_responses"] = bad_responses[:10]
        print(json.dumps(payload, ensure_ascii=False, indent=1))
        failed = [name for name, ok in results.items() if not ok]
        if failed or errors:
            print("FAILED:", failed, "page errors:", errors)
            raise SystemExit(1)
        print(f"all {len(results)} checks passed, zero page errors")


if __name__ == "__main__":
    main()
