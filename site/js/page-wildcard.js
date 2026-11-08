/* AI wildcard / blindbox detail page with feedback. */
(function () {
  "use strict";

  const CMF = window.CMF;
  const root = document.getElementById("wildcard-root");

  function allCards() {
    const d = CMF.data.ai;
    return [].concat(d.wildcards, d.blindboxes, d.variants);
  }

  function feedbackState(id) {
    return CMF.getFeedback()[id] || null;
  }

  function saveFeedback(id, value) {
    const map = CMF.getFeedback();
    if (map[id] === value) delete map[id];
    else map[id] = value;
    CMF.setFeedback(map);
  }

  function render(recipe, sourceLabel) {
    const fb = feedbackState(recipe.id);
    // Deterministic templates are stored in the same bucket as AI cards, but
    // must never be presented as model output (or as tested recipes).
    const isRule = /规则生成/.test(recipe.source || "");
    const notice = isRule
      ? '<div class="notice info">规则生成的参考变体（非 AI、未实测），仅提供搭配思路。请确保食材新鲜、彻底加热，注意过敏原。</div>'
      : '<div class="notice ai">AI 创意菜，未经过人工实测。请确保食材新鲜、彻底加热，注意过敏原。</div>';
    const label = isRule ? "规则变体（非 AI）" : sourceLabel;
    root.innerHTML =
      '<article class="detail">' +
      `<h1>${CMF.esc(recipe.title)}</h1>` +
      notice +
      '<div class="meta" style="display:flex;gap:14px;flex-wrap:wrap;color:var(--ink-soft);font-size:13.5px">' +
      `<span>⏱ ${recipe.time_minutes} 分钟</span><span>🎯 ${CMF.esc(recipe.difficulty)}</span>` +
      `<span>🍳 ${CMF.esc(recipe.methods.join("、"))}</span><span style="background:#fdeee7;padding:2px 9px;border-radius:999px">${CMF.esc(label)}</span></div>` +
      (recipe.allergens.length
        ? `<div class="notice warn">过敏原：${CMF.esc(recipe.allergens.join("、"))}</div>`
        : "") +
      '<div class="detail-grid"><div><h3>食材</h3><ul class="ingredient-list">' +
      recipe.ingredients
        .map(
          (i) =>
            `<li><span>${CMF.esc(i.canonical)}</span><span class="amount">${CMF.esc(i.amount)}</span></li>`
        )
        .join("") +
      "</ul></div><div><h3>步骤</h3><ol class='steps'>" +
      recipe.steps.map((s) => `<li>${CMF.esc(s)}</li>`).join("") +
      "</ol></div></div>" +
      (recipe.safety_notes.length
        ? recipe.safety_notes.slice(1).map((n) => `<div class="notice info">${CMF.esc(n)}</div>`).join("")
        : "") +
      '<div class="feedback"><strong>这道菜靠谱吗？</strong>' +
      `<button class="btn btn-sm ${fb === "up" ? "active-up" : ""}" data-fb="up">👍 靠谱</button>` +
      `<button class="btn btn-sm ${fb === "down" ? "active-down" : ""}" data-fb="down">👎 离谱</button></div>` +
      "</article>";

    root.querySelectorAll(".feedback .btn").forEach((btn) => {
      btn.onclick = () => {
        saveFeedback(recipe.id, btn.dataset.fb);
        render(recipe, sourceLabel);
      };
    });
  }

  function start() {
    const cards = allCards();
    const key = CMF.queryParam("key");
    if (key) {
      const card = cards.find((c) => c.id === key);
      if (!card) {
        root.innerHTML = CMF.data.aiReady
          ? '<div class="empty">找不到这张 AI 卡片。</div>'
          : '<div class="empty">正在加载 AI 创意数据…</div>';
        return;
      }
      const label = CMF.data.ai.blindboxes.some((b) => b.id === key)
        ? "冰箱盲盒"
        : CMF.data.ai.variants.some((v) => v.id === key)
        ? "AI 变体"
        : "AI Wildcard";
      render(card, label);
      return;
    }

    if (CMF.queryParam("blind") === "1") {
      const pool = CMF.data.ai.blindboxes;
      if (!pool.length) {
        root.innerHTML = CMF.data.aiReady
          ? '<div class="empty">盲盒卡片还在生成中，稍后再来。</div>'
          : '<div class="empty">正在加载盲盒卡片…</div>';
        return;
      }
      const card = pool[Math.floor(Math.random() * pool.length)];
      history.replaceState(null, "", "wildcard.html?key=" + encodeURIComponent(card.id));
      render(card, "冰箱盲盒");
      return;
    }

    root.innerHTML =
      '<div class="empty">从 <a href="result.html">结果页</a> 点一张 AI 卡片，或直接来个 <a href="wildcard.html?blind=1">冰箱盲盒</a>。</div>';
  }

  // This page uses zero feature modules (esc + storage + AI shards only):
  // skip the features bundle entirely.
  CMF.boots("index.html", start, { skipFeatures: true });
  // This page's content IS the AI shards: start() renders an honest "not
  // ready yet" state when they are still in flight; re-run once they land.
  CMF.onAiReady(() => start());
})();
