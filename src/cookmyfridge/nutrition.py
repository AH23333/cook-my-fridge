"""Approximate nutrition facts for the ingredient catalog.

Values are *per 100 g edible portion*, rounded from general food composition
tables. They are estimates for a home-cooking helper, NOT clinical nutrition
data: cooking loss, brand, variety and preparation are deliberately ignored.

The catalog is the single source of truth for ingredients. This module only
adds numbers to it: every canonical ingredient gets an entry, either an
explicit measured value or a conservative category default. It also owns the
household-unit -> gram conversion used by the browser estimator, so Python and
JavaScript never disagree about what "1 勺" means.
"""
from __future__ import annotations

from .catalog import canonical_set, category_map
from .catalog_data import INGREDIENTS

# (kcal, protein g, fat g, carbohydrate g) per 100 g.
CATEGORY_DEFAULTS: dict[str, tuple[float, float, float, float]] = {
    "蔬菜": (25.0, 1.6, 0.2, 4.5),
    "水果": (55.0, 0.8, 0.3, 13.0),
    "肉蛋": (200.0, 18.0, 14.0, 1.0),
    "水产": (100.0, 18.0, 3.0, 1.0),
    "主食": (350.0, 8.0, 1.5, 75.0),
    "豆乳": (120.0, 8.0, 6.0, 6.0),
    "调料": (60.0, 1.5, 1.0, 10.0),
    "冷冻食品": (220.0, 7.0, 9.0, 28.0),
}

# Explicit values for ingredients where a category default would be badly
# misleading (oils, sugar, cooked staples, starchy vegetables, lean meat...).
NUTRIENTS_PER_100G: dict[str, tuple[float, float, float, float]] = {
    # --- 蔬菜 / 菌菇 / 海藻 ---
    "土豆": (77, 2.0, 0.1, 17.0),
    "红薯": (86, 1.6, 0.1, 20.0),
    "山药": (57, 1.9, 0.2, 12.4),
    "莲藕": (74, 1.9, 0.2, 16.4),
    "玉米": (112, 4.0, 1.2, 22.8),
    "南瓜": (23, 0.7, 0.1, 5.3),
    "豌豆": (81, 5.4, 0.4, 14.5),
    "蚕豆": (104, 8.0, 0.5, 17.0),
    "菱角": (98, 4.5, 0.1, 21.4),
    "荸荠": (61, 1.2, 0.1, 14.2),
    "百合": (162, 3.2, 0.1, 38.8),
    "毛豆": (131, 13.1, 5.0, 10.5),
    "胡萝卜": (39, 1.0, 0.2, 8.8),
    "洋葱": (40, 1.1, 0.1, 9.0),
    "魔芋": (7, 0.1, 0.0, 3.0),
    "木耳": (27, 1.5, 0.2, 6.0),
    "银耳": (26, 0.7, 0.1, 6.5),
    "香菇": (26, 2.2, 0.3, 5.2),
    "海带": (13, 1.2, 0.1, 2.1),
    "紫菜": (35, 4.0, 0.3, 5.0),
    "裙带菜": (16, 1.4, 0.2, 2.5),
    "生姜": (46, 1.3, 0.6, 10.3),
    "大蒜": (128, 4.5, 0.2, 27.6),
    "小葱": (30, 1.6, 0.4, 5.0),
    "大葱": (30, 1.6, 0.3, 5.8),
    "蒜苔": (61, 2.0, 0.1, 15.0),
    "豆芽": (18, 2.1, 0.1, 2.9),
    # --- 肉蛋 ---
    "猪肉": (395, 13.2, 37.0, 2.4),
    "五花肉": (508, 9.3, 53.0, 0.0),
    "排骨": (278, 16.7, 23.1, 0.7),
    "猪蹄": (260, 22.6, 18.8, 0.0),
    "猪肝": (129, 19.3, 3.5, 5.0),
    "牛肉": (125, 20.2, 4.2, 1.2),
    "牛腩": (250, 17.0, 20.0, 0.0),
    "羊肉": (203, 19.0, 14.1, 0.0),
    "鸡肉": (167, 19.3, 9.4, 1.3),
    "鸡胸肉": (118, 24.6, 1.9, 0.6),
    "鸡腿": (181, 16.0, 13.0, 0.0),
    "鸡翅": (194, 17.4, 11.8, 4.6),
    "鸡爪": (254, 23.9, 16.4, 2.7),
    "鸭肉": (240, 15.5, 19.7, 0.2),
    "鸡蛋": (143, 12.6, 9.5, 1.1),
    "咸鸭蛋": (190, 12.7, 12.7, 6.0),
    "鹌鹑蛋": (160, 13.0, 11.0, 2.1),
    "火腿肠": (212, 14.0, 10.4, 15.6),
    "午餐肉": (229, 9.4, 15.9, 12.0),
    "香肠": (508, 24.1, 40.7, 11.2),
    "腊肉": (498, 11.8, 48.8, 2.9),
    "培根": (181, 22.3, 9.0, 1.4),
    # --- 水产 ---
    "三文鱼": (208, 20.4, 13.4, 0.0),
    "鳕鱼": (82, 17.8, 0.7, 0.0),
    "金枪鱼": (130, 28.0, 1.3, 0.0),
    "带鱼": (127, 17.7, 4.9, 3.1),
    "虾": (93, 18.6, 0.8, 2.8),
    "虾仁": (93, 18.6, 0.8, 2.8),
    "虾皮": (153, 30.7, 2.2, 2.5),
    "鱿鱼": (84, 17.0, 1.4, 0.0),
    "螃蟹": (103, 17.5, 2.6, 2.3),
    "扇贝": (60, 11.1, 0.6, 2.4),
    "花蛤": (62, 10.1, 1.1, 2.8),
    "蟹棒": (95, 7.6, 0.8, 14.0),
    "虾滑": (110, 12.0, 3.0, 8.0),
    # --- 主食（熟/干要区分，否则热量会离谱） ---
    "大米": (346, 7.4, 0.8, 77.9),
    "米饭": (116, 2.6, 0.3, 25.9),
    "小米": (361, 9.0, 3.1, 75.1),
    "糯米": (348, 7.3, 1.0, 78.3),
    "燕麦": (367, 15.0, 6.7, 61.0),
    "藜麦": (368, 14.1, 6.1, 64.2),
    "面粉": (344, 11.2, 1.5, 71.5),
    "面条": (110, 3.9, 0.4, 22.0),
    "挂面": (346, 10.0, 0.9, 74.0),
    "方便面": (472, 9.5, 21.1, 60.9),
    "荞麦面": (340, 12.0, 2.0, 68.0),
    "乌冬面": (125, 3.0, 0.4, 27.0),
    "意面": (350, 12.0, 1.5, 71.0),
    "米粉": (348, 7.0, 0.6, 79.0),
    "粉丝": (335, 0.8, 0.2, 83.0),
    "粉条": (337, 0.5, 0.1, 84.0),
    "馒头": (223, 7.0, 1.1, 47.0),
    "面包": (265, 8.0, 3.2, 50.0),
    "吐司": (280, 8.5, 4.0, 51.0),
    "面包糠": (380, 11.0, 5.0, 72.0),
    "糯米粉": (350, 7.0, 1.0, 78.0),
    "藕粉": (372, 0.2, 0.1, 92.0),
    "饺子": (210, 8.0, 8.0, 26.0),
    "馄饨": (190, 7.5, 6.0, 27.0),
    "包子": (227, 7.5, 8.0, 31.0),
    "莲子": (350, 17.0, 2.0, 67.0),
    # --- 豆乳 / 坚果 ---
    "豆腐": (81, 8.1, 3.7, 4.2),
    "嫩豆腐": (57, 6.2, 2.7, 2.6),
    "老豆腐": (98, 12.2, 4.8, 1.5),
    "豆干": (140, 16.2, 7.0, 4.0),
    "腐竹": (461, 44.6, 21.7, 22.3),
    "豆浆": (31, 3.0, 1.6, 1.2),
    "黄豆": (390, 35.0, 16.0, 34.0),
    "绿豆": (329, 21.6, 0.8, 62.0),
    "红豆": (324, 20.2, 0.6, 63.4),
    "鹰嘴豆": (364, 19.3, 6.0, 61.0),
    "牛奶": (54, 3.0, 3.2, 3.4),
    "酸奶": (72, 2.5, 2.7, 9.3),
    "奶酪": (328, 25.7, 23.5, 3.5),
    "黄油": (717, 0.9, 81.1, 0.1),
    "奶油": (345, 2.3, 36.0, 3.1),
    "花生": (567, 25.8, 49.2, 16.1),
    "核桃": (654, 15.2, 65.2, 13.7),
    "腰果": (553, 18.2, 43.8, 30.2),
    "芝麻": (573, 17.7, 49.7, 23.4),
    "牛油果": (160, 2.0, 14.7, 8.5),
    # --- 水果 ---
    "香蕉": (89, 1.1, 0.3, 22.8),
    "苹果": (52, 0.3, 0.2, 13.8),
    "葡萄": (69, 0.7, 0.2, 18.1),
    "西瓜": (30, 0.6, 0.2, 7.6),
    "红枣": (264, 3.2, 0.5, 67.8),
    "枸杞": (349, 13.9, 1.5, 64.1),
    "椰子": (354, 3.3, 33.5, 15.2),
    "柠檬": (29, 1.1, 0.3, 9.3),
    "柠檬汁": (22, 0.4, 0.2, 6.9),
    # --- 调料（油/糖/零热量项必须显式） ---
    "食用油": (884, 0.0, 100.0, 0.0),
    "花生油": (884, 0.0, 100.0, 0.0),
    "橄榄油": (884, 0.0, 100.0, 0.0),
    "香油": (884, 0.0, 100.0, 0.0),
    "白糖": (400, 0.0, 0.0, 100.0),
    "冰糖": (397, 0.0, 0.0, 100.0),
    "蜂蜜": (304, 0.3, 0.0, 82.4),
    "淀粉": (346, 0.5, 0.1, 85.0),
    "清水": (0.0, 0.0, 0.0, 0.0),
    "盐": (0.0, 0.0, 0.0, 0.0),
    "高汤": (10, 0.6, 0.2, 1.2),
    "可乐": (43, 0.0, 0.0, 10.6),
    "番茄酱": (81, 1.5, 0.2, 19.0),
    "沙拉酱": (680, 1.4, 75.0, 3.0),
    "芝麻酱": (595, 17.0, 53.0, 21.0),
    "花生酱": (588, 25.0, 50.0, 20.0),
    "椰浆": (197, 2.0, 19.0, 5.0),
    "味噌": (199, 12.0, 6.0, 26.0),
    "咖喱块": (450, 6.0, 25.0, 48.0),
    "火锅底料": (600, 5.0, 60.0, 12.0),
    "老干妈": (550, 6.0, 50.0, 15.0),
    "豆瓣酱": (180, 8.0, 7.0, 20.0),
    "黄豆酱": (170, 9.0, 6.0, 20.0),
    "甜面酱": (160, 5.0, 1.0, 32.0),
    "酱油": (53, 5.6, 0.1, 9.9),
    "生抽": (53, 5.6, 0.1, 9.9),
    "老抽": (60, 5.0, 0.1, 12.0),
    "蒸鱼豉油": (55, 5.0, 0.1, 10.0),
    "蚝油": (114, 4.0, 0.2, 24.0),
    "醋": (31, 2.0, 0.1, 5.0),
    "白醋": (20, 0.1, 0.0, 1.0),
    "料酒": (70, 0.5, 0.1, 8.0),
    "白酒": (298, 0.0, 0.0, 0.0),
    "腐乳": (133, 12.0, 8.0, 5.0),
    "酵母": (325, 40.0, 7.0, 35.0),
    # --- 冷冻食品 ---
    "速冻饺子": (210, 8.0, 8.0, 26.0),
    "速冻包子": (227, 7.5, 8.0, 31.0),
    "手抓饼": (320, 7.0, 17.0, 35.0),
    "冻薯条": (312, 3.4, 15.0, 41.0),
    "冻豌豆": (81, 5.4, 0.4, 14.5),
    "冻玉米粒": (112, 4.0, 1.2, 22.8),
    "冻虾仁": (93, 18.6, 0.8, 2.8),
    "冻鸡块": (260, 15.0, 16.0, 16.0),
    "汤圆": (250, 4.0, 6.0, 45.0),
    "冷冻混合菜": (60, 3.0, 0.5, 10.0),
}

# Household units -> grams. Deliberately coarse: a recipe author's "1 把菠菜"
# is not a weighing scale. Ingredient-specific overrides win over this table.
UNIT_GRAMS: dict[str, float] = {
    "克": 1.0,
    "g": 1.0,
    "毫升": 1.0,
    "ml": 1.0,
    "斤": 500.0,
    "千克": 1000.0,
    "勺": 15.0,
    "小勺": 5.0,
    "半勺": 7.5,
    "碗": 200.0,
    "半碗": 100.0,
    "杯": 240.0,
    "个": 100.0,
    "半个": 50.0,
    "根": 80.0,
    "半根": 40.0,
    "片": 15.0,
    "块": 40.0,
    "把": 50.0,
    "小把": 25.0,
    "瓣": 5.0,
    "颗": 80.0,
    "棵": 200.0,
    "朵": 30.0,
    "段": 40.0,
    "条": 60.0,
    "只": 150.0,
    "半只": 75.0,
    "盒": 250.0,
    "半盒": 125.0,
    "罐": 300.0,
    "包": 200.0,
    "袋": 200.0,
    "盘": 200.0,
    "份": 150.0,
    "串": 100.0,
    "头": 40.0,
    "整头": 40.0,
    "少许": 5.0,
    "适量": 5.0,
    "几滴": 2.0,
    "几片": 30.0,
    "几个": 200.0,
    "几颗": 20.0,
}

# Per-ingredient refinements where the generic household unit is far off.
INGREDIENT_UNITS: dict[str, dict[str, float]] = {
    "鸡蛋": {"个": 50.0, "半个": 25.0},
    "咸鸭蛋": {"个": 60.0},
    "鹌鹑蛋": {"个": 10.0, "颗": 10.0},
    "番茄": {"个": 150.0},
    "圣女果": {"个": 15.0, "颗": 15.0},
    "土豆": {"个": 150.0},
    "红薯": {"个": 180.0},
    "洋葱": {"个": 150.0},
    "青椒": {"个": 100.0},
    "黄瓜": {"根": 200.0},
    "胡萝卜": {"根": 120.0},
    "大葱": {"根": 80.0, "段": 25.0},
    "小葱": {"根": 12.0, "把": 40.0},
    "香菜": {"把": 30.0},
    "大蒜": {"瓣": 5.0, "头": 40.0, "整头": 40.0},
    "生姜": {"片": 3.0, "块": 15.0},
    "白菜": {"棵": 600.0, "片": 30.0},
    "生菜": {"棵": 250.0, "片": 12.0},
    "西兰花": {"朵": 40.0, "棵": 300.0},
    "香菇": {"朵": 15.0, "个": 15.0},
    "口蘑": {"朵": 18.0, "个": 18.0},
    "豆腐": {"块": 200.0, "盒": 300.0},
    "老豆腐": {"块": 200.0},
    "嫩豆腐": {"盒": 300.0},
    "牛奶": {"盒": 250.0, "杯": 240.0},
    "豆浆": {"杯": 240.0, "碗": 250.0},
    "米饭": {"碗": 150.0, "份": 150.0},
    "面条": {"碗": 200.0, "份": 200.0, "把": 100.0},
    "挂面": {"把": 100.0},
    "面包": {"片": 30.0, "个": 80.0},
    "吐司": {"片": 30.0},
    "馒头": {"个": 100.0},
    "包子": {"个": 80.0},
    "饺子": {"个": 20.0, "份": 250.0},
    "速冻饺子": {"个": 20.0, "袋": 500.0},
    "鸡腿": {"只": 120.0, "个": 120.0},
    "鸡翅": {"只": 40.0, "个": 40.0},
    "虾": {"只": 15.0, "个": 15.0},
    "虾仁": {"只": 10.0},
    "螃蟹": {"只": 200.0},
    "香蕉": {"根": 120.0, "个": 120.0},
    "苹果": {"个": 200.0},
    "梨": {"个": 200.0},
    "橙子": {"个": 180.0},
    "橘子": {"个": 100.0},
    "柠檬": {"个": 100.0},
    "牛油果": {"个": 150.0},
    "玉米": {"根": 200.0, "个": 200.0},
    "莲藕": {"段": 150.0, "节": 150.0},
    "咖喱块": {"块": 10.0},
    "黄油": {"块": 10.0},
    "高汤": {"碗": 250.0, "杯": 240.0},
    "清水": {"碗": 250.0, "杯": 240.0, "毫升": 1.0},
    "食用油": {"勺": 10.0, "小勺": 4.0},
    "花生油": {"勺": 10.0, "小勺": 4.0},
    "橄榄油": {"勺": 10.0, "小勺": 4.0},
    "香油": {"勺": 10.0, "小勺": 4.0},
    "盐": {"勺": 6.0, "小勺": 3.0},
    "白糖": {"勺": 12.0, "小勺": 4.0},
    "冰糖": {"块": 8.0},
    "酱油": {"勺": 15.0, "小勺": 5.0},
    "生抽": {"勺": 15.0, "小勺": 5.0},
    "老抽": {"勺": 15.0, "小勺": 5.0},
    "醋": {"勺": 15.0, "小勺": 5.0},
    "料酒": {"勺": 15.0, "小勺": 5.0},
    "淀粉": {"勺": 10.0, "小勺": 4.0},
    "番茄酱": {"勺": 15.0},
    "沙拉酱": {"勺": 15.0},
    "蜂蜜": {"勺": 20.0, "小勺": 7.0},
}

# Keyword-based fallback for the handful of unlisted pantry items whose name
# makes the nutrition obvious. Applied only when there is no explicit value.
_NAME_HINTS: tuple[tuple[str, tuple[float, float, float, float]], ...] = (
    ("油", (884.0, 0.0, 100.0, 0.0)),
    ("糖", (400.0, 0.0, 0.0, 100.0)),
    ("酱", (150.0, 6.0, 6.0, 22.0)),
    ("粉", (350.0, 3.0, 1.0, 82.0)),
    ("面", (340.0, 10.0, 1.0, 70.0)),
    ("米", (350.0, 7.0, 1.0, 77.0)),
    ("酒", (80.0, 0.5, 0.1, 8.0)),
    ("醋", (30.0, 1.0, 0.1, 5.0)),
)


# Bulk refinements for produce sold by the bunch/head. A generic "1 把" of
# 50 g is right for 香菜 but badly undercounts a bunch of spinach; "1 颗" of
# 10 g is right for a cherry tomato, not for a head of broccoli.
for _name in (
    "菠菜", "空心菜", "苋菜", "小白菜", "油菜", "生菜", "茼蒿", "茴香",
    "荠菜", "苦菊", "菜心", "韭黄", "蒜黄", "马齿苋", "折耳根", "豆芽",
    "豌豆", "荷兰豆", "四季豆", "豆角", "芦笋", "秋葵", "蒜苔", "羽衣甘蓝",
    "韭菜", "芹菜", "香菜", "芥蓝", "抱子甘蓝", "卷心菜", "娃娃菜",
):
    INGREDIENT_UNITS.setdefault(_name, {}).setdefault("把", 150.0)
for _name in ("香菇", "平菇", "金针菇", "杏鲍菇", "口蘑", "蟹味菇", "银耳", "木耳"):
    INGREDIENT_UNITS.setdefault(_name, {}).setdefault("把", 80.0)
    INGREDIENT_UNITS[_name].setdefault("朵", 20.0)
for _name in ("西兰花", "菜花", "卷心菜", "娃娃菜"):
    INGREDIENT_UNITS.setdefault(_name, {}).setdefault("颗", 300.0)
INGREDIENT_UNITS.setdefault("干辣椒", {}).update({"把": 10.0, "个": 2.0, "根": 3.0})
INGREDIENT_UNITS.setdefault("辣椒", {}).update({"个": 15.0, "根": 15.0})
INGREDIENT_UNITS.setdefault("青椒", {}).setdefault("颗", 100.0)
INGREDIENT_UNITS.setdefault("大蒜", {}).setdefault("颗", 5.0)
INGREDIENT_UNITS.setdefault("西瓜", {}).update(
    {"个": 1000.0, "半个": 500.0, "块": 200.0, "片": 100.0}
)
for _name in ("冬瓜", "南瓜", "哈密瓜"):
    if _name in canonical_set():
        INGREDIENT_UNITS.setdefault(_name, {}).setdefault("块", 200.0)


def nutrients_for(canonical: str) -> tuple[float, float, float, float]:
    """Per-100 g values for one canonical ingredient (always defined)."""
    if canonical in NUTRIENTS_PER_100G:
        return NUTRIENTS_PER_100G[canonical]
    for keyword, values in _NAME_HINTS:
        if keyword in canonical:
            return values
    return CATEGORY_DEFAULTS.get(category_map().get(canonical, ""), (60.0, 2.0, 1.0, 10.0))


def nutrition_facts_payload() -> dict:
    """Deterministic, JSON-ready nutrition data for every catalog ingredient."""
    facts: dict[str, dict] = {}
    for canonical in sorted(canonical_set()):
        kcal, protein, fat, carbs = nutrients_for(canonical)
        facts[canonical] = {
            "kcal": round(kcal, 1),
            "protein": round(protein, 1),
            "fat": round(fat, 1),
            "carbs": round(carbs, 1),
            "source": "reference" if canonical in NUTRIENTS_PER_100G else "estimated",
        }
    return {
        "per100g": facts,
        "unit_grams": dict(sorted(UNIT_GRAMS.items())),
        "ingredient_units": {
            name: dict(sorted(units.items()))
            for name, units in sorted(INGREDIENT_UNITS.items())
        },
        "note": "按每 100 克可食部的通用食物成分近似值估算，未计烹饪损耗；仅供参考，不替代专业营养计算或食品标签。",
    }


def validate_nutrition() -> list[str]:
    """Integrity checks consumed by the offline audit."""
    problems: list[str] = []
    known = canonical_set()
    payload = nutrition_facts_payload()
    facts = payload["per100g"]
    if set(facts) != known:
        missing = sorted(known - set(facts))
        extra = sorted(set(facts) - known)
        if missing:
            problems.append(f"营养表缺少食材: {missing[:8]}")
        if extra:
            problems.append(f"营养表含目录外食材: {extra[:8]}")
    for name, row in facts.items():
        for field in ("kcal", "protein", "fat", "carbs"):
            value = row[field]
            if not isinstance(value, (int, float)) or value < 0 or value > 900:
                problems.append(f"营养数值异常: {name}.{field}={value}")
        if row["protein"] + row["fat"] + row["carbs"] > 100.5:
            problems.append(f"营养三大营养素超过 100g: {name}")
    for name in payload["ingredient_units"]:
        if name not in known:
            problems.append(f"单位换算指向目录外食材: {name}")
    for unit, grams in payload["unit_grams"].items():
        if grams <= 0 or grams > 1000:
            problems.append(f"单位换算异常: {unit}={grams}")
    # Explicit reference rows must point at real ingredients.
    for name in NUTRIENTS_PER_100G:
        if name not in known:
            problems.append(f"营养参考值指向目录外食材: {name}")
    return problems


__all__ = [
    "CATEGORY_DEFAULTS",
    "NUTRIENTS_PER_100G",
    "UNIT_GRAMS",
    "INGREDIENT_UNITS",
    "nutrients_for",
    "nutrition_facts_payload",
    "validate_nutrition",
]

# Keep the import explicit: INGREDIENTS is the taxonomy this module decorates.
assert len(INGREDIENTS) == len(canonical_set()), "duplicate canonical ingredients"
