// Mixer: music and effects each get a bus (volume slider), music ducks under big moments,
// and a limiter on the master keeps stacked effects from clipping.
const Mixer = {
  ctx: null, master: null, musicBus: null, duckGain: null, sfxBus: null,
  init() {
    if (this.ctx) return;
    try {
      const c = this.ctx = new (window.AudioContext || window.webkitAudioContext)();
      const lim = c.createDynamicsCompressor();
      lim.threshold.value = -4; lim.knee.value = 2; lim.ratio.value = 20; lim.attack.value = 0.002; lim.release.value = 0.12;
      this.master = c.createGain(); this.master.connect(lim); lim.connect(c.destination);
      this.duckGain = c.createGain(); this.duckGain.connect(this.master);
      this.musicBus = c.createGain(); this.musicBus.connect(this.duckGain);
      this.sfxBus = c.createGain(); this.sfxBus.connect(this.master);
      this.apply();
    } catch (e) { this.ctx = null; }
  },
  apply() {
    if (!this.ctx) return;
    // a short linear ramp, not setTargetAtTime: an idle bus reports a stale value and the curve would start from it
    const t = this.ctx.currentTime, set = (g, v) => { g.gain.cancelScheduledValues(t); g.gain.setValueAtTime(g.gain.value, t); g.gain.linearRampToValueAtTime(v, t + 0.05); };
    set(this.musicBus, Settings.muted ? 0 : volumeGain(Settings.music));
    set(this.sfxBus, Settings.muted ? 0 : volumeGain(Settings.sfx));
  },
  duck(db, ms) {
    if (!this.ctx) return;
    const g = this.duckGain.gain, t = this.ctx.currentTime;
    g.cancelScheduledValues(t); g.setTargetAtTime(Math.pow(10, db / 20), t, 0.03); g.setTargetAtTime(1, t + ms / 1000, 0.25);
  },
};

// Music: Austin Ginder — "Tiny Bit Adventures". Crossfades between area tracks and remembers each track's position.
// Tracks are levelled to one loudness (measured integrated LUFS below) so no area jumps out.
const TRACK_LUFS = { title: -14.7, battle: -14.6, dream: -14.9, blitz: -14.3, void: -15.8, win: -14.3, forest: -14.3, slims: -14.2, plasma: -15.6, home: -13.6 };
const MUSIC_TARGET_LUFS = -15.5;
const Music = {
  els: {}, current: null, wanted: null, onTrack: null,
  get muted() { return Settings.muted; },
  init() {
    document.addEventListener('visibilitychange', () => {
      const a = this.current && this.els[this.current];
      if (document.hidden) { if (a) a.pause(); if (Mixer.ctx) Mixer.ctx.suspend(); }
      else { if (Mixer.ctx) Mixer.ctx.resume(); if (a) { const p = a.play(); if (p && p.catch) p.catch(() => {}); } }
    });
  },
  el(key) {
    if (!this.els[key]) {
      const a = new Audio();
      a.crossOrigin = 'anonymous'; // B2 sends CORS headers, which Web Audio needs to hear the stream
      a.src = MUSIC_BASE + encodeURIComponent(TRACKS[key]) + '.webm';
      a.loop = true; a.preload = 'auto';
      if (Mixer.ctx) {
        const src = Mixer.ctx.createMediaElementSource(a), trim = Mixer.ctx.createGain();
        trim.gain.value = Math.pow(10, (MUSIC_TARGET_LUFS - (TRACK_LUFS[key] || MUSIC_TARGET_LUFS)) / 20);
        a._gain = Mixer.ctx.createGain(); a._gain.gain.value = 0;
        src.connect(trim); trim.connect(a._gain); a._gain.connect(Mixer.musicBus);
      } else a.volume = 0;
      // a failed load forgets the track so the next request tries again
      a.addEventListener('error', () => { if (this.els[key] === a) delete this.els[key]; if (this.current === key) this.current = null; });
      this.els[key] = a;
    }
    return this.els[key];
  },
  play(key) {
    if (!TRACKS[key]) return;
    this.wanted = key;
    if (this.current === key) return;
    const prev = this.current ? this.els[this.current] : null, prevKey = this.current;
    this.current = key;
    if (prev) this.fade(prev, 0, 900, () => { if (this.current !== prevKey) prev.pause(); });
    const a = this.el(key);
    const p = a.play();
    if (p && p.catch) p.catch(() => { if (this.current === key) this.current = null; }); // blocked: retried on the next tap or key
    this.fade(a, 1, 1200);
    if (this.onTrack) this.onTrack(TRACKS[key].replace(/^\d+-/, ''));
  },
  retry() { if (this.wanted && !this.current) this.play(this.wanted); },
  fade(a, to, ms, done) {
    if (a._gain) {
      const g = a._gain.gain, t = Mixer.ctx.currentTime;
      g.cancelScheduledValues(t); g.setValueAtTime(g.value, t); g.linearRampToValueAtTime(to, t + ms / 1000);
      clearTimeout(a._done); if (done) a._done = setTimeout(done, ms);
      return;
    }
    // no Web Audio: fall back to element volume (desktop only; iOS ignores it)
    clearInterval(a._fade);
    const target = to * (Settings.muted ? 0 : volumeGain(Settings.music)), from = a.volume, t0 = performance.now();
    a._fade = setInterval(() => {
      const k = Math.min(1, (performance.now() - t0) / ms);
      a.volume = Math.max(0, Math.min(1, from + (target - from) * k));
      if (k >= 1) { clearInterval(a._fade); if (done) done(); }
    }, 30);
  },
  refresh() { // settings changed
    Mixer.apply();
    const a = this.current && this.els[this.current];
    if (a && !a._gain) this.fade(a, 1, 200);
  },
  toggle() {
    Settings.muted = !Settings.muted; Settings.save(); this.refresh();
    return Settings.muted;
  },
};

// Chiptune sound effects.
const Sfx = {
  ctx: null, gain: null, k: 1,
  init() {
    if (this.ctx) return;
    Mixer.init(); if (!Mixer.ctx) return;
    this.ctx = Mixer.ctx;
    this.gain = this.ctx.createGain(); this.gain.gain.value = 0.18; this.gain.connect(Mixer.sfxBus);
  },
  tone(type, f0, f1, dur, vol = 1, delay = 0) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime + delay, o = this.ctx.createOscillator(), g = this.ctx.createGain();
    o.type = type; o.frequency.setValueAtTime(f0, t); if (f1) o.frequency.exponentialRampToValueAtTime(f1, t + dur);
    g.gain.setValueAtTime(vol * this.k, t); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g); g.connect(this.gain); o.start(t); o.stop(t + dur + 0.02);
  },
  noise(dur, vol = 1, delay = 0, hp = 800) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime + delay, n = Math.floor(this.ctx.sampleRate * dur), buf = this.ctx.createBuffer(1, n, this.ctx.sampleRate), d = buf.getChannelData(0);
    for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / n);
    const s = this.ctx.createBufferSource(), g = this.ctx.createGain(), f = this.ctx.createBiquadFilter();
    f.type = 'highpass'; f.frequency.value = hp; s.buffer = buf; g.gain.value = vol * this.k;
    s.connect(f); f.connect(g); g.connect(this.gain); s.start(t);
  },
  play(name) {
    if (Music.muted || !this.ctx) return;
    this.k = Math.pow(10, (SFX_TRIM[name] || 0) / 20);
    if (SFX_DUCK[name]) Mixer.duck(...SFX_DUCK[name]);
    switch (name) {
      case 'step': this.tone('triangle', 180, 140, 0.05, 0.25); break;
      case 'attack': this.noise(0.08, 0.6, 0, 1500); this.tone('square', 420, 160, 0.1, 0.5); break;
      case 'crit': this.noise(0.12, 0.8, 0, 1000); this.tone('square', 660, 220, 0.16, 0.6); break;
      case 'hurt': this.tone('sawtooth', 220, 70, 0.18, 0.6); break;
      case 'kill': this.tone('square', 520, 120, 0.18, 0.5); this.noise(0.15, 0.4, 0.05, 600); break;
      case 'pickup': this.tone('square', 660, 0, 0.06, 0.4); this.tone('square', 990, 0, 0.09, 0.4, 0.06); break;
      case 'gem': [880, 1100, 1320, 1760].forEach((f, i) => this.tone('square', f, 0, 0.08, 0.35, i * 0.05)); break;
      case 'heal': [392, 523, 659].forEach((f, i) => this.tone('triangle', f, 0, 0.12, 0.6, i * 0.07)); break;
      case 'level': [523, 659, 784, 1046, 784, 1046].forEach((f, i) => this.tone('square', f, 0, 0.12, 0.4, i * 0.08)); break;
      case 'door': this.tone('triangle', 300, 600, 0.25, 0.5); this.noise(0.2, 0.2, 0, 2000); break;
      case 'bump': this.tone('square', 90, 60, 0.08, 0.4); break;
      case 'locked': this.tone('square', 150, 0, 0.08, 0.4); this.tone('square', 110, 0, 0.12, 0.4, 0.09); break;
      case 'splash': this.noise(0.3, 0.5, 0, 400); break;
      case 'freeze': [1400, 1800, 2200].forEach((f, i) => this.tone('sine', f, 0, 0.1, 0.4, i * 0.04)); break;
      case 'spin': this.noise(0.35, 0.6, 0, 500); this.tone('sawtooth', 200, 800, 0.3, 0.4); break;
      case 'boom': this.noise(0.5, 0.9, 0, 120); this.tone('sine', 120, 40, 0.4, 0.8); break;
      case 'select': this.tone('square', 880, 0, 0.05, 0.3); break;
      case 'thunder': this.noise(1.2, 0.7, 0, 60); break;
      case 'roar': this.tone('sawtooth', 110, 55, 0.6, 0.7); this.noise(0.5, 0.4, 0, 200); break;
    }
  },
};
// Per-sound trims (dB), measured as peak 50 ms RMS of each rendered effect, so every sound lands in a tier:
// footsteps -27, menu/UI -21, feedback -17, important -14, big moments -13 (before the volume slider).
const SFX_TRIM = {
  step: 15.2, select: 16.4, bump: 12, locked: 10.3,
  pickup: 15.6, gem: 17.2, heal: 14.4, freeze: 14.4, door: 11.7, kill: 10.9, attack: 8.3, splash: 9.4,
  hurt: 17.2, level: 17.4, crit: 7.8,
  spin: 11, roar: 11.3, boom: 5.7, thunder: 7,
};
// [dB, ms]: music dips under the moments that matter
const SFX_DUCK = { hurt: [-3, 250], crit: [-3, 250], level: [-6, 900], roar: [-6, 700], boom: [-5, 500], spin: [-3, 350], thunder: [-4, 900] };
