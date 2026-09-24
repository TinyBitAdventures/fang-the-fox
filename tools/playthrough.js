// usage: PW=/path/to/node_modules/playwright [GOD=1] node tools/playthrough.js   (plays the whole story with a pathfinding bot)
// Plays the whole story with a pathfinding bot. GOD=1 keeps Fang topped up (tests flow, not balance).
const { chromium } = require(process.env.PW);
(async () => {
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 1536, height: 960 }, ignoreHTTPSErrors: true });
  const errs = []; p.on('pageerror', e => errs.push('PAGEERROR ' + e.message + ' ' + (e.stack || '').split('\n')[1]));
  await p.goto(process.env.URL || 'https://fangthefox.localhost/pixel/'); await p.evaluate(() => localStorage.clear()); await p.reload(); await p.waitForTimeout(800);
  await p.keyboard.press('x'); await p.keyboard.press('Enter'); await p.waitForTimeout(300);
  const result = await p.evaluate(async (GOD) => {
    const log = [], wait = ms => new Promise(r => setTimeout(r, ms));
    let steps = 0, deaths = 0, maxSteps = 20000; const minHp = {}; let fishEaten = 0;
    const settle = async () => {
      for (let k = 0; k < 400; k++) {
        if (G.fox.anim) G.fox.anim.t = 1e9; S.enemies.forEach(e => { if (e.anim) e.anim.t = 1e9; }); S.blocks.forEach(b => { if (b.anim) b.anim.t = 1e9; });
        if (GOD) { G.fox.hp = G.fox.maxHp; G.buff.sleep = 0; }
        if (ui.mode === 'talk') { advanceDialog(); advanceDialog(); continue; }
        if (ui.mode === 'perk') { choosePerk(ui.perkChoices.includes('pathfinder') ? 'pathfinder' : ui.perkChoices[0]); continue; }
        if (ui.mode === 'shop') { ui.mode = 'play'; continue; }
        if (ui.mode === 'dead') { deaths++; log.push(`DIED in ${G.areaKey} to ${ui.deathBy} (lvl ${G.fox.lvl}, fish ${G.inv.fish})`); respawn(); continue; }
        if (ui.mode === 'trans') { if (!ui.trans.done) { ui.trans.done = true; ui.trans.mid(); } ui.mode = 'play'; continue; }
        if (ui.mode === 'credits') return 'credits';
        if (ui.mode === 'play' && !(pendingTimers > 0) && !G.story.length) return;
        await wait(50);
      }
    };
    // count live timers (fast-forwarded to 30ms); a cleared timer never fires, so it must stop counting too
    const live = new Set(), st = window.setTimeout, ct = window.clearTimeout; let pendingTimers = 0;
    window.setTimeout = (fn, ms) => { const id = st(() => { live.delete(id); pendingTimers = live.size; fn(); }, Math.min(ms, 30)); live.add(id); pendingTimers = live.size; return id; };
    window.clearTimeout = id => { live.delete(id); pendingTimers = live.size; ct(id); };
    const DIRV = { right: [1, 0], left: [-1, 0], down: [0, 1], up: [0, -1] };
    // predicted landing tile for a move (mirrors ice rules)
    function land(x, y, dx, dy) {
      let nx = x + dx, ny = y + dy; if (!inGrid(nx, ny)) return null;
      const ch = tileAt(nx, ny);
      if (isSolid(ch) || npcAt(nx, ny)) return null;
      if (blockAt(nx, ny)) return null;
      if ((ch === 'd' || ch === 'D')) return { x: nx, y: ny, door: true };
      if (ch === 'i' && !G.flags.cloak && !S.items[idx(nx, ny)]) {
        const slide = AREAS[G.areaKey].slide;
        while (true) { const mx = nx + dx, my = ny + dy; if (!inGrid(mx, my)) break; const m = tileAt(mx, my); if (m === 'd' || m === 'D') { if (slide) return { x: mx, y: my, door: true }; break; } if (isSolid(m) || npcAt(mx, my) || blockAt(mx, my) || S.items[idx(mx, my)]) break; nx = mx; ny = my; if (!slide || m !== 'i') break; }
      }
      return { x: nx, y: ny };
    }
    // BFS to a goal predicate; returns first direction
    function route(goal, avoidLava = true) {
      const start = idx(G.fox.x, G.fox.y), prev = new Map([[start, null]]), q = [start];
      while (q.length) {
        const i = q.shift(), x = i % COLS, y = (i / COLS) | 0;
        if (i !== start && goal(x, y)) { let c = i, d = null; while (prev.get(c)) { d = prev.get(c).dir; if (prev.get(c).from === start) break; c = prev.get(c).from; } return d; }
        for (const [dir, [dx, dy]] of Object.entries(DIRV)) {
          const L = land(x, y, dx, dy); if (!L) continue; const n = idx(L.x, L.y);
          if (L.door && !goal(L.x, L.y)) continue;
          if (avoidLava && tileAt(L.x, L.y) === 'l' && !G.flags.scale) continue;
          if (tileAt(L.x, L.y) === 'u' && !goal(L.x, L.y) && false) continue;
          if (!prev.has(n)) { prev.set(n, { from: i, dir }); q.push(n); }
        }
      }
      return null;
    }
    async function step(dir) {
      if (!GOD && G.fox.hp < G.fox.maxHp * 0.45 && G.inv.fish > 0) { eatFish(); fishEaten++; steps++; await settle(); }
      if (!GOD && G.inv.fish < 3 && G.gems >= 1 && Math.random() < 0.05) { G.gems--; G.inv.fish += 5; } // shopping trip, roughly
      doAction(dir); steps++;
      const r0 = G.fox.hp / G.fox.maxHp; minHp[G.areaKey] = Math.min(minHp[G.areaKey] ?? 1, r0); const r = await settle(); if (steps > maxSteps) throw new Error('too many steps'); return r; }
    async function walkTo(goal, label) {
      for (let k = 0; k < 400; k++) {
        if (goal(G.fox.x, G.fox.y, true)) return true;
        let dir = route(goal) || route(goal, false);
        if (!dir) throw new Error(`no path in ${G.areaKey} to ${label} from ${G.fox.x},${G.fox.y}`);
        const [dx, dy] = DIRV[dir]; const e = enemyAt(G.fox.x + dx, G.fox.y + dy);
        const before = G.areaKey;
        await step(dir);
        if (G.areaKey !== before) return 'moved';
      }
      throw new Error('walk loop ' + label);
    }
    // interact with a tile by bumping it from a neighbour
    async function bumpTile(tx, ty, label) {
      const adj = (x, y) => Math.abs(x - tx) + Math.abs(y - ty) === 1;
      if (!adj(G.fox.x, G.fox.y)) await walkTo((x, y) => adj(x, y), label);
      const dir = Object.entries(DIRV).find(([d, [dx, dy]]) => G.fox.x + dx === tx && G.fox.y + dy === ty)[0];
      await step(dir);
    }
    // travel across areas via the door graph
    async function goArea(target) {
      for (let hop = 0; hop < 30 && G.areaKey !== target; hop++) {
        const prev = { [G.areaKey]: null }, q = [G.areaKey];
        while (q.length) { const a = q.shift(); for (const [i, d] of Object.entries(AREAS[a].doors)) { if (d.when && !G.flags[d.when]) continue; if (d.req && !flagFor(d.req)) continue; if (!(d.to in prev)) { prev[d.to] = { a, i: +i }; q.push(d.to); } } }
        if (!(target in prev)) throw new Error('no route to ' + target + ' from ' + G.areaKey);
        let c = target; while (prev[c].a !== G.areaKey) c = prev[c].a;
        const di = prev[c].i, dx = di % COLS, dy = (di / COLS) | 0;
        // puzzle gates in the way? solve them
        if (!route((x, y) => x === dx && y === dy) && !route((x, y) => x === dx && y === dy, false)) await solvePuzzle();
        await walkTo((x, y) => x === dx && y === dy, 'door to ' + c);
        await settle();
      }
      log.push(`reached ${target} (lvl ${G.fox.lvl}, step ${steps})`);
    }
    async function solvePuzzle() {
      if (S.solved) return;
      const plates = S.tiles.map((c, i) => c === '+' ? i : -1).filter(i => i >= 0);
      if (plates.length) { // this world's block puzzles: push each block straight right onto its plate
        for (const b of S.blocks.slice()) {
          for (let k = 0; k < 60 && S.tiles[idx(b.x, b.y)] !== '+'; k++) {
            await walkTo((x, y) => x === b.x - 1 && y === b.y, 'behind block');
            const bx = b.x; await step('right');
            if (b.x === bx) { // something is in the way: deal with the nearest enemy
              const foe = S.enemies.filter(e => !e.dead).sort((a, c) => (Math.abs(a.x - b.x) + Math.abs(a.y - b.y)) - (Math.abs(c.x - b.x) + Math.abs(c.y - b.y)))[0];
              if (foe) { await walkTo((x, y) => Math.abs(x - foe.x) + Math.abs(y - foe.y) === 1, 'foe'); const d = Object.entries(DIRV).find(([d, [dx, dy]]) => G.fox.x + dx === foe.x && G.fox.y + dy === foe.y); if (d) await step(d[0]); }
            }
          }
        }
      }
      const braz = S.tiles.map((c, i) => c === '*' ? i : -1).filter(i => i >= 0);
      for (let attempt = 0; attempt < 4 && !S.solved; attempt++) for (const i of braz) if (!S.lit[i] && !S.solved) await bumpTile(i % COLS, (i / COLS) | 0, 'brazier');
      log.push(`puzzle in ${G.areaKey}: solved=${S.solved}`);
      if (!S.solved) throw new Error('puzzle unsolved in ' + G.areaKey);
    }
    async function talk(id) { const n = S.npcs.find(n => n.id === id); await bumpTile(n.x, n.y, id); await settle(); }
    async function killBoss() {
      for (let k = 0; k < 600; k++) { const bz = S.enemies.find(e => !e.dead && MONSTERS[e.t].boss); if (!bz) break; await walkTo((x, y) => Math.abs(x - bz.x) + Math.abs(y - bz.y) === 1, 'boss'); const dir = Object.entries(DIRV).find(([d, [dx, dy]]) => G.fox.x + dx === bz.x && G.fox.y + dy === bz.y)[0]; await step(dir); }
      await settle(); log.push(`boss down in ${G.areaKey} (lvl ${G.fox.lvl}) drops=${JSON.stringify(Object.entries(S.items).filter(([i, it]) => it.length > 1 || '56'.includes(it)))}`);
    }
    async function collect(pred, label) {
      for (let k = 0; k < 20; k++) { const e = Object.entries(S.items).find(([i, it]) => pred(it)); if (!e) return; const i = +e[0]; await walkTo((x, y) => idx(x, y) === i, label); await settle(); }
    }
    async function rescue(kit) { if (S.npcs.find(n => n.id === kit)) { await talk(kit); log.push('rescued ' + kit); } }
    try {
      await settle();
      await talk('grandma');
      await goArea('fox_hole'); await goArea('slime_pond'); await rescue('kit1');
      await goArea('goo_grotto'); await killBoss(); await collect(it => ITEMS[it].ember, 'ember');
      await goArea('lake_tower'); await talk('hoot');
      await goArea('dark_woods'); await goArea('hollow_path'); await solvePuzzle(); await rescue('kit2');
      await goArea('crystal_depths'); await solvePuzzle(); await rescue('kit3'); await collect(it => it === '9', 'crystal key');
      await goArea('ancient_ruins'); await killBoss(); await collect(it => ITEMS[it].ember, 'ember');
      await goArea('elemental_portal'); await talk('lumen');
      await goArea('ice_caves'); await rescue('kit4');
      await goArea('frozen_throne'); await killBoss(); await collect(it => ITEMS[it].ember || it === '5', 'ember+cloak');
      await goArea('lava_bridges'); await solvePuzzle();
      await goArea('dragons_forge'); await killBoss(); await collect(it => ITEMS[it].ember || it === '6', 'ember+scale');
      await goArea('fairy_glade'); await talk('queen'); await rescue('kit5');
      await goArea('world_tree'); await killBoss(); await collect(it => ITEMS[it].ember, 'ember');
      log.push('embers before home: ' + EMBERS.filter(k => G.embers[k]).join(','));
      await goArea('home'); await talk('grandma'); await settle(); await talk('grandma'); await settle();
      log.push('hearth=' + !!G.flags.hearth + ' embers=' + EMBERS.filter(k => G.embers[k]).length);
      await goArea('dreamspace'); await goArea('the_void'); await solvePuzzle();
      await goArea('void_heart'); await killBoss();
      for (let k = 0; k < 40 && ui.mode !== 'credits'; k++) { await wait(60); await settle(); }
      log.push('ENDING mode=' + ui.mode);
    } catch (e) { log.push('ERROR: ' + e.message); }
    return { log, minHp: Object.entries(minHp).map(([k, v]) => k + ':' + Math.round(v * 100)).join(' '), fishEaten, steps, deaths, lvl: G.fox.lvl, atk: G.fox.atk, hp: G.fox.maxHp, kills: G.kills, turn: G.turn, gems: G.gems, kits: Object.keys(G.kits).length, relics: Object.keys(G.relics).length, flags: Object.keys(G.flags).filter(k => G.flags[k]).join(',') };
  }, !!process.env.GOD);
  console.log(result.log.join('\n'));
  delete result.log; console.log(JSON.stringify(result));
  console.log(errs.slice(0, 8).join('\n') || 'no page errors');
  await b.close();
})();
