"""Tests for AI cache repair and scalar-to-list coercion."""
from cookmyfridge.ai import _as_list
from cookmyfridge.batch import repair_safety_notes


def test_as_list_wraps_scalar():
    assert _as_list("注意不要炒糊") == ["注意不要炒糊"]
    assert _as_list(None) == []
    assert _as_list(["a", "b"]) == ["a", "b"]
    assert _as_list(123) == [123]


def test_repair_joins_single_character_run():
    notes = ["AI 免责声明", "注", "意", "不", "要", "炒", "糊"]
    fixed = repair_safety_notes(notes)
    assert fixed == ["AI 免责声明", "注意不要炒糊"]


def test_repair_keeps_real_sentences_and_joins_around_them():
    notes = ["免责", "注", "意", "油炸请控温防止烫伤", "小", "心"]
    fixed = repair_safety_notes(notes)
    assert fixed == ["免责", "注意", "油炸请控温防止烫伤", "小心"]


def test_repair_drops_meaningless_markers():
    notes = ["免责", "无", "无风险"]
    assert repair_safety_notes(notes) == ["免责"]


def test_repair_handles_empty_and_non_list():
    assert repair_safety_notes([]) == []
    assert repair_safety_notes("x") == "x"
