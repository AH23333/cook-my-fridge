/* Headless test for the pure similarRecipes helper in search.js.
 * Loads the real built recipes and asserts ranking semantics.
 */
const fs = require("fs");
const path = require("path");

const root = process.argv[2] || path.resolve(__dirname, "..", "..");

global.window = global;
global.location = { href: "", search: "", protocol: "file:" };
global.window.CMF = {
  isStaple: () => false,
  substitutionsFor: () => [],
};

const searchSrc = fs.readFileSync(
  path.join(root, "web", "js", "search.js"),
  "utf8"
);
(0, eval)(searchSrc);
const similarRecipes = global.window.CMF.similarRecipes;

const recipes = JSON.parse(
  fs.readFileSync(path.join(root, "site", "data", "recipes.json"), "utf8")
);

const failures = [];
function check(name, cond) {
  if (!cond) failures.push(name);
}

const base = recipes[0];
const similar = similarRecipes(base, recipes, 4);

check("returns up to limit", similar.length <= 4 && similar.length > 0);
check("excludes self", similar.every((r) => r.id !== base.id));
check(
  "all share an ingredient",
  similar.every((r) =>
    r.ingredients.some((i) =>
      base.ingredients.some((b) => b.canonical === i.canonical)
    )
  )
);

// Verify descending shared-count ordering.
const baseSet = new Set(
  base.ingredients.filter((i) => !i.optional).map((i) => i.canonical)
);
function sharedCount(r) {
  return r.ingredients.filter(
    (i) => !i.optional && baseSet.has(i.canonical)
  ).length;
}
const counts = similar.map(sharedCount);
const ordered = counts.every((c, i) => i === 0 || counts[i - 1] >= c);
check("ordered by shared count", ordered);

// A larger limit returns more rows.
const wider = similarRecipes(base, recipes, 10);
check("larger limit", wider.length >= similar.length);

if (failures.length) {
  console.error("SIMILAR TEST FAILURES:", failures);
  process.exit(1);
}
console.log(
  JSON.stringify({ ok: true, checks: 5, top: similar.map((r) => r.title), counts })
);
