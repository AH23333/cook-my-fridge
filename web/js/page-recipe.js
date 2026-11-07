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

  const FACTORS = [0.5, 1, 1.5, 2, 3];
  let factor = 1;

  function renderSimilar(recipe) {
    const rows = CMF.similarRecipes(recipe, CMF.data.recipes, 4);
    if (!rows.length) return "";
    return (
      "<h3>相似菜谱</h3><div class='similar-list'>" +
      rows
        .map(
          (r) =>
            `<a class="similar-item" href="recipe.html?id=${encodeURIComponent(r.id)}">` +
            `<span>${CMF.esc(r.title)}</span><span class="similar-meta">⏱ ${r.time_minutes} 分钟</span></a>`
        )
        .join("") +
      "</div>"
    );
  }

  function renderJournalPanel(recipe) {
    if (!CMF.logCooked || !CMF.getJournal) return "";
    const journal = CMF.normalizeJournal(CMF.getJournal());
    const count = CMF.cookedCountFor(journal, recipe.id);
    const rating = (journal.ratings || {})[recipe.id] || 0;
    const note = (journal.notes || {})[recipe.id] || "";
    const stars = [1, 2, 3, 4, 5]
      .map((n) => `<button class="star-btn${n <= rating ? " on" : ""}" data-star="${n}" aria-label="${n} 星">${n <= rating ? "★" : "☆"}</button>`)
      .join("");
    return (
      '<div class="journal-panel">' +
      "<h3>🍳 开饭打卡</h3>" +
      `<p class="journal-count">${count ? "这道菜你做过 " + count + " 次" : "还没做过这道菜，做完来打个卡吧"}${rating ? " · 当前评分 " + CMF.esc(rating) + " 星" : ""}</p>` +
      '<div class="journal-rate"><span>评分</span><span class="journal-stars" id="journal-stars">' + stars + "</span></div>" +
      '<textarea id="journal-note" class="journal-note" rows="2" maxlength="500" placeholder="记一笔：口味、改动、下次注意…">' + CMF.esc(note) + "</textarea>" +
      '<button class="btn btn-primary btn-sm" id="journal-log">✅ 我做过这道菜</button>' +
      '<span class="journal-hint">打卡会记录日期、份量、每份估算热量与整菜成本，可在统计页看连击与成就。</span>' +
      "</div>"
    );
  }

  function wireJournalPanel(recipe) {
    const logBtn = root.querySelector("#journal-log");
    if (!logBtn) return;
    let rating = CMF.normalizeJournal(CMF.getJournal()).ratings[recipe.id] || 0;
    const starsBox = root.querySelector("#journal-stars");
    function paintStars() {
      starsBox.querySelectorAll(".star-btn").forEach((b) => {
        const n = Number(b.dataset.star);
        b.classList.toggle("on", n <= rating);
        b.textContent = n <= rating ? "★" : "☆";
      });
    }
    starsBox.querySelectorAll(".star-btn").forEach((b) => {
      b.onclick = () => {
        const n = Number(b.dataset.star);
        rating = rating === n ? 0 : n;
        paintStars();
      };
    });
    logBtn.onclick = () => {
      const note = root.querySelector("#journal-note").value;
      if (!CMF.logCooked(recipe, { rating, note, factor })) {
        CMF.toast("保存失败，输入已保留，请重试或导出备份后检查存储空间。");
        return;
      }
      CMF.toast("已打卡，做得好！");
      render(recipe);
    };
  }

  function render(recipe) {
    const ingredientRows = recipe.ingredients
      .map(
        (i) =>
          `<li><button class="ing-name-btn" data-ing="${CMF.esc(i.canonical)}">${CMF.esc(i.canonical)}</button>` +
          (i.optional ? ' <span class="pill">可选</span>' : "") +
          `<span class="amount">${CMF.esc(CMF.scaleAmount(i.amount, factor))}</span></li>`
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

    const isFav = new Set(CMF.getFavorites()).has(recipe.id);
    root.innerHTML =
      `<article class="detail"><h1>${CMF.esc(recipe.title)} ` +
      `<button class="btn btn-sm detail-fav" style="vertical-align:middle">${isFav ? "♥ 已收藏" : "♡ 收藏"}</button> ` +
      '<button class="btn btn-sm" id="btn-share-card" style="vertical-align:middle">🖼️ 生成分享图</button></h1>' +
      '<div class="meta" style="display:flex;gap:14px;flex-wrap:wrap;color:var(--ink-soft);font-size:13.5px">' +
      `<span>⏱ ${recipe.time_minutes} 分钟</span><span>🎯 ${CMF.esc(recipe.difficulty)}</span>` +
      `<span>🍳 ${CMF.esc(recipe.methods.join("、"))}</span><span>🍽️ ${CMF.esc(recipe.cookware.join("、"))}</span>` +
      `<span>🥢 ${CMF.esc(recipe.cuisine)}</span></div>` +
      '<div class="tag-pills" style="margin:10px 0">' + CMF.pills(recipe.tags) + "</div>" +
      (() => {
        const nf = CMF.recipeNutrition(recipe);
        return nf.length
          ? '<div class="nutrition-badges"><span class="nutrition-label">营养速览</span>' +
            nf.map((f) => `<span class="nutrition-badge">${CMF.esc(f)}</span>`).join("") +
            '<span class="nutrition-note">定性标签，非精确营养计算</span></div>'
          : "";
      })() +
      (CMF.renderNutritionCard ? CMF.renderNutritionCard(recipe, factor) : "") +
      (() => {
        if (!CMF.renderGoalProgress || !CMF.estimateNutrition) return "";
        const estimate = CMF.estimateNutrition(recipe, factor);
        return estimate ? CMF.renderGoalProgress(estimate.perServing, { meals: 1 }) : "";
      })() +
      (() => {
        if (!CMF.renderBalanceCard || !CMF.estimateNutrition) return "";
        const estimate = CMF.estimateNutrition(recipe, factor);
        return estimate ? CMF.renderBalanceCard(estimate.perServing, { meals: 1 }) : "";
      })() +
      (() => {
        if (!CMF.compatibleDiets) return "";
        const keys = CMF.compatibleDiets(recipe);
        if (!keys.length) return "";
        return (
          '<div class="diet-badges"><span class="nutrition-label">🌱 适配饮食</span>' +
          keys
            .map((k) => {
              const d = (CMF.DIETS || []).find((x) => x.key === k) || { label: k, emoji: "" };
              return `<span class="diet-badge">${d.emoji} ${CMF.esc(d.label)}</span>`;
            })
            .join("") +
          '<span class="nutrition-note">保守筛查，请核对配料标签</span></div>'
        );
      })() +
      (() => {
        if (!CMF.recipeCost) return "";
        const c = CMF.recipeCost(recipe, factor);
        if (!c) return "";
        return (
          '<div class="cost-line">💰 估算成本 <strong>¥' + c.total + "</strong>（当前 " + factor + "× 份量）" +
          (c.unknown ? " · " + c.unknown + " 样食材缺价格数据" : "") +
          '<span class="nutrition-note">家常估算价，非实时菜价</span></div>'
        );
      })() +
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
      "<div><h3>食材与用量</h3>" +
      '<div class="factor-stepper" style="display:flex;align-items:center;gap:8px;margin-bottom:10px">' +
      '<span style="font-size:13.5px">份量</span>' +
      FACTORS.map(
        (f) =>
          `<button class="btn btn-sm factor-btn${f === factor ? " factor-active" : ""}" data-factor="${f}">${f}×</button>`
      ).join("") +
      "</div>" +
      "<ul class='ingredient-list'>" + ingredientRows + "</ul></div>" +
      "<div><h3>做法步骤</h3>" +
      `<button class="btn btn-primary" id="start-cooking" style="margin-bottom:10px">🍳 开始烹饪</button>` +
      "<ol class='steps'>" +
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
      renderJournalPanel(recipe) +
      renderSimilar(recipe) +
      `<p style="font-size:12.5px;color:var(--ink-soft);margin-top:16px">来源：${CMF.esc(recipe.source)} · 许可证：${CMF.esc(recipe.license)}</p>` +
      "</article>";

    const favBtn = root.querySelector(".detail-fav");
    favBtn.onclick = () => {
      CMF.toggleFavorite(recipe.id);
      render(recipe);
    };

    const shareBtn = root.querySelector("#btn-share-card");
    shareBtn.onclick = () => {
      if (typeof CMF.openShareCard === "function") CMF.openShareCard(recipe);
      else CMF.toast("分享图模块未加载");
    };

    root.querySelectorAll(".factor-btn").forEach((btn) => {
      btn.onclick = () => {
        factor = parseFloat(btn.dataset.factor);
        render(recipe);
      };
    });

    root.querySelectorAll(".ing-name-btn").forEach((btn) => {
      btn.onclick = () => CMF.showIngredientInfo(btn.dataset.ing);
    });

    document.getElementById("start-cooking").onclick = () => openCookingMode(recipe);

    wireJournalPanel(recipe);

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

  let wakeLock = null;
  async function requestWakeLock() {
    try {
      if ("wakeLock" in navigator) {
        wakeLock = await navigator.wakeLock.request("screen");
      }
    } catch (e) {
      wakeLock = null; // not supported or denied; cooking mode still works
    }
  }
  function releaseWakeLock() {
    if (wakeLock) {
      wakeLock.release().catch(() => {});
      wakeLock = null;
    }
  }

  function openCookingMode(recipe) {
    const steps = recipe.steps;
    let index = 0;
    const overlay = document.createElement("div");
    overlay.className = "cooking-overlay";
    document.body.appendChild(overlay);

    // Kitchen timer state, kept across step re-renders.
    let tRemaining = 5 * 60;
    let tRunning = false;
    let tInterval = null;

    function beep() {
      try {
        const Ctx = window.AudioContext || window.webkitAudioContext;
        if (!Ctx) return;
        const ctx = new Ctx();
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.type = "sine";
        osc.frequency.value = 880;
        gain.gain.setValueAtTime(0.001, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.3, ctx.currentTime + 0.02);
        osc.start();
        osc.stop(ctx.currentTime + 0.9);
        osc.onended = () => ctx.close();
      } catch (e) {
        /* audio not available; visual alert still shows */
      }
    }

    function stopTick() {
      if (tInterval) {
        clearInterval(tInterval);
        tInterval = null;
      }
      tRunning = false;
    }

    function tick() {
      tRemaining -= 1;
      if (tRemaining <= 0) {
        tRemaining = 0;
        stopTick();
        beep();
      }
      renderTimer();
    }

    function toggleTimer() {
      if (tRunning) {
        stopTick();
      } else if (tRemaining > 0) {
        tRunning = true;
        tInterval = setInterval(tick, 1000);
      }
      renderTimer();
    }

    function renderTimer() {
      const display = overlay.querySelector("#timer-display");
      const toggle = overlay.querySelector("#timer-toggle");
      if (display) {
        display.textContent = CMF.formatTimer(tRemaining);
        display.classList.toggle("done", tRemaining === 0);
      }
      if (toggle) toggle.textContent = tRunning ? "暂停" : "开始";
    }

    function wireTimer() {
      overlay.querySelectorAll(".timer-preset").forEach((btn) => {
        btn.onclick = () => {
          stopTick();
          tRemaining = Number(btn.dataset.min) * 60;
          renderTimer();
        };
      });
      overlay.querySelector("#timer-toggle").onclick = toggleTimer;
      overlay.querySelector("#timer-reset").onclick = () => {
        stopTick();
        tRemaining = 5 * 60;
        renderTimer();
      };
      renderTimer();
    }

    function paint() {
      overlay.innerHTML =
        '<div class="cooking-card">' +
        `<div class="cooking-progress">第 ${index + 1} / ${steps.length} 步 · ${CMF.esc(recipe.title)}</div>` +
        `<div class="cooking-step">${CMF.esc(steps[index])}</div>` +
        '<div class="kitchen-timer">' +
        '<div class="timer-display" id="timer-display"></div>' +
        '<div class="timer-presets">' +
        [1, 3, 5, 10]
          .map(
            (m) =>
              `<button class="btn btn-sm timer-preset" data-min="${m}">${m} 分</button>`
          )
          .join("") +
        "</div>" +
        '<div class="timer-actions">' +
        '<button class="btn btn-sm" id="timer-toggle">开始</button>' +
        '<button class="btn btn-sm" id="timer-reset">重置</button>' +
        "</div></div>" +
        '<div class="cooking-controls">' +
        `<button class="btn" id="cook-prev" ${index === 0 ? "disabled" : ""}>上一步</button>` +
        (index === steps.length - 1
          ? '<button class="btn btn-primary" id="cook-done">完成 🎉</button>'
          : '<button class="btn btn-primary" id="cook-next">下一步</button>') +
        '<button class="btn" id="cook-close">退出</button>' +
        "</div></div>";
      overlay.querySelector("#cook-prev") &&
        (overlay.querySelector("#cook-prev").onclick = () => {
          if (index > 0) {
            index -= 1;
            paint();
            wireTimer();
          }
        });
      const next = overlay.querySelector("#cook-next");
      if (next)
        next.onclick = () => {
          if (index < steps.length - 1) {
            index += 1;
            paint();
            wireTimer();
          }
        };
      const done = overlay.querySelector("#cook-done");
      if (done)
        done.onclick = () => close();
      overlay.querySelector("#cook-close").onclick = () => close();
      wireTimer();
    }

    function close() {
      stopTick();
      releaseWakeLock();
      overlay.remove();
    }

    overlay.onkeydown = (e) => {
      if (e.key === "Escape") close();
    };
    requestWakeLock();
    paint();
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
