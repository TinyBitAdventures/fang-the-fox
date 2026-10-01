#!/usr/bin/env node
// Turns an album song's Bitwig project into Game Boy music: gbc/music/<song>.map.js says which of the
// project's tracks play on which of the four channels, and this writes gbc/music/<song>.js, the song
// description tools/lib/song.js compiles to hUGEDriver data (the build does that part).
//   usage: node gbc/tools/music.js <song>... [--import]
//   --import runs `wavelength import` on the project first (its job lands in gbc/build/music/<song>/);
//   otherwise the last import is used.
// How a map arranges four channels out of many tracks:
//   p1, p2, wave: tracks in priority order. At every 16th-note row the channel takes the first track in
//     its list that starts a note there; a note from a track higher in the list cuts in, one lower in the
//     list waits for the note playing to end. A chord plays as an arpeggio (arp), its top note (top) or
//     its lowest (low). oct shifts a track by octaves; ins picks one of the INS sounds below.
//   noise: drum kinds (kick, snare, hat, open, perc) with the tracks (or name prefixes) that play them;
//     the kick wins a row over the snare, the snare over the hats.
//   from, to: the beats of the arrangement that loop on the Game Boy.
// Bitwig's Arpeggiator in front of an instrument is played out here (its rate, steps and accents, from
// the project), since the import keeps the notes as held.
'use strict';
const fs = require('fs'), path = require('path'), { execFileSync } = require('child_process');
const GBC = path.join(__dirname, '..'), OUT = path.join(GBC, 'build', 'music');
const PROJECTS = path.join(process.env.HOME, 'Documents', 'Bitwig Studio', 'Projects');
const args = process.argv.slice(2), IMPORT = args.includes('--import');
const ROWS_PER_BEAT = 4, PATTERN = 64;

// the sounds: pulse instruments (duty 0-3 = 12.5/25/50/75 %, NRx2 envelope: volume << 4 | decay pace),
// wave instruments (a waveform and 100/50/25 % volume), noise instruments (envelope, a pitch)
const INS = {
  duty: { lead: { duty: 2, env: 0xB0 }, soft: { duty: 1, env: 0x80 }, thin: { duty: 0, env: 0x70 }, pluck: { duty: 2, env: 0xA2 },
    'pluck-soft': { duty: 2, env: 0x62 }, bell: { duty: 1, env: 0x93 }, pad: { duty: 1, env: 0x60 } },
  wave: { bass: { wave: 0, volume: 1 }, 'bass-soft': { wave: 0, volume: 2 }, round: { wave: 1, volume: 1 }, 'round-soft': { wave: 1, volume: 2 } },
  noise: { kick: { env: 0xC1, note: 'C4' }, snare: { env: 0xA2, note: 'A5' }, clap: { env: 0x92, note: 'G5' }, hat: { env: 0x51, note: 'C7' },
    open: { env: 0x63, note: 'B6' }, perc: { env: 0x71, note: 'E6' } },
};
const WAVES = [
  [...Array(32).keys()].map(i => i >> 1),                                                                     // 0: saw (a buzzy bass)
  [...Array(32).keys()].map(i => i < 16 ? Math.round(15 * Math.sin(Math.PI * i / 16)) : 0),                // 1: a rounded half pulse (softer)
];
const NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const hugeName = n => NAMES[n % 12] + (3 + Math.floor(n / 12));   // hUGE note 0 = its "C3"
// MIDI key to hUGE note: a pulse's note 0 sounds at MIDI 36 (65.4 Hz); the wave channel sounds an octave lower
const RANGE = { p1: [36, 107], p2: [36, 107], wave: [24, 95] };
const fit = (key, ch) => { const [lo, hi] = RANGE[ch]; while (key < lo) key += 12; while (key > hi) key -= 12; return key - lo; };

function load(song) {
  const map = require(path.join(GBC, 'music', song + '.map.js'));
  const bw = path.join(PROJECTS, map.project, map.project + '.bwproject'), dir = path.join(OUT, song);
  if (IMPORT || !fs.existsSync(path.join(dir, 'job.json')) || !fs.existsSync(path.join(dir, 'list.json'))) {
    fs.rmSync(dir, { recursive: true, force: true }); fs.mkdirSync(dir, { recursive: true });
    execFileSync('wavelength', ['import', bw, '--out', dir], { stdio: 'pipe' });
    fs.writeFileSync(path.join(dir, 'list.json'), execFileSync('wavelength', ['import', bw, '--list', '--json'], { maxBuffer: 1 << 26 }));
  }
  return { map, job: JSON.parse(fs.readFileSync(path.join(dir, 'job.json'), 'utf8')), list: JSON.parse(fs.readFileSync(path.join(dir, 'list.json'), 'utf8')) };
}

// Bitwig's Arpeggiator on a track (from --list --json): rate in beats, the steps' velocities, the gate
function arpOf(list, name) {
  let found = null;
  const walk = x => { if (!x || found) return; if (Array.isArray(x)) return x.forEach(walk); if (typeof x !== 'object') return;
    if (x.name === 'Arpeggiator' && x.params && x.enabled !== false) found = x.params; else Object.values(x).forEach(walk); };
  // the list leaves Bitwig's track names empty; the import names a track after its instrument ("Digits 2" for the second)
  const seen = {}, named = (list.tracks || []).map(t => { const base = t.name || ((t.devices || [])[0] || {}).name || ''; seen[base] = (seen[base] || 0) + 1; return [seen[base] > 1 ? `${base} ${seen[base]}` : base, t]; });
  walk((named.find(([n]) => n === name) || [])[1]);
  if (!found) return null;
  const rates = [4, 2, 1, 0.5, 0.25, 0.125, 0.0625];   // RATE 0-6: 1/1 .. 1/64 of a whole note, in beats
  const steps = Math.max(1, Math.round(found.STEPS || 1));
  return { rate: rates[Math.round(found.RATE)] || 0.25, gate: found.GLOBAL_GATE ?? 1, vel: [...Array(steps).keys()].map(i => found[`STEP_${i + 1}`] ?? 1), mode: found.MODE || 0 };
}
function arpeggiate(notes, arp) {   // held notes (and chords) played out at the arp's rate
  const out = [], byStart = new Map();
  for (const n of notes) { const k = n.beat.toFixed(4); if (!byStart.has(k)) byStart.set(k, []); byStart.get(k).push(n); }
  for (const group of byStart.values()) {
    const keys = group.map(n => n.key).sort((a, b) => a - b), start = group[0].beat, end = Math.max(...group.map(n => n.beat + n.dur));
    const seq = arp.mode >= 2 && keys.length > 2 ? keys.concat(keys.slice(1, -1).reverse()) : keys;   // up-down for 3+ notes
    for (let t = start, i = 0; t < end - 1e-6; t += arp.rate, i++) out.push({ beat: t, dur: arp.rate * arp.gate, key: seq[i % seq.length], vel: arp.vel[i % arp.vel.length] });
  }
  return out;
}

function convert(song) {
  const { map, job, list } = load(song);
  const from = map.from ?? 0, to = map.to ?? Math.max(...job.tracks.flatMap(t => (t.notes || []).map(n => n.beat + n.dur)));
  const total = Math.ceil((to - from) * ROWS_PER_BEAT / PATTERN) * PATTERN;
  const track = name => {
    const t = job.tracks.find(t => t.name === name) || job.tracks.find(t => t.name.startsWith(name));
    if (!t) throw new Error(`${song}: no track "${name}" (tracks: ${job.tracks.map(t => t.name).join(', ')})`);
    const arp = arpOf(list, t.name);
    const notes = arp ? arpeggiate(t.notes || [], arp) : (t.notes || []);
    return notes.map(n => ({ row: Math.round((n.beat - from) * ROWS_PER_BEAT), len: Math.max(1, Math.round(n.dur * ROWS_PER_BEAT)), key: n.key, vel: n.vel ?? 0.8 }))
      .filter(n => n.row >= 0 && n.row < total);
  };
  const channels = {}, used = [];
  for (const ch of ['p1', 'p2', 'wave']) {
    const cands = (map[ch] || []).map(([name, o = {}]) => ({ name, o, starts: groupByRow(track(name)) }));
    used.push(...cands.map(c => c.name));
    const rows = new Array(total).fill(null).map(() => ({ t: '.' }));
    let owner = -1, ownerEnd = -1, arpFx = null;
    for (let r = 0; r < total; r++) {
      const c = cands.findIndex(c => c.starts.has(r));
      if (c >= 0 && (owner < 0 || c <= owner || r >= ownerEnd)) {
        const cand = cands[c], chord = cand.starts.get(r), o = cand.o;
        const keys = [...new Set(chord.map(n => n.key + 12 * (o.oct || 0)))].sort((a, b) => a - b);
        const how = o.chord || (ch === 'wave' ? 'low' : ch === 'p1' ? 'top' : 'arp');
        let key = how === 'top' ? keys[keys.length - 1] : keys[0];
        arpFx = null;
        if (how === 'arp' && keys.length > 1) { const x = Math.min(15, keys[1] - key), y = Math.min(15, (keys[2] ?? keys[1]) - key); arpFx = ((x << 4) | y).toString(16).padStart(3, '0'); }
        const vel = Math.max(...chord.map(n => n.vel)), ins = o.accent && vel < o.accent[0] ? o.accent[1] : (o.ins || (ch === 'wave' ? 'bass' : ch === 'p1' ? 'lead' : 'soft'));
        rows[r] = { t: hugeName(fit(key, ch)) + ':' + ins + (arpFx ? '~' + arpFx : '') };
        owner = c; ownerEnd = r + Math.max(...chord.map(n => n.len));
      } else if (owner >= 0 && r === ownerEnd) { rows[r] = { t: '-' }; owner = -1; arpFx = null; }
      else if (arpFx && owner >= 0 && r < ownerEnd) rows[r] = { t: '.~' + arpFx };   // an arpeggio lasts one row: again on each
    }
    channels[ch] = rows;
  }
  // drums: one noise channel, the kick first
  const kinds = ['kick', 'snare', 'clap', 'open', 'hat', 'perc'], hits = new Map();
  for (const kind of kinds) for (const name of [].concat((map.noise || {})[kind] || [])) {
    used.push(name);
    for (const n of track(name)) if (!hits.has(n.row) || kinds.indexOf(hits.get(n.row)) > kinds.indexOf(kind)) hits.set(n.row, kind);
  }
  // the tempo: 16th-note rows of 900 / BPM frames, as whole frames that average out to the song's tempo
  // (a speed change, Fxx, on the noise channel's rows where the frame count changes)
  const perRow = 3600 / (job.tempo * ROWS_PER_BEAT), ticks = [];
  for (let r = 0, acc = 0; r < total; r++) { const next = Math.round((r + 1) * perRow) - acc; ticks.push(next); acc += next; }
  const noise = new Array(total).fill(null).map((_, r) => {
    const k = hits.get(r), fx = !r || ticks[r] !== ticks[r - 1] ? '~f' + ticks[r].toString(16).padStart(2, '0') : '';
    return { t: (k ? k : '.') + fx };
  });
  channels.noise = noise;
  const skipped = job.tracks.filter(t => (t.notes || []).length && !used.some(u => t.name === u || t.name.startsWith(u))).map(t => t.name);
  // patterns of 64 rows; the same pattern twice is stored once (tools/lib/song.js)
  const patterns = {}, order = [];
  for (let p = 0; p < total / PATTERN; p++) {
    const name = 'P' + p; order.push(name);
    patterns[name] = Object.fromEntries(Object.entries(channels).map(([ch, rows]) => [ch, rows.slice(p * PATTERN, (p + 1) * PATTERN).map(r => r.t).join(' ')]));
  }
  const insNames = { duty: [...new Set(Object.keys(INS.duty))], wave: Object.keys(INS.wave), noise: Object.keys(INS.noise) };
  const desc = {
    about: `${map.project}: converted by gbc/tools/music.js from gbc/music/${song}.map.js. Do not edit; change the map.`,
    tempo: ticks[0], bpm: job.tempo, beats: [from, to],
    duty: insNames.duty.map(k => INS.duty[k]), dutyNames: insNames.duty,
    wave: insNames.wave.map(k => INS.wave[k]), waveNames: insNames.wave,
    noise: insNames.noise.map(k => ({ env: INS.noise[k].env })), noiseNames: insNames.noise,
    drums: Object.fromEntries(insNames.noise.map((k, i) => [k, [INS.noise[k].note, i + 1]])),
    waves: WAVES, patterns, order,
  };
  const file = path.join(GBC, 'music', song + '.js');
  fs.writeFileSync(file, `// Generated by gbc/tools/music.js from "${map.project}" (Bitwig) and gbc/music/${song}.map.js. Do not edit.\n'use strict';\nmodule.exports = ${JSON.stringify(desc, null, 1)};\n`);
  const unique = new Set(Object.values(patterns).flatMap(p => Object.entries(p).map(([ch, s]) => ch + s))).size;
  const bytes = unique * 192 + order.length * 8 + 560;   // 64 rows of 3 bytes a pattern, the orders, the instruments (song_slims.o measured)
  console.log(`${song}: ${(to - from).toFixed(0)} beats at ${job.tempo} BPM, ${order.length} patterns (${unique} different of ${order.length * 4}), about ${(bytes / 1024).toFixed(1)} KB` +
    (skipped.length ? `; not played: ${skipped.join(', ')}` : ''));
  if (bytes > 16384) console.log(`  too big for a 16 KB ROM bank: bring "to" in ${song}.map.js down`);
}
function groupByRow(notes) { const m = new Map(); for (const n of notes) { if (!m.has(n.row)) m.set(n.row, []); m.get(n.row).push(n); } return m; }

const songs = args.filter(a => !a.startsWith('--'));
if (!songs.length) { console.error('usage: node gbc/tools/music.js <song>... [--import]'); process.exit(1); }
for (const s of songs) convert(s);
