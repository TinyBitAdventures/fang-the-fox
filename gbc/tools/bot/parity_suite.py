#!/usr/bin/env python3
# Every parity scenario: areas chosen for their monsters' rules, perks that draw random numbers, and a
# run too weak for its area so Fang falls and gets back up. Each plays the web game and the ROM side
# by side (parity.py) and stops at the first step that differs.
# usage: gbc/.venv/bin/python gbc/tools/bot/parity_suite.py
import subprocess, sys
from rom import GBC

ALL_PERKS = 'criticalStrike,frostTouch,flameBurst,thickFur,regeneration,swiftFeet,fury,scavenger,treasureHunter,secondWind,heatResist,natureBond'
SCENARIOS = [   # steps, seed, area, perks, flags, level, what it covers[, a scripted opening (tools/parity.js)]
  (1500, 3, 'home', '', '', 1, 'the start: slimes, chests, relics, fish'),
  (800, 4, 'dark_woods', '', 'gooking', 3, 'wolves (every 2 turns), spiders (poison)'),
  (800, 5, 'crystal_cave', '', 'gooking', 4, 'bats (2 steps, flying), dormant golems'),
  (800, 6, 'ancient_ruins!', '', 'gooking,crystalKey', 6, 'skeletons that revive, the Guardian until it summons'),
  (800, 7, 'glacier_pass', '', 'gooking,guardian', 6, 'ice sprites (shatter), frost bears (charge), wisps (ice trail), slipping'),
  (800, 8, 'frozen_throne!', '', 'gooking,guardian', 8, 'the Ice Colossus freezing the floor'),
  (800, 9, 'magma_caverns', '', 'gooking,guardian,colossus,cloak', 8, 'fire elementals, salamanders (lava trail that cools), armoured lava golems, lava'),
  (800, 10, 'dragons_forge!', '', 'gooking,guardian,colossus,cloak', 10, "the Dragon's breath and eruption"),
  (800, 11, 'whispering_woods', '', 'gooking,guardian,colossus,dragon,scale', 10, 'healing sprites, camouflaged treants, sleepy moths, exploding shrooms, vines'),
  (800, 12, 'world_tree!', '', 'gooking,guardian,colossus,dragon,scale', 12, 'Rotheart: roots until it summons'),
  (800, 13, 'the_void', '', 'gooking,guardian,colossus,dragon,rotheart,hearth', 12, 'void wisps (2 steps), shadow slims until they split, crumbling paths'),
  (1000, 14, 'dark_woods', ALL_PERKS, 'gooking', 5, 'perks: crits, frost touch, flame burst, fury, regeneration and more'),
  (1000, 15, 'magma_caverns', '', 'cloak', 1, 'too weak on purpose: falling, the care package, getting back up'),
  (600, 16, 'hollow_path!', 'fireSpin', 'gooking', 5, 'braziers lit by bumping and by Fire Spin, the gate they open'),
  (300, 17, 'crystal_depths!', '', 'gooking', 6, 'blocks pushed onto pressure plates, the gate they open',
   'fight,goto:30,right,right,right,right,goto:58,right,right,right,right'),
  (600, 21, 'lava_bridges!', 'fireSpin', 'gooking,guardian,colossus,cloak', 9, 'timed braziers guttering out, paths crumbling into lava, vents'),
  (600, 19, 'ice_caves', '', 'gooking,guardian', 7, 'sliding across the ice to the next wall'),
  (600, 20, 'void_heart!', 'fireSpin', 'gooking,guardian,colossus,dragon,rotheart,hearth', 12, 'braziers with no gate, void wisps'),
  (300, 22, 'elemental_portal!', '', 'gooking,guardian', 8, "Rudy's greetings and shop, Lumen's light"),
  (300, 23, 'lake_tower!', '', 'gooking', 4, 'Hoot, and the goo seal gone'),
  (300, 24, 'slime_pond!', '', '', 2, 'Pip the kit, rescued and sent home'),
  (400, 25, 'fairy_glade!', '', 'gooking,guardian,colossus,dragon,scale', 10, 'the Fairy Queen, True Sight and fog'),
]
failed = 0
for steps, seed, area, perks, flags, level, what, *script in SCENARIOS:
    out = subprocess.run([sys.executable, str(GBC / 'tools/bot/parity.py'), str(steps), str(seed), area, perks, flags, str(level)] + script, capture_output=True, text=True)
    lines = [l for l in (out.stdout + out.stderr).splitlines() if 'SDL2' not in l and l.strip()]
    ok = out.returncode == 0
    failed += not ok
    print(f"{'ok  ' if ok else 'FAIL'} {area:17} {what}\n     " + '\n     '.join(lines[-6:] if not ok else lines[-2:]))
sys.exit(1 if failed else 0)
