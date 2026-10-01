// Forest Home, arranged for the Game Boy by hand: a recreation of the album track ("2022-10-30 Forest Home").
// F# minor over the four-bar loop F#m | C#/F | D | C#/F. The ideas come from the Bitwig project: the low motif
// it opens with, the counter-melody (Vital), the eighth-note pulse (Vital 2), the octave bass (Komplete
// Kontrol), the main melody and its run (Reaktor 6 2), the repeated-note 16ths, and the sparkle call near the
// end (Reaktor 6). The melody keeps the dry, held sound Austin chose for the title.
// 120 BPM: rows take 8 and 7 frames by turns, so eighths stay even. The intro plays once; the end jumps back
// to the counter-melody.
'use strict';
const { P, W, blank, put, join, dry, echo, lead, drums, tempo, kit } = require('../tools/lib/compose.js');

// ---------- the parts: [row, note, rows held] a bar at a time ----------
const MOTIF = [[[0, 'C#3'], [8, 'F#2']], [[0, 'F#3'], [2, 'A3'], [4, 'G#3'], [6, 'B3'], [8, 'F3']]];   // the opening, two bars
const COUNTER = [[[0, 'A4'], [4, 'C#5']], [[0, 'G#4'], [4, 'C#5']], [[0, 'A4'], [4, 'F#4']], [[0, 'G#4'], [4, 'F4']]];
const MELODY = [[[0, 'A4', 4], [6, 'F#5', 4], [10, 'D5', 4]], [[0, 'C#5', 8]], [[0, 'D5', 4], [6, 'F#5', 4], [10, 'D5', 4]], [[0, 'F5', 8]]];
const TURN = [[0, 'A5', 2], [2, 'G#5', 2], [4, 'F5', 2], [6, 'F#5', 4], [10, 'D5', 4]];   // the melody's busier variation
const VARIED = [TURN, [[0, 'C#5', 8]], TURN, [[0, 'F5', 8]]];
const RUN = [[[0, 'F5', 4], [4, 'G#5', 4], [8, 'C#6'], [9, 'D6'], [10, 'F#6'], [11, 'D6'], [12, 'F6', 4]],
  [[0, 'F#6'], [2, 'F#6'], [4, 'A6'], [6, 'G#6'], [8, 'F#6'], [10, 'C#6', 2], [14, 'D6', 2]]];   // its climb at the top
const CALL = oct => [[0, 'F#' + oct], [2, 'F#' + oct], [4, 'A' + oct], [6, 'G#' + oct], [8, 'F#' + oct], [10, 'C#' + oct], [14, 'D' + oct]];

// the eighth-note pulse, one bar a chord
const PULSE = [
  [0, 2, 4, 6, 8, 10, 12, 14].map(r => [r, P('F#3', 'pulse')]),
  [0, 2, 4, 6].map(r => [r, P('F3', 'pulse')]).concat([8, 10, 12, 14].map(r => [r, P('C#4', 'pulse')])),
  [0, 2, 4, 6, 8, 10, 12, 14].map(r => [r, P('D4', 'pulse')]),
  [0, 2, 4, 6, 8, 10, 12, 14].map(r => [r, P('F3', 'pulse')]),
];
// the repeated-note 16ths, four of each note up the chord
const fig = notes => notes.flatMap((n, k) => [0, 1, 2, 3].map(i => [k * 4 + i, P(n, 'pulse')]));
const FIG16 = [fig(['F#4', 'A4', 'C#5', 'A4']), fig(['F4', 'G#4', 'C#5', 'G#4']), fig(['F#4', 'A4', 'D5', 'A4']), fig(['F4', 'G#4', 'C#5', 'F5'])];
// the octave bass in eighths, cut short
const oct8 = (lo, hi) => [[lo, hi], [lo, hi]].flat();
const BASS = [
  ['F#2', 'F#3', 'F#2', 'F#3', 'F#2', 'F#3', 'F#2', 'F#3'],
  ['F2', 'F3', 'F2', 'F3', 'C#3', 'C#4', 'C#3', 'C#4'],
  ['D2', 'D3', 'D2', 'D3', 'D2', 'D3', 'D2', 'D3'],
  ['F2', 'F3', 'F2', 'F3', 'F2', 'F3', 'F2', 'F3'],
].map(bar => bar.map((n, i) => [i * 2, W(n, 'bass', 'e05')]));
const LONG = [['F#2', 'F#2'], ['F2', 'C#3'], ['D2', 'D2'], ['F2', 'F2']].map(([a, b]) => (a === b ? [[0, W(a, 'sub')], [15, '-']] : [[0, W(a, 'sub')], [8, W(b, 'sub')], [15, '-']]));

// ---------- drums ----------
const HATS = [[2, 'h'], [6, 'h'], [10, 'h'], [14, 'h']];
const FOUR = [[0, 'k'], [2, 'h'], [4, 'k'], [6, 'h'], [8, 'k'], [10, 'h'], [12, 'k'], [14, 'h']];
const GROOVE = [[0, 'k'], [2, 'h'], [4, 's'], [6, 'h'], [8, 'k'], [10, 'h'], [12, 's'], [14, 'o']];
const FILL = [[0, 'k'], [2, 'h'], [4, 's'], [6, 'h'], [8, 's'], [10, 's'], [12, 's'], [13, 's'], [14, 's'], [15, 's']];
const ROLL = Array.from({ length: 16 }, (_, r) => [r, r % 4 === 0 ? 'k' : 's']);

// ---------- the patterns (4 bars each) ----------
const four = parts => { const ch = blank(); parts.forEach((p, b) => p && put(ch, b, p)); return ch; };
const song = (p1, p2, wave, noise) => ({ p1: join(p1), p2: p2 ? join(p2) : '', wave: wave ? join(wave) : '', noise: join(tempo(noise || blank(), 8, 7)) });
const patterns = {};
{ // the low motif alone, as the album opens
  const p1 = four([dry(MOTIF[0]), dry(MOTIF[1]), dry(MOTIF[0]), dry(MOTIF[1])]);
  patterns.intro = song(p1);
}
{ // the counter-melody with its echo over the octave bass, hats; then the pulse and the kick
  const p1 = four(COUNTER.map(b => dry(b)));
  patterns.counter = song(p1, echo(p1), four(BASS), drums([HATS, HATS, HATS, HATS]));
  patterns.counter2 = song(p1, four(PULSE), four(BASS), drums([FOUR, FOUR, FOUR, FILL]));
}
{ // the main melody, twice
  const p1 = four(MELODY.map(b => dry(b)));
  patterns.melody = song(p1, four(PULSE), four(BASS), drums([GROOVE, GROOVE, GROOVE, GROOVE]));
  patterns.melody2 = song(p1, four(PULSE), four(BASS), drums([GROOVE, GROOVE, GROOVE, FILL]));
}
{ // the busier variation over the 16ths, then the climb
  patterns.varied = song(four(VARIED.map(b => dry(b))), four(FIG16), four(BASS), drums([GROOVE, GROOVE, GROOVE, GROOVE]));
  patterns.climb = song(four([dry(TURN), dry([[0, 'C#5', 8]]), dry(RUN[0]), dry(RUN[1])]), four(FIG16), four(BASS), drums([GROOVE, GROOVE, GROOVE, FILL]));
}
{ // the sparkle call with its echo, long bass notes, hats; a roll back to the counter-melody
  const p1 = four([lead(CALL(5), 'hi'), lead([[0, 'C#5']], 'hi'), lead(CALL(6), 'hi'), lead([[0, 'C#6']], 'hi')]);
  patterns.call = song(p1, echo(p1), four(LONG), drums([HATS, HATS, HATS, HATS]));
  const p2 = echo(p1); p2[63] += '~b02';   // Bxx: on to order position xx - 1, the counter-melody
  patterns.call2 = song(p1, p2, four(LONG), drums([HATS, HATS, FOUR, ROLL]));
}

module.exports = {
  title: 'Forest Home',
  about: 'Forest Home: arranged for the Game Boy by hand in gbc/music/home_gb.js (a recreation, not a conversion).',
  tempo: 8, bpm: 120, beats: [0, 144], loopFrom: 16,
  ...kit(),   // tools/lib/compose.js: dry, hi, echo, pulse, chord, sparkle, rise; bass, sub; kick, snare, hat, open
  patterns,
  order: ['intro', 'counter', 'counter2', 'melody', 'melody2', 'varied', 'climb', 'call', 'call2'],
};
