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
    return { methods, maxTime, difficulty, tags: [] };
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

  function render() {
    const result = CMF.search(CMF.data.recipes, selected, currentFilters());
    const wild = wildcardMatches();
    buckets.innerHTML =
      bucketNode("badge-now", "COOK NOW", "现在就能做", result.cookNow) +
      bucketNode("badge-almost", "ALMOST", "只差一点", result.almostThere) +
      bucketNode("badge-wild", "AI WILDCARD", "AI 创意菜", wild, true);
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
    render();
  }

  CMF.boots("index.html", start);
})();
