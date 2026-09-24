# Fang the Fox

A tiny pixel adventure across floating islands. Five Embers were stolen from Grandma Ember's Hearth and the Sky Isles are sinking. Guide Fang across 24 areas, beat five bosses, relight the Hearth and follow the rift down to the Primordial.

Built from scratch with an HTML5 canvas and plain JavaScript. No build step, no dependencies.

**Play it:** [tinybitadventures.com](https://tinybitadventures.com/games/fang-the-fox/) · What's new: [CHANGELOG.md](CHANGELOG.md)

## Controls

| Action | Keyboard | Touch |
|--------|----------|-------|
| Move, attack, talk | Arrow keys or WASD | D-pad, or tap next to Fang |
| Eat a fish (heal) | F | FISH |
| Fire Spin (once learned) | Space | SPIN |
| Map, quest, options | P or Esc | MENU |
| Mute all sound | M | Options menu |

Progress saves in the browser as you play.

## Run it locally

Serve the folder with any static web server and open it:

    python3 -m http.server 8000     # then open http://localhost:8000

Opening `index.html` straight from disk mostly works, but a web server is closer to how it's played.

## How it's put together

| File | What it holds |
|------|---------------|
| `js/data.js` | Areas (tile maps, doors, signs, NPCs), monsters, items, perks, biomes, music tracks, `GAME_VERSION` |
| `js/game.js` | Game state, turns, combat, puzzles, saving and the story queue |
| `js/story.js` | Dialogue, quests, bosses' scenes, the ending and credits |
| `js/view.js` | Drawing the world and HUD, menus, input and the main loop |
| `js/render.js` | Sprite cache, skies, islands, lighting and weather |
| `js/audio.js`, `js/settings.js` | The mixer, music, sound effects and saved options |
| `js/sprites-*.js`, `js/palette.js`, `js/font.js` | Pixel art as ASCII grids, the palette and the bitmap font |

Story beats go through `queueStory()` rather than timers so they never interrupt a death, a door or a menu.

## Tests

The tools need Node and [Playwright](https://playwright.dev) (point `PW` at its install) and run against a served copy (`URL`, defaults to the local dev site):

    node tools/validate.js                                   # every door, item, NPC and brazier reachable; no one-way crumble traps
    PW=/path/to/node_modules/playwright URL=http://localhost:8000/ node tools/playthrough.js
                                                             # a bot plays start to credits (0-3 deaths is normal balance)
    node tools/preview.js sheet.png js/sprites-chars.js      # render sprites to a contact sheet

Run `validate.js` after map edits and `playthrough.js` after logic changes.

## Music

The soundtrack is the album [Tiny Bit Adventures](https://soundcloud.com/austinginder/sets/tiny-bit-adventures) by Austin Ginder, streamed from Backblaze B2. The music isn't included in this repository and isn't covered by the code license.

## License

Code and pixel art: [MIT](LICENSE). Part of [Tiny Bit Adventures](https://github.com/TinyBitAdventures).
