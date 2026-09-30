#!/usr/bin/env python3
# Phase 1 smoke test: Fang walks, trees and the island's edge stop him, the camera follows, a door
# takes him to the right area and cell, and the music plays.
# usage: gbc/.venv/bin/python gbc/tools/bot/smoke.py
import sys
import numpy as np
from rom import Rom

fails = []
def check(ok, what):
    print(('ok   ' if ok else 'FAIL ') + what)
    if not ok: fails.append(what)

rom = Rom(sound=True)
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
peaks = []
for _ in range(60):
    rom.tick(1, False); a = rom.pb.sound.ndarray
    peaks.append(int(np.abs(a.astype(np.int32)).max()) if a.size else 0)
check(sum(p > 0 for p in peaks) > 50, 'the music is playing')
rom.stop()
if fails: sys.exit(1)
