/*
 * Fang the Fox, Game Boy Color edition: the web player.
 * Runs rom/fang.gbc in binjgb (github.com/binji/binjgb, MIT). The emulator, sound and touch code is
 * adapted from binjgb's docs/simple.js (Copyright (C) 2020 Ben Smith, MIT; parts from GB Studio,
 * Copyright (c) 2019 Chris Maltby, MIT): see vendor/LICENSE.binjgb and vendor/LICENSE.gbstudio.
 *
 * Keyboard: arrows, X = A, Z = B, Enter = Start, Shift = Select, hold F = fast forward.
 * Controllers (Gamepad API), the on-screen pad on touch screens, and a save kept in this browser.
 * On localhost the page reloads the ROM by itself when a new build lands (?live=0 turns that off).
 * ?curve=1 or 2 colours the screen like a real GBC's LCD (binjgb's SameBoy / Gambatte curves).
 */
'use strict';
const ROM_URL = 'rom/fang.gbc';
const SRAM_KEY = 'fang-gbc-sram';
const AUDIO_FRAMES = 4096, AUDIO_LATENCY_SEC = 0.1, MAX_UPDATE_SEC = 5 / 60;
const CPU_TICKS_PER_SECOND = 4194304, TICKS_PER_FRAME = 70224;
const EVENT_NEW_FRAME = 1, EVENT_AUDIO_BUFFER_FULL = 2, EVENT_UNTIL_TICKS = 4;
const BUTTONS = ['up', 'down', 'left', 'right', 'A', 'B', 'start', 'select'];
const KEYS = { ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right', KeyX: 'A', KeyZ: 'B', Enter: 'start', ShiftLeft: 'select', ShiftRight: 'select' };
const params = new URLSearchParams(location.search);
const CURVE = Math.max(0, Math.min(2, +(params.get('curve') || 0)));
const LIVE = /(^|\.)localhost$|^127\.0\.0\.1$/.test(location.hostname) && params.get('live') !== '0';
const $ = s => document.querySelector(s);
let emu = null, romStamp = '';

// ---------- input: keyboard, controllers, touch and tests all feed one set of held buttons ----------
const held = { keys: new Set(), pad: new Set(), touch: new Set(), test: new Set() };
let fastForward = false;
addEventListener('keydown', e => {
  if (e.code === 'KeyF') { fastForward = true; return; }
  const b = KEYS[e.code]; if (!b) return;
  held.keys.add(b); e.preventDefault(); showPad(false);
});
addEventListener('keyup', e => {
  if (e.code === 'KeyF') { fastForward = false; return; }
  const b = KEYS[e.code]; if (b) { held.keys.delete(b); e.preventDefault(); }
});
addEventListener('blur', () => { held.keys.clear(); fastForward = false; });
function pollGamepads() {   // standard mapping: bottom/left face = B, right/top face = A (Game Boy layout)
  held.pad.clear();
  for (const gp of navigator.getGamepads ? navigator.getGamepads() : []) {
    if (!gp) continue;
    const on = i => gp.buttons[i] && gp.buttons[i].pressed, ax = i => gp.axes[i] || 0;
    if (on(1) || on(3)) held.pad.add('A');
    if (on(0) || on(2)) held.pad.add('B');
    if (on(9)) held.pad.add('start');
    if (on(8)) held.pad.add('select');
    if (on(12) || ax(1) < -0.5) held.pad.add('up');
    if (on(13) || ax(1) > 0.5) held.pad.add('down');
    if (on(14) || ax(0) < -0.5) held.pad.add('left');
    if (on(15) || ax(0) > 0.5) held.pad.add('right');
    if (held.pad.size) showPad(false);
  }
}
function applyInput() {
  if (!emu) return;
  pollGamepads();
  for (const b of BUTTONS) emu.setButton(b, held.keys.has(b) || held.pad.has(b) || held.touch.has(b) || held.test.has(b));
}

// on-screen pad (touch screens): the d-pad reads the finger's angle, buttons are plain holds
function showPad(on) { document.body.classList.toggle('touch', on); fit(); }
addEventListener('touchstart', () => showPad(true), { passive: true });
function bindTouch() {
  const dpad = $('#dpad');
  const fromTouch = e => {
    const r = dpad.getBoundingClientRect(), t = e.targetTouches[0];
    for (const d of ['up', 'down', 'left', 'right']) held.touch.delete(d);
    if (!t) return;
    const x = (2 * (t.clientX - r.left)) / r.width - 1, y = (2 * (t.clientY - r.top)) / r.height - 1;
    if (Math.abs(x) > 0.25) held.touch.add(x < 0 ? 'left' : 'right');
    if (Math.abs(y) > 0.25) held.touch.add(y < 0 ? 'up' : 'down');
  };
  for (const ev of ['touchstart', 'touchmove', 'touchend', 'touchcancel']) dpad.addEventListener(ev, e => { fromTouch(e); e.preventDefault(); });
  for (const el of document.querySelectorAll('[data-btn]')) {
    const b = el.dataset.btn;
    el.addEventListener('touchstart', e => { held.touch.add(b); el.classList.add('down'); e.preventDefault(); });
    for (const ev of ['touchend', 'touchcancel']) el.addEventListener(ev, e => { held.touch.delete(b); el.classList.remove('down'); e.preventDefault(); });
  }
}

// ---------- the emulator ----------
class Emulator {
  constructor(module, rom, sram) {
    this.module = module;
    const size = (rom.byteLength + 0x7fff) & ~0x7fff;
    this.romPtr = module._malloc(size);
    new Uint8Array(module.HEAP8.buffer, this.romPtr, size).fill(0).set(new Uint8Array(rom));
    this.e = module._emulator_new_simple(this.romPtr, size, Sound.ctx.sampleRate, AUDIO_FRAMES, CURVE);
    if (!this.e) { module._free(this.romPtr); throw new Error('binjgb rejected the ROM'); }
    this.joypad = module._joypad_new();
    module._emulator_set_default_joypad_callback(this.e, this.joypad);
    this.sound = new Sound(module, this.e);
    this.screen = new Screen(module, this.e, $('#screen'));
    if (sram) this.loadSram(sram);
    this.paused = false; this.lastSec = 0; this.leftover = 0; this.sramDirty = false;
    this.raf = requestAnimationFrame(this.tick.bind(this));
  }
  destroy() {
    cancelAnimationFrame(this.raf);
    this.sound.destroy();
    this.module._emulator_delete(this.e);
    this.module._joypad_delete(this.joypad);
    this.module._free(this.romPtr);
  }
  withFileData(ptr, cb) {
    const buf = new Uint8Array(this.module.HEAP8.buffer, this.module._get_file_data_ptr(ptr), this.module._get_file_data_size(ptr));
    const out = cb(ptr, buf); this.module._file_data_delete(ptr); return out;
  }
  loadSram(bytes) {
    this.withFileData(this.module._ext_ram_file_data_new(this.e), (ptr, buf) => {
      if (buf.byteLength === bytes.byteLength) { buf.set(bytes); this.module._emulator_read_ext_ram(this.e, ptr); }
    });
  }
  getSram() {
    return this.withFileData(this.module._ext_ram_file_data_new(this.e), (ptr, buf) => { this.module._emulator_write_ext_ram(this.e, ptr); return new Uint8Array(buf); });
  }
  get ticks() { return this.module._emulator_get_ticks_f64(this.e); }
  setButton(b, down) { this.module['_set_joyp_' + b](this.e, down ? 1 : 0); }
  runUntil(ticks) {
    for (;;) {
      const ev = this.module._emulator_run_until_f64(this.e, ticks);
      if (ev & EVENT_NEW_FRAME) this.screen.upload();
      if (ev & EVENT_AUDIO_BUFFER_FULL) this.sound.push();
      if (ev & EVENT_UNTIL_TICKS) break;
    }
    if (this.module._emulator_was_ext_ram_updated(this.e)) this.sramDirty = true;
  }
  tick(ms) {
    this.raf = requestAnimationFrame(this.tick.bind(this));
    const sec = ms / 1000, delta = Math.max(sec - (this.lastSec || sec), 0);
    this.lastSec = sec;
    if (this.paused) return;
    applyInput();
    const deltaTicks = Math.min(delta, MAX_UPDATE_SEC) * CPU_TICKS_PER_SECOND * (fastForward ? 4 : 1);
    const until = this.ticks + deltaTicks - this.leftover;
    this.runUntil(until);
    this.leftover = (this.ticks - until) | 0;
    this.screen.render();
  }
  step(frames) {   // tests: run whole frames right now, whatever the clock says
    applyInput();
    this.runUntil(this.ticks + frames * TICKS_PER_FRAME);
    this.screen.render();
  }
}

class Sound {   // binjgb fills a buffer; each full buffer is scheduled back to back on Web Audio
  constructor(module, e) {
    this.module = module;
    this.buffer = new Uint8Array(module.HEAP8.buffer, module._get_audio_buffer_ptr(e), module._get_audio_buffer_capacity(e));
    this.startSec = 0;
    this.started = Sound.ctx.state === 'running';
    this.start = () => { Sound.ctx.resume(); this.started = true; this.unbind(); };
    if (!this.started) for (const ev of ['keydown', 'click', 'touchend']) addEventListener(ev, this.start, true);
  }
  unbind() { for (const ev of ['keydown', 'click', 'touchend']) removeEventListener(ev, this.start, true); }
  push() {
    if (!this.started || muted) return;
    const now = Sound.ctx.currentTime, soonest = now + AUDIO_LATENCY_SEC;
    this.startSec = this.startSec || soonest;
    if (this.startSec < now) { this.startSec = soonest; return; }   // fell behind (tab hidden, fast forward): start over
    const buf = Sound.ctx.createBuffer(2, AUDIO_FRAMES, Sound.ctx.sampleRate), l = buf.getChannelData(0), r = buf.getChannelData(1);
    for (let i = 0; i < AUDIO_FRAMES; i++) { l[i] = this.buffer[2 * i] * 0.5 / 255; r[i] = this.buffer[2 * i + 1] * 0.5 / 255; }
    const src = Sound.ctx.createBufferSource(); src.buffer = buf; src.connect(Sound.ctx.destination); src.start(this.startSec);
    this.startSec += AUDIO_FRAMES / Sound.ctx.sampleRate;
  }
  destroy() { this.unbind(); }
}
Sound.ctx = new AudioContext();
let muted = false;

class Screen {
  constructor(module, e, canvas) {
    this.ctx = canvas.getContext('2d');
    this.image = this.ctx.createImageData(160, 144);
    this.fb = new Uint8Array(module.HEAP8.buffer, module._get_frame_buffer_ptr(e), module._get_frame_buffer_size(e));
  }
  upload() { this.image.data.set(this.fb); }
  render() { this.ctx.putImageData(this.image, 0, 0); }
}

// ---------- save RAM in this browser ----------
const toB64 = u8 => { let s = ''; for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000)); return btoa(s); };
const fromB64 = s => Uint8Array.from(atob(s), c => c.charCodeAt(0));
function readSram() { try { const s = localStorage.getItem(SRAM_KEY); return s ? fromB64(s) : null; } catch (e) { return null; } }
function writeSram() {
  if (!emu) return;
  try { localStorage.setItem(SRAM_KEY, toB64(emu.getSram())); } catch (e) { /* private window: the save lives only this session */ }
  emu.sramDirty = false;
}
setInterval(() => { if (emu && emu.sramDirty) writeSram(); }, 1000);
addEventListener('pagehide', () => { if (emu && emu.sramDirty) writeSram(); });

// ---------- loading, and reloading when a new build lands ----------
function status(text) { $('#status').textContent = text; }
async function boot(reason) {
  const res = await fetch(ROM_URL, { cache: 'no-store' });
  if (!res.ok) { status(`No ROM at ${ROM_URL} yet: run make run in gbc/.`); return false; }
  const rom = await res.arrayBuffer();
  if (rom.byteLength < 0x8000) { status('The ROM is still being written; trying again.'); return false; }
  romStamp = stampOf(res);
  const module = await Binjgb();   // a fresh instance each time: binjgb's heap can't grow and leaks a little per emulator
  let sram = readSram();
  if (emu) { writeSram(); sram = emu.getSram(); emu.destroy(); emu = null; }
  emu = new Emulator(module, rom, sram);
  const built = res.headers.get('last-modified');
  status(`${reason}${built ? ' · built ' + new Date(built).toLocaleTimeString() : ''}${LIVE ? ' · reloads on each build' : ''}`);
  if (reason !== 'Loaded') flash();
  return true;
}
const stampOf = res => `${res.headers.get('last-modified')}|${res.headers.get('content-length')}`;
async function watch() {
  let res = null;
  try { res = await fetch(ROM_URL, { method: 'HEAD', cache: 'no-store' }); } catch (e) { /* the server is restarting; keep playing */ }
  if (res && res.ok && romStamp && stampOf(res) !== romStamp) {
    try { await boot('Reloaded'); } catch (e) { status(`Reload failed: ${e.message}`); romStamp = stampOf(res); }
  }
  setTimeout(watch, 1000);
}
function flash() { const el = $('#screen'); el.classList.remove('fresh'); void el.offsetWidth; el.classList.add('fresh'); }

// ---------- layout: the largest whole-number scale that fits ----------
function fit() {
  const touch = document.body.classList.contains('touch');
  const w = Math.min(innerWidth - 32, 960), h = innerHeight - (touch ? 300 : 200);
  const scale = Math.max(1, Math.floor(Math.min(w / 160, h / 144)));
  $('#screen').style.width = 160 * scale + 'px'; $('#screen').style.height = 144 * scale + 'px';
}
addEventListener('resize', fit);

// ---------- controls under the screen ----------
function bindButtons() {
  $('#reset').addEventListener('click', () => boot('Restarted'));
  $('#mute').addEventListener('click', e => { muted = !muted; e.currentTarget.textContent = muted ? 'Sound off' : 'Sound on'; e.currentTarget.setAttribute('aria-pressed', String(muted)); });
  $('#clear').addEventListener('click', async () => {
    if (!confirm('Delete the save kept in this browser?')) return;
    try { localStorage.removeItem(SRAM_KEY); } catch (e) { /* nothing stored */ }
    if (emu) { emu.destroy(); emu = null; }
    await boot('Save deleted');
  });
}

// ---------- hooks for Playwright ----------
let resolveReady;
window.fangEmu = {
  ready: new Promise(r => { resolveReady = r; }),
  pause() { if (emu) emu.paused = true; },
  resume() { if (emu) { emu.paused = false; emu.lastSec = 0; } },
  hold(buttons, down = true) { for (const b of [].concat(buttons)) down ? held.test.add(b) : held.test.delete(b); },
  step(frames = 1) { if (emu) emu.step(frames); },
  get frame() { return emu ? Math.floor(emu.ticks / TICKS_PER_FRAME) : 0; },
  read(addr) { return emu ? emu.module._emulator_read_mem(emu.e, addr) : 0; },
  write(addr, value) { if (emu) emu.module._emulator_write_mem(emu.e, addr, value); },
  readBlock(addr, len) { const out = []; for (let i = 0; i < len; i++) out.push(this.read(addr + i)); return out; },
  sram() { return emu ? Array.from(emu.getSram()) : []; },
};

(async () => {
  bindTouch(); bindButtons(); showPad('ontouchstart' in document.documentElement);
  let ok = await boot('Loaded');
  while (!ok) { await new Promise(r => setTimeout(r, 1000)); ok = await boot('Loaded'); }
  resolveReady(true);
  if (LIVE) watch();
})();
