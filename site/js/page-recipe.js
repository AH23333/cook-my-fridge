/* Recipe detail page with AI enhancement entry points. */
(function () {
  "use strict";

  const CMF = window.CMF;
  const root = document.getElementById("detail-root");

  const AI_BUTTONS = [
    ["substitute", "换掉没有的食材"],
    ["lazy", "懒人版"],
    ["lowcal", "低卡版"],
    ["method", "换种做法"],
    ["airfryer", "空气炸锅版"],
    ["leftover", "剩菜改造"],
    ["fusion", "融合菜系"],
  ];

  function findVariant(recipeId, kind) {
    const key = `${recipeId}:${kind}`;
    return CMF.data.ai.variants.find((v) => v.key === key) || null;
  }

  function render(recipe) {
    const ingredientRows = recipe.ingredients
      .map(
        (i) =>
          `<li><span>${CMF.esc(i.canonical)}${i.optional ? ' <span class="pill">可选</span>' : ""}</span>` +
          `<span class="amount">${CMF.esc(i.amount)}</span></li>`
      )
      .join("");

    const subRows = recipe.ingredients
      .flatMap((i) =>
        CMF.substitutionsFor(i.canonical).map(
          (s) =>
            `<tr><td>${CMF.esc(i.canonical)}</td><td>${CMF.esc(s.canonical)}</td><td>${CMF.esc(s.reason)}</td></tr>`
        )
      )
      .join("");

    const ideasEntry = CMF.data.ai.ideas.find((x) => x.key === recipe.id);

    root.innerHTML =
      `<article class="detail"><h1>${CMF.esc(recipe.title)}</h1>` +
      '<div class="meta" style="display:flex;gap:14px;flex-wrap:wrap;color:var(--ink-soft);font-size:13.5px">' +
      `<span>⏱ ${recipe.time_minutes} 分钟</span><span>🎯 ${CMF.esc(recipe.difficulty)}</span>` +
      `<span>🍳 ${CMF.esc(recipe.methods.join("、"))}</span><span>🍽️ ${CMF.esc(recipe.cookware.join("、"))}</span>` +
      `<span>🥢 ${CMF.esc(recipe.cuisine)}</span></div>` +
      '<div class="tag-pills" style="margin:10px 0">' + CMF.pills(recipe.tags) + "</div>" +
      (recipe.is_ai_generated
        ? '<div class="notice ai">AI 创意菜，未经过人工实测。请确保食材新鲜、彻底加热，注意过敏原。</div>'
        : "") +
      (recipe.allergens.length
        ? `<div class="notice warn">过敏原提示：${CMF.esc(recipe.allergens.join("、"))}</div>`
        : '<div class="notice safe">本菜谱未标注常见过敏原</div>') +
      (recipe.safety_notes.length
        ? recipe.safety_notes.map((n) => `<div class="notice info">${CMF.esc(n)}</div>`).join("")
        : "") +
      '<div class="detail-grid">' +
      "<div><h3>食材与用量</h3><ul class='ingredient-list'>" + ingredientRows + "</ul></div>" +
      "<div><h3>做法步骤</h3><ol class='steps'>" +
      recipe.steps.map((s) => `<li>${CMF.esc(s)}</li>`).join("") +
      "</ol></div></div>" +
      (subRows
        ? "<h3>食材替代方案</h3><table class='data-table'><tr><th>原食材</th><th>替代</th><th>说明</th></tr>" +
          subRows + "</table>"
        : "") +
      "<h3>AI 加料</h3><div class='ai-actions'>" +
      AI_BUTTONS.map(
        ([kind, label]) =>
          `<button class="btn btn-sm" data-kind="${kind}">${label}</button>`
      ).join("") +
      "</div>" +
      (ideasEntry
        ? "<h3>数据集里没有的三个主意</h3><ul>" +
          ideasEntry.ideas.map((x) => `<li>${CMF.esc(x)}</li>`).join("") + "</ul>"
        : "") +
      `<p style="font-size:12.5px;color:var(--ink-soft);margin-top:16px">来源：${CMF.esc(recipe.source)} · 许可证：${CMF.esc(recipe.license)}</p>` +
      "</article>";

    root.querySelectorAll(".ai-actions .btn").forEach((btn) => {
      btn.onclick = () => {
        const variant = findVariant(recipe.id, btn.dataset.kind);
        if (variant) {
          location.href = "wildcard.html?key=" + encodeURIComponent(variant.id);
        } else {
          CMF.toast("这个变体还没预生成，先看其他按钮吧");
        }
      };
    });
  }

  function start() {
    const id = CMF.queryParam("id");
    const recipe = CMF.data.recipes.find((r) => r.id === id);
    if (!recipe) {
      root.innerHTML = '<div class="empty">找不到这道菜，回 <a href="index.html">首页</a> 看看。</div>';
      return;
    }
    document.title = recipe.title + " · CookMyFridge";
    render(recipe);
  }

  CMF.boots("index.html", start);
})();
