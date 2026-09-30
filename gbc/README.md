# Fang the Fox: Game Boy Color edition

A port of [Fang the Fox](../README.md) to the Game Boy Color: a real `.gbc` ROM that runs in emulators (RetroArch, SameBoy, mGBA, a Retroid or any handheld), on a Game Boy Color from a flash cart, and in the browser. It is built from the web game's own maps and data (`../js/data.js`), so both versions stay the same game.

**Status:** in development. Fang walks all 24 areas and fights with the web game's rules (checked step for step against it), picks up items, levels up, solves the puzzles and can beat the bosses; the world changes on screen as it does on the web (gates, trails, crumbling paths, fog, animated water and lava). There's a HUD, sound effects and a placeholder song. Talking, the story and saving come next. What's done: [CHANGELOG.md](CHANGELOG.md).

## Play the development build

`make run` builds the ROM and copies it to `web/rom/fang.gbc`, where the web player picks it up. The player is `web/index.html` served by any web server (locally it is linked into the Cove site at `https://fangthefox.localhost/gbc/`). On localhost it reloads the ROM by itself after every build, and keeps the save.

| In the game | Game Boy | Keyboard | Controller |
|-------------|----------|----------|------------|
| Move, attack, talk | D-pad | Arrow keys | D-pad or left stick |
| Fire Spin (once learned) | A | X | Right or top face button |
| Eat a fish | B | Z | Bottom or left face button |
| Look at the whole area (hold) | Select | Shift | Select / Back |
| Next area (debug, until the pause menu) | Start | Enter | Start |
| Fast forward | | hold F | |

Touch screens get an on-screen pad. `?curve=1` or `?curve=2` colours the screen like a real GBC's LCD.



## Build

Needs [GBDK-2020](https://github.com/gbdk-2020/gbdk-2020) 4.5.0 (the tarball for your system, unpacked to `~/opt/gbdk` or pointed at with `GBDK_HOME`) and Node.

    make            # generate from the web game, then build build/fang.gbc
    make run        # also copy the ROM for the web player
    make watch      # rebuild on every change (the player reloads by itself)
    make report     # per-area budget table

The ROM is Color-only, MBC5 with 32 KB of battery-backed save RAM.

## How it's put together

| Path | What it holds |
|------|---------------|
| `tools/build.js` | Reads `../js/data.js` and the sprites, merges `overrides.js`, draws every look each cell can take (against every look of the cell below, whose tall art hangs into it) as metatiles, reduces the art to the GBC's limits (4 colours per 8x8 tile, 5 terrain palettes per biome, 256 tiles per biome) and writes the C tables to `src/gen/` plus a preview of every area (`build/preview/areas.png`). Fails the build when an area breaks a budget. |
| `overrides.js` | Everything the port changes from the web game, each with its reason. `node ../tools/validate.js --gbc` checks the merged maps. |
| `art/` | GBC art. Same format as the web sprites; a file here replaces the web sprite of the same name. |
| `src/` | The ROM's C code. The rules, ported from `js/game.js` function by function: `logic.c` (actions, items, areas), `combat.c` (attacks, damage, bosses, experience), `turn.c` (the enemies' turn) and `puzzle.c` (braziers, blocks, gates), sharing `rules.h`. The view: `game.c` (input, animations, drawing, every frame), `cells.c` (each cell's look, redraws, tile animation) and `screen.c` (floating numbers, the overview, entering areas). `area.c` loads areas and keeps visited ones in save RAM (`sram.h`); `sprites.c`, `pal.c`, `hud.c`/`hud_draw.c`, `text.c`, `sfx.c`, `audio.c`, `rng.c`, `far.c`. `src/gen/` is generated and not in git. |
| `music/` | Songs, compiled to hUGEDriver data by the build. `lib/hUGEDriver/` is the music driver (public domain). |
| `web/` | The web player: [binjgb](https://github.com/binji/binjgb) plus controllers, touch, a per-game save and live reload. |
| `tools/bot/` | [PyBoy](https://github.com/Baekalfen/PyBoy) tests: `shots.py` (every area's background matches the build's preview pixel for pixel, and the frame budget), `smoke.py` (walking, doors, camera, overview, music, the Goo King, braziers, blocks, a hidden Treant), `parity.py` and `parity_suite.py` (the ROM against the web game, step by step), `rom.py` (shared helpers: variables by name from `build/fang.noi`). |
| `tools/parity.js` | The web game headless with the ROM's random numbers, playing a scripted run (optionally from any area, with perks, flags and a level). |
| `tools/screenshot.js` | Playwright screenshots of the web player, driven frame by frame. |

## Tests

    node ../tools/validate.js --gbc                     # maps with the GBC overrides: everything reachable
    python3 -m venv .venv && .venv/bin/pip install pyboy==2.7.0 pillow
    .venv/bin/python tools/bot/shots.py                 # every area from the ROM matches the preview
    .venv/bin/python tools/bot/smoke.py                 # walking, doors, camera, overview, music, the Goo King, puzzles
    .venv/bin/python tools/bot/parity_suite.py          # the ROM plays 18 runs exactly like the web game
    PW=/path/to/node_modules/playwright OUT=build/shots/web \
      STEPS='[{"hold":["right"],"frames":40,"shot":1},{"press":"select","frames":30,"shot":1}]' node tools/screenshot.js

## Writing C for the Game Boy

SDCC's code for the Game Boy's CPU keeps locals on the stack and has no multiply or divide instructions, so per-frame code here uses arrays indexed by a byte (one array per field) instead of structs, `static` loop variables, lookup tables instead of `*`, `/` and `%` (`cell_col`, `cell_row`), and GBDK's assembly routines (metasprites) for the heavy lifting. `tools/bot/shots.py` fails if a frame overruns.

ROM bank 0 holds 16 KB and is always mapped; everything else sits in switchable banks. Code that runs every frame stays in bank 0; the rules and area loading are banked (`#pragma bank 255`, `BANKED` functions) and read other banks through `far.c`. A function that is handed a string must be in bank 0 (`hud_say`, `m_s`, `float_num`): the string may live in its caller's bank, which a banked callee would unmap.

The rules never touch the screen: `set_tile` records which cells changed, and after each action `cells_refresh` works out their new looks (a table for tiles that always look the same) and queues redraws, which `cells_frame` draws two a frame right after VBlank starts. Writing the background while the screen is on is safe with GBDK's copies (they wait for the PPU byte by byte), but slow, so a busy turn never draws all its cells at once.

Watch for: masks above bit 7 turned into a `uint8_t` vanish (`HAS_PERK` returns 0 or 1 for that reason); `Math.random() < p` is `rng < ceil(p * 2^32)` and `(Math.random() * n) | 0` is `rng_below(n)`, both exact.

## License

Code and pixel art: [MIT](../LICENSE). The web player's emulator is binjgb by Ben Smith (MIT) with code from GB Studio by Chris Maltby (MIT); their licences are in `web/vendor/`. The music is not covered by the code license.
