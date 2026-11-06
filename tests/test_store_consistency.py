"""Headless tests for the real frontend store.js persistence logic via Node."""
from __future__ import annotations

import json
import shutil
import subprocess
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
HARNESS = ROOT / "tests" / "consistency" / "node_store_harness.js"

pytestmark = pytest.mark.skipif(
    shutil.which("node") is None, reason="node not available"
)


def test_store_js_persistence_logic():
    proc = subprocess.run(
        ["node", str(HARNESS), str(ROOT)],
        check=True,
        capture_output=True,
        text=True,
    )
    payload = json.loads(proc.stdout)
    assert payload["ok"] is True
    assert payload["checks"] >= 9
