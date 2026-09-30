#!/usr/bin/env python3
# Every area as the ROM draws it (PyBoy, headless), on one contact sheet, compared pixel by pixel
# with the build's own preview (build/preview/areas.png): the ROM must show exactly what was generated.
# usage: gbc/.venv/bin/python gbc/tools/bot/shots.py        writes gbc/build/shots/areas-rom.png
import re, sys
from pathlib import Path
import numpy as np
from PIL import Image
from pyboy import PyBoy

GBC = Path(__file__).resolve().parents[2]
count = int(re.search(r'#define AREA_COUNT (\d+)', (GBC / 'src/gen/world.h').read_text()).group(1))
out = GBC / 'build/shots'
out.mkdir(parents=True, exist_ok=True)
preview = np.asarray(Image.open(GBC / 'build/preview/areas.png').convert('RGB'))
COLS, CW, CH = 4, 228, 148      # the preview's layout: 224x144 cells with a 4 px gutter
sheet = Image.new('RGB', preview.shape[1::-1], (16, 16, 24))

pb = PyBoy(str(GBC / 'build/fang.gbc'), window='null', cgb=True, sound_emulated=False)
pb.tick(120, True)
bad = []
for n in range(count):
    pb.tick(10, True)
    left = pb.screen.ndarray[:, :, :3].copy()
    pb.button_press('right'); pb.tick(40, True); pb.button_release('right'); pb.tick(2, True)
    right = pb.screen.ndarray[:, :, :3].copy()
    full = np.zeros((144, 224, 3), np.uint8)
    full[:, :160] = left
    full[:128, 64:] = right[:128]          # the playfield scrolls, the HUD stays put
    cx, cy = (n % COLS) * CW, (n // COLS) * CH
    ref = preview[cy:cy + 144, cx:cx + 224]
    diff = np.any((full >> 3) != (ref >> 3), axis=2)
    diff[128:, 160:] = False
    if diff.any():
        ys, xs = np.nonzero(diff)
        bad.append(f'area {n + 1}: {int(diff.sum())} pixels differ, first at x={xs[0]} y={ys[0]}')
    full[128:, 160:] = (16, 16, 24)
    sheet.paste(Image.fromarray(full), (cx, cy))
    pb.button('select'); pb.tick(20, True)
pb.stop(save=False)
sheet.save(out / 'areas-rom.png')
print(f'{count} areas captured: {out / "areas-rom.png"}')
if bad:
    print('\n'.join(bad)); sys.exit(1)
print('every area matches the build preview')
