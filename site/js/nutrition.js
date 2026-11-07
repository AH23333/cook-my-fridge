/* Nutrition: qualitative badges + quantitative estimates. Pure logic only.
   Numbers come from data/catalog.json -> nutrition_facts (per 100 g, approx).
   Household units are coarse by nature; every result is explicitly labelled
   as an estimate and never presented as clinical nutrition data. */
(function () {
  "use strict";

  const CMF = window.CMF;
  const FLAG_ORDER = ["高蛋白", "高纤维", "低脂", "低碳水", "优质碳水", "高铁"];
  const CJK_DIGITS = {
    一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5,
    六: 6, 七: 7, 八: 8, 九: 9, 十: 10, 半: 0.5,
  };
  const VAGUE_UNITS = new Set(["少许", "适量", "若干", "几滴", "几片", "几个", "几颗"]);
  const FALLBACK_GRAMS = 30;

  CMF.recipeNutrition = function (recipe) {
    const flags = new Set();
    (recipe.ingredients || []).forEach((use) => {
      if (use.optional) return;
      const entry = CMF.entry(use.canonical);
      if (entry && entry.nutrition) {
        entry.nutrition.forEach((f) => flags.add(f));
      }
    });
    return FLAG_ORDER.filter((f) => flags.has(f));
  };

  CMF.nutritionData = function () {
    const catalog = (CMF.data && CMF.data.catalog) || null;
    return (catalog && catalog.nutrition_facts) || null;
  };

  /* "2 个" / "1 小勺" / "半个" / "少许" / "100克" -> {quantity, unit, exact} */
  CMF.parseAmount = function (amount) {
    const text = String(amount == null ? "" : amount).trim();
    if (!text) return { quantity: 1, unit: "", exact: false };
    if (text.startsWith("半") && text.length > 1) {
      return { quantity: 0.5, unit: text.slice(1).trim(), exact: true };
    }
    if (text.startsWith("整") && text.length > 1) {
      const unit = text.slice(1).trim();
      return { quantity: 1, unit: "整" + unit, exact: true };
    }
    const numeric = text.match(/^(\d+(?:\.\d+)?)\s*(.*)$/);
    let quantity;
    let unit;
    let exact = true;
    if (numeric) {
      quantity = parseFloat(numeric[1]);
      unit = numeric[2].trim();
    } else if (VAGUE_UNITS.has(text)) {
      quantity = 1;
      unit = text;
      exact = false;
    } else {
      const cjk = text.match(/^([一两二三四五六七八九十半])\s*(.*)$/);
      if (cjk) {
        quantity = CJK_DIGITS[cjk[1]];
        unit = cjk[2].trim();
      } else {
        quantity = 1;
        unit = text;
        exact = false;
      }
    }
    if (!unit) unit = numeric || exact ? "个" : ""; // bare number => count as 个
    return { quantity: Math.max(0, quantity), unit, exact };
  };

  /* Grams for one ingredient line. `known=false` means we had to guess. */
  CMF.ingredientGrams = function (canonical, amount) {
    const facts = CMF.nutritionData();
    const parsed = CMF.parseAmount(amount);
    if (!facts) return { grams: 0, known: false, unit: parsed.unit };
    const overrides = facts.ingredient_units[canonical] || {};
    let per = overrides[parsed.unit];
    let known = per != null;
    if (per == null) {
      per = facts.unit_grams[parsed.unit];
      known = per != null;
    }
    if (per == null) per = FALLBACK_GRAMS;
    return {
      grams: Math.max(0, parsed.quantity * per),
      known,
      unit: parsed.unit,
    };
  };

  function servingsOf(recipe) {
    const tags = recipe.tags || [];
    if (tags.includes("一人食") || tags.includes("宝宝辅食")) return 1;
    return 2;
  }

  function emptyTotals() {
    return { kcal: 0, protein: 0, fat: 0, carbs: 0 };
  }

  /* Quantitative estimate. Optional ingredients are excluded (same rule as
     the qualitative badges). `factor` scales amounts, not the head count. */
  CMF.estimateNutrition = function (recipe, factor) {
    const facts = CMF.nutritionData();
    if (!facts || !recipe) return null;
    const scale = Number(factor) > 0 ? Number(factor) : 1;
    const total = emptyTotals();
    const lines = [];
    const unknownFacts = [];
    const unknownUnits = [];
    let grams = 0;
    let oilAdded = false;

    function accumulate(row, g, label) {
      const ratio = g / 100;
      total.kcal += row.kcal * ratio;
      total.protein += row.protein * ratio;
      total.fat += row.fat * ratio;
      total.carbs += row.carbs * ratio;
      grams += g;
      lines.push({
        canonical: label,
        grams: Math.round(g),
        kcal: Math.round(row.kcal * ratio),
        source: row.source,
      });
    }

    (recipe.ingredients || []).forEach((use) => {
      if (use.optional) return;
      const row = facts.per100g[use.canonical];
      if (!row) {
        unknownFacts.push(use.canonical);
        return;
      }
      const measure = CMF.ingredientGrams(use.canonical, use.amount);
      if (!measure.known) unknownUnits.push(use.canonical);
      accumulate(row, measure.grams * scale, use.canonical);
    });

    // Curated recipes treat cooking oil as a pantry staple and often omit it
    // from the ingredient list. For a dry-heat dish with no fat source at all,
    // count a modest 10 g of oil instead of reporting an implausible ~20 kcal.
    const FAT_SOURCES = new Set([
      "食用油", "花生油", "橄榄油", "香油", "黄油", "奶油", "五花肉",
      "培根", "香肠", "腊肉", "芝麻酱", "沙拉酱", "花生酱", "奶酪",
    ]);
    const OIL_METHODS = new Set(["炒", "煎", "炸", "烤", "空气炸锅"]);
    const hasFat = (recipe.ingredients || []).some(
      (use) => !use.optional && FAT_SOURCES.has(use.canonical)
    );
    const cooksWithOil = (recipe.methods || []).some((m) => OIL_METHODS.has(m));
    const oil = facts.per100g["食用油"];
    if (!hasFat && cooksWithOil && oil) {
      accumulate(oil, 10 * scale, "食用油（默认）");
      oilAdded = true;
    }

    const servings = servingsOf(recipe);
    const round1 = (n) => Math.round(n * 10) / 10;
    const perServing = {
      kcal: Math.round(total.kcal / servings),
      protein: round1(total.protein / servings),
      fat: round1(total.fat / servings),
      carbs: round1(total.carbs / servings),
    };
    const energy = {
      protein: total.protein * 4,
      fat: total.fat * 9,
      carbs: total.carbs * 4,
    };
    const energyTotal = energy.protein + energy.fat + energy.carbs;
    const pct = (v) => (energyTotal ? Math.round((v / energyTotal) * 100) : 0);

    return {
      total: {
        kcal: Math.round(total.kcal),
        protein: round1(total.protein),
        fat: round1(total.fat),
        carbs: round1(total.carbs),
      },
      perServing: perServing,
      servings: servings,
      grams: Math.round(grams),
      lines: lines.sort((a, b) => b.kcal - a.kcal),
      energyShare: {
        protein: pct(energy.protein),
        fat: pct(energy.fat),
        carbs: pct(energy.carbs),
      },
      unknownFacts: unknownFacts,
      unknownUnits: unknownUnits,
      oilAdded: oilAdded,
      factor: scale,
      note: facts.note,
    };
  };

  CMF.carbsPerServing = function (recipe) {
    const estimate = CMF.estimateNutrition(recipe);
    return estimate ? estimate.perServing.carbs : Infinity;
  };

  /* Reusable HTML card. Strings only - no DOM access, so Node harnesses and
     the canvas share card can consume the same numbers. */
  CMF.renderNutritionCard = function (recipe, factor) {
    const e = CMF.estimateNutrition(recipe, factor);
    if (!e) return "";
    const bar = (label, value, unit, cls) =>
      '<div class="nut-stat ' + cls + '">' +
      `<span class="nut-stat-label">${label}</span>` +
      `<strong>${value}<small>${unit}</small></strong>` +
      "</div>";
    const shares = e.energyShare;
    return (
      '<div class="nutrition-estimate">' +
      '<div class="nut-head"><span class="nutrition-label">🍽️ 营养估算 · 每份</span>' +
      `<span class="nut-servings">共 ${e.servings} 份 · 约 ${e.grams} 克食材</span></div>` +
      '<div class="nut-stats">' +
      bar("热量", e.perServing.kcal, " kcal", "kcal") +
      bar("蛋白质", e.perServing.protein, " g", "protein") +
      bar("脂肪", e.perServing.fat, " g", "fat") +
      bar("碳水", e.perServing.carbs, " g", "carbs") +
      "</div>" +
      '<div class="nut-energy" aria-label="三大营养素供能占比">' +
      `<span class="nut-energy-seg protein" style="width:${shares.protein}%"></span>` +
      `<span class="nut-energy-seg fat" style="width:${shares.fat}%"></span>` +
      `<span class="nut-energy-seg carbs" style="width:${shares.carbs}%"></span>` +
      "</div>" +
      '<div class="nut-legend">蛋白 ' + shares.protein + "% · 脂肪 " + shares.fat +
      "% · 碳水 " + shares.carbs + "%</div>" +
      `<div class="nut-note">${CMF.esc ? CMF.esc(e.note) : e.note}` +
      (e.unknownUnits.length
        ? " 其中 " + e.unknownUnits.length + " 项用量为估计值。"
        : "") +
      (e.oilAdded ? " 未列出油脂的炒菜按 10 g 食用油计入。" : "") +
      "</div></div>"
    );
  };
})();
