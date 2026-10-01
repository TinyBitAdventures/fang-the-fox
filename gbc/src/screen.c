// The banked half of the view (game.c is the bank-0 half): drawing floating numbers into VRAM, the
// SELECT overview, starting a game and entering an area.
#pragma bank 255
#include <gb/gb.h>
#include <string.h>
#include "game.h"

// ---------- floating numbers: 4 slots, each a 24x16 sprite drawn into VRAM when it appears ----------
static uint8_t fl_buf[3 * 32], fl_line[3 * 16];
static void fl_spread(uint8_t top, uint8_t shadow) {   // one 8-pixel text line (3 tiles) into the 8x16 pieces
  for (uint8_t p = 0; p < 3; p++) for (uint8_t r = 0; r < 8; r++) {
    uint8_t lo = fl_line[(p << 4) + (r << 1)];
    uint8_t *o = &fl_buf[(p << 5) + ((r + top) << 1)];
    if (shadow) { o[0] |= lo; }                      // colour 1: the shadow
    else { o[0] |= lo; o[1] |= lo; }                 // colour 3: the text
  }
}
void float_render(uint8_t s) BANKED {
  const char *text = float_text;
  uint8_t w = vwf_width(text), x0 = w < 22 ? (24 - w) >> 1 : 1;
  memset(fl_buf, 0, sizeof(fl_buf));
  memset(fl_line, 0, sizeof(fl_line)); vwf_draw(fl_line, 3, x0 + 1, text, 1); fl_spread(5, 1);
  memset(fl_line, 0, sizeof(fl_line)); vwf_draw(fl_line, 3, x0, text, 1); fl_spread(4, 0);
  const kind_rt_t *k = &kinds_rt[AK_FLOAT];
  VBK_REG = (k->prop & 0x08) ? 1 : 0;
  set_data((uint8_t *)(0x8000 + ((uint16_t)(k->tile + s * 6) << 4)), fl_buf, sizeof(fl_buf));
  VBK_REG = 0;
}

// ---------- the SELECT overview: the whole 14x8 area at 8 px a cell, in the background map's lower half ----------
#define OV_BASE 193   // overview tiles in the 0x8800 block, after the HUD's
static const uint8_t ov_attr[11] = { 5, 5, 5, 5, 6, 7, 7, 6, 6, 7, 7 };   // palette of each overview tile
void overview_fill(void) BANKED {   // rows 16-31 empty (also what a screen shake uncovers)
  static uint8_t row[32];
  memset(row, OV_BASE, 32);
  for (uint8_t y = 16; y < 32; y++) set_bkg_tiles(0, y, 32, 1, row);
  memset(row, 5, 32);
  VBK_REG = VBK_ATTRIBUTES; for (uint8_t y = 16; y < 32; y++) set_bkg_tiles(0, y, 32, 1, row); VBK_REG = VBK_TILES;
}
static uint8_t fogged(uint8_t x, uint8_t y) {   // js hiddenAt: fog hides what's more than a step from Fang
  return !fog_clear && tiles[y * COLS + x] == 'o' && (x > fox.x ? x - fox.x : fox.x - x) + (y > fox.y ? y - fox.y : fox.y - y) > 1;
}
void overview_draw(void) BANKED {
  static uint8_t row[COLS], attr[COLS];
  uint8_t x, y, i;
  for (y = 0; y < ROWS; y++) {
    for (x = 0; x < COLS; x++) {
      uint8_t ch = tiles[y * COLS + x], t = 1;
      if (ch == '~') t = 0; else if (ch == 'w') t = 3; else if (ch == 'l') t = 4; else if (ch == 'd' || ch == 'D') t = 5;
      else if ((ch_flags[ch] & CF_SOLID) || look_now[y * COLS + x] == LK_CAMO) t = 2;   // a hidden Treant is a tree
      row[x] = t;
    }
    for (i = 0; i < item_n; i++) if (item_code[i] && item_cell[i] / COLS == y && !fogged(item_cell[i] % COLS, y)) row[item_cell[i] % COLS] = 10;
    for (i = 0; i < npc_n; i++) if (npc_y[i] == y) row[npc_x[i]] = 9;
    for (i = 0; i < blk_n; i++) if (blk_y[i] == y && blk_x[i] != NONE) row[blk_x[i]] = 2;
    for (i = 0; i < en_n; i++) if (!(en_state[i] & EN_DEAD) && en_y[i] == y && look_now[y * COLS + en_x[i]] != LK_CAMO && !fogged(en_x[i], y)) row[en_x[i]] = (type_ak[en_type[i]] != NONE && (kinds_rt[type_ak[en_type[i]]].flags & KF_BOSS)) ? 8 : 7;
    if (fox.y == y) row[fox.x] = 6;
    for (x = 0; x < COLS; x++) { attr[x] = ov_attr[row[x]]; row[x] += OV_BASE; }
    set_bkg_tiles(3, 20 + y, COLS, 1, row);
    VBK_REG = VBK_ATTRIBUTES; set_bkg_tiles(3, 20 + y, COLS, 1, attr); VBK_REG = VBK_TILES;
  }
}

void game_start(void) BANKED {
  ui_init();
  memcpy(bg_pal + 20, ui_pal, 4 * sizeof(palette_color_t));   // BG palette 5: the overview
  overview_fill();
  new_game();
  area_enter(0);
  fox.x = area_spawn % COLS; fox.y = area_spawn / COLS;
  entered_area();
  cells_draw_all();
  hud_title(area_title); hud_stats();   // entered_area set the boss line
  cam_x = cam_want(fox.x << 4);
  pal_level = 16; pal_dirty = 1;
  title_open(has_save());
}

void enter(uint8_t a, uint8_t spawn) BANKED {
  uint8_t loading = skip_leave;
  if (loading) skip_leave = 0; else area_leave();
  area_enter(a);
  music_play(area_music);   // js enterArea
  if (spawn == NONE) spawn = area_spawn;
  fox.x = spawn % COLS; fox.y = spawn / COLS;
  fa.type = A_NONE;
  entered_area();
  cells_draw_all();
  hud_title(area_title); hud_stats();
  for (uint8_t s = 0; s < FLOATS; s++) fl_t[s] = 0;
  cam_x = cam_want(fox.x << 4);
  if (!loading) save_game();   // js enterArea: if (!first) save()
}

