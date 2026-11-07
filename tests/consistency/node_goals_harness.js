/* Headless tests for personal nutrition goals and balance integration.
   Usage: node node_goals_harness.js [project_root] */
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
load("web/js/goals.js");
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

// 1. vocabulary and defaults
check("5 activity levels", CMF.GOAL_ACTIVITY.length === 5);
check("3 modes", CMF.GOAL_MODES.length === 3);
check("sex options", CMF.GOAL_SEX.length === 3);
check("default disabled", CMF.DEFAULT_GOAL_PROFILE.enabled === false);
check("default two meals", CMF.DEFAULT_GOAL_PROFILE.mealsPerDay === 2);
check("activity factors increasing", CMF.GOAL_ACTIVITY.every(
  (a, i, list) => i === 0 || a.factor > list[i - 1].factor));
check("modes ordered", CMF.GOAL_MODES[0].energy < CMF.GOAL_MODES[1].energy &&
  CMF.GOAL_MODES[1].energy < CMF.GOAL_MODES[2].energy);

// 2. sanitisation never lets NaN / out-of-range values into the formula
const clean = CMF.sanitizeGoalProfile(null);
check("null profile safe", clean.age === 30 && clean.enabled === false);
check("unknown enum falls back", CMF.sanitizeGoalProfile({ sex: "x", mode: "x", activity: "x" }).mode === "maintain");
check("age clamped low", CMF.sanitizeGoalProfile({ age: 1 }).age === 10);
check("age clamped high", CMF.sanitizeGoalProfile({ age: 999 }).age === 100);
check("height clamped", CMF.sanitizeGoalProfile({ heightCm: 10 }).heightCm === 120);
check("weight clamped", CMF.sanitizeGoalProfile({ weightKg: 999 }).weightKg === 200);
check("people clamped", CMF.sanitizeGoalProfile({ people: 99 }).people === 12);
check("meals clamped", CMF.sanitizeGoalProfile({ mealsPerDay: 0 }).mealsPerDay === 1);
check("NaN falls back", CMF.sanitizeGoalProfile({ age: "abc", weightKg: NaN }).weightKg === 60);
check("string numbers accepted", CMF.sanitizeGoalProfile({ age: "42" }).age === 42);
check("fractional rounds", CMF.sanitizeGoalProfile({ people: 2.6 }).people === 3);
check("enabled is boolean", CMF.sanitizeGoalProfile({ enabled: "yes" }).enabled === true);

// 3. Mifflin-St Jeor math
const male = CMF.computeGoals({ sex: "male", age: 30, heightCm: 175, weightKg: 70, activity: "moderate", mode: "maintain", people: 1, mealsPerDay: 2 });
check("BMR male 175/70/30", male.bmr === Math.round(10 * 70 + 6.25 * 175 - 5 * 30 + 5));
check("TDEE uses activity", male.tdee === Math.round(male.bmr * 1.55));
check("daily kcal is 10-multiple", male.daily.kcal % 10 === 0);
check("protein from bodyweight", male.daily.protein === Math.round(70 * 1.4));
check("fat is 25% energy", male.daily.fat === Math.round(male.daily.kcal * 0.25 / 9));
check("carbs fill remainder", male.daily.carbs > 0);
check("macro energy near daily kcal", Math.abs(
  male.daily.protein * 4 + male.daily.fat * 9 + male.daily.carbs * 4 - male.daily.kcal
) < 20);
check("energy shares sum ~100", Math.abs(
  male.energyShare.protein + male.energyShare.fat + male.energyShare.carbs - 100
) <= 2);
check("perMeal half of daily", Math.abs(male.perMeal.kcal * 2 - male.daily.kcal) <= 1);
check("household scales", male.household.kcal === male.daily.kcal);

const female = CMF.computeGoals({ sex: "female", age: 30, heightCm: 175, weightKg: 70 });
check("female BMR lower", female.bmr < male.bmr);
const neutral = CMF.computeGoals({ sex: "unspecified", age: 30, heightCm: 175, weightKg: 70 });
check("neutral between", neutral.bmr > female.bmr && neutral.bmr < male.bmr);
check("cut lower than maintain", CMF.computeGoals({ mode: "cut" }).daily.kcal <
  CMF.computeGoals({ mode: "maintain" }).daily.kcal);
check("bulk higher than maintain", CMF.computeGoals({ mode: "bulk" }).daily.kcal >
  CMF.computeGoals({ mode: "maintain" }).daily.kcal);
check("cut protein higher", CMF.computeGoals({ mode: "cut" }).daily.protein >
  CMF.computeGoals({ mode: "maintain" }).daily.protein);
check("sedentary < very active", CMF.computeGoals({ activity: "sedentary" }).tdee <
  CMF.computeGoals({ activity: "very" }).tdee);
check("kcal bounded low", CMF.computeGoals({ weightKg: 30, heightCm: 120, age: 100, mode: "cut", activity: "sedentary" }).daily.kcal >= 1200);
check("kcal bounded high", CMF.computeGoals({ weightKg: 200, heightCm: 220, age: 18, mode: "bulk", activity: "very" }).daily.kcal <= 4000);
check("more people only changes household", (() => {
  const a = CMF.computeGoals({ people: 1 });
  const b = CMF.computeGoals({ people: 4 });
  return a.daily.kcal === b.daily.kcal && b.household.kcal === a.daily.kcal * 4;
})());
check("more meals lowers per-meal", CMF.computeGoals({ mealsPerDay: 3 }).perMeal.kcal <
  CMF.computeGoals({ mealsPerDay: 2 }).perMeal.kcal);
check("deterministic", JSON.stringify(male) === JSON.stringify(CMF.computeGoals({ sex: "male", age: 30, heightCm: 175, weightKg: 70, activity: "moderate", mode: "maintain", people: 1, mealsPerDay: 2 })));

// 4. storage + activation
check("no goals initially", CMF.activeGoals() === null);
check("goalTargets null initially", CMF.goalTargets({ meals: 1 }) === null);
check("progress null initially", CMF.goalProgress(male.daily) === null);
CMF.setGoals({ enabled: false, profile: { mode: "cut" } });
check("disabled profile inactive", CMF.activeGoals() === null);
CMF.setGoals({ enabled: true, profile: { mode: "cut", mealsPerDay: 2, people: 3 } });
const active = CMF.activeGoals();
check("enabled profile active", active && active.mode === "cut");
check("stored people preserved", active.profile.people === 3);
check("getGoals round trip", CMF.getGoals().enabled === true);
CMF.setGoals({ enabled: true, mode: "bulk" }); // legacy flat payload
check("flat legacy payload", CMF.activeGoals().mode === "bulk");
check("clearGoals disables", (() => { CMF.clearGoals(); return CMF.activeGoals() === null; })());
CMF.setGoals({ enabled: true, profile: { mode: "maintain", mealsPerDay: 2 } });

// 5. targets, progress and cards
const one = CMF.goalTargets({ meals: 1 });
const two = CMF.goalTargets({ meals: 2 });
check("target has personal source", one.source === "personal");
check("two meals double kcal", Math.abs(two.kcal - 2 * one.kcal) <= 1);
check("target clamps meals", CMF.goalTargets({ meals: 99 }).meals === 4);
check("target kcal positive", one.kcal > 300 && one.kcal < 2000);
const half = CMF.goalProgress({ kcal: one.kcal / 2, protein: one.protein, fat: one.fat, carbs: one.carbs }, { meals: 1 });
check("progress 50% kcal", half.kcal === 50);
check("progress 100% protein", half.protein === 100);
check("progress respects target", half.target.kcal === one.kcal);
check("progress over 100 allowed", CMF.goalProgress({ kcal: one.kcal * 2 }, { meals: 1 }).kcal === 200);
check("progress zero safe", CMF.goalProgress({}, { meals: 1 }).kcal === 0);
check("hint includes percent", CMF.goalHint({ kcal: one.kcal }, { meals: 1 }).includes("100%"));
check("hint empty when disabled", (() => {
  CMF.clearGoals();
  const empty = CMF.goalHint({ kcal: 600 }) === "" && CMF.renderGoalProgress({ kcal: 600 }) === "";
  CMF.setGoals({ enabled: true, profile: { mode: "maintain", mealsPerDay: 2 } });
  return empty;
})());
const card = CMF.renderGoalProgress({ kcal: 500, protein: 20, fat: 15, carbs: 60 }, { meals: 1 });
check("card has head", card.includes("我的营养目标"));
check("card has four rows", (card.match(/goal-progress /g) || []).length === 4);
check("card has target", card.includes("kcal / 蛋白"));
check("card escapes", !card.includes("<script") && !card.includes("undefined") && !card.includes("NaN"));
check("card bar bounded", (card.match(/width:(\d+)%/g) || []).every(
  (m) => Number(m.replace(/[^0-9]/g, "")) <= 100));
const summary = CMF.renderGoalsSummary(CMF.activeGoals());
check("summary has BMR", summary.includes("基础代谢"));
check("summary has household", summary.includes("全家"));
check("summary has disclaimer", summary.includes("不替代"));

// 6. balance integration: default path must stay unchanged
const ideal = { kcal: 600, protein: 25, fat: 15, carbs: 90 };
CMF.clearGoals();
const baseline = CMF.scoreBalance(ideal, { meals: 1 });
check("baseline not personal", baseline.personal === false && baseline.target === null);
check("baseline score unchanged", baseline.score >= 85);
CMF.setGoals({ enabled: true, profile: { mode: "maintain", mealsPerDay: 2 } });
const personalScore = CMF.scoreBalance(ideal, { meals: 1 });
check("personal flag on", personalScore.personal === true);
check("personal target attached", personalScore.target && personalScore.target.kcal > 0);
check("personal card labelled", CMF.renderBalanceCard(ideal, { meals: 1 }).includes("按我的目标"));
check("personal changes score", personalScore.score !== baseline.score ||
  personalScore.parts.energy !== baseline.parts.energy);
check("explicit targets win", (() => {
  const custom = CMF.scoreBalance(ideal, { meals: 1, targets: { kcal: 600, protein: 25, fat: 15, carbs: 90, source: "test" } });
  return custom.target.source === "test" && custom.personal === true;
})());
check("zero target falls back", (() => {
  const fallback = CMF.scoreBalance(ideal, { meals: 1, targets: { kcal: 0 } });
  return fallback.target === null || fallback.target.kcal > 0;
})());
check("zero totals safe with goals", CMF.scoreBalance({ kcal: 0, protein: 0, fat: 0, carbs: 0 }, { meals: 1 }).score === 0);
check("personal score bounded", (() => {
  for (let k = 0; k < 100; k += 1) {
    const s = CMF.scoreBalance({ kcal: (k * 41) % 3000, protein: (k * 7) % 120, fat: (k * 3) % 90, carbs: (k * 23) % 300 });
    if (s.score < 0 || s.score > 100 || Number.isNaN(s.score)) return false;
  }
  return true;
})());
check("balanceDay uses goals", (() => {
  const week = CMF.buildMenu(1, CMF.data.recipes, [], {}, 11);
  const d = CMF.balanceDay(week, 0, CMF.data.recipes);
  return d && d.personal === true;
})());
check("balanceMenu uses goals", (() => {
  const week = CMF.buildMenu(1, CMF.data.recipes, [], {}, 11);
  const m = CMF.balanceMenu(week, CMF.data.recipes);
  return m.days.every((d) => d.personal === true);
})());

// 7. whole dataset smoke test
let smoke = true;
CMF.data.recipes.forEach((r) => {
  const e = CMF.estimateNutrition(r);
  if (!e) { smoke = false; return; }
  const p = CMF.goalProgress(e.perServing, { meals: 1 });
  const s = CMF.scoreBalance(e.perServing, { meals: 1 });
  if (!p || Number.isNaN(p.kcal) || Number.isNaN(s.score)) smoke = false;
});
check("all recipes have goal progress", smoke);
check("dataset size", CMF.data.recipes.length >= 210);

CMF.clearGoals();
if (failures.length) {
  console.error("GOALS TEST FAILURES:", failures);
  process.exit(1);
}
console.log(JSON.stringify({ ok: true, checks, bmr: male.bmr, dailyKcal: male.daily.kcal }));
