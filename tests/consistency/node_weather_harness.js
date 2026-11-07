/* Headless test for weather.js (Open-Meteo glue + suggestion scoring).
   Usage: node node_weather_harness.js [project_root] */
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

load("web/js/weather.js");

const CMF = global.window.CMF;
const recipes = JSON.parse(fs.readFileSync(path.join(base, "site/data/recipes.json"), "utf8"));

const failures = [];
let checks = 0;
function check(name, cond) {
  checks += 1;
  if (!cond) failures.push(name);
}

// Classification: precipitation family beats temperature.
check("snow code", CMF.classifyWeather(20, 73).kind === "snow");
check("thunder code", CMF.classifyWeather(30, 95).kind === "thunder");
check("rain code", CMF.classifyWeather(28, 63).kind === "rain");
check("showers", CMF.classifyWeather(22, 80).kind === "rain");
check("fog", CMF.classifyWeather(10, 45).kind === "fog");
check("cold band", CMF.classifyWeather(5, 0).kind === "cold");
check("cool band", CMF.classifyWeather(15, 1).kind === "cool");
check("mild band", CMF.classifyWeather(26, 2).kind === "mild");
check("hot band", CMF.classifyWeather(26.5, 0).kind === "hot");
check("clear sky code 3", CMF.classifyWeather(33, 3).kind === "hot");
check("advice present", !!CMF.classifyWeather(0, 71).advice);

// Suggestions on the real dataset.
const hot = CMF.classifyWeather(33, 0);
const hotPicks = CMF.weatherSuggestions(recipes, hot, 3);
check("hot picks count", hotPicks.length === 3);
check("hot picks scored", hotPicks.every((p) => p.score > 0 && p.reason));
check("hot prefers cold methods", hotPicks.some((p) => p.recipe.methods.some((m) => ["凉拌", "免开火", "蒸"].includes(m))));
const cold = CMF.classifyWeather(-2, 71);
const coldPicks = CMF.weatherSuggestions(recipes, cold, 3);
check("cold prefers stew", coldPicks.some((p) => p.recipe.methods.some((m) => ["炖", "煮", "蒸"].includes(m))));
check("sorted by score", coldPicks[0].score >= coldPicks[1].score);
check("deterministic", JSON.stringify(CMF.weatherSuggestions(recipes, cold, 3)) === JSON.stringify(coldPicks));
const mild = CMF.classifyWeather(22, 0);
const mildPicks = CMF.weatherSuggestions(recipes, mild, 3);
check("mild fallback non-empty", mildPicks.length === 3 && mildPicks.every((p) => p.reason === "快手省事"));
check("mild fallback quickest", mildPicks[0].recipe.time_minutes <= mildPicks[2].recipe.time_minutes);
check("null weather empty", CMF.weatherSuggestions(recipes, null, 3).length === 0);
check("limit 1", CMF.weatherSuggestions(recipes, hot, 1).length === 1);

// URL + fetch with injected fetcher.
const url = CMF.weatherURL(39.9, 116.4);
check("open-meteo host", url.startsWith("https://api.open-meteo.com/v1/forecast?"));
check("url params", url.includes("latitude=39.9") && url.includes("current=temperature_2m,weather_code"));

(async () => {
  let seenUrl = null;
  const fakeFetcher = async (u) => {
    seenUrl = u;
    return { ok: true, json: async () => ({ current: { temperature_2m: 3.2, weather_code: 3 } }) };
  };
  const got = await CMF.fetchCurrentWeather({ lat: 39.9, lon: 116.4 }, { fetcher: fakeFetcher });
  check("fetch used url", seenUrl === url);
  check("fetch parsed temp", got.tempC === 3.2 && got.code === 3);
  check("fetch timestamp", !!got.at);

  const badStatus = await CMF.fetchCurrentWeather(
    { lat: 1, lon: 1 },
    { fetcher: async () => ({ ok: false, status: 503 }) }
  ).catch((e) => e.message);
  check("http error surfaces", String(badStatus).includes("503"));

  const badShape = await CMF.fetchCurrentWeather(
    { lat: 1, lon: 1 },
    { fetcher: async () => ({ ok: true, json: async () => ({}) }) }
  ).catch((e) => e.message);
  check("bad shape surfaces", String(badShape).includes("格式"));

  // Cache TTL.
  const now = new Date("2026-11-07T12:00:00Z");
  CMF.writeWeatherCache({ tempC: 10, code: 0, at: now.toISOString(), city: "北京" });
  const cache = CMF.readWeatherCache();
  check("cache round trip", cache.city === "北京");
  check("fresh cache", CMF.weatherCacheFresh(cache, now));
  check("stale cache", !CMF.weatherCacheFresh(cache, new Date(now.getTime() + 31 * 60 * 1000)));
  check("junk cache", !CMF.weatherCacheFresh({}, now));
  check("cache outside sync keys", CMF.WEATHER_CACHE_KEY === "cmf.weatherCache");
  check("cities shipped", CMF.WEATHER_CITIES.length >= 8 && CMF.WEATHER_CITIES.every((c) => c.lat && c.lon));

  if (failures.length) {
    console.error("WEATHER TEST FAILURES:", failures);
    process.exit(1);
  }
  console.log(JSON.stringify({ ok: true, checks }));
})();