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
    const profile = CMF.sanitizeGoalProfile(stored ? stored.profile || stored : CMF.DEFAULT_GOAL_PROFILE);
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

  function fallbackCopy(text, onDone) {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    try {
      document.execCommand("copy");
      onDone();
    } catch (e) {
      CMF.toast("复制失败，请手动选择文本");
    }
    document.body.removeChild(ta);
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
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(done).catch(() => fallbackCopy(text, done));
      } else {
        fallbackCopy(text, done);
      }
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
      "<p>导出冰箱、偏好、收藏和计划，换浏览器或设备时可恢复。</p>" +
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

  function renderAll() {
    renderFridge();
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
  }

  CMF.boots("fridge.html", renderAll);
})();
