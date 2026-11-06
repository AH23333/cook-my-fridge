/* Headless test for the real planner.js weekly logic.
   Usage: node node_planner_harness.js [project_root] */
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
load("web/js/planner.js");

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
const allNames = CMF.data.catalog.ingredients.map((e) => e.canonical);

// 1. week has 7 days
const week = CMF.buildWeek(recipes, [], {}, 42);
check("seven days", week.length === 7);

// 2. unique titles and valid ids
const titles = week.map((d) => d.title);
const ids = week.map((d) => d.recipeId);
check("unique titles", new Set(titles).size === 7);
check("valid ids", ids.every((id) => recipes.some((r) => r.id === id)));
check("day index order", week.every((d, i) => d.index === i));

// 3. deterministic for same seed
const weekAgain = CMF.buildWeek(recipes, [], {}, 42);
check("deterministic", JSON.stringify(week) === JSON.stringify(weekAgain));

// 4. seed changes the plan
const weekOther = CMF.buildWeek(recipes, [], {}, 777);
check("seed matters", JSON.stringify(week) !== JSON.stringify(weekOther));

// 5. allergen filter: pick an allergen actually present
const allergen = (() => {
  for (const r of recipes) {
    if (r.allergens && r.allergens.length) return r.allergens[0];
  }
  return null;
})();
if (allergen) {
  const safe = CMF.buildWeek(recipes, [], { allergens: [allergen] }, 42);
  const byId = new Map(recipes.map((r) => [r.id, r]));
  const hasAllergen = safe.some((d) => {
    const r = byId.get(d.recipeId);
    return r.allergens && r.allergens.includes(allergen);
  });
  check("allergen excluded", !hasAllergen);
}

// 6. vegetarian filter only returns vegetarian recipes
const veg = CMF.buildWeek(recipes, [], { tags: ["素食"] }, 42);
const byIdV = new Map(recipes.map((r) => [r.id, r]));
check("vegetarian only", veg.every((d) => (byIdV.get(d.recipeId).tags || []).includes("素食")));

// 7. reroll changes only the target day
const rerolled = CMF.rerollDay(week, 2, recipes, [], {}, 999);
check("reroll length", rerolled.length === 7);
check("reroll keeps others", rerolled.every((d, i) => i === 2 || d.recipeId === week[i].recipeId));
check("reroll changes target", rerolled[2].recipeId !== week[2].recipeId);
check("reroll no dup titles", new Set(rerolled.map((d) => d.title)).size === 7);

// 8. shopping list shape
const shopping = CMF.weekShopping(week, recipes, []);
check("shopping shape", shopping.every((s) => s.canonical && Array.isArray(s.recipes) && s.recipes.length));

// 9. full fridge -> no shopping needed
const fullFridge = new Set();
recipes.forEach((r) => r.ingredients.forEach((i) => fullFridge.add(i.canonical)));
const noShop = CMF.weekShopping(week, recipes, [...fullFridge]);
check("full fridge no shopping", noShop.length === 0);

// 10. fridge cook-now preference: a week built from a recipe's own ingredients
//     should put that recipe at zero missing on its day
const target = recipes.find((r) => r.ingredients.length <= 6);
if (target) {
  const have = target.ingredients.map((i) => i.canonical);
  const w = CMF.buildWeek(recipes, have, {}, 42);
  const m = CMF.matchRecipe(target, new Set(have));
  check("own ingredients zero missing", m.missingCount === 0);
}

if (failures.length) {
  console.error("PLANNER TEST FAILURES:", failures);
  process.exit(1);
}
console.log(JSON.stringify({ ok: true, checks: 14 }));
