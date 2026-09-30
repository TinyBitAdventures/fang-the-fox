// Entering an area: its background, the sprite tiles of everything that can appear in it, palettes,
// and a WRAM copy of its cells, doors and things (so gameplay never has to switch ROM banks). Leaving
// an area writes its state (the web's G.areas[key]) to the cartridge's save RAM, banks 2-3, so coming
// back finds it as it was. Banked: ROM data comes in through the far_* helpers in bank 0.
#pragma bank 255
#include <gb/gb.h>
#include <gb/cgb.h>
#include <string.h>
#include "game.h"

uint8_t area_idx, area_spawn, area_entry, area_flags, area_solved, area_boss_down, area_brazier_time, area_reform, area_crumble_to, area_is_fresh;
uint8_t tiles[CELLS], orig[CELLS];
uint8_t door_n, kind_n;
door_rt_t doors[MAX_DOORS];
kind_rt_t kinds_rt[MAX_KINDS];
uint8_t kind_pal_of[MAX_KINDS][MAX_PIECES];
uint8_t type_ak[TYPE_COUNT], item_ak[ITEM_COUNT + 1];
const metasprite_t *kind_frames[MAX_KINDS][4];
static metasprite_t ms_pool[200];   // every kind's frames: one item per 8x16 piece, plus an end marker per frame
static uint8_t ms_used, cur_biome = 0xFF;
char area_title[NAME_LEN];
static area_kind_t ak[MAX_KINDS];
uint8_t en_n, en_type[MAX_ENEMIES], en_x[MAX_ENEMIES], en_y[MAX_ENEMIES], en_state[MAX_ENEMIES], en_frozen[MAX_ENEMIES],
  en_phase[MAX_ENEMIES], en_revive[MAX_ENEMIES], en_revive_in[MAX_ENEMIES], en_acts[MAX_ENEMIES];
int16_t en_hp[MAX_ENEMIES];
uint16_t en_hit_t[MAX_ENEMIES];
uint8_t item_n, item_code[MAX_ITEMS], item_cell[MAX_ITEMS], item_relic[MAX_ITEMS];
uint8_t temp_n, temp_cell[MAX_TEMP], temp_orig[MAX_TEMP], temp_t[MAX_TEMP];
uint8_t npc_n, npc_id[MAX_NPCS], npc_x[MAX_NPCS], npc_y[MAX_NPCS], npc_ak[MAX_NPCS];
uint8_t blk_n, blk_x[MAX_BLOCKS], blk_y[MAX_BLOCKS], blk_o[MAX_BLOCKS], area_block_ak;
uint8_t brz_n, brz_cell[MAX_BRAZIERS], brz_phase[MAX_BRAZIERS], lit_t[MAX_BRAZIERS], area_flame_ak;

static area_t A;         // the area's ROM record, and a few of its lists, copied out of their bank
static biome_t B;
static kind_t K;
static door_t D[MAX_DOORS];
static thing_t T[MAX_ENEMIES];

// biome tiles go to the 0x9000 block: tiles 0-127 in VRAM bank 0, 128-255 in bank 1 (then 0x8800 in bank 1);
// the animated ones come first, and cells.c steps them through their frames
static void load_biome(uint8_t b) {
  const biome_t *bi;
  uint8_t bank = biome_ref(b, &bi);
  far_copy(&B, bank, bi, sizeof(B));
  uint16_t n = B.tiles_n;
  far_vram((uint8_t *)0x9000, 0, bank, B.tiles, (n > 128 ? 128 : n) << 4);
  if (n > 128) far_vram((uint8_t *)0x9000, 1, bank, B.tiles + 2048, (n > 256 ? 128 : n - 128) << 4);
  if (n > 256) far_vram((uint8_t *)0x8800, 1, bank, B.tiles + 4096, (n - 256) << 4);
  far_copy(bg_pal, bank, B.pal, 20 * sizeof(palette_color_t));
  anim_seg_n = B.seg_n > MAX_SEGS ? MAX_SEGS : B.seg_n;
  far_copy(anim_segs, bank, B.segs, anim_seg_n * sizeof(anim_seg_t));
  anim_bank = bank; anim_data = B.anim;
  cur_biome = b;
}

static void load_kind(uint8_t n) {
  const kind_t *kp;
  kind_rt_t *r = &kinds_rt[n];
  uint8_t bank = kind_ref(ak[n].kind, &kp);
  far_copy(&K, bank, kp, sizeof(K));
  r->cols = K.cols; r->rows = K.rows; r->frames = K.frames; r->flags = K.flags;
  r->prop = ak[n].pal | (ak[n].bank ? 0x08 : 0); r->tile = ak[n].tile; r->pal = ak[n].pal; r->ppf = K.cols * K.rows;
  uint8_t pieces = r->ppf * K.frames;
  far_copy(kind_pal_of[n], bank, K.pal_of, pieces > MAX_PIECES ? MAX_PIECES : pieces);
  far_vram((uint8_t *)(0x8000 + ((uint16_t)r->tile << 4)), ak[n].bank, bank, K.tiles, (uint16_t)K.tiles_n << 4);
  // metasprites: pivot at the bottom-centre of the box; each item's offset is from the item before it
  uint8_t f, row, col, piece = 0;
  for (f = 0; f < r->frames && f < 4; f++) {
    int8_t py = 0, px = 0;
    kind_frames[n][f] = &ms_pool[ms_used];
    for (row = 0; row < r->rows; row++) for (col = 0; col < r->cols; col++, piece++) {
      if (ms_used >= sizeof(ms_pool) / sizeof(ms_pool[0]) - 2) break;
      int8_t y = (int8_t)(row * 16) - (int8_t)(r->rows * 16), x = (int8_t)(col * 8) - (int8_t)(r->cols * 4);
      metasprite_t *m = &ms_pool[ms_used++];
      m->dy = y - py; m->dx = x - px; m->dtile = piece << 1; m->props = piece < MAX_PIECES ? kind_pal_of[n][piece] : 0;
      py = y; px = x;
    }
    ms_pool[ms_used++].dy = metasprite_end;
  }
}

static void load_state(uint8_t a) {
  area_state_t *r;
  ENABLE_RAM; r = AREA_RECORD(a);
  memcpy(tiles, r->tiles, CELLS);
  area_solved = r->solved; area_boss_down = r->boss_down; area_entry = r->entry;
  en_n = r->en_n; item_n = r->item_n; temp_n = r->temp_n;
  memcpy(en_type, r->en_type, MAX_ENEMIES); memcpy(en_x, r->en_x, MAX_ENEMIES); memcpy(en_y, r->en_y, MAX_ENEMIES);
  memcpy(en_state, r->en_state, MAX_ENEMIES); memcpy(en_frozen, r->en_frozen, MAX_ENEMIES); memcpy(en_phase, r->en_phase, MAX_ENEMIES);
  memcpy(en_revive, r->en_revive, MAX_ENEMIES); memcpy(en_revive_in, r->en_revive_in, MAX_ENEMIES); memcpy(en_acts, r->en_acts, MAX_ENEMIES);
  memcpy(en_hp, r->en_hp, sizeof(en_hp)); memcpy(en_hit_t, r->en_hit_t, sizeof(en_hit_t));
  memcpy(item_code, r->item_code, MAX_ITEMS); memcpy(item_cell, r->item_cell, MAX_ITEMS); memcpy(item_relic, r->item_relic, MAX_ITEMS);
  memcpy(temp_cell, r->temp_cell, MAX_TEMP); memcpy(temp_orig, r->temp_orig, MAX_TEMP); memcpy(temp_t, r->temp_t, MAX_TEMP);
  memcpy(blk_x, r->blk_x, MAX_BLOCKS); memcpy(blk_y, r->blk_y, MAX_BLOCKS); memcpy(lit_t, r->lit_t, MAX_BRAZIERS);
  DISABLE_RAM;
}

void area_leave(void) BANKED {
  area_state_t *r;
  uint8_t a = area_idx;
  ENABLE_RAM; r = AREA_RECORD(a);
  memcpy(r->tiles, tiles, CELLS);
  r->solved = area_solved; r->boss_down = area_boss_down; r->entry = area_entry;
  r->en_n = en_n; r->item_n = item_n; r->temp_n = temp_n;
  memcpy(r->en_type, en_type, MAX_ENEMIES); memcpy(r->en_x, en_x, MAX_ENEMIES); memcpy(r->en_y, en_y, MAX_ENEMIES);
  memcpy(r->en_state, en_state, MAX_ENEMIES); memcpy(r->en_frozen, en_frozen, MAX_ENEMIES); memcpy(r->en_phase, en_phase, MAX_ENEMIES);
  memcpy(r->en_revive, en_revive, MAX_ENEMIES); memcpy(r->en_revive_in, en_revive_in, MAX_ENEMIES); memcpy(r->en_acts, en_acts, MAX_ENEMIES);
  memcpy(r->en_hp, en_hp, sizeof(en_hp)); memcpy(r->en_hit_t, en_hit_t, sizeof(en_hit_t));
  memcpy(r->item_code, item_code, MAX_ITEMS); memcpy(r->item_cell, item_cell, MAX_ITEMS); memcpy(r->item_relic, item_relic, MAX_ITEMS);
  memcpy(r->temp_cell, temp_cell, MAX_TEMP); memcpy(r->temp_orig, temp_orig, MAX_TEMP); memcpy(r->temp_t, temp_t, MAX_TEMP);
  memcpy(r->blk_x, blk_x, MAX_BLOCKS); memcpy(r->blk_y, blk_y, MAX_BLOCKS); memcpy(r->lit_t, lit_t, MAX_BRAZIERS);
  DISABLE_RAM;
  visited[a >> 3] |= 1 << (a & 7);
}

void area_reset_world(void) BANKED { memset(visited, 0, sizeof(visited)); }

void area_enter(uint8_t a) BANKED {
  const area_t *ap;
  uint8_t bank = area_ref(a, &ap), i;
  area_idx = a;
  far_copy(&A, bank, ap, sizeof(A));
  area_spawn = A.spawn; area_flags = A.flags; area_brazier_time = A.brazier_time; area_reform = A.reform; area_crumble_to = A.crumble_to;
  far_copy(orig, bank, A.cells, CELLS);
  area_bank = bank; area_recs = A.cell_recs; area_metas = A.metas;
  dyn_n = A.dyn_n; far_copy(dyn_cell, bank, A.dyn, dyn_n);
  cond_n = A.cond_n > 16 ? 16 : A.cond_n; far_copy(cond_cell, bank, A.cond, cond_n);
  blk_n = A.block_n > MAX_BLOCKS ? MAX_BLOCKS : A.block_n; area_block_ak = A.block_ak;
  far_copy(blk_o, bank, A.blocks, blk_n);
  brz_n = 0;
  for (i = 0; i < CELLS; i++) if (orig[i] == '*' && brz_n < MAX_BRAZIERS) { brz_phase[brz_n] = i % 3; brz_cell[brz_n++] = i; }   // braziers never move: the web's S.lit keys, in order
  area_flame_ak = A.flame_ak;
  door_n = A.door_n > MAX_DOORS ? MAX_DOORS : A.door_n;
  far_copy(D, bank, A.doors, door_n * sizeof(door_t));
  for (i = 0; i < door_n; i++) {
    doors[i].cell = D[i].cell; doors[i].to = D[i].to; doors[i].spawn = D[i].spawn; doors[i].req = D[i].req; doors[i].when = D[i].when;
    far_copy(doors[i].name, bank, D[i].name, NAME_LEN - 1); doors[i].name[NAME_LEN - 1] = 0;
  }
  far_copy(T, bank, A.npcs, (A.npc_n > MAX_NPCS ? MAX_NPCS : A.npc_n) * sizeof(thing_t));
  npc_n = 0;
  for (i = 0; i < A.npc_n && i < MAX_NPCS; i++) {
    uint8_t id = T[i].what;
    if (id >= NPC_KIT1 && (kits_rescued & (1 << (id - NPC_KIT1)))) continue;   // rescued kits live at home (phase 4)
    npc_id[npc_n] = id; npc_x[npc_n] = T[i].cell % COLS; npc_y[npc_n] = T[i].cell / COLS; npc_ak[npc_n++] = T[i].extra;
  }
  area_is_fresh = !VISITED(a);
  if (!area_is_fresh) load_state(a);
  else {   // js makeArea: the ROM's lists (entered_area gives the foes their health), relics already found stay found
    memcpy(tiles, orig, CELLS);
    area_solved = area_boss_down = 0; area_entry = A.spawn; temp_n = 0;
    for (i = 0; i < blk_n; i++) { blk_x[i] = blk_o[i] % COLS; blk_y[i] = blk_o[i] / COLS; }
    memset(lit_t, 0, sizeof(lit_t));
    en_n = A.enemy_n > MAX_ENEMIES ? MAX_ENEMIES : A.enemy_n;
    far_copy(T, bank, A.enemies, en_n * sizeof(thing_t));
    for (i = 0; i < en_n; i++) { en_type[i] = T[i].what; en_x[i] = T[i].cell % COLS; en_y[i] = T[i].cell / COLS; }
    uint8_t n = A.item_n > MAX_ITEMS ? MAX_ITEMS : A.item_n;
    far_copy(T, bank, A.items, n * sizeof(thing_t));
    item_n = 0;
    for (i = 0; i < n; i++) {
      uint8_t code = T[i].what, rel = T[i].extra;
      if (code == IT_ARTIFACT && (relics[rel >> 3] & (1 << (rel & 7)))) continue;
      item_code[item_n] = code; item_cell[item_n] = T[i].cell; item_relic[item_n++] = rel;
    }
  }
  kind_n = A.kind_n > MAX_KINDS ? MAX_KINDS : A.kind_n;
  far_copy(ak, bank, A.kinds, kind_n * sizeof(area_kind_t));
  far_copy(type_ak, bank, A.type_ak, TYPE_COUNT);
  far_copy(item_ak + 1, bank, A.item_ak, ITEM_COUNT); item_ak[0] = NONE;
  far_copy(obj_pal, bank, A.obj_pal, sizeof(obj_pal));
  far_copy(area_title, bank, A.title, NAME_LEN - 1); area_title[NAME_LEN - 1] = 0;
  if (A.biome != cur_biome) load_biome(A.biome);   // the cells are drawn once entered_area has set them up (cells_draw_all)
  ms_used = 0;
  for (i = 0; i < kind_n; i++) load_kind(i);
  for (i = 0; i < MAX_ENEMIES; i++) { en_anim[i] = A_NONE; en_flash[i] = 0; }
  for (i = 0; i < MAX_BLOCKS; i++) blk_anim_t[i] = 0xFF;
  pal_dirty = 1;
}
