/* Data loading and persistent local storage. Exposes window.CMF. */
(function () {
  "use strict";

  const CMF = (window.CMF = window.CMF || {});

  const KEYS = {
    fridge: "cmf.fridge",
    history: "cmf.history",
    feedback: "cmf.feedback",
    prefs: "cmf.prefs",
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

  CMF.getFeedback = () => readJSON(KEYS.feedback, {});
  CMF.setFeedback = (map) => writeJSON(KEYS.feedback, map);

  CMF.getPrefs = () => readJSON(KEYS.prefs, { tags: [] });
  CMF.setPrefs = (prefs) => writeJSON(KEYS.prefs, prefs);

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
