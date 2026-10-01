// The web game, headless, playing a scripted run with the ROM's random numbers (xorshift32 in place of
// Math.random), so tools/bot/parity.py can play the same run on the ROM and compare every step.
// usage: node gbc/tools/parity.js [steps] [seed] [area] [perks,...] [flags,...] [level] [script]    writes gbc/build/parity/web.json
//   area, perks, flags and level set up the run (the ROM side pokes the same into memory)
//   TRACE_STEP=n prints every random number drawn during step n, with where it was drawn
//   script: actions to play first, comma separated: right, left, down, up, eat, spin, goto:<cell>
//   (steps on the shortest path until Fang stands there) or fight (until no foe is left, 80 steps at
//   most), e.g. fight,goto:30,right,right to clear the room and push a block
//   Actions come from their own seeded generator: mostly walking (a pull toward foes, cold braziers,
//   blocks and the next door), eating a fish now and then, Fire Spin when Fang knows it. The run stops
//   when a foe summons or splits (their random spots are shuffled differently on each side).
//   After each action the run settles as a player would: dialogue read to the end, a perk chosen and a
//   ware bought (by the same generator; recorded in the step as "ui" for the ROM side), story beats run.
'use strict';
const fs = require('fs'), path = require('path'), vm = require('vm');
const ROOT = path.join(__dirname, '..', '..'), OUT = path.join(__dirname, '..', 'build', 'parity');
const STEPS = +(process.argv[2] || 400), SEED = +(process.argv[3] || 1), STAY = (process.argv[4] || '').endsWith('!'), AREA = (process.argv[4] || 'home').replace('!', '');   // area! : stay there, no heading for doors
const PERKS = (process.argv[5] || '').split(',').filter(Boolean), FLAGS = (process.argv[6] || '').split(',').filter(Boolean), LEVEL = +(process.argv[7] || 1);
const SCRIPT = (process.argv[8] || '').split(',').filter(Boolean);

// ---------- the game's random numbers: the ROM's xorshift32 (src/rng.c) ----------
let rng = 0x2545F491;
const xorshift = () => { let x = rng; x ^= x << 13; x >>>= 0; x ^= x >>> 17; x ^= x << 5; x >>>= 0; rng = x; return x; };

// ---------- a browser that draws nothing ----------
const noop = new Proxy(function () {}, { get: (t, k) => (k === Symbol.toPrimitive ? () => 0 : noop), apply: () => noop, construct: () => noop });
const canvas = { width: 384, height: 240, style: {}, getContext: () => noop, addEventListener() {}, getBoundingClientRect: () => ({ left: 0, top: 0, width: 384, height: 240 }) };
const ctx = {
  console: { log: console.log, warn() {}, error: console.error }, Math: Object.create(Math), performance: { now: () => 0 }, setTimeout: () => 0, clearTimeout() {},
  document: { getElementById: () => canvas, createElement: () => canvas, addEventListener() {}, documentElement: {}, hidden: false },
  localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
  addEventListener() {}, requestAnimationFrame() {}, navigator: {}, Image: function () {},
  SPRITES: {}, Sfx: { play() {}, init() {} }, Music: { play() {}, retry() {}, muted: false, refresh() {} }, Mixer: { init() {}, apply() {}, duck() {} },
  Settings: { shake: true, flash: true, muted: false, music: 8, sfx: 8, save() {} },
};
ctx.window = ctx;
let traceStep = +(process.env.TRACE_STEP || 0), curStep = 0;
ctx.Math.random = () => { if (curStep === traceStep) console.log('draw', new Error().stack.split('\n').slice(2, 5).map(l => l.trim().replace(/\(.*js\//, '(')).join(' < ')); return xorshift() / 4294967296; };
vm.createContext(ctx);
for (const f of ['palette', 'font', 'sprites-terrain', 'sprites-props', 'sprites-chars', 'sprites-chars2', 'sprites-world2', 'data', 'render', 'game', 'story'])
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'js', f + '.js'), 'utf8').replace(/^(const|let) /gm, 'var '), ctx, { filename: `js/${f}.js` });
// the GBC's map changes (overrides.js areas), so both sides play the same maps
for (const [k, v] of Object.entries(require(path.join(__dirname, '..', 'overrides.js')).areas || {})) Object.assign(ctx.AREAS[k], v);
// the objective banner draws nothing that matters here
vm.runInContext('showObjective = function () {};', ctx);
// weather and sparkles draw random numbers the ROM has no use for
vm.runInContext('weather = { reset() {}, update() {}, burst() {}, sparks: [], drawBehind() {}, drawFront() {}, drawSparks() {} };', ctx);

// ---------- the run ----------
let aseed = SEED * 2654435761 >>> 0;
const arand = n => { aseed = (aseed * 1103515245 + 12345) >>> 0; return (aseed >>> 16) % n; };
const G = () => ctx.G, S = () => ctx.S;
vm.runInContext('newGame(); ui.mode = "play";', ctx);
// the setup: level (as if levelled normally), perks, flags, then the starting area
{ const f = ctx.G.fox; for (let l = 1; l < LEVEL; l++) { f.lvl++; f.next = Math.floor(f.next * 1.35); f.maxHp += 10; f.atk += 2; } f.hp = f.maxHp;
  for (const p of PERKS) ctx.G.perks[p] = true; for (const k of FLAGS) ctx.G.flags[k] = true;
  if (AREA !== 'home') vm.runInContext(`enterArea(${JSON.stringify(AREA)}, null)`, ctx); }
const setupFox = (({ hp, maxHp, atk, lvl, next }) => ({ hp, maxHp, atk, lvl, next }))(ctx.G.fox);
const AREA_KEYS = Object.keys(ctx.AREAS);
const names = o => Object.keys(o).filter(k => o[k]).map(k => k.replace(/[^a-z0-9]/gi, '_').toUpperCase()).sort();   // as world.h names them
// what a player does between actions: read dialogue, pick a perk, buy something, let story beats play
const settle = ui => {
  const calm = () => { G().fox.anim = null; S().enemies.forEach(e => { e.anim = null; }); };
  for (let guard = 0; guard < 100; guard++) {
    const mode = ctx.ui.mode;
    if (mode === 'talk') { vm.runInContext('advanceDialog()', ctx); continue; }
    if (mode === 'perk') { const i = arand(ctx.ui.perkChoices.length); ui.push(['perk', i]); vm.runInContext(`choosePerk(ui.perkChoices[${i}])`, ctx); continue; }
    if (mode === 'shop') { const i = arand(ctx.SHOP.length); ui.push(['shop', i]); vm.runInContext(`buy(SHOP[${i}]); ui.mode = 'play';`, ctx); continue; }
    if (mode === 'trans') { vm.runInContext('ui.trans.mid(); ui.mode = "play"; ui.trans = null;', ctx); continue; }
    if (mode !== 'play') break;
    calm();
    if (G().pendingPerks > 0) { vm.runInContext('offerPerks()', ctx); if (ctx.ui.mode !== 'play') continue; }
    if (G().story.length) { G().story[0].t = 0; vm.runInContext('runStory(0)', ctx); continue; }
    break;
  }
};
const snap = () => {
  const f = G().fox;
  return { area: AREA_KEYS.indexOf(G().areaKey), turn: G().turn, x: f.x, y: f.y, hp: f.hp, maxHp: f.maxHp, xp: f.xp, next: f.next, lvl: f.lvl, atk: f.atk,
    fish: G().inv.fish, gems: G().gems, poison: G().buff.poison, rooted: G().buff.rooted, sleep: G().buff.sleep,
    enemies: S().enemies.map(e => [e.x, e.y, e.hp, e.dead ? 1 : 0]), items: Object.keys(S().items).length,
    tiles: S().tiles.join(''), blocks: S().blocks.map(b => [b.x, b.y]), lit: Object.entries(S().lit).map(([i, v]) => [+i, v]),
    rng: rng >>> 0, keys: G().inv.key, flags: names(G().flags), perks: names(G().perks), kits: names(G().kits), story: G().story.length, pending: G().pendingPerks };
};
const DIRS = { right: [1, 0], left: [-1, 0], down: [0, 1], up: [0, -1] };
const steps = [];
let stop = 'steps';
for (let n = 0; n < STEPS; n++) {
  // pick an action: a step on the shortest path toward the nearest foe (fights, level ups, falls), a
  // cold brazier or a block (puzzles), else toward a door so the run travels, sometimes a random step;
  // eat when hurt
  let action;
  const f = G().fox, foes = S().enemies.filter(e => !e.dead), roll = arand(100), here = f.y * 14 + f.x;
  const toward = (tx, ty) => Math.abs(tx - f.x) >= Math.abs(ty - f.y) && tx !== f.x ? (tx > f.x ? 'right' : 'left') : (ty > f.y ? 'down' : 'up');
  const pass = (x, y) => { const ch = ctx.tileAt(x, y); return !ctx.isSolid(ch) && ch !== 'd' && ch !== 'D' && !ctx.blockAt(x, y); };
  const step = t => {   // breadth-first, right/left/down/up; the target itself may be anything
    const prev = new Map([[here, -1]]), q = [here];
    while (q.length && !prev.has(t)) {
      const c = q.shift(), cx = c % 14, cy = (c / 14) | 0;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = cx + dx, ny = cy + dy, n = ny * 14 + nx;
        if (nx < 0 || ny < 0 || nx >= 14 || ny >= 8 || prev.has(n) || (n !== t && !pass(nx, ny))) continue;
        prev.set(n, c); q.push(n);
      }
    }
    if (!prev.has(t) || t === here) return toward(t % 14, (t / 14) | 0);
    let c = t; while (prev.get(c) !== here) c = prev.get(c);
    return toward(c % 14, (c / 14) | 0);
  };
  const near = cells => cells.reduce((a, b) => (Math.abs(a % 14 - f.x) + Math.abs(((a / 14) | 0) - f.y) <= Math.abs(b % 14 - f.x) + Math.abs(((b / 14) | 0) - f.y) ? a : b));
  const puzzle = S().tiles.map((c, i) => (c === '*' && !S().lit[i] ? i : -1)).filter(i => i >= 0).concat(S().blocks.map(b => b.y * 14 + b.x), S().npcs.map(p => p.y * 14 + p.x));   // and friends to talk to
  while (SCRIPT.length && ((SCRIPT[0].startsWith('goto:') && here === +SCRIPT[0].slice(5)) || (SCRIPT[0] === 'fight' && (!foes.length || n >= 80)))) SCRIPT.shift();
  if (SCRIPT.length) action = SCRIPT[0].startsWith('goto:') ? step(+SCRIPT[0].slice(5)) : SCRIPT[0] === 'fight' ? step(near(foes.map(e => e.y * 14 + e.x))) : SCRIPT.shift();
  else if (f.hp < f.maxHp / 3 && G().inv.fish && arand(2)) action = 'eat';
  else if (arand(40) === 0) action = 'eat';
  else if (G().perks.fireSpin && arand(10) === 0) action = 'spin';
  else if (foes.length && roll < (STAY ? 60 : 50)) action = step(near(foes.map(e => e.y * 14 + e.x)));
  else if (puzzle.length && roll < (STAY ? 90 : 65)) action = step(near(puzzle));
  else if (roll < 85 && !STAY) { const doors = Object.keys(ctx.AREAS[G().areaKey].doors).map(Number); action = step(doors[(n >> 7) % doors.length]); }
  else action = ['right', 'left', 'down', 'up'][arand(4)];
  curStep = n + 1;
  const enemiesBefore = S().enemies.length, areaBefore = G().areaKey;
  vm.runInContext(`doAction(${JSON.stringify(action)})`, ctx);
  let died = false;
  const ui = [];
  if (ctx.ui.mode === 'dead') { died = true; vm.runInContext('respawn()', ctx); }
  settle(ui);
  steps.push(ui.length ? { action, died, ui, state: snap() } : { action, died, state: snap() });
  if (G().areaKey === areaBefore && S().enemies.length > enemiesBefore) { steps.pop(); stop = `a foe summoned or split at step ${n + 1}`; break; }
}
fs.mkdirSync(OUT, { recursive: true });
fs.writeFileSync(path.join(OUT, 'web.json'), JSON.stringify({ seed: SEED, setup: { area: AREA_KEYS.indexOf(AREA), perks: PERKS.map(p => Object.keys(ctx.PERKS).indexOf(p)), flags: FLAGS, level: LEVEL, fox: setupFox }, steps }, null, 0));
console.log(`${steps.length} steps (stopped: ${stop}); ${new Set(steps.map(s => s.state.area)).size} areas; ${steps.filter(s => s.died).length} deaths; last turn ${steps.length ? steps[steps.length - 1].state.turn : 0}`);
