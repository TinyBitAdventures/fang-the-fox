#!/usr/bin/env python3
# Smoke test: Fang walks, trees and the island's edge stop him, the camera follows, a door takes him
# to the right area and cell, the music plays, SELECT shows the overview; the world on screen changes
# with the rules (braziers and their gate, a block on a plate, a Treant hiding as a tree); talking, a sign,
# Rudy's shop, a perk pick, and a save that CONTINUE brings back; the pause screen and its options, the
# death box, and the credits.
# usage: gbc/.venv/bin/python gbc/tools/bot/smoke.py
import re, sys
import numpy as np
from rom import Rom, GBC, S_PLAY, S_DEAD, S_TALK, S_PERK, S_SHOP, S_TITLE, S_PAUSE, S_CREDITS

WORLD = (GBC / 'src/gen/world.h').read_text()
LK = {m.group(1): int(m.group(2)) for m in re.finditer(r'#define LK_(\w+) (\d+)', WORLD)}
SP = {m.group(1): int(m.group(2)) for m in re.finditer(r'#define SP_(\w+) (\d+)', WORLD)}
AR = {m.group(1): int(m.group(2)) for m in re.finditer(r'#define AR_(\w+) (\d+)', WORLD)}
SONG_COUNT = int(re.search(r'#define SONG_COUNT (\d+)', WORLD).group(1))

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
seen = rom.settle_ui()   # a perk pick for the level he gained, then the story queue's scene
check(SP['NARRATOR'] in seen, f'a moment later the narrator tells what happened (speakers {seen})')
rom.poke('dbg_goto', 5); rom.tick(60)
rom.poke('fox', 12, 8); rom.poke('fox', 5, 9); rom.tick(4)
rom.tap('down', 60)
check(rom.area() == 5, "the Lake Tower's goo door now leads to the Dark Woods")

# the changing world: a cell's look follows the rules, and its background is redrawn
def bg(cell):   # the cell's 4 tile numbers in the background map
    x, y = cell % 14 * 2, cell // 14 * 2
    return [rom.pb.memory[0x9800 + (y + r) * 32 + x + c] for r in (0, 1) for c in (0, 1)]
def spin_at(x, y):
    rom.poke('b_spin_cd', 0); rom.poke('fox', x, 8); rom.poke('fox', y, 9); rom.tick(2); rom.tap('a', 20)
rom.poke('dbg_goto', 8); rom.tick(60)   # Hollow Path: three braziers and a gate
rom.poke('en_n', 0); rom.poke('perks', 1 << 3)   # Fire Spin, and no foes in the way
gate = bg(51)
spin_at(2, 2); spin_at(6, 3)
check(rom.u8('tiles', 51) == ord('#') and all(rom.u8('lit_t', k) for k in range(2)), 'Fire Spin lights two braziers; the gate stays shut')
spin_at(2, 6); rom.tick(10)
check(rom.u8('tiles', 51) == ord('_') and rom.u8('look_now', 51) == LK['FLOOR'] and bg(51) != gate, 'the third brazier opens the gate, and its cells are redrawn as floor')
rom.poke('dbg_goto', 10); rom.tick(60)   # Crystal Depths: blocks and pressure plates
rom.poke('en_n', 0); rom.poke('fox', 2, 8); rom.poke('fox', 2, 9); rom.tick(2)
plate = bg(35)
for _ in range(4): rom.tap('right', 14)
rom.tick(10)
check(rom.u8('blk_x') == 7 and rom.u8('look_now', 35) == LK['PLATE_ON'] and bg(35) != plate, 'a block pushed onto a pressure plate presses it down on screen')
rom.poke('dbg_goto', 19); rom.tick(60)   # Whispering Woods: a Treant at (4,2)
check(rom.u8('look_now', 32) == LK['CAMO'], 'a Treant that has not woken is drawn as a tree')
rom.poke('fox', 3, 8); rom.poke('fox', 2, 9); rom.poke('fox', 99, 10); rom.tick(2)
rom.tap('right', 20); rom.tick(10)
check(rom.u8('look_now', 32) == LK['FLOOR'], 'bumping it wakes it: the tree is gone from the background')

# talking: Grandma, a sign, Rudy's shop; a perk pick; saving and CONTINUE
def text(): return bytes(rom.u8('dlg_text', i) for i in range(40)).split(b'\0')[0].decode('latin1')
rom.poke('dbg_goto', AR['HOME'] + 1); rom.tick(60)
rom.poke('en_n', 0); rom.poke('fox', 8, 8); rom.poke('fox', 0, 9); rom.tick(2)
fish = rom.u8('fish')
rom.tap('right', 20)
check(rom.state() == S_TALK and rom.u8('dlg_who') == SP['GRANDMA'] and text().startswith('Fang! Oh good'), 'bumping into Grandma opens her dialogue')
rom.skip_talk()
check(rom.state() == S_PLAY and rom.u8('fish') == fish + 5 and rom.u8('flags') & 1, 'when she has said it all she gives Fang 5 fish')
rom.poke('fox', 3, 8); rom.poke('fox', 1, 9); rom.tick(2); rom.tap('left', 20)
check(rom.state() == S_TALK and rom.u8('dlg_who') == SP['SIGN'] and text().startswith("Fang's cottage"), 'bumping a sign reads it')
rom.skip_talk()
rom.poke('dbg_goto', AR['ELEMENTAL_PORTAL'] + 1); rom.tick(60)
rom.poke('gems', 10); rom.poke('fox', 3, 8); rom.poke('fox', 5, 9); rom.tick(2)
fish = rom.u8('fish')
rom.tap('right', 20); rom.skip_talk()
check(rom.state() == S_SHOP, "after Rudy's greeting his shop opens")
rom.tap('a', 10)
check(rom.u8('gems') == 9 and rom.u8('fish') == fish + 5, 'A buys the first ware: 5 fish for a gem')
rom.tap('b', 10)
check(rom.state() == S_PLAY, 'B leaves the shop')
rom.poke('pending_perks', 1); rom.tick(10)
check(rom.state() == S_PERK and rom.u8('perk_choice_n') == 3, 'a perk earned outside a turn is offered once Fang stands still: three perks')
rom.tap('down', 6); pick = rom.u8('perk_choice', 1); rom.tap('a', 10)
perks = rom.u8('perks') | rom.u8('perks', 1) << 8
check(rom.state() == S_PLAY and perks & (1 << pick) and not rom.u8('pending_perks'), 'down and A learn the second one')
rom.poke('dbg_goto', AR['LAKE_TOWER'] + 1); rom.tick(60)   # entering an area saves
saved = (rom.area(), rom.fox(), rom.u8('fish'), rom.u8('gems'), perks)
ram = rom.stop(keep=True)
rom = Rom(start=False, ram=ram)
check(rom.state() == S_TITLE, 'after switching off, the title offers CONTINUE')
rom.tap('a', 60)
now = (rom.area(), rom.fox(), rom.u8('fish'), rom.u8('gems'), rom.u8('perks') | rom.u8('perks', 1) << 8)
check(rom.state() == S_PLAY and now == saved, f'CONTINUE puts Fang back where he was, with his fish, gems and perks {now}')

# the pause screen, the death box, the credits
rom.tap('start', 30)
check(rom.state() == S_PAUSE and rom.pb.memory[0xFF4A] == 0, 'START opens the pause screen over the whole screen')
for _ in range(3): rom.tap('right', 24)   # MAP, QUEST, FANG, OPTIONS (a page takes up to 19 frames to draw)
rom.tap('down', 8); rom.tap('right', 8)   # MUSIC: off
check(not rom.u8('opt_music'), 'on OPTIONS, the first setting switches the music off')
rom.tap('a', 8)
song = rom.u8('music_cur')
for _ in range(4): rom.tap('down', 8)
rom.tap('right', 8); now = rom.u8('music_cur'); rom.tap('left', 8); rom.tap('left', 8)
check(now == (song + 1) % SONG_COUNT and rom.u8('music_cur') == (song + SONG_COUNT - 1) % SONG_COUNT, 'the SOUND TEST plays the next song, and the one before')
rom.tap('b', 40)
check(rom.state() == S_PLAY and rom.u8('opt_music') and rom.pb.memory[0xFF4A] == 128, 'A switches it back; B closes the pause screen and the HUD returns')
check(rom.u8('music_cur') == song, "the area's song plays again")
rom.poke('en_n', 0); rom.poke('fox', 1, 8); rom.poke('fox', 1, 9); rom.poke('fox', 1, 0); rom.poke('fox', 0, 1); rom.poke('b_poison', 2)   # at (1,1) with 1 hp
rom.tap('left', 40)
check(rom.state() == S_DEAD and rom.pb.memory[0xFF4A] == 96 and bytes(rom.u8('death_by', i) for i in range(6)) == b'Poison', 'poison fells Fang: the death box names it')
rom.tap('a', 60)
check(rom.state() == S_PLAY and rom.hp() == rom.stat(2), 'A gets him back up with full health')
rom.poke('story_fn', 3); rom.poke('story_t', 0); rom.poke('story_t', 0, 1); rom.poke('story_n', 1); rom.tick(20)   # the ending, as after the Primordial
rom.skip_talk(); rom.tick(20)
check(rom.state() == S_CREDITS, 'after the ending the credits roll')
for _ in range(30):
    if rom.state() != S_CREDITS: break
    rom.tap('a', 20)
rom.tick(60)
check(rom.state() == S_PLAY and rom.area() == AR['HOME'] and rom.u8('flags', 2) & 1, 'A runs them through and back to Forest Home, the ending seen')
rom.stop()
if fails: sys.exit(1)
