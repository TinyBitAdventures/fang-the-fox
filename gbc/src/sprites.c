// The sprite manager: things are listed each frame by priority, then spr_flush() writes them to the
// shadow OAM with GBDK's metasprite routines (GBDK copies it to the hardware in VBlank). Priority 0
// (Fang) goes first, then 1 (bosses, anything next to Fang), then 2. The GBC draws only 10 sprites
// on a scanline, the first 10 in OAM order, so when a row would overflow the priority-2 things take
// turns at the front: they flicker, none vanish.
// Kept cheap for the Game Boy's CPU: arrays instead of structs, statics instead of locals.
#include <gb/gb.h>
#include "game.h"

uint8_t spr_kind[MAX_DRAW], spr_frame[MAX_DRAW], spr_flip[MAX_DRAW], spr_x[MAX_DRAW], spr_y[MAX_DRAW];
uint8_t spr_n, spr_row[9], spr_over;
static uint8_t order[3][MAX_DRAW], count[3], rot, oam;

void spr_clear(void) {
  spr_n = 0; spr_over = 0; count[0] = count[1] = count[2] = 0;
  for (uint8_t i = 0; i < 9; i++) spr_row[i] = 0;
}

uint8_t spr_slot(uint8_t prio) {
  if (spr_n == MAX_DRAW) return 0xFF;
  order[prio][count[prio]++] = spr_n;
  return spr_n++;
}

void spr_put(uint8_t kind, uint8_t frame, uint8_t flip, uint8_t prio, int16_t px, uint8_t py) {
  const kind_rt_t *k = &kinds_rt[kind];
  uint8_t half = k->cols << 2;
  if (px + half <= 0 || px - half >= 160) return;   // off-screen sprites would still count toward a row
  uint8_t s = spr_slot(prio);
  if (s == 0xFF) return;
  spr_kind[s] = kind; spr_frame[s] = frame; spr_flip[s] = flip;
  spr_x[s] = (uint8_t)px + 8; spr_y[s] = py + 16;
  uint8_t r = (uint8_t)(py - 1) >> 4;   // the 16 px row the thing stands in, and the one above for tall kinds
  if ((spr_row[r] += k->cols) > 10) spr_over = 1;
  if (k->rows > 1 && r && (spr_row[r - 1] += k->cols) > 10) spr_over = 1;
}

static uint8_t s, k;
static void emit(void) {
  if (oam >= 40) return;
  k = spr_kind[s];
  __current_metasprite = kind_frames[k][spr_frame[s]];
  __current_base_tile = kinds_rt[k].tile;
  __current_base_prop = kinds_rt[k].prop;
  if (spr_flip[s]) oam += __move_metasprite_flipx(oam, ((uint16_t)spr_y[s] << 8) | (uint8_t)(spr_x[s] - 8));
  else oam += __move_metasprite(oam, ((uint16_t)spr_y[s] << 8) | spr_x[s]);
}

void spr_flush(void) {
  static uint8_t i, j, m;
  oam = 0;
  for (i = 0; i < count[0]; i++) { s = order[0][i]; emit(); }
  for (i = 0; i < count[1]; i++) { s = order[1][i]; emit(); }
  m = count[2];
  if (spr_over && m) { if (++rot >= m) rot = 0; } else rot = 0;
  for (i = 0, j = rot; i < m; i++) { s = order[2][j]; emit(); if (++j == m) j = 0; }
  if (oam > 40) oam = 40;
  hide_sprites_range(oam, 40);
}
