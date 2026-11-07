/* Browse every curated recipe with client-side filters. */
(function () {
  "use strict";

  const CMF = (window.CMF = window.CMF || {});

  /* Pure filter: text matches title/ingredient; methods/tags are additive
     (selected values must all be present); maxTime caps total minutes. */
  CMF.filterRecipes = function (recipes, criteria) {
    const text = String(criteria.text || "").trim().toLowerCase();
    const methods = criteria.methods || [];
    const tags = criteria.tags || [];
    const nutrition = criteria.nutrition || [];
    const diets = criteria.diets || [];
    const maxTime = criteria.maxTime;
    const maxCalories = criteria.maxCalories;
    const seasonal = !!criteria.seasonal;
    const month = new Date().getMonth() + 1;
    return recipes.filter((r) => {
      if (maxTime != null && r.time_minutes > maxTime) return false;
      if (seasonal) {
        if (typeof CMF.isInSeason !== "function") return false;
        const hit = r.ingredients.some(
          (i) => !i.optional && !CMF.isStaple(i.canonical) && CMF.isInSeason(i.canonical, month)
        );
        if (!hit) return false;
      }
      if (diets.length) {
        if (typeof CMF.matchesDiets !== "function") return false;
        if (!CMF.matchesDiets(r, diets)) return false;
      }
      if (maxCalories != null) {
        const est = typeof CMF.estimateNutrition === "function"
          ? CMF.estimateNutrition(r)
          : null;
        if (!est || est.perServing.kcal > maxCalories) return false;
      }
      if (methods.length && !methods.every((m) => r.methods.includes(m))) {
        return false;
      }
      if (tags.length && !tags.every((t) => r.tags.includes(t))) return false;
      if (nutrition.length) {
        const have = CMF.recipeNutrition ? CMF.recipeNutrition(r) : [];
        if (!nutrition.every((f) => have.includes(f))) return false;
      }
      if (text) {
        const haystack = (
          r.title +
          " " +
          r.ingredients.map((i) => i.canonical + " " + i.name).join(" ")
        ).toLowerCase();
        if (!haystack.includes(text)) return false;
      }
      return true;
    });
  };

  function init() {
    const state = {
      text: "", methods: [], tags: [], nutrition: [], diets: [],
      maxTime: null, maxCalories: null, seasonal: false,
    };
    const grid = document.getElementById("browse-grid");
    const count = document.getElementById("browse-count");
    const vocab = CMF.data.vocab;
    const NUTRITION_OPTIONS = ["高蛋白", "高纤维", "低脂", "低碳水", "优质碳水"];

    function toggle(list, value) {
      const idx = list.indexOf(value);
      if (idx >= 0) list.splice(idx, 1);
      else list.push(value);
    }

    function renderFilters() {
      const methodBox = document.getElementById("filter-methods");
      const tagBox = document.getElementById("filter-tags");
      methodBox.innerHTML = vocab.methods
        .map(
          (m) =>
            `<button class="filter-chip${state.methods.includes(m) ? " on" : ""}" data-kind="method" data-value="${CMF.esc(m)}">${CMF.esc(m)}</button>`
        )
        .join("");
      tagBox.innerHTML = vocab.tags
        .map(
          (t) =>
            `<button class="filter-chip${state.tags.includes(t) ? " on" : ""}" data-kind="tag" data-value="${CMF.esc(t)}">${CMF.esc(t)}</button>`
        )
        .join("");
      const nutBox = document.getElementById("filter-nutrition");
      if (nutBox) {
        nutBox.innerHTML = NUTRITION_OPTIONS
          .map(
            (f) =>
              `<button class="filter-chip${state.nutrition.includes(f) ? " on" : ""}" data-kind="nutrition" data-value="${CMF.esc(f)}">${CMF.esc(f)}</button>`
          )
          .join("");
      }
      const dietBox = document.getElementById("filter-diets");
      if (dietBox) {
        dietBox.innerHTML = (CMF.DIETS || [])
          .map(
            (d) =>
              `<button class="filter-chip${state.diets.includes(d.key) ? " on" : ""}" data-kind="diet" data-value="${d.key}" title="${CMF.esc(d.desc)}">${d.emoji} ${CMF.esc(d.label)}</button>`
          )
          .join("");
      }
      const seasonBox = document.getElementById("filter-seasonal");
      if (seasonBox) {
        const term = CMF.currentSolarTerm ? CMF.currentSolarTerm(new Date()) : null;
        const label = term ? "🌿 本月当季（" + term.name + "）" : "🌿 本月当季";
        seasonBox.innerHTML =
          `<button class="filter-chip${state.seasonal ? " on" : ""}" data-kind="seasonal" data-value="1" title="只看含本月当季食材的菜">${CMF.esc(label)}</button>`;
      }
    }

    function renderGrid() {
      const rows = CMF.filterRecipes(CMF.data.recipes, state);
      count.textContent = "共 " + rows.length + " 道菜";
      grid.innerHTML = rows
        .map((r) => CMF.recipeCard({ recipe: r, missing: [] }))
        .join("");
    }

    document.getElementById("browse-search").addEventListener("input", (ev) => {
      state.text = ev.target.value;
      renderGrid();
    });

    document.getElementById("time-select").addEventListener("change", (ev) => {
      const v = ev.target.value;
      state.maxTime = v === "all" ? null : Number(v);
      renderGrid();
    });

    const calorieSelect = document.getElementById("calorie-select");
    if (calorieSelect) {
      calorieSelect.addEventListener("change", (ev) => {
        const v = ev.target.value;
        state.maxCalories = v === "all" ? null : Number(v);
        renderGrid();
      });
    }

    document
      .getElementById("filter-bar")
      .addEventListener("click", (ev) => {
        const chip = ev.target.closest(".filter-chip");
        if (!chip) return;
        const value = chip.dataset.value;
        if (chip.dataset.kind === "method") toggle(state.methods, value);
        else if (chip.dataset.kind === "nutrition") toggle(state.nutrition, value);
        else if (chip.dataset.kind === "diet") toggle(state.diets, value);
        else if (chip.dataset.kind === "seasonal") state.seasonal = !state.seasonal;
        else toggle(state.tags, value);
        chip.classList.toggle("on");
        renderGrid();
      });

    grid.addEventListener("click", (ev) => {
      const fav = ev.target.closest(".fav-btn");
      const plan = ev.target.closest(".plan-btn");
      if (fav) {
        CMF.toggleFavorite(fav.dataset.favId);
        renderGrid();
      } else if (plan) {
        CMF.togglePlanRecipe(plan.dataset.planId);
        renderGrid();
      }
    });

    renderFilters();
    renderGrid();
  }

  CMF.boots("browse.html", init);
})();
