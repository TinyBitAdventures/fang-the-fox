// The rules, part 2 (see logic.c): attacks, damage, kills and drops, bosses, experience, hurting Fang.
#pragma bank 255
#include "rules.h"

void boss_hud(void) BANKED {   // the lower HUD row shows a living boss's health
  for (uint8_t i = 0; i < en_n; i++) if (!(en_state[i] & EN_DEAD) && (monsters[en_type[i]].flags & MF_BOSS)) { hud_boss(i, monsters[en_type[i]].name, monsters[en_type[i]].hp); return; }
  hud_boss(NONE, 0, 0);
}
uint16_t calc_damage(uint8_t *crit) BANKED {
  uint16_t dmg = fox.atk;
  if (b_mushroom) dmg += 5;
  if (HAS_PERK(P_FURY) && fox.hp * 10 <= (int16_t)(fox.max_hp * 3)) dmg += 3;
  *crit = 0; if (HAS_PERK(P_CRITICALSTRIKE) && CHANCE(P_20)) { dmg <<= 1; *crit = 1; }
  return dmg;
}
void attack(uint8_t e, int8_t dx, int8_t dy) BANKED {
  const monster_t *m = mon(e);
  uint8_t crit;
  fox_anim(A_LUNGE, dx + 1, dy + 1, 10);
  if ((m->flags & MF_CAMO) && !(en_state[e] & EN_REVEALED)) { en_state[e] |= EN_REVEALED; hud_say("The tree opens its eyes... a Treant!"); }
  if (m->flags & MF_DORMANT) en_state[e] |= EN_AGGRO;
  uint16_t dmg = calc_damage(&crit);
  if (m->flags & MF_ARMORED) { dmg >>= 1; if (!dmg) dmg = 1; }
  sfx_play(crit ? SFX_CRIT : SFX_ATTACK);
  if (crit) shake(3);
  uint8_t killed = damage_enemy(e, dmg, crit);
  if (HAS_PERK(P_FLAMEBURST)) for (uint8_t d = 0; d < 4; d++) { uint8_t n = enemy_at(en_x[e] + DX[d], en_y[e] + DY[d]); if (n) { uint16_t h = dmg >> 1; damage_enemy(n - 1, h ? h : 1, 0); } }
  if (!killed && !(en_state[e] & EN_DEAD)) {
    if (HAS_PERK(P_FROSTTOUCH) && CHANCE(P_20)) { en_frozen[e] = 2; sfx_play(SFX_FREEZE); float_num(en_x[e], en_y[e], "FROZEN"); }
    else if (!en_frozen[e]) { en_hit_t[e] = turn; enemy_strike(e, 1); }
    if (fox.hp > 0) {
      m_clear(); if (crit) m_s("Critical! "); m_s(m->name); m_s(" takes "); m_u(dmg); m_s(". (");
      m_u(en_hp[e] > 0 ? en_hp[e] : 0); m_s("/"); m_u(m->hp); m_s(")"); hud_say(msg);
    }
  }
}
static void boss_check(uint8_t e);
static void kill_enemy(uint8_t e);
uint8_t damage_enemy(uint8_t e, uint16_t dmg, uint8_t crit) BANKED {
  en_hp[e] -= dmg; en_flash[e] = 9;
  num_float(en_x[e], en_y[e], "", dmg, crit ? "!" : "");
  if (mon(e)->flags & MF_BOSS) { boss_check(e); boss_hud(); }
  if (en_hp[e] <= 0 && !(en_state[e] & EN_DEAD)) { kill_enemy(e); return 1; }
  return 0;
}
// open cells around a spot, shuffled (the web sorts them randomly; this is its own shuffle)
static uint8_t free_spots_near(uint8_t x, uint8_t y, uint8_t r) {
  uint8_t n = 0;
  for (int8_t oy = -r; oy <= (int8_t)r; oy++) for (int8_t ox = -r; ox <= (int8_t)r; ox++) {
    int8_t X = x + ox, Y = y + oy;
    if ((ox || oy) && in_grid(X, Y) && tiles[idx(X, Y)] == '_' && !occupied(X, Y) && !item_at(idx(X, Y))) { spot_x[n] = X; spot_y[n++] = Y; }
  }
  for (uint8_t i = n; i > 1; i--) { uint8_t j = rng_below(i), tx = spot_x[i - 1], ty = spot_y[i - 1]; spot_x[i - 1] = spot_x[j]; spot_y[i - 1] = spot_y[j]; spot_x[j] = tx; spot_y[j] = ty; }
  return n;
}
// nearest open cells around a spot for boss drops (breadth first, like the web's dropSpots)
static uint8_t drop_spots(uint8_t x, uint8_t y, uint8_t include_self) {
  static uint8_t seen[CELLS], q[CELLS];
  uint8_t head = 0, tail = 0, n = 0;
  memset(seen, 0, sizeof(seen));
  seen[idx(x, y)] = 1; q[tail++] = idx(x, y);
  if (include_self) { spot_x[n] = x; spot_y[n++] = y; }
  while (head < tail && n < 6) {
    uint8_t c = q[head++], cx = c % COLS, cy = c / COLS;
    for (uint8_t d = 0; d < 4; d++) {
      int8_t nx = cx + DX[d], ny = cy + DY[d];
      if (!in_grid(nx, ny)) continue;
      uint8_t i = idx(nx, ny), ch = tiles[i];
      if (seen[i]) continue; seen[i] = 1;
      if (is_solid(ch) || ch == 'd' || ch == 'D') continue;
      q[tail++] = i;
      if (!item_at(i) && !occupied(nx, ny) && ch != 'l' && ch != 'v' && n < 6) { spot_x[n] = nx; spot_y[n++] = ny; }
    }
  }
  return n;
}
static uint8_t make_enemy(uint8_t type, uint8_t x, uint8_t y, uint8_t minion) {
  uint8_t e = 0xFF;
  for (uint8_t i = 0; i < en_n; i++) if (en_state[i] & EN_GONE) { e = i; break; }
  if (e == 0xFF) { if (en_n == MAX_ENEMIES) return 0xFF; e = en_n++; }
  en_type[e] = type; en_x[e] = x; en_y[e] = y; en_hp[e] = monsters[type].hp; en_frozen[e] = 0;
  en_state[e] = (minion ? EN_MINION : 0) | (in_enemy_loop ? EN_NEW : 0); en_phase[e] = 1; en_revive[e] = (monsters[type].flags & MF_REVIVES) ? 1 : 0;
  en_revive_in[e] = NONE; en_acts[e] = 0; en_hit_t[e] = 0xFFFF; en_anim[e] = A_NONE; en_flash[e] = 0;
  return e;
}
void summon(uint8_t boss, uint8_t type, uint8_t n) BANKED {
  uint8_t alive = 0;
  for (uint8_t i = 0; i < en_n; i++) if (!(en_state[i] & EN_DEAD) && (en_state[i] & EN_MINION)) alive++;
  if (alive >= MINION_CAP) return;
  uint8_t k = free_spots_near(en_x[boss], en_y[boss], 2);
  if (n > MINION_CAP - alive) n = MINION_CAP - alive;
  for (uint8_t i = 0; i < k && i < n; i++) make_enemy(type, spot_x[i], spot_y[i], 1);
}
static void teleport(uint8_t e) {
  static uint8_t cells[CELLS];
  uint8_t n = 0;
  for (uint8_t y = 1; y < ROWS - 1; y++) for (uint8_t x = 3; x < COLS - 1; x++)
    if (tiles[idx(x, y)] == '_' && !occupied(x, y) && adist(x, fox.x) + adist(y, fox.y) > 3) cells[n++] = idx(x, y);
  if (!n) return;
  uint8_t c = cells[rng_below(n)];
  en_x[e] = c % COLS; en_y[e] = c / COLS; en_anim[e] = A_NONE;
}
static void boss_check(uint8_t e) {
  const monster_t *m = mon(e);
  int16_t hp = en_hp[e]; uint16_t max = m->hp;
  if (m->phases) {
    uint8_t phase = (uint32_t)hp * 100 <= (uint32_t)max * 33 ? 3 : (uint32_t)hp * 100 <= (uint32_t)max * 66 ? 2 : 1;
    if (hp <= 0) phase = 3;
    if (phase > en_phase[e]) {
      en_phase[e] = phase; summon(e, m->summon, 2);
      m_clear(); m_s("The Primordial shifts! Phase "); m_u(phase); m_s("."); hud_say(msg);
      sfx_play(SFX_ROAR); shake(6); teleport(e);
    }
  } else if (m->summon != NONE && !(en_state[e] & EN_SUMMONED) && hp * 2 <= (int16_t)max) {
    en_state[e] |= EN_SUMMONED; summon(e, m->summon, 3);
    m_clear(); m_s(m->name); m_s(" calls for help!"); hud_say(msg); sfx_play(SFX_ROAR); shake(5);
  }
  if (en_type[e] == MT_DRAGON && hp * 4 <= (int16_t)max && !(en_state[e] & EN_ERUPTED)) {
    en_state[e] |= EN_ERUPTED;
    uint8_t n = 0;
    for (uint8_t k = 0; k < 60 && n < 6; k++) {
      uint8_t x = rng_below(COLS), y = rng_below(ROWS);
      if (tiles[idx(x, y)] == '_' && !occupied(x, y) && !item_at(idx(x, y))) { set_tile(idx(x, y), 'l'); n++; }
    }
    hud_say("The Dragon erupts! Lava spills across the forge!"); sfx_play(SFX_BOOM); shake(6);
  }
}
void apply_when_doors(void) BANKED {
  for (uint8_t k = 0; k < door_n; k++) if (doors[k].when) {
    uint8_t i = doors[k].cell;
    set_tile(i, HAS_FLAG(when_flag[doors[k].when]) ? 'd' : (orig[i] == 'd' ? '_' : orig[i]));
  }
}
static void kill_enemy(uint8_t e) {
  const monster_t *m = mon(e);
  uint8_t dealt;
  if (en_revive[e]) {
    en_revive[e]--; en_state[e] |= EN_DEAD; en_revive_in[e] = 4; sfx_play(SFX_KILL);
    hud_say("The skeleton crumbles... but the bones are twitching."); gain_xp(m->xp >> 1); return;
  }
  en_state[e] |= EN_DEAD | EN_GONE; kills++;
  sfx_play(SFX_KILL);
  gain_xp(m->xp);
  if (m->flags & MF_SHATTER) {
    for (uint8_t d = 0; d < 4; d++) { int8_t x = en_x[e] + DX[d], y = en_y[e] + DY[d]; if (in_grid(x, y) && tiles[idx(x, y)] == '_' && !occupied(x, y)) set_tile(idx(x, y), 'i'); }
    sfx_play(SFX_FREEZE);
  }
  if (m->flags & MF_EXPLODES) {
    sfx_play(SFX_BOOM); shake(4);
    if (adist(en_x[e], fox.x) <= 1 && adist(en_y[e], fox.y) <= 1) hurt_fox(10, &dealt);
  }
  if (m->flags & MF_SPLITS) {
    uint8_t k = free_spots_near(en_x[e], en_y[e], 1);
    for (uint8_t i = 0; i < k && i < 2; i++) make_enemy(MT_SLIM, spot_x[i], spot_y[i], 1);
    hud_say("The Shadow Slim splits apart!");
  }
  if (!(m->flags & MF_BOSS) && !(en_state[e] & EN_MINION) && !has_plates() && CHANCE(P_08)) {
    uint8_t i = idx(en_x[e], en_y[e]);
    if (!item_at(i) && tiles[i] == '_') add_item(IT_FISH, i);
  }
  if (m->flags & MF_BOSS) {
    area_boss_down = 1; shake(8); sfx_play(SFX_ROAR);
    for (uint8_t o = 0; o < en_n; o++) if (!(en_state[o] & EN_DEAD) && (en_state[o] & EN_MINION)) en_state[o] |= EN_DEAD | EN_GONE;
    if (m->boss_flag != NONE) SET_FLAG(m->boss_flag);
    apply_when_doors();   // open any portal first so drops never land on it
    uint8_t here = tiles[idx(en_x[e], en_y[e])];
    uint8_t n = drop_spots(en_x[e], en_y[e], here != 'd' && here != 'D');
    for (uint8_t d = 0; d < 2 && m->drop[d]; d++) if (d < n) add_item(m->drop[d], idx(spot_x[d], spot_y[d]));
    // the web game queues the boss's story scene or the ending here (phases 4 and 5)
    m_clear(); m_s(m->name); m_s(" is defeated!"); hud_say(msg);
    boss_hud();
  }
}
void gain_xp(uint16_t n) BANKED {
  fox.xp += n;
  while (fox.xp >= fox.next) {
    fox.xp -= fox.next; fox.lvl++; fox.next = (uint16_t)((uint32_t)fox.next * 135 / 100);   // floor(next * 1.35)
    fox.max_hp += 10; fox.atk += 2;
    fox.hp += 10 + fox.max_hp * 3 / 10; if (fox.hp > (int16_t)fox.max_hp) fox.hp = fox.max_hp;
    pending_perks++; sfx_play(SFX_LEVEL);
    m_clear(); m_s("Level up! Fang is now level "); m_u(fox.lvl); m_s("."); hud_say(msg);
  }
  hud_stats();
}

void hurt_fox(uint8_t amount, uint8_t *dealt) BANKED {
  *dealt = 0;
  if (b_barrier) { b_barrier--; float_num(fox.x, fox.y, "BLOCK"); sfx_play(SFX_FREEZE); return; }
  uint8_t dmg = amount; if (HAS_PERK(P_THICKFUR) && dmg > 1) dmg--;
  fox.hp -= dmg; shake(dmg >= 10 ? 4 : 2); sfx_play(SFX_HURT); num_float(fox.x, fox.y, "-", dmg, "");
  if (fox.hp <= 0) {
    if (HAS_PERK(P_SECONDWIND) && !b_second_wind) { b_second_wind = 1; fox.hp = 1; hud_say("Second Wind! Fang refuses to fall!"); sfx_play(SFX_LEVEL); }
    else { fox.hp = 0; game_over(); }
  }
  hud_stats();
  *dealt = dmg;
}
void enemy_strike(uint8_t e, uint8_t counter) BANKED {
  const monster_t *m = mon(e);
  uint8_t atk = m->atk, dealt;
  if (m->phases) atk += (en_phase[e] - 1) * 3;
  en_anim[e] = A_LUNGE; en_anim_t[e] = 0; en_from[e] = ((fox.x > en_x[e]) - (fox.x < en_x[e]) + 1) | (((fox.y > en_y[e]) - (fox.y < en_y[e]) + 1) << 2);
  hurt_fox(atk, &dealt);
  if (fox.hp <= 0) return;
  if (m->poison && dealt && !b_ward) { b_poison = m->poison; m_clear(); m_s("The "); m_s(m->name); m_s(" poisons you!"); hud_say(msg); }
  else if ((m->flags & MF_SLEEPER) && dealt && CHANCE(P_30)) { b_sleep = 1; hud_say("Dream dust... Fang grows sleepy."); }
  else if (!counter) { m_clear(); m_s(m->name); m_s(" attacks! -"); m_u(dealt); hud_say(msg); }
}