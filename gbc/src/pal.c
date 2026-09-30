// Palettes on their way to the screen: the area's colours (bg_pal, obj_pal) faded by pal_level.
#include <gb/gb.h>
#include <gb/cgb.h>
#include "game.h"

palette_color_t bg_pal[32], obj_pal[32];
uint8_t pal_level, pal_dirty;

// Fading: pal_prepare() scales the shadow palettes by pal_level / 16 into a buffer (a table lookup per
// channel; the CPU has no multiply), and pal_upload() copies that buffer to palette RAM straight after
// VBlank starts, while the palettes can be written without waiting.
static uint8_t scale[17 * 32], out[128], ready;
void pal_prepare(void) {
  static uint8_t init;
  uint8_t i;
  if (!init) { uint8_t *p = scale; for (uint8_t l = 0; l <= 16; l++) for (i = 0; i < 32; i++) *p++ = (i * l) >> 4; init = 1; }
  const uint8_t *t = &scale[(uint16_t)pal_level << 5];
  for (uint8_t pass = 0; pass < 2; pass++) {
    const uint8_t *src = (const uint8_t *)(pass ? obj_pal : bg_pal);
    uint8_t *dst = out + (pass << 6);
    for (i = 0; i < 32; i++) {   // little-endian: lo = gggrrrrr, hi = 0bbbbbgg
      uint8_t lo = *src++, hi = *src++;
      uint8_t r = t[lo & 31], g = t[(uint8_t)(lo >> 5) | (uint8_t)((hi & 3) << 3)], b = t[hi >> 2];
      *dst++ = r | (uint8_t)(g << 5);
      *dst++ = (uint8_t)(g >> 3) | (uint8_t)(b << 2);
    }
  }
  pal_dirty = 0;
  ready = 1;
}
void pal_upload(void) {
  if (!ready) return;
  uint8_t i;
  BCPS_REG = 0x80; for (i = 0; i < 64; i++) BCPD_REG = out[i];
  OCPS_REG = 0x80; for (i = 64; i < 128; i++) OCPD_REG = out[i];
  ready = 0;
}
