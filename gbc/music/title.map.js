// Fang the Fox (the title theme) on the Game Boy: which tracks of the Bitwig project play on which
// channel (tools/music.js explains the fields). Run `node gbc/tools/music.js title` after a change.
module.exports = {
  project: '2022-08-28 Fang the Fox',
  from: 0, to: 336,
  p1: [['Voltage Modular 2'], ['Voltage Modular']],                                  // the 16th-note hook
  p2: [['Komplete Kontrol 2', { ins: 'bell' }], ['Digits 2', { ins: 'soft' }], ['Komplete Kontrol', { ins: 'pad' }], ['Digits', { ins: 'pad' }]],
  wave: [['FM-4', { ins: 'bass', accent: [0.7, 'bass-soft'] }]],                     // the arpeggiated bass
  noise: { kick: 'Drum Machine 36', snare: 'Drum Machine 37', hat: 'Drum Machine 38', open: 'Drum Machine 39', perc: 'Drum Machine 47' },
};
