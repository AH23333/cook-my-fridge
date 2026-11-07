/* Minimal, dependency-free QR Code encoder (byte mode, EC level M, v1-v40).
   Implements ISO/IEC 18004 bitstream + Reed-Solomon + matrix layout so the
   share card and the sync panel can carry a scannable link without any
   network request. The full v1-v40 range matters for sync links: a real
   fridge snapshot is 400-600 bytes, well beyond the 213-byte v10 limit.
   Public API: qrMatrix(text, opts), qrCapacity(version), drawQR(ctx, ...). */
(function () {
  "use strict";

  const CMF = window.CMF;
  const MIN_VERSION = 1;
  const MAX_VERSION = 40;

  // EC level M tables (ISO/IEC 18004). Index = version.
  // Verified against the segno reference tables for every version 1-40.
  const ECC_PER_BLOCK = [
    0, 10, 16, 26, 18, 24, 16, 18, 22, 22,
    26, 30, 22, 22, 24, 24, 28, 28, 26, 26,
    26, 26, 28, 28, 28, 28, 28, 28, 28, 28,
    28, 28, 28, 28, 28, 28, 28, 28, 28, 28,
    28,
  ];
  const NUM_BLOCKS = [
    0, 1, 1, 1, 2, 2, 4, 4, 4, 5,
    5, 5, 8, 9, 9, 10, 10, 11, 13, 14,
    16, 17, 17, 18, 20, 21, 23, 25, 26, 28,
    29, 31, 33, 35, 37, 38, 40, 43, 45, 47,
    49,
  ];
  const RAW_CODEWORDS = [
    0, 26, 44, 70, 100, 134, 172, 196, 242, 292,
    346, 404, 466, 532, 581, 655, 733, 815, 901, 991,
    1085, 1156, 1258, 1364, 1474, 1588, 1706, 1828, 1921, 2051,
    2185, 2323, 2465, 2611, 2761, 2876, 3034, 3196, 3362, 3532,
    3706,
  ];
  // Index = version (0 and 1 are placeholders: v1 has no alignment pattern).
  // v32 is the spec's special case; it cannot be derived from the step formula.
  const ALIGN_CENTERS = [
    [], [],
    [6, 18], [6, 22], [6, 26], [6, 30], [6, 34],
    [6, 22, 38], [6, 24, 42], [6, 26, 46], [6, 28, 50],
    [6, 30, 54], [6, 32, 58], [6, 34, 62],
    [6, 26, 46, 66], [6, 26, 48, 70], [6, 26, 50, 74],
    [6, 30, 54, 78], [6, 30, 56, 82], [6, 30, 58, 86],
    [6, 34, 62, 90],
    [6, 28, 50, 72, 94], [6, 26, 50, 74, 98], [6, 30, 54, 78, 102],
    [6, 28, 54, 80, 106], [6, 32, 58, 84, 110], [6, 30, 58, 86, 114],
    [6, 34, 62, 90, 118],
    [6, 26, 50, 74, 98, 122], [6, 30, 54, 78, 102, 126],
    [6, 26, 52, 78, 104, 130], [6, 30, 56, 82, 108, 134],
    [6, 34, 60, 86, 112, 138], [6, 30, 58, 86, 114, 142],
    [6, 34, 62, 90, 118, 146],
    [6, 30, 54, 78, 102, 126, 150], [6, 24, 50, 76, 102, 128, 154],
    [6, 28, 54, 80, 106, 132, 158], [6, 32, 58, 84, 110, 136, 162],
    [6, 26, 54, 82, 110, 138, 166], [6, 30, 58, 86, 114, 142, 170],
  ];

  function utf8Bytes(text) {
    const out = [];
    for (let i = 0; i < text.length; i += 1) {
      let cp = text.charCodeAt(i);
      if (cp >= 0xd800 && cp <= 0xdbff && i + 1 < text.length) {
        const low = text.charCodeAt(i + 1);
        if (low >= 0xdc00 && low <= 0xdfff) {
          cp = 0x10000 + ((cp - 0xd800) << 10) + (low - 0xdc00);
          i += 1;
        }
      }
      if (cp < 0x80) out.push(cp);
      else if (cp < 0x800) out.push(0xc0 | (cp >> 6), 0x80 | (cp & 63));
      else if (cp < 0x10000) {
        out.push(0xe0 | (cp >> 12), 0x80 | ((cp >> 6) & 63), 0x80 | (cp & 63));
      } else {
        out.push(
          0xf0 | (cp >> 18), 0x80 | ((cp >> 12) & 63),
          0x80 | ((cp >> 6) & 63), 0x80 | (cp & 63)
        );
      }
    }
    return out;
  }

  /* --- GF(256) arithmetic, primitive polynomial x^8+x^4+x^3+x^2+1 --- */
  function gfMul(x, y) {
    let z = 0;
    for (let i = 7; i >= 0; i -= 1) {
      z = (z << 1) ^ ((z >>> 7) * 0x11d);
      z ^= ((y >>> i) & 1) * x;
    }
    return z & 0xff;
  }

  function rsDivisor(degree) {
    const result = new Array(degree).fill(0);
    result[degree - 1] = 1;
    let root = 1;
    for (let i = 0; i < degree; i += 1) {
      for (let j = 0; j < result.length; j += 1) {
        result[j] = gfMul(result[j], root);
        if (j + 1 < result.length) result[j] ^= result[j + 1];
      }
      root = gfMul(root, 0x02);
    }
    return result;
  }

  function rsRemainder(data, divisor) {
    const result = divisor.map(() => 0);
    data.forEach((b) => {
      const factor = b ^ result.shift();
      result.push(0);
      divisor.forEach((coef, i) => {
        result[i] ^= gfMul(coef, factor);
      });
    });
    return result;
  }

  function dataCodewordCount(version) {
    return RAW_CODEWORDS[version] - ECC_PER_BLOCK[version] * NUM_BLOCKS[version];
  }

  CMF.qrCapacity = function (version) {
    if (!Number.isInteger(version) || version < MIN_VERSION || version > MAX_VERSION) return 0;
    const header = 4 + (version <= 9 ? 8 : 16);
    return Math.floor((dataCodewordCount(version) * 8 - header) / 8);
  };

  function appendBits(bits, value, length) {
    for (let i = length - 1; i >= 0; i -= 1) bits.push((value >>> i) & 1);
  }

  function dataCodewords(bytes, version) {
    const capacity = dataCodewordCount(version) * 8;
    const bits = [];
    appendBits(bits, 0x4, 4); // byte mode
    appendBits(bits, bytes.length, version <= 9 ? 8 : 16);
    bytes.forEach((b) => appendBits(bits, b, 8));
    const terminator = Math.min(4, capacity - bits.length);
    for (let i = 0; i < terminator; i += 1) bits.push(0);
    while (bits.length % 8 !== 0) bits.push(0);
    for (let i = 0; bits.length < capacity; i += 1) {
      appendBits(bits, i % 2 === 0 ? 0xec : 0x11, 8);
    }
    const out = [];
    for (let i = 0; i < bits.length; i += 8) {
      let byte = 0;
      for (let j = 0; j < 8; j += 1) byte = (byte << 1) | bits[i + j];
      out.push(byte);
    }
    return out;
  }

  function interleave(data, version) {
    const numBlocks = NUM_BLOCKS[version];
    const eccLen = ECC_PER_BLOCK[version];
    const raw = RAW_CODEWORDS[version];
    const numShortBlocks = numBlocks - (raw % numBlocks);
    const shortBlockLen = Math.floor(raw / numBlocks);
    const shortDataLen = shortBlockLen - eccLen;
    const divisor = rsDivisor(eccLen);
    const blocks = [];
    let cursor = 0;
    for (let i = 0; i < numBlocks; i += 1) {
      const length = shortDataLen + (i < numShortBlocks ? 0 : 1);
      const chunk = data.slice(cursor, cursor + length);
      cursor += length;
      const ecc = rsRemainder(chunk, divisor);
      if (i < numShortBlocks) chunk.push(0); // align column widths
      blocks.push(chunk.concat(ecc));
    }
    const result = [];
    for (let i = 0; i < blocks[0].length; i += 1) {
      blocks.forEach((block, j) => {
        if (i !== shortDataLen || j >= numShortBlocks) result.push(block[i]);
      });
    }
    return result;
  }

  function maskBit(mask, x, y) {
    switch (mask) {
      case 0: return (x + y) % 2 === 0;
      case 1: return y % 2 === 0;
      case 2: return x % 3 === 0;
      case 3: return (x + y) % 3 === 0;
      case 4: return (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0;
      case 5: return ((x * y) % 2) + ((x * y) % 3) === 0;
      case 6: return (((x * y) % 2) + ((x * y) % 3)) % 2 === 0;
      case 7: return (((x + y) % 2) + ((x * y) % 3)) % 2 === 0;
      default: return false;
    }
  }

  function buildMatrix(version, codewords, forcedMask) {
    const size = version * 4 + 17;
    const modules = Array.from({ length: size }, () => new Array(size).fill(false));
    const isFunction = Array.from({ length: size }, () => new Array(size).fill(false));

    function setFunction(x, y, dark) {
      if (x < 0 || y < 0 || x >= size || y >= size) return;
      modules[y][x] = !!dark;
      isFunction[y][x] = true;
    }

    function finder(cx, cy) {
      for (let dy = -4; dy <= 4; dy += 1) {
        for (let dx = -4; dx <= 4; dx += 1) {
          const dist = Math.max(Math.abs(dx), Math.abs(dy));
          setFunction(cx + dx, cy + dy, dist !== 2 && dist !== 4);
        }
      }
    }
    // Timing first: the three finder patterns (drawn afterwards) overwrite
    // the modules where they overlap column/row 6. Reversing this order
    // breaks the finder corners and no decoder can even locate the symbol.
    for (let i = 0; i < size; i += 1) {
      setFunction(6, i, i % 2 === 0);
      setFunction(i, 6, i % 2 === 0);
    }
    finder(3, 3);
    finder(size - 4, 3);
    finder(3, size - 4);

    const centers = ALIGN_CENTERS[version];
    const last = centers.length - 1;
    centers.forEach((cy, aj) => {
      centers.forEach((cx, ai) => {
        if ((ai === 0 && aj === 0) || (ai === 0 && aj === last) ||
            (ai === last && aj === 0)) return;
        for (let dy = -2; dy <= 2; dy += 1) {
          for (let dx = -2; dx <= 2; dx += 1) {
            setFunction(cx + dx, cy + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
          }
        }
      });
    });

    function drawFormat(mask) {
      const data = (0 << 3) | mask; // EC level M = 00
      let rem = data;
      for (let i = 0; i < 10; i += 1) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
      const bits = ((data << 10) | rem) ^ 0x5412;
      const bit = (i) => ((bits >>> i) & 1) !== 0;
      for (let i = 0; i <= 5; i += 1) setFunction(8, i, bit(i));
      setFunction(8, 7, bit(6));
      setFunction(8, 8, bit(7));
      setFunction(7, 8, bit(8));
      for (let i = 9; i < 15; i += 1) setFunction(14 - i, 8, bit(i));
      for (let i = 0; i < 8; i += 1) setFunction(size - 1 - i, 8, bit(i));
      for (let i = 8; i < 15; i += 1) setFunction(8, size - 15 + i, bit(i));
      setFunction(8, size - 8, true); // fixed dark module
    }

    function drawVersion() {
      if (version < 7) return;
      let rem = version;
      for (let i = 0; i < 12; i += 1) rem = (rem << 1) ^ ((rem >>> 11) * 0x1f25);
      const bits = (version << 12) | rem;
      for (let i = 0; i < 18; i += 1) {
        const dark = ((bits >>> i) & 1) !== 0;
        const a = size - 11 + (i % 3);
        const b = Math.floor(i / 3);
        setFunction(a, b, dark);
        setFunction(b, a, dark);
      }
    }

    drawFormat(0);
    drawVersion();

    let bitIndex = 0;
    for (let right = size - 1; right >= 1; right -= 2) {
      if (right === 6) right = 5; // skip the vertical timing column
      for (let vert = 0; vert < size; vert += 1) {
        for (let j = 0; j < 2; j += 1) {
          const x = right - j;
          const upward = ((right + 1) & 2) === 0;
          const y = upward ? size - 1 - vert : vert;
          if (!isFunction[y][x] && bitIndex < codewords.length * 8) {
            modules[y][x] = ((codewords[bitIndex >>> 3] >>> (7 - (bitIndex & 7))) & 1) !== 0;
            bitIndex += 1;
          }
        }
      }
    }

    function applyMask(mask) {
      for (let y = 0; y < size; y += 1) {
        for (let x = 0; x < size; x += 1) {
          if (!isFunction[y][x] && maskBit(mask, x, y)) {
            modules[y][x] = !modules[y][x];
          }
        }
      }
    }

    function rowString(y) {
      return modules[y].map((v) => (v ? "1" : "0")).join("");
    }
    function colString(x) {
      let s = "";
      for (let y = 0; y < size; y += 1) s += modules[y][x] ? "1" : "0";
      return s;
    }
    function countOccurrences(haystack, needle) {
      let count = 0;
      let pos = 0;
      for (;;) {
        const found = haystack.indexOf(needle, pos);
        if (found < 0) return count;
        count += 1;
        pos = found + 1;
      }
    }
    function penalty() {
      let score = 0;
      // Rule 1: runs of five or more equal-colour modules.
      for (let axis = 0; axis < 2; axis += 1) {
        for (let line = 0; line < size; line += 1) {
          const s = axis === 0 ? rowString(line) : colString(line);
          let run = 1;
          for (let i = 1; i < size; i += 1) {
            if (s[i] === s[i - 1]) {
              run += 1;
              if (run === 5) score += 3;
              else if (run > 5) score += 1;
            } else run = 1;
          }
        }
      }
      // Rule 2: 2x2 blocks of one colour.
      for (let y = 0; y < size - 1; y += 1) {
        for (let x = 0; x < size - 1; x += 1) {
          const c = modules[y][x];
          if (c === modules[y][x + 1] && c === modules[y + 1][x] &&
              c === modules[y + 1][x + 1]) score += 3;
        }
      }
      // Rule 3: finder-like 1:1:3:1:1 patterns with four light modules.
      const pat1 = "10111010000";
      const pat2 = "00001011101";
      for (let axis = 0; axis < 2; axis += 1) {
        for (let line = 0; line < size; line += 1) {
          const s = "0000" + (axis === 0 ? rowString(line) : colString(line)) + "0000";
          score += 40 * (countOccurrences(s, pat1) + countOccurrences(s, pat2));
        }
      }
      // Rule 4: deviation from 50% dark modules.
      let dark = 0;
      for (let y = 0; y < size; y += 1) {
        for (let x = 0; x < size; x += 1) if (modules[y][x]) dark += 1;
      }
      const total = size * size;
      score += (Math.ceil(Math.abs(dark * 20 - total * 10) / total) - 1) * 10;
      return score;
    }

    let bestMask = 0;
    if (Number.isInteger(forcedMask) && forcedMask >= 0 && forcedMask <= 7) {
      bestMask = forcedMask;
    } else {
      let min = Infinity;
      for (let mask = 0; mask < 8; mask += 1) {
        applyMask(mask);
        drawFormat(mask);
        const p = penalty();
        if (p < min) {
          min = p;
          bestMask = mask;
        }
        applyMask(mask); // undo
      }
    }
    drawFormat(bestMask);
    applyMask(bestMask);
    return { size, version, mask: bestMask, modules, isFunction, codewords };
  }

  // Exposed so harnesses can re-extract codewords from a reference matrix and
  // assert that every version's alignment patterns land in function modules.
  CMF.qrMaskBit = maskBit;
  CMF.qrAlignmentCenters = ALIGN_CENTERS;

  /* Returns {size, version, mask, modules: boolean[][], codewords, ecc}. */
  CMF.qrMatrix = function (text, opts) {
    const options = opts || {};
    const bytes = utf8Bytes(String(text == null ? "" : text));
    let version = 0;
    for (let v = MIN_VERSION; v <= MAX_VERSION; v += 1) {
      if (CMF.qrCapacity(v) >= bytes.length) {
        version = v;
        break;
      }
    }
    if (!version) {
      throw new Error("QR payload too long: " + bytes.length + " bytes (max " +
        CMF.qrCapacity(MAX_VERSION) + ")");
    }
    const min = Math.max(MIN_VERSION, Math.min(MAX_VERSION, Number(options.minVersion) || 1));
    version = Math.max(version, min);
    const data = dataCodewords(bytes, version);
    const codewords = interleave(data, version);
    const matrix = buildMatrix(version, codewords, options.mask);
    return {
      size: matrix.size,
      version: matrix.version,
      mask: matrix.mask,
      modules: matrix.modules,
      isFunction: matrix.isFunction,
      codewords: matrix.codewords,
      bytes: bytes.length,
      ecc: "M",
    };
  };

  /* Draw into an existing CanvasRenderingContext2D. Returns geometry so a
     headless harness can assert cell size and dark-module count. */
  CMF.drawQR = function (ctx, text, x, y, boxSize, opts) {
    const options = opts || {};
    const qr = CMF.qrMatrix(text, options);
    const quiet = Number.isFinite(options.quiet) ? options.quiet : 4;
    const total = qr.size + quiet * 2;
    const cell = Math.max(1, Math.floor(boxSize / total));
    const actual = cell * total;
    const left = x + Math.floor((boxSize - actual) / 2);
    const top = y + Math.floor((boxSize - actual) / 2);
    ctx.fillStyle = options.light || "#ffffff";
    ctx.fillRect(left, top, actual, actual);
    ctx.fillStyle = options.dark || "#2c2620";
    for (let r = 0; r < qr.size; r += 1) {
      for (let c = 0; c < qr.size; c += 1) {
        if (qr.modules[r][c]) {
          ctx.fillRect(left + (c + quiet) * cell, top + (r + quiet) * cell, cell, cell);
        }
      }
    }
    return {
      x: left, y: top, size: actual, cell,
      version: qr.version, mask: qr.mask, modules: qr.size,
    };
  };
})();
