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
const NPC_IDS = ['grandma', 'hoot', 'rudy', 'lumen', 'queen', ...KITS];
const npcKind = id => (KITS.includes(id) ? 'kit' : NPC_SPR[id]);
const mKind = ch => 'm_' + MONSTERS[ch].spr;
const IT = Object.keys(ITEMS);                 // item codes are 1 + the index here
const itemCode = k => IT.indexOf(k) + 1;
const iKind = k => 'i_' + ITEMS[k].spr;
const KF = { FLIES: 1, BOSS: 2, NPC: 4, FAST: 8, TALL: 16, ITEM: 32, BOB: 64 };
function kindDef(name) {
  if (name === 'fox') return { frames: ['fox_0', 'fox_1', 'fox_hop', 'fox_attack'], flags: 0, share: null };
  if (name === 'kit') return { frames: ['kit_0', 'kit_1'], flags: KF.NPC, share: 'fox' };
  if (Object.values(NPC_SPR).includes(name)) return { frames: [name + '_0', name + '_1'], flags: KF.NPC };
  if (name.startsWith('i_')) { const k = IT.find(k => iKind(k) === name); return { frames: [ITEMS[k].spr], flags: KF.ITEM | (k === 'C' || k === 'L' ? 0 : KF.BOB), item: k }; }
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
kinds.marker = { name: 'marker', frames: 1, cols: 1, rows: 1, flags: 0, pals: [], palOf: [0], tiles: [MARKER], ownPals: 0 };
// floating numbers and words: four slots of three 8x16 pieces, drawn into VRAM at runtime (effects palette)
kinds.float = { name: 'float', frames: 4, cols: 3, rows: 1, flags: 0, pals: [], palOf: new Array(12).fill(0), tiles: new Array(12).fill(null).map(() => new Array(128).fill(0)), ownPals: 0 };
buildKind('fox'); buildKind('kit');
for (const k of IT) buildKind(iKind(k));
for (const A of Object.values(AREAS)) for (const [i, ch] of [...A.map.join('')].entries()) {
  if (MONSTERS[ch]) { buildKind(mKind(ch)); if (MONSTERS[ch].summon) buildKind(mKind(MONSTERS[ch].summon)); if (MONSTERS[ch].splits) buildKind(mKind('s')); }
  else if (ch === '&') buildKind(npcKind(A.npcs[i]));
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
  o.cells = composed[key].tiles.map(c => c.charCodeAt(0));
  o.doors = Object.entries(A.doors).map(([i, d]) => {
    if (d.req && !REQ.includes(d.req)) problems.push(`${key}: door ${i} needs unknown ${d.req}`);
    return { cell: +i, to: AREA_KEYS.indexOf(d.to), spawn: d.spawn !== undefined ? d.spawn : spawnOf(AREAS[d.to]), req: Math.max(0, REQ.indexOf(d.req || null)), when: Math.max(0, WHEN.indexOf(d.when || null)), name: d.name || '' };
  });
  o.enemies = []; o.npcs = []; o.items = [];
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
  });
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
  // pressure: sprites on one row (plus Fang), sprites in all
  let rowObjs = 0, objs = kinds.fox.cols * kinds.fox.rows;
  const things = o.enemies.map(e => ({ cell: e.cell, K: kinds[mKind(MT[e.type])] })).concat(o.npcs.map(n => ({ cell: n.cell, K: kinds[used[n.kind]] })), o.items.map(t => ({ cell: t.cell, K: kinds[iKind(IT[t.code - 1])] })));
  for (let y = 0; y < ROWS; y++) { let n = 0; for (const t of things) if (((t.cell / COLS) | 0) === y) n += t.K.cols; rowObjs = Math.max(rowObjs, n); }
  for (const t of things) objs += t.K.cols * t.K.rows;
  report.push({ key, biome: A.biome, rowObjs, objs, pals: slot, objTiles: o.objTiles, biomeTiles: biomeOut[A.biome].tiles.length, err: (100 * biomeOut[A.biome].errPx / biomeOut[A.biome].px).toFixed(1) });
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
for (const f of fs.readdirSync(OUT)) if (/\.(c|h|inc)$/.test(f)) fs.unlinkSync(path.join(OUT, f));
const hex = (arr, per = 16) => arr.map(v => '0x' + v.toString(16).padStart(2, '0')).reduce((lines, v, i) => { if (i % per === 0) lines.push([]); lines[lines.length - 1].push(v); return lines; }, []).map(l => '  ' + l.join(', ')).join(',\n');
const hex16 = arr => '  ' + arr.map(v => '0x' + v.toString(16).padStart(4, '0')).join(', ');
const cstr = s => '"' + s.toUpperCase().replace(/[\\"]/g, '\\$&') + '"';
const HEAD = '// Generated by gbc/tools/build.js from the web game. Do not edit.\n';
const write = (f, s) => fs.writeFileSync(path.join(OUT, f), HEAD + s);
const defs = (prefix, names) => names.map((n, i) => `#define ${prefix}${n.replace(/[^a-z0-9]/gi, '_').toUpperCase()} ${i}\n`).join('');

for (const [b, o] of Object.entries(biomeOut)) {
  const pal = []; for (let p = 0; p < TERRAIN_PALS; p++) for (let c = 0; c < 4; c++) pal.push(o.pals[p] && o.pals[p][c] ? G.to555(o.pals[p][c]) : 0);
  write(`biome_${b}.c`, `#pragma bank 255\n#include <gb/gb.h>\n#include "world.h"\n\nBANKREF(biome_${b})\n` +
    `static const uint8_t tiles[] = {\n${hex(o.tiles.flatMap(G.enc2bpp))}\n};\nstatic const palette_color_t pal[] = {\n${hex16(pal)}\n};\n` +
    `const biome_t biome_${b} = { ${o.tiles.length}, tiles, pal };\n`);
}
for (const K of Object.values(kinds)) {
  write(`kind_${K.name}.c`, `#pragma bank 255\n#include <gb/gb.h>\n#include "world.h"\n\nBANKREF(kind_${K.name})\n` +
    `static const uint8_t tiles[] = {\n${hex(K.tiles.flatMap(G.enc2bpp))}\n};\nstatic const uint8_t pal_of[] = { ${K.palOf.join(', ')} };\n` +
    `const kind_t kind_${K.name} = { ${K.cols}, ${K.rows}, ${K.frames}, ${K.flags}, ${K.tiles.length * 2}, tiles, pal_of };\n`);
}
AREA_KEYS.forEach(k => {
  const o = areaOut[k], A = AREAS[k], c = cName(k);
  const list = (name, type, rows, fmt) => `static const ${type} ${name}[] = {\n${rows.map(fmt).join(',\n') || '  { 0 }'}\n};\n`;
  write(`area_${c}.c`, `#pragma bank 255\n#include <gb/gb.h>\n#include "world.h"\n\nBANKREF(area_${c})\n` +
    `static const uint8_t map[] = {\n${hex(o.map, 28)}\n};\nstatic const uint8_t attr[] = {\n${hex(o.attr, 28)}\n};\n` +
    `static const uint8_t cells[] = {\n${hex(o.cells, 14)}\n};\n` +
    list('doors', 'door_t', o.doors, d => `  { ${d.cell}, ${d.to}, ${d.spawn}, ${d.req}, ${d.when}, ${cstr(d.name)} }`) +
    list('enemies', 'thing_t', o.enemies, e => `  { ${e.type}, ${e.cell}, 0 }`) +
    list('npcs', 'thing_t', o.npcs, n => `  { ${n.id}, ${n.cell}, ${n.kind} }`) +
    list('items', 'thing_t', o.items, t => `  { ${t.code}, ${t.cell}, ${t.relic} }`) +
    list('kinds', 'area_kind_t', o.kinds, a => `  { ${a.kind}, ${a.bank}, ${a.tile}, ${a.pal} }`) +
    `static const uint8_t type_ak[] = { ${o.typeAk.join(', ')} };\nstatic const uint8_t item_ak[] = { ${o.itemAk.join(', ')} };\n` +
    `static const palette_color_t obj_pal[] = {\n${hex16(o.objPal)}\n};\n` +
    `const area_t area_${c} = { ${BIOME_KEYS.indexOf(A.biome)}, ${TRACK_KEYS.indexOf(A.music)}, ${spawnOf(A)}, ${o.flags}, ${A.brazierTime || 0}, ${A.reform || 0}, ${(A.crumbleTo || '~').charCodeAt(0)}, map, attr, cells,\n` +
    `  ${o.doors.length}, doors, ${o.enemies.length}, enemies, ${o.npcs.length}, npcs, ${o.items.length}, items, ${o.kinds.length}, kinds, type_ak, item_ak, obj_pal, ${cstr(A.title)} };\n`);
});
const songs = fs.readdirSync(path.join(GBC, 'music')).filter(f => f.endsWith('.js') && f !== 'sfx.js').map(f => f.slice(0, -3));
for (const s of songs) fs.writeFileSync(path.join(OUT, `song_${s}.c`), SONG.compile(s, require(path.join(GBC, 'music', s + '.js'))));
const chFlags = new Array(128).fill(0);
for (let c = 32; c < 128; c++) { const ch = String.fromCharCode(c), T = TERRAIN[ch]; if (ch === '#' || ch === '~' || (T && T.solid)) chFlags[c] |= 1; if (ch === '~') chFlags[c] |= 2; if (ch === 'd' || ch === 'D') chFlags[c] |= 4; if (ch === 'w') chFlags[c] |= 8; }
const usedBiomes = BIOME_KEYS.filter(b => biomeOut[b]);
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
write('world.h', `#ifndef FANG_WORLD_H\n#define FANG_WORLD_H\n#include <stdint.h>\n#include <gb/cgb.h>\n\n` +
  `#define AREA_COUNT ${AREA_KEYS.length}\n#define KIND_COUNT ${KIND_NAMES.length}\n#define TYPE_COUNT ${MT.length}\n#define ITEM_COUNT ${IT.length}\n#define PERK_COUNT ${PERK_KEYS.length}\n#define FLAG_COUNT ${FLAGS.length}\n#define RELIC_COUNT ${relicCount}\n` +
  `#define SFX_COUNT ${SFX_NAMES.length}\n#define MAX_ENEMIES ${MAX_ENEMIES}\n#define MAX_ITEMS ${MAX_ITEMS}\n` +
  `#define COLS ${COLS}\n#define ROWS ${ROWS}\n#define CELLS ${COLS * ROWS}\n#define AREA_W 28   // tiles\n#define AREA_H 16\n` +
  `#define UI_TILES ${UI_TILES.length}\n#define OVERVIEW_TILES ${OVERVIEW_TILES.length}\n#define KIND_FOX ${kinds.fox.id}\n` +
  Object.entries(KF).map(([k, v]) => `#define KF_${k} ${v}\n`).join('') + Object.entries(MF).map(([k, v]) => `#define MF_${k} ${v}u\n`).join('') +
  `#define CF_SOLID 1\n#define CF_VOID 2\n#define CF_DOOR 4\n#define CF_WATER 8\n#define AF_PLATES 1\n#define AF_SLIDE 2\n#define AF_REFORM 4\n` +
  REQ.slice(1).map((r, i) => `#define REQ_${r.toUpperCase()} ${i + 1}\n`).join('') + WHEN.slice(1).map((r, i) => `#define WHEN_${r.toUpperCase()} ${i + 1}\n`).join('') +
  `static const uint8_t when_flag[] = { 0xFF, ${WHEN.slice(1).map(w => FLAGS.indexOf(w)).join(', ')} };\n` +
  defs('F_', FLAGS) + defs('P_', PERK_KEYS) + defs('SFX_', SFX_NAMES) + defs('NPC_', NPC_IDS) +
  IT.map((k, i) => `#define IT_${ITEMS[k].spr.toUpperCase()} ${i + 1}\n`).join('') + MT.map((ch, i) => `#define MT_${MONSTERS[ch].spr.toUpperCase()} ${i}\n`).join('') +
  `\ntypedef struct { uint16_t tiles_n; const uint8_t *tiles; const palette_color_t *pal; } biome_t;   // pal: ${TERRAIN_PALS} palettes x 4\n` +
  `typedef struct { uint8_t cols, rows, frames, flags, tiles_n; const uint8_t *tiles; const uint8_t *pal_of; } kind_t;   // pal_of: palette (0/1) of each 8x16 piece\n` +
  `typedef struct { uint8_t cell, to, spawn, req, when; const char *name; } door_t;\n` +
  `typedef struct { uint8_t what, cell, extra; } thing_t;              // enemy: type; npc: id, area kind; item: code, relic id\n` +
  `typedef struct { uint8_t kind, bank, tile, pal; } area_kind_t;    // where this kind's sprite tiles and palettes go\n` +
  `typedef struct { uint8_t biome, music, spawn, flags, brazier_time, reform, crumble_to; const uint8_t *map, *attr, *cells;\n` +
  `                 uint8_t door_n; const door_t *doors; uint8_t enemy_n; const thing_t *enemies; uint8_t npc_n; const thing_t *npcs; uint8_t item_n; const thing_t *items;\n` +
  `                 uint8_t kind_n; const area_kind_t *kinds; const uint8_t *type_ak, *item_ak; const palette_color_t *obj_pal; const char *title; } area_t;\n` +
  `typedef struct { uint16_t hp, xp, flags; uint8_t atk, interval, steps, poison, healer, summon, spawn_every, trail, phases, boss_flag, drop[2]; const char *name; } monster_t;\n` +
  `typedef struct { uint8_t ember; const char *name; } item_t;\n` +
  `typedef struct { uint8_t at, ch, frames, env, arg; uint16_t p0, p1; } sfx_note_t;   // ch 2: arg = duty; ch 4: arg = NR43\n` +
  `typedef struct { uint8_t n, length; const sfx_note_t *notes; } sfx_t;\n\n` +
  `// each returns the ROM bank that holds *out and everything it points to\nuint8_t area_ref(uint8_t a, const area_t **out);\nuint8_t biome_ref(uint8_t b, const biome_t **out);\nuint8_t kind_ref(uint8_t k, const kind_t **out);\n\n` +
  `extern const sfx_t sfx_table[SFX_COUNT];\n` +
  `extern const uint8_t ch_flags[128], cell_col[CELLS], cell_row[CELLS];   // a cell's column and row, without dividing by 14\nextern const uint8_t ui_tiles[UI_TILES * 16], overview_tiles[OVERVIEW_TILES * 16];\nextern const palette_color_t ui_pal[12];   // BG palettes 5 (overview), 6 (icons) and 7 (text)\nextern const uint8_t font[64 * 6];        // ' ' to '_': width, then 5 rows\n\n#endif\n`);
write('world.c', `#include <gb/gb.h>\n#include "world.h"\n\n` +
  AREA_KEYS.map(k => `BANKREF_EXTERN(area_${cName(k)})\nextern const area_t area_${cName(k)};`).join('\n') + '\n' +
  usedBiomes.map(b => `BANKREF_EXTERN(biome_${b})\nextern const biome_t biome_${b};`).join('\n') + '\n' +
  KIND_NAMES.map(k => `BANKREF_EXTERN(kind_${k})\nextern const kind_t kind_${k};`).join('\n') + '\n\n' +
  `const uint8_t ch_flags[128] = {\n${hex(chFlags)}\n};\n` +
  `const uint8_t cell_col[CELLS] = {\n${hex([...Array(COLS * ROWS).keys()].map(i => i % COLS), 14)}\n};\n` +
  `const uint8_t cell_row[CELLS] = {\n${hex([...Array(COLS * ROWS).keys()].map(i => (i / COLS) | 0), 14)}\n};\n` +
  `const uint8_t ui_tiles[] = {\n${hex(UI_TILES.flatMap(G.enc2bpp))}\n};\n` +
  `const uint8_t overview_tiles[] = {\n${hex(OVERVIEW_TILES.flatMap(G.enc2bpp))}\n};\n` +
  `const palette_color_t ui_pal[12] = {\n${hex16(OVERVIEW_PAL.concat(HUD_PAL, TEXT_PAL).map(G.to555))}\n};\n` +
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
  const list = Object.values(kinds).filter(K => K.name !== 'float'), cellW = 36, cellH = 36, per = 8;
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
  console.log(pad('area', 18) + pad('row sprites', 13) + pad('sprites', 9) + pad('sprite pals', 13) + pad('sprite tiles', 14) + pad('bg tiles', 10) + 'recoloured');
  for (const r of report) console.log(pad(r.key, 18) + pad(r.rowObjs + 2 + (r.rowObjs + 2 > 10 ? ' !' : ''), 13) + pad(r.objs, 9) + pad(r.pals + '/8', 13) + pad(r.objTiles + '/256', 14) + pad(r.biomeTiles + '/256', 10) + r.err + '%');
  console.log(`item palettes: ${ITEM_PALS.map((p, i) => `${i}${i === EFFECTS_ITEM_PAL ? ' (effects)' : ''}: ${IT.filter(k => itemPalOf[k] === i).join('')}`).join(' | ')}`);
}
const worst = Object.entries(biomeOut).sort((a, b) => b[1].tiles.length - a[1].tiles.length)[0];
console.log(`${AREA_KEYS.length} areas, ${Object.keys(biomeOut).length} tilesets (largest ${worst[0]} ${worst[1].tiles.length}/${MAX_STATIC_TILES}), ${KIND_NAMES.length} sprite kinds, ${MT.length} monsters, ${IT.length} items, ${relicCount} relics, ${SFX_NAMES.length} sound effects, ${songs.length} song(s); previews in ${path.relative(ROOT, PREVIEW)}`);
try { execFileSync('node', [path.join(ROOT, 'tools', 'validate.js'), '--gbc'], { stdio: 'pipe' }); }
catch (e) { problems.push('tools/validate.js --gbc failed:\n' + String(e.stdout || e.message).trim()); }
if (problems.length) { console.error('\n' + problems.join('\n')); process.exit(1); }
