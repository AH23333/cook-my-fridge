"""Precompression negotiation tests for the local preview server."""
from __future__ import annotations

import gzip
import http.client
import threading
from http.server import ThreadingHTTPServer
from pathlib import Path

from cookmyfridge.serve import PrecompressedHandler, pick_precompressed


def _seed(tmp_path: Path) -> None:
    payload = ("hello fridge " * 200).encode("utf-8")
    (tmp_path / "big.txt").write_bytes(payload)
    (tmp_path / "big.txt.gz").write_bytes(gzip.compress(payload, mtime=0))
    (tmp_path / "plain.txt").write_bytes(b"small")


def test_pick_prefers_br(tmp_path):
    _seed(tmp_path)
    (tmp_path / "big.txt.br").write_bytes(b"\x1b\x05\x00")
    actual, enc = pick_precompressed(str(tmp_path / "big.txt"), "gzip, deflate, br")
    assert enc == "br" and actual.endswith(".br")


def test_pick_falls_back_gzip_then_identity(tmp_path):
    _seed(tmp_path)
    actual, enc = pick_precompressed(str(tmp_path / "big.txt"), "gzip, deflate")
    assert enc == "gzip" and actual.endswith(".gz")
    actual, enc = pick_precompressed(str(tmp_path / "big.txt"), "deflate")
    assert enc is None and actual.endswith("big.txt")
    # No precompressed sibling at all -> identity even when gzip accepted.
    actual, enc = pick_precompressed(str(tmp_path / "plain.txt"), "gzip")
    assert enc is None and actual.endswith("plain.txt")


def test_handler_negotiates_and_marks_vary(tmp_path):
    _seed(tmp_path)
    handler = lambda *a, **kw: PrecompressedHandler(*a, directory=str(tmp_path), **kw)  # noqa: E731
    server = ThreadingHTTPServer(("127.0.0.1", 0), handler)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    try:
        conn = http.client.HTTPConnection("127.0.0.1", server.server_port)
        conn.request("GET", "/big.txt", headers={"Accept-Encoding": "gzip, deflate"})
        resp = conn.getresponse()
        assert resp.status == 200
        assert resp.getheader("Content-Encoding") == "gzip"
        assert resp.getheader("Vary") == "Accept-Encoding"
        assert resp.getheader("Content-Type").startswith("text/plain")
        body = resp.read()
        assert gzip.decompress(body) == (tmp_path / "big.txt").read_bytes()

        conn2 = http.client.HTTPConnection("127.0.0.1", server.server_port)
        conn2.request("GET", "/big.txt", headers={"Accept-Encoding": "identity"})
        resp2 = conn2.getresponse()
        assert resp2.getheader("Content-Encoding") is None
        assert resp2.read() == (tmp_path / "big.txt").read_bytes()

        # Query strings must not break the filename mapping (deep links).
        conn3 = http.client.HTTPConnection("127.0.0.1", server.server_port)
        conn3.request("GET", "/big.txt?x=1", headers={"Accept-Encoding": "gzip"})
        assert conn3.getresponse().status == 200
    finally:
        server.shutdown()
        server.server_close()
