/* Headless test for the pure scaleAmount helper in the real ui.js.
 * Shims just enough document/window to load ui.js, then asserts scaling.
 */
const fs = require("fs");
const path = require("path");

const root = process.argv[2] || path.resolve(__dirname, "..", "..");

function fakeElement() {
  return {
    classList: { add() {}, remove() {} },
    set textContent(v) {},
    get textContent() {
      return "";
    },
  };
}
global.window = global;
global.location = { href: "", search: "", protocol: "file:" };
global.requestAnimationFrame = () => 0;
global.setTimeout = () => 0;
global.clearTimeout = () => 0;
global.document = {
  querySelector: () => null,
  createElement: () => fakeElement(),
  body: { appendChild() {} },
};

const src = fs.readFileSync(path.join(root, "web", "js", "ui.js"), "utf8");
(0, eval)(src);
const scaleAmount = global.window.CMF.scaleAmount;
const formatTimer = global.window.CMF.formatTimer;

const cases = [
  ["2 个", 2, "4 个"],
  ["1 小勺", 0.5, "0.5 小勺"],
  ["100 克", 1.5, "150 克"],
  ["1.5 勺", 2, "3 勺"],
  ["少许", 2, "少许"],
  ["半勺", 2, "半勺"],
  ["3 瓣", 3, "9 瓣"],
];
const failures = cases
  .filter(([amount, factor, expected]) => scaleAmount(amount, factor) !== expected)
  .map(([amount, factor]) => `${amount} x${factor} => ${scaleAmount(amount, factor)}`);

const timerCases = [
  [0, "00:00"],
  [65, "01:05"],
  [599, "09:59"],
  [600, "10:00"],
  [-5, "00:00"],
];
const timerFailures = timerCases
  .filter(([sec, expected]) => formatTimer(sec) !== expected)
  .map(([sec]) => `${sec} => ${formatTimer(sec)}`);

if (failures.length || timerFailures.length) {
  console.error("UI TEST FAILURES:", failures, timerFailures);
  process.exit(1);
}
console.log(JSON.stringify({ ok: true, checks: cases.length + timerCases.length }));
