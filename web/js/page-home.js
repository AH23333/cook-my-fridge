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

  /* Merge at write time: another open tab may have changed cmf.fridge since
     this page took its `selected` snapshot — writing that stale copy back
     silently erases the other tab's picks (reproduced two-tab, 2026-11-08).
     Single-item deltas re-read storage, apply just that delta, then adopt
     the fresh truth locally. Whole-fridge actions (clear, random box) stay
     intentional replaces. */
  function toggleOne(name) {
    const current = new Set(CMF.getFridge());
    if (current.has(name)) current.delete(name);
    else current.add(name);
    CMF.setFridge([...current]);
    selected = current;
  }

  function onChipClick(ev) {
    const chip = ev.target.closest(".chip");
    if (!chip) return;
    const name = chip.dataset.name;
    toggleOne(name);
    chip.classList.toggle("selected", selected.has(name));
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
            `<span class="mini-tag">${CMF.emojiOf(c)} ${CMF.esc(c)}` +
            `<button type="button" class="x" data-name="${CMF.esc(c)}" aria-label="移除 ${CMF.esc(c)}">×</button></span>`
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
        toggleOne(x.dataset.name);
        renderWall(searchInput.value);
        renderCookBar();
      };
    });
  }

  function goCook() {
    if (!selected.size) return;
    // Same double-write class as the journal button: dblclick logged the
    // cook twice in history (measured). Once per second is plenty — a real
    // second cook needs new picks anyway.
    if (!CMF.oncePer("go-cook", 1000)) return;
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
    // Merge into the CURRENT storage, not this page's snapshot (two-tab).
    const current = new Set(CMF.getFridge());
    let added = 0;
    parsed.forEach((c) => {
      if (!current.has(c)) {
        current.add(c);
        added += 1;
      }
    });
    CMF.setFridge([...current]);
    selected = current;
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

  const voiceBtn = document.getElementById("nl-voice");
  function wireVoice() {
    let handle = null;
    voiceBtn.onclick = () => {
      if (handle) {
        handle.stop();
        handle = null;
        voiceBtn.classList.remove("listening");
        return;
      }
      voiceBtn.classList.add("listening");
      handle = CMF.startVoiceInput({
        onResult: (text) => {
          nlInput.value = text;
          addFromText();
        },
        onState: (s) => {
          if (s === "idle") {
            voiceBtn.classList.remove("listening");
            handle = null;
          }
        },
        onError: (code) => {
          voiceBtn.classList.remove("listening");
          handle = null;
          nlFeedback.textContent =
            code === "not-supported" ? "这个浏览器不支持语音输入，请用键盘输入。"
            : code === "no-speech" ? "没听清，再点一次麦克风试试。"
            : "语音输入不可用（可能未授权麦克风），请用键盘输入。";
        },
      });
    };
  }

  /* voice.js lives in the deferred features bundle: the button starts
     hidden and appears once features land (only when speech is supported).
     Sync-bundle pages run this block with voice.js already present. */
  function refreshVoiceButton() {
    if (!voiceBtn) return;
    if (CMF.voiceSupported && CMF.voiceSupported()) {
      voiceBtn.style.display = "";
      wireVoice();
    } else {
      voiceBtn.style.display = "none";
    }
  }
  refreshVoiceButton();
  CMF.onFeatures(refreshVoiceButton);

  function renderSeasonalBanner() {
    const root = document.getElementById("seasonal-banner");
    if (!root || !CMF.currentSolarTerm) return;
    const now = new Date();
    const term = CMF.currentSolarTerm(now);
    const names = CMF.seasonalNames ? CMF.seasonalNames(now.getMonth() + 1) : [];
    if (!term) return;
    const picks = names.slice(0, 8);
    root.innerHTML =
      '<div class="seasonal-banner">' +
      `<span class="seasonal-term">🌿 ${CMF.esc(term.name)}</span>` +
      '<span class="seasonal-hint">当季食材更新鲜便宜，点一下加入冰箱：</span>' +
      '<span class="seasonal-chips">' +
      picks
        .map(
          (c) =>
            `<button class="chip chip-sm${selected.has(c) ? " selected" : ""}" data-season="${CMF.esc(c)}">${CMF.emojiOf(c)} ${CMF.esc(c)}</button>`
        )
        .join("") +
      "</span></div>";
    root.querySelectorAll("[data-season]").forEach((btn) => {
      btn.onclick = () => {
        toggleOne(btn.dataset.season);
        renderWall(searchInput.value);
        renderCookBar();
        renderSeasonalBanner();
      };
    });
  }

  const WEATHER_KINDS = [
    ["hot", "🥵 炎热"], ["mild", "😊 舒适"], ["cool", "🍃 凉爽"],
    ["cold", "🥶 寒冷"], ["rain", "🌧️ 下雨"], ["snow", "❄️ 下雪"],
  ];

  function weatherPicksHTML(weather) {
    const picks = CMF.weatherSuggestions(CMF.data.recipes, weather, 3);
    if (!picks.length) return '<div class="empty">暂无建议</div>';
    return (
      '<div class="weather-picks">' +
      picks
        .map(
          (p) =>
            `<a class="weather-pick" href="recipe.html?id=${encodeURIComponent(p.recipe.id)}">` +
            `<strong>${CMF.esc(p.recipe.title)}</strong>` +
            `<span>${CMF.esc(p.reason)} · ${p.recipe.time_minutes} 分钟</span></a>`
        )
        .join("") +
      "</div>"
    );
  }

  function renderWeatherCard() {
    const root = document.getElementById("weather-card");
    if (!root || !CMF.classifyWeather) return;
    const cities = CMF.WEATHER_CITIES || [];
    const cached = CMF.readWeatherCache ? CMF.readWeatherCache() : null;
    const fresh = cached && CMF.weatherCacheFresh && CMF.weatherCacheFresh(cached);
    const cityOptions = cities
      .map((c) => `<option value="${c.key}">${CMF.esc(c.label)}</option>`)
      .join("");
    const kindOptions = WEATHER_KINDS
      .map(([k, label]) => `<option value="${k}">${label}</option>`)
      .join("");
    root.innerHTML =
      '<div class="weather-card">' +
      '<div class="weather-head"><strong>🌤️ 今天天气开饭</strong>' +
      '<span class="weather-src">数据：Open-Meteo（免费）</span></div>' +
      '<div class="weather-controls">' +
      `<select id="weather-city" class="filter-select">${cityOptions}</select>` +
      '<button class="btn btn-sm" id="weather-fetch">获取天气</button>' +
      '<span class="weather-or">或手动选</span>' +
      `<select id="weather-kind" class="filter-select">${kindOptions}</select>` +
      "</div>" +
      '<div id="weather-status" class="weather-status"></div>' +
      '<div id="weather-result"></div>' +
      "</div>";

    const status = root.querySelector("#weather-status");
    const result = root.querySelector("#weather-result");

    function showWeather(weather, note) {
      status.innerHTML =
        `${weather.emoji} <strong>${CMF.esc(weather.label)}</strong>` +
        (note ? ` <span class="weather-note">${CMF.esc(note)}</span>` : "") +
        `<span class="weather-advice">${CMF.esc(weather.advice)}</span>`;
      result.innerHTML = weatherPicksHTML(weather);
    }

    if (fresh) {
      const w = CMF.classifyWeather(cached.tempC, cached.code);
      showWeather(w, `${cached.city || ""} ${cached.tempC}°C · 缓存`);
    } else {
      status.textContent = "选城市点「获取天气」，或直接手动选天气（离线可用）。";
    }

    root.querySelector("#weather-kind").onchange = (ev) => {
      const kind = ev.target.value;
      const temps = { hot: 32, mild: 22, cool: 12, cold: 0, rain: 18, snow: -2 };
      const codes = { rain: 63, snow: 73 };
      showWeather(CMF.classifyWeather(temps[kind], codes[kind] || 0), "手动选择");
    };

    root.querySelector("#weather-fetch").onclick = async () => {
      const key = root.querySelector("#weather-city").value;
      const city = cities.find((c) => c.key === key) || cities[0];
      if (!city || !CMF.fetchCurrentWeather) return;
      status.textContent = "正在获取 " + city.label + " 天气…";
      try {
        const data = await CMF.fetchCurrentWeather({ lat: city.lat, lon: city.lon });
        if (CMF.writeWeatherCache) {
          CMF.writeWeatherCache({ ...data, city: city.label });
        }
        showWeather(CMF.classifyWeather(data.tempC, data.code), `${city.label} ${data.tempC}°C`);
      } catch (e) {
        status.innerHTML =
          '<span class="weather-note">获取失败（' + CMF.esc(e.message) + '），可手动选天气。</span>';
      }
    };
  }

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
    renderSeasonalBanner();
    renderWeatherCard();
  }

  CMF.boots("index.html", start, { deferRecipes: true });
  // recipes.json streams in behind the first paint; fill what depends on it.
  // weather.js / pairings.js live in the deferred features bundle, so the
  // enrichment waits for BOTH the data and the features script.
  CMF.preloadRecipes().then(() => {
    CMF.onFeatures(() => {
      if (CMF.buildPairingIndex) CMF.buildPairingIndex(CMF.data.recipes);
      renderWeatherCard();
    });
  });
})();
