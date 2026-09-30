# Changelog: Game Boy Color edition

## Unreleased

The start of the port: Fang walks all 24 areas with the web game's maps, doors, monsters and friends, a HUD and music, playable in the browser as it's built.

### The ROM
- Color-only ROM (MBC5, 32 KB battery-backed save RAM, double speed) built with GBDK-2020 4.5.0.
- Fang walks cell to cell like the web game: a 7-frame hop, a bump when something is in the way (trees, walls, water, the Void, the island's edge, sealed gates, the web game's messages for each), and a held direction keeps walking.
- Doors fade out, swap the area and fade in (about 0.65 s), and put Fang on the right cell; doors that need a boss beaten, a perk or an item stay shut with the web game's message.
- The camera follows Fang across the 224 px area (10 of 14 columns on screen); an arrow at the screen edge marks each row with an enemy out of view.
- Every monster, boss and friend stands in its place and idles (bats flap faster, fliers bob). Sprites are drawn with GBDK's metasprites; when a row holds more than the GBC's 10 sprites, the ones that matter least take turns, so crowded rows flicker instead of losing enemies.
- HUD: health bar and numbers, attack, level, fish and gems on the top row; the area's name or the latest message underneath, in the web game's own font (variable width, so messages fit 38 characters a line). A long message takes both rows for 5 seconds.
- Music: hUGEDriver plays a placeholder loop from the VBlank interrupt (the album arrives in phase 7).
- Debug keys until the menus exist: SELECT goes to the next area, START to the previous one.

### Build
- Sprites: every kind of thing that moves (Fang, 5 friends, the kits, 25 monsters and bosses) cut into 8x16 pieces with 3 colours each (bosses get 2 palettes), placed in VRAM per area with its palettes; `build/preview/sprites.png` shows them all.
- Areas carry their cells, doors (target, arrival cell, what they need, their names) and everything standing in them; 7 of 8 sprite palettes at most (Fairy Glade, the World Tree).
- `music/*.js` songs compile to hUGEDriver data (`tools/lib/song.js`).
- `tools/build.js` draws each area's cells the way the web game does (floor variants, water, lava and void, tall walls, trees, gates and braziers hanging into the cell above), reduces every 8x8 tile to 4 colours and every biome to 5 palettes, and shares one tileset per biome (the largest, the woods, uses 140 of 256 tiles).
- Budget report (`make report`): sprites per row, total sprites and monster types per area, tiles per biome and how much of the art was recoloured (1-8% of pixels so far).
- `overrides.js` holds every change from the web game; `../tools/validate.js --gbc` checks the maps with them merged in.

### Web player
- binjgb in a page with the keyboard, controllers (Gamepad API), an on-screen pad on touch screens, its own save slot in the browser, and live reload on localhost: each build replaces the running ROM and keeps the save.

### Tests
- `tools/bot/shots.py` captures every area from the ROM in PyBoy, checks its background matches the build's preview pixel for pixel, and reports how much of a frame the game's work takes (the busiest, Slime Pond, uses 59 of 154 scanlines).
- `tools/bot/smoke.py`: 60 frames a second, walking, bumping, the camera, a door to the right area and cell, and the music playing.
- `tools/screenshot.js` drives the web player frame by frame with Playwright; steps can read and write the ROM's memory by symbol name.
