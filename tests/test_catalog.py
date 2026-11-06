"""Taxonomy integrity tests."""
from cookmyfridge.catalog import (
    allergens_of,
    catalog_entries,
    category_of,
    emoji_of,
    is_known,
    substitutions_for,
    synonym_map,
)
from cookmyfridge.catalog_data import INGREDIENTS, SUBSTITUTIONS
from cookmyfridge.models import INGREDIENT_CATEGORIES


def test_canonical_names_unique():
    names = [row[0] for row in INGREDIENTS]
    assert len(names) == len(set(names))


def test_synonyms_are_unambiguous():
    seen: dict[str, str] = {}
    for canonical, _c, _e, synonyms, _a in INGREDIENTS:
        for name in [canonical, *synonyms]:
            assert name not in seen, f"{name} 同时映射到 {seen.get(name)} 和 {canonical}"
            seen[name] = canonical


def test_all_categories_valid():
    for _canonical, category, *_ in INGREDIENTS:
        assert category in INGREDIENT_CATEGORIES


def test_every_category_populated():
    present = {row[1] for row in INGREDIENTS}
    assert present == set(INGREDIENT_CATEGORIES)


def test_known_lookups():
    assert is_known("番茄")
    assert not is_known("火星果")
    assert category_of("番茄") == "蔬菜"
    assert emoji_of("鸡蛋") == "🥚"


def test_synonym_map_resolves():
    assert synonym_map()["西红柿"] == "番茄"
    assert synonym_map()["马铃薯"] == "土豆"


def test_allergen_marking():
    assert "鸡蛋" in allergens_of("鸡蛋")
    assert allergens_of("白菜") == []


def test_substitution_targets_known():
    for source, alts in SUBSTITUTIONS.items():
        assert is_known(source), f"替代表源头未知: {source}"
        for alt, reason in alts:
            assert is_known(alt), f"{source} 的替代目标未知: {alt}"
            assert reason


def test_substitution_api():
    alts = substitutions_for("黄油")
    assert alts and all("canonical" in a and "reason" in a for a in alts)
    assert substitutions_for("不存在的食材") == []
