/* In-browser retrieval, mirroring cookmyfridge.search exactly. */
(function () {
  "use strict";

  const CMF = (window.CMF = window.CMF || {});

  const ALMOST_MAX_MISSING = 3;
  const DIFFICULTY_RANK = { 简单: 0, 中等: 1, 较难: 2 };

  function requiredIngredients(recipe) {
    return recipe.ingredients
      .filter((i) => !i.optional)
      .map((i) => i.canonical);
  }

  function matchRecipe(recipe, selectedSet) {
    const required = new Set(requiredIngredients(recipe));
    const matched = [];
    const missing = [];
    const missingStaples = [];
    required.forEach((c) => {
      if (selectedSet.has(c)) matched.push(c);
      else if (CMF.isStaple(c)) missingStaples.push(c);
      else missing.push(c);
    });
    matched.sort();
    missing.sort();
    missingStaples.sort();

    const missingSubs = {};
    missing.forEach((c) => {
      const subs = CMF.substitutionsFor(c);
      if (subs.length) missingSubs[c] = subs;
    });

    const count = missing.length;
    const bucket =
      count === 0
        ? "cook_now"
        : count <= ALMOST_MAX_MISSING
        ? "almost_there"
        : "out_of_reach";

    return {
      recipe,
      matched,
      missing,
      missingStaples,
      missingSubs,
      missingCount: count,
      bucket,
    };
  }

  function passes(recipe, filters) {
    if (!filters) return true;
    if (filters.methods && filters.methods.length) {
      if (!filters.methods.some((m) => recipe.methods.includes(m))) return false;
    }
    if (filters.maxTime != null && recipe.time_minutes > filters.maxTime) return false;
    if (filters.difficulty && filters.difficulty.length) {
      if (!filters.difficulty.includes(recipe.difficulty)) return false;
    }
    if (filters.tags && filters.tags.length) {
      if (!filters.tags.some((t) => recipe.tags.includes(t))) return false;
    }
    if (filters.nutrition && filters.nutrition.length) {
      if (typeof CMF.recipeNutrition !== "function") return false;
      const have = CMF.recipeNutrition(recipe);
      if (!filters.nutrition.some((f) => have.includes(f))) return false;
    }
    if (filters.diets && filters.diets.length) {
      // Fail closed when the diet rules are unavailable: silently showing an
      // unsafe recipe would be worse than showing an empty result set.
      if (typeof CMF.matchesDiets !== "function") return false;
      if (!CMF.matchesDiets(recipe, filters.diets)) return false;
    }
    return true;
  }

  function sortKey(m) {
    return [
      m.missingCount,
      -m.matched.length,
      m.recipe.time_minutes,
      DIFFICULTY_RANK[m.recipe.difficulty] ?? 3,
      m.recipe.id,
    ];
  }

  function compareArrays(a, b) {
    for (let i = 0; i < Math.max(a.length, b.length); i++) {
      if (a[i] !== b[i]) return a[i] < b[i] ? -1 : 1;
    }
    return 0;
  }

  CMF.similarRecipes = function (recipe, recipes, limit) {
    const target = new Set(
      recipe.ingredients.filter((i) => !i.optional).map((i) => i.canonical)
    );
    return recipes
      .filter((r) => r.id !== recipe.id)
      .map((r) => ({
        recipe: r,
        shared: r.ingredients.filter(
          (i) => !i.optional && target.has(i.canonical)
        ).length,
      }))
      .filter((x) => x.shared > 0)
      .sort(
        (a, b) =>
          b.shared - a.shared ||
          a.recipe.time_minutes - b.recipe.time_minutes ||
          (a.recipe.id < b.recipe.id ? -1 : 1)
      )
      .slice(0, limit || 4)
      .map((x) => x.recipe);
  };

  CMF.search = function (recipes, selected, filters) {
    const selectedSet = new Set(selected);
    const cookNow = [];
    const almost = [];
    for (const recipe of recipes) {
      if (!passes(recipe, filters)) continue;
      const m = matchRecipe(recipe, selectedSet);
      // Mirror Python candidate pruning: a recipe must share at least one
      // selected ingredient, otherwise it is unrelated to this query.
      if (!m.matched.length) continue;
      if (m.bucket === "cook_now") cookNow.push(m);
      else if (m.bucket === "almost_there") almost.push(m);
    }
    cookNow.sort((a, b) => compareArrays(sortKey(a), sortKey(b)));
    almost.sort((a, b) => compareArrays(sortKey(a), sortKey(b)));
    return { cookNow, almostThere: almost };
  };

  CMF.matchRecipe = matchRecipe;
})();
