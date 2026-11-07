"""Headless tests for week-split shopping lists and export formats."""
from __future__ import annotations

import json
import shutil
import subprocess
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
HARNESS = ROOT / "tests" / "consistency" / "node_shopping_harness.js"

pytestmark = pytest.mark.skipif(
    shutil.which("node") is None, reason="node not available"
)


def test_shopping_js():
    proc = subprocess.run(
        ["node", str(HARNESS), str(ROOT)],
        check=True,
        capture_output=True,
        text=True,
    )
    payload = json.loads(proc.stdout)
    assert payload["ok"] is True
    assert payload["checks"] >= 55
    assert payload["weeks"] == 3


def test_shopping_controls_and_styles_wired():
    page = (ROOT / "web" / "js" / "page-planner.js").read_text(encoding="utf-8")
    for token in ("weeklyShopping", "shoppingToCSV", "shoppingToText", "btn-shop-csv", "btn-shop-text", "shopChecked"):
        assert token in page, token
    css = (ROOT / "web" / "css" / "style.css").read_text(encoding="utf-8")
    for selector in (".shop-week-grid", ".shop-week-head", ".shop-item", ".shop-actions"):
        assert selector in css, selector
