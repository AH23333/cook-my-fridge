/* Headless test for the real stats.js aggregation.
   Usage: node node_stats_harness.js [project_root] */
const fs = require("fs");
const path = require("path");

const base = process.argv[2] || path.resolve(__dirname, "..", "..");
global.window = {};

function load(rel) {
  const code = fs.readFileSync(path.join(base, rel), "utf8");
  // eslint-disable-next-line no-eval
  eval(code);
}

load("web/js/catalog.js");
load("web/js/search.js");
load("web/js/stats.js");

const CMF = global.window.CMF;
CMF.data = {
  catalog: JSON.parse(fs.readFileSync(path.join(base, "site/data/catalog.json"), "utf8")),
  recipes: JSON.parse(fs.readFileSync(path.join(base, "site/data/recipes.json"), "utf8")),
};
CMF.initCatalog();

const failures = [];
function check(name, cond) {
  if (!cond) failures.push(name);
}

const recipes = CMF.data.recipes;

// Personal stats with seeded data
const someIds = recipes.slice(0, 5).map((r) => r.id);
const fridge = ["番茄", "鸡蛋", "土豆", "鸡肉", "大米"];
const personal = CMF.personalStats({
  fridge,
  favorites: someIds,
  plan: someIds.slice(0, 3),
  history: [{ id: "x" }, { id: "y" }],
});

check("counts", personal.counts.fridge === 5 && personal.counts.favorites === 5 &&
  personal.counts.plan === 3 && personal.counts.history === 2);
check("fridge categories", personal.fridgeByCategory.length >= 2);
check("top tags sorted desc", personal.topTags.every((r, i, a) => i === 0 || a[i - 1].count >= r.count));
check("top ingredients bounded", personal.topIngredients.length <= 8);
check("top ingredients have counts", personal.topIngredients.every((r) => r.count >= 1 && r.value));

// Dataset stats
const dataset = CMF.datasetStats(recipes);
check("recipe count", dataset.recipeCount === recipes.length);
check("ingredient count", dataset.ingredientCount === CMF.allIngredients().length);
check("method distribution", dataset.byMethod.length >= 5);
check("tag distribution", dataset.byTag.length >= 5);
check("method counts reconcile", dataset.byMethod.reduce((s, r) => s + r.count, 0) >= recipes.length);
check("dataset sorted", dataset.byTag.every((r, i, a) => i === 0 || a[i - 1].count >= r.count));

// Empty state does not crash
const empty = CMF.personalStats({ fridge: [], favorites: [], plan: [], history: [] });
check("empty safe", empty.counts.fridge === 0 && empty.topTags.length === 0);

if (failures.length) {
  console.error("STATS TEST FAILURES:", failures);
  process.exit(1);
}
console.log(JSON.stringify({ ok: true, checks: 13 }));
