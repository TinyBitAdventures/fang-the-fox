// The rules, part 4 (see logic.c): puzzles. js lightBrazier, pushBlock and checkPuzzle. Fire Spin
// (logic.c) lights braziers too; end_turn (turn.c) lets timed ones gutter out; entered_area (logic.c)
// puts an unsolved puzzle back the way it started.
#pragma bank 255
#include "rules.h"

void check_puzzle(void) BANKED {
  uint8_t i, k;
  if (area_solved) return;
  for (i = 0; i < CELLS; i++) if (tiles[i] == '#') break;
  if (i == CELLS) return;   // no gate to open
  for (k = 0; k < brz_n; k++) if (!lit_t[k]) return;
  for (i = 0; i < CELLS; i++) if (tiles[i] == '+' && !block_at(cell_col[i], cell_row[i])) return;
  area_solved = 1;
  for (i = 0; i < CELLS; i++) if (tiles[i] == '#') set_tile(i, '_');
  for (k = 0; k < brz_n; k++) lit_t[k] = LIT_FOREVER;   // stay lit forever once solved
  sfx_play(SFX_LEVEL); shake(3); hud_say("Rumble... the gate opens!");
}

void light_brazier(uint8_t i, uint8_t x, uint8_t y) BANKED {
  uint8_t k = brazier_at(i), n = 0, j;
  if (lit_t[k]) { bump("The brazier is already burning."); return; }
  fox_anim(A_LUNGE, (x > fox.x) - (x < fox.x) + 1, (y > fox.y) - (y < fox.y) + 1, 10);
  lit_t[k] = area_brazier_time ? area_brazier_time : LIT_FOREVER;
  sfx_play(SFX_SPIN);
  for (j = 0; j < brz_n; j++) if (lit_t[j]) n++;
  if (brz_n > 1) { m_clear(); m_s("The brazier roars to life! ("); m_u(n); m_s("/"); m_u(brz_n); m_s(")"); hud_say(msg); }
  else hud_say("The brazier roars to life!");
  check_puzzle();
  end_turn();
}

void push_block(uint8_t b, int8_t dx, int8_t dy) BANKED {
  int8_t tx = blk_x[b] + dx, ty = blk_y[b] + dy;
  if (!in_grid(tx, ty)) { bump("It won't budge."); return; }
  uint8_t ch = tile_at(tx, ty), ti = idx(tx, ty), it = item_at(ti);
  if (occupied(tx, ty) || it || ch == 'd' || ch == 'D' || (is_solid(ch) && ch != 'w' && ch != '~')) { bump(it ? "Something is in the way." : "It won't budge."); return; }
  uint8_t from = idx(fox.x, fox.y);
  block_anim(b, idx(blk_x[b], blk_y[b]));
  blk_x[b] = tx; blk_y[b] = ty;
  move_fox(fox.x + dx, fox.y + dy); crumble_behind(from);
  sfx_play(SFX_BUMP);
  if (ch == 'w') { set_tile(ti, '='); blk_x[b] = NONE; sfx_play(SFX_SPLASH); hud_say("The stone sinks, making a stepping stone!"); }
  else if (ch == '~') { blk_x[b] = NONE; sfx_play(SFX_BOOM); hud_say("The stone tumbles into the Void..."); }
  else if (ch == 'l') { set_tile(ti, '_'); blk_x[b] = NONE; sfx_play(SFX_BOOM); hud_say("The stone sinks and cools the lava."); }
  else if (ch == '+') sfx_play(SFX_FREEZE);
  check_puzzle();
  end_turn();
}
