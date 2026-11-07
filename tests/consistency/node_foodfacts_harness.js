/* Headless test for foodfacts.js (Open Food Facts glue).
   Usage: node node_foodfacts_harness.js [project_root] */
const fs = require("fs");
const path = require("path");

const base = process.argv[2] || path.resolve(__dirname, "..", "..");
const mem = new Map();
global.window = {};
global.localStorage = {
  getItem: (k) => (mem.has(k) ? mem.get(k) : null),
  setItem: (k, v) => mem.set(k, String(v)),
  removeItem: (k) => mem.delete(k),
};

function load(rel) {
  // eslint-disable-next-line no-eval
  eval(fs.readFileSync(path.join(base, rel), "utf8"));
}
load("web/js/foodfacts.js");

const CMF = global.window.CMF;
const failures = [];
let checks = 0;
function check(name, cond) {
  checks += 1;
  if (!cond) failures.push(name);
}

// Barcode validation.
check("8 digits ok", CMF.validBarcode("12345678") === true);
check("14 digits ok", CMF.validBarcode("12345678901234") === true);
check("7 digits rejected", CMF.validBarcode("1234567") === false);
check("15 digits rejected", CMF.validBarcode("123456789012345") === false);
check("letters rejected", CMF.validBarcode("1234abcd") === false);
check("whitespace trimmed", CMF.validBarcode(" 6901234567892 ") === true);
check("empty rejected", CMF.validBarcode("") === false);
check("null rejected", CMF.validBarcode(null) === false);

// Energy: kcal preferred, kJ converted.
check("kcal direct", CMF.offKcal({ "energy-kcal_100g": 250 }) === 250);
check("kcal rounded", CMF.offKcal({ "energy-kcal_100g": 250.4 }) === 250);
check("kj converted", CMF.offKcal({ energy_100g: 836.8 }) === 200);
check("kcal wins over kj", CMF.offKcal({ "energy-kcal_100g": 100, energy_100g: 836.8 }) === 100);
check("no energy null", CMF.offKcal({}) === null);
check("null nutriments", CMF.offKcal(null) === null);
check("string energy ignored", CMF.offKcal({ "energy-kcal_100g": "250" }) === null);

// Normalization.
const raw = {
  code: "6901234567892",
  product_name: "Oat Cookies",
  product_name_zh: "燕麦饼干",
  brands: "Brand A, Brand B, Brand C",
  nutriscore_grade: "B",
  image_front_url: "https://images.example/front.jpg",
  nutriments: {
    "energy-kcal_100g": 450,
    proteins_100g: 8.24,
    fat_100g: 20,
    carbohydrates_100g: 60.55,
  },
};
const p = CMF.normalizeOffProduct(raw);
check("zh name preferred", p.name === "燕麦饼干");
check("brands capped at 2", p.brands.length === 2 && p.brands[0] === "Brand A");
check("barcode kept", p.barcode === "6901234567892");
check("per100g kcal", p.per100g.kcal === 450);
check("protein rounded", p.per100g.protein === 8.2);
check("carbs rounded", p.per100g.carbs === 60.6);
check("nutriscore lowercased", p.nutriscore === "b");
check("image kept", p.image === raw.image_front_url);
check("product url", p.url === "https://world.openfoodfacts.org/product/6901234567892");

const bare = CMF.normalizeOffProduct({ code: "123", product_name: "Plain" });
check("missing nutriments null", bare.per100g === null);
check("missing nutriscore null", bare.nutriscore === null);
check("missing image null", bare.image === null);
const kjOnly = CMF.normalizeOffProduct({ code: "9", nutriments: { energy_100g: 418.4 } });
check("kj-only product has per100g", kjOnly.per100g && kjOnly.per100g.kcal === 100);
check("protein-only product kept", CMF.normalizeOffProduct({ code: "8", nutriments: { proteins_100g: 5 } }).per100g.protein === 5);
check("bad grade rejected", CMF.normalizeOffProduct({ code: "7", nutriscore_grade: "unknown" }).nutriscore === null);
check("generic name fallback", CMF.normalizeOffProduct({ code: "6", generic_name: "Generic" }).name === "Generic");
check("null raw null", CMF.normalizeOffProduct(null) === null);
check("no code url base", CMF.normalizeOffProduct({ product_name: "X" }).url === "https://world.openfoodfacts.org");

// URL builders.
const searchURL = CMF.offSearchURL("燕麦 饼干");
check("search host", searchURL.startsWith("https://world.openfoodfacts.org/cgi/search.pl?"));
check("search encodes", searchURL.includes(encodeURIComponent("燕麦 饼干")));
check("search trims", CMF.offSearchURL("  milk  ").includes("search_terms=milk"));
check("barcode url", CMF.offBarcodeURL("6901234567892").includes("/api/v2/product/6901234567892.json"));

(async () => {
  // Search with injected fetcher.
  let seenUrl = null;
  const products = await CMF.searchOffProducts("oat", {
    fetcher: async (u) => {
      seenUrl = u;
      return {
        ok: true,
        json: async () => ({
          products: [raw, { product_name: "" }, null],
        }),
      };
    },
  });
  check("search used url", seenUrl === CMF.offSearchURL("oat"));
  check("search normalized", products.length === 1 && products[0].name === "燕麦饼干");
  const empty = await CMF.searchOffProducts("   ", { fetcher: async () => { throw new Error("should not fetch"); } });
  check("blank query no fetch", empty.length === 0);
  const noProducts = await CMF.searchOffProducts("x", {
    fetcher: async () => ({ ok: true, json: async () => ({}) }),
  });
  check("missing products array", noProducts.length === 0);
  const httpErr = await CMF.searchOffProducts("x", {
    fetcher: async () => ({ ok: false, status: 500 }),
  }).catch((e) => e.message);
  check("search http error surfaces", String(httpErr).includes("500"));

  // Barcode lookup.
  let badCode = null;
  try {
    await CMF.lookupOffBarcode("abc", { fetcher: async () => { throw new Error("should not fetch"); } });
  } catch (e) {
    badCode = e.message;
  }
  check("invalid barcode throws", String(badCode).includes("8–14"));
  const found = await CMF.lookupOffBarcode("6901234567892", {
    fetcher: async (u) => {
      check("lookup used url", u === CMF.offBarcodeURL("6901234567892"));
      return { ok: true, json: async () => ({ status: 1, product: raw }) };
    },
  });
  check("lookup found", found && found.barcode === "6901234567892");
  const notFound = await CMF.lookupOffBarcode("6901234567892", {
    fetcher: async () => ({ ok: true, json: async () => ({ status: 0 }) }),
  });
  check("status 0 null", notFound === null);
  const noProduct = await CMF.lookupOffBarcode("6901234567892", {
    fetcher: async () => ({ ok: true, json: async () => ({ status: 1 }) }),
  });
  check("status 1 without product null", noProduct === null);

  // Recent searches: device-local, capped, deduped.
  check("recent key", CMF.OFF_RECENT_KEY === "cmf.offRecent");
  check("recent empty", CMF.offRecent().length === 0);
  CMF.offRemember("oat", "燕麦饼干");
  CMF.offRemember("milk", "牛奶");
  CMF.offRemember("oat", "燕麦饼干");
  const recent = CMF.offRecent();
  check("recent deduped", recent.length === 2 && recent[0].query === "oat");
  check("recent keeps name", recent[0].name === "燕麦饼干" && !!recent[0].at);
  for (let i = 0; i < 6; i++) CMF.offRemember("q" + i, "n" + i);
  check("recent capped at 5", CMF.offRecent().length === 5);
  CMF.offRemember("   ", "x");
  check("blank query ignored", CMF.offRecent()[0].query === "q5");
  mem.set(CMF.OFF_RECENT_KEY, "not json");
  check("junk storage tolerated", CMF.offRecent().length === 0);

  if (failures.length) {
    console.error("FOODFACTS TEST FAILURES:", failures);
    process.exit(1);
  }
  console.log(JSON.stringify({ ok: true, checks }));
})();