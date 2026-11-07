/* Packaged-food nutrition lookup against Open Food Facts (free, no key,
   ODbL data). Online-only by design: the UI says so and offline visitors
   get a clear notice instead of a broken card. Results are never merged
   into the recipe catalog. */
(function () {
  "use strict";

  const CMF = (window.CMF = window.CMF || {});
  const RECENT_KEY = "cmf.offRecent"; // device-local, outside sync KEYS
  const OFF_BASE = "https://world.openfoodfacts.org";

  CMF.offSearchURL = function (query) {
    return (
      OFF_BASE +
      "/cgi/search.pl?json=1&search_simple=1&action=process&page_size=8&fields=product_name,product_name_zh,brands,nutriments,nutriscore_grade,code,image_front_url&search_terms=" +
      encodeURIComponent(String(query || "").trim())
    );
  };

  CMF.offBarcodeURL = function (code) {
    return (
      OFF_BASE +
      "/api/v2/product/" +
      encodeURIComponent(code) +
      ".json?fields=product_name,product_name_zh,brands,nutriments,nutriscore_grade,code,image_front_url"
    );
  };

  CMF.validBarcode = function (code) {
    return /^\d{8,14}$/.test(String(code || "").trim());
  };

  /* OFF stores energy in kcal or kJ per 100 g; prefer kcal, convert kJ. */
  CMF.offKcal = function (nutriments) {
    const n = nutriments || {};
    if (typeof n["energy-kcal_100g"] === "number") return Math.round(n["energy-kcal_100g"]);
    if (typeof n["energy_100g"] === "number") return Math.round(n["energy_100g"] / 4.184);
    return null;
  };

  CMF.normalizeOffProduct = function (raw) {
    if (!raw || typeof raw !== "object") return null;
    const n = raw.nutriments || {};
    const kcal = CMF.offKcal(n);
    const num = (v) => (typeof v === "number" ? Math.round(v * 10) / 10 : null);
    const per100g =
      kcal == null && num(n.proteins_100g) == null
        ? null
        : {
            kcal,
            protein: num(n.proteins_100g),
            fat: num(n.fat_100g),
            carbs: num(n.carbohydrates_100g),
          };
    const grade = String(raw.nutriscore_grade || "").toLowerCase();
    const code = String(raw.code || "");
    return {
      name: String(raw.product_name_zh || raw.product_name || raw.generic_name || code || " unnamed").trim(),
      brands: String(raw.brands || "").split(",").map((s) => s.trim()).filter(Boolean).slice(0, 2),
      barcode: code,
      per100g,
      nutriscore: ["a", "b", "c", "d", "e"].includes(grade) ? grade : null,
      image: raw.image_front_url || null,
      url: code ? OFF_BASE + "/product/" + encodeURIComponent(code) : OFF_BASE,
    };
  };

  async function fetchJSON(url, opts) {
    const options = opts || {};
    const fetcher = options.fetcher || ((u, init) => fetch(u, init));
    const timeout = options.timeoutMs || 8000;
    const controller = typeof AbortController !== "undefined" ? new AbortController() : null;
    const timer = controller ? setTimeout(() => controller.abort(), timeout) : null;
    try {
      const resp = await fetcher(url, { signal: controller ? controller.signal : undefined });
      if (!resp.ok) throw new Error("Open Food Facts 返回 " + resp.status);
      return await resp.json();
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  CMF.searchOffProducts = async function (query, opts) {
    const text = String(query || "").trim();
    if (!text) return [];
    const payload = await fetchJSON(CMF.offSearchURL(text), opts);
    const products = Array.isArray(payload && payload.products) ? payload.products : [];
    return products.map(CMF.normalizeOffProduct).filter((p) => p && p.name && p.name !== "unnamed");
  };

  CMF.lookupOffBarcode = async function (code, opts) {
    const clean = String(code || "").trim();
    if (!CMF.validBarcode(clean)) throw new Error("条码应为 8–14 位数字");
    const payload = await fetchJSON(CMF.offBarcodeURL(clean), opts);
    if (!payload || payload.status !== 1 || !payload.product) return null;
    return CMF.normalizeOffProduct(payload.product);
  };

  CMF.offRecent = function () {
    try {
      const raw = localStorage.getItem(RECENT_KEY);
      const list = raw ? JSON.parse(raw) : [];
      return Array.isArray(list) ? list : [];
    } catch (e) {
      return [];
    }
  };

  CMF.offRemember = function (query, name) {
    const text = String(query || "").trim();
    if (!text) return;
    const list = CMF.offRecent().filter((r) => r.query !== text);
    list.unshift({ query: text, name: String(name || ""), at: new Date().toISOString() });
    try {
      localStorage.setItem(RECENT_KEY, JSON.stringify(list.slice(0, 5)));
    } catch (e) {
      /* storage full or blocked; lookup still works */
    }
  };

  CMF.OFF_RECENT_KEY = RECENT_KEY;
})();