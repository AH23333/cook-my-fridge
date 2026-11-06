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

// history is capped at 50
for (let i = 0; i < 60; i++) CMF.addHistory({ id: "r" + i });
check("history capped at 50", CMF.getHistory().length === 50);

// clear history empties the list
CMF.clearHistory();
check("clear history", CMF.getHistory().length === 0);

// malformed JSON falls back instead of throwing
mem.set("cmf.fridge", "{broken");
check("malformed fallback", JSON.stringify(CMF.getFridge()) === "[]");

if (failures.length) {
  console.error("STORE TEST FAILURES:", failures);
  process.exit(1);
}
console.log(JSON.stringify({ ok: true, checks: 10 }));
