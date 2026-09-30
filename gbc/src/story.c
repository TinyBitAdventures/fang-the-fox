// The story: a port of js/story.js (characters, dialogue, quests, the shop, the ending) plus the story
// queue, perk offers and the shop's purchases from js/game.js. Dialogue text is the web game's, word for
// word, except where it names the web's keys (gbc/overrides.js text; the build checks the rest).
// A dialogue is a list of lines kept here; dialog.c asks for them one at a time (story_line) and calls
// story_after when the box closes, which runs what the web's startDialog callback did.
#pragma bank 255
#include "rules.h"
#include "gen/shop.inc"

// ---------- the dialogue being read ----------
#define MAX_DL 8
enum { AF_NONE, AF_GRANDMA_FIRST, AF_GRANDMA_KITS, AF_HEARTH, AF_OBJECTIVE, AF_HOOT, AF_RUDY, AF_LUMEN_FIRST, AF_LUMEN, AF_QUEEN,
  AF_RESCUE, AF_BOSS, AF_INTRO, AF_ENDING };
enum { DY_NONE, DY_KIT_HOME, DY_GRANDMA_EMBERS, DY_HOOT_RELICS, DY_HOOT_LESSON, DY_HOOT_COUNT, DY_OBJECTIVE, DY_LUMEN, DY_SIGN, DY_KIT_AT_HOME };
static uint8_t dl_n, dl_who[MAX_DL], dl_dyn[MAX_DL], dl_arg[MAX_DL], dl_after, dl_after_arg, dl_after_n;
static const char *dl_text[MAX_DL];
static void line(uint8_t who, const char *text) { if (dl_n < MAX_DL) { dl_who[dl_n] = who; dl_text[dl_n] = text; dl_dyn[dl_n++] = DY_NONE; } }
static void dyn(uint8_t who, uint8_t kind, uint8_t arg) { if (dl_n < MAX_DL) { dl_who[dl_n] = who; dl_dyn[dl_n] = kind; dl_arg[dl_n++] = arg; } }
static void talk(uint8_t after, uint8_t arg) { dl_after = after; dl_after_arg = arg; dlg_open(); }

// text put together into dlg_text
static uint8_t tl;
static void t_clear(void) { tl = 0; dlg_text[0] = 0; }
static void t_s(const char *s) { while (*s && tl < sizeof(dlg_text) - 1) dlg_text[tl++] = *s++; dlg_text[tl] = 0; }
static void t_u(uint16_t v) { char t[6]; uint8_t n = 0; do { t[n++] = '0' + v % 10; v /= 10; } while (v); while (n && tl < sizeof(dlg_text) - 1) dlg_text[tl++] = t[--n]; dlg_text[tl] = 0; }

static const char * const kit_name[5] = { "Pip", "Bramble", "Tuft", "Hazel", "Wren" };
static const char * const kit_line[5] = {
  "Fang! The slimes surrounded me and I got so scared... I'll run straight home to Grandma!",
  "I followed a firefly and the gate shut behind me! Thanks, Fang! Home, home, home!",
  "It's so cold and sparkly down here... Can I go home now? Yes? YAY!",
  "Wheee! I slid all the way in here and couldn't slide back out! Lumen will float me home.",
  "The fairies were nice but the fog was scary. Tell Grandma I'm coming!",
};
static const char * const kit_home_line[5] = { "Thanks for finding me, Fang!", "Grandma made us all hot cocoa!", "When I grow up I want to be a fire fox too!",
  "Did you see any more fireflies?", "You're the bravest fox in the whole sky!" };

static uint8_t bits5(uint8_t b) { uint8_t n = 0; for (uint8_t k = 0; k < 5; k++) if (b & (1 << k)) n++; return n; }

// ---------- quests ----------
static char obj[96];
static const char *objective_text(void) {
  if (!HAS_FLAG(F_METGRANDMA)) return "Talk to Grandma Ember by the hearth.";
  if (!HAS_FLAG(F_GOOKING)) return "Defeat the Goo King. Fox Hole, then west past the Slime Pond.";
  if (!HAS_FLAG(F_CRYSTALKEY)) return "Find the Crystal Key in the Crystal Depths, past the Dark Woods.";
  if (!HAS_FLAG(F_GUARDIAN)) return "Defeat the Ancient Guardian beyond the Crystal Cave arch.";
  if (!(embers & (1 << (IT_EMBER_STONE - IT_EMBER_FOREST)))) return "Take the Stone Ember from the Ancient Ruins.";
  if (!HAS_FLAG(F_COLOSSUS)) return "Sky Nexus: cross Glacier Pass and defeat the Ice Colossus.";
  if (!HAS_FLAG(F_DRAGON)) return "Sky Nexus: brave the Magma Caverns and defeat the Volcanic Dragon.";
  if (!HAS_FLAG(F_ROTHEART)) return "Sky Nexus: free Rotheart at the World Tree.";
  if (embers != 31) return "Collect every Ember from the fallen guardians.";
  if (!HAS_FLAG(F_HEARTH)) return "Bring all five Embers home to Grandma.";
  if (!HAS_FLAG(F_PRIMORDIAL)) return "Enter the Void Rift in the Fox Hole and face what waits below.";
  if (bits5(kits_rescued) < 5 || relic_n < RELIC_COUNT) {
    uint8_t n = 0; const char *s;
    char num[4];
    #define O_S(str) for (s = str; *s; ) obj[n++] = *s++
    #define O_U(v) { uint8_t q = v, k = 0; do { num[k++] = '0' + q % 10; q /= 10; } while (q); while (k) obj[n++] = num[--k]; }
    O_S("The Isles are saved! Extra: kits "); O_U(bits5(kits_rescued)); O_S("/5, relics "); O_U(relic_n); O_S("/"); O_U(RELIC_COUNT); O_S(".");
    obj[n] = 0;
    return obj;
  }
  return "Every kit is home and every relic found. You are a legend, Fang!";
}
void show_objective(void) BANKED {   // the web's banner; here it follows whatever message is showing
  const char *s = objective_text();
  m_clear(); m_s("Quest: "); m_s(s); hud_goal(msg);
}

// ---------- the lines, one at a time ----------
uint8_t story_line(uint8_t i) BANKED {
  if (i >= dl_n) return 0;
  dlg_who = dl_who[i];
  uint8_t a = dl_arg[i];
  t_clear();
  switch (dl_dyn[i]) {
    case DY_NONE: t_s(dl_text[i]); break;
    case DY_KIT_HOME: t_s(kit_name[a]); t_s(" is home safe! Thank you, Fang. Let me fluff up that fur of yours... (+10 max health)"); break;
    case DY_GRANDMA_EMBERS:
      if (a) { t_u(a); t_s(" of 5 Embers! The Hearth is already warmer. "); } else t_s("Remember, Fang: ");
      t_s(objective_text()); break;
    case DY_HOOT_RELICS: t_s("Bring me any Relics you find. Old things hold old magic. For every five, I'll teach you something new. There are "); t_u(RELIC_COUNT); t_s(" in all."); break;
    case DY_HOOT_LESSON: t_s("Hoo hoo! "); t_u(a); t_s(" relics! Sit down, let me show you an old trick..."); break;
    case DY_HOOT_COUNT:
      if (a) { t_u(relic_n); t_s(" of "); t_u(RELIC_COUNT); t_s(" relics. Bring me "); t_u(a - relic_n); t_s(" more for my next lesson, hoo."); }
      else t_s("You found them all. My library is complete!");
      break;
    case DY_OBJECTIVE: t_s(objective_text()); break;
    case DY_LUMEN: t_s("Rest a moment in my light, little flame. "); t_s(objective_text()); break;
    case DY_SIGN: {   // the sign's text, from the area's ROM bank
      static sign_t sg;
      const area_t *ap; uint8_t bank = area_ref(area_idx, &ap), k;
      static area_t A;
      far_copy(&A, bank, ap, sizeof(A));
      dlg_text[0] = 0;
      for (k = 0; k < A.sign_n; k++) {
        far_copy(&sg, bank, &A.signs[k], sizeof(sg));
        if (sg.cell == a) { far_copy(dlg_text, bank, sg.text, sizeof(dlg_text) - 1); dlg_text[sizeof(dlg_text) - 1] = 0; }
      }
      if (!dlg_text[0]) t_s("...");
      break;
    }
    case DY_KIT_AT_HOME: t_s(kit_home_line[a]); break;
  }
  return 1;
}

// ---------- NPCs (js talkTo and friends) ----------
static void hearth_scene(void) {
  dl_n = 0;
  line(SP_GRANDMA, "The five Embers... Fang, you did it! Place them in the Hearth. Carefully now...");
  talk(AF_HEARTH, 0);
}
static void talk_grandma(void) {
  uint8_t k, fresh = 0, home;
  dl_n = 0;
  if (!HAS_FLAG(F_METGRANDMA)) {
    SET_FLAG(F_METGRANDMA);
    line(SP_GRANDMA, "Fang! Oh good, you're awake. Do you feel it, little flame? The ground is tilting.");
    line(SP_GRANDMA, "The Hearthfire has gone out. For a thousand years it kept the Sky Isles aloft, fed by five Embers.");
    line(SP_GRANDMA, "Something down in the Void stole them, one by one, and gave them to monsters to guard.");
    line(SP_GRANDMA, "You're a fire fox, Fang. The last of us who can carry a flame. Bring the Embers home and we'll relight the Hearth.");
    line(SP_GRANDMA, "Start with the Goo King. He dragged the Forest Ember into his grotto. Go through the Fox Hole, then west past the Slime Pond.");
    line(SP_GRANDMA, "And five of the little kits wandered off chasing fireflies. If you find them, send them home to me?");
    line(SP_GRANDMA, "Here, take some fish for the road. Press B to eat when you're hurt. And do be careful.");
    talk(AF_GRANDMA_FIRST, 0); return;
  }
  // kits come home
  for (k = 0; k < 5; k++) if ((kits_rescued & (1 << k)) && !HAS_FLAG(F_KITTHANKS_KIT1 + k)) { SET_FLAG(F_KITTHANKS_KIT1 + k); fresh++; dyn(SP_GRANDMA, DY_KIT_HOME, k); }
  if (fresh) {
    home = bits5(kits_rescued);
    if (home == 5 && !HAS_FLAG(F_KITCHARM)) line(SP_GRANDMA, "All five kits, home at last! Take this charm I knitted. It holds a little of my own fire. (+5 attack)");
    talk(AF_GRANDMA_KITS, fresh); return;
  }
  if (embers == 31 && !HAS_FLAG(F_HEARTH)) { hearth_scene(); return; }
  if (HAS_FLAG(F_PRIMORDIAL)) { line(SP_GRANDMA, "You're home, little flame. The Isles are high and bright again. I'm so proud of you."); talk(AF_NONE, 0); return; }
  if (HAS_FLAG(F_HEARTH)) { line(SP_GRANDMA, "The Rift is in your napping spot in the Fox Hole. Whatever waits below, you are not alone. The Hearth burns for you."); talk(AF_NONE, 0); return; }
  dyn(SP_GRANDMA, DY_GRANDMA_EMBERS, bits5(embers));
  talk(AF_NONE, 0);
}
static void talk_hoot(void) {
  uint8_t have = relic_n, perks_n = 0, crest = 0, next;
  dl_n = 0;
  if (!HAS_FLAG(F_METHOOT)) {
    SET_FLAG(F_METHOOT);
    line(SP_HOOT, "Hoo! Young Fang. I've been watching the stars fall all night.");
    line(SP_HOOT, "The Goo King's slime has flooded the path to the Dark Woods. Nothing gets through until he's beaten.");
    line(SP_HOOT, "Beyond the woods lie the Crystal Cave and the Ancient Ruins, where a Guardian keeps the Stone Ember.");
    dyn(SP_HOOT, DY_HOOT_RELICS, 0);
    talk(AF_NONE, 0); return;
  }
  if (have >= 5 && !HAS_FLAG(F_HOOT5)) { SET_FLAG(F_HOOT5); perks_n++; dyn(SP_HOOT, DY_HOOT_LESSON, 5); }
  if (have >= 10 && !HAS_FLAG(F_HOOT10)) { SET_FLAG(F_HOOT10); perks_n++; dyn(SP_HOOT, DY_HOOT_LESSON, 10); }
  if (have >= 15 && !HAS_FLAG(F_HOOT15)) { SET_FLAG(F_HOOT15); perks_n++; dyn(SP_HOOT, DY_HOOT_LESSON, 15); }
  if (have >= RELIC_COUNT && !HAS_FLAG(F_CREST)) { SET_FLAG(F_CREST); crest = 1; line(SP_HOOT, "Every relic in the Isles! Take the Starlight Crest. It belongs to a true hero. (+5 attack, +20 health)"); }
  if (dl_n) { talk(AF_HOOT, perks_n | (crest << 7)); return; }
  next = have < 5 ? 5 : have < 10 ? 10 : have < 15 ? 15 : have < RELIC_COUNT ? RELIC_COUNT : 0;
  dyn(SP_HOOT, DY_HOOT_COUNT, next);
  dyn(SP_HOOT, DY_OBJECTIVE, 0);
  talk(AF_NONE, 0);
}
static void talk_rudy(void) {
  uint8_t first = !HAS_FLAG(F_METRUDY);
  SET_FLAG(F_METRUDY);
  dl_n = 0;
  if (first) { line(SP_RUDY, "Rudy's Wares! Gems for goods. No refunds, no questions."); line(SP_RUDY, "Chests and crystal shards are full of gems, friend. Come back rich!"); }
  else if (area_idx == AR_ELEMENTAL_PORTAL && !HAS_FLAG(F_METRUDYNEXUS)) line(SP_RUDY, "Didn't expect me up here, eh? A raccoon goes where the customers are!");
  else { uint8_t k = turn % 3; line(SP_RUDY, k == 0 ? "What'll it be?" : k == 1 ? "Browse all you like. Touch, and it's yours. Kidding! Mostly." : "Fresh stock, fresh fish!"); }
  if (area_idx == AR_ELEMENTAL_PORTAL) SET_FLAG(F_METRUDYNEXUS);
  talk(AF_RUDY, 0);
}
void buy(uint8_t i) BANKED {   // js buy: the shop shows what happened on its last line
  static shop_t it;
  it = shop[i];
  uint8_t flag = i == SHOP_HEART ? F_BOUGHT_HEART : F_BOUGHT_CLAWS;
  if (it.once && (flags[flag >> 3] & (1 << (flag & 7)))) { sfx_play(SFX_LOCKED); m_clear(); m_s("Sold out!"); shop_status(msg); return; }
  if (gems < it.cost) { sfx_play(SFX_LOCKED); m_clear(); m_s("Not enough gems. You need "); m_u(it.cost); m_s("."); shop_status(msg); return; }
  gems -= it.cost; sfx_play(SFX_GEM);
  if (it.once) SET_FLAG(flag);
  switch (i) {
    case SHOP_FISH: fish += 5; break;
    case SHOP_BARRIER: b_barrier = 3; break;
    case SHOP_HASTE: b_haste = 12; break;
    case SHOP_KEY: keys++; break;
    case SHOP_HEART: fox.max_hp += 20; fox.hp = fox.max_hp; break;
    case SHOP_CLAWS: fox.atk += 3; break;
  }
  m_clear(); m_s("Bought "); m_s(it.name); m_s("! ("); m_u(gems); m_s(" gems left)"); shop_status(msg);
  hud_stats();
  save_game();
}
static void talk_lumen(void) {
  dl_n = 0;
  if (!HAS_FLAG(F_METLUMEN)) {
    SET_FLAG(F_METLUMEN);
    line(SP_LUMEN, "Welcome, flame-bearer. This is the Sky Nexus, where the realms meet.");
    line(SP_LUMEN, "Three Embers remain: Frost, Flame and Life. Each realm opens only to one who has conquered the last.");
    line(SP_LUMEN, "Glacier Pass lies north-west. Its guardian's Frost Cloak will let you bear the heat of the Magma Caverns.");
    line(SP_LUMEN, "The portal in the corner leads home. And whenever you are weary, rest in my light.");
    talk(AF_LUMEN_FIRST, 0); return;
  }
  dyn(SP_LUMEN, DY_LUMEN, 0);
  talk(AF_LUMEN, 0);
}
static void talk_queen(void) {
  uint8_t first = !HAS_FLAG(F_METQUEEN);
  SET_FLAG(F_METQUEEN);
  dl_n = 0;
  if (first) {
    line(SP_QUEEN, "A fire fox in my glade! How bold.");
    line(SP_QUEEN, "Rotheart was once the World Tree's gentlest guardian. The Void's rot crept into his roots.");
    line(SP_QUEEN, "Free him, and the Life Ember is yours. Take my blessing, and these gems for your journey.");
  } else line(SP_QUEEN, "May your eyes stay clear of the fog, little flame.");
  talk(AF_QUEEN, first);
}
void talk_to(uint8_t n) BANKED {
  uint8_t id = npc_id[n];
  if (id >= NPC_KIT1) {
    uint8_t k = id - NPC_KIT1;
    dl_n = 0;
    if (kits_rescued & (1 << k)) { dyn(SP_KIT1 + k, DY_KIT_AT_HOME, (uint8_t)(turn + idx(npc_x[n], npc_y[n])) % 5); talk(AF_NONE, 0); }
    else { line(SP_KIT1 + k, kit_line[k]); talk(AF_RESCUE, n); }
    return;
  }
  if (id == NPC_GRANDMA) talk_grandma();
  else if (id == NPC_HOOT) talk_hoot();
  else if (id == NPC_RUDY) talk_rudy();
  else if (id == NPC_LUMEN) talk_lumen();
  else talk_queen();
}
void read_sign(uint8_t cell) BANKED { dl_n = 0; dyn(SP_SIGN, DY_SIGN, cell); talk(AF_NONE, 0); }

// ---------- bosses, the opening and the ending ----------
static void boss_defeated(uint8_t t) {
  dl_n = 0;
  switch (t) {
    case MT_GOOKING:
      line(SP_NARRATOR, "The Goo King wobbles, wibbles... and melts into a puddle of harmless goo.");
      line(SP_NARRATOR, "All across the forest, the slime begins to dry up. The path to the Dark Woods is clear!"); break;
    case MT_GUARDIAN:
      line(SP_NARRATOR, "The Ancient Guardian kneels, and crumbles to dust.");
      line(SP_NARRATOR, "A shimmering portal opens where it stood, leading up to the Sky Nexus. A portal home appears in the Forest too."); break;
    case MT_COLOSSUS:
      line(SP_NARRATOR, "The Ice Colossus shatters into a thousand snowflakes.");
      line(SP_NARRATOR, "It leaves behind the Frost Ember... and a Frost Cloak."); break;
    case MT_DRAGON:
      line(SP_NARRATOR, "The Volcanic Dragon lets out one last puff of smoke, curls up, and falls fast asleep.");
      line(SP_NARRATOR, "Beside it glow the Flame Ember and a shed Dragon Scale."); break;
    case MT_ROTHEART:
      line(SP_NARRATOR, "The purple rot drains from Rotheart's bark like water.");
      line(SP_ROTHEART, "Thank... you... little flame. Take the Life Ember. Tell the old fox... her grandson... is a hero."); break;
    default: return;
  }
  talk(AF_BOSS, t);
}
static void hearth_aftermath(void) {
  dl_n = 0;
  line(SP_NARRATOR, "The Hearthfire roars back to life! The Sky Isles shudder... and begin to rise.");
  line(SP_GRANDMA, "But listen. Something down below is pulling back, harder than ever.");
  line(SP_GRANDMA, "The Void has torn open, right in your napping spot in the Fox Hole. Whatever stole the Embers waits at the bottom.");
  line(SP_GRANDMA, "End this, little flame. Then come home. I'll keep the fire warm.");
  talk(AF_OBJECTIVE, 0);
}
void start_intro(void) BANKED {
  dl_n = 0;
  line(SP_NARRATOR, "Rain drums on the Sky Isles.");
  line(SP_NARRATOR, "Fang the Fox wakes up from a nap.");
  line(SP_NARRATOR, "Something feels... wrong. The whole island is tilting, ever so slightly, toward the dark below.");
  line(SP_FANG, "Grandma? GRANDMA!");
  talk(AF_INTRO, 0);
}
static void start_ending(void) {
  dl_n = 0;
  line(SP_NARRATOR, "The Primordial's great eye flickers... and closes. The Void falls silent.");
  line(SP_NARRATOR, "Far above, the Hearthfire blazes. One by one, the Sky Isles rise back into the clouds.");
  line(SP_NARRATOR, "Fang the Fox climbs out of the Fox Hole, into the first morning sun anyone can remember.");
  line(SP_GRANDMA, "Welcome home, little flame.");
  talk(AF_ENDING, 0);
}

// what each dialogue's callback did in the web game
void story_after(void) BANKED {
  uint8_t a = dl_after_arg, k;
  switch (dl_after) {
    case AF_GRANDMA_FIRST: fish += 5; sfx_play(SFX_PICKUP); hud_say("Grandma gave you 5 fish."); show_objective(); hud_stats(); save_game(); break;
    case AF_GRANDMA_KITS:
      fox.max_hp += 10 * a; fox.hp = fox.max_hp;
      if (kits_rescued == 31 && !HAS_FLAG(F_KITCHARM)) { SET_FLAG(F_KITCHARM); fox.atk += 5; }
      sfx_play(SFX_LEVEL); hud_stats(); save_game(); break;
    case AF_HEARTH: SET_FLAG(F_HEARTH); shake(8); sfx_play(SFX_LEVEL); queue_story(ST_HEARTH_AFTERMATH, 0, 72); break;
    case AF_OBJECTIVE: show_objective(); break;
    case AF_HOOT:
      pending_perks += a & 0x7F;
      if (a & 0x80) { fox.atk += 5; fox.max_hp += 20; fox.hp = fox.max_hp; }
      sfx_play(SFX_LEVEL); hud_stats(); save_game(); break;
    case AF_RUDY: shop_open(); break;
    case AF_LUMEN_FIRST: case AF_LUMEN:
      fox.hp = fox.max_hp; b_poison = 0; sfx_play(SFX_HEAL); hud_stats();
      if (dl_after == AF_LUMEN_FIRST) show_objective();
      break;
    case AF_QUEEN:
      b_true_sight = 1; for (k = 0; k < en_n; k++) en_state[k] |= EN_REVEALED;
      if (a) gems += 3;
      sfx_play(SFX_GEM); hud_say("The fog parts before your eyes."); hud_stats(); save_game(); break;
    case AF_RESCUE: {   // the kit heads home: gone from this area, standing at home from now on
      uint8_t n = a, id = npc_id[n] - NPC_KIT1;
      kits_rescued |= 1 << id;
      npc_n--; npc_id[n] = npc_id[npc_n]; npc_x[n] = npc_x[npc_n]; npc_y[n] = npc_y[npc_n]; npc_ak[n] = npc_ak[npc_n];
      sfx_play(SFX_LEVEL);
      m_clear(); m_s(kit_name[id]); m_s(" is headed home! ("); m_u(bits5(kits_rescued)); m_s("/5 kits found)"); hud_say(msg);
      save_game(); break;
    }
    case AF_BOSS: if (game_state == S_PLAY) hud_say("Pick up the Ember!"); break;
    case AF_INTRO: hud_say("The D-pad moves. Bump into Grandma to talk."); show_objective(); break;
    case AF_ENDING:   // the credits come in phase 5: straight to finishCredits
      fox.hp = fox.max_hp; SET_FLAG(F_ENDED); hud_stats();
      transition(AR_HOME, 10);
      queue_story(ST_AFTER_CREDITS, 0, 0);
      break;
  }
}

// ---------- the story queue: beats wait for normal play so they never cover death, doors or perk picks ----------
uint8_t story_n, story_fn[STORY_MAX], story_arg[STORY_MAX];
uint16_t story_t[STORY_MAX];
void queue_story(uint8_t fn, uint8_t arg, uint16_t frames) BANKED {
  if (story_n < STORY_MAX) { story_fn[story_n] = fn; story_arg[story_n] = arg; story_t[story_n++] = frames; }
  save_game();
}
void run_story(void) BANKED {   // the head's wait counts down every frame (game.c); it runs once play is calm
  uint8_t fn, arg, k;
  if (!story_n || story_t[0] || game_state != S_PLAY || busy()) return;
  fn = story_fn[0]; arg = story_arg[0];
  for (k = 1; k < story_n; k++) { story_fn[k - 1] = story_fn[k]; story_arg[k - 1] = story_arg[k]; story_t[k - 1] = story_t[k]; }
  story_n--;
  switch (fn) {
    case ST_BOSS_DEFEATED: boss_defeated(arg); break;
    case ST_HEARTH_AFTERMATH: hearth_aftermath(); break;
    case ST_START_ENDING: start_ending(); break;
    case ST_AFTER_CREDITS: hud_say("The adventure goes on. Find every kit and relic!"); show_objective(); break;
  }
}

// ---------- perks (js offerPerks, choosePerk) ----------
// The web shuffles the perks it offers with pool.sort(() => Math.random() - 0.5). V8 (Node 26, what
// tools/parity.js runs) sorts up to 7 items with a plain binary insertion sort, and longer lists with
// TimSort: one run check, then the same binary insertion. This does the same, one random number per
// comparison, so the offers (and every random number after them) match. Checked against Node's own
// sort for 2-24 items; another engine's sort would shuffle differently, which only the tests notice.
static uint8_t cmp_neg(void) { return rng_next() < 0x80000000UL; }   // Math.random() - 0.5 < 0
static void v8_sort(uint8_t *a, uint8_t n) {
  uint8_t run = 1, i, desc, left, right, mid, pivot, t;
  if (n < 2) return;
  if (n > 7) {   // TimSort's CountAndMakeRun: compare(a[1], a[0]), then while the run keeps its direction
    run = 2; desc = cmp_neg();
    for (i = 2; i < n; i++) { uint8_t neg = cmp_neg(); if (desc ? !neg : neg) break; run++; }
    if (desc) for (i = 0; i < run >> 1; i++) { t = a[i]; a[i] = a[run - 1 - i]; a[run - 1 - i] = t; }
  }
  for (; run < n; run++) {   // BinaryInsertionSort
    left = 0; right = run; pivot = a[run];
    while (left < right) { mid = left + ((right - left) >> 1); if (cmp_neg()) right = mid; else left = mid + 1; }
    for (i = run; i > left; i--) a[i] = a[i - 1];
    a[left] = pivot;
  }
}
void offer_perks(void) BANKED {
  static uint8_t pool[PERK_COUNT];
  uint8_t n = 0, k;
  for (k = 0; k < PERK_COUNT; k++) if (!HAS_PERK(k)) pool[n++] = k;
  if (!n) { pending_perks = 0; return; }
  v8_sort(pool, n);
  perk_choice_n = n < 3 ? n : 3;
  for (k = 0; k < perk_choice_n; k++) perk_choice[k] = pool[k];
  perk_open();
}
void choose_perk(uint8_t k) BANKED {
  perks |= 1u << k; pending_perks--; sfx_play(SFX_GEM);
  m_clear(); m_s("Learned "); m_s(perk_names[k]); m_s("!"); hud_say(msg);
  if (k == P_KEENEYES) for (uint8_t e = 0; e < en_n; e++) en_state[e] |= EN_REVEALED;
  save_game();
}
