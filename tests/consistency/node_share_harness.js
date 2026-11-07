/* Headless test for the canvas share card.
   Usage: node node_share_harness.js [project_root] */
const fs = require("fs");
const path = require("path");

const base = process.argv[2] || path.resolve(__dirname, "..", "..");
global.window = {};

function load(rel) {
  const code = fs.readFileSync(path.join(base, rel), "utf8");
  // eslint-disable-next-line no-eval
  eval(code);
}

load("web/js/store.js");
load("web/js/catalog.js");
load("web/js/nutrition.js");
load("web/js/qrcode.js");
load("web/js/share.js");

const CMF = global.window.CMF;
CMF.data = {
  catalog: JSON.parse(fs.readFileSync(path.join(base, "site/data/catalog.json"), "utf8")),
  recipes: JSON.parse(fs.readFileSync(path.join(base, "site/data/recipes.json"), "utf8")),
};
CMF.initCatalog();

const failures = [];
let checks = 0;
function check(name, cond) {
  checks += 1;
  if (!cond) failures.push(name);
}

const texts = [];
const rects = [];
const ctx = {
  font: "",
  fillStyle: "",
  fillText: (t, x, y) => texts.push({ t: String(t), x, y }),
  fillRect: (x, y, w, h) => rects.push({ x, y, w, h }),
  createLinearGradient: () => ({ addColorStop: () => {} }),
};
const canvas = {
  width: 0,
  height: 0,
  getContext: () => ctx,
  toDataURL: () => "data:image/png;base64,AAA",
};
const doc = { createElement: (tag) => (tag === "canvas" ? canvas : {}) };

function draw(recipe, opts) {
  texts.length = 0;
  rects.length = 0;
  const c = CMF.drawShareCanvas(recipe, Object.assign({ doc }, opts || {}));
  return texts.map((t) => t.t);
}

const recipe = CMF.data.recipes[0];
const lines = draw(recipe);
const joined = lines.join("|");

// 1. canvas geometry and structure
check("canvas size 800x1200", canvas.width === 800 && canvas.height === 1200);
check("background drawn", rects.some((r) => r.w === 800 && r.h === 1200));
check("header band drawn", rects.some((r) => r.h === 260));
check("nutrition card drawn", rects.some((r) => r.w === 688 && r.h === 164));
check("toDataURL available", canvas.toDataURL().startsWith("data:image/png"));

// 2. text content
check("brand on card", joined.includes("CookMyFridge"));
check("slogan on card", joined.includes("Don't order. CookMyFridge."));
check("title on card", joined.includes(recipe.title));
check("time on card", joined.includes(recipe.time_minutes + " 分钟"));
check("difficulty on card", joined.includes(recipe.difficulty));
check("ingredient section", joined.includes("食材与用量"));
check("first ingredient shown", joined.includes(recipe.ingredients[0].canonical));
check("amount shown", joined.includes(String(recipe.ingredients[0].amount).trim()));
check("nutrition section", joined.includes("营养估算 · 每份"));
check("four nutrition labels", ["热量", "蛋白质", "脂肪", "碳水"].every((s) => joined.includes(s)));
check("calorie value shown", joined.includes(CMF.estimateNutrition(recipe).perServing.kcal + " kcal"));
check("disclaimer shown", joined.includes("仅供参考"));
check("closing slogan", joined.includes("别点外卖"));
check("no undefined", !joined.includes("undefined"));
check("no NaN", !joined.includes("NaN"));
check("all text inside canvas", texts.every((t) => t.y > 0 && t.y <= 1200 && t.x >= 0));

// 2b. QR code on the card
const qrCells = rects.filter((r) => r.w === r.h && r.w >= 2 && r.w <= 8 && r.x >= 576 && r.y >= 556);
check("QR dark modules drawn", qrCells.length > 80);
check("QR quiet-zone background", rects.some((r) => r.w === r.h && r.w >= 120 && r.w <= 168));
check("QR caption on card", joined.includes("扫码看菜谱"));
check("QR stays inside canvas", qrCells.every((r) => r.x >= 576 && r.y >= 556 && r.x + r.w <= 744 && r.y + r.h <= 724));
check("shareUrl explicit injection", CMF.shareUrl(recipe, { url: "https://example.com/r/1" }) === "https://example.com/r/1");
check("shareUrl default points at recipe", CMF.shareUrl(recipe).includes("recipe.html?id="));
check("QR missing module degrades", (() => {
  const saved = CMF.drawQR;
  CMF.drawQR = undefined;
  const out = draw(recipe).join("|");
  CMF.drawQR = saved;
  return out.includes(recipe.title) && !out.includes("扫码看菜谱");
})());
check("overlong QR url does not break card", (() => {
  try {
    const out = draw(recipe, { url: "a".repeat(400) }).join("|");
    return out.includes(recipe.title) && !out.includes("扫码看菜谱");
  } catch (err) { return false; }
})());

// 3. AI labelling
const aiRecipe = { ...recipe, is_ai_generated: true };
check("AI label shown", draw(aiRecipe).join("|").includes("AI 创意"));
check("no AI label on curated", !lines.join("|").includes("AI 创意"));

// 4. long titles and long ingredient lists
const longTitle = { ...recipe, title: "一道名字特别特别特别长的家常拿手好菜升级版" };
const longLines = draw(longTitle);
check("long title wrapped", longLines.some((t) => t.length <= 14 && t.includes("…") || t === longTitle.title.slice(0, 13)));
const manyIngredients = {
  ...recipe,
  ingredients: Array.from({ length: 12 }, (_, i) => ({
    canonical: CMF.data.catalog.ingredients[i].canonical,
    amount: "1 个",
    optional: i === 3,
  })),
};
const manyLines = draw(manyIngredients).join("|");
check("ingredient list truncated", manyLines.includes("…等共 12 样食材"));
check("optional marked", manyLines.includes("（可选）"));

// 5. graceful degradation
const savedEstimate = CMF.estimateNutrition;
CMF.estimateNutrition = undefined;
const degraded = draw(recipe).join("|");
CMF.estimateNutrition = savedEstimate;
check("no nutrition data still draws", degraded.includes("营养估算 · 每份") && degraded.includes("—"));
const savedEmoji = CMF.emojiOf;
CMF.emojiOf = undefined;
check("emoji fallback", draw(recipe).join("|").includes("🍽️"));
CMF.emojiOf = savedEmoji;

// 6. share text & filename
const shareText = CMF.shareText(recipe);
check("shareText has title", shareText.includes(recipe.title));
check("shareText has ingredients", shareText.includes(recipe.ingredients[0].canonical));
check("shareText has calories", shareText.includes("kcal"));
check("shareText has disclaimer", shareText.includes("仅供参考"));
check("shareText AI note", CMF.shareText(aiRecipe).includes("AI 创意菜"));
check("filename sanitized", !/[\/:*?"<>|\s]/.test(CMF.shareFileName({ ...recipe, title: "番 茄/炒:蛋" })));
check("filename png", CMF.shareFileName(recipe).endsWith(".png"));

// 7. whole dataset smoke test + determinism
let smokeOk = true;
CMF.data.recipes.forEach((r) => {
  try {
    const t = draw(r).join("|");
    if (!t.includes(r.title) || t.includes("undefined") || t.includes("NaN")) smokeOk = false;
  } catch (err) {
    smokeOk = false;
  }
});
check("all 195 recipes drawable", smokeOk);
const once = draw(recipe).join("|");
const twice = draw(recipe).join("|");
check("deterministic card", once === twice);

if (failures.length) {
  console.error("SHARE TEST FAILURES:", failures);
  process.exit(1);
}
console.log(JSON.stringify({ ok: true, checks, recipes: CMF.data.recipes.length }));
