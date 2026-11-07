/* Cooked-it journal: check-ins, ratings, notes, streaks and achievements.
   Pure logic over a plain journal object; storage lives in store.js so
   backup / restore / sync cover it automatically. */
(function () {
  "use strict";

  const CMF = (window.CMF = window.CMF || {});
  const MAX_ENTRIES = 500;

  function validRating(value) {
    return Number.isInteger(value) && value >= 0 && value <= 5;
  }

  function entries(value) {
    return value && typeof value === "object" && !Array.isArray(value) ? Object.entries(value) : [];
  }

  CMF.normalizeJournal = function (raw) {
    const safe = raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
    return {
      cooked: (Array.isArray(safe.cooked) ? safe.cooked : [])
        .filter((e) => e && typeof e.id === "string" && e.id &&
          typeof e.recipeId === "string" && e.recipeId &&
          typeof e.date === "string" && Number.isFinite(Date.parse(e.date)))
        .map((e) => ({
          id: e.id, recipeId: e.recipeId,
          title: typeof e.title === "string" ? e.title : e.recipeId,
          date: e.date,
          factor: Number.isFinite(e.factor) && e.factor > 0 ? e.factor : 1,
          rating: validRating(e.rating) ? e.rating : 0,
          note: typeof e.note === "string" ? e.note.slice(0, 500) : "",
          kcal: Number.isFinite(e.kcal) && e.kcal >= 0 ? e.kcal : null,
          cost: Number.isFinite(e.cost) && e.cost >= 0 ? e.cost : null,
        })),
      ratings: Object.fromEntries(entries(safe.ratings).filter(([, value]) => validRating(value))),
      notes: Object.fromEntries(entries(safe.notes)
        .filter(([, value]) => typeof value === "string")
        .map(([key, value]) => [key, value.slice(0, 500)])),
    };
  };

  CMF.mergeJournals = function (local, incoming) {
    const a = CMF.normalizeJournal(local);
    const b = CMF.normalizeJournal(incoming);
    const cooked = new Map(b.cooked.map((e) => [e.id, e]));
    a.cooked.forEach((e) => cooked.set(e.id, e));
    return {
      cooked: [...cooked.values()].sort((x, y) => Date.parse(y.date) - Date.parse(x.date)),
      ratings: { ...b.ratings, ...a.ratings },
      notes: { ...b.notes, ...a.notes },
    };
  };

  CMF.localDay = function (date) {
    const d = date instanceof Date ? date : new Date(date);
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${d.getFullYear()}-${m}-${day}`;
  };

  /* Record one cooking session. Nutrition and cost are snapshots so later
     catalog edits never rewrite history. */
  CMF.logCooked = function (recipe, opts) {
    const options = opts || {};
    const factor = options.factor > 0 ? options.factor : 1;
    const journal = CMF.normalizeJournal(CMF.getJournal ? CMF.getJournal() : null);
    const rating = Math.max(0, Math.min(5, Math.round(Number(options.rating) || 0)));
    const note = String(options.note || "").trim().slice(0, 500);
    let kcal = null;
    if (typeof CMF.estimateNutrition === "function") {
      const est = CMF.estimateNutrition(recipe, factor);
      if (est && est.perServing) kcal = est.perServing.kcal;
    }
    let cost = null;
    if (typeof CMF.recipeCost === "function") {
      const c = CMF.recipeCost(recipe, factor);
      if (c) cost = c.total;
    }
    const entry = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      recipeId: recipe.id,
      title: recipe.title,
      date: (options.now ? new Date(options.now) : new Date()).toISOString(),
      factor,
      rating,
      note,
      kcal,
      cost,
    };
    journal.cooked.unshift(entry);
    journal.cooked = journal.cooked.slice(0, MAX_ENTRIES);
    if (rating > 0) journal.ratings[recipe.id] = rating;
    if (note) journal.notes[recipe.id] = note;
    if (!CMF.setJournal || !CMF.setJournal(journal)) return null;
    return entry;
  };

  CMF.cookedCountFor = function (journal, recipeId) {
    return CMF.normalizeJournal(journal).cooked.filter((e) => e.recipeId === recipeId).length;
  };

  CMF.journalSummary = function (journal) {
    const j = CMF.normalizeJournal(journal);
    const ids = new Set(j.cooked.map((e) => e.recipeId));
    const rated = j.cooked.filter((e) => e.rating > 0);
    const avg = rated.length
      ? Math.round((rated.reduce((s, e) => s + e.rating, 0) / rated.length) * 10) / 10
      : 0;
    return {
      total: j.cooked.length,
      distinct: ids.size,
      avgRating: avg,
      lastDate: j.cooked.length ? j.cooked[0].date : null,
    };
  };

  /* Consecutive cooking days ending today (or yesterday — today's dinner
     may not have happened yet). */
  CMF.journalStreak = function (journal, today) {
    const j = CMF.normalizeJournal(journal);
    const days = new Set(j.cooked.map((e) => CMF.localDay(e.date)));
    const anchor = today ? new Date(today) : new Date();
    if (!days.has(CMF.localDay(anchor))) anchor.setDate(anchor.getDate() - 1);
    let streak = 0;
    while (days.has(CMF.localDay(anchor))) {
      streak += 1;
      anchor.setDate(anchor.getDate() - 1);
    }
    return streak;
  };

  CMF.topRated = function (journal, limit) {
    const j = CMF.normalizeJournal(journal);
    const map = new Map();
    for (const e of j.cooked) {
      if (!(e.rating > 0)) continue;
      const row = map.get(e.recipeId) || { recipeId: e.recipeId, title: e.title, sum: 0, count: 0 };
      row.sum += e.rating;
      row.count += 1;
      map.set(e.recipeId, row);
    }
    return [...map.values()]
      .map((r) => ({ recipeId: r.recipeId, title: r.title, avg: Math.round((r.sum / r.count) * 10) / 10, count: r.count }))
      .sort((a, b) => b.avg - a.avg || b.count - a.count || (a.title < b.title ? -1 : 1))
      .slice(0, limit || 5);
  };

  /* Per-day totals for the last `days` days, oldest first. */
  CMF.weeklyTrend = function (journal, days, today) {
    const j = CMF.normalizeJournal(journal);
    const n = days || 7;
    const anchor = today ? new Date(today) : new Date();
    const byDay = new Map();
    for (const e of j.cooked) {
      const key = CMF.localDay(e.date);
      const row = byDay.get(key) || { kcal: 0, cost: 0, count: 0 };
      row.count += 1;
      if (typeof e.kcal === "number") row.kcal += e.kcal;
      if (typeof e.cost === "number") row.cost += e.cost;
      byDay.set(key, row);
    }
    const out = [];
    for (let i = n - 1; i >= 0; i -= 1) {
      const d = new Date(anchor);
      d.setDate(d.getDate() - i);
      const key = CMF.localDay(d);
      const row = byDay.get(key) || { kcal: 0, cost: 0, count: 0 };
      out.push({ day: key, label: `${d.getMonth() + 1}/${d.getDate()}`, ...row });
    }
    return out;
  };

  const BADGES = [
    { key: "first", emoji: "🍳", label: "初下厨房", desc: "完成第一次开饭打卡", target: 1 },
    { key: "streak3", emoji: "🔥", label: "三日不断", desc: "连续 3 天自己做饭", target: 3 },
    { key: "streak7", emoji: "⚡", label: "七日连击", desc: "连续 7 天自己做饭", target: 7 },
    { key: "variety10", emoji: "🎨", label: "十菜俱乐部", desc: "做过 10 道不同的菜", target: 10 },
    { key: "cooked30", emoji: "🏅", label: "全勤厨神", desc: "累计打卡 30 次", target: 30 },
    { key: "fav10", emoji: "💗", label: "收藏家", desc: "收藏 10 道菜", target: 10 },
    { key: "fridge10", emoji: "🧊", label: "冰箱管理员", desc: "冰箱里同时有 10 样食材", target: 10 },
    { key: "plan5", emoji: "📋", label: "计划通", desc: "计划里放过 5 道菜", target: 5 },
    { key: "share5", emoji: "📣", label: "分享达人", desc: "分享 5 次菜谱或冰箱", target: 5 },
  ];

  CMF.achievements = function (state) {
    const s = state || {};
    const summary = CMF.journalSummary(s.journal);
    const streak = CMF.journalStreak(s.journal, s.today);
    const metrics = {
      first: summary.total,
      streak3: streak,
      streak7: streak,
      variety10: summary.distinct,
      cooked30: summary.total,
      fav10: (s.favorites || []).length,
      fridge10: (s.fridge || []).length,
      plan5: (s.plan || []).length,
      share5: s.shareStats && s.shareStats.total ? s.shareStats.total : 0,
    };
    return BADGES.map((b) => ({
      ...b,
      progress: Math.min(metrics[b.key] || 0, b.target),
      earned: (metrics[b.key] || 0) >= b.target,
    }));
  };

})();