#!/usr/bin/env python3
# Parity: the ROM plays the run the web game played in tools/parity.js (same random numbers, same
# moves) and every step's state must match: area, turn, Fang's cell and numbers, fish, gems, buffs,
# every foe's cell, health and death, how many items lie in the area, every cell's tile, the blocks
# and the lit braziers.
# usage: gbc/.venv/bin/python gbc/tools/bot/parity.py [steps] [seed] [area] [perks,...] [flags,...] [level] [script]
import json, re, subprocess, sys
from rom import Rom, GBC

args = sys.argv[1:] or ['400', '1']
print(subprocess.run(['node', str(GBC / 'tools/parity.js')] + args, capture_output=True, text=True, check=True).stdout.strip())
run = json.loads((GBC / 'build/parity/web.json').read_text())
web, setup = run['steps'], run['setup']
if not web: print('parity: nothing to compare'); sys.exit(0)
flag_ids = {m.group(1): int(m.group(2)) for m in re.finditer(r'#define F_(\w+) (\d+)', (GBC / 'src/gen/world.h').read_text())}

rom = Rom()
BUTTON = {'right': 'right', 'left': 'left', 'up': 'up', 'down': 'down', 'eat': 'b', 'spin': 'a'}
S_PLAY, S_DEAD = 0, 2

def s16(v): return v - 65536 if v > 32767 else v
def idle():
    if rom.u8('game_state') != S_PLAY or rom.u8('fa') != 0: return False
    return all(rom.u8('en_anim', i) == 0 for i in range(rom.u8('en_n')))
def settle():
    for _ in range(400):
        rom.tick(1, False)
        if rom.u8('game_state') == S_DEAD:
            rom.tick(40, False); rom.pb.button_press('a'); rom.tick(2, False); rom.pb.button_release('a')
        if idle(): return
    raise SystemExit('the ROM never settled')
def state():
    n = rom.u8('en_n')
    return {'area': rom.area(), 'turn': rom.u16('turn'), 'x': rom.u8('fox', 8), 'y': rom.u8('fox', 9), 'hp': s16(rom.stat(0)), 'maxHp': rom.stat(2),
            'xp': rom.stat(4), 'next': rom.stat(6), 'lvl': rom.u8('fox', 11), 'atk': rom.u8('fox', 10),
            'fish': rom.u8('fish'), 'gems': rom.u8('gems'), 'poison': rom.u8('b_poison'), 'rooted': rom.u8('b_rooted'), 'sleep': rom.u8('b_sleep'),
            'enemies': [[rom.u8('en_x', i), rom.u8('en_y', i), s16(rom.u8('en_hp', 2 * i) | rom.u8('en_hp', 2 * i + 1) << 8), rom.u8('en_state', i) & 1] for i in range(n)],
            'items': sum(1 for i in range(rom.u8('item_n')) if rom.u8('item_code', i)),
            'tiles': bytes(rom.u8('tiles', i) for i in range(112)).decode('latin1'),
            'blocks': [[rom.u8('blk_x', i), rom.u8('blk_y', i)] for i in range(rom.u8('blk_n')) if rom.u8('blk_x', i) != 255],
            'lit': [[rom.u8('brz_cell', k), -1 if rom.u8('lit_t', k) == 255 else rom.u8('lit_t', k)] for k in range(rom.u8('brz_n')) if rom.u8('lit_t', k)]}

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
for n, step in enumerate(web):
    b = BUTTON[step['action']]
    f0 = rom.u16('frame_count')   # hold the button until the game has run two frames with it down
    rom.pb.button_press(b)
    for _ in range(30):
        rom.tick(1, False)
        if (rom.u16('frame_count') - f0) & 0xFFFF >= 2: break
    rom.pb.button_release(b)
    settle()
    got, want = state(), step['state']
    if got != want:
        diff = {k: (want[k], got[k]) for k in want if want[k] != got.get(k)}
        print(f'step {n + 1} ({step["action"]}{", died" if step["died"] else ""}): the ROM differs from the web game')
        for k, (w, g) in diff.items():
            if k == 'tiles': w, g = ('\n    ' + '\n    '.join(t[r * 14:r * 14 + 14] for r in range(8)) for t in (w, g))   # as a grid
            print(f'  {k}: web {w}  rom {g}')
        sys.exit(1)
refresh = rom.u8('dbg_refresh')
rom.stop()
print(f'parity: all {len(web)} steps match (turn {web[-1]["state"]["turn"]}, level {web[-1]["state"]["lvl"]}; the slowest cell refresh took {refresh} scanlines)')
