// Variable-width text: the web game's 3-5 px font drawn into a row of 8x8 tiles (2 bits per pixel)
// in WRAM, ready to copy to VRAM. Glyph rows sit on lines 1-5 of the tile.
#include <stdint.h>
#include "game.h"

static const uint8_t *glyph(char c) {
  if (c >= 'a' && c <= 'z') c -= 32;
  if (c < 32 || c > 95) c = '?';
  return &font[(uint8_t)(c - 32) * 6];
}

uint8_t vwf_width(const char *s) {
  uint8_t w = 0;
  while (*s) w += glyph(*s++)[0] + 1;
  return w ? w - 1 : 0;
}

// draws s at pixel x of a buffer `tiles` wide, in colour 1-3; returns the x after the text
uint8_t vwf_draw(uint8_t *buf, uint8_t tiles, uint8_t x, const char *s, uint8_t colour) {
  while (*s) {
    const uint8_t *g = glyph(*s++);
    uint8_t w = g[0], t = x >> 3, sub = x & 7;
    if (t >= tiles) break;
    for (uint8_t r = 0; r < 5; r++) {
      uint8_t bits = g[1 + r];
      if (!bits) continue;
      uint8_t *p = buf + (t << 4) + ((r + 1) << 1), a = bits >> sub;
      if (colour & 1) p[0] |= a;
      if (colour & 2) p[1] |= a;
      if (sub + w > 8 && t + 1 < tiles) {
        uint8_t b = bits << (8 - sub);
        if (colour & 1) p[16] |= b;
        if (colour & 2) p[17] |= b;
      }
    }
    x += w + 1;
  }
  return x;
}
