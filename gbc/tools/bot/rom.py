# Shared helpers for the PyBoy tests: boot the ROM, read game variables by name (from build/fang.noi),
# press buttons, capture the screen.
import io, re
from pathlib import Path
from pyboy import PyBoy

GBC = Path(__file__).resolve().parents[2]

def symbols():
    out = {}
    for line in (GBC / 'build/fang.noi').read_text().splitlines():
        m = re.match(r'DEF _(\w+) 0x([0-9A-Fa-f]+)', line)
        if m: out[m.group(1)] = int(m.group(2), 16)
    return out

S_PLAY, S_TRANS, S_DEAD, S_OVERVIEW, S_TALK, S_PERK, S_SHOP, S_TITLE, S_PAUSE, S_CREDITS = range(10)   # game.h

class Rom:
    def __init__(self, sound=False, start=True, ram=None):   # ram: save RAM from an earlier run (stop(keep=True))
        self.pb = PyBoy(str(GBC / 'build/fang.gbc'), window='null', cgb=True, sound_emulated=sound, ram_file=io.BytesIO(ram or bytes(32768)))   # a blank cartridge unless told otherwise
        self.sym = symbols()
        for _ in range(600):                      # past the boot animation, into the game loop
            self.pb.tick(1, False)
            if self.u16('frame_count') > 2: break
        self.tick(4)
        if start:                                 # NEW GAME on the title, then through the intro
            self.tap('a', 4)
            self.skip_talk()
    def state(self): return self.u8('game_state')
    def settle_ui(self, frames=120):              # through whatever opens: dialogue (read), perk pick (the first), shop (leave); the speakers seen
        seen, quiet = [], 0
        for _ in range(frames):
            s = self.state()
            if s == S_TALK: seen.append(self.u8('dlg_who')); self.skip_talk(); quiet = 0
            elif s == S_PERK: self.tap('a', 4); quiet = 0
            elif s == S_SHOP: self.tap('b', 4); quiet = 0
            else:
                quiet = quiet + 1 if s == S_PLAY and not self.u8('story_n') and not self.u8('hud_hold') else 0
                if quiet > 3: break   # a menu can take a few frames to draw: nothing opened for a while
                self.tick(1)
        return seen
    def skip_talk(self, limit=200):               # A until the dialogue box has closed
        for _ in range(limit):
            if self.state() != S_TALK: break
            self.tap('a', 3)
        self.tick(8)
    def u8(self, name, off=0): return self.pb.memory[self.sym[name] + off]
    def u16(self, name): return self.u8(name) | self.u8(name, 1) << 8
    def poke(self, name, value, off=0): self.pb.memory[self.sym[name] + off] = value
    def tick(self, n=1, render=True): self.pb.tick(n, render)
    def tap(self, button, after=10):
        self.pb.button_press(button); self.tick(2); self.pb.button_release(button); self.tick(after)
    def hold(self, button, frames):
        self.pb.button_press(button); self.tick(frames); self.pb.button_release(button); self.tick(2)
    # fox_t (game.h): int16 hp, uint16 max_hp, xp, next; uint8 x, y, atk, lvl; int8 dir
    def fox(self): return self.u8('fox', 8), self.u8('fox', 9)
    def hp(self): v = self.u8('fox') | self.u8('fox', 1) << 8; return v - 65536 if v > 32767 else v
    def stat(self, off): return self.u8('fox', off) | self.u8('fox', off + 1) << 8
    def area(self): return self.u8('area_idx')
    def screen(self): return self.pb.screen.ndarray[:, :, :3].copy()
    def stop(self, keep=False):   # keep: return the save RAM, as if the cartridge was switched off
        if not keep: self.pb.stop(save=False); return None
        buf = io.BytesIO(); self.pb.stop(save=True, ram_file=buf); return buf.getvalue()
