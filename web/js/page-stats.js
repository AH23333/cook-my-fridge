/* Stats page: render personal and dataset analytics with CSS bars. */
(function () {
  "use strict";

  const CMF = window.CMF;
  const root = document.getElementById("stats-root");

  function barRows(rows, maxCount, emoji) {
    return rows
      .map((r) => {
        const pct = maxCount ? Math.round((r.count / maxCount) * 100) : 0;
        const icon = emoji ? CMF.emojiOf(r.value) : "";
        return (
          '<div class="stat-row">' +
          `<span class="stat-label">${icon} ${CMF.esc(r.value)}</span>` +
          '<span class="stat-track"><span class="stat-fill" style="width:' + pct + '%"></span></span>' +
          `<span class="stat-count">${r.count}</span></div>`
        );
      })
      .join("");
  }

  function section(title, rows, emoji) {
    if (!rows.length) return "";
    const max = rows[0].count;
    return `<h3 class="stat-h">${title}</h3><div class="stat-bars">${barRows(rows, max, emoji)}</div>`;
  }

  function render() {
    const personal = CMF.personalStats({
      fridge: CMF.getFridge(),
      favorites: CMF.getFavorites(),
      plan: CMF.getPlan() ? CMF.getPlan().recipeIds : [],
      history: CMF.getHistory(),
    });
    const dataset = CMF.datasetStats(CMF.data.recipes);

    const countCards = Object.entries(personal.counts)
      .map(([k, v]) => {
        const label = { history: "开饭历史", favorites: "收藏", plan: "计划", fridge: "冰箱食材" }[k];
        return `<div class="stat-card"><span class="stat-card-num">${v}</span><span class="stat-card-label">${label}</span></div>`;
      })
      .join("");

    root.innerHTML =
      '<div class="stat-cards">' + countCards + "</div>" +
      section("🧊 冰箱食材分类", personal.fridgeByCategory, true) +
      section("🏷️ 我的口味标签", personal.topTags, false) +
      section("🥬 我常用的食材", personal.topIngredients, true) +
      `<h3 class="stat-h">📚 数据集概览（${dataset.recipeCount} 道菜 / ${dataset.ingredientCount} 食材）</h3>` +
      section("做法分布", dataset.byMethod, false) +
      section("标签分布", dataset.byTag, false) +
      section("食材分类分布", dataset.ingredientCategory, true);
  }

  CMF.boots("stats.html", render);
})();
