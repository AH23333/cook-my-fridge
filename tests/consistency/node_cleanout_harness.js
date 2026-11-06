/* Headless test for the real cleanout.js greedy set-cover logic.
   Usage: node node_cleanout_harness.js [project_root] */
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
load("web/js/cleanout.js");

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

// Empty fridge -> no plan
const empty = CMF.cleanoutPlan(recipes, [], {});
check("empty fridge", empty.selected.length === 0 && empty.coveredCount === 0);

// Pick a recipe with a few ingredients and use its own ingredients
const target = recipes.find((r) => r.ingredients.length >= 3 && r.ingredients.length <= 6);
const fridge = target.ingredients.map((i) => i.canonical);
const plan = CMF.cleanoutPlan(recipes, fridge, { maxRecipes: 4, maxExtra: 3 });

check("has selected", plan.selected.length >= 1);
check("selected <= max", plan.selected.length <= 4);
check("coverage bounded", plan.coveredCount >= 1 && plan.coveredCount <= plan.totalFridge);
check("total fridge matches", plan.totalFridge === fridge.length);

// Every selected dish must use at least one fridge item
check("each dish covers", plan.selected.every((s) => s.addedCoverage.length >= 1));

// No repeated titles
check("unique dishes", new Set(plan.selected.map((s) => s.title)).size === plan.selected.length);

// coveredCount + unusedFridge == totalFridge
check("coverage reconciles", plan.coveredCount + plan.unusedFridge.length === plan.totalFridge);

// shopping shape
check("shopping shape", plan.shopping.every((s) => s.canonical && Array.isArray(s.recipes)));

// maxExtra respected: no selected dish has more than 3 missing
check("max extra respected", plan.selected.every((s) => s.missing.length <= 3));

// A recipe's own ingredients give at least one dish with zero missing
const zeroMissing = plan.selected.some((s) => s.missing.length === 0);
check("zero missing dish exists", zeroMissing);

// Larger budget can only keep or increase coverage (monotonic in maxRecipes)
const bigger = CMF.cleanoutPlan(recipes, fridge, { maxRecipes: 8, maxExtra: 3 });
check("more recipes non-decreasing", bigger.coveredCount >= plan.coveredCount);

// Tight maxExtra=0 still yields a plan for the target's own ingredients
const tight = CMF.cleanoutPlan(recipes, fridge, { maxRecipes: 4, maxExtra: 0 });
check("tight budget works", tight.selected.length >= 1 && tight.selected.every((s) => s.missing.length === 0));

// Urgent weighting: mark the first fridge ingredient urgent.
const urgentItem = fridge[0];
const urgentPlan = CMF.cleanoutPlan(recipes, fridge, {
  maxRecipes: 4,
  maxExtra: 3,
  urgent: [urgentItem],
});
check("urgent item covered", urgentPlan.selected.some((s) => s.urgentCovered.includes(urgentItem)));
check("urgent first priority", urgentPlan.selected[0].urgentCovered.includes(urgentItem));
check("urgent item not unused", !urgentPlan.unusedFridge.includes(urgentItem));

// No urgent set -> urgentCovered always empty
check("no urgent empty", plan.selected.every((s) => s.urgentCovered.length === 0));

if (failures.length) {
  console.error("CLEANOUT TEST FAILURES:", failures);
  process.exit(1);
}
console.log(JSON.stringify({ ok: true, checks: 17 }));
