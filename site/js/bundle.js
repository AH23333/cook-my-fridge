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
    // 0.5 KB vocab on slow links.
    corePromise = fetchJSON("data/core.json").then((core) => {
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

  CMF.getFridge = () => readJSON(KEYS.fridge, []);
  CMF.setFridge = (list) => writeJSON(KEYS.fridge, list);

  CMF.getHistory = () => readJSON(KEYS.history, []);
  CMF.addHistory = (entry) => {
    const list = readJSON(KEYS.history, []);
    list.unshift(entry);
    writeJSON(KEYS.history, list.slice(0, 50));
  };
  CMF.clearHistory = () => writeJSON(KEYS.history, []);

  CMF.getFeedback = () => readJSON(KEYS.feedback, {});
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
  CMF.getJournal = () => readJSON(KEYS.journal, { cooked: [], ratings: {}, notes: {} });
  CMF.setJournal = (journal) => writeJSON(KEYS.journal, journal);

  CMF.getInventory = () => readJSON(KEYS.inventory, { batches: [] });
  CMF.setInventory = (inventory) => writeJSON(KEYS.inventory, inventory);

  CMF.getFavorites = () => readJSON(KEYS.favorites, []);
  CMF.setFavorites = (list) => writeJSON(KEYS.favorites, list);
  CMF.toggleFavorite = (recipeId) => {
    const set = new Set(CMF.getFavorites());
    if (set.has(recipeId)) set.delete(recipeId);
    else set.add(recipeId);
    CMF.setFavorites([...set]);
    return set.has(recipeId);
  };

  CMF.getUrgent = () => readJSON(KEYS.urgent, []);
  CMF.setUrgent = (list) => writeJSON(KEYS.urgent, list);
  CMF.toggleUrgent = (canonical) => {
    const set = new Set(CMF.getUrgent());
    if (set.has(canonical)) set.delete(canonical);
    else set.add(canonical);
    CMF.setUrgent([...set]);
    return set.has(canonical);
  };

  CMF.getPlan = () => readJSON(KEYS.plan, { recipeIds: [], checked: [] });
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
/* Nutrition: qualitative badges + quantitative estimates. Pure logic only.
   Numbers come from data/catalog.json -> nutrition_facts (per 100 g, approx).
   Household units are coarse by nature; every result is explicitly labelled
   as an estimate and never presented as clinical nutrition data. */
(function () {
  "use strict";

  const CMF = window.CMF;
  const FLAG_ORDER = ["高蛋白", "高纤维", "低脂", "低碳水", "优质碳水", "高铁"];
  const CJK_DIGITS = {
    一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5,
    六: 6, 七: 7, 八: 8, 九: 9, 十: 10, 半: 0.5,
  };
  const VAGUE_UNITS = new Set(["少许", "适量", "若干", "几滴", "几片", "几个", "几颗"]);
  const FALLBACK_GRAMS = 30;

  CMF.recipeNutrition = function (recipe) {
    const flags = new Set();
    (recipe.ingredients || []).forEach((use) => {
      if (use.optional) return;
      const entry = CMF.entry(use.canonical);
      if (entry && entry.nutrition) {
        entry.nutrition.forEach((f) => flags.add(f));
      }
    });
    return FLAG_ORDER.filter((f) => flags.has(f));
  };

  CMF.nutritionData = function () {
    const catalog = (CMF.data && CMF.data.catalog) || null;
    return (catalog && catalog.nutrition_facts) || null;
  };

  /* "2 个" / "1 小勺" / "半个" / "少许" / "100克" -> {quantity, unit, exact} */
  CMF.parseAmount = function (amount) {
    const text = String(amount == null ? "" : amount).trim();
    if (!text) return { quantity: 1, unit: "", exact: false };
    if (text.startsWith("半") && text.length > 1) {
      return { quantity: 0.5, unit: text.slice(1).trim(), exact: true };
    }
    if (text.startsWith("整") && text.length > 1) {
      const unit = text.slice(1).trim();
      return { quantity: 1, unit: "整" + unit, exact: true };
    }
    const numeric = text.match(/^(\d+(?:\.\d+)?)\s*(.*)$/);
    let quantity;
    let unit;
    let exact = true;
    if (numeric) {
      quantity = parseFloat(numeric[1]);
      unit = numeric[2].trim();
    } else if (VAGUE_UNITS.has(text)) {
      quantity = 1;
      unit = text;
      exact = false;
    } else {
      const cjk = text.match(/^([一两二三四五六七八九十半])\s*(.*)$/);
      if (cjk) {
        quantity = CJK_DIGITS[cjk[1]];
        unit = cjk[2].trim();
      } else {
        quantity = 1;
        unit = text;
        exact = false;
      }
    }
    if (!unit) unit = numeric || exact ? "个" : ""; // bare number => count as 个
    return { quantity: Math.max(0, quantity), unit, exact };
  };

  /* Grams for one ingredient line. `known=false` means we had to guess. */
  CMF.ingredientGrams = function (canonical, amount) {
    const facts = CMF.nutritionData();
    const parsed = CMF.parseAmount(amount);
    if (!facts) return { grams: 0, known: false, unit: parsed.unit };
    const overrides = facts.ingredient_units[canonical] || {};
    let per = overrides[parsed.unit];
    let known = per != null;
    if (per == null) {
      per = facts.unit_grams[parsed.unit];
      known = per != null;
    }
    if (per == null) per = FALLBACK_GRAMS;
    return {
      grams: Math.max(0, parsed.quantity * per),
      known,
      unit: parsed.unit,
    };
  };

  function servingsOf(recipe) {
    const tags = recipe.tags || [];
    if (tags.includes("一人食") || tags.includes("宝宝辅食")) return 1;
    return 2;
  }

  function emptyTotals() {
    return { kcal: 0, protein: 0, fat: 0, carbs: 0 };
  }

  /* Quantitative estimate. Optional ingredients are excluded (same rule as
     the qualitative badges). `factor` scales amounts, not the head count. */
  CMF.estimateNutrition = function (recipe, factor) {
    const facts = CMF.nutritionData();
    if (!facts || !recipe) return null;
    const scale = Number(factor) > 0 ? Number(factor) : 1;
    const total = emptyTotals();
    const lines = [];
    const unknownFacts = [];
    const unknownUnits = [];
    let grams = 0;
    let oilAdded = false;

    function accumulate(row, g, label) {
      const ratio = g / 100;
      total.kcal += row.kcal * ratio;
      total.protein += row.protein * ratio;
      total.fat += row.fat * ratio;
      total.carbs += row.carbs * ratio;
      grams += g;
      lines.push({
        canonical: label,
        grams: Math.round(g),
        kcal: Math.round(row.kcal * ratio),
        source: row.source,
      });
    }

    (recipe.ingredients || []).forEach((use) => {
      if (use.optional) return;
      const row = facts.per100g[use.canonical];
      if (!row) {
        unknownFacts.push(use.canonical);
        return;
      }
      const measure = CMF.ingredientGrams(use.canonical, use.amount);
      if (!measure.known) unknownUnits.push(use.canonical);
      accumulate(row, measure.grams * scale, use.canonical);
    });

    // Curated recipes treat cooking oil as a pantry staple and often omit it
    // from the ingredient list. For a dry-heat dish with no fat source at all,
    // count a modest 10 g of oil instead of reporting an implausible ~20 kcal.
    const FAT_SOURCES = new Set([
      "食用油", "花生油", "橄榄油", "香油", "黄油", "奶油", "五花肉",
      "培根", "香肠", "腊肉", "芝麻酱", "沙拉酱", "花生酱", "奶酪",
    ]);
    const OIL_METHODS = new Set(["炒", "煎", "炸", "烤", "空气炸锅"]);
    const hasFat = (recipe.ingredients || []).some(
      (use) => !use.optional && FAT_SOURCES.has(use.canonical)
    );
    const cooksWithOil = (recipe.methods || []).some((m) => OIL_METHODS.has(m));
    const oil = facts.per100g["食用油"];
    if (!hasFat && cooksWithOil && oil) {
      accumulate(oil, 10 * scale, "食用油（默认）");
      oilAdded = true;
    }

    const servings = servingsOf(recipe);
    const round1 = (n) => Math.round(n * 10) / 10;
    const perServing = {
      kcal: Math.round(total.kcal / servings),
      protein: round1(total.protein / servings),
      fat: round1(total.fat / servings),
      carbs: round1(total.carbs / servings),
    };
    const energy = {
      protein: total.protein * 4,
      fat: total.fat * 9,
      carbs: total.carbs * 4,
    };
    const energyTotal = energy.protein + energy.fat + energy.carbs;
    const pct = (v) => (energyTotal ? Math.round((v / energyTotal) * 100) : 0);

    return {
      total: {
        kcal: Math.round(total.kcal),
        protein: round1(total.protein),
        fat: round1(total.fat),
        carbs: round1(total.carbs),
      },
      perServing: perServing,
      servings: servings,
      grams: Math.round(grams),
      lines: lines.sort((a, b) => b.kcal - a.kcal),
      energyShare: {
        protein: pct(energy.protein),
        fat: pct(energy.fat),
        carbs: pct(energy.carbs),
      },
      unknownFacts: unknownFacts,
      unknownUnits: unknownUnits,
      oilAdded: oilAdded,
      factor: scale,
      note: facts.note,
    };
  };

  CMF.carbsPerServing = function (recipe) {
    const estimate = CMF.estimateNutrition(recipe);
    return estimate ? estimate.perServing.carbs : Infinity;
  };

  /* Reusable HTML card. Strings only - no DOM access, so Node harnesses and
     the canvas share card can consume the same numbers. */
  CMF.renderNutritionCard = function (recipe, factor) {
    const e = CMF.estimateNutrition(recipe, factor);
    if (!e) return "";
    const bar = (label, value, unit, cls) =>
      '<div class="nut-stat ' + cls + '">' +
      `<span class="nut-stat-label">${label}</span>` +
      `<strong>${value}<small>${unit}</small></strong>` +
      "</div>";
    const shares = e.energyShare;
    return (
      '<div class="nutrition-estimate">' +
      '<div class="nut-head"><span class="nutrition-label">🍽️ 营养估算 · 每份</span>' +
      `<span class="nut-servings">共 ${e.servings} 份 · 约 ${e.grams} 克食材</span></div>` +
      '<div class="nut-stats">' +
      bar("热量", e.perServing.kcal, " kcal", "kcal") +
      bar("蛋白质", e.perServing.protein, " g", "protein") +
      bar("脂肪", e.perServing.fat, " g", "fat") +
      bar("碳水", e.perServing.carbs, " g", "carbs") +
      "</div>" +
      '<div class="nut-energy" aria-label="三大营养素供能占比">' +
      `<span class="nut-energy-seg protein" style="width:${shares.protein}%"></span>` +
      `<span class="nut-energy-seg fat" style="width:${shares.fat}%"></span>` +
      `<span class="nut-energy-seg carbs" style="width:${shares.carbs}%"></span>` +
      "</div>" +
      '<div class="nut-legend">蛋白 ' + shares.protein + "% · 脂肪 " + shares.fat +
      "% · 碳水 " + shares.carbs + "%</div>" +
      `<div class="nut-note">${CMF.esc ? CMF.esc(e.note) : e.note}` +
      (e.unknownUnits.length
        ? " 其中 " + e.unknownUnits.length + " 项用量为估计值。"
        : "") +
      (e.oilAdded ? " 未列出油脂的炒菜按 10 g 食用油计入。" : "") +
      "</div></div>"
    );
  };
})();

;
/* Personal nutrition goals: Mifflin-St Jeor BMR -> TDEE -> daily macro goals.
   Pure logic + localStorage-backed profile; no DOM access in the math.
   These are planning estimates, NOT medical advice. The default (no profile)
   path leaves every existing balance score untouched. */
(function () {
  "use strict";

  const CMF = window.CMF;

  const ACTIVITY = [
    { key: "sedentary", label: "久坐 · 几乎不运动", factor: 1.2 },
    { key: "light", label: "轻度 · 每周 1–3 次", factor: 1.375 },
    { key: "moderate", label: "中度 · 每周 3–5 次", factor: 1.55 },
    { key: "active", label: "高强度 · 每周 6–7 次", factor: 1.725 },
    { key: "very", label: "体力劳动 / 双练", factor: 1.9 },
  ];
  const MODES = [
    { key: "cut", label: "减脂", energy: 0.8, proteinPerKg: 1.8 },
    { key: "maintain", label: "维持", energy: 1.0, proteinPerKg: 1.4 },
    { key: "bulk", label: "增肌", energy: 1.12, proteinPerKg: 1.8 },
  ];
  const SEX = [
    { key: "unspecified", label: "不指定（取中性常数）", offset: -78 },
    { key: "female", label: "女", offset: -161 },
    { key: "male", label: "男", offset: 5 },
  ];

  const DEFAULT_PROFILE = {
    enabled: false,
    sex: "unspecified",
    age: 30,
    heightCm: 165,
    weightKg: 60,
    activity: "moderate",
    mode: "maintain",
    people: 1,
    mealsPerDay: 2,
  };

  CMF.GOAL_ACTIVITY = ACTIVITY;
  CMF.GOAL_MODES = MODES;
  CMF.GOAL_SEX = SEX;
  CMF.DEFAULT_GOAL_PROFILE = Object.assign({}, DEFAULT_PROFILE);

  function clamp(n, low, high) {
    return Math.max(low, Math.min(high, n));
  }
  function int(value, fallback, low, high) {
    const n = Math.round(Number(value));
    return Number.isFinite(n) ? clamp(n, low, high) : fallback;
  }
  function pick(list, key, fallback) {
    return list.some((x) => x.key === key) ? key : fallback;
  }
  function esc(value) {
    return String(value == null ? "" : value).replace(/[&<>"']/g, (ch) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
    }[ch]));
  }

  /* Never trust a stored/manually edited profile. Out-of-range values are
     clamped, unknown enums fall back, and NaN can never reach the formula. */
  CMF.sanitizeGoalProfile = function (raw) {
    const value = raw && typeof raw === "object" ? raw : {};
    // QR sync stores the profile with one-letter field names (and an `e`
    // enabled flag) to save bytes; accept both shapes transparently.
    const src = value.profile || value.p || value;
    const field = (long, short) => {
      if (src[long] !== undefined) return src[long];
      if (src[short] !== undefined) return src[short];
      if (value[long] !== undefined) return value[long];
      return value[short];
    };
    return {
      enabled: Boolean(field("enabled", "e")),
      sex: pick(SEX, field("sex", "s"), DEFAULT_PROFILE.sex),
      age: int(field("age", "a"), DEFAULT_PROFILE.age, 10, 100),
      heightCm: int(field("heightCm", "h"), DEFAULT_PROFILE.heightCm, 120, 220),
      weightKg: int(field("weightKg", "w"), DEFAULT_PROFILE.weightKg, 30, 200),
      activity: pick(ACTIVITY, field("activity", "v"), DEFAULT_PROFILE.activity),
      mode: pick(MODES, field("mode", "m"), DEFAULT_PROFILE.mode),
      people: int(field("people", "n"), DEFAULT_PROFILE.people, 1, 12),
      mealsPerDay: int(field("mealsPerDay", "c"), DEFAULT_PROFILE.mealsPerDay, 1, 4),
    };
  };

  CMF.computeGoals = function (raw) {
    const p = CMF.sanitizeGoalProfile(raw);
    const sex = SEX.find((s) => s.key === p.sex) || SEX[0];
    const activity = ACTIVITY.find((a) => a.key === p.activity) || ACTIVITY[2];
    const mode = MODES.find((m) => m.key === p.mode) || MODES[1];
    const bmr = Math.round(10 * p.weightKg + 6.25 * p.heightCm - 5 * p.age + sex.offset);
    const tdee = Math.round(bmr * activity.factor);
    const kcal = clamp(Math.round((tdee * mode.energy) / 10) * 10, 1200, 4000);
    const protein = Math.round(p.weightKg * mode.proteinPerKg);
    const fat = Math.round((kcal * 0.25) / 9);
    const carbs = Math.max(50, Math.round((kcal - protein * 4 - fat * 9) / 4));
    const daily = { kcal, protein, fat, carbs };
    const round1 = (n) => Math.round(n * 10) / 10;
    const perMeal = {
      kcal: Math.round(kcal / p.mealsPerDay),
      protein: round1(protein / p.mealsPerDay),
      fat: round1(fat / p.mealsPerDay),
      carbs: round1(carbs / p.mealsPerDay),
    };
    const household = {
      kcal: kcal * p.people,
      protein: protein * p.people,
      fat: fat * p.people,
      carbs: carbs * p.people,
    };
    const energy = { protein: protein * 4, fat: fat * 9, carbs: carbs * 4 };
    const totalEnergy = energy.protein + energy.fat + energy.carbs;
    return {
      profile: p,
      bmr,
      tdee,
      factor: activity.factor,
      mode: mode.key,
      daily,
      perMeal,
      household,
      energyShare: {
        protein: Math.round((energy.protein / totalEnergy) * 100),
        fat: Math.round((energy.fat / totalEnergy) * 100),
        carbs: Math.round((energy.carbs / totalEnergy) * 100),
      },
      note: "Mifflin-St Jeor 估算，仅用于备餐搭配，不替代专业营养或医疗建议。",
    };
  };

  /* The enabled flag lives in localStorage, not in the math. */
  CMF.activeGoals = function () {
    if (typeof CMF.getGoals !== "function") return null;
    const stored = CMF.getGoals();
    if (!stored || typeof stored !== "object") return null;
    // Older/looser payloads may keep `enabled` on the profile itself.
    const raw = stored.profile || stored.p || stored;
    const enabled = stored.enabled !== undefined ? stored.enabled
      : stored.e !== undefined ? stored.e
      : raw.enabled !== undefined ? raw.enabled : raw.e;
    if (!enabled) return null;
    const profile = CMF.sanitizeGoalProfile({ ...raw, enabled: true });
    return CMF.computeGoals(profile);
  };

  /* Targets for one scoring unit (1 meal, or `meals` meals of a day). */
  CMF.goalTargets = function (opts) {
    const goals = CMF.activeGoals();
    if (!goals) return null;
    const options = opts || {};
    const meals = clamp(Math.round(Number(options.meals) || 1), 1, 4);
    const scale = meals / goals.profile.mealsPerDay;
    const round1 = (n) => Math.round(n * 10) / 10;
    return {
      kcal: Math.round(goals.perMeal.kcal * meals),
      protein: round1(goals.perMeal.protein * meals),
      fat: round1(goals.perMeal.fat * meals),
      carbs: round1(goals.perMeal.carbs * meals),
      meals,
      scale: round1(scale),
      source: "personal",
    };
  };

  /* Percent of the personal daily (or per-meal) target covered by totals. */
  CMF.goalProgress = function (totals, opts) {
    const target = CMF.goalTargets(opts);
    if (!target) return null;
    const t = totals || {};
    const pct = (key) => {
      const goal = Number(target[key]) || 0;
      if (!goal) return 0;
      return Math.round(((Number(t[key]) || 0) / goal) * 100);
    };
    return {
      kcal: pct("kcal"), protein: pct("protein"),
      fat: pct("fat"), carbs: pct("carbs"),
      target,
    };
  };

  CMF.goalHint = function (totals, opts) {
    const progress = CMF.goalProgress(totals, opts);
    if (!progress) return "";
    const goals = CMF.activeGoals();
    return `🎯 约占个人目标 ${progress.kcal}% 热量 · 蛋白 ${progress.protein}%` +
      `（按每日 ${goals.profile.mealsPerDay} 餐分摊）`;
  };

  function progressRow(label, value, unit, pct) {
    const width = clamp(pct, 0, 100);
    const cls = pct > 130 ? "over" : pct < 60 ? "low" : "ok";
    return (
      `<div class="goal-progress ${cls}">` +
      `<span class="goal-progress-label">${esc(label)}</span>` +
      `<span class="goal-progress-value">${value}${esc(unit)} · ${pct}%</span>` +
      `<span class="goal-progress-bar"><i style="width:${width}%"></i></span>` +
      "</div>"
    );
  }

  /* Optional card for recipe details: how much of my target is one serving. */
  CMF.renderGoalProgress = function (totals, opts) {
    const progress = CMF.goalProgress(totals, opts);
    if (!progress) return "";
    const t = totals || {};
    const goals = CMF.activeGoals();
    const mealLabel = progress.target.meals > 1
      ? `${progress.target.meals} 餐合计` : "每份 / 一餐";
    return (
      '<div class="goal-card">' +
      `<div class="goal-card-head">🎯 我的营养目标 · ${mealLabel}</div>` +
      progressRow("热量", Math.round(Number(t.kcal) || 0), " kcal", progress.kcal) +
      progressRow("蛋白质", Number(t.protein) || 0, " g", progress.protein) +
      progressRow("脂肪", Number(t.fat) || 0, " g", progress.fat) +
      progressRow("碳水", Number(t.carbs) || 0, " g", progress.carbs) +
      `<div class="goal-card-note">目标 ${progress.target.kcal} kcal / 蛋白 ${progress.target.protein} g · ` +
      `按每日 ${goals.profile.mealsPerDay} 餐分摊；${esc(goals.note)}</div>` +
      "</div>"
    );
  };

  /* Settings summary shown on the fridge page. */
  CMF.renderGoalsSummary = function (goals) {
    if (!goals) return "";
    const d = goals.daily;
    const m = goals.perMeal;
    const h = goals.household;
    return (
      '<div class="goal-summary">' +
      `<div><strong>${d.kcal}</strong> kcal/日 · 基础代谢 ${goals.bmr} · 活动消耗 ${goals.tdee}</div>` +
      `<div>蛋白 ${d.protein} g · 脂肪 ${d.fat} g · 碳水 ${d.carbs} g · 供能比 ` +
      `${goals.energyShare.protein}/${goals.energyShare.fat}/${goals.energyShare.carbs}%</div>` +
      `<div>每餐约 ${m.kcal} kcal / 蛋白 ${m.protein} g · ` +
      `全家 ${goals.profile.people} 人合计 ${h.kcal} kcal/日</div>` +
      `<div class="goal-summary-note">${esc(goals.note)}</div>` +
      "</div>"
    );
  };
})();

;
/* Nutrition balance score: a transparent, explainable 0-100 heuristic.
   Pure logic only - no DOM, no data fetching. Targets are the adult AMDR
   ranges (carbohydrate 50-65%, fat 20-30%, protein 10-20% of energy).
   This is a meal-composition hint, NOT clinical dietary advice. */
(function () {
  "use strict";

  const CMF = window.CMF;

  const TARGETS = {
    protein: [10, 20],
    fat: [20, 30],
    carbs: [50, 65],
    proteinDensity: 4.0, // g protein per 100 kcal
    kcalPerMeal: [180, 800], // per person, one serving of one dish
  };

  const COMPANIONS = {
    protein: [
      ["鸡蛋", "补优质蛋白"],
      ["豆腐", "补植物蛋白"],
      ["鸡胸肉", "补瘦肉蛋白"],
      ["虾仁", "补低脂蛋白"],
    ],
    carbs: [
      ["米饭", "补主食碳水"],
      ["面条", "补主食碳水"],
      ["红薯", "补优质碳水"],
      ["玉米", "补粗粮碳水"],
    ],
    veggie: [
      ["西兰花", "补膳食纤维"],
      ["菠菜", "补绿叶蔬菜"],
      ["番茄", "补蔬菜与水分"],
    ],
  };


  function esc(value) {
    return String(value == null ? "" : value).replace(/[&<>"']/g, (ch) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
    }[ch]));
  }

  function clamp(n, low, high) {
    return Math.max(low, Math.min(high, n));
  }

  function knownIngredients() {
    const list = CMF.data && CMF.data.catalog && CMF.data.catalog.ingredients;
    return new Set((list || []).map((e) => e.canonical));
  }

  /* Pick up to `count` real catalog ingredients for a suggested side dish. */
  function companions(kind, count) {
    const known = knownIngredients();
    return (COMPANIONS[kind] || [])
      .filter(([name]) => known.has(name))
      .slice(0, count)
      .map(([name, reason]) => ({ name, reason, kind }));
  }

  function gradeOf(score) {
    if (score >= 85) return "优秀";
    if (score >= 70) return "良好";
    if (score >= 55) return "一般";
    return "待改善";
  }

  /* Personal goals replace the population-level AMDR bands with the user's
     own macro split, allowing a +/-10 percentage-point tolerance. */
  function personalBands(target) {
    const energy = {
      protein: (Number(target.protein) || 0) * 4,
      fat: (Number(target.fat) || 0) * 9,
      carbs: (Number(target.carbs) || 0) * 4,
    };
    const sum = energy.protein + energy.fat + energy.carbs;
    const band = (value) => {
      const pct = sum ? Math.round((value / sum) * 100) : 0;
      return [Math.max(0, pct - 10), Math.min(100, pct + 10)];
    };
    return {
      protein: band(energy.protein),
      fat: band(energy.fat),
      carbs: band(energy.carbs),
    };
  }

  /* `totals` is {kcal, protein, fat, carbs}, optionally with `meals`.
     opts: { meals, note } - meals scales the energy expectation. */
  CMF.scoreBalance = function (totals, opts) {
    const options = opts || {};
    const t = totals || {};
    const kcal = Math.max(0, Number(t.kcal) || 0);
    const protein = Math.max(0, Number(t.protein) || 0);
    const fat = Math.max(0, Number(t.fat) || 0);
    const carbs = Math.max(0, Number(t.carbs) || 0);
    const meals = clamp(Number(options.meals || t.meals) || 1, 1, 4);
    // An explicit target wins; otherwise pick up the stored personal goal.
    // With no goal configured goalTargets() returns null and the score is
    // bit-for-bit identical to the original AMDR heuristic.
    const personal = options.targets || (typeof CMF.goalTargets === "function"
      ? CMF.goalTargets({ meals }) : null);
    const usePersonal = !!(personal && Number(personal.kcal) > 0);
    const bands = usePersonal ? personalBands(personal) : TARGETS;

    const energy = { protein: protein * 4, fat: fat * 9, carbs: carbs * 4 };
    const sum = energy.protein + energy.fat + energy.carbs;
    const share = {
      protein: sum ? Math.round((energy.protein / sum) * 100) : 0,
      fat: sum ? Math.round((energy.fat / sum) * 100) : 0,
      carbs: sum ? Math.round((energy.carbs / sum) * 100) : 0,
    };

    if (!sum || !kcal) {
      return {
        score: 0, grade: "无数据", energyShare: share,
        parts: { macro: 0, protein: 0, energy: 0 },
        issues: ["缺少可用于评分的营养数据"],
        tips: ["该菜谱暂缺营养参考值，评分不可用。"],
        companions: [],
        personal: usePersonal,
        target: usePersonal ? personal : null,
      };
    }

    // 60 points: distance from each recommended energy-share band.
    let macro = 0;
    ["protein", "fat", "carbs"].forEach((key) => {
      const [low, high] = bands[key];
      const distance = share[key] < low ? low - share[key]
        : share[key] > high ? share[key] - high : 0;
      macro += clamp(20 - distance * 1.2, 0, 20);
    });
    macro = Math.round(macro);

    // 20 points: protein density (g per 100 kcal).
    const densityTarget = usePersonal
      ? (Number(personal.protein) || 0) / (Number(personal.kcal) || 1) * 100
      : TARGETS.proteinDensity;
    const density = (protein / kcal) * 100;
    const proteinScore = Math.round(clamp(
      (density / (densityTarget || TARGETS.proteinDensity)) * 20, 0, 20
    ));

    // 20 points: does this meal/day cover a plausible amount of energy?
    const minKcal = usePersonal
      ? personal.kcal * 0.75 : TARGETS.kcalPerMeal[0] * meals;
    const maxKcal = usePersonal
      ? personal.kcal * 1.25 : TARGETS.kcalPerMeal[1] * meals;
    let energyScore;
    if (kcal < minKcal) energyScore = (kcal / minKcal) * 20;
    else if (kcal > maxKcal) energyScore = clamp(20 - ((kcal - maxKcal) / maxKcal) * 20, 0, 20);
    else energyScore = 20;
    energyScore = Math.round(energyScore);

    const score = clamp(macro + proteinScore + energyScore, 0, 100);
    const issues = [];
    const tips = [];
    const sides = [];

    if (share.protein < bands.protein[0]) {
      issues.push("蛋白质供能偏低");
      tips.push("加一份鸡蛋、豆腐或瘦肉，把蛋白质补上来。");
      sides.push(...companions("protein", 2));
    }
    if (share.fat > bands.fat[1]) {
      issues.push("脂肪供能偏高");
      tips.push("改用蒸、煮、白灼，或减少用油与肥肉。");
    }
    if (share.carbs < bands.carbs[0]) {
      issues.push("碳水供能偏低");
      tips.push("搭配一份米饭、面条或薯类主食。");
      sides.push(...companions("carbs", 2));
    } else if (share.carbs > bands.carbs[1]) {
      issues.push("碳水供能偏高");
      tips.push("适当减少主食，增加蔬菜与蛋白质。");
      sides.push(...companions("protein", 1));
    }
    if (kcal < minKcal) {
      issues.push("热量偏低");
      tips.push("这份菜单可能吃不饱，建议加主食或蛋白质配菜。");
      sides.push(...companions("veggie", 1));
    } else if (kcal > maxKcal) {
      issues.push("热量偏高");
      tips.push("适当减少主食或高脂食材的用量。");
    }
    if (!issues.length) {
      tips.push("三大营养素供能比接近推荐范围，保持这个搭配就很好。");
      sides.push(...companions("veggie", 1));
    }

    return {
      score,
      grade: gradeOf(score),
      energyShare: share,
      proteinDensity: Math.round(density * 10) / 10,
      kcal,
      parts: { macro, protein: proteinScore, energy: energyScore },
      issues,
      tips,
      companions: sides.slice(0, 3),
      personal: usePersonal,
      target: usePersonal ? personal : null,
    };
  };

  /* Score one planner day (lunch + dinner, per serving). */
  CMF.balanceDay = function (days, index, recipes) {
    if (typeof CMF.weekDayNutrition !== "function") return null;
    const totals = CMF.weekDayNutrition(days, index, recipes);
    if (!totals.meals) return null;
    return CMF.scoreBalance(totals, { meals: totals.meals });
  };

  /* Score every planned day and summarise the weak spots. */
  CMF.balanceMenu = function (days, recipes) {
    const rows = (days || [])
      .map((d) => {
        const result = CMF.balanceDay(days, d.index, recipes);
        return result ? { index: d.index, ...result } : null;
      })
      .filter(Boolean);
    const average = rows.length
      ? Math.round(rows.reduce((sum, r) => sum + r.score, 0) / rows.length)
      : 0;
    const weak = rows.filter((r) => r.score < 70).map((r) => r.index);
    const counts = new Map();
    rows.forEach((r) => r.issues.forEach((issue) => counts.set(issue, (counts.get(issue) || 0) + 1)));
    const advice = [...counts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([issue, count]) => issue + "（" + count + " 天）");
    return { days: rows, average, weak, advice, grade: gradeOf(average) };
  };

  /* Reusable card (string only) for the recipe detail page. */
  CMF.renderBalanceCard = function (totals, opts) {
    if (typeof CMF.scoreBalance !== "function") return "";
    const result = CMF.scoreBalance(totals, opts);
    const cls = result.score >= 70 ? "good" : result.score >= 55 ? "fair" : "poor";
    return (
      '<div class="balance-card ' + cls + '">' +
      '<div class="balance-head"><span>⚖️ 营养均衡评分</span>' +
      (result.personal ? '<span class="balance-personal">按我的目标</span>' : "") +
      `<span class="balance-grade">${esc(result.grade)}</span></div>` +
      '<div class="balance-score"><strong>' + result.score + '</strong><small>/ 100</small></div>' +
      `<div class="balance-bar"><span style="width:${result.score}%"></span></div>` +
      '<div class="balance-parts">供能比 ' + result.parts.macro + '/60 · 蛋白密度 ' +
      result.parts.protein + '/20 · 热量 ' + result.parts.energy + '/20</div>' +
      '<div class="balance-tips">' +
      result.tips.map((tip) => `<div>· ${esc(tip)}</div>`).join("") +
      "</div>" +
      (result.companions.length
        ? '<div class="balance-sides">建议搭配：' +
          result.companions.map((c) => `<span class="pill">${esc(c.name)} · ${esc(c.reason)}</span>`).join("") +
          "</div>"
        : "") +
      '<div class="balance-note">依据三大营养素供能比的启发式评分，仅用于搭配参考，不替代专业营养建议；未计主食、早餐与烹饪损耗。</div>' +
      "</div>"
    );
  };

  /* Compact planner summary. */
  CMF.renderBalanceSummary = function (summary, opts) {
    if (!summary || !summary.days.length) return "";
    const options = opts || {};
    return (
      '<div class="balance-summary">' +
      `<span class="balance-summary-score">⚖️ 菜单均衡 ${summary.average} 分 · ${esc(summary.grade)}</span>` +
      (summary.advice.length
        ? `<span class="balance-summary-advice">待改善：${summary.advice.map(esc).join("、")}</span>`
        : '<span class="balance-summary-advice">各天供能比都在推荐范围附近 👍</span>') +
      (options.showOptimize === false
        ? ""
        : '<button class="btn btn-sm" id="btn-optimize" title="只替换得分较低几天的一餐，保留其余安排">✨ 优化较弱的几天</button>') +
      "</div>"
    );
  };
})();

;
/* Diet compatibility rules. Pure logic, no DOM access.
   These are conservative screening rules for home cooking, not medical advice:
   a recipe that passes still needs the ingredient labels checked by the cook. */
(function () {
  "use strict";

  const CMF = window.CMF;

  CMF.DIETS = [
    {
      key: "gluten_free",
      label: "无麸质",
      emoji: "🌾",
      desc: "避开小麦面制品与含麸质调味料",
    },
    {
      key: "keto",
      label: "生酮 / 低碳水",
      emoji: "🥑",
      desc: "每份碳水 ≤ 20 g，且不含主食与添加糖",
    },
    {
      key: "vegan",
      label: "纯素",
      emoji: "🌱",
      desc: "不含肉、蛋、奶、水产与蜂蜜",
    },
  ];

  CMF.DIET_KEYS = CMF.DIETS.map((d) => d.key);
  CMF.KETO_CARB_LIMIT = 20;

  // Condiments that commonly contain wheat even though their own allergen
  // field is empty. Deliberately conservative: false negatives are worse than
  // hiding a few extra recipes.
  const GLUTEN_CONDIMENTS = new Set([
    "生抽", "老抽", "酱油", "蒸鱼豉油", "蚝油", "豆瓣酱", "黄豆酱",
    "甜面酱", "辣椒酱", "咖喱块", "火锅底料", "味噌",
  ]);

  // Staples and sugars that are incompatible with keto regardless of the
  // (coarse) gram estimate.
  const HIGH_CARB = new Set([
    "大米", "米饭", "小米", "糯米", "燕麦", "面粉", "面条", "挂面",
    "方便面", "荞麦面", "乌冬面", "意面", "米粉", "粉丝", "粉条",
    "馒头", "面包糠", "糯米粉", "藕粉", "面包", "吐司", "饺子", "馄饨",
    "包子", "藜麦", "土豆", "红薯", "山药", "莲藕", "玉米", "豌豆",
    "菱角", "荸荠", "百合", "汤圆", "速冻饺子", "速冻包子", "手抓饼",
    "冻薯条", "冻玉米粒", "白糖", "冰糖", "蜂蜜", "可乐", "红枣",
    "枸杞", "淀粉",
  ]);

  const ANIMAL_CATEGORIES = new Set(["肉蛋", "水产"]);
  const ANIMAL_EXTRA = new Set([
    "牛奶", "酸奶", "奶酪", "黄油", "奶油", "蜂蜜", "高汤",
    "鸡精", "虾皮", "蟹棒", "虾滑", "腐乳",
  ]);
  const ANIMAL_ALLERGENS = new Set(["鸡蛋", "牛奶", "鱼", "甲壳类"]);

  function ingredientsOf(recipe) {
    return (recipe.ingredients || []).filter((i) => !i.optional);
  }

  function allergenInfo(canonical) {
    if (typeof CMF.allergensOf === "function") return CMF.allergensOf(canonical) || [];
    const entry = typeof CMF.entry === "function" ? CMF.entry(canonical) : null;
    return (entry && entry.allergens) || [];
  }

  function categoryInfo(canonical) {
    const entry = typeof CMF.entry === "function" ? CMF.entry(canonical) : null;
    return (entry && entry.category) || "";
  }

  /* Returns the offending ingredient names. Empty array => compatible. */
  CMF.dietConflicts = function (recipe, key) {
    if (!recipe) return ["<无菜谱>"];
    const lines = ingredientsOf(recipe);
    const names = lines.map((i) => i.canonical);
    if (key === "gluten_free") {
      if ((recipe.allergens || []).includes("麸质")) return ["菜谱标注含麸质"];
      return names.filter((n) =>
        GLUTEN_CONDIMENTS.has(n) || allergenInfo(n).includes("麸质")
      );
    }
    if (key === "keto") {
      const offenders = names.filter((n) => HIGH_CARB.has(n));
      const carbs = typeof CMF.carbsPerServing === "function"
        ? CMF.carbsPerServing(recipe)
        : Infinity;
      if (!Number.isFinite(carbs) || carbs > CMF.KETO_CARB_LIMIT) {
        offenders.push("每份碳水超过 " + CMF.KETO_CARB_LIMIT + " g");
      }
      return offenders;
    }
    if (key === "vegan") {
      if ((recipe.allergens || []).some((a) => ANIMAL_ALLERGENS.has(a))) {
        return ["菜谱标注含动物性过敏原"];
      }
      return names.filter(
        (n) =>
          ANIMAL_CATEGORIES.has(categoryInfo(n)) ||
          ANIMAL_EXTRA.has(n) ||
          allergenInfo(n).some((a) => ANIMAL_ALLERGENS.has(a))
      );
    }
    return ["未知饮食偏好"];
  };

  CMF.matchesDiet = function (recipe, key) {
    return CMF.dietConflicts(recipe, key).length === 0;
  };

  CMF.matchesDiets = function (recipe, diets) {
    return (diets || []).every((key) => CMF.matchesDiet(recipe, key));
  };

  CMF.compatibleDiets = function (recipe) {
    return CMF.DIET_KEYS.filter((key) => CMF.matchesDiet(recipe, key));
  };

  CMF.dietLabel = function (key) {
    const found = CMF.DIETS.find((d) => d.key === key);
    return found ? found.label : key;
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
/* Rough ingredient cost estimates. All numbers are heuristics from the
   Python price model; every UI surface must label totals as 估算. */
(function () {
  "use strict";

  const CMF = (window.CMF = window.CMF || {});

  function facts() {
    return (CMF.data && CMF.data.catalog && CMF.data.catalog.price_facts) || null;
  }

  CMF.pricePer500g = function (canonical) {
    const f = facts();
    if (!f) return null;
    if (Object.prototype.hasOwnProperty.call(f.per500g, canonical)) {
      return f.per500g[canonical];
    }
    const category = CMF.categoryOf ? CMF.categoryOf(canonical) : "其他";
    if (Object.prototype.hasOwnProperty.call(f.category_default, category)) {
      return f.category_default[category];
    }
    return f.fallback;
  };

  CMF.ingredientCost = function (canonical, grams) {
    const price = CMF.pricePer500g(canonical);
    if (price == null || !(grams > 0)) return 0;
    return (price / 500) * grams;
  };

  /* Whole-recipe cost at a given serving factor. Uses the same gram
     conversion as the nutrition estimate so the two cards stay consistent. */
  CMF.recipeCost = function (recipe, factor) {
    if (!facts() || typeof CMF.ingredientGrams !== "function") return null;
    const f = factor || 1;
    let total = 0;
    let unknown = 0;
    for (const use of recipe.ingredients) {
      const measure = CMF.ingredientGrams(use.canonical, use.amount);
      const grams = measure && measure.grams;
      if (!(grams > 0)) {
        unknown += 1;
        continue;
      }
      total += CMF.ingredientCost(use.canonical, grams * f);
    }
    return { total: Math.round(total * 10) / 10, unknown };
  };

  /* Shopping lists rarely carry exact amounts; default to a 200 g purchase
     unit per line and say so in the UI. */
  CMF.shoppingCost = function (items) {
    if (!facts()) return null;
    let total = 0;
    for (const item of items) {
      const grams = item.grams > 0 ? item.grams : 200;
      total += CMF.ingredientCost(item.canonical, grams);
    }
    return Math.round(total * 10) / 10;
  };

  CMF.takeoutPerMeal = function () {
    const f = facts();
    return f ? f.takeout_per_meal : 30;
  };

  /* "省下外卖钱": only counts cooked entries that carry a cost estimate. */
  CMF.savingsEstimate = function (cookedEntries) {
    const takeout = CMF.takeoutPerMeal();
    let saved = 0;
    let meals = 0;
    for (const entry of cookedEntries || []) {
      if (typeof entry.cost !== "number" || entry.cost < 0) continue;
      meals += 1;
      saved += Math.max(0, takeout - entry.cost);
    }
    return { saved: Math.round(saved), meals, takeout };
  };
})();
;
/* Cooked-it journal: check-ins, ratings, notes, streaks and achievements.
   Pure logic over a plain journal object; storage lives in store.js so
   backup / restore / sync cover it automatically. */
(function () {
  "use strict";

  const CMF = (window.CMF = window.CMF || {});
  const MAX_ENTRIES = 500;

  function validRating(value) {
    return Number.isInteger(value) && value >= 0 && value <= 5;
  }

  function entries(value) {
    return value && typeof value === "object" && !Array.isArray(value) ? Object.entries(value) : [];
  }

  CMF.normalizeJournal = function (raw) {
    const safe = raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
    return {
      cooked: (Array.isArray(safe.cooked) ? safe.cooked : [])
        .filter((e) => e && typeof e.id === "string" && e.id &&
          typeof e.recipeId === "string" && e.recipeId &&
          typeof e.date === "string" && Number.isFinite(Date.parse(e.date)))
        .map((e) => ({
          id: e.id, recipeId: e.recipeId,
          title: typeof e.title === "string" ? e.title : e.recipeId,
          date: e.date,
          factor: Number.isFinite(e.factor) && e.factor > 0 ? e.factor : 1,
          rating: validRating(e.rating) ? e.rating : 0,
          note: typeof e.note === "string" ? e.note.slice(0, 500) : "",
          kcal: Number.isFinite(e.kcal) && e.kcal >= 0 ? e.kcal : null,
          cost: Number.isFinite(e.cost) && e.cost >= 0 ? e.cost : null,
        })),
      ratings: Object.fromEntries(entries(safe.ratings).filter(([, value]) => validRating(value))),
      notes: Object.fromEntries(entries(safe.notes)
        .filter(([, value]) => typeof value === "string")
        .map(([key, value]) => [key, value.slice(0, 500)])),
    };
  };

  CMF.mergeJournals = function (local, incoming) {
    const a = CMF.normalizeJournal(local);
    const b = CMF.normalizeJournal(incoming);
    const cooked = new Map(b.cooked.map((e) => [e.id, e]));
    a.cooked.forEach((e) => cooked.set(e.id, e));
    return {
      cooked: [...cooked.values()].sort((x, y) => Date.parse(y.date) - Date.parse(x.date)),
      ratings: { ...b.ratings, ...a.ratings },
      notes: { ...b.notes, ...a.notes },
    };
  };

  CMF.localDay = function (date) {
    const d = date instanceof Date ? date : new Date(date);
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${d.getFullYear()}-${m}-${day}`;
  };

  /* Record one cooking session. Nutrition and cost are snapshots so later
     catalog edits never rewrite history. */
  CMF.logCooked = function (recipe, opts) {
    const options = opts || {};
    const factor = options.factor > 0 ? options.factor : 1;
    const journal = CMF.normalizeJournal(CMF.getJournal ? CMF.getJournal() : null);
    const rating = Math.max(0, Math.min(5, Math.round(Number(options.rating) || 0)));
    const note = String(options.note || "").trim().slice(0, 500);
    let kcal = null;
    if (typeof CMF.estimateNutrition === "function") {
      const est = CMF.estimateNutrition(recipe, factor);
      if (est && est.perServing) kcal = est.perServing.kcal;
    }
    let cost = null;
    if (typeof CMF.recipeCost === "function") {
      const c = CMF.recipeCost(recipe, factor);
      if (c) cost = c.total;
    }
    const entry = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      recipeId: recipe.id,
      title: recipe.title,
      date: (options.now ? new Date(options.now) : new Date()).toISOString(),
      factor,
      rating,
      note,
      kcal,
      cost,
    };
    journal.cooked.unshift(entry);
    journal.cooked = journal.cooked.slice(0, MAX_ENTRIES);
    if (rating > 0) journal.ratings[recipe.id] = rating;
    if (note) journal.notes[recipe.id] = note;
    if (!CMF.setJournal || !CMF.setJournal(journal)) return null;
    return entry;
  };

  CMF.cookedCountFor = function (journal, recipeId) {
    return CMF.normalizeJournal(journal).cooked.filter((e) => e.recipeId === recipeId).length;
  };

  CMF.journalSummary = function (journal) {
    const j = CMF.normalizeJournal(journal);
    const ids = new Set(j.cooked.map((e) => e.recipeId));
    const rated = j.cooked.filter((e) => e.rating > 0);
    const avg = rated.length
      ? Math.round((rated.reduce((s, e) => s + e.rating, 0) / rated.length) * 10) / 10
      : 0;
    return {
      total: j.cooked.length,
      distinct: ids.size,
      avgRating: avg,
      lastDate: j.cooked.length ? j.cooked[0].date : null,
    };
  };

  /* Consecutive cooking days ending today (or yesterday — today's dinner
     may not have happened yet). */
  CMF.journalStreak = function (journal, today) {
    const j = CMF.normalizeJournal(journal);
    const days = new Set(j.cooked.map((e) => CMF.localDay(e.date)));
    const anchor = today ? new Date(today) : new Date();
    if (!days.has(CMF.localDay(anchor))) anchor.setDate(anchor.getDate() - 1);
    let streak = 0;
    while (days.has(CMF.localDay(anchor))) {
      streak += 1;
      anchor.setDate(anchor.getDate() - 1);
    }
    return streak;
  };

  CMF.topRated = function (journal, limit) {
    const j = CMF.normalizeJournal(journal);
    const map = new Map();
    for (const e of j.cooked) {
      if (!(e.rating > 0)) continue;
      const row = map.get(e.recipeId) || { recipeId: e.recipeId, title: e.title, sum: 0, count: 0 };
      row.sum += e.rating;
      row.count += 1;
      map.set(e.recipeId, row);
    }
    return [...map.values()]
      .map((r) => ({ recipeId: r.recipeId, title: r.title, avg: Math.round((r.sum / r.count) * 10) / 10, count: r.count }))
      .sort((a, b) => b.avg - a.avg || b.count - a.count || (a.title < b.title ? -1 : 1))
      .slice(0, limit || 5);
  };

  /* Per-day totals for the last `days` days, oldest first. */
  CMF.weeklyTrend = function (journal, days, today) {
    const j = CMF.normalizeJournal(journal);
    const n = days || 7;
    const anchor = today ? new Date(today) : new Date();
    const byDay = new Map();
    for (const e of j.cooked) {
      const key = CMF.localDay(e.date);
      const row = byDay.get(key) || { kcal: 0, cost: 0, count: 0 };
      row.count += 1;
      if (typeof e.kcal === "number") row.kcal += e.kcal;
      if (typeof e.cost === "number") row.cost += e.cost;
      byDay.set(key, row);
    }
    const out = [];
    for (let i = n - 1; i >= 0; i -= 1) {
      const d = new Date(anchor);
      d.setDate(d.getDate() - i);
      const key = CMF.localDay(d);
      const row = byDay.get(key) || { kcal: 0, cost: 0, count: 0 };
      out.push({ day: key, label: `${d.getMonth() + 1}/${d.getDate()}`, ...row });
    }
    return out;
  };

  const BADGES = [
    { key: "first", emoji: "🍳", label: "初下厨房", desc: "完成第一次开饭打卡", target: 1 },
    { key: "streak3", emoji: "🔥", label: "三日不断", desc: "连续 3 天自己做饭", target: 3 },
    { key: "streak7", emoji: "⚡", label: "七日连击", desc: "连续 7 天自己做饭", target: 7 },
    { key: "variety10", emoji: "🎨", label: "十菜俱乐部", desc: "做过 10 道不同的菜", target: 10 },
    { key: "cooked30", emoji: "🏅", label: "全勤厨神", desc: "累计打卡 30 次", target: 30 },
    { key: "fav10", emoji: "💗", label: "收藏家", desc: "收藏 10 道菜", target: 10 },
    { key: "fridge10", emoji: "🧊", label: "冰箱管理员", desc: "冰箱里同时有 10 样食材", target: 10 },
    { key: "plan5", emoji: "📋", label: "计划通", desc: "计划里放过 5 道菜", target: 5 },
    { key: "share5", emoji: "📣", label: "分享达人", desc: "分享 5 次菜谱或冰箱", target: 5 },
  ];

  CMF.achievements = function (state) {
    const s = state || {};
    const summary = CMF.journalSummary(s.journal);
    const streak = CMF.journalStreak(s.journal, s.today);
    const metrics = {
      first: summary.total,
      streak3: streak,
      streak7: streak,
      variety10: summary.distinct,
      cooked30: summary.total,
      fav10: (s.favorites || []).length,
      fridge10: (s.fridge || []).length,
      plan5: (s.plan || []).length,
      share5: s.shareStats && s.shareStats.total ? s.shareStats.total : 0,
    };
    return BADGES.map((b) => ({
      ...b,
      progress: Math.min(metrics[b.key] || 0, b.target),
      earned: (metrics[b.key] || 0) >= b.target,
    }));
  };

})();
;
(function () {
  "use strict";

  const CMF = (window.CMF = window.CMF || {});
  const LOCATIONS = new Set(["fridge", "freezer", "pantry"]);
  const round = (n) => Math.round(n * 10) / 10;
  const today = () => CMF.localDay(new Date());

  function dayNumber(value) {
    if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
    const time = Date.parse(value + "T00:00:00Z");
    if (!Number.isFinite(time) || new Date(time).toISOString().slice(0, 10) !== value) return null;
    return time / 86400000;
  }

  function validGrams(value) {
    return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1000000;
  }

  function newest(a, b) {
    if (a.updatedAt !== b.updatedAt) return a.updatedAt > b.updatedAt ? a : b;
    if (a.deleted !== b.deleted) return a.deleted ? a : b;
    return JSON.stringify(a) >= JSON.stringify(b) ? a : b;
  }

  CMF.normalizeInventory = function (raw) {
    const rows = raw && !Array.isArray(raw) && Array.isArray(raw.batches) ? raw.batches : [];
    const byId = new Map();
    for (const row of rows) {
      if (!row || typeof row.id !== "string" || !row.id || row.id.length > 200 ||
          typeof row.canonical !== "string" || !row.canonical.trim() || row.canonical.length > 80 ||
          !validGrams(row.grams) || !Number.isSafeInteger(row.updatedAt) || row.updatedAt <= 0 ||
          typeof row.expiresOn !== "string" || (row.expiresOn !== "" && dayNumber(row.expiresOn) === null) ||
          !LOCATIONS.has(row.location)) continue;
      const batch = {
        id: row.id, canonical: row.canonical.trim(), grams: row.deleted === true ? 0 : round(row.grams),
        expiresOn: row.expiresOn, location: row.location,
        note: typeof row.note === "string" ? row.note.slice(0, 200) : "",
        updatedAt: row.updatedAt, deleted: row.deleted === true,
      };
      byId.set(batch.id, byId.has(batch.id) ? newest(byId.get(batch.id), batch) : batch);
    }
    return { batches: [...byId.values()].sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0) };
  };

  CMF.mergeInventories = function (local, incoming) {
    return CMF.normalizeInventory({ batches: [
      ...CMF.normalizeInventory(local).batches, ...CMF.normalizeInventory(incoming).batches,
    ] });
  };

  CMF.inventoryStatus = function (batch, date) {
    if (batch.deleted) return { key: "deleted", label: "已移除", days: null };
    if (batch.grams === 0) return { key: "empty", label: "已用完", days: null };
    if (!batch.expiresOn) return { key: "undated", label: "未填日期", days: null };
    const anchor = dayNumber(date || today());
    if (anchor === null) throw new Error("日期格式不正确");
    const days = dayNumber(batch.expiresOn) - anchor;
    if (days < 0) return { key: "expired", label: "已过期 " + -days + " 天", days };
    if (days === 0) return { key: "due", label: "今天到期", days };
    if (days <= 3) return { key: "due", label: days + " 天内到期", days };
    return { key: "fresh", label: "距到期 " + days + " 天", days };
  };

  CMF.inventorySummary = function (raw, date) {
    const summary = { active: 0, expired: 0, due: 0, undated: 0, grams: 0 };
    for (const batch of CMF.normalizeInventory(raw).batches) {
      const status = CMF.inventoryStatus(batch, date);
      if (status.key === "deleted" || status.key === "empty") continue;
      summary.active += 1;
      summary.grams = round(summary.grams + batch.grams);
      if (status.key in summary) summary[status.key] += 1;
    }
    return summary;
  };

  function timestamp(previous) {
    const next = Math.max(Date.now(), (previous || 0) + 1);
    if (!Number.isSafeInteger(next)) throw new Error("批次修改时间无效，未保存任何变更。");
    return next;
  }

  function persist(state) {
    if (!CMF.setInventory(state)) throw new Error("库存保存失败，输入已保留；请重试或导出备份后检查存储空间。");
  }

  CMF.upsertInventoryBatch = function (input, expected) {
    const canonical = CMF.normalizeName(input.canonical);
    if (!CMF.isKnown(canonical)) throw new Error("请选择目录中的食材，可输入常见别名。");
    if (!validGrams(input.grams) || (input.grams > 0 && round(input.grams) === 0)) {
      throw new Error("数量须为 0–1000000 克，最小精度为 0.1 克。");
    }
    if (typeof input.expiresOn !== "string" || (input.expiresOn && dayNumber(input.expiresOn) === null)) {
      throw new Error("请填写有效的到期日期，或留空。");
    }
    if (!LOCATIONS.has(input.location)) throw new Error("请选择冷藏、冷冻或常温。");
    const state = CMF.normalizeInventory(CMF.getInventory());
    const old = state.batches.find((b) => b.id === input.id);
    if (input.id && (!old || old.deleted || JSON.stringify(old) !== JSON.stringify(expected))) {
      throw new Error("这条批次已被修改，请重新打开编辑后再保存。");
    }
    const batch = {
      id: old ? old.id : "batch-" + (typeof crypto !== "undefined" && crypto.randomUUID
        ? crypto.randomUUID() : Date.now().toString(36) + "-" + Math.random().toString(36).slice(2)),
      canonical, grams: round(input.grams), expiresOn: input.expiresOn, location: input.location,
      note: String(input.note || "").trim().slice(0, 200), updatedAt: timestamp(old && old.updatedAt), deleted: false,
    };
    state.batches = state.batches.filter((b) => b.id !== batch.id).concat(batch);
    persist(CMF.normalizeInventory(state));
    return batch;
  };

  CMF.removeInventoryBatch = function (id, expected) {
    const state = CMF.normalizeInventory(CMF.getInventory());
    const batch = state.batches.find((b) => b.id === id);
    if (!batch || batch.deleted || JSON.stringify(batch) !== JSON.stringify(expected)) {
      throw new Error("这条批次已被修改，请刷新列表后重试。");
    }
    batch.deleted = true;
    batch.grams = 0;
    batch.updatedAt = timestamp(batch.updatedAt);
    persist(state);
    return true;
  };

  CMF.inventoryRecipeNeeds = function (recipe, factor) {
    const scale = Number.isFinite(factor) && factor > 0 ? factor : 1;
    const needs = new Map();
    for (const use of recipe.ingredients || []) {
      const parsed = CMF.parseAmount(use.amount);
      const converted = CMF.ingredientGrams(use.canonical, use.amount);
      const known = parsed.exact && converted.known && converted.grams > 0;
      const grams = known ? round(converted.grams * scale) : null;
      const row = needs.get(use.canonical);
      const estimated = !["克", "g", "千克", "公斤", "kg"].includes(parsed.unit);
      if (row) {
        row.grams = row.grams === null || grams === null ? null : round(row.grams + grams);
        row.optional = row.optional && Boolean(use.optional);
        row.estimated = row.estimated || estimated;
      } else {
        needs.set(use.canonical, { canonical: use.canonical, grams, optional: Boolean(use.optional), estimated });
      }
    }
    return [...needs.values()];
  };

  CMF.previewInventoryUse = function (raw, requests, date) {
    const day = date || today();
    if (dayNumber(day) === null) throw new Error("日期格式不正确");
    if (!Array.isArray(requests)) throw new Error("请选择要扣减的食材与克数。");
    const combined = new Map();
    for (const item of requests) {
      if (!item || typeof item.canonical !== "string" || !item.canonical ||
          !validGrams(item.grams) || round(item.grams) <= 0) throw new Error("扣减克数须大于 0，且不超过 1000000。");
      combined.set(item.canonical, round((combined.get(item.canonical) || 0) + item.grams));
      if (combined.get(item.canonical) > 1000000) throw new Error("同一食材的扣减克数不可超过 1000000。");
    }
    const state = CMF.normalizeInventory(raw);
    const lines = [...combined].map(([canonical, grams]) => {
      const batches = state.batches.filter((b) => b.canonical === canonical && !b.deleted && b.grams > 0);
      const usable = batches.filter((b) => CMF.inventoryStatus(b, day).key !== "expired")
        .sort((a, b) => (a.expiresOn || "9999-99-99").localeCompare(b.expiresOn || "9999-99-99") ||
          (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
      const available = round(usable.reduce((sum, b) => sum + b.grams, 0));
      const expiredGrams = round(batches.filter((b) => CMF.inventoryStatus(b, day).key === "expired")
        .reduce((sum, b) => sum + b.grams, 0));
      let remaining = grams;
      const allocations = [];
      for (const batch of usable) {
        const take = round(Math.min(remaining, batch.grams));
        if (take > 0) allocations.push({ id: batch.id, grams: take });
        remaining = round(remaining - take);
        if (!remaining) break;
      }
      return { canonical, grams, available, missing: round(Math.max(0, grams - available)), expiredGrams, allocations };
    });
    return {
      before: JSON.stringify(state), day,
      requests: [...combined].map(([canonical, grams]) => ({ canonical, grams })),
      ok: lines.length > 0 && lines.every((line) => line.missing === 0),
      totalGrams: round(lines.reduce((sum, line) => sum + line.grams, 0)), lines,
    };
  };

  CMF.commitInventoryUse = function (preview) {
    const before = CMF.normalizeInventory(CMF.getInventory());
    if (!preview || preview.before !== JSON.stringify(before) || preview.day !== today()) {
      throw new Error("库存或日期已变化，请重新预览扣减。");
    }
    const verified = CMF.previewInventoryUse(before, preview.requests);
    if (!verified.ok) throw new Error("库存不足或未选食材；不会扣减任何批次。");
    const changes = verified.lines.flatMap((line) => line.allocations);
    const state = CMF.normalizeInventory(before);
    for (const change of changes) {
      const batch = state.batches.find((b) => b.id === change.id);
      batch.grams = round(batch.grams - change.grams);
      batch.updatedAt = timestamp(batch.updatedAt);
    }
    persist(state);
    return { before, after: JSON.stringify(state), changes };
  };

  CMF.undoInventoryUse = function (receipt) {
    const current = CMF.normalizeInventory(CMF.getInventory());
    if (!receipt || JSON.stringify(current) !== receipt.after) {
      throw new Error("库存已有后续变动，不能覆盖撤销；请到库存台账核对调整。");
    }
    const previous = CMF.normalizeInventory(receipt.before);
    const changed = new Set(receipt.changes.map((change) => change.id));
    for (const batch of current.batches) {
      if (!changed.has(batch.id)) continue;
      batch.grams = previous.batches.find((b) => b.id === batch.id).grams;
      batch.updatedAt = timestamp(batch.updatedAt);
    }
    persist(current);
    return true;
  };
})();

;
/* Ingredient pairing recommendations derived from recipe co-occurrence.
   Two ingredients that appear together in many recipes are treated as a
   classic pairing. Fully offline, data-driven, no hard-coded pairs.
   Pantry staples (salt, oil, ...) are excluded from recommendations because
   they co-occur with everything and carry no pairing signal. */
(function () {
  "use strict";

  const CMF = (window.CMF = window.CMF || {});

  let pairIndex = {};
  let perIngredient = {};
  let isStaple = () => false;

  function pairKey(a, b) {
    return a < b ? a + "||" + b : b + "||" + a;
  }

  /* opts.isStaple can be injected for headless tests; otherwise it falls
     back to the catalog helper installed by catalog.js (or a no-op). */
  CMF.buildPairingIndex = function (recipes, opts) {
    const options = opts || {};
    isStaple =
      typeof options.isStaple === "function"
        ? options.isStaple
        : typeof CMF.isStaple === "function"
          ? CMF.isStaple
          : () => false;
    pairIndex = {};
    perIngredient = {};
    (recipes || []).forEach((r) => {
      const names = [
        ...new Set(
          (r.ingredients || [])
            .filter((i) => i && !i.optional && i.canonical)
            .map((i) => i.canonical)
        ),
      ];
      for (let i = 0; i < names.length; i++) {
        for (let j = i + 1; j < names.length; j++) {
          const key = pairKey(names[i], names[j]);
          pairIndex[key] = (pairIndex[key] || 0) + 1;
        }
      }
    });
  };

  CMF.topPairings = function (canonical, limit) {
    if (!canonical) return [];
    if (!perIngredient[canonical]) {
      const counts = [];
      Object.keys(pairIndex).forEach((key) => {
        const parts = key.split("||");
        let other = null;
        if (parts[0] === canonical) other = parts[1];
        else if (parts[1] === canonical) other = parts[0];
        if (other && !isStaple(other)) {
          counts.push({ canonical: other, count: pairIndex[key] });
        }
      });
      counts.sort((a, b) => {
        if (b.count !== a.count) return b.count - a.count;
        if (a.canonical === b.canonical) return 0;
        return a.canonical < b.canonical ? -1 : 1;
      });
      perIngredient[canonical] = counts;
    }
    const n = limit == null ? 6 : Math.max(0, limit);
    return perIngredient[canonical].slice(0, n);
  };
})();

;
/* Meal planner: lunch + dinner for 1-4 weeks, deterministic pure logic, no DOM.
   Days are [{index, lunch:{recipeId,title}, dinner:{recipeId,title}}] where
   index is the day offset from startDate (0..27). Legacy single-meal weeks
   are upgraded by migrateWeek() without losing the lunches already picked. */
(function () {
  "use strict";

  const CMF = window.CMF;
  const DAYS = 7;
  const MEALS = ["lunch", "dinner"];
  const WEEKDAYS = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];
  const MAX_WEEKS = 4;

  CMF.WEEKDAY_LABELS = ["周一", "周二", "周三", "周四", "周五", "周六", "周日"];
  CMF.MAX_MENU_WEEKS = MAX_WEEKS;
  CMF.MENU_WEEK_OPTIONS = [1, 2, 3, 4];
  // Shared with sw.js: the calendar subscription endpoint lives in this cache.
  CMF.CALENDAR_CACHE = "cmf-calendar-v1";
  CMF.CALENDAR_PATH = "calendar.ics";

  function mulberry32(seed) {
    let a = seed >>> 0;
    return function () {
      a |= 0;
      a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function recipeAllergens(recipe) {
    if (recipe.allergens && recipe.allergens.length) return recipe.allergens;
    const found = new Set();
    (recipe.ingredients || []).forEach((i) => {
      CMF.allergensOf(i.canonical).forEach((a) => found.add(a));
    });
    return [...found];
  }

  function eligibleRecipes(recipes, prefs) {
    const blockedAllergens = new Set((prefs && prefs.allergens) || []);
    const tags = new Set((prefs && prefs.tags) || []);
    const diets = (prefs && prefs.diets) || [];
    const vegetarian = tags.has("素食");
    return recipes.filter((r) => {
      if (blockedAllergens.size) {
        const has = recipeAllergens(r).some((a) => blockedAllergens.has(a));
        if (has) return false;
      }
      if (vegetarian && !(r.tags || []).includes("素食")) return false;
      if (diets.length) {
        // Fail closed when the diet module is not loaded.
        if (typeof CMF.matchesDiets !== "function") return false;
        if (!CMF.matchesDiets(r, diets)) return false;
      }
      return true;
    });
  }

  function pickRecipe(pool, fridge, usedTitles, rng) {
    const fridgeSet = new Set(fridge);
    let best = null;
    let bestKey = null;
    pool.forEach((r) => {
      if (usedTitles.has(r.title)) return;
      const m = CMF.matchRecipe(r, fridgeSet);
      const tie = rng();
      const key = [m.missingCount, tie, r.id];
      if (bestKey === null || key[0] < bestKey[0] ||
          (key[0] === bestKey[0] && key[1] < bestKey[1])) {
        best = r;
        bestKey = key;
      }
    });
    return best;
  }

  function brief(recipe) {
    return recipe ? { recipeId: recipe.id, title: recipe.title } : null;
  }

  /* Flatten a menu (new or legacy shape) into meal records. */
  CMF.weekMeals = function (days) {
    const rows = [];
    (days || []).forEach((d, position) => {
      const index = Number.isInteger(d.index) ? d.index : position;
      MEALS.forEach((meal) => {
        if (d[meal] && d[meal].recipeId) {
          rows.push({ index, meal, recipeId: d[meal].recipeId, title: d[meal].title });
        }
      });
      // Legacy single-meal entry (or a day that only has a top-level recipe).
      if (!d.lunch && !d.dinner && d.recipeId) {
        rows.push({ index, meal: "lunch", recipeId: d.recipeId, title: d.title });
      }
    });
    return rows;
  };

  CMF.menuWeekCount = function (days) {
    const meals = CMF.weekMeals(days);
    if (!meals.length) return 0;
    return Math.ceil((Math.max(...meals.map((m) => m.index)) + 1) / DAYS);
  };

  /* Build one 7-day chunk starting at `startIndex`. `used` is shared across
     weeks so the planner avoids repeating dishes for as long as the eligible
     pool allows. */
  function buildChunk(startIndex, used, pool, fridge, rng) {
    const days = Array.from({ length: DAYS }, (_, i) => ({
      index: startIndex + i, lunch: null, dinner: null,
    }));
    outer: for (let i = 0; i < DAYS; i += 1) {
      for (const meal of MEALS) {
        const recipe = pickRecipe(pool, fridge, used, rng);
        if (!recipe) break outer;
        used.add(recipe.title);
        days[i][meal] = brief(recipe);
      }
    }
    // Never return a half-empty card; better 5 complete days when strict diet
    // filters shrink the candidate pool.
    return days.filter((d) => d.lunch && d.dinner);
  }

  function clampWeeks(weeks) {
    return Math.max(1, Math.min(MAX_WEEKS, Math.round(Number(weeks) || 1)));
  }

  /* Grow or shrink an existing menu without discarding hand-picked meals. */
  CMF.resizeMenu = function (days, weeks, recipes, fridge, prefs, seed) {
    const target = clampWeeks(weeks);
    const current = CMF.menuWeekCount(days);
    if (target <= current) return (days || []).filter((d) => d.index < target * DAYS);
    const rng = mulberry32(seed || 1);
    const pool = eligibleRecipes(recipes, prefs);
    let result = (days || []).slice();
    for (let w = current; w < target; w += 1) {
      const used = new Set(CMF.weekMeals(result).map((m) => m.title));
      let chunk = buildChunk(w * DAYS, used, pool, fridge || [], rng);
      if (chunk.length < DAYS) {
        // Pool exhausted (strict diets/allergens): allow repeats across weeks,
        // but keep every dish inside this week unique.
        chunk = buildChunk(w * DAYS, new Set(), pool, fridge || [], rng);
      }
      result = result.concat(chunk);
    }
    return result;
  };

  CMF.buildMenu = function (weeks, recipes, fridge, prefs, seed) {
    return CMF.resizeMenu([], weeks, recipes, fridge, prefs, seed);
  };

  CMF.buildWeek = function (recipes, fridge, prefs, seed) {
    return CMF.buildMenu(1, recipes, fridge, prefs, seed);
  };

  /* Upgrade a legacy week: keep the chosen dish as lunch, fill dinners. */
  CMF.migrateWeek = function (days, recipes, fridge, prefs, seed) {
    const migrated = (days || []).map((d, position) => {
      const index = Number.isInteger(d.index) ? d.index : position;
      if (d.lunch || d.dinner) {
        return { index, lunch: d.lunch || null, dinner: d.dinner || null };
      }
      return {
        index,
        lunch: d.recipeId ? { recipeId: d.recipeId, title: d.title } : null,
        dinner: null,
      };
    });
    return CMF.fillWeekMeals(migrated, recipes, fridge, prefs, seed);
  };

  /* Fill any missing meal without changing the ones already chosen. */
  CMF.fillWeekMeals = function (days, recipes, fridge, prefs, seed) {
    if (!recipes) return days;
    const rng = mulberry32(seed || 1);
    const pool = eligibleRecipes(recipes, prefs);
    const used = new Set(CMF.weekMeals(days).map((m) => m.title));
    return days.map((d) => {
      const next = { index: d.index, lunch: d.lunch || null, dinner: d.dinner || null };
      MEALS.forEach((meal) => {
        if (next[meal]) return;
        const recipe = pickRecipe(pool, fridge || [], used, rng);
        if (recipe) {
          next[meal] = brief(recipe);
          used.add(recipe.title);
        }
      });
      return next;
    });
  };

  CMF.isLegacyWeek = function (days) {
    return (days || []).some((d) => !d.lunch && !d.dinner && d.recipeId);
  };

  CMF.rerollMeal = function (days, index, meal, recipes, fridge, prefs, seed) {
    const rng = mulberry32(seed || (Date.now() & 0xffffffff));
    const pool = eligibleRecipes(recipes, prefs);
    const allMeals = CMF.weekMeals(days);
    // Exclude EVERY currently planned dish, including the one being replaced:
    // otherwise a pool that is exactly full would "reroll" into the same dish.
    const usedTitles = new Set(allMeals.map((m) => m.title));
    let recipe = pickRecipe(pool, fridge, usedTitles, rng);
    if (!recipe) {
      // Strict filters can leave fewer eligible dishes than there are meal
      // slots. Relax the whole-menu uniqueness, but still exclude the day's
      // two dishes (which includes the one being replaced) so a reroll always
      // changes something and never duplicates a dish on the same day.
      const sameDay = new Set(
        allMeals.filter((m) => m.index === index).map((m) => m.title)
      );
      recipe = pickRecipe(pool, fridge, sameDay, mulberry32((seed || 1) ^ 0x9e3779b9));
    }
    if (!recipe) return days;
    return days.map((d) =>
      d.index === index
        ? { index: d.index, lunch: d.lunch, dinner: d.dinner, [meal]: brief(recipe) }
        : d
    );
  };

  /* Backwards-compatible alias: rerollDay replaces that day's lunch. */
  CMF.rerollDay = function (days, index, recipes, fridge, prefs, seed) {
    return CMF.rerollMeal(days, index, "lunch", recipes, fridge, prefs, seed);
  };

  /* Cross-week shopping: which weeks need each missing ingredient. */
  CMF.weekShopping = function (days, recipes, fridge) {
    const byId = new Map(recipes.map((r) => [r.id, r]));
    const fridgeSet = new Set(fridge);
    const need = new Map();
    CMF.weekMeals(days).forEach((m) => {
      const r = byId.get(m.recipeId);
      if (!r) return;
      const match = CMF.matchRecipe(r, fridgeSet);
      const weekNo = Math.floor(m.index / DAYS);
      match.missing.forEach((c) => {
        if (!need.has(c)) need.set(c, { recipes: [], weeks: new Set() });
        const row = need.get(c);
        row.recipes.push(r.title);
        row.weeks.add(weekNo);
      });
    });
    return [...need.keys()].sort().map((c) => ({
      canonical: c,
      recipes: [...new Set(need.get(c).recipes)],
      weeks: [...need.get(c).weeks].sort((a, b) => a - b),
    }));
  };
  CMF.menuShopping = CMF.weekShopping;

  /* --- Shopping list split by week --------------------------------------- */

  const CATEGORY_ORDER = [
    "蔬菜", "肉蛋", "水产", "主食", "豆乳", "调料", "水果", "冷冻食品", "其他",
  ];
  CMF.SHOPPING_CATEGORIES = CATEGORY_ORDER.slice();

  function categoryRank(name) {
    const index = CATEGORY_ORDER.indexOf(name);
    return index < 0 ? CATEGORY_ORDER.length : index;
  }

  /* One group per week. An ingredient needed in two different weeks shows up
     in both (you buy it twice), which the old flat list could not express. */
  CMF.weeklyShopping = function (days, recipes, fridge) {
    const byId = new Map((recipes || []).map((r) => [r.id, r]));
    const fridgeSet = new Set(fridge || []);
    const weeks = Math.max(1, CMF.menuWeekCount(days) || 1);
    const buckets = Array.from({ length: weeks }, () => new Map());
    CMF.weekMeals(days).forEach((m) => {
      const recipe = byId.get(m.recipeId);
      if (!recipe) return;
      const week = Math.floor(m.index / DAYS);
      if (!buckets[week]) return;
      const bucket = buckets[week];
      CMF.matchRecipe(recipe, fridgeSet).missing.forEach((canonical) => {
        if (!bucket.has(canonical)) {
          bucket.set(canonical, {
            canonical,
            category: typeof CMF.categoryOf === "function"
              ? CMF.categoryOf(canonical) : "其他",
            recipes: [],
            meals: [],
          });
        }
        const row = bucket.get(canonical);
        if (!row.recipes.includes(recipe.title)) row.recipes.push(recipe.title);
        row.meals.push(m.meal);
      });
    });
    return buckets.map((bucket, week) => {
      const items = [...bucket.values()].sort((a, b) => {
        const rank = categoryRank(a.category) - categoryRank(b.category);
        return rank || a.canonical.localeCompare(b.canonical, "zh-Hans-CN");
      });
      return { week, label: "第 " + (week + 1) + " 周", items, total: items.length };
    });
  };

  function csvCell(value) {
    const text = String(value == null ? "" : value);
    return /[",\r\n]/.test(text) ? '"' + text.replace(/"/g, '""') + '"' : text;
  }

  /* BOM + CRLF so Excel on Windows opens Chinese text correctly. */
  CMF.shoppingToCSV = function (groups, opts) {
    const options = opts || {};
    const checked = new Set(options.checked || []);
    const lines = ["周次,分类,食材,用于菜谱数,菜谱,已买"];
    (groups || []).forEach((group) => {
      group.items.forEach((item) => {
        const key = group.week + ":" + item.canonical;
        lines.push([
          group.label, item.category, item.canonical,
          item.recipes.length, item.recipes.join("、"),
          checked.has(key) ? "是" : "否",
        ].map(csvCell).join(","));
      });
    });
    return "\ufeff" + lines.join("\r\n") + "\r\n";
  };

  CMF.shoppingToText = function (groups, opts) {
    const options = opts || {};
    const checked = new Set(options.checked || []);
    const list = groups || [];
    const total = list.reduce((sum, g) => sum + g.total, 0);
    const lines = [
      "CookMyFridge 采购清单（按周拆分）",
      `共 ${list.length} 周 · ${total} 项`,
    ];
    list.forEach((group) => {
      const label = (options.weekLabels && options.weekLabels[group.week]) || group.label;
      lines.push("", `【${label} · ${group.total} 项】`);
      let category = "";
      group.items.forEach((item) => {
        if (item.category !== category) {
          category = item.category;
          lines.push("  " + category + "：");
        }
        const done = checked.has(group.week + ":" + item.canonical);
        lines.push(
          `  - [${done ? "x" : " "}] ${item.canonical}` +
          `（用于 ${item.recipes.length} 道菜：${item.recipes.join("、")}）`
        );
      });
      if (!group.total) lines.push("  （本周无需额外采购）");
    });
    lines.push("", "已按现有冰箱自动扣除，常备调料不计入；清单仅供备菜参考。");
    return lines.join("\n") + "\n";
  };

  /* Per-person daily totals (one serving of each meal). */
  CMF.weekDayNutrition = function (days, index, recipes) {
    const byId = new Map(recipes.map((r) => [r.id, r]));
    const totals = { kcal: 0, protein: 0, fat: 0, carbs: 0, meals: 0 };
    if (typeof CMF.estimateNutrition !== "function") return totals;
    CMF.weekMeals(days)
      .filter((m) => m.index === index)
      .forEach((m) => {
        const recipe = byId.get(m.recipeId);
        const est = recipe ? CMF.estimateNutrition(recipe) : null;
        if (!est) return;
        totals.kcal += est.perServing.kcal;
        totals.protein += est.perServing.protein;
        totals.fat += est.perServing.fat;
        totals.carbs += est.perServing.carbs;
        totals.meals += 1;
      });
    totals.protein = Math.round(totals.protein * 10) / 10;
    totals.fat = Math.round(totals.fat * 10) / 10;
    totals.carbs = Math.round(totals.carbs * 10) / 10;
    return totals;
  };

  /* --- Balance-driven optimisation --- */

  function dayScoreFrom(day, estimates) {
    if (typeof CMF.scoreBalance !== "function") return 0;
    const totals = { kcal: 0, protein: 0, fat: 0, carbs: 0, meals: 0 };
    MEALS.forEach((meal) => {
      const item = day[meal];
      const est = item && estimates.get(item.recipeId);
      if (!est) return;
      totals.kcal += est.perServing.kcal;
      totals.protein += est.perServing.protein;
      totals.fat += est.perServing.fat;
      totals.carbs += est.perServing.carbs;
      totals.meals += 1;
    });
    return totals.meals ? CMF.scoreBalance(totals, { meals: totals.meals }).score : 0;
  }

  CMF.optimizeMenu = function (days, recipes, fridge, prefs, seed, opts) {
    const result = (days || []).map((d) => ({
      index: d.index, lunch: d.lunch || null, dinner: d.dinner || null,
    }));
    if (typeof CMF.scoreBalance !== "function" || !result.length) {
      return { days: result, before: 0, after: 0, changed: 0 };
    }
    const options = opts || {};
    // Deliberately conservative: only the weakest days, at most a third of the
    // menu. Replacing every single dish would look like score gaming and throw
    // away everything the user hand-picked.
    const target = Number.isFinite(options.target) ? options.target : 70;
    const maxDays = Number.isFinite(options.maxDays)
      ? options.maxDays : Math.ceil(result.length / 3);
    const pool = eligibleRecipes(recipes, prefs);
    const estimates = new Map();
    pool.forEach((r) => {
      const est = typeof CMF.estimateNutrition === "function"
        ? CMF.estimateNutrition(r) : null;
      if (est) estimates.set(r.id, est);
    });
    const average = (menu) => Math.round(
      menu.reduce((sum, d) => sum + dayScoreFrom(d, estimates), 0) / menu.length
    );
    const before = average(result);
    const used = new Set(CMF.weekMeals(result).map((m) => m.title));
    const order = result
      .map((d) => ({ index: d.index, score: dayScoreFrom(d, estimates) }))
      .sort((a, b) => a.score - b.score);
    let changed = 0;

    order.forEach(({ index, score }) => {
      if (changed >= maxDays || score >= target) return;
      const pos = result.findIndex((d) => d.index === index);
      const currentScore = dayScoreFrom(result[pos], estimates);
      let best = null;
      let bestScore = currentScore;
      pool.forEach((r) => {
        if (used.has(r.title)) return;
        MEALS.forEach((meal) => {
          const trial = { ...result[pos], [meal]: brief(r) };
          const score = dayScoreFrom(trial, estimates);
          if (score > bestScore) {
            bestScore = score;
            best = { meal, recipe: r };
          }
        });
      });
      if (!best) return;
      const replaced = result[pos][best.meal];
      if (replaced) used.delete(replaced.title);
      result[pos] = { ...result[pos], [best.meal]: brief(best.recipe) };
      used.add(best.recipe.title);
      changed += 1;
    });

    return { days: result, before, after: average(result), changed, seed: seed || 1 };
  };

  /* --- Calendar export --- */

  function pad(n) {
    return String(n).padStart(2, "0");
  }

  function dateOnly(date) {
    return date.getFullYear() + pad(date.getMonth() + 1) + pad(date.getDate());
  }

  function addDays(date, count) {
    const d = new Date(date.getTime());
    d.setDate(d.getDate() + count);
    return d;
  }

  function atLocalHour(date, hour, tzOffset) {
    // The planner is authored for Asia/Shanghai (UTC+8, no DST). Lunch/dinner
    // are converted to UTC so calendar clients show the intended local time.
    const y = date.getFullYear();
    const m = date.getMonth();
    const d = date.getDate();
    const utc = new Date(Date.UTC(y, m, d, hour - tzOffset, 0, 0));
    return dateOnly(utc) + "T" + pad(utc.getUTCHours()) + pad(utc.getUTCMinutes()) + "00Z";
  }

  function icsEscape(value) {
    return String(value == null ? "" : value)
      .replace(/\\/g, "\\\\")
      .replace(/;/g, "\\;")
      .replace(/,/g, "\\,")
      .replace(/\r?\n/g, "\\n");
  }

  CMF.nextMonday = function (from) {
    const d = from ? new Date(from.getTime ? from.getTime() : from) : new Date();
    d.setHours(0, 0, 0, 0);
    const delta = (8 - d.getDay()) % 7; // Monday -> 0, Sunday -> 1
    return addDays(d, delta);
  };

  CMF.weekStartDate = function (startDate) {
    if (!startDate) return CMF.nextMonday();
    const d = typeof startDate === "string"
      ? new Date(startDate + "T00:00:00")
      : new Date(startDate.getTime ? startDate.getTime() : startDate);
    d.setHours(0, 0, 0, 0);
    return d;
  };

  CMF.weekToICS = function (days, recipes, startDate, opts) {
    const options = opts || {};
    const start = CMF.weekStartDate(options.startDate || startDate);
    const now = options.now ? new Date(options.now) : new Date();
    const tzOffset = Number.isFinite(options.tzOffset) ? options.tzOffset : 8;
    const byId = new Map(recipes.map((r) => [r.id, r]));
    const weeks = CMF.menuWeekCount(days) || 1;
    const stamp =
      now.getUTCFullYear() + pad(now.getUTCMonth() + 1) + pad(now.getUTCDate()) +
      "T" + pad(now.getUTCHours()) + pad(now.getUTCMinutes()) + pad(now.getUTCSeconds()) + "Z";
    const lines = [
      "BEGIN:VCALENDAR",
      "VERSION:2.0",
      "PRODID:-//CookMyFridge//Meal Plan//ZH",
      "CALSCALE:GREGORIAN",
      "METHOD:PUBLISH",
      "X-WR-CALNAME:CookMyFridge " + (weeks > 1 ? weeks + " 周" : "一周") + "菜单",
      "X-WR-CALDESC:午餐 12:00 · 晚餐 18:00 · 数据由本地菜单生成",
      "X-WR-TIMEZONE:Asia/Shanghai",
    ];
    CMF.weekMeals(days).forEach((m) => {
      const date = addDays(start, m.index);
      const hour = m.meal === "lunch" ? 12 : 18;
      const recipe = byId.get(m.recipeId);
      const label = m.meal === "lunch" ? "午餐" : "晚餐";
      const ingredients = recipe
        ? recipe.ingredients.filter((i) => !i.optional).map((i) => i.canonical).join("、")
        : "";
      const est = recipe && typeof CMF.estimateNutrition === "function"
        ? CMF.estimateNutrition(recipe)
        : null;
      const description = [
        "CookMyFridge · 第 " + (Math.floor(m.index / DAYS) + 1) + " 周 · " + label + " · " + m.title,
        ingredients ? "食材：" + ingredients : "",
        est ? "每份约 " + est.perServing.kcal + " kcal（估算）" : "",
        "菜谱：recipe.html?id=" + m.recipeId,
        "别点外卖，让冰箱开饭。",
      ].filter(Boolean).join("\n");
      lines.push(
        "BEGIN:VEVENT",
        "UID:cmf-" + dateOnly(date) + "-" + m.meal + "-" + m.recipeId + "@cookmyfridge",
        "DTSTAMP:" + stamp,
        "DTSTART:" + atLocalHour(date, hour, tzOffset),
        "DTEND:" + atLocalHour(date, hour + 1, tzOffset),
        "SUMMARY:" + icsEscape("🍳 " + label + " · " + m.title),
        "DESCRIPTION:" + icsEscape(description),
        "LOCATION:" + icsEscape("我的厨房"),
        "END:VEVENT"
      );
    });
    lines.push("END:VCALENDAR");
    return lines.join("\r\n") + "\r\n";
  };
  CMF.menuToICS = CMF.weekToICS;

  CMF.weekToText = function (days, startDate) {
    const start = CMF.weekStartDate(startDate);
    const list = days || [];
    const weeks = CMF.menuWeekCount(list) || 1;
    const end = addDays(start, weeks * DAYS - 1);
    const fmt = (d) => (d.getMonth() + 1) + "/" + d.getDate();
    const header =
      "CookMyFridge " + (weeks > 1 ? weeks + " 周" : "一周") + "菜单（" +
      fmt(start) + " – " + fmt(end) + "）\n";
    const dayLine = (d) => {
      const label = CMF.WEEKDAY_LABELS[d.index % DAYS] || WEEKDAYS[addDays(start, d.index).getDay()];
      return (
        "\n" + label + "（" + fmt(addDays(start, d.index)) + "）\n" +
        "  午餐：" + (d.lunch ? d.lunch.title : "待安排") + "\n" +
        "  晚餐：" + (d.dinner ? d.dinner.title : "待安排")
      );
    };
    let body = "";
    for (let w = 0; w < weeks; w += 1) {
      const chunk = list.filter((d) => Math.floor(d.index / DAYS) === w);
      if (!chunk.length) continue;
      if (weeks > 1) {
        body += "\n第 " + (w + 1) + " 周（" + fmt(addDays(start, w * DAYS)) +
          " – " + fmt(addDays(start, w * DAYS + DAYS - 1)) + "）\n";
      }
      body += chunk.map(dayLine).join("");
    }
    return header + body + "\n\n别点外卖，让冰箱开饭。\n";
  };
  CMF.menuToText = CMF.weekToText;
})();

;
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

;
/* Fridge clean-out planner: greedy set-cover that maximizes fridge usage.
   Pure logic, no DOM access. */
(function () {
  "use strict";

  const CMF = window.CMF;

  CMF.cleanoutPlan = function (recipes, fridge, opts) {
    const options = opts || {};
    const maxRecipes = options.maxRecipes || 4;
    const maxExtra = options.maxExtra == null ? 3 : options.maxExtra;
    const urgentSet = new Set(options.urgent || []);
    const URGENT_WEIGHT = 3;
    const fridgeSet = new Set(fridge);
    const remaining = new Set(fridge);
    const selected = [];
    const usedTitles = new Set();

    function score(recipe) {
      const m = CMF.matchRecipe(recipe, fridgeSet);
      const newCovered = m.matched.filter((c) => remaining.has(c));
      const urgentCovered = newCovered.filter((c) => urgentSet.has(c));
      // Urgent items weigh more so expiring ingredients are cleared first.
      const weightedBenefit =
        newCovered.length + urgentCovered.length * (URGENT_WEIGHT - 1);
      return {
        m,
        newCovered,
        urgentCovered,
        benefit: newCovered.length,
        weightedBenefit,
        cost: m.missingCount,
      };
    }

    while (selected.length < maxRecipes) {
      let best = null;
      let bestScore = null;
      recipes.forEach((r) => {
        if (usedTitles.has(r.title)) return;
        const s = score(r);
        if (s.benefit === 0) return;
        if (s.cost > maxExtra) return;
        const ratio = s.weightedBenefit / (s.cost + 1);
        const key = [ratio, s.weightedBenefit, -s.cost];
        if (
          bestScore === null ||
          key[0] > bestScore[0] ||
          (key[0] === bestScore[0] &&
            (key[1] > bestScore[1] ||
              (key[1] === bestScore[1] && key[2] > bestScore[2])))
        ) {
          best = r;
          bestScore = key;
        }
      });
      if (!best) break;
      const s = score(best);
      s.newCovered.forEach((c) => remaining.delete(c));
      usedTitles.add(best.title);
      selected.push({
        recipeId: best.id,
        title: best.title,
        addedCoverage: s.newCovered,
        urgentCovered: s.urgentCovered,
        missing: s.m.missing,
      });
    }

    const covered = fridge.filter((c) => !remaining.has(c));
    const shoppingMap = new Map();
    selected.forEach((s) => {
      s.missing.forEach((c) => {
        if (!shoppingMap.has(c)) shoppingMap.set(c, []);
        shoppingMap.get(c).push(s.title);
      });
    });

    return {
      selected,
      coveredCount: covered.length,
      totalFridge: fridge.length,
      unusedFridge: [...remaining].sort(),
      shopping: [...shoppingMap.keys()].sort().map((c) => ({
        canonical: c,
        recipes: shoppingMap.get(c),
      })),
    };
  };
})();

;
/* Minimal, dependency-free QR Code encoder (byte mode, EC level M, v1-v40).
   Implements ISO/IEC 18004 bitstream + Reed-Solomon + matrix layout so the
   share card and the sync panel can carry a scannable link without any
   network request. The full v1-v40 range matters for sync links: a real
   fridge snapshot is 400-600 bytes, well beyond the 213-byte v10 limit.
   Public API: qrMatrix(text, opts), qrCapacity(version), drawQR(ctx, ...). */
(function () {
  "use strict";

  const CMF = window.CMF;
  const MIN_VERSION = 1;
  const MAX_VERSION = 40;

  // EC level M tables (ISO/IEC 18004). Index = version.
  // Verified against the segno reference tables for every version 1-40.
  const ECC_PER_BLOCK = [
    0, 10, 16, 26, 18, 24, 16, 18, 22, 22,
    26, 30, 22, 22, 24, 24, 28, 28, 26, 26,
    26, 26, 28, 28, 28, 28, 28, 28, 28, 28,
    28, 28, 28, 28, 28, 28, 28, 28, 28, 28,
    28,
  ];
  const NUM_BLOCKS = [
    0, 1, 1, 1, 2, 2, 4, 4, 4, 5,
    5, 5, 8, 9, 9, 10, 10, 11, 13, 14,
    16, 17, 17, 18, 20, 21, 23, 25, 26, 28,
    29, 31, 33, 35, 37, 38, 40, 43, 45, 47,
    49,
  ];
  const RAW_CODEWORDS = [
    0, 26, 44, 70, 100, 134, 172, 196, 242, 292,
    346, 404, 466, 532, 581, 655, 733, 815, 901, 991,
    1085, 1156, 1258, 1364, 1474, 1588, 1706, 1828, 1921, 2051,
    2185, 2323, 2465, 2611, 2761, 2876, 3034, 3196, 3362, 3532,
    3706,
  ];
  // Index = version (0 and 1 are placeholders: v1 has no alignment pattern).
  // v32 is the spec's special case; it cannot be derived from the step formula.
  const ALIGN_CENTERS = [
    [], [],
    [6, 18], [6, 22], [6, 26], [6, 30], [6, 34],
    [6, 22, 38], [6, 24, 42], [6, 26, 46], [6, 28, 50],
    [6, 30, 54], [6, 32, 58], [6, 34, 62],
    [6, 26, 46, 66], [6, 26, 48, 70], [6, 26, 50, 74],
    [6, 30, 54, 78], [6, 30, 56, 82], [6, 30, 58, 86],
    [6, 34, 62, 90],
    [6, 28, 50, 72, 94], [6, 26, 50, 74, 98], [6, 30, 54, 78, 102],
    [6, 28, 54, 80, 106], [6, 32, 58, 84, 110], [6, 30, 58, 86, 114],
    [6, 34, 62, 90, 118],
    [6, 26, 50, 74, 98, 122], [6, 30, 54, 78, 102, 126],
    [6, 26, 52, 78, 104, 130], [6, 30, 56, 82, 108, 134],
    [6, 34, 60, 86, 112, 138], [6, 30, 58, 86, 114, 142],
    [6, 34, 62, 90, 118, 146],
    [6, 30, 54, 78, 102, 126, 150], [6, 24, 50, 76, 102, 128, 154],
    [6, 28, 54, 80, 106, 132, 158], [6, 32, 58, 84, 110, 136, 162],
    [6, 26, 54, 82, 110, 138, 166], [6, 30, 58, 86, 114, 142, 170],
  ];

  function utf8Bytes(text) {
    const out = [];
    for (let i = 0; i < text.length; i += 1) {
      let cp = text.charCodeAt(i);
      if (cp >= 0xd800 && cp <= 0xdbff && i + 1 < text.length) {
        const low = text.charCodeAt(i + 1);
        if (low >= 0xdc00 && low <= 0xdfff) {
          cp = 0x10000 + ((cp - 0xd800) << 10) + (low - 0xdc00);
          i += 1;
        }
      }
      if (cp < 0x80) out.push(cp);
      else if (cp < 0x800) out.push(0xc0 | (cp >> 6), 0x80 | (cp & 63));
      else if (cp < 0x10000) {
        out.push(0xe0 | (cp >> 12), 0x80 | ((cp >> 6) & 63), 0x80 | (cp & 63));
      } else {
        out.push(
          0xf0 | (cp >> 18), 0x80 | ((cp >> 12) & 63),
          0x80 | ((cp >> 6) & 63), 0x80 | (cp & 63)
        );
      }
    }
    return out;
  }

  /* --- GF(256) arithmetic, primitive polynomial x^8+x^4+x^3+x^2+1 --- */
  function gfMul(x, y) {
    let z = 0;
    for (let i = 7; i >= 0; i -= 1) {
      z = (z << 1) ^ ((z >>> 7) * 0x11d);
      z ^= ((y >>> i) & 1) * x;
    }
    return z & 0xff;
  }

  function rsDivisor(degree) {
    const result = new Array(degree).fill(0);
    result[degree - 1] = 1;
    let root = 1;
    for (let i = 0; i < degree; i += 1) {
      for (let j = 0; j < result.length; j += 1) {
        result[j] = gfMul(result[j], root);
        if (j + 1 < result.length) result[j] ^= result[j + 1];
      }
      root = gfMul(root, 0x02);
    }
    return result;
  }

  function rsRemainder(data, divisor) {
    const result = divisor.map(() => 0);
    data.forEach((b) => {
      const factor = b ^ result.shift();
      result.push(0);
      divisor.forEach((coef, i) => {
        result[i] ^= gfMul(coef, factor);
      });
    });
    return result;
  }

  function dataCodewordCount(version) {
    return RAW_CODEWORDS[version] - ECC_PER_BLOCK[version] * NUM_BLOCKS[version];
  }

  CMF.qrCapacity = function (version) {
    if (!Number.isInteger(version) || version < MIN_VERSION || version > MAX_VERSION) return 0;
    const header = 4 + (version <= 9 ? 8 : 16);
    return Math.floor((dataCodewordCount(version) * 8 - header) / 8);
  };

  function appendBits(bits, value, length) {
    for (let i = length - 1; i >= 0; i -= 1) bits.push((value >>> i) & 1);
  }

  function dataCodewords(bytes, version) {
    const capacity = dataCodewordCount(version) * 8;
    const bits = [];
    appendBits(bits, 0x4, 4); // byte mode
    appendBits(bits, bytes.length, version <= 9 ? 8 : 16);
    bytes.forEach((b) => appendBits(bits, b, 8));
    const terminator = Math.min(4, capacity - bits.length);
    for (let i = 0; i < terminator; i += 1) bits.push(0);
    while (bits.length % 8 !== 0) bits.push(0);
    for (let i = 0; bits.length < capacity; i += 1) {
      appendBits(bits, i % 2 === 0 ? 0xec : 0x11, 8);
    }
    const out = [];
    for (let i = 0; i < bits.length; i += 8) {
      let byte = 0;
      for (let j = 0; j < 8; j += 1) byte = (byte << 1) | bits[i + j];
      out.push(byte);
    }
    return out;
  }

  function interleave(data, version) {
    const numBlocks = NUM_BLOCKS[version];
    const eccLen = ECC_PER_BLOCK[version];
    const raw = RAW_CODEWORDS[version];
    const numShortBlocks = numBlocks - (raw % numBlocks);
    const shortBlockLen = Math.floor(raw / numBlocks);
    const shortDataLen = shortBlockLen - eccLen;
    const divisor = rsDivisor(eccLen);
    const blocks = [];
    let cursor = 0;
    for (let i = 0; i < numBlocks; i += 1) {
      const length = shortDataLen + (i < numShortBlocks ? 0 : 1);
      const chunk = data.slice(cursor, cursor + length);
      cursor += length;
      const ecc = rsRemainder(chunk, divisor);
      if (i < numShortBlocks) chunk.push(0); // align column widths
      blocks.push(chunk.concat(ecc));
    }
    const result = [];
    for (let i = 0; i < blocks[0].length; i += 1) {
      blocks.forEach((block, j) => {
        if (i !== shortDataLen || j >= numShortBlocks) result.push(block[i]);
      });
    }
    return result;
  }

  function maskBit(mask, x, y) {
    switch (mask) {
      case 0: return (x + y) % 2 === 0;
      case 1: return y % 2 === 0;
      case 2: return x % 3 === 0;
      case 3: return (x + y) % 3 === 0;
      case 4: return (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0;
      case 5: return ((x * y) % 2) + ((x * y) % 3) === 0;
      case 6: return (((x * y) % 2) + ((x * y) % 3)) % 2 === 0;
      case 7: return (((x + y) % 2) + ((x * y) % 3)) % 2 === 0;
      default: return false;
    }
  }

  function buildMatrix(version, codewords, forcedMask) {
    const size = version * 4 + 17;
    const modules = Array.from({ length: size }, () => new Array(size).fill(false));
    const isFunction = Array.from({ length: size }, () => new Array(size).fill(false));

    function setFunction(x, y, dark) {
      if (x < 0 || y < 0 || x >= size || y >= size) return;
      modules[y][x] = !!dark;
      isFunction[y][x] = true;
    }

    function finder(cx, cy) {
      for (let dy = -4; dy <= 4; dy += 1) {
        for (let dx = -4; dx <= 4; dx += 1) {
          const dist = Math.max(Math.abs(dx), Math.abs(dy));
          setFunction(cx + dx, cy + dy, dist !== 2 && dist !== 4);
        }
      }
    }
    // Timing first: the three finder patterns (drawn afterwards) overwrite
    // the modules where they overlap column/row 6. Reversing this order
    // breaks the finder corners and no decoder can even locate the symbol.
    for (let i = 0; i < size; i += 1) {
      setFunction(6, i, i % 2 === 0);
      setFunction(i, 6, i % 2 === 0);
    }
    finder(3, 3);
    finder(size - 4, 3);
    finder(3, size - 4);

    const centers = ALIGN_CENTERS[version];
    const last = centers.length - 1;
    centers.forEach((cy, aj) => {
      centers.forEach((cx, ai) => {
        if ((ai === 0 && aj === 0) || (ai === 0 && aj === last) ||
            (ai === last && aj === 0)) return;
        for (let dy = -2; dy <= 2; dy += 1) {
          for (let dx = -2; dx <= 2; dx += 1) {
            setFunction(cx + dx, cy + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
          }
        }
      });
    });

    function drawFormat(mask) {
      const data = (0 << 3) | mask; // EC level M = 00
      let rem = data;
      for (let i = 0; i < 10; i += 1) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
      const bits = ((data << 10) | rem) ^ 0x5412;
      const bit = (i) => ((bits >>> i) & 1) !== 0;
      for (let i = 0; i <= 5; i += 1) setFunction(8, i, bit(i));
      setFunction(8, 7, bit(6));
      setFunction(8, 8, bit(7));
      setFunction(7, 8, bit(8));
      for (let i = 9; i < 15; i += 1) setFunction(14 - i, 8, bit(i));
      for (let i = 0; i < 8; i += 1) setFunction(size - 1 - i, 8, bit(i));
      for (let i = 8; i < 15; i += 1) setFunction(8, size - 15 + i, bit(i));
      setFunction(8, size - 8, true); // fixed dark module
    }

    function drawVersion() {
      if (version < 7) return;
      let rem = version;
      for (let i = 0; i < 12; i += 1) rem = (rem << 1) ^ ((rem >>> 11) * 0x1f25);
      const bits = (version << 12) | rem;
      for (let i = 0; i < 18; i += 1) {
        const dark = ((bits >>> i) & 1) !== 0;
        const a = size - 11 + (i % 3);
        const b = Math.floor(i / 3);
        setFunction(a, b, dark);
        setFunction(b, a, dark);
      }
    }

    drawFormat(0);
    drawVersion();

    let bitIndex = 0;
    for (let right = size - 1; right >= 1; right -= 2) {
      if (right === 6) right = 5; // skip the vertical timing column
      for (let vert = 0; vert < size; vert += 1) {
        for (let j = 0; j < 2; j += 1) {
          const x = right - j;
          const upward = ((right + 1) & 2) === 0;
          const y = upward ? size - 1 - vert : vert;
          if (!isFunction[y][x] && bitIndex < codewords.length * 8) {
            modules[y][x] = ((codewords[bitIndex >>> 3] >>> (7 - (bitIndex & 7))) & 1) !== 0;
            bitIndex += 1;
          }
        }
      }
    }

    function applyMask(mask) {
      for (let y = 0; y < size; y += 1) {
        for (let x = 0; x < size; x += 1) {
          if (!isFunction[y][x] && maskBit(mask, x, y)) {
            modules[y][x] = !modules[y][x];
          }
        }
      }
    }

    function rowString(y) {
      return modules[y].map((v) => (v ? "1" : "0")).join("");
    }
    function colString(x) {
      let s = "";
      for (let y = 0; y < size; y += 1) s += modules[y][x] ? "1" : "0";
      return s;
    }
    function countOccurrences(haystack, needle) {
      let count = 0;
      let pos = 0;
      for (;;) {
        const found = haystack.indexOf(needle, pos);
        if (found < 0) return count;
        count += 1;
        pos = found + 1;
      }
    }
    function penalty() {
      let score = 0;
      // Rule 1: runs of five or more equal-colour modules.
      for (let axis = 0; axis < 2; axis += 1) {
        for (let line = 0; line < size; line += 1) {
          const s = axis === 0 ? rowString(line) : colString(line);
          let run = 1;
          for (let i = 1; i < size; i += 1) {
            if (s[i] === s[i - 1]) {
              run += 1;
              if (run === 5) score += 3;
              else if (run > 5) score += 1;
            } else run = 1;
          }
        }
      }
      // Rule 2: 2x2 blocks of one colour.
      for (let y = 0; y < size - 1; y += 1) {
        for (let x = 0; x < size - 1; x += 1) {
          const c = modules[y][x];
          if (c === modules[y][x + 1] && c === modules[y + 1][x] &&
              c === modules[y + 1][x + 1]) score += 3;
        }
      }
      // Rule 3: finder-like 1:1:3:1:1 patterns with four light modules.
      const pat1 = "10111010000";
      const pat2 = "00001011101";
      for (let axis = 0; axis < 2; axis += 1) {
        for (let line = 0; line < size; line += 1) {
          const s = "0000" + (axis === 0 ? rowString(line) : colString(line)) + "0000";
          score += 40 * (countOccurrences(s, pat1) + countOccurrences(s, pat2));
        }
      }
      // Rule 4: deviation from 50% dark modules.
      let dark = 0;
      for (let y = 0; y < size; y += 1) {
        for (let x = 0; x < size; x += 1) if (modules[y][x]) dark += 1;
      }
      const total = size * size;
      score += (Math.ceil(Math.abs(dark * 20 - total * 10) / total) - 1) * 10;
      return score;
    }

    let bestMask = 0;
    if (Number.isInteger(forcedMask) && forcedMask >= 0 && forcedMask <= 7) {
      bestMask = forcedMask;
    } else {
      let min = Infinity;
      for (let mask = 0; mask < 8; mask += 1) {
        applyMask(mask);
        drawFormat(mask);
        const p = penalty();
        if (p < min) {
          min = p;
          bestMask = mask;
        }
        applyMask(mask); // undo
      }
    }
    drawFormat(bestMask);
    applyMask(bestMask);
    return { size, version, mask: bestMask, modules, isFunction, codewords };
  }

  // Exposed so harnesses can re-extract codewords from a reference matrix and
  // assert that every version's alignment patterns land in function modules.
  CMF.qrAlignmentCenters = ALIGN_CENTERS;

  /* Returns {size, version, mask, modules: boolean[][], codewords, ecc}. */
  CMF.qrMatrix = function (text, opts) {
    const options = opts || {};
    const bytes = utf8Bytes(String(text == null ? "" : text));
    let version = 0;
    for (let v = MIN_VERSION; v <= MAX_VERSION; v += 1) {
      if (CMF.qrCapacity(v) >= bytes.length) {
        version = v;
        break;
      }
    }
    if (!version) {
      throw new Error("QR payload too long: " + bytes.length + " bytes (max " +
        CMF.qrCapacity(MAX_VERSION) + ")");
    }
    const min = Math.max(MIN_VERSION, Math.min(MAX_VERSION, Number(options.minVersion) || 1));
    version = Math.max(version, min);
    const data = dataCodewords(bytes, version);
    const codewords = interleave(data, version);
    const matrix = buildMatrix(version, codewords, options.mask);
    return {
      size: matrix.size,
      version: matrix.version,
      mask: matrix.mask,
      modules: matrix.modules,
      isFunction: matrix.isFunction,
      codewords: matrix.codewords,
      bytes: bytes.length,
      ecc: "M",
    };
  };

  /* Draw into an existing CanvasRenderingContext2D. Returns geometry so a
     headless harness can assert cell size and dark-module count. */
  CMF.drawQR = function (ctx, text, x, y, boxSize, opts) {
    const options = opts || {};
    const qr = CMF.qrMatrix(text, options);
    const quiet = Number.isFinite(options.quiet) ? options.quiet : 4;
    const total = qr.size + quiet * 2;
    const cell = Math.max(1, Math.floor(boxSize / total));
    const actual = cell * total;
    const left = x + Math.floor((boxSize - actual) / 2);
    const top = y + Math.floor((boxSize - actual) / 2);
    ctx.fillStyle = options.light || "#ffffff";
    ctx.fillRect(left, top, actual, actual);
    ctx.fillStyle = options.dark || "#2c2620";
    for (let r = 0; r < qr.size; r += 1) {
      for (let c = 0; c < qr.size; c += 1) {
        if (qr.modules[r][c]) {
          ctx.fillRect(left + (c + quiet) * cell, top + (r + quiet) * cell, cell, cell);
        }
      }
    }
    return {
      x: left, y: top, size: actual, cell,
      version: qr.version, mask: qr.mask, modules: qr.size,
    };
  };
})();

;
/* Recipe share card: draw a ready-to-post PNG with the Canvas 2D API.
   All drawing goes through a small set of primitives so a headless harness can
   assert the exact text that ends up on the card without a real browser. */
(function () {
  "use strict";

  const CMF = window.CMF;
  const WIDTH = 800;
  const HEIGHT = 1200;
  const FONT = '"PingFang SC", "Microsoft YaHei", "Segoe UI", sans-serif';

  const COLORS = {
    bg: "#faf6ef",
    brand: "#e8552f",
    brandDark: "#c9421f",
    amber: "#f4a73d",
    ink: "#2c2620",
    soft: "#6f655b",
    line: "#e6dccb",
    card: "#fffdf9",
    white: "#ffffff",
    green: "#4f9d5b",
  };

  function font(ctx, size, weight) {
    ctx.font = `${weight || 400} ${size}px ${FONT}`;
  }

  /* Character-count wrapping keeps the layout deterministic across platforms
     (no measureText dependency and no font-metric surprises in headless tests). */
  function wrap(text, maxChars, maxLines) {
    const chars = Array.from(String(text || ""));
    const lines = [];
    let current = "";
    chars.forEach((ch) => {
      current += ch;
      if (current.length >= maxChars) {
        lines.push(current);
        current = "";
      }
    });
    if (current) lines.push(current);
    if (!lines.length) lines.push("");
    if (lines.length > maxLines) {
      const kept = lines.slice(0, maxLines);
      kept[maxLines - 1] = kept[maxLines - 1].slice(0, maxChars - 1) + "…";
      return kept;
    }
    return lines;
  }

  function text(ctx, value, x, y, size, color, weight, maxWidth) {
    font(ctx, size, weight);
    ctx.fillStyle = color;
    if (maxWidth) ctx.fillText(value, x, y, maxWidth);
    else ctx.fillText(value, x, y);
  }

  function rect(ctx, x, y, w, h, color) {
    ctx.fillStyle = color;
    ctx.fillRect(x, y, w, h);
  }

  CMF.shareText = function (recipe) {
    if (!recipe) return "";
    const lines = [
      "🍳 " + recipe.title + " · CookMyFridge",
      `⏱ ${recipe.time_minutes} 分钟 · 🎯 ${recipe.difficulty} · 🍳 ${(recipe.methods || []).join("/")}`,
      "",
      "食材：",
      ...(recipe.ingredients || []).map(
        (i) => `· ${i.canonical} ${i.amount || ""}`.trim() + (i.optional ? "（可选）" : "")
      ),
    ];
    const est = CMF.estimateNutrition ? CMF.estimateNutrition(recipe) : null;
    if (est) {
      lines.push("");
      lines.push(
        `营养估算（每份，约）：${est.perServing.kcal} kcal · 蛋白 ${est.perServing.protein} g · 脂肪 ${est.perServing.fat} g · 碳水 ${est.perServing.carbs} g`
      );
    }
    if (recipe.is_ai_generated) lines.push("AI 创意菜，未经过人工实测。");
    lines.push("");
    lines.push("别点外卖，让冰箱开饭。数据仅供参考，不能替代食品标签与专业建议。");
    return lines.join("\n");
  };

  CMF.shareFileName = function (recipe) {
    const safe = String((recipe && recipe.title) || "recipe")
      .replace(/[\\/:*?"<>|\s]+/g, "-")
      .slice(0, 40);
    return "CookMyFridge-" + safe + ".png";
  };

  /* Absolute recipe URL for the QR code. Tests inject an explicit URL because
     a headless harness has no `location`. */
  CMF.shareUrl = function (recipe, opts) {
    if (opts && opts.url) return String(opts.url);
    const id = encodeURIComponent((recipe && recipe.id) || "");
    if (typeof location !== "undefined" && location.href) {
      try {
        return new URL("recipe.html?id=" + id, location.href).href;
      } catch (err) { /* fall through */ }
    }
    return "recipe.html?id=" + id;
  };

  /* Returns a canvas. `opts.doc` allows injection in headless tests. */
  CMF.drawShareCanvas = function (recipe, opts) {
    const doc = (opts && opts.doc) || (typeof document !== "undefined" ? document : null);
    if (!doc) throw new Error("canvas requires a document");
    const canvas = doc.createElement("canvas");
    canvas.width = WIDTH;
    canvas.height = HEIGHT;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("canvas 2d context unavailable");

    rect(ctx, 0, 0, WIDTH, HEIGHT, COLORS.bg);
    if (ctx.createLinearGradient) {
      const grad = ctx.createLinearGradient(0, 0, WIDTH, 260);
      grad.addColorStop(0, COLORS.brand);
      grad.addColorStop(1, COLORS.amber);
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, WIDTH, 260);
    } else {
      rect(ctx, 0, 0, WIDTH, 260, COLORS.brand);
    }

    text(ctx, "CookMyFridge", 56, 82, 30, COLORS.white, 700);
    text(ctx, "Don't order. CookMyFridge.", 56, 126, 20, COLORS.white, 400);
    if (recipe.is_ai_generated) {
      rect(ctx, 560, 46, 184, 44, "rgba(255,255,255,0.28)");
      text(ctx, "AI 创意 · 未实测", 574, 77, 18, COLORS.white, 600);
    }
    const first = (recipe.ingredients || [])[0];
    const emoji = first && typeof CMF.emojiOf === "function"
      ? CMF.emojiOf(first.canonical)
      : "🍽️";
    text(ctx, emoji, WIDTH / 2 - 60, 230, 110, COLORS.white, 400);

    const titleLines = wrap(recipe.title, 13, 2);
    titleLines.forEach((line, i) => {
      text(ctx, line, 56, 340 + i * 62, 48, COLORS.ink, 800);
    });
    text(
      ctx,
      `⏱ ${recipe.time_minutes} 分钟   ·   🎯 ${recipe.difficulty}   ·   🍳 ${(recipe.methods || []).join("/")}`,
      56, 480, 23, COLORS.soft, 500
    );
    rect(ctx, 56, 512, WIDTH - 112, 2, COLORS.line);

    text(ctx, "食材与用量", 56, 572, 30, COLORS.brandDark, 700);
    const uses = (recipe.ingredients || []).slice(0, 8);
    uses.forEach((use, i) => {
      const y = 626 + i * 38;
      rect(ctx, 56, y - 22, 8, 8, COLORS.amber);
      const amount = (use.amount || "").trim();
      // maxWidth keeps long ingredient lines clear of the QR code column.
      text(
        ctx,
        `${use.canonical}${amount ? "  " + amount : ""}${use.optional ? "（可选）" : ""}`,
        78, y, 23, COLORS.ink, 400, 480
      );
    });
    if ((recipe.ingredients || []).length > 8) {
      text(ctx, `…等共 ${recipe.ingredients.length} 样食材`, 78, 626 + 8 * 38, 20, COLORS.soft, 400);
    }

    // QR code is optional: a missing qrcode.js or an overlong URL must never
    // break the whole share card.
    if (typeof CMF.drawQR === "function") {
      try {
        const url = typeof CMF.shareLink === "function"
          ? CMF.shareLink(recipe, Object.assign({}, opts, { medium: "qr" }))
          : CMF.shareUrl(recipe, opts);
        if (url) {
          CMF.drawQR(ctx, url, 576, 556, 168, { light: COLORS.white, dark: COLORS.ink });
          text(ctx, "扫码看菜谱", 576, 744, 16, COLORS.soft, 600);
        }
      } catch (err) { /* skip the QR, keep the card */ }
    }

    // Nutrition block
    rect(ctx, 56, 940, WIDTH - 112, 164, COLORS.card);
    rect(ctx, 56, 940, WIDTH - 112, 4, COLORS.brand);
    text(ctx, "营养估算 · 每份", 80, 986, 24, COLORS.brandDark, 700);
    const est = CMF.estimateNutrition ? CMF.estimateNutrition(recipe) : null;
    const cells = est
      ? [
          ["热量", est.perServing.kcal + " kcal"],
          ["蛋白质", est.perServing.protein + " g"],
          ["脂肪", est.perServing.fat + " g"],
          ["碳水", est.perServing.carbs + " g"],
        ]
      : [["热量", "—"], ["蛋白质", "—"], ["脂肪", "—"], ["碳水", "—"]];
    cells.forEach(([label, value], i) => {
      const x = 80 + i * 176;
      text(ctx, label, x, 1028, 18, COLORS.soft, 400);
      text(ctx, value, x, 1066, 26, i === 0 ? COLORS.brandDark : COLORS.ink, 700);
    });
    if (est) {
      text(ctx, `共 ${est.servings} 份 · 估算值，未计烹饪损耗`, 80, 1092, 15, COLORS.soft, 400);
    }

    text(ctx, "别点外卖，让冰箱开饭。", 56, 1132, 22, COLORS.green, 700);
    wrap(est ? est.note : "数据仅供参考。", 46, 2).forEach((line, i) => {
      text(ctx, line, 56, 1160 + i * 21, 13, COLORS.soft, 400);
    });
    return canvas;
  };

  CMF.openShareCard = function (recipe) {
    if (typeof document === "undefined") return false;
    let canvas;
    try {
      canvas = CMF.drawShareCanvas(recipe);
    } catch (err) {
      CMF.toast("当前浏览器不支持生成分享图");
      return false;
    }
    const url = canvas.toDataURL("image/png");
    // Trackable link (UTM + local counter). Falls back to the current page
    // when the sync module is unavailable.
    const shareLink = typeof CMF.shareLink === "function"
      ? CMF.shareLink(recipe, { medium: "card" }) : location.href;
    const track = (kind) => {
      if (typeof CMF.trackShare === "function") CMF.trackShare(kind, recipe.id);
    };
    const overlay = document.createElement("div");
    overlay.className = "modal-overlay share-overlay";
    overlay.innerHTML =
      '<div class="modal share-modal" role="dialog" aria-modal="true" aria-label="分享图">' +
      '<button class="modal-close" aria-label="关闭">×</button>' +
      '<h3>🖼️ 菜谱分享图</h3>' +
      `<img class="share-preview" src="${url}" alt="${CMF.esc(recipe.title)} 分享图">` +
      '<div class="share-actions">' +
      '<button class="btn btn-primary btn-sm" id="share-download">⬇️ 下载 PNG</button>' +
      '<button class="btn btn-sm" id="share-copy">📋 复制文字</button>' +
      '<button class="btn btn-sm" id="share-link">🔗 复制分享链接</button>' +
      '<button class="btn btn-sm" id="share-native">📤 系统分享</button>' +
      "</div>" +
      '<p class="share-note">图片在本地生成，不上传任何数据。分享链接带匿名来源参数，' +
      '可在站点统计中看到来源；本机也记录分享次数。营养数值为估算，仅供参考。</p>' +
      "</div>";

    function close() {
      overlay.remove();
      document.removeEventListener("keydown", onKey);
    }
    function onKey(ev) {
      if (ev.key === "Escape") close();
    }
    overlay.addEventListener("click", (ev) => {
      if (ev.target === overlay || ev.target.closest(".modal-close")) close();
    });
    document.addEventListener("keydown", onKey);
    document.body.appendChild(overlay);

    overlay.querySelector("#share-download").onclick = () => {
      track("png");
      const a = document.createElement("a");
      a.href = url;
      a.download = CMF.shareFileName(recipe);
      document.body.appendChild(a);
      a.click();
      a.remove();
      CMF.toast("分享图已保存");
    };
    overlay.querySelector("#share-copy").onclick = () => {
      track("copy");
      CMF.copyText(CMF.shareText(recipe))
        .then((ok) => CMF.toast(ok ? "菜谱文字已复制" : "复制失败，请手动选择"))
        .catch(() => CMF.toast("复制失败，请手动选择"));
    };
    overlay.querySelector("#share-link").onclick = () => {
      track("link");
      CMF.copyText(shareLink)
        .then((ok) => CMF.toast(ok ? "分享链接已复制" : "复制失败，请手动选择"))
        .catch(() => CMF.toast("复制失败，请手动选择"));
    };
    overlay.querySelector("#share-native").onclick = async () => {
      track("native");
      const resolved = typeof CMF.resolveShareLink === "function"
        ? await CMF.resolveShareLink(shareLink) : shareLink;
      const payload = {
        title: recipe.title + " · CookMyFridge",
        text: CMF.shareText(recipe),
        url: resolved,
      };
      if (navigator.share) {
        try {
          await navigator.share(payload);
          return;
        } catch (err) {
          /* user cancelled or unsupported payload: fall through to copy */
        }
      }
      CMF.copyText(CMF.shareText(recipe)).then(() => CMF.toast("已复制菜谱文字"));
    };
    return true;
  };
})();

;
/* Multi-device sync without a backend, plus trackable share links.

Everything stays on the device: a snapshot of the localStorage state is
serialised with short keys, encoded as a URL-safe sync code, and either copied,
scanned as a QR code, or saved as a JSON file. Opening a link with
#sync=<code> imports it (after explicit user confirmation in the UI).

Share links carry UTM parameters so any site analytics can count them, and a
local counter records share actions. A shortlink endpoint is optional: when
configured, resolveShareLink() asks it for a shorter URL and silently falls
back to the original link when offline. */
(function () {
  "use strict";

  const CMF = window.CMF;
  const B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
  const MAGIC = "S1";
  const SHORT_MAGIC = "Z"; // QR-only: compressed
  const SHORT_RAW_MAGIC = "R"; // QR-only: raw when LZ77 would only add bytes

  // Short keys keep the QR payload small; full names stay in localStorage.
  const KEY_MAP = {
    f: "cmf.fridge",
    h: "cmf.history",
    fb: "cmf.feedback",
    p: "cmf.prefs",
    pl: "cmf.plan",
    fav: "cmf.favorites",
    w: "cmf.week",
    u: "cmf.urgent",
    g: "cmf.goals",
    s: "cmf.shareStats",
    j: "cmf.journal",
    inv: "cmf.inventory",
  };
  const REVERSE = Object.fromEntries(
    Object.entries(KEY_MAP).map(([short, key]) => [key, short])
  );
  const KNOWN = new Set(Object.values(KEY_MAP));
  // Preferences, fridge, favourites, allergens, urgent items and goals.
  // The (potentially 56-meal) menu is deliberately excluded from QR sync.
  const SLIM_KEYS = ["cmf.fridge", "cmf.prefs", "cmf.favorites", "cmf.urgent", "cmf.goals"];

  CMF.SYNC_KEY_MAP = Object.assign({}, KEY_MAP);
  CMF.SYNC_SLIM_KEYS = SLIM_KEYS.slice();
  CMF.SYNC_SHORTLINK_ENDPOINT = "";

  function readRaw(key) {
    try {
      const raw = localStorage.getItem(key);
      if (!raw) return null;
      return JSON.parse(raw);
    } catch (e) {
      return null;
    }
  }

  function writeRaw(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
      return true;
    } catch (e) {
      return false;
    }
  }

  function bytesToCode(bytes) {
    let out = "";
    for (let i = 0; i < bytes.length; i += 3) {
      const a = bytes[i];
      const b = i + 1 < bytes.length ? bytes[i + 1] : undefined;
      const c = i + 2 < bytes.length ? bytes[i + 2] : undefined;
      const n = (a << 16) | ((b || 0) << 8) | (c || 0);
      out += B64[(n >>> 18) & 63] + B64[(n >>> 12) & 63];
      if (b !== undefined) out += B64[(n >>> 6) & 63];
      if (c !== undefined) out += B64[n & 63];
    }
    return out;
  }

  function codeToBytes(text) {
    if (!/^[A-Za-z0-9_-]*$/.test(text)) throw new Error("同步码含非法字符");
    const out = [];
    for (let i = 0; i < text.length; i += 4) {
      const chunk = text.slice(i, i + 4);
      const v = Array.from(chunk, (ch) => B64.indexOf(ch));
      const n = (v[0] << 18) | (v[1] << 12) | ((v[2] || 0) << 6) | (v[3] || 0);
      out.push((n >>> 16) & 255);
      if (chunk.length > 2) out.push((n >>> 8) & 255);
      if (chunk.length > 3) out.push(n & 255);
    }
    return Uint8Array.from(out);
  }

  /* Small synchronous LZ77 (4 KiB window, max 18-byte match). JSON keys and
     repeated ingredient names compress well enough for a QR code, even when
     the encoder has to pick a higher version; no CompressionStream, no async,
     identical output in Node and browsers. */
  function lzCompress(bytes) {
    const out = [];
    let literals = [];
    function flush() {
      for (let i = 0; i < literals.length; i += 127) {
        const chunk = literals.slice(i, i + 127);
        out.push(chunk.length);
        for (const byte of chunk) out.push(byte);
      }
      literals = [];
    }
    let i = 0;
    while (i < bytes.length) {
      const windowStart = Math.max(0, i - 4096);
      const maxLen = Math.min(18, bytes.length - i);
      let bestLen = 0;
      let bestOffset = 0;
      if (maxLen >= 3) {
        for (let start = windowStart; start < i; start += 1) {
          let len = 0;
          while (len < maxLen && bytes[start + len] === bytes[i + len]) len += 1;
          if (len > bestLen) {
            bestLen = len;
            bestOffset = i - start;
            if (bestLen === maxLen) break;
          }
        }
      }
      if (bestLen >= 3) {
        flush();
        out.push(0x80 | (bestLen - 3), (bestOffset >>> 8) & 255, bestOffset & 255);
        i += bestLen;
      } else {
        literals.push(bytes[i]);
        i += 1;
      }
    }
    flush();
    return Uint8Array.from(out);
  }

  function lzDecompress(bytes) {
    const out = [];
    let i = 0;
    while (i < bytes.length) {
      const ctrl = bytes[i];
      i += 1;
      if (ctrl < 0x80) {
        if (i + ctrl > bytes.length) throw new Error("压缩数据不完整");
        for (let k = 0; k < ctrl; k += 1) out.push(bytes[i + k]);
        i += ctrl;
      } else {
        if (ctrl > 0x8f) throw new Error("压缩数据无效");
        if (i + 2 > bytes.length) throw new Error("压缩数据不完整");
        const len = (ctrl & 0x0f) + 3;
        const offset = (bytes[i] << 8) | bytes[i + 1];
        i += 2;
        if (offset <= 0 || offset > out.length) throw new Error("压缩数据无效");
        for (let k = 0; k < len; k += 1) out.push(out[out.length - offset]);
      }
    }
    return Uint8Array.from(out);
  }

  CMF.lzCompress = lzCompress;
  CMF.lzDecompress = lzDecompress;
  CMF.bytesToSyncCode = bytesToCode;
  CMF.syncCodeToBytes = codeToBytes;

  /* Build a snapshot. `slim` limits it to what a QR code can reasonably hold. */
  CMF.syncPayload = function (opts) {
    const options = opts || {};
    const keys = options.slim ? SLIM_KEYS : Object.values(KEY_MAP)
      .filter((key) => key !== "cmf.shareStats");
    const d = {};
    keys.forEach((key) => {
      const value = readRaw(key);
      if (value != null) d[REVERSE[key] || key] = value;
    });
    return {
      v: 1,
      k: "cmf-sync",
      t: new Date().toISOString(),
      slim: Boolean(options.slim),
      d,
    };
  };

  /* Accept our compact shape and the older exportData() backup shape. */
  CMF.normalizeSyncPayload = function (payload) {
    if (!payload || typeof payload !== "object") throw new Error("同步数据格式不正确");
    if (payload.d && typeof payload.d === "object" && !Array.isArray(payload.d) &&
        (payload.k === undefined || payload.k === "cmf-sync") &&
        (payload.v === undefined || payload.v === 1)) {
      // Compact shape used for QR codes: metadata fields are optional.
      return payload;
    }
    if (payload.data && typeof payload.data === "object" && !Array.isArray(payload.data)) {
      return { v: 1, k: "cmf-sync", t: payload.exportedAt || "", slim: false, d: payload.data };
    }
    throw new Error("同步数据格式不正确");
  };

  CMF.syncEncode = function (payload, opts) {
    const clean = CMF.normalizeSyncPayload(payload);
    const raw = new TextEncoder().encode(JSON.stringify(clean));
    const packed = lzCompress(raw);
    const compressed = packed.length < raw.length;
    const short = Boolean(opts && opts.short);
    const magic = short
      ? compressed ? SHORT_MAGIC : SHORT_RAW_MAGIC
      : compressed ? "S1Z" : MAGIC;
    const body = compressed ? packed : raw;
    return magic + "." + bytesToCode(body);
  };

  CMF.syncDecode = function (code) {
    const text = String(code || "").trim().replace(/^#?(?:sync|s)=/, "");
    const dot = text.indexOf(".");
    const magic = dot < 0 ? "" : text.slice(0, dot);
    if (magic !== "S1" && magic !== "S1Z" && magic !== SHORT_MAGIC &&
        magic !== SHORT_RAW_MAGIC) {
      throw new Error("同步码格式不正确（应为 S1. / S1Z. / Z. / R. 开头）");
    }
    let payload;
    try {
      let bytes = codeToBytes(text.slice(dot + 1));
      if (magic === "S1Z" || magic === SHORT_MAGIC) bytes = lzDecompress(bytes);
      payload = JSON.parse(new TextDecoder().decode(bytes));
    } catch (e) {
      throw new Error("同步码已损坏，无法解析");
    }
    return CMF.normalizeSyncPayload(payload);
  };

  CMF.syncFromHash = function (hash) {
    const value = String(hash === undefined
      ? (typeof location !== "undefined" ? location.hash : "")
      : hash).replace(/^#/, "");
    if (!value) return null;
    try {
      const params = new URLSearchParams(value);
      const code = params.get("sync") || params.get("s");
      return code || null;
    } catch (e) {
      return null;
    }
  };

  CMF.syncShareURL = function (code, opts) {
    const options = opts || {};
    let base = options.url;
    if (!base) {
      base = typeof location !== "undefined" && location.href
        ? new URL("index.html", location.href).href
        : "index.html";
    }
    const key = options.short ? "s" : "sync";
    return String(base).split("#")[0] + "#" + key + "=" + code;
  };

  /* QR feasibility check: never let an overlong payload break a share card.
     The encoder covers EC-M v1-v40 (up to 2331 bytes), so a normal fridge
     snapshot fits. `modules` lets the caller size the canvas so dense,
     high-version symbols stay scannable rather than being squeezed to 1px. */
  CMF.syncQRInfo = function (payload, opts) {
    const options = opts || {};
    function attempt(data) {
      const code = CMF.syncEncode(data, { short: true });
      const url = CMF.syncShareURL(code, { ...options, short: true });
      const bytes = new TextEncoder().encode(url).length;
      let version = null;
      let modules = 0;
      if (typeof CMF.qrMatrix === "function") {
        try {
          const qr = CMF.qrMatrix(url);
          version = qr.version;
          modules = qr.size;
        } catch (e) {
          version = null;
        }
      }
      return {
        code, url, bytes, version, modules,
        fits: version !== null, trimmed: false,
      };
    }
    let info = attempt(payload);
    // Only an exceptionally large snapshot exceeds v40/EC-M. In that case
    // drop to the settings that matter most instead of giving up entirely.
    if (!info.fits && !options.noTrim) {
      const d = {};
      const prefs = payload.d.p != null ? payload.d.p : payload.d["cmf.prefs"];
      const goals = payload.d.g != null ? payload.d.g : payload.d["cmf.goals"];
      if (prefs != null) d.p = prefs;
      if (goals != null) {
        const gp = goals.profile || goals.p || goals;
        // One-letter fields are understood by goals.js sanitization.
        d.g = { e: 1, p: {
          s: gp.sex ?? gp.s, a: gp.age ?? gp.a, h: gp.heightCm ?? gp.h,
          w: gp.weightKg ?? gp.w, v: gp.activity ?? gp.v, m: gp.mode ?? gp.m,
          n: gp.people ?? gp.n, c: gp.mealsPerDay ?? gp.c,
        } };
      }
      if (Object.keys(d).length) {
        const smaller = attempt({ d });
        if (smaller.fits) {
          smaller.trimmed = true;
          info = smaller;
        }
      }
    }
    return info;
  };

  function mergeValue(key, incoming) {
    const local = readRaw(key);
    if (key === "cmf.journal") return CMF.mergeJournals(local, incoming);
    if (key === "cmf.inventory") return CMF.mergeInventories(local, incoming);
    if (Array.isArray(incoming) && Array.isArray(local)) {
      // Object entries (e.g. history rows) arrive as fresh references, so a
      // plain Set would never dedupe them and every sync round-trip would add
      // another copy. Dedupe by content instead; history keeps its 50 cap.
      const seen = new Set();
      const merged = [];
      for (const item of [...local, ...incoming]) {
        const id = item !== null && typeof item === "object" ? JSON.stringify(item) : item;
        if (seen.has(id)) continue;
        seen.add(id);
        merged.push(item);
      }
      return key === "cmf.history" ? merged.slice(0, 50) : merged;
    }
    if (incoming && local && typeof incoming === "object" && typeof local === "object" &&
        !Array.isArray(incoming) && !Array.isArray(local)) {
      return { ...local, ...incoming };
    }
    return incoming;
  }

  CMF.applySyncPayload = function (payload, opts) {
    const clean = CMF.normalizeSyncPayload(payload);
    const options = opts || {};
    const mode = options.mode === "merge" ? "merge" : "replace";
    const keys = [];
    const failed = [];
    Object.entries(clean.d).forEach(([short, value]) => {
      const key = short.startsWith("cmf.") ? short : KEY_MAP[short];
      if (!key || !KNOWN.has(key) || value == null) return;
      const next = mode === "merge" ? mergeValue(key, value) : value;
      // A failed write must stay visible: count it separately instead of
      // letting "已同步 N 项" claim work that never persisted.
      if (writeRaw(key, next)) keys.push(key);
      else failed.push(key);
    });
    if (!keys.length && !failed.length) throw new Error("同步数据里没有可用的项目");
    if (!keys.length) throw new Error("写入失败：浏览器存储不可用或已满，本次同步没有落盘任何数据");
    return { count: keys.length, keys, failed, mode, exportedAt: clean.t || "", slim: Boolean(clean.slim) };
  };

  /* Read a #sync= fragment, optionally ask for confirmation, and import. */
  CMF.consumeSyncHash = function (opts) {
    const options = opts || {};
    const code = CMF.syncFromHash(options.hash);
    if (!code) return null;
    const payload = CMF.syncDecode(code);
    if (typeof options.confirm === "function" && !options.confirm(payload)) return null;
    const report = CMF.applySyncPayload(payload, options);
    return { ...report, code };
  };

  /* --- Trackable share links --- */

  CMF.shareLink = function (recipe, opts) {
    const options = opts || {};
    const base = typeof CMF.shareUrl === "function"
      ? CMF.shareUrl(recipe, options) : "";
    if (!base) return "";
    try {
      const fallbackBase = options.baseUrl ||
        (typeof location !== "undefined" && location.href ? location.href : "https://example.com/");
      const url = new URL(base, fallbackBase);
      url.searchParams.set("utm_source", "cmf_share");
      url.searchParams.set("utm_medium", options.medium || "link");
      url.searchParams.set("utm_campaign", "recipe");
      if (recipe && recipe.id) url.searchParams.set("utm_content", recipe.id);
      return url.href;
    } catch (e) {
      return base;
    }
  };

  CMF.getShareStats = function () {
    const value = readRaw("cmf.shareStats");
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      return { total: 0, byKind: {}, byRecipe: {}, lastAt: "" };
    }
    return {
      total: Number(value.total) || 0,
      byKind: value.byKind && typeof value.byKind === "object" ? value.byKind : {},
      byRecipe: value.byRecipe && typeof value.byRecipe === "object" ? value.byRecipe : {},
      lastAt: value.lastAt || "",
    };
  };

  CMF.trackShare = function (kind, recipeId) {
    const stats = CMF.getShareStats();
    const key = String(kind || "link");
    stats.total += 1;
    stats.byKind[key] = (stats.byKind[key] || 0) + 1;
    if (recipeId) {
      const id = String(recipeId);
      stats.byRecipe[id] = (stats.byRecipe[id] || 0) + 1;
    }
    stats.lastAt = new Date().toISOString();
    writeRaw("cmf.shareStats", stats);
    return stats;
  };

  /* Optional shortener. Static hosting has no backend, so the direct UTM
     link is always a valid fallback (including offline). */
  CMF.resolveShareLink = async function (url, opts) {
    const options = opts || {};
    const endpoint = options.endpoint || CMF.SYNC_SHORTLINK_ENDPOINT;
    if (!endpoint || typeof fetch !== "function") return url;
    try {
      const separator = String(endpoint).includes("?") ? "&" : "?";
      const resp = await fetch(String(endpoint) + separator + "url=" + encodeURIComponent(url));
      if (!resp.ok) return url;
      const data = await resp.json();
      return data && typeof data.short === "string" && /^https?:\/\//.test(data.short)
        ? data.short : url;
    } catch (e) {
      return url;
    }
  };

  /* Opening a #sync= link on another device asks before importing. Merge is
     the default so arriving data never silently deletes local favourites. */
  function stripHash() {
    try {
      if (typeof history !== "undefined" && history.replaceState) {
        history.replaceState(null, "", location.pathname + location.search);
      }
    } catch (e) { /* file:// or restricted context: ignore */ }
  }

  if (typeof window !== "undefined" && typeof document !== "undefined" &&
      typeof window.addEventListener === "function") {
    window.addEventListener("load", () => {
      const code = CMF.syncFromHash();
      if (!code) return;
      let payload;
      try {
        payload = CMF.syncDecode(code);
      } catch (e) {
        if (CMF.toast) CMF.toast("同步链接无效：" + e.message);
        stripHash();
        return;
      }
      const count = Object.keys(payload.d).length;
      const message = "检测到来自其他设备的同步数据（" + count + " 项），是否合并到本机？\n" +
        "合并会保留本机已有的冰箱食材与收藏；取消则不做任何改动。";
      if (typeof window.confirm === "function" && !window.confirm(message)) {
        stripHash();
        return;
      }
      try {
        const report = CMF.applySyncPayload(payload, { mode: "merge" });
        stripHash();
        if (CMF.toast) {
          CMF.toast(report.failed && report.failed.length
            ? `已同步 ${report.count} 项，${report.failed.length} 项写入失败（浏览器存储不可用或已满）`
            : "已同步 " + report.count + " 项数据");
        }
        setTimeout(() => location.reload(), 700);
      } catch (e) {
        if (CMF.toast) CMF.toast("同步失败：" + e.message);
        stripHash();
      }
    });
  }
})();

;
/* Weather-aware meal ideas. Online source: Open-Meteo (free, no API key,
   CORS-enabled). Everything degrades to a manual weather picker offline;
   suggestions always come from the shipped recipe dataset. */
(function () {
  "use strict";

  const CMF = (window.CMF = window.CMF || {});
  const CACHE_KEY = "cmf.weatherCache"; // device-local, deliberately outside sync KEYS
  const CACHE_TTL_MS = 30 * 60 * 1000;

  CMF.WEATHER_CITIES = [
    { key: "beijing", label: "北京", lat: 39.9, lon: 116.4 },
    { key: "shanghai", label: "上海", lat: 31.23, lon: 121.47 },
    { key: "guangzhou", label: "广州", lat: 23.13, lon: 113.26 },
    { key: "shenzhen", label: "深圳", lat: 22.54, lon: 114.06 },
    { key: "chengdu", label: "成都", lat: 30.57, lon: 104.07 },
    { key: "hangzhou", label: "杭州", lat: 30.27, lon: 120.16 },
    { key: "wuhan", label: "武汉", lat: 30.59, lon: 114.31 },
    { key: "xian", label: "西安", lat: 34.34, lon: 108.94 },
    { key: "chongqing", label: "重庆", lat: 29.56, lon: 106.55 },
    { key: "shenyang", label: "沈阳", lat: 41.8, lon: 123.43 },
  ];

  /* WMO weather interpretation codes -> precipitation family first,
     then temperature band. Pure and deterministic. */
  CMF.classifyWeather = function (tempC, code) {
    const t = Number(tempC);
    const c = Number(code);
    if ([71, 73, 75, 77, 85, 86].includes(c)) {
      return { kind: "snow", label: "下雪", emoji: "❄️", advice: "下雪天，炖一锅热乎的最舒服", methods: ["炖", "煮", "蒸"], tags: ["下饭"] };
    }
    if ([95, 96, 99].includes(c)) {
      return { kind: "thunder", label: "雷雨", emoji: "⛈️", advice: "雷雨天不出门，电饭煲焖饭最省心", methods: ["电饭煲", "煮", "炖"], tags: ["一人食", "下饭"] };
    }
    if ((c >= 51 && c <= 67) || (c >= 80 && c <= 82) || (c >= 91 && c <= 92)) {
      return { kind: "rain", label: "下雨", emoji: "🌧️", advice: "下雨天，来点暖和的一锅出", methods: ["煮", "炖", "电饭煲"], tags: ["下饭", "一人食"] };
    }
    if (c === 45 || c === 48) {
      return { kind: "fog", label: "雾", emoji: "🌫️", advice: "雾天湿气重，煮点汤水暖暖胃", methods: ["煮", "蒸"], tags: [] };
    }
    if (t <= 5) {
      return { kind: "cold", label: "寒冷", emoji: "🥶", advice: "天冷适合炖煮热乎菜，多补充热量", methods: ["炖", "煮", "蒸"], tags: ["下饭"] };
    }
    if (t <= 15) {
      return { kind: "cool", label: "凉爽", emoji: "🍃", advice: "天气微凉，炒菜煮汤两相宜", methods: ["炒", "煮"], tags: ["快手"] };
    }
    if (t <= 26) {
      return { kind: "mild", label: "舒适", emoji: "😊", advice: "天气正好，想吃什么就做什么", methods: [], tags: [] };
    }
    return { kind: "hot", label: "炎热", emoji: "🥵", advice: "天热没胃口？试试凉拌和免开火", methods: ["凉拌", "免开火", "蒸"], tags: ["低卡", "夏日饮品"] };
  };

  /* Score real recipes against the weather preference. Mild weather has no
     preference: fall back to quickest dishes so the card is never empty. */
  CMF.weatherSuggestions = function (recipes, weather, limit) {
    const n = limit || 3;
    if (!weather) return [];
    const methods = new Set(weather.methods || []);
    const tags = new Set(weather.tags || []);
    const rows = [];
    for (const r of recipes) {
      let score = 0;
      const why = [];
      for (const m of r.methods) {
        if (methods.has(m)) {
          score += 2;
          why.push(m);
        }
      }
      for (const t of r.tags) {
        if (tags.has(t)) {
          score += 1;
          why.push(t);
        }
      }
      if (score > 0) rows.push({ recipe: r, score, reason: why.slice(0, 3).join("·") });
    }
    if (!rows.length) {
      return [...recipes]
        .sort((a, b) => a.time_minutes - b.time_minutes || (a.id < b.id ? -1 : 1))
        .slice(0, n)
        .map((r) => ({ recipe: r, score: 0, reason: "快手省事" }));
    }
    rows.sort(
      (a, b) =>
        b.score - a.score ||
        a.recipe.time_minutes - b.recipe.time_minutes ||
        (a.recipe.id < b.recipe.id ? -1 : 1)
    );
    return rows.slice(0, n);
  };

  CMF.weatherURL = function (lat, lon) {
    return (
      "https://api.open-meteo.com/v1/forecast?latitude=" +
      encodeURIComponent(lat) +
      "&longitude=" +
      encodeURIComponent(lon) +
      "&current=temperature_2m,weather_code&timezone=auto"
    );
  };

  /* fetcher is injectable for headless tests; browsers use fetch + timeout. */
  CMF.fetchCurrentWeather = async function (coords, opts) {
    const options = opts || {};
    const fetcher = options.fetcher || ((url, init) => fetch(url, init));
    const timeout = options.timeoutMs || 8000;
    const controller = typeof AbortController !== "undefined" ? new AbortController() : null;
    const timer = controller ? setTimeout(() => controller.abort(), timeout) : null;
    try {
      const resp = await fetcher(CMF.weatherURL(coords.lat, coords.lon), {
        signal: controller ? controller.signal : undefined,
      });
      if (!resp.ok) throw new Error("天气服务返回 " + resp.status);
      const payload = await resp.json();
      const current = payload && payload.current;
      if (!current || typeof current.temperature_2m !== "number") {
        throw new Error("天气数据格式异常");
      }
      return {
        tempC: current.temperature_2m,
        code: current.weather_code,
        at: new Date().toISOString(),
      };
    } finally {
      if (timer) clearTimeout(timer);
    }
  };

  CMF.readWeatherCache = function () {
    try {
      const raw = localStorage.getItem(CACHE_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch (e) {
      return null;
    }
  };

  CMF.writeWeatherCache = function (value) {
    try {
      localStorage.setItem(CACHE_KEY, JSON.stringify(value));
      return true;
    } catch (e) {
      return false;
    }
  };

  CMF.weatherCacheFresh = function (cache, now) {
    if (!cache || !cache.at || typeof cache.tempC !== "number") return false;
    const base = now ? new Date(now).getTime() : Date.now();
    return base - new Date(cache.at).getTime() < CACHE_TTL_MS;
  };

  CMF.WEATHER_CACHE_KEY = CACHE_KEY;
})();
;
/* Hands-free ingredient input via the browser-native Web Speech API.
   No network service of our own: recognition is provided by the browser.
   Unsupported browsers simply hide the microphone button. */
(function () {
  "use strict";

  const CMF = (window.CMF = window.CMF || {});

  function RecognitionCtor() {
    return window.SpeechRecognition || window.webkitSpeechRecognition || null;
  }

  CMF.voiceSupported = function () {
    return !!RecognitionCtor();
  };

  /* Returns {stop}. Callbacks: onResult(transcript), onState("listening" |
     "idle"), onError(code). All DOM work stays in the page script. */
  CMF.startVoiceInput = function (handlers) {
    const h = handlers || {};
    const Ctor = RecognitionCtor();
    if (!Ctor) {
      if (h.onError) h.onError("not-supported");
      return { stop() {} };
    }
    const rec = new Ctor();
    rec.lang = h.lang || "zh-CN";
    rec.interimResults = false;
    rec.maxAlternatives = 1;
    rec.continuous = false;
    rec.onresult = (ev) => {
      const transcript =
        ev && ev.results && ev.results[0] && ev.results[0][0]
          ? String(ev.results[0][0].transcript || "").trim()
          : "";
      if (transcript && h.onResult) h.onResult(transcript);
    };
    rec.onerror = (ev) => {
      if (h.onError) h.onError(ev && ev.error ? ev.error : "unknown");
    };
    rec.onend = () => {
      if (h.onState) h.onState("idle");
    };
    try {
      rec.start();
      if (h.onState) h.onState("listening");
    } catch (e) {
      if (h.onError) h.onError("start-failed");
      return { stop() {} };
    }
    return {
      stop() {
        try {
          rec.stop();
        } catch (e) {
          /* already ended */
        }
      },
    };
  };
})();
;
/* Packaged-food nutrition lookup against Open Food Facts (free, no key,
   ODbL data). Online-only by design: the UI says so and offline visitors
   get a clear notice instead of a broken card. Results are never merged
   into the recipe catalog. */
(function () {
  "use strict";

  const CMF = (window.CMF = window.CMF || {});
  const RECENT_KEY = "cmf.offRecent"; // device-local, outside sync KEYS
  const OFF_BASE = "https://world.openfoodfacts.org";

  CMF.offSearchURL = function (query) {
    return (
      OFF_BASE +
      "/cgi/search.pl?json=1&search_simple=1&action=process&page_size=8&fields=product_name,product_name_zh,brands,nutriments,nutriscore_grade,code,image_front_url&search_terms=" +
      encodeURIComponent(String(query || "").trim())
    );
  };

  CMF.offBarcodeURL = function (code) {
    return (
      OFF_BASE +
      "/api/v2/product/" +
      encodeURIComponent(code) +
      ".json?fields=product_name,product_name_zh,brands,nutriments,nutriscore_grade,code,image_front_url"
    );
  };

  CMF.validBarcode = function (code) {
    return /^\d{8,14}$/.test(String(code || "").trim());
  };

  /* OFF stores energy in kcal or kJ per 100 g; prefer kcal, convert kJ. */
  CMF.offKcal = function (nutriments) {
    const n = nutriments || {};
    if (typeof n["energy-kcal_100g"] === "number") return Math.round(n["energy-kcal_100g"]);
    if (typeof n["energy_100g"] === "number") return Math.round(n["energy_100g"] / 4.184);
    return null;
  };

  CMF.normalizeOffProduct = function (raw) {
    if (!raw || typeof raw !== "object") return null;
    const n = raw.nutriments || {};
    const kcal = CMF.offKcal(n);
    const num = (v) => (typeof v === "number" ? Math.round(v * 10) / 10 : null);
    const per100g =
      kcal == null && num(n.proteins_100g) == null
        ? null
        : {
            kcal,
            protein: num(n.proteins_100g),
            fat: num(n.fat_100g),
            carbs: num(n.carbohydrates_100g),
          };
    const grade = String(raw.nutriscore_grade || "").toLowerCase();
    const code = String(raw.code || "");
    return {
      name: String(raw.product_name_zh || raw.product_name || raw.generic_name || code || " unnamed").trim(),
      brands: String(raw.brands || "").split(",").map((s) => s.trim()).filter(Boolean).slice(0, 2),
      barcode: code,
      per100g,
      nutriscore: ["a", "b", "c", "d", "e"].includes(grade) ? grade : null,
      image: raw.image_front_url || null,
      url: code ? OFF_BASE + "/product/" + encodeURIComponent(code) : OFF_BASE,
    };
  };

  async function fetchJSON(url, opts) {
    const options = opts || {};
    const fetcher = options.fetcher || ((u, init) => fetch(u, init));
    const timeout = options.timeoutMs || 8000;
    const controller = typeof AbortController !== "undefined" ? new AbortController() : null;
    const timer = controller ? setTimeout(() => controller.abort(), timeout) : null;
    try {
      const resp = await fetcher(url, { signal: controller ? controller.signal : undefined });
      if (!resp.ok) throw new Error("Open Food Facts 返回 " + resp.status);
      return await resp.json();
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  CMF.searchOffProducts = async function (query, opts) {
    const text = String(query || "").trim();
    if (!text) return [];
    const payload = await fetchJSON(CMF.offSearchURL(text), opts);
    const products = Array.isArray(payload && payload.products) ? payload.products : [];
    return products.map(CMF.normalizeOffProduct).filter((p) => p && p.name && p.name !== "unnamed");
  };

  CMF.lookupOffBarcode = async function (code, opts) {
    const clean = String(code || "").trim();
    if (!CMF.validBarcode(clean)) throw new Error("条码应为 8–14 位数字");
    const payload = await fetchJSON(CMF.offBarcodeURL(clean), opts);
    if (!payload || payload.status !== 1 || !payload.product) return null;
    return CMF.normalizeOffProduct(payload.product);
  };

  CMF.offRecent = function () {
    try {
      const raw = localStorage.getItem(RECENT_KEY);
      const list = raw ? JSON.parse(raw) : [];
      return Array.isArray(list) ? list : [];
    } catch (e) {
      return [];
    }
  };

  CMF.offRemember = function (query, name) {
    const text = String(query || "").trim();
    if (!text) return;
    const list = CMF.offRecent().filter((r) => r.query !== text);
    list.unshift({ query: text, name: String(name || ""), at: new Date().toISOString() });
    try {
      localStorage.setItem(RECENT_KEY, JSON.stringify(list.slice(0, 5)));
    } catch (e) {
      /* storage full or blocked; lookup still works */
    }
  };

  CMF.OFF_RECENT_KEY = RECENT_KEY;
})();
;
/* Kitchen conversion tool: spoons/cups ↔ ml ↔ grams, oven temperatures and
   common baking substitutions. Pure offline heuristics, labeled as 近似. */
(function () {
  "use strict";

  const CMF = (window.CMF = window.CMF || {});

  // Empty/null input must not coerce to 0 (a real temperature or volume).
  const toNum = (v) => (v == null || v === "" ? NaN : Number(v));

  const ML_PER_UNIT = {
    ml: 1, 毫升: 1,
    小勺: 5, 茶匙: 5,
    勺: 15, 汤匙: 15, 大勺: 15,
    杯: 240,
    碗: 300,
  };
  CMF.TOOL_UNITS = Object.keys(ML_PER_UNIT).filter((u) => u !== "ml" && u !== "毫升");

  CMF.volumeToMl = function (value, unit) {
    const v = toNum(value);
    const per = ML_PER_UNIT[unit];
    if (!Number.isFinite(v) || v < 0 || per == null) return null;
    return Math.round(v * per * 10) / 10;
  };

  CMF.mlToUnit = function (ml, unit) {
    const v = toNum(ml);
    const per = ML_PER_UNIT[unit];
    if (!Number.isFinite(v) || v < 0 || per == null) return null;
    return Math.round((v / per) * 100) / 100;
  };

  /* g/ml, approximate home-kitchen densities. */
  const DENSITY = {
    面粉: 0.55, 糯米粉: 0.6, 淀粉: 0.6, 面包糠: 0.35,
    白糖: 0.85, 盐: 1.2, 大米: 0.85, 小米: 0.8, 糯米: 0.85, 燕麦: 0.4,
    食用油: 0.92, 花生油: 0.92, 橄榄油: 0.92, 香油: 0.92,
    牛奶: 1.03, 酸奶: 1.05, 豆浆: 1.0, 奶油: 1.0, 椰浆: 1.0,
    清水: 1.0, 高汤: 1.0,
    生抽: 1.15, 老抽: 1.15, 酱油: 1.15, 醋: 1.05, 白醋: 1.05,
    料酒: 1.0, 蚝油: 1.2, 蜂蜜: 1.4, 芝麻酱: 1.1, 花生酱: 1.1,
    番茄酱: 1.1, 沙拉酱: 1.0, 柠檬汁: 1.0, 白酒: 0.95, 鱼露: 1.1,
  };
  CMF.TOOL_DENSITY_INGREDIENTS = Object.keys(DENSITY);

  CMF.gramsForVolume = function (ml, ingredient) {
    const v = toNum(ml);
    if (!Number.isFinite(v) || v < 0) return null;
    const density = DENSITY[ingredient];
    if (density == null) return null; // unknown ingredient: don't guess silently
    return Math.round(v * density * 10) / 10;
  };

  CMF.volumeToGrams = function (value, unit, ingredient) {
    const ml = CMF.volumeToMl(value, unit);
    if (ml == null) return null;
    return CMF.gramsForVolume(ml, ingredient);
  };

  CMF.fToC = function (f) {
    const v = toNum(f);
    if (!Number.isFinite(v)) return null;
    return Math.round(((v - 32) * 5) / 9);
  };

  CMF.cToF = function (c) {
    const v = toNum(c);
    if (!Number.isFinite(v)) return null;
    return Math.round((v * 9) / 5 + 32);
  };

  CMF.BAKING_SUBS = [
    { from: "黄油 100 g", to: "植物油 75 g", note: "饼干/蛋糕可用，酥皮类不建议" },
    { from: "淡奶油 1 杯", to: "牛奶 3/4 杯 + 融化黄油 1/4 杯", note: "只能用于加热做法，不能打发" },
    { from: "泡打粉 1 小勺", to: "小苏打 1/4 小勺 + 柠檬汁/白醋 1/2 小勺", note: "酸碱配对才会蓬松" },
    { from: "玉米淀粉", to: "土豆淀粉 1:1", note: "勾芡通用" },
    { from: "白糖 100 g", to: "蜂蜜 75 g", note: "同时减少配方里约 25 g 液体" },
    { from: "鸡蛋 1 个（面团）", to: "亚麻籽粉 1 勺 + 水 3 勺，静置 5 分钟", note: "纯素替代，蓬松度略降" },
    { from: "牛奶 1 杯", to: "豆浆/燕麦奶 1 杯", note: "多数家常做法可直替" },
    { from: "低筋面粉 100 g", to: "中筋面粉 80 g + 玉米淀粉 20 g", note: "应急配法，口感接近" },
  ];
})();
;
/* Independent batch ledger and explicit recipe inventory use. */
(function () {
  "use strict";

  const CMF = (window.CMF = window.CMF || {});
  const LOCATIONS = { fridge: "冷藏", freezer: "冷冻", pantry: "常温" };
  let mountId = 0;

  function gramsText(value) {
    return CMF.esc(Math.round(value * 10) / 10) + " 克";
  }

  function eligible(batch) {
    return ["fresh", "due", "undated"].includes(CMF.inventoryStatus(batch).key);
  }

  function availableByName(raw) {
    const result = new Map();
    CMF.normalizeInventory(raw).batches.filter(eligible).forEach((batch) => {
      result.set(batch.canonical, (result.get(batch.canonical) || 0) + batch.grams);
    });
    return result;
  }

  function announce(root, text, error) {
    const message = root.querySelector("[data-inventory-message]");
    message.setAttribute("role", error ? "alert" : "status");
    message.setAttribute("aria-live", error ? "assertive" : "polite");
    message.classList.toggle("inventory-error", !!error);
    message.innerHTML = CMF.esc(text);
  }

  function errorText(error) {
    return error && error.message ? error.message : "操作未完成，请检查浏览器存储后重试。";
  }

  function readGrams(input, allowZero) {
    const value = Number(input.value);
    if (!input.value.trim() || !Number.isFinite(value) || value < (allowZero ? 0 : 0.1) ||
        value > 1000000 || Math.abs(value * 10 - Math.round(value * 10)) > 0.000001) {
      input.focus();
      throw new Error("克数须为" + (allowZero ? " 0" : " 0.1") + " 至 1000000 的数字，最多保留 1 位小数。");
    }
    return value;
  }

  function messageHTML() {
    return '<p class="inventory-message" data-inventory-message role="status" aria-live="polite" aria-atomic="true"></p>';
  }

  CMF.mountInventory = function (root, onFridgeChanged) {
    if (!root) return;
    const prefix = "cmf-inventory-" + (++mountId);
    let expected = null;
    let dirty = false;
    root.classList.add("cmf-inventory");
    root.setAttribute("aria-labelledby", prefix + "-title");
    root.innerHTML =
      '<div class="inventory-panel">' +
      `<h2 id="${prefix}-title">批次明细</h2>` +
      '<p class="inventory-note">按批记录剩余克数，与开饭清单分开保存。清空开饭清单不会删除批次。</p>' +
      '<div class="inventory-summary" data-inventory-summary></div>' +
      '<details class="inventory-editor"><summary>添加批次</summary><div data-inventory-editor></div></details>' +
      messageHTML() +
      '<div class="inventory-toolbar">' +
      '<label class="inventory-field"><span>食材名称搜索</span><input type="search" data-inventory-search placeholder="输入名称或同义词"></label>' +
      '<label class="inventory-field"><span>批次状态</span><select data-inventory-filter>' +
      '<option value="active">全部在库</option><option value="due">3 天内到期</option>' +
      '<option value="expired">已过期</option><option value="undated">未填日期</option>' +
      '<option value="empty">已用完</option></select></label></div>' +
      '<p class="inventory-note" data-inventory-count role="status" aria-live="polite"></p>' +
      '<div class="inventory-list-head" aria-hidden="true"><span>食材 / 备注</span><span>剩余克数</span><span>到期 / 状态</span><span>存放</span><span>操作</span></div>' +
      '<ul class="inventory-list" data-inventory-list aria-label="库存批次"></ul>' +
      '<div class="inventory-actions"><button type="button" class="btn btn-sm" data-inventory-add-fridge>未过期在库食材加入开饭清单</button></div>' +
      '<p class="inventory-note inventory-safety">日期只作提醒，不代表可以食用；以包装要求和实际状态为准。没有日期不保证新鲜，过期批次不参与扣减。</p>' +
      '<p class="inventory-note">台账保存在本机；同步合并时，同一批次 ID 以最近修改为准，不是实时共同库存。二维码不含台账。</p>' +
      '</div>';

    const editor = root.querySelector(".inventory-editor");
    const editorBody = root.querySelector("[data-inventory-editor]");
    const search = root.querySelector("[data-inventory-search]");
    const filter = root.querySelector("[data-inventory-filter]");

    function renderEditor(batch) {
      expected = batch ? { ...batch } : null;
      dirty = false;
      const draft = batch || { canonical: "", grams: "", expiresOn: "", location: "fridge", note: "" };
      editor.querySelector("summary").textContent = batch ? "编辑批次" : "添加批次";
      editorBody.innerHTML =
        '<form class="inventory-form" novalidate>' +
        '<div class="inventory-form-grid">' +
        '<label class="inventory-field inventory-name-field"><span>食材名称</span>' +
        `<input name="canonical" list="${prefix}-ingredients" value="${CMF.esc(draft.canonical)}" required placeholder="如：番茄，也可填同义词"></label>` +
        `<datalist id="${prefix}-ingredients">` +
        CMF.allIngredients().map((entry) => `<option value="${CMF.esc(entry.canonical)}"></option>`).join("") +
        '</datalist>' +
        '<label class="inventory-field"><span>剩余克数（克）</span>' +
        `<input name="grams" type="number" inputmode="decimal" min="${batch ? 0 : 0.1}" max="1000000" step="0.1" value="${CMF.esc(draft.grams)}" required></label>` +
        '<label class="inventory-field"><span>到期日期（可不填）</span>' +
        `<input name="expiresOn" type="date" max="9999-12-31" value="${CMF.esc(draft.expiresOn)}"></label>` +
        '<label class="inventory-field"><span>存放位置</span><select name="location">' +
        Object.entries(LOCATIONS).map(([key, label]) =>
          `<option value="${CMF.esc(key)}"${draft.location === key ? " selected" : ""}>${CMF.esc(label)}</option>`
        ).join("") +
        '</select></label>' +
        '<label class="inventory-field inventory-note-field"><span>备注（可不填）</span>' +
        `<textarea name="note" rows="2" maxlength="200" placeholder="如：开封日期、包装说明">${CMF.esc(draft.note)}</textarea></label></div>` +
        '<p class="inventory-note">统一记克数，请按实际称重填写；编辑时填 0 表示已用完。</p>' +
        '<div class="inventory-actions"><button type="submit" class="btn btn-primary btn-sm">' +
        (batch ? '保存修改' : '添加批次') + '</button>' +
        '<button type="button" class="btn btn-sm" data-inventory-cancel>' + (batch ? '取消编辑' : '清空草稿') + '</button></div></form>';
      const form = editorBody.querySelector("form");
      form.oninput = form.onchange = () => { dirty = true; };
      form.querySelector("[data-inventory-cancel]").onclick = () => {
        if (dirty && !window.confirm("放弃当前未保存的批次草稿？")) return;
        renderEditor(null);
        renderList();
        announce(root, "草稿已清空，已重新读取批次；已保存的记录没有改变。");
        editorBody.querySelector('[name="canonical"]').focus();
      };
      form.onsubmit = (event) => {
        event.preventDefault();
        const fields = form.elements;
        let saved;
        try {
          if (!fields.canonical.value.trim()) {
            fields.canonical.focus();
            throw new Error("请填写食材名称，可从提示列表选择或输入同义词。");
          }
          if (!fields.expiresOn.validity.valid) {
            fields.expiresOn.focus();
            throw new Error("请填写有效的到期日期，或留空。");
          }
          const input = {
            canonical: fields.canonical.value,
            grams: readGrams(fields.grams, !!expected),
            expiresOn: fields.expiresOn.value,
            location: fields.location.value,
            note: fields.note.value,
          };
          if (expected) input.id = expected.id;
          saved = CMF.upsertInventoryBatch(input, expected || undefined);
        } catch (error) {
          announce(root, "保存失败：" + errorText(error) + " 草稿已保留；若批次已变更，请取消编辑后重新核对。", true);
          return;
        }
        renderEditor(null);
        renderList();
        announce(root, "已保存「" + saved.canonical + "」，剩余 " + saved.grams + " 克。开饭清单未改变。");
        editorBody.querySelector('[name="canonical"]').focus();
      };
      if (batch) {
        editor.open = true;
        form.elements.canonical.focus();
      }
    }

    function renderList() {
      const raw = CMF.getInventory();
      const batches = CMF.normalizeInventory(raw).batches.filter((batch) => !batch.deleted);
      const summary = CMF.inventorySummary(raw);
      root.querySelector("[data-inventory-summary]").innerHTML =
        `<span>在库 <strong>${CMF.esc(summary.active)}</strong> 批</span>` +
        `<span>3 天内 <strong>${CMF.esc(summary.due)}</strong> 批</span>` +
        `<span>已过期 <strong>${CMF.esc(summary.expired)}</strong> 批</span>` +
        `<span>未填日期 <strong>${CMF.esc(summary.undated)}</strong> 批</span>` +
        `<span>在库合计 <strong>${gramsText(summary.grams)}</strong></span>`;
      const query = search.value.trim().toLocaleLowerCase();
      const normalizedQuery = query ? CMF.normalizeName(query).toLocaleLowerCase() : "";
      const rows = batches.filter((batch) => {
        const key = CMF.inventoryStatus(batch).key;
        const matchesStatus = filter.value === "active" ? batch.grams > 0 : key === filter.value;
        const name = batch.canonical.toLocaleLowerCase();
        return matchesStatus && (!query || name.includes(query) || name.includes(normalizedQuery));
      }).sort((a, b) => (a.expiresOn || "9999-99-99").localeCompare(b.expiresOn || "9999-99-99") ||
        a.canonical.localeCompare(b.canonical, "zh-CN") || a.id.localeCompare(b.id));
      root.querySelector("[data-inventory-count]").innerHTML =
        `显示 ${CMF.esc(rows.length)} 批；全部在库含仍有余量的过期批次，已移除记录不显示。`;
      const list = root.querySelector("[data-inventory-list]");
      list.innerHTML = rows.length ? rows.map((batch, index) => {
        const status = CMF.inventoryStatus(batch);
        return '<li class="inventory-row">' +
          `<div class="inventory-batch-name"><strong>${CMF.esc(batch.canonical)}</strong>` +
          (batch.note ? `<small class="inventory-batch-note">${CMF.esc(batch.note)}</small>` : '') + '</div>' +
          `<div class="inventory-batch-grams">${gramsText(batch.grams)}</div>` +
          '<div class="inventory-expiry">' +
          (batch.expiresOn ? `<time datetime="${CMF.esc(batch.expiresOn)}">${CMF.esc(batch.expiresOn)}</time>` : '<span>未填日期</span>') +
          `<span class="inventory-badge" data-status="${CMF.esc(status.key)}">${CMF.esc(status.key === "fresh" ? "未到期" : status.label)}</span></div>` +
          `<div class="inventory-location">${CMF.esc(LOCATIONS[batch.location])}</div>` +
          '<div class="inventory-row-actions">' +
          `<button type="button" class="btn btn-sm" data-inventory-edit="${index}" aria-label="编辑${CMF.esc(batch.canonical)}批次">编辑</button>` +
          `<button type="button" class="btn btn-sm inventory-remove" data-inventory-remove="${index}" aria-label="移除${CMF.esc(batch.canonical)}批次">移除</button></div></li>`;
      }).join("") : '<li class="inventory-empty">没有符合条件的批次。可以添加批次，或更换筛选条件。</li>';
      list.querySelectorAll("[data-inventory-edit]").forEach((button) => {
        const batch = rows[Number(button.dataset.inventoryEdit)];
        button.onclick = () => {
          if (dirty && !window.confirm("放弃当前未保存的草稿，改为编辑这个批次？")) return;
          renderEditor(batch);
          announce(root, "正在编辑「" + batch.canonical + "」。保存前不会改变库存。");
        };
      });
      list.querySelectorAll("[data-inventory-remove]").forEach((button) => {
        const batch = rows[Number(button.dataset.inventoryRemove)];
        button.onclick = () => {
          if (!window.confirm("确认移除这个批次？台账会保留删除记录，开饭清单不会改变。若正在编辑此批次，其草稿也会清空。")) return;
          try {
            if (CMF.removeInventoryBatch(batch.id, { ...batch }) !== true) throw new Error("批次未能移除，请重试。");
          } catch (error) {
            announce(root, "移除失败：" + errorText(error) + " 草稿已保留。", true);
            return;
          }
          if (expected && expected.id === batch.id) renderEditor(null);
          renderList();
          announce(root, "已移除「" + batch.canonical + "」批次，开饭清单未改变。");
          filter.focus();
        };
      });
    }

    search.oninput = renderList;
    filter.onchange = renderList;
    root.querySelector("[data-inventory-add-fridge]").onclick = () => {
      let text;
      try {
        const names = CMF.normalizeInventory(CMF.getInventory()).batches.filter(eligible).map((batch) => batch.canonical);
        if (!names.length) {
          announce(root, "没有可加入的未过期在库食材；过期、已移除和已用完批次不加入。");
          return;
        }
        const before = CMF.getFridge();
        const next = [...new Set([...before, ...names])];
        if (CMF.setFridge(next) !== true) throw new Error("开饭清单未能保存，请检查浏览器存储后重试。");
        text = "已加入 " + next.filter((name) => !before.includes(name)).length + " 样食材，开饭清单共 " + next.length + " 样；批次数量没有改变。请自行确认食材状态。";
      } catch (error) {
        announce(root, "加入失败：" + errorText(error), true);
        return;
      }
      if (typeof onFridgeChanged === "function") onFridgeChanged();
      announce(root, text);
    };
    renderEditor(null);
    renderList();
    editor.open = !CMF.normalizeInventory(CMF.getInventory()).batches.some((batch) => !batch.deleted);
  };

  CMF.mountRecipeInventory = function (root, recipe, factor) {
    if (!root) return;
    const prefix = "cmf-inventory-use-" + (++mountId);
    const needs = CMF.inventoryRecipeNeeds(recipe, factor);
    const available = availableByName(CMF.getInventory());
    let preview = null;
    let previewRequests = "";
    let receipt = null;
    root.classList.add("cmf-inventory");
    root.setAttribute("aria-labelledby", prefix + "-title");
    root.innerHTML =
      '<div class="inventory-panel inventory-recipe-panel">' +
      `<h2 id="${prefix}-title">库存扣减</h2>` +
      `<p class="inventory-note">按当前 ${CMF.esc(factor)} 倍份量核对整道菜用量。扣减不新增打卡，打卡也不会自动扣减库存。</p>` +
      `<p class="inventory-note" id="${prefix}-help">个、勺等单位换算仅为估算，请确认实际称重。可选食材、未知克数和暂无可扣库存的食材默认不勾选；未知量不会按固定克数扣减。</p>` +
      '<form class="inventory-use-form" novalidate>' +
      `<fieldset class="inventory-use-fields" aria-describedby="${prefix}-help"><legend>选择本次实际使用的食材</legend>` +
      '<ul class="inventory-use-list">' +
      (needs.length ? needs.map((need, index) => {
        const checked = !need.optional && need.grams != null && need.grams > 0 && (available.get(need.canonical) || 0) > 0;
        return `<li class="inventory-use-row" data-use-item="${index}">` +
          '<div><label class="inventory-use-choice">' +
          `<input type="checkbox" class="inventory-use-check"${checked ? " checked" : ""}>` +
          `<span>${CMF.esc(need.canonical)}</span></label>` +
          '<div class="inventory-use-meta">' +
          (need.optional ? '<span>可选 · </span>' : '') +
          (need.grams == null ? '<span>用量待实称 · </span>' : need.estimated ? '<span>估算用量 · </span>' : '') +
          '<span data-use-available></span></div></div>' +
          '<label class="inventory-field inventory-use-amount"><span>扣减克数（克）</span>' +
          `<input type="number" class="inventory-use-grams" min="0.1" max="1000000" step="0.1" inputmode="decimal" value="${CMF.esc(need.grams == null ? "" : need.grams)}" aria-label="${CMF.esc(need.canonical)}扣减克数" placeholder="实称后填写"></label></li>`;
      }).join("") : '<li class="inventory-empty">这道菜没有可核对的食材。</li>') +
      '</ul></fieldset>' +
      '<div class="inventory-actions"><button type="submit" class="btn btn-primary btn-sm" data-use-preview' + (needs.length ? '' : ' disabled') + '>预览扣减</button></div></form>' +
      messageHTML() +
      '<div class="inventory-preview" data-use-result></div>' +
      '<p class="inventory-note inventory-safety">先到期先用，未填日期的批次排最后；过期、已移除及零余量批次不参与扣减。日期不保证食品安全，包装要求与实际状态优先。</p>' +
      '</div>';

    const form = root.querySelector(".inventory-use-form");
    const fields = form.querySelector("fieldset");
    const previewButton = form.querySelector("[data-use-preview]");
    const output = root.querySelector("[data-use-result]");
    const rows = [...form.querySelectorAll("[data-use-item]")];

    function refreshAvailability() {
      const current = availableByName(CMF.getInventory());
      rows.forEach((row, index) => {
        const grams = current.get(needs[index].canonical) || 0;
        row.querySelector("[data-use-available]").innerHTML = grams > 0 ? "未过期记录 " + gramsText(grams) : "暂无可扣库存";
      });
    }

    function readRequests() {
      return rows.filter((row) => row.querySelector(".inventory-use-check").checked).map((row) => ({
        canonical: needs[Number(row.dataset.useItem)].canonical,
        grams: readGrams(row.querySelector(".inventory-use-grams"), false),
      }));
    }

    function clearPreview() {
      const hadPreview = !!preview;
      preview = null;
      previewRequests = "";
      if (!receipt) output.innerHTML = "";
      if (hadPreview) announce(root, "用量已变化，旧预览已清除，请重新预览扣减。");
    }

    form.oninput = form.onchange = clearPreview;

    function recheck(text) {
      preview = null;
      previewRequests = "";
      receipt = null;
      output.innerHTML = "";
      fields.disabled = false;
      previewButton.hidden = false;
      previewButton.disabled = !needs.length;
      rows.forEach((row) => { row.querySelector(".inventory-use-check").checked = false; });
      refreshAvailability();
      announce(root, text);
      if (rows.length) rows[0].querySelector(".inventory-use-check").focus();
    }

    function commit() {
      if (!preview || !preview.ok || receipt) return;
      const total = preview.totalGrams;
      try {
        if (JSON.stringify(readRequests()) !== previewRequests) throw new Error("用量已变化，请重新预览。");
        receipt = CMF.commitInventoryUse(preview);
      } catch (error) {
        clearPreview();
        announce(root, "扣减失败：" + errorText(error) + " 选项与克数已保留，请重新预览。", true);
        return;
      }
      preview = null;
      previewRequests = "";
      fields.disabled = true;
      previewButton.disabled = true;
      previewButton.hidden = true;
      output.innerHTML =
        `<p class="inventory-use-success">已扣减 <strong>${gramsText(total)}</strong>，未新增打卡。</p>` +
        '<div class="inventory-actions"><button type="button" class="btn btn-sm" data-use-undo>撤销本次扣减</button>' +
        '<button type="button" class="btn btn-sm" data-use-recheck>重新核对</button></div>' +
        '<p class="inventory-note">后续库存变动可能使撤销失效；重新核对会开始另一笔扣减，并结束本次撤销入口。</p>';
      announce(root, "库存已扣减；同一预览不能再次提交。");
      refreshAvailability();
      const undo = output.querySelector("[data-use-undo]");
      undo.onclick = () => {
        if (!receipt) return;
        try {
          if (CMF.undoInventoryUse(receipt) !== true) throw new Error("未能撤销，请重试。");
        } catch (error) {
          announce(root, "撤销失败：" + errorText(error) + " 不会覆盖后续库存，请到台账核对。", true);
          return;
        }
        recheck("已撤销本次扣减，打卡不受影响。如需再次扣减，请重新勾选并预览。");
      };
      output.querySelector("[data-use-recheck]").onclick = () => recheck("已开启新一轮核对，请重新勾选要扣减的食材；上一笔扣减仍保留。");
      undo.focus();
    }

    form.onsubmit = (event) => {
      event.preventDefault();
      if (receipt) return;
      clearPreview();
      let snapshot;
      try {
        const requests = readRequests();
        snapshot = CMF.getInventory();
        preview = CMF.previewInventoryUse(snapshot, requests);
        previewRequests = JSON.stringify(requests);
      } catch (error) {
        announce(root, "无法预览：" + errorText(error) + " 选项与克数已保留。", true);
        return;
      }
      if (!preview.requests.length) {
        announce(root, "请先勾选本次使用的食材，并填写实际克数。", true);
        return;
      }
      const byId = new Map(CMF.normalizeInventory(snapshot).batches.map((batch) => [batch.id, batch]));
      output.innerHTML =
        `<h3>扣减预览 <small>${CMF.esc(preview.day)}</small></h3>` +
        '<ul class="inventory-preview-lines">' + preview.lines.map((line) => {
          const allocations = line.allocations.map((allocation) => {
            const batch = byId.get(allocation.id);
            return '<li>' +
              `批次 ${CMF.esc(allocation.id)} · ` +
              (batch ? `${CMF.esc(batch.expiresOn || "未填日期")} · ${CMF.esc(LOCATIONS[batch.location])} · ` : '') +
              gramsText(allocation.grams) + '</li>';
          }).join("");
          return '<li class="inventory-preview-line">' +
            `<div><strong>${CMF.esc(line.canonical)}</strong><span>本次 ${gramsText(line.grams)} / 可扣 ${gramsText(line.available)}</span></div>` +
            (line.missing > 0 ? `<p class="inventory-shortage">短缺 ${gramsText(line.missing)}，本次不能提交。</p>` : '') +
            (line.expiredGrams > 0 ? `<p class="inventory-note">已排除过期 ${gramsText(line.expiredGrams)}</p>` : '') +
            (allocations ? '<details class="inventory-allocations"><summary>查看批次分配（先到期先用）</summary><ul>' + allocations + '</ul></details>' : '') + '</li>';
        }).join("") + '</ul>' +
        `<p>本次合计 <strong>${gramsText(preview.totalGrams)}</strong>；仅扣减所勾选食材。</p>` +
        (preview.ok ? '<button type="button" class="btn btn-primary btn-sm" data-use-commit>确认扣减</button>' : '<p class="inventory-shortage">库存不足，未扣减任何批次。请调整用量或补充台账后重新预览。</p>');
      announce(root, preview.ok ? "预览已生成，尚未扣减。请核对克数和批次后确认。" : "预览发现短缺，未扣减。选项与克数已保留。", !preview.ok);
      const confirmButton = output.querySelector("[data-use-commit]");
      if (confirmButton) confirmButton.onclick = commit;
      refreshAvailability();
    };
    refreshAvailability();
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
      document.removeEventListener("keydown", onKey);
    }
    function onKey(ev) {
      if (ev.key === "Escape") close();
    }
    overlay.addEventListener("click", (ev) => {
      if (ev.target === overlay || ev.target.closest(".modal-close")) close();
    });
    document.addEventListener("keydown", onKey);
    overlay.addEventListener("click", (ev) => {
      const chip = ev.target.closest(".pairing-chip");
      if (chip) {
        close();
        CMF.showIngredientInfo(chip.dataset.name);
      }
    });
    document.body.appendChild(overlay);
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

  /* opts.deferRecipes: the homepage renders its wall from catalog + vocab
     alone and fills recipe-dependent widgets (weather picks) when the
     background recipes.json lands — everyone else awaits recipes as before. */
  CMF.boots = function (active, init, opts) {
    CMF.renderChrome(active);
    const ready = opts && opts.deferRecipes
      ? CMF.preload()
      : Promise.all([CMF.preload(), CMF.preloadRecipes()]);
    ready
      .then(() => {
        CMF.initCatalog();
        if (CMF.buildPairingIndex) CMF.buildPairingIndex(CMF.data.recipes);
        if (init) init();
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
     AI zones here, so fn always sees a complete CMF.data. */
  CMF.onAiReady = function (fn) {
    Promise.all([CMF.preload(), CMF.preloadAI()]).then(fn).catch(() => {});
  };
})();
