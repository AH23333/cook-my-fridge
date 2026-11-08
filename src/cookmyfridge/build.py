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
from .dataset import load_shipped_recipes
from .models import METHOD_ALIASES, TAG_ALIASES
from .nutrition import nutrition_facts_payload
from .prices import price_facts_payload
from .seasonal import seasonal_payload
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
        "storage": cat.storage_payload(),
        "price_facts": price_facts_payload(),
        "seasonal": seasonal_payload(),
    }
    _write_json(SITE_DIR / "data" / "catalog.json", payload)
    return payload


def export_recipes() -> list[dict]:
    recipes = [r.to_dict() for r in load_shipped_recipes()]
    _write_json(SITE_DIR / "data" / "recipes.json", recipes)
    _write_json(SITE_DIR / "data" / "vocab.json", vocabulary_snapshot())
    return recipes


def export_core(catalog_payload: dict) -> None:
    """Single-request core payload for boot: catalog + vocab in one JSON so
    the first screen costs one data round trip instead of two (vocab.json is
    ~0.5 KB — a pure-latency request on slow links; measured waterfall:
    466 ms for 803 B). The split files stay for the Node consistency
    harnesses and any external consumers."""
    _write_json(
        SITE_DIR / "data" / "core.json",
        {"catalog": catalog_payload, "vocab": vocabulary_snapshot()},
    )


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


"""Shared JS modules concatenated into two bundles by the build (dev tree
stays modular in web/js; only site/ ships the bundles). Order only needs to
be stable: every module is an IIFE that registers onto window.CMF and is
used at call time, never at load time.

Split rationale (per-page boot-path audit, 2026-11-08): the first screen
needs only BOOT_MODULES (~31 KB); FEATURE_MODULES (~172 KB) are enrichment.
Lean pages (DEFER_PAGES) load boot synchronously and the features bundle is
injected by CMF.boots() AFTER the first render; content-heavy pages load
both synchronously, exactly like the old single bundle."""
BOOT_MODULES: tuple[str, ...] = (
    "store", "catalog", "search", "nlparse", "seasonal", "ui",
)
FEATURE_MODULES: tuple[str, ...] = (
    "nutrition", "goals", "balance", "diets", "prices", "journal",
    "inventory", "pairings", "planner", "stats", "cleanout", "qrcode",
    "share", "sync", "weather", "voice", "foodfacts", "tools", "inventory-ui",
)
BUNDLE_MODULES: tuple[str, ...] = BOOT_MODULES + FEATURE_MODULES

# Pages whose boot path touches no feature module (audited per page-*.js):
# index renders wall+banner from boot modules (weather/voice enrich via
# CMF.onFeatures), result/wildcard render from search+recipeCard+storage,
# about is static. Everyone else gets bundle-features.js synchronously.
DEFER_PAGES: frozenset = frozenset(
    {"index.html", "about.html", "result.html", "wildcard.html"}
)

BOOT_BUNDLE = "js/bundle-boot.js"
FEATURE_BUNDLE = "js/bundle-features.js"


def _concat_modules(names: tuple[str, ...]) -> str:
    out = []
    for name in names:
        src = WEB_DIR / "js" / f"{name}.js"
        if not src.exists():
            raise RuntimeError(f"bundle 模块缺失: {src}")
        out.append(src.read_text(encoding="utf-8"))
    return "\n;\n".join(out)


def build_js_bundle() -> dict:
    """Write site/js/bundle-boot.js and site/js/bundle-features.js.

    Returns {"boot": bytes, "features": bytes}. The features bundle ends
    with a readiness marker so CMF.onFeatures() can tell a synchronously
    loaded bundle from one that still needs injecting."""
    boot = _concat_modules(BOOT_MODULES)
    features = (
        _concat_modules(FEATURE_MODULES)
        + "\n;\nwindow.__cmfFeaturesReady = true;\n"
    )
    for path, text in (
        (SITE_DIR / BOOT_BUNDLE, boot),
        (SITE_DIR / FEATURE_BUNDLE, features),
    ):
        path.parent.mkdir(parents=True, exist_ok=True)
        _retry(lambda path=path, text=text: path.write_text(
            text, encoding="utf-8", newline="\n"
        ))
    return {
        "boot": len(boot.encode("utf-8")),
        "features": len(features.encode("utf-8")),
    }


def _rewrite_html_bundles() -> int:
    """Point each deployed page at the split bundles + its page script.

    Every page gets bundle-boot.js; pages outside DEFER_PAGES also get
    bundle-features.js synchronously (their boot path renders feature
    content), while DEFER_PAGES let CMF.boots() inject it after the first
    render.

    The boot tag must take the position of the FIRST removed module script:
    inserting it before </body> instead leaves inline boots() callers (e.g.
    about.html) running against an undefined window.CMF."""
    rewritten = 0
    for html in SITE_DIR.glob("*.html"):
        text = html.read_text(encoding="utf-8")
        lines = text.splitlines(keepends=True)
        first_removed = next(
            (
                i
                for i, l in enumerate(lines)
                if '<script src="js/' in l and "js/page-" not in l
            ),
            None,
        )
        if first_removed is None:
            continue
        first_page = next(
            (i for i, l in enumerate(lines) if '<script src="js/page-' in l),
            len(lines),
        )
        tags = [f'  <script src="{BOOT_BUNDLE}"></script>\n']
        if html.name not in DEFER_PAGES:
            tags.append(f'  <script src="{FEATURE_BUNDLE}"></script>\n')
        kept = [l for l in lines if '<script src="js/' not in l or "js/page-" in l]
        kept[min(first_removed, first_page):min(first_removed, first_page)] = tags
        _retry(lambda html=html, kept=kept: html.write_text(
            "".join(kept), encoding="utf-8", newline="\n"
        ))
        rewritten += 1
    return rewritten


CORE_PREFETCH_TAG = (
    '  <script>window.__cmfCore=fetch("data/core.json",{cache:"no-cache"})'
    '.then(function(r){if(!r.ok)throw new Error("加载失败: data/core.json");'
    "return r.json()});</script>"
)


def _inject_core_prefetch() -> int:
    """Start the core-data fetch while the HTML is still parsing. Without
    this hook store.js only calls fetch() after bundle.js (~200 KB) has
    downloaded AND executed — on the slow-3G profile the data wave starts
    ~6.4 s in and the wall pays ~2.3 s of avoidable serialization. The
    inline script lets core.json download in parallel with the bundle;
    store.js consumes window.__cmfCore when present. Every page boots
    through CMF.boots -> CMF.preload, so all nine get the tag."""
    injected = 0
    for html in SITE_DIR.glob("*.html"):
        text = html.read_text(encoding="utf-8")
        if "window.__cmfCore" in text or "<head>" not in text:
            continue
        _retry(lambda html=html, text=text: html.write_text(
            text.replace("<head>", "<head>\n" + CORE_PREFETCH_TAG, 1),
            encoding="utf-8", newline="\n",
        ))
        injected += 1
    return injected


"""Precompressed-asset policy: every text asset >= 1 KB gets a sibling .gz
(and .br when the optional brotli module is installed) so static hosts with
gzip_static / brotli_static (and the local `run.py serve`) can answer with
Content-Encoding instead of compressing per request. mtime=0 keeps .gz
bytes deterministic across rebuilds."""
COMPRESS_SUFFIXES: frozenset = frozenset(
    {".html", ".css", ".js", ".json", ".svg", ".webmanifest", ".ics"}
)
COMPRESS_MIN_BYTES = 1024


def compress_site_assets() -> dict:
    """Write deterministic .gz (always) and .br (optional) siblings for the
    deployable text assets. Returns {"gz": n, "br": n, "saved_pct": pct}."""
    import gzip

    try:
        import brotli
    except ImportError:
        brotli = None

    gz_count = 0
    br_count = 0
    raw_total = 0
    best_total = 0
    for path in sorted(SITE_DIR.rglob("*")):
        if (
            not path.is_file()
            or path.suffix not in COMPRESS_SUFFIXES
            or path.name.endswith((".gz", ".br"))
        ):
            continue
        data = path.read_bytes()
        if len(data) < COMPRESS_MIN_BYTES:
            continue
        raw_total += len(data)
        gz_data = gzip.compress(data, compresslevel=9, mtime=0)
        _retry(lambda path=path, gz_data=gz_data: path.with_name(
            path.name + ".gz"
        ).write_bytes(gz_data))
        gz_count += 1
        best = len(gz_data)
        if brotli is not None:
            br_data = brotli.compress(data, quality=11)
            _retry(lambda path=path, br_data=br_data: path.with_name(
                path.name + ".br"
            ).write_bytes(br_data))
            br_count += 1
            best = min(best, len(br_data))
        best_total += best
    saved = round((1 - best_total / raw_total) * 100, 1) if raw_total else 0.0
    return {"gz": gz_count, "br": br_count, "saved_pct": saved}


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
    # Pages removed from web/ must disappear from the deployable site too;
    # otherwise deleted pages keep being served forever.
    keep_html = {p.name for p in WEB_DIR.glob("*.html")}
    for stale in SITE_DIR.glob("*.html"):
        if stale.name not in keep_html:
            stale.unlink()
    for extra in ("sw.js", "manifest.webmanifest", "icon.svg"):
        src = WEB_DIR / extra
        if src.exists():
            _retry(
                lambda src=src, extra=extra: shutil.copy2(
                    src, SITE_DIR / extra
                )
            )
    # Launcher icons (PWA): copy and prune like pages so renames never linger.
    for icon in WEB_DIR.glob("icon-*.png"):
        _retry(lambda icon=icon: shutil.copy2(icon, SITE_DIR / icon.name))
    keep_icons = {p.name for p in WEB_DIR.glob("icon-*.png")}
    for stale in SITE_DIR.glob("icon-*.png"):
        if stale.name not in keep_icons:
            stale.unlink()

    # Version the service worker cache so each release invalidates old caches.
    sw_target = SITE_DIR / "sw.js"
    if sw_target.exists():
        version = datetime.now(timezone.utc).strftime("%Y%m%d%H%M%S")
        text = sw_target.read_text(encoding="utf-8")
        if "cmf-cache-v1" not in text:
            # str.replace is silent when the marker is absent; a renamed marker
            # would freeze cache invalidation forever, so fail the build.
            raise RuntimeError(
                "sw.js 缺少 cmf-cache-v1 缓存标记，版本注入失败；"
                "若有意改名请同步更新 build.py 的注入标记。"
            )
        _retry(
            lambda: sw_target.write_text(
                text.replace("cmf-cache-v1", f"cmf-cache-{version}"),
                encoding="utf-8",
                newline="\n",
            )
        )


def build_site() -> dict:
    copy_web_assets()
    bundle_bytes = build_js_bundle()
    rewritten = _rewrite_html_bundles()
    prefetched = _inject_core_prefetch()
    # The build owns site/data wholesale; rebuild it from scratch so orphaned
    # shards from older versions never linger in the deployable output.
    data_dir = SITE_DIR / "data"
    if data_dir.exists():
        _retry(lambda: shutil.rmtree(data_dir))
    catalog_payload = export_catalog()
    recipes = export_recipes()
    export_core(catalog_payload)
    ai = export_ai_cache()
    compressed = compress_site_assets()
    summary = {
        "recipes": len(recipes),
        "ingredients": len(catalog_payload["ingredients"]),
        "ai_cards": ai,
        "boot_kb": round(bundle_bytes["boot"] / 1024, 1),
        "features_kb": round(bundle_bytes["features"] / 1024, 1),
        "html_bundled": rewritten,
        "html_prefetch": prefetched,
        "precompressed": compressed,
        "site_dir": str(SITE_DIR),
    }
    return summary
