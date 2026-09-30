// Sound effects: a list of notes per effect (gen/sfx_data.c, from music/sfx.js) played on channel 2
// (tones, with the pitch slid every frame) and channel 4 (noise). The music driver stays off a
// channel while an effect uses it.
#include <gb/gb.h>
#include "hUGEDriver.h"
#include "game.h"

static const sfx_t *cur;
static uint8_t t, active;   // frame within the effect, channels in use (bit 1: ch 2, bit 3: ch 4)

static void release(void) {
  if (active & 2) { NR22_REG = 0; hUGE_mute_channel(HT_CH2, HT_CH_PLAY); }
  if (active & 8) { NR42_REG = 0; hUGE_mute_channel(HT_CH4, HT_CH_PLAY); }
  active = 0; cur = 0;
}

void sfx_play(uint8_t id) {
  if (cur) release();
  cur = &sfx_table[id]; t = 0;
}

void sfx_frame(void) {
  if (!cur) return;
  const sfx_note_t *n = cur->notes;
  for (uint8_t i = 0; i < cur->n; i++, n++) {
    if (t < n->at || t > n->at + n->frames) continue;
    uint8_t k = t - n->at;
    if (n->ch == 2) {
      if (!(active & 2)) { hUGE_mute_channel(HT_CH2, HT_CH_MUTE); active |= 2; }
      if (k == n->frames) { NR22_REG = 0; continue; }   // the note's time is up: silence the channel
      uint16_t p = n->p0;
      if (n->p1 != n->p0) {   // slide the period across the note (lookups only; this runs a few frames)
        int16_t d = (int16_t)n->p1 - (int16_t)n->p0;
        p = n->p0 + (int16_t)((int32_t)d * k / n->frames);
      }
      if (!k) { NR21_REG = n->arg; NR22_REG = n->env; NR23_REG = (uint8_t)p; NR24_REG = 0x80 | (p >> 8); }
      else { NR23_REG = (uint8_t)p; NR24_REG = p >> 8; }
    } else {
      if (!(active & 8)) { hUGE_mute_channel(HT_CH4, HT_CH_MUTE); active |= 8; }
      if (k == n->frames) { NR42_REG = 0; continue; }
      if (!k) { NR42_REG = n->env; NR43_REG = n->arg; NR44_REG = 0x80; }
    }
  }
  if (++t > cur->length) release();
}
