/* Headless test for the pure co-occurrence pairing helper.
 * Uses a hand-built mini dataset for exact semantics, then the real
 * exported site data for a smoke check on real ingredients. */
const fs = require("fs");
const path = require("path");

const root = process.argv[2] || path.resolve(__dirname, "..", "..");
global.window = global;
const src = fs.readFileSync(path.join(root, "web", "js", "pairings.js"), "utf8");
(0, eval)(src);
const CMF = global.window.CMF;

const failures = [];
function check(name, cond) {
  if (!cond) failures.push(name);
}

function ing(name, optional) {
  return { canonical: name, optional: !!optional };
}
const mini = [
  { ingredients: [ing("番茄"), ing("鸡蛋"), ing("盐"), ing("食用油")] },
  { ingredients: [ing("番茄"), ing("鸡蛋"), ing("盐")] },
  { ingredients: [ing("番茄"), ing("鸡蛋"), ing("黄瓜")] },
  { ingredients: [ing("番茄"), ing("黄瓜"), ing("盐")] },
  { ingredients: [ing("番茄"), ing("菠菜"), ing("鸡蛋", true)] }, // optional egg is ignored
  { ingredients: [ing("鸡蛋"), ing("盐")] },
  { ingredients: [ing("菠菜"), ing("鸡蛋")] },
  { ingredients: [ing("番茄"), ing("冬瓜")] },
];
const staples = new Set(["盐", "食用油"]);
CMF.buildPairingIndex(mini, { isStaple: (n) => staples.has(n) });

const tomato = CMF.topPairings("番茄", 6);
const egg = CMF.topPairings("鸡蛋", 6);

check("co-occurrence count is exact", tomato[0].canonical === "鸡蛋" && tomato[0].count === 3);
check("optional ingredients are ignored", tomato[0].count === 3);
check("pantry staples are filtered", tomato.every((p) => !staples.has(p.canonical)));
check("ordered by count desc", tomato.every((p, i) => i === 0 || tomato[i - 1].count >= p.count));
check(
  "ties ordered by canonical",
  tomato[2].canonical === "冬瓜" && tomato[3].canonical === "菠菜" && tomato[2].count === tomato[3].count
);
check("limit is honoured", CMF.topPairings("番茄", 2).length === 2);
check("limit 0 returns empty", CMF.topPairings("番茄", 0).length === 0);
check("default limit is 6", CMF.topPairings("番茄").length <= 6);
check("unknown ingredient returns empty", CMF.topPairings("并不存在的食材").length === 0);
check("empty argument returns empty", CMF.topPairings(null).length === 0);
check(
  "pairing is symmetric with the same count",
  egg.some((p) => p.canonical === "番茄" && p.count === tomato[0].count)
);
check("empty recipe list does not crash", (() => {
  CMF.buildPairingIndex([], { isStaple: (n) => staples.has(n) });
  return CMF.topPairings("番茄").length === 0;
})());
check("rebuilding the index invalidates the cache", (() => {
  CMF.buildPairingIndex(mini.slice(0, 2), { isStaple: (n) => staples.has(n) });
  return CMF.topPairings("番茄")[0].count === 2;
})());
check("custom isStaple injection is used", (() => {
  CMF.buildPairingIndex(mini, { isStaple: (n) => n === "黄瓜" });
  return CMF.topPairings("番茄").every((p) => p.canonical !== "黄瓜");
})());

// --- Real exported data smoke checks ---
const catalog = JSON.parse(
  fs.readFileSync(path.join(root, "site", "data", "catalog.json"), "utf8")
);
const recipes = JSON.parse(
  fs.readFileSync(path.join(root, "site", "data", "recipes.json"), "utf8")
);
const realStaples = new Set(catalog.pantry_staples);
const known = new Set(catalog.ingredients.map((e) => e.canonical));
CMF.buildPairingIndex(recipes, { isStaple: (n) => realStaples.has(n) });
const realEgg = CMF.topPairings("鸡蛋", 6);
const realTomato = CMF.topPairings("番茄", 6);

check("real data: egg pairing is not salt/oil", realEgg.length > 0 && realEgg.every((p) => !realStaples.has(p.canonical)));
check("real data: tomato still pairs with egg", realTomato.some((p) => p.canonical === "鸡蛋"));
check("real data: every result is in the catalog", realEgg.concat(realTomato).every((p) => known.has(p.canonical)));

if (failures.length) {
  console.error("PAIRING TEST FAILURES:", failures);
  process.exit(1);
}
console.log(JSON.stringify({ ok: true, checks: 17, tomato, realEgg }));
