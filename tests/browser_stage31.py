"""Real Chromium offline & update regression (stage 31).

Two scenarios against the real service worker:
A) offline: deep link with query string must come from the precache (not the
   index fallback), and localStorage data survives the offline reload.
B) update: after the served sw.js changes its cache name, the new worker must
   install, delete the old cache, claim clients, and actually serve the new
   content — an update that never reaches the user is not an update.
"""
from __future__ import annotations

import functools
import http.server
import json
import re
import shutil
import tempfile
import threading
from pathlib import Path

from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]


class Quiet(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *args):
        pass


def serve(directory):
    server = http.server.ThreadingHTTPServer(
        ("127.0.0.1", 0), functools.partial(Quiet, directory=str(directory))
    )
    threading.Thread(target=server.serve_forever, daemon=True).start()
    return server, f"http://127.0.0.1:{server.server_port}/"


def main():
    results = {}
    errors = []

    def check(name, condition):
        results[name] = bool(condition)

    server_a, base_a = serve(ROOT / "site")
    try:
        with sync_playwright() as p:
            browser = p.chromium.launch(headless=True)

            # --- A. offline deep link -------------------------------------
            context = browser.new_context(viewport={"width": 1280, "height": 960})
            page = context.new_page()
            page.on("pageerror", lambda error: errors.append(str(error)))
            page.goto(base_a + "index.html", wait_until="networkidle")
            page.evaluate("navigator.serviceWorker.ready.then(() => {})")
            page.wait_for_function("!!navigator.serviceWorker.ready", timeout=15000)
            # First load installs; reload so the SW actually controls the page.
            page.reload(wait_until="networkidle")
            page.wait_for_function("!!navigator.serviceWorker.controller", timeout=15000)
            check("sw controls page", True)

            page.click('.chip[data-name="番茄"]')
            check("fridge saved before offline", page.evaluate("CMF.getFridge()") == ["番茄"])

            context.set_offline(True)
            page.goto(base_a + "recipe.html?id=r001", wait_until="load")
            page.wait_for_selector("article.detail h1", timeout=10000)
            title = page.locator("article.detail h1").inner_text()
            check("offline deep link renders recipe, not fallback", "番茄炒蛋" in title)
            check("fridge survives offline reload", page.evaluate("CMF.getFridge()") == ["番茄"])
            context.set_offline(False)
            context.close()

            # --- B. SW update: old cache cleaned, new content served --------
            tmp = Path(tempfile.mkdtemp(prefix="cmf-stage31-"))
            try:
                shutil.copytree(ROOT / "site", tmp, dirs_exist_ok=True)
                server_b, base_b = serve(tmp)
                try:
                    context = browser.new_context(viewport={"width": 1280, "height": 960})
                    page = context.new_page()
                    page.on("pageerror", lambda error: errors.append(str(error)))
                    page.goto(base_b + "index.html", wait_until="networkidle")
                    page.wait_for_function("!!navigator.serviceWorker.ready", timeout=15000)
                    page.reload(wait_until="networkidle")
                    page.wait_for_function("!!navigator.serviceWorker.controller", timeout=15000)
                    caches_v1 = page.evaluate("caches.keys()")
                    check("v1 cache present", any(k.startswith("cmf-cache-") for k in caches_v1))

                    # Ship a new version: new cache name + visible marker.
                    sw_path = tmp / "sw.js"
                    sw_text = sw_path.read_text(encoding="utf-8")
                    sw_path.write_text(
                        re.sub(r"cmf-cache-[^\"']+", "cmf-cache-testv2", sw_text),
                        encoding="utf-8",
                    )
                    index_path = tmp / "index.html"
                    index_path.write_text(
                        index_path.read_text(encoding="utf-8").replace(
                            "</body>", '<div id="v2-marker" hidden></div></body>'
                        ),
                        encoding="utf-8",
                    )

                    page.evaluate(
                        "navigator.serviceWorker.getRegistration().then(r => r && r.update())"
                    )
                    # NOTE: wait_for_function does not reliably await a
                    # promise-returning expression (it passed instantly while
                    # the predicate was still false — observed). Poll from
                    # Python with real evaluate round-trips instead.
                    # The switch signal is the OLD cache disappearing: that
                    # only happens in the new worker's activate handler.
                    import time as _time
                    deadline = _time.time() + 20
                    caches_now = []
                    while _time.time() < deadline:
                        caches_now = page.evaluate("caches.keys()")
                        if "cmf-cache-testv2" in caches_now and not any(
                            k.startswith("cmf-cache-") and k != "cmf-cache-testv2"
                            for k in caches_now
                        ):
                            break
                        _time.sleep(0.25)
                    page.reload(wait_until="networkidle")
                    page.wait_for_function("!!navigator.serviceWorker.controller", timeout=15000)
                    caches_v2 = page.evaluate("caches.keys()")
                    old_left = [k for k in caches_v2 if k.startswith("cmf-cache-") and k != "cmf-cache-testv2"]
                    check("old cache deleted after update", not old_left)
                    check("new cache is the active one", "cmf-cache-testv2" in caches_v2)
                    html = page.evaluate("document.documentElement.outerHTML")
                    check("new content actually served", 'id="v2-marker"' in html)
                    # Deeper truth: the new cache itself must hold fresh bytes,
                    # not stale copies forwarded by the old worker's handler.
                    precached = page.evaluate("""(async () => {
                        const c = await caches.open("cmf-cache-testv2");
                        const idx = await c.match("index.html");
                        return idx ? (await idx.text()).includes('id="v2-marker"') : null;
                    })()""")
                    check("new precache holds fresh bytes", precached is True)
                    context.close()
                finally:
                    server_b.shutdown()
            finally:
                shutil.rmtree(tmp, ignore_errors=True)

            browser.close()
    finally:
        server_a.shutdown()
        print(json.dumps({"checks": results, "errors": errors}, ensure_ascii=False, indent=1))
        failed = [name for name, ok in results.items() if not ok]
        if failed or errors:
            print("FAILED:", failed, "page errors:", errors)
            raise SystemExit(1)
        print(f"all {len(results)} checks passed, zero page errors")


if __name__ == "__main__":
    main()
