"""Real Chromium coverage for batch inventory and confirmed recipe deductions."""
from __future__ import annotations

import functools
import http.server
import json
import threading
from pathlib import Path

from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
SHOTS = ROOT / "screenshots" / "stage28"
# 长面板的 locator 截图会把吸顶导航叠进内容里，只截图时隐藏，不改产品样式。
HEADER_MASK = ".site-header { visibility: hidden !important; }"


class Quiet(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *args):
        pass


def main():
    SHOTS.mkdir(parents=True, exist_ok=True)
    results = {}
    errors = []
    server = http.server.ThreadingHTTPServer(
        ("127.0.0.1", 0), functools.partial(Quiet, directory=str(ROOT / "site"))
    )
    threading.Thread(target=server.serve_forever, daemon=True).start()
    base = f"http://127.0.0.1:{server.server_port}/"

    def check(name, condition):
        results[name] = bool(condition)

    def attach(page):
        page.on("pageerror", lambda error: errors.append(str(error)))
        page.on("console", lambda msg: errors.append(msg.text) if msg.type == "error" else None)

    try:
        with sync_playwright() as p:
            browser = p.chromium.launch(headless=True)
            context = browser.new_context(viewport={"width": 1280, "height": 960}, service_workers="block")
            page = context.new_page()
            attach(page)
            page.goto(base + "fridge.html", wait_until="networkidle")
            page.wait_for_selector("#inventory-content form")
            check("inventory mounts", page.locator("#inventory-content form").count() == 1)
            ledger = page.locator("#inventory-content")
            check("empty ledger invites entry", "没有符合条件" in ledger.inner_text())
            dates = page.evaluate("""() => {
                const day = offset => { const d = new Date(); d.setDate(d.getDate() + offset); return CMF.localDay(d); };
                return {yesterday: day(-1), tomorrow: day(1), later: day(5)};
            }""")

            def add(name, grams, expires="", note="", location="fridge"):
                if not ledger.locator(".inventory-editor").evaluate("el => el.open"):
                    ledger.locator(".inventory-editor > summary").click()
                ledger.locator('[name="canonical"]').fill(name)
                ledger.locator('[name="grams"]').fill(str(grams))
                ledger.locator('[name="expiresOn"]').fill(expires)
                ledger.locator('[name="location"]').select_option(location)
                ledger.locator('[name="note"]').fill(note)
                ledger.locator('button[type="submit"]').click()

            def batches():
                return page.evaluate("CMF.normalizeInventory(CMF.getInventory()).batches")

            def quantities():
                return {b["id"]: b["grams"] for b in batches()}

            def inventory_message():
                return ledger.locator("[data-inventory-message]").inner_text()

            add("西红柿", 300, dates["tomorrow"], "第一批，优先用")
            check("alias becomes canonical", batches()[0]["canonical"] == "番茄")
            check("new batch does not silently change recipe selection", page.evaluate("CMF.getFridge().length") == 0)
            add("番茄", 400, dates["later"], '<img src=x onerror="window.inventoryXss=1">')
            add("番茄", 100, dates["yesterday"], "过期不扣")
            add("鸡蛋", 200, "", "无日期，需自行确认", "pantry")
            check("four independent batches", len(batches()) == 4)
            check("notes remain literal text", '<img src=x' in ledger.inner_text() and ledger.locator("img").count() == 0)
            check("notes do not execute", page.evaluate("window.inventoryXss || 0") == 0)
            check("counts separate expired due and undated", page.evaluate("CMF.inventorySummary(CMF.getInventory())") == {
                "active": 4, "expired": 1, "due": 1, "undated": 1, "grams": 1000
            })
            for value in ("due", "expired", "undated"):
                ledger.locator("[data-inventory-filter]").select_option(value)
                check("filter " + value, ledger.locator(".inventory-row").count() == 1)
            ledger.locator("[data-inventory-filter]").select_option("active")
            ledger.locator("[data-inventory-search]").fill("西红柿")
            check("search understands aliases", ledger.locator(".inventory-row").count() == 3)
            ledger.locator("[data-inventory-search]").fill("不存在的食材")
            check("empty filter result", ledger.locator(".inventory-row").count() == 0)
            ledger.locator("[data-inventory-search]").fill("")

            before = quantities()
            add("不存在的食材", 10)
            check("unknown ingredient rejected without writing", quantities() == before and "保存失败" in inventory_message())
            check("failed add retains draft", ledger.locator('[name="canonical"]').input_value() == "不存在的食材")
            ledger.locator('[name="canonical"]').fill("番茄")
            ledger.locator('[name="grams"]').fill("")
            ledger.locator('button[type="submit"]').click()
            check("empty grams not coerced to zero", quantities() == before and "保存失败" in inventory_message())
            page.once("dialog", lambda dialog: dialog.accept())
            ledger.locator("[data-inventory-cancel]").click()

            first_row = ledger.locator(".inventory-row").filter(has_text="第一批")
            first_row.locator("[data-inventory-edit]").click()
            ledger.locator('[name="grams"]').fill("350")
            page.evaluate("""() => {
                window.realSetItem = Storage.prototype.setItem;
                Storage.prototype.setItem = function(k,v) {
                    if (k === 'cmf.inventory') throw new DOMException('quota', 'QuotaExceededError');
                    return window.realSetItem.call(this,k,v);
                };
            }""")
            ledger.locator('button[type="submit"]').click()
            check("failed edit keeps all stored quantities", quantities() == before)
            check("failed edit keeps draft", ledger.locator('[name="grams"]').input_value() == "350")
            page.evaluate("() => { Storage.prototype.setItem = window.realSetItem; }")
            ledger.locator('button[type="submit"]').click()
            check("edit can retry after quota failure", any(b["note"] == "第一批，优先用" and b["grams"] == 350 for b in batches()))
            ledger.locator("[data-inventory-add-fridge]").click()
            check("available stock added to recipe selection", set(page.evaluate("CMF.getFridge()")) == {"番茄", "鸡蛋"})
            total_before_clear = quantities()
            page.locator("#btn-clear-fridge").click()
            check("clearing recipe selection preserves stock", quantities() == total_before_clear)

            ledger = page.locator("#inventory-content")
            egg_row = ledger.locator(".inventory-row").filter(has_text="鸡蛋")
            egg_row.locator("[data-inventory-edit]").click()
            ledger.locator('[name="grams"]').fill("0")
            ledger.locator('button[type="submit"]').click()
            ledger.locator("[data-inventory-filter]").select_option("empty")
            check("zero stock has used-up filter", ledger.locator(".inventory-row").count() == 1)
            page.once("dialog", lambda dialog: dialog.dismiss())
            ledger.locator("[data-inventory-remove]").click()
            check("removal cancellation preserves batch", ledger.locator(".inventory-row").count() == 1)
            page.once("dialog", lambda dialog: dialog.accept())
            ledger.locator("[data-inventory-remove]").click()
            check("removal hides batch and retains tombstone", ledger.locator(".inventory-row").count() == 0 and any(b["deleted"] for b in batches()))
            ledger.locator("[data-inventory-filter]").select_option("active")
            ledger.locator(".inventory-editor > summary").click()
            ledger.screenshot(path=str(SHOTS / "01-inventory-desktop.png"), style=HEADER_MASK)
            page.set_viewport_size({"width": 390, "height": 844})
            ledger.screenshot(path=str(SHOTS / "02-inventory-mobile.png"), style=HEADER_MASK)
            check("ledger fits mobile viewport", page.evaluate("document.documentElement.scrollWidth <= innerWidth"))
            page.set_viewport_size({"width": 1280, "height": 960})

            saved = page.evaluate("CMF.exportData()")
            sync = page.evaluate("CMF.syncEncode(CMF.syncPayload({}))")
            check("backup includes ledger", len(saved["data"]["cmf.inventory"]["batches"]) == 4)
            page.evaluate("localStorage.removeItem('cmf.inventory')")
            page.evaluate("payload => CMF.importData(payload)", saved)
            check("backup restores quantities", quantities() == {b["id"]: b["grams"] for b in saved["data"]["cmf.inventory"]["batches"]})
            before = quantities()
            page.evaluate("code => CMF.applySyncPayload(CMF.syncDecode(code), {mode:'merge'})", sync)
            check("sync roundtrip is idempotent", quantities() == before)
            check("QR omits ledger", page.evaluate("CMF.syncPayload({slim:true}).d.inv === undefined"))

            page.goto(base + "recipe.html?id=r001", wait_until="networkidle")
            page.wait_for_selector(".inventory-use-form")
            use = page.locator("#recipe-inventory")
            tomato = use.locator(".inventory-use-row").filter(has=page.get_by_role("checkbox", name="番茄", exact=True))
            check("available required ingredient defaults selected", tomato.locator(".inventory-use-check").is_checked())
            check("no available stock not preselected", not use.get_by_role("checkbox", name="鸡蛋", exact=True).is_checked())
            check("vague quantities stay empty", all(row.locator(".inventory-use-grams").input_value() == "" and not row.locator(".inventory-use-check").is_checked()
                for row in use.locator(".inventory-use-row").all() if "用量待实称" in row.inner_text()))
            for checkbox in use.locator(".inventory-use-check").all():
                checkbox.uncheck()
            use.locator("[data-use-preview]").click()
            check("nothing selected does not commit", use.locator("[data-use-commit]").count() == 0)
            tomato.locator(".inventory-use-check").check()
            tomato.locator(".inventory-use-grams").fill("900")
            before = quantities()
            use.locator("[data-use-preview]").click()
            check("shortage cannot partially deduct", "短缺 150 克" in use.inner_text() and quantities() == before and use.locator("[data-use-commit]").count() == 0)
            check("expired stock explicitly excluded", "已排除过期 100 克" in use.inner_text())
            tomato.locator(".inventory-use-grams").fill("500")
            use.locator("[data-use-preview]").click()
            check("preview alone does not deduct", quantities() == before and use.locator("[data-use-commit]").count() == 1)
            tomato.locator(".inventory-use-grams").fill("510")
            check("changing amount invalidates preview", use.locator("[data-use-commit]").count() == 0)
            tomato.locator(".inventory-use-grams").fill("500")
            use.locator("[data-use-preview]").click()
            use.locator(".inventory-allocations summary").click()
            # Allocation rows print raw batch UUIDs (random per run) and
            # today-relative expiry dates (shift daily) — the baseline
            # screenshots flapped on both. Swap in stable placeholders for
            # the screenshot only (display-level, logic untouched).
            use.evaluate("""(el) => {
                const ids = new Map(), days = new Map();
                el.querySelectorAll("*").forEach((n) => {
                    n.childNodes.forEach((t) => {
                        if (t.nodeType !== 3) return;
                        t.textContent = t.textContent
                            .replace(
                                /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g,
                                (m) => {
                                    if (!ids.has(m)) ids.set(m, `批次#${ids.size + 1}`);
                                    return ids.get(m);
                                }
                            )
                            .replace(/\\d{4}-\\d{2}-\\d{2}/g, (m) => {
                                if (!days.has(m)) days.set(m, `日期${"ABCDEF"[days.size]}`);
                                return days.get(m);
                            });
                    });
                });
            }""")
            use.screenshot(path=str(SHOTS / "03-deduction-preview.png"), style=HEADER_MASK)
            page.set_viewport_size({"width": 390, "height": 844})
            use.screenshot(path=str(SHOTS / "04-deduction-mobile.png"), style=HEADER_MASK)
            check("deduction preview fits mobile", page.evaluate("document.documentElement.scrollWidth <= innerWidth"))
            page.set_viewport_size({"width": 1280, "height": 960})

            other = context.new_page()
            attach(other)
            other.goto(base + "fridge.html", wait_until="networkidle")
            other.evaluate("""() => {
                const b = CMF.normalizeInventory(CMF.getInventory()).batches.find(b => b.note === '第一批，优先用');
                CMF.upsertInventoryBatch({...b, note: b.note + '（已核对）'}, b);
            }""")
            use.locator("[data-use-commit]").click()
            check("stale preview refused across tabs", quantities() == before and "库存或日期已变化" in use.inner_text())
            check("stale preview retains requested grams", tomato.locator(".inventory-use-grams").input_value() == "500")
            use.locator("[data-use-preview]").click()
            page.evaluate("""() => {
                window.realSetItem = Storage.prototype.setItem;
                Storage.prototype.setItem = function(k,v) {
                    if (k === 'cmf.inventory') throw new DOMException('quota', 'QuotaExceededError');
                    return window.realSetItem.call(this,k,v);
                };
            }""")
            use.locator("[data-use-commit]").click()
            check("deduction quota failure preserves stock", quantities() == before and "扣减失败" in use.inner_text())
            page.evaluate("() => { Storage.prototype.setItem = window.realSetItem; }")
            use.locator("[data-use-preview]").click()
            journal_before = page.evaluate("CMF.getJournal()")
            use.locator("[data-use-commit]").click()
            check("successful deduction follows expiry order", any(b["note"].startswith("第一批") and b["grams"] == 0 for b in batches())
                and any(b["note"].startswith("<img") and b["grams"] == 250 for b in batches()))
            check("expired batch untouched", any(b["note"] == "过期不扣" and b["grams"] == 100 for b in batches()))
            check("deduction does not create journal entry", page.evaluate("CMF.getJournal()") == journal_before)
            check("success removes repeat confirmation", use.locator("[data-use-commit]").count() == 0 and not use.locator("[data-use-preview]").is_visible())
            check("focus goes to undo", use.locator("[data-use-undo]").evaluate("el => el === document.activeElement"))
            use.locator("[data-use-undo]").click()
            check("undo restores exact quantities", quantities() == before)
            check("undo clears selected items", all(not cb.is_checked() for cb in use.locator(".inventory-use-check").all()))

            tomato.locator(".inventory-use-check").check()
            use.locator("[data-use-preview]").click()
            use.locator("[data-use-commit]").click()
            other.evaluate("""() => {
                const b = CMF.normalizeInventory(CMF.getInventory()).batches.find(b => b.note.startsWith('<img'));
                CMF.upsertInventoryBatch({...b, grams: 240}, b);
            }""")
            after_edit = quantities()
            use.locator("[data-use-undo]").click()
            check("undo cannot overwrite later edits", quantities() == after_edit and "已有后续变动" in use.inner_text())
            stock_before_journal = quantities()
            page.locator("#journal-log").click()
            check("journal remains independent of stock", quantities() == stock_before_journal and len(page.evaluate("CMF.getJournal().cooked")) == 1)
            page.locator('.factor-btn[data-factor="2"]').click()
            scaled_needs = page.evaluate("CMF.inventoryRecipeNeeds(CMF.data.recipes.find(r => r.id === 'r001'), 2)")
            check("factor change refreshes deduction amounts", float(page.get_by_role("spinbutton", name="番茄扣减克数", exact=True).input_value()) == next(n["grams"] for n in scaled_needs if n["canonical"] == "番茄"))

            page.goto(base + "fridge.html", wait_until="networkidle")
            ledger = page.locator("#inventory-content")
            edit_row = ledger.locator(".inventory-row").filter(has_text="<img")
            edit_row.locator("[data-inventory-edit]").click()
            ledger.locator('[name="grams"]').fill("230")
            other.evaluate("""() => {
                const b = CMF.normalizeInventory(CMF.getInventory()).batches.find(b => b.note.startsWith('<img'));
                CMF.upsertInventoryBatch({...b, grams: 220}, b);
            }""")
            ledger.locator('button[type="submit"]').click()
            check("edit conflict preserves newer batch", any(b["note"].startswith("<img") and b["grams"] == 220 for b in batches()) and "已被修改" in inventory_message())
            check("edit conflict retains draft", ledger.locator('[name="grams"]').input_value() == "230")
            other.close()

            offline = browser.new_context(viewport={"width": 390, "height": 844})
            cached = offline.new_page()
            attach(cached)
            cached.goto(base + "fridge.html", wait_until="networkidle")
            cached.evaluate("async () => { await navigator.serviceWorker.ready; }")
            cached.reload(wait_until="networkidle")
            cached.wait_for_function("navigator.serviceWorker.controller !== null")
            check("inventory scripts precached", cached.evaluate("""async () => !!(await caches.match('js/bundle-features.js')) && !!(await caches.match('js/bundle-boot.js'))"""))
            offline.set_offline(True)
            cached.goto(base + "fridge.html", wait_until="load")
            cached.wait_for_selector("#inventory-content form")
            cached.locator('#inventory-content [name="canonical"]').fill("鸡蛋")
            cached.locator('#inventory-content [name="grams"]').fill("120")
            cached.locator('#inventory-content button[type="submit"]').click()
            check("offline batch write works", cached.evaluate("CMF.getInventory().batches[0].grams") == 120)
            cached.goto(base + "recipe.html?id=r001", wait_until="load")
            cached.wait_for_selector(".inventory-use-form")
            check("offline deduction form works", cached.get_by_role("checkbox", name="鸡蛋", exact=True).is_checked())
            browser.close()
    except Exception as error:
        errors.append(type(error).__name__ + ": " + str(error))
    finally:
        server.shutdown()
        server.server_close()
    failures = [name for name, passed in results.items() if not passed]
    print(json.dumps({"checks": len(results), "failures": failures, "console_errors": errors}, ensure_ascii=False))
    return 1 if failures or errors else 0


if __name__ == "__main__":
    raise SystemExit(main())
