/* Independent batch ledger and explicit recipe inventory use. */
(function () {
  "use strict";

  const CMF = (window.CMF = window.CMF || {});
  const LOCATIONS = { fridge: "冷藏", freezer: "冷冻", pantry: "常温" };
  let mountId = 0;

  function gramsText(value) {
    return CMF.esc(Math.round(value * 10) / 10) + " 克";
  }

  function eligible(batch) {
    return ["fresh", "due", "undated"].includes(CMF.inventoryStatus(batch).key);
  }

  function availableByName(raw) {
    const result = new Map();
    CMF.normalizeInventory(raw).batches.filter(eligible).forEach((batch) => {
      result.set(batch.canonical, (result.get(batch.canonical) || 0) + batch.grams);
    });
    return result;
  }

  function announce(root, text, error) {
    const message = root.querySelector("[data-inventory-message]");
    message.setAttribute("role", error ? "alert" : "status");
    message.setAttribute("aria-live", error ? "assertive" : "polite");
    message.classList.toggle("inventory-error", !!error);
    message.innerHTML = CMF.esc(text);
  }

  function errorText(error) {
    return error && error.message ? error.message : "操作未完成，请检查浏览器存储后重试。";
  }

  function readGrams(input, allowZero) {
    const value = Number(input.value);
    if (!input.value.trim() || !Number.isFinite(value) || value < (allowZero ? 0 : 0.1) ||
        value > 1000000 || Math.abs(value * 10 - Math.round(value * 10)) > 0.000001) {
      input.focus();
      throw new Error("克数须为" + (allowZero ? " 0" : " 0.1") + " 至 1000000 的数字，最多保留 1 位小数。");
    }
    return value;
  }

  function messageHTML() {
    return '<p class="inventory-message" data-inventory-message role="status" aria-live="polite" aria-atomic="true"></p>';
  }

  CMF.mountInventory = function (root, onFridgeChanged) {
    if (!root) return;
    const prefix = "cmf-inventory-" + (++mountId);
    let expected = null;
    let dirty = false;
    root.classList.add("cmf-inventory");
    root.setAttribute("aria-labelledby", prefix + "-title");
    root.innerHTML =
      '<div class="inventory-panel">' +
      `<h2 id="${prefix}-title">批次明细</h2>` +
      '<p class="inventory-note">按批记录剩余克数，与开饭清单分开保存。清空开饭清单不会删除批次。</p>' +
      '<div class="inventory-summary" data-inventory-summary></div>' +
      '<details class="inventory-editor"><summary>添加批次</summary><div data-inventory-editor></div></details>' +
      messageHTML() +
      '<div class="inventory-toolbar">' +
      '<label class="inventory-field"><span>食材名称搜索</span><input type="search" data-inventory-search placeholder="输入名称或同义词"></label>' +
      '<label class="inventory-field"><span>批次状态</span><select data-inventory-filter>' +
      '<option value="active">全部在库</option><option value="due">3 天内到期</option>' +
      '<option value="expired">已过期</option><option value="undated">未填日期</option>' +
      '<option value="empty">已用完</option></select></label></div>' +
      '<p class="inventory-note" data-inventory-count role="status" aria-live="polite"></p>' +
      '<div class="inventory-list-head" aria-hidden="true"><span>食材 / 备注</span><span>剩余克数</span><span>到期 / 状态</span><span>存放</span><span>操作</span></div>' +
      '<ul class="inventory-list" data-inventory-list aria-label="库存批次"></ul>' +
      '<div class="inventory-actions"><button type="button" class="btn btn-sm" data-inventory-add-fridge>未过期在库食材加入开饭清单</button></div>' +
      '<p class="inventory-note inventory-safety">日期只作提醒，不代表可以食用；以包装要求和实际状态为准。没有日期不保证新鲜，过期批次不参与扣减。</p>' +
      '<p class="inventory-note">台账保存在本机；同步合并时，同一批次 ID 以最近修改为准，不是实时共同库存。二维码不含台账。</p>' +
      '</div>';

    const editor = root.querySelector(".inventory-editor");
    const editorBody = root.querySelector("[data-inventory-editor]");
    const search = root.querySelector("[data-inventory-search]");
    const filter = root.querySelector("[data-inventory-filter]");

    function renderEditor(batch) {
      expected = batch ? { ...batch } : null;
      dirty = false;
      const draft = batch || { canonical: "", grams: "", expiresOn: "", location: "fridge", note: "" };
      editor.querySelector("summary").textContent = batch ? "编辑批次" : "添加批次";
      editorBody.innerHTML =
        '<form class="inventory-form" novalidate>' +
        '<div class="inventory-form-grid">' +
        '<label class="inventory-field inventory-name-field"><span>食材名称</span>' +
        `<input name="canonical" list="${prefix}-ingredients" value="${CMF.esc(draft.canonical)}" required placeholder="如：番茄，也可填同义词"></label>` +
        `<datalist id="${prefix}-ingredients">` +
        CMF.allIngredients().map((entry) => `<option value="${CMF.esc(entry.canonical)}"></option>`).join("") +
        '</datalist>' +
        '<label class="inventory-field"><span>剩余克数（克）</span>' +
        `<input name="grams" type="number" inputmode="decimal" min="${batch ? 0 : 0.1}" max="1000000" step="0.1" value="${CMF.esc(draft.grams)}" required></label>` +
        '<label class="inventory-field"><span>到期日期（可不填）</span>' +
        `<input name="expiresOn" type="date" max="9999-12-31" value="${CMF.esc(draft.expiresOn)}"></label>` +
        '<label class="inventory-field"><span>存放位置</span><select name="location">' +
        Object.entries(LOCATIONS).map(([key, label]) =>
          `<option value="${CMF.esc(key)}"${draft.location === key ? " selected" : ""}>${CMF.esc(label)}</option>`
        ).join("") +
        '</select></label>' +
        '<label class="inventory-field inventory-note-field"><span>备注（可不填）</span>' +
        `<textarea name="note" rows="2" maxlength="200" placeholder="如：开封日期、包装说明">${CMF.esc(draft.note)}</textarea></label></div>` +
        '<p class="inventory-note">统一记克数，请按实际称重填写；编辑时填 0 表示已用完。</p>' +
        '<div class="inventory-actions"><button type="submit" class="btn btn-primary btn-sm">' +
        (batch ? '保存修改' : '添加批次') + '</button>' +
        '<button type="button" class="btn btn-sm" data-inventory-cancel>' + (batch ? '取消编辑' : '清空草稿') + '</button></div></form>';
      const form = editorBody.querySelector("form");
      form.oninput = form.onchange = () => { dirty = true; };
      form.querySelector("[data-inventory-cancel]").onclick = () => {
        if (dirty && !window.confirm("放弃当前未保存的批次草稿？")) return;
        renderEditor(null);
        renderList();
        announce(root, "草稿已清空，已重新读取批次；已保存的记录没有改变。");
        editorBody.querySelector('[name="canonical"]').focus();
      };
      form.onsubmit = (event) => {
        event.preventDefault();
        const fields = form.elements;
        let saved;
        try {
          if (!fields.canonical.value.trim()) {
            fields.canonical.focus();
            throw new Error("请填写食材名称，可从提示列表选择或输入同义词。");
          }
          if (!fields.expiresOn.validity.valid) {
            fields.expiresOn.focus();
            throw new Error("请填写有效的到期日期，或留空。");
          }
          const input = {
            canonical: fields.canonical.value,
            grams: readGrams(fields.grams, !!expected),
            expiresOn: fields.expiresOn.value,
            location: fields.location.value,
            note: fields.note.value,
          };
          if (expected) input.id = expected.id;
          saved = CMF.upsertInventoryBatch(input, expected || undefined);
        } catch (error) {
          announce(root, "保存失败：" + errorText(error) + " 草稿已保留；若批次已变更，请取消编辑后重新核对。", true);
          return;
        }
        renderEditor(null);
        renderList();
        announce(root, "已保存「" + saved.canonical + "」，剩余 " + saved.grams + " 克。开饭清单未改变。");
        editorBody.querySelector('[name="canonical"]').focus();
      };
      if (batch) {
        editor.open = true;
        form.elements.canonical.focus();
      }
    }

    function renderList() {
      const raw = CMF.getInventory();
      const batches = CMF.normalizeInventory(raw).batches.filter((batch) => !batch.deleted);
      const summary = CMF.inventorySummary(raw);
      root.querySelector("[data-inventory-summary]").innerHTML =
        `<span>在库 <strong>${CMF.esc(summary.active)}</strong> 批</span>` +
        `<span>3 天内 <strong>${CMF.esc(summary.due)}</strong> 批</span>` +
        `<span>已过期 <strong>${CMF.esc(summary.expired)}</strong> 批</span>` +
        `<span>未填日期 <strong>${CMF.esc(summary.undated)}</strong> 批</span>` +
        `<span>在库合计 <strong>${gramsText(summary.grams)}</strong></span>`;
      const query = search.value.trim().toLocaleLowerCase();
      const normalizedQuery = query ? CMF.normalizeName(query).toLocaleLowerCase() : "";
      const rows = batches.filter((batch) => {
        const key = CMF.inventoryStatus(batch).key;
        const matchesStatus = filter.value === "active" ? batch.grams > 0 : key === filter.value;
        const name = batch.canonical.toLocaleLowerCase();
        return matchesStatus && (!query || name.includes(query) || name.includes(normalizedQuery));
      }).sort((a, b) => (a.expiresOn || "9999-99-99").localeCompare(b.expiresOn || "9999-99-99") ||
        a.canonical.localeCompare(b.canonical, "zh-CN") || a.id.localeCompare(b.id));
      root.querySelector("[data-inventory-count]").innerHTML =
        `显示 ${CMF.esc(rows.length)} 批；全部在库含仍有余量的过期批次，已移除记录不显示。`;
      const list = root.querySelector("[data-inventory-list]");
      list.innerHTML = rows.length ? rows.map((batch, index) => {
        const status = CMF.inventoryStatus(batch);
        return '<li class="inventory-row">' +
          `<div class="inventory-batch-name"><strong>${CMF.esc(batch.canonical)}</strong>` +
          (batch.note ? `<small class="inventory-batch-note">${CMF.esc(batch.note)}</small>` : '') + '</div>' +
          `<div class="inventory-batch-grams">${gramsText(batch.grams)}</div>` +
          '<div class="inventory-expiry">' +
          (batch.expiresOn ? `<time datetime="${CMF.esc(batch.expiresOn)}">${CMF.esc(batch.expiresOn)}</time>` : '<span>未填日期</span>') +
          `<span class="inventory-badge" data-status="${CMF.esc(status.key)}">${CMF.esc(status.key === "fresh" ? "未到期" : status.label)}</span></div>` +
          `<div class="inventory-location">${CMF.esc(LOCATIONS[batch.location])}</div>` +
          '<div class="inventory-row-actions">' +
          `<button type="button" class="btn btn-sm" data-inventory-edit="${index}" aria-label="编辑${CMF.esc(batch.canonical)}批次">编辑</button>` +
          `<button type="button" class="btn btn-sm inventory-remove" data-inventory-remove="${index}" aria-label="移除${CMF.esc(batch.canonical)}批次">移除</button></div></li>`;
      }).join("") : '<li class="inventory-empty">没有符合条件的批次。可以添加批次，或更换筛选条件。</li>';
      list.querySelectorAll("[data-inventory-edit]").forEach((button) => {
        const batch = rows[Number(button.dataset.inventoryEdit)];
        button.onclick = () => {
          if (dirty && !window.confirm("放弃当前未保存的草稿，改为编辑这个批次？")) return;
          renderEditor(batch);
          announce(root, "正在编辑「" + batch.canonical + "」。保存前不会改变库存。");
        };
      });
      list.querySelectorAll("[data-inventory-remove]").forEach((button) => {
        const batch = rows[Number(button.dataset.inventoryRemove)];
        button.onclick = () => {
          if (!window.confirm("确认移除这个批次？台账会保留删除记录，开饭清单不会改变。若正在编辑此批次，其草稿也会清空。")) return;
          try {
            if (CMF.removeInventoryBatch(batch.id, { ...batch }) !== true) throw new Error("批次未能移除，请重试。");
          } catch (error) {
            announce(root, "移除失败：" + errorText(error) + " 草稿已保留。", true);
            return;
          }
          if (expected && expected.id === batch.id) renderEditor(null);
          renderList();
          announce(root, "已移除「" + batch.canonical + "」批次，开饭清单未改变。");
          filter.focus();
        };
      });
    }

    search.oninput = renderList;
    filter.onchange = renderList;
    root.querySelector("[data-inventory-add-fridge]").onclick = () => {
      let text;
      try {
        const names = CMF.normalizeInventory(CMF.getInventory()).batches.filter(eligible).map((batch) => batch.canonical);
        if (!names.length) {
          announce(root, "没有可加入的未过期在库食材；过期、已移除和已用完批次不加入。");
          return;
        }
        const before = CMF.getFridge();
        const next = [...new Set([...before, ...names])];
        if (CMF.setFridge(next) !== true) throw new Error("开饭清单未能保存，请检查浏览器存储后重试。");
        text = "已加入 " + next.filter((name) => !before.includes(name)).length + " 样食材，开饭清单共 " + next.length + " 样；批次数量没有改变。请自行确认食材状态。";
      } catch (error) {
        announce(root, "加入失败：" + errorText(error), true);
        return;
      }
      if (typeof onFridgeChanged === "function") onFridgeChanged();
      announce(root, text);
    };
    renderEditor(null);
    renderList();
    editor.open = !CMF.normalizeInventory(CMF.getInventory()).batches.some((batch) => !batch.deleted);
  };

  CMF.mountRecipeInventory = function (root, recipe, factor) {
    if (!root) return;
    const prefix = "cmf-inventory-use-" + (++mountId);
    const needs = CMF.inventoryRecipeNeeds(recipe, factor);
    const available = availableByName(CMF.getInventory());
    let preview = null;
    let previewRequests = "";
    let receipt = null;
    root.classList.add("cmf-inventory");
    root.setAttribute("aria-labelledby", prefix + "-title");
    root.innerHTML =
      '<div class="inventory-panel inventory-recipe-panel">' +
      `<h2 id="${prefix}-title">库存扣减</h2>` +
      `<p class="inventory-note">按当前 ${CMF.esc(factor)} 倍份量核对整道菜用量。扣减不新增打卡，打卡也不会自动扣减库存。</p>` +
      `<p class="inventory-note" id="${prefix}-help">个、勺等单位换算仅为估算，请确认实际称重。可选食材、未知克数和暂无可扣库存的食材默认不勾选；未知量不会按固定克数扣减。</p>` +
      '<form class="inventory-use-form" novalidate>' +
      `<fieldset class="inventory-use-fields" aria-describedby="${prefix}-help"><legend>选择本次实际使用的食材</legend>` +
      '<ul class="inventory-use-list">' +
      (needs.length ? needs.map((need, index) => {
        const checked = !need.optional && need.grams != null && need.grams > 0 && (available.get(need.canonical) || 0) > 0;
        return `<li class="inventory-use-row" data-use-item="${index}">` +
          '<div><label class="inventory-use-choice">' +
          `<input type="checkbox" class="inventory-use-check"${checked ? " checked" : ""}>` +
          `<span>${CMF.esc(need.canonical)}</span></label>` +
          '<div class="inventory-use-meta">' +
          (need.optional ? '<span>可选 · </span>' : '') +
          (need.grams == null ? '<span>用量待实称 · </span>' : need.estimated ? '<span>估算用量 · </span>' : '') +
          '<span data-use-available></span></div></div>' +
          '<label class="inventory-field inventory-use-amount"><span>扣减克数（克）</span>' +
          `<input type="number" class="inventory-use-grams" min="0.1" max="1000000" step="0.1" inputmode="decimal" value="${CMF.esc(need.grams == null ? "" : need.grams)}" aria-label="${CMF.esc(need.canonical)}扣减克数" placeholder="实称后填写"></label></li>`;
      }).join("") : '<li class="inventory-empty">这道菜没有可核对的食材。</li>') +
      '</ul></fieldset>' +
      '<div class="inventory-actions"><button type="submit" class="btn btn-primary btn-sm" data-use-preview' + (needs.length ? '' : ' disabled') + '>预览扣减</button></div></form>' +
      messageHTML() +
      '<div class="inventory-preview" data-use-result></div>' +
      '<p class="inventory-note inventory-safety">先到期先用，未填日期的批次排最后；过期、已移除及零余量批次不参与扣减。日期不保证食品安全，包装要求与实际状态优先。</p>' +
      '</div>';

    const form = root.querySelector(".inventory-use-form");
    const fields = form.querySelector("fieldset");
    const previewButton = form.querySelector("[data-use-preview]");
    const output = root.querySelector("[data-use-result]");
    const rows = [...form.querySelectorAll("[data-use-item]")];

    function refreshAvailability() {
      const current = availableByName(CMF.getInventory());
      rows.forEach((row, index) => {
        const grams = current.get(needs[index].canonical) || 0;
        row.querySelector("[data-use-available]").innerHTML = grams > 0 ? "未过期记录 " + gramsText(grams) : "暂无可扣库存";
      });
    }

    function readRequests() {
      return rows.filter((row) => row.querySelector(".inventory-use-check").checked).map((row) => ({
        canonical: needs[Number(row.dataset.useItem)].canonical,
        grams: readGrams(row.querySelector(".inventory-use-grams"), false),
      }));
    }

    function clearPreview() {
      const hadPreview = !!preview;
      preview = null;
      previewRequests = "";
      if (!receipt) output.innerHTML = "";
      if (hadPreview) announce(root, "用量已变化，旧预览已清除，请重新预览扣减。");
    }

    form.oninput = form.onchange = clearPreview;

    function recheck(text) {
      preview = null;
      previewRequests = "";
      receipt = null;
      output.innerHTML = "";
      fields.disabled = false;
      previewButton.hidden = false;
      previewButton.disabled = !needs.length;
      rows.forEach((row) => { row.querySelector(".inventory-use-check").checked = false; });
      refreshAvailability();
      announce(root, text);
      if (rows.length) rows[0].querySelector(".inventory-use-check").focus();
    }

    function commit() {
      if (!preview || !preview.ok || receipt) return;
      const total = preview.totalGrams;
      try {
        if (JSON.stringify(readRequests()) !== previewRequests) throw new Error("用量已变化，请重新预览。");
        receipt = CMF.commitInventoryUse(preview);
      } catch (error) {
        clearPreview();
        announce(root, "扣减失败：" + errorText(error) + " 选项与克数已保留，请重新预览。", true);
        return;
      }
      preview = null;
      previewRequests = "";
      fields.disabled = true;
      previewButton.disabled = true;
      previewButton.hidden = true;
      output.innerHTML =
        `<p class="inventory-use-success">已扣减 <strong>${gramsText(total)}</strong>，未新增打卡。</p>` +
        '<div class="inventory-actions"><button type="button" class="btn btn-sm" data-use-undo>撤销本次扣减</button>' +
        '<button type="button" class="btn btn-sm" data-use-recheck>重新核对</button></div>' +
        '<p class="inventory-note">后续库存变动可能使撤销失效；重新核对会开始另一笔扣减，并结束本次撤销入口。</p>';
      announce(root, "库存已扣减；同一预览不能再次提交。");
      refreshAvailability();
      const undo = output.querySelector("[data-use-undo]");
      undo.onclick = () => {
        if (!receipt) return;
        try {
          if (CMF.undoInventoryUse(receipt) !== true) throw new Error("未能撤销，请重试。");
        } catch (error) {
          announce(root, "撤销失败：" + errorText(error) + " 不会覆盖后续库存，请到台账核对。", true);
          return;
        }
        recheck("已撤销本次扣减，打卡不受影响。如需再次扣减，请重新勾选并预览。");
      };
      output.querySelector("[data-use-recheck]").onclick = () => recheck("已开启新一轮核对，请重新勾选要扣减的食材；上一笔扣减仍保留。");
      undo.focus();
    }

    form.onsubmit = (event) => {
      event.preventDefault();
      if (receipt) return;
      clearPreview();
      let snapshot;
      try {
        const requests = readRequests();
        snapshot = CMF.getInventory();
        preview = CMF.previewInventoryUse(snapshot, requests);
        previewRequests = JSON.stringify(requests);
      } catch (error) {
        announce(root, "无法预览：" + errorText(error) + " 选项与克数已保留。", true);
        return;
      }
      if (!preview.requests.length) {
        announce(root, "请先勾选本次使用的食材，并填写实际克数。", true);
        return;
      }
      const byId = new Map(CMF.normalizeInventory(snapshot).batches.map((batch) => [batch.id, batch]));
      output.innerHTML =
        `<h3>扣减预览 <small>${CMF.esc(preview.day)}</small></h3>` +
        '<ul class="inventory-preview-lines">' + preview.lines.map((line) => {
          const allocations = line.allocations.map((allocation) => {
            const batch = byId.get(allocation.id);
            return '<li>' +
              `批次 ${CMF.esc(allocation.id)} · ` +
              (batch ? `${CMF.esc(batch.expiresOn || "未填日期")} · ${CMF.esc(LOCATIONS[batch.location])} · ` : '') +
              gramsText(allocation.grams) + '</li>';
          }).join("");
          return '<li class="inventory-preview-line">' +
            `<div><strong>${CMF.esc(line.canonical)}</strong><span>本次 ${gramsText(line.grams)} / 可扣 ${gramsText(line.available)}</span></div>` +
            (line.missing > 0 ? `<p class="inventory-shortage">短缺 ${gramsText(line.missing)}，本次不能提交。</p>` : '') +
            (line.expiredGrams > 0 ? `<p class="inventory-note">已排除过期 ${gramsText(line.expiredGrams)}</p>` : '') +
            (allocations ? '<details class="inventory-allocations"><summary>查看批次分配（先到期先用）</summary><ul>' + allocations + '</ul></details>' : '') + '</li>';
        }).join("") + '</ul>' +
        `<p>本次合计 <strong>${gramsText(preview.totalGrams)}</strong>；仅扣减所勾选食材。</p>` +
        (preview.ok ? '<button type="button" class="btn btn-primary btn-sm" data-use-commit>确认扣减</button>' : '<p class="inventory-shortage">库存不足，未扣减任何批次。请调整用量或补充台账后重新预览。</p>');
      announce(root, preview.ok ? "预览已生成，尚未扣减。请核对克数和批次后确认。" : "预览发现短缺，未扣减。选项与克数已保留。", !preview.ok);
      const confirmButton = output.querySelector("[data-use-commit]");
      if (confirmButton) confirmButton.onclick = commit;
      refreshAvailability();
    };
    refreshAvailability();
  };
})();
