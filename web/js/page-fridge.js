/* My fridge: saved ingredients, history, share card. */
(function () {
  "use strict";

  const CMF = window.CMF;
  const fridgeRoot = document.getElementById("fridge-content");
  const historyRoot = document.getElementById("history-content");
  const shareRoot = document.getElementById("share-card");

  function renderFridge() {
    const list = CMF.getFridge();
    if (!list.length) {
      fridgeRoot.innerHTML = '<div class="empty">冰箱是空的，去 <a href="index.html">首页</a> 点几样食材。</div>';
      return;
    }
    const urgent = new Set(CMF.getUrgent());
    fridgeRoot.innerHTML =
      '<div class="chip-grid" style="grid-template-columns:repeat(auto-fill,minmax(140px,1fr))">' +
      list
        .map(
          (c) =>
            `<span class="chip selected ${urgent.has(c) ? "urgent" : ""}" style="cursor:default">${CMF.emojiOf(c)} <span class="name">${CMF.esc(c)}</span>` +
            `<span class="urg" data-name="${CMF.esc(c)}" title="标记快过期，优先消耗" style="cursor:pointer">⏰</span>` +
            `<span class="x" data-name="${CMF.esc(c)}" style="cursor:pointer">×</span></span>`
        )
        .join("") +
      "</div>" +
      '<p class="hint" style="margin:10px 0 0">点 ⏰ 标记快过期，清冰箱方案会优先消耗这些食材。</p>' +
      '<div style="margin-top:14px;display:flex;gap:9px;flex-wrap:wrap">' +
      `<a class="btn btn-primary btn-sm" href="result.html?i=${CMF.encodeSelected(list)}">用这些食材开饭</a>` +
      '<button class="btn btn-sm" id="btn-clear-fridge">清空冰箱</button></div>';

    fridgeRoot.querySelectorAll(".x").forEach((x) => {
      x.onclick = () => {
        const next = CMF.getFridge().filter((c) => c !== x.dataset.name);
        CMF.setFridge(next);
        const u = CMF.getUrgent().filter((c) => c !== x.dataset.name);
        CMF.setUrgent(u);
        renderAll();
      };
    });
    fridgeRoot.querySelectorAll(".urg").forEach((b) => {
      b.onclick = () => {
        CMF.toggleUrgent(b.dataset.name);
        renderAll();
      };
    });
    fridgeRoot.querySelector("#btn-clear-fridge").onclick = () => {
      CMF.setFridge([]);
      CMF.setUrgent([]);
      renderAll();
    };
  }

  function renderHistory() {
    const history = CMF.getHistory();
    if (!history.length) {
      historyRoot.innerHTML = '<div class="empty">还没有开饭记录。</div>';
      return;
    }
    historyRoot.innerHTML =
      history
        .map(
          (h) =>
            '<div class="history-item">' +
            `<div style="color:var(--ink-soft);font-size:12.5px">${new Date(h.date).toLocaleString()}</div>` +
            `<div>${h.selected.map((c) => CMF.esc(c)).join("、")}</div>` +
            `<a href="result.html?i=${CMF.encodeSelected(h.selected)}">再开一局</a></div>`
        )
        .join("") +
      '<button class="btn btn-sm" id="btn-clear-history" style="margin-top:10px">清空历史</button>';
    historyRoot.querySelector("#btn-clear-history").onclick = () => {
      CMF.clearHistory();
      renderAll();
    };
  }

  function renderShare() {
    const list = CMF.getFridge();
    if (!list.length) {
      shareRoot.innerHTML = "";
      return;
    }
    const result = CMF.search(CMF.data.recipes, list);
    const canMake = result.cookNow.length;
    const shareURL = location.origin + location.pathname.replace("fridge.html", "result.html") +
      "?i=" + CMF.encodeSelected(list);
    shareRoot.innerHTML =
      '<div class="share-card">' +
      '<div>我的冰箱能开</div>' +
      `<div class="big">${canMake} 局</div>` +
      '<div style="margin:12px 0">别点外卖，让冰箱开饭。</div>' +
      `<button class="btn btn-sm" id="btn-copy">复制分享链接</button></div>`;
    shareRoot.querySelector("#btn-copy").onclick = async () => {
      try {
        await navigator.clipboard.writeText(shareURL);
        CMF.toast("分享链接已复制");
      } catch (e) {
        CMF.toast("复制失败，手动复制地址栏链接吧");
      }
    };
  }

  const PREF_OPTIONS = [
    ["素食", "🥬 只看素食"],
    ["低卡", "🥗 低卡"],
    ["减脂餐", "🏃 减脂餐"],
    ["快手", "⚡ 快手"],
  ];

  function renderPrefs() {
    const prefs = CMF.getPrefs();
    const active = new Set(prefs.tags || []);
    const root = document.getElementById("prefs-content");
    root.innerHTML =
      '<div class="chip-grid">' +
      PREF_OPTIONS.map(
        ([tag, label]) =>
          `<span class="chip ${active.has(tag) ? "selected" : ""}" data-tag="${tag}" style="justify-content:center">${label}</span>`
      ).join("") +
      "</div>";
    root.querySelectorAll(".chip").forEach((chip) => {
      chip.onclick = () => {
        const current = new Set(CMF.getPrefs().tags || []);
        const tag = chip.dataset.tag;
        if (current.has(tag)) current.delete(tag);
        else current.add(tag);
        // Read-modify-write: overwriting prefs here used to erase allergens.
        const next = CMF.getPrefs();
        next.tags = [...current];
        CMF.setPrefs(next);
        renderPrefs();
      };
    });
  }

  function renderDiets() {
    const root = document.getElementById("diets-content");
    if (!root) return;
    const options = CMF.DIETS || [];
    if (!options.length) {
      root.innerHTML = '<div class="empty">饮食偏好模块未加载。</div>';
      return;
    }
    const active = new Set(CMF.getDiets());
    root.innerHTML =
      '<div class="chip-grid">' +
      options
        .map(
          (d) =>
            `<button type="button" class="chip diet-chip${active.has(d.key) ? " selected" : ""}" data-diet="${d.key}" title="${CMF.esc(d.desc)}" style="justify-content:center">` +
            `${d.emoji} ${CMF.esc(d.label)}</button>`
        )
        .join("") +
      "</div>" +
      '<p class="diet-note">筛选规则为保守筛查，结果页、菜谱浏览与一周菜单会同步生效；仍请核对食品包装标签，不能替代专业医疗建议。</p>';
    root.querySelectorAll(".diet-chip").forEach((chip) => {
      chip.onclick = () => {
        CMF.toggleDiet(chip.dataset.diet);
        renderDiets();
      };
    });
  }

  function goalSelect(id, label, options, current) {
    return (
      `<label class="goal-field"><span>${label}</span><select id="${id}">` +
      options.map(
        ([key, text]) =>
          `<option value="${CMF.esc(key)}"${key === current ? " selected" : ""}>${CMF.esc(text)}</option>`
      ).join("") +
      "</select></label>"
    );
  }

  function goalNumber(id, label, value, min, max) {
    return (
      `<label class="goal-field"><span>${label}</span>` +
      `<input type="number" id="${id}" value="${value}" min="${min}" max="${max}"></label>`
    );
  }

  function renderGoals() {
    const root = document.getElementById("goals-content");
    if (!root) return;
    if (typeof CMF.computeGoals !== "function") {
      root.innerHTML = '<div class="empty">营养目标模块未加载。</div>';
      return;
    }
    const stored = CMF.getGoals ? CMF.getGoals() : null;
    const enabled = !!(stored && stored.enabled);
    const profile = CMF.sanitizeGoalProfile(stored ? stored.profile || stored.p || stored : CMF.DEFAULT_GOAL_PROFILE);
    const goals = CMF.computeGoals(profile);
    root.innerHTML =
      '<div class="goal-box">' +
      '<p class="goal-intro">按身高体重与活动量估算每日热量和三大营养素目标，' +
      '用于菜单评分与「占目标百分比」对照。数据只保存在本机，不上传。</p>' +
      '<div class="goal-form">' +
      goalSelect("goal-sex", "性别", (CMF.GOAL_SEX || []).map((s) => [s.key, s.label]), profile.sex) +
      goalNumber("goal-age", "年龄", profile.age, 10, 100) +
      goalNumber("goal-height", "身高 cm", profile.heightCm, 120, 220) +
      goalNumber("goal-weight", "体重 kg", profile.weightKg, 30, 200) +
      goalSelect("goal-activity", "活动量", (CMF.GOAL_ACTIVITY || []).map((a) => [a.key, a.label]), profile.activity) +
      goalSelect("goal-mode", "目标", (CMF.GOAL_MODES || []).map((m) => [m.key, m.label]), profile.mode) +
      goalNumber("goal-people", "用餐人数", profile.people, 1, 12) +
      goalSelect("goal-meals", "每日规划餐数", [[1, "1 餐"], [2, "2 餐（午/晚）"], [3, "3 餐"], [4, "4 餐"]], profile.mealsPerDay) +
      "</div>" +
      '<div class="goal-actions">' +
      '<button class="btn btn-primary btn-sm" id="goal-save">保存并启用</button>' +
      '<button class="btn btn-sm" id="goal-clear">关闭目标</button>' +
      `<span class="goal-state">当前：${enabled ? "已启用 ✓" : "未启用（按通用参考范围评分）"}</span>` +
      "</div></div>" +
      (enabled ? CMF.renderGoalsSummary(goals) : "");

    root.querySelector("#goal-save").onclick = () => {
      const val = (id) => root.querySelector(id).value;
      const next = {
        enabled: true,
        sex: val("#goal-sex"),
        age: val("#goal-age"),
        heightCm: val("#goal-height"),
        weightKg: val("#goal-weight"),
        activity: val("#goal-activity"),
        mode: val("#goal-mode"),
        people: val("#goal-people"),
        mealsPerDay: val("#goal-meals"),
      };
      CMF.setGoals({ enabled: true, profile: CMF.sanitizeGoalProfile(next) });
      CMF.toast("营养目标已保存并启用");
      renderGoals();
    };
    root.querySelector("#goal-clear").onclick = () => {
      if (CMF.clearGoals) CMF.clearGoals();
      CMF.toast("已关闭个性化营养目标");
      renderGoals();
    };
  }

  const ALLERGEN_OPTIONS = ["花生", "牛奶", "鸡蛋", "鱼", "甲壳类", "大豆", "麸质"];

  function renderAllergens() {
    const prefs = CMF.getPrefs();
    const active = new Set(prefs.allergens || []);
    const root = document.getElementById("allergen-content");
    root.innerHTML =
      '<div class="chip-grid">' +
      ALLERGEN_OPTIONS.map(
        (a) =>
          `<span class="chip ${active.has(a) ? "selected" : ""}" data-allergen="${a}" style="justify-content:center">${a}</span>`
      ).join("") +
      "</div>";
    root.querySelectorAll(".chip").forEach((chip) => {
      chip.onclick = () => {
        const current = new Set(CMF.getPrefs().allergens || []);
        const a = chip.dataset.allergen;
        if (current.has(a)) current.delete(a);
        else current.add(a);
        const next = CMF.getPrefs();
        next.allergens = [...current];
        CMF.setPrefs(next);
        renderAllergens();
      };
    });
  }

  function renderFavorites() {
    const root = document.getElementById("favorites-content");
    const ids = CMF.getFavorites();
    if (!ids.length) {
      root.innerHTML = '<div class="empty">还没有收藏，点菜谱上的 ♡ 收藏起来。</div>';
      return;
    }
    const ai = CMF.data.ai;
    const all = [].concat(
      CMF.data.recipes,
      ai.wildcards,
      ai.blindboxes,
      ai.variants
    );
    const byId = new Map(all.map((r) => [r.id, r]));
    root.innerHTML =
      '<ul style="margin:0;display:flex;flex-direction:column;gap:6px">' +
      ids
        .map((id) => {
          const r = byId.get(id);
          if (!r) return "";
          const isAi = r.is_ai_generated;
          const href = isAi
            ? "wildcard.html?key=" + encodeURIComponent(r.id)
            : "recipe.html?id=" + encodeURIComponent(r.id);
          return `<li><a href="${href}">${CMF.emojiOf(r.ingredients[0] ? r.ingredients[0].canonical : "")} ${CMF.esc(r.title)}</a>
            <button class="btn btn-sm fav-remove" data-remove="${CMF.esc(id)}" style="padding:2px 8px;margin-left:6px">移除</button></li>`;
        })
        .join("") +
      "</ul>";
    root.querySelectorAll(".fav-remove").forEach((btn) => {
      btn.onclick = () => {
        CMF.toggleFavorite(btn.dataset.remove);
        renderFavorites();
      };
    });
  }

  function renderPlan() {
    const root = document.getElementById("plan-content");
    const plan = CMF.getPlan();
    const fridge = new Set(CMF.getFridge());
    const byId = new Map(CMF.data.recipes.map((r) => [r.id, r]));
    const chosen = plan.recipeIds.map((id) => byId.get(id)).filter(Boolean);
    if (!chosen.length) {
      root.innerHTML =
        '<div class="empty">还没有计划。去 <a href="result.html">结果页</a> 把想做的菜「加入计划」。</div>';
      return;
    }
    const need = new Map();
    const recipeLines = chosen
      .map((r) => {
        const m = CMF.matchRecipe(r, fridge);
        m.missing.forEach((c) => {
          if (!need.has(c)) need.set(c, []);
          need.get(c).push(r.title);
        });
        return `<li><a href="recipe.html?id=${r.id}">${CMF.esc(r.title)}</a>（缺 ${m.missing.length} 样）</li>`;
      })
      .join("");
    const checked = new Set(plan.checked || []);
    const shopItems = [...need.keys()]
      .sort()
      .map((c) => {
        const done = checked.has(c);
        return (
          `<label style="display:flex;gap:8px;align-items:center;${done ? "opacity:.55;text-decoration:line-through" : ""}">` +
          `<input type="checkbox" data-item="${CMF.esc(c)}" ${done ? "checked" : ""}>` +
          `${CMF.emojiOf(c)} ${CMF.esc(c)} <span style="color:var(--ink-soft);font-size:12px">用于 ${need.get(c).length} 道菜</span></label>`
        );
      })
      .join("");
    root.innerHTML =
      "<ul style='margin:0 0 12px'>" + recipeLines + "</ul>" +
      "<h3 style='margin:6px 0'>需要采购</h3>" +
      '<button class="btn btn-sm" id="copy-list" style="margin-bottom:8px">📋 复制清单</button>' +
      '<div style="display:flex;flex-direction:column;gap:7px">' + shopItems + "</div>";
    const copyBtn = root.querySelector("#copy-list");
    copyBtn.onclick = () => {
      const text =
        "CookMyFridge 采购清单\n" +
        [...need.keys()].sort().map((c) => `- ${c}（用于 ${need.get(c).length} 道菜）`).join("\n");
      const done = () => {
        copyBtn.textContent = "✓ 已复制";
        setTimeout(() => (copyBtn.textContent = "📋 复制清单"), 1500);
      };
      CMF.copyText(text).then((ok) => {
        if (ok) done();
        else CMF.toast("复制失败，请手动选择文本");
      });
    };
    root.querySelectorAll("input[data-item]").forEach((box) => {
      box.onchange = () => {
        const current = CMF.getPlan();
        const set = new Set(current.checked || []);
        const item = box.dataset.item;
        if (box.checked) set.add(item);
        else set.delete(item);
        current.checked = [...set];
        CMF.setPlan(current);
        renderPlan();
      };
    });
  }

  function renderBackup() {
    const root = document.getElementById("backup-content");
    root.innerHTML =
      '<div class="backup-box">' +
      "<p>导出冰箱、偏好、收藏、计划、打卡和库存台账，换浏览器或设备时可恢复。</p>" +
      '<div style="display:flex;gap:9px;flex-wrap:wrap">' +
      '<button class="btn btn-sm" id="btn-export">下载备份文件</button>' +
      '<label class="btn btn-sm" style="cursor:pointer">导入备份' +
      '<input type="file" id="file-import" accept="application/json,.json" style="display:none"></label>' +
      "</div></div>";

    root.querySelector("#btn-export").onclick = () => {
      const payload = JSON.stringify(CMF.exportData(), null, 2);
      const blob = new Blob([payload], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "cookmyfridge-backup.json";
      a.click();
      URL.revokeObjectURL(url);
      CMF.toast("备份文件已下载");
    };

    root.querySelector("#file-import").onchange = (ev) => {
      const file = ev.target.files && ev.target.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => {
        try {
          const parsed = JSON.parse(reader.result);
          const count = CMF.importData(parsed);
          CMF.toast("已恢复 " + count + " 项数据");
          renderAll();
        } catch (e) {
          CMF.toast("导入失败：" + e.message);
        }
      };
      reader.readAsText(file);
    };
  }

  function renderSync() {
    const root = document.getElementById("sync-content");
    if (!root) return;
    if (!CMF.syncPayload || !CMF.syncEncode) {
      root.innerHTML = '<div class="empty">同步模块未加载。</div>';
      return;
    }
    const stats = CMF.getShareStats ? CMF.getShareStats() : { total: 0, byKind: {} };
    const kinds = Object.entries(stats.byKind || {})
      .sort((a, b) => b[1] - a[1]).slice(0, 3)
      .map(([kind, count]) => `${CMF.esc(kind)} ${count} 次`).join(" · ") || "暂无";
    root.innerHTML =
      '<div class="sync-box">' +
      '<p class="sync-intro">把冰箱、偏好、收藏、菜单、营养目标、打卡和库存台账打包成同步码或文件，' +
      '在另一台设备粘贴 / 扫码 / 导入即可恢复。全部在本机完成，不需要账号与服务器。</p>' +
      '<div class="sync-actions">' +
      '<button class="btn btn-primary btn-sm" id="sync-generate">🔗 生成同步码与二维码</button>' +
      '<button class="btn btn-sm" id="sync-download">⬇️ 下载同步文件</button>' +
      '<label class="btn btn-sm" style="cursor:pointer">📂 导入同步文件' +
      '<input type="file" id="sync-file" accept="application/json,.json" style="display:none"></label>' +
      "</div>" +
      '<div id="sync-code-area"></div>' +
      '<div class="sync-import">' +
      '<label class="sync-field"><span>从同步码导入</span>' +
      '<textarea id="sync-input" rows="2" placeholder="粘贴 S1. / S1Z. / Z. / R. 开头的同步码"></textarea></label>' +
      '<div class="sync-import-actions">' +
      '<select id="sync-mode"><option value="merge">合并（保留本机数据）</option>' +
      '<option value="replace">覆盖本机同名数据</option></select>' +
      '<button class="btn btn-sm" id="sync-apply">导入</button></div></div>' +
      `<div class="sync-stats">📊 本地分享统计：共 ${stats.total} 次 · ${kinds}` +
      `${stats.lastAt ? " · 最近 " + CMF.esc(stats.lastAt.slice(0, 10)) : ""}</div>` +
      "</div>";

    root.querySelector("#sync-generate").onclick = () => {
      const full = CMF.syncPayload({});
      const slim = CMF.syncPayload({ slim: true });
      const code = CMF.syncEncode(full);
      const link = CMF.syncShareURL(code);
      const info = CMF.syncQRInfo
        ? CMF.syncQRInfo(slim, { url: new URL(".", location.href).href })
        : null;
      const area = root.querySelector("#sync-code-area");
      area.innerHTML =
        '<div class="sync-result">' +
        '<label class="sync-field"><span>完整同步码（含菜单）</span>' +
        `<textarea id="sync-code" rows="3" readonly>${CMF.esc(code)}</textarea></label>` +
        '<div class="sync-actions">' +
        '<button class="btn btn-sm" id="sync-copy-code">📋 复制同步码</button>' +
        '<button class="btn btn-sm" id="sync-copy-link">🔗 复制同步链接</button>' +
        "</div>" +
        '<div class="sync-qr-row"><div id="sync-qr"></div>' +
        '<p class="sync-note">二维码用于快速同步冰箱、偏好、收藏与营养目标（不含菜单、打卡与库存台账）；' +
        (info && info.trimmed ? "数据量较大，已自动精简为偏好与目标。" : "") +
        "扫码打开后会先询问是否合并。完整数据请用同步码或同步文件。</p></div>" +
        "</div>";
      area.querySelector("#sync-copy-code").onclick = () =>
        CMF.copyText(code).then((ok) => CMF.toast(ok ? "同步码已复制" : "复制失败，请手动选择"));
      area.querySelector("#sync-copy-link").onclick = () =>
        CMF.copyText(link).then((ok) => CMF.toast(ok ? "同步链接已复制" : "复制失败，请手动选择"));
      const holder = area.querySelector("#sync-qr");
      if (info && info.fits && typeof CMF.drawQR === "function" && holder) {
        try {
          // A dense high-version symbol needs >=3px modules to stay scannable;
          // a fixed 220px canvas would squeeze them to 1-2px on a phone camera.
          const modules = info.modules || (info.version ? info.version * 4 + 17 : 21);
          const box = Math.min(600, (modules + 8) * 3);
          const canvas = document.createElement("canvas");
          canvas.width = box;
          canvas.height = box;
          canvas.style.maxWidth = "100%";
          canvas.style.height = "auto";
          const ctx = canvas.getContext("2d");
          if (ctx) {
            CMF.drawQR(ctx, info.url, 0, 0, box, { light: "#ffffff", dark: "#2c2620" });
            holder.appendChild(canvas);
          }
        } catch (e) {
          holder.innerHTML = '<div class="empty">二维码生成失败，请改用同步码。</div>';
        }
      } else if (holder) {
        holder.innerHTML = '<div class="empty">数据量过大，二维码放不下；请用同步码或同步文件。</div>';
      }
    };

    root.querySelector("#sync-download").onclick = () => {
      const payload = JSON.stringify(CMF.syncPayload({}), null, 2);
      const blob = new Blob([payload], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "cookmyfridge-sync.json";
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      CMF.toast("同步文件已下载");
    };

    root.querySelector("#sync-file").onchange = (ev) => {
      const file = ev.target.files && ev.target.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => {
        try {
          const report = CMF.applySyncPayload(
            JSON.parse(reader.result),
            { mode: root.querySelector("#sync-mode").value }
          );
          CMF.toast(report.failed && report.failed.length
            ? `已同步 ${report.count} 项，${report.failed.length} 项写入失败（存储不可用或已满）`
            : `已同步 ${report.count} 项数据`);
          renderAll();
        } catch (e) {
          CMF.toast("导入失败：" + e.message);
        }
      };
      reader.readAsText(file);
    };

    root.querySelector("#sync-apply").onclick = () => {
      try {
        const payload = CMF.syncDecode(root.querySelector("#sync-input").value);
        const report = CMF.applySyncPayload(payload, {
          mode: root.querySelector("#sync-mode").value,
        });
        CMF.toast(report.failed && report.failed.length
          ? `已同步 ${report.count} 项，${report.failed.length} 项写入失败（存储不可用或已满）`
          : `已同步 ${report.count} 项数据`);
        renderAll();
      } catch (e) {
        CMF.toast("导入失败：" + e.message);
      }
    };
  }

  function renderCleanout() {
    const root = document.getElementById("cleanout-content");
    const fridge = CMF.getFridge();
    if (!fridge.length) {
      root.innerHTML = '<div class="empty">先在冰箱里放些食材，再生成清冰箱方案。</div>';
      return;
    }
    const plan = CMF.cleanoutPlan(CMF.data.recipes, fridge, {
      maxRecipes: 4,
      maxExtra: 3,
      urgent: CMF.getUrgent(),
    });
    if (!plan.selected.length) {
      root.innerHTML = '<div class="empty">暂无能消耗这些食材的菜谱组合。</div>';
      return;
    }
    const dishes = plan.selected
      .map(
        (s) =>
          `<li><a href="recipe.html?id=${encodeURIComponent(s.recipeId)}">${CMF.esc(s.title)}</a>
            <span class="shop-meta">用掉 ${s.addedCoverage.length} 样${s.missing.length ? "，需补 " + s.missing.map((c) => CMF.esc(c)).join("、") : ""}</span></li>`
      )
      .join("");
    const pct = plan.totalFridge ? Math.round((plan.coveredCount / plan.totalFridge) * 100) : 0;
    const unused = plan.unusedFridge.length
      ? plan.unusedFridge.map((c) => CMF.emojiOf(c) + " " + CMF.esc(c)).join("、")
      : "无";
    root.innerHTML =
      `<div class="cleanout-summary">这套组合能消耗 <strong>${plan.coveredCount}/${plan.totalFridge}</strong> 样冰箱食材（${pct}%），剩余：${unused}</div>` +
      '<ul class="cleanout-list">' + dishes + "</ul>";
  }

  function offProductHTML(p) {
    const nut = p.per100g
      ? `<span class="off-nut">每100g：${p.per100g.kcal != null ? p.per100g.kcal + " kcal" : "—"} · 蛋白 ${p.per100g.protein != null ? p.per100g.protein + "g" : "—"} · 脂肪 ${p.per100g.fat != null ? p.per100g.fat + "g" : "—"} · 碳水 ${p.per100g.carbs != null ? p.per100g.carbs + "g" : "—"}</span>`
      : '<span class="off-nut">暂无营养数据</span>';
    const score = p.nutriscore
      ? `<span class="nutriscore ns-${p.nutriscore}">Nutri-Score ${p.nutriscore.toUpperCase()}</span>`
      : "";
    return (
      '<div class="off-product">' +
      (p.image ? `<img class="off-img" src="${CMF.esc(p.image)}" alt="" loading="lazy">` : "") +
      '<div class="off-body">' +
      `<a class="off-name" href="${CMF.esc(p.url)}" target="_blank" rel="noopener">${CMF.esc(p.name)}</a>` +
      (p.brands.length ? `<span class="off-brands">${CMF.esc(p.brands.join(" / "))}</span>` : "") +
      score + nut +
      (p.barcode ? `<span class="off-barcode">条码 ${CMF.esc(p.barcode)}</span>` : "") +
      "</div></div>"
    );
  }

  function renderFoodfacts() {
    const root = document.getElementById("foodfacts-content");
    if (!root) return;
    if (!CMF.searchOffProducts) {
      root.innerHTML = '<div class="empty">包装食品查询模块未加载。</div>';
      return;
    }
    const recent = CMF.offRecent ? CMF.offRecent() : [];
    const recentHtml = recent.length
      ? '<div class="off-recent">最近：' +
        recent.map((r) => `<button class="chip chip-sm" data-off-recent="${CMF.esc(r.query)}">${CMF.esc(r.query)}</button>`).join("") +
        "</div>"
      : "";
    const canScan = typeof window.BarcodeDetector === "function";
    root.innerHTML =
      '<div class="off-box">' +
      '<p class="off-intro">查询包装食品的营养成分（每100g）。数据来自 <a href="https://world.openfoodfacts.org" target="_blank" rel="noopener">Open Food Facts</a>（免费开放数据库，ODbL 授权），需联网；结果仅供参考，请以包装标签为准。</p>' +
      '<div class="off-row">' +
      '<input type="search" id="off-query" placeholder="输入食品名，如：燕麦片、牛奶…" autocomplete="off">' +
      '<button class="btn btn-primary btn-sm" id="off-search">搜索</button>' +
      "</div>" +
      '<div class="off-row">' +
      '<input type="text" id="off-barcode" inputmode="numeric" placeholder="或输入条码（8–14 位数字）" autocomplete="off">' +
      '<button class="btn btn-sm" id="off-lookup">查条码</button>' +
      (canScan ? '<button class="btn btn-sm" id="off-scan">📷 扫码</button>' : "") +
      "</div>" +
      recentHtml +
      '<div id="off-status" class="off-status"></div>' +
      '<div id="off-results"></div>' +
      "</div>";

    const status = root.querySelector("#off-status");
    const results = root.querySelector("#off-results");
    const queryInput = root.querySelector("#off-query");

    async function runSearch(text) {
      const q = String(text || "").trim();
      if (!q) return;
      status.textContent = "正在搜索「" + q + "」…";
      results.innerHTML = "";
      try {
        const products = await CMF.searchOffProducts(q);
        if (CMF.offRemember) CMF.offRemember(q, products[0] ? products[0].name : "");
        status.textContent = products.length ? "找到 " + products.length + " 个结果：" : "没找到匹配食品，换个关键词试试。";
        results.innerHTML = products.map(offProductHTML).join("");
      } catch (e) {
        status.innerHTML = '<span class="weather-note">查询失败（' + CMF.esc(e.message) + '）。该功能需联网，离线时不可用。</span>';
      }
    }

    async function runBarcode(code) {
      const clean = String(code || "").trim();
      if (!CMF.validBarcode(clean)) {
        status.textContent = "条码应为 8–14 位数字。";
        return;
      }
      status.textContent = "正在查询条码 " + clean + "…";
      results.innerHTML = "";
      try {
        const product = await CMF.lookupOffBarcode(clean);
        if (!product) {
          status.textContent = "数据库里没有这个条码。";
          return;
        }
        if (CMF.offRemember) CMF.offRemember(clean, product.name);
        status.textContent = "查询结果：";
        results.innerHTML = offProductHTML(product);
      } catch (e) {
        status.innerHTML = '<span class="weather-note">查询失败（' + CMF.esc(e.message) + '）。该功能需联网。</span>';
      }
    }

    root.querySelector("#off-search").onclick = () => runSearch(queryInput.value);
    queryInput.addEventListener("keydown", (ev) => {
      if (ev.key === "Enter") runSearch(queryInput.value);
    });
    root.querySelector("#off-lookup").onclick = () => runBarcode(root.querySelector("#off-barcode").value);
    root.querySelectorAll("[data-off-recent]").forEach((btn) => {
      btn.onclick = () => {
        queryInput.value = btn.dataset.offRecent;
        runSearch(btn.dataset.offRecent);
      };
    });
    const scanBtn = root.querySelector("#off-scan");
    if (scanBtn) {
      scanBtn.onclick = async () => {
        status.textContent = "正在启动摄像头…";
        scanBtn.disabled = true;
        let stream;
        try {
          stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } });
          const video = document.createElement("video");
          video.srcObject = stream;
          video.setAttribute("playsinline", "");
          await video.play();
          const detector = new window.BarcodeDetector({ formats: ["ean_13", "ean_8", "upc_a", "upc_e", "code_128"] });
          let found = null;
          for (let i = 0; i < 40 && !found; i++) {
            const codes = await detector.detect(video);
            if (codes.length) found = codes[0].rawValue;
            else await new Promise((r) => setTimeout(r, 150));
          }
          if (found) {
            root.querySelector("#off-barcode").value = found;
            runBarcode(found);
          } else {
            status.textContent = "没扫到条码，请手动输入。";
          }
        } catch (e) {
          status.innerHTML = '<span class="weather-note">摄像头不可用（' + CMF.esc(e.message) + '），请手动输入条码。</span>';
        } finally {
          if (stream) stream.getTracks().forEach((t) => t.stop());
          scanBtn.disabled = false;
        }
      };
    }
  }

  function renderTools() {
    const root = document.getElementById("tools-content");
    if (!root) return;
    if (!CMF.volumeToMl) {
      root.innerHTML = '<div class="empty">厨房工具模块未加载。</div>';
      return;
    }
    const units = CMF.TOOL_UNITS || [];
    const ingredients = CMF.TOOL_DENSITY_INGREDIENTS || [];
    const unitOptions = units.map((u) => `<option value="${CMF.esc(u)}">${CMF.esc(u)}</option>`).join("");
    const ingOptions = ingredients.map((i) => `<option value="${CMF.esc(i)}">${CMF.esc(i)}</option>`).join("");
    const subsRows = (CMF.BAKING_SUBS || [])
      .map((s) => `<tr><td>${CMF.esc(s.from)}</td><td>${CMF.esc(s.to)}</td><td class="sub-note">${CMF.esc(s.note)}</td></tr>`)
      .join("");
    root.innerHTML =
      '<div class="tools-box">' +
      '<p class="tools-intro">家常厨房近似换算，仅供估算；密度因品牌与压实程度而异，精确烘焙请用厨房秤。</p>' +
      '<div class="tool-grid">' +
      '<div class="tool-card"><h4>🥄 体积换算</h4>' +
      '<div class="tool-row"><input type="number" id="tool-vol" value="1" min="0" step="0.5" aria-label="数量">' +
      `<select id="tool-unit" class="filter-select">${unitOptions}</select>` +
      `<select id="tool-ing" class="filter-select">${ingOptions}</select></div>` +
      '<div id="tool-vol-out" class="tool-out"></div></div>' +
      '<div class="tool-card"><h4>🌡️ 烤箱温度</h4>' +
      '<div class="tool-row"><input type="number" id="tool-temp" value="180" step="5" aria-label="温度">' +
      '<select id="tool-temp-unit" class="filter-select"><option value="C">°C</option><option value="F">°F</option></select></div>' +
      '<div id="tool-temp-out" class="tool-out"></div></div>' +
      "</div>" +
      '<h4 class="tool-sub-title">🧁 常见烘焙替代</h4>' +
      '<table class="subs-table"><thead><tr><th>原料</th><th>替代</th><th>备注</th></tr></thead><tbody>' +
      subsRows + "</tbody></table>" +
      "</div>";

    const volOut = root.querySelector("#tool-vol-out");
    function updateVolume() {
      const value = root.querySelector("#tool-vol").value;
      const unit = root.querySelector("#tool-unit").value;
      const ing = root.querySelector("#tool-ing").value;
      const ml = CMF.volumeToMl(value, unit);
      if (ml == null) {
        volOut.textContent = "请输入有效数量。";
        return;
      }
      const grams = CMF.gramsForVolume(ml, ing);
      volOut.innerHTML =
        `≈ <strong>${ml} ml</strong>` +
        (grams != null ? ` · ${CMF.esc(ing)}约 <strong>${grams} g</strong>` : ` · ${CMF.esc(ing)}暂无密度数据`);
    }
    const tempOut = root.querySelector("#tool-temp-out");
    function updateTemp() {
      const value = root.querySelector("#tool-temp").value;
      const unit = root.querySelector("#tool-temp-unit").value;
      if (unit === "C") {
        const f = CMF.cToF(value);
        tempOut.innerHTML = f == null ? "请输入有效温度。" : `≈ <strong>${f} °F</strong>`;
      } else {
        const c = CMF.fToC(value);
        tempOut.innerHTML = c == null ? "请输入有效温度。" : `≈ <strong>${c} °C</strong>`;
      }
    }
    ["#tool-vol", "#tool-unit", "#tool-ing"].forEach((sel) => {
      root.querySelector(sel).addEventListener("input", updateVolume);
      root.querySelector(sel).addEventListener("change", updateVolume);
    });
    ["#tool-temp", "#tool-temp-unit"].forEach((sel) => {
      root.querySelector(sel).addEventListener("input", updateTemp);
      root.querySelector(sel).addEventListener("change", updateTemp);
    });
    updateVolume();
    updateTemp();
  }

  function renderAll() {
    renderFridge();
    if (CMF.mountInventory) CMF.mountInventory(document.getElementById("inventory-content"), () => {
      renderFridge();
      renderCleanout();
      renderShare();
    });
    renderHistory();
    renderPrefs();
    renderDiets();
    renderGoals();
    renderAllergens();
    renderFavorites();
    renderCleanout();
    renderPlan();
    renderShare();
    renderBackup();
    renderSync();
    renderFoodfacts();
    renderTools();
  }

  CMF.boots("fridge.html", renderAll);
  // AI shards load on demand: only fetch them here when the favorites list
  // actually contains an AI card (an id no dataset recipe owns). Most visits
  // never pay the ~2 MB.
  const hasAiFavorite = CMF.getFavorites().some(
    (id) => !CMF.data.recipes.some((r) => r.id === id)
  );
  if (hasAiFavorite) CMF.onAiReady(() => renderFavorites());
})();
