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

  CMF.normalizeTag = function (value) {
    const key = String(value || "").trim();
    return tagAliases[key] || key;
  };

  CMF.allergensOf = function (name) {
    return ingredientMap[name] ? ingredientMap[name].allergens : [];
  };
})();
