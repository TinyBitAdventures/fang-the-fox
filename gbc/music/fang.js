// Fang the Fox, the title theme, arranged for the Game Boy: a recreation, not a conversion (music.js). The
// ideas come from the Bitwig project ("2022-08-28 Fang the Fox"): the riff (low E, octave E, B C B, the A# B
// answer), its gated 16th version, the high line, the C/B and C/D# sparkles, all over the two-bar Em | C (B A#)
// loop. They're written for the hardware: the riff dry and gated as the conversion plays it (Austin: its sound
// is the better one), an echo on pulse 2, chord stabs as arpeggios, a punchy bass wave, and drums with their
// own pitch drops.
// 128 BPM: 7 frames a row, 4 rows a beat, 16 a bar, 64 a pattern (4 bars). The intro plays once; the end
// jumps back to the groove.
'use strict';
const ROWS = 64, BAR = 16;
const NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const midi = s => { const m = /^([A-G]#?)(\d)$/.exec(s); return (+m[2] + 1) * 12 + NAMES.indexOf(m[1]); };   // scientific pitch: C4 = 60
const tok = i => NAMES[i % 12] + (Math.floor(i / 12) + 3);                                                     // song.js names: index 0 is "C3"
const fx = f => (f ? '~' + f : '');
const P = (s, ins, f) => tok(midi(s) - 36) + ':' + ins + fx(f);   // pulse: index 0 sounds MIDI 36
const W = (s, ins, f) => tok(midi(s) - 24) + ':' + ins + fx(f);   // wave: index 0 sounds MIDI 24, an octave lower
const blank = () => Array(ROWS).fill('.');
const put = (ch, bar, list) => { for (const [r, t] of list) ch[bar * BAR + r] = t; return ch; };
const join = ch => ch.join(' ');

// ---------- the parts, a bar or two at a time: [row, note] ----------
// the riff as the intro plays it (16th plucks), and its answer
const RIFF = [[0, 'E3'], [8, 'E4'], [14, 'B3']], RIFF_C = [[0, 'C4'], [2, 'B3']], RIFF_ANS = [[0, 'C4'], [2, 'B3'], [4, 'A#3'], [6, 'B3']];
// the gated version (16th pairs), and its G-led variation
const pairs = list => list.flatMap(([r, n]) => [[r, n], [r + 1, n]]);
const GATE = pairs([[0, 'E4'], [3, 'E4'], [6, 'E4'], [8, 'G4'], [10, 'E4'], [14, 'B3']]);
const GATE_G = pairs([[0, 'G4'], [3, 'G4'], [6, 'G4'], [8, 'F#4'], [10, 'E4'], [14, 'B3']]);
const GATE_C = pairs([[0, 'C4'], [2, 'B3'], [4, 'A#3'], [6, 'B3']]);
// the high line: E5 in pairs, then C6 C6 B5 B5 . B5 B5, the fourth bar reaching E6
const HIGH_E = [0, 2, 6, 8, 12, 14].map(r => [r, 'E5']);
const HIGH_C = [[0, 'C6'], [2, 'C6'], [4, 'B5'], [6, 'B5'], [10, 'B5'], [12, 'B5']];
const HIGH_C2 = [[0, 'C6'], [2, 'C6'], [4, 'B5'], [6, 'B5'], [10, 'E6'], [12, 'E6']];

function lead(list, ins, shift = 0) { return list.map(([r, n]) => [r, P(transpose(n, shift), ins)]); }
// the riff's sound: a steady 50% square, each note cut a row later unless the next one follows straight on
function dry(list) { const at = new Set(list.map(([r]) => r)); return list.flatMap(([r, n]) => (at.has(r + 1) ? [[r, P(n, 'dry')]] : [[r, P(n, 'dry')], [r + 1, '-']])); }
function transpose(n, semis) { const m = midi(n) + semis; return NAMES[m % 12] + (Math.floor(m / 12) - 1); }
// pulse 2 repeats pulse 1 three rows later, quieter (the echo the web game's synths have), cuts and all
function echo(src, from = 0, to = ROWS) {
  const ch = blank();
  src.forEach((t, r) => { if (r >= from && r < to && t !== '.' && r + 3 < ROWS) ch[r + 3] = t.replace(/:[a-z]+/, ':echo').replace(/~.*/, ''); });
  return ch;
}

// ---------- bass (wave): staccato eighths, cut after 5 of the row's 7 frames ----------
const bassEm = (oct = false) => [0, 2, 4, 6, 8, 10].map((r, i) => [r, W(oct && i % 2 ? 'E3' : 'E2', 'bass', 'e05')]).concat([[12, W('B2', 'bass', 'e05')], [14, W(oct ? 'B3' : 'B2', 'bass', 'e05')]]);
const bassC = (oct = false) => [0, 2, 4, 6].map((r, i) => [r, W(oct && i % 2 ? 'C4' : 'C3', 'bass', 'e05')]).concat([[8, W('B2', 'bass', 'e05')], [10, W(oct ? 'B3' : 'B2', 'bass', 'e05')], [12, W('B2', 'bass', 'e05')], [14, W('A#2', 'bass', 'e05')]]);

// ---------- pulse 2 ----------
// the eighth-note pulse under the groove (the project's Digits 2), short and thin
const pulseEm = [0, 2, 4, 6, 8, 10, 12, 14].map((r, i) => [r, P(i % 2 ? 'E4' : 'E3', 'pulse')]);
const pulseC = [0, 2, 4, 6].map((r, i) => [r, P(i % 2 ? 'C5' : 'C4', 'pulse')]).concat([8, 10, 12, 14].map((r, i) => [r, P(i % 2 ? 'B4' : 'B3', 'pulse')]));
// chord stabs on the off-beats (an arpeggio through the chord each frame), and the sparkle trill
const stabsEm = [2, 6, 10, 14].map(r => [r, P('E4', 'chord', '037')]);
const stabsC = (trill) => [[2, P('C4', 'chord', '047')], [6, P('C4', 'chord', '047')], [10, trill], [11, '.~' + trill.split('~')[1]], [12, '-'], [14, P('B3', 'chord', '047')]];
const TRILL_B = P('B5', 'sparkle', '010'), TRILL_D = P('C6', 'sparkle', '030');   // B5 and C6, then C6 and D#6
// a rising arpeggio for the build
const rise = (notes) => Array.from({ length: 16 }, (_, r) => [r, P(notes[r % notes.length], 'rise')]);

// ---------- drums (noise) ----------
const D = rows => rows;   // [row, k|s|h|o]
const GROOVE = D([[0, 'k'], [2, 'o'], [4, 'k'], [6, 'o'], [8, 'k'], [10, 'o'], [12, 'k'], [14, 'o']]);
const PEAK = D([[0, 'k'], [2, 'o'], [4, 's'], [6, 'o'], [8, 'k'], [10, 'o'], [11, 'k'], [12, 's'], [14, 'o']]);
const FILL = D([[0, 'k'], [2, 'o'], [4, 'k'], [6, 'o'], [8, 's'], [10, 's'], [12, 's'], [13, 's'], [14, 's'], [15, 's']]);
const HATS = D([[0, 'h'], [4, 'h'], [8, 'h'], [12, 'h']]);
const ROLL = D(Array.from({ length: 16 }, (_, r) => [r, r % 4 === 0 ? 'k' : 's']));
const drums = (bars) => { const ch = blank(); bars.forEach((b, i) => b && put(ch, i, b)); return ch; };

// ---------- the patterns (4 bars each) ----------
const patterns = {};
{ // intro: the riff alone, as the conversion opens
  const p1 = blank(); put(p1, 0, dry(RIFF)); put(p1, 1, dry(RIFF_C)); put(p1, 2, dry(RIFF)); put(p1, 3, dry(RIFF_ANS));
  patterns.intro = { p1: join(p1), p2: '', wave: '', noise: '' };
}
{ // the bass and the kick arrive, the riff gets its echo
  const p1 = blank(); put(p1, 0, dry(RIFF)); put(p1, 1, dry(RIFF_C)); put(p1, 2, dry(RIFF)); put(p1, 3, dry(RIFF_ANS));
  const w = blank(); put(w, 0, bassEm()); put(w, 1, bassC()); put(w, 2, bassEm()); put(w, 3, bassC());
  const k1 = D([[0, 'k'], [2, 'h'], [6, 'h'], [8, 'k'], [10, 'h'], [14, 'h']]);
  patterns.arrive = { p1: join(p1), p2: join(echo(p1)), wave: join(w), noise: join(drums([k1, k1, k1, FILL])) };
}
const grooveP1 = () => { const p1 = blank(); put(p1, 0, dry(GATE)); put(p1, 1, dry(GATE_C)); put(p1, 2, dry(GATE_G)); put(p1, 3, dry(GATE_C)); return p1; };
const grooveP2 = () => { const p2 = blank(); put(p2, 0, pulseEm); put(p2, 1, pulseC); put(p2, 2, pulseEm); put(p2, 3, pulseC); return p2; };
const grooveW = (oct) => { const w = blank(); put(w, 0, bassEm(oct)); put(w, 1, bassC(oct)); put(w, 2, bassEm(oct)); put(w, 3, bassC(oct)); return w; };
patterns.groove = { p1: join(grooveP1()), p2: join(grooveP2()), wave: join(grooveW()), noise: join(drums([GROOVE, GROOVE, GROOVE, GROOVE])) };
patterns.groove2 = { p1: join(grooveP1()), p2: join(grooveP2()), wave: join(grooveW()), noise: join(drums([GROOVE, GROOVE, GROOVE, FILL])) };
{ // the peak: the high line, stabs and sparkles, the bass jumping octaves, a snare on 2 and 4
  const p1 = blank(); put(p1, 0, lead(HIGH_E, 'hi')); put(p1, 1, lead(HIGH_C, 'hi')); put(p1, 2, lead(HIGH_E, 'hi')); put(p1, 3, lead(HIGH_C2, 'hi'));
  const p2 = blank(); put(p2, 0, stabsEm); put(p2, 1, stabsC(TRILL_B)); put(p2, 2, stabsEm); put(p2, 3, stabsC(TRILL_D));
  patterns.peak = { p1: join(p1), p2: join(p2), wave: join(grooveW(true)), noise: join(drums([PEAK, PEAK, PEAK, PEAK])) };
  patterns.peak2 = { p1: join(p1), p2: join(p2), wave: join(grooveW(true)), noise: join(drums([PEAK, PEAK, PEAK, FILL])) };
}
{ // the breakdown: the riff again with its echo, long bass notes, hats
  const p1 = blank(); put(p1, 0, dry(RIFF)); put(p1, 1, dry(RIFF_C)); put(p1, 2, dry(RIFF)); put(p1, 3, dry(RIFF_ANS));
  const w = blank();
  for (const bar of [0, 2]) { w[bar * BAR] = W('E2', 'sub'); w[bar * BAR + 15] = '-'; }
  for (const bar of [1, 3]) { w[bar * BAR] = W('C3', 'sub'); w[bar * BAR + 8] = W('B2', 'sub'); w[bar * BAR + 15] = '-'; }
  patterns.breakdown = { p1: join(p1), p2: join(echo(p1)), wave: join(w), noise: join(drums([HATS, HATS, HATS, HATS])) };
}
{ // the build: the gated riff over a rising arpeggio, the kick back, a roll, then back to the groove
  const p2 = blank(); put(p2, 0, rise(['E4', 'G4', 'B4', 'E5'])); put(p2, 1, rise(['C4', 'E4', 'G4', 'C5'])); put(p2, 2, rise(['E4', 'G4', 'B4', 'E5', 'G5', 'B5', 'E6', 'B5'])); put(p2, 3, rise(['B4', 'D#5', 'F#5', 'B5']));
  const n = drums([GROOVE, GROOVE, GROOVE, ROLL]);
  n[ROWS - 1] = n[ROWS - 1] + '~b03';   // Bxx: on to order position xx - 1, the groove
  patterns.build = { p1: join(grooveP1()), p2: join(p2), wave: join(grooveW()), noise: join(n) };
}

module.exports = {
  title: 'Fang the Fox (recreation)',
  about: 'Fang the Fox: arranged for the Game Boy by hand in gbc/music/fang.js (a recreation of the title theme, not a conversion).',
  tempo: 7, bpm: 128, beats: [0, 128], loopFrom: 32,
  duty: [
    { duty: 2, env: 0xB0 },                    // dry: the riff, as the conversion's lead (steady, cut by the rows)
    { duty: 1, env: 0xB3 },                    // hi: the high line, thinner
    { duty: 2, env: 0x53 },                    // echo
    { duty: 0, env: 0x81 },                    // pulse: short and thin
    { duty: 2, env: 0x82 },                    // chord: a stab, arpeggiated by the row
    { duty: 0, env: 0x92 },                    // sparkle
    { duty: 1, env: 0x72 },                    // rise
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
  patterns,
  order: ['intro', 'arrive', 'groove', 'groove2', 'peak', 'peak2', 'breakdown', 'build'],
};
