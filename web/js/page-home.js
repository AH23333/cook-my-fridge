/* Homepage: ingredient wall, search, random box, cook bar. */
(function () {
  "use strict";

  const CMF = window.CMF;
  let selected = new Set(CMF.getFridge());

  const wall = document.getElementById("ingredient-wall");
  const searchInput = document.getElementById("ingredient-search");
  const cookBar = document.getElementById("cook-bar");

  function renderWall(filterText) {
    const q = (filterText || "").trim().toLowerCase();
    wall.innerHTML = "";
    CMF.data.vocab.categories.forEach((category) => {
      let entries = CMF.ingredientsByCategory(category);
      if (q) {
        entries = entries.filter(
          (e) =>
            e.canonical.toLowerCase().includes(q) ||
            e.synonyms.some((s) => s.toLowerCase().includes(q))
        );
      }
      if (!entries.length) return;
      const group = document.createElement("div");
      group.className = "ingredient-group";
      group.innerHTML = `<h3>${CMF.esc(category)}</h3>`;
      const grid = document.createElement("div");
      grid.className = "chip-grid";
      grid.innerHTML = entries
        .map(
          (e) =>
            `<button class="chip ${selected.has(e.canonical) ? "selected" : ""}" data-name="${CMF.esc(e.canonical)}">` +
            `<span class="emoji">${e.emoji}</span><span class="name">${CMF.esc(e.canonical)}</span></button>`
        )
        .join("");
      grid.addEventListener("click", onChipClick);
      group.appendChild(grid);
      wall.appendChild(group);
    });
    if (!wall.children.length) {
      wall.innerHTML = '<div class="empty">没有匹配的食材，换个关键词试试。</div>';
    }
  }

  function onChipClick(ev) {
    const chip = ev.target.closest(".chip");
    if (!chip) return;
    const name = chip.dataset.name;
    if (selected.has(name)) {
      selected.delete(name);
      chip.classList.remove("selected");
    } else {
      selected.add(name);
      chip.classList.add("selected");
    }
    syncFridge();
    renderCookBar();
  }

  function syncFridge() {
    CMF.setFridge([...selected]);
  }

  function renderCookBar() {
    const picked = [...selected];
    cookBar.innerHTML =
      '<div class="picked">' +
      picked
        .map(
          (c) =>
            `<span class="mini-tag">${CMF.emojiOf(c)} ${CMF.esc(c)}<span class="x" data-name="${CMF.esc(c)}">×</span></span>`
        )
        .join("") +
      "</div>" +
      `<button class="btn btn-ghost btn-sm" id="btn-clear">清空</button>` +
      `<button class="btn btn-primary" id="btn-cook" ${picked.length ? "" : "disabled"}>Cook My Fridge (${picked.length})</button>`;

    cookBar.querySelector("#btn-cook").onclick = goCook;
    cookBar.querySelector("#btn-clear").onclick = () => {
      selected.clear();
      syncFridge();
      renderWall(searchInput.value);
      renderCookBar();
    };
    cookBar.querySelectorAll(".x").forEach((x) => {
      x.onclick = () => {
        selected.delete(x.dataset.name);
        syncFridge();
        renderWall(searchInput.value);
        renderCookBar();
      };
    });
  }

  function goCook() {
    if (!selected.size) return;
    const list = [...selected];
    CMF.addHistory({
      date: new Date().toISOString(),
      selected: list,
    });
    location.href = "result.html?i=" + CMF.encodeSelected(list);
  }

  function randomBox() {
    const all = CMF.allIngredients().map((e) => e.canonical);
    const n = 3 + Math.floor(Math.random() * 3);
    const pool = [...all];
    const picks = [];
    for (let k = 0; k < n && pool.length; k++) {
      const idx = Math.floor(Math.random() * pool.length);
      picks.push(pool.splice(idx, 1)[0]);
    }
    selected = new Set(picks);
    syncFridge();
    renderWall(searchInput.value);
    renderCookBar();
    CMF.toast("冰箱盲盒已抽好，点 Cook My Fridge 开饭");
  }

  searchInput.addEventListener("input", () => renderWall(searchInput.value));
  searchInput.addEventListener("keydown", (ev) => {
    if (ev.key !== "Enter") return;
    const typed = searchInput.value.trim();
    if (!typed) return;
    const canonical = CMF.normalizeName(typed);
    if (!CMF.isKnown(canonical)) {
      CMF.toast("目录里还没有这个食材，先从食材墙选吧");
      return;
    }
    selected.add(canonical);
    syncFridge();
    searchInput.value = "";
    renderWall("");
    renderCookBar();
    CMF.toast("已添加：" + canonical);
  });
  const nlInput = document.getElementById("nl-input");
  const nlFeedback = document.getElementById("nl-feedback");

  function addFromText() {
    const text = nlInput.value.trim();
    if (!text) return;
    const parsed = CMF.parseIngredients(text);
    if (!parsed.length) {
      nlFeedback.textContent = "没认出已知食材，换个说法或从食材墙点选。";
      return;
    }
    let added = 0;
    parsed.forEach((c) => {
      if (!selected.has(c)) {
        selected.add(c);
        added += 1;
      }
    });
    syncFridge();
    renderWall(searchInput.value);
    renderCookBar();
    nlInput.value = "";
    nlFeedback.textContent =
      "识别到 " + parsed.length + " 样，新增 " + added + " 样：" +
      parsed.map((c) => CMF.emojiOf(c) + c).join(" ");
  }

  document.getElementById("nl-add").onclick = addFromText;
  nlInput.addEventListener("keydown", (ev) => {
    if (ev.key === "Enter") addFromText();
  });

  document.getElementById("btn-random").onclick = randomBox;
  document.getElementById("btn-surprise").onclick = () => {
    const recipes = CMF.data.recipes;
    if (!recipes.length) return;
    const pick = recipes[Math.floor(Math.random() * recipes.length)];
    location.href = "recipe.html?id=" + encodeURIComponent(pick.id);
  };
  document.getElementById("btn-blindbox-page").onclick = () => {
    location.href = "wildcard.html?blind=1";
  };

  function start() {
    renderWall("");
    renderCookBar();
  }

  CMF.boots("index.html", start);
})();
