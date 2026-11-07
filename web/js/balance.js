/* Nutrition balance score: a transparent, explainable 0-100 heuristic.
   Pure logic only - no DOM, no data fetching. Targets are the adult AMDR
   ranges (carbohydrate 50-65%, fat 20-30%, protein 10-20% of energy).
   This is a meal-composition hint, NOT clinical dietary advice. */
(function () {
  "use strict";

  const CMF = window.CMF;

  const TARGETS = {
    protein: [10, 20],
    fat: [20, 30],
    carbs: [50, 65],
    proteinDensity: 4.0, // g protein per 100 kcal
    kcalPerMeal: [180, 800], // per person, one serving of one dish
  };

  const COMPANIONS = {
    protein: [
      ["鸡蛋", "补优质蛋白"],
      ["豆腐", "补植物蛋白"],
      ["鸡胸肉", "补瘦肉蛋白"],
      ["虾仁", "补低脂蛋白"],
    ],
    carbs: [
      ["米饭", "补主食碳水"],
      ["面条", "补主食碳水"],
      ["红薯", "补优质碳水"],
      ["玉米", "补粗粮碳水"],
    ],
    veggie: [
      ["西兰花", "补膳食纤维"],
      ["菠菜", "补绿叶蔬菜"],
      ["番茄", "补蔬菜与水分"],
    ],
  };

  CMF.BALANCE_TARGETS = TARGETS;

  function esc(value) {
    return String(value == null ? "" : value).replace(/[&<>"']/g, (ch) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
    }[ch]));
  }

  function clamp(n, low, high) {
    return Math.max(low, Math.min(high, n));
  }

  function knownIngredients() {
    const list = CMF.data && CMF.data.catalog && CMF.data.catalog.ingredients;
    return new Set((list || []).map((e) => e.canonical));
  }

  /* Pick up to `count` real catalog ingredients for a suggested side dish. */
  function companions(kind, count) {
    const known = knownIngredients();
    return (COMPANIONS[kind] || [])
      .filter(([name]) => known.has(name))
      .slice(0, count)
      .map(([name, reason]) => ({ name, reason, kind }));
  }

  function gradeOf(score) {
    if (score >= 85) return "优秀";
    if (score >= 70) return "良好";
    if (score >= 55) return "一般";
    return "待改善";
  }

  /* `totals` is {kcal, protein, fat, carbs}, optionally with `meals`.
     opts: { meals, note } - meals scales the energy expectation. */
  CMF.scoreBalance = function (totals, opts) {
    const options = opts || {};
    const t = totals || {};
    const kcal = Math.max(0, Number(t.kcal) || 0);
    const protein = Math.max(0, Number(t.protein) || 0);
    const fat = Math.max(0, Number(t.fat) || 0);
    const carbs = Math.max(0, Number(t.carbs) || 0);
    const meals = clamp(Number(options.meals || t.meals) || 1, 1, 4);

    const energy = { protein: protein * 4, fat: fat * 9, carbs: carbs * 4 };
    const sum = energy.protein + energy.fat + energy.carbs;
    const share = {
      protein: sum ? Math.round((energy.protein / sum) * 100) : 0,
      fat: sum ? Math.round((energy.fat / sum) * 100) : 0,
      carbs: sum ? Math.round((energy.carbs / sum) * 100) : 0,
    };

    if (!sum || !kcal) {
      return {
        score: 0, grade: "无数据", energyShare: share,
        parts: { macro: 0, protein: 0, energy: 0 },
        issues: ["缺少可用于评分的营养数据"],
        tips: ["该菜谱暂缺营养参考值，评分不可用。"],
        companions: [],
      };
    }

    // 60 points: distance from each recommended energy-share band.
    let macro = 0;
    ["protein", "fat", "carbs"].forEach((key) => {
      const [low, high] = TARGETS[key];
      const distance = share[key] < low ? low - share[key]
        : share[key] > high ? share[key] - high : 0;
      macro += clamp(20 - distance * 1.2, 0, 20);
    });
    macro = Math.round(macro);

    // 20 points: protein density (g per 100 kcal).
    const density = (protein / kcal) * 100;
    const proteinScore = Math.round(clamp(
      (density / TARGETS.proteinDensity) * 20, 0, 20
    ));

    // 20 points: does this meal/day cover a plausible amount of energy?
    const minKcal = TARGETS.kcalPerMeal[0] * meals;
    const maxKcal = TARGETS.kcalPerMeal[1] * meals;
    let energyScore;
    if (kcal < minKcal) energyScore = (kcal / minKcal) * 20;
    else if (kcal > maxKcal) energyScore = clamp(20 - ((kcal - maxKcal) / maxKcal) * 20, 0, 20);
    else energyScore = 20;
    energyScore = Math.round(energyScore);

    const score = clamp(macro + proteinScore + energyScore, 0, 100);
    const issues = [];
    const tips = [];
    const sides = [];

    if (share.protein < TARGETS.protein[0]) {
      issues.push("蛋白质供能偏低");
      tips.push("加一份鸡蛋、豆腐或瘦肉，把蛋白质补上来。");
      sides.push(...companions("protein", 2));
    }
    if (share.fat > TARGETS.fat[1]) {
      issues.push("脂肪供能偏高");
      tips.push("改用蒸、煮、白灼，或减少用油与肥肉。");
    }
    if (share.carbs < TARGETS.carbs[0]) {
      issues.push("碳水供能偏低");
      tips.push("搭配一份米饭、面条或薯类主食。");
      sides.push(...companions("carbs", 2));
    } else if (share.carbs > TARGETS.carbs[1]) {
      issues.push("碳水供能偏高");
      tips.push("适当减少主食，增加蔬菜与蛋白质。");
      sides.push(...companions("protein", 1));
    }
    if (kcal < minKcal) {
      issues.push("热量偏低");
      tips.push("这份菜单可能吃不饱，建议加主食或蛋白质配菜。");
      sides.push(...companions("veggie", 1));
    } else if (kcal > maxKcal) {
      issues.push("热量偏高");
      tips.push("适当减少主食或高脂食材的用量。");
    }
    if (!issues.length) {
      tips.push("三大营养素供能比接近推荐范围，保持这个搭配就很好。");
      sides.push(...companions("veggie", 1));
    }

    return {
      score,
      grade: gradeOf(score),
      energyShare: share,
      proteinDensity: Math.round(density * 10) / 10,
      kcal,
      parts: { macro, protein: proteinScore, energy: energyScore },
      issues,
      tips,
      companions: sides.slice(0, 3),
    };
  };

  /* Score one planner day (lunch + dinner, per serving). */
  CMF.balanceDay = function (days, index, recipes) {
    if (typeof CMF.weekDayNutrition !== "function") return null;
    const totals = CMF.weekDayNutrition(days, index, recipes);
    if (!totals.meals) return null;
    return CMF.scoreBalance(totals, { meals: totals.meals });
  };

  /* Score every planned day and summarise the weak spots. */
  CMF.balanceMenu = function (days, recipes) {
    const rows = (days || [])
      .map((d) => {
        const result = CMF.balanceDay(days, d.index, recipes);
        return result ? { index: d.index, ...result } : null;
      })
      .filter(Boolean);
    const average = rows.length
      ? Math.round(rows.reduce((sum, r) => sum + r.score, 0) / rows.length)
      : 0;
    const weak = rows.filter((r) => r.score < 70).map((r) => r.index);
    const counts = new Map();
    rows.forEach((r) => r.issues.forEach((issue) => counts.set(issue, (counts.get(issue) || 0) + 1)));
    const advice = [...counts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([issue, count]) => issue + "（" + count + " 天）");
    return { days: rows, average, weak, advice, grade: gradeOf(average) };
  };

  /* Reusable card (string only) for the recipe detail page. */
  CMF.renderBalanceCard = function (totals, opts) {
    if (typeof CMF.scoreBalance !== "function") return "";
    const result = CMF.scoreBalance(totals, opts);
    const cls = result.score >= 70 ? "good" : result.score >= 55 ? "fair" : "poor";
    return (
      '<div class="balance-card ' + cls + '">' +
      '<div class="balance-head"><span>⚖️ 营养均衡评分</span>' +
      `<span class="balance-grade">${esc(result.grade)}</span></div>` +
      '<div class="balance-score"><strong>' + result.score + '</strong><small>/ 100</small></div>' +
      `<div class="balance-bar"><span style="width:${result.score}%"></span></div>` +
      '<div class="balance-parts">供能比 ' + result.parts.macro + '/60 · 蛋白密度 ' +
      result.parts.protein + '/20 · 热量 ' + result.parts.energy + '/20</div>' +
      '<div class="balance-tips">' +
      result.tips.map((tip) => `<div>· ${esc(tip)}</div>`).join("") +
      "</div>" +
      (result.companions.length
        ? '<div class="balance-sides">建议搭配：' +
          result.companions.map((c) => `<span class="pill">${esc(c.name)} · ${esc(c.reason)}</span>`).join("") +
          "</div>"
        : "") +
      '<div class="balance-note">依据三大营养素供能比的启发式评分，仅用于搭配参考，不替代专业营养建议；未计主食、早餐与烹饪损耗。</div>' +
      "</div>"
    );
  };

  /* Compact planner summary. */
  CMF.renderBalanceSummary = function (summary, opts) {
    if (!summary || !summary.days.length) return "";
    const options = opts || {};
    return (
      '<div class="balance-summary">' +
      `<span class="balance-summary-score">⚖️ 菜单均衡 ${summary.average} 分 · ${esc(summary.grade)}</span>` +
      (summary.advice.length
        ? `<span class="balance-summary-advice">待改善：${summary.advice.map(esc).join("、")}</span>`
        : '<span class="balance-summary-advice">各天供能比都在推荐范围附近 👍</span>') +
      (options.showOptimize === false
        ? ""
        : '<button class="btn btn-sm" id="btn-optimize" title="只替换得分较低几天的一餐，保留其余安排">✨ 优化较弱的几天</button>') +
      "</div>"
    );
  };
})();
