/* Weekly planner page: lunch/dinner cards, reroll, nutrition, shopping, ICS. */
(function () {
  "use strict";

  const CMF = window.CMF;
  const LABELS = CMF.WEEKDAY_LABELS || ["周一", "周二", "周三", "周四", "周五", "周六", "周日"];
  const MEAL_LABELS = { lunch: "午餐", dinner: "晚餐" };
  const weekRoot = document.getElementById("week-root");
  const shopRoot = document.getElementById("shop-root");
  const dietRoot = document.getElementById("week-diet-note");

  function pad(n) {
    return String(n).padStart(2, "0");
  }
  function isoDate(d) {
    return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate());
  }

  function getState() {
    let raw = null;
    try {
      raw = JSON.parse(localStorage.getItem("cmf.week"));
    } catch (e) {
      raw = null;
    }
    return raw && typeof raw === "object" ? raw : { seed: 1, days: [] };
  }

  function saveState(state) {
    localStorage.setItem("cmf.week", JSON.stringify(state));
  }

  function ensureWeek(state) {
    if (!state.startDate) state.startDate = isoDate(CMF.weekStartDate());
    if (!state.days || !state.days.length) {
      state.days = CMF.buildWeek(
        CMF.data.recipes, CMF.getFridge(), CMF.getPrefs(), state.seed
      );
      saveState(state);
      return state;
    }
    if (CMF.isLegacyWeek(state.days)) {
      state.days = CMF.migrateWeek(
        state.days, CMF.data.recipes, CMF.getFridge(), CMF.getPrefs(), state.seed
      );
      saveState(state);
      CMF.toast("菜单已升级为午餐 / 晚餐双餐");
    } else if (state.days.some((d) => !d.lunch || !d.dinner)) {
      state.days = CMF.fillWeekMeals(
        state.days, CMF.data.recipes, CMF.getFridge(), CMF.getPrefs(), state.seed
      );
      saveState(state);
    }
    return state;
  }

  function mealRow(day, meal) {
    const item = day[meal];
    const title = item ? item.title : "待安排";
    const link = item
      ? `<a class="week-title" href="recipe.html?id=${encodeURIComponent(item.recipeId)}">${CMF.esc(title)}</a>`
      : '<span class="week-title empty-meal">待安排</span>';
    return (
      '<div class="week-meal">' +
      `<span class="week-meal-label">${meal === "lunch" ? "🌤" : "🌙"} ${MEAL_LABELS[meal]}</span>` +
      link +
      `<button class="btn btn-sm week-reroll" data-day="${day.index}" data-meal="${meal}">换一个</button>` +
      "</div>"
    );
  }

  function renderWeek(state) {
    const cards = state.days
      .map((d) => {
        const nutrition = CMF.weekDayNutrition
          ? CMF.weekDayNutrition(state.days, d.index, CMF.data.recipes)
          : null;
        const kcal = nutrition && nutrition.meals
          ? `<div class="week-kcal">两餐合计约 ${nutrition.kcal} kcal/人 · 蛋白 ${nutrition.protein} g · 碳水 ${nutrition.carbs} g（未计主食与早餐）</div>`
          : "";
        return (
          '<div class="week-card">' +
          `<div class="week-day">${LABELS[d.index]}</div>` +
          mealRow(d, "lunch") + mealRow(d, "dinner") + kcal +
          "</div>"
        );
      })
      .join("");
    weekRoot.innerHTML =
      '<h2 class="section-title">🍱 本周安排（' + CMF.esc(state.startDate) + ' 起）</h2>' +
      '<div class="week-grid">' + cards + "</div>";

    weekRoot.querySelectorAll(".week-reroll").forEach((btn) => {
      btn.onclick = () => {
        const idx = Number(btn.dataset.day);
        const meal = btn.dataset.meal;
        const nextSeed = (state.seed + 997 + idx * 2 + (meal === "dinner" ? 1 : 0)) >>> 0;
        state.days = CMF.rerollMeal(
          state.days, idx, meal,
          CMF.data.recipes, CMF.getFridge(), CMF.getPrefs(), nextSeed
        );
        state.seed = nextSeed;
        saveState(state);
        renderAll();
      };
    });
  }

  function renderDiets() {
    if (!dietRoot) return;
    const diets = CMF.getDiets();
    if (!diets.length) {
      dietRoot.innerHTML = "";
      return;
    }
    dietRoot.innerHTML =
      '<div class="notice safe">🌱 已按饮食偏好筛选：' +
      diets.map((k) => CMF.esc(CMF.dietLabel ? CMF.dietLabel(k) : k)).join("、") +
      "（在「我的冰箱」页修改）</div>";
  }

  function renderShopping(state) {
    const list = CMF.weekShopping(state.days, CMF.data.recipes, CMF.getFridge());
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
      '<h2 class="section-title">🛒 本周采购（14 餐）</h2>' +
      '<button class="btn btn-sm" id="copy-week-list" style="margin-bottom:10px">复制采购清单</button>' +
      '<ul class="week-shop-list">' + rows + "</ul>";

    shopRoot.querySelector("#copy-week-list").onclick = () => {
      const text =
        "CookMyFridge 一周采购清单\n" +
        list.map((i) => `- ${i.canonical}（用于 ${i.recipes.length} 道菜）`).join("\n");
      const done = () => {
        const b = document.getElementById("copy-week-list");
        if (!b) return;
        b.textContent = "✓ 已复制";
        setTimeout(() => (b.textContent = "复制采购清单"), 1500);
      };
      CMF.copyText(text)
        .then((ok) => (ok ? done() : CMF.toast("复制失败，请手动选择")))
        .catch(() => CMF.toast("复制失败，请手动选择"));
    };
  }

  function renderAll() {
    const state = ensureWeek(getState());
    renderWeek(state);
    renderDiets();
    renderShopping(state);
  }

  document.getElementById("btn-shuffle").onclick = () => {
    const state = getState();
    state.seed = ((state.seed || 1) + 1337) >>> 0;
    state.days = CMF.buildWeek(
      CMF.data.recipes, CMF.getFridge(), CMF.getPrefs(), state.seed
    );
    saveState(state);
    renderAll();
    CMF.toast("整周菜单已重新生成");
  };

  document.getElementById("btn-export-ics").onclick = () => {
    const state = ensureWeek(getState());
    const ics = CMF.weekToICS(state.days, CMF.data.recipes, state.startDate);
    const blob = new Blob([ics], { type: "text/calendar;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "CookMyFridge-" + state.startDate.replace(/-/g, "") + ".ics";
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    CMF.toast("日历文件已导出（.ics）");
  };

  document.getElementById("btn-copy-week").onclick = () => {
    const state = ensureWeek(getState());
    CMF.copyText(CMF.weekToText(state.days, state.startDate))
      .then((ok) => CMF.toast(ok ? "整周菜单已复制" : "复制失败，请手动选择"))
      .catch(() => CMF.toast("复制失败，请手动选择"));
  };

  CMF.boots("planner.html", renderAll);
})();
