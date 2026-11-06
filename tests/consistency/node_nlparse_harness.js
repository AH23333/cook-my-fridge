/* Headless test for the offline natural-language ingredient parser.
   Usage: node node_nlparse_harness.js [project_root] */
const fs = require("fs");
const path = require("path");

const base = process.argv[2] || path.resolve(__dirname, "..", "..");
global.window = {};

function load(rel) {
  // eslint-disable-next-line no-eval
  eval(fs.readFileSync(path.join(base, rel), "utf8"));
}

load("web/js/catalog.js");
load("web/js/nlparse.js");

const CMF = global.window.CMF;
CMF.data = {
  catalog: JSON.parse(fs.readFileSync(path.join(base, "site/data/catalog.json"), "utf8")),
};
CMF.initCatalog();

const failures = [];
function check(name, cond) {
  if (!cond) failures.push(name);
}

function parses(text, expected) {
  const got = CMF.parseIngredients(text);
  expected.forEach((c) => {
    if (!got.includes(c)) failures.push(`"${text}" should include ${c}, got ${got}`);
  });
}

// Basic sentence with real names
parses("我有两个西红柿和一块鸡胸肉", ["番茄", "鸡胸肉"]);

// Synonym recognition (小葱 is a canonical)
parses("一把小葱和三个鸡蛋", ["小葱", "鸡蛋"]);

// Longest match wins: 橄榄油 should not also produce 油
const olive = CMF.parseIngredients("倒点橄榄油");
check("olive oil longest match", olive.includes("橄榄油") && !olive.includes("食用油"));

// Punctuation and full-width handled
parses("番茄，黄瓜。鸡蛋！", ["番茄", "黄瓜", "鸡蛋"]);

// No known ingredient -> empty
check("empty when unknown", CMF.parseIngredients("今天天气不错").length === 0);

// Duplicate mention only returns once
check("dedupe", CMF.parseIngredients("番茄西红柿").length === 1);

// Empty input
check("empty input", CMF.parseIngredients("").length === 0);

// Synonym surface: 芝士 -> 奶酪
check("cheese synonym", CMF.parseIngredients("放点芝士").includes("奶酪"));

// Multi-ingredient realistic sentence
const mix = CMF.parseIngredients("冰箱里有猪肉、土豆和胡萝卜，想做个下饭的");
check("mixed sentence", ["猪肉", "土豆", "胡萝卜"].every((c) => mix.includes(c)));

// New batch-12 ingredients
parses("魔芋丝和裙带菜", ["魔芋", "裙带菜"]);

if (failures.length) {
  console.error("NLPARSE TEST FAILURES:", failures);
  process.exit(1);
}
console.log(JSON.stringify({ ok: true, checks: 11 }));
