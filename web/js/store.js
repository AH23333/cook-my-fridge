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
    corePromise = Promise.all([
      fetchJSON("data/catalog.json"),
      fetchJSON("data/recipes.json"),
      fetchJSON("data/vocab.json"),
    ]).then(([catalog, recipes, vocab]) => {
      d.catalog = catalog;
      d.recipes = recipes;
      d.vocab = vocab;
      return d;
    });
  }

  CMF.preload = function () {
    ensureLoad();
    return corePromise;
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
