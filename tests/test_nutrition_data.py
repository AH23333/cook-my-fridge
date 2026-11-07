"""Nutrition data integrity and export tests."""
from __future__ import annotations

import cookmyfridge.audit as audit
import cookmyfridge.build as build
import cookmyfridge.nutrition as nutrition
from cookmyfridge.catalog import canonical_set, category_map


def test_every_catalog_ingredient_has_facts():
    payload = nutrition.nutrition_facts_payload()
    facts = payload["per100g"]
    assert set(facts) == canonical_set()
    assert list(facts) == sorted(facts)  # deterministic export
    for name, row in facts.items():
        assert set(row) == {"kcal", "protein", "fat", "carbs", "source"}
        assert 0 <= row["kcal"] <= 900
        assert row["source"] in ("reference", "estimated")


def test_reference_values_and_fallbacks():
    assert nutrition.nutrients_for("食用油")[2] == 100.0
    assert nutrition.nutrients_for("清水")[0] == 0.0
    assert nutrition.nutrients_for("米饭")[0] < nutrition.nutrients_for("大米")[0]
    assert nutrition.nutrients_for("鸡胸肉")[1] > nutrition.nutrients_for("五花肉")[1]
    # Unlisted vegetables fall back to their category default, not a global one.
    assert nutrition.nutrients_for("羽衣甘蓝") == nutrition.CATEGORY_DEFAULTS["蔬菜"]


def test_unit_conversions_are_sane():
    payload = nutrition.nutrition_facts_payload()
    units = payload["unit_grams"]
    overrides = payload["ingredient_units"]
    assert units["克"] == 1.0 and units["斤"] == 500.0
    assert units["小勺"] < units["勺"] < units["碗"]
    assert overrides["鸡蛋"]["个"] == 50.0
    assert all(name in canonical_set() for name in overrides)
    assert all(v > 0 for v in units.values())
    assert list(units) == sorted(units)


def test_nutrition_validation_and_audit_are_clean():
    assert nutrition.validate_nutrition() == []
    report = audit.run_audit()
    assert report["ok"] is True
    assert report["counts"]["nutrition_facts"] == len(canonical_set())


def test_validation_flags_broken_reference(monkeypatch):
    monkeypatch.setitem(
        nutrition.NUTRIENTS_PER_100G, "目录外食材", (100.0, 1.0, 1.0, 1.0)
    )
    problems = nutrition.validate_nutrition()
    assert any("营养参考值指向目录外食材" in p for p in problems)


def test_build_exports_nutrition_facts(tmp_path, monkeypatch):
    monkeypatch.setattr(build, "SITE_DIR", tmp_path / "site")
    payload = build.export_catalog()
    facts = payload["nutrition_facts"]
    assert len(facts["per100g"]) == len(canonical_set())
    assert facts["note"]
    assert "鸡蛋" in facts["ingredient_units"]
    assert category_map()["鸡蛋"] == "肉蛋"


def test_payload_is_stable():
    assert nutrition.nutrition_facts_payload() == nutrition.nutrition_facts_payload()
