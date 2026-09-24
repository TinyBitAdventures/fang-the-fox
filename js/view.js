// Fang the Fox — rendering, HUD, menus, input and the main loop.

function lerp(a, b, t) { return a + (b - a) * t; }
function easeOut(t) { return 1 - (1 - t) * (1 - t); }
function entityPos(ent, t) { // pixel anchor (bottom-centre) with animation offsets
  let x = tileX(ent.x) + 8, y = tileY(ent.y) + 16, lift = 0;
  const a = ent.anim;
  if (a && a.t < a.d) {
    const k = a.t / a.d;
    if (a.type === 'hop' || a.type === 'move' || a.fx !== undefined && !a.type) { const e2 = easeOut(k); x = lerp(tileX(a.fx) + 8, x, e2); y = lerp(tileY(a.fy) + 16, y, e2); lift = a.type === 'hop' ? Math.sin(k * Math.PI) * 4 : a.type === 'move' ? Math.sin(k * Math.PI) * 2 : 0; }
    else if (a.type === 'lunge') { const p = Math.sin(k * Math.PI) * 6; x += a.dx * p; y += a.dy * p; }
    else if (a.type === 'bump') { x += Math.sin(k * Math.PI * 4) * 2; }
  }
  return [Math.round(x), Math.round(y), Math.round(lift)];
}
function drawShadow(x, y, w) {
  ctx.fillStyle = 'rgba(0,0,8,0.4)';
  ctx.fillRect(x - (w >> 1) + 1, y - 1, w - 2, 1); ctx.fillRect(x - (w >> 1), y, w, 1); ctx.fillRect(x - (w >> 1) + 1, y + 1, w - 2, 1);
}
function doorStyle(i) {
  const d = AREAS[G.areaKey].doors[i], ch = S.tiles[i];
  if (ch === 'D' && !G.perks.pathfinder) return 'secretdoor';
  return d ? d.style : 'hole';
}
const NPC_SPR = { grandma: 'grandma', hoot: 'hoot', rudy: 'rudy', lumen: 'lumen', queen: 'queen' };
function npcHasNews(id) {
  const f = G.flags;
  if (id === 'grandma') return !f.metGrandma || KITS.some(k => G.kits[k] && !f['kitThanks_' + k]) || (EMBERS.every(k => G.embers[k]) && !f.hearth);
  if (id === 'hoot') { const n = Object.keys(G.relics).length; return !f.metHoot || [5, 10, 15].some(a => n >= a && !f['hoot' + a]) || (n >= TOTAL_RELICS && !f.crest); }
  if (id === 'lumen') return !f.metLumen;
  if (id === 'queen') return !f.metQueen;
  if (KIT_INFO[id]) return !G.kits[id];
  return false;
}

function drawWorld(t, lights) {
  const A = AREAS[G.areaKey], B = BIOMES[A.biome];
  const sky = buildSky(A.biome); ctx.drawImage(sky.c, 0, 0);
  for (const [sx, sy, b] of sky.stars) if (b > 0.7 && Math.sin(t / 700 + sx) > 0.6) { ctx.fillStyle = '#ffffff'; ctx.fillRect(sx, sy, 1, 1); }
  if (B.aurora) drawAurora(t);
  if (B.clouds) {
    const far = buildClouds(A.biome + 'far', shade(B.clouds, -0.2), 'cf' + A.biome, 56, 14, 0.5), near = buildClouds(A.biome + 'near', B.clouds, 'cn' + A.biome, 64, 12, 0.55);
    const o1 = (t / 260) % 768, o2 = (t / 120) % 768;
    ctx.drawImage(far, -o1, 0); ctx.drawImage(far, 768 - o1, 0);
    ctx.drawImage(near, -o2, 20); ctx.drawImage(near, 768 - o2, 20);
  }
  const hz = buildHorizon(A.biome); ctx.drawImage(hz.c, 0, 0); lights.push(...hz.lights);
  if (B.moon) lights.push([58, 34, B.moon === 'dim' ? 18 : 26, 'none', 1]);
  if (B.redmoon) lights.push([300, 70, 30, 'red', 1]);
  for (const [name, px, py] of (A.backdrop || [])) drawSpr(ctx, name, px, py, { lights });
  const isle = buildIsland(G.areaKey);
  ctx.drawImage(isle.c, 0, 0); lights.push(...isle.lights);
  if (B.falls) for (const fxp of [70, 314]) {
    const top = IFRONT + 1;
    for (let y = top; y < H; y++) for (let k = 0; k < 4; k++) { const v = ((y - Math.floor(t / 18) + k * 5 + (k & 1) * 3) % 9 + 9) % 9; ctx.fillStyle = v < 1 ? '#eef4ff' : v < 3 ? '#a8c6f0' : v < 6 ? '#4a6aa8' : '#3f4f8a'; ctx.fillRect(fxp - 1 + k, y, 1, 1); }
    ctx.fillStyle = '#dfe8ff'; ctx.fillRect(fxp - 2, top - 1, 6, 1);
    lights.push([fxp + 1, top + 20, 10, 'cool', 1]);
  }
  // flat tiles
  const frame3 = Math.floor(t / 260) % 3;
  S.tiles.forEach((ch, i) => {
    const x = tileX(i % COLS), y = tileY((i / COLS) | 0);
    if (ch === 'w') ctx.drawImage(spr('water_' + frame3).c, x, y);
    else if (ch === 'l') { ctx.drawImage(spr('lava_' + frame3).c, x, y); lights.push([x + 8, y + 8, 12, 'red']); }
    else if (ch === '~') ctx.drawImage(spr('void_' + (Math.floor(t / 400) + i) % 3).c, x, y);
    else if (ch === '=') ctx.drawImage(spr('bridge').c, x, y);
    else if (ch === 'u') ctx.drawImage(spr('crumble').c, x, y);
    else if (ch === '+') { const on = S.blocks.some(b => b.x === i % COLS && b.y === ((i / COLS) | 0)); ctx.drawImage(spr(on ? 'plate_on' : 'plate').c, x, y); lights.push([x + 8, y + 9, on ? 8 : 6, on ? 'cool' : 'none', 1]); }
    else if (ch === 'i') ctx.drawImage(spr('ice').c, x, y);
    else if (ch === 'x') ctx.drawImage(spr('snowdrift').c, x, y);
    else if (ch === 'e') ctx.drawImage(spr('vines').c, x, y);
    else if (ch === 'v') { const puff = (G.turn % 3 === 2); ctx.drawImage(spr(puff ? 'vent_1' : 'vent_0').c, x, y); lights.push([x + 8, y + 10, puff ? 7 : 4, 'red']); }
    else if (ch === 'd' || ch === 'D') { const st = doorStyle(i); if (st === 'hole') ctx.drawImage(spr('hole').c, x, y); if (st === 'rift') { ctx.drawImage(spr('rift').c, x, y); lights.push([x + 8, y + 9, 12, 'purple']); } }
  });
  if (fx.telegraph.length && Math.floor(t / 120) % 2) { ctx.fillStyle = '#c8332b'; for (const [x, y] of fx.telegraph) { const X = tileX(x), Y = tileY(y); for (let yy = 0; yy < 16; yy++) for (let xx = 0; xx < 16; xx++) if ((xx + yy) % 3 === 0) ctx.fillRect(X + xx, Y + yy, 1, 1); } }
  // sortable drawables
  const list = [];
  for (const [name, px, py0] of (A.props || [])) {
    const py = py0 + (GY - 60);
    let base = name;
    if (name === 'campfire') base = 'campfire_' + (Math.floor(t / 120) % 3);
    if (name === 'hearth') base = G.flags.hearth ? 'hearth_on_' + (Math.floor(t / 120) % 3) : 'hearth_off';
    list.push({ y: py - 0.5, draw: () => drawSpr(ctx, base, px, py, { lights }) });
    if ((name === 'campfire' || (name === 'hearth' && G.flags.hearth)) && Math.random() < 0.12) weather.sparks.push({ x: px + (Math.random() * 8 - 4), y: py - 14, vx: (Math.random() - 0.5) * 8, vy: -20 - Math.random() * 20, g: -5, t: 0, life: 900, c: Math.random() < 0.5 ? '#ffd35c' : '#ff7a1a' });
  }
  S.tiles.forEach((ch, i) => {
    const gx = i % COLS, gy = (i / COLS) | 0, x = tileX(gx) + 8, y = tileY(gy) + 16;
    let name = null;
    if (ch === 'T') { name = B.tree; if (A.biome === 'woods' || A.biome === 'night' || A.biome === 'lake' || A.biome === 'pond') name = hash2(gx, gy) < 0.5 ? 'tree' : 'tree_b'; if (A.biome === 'enchanted') name = hash2(gx, gy) < 0.6 ? 'tree_magic' : 'tree'; if (A.biome === 'volcanic') name = 'tree_dead'; if (A.biome === 'grotto' || A.biome === 'burrow') name = hash2(gx, gy) < 0.5 ? 'tree_b' : 'tree'; }
    else if (ch === '*') { const v = S.lit[i]; name = v ? 'brazier_on_' + (Math.floor(t / 120 + i) % 3) : 'brazier_off'; if (v > 0 && v <= 3 && Math.floor(t / 150) % 2) name = 'brazier_off'; }
    else if (TERRAIN[ch] && TERRAIN[ch].spr) name = TERRAIN[ch].spr;
    else if (ch === 'd' || ch === 'D') { const st = doorStyle(i), d = A.doors[i]; if (st === 'arch' || st === 'secretdoor') name = st; else if (st === 'portal') name = 'portal_' + (Math.floor(t / 140) % 3); if (d && d.req === 'gooking' && !G.flags.gooking) name = 'gate_goo'; }
    else if (ch === 'p') name = 'portal_' + (Math.floor(t / 140) % 3);
    if (!name) return;
    // a tall obstacle must never hide the doorway above it: trim it to its own tile
    const above = gy > 0 ? S.tiles[i - COLS] : '';
    if (spr(name).h > 18 && (above === 'd' || above === 'D') && !'dD'.includes(ch)) {
      list.push({ y, draw: () => { ctx.save(); ctx.beginPath(); ctx.rect(x - 12, tileY(gy) - 2, 24, 20); ctx.clip(); drawSpr(ctx, name, x, y, { lights }); ctx.restore(); } });
    } else list.push({ y, draw: () => drawSpr(ctx, name, x, y, { lights }) });
  });
  for (const b of S.blocks) {
    let x = tileX(b.x) + 8, y = tileY(b.y) + 16;
    if (b.anim && b.anim.t < b.anim.d) { const k = easeOut(b.anim.t / b.anim.d); x = Math.round(lerp(tileX(b.anim.fx) + 8, x, k)); y = Math.round(lerp(tileY(b.anim.fy) + 16, y, k)); }
    list.push({ y, draw: () => { drawShadow(x, y - 1, 12); drawSpr(ctx, A.biome === 'frozen' ? 'block_ice' : 'block', x, y, { lights }); } });
  }
  for (const [i, it] of Object.entries(S.items)) {
    const gx = i % COLS, gy = (i / COLS) | 0; if (hiddenAt(gx, gy)) continue;
    const x = tileX(gx) + 8, y = tileY(gy) + 16, bob = (it === 'C' || it === 'L') ? 0 : Math.round(Math.sin(t / 300 + +i) * 1);
    list.push({ y: y - 0.2, draw: () => { drawShadow(x, y - 2, 8); drawSpr(ctx, ITEMS[it].spr, x, y + bob - 1, { lights }); } });
    lights.push([x, y - 7, ITEMS[it].ember ? 14 : 9, ITEMS[it].ember ? 'warm' : 'none', 1]);
    if ((it === 'a' || ITEMS[it].ember) && Math.random() < 0.06) weather.sparks.push({ x: x + (Math.random() * 12 - 6), y: y - 6 - Math.random() * 8, vx: 0, vy: -6, g: 0, t: 0, life: 500, c: '#fff2b0' });
  }
  for (const n of S.npcs) {
    const x = tileX(n.x) + 8, y = tileY(n.y) + 16, base = KIT_INFO[n.id] ? 'kit' : NPC_SPR[n.id];
    list.push({ y: y + 0.1, draw: () => {
      drawShadow(x, y - 1, 10);
      drawSpr(ctx, frame(base, 2, t, 600, n.home * 91), x, y + (n.id === 'lumen' ? Math.round(Math.sin(t / 400) * 1.5) - 1 : 0), { flip: G.fox.x < n.x, lights });
      if (npcHasNews(n.id)) { const by = y - spr(base + '_0').h - 6 + Math.round(Math.sin(t / 250) * 1.5); ctx.fillStyle = '#0b0d1a'; ctx.fillRect(x - 2, by - 1, 5, 9); ctx.fillStyle = '#ffd35c'; ctx.fillRect(x - 1, by, 3, 5); ctx.fillRect(x - 1, by + 6, 3, 1); }
    } });
    lights.push([x, y - 8, 12, 'none', 1]);
  }
  for (const e of S.enemies) {
    if (e.dead || hiddenAt(e.x, e.y)) continue;
    const m = MONSTERS[e.t];
    const [x, y, lift] = entityPos(e, t);
    if (!(m.camo && !e.revealed)) lights.push([x, y - 7, m.boss ? 16 : 10, 'none', 1]); // foes carry a faint pool so they read in the dark
    list.push({ y: y + 0.1, draw: () => {
      if (m.camo && !e.revealed) { drawSpr(ctx, 'tree_magic', x, y, { lights }); return; }
      const s = spr(m.spr + '_0'), bob = m.flies ? Math.round(Math.sin(t / 260 + e.id) * 1.5) - 1 : 0;
      drawShadow(x, y - 1, Math.min(16, Math.max(8, s.w - 4)));
      const fr = e.frozen > 0 ? m.spr + '_0' : frame(m.spr, 2, t, m.spr === 'bat' ? 160 : 480, e.id * 137);
      const at = drawSpr(ctx, fr, x, y - lift + bob, { flip: G.fox.x < e.x, lights, white: e.flash > 0 && Math.floor(e.flash / 40) % 2 === 0 });
      if (B.dark >= 0.58) fx.rims.push([fr, G.fox.x < e.x, at.x - 1, at.y - 1]);
      if (e.frozen > 0) drawSpr(ctx, 'freeze', x, y);
      if (e.hp < e.max && !m.boss) { const w = 12, fw = Math.max(1, Math.round(w * e.hp / e.max)); ctx.fillStyle = '#0b0d1a'; ctx.fillRect(x - 7, y - s.h - 4 + bob, w + 2, 3); ctx.fillStyle = '#c8332b'; ctx.fillRect(x - 6, y - s.h - 3 + bob, fw, 1); }
    } });
  }
  for (const e of S.enemies) if (e.dead && !e.gone && e.reviveIn !== undefined) { const x = tileX(e.x) + 8, y = tileY(e.y) + 16; list.push({ y, draw: () => { ctx.fillStyle = '#b0b0c4'; ctx.fillRect(x - 4, y - 3, 3, 1); ctx.fillRect(x + 1, y - 2, 4, 1); ctx.fillRect(x - 1, y - 4, 2, 2); } }); }
  const f = G.fox; const [x, y, lift] = entityPos(f, t);
  list.push({ y: y + 0.2, draw: () => {
    drawShadow(x, y - 1, 10);
    let name = frame('fox', 2, t, 520);
    if (f.anim && f.anim.t < f.anim.d) name = f.anim.type === 'lunge' ? 'fox_attack' : f.anim.type === 'hop' ? 'fox_hop' : name;
    drawSpr(ctx, name, x, y - lift, { flip: f.dir < 0, white: f.flash > 0 && Math.floor(f.flash / 40) % 2 === 0 });
    if (G.buff.sleep > 0) drawSpr(ctx, 'zzz', x + 8, y - 14 - Math.floor(t / 300) % 3);
    if (G.buff.barrier > 0 && Math.floor(t / 200) % 2) { ctx.fillStyle = '#6fe8f0'; ctx.fillRect(x - 8, y - 17, 1, 1); ctx.fillRect(x + 7, y - 17, 1, 1); ctx.fillRect(x - 8, y - 1, 1, 1); ctx.fillRect(x + 7, y - 1, 1, 1); }
  } });
  lights.push([x, y - 8, G.buff.mushroom > 0 ? 38 : A.biome === 'void' ? 40 : 32, 'warm']);
  list.sort((a, b) => a.y - b.y).forEach(d => d.draw());
  if (!G.perks.keenEyes && !G.buff.trueSight) S.tiles.forEach((ch, i) => { if (ch === 'o') { const x = tileX(i % COLS), y = tileY((i / COLS) | 0), o = Math.round(Math.sin(t / 900 + i) * 2); ctx.drawImage(spr('fog').c, x + o, y); ctx.drawImage(spr('fog').c, x - o, y - 3); } });
  weather.drawBehind(ctx, t, lights);
}
function drawAurora(t) {
  const cols = ['#1fa0b0', '#4fb04a', '#9be06a'];
  for (let x = 0; x < W; x++) {
    const base = 30 + Math.sin(x * 0.025 + t / 2200) * 10 + Math.sin(x * 0.07 + t / 1300) * 4;
    for (let k = 0; k < 26; k++) { const dens = (1 - k / 26) * 0.55 * (0.6 + 0.4 * Math.sin(x * 0.05 + t / 900)); if (bayer(x, k) < dens) { ctx.fillStyle = cols[Math.min(2, (k / 9) | 0)]; ctx.fillRect(x, Math.round(base + k), 1, 1); } }
  }
}
function drawEffects(dt) {
  for (const e of fx.effects) { e.t += dt; const fr = Math.floor(e.t / e.ms); if (fr < e.frames) drawSpr(ctx, e.name + '_' + fr, e.x, e.y); }
  fx.effects = fx.effects.filter(e => e.t < e.ms * e.frames);
  for (const f of fx.floats) { f.t += dt; drawText(ctx, f.text, f.x, f.y - Math.min(14, f.t / 40), f.color, { align: 'center' }); }
  fx.floats = fx.floats.filter(f => f.t < 800);
}

// Pulsing arrows on every exit so doorways are never missed.
function drawDoorMarkers(t) {
  const A = AREAS[G.areaKey], bob = Math.floor(t / 300) % 2;
  S.tiles.forEach((ch, i) => {
    if (ch !== 'd' && ch !== 'D') return;
    const d = A.doors[i]; if (!d) return;
    const gx = i % COLS, gy = (i / COLS) | 0, cx = tileX(gx) + 8, cy = tileY(gy) + 8;
    const open = !d.req || flagFor(d.req);
    const col = open ? (d.style === 'portal' || d.style === 'rift' ? '#d8a0ff' : '#ffd35c') : '#76768a';
    // point out of the island when on an edge, otherwise hover above
    let dir = gx === 0 ? 'l' : gx === COLS - 1 ? 'r' : gy === 0 ? 'u' : gy === ROWS - 1 ? 'd' : 'o';
    const px = (x, y) => { ctx.fillStyle = '#0b0d1a'; ctx.fillRect(x - 1, y - 1, 3, 3); };
    const pts = [];
    if (dir === 'l') { const x = tileX(gx) - 3 - bob; pts.push([x, cy], [x + 1, cy - 1], [x + 1, cy + 1], [x + 2, cy - 2], [x + 2, cy + 2]); }
    else if (dir === 'r') { const x = tileX(gx) + 18 + bob; pts.push([x, cy], [x - 1, cy - 1], [x - 1, cy + 1], [x - 2, cy - 2], [x - 2, cy + 2]); }
    else if (dir === 'u') { const y = tileY(gy) - 3 - bob; pts.push([cx, y], [cx - 1, y + 1], [cx + 1, y + 1], [cx - 2, y + 2], [cx + 2, y + 2]); }
    else { const y = tileY(gy) - (dir === 'd' ? -18 - bob : 6 + bob); const s = dir === 'd' ? -1 : 1; pts.push([cx, y + 2 * s], [cx - 1, y + s], [cx + 1, y + s], [cx - 2, y], [cx + 2, y]); }
    pts.forEach(([x, y]) => px(x, y));
    ctx.fillStyle = col; pts.forEach(([x, y]) => ctx.fillRect(x, y, 1, 1));
  });
}

// ---------- HUD ----------
function bar(x, y, w, h, pct, col, bg = '#1b1f3a') {
  ctx.fillStyle = '#0b0d1a'; ctx.fillRect(x - 1, y - 1, w + 2, h + 2);
  ctx.fillStyle = bg; ctx.fillRect(x, y, w, h);
  const fw = Math.round(w * Math.max(0, Math.min(1, pct)));
  ctx.fillStyle = col; ctx.fillRect(x, y, fw, h);
  ctx.fillStyle = shade(col, 0.35); ctx.fillRect(x, y, fw, 1);
}
function icon(name, x, y, alpha) { if (alpha !== undefined) ctx.globalAlpha = alpha; ctx.drawImage(spr(name).c, x, y); ctx.globalAlpha = 1; }
const EMBER_COLORS = { ember_forest: '#9be06a', ember_stone: '#ffd35c', ember_frost: '#6fe8f0', ember_flame: '#ff7a1a', ember_life: '#ff6fb0' };
function drawHUD(t, dt) {
  const f = G.fox, b = G.buff;
  ditherRect(ctx, 0, 0, W, 12, '#0b0d1a', 0.6);
  icon('ico_heart', 3, 3);
  const low = f.hp <= f.maxHp * 0.3 && Math.floor(t / 300) % 2;
  bar(13, 4, 44, 5, f.hp / f.maxHp, low ? '#ff4fa0' : '#c8332b');
  drawText(ctx, `${Math.max(0, f.hp)}/${f.maxHp}`, 61, 4, '#eef4ff');
  icon('ico_sword', 96, 3); drawText(ctx, String(f.atk + (b.mushroom > 0 ? 5 : 0) + (G.perks.fury && f.hp <= f.maxHp * 0.3 ? 3 : 0)), 106, 4, b.mushroom > 0 ? '#ff4fa0' : '#eef4ff');
  drawText(ctx, 'LV' + f.lvl, 120, 4, '#ffd35c'); bar(137, 6, 22, 2, f.xp / f.next, '#6fe8f0');
  // embers
  EMBERS.forEach((k, n) => {
    const x = 166 + n * 8, have = G.embers[k];
    ctx.fillStyle = '#0b0d1a'; ctx.fillRect(x, 3, 6, 7);
    ctx.fillStyle = have ? EMBER_COLORS[k] : '#2c3560'; ctx.fillRect(x + 1, 5, 4, 4); ctx.fillRect(x + 2, 4, 2, 1);
    if (have) { ctx.fillStyle = '#fff2b0'; ctx.fillRect(x + 2, 6, 2, 2); }
  });
  let rx = W - 4;
  const item = (ic, val, col = '#eef4ff') => { const s = String(val); rx -= textWidth(s); drawText(ctx, s, rx, 4, col); rx -= 10; icon(ic, rx, 3); rx -= 5; };
  item('ico_note', Music.muted ? 'OFF' : 'M', Music.muted ? '#76768a' : '#a8c6f0');
  item('ico_kit', KITS.filter(k => G.kits[k]).length, '#ffb04a');
  item('ico_relic', Object.keys(G.relics).length);
  item('ico_gem', G.gems, '#ffa0d0');
  item('ico_fish', G.inv.fish, '#6fe8f0');
  if (G.inv.key) item('ico_key', G.inv.key, '#ffd35c');
  const tags = [];
  if (b.poison) tags.push(['POISON ' + b.poison, '#9be06a']); if (b.mushroom) tags.push(['MUSHROOM ' + b.mushroom, '#ff4fa0']);
  if (b.barrier) tags.push(['BARRIER ' + b.barrier, '#6fe8f0']); if (b.haste) tags.push(['HASTE ' + b.haste, '#ffd35c']);
  if (b.rooted) tags.push(['ROOTED', '#4fb04a']); if (b.sleep) tags.push(['ASLEEP', '#a8c6f0']);
  if (G.perks.fireSpin) tags.push([b.spinCd ? 'SPIN ' + b.spinCd : 'SPIN READY', b.spinCd ? '#76768a' : '#ff7a1a']);
  const timed = Object.values(S.lit).filter(v => v > 0);
  if (timed.length && !S.solved) tags.push(['FLAME ' + Math.min(...timed), '#ff7a1a']);
  let tx = 4; for (const [s, c] of tags) { drawText(ctx, s, tx, 16, c); tx += textWidth(s) + 8; }
  const boss = S.enemies.find(e => !e.dead && MONSTERS[e.t].boss);
  if (boss) { const m = MONSTERS[boss.t]; drawText(ctx, m.name, W / 2, 24, '#ff9a8a', { align: 'center' }); bar(W / 2 - 80, 31, 160, 3, boss.hp / boss.max, '#c8332b', '#3a0c14'); }
  if (fx.msg && ui.mode !== 'talk') {
    fx.msgT += dt; const lines = wrapText(fx.msg, W - 40);
    if (fx.msgT < 5000) { const h = lines.length * 8 + 6; ditherRect(ctx, 0, H - h - 1, W, h + 1, '#0b0d1a', 0.7); lines.forEach((l, i) => drawText(ctx, l, W / 2, H - h + 3 + i * 8, '#eef4ff', { align: 'center' })); }
  }
  if (fx.areaTitle) {
    const a = fx.areaTitle; a.t += dt;
    if (a.t < 3000) { const y = (boss ? 42 : 36) + Math.max(0, 8 - a.t / 40); if (Math.floor(a.t / 60) % 2 || a.t > 400) drawText(ctx, a.text, W / 2, y, '#fff2b0', { align: 'center', scale: 2 }); }
    else fx.areaTitle = null;
  }
  if (fx.objective && !fx.areaTitle && ui.mode === 'play' && !boss) { // held back until the arena is clear
    const o = fx.objective; o.t += dt;
    if (o.t < 6500) { const lines = wrapText(o.text, 230), w = Math.max(...lines.map(l => textWidth(l))) + 22, h = lines.length * 8 + 7, x = Math.round(W / 2 - w / 2), y = 24; panel(ctx, x, y, w, h, { border: '#ffd35c' }); icon('ico_quest', x + 4, y + 4); lines.forEach((l, i) => drawText(ctx, l, x + 15, y + 4 + i * 8, '#fff2b0')); }
    else fx.objective = null;
  }
  if (fx.toast) {
    fx.toast.t += dt; const s = '"' + fx.toast.text + '"'; const w = textWidth(s) + 18;
    if (fx.toast.t < 4500) { const slide = Math.min(1, fx.toast.t / 300, (4500 - fx.toast.t) / 300); const x = W - Math.round((w + 3) * slide); panel(ctx, x, 190, w, 13, { border: '#3f4f8a' }); icon('ico_note', x + 4, 193); drawText(ctx, s, x + 14, 194, '#a8c6f0'); }
    else fx.toast = null;
  }
}

// ---------- Menus ----------
function drawTitle(t) {
  const blink = Math.floor(t / 500) % 2, ly = 62 + Math.round(Math.sin(t / 700) * 2);
  ditherRect(ctx, 0, 22, W, 78, '#05060e', 0.5);
  drawText(ctx, 'FANG', W / 2, ly - 30, '#e8622a', { align: 'center', scale: 4 });
  drawText(ctx, 'THE FOX', W / 2, ly + 1, '#ffd35c', { align: 'center', scale: 3 });
  drawText(ctx, 'A TINY BIT ADVENTURE', W / 2, ly + 22, '#a8c6f0', { align: 'center' });
  if (ui.mode === 'splash') { if (blink) drawText(ctx, 'CLICK OR PRESS ANY KEY', W / 2, 206, '#eef4ff', { align: 'center' }); return; }
  const opts = ui.hasSave ? ['CONTINUE', 'NEW GAME'] : ['NEW GAME'];
  panel(ctx, W / 2 - 50, 196, 100, opts.length * 10 + 6, { border: '#e8622a' });
  opts.forEach((o, i) => drawText(ctx, (ui.sel === i ? '> ' : '  ') + o + (ui.sel === i ? ' <' : '  '), W / 2, 200 + i * 10, ui.sel === i ? '#ffd35c' : '#76768a', { align: 'center' }));
  drawText(ctx, 'MUSIC: TINY BIT ADVENTURES BY AUSTIN GINDER', W / 2, H - 8, '#6a82c4', { align: 'center', shadow: null });
  drawText(ctx, 'V' + GAME_VERSION, W - 4, H - 8, '#6a82c4', { align: 'right', shadow: null });
}
function drawPerkMenu() {
  const x = 52, y = 38, w = W - 104, h = 164;
  panel(ctx, x, y, w, h, { border: '#ffd35c' });
  drawText(ctx, 'CHOOSE A PERK', W / 2, y + 7, '#ffd35c', { align: 'center' });
  ui.perkChoices.forEach((k, i) => {
    const p = PERKS[k], cy = y + 20 + i * 46, on = ui.sel === i;
    panel(ctx, x + 8, cy, w - 16, 42, { border: on ? '#e8622a' : '#2c3560', fill: on ? '#1b1f3a' : '#0b0d1a' });
    drawText(ctx, p.name, x + 16, cy + 6, on ? '#ffd35c' : '#eef4ff');
    drawText(ctx, p.tree, x + w - 16, cy + 6, '#6a82c4', { align: 'right' });
    wrapText(p.desc, w - 40).forEach((l, j) => drawText(ctx, l, x + 16, cy + 17 + j * 8, on ? '#a8c6f0' : '#76768a'));
  });
  drawText(ctx, 'ARROWS TO PICK, ENTER TO LEARN', W / 2, y + h - 10, '#6a82c4', { align: 'center' });
}
function drawDialog(t, dt) {
  const d = ui.dialog; if (!d) return;
  const line = d.lines[d.i], who = SPEAKERS[line.who] || SPEAKERS.narrator;
  d.shown = Math.min(line.text.length, d.shown + dt / 22);
  const x = 8, y = H - 64, w = W - 16, h = 58;
  panel(ctx, x, y, w, h, { border: who.spr ? '#e8622a' : '#6a82c4' });
  let tx = x + 10;
  if (who.spr) {
    panel(ctx, x + 6, y + 6, 40, 46, { border: '#3f4f8a', fill: '#1b1f3a' });
    const s = spr(who.spr), sc = s.h > 24 ? 1 : 2;
    ctx.drawImage(s.c, Math.round(x + 26 - s.w * sc / 2), Math.round(y + 48 - s.h * sc), s.w * sc, s.h * sc);
    tx = x + 54;
    drawText(ctx, who.name, tx, y + 7, '#ffd35c');
  }
  const text = line.text.slice(0, Math.floor(d.shown));
  wrapText(line.text, w - (tx - x) - 12).reduce((acc, l, i) => { const part = text.slice(acc, acc + l.length); drawText(ctx, part, tx, y + (who.spr ? 19 : 10) + i * 9, who.spr ? '#eef4ff' : '#dfe8ff'); return acc + l.length + 1; }, 0);
  if (d.shown >= line.text.length && Math.floor(t / 400) % 2) { ctx.fillStyle = '#ffd35c'; ctx.fillRect(x + w - 12, y + h - 9, 5, 1); ctx.fillRect(x + w - 11, y + h - 8, 3, 1); ctx.fillRect(x + w - 10, y + h - 7, 1, 1); }
}
function drawShop() {
  const x = 60, y = 30, w = W - 120, h = 170;
  panel(ctx, x, y, w, h, { border: '#ffd35c' });
  drawSpr(ctx, 'rudy_0', x + 18, y + 22);
  drawText(ctx, "RUDY'S WARES", x + 30, y + 8, '#ffd35c');
  icon('ico_gem', x + w - 36, y + 7); drawText(ctx, String(G.gems), x + w - 24, y + 8, '#ffa0d0');
  SHOP.forEach((it, i) => {
    const on = ui.sel === i, sold = it.once && G.flags['bought_' + it.id], cy = y + 28 + i * 16;
    if (on) { ctx.fillStyle = '#1b1f3a'; ctx.fillRect(x + 6, cy - 3, w - 12, 13); }
    const col = sold ? '#45455a' : G.gems < it.cost ? '#76768a' : on ? '#ffd35c' : '#eef4ff';
    drawText(ctx, (on ? '> ' : '  ') + it.name, x + 10, cy, col);
    drawText(ctx, sold ? 'SOLD' : String(it.cost), x + w - 22, cy, sold ? '#45455a' : '#ffa0d0', { align: 'right' }); if (!sold) icon('ico_gem', x + w - 19, cy - 1);
  });
  const it = SHOP[ui.sel];
  wrapText(it.desc, w - 20).forEach((l, i) => drawText(ctx, l, x + 10, y + h - 30 + i * 8, '#a8c6f0'));
  drawText(ctx, 'ENTER TO BUY, ESC TO LEAVE', W / 2, y + h - 11, '#6a82c4', { align: 'center' });
}
function mapPos(key) { const [px, py] = AREAS[key].pos; return [Math.round(52 + (px - 44) * 0.92), Math.round(56 + py * 0.66)]; }
const BIOME_MAP_COLOR = { night: '#2f7a4a', burrow: '#7a4e32', pond: '#2f7a4a', grotto: '#1f6a5a', lake: '#2f7a4a', woods: '#1f4a3a', cave: '#1fa0b0', ruins: '#76768a', nexus: '#6b3a9a', frozen: '#a8c6f0', volcanic: '#c8332b', enchanted: '#ff6fb0', dream: '#a86ad8', void: '#3b1f5a' };
function drawPause(t) {
  const x = 24, y = 18, w = W - 48, h = 206;
  panel(ctx, x, y, w, h, { border: '#6a82c4' });
  ['MAP', 'QUEST', 'FANG', 'OPTIONS'].forEach((n, i) => { const on = ui.tab === i, tx = x + 12 + i * 52; panel(ctx, tx, y + 5, 46, 13, { border: on ? '#ffd35c' : '#2c3560', fill: on ? '#1b1f3a' : '#0b0d1a' }); drawText(ctx, n, tx + 23, y + 9, on ? '#ffd35c' : '#76768a', { align: 'center' }); });
  drawText(ctx, 'P: CLOSE', x + w - 10, y + 9, '#45455a', { align: 'right' });
  if (ui.tab === 0) {
    // connections
    const drawn = new Set();
    for (const [k, A] of Object.entries(AREAS)) {
      if (!G.visited[k]) continue;
      for (const d of Object.values(A.doors)) {
        const key = [k, d.to].sort().join(); if (drawn.has(key)) continue; drawn.add(key);
        if (d.when && !G.flags[d.when]) continue;
        const [x0, y0] = mapPos(k), [x1, y1] = mapPos(d.to), n = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0));
        ctx.fillStyle = G.visited[d.to] ? '#3f4f8a' : '#1b1f3a';
        for (let s = 0; s <= n; s += 2) ctx.fillRect(Math.round(x0 + (x1 - x0) * s / n), Math.round(y0 + (y1 - y0) * s / n), 1, 1);
      }
    }
    for (const [k, A] of Object.entries(AREAS)) {
      const [mx, my] = mapPos(k), seen = G.visited[k];
      const neighbour = !seen && Object.entries(AREAS).some(([o, B]) => G.visited[o] && Object.values(B.doors).some(d => d.to === k && (!d.when || G.flags[d.when])));
      if (!seen && !neighbour) continue;
      if (!seen) { drawText(ctx, '?', mx, my - 2, '#45455a', { align: 'center' }); continue; }
      const col = BIOME_MAP_COLOR[A.biome];
      ctx.fillStyle = '#0b0d1a'; ctx.fillRect(mx - 7, my - 3, 15, 5); ctx.fillRect(mx - 4, my + 2, 9, 2); ctx.fillRect(mx - 2, my + 4, 5, 2);
      ctx.fillStyle = col; ctx.fillRect(mx - 6, my - 2, 13, 2);
      ctx.fillStyle = '#4a2e22'; ctx.fillRect(mx - 5, my, 11, 2); ctx.fillRect(mx - 3, my + 2, 7, 1); ctx.fillRect(mx - 1, my + 3, 3, 2);
      if (A.boss) { const bossT = Object.keys(BOSS_FLAG).find(b => A.map.join('').includes(b)); const done = bossT && G.flags[BOSS_FLAG[bossT]]; ctx.fillStyle = done ? '#ffd35c' : '#c8332b'; ctx.fillRect(mx - 1, my - 5, 3, 2); }
      if (k === G.areaKey && Math.floor(t / 300) % 2) icon('ico_kit', mx - 4, my - 12);
    }
    const [cx, cy] = mapPos(G.areaKey);
    drawText(ctx, AREAS[G.areaKey].title, x + 12, y + h - 12, '#ffd35c');
    drawText(ctx, AREAS[G.areaKey].region, x + w - 12, y + h - 12, '#6a82c4', { align: 'right' });
  } else if (ui.tab === 1) {
    drawText(ctx, 'CURRENT QUEST', x + 14, y + 28, '#e8622a');
    wrapText(objectiveText(), w - 28).forEach((l, i) => drawText(ctx, l, x + 14, y + 40 + i * 9, '#fff2b0'));
    drawText(ctx, 'EMBERS', x + 14, y + 70, '#e8622a');
    EMBERS.forEach((k, n) => { const have = G.embers[k]; icon(ITEMS[k].spr, x + 14 + n * 50, y + 78, have ? 1 : 0.25); drawText(ctx, ITEMS[k].name.split(' ')[0], x + 22 + n * 50, y + 96, have ? EMBER_COLORS[k] : '#45455a', { align: 'center' }); });
    drawText(ctx, 'LOST KITS', x + 14, y + 112, '#e8622a');
    KITS.forEach((k, n) => { const have = G.kits[k]; drawText(ctx, have ? KIT_INFO[k].name : '???', x + 14 + n * 58, y + 124, have ? '#ffb04a' : '#45455a'); });
    drawText(ctx, `RELICS  ${Object.keys(G.relics).length} / ${TOTAL_RELICS}`, x + 14, y + 142, '#ffd35c');
    const next = [5, 10, 15, TOTAL_RELICS].find(n => !G.flags['hoot' + n] && n !== TOTAL_RELICS || (n === TOTAL_RELICS && !G.flags.crest));
    if (next) drawText(ctx, `HOOT'S NEXT LESSON AT ${next} RELICS`, x + 14, y + 152, '#6a82c4');
    const items = []; if (G.flags.crystalKey) items.push('CRYSTAL KEY'); if (G.flags.cloak) items.push('FROST CLOAK'); if (G.flags.scale) items.push('DRAGON SCALE'); if (G.flags.kitCharm) items.push("GRANDMA'S CHARM"); if (G.flags.crest) items.push('STARLIGHT CREST');
    drawText(ctx, 'TREASURES', x + 14, y + 168, '#e8622a');
    wrapText(items.length ? items.join(', ') : 'None yet.', w - 28).forEach((l, i) => drawText(ctx, l, x + 14, y + 180 + i * 8, '#eef4ff'));
  } else if (ui.tab === 3) {
    OPTION_ROWS.forEach((r, i) => {
      const ry = optionRowY(i), on = ui.sel === i;
      if (on) panel(ctx, x + 10, ry - 4, w - 20, r.hint ? 24 : 16, { border: '#ffd35c', fill: '#1b1f3a' });
      drawText(ctx, r.label, x + 20, ry + 1, on ? '#ffd35c' : '#a8c6f0');
      const v = Settings[r.key], bx = x + 170;
      if (r.kind === 'vol') {
        for (let k = 0; k < 10; k++) { ctx.fillStyle = '#0b0d1a'; ctx.fillRect(bx + k * 11, ry - 1, 9, 9); ctx.fillStyle = k < v ? (Settings.muted ? '#45455a' : on ? '#ffd35c' : '#e8622a') : '#1b1f3a'; ctx.fillRect(bx + k * 11 + 1, ry, 7, 7); }
        drawText(ctx, v ? String(v * 10) + '%' : 'OFF', bx + 118, ry + 1, '#eef4ff');
      } else drawText(ctx, v ? 'ON' : 'OFF', bx, ry + 1, v ? (r.key === 'muted' ? '#ff9a8a' : '#9be06a') : '#76768a');
      if (on && r.hint) drawText(ctx, r.hint, x + 20, ry + 11, '#6a82c4');
    });
    const tip = ui.sel < 0 ? 'DOWN: CHOOSE A SETTING' : OPTION_ROWS[ui.sel].kind === 'vol' ? 'LEFT/RIGHT: CHANGE   UP/DOWN: CHOOSE' : 'ENTER OR LEFT/RIGHT: SWITCH   UP/DOWN: CHOOSE';
    drawText(ctx, tip, W / 2, y + h - 12, '#45455a', { align: 'center' });
  } else {
    const f = G.fox;
    drawText(ctx, `LEVEL ${f.lvl}   ATTACK ${f.atk}   HEALTH ${f.hp}/${f.maxHp}`, x + 14, y + 28, '#ffd35c');
    drawText(ctx, `KILLS ${G.kills}   TURNS ${G.turn}   GEMS ${G.gems}`, x + 14, y + 38, '#ffd35c');
    drawText(ctx, 'PERKS', x + 14, y + 52, '#e8622a');
    const owned = Object.keys(G.perks).map(k => PERKS[k].name);
    wrapText(owned.length ? owned.join(', ') : 'None yet. Level up to learn perks.', w - 28).forEach((l, i) => drawText(ctx, l, x + 14, y + 62 + i * 8, '#eef4ff'));
    drawText(ctx, 'CONTROLS', x + 14, y + 96, '#e8622a');
    [['MOVE / ATTACK / TALK', 'ARROWS OR WASD'], ['EAT FISH', 'F'], ['FIRE SPIN', 'SPACE'], ['MUTE ALL SOUND', 'M'], ['MAP AND MENU', 'P OR ESC']].forEach(([a, b], i) => { drawText(ctx, a, x + 14, y + 106 + i * 9, '#a8c6f0'); drawText(ctx, b, x + 150, y + 106 + i * 9, '#eef4ff'); });
    ['RESUME', 'RESTART FROM SCRATCH'].forEach((o, i) => drawText(ctx, (ui.sel === i ? '> ' : '') + o, W / 2, y + h - 30 + i * 10, ui.sel === i ? '#ffd35c' : '#76768a', { align: 'center' }));
    drawText(ctx, 'NOW PLAYING: ' + (Music.current ? TRACKS[Music.current].replace(/^\d+-/, '') : '-'), W / 2, y + h - 9, '#6a82c4', { align: 'center' });
  }
}
const OPTION_ROWS = [
  { key: 'music', label: 'MUSIC VOLUME', kind: 'vol' },
  { key: 'sfx', label: 'SOUND VOLUME', kind: 'vol' },
  { key: 'shake', label: 'SCREEN SHAKE', kind: 'bool' },
  { key: 'flash', label: 'SCREEN FLASHES', kind: 'bool', hint: 'LIGHTNING AND BIG-MOMENT FLASHES' },
  { key: 'muted', label: 'MUTE ALL SOUND', kind: 'bool', hint: 'THE M KEY DOES THIS TOO' },
];
const optionRowY = i => 18 + 34 + i * 26;
function changeOption(i, dir) {
  const r = OPTION_ROWS[i];
  if (r.kind === 'vol') {
    const v = Math.max(0, Math.min(10, Settings[r.key] + dir)); if (v === Settings[r.key]) return;
    Settings[r.key] = v;
  } else Settings[r.key] = !Settings[r.key];
  Settings.save(); Music.refresh();
  if (r.key === 'shake' && Settings.shake) shake(3);
  Sfx.play(r.key === 'sfx' ? 'pickup' : 'select');
}
function drawEnd(t) {
  if (ui.anim < 300) return;
  panel(ctx, 92, 66, 200, 88, { border: '#ff4fa0' });
  drawText(ctx, 'FANG FAINTED...', W / 2, 78, '#ff4fa0', { align: 'center', scale: 2 });
  drawText(ctx, 'DEFEATED BY ' + (ui.deathBy || 'THE WILD'), W / 2, 102, '#a8c6f0', { align: 'center' });
  if (Math.floor(t / 500) % 2) drawText(ctx, 'PRESS ENTER TO TRY AGAIN, AGAIN', W / 2, 134, '#eef4ff', { align: 'center' });
}
function drawCredits(dt) {
  ui.credits += dt;
  ditherRect(ctx, 0, 0, W, H, '#05060e', 0.75);
  let y = H - ui.credits / 45;
  for (const [text, col, sc] of CREDITS) { if (text && y > -20 && y < H + 10) drawText(ctx, text, W / 2, Math.round(y), col, { align: 'center', scale: sc }); y += 8 * sc + 6; }
  const f = G.fox;
  if (y < 150) {
    drawText(ctx, `LEVEL ${f.lvl}  KILLS ${G.kills}  TURNS ${G.turn}`, W / 2, 160, '#6fe8f0', { align: 'center' });
    drawText(ctx, `KITS ${KITS.filter(k => G.kits[k]).length}/5  RELICS ${Object.keys(G.relics).length}/${TOTAL_RELICS}`, W / 2, 170, '#6fe8f0', { align: 'center' });
    if (Math.floor(ui.t / 500) % 2) drawText(ctx, 'PRESS ENTER', W / 2, 196, '#eef4ff', { align: 'center' });
  }
  ui.creditsDone = y < 150;
}

// ---------- Main loop ----------
function tick(now) {
  const dt = Math.max(0, Math.min(50, now - lastT)); lastT = Math.max(lastT, now); ui.t += dt; ui.anim += dt;
  const t = ui.t;
  if (G) {
    const adv = o => { if (o && o.anim) o.anim.t += dt; if (o && o.flash > 0) o.flash -= dt; };
    adv(G.fox); S.enemies.forEach(adv); S.blocks.forEach(adv);
    if (queued && ui.mode === 'play' && !busy()) { const q = queued; queued = null; doAction(q); }
    if (G.pendingPerks > 0 && ui.mode === 'play' && !busy()) offerPerks();
    runStory(dt);
  }
  weather.update(dt, t);
  if (fx.shake > 0) fx.shake = Math.max(0, fx.shake - dt / 60);
  if (fx.flashT > 0) fx.flashT -= dt;
  if (ui.mode === 'trans') {
    const tr = ui.trans; tr.t += dt;
    if (tr.t >= 260 && !tr.done) { tr.done = true; tr.mid(); }
    if (tr.t >= 560) { ui.mode = 'play'; ui.trans = null; Music.play(AREAS[G.areaKey].music); }
  }
  const lights = [];
  ctx.save();
  if (fx.shake > 0) ctx.translate(Math.round((Math.random() - 0.5) * fx.shake), Math.round((Math.random() - 0.5) * fx.shake));
  drawWorld(t, lights);
  const B = BIOMES[AREAS[G.areaKey].biome];
  weather.drawSparks(ctx);
  const flashOn = Settings.flash ? 1 : 0; // lightning and big-moment flashes can be switched off in OPTIONS
  applyLighting(ctx, lights, B, t, flashOn * (weather.flash * 0.45 + (fx.flashT > 0 ? 0.25 : 0)));
  // after lighting, so foes keep a moonlit edge even in the darkest corners
  ctx.globalAlpha = 0.45; for (const [n, fl, rx, ry] of fx.rims) ctx.drawImage(rimOf(n, fl, B.rim || '#a8b8e0'), rx, ry); ctx.globalAlpha = 1; fx.rims.length = 0;
  weather.drawFront(ctx, t);
  if (flashOn && weather.flash > 0.6) ditherRect(ctx, 0, 0, W, H, '#dfe8ff', (weather.flash - 0.6) * 0.8);
  const mist = mistFrames(B.sky[3]); ctx.drawImage(mist[Math.floor(t / 180) % mist.length], 0, 0);
  if (ui.mode !== 'splash' && ui.mode !== 'title') { drawDoorMarkers(t); drawEffects(dt); }
  ctx.restore();
  if (ui.mode === 'splash' || ui.mode === 'title') drawTitle(t);
  else if (ui.mode === 'credits') drawCredits(dt);
  else {
    if (ui.mode === 'dead') ditherRect(ctx, 0, 0, W, H, '#05060e', Math.min(0.5, ui.anim / 1200));
    drawHUD(t, dt);
    if (ui.mode === 'perk') drawPerkMenu();
    if (ui.mode === 'pause') drawPause(t);
    if (ui.mode === 'talk') drawDialog(t, dt);
    if (ui.mode === 'shop') drawShop();
    if (ui.mode === 'dead') drawEnd(t);
  }
  if (ui.mode === 'trans' && ui.trans) { const k = ui.trans.t < 260 ? ui.trans.t / 260 : 1 - (ui.trans.t - 260) / 300; drawDissolve(ctx, k); }
  requestAnimationFrame(tick);
}

// ---------- Input ----------
const KEYMAP = { ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right', w: 'up', s: 'down', a: 'left', d: 'right', W: 'up', S: 'down', A: 'left', D: 'right' };
function startAudio() { Sfx.init(); if (Sfx.ctx && Sfx.ctx.state === 'suspended' && !document.hidden) Sfx.ctx.resume(); Music.retry(); }
function press(key) {
  startAudio();
  if (ui.mode === 'splash') { ui.mode = 'title'; ui.sel = 0; Music.play('title'); Sfx.play('select'); return; }
  if (key === 'm') { const m = Music.toggle(); say(m ? 'Sound off. Press M to turn it back on.' : 'Sound on.'); return; }
  if (ui.mode === 'title') {
    const n = ui.hasSave ? 2 : 1;
    if (key === 'up' || key === 'down') { ui.sel = (ui.sel + (key === 'up' ? n - 1 : 1)) % n; Sfx.play('select'); }
    if (key === 'enter') {
      const choice = ui.hasSave ? ['continue', 'new'][ui.sel] : 'new';
      Sfx.play('door');
      if (choice === 'continue' && load()) { ui.mode = 'play'; Music.play(AREAS[G.areaKey].music); say('Welcome back, Fang!'); showObjective(); }
      else { newGame(); ui.mode = 'play'; Music.play('home'); startIntro(); }
    }
    return;
  }
  if (ui.mode === 'talk') { if (key === 'enter' || key === 'spin' || key === 'eat') advanceDialog(); return; }
  if (ui.mode === 'shop') {
    if (key === 'up') { ui.sel = (ui.sel + SHOP.length - 1) % SHOP.length; Sfx.play('select'); }
    if (key === 'down') { ui.sel = (ui.sel + 1) % SHOP.length; Sfx.play('select'); }
    if (key === 'enter' || key === 'spin') buy(SHOP[ui.sel]);
    if (key === 'pause' || key === 'left') { ui.mode = 'play'; say('Rudy: Come back soon!'); }
    return;
  }
  if (ui.mode === 'perk') {
    if (key === 'up' || key === 'left') { ui.sel = (ui.sel + ui.perkChoices.length - 1) % ui.perkChoices.length; Sfx.play('select'); }
    if (key === 'down' || key === 'right') { ui.sel = (ui.sel + 1) % ui.perkChoices.length; Sfx.play('select'); }
    if (key === 'enter' || key === 'spin') choosePerk(ui.perkChoices[ui.sel]);
    return;
  }
  if (ui.mode === 'pause') {
    if (ui.tab === 3 && ui.sel >= 0) { // inside OPTIONS: arrows change settings
      if (key === 'up') { ui.sel--; Sfx.play('select'); }
      else if (key === 'down') { ui.sel = Math.min(OPTION_ROWS.length - 1, ui.sel + 1); Sfx.play('select'); }
      else if (key === 'left' || key === 'right') changeOption(ui.sel, key === 'left' ? -1 : 1);
      else if (key === 'enter' || key === 'spin') { if (OPTION_ROWS[ui.sel].kind === 'bool') changeOption(ui.sel, 1); }
      else if (key === 'pause') ui.mode = 'play';
      return;
    }
    if (ui.tab === 3 && key === 'down') { ui.sel = 0; Sfx.play('select'); return; }
    if (key === 'left' || key === 'right') { ui.tab = (ui.tab + (key === 'left' ? 3 : 1)) % 4; ui.sel = ui.tab === 3 ? -1 : 0; Sfx.play('select'); }
    if (ui.tab === 2 && (key === 'up' || key === 'down')) { ui.sel = 1 - ui.sel; Sfx.play('select'); }
    if (key === 'pause') ui.mode = 'play';
    if (key === 'enter') {
      if (ui.tab === 3) { ui.sel = 0; return; }
      if (ui.tab !== 2 || ui.sel === 0) ui.mode = 'play';
      else if (confirm('Start a brand new adventure? Your current progress will be lost.')) { try { localStorage.removeItem(SAVE_KEY); } catch (e) {} newGame(); ui.mode = 'play'; Music.play('home'); startIntro(); }
    }
    return;
  }
  if (ui.mode === 'credits') { if (key === 'enter') { if (ui.creditsDone) finishCredits(); else ui.credits += 4000; } return; }
  if (ui.mode === 'dead') { if (key === 'enter' && ui.anim > 600) respawn(); return; }
  if (ui.mode !== 'play') return;
  if (key === 'pause') { ui.mode = 'pause'; ui.sel = 0; return; }
  if (key === 'enter') return;
  input(key);
}
window.addEventListener('keydown', e => {
  if (e.metaKey || e.ctrlKey || e.altKey) return;
  let k = KEYMAP[e.key];
  if (!k) k = { Enter: 'enter', ' ': 'spin', f: 'eat', F: 'eat', e: 'eat', E: 'eat', Escape: 'pause', p: 'pause', P: 'pause', m: 'm', M: 'm', Tab: 'pause' }[e.key];
  if (ui.mode === 'splash') { e.preventDefault(); return press('any'); }
  if (!k) return;
  if (k === 'spin' && !['play', 'perk', 'talk', 'shop'].includes(ui.mode)) k = 'enter';
  e.preventDefault();
  press(k);
});
canvas.addEventListener('pointerdown', e => {
  startAudio();
  if (ui.mode === 'splash') return press('any');
  const r = canvas.getBoundingClientRect(), x = (e.clientX - r.left) / r.width * W, y = (e.clientY - r.top) / r.height * H;
  if (ui.mode === 'title') { const n = ui.hasSave ? 2 : 1; for (let i = 0; i < n; i++) if (y >= 198 + i * 10 && y < 208 + i * 10) { ui.sel = i; return press('enter'); } return; }
  if (ui.mode === 'talk' || ui.mode === 'dead' || ui.mode === 'credits') return press('enter');
  if (ui.mode === 'perk') { for (let i = 0; i < ui.perkChoices.length; i++) { const cy = 58 + i * 46; if (y >= cy && y < cy + 42) { ui.sel = i; return press('enter'); } } return; }
  if (ui.mode === 'shop') { const i = Math.floor((y - 25) / 16); if (i >= 0 && i < SHOP.length) { if (ui.sel === i) press('enter'); else ui.sel = i; } else press('pause'); return; }
  if (ui.mode === 'pause') {
    if (y < 40) { ui.tab = Math.max(0, Math.min(3, Math.floor((x - 36) / 52))); ui.sel = ui.tab === 3 ? -1 : 0; return; }
    if (ui.tab === 3) { // tap a row to pick it; tap left or right of the value to change it
      const i = OPTION_ROWS.findIndex((r, n) => y >= optionRowY(n) - 5 && y < optionRowY(n) + 14);
      if (i < 0) return press('pause');
      ui.sel = i;
      if (OPTION_ROWS[i].kind === 'bool') changeOption(i, 1); else if (x >= 194) changeOption(i, x < 194 + 55 ? -1 : 1);
      return;
    }
    press('pause'); return;
  }
  if (ui.mode === 'play') {
    const gx = Math.floor((x - GX) / TILE), gy = Math.floor((y - GY) / TILE), dx = gx - G.fox.x, dy = gy - G.fox.y;
    if (Math.abs(dx) + Math.abs(dy) === 0) return press('eat');
    if (Math.abs(dx) >= Math.abs(dy)) press(dx > 0 ? 'right' : 'left'); else press(dy > 0 ? 'down' : 'up');
  }
});
document.querySelectorAll('[data-key]').forEach(btn => {
  const fire = e => { e.preventDefault(); btn.classList.add('on'); press(btn.dataset.key); };
  btn.addEventListener('pointerdown', fire);
  ['pointerup', 'pointerleave', 'pointercancel'].forEach(ev => btn.addEventListener(ev, () => btn.classList.remove('on')));
});

// ---------- Scaling & boot ----------
function fit() {
  const touch = document.body.classList.contains('touch');
  const availH = window.innerHeight - (touch ? 150 : 0), availW = window.innerWidth;
  let s = Math.floor(Math.min(availW / W, availH / H));
  // whole-pixel scaling on its own page; inside a frame (a website's game stage) fill the frame instead
  if (s < 1 || window.self !== window.top) s = Math.min(availW / W, availH / H);
  canvas.style.width = Math.floor(W * s) + 'px'; canvas.style.height = Math.floor(H * s) + 'px';
}
if (matchMedia('(pointer: coarse)').matches) document.body.classList.add('touch');
window.addEventListener('resize', fit);
buildSprites(); buildDissolve(); Music.init(); fit();
Music.onTrack = name => { fx.toast = { text: name, t: 0 }; };
ui.hasSave = hasSave();
newGame(); G.fox.x = 6; G.fox.y = 3;   // the title screen shows Fang's home island
requestAnimationFrame(tick);
