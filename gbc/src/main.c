// Fang the Fox, Game Boy Color edition.
// Phase 1: Fang walks the 24 areas, bumps into things, goes through doors; the HUD and music run.
// Debug keys until the menus exist: SELECT goes to the next area, START to the previous one.
#include <gb/gb.h>
#include <gb/cgb.h>
#include <stdint.h>
#include "game.h"

uint8_t dbg_ly[8];   // scanlines: frame start, after the game's work, after palettes; game.c stamps 3-7 (tests watch the budget)
// the pad is read only here, at every VBlank (a joypad() in the main loop could be cut in half by this
// interrupt), and presses are kept until the game takes them: a tap during a slow frame still counts
static volatile uint8_t joy_edges, joy_last;
static void joy_isr(void) { uint8_t j = joypad(); joy_edges |= j & ~joy_last; joy_last = j; }
void main(void) {
  cpu_fast();
  DISPLAY_OFF;
  LCDC_REG = LCDCF_OFF | LCDCF_WIN9C00 | LCDCF_WINON | LCDCF_BG8800 | LCDCF_BG9800 | LCDCF_OBJ16 | LCDCF_OBJON | LCDCF_BGON;
  hud_init();
  game_start();
  pal_prepare();
  pal_upload();
  music_start();
  CRITICAL { add_VBL(joy_isr); }
  DISPLAY_ON;
  while (1) {
    wait_vbl_done();
    SCX_REG = cam_x; SCY_REG = scroll_y;
    pal_upload();
    cells_frame();   // tile animation: first, so most of it lands in VBlank
    uint8_t j, pressed;
    CRITICAL { j = joy_last; pressed = joy_edges; joy_edges = 0; }
    dbg_ly[0] = LY_REG;
    game_frame(j, pressed);
    dbg_ly[1] = LY_REG;
    if (pal_dirty) pal_prepare();
    dbg_ly[2] = LY_REG;
  }
}
