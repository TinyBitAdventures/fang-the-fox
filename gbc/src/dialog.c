// The dialogue box and the menus, in the window layer (view.js drawDialog, drawPerkMenu, drawShop).
// The dialogue box covers the bottom three cell rows (48 px, the HUD included) with a 32x32 portrait,
// the speaker's name and five lines of text that type out at the web game's pace; a line too long for
// the box turns the page. Menus take five cell rows. Sprites under the window are hidden (spr_clip):
// the Color hardware shows sprites through a window's colour 0.
// Text goes into "canvases": 18 tiles per window row, rows 0-6 in VRAM bank 1 at 0x8800, rows 7-8 over
// the HUD's text tiles in bank 0 (the HUD is covered and redrawn afterwards); the portrait follows row 5.
#pragma bank 255
#include <gb/gb.h>
#include <gb/cgb.h>
#include <string.h>
#include "game.h"
#include "version.h"
#include "gen/ui.inc"
#include "gen/shop.inc"

#define CW 18                 // canvas width in tiles
#define PORTRAIT_TILE 236     // VRAM bank 1, after canvas rows 0-5
#define T_BLANK 128
#define T_ARROW 212           // dlg_tiles[8], loaded at 204
#define A_TEXT 0x87           // BG palette 7, over sprites
#define A_BANK1 0x08

char dlg_text[192];
uint8_t dlg_who;
static uint8_t lbuf[CW * 16], tbuf[16], row[20], attr[20], i8, win_y;

// ---------- canvases and window rows ----------
static uint8_t canvas_tile(uint8_t r) { return r < 7 ? 128 + r * CW : 142 + (r - 7) * CW; }
static void upload(uint8_t r, uint8_t t, const uint8_t *src, uint8_t n) {
  uint8_t *v = (uint8_t *)(0x8800 + ((uint16_t)(canvas_tile(r) - 128 + t) << 4));
  VBK_REG = r < 7 ? 1 : 0; set_data(v, src, (uint16_t)n << 4); VBK_REG = 0;
}
static void c_begin(void) { memset(lbuf, 0, sizeof(lbuf)); }
static void c_draw(uint8_t x, const char *s, uint8_t colour) { vwf_draw(lbuf, CW, x, s, colour); }
static void c_right(uint8_t x_end, const char *s, uint8_t colour) { vwf_draw(lbuf, CW, x_end - vwf_width(s), s, colour); }
static void c_centre(const char *s, uint8_t colour) { vwf_draw(lbuf, CW, (CW * 8 - vwf_width(s)) >> 1, s, colour); }
static void c_end(uint8_t r) { upload(r, 0, lbuf, CW); }
static void win_row(uint8_t y) { VBK_REG = 1; set_win_tiles(0, y, 20, 1, attr); VBK_REG = 0; set_win_tiles(0, y, 20, 1, row); }
static void row_clear(void) { memset(row, T_BLANK, 20); memset(attr, A_TEXT, 20); }
static void row_canvas(uint8_t y, uint8_t r) {   // window row y shows canvas r across columns 1-18
  uint8_t t = canvas_tile(r), a = A_TEXT | (r < 7 ? A_BANK1 : 0);
  row_clear();
  for (i8 = 1; i8 < 19; i8++) { row[i8] = t++; attr[i8] = a; }
  win_row(y);
}
static void win_open(uint8_t rows) {   // the window rises once its rows are drawn (win_show)
  win_y = 144 - (rows << 3);
  hud_hold = 1;
}
static void win_show(void) {
  move_win(7, win_y);
  spr_clip = win_y + 8;   // OAM y of a sprite whose top is 8 px above the window: anything lower is covered
}
static void win_close(void) {
  move_win(7, 128);
  spr_clip = 0;
  memcpy(bg_pal + 20, ui_pal, 8 * sizeof(palette_color_t));   // BG palettes 5 and 6: the overview and the HUD's icons
  pal_dirty = 1;
  hud_hold = 0; hud_refresh();
}

// ---------- the dialogue box (story.c supplies the lines: story_line, story_after) ----------
static uint8_t d_line, d_pg, d_next, ln_s[6], ln_e[6], ln_n, d_cur, d_c, d_px, d_up, d_acc, d_done, d_blink;
static uint8_t d_portrait, d_layout, d_loaded, d_tw, d_row0, p_pal[16];
static portrait_t P;

static void dlg_map(void) {   // the window rows for the layout: the name over the portrait and text beside it, or text across
  uint8_t y, t;
  for (y = 0; y < 6; y++) {
    row_clear();
    if (!d_portrait || !y) { t = canvas_tile(y); for (i8 = 1; i8 < 19; i8++) { row[i8] = t++; attr[i8] = A_TEXT | A_BANK1; } }
    else {
      t = canvas_tile(y); for (i8 = 6; i8 < 19; i8++) { row[i8] = t++; attr[i8] = A_TEXT | A_BANK1; }
      if (y <= 4) for (i8 = 0; i8 < 4; i8++) { t = ((y - 1) << 2) + i8; row[1 + i8] = PORTRAIT_TILE + t; attr[1 + i8] = 0x80 | A_BANK1 | (5 + p_pal[t]); }
    }
    win_row(y);
  }
}
static void wrap(void) {   // the page from d_pg: up to 5 lines (6 without a portrait), broken between words
  uint8_t p = d_pg, n = 0, nl = d_portrait ? 5 : 6, W = d_portrait ? 102 : 142, s, w, cut, a;
  while (n < nl) {
    while (dlg_text[p] == ' ') p++;
    if (!dlg_text[p]) break;
    s = p; w = 0; cut = 0;
    while (dlg_text[p]) {
      a = vwf_adv(dlg_text[p]);
      if (w + a - 1 > W) break;
      if (dlg_text[p] == ' ') cut = p;
      w += a; p++;
    }
    if (dlg_text[p] && dlg_text[p] != ' ' && cut > s) p = cut;   // a word that doesn't fit starts the next line
    ln_s[n] = s; ln_e[n] = p; n++;
  }
  while (dlg_text[p] == ' ') p++;
  ln_n = n; d_next = dlg_text[p] ? p : 0;
}
static void line_start(void) {   // the line into lbuf, nothing of it on screen yet
  char keep = dlg_text[ln_e[d_cur]];
  dlg_text[ln_e[d_cur]] = 0;
  c_begin(); c_draw(1, dlg_text + ln_s[d_cur], 1);
  dlg_text[ln_e[d_cur]] = keep;
  d_c = 0; d_px = 1; d_up = 0;
}
static void show_upto(void) {   // the current line's pixels left of d_px on screen; the tile d_px is in, masked
  uint8_t r = d_row0 + d_cur, full = d_px >> 3;
  if (full > d_tw) full = d_tw;
  if (full > d_up) { upload(r, d_up, lbuf + (d_up << 4), full - d_up); d_up = full; }
  if (d_up < d_tw && (d_px & 7)) {
    uint8_t m = 0xFF << (8 - (d_px & 7));
    for (i8 = 0; i8 < 16; i8++) tbuf[i8] = lbuf[(d_up << 4) + i8] & m;
    upload(r, d_up, tbuf, 1);
  }
}
static void line_finish(void) { d_px = d_tw << 3; show_upto(); }
static void dlg_page(void) {
  uint8_t r;
  wrap();
  c_begin();
  for (r = 0; r < (d_portrait ? 5 : 6); r++) upload(d_row0 + r, 0, lbuf, d_tw);
  d_cur = 0; d_done = 0; d_acc = 0; d_blink = 0;
  if (ln_n) line_start(); else d_done = 1;
}
static void dlg_load(void) {   // line d_line: its speaker's portrait and name, then its first page
  uint8_t p = speaker_portrait[dlg_who], layout;
  d_portrait = p != 0xFF;
  if (d_portrait && p != d_loaded) {
    const portrait_t *pp;
    uint8_t bank = portrait_ref(p, &pp);
    far_copy(&P, bank, pp, sizeof(P));
    far_vram((uint8_t *)(0x8800 + ((PORTRAIT_TILE - 128) << 4)), 1, bank, P.tiles, 256);
    far_copy(p_pal, bank, P.pal_of, 16);
    far_copy(bg_pal + 20, bank, P.pal, 8 * sizeof(palette_color_t));   // BG palettes 5 and 6
    pal_dirty = 1; d_loaded = p; d_layout = 0xFF;
  }
  layout = d_portrait ? p : 0xFE;
  if (layout != d_layout) { dlg_map(); d_layout = layout; }
  if (d_portrait) { c_begin(); c_draw(1, speaker_name[dlg_who], 3); c_end(0); }
  d_tw = d_portrait ? 13 : CW; d_row0 = d_portrait ? 1 : 0;
  d_pg = 0; dlg_page();
}
void dlg_open(void) BANKED {   // story.c has set up a dialogue whose line 0 exists
  d_line = 0; d_loaded = 0xFF; d_layout = 0xFF;
  story_line(0);
  win_open(6);
  game_state = S_TALK;
  dlg_load();
  win_show();
}
void dlg_frame(uint8_t pressed) BANKED {
  uint8_t len;
  if (!d_done && (pressed & (J_A | J_B | J_START))) {   // show the whole page at once
    line_finish();
    while (++d_cur < ln_n) { line_start(); line_finish(); }
    d_done = 1; return;
  }
  if (!d_done) {
    d_acc += 3;   // 22 ms a character: 3/4 of one a frame
    while (d_acc >= 4 && !d_done) {
      d_acc -= 4;
      len = ln_e[d_cur] - ln_s[d_cur];
      if (d_c < len) { d_px += vwf_adv(dlg_text[ln_s[d_cur] + d_c]); d_c++; }
      if (d_c >= len) { line_finish(); if (++d_cur >= ln_n) d_done = 1; else line_start(); }
    }
    if (!d_done) show_upto();
    return;
  }
  if (!(d_blink++ & 15)) {   // the "more" arrow blinks
    row[0] = (d_blink & 16) ? T_BLANK : T_ARROW; attr[0] = A_TEXT;
    VBK_REG = 1; set_win_tiles(19, 5, 1, 1, attr); VBK_REG = 0; set_win_tiles(19, 5, 1, 1, row);
  }
  if (!(pressed & (J_A | J_B | J_START))) return;
  row[0] = T_BLANK; set_win_tiles(19, 5, 1, 1, row);
  sfx_play(SFX_SELECT);
  if (d_next) { d_pg = d_next; dlg_page(); return; }
  if (story_line(++d_line)) { dlg_load(); return; }
  win_close();
  game_state = S_PLAY;
  story_after();
}

// ---------- menus: five cell rows, canvas rows 0-8 across columns 1-18 ----------
static uint8_t m_sel, m_n;
static void menu_open(void) {
  win_open(10);
  for (uint8_t y = 0; y < 9; y++) row_canvas(y, y);
  row_clear(); win_row(9);
}
static void wrap_into(uint8_t r0, uint8_t lines, const char *s, uint8_t colour) {   // s word-wrapped over canvas rows r0...
  static char line[48];
  uint8_t p = 0, n, w, cut, a, k;
  for (k = 0; k < lines; k++) {
    while (s[p] == ' ') p++;
    n = 0; w = 0; cut = 0;
    while (s[p + n] && n < sizeof(line) - 1) { a = vwf_adv(s[p + n]); if (w + a > 142) break; if (s[p + n] == ' ') cut = n; w += a; n++; }
    if (s[p + n] && s[p + n] != ' ' && cut) n = cut;
    memcpy(line, s + p, n); line[n] = 0; p += n;
    c_begin(); c_draw(1, line, colour); c_end(r0 + k);
  }
}

// the perk pick: three perks the rules offered (perk_choice), their tree, the chosen one's description
// Moving the cursor redraws only the two rows it moved between and the description: a whole menu takes
// a couple of frames to draw, and a quick tap during them would be missed.
uint8_t perk_choice[3], perk_choice_n;
static void perk_row(uint8_t i) {
  c_begin();
  if (i < perk_choice_n) {
    uint8_t k = perk_choice[i], on = i == m_sel;
    if (on) c_draw(1, ">", 3);
    c_draw(8, ui_perk_name[k], on ? 3 : 1);
    c_right(143, perk_tree[k], 2);
  }
  c_end(1 + i);
}
static void perk_rows(uint8_t prev) {   // prev: the row the cursor left (0xFF: every row)
  for (uint8_t i = 0; i < 3; i++) if (prev == 0xFF || i == prev || i == m_sel) perk_row(i);
  wrap_into(5, 3, perk_desc[perk_choice[m_sel]], 1);
}
void perk_open(void) BANKED {
  m_sel = 0; m_n = perk_choice_n;
  menu_open();
  c_begin(); c_centre("CHOOSE A PERK", 3); c_end(0);
  c_begin(); c_end(4);
  c_begin(); c_centre("A: LEARN", 2); c_end(8);
  perk_rows(0xFF);
  win_show();
  game_state = S_PERK;
}
void perk_frame(uint8_t pressed) BANKED {
  uint8_t prev = m_sel;
  if (pressed & (J_UP | J_LEFT)) { m_sel = m_sel ? m_sel - 1 : m_n - 1; sfx_play(SFX_SELECT); perk_rows(prev); }
  else if (pressed & (J_DOWN | J_RIGHT)) { m_sel = m_sel + 1 == m_n ? 0 : m_sel + 1; sfx_play(SFX_SELECT); perk_rows(prev); }
  else if (pressed & (J_A | J_START)) { win_close(); game_state = S_PLAY; choose_perk(perk_choice[m_sel]); }
}

// Rudy's wares: name and price (or SOLD), the chosen one's description, and what just happened
static char gem_text[12];
static void num(uint8_t v, char *p) { char t[4]; uint8_t n = 0; do { t[n++] = '0' + v % 10; v /= 10; } while (v); while (n) *p++ = t[--n]; *p = 0; }
static uint8_t sold(uint8_t i) { if (!shop[i].once) return 0; return i == SHOP_HEART ? HAS_FLAG(F_BOUGHT_HEART) : HAS_FLAG(F_BOUGHT_CLAWS); }
static void shop_row(uint8_t i) {
  uint8_t on = i == m_sel, s = sold(i), c = s || gems < shop[i].cost ? 2 : on ? 3 : 1;
  c_begin();
  if (on) c_draw(1, ">", 3);
  c_draw(8, shop[i].name, c);
  if (s) c_right(143, "SOLD", 2);
  else { num(shop[i].cost, gem_text); c_right(143, gem_text, 1); }
  c_end(1 + i);
}
static void shop_rows(uint8_t prev) {   // prev: the row the cursor left (0xFF: everything, as after a purchase)
  uint8_t i;
  if (prev == 0xFF) {
    c_begin(); c_draw(1, "RUDY'S WARES", 3);
    num(gems, gem_text); strcat(gem_text, " GEMS");
    c_right(143, gem_text, 1); c_end(0);
  }
  for (i = 0; i < SHOP_COUNT; i++) if (prev == 0xFF || i == prev || i == m_sel) shop_row(i);
  c_begin(); c_draw(1, shop[m_sel].desc, 2); c_end(7);
}
void shop_status(const char *s) BANKED {   // a message while the shop is open (the web's say())
  c_begin(); c_centre(s, 1); c_end(8);
}
void shop_open(void) BANKED {
  m_sel = 0;
  menu_open();
  shop_rows(0xFF);
  c_begin(); c_centre("A: BUY   B: LEAVE", 2); c_end(8);
  win_show();
  game_state = S_SHOP;
}
void shop_frame(uint8_t pressed) BANKED {
  uint8_t prev = m_sel;
  if (pressed & J_UP) { m_sel = m_sel ? m_sel - 1 : SHOP_COUNT - 1; sfx_play(SFX_SELECT); shop_rows(prev); }
  else if (pressed & J_DOWN) { m_sel = m_sel + 1 == SHOP_COUNT ? 0 : m_sel + 1; sfx_play(SFX_SELECT); shop_rows(prev); }
  else if (pressed & (J_A | J_START)) { buy(m_sel); shop_rows(0xFF); }
  else if (pressed & (J_B | J_LEFT)) { win_close(); game_state = S_PLAY; hud_say("Rudy: Come back soon!"); }
}

// the title: the game's name and CONTINUE / NEW GAME over Forest Home
static uint8_t t_save;
static void title_rows(void) {
  c_begin(); c_centre(t_save ? (m_sel ? "  CONTINUE  " : "> CONTINUE <") : "", m_sel ? 2 : 3); c_end(5);
  c_begin(); c_centre(!t_save || m_sel ? "> NEW GAME <" : "  NEW GAME  ", !t_save || m_sel ? 3 : 2); c_end(6);
}
void title_open(uint8_t has_save) BANKED {
  t_save = has_save; m_sel = 0;
  menu_open();
  c_begin(); c_end(0);
  c_begin(); c_centre("FANG THE FOX", 3); c_end(1);
  c_begin(); c_centre("A TINY BIT ADVENTURE", 2); c_end(2);
  c_begin(); c_end(3); c_begin(); c_end(4); c_begin(); c_end(7);
  c_begin(); c_centre("GAME BOY COLOR EDITION " GBC_VERSION, 2); c_end(8);
  title_rows();
  win_show();
  game_state = S_TITLE;
}
uint8_t title_frame(uint8_t pressed) BANKED {   // 0 until chosen, then 1 continue, 2 new game
  if (t_save && (pressed & (J_UP | J_DOWN | J_SELECT))) { m_sel ^= 1; sfx_play(SFX_SELECT); title_rows(); }
  if (!(pressed & (J_A | J_START))) return 0;
  win_close();
  game_state = S_PLAY;
  return t_save && !m_sel ? 1 : 2;
}

void ui_init(void) BANKED { set_data((uint8_t *)(0x8800 + ((204 - 128) << 4)), dlg_tiles, DLG_TILES * 16); }
