"""Static site build pipeline tests (runs fully in temp dirs)."""
from pathlib import Path

import cookmyfridge.build as build


def test_build_site(tmp_path, monkeypatch):
    fake_site = tmp_path / "site"
    fake_web = tmp_path / "web"
    fake_cache = tmp_path / "cache"
    (fake_web / "css").mkdir(parents=True)
    (fake_web / "js").mkdir(parents=True)
    (fake_web / "css").joinpath("style.css").write_text("/* x */", encoding="utf-8")
    (fake_web).joinpath("index.html").write_text("<html></html>", encoding="utf-8")

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


def test_export_catalog_includes_staples(tmp_path, monkeypatch):
    monkeypatch.setattr(build, "SITE_DIR", tmp_path / "site")
    payload = build.export_catalog()
    assert "盐" in payload["pantry_staples"]
    assert payload["substitutions"]
