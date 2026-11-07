/* Headless test for tools.js (kitchen conversions, pure offline).
   Usage: node node_tools_harness.js [project_root] */
const fs = require("fs");
const path = require("path");

const base = process.argv[2] || path.resolve(__dirname, "..", "..");
global.window = {};

function load(rel) {
  // eslint-disable-next-line no-eval
  eval(fs.readFileSync(path.join(base, rel), "utf8"));
}
load("web/js/tools.js");

const CMF = global.window.CMF;
const failures = [];
let checks = 0;
function check(name, cond) {
  checks += 1;
  if (!cond) failures.push(name);
}

// Volume units.
check("cup to ml", CMF.volumeToMl(1, "杯") === 240);
check("teaspoon to ml", CMF.volumeToMl(1, "小勺") === 5);
check("茶匙 alias", CMF.volumeToMl(2, "茶匙") === 10);
check("tablespoon to ml", CMF.volumeToMl(1, "勺") === 15);
check("汤匙 alias", CMF.volumeToMl(1, "汤匙") === 15);
check("大勺 alias", CMF.volumeToMl(1, "大勺") === 15);
check("bowl to ml", CMF.volumeToMl(1, "碗") === 300);
check("ml passthrough", CMF.volumeToMl(250, "ml") === 250);
check("毫升 alias", CMF.volumeToMl(250, "毫升") === 250);
check("fractional cups", CMF.volumeToMl(2.5, "杯") === 600);
check("string number", CMF.volumeToMl("2", "杯") === 480);
check("unknown unit null", CMF.volumeToMl(1, "加仑") === null);
check("negative null", CMF.volumeToMl(-1, "杯") === null);
check("NaN null", CMF.volumeToMl("abc", "杯") === null);
check("zero ok", CMF.volumeToMl(0, "杯") === 0);

// Reverse conversion.
check("ml to cup", CMF.mlToUnit(240, "杯") === 1);
check("ml to tablespoon", CMF.mlToUnit(45, "勺") === 3);
check("ml rounding", CMF.mlToUnit(100, "杯") === 0.42);
check("ml unknown unit", CMF.mlToUnit(100, "品脱") === null);
check("ml negative", CMF.mlToUnit(-5, "杯") === null);

// Density math.
check("flour cup grams", CMF.gramsForVolume(240, "面粉") === 132);
check("milk cup grams", CMF.gramsForVolume(240, "牛奶") === 247.2);
check("sugar cup grams", CMF.gramsForVolume(240, "白糖") === 204);
check("oil tablespoon", CMF.gramsForVolume(15, "食用油") === 13.8);
check("honey density", CMF.gramsForVolume(100, "蜂蜜") === 140);
check("unknown ingredient null", CMF.gramsForVolume(240, "番茄") === null);
check("negative ml null", CMF.gramsForVolume(-10, "面粉") === null);
check("volumeToGrams chain", CMF.volumeToGrams(1, "杯", "面粉") === 132);
check("volumeToGrams bad unit", CMF.volumeToGrams(1, "加仑", "面粉") === null);
check("volumeToGrams unknown ingredient", CMF.volumeToGrams(1, "杯", "西兰花") === null);

// Oven temperatures.
check("350F to C", CMF.fToC(350) === 177);
check("freezing F", CMF.fToC(32) === 0);
check("boiling F", CMF.fToC(212) === 100);
check("180C to F", CMF.cToF(180) === 356);
check("freezing C", CMF.cToF(0) === 32);
check("boiling C", CMF.cToF(100) === 212);
check("negative temps", CMF.fToC(-40) === -40 && CMF.cToF(-40) === -40);
check("bad temp null", CMF.fToC("hot") === null && CMF.cToF(null) === null);
check("round trip within 1", Math.abs(CMF.fToC(CMF.cToF(175)) - 175) <= 1);

// Shaped tables.
check("units exclude ml", !CMF.TOOL_UNITS.includes("ml") && !CMF.TOOL_UNITS.includes("毫升"));
check("units include cup", CMF.TOOL_UNITS.includes("杯") && CMF.TOOL_UNITS.includes("小勺"));
check("density table size", CMF.TOOL_DENSITY_INGREDIENTS.length >= 30);
check("density names non-empty", CMF.TOOL_DENSITY_INGREDIENTS.every((n) => typeof n === "string" && n.length > 0));
check("baking subs count", CMF.BAKING_SUBS.length === 8);
check("baking subs shape", CMF.BAKING_SUBS.every((s) => s.from && s.to && s.note));

if (failures.length) {
  console.error("TOOLS TEST FAILURES:", failures);
  process.exit(1);
}
console.log(JSON.stringify({ ok: true, checks }));