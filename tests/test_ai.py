"""Offline tests for AI payload conversion and whitelist enforcement.

Live generation tests are opt-in via RUN_LIVE=1 in test_ai_live.py.
"""
import os

import pytest

from cookmyfridge.ai import (
    AIEngine,
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


def test_time_minutes_coerced_from_text():
    recipe = _recipe_from_payload(valid_payload(time_minutes="约20分钟"), "ai-test-10")
    assert recipe.time_minutes == 20


def test_time_minutes_missing_is_zero():
    payload = valid_payload()
    del payload["time_minutes"]
    recipe = _recipe_from_payload(payload, "ai-test-11")
    assert recipe.time_minutes == 0


def test_time_minutes_garbage_raises_generation_error():
    # Must surface as AIGenerationError so the batch retry loop feeds it back
    # to the model, instead of a raw ValueError/TypeError killing the item.
    with pytest.raises(AIGenerationError, match="time_minutes"):
        _recipe_from_payload(valid_payload(time_minutes=["很久"]), "ai-test-12")
    with pytest.raises(AIGenerationError, match="time_minutes"):
        _recipe_from_payload(valid_payload(time_minutes="很快就好"), "ai-test-13")


class _StubClient:
    """Offline LLMClient stand-in: always returns the same payload."""

    def __init__(self, payload):
        self.payload = payload
        self.calls = 0
        self.seen_lengths = []

    def chat_json(self, messages, temperature=0.0):
        self.calls += 1
        self.seen_lengths.append(len(messages))
        return self.payload


def test_generate_recipe_retry_loop_is_bounded_and_gives_feedback():
    # Payload always contains an unknown ingredient -> validation fails every
    # time. The loop must stop after 1 + retries calls, carrying feedback.
    bad_payload = {
        "title": "坏菜",
        "ingredients": [{"name": "火星辣椒", "amount": "1"}],
        "steps": ["下锅。"],
        "methods": ["炒"],
    }
    client = _StubClient(bad_payload)
    engine = AIEngine(client=client)
    with pytest.raises(AIGenerationError, match="多次重试"):
        engine.generate_wildcard(["番茄"], recipe_id="ai-test-14")
    assert client.calls == 3  # 1 initial + 2 retries, never an unbounded loop
    assert client.seen_lengths == [2, 3, 4]  # one feedback message appended each round


def test_generate_recipe_succeeds_on_second_attempt():
    good_payload = {
        "title": "番茄蛋创意菜",
        "ingredients": [{"name": "番茄", "amount": "1 个"}],
        "steps": ["下锅。", "出锅。"],
        "methods": ["炒"],
    }
    responses = iter([
        {"title": "坏菜", "ingredients": [{"name": "火星辣椒"}], "steps": ["x"], "methods": ["炒"]},
        good_payload,
    ])

    class SeqClient:
        calls = 0

        def chat_json(self, messages, temperature=0.0):
            self.calls += 1
            return next(responses)

    seq = SeqClient()
    engine = AIEngine(client=seq)
    recipe = engine.generate_wildcard(["番茄"], recipe_id="ai-test-15")
    assert recipe.title == "番茄蛋创意菜"
    assert seq.calls == 2
