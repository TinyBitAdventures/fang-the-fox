// Saving and loading (the web's save and load). Two slots in save RAM bank 0 take turns, so a save cut
// short by the power leaves the other one whole: each holds the game (the web's G without its areas),
// the story queue and the current area as it was, with a checksum. Other visited areas live in banks
// 2-3 (sram.h), written when Fang leaves them; loading copies the slot's area over its record there,
// so the areas and the game always agree with the moment of the save.
#pragma bank 255
#include <gb/gb.h>
#include <string.h>
#include <stddef.h>
#include "game.h"

#define SAVE_MAGIC 0x4658u   // "FX"
#define SAVE_VERSION 1       // bump when this layout or area_state_t changes: older saves are ignored
typedef struct {
  uint16_t magic, version, seq, sum;
  fox_t fox;
  uint16_t turn, kills, perks;
  uint8_t fish, keys, gems, embers, pending_perks, relic_n, kits_rescued, area;
  uint8_t relics[(RELIC_COUNT + 7) / 8], flags[(FLAG_COUNT + 7) / 8], visited[(AREA_COUNT + 7) / 8];
  uint8_t buff[10];
  uint8_t story_n, story_fn[STORY_MAX], story_arg[STORY_MAX];
  uint16_t story_t[STORY_MAX];
  area_state_t here;
} save_t;
#define SLOT(n) ((save_t *)(0xA000 + ((n) ? 0x800 : 0)))
#define BODY offsetof(save_t, fox)

static uint8_t slot_last = 0xFF;   // the slot with the newest save (0xFF: none)
static uint16_t seq_last;
uint8_t load_area;

static uint16_t sum_of(const save_t *s) {
  const uint8_t *p = (const uint8_t *)s + BODY;
  uint16_t n = sizeof(save_t) - BODY, sum = 0x5A5A;
  while (n--) sum = (sum << 1 | sum >> 15) + *p++;
  return sum;
}
static uint8_t valid(const save_t *s) { return s->magic == SAVE_MAGIC && s->version == SAVE_VERSION && s->sum == sum_of(s); }

uint8_t has_save(void) BANKED {   // finds the newest good slot
  uint8_t k;
  slot_last = 0xFF;
  ENABLE_RAM; SWITCH_RAM(0);
  for (k = 0; k < 2; k++) if (valid(SLOT(k)) && (slot_last == 0xFF || (int16_t)(SLOT(k)->seq - seq_last) > 0)) { slot_last = k; seq_last = SLOT(k)->seq; }
  DISABLE_RAM;
  return slot_last != 0xFF;
}

void save_game(void) BANKED {
  if (fox.hp <= 0 || game_state == S_DEAD || game_state == S_TITLE) return;   // never keep a fallen Fang
  uint8_t k = slot_last == 0 ? 1 : 0;
  save_t *s = SLOT(k);
  ENABLE_RAM; SWITCH_RAM(0);
  s->magic = 0;   // not a save until it's whole
  s->fox = fox; s->turn = turn; s->kills = kills; s->perks = perks;
  s->fish = fish; s->keys = keys; s->gems = gems; s->embers = embers; s->pending_perks = pending_perks;
  s->relic_n = relic_n; s->kits_rescued = kits_rescued; s->area = area_idx;
  memcpy(s->relics, relics, sizeof(relics)); memcpy(s->flags, flags, sizeof(flags)); memcpy(s->visited, visited, sizeof(visited));
  s->buff[0] = b_mushroom; s->buff[1] = b_poison; s->buff[2] = b_ward; s->buff[3] = b_barrier; s->buff[4] = b_haste;
  s->buff[5] = b_sleep; s->buff[6] = b_rooted; s->buff[7] = b_spin_cd; s->buff[8] = b_second_wind; s->buff[9] = b_true_sight;
  s->story_n = story_n; memcpy(s->story_fn, story_fn, STORY_MAX); memcpy(s->story_arg, story_arg, STORY_MAX); memcpy(s->story_t, story_t, sizeof(story_t));
  area_store(&s->here);
  s->version = SAVE_VERSION; s->seq = ++seq_last; s->sum = sum_of(s);
  s->magic = SAVE_MAGIC;
  DISABLE_RAM;
  slot_last = k;
}

void save_erase(void) BANKED {   // RESTART FROM SCRATCH
  ENABLE_RAM; SWITCH_RAM(0); SLOT(0)->magic = 0; SLOT(1)->magic = 0; DISABLE_RAM;
  slot_last = 0xFF;
}

uint8_t load_game(void) BANKED {   // restores the game; the caller enters load_area at Fang's cell
  static uint8_t buf[64];
  uint16_t off, n;
  if (!has_save()) return 0;
  const save_t *s = SLOT(slot_last);
  ENABLE_RAM; SWITCH_RAM(0);
  fox = s->fox; turn = s->turn; kills = s->kills; perks = s->perks;
  fish = s->fish; keys = s->keys; gems = s->gems; embers = s->embers; pending_perks = s->pending_perks;
  relic_n = s->relic_n; kits_rescued = s->kits_rescued; load_area = s->area;
  memcpy(relics, s->relics, sizeof(relics)); memcpy(flags, s->flags, sizeof(flags)); memcpy(visited, s->visited, sizeof(visited));
  b_mushroom = s->buff[0]; b_poison = s->buff[1]; b_ward = s->buff[2]; b_barrier = s->buff[3]; b_haste = s->buff[4];
  b_sleep = s->buff[5]; b_rooted = s->buff[6]; b_spin_cd = s->buff[7]; b_second_wind = s->buff[8]; b_true_sight = s->buff[9];
  story_n = s->story_n; memcpy(story_fn, s->story_fn, STORY_MAX); memcpy(story_arg, s->story_arg, STORY_MAX); memcpy((void *)story_t, s->story_t, sizeof(story_t));
  // the slot's area over its record in banks 2-3, a piece at a time (one save RAM bank is mapped at once)
  for (off = 0; off < sizeof(area_state_t); off += n) {
    n = sizeof(area_state_t) - off; if (n > sizeof(buf)) n = sizeof(buf);
    SWITCH_RAM(0); memcpy(buf, (const uint8_t *)&s->here + off, n);
    memcpy((uint8_t *)AREA_RECORD(load_area) + off, buf, n);
  }
  DISABLE_RAM;
  visited[load_area >> 3] |= 1 << (load_area & 7);
  if (fox.hp <= 0) fox.hp = fox.max_hp;
  if (HAS_FLAG(F_PRIMORDIAL) && !HAS_FLAG(F_ENDED)) {   // js load: the ending is never lost
    uint8_t k; for (k = 0; k < story_n && story_fn[k] != ST_START_ENDING; k++);
    if (k == story_n && story_n < STORY_MAX) { story_fn[story_n] = ST_START_ENDING; story_arg[story_n] = 0; story_t[story_n++] = 0; }
  }
  return 1;
}
