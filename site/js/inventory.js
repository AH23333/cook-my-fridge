(function () {
  "use strict";

  const CMF = (window.CMF = window.CMF || {});
  const LOCATIONS = new Set(["fridge", "freezer", "pantry"]);
  const round = (n) => Math.round(n * 10) / 10;
  const today = () => CMF.localDay(new Date());

  function dayNumber(value) {
    if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
    const time = Date.parse(value + "T00:00:00Z");
    if (!Number.isFinite(time) || new Date(time).toISOString().slice(0, 10) !== value) return null;
    return time / 86400000;
  }

  function validGrams(value) {
    return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1000000;
  }

  function newest(a, b) {
    if (a.updatedAt !== b.updatedAt) return a.updatedAt > b.updatedAt ? a : b;
    if (a.deleted !== b.deleted) return a.deleted ? a : b;
    return JSON.stringify(a) >= JSON.stringify(b) ? a : b;
  }

  CMF.normalizeInventory = function (raw) {
    const rows = raw && !Array.isArray(raw) && Array.isArray(raw.batches) ? raw.batches : [];
    const byId = new Map();
    for (const row of rows) {
      if (!row || typeof row.id !== "string" || !row.id || row.id.length > 200 ||
          typeof row.canonical !== "string" || !row.canonical.trim() || row.canonical.length > 80 ||
          !validGrams(row.grams) || !Number.isSafeInteger(row.updatedAt) || row.updatedAt <= 0 ||
          typeof row.expiresOn !== "string" || (row.expiresOn !== "" && dayNumber(row.expiresOn) === null) ||
          !LOCATIONS.has(row.location)) continue;
      const batch = {
        id: row.id, canonical: row.canonical.trim(), grams: row.deleted === true ? 0 : round(row.grams),
        expiresOn: row.expiresOn, location: row.location,
        note: typeof row.note === "string" ? row.note.slice(0, 200) : "",
        updatedAt: row.updatedAt, deleted: row.deleted === true,
      };
      byId.set(batch.id, byId.has(batch.id) ? newest(byId.get(batch.id), batch) : batch);
    }
    return { batches: [...byId.values()].sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0) };
  };

  CMF.mergeInventories = function (local, incoming) {
    return CMF.normalizeInventory({ batches: [
      ...CMF.normalizeInventory(local).batches, ...CMF.normalizeInventory(incoming).batches,
    ] });
  };

  CMF.inventoryStatus = function (batch, date) {
    if (batch.deleted) return { key: "deleted", label: "已移除", days: null };
    if (batch.grams === 0) return { key: "empty", label: "已用完", days: null };
    if (!batch.expiresOn) return { key: "undated", label: "未填日期", days: null };
    const anchor = dayNumber(date || today());
    if (anchor === null) throw new Error("日期格式不正确");
    const days = dayNumber(batch.expiresOn) - anchor;
    if (days < 0) return { key: "expired", label: "已过期 " + -days + " 天", days };
    if (days === 0) return { key: "due", label: "今天到期", days };
    if (days <= 3) return { key: "due", label: days + " 天内到期", days };
    return { key: "fresh", label: "距到期 " + days + " 天", days };
  };

  CMF.inventorySummary = function (raw, date) {
    const summary = { active: 0, expired: 0, due: 0, undated: 0, grams: 0 };
    for (const batch of CMF.normalizeInventory(raw).batches) {
      const status = CMF.inventoryStatus(batch, date);
      if (status.key === "deleted" || status.key === "empty") continue;
      summary.active += 1;
      summary.grams = round(summary.grams + batch.grams);
      if (status.key in summary) summary[status.key] += 1;
    }
    return summary;
  };

  function timestamp(previous) {
    const next = Math.max(Date.now(), (previous || 0) + 1);
    if (!Number.isSafeInteger(next)) throw new Error("批次修改时间无效，未保存任何变更。");
    return next;
  }

  function persist(state) {
    if (!CMF.setInventory(state)) throw new Error("库存保存失败，输入已保留；请重试或导出备份后检查存储空间。");
  }

  CMF.upsertInventoryBatch = function (input, expected) {
    const canonical = CMF.normalizeName(input.canonical);
    if (!CMF.isKnown(canonical)) throw new Error("请选择目录中的食材，可输入常见别名。");
    if (!validGrams(input.grams) || (input.grams > 0 && round(input.grams) === 0)) {
      throw new Error("数量须为 0–1000000 克，最小精度为 0.1 克。");
    }
    if (typeof input.expiresOn !== "string" || (input.expiresOn && dayNumber(input.expiresOn) === null)) {
      throw new Error("请填写有效的到期日期，或留空。");
    }
    if (!LOCATIONS.has(input.location)) throw new Error("请选择冷藏、冷冻或常温。");
    const state = CMF.normalizeInventory(CMF.getInventory());
    const old = state.batches.find((b) => b.id === input.id);
    if (input.id && (!old || old.deleted || JSON.stringify(old) !== JSON.stringify(expected))) {
      throw new Error("这条批次已被修改，请重新打开编辑后再保存。");
    }
    const batch = {
      id: old ? old.id : "batch-" + (typeof crypto !== "undefined" && crypto.randomUUID
        ? crypto.randomUUID() : Date.now().toString(36) + "-" + Math.random().toString(36).slice(2)),
      canonical, grams: round(input.grams), expiresOn: input.expiresOn, location: input.location,
      note: String(input.note || "").trim().slice(0, 200), updatedAt: timestamp(old && old.updatedAt), deleted: false,
    };
    state.batches = state.batches.filter((b) => b.id !== batch.id).concat(batch);
    persist(CMF.normalizeInventory(state));
    return batch;
  };

  CMF.removeInventoryBatch = function (id, expected) {
    const state = CMF.normalizeInventory(CMF.getInventory());
    const batch = state.batches.find((b) => b.id === id);
    if (!batch || batch.deleted || JSON.stringify(batch) !== JSON.stringify(expected)) {
      throw new Error("这条批次已被修改，请刷新列表后重试。");
    }
    batch.deleted = true;
    batch.grams = 0;
    batch.updatedAt = timestamp(batch.updatedAt);
    persist(state);
    return true;
  };

  CMF.inventoryRecipeNeeds = function (recipe, factor) {
    const scale = Number.isFinite(factor) && factor > 0 ? factor : 1;
    const needs = new Map();
    for (const use of recipe.ingredients || []) {
      const parsed = CMF.parseAmount(use.amount);
      const converted = CMF.ingredientGrams(use.canonical, use.amount);
      const known = parsed.exact && converted.known && converted.grams > 0;
      const grams = known ? round(converted.grams * scale) : null;
      const row = needs.get(use.canonical);
      const estimated = !["克", "g", "千克", "公斤", "kg"].includes(parsed.unit);
      if (row) {
        row.grams = row.grams === null || grams === null ? null : round(row.grams + grams);
        row.optional = row.optional && Boolean(use.optional);
        row.estimated = row.estimated || estimated;
      } else {
        needs.set(use.canonical, { canonical: use.canonical, grams, optional: Boolean(use.optional), estimated });
      }
    }
    return [...needs.values()];
  };

  CMF.previewInventoryUse = function (raw, requests, date) {
    const day = date || today();
    if (dayNumber(day) === null) throw new Error("日期格式不正确");
    if (!Array.isArray(requests)) throw new Error("请选择要扣减的食材与克数。");
    const combined = new Map();
    for (const item of requests) {
      if (!item || typeof item.canonical !== "string" || !item.canonical ||
          !validGrams(item.grams) || round(item.grams) <= 0) throw new Error("扣减克数须大于 0，且不超过 1000000。");
      combined.set(item.canonical, round((combined.get(item.canonical) || 0) + item.grams));
      if (combined.get(item.canonical) > 1000000) throw new Error("同一食材的扣减克数不可超过 1000000。");
    }
    const state = CMF.normalizeInventory(raw);
    const lines = [...combined].map(([canonical, grams]) => {
      const batches = state.batches.filter((b) => b.canonical === canonical && !b.deleted && b.grams > 0);
      const usable = batches.filter((b) => CMF.inventoryStatus(b, day).key !== "expired")
        .sort((a, b) => (a.expiresOn || "9999-99-99").localeCompare(b.expiresOn || "9999-99-99") ||
          (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
      const available = round(usable.reduce((sum, b) => sum + b.grams, 0));
      const expiredGrams = round(batches.filter((b) => CMF.inventoryStatus(b, day).key === "expired")
        .reduce((sum, b) => sum + b.grams, 0));
      let remaining = grams;
      const allocations = [];
      for (const batch of usable) {
        const take = round(Math.min(remaining, batch.grams));
        if (take > 0) allocations.push({ id: batch.id, grams: take });
        remaining = round(remaining - take);
        if (!remaining) break;
      }
      return { canonical, grams, available, missing: round(Math.max(0, grams - available)), expiredGrams, allocations };
    });
    return {
      before: JSON.stringify(state), day,
      requests: [...combined].map(([canonical, grams]) => ({ canonical, grams })),
      ok: lines.length > 0 && lines.every((line) => line.missing === 0),
      totalGrams: round(lines.reduce((sum, line) => sum + line.grams, 0)), lines,
    };
  };

  CMF.commitInventoryUse = function (preview) {
    const before = CMF.normalizeInventory(CMF.getInventory());
    if (!preview || preview.before !== JSON.stringify(before) || preview.day !== today()) {
      throw new Error("库存或日期已变化，请重新预览扣减。");
    }
    const verified = CMF.previewInventoryUse(before, preview.requests);
    if (!verified.ok) throw new Error("库存不足或未选食材；不会扣减任何批次。");
    const changes = verified.lines.flatMap((line) => line.allocations);
    const state = CMF.normalizeInventory(before);
    for (const change of changes) {
      const batch = state.batches.find((b) => b.id === change.id);
      batch.grams = round(batch.grams - change.grams);
      batch.updatedAt = timestamp(batch.updatedAt);
    }
    persist(state);
    return { before, after: JSON.stringify(state), changes };
  };

  CMF.undoInventoryUse = function (receipt) {
    const current = CMF.normalizeInventory(CMF.getInventory());
    if (!receipt || JSON.stringify(current) !== receipt.after) {
      throw new Error("库存已有后续变动，不能覆盖撤销；请到库存台账核对调整。");
    }
    const previous = CMF.normalizeInventory(receipt.before);
    const changed = new Set(receipt.changes.map((change) => change.id));
    for (const batch of current.batches) {
      if (!changed.has(batch.id)) continue;
      batch.grams = previous.batches.find((b) => b.id === batch.id).grams;
      batch.updatedAt = timestamp(batch.updatedAt);
    }
    persist(current);
    return true;
  };
})();
