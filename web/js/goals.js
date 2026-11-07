/* Personal nutrition goals: Mifflin-St Jeor BMR -> TDEE -> daily macro goals.
   Pure logic + localStorage-backed profile; no DOM access in the math.
   These are planning estimates, NOT medical advice. The default (no profile)
   path leaves every existing balance score untouched. */
(function () {
  "use strict";

  const CMF = window.CMF;

  const ACTIVITY = [
    { key: "sedentary", label: "久坐 · 几乎不运动", factor: 1.2 },
    { key: "light", label: "轻度 · 每周 1–3 次", factor: 1.375 },
    { key: "moderate", label: "中度 · 每周 3–5 次", factor: 1.55 },
    { key: "active", label: "高强度 · 每周 6–7 次", factor: 1.725 },
    { key: "very", label: "体力劳动 / 双练", factor: 1.9 },
  ];
  const MODES = [
    { key: "cut", label: "减脂", energy: 0.8, proteinPerKg: 1.8 },
    { key: "maintain", label: "维持", energy: 1.0, proteinPerKg: 1.4 },
    { key: "bulk", label: "增肌", energy: 1.12, proteinPerKg: 1.8 },
  ];
  const SEX = [
    { key: "unspecified", label: "不指定（取中性常数）", offset: -78 },
    { key: "female", label: "女", offset: -161 },
    { key: "male", label: "男", offset: 5 },
  ];

  const DEFAULT_PROFILE = {
    enabled: false,
    sex: "unspecified",
    age: 30,
    heightCm: 165,
    weightKg: 60,
    activity: "moderate",
    mode: "maintain",
    people: 1,
    mealsPerDay: 2,
  };

  CMF.GOAL_ACTIVITY = ACTIVITY;
  CMF.GOAL_MODES = MODES;
  CMF.GOAL_SEX = SEX;
  CMF.DEFAULT_GOAL_PROFILE = Object.assign({}, DEFAULT_PROFILE);

  function clamp(n, low, high) {
    return Math.max(low, Math.min(high, n));
  }
  function int(value, fallback, low, high) {
    const n = Math.round(Number(value));
    return Number.isFinite(n) ? clamp(n, low, high) : fallback;
  }
  function pick(list, key, fallback) {
    return list.some((x) => x.key === key) ? key : fallback;
  }
  function esc(value) {
    return String(value == null ? "" : value).replace(/[&<>"']/g, (ch) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
    }[ch]));
  }

  /* Never trust a stored/manually edited profile. Out-of-range values are
     clamped, unknown enums fall back, and NaN can never reach the formula. */
  CMF.sanitizeGoalProfile = function (raw) {
    const value = raw && typeof raw === "object" ? raw : {};
    // QR sync stores the profile with one-letter field names (and an `e`
    // enabled flag) to save bytes; accept both shapes transparently.
    const src = value.profile || value.p || value;
    const field = (long, short) => {
      if (src[long] !== undefined) return src[long];
      if (src[short] !== undefined) return src[short];
      if (value[long] !== undefined) return value[long];
      return value[short];
    };
    return {
      enabled: Boolean(field("enabled", "e")),
      sex: pick(SEX, field("sex", "s"), DEFAULT_PROFILE.sex),
      age: int(field("age", "a"), DEFAULT_PROFILE.age, 10, 100),
      heightCm: int(field("heightCm", "h"), DEFAULT_PROFILE.heightCm, 120, 220),
      weightKg: int(field("weightKg", "w"), DEFAULT_PROFILE.weightKg, 30, 200),
      activity: pick(ACTIVITY, field("activity", "v"), DEFAULT_PROFILE.activity),
      mode: pick(MODES, field("mode", "m"), DEFAULT_PROFILE.mode),
      people: int(field("people", "n"), DEFAULT_PROFILE.people, 1, 12),
      mealsPerDay: int(field("mealsPerDay", "c"), DEFAULT_PROFILE.mealsPerDay, 1, 4),
    };
  };

  CMF.computeGoals = function (raw) {
    const p = CMF.sanitizeGoalProfile(raw);
    const sex = SEX.find((s) => s.key === p.sex) || SEX[0];
    const activity = ACTIVITY.find((a) => a.key === p.activity) || ACTIVITY[2];
    const mode = MODES.find((m) => m.key === p.mode) || MODES[1];
    const bmr = Math.round(10 * p.weightKg + 6.25 * p.heightCm - 5 * p.age + sex.offset);
    const tdee = Math.round(bmr * activity.factor);
    const kcal = clamp(Math.round((tdee * mode.energy) / 10) * 10, 1200, 4000);
    const protein = Math.round(p.weightKg * mode.proteinPerKg);
    const fat = Math.round((kcal * 0.25) / 9);
    const carbs = Math.max(50, Math.round((kcal - protein * 4 - fat * 9) / 4));
    const daily = { kcal, protein, fat, carbs };
    const round1 = (n) => Math.round(n * 10) / 10;
    const perMeal = {
      kcal: Math.round(kcal / p.mealsPerDay),
      protein: round1(protein / p.mealsPerDay),
      fat: round1(fat / p.mealsPerDay),
      carbs: round1(carbs / p.mealsPerDay),
    };
    const household = {
      kcal: kcal * p.people,
      protein: protein * p.people,
      fat: fat * p.people,
      carbs: carbs * p.people,
    };
    const energy = { protein: protein * 4, fat: fat * 9, carbs: carbs * 4 };
    const totalEnergy = energy.protein + energy.fat + energy.carbs;
    return {
      profile: p,
      bmr,
      tdee,
      factor: activity.factor,
      mode: mode.key,
      daily,
      perMeal,
      household,
      energyShare: {
        protein: Math.round((energy.protein / totalEnergy) * 100),
        fat: Math.round((energy.fat / totalEnergy) * 100),
        carbs: Math.round((energy.carbs / totalEnergy) * 100),
      },
      note: "Mifflin-St Jeor 估算，仅用于备餐搭配，不替代专业营养或医疗建议。",
    };
  };

  /* The enabled flag lives in localStorage, not in the math. */
  CMF.activeGoals = function () {
    if (typeof CMF.getGoals !== "function") return null;
    const stored = CMF.getGoals();
    if (!stored || typeof stored !== "object") return null;
    // Older/looser payloads may keep `enabled` on the profile itself.
    const raw = stored.profile || stored.p || stored;
    const enabled = stored.enabled !== undefined ? stored.enabled
      : stored.e !== undefined ? stored.e
      : raw.enabled !== undefined ? raw.enabled : raw.e;
    if (!enabled) return null;
    const profile = CMF.sanitizeGoalProfile({ ...raw, enabled: true });
    return CMF.computeGoals(profile);
  };

  /* Targets for one scoring unit (1 meal, or `meals` meals of a day). */
  CMF.goalTargets = function (opts) {
    const goals = CMF.activeGoals();
    if (!goals) return null;
    const options = opts || {};
    const meals = clamp(Math.round(Number(options.meals) || 1), 1, 4);
    const scale = meals / goals.profile.mealsPerDay;
    const round1 = (n) => Math.round(n * 10) / 10;
    return {
      kcal: Math.round(goals.perMeal.kcal * meals),
      protein: round1(goals.perMeal.protein * meals),
      fat: round1(goals.perMeal.fat * meals),
      carbs: round1(goals.perMeal.carbs * meals),
      meals,
      scale: round1(scale),
      source: "personal",
    };
  };

  /* Percent of the personal daily (or per-meal) target covered by totals. */
  CMF.goalProgress = function (totals, opts) {
    const target = CMF.goalTargets(opts);
    if (!target) return null;
    const t = totals || {};
    const pct = (key) => {
      const goal = Number(target[key]) || 0;
      if (!goal) return 0;
      return Math.round(((Number(t[key]) || 0) / goal) * 100);
    };
    return {
      kcal: pct("kcal"), protein: pct("protein"),
      fat: pct("fat"), carbs: pct("carbs"),
      target,
    };
  };

  CMF.goalHint = function (totals, opts) {
    const progress = CMF.goalProgress(totals, opts);
    if (!progress) return "";
    const goals = CMF.activeGoals();
    return `🎯 约占个人目标 ${progress.kcal}% 热量 · 蛋白 ${progress.protein}%` +
      `（按每日 ${goals.profile.mealsPerDay} 餐分摊）`;
  };

  function progressRow(label, value, unit, pct) {
    const width = clamp(pct, 0, 100);
    const cls = pct > 130 ? "over" : pct < 60 ? "low" : "ok";
    return (
      `<div class="goal-progress ${cls}">` +
      `<span class="goal-progress-label">${esc(label)}</span>` +
      `<span class="goal-progress-value">${value}${esc(unit)} · ${pct}%</span>` +
      `<span class="goal-progress-bar"><i style="width:${width}%"></i></span>` +
      "</div>"
    );
  }

  /* Optional card for recipe details: how much of my target is one serving. */
  CMF.renderGoalProgress = function (totals, opts) {
    const progress = CMF.goalProgress(totals, opts);
    if (!progress) return "";
    const t = totals || {};
    const goals = CMF.activeGoals();
    const mealLabel = progress.target.meals > 1
      ? `${progress.target.meals} 餐合计` : "每份 / 一餐";
    return (
      '<div class="goal-card">' +
      `<div class="goal-card-head">🎯 我的营养目标 · ${mealLabel}</div>` +
      progressRow("热量", Math.round(Number(t.kcal) || 0), " kcal", progress.kcal) +
      progressRow("蛋白质", Number(t.protein) || 0, " g", progress.protein) +
      progressRow("脂肪", Number(t.fat) || 0, " g", progress.fat) +
      progressRow("碳水", Number(t.carbs) || 0, " g", progress.carbs) +
      `<div class="goal-card-note">目标 ${progress.target.kcal} kcal / 蛋白 ${progress.target.protein} g · ` +
      `按每日 ${goals.profile.mealsPerDay} 餐分摊；${esc(goals.note)}</div>` +
      "</div>"
    );
  };

  /* Settings summary shown on the fridge page. */
  CMF.renderGoalsSummary = function (goals) {
    if (!goals) return "";
    const d = goals.daily;
    const m = goals.perMeal;
    const h = goals.household;
    return (
      '<div class="goal-summary">' +
      `<div><strong>${d.kcal}</strong> kcal/日 · 基础代谢 ${goals.bmr} · 活动消耗 ${goals.tdee}</div>` +
      `<div>蛋白 ${d.protein} g · 脂肪 ${d.fat} g · 碳水 ${d.carbs} g · 供能比 ` +
      `${goals.energyShare.protein}/${goals.energyShare.fat}/${goals.energyShare.carbs}%</div>` +
      `<div>每餐约 ${m.kcal} kcal / 蛋白 ${m.protein} g · ` +
      `全家 ${goals.profile.people} 人合计 ${h.kcal} kcal/日</div>` +
      `<div class="goal-summary-note">${esc(goals.note)}</div>` +
      "</div>"
    );
  };
})();
