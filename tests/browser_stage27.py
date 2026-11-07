"""Real-browser gate for stage 27 (seasonal, weather, voice, journal, costs,
tools, Open Food Facts, storage encyclopedia). Serves site/ locally, drives
Chromium through Playwright, saves screenshots, prints a JSON report and exits
1 on any failed assertion or console error.
"""
from __future__ import annotations

import functools
import http.server
import json
import threading
from pathlib import Path

from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1] / "site"
SHOTS = Path(__file__).resolve().parents[1] / "screenshots" / "stage27"
SHOTS.mkdir(parents=True, exist_ok=True)
PAGES = [
    "index.html", "result.html?i=%E7%95%AA%E8%8C%84,%E9%B8%A1%E8%9B%8B",
    "recipe.html?id=r001", "wildcard.html?blind=1", "fridge.html",
    "about.html", "browse.html", "planner.html", "stats.html",
]


class Quiet(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *args):
        pass


server = http.server.ThreadingHTTPServer(
    ("127.0.0.1", 0), functools.partial(Quiet, directory=str(ROOT))
)
port = server.server_address[1]
threading.Thread(target=server.serve_forever, daemon=True).start()
BASE = f"http://127.0.0.1:{port}/"

results: dict[str, bool] = {}
console_errors: list[str] = []
failures: list[str] = []


def check(name, cond):
    results[name] = bool(cond)
    if not cond:
        failures.append(name)


def attach(page):
    def on_console(msg):
        if msg.type != "error":
            return
        text = msg.text
        if "favicon" in text.lower() or "404" in text:
            return
        # Live external APIs may be unreachable in CI; the UI must degrade,
        # not throw. Network-level fetch failures are not app console errors.
        if "openfoodfacts" in text.lower() or "open-meteo" in text.lower():
            return
        if "Failed to fetch" in text or "NetworkError" in text:
            return
        console_errors.append(f"{page.url}: {text}")
    page.on("console", on_console)
    page.on("pageerror", lambda err: console_errors.append(f"{page.url}: {err}"))


with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    context = browser.new_context(viewport={"width": 1280, "height": 900})
    page = context.new_page()
    attach(page)

    # 1. Nine pages render without JS errors with the new global modules.
    for url in PAGES:
        page.goto(BASE + url, wait_until="networkidle", timeout=20000)
        page.wait_for_selector("header.site-header", timeout=10000)
        check("render " + url.split("?")[0], page.locator("main.container").count() >= 1)
    check("no console errors", not console_errors)

    # 2. Homepage: seasonal banner + weather card + manual weather picker.
    page.goto(BASE + "index.html", wait_until="networkidle")
    page.wait_for_selector(".seasonal-banner")
    check("seasonal term shown", bool(page.inner_text(".seasonal-term").strip()))
    check("seasonal chips present", page.locator(".seasonal-chips .chip").count() >= 1)
    page.locator(".seasonal-chips .chip").first.click()
    fridge_after = page.evaluate("JSON.parse(localStorage.getItem('cmf.fridge')||'[]')")
    check("seasonal chip adds to fridge", len(fridge_after) >= 1)
    page.wait_for_selector(".weather-card")
    check("weather source credited", "Open-Meteo" in page.inner_text(".weather-card"))
    page.select_option("#weather-kind", "hot")
    page.wait_for_selector(".weather-pick")
    check("manual weather picks", page.locator(".weather-pick").count() >= 1)
    check("weather advice shown", bool(page.inner_text(".weather-advice").strip()))
    # Headless Chromium has no SpeechRecognition: button must hide, not crash.
    voice_visible = page.locator("#nl-voice").is_visible()
    voice_supported = page.evaluate("typeof CMF.voiceSupported === 'function' && CMF.voiceSupported()")
    check("voice button matches support", voice_visible == bool(voice_supported))
    page.screenshot(path=str(SHOTS / "01-home.png"), full_page=True)

    # 3. Browse: seasonal filter narrows the grid.
    page.goto(BASE + "browse.html", wait_until="networkidle")
    page.wait_for_selector("#browse-grid .recipe-card")
    before = page.locator("#browse-grid .recipe-card").count()
    page.wait_for_selector("#filter-seasonal .filter-chip")
    page.click("#filter-seasonal .filter-chip")
    page.wait_for_timeout(200)
    after = page.locator("#browse-grid .recipe-card").count()
    check("seasonal chip toggles on", "on" in (page.get_attribute("#filter-seasonal .filter-chip", "class") or ""))
    check("seasonal filter narrows", 0 < after <= before)
    page.screenshot(path=str(SHOTS / "02-browse-seasonal.png"), full_page=True)

    # 4. Recipe detail: cost line + journal check-in persists.
    page.goto(BASE + "recipe.html?id=r001", wait_until="networkidle")
    page.wait_for_selector(".cost-line")
    check("cost line estimated", "估算成本" in page.inner_text(".cost-line"))
    page.wait_for_selector(".journal-panel")
    page.click('.star-btn[data-star="4"]')
    page.fill("#journal-note", "浏览器实测：好吃，下次少盐。")
    page.click("#journal-log")
    page.wait_for_timeout(200)
    journal = page.evaluate("JSON.parse(localStorage.getItem('cmf.journal')||'null')")
    check("journal entry logged", bool(journal and len(journal["cooked"]) >= 1))
    check("journal rating saved", journal["ratings"].get("r001") == 4)
    check("journal note saved", "好吃" in journal["notes"].get("r001", ""))
    check("journal snapshot kcal", isinstance(journal["cooked"][0].get("kcal"), (int, float)))
    check("journal count shown", "做过 1 次" in page.inner_text(".journal-count"))
    page.screenshot(path=str(SHOTS / "03-recipe-journal.png"), full_page=True)

    # 5. Ingredient modal: storage encyclopedia row.
    page.locator(".ing-name-btn").first.click()
    page.wait_for_selector(".modal")
    check("modal storage row", "储存" in page.inner_text(".modal"))
    page.screenshot(path=str(SHOTS / "04-ingredient-modal.png"))
    page.click(".modal-close")

    # 6. Fridge: kitchen tools convert offline; foodfacts validates barcode.
    page.goto(BASE + "fridge.html", wait_until="networkidle")
    page.wait_for_selector("#tools-content .tools-box")
    page.fill("#tool-vol", "2")
    page.select_option("#tool-unit", "杯")
    page.select_option("#tool-ing", "面粉")
    page.wait_for_timeout(150)
    vol_out = page.inner_text("#tool-vol-out")
    check("tools volume ml", "480 ml" in vol_out)
    check("tools flour grams", "264 g" in vol_out)
    page.fill("#tool-temp", "350")
    page.select_option("#tool-temp-unit", "F")
    page.wait_for_timeout(150)
    check("tools temp conversion", "177 °C" in page.inner_text("#tool-temp-out"))
    check("baking subs table", page.locator(".subs-table tbody tr").count() == 8)
    page.wait_for_selector("#foodfacts-content .off-box")
    check("off attribution", "Open Food Facts" in page.inner_text(".off-box"))
    page.fill("#off-barcode", "abc")
    page.click("#off-lookup")
    page.wait_for_timeout(150)
    check("off barcode validation", "8–14 位数字" in page.inner_text("#off-status"))
    page.screenshot(path=str(SHOTS / "05-fridge-tools.png"), full_page=True)

    # 7. Stats: achievements, streak and savings render after the check-in.
    page.goto(BASE + "stats.html", wait_until="networkidle")
    page.wait_for_selector(".badge-grid")
    check("achievements rendered", page.locator(".badge-card").count() == 9)
    check("first badge earned", page.locator(".badge-card.earned").count() >= 1)
    check("streak card", "当前连击" in page.inner_text("#stats-root"))
    check("savings card", page.locator(".savings-card").count() == 1)
    check("weekly trend", page.locator(".trend-col").count() == 7)
    page.screenshot(path=str(SHOTS / "06-stats-achievements.png"), full_page=True)

    page.goto(BASE + "recipe.html?id=r001", wait_until="networkidle")
    hostile = '<img src="x" onerror="window.journalInjected=true">'
    page.evaluate("""markup => CMF.importData({version: 1, data: {
        'cmf.journal': {cooked: [], ratings: {r001: markup}, notes: {r001: markup}}
    }})""", hostile)
    page.reload(wait_until="networkidle")
    check("imported rating cannot insert elements", page.locator(".journal-panel img").count() == 0)
    check("imported markup never executes", not page.evaluate("Boolean(window.journalInjected)"))
    check("imported note remains literal text", page.input_value("#journal-note") == hostile)
    page.evaluate("CMF.applySyncPayload({d: {j: []}}, {mode: 'replace'})")
    page.reload(wait_until="networkidle")
    check("malformed journal still renders", page.locator("#journal-log").count() == 1)

    page.fill("#journal-note", "保存失败时保留的草稿")
    before_quota = page.evaluate("localStorage.getItem('cmf.journal')")
    page.evaluate("""() => {
        window.originalSetItem = Storage.prototype.setItem;
        Storage.prototype.setItem = function(key, value) {
            if (key === 'cmf.journal') throw new DOMException('full', 'QuotaExceededError');
            return window.originalSetItem.call(this, key, value);
        };
    }""")
    page.click("#journal-log")
    check("quota failure preserves draft", page.input_value("#journal-note") == "保存失败时保留的草稿")
    check("quota failure preserves stored value", page.evaluate("localStorage.getItem('cmf.journal')") == before_quota)
    check("quota failure is reported", "保存失败" in page.inner_text("body"))
    page.evaluate("() => { Storage.prototype.setItem = window.originalSetItem; }")
    page.click("#journal-log")
    check("journal retry persists draft", page.evaluate("CMF.getJournal().notes.r001") == "保存失败时保留的草稿")

    context.add_init_script("""(() => {
        window.scanMode = 'detect';
        window.scanStops = 0;
        window.scanDetects = 0;
        window.BarcodeDetector = class {
            async detect() {
                window.scanDetects++;
                if (window.scanMode === 'detect') throw new Error('frame unavailable');
                return [{rawValue: '12345678'}];
            }
        };
        Object.defineProperty(navigator.mediaDevices, 'getUserMedia', {
            configurable: true,
            value: async () => {
                if (window.scanMode === 'denied') throw new Error('permission denied');
                const stream = new MediaStream();
                stream.getTracks = () => [{stop() { window.scanStops++; }}];
                return stream;
            },
        });
        HTMLMediaElement.prototype.play = async function() {
            if (window.scanMode === 'play') throw new Error('play failed');
        };
    })();""")
    page.route("https://world.openfoodfacts.org/**", lambda route: route.fulfill(
        status=200, content_type="application/json",
        headers={"Access-Control-Allow-Origin": "*"},
        body=json.dumps({"status": 1, "product": {"code": "12345678", "product_name": "测试食品",
            "nutriments": {"energy-kcal_100g": 100, "proteins_100g": 3}}})))
    page.goto(BASE + "fridge.html", wait_until="networkidle")
    for mode in ("play", "detect", "denied", "found"):
        page.evaluate("""mode => {
            window.scanMode = mode; window.scanStops = 0; window.scanDetects = 0;
        }""", mode)
        page.click("#off-scan")
        page.wait_for_function("!document.getElementById('off-scan').disabled")
        stops = page.evaluate("window.scanStops")
        check("camera cleanup " + mode, stops == (0 if mode == "denied" else 1))
        if mode == "found":
            page.wait_for_selector(".off-product")
            check("scan result uses barcode lookup", "测试食品" in page.inner_text("#off-results"))
        else:
            check("camera error keeps manual fallback " + mode, "请手动输入条码" in page.inner_text("#off-status"))
        if mode == "detect":
            check("camera test reached detector", page.evaluate("window.scanDetects") == 1)
    page.evaluate("CMF.showIngredientInfo('木耳')")
    page.wait_for_selector(".modal")
    check("storage modal has no dry-food fridge year", "365" not in page.inner_text(".modal"))
    check("storage modal preserves soaked-food warning", "泡发后当天吃" in page.inner_text(".modal"))
    page.click(".modal-close")

    page.set_viewport_size({"width": 390, "height": 844})
    for url in ("index.html", "fridge.html", "recipe.html?id=r001", "stats.html"):
        page.goto(BASE + url, wait_until="networkidle")
        check("mobile width " + url.split("?")[0], page.evaluate(
            "document.documentElement.scrollWidth <= window.innerWidth"))

    check("no console errors after interactions", not console_errors)
    browser.close()

server.shutdown()
print(json.dumps({
    "ok": not failures and not console_errors,
    "checks": len(results),
    "failures": failures,
    "console_errors": console_errors[:10],
    "screenshots": str(SHOTS),
}, ensure_ascii=False))
if failures or console_errors:
    raise SystemExit(1)