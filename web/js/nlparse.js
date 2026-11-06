/* Offline natural-language ingredient parser.
   Scans free text for known canonicals/synonyms using greedy longest match,
   so multi-word names (e.g. 橄榄油) win over short substrings (e.g. 油). */
(function () {
  "use strict";

  const CMF = (window.CMF = window.CMF || {});

  function buildSurfaces() {
    const surfaces = [];
    for (const entry of CMF.allIngredients()) {
      const names = new Set([entry.canonical, ...entry.synonyms]);
      for (const name of names) {
        if (name && name.length) surfaces.push({ name, canonical: entry.canonical });
      }
    }
    // Longest first; ties resolved alphabetically for determinism.
    surfaces.sort((a, b) => {
      if (b.name.length !== a.name.length) return b.name.length - a.name.length;
      return a.name < b.name ? -1 : a.name > b.name ? 1 : 0;
    });
    return surfaces;
  }

  function normalizeText(raw) {
    return String(raw || "")
      .toLowerCase()
      .replace(/[Ａ-Ｚａ-ｚ０-９]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0xfee0))
      .replace(/[，。！？；：、,.!?;:]/g, " ");
  }

  CMF.parseIngredients = function (raw) {
    const text = normalizeText(raw);
    if (!text) return [];
    const consumed = new Array(text.length).fill(false);
    const found = [];
    const seen = new Set();

    for (const surface of buildSurfaces()) {
      const key = surface.name.toLowerCase();
      let from = 0;
      while (true) {
        const idx = text.indexOf(key, from);
        if (idx === -1) break;
        const end = idx + key.length;
        let overlap = false;
        for (let p = idx; p < end; p++) {
          if (consumed[p]) {
            overlap = true;
            break;
          }
        }
        if (!overlap) {
          for (let p = idx; p < end; p++) consumed[p] = true;
          if (!seen.has(surface.canonical)) {
            seen.add(surface.canonical);
            found.push(surface.canonical);
          }
        }
        from = end;
      }
    }
    return found;
  };
})();
