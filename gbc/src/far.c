// Reading data that lives in another ROM bank, for code that is itself banked: these stay in bank 0,
// map the data's bank, copy, and put the caller's bank back.
#include <gb/gb.h>
#include <string.h>
#include "game.h"

void far_copy(void *dst, uint8_t bank, const void *src, uint16_t n) {
  uint8_t save = _current_bank;
  SWITCH_ROM(bank); memcpy(dst, src, n); SWITCH_ROM(save);
}
void far_vram(uint8_t *vram, uint8_t vbk, uint8_t bank, const uint8_t *src, uint16_t n) {
  uint8_t save = _current_bank;
  SWITCH_ROM(bank); VBK_REG = vbk; set_data(vram, src, n); VBK_REG = VBK_TILES; SWITCH_ROM(save);
}
