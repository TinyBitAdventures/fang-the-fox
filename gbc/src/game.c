// Fang in the world: the port of js/game.js starts here (movement, bumping, doors) plus what the web
// game draws in view.js (the hop and bump, the camera, sprites for everything in the area).
// Names follow the web code: do_action = doAction, try_door = tryDoor, move_fox = moveFox, bump = bump.
#include <gb/gb.h>
#include <string.h>
#include "game.h"

fox_t fox;
uint8_t cam_x, dbg_cam;
uint16_t frame_count;

enum { A_NONE, A_HOP, A_BUMP };
static struct { uint8_t type, t, fx, fy; } anim;   // Fang's current move (7 frames, like the web's 110-120 ms)
static const uint8_t ease16[8] = { 0, 4, 8, 11, 13, 15, 16, 16 };   // 16 * easeOut(t / 7)
static const uint8_t lift4[8] = { 0, 2, 3, 4, 4, 3, 2, 0 };         // 4 * sin(pi * t / 7)
static const int8_t bump2[8] = { 0, 2, -1, -2, 2, 1, -2, 0 };       // 2 * sin(4 * pi * t / 7)
#define ANIM_FRAMES 7

enum { M_PLAY, M_TRANS };
static uint8_t state, trans_t, trans_to, trans_spawn, queued;
#define FADE 16   // frames each way; the web's dissolve takes 560 ms, the area swaps at 260 ms

static uint8_t idx(uint8_t x, uint8_t y) { return y * COLS + x; }
static uint8_t ent_at(uint8_t x, uint8_t y) { for (uint8_t i = 0; i < ent_n; i++) if (ent_x[i] == x && ent_y[i] == y) return i + 1; return 0; }
static uint8_t has_plate(void) { for (uint8_t i = 0; i < CELLS; i++) if (tiles[i] == '+') return 1; return 0; }
static uint8_t flag_for(uint8_t req) { (void)req; return 0; }   // story flags and perks arrive in phases 2-4

static void bump(const char *text) {
  anim.type = A_BUMP; anim.t = 0;
  if (text) hud_say(text);
}
static void move_fox(uint8_t nx, uint8_t ny) {
  anim.type = A_HOP; anim.t = 0; anim.fx = fox.x; anim.fy = fox.y;
  fox.x = nx; fox.y = ny;
}
static void enter_area(uint8_t a, uint8_t spawn) {   // spawn 0xFF: the area's own start cell
  area_load(a);
  if (spawn == 0xFF) spawn = area_spawn;
  fox.x = spawn % COLS; fox.y = spawn / COLS;
  anim.type = A_NONE;
  hud_title(area_title);
}
static void transition(uint8_t to, uint8_t spawn) { state = M_TRANS; trans_t = 0; trans_to = to; trans_spawn = spawn; queued = 0; }

static void try_door(uint8_t i, uint8_t nx, uint8_t ny) {
  door_rt_t *d = 0;
  for (uint8_t k = 0; k < door_n; k++) if (doors[k].cell == i) d = &doors[k];
  if (!d) { bump("This passage leads nowhere..."); return; }
  if (d->req && !flag_for(d->req)) {
    switch (d->req) {
      case REQ_GOOKING:      bump("Thick green goo seals the path. The Goo King must be stopped first!"); break;
      case REQ_PATHFINDER:   bump("An overgrown secret passage. Learn PATHFINDER to open it."); break;
      case REQ_CRYSTALKEY:   bump("The crystal arch is sealed. Find the Crystal Key in the Depths below."); break;
      case REQ_FROST_CLOAK:  bump("The heat is too intense! You need the Frost Cloak from the Ice Colossus."); break;
      default:               bump("The forest rejects you. You need the Dragon Scale."); break;
    }
    return;
  }
  move_fox(nx, ny);
  hud_say(d->name);
  transition(d->to, d->spawn);
}

static void do_action(int8_t dx, int8_t dy) {
  if (dx) fox.dir = dx;
  int8_t nx = fox.x + dx, ny = fox.y + dy;
  if (nx < 0 || ny < 0 || nx >= COLS || ny >= ROWS) { bump("Ouch! The edge of the island."); return; }
  if (ent_at(nx, ny)) { bump(0); return; }   // attacking and talking come in phases 2 and 4
  uint8_t i = idx(nx, ny), ch = tiles[i];
  if (ch == 'd' || ch == 'D') { try_door(i, nx, ny); return; }
  if (ch == '?' || ch == '*') { bump(0); return; }   // signs and braziers come in phases 3 and 4
  if (ch == '%') { bump("A locked gate. It needs an Ancient Key."); return; }
  if (ch == '#') { bump(has_plate() ? "A sealed gate. Something here must be weighed down..." : "A sealed gate. The braziers here are cold..."); return; }
  if (ch == '~') { bump("The Void yawns below. Better not!"); return; }
  if (ch_flags[ch] & CF_SOLID) { bump(ch == 'w' ? "Fang would rather not swim." : 0); return; }
  move_fox(nx, ny);
}

void game_start(void) {
  memset(&fox, 0, sizeof(fox));
  fox.hp = fox.max_hp = 100; fox.atk = 5; fox.lvl = 1; fox.dir = 1;
  enter_area(0, 0xFF);
  hud_stats();
  pal_level = 16; pal_dirty = 1;
}

// ---------- drawing ----------
static void fox_pos(int16_t *px, int16_t *py, uint8_t *lift) {
  *px = fox.x << 4; *py = fox.y << 4; *lift = 0;
  if (anim.type == A_HOP) {
    uint8_t e = ease16[anim.t];
    *px = anim.fx << 4; *py = anim.fy << 4;
    if (fox.x > anim.fx) *px += e; else if (fox.x < anim.fx) *px -= e;
    if (fox.y > anim.fy) *py += e; else if (fox.y < anim.fy) *py -= e;
    *lift = lift4[anim.t];
  } else if (anim.type == A_BUMP) *px += bump2[anim.t];
}

static void draw(void) {
  int16_t px, py; uint8_t lift, left = 0, right = 0;
  fox_pos(&px, &py, &lift);
  // the camera keeps Fang in the middle of the 160 px screen, within the 224 px area
  if (dbg_cam) cam_x = dbg_cam - 1;
  else {
    int16_t want = px + 8 - 80;
    if (want < 0) want = 0; if (want > (AREA_W - 20) * 8) want = (AREA_W - 20) * 8;
    if (state == M_TRANS && trans_t == FADE) cam_x = (uint8_t)want;
    else if (want > cam_x + 3) cam_x += 3; else if (want + 3 < cam_x) cam_x -= 3; else cam_x = (uint8_t)want;
  }
  spr_clear();
  uint8_t t8 = (uint8_t)frame_count;
  spr_put(AK_FOX, anim.type == A_HOP ? 2 : (t8 >> 5) & 1, fox.dir < 0, 0, px + 8 - cam_x, (uint8_t)(py + 16 - lift));
  // everything in the area: runs for up to 24 things every frame, so statics and arrays, 8-bit maths
  static uint8_t i2, fl, half, bx, by, row, bit, phase, fx, fy, right_edge, ax, ay, r, w, slot;
  fx = fox.x; fy = fox.y; right_edge = cam_x + 160;
  for (i2 = 0; i2 < ent_n; i2++) {
    fl = ent_flags[i2]; half = ent_half[i2]; bx = ent_bx[i2]; by = ent_by[i2]; row = ent_y[i2]; bit = 1 << row;
    if (bx + half <= cam_x) {             // out of view on the left: an arrow at the edge for enemies
      if (!(fl & KF_NPC) && !(left & bit)) { left |= bit; spr_put(AK_MARKER, 0, 0, 2, 4, by); }
      continue;
    }
    if (bx >= right_edge + half) {
      if (!(fl & KF_NPC) && !(right & bit)) { right |= bit; spr_put(AK_MARKER, 0, 1, 2, 156, by); }
      continue;
    }
    phase = t8 + (i2 << 3);
    if (fl & KF_FLIES) { ax = (uint8_t)(phase + (i2 << 3)) >> 4 & 3; by -= ax == 3 ? 1 : ax; }
    ax = ent_x[i2]; ax = ax > fx ? ax - fx : fx - ax;
    ay = row > fy ? row - fy : fy - row;
    slot = spr_slot((fl & KF_BOSS) || ax + ay == 1 ? 1 : 2);
    if (slot == 0xFF) break;
    spr_kind[slot] = ent_kind[i2];
    spr_frame[slot] = fl & KF_FAST ? (phase >> 3) & 1 : (phase >> 5) & 1;   // about 0.13 s a frame for bats, 0.53 s for the rest
    spr_flip[slot] = fx < ent_x[i2];
    spr_x[slot] = bx - cam_x + 8; spr_y[slot] = by + 16;
    r = (uint8_t)(by - 1) >> 4; w = half >> 2;
    if ((spr_row[r] += w) > 10) spr_over = 1;
    if ((fl & KF_TALL) && r && (spr_row[r - 1] += w) > 10) spr_over = 1;
  }
  spr_flush();
}

// ---------- one frame ----------
static int8_t dir_dx(uint8_t j) { return j & J_RIGHT ? 1 : j & J_LEFT ? -1 : 0; }
static int8_t dir_dy(uint8_t j) { return j & J_DOWN ? 1 : j & J_UP ? -1 : 0; }

void game_frame(uint8_t held, uint8_t pressed) {
  frame_count++;
  if (anim.type != A_NONE && ++anim.t >= ANIM_FRAMES) anim.type = A_NONE;
  if (state == M_TRANS) {
    trans_t++;
    if (trans_t <= FADE) pal_level = FADE - trans_t;
    if (trans_t == FADE) enter_area(trans_to, trans_spawn);
    if (trans_t > FADE) pal_level = trans_t - FADE;
    pal_dirty = 1;
    if (trans_t == FADE * 2) state = M_PLAY;
  } else if (pressed & J_SELECT) transition(area_idx + 1 == AREA_COUNT ? 0 : area_idx + 1, 0xFF);   // debug until the menus exist
  else if (pressed & J_START) transition(area_idx ? area_idx - 1 : AREA_COUNT - 1, 0xFF);
  else {
    uint8_t dirs = pressed & (J_UP | J_DOWN | J_LEFT | J_RIGHT);
    if (dirs && anim.type != A_NONE) queued = dirs;   // a tap during a move plays right after it
    if (anim.type == A_NONE) {
      uint8_t j = queued ? queued : held;
      queued = 0;
      int8_t dx = dir_dx(j), dy = dx ? 0 : dir_dy(j);
      if (dx || dy) do_action(dx, dy);
    }
  }
  hud_frame();
  draw();
}
