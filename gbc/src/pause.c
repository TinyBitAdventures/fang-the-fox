// The pause screen (view.js drawPause): MAP, QUEST, FANG and OPTIONS pages over the whole screen in the
// window layer; the options, kept in cartridge RAM (bank 1); and the credits (drawCredits), rolling up
// the background layer. Both borrow the biome's tiles for their text (canvas.c CV_PAUSE), so they open
// and close through a quick fade and put the tiles back afterwards (area_reload_tiles).
#pragma bank 255
#include <gb/gb.h>
#include <gb/cgb.h>
#include <string.h>
#include "game.h"
#include "gen/mapdata.inc"
#include "gen/ui.inc"
#include "gen/credits.inc"

uint8_t opt_music = 1, opt_sfx = 1, opt_vol = 7, opt_shake = 1, anim_hold;

// ---------- settings ----------
#define SET_MAGIC 0x4F53u
typedef struct { uint16_t magic; uint8_t music, sfx, vol, shake, sum; } settings_t;
#define SETTINGS ((settings_t *)0xA000)
static void settings_apply(void) { NR50_REG = (opt_vol << 4) | opt_vol; music_enable(opt_music); }
void settings_load(void) BANKED {   // after music_start
  ENABLE_RAM; SWITCH_RAM(1);
  settings_t *s = SETTINGS;
  if (s->magic == SET_MAGIC && (uint8_t)(0x5A + s->music + s->sfx + s->vol + s->shake) == s->sum && s->vol >= 1 && s->vol <= 7) {
    opt_music = s->music & 1; opt_sfx = s->sfx & 1; opt_vol = s->vol; opt_shake = s->shake & 1;
  }
  DISABLE_RAM;
  settings_apply();
}
static void settings_save(void) {
  ENABLE_RAM; SWITCH_RAM(1);
  settings_t *s = SETTINGS;
  s->music = opt_music; s->sfx = opt_sfx; s->vol = opt_vol; s->shake = opt_shake;
  s->sum = 0x5A + opt_music + opt_sfx + opt_vol + opt_shake; s->magic = SET_MAGIC;
  DISABLE_RAM;
}

// ---------- fading: the screen goes dark while the tiles are swapped ----------
static uint8_t fade_to(uint8_t level) {   // a step of 4 toward level; 1 once there
  if (pal_level == level) return 1;
  if (pal_level < level) pal_level = pal_level + 4 > level ? level : pal_level + 4;
  else pal_level = pal_level < level + 4 ? level : pal_level - 4;
  pal_dirty = 1;
  return pal_level == level;
}
static void borrow_tiles(void) {   // the window's pages or the credits take over the biome's tiles
  hud_hold = 1; anim_hold = 1; cv_mode = CV_PAUSE;
  LCDC_REG &= ~LCDCF_OBJON;
}
static void give_back_tiles(void) {
  area_reload_tiles();
  memcpy(bg_pal + 20, ui_pal, 8 * sizeof(palette_color_t));   // BG palettes 5 and 6
  pal_dirty = 1;
  LCDC_REG |= LCDCF_OBJON | LCDCF_WINON;
  anim_hold = 0; hud_hold = 0; hud_refresh();
  move_win(7, 128);
}

// ---------- the pause screen ----------
enum { T_MAP, T_QUEST, T_FANG, T_OPTIONS };
enum { P_OUT, P_IN, P_OPEN, P_CLOSE, P_BACK };
#define MAP_BASE 110   // the map's icons, in VRAM bank 0 at 0x9000 (past the canvases a page uses)
#define NO_SEL 0xFF
static uint8_t p_stage, tab, sel, confirm, blink, p_song;   // p_song: playing when the pause opened (the sound test puts it back)
static const char * const tab_name[4] = { "MAP", "QUEST", "FANG", "OPTIONS" };
static char line[48];

static void num(uint16_t v) { char t[6]; uint8_t n = 0, k = strlen(line); do { t[n++] = '0' + v % 10; v /= 10; } while (v); while (n) line[k++] = t[--n]; line[k] = 0; }
static void put(const char *s) { strcat(line, s); }

static void draw_tabs(void) {
  uint8_t x = 6, i;
  cv_begin();
  for (i = 0; i < 4; i++) { if (i == tab) cv_draw(x - 5, ">", 3); cv_draw(x, tab_name[i], i == tab ? 3 : 2); x += vwf_width(tab_name[i]) + 14; }
  cv_end(0);
}
static void draw_hint(void) {
  const char *h = tab == T_FANG ? "UP/DOWN: CHOOSE   A: OK   B: CLOSE"
    : tab == T_OPTIONS ? (sel == NO_SEL ? "DOWN: CHOOSE A SETTING   B: CLOSE" : "LEFT/RIGHT: CHANGE   UP/DOWN: CHOOSE")
    : "LEFT/RIGHT: PAGES   B: CLOSE";
  cv_begin(); cv_centre(h, 2); cv_end(1);
}

// the world map: the islands Fang has seen, the ones next to them as "?", the paths between those
// seen, each boss's mark (red until beaten), and where Fang is (blinking)
static uint8_t seen(uint8_t a) { return VISITED(a) || a == area_idx; }
static uint8_t open_edge(uint8_t w) { return w == 0xFF || HAS_FLAG(w); }
static void map_rows(void) {
  static uint8_t row[20], attr[20], near[AREA_COUNT];
  uint8_t y, a, e, k;
  memset(near, 0, sizeof(near));
  for (e = 0; e < MAP_EDGES; e++) if (open_edge(map_edges[e].when)) {
    if (seen(map_edges[e].a)) near[map_edges[e].b] = 1;
    if (seen(map_edges[e].b)) near[map_edges[e].a] = 1;
  }
  for (y = 1; y <= 15; y++) {
    memset(row, 128, 20); memset(attr, 0x07, 20);
    for (e = 0; e < MAP_EDGES; e++) {
      const map_edge_t *m = &map_edges[e];
      if (!open_edge(m->when) || !seen(m->a) || !seen(m->b)) continue;
      for (k = 0; k < m->n; k++) if (map_dot_y[m->first + k] == y) row[map_dot_x[m->first + k]] = MAP_BASE + 6;
    }
    for (a = 0; a < AREA_COUNT; a++) {
      uint8_t x = map_x[a], look = map_look[a] & 0x7F;
      if (map_y[a] == y) {
        if (seen(a)) {
          uint8_t t = MAP_BASE + ((look % 3) << 1), p = look / 3;
          row[x] = t; row[x + 1] = t + 1; attr[x] = attr[x + 1] = p;
        } else if (near[a]) row[x] = MAP_BASE + 7;
      }
      if (map_y[a] == y + 1 && seen(a)) {
        if (map_look[a] & 0x80) { row[x] = MAP_BASE + (HAS_FLAG(map_boss_flag[a]) ? 9 : 8); attr[x] = 6; }
        if (a == area_idx) { row[x + 1] = MAP_BASE + 10; attr[x + 1] = 6; }
      }
    }
    VBK_REG = 1; set_win_tiles(0, y, 20, 1, attr); VBK_REG = 0; set_win_tiles(0, y, 20, 1, row);
  }
  cv_begin(); cv_draw(1, area_title, 3); cv_right(143, map_region[area_idx], 2); cv_end(16);
}
static void map_blink(void) {   // "you are here" blinks (every 16 frames)
  uint8_t t = (blink & 16) ? 128 : MAP_BASE + 10, a = (blink & 16) ? 0x07 : 6;
  VBK_REG = 1; set_win_tiles(map_x[area_idx] + 1, map_y[area_idx] - 1, 1, 1, &a); VBK_REG = 0; set_win_tiles(map_x[area_idx] + 1, map_y[area_idx] - 1, 1, 1, &t);
}

static void quest_page(void) {
  static const char * const ember_word[5] = { "FOREST", "STONE", "FROST", "FLAME", "LIFE" };
  static const char * const kit_word[5] = { "PIP", "BRAMBLE", "TUFT", "HAZEL", "WREN" };
  uint8_t i, x, n;
  cv_line(2, "CURRENT QUEST", 3);
  objective_copy(); cv_wrap(3, 3, msg, 1);
  cv_line(6, "EMBERS", 3);
  cv_begin(); for (i = 0, x = 1; i < 5; i++) { cv_draw(x, ember_word[i], (embers >> i) & 1 ? 1 : 2); x += vwf_width(ember_word[i]) + 8; } cv_end(7);
  cv_line(8, "LOST KITS", 3);
  cv_begin(); for (i = 0, x = 1; i < 5; i++) { const char *w = (kits_rescued >> i) & 1 ? kit_word[i] : "???"; cv_draw(x, w, (kits_rescued >> i) & 1 ? 1 : 2); x += vwf_width(w) + 8; } cv_end(9);
  line[0] = 0; put("RELICS  "); num(relic_n); put(" / "); num(RELIC_COUNT); cv_line(10, line, 3);
  n = !HAS_FLAG(F_HOOT5) ? 5 : !HAS_FLAG(F_HOOT10) ? 10 : !HAS_FLAG(F_HOOT15) ? 15 : !HAS_FLAG(F_CREST) ? RELIC_COUNT : 0;
  line[0] = 0; if (n) { put("HOOT'S NEXT LESSON AT "); num(n); put(" RELICS"); } cv_line(11, line, 2);
  cv_line(12, "TREASURES", 3);
  dlg_text[0] = 0;
  if (HAS_FLAG(F_CRYSTALKEY)) strcat(dlg_text, "CRYSTAL KEY, ");
  if (HAS_FLAG(F_CLOAK)) strcat(dlg_text, "FROST CLOAK, ");
  if (HAS_FLAG(F_SCALE)) strcat(dlg_text, "DRAGON SCALE, ");
  if (HAS_FLAG(F_KITCHARM)) strcat(dlg_text, "GRANDMA'S CHARM, ");
  if (HAS_FLAG(F_CREST)) strcat(dlg_text, "STARLIGHT CREST, ");
  n = strlen(dlg_text); if (n) dlg_text[n - 2] = 0; else strcpy(dlg_text, "None yet.");
  cv_wrap(13, 2, dlg_text, 1);
  cv_line(15, 0, 1); cv_line(16, 0, 1);
}
static void fang_choice(void) {
  cv_begin(); cv_centre(sel == 0 ? "> RESUME <" : "RESUME", sel == 0 ? 3 : 1); cv_end(15);
  cv_begin();
  if (confirm) cv_centre("ERASE THE SAVE? A: YES   B: NO", 3);
  else cv_centre(sel == 1 ? "> RESTART FROM SCRATCH <" : "RESTART FROM SCRATCH", sel == 1 ? 3 : 1);
  cv_end(16);
}
static void fang_page(void) {
  uint8_t i;
  line[0] = 0; put("LEVEL "); num(fox.lvl); put("   ATTACK "); num(fox.atk); put("   HEALTH "); num(fox.hp > 0 ? fox.hp : 0); put("/"); num(fox.max_hp); cv_line(2, line, 1);
  line[0] = 0; put("KILLS "); num(kills); put("   TURNS "); num(turn); put("   GEMS "); num(gems); cv_line(3, line, 1);
  cv_line(4, "PERKS", 3);
  for (i = 0; i < 8; i++) {   // two columns, in the perks' order (up to 16 fit; there are 15)
    uint8_t k, found, c;
    cv_begin();
    for (c = 0; c < 2; c++) {
      found = 0;
      for (k = 0; k < PERK_COUNT; k++) if (HAS_PERK(k) && found++ == (i << 1) + c) { cv_draw(1 + c * 72, ui_perk_name[k], 1); break; }
    }
    if (!i && !perks) cv_draw(1, "None yet. Level up to learn perks.", 2);
    cv_end(5 + i);
  }
  cv_line(13, "A: FIRE SPIN      B: EAT A FISH", 2);
  cv_line(14, "SELECT: THE AREA   START: THIS MENU", 2);
  fang_choice();
}
// MUSIC, SOUND EFFECTS, VOLUME and SCREEN SHAKE are kept on the cartridge; the SOUND TEST plays any song
#define OPT_SONG 4
static const char * const opt_name[5] = { "MUSIC", "SOUND EFFECTS", "VOLUME", "SCREEN SHAKE", "SOUND TEST" };
static void option_row(uint8_t i) {
  uint8_t on = sel == i, v = i == 0 ? opt_music : i == 1 ? opt_sfx : i == 3 ? opt_shake : 0;
  cv_begin();
  if (on) cv_draw(1, ">", 3);
  cv_draw(8, opt_name[i], on ? 3 : 1);
  if (i == 2) { uint8_t k; for (k = 0; k < 7; k++) line[k] = k < opt_vol ? '=' : '-'; line[7] = 0; cv_draw(96, line, on ? 3 : 1); }
  else if (i == OPT_SONG) {
    line[0] = 0; num(music_cur + 1); put(" OF "); num(SONG_COUNT); cv_draw(96, line, on ? 3 : 1); cv_end(13);
    song_name(music_cur, line); cv_line(14, line, on ? 1 : 2);
    return;
  }
  else cv_draw(96, v ? "ON" : "OFF", v ? 1 : 2);
  cv_end(3 + (i << 1));
}
static void options_page(void) {
  uint8_t i;
  cv_line(2, 0, 1);
  for (i = 0; i < 4; i++) { option_row(i); cv_line(4 + (i << 1), 0, 1); }
  cv_line(11, "KEPT ON THE CARTRIDGE", 2);
  cv_line(12, 0, 1);
  option_row(OPT_SONG);
  for (i = 15; i <= 16; i++) cv_line(i, 0, 1);
}
static void draw_page(void) {
  uint8_t y;
  draw_tabs(); draw_hint();
  if (tab == T_MAP) { map_rows(); cv_row(16, 16); }
  else {
    static uint8_t blank[20], battr[20];
    memset(blank, 128, 20); memset(battr, 0x07, 20);
    VBK_REG = 1; set_win_tiles(0, 1, 20, 1, battr); VBK_REG = 0; set_win_tiles(0, 1, 20, 1, blank);
    for (y = 2; y <= 16; y++) cv_row(y, y);
    if (tab == T_QUEST) quest_page(); else if (tab == T_FANG) fang_page(); else options_page();
  }
}
static void build(void) {
  borrow_tiles();
  VBK_REG = 0; set_data((uint8_t *)(0x9000 + (MAP_BASE << 4)), map_tiles, MAP_TILES * 16);
  memcpy(bg_pal, map_pal, 16 * sizeof(palette_color_t));             // BG palettes 0-3: the islands
  memcpy(bg_pal + 24, map_pal + 16, 4 * sizeof(palette_color_t));    // 6: the marks
  cv_row(0, 0); cv_row(17, 1);
  draw_page();
  move_win(7, 0);
}

void pause_open(void) BANKED {
  game_state = S_PAUSE; p_stage = P_OUT; tab = T_MAP; sel = NO_SEL; confirm = 0; blink = 0; p_song = music_cur;
  sfx_play(SFX_SELECT);
}
static void change_option(int8_t d) {
  if (sel == OPT_SONG) {   // straight to the next song (no click over its start); closing the pause puts the area's back
    music_play(d < 0 ? (music_cur ? music_cur - 1 : SONG_COUNT - 1) : (music_cur + 1 < SONG_COUNT ? music_cur + 1 : 0));
    option_row(OPT_SONG);
    return;
  }
  if (sel == 0) opt_music ^= 1;
  else if (sel == 1) opt_sfx ^= 1;
  else if (sel == 2) { int8_t v = opt_vol + d; if (v < 1 || v > 7) return; opt_vol = v; }
  else opt_shake ^= 1;
  settings_apply(); settings_save();
  sfx_play(sel == 1 ? SFX_PICKUP : SFX_SELECT);
  option_row(sel);
}
void pause_frame(uint8_t pressed) BANKED {
  switch (p_stage) {
    case P_OUT: if (fade_to(0)) { build(); p_stage = P_IN; } return;
    case P_IN: if (fade_to(16)) p_stage = P_OPEN; return;
    case P_CLOSE: if (fade_to(0)) { give_back_tiles(); music_play(p_song); p_stage = P_BACK; } return;
    case P_BACK: if (fade_to(16)) game_state = S_PLAY; return;
  }
  blink++;
  if (tab == T_MAP && !(blink & 15)) map_blink();
  if (confirm) {   // RESTART FROM SCRATCH: A erases the save and starts over from the title
    if (pressed & J_A) { save_erase(); reset(); }
    if (pressed & (J_B | J_START)) { confirm = 0; sfx_play(SFX_SELECT); fang_choice(); }
    return;
  }
  if (tab == T_OPTIONS && sel != NO_SEL) {
    uint8_t prev = sel;
    if (pressed & J_UP) { sel = sel ? sel - 1 : NO_SEL; sfx_play(SFX_SELECT); option_row(prev); if (sel != NO_SEL) option_row(sel); else draw_hint(); }
    else if (pressed & J_DOWN) { if (sel < OPT_SONG) { sel++; sfx_play(SFX_SELECT); option_row(prev); option_row(sel); } }
    else if (pressed & J_LEFT) change_option(-1);
    else if (pressed & (J_RIGHT | J_A)) change_option(1);
    else if (pressed & (J_B | J_START)) p_stage = P_CLOSE;
    return;
  }
  if (pressed & (J_LEFT | J_RIGHT)) {
    tab = (pressed & J_LEFT) ? (tab + 3) & 3 : (tab + 1) & 3;
    sel = tab == T_FANG ? 0 : NO_SEL;
    sfx_play(SFX_SELECT); draw_page();
  } else if (tab == T_FANG && (pressed & (J_UP | J_DOWN))) { sel ^= 1; sfx_play(SFX_SELECT); fang_choice(); }
  else if (tab == T_OPTIONS && (pressed & J_DOWN)) { sel = 0; sfx_play(SFX_SELECT); option_row(0); draw_hint(); }
  else if (pressed & J_A) {
    if (tab == T_FANG && sel == 1) { confirm = 1; sfx_play(SFX_LOCKED); fang_choice(); }
    else p_stage = P_CLOSE;
  } else if (pressed & (J_B | J_START)) p_stage = P_CLOSE;
}

// ---------- the credits: a line every 16 px rolling up the background, then Fang's numbers ----------
#define CR_LINES (CREDIT_LINES + 5)   // then a gap, two lines of numbers, a gap and PRESS A
#define CR_STOP ((uint16_t)16 * (CR_LINES - 1) + 144 - 100)   // PRESS A comes to rest at y = 100
static uint16_t cr_y;
static uint8_t cr_next, cr_t, cr_stage;
static void credit_line(uint8_t k, uint8_t lit) {   // line k into canvas k % 16 and its background row
  static uint8_t row[18], attr[18];
  uint8_t slot = k & 15, r = (uint8_t)((144 + 16 * k) >> 3) & 31, i, t = cv_tile(slot), a = 0x07 | (cv_bank(slot) ? 0x08 : 0);
  if (k >= CR_LINES) {   // past the end: the rows an earlier line left (the map wraps every 256 px) go blank
    memset(row, 128, 18); memset(attr, 0x07, 18);
    VBK_REG = 1; set_bkg_tiles(1, r, 18, 1, attr); VBK_REG = 0; set_bkg_tiles(1, r, 18, 1, row);
    return;
  }
  line[0] = 0;
  cv_begin();
  if (k < CREDIT_LINES) cv_centre(credit_text[k], credit_colour[k]);
  else if (k == CREDIT_LINES + 1) { put("LEVEL "); num(fox.lvl); put("   KILLS "); num(kills); put("   TURNS "); num(turn); cv_centre(line, 2); }
  else if (k == CREDIT_LINES + 2) { uint8_t n = 0; for (i = 0; i < 5; i++) n += (kits_rescued >> i) & 1; put("KITS "); num(n); put("/5   RELICS "); num(relic_n); put("/"); num(RELIC_COUNT); cv_centre(line, 2); }
  else if (k == CR_LINES - 1 && lit) cv_centre("PRESS A", 1);
  cv_end(slot);
  for (i = 0; i < 18; i++) { row[i] = t + i; attr[i] = a; }
  VBK_REG = 1; set_bkg_tiles(1, r, 18, 1, attr); VBK_REG = 0; set_bkg_tiles(1, r, 18, 1, row);
}
void credits_start(void) BANKED { game_state = S_CREDITS; cr_stage = P_OUT; music_play(MUSIC_WIN); }
void credits_frame(uint8_t pressed) BANKED {
  uint8_t y;
  switch (cr_stage) {
    case P_OUT:
      if (!fade_to(0)) return;
      borrow_tiles();
      LCDC_REG &= ~LCDCF_WINON;
      { static uint8_t blank[32], battr[32];
        memset(blank, 128, 32); memset(battr, 0x07, 32);   // an empty sky (BG palette 7's dark blue)
        for (y = 0; y < 32; y++) { VBK_REG = 1; set_bkg_tiles(0, y, 32, 1, battr); VBK_REG = 0; set_bkg_tiles(0, y, 32, 1, blank); } }
      cam_x = 0; scroll_y = 0; cr_y = 0; cr_next = 0; cr_t = 0;
      cr_stage = P_IN; return;
    case P_IN: if (fade_to(16)) cr_stage = P_OPEN; return;
    case P_OPEN:   // one pixel every 3 frames (the web's 45 ms); A skips ahead
      if (cr_y < CR_STOP) {
        if (pressed & (J_A | J_START)) cr_y += 48;
        else if (++cr_t >= 3) { cr_t = 0; cr_y++; }
        if (cr_y > CR_STOP) cr_y = CR_STOP;
        while (cr_next < CR_LINES + 4 && 144 + 16 * (uint16_t)cr_next < cr_y + 152) credit_line(cr_next++, 1);
      } else {
        if (!(++cr_t & 31)) credit_line(CR_LINES - 1, cr_t & 32);
        if (pressed & (J_A | J_START)) cr_stage = P_CLOSE;
      }
      scroll_y = (uint8_t)cr_y;
      return;
    case P_CLOSE:   // js finishCredits: Fang wakes at home, the ending seen
      if (!fade_to(0)) return;
      scroll_y = 0;
      give_back_tiles();
      fox.hp = fox.max_hp; SET_FLAG(F_ENDED);
      queue_story(ST_AFTER_CREDITS, 0, 0);
      transition_dark(AR_HOME, 10);
      return;
  }
}
