// Fang the Fox — story: characters, dialogue, quests, the shop and the ending.
const SPEAKERS = {
  narrator: { name: '', spr: null },
  sign:     { name: 'Sign', spr: 'sign' },
  fang:     { name: 'Fang', spr: 'fox_0' },
  grandma:  { name: 'Grandma Ember', spr: 'grandma_0' },
  hoot:     { name: 'Hoot', spr: 'hoot_0' },
  rudy:     { name: 'Rudy', spr: 'rudy_0' },
  lumen:    { name: 'Lumen', spr: 'lumen_0' },
  queen:    { name: 'Fairy Queen', spr: 'queen_0' },
  rotheart: { name: 'Rotheart', spr: 'rotheart_0' },
};
const KIT_INFO = {
  kit1: { name: 'Pip',     line: 'Fang! The slimes surrounded me and I got so scared... I\'ll run straight home to Grandma!' },
  kit2: { name: 'Bramble', line: 'I followed a firefly and the gate shut behind me! Thanks, Fang! Home, home, home!' },
  kit3: { name: 'Tuft',    line: 'It\'s so cold and sparkly down here... Can I go home now? Yes? YAY!' },
  kit4: { name: 'Hazel',   line: 'Wheee! I slid all the way in here and couldn\'t slide back out! Lumen will float me home.' },
  kit5: { name: 'Wren',    line: 'The fairies were nice but the fog was scary. Tell Grandma I\'m coming!' },
};
for (const [k, v] of Object.entries(KIT_INFO)) SPEAKERS[k] = { name: v.name, spr: 'kit_0' };

// ---------- Dialogue engine ----------
// lines: [[speaker, text], ...]; after: optional callback when the dialogue closes.
function startDialog(lines, after) {
  ui.dialog = { lines: lines.map(([who, text]) => ({ who, text })), i: 0, shown: 0, after };
  ui.mode = 'talk'; queued = null;
}
function advanceDialog() {
  const d = ui.dialog; if (!d) return;
  const line = d.lines[d.i];
  if (d.shown < line.text.length) { d.shown = line.text.length; return; }
  d.i++; d.shown = 0; Sfx.play('select');
  if (d.i >= d.lines.length) {
    ui.dialog = null; ui.mode = 'play';
    if (d.after) d.after();
  }
}

// ---------- Quests ----------
function objectiveText() {
  const f = G.flags;
  if (!f.metGrandma) return 'Talk to Grandma Ember by the hearth.';
  if (!f.gooking) return 'Defeat the Goo King. Fox Hole, then west past the Slime Pond.';
  if (!f.crystalKey) return 'Find the Crystal Key in the Crystal Depths, past the Dark Woods.';
  if (!f.guardian) return 'Defeat the Ancient Guardian beyond the Crystal Cave arch.';
  if (!G.embers.ember_stone) return 'Take the Stone Ember from the Ancient Ruins.';
  if (!f.colossus) return 'Sky Nexus: cross Glacier Pass and defeat the Ice Colossus.';
  if (!f.dragon) return 'Sky Nexus: brave the Magma Caverns and defeat the Volcanic Dragon.';
  if (!f.rotheart) return 'Sky Nexus: free Rotheart at the World Tree.';
  if (EMBERS.some(k => !G.embers[k])) return 'Collect every Ember from the fallen guardians.';
  if (!f.hearth) return 'Bring all five Embers home to Grandma.';
  if (!f.primordial) return 'Enter the Void Rift in the Fox Hole and face what waits below.';
  const kits = KITS.filter(k => G.kits[k]).length, relics = Object.keys(G.relics).length;
  if (kits < 5 || relics < TOTAL_RELICS) return `The Isles are saved! Extra: kits ${kits}/5, relics ${relics}/${TOTAL_RELICS}.`;
  return 'Every kit is home and every relic found. You are a legend, Fang!';
}
function showObjective() { fx.objective = { text: objectiveText(), t: 0 }; }

// ---------- NPCs ----------
function talkTo(npc) {
  const id = npc.id;
  if (KIT_INFO[id]) return npc.rescued ? kitAtHome(npc) : rescueKit(npc);
  ({ grandma: talkGrandma, hoot: talkHoot, rudy: talkRudy, lumen: talkLumen, queen: talkQueen }[id] || (() => {}))(npc);
}
function readSign(i) { startDialog([['sign', AREAS[G.areaKey].signs[i] || '...']]); }

function talkGrandma() {
  const f = G.flags, lines = [];
  if (!f.metGrandma) {
    f.metGrandma = true;
    return startDialog([
      ['grandma', 'Fang! Oh good, you\'re awake. Do you feel it, little flame? The ground is tilting.'],
      ['grandma', 'The Hearthfire has gone out. For a thousand years it kept the Sky Isles aloft, fed by five Embers.'],
      ['grandma', 'Something down in the Void stole them, one by one, and gave them to monsters to guard.'],
      ['grandma', 'You\'re a fire fox, Fang. The last of us who can carry a flame. Bring the Embers home and we\'ll relight the Hearth.'],
      ['grandma', 'Start with the Goo King. He dragged the Forest Ember into his grotto. Go through the Fox Hole, then west past the Slime Pond.'],
      ['grandma', 'And five of the little kits wandered off chasing fireflies. If you find them, send them home to me?'],
      ['grandma', 'Here, take some fish for the road. Press F to eat when you\'re hurt. And do be careful.'],
    ], () => { G.inv.fish += 5; Sfx.play('pickup'); say('Grandma gave you 5 fish.'); showObjective(); save(); });
  }
  // kits come home
  const fresh = KITS.filter(k => G.kits[k] && !f['kitThanks_' + k]);
  if (fresh.length) {
    for (const k of fresh) { f['kitThanks_' + k] = true; lines.push(['grandma', `${KIT_INFO[k].name} is home safe! Thank you, Fang. Let me fluff up that fur of yours... (+10 max health)`]); }
    const home = KITS.filter(k => G.kits[k]).length;
    if (home === 5 && !f.kitCharm) lines.push(['grandma', 'All five kits, home at last! Take this charm I knitted. It holds a little of my own fire. (+5 attack)']);
    return startDialog(lines, () => {
      G.fox.maxHp += 10 * fresh.length; G.fox.hp = G.fox.maxHp;
      if (KITS.every(k => G.kits[k]) && !f.kitCharm) { f.kitCharm = true; G.fox.atk += 5; }
      Sfx.play('level'); save();
    });
  }
  if (EMBERS.every(k => G.embers[k]) && !f.hearth) return hearthScene();
  if (f.primordial) return startDialog([['grandma', 'You\'re home, little flame. The Isles are high and bright again. I\'m so proud of you.']]);
  if (f.hearth) return startDialog([['grandma', 'The Rift is in your napping spot in the Fox Hole. Whatever waits below, you are not alone. The Hearth burns for you.']]);
  const n = EMBERS.filter(k => G.embers[k]).length;
  startDialog([['grandma', n ? `${n} of 5 Embers! The Hearth is already warmer. ${objectiveText()}` : `Remember, Fang: ${objectiveText()}`]]);
}
function hearthScene() {
  startDialog([
    ['grandma', 'The five Embers... Fang, you did it! Place them in the Hearth. Carefully now...'],
  ], () => {
    G.flags.hearth = true; fx.flashT = 900; shake(8); Sfx.play('level'); setTimeout(() => Sfx.play('roar'), 300);
    weather.burst(196, 40, 60, ['#ffd35c', '#ff7a1a', '#fff2b0', '#ffffff'], { speed: 80, up: 40 });
    queueStory('hearthAftermath', null, 1200);
  });
}
function hearthAftermath() {
  startDialog([
    ['narrator', 'The Hearthfire roars back to life! The Sky Isles shudder... and begin to rise.'],
    ['grandma', 'But listen. Something down below is pulling back, harder than ever.'],
    ['grandma', 'The Void has torn open, right in your napping spot in the Fox Hole. Whatever stole the Embers waits at the bottom.'],
    ['grandma', 'End this, little flame. Then come home. I\'ll keep the fire warm.'],
  ], () => showObjective());
}
function talkHoot() {
  const f = G.flags;
  if (!f.metHoot) {
    f.metHoot = true;
    return startDialog([
      ['hoot', 'Hoo! Young Fang. I\'ve been watching the stars fall all night.'],
      ['hoot', 'The Goo King\'s slime has flooded the path to the Dark Woods. Nothing gets through until he\'s beaten.'],
      ['hoot', 'Beyond the woods lie the Crystal Cave and the Ancient Ruins, where a Guardian keeps the Stone Ember.'],
      ['hoot', `Bring me any Relics you find. Old things hold old magic. For every five, I\'ll teach you something new. There are ${TOTAL_RELICS} in all.`],
    ]);
  }
  const have = Object.keys(G.relics).length, lines = [];
  let perks = 0, crest = false;
  for (const at of [5, 10, 15]) if (have >= at && !f['hoot' + at]) { f['hoot' + at] = true; perks++; lines.push(['hoot', `Hoo hoo! ${at} relics! Sit down, let me show you an old trick...`]); }
  if (have >= TOTAL_RELICS && !f.crest) { f.crest = true; crest = true; lines.push(['hoot', 'Every relic in the Isles! Take the Starlight Crest. It belongs to a true hero. (+5 attack, +20 health)']); }
  if (lines.length) return startDialog(lines, () => { G.pendingPerks += perks; if (crest) { G.fox.atk += 5; G.fox.maxHp += 20; G.fox.hp = G.fox.maxHp; } Sfx.play('level'); save(); });
  const next = [5, 10, 15, TOTAL_RELICS].find(n => n > have);
  startDialog([['hoot', next ? `${have} of ${TOTAL_RELICS} relics. Bring me ${next - have} more for my next lesson, hoo.` : 'You found them all. My library is complete!'], ['hoot', objectiveText()]]);
}
function talkRudy() {
  const first = !G.flags.metRudy; G.flags.metRudy = true;
  const lines = first ? [['rudy', 'Rudy\'s Wares! Gems for goods. No refunds, no questions.'], ['rudy', 'Chests and crystal shards are full of gems, friend. Come back rich!']]
    : G.areaKey === 'elemental_portal' && !G.flags.metRudyNexus ? [['rudy', 'Didn\'t expect me up here, eh? A raccoon goes where the customers are!']]
    : [['rudy', ['What\'ll it be?', 'Browse all you like. Touch, and it\'s yours. Kidding! Mostly.', 'Fresh stock, fresh fish!'][G.turn % 3]]];
  if (G.areaKey === 'elemental_portal') G.flags.metRudyNexus = true;
  startDialog(lines, () => { ui.mode = 'shop'; ui.sel = 0; });
}
function buy(item) {
  const f = G.fox, owned = item.once && G.flags['bought_' + item.id];
  if (owned) { Sfx.play('locked'); say('Sold out!'); return; }
  if (G.gems < item.cost) { Sfx.play('locked'); say(`Not enough gems. You need ${item.cost}.`); return; }
  G.gems -= item.cost; Sfx.play('gem');
  if (item.once) G.flags['bought_' + item.id] = true;
  ({
    fish: () => { G.inv.fish += 5; }, barrier: () => { G.buff.barrier = 3; }, haste: () => { G.buff.haste = 12; }, key: () => { G.inv.key++; },
    heart: () => { f.maxHp += 20; f.hp = f.maxHp; }, claws: () => { f.atk += 3; },
  })[item.id]();
  say(`Bought ${item.name}! (${G.gems} gems left)`);
  save();
}
function talkLumen() {
  const heal = () => { G.fox.hp = G.fox.maxHp; G.buff.poison = 0; Sfx.play('heal'); };
  if (!G.flags.metLumen) {
    G.flags.metLumen = true;
    return startDialog([
      ['lumen', 'Welcome, flame-bearer. This is the Sky Nexus, where the realms meet.'],
      ['lumen', 'Three Embers remain: Frost, Flame and Life. Each realm opens only to one who has conquered the last.'],
      ['lumen', 'Glacier Pass lies north-west. Its guardian\'s Frost Cloak will let you bear the heat of the Magma Caverns.'],
      ['lumen', 'The portal in the corner leads home. And whenever you are weary, rest in my light.'],
    ], () => { heal(); showObjective(); });
  }
  startDialog([['lumen', 'Rest a moment in my light, little flame. ' + objectiveText()]], heal);
}
function talkQueen() {
  const first = !G.flags.metQueen; G.flags.metQueen = true;
  const lines = first ? [
    ['queen', 'A fire fox in my glade! How bold.'],
    ['queen', 'Rotheart was once the World Tree\'s gentlest guardian. The Void\'s rot crept into his roots.'],
    ['queen', 'Free him, and the Life Ember is yours. Take my blessing, and these gems for your journey.'],
  ] : [['queen', 'May your eyes stay clear of the fog, little flame.']];
  startDialog(lines, () => { G.buff.trueSight = true; S.enemies.forEach(e => e.revealed = true); if (first) G.gems += 3; Sfx.play('gem'); say('The fog parts before your eyes.'); save(); });
}
function rescueKit(npc) {
  const k = npc.id, info = KIT_INFO[k];
  startDialog([[k, info.line]], () => {
    G.kits[k] = true; S.npcs = S.npcs.filter(n => n !== npc);
    effect('sparkle', npc.x, npc.y, 3, 110); Sfx.play('level'); sparkle(npc.x, npc.y, ['#ffd35c', '#fff2b0', '#ffffff']);
    say(`${info.name} is headed home! (${KITS.filter(x => G.kits[x]).length}/5 kits found)`);
    save();
  });
}
function kitAtHome(npc) {
  const lines = ['Thanks for finding me, Fang!', 'Grandma made us all hot cocoa!', 'When I grow up I want to be a fire fox too!', 'Did you see any more fireflies?', 'You\'re the bravest fox in the whole sky!'];
  startDialog([[npc.id, lines[(G.turn + npc.home) % lines.length]]]);
}

// ---------- Bosses ----------
function bossDefeatedDialog(t) {
  const lines = {
    j: [['narrator', 'The Goo King wobbles, wibbles... and melts into a puddle of harmless goo.'], ['narrator', 'All across the forest, the slime begins to dry up. The path to the Dark Woods is clear!']],
    X: [['narrator', 'The Ancient Guardian kneels, and crumbles to dust.'], ['narrator', 'A shimmering portal opens where it stood, leading up to the Sky Nexus. A portal home appears in the Forest too.']],
    Y: [['narrator', 'The Ice Colossus shatters into a thousand snowflakes.'], ['narrator', 'It leaves behind the Frost Ember... and a Frost Cloak.']],
    Q: [['narrator', 'The Volcanic Dragon lets out one last puff of smoke, curls up, and falls fast asleep.'], ['narrator', 'Beside it glow the Flame Ember and a shed Dragon Scale.']],
    t: [['narrator', 'The purple rot drains from Rotheart\'s bark like water.'], ['rotheart', 'Thank... you... little flame. Take the Life Ember. Tell the old fox... her grandson... is a hero.']],
  }[t];
  if (!lines) return;
  startDialog(lines, () => { if (ui.mode === 'play') say('Pick up the Ember!'); Music.play(t === 'X' ? 'win' : AREAS[G.areaKey].music); });
}

// ---------- Opening & ending ----------
function startIntro() {
  startDialog([
    ['narrator', 'Rain drums on the Sky Isles.'],
    ['narrator', 'Fang the Fox wakes up from a nap.'],
    ['narrator', 'Something feels... wrong. The whole island is tilting, ever so slightly, toward the dark below.'],
    ['fang', 'Grandma? GRANDMA!'],
  ], () => { showObjective(); say('Arrows or WASD to move. Bump into Grandma to talk.'); });
}
function startEnding() {
  startDialog([
    ['narrator', 'The Primordial\'s great eye flickers... and closes. The Void falls silent.'],
    ['narrator', 'Far above, the Hearthfire blazes. One by one, the Sky Isles rise back into the clouds.'],
    ['narrator', 'Fang the Fox climbs out of the Fox Hole, into the first morning sun anyone can remember.'],
    ['grandma', 'Welcome home, little flame.'],
  ], () => { ui.mode = 'credits'; ui.credits = 0; Music.play('win'); });
}
function finishCredits() {
  G.fox.hp = G.fox.maxHp; G.flags.ended = true;
  ui.mode = 'trans'; ui.trans = { t: 0, mid: () => { enterArea('home', 10); }, done: false };
  queueStory('afterCredits', null, 0);
}
function afterCredits() { say('The adventure goes on. Find every kit and relic!'); showObjective(); }
const CREDITS = [
  ['FANG THE FOX', '#e8622a', 3], ['A TINY BIT ADVENTURE', '#ffd35c', 1], ['', '', 1],
  ['THE SKY ISLES ARE SAVED', '#eef4ff', 1], ['', '', 1],
  ['MUSIC', '#e8622a', 1], ['TINY BIT ADVENTURES', '#ffd35c', 1], ['BY AUSTIN GINDER', '#eef4ff', 1], ['MUSIC.AUSTINGINDER.COM', '#6a82c4', 1], ['', '', 1],
  ['FANG THE FOX', '#a8c6f0', 1], ['COLLABORATIVE ATTACKS', '#a8c6f0', 1], ['DREAMSPACE', '#a8c6f0', 1], ['RUN AND BLITZ', '#a8c6f0', 1], ['AVOID THE VOID', '#a8c6f0', 1],
  ['AGAIN, AGAIN, WIN', '#a8c6f0', 1], ['FOREST EXPLORATION', '#a8c6f0', 1], ['SLIM MONSTERS', '#a8c6f0', 1], ['PLASMA BLAST', '#a8c6f0', 1], ['FOREST HOME', '#a8c6f0', 1], ['', '', 1],
  ['STARRING', '#e8622a', 1], ['FANG', '#eef4ff', 1], ['GRANDMA EMBER', '#eef4ff', 1], ['HOOT, RUDY, LUMEN', '#eef4ff', 1], ['THE FAIRY QUEEN', '#eef4ff', 1], ['PIP, BRAMBLE, TUFT, HAZEL AND WREN', '#eef4ff', 1], ['', '', 1],
  ['THANK YOU FOR PLAYING', '#ffd35c', 2],
];
