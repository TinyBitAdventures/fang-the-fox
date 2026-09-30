// The HUD's bank-0 half: what the rules tell it (messages, stats changed, a boss), and once a frame
// hud_frame() asks the banked half (hud_draw.c) to draw what changed. Messages are copied here because
// the text may live in the caller's ROM bank.
#include <gb/gb.h>
#include <string.h>
#include "game.h"
#include "hud.h"

char msg[96];
static uint8_t msg_len;
char hud_line[96], hud_title_text[NAME_LEN], hud_boss_name[NAME_LEN];
uint8_t hud_boss_e = NONE, hud_two_line, hud_line_pos, hud_line_next;
uint16_t hud_boss_max;
static uint8_t dirty;   // HD_* bits
static uint16_t msg_t;

void m_clear(void) { msg_len = 0; msg[0] = 0; }
void m_s(const char *s) { while (*s && msg_len < sizeof(msg) - 1) msg[msg_len++] = *s++; msg[msg_len] = 0; }
void m_u(uint16_t v) { char t[6]; uint8_t n = 0; do { t[n++] = '0' + v % 10; v /= 10; } while (v); while (n && msg_len < sizeof(msg) - 1) msg[msg_len++] = t[--n]; msg[msg_len] = 0; }

void hud_stats(void) { dirty |= HD_STATS; }
void hud_title(const char *s) { strncpy(hud_title_text, s, NAME_LEN - 1); dirty |= HD_DEFAULT; }
void hud_say(const char *s) { strncpy(hud_line, s, sizeof(hud_line) - 1); hud_line[sizeof(hud_line) - 1] = 0; hud_line_pos = 0; dirty |= HD_LINE; msg_t = 300; }
void hud_boss(uint8_t e, const char *name, uint16_t max) {
  hud_boss_e = e; hud_boss_max = max;
  if (name) strncpy(hud_boss_name, name, NAME_LEN - 1);
  dirty |= HD_DEFAULT;
}

void hud_frame(void) {
  if (dirty & HD_LINE) { dirty &= ~(HD_LINE | HD_DEFAULT); hud_draw(HD_LINE); msg_t = hud_line_next ? 180 : 300; }
  else if (msg_t && !--msg_t) {
    if (hud_line_next) { hud_line_pos = hud_line_next; hud_draw(HD_LINE); msg_t = hud_line_next ? 180 : 300; }   // a long message's next page
    else { dirty |= HD_DEFAULT; if (hud_two_line) { hud_two_line = 0; dirty |= HD_STATS; } }
  }
  if (dirty & HD_STATS) { dirty &= ~HD_STATS; hud_draw(HD_STATS); }
  if ((dirty & HD_DEFAULT) && !msg_t) { dirty &= ~HD_DEFAULT; hud_draw(HD_DEFAULT); }
}
