"""Tests for AI cache repair and scalar-to-list coercion."""
from cookmyfridge.ai import _as_list
from cookmyfridge.batch import repair_safety_notes, repair_variant_title


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


def test_variant_title_gets_kind_suffix():
    assert repair_variant_title("ai-var-r001-lazy", "番茄炒蛋") == "懒人版番茄炒蛋"
    assert repair_variant_title("ai-var-r003-airfryer", "可乐鸡翅") == "空气炸锅版可乐鸡翅"


def test_variant_title_unchanged_when_already_marked():
    assert repair_variant_title("ai-var-r001-lazy", "懒人版番茄炒蛋") == "懒人版番茄炒蛋"


def test_variant_title_unknown_kind_unchanged():
    assert repair_variant_title("ai-var-r001-weird", "菜") == "菜"
