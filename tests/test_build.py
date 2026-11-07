"""Static site build pipeline tests (runs fully in temp dirs)."""
from pathlib import Path

import pytest

import cookmyfridge.build as build

ROOT = Path(__file__).resolve().parents[1]


def _seed_bundle_modules(fake_web: Path) -> None:
    """build_js_bundle requires every module; fixtures get one-line stubs."""
    js = fake_web / "js"
    js.mkdir(parents=True, exist_ok=True)
    for name in build.BUNDLE_MODULES:
        target = js / f"{name}.js"
        if not target.exists():
            target.write_text(f"/* {name} */", encoding="utf-8")


def test_build_site(tmp_path, monkeypatch):
    fake_site = tmp_path / "site"
    fake_web = tmp_path / "web"
    fake_cache = tmp_path / "cache"
    (fake_web / "css").mkdir(parents=True)
    (fake_web / "js").mkdir(parents=True)
    (fake_web / "css").joinpath("style.css").write_text("/* x */", encoding="utf-8")
    (fake_web).joinpath("index.html").write_text("<html></html>", encoding="utf-8")
    for extra in ("manifest.webmanifest", "icon.svg"):
        (fake_web / extra).write_text("x", encoding="utf-8")
    (fake_web / "sw.js").write_text(
        'const CACHE_NAME = "cmf-cache-v1";', encoding="utf-8"
    )
    _seed_bundle_modules(fake_web)

    monkeypatch.setattr(build, "SITE_DIR", fake_site)
    monkeypatch.setattr(build, "WEB_DIR", fake_web)
    monkeypatch.setattr(build, "CACHE_DIR", fake_cache)

    summary = build.build_site()

    assert summary["recipes"] >= 40
    assert summary["ingredients"] >= 150
    assert (fake_site / "data" / "catalog.json").exists()
    assert (fake_site / "data" / "recipes.json").exists()
    assert (fake_site / "data" / "vocab.json").exists()
    assert (fake_site / "css" / "style.css").exists()
    assert (fake_site / "index.html").exists()
    for name in ("wildcards", "blindboxes", "variants", "ideas"):
        assert (fake_site / "data" / "ai" / f"{name}.json").exists()
    for extra in ("sw.js", "manifest.webmanifest", "icon.svg"):
        assert (fake_site / extra).exists()
    sw_text = (fake_site / "sw.js").read_text(encoding="utf-8")
    assert "cmf-cache-v1" not in sw_text
    assert "cmf-cache-" in sw_text


def test_export_catalog_includes_staples(tmp_path, monkeypatch):
    monkeypatch.setattr(build, "SITE_DIR", tmp_path / "site")
    payload = build.export_catalog()
    assert "盐" in payload["pantry_staples"]
    assert payload["substitutions"]
    # Iterating an unordered set used to reshuffle the generated JSON on every
    # build, producing noisy diffs with no content change.
    assert list(payload["substitutions"]) == sorted(payload["substitutions"])


def test_service_worker_precaches_every_script():
    """Offline-first install precaches the bundle plus every page script;
    individual modules ship inside bundle.js instead of being listed."""
    sw = (ROOT / "web" / "sw.js").read_text(encoding="utf-8")
    assert '"js/bundle.js"' in sw
    pages = sorted(p.name for p in (ROOT / "web" / "js").glob("page-*.js"))
    assert len(pages) >= 8
    for page in pages:
        assert f'"js/{page}"' in sw, f"missing from SW precache: {page}"
    # Every shared module must be in the bundle manifest, or its exports
    # silently vanish from the deployed site.
    for module in ("store", "catalog", "search", "sync", "ui", "inventory-ui"):
        assert module in build.BUNDLE_MODULES


def test_bundle_and_html_rewiring(tmp_path, monkeypatch):
    """The bundle concatenates every module; deployed pages reference it
    exactly once and keep their page script."""
    fake_site = tmp_path / "site"
    fake_web = tmp_path / "web"
    (fake_web / "js").mkdir(parents=True)
    (fake_web / "css").mkdir(parents=True)
    (fake_web / "index.html").write_text(
        "<html><body>\n"
        '  <script src="js/store.js"></script>\n'
        '  <script src="js/ui.js"></script>\n'
        '  <script src="js/page-home.js"></script>\n'
        "</body></html>\n",
        encoding="utf-8",
    )
    (fake_web / "about.html").write_text(
        "<html><body>\n"
        '  <script src="js/store.js"></script>\n'
        '  <script>window.CMF.boots("about.html");</script>\n'
        "</body></html>\n",
        encoding="utf-8",
    )
    for name in build.BUNDLE_MODULES:
        (fake_web / "js" / f"{name}.js").write_text(
            f"/* {name} marker */", encoding="utf-8"
        )
    (fake_web / "js" / "page-home.js").write_text("/* home */", encoding="utf-8")
    (fake_web / "css" / "style.css").write_text("/* x */", encoding="utf-8")
    monkeypatch.setattr(build, "SITE_DIR", fake_site)
    monkeypatch.setattr(build, "WEB_DIR", fake_web)

    build.copy_web_assets()
    size = build.build_js_bundle()
    rewritten = build._rewrite_html_bundles()

    bundle = (fake_site / "js" / "bundle.js").read_text(encoding="utf-8")
    assert size > 0 and "/* ui marker */" in bundle
    assert sum(1 for name in build.BUNDLE_MODULES if f"/* {name} marker */" in bundle) == len(build.BUNDLE_MODULES)
    assert rewritten == 2
    index = (fake_site / "index.html").read_text(encoding="utf-8")
    assert index.count('src="js/bundle.js"') == 1
    assert 'src="js/page-home.js"' in index
    assert 'src="js/store.js"' not in index
    about = (fake_site / "about.html").read_text(encoding="utf-8")
    assert about.count('src="js/bundle.js"') == 1
    assert about.index('src="js/bundle.js"') < about.index("</body>")
    # Inline boots() must run AFTER the bundle: inserting the bundle before
    # </body> instead of at the first removed module left window.CMF
    # undefined on about.html (real bug caught by stage27/32/38).
    assert about.index('src="js/bundle.js"') < about.index("window.CMF.boots")


def test_service_worker_precaches_every_page():
    """Every HTML page must sit in the SW precache: pages missing from
    CORE_ASSETS fall through to the generic cache-first handler, and an
    offline first visit silently gets the index.html fallback instead of
    the requested page (browse/planner/stats were once left out)."""
    sw = (ROOT / "web" / "sw.js").read_text(encoding="utf-8")
    pages = sorted(p.name for p in (ROOT / "web").glob("*.html"))
    assert len(pages) >= 9
    for page in pages:
        assert f'"{page}"' in sw, f"missing from SW precache: {page}"


def test_retry_recovers_from_transient_oserror():
    calls = []

    def flaky():
        calls.append(1)
        if len(calls) < 3:
            raise OSError("file briefly held by another process")
        return "ok"

    assert build._retry(flaky) == "ok"
    assert len(calls) == 3


def test_build_fails_loudly_when_sw_marker_missing(tmp_path, monkeypatch):
    """If web/sw.js ever renames the cache marker, version injection silently
    stops and users keep stale caches forever; the build must fail instead."""
    fake_site = tmp_path / "site"
    fake_web = tmp_path / "web"
    fake_web.mkdir()
    (fake_web / "sw.js").write_text(
        'const CACHE_NAME = "cmf-cache-v2";', encoding="utf-8"
    )
    monkeypatch.setattr(build, "SITE_DIR", fake_site)
    monkeypatch.setattr(build, "WEB_DIR", fake_web)

    with pytest.raises(RuntimeError, match="cmf-cache-v1"):
        build.copy_web_assets()


def test_build_removes_stale_artifacts(tmp_path, monkeypatch):
    """Pages/data deleted from web/ must not linger in the deployed site/."""
    fake_site = tmp_path / "site"
    fake_web = tmp_path / "web"
    (fake_web / "css").mkdir(parents=True)
    (fake_web / "js").mkdir(parents=True)
    (fake_web / "index.html").write_text("<html></html>", encoding="utf-8")
    # Leftovers from an older deploy: a removed page and an orphan data file.
    (fake_site / "data").mkdir(parents=True)
    (fake_site / "ghost.html").write_text("stale", encoding="utf-8")
    (fake_site / "data" / "ghost.json").write_text("{}", encoding="utf-8")
    (fake_site / "data" / "ai").mkdir()
    _seed_bundle_modules(fake_web)

    monkeypatch.setattr(build, "SITE_DIR", fake_site)
    monkeypatch.setattr(build, "WEB_DIR", fake_web)

    build.build_site()

    assert not (fake_site / "ghost.html").exists()
    assert not (fake_site / "data" / "ghost.json").exists()
    assert (fake_site / "index.html").exists()
    assert (fake_site / "data" / "recipes.json").exists()
