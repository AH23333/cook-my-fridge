/* Headless tests for multi-week menus, cross-week shopping, calendar export
   and calendar subscription helpers.
   Usage: node node_menu_harness.js [project_root] */
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
const byId = new Map(recipes.map((r) => [r.id, r]));
const START = "2026-11-09"; // Monday

// 1. 1-4 weeks
for (let weeks = 1; weeks <= 4; weeks += 1) {
  const menu = CMF.buildMenu(weeks, recipes, [], {}, 42);
  const meals = CMF.weekMeals(menu);
  check(weeks + "w days", menu.length === weeks * 7);
  check(weeks + "w meals", meals.length === weeks * 14);
  check(weeks + "w sequential indices", menu.every((d, i) => d.index === i));
  check(weeks + "w every slot filled", menu.every((d) => d.lunch && d.dinner));
  check(weeks + "w unique titles", new Set(meals.map((m) => m.title)).size === weeks * 14);
  check(weeks + "w valid ids", meals.every((m) => byId.has(m.recipeId)));
  check(weeks + "w week count", CMF.menuWeekCount(menu) === weeks);
  check(weeks + "w deterministic", JSON.stringify(menu) === JSON.stringify(CMF.buildMenu(weeks, recipes, [], {}, 42)));
}
check("empty menu week count", CMF.menuWeekCount([]) === 0);
check("week options", JSON.stringify(CMF.MENU_WEEK_OPTIONS) === "[1,2,3,4]");
check("max weeks clamp", CMF.buildMenu(99, recipes, [], {}, 42).length === 28);
check("seed matters across weeks", JSON.stringify(CMF.buildMenu(2, recipes, [], {}, 42)) !==
  JSON.stringify(CMF.buildMenu(2, recipes, [], {}, 777)));

// 2. grow / shrink without discarding hand-picked meals
const one = CMF.buildMenu(1, recipes, [], {}, 42);
const grown = CMF.resizeMenu(one, 3, recipes, [], {}, 43);
check("grow to 3 weeks", grown.length === 21);
check("grow preserves first week", JSON.stringify(grown.slice(0, 7)) === JSON.stringify(one));
check("grow indices", grown.every((d, i) => d.index === i));
check("grow unique titles", new Set(CMF.weekMeals(grown).map((m) => m.title)).size === 42);
const shrunk = CMF.resizeMenu(grown, 1, recipes, [], {}, 43);
check("shrink to 1 week", shrunk.length === 7 && JSON.stringify(shrunk) === JSON.stringify(one));
check("shrink keeps indices", shrunk.every((d, i) => d.index === i));
check("resize is idempotent", JSON.stringify(CMF.resizeMenu(grown, 3, recipes, [], {}, 43)) === JSON.stringify(grown));

// 3. strict filters and tiny pools
const vegan = CMF.buildMenu(2, recipes, [], { diets: ["vegan"] }, 11);
check("vegan 2 weeks filled", vegan.length === 14);
check("vegan filter on every meal", CMF.weekMeals(vegan).every((m) =>
  CMF.matchesDiet(byId.get(m.recipeId), "vegan")));
const tiny = recipes.slice(0, 14);
const tinyMenu = CMF.buildMenu(4, tiny, [], {}, 7);
check("tiny pool builds 4 weeks", tinyMenu.length === 28);
check("tiny pool unique within each week", [0, 1, 2, 3].every((w) => {
  const titles = CMF.weekMeals(tinyMenu).filter((m) => Math.floor(m.index / 7) === w).map((m) => m.title);
  return titles.length === 14 && new Set(titles).size === 14;
}));
check("diet fail-closed in multi-week", (() => {
  const saved = CMF.matchesDiets;
  CMF.matchesDiets = undefined;
  const res = CMF.buildMenu(2, recipes, [], { diets: ["vegan"] }, 11);
  CMF.matchesDiets = saved;
  return res.length === 0;
})());

// 4. reroll targets one slot even in week 3
const rerolled = CMF.rerollMeal(grown, 17, "dinner", recipes, [], {}, 99);
const beforeMeals = CMF.weekMeals(grown);
const afterMeals = CMF.weekMeals(rerolled);
check("multiweek reroll keeps 42 meals", afterMeals.length === 42);
check("multiweek reroll changes only target", beforeMeals.every((m, i) =>
  (m.index === 17 && m.meal === "dinner") || JSON.stringify(m) === JSON.stringify(afterMeals[i])));
check("multiweek reroll changes dish", rerolled[17].dinner.recipeId !== grown[17].dinner.recipeId);

// 5. cross-week shopping list
const shopping = CMF.weekShopping(grown, recipes, []);
check("shopping weeks arrays", shopping.every((s) => Array.isArray(s.weeks) && s.weeks.length));
check("shopping weeks in range", shopping.every((s) => s.weeks.every((w) => w >= 0 && w <= 2)));
check("shopping weeks sorted", shopping.every((s) => s.weeks.every((w, i) => i === 0 || s.weeks[i - 1] < w)));
check("shopping dedupes recipe titles", shopping.every((s) => new Set(s.recipes).size === s.recipes.length));
check("menuShopping alias", CMF.menuShopping === CMF.weekShopping);
check("shopping has multi-week ingredient", shopping.some((s) => s.weeks.length > 1));

// 6. calendar export across weeks
const ics = CMF.weekToICS(CMF.buildMenu(4, recipes, [], {}, 42), recipes, START, { now: "2026-11-07T04:00:00Z" });
check("ics 56 events", (ics.match(/BEGIN:VEVENT/g) || []).length === 56);
check("ics 56 unique UIDs", new Set(ics.match(/UID:[^\r\n]+/g) || []).size === 56);
check("ics CRLF", ics.includes("\r\n") && !/(?<!\r)\n/.test(ics));
check("ics calendar name", ics.includes("X-WR-CALNAME:CookMyFridge 4 周菜单"));
check("ics description week number", ics.includes("第 4 周"));
check("ics last day", ics.includes("20261206T040000Z"));
check("ics first day", ics.includes("20261109T040000Z"));
check("ics escapes descriptions", ics.includes("\\n") && ics.includes("SUMMARY:🍳"));
check("single week keeps old name", CMF.weekToICS(one, recipes, START, { now: "2026-11-07T04:00:00Z" })
  .includes("X-WR-CALNAME:CookMyFridge 一周菜单"));
check("menuToICS alias", CMF.menuToICS === CMF.weekToICS);

// 7. text export
const text = CMF.weekToText(CMF.buildMenu(4, recipes, [], {}, 42), START);
check("text 28 lunches", (text.match(/午餐：/g) || []).length === 28);
check("text 4 week headers", (text.match(/第 \d 周（/g) || []).length === 4);
check("text header range", text.includes("11/9") && text.includes("12/6"));
check("single week text unchanged shape", (CMF.weekToText(one, START).match(/午餐：/g) || []).length === 7);
check("menuToText alias", CMF.menuToText === CMF.weekToText);

// 8. balance integration & subscription constants
const four = CMF.buildMenu(4, recipes, [], {}, 42);
check("balanceMenu 28 rows", CMF.balanceMenu(four, recipes).days.length === 28);
check("balanceMenu weak subset", CMF.balanceMenu(four, recipes).weak.every((i) => i >= 0 && i < 28));
check("optimize multi-week", (() => {
  const r = CMF.optimizeMenu(four, recipes, [], {}, 3);
  return r.days.length === 28 && r.after >= r.before;
})());
check("calendar cache constant", CMF.CALENDAR_CACHE === "cmf-calendar-v1");
check("calendar path constant", CMF.CALENDAR_PATH === "calendar.ics");

// 9. legacy data still migrates
const legacy = one.map((d) => ({ index: d.index, recipeId: d.lunch.recipeId, title: d.lunch.title }));
const migrated = CMF.migrateWeek(legacy, recipes, [], {}, 55);
check("legacy detected", CMF.isLegacyWeek(legacy));
check("legacy keeps lunches", migrated.every((d, i) => d.lunch.recipeId === legacy[i].recipeId));
check("legacy fills dinners", migrated.every((d) => d.dinner && d.dinner.recipeId));

if (failures.length) {
  console.error("MENU TEST FAILURES:", failures);
  process.exit(1);
}
console.log(JSON.stringify({ ok: true, checks, weeks: 4, icsBytes: ics.length }));
