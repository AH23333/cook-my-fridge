"""Offline tests for AI payload conversion and whitelist enforcement.

Live generation tests are opt-in via RUN_LIVE=1 in test_ai_live.py.
"""
import os

import pytest

from cookmyfridge.ai import (
    AIGenerationError,
    _recipe_from_payload,
)


def valid_payload(**overrides) -> dict:
    payload = {
        "title": "测试创意菜",
        "ingredients": [
            {"name": "番茄", "amount": "1 个"},
            {"name": "鸡蛋", "amount": "1 个"},
        ],
        "steps": ["打蛋", "下锅炒"],
        "methods": ["炒"],
        "cookware": ["炒锅"],
        "time_minutes": 10,
        "difficulty": "简单",
        "tags": ["快手"],
        "risks": ["注意火候"],
    }
    payload.update(overrides)
    return payload


def test_valid_payload_builds_recipe():
    recipe = _recipe_from_payload(valid_payload(), "ai-test-1")
    assert recipe.id == "ai-test-1"
    assert recipe.is_ai_generated is True
    assert any("AI 创意菜" in n for n in recipe.safety_notes)
    assert "鸡蛋" in recipe.allergens


def test_unknown_ingredient_rejected():
    payload = valid_payload(
        ingredients=[{"name": "火星辣椒", "amount": "1"}]
    )
    with pytest.raises(AIGenerationError, match="目录外食材"):
        _recipe_from_payload(payload, "ai-test-2")


def test_synonym_ingredient_normalized():
    payload = valid_payload(
        ingredients=[{"name": "西红柿", "amount": "2 个"}]
    )
    recipe = _recipe_from_payload(payload, "ai-test-3")
    assert recipe.ingredients[0].canonical == "番茄"


def test_missing_required_context_rejected():
    payload = valid_payload()
    with pytest.raises(AIGenerationError, match="没有覆盖指定食材"):
        _recipe_from_payload(
            payload, "ai-test-4", include_ingredients={"土豆"}
        )


def test_duplicate_ingredients_deduped():
    payload = valid_payload(
        ingredients=[
            {"name": "番茄", "amount": "1"},
            {"name": "西红柿", "amount": "1"},
        ]
    )
    recipe = _recipe_from_payload(payload, "ai-test-5")
    assert len(recipe.ingredients) == 1


def test_bad_tags_fail_validation():
    payload = valid_payload(tags=["自创标签"])
    with pytest.raises(AIGenerationError):
        _recipe_from_payload(payload, "ai-test-6")


def test_method_safety_auto_attached():
    payload = valid_payload(methods=["炸"])
    recipe = _recipe_from_payload(payload, "ai-test-7")
    assert any("油炸" in n for n in recipe.safety_notes)


def test_method_alias_normalized():
    payload = valid_payload(methods=["拌"])
    recipe = _recipe_from_payload(payload, "ai-test-8")
    assert recipe.methods == ["凉拌"]


def test_tag_alias_normalized():
    payload = valid_payload(tags=["快手菜"])
    recipe = _recipe_from_payload(payload, "ai-test-9")
    assert recipe.tags == ["快手"]
