"""Validation tests covering the acceptance and rejection paths."""
from cookmyfridge.models import IngredientUse, Recipe
from cookmyfridge.validate import validate_recipe, vocabulary_snapshot


def make_recipe(**overrides) -> Recipe:
    base = Recipe(
        id="r-test-1",
        title="番茄炒蛋",
        ingredients=[
            IngredientUse(name="番茄", canonical="番茄", amount="2 个"),
            IngredientUse(name="鸡蛋", canonical="鸡蛋", amount="2 个"),
        ],
        steps=["番茄切块，鸡蛋打散。", "热油，先炒蛋再下番茄。"],
        methods=["炒"],
        time_minutes=10,
        difficulty="简单",
        tags=["快手", "下饭"],
    )
    for key, value in overrides.items():
        setattr(base, key, value)
    return base


def test_valid_recipe_passes():
    result = validate_recipe(make_recipe())
    assert result.ok, result.errors


def test_missing_core_fields_fail():
    recipe = make_recipe(title="", steps=[], ingredients=[], methods=[])
    result = validate_recipe(recipe)
    assert not result.ok
    joined = " ".join(result.errors)
    assert "title" in joined
    assert "ingredients" in joined
    assert "steps" in joined
    assert "methods" in joined


def test_unknown_ingredient_rejected():
    recipe = make_recipe(
        ingredients=[IngredientUse(name="火星瓜", canonical="火星瓜")]
    )
    result = validate_recipe(recipe)
    assert not result.ok
    assert "白名单" in " ".join(result.errors)


def test_duplicate_ingredient_rejected():
    recipe = make_recipe(
        ingredients=[
            IngredientUse(name="番茄", canonical="番茄"),
            IngredientUse(name="西红柿", canonical="番茄"),
        ]
    )
    result = validate_recipe(recipe)
    assert not result.ok
    assert "重复" in " ".join(result.errors)


def test_bad_method_and_difficulty():
    recipe = make_recipe(methods=["爆炒"], difficulty="地狱")
    result = validate_recipe(recipe)
    assert not result.ok
    joined = " ".join(result.errors)
    assert "烹饪方式" in joined
    assert "难度" in joined


def test_ai_recipe_requires_safety_notes():
    recipe = make_recipe(is_ai_generated=True, safety_notes=[])
    result = validate_recipe(recipe)
    assert not result.ok
    assert "safety_notes" in " ".join(result.errors)


def test_vocabulary_snapshot():
    vocab = vocabulary_snapshot()
    assert "炒" in vocab["methods"]
    assert "蔬菜" in vocab["categories"]
