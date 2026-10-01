// Colour and tile helpers for the GBC build: palette keys are the web game's PAL letters.
'use strict';
const zlib = require('zlib'), fs = require('fs');

module.exports = function gfx(PAL) {
  const rgbCache = new Map(), distCache = new Map();   // the build asks for the same colours millions of times
  const rgbOf = k => { let c = rgbCache.get(k); if (!c) { const h = PAL[k]; c = [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)]; rgbCache.set(k, c); } return c; };
  const dist = (a, b) => {
    const key = a + b; let d = distCache.get(key);
    if (d === undefined) { const A = rgbOf(a), B = rgbOf(b), rm = (A[0] + B[0]) / 2, dr = A[0] - B[0], dg = A[1] - B[1], db = A[2] - B[2]; d = (2 + rm / 256) * dr * dr + 4 * dg * dg + (2 + (255 - rm) / 256) * db * db; distCache.set(key, d); }
    return d;
  };
  const luma = k => { const [r, g, b] = rgbOf(k); return 0.299 * r + 0.587 * g + 0.114 * b; };
  const to555 = k => { const [r, g, b] = rgbOf(k); return (r >> 3) | ((g >> 3) << 5) | ((b >> 3) << 10); };
  const from555 = v => [v & 31, (v >> 5) & 31, (v >> 10) & 31].map(c => (c << 3) | (c >> 2));
  const nearest = (k, cols) => cols.reduce((best, c) => (dist(k, c) < dist(k, best) ? c : best), cols[0]);

  // fold the rarest colours of a tile into their nearest neighbours until at most max remain
  // (null pixels are transparent and never counted)
  function reduceTile(t, max) {
    const count = {}; for (const k of t) if (k !== null) count[k] = (count[k] || 0) + 1;
    const map = {}; let keys = Object.keys(count);
    while (keys.length > max) {
      keys.sort((a, b) => count[a] - count[b]);
      const k = keys.shift(), best = nearest(k, keys);
      count[best] += count[k]; map[k] = best;
    }
    const f = k => (map[k] ? f(map[k]) : k);
    return t.map(k => (k === null ? null : f(k)));
  }
  // group tiles' colour sets into at most K palettes of size colours each (dark to light)
  function solvePalettes(tiles, K, size = 4, tune = false, pinned = []) {   // tune: refine (terrain; sprites look better without); pinned: palettes kept as given
    const sets = new Map();
    for (const t of tiles) { const cols = [...new Set(t.filter(k => k !== null))].sort(), id = cols.join(''); if (!cols.length) continue; const s = sets.get(id) || { cols, w: 0, px: {} }; s.w++; for (const k of t) if (k !== null) s.px[k] = (s.px[k] || 0) + 1; sets.set(id, s); }
    const order = [...sets.values()].sort((a, b) => b.cols.length - a.cols.length || b.w - a.w);
    const pals = pinned.map(p => new Set(p)), left = [];
    for (const s of order) {
      let best = null, add = 99;
      for (const p of pals.slice(pinned.length)) { const u = new Set([...p, ...s.cols]); if (u.size <= size && u.size - p.size < add) { best = p; add = u.size - p.size; } }
      if (!best && s.cols.every(c => pals.slice(0, pinned.length).some(p => p.has(c)))) continue;   // a pinned palette draws it
      if (best) s.cols.forEach(c => best.add(c)); else if (pals.length < K) pals.push(new Set(s.cols)); else left.push(s);
    }
    for (const s of left) for (const p of pals.slice(pinned.length).filter(p => p.size < size)) { const miss = s.cols.filter(c => !p.has(c)).sort((a, b) => s.px[b] - s.px[a]); while (p.size < size && miss.length) p.add(miss.shift()); }
    return (tune ? refine([...sets.values()], pals.map(p => [...p]), size, pinned.length) : pals.map(p => [...p])).map(p => p.sort((a, b) => luma(a) - luma(b)));
  }
  // then k-means over the palettes: each colour set goes to the palette that draws it best, and each palette
  // swaps colours while that lowers the error of the sets it draws. A set counts by the square root of how
  // many tiles use it, so a sign or an anvil isn't outvoted by a few hundred grass tiles.
  function refine(sets, pals, size, fixed = 0) {
    const setErr = (s, p) => { if (!p.length) return Infinity; let e = 0; for (const k of s.cols) e += s.px[k] * dist(k, nearest(k, p)); return e / Math.sqrt(s.w); };
    const total = (members, p) => members.reduce((e, s) => e + setErr(s, p), 0);
    for (let it = 0; it < 8; it++) {
      const members = pals.map(() => []);
      for (const s of sets) { let bi = 0, be = Infinity; pals.forEach((p, i) => { const e = setErr(s, p); if (e < be) { be = e; bi = i; } }); members[bi].push(s); }
      let changed = false;
      pals.forEach((p, i) => {
        if (i < fixed) return;
        const cand = [...new Set(members[i].flatMap(s => s.cols))].filter(c => !p.includes(c));
        let cur = total(members[i], p);
        for (let improved = true; improved; ) {
          improved = false;
          const tries = p.length < size ? cand.filter(c => !p.includes(c)).map(c => [...p, c]) : [];
          for (let a = 0; a < p.length; a++) for (const c of cand) if (!p.includes(c)) { const q = p.slice(); q[a] = c; tries.push(q); }
          for (const q of tries) { const e = total(members[i], q); if (e < cur - 1e-6) { cur = e; p = q; improved = true; } }
        }
        if (p.join() !== pals[i].join()) { pals[i] = p; changed = true; }
      });
      if (!changed) break;
    }
    return pals;
  }
  // the palette (from pals) that draws tile t with the least error; offset shifts indices (sprites: 1-3)
  function bestPalette(t, pals, offset = 0) {
    let best = 0, bestErr = Infinity, bestIdx = null;
    pals.forEach((p, pi) => {
      let err = 0; const idx = t.map(k => { if (k === null) return 0; const n = nearest(k, p); err += dist(k, n); return p.indexOf(n) + offset; });
      if (err < bestErr) { best = pi; bestErr = err; bestIdx = idx; }
    });
    return { pal: best, idx: bestIdx, err: bestErr };
  }
  const enc2bpp = idx => { const out = []; for (let y = 0; y < idx.length / 8; y++) { let lo = 0, hi = 0; for (let x = 0; x < 8; x++) { const v = idx[y * 8 + x]; lo |= (v & 1) << (7 - x); hi |= ((v >> 1) & 1) << (7 - x); } out.push(lo, hi); } return out; };
  const flipX = t => t.map((_, i) => t[(i & ~7) + 7 - (i & 7)]), flipY = t => t.map((_, i) => t[(7 - (i >> 3)) * 8 + (i & 7)]);
  class TileSet {   // 8x8 tiles of palette indices, deduplicated with flips
    constructor() { this.tiles = []; this.index = new Map(); }
    add(idx) {   // returns [tile number, attribute flip bits]
      for (const [v, flip] of [[idx, 0], [flipX(idx), 0x20], [flipY(idx), 0x40], [flipX(flipY(idx)), 0x60]]) { const k = v.join(''); if (this.index.has(k)) return [this.index.get(k), flip]; }
      this.index.set(idx.join(''), this.tiles.length); this.tiles.push(idx); return [this.tiles.length - 1, 0];
    }
  }
  function png(file, w, h, rgbAt) {
    const raw = Buffer.alloc((w * 3 + 1) * h);
    for (let y = 0; y < h; y++) { raw[y * (w * 3 + 1)] = 0; for (let x = 0; x < w; x++) { const c = rgbAt(x, y), o = y * (w * 3 + 1) + 1 + x * 3; raw[o] = c[0]; raw[o + 1] = c[1]; raw[o + 2] = c[2]; } }
    const chunk = (type, data) => { const b = Buffer.alloc(12 + data.length); b.writeUInt32BE(data.length, 0); b.write(type, 4, 'ascii'); data.copy(b, 8); b.writeUInt32BE(zlib.crc32(Buffer.concat([Buffer.from(type, 'ascii'), data])) >>> 0, 8 + data.length); return b; };
    const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
    fs.writeFileSync(file, Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]));
  }
  return { rgbOf, dist, luma, to555, from555, nearest, reduceTile, solvePalettes, bestPalette, enc2bpp, TileSet, png };
};
