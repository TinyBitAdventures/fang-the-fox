// Entering an area: its background, the sprite tiles of everything that can appear in it, palettes,
// and a WRAM copy of its cells, doors and things (so gameplay never has to switch ROM banks).
#include <gb/gb.h>
#include <gb/cgb.h>
#include <string.h>
#include "game.h"

uint8_t area_idx, area_spawn, tiles[CELLS];
uint8_t door_n, ent_n, kind_n;
door_rt_t doors[MAX_DOORS];
uint8_t ent_kind[MAX_ENTS], ent_x[MAX_ENTS], ent_y[MAX_ENTS], ent_bx[MAX_ENTS], ent_by[MAX_ENTS], ent_flags[MAX_ENTS], ent_half[MAX_ENTS];
kind_rt_t kinds_rt[MAX_KINDS];
uint8_t kind_pal_of[MAX_KINDS][MAX_PIECES];
const metasprite_t *kind_frames[MAX_KINDS][4];
static metasprite_t ms_pool[160];   // every kind's frames: one item per 8x16 piece, plus an end marker per frame
static uint8_t ms_used;
char area_title[NAME_LEN];
palette_color_t bg_pal[32], obj_pal[32];
uint8_t pal_level, pal_dirty;
static uint8_t cur_biome = 0xFF;
static area_kind_t ak[MAX_KINDS];

static void copy_name(char *dst, const char *src) { strncpy(dst, src, NAME_LEN - 1); dst[NAME_LEN - 1] = 0; }

// biome tiles go to the 0x9000 block: tiles 0-127 in VRAM bank 0, 128-255 in bank 1
static void load_biome(uint8_t b) {
  const biome_t *bi;
  uint8_t save = _current_bank;
  SWITCH_ROM(biome_ref(b, &bi));
  uint16_t n = bi->tiles_n;
  VBK_REG = VBK_BANK_0;
  set_data((uint8_t *)0x9000, bi->tiles, (n > 128 ? 128 : n) << 4);
  if (n > 128) { VBK_REG = VBK_BANK_1; set_data((uint8_t *)0x9000, bi->tiles + 2048, (n - 128) << 4); }
  VBK_REG = VBK_BANK_0;
  memcpy(bg_pal, bi->pal, 20 * sizeof(palette_color_t));
  SWITCH_ROM(save);
  cur_biome = b;
}

static void load_kind(uint8_t n) {
  const kind_t *k;
  kind_rt_t *r = &kinds_rt[n];
  uint8_t save = _current_bank;
  SWITCH_ROM(kind_ref(ak[n].kind, &k));
  r->cols = k->cols; r->rows = k->rows; r->frames = k->frames; r->flags = k->flags;
  r->prop = ak[n].pal | (ak[n].bank ? 0x08 : 0); r->tile = ak[n].tile; r->pal = ak[n].pal; r->ppf = k->cols * k->rows;
  uint8_t pieces = r->ppf * k->frames;
  memcpy(kind_pal_of[n], k->pal_of, pieces > MAX_PIECES ? MAX_PIECES : pieces);
  VBK_REG = ak[n].bank;
  set_data((uint8_t *)(0x8000 + ((uint16_t)r->tile << 4)), k->tiles, (uint16_t)k->tiles_n << 4);
  VBK_REG = VBK_BANK_0;
  SWITCH_ROM(save);
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

void area_load(uint8_t a) {
  const area_t *ar;
  uint8_t save = _current_bank, bank = area_ref(a, &ar), b, i;
  area_idx = a;
  SWITCH_ROM(bank);
  b = ar->biome;
  area_spawn = ar->spawn;
  memcpy(tiles, ar->cells, CELLS);
  door_n = ar->door_n > MAX_DOORS ? MAX_DOORS : ar->door_n;
  for (i = 0; i < door_n; i++) {
    const door_t *d = &ar->doors[i];
    doors[i].cell = d->cell; doors[i].to = d->to; doors[i].spawn = d->spawn; doors[i].req = d->req; doors[i].when = d->when;
    copy_name(doors[i].name, d->name);
  }
  ent_n = ar->ent_n > MAX_ENTS ? MAX_ENTS : ar->ent_n;
  for (i = 0; i < ent_n; i++) { ent_kind[i] = ar->ents[i].kind; ent_x[i] = ar->ents[i].cell % COLS; ent_y[i] = ar->ents[i].cell / COLS; }
  // (bx, by, flags, half are filled once the kinds are loaded)
  kind_n = ar->kind_n > MAX_KINDS ? MAX_KINDS : ar->kind_n;
  memcpy(ak, ar->kinds, kind_n * sizeof(area_kind_t));
  memcpy(obj_pal, ar->obj_pal, sizeof(obj_pal));
  copy_name(area_title, ar->title);
  VBK_REG = VBK_TILES;      set_bkg_tiles(0, 0, AREA_W, AREA_H, ar->map);
  VBK_REG = VBK_ATTRIBUTES; set_bkg_tiles(0, 0, AREA_W, AREA_H, ar->attr);
  VBK_REG = VBK_TILES;
  SWITCH_ROM(save);
  if (b != cur_biome) load_biome(b);
  ms_used = 0;
  for (i = 0; i < kind_n; i++) load_kind(i);
  for (i = 0; i < ent_n; i++) {
    ent_bx[i] = (ent_x[i] << 4) + 8; ent_by[i] = (ent_y[i] << 4) + 16;
    ent_flags[i] = kinds_rt[ent_kind[i]].flags; ent_half[i] = kinds_rt[ent_kind[i]].cols << 2;
  }
  pal_dirty = 1;
}

// Fading: pal_prepare() scales the shadow palettes by pal_level / 16 into a buffer (a table lookup per
// channel; the CPU has no multiply), and pal_upload() copies that buffer to palette RAM straight after
// VBlank starts, while the palettes can be written without waiting.
static uint8_t scale[17 * 32], out[128], ready;
void pal_prepare(void) {
  static uint8_t init;
  uint8_t i;
  if (!init) { uint8_t *p = scale; for (uint8_t l = 0; l <= 16; l++) for (i = 0; i < 32; i++) *p++ = (i * l) >> 4; init = 1; }
  const uint8_t *t = &scale[(uint16_t)pal_level << 5];
  for (uint8_t pass = 0; pass < 2; pass++) {
    const uint8_t *src = (const uint8_t *)(pass ? obj_pal : bg_pal);
    uint8_t *dst = out + (pass << 6);
    for (i = 0; i < 32; i++) {   // little-endian: lo = gggrrrrr, hi = 0bbbbbgg
      uint8_t lo = *src++, hi = *src++;
      uint8_t r = t[lo & 31], g = t[(uint8_t)(lo >> 5) | (uint8_t)((hi & 3) << 3)], b = t[hi >> 2];
      *dst++ = r | (uint8_t)(g << 5);
      *dst++ = (uint8_t)(g >> 3) | (uint8_t)(b << 2);
    }
  }
  pal_dirty = 0;
  ready = 1;
}
void pal_upload(void) {
  if (!ready) return;
  uint8_t i;
  BCPS_REG = 0x80; for (i = 0; i < 64; i++) BCPD_REG = out[i];
  OCPS_REG = 0x80; for (i = 64; i < 128; i++) OCPD_REG = out[i];
  ready = 0;
}
