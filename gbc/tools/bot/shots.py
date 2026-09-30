#!/usr/bin/env python3
# Every area from the ROM (PyBoy, headless): the background compared pixel by pixel with the build's
# preview (build/preview/areas.png), with sprites and the HUD hidden and the camera pinned at both ends;
# then a contact sheet of every area as the player sees it (build/shots/areas-rom.png), and how much of
# a frame the game's work takes in each area (scanlines, of 154; a frame that overruns fails).
# usage: gbc/.venv/bin/python gbc/tools/bot/shots.py
import re, sys
import numpy as np
from PIL import Image
from rom import Rom, GBC

count = int(re.search(r'#define AREA_COUNT (\d+)', (GBC / 'src/gen/world.h').read_text()).group(1))
out = GBC / 'build/shots'
out.mkdir(parents=True, exist_ok=True)
preview = np.asarray(Image.open(GBC / 'build/preview/areas.png').convert('RGB'))
COLS, CW, CH = 4, 228, 132            # the preview's layout: 224x128 cells with a 4 px gutter
SW, SH = 168, 152                     # the contact sheet: 160x144 screens with an 8 px gutter
sheet = Image.new('RGB', (COLS * SW, ((count + COLS - 1) // COLS) * SH), (16, 16, 24))

rom = Rom()
LCDC = 0xFF40
bad, budget = [], []
for n in range(count):
    rom.tick(50)                                              # the fade in after the door
    rom.tick(1, False)
    start, end = rom.u8('dbg_ly'), rom.u8('dbg_ly', 1)
    used = (end - start) % 154
    budget.append((used, n))
    if not (start >= 144 and (end > start or end < 144)): bad.append(f'area {n + 1}: the frame overran (scanline {start} to {end})')
    sheet.paste(Image.fromarray(rom.screen()), ((n % COLS) * SW, (n // COLS) * SH))
    lcdc = rom.pb.memory[LCDC]
    rom.pb.memory[LCDC] = lcdc & ~0x22                        # sprites and window off: the background alone
    full = np.zeros((128, 224, 3), np.uint8)
    for cam, x0 in ((1, 0), (65, 64)):
        rom.poke('dbg_cam', cam); rom.tick(3)
        full[:, x0:x0 + 160] = rom.screen()[:128]
    rom.poke('dbg_cam', 0); rom.pb.memory[LCDC] = lcdc
    cx, cy = (n % COLS) * CW, (n // COLS) * CH
    diff = np.any((full >> 3) != (preview[cy:cy + 128, cx:cx + 224] >> 3), axis=2)
    if diff.any():
        ys, xs = np.nonzero(diff)
        bad.append(f'area {n + 1}: {int(diff.sum())} pixels differ, first at x={xs[0]} y={ys[0]}')
    if rom.area() != n: bad.append(f'expected area {n} on screen, the ROM is in area {rom.area()}')
    rom.tap('start', 2)                                       # debug: next area
rom.stop()
sheet.save(out / 'areas-rom.png')
print(f'{count} areas captured: {out / "areas-rom.png"}')
worst = sorted(budget, reverse=True)[:3]
print('busiest frames: ' + ', '.join(f'area {n + 1} {used}/154 scanlines' for used, n in worst))
if bad:
    print('\n'.join(bad)); sys.exit(1)
print('every area background matches the build preview')
