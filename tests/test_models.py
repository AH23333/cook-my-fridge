"""Model serialization round-trip tests."""
from cookmyfridge.models import IngredientUse, Recipe


def test_recipe_round_trip():
    recipe = Recipe(
        id="r-1",
        title="测试菜",
        ingredients=[IngredientUse(name="西红柿", canonical="番茄", amount="2 个")],
        steps=["第一步", "第二步"],
        methods=["炒", "煮"],
        tags=["快手"],
        time_minutes=15,
        is_ai_generated=False,
    )
    encoded = recipe.to_dict()
    restored = Recipe.from_dict(encoded)
    assert restored.to_dict() == encoded
    assert restored.canonical_ingredients == ["番茄"]


def test_optional_ingredients_excluded_from_canonical_list():
    recipe = Recipe(
        id="r-2",
        title="可选菜",
        ingredients=[
            IngredientUse(name="盐", canonical="盐"),
            IngredientUse(name="香菜", canonical="香菜", optional=True),
        ],
        steps=["做"],
        methods=["凉拌"],
    )
    assert recipe.canonical_ingredients == ["盐"]
