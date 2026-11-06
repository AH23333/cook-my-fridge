"""Search engine tests: classification, ranking, filters, substitutions."""
from cookmyfridge.dataset import load_recipes
from cookmyfridge.models import IngredientUse, Recipe
from cookmyfridge.search import SearchFilters, SearchIndex


def synth_recipe(rid: str, canonicals: list[str], methods=None, **kw) -> Recipe:
    return Recipe(
        id=rid,
        title=f"菜{rid}",
        ingredients=[IngredientUse(name=c, canonical=c) for c in canonicals],
        steps=["s1"],
        methods=methods or ["炒"],
        time_minutes=kw.get("time_minutes", 10),
        difficulty=kw.get("difficulty", "简单"),
        tags=kw.get("tags", []),
    )


def test_empty_selection_returns_nothing():
    index = SearchIndex(load_recipes())
    result = index.search([])
    assert result.cook_now == [] and result.almost_there == []


def test_unknown_ingredient_returns_nothing():
    index = SearchIndex(load_recipes())
    result = index.search(["不存在的食材"])
    assert result.all_matches == []


def test_full_ingredient_set_is_cook_now_zero_missing():
    recipes = load_recipes()
    index = SearchIndex(recipes)
    r001 = next(r for r in recipes if r.id == "r001")
    result = index.search(r001.canonical_ingredients)
    top = next(m for m in result.cook_now if m.recipe.id == "r001")
    assert top.missing_count == 0
    assert top.bucket == "cook_now"
    assert top.coverage == 1.0


def test_staple_seasoning_does_not_count_as_missing():
    recipes = [synth_recipe("x1", ["番茄", "鸡蛋", "盐"])]
    index = SearchIndex(recipes)
    result = index.search(["番茄", "鸡蛋"])
    match = result.cook_now[0]
    assert match.missing == []
    assert match.missing_staples == ["盐"]
    assert match.missing_count == 0


def test_one_main_missing_classifies_almost():
    recipes = [synth_recipe("x1b", ["番茄", "鸡蛋", "土豆"])]
    index = SearchIndex(recipes)
    result = index.search(["番茄", "鸡蛋"])
    assert result.cook_now == []
    assert result.almost_there[0].missing == ["土豆"]


def test_two_to_three_missing_classifies_almost():
    recipes = [synth_recipe("x2", ["番茄", "鸡蛋", "土豆", "黄瓜"])]
    index = SearchIndex(recipes)
    result = index.search(["番茄", "鸡蛋"])
    assert result.cook_now == []
    assert len(result.almost_there) == 1
    assert result.almost_there[0].missing_count == 2


def test_more_than_three_missing_is_excluded():
    recipes = [synth_recipe(
        "x3", ["番茄", "鸡蛋", "土豆", "黄瓜", "胡萝卜", "盐"]
    )]
    index = SearchIndex(recipes)
    result = index.search(["番茄"])
    assert result.all_matches == []


def test_ranking_prefers_fewer_missing_then_more_matched():
    recipes = [
        synth_recipe("a", ["番茄", "鸡蛋", "土豆", "黄瓜"]),   # 2 missing
        synth_recipe("b", ["番茄", "鸡蛋"]),                   # 0 missing
    ]
    index = SearchIndex(recipes)
    result = index.search(["番茄", "鸡蛋"])
    assert result.cook_now[0].recipe.id == "b"
    assert result.almost_there[0].recipe.id == "a"


def test_method_filter():
    recipes = load_recipes()
    index = SearchIndex(recipes)
    result = index.search(["鸡蛋"], SearchFilters(methods=["蒸"]))
    assert all(
        "蒸" in m.recipe.methods for m in result.all_matches
    )


def test_time_filter():
    recipes = load_recipes()
    index = SearchIndex(recipes)
    result = index.search(
        ["鸡蛋"], SearchFilters(max_time_minutes=15)
    )
    assert all(m.recipe.time_minutes <= 15 for m in result.all_matches)


def test_difficulty_and_tag_filters():
    recipes = load_recipes()
    index = SearchIndex(recipes)
    result = index.search(
        ["鸡蛋"], SearchFilters(difficulty=["简单"], tags=["快手"])
    )
    for match in result.all_matches:
        assert match.recipe.difficulty == "简单"
        assert "快手" in match.recipe.tags


def test_missing_substitutions_attached():
    recipes = [synth_recipe("s1", ["黄油", "盐"])]
    index = SearchIndex(recipes)
    result = index.search(["盐"])
    match = result.almost_there[0]
    assert "黄油" in match.missing_substitutions
    assert match.missing_substitutions["黄油"][0]["canonical"]


def test_optional_ingredients_not_required():
    recipe = synth_recipe("o1", ["盐"])
    recipe.ingredients.append(
        IngredientUse(name="香菜", canonical="香菜", optional=True)
    )
    index = SearchIndex([recipe])
    result = index.search(["盐"])
    assert result.cook_now[0].missing_count == 0


def test_cook_now_always_zero_missing_acceptance_metric():
    index = SearchIndex(load_recipes())
    queries = [
        ["鸡蛋", "番茄"],
        ["米饭", "鸡蛋", "火腿肠"],
        ["土豆", "猪肉", "青椒"],
        ["鸡胸肉", "生菜", "黄瓜"],
        ["面条", "鸡蛋", "小白菜"],
    ]
    total = 0
    for query in queries:
        result = index.search(query)
        assert all(m.missing_count == 0 for m in result.cook_now)
        total += len(result.cook_now)
    assert total > 0  # 确保测试真的覆盖到结果


def test_inverted_index_structure():
    index = SearchIndex(load_recipes())
    assert "r001" in index.inverted["番茄"]
    assert "r001" in index.method_index["炒"]
