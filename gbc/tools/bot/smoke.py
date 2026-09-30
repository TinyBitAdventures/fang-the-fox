#!/usr/bin/env python3
# Smoke test: Fang walks, trees and the island's edge stop him, the camera follows, a door takes him
# to the right area and cell, the music plays, SELECT shows the overview.
# usage: gbc/.venv/bin/python gbc/tools/bot/smoke.py
import sys
import numpy as np
from rom import Rom

fails = []
def check(ok, what):
    print(('ok   ' if ok else 'FAIL ') + what)
    if not ok: fails.append(what)

rom = Rom(sound=True)
rom.poke('en_n', 0); rom.poke('item_n', 0)   # an empty Forest Home: these checks are about moving (tools/bot/parity.py covers the rules)
f0 = rom.u16('frame_count'); rom.tick(60)
check(58 <= rom.u16('frame_count') - f0 <= 61, 'the game loop runs at 60 frames a second')
check(rom.fox() == (0, 0) and rom.area() == 0, "Fang starts on Forest Home's F cell")
rom.hold('right', 30)
check(rom.fox() == (1, 0), 'holding right walks until the tree at (2,0)')
rom.tap('up')
check(rom.fox() == (1, 0), 'the edge of the island stops him')
rom.tap('left'); rom.tap('down'); rom.tap('down'); rom.tap('down'); rom.tap('down')
check(rom.fox() == (0, 4), 'taps move one cell each')
rom.hold('right', 12 * 7)
check(rom.fox() == (12, 4), 'holding right keeps walking (7 frames a cell)')
rom.tick(20)
check(rom.u8('cam_x') == 64, 'the camera follows him to the right edge of the area')
rom.hold('up', 3 * 7); rom.tick(40)
check(rom.area() == 4 and rom.fox() == (43 % 14, 43 // 14), 'the door at cell 26 leads to Lake Tower, cell 43')
rom.pb.button_press('select'); rom.tick(4)
check(rom.pb.memory[0xFF42] == 128 and not rom.pb.memory[0xFF40] & 2, 'holding SELECT shows the overview (sprites off, the map below)')
rom.pb.button_release('select'); rom.tick(4)
check(rom.pb.memory[0xFF42] == 0 and rom.pb.memory[0xFF40] & 2, 'letting go of SELECT goes back to the game')
peaks = []
for _ in range(60):
    rom.tick(1, False); a = rom.pb.sound.ndarray
    peaks.append(int(np.abs(a.astype(np.int32)).max()) if a.size else 0)
check(sum(p > 0 for p in peaks) > 50, 'the music is playing')
# the Goo King: a strong Fang beats him, the Forest Ember drops, the goo door opens
rom.poke('dbg_goto', 4); rom.tick(60)   # the Goo King's grotto
rom.poke('fox', 99, 10); rom.poke('fox', 0x2C, 0); rom.poke('fox', 1, 1); rom.poke('fox', 0x2C, 2); rom.poke('fox', 1, 3)
boss = next(i for i in range(rom.u8('en_n')) if rom.u8('en_type', i) == 20)
for _ in range(80):
    if rom.u8('en_state', boss) & 1: break
    (fx, fy), bx, by = rom.fox(), rom.u8('en_x', boss), rom.u8('en_y', boss)
    rom.tap(('right' if bx > fx else 'left') if bx != fx else ('down' if by > fy else 'up'), 14)
check(rom.u8('en_state', boss) & 1 and rom.u8('flags') & (1 << 6), 'the Goo King falls and the gooking flag is set')
ember = [(rom.u8('item_cell', i) % 14, rom.u8('item_cell', i) // 14) for i in range(rom.u8('item_n')) if rom.u8('item_code', i) == 17]
check(len(ember) == 1, 'the Forest Ember drops')
rom.poke('dbg_goto', 5); rom.tick(60)
rom.poke('fox', 12, 8); rom.poke('fox', 5, 9); rom.tick(4)
rom.tap('down', 60)
check(rom.area() == 5, "the Lake Tower's goo door now leads to the Dark Woods")
rom.stop()
if fails: sys.exit(1)
