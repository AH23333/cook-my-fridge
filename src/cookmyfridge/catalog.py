"""Read-side API over the authored ingredient taxonomy."""
from __future__ import annotations

from functools import lru_cache

from .catalog_data import INGREDIENTS, NUTRITION_FLAGS, PANTRY_STAPLES, SUBSTITUTIONS


@lru_cache(maxsize=1)
def catalog_entries() -> list[dict]:
    return [
        {
            "canonical": canonical,
            "category": category,
            "emoji": emoji,
            "synonyms": synonyms,
            "allergens": allergens,
            "nutrition": nutrition_of(canonical),
        }
        for canonical, category, emoji, synonyms, allergens in INGREDIENTS
    ]


@lru_cache(maxsize=1)
def synonym_map() -> dict[str, str]:
    """Map every known name (canonical + synonyms) to the canonical name."""
    mapping: dict[str, str] = {}
    for canonical, _category, _emoji, synonyms, _allergens in INGREDIENTS:
        mapping[canonical] = canonical
        for syn in synonyms:
            mapping[syn] = canonical
    return mapping


@lru_cache(maxsize=1)
def canonical_set() -> set[str]:
    return {canonical for canonical, *_ in INGREDIENTS}


@lru_cache(maxsize=1)
def category_map() -> dict[str, str]:
    return {canonical: category for canonical, category, *_ in INGREDIENTS}


@lru_cache(maxsize=1)
def emoji_map() -> dict[str, str]:
    return {canonical: emoji for canonical, _category, emoji, *_ in INGREDIENTS}


@lru_cache(maxsize=1)
def allergen_map() -> dict[str, list[str]]:
    return {canonical: allergens for canonical, _c, _e, _s, allergens in INGREDIENTS}


def category_of(canonical: str) -> str:
    return category_map().get(canonical, "其他")


def emoji_of(canonical: str) -> str:
    return emoji_map().get(canonical, "🍽️")


def allergens_of(canonical: str) -> list[str]:
    return allergen_map().get(canonical, [])


def ingredients_by_category(category: str) -> list[dict]:
    return [entry for entry in catalog_entries() if entry["category"] == category]


def substitutions_for(canonical: str) -> list[dict]:
    rows = SUBSTITUTIONS.get(canonical, [])
    return [{"canonical": alt, "reason": reason} for alt, reason in rows]


def is_known(canonical: str) -> bool:
    return canonical in canonical_set()


def is_pantry_staple(canonical: str) -> bool:
    return canonical in PANTRY_STAPLES


@lru_cache(maxsize=1)
def nutrition_map() -> dict[str, list[str]]:
    return dict(NUTRITION_FLAGS)


def nutrition_of(canonical: str) -> list[str]:
    return nutrition_map().get(canonical, [])
