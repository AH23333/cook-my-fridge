/* Usage statistics aggregation. Pure logic, no DOM access. */
(function () {
  "use strict";

  const CMF = window.CMF;

  function tally(list) {
    const map = new Map();
    list.forEach((x) => map.set(x, (map.get(x) || 0) + 1));
    return map;
  }

  function topEntries(map, limit) {
    return [...map.entries()]
      .sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))
      .slice(0, limit)
      .map(([value, count]) => ({ value, count }));
  }

  CMF.personalStats = function (state) {
    const fridge = state.fridge || [];
    const favorites = state.favorites || [];
    const plan = state.plan || [];
    const history = state.history || [];

    const fridgeByCategory = new Map();
    fridge.forEach((c) => {
      const cat = CMF.categoryOf(c);
      fridgeByCategory.set(cat, (fridgeByCategory.get(cat) || 0) + 1);
    });

    // taste profile from favorite + planned recipe tags
    const tagCounter = new Map();
    const ingredientCounter = new Map();
    const byId = new Map(CMF.data.recipes.map((r) => [r.id, r]));
    [...favorites, ...plan].forEach((id) => {
      const r = byId.get(id);
      if (!r) return;
      r.tags.forEach((t) => tagCounter.set(t, (tagCounter.get(t) || 0) + 1));
      r.ingredients.forEach((i) =>
        ingredientCounter.set(i.canonical, (ingredientCounter.get(i.canonical) || 0) + 1)
      );
    });

    return {
      counts: {
        history: history.length,
        favorites: favorites.length,
        plan: plan.length,
        fridge: fridge.length,
      },
      fridgeByCategory: topEntries(fridgeByCategory, 12),
      topTags: topEntries(tagCounter, 8),
      topIngredients: topEntries(ingredientCounter, 8),
    };
  };

  CMF.datasetStats = function (recipes) {
    const categoryCounter = new Map();
    const methodCounter = new Map();
    const tagCounter = new Map();
    recipes.forEach((r) => {
      r.methods.forEach((m) => methodCounter.set(m, (methodCounter.get(m) || 0) + 1));
      r.tags.forEach((t) => tagCounter.set(t, (tagCounter.get(t) || 0) + 1));
      r.ingredients.forEach((i) => {
        const cat = CMF.categoryOf(i.canonical);
        categoryCounter.set(cat, (categoryCounter.get(cat) || 0) + 1);
      });
    });
    return {
      recipeCount: recipes.length,
      ingredientCount: CMF.allIngredients().length,
      byMethod: topEntries(methodCounter, 12),
      byTag: topEntries(tagCounter, 12),
      ingredientCategory: topEntries(categoryCounter, 12),
    };
  };
})();
