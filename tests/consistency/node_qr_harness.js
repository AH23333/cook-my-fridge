/* Headless tests for the QR encoder (byte mode, EC level M, v1-v10).
   Usage: node node_qr_harness.js [project_root] [--emit <output.json>]
   --emit writes matrices so a Python decoder (ZXing/OpenCV) can verify that
   the generated symbols are actually scannable, not just structurally valid. */
const fs = require("fs");
const path = require("path");

const base = process.argv[2] || path.resolve(__dirname, "..", "..");
global.window = {};
// eslint-disable-next-line no-eval
eval(fs.readFileSync(path.join(base, "web/js/store.js"), "utf8"));
// eslint-disable-next-line no-eval
eval(fs.readFileSync(path.join(base, "web/js/qrcode.js"), "utf8"));
const CMF = global.window.CMF;

const failures = [];
let checks = 0;
function check(name, cond) {
  checks += 1;
  if (!cond) failures.push(name);
}

const CAPACITY = [0, 14, 26, 42, 62, 84, 106, 122, 152, 180, 213];
const RAW = [0, 26, 44, 70, 100, 134, 172, 196, 242, 292, 346];

// 1. capacity table and version selection
for (let v = 1; v <= 10; v += 1) {
  check("capacity v" + v, CMF.qrCapacity(v) === CAPACITY[v]);
}
check("invalid version capacity", CMF.qrCapacity(0) === 0 && CMF.qrCapacity(11) === 0);
const short = CMF.qrMatrix("HELLO WORLD");
check("short text v1", short.version === 1 && short.size === 21);
check("version from byte length", CMF.qrMatrix("a".repeat(30)).version === 3);
check("long url version grows", CMF.qrMatrix("https://example.com/" + "a".repeat(100)).version >= 6);
check("minVersion override", CMF.qrMatrix("HELLO WORLD", { minVersion: 5 }).version === 5);
check("too long throws", (() => {
  try { CMF.qrMatrix("a".repeat(300)); return false; } catch (e) { return /too long/i.test(e.message); }
})());
check("utf8 bytes counted", CMF.qrMatrix("中文测试").bytes === 12);
check("emoji surrogate pair", CMF.qrMatrix("🍳").bytes === 4);

// 2. structural invariants across versions/masks
function finderAt(modules, ox, oy) {
  for (let y = 0; y < 7; y += 1) {
    for (let x = 0; x < 7; x += 1) {
      const edge = x === 0 || x === 6 || y === 0 || y === 6;
      const core = x >= 2 && x <= 4 && y >= 2 && y <= 4;
      const expected = edge || core;
      if (!!modules[oy + y][ox + x] !== expected) return false;
    }
  }
  return true;
}
function formatBits(q) {
  const pos = [];
  for (let i = 0; i <= 5; i += 1) pos.push([8, i]);
  pos.push([8, 7], [8, 8], [7, 8]);
  for (let i = 9; i < 15; i += 1) pos.push([14 - i, 8]);
  let bits = 0;
  pos.forEach(([x, y], i) => { bits |= (q.modules[y][x] ? 1 : 0) << i; });
  return bits;
}
for (let v = 1; v <= 10; v += 1) {
  const text = "x".repeat(Math.max(1, CAPACITY[v] - 5));
  const q = CMF.qrMatrix(text, { minVersion: v });
  check("v" + v + " size", q.size === v * 4 + 17);
  check("v" + v + " codewords", q.codewords.length === RAW[v]);
  check("v" + v + " 3 finders",
    finderAt(q.modules, 0, 0) &&
    finderAt(q.modules, q.size - 7, 0) &&
    finderAt(q.modules, 0, q.size - 7));
  check("v" + v + " timing row", (() => {
    for (let x = 8; x < q.size - 8; x += 1) {
      if (!!q.modules[6][x] !== (x % 2 === 0)) return false;
    }
    return true;
  })());
  check("v" + v + " dark module", q.modules[q.size - 8][8] === true);
  check("v" + v + " format BCH", (() => {
    const bits = formatBits(q);
    const data = ((bits ^ 0x5412) >>> 10) & 0x1f;
    const rem = (bits ^ 0x5412) & 0x3ff;
    let calc = data;
    for (let i = 0; i < 10; i += 1) calc = (calc << 1) ^ ((calc >>> 9) * 0x537);
    return (calc & 0x3ff) === rem && (data & 7) === q.mask;
  })());
  check("v" + v + " alignment table", (() => {
    // v1 has no alignment pattern, so (16,16) must be a data module.
    if (v === 1) return q.isFunction[16][16] === false;
    return true;
  })());
  check("v" + v + " version info reserved", v < 7 || q.isFunction[0][q.size - 11] === true);
}

// 3. all eight masks produce valid, deterministic matrices
for (let mask = 0; mask < 8; mask += 1) {
  const a = CMF.qrMatrix("HELLO WORLD", { mask });
  const b = CMF.qrMatrix("HELLO WORLD", { mask });
  check("mask " + mask + " encoded in format bits",
    a.mask === mask && (((formatBits(a) ^ 0x5412) >>> 10) & 7) === mask);
  check("mask " + mask + " deterministic", JSON.stringify(a.modules) === JSON.stringify(b.modules));
  check("mask " + mask + " differs from next", mask === 7 ||
    JSON.stringify(a.modules) !== JSON.stringify(CMF.qrMatrix("HELLO WORLD", { mask: mask + 1 }).modules));
}
check("invalid mask falls back to auto", (() => {
  const q = CMF.qrMatrix("HELLO WORLD", { mask: 99 });
  return q.mask >= 0 && q.mask <= 7;
})());

// 4. Canvas drawing geometry
const rects = [];
const ctx = {
  fillStyle: "",
  fillRect: function (x, y, w, h) {
    rects.push({ x, y, w, h, color: this.fillStyle });
  },
};
const drawText = "http://127.0.0.1:8801/recipe.html?id=r001";
const geo = CMF.drawQR(ctx, drawText, 576, 556, 168, { light: "#ffffff", dark: "#2c2620" });
const drawn = CMF.qrMatrix(drawText);
const darkCount = drawn.modules.reduce((n, row) => n + row.filter(Boolean).length, 0);
check("drawQR geometry", geo.size > 100 && geo.size <= 168 && geo.cell >= 1);
check("drawQR version", geo.version === drawn.version);
check("drawQR one light background", rects.filter((r) => r.w === geo.size && r.h === geo.size).length === 1);
check("drawQR dark cell count", rects.length - 1 === darkCount);
check("drawQR dark colour", rects.slice(1).every((r) => r.color === "#2c2620"));
check("drawQR cell squares", rects.slice(1).every((r) => r.w === geo.cell && r.h === geo.cell));
check("drawQR inside requested box", rects.every((r) =>
  r.x >= 576 && r.y >= 556 && r.x + r.w <= 744 && r.y + r.h <= 724));
check("drawQR quiet zone", (() => {
  const firstDark = rects.slice(1)[0];
  return firstDark.x >= geo.x + 4 * geo.cell && firstDark.y >= geo.y + 4 * geo.cell;
})());
check("drawQR deterministic", (() => {
  rects.length = 0;
  const again = CMF.drawQR(ctx, drawText, 576, 556, 168);
  return again.size === geo.size && rects.length - 1 === darkCount;
})());
check("drawQR tiny box still draws", (() => {
  rects.length = 0;
  const g = CMF.drawQR(ctx, "A", 0, 0, 10);
  return g.cell >= 1 && rects.length > 1;
})());

// 5. emit matrices for a real decoder test in Python
const PAYLOADS = [
  "http://127.0.0.1:8801/recipe.html?id=r001",
  "https://cookmyfridge.example.com/recipe.html?id=r105",
  "https://example.com/a/very/long/path/recipe.html?id=r999&from=share&utm_source=qr-code-card",
  "中文测试 🍳 CookMyFridge",
  "HELLO WORLD",
  "https://example.com/recipe.html?id=" + "x".repeat(120),
];
if (process.argv[3] === "--emit" && process.argv[4]) {
  const rows = PAYLOADS.map((text) => {
    const q = CMF.qrMatrix(text);
    return { text, size: q.size, version: q.version, mask: q.mask, modules: q.modules };
  });
  fs.writeFileSync(process.argv[4], JSON.stringify(rows));
}
check("all payloads encode", PAYLOADS.every((t) => CMF.qrMatrix(t).size > 0));
check("longest payload within capacity", CMF.qrMatrix(PAYLOADS[5]).version <= 10);

if (failures.length) {
  console.error("QR TEST FAILURES:", failures);
  process.exit(1);
}
console.log(JSON.stringify({ ok: true, checks, payloads: PAYLOADS.length }));
