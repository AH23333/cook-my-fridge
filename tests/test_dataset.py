"""Curated dataset build/load tests."""
import json

from cookmyfridge.dataset import (
    ALL_SPECS,
    build_curated_recipes,
    load_recipes,
    load_shipped_recipes,
    write_curated,
)


def test_all_specs_build_and_validate():
    recipes = build_curated_recipes()
    assert len(recipes) == len(ALL_SPECS)
    ids = [r.id for r in recipes]
    assert len(ids) == len(set(ids))


def test_curated_titles_are_unique():
    titles = [r.title for r in build_curated_recipes()]
    assert len(titles) == len(set(titles))


def test_allergens_auto_derived():
    recipes = {r.id: r for r in build_curated_recipes()}
    assert "鸡蛋" in recipes["r001"].allergens
    assert recipes["r003"].allergens == []


def test_safety_notes_for_risky_methods():
    recipes = {r.id: r for r in build_curated_recipes()}
    assert recipes["r011"].safety_notes
    assert any("蒸" in n for n in recipes["r011"].safety_notes)


def test_write_and_load_roundtrip(tmp_path):
    target = tmp_path / "recipes.jsonl"
    write_curated(target)
    loaded = load_recipes(target)
    assert len(loaded) == len(ALL_SPECS)
    assert loaded[0].title == build_curated_recipes()[0].title


def test_provenance_fields_present():
    for recipe in build_curated_recipes():
        assert recipe.source
        assert recipe.license
        assert recipe.is_ai_generated is False


def test_imported_shard_tolerates_corrupt_lines(tmp_path):
    """A truncated imported shard must not break the whole site build."""
    good = {
        "id": "pub-good",
        "title": "导入分片正常菜",
        "ingredients": [
            {"name": "番茄", "canonical": "番茄", "amount": "1 个", "optional": False},
            {"name": "鸡蛋", "canonical": "鸡蛋", "amount": "1 个", "optional": False},
        ],
        "steps": ["第一步", "第二步"],
        "methods": ["煮"],
    }
    shard = tmp_path / "imported.jsonl"
    shard.write_text(
        json.dumps(good, ensure_ascii=False)
        + '\n{"id": "pub-truncated", "title": "半截'
        + "\n \n",
        encoding="utf-8",
    )
    recipes = load_shipped_recipes(imported_path=shard)
    assert any(r.id == "pub-good" for r in recipes)
    assert not any(r.id == "pub-truncated" for r in recipes)
