/* Headless test for the real nutrition.js aggregation and browse filter.
   Usage: node node_nutrition_harness.js [project_root] */
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
load("web/js/nutrition.js");
global.window.CMF.boots = function () {};
load("web/js/page-browse.js");

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
const known = new Set(["高蛋白", "高纤维", "低脂", "低碳水", "优质碳水", "高铁"]);

// 1. catalog entries carry nutrition arrays
const withFlags = CMF.data.catalog.ingredients.filter((e) => e.nutrition.length);
check("some flagged ingredients", withFlags.length >= 20);

// 2. ingredient-level flag consistency
const chicken = CMF.entry("鸡胸肉");
check("chicken flags", chicken.nutrition.includes("高蛋白") && chicken.nutrition.includes("低脂"));

// 3. every recipe flag is a known flag
recipes.forEach((r) => {
  if (!CMF.recipeNutrition(r).every((f) => known.has(f))) failures.push("unknown flag " + r.id);
});

// 4. a recipe containing a high-protein ingredient earns 高蛋白
const proteinRecipe = recipes.find((r) =>
  r.ingredients.some((i) => {
    const e = CMF.entry(i.canonical);
    return e && e.nutrition.includes("高蛋白");
  })
);
check("protein recipe flagged", proteinRecipe && CMF.recipeNutrition(proteinRecipe).includes("高蛋白"));

// 5. optional-only flag does not count
const synthetic = {
  ingredients: [
    { canonical: "鸡胸肉", optional: true },
    { canonical: "番茄", optional: false },
  ],
};
check("optional excluded", !CMF.recipeNutrition(synthetic).includes("高蛋白"));

// 6. deterministic
check(
  "deterministic",
  JSON.stringify(CMF.recipeNutrition(proteinRecipe)) ===
    JSON.stringify(CMF.recipeNutrition(proteinRecipe))
);

// 7. browse filterRecipes honors nutrition (all selected flags must be present)
const highProteinRows = CMF.filterRecipes(recipes, { nutrition: ["高蛋白"] });
check("filter returns rows", highProteinRows.length >= 1);
check(
  "filter accurate",
  highProteinRows.every((r) => CMF.recipeNutrition(r).includes("高蛋白"))
);
const strictRows = CMF.filterRecipes(recipes, { nutrition: ["高蛋白", "低脂"] });
check(
  "strict filter accurate",
  strictRows.every((r) => {
    const nf = CMF.recipeNutrition(r);
    return nf.includes("高蛋白") && nf.includes("低脂");
  })
);

if (failures.length) {
  console.error("NUTRITION TEST FAILURES:", failures);
  process.exit(1);
}
console.log(JSON.stringify({ ok: true, checks: 8, flaggedIngredients: withFlags.length }));
