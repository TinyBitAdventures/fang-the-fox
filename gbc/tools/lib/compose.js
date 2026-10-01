// Helpers for the songs arranged by hand for the Game Boy (music/*_gb.js): notes by name, parts written a bar
// at a time, the riff's dry gated sound, the echo, and the instruments every recreation shares. A song is the
// object tools/lib/song.js compiles: 64-row patterns of space-separated rows, 4 rows a beat, 16 a bar.
'use strict';
const ROWS = 64, BAR = 16;
const NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const midi = s => { const m = /^([A-G]#?)(\d)$/.exec(s); if (!m) throw new Error(`bad note ${s}`); return (+m[2] + 1) * 12 + NAMES.indexOf(m[1]); };   // scientific pitch: C4 = 60
const tok = i => NAMES[i % 12] + (Math.floor(i / 12) + 3);   // song.js names: index 0 is "C3"
const fx = f => (f ? '~' + f : '');
const P = (s, ins, f) => tok(midi(s) - 36) + ':' + ins + fx(f);   // pulse: index 0 sounds MIDI 36
const W = (s, ins, f) => tok(midi(s) - 24) + ':' + ins + fx(f);   // wave: index 0 sounds MIDI 24, an octave lower
const transpose = (n, semis) => { const m = midi(n) + semis; return NAMES[m % 12] + (Math.floor(m / 12) - 1); };
const blank = () => Array(ROWS).fill('.');
// a bar's [row, token] list into a channel; a cut that falls past the bar's end lands at the start of the next
// (whatever is put there later wins) unless that's past the pattern, where the next pattern takes over
const put = (ch, bar, list) => { for (const [r, t] of list) { const i = bar * BAR + r; if (i < ROWS) ch[i] = t; } return ch; };
const join = ch => ch.join(' ');
const pairs = list => list.flatMap(([r, n]) => [[r, n], [r + 1, n]]);
const lead = (list, ins, shift = 0) => list.map(([r, n]) => [r, P(transpose(n, shift), ins)]);

// the riff's sound (Austin: the conversion's is the better one): a steady 50% square held for its rows (1 by
// default) and then cut, unless the next note starts straight away
function dry(list, ins = 'dry') {
  const at = new Set(list.map(([r]) => r));
  return list.flatMap(([r, n, len = 1]) => (at.has(r + len) ? [[r, P(n, ins)]] : [[r, P(n, ins)], [r + len, '-']]));
}
// pulse 2 repeats pulse 1 three rows later, quieter (the echo the web game's synths have), cuts and all
function echo(src, from = 0, to = ROWS) {
  const ch = blank();
  src.forEach((t, r) => { if (r >= from && r < to && t !== '.' && r + 3 < ROWS) ch[r + 3] = t.replace(/:[a-z]+/, ':echo').replace(/~.*/, ''); });
  return ch;
}
// a bar of 16ths walking through notes
const rise = (notes, ins = 'rise') => Array.from({ length: 16 }, (_, r) => [r, P(notes[r % notes.length], ins)]);
// drums: one list of [row, k|s|h|o] per bar, null for an empty bar
const drums = bars => { const ch = blank(); bars.forEach((b, i) => b && put(ch, i, b)); return ch; };
// a tempo between two whole frame counts: rows take a and b frames by turns (8 and 7: 120 BPM), set on the
// channel ch with Fxx (rows that already have an effect keep it; the speed stays from the row before)
function tempo(ch, a, b) { return ch.map((t, r) => (t.includes('~') ? t : t + '~f' + String(r & 1 ? b : a).padStart(2, '0'))); }

// the instruments every recreation shares; a song can add its own after them
function kit() {
  return {
    duty: [
      { duty: 2, env: 0xB0 },   // dry: the riff, as the conversion's lead (steady, cut by the rows)
      { duty: 1, env: 0xB3 },   // hi: a high line, thinner
      { duty: 2, env: 0x53 },   // echo
      { duty: 0, env: 0x81 },   // pulse: short and thin
      { duty: 2, env: 0x82 },   // chord: a stab, arpeggiated by the row
      { duty: 0, env: 0x92 },   // sparkle
      { duty: 1, env: 0x72 },   // rise
    ],
    dutyNames: ['dry', 'hi', 'echo', 'pulse', 'chord', 'sparkle', 'rise'],
    wave: [{ wave: 0, volume: 1 }, { wave: 1, volume: 1 }],
    waveNames: ['bass', 'sub'],
    waves: [
      [15, 15, 15, 15, 15, 15, 15, 15, 14, 13, 12, 10, 8, 6, 4, 2, 0, 0, 0, 0, 0, 0, 0, 0, 1, 2, 3, 5, 7, 9, 11, 13],   // a rounded square: punchy
      [...Array(16).keys(), ...[...Array(16).keys()].reverse()],                                                        // a triangle: soft
    ],
    noise: [
      { env: 0xC1, table: [[0, null, 0], [-5, null, 0], [-10, null, 0], [-15, null, 0], [-20, null, 0], [-24, 5, 0]] },   // kick: the noise falls two octaves
      { env: 0xB2, table: [[3, null, 0], [0, null, 0], [-2, 2, 0]] },                                                     // snare
      { env: 0x61 },                                                                                                       // closed hat
      { env: 0x53 },                                                                                                       // open hat
    ],
    noiseNames: ['kick', 'snare', 'hat', 'open'],
    drums: { k: ['A5', 1], s: ['A5', 2], h: ['C8', 3], o: ['A7', 4] },
  };
}

module.exports = { ROWS, BAR, midi, P, W, transpose, blank, put, join, pairs, lead, dry, echo, rise, drums, tempo, kit };
