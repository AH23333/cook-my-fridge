/* Ingredient pairing recommendations derived from recipe co-occurrence.
   Two ingredients that appear together in many recipes are treated as a
   classic pairing. Fully offline, data-driven, no hard-coded pairs.
   Pantry staples (salt, oil, ...) are excluded from recommendations because
   they co-occur with everything and carry no pairing signal. */
(function () {
  "use strict";

  const CMF = (window.CMF = window.CMF || {});

  let pairIndex = {};
  let perIngredient = {};
  let isStaple = () => false;

  function pairKey(a, b) {
    return a < b ? a + "||" + b : b + "||" + a;
  }

  /* opts.isStaple can be injected for headless tests; otherwise it falls
     back to the catalog helper installed by catalog.js (or a no-op). */
  CMF.buildPairingIndex = function (recipes, opts) {
    const options = opts || {};
    isStaple =
      typeof options.isStaple === "function"
        ? options.isStaple
        : typeof CMF.isStaple === "function"
          ? CMF.isStaple
          : () => false;
    pairIndex = {};
    perIngredient = {};
    (recipes || []).forEach((r) => {
      const names = [
        ...new Set(
          (r.ingredients || [])
            .filter((i) => i && !i.optional && i.canonical)
            .map((i) => i.canonical)
        ),
      ];
      for (let i = 0; i < names.length; i++) {
        for (let j = i + 1; j < names.length; j++) {
          const key = pairKey(names[i], names[j]);
          pairIndex[key] = (pairIndex[key] || 0) + 1;
        }
      }
    });
  };

  CMF.topPairings = function (canonical, limit) {
    if (!canonical) return [];
    if (!perIngredient[canonical]) {
      const counts = [];
      Object.keys(pairIndex).forEach((key) => {
        const parts = key.split("||");
        let other = null;
        if (parts[0] === canonical) other = parts[1];
        else if (parts[1] === canonical) other = parts[0];
        if (other && !isStaple(other)) {
          counts.push({ canonical: other, count: pairIndex[key] });
        }
      });
      counts.sort((a, b) => {
        if (b.count !== a.count) return b.count - a.count;
        if (a.canonical === b.canonical) return 0;
        return a.canonical < b.canonical ? -1 : 1;
      });
      perIngredient[canonical] = counts;
    }
    const n = limit == null ? 6 : Math.max(0, limit);
    return perIngredient[canonical].slice(0, n);
  };
})();
