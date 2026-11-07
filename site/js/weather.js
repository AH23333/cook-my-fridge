/* Weather-aware meal ideas. Online source: Open-Meteo (free, no API key,
   CORS-enabled). Everything degrades to a manual weather picker offline;
   suggestions always come from the shipped recipe dataset. */
(function () {
  "use strict";

  const CMF = (window.CMF = window.CMF || {});
  const CACHE_KEY = "cmf.weatherCache"; // device-local, deliberately outside sync KEYS
  const CACHE_TTL_MS = 30 * 60 * 1000;

  CMF.WEATHER_CITIES = [
    { key: "beijing", label: "北京", lat: 39.9, lon: 116.4 },
    { key: "shanghai", label: "上海", lat: 31.23, lon: 121.47 },
    { key: "guangzhou", label: "广州", lat: 23.13, lon: 113.26 },
    { key: "shenzhen", label: "深圳", lat: 22.54, lon: 114.06 },
    { key: "chengdu", label: "成都", lat: 30.57, lon: 104.07 },
    { key: "hangzhou", label: "杭州", lat: 30.27, lon: 120.16 },
    { key: "wuhan", label: "武汉", lat: 30.59, lon: 114.31 },
    { key: "xian", label: "西安", lat: 34.34, lon: 108.94 },
    { key: "chongqing", label: "重庆", lat: 29.56, lon: 106.55 },
    { key: "shenyang", label: "沈阳", lat: 41.8, lon: 123.43 },
  ];

  /* WMO weather interpretation codes -> precipitation family first,
     then temperature band. Pure and deterministic. */
  CMF.classifyWeather = function (tempC, code) {
    const t = Number(tempC);
    const c = Number(code);
    if ([71, 73, 75, 77, 85, 86].includes(c)) {
      return { kind: "snow", label: "下雪", emoji: "❄️", advice: "下雪天，炖一锅热乎的最舒服", methods: ["炖", "煮", "蒸"], tags: ["下饭"] };
    }
    if ([95, 96, 99].includes(c)) {
      return { kind: "thunder", label: "雷雨", emoji: "⛈️", advice: "雷雨天不出门，电饭煲焖饭最省心", methods: ["电饭煲", "煮", "炖"], tags: ["一人食", "下饭"] };
    }
    if ((c >= 51 && c <= 67) || (c >= 80 && c <= 82) || (c >= 91 && c <= 92)) {
      return { kind: "rain", label: "下雨", emoji: "🌧️", advice: "下雨天，来点暖和的一锅出", methods: ["煮", "炖", "电饭煲"], tags: ["下饭", "一人食"] };
    }
    if (c === 45 || c === 48) {
      return { kind: "fog", label: "雾", emoji: "🌫️", advice: "雾天湿气重，煮点汤水暖暖胃", methods: ["煮", "蒸"], tags: [] };
    }
    if (t <= 5) {
      return { kind: "cold", label: "寒冷", emoji: "🥶", advice: "天冷适合炖煮热乎菜，多补充热量", methods: ["炖", "煮", "蒸"], tags: ["下饭"] };
    }
    if (t <= 15) {
      return { kind: "cool", label: "凉爽", emoji: "🍃", advice: "天气微凉，炒菜煮汤两相宜", methods: ["炒", "煮"], tags: ["快手"] };
    }
    if (t <= 26) {
      return { kind: "mild", label: "舒适", emoji: "😊", advice: "天气正好，想吃什么就做什么", methods: [], tags: [] };
    }
    return { kind: "hot", label: "炎热", emoji: "🥵", advice: "天热没胃口？试试凉拌和免开火", methods: ["凉拌", "免开火", "蒸"], tags: ["低卡", "夏日饮品"] };
  };

  /* Score real recipes against the weather preference. Mild weather has no
     preference: fall back to quickest dishes so the card is never empty. */
  CMF.weatherSuggestions = function (recipes, weather, limit) {
    const n = limit || 3;
    if (!weather) return [];
    const methods = new Set(weather.methods || []);
    const tags = new Set(weather.tags || []);
    const rows = [];
    for (const r of recipes) {
      let score = 0;
      const why = [];
      for (const m of r.methods) {
        if (methods.has(m)) {
          score += 2;
          why.push(m);
        }
      }
      for (const t of r.tags) {
        if (tags.has(t)) {
          score += 1;
          why.push(t);
        }
      }
      if (score > 0) rows.push({ recipe: r, score, reason: why.slice(0, 3).join("·") });
    }
    if (!rows.length) {
      return [...recipes]
        .sort((a, b) => a.time_minutes - b.time_minutes || (a.id < b.id ? -1 : 1))
        .slice(0, n)
        .map((r) => ({ recipe: r, score: 0, reason: "快手省事" }));
    }
    rows.sort(
      (a, b) =>
        b.score - a.score ||
        a.recipe.time_minutes - b.recipe.time_minutes ||
        (a.recipe.id < b.recipe.id ? -1 : 1)
    );
    return rows.slice(0, n);
  };

  CMF.weatherURL = function (lat, lon) {
    return (
      "https://api.open-meteo.com/v1/forecast?latitude=" +
      encodeURIComponent(lat) +
      "&longitude=" +
      encodeURIComponent(lon) +
      "&current=temperature_2m,weather_code&timezone=auto"
    );
  };

  /* fetcher is injectable for headless tests; browsers use fetch + timeout. */
  CMF.fetchCurrentWeather = async function (coords, opts) {
    const options = opts || {};
    const fetcher = options.fetcher || ((url, init) => fetch(url, init));
    const timeout = options.timeoutMs || 8000;
    const controller = typeof AbortController !== "undefined" ? new AbortController() : null;
    const timer = controller ? setTimeout(() => controller.abort(), timeout) : null;
    try {
      const resp = await fetcher(CMF.weatherURL(coords.lat, coords.lon), {
        signal: controller ? controller.signal : undefined,
      });
      if (!resp.ok) throw new Error("天气服务返回 " + resp.status);
      const payload = await resp.json();
      const current = payload && payload.current;
      if (!current || typeof current.temperature_2m !== "number") {
        throw new Error("天气数据格式异常");
      }
      return {
        tempC: current.temperature_2m,
        code: current.weather_code,
        at: new Date().toISOString(),
      };
    } finally {
      if (timer) clearTimeout(timer);
    }
  };

  CMF.readWeatherCache = function () {
    try {
      const raw = localStorage.getItem(CACHE_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch (e) {
      return null;
    }
  };

  CMF.writeWeatherCache = function (value) {
    try {
      localStorage.setItem(CACHE_KEY, JSON.stringify(value));
      return true;
    } catch (e) {
      return false;
    }
  };

  CMF.weatherCacheFresh = function (cache, now) {
    if (!cache || !cache.at || typeof cache.tempC !== "number") return false;
    const base = now ? new Date(now).getTime() : Date.now();
    return base - new Date(cache.at).getTime() < CACHE_TTL_MS;
  };

  CMF.WEATHER_CACHE_KEY = CACHE_KEY;
  CMF.WEATHER_CACHE_TTL_MS = CACHE_TTL_MS;
})();