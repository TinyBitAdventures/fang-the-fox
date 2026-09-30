// The web game, headless, playing a scripted run with the ROM's random numbers (xorshift32 in place of
// Math.random), so tools/bot/parity.py can play the same run on the ROM and compare every step.
// usage: node gbc/tools/parity.js [steps] [seed] [area] [perks,...] [flags,...] [level]    writes gbc/build/parity/web.json
//   area, perks, flags and level set up the run (the ROM side pokes the same into memory)
//   Actions come from their own seeded generator: mostly walking (a pull toward the next door),
//   eating a fish now and then. The run stops when a foe summons or splits (their random spots are
//   shuffled differently on each side). Perk offers are left out until phase 4.
'use strict';
const fs = require('fs'), path = require('path'), vm = require('vm');
const ROOT = path.join(__dirname, '..', '..'), OUT = path.join(__dirname, '..', 'build', 'parity');
const STEPS = +(process.argv[2] || 400), SEED = +(process.argv[3] || 1), STAY = (process.argv[4] || '').endsWith('!'), AREA = (process.argv[4] || 'home').replace('!', '');   // area! : stay there, no heading for doors
const PERKS = (process.argv[5] || '').split(',').filter(Boolean), FLAGS = (process.argv[6] || '').split(',').filter(Boolean), LEVEL = +(process.argv[7] || 1);

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
ctx.Math.random = () => xorshift() / 4294967296;
vm.createContext(ctx);
for (const f of ['palette', 'font', 'sprites-terrain', 'sprites-props', 'sprites-chars', 'sprites-chars2', 'sprites-world2', 'data', 'render', 'game', 'story'])
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'js', f + '.js'), 'utf8').replace(/^(const|let) /gm, 'var '), ctx, { filename: `js/${f}.js` });
// phase 2 has no perk pick: the web game's offer would draw random numbers the ROM does not
vm.runInContext('offerPerks = function () {}; showObjective = function () {}; queueStory = function () {};', ctx);
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
const snap = () => {
  const f = G().fox;
  return { area: AREA_KEYS.indexOf(G().areaKey), turn: G().turn, x: f.x, y: f.y, hp: f.hp, maxHp: f.maxHp, xp: f.xp, next: f.next, lvl: f.lvl, atk: f.atk,
    fish: G().inv.fish, gems: G().gems, poison: G().buff.poison, rooted: G().buff.rooted, sleep: G().buff.sleep,
    enemies: S().enemies.map(e => [e.x, e.y, e.hp, e.dead ? 1 : 0]), items: Object.keys(S().items).length };
};
const DIRS = { right: [1, 0], left: [-1, 0], down: [0, 1], up: [0, -1] };
const steps = [];
let stop = 'steps';
for (let n = 0; n < STEPS; n++) {
  // pick an action: mostly toward the nearest foe (fights, level ups, falls), else toward a door so the
  // run travels, sometimes a random step; eat when hurt
  let action;
  const f = G().fox, foes = S().enemies.filter(e => !e.dead), roll = arand(100);
  const toward = (tx, ty) => Math.abs(tx - f.x) >= Math.abs(ty - f.y) && tx !== f.x ? (tx > f.x ? 'right' : 'left') : (ty > f.y ? 'down' : 'up');
  if (f.hp < f.maxHp / 3 && G().inv.fish && arand(2)) action = 'eat';
  else if (arand(40) === 0) action = 'eat';
  else if (foes.length && roll < (STAY ? 85 : 55)) { const e = foes.reduce((a, b) => (Math.abs(a.x - f.x) + Math.abs(a.y - f.y) <= Math.abs(b.x - f.x) + Math.abs(b.y - f.y) ? a : b)); action = toward(e.x, e.y); }
  else if (roll < 85 && !STAY) { const doors = Object.keys(ctx.AREAS[G().areaKey].doors).map(Number), t = doors[(n >> 7) % doors.length]; action = toward(t % 14, (t / 14) | 0); }
  else action = ['right', 'left', 'down', 'up'][arand(4)];
  const enemiesBefore = S().enemies.length, areaBefore = G().areaKey;
  vm.runInContext(`doAction(${JSON.stringify(action === 'eat' ? 'eat' : action)})`, ctx);
  let died = false;
  if (ctx.ui.mode === 'dead') { died = true; vm.runInContext('respawn()', ctx); }
  if (ctx.ui.mode === 'trans') { vm.runInContext('ui.trans.mid(); ui.mode = "play"; ui.trans = null;', ctx); }
  steps.push({ action, died, state: snap() });
  if (G().areaKey === areaBefore && S().enemies.length > enemiesBefore) { steps.pop(); stop = `a foe summoned or split at step ${n + 1}`; break; }
}
fs.mkdirSync(OUT, { recursive: true });
fs.writeFileSync(path.join(OUT, 'web.json'), JSON.stringify({ seed: SEED, setup: { area: AREA_KEYS.indexOf(AREA), perks: PERKS.map(p => Object.keys(ctx.PERKS).indexOf(p)), flags: FLAGS, level: LEVEL, fox: setupFox }, steps }, null, 0));
console.log(`${steps.length} steps (stopped: ${stop}); ${new Set(steps.map(s => s.state.area)).size} areas; ${steps.filter(s => s.died).length} deaths; last turn ${steps.length ? steps[steps.length - 1].state.turn : 0}`);
