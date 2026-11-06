/* Headless harness: load the real frontend catalog/search and run many seeded
   random queries, emitting JSON results for cross-checking against Python. */
const fs = require("fs");
const path = require("path");

const base = process.argv[2];
global.window = {};

function load(rel) {
  const code = fs.readFileSync(path.join(base, rel), "utf8");
  // eslint-disable-next-line no-eval
  eval(code);
}

load("web/js/catalog.js");
load("web/js/search.js");

const CMF = global.window.CMF;
CMF.data = {
  catalog: JSON.parse(fs.readFileSync(path.join(base, "site/data/catalog.json"), "utf8")),
  recipes: JSON.parse(fs.readFileSync(path.join(base, "site/data/recipes.json"), "utf8")),
};
CMF.initCatalog();

// Deterministic PRNG (mulberry32) so the two sides see identical queries.
function mulberry32(seed) {
  return function () {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = mulberry32(20261106);

const all = CMF.data.catalog.ingredients.map((e) => e.canonical);
const queries = [];
for (let q = 0; q < 800; q++) {
  const size = 1 + Math.floor(rand() * 10);
  const picked = new Set();
  while (picked.size < size) {
    picked.add(all[Math.floor(rand() * all.length)]);
  }
  queries.push([...picked]);
}

function summarize(recipes, selected) {
  const result = CMF.search(recipes, selected);
  function ids(matches) {
    return matches.map((m) => ({
      id: m.recipe.id,
      missing: m.missing,
    }));
  }
  return { cookNow: ids(result.cookNow), almost: ids(result.almostThere) };
}

const out = queries.map((selected) => ({
  selected,
  js: summarize(CMF.data.recipes, selected),
}));
process.stdout.write(JSON.stringify(out));
