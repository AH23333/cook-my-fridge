"""Curated dataset build/load tests."""
from cookmyfridge.dataset import ALL_SPECS, build_curated_recipes, load_recipes, write_curated


def test_all_specs_build_and_validate():
    recipes = build_curated_recipes()
    assert len(recipes) == len(ALL_SPECS)
    ids = [r.id for r in recipes]
    assert len(ids) == len(set(ids))


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
