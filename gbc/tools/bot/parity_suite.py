#!/usr/bin/env python3
# Every parity scenario: areas chosen for their monsters' rules, perks that draw random numbers, and a
# run too weak for its area so Fang falls and gets back up. Each plays the web game and the ROM side
# by side (parity.py) and stops at the first step that differs.
# usage: gbc/.venv/bin/python gbc/tools/bot/parity_suite.py
import subprocess, sys
from rom import GBC

ALL_PERKS = 'criticalStrike,frostTouch,flameBurst,thickFur,regeneration,swiftFeet,fury,scavenger,treasureHunter,secondWind,heatResist,natureBond'
SCENARIOS = [   # steps, seed, area, perks, flags, level, what it covers
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
]
failed = 0
for steps, seed, area, perks, flags, level, what in SCENARIOS:
    out = subprocess.run([sys.executable, str(GBC / 'tools/bot/parity.py'), str(steps), str(seed), area, perks, flags, str(level)], capture_output=True, text=True)
    lines = [l for l in (out.stdout + out.stderr).splitlines() if 'SDL2' not in l and l.strip()]
    ok = out.returncode == 0
    failed += not ok
    print(f"{'ok  ' if ok else 'FAIL'} {area:17} {what}\n     " + '\n     '.join(lines[-6:] if not ok else lines[-2:]))
sys.exit(1 if failed else 0)
