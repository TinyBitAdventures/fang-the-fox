#!/usr/bin/env node
// Fang the Fox, Game Boy Color edition: turns the web game's maps and art into the generated C
// (tilesets, palettes, area maps, HUD text) and checks every area against the GBC's budgets.
// usage: node gbc/tools/build.js [--report]      (the Makefile runs it before compiling)
'use strict';
const fs = require('fs'), path = require('path'), vm = require('vm'), zlib = require('zlib'), { execFileSync } = require('child_process');
const GBC = path.join(__dirname, '..'), ROOT = path.join(GBC, '..');
const OUT = path.join(GBC, 'src', 'gen'), PREVIEW = path.join(GBC, 'build', 'preview');
const REPORT = process.argv.includes('--report');

// ---------- the web game, with GBC art and overrides on top ----------
const W = { SPRITES: {}, console };
vm.createContext(W);
const runFile = (file, label) => vm.runInContext(fs.readFileSync(file, 'utf8').replace(/^(const|let) /gm, 'var '), W, { filename: label });
for (const f of ['palette', 'font', 'sprites-terrain', 'sprites-props', 'sprites-chars', 'sprites-chars2', 'sprites-world2', 'data']) runFile(path.join(ROOT, 'js', f + '.js'), `js/${f}.js`);
const ART = path.join(GBC, 'art');   // GBC art: same format as js/sprites-*.js, replaces web sprites by name, may add PAL colours
if (fs.existsSync(ART)) for (const f of fs.readdirSync(ART).filter(f => f.endsWith('.js')).sort()) runFile(path.join(ART, f), `gbc/art/${f}`);
const OV = require(path.join(GBC, 'overrides.js'));
for (const [k, v] of Object.entries(OV.areas || {})) Object.assign(W.AREAS[k], v);
const { PAL, SPRITES, AREAS, BIOMES, MONSTERS, ITEMS, TERRAIN, FONT } = W;

const COLS = 14, ROWS = 8, GX = 80, GY = 54;   // web grid origin, used by the floor-variant hash
const AREA_KEYS = Object.keys(AREAS), BIOME_KEYS = Object.keys(BIOMES);
const TERRAIN_PALS = 5, UI_PAL = 7, MAX_STATIC_TILES = 256, HUD_BASE = 128;
const problems = [];

const hash2 = (x, y) => { let h = (x * 374761393 + y * 668265263) | 0; h = Math.imul(h ^ (h >>> 13), 1274126177); return ((h ^ (h >>> 16)) >>> 0) / 4294967296; };
const rgbOf = k => { const h = PAL[k]; return [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)]; };
const dist = (a, b) => { const A = rgbOf(a), B = rgbOf(b), rm = (A[0] + B[0]) / 2, dr = A[0] - B[0], dg = A[1] - B[1], db = A[2] - B[2]; return (2 + rm / 256) * dr * dr + 4 * dg * dg + (2 + (255 - rm) / 256) * db * db; };
const luma = k => { const [r, g, b] = rgbOf(k); return 0.299 * r + 0.587 * g + 0.114 * b; };
const to555 = k => { const [r, g, b] = rgbOf(k); return (r >> 3) | ((g >> 3) << 5) | ((b >> 3) << 10); };
const from555 = v => [v & 31, (v >> 5) & 31, (v >> 10) & 31].map(c => (c << 3) | (c >> 2));

// ---------- what each cell shows at the start (mirrors makeArea + applyWhenDoors + drawWorld) ----------
function initialTiles(A) {
  const t = A.map.join('').split('').map(ch => (MONSTERS[ch] || ITEMS[ch] || ch === 'F' || ch === '&') ? '_' : ch);
  for (const [i, d] of Object.entries(A.doors)) if (d.when) t[i] = t[i] === 'd' ? '_' : t[i];
  return t;
}
function floorOf(key, A, gx, gy) { const [g, n] = BIOMES[A.biome].ground; return g + '_' + Math.floor(hash2(GX + gx * 16, GY + gy * 16 + key.length) * n); }
function doorStyle(A, ch, i) { const d = A.doors[i]; if (ch === 'D') return 'secretdoor'; return d ? d.style : 'hole'; }
function flatOf(A, ch, i) {
  const flat = { w: 'water_0', l: 'lava_0', '=': 'bridge', u: 'crumble', '+': 'plate', i: 'ice', x: 'snowdrift', e: 'vines', v: 'vent_0' };
  if (flat[ch]) return flat[ch];
  if (ch === '~') return 'void_' + (i % 3);
  if (ch === 'd' || ch === 'D') { const st = doorStyle(A, ch, i); if (st === 'hole' || st === 'rift') return st; }
  return null;
}
function tallOf(A, ch, i, gx, gy) {
  const b = A.biome;
  if (ch === 'T') {
    let name = BIOMES[b].tree;
    if (b === 'woods' || b === 'night' || b === 'lake' || b === 'pond') name = hash2(gx, gy) < 0.5 ? 'tree' : 'tree_b';
    if (b === 'enchanted') name = hash2(gx, gy) < 0.6 ? 'tree_magic' : 'tree';
    if (b === 'volcanic') name = 'tree_dead';
    if (b === 'grotto' || b === 'burrow') name = hash2(gx, gy) < 0.5 ? 'tree_b' : 'tree';
    return name;
  }
  if (ch === '@') return b === 'frozen' ? 'block_ice' : 'block';
  if (TERRAIN[ch] && TERRAIN[ch].spr) return TERRAIN[ch].spr;
  if (ch === 'd' || ch === 'D') {
    const st = doorStyle(A, ch, i), d = A.doors[i];
    if (d && d.req === 'gooking') return 'gate_goo';
    if (st === 'arch' || st === 'secretdoor') return st;
    if (st === 'portal') return 'portal_0';
  }
  if (ch === 'p') return 'portal_0';
  return null;
}
function blit(img, name, dx, dy, clipTop = 0) {
  const s = SPRITES[name]; if (!s) { problems.push(`missing sprite ${name}`); return; }
  s.rows.forEach((row, yy) => { for (let xx = 0; xx < row.length; xx++) {
    const ch = row[xx], X = dx + xx, Y = dy + yy;
    if (ch === '.' || !PAL[ch] || X < 0 || X > 15 || Y < clipTop || Y > 15) continue;
    img[Y * 16 + X] = ch;
  } });
}
// one area as a 224x128 image of palette keys; tall sprites of a cell overhang into the cell above
function composeArea(key) {
  const A = AREAS[key], tiles = initialTiles(A), img = new Array(224 * 128);
  const tall = tiles.map((ch, i) => tallOf(A, ch, i, i % COLS, (i / COLS) | 0));
  for (let gy = 0; gy < ROWS; gy++) for (let gx = 0; gx < COLS; gx++) {
    const i = gy * COLS + gx, ch = tiles[i], cell = new Array(256);
    blit(cell, floorOf(key, A, gx, gy), 0, 0);
    const fl = flatOf(A, ch, i); if (fl) blit(cell, fl, 0, 0);
    if (tall[i]) { const s = SPRITES[tall[i]]; blit(cell, tall[i], Math.round(8 - s.w / 2), 16 - s.h); }
    const below = gy < ROWS - 1 ? i + COLS : -1;
    if (below >= 0 && tall[below]) {
      const s = SPRITES[tall[below]], isDoor = c => c === 'd' || c === 'D';
      const clip = s.h > 18 && isDoor(ch) && !isDoor(tiles[below]) ? 14 : 0;   // a tall obstacle never hides the doorway above it
      blit(cell, tall[below], Math.round(8 - s.w / 2), 32 - s.h, clip);
    }
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) img[(gy * 16 + y) * 224 + gx * 16 + x] = cell[y * 16 + x];
  }
  return { img, tiles };
}
const cut = (img, w, tx, ty) => { const t = []; for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) t.push(img[(ty * 8 + y) * w + tx * 8 + x]); return t; };

// ---------- colours: <=4 per tile, <=5 terrain palettes per biome ----------
function reduceTile(t, max) {
  const count = {}; for (const k of t) count[k] = (count[k] || 0) + 1;
  const map = {}; let keys = Object.keys(count);
  while (keys.length > max) {   // fold the rarest colour into its nearest neighbour
    keys.sort((a, b) => count[a] - count[b]);
    const k = keys.shift(); let best = keys[0];
    for (const o of keys) if (dist(k, o) < dist(k, best)) best = o;
    count[best] += count[k]; map[k] = best;
  }
  const f = k => (map[k] ? f(map[k]) : k);
  return t.map(f);
}
function solvePalettes(tiles, K) {
  const sets = new Map();
  for (const t of tiles) { const cols = [...new Set(t)].sort(), id = cols.join(''); const s = sets.get(id) || { cols, w: 0, px: {} }; s.w++; for (const k of t) s.px[k] = (s.px[k] || 0) + 1; sets.set(id, s); }
  const order = [...sets.values()].sort((a, b) => b.cols.length - a.cols.length || b.w - a.w);
  const pals = [], left = [];
  for (const s of order) {
    let best = null, add = 9;
    for (const p of pals) { const u = new Set([...p, ...s.cols]); if (u.size <= 4 && u.size - p.size < add) { best = p; add = u.size - p.size; } }
    if (best) s.cols.forEach(c => best.add(c)); else if (pals.length < K) pals.push(new Set(s.cols)); else left.push(s);
  }
  for (const s of left) {   // no palette holds it: grow one with room, else the one that costs least
    const room = pals.filter(p => p.size < 4);
    for (const p of room) { const miss = s.cols.filter(c => !p.has(c)).sort((a, b) => s.px[b] - s.px[a]); while (p.size < 4 && miss.length) p.add(miss.shift()); }
  }
  return pals.map(p => [...p].sort((a, b) => luma(a) - luma(b)));
}
function bestPalette(t, pals) {
  let best = 0, bestErr = Infinity, bestIdx = null;
  pals.forEach((p, pi) => {
    let err = 0; const idx = t.map(k => { let j = p.indexOf(k); if (j >= 0) return j; j = 0; for (let q = 1; q < p.length; q++) if (dist(k, p[q]) < dist(k, p[j])) j = q; err += dist(k, p[j]); return j; });
    if (err < bestErr) { best = pi; bestErr = err; bestIdx = idx; }
  });
  return { pal: best, idx: bestIdx, err: bestErr };
}

// ---------- tiles: 2bpp encoding and dedupe with flips ----------
const enc2bpp = idx => { const out = []; for (let y = 0; y < 8; y++) { let lo = 0, hi = 0; for (let x = 0; x < 8; x++) { const v = idx[y * 8 + x]; lo |= (v & 1) << (7 - x); hi |= ((v >> 1) & 1) << (7 - x); } out.push(lo, hi); } return out; };
const flipX = t => t.map((_, i) => t[(i & ~7) + 7 - (i & 7)]), flipY = t => t.map((_, i) => t[(7 - (i >> 3)) * 8 + (i & 7)]);
class TileSet {
  constructor() { this.tiles = []; this.index = new Map(); }
  add(idx) {   // returns [tile number, attribute flip bits]
    for (const [v, flip] of [[idx, 0], [flipX(idx), 0x20], [flipY(idx), 0x40], [flipX(flipY(idx)), 0x60]]) { const k = v.join(''); if (this.index.has(k)) return [this.index.get(k), flip]; }
    this.index.set(idx.join(''), this.tiles.length); this.tiles.push(idx); return [this.tiles.length - 1, 0];
  }
}

// ---------- text with the web game's bitmap font (build-time; the runtime font comes later) ----------
function textStrip(img, w, str, x, y, colour) {
  for (const ch of str.toUpperCase()) { const g = FONT[ch] || FONT['?']; for (let k = 0; k < g.px.length; k += 2) img[(y + g.px[k + 1]) * w + x + g.px[k]] = colour; x += g.w + 1; }
  return x;
}
const textWidth = str => [...str.toUpperCase()].reduce((a, ch) => a + (FONT[ch] || FONT['?']).w + 1, 0) - 1;
const UI_COLOURS = ['1', '6', '4', 'y'];   // background, text, dim, accent
function hudFor(n, key) {
  const A = AREAS[key], img = new Array(160 * 16).fill(0);
  let x = textStrip(img, 160, String(n + 1).padStart(2, '0') + '/' + AREA_KEYS.length, 2, 1, 3);
  textStrip(img, 160, A.title, x + 5, 1, 1);
  textStrip(img, 160, A.biome, 158 - textWidth(A.biome), 1, 2);
  textStrip(img, 160, 'SELECT NEXT  B BACK  < > LOOK', 2, 9, 2);
  const set = new TileSet(), map = [];
  for (let ty = 0; ty < 2; ty++) for (let tx = 0; tx < 20; tx++) { const idx = []; for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) idx.push(img[(ty * 8 + y) * 160 + tx * 8 + x]); map.push(HUD_BASE + set.add(idx)[0]); }
  if (set.tiles.length > 64) problems.push(`${key}: HUD needs ${set.tiles.length} tiles`);
  return { tiles: set.tiles, map, img };
}

// ---------- build every biome's tileset and every area's map ----------
const composed = Object.fromEntries(AREA_KEYS.map(k => [k, composeArea(k)]));
const biomeOut = {}, areaOut = {}, report = [];
for (const b of BIOME_KEYS) {
  const keys = AREA_KEYS.filter(k => AREAS[k].biome === b); if (!keys.length) continue;
  const raw = [], over4 = [];
  for (const k of keys) for (let ty = 0; ty < 16; ty++) for (let tx = 0; tx < 28; tx++) { const t = cut(composed[k].img, 224, tx, ty); if (new Set(t).size > 4) over4.push(k); raw.push({ k, tx, ty, t: reduceTile(t, 4) }); }
  const pals = solvePalettes(raw.map(r => r.t), TERRAIN_PALS), set = new TileSet();
  let errPx = 0;
  for (const k of keys) areaOut[k] = { map: new Array(448), attr: new Array(448), shown: new Array(224 * 128) };
  for (const r of raw) {
    const { pal, idx } = bestPalette(r.t, pals), [n, flip] = set.add(idx), o = areaOut[r.k], at = r.ty * 28 + r.tx;
    o.map[at] = n & 127; o.attr[at] = pal | (n >= 128 ? 0x08 : 0) | flip;
    const orig = cut(composed[r.k].img, 224, r.tx, r.ty);
    for (let p = 0; p < 64; p++) { const c = pals[pal][idx[p]]; o.shown[(r.ty * 8 + (p >> 3)) * 224 + r.tx * 8 + (p & 7)] = c; if (c !== orig[p]) errPx++; }
  }
  if (set.tiles.length > MAX_STATIC_TILES) problems.push(`biome ${b}: ${set.tiles.length} static tiles (budget ${MAX_STATIC_TILES})`);
  biomeOut[b] = { tiles: set.tiles, pals, keys, errPx, px: raw.length * 64, over4: over4.length };
}
AREA_KEYS.forEach((k, n) => { areaOut[k].hud = hudFor(n, k); });

// entity pressure per area: sprites on one row (8x16 sprites, 2 per 16 px character, 4 for a boss) and monster types
for (const k of AREA_KEYS) {
  const A = AREAS[k], flat = A.map.join(''); let worstRow = 0, objs = 2; const types = new Set();
  for (let y = 0; y < ROWS; y++) { let row = 0; for (let x = 0; x < COLS; x++) { const ch = flat[y * COLS + x], m = MONSTERS[ch]; if (m) { row += m.boss ? 4 : 2; types.add(ch); } else if (ch === '&') row += 2; } worstRow = Math.max(worstRow, row); }
  for (const ch of flat) { const m = MONSTERS[ch]; if (m) objs += m.boss ? 8 : 2; else if (ch === '&') objs += 2; }
  const b = biomeOut[A.biome];
  report.push({ k, biome: A.biome, rowObjs: worstRow, objs, types: types.size, biomeTiles: b.tiles.length, pals: b.pals.length, err: (100 * b.errPx / b.px).toFixed(1) });
}

// ---------- C output ----------
fs.mkdirSync(OUT, { recursive: true });
for (const f of fs.readdirSync(OUT)) if (/\.(c|h)$/.test(f)) fs.unlinkSync(path.join(OUT, f));
const hex = (arr, per = 16) => arr.map(v => '0x' + v.toString(16).padStart(2, '0')).reduce((lines, v, i) => { if (i % per === 0) lines.push([]); lines[lines.length - 1].push(v); return lines; }, []).map(l => '  ' + l.join(', ')).join(',\n');
const hex16 = arr => '  ' + arr.map(v => '0x' + v.toString(16).padStart(4, '0')).join(', ');
const cName = s => s.replace(/[^a-z0-9_]/gi, '_');
const HEAD = '// Generated by gbc/tools/build.js from js/data.js and the sprites. Do not edit.\n';

for (const [b, o] of Object.entries(biomeOut)) {
  const pal = []; for (let p = 0; p < TERRAIN_PALS; p++) for (let c = 0; c < 4; c++) pal.push(o.pals[p] && o.pals[p][c] ? to555(o.pals[p][c]) : 0);
  fs.writeFileSync(path.join(OUT, `biome_${b}.c`), `${HEAD}#pragma bank 255\n#include <gb/gb.h>\n#include <gb/cgb.h>\n#include "world.h"\n\nBANKREF(biome_${b})\n` +
    `static const uint8_t tiles[] = {\n${hex(o.tiles.flatMap(enc2bpp))}\n};\nstatic const palette_color_t pal[] = {\n${hex16(pal)}\n};\n` +
    `const biome_t biome_${b} = { ${o.tiles.length}, tiles, pal };\n`);
}
for (const k of AREA_KEYS) {
  const o = areaOut[k], n = cName(k), hudTiles = o.hud.tiles.flatMap(enc2bpp);
  fs.writeFileSync(path.join(OUT, `area_${n}.c`), `${HEAD}#pragma bank 255\n#include <gb/gb.h>\n#include "world.h"\n\nBANKREF(area_${n})\n` +
    `static const uint8_t map[] = {\n${hex(o.map, 28)}\n};\nstatic const uint8_t attr[] = {\n${hex(o.attr, 28)}\n};\n` +
    `static const uint8_t hud_tiles[] = {\n${hex(hudTiles)}\n};\nstatic const uint8_t hud_map[] = {\n${hex(o.hud.map, 20)}\n};\n` +
    `const area_t area_${n} = { ${BIOME_KEYS.indexOf(AREAS[k].biome)}, map, attr, ${o.hud.tiles.length}, hud_tiles, hud_map };\n`);
}
const usedBiomes = BIOME_KEYS.filter(b => biomeOut[b]);
fs.writeFileSync(path.join(OUT, 'world.h'), `${HEAD}#ifndef FANG_WORLD_H\n#define FANG_WORLD_H\n#include <stdint.h>\n#include <gb/cgb.h>\n\n` +
  `#define AREA_COUNT ${AREA_KEYS.length}\n#define BIOME_COUNT ${BIOME_KEYS.length}\n#define AREA_W 28   // tiles\n#define AREA_H 16\n#define HUD_BASE ${HUD_BASE}\n#define UI_PAL ${UI_PAL}\n\n` +
  `typedef struct { uint16_t tiles_n; const uint8_t *tiles; const palette_color_t *pal; } biome_t;   // pal: ${TERRAIN_PALS} palettes x 4\n` +
  `typedef struct { uint8_t biome; const uint8_t *map; const uint8_t *attr; uint8_t hud_n; const uint8_t *hud_tiles; const uint8_t *hud_map; } area_t;\n\n` +
  `// each returns the ROM bank that holds *out and everything it points to\nuint8_t area_ref(uint8_t a, const area_t **out);\nuint8_t biome_ref(uint8_t b, const biome_t **out);\n` +
  `extern const palette_color_t ui_pal[4];\n\n#endif\n`);
fs.writeFileSync(path.join(OUT, 'world.c'), `${HEAD}#include <gb/gb.h>\n#include "world.h"\n\n` +
  AREA_KEYS.map(k => `BANKREF_EXTERN(area_${cName(k)})\nextern const area_t area_${cName(k)};`).join('\n') + '\n' +
  usedBiomes.map(b => `BANKREF_EXTERN(biome_${b})\nextern const biome_t biome_${b};`).join('\n') + '\n\n' +
  `const palette_color_t ui_pal[4] = { ${UI_COLOURS.map(to555).map(v => '0x' + v.toString(16).padStart(4, '0')).join(', ')} };\n\n` +
  `uint8_t area_ref(uint8_t a, const area_t **out) {\n  switch (a) {\n${AREA_KEYS.map((k, i) => `    case ${i}: *out = &area_${cName(k)}; return BANK(area_${cName(k)});`).join('\n')}\n  }\n  return 0;\n}\n\n` +
  `uint8_t biome_ref(uint8_t b, const biome_t **out) {\n  switch (b) {\n${usedBiomes.map(b => `    case ${BIOME_KEYS.indexOf(b)}: *out = &biome_${b}; return BANK(biome_${b});`).join('\n')}\n  }\n  return 0;\n}\n`);

// ---------- preview PNGs: what the ROM should show, before the emulator ----------
function png(file, w, h, rgbAt) {
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) { raw[y * (w * 3 + 1)] = 0; for (let x = 0; x < w; x++) { const c = rgbAt(x, y), o = y * (w * 3 + 1) + 1 + x * 3; raw[o] = c[0]; raw[o + 1] = c[1]; raw[o + 2] = c[2]; } }
  const chunk = (type, data) => { const b = Buffer.alloc(12 + data.length); b.writeUInt32BE(data.length, 0); b.write(type, 4, 'ascii'); data.copy(b, 8); b.writeUInt32BE(zlib.crc32(Buffer.concat([Buffer.from(type, 'ascii'), data])) >>> 0, 8 + data.length); return b; };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  fs.writeFileSync(file, Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]));
}
fs.mkdirSync(PREVIEW, { recursive: true });
const SHEET_COLS = 4, CW = 224, CH = 144 + 4;
png(path.join(PREVIEW, 'areas.png'), SHEET_COLS * (CW + 4), Math.ceil(AREA_KEYS.length / SHEET_COLS) * CH, (x, y) => {
  const n = Math.floor(y / CH) * SHEET_COLS + Math.floor(x / (CW + 4)), lx = x % (CW + 4), ly = y % CH, k = AREA_KEYS[n];
  if (!k || lx >= CW || ly >= 144) return [16, 16, 24];
  if (ly < 128) return from555(to555(areaOut[k].shown[ly * 224 + lx]));
  if (lx >= 160) return [16, 16, 24];
  return from555(to555(UI_COLOURS[areaOut[k].hud.img[(ly - 128) * 160 + lx]]));
});

// ---------- report ----------
const pad = (s, n) => String(s).padEnd(n);
if (REPORT || problems.length) {
  console.log(pad('area', 18) + pad('biome', 10) + pad('row objs', 10) + pad('objs', 6) + pad('types', 7) + pad('biome tiles', 13) + 'recoloured');
  for (const r of report) console.log(pad(r.k, 18) + pad(r.biome, 10) + pad(r.rowObjs + (r.rowObjs > 8 ? ' !' : ''), 10) + pad(r.objs, 6) + pad(r.types, 7) + pad(r.biomeTiles, 13) + r.err + '%');
}
const worst = Object.entries(biomeOut).sort((a, b) => b[1].tiles.length - a[1].tiles.length)[0];
console.log(`${AREA_KEYS.length} areas, ${Object.keys(biomeOut).length} biome tilesets (largest ${worst[0]} ${worst[1].tiles.length}/${MAX_STATIC_TILES}), preview ${path.relative(ROOT, path.join(PREVIEW, 'areas.png'))}`);
try { execFileSync('node', [path.join(ROOT, 'tools', 'validate.js'), '--gbc'], { stdio: 'pipe' }); }
catch (e) { problems.push('tools/validate.js --gbc failed:\n' + String(e.stdout || e.message).trim()); }
if (problems.length) { console.error('\n' + problems.join('\n')); process.exit(1); }
