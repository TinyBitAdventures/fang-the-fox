# Changelog: Game Boy Color edition

## Unreleased

The start of the port: the toolchain, the build from the web game's data, an area viewer ROM and a web player.

### The ROM
- Color-only ROM (MBC5, 32 KB battery-backed save RAM, double speed) built with GBDK-2020 4.5.0.
- An area viewer: all 24 areas drawn from the web maps with 16 px cells, the 224 px playfield scrolling behind a 160 px screen, and a two-line HUD in the window layer. SELECT or A goes to the next area, B to the previous one.

### Build
- `tools/build.js` draws each area's cells the way the web game does (floor variants, water, lava and void, tall walls, trees, gates and braziers hanging into the cell above), reduces every 8x8 tile to 4 colours and every biome to 5 palettes, and shares one tileset per biome (the largest, the woods, uses 140 of 256 tiles).
- Budget report (`make report`): sprites per row, total sprites and monster types per area, tiles per biome and how much of the art was recoloured (1-8% of pixels so far).
- `overrides.js` holds every change from the web game; `../tools/validate.js --gbc` checks the maps with them merged in.

### Web player
- binjgb in a page with the keyboard, controllers (Gamepad API), an on-screen pad on touch screens, its own save slot in the browser, and live reload on localhost: each build replaces the running ROM and keeps the save.

### Tests
- `tools/bot/shots.py` captures every area from the ROM in PyBoy and checks it matches the build's preview pixel for pixel.
- `tools/screenshot.js` drives the web player frame by frame with Playwright.
