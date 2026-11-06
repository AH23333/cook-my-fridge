/* Weekly meal planner: deterministic pure logic, no DOM access. */
(function () {
  "use strict";

  const CMF = window.CMF;
  const DAYS = 7;

  function mulberry32(seed) {
    let a = seed >>> 0;
    return function () {
      a |= 0;
      a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function recipeAllergens(recipe) {
    if (recipe.allergens && recipe.allergens.length) return recipe.allergens;
    const found = new Set();
    (recipe.ingredients || []).forEach((i) => {
      CMF.allergensOf(i.canonical).forEach((a) => found.add(a));
    });
    return [...found];
  }

  function eligibleRecipes(recipes, prefs) {
    const blockedAllergens = new Set((prefs && prefs.allergens) || []);
    const tags = new Set((prefs && prefs.tags) || []);
    const vegetarian = tags.has("素食");
    return recipes.filter((r) => {
      if (blockedAllergens.size) {
        const has = recipeAllergens(r).some((a) => blockedAllergens.has(a));
        if (has) return false;
      }
      if (vegetarian && !(r.tags || []).includes("素食")) return false;
      return true;
    });
  }

  function pickRecipe(pool, fridge, usedTitles, rng) {
    const fridgeSet = new Set(fridge);
    let best = null;
    let bestKey = null;
    pool.forEach((r) => {
      if (usedTitles.has(r.title)) return;
      const m = CMF.matchRecipe(r, fridgeSet);
      const tie = rng();
      const key = [m.missingCount, tie, r.id];
      if (bestKey === null || key[0] < bestKey[0] ||
          (key[0] === bestKey[0] && key[1] < bestKey[1])) {
        best = r;
        bestKey = key;
      }
    });
    return best;
  }

  CMF.buildWeek = function (recipes, fridge, prefs, seed) {
    const rng = mulberry32(seed || 1);
    const pool = eligibleRecipes(recipes, prefs);
    const usedTitles = new Set();
    const days = [];
    for (let i = 0; i < DAYS; i += 1) {
      const recipe = pickRecipe(pool, fridge, usedTitles, rng);
      if (!recipe) break;
      usedTitles.add(recipe.title);
      days.push({ index: i, recipeId: recipe.id, title: recipe.title });
    }
    return days;
  };

  CMF.rerollDay = function (days, index, recipes, fridge, prefs, seed) {
    const rng = mulberry32(seed || (Date.now() & 0xffffffff));
    const pool = eligibleRecipes(recipes, prefs);
    const usedTitles = new Set(
      days.filter((d) => d.index !== index).map((d) => d.title)
    );
    const recipe = pickRecipe(pool, fridge, usedTitles, rng);
    if (!recipe) return days;
    return days.map((d) =>
      d.index === index
        ? { index, recipeId: recipe.id, title: recipe.title }
        : d
    );
  };

  CMF.weekShopping = function (days, recipes, fridge) {
    const byId = new Map(recipes.map((r) => [r.id, r]));
    const fridgeSet = new Set(fridge);
    const need = new Map();
    days.forEach((d) => {
      const r = byId.get(d.recipeId);
      if (!r) return;
      const m = CMF.matchRecipe(r, fridgeSet);
      m.missing.forEach((c) => {
        if (!need.has(c)) need.set(c, []);
        need.get(c).push(r.title);
      });
    });
    return [...need.keys()].sort().map((c) => ({
      canonical: c,
      recipes: need.get(c),
    }));
  };
})();
