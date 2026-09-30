// Music: hUGEDriver plays a song from the VBlank interrupt. The song's data sits in a switchable ROM
// bank, so the interrupt maps that bank in for the driver and puts the interrupted code's bank back.
#include <gb/gb.h>
#include "hUGEDriver.h"
#include "game.h"

BANKREF_EXTERN(song_placeholder)
extern const hUGESong_t song_placeholder;
static uint8_t song_bank;

static void music_isr(void) {
  uint8_t save = _current_bank;
  SWITCH_ROM(song_bank);
  hUGE_dosound();
  SWITCH_ROM(save);
}

void music_start(void) {
  NR52_REG = 0x80;   // sound on, both speakers, full volume
  NR51_REG = 0xFF;
  NR50_REG = 0x77;
  __critical {
    uint8_t save = _current_bank;
    song_bank = BANK(song_placeholder);
    SWITCH_ROM(song_bank);
    hUGE_init(&song_placeholder);
    SWITCH_ROM(save);
    add_VBL(music_isr);
  }
}
