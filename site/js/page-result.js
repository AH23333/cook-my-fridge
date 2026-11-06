/* Result page: three buckets with live filters. */
(function () {
  "use strict";

  const CMF = window.CMF;
  const selected = CMF.selectedFromURL();
  const summary = document.getElementById("selection-summary");
  const buckets = document.getElementById("buckets");

  const methodSel = document.getElementById("filter-method");
  const timeSel = document.getElementById("filter-time");
  const diffSel = document.getElementById("filter-difficulty");

  function currentFilters() {
    const methods = methodSel.value ? [CMF.normalizeMethod(methodSel.value)] : [];
    const maxTime = timeSel.value ? Number(timeSel.value) : null;
    const difficulty = diffSel.value ? [diffSel.value] : [];
    const tags = CMF.getPrefs().tags || [];
    return { methods, maxTime, difficulty, tags };
  }

  function bucketNode(badgeClass, badge, title, matches, wildcardPage) {
    const cards = matches
      .map((m) => CMF.recipeCard(m, wildcardPage))
      .join("");
    return (
      '<section class="bucket">' +
      '<div class="bucket-head">' +
      `<span class="bucket-badge ${badgeClass}">${badge}</span>` +
      `<strong>${title}</strong><span class="count">${matches.length}</span></div>` +
      '<div class="card-grid">' +
      (cards || '<div class="empty">这一栏暂时没有结果</div>') +
      "</div></section>"
    );
  }

  function wildcardMatches() {
    const set = new Set(selected);
    const key = selected.slice().sort().join("|");
    let hits = CMF.data.ai.wildcards.filter((w) => w.key === key);
    if (!hits.length) {
      // Fuzzy fallback: wildcard cards sharing any selected ingredient.
      hits = CMF.data.ai.wildcards
        .filter((w) => w.ingredients.some((i) => set.has(i.canonical)))
        .slice(0, 3);
    }
    return hits.map((w) => ({
      key: w.id,
      recipe: w,
      matched: w.ingredients.map((i) => i.canonical).filter((c) => set.has(c)),
      missing: [],
    }));
  }

  function renderUnlock() {
    const panel = document.getElementById("unlock-panel");
    // Unfiltered Almost matches so suggestions reflect the whole dataset.
    const all = CMF.search(CMF.data.recipes, selected);
    const freq = {};
    all.almostThere.forEach((m) => {
      new Set(m.missing).forEach((c) => {
        freq[c] = (freq[c] || 0) + 1;
      });
    });
    const top = Object.entries(freq)
      .sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))
      .slice(0, 6);
    if (!top.length) {
      panel.innerHTML = "";
      return;
    }
    panel.innerHTML =
      '<h3 class="section-title" style="margin-top:16px">🛒 再买一样，就能多做</h3>' +
      '<div class="chip-grid">' +
      top
        .map(
          ([c, n]) =>
            `<span class="chip unlock-chip" data-add="${CMF.esc(c)}">${CMF.emojiOf(c)} ${CMF.esc(c)} <strong>+${n}</strong></span>`
        )
        .join("") +
      "</div>";
    panel.querySelectorAll(".unlock-chip").forEach((chip) => {
      chip.onclick = () => {
        const next = selected.concat(chip.dataset.add).filter(
          (c, i, arr) => arr.indexOf(c) === i
        );
        location.href = "result.html?i=" + CMF.encodeSelected(next);
      };
    });
  }

  function hasUserAllergen(recipe) {
    const user = new Set(CMF.getPrefs().allergens || []);
    return (recipe.allergens || []).some((a) => user.has(a));
  }

  function dropAllergen(matches) {
    if (!document.getElementById("hide-allergens").checked) return matches;
    return matches.filter((m) => !hasUserAllergen(m.recipe));
  }

  function wirePlanButtons() {
    buckets.querySelectorAll(".plan-btn").forEach((btn) => {
      btn.onclick = () => {
        CMF.togglePlanRecipe(btn.dataset.planId);
        render();
      };
    });
  }

  function render() {
    const result = CMF.search(CMF.data.recipes, selected, currentFilters());
    const wild = wildcardMatches();
    buckets.innerHTML =
      bucketNode("badge-now", "COOK NOW", "现在就能做", dropAllergen(result.cookNow)) +
      bucketNode("badge-almost", "ALMOST", "只差一点", dropAllergen(result.almostThere)) +
      bucketNode("badge-wild", "AI WILDCARD", "AI 创意菜", dropAllergen(wild), true);
    wirePlanButtons();
  }

  function start() {
    if (!selected.length) {
      summary.innerHTML = '<div class="empty">还没有选择食材，先去 <a href="index.html">首页</a> 点几样。</div>';
      return;
    }
    summary.innerHTML =
      '<div class="notice info">冰箱里有：' +
      selected.map((c) => `${CMF.emojiOf(c)} ${CMF.esc(c)}`).join("、") +
      "</div>";

    methodSel.innerHTML =
      '<option value="">全部烹饪方式</option>' +
      CMF.data.vocab.methods.map((m) => `<option value="${m}">${m}</option>`).join("");
    diffSel.innerHTML =
      '<option value="">全部难度</option>' +
      CMF.data.vocab.difficulties.map((d) => `<option value="${d}">${d}</option>`).join("");

    [methodSel, timeSel, diffSel].forEach((node) =>
      node.addEventListener("change", render)
    );
    if ((CMF.getPrefs().allergens || []).length) {
      document.getElementById("allergen-toggle").style.display = "block";
      document.getElementById("hide-allergens").addEventListener("change", render);
    }
    render();
    renderUnlock();
  }

  CMF.boots("index.html", start);
})();
