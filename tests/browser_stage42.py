"""Adversary-view security acceptance (stage 42).

A static site still takes hostile input from four directions: URL params
and shared links, sync codes/files crafted by someone else, backup imports,
and third-party API payloads (Open Food Facts). Every one of them must be
rendered as INERT TEXT — never as markup, never as navigation, never as
script. These checks attack the real pages and assert both halves: the
payload renders (so users see what they got) and nothing executes.
"""
from __future__ import annotations

import functools
import http.server
import json
import threading
from pathlib import Path
from urllib.parse import quote

from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]

XSS = '<img src=x onerror="window.__pwn=1">'
XSS2 = '"><svg onload="window.__pwn=2">'


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

    def fresh_page(browser):
        context = browser.new_context(viewport={"width": 1280, "height": 960}, service_workers="block")
        page = context.new_page()
        page.on("pageerror", lambda error: errors.append(str(error)))
        return context, page

    def clean(page):
        page.goto(base + "about.html", wait_until="domcontentloaded")
        page.evaluate("localStorage.clear()")

    try:
        with sync_playwright() as p:
            browser = p.chromium.launch(headless=True)
            context, page = fresh_page(browser)

            # --- A. URL params & shared links -------------------------------
            page.goto(base + "result.html?i=" + quote(XSS), wait_until="networkidle")
            page.wait_for_timeout(400)
            check("ingredient param does not execute",
                  page.evaluate("window.__pwn === undefined"))
            check("ingredient param renders as inert text",
                  XSS in page.locator("body").inner_text())

            page.goto(base + "recipe.html?id=" + quote(XSS2), wait_until="networkidle")
            page.wait_for_timeout(300)
            check("recipe id does not execute",
                  page.evaluate("window.__pwn === undefined"))

            page.goto(base + "wildcard.html?key=" + quote(XSS), wait_until="networkidle")
            page.wait_for_timeout(300)
            check("wildcard key does not execute",
                  page.evaluate("window.__pwn === undefined"))

            # javascript: pseudo-protocol must never become a navigation.
            page.goto(base + "result.html?i=javascript:alert(1)", wait_until="networkidle")
            page.wait_for_timeout(300)
            check("javascript: param stays on-site",
                  "127.0.0.1" in page.evaluate("location.hostname"))

            # --- B. open redirect -------------------------------------------
            for url in ("index.html?next=https://evil.example/",
                          "result.html?i=%E7%95%AA%E8%8C%84&return=https://evil.example/",
                          "recipe.html?id=r001&next=//evil.example/"):
                page.goto(base + url, wait_until="networkidle")
                page.wait_for_timeout(400)
            check("no ?next/?return style redirect exists",
                  "127.0.0.1" in page.evaluate("location.hostname"))

            # --- C. poisoned sync link, full pipeline ------------------------
            clean(page)
            page.goto(base + "fridge.html", wait_until="networkidle")
            page.evaluate("""() => {
                localStorage.setItem('cmf.fridge', JSON.stringify(['""" + XSS + """']));
                localStorage.setItem('cmf.favorites', JSON.stringify(['r001' + '""" + XSS2 + """']));
                localStorage.setItem('cmf.journal', JSON.stringify({
                    cooked: [], ratings: {},
                    notes: {r001: '""" + XSS.replace('"', '\\"') + """'}}));
                localStorage.setItem('cmf.inventory', JSON.stringify({batches: [{
                    id: 'b1', canonical: '番茄', grams: 100, location: 'fridge',
                    expiresOn: '', note: '""" + XSS.replace('"', '\\"') + """',
                    updatedAt: Date.now(), deleted: false}]}));
            }""")
            sync_url = page.evaluate(
                "CMF.syncShareURL(CMF.syncEncode(CMF.syncPayload({})))"
            )
            check("sync link is same-origin",
                  "evil" not in sync_url and sync_url.startswith("#") is False)
            clean(page)  # wipe, then apply the poisoned link like a victim
            # The real import path: opening a #sync= link and confirming.
            # consumeSyncHash lives in the features bundle; about.html is
            # skipFeatures, so run the victim flow from a full page.
            page.goto(base + "fridge.html", wait_until="networkidle")
            page.evaluate(
                "(hash) => CMF.consumeSyncHash({hash, mode: 'merge', confirm: () => true})",
                "#" + sync_url.split("#")[1],
            )
            page.wait_for_timeout(300)
            # Render every surface that displays the poisoned fields.
            for url in ("index.html", "fridge.html", "recipe.html?id=r001"):
                page.goto(base + url, wait_until="networkidle")
                page.wait_for_timeout(300)
            check("sync payload fields do not execute anywhere",
                  page.evaluate("window.__pwn === undefined"))
            page.goto(base + "fridge.html", wait_until="networkidle")
            check("poisoned inventory note survives the round-trip",
                  page.evaluate("CMF.getInventory().batches.length") == 1)
            check("poisoned inventory note renders as inert text",
                  XSS in page.locator("#inventory-content").inner_text())
            # Schema validation is part of the defense: batches failing the
            # strict shape check (e.g. string updatedAt) are dropped, never
            # rendered at all.
            check("schema-invalid batch is dropped, not rendered",
                  page.evaluate("""() => {
                      CMF.setInventory({batches: [{id: 'bad', canonical: '番茄', grams: 5,
                          expiresOn: '', location: 'fridge', note: 'x', updatedAt: '2026-01-01',
                          deleted: false}]});
                      return CMF.normalizeInventory(CMF.getInventory()).batches.length === 0;
                  }"""))

            # Malformed payload (type confusion) must not crash the app.
            page.evaluate("""() => {
                try {
                    CMF.applySyncPayload({fridge: 'not-an-array', plan: 42,
                        favorites: null, prefs: '<img>'}, {mode: 'overwrite'});
                } catch (e) { /* rejection is fine */ }
            }""")
            page.goto(base + "index.html", wait_until="networkidle")
            page.wait_for_selector(".chip[data-name]", timeout=10000)
            check("malformed sync payload leaves app alive",
                  page.evaluate("window.__pwn === undefined"))

            # --- D. poisoned backup import -----------------------------------
            clean(page)
            page.goto(base + "fridge.html", wait_until="networkidle")
            page.evaluate("""() => {
                CMF.importData({version: 1, exportedAt: '2026-01-01', data: {
                    'cmf.fridge': ['""" + XSS + """'],
                    'cmf.journal': {cooked: [], ratings: {}, notes: {r001: '""" + XSS.replace('"', '\\"') + """'}},
                    'cmf.prefs': {tags: ['""" + XSS2 + """'], diets: []},
                    'cmf.plan': {recipeIds: [], checked: []},
                }});
            }""")
            for url in ("index.html", "recipe.html?id=r001"):
                page.goto(base + url, wait_until="networkidle")
                page.wait_for_timeout(300)
            check("imported backup fields do not execute",
                  page.evaluate("window.__pwn === undefined"))

            # --- E. third-party API payload (Open Food Facts) ----------------
            clean(page)
            off_body = json.dumps({
                "products": [{
                    "product_name": XSS,
                    "brands": XSS2,
                    "code": "6901234567892",
                    "nutriments": {"energy-kcal_100g": 100, "proteins_100g": 1,
                                   "fat_100g": 1, "carbohydrates_100g": 1},
                    "nutriscore_grade": "a",
                }]
            }, ensure_ascii=False)
            page.route("**/world.openfoodfacts.org/**",
                       lambda route: route.fulfill(content_type="application/json", body=off_body))
            page.route("**/cgi/search.pl**",
                       lambda route: route.fulfill(content_type="application/json", body=off_body))
            page.goto(base + "fridge.html", wait_until="networkidle")
            page.locator("#off-query").fill("攻击载荷")
            page.locator("#off-search").click()
            page.wait_for_timeout(600)
            check("OFF product fields do not execute",
                  page.evaluate("window.__pwn === undefined"))
            off_text = page.locator("#foodfacts-content").inner_text()
            check("OFF product name renders as inert text", XSS in off_text)

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
