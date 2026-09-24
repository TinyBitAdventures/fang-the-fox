// Rendering: sprite cache, skies, floating islands, dithered lighting, weather.
const W = 384, H = 240, TILE = 16, COLS = 14, ROWS = 8;
const GX = 80, GY = 54;                       // grid origin
const IX0 = 64, IX1 = 320, ITOP = 46, IFRONT = 190, LIP = 6;   // island top surface
const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5].map(v => (v + 0.5) / 16);
const bayer = (x, y) => BAYER[(y & 3) * 4 + (x & 3)];
const LIGHT_COLORS = { warm: '#ffb04a', cool: '#6fe8f0', green: '#9be06a', pink: '#ff6fb0', red: '#ff5a1a', purple: '#b070ff', white: '#dfe8ff' };

function mkCanvas(w, h) { const c = document.createElement('canvas'); c.width = w; c.height = h; const x = c.getContext('2d'); x.imageSmoothingEnabled = false; return [c, x]; }
function hexRgb(h) { return [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)]; }
function rgbHex(r, g, b) { return '#' + [r, g, b].map(v => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join(''); }
function mix(a, b, t) { const A = hexRgb(a), B = hexRgb(b); return rgbHex(A[0] + (B[0] - A[0]) * t, A[1] + (B[1] - A[1]) * t, A[2] + (B[2] - A[2]) * t); }
function shade(h, k) { return k >= 0 ? mix(h, '#ffffff', k) : mix(h, '#000000', -k); }
function rng(seed) { let s = typeof seed === 'string' ? [...seed].reduce((a, c) => (a * 31 + c.charCodeAt(0)) | 0, 7) : seed; return () => { s = (s + 0x6D2B79F5) | 0; let t = Math.imul(s ^ (s >>> 15), 1 | s); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const hash2 = (x, y) => { let h = (x * 374761393 + y * 668265263) | 0; h = Math.imul(h ^ (h >>> 13), 1274126177); return ((h ^ (h >>> 16)) >>> 0) / 4294967296; };

// ---------- Sprites ----------
const SPR = {};
function buildSprites() {
  for (const [name, s] of Object.entries(SPRITES)) {
    const [c, x] = mkCanvas(s.w, s.h), [f, fx] = mkCanvas(s.w, s.h), [wh, wx] = mkCanvas(s.w, s.h);
    s.rows.forEach((row, yy) => { for (let xx = 0; xx < row.length; xx++) { const ch = row[xx]; if (ch === '.' || !PAL[ch]) continue; x.fillStyle = PAL[ch]; x.fillRect(xx, yy, 1, 1); wx.fillStyle = '#ffffff'; wx.fillRect(xx, yy, 1, 1); } });
    fx.translate(s.w, 0); fx.scale(-1, 1); fx.drawImage(c, 0, 0);
    SPR[name] = { c, f, wh, w: s.w, h: s.h, lights: s.lights || [], rows: s.rows };
  }
}
const _missing = {};
function spr(name) {
  if (SPR[name]) return SPR[name];
  if (!_missing[name]) { const [c, x] = mkCanvas(16, 16); x.fillStyle = '#ff00ff'; x.fillRect(3, 3, 10, 10); _missing[name] = { c, f: c, wh: c, w: 16, h: 16, lights: [] }; console.warn('missing sprite', name); }
  return _missing[name];
}
// rim light: 1px edge just outside the silhouette's top and sides (lit from above), cached per sprite + colour
const _rims = {};
function rimOf(name, flip, color) {
  const key = name + (flip ? '|f|' : '||') + color; if (_rims[key]) return _rims[key];
  const s = spr(name), [c, x] = mkCanvas(s.w + 2, s.h + 2); x.fillStyle = color;
  const on = (xx, yy) => { if (xx < 0 || yy < 0 || xx >= s.w || yy >= s.h || !s.rows) return false; const ch = s.rows[yy][flip ? s.w - 1 - xx : xx]; return ch !== '.' && !!PAL[ch]; };
  for (let yy = -1; yy <= s.h; yy++) for (let xx = -1; xx <= s.w; xx++) {
    if (on(xx, yy)) continue;
    if (on(xx, yy + 1) || ((on(xx - 1, yy) || on(xx + 1, yy)) && yy < s.h * 0.4)) x.fillRect(xx + 1, yy + 1, 1, 1);
  }
  return (_rims[key] = c);
}
// frame helper: returns name_0/name_1 (or name_N) if present
function frame(base, n, t, speed = 500, offset = 0) {
  const i = Math.floor((t + offset) / speed) % n;
  return SPR[base + '_' + i] ? base + '_' + i : (SPR[base + '_0'] ? base + '_0' : base);
}
// draw anchored bottom-centre at (ax, ay)
function drawSpr(ctx, name, ax, ay, opts = {}) {
  const s = spr(name), img = opts.white ? s.wh : (opts.flip ? s.f : s.c);
  const x = Math.round(ax - s.w / 2), y = Math.round(ay - s.h);
  if (opts.alpha !== undefined) ctx.globalAlpha = opts.alpha;
  ctx.drawImage(img, x, y);
  if (opts.white && opts.flip) { /* silhouette is symmetric enough */ }
  ctx.globalAlpha = 1;
  if (opts.lights && s.lights.length) for (const [lx, ly, r, col] of s.lights) opts.lights.push([x + (opts.flip ? s.w - 1 - lx : lx), y + ly, r, col]);
  return { x, y, w: s.w, h: s.h };
}

// ---------- Lighting ----------
const _masks = {}, _tints = {};
function lightMask(r, tint) {
  r = Math.max(2, Math.round(r));
  const key = r + (tint || ''), cache = tint ? _tints : _masks;
  if (cache[key]) return cache[key];
  const size = r * 2 + 1, [c, x] = mkCanvas(size, size), img = x.createImageData(size, size), rgb = tint ? hexRgb(LIGHT_COLORS[tint] || tint) : [0, 0, 0];
  const levels = [0, 0.4, 0.7, 1];
  for (let yy = 0; yy < size; yy++) for (let xx = 0; xx < size; xx++) {
    const d = Math.hypot(xx - r, yy - r) / r; if (d > 1) continue;
    const s = 1 - d, lv = Math.max(0, Math.min(3, Math.floor(s * 3.6 + (bayer(xx, yy) - 0.5) * 1.1)));
    if (!lv) continue;
    const o = (yy * size + xx) * 4; img.data[o] = rgb[0]; img.data[o + 1] = rgb[1]; img.data[o + 2] = rgb[2]; img.data[o + 3] = Math.round(levels[lv] * 255);
  }
  x.putImageData(img, 0, 0);
  return (cache[key] = c);
}
const [lightC, lightX] = mkCanvas(W, H);
function applyLighting(ctx, lights, biome, t, flash = 0) {
  const dark = Math.max(0, biome.dark - flash);
  lightX.globalCompositeOperation = 'source-over';
  lightX.clearRect(0, 0, W, H);
  lightX.globalAlpha = dark; lightX.fillStyle = biome.ambient; lightX.fillRect(0, 0, W, H); lightX.globalAlpha = 1;
  lightX.globalCompositeOperation = 'destination-out';
  const flick = Math.floor(t / 110);
  for (const [x, y, r, col, steady] of lights) {
    const rr = steady ? r : r + ((hash2(Math.round(x) * 3 + flick, Math.round(y)) * 2.2) | 0) - 1;
    const m = lightMask(rr); lightX.drawImage(m, Math.round(x - rr), Math.round(y - rr));
  }
  ctx.drawImage(lightC, 0, 0);
  // coloured glow
  ctx.globalCompositeOperation = 'lighter';
  ctx.globalAlpha = 0.16;
  for (const [x, y, r, col] of lights) { if (!col || col === 'none') continue; const rr = Math.round(r * 0.8); const m = lightMask(rr, col); ctx.drawImage(m, Math.round(x - rr), Math.round(y - rr)); }
  ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
}

// ---------- Dither transition patterns ----------
const DISSOLVE = [];
function buildDissolve() {
  for (let k = 0; k <= 16; k++) {
    const [c, x] = mkCanvas(8, 8); x.fillStyle = '#05060e';
    for (let yy = 0; yy < 4; yy++) for (let xx = 0; xx < 4; xx++) if (BAYER[yy * 4 + xx] < k / 16) x.fillRect(xx * 2, yy * 2, 2, 2);
    DISSOLVE.push(c);
  }
}
function drawDissolve(ctx, t) {
  const k = Math.max(0, Math.min(16, Math.round(t * 16))); if (!k) return;
  if (k === 16) { ctx.fillStyle = '#05060e'; ctx.fillRect(0, 0, W, H); return; }
  ctx.fillStyle = ctx.createPattern(DISSOLVE[k], 'repeat'); ctx.fillRect(0, 0, W, H);
}
// dithered translucent panel (crisp, no alpha blending)
const _dither = {};
function ditherRect(ctx, x, y, w, h, color, density = 0.5) {
  x = Math.round(x); y = Math.round(y); w = Math.round(w); h = Math.round(h);
  density = Math.round(density * 16) / 16; if (density <= 0 || w <= 0 || h <= 0) return;
  const key = [w, h, color, density, x & 3, y & 3].join();
  let c = _dither[key];
  if (!c) {
    const [cv, cx] = mkCanvas(w, h); cx.fillStyle = color;
    for (let yy = 0; yy < h; yy++) for (let xx = 0; xx < w; xx++) if (bayer(x + xx, y + yy) < density) cx.fillRect(xx, yy, 1, 1);
    c = _dither[key] = cv;
  }
  ctx.drawImage(c, x, y);
}
const _panelCache = {};
function panel(ctx, x, y, w, h, opts = {}) {
  const key = [w, h, opts.fill, opts.border, opts.density].join();
  if (!_panelCache[key]) {
    const [c, cx] = mkCanvas(w, h);
    ditherRect(cx, 0, 0, w, h, opts.fill || '#0b0d1a', opts.density === undefined ? 1 : opts.density);
    cx.fillStyle = opts.border || '#3f4f8a';
    cx.fillRect(1, 0, w - 2, 1); cx.fillRect(1, h - 1, w - 2, 1); cx.fillRect(0, 1, 1, h - 2); cx.fillRect(w - 1, 1, 1, h - 2);
    cx.fillStyle = opts.hi || shade(opts.border || '#3f4f8a', 0.35); cx.fillRect(2, 1, w - 4, 1);
    _panelCache[key] = c;
  }
  ctx.drawImage(_panelCache[key], Math.round(x), Math.round(y));
}

// ---------- Sky ----------
const _sky = {};
function buildSky(bk) {
  if (_sky[bk]) return _sky[bk];
  const B = BIOMES[bk], R = rng('sky' + bk), [c, x] = mkCanvas(W, H);
  const cols = B.sky, span = H * 0.78;
  for (let y = 0; y < H; y++) {
    const f = Math.min(cols.length - 1, (y / span) * (cols.length - 1));
    for (let xx = 0; xx < W; xx++) { const i = Math.min(cols.length - 1, Math.floor(f + bayer(xx, y) - 0.5 + 0.5)); x.fillStyle = cols[Math.max(0, i)]; x.fillRect(xx, y, 1, 1); }
  }
  const stars = [];
  if (B.stars || B.moon) {
    const n = B.stars ? 90 : 35;
    for (let i = 0; i < n; i++) { const sx = (R() * W) | 0, sy = (R() * H * 0.62) | 0, b = R(); stars.push([sx, sy, b]); x.fillStyle = b > 0.85 ? '#eef4ff' : b > 0.5 ? '#a8c6f0' : '#6a82c4'; x.fillRect(sx, sy, 1, 1); }
  }
  if (B.nebula) {
    const blobs = [[90, 60, 70, '#6b3a9a'], [280, 40, 80, '#3b1f5a'], [220, 110, 60, '#a86ad8'], [60, 150, 50, '#1fa0b0']];
    for (const [bx, by, br, col] of blobs) for (let yy = -br; yy < br; yy++) for (let xx = -br; xx < br; xx++) {
      const d = Math.hypot(xx, yy * 1.6) / br; if (d > 1) continue;
      const n = (Math.sin((bx + xx) * 0.07) + Math.cos((by + yy) * 0.09 + xx * 0.02)) * 0.15;
      if (bayer(bx + xx, by + yy) < (1 - d) * 0.55 + n) { x.fillStyle = col; x.fillRect(bx + xx, by + yy, 1, 1); }
    }
  }
  if (B.moon) {
    const mx = 58, my = 34, mr = 11, halo = B.moon === 'dim' ? '#1e3038' : shade(cols[2], 0.12);
    for (let yy = -30; yy <= 30; yy++) for (let xx = -30; xx <= 30; xx++) {
      const d = Math.hypot(xx, yy); if (d <= mr || d > 28) continue;
      const s = 1 - (d - mr) / 17; if (bayer(mx + xx, my + yy) < s * 0.55) { x.fillStyle = s > 0.6 ? shade(halo, 0.18) : halo; x.fillRect(mx + xx, my + yy, 1, 1); }
    }
    for (let yy = -mr; yy <= mr; yy++) for (let xx = -mr; xx <= mr; xx++) {
      const d = Math.hypot(xx, yy); if (d > mr + 0.3) continue;
      const edge = (xx + yy) / mr; let col = B.moon === 'dim' ? '#9fb4c8' : '#e8f0ff';
      if (edge > 0.7) col = B.moon === 'dim' ? '#6f8494' : '#aebedf'; else if (edge > 0.35 && bayer(mx + xx, my + yy) < 0.5) col = B.moon === 'dim' ? '#839aac' : '#c8d6f2';
      x.fillStyle = col; x.fillRect(mx + xx, my + yy, 1, 1);
    }
    x.fillStyle = B.moon === 'dim' ? '#7e92a4' : '#c2d0ec';
    [[-4, -3, 3, 2], [2, 3, 2, 2], [4, -5, 2, 1], [-2, 5, 1, 1], [-6, 2, 2, 1]].forEach(([a, b, w, h]) => x.fillRect(mx + a, my + b, w, h));
  }
  if (B.redmoon) {
    const mx = 300, my = 70, mr = 22;
    for (let yy = -mr - 16; yy <= mr + 16; yy++) for (let xx = -mr - 16; xx <= mr + 16; xx++) {
      const d = Math.hypot(xx, yy);
      if (d <= mr) { x.fillStyle = (xx + yy) / mr > 0.6 ? '#8a1414' : bayer(xx, yy) < 0.15 ? '#ff7a1a' : '#c8332b'; x.fillRect(mx + xx, my + yy, 1, 1); }
      else if (d < mr + 16 && bayer(mx + xx, my + yy) < (1 - (d - mr) / 16) * 0.5) { x.fillStyle = '#5a140c'; x.fillRect(mx + xx, my + yy, 1, 1); }
    }
  }
  return (_sky[bk] = { c, stars });
}

// ---------- Clouds ----------
const _clouds = {};
function buildClouds(key, color, seed, h, count, thresh) {
  if (_clouds[key]) return _clouds[key];
  const CW = 768, R = rng(seed), [c, x] = mkCanvas(CW, h), blobs = [];
  for (let i = 0; i < count; i++) blobs.push([R() * CW, h * 0.35 + R() * h * 0.45, 18 + R() * 46, 6 + R() * 10]);
  const hi = shade(color, 0.28), lo = shade(color, -0.35);
  for (let yy = 0; yy < h; yy++) for (let xx = 0; xx < CW; xx++) {
    let v = 0;
    for (const [bx, by, rx, ry] of blobs) { let dx = Math.abs(xx - bx); dx = Math.min(dx, CW - dx); const d = (dx / rx) ** 2 + ((yy - by) / ry) ** 2; if (d < 1) v += 1 - d; }
    if (v <= thresh + bayer(xx, yy) * 0.35) continue;
    let col = color;
    if (v > thresh + 0.9 && bayer(xx, yy + 1) < 0.6) col = hi;
    else if (v < thresh + 0.3) col = lo;
    x.fillStyle = col; x.fillRect(xx, yy, 1, 1);
  }
  return (_clouds[key] = c);
}

// ---------- Horizon ----------
const _horizon = {};
function buildHorizon(bk) {
  if (_horizon[bk]) return _horizon[bk];
  const B = BIOMES[bk], R = rng('hz' + bk), [c, x] = mkCanvas(W, H), lights = [];
  const far = shade(B.sky[1], -0.25), near = shade(B.sky[0], -0.35);
  const px = (col, a, b, w = 1, h = 1) => { x.fillStyle = col; x.fillRect(a, b, w, h); };
  const kind = B.horizon;
  if (kind === 'hills' || kind === 'pines' || kind === 'peaks' || kind === 'volcanoes') {
    for (let layer = 0; layer < 2; layer++) {
      const base = layer ? 196 : 178, col = layer ? near : far, amp = kind === 'peaks' ? 26 : kind === 'volcanoes' ? 20 : 10;
      const ph = R() * 10;
      for (let xx = 0; xx < W; xx++) {
        let hgt;
        if (kind === 'pines') { const k = (xx + (layer * 5)) % (7 + layer * 2); hgt = 8 + Math.abs(k - (3 + layer)) * -2 + 6 + Math.sin(xx * 0.05 + ph) * 5 + (hash2(xx >> 3, layer) * 6); }
        else if (kind === 'peaks') hgt = Math.abs(((xx * 0.9 + ph * 40) % 90) - 45) * -0.9 + amp + Math.sin(xx * 0.3) * 1.5;
        else if (kind === 'volcanoes') { const m = ((xx + ph * 50 + layer * 60) % 150) - 75; hgt = Math.max(2, amp + 8 - Math.abs(m) * 0.5); if (Math.abs(m) < 6) hgt = amp + 5; }
        else hgt = amp + Math.sin(xx * 0.018 + ph) * 8 + Math.sin(xx * 0.05 + ph * 2) * 3;
        const top = Math.round(base - hgt);
        px(col, xx, top, 1, H - top);
        if (kind === 'peaks' && bayer(xx, top) < 0.7) px(layer ? '#6a82c4' : '#3f4f8a', xx, top, 1, 2);
      }
      if (kind === 'volcanoes') for (let xx = 0; xx < W; xx++) { const m = ((xx + ph * 50 + layer * 60) % 150) - 75; if (Math.abs(m) < 5) { const top = Math.round(base - amp - 5); px('#ff7a1a', xx, top, 1, 1); if (!layer && Math.abs(m) < 2) lights.push([xx, top, 8, 'red']); } }
    }
    if (kind === 'hills') {
      for (const hx of [14, 30, 46, 336, 352, 368]) {
        const hy = 186 + ((R() * 4) | 0);
        px(near, hx - 3, hy - 5, 7, 6); px(near, hx - 2, hy - 7, 5, 2); px(near, hx - 1, hy - 8, 3, 1);
        if (R() < 0.8) { px('#ffd35c', hx - 1, hy - 3, 1, 1); lights.push([hx - 1, hy - 3, 3, 'warm', 1]); }
        if (R() < 0.5) { px('#ffd35c', hx + 1, hy - 3, 1, 1); }
      }
      px(near, 360, 172, 2, 16); px(near, 358, 180, 6, 8); px('#ffd35c', 360, 176, 1, 1);
    }
  } else if (kind === 'crystals' || kind === 'isles' || kind === 'ruins' || kind === 'roots') {
    for (let i = 0; i < 16; i++) {
      const bx = (R() * W) | 0, by = 160 + ((R() * 40) | 0), s = 4 + ((R() * 10) | 0);
      if (kind === 'crystals') { for (let k = 0; k < s * 2; k++) px(k < 2 ? '#6fe8f0' : far, bx - Math.floor(k / 4), by - s * 2 + k, 1 + Math.floor(k / 2), 1); lights.push([bx, by - s * 2, 4, 'cool', 1]); }
      else if (kind === 'isles') { const w2 = s * 2; px(far, bx - w2, by, w2 * 2, 2); for (let k = 0; k < w2; k++) px(far, bx - w2 + k, by + 2, w2 * 2 - k * 2, 1); px('#6b3a9a', bx - w2, by - 1, w2 * 2, 1); if (R() < 0.5) { px('#a86ad8', bx, by - 3, 1, 2); lights.push([bx, by - 3, 3, 'purple', 1]); } }
      else if (kind === 'ruins') { px(far, bx, by - s * 2, 4, s * 2 + 40); if (R() < 0.5) px(far, bx - 3, by - s * 2, 10, 2); }
      else { let rx = bx; for (let k = 0; k < 30 + s * 3; k++) { px(k < 10 ? near : far, rx, k, 1 + (k < 8), 1); if (hash2(bx, k) < 0.2) rx += hash2(k, bx) < 0.5 ? -1 : 1; } }
    }
    if (kind !== 'roots') for (let xx = 0; xx < W; xx++) px(near, xx, 200 + Math.round(Math.sin(xx * 0.04) * 3), 1, 40);
  }
  return (_horizon[bk] = { c, lights });
}

// ---------- Island ----------
const UNDER = {
  earth:   { lip: '#2f5a3a', face: '#5a3a28', mid: '#4a2e22', deep: '#2e1c18', deeper: '#1c1216', rock: '#5a4a3a', rockHi: '#8a7a66', root: '#3a2418', glow: null },
  rock:    { lip: '#3a3450', face: '#4a4458', mid: '#34304a', deep: '#221f34', deeper: '#141222', rock: '#5a5670', rockHi: '#8a86a0', root: '#26222e', glow: 'cool' },
  crystal: { lip: '#5a3a8a', face: '#3b1f5a', mid: '#2e1848', deep: '#1e1034', deeper: '#120a22', rock: '#6b3a9a', rockHi: '#a86ad8', root: '#2a1440', glow: 'purple' },
  ice:     { lip: '#a8c6f0', face: '#4a6a9a', mid: '#3a5a8a', deep: '#284070', deeper: '#18284a', rock: '#6a82c4', rockHi: '#cfe0ff', root: '#a8c6f0', glow: 'icicle' },
  basalt:  { lip: '#3a2a2a', face: '#2a1c1c', mid: '#1e1414', deep: '#140c0c', deeper: '#0a0606', rock: '#3a2e2a', rockHi: '#5a4a44', root: '#2a1a14', glow: 'lava' },
  mossy:   { lip: '#1f6a5a', face: '#3a2e40', mid: '#2e2438', deep: '#1e182a', deeper: '#120e1c', rock: '#4a4460', rockHi: '#7a7098', root: '#1f6a5a', glow: 'moss' },
};
const _island = {};
// Per-area silhouette: side bites and ledges live only in the margins around the play grid,
// so the shape changes the look of each isle without touching a single playable tile.
const UNDERSIDES = ['lens', 'twin', 'spire', 'shelf', 'tiered'];
function islandShape(areaKey) {
  const A = AREAS[areaKey], R = rng('shape' + areaKey), o = A.isle || {};
  const pick = a => a[(R() * a.length) | 0];
  const sh = { under: o.under || pick(UNDERSIDES), rl: o.r || 4 + ((R() * 9) | 0), rr: o.r || 4 + ((R() * 9) | 0), cuts: [], debris: o.debris !== undefined ? o.debris : (R() * 4) | 0 };
  for (const side of [-1, 1]) {
    const n = o.cuts === 0 ? 0 : 1 + ((R() * 2) | 0); let y = ITOP + 12 + ((R() * 20) | 0);
    for (let k = 0; k < n && y < IFRONT - 30; k++) {
      const len = 14 + ((R() * 30) | 0), y1 = Math.min(IFRONT - 14, y + len);
      if (y1 - y >= 10) sh.cuts.push({ side, y0: y, y1, d: R() < 0.45 ? -(7 + ((R() * 7) | 0)) : 9 + ((R() * 12) | 0) }); // d<0 bite, d>0 ledge
      y = y1 + 10 + ((R() * 24) | 0);
    }
  }
  return sh;
}
function islandMaskFor(sh) {
  const m = new Uint8Array(W * (H + 40));
  const round = (x, y, x0, y0, x1, y1, r) => { // inside rect with rounded corners
    if (x < x0 || x > x1 || y < y0 || y > y1) return false;
    const cx = Math.min(Math.max(x, x0 + r), x1 - r), cy = Math.min(Math.max(y, y0 + r), y1 - r);
    return Math.hypot(x - cx, y - cy) <= r + 0.2;
  };
  for (let y = ITOP - 2; y < IFRONT; y++) for (let x = 0; x < W; x++) {
    let on = x >= IX0 && x < IX1 && y >= ITOP;
    if (on) { const r = x < (IX0 + IX1) / 2 ? sh.rl : sh.rr, cx = x < IX0 + r ? IX0 + r : x >= IX1 - r ? IX1 - r - 1 : x, cy = y < ITOP + r ? ITOP + r : y; on = Math.hypot(x - cx, y - cy) <= r + 0.2; }
    for (const c of sh.cuts) {
      const edge = c.side < 0 ? IX0 : IX1 - 1;
      if (c.d < 0) { const x0 = c.side < 0 ? edge - 4 : edge + c.d + 1, x1 = c.side < 0 ? edge - c.d - 1 : edge + 4; if (round(x, y, x0, c.y0, x1, c.y1, 3)) on = false; }
      else { const x0 = c.side < 0 ? edge - c.d : edge - 4, x1 = c.side < 0 ? edge + 4 : edge + c.d; if (round(x, y, x0, c.y0, x1, c.y1, 4)) on = true; }
    }
    if (on) m[y * W + x] = 1;
  }
  return (x, y) => x >= 0 && x < W && y >= 0 && y < H + 40 && m[y * W + x] === 1;
}
let islandMask = () => false;
function undersideDepth(kind, u, walk) {
  const lens = Math.pow(Math.max(0, 1 - Math.abs(u) ** 1.6), 1.3);
  const bump = v => Math.pow(Math.max(0, 1 - Math.abs(v / 0.55) ** 1.6), 1.3);
  if (kind === 'twin') return 4 + 40 * Math.max(bump(u + 0.45), bump(u - 0.45)) + 8 * lens + walk * 2;
  if (kind === 'spire') return 3 + 16 * lens + 58 * Math.pow(Math.max(0, 1 - Math.abs(u) * 2.2), 2) + walk * 1.5;
  if (kind === 'shelf') return 4 + 22 * Math.pow(Math.max(0, 1 - Math.abs(u) ** 3), 0.7) + walk * 2.5;
  if (kind === 'tiered') return 3 + 12 * Math.round(3.4 * lens) + walk;
  return 3 + 44 * lens + walk * 2;
}
function buildIsland(areaKey) {
  if (_island[areaKey]) return _island[areaKey];
  const A = AREAS[areaKey], B = BIOMES[A.biome], U = UNDER[B.under], R = rng('isle' + areaKey), [c, x] = mkCanvas(W, H + 40), lights = [];
  const sh = islandShape(areaKey); islandMask = islandMaskFor(sh);
  const px = (col, a, b, w = 1, h = 1) => { x.fillStyle = col; x.fillRect(a, b, w, h); };
  const top = IFRONT + LIP, cxm = (IX0 + IX1) / 2, hw = (IX1 - IX0) / 2;
  // underside profile
  const depth = []; let walk = 0;
  for (let xx = IX0; xx < IX1; xx++) {
    const u = (xx + 0.5 - cxm) / hw; walk += (R() - 0.5) * 2.2; walk *= 0.92;
    let d = undersideDepth(sh.under, u, walk);
    if (R() < 0.05) d += 6 + R() * 10;
    depth.push(Math.max(3, Math.round(d)));
  }
  for (let i = 1; i < depth.length - 1; i++) if (depth[i] > depth[i - 1] + 8 && depth[i] > depth[i + 1] + 8) depth[i] -= 4;
  for (let xx = IX0; xx < IX1; xx++) {
    const d = depth[xx - IX0], u = (xx - cxm) / hw;
    for (let yy = 0; yy < d; yy++) {
      const t = yy / 44 + Math.max(0, u) * 0.3 - Math.max(0, -u) * 0.08 + (bayer(xx, yy) - 0.5) * 0.22 + Math.sin(xx * 0.09 + yy * 0.02) * 0.04;
      const edge = yy >= d - 2;
      px(yy < 2 ? U.deeper : edge ? U.deeper : t < 0.18 ? U.face : t < 0.42 ? U.mid : t < 0.7 ? U.deep : U.deeper, xx, top + yy);
    }
    if (xx === IX0 || xx === IX1 - 1) px(U.deeper, xx, top, 1, d);
    if (sh.under === 'tiered' && xx > IX0 && depth[xx - IX0 - 1] !== d) px(U.rockHi, xx, top + Math.min(d, depth[xx - IX0 - 1]) - 1, 1, 1); // catch-light on each step
  }
  // drifting rock chunks beside the isle
  for (let i = 0; i < sh.debris; i++) {
    const left = i % 2 === 0, w = 7 + ((R() * 9) | 0), h = 3 + ((R() * 3) | 0);
    const bx = left ? 14 + ((R() * 34) | 0) : W - 14 - w - ((R() * 34) | 0), by = 150 + ((R() * 60) | 0);
    for (let xx = 0; xx < w; xx++) {
      const taper = Math.round(h + (w / 2 - Math.abs(xx - w / 2 + 0.5)) * 0.7 * (0.7 + R() * 0.3));
      for (let yy = 0; yy < taper; yy++) px(yy < 2 ? U.lip : yy === 2 ? U.face : yy >= taper - 1 ? U.deeper : bayer(xx, yy) < 0.4 ? U.mid : U.deep, bx + xx, by + yy);
    }
    px(shade(U.lip, 0.35), bx + 1, by, w - 2, 1);
  }
  // embedded rocks
  for (let i = 0; i < 34; i++) {
    const xx = IX0 + 6 + ((R() * (IX1 - IX0 - 12)) | 0), d = depth[xx - IX0]; if (d < 10) continue;
    const yy = top + 3 + ((R() * (d - 8)) | 0), w = 2 + ((R() * 4) | 0), h = 2 + ((R() * 2) | 0);
    px(U.rock, xx, yy, w, h); px(U.rockHi, xx, yy, w - 1, 1); px(U.deeper, xx + 1, yy + h, w - 1, 1);
  }
  // hanging roots
  for (let i = 0; i < 16; i++) {
    let xx = IX0 + 8 + ((R() * (IX1 - IX0 - 16)) | 0); const d = depth[xx - IX0]; let yy = top + d - 2; const len = 6 + ((R() * 20) | 0);
    for (let k = 0; k < len; k++) { px(U.root, xx, yy + k); if (R() < 0.25) xx += R() < 0.5 ? -1 : 1; }
  }
  // biome glow bits under the island
  if (U.glow) for (let i = 0; i < 14; i++) {
    const xx = IX0 + 10 + ((R() * (IX1 - IX0 - 20)) | 0), d = depth[xx - IX0], yy = top + Math.max(4, d - 3 - ((R() * 10) | 0));
    if (U.glow === 'cool' || U.glow === 'purple') { const col = U.glow === 'cool' ? '#6fe8f0' : '#a86ad8'; px(col, xx, yy, 1, 3); px(shade(col, 0.4), xx, yy, 1, 1); px(col, xx - 1, yy + 1, 1, 1); lights.push([xx, yy + 1, 5, U.glow]); }
    else if (U.glow === 'icicle') { const L = 3 + ((R() * 8) | 0); for (let k = 0; k < L; k++) px(k < 2 ? '#cfe0ff' : '#a8c6f0', xx, top + depth[xx - IX0] - 1 + k, k < L - 2 ? 2 : 1, 1); }
    else if (U.glow === 'lava') { px('#ff7a1a', xx, yy, 1, 2); px('#ffd35c', xx, yy, 1, 1); lights.push([xx, yy, 5, 'red']); }
    else if (U.glow === 'moss') { const L = 4 + ((R() * 8) | 0); for (let k = 0; k < L; k++) px('#2f7a4a', xx, top + depth[xx - IX0] - 2 + k); px('#ff6fb0', xx, top + depth[xx - IX0] - 2 + L); lights.push([xx, top + depth[xx - IX0] + L, 3, 'pink']); }
  }
  // front lip
  for (let xx = IX0; xx < IX1; xx++) {
    const corner = xx < IX0 + 3 || xx >= IX1 - 3;
    for (let yy = 0; yy < LIP; yy++) {
      if (corner && yy === 0 && (xx === IX0 || xx === IX1 - 1)) continue;
      px(yy < 2 ? U.lip : (bayer(xx, yy) < 0.3 ? U.mid : U.face), xx, IFRONT + yy);
    }
    if (R() < 0.3) px(U.lip, xx, IFRONT + LIP, 1, 1 + ((R() * 2) | 0));
  }
  // top surface: ground tiles
  const [gname, gn] = B.ground;
  for (let ty = ITOP - 8; ty < IFRONT; ty += TILE) for (let tx = IX0 - TILE; tx < IX1 + TILE; tx += TILE) {
    const v = Math.floor(hash2(tx, ty + areaKey.length) * gn), s = spr(gname + '_' + v);
    for (let yy = 0; yy < TILE; yy++) for (let xx = 0; xx < TILE; xx++) {
      const X = tx + xx, Y = ty + yy; if (!islandMask(X, Y)) continue;
      x.drawImage(s.c, xx, yy, 1, 1, X, Y, 1, 1);
    }
  }
  // cliff faces under every other downward-facing edge (ledges and bites)
  for (let xx = 0; xx < W; xx++) for (let yy = ITOP; yy < IFRONT - 1; yy++) {
    if (!islandMask(xx, yy) || islandMask(xx, yy + 1)) continue;
    const ledge = xx < IX0 || xx >= IX1, n = ledge ? LIP + 2 + ((hash2(xx, 7) * 3) | 0) : LIP;
    for (let k = 1; k <= n && !islandMask(xx, yy + k); k++) px(k <= 2 ? U.lip : k >= n - 1 ? U.deeper : (bayer(xx, yy + k) < 0.3 ? U.mid : U.face), xx, yy + k);
  }
  // some floors need to sit back so walls and hazards read clearly
  const dim = { ruins: ['#0b0d1a', 0.45], frozen: ['#1b2a4a', 0.5], cave: ['#04050c', 0.2] }[A.biome];
  if (dim) { x.fillStyle = dim[0]; for (let yy = GY; yy < GY + ROWS * TILE; yy++) for (let xx = 0; xx < W; xx++) if (islandMask(xx, yy) && bayer(xx, yy) < dim[1]) x.fillRect(xx, yy, 1, 1); }
  // margins slightly darker so the playable grid reads clearly
  x.fillStyle = '#000000';
  for (let yy = ITOP; yy < IFRONT; yy++) for (let xx = 0; xx < W; xx++) {
    if (!islandMask(xx, yy)) continue;
    const inGrid = xx >= GX && xx < GX + COLS * TILE && yy >= GY && yy < GY + ROWS * TILE;
    if (!inGrid && bayer(xx, yy) < 0.3) { x.globalAlpha = 0.5; x.fillRect(xx, yy, 1, 1); x.globalAlpha = 1; }
  }
  // rim: moonlit back edge, dark sides
  for (let xx = 0; xx < W; xx++) for (let yy = ITOP - 2; yy < IFRONT; yy++) if (islandMask(xx, yy) && !islandMask(xx, yy - 1)) px(shade(U.lip, 0.35), xx, yy);
  for (let yy = ITOP; yy < IFRONT; yy++) for (let xx = 1; xx < W - 1; xx++) if (islandMask(xx, yy) && (!islandMask(xx - 1, yy) || !islandMask(xx + 1, yy)) && islandMask(xx, yy - 1)) px(U.deeper, xx, yy);
  // subtle grid boundary ticks at corners
  const gx1 = GX + COLS * TILE - 1, gy1 = GY + ROWS * TILE - 1;
  x.fillStyle = 'rgba(0,0,0,0.35)';
  x.fillRect(GX - 1, GY - 1, 3, 1); x.fillRect(GX - 1, GY - 1, 1, 3); x.fillRect(gx1 - 1, GY - 1, 3, 1); x.fillRect(gx1 + 1, GY - 1, 1, 3);
  x.fillRect(GX - 1, gy1 + 1, 3, 1); x.fillRect(GX - 1, gy1 - 1, 1, 3); x.fillRect(gx1 - 1, gy1 + 1, 3, 1); x.fillRect(gx1 + 1, gy1 - 1, 1, 3);
  return (_island[areaKey] = { c, lights, depth });
}

// ---------- Particles / weather ----------
class Weather {
  constructor() { this.rain = []; this.splash = []; this.flakes = []; this.embers = []; this.flies = []; this.motes = []; this.sparks = []; this.bolt = null; this.flash = 0; this.nextBolt = 4000; }
  reset(biome) {
    this.b = biome; const R = Math.random;
    const n = biome.rain === 'light' ? 40 : biome.rain ? 90 : 0;
    this.rain = Array.from({ length: n }, () => ({ x: R() * (W + 40), y: R() * H, v: 170 + R() * 90, stop: R() < 0.6 ? ITOP + R() * (IFRONT - ITOP) : H + 4, l: 3 + (R() * 3 | 0) }));
    this.flakes = biome.snow ? Array.from({ length: 90 }, () => ({ x: R() * W, y: R() * H, v: 8 + R() * 16, p: R() * 6, s: R() < 0.2 ? 2 : 1 })) : [];
    this.embers = biome.embers ? Array.from({ length: 50 }, () => ({ x: R() * W, y: R() * H, v: 10 + R() * 22, p: R() * 6 })) : [];
    this.flies = biome.fireflies ? Array.from({ length: 14 }, () => ({ x: GX + R() * COLS * TILE, y: GY + R() * ROWS * TILE, p: R() * 6, q: R() * 6 })) : [];
    this.motes = (biome.motes || biome.spores) ? Array.from({ length: 36 }, () => ({ x: R() * W, y: R() * H, v: 3 + R() * 7, p: R() * 6, c: biome.spores && R() < 0.5 ? '#ff6fb0' : (biome.motes || '#9be06a') })) : [];
    this.splash = []; this.sparks = []; this.flash = 0; this.bolt = null;
  }
  update(dt, t) {
    const s = dt / 1000;
    for (const d of this.rain) { d.y += d.v * s; d.x -= d.v * s * 0.12; if (d.y >= d.stop) { if (d.stop < H && d.x > IX0 && d.x < IX1) this.splash.push({ x: d.x, y: d.stop, t: 0 }); d.y = -10 - Math.random() * 40; d.x = Math.random() * (W + 40); d.stop = Math.random() < 0.6 ? ITOP + Math.random() * (IFRONT - ITOP) : H + 4; } }
    this.splash = this.splash.filter(p => (p.t += dt) < 160);
    for (const f of this.flakes) { f.y += f.v * s; f.x += Math.sin(t / 900 + f.p) * 0.25; if (f.y > H) { f.y = -2; f.x = Math.random() * W; } }
    for (const e of this.embers) { e.y -= e.v * s; e.x += Math.sin(t / 500 + e.p) * 0.3; if (e.y < -2) { e.y = H + 2; e.x = Math.random() * W; } }
    for (const m of this.motes) { m.y -= m.v * s; m.x += Math.sin(t / 1200 + m.p) * 0.15; if (m.y < -2) { m.y = H + 2; m.x = Math.random() * W; } }
    for (const f of this.flies) { f.x += Math.sin(t / 1300 + f.p) * 0.25; f.y += Math.cos(t / 1100 + f.q) * 0.2; }
    for (const p of this.sparks) { p.t += dt; p.x += p.vx * s; p.y += p.vy * s; p.vy += (p.g || 0) * s; }
    this.sparks = this.sparks.filter(p => p.t < p.life);
    if (this.b && this.b.lightning) {
      this.nextBolt -= dt;
      if (this.nextBolt <= 0) { this.nextBolt = 6000 + Math.random() * 9000; this.flash = 1; this.boltT = 0; this.bolt = this.makeBolt(); if (window.Sfx) setTimeout(() => Sfx.play('thunder'), 250); }
    }
    if (this.flash > 0) { this.flash = Math.max(0, this.flash - dt / 380); this.boltT += dt; }
  }
  makeBolt() { const pts = []; let x = 40 + Math.random() * 300, y = 0; while (y < 150) { pts.push([x, y]); x += (Math.random() - 0.5) * 16; y += 6 + Math.random() * 10; } return pts; }
  burst(x, y, n, colors, opts = {}) {
    for (let i = 0; i < n; i++) { const a = Math.random() * Math.PI * 2, v = (opts.speed || 40) * (0.4 + Math.random()); this.sparks.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v - (opts.up || 0), g: opts.g === undefined ? 60 : opts.g, t: 0, life: (opts.life || 500) * (0.6 + Math.random() * 0.6), c: colors[(Math.random() * colors.length) | 0] }); }
  }
  drawBehind(ctx, t, lights) { // world-space particles that get lit
    for (const e of this.embers) { ctx.fillStyle = (Math.floor(t / 150 + e.p * 3) % 3) ? '#ff7a1a' : '#ffd35c'; ctx.fillRect(e.x | 0, e.y | 0, 1, 1); }
    for (const m of this.motes) { ctx.fillStyle = m.c; ctx.fillRect(m.x | 0, m.y | 0, 1, 1); }
    for (const f of this.flies) { const on = Math.sin(t / 400 + f.p * 5) > -0.2; if (!on) continue; ctx.fillStyle = '#d8ff7a'; ctx.fillRect(f.x | 0, f.y | 0, 1, 1); lights.push([f.x, f.y, 6, 'green', 1]); }
  }
  drawSparks(ctx) { for (const p of this.sparks) { ctx.fillStyle = p.c; ctx.fillRect(p.x | 0, p.y | 0, p.size || 1, p.size || 1); } }
  drawFront(ctx, t) { // after lighting
    if (this.rain.length) { ctx.fillStyle = '#6a82c4'; for (const d of this.rain) ctx.fillRect(d.x | 0, d.y | 0, 1, d.l); ctx.fillStyle = '#a8c6f0'; for (const p of this.splash) { const k = p.t < 80 ? 1 : 2; ctx.fillRect((p.x | 0) - k, p.y | 0, 1, 1); ctx.fillRect((p.x | 0) + k, p.y | 0, 1, 1); if (k === 1) ctx.fillRect(p.x | 0, (p.y | 0) - 1, 1, 1); } }
    if (this.flakes.length) { ctx.fillStyle = '#dfe8ff'; for (const f of this.flakes) ctx.fillRect(f.x | 0, f.y | 0, f.s, f.s); }
    if (this.flash > 0 && this.bolt && this.boltT < 220) {
      ctx.fillStyle = '#eef4ff';
      for (let i = 0; i < this.bolt.length - 1; i++) { const [x0, y0] = this.bolt[i], [x1, y1] = this.bolt[i + 1], n = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0)); for (let k = 0; k <= n; k++) ctx.fillRect(Math.round(x0 + (x1 - x0) * k / n), Math.round(y0 + (y1 - y0) * k / n), 1, 1); }
    }
  }
}

// bottom mist, drawn in front of the island underside
function drawMist(ctx, t, color) {
  for (let layer = 0; layer < 2; layer++) {
    const off = (t / (layer ? 90 : 160)) % 64, base = layer ? 230 : 222;
    ctx.fillStyle = layer ? shade(color, 0.1) : color;
    for (let y = base; y < H; y++) {
      const dens = Math.min(0.7, (y - base) / 26 + 0.02);
      for (let x = 0; x < W; x++) {
        const wave = Math.sin((x + off * (layer ? 1 : -1)) * 0.06 + layer) * 0.18 + Math.sin((x - off) * 0.021) * 0.12;
        if (bayer(x, y) < dens + wave) ctx.fillRect(x, y, 1, 1);
      }
    }
  }
}
// Pre-rendered mist frames (it's expensive per-pixel), cycled for animation.
const _mist = {};
function mistFrames(color) {
  if (_mist[color]) return _mist[color];
  const frames = [];
  for (let i = 0; i < 16; i++) { const [c, x] = mkCanvas(W, H); drawMist(x, i * 640, color); frames.push(c); }
  return (_mist[color] = frames);
}
