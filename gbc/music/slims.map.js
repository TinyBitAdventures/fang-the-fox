// Slim Monsters on the Game Boy (tools/music.js explains the fields). Run `node gbc/tools/music.js slims` after a change.
module.exports = {
  project: '2022-09-23 Slim Monsters',
  from: 0, to: 400,
  p1: [['ToneZ', { chord: 'top' }]],
  p2: [['Reaktor 6', { ins: 'soft' }], ['Track 6', { ins: 'pad' }]],
  wave: [['FM-4', { ins: 'bass' }]],
  noise: { kick: 'Drum Machine 36', snare: 'Drum Machine 37', hat: 'Drum Machine 38' },
};
