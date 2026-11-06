"""Cross-implementation consistency: Python search vs the real browser JS.

Runs the Node harness (which loads the actual frontend catalog/search) over
hundreds of seeded random queries and asserts identical bucket membership,
ordering and missing-ingredient lists against the Python SearchIndex.
"""
from __future__ import annotations

import json
import shutil
import subprocess
from pathlib import Path

import pytest

from cookmyfridge.dataset import load_recipes
from cookmyfridge.search import SearchIndex

ROOT = Path(__file__).resolve().parents[1]
HARNESS = ROOT / "tests" / "consistency" / "node_harness.js"

pytestmark = pytest.mark.skipif(
    shutil.which("node") is None, reason="node not available"
)


def _py_summary(index: SearchIndex, selected: list[str]) -> dict:
    result = index.search(selected)

    def pack(matches):
        return [{"id": m.recipe.id, "missing": m.missing} for m in matches]

    return {
        "cookNow": pack(result.cook_now),
        "almost": pack(result.almost_there),
    }


def test_js_and_python_search_agree():
    proc = subprocess.run(
        ["node", str(HARNESS), str(ROOT)],
        check=True,
        capture_output=True,
        text=True,
    )
    rows = json.loads(proc.stdout)
    index = SearchIndex(load_recipes())
    assert rows
    mismatches = 0
    for row in rows:
        expected = _py_summary(index, row["selected"])
        if expected != row["js"]:
            mismatches += 1
            if mismatches <= 3:
                print("QUERY", row["selected"])
                print("PY", expected)
                print("JS", row["js"])
    assert mismatches == 0
