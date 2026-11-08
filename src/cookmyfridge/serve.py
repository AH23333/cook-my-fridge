"""Local preview server for the built site/ with precompression negotiation.

`python run.py serve` answers with the build-emitted .br / .gz siblings when
the client accepts them (Content-Encoding: br / gzip), mirroring what static
hosts with brotli_static / gzip_static do in production. This is what makes
local slow-3G readings honest: without it the test server ships raw bytes
and overstates transfer time roughly 4x on JSON/JS.
"""
from __future__ import annotations

import http.server
from pathlib import Path

SITE_DIR = Path(__file__).resolve().parents[2] / "site"


def pick_precompressed(filename: str, accept_encoding: str) -> tuple[str, str | None]:
    """Pick the best available variant for a file. br beats gzip; the plain
    file serves when the client accepts nothing we have. q-values are
    ignored deliberately: br-with-any-q is still the smallest answer."""
    accepted = {
        token.strip().split(";")[0]
        for token in accept_encoding.lower().split(",")
    }
    if "br" in accepted and Path(filename + ".br").exists():
        return filename + ".br", "br"
    if "gzip" in accepted and Path(filename + ".gz").exists():
        return filename + ".gz", "gzip"
    return filename, None


class PrecompressedHandler(http.server.SimpleHTTPRequestHandler):
    """SimpleHTTPRequestHandler that substitutes precompressed siblings."""

    def send_head(self):  # mirrors stdlib control flow
        path = self.translate_path(self.path)
        if not Path(path).is_dir():
            actual, encoding = pick_precompressed(
                path, self.headers.get("Accept-Encoding", "")
            )
            if encoding:
                stream = open(actual, "rb")
                self.send_response(200)
                self.send_header("Content-Type", self.guess_type(path))
                self.send_header("Content-Encoding", encoding)
                self.send_header("Content-Length", str(Path(actual).stat().st_size))
                self.send_header("Vary", "Accept-Encoding")
                self.end_headers()
                return stream
        return super().send_head()

    def log_message(self, *args):
        pass


def serve_site(port: int = 8000) -> None:
    if not SITE_DIR.exists():
        raise SystemExit("site/ 不存在，先跑 python run.py build")
    handler = lambda *a, **kw: PrecompressedHandler(  # noqa: E731
        *a, directory=str(SITE_DIR), **kw
    )
    server = http.server.ThreadingHTTPServer(("127.0.0.1", port), handler)
    print(f"serving {SITE_DIR} at http://127.0.0.1:{server.server_port}/")
    print("precompressed .br/.gz negotiated per Accept-Encoding; Ctrl+C to stop")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()
