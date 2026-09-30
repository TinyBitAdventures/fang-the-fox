#!/usr/bin/env node
// Fang the Fox, Game Boy Color edition: turns the web game's maps, art and data into the generated C
// (tilesets, sprites, palettes, areas, doors, the HUD font, music) and checks every area against the
// GBC's budgets. usage: node gbc/tools/build.js [--report]      (the Makefile runs it before compiling)
'use strict';
const fs = require('fs'), path = require('path'), vm = require('vm'), { execFileSync } = require('child_process');
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
const { PAL, SPRITES, AREAS, BIOMES, MONSTERS, ITEMS, TERRAIN, FONT, TRACKS, KITS } = W;
const G = require('./lib/gfx')(PAL), SONG = require('./lib/song');

const COLS = 14, ROWS = 8, GX = 80, GY = 54;   // web grid origin, used by the floor-variant hash
const AREA_KEYS = Object.keys(AREAS), BIOME_KEYS = Object.keys(BIOMES), TRACK_KEYS = Object.keys(TRACKS);
const TERRAIN_PALS = 5, MAX_STATIC_TILES = 256, OBJ_TILES = 128;   // OBJ tiles: 0x8000-0x87FF in each VRAM bank
const problems = [];
const hash2 = (x, y) => { let h = (x * 374761393 + y * 668265263) | 0; h = Math.imul(h ^ (h >>> 13), 1274126177); return ((h ^ (h >>> 16)) >>> 0) / 4294967296; };
const cName = s => s.replace(/[^a-z0-9_]/gi, '_');
const spr = name => { const s = SPRITES[name]; if (!s) throw new Error(`missing sprite ${name}`); return s; };

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
function blit(img, w, h, name, dx, dy, clipTop = 0) {
  spr(name).rows.forEach((row, yy) => { for (let xx = 0; xx < row.length; xx++) {
    const ch = row[xx], X = dx + xx, Y = dy + yy;
    if (ch === '.' || !PAL[ch] || X < 0 || X >= w || Y < clipTop || Y >= h) continue;
    img[Y * w + X] = ch;
  } });
}
// one area as a 224x128 image of palette keys; tall sprites of a cell overhang into the cell above
function composeArea(key) {
  const A = AREAS[key], tiles = initialTiles(A), img = new Array(224 * 128);
  const tall = tiles.map((ch, i) => tallOf(A, ch, i, i % COLS, (i / COLS) | 0));
  for (let gy = 0; gy < ROWS; gy++) for (let gx = 0; gx < COLS; gx++) {
    const i = gy * COLS + gx, ch = tiles[i], cell = new Array(256);
    blit(cell, 16, 16, floorOf(key, A, gx, gy), 0, 0);
    const fl = flatOf(A, ch, i); if (fl) blit(cell, 16, 16, fl, 0, 0);
    if (tall[i]) { const s = spr(tall[i]); blit(cell, 16, 16, tall[i], Math.round(8 - s.w / 2), 16 - s.h); }
    const below = gy < ROWS - 1 ? i + COLS : -1;
    if (below >= 0 && tall[below]) {
      const s = spr(tall[below]), isDoor = c => c === 'd' || c === 'D';
      const clip = s.h > 18 && isDoor(ch) && !isDoor(tiles[below]) ? 14 : 0;   // a tall obstacle never hides the doorway above it
      blit(cell, 16, 16, tall[below], Math.round(8 - s.w / 2), 32 - s.h, clip);
    }
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) img[(gy * 16 + y) * 224 + gx * 16 + x] = cell[y * 16 + x];
  }
  return { img, tiles };
}
const cut = (img, w, tx, ty, th = 8) => { const t = []; for (let y = 0; y < th; y++) for (let x = 0; x < 8; x++) t.push(img[(ty * th + y) * w + tx * 8 + x]); return t; };

// ---------- background: one tileset and 5 palettes per biome ----------
const composed = Object.fromEntries(AREA_KEYS.map(k => [k, composeArea(k)]));
const biomeOut = {}, areaOut = {};
for (const b of BIOME_KEYS) {
  const keys = AREA_KEYS.filter(k => AREAS[k].biome === b); if (!keys.length) continue;
  const raw = [];
  for (const k of keys) for (let ty = 0; ty < 16; ty++) for (let tx = 0; tx < 28; tx++) raw.push({ k, tx, ty, t: G.reduceTile(cut(composed[k].img, 224, tx, ty), 4) });
  const pals = G.solvePalettes(raw.map(r => r.t), TERRAIN_PALS), set = new G.TileSet();
  let errPx = 0;
  for (const k of keys) areaOut[k] = { map: new Array(448), attr: new Array(448), shown: new Array(224 * 128) };
  for (const r of raw) {
    const { pal, idx } = G.bestPalette(r.t, pals), [n, flip] = set.add(idx), o = areaOut[r.k], at = r.ty * 28 + r.tx;
    o.map[at] = n & 127; o.attr[at] = pal | (n >= 128 ? 0x08 : 0) | flip;
    const orig = cut(composed[r.k].img, 224, r.tx, r.ty);
    for (let p = 0; p < 64; p++) { const c = pals[pal][idx[p]]; o.shown[(r.ty * 8 + (p >> 3)) * 224 + r.tx * 8 + (p & 7)] = c; if (c !== orig[p]) errPx++; }
  }
  if (set.tiles.length > MAX_STATIC_TILES) problems.push(`biome ${b}: ${set.tiles.length} static tiles (budget ${MAX_STATIC_TILES})`);
  biomeOut[b] = { tiles: set.tiles, pals, keys, errPx, px: raw.length * 64 };
}

// ---------- sprites: every kind of thing that moves, in 8x16 sprite tiles ----------
// A kind's frames are padded into a box of cols x 8 by rows x 16 pixels, bottom-anchored and centred on
// its cell like drawSpr (x = round(cell centre - w / 2)). Each 8x16 piece gets 3 colours + transparent.
const NPC_SPR = { grandma: 'grandma', hoot: 'hoot', rudy: 'rudy', lumen: 'lumen', queen: 'queen' };
const npcKind = id => (KITS.includes(id) ? 'kit' : NPC_SPR[id]);
const mKind = ch => 'm_' + MONSTERS[ch].spr;
const KF = { FLIES: 1, BOSS: 2, NPC: 4, FAST: 8, TALL: 16 };
function kindDef(name) {
  if (name === 'fox') return { frames: ['fox_0', 'fox_1', 'fox_hop', 'fox_attack'], flags: 0, share: null };
  if (name === 'kit') return { frames: ['kit_0', 'kit_1'], flags: KF.NPC, share: 'fox' };
  if (Object.values(NPC_SPR).includes(name)) return { frames: [name + '_0', name + '_1'], flags: KF.NPC };
  const m = Object.values(MONSTERS).find(m => 'm_' + m.spr === name);   // monster kinds are "m_<sprite>" (map letters differ only by case)
  return { frames: [m.spr + '_0', m.spr + '_1'], flags: (m.flies ? KF.FLIES : 0) | (m.boss ? KF.BOSS : 0) | (m.spr === 'bat' ? KF.FAST : 0), pals: m.boss ? 2 : 1 };
}
function pieces(frames) {   // all 8x16 pieces of all frames, and the box
  const w = Math.max(...frames.map(f => spr(f).w)), h = Math.max(...frames.map(f => spr(f).h));
  const cols = Math.ceil(w / 8), rows = Math.ceil(h / 16), bw = cols * 8, bh = rows * 16, out = [];
  for (const f of frames) {
    const s = spr(f), img = new Array(bw * bh).fill(null);
    blit(img, bw, bh, f, Math.round(bw / 2 - s.w / 2), bh - s.h);
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) out.push(cut(img, bw, c, r, 16));
  }
  return { cols, rows, pieces: out };
}
const kinds = {};
function buildKind(name) {
  if (kinds[name]) return kinds[name];
  const def = kindDef(name), p = pieces(def.frames), reduced = p.pieces.map(t => G.reduceTile(t, 3));
  let pals;
  if (def.share) pals = buildKind(def.share).pals;
  else if (name === 'fox') pals = G.solvePalettes(reduced.concat(pieces(kindDef('kit').frames).pieces.map(t => G.reduceTile(t, 3))), 1, 3);
  else pals = G.solvePalettes(reduced, def.pals || 1, 3);
  const palOf = [], tiles = [];
  for (const t of reduced) { const { pal, idx } = G.bestPalette(t, pals, 1); palOf.push(pal); tiles.push(idx); }
  return (kinds[name] = { name, id: 0, frames: def.frames.length, cols: p.cols, rows: p.rows, flags: def.flags | (p.rows > 1 ? KF.TALL : 0), share: def.share || null, pals, palOf, tiles, ownPals: def.share ? 0 : pals.length });
}
// the edge marker: an arrow pointing left (flipped for the right edge), in the effects palette
const MARKER = (() => { const t = new Array(128).fill(0); [[5, 4], [4, 5], [3, 6], [4, 7], [5, 8]].forEach(([x, y]) => { t[y * 8 + x] = 1; t[y * 8 + x + 1] = 2; t[y * 8 + x + 2] = 2; }); [[2, 5], [1, 6], [2, 7]].forEach(([x, y]) => { t[y * 8 + x] = 1; t[y * 8 + x + 1] = 3; }); return t; })();
kinds.marker = { name: 'marker', frames: 1, cols: 1, rows: 1, flags: 0, pals: [], palOf: [0], tiles: [MARKER], ownPals: 0, fixed: 1 };
const EFFECTS_PAL = ['0', 'y', '6'];   // sprite palette 1: outline, yellow, white (markers, later damage numbers)
buildKind('fox'); buildKind('kit');
for (const A of Object.values(AREAS)) for (const [i, ch] of [...A.map.join('')].entries()) {
  if (MONSTERS[ch]) { buildKind(mKind(ch)); if (MONSTERS[ch].summon) buildKind(mKind(MONSTERS[ch].summon)); if (MONSTERS[ch].splits) buildKind(mKind('s')); }
  else if (ch === '&') buildKind(npcKind(A.npcs[i]));
}
const KIND_NAMES = Object.keys(kinds);
KIND_NAMES.forEach((k, n) => { kinds[k].id = n; });

// ---------- areas: cells, doors, things in them, and where their sprites go ----------
const REQ = [null, 'gooking', 'pathfinder', 'crystalKey', 'frost_cloak', 'dragon_scale'];
const WHEN = [null, ...new Set(Object.values(AREAS).flatMap(A => Object.values(A.doors).map(d => d.when).filter(Boolean)))];
const spawnOf = A => { const i = A.map.join('').indexOf('F'); return i >= 0 ? i : 43; };
const report = [];
for (const key of AREA_KEYS) {
  const A = AREAS[key], flat = A.map.join(''), o = areaOut[key];
  o.cells = composed[key].tiles.map(c => c.charCodeAt(0));
  o.doors = Object.entries(A.doors).map(([i, d]) => {
    if (d.req && !REQ.includes(d.req)) problems.push(`${key}: door ${i} needs unknown ${d.req}`);
    return { cell: +i, to: AREA_KEYS.indexOf(d.to), spawn: d.spawn !== undefined ? d.spawn : spawnOf(AREAS[d.to]), req: Math.max(0, REQ.indexOf(d.req || null)), when: Math.max(0, WHEN.indexOf(d.when || null)), name: d.name || '' };
  });
  o.ents = []; const used = ['fox', 'marker'];
  [...flat].forEach((ch, i) => {
    let k = null;
    if (MONSTERS[ch]) k = mKind(ch); else if (ch === '&') k = npcKind(A.npcs[i]);
    if (!k) return;
    if (!used.includes(k)) used.push(k);
    o.ents.push({ kind: used.indexOf(k), cell: i });
    const m = MONSTERS[ch];
    if (m && m.summon && !used.includes(mKind(m.summon))) used.push(mKind(m.summon));
    if (m && m.splits && !used.includes(mKind('s'))) used.push(mKind('s'));
  });
  if (key === 'home' && !used.includes('kit')) used.push('kit');   // rescued kits come home
  // sprite VRAM and palettes: fox in bank 0 from tile 0, then every kind this area can show
  let bank = 0, next = 0, slot = 2; const worst = { tiles: 0 };
  o.kinds = used.map(k => {
    const K = kinds[k], n = K.tiles.length * 2;
    if (next + n > OBJ_TILES) { bank++; next = 0; }
    if (bank > 1) problems.push(`${key}: sprite tiles do not fit in VRAM`);
    const at = { kind: K.id, bank, tile: next, pal: k === 'fox' || K.share === 'fox' ? 0 : k === 'marker' ? 1 : slot };
    next += n; worst.tiles = bank * OBJ_TILES + next;
    if (K.ownPals && k !== 'fox') slot += K.ownPals;
    return at;
  });
  if (slot > 8) problems.push(`${key}: needs ${slot} sprite palettes (8 on the GBC)`);
  const pal = [];
  const put = (s, cols) => { for (let c = 0; c < 4; c++) pal[s * 4 + c] = c && cols[c - 1] ? G.to555(cols[c - 1]) : 0; };
  for (let s = 0; s < 8; s++) put(s, []);
  put(0, kinds.fox.pals[0]); put(1, EFFECTS_PAL);
  o.kinds.forEach((at, n) => { const K = kinds[used[n]]; if (at.pal >= 2) K.pals.forEach((p, j) => put(at.pal + j, p)); });
  o.objPal = pal;
  // pressure: sprites on one row (plus Fang), sprites in all
  let rowObjs = 0, objs = kinds.fox.cols * kinds.fox.rows;
  for (let y = 0; y < ROWS; y++) { let n = 0; for (const e of o.ents) if (((e.cell / COLS) | 0) === y) { const K = kinds[used[e.kind]]; n += K.cols; } rowObjs = Math.max(rowObjs, n); }
  for (const e of o.ents) { const K = kinds[used[e.kind]]; objs += K.cols * K.rows; }
  report.push({ key, biome: A.biome, rowObjs, objs, pals: slot, objTiles: worst.tiles, biomeTiles: biomeOut[A.biome].tiles.length, err: (100 * biomeOut[A.biome].errPx / biomeOut[A.biome].px).toFixed(1) });
}

// ---------- the HUD: icons, bar pieces and the font ----------
const HUD_PAL = ['1', 'R', '4', '6'], TEXT_PAL = ['1', '6', '4', 'y'];   // BG palettes 6 (icons, bar) and 7 (text)
const icon = name => cut((() => { const s = spr(name), img = new Array(64).fill('1'); blit(img, 8, 8, name, 0, 0); return img.map(k => (k === '0' ? '1' : k)); })(), 8, 0, 0).map(k => HUD_PAL.indexOf(G.nearest(k, HUD_PAL)));
const barTile = fill => { const t = new Array(64).fill(0); for (let y = 2; y < 6; y++) for (let x = 0; x < 8; x++) t[y * 8 + x] = x < fill ? 1 : 2; return t; };
const UI_TILES = [new Array(64).fill(0), icon('ico_heart'), icon('ico_sword'), icon('ico_fish'), icon('ico_gem')];
for (let f = 0; f <= 8; f++) UI_TILES.push(barTile(f));
const glyphs = [];
for (let c = 32; c < 96; c++) { const g = FONT[String.fromCharCode(c)] || FONT['?']; const rows = [0, 0, 0, 0, 0]; for (let k = 0; k < g.px.length; k += 2) rows[g.px[k + 1]] |= 0x80 >> g.px[k]; glyphs.push([g.w, ...rows]); }

// ---------- C output ----------
fs.mkdirSync(OUT, { recursive: true });
for (const f of fs.readdirSync(OUT)) if (/\.(c|h)$/.test(f)) fs.unlinkSync(path.join(OUT, f));
const hex = (arr, per = 16) => arr.map(v => '0x' + v.toString(16).padStart(2, '0')).reduce((lines, v, i) => { if (i % per === 0) lines.push([]); lines[lines.length - 1].push(v); return lines; }, []).map(l => '  ' + l.join(', ')).join(',\n');
const hex16 = arr => '  ' + arr.map(v => '0x' + v.toString(16).padStart(4, '0')).join(', ');
const cstr = s => '"' + s.toUpperCase().replace(/[\\"]/g, '\\$&') + '"';
const HEAD = '// Generated by gbc/tools/build.js from the web game. Do not edit.\n';
const write = (f, s) => fs.writeFileSync(path.join(OUT, f), HEAD + s);

for (const [b, o] of Object.entries(biomeOut)) {
  const pal = []; for (let p = 0; p < TERRAIN_PALS; p++) for (let c = 0; c < 4; c++) pal.push(o.pals[p] && o.pals[p][c] ? G.to555(o.pals[p][c]) : 0);
  write(`biome_${b}.c`, `#pragma bank 255\n#include <gb/gb.h>\n#include "world.h"\n\nBANKREF(biome_${b})\n` +
    `static const uint8_t tiles[] = {\n${hex(o.tiles.flatMap(G.enc2bpp))}\n};\nstatic const palette_color_t pal[] = {\n${hex16(pal)}\n};\n` +
    `const biome_t biome_${b} = { ${o.tiles.length}, tiles, pal };\n`);
}
for (const K of Object.values(kinds)) {
  const pal = []; for (const p of K.pals) pal.push(0, ...[0, 1, 2].map(c => (p[c] ? G.to555(p[c]) : 0)));
  write(`kind_${K.name}.c`, `#pragma bank 255\n#include <gb/gb.h>\n#include "world.h"\n\nBANKREF(kind_${K.name})\n` +
    `static const uint8_t tiles[] = {\n${hex(K.tiles.flatMap(G.enc2bpp))}\n};\nstatic const uint8_t pal_of[] = { ${K.palOf.join(', ')} };\n` +
    `const kind_t kind_${K.name} = { ${K.cols}, ${K.rows}, ${K.frames}, ${K.flags}, ${K.tiles.length * 2}, tiles, pal_of };\n`);
}
AREA_KEYS.forEach((k, n) => {
  const o = areaOut[k], A = AREAS[k], c = cName(k);
  write(`area_${c}.c`, `#pragma bank 255\n#include <gb/gb.h>\n#include "world.h"\n\nBANKREF(area_${c})\n` +
    `static const uint8_t map[] = {\n${hex(o.map, 28)}\n};\nstatic const uint8_t attr[] = {\n${hex(o.attr, 28)}\n};\n` +
    `static const uint8_t cells[] = {\n${hex(o.cells, 14)}\n};\n` +
    `static const door_t doors[] = {\n${o.doors.map(d => `  { ${d.cell}, ${d.to}, ${d.spawn}, ${d.req}, ${d.when}, ${cstr(d.name)} }`).join(',\n') || '  { 0 }'}\n};\n` +
    `static const ent_t ents[] = {\n${o.ents.map(e => `  { ${e.kind}, ${e.cell} }`).join(',\n') || '  { 0 }'}\n};\n` +
    `static const area_kind_t kinds[] = {\n${o.kinds.map(a => `  { ${a.kind}, ${a.bank}, ${a.tile}, ${a.pal} }`).join(',\n')}\n};\n` +
    `static const palette_color_t obj_pal[] = {\n${hex16(o.objPal)}\n};\n` +
    `const area_t area_${c} = { ${BIOME_KEYS.indexOf(A.biome)}, ${TRACK_KEYS.indexOf(A.music)}, ${spawnOf(A)}, map, attr, cells, ${o.doors.length}, doors, ${o.ents.length}, ents, ${o.kinds.length}, kinds, obj_pal, ${cstr(A.title)} };\n`);
});
const songs = fs.readdirSync(path.join(GBC, 'music')).filter(f => f.endsWith('.js')).map(f => f.slice(0, -3));
for (const s of songs) fs.writeFileSync(path.join(OUT, `song_${s}.c`), SONG.compile(s, require(path.join(GBC, 'music', s + '.js'))));
const chFlags = new Array(128).fill(0);
for (let c = 32; c < 128; c++) { const ch = String.fromCharCode(c), T = TERRAIN[ch]; if (ch === '#' || ch === '~' || (T && T.solid) || ch === '@') chFlags[c] |= 1; if (ch === '~') chFlags[c] |= 2; if (ch === 'd' || ch === 'D') chFlags[c] |= 4; if (ch === 'w') chFlags[c] |= 8; }
const usedBiomes = BIOME_KEYS.filter(b => biomeOut[b]);
write('world.h', `#ifndef FANG_WORLD_H\n#define FANG_WORLD_H\n#include <stdint.h>\n#include <gb/cgb.h>\n\n` +
  `#define AREA_COUNT ${AREA_KEYS.length}\n#define KIND_COUNT ${KIND_NAMES.length}\n#define COLS ${COLS}\n#define ROWS ${ROWS}\n#define CELLS ${COLS * ROWS}\n#define AREA_W 28   // tiles\n#define AREA_H 16\n` +
  `#define UI_TILES ${UI_TILES.length}\n#define KIND_FOX ${kinds.fox.id}\n#define KIND_MARKER ${kinds.marker.id}\n` +
  `#define KF_FLIES ${KF.FLIES}\n#define KF_BOSS ${KF.BOSS}\n#define KF_NPC ${KF.NPC}\n#define KF_FAST ${KF.FAST}\n#define KF_TALL ${KF.TALL}   // two sprite rows\n` +
  `#define CF_SOLID 1\n#define CF_VOID 2\n#define CF_DOOR 4\n#define CF_WATER 8\n` +
  REQ.slice(1).map((r, i) => `#define REQ_${r.toUpperCase()} ${i + 1}\n`).join('') + WHEN.slice(1).map((r, i) => `#define WHEN_${r.toUpperCase()} ${i + 1}\n`).join('') +
  `\ntypedef struct { uint16_t tiles_n; const uint8_t *tiles; const palette_color_t *pal; } biome_t;   // pal: ${TERRAIN_PALS} palettes x 4\n` +
  `typedef struct { uint8_t cols, rows, frames, flags, tiles_n; const uint8_t *tiles; const uint8_t *pal_of; } kind_t;   // pal_of: palette (0/1) of each 8x16 piece\n` +
  `typedef struct { uint8_t cell, to, spawn, req, when; const char *name; } door_t;\n` +
  `typedef struct { uint8_t kind, cell; } ent_t;                     // kind: index into the area's kinds\n` +
  `typedef struct { uint8_t kind, bank, tile, pal; } area_kind_t;    // where this kind's sprite tiles and palettes go\n` +
  `typedef struct { uint8_t biome, music, spawn; const uint8_t *map, *attr, *cells; uint8_t door_n; const door_t *doors; uint8_t ent_n; const ent_t *ents;\n` +
  `                 uint8_t kind_n; const area_kind_t *kinds; const palette_color_t *obj_pal; const char *title; } area_t;\n\n` +
  `// each returns the ROM bank that holds *out and everything it points to\nuint8_t area_ref(uint8_t a, const area_t **out);\nuint8_t biome_ref(uint8_t b, const biome_t **out);\nuint8_t kind_ref(uint8_t k, const kind_t **out);\n\n` +
  `extern const uint8_t ch_flags[128];\nextern const uint8_t ui_tiles[UI_TILES * 16];\nextern const palette_color_t ui_pal[8];   // BG palettes 6 (icons) and 7 (text)\nextern const uint8_t font[64 * 6];        // ' ' to '_': width, then 5 rows\n\n#endif\n`);
write('world.c', `#include <gb/gb.h>\n#include "world.h"\n\n` +
  AREA_KEYS.map(k => `BANKREF_EXTERN(area_${cName(k)})\nextern const area_t area_${cName(k)};`).join('\n') + '\n' +
  usedBiomes.map(b => `BANKREF_EXTERN(biome_${b})\nextern const biome_t biome_${b};`).join('\n') + '\n' +
  KIND_NAMES.map(k => `BANKREF_EXTERN(kind_${k})\nextern const kind_t kind_${k};`).join('\n') + '\n\n' +
  `const uint8_t ch_flags[128] = {\n${hex(chFlags)}\n};\n` +
  `const uint8_t ui_tiles[] = {\n${hex(UI_TILES.flatMap(G.enc2bpp))}\n};\n` +
  `const palette_color_t ui_pal[8] = {\n${hex16(HUD_PAL.concat(TEXT_PAL).map(G.to555))}\n};\n` +
  `const uint8_t font[] = {\n${hex(glyphs.flat(), 12)}\n};\n\n` +
  `uint8_t area_ref(uint8_t a, const area_t **out) {\n  switch (a) {\n${AREA_KEYS.map((k, i) => `    case ${i}: *out = &area_${cName(k)}; return BANK(area_${cName(k)});`).join('\n')}\n  }\n  return 0;\n}\n\n` +
  `uint8_t biome_ref(uint8_t b, const biome_t **out) {\n  switch (b) {\n${usedBiomes.map(b => `    case ${BIOME_KEYS.indexOf(b)}: *out = &biome_${b}; return BANK(biome_${b});`).join('\n')}\n  }\n  return 0;\n}\n\n` +
  `uint8_t kind_ref(uint8_t k, const kind_t **out) {\n  switch (k) {\n${KIND_NAMES.map((k, i) => `    case ${i}: *out = &kind_${k}; return BANK(kind_${k});`).join('\n')}\n  }\n  return 0;\n}\n`);

// ---------- preview: every area's background as the ROM should draw it ----------
fs.mkdirSync(PREVIEW, { recursive: true });
const SHEET_COLS = 4, CW = 224, CH = 128 + 4;
G.png(path.join(PREVIEW, 'areas.png'), SHEET_COLS * (CW + 4), Math.ceil(AREA_KEYS.length / SHEET_COLS) * CH, (x, y) => {
  const n = Math.floor(y / CH) * SHEET_COLS + Math.floor(x / (CW + 4)), lx = x % (CW + 4), ly = y % CH, k = AREA_KEYS[n];
  if (!k || lx >= CW || ly >= 128) return [16, 16, 24];
  return G.from555(G.to555(areaOut[k].shown[ly * 224 + lx]));
});
// sprite sheet: every kind's frames with its palettes
{
  const list = Object.values(kinds), cellW = 36, cellH = 36, per = 8;
  const rgbOf = (K, piece, v) => { if (!v) return [40, 44, 70]; const cols = K.name === 'marker' ? EFFECTS_PAL : K.pals[K.palOf[piece]]; return G.from555(G.to555(cols[v - 1])); };
  G.png(path.join(PREVIEW, 'sprites.png'), per * cellW * 2, Math.ceil(list.length / per) * cellH, (x, y) => {
    const n = Math.floor(y / cellH) * per + Math.floor(x / (cellW * 2)), K = list[n]; if (!K) return [16, 16, 24];
    const f = Math.floor((x % (cellW * 2)) / cellW), lx = x % cellW - 2, ly = y % cellH - 2;
    if (f >= K.frames || lx < 0 || ly < 0 || lx >= K.cols * 8 || ly >= K.rows * 16) return [16, 16, 24];
    const piece = (f * K.rows + (ly >> 4)) * K.cols + (lx >> 3);
    return rgbOf(K, piece, K.tiles[piece][(ly & 15) * 8 + (lx & 7)]);
  });
}

// ---------- report ----------
const pad = (s, n) => String(s).padEnd(n);
if (REPORT || problems.length) {
  console.log(pad('area', 18) + pad('biome', 10) + pad('row sprites', 13) + pad('sprites', 9) + pad('sprite pals', 13) + pad('sprite tiles', 14) + pad('bg tiles', 10) + 'recoloured');
  for (const r of report) console.log(pad(r.key, 18) + pad(r.biome, 10) + pad(r.rowObjs + 2 + (r.rowObjs + 2 > 10 ? ' !' : ''), 13) + pad(r.objs, 9) + pad(r.pals + '/8', 13) + pad(r.objTiles + '/256', 14) + pad(r.biomeTiles + '/256', 10) + r.err + '%');
}
const worst = Object.entries(biomeOut).sort((a, b) => b[1].tiles.length - a[1].tiles.length)[0];
console.log(`${AREA_KEYS.length} areas, ${Object.keys(biomeOut).length} tilesets (largest ${worst[0]} ${worst[1].tiles.length}/${MAX_STATIC_TILES}), ${KIND_NAMES.length} sprite kinds, ${songs.length} song(s); previews in ${path.relative(ROOT, PREVIEW)}`);
try { execFileSync('node', [path.join(ROOT, 'tools', 'validate.js'), '--gbc'], { stdio: 'pipe' }); }
catch (e) { problems.push('tools/validate.js --gbc failed:\n' + String(e.stdout || e.message).trim()); }
if (problems.length) { console.error('\n' + problems.join('\n')); process.exit(1); }
