"""Tests for AI cache repair and scalar-to-list coercion."""
import json

from cookmyfridge import batch
from cookmyfridge.ai import _as_list
from cookmyfridge.batch import (
    clean_variant_title,
    repair_safety_notes,
    repair_variant_title,
)


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


def test_variant_title_accepts_root_marker():
    assert repair_variant_title("ai-var-r001-lazy", "懒人番茄炒蛋") == "懒人番茄炒蛋"
    assert repair_variant_title("ai-var-r002-lowcal", "低卡蛋炒饭") == "低卡蛋炒饭"


def test_clean_variant_title_collapses_redundant_prefix():
    assert clean_variant_title("ai-var-r001-lazy", "懒人版懒人番茄炒蛋") == "懒人番茄炒蛋"
    assert (
        clean_variant_title("ai-var-r003-airfryer", "空气炸锅版空气炸锅土豆丝")
        == "空气炸锅土豆丝"
    )
    # Plain title still gets a marker.
    assert clean_variant_title("ai-var-r001-lazy", "番茄炒蛋") == "懒人版番茄炒蛋"


def test_prune_failures_removes_recovered_keeps_real(tmp_path, monkeypatch):
    cache_dir = tmp_path / "ai_cache"
    cache_dir.mkdir()
    (cache_dir / "variants.json").write_text(
        json.dumps({"r001:lazy": {"id": "x"}}, ensure_ascii=False), encoding="utf-8"
    )
    (cache_dir / "ideas.json").write_text("{}", encoding="utf-8")
    (cache_dir / "wildcards.json").write_text("{}", encoding="utf-8")
    (cache_dir / "blindboxes.json").write_text("{}", encoding="utf-8")
    (cache_dir / "failures.json").write_text(
        json.dumps(
            {
                "variants:r001:lazy": {"error": "old"},
                "ideas:r009": {"error": "still broken"},
            },
            ensure_ascii=False,
        ),
        encoding="utf-8",
    )
    monkeypatch.setattr(batch, "CACHE_DIR", cache_dir)
    report = batch.prune_failures()
    assert report["removed"] == 1
    assert report["remaining"] == 1
    remaining = json.loads((cache_dir / "failures.json").read_text(encoding="utf-8"))
    assert list(remaining) == ["ideas:r009"]
