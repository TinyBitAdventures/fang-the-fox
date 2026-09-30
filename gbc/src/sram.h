// One visited area's state in the cartridge's save RAM (banks 2-3), shared by area.c and logic.c.
#ifndef FANG_SRAM_H
#define FANG_SRAM_H
typedef struct {
  uint8_t tiles[CELLS];
  uint8_t solved, boss_down, entry, en_n, item_n, temp_n;
  uint8_t en_type[MAX_ENEMIES], en_x[MAX_ENEMIES], en_y[MAX_ENEMIES], en_state[MAX_ENEMIES], en_frozen[MAX_ENEMIES],
    en_phase[MAX_ENEMIES], en_revive[MAX_ENEMIES], en_revive_in[MAX_ENEMIES], en_acts[MAX_ENEMIES];
  int16_t en_hp[MAX_ENEMIES];
  uint16_t en_hit_t[MAX_ENEMIES];
  uint8_t item_code[MAX_ITEMS], item_cell[MAX_ITEMS], item_relic[MAX_ITEMS];
  uint8_t temp_cell[MAX_TEMP], temp_orig[MAX_TEMP], temp_t[MAX_TEMP];
} area_state_t;
#define PER_BANK (8192 / sizeof(area_state_t))
#define SRAM_AREA_BANK 2
#define VISITED(a) (visited[(a) >> 3] & (1 << ((a) & 7)))
// maps the right SRAM bank for area a (call ENABLE_RAM first, DISABLE_RAM after)
#define AREA_RECORD(a) (SWITCH_RAM(SRAM_AREA_BANK + (a) / PER_BANK), (area_state_t *)(0xA000 + ((a) % PER_BANK) * sizeof(area_state_t)))
#endif
