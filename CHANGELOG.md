# Changelog

## Unreleased

### Tools
- `tools/validate.js --gbc` checks the maps with the Game Boy Color edition's overrides (`gbc/overrides.js`) merged in, and the validator now exits non-zero when it finds a problem.

### Game Boy Color edition
- Work has started on a Game Boy Color port in `gbc/`, built from this game's own maps and data. See `gbc/CHANGELOG.md`.

## v1.0.0 (2026-09-24)

The pixel edition: Fang the Fox rebuilt from the 2022 prototype into a complete adventure.

### The adventure
- A full story: five Embers stolen from Grandma Ember's Hearth, the Sky Isles sinking, and a final descent into the Void to face the Primordial. Ends with credits and a post-game to finish collecting.
- 24 areas across forests, crystal caves, ancient ruins, frozen peaks, volcanoes, an enchanted glade and the Void.
- Five Ember bosses (Goo King, Ancient Guardian, Ice Colossus, Volcanic Dragon, Rotheart) plus the Primordial.
- Friends: Grandma Ember, Hoot (relic lessons at 5, 10, 15 and 20 relics), Rudy's gem shop, Lumen and the Fairy Queen.
- Side quests: five lost kits to bring home and 20 relics to find.
- Puzzles: braziers (some timed), push blocks and pressure plates, sliding ice, crumbling paths, void tiles.
- Level ups with a choice of perks. Saves automatically.

### Pixel art
- A 384x240 canvas scaled by whole pixels (fills the frame when embedded), dithered lighting, weather and floating islands.
- Every island has its own silhouette: side ledges and notches, one of five undersides, drifting rocks.
- Enemies carry a small light and a moonlit rim, so they read in the darkest areas.

### Sound
- The Tiny Bit Adventures album as the soundtrack, levelled to one loudness and crossfaded between areas.
- Sound effects set in loudness tiers so the important ones sit above the music; music dips under big moments.
- Music plays through Web Audio, so volume and mute work on iPhone and iPad. It pauses in a background tab and retries a track that fails to load.

### Options
- Music volume, sound volume, screen shake, screen flashes and mute all (the M key too), saved apart from the game save.

### Fixes before release
- The Void could strand you for good if you crossed its crumbling path early or died after crossing. Crumbled paths now re-form.
- A one-square dead end in the Dreamspace trapped Fang behind a crumbling tile.
- Story scenes could cover the death screen, interrupt a door transition or replace the perk menu. They now wait for normal play, and pending scenes survive a reload.
- The game could save at 0 HP, and a reload during the ending skipped the credits for good.

### Tools
- `tools/validate.js` checks every area is reachable and flags crumbling paths that split an area.
- `tools/playthrough.js` plays the whole story in a headless browser with a pathfinding bot.
