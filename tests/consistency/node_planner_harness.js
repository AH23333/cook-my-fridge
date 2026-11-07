/* Headless test for the real planner.js: two meals/day, migration, ICS.
   Usage: node node_planner_harness.js [project_root] */
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
const byId = new Map(recipes.map((r) => [r.id, r]));
const mealsOf = (week) => CMF.weekMeals(week);
const week = CMF.buildWeek(recipes, [], {}, 42);

// 1. structure
check("seven days", week.length === 7);
check("every day has lunch", week.every((d) => d.lunch && d.lunch.recipeId));
check("every day has dinner", week.every((d) => d.dinner && d.dinner.recipeId));
check("14 meals", mealsOf(week).length === 14);
check("unique titles", new Set(mealsOf(week).map((m) => m.title)).size === 14);
check("valid ids", mealsOf(week).every((m) => byId.has(m.recipeId)));
check("day index order", week.every((d, i) => d.index === i));
check("meal labels", mealsOf(week).filter((m) => m.meal === "lunch").length === 7 &&
  mealsOf(week).filter((m) => m.meal === "dinner").length === 7);

// 2. determinism
check("deterministic", JSON.stringify(week) === JSON.stringify(CMF.buildWeek(recipes, [], {}, 42)));
check("seed matters", JSON.stringify(week) !== JSON.stringify(CMF.buildWeek(recipes, [], {}, 777)));

// 3. preference filters apply to BOTH meals
const allergen = (() => {
  for (const r of recipes) if (r.allergens && r.allergens.length) return r.allergens[0];
  return null;
})();
if (allergen) {
  const safe = CMF.buildWeek(recipes, [], { allergens: [allergen] }, 42);
  check("allergen excluded from all meals", mealsOf(safe).every((m) =>
    !(byId.get(m.recipeId).allergens || []).includes(allergen)
  ));
}
const veg = CMF.buildWeek(recipes, [], { tags: ["素食"] }, 42);
check("vegetarian only", mealsOf(veg).every((m) => (byId.get(m.recipeId).tags || []).includes("素食")));
const vegan = CMF.buildWeek(recipes, [], { diets: ["vegan"] }, 42);
check("diet filter on both meals", mealsOf(vegan).every((m) => CMF.matchesDiet(byId.get(m.recipeId), "vegan")));
check("strict diet still 7 days", vegan.length === 7);
check("diet fail-closed", (() => {
  const saved = CMF.matchesDiets;
  CMF.matchesDiets = undefined;
  const res = CMF.buildWeek(recipes, [], { diets: ["vegan"] }, 42);
  CMF.matchesDiets = saved;
  return res.length === 0;
})());

// 4. reroll
const rerolled = CMF.rerollMeal(week, 2, "dinner", recipes, [], {}, 999);
check("reroll keeps 14 meals", mealsOf(rerolled).length === 14);
const beforeMeals = mealsOf(week);
const afterMeals = mealsOf(rerolled);
check("reroll changes only target", beforeMeals.every((m, i) =>
  (m.index === 2 && m.meal === "dinner") ||
  JSON.stringify(m) === JSON.stringify(afterMeals[i])
));
check("reroll changes dinner", rerolled[2].dinner.recipeId !== week[2].dinner.recipeId);
check("reroll keeps lunch", rerolled[2].lunch.recipeId === week[2].lunch.recipeId);
check("reroll no duplicates", new Set(mealsOf(rerolled).map((m) => m.title)).size === 14);
// With a 14-dish pool every candidate is already used; reroll must relax the
// whole-week uniqueness rule instead of silently doing nothing.
const tinyPool = recipes.slice(0, 14);
const tinyWeek = CMF.buildWeek(tinyPool, [], {}, 7);
check("tiny pool still builds 7 days", tinyWeek.length === 7);
const tinyRerolled = CMF.rerollMeal(tinyWeek, 0, "dinner", tinyPool, [], {}, 31);
check("reroll works with exhausted pool", tinyRerolled[0].dinner.recipeId !== tinyWeek[0].dinner.recipeId);
check("reroll avoids same-day duplicate", tinyRerolled[0].dinner.title !== tinyRerolled[0].lunch.title);

const rerollDay = CMF.rerollDay(week, 1, recipes, [], {}, 123);
check("legacy rerollDay targets lunch", rerollDay[1].lunch.recipeId !== week[1].lunch.recipeId &&
  rerollDay[1].dinner.recipeId === week[1].dinner.recipeId);

// 5. shopping list aggregates 14 meals
const shopping = CMF.weekShopping(week, recipes, []);
check("shopping shape", shopping.every((s) => s.canonical && Array.isArray(s.recipes) && s.recipes.length));
check("shopping dedupes recipe titles", shopping.every((s) => new Set(s.recipes).size === s.recipes.length));
const fullFridge = new Set();
recipes.forEach((r) => r.ingredients.forEach((i) => fullFridge.add(i.canonical)));
check("full fridge no shopping", CMF.weekShopping(week, recipes, [...fullFridge]).length === 0);
check("shopping covers dinner", (() => {
  const dinner = week[0].dinner.recipeId;
  const r = byId.get(dinner);
  const missing = CMF.matchRecipe(r, new Set([])).missing;
  return missing.every((c) => shopping.some((s) => s.canonical === c));
})());

// 6. daily nutrition = lunch + dinner per serving
const day = CMF.weekDayNutrition(week, 0, recipes);
const lunchEst = CMF.estimateNutrition(byId.get(week[0].lunch.recipeId));
const dinnerEst = CMF.estimateNutrition(byId.get(week[0].dinner.recipeId));
check("day nutrition counts 2 meals", day.meals === 2);
check("day kcal sum", day.kcal === lunchEst.perServing.kcal + dinnerEst.perServing.kcal);
check("day carbs sum", Math.abs(day.carbs - (lunchEst.perServing.carbs + dinnerEst.perServing.carbs)) < 0.2);
check("day nutrition missing module safe", (() => {
  const saved = CMF.estimateNutrition;
  CMF.estimateNutrition = undefined;
  const res = CMF.weekDayNutrition(week, 0, recipes);
  CMF.estimateNutrition = saved;
  return res.kcal === 0 && res.meals === 0;
})());

// 7. legacy migration
const legacy = week.map((d) => ({ index: d.index, recipeId: d.lunch.recipeId, title: d.lunch.title }));
check("legacy detected", CMF.isLegacyWeek(legacy));
check("new week not legacy", !CMF.isLegacyWeek(week));
check("weekMeals reads legacy", CMF.weekMeals(legacy).length === 7);
const migrated = CMF.migrateWeek(legacy, recipes, [], {}, 55);
check("migration gives 7 days", migrated.length === 7);
check("migration keeps chosen lunches", migrated.every((d, i) => d.lunch.recipeId === legacy[i].recipeId));
check("migration fills dinners", migrated.every((d) => d.dinner && d.dinner.recipeId));
check("migration has 14 unique dishes", new Set(mealsOf(migrated).map((m) => m.title)).size === 14);
const halfEmpty = [{ index: 0, lunch: week[0].lunch, dinner: null }];
check("fillWeekMeals fills gaps", CMF.fillWeekMeals(halfEmpty, recipes, [], {}, 7)[0].dinner !== null);

// 8. iCalendar export
const START = "2026-11-09"; // a Monday
const ics = CMF.weekToICS(week, recipes, START, { now: "2026-11-07T04:00:00Z" });
check("ics starts/ends", ics.startsWith("BEGIN:VCALENDAR") && ics.trimEnd().endsWith("END:VCALENDAR"));
check("ics CRLF", ics.includes("\r\n") && !/(?<!\r)\n/.test(ics));
check("ics 14 events", (ics.match(/BEGIN:VEVENT/g) || []).length === 14);
check("ics event ends", (ics.match(/END:VEVENT/g) || []).length === 14);
check("ics version", ics.includes("VERSION:2.0") && ics.includes("CALSCALE:GREGORIAN"));
check("ics stamp injected", ics.includes("DTSTAMP:20261107T040000Z"));
check("ics 14 unique UIDs", new Set((ics.match(/UID:[^\r\n]+/g) || [])).size === 14);
check("ics lunch UTC 04:00", ics.includes("DTSTART:20261109T040000Z"));
check("ics lunch end 05:00", ics.includes("DTEND:20261109T050000Z"));
check("ics dinner UTC 10:00", ics.includes("DTSTART:20261109T100000Z"));
check("ics last day", ics.includes("20261115T040000Z"));
check("ics summaries escaped", ics.includes("SUMMARY:🍳 午餐 · "));
check("ics descriptions have ingredients", ics.includes("食材："));
check("ics uses escaped newlines", ics.includes("\\n"));
const tricky = [{
  index: 0,
  lunch: { recipeId: week[0].lunch.recipeId, title: "番茄,炒蛋;家常" },
  dinner: week[0].dinner,
}];
const trickyIcs = CMF.weekToICS(tricky, recipes, START, { now: "2026-11-07T04:00:00Z" });
check("ics escapes commas and semicolons", trickyIcs.includes("番茄\\,炒蛋\\;家常"));
check("ics tz offset override", CMF.weekToICS([week[0]], recipes, START, { now: "2026-11-07T04:00:00Z", tzOffset: 0 })
  .includes("DTSTART:20261109T120000Z"));
check("ics stable with injected now", ics === CMF.weekToICS(week, recipes, START, { now: "2026-11-07T04:00:00Z" }));

// 9. week text & nextMonday
const text = CMF.weekToText(week, START);
check("week text header", text.includes("11/9") && text.includes("11/15"));
check("week text has both meals", text.includes("午餐：") && text.includes("晚餐："));
check("week text 7 days", (text.match(/午餐：/g) || []).length === 7);
check("nextMonday from Saturday", CMF.nextMonday(new Date(2026, 10, 7)).getDate() === 9);
check("nextMonday from Monday", CMF.nextMonday(new Date(2026, 10, 9)).getDate() === 9);
check("nextMonday from Sunday", CMF.nextMonday(new Date(2026, 10, 8)).getDate() === 9);

// 10. fridge cook-now preference
const target = recipes.find((r) => r.ingredients.length <= 6);
if (target) {
  const have = target.ingredients.map((i) => i.canonical);
  check("own ingredients zero missing", CMF.matchRecipe(target, new Set(have)).missingCount === 0);
}

if (failures.length) {
  console.error("PLANNER TEST FAILURES:", failures);
  process.exit(1);
}
console.log(JSON.stringify({ ok: true, checks, days: week.length, meals: mealsOf(week).length, icsBytes: ics.length }));
