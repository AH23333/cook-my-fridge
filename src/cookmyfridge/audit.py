"""Offline data integrity audit.

Runs without network access: validates the curated dataset and every AI cache
against the catalog and reports a structured list of problems plus counts.
"""
from __future__ import annotations

import json

from .batch import CACHE_DIR, VARIANT_TITLE_MARKERS, VARIANT_TITLE_SUFFIX
from .catalog import canonical_set
# Alias keeps the historical ``audit.load_recipes`` patch point used by tests
# while auditing *all* shipped shards (curated + validated public imports).
from .dataset import load_shipped_recipes as load_recipes
from .nutrition import nutrition_facts_payload, validate_nutrition

_VARIANT_KINDS = set(VARIANT_TITLE_SUFFIX)


def _load_cache(name: str) -> dict:
    path = CACHE_DIR / f"{name}.json"
    if not path.exists():
        return {}
    return json.loads(path.read_text(encoding="utf-8"))


def run_audit() -> dict:
    problems: list[str] = []
    recipes = load_recipes()
    known = canonical_set()
    recipe_ids = {r.id for r in recipes}

    # 1. Unique titles.
    titles = [r.title for r in recipes]
    if len(titles) != len(set(titles)):
        dupes = sorted({t for t in titles if titles.count(t) > 1})
        problems.append(f"菜谱标题重复: {dupes}")

    # 2. Every ingredient line resolves to a known canonical, with no dupes.
    for r in recipes:
        canonicals = [use.canonical for use in r.ingredients]
        for canonical in canonicals:
            if canonical not in known:
                problems.append(f"{r.id} 含目录外食材: {canonical}")
        if len(canonicals) != len(set(canonicals)):
            dupes = sorted({c for c in canonicals if canonicals.count(c) > 1})
            problems.append(f"{r.id} 菜谱内食材重复: {dupes}")

    # 3. Variant keys reference a real recipe and a valid kind.
    variants = _load_cache("variants")
    for key, value in variants.items():
        if ":" not in key:
            problems.append(f"变体键格式错误: {key}")
            continue
        rid, kind = key.split(":", 1)
        if rid not in recipe_ids:
            problems.append(f"变体指向不存在的菜谱: {key}")
        if kind not in _VARIANT_KINDS:
            problems.append(f"变体 kind 非法: {key}")
        markers = VARIANT_TITLE_MARKERS.get(kind, (VARIANT_TITLE_SUFFIX.get(kind),))
        if isinstance(value, dict) and not any(
            m in value.get("title", "") for m in markers
        ):
            problems.append(f"变体标题缺少 kind 标记: {key}")

    # 4. Ideas keys reference real recipes.
    ideas = _load_cache("ideas")
    for key in ideas:
        if key not in recipe_ids:
            problems.append(f"ideas 指向不存在的菜谱: {key}")

    # 5. No residual single-character safety notes in any cache.
    for name in ("wildcards", "blindboxes", "variants"):
        for key, value in _load_cache(name).items():
            notes = value.get("safety_notes", []) if isinstance(value, dict) else []
            if any(isinstance(n, str) and len(n.strip()) <= 1 for n in notes):
                problems.append(f"{name}:{key} 残留单字安全提示")

    # 6. Every AI card ingredient resolves to a known canonical, with no dupes.
    for name in ("wildcards", "blindboxes", "variants"):
        for key, value in _load_cache(name).items():
            if not isinstance(value, dict):
                continue
            canonicals = [
                row.get("canonical") for row in value.get("ingredients", [])
            ]
            for canonical in canonicals:
                if canonical not in known:
                    problems.append(f"{name}:{key} 含目录外食材: {canonical}")
            if len(canonicals) != len(set(canonicals)):
                dupes = sorted({c for c in canonicals if canonicals.count(c) > 1})
                problems.append(f"{name}:{key} 食材重复: {dupes}")

    # 7. Nutrition table covers the whole catalog with sane values.
    problems.extend(validate_nutrition())

    return {
        "ok": not problems,
        "problems": problems,
        "counts": {
            "recipes": len(recipes),
            "ingredients": len(known),
            "nutrition_facts": len(nutrition_facts_payload()["per100g"]),
            "wildcards": len(_load_cache("wildcards")),
            "blindboxes": len(_load_cache("blindboxes")),
            "variants": len(variants),
            "ideas": len(ideas),
        },
    }
