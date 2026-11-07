/* Multi-device sync without a backend, plus trackable share links.

Everything stays on the device: a snapshot of the localStorage state is
serialised with short keys, encoded as a URL-safe sync code, and either copied,
scanned as a QR code, or saved as a JSON file. Opening a link with
#sync=<code> imports it (after explicit user confirmation in the UI).

Share links carry UTM parameters so any site analytics can count them, and a
local counter records share actions. A shortlink endpoint is optional: when
configured, resolveShareLink() asks it for a shorter URL and silently falls
back to the original link when offline. */
(function () {
  "use strict";

  const CMF = window.CMF;
  const B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
  const MAGIC = "S1";
  const SHORT_MAGIC = "Z"; // QR-only: compressed
  const SHORT_RAW_MAGIC = "R"; // QR-only: raw when LZ77 would only add bytes

  // Short keys keep the QR payload small; full names stay in localStorage.
  const KEY_MAP = {
    f: "cmf.fridge",
    h: "cmf.history",
    fb: "cmf.feedback",
    p: "cmf.prefs",
    pl: "cmf.plan",
    fav: "cmf.favorites",
    w: "cmf.week",
    u: "cmf.urgent",
    g: "cmf.goals",
    s: "cmf.shareStats",
    j: "cmf.journal",
  };
  const REVERSE = Object.fromEntries(
    Object.entries(KEY_MAP).map(([short, key]) => [key, short])
  );
  const KNOWN = new Set(Object.values(KEY_MAP));
  // Preferences, fridge, favourites, allergens, urgent items and goals.
  // The (potentially 56-meal) menu is deliberately excluded from QR sync.
  const SLIM_KEYS = ["cmf.fridge", "cmf.prefs", "cmf.favorites", "cmf.urgent", "cmf.goals"];

  CMF.SYNC_KEY_MAP = Object.assign({}, KEY_MAP);
  CMF.SYNC_SLIM_KEYS = SLIM_KEYS.slice();
  CMF.SYNC_SHORTLINK_ENDPOINT = "";

  function readRaw(key) {
    try {
      const raw = localStorage.getItem(key);
      if (!raw) return null;
      return JSON.parse(raw);
    } catch (e) {
      return null;
    }
  }

  function writeRaw(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
      return true;
    } catch (e) {
      return false;
    }
  }

  function bytesToCode(bytes) {
    let out = "";
    for (let i = 0; i < bytes.length; i += 3) {
      const a = bytes[i];
      const b = i + 1 < bytes.length ? bytes[i + 1] : undefined;
      const c = i + 2 < bytes.length ? bytes[i + 2] : undefined;
      const n = (a << 16) | ((b || 0) << 8) | (c || 0);
      out += B64[(n >>> 18) & 63] + B64[(n >>> 12) & 63];
      if (b !== undefined) out += B64[(n >>> 6) & 63];
      if (c !== undefined) out += B64[n & 63];
    }
    return out;
  }

  function codeToBytes(text) {
    if (!/^[A-Za-z0-9_-]*$/.test(text)) throw new Error("同步码含非法字符");
    const out = [];
    for (let i = 0; i < text.length; i += 4) {
      const chunk = text.slice(i, i + 4);
      const v = Array.from(chunk, (ch) => B64.indexOf(ch));
      const n = (v[0] << 18) | (v[1] << 12) | ((v[2] || 0) << 6) | (v[3] || 0);
      out.push((n >>> 16) & 255);
      if (chunk.length > 2) out.push((n >>> 8) & 255);
      if (chunk.length > 3) out.push(n & 255);
    }
    return Uint8Array.from(out);
  }

  /* Small synchronous LZ77 (4 KiB window, max 18-byte match). JSON keys and
     repeated ingredient names compress well enough for a QR code, even when
     the encoder has to pick a higher version; no CompressionStream, no async,
     identical output in Node and browsers. */
  function lzCompress(bytes) {
    const out = [];
    let literals = [];
    function flush() {
      for (let i = 0; i < literals.length; i += 127) {
        const chunk = literals.slice(i, i + 127);
        out.push(chunk.length);
        for (const byte of chunk) out.push(byte);
      }
      literals = [];
    }
    let i = 0;
    while (i < bytes.length) {
      const windowStart = Math.max(0, i - 4096);
      const maxLen = Math.min(18, bytes.length - i);
      let bestLen = 0;
      let bestOffset = 0;
      if (maxLen >= 3) {
        for (let start = windowStart; start < i; start += 1) {
          let len = 0;
          while (len < maxLen && bytes[start + len] === bytes[i + len]) len += 1;
          if (len > bestLen) {
            bestLen = len;
            bestOffset = i - start;
            if (bestLen === maxLen) break;
          }
        }
      }
      if (bestLen >= 3) {
        flush();
        out.push(0x80 | (bestLen - 3), (bestOffset >>> 8) & 255, bestOffset & 255);
        i += bestLen;
      } else {
        literals.push(bytes[i]);
        i += 1;
      }
    }
    flush();
    return Uint8Array.from(out);
  }

  function lzDecompress(bytes) {
    const out = [];
    let i = 0;
    while (i < bytes.length) {
      const ctrl = bytes[i];
      i += 1;
      if (ctrl < 0x80) {
        if (i + ctrl > bytes.length) throw new Error("压缩数据不完整");
        for (let k = 0; k < ctrl; k += 1) out.push(bytes[i + k]);
        i += ctrl;
      } else {
        if (ctrl > 0x8f) throw new Error("压缩数据无效");
        if (i + 2 > bytes.length) throw new Error("压缩数据不完整");
        const len = (ctrl & 0x0f) + 3;
        const offset = (bytes[i] << 8) | bytes[i + 1];
        i += 2;
        if (offset <= 0 || offset > out.length) throw new Error("压缩数据无效");
        for (let k = 0; k < len; k += 1) out.push(out[out.length - offset]);
      }
    }
    return Uint8Array.from(out);
  }

  CMF.lzCompress = lzCompress;
  CMF.lzDecompress = lzDecompress;
  CMF.bytesToSyncCode = bytesToCode;
  CMF.syncCodeToBytes = codeToBytes;

  /* Build a snapshot. `slim` limits it to what a QR code can reasonably hold. */
  CMF.syncPayload = function (opts) {
    const options = opts || {};
    const keys = options.slim ? SLIM_KEYS : Object.values(KEY_MAP)
      .filter((key) => key !== "cmf.shareStats");
    const d = {};
    keys.forEach((key) => {
      const value = readRaw(key);
      if (value != null) d[REVERSE[key] || key] = value;
    });
    return {
      v: 1,
      k: "cmf-sync",
      t: new Date().toISOString(),
      slim: Boolean(options.slim),
      d,
    };
  };

  /* Accept our compact shape and the older exportData() backup shape. */
  CMF.normalizeSyncPayload = function (payload) {
    if (!payload || typeof payload !== "object") throw new Error("同步数据格式不正确");
    if (payload.d && typeof payload.d === "object" && !Array.isArray(payload.d) &&
        (payload.k === undefined || payload.k === "cmf-sync") &&
        (payload.v === undefined || payload.v === 1)) {
      // Compact shape used for QR codes: metadata fields are optional.
      return payload;
    }
    if (payload.data && typeof payload.data === "object" && !Array.isArray(payload.data)) {
      return { v: 1, k: "cmf-sync", t: payload.exportedAt || "", slim: false, d: payload.data };
    }
    throw new Error("同步数据格式不正确");
  };

  CMF.syncEncode = function (payload, opts) {
    const clean = CMF.normalizeSyncPayload(payload);
    const raw = new TextEncoder().encode(JSON.stringify(clean));
    const packed = lzCompress(raw);
    const compressed = packed.length < raw.length;
    const short = Boolean(opts && opts.short);
    const magic = short
      ? compressed ? SHORT_MAGIC : SHORT_RAW_MAGIC
      : compressed ? "S1Z" : MAGIC;
    const body = compressed ? packed : raw;
    return magic + "." + bytesToCode(body);
  };

  CMF.syncDecode = function (code) {
    const text = String(code || "").trim().replace(/^#?(?:sync|s)=/, "");
    const dot = text.indexOf(".");
    const magic = dot < 0 ? "" : text.slice(0, dot);
    if (magic !== "S1" && magic !== "S1Z" && magic !== SHORT_MAGIC &&
        magic !== SHORT_RAW_MAGIC) {
      throw new Error("同步码格式不正确（应为 S1. / S1Z. / Z. / R. 开头）");
    }
    let payload;
    try {
      let bytes = codeToBytes(text.slice(dot + 1));
      if (magic === "S1Z" || magic === SHORT_MAGIC) bytes = lzDecompress(bytes);
      payload = JSON.parse(new TextDecoder().decode(bytes));
    } catch (e) {
      throw new Error("同步码已损坏，无法解析");
    }
    return CMF.normalizeSyncPayload(payload);
  };

  CMF.syncFromHash = function (hash) {
    const value = String(hash === undefined
      ? (typeof location !== "undefined" ? location.hash : "")
      : hash).replace(/^#/, "");
    if (!value) return null;
    try {
      const params = new URLSearchParams(value);
      const code = params.get("sync") || params.get("s");
      return code || null;
    } catch (e) {
      return null;
    }
  };

  CMF.syncShareURL = function (code, opts) {
    const options = opts || {};
    let base = options.url;
    if (!base) {
      base = typeof location !== "undefined" && location.href
        ? new URL("index.html", location.href).href
        : "index.html";
    }
    const key = options.short ? "s" : "sync";
    return String(base).split("#")[0] + "#" + key + "=" + code;
  };

  /* QR feasibility check: never let an overlong payload break a share card.
     The encoder covers EC-M v1-v40 (up to 2331 bytes), so a normal fridge
     snapshot fits. `modules` lets the caller size the canvas so dense,
     high-version symbols stay scannable rather than being squeezed to 1px. */
  CMF.syncQRInfo = function (payload, opts) {
    const options = opts || {};
    function attempt(data) {
      const code = CMF.syncEncode(data, { short: true });
      const url = CMF.syncShareURL(code, { ...options, short: true });
      const bytes = new TextEncoder().encode(url).length;
      let version = null;
      let modules = 0;
      if (typeof CMF.qrMatrix === "function") {
        try {
          const qr = CMF.qrMatrix(url);
          version = qr.version;
          modules = qr.size;
        } catch (e) {
          version = null;
        }
      }
      return {
        code, url, bytes, version, modules,
        fits: version !== null, trimmed: false,
      };
    }
    let info = attempt(payload);
    // Only an exceptionally large snapshot exceeds v40/EC-M. In that case
    // drop to the settings that matter most instead of giving up entirely.
    if (!info.fits && !options.noTrim) {
      const d = {};
      const prefs = payload.d.p != null ? payload.d.p : payload.d["cmf.prefs"];
      const goals = payload.d.g != null ? payload.d.g : payload.d["cmf.goals"];
      if (prefs != null) d.p = prefs;
      if (goals != null) {
        const gp = goals.profile || goals.p || goals;
        // One-letter fields are understood by goals.js sanitization.
        d.g = { e: 1, p: {
          s: gp.sex ?? gp.s, a: gp.age ?? gp.a, h: gp.heightCm ?? gp.h,
          w: gp.weightKg ?? gp.w, v: gp.activity ?? gp.v, m: gp.mode ?? gp.m,
          n: gp.people ?? gp.n, c: gp.mealsPerDay ?? gp.c,
        } };
      }
      if (Object.keys(d).length) {
        const smaller = attempt({ d });
        if (smaller.fits) {
          smaller.trimmed = true;
          info = smaller;
        }
      }
    }
    return info;
  };

  function mergeValue(key, incoming) {
    const local = readRaw(key);
    if (key === "cmf.journal") return CMF.mergeJournals(local, incoming);
    if (Array.isArray(incoming) && Array.isArray(local)) {
      return [...new Set([...local, ...incoming])];
    }
    if (incoming && local && typeof incoming === "object" && typeof local === "object" &&
        !Array.isArray(incoming) && !Array.isArray(local)) {
      return { ...local, ...incoming };
    }
    return incoming;
  }

  CMF.applySyncPayload = function (payload, opts) {
    const clean = CMF.normalizeSyncPayload(payload);
    const options = opts || {};
    const mode = options.mode === "merge" ? "merge" : "replace";
    const keys = [];
    Object.entries(clean.d).forEach(([short, value]) => {
      const key = short.startsWith("cmf.") ? short : KEY_MAP[short];
      if (!key || !KNOWN.has(key) || value == null) return;
      const next = mode === "merge" ? mergeValue(key, value) : value;
      if (writeRaw(key, next)) keys.push(key);
    });
    if (!keys.length) throw new Error("同步数据里没有可用的项目");
    return { count: keys.length, keys, mode, exportedAt: clean.t || "", slim: Boolean(clean.slim) };
  };

  /* Read a #sync= fragment, optionally ask for confirmation, and import. */
  CMF.consumeSyncHash = function (opts) {
    const options = opts || {};
    const code = CMF.syncFromHash(options.hash);
    if (!code) return null;
    const payload = CMF.syncDecode(code);
    if (typeof options.confirm === "function" && !options.confirm(payload)) return null;
    const report = CMF.applySyncPayload(payload, options);
    return { ...report, code };
  };

  /* --- Trackable share links --- */

  CMF.shareLink = function (recipe, opts) {
    const options = opts || {};
    const base = typeof CMF.shareUrl === "function"
      ? CMF.shareUrl(recipe, options) : "";
    if (!base) return "";
    try {
      const fallbackBase = options.baseUrl ||
        (typeof location !== "undefined" && location.href ? location.href : "https://example.com/");
      const url = new URL(base, fallbackBase);
      url.searchParams.set("utm_source", "cmf_share");
      url.searchParams.set("utm_medium", options.medium || "link");
      url.searchParams.set("utm_campaign", "recipe");
      if (recipe && recipe.id) url.searchParams.set("utm_content", recipe.id);
      return url.href;
    } catch (e) {
      return base;
    }
  };

  CMF.getShareStats = function () {
    const value = readRaw("cmf.shareStats");
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      return { total: 0, byKind: {}, byRecipe: {}, lastAt: "" };
    }
    return {
      total: Number(value.total) || 0,
      byKind: value.byKind && typeof value.byKind === "object" ? value.byKind : {},
      byRecipe: value.byRecipe && typeof value.byRecipe === "object" ? value.byRecipe : {},
      lastAt: value.lastAt || "",
    };
  };

  CMF.trackShare = function (kind, recipeId) {
    const stats = CMF.getShareStats();
    const key = String(kind || "link");
    stats.total += 1;
    stats.byKind[key] = (stats.byKind[key] || 0) + 1;
    if (recipeId) {
      const id = String(recipeId);
      stats.byRecipe[id] = (stats.byRecipe[id] || 0) + 1;
    }
    stats.lastAt = new Date().toISOString();
    writeRaw("cmf.shareStats", stats);
    return stats;
  };

  /* Optional shortener. Static hosting has no backend, so the direct UTM
     link is always a valid fallback (including offline). */
  CMF.resolveShareLink = async function (url, opts) {
    const options = opts || {};
    const endpoint = options.endpoint || CMF.SYNC_SHORTLINK_ENDPOINT;
    if (!endpoint || typeof fetch !== "function") return url;
    try {
      const separator = String(endpoint).includes("?") ? "&" : "?";
      const resp = await fetch(String(endpoint) + separator + "url=" + encodeURIComponent(url));
      if (!resp.ok) return url;
      const data = await resp.json();
      return data && typeof data.short === "string" && /^https?:\/\//.test(data.short)
        ? data.short : url;
    } catch (e) {
      return url;
    }
  };

  /* Opening a #sync= link on another device asks before importing. Merge is
     the default so arriving data never silently deletes local favourites. */
  function stripHash() {
    try {
      if (typeof history !== "undefined" && history.replaceState) {
        history.replaceState(null, "", location.pathname + location.search);
      }
    } catch (e) { /* file:// or restricted context: ignore */ }
  }

  if (typeof window !== "undefined" && typeof document !== "undefined" &&
      typeof window.addEventListener === "function") {
    window.addEventListener("load", () => {
      const code = CMF.syncFromHash();
      if (!code) return;
      let payload;
      try {
        payload = CMF.syncDecode(code);
      } catch (e) {
        if (CMF.toast) CMF.toast("同步链接无效：" + e.message);
        stripHash();
        return;
      }
      const count = Object.keys(payload.d).length;
      const message = "检测到来自其他设备的同步数据（" + count + " 项），是否合并到本机？\n" +
        "合并会保留本机已有的冰箱食材与收藏；取消则不做任何改动。";
      if (typeof window.confirm === "function" && !window.confirm(message)) {
        stripHash();
        return;
      }
      try {
        const report = CMF.applySyncPayload(payload, { mode: "merge" });
        stripHash();
        if (CMF.toast) CMF.toast("已同步 " + report.count + " 项数据");
        setTimeout(() => location.reload(), 700);
      } catch (e) {
        if (CMF.toast) CMF.toast("同步失败：" + e.message);
        stripHash();
      }
    });
  }
})();
