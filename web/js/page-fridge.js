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
    fridgeRoot.innerHTML =
      '<div class="chip-grid" style="grid-template-columns:repeat(auto-fill,minmax(120px,1fr))">' +
      list
        .map(
          (c) =>
            `<span class="chip selected" style="cursor:default">${CMF.emojiOf(c)} <span class="name">${CMF.esc(c)}</span>` +
            `<span class="x" data-name="${CMF.esc(c)}" style="margin-left:auto;cursor:pointer">×</span></span>`
        )
        .join("") +
      "</div>" +
      '<div style="margin-top:14px;display:flex;gap:9px;flex-wrap:wrap">' +
      `<a class="btn btn-primary btn-sm" href="result.html?i=${CMF.encodeSelected(list)}">用这些食材开饭</a>` +
      '<button class="btn btn-sm" id="btn-clear-fridge">清空冰箱</button></div>';

    fridgeRoot.querySelectorAll(".x").forEach((x) => {
      x.onclick = () => {
        const next = CMF.getFridge().filter((c) => c !== x.dataset.name);
        CMF.setFridge(next);
        renderAll();
      };
    });
    fridgeRoot.querySelector("#btn-clear-fridge").onclick = () => {
      CMF.setFridge([]);
      renderAll();
    };
  }

  function renderHistory() {
    const history = CMF.getHistory();
    if (!history.length) {
      historyRoot.innerHTML = '<div class="empty">还没有开饭记录。</div>';
      return;
    }
    historyRoot.innerHTML = history
      .map(
        (h) =>
          '<div class="history-item">' +
          `<div style="color:var(--ink-soft);font-size:12.5px">${new Date(h.date).toLocaleString()}</div>` +
          `<div>${h.selected.map((c) => CMF.esc(c)).join("、")}</div>` +
          `<a href="result.html?i=${CMF.encodeSelected(h.selected)}">再开一局</a></div>`
      )
      .join("");
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
        CMF.setPrefs({ tags: [...current] });
        renderPrefs();
      };
    });
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
      '<div style="display:flex;flex-direction:column;gap:7px">' + shopItems + "</div>";
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

  function renderAll() {
    renderFridge();
    renderHistory();
    renderPrefs();
    renderAllergens();
    renderPlan();
    renderShare();
  }

  CMF.boots("fridge.html", renderAll);
})();
