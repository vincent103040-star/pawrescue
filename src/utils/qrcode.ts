/**
 * A minimal QR Code encoder.
 *
 * Written by hand because the project carries no QR library and deliberately
 * takes no new npm dependencies -- the 1GB VM this deploys to has run out of
 * memory during `npm install` before. The scope is kept to exactly what the
 * printable check-in poster needs: byte mode, error-correction level M or Q,
 * versions 1-10, which covers URLs up to ~150 characters.
 *
 * Implements ISO/IEC 18004: data encoding, Reed-Solomon error correction over
 * GF(256), block interleaving, the eight mask patterns with the standard
 * penalty scoring, and format/version information.
 */

// ---------------------------------------------------------------------------
// GF(256) arithmetic, the field Reed-Solomon works in.
// Primitive polynomial 0x11D, generator 2 -- both fixed by the QR spec.
// ---------------------------------------------------------------------------
const EXP = new Uint8Array(512);
const LOG = new Uint8Array(256);
(() => {
  let x = 1;
  for (let i = 0; i < 255; i++) {
    EXP[i] = x;
    LOG[x] = i;
    x <<= 1;
    if (x & 0x100) x ^= 0x11d;
  }
  for (let i = 255; i < 512; i++) EXP[i] = EXP[i - 255];
})();

const mul = (a: number, b: number): number => (a === 0 || b === 0 ? 0 : EXP[LOG[a] + LOG[b]]);

/** Generator polynomial for `degree` error-correction codewords. */
function rsGenerator(degree: number): Uint8Array {
  let poly = new Uint8Array([1]);
  for (let i = 0; i < degree; i++) {
    const next = new Uint8Array(poly.length + 1);
    for (let j = 0; j < poly.length; j++) {
      next[j] ^= poly[j];
      next[j + 1] ^= mul(poly[j], EXP[i]);
    }
    poly = next;
  }
  return poly;
}

/** The `degree` error-correction codewords for one block of data. */
function rsEncode(data: Uint8Array, degree: number): Uint8Array {
  const gen = rsGenerator(degree);
  const res = new Uint8Array(degree);
  for (const byte of data) {
    const factor = byte ^ res[0];
    res.copyWithin(0, 1);
    res[degree - 1] = 0;
    for (let i = 0; i < degree; i++) res[i] ^= mul(gen[i + 1], factor);
  }
  return res;
}

// ---------------------------------------------------------------------------
// Version tables (versions 1-10, EC levels M and Q).
// [total codewords, ec codewords per block, group1 blocks, group2 blocks]
// Taken from the tables in ISO/IEC 18004 Annex.
// ---------------------------------------------------------------------------
type EcLevel = 'M' | 'Q';

const VERSION_TABLE: Record<EcLevel, Array<[number, number, number, number]>> = {
  //     total, ecPerBlock, g1Blocks, g2Blocks
  M: [
    [26, 10, 1, 0],   // v1
    [44, 16, 1, 0],   // v2
    [70, 26, 1, 0],   // v3
    [100, 18, 2, 0],  // v4
    [134, 24, 2, 0],  // v5
    [172, 16, 4, 0],  // v6
    [196, 18, 4, 0],  // v7
    [242, 22, 2, 2],  // v8
    [292, 22, 3, 2],  // v9
    [346, 26, 4, 1]   // v10
  ],
  Q: [
    [26, 13, 1, 0],
    [44, 22, 1, 0],
    [70, 18, 2, 0],
    [100, 26, 2, 0],
    [134, 18, 2, 2],
    [172, 24, 4, 0],
    [196, 18, 2, 4],
    [242, 22, 4, 2],
    [292, 20, 4, 4],
    [346, 24, 6, 2]
  ]
};

/** Row/column centres of the alignment patterns, by version. */
const ALIGNMENT_CENTRES: number[][] = [
  [], [], [6, 18], [6, 22], [6, 26], [6, 30], [6, 34],
  [6, 22, 38], [6, 24, 42], [6, 26, 46], [6, 28, 50]
];

/** Pre-computed version information bit strings (versions 7+ only). */
const VERSION_INFO: Record<number, number> = {
  7: 0x07c94, 8: 0x085bc, 9: 0x09a99, 10: 0x0a4d3
};

// ---------------------------------------------------------------------------
// Encoding
// ---------------------------------------------------------------------------

function totalDataCodewords(version: number, ec: EcLevel): number {
  const [total, ecPerBlock, g1, g2] = VERSION_TABLE[ec][version - 1];
  return total - ecPerBlock * (g1 + g2);
}

/** Smallest version in 1..10 that fits `byteLength` bytes in byte mode. */
function pickVersion(byteLength: number, ec: EcLevel): number {
  for (let v = 1; v <= 10; v++) {
    // 4 bits mode indicator + 8 or 16 bits length + the data itself
    const lengthBits = v < 10 ? 8 : 16;
    const needed = Math.ceil((4 + lengthBits + byteLength * 8) / 8);
    if (needed <= totalDataCodewords(v, ec)) return v;
  }
  throw new Error('內容過長，超過此 QR 產生器支援的容量（版本 10）');
}

/** Mode indicator, length, payload, terminator, padding -- as codewords. */
function buildDataCodewords(bytes: Uint8Array, version: number, ec: EcLevel): Uint8Array {
  const capacity = totalDataCodewords(version, ec);
  const bits: number[] = [];
  const push = (value: number, count: number) => {
    for (let i = count - 1; i >= 0; i--) bits.push((value >> i) & 1);
  };

  push(0b0100, 4);                                  // byte mode
  push(bytes.length, version < 10 ? 8 : 16);        // character count
  for (const b of bytes) push(b, 8);

  // Terminator: up to four zero bits, then pad to a byte boundary.
  const capacityBits = capacity * 8;
  for (let i = 0; i < 4 && bits.length < capacityBits; i++) bits.push(0);
  while (bits.length % 8 !== 0) bits.push(0);

  const codewords: number[] = [];
  for (let i = 0; i < bits.length; i += 8) {
    let byte = 0;
    for (let j = 0; j < 8; j++) byte = (byte << 1) | bits[i + j];
    codewords.push(byte);
  }
  // Alternating pad bytes, fixed by the spec.
  const PAD = [0xec, 0x11];
  for (let i = 0; codewords.length < capacity; i++) codewords.push(PAD[i % 2]);

  return new Uint8Array(codewords);
}

/** Split into blocks, error-correct each, then interleave as the spec requires. */
function buildFinalCodewords(data: Uint8Array, version: number, ec: EcLevel): Uint8Array {
  const [, ecPerBlock, g1Blocks, g2Blocks] = VERSION_TABLE[ec][version - 1];
  const totalBlocks = g1Blocks + g2Blocks;
  const g1Size = Math.floor(data.length / totalBlocks);
  const g2Size = g1Size + 1;

  const dataBlocks: Uint8Array[] = [];
  const ecBlocks: Uint8Array[] = [];
  let offset = 0;
  for (let i = 0; i < totalBlocks; i++) {
    const size = i < g1Blocks ? g1Size : g2Size;
    const block = data.slice(offset, offset + size);
    offset += size;
    dataBlocks.push(block);
    ecBlocks.push(rsEncode(block, ecPerBlock));
  }

  const out: number[] = [];
  for (let i = 0; i < g2Size; i++) {
    for (const block of dataBlocks) if (i < block.length) out.push(block[i]);
  }
  for (let i = 0; i < ecPerBlock; i++) {
    for (const block of ecBlocks) out.push(block[i]);
  }
  return new Uint8Array(out);
}

// ---------------------------------------------------------------------------
// Matrix construction
// ---------------------------------------------------------------------------

type Matrix = { size: number; modules: Int8Array; reserved: Uint8Array };

const at = (m: Matrix, r: number, c: number) => m.modules[r * m.size + c];
const set = (m: Matrix, r: number, c: number, v: number) => { m.modules[r * m.size + c] = v; };
const reserve = (m: Matrix, r: number, c: number) => { m.reserved[r * m.size + c] = 1; };
const isReserved = (m: Matrix, r: number, c: number) => m.reserved[r * m.size + c] === 1;

function placeFinder(m: Matrix, row: number, col: number) {
  for (let r = -1; r <= 7; r++) {
    for (let c = -1; c <= 7; c++) {
      const rr = row + r;
      const cc = col + c;
      if (rr < 0 || rr >= m.size || cc < 0 || cc >= m.size) continue;
      const inRing = (r >= 0 && r <= 6 && (c === 0 || c === 6)) || (c >= 0 && c <= 6 && (r === 0 || r === 6));
      const inCore = r >= 2 && r <= 4 && c >= 2 && c <= 4;
      set(m, rr, cc, inRing || inCore ? 1 : 0);
      reserve(m, rr, cc);
    }
  }
}

function placeAlignment(m: Matrix, version: number) {
  const centres = ALIGNMENT_CENTRES[version];
  for (const r of centres) {
    for (const c of centres) {
      // Skip the three corners already occupied by finder patterns.
      const isCorner =
        (r === 6 && c === 6) ||
        (r === 6 && c === m.size - 7) ||
        (r === m.size - 7 && c === 6);
      if (isCorner) continue;
      for (let dr = -2; dr <= 2; dr++) {
        for (let dc = -2; dc <= 2; dc++) {
          const ring = Math.max(Math.abs(dr), Math.abs(dc));
          set(m, r + dr, c + dc, ring === 1 ? 0 : 1);
          reserve(m, r + dr, c + dc);
        }
      }
    }
  }
}

function placeTiming(m: Matrix) {
  for (let i = 8; i < m.size - 8; i++) {
    const v = i % 2 === 0 ? 1 : 0;
    if (!isReserved(m, 6, i)) { set(m, 6, i, v); reserve(m, 6, i); }
    if (!isReserved(m, i, 6)) { set(m, i, 6, v); reserve(m, i, 6); }
  }
}

function reserveFormatAreas(m: Matrix, version: number) {
  for (let i = 0; i < 9; i++) {
    if (!isReserved(m, 8, i)) { set(m, 8, i, 0); reserve(m, 8, i); }
    if (!isReserved(m, i, 8)) { set(m, i, 8, 0); reserve(m, i, 8); }
  }
  for (let i = 0; i < 8; i++) {
    if (!isReserved(m, 8, m.size - 1 - i)) { set(m, 8, m.size - 1 - i, 0); reserve(m, 8, m.size - 1 - i); }
    if (!isReserved(m, m.size - 1 - i, 8)) { set(m, m.size - 1 - i, 8, 0); reserve(m, m.size - 1 - i, 8); }
  }
  // The always-dark module.
  set(m, m.size - 8, 8, 1);
  reserve(m, m.size - 8, 8);

  if (version >= 7) {
    for (let i = 0; i < 18; i++) {
      const r = Math.floor(i / 3);
      const c = m.size - 11 + (i % 3);
      set(m, r, c, 0); reserve(m, r, c);
      set(m, c, r, 0); reserve(m, c, r);
    }
  }
}

/** Zig-zag placement of the data bitstream, bottom-right upward. */
function placeData(m: Matrix, codewords: Uint8Array) {
  let bitIndex = 0;
  const nextBit = (): number => {
    const byte = codewords[bitIndex >> 3];
    const bit = byte === undefined ? 0 : (byte >> (7 - (bitIndex & 7))) & 1;
    bitIndex++;
    return bit;
  };

  let upward = true;
  for (let right = m.size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5; // the vertical timing column is skipped entirely
    for (let i = 0; i < m.size; i++) {
      const row = upward ? m.size - 1 - i : i;
      for (const col of [right, right - 1]) {
        if (isReserved(m, row, col)) continue;
        set(m, row, col, nextBit());
      }
    }
    upward = !upward;
  }
}

const MASKS: Array<(r: number, c: number) => boolean> = [
  (r, c) => (r + c) % 2 === 0,
  (r) => r % 2 === 0,
  (_r, c) => c % 3 === 0,
  (r, c) => (r + c) % 3 === 0,
  (r, c) => (Math.floor(r / 2) + Math.floor(c / 3)) % 2 === 0,
  (r, c) => ((r * c) % 2) + ((r * c) % 3) === 0,
  (r, c) => (((r * c) % 2) + ((r * c) % 3)) % 2 === 0,
  (r, c) => (((r + c) % 2) + ((r * c) % 3)) % 2 === 0
];

function applyMask(m: Matrix, maskIndex: number): Matrix {
  const out: Matrix = { size: m.size, modules: m.modules.slice(), reserved: m.reserved };
  const fn = MASKS[maskIndex];
  for (let r = 0; r < m.size; r++) {
    for (let c = 0; c < m.size; c++) {
      if (isReserved(m, r, c)) continue;
      if (fn(r, c)) out.modules[r * m.size + c] ^= 1;
    }
  }
  return out;
}

/** BCH(15,5) format information, XOR-masked with 0x5412 per the spec. */
function formatBits(ec: EcLevel, maskIndex: number): number {
  const ecBits = ec === 'M' ? 0b00 : 0b11; // L=01, M=00, Q=11, H=10
  let value = (ecBits << 3) | maskIndex;
  let rem = value << 10;
  for (let i = 4; i >= 0; i--) {
    if ((rem >> (10 + i)) & 1) rem ^= 0b10100110111 << i;
  }
  return ((value << 10) | rem) ^ 0b101010000010010;
}

function placeFormat(m: Matrix, ec: EcLevel, maskIndex: number) {
  const bits = formatBits(ec, maskIndex);

  // Most significant bit first. This is the one that bites: write the format
  // bits in the other order and the symbol still looks perfectly well-formed,
  // still round-trips through a reader that shares the mistake, and still has
  // valid Reed-Solomon -- but no real scanner can read it, because the format
  // string fails its BCH check and the mask and EC level are never recovered.
  const get = (k: number) => (bits >> (14 - k)) & 1;

  // Copy 1: along row 8, then up column 8 past the top-left finder.
  for (let k = 0; k <= 5; k++) set(m, 8, k, get(k));
  set(m, 8, 7, get(6));
  set(m, 8, 8, get(7));
  set(m, 7, 8, get(8));
  for (let k = 9; k <= 14; k++) set(m, 14 - k, 8, get(k));

  // Copy 2: up column 8 from the bottom edge, then along row 8 to the right.
  // The vertical run is seven modules, not eight -- (size-8, 8) is the
  // always-dark module and is not part of the format area.
  for (let k = 0; k <= 6; k++) set(m, m.size - 1 - k, 8, get(k));
  for (let k = 7; k <= 14; k++) set(m, 8, m.size - 15 + k, get(k));
}

function placeVersionInfo(m: Matrix, version: number) {
  if (version < 7) return;
  const bits = VERSION_INFO[version];
  for (let i = 0; i < 18; i++) {
    const bit = (bits >> i) & 1;
    const r = Math.floor(i / 3);
    const c = m.size - 11 + (i % 3);
    set(m, r, c, bit);
    set(m, c, r, bit);
  }
}

/** The standard four penalty rules, used to pick the least-bad mask. */
function penalty(m: Matrix): number {
  const n = m.size;
  let score = 0;

  // Rule 1: runs of five or more same-coloured modules in a row or column.
  for (let i = 0; i < n; i++) {
    for (const horizontal of [true, false]) {
      let run = 1;
      for (let j = 1; j < n; j++) {
        const prev = horizontal ? at(m, i, j - 1) : at(m, j - 1, i);
        const cur = horizontal ? at(m, i, j) : at(m, j, i);
        if (cur === prev) {
          run++;
        } else {
          if (run >= 5) score += run - 2;
          run = 1;
        }
      }
      if (run >= 5) score += run - 2;
    }
  }

  // Rule 2: 2x2 blocks of one colour.
  for (let r = 0; r < n - 1; r++) {
    for (let c = 0; c < n - 1; c++) {
      const v = at(m, r, c);
      if (v === at(m, r, c + 1) && v === at(m, r + 1, c) && v === at(m, r + 1, c + 1)) score += 3;
    }
  }

  // Rule 3: the 1:1:3:1:1 finder-like pattern with four light modules beside it.
  const A = [1, 0, 1, 1, 1, 0, 1, 0, 0, 0, 0];
  const B = [0, 0, 0, 0, 1, 0, 1, 1, 1, 0, 1];
  for (let r = 0; r < n; r++) {
    for (let c = 0; c <= n - 11; c++) {
      let matchA = true, matchB = true, matchAv = true, matchBv = true;
      for (let k = 0; k < 11; k++) {
        if (at(m, r, c + k) !== A[k]) matchA = false;
        if (at(m, r, c + k) !== B[k]) matchB = false;
        if (at(m, c + k, r) !== A[k]) matchAv = false;
        if (at(m, c + k, r) !== B[k]) matchBv = false;
      }
      if (matchA) score += 40;
      if (matchB) score += 40;
      if (matchAv) score += 40;
      if (matchBv) score += 40;
    }
  }

  // Rule 4: deviation from a 50/50 light/dark balance.
  let dark = 0;
  for (let i = 0; i < n * n; i++) if (m.modules[i] === 1) dark++;
  const percent = (dark * 100) / (n * n);
  score += Math.floor(Math.abs(percent - 50) / 5) * 10;

  return score;
}

/**
 * Encodes `text` and returns the finished module grid: `true` = dark.
 * Does not include the quiet zone -- add margin when rendering.
 *
 * `forceMask` pins the mask pattern instead of picking the best-scoring one.
 * Only used to compare output against a reference encoder; leave it unset.
 */
export function encodeQr(text: string, ec: EcLevel = 'M', forceMask?: number): boolean[][] {
  const bytes = new TextEncoder().encode(text);
  const version = pickVersion(bytes.length, ec);
  const size = version * 4 + 17;

  const data = buildDataCodewords(bytes, version, ec);
  const final = buildFinalCodewords(data, version, ec);

  const base: Matrix = { size, modules: new Int8Array(size * size), reserved: new Uint8Array(size * size) };
  placeFinder(base, 0, 0);
  placeFinder(base, 0, size - 7);
  placeFinder(base, size - 7, 0);
  placeAlignment(base, version);
  placeTiming(base);
  reserveFormatAreas(base, version);
  placeData(base, final);

  // Try all eight masks, keep the one the spec's scoring likes best.
  let best: Matrix | null = null;
  let bestScore = Infinity;
  for (let mask = 0; mask < 8; mask++) {
    if (forceMask !== undefined && mask !== forceMask) continue;
    const candidate = applyMask(base, mask);
    placeFormat(candidate, ec, mask);
    placeVersionInfo(candidate, version);
    const score = penalty(candidate);
    if (score < bestScore) {
      bestScore = score;
      best = candidate;
    }
  }

  const m = best!;
  const grid: boolean[][] = [];
  for (let r = 0; r < size; r++) {
    const row: boolean[] = [];
    for (let c = 0; c < size; c++) row.push(at(m, r, c) === 1);
    grid.push(row);
  }
  return grid;
}

/**
 * Renders `text` as an SVG QR code. Self-contained markup with no external
 * references, so it survives being printed or embedded in a page.
 *
 * Sized by modules rather than by total pixels: `modulePx` is how many pixels
 * one module gets, so the result is always an exact integer multiple and every
 * module is the same size.
 */
export function qrToSvg(
  text: string,
  options: { modulePx?: number; margin?: number; ec?: EcLevel } = {}
): string {
  const { modulePx = 8, margin = 4, ec = 'M' } = options;
  const grid = encodeQr(text, ec);
  const count = grid.length + margin * 2;
  // Size the image as a whole number of pixels per module. At a fractional
  // scale the renderer distributes the remainder unevenly and modules end up
  // a pixel wider here than there, which is exactly the kind of distortion a
  // camera pointed at a screen struggles to threshold.
  const size = count * modulePx;

  // One path for every dark module beats one <rect> each -- printers and
  // browsers both handle the single path far better at poster sizes.
  let path = '';
  for (let r = 0; r < grid.length; r++) {
    for (let c = 0; c < grid.length; c++) {
      if (grid[r][c]) path += `M${c + margin} ${r + margin}h1v1h-1z`;
    }
  }

  return [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${count} ${count}" width="${size}" height="${size}" shape-rendering="crispEdges" role="img" aria-label="QR Code">`,
    `<rect width="${count}" height="${count}" fill="#ffffff"/>`,
    `<path d="${path}" fill="#000000"/>`,
    `</svg>`
  ].join('');
}
