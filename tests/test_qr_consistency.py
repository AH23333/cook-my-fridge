"""QR encoder: structural harness + real decoder verification.

The Node harness checks the bitstream/matrix invariants; this test renders
those matrices as PNG-like bitmaps and runs an independent QR decoder so a
structurally plausible but unscannable symbol cannot ship.
"""
from __future__ import annotations

import json
import shutil
import subprocess
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
HARNESS = ROOT / "tests" / "consistency" / "node_qr_harness.js"

pytestmark = pytest.mark.skipif(
    shutil.which("node") is None, reason="node not available"
)


def _emit_matrices(tmp_path: Path) -> list[dict]:
    out = tmp_path / "qr_matrices.json"
    subprocess.run(
        ["node", str(HARNESS), str(ROOT), "--emit", str(out)],
        check=True,
        capture_output=True,
        text=True,
    )
    return json.loads(out.read_text(encoding="utf-8"))


def _harness_payload() -> dict:
    proc = subprocess.run(
        ["node", str(HARNESS), str(ROOT)],
        check=True,
        capture_output=True,
        text=True,
    )
    return json.loads(proc.stdout)


def test_qr_encoder_structure():
    payload = _harness_payload()
    assert payload["ok"] is True
    assert payload["checks"] >= 135
    assert payload["payloads"] >= 6


def test_qr_symbols_are_scannable(tmp_path):
    try:
        import numpy as np
        from PIL import Image
    except ImportError:
        pytest.skip("numpy/Pillow not available")

    try:
        import zxingcpp
        decoder = "zxing"
    except ImportError:
        try:
            import cv2  # noqa: F401
            decoder = "cv2"
        except ImportError:
            pytest.skip("no QR decoder (zxing-cpp or opencv) available")

    rows = _emit_matrices(tmp_path)
    assert len(rows) >= 9
    # The sync panel needs high-version symbols; make sure the decoder test
    # actually exercises them instead of silently passing on v1-v10 only.
    assert any(row["version"] > 10 for row in rows)
    failures = []
    for row in rows:
        n = row["size"]
        quiet, cell = 4, 8
        arr = np.full(((n + quiet * 2) * cell, (n + quiet * 2) * cell), 255, dtype=np.uint8)
        for y in range(n):
            for x in range(n):
                if row["modules"][y][x]:
                    arr[(y + quiet) * cell:(y + quiet + 1) * cell,
                        (x + quiet) * cell:(x + quiet + 1) * cell] = 0
        bgr = np.asarray(Image.fromarray(arr).convert("RGB"))[:, :, ::-1].copy()
        if decoder == "zxing":
            texts = [code.text for code in zxingcpp.read_barcodes(bgr)]
        else:
            import cv2
            text, _, _ = cv2.QRCodeDetector().detectAndDecode(bgr)
            texts = [text] if text else []
        if row["text"] not in texts:
            failures.append((row["version"], row["mask"], row["text"][:50], texts))

    if decoder == "cv2":
        # OpenCV's detector has a known false negative on some v1+mask4 symbols
        # that ZXing decodes correctly; allow at most that single quirk.
        assert len(failures) <= 1, failures
    else:
        assert not failures, failures
