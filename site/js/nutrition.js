/* Qualitative nutrition aggregation. Pure logic, no DOM access.
   These are ingredient-derived flags, not precise nutrition facts. */
(function () {
  "use strict";

  const CMF = window.CMF;
  const FLAG_ORDER = ["高蛋白", "高纤维", "低脂", "低碳水", "优质碳水", "高铁"];

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
})();
