/* Headless test for the pure filterRecipes helper in page-browse.js.
 * Loads the real built recipes and asserts filtering semantics.
 */
const fs = require("fs");
const path = require("path");

const root = process.argv[2] || path.resolve(__dirname, "..", "..");

global.window = global;
global.location = { href: "", search: "", protocol: "file:" };
global.document = {
  getElementById: () => null,
  addEventListener() {},
};
global.window.CMF = {
  boots() {},
  esc: (s) => s,
  recipeCard: () => "",
};

const src = fs.readFileSync(
  path.join(root, "web", "js", "page-browse.js"),
  "utf8"
);
(0, eval)(src);
const filterRecipes = global.window.CMF.filterRecipes;

const recipes = JSON.parse(
  fs.readFileSync(path.join(root, "site", "data", "recipes.json"), "utf8")
);

const failures = [];
function check(name, cond) {
  if (!cond) failures.push(name);
}

// No criteria returns everything.
check("empty criteria", filterRecipes(recipes, {}).length === recipes.length);

// Text search narrows to title/ingredient matches.
const tomato = filterRecipes(recipes, { text: "番茄" });
check("text non-empty", tomato.length > 0 && tomato.length < recipes.length);
check(
  "text matches haystack",
  tomato.every(
    (r) =>
      r.title.includes("番茄") ||
      r.ingredients.some((i) => i.canonical.includes("番茄"))
  )
);

// Method filter: every result uses the method.
const stirFry = filterRecipes(recipes, { methods: ["炒"] });
check("method filter", stirFry.every((r) => r.methods.includes("炒")));

// Tag filter.
const veg = filterRecipes(recipes, { tags: ["素食"] });
check("tag filter", veg.every((r) => r.tags.includes("素食")));

// Time cap.
const quick = filterRecipes(recipes, { maxTime: 15 });
check("time cap", quick.every((r) => r.time_minutes <= 15));
check("time cap narrows", quick.length < recipes.length);

// Combined additive criteria.
const combo = filterRecipes(recipes, { text: "土豆", maxTime: 30 });
check(
  "combo",
  combo.every(
    (r) =>
      r.time_minutes <= 30 &&
      (r.title.includes("土豆") ||
        r.ingredients.some((i) => i.canonical.includes("土豆")))
  )
);

if (failures.length) {
  console.error("BROWSE TEST FAILURES:", failures);
  process.exit(1);
}
console.log(
  JSON.stringify({ ok: true, checks: 7, sampleCounts: { tomato: tomato.length, quick: quick.length } })
);
