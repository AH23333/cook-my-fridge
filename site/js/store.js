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
  };

  let preloadPromise = null;

  CMF.preload = function () {
    if (preloadPromise) return preloadPromise;
    const d = CMF.data;
    preloadPromise = Promise.all([
      fetchJSON("data/catalog.json"),
      fetchJSON("data/recipes.json"),
      fetchJSON("data/vocab.json"),
      fetchJSON("data/ai/wildcards.json").catch(() => []),
      fetchJSON("data/ai/blindboxes.json").catch(() => []),
      fetchJSON("data/ai/variants.json").catch(() => []),
      fetchJSON("data/ai/ideas.json").catch(() => []),
    ]).then(([catalog, recipes, vocab, wild, blind, variants, ideas]) => {
      d.catalog = catalog;
      d.recipes = recipes;
      d.vocab = vocab;
      d.ai.wildcards = wild;
      d.ai.blindboxes = blind;
      d.ai.variants = variants;
      d.ai.ideas = ideas;
      return d;
    });
    return preloadPromise;
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
