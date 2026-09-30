// The changing world on screen: each cell's look (the web's drawWorld choices: an open gate, ice, lava,
// a pressed plate, fog, a hidden Treant...), redrawn from the build's metatiles when it changes, and the
// tile animation of water, lava, the void and portals. A cell's picture also carries the top of the tall
// thing in the cell below it, so a change redraws the cell above as well. Flames on lit braziers are
// sprites (game.c); this steps their frames and the flicker of a timed brazier about to go out.
// Banked; the area's metatiles stay in its ROM bank and come in through far_copy.
#pragma bank 255
#include <gb/gb.h>
#include <gb/cgb.h>
#include "game.h"

uint8_t look_now[CELLS];          // the look each cell shows
uint8_t dyn_n, dyn_cell[CELLS];   // cells that can take more than one look
uint8_t cond_n, cond_cell[16];    // the ones whose look changes without their tile changing (plates, vents, doors)
uint8_t chg_n, chg_cell[CHG_MAX];
uint8_t fog_clear;
uint8_t area_bank;
const cell_rec_t *area_recs;
const uint8_t *area_metas;
uint8_t anim_seg_n, anim_bank;
anim_seg_t anim_segs[MAX_SEGS];
const uint8_t *anim_data;
uint8_t flame_f, flick;
static uint8_t anim_t[ANIMATORS], anim_f[ANIMATORS], flame_t, flick_t, vent_puff, camo_n, camo_cell[4];

static uint8_t block_on(uint8_t i) { for (uint8_t b = 0; b < blk_n; b++) if (blk_x[b] == cell_col[i] && blk_y[b] == cell_row[i]) return 1; return 0; }
static uint8_t goo_door(uint8_t i) { for (uint8_t k = 0; k < door_n; k++) if (doors[k].cell == i) return doors[k].req == REQ_GOOKING; return 0; }

// view.js drawWorld, cell by cell
static uint8_t cell_look(uint8_t i) {
  uint8_t t;
  for (t = 0; t < camo_n; t++) if (camo_cell[t] == i) return LK_CAMO;
  switch (tiles[i]) {
    case 'i': return LK_ICE;
    case 'l': return LK_LAVA;
    case '~': return LK_VOID;
    case 'w': return LK_WATER;
    case '=': return LK_BRIDGE;
    case 'u': return LK_CRUMBLE;
    case '+': return block_on(i) ? LK_PLATE_ON : LK_PLATE;
    case 'x': return LK_SNOWDRIFT;
    case 'e': return LK_VINES;
    case 'v': return vent_puff ? LK_VENT_PUFF : LK_VENT;
    case 'o': return fog_clear ? LK_FLOOR : LK_FOG;
    case '*': return LK_BRAZIER;
    case '#': return LK_GATE;
    case '%': return LK_LOCKGATE;
    case '?': return LK_SIGN;
    case 'r': return LK_ROCK;
    case 'b': return LK_BRICK;
    case 'n': return LK_SNOWWALL;
    case 'y': return LK_BASALT;
    case 'T': return LK_TREE;
    case 'p': return LK_PORTAL;
    case 'd': return goo_door(i) && !HAS_FLAG(F_GOOKING) ? LK_GATE_GOO : LK_DOOR;
    case 'D': return HAS_PERK(P_PATHFINDER) ? LK_DOOR : LK_DOOR_SECRET;
    default: return LK_FLOOR;
  }
}
static void cell_state(void) {
  vent_puff = turn % 3 == 2; fog_clear = HAS_PERK(P_KEENEYES) || b_true_sight;
  camo_n = 0;   // a Treant that hasn't woken stands in its cell as a tree
  for (uint8_t e = 0; e < en_n && camo_n < 4; e++) {
    uint8_t k = type_ak[en_type[e]];
    if (!(en_state[e] & (EN_REVEALED | EN_DEAD)) && k != NONE && (kinds_rt[k].flags & KF_CAMO)) camo_cell[camo_n++] = (en_y[e] << 4) - (en_y[e] << 1) + en_x[e];
  }
}

// the cell's metatile: its look, paired with the look of the cell below (a look it can't take draws its first)
static cell_rec_t ra, rb;
static uint8_t mt[8];
static void draw_cell(uint8_t i) {
  uint8_t k, a = 0, b = 0;
  uint16_t m;
  far_copy(&ra, area_bank, area_recs + i, sizeof(cell_rec_t));
  for (k = 0; k < ra.n; k++) if (ra.look[k] == look_now[i]) { a = k; break; }
  m = ra.meta;
  if (i < CELLS - COLS) {
    far_copy(&rb, area_bank, area_recs + i + COLS, sizeof(cell_rec_t));
    for (k = 0; k < rb.n; k++) if (rb.look[k] == look_now[i + COLS]) { b = k; break; }
    for (k = 0; k < a; k++) m += rb.n;
    m += b;
  } else m += a;
  far_copy(mt, area_bank, area_metas + (m << 3), 8);
  uint8_t x = cell_col[i] << 1, y = cell_row[i] << 1;   // safe while the screen is on: GBDK waits for the PPU per byte
  set_bkg_tiles(x, y, 2, 2, mt);
  VBK_REG = VBK_ATTRIBUTES; set_bkg_tiles(x, y, 2, 2, mt + 4); VBK_REG = VBK_TILES;
}

// cells waiting to be redrawn: a turn can change several at once (a gate, vents, a crumbling path), and
// each redraw costs a few scanlines, so cells_frame draws two a frame, right after VBlank starts
#define PEND_MAX 24
static uint8_t pend_n, pend_head, pend[PEND_MAX], pend_mark[(CELLS + 7) / 8];
static void redraw(uint8_t i) {
  if (pend_mark[i >> 3] & (1 << (i & 7))) return;
  if (pend_n == PEND_MAX) { draw_cell(i); return; }
  pend_mark[i >> 3] |= 1 << (i & 7);
  uint8_t at = pend_head + pend_n; if (at >= PEND_MAX) at -= PEND_MAX;
  pend[at] = i; pend_n++;
}

static uint8_t prev_fog, prev_camo;
static uint8_t camo_sig(void) { uint8_t s = camo_n; for (uint8_t k = 0; k < camo_n; k++) s += camo_cell[k]; return s; }
void cells_draw_all(void) BANKED {
  uint8_t i;
  pend_n = pend_head = 0; for (i = 0; i < sizeof(pend_mark); i++) pend_mark[i] = 0;
  cell_state(); chg_n = 0; prev_fog = fog_clear; prev_camo = camo_sig();
  for (i = 0; i < CELLS; i++) look_now[i] = cell_look(i);
  for (i = 0; i < CELLS; i++) draw_cell(i);
}
static void check(uint8_t i) {
  uint8_t l = look_of[tiles[i]], was;   // most tiles always look the same: a table, not the rules
  if (l == 0xFF || camo_n) l = cell_look(i);
  was = look_now[i];
  if (l == was) return;
  look_now[i] = l;
  redraw(i);
  if (i >= COLS && (look_tall[l] || look_tall[was])) redraw(i - COLS);   // the old or new look reaches into the cell above
}
// after an action: the cells whose tile changed and the few that change on their own, or every cell
// that can change when fog clears, a Treant wakes, or the rules changed too many tiles to list
void cells_refresh(void) BANKED {
  static uint8_t k, sig;
  cell_state(); sig = camo_sig();
  if (chg_n > CHG_MAX || fog_clear != prev_fog || sig != prev_camo) for (k = 0; k < dyn_n; k++) check(dyn_cell[k]);
  else { for (k = 0; k < chg_n; k++) check(chg_cell[k]); for (k = 0; k < cond_n; k++) check(cond_cell[k]); }
  chg_n = 0; prev_fog = fog_clear; prev_camo = sig;
}

// ---------- animation: each animator steps its tiles' 3 frames; flames step and flicker ----------
static uint8_t *tile_addr(uint16_t id) { return (uint8_t *)(id < 128 ? 0x9000 + (id << 4) : id < 256 ? 0x9000 + ((id - 128) << 4) : 0x8800 + ((id - 256) << 4)); }
static uint8_t still;
void cells_frame(void) BANKED {
  uint8_t a, s, f;
  if (dbg_cam && !still) { still = 1; for (a = 1; a < ANIMATORS; a++) { anim_t[a] = anim_frames[a] - 1; anim_f[a] = 2; } }   // tests: frame 0, held
  else if (still) { if (dbg_cam) return; still = 0; }
  for (a = 1; a < ANIMATORS; a++) {
    if (++anim_t[a] < anim_frames[a]) continue;
    anim_t[a] = 0;
    f = anim_f[a] = anim_f[a] == 2 ? 0 : anim_f[a] + 1;
    for (s = 0; s < anim_seg_n; s++) {
      anim_seg_t *g = &anim_segs[s];
      if (g->anim != a) continue;
      uint16_t n = (uint16_t)g->count << 4;
      const uint8_t *src = anim_data + g->offset;
      if (f) src += n; if (f == 2) src += n;
      far_vram(tile_addr(g->first), g->first >= 128, anim_bank, src, n);
    }
  }
  for (s = 0; s < 2 && pend_n; s++) {
    uint8_t i = pend[pend_head];
    if (++pend_head == PEND_MAX) pend_head = 0;
    pend_n--; pend_mark[i >> 3] &= ~(1 << (i & 7));
    draw_cell(i);
  }
  if (++flame_t >= 7) { flame_t = 0; flame_f = flame_f == 2 ? 0 : flame_f + 1; }   // 120 ms
  if (++flick_t >= 9) { flick_t = 0; flick ^= 1; }                                 // 150 ms
}
