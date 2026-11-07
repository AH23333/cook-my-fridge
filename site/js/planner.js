/* Weekly meal planner: lunch + dinner, deterministic pure logic, no DOM.
   Days are [{index, lunch:{recipeId,title}, dinner:{recipeId,title}}].
   Legacy single-meal weeks are upgraded by migrateWeek() without losing the
   lunches the user already hand-picked. */
(function () {
  "use strict";

  const CMF = window.CMF;
  const DAYS = 7;
  const MEALS = ["lunch", "dinner"];
  const WEEKDAYS = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];

  CMF.WEEK_MEALS = MEALS.slice();
  CMF.WEEKDAY_LABELS = ["周一", "周二", "周三", "周四", "周五", "周六", "周日"];

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

  /* Flatten a week (new or legacy shape) into meal records. */
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

  CMF.buildWeek = function (recipes, fridge, prefs, seed) {
    const rng = mulberry32(seed || 1);
    const pool = eligibleRecipes(recipes, prefs);
    const usedTitles = new Set();
    const days = Array.from({ length: DAYS }, (_, index) => ({
      index, lunch: null, dinner: null,
    }));
    outer: for (let i = 0; i < DAYS; i += 1) {
      for (const meal of MEALS) {
        const recipe = pickRecipe(pool, fridge, usedTitles, rng);
        if (!recipe) break outer;
        usedTitles.add(recipe.title);
        days[i][meal] = brief(recipe);
      }
    }
    // Never return a day with a missing meal; better 5 complete days than a
    // half-empty card when strict diet filters shrink the candidate pool.
    return days.filter((d) => d.lunch && d.dinner);
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
      // Strict diet/allergen filters can leave fewer eligible dishes than
      // there are meal slots. A reroll must still do something: relax the
      // whole-week uniqueness constraint, but never repeat a dish on the
      // same day or keep the one being replaced.
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

  CMF.weekShopping = function (days, recipes, fridge) {
    const byId = new Map(recipes.map((r) => [r.id, r]));
    const fridgeSet = new Set(fridge);
    const need = new Map();
    CMF.weekMeals(days).forEach((m) => {
      const r = byId.get(m.recipeId);
      if (!r) return;
      const match = CMF.matchRecipe(r, fridgeSet);
      match.missing.forEach((c) => {
        if (!need.has(c)) need.set(c, []);
        need.get(c).push(r.title);
      });
    });
    return [...need.keys()].sort().map((c) => ({
      canonical: c,
      recipes: [...new Set(need.get(c))],
    }));
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
    const stamp =
      now.getUTCFullYear() + pad(now.getUTCMonth() + 1) + pad(now.getUTCDate()) +
      "T" + pad(now.getUTCHours()) + pad(now.getUTCMinutes()) + pad(now.getUTCSeconds()) + "Z";
    const lines = [
      "BEGIN:VCALENDAR",
      "VERSION:2.0",
      "PRODID:-//CookMyFridge//Weekly Meal Plan//ZH",
      "CALSCALE:GREGORIAN",
      "METHOD:PUBLISH",
      "X-WR-CALNAME:CookMyFridge 一周菜单",
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
        "CookMyFridge · " + label + " · " + m.title,
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

  CMF.weekToText = function (days, startDate) {
    const start = CMF.weekStartDate(startDate);
    const end = addDays(start, 6);
    const header =
      "CookMyFridge 一周菜单（" + (start.getMonth() + 1) + "/" + start.getDate() +
      " – " + (end.getMonth() + 1) + "/" + end.getDate() + "）\n";
    const body = (days || [])
      .map((d) => {
        const label = CMF.WEEKDAY_LABELS[d.index] || WEEKDAYS[addDays(start, d.index).getDay()];
        return (
          "\n" + label + "\n" +
          "  午餐：" + (d.lunch ? d.lunch.title : "待安排") + "\n" +
          "  晚餐：" + (d.dinner ? d.dinner.title : "待安排")
        );
      })
      .join("");
    return header + body + "\n\n别点外卖，让冰箱开饭。\n";
  };
})();
