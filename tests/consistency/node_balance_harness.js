/* Headless tests for balance.js (score, advice, cards, menu optimisation).
   Usage: node node_balance_harness.js [project_root] */
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
  // eslint-disable-next-line no-eval
  eval(fs.readFileSync(path.join(base, rel), "utf8"));
}

load("web/js/store.js");
load("web/js/catalog.js");
load("web/js/search.js");
load("web/js/nutrition.js");
load("web/js/balance.js");
load("web/js/diets.js");
load("web/js/planner.js");

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

const recipes = CMF.data.recipes;
const ideal = { kcal: 600, protein: 25, fat: 15, carbs: 90 };
const carbHeavy = { kcal: 600, protein: 2, fat: 1, carbs: 145 };

// 1. scoring basics
const good = CMF.scoreBalance(ideal, { meals: 1 });
check("ideal score high", good.score >= 85);
check("ideal grade", good.grade === "优秀" || good.grade === "良好");
check("energy shares add to ~100", Math.abs(
  good.energyShare.protein + good.energyShare.fat + good.energyShare.carbs - 100
) <= 2);
check("parts add up to score", good.parts.macro + good.parts.protein + good.parts.energy === good.score);
check("protein density computed", good.proteinDensity > 3);
const bad = CMF.scoreBalance(carbHeavy, { meals: 1 });
check("carb-heavy scores lower", bad.score < good.score);
check("carb-heavy flags protein", bad.issues.includes("蛋白质供能偏低"));
check("carb-heavy flags carbs", bad.issues.includes("碳水供能偏高"));
check("carb-heavy suggests sides", bad.companions.length > 0);
check("companions are real ingredients", (() => {
  const known = new Set(CMF.data.catalog.ingredients.map((e) => e.canonical));
  return bad.companions.every((c) => known.has(c.name));
})());
check("zero totals safe", CMF.scoreBalance({ kcal: 0, protein: 0, fat: 0, carbs: 0 }).score === 0);
check("missing totals safe", CMF.scoreBalance(null).grade === "无数据");
check("negative totals clamped", CMF.scoreBalance({ kcal: -5, protein: -1, fat: -1, carbs: -1 }).score === 0);
check("score bounded", (() => {
  for (let k = 0; k < 200; k += 1) {
    const s = CMF.scoreBalance({
      kcal: (k * 37) % 3000,
      protein: (k * 13) % 200,
      fat: (k * 7) % 150,
      carbs: (k * 29) % 400,
    });
    if (s.score < 0 || s.score > 100 || Number.isNaN(s.score)) return false;
  }
  return true;
})());

// 2. energy expectation scales with meal count
const twoMeals = CMF.scoreBalance({ kcal: 300, protein: 12, fat: 8, carbs: 45 }, { meals: 1 });
const oneDay = CMF.scoreBalance({ kcal: 300, protein: 12, fat: 8, carbs: 45 }, { meals: 2 });
check("two-meal expectation lowers energy score", oneDay.parts.energy <= twoMeals.parts.energy);
check("macro score independent of meal count", oneDay.parts.macro === twoMeals.parts.macro);

// 3. whole dataset smoke test
let smokeOk = true;
CMF.data.recipes.forEach((r) => {
  const e = CMF.estimateNutrition(r);
  if (!e) { smokeOk = false; return; }
  const s = CMF.scoreBalance(e.perServing, { meals: 1 });
  if (Number.isNaN(s.score) || s.score < 0 || s.score > 100 || !s.tips.length) smokeOk = false;
});
check("all recipes scoreable", smokeOk);
check("deterministic score", JSON.stringify(CMF.scoreBalance(ideal)) === JSON.stringify(CMF.scoreBalance(ideal)));

// 4. planner integration
const week = CMF.buildMenu(1, recipes, [], {}, 42);
const day = CMF.balanceDay(week, 0, recipes);
check("balanceDay returns score", day && day.score >= 0 && day.score <= 100);
check("balanceDay missing day safe", CMF.balanceDay(week, 999, recipes) === null);
const summary = CMF.balanceMenu(week, recipes);
check("balanceMenu 7 rows", summary.days.length === 7);
check("balanceMenu average", summary.average >= 0 && summary.average <= 100);
check("balanceMenu weak subset", summary.weak.every((i) => summary.days.some((d) => d.index === i && d.score < 70)));
check("balanceMenu advice strings", summary.advice.every((a) => typeof a === "string" && a.includes("天")));
check("balanceMenu grade", typeof summary.grade === "string" && summary.grade.length > 0);

// 5. HTML cards
const card = CMF.renderBalanceCard(ideal, { meals: 1 });
check("card has score", card.includes(String(good.score)));
check("card has grade", card.includes(good.grade));
check("card has parts", card.includes("供能比") && card.includes("/60"));
check("card has note", card.includes("不替代专业营养建议"));
check("card escapes HTML", !card.includes("<script"));
check("card no undefined/NaN", !card.includes("undefined") && !card.includes("NaN"));
const badCard = CMF.renderBalanceCard(carbHeavy, { meals: 1 });
check("bad card has suggestions", badCard.includes("建议搭配"));
const sumHtml = CMF.renderBalanceSummary(summary);
check("summary has average", sumHtml.includes(String(summary.average)));
check("summary has optimize button", sumHtml.includes("btn-optimize"));
check("summary can hide button", !CMF.renderBalanceSummary(summary, { showOptimize: false }).includes("btn-optimize"));
check("empty summary safe", CMF.renderBalanceSummary({ days: [], average: 0, advice: [], grade: "无数据" }) === "");

// 6. balance-driven optimisation
const opt = CMF.optimizeMenu(week, recipes, [], {}, 99);
check("optimize keeps 7 days", opt.days.length === 7);
check("optimize keeps 14 meals", CMF.weekMeals(opt.days).length === 14);
check("optimize never lowers average", opt.after >= opt.before);
check("optimize valid ids", CMF.weekMeals(opt.days).every((m) => recipes.some((r) => r.id === m.recipeId)));
check("optimize deterministic", JSON.stringify(opt.days) === JSON.stringify(CMF.optimizeMenu(week, recipes, [], {}, 99).days));
check("optimize limits changes to a third", opt.changed <= Math.ceil(week.length / 3));
check("optimize leaves good days alone", CMF.balanceMenu(week, recipes).days
  .filter((d) => d.score >= 70)
  .every((d) => JSON.stringify(week.find((x) => x.index === d.index)) ===
    JSON.stringify(opt.days.find((x) => x.index === d.index))));
check("optimize maxDays override", CMF.optimizeMenu(week, recipes, [], {}, 99, { maxDays: 1 }).changed <= 1);
check("optimize target zero is a no-op", CMF.optimizeMenu(week, recipes, [], {}, 99, { target: 0 }).changed === 0);
check("optimize each day improves", (() => {
  const before = CMF.balanceMenu(week, recipes).days;
  const after = CMF.balanceMenu(opt.days, recipes).days;
  return before.every((b, i) => after[i].score >= b.score);
})());
check("optimize without balance module safe", (() => {
  const saved = CMF.scoreBalance;
  CMF.scoreBalance = undefined;
  const res = CMF.optimizeMenu(week, recipes, [], {}, 1);
  CMF.scoreBalance = saved;
  return res.changed === 0 && res.days.length === 7;
})());
const fourWeeks = CMF.buildMenu(4, recipes, [], {}, 7);
check("optimize scales to 4 weeks", (() => {
  const r = CMF.optimizeMenu(fourWeeks, recipes, [], {}, 5);
  return r.days.length === fourWeeks.length && r.after >= r.before;
})());

if (failures.length) {
  console.error("BALANCE TEST FAILURES:", failures);
  process.exit(1);
}
console.log(JSON.stringify({ ok: true, checks, recipes: recipes.length, before: opt.before, after: opt.after }));
