"""Headless tests for multi-device sync and trackable share links."""
from __future__ import annotations

import json
import shutil
import subprocess
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
HARNESS = ROOT / "tests" / "consistency" / "node_sync_harness.js"

pytestmark = pytest.mark.skipif(
    shutil.which("node") is None, reason="node not available"
)


def test_sync_js():
    proc = subprocess.run(
        ["node", str(HARNESS), str(ROOT)],
        check=True,
        capture_output=True,
        text=True,
    )
    payload = json.loads(proc.stdout)
    assert payload["ok"] is True
    assert payload["checks"] >= 140
    assert 1 <= payload["qrVersion"] <= 40
    assert payload["codeBytes"] > 50


def test_sync_is_wired_everywhere():
    pages = sorted((ROOT / "web").glob("*.html"))
    assert len(pages) == 9
    for page in pages:
        html = page.read_text(encoding="utf-8")
        assert 'src="js/sync.js"' in html, page.name
        assert html.index("js/share.js") < html.index("js/sync.js") < html.index("js/ui.js")
    assert '"js/sync.js"' in (ROOT / "web" / "sw.js").read_text(encoding="utf-8")
    assert '"cmf.shareStats"' in (ROOT / "web" / "js" / "store.js").read_text(encoding="utf-8")
    assert 'id="sync-content"' in (ROOT / "web" / "fridge.html").read_text(encoding="utf-8")
    share = (ROOT / "web" / "js" / "share.js").read_text(encoding="utf-8")
    assert "shareLink" in share and "trackShare" in share and "resolveShareLink" in share
