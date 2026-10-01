// Plasma Blast, arranged for the Game Boy by hand: a recreation of the album track ("2022-09-24 Plasma Blast").
// D# minor. The ideas come from the Bitwig project, whose bars start half a beat in: the syncopated hook it opens
// with (Surge XT 2, then the bass, Surge XT 4), the eighth-note arpeggio lead (Surge XT 5), the lyrical melody
// (OB-Xd), four on the floor with a backbeat. The hook and the melodies keep the dry sound Austin chose for the title.
// 128 BPM (the album's 124 would need uneven rows): 7 frames a row. The intro plays once; the end jumps back to
// the drive.
'use strict';
const { ROWS, P, W, transpose, blank, put, join, dry, echo, drums, kit } = require('../tools/lib/compose.js');

// ---------- the parts: [row, note, rows held] a bar at a time ----------
const HOOK = [
  [[4, 'D#2', 2], [6, 'A#2', 8], [14, 'A#2', 2]],
  [[0, 'B2', 8], [8, 'A#2', 2], [10, 'D#2', 2]],
  [[4, 'D#2', 8], [12, 'D#2', 2], [14, 'A#2', 8]],
  [[6, 'A#2', 2], [8, 'B2', 8]],
];
const up = (bar, semis) => bar.map(([r, n, len]) => [r, transpose(n, semis), len]);
const eighths = notes => notes.map((n, i) => (n ? [i * 2, n] : null)).filter(Boolean);   // a bar of eighths, null for a rest
const LEAD = [   // an octave under the album's, so it sits above the hook without piercing
  eighths(['D#4', 'F#4', 'A#4', 'D#4', 'F#4', 'B4', 'D#4', 'F#4']),
  eighths(['D#5', null, 'F#5', 'F5', 'B4', 'A#4', 'F#4', 'D#4']),
  eighths(['B4', 'A#4', 'D#4', null, 'D#5', 'F#5', 'D#5', 'B4']),
  eighths(['A#4', 'D#4', 'D#4', 'D#4', 'D#4', 'F#4', 'A#4', 'D#4']),
  eighths(['F#4', 'B4', 'D#4', 'F#4', 'D#5', null, 'F#5', 'F5']),
  eighths(['B4', 'A#4', 'F#4', 'D#4', 'B4', 'A#4', 'D#4', null]),
  eighths(['D#5', 'F#5', 'D#5', 'B4', 'A#4', 'D#4', 'D#4', 'D#4']),
  eighths(['D#4', 'D#4', null, null, 'D#4', 'F#4', 'A#4', 'D#4']),
];
const MELODY = [
  [[8, 'D#4', 6], [14, 'D#5', 2]],
  [[0, 'A#4', 2], [2, 'D#4', 2], [4, 'A#4', 4], [8, 'B4', 6]],
  [[0, 'B4'], [2, 'B4'], [4, 'B4'], [6, 'B4'], [8, 'G#4', 4], [12, 'F#4', 12]],
  [[8, 'D#4', 4]],
  [[0, 'D#4', 6], [6, 'D#5', 2], [8, 'A#4', 2], [10, 'D#4', 2], [12, 'A#4', 4]],
  [[0, 'B4', 6], [8, 'B4'], [10, 'B4'], [12, 'B4'], [14, 'B4']],
  [[0, 'G#4', 4], [4, 'F#4', 12]],
  [[0, 'F4', 4], [8, 'D#4', 6], [14, 'D#5', 2]],
];
// chord stabs on the off-beats: D#m, then B
const stabs = bar => [2, 6, 10, 14].map(r => [r, bar % 2 ? P('B3', 'chord', '047') : P('D#4', 'chord', '037')]);
const bassBar = b => HOOK[b].map(([r, n, len = 1]) => [r, W(n, 'bass', len > 2 ? '' : 'e05')]);
const ROOTS = [['D#2'], ['B1'], ['D#2'], ['B1']].map(([n]) => [[0, W(n, 'sub')], [15, '-']]);

// ---------- drums ----------
const FOUR = [[0, 'k'], [2, 'h'], [4, 'k'], [6, 'h'], [8, 'k'], [10, 'h'], [12, 'k'], [14, 'h']];
const GROOVE = [[0, 'k'], [2, 'h'], [4, 's'], [6, 'h'], [8, 'k'], [10, 'h'], [12, 's'], [14, 'o']];
const FILL = [[0, 'k'], [2, 'h'], [4, 's'], [6, 'h'], [8, 's'], [10, 's'], [12, 's'], [13, 's'], [14, 's'], [15, 's']];
const HATS = [[2, 'h'], [6, 'h'], [10, 'h'], [14, 'h']];
const ROLL = Array.from({ length: 16 }, (_, r) => [r, r % 4 === 0 ? 'k' : 's']);

// ---------- the patterns (4 bars each) ----------
const four = parts => { const ch = blank(); parts.forEach((p, b) => p && put(ch, b, p)); return ch; };
const song = (p1, p2, wave, noise) => ({ p1: join(p1), p2: p2 ? join(p2) : '', wave: wave ? join(wave) : '', noise: noise ? join(noise) : '' });
const hookUp = four(HOOK.map(b => dry(up(b, 12))));   // the hook an octave up on the lead
const bass = four([0, 1, 2, 3].map(bassBar));
const stab4 = four([0, 1, 2, 3].map(stabs));
const lead = (from) => four(LEAD.slice(from, from + 4).map(b => dry(b)));
const melody = (from) => four(MELODY.slice(from, from + 4).map(b => dry(b)));
const patterns = {
  intro: song(hookUp),                                                           // the hook alone, as the album opens
  drive: song(hookUp, null, bass, drums([FOUR, FOUR, FOUR, FOUR])),
  drive2: song(hookUp, stab4, bass, drums([GROOVE, GROOVE, GROOVE, FILL])),
  lead: song(lead(0), stab4, bass, drums([GROOVE, GROOVE, GROOVE, GROOVE])),
  lead2: song(lead(4), stab4, bass, drums([GROOVE, GROOVE, GROOVE, FILL])),
  melody: song(melody(0), echo(melody(0)), bass, drums([GROOVE, GROOVE, GROOVE, GROOVE])),
  melody2: song(melody(4), echo(melody(4)), bass, drums([GROOVE, GROOVE, GROOVE, FILL])),
};
{ // the hook over long roots, hats, a roll back to the drive
  const p2 = echo(hookUp); p2[ROWS - 1] += '~b02';   // Bxx: on to order position xx - 1, the drive
  patterns.breakdown = song(hookUp, p2, four(ROOTS), drums([HATS, HATS, HATS, ROLL]));
}

module.exports = {
  title: 'Plasma Blast (recreation)',
  about: 'Plasma Blast: arranged for the Game Boy by hand in gbc/music/plasma_gb.js (a recreation, not a conversion).',
  tempo: 7, bpm: 128, beats: [0, 128], loopFrom: 16,
  ...kit(),   // tools/lib/compose.js: dry, hi, echo, pulse, chord, sparkle, rise; bass, sub; kick, snare, hat, open
  patterns,
  order: ['intro', 'drive', 'drive2', 'lead', 'lead2', 'melody', 'melody2', 'breakdown'],
};
