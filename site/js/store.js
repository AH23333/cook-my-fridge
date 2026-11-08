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
