"""Run inventory logic/storage/sync checks offline in three calendar contexts."""
from __future__ import annotations

import json
import os
import shutil
import subprocess
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
HARNESS = ROOT / "tests" / "consistency" / "node_inventory_harness.js"
# Actual completed harness assertion count, not an estimated coverage target.
MIN_CHECKS = 364

pytestmark = pytest.mark.skipif(
    shutil.which("node") is None, reason="node not available"
)


@pytest.mark.parametrize("timezone", ["UTC", "Asia/Shanghai", "America/Los_Angeles"])
def test_inventory_js_logic(timezone: str):
    proc = subprocess.run(
        ["node", str(HARNESS), str(ROOT)],
        env={**os.environ, "TZ": timezone},
        capture_output=True,
        text=True,
        encoding="utf-8",
        timeout=60,
        check=False,
    )
    assert proc.returncode == 0, f"TZ={timezone}\n{proc.stdout}\n{proc.stderr}"
    payload = json.loads(proc.stdout)
    assert payload["ok"] is True
    assert payload["failures"] == []
    assert payload["checks"] >= MIN_CHECKS
    assert sum(payload["sections"].values()) == payload["checks"]
    assert all(count > 0 for count in payload["sections"].values())
