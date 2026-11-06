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

  function renderAll() {
    renderFridge();
    renderHistory();
    renderPrefs();
    renderAllergens();
    renderShare();
  }

  CMF.boots("fridge.html", renderAll);
})();
