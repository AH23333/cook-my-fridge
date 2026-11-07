/* Headless test for quantitative nutrition estimation.
   Usage: node node_estimate_harness.js [project_root] */
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
const near = (a, b, eps) => Math.abs(a - b) <= (eps == null ? 0.6 : eps);

// 1. exported data covers the entire catalog
const facts = CMF.nutritionData();
check("nutrition facts exported", !!facts && !!facts.per100g);
const names = CMF.data.catalog.ingredients.map((e) => e.canonical);
check("every ingredient has a row", names.every((n) => facts.per100g[n]));
check("no stale rows", Object.keys(facts.per100g).every((n) => names.includes(n)));
check("all values finite and non-negative", Object.values(facts.per100g).every((r) =>
  ["kcal", "protein", "fat", "carbs"].every((k) => Number.isFinite(r[k]) && r[k] >= 0)
));
check("unit table present", facts.unit_grams["勺"] > 0 && facts.ingredient_units["鸡蛋"]["个"] === 50);
check("explicit reference values", facts.per100g["食用油"].kcal > 800 && facts.per100g["清水"].kcal === 0);

// 2. amount parsing
const p = CMF.parseAmount;
check("parse 2 个", p("2 个").quantity === 2 && p("2 个").unit === "个");
check("parse 1 小勺", p("1 小勺").quantity === 1 && p("1 小勺").unit === "小勺");
check("parse 100克", p("100克").quantity === 100 && p("100克").unit === "克");
check("parse 半个", p("半个").quantity === 0.5 && p("半个").unit === "个");
check("parse 半勺", p("半勺").quantity === 0.5 && p("半勺").unit === "勺");
check("parse 少许 is vague", p("少许").exact === false && p("少许").unit === "少许");
check("parse CJK 两个", p("两个").quantity === 2 && p("两个").unit === "个");
check("parse empty is safe", p("").quantity === 1 && p("").exact === false);
check("parse bare number", p("3").quantity === 3 && p("3").unit === "个");
check("parse never negative", p("-2 个").quantity >= 0);

// 3. household unit -> grams
const g = CMF.ingredientGrams;
check("egg 2 个 = 100g", g("鸡蛋", "2 个").grams === 100);
check("oil 1 勺 uses override = 10g", g("食用油", "1 勺").grams === 10);
check("rice 1 碗 = 150g", g("米饭", "1 碗").grams === 150);
check("garlic 3 瓣 = 15g", g("大蒜", "3 瓣").grams === 15);
check("unknown unit flagged", g("番茄", "3 光年").known === false);
check("unknown unit still numeric", g("番茄", "3 光年").grams === 90);
check("leafy bunch = 150g", g("菠菜", "1 把").grams === 150);
check("broccoli head = 300g", g("西兰花", "1 颗").grams === 300);
check("dried chili bunch = 10g", g("干辣椒", "1 把").grams === 10);
check("herb bunch stays small", g("香菜", "1 把").grams === 30);
check("half watermelon = 500g", g("西瓜", "半个").grams === 500);

// 4. arithmetic on a synthetic recipe
const synthetic = {
  id: "synthetic", title: "测试菜", tags: [],
  ingredients: [
    { canonical: "鸡蛋", amount: "2 个", optional: false },
    { canonical: "食用油", amount: "1 勺", optional: false },
    { canonical: "米饭", amount: "100克", optional: false },
  ],
};
const est = CMF.estimateNutrition(synthetic);
check("estimate returns object", !!est);
check("total kcal arithmetic", near(est.total.kcal, 347));
check("total protein", near(est.total.protein, 15.2));
check("total fat", near(est.total.fat, 19.8));
check("total carbs", near(est.total.carbs, 27));
check("two servings", est.servings === 2);
check("per serving kcal", near(est.perServing.kcal, 174, 1));
check("carbs per serving helper", near(CMF.carbsPerServing(synthetic), 13.5));
check("energy shares sum ~100", near(est.energyShare.protein + est.energyShare.fat + est.energyShare.carbs, 100, 2));
check("lines sorted by kcal", est.lines[0].kcal >= est.lines[est.lines.length - 1].kcal);
check("grams tracked", est.grams === 210);

const doubled = CMF.estimateNutrition(synthetic, 2);
check("factor doubles total", near(doubled.total.kcal, est.total.kcal * 2, 2));
check("factor keeps servings", doubled.servings === est.servings);
check("factor=0 falls back to 1", CMF.estimateNutrition(synthetic, 0).total.kcal === est.total.kcal);

const withOptional = {
  ...synthetic,
  ingredients: synthetic.ingredients.concat([
    { canonical: "黄油", amount: "100克", optional: true },
  ]),
};
check("optional excluded", CMF.estimateNutrition(withOptional).total.kcal === est.total.kcal);
check("one-person serving", CMF.estimateNutrition({ ...synthetic, tags: ["一人食"] }).servings === 1);
check("unknown canonical reported", CMF.estimateNutrition({
  ingredients: [{ canonical: "不存在的食材", amount: "100克" }], tags: [],
}).unknownFacts.includes("不存在的食材"));
check("deterministic", JSON.stringify(est) === JSON.stringify(CMF.estimateNutrition(synthetic)));

// 4b. cooking-oil compensation for recipes that omit pantry staples
const stir = {
  ingredients: [{ canonical: "菠菜", amount: "1 把", optional: false }],
  methods: ["炒"], tags: [],
};
const cold = { ...stir, methods: ["凉拌"] };
const stirEst = CMF.estimateNutrition(stir);
const coldEst = CMF.estimateNutrition(cold);
check("stir-fry oil compensated", stirEst.oilAdded === true &&
  stirEst.lines.some((l) => l.canonical === "食用油（默认）"));
check("cold dish no oil", coldEst.oilAdded === false);
check("oil adds ~88 kcal", stirEst.total.kcal - coldEst.total.kcal === 88);
check("oil note visible on card", CMF.renderNutritionCard(stir).includes("10 g 食用油"));

// 5. real dataset smoke test
const estimates = CMF.data.recipes.map((r) => CMF.estimateNutrition(r));
check("all recipes estimated", estimates.every(Boolean));
check("no NaN in real data", estimates.every((e) =>
  Number.isFinite(e.perServing.kcal) && Number.isFinite(e.perServing.carbs)
));
check("no zero-calorie real recipe", estimates.every((e) => e.perServing.kcal > 0));
check("no absurd calories", estimates.every((e) => e.perServing.kcal < 3000));
check("few implausibly low recipes", estimates.filter((e) => e.perServing.kcal < 30).length <= 8);
check("no unknown canonicals in real data", estimates.every((e) => e.unknownFacts.length === 0));
const tomatoEgg = CMF.data.recipes.find((r) => r.title.includes("番茄炒蛋"));
if (tomatoEgg) {
  const te = CMF.estimateNutrition(tomatoEgg);
  check("番茄炒蛋 plausible kcal", te.perServing.kcal > 80 && te.perServing.kcal < 700);
}
check("qualitative badges still work", Array.isArray(CMF.recipeNutrition(synthetic)));
const card = CMF.renderNutritionCard(CMF.data.recipes[0]);
check("card renders calories", card.includes("kcal") && card.includes("热量"));
check("card carries disclaimer", card.includes("仅供参考"));
check("card has no undefined", !card.includes("undefined"));

if (failures.length) {
  console.error("NUTRITION ESTIMATE TEST FAILURES:", failures);
  process.exit(1);
}
console.log(JSON.stringify({ ok: true, checks, ingredients: names.length, recipes: estimates.length }));
