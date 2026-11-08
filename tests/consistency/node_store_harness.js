/* Headless test for the real frontend store.js persistence logic.
 * Shims window/localStorage/location/fetch, then asserts toggle behavior.
 * Usage: node node_store_harness.js [project_root]
 */
const fs = require("fs");
const path = require("path");

const root = process.argv[2] || path.resolve(__dirname, "..", "..");

// --- minimal browser shims ---
const mem = new Map();
global.window = global;
global.localStorage = {
  getItem: (k) => (mem.has(k) ? mem.get(k) : null),
  setItem: (k, v) => mem.set(k, String(v)),
  removeItem: (k) => mem.delete(k),
  clear: () => mem.clear(),
};
global.location = { search: "" };
global.fetch = async () => {
  throw new Error("fetch should not be called in this test");
};

// Load the real store.js into the global scope.
const src = fs.readFileSync(path.join(root, "web", "js", "store.js"), "utf8");
(0, eval)(src);

const CMF = global.window.CMF;
const failures = [];
function check(name, cond) {
  if (!cond) failures.push(name);
}

// fridge round trip
CMF.setFridge(["番茄", "鸡蛋"]);
check("fridge round trip", JSON.stringify(CMF.getFridge()) === '["番茄","鸡蛋"]');

// favorites: add then remove
check("fav add returns true", CMF.toggleFavorite("r001") === true);
check("fav stored", JSON.stringify(CMF.getFavorites()) === '["r001"]');
check("fav remove returns false", CMF.toggleFavorite("r001") === false);
check("fav empty", JSON.stringify(CMF.getFavorites()) === "[]");

// plan: add then remove, default shape preserved
check("plan add", CMF.togglePlanRecipe("r002") === true);
check("plan stored", JSON.stringify(CMF.getPlan().recipeIds) === '["r002"]');
check("plan remove", CMF.togglePlanRecipe("r002") === false);

// history is capped at 50 (entries carry the app's real write shape:
// renderHistory maps h.selected, so getHistory drops shapeless junk)
for (let i = 0; i < 60; i++)
  CMF.addHistory({ date: "2026-01-0" + ((i % 9) + 1), selected: ["番茄"] });
check("history capped at 50", CMF.getHistory().length === 50);

// clear history empties the list
CMF.clearHistory();
check("clear history", CMF.getHistory().length === 0);

// malformed JSON falls back instead of throwing
mem.set("cmf.fridge", "{broken");
check("malformed fallback", JSON.stringify(CMF.getFridge()) === "[]");

// export then import round trip
CMF.setFridge(["番茄", "鸡蛋"]);
CMF.toggleFavorite("r005");
const backup = CMF.exportData();
check("export has version", backup.version === 1 && backup.data["cmf.fridge"]);
mem.clear();
const imported = CMF.importData(backup);
check("import count", imported >= 2);
check("import restores fridge", JSON.stringify(CMF.getFridge()) === '["番茄","鸡蛋"]');
check("import restores favorites", JSON.stringify(CMF.getFavorites()) === '["r005"]');

// import rejects malformed payloads
let threw = false;
try {
  CMF.importData({ data: null });
} catch (e) {
  threw = true;
}
check("import validates", threw);

// unknown keys are ignored
const ignored = CMF.importData({ data: { "cmf.unknown": ["x"] } });
check("import ignores unknown", ignored === 0);

// write failure (quota/blocked storage) must be visible, never silent
let toasts = 0;
CMF.toast = () => { toasts += 1; };
const realSetItem = localStorage.setItem;
localStorage.setItem = () => { throw new Error("QuotaExceededError"); };
check("failed write returns false", CMF.setFridge(["黄瓜"]) === false);
check("failed write warns the user", toasts === 1);
check("failed write keeps previous value", mem.get("cmf.fridge") === '["番茄","鸡蛋"]');
localStorage.setItem = realSetItem;
check("write recovers after storage returns", CMF.setFridge(["黄瓜"]) === true);

if (failures.length) {
  console.error("STORE TEST FAILURES:", failures);
  process.exit(1);
}
console.log(JSON.stringify({ ok: true, checks: 21 }));
