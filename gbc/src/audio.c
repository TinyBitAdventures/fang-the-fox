// Music: hUGEDriver plays a song from the VBlank interrupt. The song's data sits in a switchable ROM
// bank, so the interrupt maps that bank in for the driver and puts the interrupted code's bank back.
#include <gb/gb.h>
#include "hUGEDriver.h"
#include "game.h"

static uint8_t song_bank;
uint8_t music_on = 1, music_cur = NONE;

static void mute_all(uint8_t on) {
  for (uint8_t ch = 0; ch < 4; ch++) hUGE_mute_channel(ch, on ? HT_CH_PLAY : HT_CH_MUTE);
}
static void silence(void) { NR12_REG = 0; NR22_REG = 0; NR30_REG = 0; NR42_REG = 0; }

// the options' MUSIC switch: the song keeps its place, its four channels fall silent (sfx.c leaves them muted)
void music_enable(uint8_t on) {
  if (on == music_on) return;
  music_on = on;
  mute_all(on);
  if (!on) silence();
}

static void music_isr(void) {
  if (!song_bank) return;
  uint8_t save = _current_bank;
  SWITCH_ROM(song_bank);
  hUGE_dosound();
  SWITCH_ROM(save);
}

// js Music.play: song s from its start (overrides.js music says which song each web song key plays);
// the song already playing carries on
void music_play(uint8_t s) {
  const void *song;
  uint8_t bank;
  if (s == music_cur) return;
  music_cur = s;
  sfx_stop();   // sound effects give their channels back first
  bank = song_ref(s, &song);
  __critical {
    uint8_t save = _current_bank;
    silence();   // no note of the last song hangs on
    song_bank = bank;
    SWITCH_ROM(bank);
    hUGE_init((const hUGESong_t *)song);
    SWITCH_ROM(save);
  }
  mute_all(music_on);
}

void music_start(void) {
  NR52_REG = 0x80;   // sound on, both speakers, full volume
  NR51_REG = 0xFF;
  NR50_REG = 0x77;
  add_VBL(music_isr);
  music_play(MUSIC_TITLE);
}
