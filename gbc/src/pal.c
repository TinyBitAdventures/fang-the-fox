// Palettes on their way to the screen: the area's colours (bg_pal, obj_pal) faded by pal_level.
#include <gb/gb.h>
#include <gb/cgb.h>
#include "game.h"

palette_color_t bg_pal[32], obj_pal[32];
uint8_t pal_level, pal_dirty, pal_dim;

// Fading: pal_prepare() scales the shadow palettes by pal_level / 16 into a buffer (a table lookup per
// channel; the CPU has no multiply), and pal_upload() copies that buffer to palette RAM straight after
// VBlank starts, while the palettes can be written without waiting.
BANKREF_EXTERN(fade_lut)
extern const uint8_t fade_lut[17 * 32];   // world_far.c: (i * level) >> 4, in a switchable bank
static uint8_t out[128], ready;
// SDCC keeps this loop's values on the stack (about 200 cycles a colour), so a call does half the
// work: the BG palettes, then on the next frame the sprite palettes, and only then is it uploaded.
// A fade changes the colours every other frame, and no frame spends more than ~28 scanlines here.
uint8_t pal_half;   // 1: the sprite half is still to do (the main loop calls again)
void pal_prepare(void) {
  uint8_t i, n, save = _current_bank, half = pal_half;
  if (!half) pal_dirty = 0;   // a change from here on gets a pass of its own
  SWITCH_ROM(BANK(fade_lut));
  const uint8_t *full = &fade_lut[(uint16_t)pal_level << 5];
  const uint8_t *dim = pal_dim ? &fade_lut[(uint16_t)(pal_level >> 1) << 5] : full;   // pal_dim: all but BG palette 7 at half
  const uint8_t *src = (const uint8_t *)(half ? obj_pal : bg_pal);
  uint8_t *dst = out + (half << 6);
  for (n = 0; n < 8; n++) {   // one table row per palette
    const uint8_t *t = !half && n == 7 ? full : dim;
    for (i = 0; i < 4; i++) {   // little-endian: lo = gggrrrrr, hi = 0bbbbbgg
      uint8_t lo = *src++, hi = *src++;
      uint8_t r = t[lo & 31], g = t[(uint8_t)(lo >> 5) | (uint8_t)((hi & 3) << 3)], b = t[hi >> 2];
      *dst++ = r | (uint8_t)(g << 5);
      *dst++ = (uint8_t)(g >> 3) | (uint8_t)(b << 2);
    }
  }
  SWITCH_ROM(save);
  if (half) ready = 1;
  pal_half = half ^ 1;
}
void pal_upload(void) {
  if (!ready) return;
  uint8_t i;
  BCPS_REG = 0x80; for (i = 0; i < 64; i++) BCPD_REG = out[i];
  OCPS_REG = 0x80; for (i = 64; i < 128; i++) OCPD_REG = out[i];
  ready = 0;
}
