"""Offline seasonal knowledge: solar terms and in-season ingredients.

Solar term dates are the common approximate Gregorian dates (they shift by a
day or two between years); the UI labels them as  approximate. The seasonal
table is authored against the ingredient catalog and validated by the audit,
so every name is guaranteed to resolve.
"""
from __future__ import annotations

from datetime import date

from .catalog import canonical_set

# (name, month, day) in calendar order, approximate dates.
SOLAR_TERMS: list[tuple[str, int, int]] = [
    ("小寒", 1, 6),
    ("大寒", 1, 20),
    ("立春", 2, 4),
    ("雨水", 2, 19),
    ("惊蛰", 3, 6),
    ("春分", 3, 21),
    ("清明", 4, 5),
    ("谷雨", 4, 20),
    ("立夏", 5, 6),
    ("小满", 5, 21),
    ("芒种", 6, 6),
    ("夏至", 6, 21),
    ("小暑", 7, 7),
    ("大暑", 7, 23),
    ("立秋", 8, 7),
    ("处暑", 8, 23),
    ("白露", 9, 8),
    ("秋分", 9, 23),
    ("寒露", 10, 8),
    ("霜降", 10, 23),
    ("立冬", 11, 7),
    ("小雪", 11, 22),
    ("大雪", 12, 7),
    ("冬至", 12, 22),
]

# canonical -> months when the ingredient is traditionally in season in China.
SEASONAL: dict[str, tuple[int, ...]] = {
    # 春季
    "韭菜": (2, 3, 4),
    "荠菜": (2, 3, 4),
    "香椿": (3, 4),
    "芦笋": (3, 4, 5),
    "豌豆": (3, 4, 5),
    "蚕豆": (4, 5),
    "荷兰豆": (3, 4, 5),
    "竹笋": (2, 3, 4, 12),
    "莴笋": (3, 4, 5),
    "菜心": (3, 4, 10, 11),
    "豌豆苗": (2, 3, 4),
    "芦蒿": (2, 3, 4),
    "菠菜": (3, 4, 10, 11, 12),
    "草莓": (12, 1, 2, 3, 4),
    "樱桃": (4, 5),
    "菠萝": (3, 4, 5),
    # 夏季
    "黄瓜": (5, 6, 7, 8),
    "番茄": (6, 7, 8),
    "茄子": (6, 7, 8, 9),
    "青椒": (6, 7, 8, 9),
    "苦瓜": (6, 7, 8),
    "丝瓜": (6, 7, 8, 9),
    "冬瓜": (7, 8, 9),
    "空心菜": (5, 6, 7, 8, 9),
    "苋菜": (5, 6, 7),
    "豆角": (6, 7, 8),
    "玉米": (7, 8, 9),
    "毛豆": (7, 8, 9),
    "秋葵": (6, 7, 8, 9),
    "西瓜": (6, 7, 8),
    "桃子": (6, 7, 8),
    "葡萄": (7, 8, 9),
    "荔枝": (6, 7),
    "龙眼": (7, 8),
    "芒果": (5, 6, 7),
    "火龙果": (6, 7, 8, 9),
    "百香果": (7, 8, 9),
    "椰子": (6, 7, 8),
    # 秋季
    "南瓜": (8, 9, 10),
    "莲藕": (9, 10, 11),
    "山药": (10, 11, 12),
    "百合": (9, 10),
    "菱角": (8, 9, 10),
    "荸荠": (10, 11, 12),
    "茭白": (9, 10),
    "西兰花": (9, 10, 11),
    "菜花": (9, 10, 11),
    "香菇": (9, 10, 11, 3, 4),
    "平菇": (9, 10, 11),
    "口蘑": (9, 10),
    "梨": (8, 9, 10),
    "苹果": (9, 10, 11),
    "柚子": (9, 10, 11),
    "石榴": (9, 10),
    "猕猴桃": (9, 10, 11),
    "橙子": (10, 11, 12, 1),
    "橘子": (10, 11, 12),
    "无花果": (8, 9, 10),
    "红枣": (9, 10),
    # 冬季
    "白菜": (11, 12, 1),
    "萝卜": (11, 12, 1, 2),
    "芹菜": (10, 11, 12),
    "韭黄": (11, 12, 1),
    "蒜黄": (11, 12, 1),
    "芥蓝": (11, 12, 1),
    "羊肉": (11, 12, 1),
    "牛肉": (11, 12, 1),
    "带鱼": (11, 12, 1),
    "鲫鱼": (10, 11, 12),
}
def current_solar_term(today: date) -> dict:
    """Return the running term and the next one (approximate dates)."""
    key = (today.month, today.day)
    current = SOLAR_TERMS[-1]  # before 小寒 -> still 冬至
    current_year = today.year - 1
    for name, month, day in SOLAR_TERMS:
        if (month, day) <= key:
            current = (name, month, day)
            current_year = today.year
    idx = SOLAR_TERMS.index(current)
    nxt = SOLAR_TERMS[(idx + 1) % len(SOLAR_TERMS)]
    return {
        "name": current[0],
        "month": current[1],
        "day": current[2],
        "year": current_year,
        "next": {"name": nxt[0], "month": nxt[1], "day": nxt[2]},
    }


def seasonal_payload() -> dict:
    by_month: dict[str, list[str]] = {str(m): [] for m in range(1, 13)}
    for name in sorted(SEASONAL):
        for month in SEASONAL[name]:
            by_month[str(month)].append(name)
    return {
        "solar_terms": [
            {"name": name, "month": month, "day": day}
            for name, month, day in SOLAR_TERMS
        ],
        "seasonal": {name: list(months) for name, months in sorted(SEASONAL.items())},
        "by_month": by_month,
    }


def validate_seasonal() -> list[str]:
    problems: list[str] = []
    known = canonical_set()
    if len(SOLAR_TERMS) != 24:
        problems.append("节气表必须 24 条")
    for name, months in SEASONAL.items():
        if name not in known:
            problems.append(f"当季表含目录外食材: {name}")
        if not months or any(m < 1 or m > 12 for m in months):
            problems.append(f"当季月份非法: {name} {months}")
        if len(set(months)) != len(months):
            problems.append(f"当季月份重复: {name}")
    return problems