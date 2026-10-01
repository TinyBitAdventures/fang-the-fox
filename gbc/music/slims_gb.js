// Slim Monsters, arranged for the Game Boy by hand: a recreation of the album track ("2022-09-23 Slim Monsters").
// C minor. The ideas come from the Bitwig project: the bass riff that runs in a five-bar cycle (FM-4: C Eb D C |
// C . C Eb | D F C | C Eb D F | G Eb D), the same riff in eighth-note pairs an octave up (Reaktor 6), the counter-
// line in octaves (ToneZ), four on the floor with a backbeat. The riff keeps the dry sound Austin chose for the title.
// 163 BPM (the album's 158 is 5.7 frames a row: rows here take 6 and 5 by turns, so eighths stay even). Written a
// bar at a time over 44 bars and cut into patterns; the loop is 40 bars, a whole number of riff cycles, so the
// riff stays in step when the end jumps back to bar 5.
'use strict';
const { ROWS, BAR, P, W, transpose, blank, put, join, dry, echo, drums, tempo, kit } = require('../tools/lib/compose.js');

const BARS = 44, LOOP_FROM = 4;
// ---------- the parts, one entry a bar of the five-bar cycle: [row, note, rows held] ----------
const RIFF = [
  [[0, 'C3', 3], [4, 'D#3', 3], [8, 'D3', 3], [12, 'C3', 3]],
  [[0, 'C3', 3], [8, 'C3', 3], [12, 'D#3', 3]],
  [[0, 'D3', 3], [4, 'F3', 3], [8, 'C3', 3]],
  [[0, 'C3', 3], [4, 'D#3', 3], [8, 'D3', 3], [12, 'F3', 3]],
  [[0, 'G3', 3], [4, 'D#3', 3], [8, 'D3', 3]],
];
const up = (list, semis) => list.map(([r, n, len]) => [r, transpose(n, semis), len]);
const pairsOf = list => list.flatMap(([r, n]) => [[r, n], [r + 2, n]]);   // each quarter as two gated eighths
const COUNTER = [
  [],
  [[8, 'C4', 4], [12, 'D#4', 4]],
  [[0, 'G4', 4], [4, 'C4', 4], [8, 'C5', 2], [10, 'C4', 2], [12, 'G3', 2], [14, 'G3', 2]],
  [[0, 'B3', 2], [2, 'B3', 2], [4, 'C4', 4], [8, 'D#5', 2], [10, 'B4', 2], [12, 'B3', 2], [14, 'G3', 2]],
  [[0, 'G3', 12]],
];
const stabs = phase => [2, 6, 10, 14].map(r => [r, phase === 4 ? P('G3', 'chord', '047') : P('C4', 'chord', '037')]);   // Cm, and G under the cycle's G bar
const bassBar = phase => RIFF[phase].map(([r, n]) => [r, W(transpose(n, -12), 'bass', 'e04')]);

// ---------- drums ----------
const FOUR = [[0, 'k'], [2, 'h'], [4, 'k'], [6, 'h'], [8, 'k'], [10, 'h'], [12, 'k'], [14, 'h']];
const GROOVE = [[0, 'k'], [2, 'h'], [4, 's'], [6, 'h'], [8, 'k'], [10, 'h'], [12, 's'], [14, 'o']];
const FILL = [[0, 'k'], [2, 'h'], [4, 's'], [6, 'h'], [8, 's'], [10, 's'], [12, 's'], [13, 's'], [14, 's'], [15, 's']];
const HATS = [[2, 'h'], [6, 'h'], [10, 'h'], [14, 'h']];
const ROLL = Array.from({ length: 16 }, (_, r) => [r, r % 4 === 0 ? 'k' : 's']);

// ---------- the arrangement, bar by bar: what each channel plays in bar b ----------
const sec = b => (b < 4 ? 'intro' : b < 12 ? 'drive' : b < 24 ? 'pairs' : b < 36 ? 'peak' : 'counter');
const lastOf4 = b => b % 4 === 3;
const bars = {
  p1: b => { const ph = b % 5, s = sec(b);
    if (s === 'intro' || s === 'drive') return dry(RIFF[ph]);
    if (s === 'pairs') return dry(pairsOf(RIFF[ph]));
    if (s === 'peak') return dry(pairsOf(up(RIFF[ph], 12)));
    return dry(COUNTER[ph]); },
  p2: b => { const ph = b % 5, s = sec(b);
    if (s === 'drive' && b >= 8 || s === 'pairs') return dry(COUNTER[ph], 'soft');
    if (s === 'peak') return stabs(ph);
    return null; },
  wave: b => (sec(b) === 'intro' ? null : bassBar(b % 5)),
  noise: b => { const s = sec(b);
    if (s === 'intro') return null;
    if (s === 'drive') return lastOf4(b) && b === 11 ? FILL : FOUR;
    if (s === 'counter') return b === BARS - 1 ? ROLL : HATS;
    return lastOf4(b) ? FILL : GROOVE; },
};
// the counter section's pulse 2 echoes its pulse 1
function channel(name, from, to) { const ch = blank(); for (let b = from; b < to; b++) { const list = bars[name](b); if (list) put(ch, b - from, list); } return ch; }
const patterns = {}, order = [];
for (let p = 0; p < BARS / 4; p++) {
  const from = p * 4, p1 = channel('p1', from, from + 4);
  let p2 = sec(from) === 'counter' ? echo(p1) : channel('p2', from, from + 4);
  if (p === BARS / 4 - 1) p2[ROWS - 1] += '~b0' + (LOOP_FROM / 4 + 1);   // Bxx: back to order position xx - 1, bar 5
  const name = sec(from) + p;
  patterns[name] = { p1: join(p1), p2: join(p2), wave: join(channel('wave', from, from + 4)), noise: join(tempo(channel('noise', from, from + 4), 6, 5)) };
  order.push(name);
}

const k = kit();
k.duty.push({ duty: 1, env: 0x90 }); k.dutyNames.push('soft');   // soft: a steady 25%, the counter-line under the riff
module.exports = {
  title: 'Slim Monsters (recreation)',
  about: 'Slim Monsters: arranged for the Game Boy by hand in gbc/music/slims_gb.js (a recreation, not a conversion).',
  tempo: 6, bpm: 163, beats: [0, BARS * 4], loopFrom: LOOP_FROM * 4,
  ...k,
  patterns,
  order,
};
