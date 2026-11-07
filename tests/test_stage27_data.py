"""Stage 27 data shards: seasonal table, price model, storage encyclopedia."""
from __future__ import annotations

from datetime import date

from cookmyfridge.catalog import canonical_set, storage_for, storage_payload, validate_storage
from cookmyfridge.prices import (
    TAKEOUT_PER_MEAL,
    price_facts_payload,
    price_for,
    validate_prices,
)
from cookmyfridge.seasonal import (
    SOLAR_TERMS,
    current_solar_term,
    seasonal_payload,
    validate_seasonal,
)


def test_solar_terms_cover_a_year_in_order():
    assert len(SOLAR_TERMS) == 24
    keys = [(m, d) for _, m, d in SOLAR_TERMS]
    assert keys == sorted(keys)
    assert SOLAR_TERMS[0][0] == "小寒"
    assert SOLAR_TERMS[-1][0] == "冬至"


def test_current_solar_term_boundaries_and_wrap():
    assert current_solar_term(date(2026, 1, 6))["name"] == "小寒"
    assert current_solar_term(date(2026, 1, 5))["name"] == "冬至"
    assert current_solar_term(date(2026, 1, 5))["year"] == 2025
    assert current_solar_term(date(2026, 3, 21))["name"] == "春分"
    assert current_solar_term(date(2026, 6, 20))["name"] == "芒种"
    assert current_solar_term(date(2026, 12, 31))["name"] == "冬至"
    assert current_solar_term(date(2026, 11, 7))["next"]["name"] == "小雪"


def test_seasonal_names_all_known_and_months_sane():
    assert validate_seasonal() == []
    payload = seasonal_payload()
    known = canonical_set()
    for name, months in payload["seasonal"].items():
        assert name in known
        assert 1 <= len(months) <= 12
    for month in range(1, 13):
        assert payload["by_month"][str(month)], f"month {month} has no seasonal picks"
    assert "西瓜" in payload["by_month"]["7"]
    assert "白菜" in payload["by_month"]["12"]


def test_price_fallback_chain():
    assert price_for("土豆") == 2.5  # explicit
    assert price_for("清水") > 0  # category default path
    payload = price_facts_payload()
    assert list(payload["per500g"]) == sorted(payload["per500g"])
    assert all(p > 0 for p in payload["per500g"].values())
    assert payload["takeout_per_meal"] == TAKEOUT_PER_MEAL
    assert validate_prices() == []


def test_storage_explicit_and_category_default():
    assert validate_storage() == []
    tip = storage_for("菠菜")
    assert tip["fridgeDays"] == 4 and tip["freezerDays"] == 30
    frozen = storage_for("速冻饺子")
    assert frozen["fridgeDays"] is None and frozen["freezerDays"] == 180
    fallback = storage_for("清水")
    assert fallback["method"]
    payload = storage_payload()
    assert list(payload["tips"]) == sorted(payload["tips"])
    assert set(payload["category_default"]) == {
        "蔬菜", "肉蛋", "水产", "主食", "豆乳", "调料", "水果", "冷冻食品",
    }


def test_storage_does_not_label_room_temperature_shelf_life_as_refrigeration():
    for name in ("木耳", "银耳", "腐竹", "红薯", "洋葱", "大蒜", "香蕉",
                 "大米", "面粉", "面包", "吐司", "食用油", "蜂蜜"):
        assert storage_for(name)["fridgeDays"] is None, name
    defaults = storage_payload()["category_default"]
    assert defaults["主食"]["fridgeDays"] is None
    assert defaults["调料"]["fridgeDays"] is None
    assert storage_for("牛奶")["fridgeDays"] == 2
    for name in ("木耳", "银耳", "腐竹"):
        assert "泡发后当天吃" in storage_for(name)["method"]