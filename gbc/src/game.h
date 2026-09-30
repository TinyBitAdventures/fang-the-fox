// Fang the Fox, Game Boy Color edition: state shared between the modules.
// Per-frame code is written for SDCC: arrays indexed by a byte (one per field), statics, no multiplies.
#ifndef FANG_GAME_H
#define FANG_GAME_H
#include <stdint.h>
#include <gb/gb.h>
#include <gb/metasprites.h>
#include "gen/world.h"

// ---------- the game (the web's G) ----------
typedef struct { int16_t hp; uint16_t max_hp, xp, next; uint8_t x, y, atk, lvl; int8_t dir; } fox_t;   // hp dips below 0 on a killing blow
extern fox_t fox;
extern uint16_t turn, kills;
extern uint8_t fish, keys, gems, embers, pending_perks, relic_n, kits_rescued;
extern uint8_t relics[(RELIC_COUNT + 7) / 8], flags[(FLAG_COUNT + 7) / 8], visited[(AREA_COUNT + 7) / 8];
extern uint16_t perks;
extern uint8_t b_mushroom, b_poison, b_ward, b_barrier, b_haste, b_sleep, b_rooted, b_spin_cd, b_second_wind, b_true_sight;
#define HAS_PERK(p) ((perks & (1u << (p))) != 0)   // 0 or 1: a bare mask above bit 7 would vanish in a uint8_t
#define HAS_FLAG(f) ((flags[(f) >> 3] & (1 << ((f) & 7))) != 0)
#define SET_FLAG(f) (flags[(f) >> 3] |= 1 << ((f) & 7))

// ---------- the current area (the web's S), copied to and from SRAM (area.c) ----------
#define MAX_DOORS 8
#define MAX_NPCS 6
#define MAX_KINDS 16
#define NAME_LEN 40
#define AK_FOX 0        // the fox, the edge marker and the floating numbers are always an area's first kinds
#define AK_MARKER 1
#define AK_FLOAT 2
#define NONE 0xFF
typedef struct { uint8_t cell, to, spawn, req, when; char name[NAME_LEN]; } door_rt_t;
typedef struct { uint8_t cols, rows, frames, flags, prop, tile, pal, ppf; } kind_rt_t;   // 8 bytes: indexing is a shift
#define MAX_PIECES 32   // 8x16 pieces per kind across all frames (a boss: 2 frames x 8)

extern uint8_t area_idx, area_spawn, area_entry, area_flags, area_solved, area_boss_down, area_brazier_time, area_reform, area_crumble_to;
extern uint8_t tiles[CELLS], orig[CELLS];
extern uint8_t door_n, kind_n;
extern door_rt_t doors[MAX_DOORS];
extern kind_rt_t kinds_rt[MAX_KINDS];
extern uint8_t kind_pal_of[MAX_KINDS][MAX_PIECES];
extern uint8_t type_ak[TYPE_COUNT], item_ak[ITEM_COUNT + 1];   // area kind of each monster type / item code (NONE)
extern char area_title[NAME_LEN];
// enemies: type, cell, what state they are in (EN_*), and the rest of the web's enemy fields
#define EN_DEAD 1
#define EN_GONE 2
#define EN_AGGRO 4
#define EN_REVEALED 8
#define EN_SUMMONED 16
#define EN_MINION 32
#define EN_ERUPTED 64
extern uint8_t en_n, en_type[MAX_ENEMIES], en_x[MAX_ENEMIES], en_y[MAX_ENEMIES], en_state[MAX_ENEMIES], en_frozen[MAX_ENEMIES],
  en_phase[MAX_ENEMIES], en_revive[MAX_ENEMIES], en_revive_in[MAX_ENEMIES], en_acts[MAX_ENEMIES];
extern int16_t en_hp[MAX_ENEMIES];
extern uint16_t en_hit_t[MAX_ENEMIES];
// items lying in the area: code (1-based, 0 = picked up), cell, relic number for relics
extern uint8_t item_n, item_code[MAX_ITEMS], item_cell[MAX_ITEMS], item_relic[MAX_ITEMS];
// cells that change back after a while (the web's S.temp): lava trails, crumbled paths that re-form
#define MAX_TEMP 8
extern uint8_t temp_n, temp_cell[MAX_TEMP], temp_orig[MAX_TEMP], temp_t[MAX_TEMP];
// friends: who, where, their sprite kind
extern uint8_t npc_n, npc_id[MAX_NPCS], npc_x[MAX_NPCS], npc_y[MAX_NPCS], npc_ak[MAX_NPCS];
void area_enter(uint8_t a) BANKED;   // loads the area: from SRAM when visited before, else fresh from ROM
void area_leave(void) BANKED;        // writes the current area's state to SRAM
void area_reset_world(void) BANKED;  // a new game: every area fresh
void area_recover_world(void) BANKED;   // after a fall: regular foes in every other visited area heal (logic.c)
extern uint8_t area_is_fresh;        // set by area_enter when the area came fresh from ROM: entered_area fills in the foes
#include "sram.h"

// ---------- other ROM banks, from banked code (far.c, bank 0) ----------
void far_copy(void *dst, uint8_t bank, const void *src, uint16_t n);
void far_vram(uint8_t *vram, uint8_t vbk, uint8_t bank, const uint8_t *src, uint16_t n);
void far_bkg(uint8_t bank, const uint8_t *map, const uint8_t *attr);

// ---------- palettes: the area's colours, faded on the way to the screen (area.c) ----------
extern palette_color_t bg_pal[32], obj_pal[32];
extern uint8_t pal_level, pal_dirty;   // 0 = black, 16 = full colour; set pal_dirty after changing either
void pal_prepare(void);             // after the frame's work, when pal_dirty
void pal_upload(void);              // right after VBlank starts

// ---------- the view: what the logic asks to show (game.c) ----------
enum { A_NONE, A_HOP, A_BUMP, A_LUNGE, A_MOVE, A_REST };   // A_REST: no motion, just the pace of a step
extern uint8_t cam_x, scroll_y, dbg_cam;   // written to SCX/SCY in VBlank; dbg_cam: 0 follows Fang, n pins the camera at n - 1 (tests)
extern uint16_t frame_count;
extern uint8_t en_anim[MAX_ENEMIES], en_anim_t[MAX_ENEMIES], en_from[MAX_ENEMIES], en_flash[MAX_ENEMIES];
void fox_anim(uint8_t type, uint8_t from_x, uint8_t from_y, uint8_t frames);   // from: the cell (hop) or the direction + 1 (lunge)
void enemy_anim(uint8_t e, uint8_t type, uint8_t from_cell);
void float_num(uint8_t x, uint8_t y, const char *text);   // copies the text (it may live in the caller's bank)
void float_render(uint8_t slot) BANKED;
void overview_fill(void) BANKED;
void overview_draw(void) BANKED;
void enter(uint8_t a, uint8_t spawn) BANKED;
extern char float_text[16];
#define FLOATS 4
#define FLOAT_LIFE 40
extern uint8_t fl_t[FLOATS], fl_x[FLOATS], fl_y[FLOATS];
typedef struct { uint8_t type, t, d, fx, fy; } fox_anim_t;
extern fox_anim_t fa;              // Fang's animation
uint8_t cam_want(int16_t px);      // the camera for Fang at area pixel px
void shake(uint8_t n);
void transition(uint8_t to, uint8_t spawn);
void game_over(void);
uint8_t busy(void);
void game_start(void) BANKED;
void game_frame(uint8_t held, uint8_t pressed);

// ---------- the rules: the port of js/game.js (logic.c, banked) ----------
void new_game(void) BANKED;
void do_action(int8_t dx, int8_t dy) BANKED;
void eat_fish(void) BANKED;
void fire_spin(void) BANKED;
void respawn(void) BANKED;
void entered_area(void) BANKED;     // the web's enterArea after the area is loaded (fresh foes, reset puzzles, re-form paths)

// ---------- randomness: xorshift32, the same sequence as tools/parity.js ----------
extern uint32_t rng_state;
uint32_t rng_next(void);
uint8_t rng_below(uint8_t n);
// Math.random() < p is rng < ceil(p * 2^32): checked for these in tools/parity.js
#define P_08 343597384UL
#define P_20 858993460UL
#define P_30 1288490189UL
#define P_60 2576980378UL
#define CHANCE(t) (rng_next() < (t))

// ---------- sprites (sprites.c) ----------
extern const metasprite_t *kind_frames[MAX_KINDS][4];
#define MAX_DRAW 40
// the frame's things by priority: 0 Fang, 1 bosses and anything next to Fang, 2 the rest, 3 items and arrows
// x, y: the pivot in OAM coordinates (screen + 8, + 16)
extern uint8_t spr_kind[MAX_DRAW], spr_frame[MAX_DRAW], spr_flip[MAX_DRAW], spr_x[MAX_DRAW], spr_y[MAX_DRAW];
extern uint8_t spr_n, spr_row[9], spr_over;   // things listed, sprites per 16 px row, a row over 10
void spr_clear(void);
void spr_put(uint8_t kind, uint8_t frame, uint8_t flip, uint8_t prio, int16_t px, uint8_t py);   // px, py: bottom-centre on screen
uint8_t spr_slot(uint8_t prio);   // the next list slot for a thing of this priority (0xFF when full)
void spr_flush(void);

// ---------- text, messages and the HUD (text.c, hud.c) ----------
uint8_t vwf_width(const char *s);
uint8_t vwf_draw(uint8_t *buf, uint8_t tiles, uint8_t x, const char *s, uint8_t colour);
extern char msg[96];
void m_clear(void);                 // builds a message: m_clear(); m_s("Slim takes "); m_u(5); hud_say(msg);
void m_s(const char *s);
void m_u(uint16_t v);
void hud_init(void) BANKED;
void hud_stats(void);
void hud_title(const char *s);
void hud_say(const char *s);
void hud_boss(uint8_t e, const char *name, uint16_t max);   // the boss's name and health on the lower row (e = NONE: no boss)
void hud_frame(void);
void hud_draw(uint8_t what) BANKED; // hud_frame's banked half

// ---------- sound (audio.c, sfx.c) ----------
void music_start(void);
void sfx_play(uint8_t id);
void sfx_frame(void);

#endif
