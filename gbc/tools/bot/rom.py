# Shared helpers for the PyBoy tests: boot the ROM, read game variables by name (from build/fang.noi),
# press buttons, capture the screen.
import re
from pathlib import Path
from pyboy import PyBoy

GBC = Path(__file__).resolve().parents[2]

def symbols():
    out = {}
    for line in (GBC / 'build/fang.noi').read_text().splitlines():
        m = re.match(r'DEF _(\w+) 0x([0-9A-Fa-f]+)', line)
        if m: out[m.group(1)] = int(m.group(2), 16)
    return out

class Rom:
    def __init__(self, sound=False):
        self.pb = PyBoy(str(GBC / 'build/fang.gbc'), window='null', cgb=True, sound_emulated=sound)
        self.sym = symbols()
        for _ in range(600):                      # past the boot animation, into the game loop
            self.pb.tick(1, False)
            if self.u16('frame_count') > 2: break
        self.tick(4)
    def u8(self, name, off=0): return self.pb.memory[self.sym[name] + off]
    def u16(self, name): return self.u8(name) | self.u8(name, 1) << 8
    def poke(self, name, value, off=0): self.pb.memory[self.sym[name] + off] = value
    def tick(self, n=1, render=True): self.pb.tick(n, render)
    def tap(self, button, after=10):
        self.pb.button_press(button); self.tick(2); self.pb.button_release(button); self.tick(after)
    def hold(self, button, frames):
        self.pb.button_press(button); self.tick(frames); self.pb.button_release(button); self.tick(2)
    def fox(self): return self.u8('fox'), self.u8('fox', 1)
    def area(self): return self.u8('area_idx')
    def screen(self): return self.pb.screen.ndarray[:, :, :3].copy()
    def stop(self): self.pb.stop(save=False)
