// Fang the Fox, Game Boy Color edition. Phase 0: an area viewer for the generated maps.
// D-pad left/right looks across the area, SELECT or A goes to the next area, B to the previous one.
#include <gb/gb.h>
#include <gb/cgb.h>
#include <stdint.h>
#include "gen/world.h"

static const uint8_t hud_attr[40] = {   // UI palette, drawn over sprites
  0x87, 0x87, 0x87, 0x87, 0x87, 0x87, 0x87, 0x87, 0x87, 0x87, 0x87, 0x87, 0x87, 0x87, 0x87, 0x87, 0x87, 0x87, 0x87, 0x87,
  0x87, 0x87, 0x87, 0x87, 0x87, 0x87, 0x87, 0x87, 0x87, 0x87, 0x87, 0x87, 0x87, 0x87, 0x87, 0x87, 0x87, 0x87, 0x87, 0x87,
};

static uint8_t area, cur_biome = 0xFF, scx;

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
  set_bkg_palette(0, 5, bi->pal);
  SWITCH_ROM(save);
  cur_biome = b;
}

static void load_area(uint8_t a) {
  const area_t *ar;
  uint8_t save = _current_bank, bank = area_ref(a, &ar);
  DISPLAY_OFF;
  SWITCH_ROM(bank);
  uint8_t b = ar->biome;
  SWITCH_ROM(save);
  if (b != cur_biome) load_biome(b);
  SWITCH_ROM(bank);
  VBK_REG = VBK_TILES;      set_bkg_tiles(0, 0, AREA_W, AREA_H, ar->map);
  VBK_REG = VBK_ATTRIBUTES; set_bkg_tiles(0, 0, AREA_W, AREA_H, ar->attr);
  VBK_REG = VBK_TILES;
  set_data((uint8_t *)0x8800, ar->hud_tiles, (uint16_t)ar->hud_n << 4);
  set_win_tiles(0, 0, 20, 2, ar->hud_map);
  VBK_REG = VBK_ATTRIBUTES; set_win_tiles(0, 0, 20, 2, hud_attr);
  VBK_REG = VBK_TILES;
  SWITCH_ROM(save);
  scx = 0; SCX_REG = 0;
  DISPLAY_ON;
}

void main(void) {
  cpu_fast();
  DISPLAY_OFF;
  LCDC_REG = LCDCF_OFF | LCDCF_WIN9C00 | LCDCF_WINON | LCDCF_BG8800 | LCDCF_BG9800 | LCDCF_OBJ16 | LCDCF_OBJOFF | LCDCF_BGON;
  set_bkg_palette(UI_PAL, 1, ui_pal);
  move_win(7, 128);
  load_area(0);
  uint8_t prev = 0;
  while (1) {
    wait_vbl_done();
    SCX_REG = scx;
    uint8_t j = joypad(), press = j & ~prev;
    prev = j;
    if (press & (J_SELECT | J_A)) { area = area + 1 == AREA_COUNT ? 0 : area + 1; load_area(area); }
    else if (press & J_B) { area = area ? area - 1 : AREA_COUNT - 1; load_area(area); }
    if ((j & J_RIGHT) && scx < (AREA_W - 20) * 8) scx += 2;
    if ((j & J_LEFT) && scx) scx -= 2;
  }
}
