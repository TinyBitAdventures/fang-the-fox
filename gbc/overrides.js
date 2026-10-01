// Game Boy Color edition: changes merged over js/data.js. Every entry is a place where the port
// differs from the web game, so keep it small and say why. tools/validate.js --gbc checks the result.
module.exports = {
  // the web game's ten album songs, played by five recreated for the Game Boy by hand (Austin, 2026-09-30):
  // each web song key (TRACKS, AREAS[..].music) to the one that plays in its place. music/<song>_gb.js are the
  // recreations (tools/music.js can still make a straight conversion from a map, to compare)
  music: { title: 'title_gb', home: 'home_gb', forest: 'forest_gb', slims: 'slims_gb', plasma: 'plasma_gb',
    battle: 'slims_gb', win: 'plasma_gb', dream: 'forest_gb', blitz: 'slims_gb', void: 'plasma_gb' },
  // the web game's lighting (render.js applyLighting: each biome's ambient colour over everything at B.dark,
  // with light pools around Fang, friends, foes, items and lamps), baked into the terrain palettes: light is
  // how much of that darkness they take (sprites stay fully lit, as the pools keep them on the web), tint mixes
  // in the colour the web's coloured light pools give the ground
  look: {
    default: { light: 0.65, glow: 'eEoOqi' },   // glow: colours that keep full light (lava, fire, crystals, portals), inside their own pools on the web
    night: { pin: ['1234'] },    // pin: palettes the solver keeps; Forest Home's pond over the portal that opens late in the story
    void: { light: 0.45 },       // the paths have to show without Fang's light pool
    dream: { light: 0.55 },
    frozen: { light: 1.2, glow: 'eEoOq' },   // a light biome on the web too, but greyer than its bare palette; its ice uses the crystals' cyan, unlit
    volcanic: { tint: ['#5a1a08', 0.14], glow: 'eEoOqiyY' },   // the lava's red light on the ash; its bright yellows
    enchanted: { glow: 'eEoOqMm' },   // the magic trees' blossoms, lit pink on the web (their leaves use the crystals' cyan, unlit)
  },
  rules: {
    minionCap: 3,   // web: 5 alive minions (js/game.js); 8x16 sprites allow 10 per scanline
  },
  areas: {
    // key: { map: [...], props: [...] } replaces those fields of AREAS[key]
    home: { signs: { 16: "Fang's cottage. Bump into things to talk, open or fight. B eats a fish. SELECT shows the whole area." },   // web: F and P keys
      // landmarks: the web's props stand behind the grid, off the GBC's screen, so the big ones take the place of a
      // run of solid cells (cell: the first, w: how many) and show their lower part, or hang into the row above.
      // The Hearth (lit by the story: flame) needs two floor cells beside Grandma turned solid; the two above it
      // can't be reached any more, and nothing was there
      map: ['F_T_TTT__&___a', '_T?__T_TT___d_', '_T_T__T__ff___', '___fC_________', '______________', '_T__________s_', '_T_TT_________', 'TTTww___s____d'],
      landmarks: [{ spr: 'house', cell: 4, w: 3 }, { spr: 'hearth_off', cell: 21, w: 2, flame: true }] },
    lake_tower: {   // Hoot's tower stands in the lake by the shore, on two water cells (solid either way), over water
      map: ['__?____SsS___&', '______wwsTT_C_', '___a__wwswww__', 'd____wwwwwww__', '_____wwwww____', '__f__wwwww____', '______wwww__d_', '______wwww____'],
      landmarks: [{ spr: 'tower', cell: 23, w: 2, floor: 'water_0' }] },
    dark_woods: { landmarks: [{ spr: 'tent', cell: 5, w: 2 }] },   // Rudy's
    secret_den: { landmarks: [{ spr: 'burrow', cell: 6, w: 2 }] },
  },
  // js/story.js lines that name the web game's keys, as gbc/src/story.c says them (the build checks that
  // every other line of story.js appears in story.c word for word)
  text: {
    "Here, take some fish for the road. Press F to eat when you\'re hurt. And do be careful.": "Here, take some fish for the road. Press B to eat when you\'re hurt. And do be careful.",
    'Arrows or WASD to move. Bump into Grandma to talk.': 'The D-pad moves. Bump into Grandma to talk.',
  },
};
