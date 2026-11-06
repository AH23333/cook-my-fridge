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
    const maxTime = criteria.maxTime;
    return recipes.filter((r) => {
      if (maxTime != null && r.time_minutes > maxTime) return false;
      if (methods.length && !methods.every((m) => r.methods.includes(m))) {
        return false;
      }
      if (tags.length && !tags.every((t) => r.tags.includes(t))) return false;
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
    const state = { text: "", methods: [], tags: [], maxTime: null };
    const grid = document.getElementById("browse-grid");
    const count = document.getElementById("browse-count");
    const vocab = CMF.data.vocab;

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

    document
      .getElementById("filter-bar")
      .addEventListener("click", (ev) => {
        const chip = ev.target.closest(".filter-chip");
        if (!chip) return;
        const value = chip.dataset.value;
        if (chip.dataset.kind === "method") toggle(state.methods, value);
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
