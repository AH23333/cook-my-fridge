/* Headless tests for diet rules, prefs persistence and filter integration.
   Usage: node node_diet_harness.js [project_root] */
const fs = require("fs");
const path = require("path");

const base = process.argv[2] || path.resolve(__dirname, "..", "..");
global.window = {};
const memory = {};
global.localStorage = {
  getItem: (k) => (k in memory ? memory[k] : null),
  setItem: (k, v) => { memory[k] = String(v); },
  removeItem: (k) => { delete memory[k]; },
};

function load(rel) {
  const code = fs.readFileSync(path.join(base, rel), "utf8");
  // eslint-disable-next-line no-eval
  eval(code);
}

load("web/js/store.js");
load("web/js/catalog.js");
load("web/js/search.js");
load("web/js/nutrition.js");
load("web/js/diets.js");
load("web/js/planner.js");

const CMF = global.window.CMF;
CMF.boots = function () {};
load("web/js/page-browse.js");

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
const recipe = (title, ingredients, tags, allergens) => ({
  id: title, title, ingredients: ingredients.map((c) => ({ canonical: c, amount: "100克", optional: false })),
  tags: tags || [], allergens: allergens || [], time_minutes: 20, difficulty: "简单", methods: ["炒"],
});

// 1. option catalogue
check("three diets", CMF.DIETS.length === 3);
check("keys unique", new Set(CMF.DIET_KEYS).size === 3);
check("labels mapped", CMF.dietLabel("keto") === "生酮 / 低碳水");
check("unknown key falls back", CMF.dietLabel("nope") === "nope");

// 2. gluten-free
const noodles = recipe("面条", ["面条", "青菜"]);
const soy = recipe("酱油菜", ["生抽", "白菜"]);
const plain = recipe("清炒白菜", ["白菜", "大蒜"]);
check("noodles blocked", !CMF.matchesDiet(noodles, "gluten_free"));
check("soy sauce blocked", CMF.dietConflicts(soy, "gluten_free").includes("生抽"));
check("plain veg allowed", CMF.matchesDiet(plain, "gluten_free"));
const allergenFlagged = recipe("标注", ["白菜"], [], ["麸质"]);
check("recipe-level allergen respected", !CMF.matchesDiet(allergenFlagged, "gluten_free"));
check("optional ingredient ignored", CMF.matchesDiet({
  ingredients: [{ canonical: "面条", amount: "100克", optional: true }, { canonical: "白菜", amount: "100克" }],
  tags: [], allergens: [],
}, "gluten_free"));

// 3. keto
const rice = recipe("米饭", ["米饭", "鸡蛋"]);
const keto = recipe("低碳水", ["鸡胸肉", "橄榄油", "西兰花"]);
check("rice blocked by staple", CMF.dietConflicts(rice, "keto").includes("米饭"));
check("rice blocked", !CMF.matchesDiet(rice, "keto"));
check("low carb allowed", CMF.matchesDiet(keto, "keto"));
check("carb limit exposed", CMF.KETO_CARB_LIMIT === 20);
check("sugar blocked", !CMF.matchesDiet(recipe("甜", ["白糖", "鸡蛋"]), "keto"));

// 4. vegan
check("egg blocked", !CMF.matchesDiet(recipe("蛋", ["鸡蛋", "番茄"]), "vegan"));
check("milk blocked", !CMF.matchesDiet(recipe("奶", ["牛奶", "香蕉"]), "vegan"));
check("stock blocked", !CMF.matchesDiet(recipe("汤", ["高汤", "白菜"]), "vegan"));
check("shrimp blocked", !CMF.matchesDiet(recipe("虾", ["虾仁", "西兰花"]), "vegan"));
check("veg + tofu allowed", CMF.matchesDiet(recipe("素", ["白菜", "豆腐", "香菇"]), "vegan"));
check("allergen-declared egg blocked", !CMF.matchesDiet(recipe("标注蛋", ["白菜"], [], ["鸡蛋"]), "vegan"));

// 5. combinations
check("matchesDiets requires all", CMF.matchesDiets(plain, ["gluten_free", "vegan"]));
check("matchesDiets rejects one", !CMF.matchesDiets(recipe("蛋面", ["鸡蛋", "面条"]), ["gluten_free", "vegan"]));
check("matchesDiets empty is true", CMF.matchesDiets(noodles, []));
check("compatibleDiets shape", Array.isArray(CMF.compatibleDiets(plain)));
check("compatibleDiets contains vegan", CMF.compatibleDiets(plain).includes("vegan"));
check("unknown diet fails closed", !CMF.matchesDiet(plain, "unknown-diet"));

// 6. store: toggling a diet must not wipe other preferences
CMF.setPrefs({ tags: ["素食"], allergens: ["花生"], diets: [] });
CMF.toggleDiet("keto");
CMF.toggleDiet("gluten_free");
const prefs = CMF.getPrefs();
check("diets persisted", prefs.diets.includes("keto") && prefs.diets.includes("gluten_free"));
check("tags preserved", prefs.tags.includes("素食"));
check("allergens preserved", prefs.allergens.includes("花生"));
CMF.toggleDiet("keto");
check("toggle off", !CMF.getPrefs().diets.includes("keto"));
CMF.setDiets(["vegan", "vegan"]);
check("setDiets dedupes", CMF.getDiets().length === 1);
check("getPrefs defaults", (() => {
  delete memory["cmf.prefs"];
  const p = CMF.getPrefs();
  return Array.isArray(p.tags) && Array.isArray(p.diets);
})());

// 7. integration with real data
const recipes = CMF.data.recipes;
const counts = {};
CMF.DIET_KEYS.forEach((key) => {
  const allowed = recipes.filter((r) => CMF.matchesDiet(r, key));
  counts[key] = allowed.length;
  check(key + " has candidates", allowed.length >= 20);
  check(key + " conflicts empty", allowed.every((r) => CMF.dietConflicts(r, key).length === 0));
});
check("three-way intersection non-empty", recipes.some((r) => CMF.matchesDiets(r, CMF.DIET_KEYS)));

// 8. search.js integration
const selected = ["鸡蛋", "番茄"];
const unfiltered = CMF.search(recipes, selected);
const gluten = CMF.search(recipes, selected, { diets: ["gluten_free"] });
const allRows = unfiltered.cookNow.concat(unfiltered.almostThere);
const filteredRows = gluten.cookNow.concat(gluten.almostThere);
check("search filter narrows", filteredRows.length <= allRows.length);
check("search filter accurate", filteredRows.every((m) => CMF.matchesDiet(m.recipe, "gluten_free")));
check("search fail-closed", (() => {
  const saved = CMF.matchesDiets;
  CMF.matchesDiets = undefined;
  const res = CMF.search(recipes, selected, { diets: ["gluten_free"] });
  CMF.matchesDiets = saved;
  return res.cookNow.length === 0 && res.almostThere.length === 0;
})());

// 9. browse filter integration
const dietRows = CMF.filterRecipes(recipes, { diets: ["vegan"] });
check("browse diet rows", dietRows.length === counts["vegan"]);
check("browse diet accurate", dietRows.every((r) => CMF.matchesDiet(r, "vegan")));
const calRows = CMF.filterRecipes(recipes, { maxCalories: 300 });
check("browse calorie rows", calRows.length > 0 && calRows.every((r) => CMF.estimateNutrition(r).perServing.kcal <= 300));
const combo = CMF.filterRecipes(recipes, { diets: ["vegan"], maxCalories: 300 });
check("browse combined filter", combo.every((r) => CMF.matchesDiet(r, "vegan") && CMF.estimateNutrition(r).perServing.kcal <= 300));

// 10. planner integration
CMF.setPrefs({ diets: ["vegan"] });
const week = CMF.buildWeek(recipes, [], CMF.getPrefs(), 42);
check("planner respects diets", week.length === 7 && week.every((d) => {
  const r = recipes.find((x) => x.id === (d.recipeId || (d.lunch && d.lunch.recipeId)));
  return r && CMF.matchesDiet(r, "vegan");
}));

if (failures.length) {
  console.error("DIET TEST FAILURES:", failures);
  process.exit(1);
}
console.log(JSON.stringify({ ok: true, checks, counts }));
