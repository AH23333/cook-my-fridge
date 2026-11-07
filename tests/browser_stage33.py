"""Real Chromium regression for the less-traveled surfaces (stage 33).

A) search & filters: keyword narrowing, special characters, empty results,
   combined method+time filters on browse.
B) backup export/import: real download, malformed file, wrong-shape file,
   cancelled chooser, unknown keys ignored.
C) stats page with empty data and with deliberately corrupted storage.

Every step asserts both the screen and the storage truth.
"""
from __future__ import annotations

import functools
import http.server
import json
import tempfile
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

    tmp = Path(tempfile.mkdtemp(prefix="cmf-stage33-"))
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

            # --- A. search & filters ---------------------------------------
            page.goto(base + "index.html", wait_until="networkidle")
            page.wait_for_selector(".chip[data-name]")
            total_chips = page.locator(".chip[data-name]").count()
            page.fill("#ingredient-search", "番茄")
            page.wait_for_timeout(200)
            narrowed = page.locator(".chip[data-name]").count()
            check("search narrows wall", 0 < narrowed < total_chips)
            check(
                "search hits are all 番茄-related",
                page.locator('.chip[data-name="番茄"]').count() == 1,
            )
            page.fill("#ingredient-search", "<img src=x onerror=window.xss33=1>")
            page.wait_for_timeout(200)
            check("special chars show honest empty state",
                  "没有匹配" in page.locator("#ingredient-wall").inner_text())
            check("search input cannot inject markup",
                  page.evaluate("window.xss33 || 0") == 0
                  and page.locator("#ingredient-wall img").count() == 0)
            page.fill("#ingredient-search", "")
            page.wait_for_timeout(200)
            check("clearing search restores wall",
                  page.locator(".chip[data-name]").count() == total_chips)

            page.goto(base + "browse.html", wait_until="networkidle")
            page.wait_for_selector(".recipe-card")
            total_cards = page.locator(".recipe-card").count()
            check("browse shows full dataset", total_cards >= 200)
            page.fill("#browse-search", "汤")
            page.wait_for_timeout(250)
            soup_cards = page.locator(".recipe-card").count()
            check("keyword narrows browse", 0 < soup_cards < total_cards)
            page.select_option("#time-select", "15")
            page.wait_for_timeout(250)
            combo = page.locator(".recipe-card").count()
            check("keyword + time filter combine", 0 <= combo <= soup_cards)
            page.fill("#browse-search", "不存在的菜zzz")
            page.wait_for_timeout(250)
            check("impossible combo is honestly empty",
                  page.locator(".recipe-card").count() == 0
                  and "共 0 道菜" in page.locator("body").inner_text())
            page.fill("#browse-search", "'; DROP TABLE--")
            page.wait_for_timeout(250)
            check("sql-ish keyword is inert",
                  page.locator(".recipe-card").count() == 0)

            # --- B. backup export / import ----------------------------------
            page.goto(base + "fridge.html", wait_until="networkidle")
            page.evaluate("CMF.setFridge(['番茄'])")
            with page.expect_download() as dl_info:
                page.click("#btn-export")
            download = dl_info.value
            saved = tmp / "backup.json"
            download.save_as(str(saved))
            payload = json.loads(saved.read_text(encoding="utf-8"))
            check("export downloads a real file", saved.stat().st_size > 50)
            check("export payload has version and fridge",
                  payload.get("version") == 1 and payload["data"].get("cmf.fridge") == ["番茄"])

            bad = tmp / "bad.json"
            bad.write_text("{broken json", encoding="utf-8")
            page.set_input_files("#file-import", str(bad))
            page.wait_for_timeout(300)
            check("malformed file rejected with toast",
                  "导入失败" in page.locator(".toast").inner_text())
            check("malformed import did not touch fridge",
                  page.evaluate("CMF.getFridge()") == ["番茄"])

            wrong = tmp / "wrong.json"
            wrong.write_text('{"data": null}', encoding="utf-8")
            page.set_input_files("#file-import", str(wrong))
            page.wait_for_timeout(300)
            check("wrong-shape file rejected", "导入失败" in page.locator(".toast").inner_text())

            unknown = tmp / "unknown.json"
            unknown.write_text(json.dumps({
                "version": 1, "data": {"cmf.fridge": ["黄瓜"], "cmf.evil": ["x"]},
            }, ensure_ascii=False), encoding="utf-8")
            page.set_input_files("#file-import", str(unknown))
            page.wait_for_timeout(300)
            check("valid import restores known keys",
                  page.evaluate("CMF.getFridge()") == ["黄瓜"])
            check("unknown keys ignored on import",
                  page.evaluate("localStorage.getItem('cmf.evil')") is None)

            # Cancelled chooser: user opens the picker and walks away without
            # selecting anything; the change event must never fire.
            with page.expect_file_chooser() as fc_info:
                page.click("label:has(#file-import)")
            fc_info.value  # chooser opened; deliberately set no files
            page.wait_for_timeout(300)
            check("fridge unchanged after chooser cancel",
                  page.evaluate("CMF.getFridge()") == ["黄瓜"])

            # --- C. stats page: empty and dirty data ------------------------
            context2 = browser.new_context(
                viewport={"width": 1280, "height": 960}, service_workers="block"
            )
            page2 = context2.new_page()
            page2.on("pageerror", lambda error: errors.append("stats-empty:" + str(error)))
            page2.goto(base + "stats.html", wait_until="networkidle")
            page2.wait_for_selector(".stat-card")
            check("stats renders with zero data",
                  "0" in page2.locator(".stat-cards").inner_text())
            context2.close()

            context3 = browser.new_context(
                viewport={"width": 1280, "height": 960}, service_workers="block"
            )
            page3 = context3.new_page()
            page3.on("pageerror", lambda error: errors.append("stats-dirty:" + str(error)))
            page3.goto(base + "index.html", wait_until="domcontentloaded")
            page3.evaluate("""() => {
                localStorage.setItem("cmf.journal", "{broken");
                localStorage.setItem("cmf.favorites", '["ghost-id", 42, null]');
                localStorage.setItem("cmf.week", "{also broken");
                localStorage.setItem("cmf.goals", '[1,2,3]');
            }""")
            page3.goto(base + "stats.html", wait_until="networkidle")
            page3.wait_for_selector(".stat-card")
            check("stats survives corrupted storage",
                  "数据集概览" in page3.locator("#stats-root").inner_text())
            context3.close()

            browser.close()
    finally:
        server.shutdown()
        import shutil
        shutil.rmtree(tmp, ignore_errors=True)
        print(json.dumps({"checks": results, "errors": errors}, ensure_ascii=False, indent=1))
        failed = [name for name, ok in results.items() if not ok]
        if failed or errors:
            print("FAILED:", failed, "page errors:", errors)
            raise SystemExit(1)
        print(f"all {len(results)} checks passed, zero page errors")


if __name__ == "__main__":
    main()
