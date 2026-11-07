"""Headless tests for personal nutrition goals via Node."""
from __future__ import annotations

import json
import shutil
import subprocess
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
HARNESS = ROOT / "tests" / "consistency" / "node_goals_harness.js"

pytestmark = pytest.mark.skipif(
    shutil.which("node") is None, reason="node not available"
)


def test_goals_js():
    proc = subprocess.run(
        ["node", str(HARNESS), str(ROOT)],
        check=True,
        capture_output=True,
        text=True,
    )
    payload = json.loads(proc.stdout)
    assert payload["ok"] is True
    assert payload["checks"] >= 80
    assert payload["bmr"] == 1649
    assert 1200 <= payload["dailyKcal"] <= 4000


def test_goals_module_is_wired_everywhere():
    pages = sorted((ROOT / "web").glob("*.html"))
    assert len(pages) == 9
    for page in pages:
        html = page.read_text(encoding="utf-8")
        assert 'src="js/goals.js"' in html, page.name
        assert html.index("js/nutrition.js") < html.index("js/goals.js") < html.index("js/balance.js")
    # Shared modules ship inside the bundle (build.py BUNDLE_MODULES); sw.js
    # precaches the bundle instead of individual module files.
    assert '"js/bundle.js"' in (ROOT / "web" / "sw.js").read_text(encoding="utf-8")
    assert '"cmf.goals"' in (ROOT / "web" / "js" / "store.js").read_text(encoding="utf-8")
