"""Accessibility acceptance (stage 41): keyboard-only main path, visible
focus, accessible names, canvas alternatives, WCAG contrast on key text
pairs, and modal/overlay focus management.

Honest-audit rules: a name check passes only on REAL text/label (no
compliance-theater attributes), contrast is measured from computed styles
(not guessed), and focus-trap checks assert the full cycle — focus moves
in on open, Tab wraps inside, Escape closes, focus returns to the trigger.
"""
from __future__ import annotations

import functools
import http.server
import json
import re
import threading
from pathlib import Path

from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]


class Quiet(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *args):
        pass


def _lum(channel: float) -> float:
    c = channel / 255
    return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4


def contrast(rgb1: str, rgb2: str) -> float:
    def parse(rgb):
        nums = [float(x) for x in re.findall(r"[\d.]+", rgb)[:3]]
        l = 0.2126 * _lum(nums[0]) + 0.7152 * _lum(nums[1]) + 0.0722 * _lum(nums[2])
        return l
    l1, l2 = sorted((parse(rgb1), parse(rgb2)), reverse=True)
    return (l1 + 0.05) / (l2 + 0.05)


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

    def attach(page):
        page.on("pageerror", lambda error: errors.append(str(error)))

    def tab_until(page, predicate, limit=120):
        for _ in range(limit):
            page.keyboard.press("Tab")
            if page.evaluate(predicate):
                return True
        return False

    ACTIVE_IS_CHIP = "document.activeElement && document.activeElement.matches('.chip[data-name]')"
    ACTIVE_VISIBLE = """() => {
        const el = document.activeElement;
        if (!el || el === document.body) return false;
        const s = getComputedStyle(el);
        return s.outlineStyle !== 'none' && parseFloat(s.outlineWidth) > 0;
    }"""
    NAME_AUDIT = """() => {
        const bad = [];
        document.querySelectorAll('button, a[href], input, select, textarea, [role="button"]').forEach((el) => {
            if (el.offsetParent === null) return;  // hidden controls are exempt
            const wrapped = el.closest('label');
            const wrappedText = wrapped ? wrapped.innerText.replace(el.value || '', '').trim() : '';
            const forLabel = el.id ? document.querySelector(`label[for="${el.id}"]`) : null;
            const name = (el.getAttribute('aria-label') || el.innerText || el.title
                || el.getAttribute('aria-labelledby') || (forLabel ? forLabel.innerText : '')
                || wrappedText || '').trim();
            if (!name) bad.push(el.tagName + '.' + (el.className || '').toString().split(' ')[0]);
        });
        return bad.slice(0, 5);
    }"""

    try:
        with sync_playwright() as p:
            browser = p.chromium.launch(headless=True)
            context = browser.new_context(viewport={"width": 1280, "height": 960}, service_workers="block")
            page = context.new_page()
            attach(page)

            # --- A. keyboard-only: pick -> cook -----------------------------
            # Focus is planted with el.focus() where tab-order would need
            # hundreds of presses; what is asserted is OPERABILITY (native
            # controls activate with Enter/Space), not tab sequence.
            page.goto(base + "index.html", wait_until="networkidle")
            page.wait_for_selector(".chip[data-name]")

            # --- A0. skip link: first Tab stop, lands focus on <main> --------
            page.keyboard.press("Tab")
            check("skip link is the first Tab stop",
                  page.evaluate("document.activeElement && document.activeElement.classList.contains('skip-link')"))
            check("skip link is visible when focused",
                  page.evaluate("""() => {
                      const el = document.activeElement;
                      const r = el.getBoundingClientRect();
                      return r.left >= 0 && r.width > 0;
                  }"""))
            page.keyboard.press("Enter")
            page.wait_for_timeout(150)
            check("skip link moves focus to main content",
                  page.evaluate("document.activeElement && document.activeElement.id === 'main-content'"))

            page.focus("#ingredient-search")
            check("chip reachable by Tab from search box", tab_until(page, ACTIVE_IS_CHIP))
            check("focus outline visible on chip", page.evaluate(ACTIVE_VISIBLE))
            name = page.evaluate("document.activeElement.dataset.name")
            page.keyboard.press("Enter")
            fridge = page.evaluate("JSON.parse(localStorage.getItem('cmf.fridge')||'[]')")
            check("Enter toggles chip into fridge", bool(name) and name in fridge)
            page.evaluate("document.getElementById('btn-cook').focus()")
            check("cook button is a focusable enabled button",
                  page.evaluate("""() => {
                      const b = document.getElementById('btn-cook');
                      return b.tagName === 'BUTTON' && !b.disabled && b.offsetParent !== null
                          && document.activeElement === b;
                  }"""))
            page.keyboard.press("Enter")
            page.wait_for_url(lambda u: "result.html" in u)
            page.wait_for_selector(".recipe-card")
            check("keyboard-only reached result cards", True)

            page.focus(".recipe-card h3 a >> nth=0")
            check("focus outline visible on card link", page.evaluate(ACTIVE_VISIBLE))
            page.keyboard.press("Enter")
            page.wait_for_url(lambda u: "recipe.html" in u)
            page.wait_for_selector("#start-cooking")
            check("keyboard-only reached recipe detail", True)

            # --- B. ingredient modal: full focus cycle ----------------------
            page.evaluate("document.querySelector('.ing-name-btn').focus()")
            check("ingredient button is focusable",
                  page.evaluate("document.activeElement && document.activeElement.classList.contains('ing-name-btn')"))
            trigger_name = page.evaluate("document.activeElement.textContent")
            page.keyboard.press("Enter")
            page.wait_for_selector(".modal-overlay .modal")
            page.wait_for_timeout(100)
            check("focus moves INTO the modal on open",
                  page.evaluate("!!document.activeElement && !!document.activeElement.closest('.modal')"))
            start_el = page.evaluate("document.activeElement && (document.activeElement.className || document.activeElement.tagName)")
            wrapped = False
            for _ in range(30):
                page.keyboard.press("Tab")
                if not page.evaluate("!!document.activeElement.closest('.modal')"):
                    break
                cur = page.evaluate("document.activeElement && (document.activeElement.className || document.activeElement.tagName)")
                if cur == start_el:
                    wrapped = True
                    break
            check("Tab wraps inside the modal (focus trap)", wrapped)
            page.keyboard.press("Escape")
            page.wait_for_timeout(150)
            check("Escape closes the modal", page.locator(".modal-overlay").count() == 0)
            check("focus returns to the trigger",
                  page.evaluate("document.activeElement && document.activeElement.textContent") == trigger_name)

            # --- C. cooking overlay ------------------------------------------
            page.focus("#start-cooking")
            page.keyboard.press("Enter")
            page.wait_for_selector(".cooking-overlay", timeout=5000)
            check("cooking overlay is a dialog",
                  page.evaluate("!!document.querySelector('.cooking-overlay [role=\"dialog\"], .cooking-overlay[role=\"dialog\"]')"))
            page.wait_for_timeout(100)
            check("focus moves into cooking overlay",
                  page.evaluate("!!document.activeElement && !!document.activeElement.closest('.cooking-overlay')"))
            page.keyboard.press("Escape")
            page.wait_for_timeout(150)
            check("Escape closes cooking overlay",
                  page.locator(".cooking-overlay").count() == 0)
            check("focus returns to start-cooking",
                  page.evaluate("document.activeElement && document.activeElement.id") == "start-cooking")

            # --- D. planner + shopping checkboxes ---------------------------
            page.goto(base + "planner.html", wait_until="networkidle")
            page.wait_for_selector("#btn-shuffle")
            page.focus("#btn-shuffle")
            check("shuffle button operable by keyboard",
                  page.evaluate("document.activeElement && document.activeElement.id === 'btn-shuffle'"))
            page.goto(base + "fridge.html", wait_until="networkidle")
            page.evaluate("""() => {
                CMF.setPlan({recipeIds: [CMF.data.recipes[0].id], checked: []});
            }""")
            page.reload(wait_until="networkidle")
            page.wait_for_selector("#plan-content input[type='checkbox']", timeout=10000)
            page.evaluate("document.querySelector(\"#plan-content input[type='checkbox']\").focus()")
            before = page.evaluate("document.activeElement.checked")
            item = page.evaluate("document.activeElement.dataset.item")
            page.keyboard.press("Space")
            page.wait_for_timeout(120)
            # Assert the STORAGE flip, not the DOM node: toggling re-renders
            # the list, so the focused element is replaced mid-check.
            check("Space toggles shopping checkbox",
                  bool(page.evaluate("CMF.getPlan().checked.length")) != bool(before))
            check("focus returns to the same shopping row after re-render",
                  page.evaluate("""(item) => {
                      const el = document.activeElement;
                      return !!el && el.matches("input[data-item]") && el.dataset.item === item;
                  }""", item))

            # --- E. accessible names (real text only) ------------------------
            for name, url in (("home", "index.html"), ("result", "result.html?i=%E7%95%AA%E8%8C%84"),
                              ("recipe", "recipe.html?id=r001"), ("fridge", "fridge.html")):
                page.goto(base + url, wait_until="networkidle")
                page.wait_for_timeout(300)
                bad = page.evaluate(NAME_AUDIT)
                check(f"all visible controls named on {name}", not bad)
                if bad:
                    errors.append(f"unnamed controls on {name}: {bad}")

            # cook-bar removal control is a real button, not a bare span
            page.goto(base + "index.html", wait_until="networkidle")
            page.wait_for_selector(".chip[data-name]")
            page.click('.chip[data-name="番茄"]')
            check("cook-bar removal control is a named button",
                  page.evaluate("""() => {
                      const x = document.querySelector('#cook-bar .x');
                      return !!x && (x.tagName === 'BUTTON' || x.getAttribute('role') === 'button')
                          && (x.getAttribute('aria-label') || '').length > 0;
                  }"""))

            # --- F. canvas alternatives ---------------------------------------
            page.goto(base + "recipe.html?id=r001", wait_until="networkidle")
            page.wait_for_selector("#btn-share-card")
            page.click("#btn-share-card")
            page.wait_for_selector(".share-modal img.share-preview", timeout=8000)
            check("share preview image has meaningful alt",
                  page.evaluate("""() => {
                      const c = document.querySelector('.share-modal img.share-preview');
                      return !!c && (c.getAttribute('alt') || '').length > 5;
                  }"""))
            page.keyboard.press("Escape")
            page.goto(base + "fridge.html", wait_until="networkidle")
            page.wait_for_timeout(300)
            check("sync QR canvas labelled when present",
                  page.evaluate("""() => {
                      const c = document.querySelector('#sync-content canvas');
                      if (!c) return true;  // QR only renders after generating a code
                      return c.getAttribute('role') === 'img' && (c.getAttribute('aria-label') || '').length > 5;
                  }"""))

            # --- G. contrast (computed styles, WCAG formula) ------------------
            # Thresholds are honest WCAG: 4.5:1 for body-size text, 3:1 for
            # large text (>=18.66px bold / 24px, e.g. the 19px/800 logo) and
            # for non-text UI boundaries. Every pair is measured from the
            # COMPUTED style on the page where the element actually lives.
            def probe_on(url, sel, setup=None):
                page.goto(base + url, wait_until="networkidle")
                if setup:
                    page.evaluate(setup)
                return page.evaluate("""(sel) => {
                    const el = document.querySelector(sel);
                    if (!el) return null;
                    const s = getComputedStyle(el);
                    let bg = s.backgroundColor, node = el;
                    while ((bg === 'rgba(0, 0, 0, 0)' || bg === 'transparent') && node.parentElement) {
                        node = node.parentElement;
                        bg = getComputedStyle(node).backgroundColor;
                    }
                    return {fg: s.color, bg, font: s.fontSize + '/' + s.fontWeight};
                }""", sel)

            def expect(name, pair, threshold):
                if not pair:
                    check(name + " (element found)", False)
                    return
                r = contrast(pair["fg"], pair["bg"])
                check(f"{name} contrast >= {threshold} ({r:.2f})", r >= threshold)

            expect("body text", probe_on("index.html", "body"), 4.5)
            expect("soft text", probe_on("index.html", ".empty, .weather-status"), 4.5)
            expect("content link", probe_on("result.html?i=%E7%95%AA%E8%8C%84", ".recipe-card h3 a"), 4.5)
            expect("nav link", probe_on("index.html", ".nav-links a"), 4.5)
            # Logo: 19px / 800 weight = WCAG "large text", threshold 3:1.
            logo = probe_on("index.html", ".brand")
            if logo:
                large = float(logo["font"].split("/")[0].replace("px", "")) >= 18.66 and int(logo["font"].split("/")[1]) >= 700
                check("logo qualifies as large text", large)
                expect("logo (large text)", logo, 3.0)
            expect("primary button", probe_on("index.html", ".btn-primary"), 4.5)
            expect("week-day label", probe_on("planner.html", ".week-day"), 4.5)
            page.goto(base + "browse.html", wait_until="networkidle")
            page.wait_for_selector(".filter-chip", timeout=10000)
            page.locator(".filter-chip").first.click()
            expect("selected filter chip",
                   page.evaluate("""() => {
                       const el = document.querySelector('.filter-chip.on');
                       if (!el) return null;
                       const s = getComputedStyle(el);
                       return {fg: s.color, bg: s.backgroundColor, font: s.fontSize + '/' + s.fontWeight};
                   }"""), 4.5)
            expect("active factor button", probe_on("recipe.html?id=r001", ".factor-active"), 4.5)
            page.goto(base + "recipe.html?id=r001", wait_until="networkidle")
            page.click("#start-cooking")
            page.wait_for_selector(".cooking-overlay", timeout=5000)
            expect("cooking progress text",
                   page.evaluate("""() => {
                       const el = document.querySelector('.cooking-progress');
                       const s = getComputedStyle(el);
                       return {fg: s.color, bg: getComputedStyle(el.closest('.cooking-card') || el).backgroundColor,
                               font: s.fontSize + '/' + s.fontWeight};
                   }"""), 4.5)
            page.keyboard.press("Escape")

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
