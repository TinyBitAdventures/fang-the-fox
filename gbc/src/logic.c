// The rules, part 1: a port of js/game.js, function for function (doAction = do_action, ...), in the
// same order and drawing random numbers at the same moments, so tools/parity.js can play both
// versions side by side. This part: the player's actions, items, hazards, areas, death, a new game.
// combat.c has attacks, damage and bosses; turn.c the enemies' turn. Not here yet: puzzles and tile
// puzzle.c has the puzzles; story.c the talking, signs, the shop, perk picks and the story.
#pragma bank 255
#include "rules.h"

// ---------- G ----------
fox_t fox;
uint16_t turn, kills, perks;
uint8_t fish, keys, gems, embers, pending_perks, relic_n, kits_rescued;
uint8_t relics[(RELIC_COUNT + 7) / 8], flags[(FLAG_COUNT + 7) / 8], visited[(AREA_COUNT + 7) / 8];
uint8_t b_mushroom, b_poison, b_ward, b_barrier, b_haste, b_sleep, b_rooted, b_spin_cd, b_second_wind, b_true_sight;
uint8_t tele_n, tele_x[6], tele_y[6];
uint16_t tele_fire_on;
uint8_t in_enemy_loop, spot_x[24], spot_y[24];

// ---------- Fox actions (bump, move_fox and crumble_behind are in rules.h) ----------
void try_door(uint8_t i, uint8_t nx, uint8_t ny) BANKED {
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
    sfx_play(SFX_LOCKED);
    return;
  }
  move_fox(nx, ny); sfx_play(SFX_DOOR); hud_say(d->name);
  transition(d->to, d->spawn);
}

// ---------- Items ----------
void pickup(uint8_t it) BANKED {
  uint8_t code = item_code[it];
  item_code[it] = 0;
  if (item_info[code].ember) {
    embers |= 1 << (code - IT_EMBER_FOREST); sfx_play(SFX_LEVEL); shake(4);
    uint8_t n = 0; for (uint8_t k = 0; k < 5; k++) if (embers & (1 << k)) n++;
    m_clear(); m_s("The "); m_s(item_info[code].name);
    if (n == 5) m_s("! All five Embers! Take them home to Grandma."); else { m_s("! ("); m_u(n); m_s("/5 Embers)"); }
    hud_say(msg);
    fox.hp = fox.max_hp; hud_stats();
    return;
  }
  switch (code) {
    case IT_FISH: fish += 5; sfx_play(SFX_PICKUP); hud_say("Caught 5 fish! Press B to eat one."); float_num(fox.x, fox.y, "+5"); break;
    case IT_GOLDFISH: fox.hp = fox.max_hp; sfx_play(SFX_HEAL); hud_say("Golden Fish! Fully healed."); float_num(fox.x, fox.y, "FULL"); break;
    case IT_MUSHROOM: b_mushroom = 10; sfx_play(SFX_PICKUP); hud_say("Mushroom! +5 attack for 10 turns."); float_num(fox.x, fox.y, "+5"); break;
    case IT_CRYSTAL: gems++; sfx_play(SFX_GEM); m_clear(); m_s("Crystal Shard! +1 gem ("); m_u(gems); m_s(")"); hud_say(msg); gain_xp(10); break;
    case IT_KEY: keys++; sfx_play(SFX_PICKUP); hud_say("Found an Ancient Key."); break;
    case IT_ARTIFACT:
      relics[item_relic[it] >> 3] |= 1 << (item_relic[it] & 7); relic_n++; sfx_play(SFX_LEVEL); gain_xp(30);
      m_clear(); m_s("Found an ancient Relic! ("); m_u(relic_n); m_s("/"); m_u(RELIC_COUNT); m_s(") Hoot would love to see it."); hud_say(msg);
      break;
    case IT_CHEST: {
      uint8_t g = 2, extra = 0; if (HAS_PERK(P_TREASUREHUNTER)) { g++; fish += 5; extra = 1; }
      gems += g; sfx_play(SFX_GEM);
      m_clear(); m_s("Opened the chest: "); m_u(g); m_s(" gems"); if (extra) m_s(" and 5 fish"); m_s("! ("); m_u(gems); m_s(")"); hud_say(msg);
      gain_xp(30); break;
    }
    case IT_ANTIDOTE: b_poison = 0; b_ward = 20; sfx_play(SFX_HEAL); hud_say("Antidote! Poison cured and warded."); break;
    case IT_BARRIER: b_barrier = 3; sfx_play(SFX_HEAL); hud_say("Barrier Potion! Blocks the next 3 hits."); break;
    case IT_HASTE: b_haste = 12; sfx_play(SFX_HEAL); hud_say("Haste Potion! Enemies slow down for 12 turns."); break;
    case IT_SCROLL: b_true_sight = 1; for (uint8_t e = 0; e < en_n; e++) en_state[e] |= EN_REVEALED; sfx_play(SFX_GEM); hud_say("True Sight! Hidden things are revealed."); break;
    case IT_CLOAK: SET_FLAG(F_CLOAK); sfx_play(SFX_LEVEL); hud_say("The Frost Cloak! Ice no longer trips you, and the Magma Caverns can be braved."); break;
    case IT_SCALE: SET_FLAG(F_SCALE); sfx_play(SFX_LEVEL); hud_say("The Dragon Scale! Lava cannot burn you now, and the Whispering Woods will let you in."); break;
    case IT_HEART: fox.max_hp += 20; fox.hp = fox.max_hp; sfx_play(SFX_LEVEL); hud_say("A Heart Container! Max health +20."); break;
    case IT_CRYSTAL_KEY: SET_FLAG(F_CRYSTALKEY); sfx_play(SFX_LEVEL); hud_say("The Crystal Key! The great arch in the Crystal Cave will open now."); break;
  }
  hud_stats();
}
static void hazards_on(uint8_t x, uint8_t y, int8_t dx, int8_t dy) {
  uint8_t ch = tile_at(x, y), dealt;
  if (ch == 'l') {
    uint8_t dmg = HAS_FLAG(F_SCALE) ? 0 : HAS_PERK(P_HEATRESIST) ? 10 : 20;
    if (dmg) hurt_fox(dmg, &dealt);
  } else if (ch == 'e' && !HAS_PERK(P_NATUREBOND)) { b_rooted = 1; hud_say("Vines wrap around your paws!"); }
  else if (ch == 'i' && !HAS_FLAG(F_CLOAK)) {
    uint8_t slide = area_flags & AF_SLIDE, cx = x, cy = y, moved = 0;
    for (;;) {
      int8_t nx = cx + dx, ny = cy + dy;
      if (!in_grid(nx, ny)) break;
      uint8_t nch = tile_at(nx, ny), ni = idx(nx, ny);
      if (nch == 'd' || nch == 'D') { if (slide) { fox.x = cx; fox.y = cy; try_door(ni, nx, ny); return; } break; }
      if (is_solid(nch) || occupied(nx, ny) || item_at(ni)) break;
      cx = nx; cy = ny; moved++;
      if (!slide || nch != 'i') break;
    }
    if (moved) {
      fox_anim(A_HOP, x - dx, y - dy, 7 + moved * 3); fox.x = cx; fox.y = cy; sfx_play(SFX_FREEZE);
      if (!slide) hud_say("Whoa! Slipped on the ice!");
      if (tile_at(cx, cy) != 'i') hazards_on(cx, cy, dx, dy);
    }
  }
}
void eat_fish(void) BANKED {
  if (!fish) { hud_say("No fish left! Find more, or trade gems with Rudy."); sfx_play(SFX_LOCKED); return; }
  if (fox.hp >= (int16_t)fox.max_hp) { hud_say("Fang is already full."); return; }
  fish--;
  uint16_t heal = 15 + fox.lvl * 3; if (HAS_PERK(P_SCAVENGER)) heal = heal * 3 / 2;
  fox.hp += heal; if (fox.hp > (int16_t)fox.max_hp) fox.hp = fox.max_hp;
  sfx_play(SFX_HEAL); num_float(fox.x, fox.y, "+", heal, "");
  m_clear(); m_s("Munch! +"); m_u(heal); m_s(" HP ("); m_u(fish); m_s(" fish left)"); hud_say(msg);
  hud_stats();
  end_turn();
}

void fire_spin(void) BANKED {
  if (!HAS_PERK(P_FIRESPIN)) { hud_say("Learn FIRE SPIN on level up to use A."); return; }
  if (b_spin_cd) { m_clear(); m_s("Fire Spin recharging... "); m_u(b_spin_cd); hud_say(msg); sfx_play(SFX_LOCKED); return; }
  b_spin_cd = 4; sfx_play(SFX_SPIN); shake(3);
  uint8_t hits = 0, crit;
  for (int8_t oy = -1; oy <= 1; oy++) for (int8_t ox = -1; ox <= 1; ox++) {
    if (!ox && !oy) continue;
    int8_t bx = fox.x + ox, by = fox.y + oy;
    if (in_grid(bx, by) && tiles[idx(bx, by)] == '*') {
      uint8_t k = brazier_at(idx(bx, by));
      if (!lit_t[k]) { lit_t[k] = area_brazier_time ? area_brazier_time : LIT_FOREVER; check_puzzle(); }
    }
    uint8_t e = in_grid(bx, by) ? enemy_at(bx, by) : 0; if (!e) continue;
    e--;
    uint16_t dmg = calc_damage(&crit); if (mon(e)->flags & MF_FIREPROOF) dmg >>= 1;
    hits++; damage_enemy(e, dmg, 0);
  }
  if (hits) { m_clear(); m_s("Fire Spin hits "); m_u(hits); m_s(hits > 1 ? " enemies!" : " enemy!"); hud_say(msg); }
  else hud_say("Fire Spin! Nothing in reach.");
  end_turn();
}
// ---------- the player's move ----------
void do_action(int8_t dx, int8_t dy) BANKED {
  if (dx) fox.dir = dx;
  if (b_sleep) { b_sleep--; m_clear(); m_s("Fang is asleep... ("); m_u(b_sleep); m_s(")"); hud_say(msg); float_num(fox.x, fox.y, "Z"); end_turn(); return; }
  if (b_rooted) { b_rooted--; hud_say("Tangled up!"); float_num(fox.x, fox.y, "STUCK"); end_turn(); return; }
  int8_t nx = fox.x + dx, ny = fox.y + dy;
  if (!in_grid(nx, ny)) { bump("Ouch! The edge of the island."); return; }
  uint8_t e = enemy_at(nx, ny);
  if (e) { attack(e - 1, dx, dy); end_turn(); return; }
  uint8_t n = npc_at(nx, ny);
  if (n) { bump(0); talk_to(n - 1); return; }
  uint8_t i = idx(nx, ny), ch = tiles[i];
  if (ch == 'd' || ch == 'D') { try_door(i, nx, ny); return; }
  if (ch == '?') { bump(0); read_sign(i); return; }
  if (ch == '*') { light_brazier(i, nx, ny); return; }
  if (ch == '%') {
    if (keys) { keys--; set_tile(i, '_'); sfx_play(SFX_DOOR); hud_say("The Ancient Key turns. The gate swings open."); save_game(); end_turn(); return; }
    bump("A locked gate. It needs an Ancient Key."); sfx_play(SFX_LOCKED); return;
  }
  if (ch == '#') { bump(has_plates() ? "A sealed gate. Something here must be weighed down..." : "A sealed gate. The braziers here are cold..."); sfx_play(SFX_LOCKED); return; }
  if (ch == '~') { bump("The Void yawns below. Better not!"); return; }
  uint8_t blk = block_at(nx, ny);
  if (blk) { push_block(blk - 1, dx, dy); return; }
  if (is_solid(ch)) { bump(ch == 'w' ? "Fang would rather not swim." : 0); return; }
  uint8_t it = item_at(i);
  if (it && item_code[it - 1] == IT_CHEST_LOCKED) {
    if (keys) { keys--; item_code[it - 1] = 0; sfx_play(SFX_GEM); gems += 3; gain_xp(60); hud_say("Unlocked the chest! +3 gems."); save_game(); end_turn(); return; }
    bump("A locked chest. It needs an Ancient Key."); sfx_play(SFX_LOCKED); return;
  }
  uint8_t from = idx(fox.x, fox.y);
  move_fox(nx, ny);
  crumble_behind(from);
  if (it) pickup(it - 1);
  hazards_on(nx, ny, dx, dy);
  if (busy() == 2) return;   // an ice slide into a door started a transition
  end_turn();
  if (tile_at(fox.x, fox.y) == 'x' && !HAS_FLAG(F_CLOAK)) { hud_say("Deep snow slows you down..."); end_turn(); }
}

// ---------- areas, death, a new game ----------
void entered_area(void) BANKED {
  if (area_is_fresh) for (uint8_t i = 0; i < en_n; i++) {   // js makeEnemy for the area's foes
    uint8_t t = en_type[i];
    en_hp[i] = monsters[t].hp; en_state[i] = 0; en_frozen[i] = 0; en_phase[i] = 1; en_revive[i] = (monsters[t].flags & MF_REVIVES) ? 1 : 0;
    en_revive_in[i] = NONE; en_acts[i] = 0; en_hit_t[i] = 0xFFFF;
  }
  area_is_fresh = 0;
  area_entry = fox.y * COLS + fox.x;
  b_second_wind = 0; b_true_sight = 0; b_rooted = 0;
  if (!area_solved) {   // unsolved puzzles reset when you come back
    for (uint8_t b = 0; b < blk_n; b++) if (blk_x[b] != NONE) { blk_x[b] = cell_col[blk_o[b]]; blk_y[b] = cell_row[blk_o[b]]; }
    memset(lit_t, 0, sizeof(lit_t));
  }
  for (uint8_t i = 0; i < temp_n; ) {   // crumbled paths re-form, so leaving or falling can never strand a puzzle
    if (temp_orig[i] == 'u') { set_tile(temp_cell[i], 'u'); temp_n--; temp_cell[i] = temp_cell[temp_n]; temp_orig[i] = temp_orig[temp_n]; temp_t[i] = temp_t[temp_n]; }
    else i++;
  }
  apply_when_doors();
  tele_n = 0;
  boss_hud();
}
void area_recover_world(void) BANKED {   // js respawn(): every other visited area's regular foes heal, fallen skeletons stand
  area_state_t *r;
  ENABLE_RAM;
  for (uint8_t a = 0; a < AREA_COUNT; a++) {
    if (a == area_idx || !VISITED(a)) continue;
    r = AREA_RECORD(a);
    for (uint8_t i = 0; i < r->en_n; i++) {
      if ((r->en_state[i] & EN_GONE) || (monsters[r->en_type[i]].flags & MF_BOSS)) continue;
      r->en_hp[i] = monsters[r->en_type[i]].hp;
      if ((r->en_state[i] & EN_DEAD) && r->en_revive_in[i] != NONE) { r->en_state[i] &= ~EN_DEAD; r->en_revive_in[i] = NONE; }
    }
  }
  DISABLE_RAM;
}
void respawn(void) BANKED {
  fox.hp = fox.max_hp; b_poison = 0; b_sleep = 0; b_rooted = 0;
  // regular foes recover; bosses keep their wounds so every attempt makes progress
  area_recover_world();   // the other areas, in SRAM
  for (uint8_t i = 0; i < en_n; i++) if (!(en_state[i] & EN_GONE) && !(mon(i)->flags & MF_BOSS)) {
    en_hp[i] = mon(i)->hp;
    if ((en_state[i] & EN_DEAD) && en_revive_in[i] != NONE) { en_state[i] &= ~EN_DEAD; en_revive_in[i] = NONE; }
  }
  uint8_t care = fish < 3; if (care) fish = 3;
  tele_n = 0;
  hud_say(care ? "Fang shakes it off. Grandma's care package had 3 fish in it. Again, again... win!" : "Fang shakes it off and tries again. Again, again... win!");
  transition(area_idx, area_entry);
}
void new_game(void) BANKED {
  memset(&fox, 0, sizeof(fox));
  fox.hp = 100; fox.max_hp = 100; fox.atk = 5; fox.lvl = 1; fox.next = 100; fox.dir = 1;
  turn = kills = perks = 0; fish = keys = gems = embers = pending_perks = relic_n = kits_rescued = 0; story_n = 0;
  memset(relics, 0, sizeof(relics)); memset(flags, 0, sizeof(flags)); memset(visited, 0, sizeof(visited));
  b_mushroom = b_poison = b_ward = b_barrier = b_haste = b_sleep = b_rooted = b_spin_cd = b_second_wind = b_true_sight = 0;
  tele_n = 0;
  area_reset_world();
}
