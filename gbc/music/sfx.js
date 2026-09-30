// Sound effects, ported from the web game's Web Audio recipes (js/audio.js Sfx.play) to the Game Boy's
// channels: tones on channel 2 (a pulse wave: square stays square, triangle and sine get a 50% duty at
// a softer volume, sawtooth a 25% duty) and noise on channel 4. The music gives up those channels
// while an effect plays. Volumes are 0-15 in the web game's loudness tiers: footsteps 4, menu 6,
// feedback 9, important 11, big moments 13.
//   tone: [at ms, dur ms, f0 Hz, f1 Hz or 0, volume, duty 0-3]
//   noise: [at ms, dur ms, brightness 0 (low rumble) - 7 (hiss), volume]
module.exports = {
  step:    { tone: [[0, 50, 180, 140, 4, 2]] },
  attack:  { noise: [[0, 80, 5, 9]], tone: [[0, 100, 420, 160, 9, 2]] },
  crit:    { noise: [[0, 120, 5, 11]], tone: [[0, 160, 660, 220, 11, 2]] },
  hurt:    { tone: [[0, 180, 220, 70, 11, 1]] },
  kill:    { tone: [[0, 180, 520, 120, 9, 2]], noise: [[50, 150, 3, 7]] },
  pickup:  { tone: [[0, 60, 660, 0, 8, 2], [60, 90, 990, 0, 8, 2]] },
  gem:     { tone: [[0, 80, 880, 0, 7, 2], [50, 80, 1100, 0, 7, 2], [100, 80, 1320, 0, 7, 2], [150, 80, 1760, 0, 7, 2]] },
  heal:    { tone: [[0, 120, 392, 0, 8, 2], [70, 120, 523, 0, 8, 2], [140, 120, 659, 0, 8, 2]] },
  level:   { tone: [[0, 120, 523, 0, 10, 2], [80, 120, 659, 0, 10, 2], [160, 120, 784, 0, 10, 2], [240, 120, 1046, 0, 10, 2], [320, 120, 784, 0, 10, 2], [400, 120, 1046, 0, 10, 2]] },
  door:    { tone: [[0, 250, 300, 600, 7, 2]], noise: [[0, 200, 6, 3]] },
  bump:    { tone: [[0, 80, 90, 60, 7, 2]] },
  locked:  { tone: [[0, 80, 150, 0, 7, 2], [90, 120, 110, 0, 7, 2]] },
  splash:  { noise: [[0, 300, 4, 9]] },
  freeze:  { tone: [[0, 100, 1400, 0, 6, 2], [40, 100, 1800, 0, 6, 2], [80, 100, 2200, 0, 6, 2]] },
  spin:    { noise: [[0, 350, 3, 10]], tone: [[0, 300, 200, 800, 8, 1]] },
  boom:    { noise: [[0, 500, 1, 13]], tone: [[0, 400, 120, 40, 12, 2]] },
  select:  { tone: [[0, 50, 880, 0, 6, 2]] },
  thunder: { noise: [[0, 1200, 0, 12]] },
  roar:    { tone: [[0, 600, 110, 55, 12, 1]], noise: [[0, 500, 2, 8]] },
};
