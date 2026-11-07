"""Headless tests for 1-4 week menus and calendar subscription wiring."""
from __future__ import annotations

import json
import shutil
import subprocess
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
HARNESS = ROOT / "tests" / "consistency" / "node_menu_harness.js"
WEB = ROOT / "web"

pytestmark = pytest.mark.skipif(
    shutil.which("node") is None, reason="node not available"
)


def test_multiweek_menu_js():
    proc = subprocess.run(
        ["node", str(HARNESS), str(ROOT)],
        check=True,
        capture_output=True,
        text=True,
    )
    payload = json.loads(proc.stdout)
    assert payload["ok"] is True
    assert payload["checks"] >= 80
    assert payload["weeks"] == 4
    assert payload["icsBytes"] > 10000


def test_calendar_subscription_is_virtual_and_persistent():
    """A static host has no dynamic endpoint: the SW serves a cached ICS."""
    sw = (WEB / "sw.js").read_text(encoding="utf-8")
    assert "CALENDAR_CACHE" in sw
    assert "calendar.ics" in sw
    assert "k !== CALENDAR_CACHE" in sw, "activate must not purge the subscription cache"
    assert "text/calendar" in sw

    planner = (WEB / "js" / "planner.js").read_text(encoding="utf-8")
    page = (WEB / "js" / "page-planner.js").read_text(encoding="utf-8")
    assert '"cmf-calendar-v1"' in planner and '"cmf-calendar-v1"' in sw
    assert 'caches.open(CMF.CALENDAR_CACHE' in page
    assert "cache.put(" in page and "saveState" in page
    assert "webcal:" in page
