// Game Boy Color edition: changes merged over js/data.js. Every entry is a place where the port
// differs from the web game, so keep it small and say why. tools/validate.js --gbc checks the result.
module.exports = {
  // the web game's ten album songs, played by the five converted for the Game Boy (Austin, 2026-09-30):
  // each web song key (TRACKS, AREAS[..].music) to the one that plays in its place
  music: { title: 'title', home: 'home', forest: 'forest', slims: 'slims', plasma: 'plasma',
    battle: 'slims', win: 'plasma', dream: 'forest', blitz: 'slims', void: 'plasma' },
  rules: {
    minionCap: 3,   // web: 5 alive minions (js/game.js); 8x16 sprites allow 10 per scanline
  },
  areas: {
    // key: { map: [...], props: [...] } replaces those fields of AREAS[key]
    home: { signs: { 16: "Fang's cottage. Bump into things to talk, open or fight. B eats a fish. SELECT shows the whole area." } },   // web: F and P keys
  },
  // js/story.js lines that name the web game's keys, as gbc/src/story.c says them (the build checks that
  // every other line of story.js appears in story.c word for word)
  text: {
    "Here, take some fish for the road. Press F to eat when you\'re hurt. And do be careful.": "Here, take some fish for the road. Press B to eat when you\'re hurt. And do be careful.",
    'Arrows or WASD to move. Bump into Grandma to talk.': 'The D-pad moves. Bump into Grandma to talk.',
  },
};
