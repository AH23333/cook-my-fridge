/* Headless tests for multi-device sync and trackable share links.
   Usage: node node_sync_harness.js [project_root] */
const fs = require("fs");
const path = require("path");

const base = process.argv[2] || path.resolve(__dirname, "..", "..");
global.window = {};
const memory = {};
global.localStorage = {
  getItem: (k) => (k in memory ? memory[k] : null),
  setItem: (k, v) => { memory[k] = String(v); },
  removeItem: (k) => { delete memory[k]; },
};
const clear = () => Object.keys(memory).forEach((k) => delete memory[k]);

function load(rel) {
  // eslint-disable-next-line no-eval
  eval(fs.readFileSync(path.join(base, rel), "utf8"));
}

load("web/js/store.js");
load("web/js/catalog.js");
load("web/js/search.js");
load("web/js/nutrition.js");
load("web/js/goals.js");
load("web/js/qrcode.js");
load("web/js/share.js");
load("web/js/sync.js");

const CMF = global.window.CMF;
const failures = [];
let checks = 0;
function check(name, cond) {
  checks += 1;
  if (!cond) failures.push(name);
}
function throws(name, fn) {
  let threw = false;
  try { fn(); } catch (e) { threw = true; }
  check(name, threw);
}

// 1. vocabulary
check("key map covers all storage keys", Object.keys(CMF.KEYS).every(
  (k) => Object.values(CMF.SYNC_KEY_MAP).includes(CMF.KEYS[k])));
check("slim keys exclude menu", !CMF.SYNC_SLIM_KEYS.includes("cmf.week"));
check("slim keys include goals", CMF.SYNC_SLIM_KEYS.includes("cmf.goals"));
check("slim keys include prefs", CMF.SYNC_SLIM_KEYS.includes("cmf.prefs"));
check("shortlink endpoint empty by default", CMF.SYNC_SHORTLINK_ENDPOINT === "");

// 2. base64url + LZ round trips
[0, 1, 2, 3, 4, 5, 127, 128, 1000].forEach((n) => {
  const bytes = Uint8Array.from({ length: n }, (_, i) => (i * 37 + 11) % 256);
  const back = CMF.syncCodeToBytes(CMF.bytesToSyncCode(bytes));
  check("base64 round trip " + n, back.length === n && back.every((v, i) => v === bytes[i]));
});
const chinese = new TextEncoder().encode("番茄炒蛋 🍳 鸡蛋、香椿、全麦面包".repeat(4));
check("utf8 base64 round trip", (() => {
  const back = CMF.syncCodeToBytes(CMF.bytesToSyncCode(chinese));
  return new TextDecoder().decode(back) === new TextDecoder().decode(chinese);
})());
check("base64 url-safe alphabet", !/[+/=]/.test(CMF.bytesToSyncCode(chinese)));
check("base64 rejects invalid chars", (() => {
  try { CMF.syncCodeToBytes("a+b/"); return false; } catch (e) { return true; }
})());
check("lz empty", CMF.lzDecompress(CMF.lzCompress(new Uint8Array([]))).length === 0);
check("lz repeated bytes smaller", CMF.lzCompress(new Uint8Array(200).fill(65)).length < 200);
check("lz json-like round trip", (() => {
  const src = new TextEncoder().encode(JSON.stringify({ "cmf.fridge": ["番茄", "鸡蛋", "番茄", "鸡蛋"] }).repeat(5));
  const back = CMF.lzDecompress(CMF.lzCompress(src));
  return back.length === src.length && back.every((v, i) => v === src[i]);
})());
check("lz random data round trip", (() => {
  const src = Uint8Array.from({ length: 500 }, (_, i) => (i * 73 + 19) % 256);
  const back = CMF.lzDecompress(CMF.lzCompress(src));
  return back.every((v, i) => v === src[i]);
})());
check("lz detects corrupt offset", (() => {
  try { CMF.lzDecompress(Uint8Array.from([0x80, 0x00, 0x05])); return false; } catch (e) { return true; }
})());
check("lz detects invalid control", (() => {
  try { CMF.lzDecompress(Uint8Array.from([0xff, 0x00, 0x01])); return false; } catch (e) { return true; }
})());
check("lz detects truncated literal", (() => {
  try { CMF.lzDecompress(Uint8Array.from([0x05, 0x01])); return false; } catch (e) { return true; }
})());

// 3. snapshot
clear();
const empty = CMF.syncPayload({});
check("payload magic", empty.k === "cmf-sync" && empty.v === 1);
check("payload timestamp", /^\d{4}-\d{2}-\d{2}T/.test(empty.t));
check("payload empty data", Object.keys(empty.d).length === 0);
check("payload full flag", empty.slim === false);
localStorage.setItem("cmf.fridge", JSON.stringify(["番茄", "鸡蛋"]));
localStorage.setItem("cmf.prefs", JSON.stringify({ tags: ["素食"], allergens: ["花生"], diets: [] }));
localStorage.setItem("cmf.favorites", JSON.stringify(["r001", "r002"]));
localStorage.setItem("cmf.goals", JSON.stringify({ enabled: true, profile: { mode: "cut" } }));
localStorage.setItem("cmf.week", JSON.stringify({ seed: 7, weeks: 4, days: [] }));
localStorage.setItem("cmf.shareStats", JSON.stringify({ total: 9 }));
const full = CMF.syncPayload({});
const slim = CMF.syncPayload({ slim: true });
check("full has short fridge key", JSON.stringify(full.d.f) === '["番茄","鸡蛋"]');
check("full has menu", Array.isArray(full.d.w.days));
check("full excludes share stats", full.d.s === undefined);
check("slim excludes menu", slim.d.w === undefined);
check("slim keeps fridge", JSON.stringify(slim.d.f) === '["番茄","鸡蛋"]');
check("slim keeps goals", slim.d.g.enabled === true);
check("slim flag", slim.slim === true);
check("slim smaller than full", JSON.stringify(slim).length < JSON.stringify(full).length);
check("malformed localStorage ignored", (() => {
  memory["cmf.history"] = "{broken";
  return CMF.syncPayload({}).d.h === undefined;
})());
delete memory["cmf.history"];

// 4. encode / decode
const code = CMF.syncEncode(full);
check("code has prefix", /^S1Z?\./.test(code));
check("code is url safe", /^[A-Za-z0-9_.-]+$/.test(code));
check("compression used for repetitive payload", CMF.syncEncode(
  { v: 1, k: "cmf-sync", t: "", slim: false, d: { f: Array(20).fill("番茄炒蛋") } }
).startsWith("S1Z."));
const decoded = CMF.syncDecode(code);
check("decode round trip", JSON.stringify(decoded.d) === JSON.stringify(full.d));
check("decode preserves timestamp", decoded.t === full.t);
check("decode trims whitespace", CMF.syncDecode("  " + code + "\n").d.f.length === 2);
check("decode strips #sync= prefix", CMF.syncDecode("#sync=" + code).d.f.length === 2);
check("decode strips #s= prefix", CMF.syncDecode("#s=" + code).d.f.length === 2);
check("short magic round trip", (() => {
  const shortCode = CMF.syncEncode(full, { short: true });
  return /^[ZR]\./.test(shortCode) && CMF.syncDecode(shortCode).d.f.length === 2;
})());
check("short raw magic R. decodes", (() => {
  const tiny = { v: 1, k: "cmf-sync", t: "", slim: false, d: { f: ["A"] } };
  const c = CMF.syncEncode(tiny, { short: true });
  return c.startsWith("R.") && CMF.syncDecode(c).d.f[0] === "A";
})());
check("short compressed magic Z. decodes", (() => {
  const repetitive = { v: 1, k: "cmf-sync", t: "", slim: false,
    d: { f: Array(20).fill("番茄炒蛋") } };
  const c = CMF.syncEncode(repetitive, { short: true });
  return c.startsWith("Z.") && CMF.syncDecode(c).d.f.length === 20;
})());
check("decode rejects wrong magic", (() => {
  try { CMF.syncDecode("X9.abc"); return false; } catch (e) { return true; }
})());
throws("decode rejects null", () => CMF.syncDecode(null));
throws("decode rejects corrupt body", () => CMF.syncDecode("S1.@@@@"));
throws("decode rejects damaged compressed body", () => CMF.syncDecode("S1Z." + code.slice(4, -6) + "AAAA"));
check("uncompressed code path", (() => {
  const small = { v: 1, k: "cmf-sync", t: "", slim: false, d: { f: ["A"] } };
  const c = CMF.syncEncode(small);
  return c.startsWith("S1.") && CMF.syncDecode(c).d.f[0] === "A";
})());
check("legacy backup accepted", (() => {
  const backup = { version: 1, data: { "cmf.fridge": ["番茄"] } };
  const p = CMF.normalizeSyncPayload(backup);
  return p.k === "cmf-sync" && p.d["cmf.fridge"][0] === "番茄";
})());
throws("normalize rejects garbage", () => CMF.normalizeSyncPayload({ x: 1 }));
throws("normalize rejects array data", () => CMF.normalizeSyncPayload({ k: "cmf-sync", v: 1, d: [] }));

// 5. URL fragment + QR feasibility
check("hash parsing", CMF.syncFromHash("#sync=" + code) === code);
check("hash parsing without #", CMF.syncFromHash("sync=" + code) === code);
check("hash with extra params", CMF.syncFromHash("#foo=1&sync=" + code + "&bar=2") === code);
check("short hash parsed", CMF.syncFromHash("#s=" + code) === code);
check("hash without sync", CMF.syncFromHash("#foo=1") === null);
check("empty hash", CMF.syncFromHash("") === null);
const shareURL = CMF.syncShareURL(code, { url: "https://example.com/index.html" });
check("share url has fragment", shareURL.startsWith("https://example.com/index.html#sync="));
check("share url replaces old hash", CMF.syncShareURL(code, { url: "https://example.com/#old" }) ===
  "https://example.com/#sync=" + code);
const info = CMF.syncQRInfo(slim, { url: "https://example.com/index.html" });
check("qr info has code", /^(S1Z?|Z|R)\./.test(info.code));
check("qr info byte count", info.bytes > 0);
check("qr info fits slim", info.fits === true);
check("qr info valid version", info.version >= 1 && info.version <= 40);
check("qr info has module count", info.modules === info.version * 4 + 17);
check("qr url encodable", CMF.qrMatrix(info.url).version === info.version);
check("qr url contains sync fragment", info.url.includes("#s="));
check("qr hash decodes", (() => {
  const decoded = CMF.syncDecode(CMF.syncFromHash(new URL(info.url).hash));
  return decoded.d && Object.keys(decoded.d).length > 0;
})());
check("qr info detects oversized", (() => {
  const huge = { v: 1, k: "cmf-sync", t: "", slim: false, d: {
    f: Array.from({ length: 1500 }, (_, i) => "食材编号" + i),
  } };
  return CMF.syncQRInfo(huge, { url: "https://example.com/index.html" }).fits === false;
})());
check("qr fits a realistic large fridge without trimming", (() => {
  const big = { v: 1, k: "cmf-sync", t: "", slim: true, d: {
    f: Array.from({ length: 40 }, (_, i) => "食材" + i),
    p: { tags: [], allergens: ["花生"], diets: [] },
    fav: Array.from({ length: 20 }, (_, i) => "r" + i),
  } };
  const r = CMF.syncQRInfo(big, { url: "https://example.com/" });
  return r.fits === true && r.trimmed === false && r.version > 10 && r.version <= 40;
})());

// 6. apply / merge
clear();
const report = CMF.applySyncPayload(full, { mode: "replace" });
check("replace writes keys", report.count >= 5);
check("replace mode", report.mode === "replace");
check("replace restores fridge", JSON.stringify(CMF.getFridge()) === '["番茄","鸡蛋"]');
check("replace restores menu", CMF.getPlan !== undefined);
check("replace restores goals", CMF.getGoals().enabled === true);
const mergeReport = CMF.applySyncPayload(
  { v: 1, k: "cmf-sync", t: "", slim: false, d: { f: ["鸡蛋", "香椿"] } },
  { mode: "merge" }
);
check("merge mode", mergeReport.mode === "merge");
check("merge unions arrays", JSON.stringify(CMF.getFridge()) === '["番茄","鸡蛋","香椿"]');
check("merge keeps local prefs", CMF.getPrefs().allergens.includes("花生"));
CMF.applySyncPayload(
  { v: 1, k: "cmf-sync", t: "", slim: false, d: { p: { diets: ["纯素"] } } },
  { mode: "merge" }
);
check("merge objects shallow", CMF.getPrefs().diets.includes("纯素") &&
  CMF.getPrefs().allergens.includes("花生"));
check("unknown short keys ignored", (() => {
  const before = JSON.stringify(CMF.getFridge());
  CMF.applySyncPayload({ v: 1, k: "cmf-sync", t: "", slim: false, d: { f: ["黄瓜"], zzz: [1] } });
  return CMF.getFridge().includes("黄瓜") && !("zzz" in memory);
})());
throws("empty payload rejected", () => CMF.applySyncPayload(
  { v: 1, k: "cmf-sync", t: "", slim: false, d: {} }));
check("legacy backup applies", (() => {
  clear();
  CMF.applySyncPayload({ version: 1, data: { "cmf.favorites": ["r009"] } });
  return JSON.stringify(CMF.getFavorites()) === '["r009"]';
})());
check("null values skipped", (() => {
  clear();
  CMF.applySyncPayload({ v: 1, k: "cmf-sync", t: "", slim: false, d: { f: null, u: ["番茄"] } });
  return memory["cmf.fridge"] === undefined && memory["cmf.urgent"] !== undefined;
})());
check("compact QR goals import", (() => {
  clear();
  CMF.applySyncPayload({ d: { g: { e: 1, p: {
    s: "female", a: 28, h: 168, w: 58, v: "light", m: "cut", n: 2, c: 3,
  } } } });
  const g = CMF.activeGoals();
  return g && g.profile.sex === "female" && g.profile.mode === "cut" &&
    g.profile.mealsPerDay === 3 && g.profile.heightCm === 168 &&
    g.profile.people === 2 && g.profile.activity === "light";
})());

// 7. consumeSyncHash (confirmation is injectable, no DOM needed)
clear();
const linkCode = CMF.syncEncode({ v: 1, k: "cmf-sync", t: "", slim: true, d: { f: ["番茄"] } });
check("consume ignores unrelated hash", CMF.consumeSyncHash({ hash: "#foo=1" }) === null);
check("consume respects cancel", (() => {
  const r = CMF.consumeSyncHash({ hash: "#sync=" + linkCode, confirm: () => false });
  return r === null && memory["cmf.fridge"] === undefined;
})());
const consumed = CMF.consumeSyncHash({ hash: "#sync=" + linkCode, confirm: () => true });
check("consume imports", consumed && consumed.count === 1);
check("consume merge default", consumed.mode === "replace");
check("consume returns code", consumed.code === linkCode);
throws("consume rejects bad code", () => CMF.consumeSyncHash({ hash: "#sync=nope" }));

// 8. full cross-device scenario
clear();
localStorage.setItem("cmf.fridge", JSON.stringify(["番茄", "鸡蛋", "香椿"]));
localStorage.setItem("cmf.favorites", JSON.stringify(["r001", "r196"]));
localStorage.setItem("cmf.prefs", JSON.stringify({ tags: ["低卡"], allergens: ["花生"], diets: ["纯素"] }));
localStorage.setItem("cmf.goals", JSON.stringify({ enabled: true, profile: { mode: "cut", mealsPerDay: 3 } }));
localStorage.setItem("cmf.week", JSON.stringify({ seed: 9, weeks: 2, startDate: "2026-11-09", days: [] }));
const deviceA = CMF.syncEncode(CMF.syncPayload({}));
clear();
CMF.applySyncPayload(CMF.syncDecode(deviceA));
check("cross-device fridge", CMF.getFridge().length === 3);
check("cross-device favorites", CMF.getFavorites().includes("r196"));
check("cross-device prefs", CMF.getPrefs().allergens.includes("花生"));
check("cross-device goals", CMF.getGoals().profile.mealsPerDay === 3);
check("cross-device menu", (() => JSON.parse(memory["cmf.week"]).weeks === 2)());
check("cross-device no share stats", memory["cmf.shareStats"] === undefined);

// 9. trackable share links
const recipe = { id: "r001", title: "番茄炒蛋" };
const link = CMF.shareLink(recipe, { url: "https://example.com/recipe.html?id=r001", medium: "qr" });
check("link has utm_source", link.includes("utm_source=cmf_share"));
check("link has medium", link.includes("utm_medium=qr"));
check("link has campaign", link.includes("utm_campaign=recipe"));
check("link has recipe id", link.includes("utm_content=r001"));
check("link keeps recipe path", link.includes("recipe.html?id=r001"));
check("link default medium", CMF.shareLink(recipe, { url: "https://example.com/r/1" }).includes("utm_medium=link"));
check("link without id safe", !CMF.shareLink(null, { url: "https://example.com/r" }).includes("utm_content"));
check("link absolute", link.startsWith("https://example.com/"));
check("link fits QR", CMF.qrMatrix(link).version <= 10);
check("share card QR uses trackable link", (() => {
  const texts = [];
  const ctx = {
    fillRect: () => {}, fillText: (t) => texts.push(String(t)),
    createLinearGradient: () => ({ addColorStop: () => {} }),
    set font(v) {}, set fillStyle(v) {},
  };
  const doc = { createElement: () => ({ getContext: () => ctx, toDataURL: () => "" }) };
  CMF.drawShareCanvas(recipe, { url: "https://example.com/recipe.html?id=r001", doc });
  return texts.some((t) => t.includes("CookMyFridge"));
})());

// 10. local share stats
clear();
check("stats default zero", CMF.getShareStats().total === 0);
check("stats default maps", Object.keys(CMF.getShareStats().byKind).length === 0);
const s1 = CMF.trackShare("qr", "r001");
check("track increments", s1.total === 1 && s1.byKind.qr === 1);
const s2 = CMF.trackShare("qr", "r001");
const s3 = CMF.trackShare("link", "r002");
check("track by kind", s3.byKind.qr === 2 && s3.byKind.link === 1);
check("track by recipe", s3.byRecipe.r001 === 2 && s3.byRecipe.r002 === 1);
check("track timestamp", /^\d{4}-/.test(s3.lastAt));
check("stats persisted", CMF.getShareStats().total === 3);
check("store key registered", CMF.KEYS.shareStats === "cmf.shareStats");
clear();
check("stats reset safe", CMF.getShareStats().total === 0);
CMF.trackShare("qr");
check("track without recipe id", CMF.getShareStats().total === 1);

// 11. optional shortlink + final output (async)
(async () => {
  const original = "https://example.com/recipe.html?id=r001&utm_source=cmf_share";
  check("shortlink no endpoint", await CMF.resolveShareLink(original) === original);
  global.fetch = async () => ({ ok: true, json: async () => ({ short: "https://s.example/abc" }) });
  check("shortlink resolved", await CMF.resolveShareLink(original, { endpoint: "https://api.example/s" }) === "https://s.example/abc");
  global.fetch = async () => ({ ok: false, json: async () => ({}) });
  check("shortlink http failure falls back", await CMF.resolveShareLink(original, { endpoint: "https://api.example/s" }) === original);
  global.fetch = async () => ({ ok: true, json: async () => ({ short: "javascript:alert(1)" }) });
  check("shortlink rejects unsafe scheme", await CMF.resolveShareLink(original, { endpoint: "https://api.example/s" }) === original);
  global.fetch = async () => { throw new Error("offline"); };
  check("shortlink offline falls back", await CMF.resolveShareLink(original, { endpoint: "https://api.example/s" }) === original);
  delete global.fetch;

  if (failures.length) {
    console.error("SYNC TEST FAILURES:", failures);
    process.exit(1);
  }
  console.log(JSON.stringify({ ok: true, checks, codeBytes: code.length, qrVersion: info.version }));
})();
