// Fang the Fox, Game Boy Color edition: state shared between the modules.
#ifndef FANG_GAME_H
#define FANG_GAME_H
#include <stdint.h>
#include "gen/world.h"

// ---------- the current area, copied to WRAM when it is entered (area.c) ----------
#define MAX_DOORS 8
#define MAX_ENTS 24
#define MAX_KINDS 12
#define NAME_LEN 40
#define AK_FOX 0        // the fox and the edge marker are always an area's first two kinds
#define AK_MARKER 1
typedef struct { uint8_t cell, to, spawn, req, when; char name[NAME_LEN]; } door_rt_t;
typedef struct { uint8_t cols, rows, frames, flags, prop, tile, pal, ppf; } kind_rt_t;   // 8 bytes: indexing is a shift; prop = palette + VRAM bank bit
#define MAX_PIECES 32   // 8x16 pieces per kind across all frames (a boss: 2 frames x 8)

extern uint8_t area_idx, area_spawn, tiles[CELLS];
extern uint8_t door_n, ent_n, kind_n;
extern door_rt_t doors[MAX_DOORS];
// things in the area, one array per field (SDCC compiles indexed arrays far better than structs):
// kind (index into kinds_rt), cell x/y, bx/by (cell bottom-centre in area pixels), flags/half (from the kind)
extern uint8_t ent_kind[MAX_ENTS], ent_x[MAX_ENTS], ent_y[MAX_ENTS], ent_bx[MAX_ENTS], ent_by[MAX_ENTS], ent_flags[MAX_ENTS], ent_half[MAX_ENTS];
extern kind_rt_t kinds_rt[MAX_KINDS];
extern uint8_t kind_pal_of[MAX_KINDS][MAX_PIECES];   // palette (0/1) of each piece
extern char area_title[NAME_LEN];
void area_load(uint8_t a);          // background, sprite tiles, palettes, cells, doors, things in it

// ---------- palettes: the area's colours, faded on the way to the screen (area.c) ----------
extern palette_color_t bg_pal[32], obj_pal[32];
extern uint8_t pal_level, pal_dirty;   // 0 = black, 16 = full colour; set pal_dirty after changing either
void pal_prepare(void);             // after the frame's work, when pal_dirty
void pal_upload(void);              // right after VBlank starts

// ---------- Fang (game.c) ----------
typedef struct { uint8_t x, y; int8_t dir; uint8_t hp, max_hp, atk, lvl, fish, gems; } fox_t;
extern fox_t fox;
extern uint8_t cam_x, dbg_cam;      // dbg_cam: 0 follows Fang, n pins the camera at n - 1 (tests)
extern uint16_t frame_count;
void game_start(void);
void game_frame(uint8_t held, uint8_t pressed);

// ---------- sprites (sprites.c) ----------
// Each kind's frames are metasprites built in WRAM when the area loads (area.c), drawn with GBDK's
// assembly metasprite routines. px, py: the thing's bottom-centre on screen (py = cell bottom, 16-128).
#include <gb/metasprites.h>
extern const metasprite_t *kind_frames[MAX_KINDS][4];
#define MAX_DRAW 32
// the frame's things by priority: 0 Fang, 1 bosses and anything next to Fang, 2 the rest
// x, y: the pivot in OAM coordinates (screen + 8, + 16)
extern uint8_t spr_kind[MAX_DRAW], spr_frame[MAX_DRAW], spr_flip[MAX_DRAW], spr_x[MAX_DRAW], spr_y[MAX_DRAW];
extern uint8_t spr_n, spr_row[9], spr_over;   // things listed, sprites per 16 px row, a row over 10
void spr_clear(void);
void spr_put(uint8_t kind, uint8_t frame, uint8_t flip, uint8_t prio, int16_t px, uint8_t py);   // px, py: bottom-centre on screen
uint8_t spr_slot(uint8_t prio);   // the next list slot for a thing of this priority (0xFF when full)
void spr_flush(void);

// ---------- text and HUD (text.c, hud.c) ----------
uint8_t vwf_width(const char *s);
uint8_t vwf_draw(uint8_t *buf, uint8_t tiles, uint8_t x, const char *s, uint8_t colour);
void hud_init(void);
void hud_stats(void);
void hud_title(const char *s);
void hud_say(const char *s);
void hud_frame(void);

// ---------- music (audio.c) ----------
void music_start(void);

#endif
