/* Headless test for journal.js (check-ins, streaks, badges, trends).
   Usage: node node_journal_harness.js [project_root] */
const fs = require("fs");
const path = require("path");

const base = process.argv[2] || path.resolve(__dirname, "..", "..");

const mem = new Map();
global.window = global;
global.localStorage = {
  getItem: (k) => (mem.has(k) ? mem.get(k) : null),
  setItem: (k, v) => mem.set(k, String(v)),
  removeItem: (k) => mem.delete(k),
};
global.location = { search: "" };

function load(rel) {
  // eslint-disable-next-line no-eval
  eval(fs.readFileSync(path.join(base, rel), "utf8"));
}

load("web/js/store.js");
load("web/js/catalog.js");
load("web/js/nutrition.js");
load("web/js/prices.js");
load("web/js/journal.js");

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

const recipe = CMF.data.recipes.find((r) => r.id === "r001");
const today = new Date(2026, 10, 7, 12, 0, 0); // local noon, stable across TZ

// normalize guards
check("normalize null", CMF.normalizeJournal(null).cooked.length === 0);
check("normalize junk entries", CMF.normalizeJournal({ cooked: [null, {}, { recipeId: "r001" }] }).cooked.length === 0);
check("normalize array input", CMF.normalizeJournal([1, 2]).cooked.length === 0);

// logCooked writes through store.js and snapshots nutrition + cost
const entry = CMF.logCooked(recipe, { rating: 5, note: "好吃", factor: 2, now: today });
check("entry persisted", CMF.getJournal().cooked.length === 1);
check("entry fields", entry.recipeId === "r001" && entry.rating === 5 && entry.factor === 2);
check("kcal snapshot", typeof entry.kcal === "number" && entry.kcal > 0);
check("cost snapshot", typeof entry.cost === "number" && entry.cost > 0);
check("rating map", CMF.getJournal().ratings.r001 === 5);
check("note map", CMF.getJournal().notes.r001 === "好吃");
check("count for recipe", CMF.cookedCountFor(CMF.getJournal(), "r001") === 1);

// rating clamped, note trimmed and capped
CMF.logCooked(recipe, { rating: 99, note: "x".repeat(900), now: today });
check("rating clamped to 5", CMF.getJournal().cooked[0].rating === 5);
check("note capped 500", CMF.getJournal().cooked[0].note.length === 500);
CMF.logCooked(recipe, { rating: -3, now: today });
check("negative rating becomes 0", CMF.getJournal().cooked[0].rating === 0);

// journal survives export/import round trip (store KEYS coverage)
const backup = CMF.exportData();
check("backup includes journal", backup.data["cmf.journal"].cooked.length === 3);
mem.clear();
CMF.importData(backup);
check("restore journal", CMF.getJournal().cooked.length === 3);

// summary
const summary = CMF.journalSummary(CMF.getJournal());
check("summary total", summary.total === 3);
check("summary distinct", summary.distinct === 1);
check("summary avg rating", summary.avgRating === 5);

// streak: cook today + 2 previous days, gap, then older day
mem.clear();
const day = (offset) => {
  const d = new Date(today);
  d.setDate(d.getDate() - offset);
  return d;
};
[0, 1, 2, 4].forEach((offset) => CMF.logCooked(recipe, { now: day(offset) }));
check("streak 3 across gap", CMF.journalStreak(CMF.getJournal(), today) === 3);
mem.clear();
[1, 2, 3].forEach((offset) => CMF.logCooked(recipe, { now: day(offset) }));
check("streak alive before today's dinner", CMF.journalStreak(CMF.getJournal(), today) === 3);
mem.clear();
CMF.logCooked(recipe, { now: day(3) });
check("broken streak zero", CMF.journalStreak(CMF.getJournal(), today) === 0);
check("empty streak zero", CMF.journalStreak({ cooked: [] }, today) === 0);

// top rated aggregation
mem.clear();
CMF.logCooked(recipe, { rating: 4, now: today });
CMF.logCooked(recipe, { rating: 2, now: today });
const other = CMF.data.recipes.find((r) => r.id === "r002");
CMF.logCooked(other, { rating: 5, now: today });
const top = CMF.topRated(CMF.getJournal(), 5);
check("top rated order", top[0].recipeId === "r002" && top[0].avg === 5);
check("avg aggregated", top[1].avg === 3 && top[1].count === 2);
check("unrated excluded", CMF.topRated({ cooked: [{ recipeId: "x", title: "x", rating: 0 }] }).length === 0);

// weekly trend shape and sums
const trend = CMF.weeklyTrend(CMF.getJournal(), 7, today);
check("trend 7 days", trend.length === 7);
check("trend oldest first", trend[6].day === CMF.localDay(today));
check("trend today count", trend[6].count === 3);
check("trend kcal sums", trend[6].kcal > 0);
check("trend empty day zero", trend[0].count === 0 && trend[0].kcal === 0);

// achievements
mem.clear();
CMF.logCooked(recipe, { now: today });
const badges = CMF.achievements({
  journal: CMF.getJournal(),
  favorites: ["r001"],
  fridge: ["番茄"],
  plan: ["r001"],
  shareStats: { total: 0 },
  today,
});
check("nine badges", badges.length === 9);
check("first earned", badges.find((b) => b.key === "first").earned === true);
check("streak3 not earned", badges.find((b) => b.key === "streak3").earned === false);
check("progress capped", badges.find((b) => b.key === "fav10").progress === 1);
const rich = CMF.achievements({
  journal: CMF.getJournal(),
  favorites: Array.from({ length: 12 }, (_, i) => `f${i}`),
  fridge: Array.from({ length: 10 }, (_, i) => `i${i}`),
  plan: Array.from({ length: 5 }, (_, i) => `p${i}`),
  shareStats: { total: 6 },
  today,
});
check("collector badges earned", ["fav10", "fridge10", "plan5", "share5"].every((k) => rich.find((b) => b.key === k).earned));

// entry cap
mem.clear();
for (let i = 0; i < 520; i += 1) CMF.logCooked(recipe, { now: today });
check("entries capped at 500", CMF.getJournal().cooked.length === 500);

const hostile = '<img src=x onerror="window.journalInjected=true">';
const clean = CMF.normalizeJournal({
  ratings: { r001: hostile, r002: 4, r003: "5", r004: Infinity, r005: -1 },
  notes: { r001: hostile, r002: {}, r003: "x".repeat(600) },
  cooked: [{ ...entry, rating: hostile, cost: "bad", kcal: Infinity },
    { ...entry, id: "invalid-date", date: "not a date" }],
});
check("import rating rejects markup", !Object.hasOwn(clean.ratings, "r001"));
check("import keeps valid rating", clean.ratings.r002 === 4);
check("import rejects nonnumeric and out-of-range ratings", Object.keys(clean.ratings).length === 1);
check("import notes remain text", clean.notes.r001 === hostile && !Object.hasOwn(clean.notes, "r002"));
check("import note length bounded", clean.notes.r003.length === 500);
check("import invalid date rejected", clean.cooked.length === 1);
check("import cooked rating sanitized", clean.cooked[0].rating === 0);
check("import nonfinite snapshots dropped", clean.cooked[0].kcal === null && clean.cooked[0].cost === null);
check("import array maps rejected", Object.keys(CMF.normalizeJournal({ ratings: [5], notes: ["x"] }).ratings).length === 0);
check("normalization does not mutate source", entry.rating === 5);

mem.clear();
for (const scale of [0.5, 1, 2, 3]) {
  const scaled = CMF.logCooked(recipe, { factor: scale, now: today });
  check("kcal scaled exactly once " + scale, scaled.kcal === CMF.estimateNutrition(recipe, scale).perServing.kcal);
}
const beforeFailure = localStorage.getItem("cmf.journal");
const originalSetItem = localStorage.setItem;
localStorage.setItem = () => { throw new Error("QuotaExceededError"); };
check("failed write returns null", CMF.logCooked(recipe, { note: "keep draft", now: today }) === null);
check("failed write preserves stored journal", localStorage.getItem("cmf.journal") === beforeFailure);
localStorage.setItem = originalSetItem;
check("retry writes successfully", CMF.logCooked(recipe, { note: "keep draft", now: today }).note === "keep draft");

if (failures.length) {
  console.error("JOURNAL TEST FAILURES:", failures);
  process.exit(1);
}
console.log(JSON.stringify({ ok: true, checks }));