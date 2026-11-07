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

  function renderJournalStats() {
    if (!CMF.journalSummary || !CMF.getJournal) return "";
    const journal = CMF.normalizeJournal(CMF.getJournal());
    const summary = CMF.journalSummary(journal);
    const streak = CMF.journalStreak ? CMF.journalStreak(journal) : 0;
    const savings = CMF.savingsEstimate ? CMF.savingsEstimate(journal.cooked) : null;

    const cards = [
      [summary.total, "累计打卡"],
      [summary.distinct, "做过菜式"],
      [streak + " 天", "当前连击"],
      [summary.avgRating ? summary.avgRating + " ★" : "—", "平均评分"],
    ]
      .map(([num, label]) => `<div class="stat-card"><span class="stat-card-num">${num}</span><span class="stat-card-label">${label}</span></div>`)
      .join("");
    const savingsCard = savings && savings.meals
      ? `<div class="savings-card">外卖钱 <strong>¥${savings.saved}</strong><span>按 ${savings.meals} 次打卡、外卖均价 ¥${savings.takeout}/餐 估算（仅含能算出成本的打卡）</span></div>`
      : "";

    let badges = "";
    if (CMF.achievements) {
      const state = {
        journal,
        favorites: CMF.getFavorites(),
        fridge: CMF.getFridge(),
        plan: CMF.getPlan() ? CMF.getPlan().recipeIds : [],
        shareStats: CMF.getShareStats ? CMF.getShareStats() : null,
      };
      badges =
        '<h3 class="stat-h">🏆 厨房成就</h3><div class="badge-grid">' +
        CMF.achievements(state)
          .map((b) => {
            const pct = Math.round((b.progress / b.target) * 100);
            return (
              `<div class="badge-card${b.earned ? " earned" : ""}" title="${CMF.esc(b.desc)}">` +
              `<span class="badge-emoji">${b.emoji}</span>` +
              `<span class="badge-label">${CMF.esc(b.label)}</span>` +
              `<span class="badge-progress">${b.progress}/${b.target}</span>` +
              '<span class="badge-track"><span class="badge-fill" style="width:' + pct + '%"></span></span>' +
              "</div>"
            );
          })
          .join("") +
        "</div>";
    }

    let topRated = "";
    if (CMF.topRated) {
      const rows = CMF.topRated(journal, 5);
      if (rows.length) {
        topRated =
          '<h3 class="stat-h">⭐ 我的最高评分</h3><div class="stat-bars">' +
          rows
            .map((r) => {
              const pct = Math.round((r.avg / 5) * 100);
              return (
                '<div class="stat-row">' +
                `<span class="stat-label"><a href="recipe.html?id=${encodeURIComponent(r.recipeId)}">${CMF.esc(r.title)}</a></span>` +
                '<span class="stat-track"><span class="stat-fill" style="width:' + pct + '%"></span></span>' +
                `<span class="stat-count">${r.avg}★ · ${r.count}次</span></div>`
              );
            })
            .join("") +
          "</div>";
      }
    }

    let trend = "";
    if (CMF.weeklyTrend) {
      const rows = CMF.weeklyTrend(journal, 7);
      const max = Math.max(1, ...rows.map((r) => r.count));
      trend =
        '<h3 class="stat-h">📅 近 7 天开饭</h3><div class="trend-grid">' +
        rows
          .map((r) => {
            const pct = Math.round((r.count / max) * 100);
            return (
              '<div class="trend-col">' +
              `<span class="trend-bar" style="height:${Math.max(4, pct)}%" title="${r.count} 次 · ${r.kcal} kcal · ¥${r.cost}"></span>` +
              `<span class="trend-count">${r.count || ""}</span>` +
              `<span class="trend-label">${r.label}</span></div>`
            );
          })
          .join("") +
        "</div>";
    }

    if (!summary.total) {
      return (
        '<h3 class="stat-h">🍳 开饭打卡</h3>' +
        '<div class="empty">还没有打卡记录。去 <a href="browse.html">菜谱页</a> 做一道菜，在详情页点「我做过这道菜」。</div>'
      );
    }
    return (
      '<h3 class="stat-h">🍳 开饭打卡</h3>' +
      '<div class="stat-cards">' + cards + "</div>" +
      savingsCard + badges + topRated + trend
    );
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
      renderJournalStats() +
      `<h3 class="stat-h">📚 数据集概览（${dataset.recipeCount} 道菜 / ${dataset.ingredientCount} 食材）</h3>` +
      section("做法分布", dataset.byMethod, false) +
      section("标签分布", dataset.byTag, false) +
      section("食材分类分布", dataset.ingredientCategory, true);
  }

  CMF.boots("stats.html", render);
})();
