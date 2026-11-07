/* Recipe share card: draw a ready-to-post PNG with the Canvas 2D API.
   All drawing goes through a small set of primitives so a headless harness can
   assert the exact text that ends up on the card without a real browser. */
(function () {
  "use strict";

  const CMF = window.CMF;
  const WIDTH = 800;
  const HEIGHT = 1200;
  const FONT = '"PingFang SC", "Microsoft YaHei", "Segoe UI", sans-serif';

  const COLORS = {
    bg: "#faf6ef",
    brand: "#e8552f",
    brandDark: "#c9421f",
    amber: "#f4a73d",
    ink: "#2c2620",
    soft: "#6f655b",
    line: "#e6dccb",
    card: "#fffdf9",
    white: "#ffffff",
    green: "#4f9d5b",
  };

  function font(ctx, size, weight) {
    ctx.font = `${weight || 400} ${size}px ${FONT}`;
  }

  /* Character-count wrapping keeps the layout deterministic across platforms
     (no measureText dependency and no font-metric surprises in headless tests). */
  function wrap(text, maxChars, maxLines) {
    const chars = Array.from(String(text || ""));
    const lines = [];
    let current = "";
    chars.forEach((ch) => {
      current += ch;
      if (current.length >= maxChars) {
        lines.push(current);
        current = "";
      }
    });
    if (current) lines.push(current);
    if (!lines.length) lines.push("");
    if (lines.length > maxLines) {
      const kept = lines.slice(0, maxLines);
      kept[maxLines - 1] = kept[maxLines - 1].slice(0, maxChars - 1) + "…";
      return kept;
    }
    return lines;
  }

  function text(ctx, value, x, y, size, color, weight) {
    font(ctx, size, weight);
    ctx.fillStyle = color;
    ctx.fillText(value, x, y);
  }

  function rect(ctx, x, y, w, h, color) {
    ctx.fillStyle = color;
    ctx.fillRect(x, y, w, h);
  }

  CMF.shareText = function (recipe) {
    if (!recipe) return "";
    const lines = [
      "🍳 " + recipe.title + " · CookMyFridge",
      `⏱ ${recipe.time_minutes} 分钟 · 🎯 ${recipe.difficulty} · 🍳 ${(recipe.methods || []).join("/")}`,
      "",
      "食材：",
      ...(recipe.ingredients || []).map(
        (i) => `· ${i.canonical} ${i.amount || ""}`.trim() + (i.optional ? "（可选）" : "")
      ),
    ];
    const est = CMF.estimateNutrition ? CMF.estimateNutrition(recipe) : null;
    if (est) {
      lines.push("");
      lines.push(
        `营养估算（每份，约）：${est.perServing.kcal} kcal · 蛋白 ${est.perServing.protein} g · 脂肪 ${est.perServing.fat} g · 碳水 ${est.perServing.carbs} g`
      );
    }
    if (recipe.is_ai_generated) lines.push("AI 创意菜，未经过人工实测。");
    lines.push("");
    lines.push("别点外卖，让冰箱开饭。数据仅供参考，不能替代食品标签与专业建议。");
    return lines.join("\n");
  };

  CMF.shareFileName = function (recipe) {
    const safe = String((recipe && recipe.title) || "recipe")
      .replace(/[\\/:*?"<>|\s]+/g, "-")
      .slice(0, 40);
    return "CookMyFridge-" + safe + ".png";
  };

  /* Returns a canvas. `opts.doc` allows injection in headless tests. */
  CMF.drawShareCanvas = function (recipe, opts) {
    const doc = (opts && opts.doc) || (typeof document !== "undefined" ? document : null);
    if (!doc) throw new Error("canvas requires a document");
    const canvas = doc.createElement("canvas");
    canvas.width = WIDTH;
    canvas.height = HEIGHT;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("canvas 2d context unavailable");

    rect(ctx, 0, 0, WIDTH, HEIGHT, COLORS.bg);
    if (ctx.createLinearGradient) {
      const grad = ctx.createLinearGradient(0, 0, WIDTH, 260);
      grad.addColorStop(0, COLORS.brand);
      grad.addColorStop(1, COLORS.amber);
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, WIDTH, 260);
    } else {
      rect(ctx, 0, 0, WIDTH, 260, COLORS.brand);
    }

    text(ctx, "CookMyFridge", 56, 82, 30, COLORS.white, 700);
    text(ctx, "Don't order. CookMyFridge.", 56, 126, 20, COLORS.white, 400);
    if (recipe.is_ai_generated) {
      rect(ctx, 560, 46, 184, 44, "rgba(255,255,255,0.28)");
      text(ctx, "AI 创意 · 未实测", 574, 77, 18, COLORS.white, 600);
    }
    const first = (recipe.ingredients || [])[0];
    const emoji = first && typeof CMF.emojiOf === "function"
      ? CMF.emojiOf(first.canonical)
      : "🍽️";
    text(ctx, emoji, WIDTH / 2 - 60, 230, 110, COLORS.white, 400);

    const titleLines = wrap(recipe.title, 13, 2);
    titleLines.forEach((line, i) => {
      text(ctx, line, 56, 340 + i * 62, 48, COLORS.ink, 800);
    });
    text(
      ctx,
      `⏱ ${recipe.time_minutes} 分钟   ·   🎯 ${recipe.difficulty}   ·   🍳 ${(recipe.methods || []).join("/")}`,
      56, 480, 23, COLORS.soft, 500
    );
    rect(ctx, 56, 512, WIDTH - 112, 2, COLORS.line);

    text(ctx, "食材与用量", 56, 572, 30, COLORS.brandDark, 700);
    const uses = (recipe.ingredients || []).slice(0, 8);
    uses.forEach((use, i) => {
      const y = 626 + i * 38;
      rect(ctx, 56, y - 22, 8, 8, COLORS.amber);
      const amount = (use.amount || "").trim();
      text(
        ctx,
        `${use.canonical}${amount ? "  " + amount : ""}${use.optional ? "（可选）" : ""}`,
        78, y, 23, COLORS.ink, 400
      );
    });
    if ((recipe.ingredients || []).length > 8) {
      text(ctx, `…等共 ${recipe.ingredients.length} 样食材`, 78, 626 + 8 * 38, 20, COLORS.soft, 400);
    }

    // Nutrition block
    rect(ctx, 56, 940, WIDTH - 112, 164, COLORS.card);
    rect(ctx, 56, 940, WIDTH - 112, 4, COLORS.brand);
    text(ctx, "营养估算 · 每份", 80, 986, 24, COLORS.brandDark, 700);
    const est = CMF.estimateNutrition ? CMF.estimateNutrition(recipe) : null;
    const cells = est
      ? [
          ["热量", est.perServing.kcal + " kcal"],
          ["蛋白质", est.perServing.protein + " g"],
          ["脂肪", est.perServing.fat + " g"],
          ["碳水", est.perServing.carbs + " g"],
        ]
      : [["热量", "—"], ["蛋白质", "—"], ["脂肪", "—"], ["碳水", "—"]];
    cells.forEach(([label, value], i) => {
      const x = 80 + i * 176;
      text(ctx, label, x, 1028, 18, COLORS.soft, 400);
      text(ctx, value, x, 1066, 26, i === 0 ? COLORS.brandDark : COLORS.ink, 700);
    });
    if (est) {
      text(ctx, `共 ${est.servings} 份 · 估算值，未计烹饪损耗`, 80, 1092, 15, COLORS.soft, 400);
    }

    text(ctx, "别点外卖，让冰箱开饭。", 56, 1132, 22, COLORS.green, 700);
    wrap(est ? est.note : "数据仅供参考。", 46, 2).forEach((line, i) => {
      text(ctx, line, 56, 1160 + i * 21, 13, COLORS.soft, 400);
    });
    return canvas;
  };

  CMF.openShareCard = function (recipe) {
    if (typeof document === "undefined") return false;
    let canvas;
    try {
      canvas = CMF.drawShareCanvas(recipe);
    } catch (err) {
      CMF.toast("当前浏览器不支持生成分享图");
      return false;
    }
    const url = canvas.toDataURL("image/png");
    const overlay = document.createElement("div");
    overlay.className = "modal-overlay share-overlay";
    overlay.innerHTML =
      '<div class="modal share-modal" role="dialog" aria-modal="true" aria-label="分享图">' +
      '<button class="modal-close" aria-label="关闭">×</button>' +
      '<h3>🖼️ 菜谱分享图</h3>' +
      `<img class="share-preview" src="${url}" alt="${CMF.esc(recipe.title)} 分享图">` +
      '<div class="share-actions">' +
      '<button class="btn btn-primary btn-sm" id="share-download">⬇️ 下载 PNG</button>' +
      '<button class="btn btn-sm" id="share-copy">📋 复制文字</button>' +
      '<button class="btn btn-sm" id="share-native">📤 系统分享</button>' +
      "</div>" +
      '<p class="share-note">图片在本地生成，不上传任何数据。营养数值为估算，仅供参考。</p>' +
      "</div>";

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
    document.body.appendChild(overlay);

    overlay.querySelector("#share-download").onclick = () => {
      const a = document.createElement("a");
      a.href = url;
      a.download = CMF.shareFileName(recipe);
      document.body.appendChild(a);
      a.click();
      a.remove();
      CMF.toast("分享图已保存");
    };
    overlay.querySelector("#share-copy").onclick = () => {
      CMF.copyText(CMF.shareText(recipe))
        .then((ok) => CMF.toast(ok ? "菜谱文字已复制" : "复制失败，请手动选择"))
        .catch(() => CMF.toast("复制失败，请手动选择"));
    };
    overlay.querySelector("#share-native").onclick = async () => {
      const payload = {
        title: recipe.title + " · CookMyFridge",
        text: CMF.shareText(recipe),
        url: location.href,
      };
      if (navigator.share) {
        try {
          await navigator.share(payload);
          return;
        } catch (err) {
          /* user cancelled or unsupported payload: fall through to copy */
        }
      }
      CMF.copyText(CMF.shareText(recipe)).then(() => CMF.toast("已复制菜谱文字"));
    };
    return true;
  };
})();
