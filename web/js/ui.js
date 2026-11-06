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
    ["fridge.html", "我的冰箱"],
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
      "</article>"
    );
  };

  if (
    location.protocol.startsWith("http") &&
    "serviceWorker" in navigator
  ) {
    window.addEventListener("load", () => navigator.serviceWorker.register("sw.js"));
  }

  CMF.boots = function (active, init) {
    CMF.renderChrome(active);
    CMF.preload()
      .then(() => {
        CMF.initCatalog();
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
})();
