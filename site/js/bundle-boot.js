/* Data loading and persistent local storage. Exposes window.CMF. */
(function () {
  "use strict";

  const CMF = (window.CMF = window.CMF || {});

  const KEYS = {
    fridge: "cmf.fridge",
    history: "cmf.history",
    feedback: "cmf.feedback",
    prefs: "cmf.prefs",
    plan: "cmf.plan",
    favorites: "cmf.favorites",
    week: "cmf.week",
    urgent: "cmf.urgent",
    goals: "cmf.goals",
    shareStats: "cmf.shareStats",
    journal: "cmf.journal",
    inventory: "cmf.inventory",
  };

  CMF.KEYS = KEYS;

  async function fetchJSON(path) {
    const resp = await fetch(path, { cache: "no-cache" });
    if (!resp.ok) throw new Error("加载失败: " + path);
    return resp.json();
  }

  CMF.data = {
    catalog: null,
    recipes: [],
    vocab: null,
    ai: { wildcards: [], blindboxes: [], variants: [], ideas: [] },
    aiReady: false,
  };

  let corePromise = null;
  let aiPromise = null;

  function ensureLoad() {
    if (corePromise) return;
    const d = CMF.data;
    // One request for the whole blocking core (catalog + vocab merged at
    // build time): two parallel requests cost an extra round trip for a
    // 0.5 KB vocab on slow links. Deployed pages carry a build-injected
    // window.__cmfCore fetch that starts while the HTML is still parsing,
    // so the data wave overlaps the bundle download instead of queueing
    // behind it; the plain fetch is the fallback for the dev tree.
    corePromise = (window.__cmfCore || fetchJSON("data/core.json")).then((core) => {
      d.catalog = core.catalog;
      d.vocab = core.vocab;
      return d;
    });
    // recipes.json (184 KB) queues AFTER the blocking core (catalog+vocab,
    // ~92 KB): fetching it in parallel would still share the same pipe and
    // slow the wall on throttled links. The ingredient wall, search box,
    // seasonal banner and NL input all render from the core alone; pages
    // that need recipes at boot await preloadRecipes().
    recipesPromise = corePromise.then(() =>
      fetchJSON("data/recipes.json").catch(() => [])
    ).then((recipes) => {
      d.recipes = recipes;
      return recipes;
    });
  }

  let recipesPromise = null;

  CMF.preload = function () {
    ensureLoad();
    return corePromise;
  };

  CMF.preloadRecipes = function () {
    ensureLoad();
    return recipesPromise;
  };

  /* AI shards (~2 MB, mostly variants.json) are NOT fetched on the critical
     path: they only start downloading when a page actually needs AI content
     (result buckets, wildcard page, recipe ideas, favorites that contain AI
     cards). First screen never pays for them (measured on slow-3G: the wall
     renders from the ~290 KB core payload; variants.json arrives later only
     where it is used). Callers still get the same promise contract. */
  CMF.preloadAI = function () {
    ensureLoad();
    if (!aiPromise) {
      aiPromise = corePromise.then(() =>
        Promise.all([
          fetchJSON("data/ai/wildcards.json").catch(() => []),
          fetchJSON("data/ai/blindboxes.json").catch(() => []),
          fetchJSON("data/ai/variants.json").catch(() => []),
          fetchJSON("data/ai/ideas.json").catch(() => []),
        ])
      ).then(([wild, blind, variants, ideas]) => {
        const d = CMF.data;
        d.ai.wildcards = wild;
        d.ai.blindboxes = blind;
        d.ai.variants = variants;
        d.ai.ideas = ideas;
        d.aiReady = true; // resolved (shards may be empty on fetch failure)
        return d.ai;
      });
    }
    return aiPromise;
  };

  /* --- localStorage helpers --- */

  function readJSON(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch (e) {
      return fallback;
    }
  }

  /* Valid JSON with the wrong TYPE is as real as broken JSON: hand edits,
     older app versions, and corrupted writes all land here, and a bare
     readJSON would hand "42" to new Set() or .some() and white-screen the
     page (found by the corrupt-shape sweep, 2026-11-08). Getters validate
     shape, not just syntax. */
  function readArray(key) {
    const v = readJSON(key, []);
    return Array.isArray(v) ? v : [];
  }

  function readStringArray(key) {
    return readArray(key).filter((x) => typeof x === "string");
  }

  function readObject(key, fallback) {
    const v = readJSON(key, fallback);
    return v && typeof v === "object" && !Array.isArray(v) ? v : fallback;
  }

  function writeJSON(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
      return true;
    } catch (e) {
      // Storage full/blocked: callers used to get a silent false and the UI
      // showed a change that never persisted. Surface it once per write.
      if (typeof CMF.toast === "function") {
        CMF.toast("保存失败：浏览器存储不可用或已满，本次修改不会被保留");
      }
      return false;
    }
  }

  CMF.getFridge = () => readStringArray(KEYS.fridge);
  CMF.setFridge = (list) => writeJSON(KEYS.fridge, list);

  CMF.getHistory = () =>
    readArray(KEYS.history).filter(
      (e) => e && typeof e === "object" && Array.isArray(e.selected)
    );
  CMF.addHistory = (entry) => {
    const list = readArray(KEYS.history);
    list.unshift(entry);
    writeJSON(KEYS.history, list.slice(0, 50));
  };
  CMF.clearHistory = () => writeJSON(KEYS.history, []);

  CMF.getFeedback = () => readObject(KEYS.feedback, {});
  CMF.setFeedback = (map) => writeJSON(KEYS.feedback, map);

  CMF.getPrefs = () => {
    const value = readJSON(KEYS.prefs, {});
    const safe = value && typeof value === "object" && !Array.isArray(value) ? value : {};
    return { tags: [], diets: [], ...safe };
  };
  CMF.setPrefs = (prefs) => writeJSON(KEYS.prefs, prefs);

  /* Personal nutrition goal profile. The math lives in goals.js; storage is
     kept here so exportData/importData cover it automatically. */
  CMF.getGoals = () => {
    const value = readJSON(KEYS.goals, null);
    return value && typeof value === "object" && !Array.isArray(value) ? value : null;
  };
  CMF.setGoals = (goals) => writeJSON(KEYS.goals, goals);
  CMF.clearGoals = () => {
    try {
      localStorage.removeItem(KEYS.goals);
      return true;
    } catch (e) {
      return false;
    }
  };

  /* Diet preferences live in the same prefs object as tags/allergens. Always
     read-modify-write so toggling one setting never wipes the others. */
  CMF.getDiets = () => CMF.getPrefs().diets || [];
  CMF.setDiets = (diets) => {
    const prefs = CMF.getPrefs();
    prefs.diets = [...new Set(diets)];
    return CMF.setPrefs(prefs);
  };
  CMF.toggleDiet = (key) => {
    const set = new Set(CMF.getDiets());
    if (set.has(key)) set.delete(key);
    else set.add(key);
    CMF.setDiets([...set]);
    return set.has(key);
  };

  /* Cooked-it journal; journal.js owns the shape, storage stays here so
     exportData/importData cover it automatically. */
  CMF.getJournal = () => {
    const v = readObject(KEYS.journal, null);
    if (!v) return { cooked: [], ratings: {}, notes: {} };
    return {
      cooked: Array.isArray(v.cooked) ? v.cooked : [],
      ratings:
        v.ratings && typeof v.ratings === "object" && !Array.isArray(v.ratings)
          ? v.ratings
          : {},
      notes:
        v.notes && typeof v.notes === "object" && !Array.isArray(v.notes)
          ? v.notes
          : {},
    };
  };
  CMF.setJournal = (journal) => writeJSON(KEYS.journal, journal);

  CMF.getInventory = () => readObject(KEYS.inventory, { batches: [] });
  CMF.setInventory = (inventory) => writeJSON(KEYS.inventory, inventory);

  CMF.getFavorites = () => readStringArray(KEYS.favorites);
  CMF.setFavorites = (list) => writeJSON(KEYS.favorites, list);
  CMF.toggleFavorite = (recipeId) => {
    const set = new Set(CMF.getFavorites());
    if (set.has(recipeId)) set.delete(recipeId);
    else set.add(recipeId);
    CMF.setFavorites([...set]);
    return set.has(recipeId);
  };

  CMF.getUrgent = () => readStringArray(KEYS.urgent);
  CMF.setUrgent = (list) => writeJSON(KEYS.urgent, list);
  CMF.toggleUrgent = (canonical) => {
    const set = new Set(CMF.getUrgent());
    if (set.has(canonical)) set.delete(canonical);
    else set.add(canonical);
    CMF.setUrgent([...set]);
    return set.has(canonical);
  };

  CMF.getPlan = () => {
    const v = readObject(KEYS.plan, null);
    return {
      recipeIds: Array.isArray(v && v.recipeIds)
        ? v.recipeIds.filter((x) => typeof x === "string")
        : [],
      checked: Array.isArray(v && v.checked)
        ? v.checked.filter((x) => typeof x === "string")
        : [],
    };
  };
  CMF.setPlan = (plan) => writeJSON(KEYS.plan, plan);
  CMF.togglePlanRecipe = (recipeId) => {
    const plan = CMF.getPlan();
    const set = new Set(plan.recipeIds);
    if (set.has(recipeId)) set.delete(recipeId);
    else set.add(recipeId);
    plan.recipeIds = [...set];
    CMF.setPlan(plan);
    return plan.recipeIds.includes(recipeId);
  };

  /* --- Backup / restore --- */

  CMF.exportData = function () {
    const payload = { version: 1, exportedAt: new Date().toISOString(), data: {} };
    Object.values(KEYS).forEach((key) => {
      payload.data[key] = readJSON(key, null);
    });
    return payload;
  };

  CMF.importData = function (payload) {
    if (!payload || typeof payload !== "object" || !payload.data) {
      throw new Error("备份文件格式不正确");
    }
    const known = new Set(Object.values(KEYS));
    let count = 0;
    Object.entries(payload.data).forEach(([key, value]) => {
      if (known.has(key) && value != null) {
        writeJSON(key, value);
        count += 1;
      }
    });
    return count;
  };

  /* --- URL helpers --- */

  CMF.queryParam = function (name) {
    return new URLSearchParams(location.search).get(name);
  };

  CMF.selectedFromURL = function () {
    const raw = CMF.queryParam("i");
    if (!raw) return [];
    return decodeURIComponent(raw)
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
  };

  CMF.encodeSelected = function (list) {
    return encodeURIComponent(list.join(","));
  };
})();

;
/* Catalog lookups and normalization, mirroring the Python implementation. */
(function () {
  "use strict";

  const CMF = (window.CMF = window.CMF || {});

  let ingredientMap = {};
  let synonymMap = {};
  let substitutions = {};
  let staples = new Set();
  let methodAliases = {};
  let tagAliases = {};
  let storageTips = {};
  let storageDefaults = {};

  CMF.initCatalog = function () {
    const catalog = CMF.data.catalog;
    ingredientMap = {};
    synonymMap = {};
    for (const entry of catalog.ingredients) {
      ingredientMap[entry.canonical] = entry;
      synonymMap[entry.canonical] = entry.canonical;
      for (const syn of entry.synonyms) synonymMap[syn] = entry.canonical;
    }
    substitutions = catalog.substitutions || {};
    staples = new Set(catalog.pantry_staples || []);
    methodAliases = catalog.method_aliases || {};
    tagAliases = catalog.tag_aliases || {};
    const storage = catalog.storage || {};
    storageTips = storage.tips || {};
    storageDefaults = storage.category_default || {};
  };

  CMF.entry = (canonical) => ingredientMap[canonical] || null;
  CMF.isKnown = (name) => Object.prototype.hasOwnProperty.call(ingredientMap, name);
  CMF.isStaple = (name) => staples.has(name);
  CMF.emojiOf = (name) => (ingredientMap[name] ? ingredientMap[name].emoji : "🍽️");
  CMF.categoryOf = (name) => (ingredientMap[name] ? ingredientMap[name].category : "其他");
  CMF.allIngredients = () => Object.values(ingredientMap);

  CMF.ingredientsByCategory = function (category) {
    return CMF.allIngredients().filter((e) => e.category === category);
  };

  CMF.substitutionsFor = function (canonical) {
    return substitutions[canonical] || [];
  };

  CMF.normalizeName = function (raw) {
    const text = String(raw || "").trim();
    if (synonymMap[text]) return synonymMap[text];
    // Parenthetical content, e.g. 番茄（西红柿）
    const inner = text.match(/[（(【\[](.*?)[)）】\]]/);
    if (inner && synonymMap[inner[1].trim()]) return synonymMap[inner[1].trim()];
    const noParen = text.replace(/[（(【\[].*?[)）】\]]/g, "").trim();
    if (synonymMap[noParen]) return synonymMap[noParen];
    return noParen || text;
  };

  CMF.normalizeMethod = function (value) {
    const key = String(value || "").trim();
    return methodAliases[key] || key;
  };

  CMF.allergensOf = function (name) {
    return ingredientMap[name] ? ingredientMap[name].allergens : [];
  };

  CMF.storageFor = function (canonical) {
    const row = storageTips[canonical];
    if (row) return row;
    const category = CMF.categoryOf(canonical);
    return storageDefaults[category] || { method: "按包装说明保存", fridgeDays: null, freezerDays: null };
  };
})();

;
/* In-browser retrieval, mirroring cookmyfridge.search exactly. */
(function () {
  "use strict";

  const CMF = (window.CMF = window.CMF || {});

  const ALMOST_MAX_MISSING = 3;
  const DIFFICULTY_RANK = { 简单: 0, 中等: 1, 较难: 2 };

  function requiredIngredients(recipe) {
    return recipe.ingredients
      .filter((i) => !i.optional)
      .map((i) => i.canonical);
  }

  function matchRecipe(recipe, selectedSet) {
    const required = new Set(requiredIngredients(recipe));
    const matched = [];
    const missing = [];
    const missingStaples = [];
    required.forEach((c) => {
      if (selectedSet.has(c)) matched.push(c);
      else if (CMF.isStaple(c)) missingStaples.push(c);
      else missing.push(c);
    });
    matched.sort();
    missing.sort();
    missingStaples.sort();

    const missingSubs = {};
    missing.forEach((c) => {
      const subs = CMF.substitutionsFor(c);
      if (subs.length) missingSubs[c] = subs;
    });

    const count = missing.length;
    const bucket =
      count === 0
        ? "cook_now"
        : count <= ALMOST_MAX_MISSING
        ? "almost_there"
        : "out_of_reach";

    return {
      recipe,
      matched,
      missing,
      missingStaples,
      missingSubs,
      missingCount: count,
      bucket,
    };
  }

  function passes(recipe, filters) {
    if (!filters) return true;
    if (filters.methods && filters.methods.length) {
      if (!filters.methods.some((m) => recipe.methods.includes(m))) return false;
    }
    if (filters.maxTime != null && recipe.time_minutes > filters.maxTime) return false;
    if (filters.difficulty && filters.difficulty.length) {
      if (!filters.difficulty.includes(recipe.difficulty)) return false;
    }
    if (filters.tags && filters.tags.length) {
      if (!filters.tags.some((t) => recipe.tags.includes(t))) return false;
    }
    if (filters.nutrition && filters.nutrition.length) {
      if (typeof CMF.recipeNutrition !== "function") return false;
      const have = CMF.recipeNutrition(recipe);
      if (!filters.nutrition.some((f) => have.includes(f))) return false;
    }
    if (filters.diets && filters.diets.length) {
      // Fail closed when the diet rules are unavailable: silently showing an
      // unsafe recipe would be worse than showing an empty result set.
      if (typeof CMF.matchesDiets !== "function") return false;
      if (!CMF.matchesDiets(recipe, filters.diets)) return false;
    }
    return true;
  }

  function sortKey(m) {
    return [
      m.missingCount,
      -m.matched.length,
      m.recipe.time_minutes,
      DIFFICULTY_RANK[m.recipe.difficulty] ?? 3,
      m.recipe.id,
    ];
  }

  function compareArrays(a, b) {
    for (let i = 0; i < Math.max(a.length, b.length); i++) {
      if (a[i] !== b[i]) return a[i] < b[i] ? -1 : 1;
    }
    return 0;
  }

  CMF.similarRecipes = function (recipe, recipes, limit) {
    const target = new Set(
      recipe.ingredients.filter((i) => !i.optional).map((i) => i.canonical)
    );
    return recipes
      .filter((r) => r.id !== recipe.id)
      .map((r) => ({
        recipe: r,
        shared: r.ingredients.filter(
          (i) => !i.optional && target.has(i.canonical)
        ).length,
      }))
      .filter((x) => x.shared > 0)
      .sort(
        (a, b) =>
          b.shared - a.shared ||
          a.recipe.time_minutes - b.recipe.time_minutes ||
          (a.recipe.id < b.recipe.id ? -1 : 1)
      )
      .slice(0, limit || 4)
      .map((x) => x.recipe);
  };

  CMF.search = function (recipes, selected, filters) {
    const selectedSet = new Set(selected);
    const cookNow = [];
    const almost = [];
    for (const recipe of recipes) {
      if (!passes(recipe, filters)) continue;
      const m = matchRecipe(recipe, selectedSet);
      // Mirror Python candidate pruning: a recipe must share at least one
      // selected ingredient, otherwise it is unrelated to this query.
      if (!m.matched.length) continue;
      if (m.bucket === "cook_now") cookNow.push(m);
      else if (m.bucket === "almost_there") almost.push(m);
    }
    cookNow.sort((a, b) => compareArrays(sortKey(a), sortKey(b)));
    almost.sort((a, b) => compareArrays(sortKey(a), sortKey(b)));
    return { cookNow, almostThere: almost };
  };

  CMF.matchRecipe = matchRecipe;
})();

;
/* Offline natural-language ingredient parser.
   Scans free text for known canonicals/synonyms using greedy longest match,
   so multi-word names (e.g. 橄榄油) win over short substrings (e.g. 油). */
(function () {
  "use strict";

  const CMF = (window.CMF = window.CMF || {});

  function buildSurfaces() {
    const surfaces = [];
    for (const entry of CMF.allIngredients()) {
      const names = new Set([entry.canonical, ...entry.synonyms]);
      for (const name of names) {
        if (name && name.length) surfaces.push({ name, canonical: entry.canonical });
      }
    }
    // Longest first; ties resolved alphabetically for determinism.
    surfaces.sort((a, b) => {
      if (b.name.length !== a.name.length) return b.name.length - a.name.length;
      return a.name < b.name ? -1 : a.name > b.name ? 1 : 0;
    });
    return surfaces;
  }

  function normalizeText(raw) {
    return String(raw || "")
      .toLowerCase()
      .replace(/[Ａ-Ｚａ-ｚ０-９]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0xfee0))
      .replace(/[，。！？；：、,.!?;:]/g, " ");
  }

  CMF.parseIngredients = function (raw) {
    const text = normalizeText(raw);
    if (!text) return [];
    const consumed = new Array(text.length).fill(false);
    const found = [];
    const seen = new Set();

    for (const surface of buildSurfaces()) {
      const key = surface.name.toLowerCase();
      let from = 0;
      while (true) {
        const idx = text.indexOf(key, from);
        if (idx === -1) break;
        const end = idx + key.length;
        let overlap = false;
        for (let p = idx; p < end; p++) {
          if (consumed[p]) {
            overlap = true;
            break;
          }
        }
        if (!overlap) {
          for (let p = idx; p < end; p++) consumed[p] = true;
          if (!seen.has(surface.canonical)) {
            seen.add(surface.canonical);
            found.push(surface.canonical);
          }
        }
        from = end;
      }
    }
    return found;
  };
})();

;
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
;
/* Shared UI helpers: escaping, toast, navigation, card rendering. */
(function () {
  "use strict";

  const CMF = (window.CMF = window.CMF || {});

  CMF.esc = function (s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  };

  CMF.scaleAmount = function (amount, factor) {
    const text = String(amount);
    const match = text.match(/^(\d+(?:\.\d+)?)(.*)$/);
    if (!match) return text; // non-numeric amounts such as 少许 / 半勺 stay unchanged
    const value = parseFloat(match[1]) * factor;
    const rounded = Math.round(value * 10) / 10;
    const shown = Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
    return shown + match[2];
  };

  CMF.formatTimer = function (totalSeconds) {
    const s = Math.max(0, Number(totalSeconds) || 0);
    const mm = String(Math.floor(s / 60)).padStart(2, "0");
    const ss = String(s % 60).padStart(2, "0");
    return mm + ":" + ss;
  };

  let toastTimer = null;
  CMF.toast = function (msg) {
    let node = document.querySelector(".toast");
    if (!node) {
      node = document.createElement("div");
      node.className = "toast";
      document.body.appendChild(node);
    }
    node.textContent = msg;
    requestAnimationFrame(() => node.classList.add("show"));
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => node.classList.remove("show"), 1800);
  };

  const NAV_ITEMS = [
    ["index.html", "开饭"],
    ["browse.html", "菜谱"],
    ["fridge.html", "我的冰箱"],
    ["planner.html", "一周菜单"],
    ["stats.html", "统计"],
    ["about.html", "关于"],
  ];

  CMF.renderChrome = function (active) {
    // Skip link: first Tab stop on every page, jumps keyboard users past
    // the whole nav into <main id="main-content"> (WCAG 2.4.1). Visually
    // hidden until focused (see style.css .skip-link).
    const skip = document.createElement("a");
    skip.className = "skip-link";
    skip.href = "#main-content";
    skip.textContent = "跳到主内容";
    const header = document.createElement("header");
    header.className = "site-header";
    header.innerHTML =
      '<div class="container nav">' +
      '<a class="brand" href="index.html">🍳 CookMyFridge</a>' +
      '<nav class="nav-links">' +
      NAV_ITEMS.map(
        ([href, label]) =>
          `<a href="${href}"${href === active ? ' style="font-weight:700"' : ""}>${label}</a>`
      ).join("") +
      "</nav></div>";
    document.body.prepend(header);
    document.body.prepend(skip);

    const footer = document.createElement("footer");
    footer.className = "site-footer";
    footer.innerHTML =
      '<div class="container">Don’t order. CookMyFridge. · 数据与 AI 内容见 <a href="about.html">关于页</a></div>';
    document.body.appendChild(footer);
  };

  CMF.pills = function (items, cls) {
    return items.map((t) => `<span class="pill ${cls || ""}">${CMF.esc(t)}</span>`).join("");
  };

  /* Recipe card used on result pages. `match` carries missing info. */
  CMF.recipeCard = function (match, wildcardPage) {
    const r = match.recipe;
    const link = wildcardPage
      ? `wildcard.html?key=${encodeURIComponent(match.key || r.id)}`
      : `recipe.html?id=${encodeURIComponent(r.id)}`;
    const missingPills = match.missing
      ? match.missing.map((c) => `<span class="pill missing">缺 ${CMF.esc(c)}</span>`).join("")
      : "";
    const userAllergens = new Set((CMF.getPrefs().allergens || []));
    const hits = (r.allergens || []).filter((a) => userAllergens.has(a));
    const planned = new Set(CMF.getPlan().recipeIds).has(r.id);
    const fav = new Set(CMF.getFavorites()).has(r.id);
    return (
      `<article class="recipe-card${hits.length ? " danger" : ""}">` +
      `<h3><a href="${link}">${CMF.esc(r.title)}</a></h3>` +
      '<div class="meta">' +
      `<span>⏱ ${r.time_minutes} 分钟</span>` +
      `<span>🎯 ${CMF.esc(r.difficulty)}</span>` +
      `<span>🍳 ${CMF.esc(r.methods.join("/"))}</span>` +
      "</div>" +
      '<div class="tag-pills">' +
      CMF.pills(r.tags) +
      missingPills +
      "</div>" +
      (hits.length
        ? `<div class="notice warn" style="margin:0;padding:6px 9px;font-size:12px">⚠️ 含你的过敏原：${CMF.esc(hits.join("、"))}</div>`
        : "") +
      (r.is_ai_generated
        ? '<span class="notice ai" style="margin:0;padding:6px 9px;font-size:12px">AI 创意，未人工实测</span>'
        : "") +
      '<div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:8px">' +
      `<button class="btn btn-sm fav-btn" data-fav-id="${r.id}">${fav ? "♥ 已收藏" : "♡ 收藏"}</button>` +
      (wildcardPage
        ? ""
        : `<button class="btn btn-sm plan-btn" data-plan-id="${r.id}">${planned ? "✓ 已加入计划" : "📋 加入计划"}</button>`) +
      "</div>" +
      "</article>"
    );
  };

  /* Ingredient encyclopedia modal: category, allergens, substitutions, recipes. */
  CMF.showIngredientInfo = function (name) {
    const entry = CMF.entry(name);
    if (!entry) {
      CMF.toast("目录里没有这个食材：" + name);
      return;
    }
    const subs = CMF.substitutionsFor(name);
    // substitutions are {canonical, reason} objects, not plain strings.
    const subsHtml = subs.length
      ? '<div class="sub-grid">' +
        subs
          .map((s) => {
            const label = typeof s === "string" ? s : s.canonical;
            const reason = typeof s === "object" && s.reason ? s.reason : "";
            return (
              '<span class="sub-chip"><strong>' +
              CMF.esc(label) +
              "</strong>" +
              (reason ? '<span class="sub-reason">' + CMF.esc(reason) + "</span>" : "") +
              "</span>"
            );
          })
          .join("") +
        "</div>"
      : "无";
    // pairings.js is optional: pages that skip it must still open the modal.
    const pairings = CMF.topPairings ? CMF.topPairings(name, 6) : [];
    const pairingHtml = pairings.length
      ? '<div class="pairing-grid">' +
        pairings
          .map(
            (p) =>
              `<button class="pairing-chip" data-name="${CMF.esc(p.canonical)}">` +
              `${CMF.emojiOf(p.canonical)} ${CMF.esc(p.canonical)} <span class="pair-count">${p.count}</span></button>`
          )
          .join("") +
        "</div>"
      : '<div class="empty">暂无共现数据</div>';
    const usedIn = CMF.data.recipes
      .filter((r) => r.ingredients.some((i) => i.canonical === name))
      .map(
        (r) =>
          `<a class="ing-link" href="recipe.html?id=${encodeURIComponent(r.id)}">${CMF.esc(r.title)}</a>`
      );

    const storage = CMF.storageFor ? CMF.storageFor(name) : null;
    const storageHtml = storage
      ? CMF.esc(storage.method) +
        (storage.fridgeDays ? ` · 冷藏约 ${storage.fridgeDays} 天` : "") +
        (storage.freezerDays ? ` · 冷冻约 ${storage.freezerDays} 天` : "")
      : "";
    const month = new Date().getMonth() + 1;
    const inSeason = CMF.isInSeason ? CMF.isInSeason(name, month) : false;
    const seasonalBadge = inSeason ? '<span class="seasonal-badge">🌿 本月当季</span>' : "";

    const overlay = document.createElement("div");
    overlay.className = "modal-overlay";
    overlay.innerHTML =
      '<div class="modal" role="dialog" aria-modal="true" aria-label="' + CMF.esc(name) + '">' +
      '<button class="modal-close" aria-label="关闭">×</button>' +
      `<h3><span class="modal-emoji">${entry.emoji}</span>${CMF.esc(name)}${seasonalBadge}</h3>` +
      `<div class="modal-row"><span>分类</span>${CMF.esc(entry.category)}</div>` +
      '<div class="modal-row"><span>同义词</span>' +
      (entry.synonyms.length ? CMF.esc(entry.synonyms.join("、")) : "无") +
      "</div>" +
      '<div class="modal-row"><span>过敏原</span>' +
      (entry.allergens.length ? CMF.esc(entry.allergens.join("、")) : "无") +
      "</div>" +
      (storageHtml ? '<div class="modal-row"><span>储存</span>' + storageHtml + "</div>" : "") +
      '<div class="modal-row subs"><span>常见替代</span>' + subsHtml + "</div>" +
      '<div class="modal-row pairing"><span>经典搭配</span>' + pairingHtml + "</div>" +
      '<div class="modal-recipes"><strong>用到它的菜谱（' + usedIn.length + "）</strong>" +
      (usedIn.length ? '<div class="ing-link-grid">' + usedIn.join("") + "</div>" : '<div class="empty">暂无菜谱</div>') +
      "</div></div>";

    function close() {
      overlay.remove();
      releaseFocus();
    }
    overlay.addEventListener("click", (ev) => {
      if (ev.target === overlay || ev.target.closest(".modal-close")) close();
    });
    overlay.addEventListener("click", (ev) => {
      const chip = ev.target.closest(".pairing-chip");
      if (chip) {
        close();
        CMF.showIngredientInfo(chip.dataset.name);
      }
    });
    document.body.appendChild(overlay);
    const releaseFocus = CMF.mountModalFocus(overlay, close);
  };

  /* Focus management for modal overlays: remembers the trigger, moves
     focus inside, traps Tab/Shift+Tab, closes on Escape, and returns focus
     to the trigger on close. Returns a release() that MUST be called by
     the owner's close() — it detaches the key handler and restores focus.
     Without this, keyboard users lose focus into the void behind the
     overlay and Escape only works by accident of where focus happened to
     be (measured red in stage41 before this existed). */
  CMF.mountModalFocus = function (overlay, close, opts) {
    const trigger = document.activeElement;
    const modal = overlay.querySelector(".modal, .cooking-card") || overlay;
    if (!modal.hasAttribute("tabindex")) modal.setAttribute("tabindex", "-1");
    const focusables = () =>
      [...modal.querySelectorAll(
        'a[href], button, input, select, textarea, [tabindex]:not([tabindex="-1"])'
      )].filter((el) => !el.disabled && el.offsetParent !== null);
    const preferred =
      opts && opts.initial ? modal.querySelector(opts.initial) : null;
    const first = preferred || focusables()[0];
    (first || modal).focus();
    function onKey(ev) {
      if (ev.key === "Escape") {
        ev.stopPropagation();
        close();
        return;
      }
      if (ev.key !== "Tab") return;
      const list = focusables();
      if (!list.length) {
        ev.preventDefault();
        modal.focus();
        return;
      }
      const firstEl = list[0];
      const lastEl = list[list.length - 1];
      if (ev.shiftKey && (document.activeElement === firstEl || document.activeElement === modal)) {
        ev.preventDefault();
        lastEl.focus();
      } else if (!ev.shiftKey && document.activeElement === lastEl) {
        ev.preventDefault();
        firstEl.focus();
      }
    }
    document.addEventListener("keydown", onKey, true);
    return function release() {
      document.removeEventListener("keydown", onKey, true);
      if (trigger && trigger.isConnected && trigger.focus) trigger.focus();
    };
  };

  CMF.copyText = function (text) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      return navigator.clipboard
        .writeText(text)
        .then(() => true)
        .catch(() => legacyCopy(text));
    }
    return Promise.resolve(legacyCopy(text));
  };

  function legacyCopy(text) {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.setAttribute("readonly", "");
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    let ok = false;
    try {
      ok = document.execCommand("copy");
    } catch (e) {
      ok = false;
    }
    document.body.removeChild(ta);
    return ok;
  }

  if (
    location.protocol.startsWith("http") &&
    "serviceWorker" in navigator
  ) {
    window.addEventListener("load", () => navigator.serviceWorker.register("sw.js"));
  }

  /* --- split-bundle feature loading ---------------------------------------
     The build ships js/bundle-boot.js (what every page needs at first paint:
     store/catalog/search/nlparse/seasonal/ui, ~31 KB) and
     js/bundle-features.js (everything else, ~172 KB). Content-heavy pages
     (recipe/fridge/planner/stats/browse) load BOTH as plain sync scripts —
     behavior identical to the old single bundle. Lean pages (index/result/
     wildcard/about) load only the boot bundle synchronously; boots() starts
     the features download AFTER the first render, and CMF.onFeatures() gates
     enrichment that touches feature modules (weather card, voice input,
     pairings index). Pages passing opts.skipFeatures (about/wildcard) never
     use feature modules, so the features bundle never ships there. */
  let featuresPromise = null;   // download promise, once injection starts
  let featuresSkipped = false;
  let waiterPromise = null;     // shared pre-injection promise
  let waiterResolve = null;

  /* The pipe belongs to the first screen until boots() says otherwise:
     onFeatures(fn) called during page-script execution must only QUEUE,
     never start the ~172 KB download. boots() fires startFeatures() after
     the first render and flushes the queue. */
  function startFeatures() {
    if (window.__cmfFeaturesReady || featuresSkipped) {
      return Promise.resolve();
    }
    if (!featuresPromise) {
      featuresPromise = new Promise((resolve) => {
        const s = document.createElement("script");
        s.src = "js/bundle-features.js";
        s.onload = () => resolve();
        // The SW precaches the bundle; a load failure here degrades feature
        // widgets (they stay empty), it must never fail the boot.
        s.onerror = () => resolve();
        document.body.appendChild(s);
      });
    }
    return featuresPromise;
  }

  CMF.onFeatures = function (fn) {
    let p;
    if (window.__cmfFeaturesReady || featuresSkipped) {
      p = Promise.resolve();
    } else if (featuresPromise) {
      p = featuresPromise;
    } else {
      if (!waiterPromise) {
        waiterPromise = new Promise((resolve) => {
          waiterResolve = resolve;
        });
      }
      p = waiterPromise;
    }
    return fn ? p.then(fn) : p;
  };

  /* opts.deferRecipes: the homepage renders its wall from catalog + vocab
     alone and fills recipe-dependent widgets (weather picks) when the
     background recipes.json lands — everyone else awaits recipes as before.
     opts.skipFeatures: page uses no feature modules at all (about/wildcard),
     so the features bundle is neither injected nor awaited. */
  CMF.boots = function (active, init, opts) {
    CMF.renderChrome(active);
    featuresSkipped = !!(opts && opts.skipFeatures);
    const ready = opts && opts.deferRecipes
      ? CMF.preload()
      : Promise.all([CMF.preload(), CMF.preloadRecipes()]);
    ready
      .then(() => {
        CMF.initCatalog();
        if (CMF.buildPairingIndex) CMF.buildPairingIndex(CMF.data.recipes);
        if (init) init();
        // First render is on screen; lean pages start the features download
        // now (sync pages already have it, this resolves immediately) and
        // any queued onFeatures() waiters are flushed.
        startFeatures().then(() => {
          if (waiterResolve) waiterResolve();
        });
      })
      .catch((err) => {
        const main = document.querySelector(".container") || document.body;
        main.insertAdjacentHTML(
          "beforeend",
          `<div class="empty">数据加载失败：${CMF.esc(err.message)}<br>请通过本地服务器访问（如 python -m http.server）。</div>`
        );
      });
  };

  /* Run fn once BOTH the core payload and the background AI shards have
     landed. Pages render core content at boots time and refresh only their
     AI zones here, so fn always sees a complete CMF.data. Features are
     chained in too: AI-zone repaints may use feature modules. */
  CMF.onAiReady = function (fn) {
    Promise.all([CMF.preload(), CMF.preloadAI(), CMF.onFeatures()])
      .then(fn)
      .catch(() => {});
  };
})();
