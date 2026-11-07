/* Rough ingredient cost estimates. All numbers are heuristics from the
   Python price model; every UI surface must label totals as 估算. */
(function () {
  "use strict";

  const CMF = (window.CMF = window.CMF || {});

  function facts() {
    return (CMF.data && CMF.data.catalog && CMF.data.catalog.price_facts) || null;
  }

  CMF.pricePer500g = function (canonical) {
    const f = facts();
    if (!f) return null;
    if (Object.prototype.hasOwnProperty.call(f.per500g, canonical)) {
      return f.per500g[canonical];
    }
    const category = CMF.categoryOf ? CMF.categoryOf(canonical) : "其他";
    if (Object.prototype.hasOwnProperty.call(f.category_default, category)) {
      return f.category_default[category];
    }
    return f.fallback;
  };

  CMF.ingredientCost = function (canonical, grams) {
    const price = CMF.pricePer500g(canonical);
    if (price == null || !(grams > 0)) return 0;
    return (price / 500) * grams;
  };

  /* Whole-recipe cost at a given serving factor. Uses the same gram
     conversion as the nutrition estimate so the two cards stay consistent. */
  CMF.recipeCost = function (recipe, factor) {
    if (!facts() || typeof CMF.ingredientGrams !== "function") return null;
    const f = factor || 1;
    let total = 0;
    let unknown = 0;
    for (const use of recipe.ingredients) {
      const measure = CMF.ingredientGrams(use.canonical, use.amount);
      const grams = measure && measure.grams;
      if (!(grams > 0)) {
        unknown += 1;
        continue;
      }
      total += CMF.ingredientCost(use.canonical, grams * f);
    }
    return { total: Math.round(total * 10) / 10, unknown };
  };

  /* Shopping lists rarely carry exact amounts; default to a 200 g purchase
     unit per line and say so in the UI. */
  CMF.shoppingCost = function (items) {
    if (!facts()) return null;
    let total = 0;
    for (const item of items) {
      const grams = item.grams > 0 ? item.grams : 200;
      total += CMF.ingredientCost(item.canonical, grams);
    }
    return Math.round(total * 10) / 10;
  };

  CMF.takeoutPerMeal = function () {
    const f = facts();
    return f ? f.takeout_per_meal : 30;
  };

  /* "省下外卖钱": only counts cooked entries that carry a cost estimate. */
  CMF.savingsEstimate = function (cookedEntries) {
    const takeout = CMF.takeoutPerMeal();
    let saved = 0;
    let meals = 0;
    for (const entry of cookedEntries || []) {
      if (typeof entry.cost !== "number" || entry.cost < 0) continue;
      meals += 1;
      saved += Math.max(0, takeout - entry.cost);
    }
    return { saved: Math.round(saved), meals, takeout };
  };
})();