"""Offline enrichment for newly added recipes.

The AI cache is normally produced by GLM batch jobs. Adding a batch of curated
recipes should not leave dead "not generated yet" buttons, and it must not
silently relabel deterministic templates as AI output. This module fills only
*missing* cache entries with clearly-labelled rule-based reference variants,
and never touches an existing AI-generated card.
"""
from __future__ import annotations

import json
from pathlib import Path

from .batch import CACHE_DIR, VARIANT_TITLE_SUFFIX
from .dataset import load_shipped_recipes

RULE_SOURCE = "规则生成（离线模板，非 AI 实测）"
RULE_LICENSE = "CookMyFridge rule-based, see About"
RULE_SAFETY = "规则生成的参考变体，非 AI 实测。请确保食材新鲜、彻底加热，注意过敏原。"

# (title suffix, extra step, method override, time multiplier, extra tag)
VARIANT_RULES: dict[str, tuple[str, str, str | None, float, str | None]] = {
    "lazy": ("懒人版", "省去精细刀工，所有食材一次下锅，熟透即可。", None, 0.7, "快手"),
    "lowcal": ("低卡版", "少油少糖，改用不粘锅或水炒，出锅前再调味。", "煮", 0.9, "低卡"),
    "airfryer": ("空气炸锅版", "食材拌少许油，平铺进炸篮，180℃ 中途翻面一次。", "空气炸锅", 0.8, "空气炸锅"),
    "substitute": ("家常替代版", "缺哪样就用冰箱里同类食材等量替换，不必专程采购。", None, 1.0, None),
    "method": ("换做法版", "把原来的做法换成蒸或煮，少油但保持食材原味。", "蒸", 1.1, None),
    "leftover": ("剩菜改造版", "把剩菜回锅加热，补一点蔬菜或主食就是新的一餐。", "炒", 0.6, "剩菜改造"),
    "fusion": ("融合版", "起锅前加一点黑胡椒或柠檬汁，换个风味层次。", None, 1.0, "融合菜"),
}


def _variant_card(recipe, kind: str) -> dict:
    suffix, extra_step, method, factor, extra_tag = VARIANT_RULES[kind]
    methods = [method] if method else list(recipe.methods)
    tags = list(recipe.tags)
    if extra_tag and extra_tag not in tags:
        tags.append(extra_tag)
    steps = [
        f"按「{recipe.title}」备好食材，这一步与家常做法一致。",
        extra_step,
        "出锅前尝味调整咸淡，注意食材彻底加热后再食用。",
    ]
    return {
        "id": f"ai-var-{recipe.id}-{kind}",
        "title": f"{suffix}{recipe.title}",
        "ingredients": [i.to_dict() for i in recipe.ingredients],
        "steps": steps,
        "methods": methods,
        "cuisine": recipe.cuisine,
        "time_minutes": max(5, round(recipe.time_minutes * factor)),
        "difficulty": "简单",
        "cookware": list(recipe.cookware),
        "tags": tags[:6],
        "allergens": list(recipe.allergens),
        "safety_notes": [RULE_SAFETY],
        "source": RULE_SOURCE,
        "license": RULE_LICENSE,
        "is_ai_generated": True,  # shown in the AI card bucket, but labelled above
    }


def _ideas(recipe) -> dict:
    first = recipe.ingredients[0].canonical if recipe.ingredients else "时令蔬菜"
    return {
        "ideas": [
            f"{recipe.title}多放一份{first}，做成更饱腹的一人食。",
            f"把{recipe.title}的调味减半，配一碗杂粮饭。",
            f"{recipe.title}放凉后做便当，吃前彻底加热。",
        ]
    }


def _load(path: Path) -> dict:
    if not path.exists():
        return {}
    return json.loads(path.read_text(encoding="utf-8"))


def _save(path: Path, payload: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        json.dumps(payload, ensure_ascii=False, indent=1) + "\n",
        encoding="utf-8",
    )


def enrich_missing(cache_dir: Path = CACHE_DIR, dry_run: bool = False) -> dict:
    """Fill missing variants/ideas; returns counts. Never overwrites AI cards."""
    recipes = load_shipped_recipes()
    variants_path = cache_dir / "variants.json"
    ideas_path = cache_dir / "ideas.json"
    variants = _load(variants_path)
    ideas = _load(ideas_path)
    added_variants = 0
    added_ideas = 0

    for recipe in recipes:
        for kind in VARIANT_TITLE_SUFFIX:
            key = f"{recipe.id}:{kind}"
            if key not in variants:
                variants[key] = _variant_card(recipe, kind)
                added_variants += 1
        if recipe.id not in ideas:
            ideas[recipe.id] = _ideas(recipe)
            added_ideas += 1

    if not dry_run and (added_variants or added_ideas):
        _save(variants_path, variants)
        _save(ideas_path, ideas)
    return {
        "recipes": len(recipes),
        "variants_added": added_variants,
        "ideas_added": added_ideas,
        "variants_total": len(variants),
        "ideas_total": len(ideas),
        "dry_run": bool(dry_run),
    }
