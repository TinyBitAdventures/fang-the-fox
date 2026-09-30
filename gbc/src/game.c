// The game on screen, every frame: input, the animations the rules ask for (view.js's entityPos),
// the camera, drawing everything, floating numbers, doors and fades, falling, and the SELECT overview.
// Runs in bank 0 and is written for SDCC: statics, byte-indexed arrays, tables instead of maths.
#include <gb/gb.h>
#include <string.h>
#include "game.h"

uint8_t cam_x, scroll_y, dbg_cam, dbg_goto, dbg_refresh;   // dbg_goto: area + 1 to go to; dbg_refresh: most scanlines a cell refresh took (tests)
uint16_t frame_count;
uint8_t en_anim[MAX_ENEMIES], en_anim_t[MAX_ENEMIES], en_from[MAX_ENEMIES], en_flash[MAX_ENEMIES];
uint8_t blk_anim_t[MAX_BLOCKS], blk_from[MAX_BLOCKS];   // a pushed block slides from blk_from (0xFF: still)
static const uint8_t row14[ROWS] = { 0, 14, 28, 42, 56, 70, 84, 98 };

// easeOut, sin arcs and the bump wobble at 8 steps through an animation (view.js entityPos)
static const uint8_t ease16[9] = { 0, 4, 7, 10, 12, 14, 15, 16, 16 };
static const uint8_t lift4[9] = { 0, 2, 3, 4, 4, 4, 3, 2, 0 };
static const uint8_t lift2[9] = { 0, 1, 1, 2, 2, 2, 1, 1, 0 };
static const uint8_t lunge6[9] = { 0, 2, 4, 6, 6, 6, 4, 2, 0 };
static const int8_t bump2[9] = { 0, 2, 0, -2, 0, 2, 0, -2, 0 };
#define EN_MOVE_FRAMES 9    // 150 ms
#define EN_LUNGE_FRAMES 10  // 160 ms
#define BLOCK_FRAMES 8      // 130 ms

fox_anim_t fa;   // Fang's animation
uint8_t game_state, skip_leave;   // S_* (exported for the tests)
extern uint8_t dbg_ly[8];
#define state game_state
static uint8_t trans_t, trans_to, trans_spawn, dead_t, shake_n, queued;
#define FADE 16   // frames each way; the web's dissolve takes 560 ms, the area swaps at 260 ms

void fox_anim(uint8_t type, uint8_t from_x, uint8_t from_y, uint8_t frames) { fa.type = type; fa.t = 0; fa.d = frames; fa.fx = from_x; fa.fy = from_y; }
void enemy_anim(uint8_t e, uint8_t type, uint8_t from_cell) { en_anim[e] = type; en_anim_t[e] = 0; en_from[e] = from_cell; }
void block_anim(uint8_t b, uint8_t from_cell) { blk_anim_t[b] = 0; blk_from[b] = from_cell; }
void shake(uint8_t n) { if (n > shake_n) shake_n = n; }
void transition(uint8_t to, uint8_t spawn) { state = S_TRANS; trans_t = 0; trans_to = to; trans_spawn = spawn; queued = 0; }
void game_over(void) { state = S_DEAD; dead_t = 0; sfx_play(SFX_HURT); hud_say("Fang falls... Press A to try again."); }
uint8_t busy(void) {
  if (state == S_TRANS) return 2;
  if (fa.type != A_NONE) return 1;
  for (uint8_t i = 0; i < en_n; i++) if (en_anim[i] != A_NONE) return 1;
  return 0;
}

// ---------- floating numbers: 4 slots, each a 24x16 sprite drawn into VRAM (screen.c) when it appears ----------
uint8_t fl_t[FLOATS], fl_x[FLOATS], fl_y[FLOATS];
static uint8_t fl_next;
char float_text[16];
void float_num(uint8_t x, uint8_t y, const char *text) {
  uint8_t s = fl_next;
  fl_next = (fl_next + 1) & (FLOATS - 1);
  strncpy(float_text, text, sizeof(float_text) - 1); float_text[sizeof(float_text) - 1] = 0;
  float_render(s);
  fl_t[s] = FLOAT_LIFE; fl_x[s] = x; fl_y[s] = y;
}

uint8_t cam_want(int16_t px) {
  int16_t want = px + 8 - 80;
  if (want < 0) want = 0;
  if (want > (AREA_W - 20) * 8) want = (AREA_W - 20) * 8;
  return (uint8_t)want;
}

// ---------- drawing ----------
static void draw(void) {
  static int16_t px, py;
  static uint8_t i, lift, p, left, right, t8, fx, fy, ak, fl, half, bx, by, row, bit, slot, ax, ay, sy, c8;
  static int8_t oy;
  // Fang
  px = fox.x << 4; py = fox.y << 4; lift = 0;
  if (fa.type != A_NONE) {
    p = (fa.t << 3) / fa.d;
    if (fa.type == A_HOP) {
      uint8_t e = ease16[p];
      px = fa.fx << 4; py = fa.fy << 4;
      px += ((int16_t)fox.x - fa.fx) * e; py += ((int16_t)fox.y - fa.fy) * e;
      lift = lift4[p];
    } else if (fa.type == A_BUMP) px += bump2[p];
    else if (fa.type == A_LUNGE) { px += ((int8_t)fa.fx - 1) * (int8_t)lunge6[p]; py += ((int8_t)fa.fy - 1) * (int8_t)lunge6[p]; }
  }
  if (dbg_cam) cam_x = dbg_cam - 1;
  else { uint8_t want = cam_want(px); if (want > cam_x + 3) cam_x += 3; else if (want + 3 < cam_x) cam_x -= 3; else cam_x = want; }
  oy = shake_n ? ((frame_count & 2) ? (int8_t)shake_n : -(int8_t)shake_n) : 0;   // the screen shake, sprites included
  spr_clear();
  t8 = (uint8_t)frame_count;
  spr_put(AK_FOX, fa.type == A_HOP ? 2 : fa.type == A_LUNGE ? 3 : (t8 >> 5) & 1, fox.dir < 0, 0, px + 8 - cam_x, (uint8_t)(py + 16 - lift - oy));
  fx = fox.x; fy = fox.y; left = right = 0;
  // enemies
  for (i = 0; i < en_n; i++) {
    if (en_state[i] & EN_DEAD) continue;
    ak = type_ak[en_type[i]]; if (ak == NONE) continue;
    fl = kinds_rt[ak].flags; half = kinds_rt[ak].cols << 2; row = en_y[i]; bit = 1 << row;
    if ((fl & KF_CAMO) && !(en_state[i] & EN_REVEALED)) continue;   // a tree in the background (cells.c)
    if (!fog_clear && tiles[row14[row] + en_x[i]] == 'o') {   // js hiddenAt: fog hides what's more than a step away
      ax = en_x[i] > fox.x ? en_x[i] - fox.x : fox.x - en_x[i]; ay = row > fox.y ? row - fox.y : fox.y - row;
      if (ax + ay > 1) continue;
    }
    bx = (en_x[i] << 4) + 8; by = (row << 4) + 16;
    if (en_anim[i] != A_NONE) {   // walking from en_from, or lunging toward Fang
      if (en_anim[i] == A_MOVE) {
        p = (en_anim_t[i] << 3) / EN_MOVE_FRAMES;
        uint8_t ox = (cell_col[en_from[i]] << 4) + 8, oyy = (cell_row[en_from[i]] << 4) + 16, e = ease16[p];
        bx = ox + (uint8_t)((((int16_t)bx - ox) * e) >> 4); by = oyy + (uint8_t)((((int16_t)by - oyy) * e) >> 4) - lift2[p];
      } else {
        p = (en_anim_t[i] << 3) / EN_LUNGE_FRAMES;
        int8_t dx = (int8_t)(en_from[i] & 3) - 1, dy = (int8_t)(en_from[i] >> 2) - 1;
        bx += dx * (int8_t)lunge6[p]; by += dy * (int8_t)lunge6[p];
      }
    }
    if (bx + half <= cam_x) { if (!(left & bit)) { left |= bit; spr_put(AK_MARKER, 0, 0, 3, 4, (row << 4) + 16); } continue; }
    if (bx >= cam_x + 160 + half) { if (!(right & bit)) { right |= bit; spr_put(AK_MARKER, 0, 1, 3, 156, (row << 4) + 16); } continue; }
    if (en_flash[i] & 2) continue;   // hit: blink
    if (fl & KF_FLIES) { uint8_t b = (uint8_t)(t8 + (i << 4)) >> 4 & 3; by -= b == 3 ? 1 : b; }
    ax = en_x[i] > fx ? en_x[i] - fx : fx - en_x[i]; ay = row > fy ? row - fy : fy - row;
    slot = spr_slot((fl & KF_BOSS) || ax + ay == 1 ? 1 : 2);
    if (slot == 0xFF) break;
    spr_kind[slot] = ak;
    spr_frame[slot] = en_frozen[i] ? 0 : (fl & KF_FAST) ? ((uint8_t)(t8 + (i << 3)) >> 3) & 1 : ((uint8_t)(t8 + (i << 3)) >> 5) & 1;
    spr_flip[slot] = fx < en_x[i];
    spr_x[slot] = bx - cam_x + 8; sy = by - oy; spr_y[slot] = sy + 16;
    { uint8_t r = (uint8_t)(sy - 1) >> 4, w = half >> 2;
      if ((spr_row[r] += w) > 10) spr_over = 1;
      if ((fl & KF_TALL) && r && (spr_row[r - 1] += w) > 10) spr_over = 1; }
  }
  // blocks, sliding when pushed
  for (i = 0; i < blk_n; i++) {
    if (blk_x[i] == NONE || area_block_ak == NONE) continue;
    bx = (blk_x[i] << 4) + 8; by = (blk_y[i] << 4) + 16;
    if (blk_anim_t[i] < BLOCK_FRAMES) {
      p = blk_anim_t[i];   // BLOCK_FRAMES is 8: the step is the frame
      uint8_t ox = (cell_col[blk_from[i]] << 4) + 8, oyy = (cell_row[blk_from[i]] << 4) + 16, e = ease16[p];
      bx = ox + (uint8_t)((((int16_t)bx - ox) * e) >> 4); by = oyy + (uint8_t)((((int16_t)by - oyy) * e) >> 4);
    }
    half = kinds_rt[area_block_ak].cols << 2;
    if (bx + half <= cam_x || bx >= cam_x + 160 + half) continue;
    slot = spr_slot(2);
    if (slot == 0xFF) break;
    spr_kind[slot] = area_block_ak; spr_frame[slot] = 0; spr_flip[slot] = 0;
    spr_x[slot] = bx - cam_x + 8; sy = by - oy; spr_y[slot] = sy + 16;
    { uint8_t r = (uint8_t)(sy - 1) >> 4; if ((spr_row[r] += half >> 2) > 10) spr_over = 1; }
  }
  // flames on lit braziers (view.js: the last 3 turns of a timed one flicker)
  for (i = 0; i < brz_n; i++) {
    if (!lit_t[i] || (lit_t[i] <= 3 && flick) || area_flame_ak == NONE) continue;
    c8 = brz_cell[i]; bx = (cell_col[c8] << 4) + 8;
    if (bx + 8 <= cam_x || bx >= cam_x + 168) continue;
    p = flame_f + brz_phase[i]; if (p >= 3) p -= 3;
    slot = spr_slot(2);
    if (slot == 0xFF) break;
    spr_kind[slot] = area_flame_ak; spr_frame[slot] = p; spr_flip[slot] = 0;
    spr_x[slot] = bx - cam_x + 8; sy = (cell_row[c8] << 4) + 12 - oy; spr_y[slot] = sy + 16;
    { uint8_t r = (uint8_t)(sy - 1) >> 4; if ((spr_row[r] += 2) > 10) spr_over = 1; }
  }
  dbg_ly[4] = LY_REG;   // after the foes, blocks and flames
  // friends and items: lookups for the cell's column and row (no dividing by 14), written straight into the list
  for (i = 0; i < npc_n + item_n; i++) {
    uint8_t c, prio;
    if (i < npc_n) { ak = npc_ak[i]; c = npc_y[i]; bx = (npc_x[i] << 4) + 8; by = (c << 4) + 16; prio = 2; p = ((uint8_t)(t8 + (i << 4)) >> 5) & 1; bit = fx < npc_x[i]; }
    else {
      uint8_t k = i - npc_n;
      if (!item_code[k]) continue;
      ak = item_ak[item_code[k]]; if (ak == NONE) continue;
      c = item_cell[k];
      if (!fog_clear && tiles[c] == 'o') {
        ax = cell_col[c] > fx ? cell_col[c] - fx : fx - cell_col[c]; ay = cell_row[c] > fy ? cell_row[c] - fy : fy - cell_row[c];
        if (ax + ay > 1) continue;
      } bx = (cell_col[c] << 4) + 8; c = cell_row[c]; by = (c << 4) + 16; prio = 3; p = 0; bit = 0;
      if ((kinds_rt[ak].flags & KF_BOB) && ((uint8_t)(t8 + (k << 3)) & 32)) by--;
    }
    half = kinds_rt[ak].cols << 2;
    if (bx + half <= cam_x || bx >= cam_x + 160 + half) continue;
    slot = spr_slot(prio);
    if (slot == 0xFF) break;
    spr_kind[slot] = ak; spr_frame[slot] = p; spr_flip[slot] = bit;
    spr_x[slot] = bx - cam_x + 8; sy = by - oy; spr_y[slot] = sy + 16;
    { uint8_t r = (uint8_t)(sy - 1) >> 4; if ((spr_row[r] += half >> 2) > 10) spr_over = 1; }
  }
  dbg_ly[5] = LY_REG;   // after friends and items
  // floating numbers rise for 40 frames above their cell
  for (i = 0; i < FLOATS; i++) if (fl_t[i]) {
    fl_t[i]--;
    spr_put(AK_FLOAT, i, 0, 0, (int16_t)(fl_x[i] << 4) + 8 - cam_x, (fl_y[i] << 4) + 6 - ((FLOAT_LIFE - fl_t[i]) >> 2));
  }
  dbg_ly[6] = LY_REG;   // before the flush
  spr_flush();
  dbg_ly[7] = LY_REG;
  scroll_y = state == S_OVERVIEW ? 128 : (uint8_t)oy;
}

// ---------- one frame ----------
static int8_t dir_dx(uint8_t j) { return (j & J_RIGHT) ? 1 : (j & J_LEFT) ? -1 : 0; }
static int8_t dir_dy(uint8_t j) { return (j & J_DOWN) ? 1 : (j & J_UP) ? -1 : 0; }

void game_frame(uint8_t held, uint8_t pressed) {
  uint8_t i;
  frame_count++;
  sfx_frame();
  if (fa.type != A_NONE && ++fa.t >= fa.d) fa.type = A_NONE;
  for (i = 0; i < en_n; i++) {
    if (en_anim[i] != A_NONE && ++en_anim_t[i] >= (en_anim[i] == A_MOVE ? EN_MOVE_FRAMES : EN_LUNGE_FRAMES)) en_anim[i] = A_NONE;
    if (en_flash[i]) en_flash[i]--;
  }
  for (i = 0; i < blk_n; i++) if (blk_anim_t[i] < BLOCK_FRAMES) blk_anim_t[i]++;
  if (shake_n && !(frame_count & 3)) shake_n--;
  if (story_n && story_t[0]) story_t[0]--;   // js runStory: the queued beat's wait runs down in every mode
  if (state == S_TALK || state == S_PERK) {   // the dialogue box or the perk pick; the world keeps drawing above it
    if (state == S_TALK) dlg_frame(pressed); else perk_frame(pressed);
    queued = 0;
    if (state != S_TALK && state != S_PERK) cells_refresh();   // True Sight, Keen Eyes, Pathfinder...
    hud_frame(); draw(); return;
  }
  if (state == S_SHOP) { shop_frame(pressed); queued = 0; hud_frame(); draw(); return; }
  if (state == S_TITLE) {
    uint8_t c = title_frame(pressed);
    if (c == 1 && load_game()) { skip_leave = 1; transition(load_area, fox.y * COLS + fox.x); hud_say("Welcome back, Fang!"); show_objective(); }
    else if (c) start_intro();   // a new game: Forest Home is fresh already
    hud_frame(); draw(); return;
  }
  if (state == S_OVERVIEW) {
    if (held & J_SELECT) return;
    state = S_PLAY; scroll_y = 0; LCDC_REG |= LCDCF_OBJON;
  }
  if (state == S_TRANS) {
    trans_t++;
    if (trans_t <= FADE) pal_level = FADE - trans_t;
    if (trans_t == FADE) enter(trans_to, trans_spawn);
    if (trans_t > FADE) pal_level = trans_t - FADE;
    pal_dirty = 1;
    if (trans_t == FADE * 2) state = S_PLAY;
  } else if (state == S_DEAD) {
    if (dead_t < 255) dead_t++;
    if (dead_t > 36 && (pressed & (J_A | J_START))) { state = S_PLAY; respawn(); }
  } else if (dbg_goto) { transition(dbg_goto - 1, NONE); dbg_goto = 0; }
  else if (pressed & J_START) transition(area_idx + 1 == AREA_COUNT ? 0 : area_idx + 1, NONE);   // debug until the pause menu exists
  else if ((pressed & J_SELECT) && !busy()) {
    state = S_OVERVIEW; overview_draw();
    LCDC_REG &= ~LCDCF_OBJON; scroll_y = 128; cam_x = 0;
    return;
  } else {
    // one action at a time: a press during an animation plays right after it (js input/queued)
    uint8_t acts = pressed & (J_UP | J_DOWN | J_LEFT | J_RIGHT | J_A | J_B);
    if (acts && busy()) queued = acts;
    if (!busy()) {
      uint8_t j = queued ? queued : (held & (J_UP | J_DOWN | J_LEFT | J_RIGHT)) | (pressed & (J_A | J_B));   // A and B act once per press
      queued = 0;
      uint8_t acted = 1;
      if (j & J_B) eat_fish();
      else if (j & J_A) fire_spin();
      else {
        int8_t dx = dir_dx(j), dy = dx ? 0 : dir_dy(j);
        if (dx || dy) do_action(dx, dy); else acted = 0;
      }
      // an action with no animation (asleep, tangled, a fish) still takes a step's time, so a held
      // direction can't fire twice in two frames
      if (acted && fa.type == A_NONE && state == S_PLAY) fox_anim(A_REST, 0, 0, 7);
      if (pending_perks && state == S_PLAY && !busy()) offer_perks();   // js tick: perks earned outside a turn (Hoot's lessons)
      run_story();   // then a story beat, once play is calm
      if (acted && state != S_TRANS) {   // the world on screen catches up with the rules
        uint8_t l0 = LY_REG; cells_refresh(); l0 = LY_REG >= l0 ? LY_REG - l0 : LY_REG + 154 - l0;
        if (l0 > dbg_refresh) dbg_refresh = l0;
      }
    }
  }
  dbg_ly[3] = LY_REG;   // after input and the rules
  hud_frame();
  draw();
}
