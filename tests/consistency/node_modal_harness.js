/* Headless regression for the ingredient encyclopedia modal in ui.js.
 * Locks down the classic-pairing chips, chip navigation, Escape close,
 * and the graceful degradation when pairings.js is not loaded. */
const fs = require("fs");
const path = require("path");

const root = process.argv[2] || path.resolve(__dirname, "..", "..");

function fakeEl() {
  return {
    className: "",
    innerHTML: "",
    dataset: {},
    listeners: {},
    children: [],
    style: {},
    classList: { add() {}, remove() {} },
    addEventListener(type, fn) {
      (this.listeners[type] = this.listeners[type] || []).push(fn);
    },
    removeEventListener() {},
    remove() {
      this.removed = true;
    },
    appendChild(child) {
      this.children.push(child);
      return child;
    },
    prepend() {},
    querySelector() {
      return null;
    },
    insertAdjacentHTML() {},
    setAttribute() {},
    closest() {
      return null;
    },
    textContent: "",
  };
}

const appended = [];
const docListeners = {};
global.window = global;
global.location = { href: "", search: "", protocol: "file:" };
global.requestAnimationFrame = () => 0;
global.setTimeout = () => 0;
global.clearTimeout = () => 0;
global.document = {
  querySelector: () => null,
  createElement: () => fakeEl(),
  body: { appendChild: (el) => (appended.push(el), el) },
  addEventListener(type, fn) {
    (docListeners[type] = docListeners[type] || []).push(fn);
  },
  removeEventListener() {},
};

const catalog = JSON.parse(
  fs.readFileSync(path.join(root, "site", "data", "catalog.json"), "utf8")
);
const recipes = JSON.parse(
  fs.readFileSync(path.join(root, "site", "data", "recipes.json"), "utf8")
);
global.window.CMF = { data: { catalog, recipes } };

function load(name) {
  (0, eval)(fs.readFileSync(path.join(root, "web", "js", name), "utf8"));
}
load("catalog.js");
load("pairings.js");
load("ui.js");
const CMF = global.window.CMF;
CMF.initCatalog();
CMF.buildPairingIndex(recipes);

const failures = [];
function check(name, cond) {
  if (!cond) failures.push(name);
}

CMF.showIngredientInfo("鸡蛋");
const modal = appended[appended.length - 1];
const html = modal.innerHTML;
const chipCount = (html.match(/class="pairing-chip"/g) || []).length;
const expected = CMF.topPairings("鸡蛋", 6).length;

check("pairing index is built before render", expected > 0);
check("modal renders classic pairings row", html.includes("经典搭配"));
check("modal renders pairing grid", html.includes('class="pairing-grid"'));
check("chip count matches topPairings", chipCount === expected && chipCount > 0);
check("chips exclude pantry staples", !html.includes('data-name="盐"'));
check("chips carry count badges", html.includes('class="pair-count"'));
check("recipe links still render", html.includes("用到它的菜谱（"));
check("substitutions are not [object Object]", !html.includes("[object Object]"));
check("substitution names are rendered", html.includes("淀粉"));
check("substitution reasons are rendered", html.includes("炸物裹粉"));

// Clicking a chip closes the current modal and opens the target ingredient.
const target = {
  closest: (sel) =>
    sel === ".pairing-chip" ? { dataset: { name: "番茄" } } : null,
};
(modal.listeners.click || []).forEach((fn) => fn({ target }));
const next = appended[appended.length - 1];
check("chip click opens a new modal", next !== modal && !!next.innerHTML);
check("chip navigates to the clicked ingredient", next.innerHTML.includes("番茄") && modal.removed === true);

// Escape closes the newly opened modal.
(docListeners.keydown || []).forEach((fn) => fn({ key: "Escape" }));
check("Escape closes the modal", next.removed === true);

// Graceful degradation: a page that did not load pairings.js must not crash.
delete CMF.topPairings;
let degraded = "";
try {
  CMF.showIngredientInfo("番茄");
  degraded = appended[appended.length - 1].innerHTML;
} catch (e) {
  degraded = "THREW: " + e.message;
}
check("missing pairings.js does not throw", !degraded.startsWith("THREW:"));
check("degraded modal shows empty state", degraded.includes("暂无共现数据"));
check("degraded modal omits chips", !degraded.includes("pairing-chip"));

if (failures.length) {
  console.error("MODAL TEST FAILURES:", failures);
  process.exit(1);
}
console.log(JSON.stringify({ ok: true, checks: 16, chipCount }));
