/* Meal planner: lunch + dinner for 1-4 weeks, deterministic pure logic, no DOM.
   Days are [{index, lunch:{recipeId,title}, dinner:{recipeId,title}}] where
   index is the day offset from startDate (0..27). Legacy single-meal weeks
   are upgraded by migrateWeek() without losing the lunches already picked. */
(function () {
  "use strict";

  const CMF = window.CMF;
  const DAYS = 7;
  const MEALS = ["lunch", "dinner"];
  const WEEKDAYS = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];
  const MAX_WEEKS = 4;

  CMF.WEEK_MEALS = MEALS.slice();
  CMF.WEEKDAY_LABELS = ["周一", "周二", "周三", "周四", "周五", "周六", "周日"];
  CMF.MAX_MENU_WEEKS = MAX_WEEKS;
  CMF.MENU_WEEK_OPTIONS = [1, 2, 3, 4];
  // Shared with sw.js: the calendar subscription endpoint lives in this cache.
  CMF.CALENDAR_CACHE = "cmf-calendar-v1";
  CMF.CALENDAR_PATH = "calendar.ics";

  function mulberry32(seed) {
    let a = seed >>> 0;
    return function () {
      a |= 0;
      a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function recipeAllergens(recipe) {
    if (recipe.allergens && recipe.allergens.length) return recipe.allergens;
    const found = new Set();
    (recipe.ingredients || []).forEach((i) => {
      CMF.allergensOf(i.canonical).forEach((a) => found.add(a));
    });
    return [...found];
  }

  function eligibleRecipes(recipes, prefs) {
    const blockedAllergens = new Set((prefs && prefs.allergens) || []);
    const tags = new Set((prefs && prefs.tags) || []);
    const diets = (prefs && prefs.diets) || [];
    const vegetarian = tags.has("素食");
    return recipes.filter((r) => {
      if (blockedAllergens.size) {
        const has = recipeAllergens(r).some((a) => blockedAllergens.has(a));
        if (has) return false;
      }
      if (vegetarian && !(r.tags || []).includes("素食")) return false;
      if (diets.length) {
        // Fail closed when the diet module is not loaded.
        if (typeof CMF.matchesDiets !== "function") return false;
        if (!CMF.matchesDiets(r, diets)) return false;
      }
      return true;
    });
  }

  function pickRecipe(pool, fridge, usedTitles, rng) {
    const fridgeSet = new Set(fridge);
    let best = null;
    let bestKey = null;
    pool.forEach((r) => {
      if (usedTitles.has(r.title)) return;
      const m = CMF.matchRecipe(r, fridgeSet);
      const tie = rng();
      const key = [m.missingCount, tie, r.id];
      if (bestKey === null || key[0] < bestKey[0] ||
          (key[0] === bestKey[0] && key[1] < bestKey[1])) {
        best = r;
        bestKey = key;
      }
    });
    return best;
  }

  function brief(recipe) {
    return recipe ? { recipeId: recipe.id, title: recipe.title } : null;
  }

  /* Flatten a menu (new or legacy shape) into meal records. */
  CMF.weekMeals = function (days) {
    const rows = [];
    (days || []).forEach((d, position) => {
      const index = Number.isInteger(d.index) ? d.index : position;
      MEALS.forEach((meal) => {
        if (d[meal] && d[meal].recipeId) {
          rows.push({ index, meal, recipeId: d[meal].recipeId, title: d[meal].title });
        }
      });
      // Legacy single-meal entry (or a day that only has a top-level recipe).
      if (!d.lunch && !d.dinner && d.recipeId) {
        rows.push({ index, meal: "lunch", recipeId: d.recipeId, title: d.title });
      }
    });
    return rows;
  };

  CMF.menuWeekCount = function (days) {
    const meals = CMF.weekMeals(days);
    if (!meals.length) return 0;
    return Math.ceil((Math.max(...meals.map((m) => m.index)) + 1) / DAYS);
  };

  /* Build one 7-day chunk starting at `startIndex`. `used` is shared across
     weeks so the planner avoids repeating dishes for as long as the eligible
     pool allows. */
  function buildChunk(startIndex, used, pool, fridge, rng) {
    const days = Array.from({ length: DAYS }, (_, i) => ({
      index: startIndex + i, lunch: null, dinner: null,
    }));
    outer: for (let i = 0; i < DAYS; i += 1) {
      for (const meal of MEALS) {
        const recipe = pickRecipe(pool, fridge, used, rng);
        if (!recipe) break outer;
        used.add(recipe.title);
        days[i][meal] = brief(recipe);
      }
    }
    // Never return a half-empty card; better 5 complete days when strict diet
    // filters shrink the candidate pool.
    return days.filter((d) => d.lunch && d.dinner);
  }

  function clampWeeks(weeks) {
    return Math.max(1, Math.min(MAX_WEEKS, Math.round(Number(weeks) || 1)));
  }

  /* Grow or shrink an existing menu without discarding hand-picked meals. */
  CMF.resizeMenu = function (days, weeks, recipes, fridge, prefs, seed) {
    const target = clampWeeks(weeks);
    const current = CMF.menuWeekCount(days);
    if (target <= current) return (days || []).filter((d) => d.index < target * DAYS);
    const rng = mulberry32(seed || 1);
    const pool = eligibleRecipes(recipes, prefs);
    let result = (days || []).slice();
    for (let w = current; w < target; w += 1) {
      const used = new Set(CMF.weekMeals(result).map((m) => m.title));
      let chunk = buildChunk(w * DAYS, used, pool, fridge || [], rng);
      if (chunk.length < DAYS) {
        // Pool exhausted (strict diets/allergens): allow repeats across weeks,
        // but keep every dish inside this week unique.
        chunk = buildChunk(w * DAYS, new Set(), pool, fridge || [], rng);
      }
      result = result.concat(chunk);
    }
    return result;
  };

  CMF.buildMenu = function (weeks, recipes, fridge, prefs, seed) {
    return CMF.resizeMenu([], weeks, recipes, fridge, prefs, seed);
  };

  CMF.buildWeek = function (recipes, fridge, prefs, seed) {
    return CMF.buildMenu(1, recipes, fridge, prefs, seed);
  };

  /* Upgrade a legacy week: keep the chosen dish as lunch, fill dinners. */
  CMF.migrateWeek = function (days, recipes, fridge, prefs, seed) {
    const migrated = (days || []).map((d, position) => {
      const index = Number.isInteger(d.index) ? d.index : position;
      if (d.lunch || d.dinner) {
        return { index, lunch: d.lunch || null, dinner: d.dinner || null };
      }
      return {
        index,
        lunch: d.recipeId ? { recipeId: d.recipeId, title: d.title } : null,
        dinner: null,
      };
    });
    return CMF.fillWeekMeals(migrated, recipes, fridge, prefs, seed);
  };

  /* Fill any missing meal without changing the ones already chosen. */
  CMF.fillWeekMeals = function (days, recipes, fridge, prefs, seed) {
    if (!recipes) return days;
    const rng = mulberry32(seed || 1);
    const pool = eligibleRecipes(recipes, prefs);
    const used = new Set(CMF.weekMeals(days).map((m) => m.title));
    return days.map((d) => {
      const next = { index: d.index, lunch: d.lunch || null, dinner: d.dinner || null };
      MEALS.forEach((meal) => {
        if (next[meal]) return;
        const recipe = pickRecipe(pool, fridge || [], used, rng);
        if (recipe) {
          next[meal] = brief(recipe);
          used.add(recipe.title);
        }
      });
      return next;
    });
  };

  CMF.isLegacyWeek = function (days) {
    return (days || []).some((d) => !d.lunch && !d.dinner && d.recipeId);
  };

  CMF.rerollMeal = function (days, index, meal, recipes, fridge, prefs, seed) {
    const rng = mulberry32(seed || (Date.now() & 0xffffffff));
    const pool = eligibleRecipes(recipes, prefs);
    const allMeals = CMF.weekMeals(days);
    // Exclude EVERY currently planned dish, including the one being replaced:
    // otherwise a pool that is exactly full would "reroll" into the same dish.
    const usedTitles = new Set(allMeals.map((m) => m.title));
    let recipe = pickRecipe(pool, fridge, usedTitles, rng);
    if (!recipe) {
      // Strict filters can leave fewer eligible dishes than there are meal
      // slots. Relax the whole-menu uniqueness, but still exclude the day's
      // two dishes (which includes the one being replaced) so a reroll always
      // changes something and never duplicates a dish on the same day.
      const sameDay = new Set(
        allMeals.filter((m) => m.index === index).map((m) => m.title)
      );
      recipe = pickRecipe(pool, fridge, sameDay, mulberry32((seed || 1) ^ 0x9e3779b9));
    }
    if (!recipe) return days;
    return days.map((d) =>
      d.index === index
        ? { index: d.index, lunch: d.lunch, dinner: d.dinner, [meal]: brief(recipe) }
        : d
    );
  };

  /* Backwards-compatible alias: rerollDay replaces that day's lunch. */
  CMF.rerollDay = function (days, index, recipes, fridge, prefs, seed) {
    return CMF.rerollMeal(days, index, "lunch", recipes, fridge, prefs, seed);
  };

  /* Cross-week shopping: which weeks need each missing ingredient. */
  CMF.weekShopping = function (days, recipes, fridge) {
    const byId = new Map(recipes.map((r) => [r.id, r]));
    const fridgeSet = new Set(fridge);
    const need = new Map();
    CMF.weekMeals(days).forEach((m) => {
      const r = byId.get(m.recipeId);
      if (!r) return;
      const match = CMF.matchRecipe(r, fridgeSet);
      const weekNo = Math.floor(m.index / DAYS);
      match.missing.forEach((c) => {
        if (!need.has(c)) need.set(c, { recipes: [], weeks: new Set() });
        const row = need.get(c);
        row.recipes.push(r.title);
        row.weeks.add(weekNo);
      });
    });
    return [...need.keys()].sort().map((c) => ({
      canonical: c,
      recipes: [...new Set(need.get(c).recipes)],
      weeks: [...need.get(c).weeks].sort((a, b) => a - b),
    }));
  };
  CMF.menuShopping = CMF.weekShopping;

  /* --- Shopping list split by week --------------------------------------- */

  const CATEGORY_ORDER = [
    "蔬菜", "肉蛋", "水产", "主食", "豆乳", "调料", "水果", "冷冻食品", "其他",
  ];
  CMF.SHOPPING_CATEGORIES = CATEGORY_ORDER.slice();

  function categoryRank(name) {
    const index = CATEGORY_ORDER.indexOf(name);
    return index < 0 ? CATEGORY_ORDER.length : index;
  }

  /* One group per week. An ingredient needed in two different weeks shows up
     in both (you buy it twice), which the old flat list could not express. */
  CMF.weeklyShopping = function (days, recipes, fridge) {
    const byId = new Map((recipes || []).map((r) => [r.id, r]));
    const fridgeSet = new Set(fridge || []);
    const weeks = Math.max(1, CMF.menuWeekCount(days) || 1);
    const buckets = Array.from({ length: weeks }, () => new Map());
    CMF.weekMeals(days).forEach((m) => {
      const recipe = byId.get(m.recipeId);
      if (!recipe) return;
      const week = Math.floor(m.index / DAYS);
      if (!buckets[week]) return;
      const bucket = buckets[week];
      CMF.matchRecipe(recipe, fridgeSet).missing.forEach((canonical) => {
        if (!bucket.has(canonical)) {
          bucket.set(canonical, {
            canonical,
            category: typeof CMF.categoryOf === "function"
              ? CMF.categoryOf(canonical) : "其他",
            recipes: [],
            meals: [],
          });
        }
        const row = bucket.get(canonical);
        if (!row.recipes.includes(recipe.title)) row.recipes.push(recipe.title);
        row.meals.push(m.meal);
      });
    });
    return buckets.map((bucket, week) => {
      const items = [...bucket.values()].sort((a, b) => {
        const rank = categoryRank(a.category) - categoryRank(b.category);
        return rank || a.canonical.localeCompare(b.canonical, "zh-Hans-CN");
      });
      return { week, label: "第 " + (week + 1) + " 周", items, total: items.length };
    });
  };

  function csvCell(value) {
    const text = String(value == null ? "" : value);
    return /[",\r\n]/.test(text) ? '"' + text.replace(/"/g, '""') + '"' : text;
  }

  /* BOM + CRLF so Excel on Windows opens Chinese text correctly. */
  CMF.shoppingToCSV = function (groups, opts) {
    const options = opts || {};
    const checked = new Set(options.checked || []);
    const lines = ["周次,分类,食材,用于菜谱数,菜谱,已买"];
    (groups || []).forEach((group) => {
      group.items.forEach((item) => {
        const key = group.week + ":" + item.canonical;
        lines.push([
          group.label, item.category, item.canonical,
          item.recipes.length, item.recipes.join("、"),
          checked.has(key) ? "是" : "否",
        ].map(csvCell).join(","));
      });
    });
    return "\ufeff" + lines.join("\r\n") + "\r\n";
  };

  CMF.shoppingToText = function (groups, opts) {
    const options = opts || {};
    const checked = new Set(options.checked || []);
    const list = groups || [];
    const total = list.reduce((sum, g) => sum + g.total, 0);
    const lines = [
      "CookMyFridge 采购清单（按周拆分）",
      `共 ${list.length} 周 · ${total} 项`,
    ];
    list.forEach((group) => {
      const label = (options.weekLabels && options.weekLabels[group.week]) || group.label;
      lines.push("", `【${label} · ${group.total} 项】`);
      let category = "";
      group.items.forEach((item) => {
        if (item.category !== category) {
          category = item.category;
          lines.push("  " + category + "：");
        }
        const done = checked.has(group.week + ":" + item.canonical);
        lines.push(
          `  - [${done ? "x" : " "}] ${item.canonical}` +
          `（用于 ${item.recipes.length} 道菜：${item.recipes.join("、")}）`
        );
      });
      if (!group.total) lines.push("  （本周无需额外采购）");
    });
    lines.push("", "已按现有冰箱自动扣除，常备调料不计入；清单仅供备菜参考。");
    return lines.join("\n") + "\n";
  };

  /* Per-person daily totals (one serving of each meal). */
  CMF.weekDayNutrition = function (days, index, recipes) {
    const byId = new Map(recipes.map((r) => [r.id, r]));
    const totals = { kcal: 0, protein: 0, fat: 0, carbs: 0, meals: 0 };
    if (typeof CMF.estimateNutrition !== "function") return totals;
    CMF.weekMeals(days)
      .filter((m) => m.index === index)
      .forEach((m) => {
        const recipe = byId.get(m.recipeId);
        const est = recipe ? CMF.estimateNutrition(recipe) : null;
        if (!est) return;
        totals.kcal += est.perServing.kcal;
        totals.protein += est.perServing.protein;
        totals.fat += est.perServing.fat;
        totals.carbs += est.perServing.carbs;
        totals.meals += 1;
      });
    totals.protein = Math.round(totals.protein * 10) / 10;
    totals.fat = Math.round(totals.fat * 10) / 10;
    totals.carbs = Math.round(totals.carbs * 10) / 10;
    return totals;
  };

  /* --- Balance-driven optimisation --- */

  function dayScoreFrom(day, estimates) {
    if (typeof CMF.scoreBalance !== "function") return 0;
    const totals = { kcal: 0, protein: 0, fat: 0, carbs: 0, meals: 0 };
    MEALS.forEach((meal) => {
      const item = day[meal];
      const est = item && estimates.get(item.recipeId);
      if (!est) return;
      totals.kcal += est.perServing.kcal;
      totals.protein += est.perServing.protein;
      totals.fat += est.perServing.fat;
      totals.carbs += est.perServing.carbs;
      totals.meals += 1;
    });
    return totals.meals ? CMF.scoreBalance(totals, { meals: totals.meals }).score : 0;
  }

  CMF.optimizeMenu = function (days, recipes, fridge, prefs, seed, opts) {
    const result = (days || []).map((d) => ({
      index: d.index, lunch: d.lunch || null, dinner: d.dinner || null,
    }));
    if (typeof CMF.scoreBalance !== "function" || !result.length) {
      return { days: result, before: 0, after: 0, changed: 0 };
    }
    const options = opts || {};
    // Deliberately conservative: only the weakest days, at most a third of the
    // menu. Replacing every single dish would look like score gaming and throw
    // away everything the user hand-picked.
    const target = Number.isFinite(options.target) ? options.target : 70;
    const maxDays = Number.isFinite(options.maxDays)
      ? options.maxDays : Math.ceil(result.length / 3);
    const pool = eligibleRecipes(recipes, prefs);
    const estimates = new Map();
    pool.forEach((r) => {
      const est = typeof CMF.estimateNutrition === "function"
        ? CMF.estimateNutrition(r) : null;
      if (est) estimates.set(r.id, est);
    });
    const average = (menu) => Math.round(
      menu.reduce((sum, d) => sum + dayScoreFrom(d, estimates), 0) / menu.length
    );
    const before = average(result);
    const used = new Set(CMF.weekMeals(result).map((m) => m.title));
    const order = result
      .map((d) => ({ index: d.index, score: dayScoreFrom(d, estimates) }))
      .sort((a, b) => a.score - b.score);
    let changed = 0;

    order.forEach(({ index, score }) => {
      if (changed >= maxDays || score >= target) return;
      const pos = result.findIndex((d) => d.index === index);
      const currentScore = dayScoreFrom(result[pos], estimates);
      let best = null;
      let bestScore = currentScore;
      pool.forEach((r) => {
        if (used.has(r.title)) return;
        MEALS.forEach((meal) => {
          const trial = { ...result[pos], [meal]: brief(r) };
          const score = dayScoreFrom(trial, estimates);
          if (score > bestScore) {
            bestScore = score;
            best = { meal, recipe: r };
          }
        });
      });
      if (!best) return;
      const replaced = result[pos][best.meal];
      if (replaced) used.delete(replaced.title);
      result[pos] = { ...result[pos], [best.meal]: brief(best.recipe) };
      used.add(best.recipe.title);
      changed += 1;
    });

    return { days: result, before, after: average(result), changed, seed: seed || 1 };
  };

  /* --- Calendar export --- */

  function pad(n) {
    return String(n).padStart(2, "0");
  }

  function dateOnly(date) {
    return date.getFullYear() + pad(date.getMonth() + 1) + pad(date.getDate());
  }

  function addDays(date, count) {
    const d = new Date(date.getTime());
    d.setDate(d.getDate() + count);
    return d;
  }

  function atLocalHour(date, hour, tzOffset) {
    // The planner is authored for Asia/Shanghai (UTC+8, no DST). Lunch/dinner
    // are converted to UTC so calendar clients show the intended local time.
    const y = date.getFullYear();
    const m = date.getMonth();
    const d = date.getDate();
    const utc = new Date(Date.UTC(y, m, d, hour - tzOffset, 0, 0));
    return dateOnly(utc) + "T" + pad(utc.getUTCHours()) + pad(utc.getUTCMinutes()) + "00Z";
  }

  function icsEscape(value) {
    return String(value == null ? "" : value)
      .replace(/\\/g, "\\\\")
      .replace(/;/g, "\\;")
      .replace(/,/g, "\\,")
      .replace(/\r?\n/g, "\\n");
  }

  CMF.nextMonday = function (from) {
    const d = from ? new Date(from.getTime ? from.getTime() : from) : new Date();
    d.setHours(0, 0, 0, 0);
    const delta = (8 - d.getDay()) % 7; // Monday -> 0, Sunday -> 1
    return addDays(d, delta);
  };

  CMF.weekStartDate = function (startDate) {
    if (!startDate) return CMF.nextMonday();
    const d = typeof startDate === "string"
      ? new Date(startDate + "T00:00:00")
      : new Date(startDate.getTime ? startDate.getTime() : startDate);
    d.setHours(0, 0, 0, 0);
    return d;
  };

  CMF.weekToICS = function (days, recipes, startDate, opts) {
    const options = opts || {};
    const start = CMF.weekStartDate(options.startDate || startDate);
    const now = options.now ? new Date(options.now) : new Date();
    const tzOffset = Number.isFinite(options.tzOffset) ? options.tzOffset : 8;
    const byId = new Map(recipes.map((r) => [r.id, r]));
    const weeks = CMF.menuWeekCount(days) || 1;
    const stamp =
      now.getUTCFullYear() + pad(now.getUTCMonth() + 1) + pad(now.getUTCDate()) +
      "T" + pad(now.getUTCHours()) + pad(now.getUTCMinutes()) + pad(now.getUTCSeconds()) + "Z";
    const lines = [
      "BEGIN:VCALENDAR",
      "VERSION:2.0",
      "PRODID:-//CookMyFridge//Meal Plan//ZH",
      "CALSCALE:GREGORIAN",
      "METHOD:PUBLISH",
      "X-WR-CALNAME:CookMyFridge " + (weeks > 1 ? weeks + " 周" : "一周") + "菜单",
      "X-WR-CALDESC:午餐 12:00 · 晚餐 18:00 · 数据由本地菜单生成",
      "X-WR-TIMEZONE:Asia/Shanghai",
    ];
    CMF.weekMeals(days).forEach((m) => {
      const date = addDays(start, m.index);
      const hour = m.meal === "lunch" ? 12 : 18;
      const recipe = byId.get(m.recipeId);
      const label = m.meal === "lunch" ? "午餐" : "晚餐";
      const ingredients = recipe
        ? recipe.ingredients.filter((i) => !i.optional).map((i) => i.canonical).join("、")
        : "";
      const est = recipe && typeof CMF.estimateNutrition === "function"
        ? CMF.estimateNutrition(recipe)
        : null;
      const description = [
        "CookMyFridge · 第 " + (Math.floor(m.index / DAYS) + 1) + " 周 · " + label + " · " + m.title,
        ingredients ? "食材：" + ingredients : "",
        est ? "每份约 " + est.perServing.kcal + " kcal（估算）" : "",
        "菜谱：recipe.html?id=" + m.recipeId,
        "别点外卖，让冰箱开饭。",
      ].filter(Boolean).join("\n");
      lines.push(
        "BEGIN:VEVENT",
        "UID:cmf-" + dateOnly(date) + "-" + m.meal + "-" + m.recipeId + "@cookmyfridge",
        "DTSTAMP:" + stamp,
        "DTSTART:" + atLocalHour(date, hour, tzOffset),
        "DTEND:" + atLocalHour(date, hour + 1, tzOffset),
        "SUMMARY:" + icsEscape("🍳 " + label + " · " + m.title),
        "DESCRIPTION:" + icsEscape(description),
        "LOCATION:" + icsEscape("我的厨房"),
        "END:VEVENT"
      );
    });
    lines.push("END:VCALENDAR");
    return lines.join("\r\n") + "\r\n";
  };
  CMF.menuToICS = CMF.weekToICS;

  CMF.weekToText = function (days, startDate) {
    const start = CMF.weekStartDate(startDate);
    const list = days || [];
    const weeks = CMF.menuWeekCount(list) || 1;
    const end = addDays(start, weeks * DAYS - 1);
    const fmt = (d) => (d.getMonth() + 1) + "/" + d.getDate();
    const header =
      "CookMyFridge " + (weeks > 1 ? weeks + " 周" : "一周") + "菜单（" +
      fmt(start) + " – " + fmt(end) + "）\n";
    const dayLine = (d) => {
      const label = CMF.WEEKDAY_LABELS[d.index % DAYS] || WEEKDAYS[addDays(start, d.index).getDay()];
      return (
        "\n" + label + "（" + fmt(addDays(start, d.index)) + "）\n" +
        "  午餐：" + (d.lunch ? d.lunch.title : "待安排") + "\n" +
        "  晚餐：" + (d.dinner ? d.dinner.title : "待安排")
      );
    };
    let body = "";
    for (let w = 0; w < weeks; w += 1) {
      const chunk = list.filter((d) => Math.floor(d.index / DAYS) === w);
      if (!chunk.length) continue;
      if (weeks > 1) {
        body += "\n第 " + (w + 1) + " 周（" + fmt(addDays(start, w * DAYS)) +
          " – " + fmt(addDays(start, w * DAYS + DAYS - 1)) + "）\n";
      }
      body += chunk.map(dayLine).join("");
    }
    return header + body + "\n\n别点外卖，让冰箱开饭。\n";
  };
  CMF.menuToText = CMF.weekToText;
})();
