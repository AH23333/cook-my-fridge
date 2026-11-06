/* Fridge clean-out planner: greedy set-cover that maximizes fridge usage.
   Pure logic, no DOM access. */
(function () {
  "use strict";

  const CMF = window.CMF;

  CMF.cleanoutPlan = function (recipes, fridge, opts) {
    const options = opts || {};
    const maxRecipes = options.maxRecipes || 4;
    const maxExtra = options.maxExtra == null ? 3 : options.maxExtra;
    const fridgeSet = new Set(fridge);
    const remaining = new Set(fridge);
    const selected = [];
    const usedTitles = new Set();

    function score(recipe) {
      const m = CMF.matchRecipe(recipe, fridgeSet);
      const newCovered = m.matched.filter((c) => remaining.has(c));
      return { m, newCovered, benefit: newCovered.length, cost: m.missingCount };
    }

    while (selected.length < maxRecipes) {
      let best = null;
      let bestScore = null;
      recipes.forEach((r) => {
        if (usedTitles.has(r.title)) return;
        const s = score(r);
        if (s.benefit === 0) return;
        if (s.cost > maxExtra) return;
        // ratio of benefit to cost, with stable tiebreak
        const ratio = s.benefit / (s.cost + 1);
        const key = [ratio, s.benefit, -s.cost];
        if (
          bestScore === null ||
          key[0] > bestScore[0] ||
          (key[0] === bestScore[0] &&
            (key[1] > bestScore[1] ||
              (key[1] === bestScore[1] && key[2] > bestScore[2])))
        ) {
          best = r;
          bestScore = key;
        }
      });
      if (!best) break;
      const s = score(best);
      s.newCovered.forEach((c) => remaining.delete(c));
      usedTitles.add(best.title);
      selected.push({
        recipeId: best.id,
        title: best.title,
        addedCoverage: s.newCovered,
        missing: s.m.missing,
      });
    }

    const covered = fridge.filter((c) => !remaining.has(c));
    const shoppingMap = new Map();
    selected.forEach((s) => {
      s.missing.forEach((c) => {
        if (!shoppingMap.has(c)) shoppingMap.set(c, []);
        shoppingMap.get(c).push(s.title);
      });
    });

    return {
      selected,
      coveredCount: covered.length,
      totalFridge: fridge.length,
      unusedFridge: [...remaining].sort(),
      shopping: [...shoppingMap.keys()].sort().map((c) => ({
        canonical: c,
        recipes: shoppingMap.get(c),
      })),
    };
  };
})();
