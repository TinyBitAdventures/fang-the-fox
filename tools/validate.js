// Reachability check for every area: doors, items, NPCs, signs and braziers must be reachable.
// usage: node tools/validate.js [area] [--gbc]      (--gbc: with the Game Boy Color edition's overrides)
const fs = require('fs'), path = require('path');
eval(fs.readFileSync(path.join(__dirname, '../js/data.js'), 'utf8') + ';global.AREAS=AREAS;global.MONSTERS=MONSTERS;global.ITEMS=ITEMS;');
const argv = process.argv.slice(2);
if (argv.includes('--gbc')) for (const [k, v] of Object.entries(require('../gbc/overrides.js').areas || {})) Object.assign(AREAS[k], v);
const COLS = 14, ROWS = 8, only = argv.find(a => !a.startsWith('--'));
// first-visit arrival tile for each area, found by walking the world graph from home
const arrival = { home: AREAS.home.map.join('').indexOf('F') }, order = ['home'];
for (const allowWhen of [false, true]) for (let k = 0; k < order.length; k++) for (const d of Object.values(AREAS[order[k]].doors)) if ((allowWhen || !d.when) && !(d.to in arrival)) {
  const T = AREAS[d.to].map.join(''); arrival[d.to] = d.spawn !== undefined ? d.spawn : (T.includes('F') ? T.indexOf('F') : 43); order.push(d.to);
}
const WALL = new Set(['T', 'r', 'b', 'n', 'y', 'w', 'p', '*', '?', '&']);
let problems = 0;
for (const [key, A] of Object.entries(AREAS)) {
  if (only && key !== only) continue;
  const flat = A.map.join('');
  if (A.map.length !== ROWS || A.map.some(r => r.length !== COLS)) { console.log(`${key}: bad dimensions`); problems++; continue; }
  const npcs = A.npcs || {}, signs = A.signs || {};
  const passable = (i, gatesOpen) => { const c = flat[i]; if (A.doors[i]) return true; if (WALL.has(c) || c === '~') return false; if ((c === '#' || c === '%') && !gatesOpen) return false; if (c === 'l') return 'lava'; return true; };
  for (const i of Object.keys(npcs)) if (flat[i] !== '&') { console.log(`${key}: npc ${i} not on '&' (${flat[i]})`); problems++; }
  for (const i of Object.keys(signs)) if (flat[i] !== '?') { console.log(`${key}: sign ${i} not on '?' (${flat[i]})`); problems++; }
  [...flat].forEach((c, i) => { if (c === '&' && !npcs[i]) { console.log(`${key}: '&' at ${i} has no npc`); problems++; } if (c === '?' && !signs[i]) { console.log(`${key}: '?' at ${i} has no sign`); problems++; } });
  for (const [i, d] of Object.entries(A.doors)) {
    if (!d.when && !'dD'.includes(flat[i])) { console.log(`${key}: door ${i} is '${flat[i]}'`); problems++; }
    if (!AREAS[d.to]) { console.log(`${key}: door ${i} -> unknown ${d.to}`); problems++; }
    else if (d.spawn !== undefined) { const T = AREAS[d.to]; if (!T.doors[d.spawn]) { console.log(`${key}: door ${i} spawns at ${d.to}:${d.spawn} which is not a door`); problems++; } }
  }
  if (!(key in arrival)) { console.log(`${key}: never reached from home`); problems++; continue; }
  const starts = [arrival[key]];
  if (!passable(starts[0], false) && !A.doors[starts[0]]) { console.log(`${key}: arrival tile ${starts[0]} is blocked`); problems++; }
  const bfs = (gatesOpen, allowLava) => {
    const seen = new Set(starts), q = [...starts];
    while (q.length) {
      const i = q.shift(), x = i % COLS, y = (i / COLS) | 0;
      if (A.doors[i] && !starts.includes(i)) continue; // stepping on a door leaves the area
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        let nx = x + dx, ny = y + dy; if (nx < 0 || ny < 0 || nx >= COLS || ny >= ROWS) continue;
        let n = ny * COLS + nx; const p = passable(n, gatesOpen); if (!p || (p === 'lava' && !allowLava)) continue;
        if (A.slide && flat[n] === 'i') { // slide until the next tile would stop us
          while (true) { const mx = nx + dx, my = ny + dy; if (mx < 0 || my < 0 || mx >= COLS || my >= ROWS) break; const m = my * COLS + mx; if (!passable(m, gatesOpen)) break; nx = mx; ny = my; n = m; if (flat[m] !== 'i' || A.doors[m]) break; }
        }
        if (!seen.has(n)) { seen.add(n); q.push(n); }
      }
    }
    return seen;
  };
  const r0 = bfs(false, false), r1 = bfs(true, false), r2 = bfs(true, true);
  const adj = (set, i) => { const x = i % COLS, y = (i / COLS) | 0; return [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => { const nx = x + dx, ny = y + dy; return nx >= 0 && ny >= 0 && nx < COLS && ny < ROWS && set.has(ny * COLS + nx); }); };
  const report = [];
  const check = (label, i, needAdj) => {
    const f = s => needAdj ? adj(s, i) : s.has(i);
    if (f(r0)) return; if (f(r1)) { report.push(`${label}@${i}: behind gate`); return; } if (f(r2)) { report.push(`${label}@${i}: needs lava walk`); return; }
    report.push(`${label}@${i}: UNREACHABLE`); problems++;
  };
  for (const i of Object.keys(A.doors)) check('door->' + A.doors[i].to, +i, false);
  [...flat].forEach((c, i) => {
    if (ITEMS[c]) check('item ' + c, i, false);
    if (c === '*') check('brazier', i, true);
    if (c === '+') check('plate', i, false);
    if (c === '#' || c === '%') check('gate', i, true);
    if (MONSTERS[c] && MONSTERS[c].boss) check('boss ' + c, i, false);
  });
  for (const i of Object.keys(npcs)) check('npc ' + npcs[i], +i, true);
  for (const i of Object.keys(signs)) check('sign', +i, true);
  // crumbling tiles are one-way: without them, everything reachable must stay connected (unless the area re-forms them)
  if (flat.includes('u') && !A.reform) {
    const all = bfs(true, true), cut = new Set(), comps = [];
    for (const i of all) {
      if (flat[i] === 'u' || A.doors[i] || cut.has(i)) continue;
      const comp = [i]; cut.add(i);
      for (let k = 0; k < comp.length; k++) { const x = comp[k] % COLS, y = (comp[k] / COLS) | 0;
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const nx = x + dx, ny = y + dy, n = ny * COLS + nx;
          if (nx >= 0 && ny >= 0 && nx < COLS && ny < ROWS && all.has(n) && flat[n] !== 'u' && !A.doors[n] && !cut.has(n)) { cut.add(n); comp.push(n); } } }
      comps.push(comp);
    }
    if (comps.length > 1) { report.push(`crumble path strands ${comps.length} regions (add reform or a way back)`); problems++; }
  }
  console.log(`${key.padEnd(18)} arrive@${starts[0]} ${report.length ? report.join(' | ') : 'ok'}`);
}
console.log(problems ? `${problems} PROBLEMS` : 'all reachable');
process.exitCode = problems ? 1 : 0;
