// Text canvases for the window layer's boxes and menus (dialog.c, pause.c): each window row that shows
// text gets 18 tiles of its own, drawn in WRAM with the variable-width font and copied to VRAM. Bank 0,
// so the text can live in whichever bank called.
//   CV_MENU  (dialogue, shop, perks, title): rows 0-6 in VRAM bank 1 at 0x8800, rows 7-8 over the HUD's
//            text tiles in bank 0 (the HUD is covered, and drawn again afterwards)
//   CV_PAUSE (pause screen, credits): rows 0-6 as above, 7-13 in bank 1 at 0x9000, 14-20 in bank 0 at
//            0x9000, where the biome's tiles live (area_reload_tiles puts them back)
#include <gb/gb.h>
#include <string.h>
#include "game.h"

uint8_t cv_buf[CV_W * 16], cv_mode;

uint8_t cv_tile(uint8_t r) {   // the tile number canvas row r starts at, as the window map holds it
  if (r < 7) return 128 + r * CV_W;
  if (cv_mode == CV_MENU) return 142 + (r - 7) * CV_W;
  return r < 14 ? (r - 7) * CV_W : (r - 14) * CV_W;
}
uint8_t cv_bank(uint8_t r) { return r < 7 || (cv_mode == CV_PAUSE && r < 14); }
void cv_upload(uint8_t r, uint8_t t, const uint8_t *src, uint8_t n) {
  uint8_t id = cv_tile(r) + t;
  uint8_t *v = (uint8_t *)(id >= 128 ? 0x8800 + ((uint16_t)(id - 128) << 4) : 0x9000 + ((uint16_t)id << 4));
  VBK_REG = cv_bank(r); set_data(v, src, (uint16_t)n << 4); VBK_REG = 0;
}
void cv_begin(void) { memset(cv_buf, 0, sizeof(cv_buf)); }
void cv_draw(uint8_t x, const char *s, uint8_t colour) { vwf_draw(cv_buf, CV_W, x, s, colour); }
void cv_right(uint8_t x_end, const char *s, uint8_t colour) { vwf_draw(cv_buf, CV_W, x_end - vwf_width(s), s, colour); }
void cv_centre(const char *s, uint8_t colour) { vwf_draw(cv_buf, CV_W, (CV_W * 8 - vwf_width(s)) >> 1, s, colour); }
void cv_end(uint8_t r) { cv_upload(r, 0, cv_buf, CV_W); }
void cv_line(uint8_t r, const char *s, uint8_t colour) { cv_begin(); if (s) cv_draw(1, s, colour); cv_end(r); }
// window row y shows canvas r across columns 1-18 (blank at 0 and 19), in BG palette 7 over sprites
void cv_row(uint8_t y, uint8_t r) {
  static uint8_t row[20], attr[20];
  uint8_t t = cv_tile(r), a = 0x87 | (cv_bank(r) ? 0x08 : 0);
  memset(row, 128, 20); memset(attr, 0x87, 20);
  for (uint8_t i = 1; i < 19; i++) { row[i] = t++; attr[i] = a; }
  VBK_REG = 1; set_win_tiles(0, y, 20, 1, attr); VBK_REG = 0; set_win_tiles(0, y, 20, 1, row);
}
// s word-wrapped to 142 px over canvas rows r0 .. r0 + lines - 1 (rows past the text are cleared);
// returns the rows the text took
uint8_t cv_wrap(uint8_t r0, uint8_t lines, const char *s, uint8_t colour) {
  static char line[48];
  uint8_t p = 0, n, w, cut, a, k, used = 0;
  for (k = 0; k < lines; k++) {
    while (s[p] == ' ') p++;
    if (s[p]) used = k + 1;
    n = 0; w = 0; cut = 0;
    while (s[p + n] && n < sizeof(line) - 1) { a = vwf_adv(s[p + n]); if (w + a > 142) break; if (s[p + n] == ' ') cut = n; w += a; n++; }
    if (s[p + n] && s[p + n] != ' ' && cut) n = cut;
    memcpy(line, s + p, n); line[n] = 0; p += n;
    cv_line(r0 + k, line, colour);
  }
  return used;
}
