# Changelog: Game Boy Color edition

## Unreleased

The start of the port: all 24 areas with the web game's maps and doors, turn-based combat with every monster's rules, items, levels, puzzles and a world that changes as you play, a HUD, sound effects and music, playable in the browser as it's built.

### The ROM
- Color-only ROM (MBC5, 32 KB battery-backed save RAM, double speed) built with GBDK-2020 4.5.0.
- Fang walks cell to cell like the web game: a 7-frame hop, a bump when something is in the way (trees, walls, water, the Void, the island's edge, sealed gates, the web game's messages for each), and a held direction keeps walking.
- Doors fade out, swap the area and fade in (about 0.65 s), and put Fang on the right cell; doors that need a boss beaten, a perk or an item stay shut with the web game's message.
- The camera follows Fang across the 224 px area (10 of 14 columns on screen); an arrow at the screen edge marks each row with an enemy out of view.
- Every monster, boss and friend stands in its place and idles (bats flap faster, fliers bob). Sprites are drawn with GBDK's metasprites; when a row holds more than the GBC's 10 sprites, the ones that matter least take turns, so crowded rows flicker instead of losing enemies.
- HUD: health bar and numbers, attack, level, fish and gems on the top row; the area's name or the latest message underneath, in the web game's own font (variable width, so messages fit 38 characters a line). A long message takes both rows for 5 seconds.
- Music: hUGEDriver plays a placeholder loop from the VBlank interrupt (the album arrives in phase 7).
- Turns and combat, ported from `js/game.js` function by function: bump to attack, counter-attacks, crits and every perk's effect in combat, levels and experience, falling and getting back up (with Grandma's care package), and every monster's rules: wolves acting every 2 turns, poison, bats and wisps taking 2 steps, dormant golems, skeletons that get back up, ice sprites that shatter into ice, charging frost bears, ice and lava trails, fireproof and armoured foes, healing sprites, camouflaged treants, sleepy moths, exploding shrooms, splitting shadow slims, and the bosses' summons, the Dragon's breath and eruption, Rotheart's roots and the Primordial's phases.
- Items lie in the areas as sprites (the plan had them in the background, but a background palette left 3 colours and a flat square under each): fish, golden fish, mushrooms, gems, keys, relics (20, counted across the world), chests and locked chests, the four potions, the Frost Cloak, Dragon Scale, heart containers, the Crystal Key and the five Embers. Foes sometimes drop fish; bosses drop their Embers beside them.
- B eats a fish; A is Fire Spin once learned (perk picks come in phase 4).
- Beating the Goo King opens the goo-sealed path out of the Lake Tower; every boss sets its story flag.
- Areas remember everything when you leave (in the cartridge's save RAM): foes' health and places, what was picked up, cells that changed.
- Holding SELECT shows the whole 14x8 area at 8 px a cell: Fang, foes, bosses, friends, items and doors.
- Damage and healing float up as numbers; hit foes blink; big moments shake the screen.
- 19 sound effects on the Game Boy's channels (tones on channel 2, noise on channel 4), borrowed from the music while they play.
- The HUD's lower row shows a living boss's name and health; long messages page through two rows at a time.
- Debug key until the pause menu exists: START goes to the next area.
- The world changes on screen as it does on the web: gates open, ice and lava trails spread and cool, paths crumble into lava or the Void and knit back, blocks sink into water and lava, secret passages open with Pathfinder, goo seals melt, and portals appear with the story. Each cell's picture is redrawn from the build's metatiles, with the cell above it when something tall hangs into it.
- Puzzles, ported from `js/game.js` (`puzzle.c`): braziers lit by bumping them or by Fire Spin, timed braziers that count down, flicker for their last 3 turns and gutter out, blocks pushed onto pressure plates, and the gates they open. An unsolved puzzle resets when you come back; a solved one stays solved.
- Water, lava, the Void and portals animate (their tiles step through 3 frames at the web game's speeds); a lit brazier's flame is a small animated sprite over the cold brazier, so it keeps its colours on any floor.
- Steam vents puff every third turn, fog hides foes and items more than a step away (Keen Eyes and True Sight clear it), and a Treant that hasn't woken is drawn in the background as one of the trees until Fang bumps it or walks up to it.
- Pushed blocks slide into place; the overview shows blocks and keeps hidden Treants and fogged things hidden.

### Build
- Sprites: every kind of thing that moves (Fang, 5 friends, the kits, 25 monsters and bosses) cut into 8x16 pieces with 3 colours each (bosses get 2 palettes), placed in VRAM per area with its palettes; `build/preview/sprites.png` shows them all.
- Areas carry their cells, doors (target, arrival cell, what they need, their names) and everything standing in them; 7 of 8 sprite palettes at most (Fairy Glade, the World Tree).
- `music/*.js` songs compile to hUGEDriver data (`tools/lib/song.js`); `music/sfx.js` holds the sound effects.
- The game's tables come from `js/data.js`: 26 monsters with their rules as flags, 21 items, 15 perks, 29 story flags, 20 relics numbered across the world. Items share three sprite palettes; the one the relics use doubles as the effects palette.
- The code is spread over ROM banks: bank 0 keeps what runs every frame, the rules and area loading live in switchable banks and read other banks through small bank-0 helpers.
- `tools/build.js` draws each area's cells the way the web game does (floor variants, water, lava and void, tall walls, trees, gates and braziers hanging into the cell above), reduces every 8x8 tile to 4 colours and every biome to 5 palettes, and shares one tileset per biome (the largest, the woods, uses 144 of 256 tiles).
- Every look a cell can take in play (worked out from the monsters that leave trails, the blocks, the gates, crumbling paths and doors that appear) is drawn against every look of the cell below it, as metatiles per area; animated tiles come first in each tileset, in runs the ROM copies in one go.
- Budget report (`make report`): sprites per row, total sprites and monster types per area, tiles per biome and how much of the art was recoloured (1-8% of pixels so far).
- `overrides.js` holds every change from the web game; `../tools/validate.js --gbc` checks the maps with them merged in.

### Web player
- binjgb in a page with the keyboard, controllers (Gamepad API), an on-screen pad on touch screens, its own save slot in the browser, and live reload on localhost: each build replaces the running ROM and keeps the save.

### Tests
- `tools/bot/shots.py` captures every area from the ROM in PyBoy, checks its background matches the build's preview pixel for pixel, and reports how much of a frame the game's work takes (the busiest, Slime Pond, uses 59 of 154 scanlines).
- `tools/bot/smoke.py`: 60 frames a second, walking, bumping, the camera, a door to the right area and cell, the overview, the music playing, beating the Goo King, Fire Spin lighting braziers and the gate redrawn open, a block pressing a plate, and a Treant hiding as a tree until it wakes.
- Parity with the web game: `tools/parity.js` plays the web game headless with the ROM's random numbers, and `tools/bot/parity.py` plays the same run on the ROM and compares every step (area, turn, Fang's numbers, every foe's cell and health, items). `tools/bot/parity_suite.py` runs 18 scenarios chosen for the monsters' rules, the perks, falling and the puzzles (every cell's tile, the blocks and the lit braziers are compared too); all match step for step. The web side walks the shortest path toward foes, cold braziers, blocks and doors, and a scenario can open with a script (`fight,goto:30,right,...`). Runs stop where the two sides can't match yet: a boss summoning or a slim splitting (their random spots are shuffled differently).
- `tools/screenshot.js` drives the web player frame by frame with Playwright; steps can read and write the ROM's memory by symbol name.
- `make` recompiles only the sources that changed (the generator rewrites only files whose content changed): a one-file change builds in seconds instead of minutes.
