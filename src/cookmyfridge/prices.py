"""Heuristic ingredient cost model for rough savings estimates.

Prices are approximate mainland-China retail prices in CNY per 500 g,
authored as a planning aid only. Every number is an estimate: the UI must
label totals as 估算 and never present them as real quotes.
"""
from __future__ import annotations

from .catalog import canonical_set, category_of

# CNY per 500 g, approximate retail.
PRICES_PER_500G: dict[str, float] = {
    "白菜": 2.5, "卷心菜": 3, "娃娃菜": 5, "小白菜": 4, "油菜": 4,
    "菠菜": 6, "生菜": 5, "芹菜": 4, "韭菜": 5, "香菜": 8,
    "茼蒿": 6, "空心菜": 5, "苋菜": 5, "芥蓝": 7, "芦笋": 12,
    "西兰花": 7, "菜花": 5, "黄瓜": 4, "冬瓜": 2, "南瓜": 3,
    "丝瓜": 6, "苦瓜": 6, "西葫芦": 4, "番茄": 5, "茄子": 4,
    "青椒": 5, "辣椒": 7, "土豆": 2.5, "红薯": 3.5, "山药": 8,
    "莲藕": 7, "萝卜": 2.5, "胡萝卜": 3, "洋葱": 3, "大葱": 4,
    "生姜": 8, "大蒜": 8, "小葱": 6, "蒜苔": 8, "豆角": 6,
    "豌豆": 9, "玉米": 4, "圣女果": 8, "四季豆": 7, "豆芽": 2.5,
    "莴笋": 4, "竹笋": 10, "茭白": 9, "魔芋": 5, "菜心": 6,
    "荷兰豆": 12, "荸荠": 8, "秋葵": 9, "荠菜": 10, "香椿": 25,
    "豌豆苗": 10, "紫甘蓝": 6, "芦蒿": 12,
    "木耳": 30, "银耳": 25, "香菇": 10, "金针菇": 6, "平菇": 6,
    "杏鲍菇": 8, "口蘑": 12, "蟹味菇": 10, "白玉菇": 10,
    "海带": 6, "紫菜": 20, "裙带菜": 15,
    "猪肉": 15, "五花肉": 18, "排骨": 25, "猪蹄": 20, "猪肝": 12,
    "牛肉": 40, "牛腩": 38, "羊肉": 40, "鸡肉": 12, "鸡胸肉": 12,
    "鸡腿": 12, "鸡翅": 20, "鸡爪": 18, "鸭肉": 15, "鸡蛋": 6,
    "咸鸭蛋": 12, "鹌鹑蛋": 12, "火腿肠": 12, "午餐肉": 18,
    "香肠": 25, "腊肉": 30, "培根": 28,
    "鲫鱼": 15, "草鱼": 12, "带鱼": 18, "鳕鱼": 35, "三文鱼": 55,
    "金枪鱼": 30, "巴沙鱼": 15, "鲈鱼": 22, "虾": 35, "虾仁": 40,
    "鱿鱼": 22, "螃蟹": 40, "扇贝": 25, "花蛤": 8, "蟹棒": 15,
    "虾滑": 30, "虾皮": 20,
    "大米": 4, "小米": 7, "糯米": 6, "莲子": 30, "燕麦": 10,
    "面粉": 3.5, "面条": 5, "挂面": 5, "荞麦面": 10, "乌冬面": 8,
    "意面": 10, "米粉": 6, "粉丝": 8, "粉条": 7, "馒头": 4,
    "面包": 12, "吐司": 12, "全麦面包": 15, "饺子": 15, "馄饨": 15,
    "包子": 12, "糯米粉": 7, "藕粉": 20, "藜麦": 25, "薏米": 12,
    "奇亚籽": 30,
    "豆腐": 4, "嫩豆腐": 4, "老豆腐": 4.5, "豆干": 8, "腐竹": 18,
    "豆浆": 4, "毛豆": 7, "蚕豆": 8, "黄豆": 6, "绿豆": 8,
    "红豆": 9, "鹰嘴豆": 12,
    "牛奶": 6, "酸奶": 8, "奶酪": 35, "黄油": 40, "奶油": 30,
    "椰浆": 12,
    "花生": 10, "核桃": 25, "腰果": 35, "芝麻": 12, "红枣": 15,
    "枸杞": 30,
    "苹果": 7, "香蕉": 4, "橙子": 7, "橘子": 6, "柠檬": 10,
    "葡萄": 10, "西瓜": 2.5, "草莓": 20, "蓝莓": 30, "菠萝": 5,
    "芒果": 10, "梨": 6, "桃子": 8, "猕猴桃": 12, "火龙果": 8,
    "柚子": 5, "木瓜": 7, "樱桃": 30, "荔枝": 15, "龙眼": 12,
    "百香果": 12, "蔓越莓": 25, "石榴": 8, "椰子": 8, "无花果": 15,
    "牛油果": 15,
    "食用油": 10, "花生油": 15, "橄榄油": 40, "香油": 25,
    "盐": 2, "白糖": 4, "冰糖": 6, "生抽": 8, "老抽": 8,
    "酱油": 8, "醋": 6, "料酒": 6, "蚝油": 10, "豆瓣酱": 8,
    "黄豆酱": 8, "甜面酱": 8, "辣椒酱": 10, "老干妈": 12,
    "火锅底料": 15, "咖喱块": 15, "味噌": 15, "番茄酱": 10,
    "沙拉酱": 15, "芝麻酱": 15, "花生酱": 15, "腐乳": 10,
    "淀粉": 5, "蜂蜜": 30, "鱼露": 12, "豆豉": 10, "酵母": 15,
    "速冻饺子": 12, "速冻包子": 12, "手抓饼": 10, "冻薯条": 10,
    "冻豌豆": 8, "冻玉米粒": 8, "冻虾仁": 35, "冻鸡块": 18,
    "汤圆": 10, "冷冻混合菜": 10,
}

CATEGORY_DEFAULT_PER_500G: dict[str, float] = {
    "蔬菜": 6,
    "肉蛋": 20,
    "水产": 28,
    "主食": 7,
    "豆乳": 8,
    "调料": 12,
    "水果": 10,
    "冷冻食品": 15,
}

FALLBACK_PER_500G = 10.0
# Rough per-meal takeout price used only for the "省下外卖钱" estimate.
TAKEOUT_PER_MEAL = 30.0


def price_for(canonical: str) -> float:
    if canonical in PRICES_PER_500G:
        return PRICES_PER_500G[canonical]
    return CATEGORY_DEFAULT_PER_500G.get(category_of(canonical), FALLBACK_PER_500G)


def price_facts_payload() -> dict:
    return {
        "per500g": dict(sorted(PRICES_PER_500G.items())),
        "category_default": dict(sorted(CATEGORY_DEFAULT_PER_500G.items())),
        "fallback": FALLBACK_PER_500G,
        "takeout_per_meal": TAKEOUT_PER_MEAL,
    }


def validate_prices() -> list[str]:
    problems: list[str] = []
    known = canonical_set()
    for name, price in PRICES_PER_500G.items():
        if name not in known:
            problems.append(f"价格表含目录外食材: {name}")
        if price <= 0:
            problems.append(f"价格必须为正: {name}")
    for category, price in CATEGORY_DEFAULT_PER_500G.items():
        if price <= 0:
            problems.append(f"类别兜底价必须为正: {category}")
    return problems