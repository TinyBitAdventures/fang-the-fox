// The HUD: two rows of the window layer under the playfield. Row 0 shows Fang's stats, row 1 the
// area's name or the latest message; a message too long for one line takes both rows for 5 seconds.
#include <gb/gb.h>
#include <gb/cgb.h>
#include <string.h>
#include "game.h"

// tile numbers in the 0x8800 block (BG/window tiles 128-255, VRAM bank 0)
#define T_BLANK 128
#define T_HEART 129
#define T_SWORD 130
#define T_FISH  131
#define T_GEM   132
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
static uint8_t row[20], attr[20], buf[20 * 16], two_line;
static char line[96], title[NAME_LEN];
static uint16_t msg_t;

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

static char num[12];
static char *utoa16(uint16_t v, char *p) { char t[6]; uint8_t n = 0; do { t[n++] = '0' + v % 10; v /= 10; } while (v); while (n) *p++ = t[--n]; *p = 0; return p; }

void hud_stats(void) {
  uint8_t fill = fox.max_hp ? (uint16_t)fox.hp * 40 / fox.max_hp : 0, i;
  if (fox.hp && !fill) fill = 1;
  memcpy(row, stats_map, 20);
  for (i = 0; i < 5; i++) {
    uint8_t f = fill >= 8 ? 8 : fill;
    row[1 + i] = T_BAR + f;
    fill -= f;
  }
  if (!two_line) set_row(0, row, stats_attr);
  char *p = utoa16(fox.hp, num); *p++ = '/'; utoa16(fox.max_hp, p);
  field(T_HP, 4, num, 1);
  utoa16(fox.atk, num);  field(T_ATK, 1, num, 1);
  num[0] = 'L'; num[1] = 'V'; utoa16(fox.lvl, num + 2); field(T_LV, 2, num, 3);
  utoa16(fox.fish, num); field(T_FISHN, 2, num, 1);
  utoa16(fox.gems, num); field(T_GEMN, 2, num, 1);
}

void hud_init(void) {
  memcpy(bg_pal + 24, ui_pal, 8 * sizeof(palette_color_t));   // BG palettes 6 and 7
  VBK_REG = VBK_TILES;
  vram_tiles(T_BLANK, ui_tiles, UI_TILES);
  move_win(7, 128);
}

void hud_title(const char *s) {
  strncpy(title, s, NAME_LEN - 1);
  if (!msg_t) text_row(1, T_MSG1, title, 3);
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

void hud_say(const char *s) {
  strncpy(line, s, sizeof(line) - 1);
  line[sizeof(line) - 1] = 0;
  uint8_t n = split(line);
  if (line[n] && line[n] != ' ') line[n] = 0;   // one word wider than the screen: cut it
  if (!line[n]) {
    text_row(1, T_MSG1, line, 1);
    if (two_line) { two_line = 0; hud_stats(); }
  } else {
    const char *rest = line + n + 1;
    line[n] = 0;
    two_line = 1;
    text_row(0, T_MSG2, line, 1);
    text_row(1, T_MSG1, rest, 1);
  }
  msg_t = 300;   // 5 seconds
}

void hud_frame(void) {
  if (msg_t && !--msg_t) {
    text_row(1, T_MSG1, title, 3);
    if (two_line) { two_line = 0; hud_stats(); }
  }
}
