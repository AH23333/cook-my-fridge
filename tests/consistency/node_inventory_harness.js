/* Headless inventory consistency tests using real catalog/recipe data.
   Usage: node node_inventory_harness.js [project_root]
   Pure APIs use fixed calendar dates; transactions use the actual local day. */
"use strict";
const fs = require("fs");
const path = require("path");
const { isDeepStrictEqual, inspect } = require("util");

const base = path.resolve(process.argv[2] || path.join(__dirname, "..", ".."));
const memory = new Map();
let attempts = [];
let failKey = null;
let networkCalls = 0;
global.window = global;
global.location = { search: "", hash: "" };
global.localStorage = {
  getItem: (key) => memory.has(key) ? memory.get(key) : null,
  setItem: (key, value) => {
    attempts.push(key);
    if (key === failKey) throw new Error("QuotaExceededError");
    memory.set(key, String(value));
  },
  removeItem: (key) => { memory.delete(key); },
};
// No preload or real external requests are allowed, even accidentally.
global.fetch = () => {
  networkCalls += 1;
  throw new Error("Network is disabled in the inventory harness");
};
for (const name of ["store", "catalog", "nutrition", "journal", "inventory", "sync"]) {
  // eslint-disable-next-line no-eval
  eval(fs.readFileSync(path.join(base, "web", "js", name + ".js"), "utf8"));
}
const CMF = global.CMF;
CMF.data.catalog = JSON.parse(fs.readFileSync(path.join(base, "site/data/catalog.json"), "utf8"));
CMF.data.recipes = JSON.parse(fs.readFileSync(path.join(base, "site/data/recipes.json"), "utf8"));
CMF.initCatalog();

const failures = [];
const sections = {};
let checks = 0;
function check(name, condition, detail) {
  checks += 1;
  if (!condition) failures.push(name + (detail ? ": " + detail : ""));
}
function equal(name, actual, expected) {
  check(name, isDeepStrictEqual(actual, expected),
    "expected " + inspect(expected, { depth: 5 }) + ", got " + inspect(actual, { depth: 5 }));
}
function throws(name, fn, message) {
  let error;
  try { fn(); } catch (e) { error = e; }
  check(name, Boolean(error && message.test(error.message)),
    error ? String(error) : "did not throw");
}
function reset() {
  memory.clear();
  attempts = [];
  failKey = null;
}
function section(name, fn) {
  reset();
  const start = checks;
  try { fn(); } catch (e) { failures.push(name + " unexpected exception: " + e.stack); }
  sections[name] = checks - start;
}
const clone = (value) => JSON.parse(JSON.stringify(value));
function freeze(value) {
  if (value && typeof value === "object") {
    Object.values(value).forEach(freeze);
    Object.freeze(value);
  }
  return value;
}
const snapshot = () => [...memory.entries()].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0);
const otherStorage = () => snapshot().filter(([key]) => key !== "cmf.inventory");
const batch = (id, overrides = {}) => ({
  id, canonical: "番茄", grams: 100, expiresOn: "", location: "fridge",
  note: "", updatedAt: 1700000000000, deleted: false, ...overrides,
});
const inventory = (...batches) => ({ batches });
function seed(state) {
  if (!CMF.setInventory(state)) throw new Error("Fixture inventory could not be stored");
  attempts = [];
}
function rejected(name, fn, message, writes = []) {
  const before = snapshot();
  attempts = [];
  throws(name, fn, message);
  equal(name + " preserves all storage bytes", snapshot(), before);
  equal(name + " write attempts", attempts, writes);
}
// Independent local-date oracle: never derive expected dates from the API under test.
function localDate(date) {
  return [String(date.getFullYear()).padStart(4, "0"),
    String(date.getMonth() + 1).padStart(2, "0"), String(date.getDate()).padStart(2, "0")].join("-");
}
function currentDay(offset = 0) {
  const date = new Date();
  date.setDate(date.getDate() + offset);
  return localDate(date);
}
function withPureClock(date, fn) {
  const NativeDate = global.Date;
  const instant = date.getTime();
  global.Date = class extends NativeDate {
    constructor(...args) { super(...(args.length ? args : [instant])); }
    static now() { return instant; }
  };
  try { fn(); } finally { global.Date = NativeDate; }
}
const use = (grams, canonical = "番茄") => ({ canonical, grams });
const FIXED_DAY = "2028-02-29";

section("normalize", () => {
  const good = batch("valid");
  const badRoots = [undefined, null, false, 0, 7, "bad", [], [good], {},
    { batches: null }, { batches: {} }, { batches: "bad" }];
  badRoots.forEach((raw, index) => equal("bad root " + index, CMF.normalizeInventory(raw), inventory()));
  const invalidRows = [
    null, [], {}, { id: "" }, { id: 7 }, { id: "x".repeat(201) },
    { canonical: "" }, { canonical: "  " }, { canonical: 7 }, { canonical: "x".repeat(81) },
    { grams: NaN }, { grams: Infinity }, { grams: -Infinity }, { grams: -0.1 },
    { grams: "100" }, { grams: null }, { grams: 1000000.1 },
    { updatedAt: 0 }, { updatedAt: -1 }, { updatedAt: 1.5 }, { updatedAt: NaN },
    { updatedAt: Infinity }, { updatedAt: Number.MAX_SAFE_INTEGER + 1 }, { updatedAt: "123" },
    { expiresOn: null }, { expiresOn: 20280229 }, { expiresOn: "yesterday" },
    { expiresOn: "2027-02-29" }, { expiresOn: "2028-02-30" }, { expiresOn: "2028-13-01" },
    { expiresOn: "2028-01-32" }, { expiresOn: "2028-2-9" }, { expiresOn: "2028-02-29T00:00:00Z" },
    { location: "garage" }, { location: "" }, { location: null },
  ];
  invalidRows.forEach((patch, index) => {
    const row = index < 3 ? patch : batch("invalid", patch);
    equal("reject invalid row " + index, CMF.normalizeInventory(inventory(row, good)), inventory(good));
  });
  for (const grams of [0, 0.1, 1000000]) {
    equal("valid grams boundary " + grams,
      CMF.normalizeInventory(inventory(batch("a", { grams }))).batches[0].grams, grams);
  }
  for (const location of ["fridge", "freezer", "pantry"]) {
    equal("valid location " + location,
      CMF.normalizeInventory(inventory(batch("a", { location }))).batches[0].location, location);
  }
  const raw = freeze({ batches: [
    batch("b", { canonical: " 番茄 ", grams: 12.34, note: "x".repeat(250), extra: { hidden: true } }),
    batch("a", { note: 42 }), batch("dead", { deleted: true, grams: 99 }),
    batch("not-dead", { deleted: "true" }), batch("nan", { grams: NaN }),
  ], unknown: "discard" });
  const before = { ...raw, batches: raw.batches.map((row) => ({ ...row })) };
  const clean = CMF.normalizeInventory(raw);
  equal("normalization keeps deterministic id order", clean.batches.map((row) => row.id),
    ["a", "b", "dead", "not-dead"]);
  equal("normalization trims, rounds, caps and strips fields", clean.batches[1],
    batch("b", { grams: 12.3, note: "x".repeat(200) }));
  equal("non-string note becomes empty", clean.batches[0].note, "");
  equal("tombstone quantity forced to zero", clean.batches[2], batch("dead", { deleted: true, grams: 0 }));
  equal("deleted requires boolean true", clean.batches[3].deleted, false);
  equal("unknown root fields removed", Object.keys(clean), ["batches"]);
  equal("normalization preserves source including NaN", raw, before);
  check("normalization returns detached objects", clean !== raw && clean.batches[1] !== raw.batches[0]);
  clean.batches[1].note = "changed result";
  equal("editing normalized result cannot mutate source", raw.batches[0].note, "x".repeat(250));
  const old = batch("dup", { updatedAt: 10, grams: 20 });
  const newer = batch("dup", { updatedAt: 11, grams: 5 });
  equal("duplicate ids use newest row", CMF.normalizeInventory(inventory(newer, old, newer)), inventory(newer));
  equal("duplicate order does not affect winner", CMF.normalizeInventory(inventory(old, newer, old)), inventory(newer));
});

section("upsert and tombstones", () => {
  equal("inventory store key", CMF.KEYS.inventory, "cmf.inventory");
  equal("missing inventory defaults empty", CMF.getInventory(), inventory());
  memory.set("cmf.inventory", "{broken");
  equal("corrupt stored JSON defaults empty", CMF.getInventory(), inventory());
  reset();
  check("real catalog provides tomato synonym", CMF.entry("番茄").synonyms.includes("西红柿"));
  const input = freeze({ canonical: " 西红柿 ", grams: 12.34, expiresOn: FIXED_DAY,
    location: "fridge", note: "  第一批  " });
  const added = CMF.upsertInventoryBatch(input);
  check("new batch has generated id", typeof added.id === "string" && added.id.startsWith("batch-"));
  equal("synonym canonicalized on create", added.canonical, "番茄");
  equal("new quantity rounded once", added.grams, 12.3);
  equal("note trimmed", added.note, "第一批");
  check("new timestamp is positive safe integer", Number.isSafeInteger(added.updatedAt) && added.updatedAt > 0);
  equal("create persists returned batch", CMF.getInventory(), inventory(added));
  equal("create writes inventory key only", attempts, ["cmf.inventory"]);
  equal("create does not mutate draft", input.canonical, " 西红柿 ");
  const second = CMF.upsertInventoryBatch({ ...input, note: "second" });
  check("same canonical can have separate batches", second.id !== added.id && CMF.getInventory().batches.length === 2);
  const original = freeze(clone(added));
  const edited = CMF.upsertInventoryBatch({ ...added, canonical: "西红柿", grams: 7.5,
    location: "freezer", note: "x".repeat(250) }, original);
  equal("edit keeps batch id", edited.id, added.id);
  equal("edit changes quantity and location", [edited.grams, edited.location, edited.note.length], [7.5, "freezer", 200]);
  check("edit advances version", edited.updatedAt > added.updatedAt);
  equal("expected object not mutated by edit", original, added);
  equal("edit leaves other batch unchanged", CMF.getInventory().batches.find((row) => row.id === second.id), second);
  rejected("stale edit rejected", () => CMF.upsertInventoryBatch({ ...edited, grams: 8 }, added), /已被修改/);
  rejected("missing expected version rejected", () => CMF.upsertInventoryBatch(edited), /已被修改/);
  rejected("unknown id rejected", () => CMF.upsertInventoryBatch({ ...edited, id: "missing" }, edited), /已被修改/);
  rejected("stale deletion rejected", () => CMF.removeInventoryBatch(edited.id, added), /已被修改/);
  const zero = CMF.upsertInventoryBatch({ ...edited, grams: 0 }, edited);
  equal("zero stock stays an editable live batch", [zero.grams, zero.deleted], [0, false]);
  equal("zero stock status", CMF.inventoryStatus(zero, FIXED_DAY).key, "empty");
  const refilled = CMF.upsertInventoryBatch({ ...zero, grams: 2 }, zero);
  check("empty batch may be refilled", refilled.grams === 2 && refilled.updatedAt > zero.updatedAt);
  attempts = [];
  equal("delete succeeds", CMF.removeInventoryBatch(refilled.id, refilled), true);
  const deleted = CMF.getInventory().batches.find((row) => row.id === refilled.id);
  equal("delete persists tombstone rather than dropping row", CMF.getInventory().batches.length, 2);
  equal("tombstone state", [deleted.deleted, deleted.grams, deleted.canonical], [true, 0, "番茄"]);
  check("delete advances timestamp", deleted.updatedAt > refilled.updatedAt);
  equal("delete writes one key", attempts, ["cmf.inventory"]);
  rejected("repeat delete rejected", () => CMF.removeInventoryBatch(deleted.id, deleted), /已被修改/);
  rejected("deleted id cannot be resurrected by edit", () => CMF.upsertInventoryBatch({ ...deleted, grams: 10 }, deleted), /已被修改/);
  const invalid = [
    [{ canonical: "not-a-catalog-food" }, /目录/], [{ grams: NaN }, /数量/],
    [{ grams: -1 }, /数量/], [{ grams: Infinity }, /数量/], [{ grams: "3" }, /数量/],
    [{ grams: 1000001 }, /数量/], [{ grams: 0.01 }, /数量/],
    [{ expiresOn: "2027-02-29" }, /日期/], [{ expiresOn: null }, /日期/],
    [{ location: "garage" }, /冷藏/],
  ];
  invalid.forEach(([patch, message], i) => rejected("invalid create " + i,
    () => CMF.upsertInventoryBatch({ ...input, ...patch }), message));
  failKey = "cmf.inventory";
  rejected("quota create", () => CMF.upsertInventoryBatch(input), /库存保存失败/, ["cmf.inventory"]);
  rejected("quota edit", () => CMF.upsertInventoryBatch({ ...second, grams: 1 }, second), /库存保存失败/, ["cmf.inventory"]);
  rejected("quota delete", () => CMF.removeInventoryBatch(second.id, second), /库存保存失败/, ["cmf.inventory"]);
  failKey = null;
});

section("local calendar and summary", () => {
  const dates = [
    [FIXED_DAY, "due", 0], ["2028-03-03", "due", 3], ["2028-03-04", "fresh", 4],
    ["2028-02-28", "expired", -1], ["2028-03-01", "due", 1],
  ];
  dates.forEach(([expiresOn, key, days]) => {
    const status = CMF.inventoryStatus(batch("a", { expiresOn }), FIXED_DAY);
    equal("status boundary " + expiresOn, [status.key, status.days], [key, days]);
  });
  equal("leap day accepted", CMF.normalizeInventory(inventory(batch("leap", { expiresOn: FIXED_DAY }))).batches.length, 1);
  equal("leap day contributes one calendar day", CMF.inventoryStatus(batch("a", { expiresOn: "2028-03-01" }), "2028-02-28").days, 2);
  equal("non-leap February has no extra day", CMF.inventoryStatus(batch("a", { expiresOn: "2027-03-01" }), "2027-02-28").days, 1);
  equal("undated status", CMF.inventoryStatus(batch("a"), FIXED_DAY), { key: "undated", label: "未填日期", days: null });
  equal("empty takes precedence over expiry", CMF.inventoryStatus(batch("a", { grams: 0, expiresOn: "2028-02-28" }), FIXED_DAY).key, "empty");
  equal("deleted takes precedence over empty", CMF.inventoryStatus(batch("a", { grams: 0, deleted: true }), FIXED_DAY).key, "deleted");
  throws("invalid anchor rejected by status", () => CMF.inventoryStatus(batch("a", { expiresOn: FIXED_DAY }), "2028-02-30"), /日期/);
  for (const hour of [0, 23]) {
    const date = new Date(2028, 1, 29, hour, 30);
    equal("localDay at local hour " + hour, CMF.localDay(date), FIXED_DAY);
    withPureClock(date, () => {
      const state = inventory(batch("today", { expiresOn: FIXED_DAY }));
      equal("default status uses local day at hour " + hour, CMF.inventoryStatus(state.batches[0]).days, 0);
      equal("default preview uses local day at hour " + hour, CMF.previewInventoryUse(state, [use(1)]).day, FIXED_DAY);
      equal("default summary uses local day at hour " + hour, CMF.inventorySummary(state).due, 1);
    });
  }
  // Noon-to-noon can span 23 or 25 hours in LA; calendar day differences must not.
  equal("DST spring boundary is three calendar days", CMF.inventoryStatus(batch("a", { expiresOn: "2028-03-14" }), "2028-03-11").days, 3);
  equal("DST fall boundary is three calendar days", CMF.inventoryStatus(batch("a", { expiresOn: "2028-11-07" }), "2028-11-04").days, 3);
  const state = freeze(inventory(
    batch("expired", { grams: 100, expiresOn: "2028-02-28" }),
    batch("today", { grams: 50, expiresOn: FIXED_DAY }),
    batch("three", { grams: 60, expiresOn: "2028-03-03" }),
    batch("four", { grams: 40, expiresOn: "2028-03-04" }),
    batch("undated", { grams: 30 }), batch("zero", { grams: 0 }),
    batch("deleted", { grams: 999, deleted: true }), batch("invalid", { grams: -10 }),
  ));
  const before = clone(state);
  const summary = CMF.inventorySummary(state, FIXED_DAY);
  equal("summary denominator includes positive expired and undated, excludes empty/deleted/invalid",
    summary, { active: 5, expired: 1, due: 2, undated: 1, grams: 280 });
  equal("expiry warning fraction uses active denominator", (summary.expired + summary.due) / summary.active, 3 / 5);
  equal("summary does not mutate source", state, before);
  equal("empty summary", CMF.inventorySummary(null, FIXED_DAY), { active: 0, expired: 0, due: 0, undated: 0, grams: 0 });
});

section("recipe needs", () => {
  const recipe = CMF.data.recipes.find((row) => row.id === "r001");
  check("real recipe fixture exists", Boolean(recipe && recipe.title === "番茄炒蛋"));
  freeze(recipe);
  const before = clone(recipe);
  const baseNeeds = [
    { canonical: "番茄", grams: 300, optional: false, estimated: true },
    { canonical: "鸡蛋", grams: 100, optional: false, estimated: true },
    { canonical: "食用油", grams: 20, optional: false, estimated: true },
    { canonical: "盐", grams: 3, optional: false, estimated: true },
    { canonical: "白糖", grams: 4, optional: false, estimated: true },
    { canonical: "小葱", grams: null, optional: true, estimated: true },
  ];
  for (const factor of [0.5, 1, 2, 3]) {
    equal("real recipe quantities scaled exactly once " + factor, CMF.inventoryRecipeNeeds(recipe, factor),
      baseNeeds.map((row) => ({ ...row, grams: row.grams === null ? null : row.grams * factor })));
  }
  for (const factor of [undefined, 0, -1, NaN, Infinity, "2"]) {
    equal("invalid factor falls back to one " + String(factor), CMF.inventoryRecipeNeeds(recipe, factor), baseNeeds);
  }
  equal("servings tags do not divide recipe quantities", CMF.inventoryRecipeNeeds({ ...recipe, tags: [] }, 2),
    baseNeeds.map((row) => ({ ...row, grams: row.grams === null ? null : row.grams * 2 })));
  equal("needs never mutate recipe amounts", recipe, before);
  const friedRice = CMF.data.recipes.find((row) => row.id === "r002");
  equal("real optional half-unit converts but remains optional",
    CMF.inventoryRecipeNeeds(friedRice, 2).find((row) => row.canonical === "火腿肠"),
    { canonical: "火腿肠", grams: 80, optional: true, estimated: true });
  equal("real required vague salt needs manual input",
    CMF.inventoryRecipeNeeds(friedRice, 2).find((row) => row.canonical === "盐"),
    { canonical: "盐", grams: null, optional: false, estimated: true });
  for (const amount of ["少许", "适量", "若干", "几片", "", "1 测试单位", "0 克"]) {
    equal("vague/unknown/zero amount is not fallback grams: " + amount,
      CMF.inventoryRecipeNeeds({ ingredients: [{ canonical: "番茄", amount }] }, 3)[0].grams, null);
  }
  const aggregate = freeze({ ingredients: [
    { canonical: "番茄", amount: "100 克", optional: true },
    { canonical: "番茄", amount: "0.2 千克", optional: false },
    { canonical: "鸡蛋", amount: "1 个", optional: true },
    { canonical: "鸡蛋", amount: "25 g", optional: true },
    { canonical: "盐", amount: "1 克", optional: true },
    { canonical: "盐", amount: "少许", optional: false },
  ] });
  equal("canonical aggregation sums once, optional uses AND, estimated uses OR",
    CMF.inventoryRecipeNeeds(aggregate, 2), [
      { canonical: "番茄", grams: 600, optional: false, estimated: false },
      { canonical: "鸡蛋", grams: 150, optional: true, estimated: true },
      { canonical: "盐", grams: null, optional: false, estimated: true },
    ]);
  equal("unknown-first aggregation stays unknown", CMF.inventoryRecipeNeeds({ ingredients: [
    { canonical: "盐", amount: "少许" }, { canonical: "盐", amount: "2 克", optional: true },
  ] }, 2), [{ canonical: "盐", grams: null, optional: false, estimated: true }]);
  equal("missing ingredient list", CMF.inventoryRecipeNeeds({}, 2), []);
});

section("preview", () => {
  const raw = freeze(inventory(
    batch("a-undated", { grams: 80 }), batch("b-late", { grams: 50, expiresOn: "2028-03-04" }),
    batch("d-today", { grams: 20, expiresOn: FIXED_DAY }), batch("c-today", { grams: 30, expiresOn: FIXED_DAY }),
    batch("expired", { grams: 1000, expiresOn: "2028-02-28" }), batch("zero", { grams: 0 }),
    batch("deleted", { grams: 600, deleted: true }), batch("egg", { canonical: "鸡蛋", grams: 100 }),
  ));
  const requests = freeze([use(60), use(70), use(20, "鸡蛋")]);
  const before = clone(raw);
  const preview = CMF.previewInventoryUse(raw, requests, FIXED_DAY);
  equal("preview day", preview.day, FIXED_DAY);
  equal("preview canonical requests aggregated", preview.requests, [use(130), use(20, "鸡蛋")]);
  equal("preview total requested grams", preview.totalGrams, 150);
  equal("sufficient preview accepted", preview.ok, true);
  equal("earliest expiry first, same-day id tie, undated last", preview.lines[0], {
    canonical: "番茄", grams: 130, available: 180, missing: 0, expiredGrams: 1000,
    allocations: [{ id: "c-today", grams: 30 }, { id: "d-today", grams: 20 },
      { id: "b-late", grams: 50 }, { id: "a-undated", grams: 30 }],
  });
  equal("different canonical allocation", preview.lines[1], {
    canonical: "鸡蛋", grams: 20, available: 100, missing: 0, expiredGrams: 0,
    allocations: [{ id: "egg", grams: 20 }],
  });
  equal("preview stores normalized concurrency snapshot", preview.before, JSON.stringify(CMF.normalizeInventory(raw)));
  equal("preview source not mutated", raw, before);
  equal("preview requests not mutated", requests, [use(60), use(70), use(20, "鸡蛋")]);
  equal("preview does not persist", snapshot(), []);
  equal("preview makes zero write attempts", attempts, []);
  const insufficient = CMF.previewInventoryUse(raw, [use(181), use(1, "鸡蛋")], FIXED_DAY);
  equal("insufficient preview rejected despite other sufficient ingredient", insufficient.ok, false);
  equal("expired grams cannot satisfy shortage", [insufficient.lines[0].available, insufficient.lines[0].missing], [180, 1]);
  equal("shortage preview itself cannot partially deduct", raw, before);
  equal("absent ingredient reports full shortage", CMF.previewInventoryUse(raw, [use(8, "土豆")], FIXED_DAY).lines[0],
    { canonical: "土豆", grams: 8, available: 0, missing: 8, expiredGrams: 0, allocations: [] });
  equal("empty request cannot commit", CMF.previewInventoryUse(raw, [], FIXED_DAY).ok, false);
  throws("preview rejects invalid date", () => CMF.previewInventoryUse(raw, [use(1)], "2027-02-29"), /日期/);
  throws("preview requires request array", () => CMF.previewInventoryUse(raw, {}, FIXED_DAY), /食材/);
  for (const request of [null, {}, use(0), use(-1), use(NaN), use(Infinity), use("1"), use(0.01), use(1000001), use(1, "")]) {
    throws("invalid deduction " + inspect(request), () => CMF.previewInventoryUse(raw, [request], FIXED_DAY), /扣减克数/);
  }
  throws("aggregated deduction capped", () => CMF.previewInventoryUse(raw, [use(600000), use(500000)], FIXED_DAY), /同一食材/);
  equal("decimal allocations remain one-decimal quantities",
    CMF.previewInventoryUse(inventory(batch("decimal", { grams: 0.3 })), [use(0.1), use(0.2)], FIXED_DAY).lines[0].allocations,
    [{ id: "decimal", grams: 0.3 }]);
});

function transactionFixture() {
  // Future versions force the monotonic-timestamp branch even on a fast clock.
  const version = Date.now() + 60000;
  seed(inventory(
    batch("a-today", { grams: 30, expiresOn: currentDay(), updatedAt: version }),
    batch("b-undated", { grams: 70, updatedAt: version }),
    batch("c-egg", { canonical: "鸡蛋", grams: 50, updatedAt: version }),
    batch("d-expired", { grams: 500, expiresOn: currentDay(-1), updatedAt: version }),
    batch("e-deleted", { grams: 0, deleted: true, updatedAt: version }),
  ));
  CMF.setFridge(["番茄", "鸡蛋"]);
  CMF.setFavorites(["r001"]);
  CMF.setPrefs({ tags: ["快手"] });
  CMF.setJournal({ cooked: [], ratings: { r001: 5 }, notes: { r001: "保留" } });
  attempts = [];
  return CMF.getInventory();
}
function transactionPreview() {
  return CMF.previewInventoryUse(CMF.getInventory(), [use(40), use(10, "鸡蛋")], currentDay());
}

section("commit", () => {
  const before = transactionFixture();
  const otherBefore = otherStorage();
  const preview = freeze(transactionPreview());
  const duplicate = transactionPreview();
  equal("two previews have identical snapshot", duplicate, preview);
  const receipt = CMF.commitInventoryUse(preview);
  equal("commit performs exactly one storage write", attempts, ["cmf.inventory"]);
  equal("commit does not change fridge, journal, prefs or favorites", otherStorage(), otherBefore);
  const after = CMF.getInventory();
  equal("commit quantities exact with no expired or deleted deductions", after.batches.map((row) => row.grams), [0, 60, 40, 500, 0]);
  equal("fully used batch stays live, not a tombstone", after.batches[0].deleted, false);
  for (let i = 0; i < 3; i += 1) {
    check("commit timestamp advances for allocation " + i, after.batches[i].updatedAt > before.batches[i].updatedAt);
  }
  equal("nonallocated batches remain byte-equivalent", after.batches.slice(3), before.batches.slice(3));
  equal("receipt preserves pre-commit inventory", receipt.before, before);
  equal("receipt records exact post-commit bytes", receipt.after, JSON.stringify(after));
  equal("receipt allocations", receipt.changes,
    [{ id: "a-today", grams: 30 }, { id: "b-undated", grams: 10 }, { id: "c-egg", grams: 10 }]);
  equal("commit does not mutate preview snapshot", preview.before, JSON.stringify(before));
  rejected("same preview replay", () => CMF.commitInventoryUse(preview), /重新预览/);
  rejected("duplicate preview replay", () => CMF.commitInventoryUse(duplicate), /重新预览/);
  rejected("null preview", () => CMF.commitInventoryUse(null), /重新预览/);
  const stale = transactionPreview();
  const egg = CMF.getInventory().batches.find((row) => row.id === "c-egg");
  CMF.upsertInventoryBatch({ ...egg, note: "another tab edited" }, egg);
  rejected("stale preview after edit", () => CMF.commitInventoryUse(stale), /重新预览/);
  for (const offset of [-1, 1]) {
    const wrongDay = CMF.previewInventoryUse(CMF.getInventory(), [use(1)], currentDay(offset));
    rejected("cross-day preview " + offset, () => CMF.commitInventoryUse(wrongDay), /日期.*重新预览/);
  }
});

section("commit verification and quota", () => {
  transactionFixture();
  const notEnough = CMF.previewInventoryUse(CMF.getInventory(), [use(20), use(51, "鸡蛋")], currentDay());
  equal("transaction shortage fixture is insufficient", notEnough.ok, false);
  rejected("shortage cannot partially deduct sufficient tomato", () => CMF.commitInventoryUse(notEnough), /不会扣减任何批次/);
  const empty = CMF.previewInventoryUse(CMF.getInventory(), [], currentDay());
  rejected("empty commit", () => CMF.commitInventoryUse(empty), /不会扣减任何批次/);
  const forged = { ...notEnough, ok: true, lines: [], totalGrams: 0 };
  rejected("commit rechecks shortage instead of trusting preview ok", () => CMF.commitInventoryUse(forged), /不会扣减任何批次/);
  const valid = transactionPreview();
  const validBefore = clone(valid);
  failKey = "cmf.inventory";
  rejected("quota commit is atomic", () => CMF.commitInventoryUse(valid), /库存保存失败/, ["cmf.inventory"]);
  equal("failed commit preserves retryable preview", valid, validBefore);
  failKey = null;
  attempts = [];
  const receipt = CMF.commitInventoryUse(valid);
  equal("quota commit retry writes once", attempts, ["cmf.inventory"]);
  equal("quota commit retry deducts only once", CMF.getInventory().batches.map((row) => row.grams), [0, 60, 40, 500, 0]);
  equal("successful retry receipt matches storage", receipt.after, JSON.stringify(CMF.getInventory()));
  transactionFixture();
  const tampered = transactionPreview();
  tampered.lines = [{ allocations: [{ id: "d-expired", grams: 500 }] }];
  tampered.totalGrams = 500;
  CMF.commitInventoryUse(tampered);
  equal("commit recomputes allocations from requests", CMF.getInventory().batches.map((row) => row.grams), [0, 60, 40, 500, 0]);
});

section("undo", () => {
  const before = transactionFixture();
  const receipt = freeze(CMF.commitInventoryUse(transactionPreview()));
  const after = CMF.getInventory();
  const receiptBefore = clone(receipt);
  const others = otherStorage();
  attempts = [];
  equal("undo succeeds", CMF.undoInventoryUse(receipt), true);
  equal("undo writes one key", attempts, ["cmf.inventory"]);
  const restored = CMF.getInventory();
  equal("undo restores all original quantities", restored.batches.map((row) => row.grams), before.batches.map((row) => row.grams));
  for (let i = 0; i < 3; i += 1) {
    check("undo version newer than deduction " + i, restored.batches[i].updatedAt > after.batches[i].updatedAt);
    equal("undo restores metadata without reverting version " + i,
      { ...restored.batches[i], updatedAt: before.batches[i].updatedAt }, before.batches[i]);
  }
  equal("undo leaves nonallocated rows untouched", restored.batches.slice(3), before.batches.slice(3));
  equal("undo leaves unrelated storage untouched", otherStorage(), others);
  equal("undo does not mutate receipt", receipt, receiptBefore);
  rejected("repeat undo", () => CMF.undoInventoryUse(receipt), /后续变动/);
  rejected("null undo", () => CMF.undoInventoryUse(null), /后续变动/);
  for (const action of ["edit allocated", "edit unrelated", "add", "delete"]) {
    transactionFixture();
    const staleReceipt = CMF.commitInventoryUse(transactionPreview());
    const state = CMF.getInventory();
    const target = state.batches.find((row) => row.id === (action === "edit unrelated" ? "d-expired" : "b-undated"));
    if (action === "add") CMF.upsertInventoryBatch({ canonical: "鸡蛋", grams: 5, expiresOn: "", location: "pantry" });
    else if (action === "delete") CMF.removeInventoryBatch(target.id, target);
    else CMF.upsertInventoryBatch({ ...target, note: "later modification" }, target);
    rejected("undo after " + action, () => CMF.undoInventoryUse(staleReceipt), /后续变动/);
  }
  const retryBefore = transactionFixture();
  const retryReceipt = freeze(CMF.commitInventoryUse(transactionPreview()));
  const retryAfter = CMF.getInventory();
  failKey = "cmf.inventory";
  rejected("quota undo keeps receipt usable", () => CMF.undoInventoryUse(retryReceipt), /库存保存失败/, ["cmf.inventory"]);
  failKey = null;
  attempts = [];
  equal("failed undo can be retried", CMF.undoInventoryUse(retryReceipt), true);
  equal("retried undo writes once", attempts, ["cmf.inventory"]);
  const retried = CMF.getInventory();
  equal("retried undo fully restores quantity", retried.batches.map((row) => row.grams), retryBefore.batches.map((row) => row.grams));
  check("retried undo is a newer version", retried.batches[0].updatedAt > retryAfter.batches[0].updatedAt);
});

section("backup and restore", () => {
  const state = inventory(batch("a", { note: "中文库存备注", expiresOn: FIXED_DAY }),
    batch("b-empty", { grams: 0 }), batch("c-dead", { grams: 0, deleted: true }));
  seed(state);
  CMF.setJournal({ cooked: [], ratings: { r001: 5 }, notes: {} });
  const backup = CMF.exportData();
  equal("backup includes inventory and tombstones", backup.data["cmf.inventory"], state);
  equal("backup schema version unchanged", backup.version, 1);
  const serialized = JSON.stringify(backup);
  reset();
  equal("restore counts inventory plus journal", CMF.importData(JSON.parse(serialized)), 2);
  equal("backup restore is lossless", CMF.getInventory(), state);
  equal("restore retains existing journal support", CMF.getJournal().ratings.r001, 5);
  equal("inventory restore writes recognized storage key", attempts.filter((key) => key === "cmf.inventory"), ["cmf.inventory"]);
  equal("legacy backup sync encoding includes inventory", CMF.syncDecode(CMF.syncEncode(backup)).d["cmf.inventory"], state);
});

section("merge invariants", () => {
  const older = batch("shared", { updatedAt: 10, grams: 90 });
  const newer = batch("shared", { updatedAt: 20, grams: 40, note: "remote edit", location: "freezer" });
  const local = freeze(inventory(batch("z-local"), older));
  const incoming = freeze(inventory(newer, batch("a-remote", { canonical: "鸡蛋" })));
  const beforeLocal = clone(local);
  const beforeIncoming = clone(incoming);
  const expected = inventory(batch("a-remote", { canonical: "鸡蛋" }), newer, batch("z-local"));
  equal("different ids union; newest same-id whole row wins", CMF.mergeInventories(local, incoming), expected);
  equal("newest version wins in either direction", CMF.mergeInventories(incoming, local), expected);
  equal("merge leaves local input unchanged", local, beforeLocal);
  equal("merge leaves incoming input unchanged", incoming, beforeIncoming);
  equal("merge is idempotent", CMF.mergeInventories(expected, incoming), expected);
  equal("empty incoming preserves normalized local", CMF.mergeInventories(expected, null), expected);
  equal("empty local accepts incoming", CMF.mergeInventories(null, incoming), inventory(expected.batches[0], newer));
  const dead = batch("shared", { updatedAt: 30, deleted: true, grams: 0 });
  equal("new tombstone replaces live row", CMF.mergeInventories(inventory(newer), inventory(dead)), inventory(dead));
  equal("older live import cannot resurrect deletion", CMF.mergeInventories(inventory(dead), inventory(newer)), inventory(dead));
  const tieLive = batch("shared", { updatedAt: 30, grams: 999, note: "z" });
  equal("same-time tombstone wins against live", CMF.mergeInventories(inventory(dead), inventory(tieLive)), inventory(dead));
  equal("same-time tombstone precedence is commutative", CMF.mergeInventories(inventory(tieLive), inventory(dead)), inventory(dead));
  const low = batch("tie", { updatedAt: 50, note: "a" });
  const high = batch("tie", { updatedAt: 50, note: "z" });
  const tieA = inventory(batch("z-last", { updatedAt: 50 }), low);
  const tieB = inventory(high, batch("a-first", { updatedAt: 50 }));
  const tied = inventory(batch("a-first", { updatedAt: 50 }), high, batch("z-last", { updatedAt: 50 }));
  equal("equal timestamp chooses stable row and sorted ids", CMF.mergeInventories(tieA, tieB), tied);
  equal("equal timestamp merge commutes", CMF.mergeInventories(tieB, tieA), tied);
  equal("equal timestamp input order cannot change output", CMF.mergeInventories(
    inventory(...tieA.batches.slice().reverse()), inventory(...tieB.batches.slice().reverse())), tied);
  equal("same-time merge is idempotent", CMF.mergeInventories(tied, tieB), tied);
  equal("normalization uses the same deterministic tie rule", CMF.normalizeInventory(inventory(high, low, high)), inventory(high));
  equal("merge associativity across deletion and edits",
    CMF.mergeInventories(CMF.mergeInventories(local, incoming), inventory(dead)),
    CMF.mergeInventories(local, CMF.mergeInventories(incoming, inventory(dead))));
});

section("sync payload integration", () => {
  const local = inventory(batch("local"), batch("shared", { updatedAt: 10, grams: 90 }),
    batch("deleted", { updatedAt: 30, grams: 0, deleted: true }), batch("tie", { updatedAt: 40, note: "a" }));
  const incoming = inventory(batch("remote", { canonical: "鸡蛋", note: "远端备注" }),
    batch("shared", { updatedAt: 20, grams: 40 }), batch("deleted", { updatedAt: 20, grams: 99 }),
    batch("tie", { updatedAt: 40, note: "z" }));
  const expected = inventory(local.batches[2], local.batches[0], incoming.batches[0], incoming.batches[1], incoming.batches[3]);
  seed(incoming);
  CMF.setFridge(["番茄"]);
  CMF.setPrefs({ tags: ["快手"] });
  equal("sync short key registered", CMF.SYNC_KEY_MAP.inv, "cmf.inventory");
  const full = CMF.syncPayload();
  equal("full sync contains inventory", full.d.inv, incoming);
  const code = CMF.syncEncode(full);
  check("sync code uses URL-safe alphabet", /^(S1|S1Z)\.[A-Za-z0-9_-]+$/.test(code));
  equal("full sync encode/decode round trip", CMF.syncDecode(code), full);
  equal("short encoding also round trips without QR module", CMF.syncDecode(CMF.syncEncode(full, { short: true })), full);
  reset();
  const replaceReport = CMF.applySyncPayload(CMF.syncDecode(code), { mode: "replace" });
  check("cross-device full sync reports inventory key", replaceReport.keys.includes("cmf.inventory"));
  equal("cross-device inventory restored losslessly", CMF.getInventory(), incoming);
  seed(local);
  const mergeCode = CMF.syncEncode({ d: { inv: incoming } });
  const report = CMF.applySyncPayload(CMF.syncDecode(mergeCode), { mode: "merge" });
  equal("merge reports exactly the inventory key", [report.mode, report.count, report.keys], ["merge", 1, ["cmf.inventory"]]);
  equal("sync invokes inventory-aware merge including tombstones and ties", CMF.getInventory(), expected);
  const once = localStorage.getItem("cmf.inventory");
  CMF.applySyncPayload(CMF.syncDecode(mergeCode), { mode: "merge" });
  equal("repeated sync import is byte-idempotent", localStorage.getItem("cmf.inventory"), once);
  CMF.applySyncPayload({ d: { inv: inventory(incoming.batches[2]) } }, { mode: "merge" });
  equal("reimport older live batch cannot resurrect tombstone", localStorage.getItem("cmf.inventory"), once);
  CMF.applySyncPayload({ d: { inv: inventory() } }, { mode: "merge" });
  equal("empty inventory merge does not clear local rows", localStorage.getItem("cmf.inventory"), once);
  seed(incoming);
  CMF.applySyncPayload({ d: { inv: local } }, { mode: "merge" });
  equal("sync merge commutes across devices", CMF.getInventory(), expected);
  const replacement = inventory(batch("replacement", { grams: 7 }));
  const replaced = CMF.applySyncPayload({ d: { inv: replacement } }, { mode: "replace" });
  equal("explicit replace reports inventory", [replaced.mode, replaced.count], ["replace", 1]);
  equal("explicit replace replaces, never unions inventory", CMF.getInventory(), replacement);
  CMF.applySyncPayload({ version: 1, data: { "cmf.inventory": local } }, { mode: "replace" });
  equal("legacy long-key sync restore supports inventory", CMF.getInventory(), local);
  check("inventory excluded from QR slim allowlist", !CMF.SYNC_SLIM_KEYS.includes("cmf.inventory"));
  const slim = CMF.syncPayload({ slim: true });
  equal("QR slim marker", slim.slim, true);
  check("QR slim snapshot excludes both inventory key forms", !Object.hasOwn(slim.d, "inv") && !Object.hasOwn(slim.d, "cmf.inventory"));
  equal("QR slim still carries fridge", slim.d.f, ["番茄"]);
  const slimDecoded = CMF.syncDecode(CMF.syncEncode(slim, { short: true }));
  check("QR slim encoded payload cannot leak inventory", !Object.hasOwn(slimDecoded.d, "inv") && !Object.hasOwn(slimDecoded.d, "cmf.inventory"));
  const inventoryBefore = localStorage.getItem("cmf.inventory");
  attempts = [];
  CMF.applySyncPayload(slimDecoded, { mode: "replace" });
  equal("replacing from slim leaves excluded local inventory intact", localStorage.getItem("cmf.inventory"), inventoryBefore);
  check("slim import never writes inventory", !attempts.includes("cmf.inventory"));
  reset();
  CMF.applySyncPayload(slimDecoded, { mode: "replace" });
  equal("slim import on empty device creates no inventory", localStorage.getItem("cmf.inventory"), null);
});

section("offline", () => equal("no external network calls", networkCalls, 0));
const result = { ok: failures.length === 0, checks, sections, failures };
console.log(JSON.stringify(result));
if (failures.length) {
  console.error("INVENTORY TEST FAILURES:\n" + failures.join("\n"));
  process.exitCode = 1;
}
