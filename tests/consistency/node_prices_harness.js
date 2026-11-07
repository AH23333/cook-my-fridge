/* Headless test for prices.js cost heuristics.
   Usage: node node_prices_harness.js [project_root] */
const fs = require("fs");
const path = require("path");

const base = process.argv[2] || path.resolve(__dirname, "..", "..");
global.window = {};

function load(rel) {
  // eslint-disable-next-line no-eval
  eval(fs.readFileSync(path.join(base, rel), "utf8"));
}

load("web/js/catalog.js");
load("web/js/nutrition.js");
load("web/js/prices.js");

const CMF = global.window.CMF;
CMF.data = {
  catalog: JSON.parse(fs.readFileSync(path.join(base, "site/data/catalog.json"), "utf8")),
  recipes: JSON.parse(fs.readFileSync(path.join(base, "site/data/recipes.json"), "utf8")),
};
CMF.initCatalog();

const failures = [];
let checks = 0;
function check(name, cond) {
  checks += 1;
  if (!cond) failures.push(name);
}

check("explicit price", CMF.pricePer500g("土豆") === 2.5);
check("category fallback positive", CMF.pricePer500g("清水") > 0);
check("unknown still positive", CMF.pricePer500g("不存在的食材") > 0);
check("cost math", Math.abs(CMF.ingredientCost("土豆", 250) - 1.25) < 1e-9);
check("zero grams zero cost", CMF.ingredientCost("土豆", 0) === 0);
check("negative grams zero cost", CMF.ingredientCost("土豆", -5) === 0);
check("takeout default", CMF.takeoutPerMeal() === 30);

const recipe = CMF.data.recipes.find((r) => r.id === "r001");
const cost = CMF.recipeCost(recipe, 1);
check("recipe cost positive", cost && cost.total > 0);
check("factor scales cost", Math.abs(CMF.recipeCost(recipe, 2).total - cost.total * 2) < 0.2);
check("half factor", CMF.recipeCost(recipe, 0.5).total < cost.total);

check("shopping default unit", CMF.shoppingCost([{ canonical: "土豆" }]) === CMF.ingredientCost("土豆", 200));
check("shopping explicit grams", CMF.shoppingCost([{ canonical: "土豆", grams: 500 }]) === 2.5);
check("shopping empty", CMF.shoppingCost([]) === 0);

const savings = CMF.savingsEstimate([
  { cost: 10 }, { cost: 25 }, { cost: 40 }, { cost: null }, {},
]);
check("savings meals counted", savings.meals === 3);
check("savings clamped per meal", savings.saved === 20 + 5 + 0);
check("savings empty", CMF.savingsEstimate([]).saved === 0);

// Real dataset sanity: every recipe costs something plausible.
const totals = CMF.data.recipes.map((r) => CMF.recipeCost(r, 1).total);
check("all recipes priced", totals.every((t) => t > 0));
check("no absurd totals", totals.every((t) => t < 300));

// Missing shard degrades to null instead of throwing.
const saved = CMF.data.catalog;
CMF.data.catalog = {};
check("no shard price null", CMF.pricePer500g("土豆") === null);
check("no shard recipe null", CMF.recipeCost(recipe, 1) === null);
check("no shard shopping null", CMF.shoppingCost([{ canonical: "土豆" }]) === null);
CMF.data.catalog = saved;

if (failures.length) {
  console.error("PRICES TEST FAILURES:", failures);
  process.exit(1);
}
console.log(JSON.stringify({ ok: true, checks }));