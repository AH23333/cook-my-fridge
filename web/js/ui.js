/* Shared UI helpers: escaping, toast, navigation, card rendering. */
(function () {
  "use strict";

  const CMF = (window.CMF = window.CMF || {});

  CMF.esc = function (s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  };

  CMF.scaleAmount = function (amount, factor) {
    const text = String(amount);
    const match = text.match(/^(\d+(?:\.\d+)?)(.*)$/);
    if (!match) return text; // non-numeric amounts such as 少许 / 半勺 stay unchanged
    const value = parseFloat(match[1]) * factor;
    const rounded = Math.round(value * 10) / 10;
    const shown = Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
    return shown + match[2];
  };

  CMF.formatTimer = function (totalSeconds) {
    const s = Math.max(0, Number(totalSeconds) || 0);
    const mm = String(Math.floor(s / 60)).padStart(2, "0");
    const ss = String(s % 60).padStart(2, "0");
    return mm + ":" + ss;
  };

  let toastTimer = null;
  CMF.toast = function (msg) {
    let node = document.querySelector(".toast");
    if (!node) {
      node = document.createElement("div");
      node.className = "toast";
      document.body.appendChild(node);
    }
    node.textContent = msg;
    requestAnimationFrame(() => node.classList.add("show"));
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => node.classList.remove("show"), 1800);
  };

  const NAV_ITEMS = [
    ["index.html", "开饭"],
    ["browse.html", "菜谱"],
    ["fridge.html", "我的冰箱"],
    ["planner.html", "一周菜单"],
    ["stats.html", "统计"],
    ["about.html", "关于"],
  ];

  CMF.renderChrome = function (active) {
    const header = document.createElement("header");
    header.className = "site-header";
    header.innerHTML =
      '<div class="container nav">' +
      '<a class="brand" href="index.html">🍳 CookMyFridge</a>' +
      '<nav class="nav-links">' +
      NAV_ITEMS.map(
        ([href, label]) =>
          `<a href="${href}"${href === active ? ' style="font-weight:700"' : ""}>${label}</a>`
      ).join("") +
      "</nav></div>";
    document.body.prepend(header);

    const footer = document.createElement("footer");
    footer.className = "site-footer";
    footer.innerHTML =
      '<div class="container">Don’t order. CookMyFridge. · 数据与 AI 内容见 <a href="about.html">关于页</a></div>';
    document.body.appendChild(footer);
  };

  CMF.pills = function (items, cls) {
    return items.map((t) => `<span class="pill ${cls || ""}">${CMF.esc(t)}</span>`).join("");
  };

  /* Recipe card used on result pages. `match` carries missing info. */
  CMF.recipeCard = function (match, wildcardPage) {
    const r = match.recipe;
    const link = wildcardPage
      ? `wildcard.html?key=${encodeURIComponent(match.key || r.id)}`
      : `recipe.html?id=${encodeURIComponent(r.id)}`;
    const missingPills = match.missing
      ? match.missing.map((c) => `<span class="pill missing">缺 ${CMF.esc(c)}</span>`).join("")
      : "";
    const userAllergens = new Set((CMF.getPrefs().allergens || []));
    const hits = (r.allergens || []).filter((a) => userAllergens.has(a));
    const planned = new Set(CMF.getPlan().recipeIds).has(r.id);
    const fav = new Set(CMF.getFavorites()).has(r.id);
    return (
      `<article class="recipe-card${hits.length ? " danger" : ""}">` +
      `<h3><a href="${link}">${CMF.esc(r.title)}</a></h3>` +
      '<div class="meta">' +
      `<span>⏱ ${r.time_minutes} 分钟</span>` +
      `<span>🎯 ${CMF.esc(r.difficulty)}</span>` +
      `<span>🍳 ${CMF.esc(r.methods.join("/"))}</span>` +
      "</div>" +
      '<div class="tag-pills">' +
      CMF.pills(r.tags) +
      missingPills +
      "</div>" +
      (hits.length
        ? `<div class="notice warn" style="margin:0;padding:6px 9px;font-size:12px">⚠️ 含你的过敏原：${CMF.esc(hits.join("、"))}</div>`
        : "") +
      (r.is_ai_generated
        ? '<span class="notice ai" style="margin:0;padding:6px 9px;font-size:12px">AI 创意，未人工实测</span>'
        : "") +
      '<div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:8px">' +
      `<button class="btn btn-sm fav-btn" data-fav-id="${r.id}">${fav ? "♥ 已收藏" : "♡ 收藏"}</button>` +
      (wildcardPage
        ? ""
        : `<button class="btn btn-sm plan-btn" data-plan-id="${r.id}">${planned ? "✓ 已加入计划" : "📋 加入计划"}</button>`) +
      "</div>" +
      "</article>"
    );
  };

  /* Ingredient encyclopedia modal: category, allergens, substitutions, recipes. */
  CMF.showIngredientInfo = function (name) {
    const entry = CMF.entry(name);
    if (!entry) {
      CMF.toast("目录里没有这个食材：" + name);
      return;
    }
    const subs = CMF.substitutionsFor(name);
    // substitutions are {canonical, reason} objects, not plain strings.
    const subsHtml = subs.length
      ? '<div class="sub-grid">' +
        subs
          .map((s) => {
            const label = typeof s === "string" ? s : s.canonical;
            const reason = typeof s === "object" && s.reason ? s.reason : "";
            return (
              '<span class="sub-chip"><strong>' +
              CMF.esc(label) +
              "</strong>" +
              (reason ? '<span class="sub-reason">' + CMF.esc(reason) + "</span>" : "") +
              "</span>"
            );
          })
          .join("") +
        "</div>"
      : "无";
    // pairings.js is optional: pages that skip it must still open the modal.
    const pairings = CMF.topPairings ? CMF.topPairings(name, 6) : [];
    const pairingHtml = pairings.length
      ? '<div class="pairing-grid">' +
        pairings
          .map(
            (p) =>
              `<button class="pairing-chip" data-name="${CMF.esc(p.canonical)}">` +
              `${CMF.emojiOf(p.canonical)} ${CMF.esc(p.canonical)} <span class="pair-count">${p.count}</span></button>`
          )
          .join("") +
        "</div>"
      : '<div class="empty">暂无共现数据</div>';
    const usedIn = CMF.data.recipes
      .filter((r) => r.ingredients.some((i) => i.canonical === name))
      .map(
        (r) =>
          `<a class="ing-link" href="recipe.html?id=${encodeURIComponent(r.id)}">${CMF.esc(r.title)}</a>`
      );

    const storage = CMF.storageFor ? CMF.storageFor(name) : null;
    const storageHtml = storage
      ? CMF.esc(storage.method) +
        (storage.fridgeDays ? ` · 冷藏约 ${storage.fridgeDays} 天` : "") +
        (storage.freezerDays ? ` · 冷冻约 ${storage.freezerDays} 天` : "")
      : "";
    const month = new Date().getMonth() + 1;
    const inSeason = CMF.isInSeason ? CMF.isInSeason(name, month) : false;
    const seasonalBadge = inSeason ? '<span class="seasonal-badge">🌿 本月当季</span>' : "";

    const overlay = document.createElement("div");
    overlay.className = "modal-overlay";
    overlay.innerHTML =
      '<div class="modal" role="dialog" aria-modal="true" aria-label="' + CMF.esc(name) + '">' +
      '<button class="modal-close" aria-label="关闭">×</button>' +
      `<h3><span class="modal-emoji">${entry.emoji}</span>${CMF.esc(name)}${seasonalBadge}</h3>` +
      `<div class="modal-row"><span>分类</span>${CMF.esc(entry.category)}</div>` +
      '<div class="modal-row"><span>同义词</span>' +
      (entry.synonyms.length ? CMF.esc(entry.synonyms.join("、")) : "无") +
      "</div>" +
      '<div class="modal-row"><span>过敏原</span>' +
      (entry.allergens.length ? CMF.esc(entry.allergens.join("、")) : "无") +
      "</div>" +
      (storageHtml ? '<div class="modal-row"><span>储存</span>' + storageHtml + "</div>" : "") +
      '<div class="modal-row subs"><span>常见替代</span>' + subsHtml + "</div>" +
      '<div class="modal-row pairing"><span>经典搭配</span>' + pairingHtml + "</div>" +
      '<div class="modal-recipes"><strong>用到它的菜谱（' + usedIn.length + "）</strong>" +
      (usedIn.length ? '<div class="ing-link-grid">' + usedIn.join("") + "</div>" : '<div class="empty">暂无菜谱</div>') +
      "</div></div>";

    function close() {
      overlay.remove();
      document.removeEventListener("keydown", onKey);
    }
    function onKey(ev) {
      if (ev.key === "Escape") close();
    }
    overlay.addEventListener("click", (ev) => {
      if (ev.target === overlay || ev.target.closest(".modal-close")) close();
    });
    document.addEventListener("keydown", onKey);
    overlay.addEventListener("click", (ev) => {
      const chip = ev.target.closest(".pairing-chip");
      if (chip) {
        close();
        CMF.showIngredientInfo(chip.dataset.name);
      }
    });
    document.body.appendChild(overlay);
  };

  CMF.copyText = function (text) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      return navigator.clipboard
        .writeText(text)
        .then(() => true)
        .catch(() => legacyCopy(text));
    }
    return Promise.resolve(legacyCopy(text));
  };

  function legacyCopy(text) {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.setAttribute("readonly", "");
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    let ok = false;
    try {
      ok = document.execCommand("copy");
    } catch (e) {
      ok = false;
    }
    document.body.removeChild(ta);
    return ok;
  }

  if (
    location.protocol.startsWith("http") &&
    "serviceWorker" in navigator
  ) {
    window.addEventListener("load", () => navigator.serviceWorker.register("sw.js"));
  }

  /* opts.deferRecipes: the homepage renders its wall from catalog + vocab
     alone and fills recipe-dependent widgets (weather picks) when the
     background recipes.json lands — everyone else awaits recipes as before. */
  CMF.boots = function (active, init, opts) {
    CMF.renderChrome(active);
    const ready = opts && opts.deferRecipes
      ? CMF.preload()
      : Promise.all([CMF.preload(), CMF.preloadRecipes()]);
    ready
      .then(() => {
        CMF.initCatalog();
        if (CMF.buildPairingIndex) CMF.buildPairingIndex(CMF.data.recipes);
        if (init) init();
      })
      .catch((err) => {
        const main = document.querySelector(".container") || document.body;
        main.insertAdjacentHTML(
          "beforeend",
          `<div class="empty">数据加载失败：${CMF.esc(err.message)}<br>请通过本地服务器访问（如 python -m http.server）。</div>`
        );
      });
  };

  /* Run fn once BOTH the core payload and the background AI shards have
     landed. Pages render core content at boots time and refresh only their
     AI zones here, so fn always sees a complete CMF.data. */
  CMF.onAiReady = function (fn) {
    Promise.all([CMF.preload(), CMF.preloadAI()]).then(fn).catch(() => {});
  };
})();
