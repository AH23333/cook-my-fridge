/* Headless tests for week-split shopping lists and CSV/TXT export.
   Usage: node node_shopping_harness.js [project_root] */
const fs = require("fs");
const path = require("path");

const base = process.argv[2] || path.resolve(__dirname, "..", "..");
global.window = {};
global.localStorage = {
  getItem: () => null,
  setItem: () => {},
  removeItem: () => {},
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
const r0 = recipes[0];
const r1 = recipes[1];
const meal = (r) => ({ recipeId: r.id, title: r.title });

// 1. deterministic hand-built menu: the same dish in week 0 and week 1
const days = [
  { index: 0, lunch: meal(r0), dinner: meal(r1) },
  { index: 7, lunch: meal(r0), dinner: meal(r1) },
  { index: 14, lunch: meal(r0), dinner: meal(r1) },
];
const groups = CMF.weeklyShopping(days, recipes, []);
check("category vocabulary", CMF.SHOPPING_CATEGORIES.length === 9);
check("three week groups", groups.length === 3);
check("labels", groups.map((g) => g.label).join("|") === "第 1 周|第 2 周|第 3 周");
check("week index", groups.map((g) => g.week).join(",") === "0,1,2");
check("totals positive", groups.every((g) => g.total > 0));
check("total equals items", groups.every((g) => g.total === g.items.length));
check("item shape", groups[0].items.every((i) =>
  i.canonical && i.category && Array.isArray(i.recipes) && Array.isArray(i.meals)));
check("same ingredient repeats across weeks", groups[0].items.some((a) =>
  groups[1].items.some((b) => b.canonical === a.canonical)));
check("no duplicate inside a week", groups.every((g) =>
  new Set(g.items.map((i) => i.canonical)).size === g.items.length));
check("category sorted", groups.every((g) => {
  const ranks = g.items.map((i) => {
    const n = CMF.SHOPPING_CATEGORIES.indexOf(i.category);
    return n < 0 ? 99 : n;
  });
  return ranks.every((v, idx) => idx === 0 || v >= ranks[idx - 1]);
}));
check("fridge removes ingredients", (() => {
  const all = CMF.weeklyShopping([days[0]], recipes, []);
  const need = all[0].items[0].canonical;
  const withFridge = CMF.weeklyShopping([days[0]], recipes, [need]);
  return !withFridge[0].items.some((i) => i.canonical === need);
})());
check("pantry staples excluded", groups.every((g) =>
  g.items.every((i) => !CMF.isStaple(i.canonical))));
check("empty menu gives one empty group", (() => {
  const g = CMF.weeklyShopping([], recipes, []);
  return g.length === 1 && g[0].total === 0;
})());
check("missing recipe ids ignored", (() => {
  const broken = [{ index: 0, lunch: { recipeId: "nope", title: "无" }, dinner: null }];
  return CMF.weeklyShopping(broken, recipes, []).every((g) => g.total === 0);
})());
check("no recipes array safe", CMF.weeklyShopping(days, [], []).every((g) => g.total === 0));
check("flat list agrees on canonicals", (() => {
  const flat = new Set(CMF.weekShopping(days, recipes, []).map((x) => x.canonical));
  const split = new Set(groups.flatMap((g) => g.items.map((i) => i.canonical)));
  return flat.size === split.size && [...flat].every((x) => split.has(x));
})());
check("deterministic", JSON.stringify(groups) === JSON.stringify(CMF.weeklyShopping(days, recipes, [])));
check("recipes deduplicated per item", groups[0].items.every((i) =>
  new Set(i.recipes).size === i.recipes.length));
check("meal count recorded", groups[0].items.some((i) => i.meals.length >= 2));

// 2. CSV export
const csv = CMF.shoppingToCSV(groups, { checked: ["0:" + groups[0].items[0].canonical] });
check("csv BOM", csv.charCodeAt(0) === 0xfeff);
check("csv CRLF", csv.includes("\r\n") && !/(^|[^\r])\n/.test(csv.slice(1)));
check("csv header", csv.includes("周次,分类,食材,用于菜谱数,菜谱,已买"));
check("csv trailing CRLF", csv.endsWith("\r\n"));
check("csv row count", csv.trim().split("\r\n").length ===
  1 + groups.reduce((s, g) => s + g.total, 0));
check("csv weekly labels", csv.includes("第 1 周") && csv.includes("第 3 周"));
check("csv checked flag", csv.split("\r\n")[1].endsWith("是"));
check("csv unchecked flag", csv.split("\r\n")[2].endsWith("否"));
check("csv empty only header", (() => {
  const c = CMF.shoppingToCSV([{ week: 0, label: "第 1 周", items: [], total: 0 }]);
  return c.trim().split("\r\n").length === 1;
})());
check("csv null groups safe", CMF.shoppingToCSV(null).includes("周次"));
const tricky = [{
  week: 0, label: "第 1 周", total: 2,
  items: [
    { canonical: '番茄,大"个', category: "蔬菜", recipes: ["A,B", 'C"D'], meals: ["lunch"] },
    { canonical: "换行\n食材", category: "蔬菜", recipes: ["E"], meals: ["dinner"] },
  ],
}];
const trickyCsv = CMF.shoppingToCSV(tricky);
check("csv quotes commas", trickyCsv.includes('"番茄,大""个"'));
check("csv quotes recipes", trickyCsv.includes('"A,B、C""D"'));
check("csv quotes newlines", trickyCsv.includes('"换行\n食材"'));
check("csv escapes all six columns", (() => {
  const first = trickyCsv.split("\r\n")[1];
  return first.includes('"') && first.endsWith("否");
})());

// 3. TXT export
const labels = ["第 1 周（1/1 – 1/7）", "第 2 周（1/8 – 1/14）", "第 3 周（1/15 – 1/21）"];
const text = CMF.shoppingToText(groups, { weekLabels: labels, checked: ["1:" + groups[1].items[0].canonical] });
check("text title", text.startsWith("CookMyFridge 采购清单（按周拆分）"));
check("text total", text.includes("共 3 周 · " + groups.reduce((s, g) => s + g.total, 0) + " 项"));
check("text uses custom labels", labels.every((l) => text.includes(l)));
check("text groups", (text.match(/【第/g) || []).length === 3);
check("text checkboxes", text.includes("- [ ]") && text.includes("- [x]"));
check("text categories", text.includes("蔬菜：") || text.includes("肉蛋："));
check("text recipe names", text.includes("用于 "));
check("text disclaimer", text.includes("常备调料不计入"));
check("text LF only", !text.includes("\r"));
check("text empty weeks", CMF.shoppingToText([{ week: 0, label: "第 1 周", items: [], total: 0 }])
  .includes("本周无需额外采购"));
check("text null safe", CMF.shoppingToText(null).includes("共 0 周 · 0 项"));
check("text no undefined", !text.includes("undefined") && !text.includes("NaN"));

// 4. real planner menus 1-4 weeks
let realOk = true;
for (let weeks = 1; weeks <= 4; weeks += 1) {
  const menu = CMF.buildMenu(weeks, recipes, [], {}, 31);
  const g = CMF.weeklyShopping(menu, recipes, []);
  if (g.length !== weeks) realOk = false;
  if (g.some((x) => x.items.some((i) => !CMF.SHOPPING_CATEGORIES.includes(i.category)))) realOk = false;
  if (g.some((x) => x.items.some((i) => !CMF.isKnown(i.canonical)))) realOk = false;
  const c = CMF.shoppingToCSV(g);
  const t = CMF.shoppingToText(g);
  if (!c.endsWith("\r\n") || !t.includes("周")) realOk = false;
  check(`${weeks}w menu splits into ${weeks} groups`, g.length === weeks);
  check(`${weeks}w all items known`, g.every((x) => x.items.every((i) => CMF.isKnown(i.canonical))));
  check(`${weeks}w csv rows`, c.trim().split("\r\n").length ===
    1 + g.reduce((s, x) => s + x.total, 0));
}
check("all real menus valid", realOk);
check("dataset size", recipes.length >= 210);

if (failures.length) {
  console.error("SHOPPING TEST FAILURES:", failures);
  process.exit(1);
}
console.log(JSON.stringify({ ok: true, checks, weeks: groups.length }));
