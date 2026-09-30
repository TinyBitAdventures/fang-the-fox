#!/usr/bin/env python3
# Parity: the ROM plays the run the web game played in tools/parity.js (same random numbers, same
# moves) and every step's state must match: area, turn, Fang's cell and numbers, fish, gems, buffs,
# every foe's cell, health and death, how many items lie in the area, every cell's tile, the blocks
# and the lit braziers.
# usage: gbc/.venv/bin/python gbc/tools/bot/parity.py [steps] [seed] [area] [perks,...] [flags,...] [level] [script]
import json, os, re, subprocess, sys
from rom import Rom, GBC, S_PLAY, S_DEAD, S_TALK, S_PERK, S_SHOP

args = sys.argv[1:] or ['400', '1']
print(subprocess.run(['node', str(GBC / 'tools/parity.js')] + args, capture_output=True, text=True, check=True).stdout.strip())
run = json.loads((GBC / 'build/parity/web.json').read_text())
web, setup = run['steps'], run['setup']
if not web: print('parity: nothing to compare'); sys.exit(0)
WORLD = (GBC / 'src/gen/world.h').read_text()
flag_ids = {m.group(1): int(m.group(2)) for m in re.finditer(r'#define F_(\w+) (\d+)', WORLD)}
perk_ids = {m.group(1): int(m.group(2)) for m in re.finditer(r'#define P_(\w+) (\d+)', WORLD)}

rom = Rom()
BUTTON = {'right': 'right', 'left': 'left', 'up': 'up', 'down': 'down', 'eat': 'b', 'spin': 'a'}

def s16(v): return v - 65536 if v > 32767 else v
def idle():
    if rom.u8('game_state') != S_PLAY or rom.u8('fa') != 0: return False
    return all(rom.u8('en_anim', i) == 0 for i in range(rom.u8('en_n')))
def press(b, frames=2):   # held until the game has run `frames` frames with it down
    f0 = rom.u16('frame_count'); rom.pb.button_press(b)
    for _ in range(60):
        rom.tick(1, False)
        if (rom.u16('frame_count') - f0) & 0xFFFF >= frames: break
    rom.pb.button_release(b)
    for _ in range(60):   # and until a frame has run without it
        f0 = rom.u16('frame_count'); rom.tick(1, False)
        if (rom.u16('frame_count') - f0) & 0xFFFF: break
def settle(ui=()):   # as the web side did: dialogue read through, the perk and ware it chose, story beats played
    ui, quiet = list(ui), 0
    for _ in range(4000):
        s = rom.u8('game_state')
        if s == S_DEAD: rom.tick(40, False); press('a'); quiet = 0; continue
        if s == S_TALK: press('a'); quiet = 0; continue
        if s in (S_PERK, S_SHOP):
            kind, i = ui.pop(0) if ui else ('?', 0)
            if kind != ('perk' if s == S_PERK else 'shop'): raise SystemExit(f'the ROM opened a {"perk pick" if s == S_PERK else "shop"}; the web game did {kind}')
            for _ in range(i): press('down')
            press('a')
            if s == S_SHOP: press('b')
            quiet = 0; continue
        quiet = quiet + 1 if idle() and not rom.u8('story_n') and not rom.u8('hud_hold') else 0
        if quiet > 3:
            if ui: raise SystemExit(f'the web game still had {ui} to do')
            return
        rom.tick(1, False)
    raise SystemExit('the ROM never settled')
def names(var, ids, nbytes):   # the set bits of a flag or perk field, by world.h name
    bits = sum(rom.u8(var, k) << (8 * k) for k in range(nbytes))
    return sorted(n for n, i in ids.items() if bits >> i & 1)
def state():
    n = rom.u8('en_n')
    return {'area': rom.area(), 'turn': rom.u16('turn'), 'x': rom.u8('fox', 8), 'y': rom.u8('fox', 9), 'hp': s16(rom.stat(0)), 'maxHp': rom.stat(2),
            'xp': rom.stat(4), 'next': rom.stat(6), 'lvl': rom.u8('fox', 11), 'atk': rom.u8('fox', 10),
            'fish': rom.u8('fish'), 'gems': rom.u8('gems'), 'poison': rom.u8('b_poison'), 'rooted': rom.u8('b_rooted'), 'sleep': rom.u8('b_sleep'),
            'enemies': [[rom.u8('en_x', i), rom.u8('en_y', i), s16(rom.u8('en_hp', 2 * i) | rom.u8('en_hp', 2 * i + 1) << 8), rom.u8('en_state', i) & 1] for i in range(n)],
            'items': sum(1 for i in range(rom.u8('item_n')) if rom.u8('item_code', i)),
            'tiles': bytes(rom.u8('tiles', i) for i in range(112)).decode('latin1'),
            'blocks': [[rom.u8('blk_x', i), rom.u8('blk_y', i)] for i in range(rom.u8('blk_n')) if rom.u8('blk_x', i) != 255],
            'lit': [[rom.u8('brz_cell', k), -1 if rom.u8('lit_t', k) == 255 else rom.u8('lit_t', k)] for k in range(rom.u8('brz_n')) if rom.u8('lit_t', k)],
            'rng': sum(rom.u8('rng_state', k) << (8 * k) for k in range(4)), 'keys': rom.u8('keys'), 'flags': names('flags', flag_ids, 4), 'perks': names('perks', perk_ids, 2), 'kits': names('kits_rescued', {f'KIT{k + 1}': k for k in range(5)}, 1), 'story': rom.u8('story_n'), 'pending': rom.u8('pending_perks')}

settle()
# the setup: Fang's numbers, perks and flags, then the starting area (dbg_goto)
f = setup['fox']
for off, v in ((0, f['hp']), (2, f['maxHp']), (6, f['next'])): rom.poke('fox', v & 255, off); rom.poke('fox', v >> 8, off + 1)
rom.poke('fox', f['atk'], 10); rom.poke('fox', f['lvl'], 11)
perks = sum(1 << p for p in setup['perks']); rom.poke('perks', perks & 255); rom.poke('perks', perks >> 8, 1)
for name in setup['flags']:
    i = flag_ids[re.sub(r'[^A-Za-z0-9]', '_', name).upper()]; rom.poke('flags', rom.u8('flags', i >> 3) | 1 << (i & 7), i >> 3)
if setup['area']:
    rom.poke('dbg_goto', setup['area'] + 1)
    rom.tick(60, False)
settle()
import os
DEBUG = int(os.environ.get('DEBUG_STEP', 0))
for n, step in enumerate(web):
    b = BUTTON[step['action']]
    f0 = rom.u16('frame_count')   # hold the button until the game has run two frames with it down
    rom.pb.button_press(b)
    for _ in range(30):
        rom.tick(1, False)
        if n + 1 == DEBUG: print('  tick: frames', (rom.u16('frame_count') - f0) & 0xFFFF, 'state', rom.u8('game_state'), 'fa', rom.u8('fa'), 'turn', rom.u16('turn'), 'fox', rom.fox(), 'queued?', 'PC', hex(rom.pb.register_file.PC))
        if (rom.u16('frame_count') - f0) & 0xFFFF >= 2: break
    rom.pb.button_release(b)
    settle(step.get('ui', []))
    got, want = state(), step['state']
    if got != want:
        diff = {k: (want[k], got[k]) for k in want if want[k] != got.get(k)}
        print(f'step {n + 1} ({step["action"]}{", died" if step["died"] else ""}): the ROM differs from the web game')
        print(f'  (rom: state {rom.u8("game_state")}, fox animation {rom.u8("fa")}/{rom.u8("fa", 1)}/{rom.u8("fa", 2)}, hud_hold {rom.u8("hud_hold")}, story {rom.u8("story_n")}, WY {rom.pb.memory[0xFF4A]})')
        for k, (w, g) in diff.items():
            if k == 'tiles': w, g = ('\n    ' + '\n    '.join(t[r * 14:r * 14 + 14] for r in range(8)) for t in (w, g))   # as a grid
            print(f'  {k}: web {w}  rom {g}')
        sys.exit(1)
refresh = rom.u8('dbg_refresh')
rom.stop()
print(f'parity: all {len(web)} steps match (turn {web[-1]["state"]["turn"]}, level {web[-1]["state"]["lvl"]}; the slowest cell refresh took {refresh} scanlines)')
