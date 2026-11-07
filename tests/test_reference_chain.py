"""Static reference-chain tests: every page must load the shared modules.

A missing <script> tag does not fail at build time; it silently removes a
feature (or throws at click time). These assertions lock the wiring down,
including the SW precache list and the new page controls.
"""
from __future__ import annotations

import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
WEB = ROOT / "web"

GLOBAL_SCRIPTS = ("nutrition.js", "diets.js", "pairings.js", "share.js", "ui.js")


def _pages() -> list[Path]:
    pages = sorted(WEB.glob("*.html"))
    assert len(pages) >= 9
    return pages


def test_every_page_loads_global_scripts_in_order():
    for page in _pages():
        html = page.read_text(encoding="utf-8")
        for script in GLOBAL_SCRIPTS:
            assert f'src="js/{script}"' in html, f"{page.name}: missing {script}"
        positions = [html.index(f"js/{s}") for s in GLOBAL_SCRIPTS[:-1]]
        assert positions == sorted(positions), f"{page.name}: global script order"
        assert html.index("js/share.js") < html.index("js/ui.js"), page.name


def test_no_duplicate_or_missing_script_files():
    for page in _pages():
        html = page.read_text(encoding="utf-8")
        srcs = re.findall(r'<script src="js/([^"]+)"></script>', html)
        assert len(srcs) == len(set(srcs)), f"{page.name}: duplicate script"
        for src in srcs:
            assert (WEB / "js" / src).exists(), f"{page.name}: missing file {src}"


def test_sw_precaches_all_scripts():
    sw = (WEB / "sw.js").read_text(encoding="utf-8")
    scripts = sorted(p.name for p in (WEB / "js").glob("*.js"))
    assert len(scripts) >= 20
    for script in scripts:
        assert f'"js/{script}"' in sw, script


def test_new_ui_controls_wired():
    planner = (WEB / "planner.html").read_text(encoding="utf-8")
    for control in ("btn-shuffle", "btn-export-ics", "btn-copy-week", "week-diet-note"):
        assert f'id="{control}"' in planner
    assert (WEB / "js" / "page-planner.js").read_text(encoding="utf-8").count("btn-export-ics") >= 1

    fridge = (WEB / "fridge.html").read_text(encoding="utf-8")
    assert 'id="diets-content"' in fridge

    browse = (WEB / "browse.html").read_text(encoding="utf-8")
    assert 'id="filter-diets"' in browse and 'id="calorie-select"' in browse

    recipe_page = (WEB / "js" / "page-recipe.js").read_text(encoding="utf-8")
    assert "btn-share-card" in recipe_page and "renderNutritionCard" in recipe_page


def test_new_styles_exist():
    css = (WEB / "css" / "style.css").read_text(encoding="utf-8")
    for selector in (
        ".nutrition-estimate", ".nut-stats", ".nut-energy-seg", ".diet-badge",
        ".diet-chip", ".share-preview", ".share-actions", ".week-meal",
        ".week-kcal",
    ):
        assert selector in css, selector


def test_built_catalog_has_nutrition_facts():
    import json

    payload = json.loads((ROOT / "site" / "data" / "catalog.json").read_text(encoding="utf-8"))
    facts = payload["nutrition_facts"]
    assert len(facts["per100g"]) == len(payload["ingredients"])
    assert "鸡蛋" in facts["ingredient_units"]
    assert facts["unit_grams"]["小勺"] < facts["unit_grams"]["勺"]
