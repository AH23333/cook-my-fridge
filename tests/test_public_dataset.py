"""Tests for the public-dataset import pipeline and offline enrichment."""
from __future__ import annotations

import json
import os
import stat
import threading
from pathlib import Path

import pytest

from cookmyfridge.dataset import load_shipped_recipes
from cookmyfridge.enrich import RULE_SOURCE, enrich_missing
from cookmyfridge.public_dataset import (
    import_dataset,
    map_record,
    parse_list,
    read_records,
)
from cookmyfridge.catalog import canonical_set

SAMPLE = Path(__file__).resolve().parents[1] / "data" / "raw" / "sample_public.jsonl"


def _ctx(**kwargs):
    base = dict(
        dataset="测试数据集",
        license_name="CC BY 4.0",
        known=canonical_set(),
        existing_titles=set(),
    )
    base.update(kwargs)
    return base


def test_parse_list_handles_foodcom_literals_and_dicts():
    assert parse_list("['番茄', '2 个 鸡蛋']") == ["番茄", "2 个 鸡蛋"]
    assert parse_list("鸡蛋\n番茄") == ["鸡蛋", "番茄"]
    assert parse_list(["鸡蛋", {"name": "番茄", "amount": "2 个"}]) == [
        "鸡蛋", {"name": "番茄", "amount": "2 个"}
    ]
    assert parse_list(None) == []


def test_read_records_jsonl_and_csv(tmp_path):
    rows = read_records(SAMPLE)
    assert len(rows) == 3
    assert rows[0]["title"].startswith("格式演示")
    csv_path = tmp_path / "recipes.csv"
    csv_path.write_text(
        "\n".join([
            "name,ingredients,steps,minutes,tags",
            '"测试菜","[""2 个 番茄"", ""2 个 鸡蛋""]",'
            '"[""番茄切块，鸡蛋打散。"", ""下锅煮熟，加盐调味即可。""]",12,"[""快手""]"',
        ]) + "\n",
        encoding="utf-8",
    )
    csv_rows = read_records(csv_path)
    assert len(csv_rows) == 1
    recipe, reason, unmapped = map_record(csv_rows[0], **_ctx())
    assert reason == "" and not unmapped
    assert recipe and [i.canonical for i in recipe.ingredients] == ["番茄", "鸡蛋"]
    assert recipe.methods and all(m in {"煮", "炒", "蒸"} for m in recipe.methods)
    assert "快手" in recipe.tags
    with pytest.raises(ValueError):
        read_records(tmp_path / "x.bin", fmt="auto")


def test_map_record_rejects_bad_data():
    ctx = _ctx()
    good = {
        "title": "家常番茄蛋汤",
        "ingredients": ["2 个 番茄", "2 个 鸡蛋", "1 根 小葱"],
        "steps": ["番茄切块，鸡蛋打散。", "清水烧开下番茄，淋入蛋液煮熟。"],
        "minutes": 12,
        "tags": ["快手", "不存在的标签"],
        "methods": ["炒"],
    }
    recipe, reason, _ = map_record(good, **ctx)
    assert reason == "" and recipe
    assert recipe.source.startswith("公开数据集：")
    assert recipe.license == "CC BY 4.0"
    assert "不存在的标签" not in recipe.tags
    assert recipe.methods == ["炒"]
    assert recipe.allergens == ["鸡蛋"]

    for bad, expected in [
        ({**good, "title": ""}, "missing_title"),
        ({**good, "ingredients": ["番茄"]}, "too_few_ingredients"),
        ({**good, "steps": ["一步"]}, "too_few_steps"),
        ({**good, "ingredients": ["番茄", "鸡蛋", "黑松露"]}, "unknown_ingredient"),
    ]:
        _, reason, _ = map_record(bad, **ctx)
        assert reason == expected, reason
    _, reason, _ = map_record(good, **_ctx(existing_titles={good["title"]}))
    assert reason == "duplicate_title"


def test_unknown_ingredients_are_reported_not_silently_dropped(tmp_path):
    rows = read_records(SAMPLE)
    recipe, reason, unmapped = map_record(rows[2], **_ctx())
    assert recipe is None and reason == "unknown_ingredient" and unmapped
    assert all("黑松露" in name for name in unmapped)


def test_dry_run_writes_nothing(tmp_path):
    target = tmp_path / "imported.jsonl"
    report_path = tmp_path / "unmapped.json"
    report = import_dataset(
        SAMPLE, dataset="格式演示样例", dry_run=True,
        imported_path=target, unmapped_path=report_path,
    )
    assert report["total"] == 3 and report["imported"] == 2
    assert report["reasons"] == {"unknown_ingredient": 1}
    assert not target.exists() and not report_path.exists()


def test_real_import_is_idempotent_and_reports_unmapped(tmp_path):
    target = tmp_path / "imported.jsonl"
    report_path = tmp_path / "unmapped.json"
    first = import_dataset(
        SAMPLE, dataset="格式演示样例", license_name="CC0",
        imported_path=target, unmapped_path=report_path,
    )
    assert first["imported"] == 2 and first["total_imported_file"] == 2
    lines = target.read_text(encoding="utf-8").strip().splitlines()
    assert len(lines) == 2
    assert {json.loads(line)["license"] for line in lines} == {"CC0"}
    payload = json.loads(report_path.read_text(encoding="utf-8"))
    assert payload["items"][0]["count"] >= 1

    second = import_dataset(
        SAMPLE, dataset="格式演示样例", license_name="CC0",
        imported_path=target, unmapped_path=report_path,
    )
    assert second["imported"] == 0
    assert second["reasons"]["duplicate_id"] == 2 or second["reasons"]["duplicate_title"] == 2
    assert len(target.read_text(encoding="utf-8").strip().splitlines()) == 2


def test_interrupted_import_write_keeps_previous_file(tmp_path, monkeypatch):
    """A crash mid-write must leave the previous imported shard byte-identical."""
    target = tmp_path / "imported.jsonl"
    report_path = tmp_path / "unmapped.json"
    first = import_dataset(
        SAMPLE, dataset="格式演示样例", license_name="CC0",
        imported_path=target, unmapped_path=report_path,
    )
    assert first["imported"] == 2
    before = target.read_bytes()

    real_write_text = Path.write_text

    def crashing_write_text(self, data, *args, **kwargs):
        # Simulate a crash halfway through writing the merged shard payload.
        if '"pub-' in str(data):
            real_write_text(self, str(data)[: len(str(data)) // 2], *args, **kwargs)
            raise OSError("simulated crash mid-write")
        return real_write_text(self, data, *args, **kwargs)

    monkeypatch.setattr(Path, "write_text", crashing_write_text)
    with pytest.raises(OSError):
        import_dataset(
            SAMPLE, dataset="格式演示样例", license_name="CC0",
            imported_path=target, unmapped_path=report_path,
        )
    assert target.read_bytes() == before


def test_atomic_write_uses_unique_tmp_names(tmp_path, monkeypatch):
    """Concurrent writers must not share one tmp path: a fixed name lets two
    processes interleave writes to the same tmp file and replace() then moves
    the other writer's half-finished content into place."""
    from cookmyfridge.public_dataset import _atomic_write_text

    seen: list[str] = []
    real_replace = Path.replace

    def spy_replace(self, target):
        seen.append(self.name)
        return real_replace(self, target)

    monkeypatch.setattr(Path, "replace", spy_replace)
    target = tmp_path / "out.jsonl"
    threads = [
        threading.Thread(
            target=_atomic_write_text, args=(target, '{"n": %d}\n' % i)
        )
        for i in range(2)
    ]
    for t in threads:
        t.start()
    for t in threads:
        t.join(timeout=15)
    assert len(seen) == 2
    assert len(set(seen)) == 2, f"tmp name collision: {seen}"
    assert json.loads(target.read_text(encoding="utf-8"))["n"] in (0, 1)


def test_concurrent_imports_leave_valid_file(tmp_path):
    """Parallel imports into one target: integrity holds (last writer wins),
    no torn bytes, no hard errors."""
    target = tmp_path / "imported.jsonl"
    report_path = tmp_path / "unmapped.json"
    errors: list[BaseException] = []

    def worker(i):
        try:
            import_dataset(
                SAMPLE, dataset=f"并发数据集{i}", license_name="CC0",
                imported_path=target, unmapped_path=report_path,
            )
        except BaseException as exc:  # noqa: BLE001 - collect for assertion
            errors.append(exc)

    threads = [threading.Thread(target=worker, args=(i,)) for i in range(8)]
    for t in threads:
        t.start()
    for t in threads:
        t.join(timeout=60)
    assert not errors, errors
    lines = target.read_text(encoding="utf-8").splitlines()
    assert lines, "imported shard is empty"
    for line in lines:  # every line must be a complete record, never torn
        row = json.loads(line)
        assert row["id"].startswith("pub-") and row["title"]
    assert not list(tmp_path.glob("*.tmp"))


def test_import_write_failure_cleans_tmp_and_keeps_target(tmp_path, monkeypatch):
    """ENOSPC mid-write: error propagates, old shard intact, no tmp litter."""
    target = tmp_path / "imported.jsonl"
    report_path = tmp_path / "unmapped.json"
    import_dataset(
        SAMPLE, dataset="格式演示样例", license_name="CC0",
        imported_path=target, unmapped_path=report_path,
    )
    before = target.read_bytes()

    real_write_text = Path.write_text

    def out_of_space(self, data, *args, **kwargs):
        if self.name.endswith(".tmp"):
            real_write_text(self, str(data)[:10], *args, **kwargs)
            raise OSError(28, "No space left on device")
        return real_write_text(self, data, *args, **kwargs)

    monkeypatch.setattr(Path, "write_text", out_of_space)
    with pytest.raises(OSError):
        import_dataset(
            SAMPLE, dataset="格式演示样例", license_name="CC0",
            imported_path=target, unmapped_path=report_path,
        )
    assert target.read_bytes() == before
    assert not list(tmp_path.glob("*.tmp")), "tmp file left behind after failure"


@pytest.mark.skipif(os.name != "nt", reason="Windows 上 replace 只读目标会抛 PermissionError")
def test_import_into_readonly_target_preserves_file(tmp_path):
    target = tmp_path / "imported.jsonl"
    report_path = tmp_path / "unmapped.json"
    import_dataset(
        SAMPLE, dataset="格式演示样例", license_name="CC0",
        imported_path=target, unmapped_path=report_path,
    )
    before = target.read_bytes()
    target.chmod(stat.S_IREAD)
    try:
        with pytest.raises(OSError):
            import_dataset(
                SAMPLE, dataset="格式演示样例", license_name="CC0",
                imported_path=target, unmapped_path=report_path,
            )
        assert target.read_bytes() == before
    finally:
        target.chmod(stat.S_IWRITE)


def test_import_scales_to_30k_rows(tmp_path):
    """30k unique valid records: full accept path stays correct at scale."""
    src = tmp_path / "big.jsonl"
    row = {
        "title": "",
        "ingredients": ["番茄", "鸡蛋"],
        "steps": ["第一步处理食材。", "第二步下锅煮熟。"],
        "minutes": 20,
    }
    with src.open("w", encoding="utf-8") as fh:
        for i in range(30000):
            row["title"] = f"规模菜{i}"
            fh.write(json.dumps(row, ensure_ascii=False) + "\n")
    report = import_dataset(
        src, dataset="规模压测", license_name="CC0",
        imported_path=tmp_path / "imported.jsonl",
        unmapped_path=tmp_path / "unmapped.json",
    )
    assert report["total"] == 30000
    assert report["imported"] == 30000
    assert report["total_imported_file"] == 30000


def test_load_shipped_recipes_merges_shards(tmp_path):
    base = load_shipped_recipes()
    assert len(base) == 210
    imported = tmp_path / "imported.jsonl"
    imported.write_text(
        json.dumps({
            "id": "pub-test", "title": "测试导入菜", "ingredients": [
                {"name": "番茄", "canonical": "番茄", "amount": "2 个", "optional": False}
            ],
            "steps": ["第一步", "第二步"], "methods": ["煮"],
        }, ensure_ascii=False) + "\n",
        encoding="utf-8",
    )
    merged = load_shipped_recipes(imported_path=imported)
    assert len(merged) == 211 and merged[-1].title == "测试导入菜"
    # A colliding id/title must never enter the shipped corpus twice.
    row = base[0].to_dict()
    imported.write_text(
        json.dumps(row, ensure_ascii=False) + "\n"
        + json.dumps({**row, "id": "pub-x", "title": "同标题"}, ensure_ascii=False) + "\n"
        + json.dumps({**row, "id": "pub-y"}, ensure_ascii=False) + "\n",
        encoding="utf-8",
    )
    assert len(load_shipped_recipes(imported_path=imported)) == 211


def test_enrich_fills_only_missing_entries_without_touching_ai(tmp_path):
    cache = tmp_path / "cache"
    cache.mkdir()
    ai_card = {"id": "keep-me", "title": "保留的 AI 卡片", "source": "GLM AI 生成"}
    (cache / "variants.json").write_text(
        json.dumps({"r001:lazy": ai_card}, ensure_ascii=False), encoding="utf-8"
    )
    (cache / "ideas.json").write_text(
        json.dumps({"r001": {"ideas": ["保留的主意"]}}, ensure_ascii=False), encoding="utf-8"
    )
    report = enrich_missing(cache)
    assert report["recipes"] == 210
    assert report["variants_added"] == 210 * 7 - 1
    assert report["ideas_added"] == 209
    variants = json.loads((cache / "variants.json").read_text(encoding="utf-8"))
    ideas = json.loads((cache / "ideas.json").read_text(encoding="utf-8"))
    assert variants["r001:lazy"] == ai_card
    assert ideas["r001"]["ideas"] == ["保留的主意"]
    card = variants["r210:lowcal"]
    assert card["source"] == RULE_SOURCE
    assert "低卡版" in card["title"] and len(card["safety_notes"][0]) > 5
    assert all(k in variants for k in (f"r196:{kind}" for kind in (
        "lazy", "lowcal", "airfryer", "substitute", "method", "leftover", "fusion"
    )))
    again = enrich_missing(cache, dry_run=True)
    assert again["variants_added"] == 0 and again["ideas_added"] == 0


def test_curated_batch13_is_fully_validateable():
    recipes = load_shipped_recipes()
    batch13 = [r for r in recipes if r.id[1:].isdigit() and 196 <= int(r.id[1:]) <= 210]
    assert len(batch13) == 15
    assert len({r.title for r in recipes}) == len(recipes)
    assert any("香椿" in [i.canonical for i in r.ingredients] for r in batch13)
