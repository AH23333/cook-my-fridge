/* Meal planner page: 1-4 weeks of lunch/dinner, balance score, shopping,
   .ics export and a Service-Worker-backed calendar subscription. */
(function () {
  "use strict";

  const CMF = window.CMF;
  const LABELS = CMF.WEEKDAY_LABELS || ["周一", "周二", "周三", "周四", "周五", "周六", "周日"];
  const MEAL_LABELS = { lunch: "午餐", dinner: "晚餐" };
  const weekRoot = document.getElementById("week-root");
  const shopRoot = document.getElementById("shop-root");
  const dietRoot = document.getElementById("week-diet-note");
  const summaryRoot = document.getElementById("balance-summary-root");
  const subscribeRoot = document.getElementById("subscribe-root");

  function pad(n) {
    return String(n).padStart(2, "0");
  }
  function isoDate(d) {
    return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate());
  }
  function shortDate(d) {
    return (d.getMonth() + 1) + "/" + d.getDate();
  }
  function dayDate(startDate, index) {
    const d = CMF.weekStartDate(startDate);
    d.setDate(d.getDate() + index);
    return d;
  }
  function calendarUrl() {
    return new URL(CMF.CALENDAR_PATH || "calendar.ics", location.href).href;
  }

  function getState() {
    let raw = null;
    try {
      raw = JSON.parse(localStorage.getItem("cmf.week"));
    } catch (e) {
      raw = null;
    }
    return raw && typeof raw === "object" ? raw : { seed: 1, weeks: 1, days: [] };
  }

  function weekCount(state) {
    const explicit = Math.max(1, Math.min(CMF.MAX_MENU_WEEKS || 4, Number(state.weeks) || 1));
    return Math.max(explicit, CMF.menuWeekCount ? CMF.menuWeekCount(state.days) : 0);
  }

  /* Publishing to Cache Storage makes /calendar.ics a real, subscription-ready
     URL: the service worker serves it even though no such file is deployed. */
  function publishCalendar(state) {
    if (!("caches" in window) || typeof CMF.weekToICS !== "function") {
      return Promise.resolve(false);
    }
    const ics = CMF.weekToICS(state.days, CMF.data.recipes, state.startDate);
    return caches
      .open(CMF.CALENDAR_CACHE || "cmf-calendar-v1")
      .then((cache) => cache.put(
        new Request(calendarUrl()),
        new Response(ics, {
          headers: {
            "Content-Type": "text/calendar; charset=utf-8",
            "Cache-Control": "no-cache",
          },
        })
      ))
      .then(() => true)
      .catch(() => false);
  }

  function saveState(state) {
    localStorage.setItem("cmf.week", JSON.stringify(state));
    publishCalendar(state); // keep subscribers fresh after every edit
  }

  function ensureWeek(state) {
    let dirty = false;
    if (!state.startDate) {
      state.startDate = isoDate(CMF.weekStartDate());
      dirty = true;
    }
    state.weeks = weekCount(state);
    if (!state.days || !state.days.length) {
      state.days = CMF.buildMenu(
        state.weeks, CMF.data.recipes, CMF.getFridge(), CMF.getPrefs(), state.seed
      );
      dirty = true;
    } else if (CMF.isLegacyWeek(state.days)) {
      state.days = CMF.migrateWeek(
        state.days, CMF.data.recipes, CMF.getFridge(), CMF.getPrefs(), state.seed
      );
      dirty = true;
      CMF.toast("菜单已升级为午餐 / 晚餐双餐");
    }
    if (state.days.some((d) => !d.lunch || !d.dinner)) {
      state.days = CMF.fillWeekMeals(
        state.days, CMF.data.recipes, CMF.getFridge(), CMF.getPrefs(), state.seed
      );
      dirty = true;
    }
    if (state.days.length !== state.weeks * 7) {
      state.days = CMF.resizeMenu(
        state.days, state.weeks, CMF.data.recipes, CMF.getFridge(), CMF.getPrefs(),
        (state.seed || 1) + 31
      );
      dirty = true;
    }
    if (dirty) saveState(state);
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

  function dayCard(state, d) {
    const nutrition = CMF.weekDayNutrition
      ? CMF.weekDayNutrition(state.days, d.index, CMF.data.recipes)
      : null;
    const kcal = nutrition && nutrition.meals
      ? `<div class="week-kcal">两餐合计约 ${nutrition.kcal} kcal/人 · 蛋白 ${nutrition.protein} g · 碳水 ${nutrition.carbs} g（未计主食与早餐）</div>`
      : "";
    const goal = nutrition && nutrition.meals && CMF.goalHint
      ? CMF.goalHint(nutrition, { meals: nutrition.meals })
      : "";
    const goalLine = goal ? `<div class="week-goal">${CMF.esc(goal)}</div>` : "";
    let badge = "";
    if (typeof CMF.balanceDay === "function") {
      const b = CMF.balanceDay(state.days, d.index, CMF.data.recipes);
      if (b) {
        const cls = b.score >= 70 ? "good" : b.score >= 55 ? "fair" : "poor";
        badge = `<div class="balance-badge ${cls}" title="${CMF.esc(b.issues.join("、") || "供能比合适")}">⚖️ ${b.score} 分 · ${b.grade}</div>`;
      }
    }
    return (
      '<div class="week-card">' +
      `<div class="week-day">${LABELS[d.index % 7]} · ${shortDate(dayDate(state.startDate, d.index))}</div>` +
      mealRow(d, "lunch") + mealRow(d, "dinner") + kcal + goalLine + badge +
      "</div>"
    );
  }

  function renderWeek(state) {
    const chunks = [];
    for (let w = 0; w < state.weeks; w += 1) {
      const days = state.days.filter((d) => Math.floor(d.index / 7) === w);
      if (!days.length) continue;
      const from = dayDate(state.startDate, w * 7);
      const to = dayDate(state.startDate, w * 7 + 6);
      const title = state.weeks > 1
        ? `第 ${w + 1} 周（${shortDate(from)} – ${shortDate(to)}）`
        : `本周安排（${CMF.esc(state.startDate)} 起）`;
      chunks.push(
        `<h2 class="section-title week-section">🍱 ${title}</h2>` +
        '<div class="week-grid">' + days.map((d) => dayCard(state, d)).join("") + "</div>"
      );
    }
    weekRoot.innerHTML = chunks.join("");

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

  function renderBalance(state) {
    if (!summaryRoot || typeof CMF.balanceMenu !== "function") return;
    const summary = CMF.balanceMenu(state.days, CMF.data.recipes);
    const personal = CMF.activeGoals && CMF.activeGoals()
      ? '<div class="balance-personal-note">🎯 均衡评分与热量对照按「我的冰箱 → 我的营养目标」计算。</div>'
      : "";
    summaryRoot.innerHTML = CMF.renderBalanceSummary(summary) + personal;
    const btn = summaryRoot.querySelector("#btn-optimize");
    if (btn) {
      btn.onclick = () => {
        const result = CMF.optimizeMenu(
          state.days, CMF.data.recipes, CMF.getFridge(), CMF.getPrefs(),
          (state.seed || 1) + 17
        );
        if (!result.changed) {
          CMF.toast("当前候选里没有更高分的搭配");
          return;
        }
        state.days = result.days;
        saveState(state);
        renderAll();
        CMF.toast(`已优化 ${result.changed} 天：均衡 ${result.before} → ${result.after} 分`);
      };
    }
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
    const meals = CMF.weekMeals(state.days).length;
    if (!list.length) {
      shopRoot.innerHTML =
        '<h2 class="section-title">🛒 跨周采购</h2><div class="empty">现有食材足够，无需额外采购。</div>';
      return;
    }
    const rows = list
      .map((item) => {
        const weeks = state.weeks > 1
          ? ` · ${item.weeks.map((w) => "第" + (w + 1) + "周").join("、")}`
          : "";
        return `<li>${CMF.emojiOf(item.canonical)} ${CMF.esc(item.canonical)} ` +
          `<span class="shop-meta">用于 ${item.recipes.length} 道菜${weeks}</span></li>`;
      })
      .join("");
    shopRoot.innerHTML =
      `<h2 class="section-title">🛒 跨周采购（${meals} 餐 · ${state.weeks} 周）</h2>` +
      '<button class="btn btn-sm" id="copy-week-list" style="margin-bottom:10px">复制采购清单</button>' +
      '<ul class="week-shop-list">' + rows + "</ul>";

    shopRoot.querySelector("#copy-week-list").onclick = () => {
      const text =
        `CookMyFridge ${state.weeks} 周采购清单\n` +
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

  function renderWeekSelect(state) {
    const select = document.getElementById("week-count");
    if (!select) return;
    select.value = String(state.weeks);
  }

  function renderSubscribe() {
    if (!subscribeRoot) return;
    const url = calendarUrl();
    const webcal = url.replace(/^https:/, "webcal:").replace(/^http:/, "webcal:");
    const swReady = navigator.serviceWorker && navigator.serviceWorker.controller;
    subscribeRoot.innerHTML =
      '<div class="subscribe-box"><h3>📅 日历订阅</h3>' +
      `<input class="subscribe-url" id="subscribe-url" readonly value="${CMF.esc(url)}">` +
      '<div class="subscribe-actions">' +
      '<button class="btn btn-sm btn-primary" id="copy-subscribe">复制订阅链接</button>' +
      '<button class="btn btn-sm" id="copy-webcal">复制 webcal 链接</button>' +
      '<button class="btn btn-sm" id="btn-unsubscribe">关闭订阅</button>' +
      "</div>" +
      '<p class="subscribe-note">把链接加入日历 App 的「订阅日历」即可；菜单每次改动会自动同步。' +
      "订阅依赖 Service Worker 拦截 <code>calendar.ics</code>，需站点部署在公网 HTTPS 且浏览器已访问过本站" +
      (swReady ? "（当前已激活 ✓）" : "（当前尚未激活，刷新一次即可）") +
      "。本地 localhost 链接仅供测试。" +
      `<br>webcal 链接：<code>${CMF.esc(webcal)}</code></p></div>`;

    const copy = (value, label) => CMF.copyText(value)
      .then((ok) => CMF.toast(ok ? label + "已复制" : "复制失败，请手动选择"))
      .catch(() => CMF.toast("复制失败，请手动选择"));
    subscribeRoot.querySelector("#copy-subscribe").onclick = () => copy(url, "订阅链接");
    subscribeRoot.querySelector("#copy-webcal").onclick = () => copy(webcal, "webcal 链接");
    subscribeRoot.querySelector("#btn-unsubscribe").onclick = () => {
      if ("caches" in window) {
        caches.open(CMF.CALENDAR_CACHE || "cmf-calendar-v1")
          .then((cache) => cache.delete(new Request(url)))
          .catch(() => {});
      }
      subscribeRoot.innerHTML = "";
      CMF.toast("订阅已关闭");
    };
  }

  function renderAll() {
    const state = ensureWeek(getState());
    renderWeekSelect(state);
    renderBalance(state);
    renderWeek(state);
    renderDiets();
    renderShopping(state);
  }

  document.getElementById("week-count").onchange = (ev) => {
    const state = ensureWeek(getState());
    const weeks = Math.max(1, Math.min(CMF.MAX_MENU_WEEKS || 4, Number(ev.target.value) || 1));
    state.weeks = weeks;
    state.days = CMF.resizeMenu(
      state.days, weeks, CMF.data.recipes, CMF.getFridge(), CMF.getPrefs(),
      (state.seed || 1) + 31
    );
    saveState(state);
    renderAll();
    CMF.toast(`菜单已调整为 ${weeks} 周`);
  };

  document.getElementById("btn-shuffle").onclick = () => {
    const state = getState();
    state.seed = ((state.seed || 1) + 1337) >>> 0;
    state.weeks = weekCount(state);
    state.days = CMF.buildMenu(
      state.weeks, CMF.data.recipes, CMF.getFridge(), CMF.getPrefs(), state.seed
    );
    saveState(state);
    renderAll();
    CMF.toast("整份菜单已重新生成");
  };

  document.getElementById("btn-export-ics").onclick = () => {
    const state = ensureWeek(getState());
    const ics = CMF.weekToICS(state.days, CMF.data.recipes, state.startDate);
    const blob = new Blob([ics], { type: "text/calendar;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "CookMyFridge-" + state.startDate.replace(/-/g, "") +
      "-" + state.weeks + "w.ics";
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    CMF.toast("日历文件已导出（.ics）");
  };

  document.getElementById("btn-copy-week").onclick = () => {
    const state = ensureWeek(getState());
    CMF.copyText(CMF.weekToText(state.days, state.startDate))
      .then((ok) => CMF.toast(ok ? "整份菜单已复制" : "复制失败，请手动选择"))
      .catch(() => CMF.toast("复制失败，请手动选择"));
  };

  document.getElementById("btn-subscribe").onclick = () => {
    const state = ensureWeek(getState());
    publishCalendar(state).then((ok) => {
      if (!ok) {
        CMF.toast("当前环境不支持日历订阅（需 HTTPS 与缓存 API）");
        return;
      }
      renderSubscribe();
      CMF.toast("订阅已开启，菜单变化会自动同步");
    });
  };

  CMF.boots("planner.html", renderAll);
})();
