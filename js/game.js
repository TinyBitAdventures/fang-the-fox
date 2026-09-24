// Fang the Fox — game state and turn logic.
const canvas = document.getElementById('screen');
const ctx = canvas.getContext('2d');
ctx.imageSmoothingEnabled = false;
const SAVE_KEY = 'fangPixelSave2';
const idx = (x, y) => y * COLS + x;
const tileX = x => GX + x * TILE, tileY = y => GY + y * TILE;
const inGrid = (x, y) => x >= 0 && y >= 0 && x < COLS && y < ROWS;
const DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1]];
const TOTAL_RELICS = Object.values(AREAS).reduce((n, a) => n + (a.map.join('').match(/a/g) || []).length, 0);
const BOSS_FLAG = { j: 'gooking', X: 'guardian', Y: 'colossus', Q: 'dragon', t: 'rotheart', A: 'primordial' };

let G = null;                 // game state (saved)
let S = null;                 // current area live state (G.areas[G.areaKey])
const weather = new Weather();
const fx = { rims: [], floats: [], effects: [], shake: 0, flashT: 0, telegraph: [], toast: null, areaTitle: null, msg: '', msgT: 0, objective: null };
const ui = { mode: 'splash', sel: 0, tab: 0, perkChoices: [], anim: 0, trans: null, t: 0, hasSave: false, dialog: null, credits: 0 };
let lastT = performance.now();

// ---------- State ----------
function newGame() {
  G = {
    areaKey: 'home', areas: {}, turn: 0, kills: 0, visited: {},
    fox: { x: 0, y: 0, hp: 100, maxHp: 100, atk: 5, lvl: 1, xp: 0, next: 100, dir: 1 },
    inv: { fish: 0, key: 0 }, gems: 0, story: [], relics: {}, embers: {}, kits: {}, perks: {}, flags: {}, pendingPerks: 0,
    buff: { mushroom: 0, poison: 0, ward: 0, barrier: 0, haste: 0, sleep: 0, rooted: 0, spinCd: 0, secondWind: false, trueSight: false },
  };
  enterArea('home', null, true);
}
function makeArea(key) {
  const A = AREAS[key], tiles = [], enemies = [], items = {}, npcs = [], blocks = [];
  let spawn = null, id = 0;
  A.map.join('').split('').forEach((ch, i) => {
    const x = i % COLS, y = (i / COLS) | 0;
    if (MONSTERS[ch]) { enemies.push(makeEnemy(ch, x, y, id++)); tiles.push('_'); }
    else if (ITEMS[ch]) { if (!(ch === 'a' && G.relics[key + ':' + i])) items[i] = ch; tiles.push('_'); }
    else if (ch === 'F') { spawn = i; tiles.push('_'); }
    else if (ch === '&') { const nid = A.npcs[i]; if (!(KITS.includes(nid) && G.kits[nid])) npcs.push({ id: nid, x, y, home: i }); tiles.push('_'); }
    else if (ch === '@') { blocks.push({ x, y, ox: x, oy: y }); tiles.push('_'); }
    else tiles.push(ch);
  });
  return { key, tiles, orig: tiles.slice(), enemies, items, npcs, blocks, spawn: spawn === null ? 43 : spawn, lit: {}, solved: false, temp: {}, bossDown: false };
}
function makeEnemy(t, x, y, id, extra = {}) {
  const m = MONSTERS[t];
  return Object.assign({ id, t, x, y, hp: m.hp, max: m.hp, frozen: 0, aggro: false, revealed: false, phase: 1, summoned: false, dead: false, revive: m.revives ? 1 : 0, acts: 0 }, extra);
}
function enemyAt(x, y) { return S.enemies.find(e => !e.dead && e.x === x && e.y === y); }
function npcAt(x, y) { return S.npcs.find(n => n.x === x && n.y === y); }
function blockAt(x, y) { return S.blocks.find(b => b.x === x && b.y === y); }
function tileAt(x, y) { return inGrid(x, y) ? S.tiles[idx(x, y)] : '#'; }
function isSolid(ch) { return ch === '#' || (TERRAIN[ch] && TERRAIN[ch].solid) || ch === '~'; }
function occupied(x, y) { return enemyAt(x, y) || npcAt(x, y) || blockAt(x, y) || (G.fox.x === x && G.fox.y === y); }
function hiddenAt(x, y) {
  if (tileAt(x, y) !== 'o' || G.perks.keenEyes || G.buff.trueSight) return false;
  return Math.abs(x - G.fox.x) + Math.abs(y - G.fox.y) > 1;
}
function flagFor(req) {
  return { gooking: G.flags.gooking, pathfinder: G.perks.pathfinder, crystalKey: G.flags.crystalKey, frost_cloak: G.flags.cloak, dragon_scale: G.flags.scale }[req];
}
// doors that only exist once a story flag is set (the Ruins portal, the Void Rift, the home portal)
function applyWhenDoors() {
  const A = AREAS[G.areaKey];
  for (const [i, d] of Object.entries(A.doors)) if (d.when) S.tiles[i] = G.flags[d.when] ? 'd' : (S.orig[i] === 'd' ? '_' : S.orig[i]);
}

function enterArea(key, spawnIdx, first) {
  if (!G.areas[key]) G.areas[key] = makeArea(key);
  G.areaKey = key; S = G.areas[key]; G.visited[key] = true;
  applyWhenDoors();
  const sp = spawnIdx !== null && spawnIdx !== undefined ? spawnIdx : S.spawn;
  S.entry = sp;
  G.fox.x = sp % COLS; G.fox.y = (sp / COLS) | 0; G.fox.anim = null;
  G.buff.secondWind = false; G.buff.trueSight = false; G.buff.rooted = 0;
  // unsolved puzzles reset when you come back
  if (!S.solved) { S.blocks.forEach(b => { b.x = b.ox; b.y = b.oy; }); S.lit = {}; }
  // crumbled paths re-form, so leaving or falling can never strand a puzzle
  for (const [i, tt] of Object.entries(S.temp)) if (tt.orig === 'u') { S.tiles[i] = 'u'; delete S.temp[i]; }
  for (const e of S.enemies) e.anim = null;
  if (key === 'home') placeKits();
  const A = AREAS[key];
  let B = BIOMES[A.biome];
  if (key === 'home' && G.flags.primordial) B = Object.assign({}, B, { rain: false });
  weather.reset(B);
  fx.floats = []; fx.effects = []; fx.telegraph = [];
  fx.areaTitle = { text: A.title, t: 0 };
  buildIsland(key);
  if (ui.mode === 'play' || ui.mode === 'trans') Music.play(A.music);
  if (!first) save();
}
function placeKits() {
  const spots = AREAS.home.kitSpots;
  KITS.forEach((k, n) => { if (G.kits[k] && !S.npcs.find(p => p.id === k)) { const i = spots[n]; S.npcs.push({ id: k, x: i % COLS, y: (i / COLS) | 0, home: i, rescued: true }); } });
}

function save() {
  if (!G || G.fox.hp <= 0 || ui.mode === 'dead') return; // never persist a fallen Fang
  try { localStorage.setItem(SAVE_KEY, JSON.stringify(G, (k, v) => (k === 'anim' || k === 'flash') ? undefined : v)); } catch (e) {}
}
function load() {
  try {
    const raw = localStorage.getItem(SAVE_KEY); if (!raw) return false;
    G = JSON.parse(raw); if (!G.areas[G.areaKey]) return false;
    if (!G.story) G.story = [];
    if (G.fox.hp <= 0) G.fox.hp = G.fox.maxHp;
    if (G.flags.primordial && !G.flags.ended && !G.story.some(q => q.fn === 'startEnding')) G.story.push({ fn: 'startEnding', t: 0 });
    enterArea(G.areaKey, idx(G.fox.x, G.fox.y), true);
    return true;
  } catch (e) { return false; }
}
// Story beats wait for normal play so they never cover death, doors or perk picks.
// Queued by function name so pending beats survive a save and reload.
function queueStory(fn, arg, delay) { G.story.push({ fn, arg, t: delay || 0 }); save(); }
function runStory(dt) {
  const q = G.story[0]; if (!q) return;
  q.t -= dt; if (q.t > 0 || ui.mode !== 'play' || busy()) return;
  G.story.shift(); window[q.fn](q.arg);
}
function hasSave() { try { return !!localStorage.getItem(SAVE_KEY); } catch (e) { return false; } }

// ---------- Messages & effects ----------
function say(text) { fx.msg = text; fx.msgT = 0; }
function floatText(x, y, text, color) { fx.floats.push({ x: tileX(x) + 8, y: tileY(y) - 2, text: String(text), color, t: 0 }); }
function effect(name, x, y, frames, ms = 60) { fx.effects.push({ name, x: tileX(x) + 8, y: tileY(y) + 16, frames, ms, t: 0 }); }
function shake(n) { if (Settings.shake) fx.shake = Math.max(fx.shake, n); }
function sparkle(x, y, colors) { weather.burst(tileX(x) + 8, tileY(y) + 8, 14, colors, { speed: 30, up: 20 }); }

// ---------- Fox actions ----------
function busy() { return (G.fox.anim && G.fox.anim.t < G.fox.anim.d) || S.enemies.some(e => e.anim && e.anim.t < e.anim.d); }
let queued = null;
function input(action) {
  if (ui.mode !== 'play') return;
  if (busy()) { queued = action; return; }
  doAction(action);
}
function doAction(action) {
  const f = G.fox, b = G.buff;
  if (action === 'eat') return eatFish();
  if (action === 'spin') return fireSpin();
  const [dx, dy] = { right: [1, 0], left: [-1, 0], down: [0, 1], up: [0, -1] }[action];
  if (dx) f.dir = dx;
  if (b.sleep > 0) { b.sleep--; say(`Fang is asleep... (${b.sleep})`); floatText(f.x, f.y, 'Z', '#a8c6f0'); return endTurn(); }
  if (b.rooted > 0) { b.rooted--; say('Tangled up!'); floatText(f.x, f.y, 'STUCK', '#9be06a'); return endTurn(); }
  const nx = f.x + dx, ny = f.y + dy;
  if (!inGrid(nx, ny)) return bump('Ouch! The edge of the island.');
  const e = enemyAt(nx, ny);
  if (e) { attack(e, dx, dy); return endTurn(); }
  const npc = npcAt(nx, ny);
  if (npc) { bump(); return talkTo(npc); }
  const i = idx(nx, ny), ch = S.tiles[i];
  if (ch === 'd' || ch === 'D') return tryDoor(i, nx, ny);
  if (ch === '?') { bump(); return readSign(i); }
  if (ch === '*') return lightBrazier(i, nx, ny);
  if (ch === '%') {
    if (G.inv.key > 0) { G.inv.key--; S.tiles[i] = '_'; Sfx.play('door'); effect('poof', nx, ny, 3, 80); say('The Ancient Key turns. The gate swings open.'); save(); return endTurn(); }
    Sfx.play('locked'); return bump('A locked gate. It needs an Ancient Key.');
  }
  if (ch === '#') { Sfx.play('locked'); return bump(S.tiles.includes('+') ? 'A sealed gate. Something here must be weighed down...' : 'A sealed gate. The braziers here are cold...'); }
  if (ch === '~') return bump('The Void yawns below. Better not!');
  const blk = blockAt(nx, ny);
  if (blk) return pushBlock(blk, dx, dy);
  if (isSolid(ch)) return bump(ch === 'w' ? 'Fang would rather not swim.' : null);
  const it = S.items[i];
  if (it === 'L') {
    if (G.inv.key > 0) { G.inv.key--; delete S.items[i]; Sfx.play('gem'); G.gems += 3; gainXp(60, nx, ny); say('Unlocked the chest! +3 gems.'); sparkle(nx, ny, ['#ffd35c', '#fff2b0']); save(); return endTurn(); }
    Sfx.play('locked'); return bump('A locked chest. It needs an Ancient Key.');
  }
  const from = idx(f.x, f.y);
  moveFox(nx, ny);
  crumbleBehind(from);
  if (it) pickup(i, it, nx, ny);
  hazardsOn(nx, ny, dx, dy);
  if (ui.mode === 'trans') return;
  endTurn();
  if (tileAt(f.x, f.y) === 'x' && !G.flags.cloak) { say('Deep snow slows you down...'); endTurn(true); }
}
function bump(text) { Sfx.play('bump'); G.fox.anim = { type: 'bump', t: 0, d: 120 }; if (text) say(text); }
function moveFox(nx, ny) {
  const f = G.fox; f.anim = { type: 'hop', fx: f.x, fy: f.y, t: 0, d: 110 }; f.x = nx; f.y = ny; Sfx.play('step');
}
function crumbleBehind(i) {
  if (S.tiles[i] !== 'u') return;
  const to = AREAS[G.areaKey].crumbleTo || '~', x = i % COLS, y = (i / COLS) | 0;
  S.tiles[i] = to; Sfx.play('boom');
  const reform = AREAS[G.areaKey].reform; if (reform) S.temp[i] = { orig: 'u', t: reform };
  weather.burst(tileX(x) + 8, tileY(y) + 10, 12, to === 'l' ? ['#ff7a1a', '#8a1414'] : ['#6b3a9a', '#3b1f5a', '#a86ad8'], { speed: 25, g: 80 });
}
function tryDoor(i, nx, ny) {
  const d = AREAS[G.areaKey].doors[i]; if (!d) return bump('This passage leads nowhere...');
  if (d.req && !flagFor(d.req)) {
    Sfx.play('locked');
    return bump({
      gooking: 'Thick green goo seals the path. The Goo King must be stopped first!',
      pathfinder: 'An overgrown secret passage. Learn PATHFINDER to open it.',
      crystalKey: 'The crystal arch is sealed. Find the Crystal Key in the Depths below.',
      frost_cloak: 'The heat is too intense! You need the Frost Cloak from the Ice Colossus.',
      dragon_scale: 'The forest rejects you. You need the Dragon Scale.',
    }[d.req]);
  }
  moveFox(nx, ny); Sfx.play('door'); say(d.name);
  transition(() => enterArea(d.to, d.spawn));
}
function transition(mid) { ui.mode = 'trans'; ui.trans = { t: 0, mid, done: false }; }

// ---------- Puzzles ----------
function lightBrazier(i, x, y) {
  if (S.lit[i]) { bump('The brazier is already burning.'); return; }
  G.fox.anim = { type: 'lunge', dx: Math.sign(x - G.fox.x), dy: Math.sign(y - G.fox.y), t: 0, d: 160 };
  S.lit[i] = AREAS[G.areaKey].brazierTime || -1;
  Sfx.play('spin'); weather.burst(tileX(x) + 8, tileY(y) + 4, 18, ['#ff7a1a', '#ffd35c', '#fff2b0'], { up: 30, speed: 30 });
  const total = S.tiles.filter(c => c === '*').length, lit = Object.keys(S.lit).length;
  say(total > 1 ? `The brazier roars to life! (${lit}/${total})` : 'The brazier roars to life!');
  checkPuzzle();
  endTurn();
}
function pushBlock(blk, dx, dy) {
  const tx = blk.x + dx, ty = blk.y + dy;
  if (!inGrid(tx, ty)) return bump('It won\'t budge.');
  const ch = tileAt(tx, ty), ti = idx(tx, ty);
  if (occupied(tx, ty) || S.items[ti] || ch === 'd' || ch === 'D' || (isSolid(ch) && ch !== 'w' && ch !== '~')) return bump(S.items[ti] ? 'Something is in the way.' : 'It won\'t budge.');
  const f = G.fox, from = idx(f.x, f.y);
  blk.anim = { fx: blk.x, fy: blk.y, t: 0, d: 130 };
  blk.x = tx; blk.y = ty;
  moveFox(f.x + dx, f.y + dy); crumbleBehind(from);
  Sfx.play('bump');
  if (ch === 'w') { S.tiles[ti] = '='; S.blocks = S.blocks.filter(b => b !== blk); Sfx.play('splash'); say('The stone sinks, making a stepping stone!'); }
  else if (ch === '~') { S.blocks = S.blocks.filter(b => b !== blk); Sfx.play('boom'); say('The stone tumbles into the Void...'); }
  else if (ch === 'l') { S.tiles[ti] = '_'; S.blocks = S.blocks.filter(b => b !== blk); Sfx.play('boom'); say('The stone sinks and cools the lava.'); }
  else if (ch === '+') { Sfx.play('freeze'); sparkle(tx, ty, ['#6fe8f0', '#eef4ff']); }
  checkPuzzle();
  endTurn();
}
function checkPuzzle() {
  if (S.solved || !S.tiles.includes('#')) return;
  const braziers = S.tiles.map((c, i) => c === '*' ? i : -1).filter(i => i >= 0);
  const plates = S.tiles.map((c, i) => c === '+' ? i : -1).filter(i => i >= 0);
  const allLit = braziers.every(i => S.lit[i]);
  const allPressed = plates.every(i => S.blocks.some(b => idx(b.x, b.y) === i));
  if (!allLit || !allPressed) return;
  S.solved = true;
  S.tiles.forEach((c, i) => { if (c === '#') { S.tiles[i] = '_'; effect('poof', i % COLS, (i / COLS) | 0, 3, 90); } });
  for (const i of braziers) S.lit[i] = -1; // stay lit forever once solved
  Sfx.play('level'); shake(3); say('Rumble... the gate opens!');
  save();
}

// ---------- Items ----------
function pickup(i, it, x, y) {
  const f = G.fox; delete S.items[i];
  const I = ITEMS[it];
  if (I.ember) {
    G.embers[it] = true; Sfx.play('level'); shake(4); fx.flashT = 300;
    weather.burst(tileX(x) + 8, tileY(y) + 8, 40, ['#ffd35c', '#fff2b0', '#ff7a1a', '#ffffff'], { speed: 60, up: 30 });
    const n = EMBERS.filter(k => G.embers[k]).length;
    say(n === 5 ? `The ${I.name}! All five Embers! Take them home to Grandma.` : `The ${I.name}! (${n}/5 Embers)`);
    f.hp = f.maxHp; showObjective();
    save(); return;
  }
  switch (it) {
    case 'f': G.inv.fish += 5; Sfx.play('pickup'); say('Caught 5 fish! Press F to eat one.'); floatText(x, y, '+5 FISH', '#6fe8f0'); break;
    case 'H': f.hp = f.maxHp; Sfx.play('heal'); say('Golden Fish! Fully healed.'); floatText(x, y, 'FULL HP', '#9be06a'); sparkle(x, y, ['#ffd35c', '#fff2b0']); break;
    case 'm': G.buff.mushroom = 10; Sfx.play('pickup'); say('Mushroom! +5 attack for 10 turns.'); floatText(x, y, '+5 ATK', '#ff4fa0'); break;
    case 'c': G.gems++; Sfx.play('gem'); say(`Crystal Shard! +1 gem (${G.gems})`); gainXp(10, x, y); sparkle(x, y, ['#6fe8f0', '#eef4ff']); break;
    case 'k': G.inv.key++; Sfx.play('pickup'); say('Found an Ancient Key.'); break;
    case 'a':
      G.relics[G.areaKey + ':' + i] = true; Sfx.play('level'); sparkle(x, y, ['#ffd35c', '#fff2b0', '#ffffff']); gainXp(30, x, y);
      say(`Found an ancient Relic! (${Object.keys(G.relics).length}/${TOTAL_RELICS}) Hoot would love to see it.`);
      break;
    case 'C': {
      let gems = 2, extra = ''; if (G.perks.treasureHunter) { gems++; G.inv.fish += 5; extra = ' and 5 fish'; }
      G.gems += gems; Sfx.play('gem'); sparkle(x, y, ['#ff4fa0', '#ffa0d0', '#ffd35c']);
      say(`Opened the chest: ${gems} gems${extra}! (${G.gems})`); gainXp(30, x, y); break;
    }
    case '1': G.buff.poison = 0; G.buff.ward = 20; Sfx.play('heal'); say('Antidote! Poison cured and warded.'); break;
    case '2': G.buff.barrier = 3; Sfx.play('heal'); say('Barrier Potion! Blocks the next 3 hits.'); break;
    case '3': G.buff.haste = 12; Sfx.play('heal'); say('Haste Potion! Enemies slow down for 12 turns.'); break;
    case '4': G.buff.trueSight = true; S.enemies.forEach(e => e.revealed = true); Sfx.play('gem'); say('True Sight! Hidden things are revealed.'); break;
    case '5': G.flags.cloak = true; Sfx.play('level'); say('The Frost Cloak! Ice no longer trips you, and the Magma Caverns can be braved.'); break;
    case '6': G.flags.scale = true; Sfx.play('level'); say('The Dragon Scale! Lava cannot burn you now, and the Whispering Woods will let you in.'); break;
    case '8': f.maxHp += 20; f.hp = f.maxHp; Sfx.play('level'); sparkle(x, y, ['#ff4fa0', '#ffa0d0']); say('A Heart Container! Max health +20.'); break;
    case '9': G.flags.crystalKey = true; Sfx.play('level'); sparkle(x, y, ['#6fe8f0', '#eef4ff']); say('The Crystal Key! The great arch in the Crystal Cave will open now.'); showObjective(); break;
  }
  save();
}
function hazardsOn(x, y, dx, dy) {
  const ch = tileAt(x, y), f = G.fox;
  if (ch === 'l') {
    const dmg = G.flags.scale ? 0 : G.perks.heatResist ? 10 : 20;
    if (dmg) { hurtFox(dmg, 'Lava'); weather.burst(tileX(x) + 8, tileY(y) + 12, 14, ['#ff7a1a', '#ffd35c'], { up: 30 }); }
  } else if (ch === 'e' && !G.perks.natureBond) { G.buff.rooted = 1; say('Vines wrap around your paws!'); }
  else if (ch === 'i' && !G.flags.cloak) {
    const slide = AREAS[G.areaKey].slide;
    let cx = x, cy = y, moved = 0;
    while (true) {
      const nx = cx + dx, ny = cy + dy;
      if (!inGrid(nx, ny)) break;
      const nch = tileAt(nx, ny), ni = idx(nx, ny);
      if (nch === 'd' || nch === 'D') { if (slide) { f.x = cx; f.y = cy; tryDoor(ni, nx, ny); return; } break; }
      if (isSolid(nch) || occupied(nx, ny) || S.items[ni]) break;
      cx = nx; cy = ny; moved++;
      if (!slide || nch !== 'i') break;
    }
    if (moved) { f.anim = { type: 'hop', fx: x - dx, fy: y - dy, t: 0, d: 110 + moved * 50 }; f.x = cx; f.y = cy; Sfx.play('freeze'); if (!slide) say('Whoa! Slipped on the ice!'); if (tileAt(cx, cy) !== 'i') hazardsOn(cx, cy, dx, dy); }
  }
}
function eatFish() {
  const f = G.fox;
  if (G.inv.fish <= 0) { say('No fish left! Find more, or trade gems with Rudy.'); Sfx.play('locked'); return; }
  if (f.hp >= f.maxHp) { say('Fang is already full.'); return; }
  G.inv.fish--;
  const heal = Math.floor((15 + f.lvl * 3) * (G.perks.scavenger ? 1.5 : 1));
  f.hp = Math.min(f.maxHp, f.hp + heal); Sfx.play('heal'); floatText(f.x, f.y, '+' + heal, '#9be06a'); say(`Munch! +${heal} HP (${G.inv.fish} fish left)`);
  endTurn();
}
function fireSpin() {
  if (!G.perks.fireSpin) { say('Learn FIRE SPIN on level up to use SPACE.'); return; }
  if (G.buff.spinCd > 0) { say(`Fire Spin recharging... ${G.buff.spinCd}`); Sfx.play('locked'); return; }
  G.buff.spinCd = 4; Sfx.play('spin'); shake(3);
  const f = G.fox, cx = tileX(f.x) + 8, cy = tileY(f.y) + 8;
  for (let a = 0; a < 28; a++) { const ang = a / 28 * Math.PI * 2; weather.sparks.push({ x: cx, y: cy, vx: Math.cos(ang) * 70, vy: Math.sin(ang) * 70, g: 0, t: 0, life: 320, c: a % 2 ? '#ff7a1a' : '#ffd35c', size: 2 }); }
  fx.flashT = 180;
  let hits = 0;
  for (let oy = -1; oy <= 1; oy++) for (let ox = -1; ox <= 1; ox++) {
    if (!ox && !oy) continue;
    const bx = f.x + ox, by = f.y + oy, bi = idx(bx, by);
    if (inGrid(bx, by) && S.tiles[bi] === '*' && !S.lit[bi]) { S.lit[bi] = AREAS[G.areaKey].brazierTime || -1; checkPuzzle(); }
    const e = enemyAt(bx, by); if (!e) continue;
    let dmg = calcDamage().dmg; if (MONSTERS[e.t].fireproof) dmg = Math.floor(dmg / 2);
    hits++; damageEnemy(e, dmg, false);
  }
  say(hits ? `Fire Spin hits ${hits} ${hits > 1 ? 'enemies' : 'enemy'}!` : 'Fire Spin! Nothing in reach.');
  endTurn();
}

// ---------- Combat ----------
function calcDamage() {
  const f = G.fox; let dmg = f.atk;
  if (G.buff.mushroom > 0) dmg += 5;
  if (G.perks.fury && f.hp <= f.maxHp * 0.3) dmg += 3;
  let crit = false; if (G.perks.criticalStrike && Math.random() < 0.2) { dmg *= 2; crit = true; }
  return { dmg, crit };
}
function attack(e, dx, dy) {
  const m = MONSTERS[e.t];
  G.fox.anim = { type: 'lunge', dx, dy, t: 0, d: 160 };
  if (m.camo && !e.revealed) { e.revealed = true; say('The tree opens its eyes... a Treant!'); }
  if (m.dormant) e.aggro = true;
  let { dmg, crit } = calcDamage();
  if (m.armored) dmg = Math.max(1, Math.floor(dmg / 2));
  effect('slash', e.x, e.y, 3, 55);
  Sfx.play(crit ? 'crit' : 'attack');
  if (crit) shake(3);
  const killed = damageEnemy(e, dmg, crit);
  if (G.perks.flameBurst) for (const [ox, oy] of DIRS) { const n = enemyAt(e.x + ox, e.y + oy); if (n) damageEnemy(n, Math.max(1, Math.floor(dmg / 2)), false); }
  if (!killed && !e.dead) {
    if (G.perks.frostTouch && Math.random() < 0.2) { e.frozen = 2; Sfx.play('freeze'); floatText(e.x, e.y, 'FROZEN', '#6fe8f0'); }
    else if (!e.frozen) { e.hitT = G.turn; enemyStrike(e, true); }
    if (ui.mode === 'play') say(`${crit ? 'Critical! ' : ''}${m.name} takes ${dmg}. (${Math.max(0, e.hp)}/${e.max})`);
  }
}
function damageEnemy(e, dmg, crit) {
  e.hp -= dmg; e.flash = 140; floatText(e.x, e.y, dmg + (crit ? '!' : ''), crit ? '#ffd35c' : '#fff2b0');
  if (MONSTERS[e.t].boss) bossCheck(e);
  if (e.hp <= 0 && !e.dead) { killEnemy(e); return true; }
  return false;
}
function freeSpotsNear(x, y, r = 1) {
  const out = [];
  for (let oy = -r; oy <= r; oy++) for (let ox = -r; ox <= r; ox++) { const X = x + ox, Y = y + oy; if (inGrid(X, Y) && (ox || oy) && tileAt(X, Y) === '_' && !occupied(X, Y) && !S.items[idx(X, Y)]) out.push([X, Y]); }
  return out.sort(() => Math.random() - 0.5);
}
// nearest open tiles around a spot for boss drops (ice, snow and ash all count as open)
function dropSpots(x, y, includeSelf) {
  const out = [], seen = new Set([idx(x, y)]), q = [[x, y]];
  if (includeSelf) out.push([x, y]);
  while (q.length && out.length < 6) {
    const [cx, cy] = q.shift();
    for (const [dx, dy] of DIRS) {
      const nx = cx + dx, ny = cy + dy, i = idx(nx, ny);
      if (!inGrid(nx, ny) || seen.has(i)) continue; seen.add(i);
      const ch = tileAt(nx, ny);
      if (isSolid(ch) || ch === 'd' || ch === 'D') continue;
      q.push([nx, ny]);
      if (!S.items[i] && !occupied(nx, ny) && ch !== 'l' && ch !== 'v') out.push([nx, ny]);
    }
  }
  return out;
}
function killEnemy(e) {
  const m = MONSTERS[e.t];
  if (e.revive > 0) {
    e.revive--; e.dead = true; e.reviveIn = 4; effect('poof', e.x, e.y, 3, 90); Sfx.play('kill'); say('The skeleton crumbles... but the bones are twitching.'); gainXp(Math.floor(m.xp / 2), e.x, e.y); return;
  }
  e.dead = true; e.gone = true; G.kills++;
  effect('poof', e.x, e.y, 3, 90); Sfx.play('kill');
  weather.burst(tileX(e.x) + 8, tileY(e.y) + 10, 10, ['#eef4ff', '#a8c6f0']);
  gainXp(m.xp, e.x, e.y);
  if (m.shatter) { for (const [ox, oy] of DIRS) { const x = e.x + ox, y = e.y + oy; if (inGrid(x, y) && tileAt(x, y) === '_' && !occupied(x, y)) S.tiles[idx(x, y)] = 'i'; } Sfx.play('freeze'); }
  if (m.explodes) {
    Sfx.play('boom'); shake(4); weather.burst(tileX(e.x) + 8, tileY(e.y) + 8, 24, ['#9be06a', '#a86ad8', '#4fb04a'], { speed: 60 });
    if (Math.abs(e.x - G.fox.x) <= 1 && Math.abs(e.y - G.fox.y) <= 1) hurtFox(10, 'Spore burst');
  }
  if (m.splits) { for (const [x, y] of freeSpotsNear(e.x, e.y).slice(0, 2)) { S.enemies.push(makeEnemy('s', x, y, S.enemies.length + 200, { minion: true })); effect('poof', x, y, 3, 80); } say('The Shadow Slim splits apart!'); }
  if (!m.boss && !e.minion && !S.tiles.includes('+') && Math.random() < 0.08) { const i = idx(e.x, e.y); if (!S.items[i] && S.tiles[i] === '_') S.items[i] = 'f'; }
  if (m.boss) {
    S.bossDown = true; shake(8); fx.flashT = 400; Sfx.play('roar');
    S.enemies.filter(o => !o.dead && o.minion).forEach(o => { o.dead = true; o.gone = true; effect('poof', o.x, o.y, 3, 90); });
    const flag = BOSS_FLAG[e.t]; if (flag) G.flags[flag] = true;
    // drops land beside the boss (its own tile may become a portal)
    applyWhenDoors(); // open any portal first so drops never land on it
    const spots = dropSpots(e.x, e.y, !'dD'.includes(tileAt(e.x, e.y)));
    m.drop.forEach((d, n) => { const [x, y] = spots[n]; S.items[idx(x, y)] = d; });
    if (m.final) queueStory('startEnding', null, 1400);
    else queueStory('bossDefeatedDialog', e.t, 900);
  }
  save();
}
function bossCheck(e) {
  const m = MONSTERS[e.t], pct = e.hp / e.max;
  if (m.phases) {
    const phase = pct <= 0.33 ? 3 : pct <= 0.66 ? 2 : 1;
    if (phase > e.phase) { e.phase = phase; summon(e, m.summon, 2); say(`The Primordial shifts! Phase ${phase}.`); Sfx.play('roar'); shake(6); teleport(e); }
  } else if (m.summon && !e.summoned && pct <= 0.5) { e.summoned = true; summon(e, m.summon, 3); say(`${m.name} calls for help!`); Sfx.play('roar'); shake(5); }
  if (e.t === 'Q' && pct <= 0.25 && !e.erupted) {
    e.erupted = true; let n = 0;
    for (let k = 0; k < 60 && n < 6; k++) { const x = (Math.random() * COLS) | 0, y = (Math.random() * ROWS) | 0; if (tileAt(x, y) === '_' && !occupied(x, y) && !S.items[idx(x, y)]) { S.tiles[idx(x, y)] = 'l'; n++; } }
    say('The Dragon erupts! Lava spills across the forge!'); Sfx.play('boom'); shake(6);
  }
}
function summon(boss, t, n) {
  const alive = S.enemies.filter(e => !e.dead && e.minion).length; if (alive >= 5) return;
  for (const [x, y] of freeSpotsNear(boss.x, boss.y, 2).slice(0, n)) { S.enemies.push(makeEnemy(t, x, y, S.enemies.length + 100, { minion: true })); effect('poof', x, y, 3, 80); }
}
function teleport(e) {
  const spots = []; for (let y = 1; y < ROWS - 1; y++) for (let x = 3; x < COLS - 1; x++) if (tileAt(x, y) === '_' && !occupied(x, y) && Math.abs(x - G.fox.x) + Math.abs(y - G.fox.y) > 3) spots.push([x, y]);
  if (!spots.length) return; const [x, y] = spots[(Math.random() * spots.length) | 0];
  effect('poof', e.x, e.y, 3, 80); e.x = x; e.y = y; e.anim = null;
}
function gainXp(n, x, y) {
  const f = G.fox; f.xp += n; if (x !== undefined) floatText(x, y + 0.6, '+' + n + ' XP', '#6fe8f0');
  while (f.xp >= f.next) {
    f.xp -= f.next; f.lvl++; f.next = Math.floor(f.next * 1.35);
    f.maxHp += 10; f.atk += 2; f.hp = Math.min(f.maxHp, f.hp + 10 + Math.floor(f.maxHp * 0.3));
    G.pendingPerks++; Sfx.play('level'); say(`Level up! Fang is now level ${f.lvl}.`);
    weather.burst(tileX(f.x) + 8, tileY(f.y) + 8, 24, ['#ffd35c', '#fff2b0', '#6fe8f0'], { speed: 50, up: 30 });
  }
}
function offerPerks() {
  const owned = Object.keys(G.perks), pool = Object.keys(PERKS).filter(k => !owned.includes(k));
  if (!pool.length) { G.pendingPerks = 0; return; }
  pool.sort(() => Math.random() - 0.5);
  ui.perkChoices = pool.slice(0, 3); ui.sel = 0; ui.mode = 'perk';
}
function choosePerk(k) {
  G.perks[k] = true; G.pendingPerks--; Sfx.play('gem'); say(`Learned ${PERKS[k].name}!`);
  if (k === 'keenEyes') S.enemies.forEach(e => e.revealed = true);
  ui.mode = 'play'; save();
}

// ---------- Turns & enemies ----------
function hurtFox(amount, source) {
  const f = G.fox, b = G.buff;
  if (b.barrier > 0) { b.barrier--; floatText(f.x, f.y, 'BLOCK', '#6fe8f0'); Sfx.play('freeze'); return 0; }
  let dmg = amount; if (G.perks.thickFur) dmg = Math.max(1, dmg - 1);
  f.hp -= dmg; f.flash = 160; shake(dmg >= 10 ? 4 : 2); Sfx.play('hurt'); floatText(f.x, f.y, '-' + dmg, '#ff4f4f');
  if (f.hp <= 0) {
    if (G.perks.secondWind && !b.secondWind) { b.secondWind = true; f.hp = 1; say('Second Wind! Fang refuses to fall!'); Sfx.play('level'); }
    else { f.hp = 0; gameOver(source); }
  }
  return dmg;
}
function enemyStrike(e, counter) {
  const m = MONSTERS[e.t], f = G.fox;
  let atk = m.atk; if (m.phases) atk += (e.phase - 1) * 3;
  e.anim = { type: 'lunge', dx: Math.sign(f.x - e.x), dy: Math.sign(f.y - e.y), t: 0, d: 160 };
  const dealt = hurtFox(atk, m.name);
  if (ui.mode === 'dead') return;
  if (m.poison && dealt && !G.buff.ward) { G.buff.poison = m.poison; say(`The ${m.name} poisons you!`); }
  else if (m.sleeper && dealt && Math.random() < 0.3) { G.buff.sleep = 1; say('Dream dust... Fang grows sleepy.'); }
  else if (!counter) say(`${m.name} attacks! -${dealt}`);
}
function endTurn() {
  const f = G.fox, b = G.buff;
  G.turn++;
  const under = idx(f.x, f.y); if (S.items[under] && S.items[under] !== 'L') pickup(under, S.items[under], f.x, f.y);
  if (G.perks.regeneration && G.turn % 4 === 0 && f.hp < f.maxHp) f.hp++;
  if (b.poison > 0) { b.poison--; f.hp -= 2; f.flash = 100; floatText(f.x, f.y, '-2', '#9be06a'); if (f.hp <= 0) { f.hp = 0; return gameOver('Poison'); } }
  if (b.mushroom > 0) b.mushroom--;
  if (b.haste > 0) b.haste--;
  if (b.ward > 0) b.ward--;
  if (b.spinCd > 0) b.spinCd--;
  for (const [i, tt] of Object.entries(S.temp)) {
    if (--tt.t > 0) continue;
    S.tiles[i] = tt.orig; delete S.temp[i];
    if (tt.orig === 'u') { const x = i % COLS, y = (i / COLS) | 0; effect('poof', x, y, 3, 80); say('The path knits itself back together.'); }
  }
  // timed braziers gutter out
  if (!S.solved) for (const [i, v] of Object.entries(S.lit)) if (v > 0) { S.lit[i] = v - 1; if (S.lit[i] === 0) { delete S.lit[i]; say('A brazier gutters out!'); Sfx.play('locked'); } }
  if (G.turn % 3 === 0) S.tiles.forEach((ch, i) => {
    if (ch !== 'v') return; const x = i % COLS, y = (i / COLS) | 0;
    weather.burst(tileX(x) + 8, tileY(y) + 10, 10, ['#b0b0c4', '#eef4ff'], { up: 50, g: -20, speed: 18, life: 700 });
    if (Math.abs(x - f.x) + Math.abs(y - f.y) <= 1) hurtFox(G.perks.heatResist ? 4 : 8, 'Steam vent');
  });
  if (ui.mode === 'dead') return;
  for (const e of S.enemies) if (e.dead && !e.gone && e.reviveIn !== undefined) { if (--e.reviveIn <= 0) { if (occupied(e.x, e.y)) { e.reviveIn = 1; continue; } e.dead = false; e.hp = Math.ceil(e.max / 2); e.reviveIn = undefined; effect('poof', e.x, e.y, 3, 80); say('The skeleton pulls itself back together!'); } }
  let base = G.perks.swiftFeet ? 4 : 3; if (b.haste > 0) base *= 2;
  for (const e of S.enemies.slice()) {
    if (e.dead || ui.mode === 'dead') continue;
    const m = MONSTERS[e.t];
    let iv = m.interval ? (b.haste > 0 ? m.interval * 2 : m.interval) : base;
    if (m.boss) iv = Math.max(2, base - 1);
    if (G.turn % iv === 0) enemyAct(e);
  }
  if (fx.telegraph.length && fx.telegraph.fireOn === G.turn) breathe();
  if (G.turn % 5 === 0) save();
  if (G.pendingPerks > 0 && ui.mode === 'play') offerPerks();
}
function canEnter(e, x, y) {
  if (!inGrid(x, y)) return false;
  const ch = tileAt(x, y), m = MONSTERS[e.t];
  if (isSolid(ch) || ch === 'd' || ch === 'D') return false;
  if (ch === 'l' && !m.fireproof && e.t !== 'M' && e.t !== 'O' && e.t !== 'Q') return false;
  if (ch === 'u' && !m.flies) return false;
  if (occupied(x, y) || S.items[idx(x, y)]) return false;
  return true;
}
function enemyAct(e) {
  const m = MONSTERS[e.t], f = G.fox;
  if (e.frozen > 0) { e.frozen--; return; }
  if (m.dormant && !e.aggro) return;
  e.acts++;
  const dist = Math.abs(e.x - f.x) + Math.abs(e.y - f.y);
  if (m.camo && !e.revealed) { if (dist <= 1) { e.revealed = true; say('A tree lurches to life... a Treant!'); } else return; }
  if (m.healer) for (const [ox, oy] of DIRS) { const n = enemyAt(e.x + ox, e.y + oy); if (n && n.hp < n.max) { n.hp = Math.min(n.max, n.hp + m.healer); floatText(n.x, n.y, '+' + m.healer, '#9be06a'); } }
  if (m.spawnEvery && e.acts % m.spawnEvery === 0) { summon(e, m.summon, 1); say('The Goo King burps up a Slim!'); }
  if (m.rootsnare && dist <= 3 && e.acts % 3 === 0 && !G.perks.natureBond) { G.buff.rooted = 1; say('Rotten roots burst up and hold you fast!'); weather.burst(tileX(f.x) + 8, tileY(f.y) + 14, 10, ['#6b3a9a', '#4a2e22']); }
  if (e.t === 'Y') { for (let k = 0; k < 3; k++) { const x = e.x + ((Math.random() * 7) | 0) - 3, y = e.y + ((Math.random() * 5) | 0) - 2; if (inGrid(x, y) && tileAt(x, y) === '_' && !S.items[idx(x, y)] && !occupied(x, y)) { S.tiles[idx(x, y)] = 'i'; break; } } }
  if (m.breath && !fx.telegraph.length && (e.x === f.x || e.y === f.y) && dist <= 6 && dist > 1) {
    const dx = Math.sign(f.x - e.x), dy = Math.sign(f.y - e.y), line = [];
    for (let k = 1; k <= 6; k++) { const x = e.x + dx * k, y = e.y + dy * k; if (!inGrid(x, y) || isSolid(tileAt(x, y))) break; line.push([x, y]); }
    fx.telegraph = line; fx.telegraph.fireOn = G.turn + 1; say('The Dragon draws a deep breath... MOVE!'); Sfx.play('roar'); return;
  }
  if (dist === 1) { if (e.hitT !== G.turn) enemyStrike(e, false); return; }
  if (m.charge && (e.x === f.x || e.y === f.y) && dist <= 4) {
    const dx = Math.sign(f.x - e.x), dy = Math.sign(f.y - e.y); let x = e.x, y = e.y, ok = true;
    while (Math.abs(f.x - x) + Math.abs(f.y - y) > 1) { x += dx; y += dy; if (!canEnter(e, x, y)) { ok = false; break; } }
    if (ok) { e.anim = { type: 'move', fx: e.x, fy: e.y, t: 0, d: 150 }; e.x = x; e.y = y; say('The Frost Bear charges!'); Sfx.play('roar'); enemyStrike(e, true); return; }
  }
  const steps = m.steps || 1;
  for (let s = 0; s < steps; s++) {
    const d0 = Math.abs(e.x - f.x) + Math.abs(e.y - f.y); if (d0 <= 1) break;
    const opts = DIRS.map(([dx, dy]) => [e.x + dx, e.y + dy]).filter(([x, y]) => canEnter(e, x, y))
      .map(([x, y]) => [x, y, Math.abs(x - f.x) + Math.abs(y - f.y) + Math.random() * 0.5]).sort((a, b) => a[2] - b[2]);
    if (!opts.length) break;
    const [x, y, d] = opts[0];
    if (d > d0 && Math.random() < 0.6) break;
    const ox = e.x, oy = e.y;
    e.anim = { type: 'move', fx: s > 0 && e.anim ? e.anim.fx : ox, fy: s > 0 && e.anim ? e.anim.fy : oy, t: 0, d: 150 + s * 60 };
    e.x = x; e.y = y;
    if (m.trail) {
      const oi = idx(ox, oy);
      if (m.trail === 'i' && S.tiles[oi] === '_') S.tiles[oi] = 'i';
      if (m.trail === 'l' && S.tiles[oi] === '_') { S.tiles[oi] = 'l'; S.temp[oi] = { orig: '_', t: 5 }; }
    }
  }
}
function breathe() {
  const line = fx.telegraph; fx.telegraph = [];
  Sfx.play('boom'); shake(5);
  for (const [x, y] of line) {
    weather.burst(tileX(x) + 8, tileY(y) + 8, 8, ['#ff7a1a', '#ffd35c', '#c8332b'], { up: 30, speed: 30 });
    if (x === G.fox.x && y === G.fox.y) hurtFox(G.flags.scale ? 0 : G.perks.heatResist ? 7 : 14, 'Dragon fire');
  }
}

// ---------- Death ----------
function gameOver(source) {
  ui.mode = 'dead'; ui.anim = 0; ui.deathBy = source; Sfx.play('hurt');
  Music.play('win');
}
function respawn() {
  const f = G.fox; f.hp = f.maxHp; G.buff.poison = 0; G.buff.sleep = 0; G.buff.rooted = 0;
  // regular foes recover; bosses keep their wounds so every attempt makes progress
  for (const a of Object.values(G.areas)) for (const e of a.enemies) if (!e.gone && !MONSTERS[e.t].boss) { e.hp = e.max; if (e.dead && e.reviveIn !== undefined) { e.dead = false; e.reviveIn = undefined; } }
  const care = G.inv.fish < 3; if (care) G.inv.fish = 3;
  fx.telegraph = [];
  const key = G.areaKey, at = S.entry;
  ui.mode = 'trans'; ui.trans = { t: 0, mid: () => enterArea(key, at), done: false };
  say(care ? 'Fang shakes it off. Grandma\'s care package had 3 fish in it. Again, again... win!' : 'Fang shakes it off and tries again. Again, again... win!');
}
