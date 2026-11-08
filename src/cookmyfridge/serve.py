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
    """SimpleHTTPRequestHandler that substitutes precompressed siblings.

    url_prefix emulates subpath hosting (GitHub Pages project sites serve
    under /<repo>/): requests outside the prefix 404, exactly like the real
    host, and / redirects into the prefix."""

    url_prefix = ""

    def translate_path(self, path):
        if self.url_prefix:
            bare = path.split("?", 1)[0].split("#", 1)[0]
            if bare == self.url_prefix:
                path = self.url_prefix + "/" + path[len(bare):]
                bare = self.url_prefix + "/"
            if bare.startswith(self.url_prefix + "/"):
                path = path[len(self.url_prefix):]
            else:
                # Outside the mount point: route to a guaranteed-missing
                # file so the normal flow answers 404.
                return str(Path(self.directory) / "__outside_prefix__")
        return super().translate_path(path)

    def send_head(self):  # mirrors stdlib control flow
        if self.url_prefix and self.path.split("?", 1)[0] in ("", "/"):
            self.send_response(302)
            self.send_header("Location", self.url_prefix + "/")
            self.end_headers()
            return None
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


def make_handler(directory: str, prefix: str = ""):
    """Handler factory with per-server prefix (class attrs are process-wide,
    so tests and servers each get their own subclass)."""
    normalized = ("/" + prefix.strip("/")) if prefix.strip("/") else ""

    class _Handler(PrecompressedHandler):
        url_prefix = normalized

    return lambda *a, **kw: _Handler(*a, directory=directory, **kw)


def serve_site(port: int = 8000, prefix: str = "") -> None:
    if not SITE_DIR.exists():
        raise SystemExit("site/ 不存在，先跑 python run.py build")
    server = http.server.ThreadingHTTPServer(
        ("127.0.0.1", port), make_handler(str(SITE_DIR), prefix)
    )
    base = f"http://127.0.0.1:{server.server_port}"
    mount = ("/" + prefix.strip("/") + "/") if prefix.strip("/") else "/"
    print(f"serving {SITE_DIR} at {base}{mount}")
    print("precompressed .br/.gz negotiated per Accept-Encoding; Ctrl+C to stop")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()
