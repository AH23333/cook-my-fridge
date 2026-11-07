"""Headless tests for the offline ingredient-pairing co-occurrence index."""
from __future__ import annotations

import json
import shutil
import subprocess
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
HARNESS = ROOT / "tests" / "consistency" / "node_pairing_harness.js"

pytestmark = pytest.mark.skipif(
    shutil.which("node") is None, reason="node not available"
)


def test_pairing_index():
    proc = subprocess.run(
        ["node", str(HARNESS), str(ROOT)],
        check=True,
        capture_output=True,
        text=True,
    )
    payload = json.loads(proc.stdout)
    assert payload["ok"] is True
    assert payload["checks"] >= 17
    assert payload["tomato"][0] == {"canonical": "鸡蛋", "count": 3}


def test_pairing_script_is_wired_into_every_page():
    """A missing <script> tag silently breaks the encyclopedia modal."""
    pages = sorted((ROOT / "web").glob("*.html"))
    assert len(pages) >= 9
    for page in pages:
        html = page.read_text(encoding="utf-8")
        assert 'src="js/pairings.js"' in html, page.name
        assert html.index("js/pairings.js") < html.index("js/ui.js"), page.name


def test_pairing_styles_exist():
    css = (ROOT / "web" / "css" / "style.css").read_text(encoding="utf-8")
    for selector in (".pairing-grid", ".pairing-chip", ".pair-count", ".modal-row.pairing"):
        assert selector in css
