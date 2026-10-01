// Forest Exploration on the Game Boy (tools/music.js explains the fields). Run `node gbc/tools/music.js forest` after a change.
module.exports = {
  project: '2022-09-22 Forest Exploration',
  from: 0, to: 340,
  p1: [['Reaktor 6 3'], ['Synplant', { ins: 'pad' }]],                                 // the high line, the long notes
  p2: [['Reaktor 6 2', { ins: 'soft' }]],                                               // the ostinato under everything
  wave: [['Reaktor 6', { oct: -1, ins: 'round' }]],                                     // no bass part in the project: the mid line, an octave down
  noise: { kick: 'Drum Machine 36', clap: ['Drum Machine 37', 'Drum Machine 41'], hat: 'Drum Machine 38', open: 'Drum Machine 39', perc: 'Drum Machine 42' },
};
