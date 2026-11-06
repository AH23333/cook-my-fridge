/* Weekly planner page: render, persist, reroll, and shopping list. */
(function () {
  "use strict";

  const CMF = window.CMF;
  const WEEKDAY_LABELS = ["周一", "周二", "周三", "周四", "周五", "周六", "周日"];
  const weekRoot = document.getElementById("week-root");
  const shopRoot = document.getElementById("shop-root");

  function getState() {
    const raw = (() => {
      try {
        return JSON.parse(localStorage.getItem("cmf.week"));
      } catch (e) {
        return null;
      }
    })();
    return raw || { seed: 1, days: [] };
  }

  function saveState(state) {
    localStorage.setItem("cmf.week", JSON.stringify(state));
  }

  function ensureWeek(state) {
    if (!state.days || !state.days.length) {
      state.days = CMF.buildWeek(
        CMF.data.recipes,
        CMF.getFridge(),
        CMF.getPrefs(),
        state.seed
      );
      saveState(state);
    }
    return state;
  }

  function renderWeek(state) {
    const cards = state.days
      .map((d) => {
        const r = CMF.data.recipes.find((x) => x.id === d.recipeId);
        const emoji = r ? CMF.emojiOf(r.ingredients[0] ? r.ingredients[0].canonical : "") : "";
        return (
          '<div class="week-card">' +
          `<div class="week-day">${WEEKDAY_LABELS[d.index]}</div>` +
          `<a class="week-title" href="recipe.html?id=${encodeURIComponent(d.recipeId)}">${emoji} ${CMF.esc(d.title)}</a>` +
          `<button class="btn btn-sm week-reroll" data-day="${d.index}">换一个</button>` +
          "</div>"
        );
      })
      .join("");
    weekRoot.innerHTML = '<div class="week-grid">' + cards + "</div>";

    weekRoot.querySelectorAll(".week-reroll").forEach((btn) => {
      btn.onclick = () => {
        const idx = Number(btn.dataset.day);
        const nextSeed = (state.seed + 997 + idx) >>> 0;
        state.days = CMF.rerollDay(
          state.days,
          idx,
          CMF.data.recipes,
          CMF.getFridge(),
          CMF.getPrefs(),
          nextSeed
        );
        state.seed = nextSeed;
        saveState(state);
        renderAll();
      };
    });
  }

  function renderShopping(state) {
    const list = CMF.weekShopping(
      state.days,
      CMF.data.recipes,
      CMF.getFridge()
    );
    if (!list.length) {
      shopRoot.innerHTML =
        '<h2 class="section-title">🛒 本周采购</h2><div class="empty">现有食材足够，无需额外采购。</div>';
      return;
    }
    const rows = list
      .map(
        (item) =>
          `<li>${CMF.emojiOf(item.canonical)} ${CMF.esc(item.canonical)} <span class="shop-meta">用于 ${item.recipes.length} 道菜</span></li>`
      )
      .join("");
    shopRoot.innerHTML =
      '<h2 class="section-title">🛒 本周采购</h2>' +
      '<button class="btn btn-sm" id="copy-week-list" style="margin-bottom:10px">复制采购清单</button>' +
      '<ul class="week-shop-list">' + rows + "</ul>";

    shopRoot.querySelector("#copy-week-list").onclick = () => {
      const text =
        "CookMyFridge 一周采购清单\n" +
        list.map((i) => `- ${i.canonical}（用于 ${i.recipes.length} 道菜）`).join("\n");
      const done = () => {
        const b = document.getElementById("copy-week-list");
        b.textContent = "✓ 已复制";
        setTimeout(() => (b.textContent = "复制采购清单"), 1500);
      };
      CMF.copyText(text)
        .then((ok) => (ok ? done() : CMF.toast("复制失败，请手动选择")))
        .catch(() => CMF.toast("复制失败，请手动选择"));
    };
  }

  function renderAll() {
    let state = ensureWeek(getState());
    renderWeek(state);
    renderShopping(state);
  }

  document.getElementById("btn-shuffle").onclick = () => {
    const state = getState();
    state.seed = (state.seed + 1337) >>> 0;
    state.days = CMF.buildWeek(
      CMF.data.recipes,
      CMF.getFridge(),
      CMF.getPrefs(),
      state.seed
    );
    saveState(state);
    renderAll();
  };

  CMF.boots("planner.html", renderAll);
})();
