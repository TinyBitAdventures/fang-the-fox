# Fang the Fox: Game Boy Color edition

A port of [Fang the Fox](../README.md) to the Game Boy Color: a real `.gbc` ROM that runs in emulators (RetroArch, SameBoy, mGBA, a Retroid or any handheld), on a Game Boy Color from a flash cart, and in the browser. It is built from the web game's own maps and data (`../js/data.js`), so both versions stay the same game.

**Status:** in development. Fang walks all 24 areas: doors, the camera, every monster and friend in place, the HUD and a placeholder song. Fighting, items and the story come next. What's done: [CHANGELOG.md](CHANGELOG.md).

## Play the development build

`make run` builds the ROM and copies it to `web/rom/fang.gbc`, where the web player picks it up. The player is `web/index.html` served by any web server (locally it is linked into the Cove site at `https://fangthefox.localhost/gbc/`). On localhost it reloads the ROM by itself after every build, and keeps the save.

| Game Boy | Keyboard | Controller |
|----------|----------|------------|
| D-pad | Arrow keys | D-pad or left stick |
| A | X | Right or top face button |
| B | Z | Bottom or left face button |
| Start | Enter | Start |
| Select | Shift | Select / Back |
| Fast forward | hold F | |

Touch screens get an on-screen pad. `?curve=1` or `?curve=2` colours the screen like a real GBC's LCD.

Until the menus exist, SELECT jumps to the next area and START to the previous one.

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
| `tools/build.js` | Reads `../js/data.js` and the sprites, merges `overrides.js`, draws each area's cells, reduces the art to the GBC's limits (4 colours per 8x8 tile, 5 terrain palettes per biome, 256 tiles per biome) and writes the C tables to `src/gen/` plus a preview of every area (`build/preview/areas.png`). Fails the build when an area breaks a budget. |
| `overrides.js` | Everything the port changes from the web game, each with its reason. `node ../tools/validate.js --gbc` checks the merged maps. |
| `art/` | GBC art. Same format as the web sprites; a file here replaces the web sprite of the same name. |
| `src/` | The ROM's C code: `game.c` (the port of `js/game.js`: moving, bumping, doors, drawing), `area.c` (loading an area, palettes and fades), `sprites.c`, `hud.c` and `text.c` (the HUD and its font), `audio.c`. `src/gen/` is generated and not in git. |
| `music/` | Songs, compiled to hUGEDriver data by the build. `lib/hUGEDriver/` is the music driver (public domain). |
| `web/` | The web player: [binjgb](https://github.com/binji/binjgb) plus controllers, touch, a per-game save and live reload. |
| `tools/bot/` | [PyBoy](https://github.com/Baekalfen/PyBoy) tests: `shots.py` (every area's background matches the build's preview pixel for pixel, and the frame budget), `smoke.py` (walking, doors, camera, music), `rom.py` (shared helpers: variables by name from `build/fang.noi`). |
| `tools/screenshot.js` | Playwright screenshots of the web player, driven frame by frame. |

## Tests

    node ../tools/validate.js --gbc                     # maps with the GBC overrides: everything reachable
    python3 -m venv .venv && .venv/bin/pip install pyboy==2.7.0 pillow
    .venv/bin/python tools/bot/shots.py                 # every area from the ROM matches the preview
    .venv/bin/python tools/bot/smoke.py                 # walking, doors, camera, music
    PW=/path/to/node_modules/playwright OUT=build/shots/web \
      STEPS='[{"hold":["right"],"frames":40,"shot":1},{"press":"select","frames":30,"shot":1}]' node tools/screenshot.js

## Writing C for the Game Boy

SDCC's code for the Game Boy's CPU keeps locals on the stack and has no multiply or divide instructions, so per-frame code here uses arrays indexed by a byte (one array per field) instead of structs, `static` loop variables, shifts instead of `*` and `/`, and GBDK's assembly routines (metasprites) for the heavy lifting. `tools/bot/shots.py` fails if a frame overruns.

## License

Code and pixel art: [MIT](../LICENSE). The web player's emulator is binjgb by Ben Smith (MIT) with code from GB Studio by Chris Maltby (MIT); their licences are in `web/vendor/`. The music is not covered by the code license.
