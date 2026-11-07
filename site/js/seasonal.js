/* Seasonal eating: solar terms and in-season ingredients. Pure offline;
   the data shard is authored in Python (seasonal.py) and audited. */
(function () {
  "use strict";

  const CMF = (window.CMF = window.CMF || {});

  function seasonalData() {
    return (CMF.data && CMF.data.catalog && CMF.data.catalog.seasonal) || null;
  }

  /* Mirrors seasonal.current_solar_term; `terms` is the 24-entry table in
     calendar order. Dates before 小寒 still belong to last year's 冬至. */
  CMF.solarTermOn = function (date, terms) {
    if (!terms || !terms.length) return null;
    const key = [date.getMonth() + 1, date.getDate()];
    let current = terms[terms.length - 1];
    let year = date.getFullYear() - 1;
    let idx = terms.length - 1;
    for (let i = 0; i < terms.length; i += 1) {
      const t = terms[i];
      if (t.month < key[0] || (t.month === key[0] && t.day <= key[1])) {
        current = t;
        year = date.getFullYear();
        idx = i;
      }
    }
    const next = terms[(idx + 1) % terms.length];
    return { name: current.name, month: current.month, day: current.day, year, next };
  };

  CMF.currentSolarTerm = function (date) {
    const data = seasonalData();
    return data ? CMF.solarTermOn(date || new Date(), data.solar_terms) : null;
  };

  CMF.seasonalNames = function (month) {
    const data = seasonalData();
    if (!data) return [];
    return (data.by_month && data.by_month[String(month)]) || [];
  };

  CMF.isInSeason = function (canonical, month) {
    const data = seasonalData();
    if (!data) return false;
    const months = data.seasonal[canonical];
    return !!months && months.includes(month);
  };

  /* Rank real dataset recipes by how many in-season (non-staple) ingredients
     they use. Deterministic: score, then fewer total ingredients, then time,
     then id — no randomness, so the banner is stable within a month. */
  CMF.seasonalRecipes = function (recipes, month, limit) {
    const names = new Set(CMF.seasonalNames(month));
    if (!names.size) return [];
    const rows = [];
    for (const r of recipes) {
      let hits = 0;
      const used = [];
      for (const i of r.ingredients) {
        if (names.has(i.canonical) && !(CMF.isStaple && CMF.isStaple(i.canonical))) {
          hits += 1;
          used.push(i.canonical);
        }
      }
      if (hits >= 1) rows.push({ recipe: r, hits, used });
    }
    rows.sort(
      (a, b) =>
        b.hits - a.hits ||
        a.recipe.ingredients.length - b.recipe.ingredients.length ||
        a.recipe.time_minutes - b.recipe.time_minutes ||
        (a.recipe.id < b.recipe.id ? -1 : 1)
    );
    return rows.slice(0, limit || 3);
  };
})();