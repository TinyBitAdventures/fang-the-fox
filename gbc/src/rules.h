// Shared by the rules (logic.c, combat.c, turn.c): state, the game's tables and small helpers.
// Each rules file is banked on its own, so the helpers and tables are static copies in each bank,
// and calls between the files are BANKED.
#ifndef FANG_RULES_H
#define FANG_RULES_H
#include <gb/gb.h>
#include <string.h>
#include "game.h"
#include "gen/tables.inc"

#define EN_NEW 128     // spawned during this turn's enemy loop: the web iterates a copy of the list
#define MINION_CAP 3   // gbc/overrides.js rules.minionCap (the web game allows 5)
extern uint8_t tele_n, tele_x[6], tele_y[6];   // the dragon's breath: the cells it will burn
extern uint16_t tele_fire_on;
extern uint8_t in_enemy_loop, spot_x[24], spot_y[24];
static const int8_t DX[4] = { 1, -1, 0, 0 }, DY[4] = { 0, 0, 1, -1 };   // js DIRS

// ---------- small helpers ----------
static uint8_t idx(uint8_t x, uint8_t y) { return (y << 4) - (y << 1) + x; }
static uint8_t in_grid(int8_t x, int8_t y) { return x >= 0 && y >= 0 && x < COLS && y < ROWS; }
static uint8_t tile_at(int8_t x, int8_t y) { return in_grid(x, y) ? tiles[idx(x, y)] : '#'; }
static uint8_t is_solid(uint8_t ch) { return ch_flags[ch] & CF_SOLID; }
static uint8_t adist(uint8_t a, uint8_t b) { return a > b ? a - b : b - a; }
static uint8_t enemy_at(uint8_t x, uint8_t y) { for (uint8_t i = 0; i < en_n; i++) if (!(en_state[i] & EN_DEAD) && en_x[i] == x && en_y[i] == y) return i + 1; return 0; }
static uint8_t npc_at(uint8_t x, uint8_t y) { for (uint8_t i = 0; i < npc_n; i++) if (npc_x[i] == x && npc_y[i] == y) return i + 1; return 0; }
static uint8_t item_at(uint8_t cell) { for (uint8_t i = 0; i < item_n; i++) if (item_code[i] && item_cell[i] == cell) return i + 1; return 0; }
static uint8_t block_at(uint8_t x, uint8_t y) { for (uint8_t b = 0; b < blk_n; b++) if (blk_x[b] == x && blk_y[b] == y) return b + 1; return 0; }   // sunk blocks have x NONE
static uint8_t brazier_at(uint8_t cell) { uint8_t k = 0; while (k < brz_n && brz_cell[k] != cell) k++; return k; }   // brz_n: none
static uint8_t occupied(uint8_t x, uint8_t y) { return enemy_at(x, y) || npc_at(x, y) || block_at(x, y) || (fox.x == x && fox.y == y); }
static uint8_t has_plates(void) { return area_flags & AF_PLATES; }
static const monster_t *mon(uint8_t e) { return &monsters[en_type[e]]; }
static uint8_t flag_for(uint8_t req) {
  switch (req) {
    case REQ_GOOKING: return HAS_FLAG(F_GOOKING);
    case REQ_PATHFINDER: return HAS_PERK(P_PATHFINDER);
    case REQ_CRYSTALKEY: return HAS_FLAG(F_CRYSTALKEY);
    case REQ_FROST_CLOAK: return HAS_FLAG(F_CLOAK);
    default: return HAS_FLAG(F_SCALE);
  }
}
static void num_float(uint8_t x, uint8_t y, const char *pre, uint16_t n, const char *post) { m_clear(); m_s(pre); m_u(n); m_s(post); float_num(x, y, msg); }
static void add_item(uint8_t code, uint8_t cell) {
  for (uint8_t i = 0; i < item_n; i++) if (!item_code[i]) { item_code[i] = code; item_cell[i] = cell; item_relic[i] = 0; return; }
  if (item_n < MAX_ITEMS) { item_code[item_n] = code; item_cell[item_n] = cell; item_relic[item_n++] = 0; }
}
static void add_temp(uint8_t cell, uint8_t orig_ch, uint8_t t) {
  for (uint8_t i = 0; i < temp_n; i++) if (temp_cell[i] == cell) { temp_orig[i] = orig_ch; temp_t[i] = t; return; }
  if (temp_n < MAX_TEMP) { temp_cell[temp_n] = cell; temp_orig[temp_n] = orig_ch; temp_t[temp_n++] = t; }
}
static void set_tile(uint8_t i, uint8_t ch) {   // the screen catches up after the action (cells_refresh)
  tiles[i] = ch;
  if (chg_n < CHG_MAX) chg_cell[chg_n] = i;
  if (chg_n <= CHG_MAX) chg_n++;
}
// used by more than one rules file; static so a message's text stays in the caller's bank
static void bump(const char *text) { sfx_play(SFX_BUMP); fox_anim(A_BUMP, 0, 0, 7); if (text) hud_say(text); }
static void move_fox(uint8_t nx, uint8_t ny) { fox_anim(A_HOP, fox.x, fox.y, 7); fox.x = nx; fox.y = ny; sfx_play(SFX_STEP); }
static void crumble_behind(uint8_t i) {
  if (tiles[i] != 'u') return;
  set_tile(i, area_crumble_to); sfx_play(SFX_BOOM);
  if (area_reform) add_temp(i, 'u', area_reform);
}

// ---------- across the rules files ----------
void end_turn(void) BANKED;
void gain_xp(uint16_t n) BANKED;
void hurt_fox(uint8_t amount, uint8_t *dealt) BANKED;
void attack(uint8_t e, int8_t dx, int8_t dy) BANKED;
uint8_t damage_enemy(uint8_t e, uint16_t dmg, uint8_t crit) BANKED;
uint16_t calc_damage(uint8_t *crit) BANKED;
void enemy_strike(uint8_t e, uint8_t counter) BANKED;
void summon(uint8_t boss, uint8_t type, uint8_t n) BANKED;
void apply_when_doors(void) BANKED;
void boss_hud(void) BANKED;
void try_door(uint8_t i, uint8_t nx, uint8_t ny) BANKED;
void pickup(uint8_t it) BANKED;
#endif
