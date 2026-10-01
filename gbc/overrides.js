// Game Boy Color edition: changes merged over js/data.js. Every entry is a place where the port
// differs from the web game, so keep it small and say why. tools/validate.js --gbc checks the result.
module.exports = {
  // the web game's ten album songs, played by the five converted for the Game Boy (Austin, 2026-09-30):
  // each web song key (TRACKS, AREAS[..].music) to the one that plays in its place
  music: { title: 'title', home: 'home', forest: 'forest', slims: 'slims', plasma: 'plasma',
    battle: 'slims', win: 'plasma', dream: 'forest', blitz: 'slims', void: 'plasma' },
  // the web game's lighting (render.js applyLighting: each biome's ambient colour over everything at B.dark,
  // with light pools around Fang, friends, foes, items and lamps), baked into the terrain palettes: light is
  // how much of that darkness they take (sprites stay fully lit, as the pools keep them on the web), tint mixes
  // in the colour the web's coloured light pools give the ground
  look: {
    default: { light: 0.65, glow: 'eEyYOoiqMm' },   // glow: colours that keep full light (lava, fire, lit windows, crystals, portals, blossoms), inside their own pools on the web
    void: { light: 0.45 },       // the paths have to show without Fang's light pool
    dream: { light: 0.55 },
    frozen: { light: 1.4, glow: 'eEyYOoqMm' },   // a light biome on the web too, but greyer than its bare palette; its ice uses the crystals' cyan, unlit
    volcanic: { tint: ['#5a1a08', 0.14] },   // the lava's red light on the ash
  },
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
