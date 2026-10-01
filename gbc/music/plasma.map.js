// Plasma Blast on the Game Boy (tools/music.js explains the fields). Run `node gbc/tools/music.js plasma` after a change.
module.exports = {
  project: '2022-09-24 Plasma Blast',
  from: 0, to: 336,
  p1: [['Surge XT 5'], ['OB-Xd'], ['Surge XT 3']],                                     // the leads
  p2: [['Surge XT 2', { ins: 'soft' }], ['Surge XT', { ins: 'pad' }]],                  // the figure, the long chords
  wave: [['Surge XT 4', { ins: 'bass' }], ['Track 8', { ins: 'bass' }]],
  noise: { kick: 'Drum Machine 36', snare: 'Drum Machine 37', hat: 'Drum Machine 38' },
};
