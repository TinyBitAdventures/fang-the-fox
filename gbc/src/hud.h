// Shared by the HUD's two halves (hud.c in bank 0, hud_draw.c banked).
#ifndef FANG_HUD_H
#define FANG_HUD_H
#define HD_LINE 1      // the latest message
#define HD_STATS 2     // Fang's numbers
#define HD_DEFAULT 4   // the lower row without a message: the area's name, or the boss
extern char hud_line[96], hud_title_text[NAME_LEN], hud_boss_name[NAME_LEN];
extern uint8_t hud_boss_e, hud_two_line, hud_line_pos, hud_line_next;   // pos: where the page on screen starts; next: the page after it (0: none)
extern uint16_t hud_boss_max;
#endif
