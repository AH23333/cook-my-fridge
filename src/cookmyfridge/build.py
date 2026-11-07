"""Build the deployable static site: export data shards and copy web assets."""
from __future__ import annotations

import json
import shutil
import time
from datetime import datetime, timezone
from pathlib import Path

from . import catalog as cat
from .batch import CACHE_DIR
from .config import SITE_DIR, WEB_DIR
from .dataset import load_recipes
from .models import METHOD_ALIASES, TAG_ALIASES
from .nutrition import nutrition_facts_payload
from .validate import vocabulary_snapshot


def _write_json(path: Path, value) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        json.dumps(value, ensure_ascii=False, indent=0),
        encoding="utf-8",
        newline="\n",
    )


def _retry(operation, attempts: int = 4):
    """Retry a file operation transiently blocked on Windows.

    A local preview server, browser service worker or file indexer can briefly
    hold generated assets (WinError 1224 / OSError 22). A build should not
    fail randomly because of that.
    """
    for attempt in range(attempts):
        try:
            return operation()
        except OSError:
            if attempt == attempts - 1:
                raise
            time.sleep(0.05 * (attempt + 1))


def export_catalog() -> dict:
    entries = cat.catalog_entries()
    payload = {
        "ingredients": entries,
        "substitutions": {
            canonical: cat.substitutions_for(canonical)
            for canonical in sorted(cat.canonical_set())
            if cat.substitutions_for(canonical)
        },
        "pantry_staples": sorted(cat.PANTRY_STAPLES),
        "method_aliases": METHOD_ALIASES,
        "tag_aliases": TAG_ALIASES,
        "nutrition_facts": nutrition_facts_payload(),
    }
    _write_json(SITE_DIR / "data" / "catalog.json", payload)
    return payload


def export_recipes() -> list[dict]:
    recipes = [r.to_dict() for r in load_recipes()]
    _write_json(SITE_DIR / "data" / "recipes.json", recipes)
    _write_json(SITE_DIR / "data" / "vocab.json", vocabulary_snapshot())
    return recipes


def _cache_values(filename: str) -> list:
    source = CACHE_DIR / filename
    if not source.exists():
        return []
    raw = json.loads(source.read_text(encoding="utf-8"))
    return [{"key": key, **value} for key, value in raw.items()]


def export_ai_cache() -> dict:
    out = {}
    for name in ("wildcards", "blindboxes", "variants", "ideas"):
        values = _cache_values(f"{name}.json")
        _write_json(SITE_DIR / "data" / "ai" / f"{name}.json", values)
        out[name] = len(values)
    return out


def copy_web_assets() -> None:
    if SITE_DIR.exists():
        # Remove only generated asset folders, keep data dir until rewritten.
        for child in ("css", "js"):
            target = SITE_DIR / child
            if target.exists():
                shutil.rmtree(target)
    SITE_DIR.mkdir(parents=True, exist_ok=True)
    for child in ("css", "js"):
        src = WEB_DIR / child
        if src.exists():
            _retry(
                lambda src=src, child=child: shutil.copytree(
                    src, SITE_DIR / child
                )
            )
    for html in WEB_DIR.glob("*.html"):
        _retry(lambda html=html: shutil.copy2(html, SITE_DIR / html.name))
    for extra in ("sw.js", "manifest.webmanifest", "icon.svg"):
        src = WEB_DIR / extra
        if src.exists():
            _retry(
                lambda src=src, extra=extra: shutil.copy2(
                    src, SITE_DIR / extra
                )
            )

    # Version the service worker cache so each release invalidates old caches.
    sw_target = SITE_DIR / "sw.js"
    if sw_target.exists():
        version = datetime.now(timezone.utc).strftime("%Y%m%d%H%M%S")
        text = sw_target.read_text(encoding="utf-8")
        _retry(
            lambda: sw_target.write_text(
                text.replace("cmf-cache-v1", f"cmf-cache-{version}"),
                encoding="utf-8",
                newline="\n",
            )
        )


def build_site() -> dict:
    copy_web_assets()
    catalog_payload = export_catalog()
    recipes = export_recipes()
    ai = export_ai_cache()
    summary = {
        "recipes": len(recipes),
        "ingredients": len(catalog_payload["ingredients"]),
        "ai_cards": ai,
        "site_dir": str(SITE_DIR),
    }
    return summary
