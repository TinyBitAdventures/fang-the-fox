// Randomness: xorshift32. tools/parity.js runs the web game with the same generator in place of
// Math.random, so the same seed and inputs give the same fights in both versions. CHANCE(p) is
// Math.random() < p: the web's r = state / 2^32, compared as integers.
#include <stdint.h>
#include "game.h"

uint32_t rng_state = 0x2545F491;

uint32_t rng_next(void) {
  uint32_t x = rng_state;
  x ^= x << 13;
  x ^= x >> 17;
  x ^= x << 5;
  return rng_state = x;
}

// (Math.random() * n) | 0, exactly: the top of the 48-bit product state * n
uint8_t rng_below(uint8_t n) {
  uint32_t x = rng_next();
  uint32_t hi = (x >> 16) * n, lo = (x & 0xFFFF) * n;
  return (uint8_t)((hi + (lo >> 16)) >> 16);
}
