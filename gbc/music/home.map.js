// Forest Home on the Game Boy (tools/music.js explains the fields). Run `node gbc/tools/music.js home` after a change.
module.exports = {
  project: '2022-10-30 Forest Home',
  from: 0, to: 412,
  p1: [['Reaktor 6 2'], ['Vital'], ['Track 9']],                                       // the melody
  p2: [['Reaktor 6', { ins: 'bell' }], ['Vital 2', { ins: 'soft' }]],                  // the finale's sparkle, the chord figure
  wave: [['Kontakt', { ins: 'bass' }], ['Komplete Kontrol', { ins: 'round' }]],
  noise: { kick: 'Drum Machine 36', snare: 'Drum Machine 37', clap: 'Drum Machine 41', hat: 'Drum Machine 38', open: 'Drum Machine 39' },
};
