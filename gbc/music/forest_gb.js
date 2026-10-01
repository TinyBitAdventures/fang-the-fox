// Forest Exploration, arranged for the Game Boy by hand: a recreation of the album track ("2022-09-22 Forest
// Exploration"). C minor over Cm | F Eb | Cm | Bb Eb. The ideas come from the Bitwig project: the low riff it
// opens with and its broken beat (Reaktor 6, the drum machine), the eighth-note ostinato (Reaktor 6 2), the slow
// melody (Reaktor 6) and the fluttering figure above it (Reaktor 6 3). The project has no bass part, so the riff
// plays it an octave down. The riff and the melodies keep the dry, held sound Austin chose for the title.
// 120 BPM: rows take 8 and 7 frames by turns. The intro plays once; the end jumps back to the groove.
'use strict';
const { P, W, blank, put, join, dry, echo, drums, tempo, kit } = require('../tools/lib/compose.js');

// ---------- the parts: [row, note, rows held] a bar at a time ----------
const RIFF = [[[0, 'C3'], [3, 'D#3'], [4, 'G3'], [6, 'C3']], [[0, 'F3'], [1, 'F3'], [8, 'D#3'], [9, 'D#3']]];
const MELODY = [[[0, 'C5', 12], [12, 'F5', 4]], [[0, 'D#5', 8], [8, 'A#4', 8]], [[0, 'C5', 12], [12, 'F5', 4]], [[0, 'G#5', 8], [8, 'G5', 8]]];
const FIGURE = [
  [[0, 'C4', 4], [4, 'A#4', 4], [8, 'C5', 4]],
  [[0, 'D#5'], [1, 'D5'], [2, 'D#5'], [6, 'D#5'], [7, 'D#5'], [10, 'D#5'], [11, 'D#5'], [12, 'F5', 2]],
  [[0, 'C4', 4], [4, 'A#4', 4], [8, 'C5', 4]],
  [[0, 'D#5'], [1, 'D5'], [2, 'D#5'], [6, 'A#4'], [7, 'A#4'], [10, 'A#4'], [11, 'A#4'], [12, 'C5', 2]],
];
// the ostinato: eighths, a bar or half a bar on each note
const eighths = (a, b = a) => [0, 2, 4, 6, 8, 10, 12, 14].map((r, i) => [r, P(i < 4 ? a : b, 'pulse')]);
const OSTINATO = [eighths('C4'), eighths('F4', 'D#4'), eighths('C4'), eighths('A#3', 'D#4')];
// the riff an octave down as the bass, cut short; long roots for the groove and the breakdown
const RIFF_BASS = RIFF.map(bar => bar.map(([r, n]) => [r, W(n.replace(/\d/, d => d - 1), 'bass', 'e05')]));
const ROOTS = [['C2'], ['F2', 'D#2'], ['C2'], ['A#1', 'D#2']].map(ns => (ns.length === 1 ? [[0, W(ns[0], 'sub')], [15, '-']] : [[0, W(ns[0], 'sub')], [8, W(ns[1], 'sub')], [15, '-']]));

// ---------- drums ----------
const BROKEN = [[[0, 'k'], [1, 'k'], [2, 'h'], [3, 'h'], [4, 'o'], [5, 'k'], [6, 'h'], [7, 'h'], [8, 'k'], [9, 'p'], [10, 'p'], [11, 'h'], [12, 'c'], [14, 'h'], [15, 'h']],
  [[0, 'k'], [1, 'k'], [2, 'h'], [3, 'h'], [4, 'o'], [6, 'h'], [7, 'h'], [8, 'k'], [9, 'p'], [10, 'p'], [11, 'h'], [12, 'c'], [14, 'h'], [15, 'h']]];
const STRAIGHT = [[0, 'k'], [2, 'h'], [4, 'c'], [6, 'h'], [8, 'k'], [10, 'h'], [12, 'c'], [14, 'h']];
const FILL = [[0, 'k'], [2, 'h'], [4, 'c'], [6, 'h'], [8, 'c'], [10, 'c'], [12, 's'], [13, 's'], [14, 's'], [15, 's']];
const HATS = [[2, 'h'], [6, 'h'], [10, 'h'], [14, 'h']];
const ROLL = Array.from({ length: 16 }, (_, r) => [r, r % 4 === 0 ? 'k' : 's']);

// ---------- the patterns (4 bars each) ----------
const four = parts => { const ch = blank(); parts.forEach((p, b) => p && put(ch, b, p)); return ch; };
const song = (p1, p2, wave, noise) => ({ p1: join(p1), p2: p2 ? join(p2) : '', wave: wave ? join(wave) : '', noise: join(tempo(noise || blank(), 8, 7)) });
const riff = four([dry(RIFF[0]), dry(RIFF[1]), dry(RIFF[0]), dry(RIFF[1])]);
const broken = drums([BROKEN[0], BROKEN[1], BROKEN[0], BROKEN[1]]);
const patterns = {
  intro: song(riff, null, null, broken),                                       // the riff and its broken beat, as the album opens
  groove: song(riff, four(OSTINATO), null, broken),                            // the ostinato joins
  groove2: song(riff, four(OSTINATO), four(ROOTS), drums([BROKEN[0], BROKEN[1], BROKEN[0], FILL])),
  melody: song(four(MELODY.map(b => dry(b))), four(OSTINATO), four([...RIFF_BASS, ...RIFF_BASS]), drums([STRAIGHT, STRAIGHT, STRAIGHT, STRAIGHT])),
  melody2: song(four(MELODY.map(b => dry(b))), four(OSTINATO), four([...RIFF_BASS, ...RIFF_BASS]), drums([STRAIGHT, STRAIGHT, STRAIGHT, FILL])),
  peak: song(four(FIGURE.map(b => dry(b))), four(MELODY.map(b => dry(b, 'soft'))), four([...RIFF_BASS, ...RIFF_BASS]), drums([STRAIGHT, STRAIGHT, STRAIGHT, STRAIGHT])),
  peak2: song(four(FIGURE.map(b => dry(b))), four(MELODY.map(b => dry(b, 'soft'))), four([...RIFF_BASS, ...RIFF_BASS]), drums([STRAIGHT, STRAIGHT, STRAIGHT, FILL])),
};
{ // the riff with its echo over long roots, hats, a roll back to the groove
  const p2 = echo(riff); p2[63] += '~b02';   // Bxx: on to order position xx - 1, the groove
  patterns.breakdown = song(riff, p2, four(ROOTS), drums([HATS, HATS, HATS, ROLL]));
}

const k = kit();
k.duty.push({ duty: 1, env: 0x90 }); k.dutyNames.push('soft');                 // soft: a steady 25%, the melody under the figure
k.noise.push({ env: 0x71, mode7: true }, { env: 0xA2, table: [[2, null, 0], [0, null, 0], [-1, 2, 0]] });
k.noiseNames.push('perc', 'clap');                                             // the glitchy percussion, the clap
Object.assign(k.drums, { p: ['E7', 5], c: ['G5', 6] });
module.exports = {
  title: 'Forest Exploration (recreation)',
  about: 'Forest Exploration: arranged for the Game Boy by hand in gbc/music/forest_gb.js (a recreation, not a conversion).',
  tempo: 8, bpm: 120, beats: [0, 128], loopFrom: 16,
  ...k,
  patterns,
  order: ['intro', 'groove', 'groove2', 'melody', 'melody2', 'peak', 'peak2', 'breakdown'],
};
