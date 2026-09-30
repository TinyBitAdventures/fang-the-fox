#!/usr/bin/env python3
# The whole story on the ROM, played by a bot (a port of tools/playthrough.js): Grandma, the Goo King,
# Hoot, the woods and their puzzles, the Guardian, the Sky Nexus and its three bosses, the Hearth, the
# Void and the Primordial, then the credits. It reads the game from memory (build/fang.noi), routes with
# the web bot's ice-aware breadth-first search, and presses buttons like a player: dialogue read through,
# Pathfinder picked when offered (else the first perk), the shop left alone. 0-3 falls is normal balance.
# usage: gbc/.venv/bin/python gbc/tools/bot/playthrough.py [--god]     (--god: Fang kept topped up)
import json, re, subprocess, sys, time
from collections import deque
from rom import Rom, GBC, S_PLAY, S_TRANS, S_DEAD, S_TALK, S_PERK, S_SHOP, S_CREDITS

GOD = '--god' in sys.argv
data = json.loads(subprocess.run(['node', '-e', r'''
const vm = require('vm'), fs = require('fs'), path = require('path'), R = process.argv[1];
const W = { SPRITES: {}, console }; vm.createContext(W);
for (const f of ['palette', 'font', 'sprites-terrain', 'sprites-props', 'sprites-chars', 'sprites-chars2', 'sprites-world2', 'data']) vm.runInContext(fs.readFileSync(path.join(R, 'js', f + '.js'), 'utf8').replace(/^(const|let) /gm, 'var '), W);
const areas = Object.fromEntries(Object.entries(W.AREAS).map(([k, A]) => [k, { doors: A.doors, slide: !!A.slide }]));
console.log(JSON.stringify({ keys: Object.keys(W.AREAS), areas, items: Object.entries(W.ITEMS).map(([k, v]) => ({ k, ember: !!v.ember })), perks: Object.keys(W.PERKS), terrain: W.TERRAIN }));
''', str(GBC.parent)], capture_output=True, text=True, check=True).stdout)
KEYS, AREAS, ITEMS, PERKS, TERRAIN = data['keys'], data['areas'], data['items'], data['perks'], data['terrain']
WORLD = (GBC / 'src/gen/world.h').read_text()
FLAG = {m.group(1): int(m.group(2)) for m in re.finditer(r'#define F_(\w+) (\d+)', WORLD)}
MT_BOSS = int(re.search(r'#define MT_GOOKING (\d+)', WORLD).group(1))   # bosses are the last monster types
COLS, ROWS = 14, 8
DIRS = {'right': (1, 0), 'left': (-1, 0), 'down': (0, 1), 'up': (0, -1)}

rom = Rom(start=False)
log, steps, deaths, t0 = [], 0, 0, time.time()

# ---------- reading the game ----------
def area(): return KEYS[rom.area()]
def fox(): return rom.fox()
def flag(name): i = FLAG[name]; return rom.u8('flags', i >> 3) >> (i & 7) & 1
def perk(name): i = PERKS.index(name); return (rom.u8('perks') | rom.u8('perks', 1) << 8) >> i & 1
def tile(x, y): return chr(rom.u8('tiles', y * COLS + x)) if 0 <= x < COLS and 0 <= y < ROWS else '#'
def solid(ch): return ch in '#~' or bool(TERRAIN.get(ch, {}).get('solid'))
def enemies(): return [(rom.u8('en_x', i), rom.u8('en_y', i), rom.u8('en_type', i)) for i in range(rom.u8('en_n')) if not rom.u8('en_state', i) & 1]
def npcs(): return {rom.u8('npc_id', i): (rom.u8('npc_x', i), rom.u8('npc_y', i)) for i in range(rom.u8('npc_n'))}
def npc_at(x, y): return any(p == (x, y) for p in npcs().values())
def block_at(x, y): return any(rom.u8('blk_x', i) == x and rom.u8('blk_y', i) == y for i in range(rom.u8('blk_n')))
def items(): return [(rom.u8('item_code', i), rom.u8('item_cell', i)) for i in range(rom.u8('item_n')) if rom.u8('item_code', i)]
def item_at(x, y): return any(c == y * COLS + x for _, c in items())
def flag_for(req): return {'gooking': flag('GOOKING'), 'pathfinder': perk('pathfinder'), 'crystalKey': flag('CRYSTALKEY'), 'frost_cloak': flag('CLOAK'), 'dragon_scale': flag('SCALE')}[req]
def hp(): return rom.hp()
def max_hp(): return rom.stat(2)

# ---------- playing ----------
def press(b):   # held until the game has run two frames with it down, then until a frame without it
    f0 = rom.u16('frame_count'); rom.pb.button_press(b)
    for _ in range(60):
        rom.tick(1, False)
        if (rom.u16('frame_count') - f0) & 0xFFFF >= 2: break
    rom.pb.button_release(b)
    for _ in range(60):
        f0 = rom.u16('frame_count'); rom.tick(1, False)
        if (rom.u16('frame_count') - f0) & 0xFFFF: break
def idle(): return rom.state() == S_PLAY and rom.u8('fa') == 0 and all(rom.u8('en_anim', i) == 0 for i in range(rom.u8('en_n')))
def settle():   # through whatever the last action opened, until play is calm; 'credits' when they roll
    global deaths
    quiet = 0
    for _ in range(20000):
        if GOD: rom.poke('fox', max_hp() & 255, 0); rom.poke('fox', max_hp() >> 8, 1); rom.poke('b_sleep', 0)
        s = rom.state()
        if s == S_TALK: press('a'); quiet = 0; continue
        if s == S_PERK:
            choice = [rom.u8('perk_choice', k) for k in range(rom.u8('perk_choice_n'))]
            i = choice.index(PERKS.index('pathfinder')) if PERKS.index('pathfinder') in choice else 0
            for _ in range(i): press('down')
            press('a'); quiet = 0; continue
        if s == S_SHOP: press('b'); quiet = 0; continue
        if s == S_DEAD:
            deaths += 1; log.append(f'DIED in {area()} to {bytes(rom.u8("death_by", i) for i in range(20)).split(b"\0")[0].decode()} (lvl {rom.u8("fox", 11)}, fish {rom.u8("fish")})')
            rom.tick(45, False); press('a'); quiet = 0; continue
        if s == S_CREDITS: return 'credits'
        quiet = quiet + 1 if idle() and not rom.u8('story_n') and not rom.u8('hud_hold') else 0
        if quiet > 3: return None
        rom.tick(1, False)
    raise RuntimeError('never settled')
import random
random.seed(1)
def step(d):
    global steps
    if not GOD and hp() < max_hp() * 0.45 and rom.u8('fish'): press('b'); steps += 1; settle()
    if not GOD and rom.u8('fish') < 3 and rom.u8('gems') >= 1 and random.random() < 0.05:   # a shopping trip, roughly (as the web bot)
        rom.poke('gems', rom.u8('gems') - 1); rom.poke('fish', rom.u8('fish') + 5)
    press(d); steps += 1
    if steps > 20000: raise RuntimeError('too many steps')
    return settle()

def land(x, y, dx, dy):   # where a move ends (tools/playthrough.js land: ice slides included)
    nx, ny = x + dx, y + dy
    if not (0 <= nx < COLS and 0 <= ny < ROWS): return None
    ch = tile(nx, ny)
    if solid(ch) or npc_at(nx, ny) or block_at(nx, ny): return None
    if ch in 'dD': return (nx, ny, True)
    if ch == 'i' and not flag('CLOAK') and not item_at(nx, ny):
        slide = AREAS[area()]['slide']
        while True:
            mx, my = nx + dx, ny + dy
            if not (0 <= mx < COLS and 0 <= my < ROWS): break
            m = tile(mx, my)
            if m in 'dD':
                if slide: return (mx, my, True)
                break
            if solid(m) or npc_at(mx, my) or block_at(mx, my) or item_at(mx, my): break
            nx, ny = mx, my
            if not slide or m != 'i': break
    return (nx, ny, False)
def route(goal, avoid_lava=True):   # the first direction on a shortest path to a cell where goal(x, y)
    start = fox(); prev = {start: None}; q = deque([start])
    while q:
        c = q.popleft()
        if c != start and goal(*c):
            while prev[c][0] != start: c = prev[c][0]
            return prev[c][1]
        for d, (dx, dy) in DIRS.items():
            L = land(c[0], c[1], dx, dy)
            if not L: continue
            n = (L[0], L[1])
            if L[2] and not goal(*n): continue
            if avoid_lava and tile(*n) == 'l' and not flag('SCALE'): continue
            if n not in prev: prev[n] = (c, d); q.append(n)
    return None
def walk_to(goal, label):
    for _ in range(400):
        if goal(*fox()): return True
        d = route(goal) or route(goal, False)
        if not d: raise RuntimeError(f'no path in {area()} to {label} from {fox()}')
        before = area()
        if step(d) == 'credits': return 'credits'
        if area() != before: return 'moved'
    raise RuntimeError('walk loop ' + label)
def bump(tx, ty, label):   # bump into a cell from beside it
    adj = lambda x, y: abs(x - tx) + abs(y - ty) == 1
    if not adj(*fox()): walk_to(adj, label)
    fx, fy = fox()
    d = next(d for d, (dx, dy) in DIRS.items() if (fx + dx, fy + dy) == (tx, ty))
    return step(d)
def go_area(target):
    for _ in range(30):
        if area() == target: break
        prev, q = {area(): None}, deque([area()])
        while q:
            a = q.popleft()
            for i, d in AREAS[a]['doors'].items():
                if d.get('when') and not flag(re.sub(r'[^A-Za-z0-9]', '_', d['when']).upper()): continue
                if d.get('req') and not flag_for(d['req']): continue
                if d['to'] not in prev: prev[d['to']] = (a, int(i)); q.append(d['to'])
        if target not in prev: raise RuntimeError(f'no route to {target} from {area()}')
        c = target
        while prev[c][0] != area(): c = prev[c][0]
        di = prev[c][1]; dx, dy = di % COLS, di // COLS
        if not route(lambda x, y: (x, y) == (dx, dy)) and not route(lambda x, y: (x, y) == (dx, dy), False): solve_puzzle()
        walk_to(lambda x, y: (x, y) == (dx, dy), 'door to ' + c)
        settle()
    log.append(f'reached {target} (lvl {rom.u8("fox", 11)}, step {steps})')
def solve_puzzle():
    if rom.u8('area_solved'): return
    plates = [i for i in range(COLS * ROWS) if tile(i % COLS, i // COLS) == '+']
    if plates:   # this world's block puzzles: push each block straight right onto its plate
        for b in range(rom.u8('blk_n')):
            for _ in range(60):
                bx, by = rom.u8('blk_x', b), rom.u8('blk_y', b)
                if bx == 255 or tile(bx, by) == '+': break
                walk_to(lambda x, y: (x, y) == (bx - 1, by), 'behind block')
                step('right')
                if rom.u8('blk_x', b) == bx:   # something is in the way: deal with the nearest foe
                    foes = sorted(enemies(), key=lambda e: abs(e[0] - bx) + abs(e[1] - by))
                    if foes: fight(foes[0][0], foes[0][1])
    for _ in range(4):
        if rom.u8('area_solved'): break
        for k in range(rom.u8('brz_n')):
            c = rom.u8('brz_cell', k)
            if not rom.u8('lit_t', k) and not rom.u8('area_solved'): bump(c % COLS, c // COLS, 'brazier')
    log.append(f'puzzle in {area()}: solved={rom.u8("area_solved")}')
    if not rom.u8('area_solved') and any(tile(i % COLS, i // COLS) == '#' for i in range(COLS * ROWS)): raise RuntimeError('puzzle unsolved in ' + area())
def fight(x, y):
    walk_to(lambda a, b: abs(a - x) + abs(b - y) == 1, 'foe')
    fx, fy = fox(); d = next((d for d, (dx, dy) in DIRS.items() if (fx + dx, fy + dy) == (x, y)), None)
    if d: return step(d)
def talk(npc):
    who = npcs().get(npc)
    if who is None: return
    bump(who[0], who[1], 'npc'); settle()
def kill_boss():
    for _ in range(600):
        boss = [e for e in enemies() if e[2] >= MT_BOSS]
        if not boss: break
        if fight(boss[0][0], boss[0][1]) == 'credits': return 'credits'
    r = settle()
    log.append(f'boss down in {area()} (lvl {rom.u8("fox", 11)})')
    return r
def collect(pred, label):
    for _ in range(20):
        it = next((c for code, c in items() if pred(code)), None)
        if it is None: return
        walk_to(lambda x, y: y * COLS + x == it, label); settle()
def code(k): return 1 + [i['k'] for i in ITEMS].index(k)
EMBER = {code(i['k']) for i in ITEMS if i['ember']}
NPC = {n: i for i, n in enumerate(['grandma', 'hoot', 'rudy', 'lumen', 'queen', 'kit1', 'kit2', 'kit3', 'kit4', 'kit5'])}
def rescue(kit):
    if NPC[kit] in npcs(): talk(NPC[kit]); log.append('rescued ' + kit)

error = None
try:
    rom.tap('a', 4); settle()   # NEW GAME, the intro
    talk(NPC['grandma'])
    go_area('fox_hole'); go_area('slime_pond'); rescue('kit1')
    go_area('goo_grotto'); kill_boss(); collect(lambda c: c in EMBER, 'ember')
    go_area('lake_tower'); talk(NPC['hoot'])
    go_area('dark_woods'); go_area('hollow_path'); solve_puzzle(); rescue('kit2')
    go_area('crystal_depths'); solve_puzzle(); rescue('kit3'); collect(lambda c: c == code('9'), 'crystal key')
    go_area('ancient_ruins'); kill_boss(); collect(lambda c: c in EMBER, 'ember')
    go_area('elemental_portal'); talk(NPC['lumen'])
    go_area('ice_caves'); rescue('kit4')
    go_area('frozen_throne'); kill_boss(); collect(lambda c: c in EMBER or c == code('5'), 'ember and cloak')
    go_area('lava_bridges'); solve_puzzle()
    go_area('dragons_forge'); kill_boss(); collect(lambda c: c in EMBER or c == code('6'), 'ember and scale')
    go_area('fairy_glade'); talk(NPC['queen']); rescue('kit5')
    go_area('world_tree'); kill_boss(); collect(lambda c: c in EMBER, 'ember')
    log.append(f'embers before home: {bin(rom.u8("embers")).count("1")}')
    go_area('home'); talk(NPC['grandma']); talk(NPC['grandma'])
    log.append(f'hearth={flag("HEARTH")}')
    go_area('dreamspace'); go_area('the_void'); solve_puzzle()
    go_area('void_heart')
    r = kill_boss()
    for _ in range(40):
        if r == 'credits' or rom.state() == S_CREDITS: break
        r = settle()
    rolled = rom.state() == S_CREDITS
    for _ in range(60):   # A through the credits, back to Forest Home
        if rom.state() != S_CREDITS: break
        press('a'); rom.tick(20, False)
    rom.tick(60, False); settle()
    log.append(f'ENDING: credits rolled={rolled}, ended={flag("ENDED")}, back in {area()}')
    # the pause screen at the end, with the world explored: build/shots/end-map.png, end-quest.png, end-fang.png
    from PIL import Image
    out = GBC / 'build/shots'; out.mkdir(parents=True, exist_ok=True)
    press('start'); rom.tick(30, False)
    for name in ('map', 'quest', 'fang'):
        rom.tick(20); Image.fromarray(rom.screen()).resize((480, 432), Image.NEAREST).save(out / f'end-{name}.png'); press('right')
    press('b'); rom.tick(30, False)
except Exception as e:
    error = f'{type(e).__name__}: {e}'
    log.append('ERROR: ' + error)
print('\n'.join(log))
kits = bin(rom.u8('kits_rescued')).count('1')
print(json.dumps({'steps': steps, 'deaths': deaths, 'lvl': rom.u8('fox', 11), 'atk': rom.u8('fox', 10), 'maxHp': max_hp(), 'turn': rom.u16('turn'),
                  'kits': kits, 'relics': rom.u8('relic_n'), 'ended': flag('ENDED'), 'seconds': round(time.time() - t0)}))
rom.stop()
sys.exit(1 if error or not flag('ENDED') else 0)
