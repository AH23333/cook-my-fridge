"""Real Chromium regression for harsh conditions (stage 37).

A) Slow 3G + 6x CPU: the ingredient wall must render from the small core
   payload while the ~2 MB AI shards keep loading in the background — no
   more sitting 53 s on a blank wall.
B) Same link: the result page shows dataset buckets early and the AI
   WILDCARD bucket fills in when its shard lands.
C) Extreme data (route-injected): 5000 recipes, emoji/special-char titles,
   ultra-long titles — rendering stays sane and escaped.
"""
from __future__ import annotations

import functools
import http.server
import json
import sys
import threading
import time
from pathlib import Path

from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
# Serve through the production negotiation handler: precompressed .br/.gz
# make the slow-3G readings match what real hosts deliver (an uncompressed
# test server overstates transfer ~4x on JS/JSON).
sys.path.insert(0, str(ROOT / "src"))
from cookmyfridge.serve import PrecompressedHandler  # noqa: E402


def main():
    results = {}
    errors = []
    server = http.server.ThreadingHTTPServer(
        ("127.0.0.1", 0), functools.partial(PrecompressedHandler, directory=str(ROOT / "site"))
    )
    threading.Thread(target=server.serve_forever, daemon=True).start()
    base = f"http://127.0.0.1:{server.server_port}/"

    def check(name, condition):
        results[name] = bool(condition)

    try:
        with sync_playwright() as p:
            browser = p.chromium.launch(headless=True)

            # --- A/B. slow 3G, 6x CPU ---------------------------------------
            context = browser.new_context(
                viewport={"width": 1280, "height": 960}, service_workers="block"
            )
            page = context.new_page()
            page.on("pageerror", lambda error: errors.append(str(error)))
            cdp = context.new_cdp_session(page)
            cdp.send("Network.enable")
            cdp.send("Network.emulateNetworkConditions", {
                "offline": False, "latency": 400,
                "downloadThroughput": 400 * 1024 // 8,
                "uploadThroughput": 400 * 1024 // 8,
            })
            cdp.send("Emulation.setCPUThrottlingRate", {"rate": 6})

            t0 = time.perf_counter()
            resp = page.goto(base + "index.html", wait_until="domcontentloaded")
            # The loading hint is a STATIC-markup guarantee, not a timing
            # race: since the head prefetch can land core.json before the
            # bundle finishes on fast links, the wall may already render
            # before domcontentloaded — reading live inner_text here was
            # asserting the old serial-wave timing, not user-visible truth.
            check("loading hint ships in static markup",
                  "正在加载" in resp.text() and 'id="ingredient-wall"' in resp.text())
            page.wait_for_selector(".chip[data-name]", timeout=30000)
            wall_s = time.perf_counter() - t0
            # Baseline 2026-11-08 (bundle split + precompressed serving):
            # ~4.5 s on this profile. Uncompressed serving read ~12.7 s —
            # the threshold keeps tripwire generosity for both worlds.
            check(f"wall renders fast on slow 3G ({wall_s:.1f}s < 15s)", wall_s < 15)
            page.click('.chip[data-name="番茄"]')
            page.click('.chip[data-name="鸡蛋"]')
            page.click("#btn-cook")
            page.wait_for_url(lambda u: "result.html" in u)
            page.wait_for_selector(".recipe-card", timeout=30000)
            cards_s = time.perf_counter() - t0
            check(f"dataset buckets early on slow 3G ({cards_s:.1f}s < 25s)", cards_s < 25)

            # AI bucket fills in later, without any user action
            deadline = time.perf_counter() + 90
            ai_filled = False
            while time.perf_counter() < deadline and not ai_filled:
                ai_filled = page.evaluate(
                    "CMF.data.ai.wildcards.length > 0 || CMF.data.ai.blindboxes.length > 0"
                )
                if not ai_filled:
                    page.wait_for_timeout(500)
            check("AI shards eventually land in background", ai_filled)
            if ai_filled:
                page.wait_for_timeout(800)  # onAiReady repaint tick
                buckets = page.locator("#buckets").inner_text()
                check("AI bucket appears after shard lands",
                      "AI WILDCARD" in buckets and "AI 创意菜" in buckets)
            context.close()

            # --- C. extreme data ---------------------------------------------
            context2 = browser.new_context(
                viewport={"width": 1280, "height": 960}, service_workers="block"
            )
            page2 = context2.new_page()
            page2.on("pageerror", lambda error: errors.append(str(error)))
            real = json.loads(
                (ROOT / "site" / "data" / "recipes.json").read_text(encoding="utf-8")
            )
            padded = list(real)
            for i in range(5000 - len(real)):
                row = dict(real[i % len(real)])
                row["id"] = f"extreme-{i}"
                row["title"] = f"压测菜{i}号"
                padded.append(row)
            padded.append({
                **dict(real[0]),
                "id": "extreme-emoji",
                "title": "🌶️🍜 <b>加辣</b> & \"招牌\" '特制'",
            })
            padded.append({
                **dict(real[0]),
                "id": "extreme-long",
                "title": "超长菜名" * 40,
            })
            body = json.dumps(padded, ensure_ascii=False)
            page2.route("**/data/recipes.json",
                        lambda route: route.fulfill(content_type="application/json", body=body))

            page2.goto(base + "browse.html", wait_until="networkidle")
            page2.wait_for_selector(".recipe-card", timeout=30000)
            check("5000+ recipes render on browse",
                  page2.locator(".recipe-card").count() >= 5000)
            check("emoji title renders literally",
                  "🌶️🍜" in page2.locator("body").inner_text())
            check("special chars escaped, not injected",
                  page2.locator(".recipe-card b", has_text="加辣").count() == 0
                  and "<b>加辣</b>" in page2.locator("body").inner_text())
            overflow = page2.evaluate(
                "document.documentElement.scrollWidth - window.innerWidth"
            )
            check("ultra-long title causes no horizontal overflow", overflow <= 1)

            page2.goto(base + "result.html?i=%E7%95%AA%E8%8C%84,%E9%B8%A1%E8%9B%8B",
                       wait_until="networkidle")
            page2.wait_for_selector(".recipe-card", timeout=30000)
            check("result search survives 5000-recipe dataset",
                  page2.locator(".recipe-card").count() > 0)
            context2.close()

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
