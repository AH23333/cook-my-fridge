"""Static site build pipeline tests (runs fully in temp dirs)."""
from pathlib import Path

import pytest

import cookmyfridge.build as build

ROOT = Path(__file__).resolve().parents[1]


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
    """Offline-first install must include JS, not just HTML/CSS/data."""
    sw = (ROOT / "web" / "sw.js").read_text(encoding="utf-8")
    scripts = sorted(
        p.relative_to(ROOT / "web").as_posix()
        for p in (ROOT / "web" / "js").glob("*.js")
    )
    assert len(scripts) >= 22
    for script in scripts:
        assert f'"{script}"' in sw, f"missing from SW precache: {script}"


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

    monkeypatch.setattr(build, "SITE_DIR", fake_site)
    monkeypatch.setattr(build, "WEB_DIR", fake_web)

    build.build_site()

    assert not (fake_site / "ghost.html").exists()
    assert not (fake_site / "data" / "ghost.json").exists()
    assert (fake_site / "index.html").exists()
    assert (fake_site / "data" / "recipes.json").exists()
