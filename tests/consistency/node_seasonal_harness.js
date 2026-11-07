/* Headless test for seasonal.js (solar terms + in-season ranking).
   Usage: node node_seasonal_harness.js [project_root] */
const fs = require("fs");
const path = require("path");

const base = process.argv[2] || path.resolve(__dirname, "..", "..");
global.window = {};

function load(rel) {
  // eslint-disable-next-line no-eval
  eval(fs.readFileSync(path.join(base, rel), "utf8"));
}

load("web/js/catalog.js");
load("web/js/seasonal.js");

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

const terms = CMF.data.catalog.seasonal.solar_terms;
check("24 terms shipped", terms.length === 24);

// Boundary and wrap behavior mirrors the Python implementation.
check("xiaohan boundary", CMF.solarTermOn(new Date(2026, 0, 6), terms).name === "小寒");
check("before xiaohan wraps to dongzhi", CMF.solarTermOn(new Date(2026, 0, 5), terms).name === "冬至");
check("wrap year is previous", CMF.solarTermOn(new Date(2026, 0, 5), terms).year === 2025);
check("chunfen", CMF.solarTermOn(new Date(2026, 2, 21), terms).name === "春分");
check("day before chunfen", CMF.solarTermOn(new Date(2026, 2, 20), terms).name === "惊蛰");
check("year end dongzhi", CMF.solarTermOn(new Date(2026, 11, 31), terms).name === "冬至");
const lidong = CMF.solarTermOn(new Date(2026, 10, 7), terms);
check("lidong next is xiaoxue", lidong.name === "立冬" && lidong.next.name === "小雪");
check("null table safe", CMF.solarTermOn(new Date(), null) === null);

// Convenience wrapper reads the shipped shard.
check("currentSolarTerm works", !!CMF.currentSolarTerm(new Date(2026, 5, 21)).name);

// Seasonal membership.
check("watermelon in july", CMF.isInSeason("西瓜", 7));
check("watermelon not in january", !CMF.isInSeason("西瓜", 1));
check("unknown ingredient", !CMF.isInSeason("不存在的菜", 7));
check("july names non-empty", CMF.seasonalNames(7).length > 5);
check("every month covered", [...Array(12)].every((_, i) => CMF.seasonalNames(i + 1).length > 0));
check("bad month empty", CMF.seasonalNames(13).length === 0);

// Recipe ranking on the real dataset.
const picks = CMF.seasonalRecipes(CMF.data.recipes, 7, 3);
check("summer picks exist", picks.length === 3);
check("picks carry hits", picks.every((p) => p.hits >= 1 && p.used.length === p.hits));
check("sorted by hits desc", picks[0].hits >= picks[1].hits && picks[1].hits >= picks[2].hits);
check("limit respected", CMF.seasonalRecipes(CMF.data.recipes, 7, 1).length === 1);
check("deterministic", JSON.stringify(CMF.seasonalRecipes(CMF.data.recipes, 7, 3)) === JSON.stringify(picks));
const winter = CMF.seasonalRecipes(CMF.data.recipes, 12, 3);
check("winter differs from summer", winter[0].recipe.id !== picks[0].recipe.id || winter[0].hits !== picks[0].hits);

// Graceful degradation when the shard is missing.
const saved = CMF.data.catalog;
CMF.data.catalog = {};
check("no shard: term null", CMF.currentSolarTerm(new Date()) === null);
check("no shard: names empty", CMF.seasonalNames(7).length === 0);
check("no shard: in season false", !CMF.isInSeason("西瓜", 7));
check("no shard: recipes empty", CMF.seasonalRecipes(CMF.data.recipes, 7, 3).length === 0);
CMF.data.catalog = saved;

if (failures.length) {
  console.error("SEASONAL TEST FAILURES:", failures);
  process.exit(1);
}
console.log(JSON.stringify({ ok: true, checks }));