// Game Boy Color edition: changes merged over js/data.js. Every entry is a place where the port
// differs from the web game, so keep it small and say why. tools/validate.js --gbc checks the result.
module.exports = {
  rules: {
    minionCap: 3,   // web: 5 alive minions (js/game.js); 8x16 sprites allow 10 per scanline
  },
  areas: {
    // key: { map: [...], props: [...] } replaces those fields of AREAS[key]
  },
};
