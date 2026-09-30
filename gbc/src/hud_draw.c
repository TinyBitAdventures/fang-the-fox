// The HUD's drawing (banked): two rows of the window layer under the playfield. Row 0 shows Fang's
// stats; row 1 the area's name (or, while a boss is alive, its name and health) or the latest
// message. A message too long for one line takes both rows for 5 seconds (timed in hud.c).
#pragma bank 255
#include <gb/gb.h>
#include <gb/cgb.h>
#include <string.h>
#include "game.h"
#include "hud.h"

// tile numbers in the 0x8800 block (BG/window tiles 128-255, VRAM bank 0)
#define T_BLANK 128
#define T_BAR   133   // + fill 0-8
#define T_HP    142   // 4 tiles
#define T_ATK   146   // 1
#define T_LV    147   // 2
#define T_FISHN 149   // 2
#define T_GEMN  151   // 2
#define T_MSG1  153   // 20: row 1
#define T_MSG2  173   // 20: row 0 while a long message shows
#define A_ICON  0x86  // BG palette 6, drawn over sprites
#define A_TEXT  0x87  // BG palette 7

// heart, bar x5, HP text x4, sword, attack, level x2, fish, fish count x2, gem, gem count x2
// (plain numbers: SDCC warns about sums like T_HP + 1 above 127)
static const uint8_t stats_map[20] = { 129, 133, 133, 133, 133, 133, 142, 143, 144, 145, 130, 146, 147, 148, 131, 149, 150, 132, 151, 152 };
static const uint8_t stats_attr[20] = { A_ICON, A_ICON, A_ICON, A_ICON, A_ICON, A_ICON, A_TEXT, A_TEXT, A_TEXT, A_TEXT,
  A_ICON, A_TEXT, A_TEXT, A_TEXT, A_ICON, A_TEXT, A_TEXT, A_ICON, A_TEXT, A_TEXT };
static uint8_t row[20], attr[20], buf[20 * 16];
static char num[12];

static void vram_tiles(uint8_t first, const uint8_t *src, uint8_t count) { set_data((uint8_t *)(0x8800 + ((uint16_t)(first - 128) << 4)), src, (uint16_t)count << 4); }
static void field(uint8_t first, uint8_t count, const char *s, uint8_t colour) {
  memset(buf, 0, (uint16_t)count << 4);
  vwf_draw(buf, count, 1, s, colour);
  vram_tiles(first, buf, count);
}
static void set_row(uint8_t y, const uint8_t *tiles, const uint8_t *attrs) {
  VBK_REG = VBK_ATTRIBUTES; set_win_tiles(0, y, 20, 1, attrs);
  VBK_REG = VBK_TILES;      set_win_tiles(0, y, 20, 1, tiles);
}
static void text_row(uint8_t y, uint8_t first, const char *s, uint8_t colour) {
  field(first, 20, s, colour);
  for (uint8_t i = 0; i < 20; i++) { row[i] = first + i; attr[i] = A_TEXT; }
  set_row(y, row, attr);
}
static void bar(uint8_t *out, uint8_t tiles, uint8_t fill) {   // fill in pixels across `tiles` bar tiles
  for (uint8_t i = 0; i < tiles; i++) { uint8_t f = fill >= 8 ? 8 : fill; out[i] = T_BAR + f; fill -= f; }
}
static char *utoa16(uint16_t v, char *p) { char t[6]; uint8_t n = 0; do { t[n++] = '0' + v % 10; v /= 10; } while (v); while (n) *p++ = t[--n]; *p = 0; return p; }

// only what changed is drawn again (the rules ask after every turn)
static uint16_t shown_hp = 0xFFFF, shown_max, shown_fish = 0xFFFF, shown_gems = 0xFFFF;
static uint8_t shown_atk = 0xFF, shown_lvl, shown_fill = 0xFF, shown_two;
static void draw_stats(void) {
  uint16_t hp = fox.hp > 0 ? fox.hp : 0;
  uint8_t fill = fox.max_hp ? (uint8_t)((uint32_t)hp * 40 / fox.max_hp) : 0, atk = fox.atk + (b_mushroom ? 5 : 0);
  if (hp && !fill) fill = 1;
  if (fill != shown_fill || shown_two != hud_two_line) {
    memcpy(row, stats_map, 20);
    bar(row + 1, 5, fill);
    if (!hud_two_line) set_row(0, row, stats_attr);
    shown_fill = fill; shown_two = hud_two_line;
  }
  if (hp != shown_hp || fox.max_hp != shown_max) { char *p = utoa16(hp, num); *p++ = '/'; utoa16(fox.max_hp, p); field(T_HP, 4, num, 1); shown_hp = hp; shown_max = fox.max_hp; }
  if (atk != shown_atk) { utoa16(atk, num); field(T_ATK, 1, num, b_mushroom ? 3 : 1); shown_atk = atk; }
  if (fox.lvl != shown_lvl) { num[0] = 'L'; num[1] = 'V'; utoa16(fox.lvl, num + 2); field(T_LV, 2, num, 3); shown_lvl = fox.lvl; }
  if (fish != shown_fish) { utoa16(fish, num); field(T_FISHN, 2, num, 1); shown_fish = fish; }
  if (gems != shown_gems) { utoa16(gems, num); field(T_GEMN, 2, num, 1); shown_gems = gems; }
}

static void draw_default(void) {
  uint8_t i, b = hud_boss_e;
  if (b == NONE || b >= en_n || (en_state[b] & EN_DEAD)) { text_row(1, T_MSG1, hud_title_text, 3); return; }
  field(T_MSG1, 10, hud_boss_name, 3);
  for (i = 0; i < 10; i++) { row[i] = T_MSG1 + i; attr[i] = A_TEXT; attr[i + 10] = A_ICON; }
  uint16_t hp = en_hp[b] > 0 ? en_hp[b] : 0;
  uint8_t fill = hud_boss_max ? (uint8_t)((uint32_t)hp * 80 / hud_boss_max) : 0; if (hp && !fill) fill = 1;
  bar(row + 10, 10, fill);
  set_row(1, row, attr);
}

// where the first line of s must end to stay within 156 px (a space when there is one)
static uint8_t split(const char *s) {
  uint8_t i, cut = 0, w = 0;
  char one[2] = { 0, 0 };
  for (i = 0; s[i]; i++) {
    one[0] = s[i];
    w += vwf_width(one) + 1;
    if (s[i] == ' ') cut = i;
    if (w > 157) return cut ? cut : i;
  }
  return i;
}
static void draw_line(void) {   // the latest message from hud_line_pos: one row, both, or two rows and a next page
  char *t = hud_line + hud_line_pos;
  uint8_t n = split(t), m;
  hud_line_next = 0;
  if (t[n] && t[n] != ' ') { t[n] = 0; }   // one word wider than the screen: cut it
  if (!t[n]) {
    if (hud_two_line) { hud_two_line = 0; draw_stats(); }
    text_row(1, T_MSG1, t, 1);
    return;
  }
  t[n] = 0;
  char *rest = t + n + 1;
  m = split(rest);
  if (rest[m]) { if (rest[m] == ' ') { rest[m] = 0; hud_line_next = (uint8_t)(rest + m + 1 - hud_line); } else rest[m] = 0; }
  hud_two_line = 1;
  text_row(0, T_MSG2, t, 1);
  text_row(1, T_MSG1, rest, 1);
}

void hud_draw(uint8_t what) BANKED {
  if (what == HD_LINE) draw_line();
  else if (what == HD_STATS) draw_stats();
  else draw_default();
}

void hud_init(void) BANKED {
  memcpy(bg_pal + 24, ui_pal + 4, 8 * sizeof(palette_color_t));   // BG palettes 6 and 7
  VBK_REG = VBK_TILES;
  vram_tiles(T_BLANK, ui_tiles, UI_TILES);
  move_win(7, 128);
}
