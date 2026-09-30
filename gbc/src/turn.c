// The rules, part 3 (see logic.c): the enemies' turn (js enemyAct, canEnter, breathe) and endTurn.
#pragma bank 255
#include "rules.h"

// ---------- Turns & enemies ----------
static uint8_t can_enter(uint8_t e, int8_t x, int8_t y) {
  if (!in_grid(x, y)) return 0;
  uint8_t ch = tile_at(x, y); uint16_t f = mon(e)->flags;
  if (is_solid(ch) || ch == 'd' || ch == 'D') return 0;
  if (ch == 'l' && !(f & MF_LAVAWALK)) return 0;
  if (ch == 'u' && !(f & MF_FLIES)) return 0;
  if (occupied(x, y) || item_at(idx(x, y))) return 0;
  return 1;
}
static void enemy_act(uint8_t e) {
  const monster_t *m = mon(e);
  uint16_t f = m->flags;
  if (en_frozen[e]) { en_frozen[e]--; return; }
  if ((f & MF_DORMANT) && !(en_state[e] & EN_AGGRO)) return;
  en_acts[e]++;
  uint8_t ex = en_x[e], ey = en_y[e], dist = adist(ex, fox.x) + adist(ey, fox.y);
  if ((f & MF_CAMO) && !(en_state[e] & EN_REVEALED)) { if (dist <= 1) { en_state[e] |= EN_REVEALED; hud_say("A tree lurches to life... a Treant!"); } else return; }
  if (m->healer) for (uint8_t d = 0; d < 4; d++) {
    uint8_t n = enemy_at(ex + DX[d], ey + DY[d]);
    if (n && en_hp[n - 1] < (int16_t)mon(n - 1)->hp) { n--; en_hp[n] += m->healer; if (en_hp[n] > (int16_t)mon(n)->hp) en_hp[n] = mon(n)->hp; num_float(en_x[n], en_y[n], "+", m->healer, ""); }
  }
  if (m->spawn_every && en_acts[e] % m->spawn_every == 0) { summon(e, m->summon, 1); hud_say("The Goo King burps up a Slim!"); }
  if ((f & MF_ROOTSNARE) && dist <= 3 && en_acts[e] % 3 == 0 && !HAS_PERK(P_NATUREBOND)) { b_rooted = 1; hud_say("Rotten roots burst up and hold you fast!"); }
  if (en_type[e] == MT_COLOSSUS) for (uint8_t k = 0; k < 3; k++) {
    int8_t x = ex + (int8_t)rng_below(7) - 3, y = ey + (int8_t)rng_below(5) - 2;
    if (in_grid(x, y) && tiles[idx(x, y)] == '_' && !item_at(idx(x, y)) && !occupied(x, y)) { set_tile(idx(x, y), 'i'); break; }
  }
  if ((f & MF_BREATH) && !tele_n && (ex == fox.x || ey == fox.y) && dist <= 6 && dist > 1) {
    int8_t dx = (fox.x > ex) - (fox.x < ex), dy = (fox.y > ey) - (fox.y < ey);
    for (uint8_t k = 1; k <= 6; k++) { int8_t x = ex + dx * k, y = ey + dy * k; if (!in_grid(x, y) || is_solid(tile_at(x, y))) break; tele_x[tele_n] = x; tele_y[tele_n++] = y; }
    tele_fire_on = turn + 1; hud_say("The Dragon draws a deep breath... MOVE!"); sfx_play(SFX_ROAR); return;
  }
  if (dist == 1) { if (en_hit_t[e] != turn) enemy_strike(e, 0); return; }
  if ((f & MF_CHARGE) && (ex == fox.x || ey == fox.y) && dist <= 4) {
    int8_t dx = (fox.x > ex) - (fox.x < ex), dy = (fox.y > ey) - (fox.y < ey), x = ex, y = ey;
    uint8_t ok = 1;
    while (adist(fox.x, x) + adist(fox.y, y) > 1) { x += dx; y += dy; if (!can_enter(e, x, y)) { ok = 0; break; } }
    if (ok) { enemy_anim(e, A_MOVE, idx(ex, ey)); en_x[e] = x; en_y[e] = y; hud_say("The Frost Bear charges!"); sfx_play(SFX_ROAR); enemy_strike(e, 1); return; }
  }
  // walk: the open neighbour closest to Fang, each distance plus a random half (js: + Math.random() * 0.5)
  for (uint8_t s = 0; s < m->steps; s++) {
    uint8_t d0 = adist(en_x[e], fox.x) + adist(en_y[e], fox.y);
    if (d0 <= 1) break;
    uint8_t best = 0xFF, bx = 0, by = 0, bd = 0; uint32_t bkey = 0xFFFFFFFF;
    for (uint8_t d = 0; d < 4; d++) {
      int8_t x = en_x[e] + DX[d], y = en_y[e] + DY[d];
      if (!can_enter(e, x, y)) continue;
      uint8_t dd = adist(x, fox.x) + adist(y, fox.y);
      uint32_t r = rng_next(), key = ((uint32_t)dd << 26) + (r >> 7);   // dd + r / 2^33, as a 32-bit number
      if (key < bkey) { bkey = key; best = d; bx = x; by = y; bd = dd; }
    }
    if (best == 0xFF) break;
    if ((bd > d0 || (bd == d0 && (bkey & 0x3FFFFFF))) && CHANCE(P_60)) break;   // d > d0 counts the random half
    uint8_t ox = en_x[e], oy = en_y[e];
    if (!s || en_anim[e] != A_MOVE) enemy_anim(e, A_MOVE, idx(ox, oy));
    en_x[e] = bx; en_y[e] = by;
    if (m->trail) {
      uint8_t oi = idx(ox, oy);
      if (m->trail == 'i' && tiles[oi] == '_') set_tile(oi, 'i');
      if (m->trail == 'l' && tiles[oi] == '_') { set_tile(oi, 'l'); add_temp(oi, '_', 5); }
    }
  }
}
static void breathe(void) {
  uint8_t dealt;
  sfx_play(SFX_BOOM); shake(5);
  for (uint8_t k = 0; k < tele_n; k++) if (tele_x[k] == fox.x && tele_y[k] == fox.y) hurt_fox(HAS_FLAG(F_SCALE) ? 0 : HAS_PERK(P_HEATRESIST) ? 7 : 14, &dealt);
  tele_n = 0;
}
void end_turn(void) BANKED {
  uint8_t dealt, i;
  turn++;
  uint8_t under = item_at(idx(fox.x, fox.y));
  if (under && item_code[under - 1] != IT_CHEST_LOCKED) pickup(under - 1);
  if (HAS_PERK(P_REGENERATION) && !(turn & 3) && fox.hp < (int16_t)fox.max_hp) fox.hp++;
  if (b_poison) { b_poison--; fox.hp -= 2; float_num(fox.x, fox.y, "-2"); if (fox.hp <= 0) { fox.hp = 0; hud_stats(); game_over(); return; } }
  if (b_mushroom) b_mushroom--;
  if (b_haste) b_haste--;
  if (b_ward) b_ward--;
  if (b_spin_cd) b_spin_cd--;
  for (i = 0; i < temp_n; ) {
    if (--temp_t[i]) { i++; continue; }
    set_tile(temp_cell[i], temp_orig[i]);
    if (temp_orig[i] == 'u') hud_say("The path knits itself back together.");
    temp_n--; temp_cell[i] = temp_cell[temp_n]; temp_orig[i] = temp_orig[temp_n]; temp_t[i] = temp_t[temp_n];
  }
  // timed braziers gutter out
  if (!area_solved) for (i = 0; i < brz_n; i++) if (lit_t[i] && lit_t[i] != LIT_FOREVER && !--lit_t[i]) { hud_say("A brazier gutters out!"); sfx_play(SFX_LOCKED); }
  if (turn % 3 == 0) for (i = 0; i < CELLS; i++) if (tiles[i] == 'v') {
    uint8_t x = i % COLS, y = i / COLS;
    if (adist(x, fox.x) + adist(y, fox.y) <= 1) hurt_fox(HAS_PERK(P_HEATRESIST) ? 4 : 8, &dealt);
  }
  if (fox.hp <= 0) return;
  for (i = 0; i < en_n; i++) if ((en_state[i] & (EN_DEAD | EN_GONE)) == EN_DEAD && en_revive_in[i] != NONE) {
    if (--en_revive_in[i]) continue;
    if (occupied(en_x[i], en_y[i])) { en_revive_in[i] = 1; continue; }
    en_state[i] &= ~EN_DEAD; en_hp[i] = (mon(i)->hp + 1) >> 1; en_revive_in[i] = NONE;
    hud_say("The skeleton pulls itself back together!");
  }
  uint8_t base = HAS_PERK(P_SWIFTFEET) ? 4 : 3; if (b_haste) base <<= 1;
  uint8_t n0 = en_n;
  in_enemy_loop = 1;
  for (i = 0; i < n0; i++) {
    if ((en_state[i] & (EN_DEAD | EN_NEW)) || fox.hp <= 0) continue;
    const monster_t *m = mon(i);
    uint8_t iv = m->interval ? (b_haste ? m->interval << 1 : m->interval) : base;
    if (m->flags & MF_BOSS) iv = base - 1;   // js max(2, base - 1): base is at least 3
    if (turn % iv == 0) enemy_act(i);
  }
  in_enemy_loop = 0;
  for (i = 0; i < en_n; i++) en_state[i] &= ~EN_NEW;
  if (tele_n && tele_fire_on == turn) breathe();
  if (turn % 5 == 0) save_game();
  if (pending_perks && game_state == S_PLAY) offer_perks();
  hud_stats();
}
