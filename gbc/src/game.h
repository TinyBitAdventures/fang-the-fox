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
// puzzles: blocks to push (x NONE: sunk), braziers and how long they burn (the web's S.blocks, S.lit)
#define MAX_BLOCKS 4
#define MAX_BRAZIERS 6
#define LIT_FOREVER 0xFF
extern uint8_t blk_n, blk_x[MAX_BLOCKS], blk_y[MAX_BLOCKS], blk_o[MAX_BLOCKS], area_block_ak;   // blk_o: the cell it starts on
extern uint8_t brz_n, brz_cell[MAX_BRAZIERS], brz_phase[MAX_BRAZIERS], lit_t[MAX_BRAZIERS], area_flame_ak;   // lit_t: 0 cold, turns left, or LIT_FOREVER
void area_enter(uint8_t a) BANKED;   // loads the area: from SRAM when visited before, else fresh from ROM
void area_leave(void) BANKED;        // writes the current area's state to SRAM
void area_reset_world(void) BANKED;  // a new game: every area fresh
void area_recover_world(void) BANKED;   // after a fall: regular foes in every other visited area heal (logic.c)
typedef struct area_state_s area_state_t;
void area_store(area_state_t *r) BANKED;   // the current area's state into a save RAM record (its bank mapped)
extern uint8_t area_is_fresh;        // set by area_enter when the area came fresh from ROM: entered_area fills in the foes
#include "sram.h"

// ---------- the changing world on screen (cells.c) ----------
#define MAX_SEGS 8
extern uint8_t look_now[CELLS], dyn_n, dyn_cell[CELLS], cond_n, cond_cell[16], fog_clear;   // fog_clear: Keen Eyes or True Sight
#define CHG_MAX 16
extern uint8_t chg_n, chg_cell[CHG_MAX];   // cells whose tile the rules changed this action (rules.h set_tile); more than CHG_MAX: look at all
extern uint8_t flame_f, flick;     // the flames' frame (0-2), and 1 while a brazier near its end shows cold
extern uint8_t area_bank, anim_seg_n, anim_bank;                      // where the area's cells and the biome's animation live
extern const cell_rec_t *area_recs;
extern const uint8_t *area_metas, *anim_data;
extern anim_seg_t anim_segs[MAX_SEGS];
void cells_draw_all(void) BANKED;  // every cell, entering an area
void cells_refresh(void) BANKED;   // the cells whose look changed, after the rules ran
void cells_frame(void) BANKED;     // tile animation, flames and their flicker, every frame

// ---------- other ROM banks, from banked code (far.c, bank 0) ----------
void far_copy(void *dst, uint8_t bank, const void *src, uint16_t n);
void far_vram(uint8_t *vram, uint8_t vbk, uint8_t bank, const uint8_t *src, uint16_t n);

// ---------- palettes: the area's colours, faded on the way to the screen (area.c) ----------
extern palette_color_t bg_pal[32], obj_pal[32];
extern uint8_t pal_level, pal_dirty, pal_half;   // 0 = black, 16 = full colour; set pal_dirty after changing either
void pal_prepare(void);             // after the frame's work, when pal_dirty
void pal_upload(void);              // right after VBlank starts

// ---------- the view: what the logic asks to show (game.c) ----------
enum { A_NONE, A_HOP, A_BUMP, A_LUNGE, A_MOVE, A_REST };   // A_REST: no motion, just the pace of a step
extern uint8_t cam_x, scroll_y, dbg_cam;   // written to SCX/SCY in VBlank; dbg_cam: 0 follows Fang, n pins the camera at n - 1 (tests)
extern uint16_t frame_count;
extern uint8_t en_anim[MAX_ENEMIES], en_anim_t[MAX_ENEMIES], en_from[MAX_ENEMIES], en_flash[MAX_ENEMIES];
extern uint8_t blk_anim_t[MAX_BLOCKS], blk_from[MAX_BLOCKS];
void block_anim(uint8_t b, uint8_t from_cell);
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
void transition_dark(uint8_t to, uint8_t spawn);   // the screen is dark already: straight to the change
void game_over(void);
uint8_t busy(void);
void game_start(void) BANKED;
void game_frame(uint8_t held, uint8_t pressed);
enum { S_PLAY, S_TRANS, S_DEAD, S_OVERVIEW, S_TALK, S_PERK, S_SHOP, S_TITLE, S_PAUSE, S_CREDITS };
extern uint8_t game_state, skip_leave;   // skip_leave: the next area change doesn't write the area left (loading a save)

// ---------- the rules: the port of js/game.js (logic.c, banked) ----------
void new_game(void) BANKED;
void do_action(int8_t dx, int8_t dy) BANKED;
void eat_fish(void) BANKED;
void fire_spin(void) BANKED;
void respawn(void) BANKED;
void entered_area(void) BANKED;     // the web's enterArea after the area is loaded (fresh foes, reset puzzles, re-form paths)
enum { HURT_LAVA = 0xF0, HURT_SPORE, HURT_VENT, HURT_FIRE, HURT_POISON };   // below these: a monster type
extern char death_by[NAME_LEN];     // what felled Fang (combat.c)
void set_death_by(uint8_t src) BANKED;
extern uint8_t tele_n, tele_x[6], tele_y[6];   // the dragon's breath: the cells it will burn (logic.c)
void light_brazier(uint8_t i, uint8_t x, uint8_t y) BANKED;   // puzzle.c: lightBrazier, pushBlock, checkPuzzle
void push_block(uint8_t b, int8_t dx, int8_t dy) BANKED;
void check_puzzle(void) BANKED;

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
extern uint8_t spr_clip;                      // OAM y: hardware sprites below it are hidden (0: none)
void spr_clear(void);
void spr_put(uint8_t kind, uint8_t frame, uint8_t flip, uint8_t prio, int16_t px, uint8_t py);   // px, py: bottom-centre on screen
uint8_t spr_slot(uint8_t prio);   // the next list slot for a thing of this priority (0xFF when full)
void spr_flush(void);

// ---------- text, messages and the HUD (text.c, hud.c) ----------
uint8_t vwf_width(const char *s);
uint8_t vwf_adv(char c);            // one character's width plus its gap
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
extern uint8_t hud_hold;            // a dialogue or menu covers the HUD: draw nothing, keep what changed for later
void hud_refresh(void);             // draw it all again (the window was used for something else)
void hud_goal(const char *s);       // the quest line: after the message showing, or now

// ---------- text canvases for the window's menus (canvas.c, bank 0) ----------
#define CV_W 18
enum { CV_MENU, CV_PAUSE };
extern uint8_t cv_buf[CV_W * 16], cv_mode;
uint8_t cv_tile(uint8_t r);
uint8_t cv_bank(uint8_t r);
void cv_upload(uint8_t r, uint8_t t, const uint8_t *src, uint8_t n);
void cv_begin(void);
void cv_draw(uint8_t x, const char *s, uint8_t colour);   // colour 1 white, 2 blue, 3 yellow
void cv_right(uint8_t x_end, const char *s, uint8_t colour);
void cv_centre(const char *s, uint8_t colour);
void cv_end(uint8_t r);
void cv_line(uint8_t r, const char *s, uint8_t colour);
void cv_row(uint8_t y, uint8_t r);
uint8_t cv_wrap(uint8_t r0, uint8_t lines, const char *s, uint8_t colour);

// ---------- the dialogue box and menus (dialog.c, window layer) ----------
extern char dlg_text[192];          // the line being shown (story.c fills it and dlg_who)
extern uint8_t dlg_who, perk_choice[3], perk_choice_n;
void dlg_open(void) BANKED;
void dlg_frame(uint8_t pressed) BANKED;
void perk_open(void) BANKED;
void perk_frame(uint8_t pressed) BANKED;
void shop_open(void) BANKED;
void shop_frame(uint8_t pressed) BANKED;
void shop_status(const char *s) BANKED;   // s in WRAM (msg)
void title_open(uint8_t has_save) BANKED;
uint8_t title_frame(uint8_t pressed) BANKED;
void ui_init(void) BANKED;

// ---------- the story (story.c: a port of js/story.js) and saving (save.c) ----------
#define STORY_MAX 4
enum { ST_NONE, ST_BOSS_DEFEATED, ST_HEARTH_AFTERMATH, ST_START_ENDING, ST_AFTER_CREDITS };
extern uint8_t story_n, story_fn[STORY_MAX], story_arg[STORY_MAX];   // the web's G.story: beats waiting for normal play
extern uint16_t story_t[STORY_MAX];                                  // frames each still waits
uint8_t story_line(uint8_t i) BANKED;
void story_after(void) BANKED;
void talk_to(uint8_t npc) BANKED;
void read_sign(uint8_t cell) BANKED;
void show_objective(void) BANKED;
void start_intro(void) BANKED;
void queue_story(uint8_t fn, uint8_t arg, uint16_t frames) BANKED;
void run_story(void) BANKED;
void offer_perks(void) BANKED;
void choose_perk(uint8_t k) BANKED;
void buy(uint8_t i) BANKED;
extern uint8_t load_area;
uint8_t has_save(void) BANKED;
uint8_t load_game(void) BANKED;
void save_game(void) BANKED;
void save_erase(void) BANKED;
void objective_copy(void) BANKED;   // the quest line into msg

// ---------- the pause screen, settings and the credits (pause.c); the death box (dialog.c) ----------
extern uint8_t opt_music, opt_sfx, opt_vol, opt_shake;   // saved in cartridge RAM bank 1
extern uint8_t anim_hold;           // the window borrows the biome's tiles: no tile animation meanwhile
void settings_load(void) BANKED;
void pause_open(void) BANKED;
void pause_frame(uint8_t pressed) BANKED;
void credits_start(void) BANKED;
void credits_frame(uint8_t pressed) BANKED;
void death_open(void) BANKED;
void death_frame(void) BANKED;
void death_close(void) BANKED;
void area_reload_tiles(void) BANKED;   // the biome's tiles and palettes again, after the window borrowed them
extern uint8_t music_on;
void music_enable(uint8_t on);
extern uint8_t pal_dim;             // the world at half light, the window's text palette at full (the death box)

// ---------- sound (audio.c, sfx.c) ----------
void music_start(void);
void sfx_play(uint8_t id);
void sfx_frame(void);

#endif
