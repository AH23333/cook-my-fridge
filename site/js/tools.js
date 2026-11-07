/* Kitchen conversion tool: spoons/cups ↔ ml ↔ grams, oven temperatures and
   common baking substitutions. Pure offline heuristics, labeled as 近似. */
(function () {
  "use strict";

  const CMF = (window.CMF = window.CMF || {});

  // Empty/null input must not coerce to 0 (a real temperature or volume).
  const toNum = (v) => (v == null || v === "" ? NaN : Number(v));

  const ML_PER_UNIT = {
    ml: 1, 毫升: 1,
    小勺: 5, 茶匙: 5,
    勺: 15, 汤匙: 15, 大勺: 15,
    杯: 240,
    碗: 300,
  };
  CMF.TOOL_UNITS = Object.keys(ML_PER_UNIT).filter((u) => u !== "ml" && u !== "毫升");

  CMF.volumeToMl = function (value, unit) {
    const v = toNum(value);
    const per = ML_PER_UNIT[unit];
    if (!Number.isFinite(v) || v < 0 || per == null) return null;
    return Math.round(v * per * 10) / 10;
  };

  CMF.mlToUnit = function (ml, unit) {
    const v = toNum(ml);
    const per = ML_PER_UNIT[unit];
    if (!Number.isFinite(v) || v < 0 || per == null) return null;
    return Math.round((v / per) * 100) / 100;
  };

  /* g/ml, approximate home-kitchen densities. */
  const DENSITY = {
    面粉: 0.55, 糯米粉: 0.6, 淀粉: 0.6, 面包糠: 0.35,
    白糖: 0.85, 盐: 1.2, 大米: 0.85, 小米: 0.8, 糯米: 0.85, 燕麦: 0.4,
    食用油: 0.92, 花生油: 0.92, 橄榄油: 0.92, 香油: 0.92,
    牛奶: 1.03, 酸奶: 1.05, 豆浆: 1.0, 奶油: 1.0, 椰浆: 1.0,
    清水: 1.0, 高汤: 1.0,
    生抽: 1.15, 老抽: 1.15, 酱油: 1.15, 醋: 1.05, 白醋: 1.05,
    料酒: 1.0, 蚝油: 1.2, 蜂蜜: 1.4, 芝麻酱: 1.1, 花生酱: 1.1,
    番茄酱: 1.1, 沙拉酱: 1.0, 柠檬汁: 1.0, 白酒: 0.95, 鱼露: 1.1,
  };
  CMF.TOOL_DENSITY_INGREDIENTS = Object.keys(DENSITY);

  CMF.gramsForVolume = function (ml, ingredient) {
    const v = toNum(ml);
    if (!Number.isFinite(v) || v < 0) return null;
    const density = DENSITY[ingredient];
    if (density == null) return null; // unknown ingredient: don't guess silently
    return Math.round(v * density * 10) / 10;
  };

  CMF.volumeToGrams = function (value, unit, ingredient) {
    const ml = CMF.volumeToMl(value, unit);
    if (ml == null) return null;
    return CMF.gramsForVolume(ml, ingredient);
  };

  CMF.fToC = function (f) {
    const v = toNum(f);
    if (!Number.isFinite(v)) return null;
    return Math.round(((v - 32) * 5) / 9);
  };

  CMF.cToF = function (c) {
    const v = toNum(c);
    if (!Number.isFinite(v)) return null;
    return Math.round((v * 9) / 5 + 32);
  };

  CMF.BAKING_SUBS = [
    { from: "黄油 100 g", to: "植物油 75 g", note: "饼干/蛋糕可用，酥皮类不建议" },
    { from: "淡奶油 1 杯", to: "牛奶 3/4 杯 + 融化黄油 1/4 杯", note: "只能用于加热做法，不能打发" },
    { from: "泡打粉 1 小勺", to: "小苏打 1/4 小勺 + 柠檬汁/白醋 1/2 小勺", note: "酸碱配对才会蓬松" },
    { from: "玉米淀粉", to: "土豆淀粉 1:1", note: "勾芡通用" },
    { from: "白糖 100 g", to: "蜂蜜 75 g", note: "同时减少配方里约 25 g 液体" },
    { from: "鸡蛋 1 个（面团）", to: "亚麻籽粉 1 勺 + 水 3 勺，静置 5 分钟", note: "纯素替代，蓬松度略降" },
    { from: "牛奶 1 杯", to: "豆浆/燕麦奶 1 杯", note: "多数家常做法可直替" },
    { from: "低筋面粉 100 g", to: "中筋面粉 80 g + 玉米淀粉 20 g", note: "应急配法，口感接近" },
  ];
})();