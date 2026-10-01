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
for (const f of ['palette', 'font', 'sprites-terrain', 'sprites-props', 'sprites-chars', 'sprites-chars2', 'sprites-world2', 'data', 'story']) runFile(path.join(ROOT, 'js', f + '.js'), `js/${f}.js`);
const ART = path.join(GBC, 'art');   // GBC art: same format as js/sprites-*.js, replaces web sprites by name, may add PAL colours
if (fs.existsSync(ART)) for (const f of fs.readdirSync(ART).filter(f => f.endsWith('.js')).sort()) runFile(path.join(ART, f), `gbc/art/${f}`);
const OV = require(path.join(GBC, 'overrides.js'));
for (const [k, v] of Object.entries(OV.areas || {})) Object.assign(W.AREAS[k], v);
const { PAL, SPRITES, AREAS, BIOMES, MONSTERS, ITEMS, TERRAIN, FONT, TRACKS, KITS, SPEAKERS, KIT_INFO, SHOP, CREDITS } = W;
const G = require('./lib/gfx')(PAL), SONG = require('./lib/song');

const COLS = 14, ROWS = 8, CELLS_N = COLS * ROWS, GX = 80, GY = 54;   // web grid origin, used by the floor-variant hash
const AREA_KEYS = Object.keys(AREAS), BIOME_KEYS = Object.keys(BIOMES), TRACK_KEYS = Object.keys(TRACKS);
// the songs converted for the Game Boy (music/<song>.js, from tools/music.js), and which plays for each web song key
const songs = fs.readdirSync(path.join(GBC, 'music')).filter(f => f.endsWith('.js') && !f.endsWith('.map.js') && f !== 'sfx.js').map(f => f.slice(0, -3)).sort();
const songTitle = s => { const m = require(path.join(GBC, 'music', s + '.js')); return (m.title || m.about.split(':')[0].replace(/^\d{4}-\d\d-\d\d /, '')).toUpperCase(); };   // "2022-10-30 Forest Home" -> FOREST HOME
const songOf = key => { const s = (OV.music || {})[key] || key; if (!songs.includes(s)) throw new Error(`no Game Boy song for "${key}" (music/${s}.js)`); return songs.indexOf(s); };
const TERRAIN_PALS = 5, OBJ_TILES = 128;   // OBJ tiles: 0x8000-0x87FF in each VRAM bank
// biome mood: the web game lays each biome's ambient colour over everything at B.dark strength and cuts light
// pools around Fang, friends, foes, items and lamps (render.js applyLighting). Here the terrain palettes take
// part of that darkness (overrides.js look) and sprites stay at full light, as the pools keep them on the web.
const hexRgb = h => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16));
const terrain555 = (k, b) => {
  const B = BIOMES[b], L = Object.assign({}, OV.look.default, OV.look[b]), lit = L.glow.includes(k), a = lit ? 0 : Math.min(1, L.light * B.dark), amb = hexRgb(B.ambient);
  let c = G.rgbOf(k).map((v, i) => v * (1 - a) + amb[i] * a);
  if (L.tint && !lit) { const g = hexRgb(L.tint[0]); c = c.map((v, i) => v * (1 - L.tint[1]) + g[i] * L.tint[1]); }
  const [r, gg, bl] = c.map(v => Math.min(255, Math.round(v)));
  return (r >> 3) | ((gg >> 3) << 5) | ((bl >> 3) << 10);
};
const problems = [];
const hash2 = (x, y) => { let h = (x * 374761393 + y * 668265263) | 0; h = Math.imul(h ^ (h >>> 13), 1274126177); return ((h ^ (h >>> 16)) >>> 0) / 4294967296; };
const cName = s => s.replace(/[^a-z0-9_]/gi, '_');
const spr = name => { const s = SPRITES[name]; if (!s) throw new Error(`missing sprite ${name}`); return s; };

// ---------- what each cell starts as (mirrors makeArea + applyWhenDoors) ----------
function initialTiles(A) {   // things that move (monsters, items, friends, blocks) stand on floor
  const t = A.map.join('').split('').map(ch => (MONSTERS[ch] || ITEMS[ch] || ch === 'F' || ch === '&' || ch === '@') ? '_' : ch);
  for (const [i, d] of Object.entries(A.doors)) if (d.when) t[i] = t[i] === 'd' ? '_' : t[i];
  return t;
}
function floorOf(key, A, gx, gy) { const [g, n] = BIOMES[A.biome].ground; return g + '_' + Math.floor(hash2(GX + gx * 16, GY + gy * 16 + key.length) * n); }
function treeOf(A, gx, gy) {
  const b = A.biome;
  let name = BIOMES[b].tree;
  if (b === 'woods' || b === 'night' || b === 'lake' || b === 'pond') name = hash2(gx, gy) < 0.5 ? 'tree' : 'tree_b';
  if (b === 'enchanted') name = hash2(gx, gy) < 0.6 ? 'tree_magic' : 'tree';
  if (b === 'volcanic') name = 'tree_dead';
  if (b === 'grotto' || b === 'burrow') name = hash2(gx, gy) < 0.5 ? 'tree_b' : 'tree';
  return name;
}
function blit(img, w, h, name, dx, dy, clipTop = 0) {
  spr(name).rows.forEach((row, yy) => { for (let xx = 0; xx < row.length; xx++) {
    const ch = row[xx], X = dx + xx, Y = dy + yy;
    if (ch === '.' || !PAL[ch] || X < 0 || X >= w || Y < clipTop || Y >= h) continue;
    img[Y * w + X] = ch;
  } });
}
const cut = (img, w, tx, ty, th = 8) => { const t = []; for (let y = 0; y < th; y++) for (let x = 0; x < 8; x++) t.push(img[(ty * th + y) * w + tx * 8 + x]); return t; };

// ---------- cells: every look a cell can take, drawn over the look of the cell below it ----------
// A cell's picture depends on its floor, its own look and the tall sprite of the cell below, which
// hangs into it (drawWorld sorts by y). The build draws every pairing that can happen in play; the ROM
// works out each cell's look from the rules' state (cells.c cell_look) and redraws a cell and the one
// above it when a look changes. DOOR is the cell's own door style (hole, rift, arch or portal); CAMO is
// a Treant hiding as a tree (view.js draws tree_magic in its place), drawn in the background until it wakes.
const LOOKS = ['FLOOR', 'ICE', 'LAVA', 'VOID', 'WATER', 'BRIDGE', 'CRUMBLE', 'PLATE', 'PLATE_ON', 'SNOWDRIFT', 'VINES', 'VENT', 'VENT_PUFF', 'FOG',
  'BRAZIER', 'GATE', 'LOCKGATE', 'SIGN', 'ROCK', 'BRICK', 'SNOWWALL', 'BASALT', 'TREE', 'PORTAL', 'CAMO', 'DOOR', 'DOOR_SECRET', 'GATE_GOO'];
const L = Object.fromEntries(LOOKS.map((k, i) => [k, i]));
const isDoorLook = l => l >= L.DOOR;   // the looks of 'd' and 'D' cells (view.js trims tall sprites below them)
const MAX_CELL_LOOKS = 5;
// animators: tiles that change over time, and their frame length (the web's ms at 60 frames a second).
// A lit brazier's flame is a sprite (kind "flame") over the cold brazier: its colours never fit a
// background palette next to the floor.
const ANIM_NAMES = ['none', 'portal', 'liquid', 'void'], ANIM_FRAMES = [0, 8, 16, 24];   // 140, 260, 400 ms
// landmarks (overrides.js areas: landmarks): a big web prop (the cottage, Rudy's tent...) drawn across a run of
// solid cells in one row, each cell its slice; the cells stay what they were, so play is unchanged
function markAt(A, i) {
  for (const m of A.landmarks || []) {
    const k = i - m.cell;
    if (k >= 0 && k < m.w && ((i / COLS) | 0) === ((m.cell / COLS) | 0)) return { name: m.spr, dx: Math.round((m.w * 16 - spr(m.spr).w) / 2) - k * 16, floor: m.floor };
  }
  return null;
}
function lookArt(A, i, look, f) {   // what a look draws at animation frame f (0-2)
  if ([L.ROCK, L.BRICK, L.SNOWWALL, L.BASALT, L.TREE].includes(look)) { const mark = markAt(A, i); if (mark) return { mark }; }
  const gx = i % COLS, gy = (i / COLS) | 0, d = A.doors[i], style = d ? d.style : 'hole';
  switch (look) {
    case L.ICE: return { flat: 'ice' };
    case L.LAVA: return { flat: 'lava_' + f, anim: 2 };
    case L.VOID: return { flat: 'void_' + ((f + i) % 3), anim: 3 };
    case L.WATER: return { flat: 'water_' + f, anim: 2 };
    case L.BRIDGE: return { flat: 'bridge' };
    case L.CRUMBLE: return { flat: 'crumble' };
    case L.PLATE: return { flat: 'plate' };
    case L.PLATE_ON: return { flat: 'plate_on' };
    case L.SNOWDRIFT: return { flat: 'snowdrift' };
    case L.VINES: return { flat: 'vines' };
    case L.VENT: return { flat: 'vent_0' };
    case L.VENT_PUFF: return { flat: 'vent_1' };
    case L.FOG: return { fog: 'fog' };
    case L.BRAZIER: return { tall: 'brazier_off' };
    case L.GATE: return { tall: 'gate' };
    case L.LOCKGATE: return { tall: 'lockgate' };
    case L.SIGN: return { tall: 'sign' };
    case L.ROCK: return { tall: 'rock' };
    case L.BRICK: return { tall: 'brick' };
    case L.SNOWWALL: return { tall: 'snowwall' };
    case L.BASALT: return { tall: 'basalt' };
    case L.TREE: return { tall: treeOf(A, gx, gy) };
    case L.PORTAL: return { tall: 'portal_' + f, anim: 1 };
    case L.CAMO: return { tall: 'tree_magic' };
    case L.DOOR: return style === 'hole' || style === 'rift' ? { flat: style } : style === 'portal' ? { tall: 'portal_' + f, anim: 1 } : { tall: style };
    case L.DOOR_SECRET: return { tall: 'secretdoor' };
    case L.GATE_GOO: return { tall: 'gate_goo' };
    default: return {};
  }
}
// what can change in an area: foes that leave ice or lava (and the ones they summon), blocks to push
function areaCaps(A) {
  const types = new Set([...A.map.join('')].filter(ch => MONSTERS[ch]));
  for (const t of [...types]) if (MONSTERS[t].summon) types.add(MONSTERS[t].summon);
  const ms = [...types].map(t => [t, MONSTERS[t]]);
  return {
    ice: ms.some(([t, m]) => m.shatter || m.trail === 'i' || t === 'Y'),
    lava: ms.some(([t, m]) => m.trail === 'l' || t === 'Q'),
    blocks: A.map.join('').includes('@'),
  };
}
// every tile a cell can hold during play (js/game.js: trails, the eruption, blocks sinking into water
// and lava, gates opening, crumbling, doors that appear), starting with the one it starts with
function cellChars(A, tiles, i, caps) {
  const chars = [tiles[i]], d = A.doors[i];
  if (d && d.when && !chars.includes('d')) chars.push('d');
  for (let k = 0; k < chars.length; k++) {
    const ch = chars[k], next = [];
    if (ch === '_') { if (caps.ice) next.push('i'); if (caps.lava) next.push('l'); }
    if (ch === 'l' && caps.blocks) next.push('_');
    if (ch === 'w' && caps.blocks) next.push('=');
    if (ch === '#' || ch === '%') next.push('_');
    if (ch === 'u') next.push(A.crumbleTo || '~');
    for (const n of next) if (!chars.includes(n)) chars.push(n);
  }
  return chars;
}
function charLooks(A, ch, i) {
  const d = A.doors[i];
  switch (ch) {
    case 'i': return [L.ICE]; case 'l': return [L.LAVA]; case '~': return [L.VOID]; case 'w': return [L.WATER]; case '=': return [L.BRIDGE];
    case 'u': return [L.CRUMBLE]; case '+': return [L.PLATE, L.PLATE_ON]; case 'x': return [L.SNOWDRIFT]; case 'e': return [L.VINES];
    case 'v': return [L.VENT, L.VENT_PUFF]; case 'o': return [L.FOG, L.FLOOR]; case '*': return [L.BRAZIER];
    case '#': return [L.GATE]; case '%': return [L.LOCKGATE]; case '?': return [L.SIGN]; case 'r': return [L.ROCK]; case 'b': return [L.BRICK];
    case 'n': return [L.SNOWWALL]; case 'y': return [L.BASALT]; case 'T': return [L.TREE]; case 'p': return [L.PORTAL];
    case 'd': return d && d.req === 'gooking' ? [L.GATE_GOO, L.DOOR] : [L.DOOR];
    case 'D': return [L.DOOR_SECRET, L.DOOR];
    default: return [L.FLOOR];
  }
}
function cellLooks(A, tiles, i, caps) {   // the looks a cell can take, its starting look first
  const looks = [];
  for (const ch of cellChars(A, tiles, i, caps)) for (const l of charLooks(A, ch, i)) if (!looks.includes(l)) looks.push(l);
  const m = MONSTERS[A.map.join('')[i]]; if (m && m.camo) looks.unshift(L.CAMO);   // hidden at the start
  return looks;
}
// one cell's 16x16 picture for its look a (frame fa) under the overhang of the look below, b (frame fb)
function composeCell(key, A, i, a, b, fa, fb) {
  const cell = new Array(256), gx = i % COLS, gy = (i / COLS) | 0;
  blit(cell, 16, 16, floorOf(key, A, gx, gy), 0, 0);
  const art = lookArt(A, i, a, fa);
  if (art.flat) blit(cell, 16, 16, art.flat, 0, 0);
  if (art.tall) { const s = spr(art.tall); blit(cell, 16, 16, art.tall, Math.round(8 - s.w / 2), 16 - s.h); }
  if (art.mark) { if (art.mark.floor) blit(cell, 16, 16, art.mark.floor, 0, 0); blit(cell, 16, 16, art.mark.name, art.mark.dx, 16 - spr(art.mark.name).h); }
  if (art.fog) { blit(cell, 16, 16, art.fog, 0, 0); blit(cell, 16, 16, art.fog, 0, -3); }
  if (b !== null) {
    const below = lookArt(A, i + COLS, b, fb);
    if (below.tall) {
      const s = spr(below.tall);
      const clip = s.h > 18 && isDoorLook(a) && !isDoorLook(b) ? 14 : 0;   // a tall obstacle never hides the doorway above it
      blit(cell, 16, 16, below.tall, Math.round(8 - s.w / 2), 32 - s.h, clip);
    }
    if (below.mark) blit(cell, 16, 16, below.mark.name, below.mark.dx, 32 - spr(below.mark.name).h);
  }
  return cell;
}

// ---------- background: one tileset and 5 palettes per biome, from every cell pairing ----------
const MAX_BG_TILES = 256;   // 0x9000 in both VRAM banks (0x8800: the HUD in bank 0, dialogue in bank 1); tileRef can go to 384
const biomeOut = {}, areaOut = {};
const cellInfo = {};        // per area: looks per cell, metatiles
for (const key of AREA_KEYS) {
  const A = AREAS[key], tiles = initialTiles(A), caps = areaCaps(A);
  cellInfo[key] = { tiles, looks: tiles.map((_, i) => cellLooks(A, tiles, i, caps)) };
  cellInfo[key].looks.forEach((ls, i) => { if (ls.length > MAX_CELL_LOOKS) problems.push(`${key}: cell ${i} can take ${ls.length} looks (${MAX_CELL_LOOKS} at most)`); });
}
const tileKey = t => t.join('');
for (const b of BIOME_KEYS) {
  const keys = AREA_KEYS.filter(k => AREAS[k].biome === b); if (!keys.length) continue;
  // every pairing's 4 tiles, each a list of frames (1, or 3 for animated tiles)
  const raw = [];
  for (const key of keys) {
    const A = AREAS[key], ci = cellInfo[key], metas = [];
    ci.metaBase = []; ci.metas = metas;
    for (let i = 0; i < CELLS_N; i++) {
      ci.metaBase[i] = metas.length;
      const below = i + COLS < CELLS_N ? ci.looks[i + COLS] : [null];
      for (const a of ci.looks[i]) for (const bl of below) {
        const animA = lookArt(A, i, a, 0).anim || 0, animB = bl === null ? 0 : (lookArt(A, i + COLS, bl, 0).anim || 0);
        const anim = animA || animB, nf = anim ? 3 : 1;
        const imgs = [];
        for (let f = 0; f < nf; f++) imgs.push(composeCell(key, A, i, a, bl, animA ? f : 0, animB && (!animA || animA === animB) ? f : 0));
        const m = { tiles: [] };
        for (let q = 0; q < 4; q++) {
          const frames = imgs.map(img => G.reduceTile(cut(img, 16, q & 1, q >> 1), 4));
          const same = frames.every(fr => tileKey(fr) === tileKey(frames[0]));
          const r = { key, anim: same ? 0 : anim, frames: same ? [frames[0]] : frames };
          raw.push(r); m.tiles.push(r);
        }
        metas.push(m);
      }
    }
  }
  const pals = G.solvePalettes(raw.flatMap(r => r.frames), TERRAIN_PALS, 4, true, ((OV.look[b] || {}).pin || []).map(p => [...p]));
  // each tile: the palette that suits all its frames, then its colour indices (the same tile comes up often)
  const fit = new Map();
  const fitOf = fr => { const k = tileKey(fr); let v = fit.get(k); if (!v) { v = pals.map(p => G.bestPalette(fr, [p])); fit.set(k, v); } return v; };
  for (const r of raw) {
    const fits = r.frames.map(fitOf);
    let best = 0, bestErr = Infinity;
    pals.forEach((_, pi) => { const e = fits.reduce((s, f) => s + f[pi].err, 0); if (e < bestErr) { bestErr = e; best = pi; } });
    r.pal = best; r.idx = fits.map(f => f[best].idx);
  }
  // unique tiles (flips count as the same tile), animated ones first and grouped by animator
  const flipX = t => t.map((_, j) => t[(j & ~7) + 7 - (j & 7)]), flipY = t => t.map((_, j) => t[(7 - (j >> 3)) * 8 + (j & 7)]);
  const seqKey = (anim, seq) => anim + ':' + seq.map(tileKey).join('|');
  const uniq = new Map(), order = [];
  for (const r of raw) {
    let hit = null;
    for (const [fl, fn] of [[0, t => t], [0x20, flipX], [0x40, flipY], [0x60, t => flipX(flipY(t))]]) { const k = seqKey(r.anim, r.idx.map(fn)); if (uniq.has(k)) { hit = [uniq.get(k), fl]; break; } }
    if (!hit) { const u = { anim: r.anim, idx: r.idx }; uniq.set(seqKey(r.anim, r.idx), u); order.push(u); hit = [u, 0]; }
    r.u = hit[0]; r.flip = hit[1];
  }
  order.sort((x, y) => (x.anim || 99) - (y.anim || 99));
  order.forEach((u, n) => { u.id = n; });
  if (order.length > MAX_BG_TILES) problems.push(`biome ${b}: ${order.length} background tiles (budget ${MAX_BG_TILES})`);
  // animated tiles: a run per animator, split where the VRAM block changes (tile 128 and 256)
  const segments = [];
  for (let a = 1; a < ANIM_NAMES.length; a++) {
    const us = order.filter(u => u.anim === a);
    for (let n = 0; n < us.length; ) {
      const first = us[n].id, lim = first < 128 ? 128 : first < 256 ? 256 : 384;
      let m = n; while (m < us.length && us[m].id < lim) m++;
      segments.push({ anim: a, first, tiles: us.slice(n, m) });
      n = m;
    }
  }
  let errPx = 0, px = 0;
  for (const r of raw) { px += 64; r.frames[0].forEach((k, j) => { if (pals[r.pal][r.idx[0][j]] !== k) errPx++; }); }
  biomeOut[b] = { order, pals, keys, segments, errPx, px };
  if (process.env.DEBUG_PALS) console.error(b, pals.map(p => p.map(k => k + PAL[k]).join(' ')).join(' | '));
}
// a tile number in the map and its attribute bits: 0-127 at 0x9000 in VRAM bank 0, 128-255 at 0x9000 in bank 1, 256- at 0x8800 in bank 1
const tileRef = (u, pal, flip) => ({ map: u.id < 128 ? u.id : u.id < 256 ? u.id - 128 : 128 + (u.id - 256), attr: pal | (u.id >= 128 ? 0x08 : 0) | flip });
for (const key of AREA_KEYS) {
  const ci = cellInfo[key], out = { meta: [], shown: new Array(224 * 128) };
  for (const m of ci.metas) { const t = m.tiles.map(r => tileRef(r.u, r.pal, r.flip)); out.meta.push(...t.map(x => x.map), ...t.map(x => x.attr)); }
  out.cellRecs = ci.looks.map((ls, i) => `${ci.metaBase[i]}, ${ls.length}, { ${ls.concat(new Array(MAX_CELL_LOOKS - ls.length).fill(0xFF)).join(', ')} }`);
  out.dyn = ci.looks.map((ls, i) => (ls.length > 1 ? i : -1)).filter(i => i >= 0);
  // cells whose look can change without their tile changing: plates, vents, doors that open or appear
  const COND = [L.PLATE, L.VENT, L.DOOR, L.GATE_GOO, L.DOOR_SECRET];
  out.cond = ci.looks.map((ls, i) => (ls.length > 1 && ls.some(l => COND.includes(l)) ? i : -1)).filter(i => i >= 0);
  if (out.cond.length > 16) problems.push(`${key}: ${out.cond.length} cells change look on their own (16 at most)`);
  // the starting picture (every cell's first look, frame 0), for the preview and shots.py
  const pals = biomeOut[AREAS[key].biome].pals;
  for (let i = 0; i < CELLS_N; i++) {
    const m = ci.metas[ci.metaBase[i]], gx = i % COLS, gy = (i / COLS) | 0;
    m.tiles.forEach((r, q) => { for (let p = 0; p < 64; p++) out.shown[(gy * 16 + (q >> 1) * 8 + (p >> 3)) * 224 + gx * 16 + (q & 1) * 8 + (p & 7)] = pals[r.pal][r.idx[0][p]]; });
  }
  areaOut[key] = out;
}

// ---------- sprites: every kind of thing that moves, in 8x16 sprite tiles ----------
// A kind's frames are padded into a box of cols x 8 by rows x 16 pixels, bottom-anchored and centred on
// its cell like drawSpr (x = round(cell centre - w / 2)). Each 8x16 piece gets 3 colours + transparent.
const NPC_SPR = { grandma: 'grandma', hoot: 'hoot', rudy: 'rudy', lumen: 'lumen', queen: 'queen' };
const NPC_IDS = ['grandma', 'hoot', 'rudy', 'lumen', 'queen', ...KITS];
const npcKind = id => (KITS.includes(id) ? 'kit' : NPC_SPR[id]);
const blockKind = A => (A.biome === 'frozen' ? 'block_ice' : 'block');
const mKind = ch => 'm_' + MONSTERS[ch].spr;
const IT = Object.keys(ITEMS);                 // item codes are 1 + the index here
const itemCode = k => IT.indexOf(k) + 1;
const iKind = k => 'i_' + ITEMS[k].spr;
const KF = { FLIES: 1, BOSS: 2, NPC: 4, FAST: 8, TALL: 16, ITEM: 32, BOB: 64, CAMO: 128 };   // CAMO: hidden in the background as a tree until revealed
function kindDef(name) {
  if (name === 'fox') return { frames: ['fox_0', 'fox_1', 'fox_hop', 'fox_attack'], flags: 0, share: null };
  if (name === 'kit') return { frames: ['kit_0', 'kit_1'], flags: KF.NPC, share: 'fox' };
  if (Object.values(NPC_SPR).includes(name)) return { frames: [name + '_0', name + '_1'], flags: KF.NPC };
  if (name === 'block' || name === 'block_ice') return { frames: [name], flags: 0 };
  if (name.startsWith('i_')) { const k = IT.find(k => iKind(k) === name); return { frames: [ITEMS[k].spr], flags: KF.ITEM | (k === 'C' || k === 'L' ? 0 : KF.BOB), item: k }; }
  const m = Object.values(MONSTERS).find(m => 'm_' + m.spr === name);   // monster kinds are "m_<sprite>" (map letters differ only by case)
  return { frames: [m.spr + '_0', m.spr + '_1'], flags: (m.flies ? KF.FLIES : 0) | (m.boss ? KF.BOSS : 0) | (m.spr === 'bat' ? KF.FAST : 0) | (m.camo ? KF.CAMO : 0), pals: m.boss ? 2 : 1 };
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
// Items share three sprite palettes solved over every item; the one the relics use is also the
// effects palette (sprite palette 1: edge arrows, damage numbers), so most areas' items cost nothing.
const itemPieces = Object.fromEntries(IT.map(k => [k, pieces([ITEMS[k].spr]).pieces.map(t => G.reduceTile(t, 3))]));
const ITEM_PALS = G.solvePalettes(Object.values(itemPieces).flat(), 3, 3);
const itemPalOf = Object.fromEntries(IT.map(k => { let best = 0, err = Infinity; ITEM_PALS.forEach((p, pi) => { const e = itemPieces[k].reduce((a, t) => a + G.bestPalette(t, [p], 1).err, 0); if (e < err) { err = e; best = pi; } }); return [k, best]; }));
const EFFECTS_ITEM_PAL = itemPalOf.a, EFFECTS_PAL = ITEM_PALS[EFFECTS_ITEM_PAL];
const kinds = {};
function buildKind(name) {
  if (kinds[name]) return kinds[name];
  const def = kindDef(name), p = pieces(def.frames), reduced = p.pieces.map(t => G.reduceTile(t, 3));
  let pals, itemPal = null;
  if (def.item) { itemPal = itemPalOf[def.item]; pals = [ITEM_PALS[itemPal]]; }
  else if (def.share) pals = buildKind(def.share).pals;
  else if (name === 'fox') pals = G.solvePalettes(reduced.concat(pieces(kindDef('kit').frames).pieces.map(t => G.reduceTile(t, 3))), 1, 3);
  else pals = G.solvePalettes(reduced, def.pals || 1, 3);
  const palOf = [], tiles = [];
  for (const t of reduced) { const { pal, idx } = G.bestPalette(t, pals, 1); palOf.push(pal); tiles.push(idx); }
  return (kinds[name] = { name, id: 0, frames: def.frames.length, cols: p.cols, rows: p.rows, flags: def.flags | (p.rows > 1 ? KF.TALL : 0), share: def.share || null, itemPal, pals, palOf, tiles, ownPals: def.share || def.item ? 0 : pals.length });
}
// the edge marker: an arrow pointing left (flipped for the right edge), in the effects palette
const MARKER = (() => { const t = new Array(128).fill(0); [[5, 4], [4, 5], [3, 6], [4, 7], [5, 8]].forEach(([x, y]) => { t[y * 8 + x] = 1; t[y * 8 + x + 1] = 2; t[y * 8 + x + 2] = 2; }); [[2, 5], [1, 6], [2, 7]].forEach(([x, y]) => { t[y * 8 + x] = 1; t[y * 8 + x + 1] = 3; }); return t; })();
// frame 1: the "!" over a friend with something new to say (view.js npcHasNews)
const EXCLAIM = (() => { const t = new Array(128).fill(0); for (let y = 4; y <= 14; y++) for (let x = 2; x <= 5; x++) t[y * 8 + x] = 1; for (let y = 5; y <= 10; y++) { t[y * 8 + 3] = 3; t[y * 8 + 4] = 2; } t[12 * 8 + 3] = 3; t[12 * 8 + 4] = 2; t[13 * 8 + 3] = 2; t[13 * 8 + 4] = 2; for (let x = 2; x <= 5; x++) t[11 * 8 + x] = 1; return t; })();
kinds.marker = { name: 'marker', frames: 2, cols: 1, rows: 1, flags: 0, pals: [], palOf: [0, 0], tiles: [MARKER, EXCLAIM], ownPals: 0 };
// a lit brazier's flame: what brazier_on_0-2 add to brazier_off (the flame and the glowing coals), in the
// top 16 rows of the 20-row sprite, so its bottom sits 4 px above the cell's bottom
{
  const off = spr('brazier_off'), tiles = [];
  for (let f = 0; f < 3; f++) {
    const on = spr('brazier_on_' + f), img = new Array(256).fill(null);
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) { const c = on.rows[y][x], o = off.rows[y][x]; if (c !== o && c !== '.' && PAL[c]) img[y * 16 + x] = c; }
    tiles.push(cut(img, 16, 0, 0, 16), cut(img, 16, 1, 0, 16));
  }
  const reduced = tiles.map(t => G.reduceTile(t, 3)), pals = G.solvePalettes(reduced, 1, 3);
  kinds.flame = { name: 'flame', frames: 3, cols: 2, rows: 1, flags: 0, pals, palOf: reduced.map(() => 0), tiles: reduced.map(t => G.bestPalette(t, pals, 1).idx), ownPals: 1 };
}
// floating numbers and words: four slots of three 8x16 pieces, drawn into VRAM at runtime (effects palette)
kinds.float = { name: 'float', frames: 4, cols: 3, rows: 1, flags: 0, pals: [], palOf: new Array(12).fill(0), tiles: new Array(12).fill(null).map(() => new Array(128).fill(0)), ownPals: 0 };
buildKind('fox'); buildKind('kit');
for (const k of IT) buildKind(iKind(k));
for (const A of Object.values(AREAS)) for (const [i, ch] of [...A.map.join('')].entries()) {
  if (MONSTERS[ch]) { buildKind(mKind(ch)); if (MONSTERS[ch].summon) buildKind(mKind(MONSTERS[ch].summon)); if (MONSTERS[ch].splits) buildKind(mKind('s')); }
  else if (ch === '&') buildKind(npcKind(A.npcs[i]));
  else if (ch === '@') buildKind(blockKind(A));
}
const KIND_NAMES = Object.keys(kinds);
KIND_NAMES.forEach((k, n) => { kinds[k].id = n; });

// ---------- the game's tables: monsters, items, flags, perks, relics ----------
const MT = Object.keys(MONSTERS);            // monster types, by index
const MF = { FLIES: 1, DORMANT: 2, REVIVES: 4, SHATTER: 8, CHARGE: 16, FIREPROOF: 32, ARMORED: 64, CAMO: 128, SLEEPER: 256, EXPLODES: 512, SPLITS: 1024, BOSS: 2048, BREATH: 4096, ROOTSNARE: 8192, FINAL: 16384, LAVAWALK: 32768 };
const FLAGS = ['metGrandma', 'metHoot', 'metRudy', 'metRudyNexus', 'metLumen', 'metQueen', 'gooking', 'guardian', 'colossus', 'dragon', 'rotheart', 'primordial',
  'crystalKey', 'cloak', 'scale', 'hearth', 'ended', 'hoot5', 'hoot10', 'hoot15', 'crest', ...KITS.map(k => 'kitThanks_' + k), 'kitCharm', 'bought_heart', 'bought_claws'];
const BOSS_FLAG = { j: 'gooking', X: 'guardian', Y: 'colossus', Q: 'dragon', t: 'rotheart', A: 'primordial' };   // js/game.js
const PERK_KEYS = Object.keys(W.PERKS);
const relicIds = {}; let relicCount = 0;
for (const key of AREA_KEYS) [...AREAS[key].map.join('')].forEach((ch, i) => { if (ch === 'a') relicIds[key + ':' + i] = relicCount++; });
const monsterFlags = (ch, m) => Object.entries(MF).reduce((f, [k, bit]) => {
  const on = { FLIES: m.flies, DORMANT: m.dormant, REVIVES: m.revives, SHATTER: m.shatter, CHARGE: m.charge, FIREPROOF: m.fireproof, ARMORED: m.armored, CAMO: m.camo,
    SLEEPER: m.sleeper, EXPLODES: m.explodes, SPLITS: m.splits, BOSS: m.boss, BREATH: m.breath, ROOTSNARE: m.rootsnare, FINAL: m.final,
    LAVAWALK: m.fireproof || ch === 'M' || ch === 'O' || ch === 'Q' }[k];   // canEnter: lava for the fireproof, salamanders, lava golems and the dragon
  return on ? f | bit : f;
}, 0);

// ---------- areas: cells, doors, things in them, and where their sprites go ----------
const REQ = [null, 'gooking', 'pathfinder', 'crystalKey', 'frost_cloak', 'dragon_scale'];
const WHEN = [null, ...new Set(Object.values(AREAS).flatMap(A => Object.values(A.doors).map(d => d.when).filter(Boolean)))];
const spawnOf = A => { const i = A.map.join('').indexOf('F'); return i >= 0 ? i : 43; };
const report = [];
const MAX_ENEMIES = 16, MAX_ITEMS = 16;
for (const key of AREA_KEYS) {
  const A = AREAS[key], flat = A.map.join(''), o = areaOut[key];
  o.cells = cellInfo[key].tiles.map(c => c.charCodeAt(0));
  o.doors = Object.entries(A.doors).map(([i, d]) => {
    if (d.req && !REQ.includes(d.req)) problems.push(`${key}: door ${i} needs unknown ${d.req}`);
    return { cell: +i, to: AREA_KEYS.indexOf(d.to), spawn: d.spawn !== undefined ? d.spawn : spawnOf(AREAS[d.to]), req: Math.max(0, REQ.indexOf(d.req || null)), when: Math.max(0, WHEN.indexOf(d.when || null)), name: d.name || '' };
  });
  o.enemies = []; o.npcs = []; o.items = []; o.blocks = [];
  const used = ['fox', 'marker', 'float'];
  const use = k => { if (!used.includes(k)) used.push(k); return used.indexOf(k); };
  [...flat].forEach((ch, i) => {
    const m = MONSTERS[ch];
    if (m) {
      use(mKind(ch)); o.enemies.push({ type: MT.indexOf(ch), cell: i });
      if (m.summon) use(mKind(m.summon));
      if (m.splits) use(mKind('s'));
      for (const d of m.drop || []) use(iKind(d));
    } else if (ITEMS[ch]) { use(iKind(ch)); o.items.push({ code: itemCode(ch), cell: i, relic: ch === 'a' ? relicIds[key + ':' + i] : 0 }); }
    else if (ch === '&') { const id = A.npcs[i]; o.npcs.push({ id: NPC_IDS.indexOf(id), kind: use(npcKind(id)), cell: i }); }
    else if (ch === '@') o.blocks.push(i);
  });
  o.blockAk = o.blocks.length ? use(blockKind(A)) : 0xFF;
  o.flameAk = flat.includes('*') || (A.landmarks || []).some(m => m.flame) ? use('flame') : 0xFF;   // braziers, the Hearth
  if (o.blocks.length > 4) problems.push(`${key}: ${o.blocks.length} blocks (4 at most)`);
  if ([...flat].filter(ch => ch === '*').length > 6) problems.push(`${key}: more than 6 braziers`);
  // fish drop from ordinary kills (not in areas with pressure plates: js/game.js killEnemy)
  if (o.enemies.some(e => !MONSTERS[MT[e.type]].boss) && !flat.includes('+')) use(iKind('f'));
  if (key === 'home') use('kit');   // rescued kits come home
  if (o.enemies.length > MAX_ENEMIES - 3) problems.push(`${key}: ${o.enemies.length} enemies leave no room for summons`);
  if (o.items.length > MAX_ITEMS - 4) problems.push(`${key}: ${o.items.length} items leave no room for drops`);
  // sprite VRAM and palettes: fox, marker and floats first in bank 0, then every kind this area can show
  let bank = 0, next = 0, slot = 2; const itemSlot = { [EFFECTS_ITEM_PAL]: 1 };
  o.kinds = used.map(k => {
    const K = kinds[k], n = K.tiles.length * 2;
    if (next + n > OBJ_TILES) { bank++; next = 0; }
    if (bank > 1) problems.push(`${key}: sprite tiles do not fit in VRAM`);
    let pal;
    if (k === 'fox' || K.share === 'fox') pal = 0;
    else if (k === 'marker' || k === 'float') pal = 1;
    else if (K.itemPal !== null && K.itemPal !== undefined) { if (!(K.itemPal in itemSlot)) itemSlot[K.itemPal] = slot++; pal = itemSlot[K.itemPal]; }
    else { pal = slot; slot += K.ownPals; }
    const at = { kind: K.id, bank, tile: next, pal };
    next += n; o.objTiles = bank * OBJ_TILES + next;
    return at;
  });
  if (slot > 8) problems.push(`${key}: needs ${slot} sprite palettes (8 on the GBC)`);
  const pal = [];
  const put = (s, cols) => { for (let c = 0; c < 4; c++) pal[s * 4 + c] = c && cols[c - 1] ? G.to555(cols[c - 1]) : 0; };
  for (let s = 0; s < 8; s++) put(s, []);
  put(0, kinds.fox.pals[0]); put(1, EFFECTS_PAL);
  o.kinds.forEach((at, n) => { const K = kinds[used[n]]; if (at.pal >= 2) K.pals.forEach((p, j) => put(at.pal + j, p)); });
  o.objPal = pal;
  o.typeAk = MT.map(ch => (used.includes(mKind(ch)) ? used.indexOf(mKind(ch)) : 0xFF));
  o.itemAk = IT.map(k => (used.includes(iKind(k)) ? used.indexOf(iKind(k)) : 0xFF));
  o.flags = (flat.includes('+') ? 1 : 0) | (A.slide ? 2 : 0) | (A.reform ? 4 : 0);
  o.signs = Object.entries(A.signs || {}).map(([i, t]) => ({ cell: +i, text: t }));
  o.kitAk = key === 'home' ? used.indexOf('kit') : 0xFF;   // rescued kits stand at home (js placeKits)
  // pressure: sprites on one row (plus Fang), sprites in all
  let rowObjs = 0, objs = kinds.fox.cols * kinds.fox.rows;
  const things = o.enemies.map(e => ({ cell: e.cell, K: kinds[mKind(MT[e.type])] })).concat(o.npcs.map(n => ({ cell: n.cell, K: kinds[used[n.kind]] })), o.items.map(t => ({ cell: t.cell, K: kinds[iKind(IT[t.code - 1])] })), o.blocks.map(c => ({ cell: c, K: kinds[blockKind(A)] })), [...flat].map((ch, i) => (ch === '*' ? { cell: i, K: kinds.flame } : null)).filter(Boolean), (A.landmarks || []).filter(m => m.flame).flatMap(m => [0, 1].map(k => ({ cell: m.cell - COLS + k, K: kinds.flame }))));
  for (let y = 0; y < ROWS; y++) { let n = 0; for (const t of things) if (((t.cell / COLS) | 0) === y) n += t.K.cols; rowObjs = Math.max(rowObjs, n); }
  for (const t of things) objs += t.K.cols * t.K.rows;
  report.push({ key, biome: A.biome, rowObjs, objs, pals: slot, objTiles: o.objTiles, biomeTiles: biomeOut[A.biome].order.length, metas: o.meta.length / 8, err: (100 * biomeOut[A.biome].errPx / biomeOut[A.biome].px).toFixed(1) });
}

// ---------- the HUD: icons, bar pieces, the font, and the area overview (SELECT) ----------
const HUD_PAL = ['1', 'R', '4', '6'], TEXT_PAL = ['1', '6', '4', 'y'];   // BG palettes 6 (icons, bar) and 7 (text)
const OVERVIEW_PAL = ['0', 'K', 'l', '4'];                                // BG palette 5: void, floor, solid, water
const icon = name => cut((() => { const img = new Array(64).fill('1'); blit(img, 8, 8, name, 0, 0); return img.map(k => (k === '0' ? '1' : k)); })(), 8, 0, 0).map(k => HUD_PAL.indexOf(G.nearest(k, HUD_PAL)));
const barTile = fill => { const t = new Array(64).fill(0); for (let y = 2; y < 6; y++) for (let x = 0; x < 8; x++) t[y * 8 + x] = x < fill ? 1 : 2; return t; };
const UI_TILES = [new Array(64).fill(0), icon('ico_heart'), icon('ico_sword'), icon('ico_fish'), icon('ico_gem')];
for (let f = 0; f <= 8; f++) UI_TILES.push(barTile(f));
// overview tiles, one 8x8 tile per cell: palette 5 for ground, 6 (red) for foes and lava, 7 for Fang, friends, items, doors
const box = (fill, edge, dot = null, dotCol = 0) => { const t = []; for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) { const e = x === 7 || y === 7; let v = e ? edge : fill; if (dot && dot(x, y)) v = dotCol; t.push(v); } return t; };
const round = (r) => (x, y) => (x - 3) * (x - 3) + (y - 3) * (y - 3) <= r * r;
const OVERVIEW_TILES = [
  box(0, 0),                                   // 0 void / outside   (p5)
  box(1, 0),                                   // 1 floor            (p5)
  box(2, 0),                                   // 2 solid            (p5)
  box(3, 0),                                   // 3 water            (p5)
  box(1, 0, round(2.2), 1),                    // 4 lava: red square (p6, colour 1)
  box(0, 0, (x, y) => x < 7 && y < 7 && (x === 0 || y === 0 || x === 6 || y === 6), 3),   // 5 door: yellow frame (p7)
  box(0, 0, round(2.6), 3),                    // 6 Fang: yellow dot (p7)
  box(0, 0, round(2.2), 1),                    // 7 foe: red dot (p6)
  box(0, 0, round(3.2), 1),                    // 8 boss: big red dot (p6)
  box(0, 0, round(2.2), 1),                    // 9 friend: white dot (p7)
  box(0, 0, (x, y) => Math.abs(x - 3) + Math.abs(y - 3) <= 1, 3),   // 10 item: small yellow diamond (p7)
];
// the dialogue box and menus (window layer): a frame and the "more" arrow, after the overview tiles
const frameTile = (top, bottom, left, right) => { const t = new Array(64).fill(0); for (let i = 0; i < 8; i++) { if (top) t[3 * 8 + i] = 2; if (bottom) t[4 * 8 + i] = 2; if (left) t[i * 8 + 3] = 2; if (right) t[i * 8 + 4] = 2; }
  if (top || bottom) for (let i = 0; i < 8; i++) { if (left && i < 3) t[(top ? 3 : 4) * 8 + i] = 0; if (right && i > 4) t[(top ? 3 : 4) * 8 + i] = 0; }
  if (left || right) for (let i = 0; i < 8; i++) { if (top && i < 4) t[i * 8 + (left ? 3 : 4)] = 0; if (bottom && i > 3) t[i * 8 + (left ? 3 : 4)] = 0; }
  return t; };
const DLG_TILES = [frameTile(1, 0, 1, 0), frameTile(1, 0, 0, 0), frameTile(1, 0, 0, 1), frameTile(0, 0, 1, 0), frameTile(0, 0, 0, 1), frameTile(0, 1, 1, 0), frameTile(0, 1, 0, 0), frameTile(0, 1, 0, 1),
  (() => { const t = new Array(64).fill(0); [[2, 2, 6], [3, 3, 5], [4, 4, 4]].forEach(([y, a, b]) => { for (let x = a; x <= b; x++) t[y * 8 + x] = 3; }); return t; })()];   // TL T TR L R BL B BR, arrow
// portraits: each speaker's sprite in a 32x32 box (16 px sprites doubled, their top half when taller),
// two palettes of 3 colours over the box's background (BG palettes 5 and 6 while someone talks)
const SPEAKER_IDS = Object.keys(SPEAKERS);
const portraitOf = {}, portraits = [];
for (const id of SPEAKER_IDS) {
  const name = SPEAKERS[id].spr; if (!name) { portraitOf[id] = 0xFF; continue; }
  const have = portraits.findIndex(p => p.spr === name); if (have >= 0) { portraitOf[id] = have; continue; }
  const s = spr(name), img = new Array(1024).fill(null), sc = s.w <= 16 ? 2 : 1;
  const h = Math.min(s.h, 32 / sc), dx = Math.round(16 - s.w * sc / 2), dy = 32 - h * sc;
  for (let y = 0; y < h; y++) for (let x = 0; x < s.w; x++) { const c = s.rows[y][x]; if (c === '.' || !PAL[c]) continue; for (let a = 0; a < sc; a++) for (let b = 0; b < sc; b++) { const X = dx + x * sc + b, Y = dy + y * sc + a; if (X >= 0 && X < 32 && Y >= 0 && Y < 32) img[Y * 32 + X] = c; } }
  const tiles = []; for (let ty = 0; ty < 4; ty++) for (let tx = 0; tx < 4; tx++) tiles.push(G.reduceTile(cut(img, 32, tx, ty), 3));
  const pals = G.solvePalettes(tiles, 2, 3), palOf = [], idx = [];
  for (const t of tiles) { const b = G.bestPalette(t, pals, 1); palOf.push(b.pal); idx.push(b.idx); }
  portraitOf[id] = portraits.length; portraits.push({ spr: name, pals, palOf, idx });
}
const glyphs = [];
for (let c = 32; c < 96; c++) { const g = FONT[String.fromCharCode(c)] || FONT['?']; const rows = [0, 0, 0, 0, 0]; for (let k = 0; k < g.px.length; k += 2) rows[g.px[k + 1]] |= 0x80 >> g.px[k]; glyphs.push([g.w, ...rows]); }

// ---------- sound effects: GB channel notes from music/sfx.js ----------
const SFX = require(path.join(GBC, 'music', 'sfx.js')), SFX_NAMES = Object.keys(SFX);
const ms2f = ms => Math.max(1, Math.round(ms * 60 / 1000));
const period = hz => Math.max(0, Math.min(2047, Math.round(2048 - 131072 / hz)));
const sfxNotes = SFX_NAMES.map(n => {
  const notes = [];
  for (const [at, dur, f0, f1, vol, duty] of SFX[n].tone || []) {
    const frames = ms2f(dur), pace = Math.max(1, Math.min(7, Math.round(dur / 1000 * 64 / vol)));
    notes.push({ at: ms2f(at) - (at ? 0 : 1), ch: 2, frames, p0: period(f0), p1: f1 ? period(f1) : period(f0), env: (vol << 4) | pace, arg: duty << 6 });
  }
  for (const [at, dur, bright, vol] of SFX[n].noise || []) {
    const frames = ms2f(dur), pace = Math.max(1, Math.min(7, Math.round(dur / 1000 * 64 / vol)));
    notes.push({ at: ms2f(at) - (at ? 0 : 1), ch: 4, frames, p0: 0, p1: 0, env: (vol << 4) | pace, arg: ((7 - bright) << 4) | 1 });   // NR43: clock shift, divisor 1
  }
  return notes.sort((a, b) => a.at - b.at);
});

// ---------- C output ----------
fs.mkdirSync(OUT, { recursive: true });
const written = new Set();   // only files whose content changed are rewritten, so make recompiles just those
const emit = (f, text) => { written.add(f); const file = path.join(OUT, f); if (!fs.existsSync(file) || fs.readFileSync(file, 'utf8') !== text) fs.writeFileSync(file, text); };
const hex = (arr, per = 16) => arr.map(v => '0x' + v.toString(16).padStart(2, '0')).reduce((lines, v, i) => { if (i % per === 0) lines.push([]); lines[lines.length - 1].push(v); return lines; }, []).map(l => '  ' + l.join(', ')).join(',\n');
const hex16 = arr => '  ' + arr.map(v => '0x' + v.toString(16).padStart(4, '0')).join(', ');
const cstr = s => '"' + s.toUpperCase().replace(/[\\"]/g, '\\$&') + '"';
const HEAD = '// Generated by gbc/tools/build.js from the web game. Do not edit.\n';
const write = (f, s) => emit(f, HEAD + s);
const defs = (prefix, names) => names.map((n, i) => `#define ${prefix}${n.replace(/[^a-z0-9]/gi, '_').toUpperCase()} ${i}\n`).join('');

for (const [b, o] of Object.entries(biomeOut)) {
  const pal = []; for (let p = 0; p < TERRAIN_PALS; p++) for (let c = 0; c < 4; c++) pal.push(o.pals[p] && o.pals[p][c] ? terrain555(o.pals[p][c], b) : 0);
  // animated runs: all three frames of the run's tiles, one frame after the other
  let off = 0; const anim = [], segs = o.segments.map(sg => { const at = off; for (let f = 0; f < 3; f++) for (const u of sg.tiles) anim.push(...G.enc2bpp(u.idx[f])); off += sg.tiles.length * 48; return `{ ${sg.anim}, ${sg.tiles.length}, ${sg.first}, ${at} }`; });
  write(`biome_${b}.c`, `#pragma bank 255\n#include <gb/gb.h>\n#include "world.h"\n\nBANKREF(biome_${b})\n` +
    `static const uint8_t tiles[] = {\n${hex(o.order.flatMap(u => G.enc2bpp(u.idx[0])))}\n};\nstatic const palette_color_t pal[] = {\n${hex16(pal)}\n};\n` +
    `static const anim_seg_t segs[] = { ${segs.join(', ') || '{ 0 }'} };\nstatic const uint8_t anim[] = {\n${hex(anim.length ? anim : [0])}\n};\n` +
    `const biome_t biome_${b} = { ${o.order.length}, tiles, pal, ${segs.length}, segs, anim };\n`);
}
portraits.forEach((P, n) => {
  const pal = []; for (const p of P.pals.concat([[], []]).slice(0, 2)) for (let c = 0; c < 4; c++) pal.push(G.to555(c ? p[c - 1] || '1' : '1'));   // colour 0: the box
  write(`portrait_${n}.c`, `#pragma bank 255\n#include <gb/gb.h>\n#include "world.h"\n\nBANKREF(portrait_${n})\n// ${P.spr}\n` +
    `static const uint8_t tiles[] = {\n${hex(P.idx.flatMap(G.enc2bpp))}\n};\nstatic const uint8_t pal_of[] = { ${P.palOf.join(', ')} };\n` +
    `static const palette_color_t pal[] = {\n${hex16(pal)}\n};\nconst portrait_t portrait_${n} = { tiles, pal_of, pal };\n`);
});
// the pause screen's world map (pause.c includes this): each island's tile, the dotted paths between
// them, a colour per biome (view.js BIOME_MAP_COLOR, three to each of 4 palettes), the icons
{
  const MAPCOL = vm.runInNewContext('(' + fs.readFileSync(path.join(ROOT, 'js', 'view.js'), 'utf8').match(/const BIOME_MAP_COLOR = (\{[^}]*\})/)[1] + ')');
  const hexKey = {}; for (const [k, v] of Object.entries(PAL)) hexKey[v.toLowerCase()] = k;
  const rgb = h => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16));
  const COLOURS = [...new Set(Object.values(MAPCOL))];   // 12: three to a palette, over the panel's colour
  if (COLOURS.length > 12) problems.push(`the world map has ${COLOURS.length} island colours (12 at most)`);
  const groupOf = c => COLOURS.indexOf(c);   // palette = n / 3, colour = n % 3 + 1
  const xs = AREA_KEYS.map(k => AREAS[k].pos[0]), ys = AREA_KEYS.map(k => AREAS[k].pos[1]);
  const mx = k => Math.round((AREAS[k].pos[0] - Math.min(...xs)) / (Math.max(...xs) - Math.min(...xs)) * 16) + 1;
  const my = k => Math.round((AREAS[k].pos[1] - Math.min(...ys)) / (Math.max(...ys) - Math.min(...ys)) * 12) + 2;
  const island = new Set(AREA_KEYS.flatMap(k => [my(k) * 20 + mx(k), my(k) * 20 + mx(k) + 1]));
  const edges = [], dots = [], seen = new Set();
  for (const k of AREA_KEYS) for (const d of Object.values(AREAS[k].doors)) {
    const key = [k, d.to].sort().join(); if (seen.has(key)) continue; seen.add(key);
    const x0 = mx(k) + 0.5, y0 = my(k), x1 = mx(d.to) + 0.5, y1 = my(d.to), n = Math.ceil(Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0)) * 2), cells = [];
    for (let s = 1; s < n; s++) { const c = Math.round(y0 + (y1 - y0) * s / n) * 20 + Math.round(x0 + (x1 - x0) * s / n); if (!island.has(c) && !cells.includes(c)) cells.push(c); }
    edges.push(`{ ${AREA_KEYS.indexOf(k)}, ${AREA_KEYS.indexOf(d.to)}, ${d.when ? FLAGS.indexOf(d.when) : 0xFF}, ${cells.length}, ${dots.length} }`);
    dots.push(...cells);
  }
  if (dots.length > 255) problems.push(`the world map has ${dots.length} path dots (255 at most)`);
  const pal = []; for (let p = 0; p < 4; p++) pal.push(G.to555('1'), ...[0, 1, 2].map(v => { const c = COLOURS[p * 3 + v]; if (!c) return 0; const [r, gg, b] = rgb(c); return (r >> 3) | ((gg >> 3) << 5) | ((b >> 3) << 10); }));
  pal.push(G.to555('1'), G.to555('R'), G.to555('y'), G.to555('6'));   // markers: a boss alive, beaten, you are here
  const IS = ['................', '..CCCCCCCCCCCC..', '.CCCCCCCCCCCCCC.', '.CCCCCCCCCCCCCC.', '..CCCCCCCCCCCC..', '...CCCCCCCCCC...', '.....CCCCCC.....', '.......CC.......'];
  const half = (h, v) => { const t = []; for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) t.push(IS[y][h * 8 + x] === 'C' ? v : 0); return t; };
  const blob = (pts, v) => { const t = new Array(64).fill(0); for (const [x, y] of pts) t[y * 8 + x] = v; return t; };
  const qmark = (() => { const g = FONT['?'], t = new Array(64).fill(0); for (let k = 0; k < g.px.length; k += 2) t[(g.px[k + 1] + 1) * 8 + g.px[k] + 2] = 2; return t; })();
  const boss = v => blob([[3, 5], [4, 5], [2, 6], [3, 6], [4, 6], [5, 6], [3, 7], [4, 7]], v);
  const here = blob([[1, 3], [2, 3], [3, 3], [4, 3], [5, 3], [6, 3], [2, 4], [3, 4], [4, 4], [5, 4], [3, 5], [4, 5]], 2);
  const MAP_TILES = [half(0, 1), half(1, 1), half(0, 2), half(1, 2), half(0, 3), half(1, 3), blob([[3, 3], [4, 3], [3, 4], [4, 4]], 2), qmark, boss(1), boss(2), here];
  write('mapdata.inc', `// the world map (pause.c): tile x, y and colour of each island (n: palette n / 3, colour n % 3 + 1; 0x80: a boss's),\n// the flag that beats its boss, the paths (dots, each at map_dot_x, map_dot_y), 4 island palettes and a marker palette, the icons\n` +
    `static const uint8_t map_x[AREA_COUNT] = { ${AREA_KEYS.map(mx).join(', ')} };\nstatic const uint8_t map_y[AREA_COUNT] = { ${AREA_KEYS.map(my).join(', ')} };\n` +
    `static const uint8_t map_look[AREA_COUNT] = { ${AREA_KEYS.map(k => groupOf(MAPCOL[AREAS[k].biome]) | (AREAS[k].boss ? 0x80 : 0)).join(', ')} };\n` +
    `static const uint8_t map_boss_flag[AREA_COUNT] = { ${AREA_KEYS.map(k => { const t = Object.keys(BOSS_FLAG).find(b => AREAS[k].map.join('').includes(b)); return t ? FLAGS.indexOf(BOSS_FLAG[t]) : 0xFF; }).join(', ')} };\n` +
    `static const char * const map_region[AREA_COUNT] = { ${AREA_KEYS.map(k => JSON.stringify(AREAS[k].region || '')).join(', ')} };\n` +
    `typedef struct { uint8_t a, b, when, n, first; } map_edge_t;\nstatic const map_edge_t map_edges[] = {\n  ${edges.join(',\n  ')}\n};\n#define MAP_EDGES ${edges.length}\n` +
    `static const uint8_t map_dot_x[] = {\n${hex(dots.map(c => c % 20), 20)}\n};\nstatic const uint8_t map_dot_y[] = {\n${hex(dots.map(c => (c / 20) | 0), 20)}\n};\nstatic const palette_color_t map_pal[20] = {\n${hex16(pal)}\n};\n` +
    `static const uint8_t map_tiles[] = {\n${hex(MAP_TILES.flatMap(G.enc2bpp))}\n};\n#define MAP_TILES ${MAP_TILES.length}\n`);
}
// the credits (js/story.js CREDITS): each line's text and colour (1 white, 2 blue, 3 yellow for titles)
write('credits.inc', `static const char * const credit_text[] = { ${CREDITS.map(([t]) => JSON.stringify(t)).join(', ')} };\n` +
  `static const uint8_t credit_colour[] = { ${CREDITS.map(([t, c, sc]) => (sc > 1 || c === '#e8622a' || c === '#ffd35c' ? 3 : c === '#eef4ff' ? 1 : 2)).join(', ')} };\n#define CREDIT_LINES ${CREDITS.length}\n`);
// the menus' words (dialog.c includes this): speakers, perks, Rudy's wares
write('ui.inc', `static const char * const speaker_name[SPEAKER_COUNT] = { ${SPEAKER_IDS.map(id => cstr(SPEAKERS[id].name)).join(', ')} };\n` +
  `static const char * const ui_perk_name[PERK_COUNT] = { ${PERK_KEYS.map(k => cstr(W.PERKS[k].name)).join(', ')} };\n` +
  `static const char * const perk_desc[PERK_COUNT] = {\n${PERK_KEYS.map(k => '  ' + cstr(W.PERKS[k].desc)).join(',\n')}\n};\n` +
  `static const char * const perk_tree[PERK_COUNT] = { ${PERK_KEYS.map(k => cstr(W.PERKS[k].tree)).join(', ')} };\n`);
write('shop.inc', `// Rudy's wares (js/data.js SHOP): included by dialog.c and story.c\nstatic const shop_t shop[SHOP_COUNT] = {\n${SHOP.map(s => `  { ${s.cost}, ${s.once ? 1 : 0}, ${JSON.stringify(s.name)}, ${JSON.stringify(s.desc)} }`).join(',\n')}\n};\n`);
for (const K of Object.values(kinds)) {
  write(`kind_${K.name}.c`, `#pragma bank 255\n#include <gb/gb.h>\n#include "world.h"\n\nBANKREF(kind_${K.name})\n` +
    `static const uint8_t tiles[] = {\n${hex(K.tiles.flatMap(G.enc2bpp))}\n};\nstatic const uint8_t pal_of[] = { ${K.palOf.join(', ')} };\n` +
    `const kind_t kind_${K.name} = { ${K.cols}, ${K.rows}, ${K.frames}, ${K.flags}, ${K.tiles.length * 2}, tiles, pal_of };\n`);
}
AREA_KEYS.forEach(k => {
  const o = areaOut[k], A = AREAS[k], c = cName(k);
  const list = (name, type, rows, fmt) => `static const ${type} ${name}[] = {\n${rows.map(fmt).join(',\n') || '  { 0 }'}\n};\n`;
  write(`area_${c}.c`, `#pragma bank 255\n#include <gb/gb.h>\n#include "world.h"\n\nBANKREF(area_${c})\n` +
    `static const uint8_t cells[] = {\n${hex(o.cells, 14)}\n};\n` +
    `static const cell_rec_t cell_recs[] = {\n${o.cellRecs.map(r => '  { ' + r + ' }').join(',\n')}\n};\n` +
    `static const uint8_t metas[] = {\n${hex(o.meta, 8)}\n};\nstatic const uint8_t dyn[] = { ${o.dyn.join(', ') || 0} };\nstatic const uint8_t cond[] = { ${o.cond.join(', ') || 0} };\nstatic const uint8_t blocks[] = { ${o.blocks.join(', ') || 0} };\n` +
    list('doors', 'door_t', o.doors, d => `  { ${d.cell}, ${d.to}, ${d.spawn}, ${d.req}, ${d.when}, ${cstr(d.name)} }`) +
    list('enemies', 'thing_t', o.enemies, e => `  { ${e.type}, ${e.cell}, 0 }`) +
    list('npcs', 'thing_t', o.npcs, n => `  { ${n.id}, ${n.cell}, ${n.kind} }`) +
    list('items', 'thing_t', o.items, t => `  { ${t.code}, ${t.cell}, ${t.relic} }`) +
    list('signs', 'sign_t', o.signs, g => `  { ${g.cell}, ${JSON.stringify(g.text)} }`) +
    list('kinds', 'area_kind_t', o.kinds, a => `  { ${a.kind}, ${a.bank}, ${a.tile}, ${a.pal} }`) +
    `static const uint8_t type_ak[] = { ${o.typeAk.join(', ')} };\nstatic const uint8_t item_ak[] = { ${o.itemAk.join(', ')} };\n` +
    `static const palette_color_t obj_pal[] = {\n${hex16(o.objPal)}\n};\n` +
    `const area_t area_${c} = { ${BIOME_KEYS.indexOf(A.biome)}, ${songOf(A.music)}, ${spawnOf(A)}, ${o.flags}, ${A.brazierTime || 0}, ${A.reform || 0}, ${(A.crumbleTo || '~').charCodeAt(0)}, cells, cell_recs, metas,\n` +
    `  ${o.dyn.length}, dyn, ${o.cond.length}, cond, ${o.blocks.length}, blocks, ${o.blockAk}, ${o.flameAk}, ${o.doors.length}, doors, ${o.enemies.length}, enemies, ${o.npcs.length}, npcs, ${o.items.length}, items, ${o.signs.length}, signs, ${o.kitAk}, ${o.kinds.length}, kinds, type_ak, item_ak, obj_pal, ${cstr(A.title)} };\n`);
});
for (const s of songs) emit(`song_${s}.c`, SONG.compile(s, require(path.join(GBC, 'music', s + '.js'))));
const chFlags = new Array(128).fill(0);
for (let c = 32; c < 128; c++) { const ch = String.fromCharCode(c), T = TERRAIN[ch]; if (ch === '#' || ch === '~' || (T && T.solid)) chFlags[c] |= 1; if (ch === '~') chFlags[c] |= 2; if (ch === 'd' || ch === 'D') chFlags[c] |= 4; if (ch === 'w') chFlags[c] |= 8; }
const usedBiomes = BIOME_KEYS.filter(b => biomeOut[b]);
const hearth = (() => { for (const [a, k] of AREA_KEYS.entries()) { const m = (AREAS[k].landmarks || []).find(l => l.flame); if (m) return [a, m.cell - COLS]; } return [255, 255]; })();
// cells.c's fast path: the look of a tile that always looks the same (0xFF: it depends on the game's
// state), and the looks whose picture reaches into the cell above (a change there redraws that cell too)
const CONDITIONAL = '+vodD';
const lookOf = new Array(128).fill(L.FLOOR);
for (let c = 33; c < 128; c++) { const ch = String.fromCharCode(c); lookOf[c] = CONDITIONAL.includes(ch) ? 0xFF : charLooks({ doors: {} }, ch, 0)[0]; }
const lookTall = LOOKS.map((_, l) => (l === L.DOOR || l === L.CAMO || [0, 1, 2].some(f => { const a = lookArt({ doors: {}, biome: 'woods' }, 0, l, f); return a.tall && spr(a.tall).h > 16; }) || l === L.TREE ? 1 : 0));
// the game's own tables, compiled into logic.c (#include) so they share its ROM bank
write('tables.inc', `// monsters by type, items by code (1-based), perk names\n` +
  `static const monster_t monsters[TYPE_COUNT] = {\n${MT.map(ch => { const m = MONSTERS[ch]; const drop = (m.drop || []).map(itemCode);
    return `  { ${m.hp}, ${m.xp}, ${monsterFlags(ch, m)}, ${m.atk}, ${m.interval || 0}, ${m.steps || 1}, ${m.poison || 0}, ${m.healer || 0}, ${m.summon ? MT.indexOf(m.summon) : 0xFF}, ${m.spawnEvery || 0}, ${m.trail ? m.trail.charCodeAt(0) : 0}, ${m.phases || 0}, ${BOSS_FLAG[ch] ? FLAGS.indexOf(BOSS_FLAG[ch]) : 0xFF}, { ${drop[0] || 0}, ${drop[1] || 0} }, ${cstr(m.name)} }`; }).join(',\n')}\n};\n` +
  `static const item_t item_info[ITEM_COUNT + 1] = {\n  { 0, "" },\n${IT.map(k => `  { ${ITEMS[k].ember ? 1 : 0}, ${cstr(ITEMS[k].name)} }`).join(',\n')}\n};\n` +
  `static const char * const perk_names[PERK_COUNT] = { ${PERK_KEYS.map(k => cstr(W.PERKS[k].name)).join(', ')} };\n` +
  `static const uint8_t item_char[ITEM_COUNT + 1] = { 0, ${IT.map(k => (k.length === 1 ? k.charCodeAt(0) : 0)).join(', ')} };\n`);
write('sfx_data.c', `#include <gb/gb.h>\n#include "world.h"\n\n` +
  sfxNotes.map((notes, i) => `static const sfx_note_t sfx_${i}[] = {\n${notes.map(n => `  { ${n.at}, ${n.ch}, ${n.frames}, ${n.env}, ${n.arg}, ${n.p0}, ${n.p1} }`).join(',\n')}\n};`).join('\n') + '\n' +
  `const sfx_t sfx_table[SFX_COUNT] = { ${sfxNotes.map((notes, i) => `{ ${notes.length}, ${notes.reduce((a, n) => Math.max(a, n.at + n.frames), 0)}, sfx_${i} }`).join(', ')} };\n`);
write('world.h', `#ifndef FANG_WORLD_H\n#define FANG_WORLD_H\n#include <stdint.h>\n#include <gb/gb.h>\n#include <gb/cgb.h>\n\n` +
  `#define AREA_COUNT ${AREA_KEYS.length}\n#define KIND_COUNT ${KIND_NAMES.length}\n#define TYPE_COUNT ${MT.length}\n#define ITEM_COUNT ${IT.length}\n#define PERK_COUNT ${PERK_KEYS.length}\n#define FLAG_COUNT ${FLAGS.length}\n#define RELIC_COUNT ${relicCount}\n` +
  `#define SFX_COUNT ${SFX_NAMES.length}\n#define SONG_COUNT ${songs.length}\n#define MUSIC_TITLE ${songOf('title')}\n#define MUSIC_WIN ${songOf('win')}   // falling, the credits\n#define HEARTH_AREA ${hearth[0]}\n#define HEARTH_CELL ${hearth[1]}   // the Hearth's two flames stand in this cell and the next once the story lights it (the cells its art hangs into)\n#define MAX_ENEMIES ${MAX_ENEMIES}\n#define MAX_ITEMS ${MAX_ITEMS}\n` +
  `#define COLS ${COLS}\n#define ROWS ${ROWS}\n#define CELLS ${COLS * ROWS}\n#define AREA_W 28   // tiles\n#define AREA_H 16\n` +
  `#define UI_TILES ${UI_TILES.length}\n#define OVERVIEW_TILES ${OVERVIEW_TILES.length}\n#define DLG_TILES ${DLG_TILES.length}\n#define KIND_FOX ${kinds.fox.id}\n` +
  `#define SPEAKER_COUNT ${SPEAKER_IDS.length}\n#define PORTRAIT_COUNT ${portraits.length}\n#define SHOP_COUNT ${SHOP.length}\n` + defs('SP_', SPEAKER_IDS) + defs('SHOP_', SHOP.map(s => s.id)) + defs('AR_', AREA_KEYS) +
  `static const uint8_t kit_spot[5] = { ${AREAS.home.kitSpots.join(', ')} };   // where rescued kits stand at home\n` +
  Object.entries(KF).map(([k, v]) => `#define KF_${k} ${v}\n`).join('') + Object.entries(MF).map(([k, v]) => `#define MF_${k} ${v}u\n`).join('') +
  `#define CF_SOLID 1\n#define CF_VOID 2\n#define CF_DOOR 4\n#define CF_WATER 8\n#define AF_PLATES 1\n#define AF_SLIDE 2\n#define AF_REFORM 4\n` +
  defs('LK_', LOOKS) + `#define MAX_CELL_LOOKS ${MAX_CELL_LOOKS}\n#define ANIMATORS ${ANIM_NAMES.length}\nstatic const uint8_t anim_frames[ANIMATORS] = { ${ANIM_FRAMES.join(', ')} };   // frames per animation step\n` +
  REQ.slice(1).map((r, i) => `#define REQ_${r.toUpperCase()} ${i + 1}\n`).join('') + WHEN.slice(1).map((r, i) => `#define WHEN_${r.toUpperCase()} ${i + 1}\n`).join('') +
  `static const uint8_t when_flag[] = { 0xFF, ${WHEN.slice(1).map(w => FLAGS.indexOf(w)).join(', ')} };\n` +
  defs('F_', FLAGS) + defs('P_', PERK_KEYS) + defs('SFX_', SFX_NAMES) + defs('NPC_', NPC_IDS) +
  IT.map((k, i) => `#define IT_${ITEMS[k].spr.toUpperCase()} ${i + 1}\n`).join('') + MT.map((ch, i) => `#define MT_${MONSTERS[ch].spr.toUpperCase()} ${i}\n`).join('') +
  `\ntypedef struct { uint8_t anim, count; uint16_t first, offset; } anim_seg_t;   // a run of animated tiles: its 3 frames at anim + offset\n` +
  `typedef struct { uint16_t tiles_n; const uint8_t *tiles; const palette_color_t *pal; uint8_t seg_n; const anim_seg_t *segs; const uint8_t *anim; } biome_t;   // pal: ${TERRAIN_PALS} palettes x 4\n` +
  `typedef struct { uint16_t meta; uint8_t n, look[MAX_CELL_LOOKS]; } cell_rec_t;   // a cell's looks; metatile meta + look * (looks below) + look below\n` +
  `typedef struct { uint8_t cols, rows, frames, flags, tiles_n; const uint8_t *tiles; const uint8_t *pal_of; } kind_t;   // pal_of: palette (0/1) of each 8x16 piece\n` +
  `typedef struct { uint8_t cell, to, spawn, req, when; const char *name; } door_t;\n` +
  `typedef struct { uint8_t what, cell, extra; } thing_t;              // enemy: type; npc: id, area kind; item: code, relic id\n` +
  `typedef struct { uint8_t kind, bank, tile, pal; } area_kind_t;    // where this kind's sprite tiles and palettes go\n` +
  `typedef struct { uint8_t cell; const char *text; } sign_t;\n` +
  `typedef struct { uint8_t cost, once; const char *name, *desc; } shop_t;\n` +
  `typedef struct { const uint8_t *tiles, *pal_of; const palette_color_t *pal; } portrait_t;   // 16 tiles, the palette (0/1) of each, 2 palettes x 4\n` +
  `typedef struct { uint8_t biome, music, spawn, flags, brazier_time, reform, crumble_to; const uint8_t *cells; const cell_rec_t *cell_recs; const uint8_t *metas;\n` +
  `                 uint8_t dyn_n; const uint8_t *dyn; uint8_t cond_n; const uint8_t *cond; uint8_t block_n; const uint8_t *blocks; uint8_t block_ak, flame_ak;   // metas: 4 tiles then 4 attributes each; dyn: cells with more than one look; cond: the ones that change without their tile changing\n` +
  `                 uint8_t door_n; const door_t *doors; uint8_t enemy_n; const thing_t *enemies; uint8_t npc_n; const thing_t *npcs; uint8_t item_n; const thing_t *items;\n` +
  `                 uint8_t sign_n; const sign_t *signs; uint8_t kit_ak;   // kit_ak: home's kind for rescued kits\n` +
  `                 uint8_t kind_n; const area_kind_t *kinds; const uint8_t *type_ak, *item_ak; const palette_color_t *obj_pal; const char *title; } area_t;\n` +
  `typedef struct { uint16_t hp, xp, flags; uint8_t atk, interval, steps, poison, healer, summon, spawn_every, trail, phases, boss_flag, drop[2]; const char *name; } monster_t;\n` +
  `typedef struct { uint8_t ember; const char *name; } item_t;\n` +
  `typedef struct { uint8_t at, ch, frames, env, arg; uint16_t p0, p1; } sfx_note_t;   // ch 2: arg = duty; ch 4: arg = NR43\n` +
  `typedef struct { uint8_t n, length; const sfx_note_t *notes; } sfx_t;\n\n` +
  `// each returns the ROM bank that holds *out and everything it points to (world_far.c, banked)\nuint8_t area_ref(uint8_t a, const area_t **out) BANKED;\nuint8_t biome_ref(uint8_t b, const biome_t **out) BANKED;\nuint8_t kind_ref(uint8_t k, const kind_t **out) BANKED;\n` +
  `uint8_t portrait_ref(uint8_t p, const portrait_t **out) BANKED;\nuint8_t song_ref(uint8_t s, const void **out) BANKED;   // a hUGESong_t\nvoid song_name(uint8_t s, char *out) BANKED;\nvoid ui_load_tiles(void) BANKED;   // the HUD's, the overview's and the dialogue box's tiles into 0x8800 (bank 0)\n\n` +
  `extern const sfx_t sfx_table[SFX_COUNT];\n` +
  `extern const uint8_t look_of[128], look_tall[${LOOKS.length}];   // a tile's look when it never changes (0xFF: it does); looks that reach into the cell above\n` +
  `extern const uint8_t ch_flags[128], cell_col[CELLS], cell_row[CELLS];   // a cell's column and row, without dividing by 14\n` +
  `extern const uint8_t speaker_portrait[SPEAKER_COUNT];   // 0xFF: the narrator, no portrait\nextern const palette_color_t ui_pal[12];   // BG palettes 5 (overview), 6 (icons) and 7 (text)\nextern const uint8_t font[64 * 6];        // ' ' to '_': width, then 5 rows\n\n#endif\n`);
// bank 0: what runs every frame or from bank-0 code; world_far.c (banked): lookups and load-once tiles
write('world.c', `#include <gb/gb.h>\n#include "world.h"\n\n` +
  `const uint8_t ch_flags[128] = {\n${hex(chFlags)}\n};\n` +
  `const uint8_t look_of[128] = {\n${hex(lookOf)}\n};\nconst uint8_t look_tall[${LOOKS.length}] = { ${lookTall.join(', ')} };\n` +
  `const uint8_t cell_col[CELLS] = {\n${hex([...Array(COLS * ROWS).keys()].map(i => i % COLS), 14)}\n};\n` +
  `const uint8_t cell_row[CELLS] = {\n${hex([...Array(COLS * ROWS).keys()].map(i => (i / COLS) | 0), 14)}\n};\n` +
  `const uint8_t speaker_portrait[SPEAKER_COUNT] = { ${SPEAKER_IDS.map(id => portraitOf[id]).join(', ')} };\n` +
  `const palette_color_t ui_pal[12] = {\n${hex16(OVERVIEW_PAL.concat(HUD_PAL, TEXT_PAL).map(G.to555))}\n};\n` +
  `const uint8_t font[] = {\n${hex(glyphs.flat(), 12)}\n};\n`);
write('world_far.c', `#pragma bank 255\n#include <gb/gb.h>\n#include "hUGEDriver.h"\n#include "world.h"\n\n` +
  `// pal.c's fade: channel value i at level l (0-16) is (i * l) >> 4\nBANKREF(fade_lut)\nconst uint8_t fade_lut[17 * 32] = {\n${hex([...Array(17 * 32).keys()].map(n => ((n & 31) * (n >> 5)) >> 4), 32)}\n};\n\n` +
  AREA_KEYS.map(k => `BANKREF_EXTERN(area_${cName(k)})\nextern const area_t area_${cName(k)};`).join('\n') + '\n' +
  usedBiomes.map(b => `BANKREF_EXTERN(biome_${b})\nextern const biome_t biome_${b};`).join('\n') + '\n' +
  KIND_NAMES.map(k => `BANKREF_EXTERN(kind_${k})\nextern const kind_t kind_${k};`).join('\n') + '\n' +
  portraits.map((_, n) => `BANKREF_EXTERN(portrait_${n})\nextern const portrait_t portrait_${n};`).join('\n') + '\n' +
  songs.map(s => `BANKREF_EXTERN(song_${s})\nextern const hUGESong_t song_${s};`).join('\n') + '\n\n' +
  `uint8_t song_ref(uint8_t s, const void **out) BANKED {\n  switch (s) {\n${songs.map((s, i) => `    case ${i}: *out = &song_${s}; return BANK(song_${s});`).join('\n')}\n  }\n  return 0;\n}\n\n` +
  `static const char * const song_names[SONG_COUNT] = { ${songs.map(s => JSON.stringify(songTitle(s))).join(', ')} };\n` +
  `void song_name(uint8_t s, char *out) BANKED { const char *p = song_names[s]; while ((*out++ = *p++)); }   // the pause screen's sound test\n\n` +
  `static const uint8_t ui_tiles[] = {\n${hex(UI_TILES.flatMap(G.enc2bpp))}\n};\n` +
  `static const uint8_t overview_tiles[] = {\n${hex(OVERVIEW_TILES.flatMap(G.enc2bpp))}\n};\n` +
  `static const uint8_t dlg_tiles[] = {\n${hex(DLG_TILES.flatMap(G.enc2bpp))}\n};\n` +
  `void ui_load_tiles(void) BANKED {   // 0x8800 in VRAM bank 0: the HUD from tile 128, the overview from 193, the dialogue box from 204\n` +
  `  set_data((uint8_t *)0x8800, ui_tiles, sizeof(ui_tiles));\n  set_data((uint8_t *)(0x8800 + (65 << 4)), overview_tiles, sizeof(overview_tiles));\n  set_data((uint8_t *)(0x8800 + (76 << 4)), dlg_tiles, sizeof(dlg_tiles));\n}\n\n` +
  `uint8_t portrait_ref(uint8_t p, const portrait_t **out) BANKED {\n  switch (p) {\n${portraits.map((_, n) => `    case ${n}: *out = &portrait_${n}; return BANK(portrait_${n});`).join('\n')}\n  }\n  return 0;\n}\n\n` +
  `uint8_t area_ref(uint8_t a, const area_t **out) BANKED {\n  switch (a) {\n${AREA_KEYS.map((k, i) => `    case ${i}: *out = &area_${cName(k)}; return BANK(area_${cName(k)});`).join('\n')}\n  }\n  return 0;\n}\n\n` +
  `uint8_t biome_ref(uint8_t b, const biome_t **out) BANKED {\n  switch (b) {\n${usedBiomes.map(b => `    case ${BIOME_KEYS.indexOf(b)}: *out = &biome_${b}; return BANK(biome_${b});`).join('\n')}\n  }\n  return 0;\n}\n\n` +
  `uint8_t kind_ref(uint8_t k, const kind_t **out) BANKED {\n  switch (k) {\n${KIND_NAMES.map((k, i) => `    case ${i}: *out = &kind_${k}; return BANK(kind_${k});`).join('\n')}\n  }\n  return 0;\n}\n`);

for (const f of fs.readdirSync(OUT)) if (/\.(c|h|inc)$/.test(f) && !written.has(f)) fs.unlinkSync(path.join(OUT, f));   // gone from the game

// ---------- preview: every area's background as the ROM should draw it ----------
fs.mkdirSync(PREVIEW, { recursive: true });
const SHEET_COLS = 4, CW = 224, CH = 128 + 4;
G.png(path.join(PREVIEW, 'areas.png'), SHEET_COLS * (CW + 4), Math.ceil(AREA_KEYS.length / SHEET_COLS) * CH, (x, y) => {
  const n = Math.floor(y / CH) * SHEET_COLS + Math.floor(x / (CW + 4)), lx = x % (CW + 4), ly = y % CH, k = AREA_KEYS[n];
  if (!k || lx >= CW || ly >= 128) return [16, 16, 24];
  return G.from555(terrain555(areaOut[k].shown[ly * 224 + lx], AREAS[k].biome));
});
// sprite sheet: every kind's frames with its palettes
{
  const list = Object.values(kinds).filter(K => K.name !== 'float'), cellW = 36, cellH = 36, per = 8;
  const rgbOf = (K, piece, v) => { if (!v) return [40, 44, 70]; const cols = K.name === 'marker' ? EFFECTS_PAL : K.pals[K.palOf[piece]]; return G.from555(G.to555(cols[v - 1])); };
  G.png(path.join(PREVIEW, 'sprites.png'), per * cellW * 3, Math.ceil(list.length / per) * cellH, (x, y) => {   // up to 3 frames each
    const n = Math.floor(y / cellH) * per + Math.floor(x / (cellW * 3)), K = list[n]; if (!K) return [16, 16, 24];
    const f = Math.floor((x % (cellW * 3)) / cellW), lx = x % cellW - 2, ly = y % cellH - 2;
    if (f >= K.frames || lx < 0 || ly < 0 || lx >= K.cols * 8 || ly >= K.rows * 16) return [16, 16, 24];
    const piece = (f * K.rows + (ly >> 4)) * K.cols + (lx >> 3);
    return rgbOf(K, piece, K.tiles[piece][(ly & 15) * 8 + (lx & 7)]);
  });
}

// ---------- report ----------
const pad = (s, n) => String(s).padEnd(n);
if (REPORT || problems.length) {
  console.log(pad('area', 18) + pad('row sprites', 13) + pad('sprites', 9) + pad('sprite pals', 13) + pad('sprite tiles', 14) + pad('bg tiles', 10) + pad('metatiles', 11) + 'recoloured');
  for (const r of report) console.log(pad(r.key, 18) + pad(r.rowObjs + 2 + (r.rowObjs + 2 > 10 ? ' !' : ''), 13) + pad(r.objs, 9) + pad(r.pals + '/8', 13) + pad(r.objTiles + '/256', 14) + pad(r.biomeTiles + '/' + MAX_BG_TILES, 10) + pad(r.metas, 11) + r.err + '%');
  for (const [b, o] of Object.entries(biomeOut)) if (o.segments.length) console.log(`${b}: animated ${o.segments.map(sg => `${ANIM_NAMES[sg.anim]} ${sg.tiles.length}`).join(', ')}`);
  console.log(`item palettes: ${ITEM_PALS.map((p, i) => `${i}${i === EFFECTS_ITEM_PAL ? ' (effects)' : ''}: ${IT.filter(k => itemPalOf[k] === i).join('')}`).join(' | ')}`);
}
const worst = Object.entries(biomeOut).sort((a, b) => b[1].order.length - a[1].order.length)[0];
console.log(`${AREA_KEYS.length} areas, ${Object.keys(biomeOut).length} tilesets (largest ${worst[0]} ${worst[1].order.length}/${MAX_BG_TILES}), ${KIND_NAMES.length} sprite kinds, ${MT.length} monsters, ${IT.length} items, ${relicCount} relics, ${SFX_NAMES.length} sound effects, ${songs.length} song(s); previews in ${path.relative(ROOT, PREVIEW)}`);
// the story's words: every line of js/story.js (but the credits, and lines built from numbers) must be in
// src/story.c as written, or as overrides.js text says it on the GBC
{
  const js = fs.readFileSync(path.join(ROOT, 'js', 'story.js'), 'utf8').split('const CREDITS')[0].replace(/`[^`]*`/g, '``');
  const c = fs.readFileSync(path.join(GBC, 'src', 'story.c'), 'utf8');
  const lits = [...js.matchAll(/'((?:\\.|[^'\\])*)'|"((?:\\.|[^"\\])*)"/g)].map(m => (m[1] ?? m[2]).replace(/\\(.)/g, '$1')).filter(t => t.length >= 12 && t.includes(' '));
  for (const t of lits) { const want = (OV.text || {})[t] ?? t; if (!c.includes(want.replace(/\\/g, '\\\\').replace(/"/g, '\\"'))) problems.push(`src/story.c is missing a line of js/story.js: "${want}"`); }
}
try { execFileSync('node', [path.join(ROOT, 'tools', 'validate.js'), '--gbc'], { stdio: 'pipe' }); }
catch (e) { problems.push('tools/validate.js --gbc failed:\n' + String(e.stdout || e.message).trim()); }
if (problems.length) { console.error('\n' + problems.join('\n')); process.exit(1); }
