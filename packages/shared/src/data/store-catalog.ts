// ─── Mark My Hordes — Complete Store Catalog ────────────────────
// Every purchasable cosmetic, booster, and crown package in one place.

import {
  CatalogItem,
  CrownPackage,
  BundleDef,
  HordeUnitType,
  Rarity,
} from '../types/store';
import type { ItemCategory } from '../types/store';

// ─────────────────────────────────────────────────────────────────
//  Crown Packages (real-money → crowns)
// ─────────────────────────────────────────────────────────────────

export const CROWN_PACKAGES: CrownPackage[] = [
  {
    id: 'pouch',
    name: 'Pouch of Crowns',
    crowns: 100,
    priceUSD: 0.99,
    bonusPercent: 0,
    icon: '👝',
  },
  {
    id: 'sack',
    name: 'Sack of Crowns',
    crowns: 550,
    priceUSD: 4.99,
    bonusPercent: 10,
    icon: '💰',
  },
  {
    id: 'chest',
    name: 'Chest of Crowns',
    crowns: 1200,
    priceUSD: 9.99,
    bonusPercent: 20,
    icon: '📦',
  },
  {
    id: 'war_chest',
    name: 'War Chest',
    crowns: 2800,
    priceUSD: 19.99,
    bonusPercent: 40,
    icon: '⚔️',
  },
  {
    id: 'dragon_hoard',
    name: "Dragon's Hoard",
    crowns: 7000,
    priceUSD: 49.99,
    bonusPercent: 40,
    icon: '🐉',
  },
  {
    id: 'royal_treasury',
    name: 'Royal Treasury',
    crowns: 15000,
    priceUSD: 99.99,
    bonusPercent: 50,
    icon: '👑',
  },
];

// ─────────────────────────────────────────────────────────────────
//  Helper: tier-based pricing for unit skins
//  T1 gnome/turtle → cheapest, T5 troll → most expensive
// ─────────────────────────────────────────────────────────────────

const UNIT_TIER: Record<HordeUnitType, number> = {
  gnome: 1,
  snake: 1,
  turtle: 1,
  skull: 2,
  spider: 2,
  hyena: 2,
  rogue: 3,
  panda: 3,
  lizard: 3,
  bear: 3,
  harpoon_fish: 3,
  minotaur: 4,
  shaman: 4,
  troll: 5,
};

function skinPrice(tier: number, rarity: Rarity): number {
  const base: Record<Rarity, number> = {
    common: 80,
    rare: 200,
    epic: 500,
    legendary: 1200,
  };
  const step: Record<Rarity, number> = {
    common: 25,
    rare: 50,
    epic: 75,
    legendary: 250,
  };
  return base[rarity] + (tier - 1) * step[rarity];
}

// ─────────────────────────────────────────────────────────────────
//  Unit Skin data per unit — [common, rare, epic, legendary]
// ─────────────────────────────────────────────────────────────────

interface SkinDef {
  theme: string;
  name: string;
  desc: string;
  rarity: Rarity;
}

const UNIT_SKINS: Record<HordeUnitType, SkinDef[]> = {
  gnome: [
    { theme: 'frost', name: 'Frost Gnome', desc: 'A chilly little troublemaker dusted in permafrost.', rarity: 'common' },
    { theme: 'golden', name: 'Golden Gnome', desc: 'Gilded from pointy cap to curly boots — pure bling.', rarity: 'rare' },
    { theme: 'infernal', name: 'Infernal Gnome', desc: 'Wreathed in hellfire, this gnome means business.', rarity: 'epic' },
    { theme: 'celestial', name: 'Celestial Gnome', desc: 'Blessed by starlight, trailing constellations in its wake.', rarity: 'legendary' },
  ],
  snake: [
    { theme: 'coral', name: 'Coral Snake', desc: 'Bright bands of red and yellow warn of lethal venom.', rarity: 'common' },
    { theme: 'golden', name: 'Golden Snake', desc: 'Scales of hammered gold shimmer with every slither.', rarity: 'rare' },
    { theme: 'shadow_serpent', name: 'Shadow Serpent', desc: 'A living ribbon of darkness that strikes from the void.', rarity: 'epic' },
    { theme: 'ouroboros', name: 'Ouroboros', desc: 'The eternal serpent, coiled in infinite recursion, devouring its own legend.', rarity: 'legendary' },
  ],
  turtle: [
    { theme: 'mossy', name: 'Mossy Turtle', desc: 'Centuries of forest growth cling to this ancient shell.', rarity: 'common' },
    { theme: 'crystal', name: 'Crystal Turtle', desc: 'A translucent carapace refracts light into rainbows.', rarity: 'rare' },
    { theme: 'magma', name: 'Magma Turtle', desc: 'Molten rock flows through deep cracks in its shell.', rarity: 'epic' },
    { theme: 'ancient', name: 'Ancient Turtle', desc: 'An elder of the deep, adorned with fossilized runes.', rarity: 'legendary' },
  ],
  skull: [
    { theme: 'jade', name: 'Jade Skull', desc: 'Carved from enchanted jade, glowing with spectral light.', rarity: 'common' },
    { theme: 'bloodmoon', name: 'Blood Moon Skull', desc: 'Bathed in crimson moonlight, thirsting for the hunt.', rarity: 'rare' },
    { theme: 'phantom', name: 'Phantom Skull', desc: 'A translucent wraith flickering between worlds.', rarity: 'epic' },
    { theme: 'deathknight', name: 'Death Knight Skull', desc: 'Crowned in bone and shadow, sovereign of the grave.', rarity: 'legendary' },
  ],
  spider: [
    { theme: 'widow', name: 'Black Widow Spider', desc: 'Jet-black chitin marked with a crimson hourglass.', rarity: 'common' },
    { theme: 'frost', name: 'Frost Spider', desc: 'Ice crystals cling to every silken thread it spins.', rarity: 'rare' },
    { theme: 'void', name: 'Void Spider', desc: 'Spins webs of dark matter between dimensions.', rarity: 'epic' },
    { theme: 'mech', name: 'Mech Spider', desc: 'Chrome-plated legs and a laser-targeting array.', rarity: 'legendary' },
  ],
  hyena: [
    { theme: 'arctic', name: 'Arctic Hyena', desc: 'Snow-white fur and ice-blue eyes, born of the tundra.', rarity: 'common' },
    { theme: 'cursed', name: 'Cursed Hyena', desc: 'Dark magic seeps from its fur like living shadow.', rarity: 'rare' },
    { theme: 'warpaint', name: 'Warpaint Hyena', desc: 'Tribal markings glow crimson across its snarling face.', rarity: 'epic' },
    { theme: 'spectral', name: 'Spectral Hyena', desc: 'Flickering between planes, half-ghost and all menace.', rarity: 'legendary' },
  ],
  rogue: [
    { theme: 'nightblade', name: 'Nightblade Rogue', desc: 'Cloaked in living darkness — barely visible at dusk.', rarity: 'common' },
    { theme: 'pirate', name: 'Pirate Rogue', desc: 'Cutlass, eyepatch, and a coat that smells of salt and gunpowder.', rarity: 'rare' },
    { theme: 'ninja', name: 'Ninja Rogue', desc: 'Silent as smoke, deadly as a thrown shuriken.', rarity: 'epic' },
    { theme: 'assassin', name: 'Assassin Rogue', desc: 'Master of every shadow, ruler of the unseen world.', rarity: 'legendary' },
  ],
  panda: [
    { theme: 'red', name: 'Red Panda', desc: 'Russet fur and a bushy ringed tail — impossibly cute.', rarity: 'common' },
    { theme: 'bamboo', name: 'Bamboo Panda', desc: 'Wrapped in woven bamboo armor, smelling of fresh leaves.', rarity: 'rare' },
    { theme: 'samurai', name: 'Samurai Panda', desc: 'Adorned in lacquered red armor with a fearsome mempo.', rarity: 'epic' },
    { theme: 'jade_emperor', name: 'Jade Emperor Panda', desc: 'Draped in clouds and imperial silk, a living legend.', rarity: 'legendary' },
  ],
  lizard: [
    { theme: 'chameleon', name: 'Chameleon Lizard', desc: 'Scales shift colour with every step like a living gem.', rarity: 'common' },
    { theme: 'dragon', name: 'Dragon Lizard', desc: 'Ember-scaled with smoldering orange eyes and smoke on its breath.', rarity: 'rare' },
    { theme: 'toxic', name: 'Toxic Lizard', desc: 'Dripping neon venom, each step corrodes the ground.', rarity: 'epic' },
    { theme: 'elder_wyrm', name: 'Elder Wyrm Lizard', desc: 'An echo of the first dragons, wreathed in primal flame.', rarity: 'legendary' },
  ],
  bear: [
    { theme: 'grizzly', name: 'Grizzly Bear', desc: 'Massive brown fur and raw power — the king of the river.', rarity: 'common' },
    { theme: 'armored', name: 'Black Bear', desc: 'Sleek dark coat and sharp claws, silent in the underbrush.', rarity: 'rare' },
    { theme: 'spirit', name: 'Polar Bear', desc: 'White as arctic snow, built for the coldest battlefields.', rarity: 'epic' },
    { theme: 'elder', name: 'Kodiak Bear', desc: 'The largest of them all — ancient, towering, unstoppable.', rarity: 'legendary' },
  ],
  harpoon_fish: [
    { theme: 'reef', name: 'Reef Fish', desc: 'Vivid tropical colors camouflage a deadly marksman.', rarity: 'common' },
    { theme: 'steel', name: 'Steel Fish', desc: 'Chrome-plated scales deflect blows while the harpoon flies true.', rarity: 'rare' },
    { theme: 'abyssal', name: 'Abyssal Fish', desc: 'Rising from crushing depths, bioluminescent lures dangle menacingly.', rarity: 'epic' },
    { theme: 'leviathan', name: 'Leviathan Fish', desc: 'A sea-god in miniature — tidal waves follow in its wake.', rarity: 'legendary' },
  ],
  minotaur: [
    { theme: 'iron', name: 'Iron Minotaur', desc: 'Plated in dark iron from horn to hoof.', rarity: 'common' },
    { theme: 'berserker', name: 'Berserker Minotaur', desc: 'Rune-scarred hide pulses with crimson battle-rage.', rarity: 'rare' },
    { theme: 'demonic', name: 'Demonic Minotaur', desc: 'Hellfire flickers in its eyes and cracks along its horns.', rarity: 'epic' },
    { theme: 'titan', name: 'Titan Minotaur', desc: 'Earthquake with every step — stone crumbles in its wake.', rarity: 'legendary' },
  ],
  shaman: [
    { theme: 'druid', name: 'Druid Shaman', desc: 'Draped in living vines that bloom with every spell.', rarity: 'common' },
    { theme: 'necro', name: 'Necromancer Shaman', desc: 'Surrounded by ghostly totems and the whispers of the dead.', rarity: 'rare' },
    { theme: 'archmage', name: 'Archmage Shaman', desc: 'Crackling arcane energy orbits every gesture.', rarity: 'epic' },
    { theme: 'void_oracle', name: 'Void Oracle Shaman', desc: 'Gazes into the abyss — and the abyss obeys.', rarity: 'legendary' },
  ],
  troll: [
    { theme: 'moss', name: 'Moss Troll', desc: 'Covered in dripping mud and tangled river weed.', rarity: 'common' },
    { theme: 'volcanic', name: 'Volcanic Troll', desc: 'Magma veins glow beneath cracked obsidian skin.', rarity: 'rare' },
    { theme: 'frost_king', name: 'Frost King Troll', desc: 'Crowned in glacial ice, breath that freezes steel.', rarity: 'epic' },
    { theme: 'mountain_god', name: 'Mountain God Troll', desc: 'A living mountain crowned with stone and thunder.', rarity: 'legendary' },
  ],
};

// ─────────────────────────────────────────────────────────────────
//  Build the catalog
// ─────────────────────────────────────────────────────────────────

const catalog: CatalogItem[] = [];

// ═════════════════════════════════════════════════════════════════
//  UNIT SKINS  (44 items — 4 per unit × 11 units)
// ═════════════════════════════════════════════════════════════════

// Pricing: common/rare = glory only, epic/legendary = crowns only
const GLORY_PRICES: Record<Rarity, number> = { common: 1500, rare: 3000, epic: 0, legendary: 0 };

for (const unit of Object.keys(UNIT_SKINS) as HordeUnitType[]) {
  const tier = UNIT_TIER[unit];
  for (const skin of UNIT_SKINS[unit]) {
    const useGlory = skin.rarity === 'common' || skin.rarity === 'rare';
    catalog.push({
      id: `skin_${unit}_${skin.theme}`,
      category: 'unit_skin',
      name: skin.name,
      description: skin.desc,
      rarity: skin.rarity,
      priceCrowns: useGlory ? 0 : skinPrice(tier, skin.rarity),
      priceGlory: useGlory ? GLORY_PRICES[skin.rarity] : null,
      unitType: unit,
    });
  }
}

// ═════════════════════════════════════════════════════════════════
//  AVATAR PORTRAITS  (20 items)
// ═════════════════════════════════════════════════════════════════

// --- 11 Deluxe unit portraits ---

const DELUXE_PORTRAIT_DESCS: Record<HordeUnitType, string> = {
  gnome: 'A lovingly hand-painted portrait capturing every mischievous wrinkle.',
  snake: 'Coiled and poised, scales gleaming with iridescent menace.',
  turtle: 'A serene close-up of ancient, knowing eyes peering from a weathered shell.',
  skull: 'A hauntingly detailed portrait wreathed in ghostly green flame.',
  spider: 'Eight gleaming eyes stare back from a web-framed masterpiece.',
  hyena: 'A snarling portrait that seems to laugh even when still.',
  rogue: 'A half-shadowed face — you can only ever see one cunning eye.',
  panda: 'A regal portrait radiating calm wisdom and quiet strength.',
  lizard: 'Iridescent scales shimmer as you tilt the frame.',
  bear: 'A massive silhouette framed by pine trees and falling snow.',
  harpoon_fish: 'Gleaming scales and a razor-sharp spear, ready to strike.',
  minotaur: 'A fearsome bust carved in stone, horns piercing the border.',
  shaman: 'Surrounded by floating spirit orbs in a forest clearing.',
  troll: 'A towering silhouette against a blood-red sunset.',
};

for (const unit of Object.keys(DELUXE_PORTRAIT_DESCS) as HordeUnitType[]) {
  catalog.push({
    id: `portrait_${unit}_deluxe`,
    category: 'avatar_portrait',
    name: `Deluxe ${unit.charAt(0).toUpperCase() + unit.slice(1)} Portrait`,
    description: DELUXE_PORTRAIT_DESCS[unit],
    rarity: 'rare',
    priceCrowns: 200,
    priceGlory: null,
    unitType: unit,
  });
}

// --- 5 Legendary unique portraits ---

const LEGENDARY_PORTRAITS: { id: string; name: string; desc: string }[] = [
  { id: 'portrait_dragon_lord', name: 'Dragon Lord', desc: 'A fearsome warlord mounted atop a colossal wyrm.' },
  { id: 'portrait_forest_witch', name: 'Forest Witch', desc: 'An ancient crone whose eyes hold millennia of woodland secrets.' },
  { id: 'portrait_storm_king', name: 'Storm King', desc: 'Lightning arcs between his crown and outstretched gauntlet.' },
  { id: 'portrait_shadow_queen', name: 'Shadow Queen', desc: 'A regal silhouette woven from pure midnight, eyes like embers.' },
  { id: 'portrait_phoenix_knight', name: 'Phoenix Knight', desc: 'Ablaze with rebirth flame, this warrior can never truly fall.' },
];

for (const p of LEGENDARY_PORTRAITS) {
  catalog.push({
    id: p.id,
    category: 'avatar_portrait',
    name: p.name,
    description: p.desc,
    rarity: 'legendary',
    priceCrowns: 400,
    priceGlory: null,
  });
}

// --- 4 Seasonal portraits ---

const SEASONAL_PORTRAITS: { season: string; name: string; desc: string }[] = [
  { season: 'winter', name: 'Winterfrost Avatar', desc: 'Snowflakes drift across a frozen landscape portrait.' },
  { season: 'spring', name: 'Blossom Avatar', desc: 'Cherry petals swirl around a vibrant meadow portrait.' },
  { season: 'summer', name: 'Solstice Avatar', desc: 'Golden sun rays radiate from a tropical paradise scene.' },
  { season: 'autumn', name: 'Harvest Avatar', desc: 'Warm amber leaves cascade across a twilight harvest field.' },
];

for (const s of SEASONAL_PORTRAITS) {
  catalog.push({
    id: `portrait_seasonal_${s.season}`,
    category: 'avatar_portrait',
    name: s.name,
    description: s.desc,
    rarity: 'rare',
    priceCrowns: 300,
    priceGlory: null,
    seasonal: `${s.season}_2026`,
    limited: true,
  });
}

// ═════════════════════════════════════════════════════════════════
//  PORTRAIT FRAMES  (13 items)
// ═════════════════════════════════════════════════════════════════

// --- 5 Common frames (glory-purchasable) ---

const COMMON_FRAMES: { theme: string; name: string; desc: string }[] = [
  { theme: 'wooden', name: 'Wooden Frame', desc: 'A sturdy oak border with hand-carved notches.' },
  { theme: 'iron', name: 'Iron Frame', desc: 'Riveted iron plates forged in a frontier smithy.' },
  { theme: 'stone', name: 'Stone Frame', desc: 'Hewn from grey granite, solid and unyielding.' },
  { theme: 'copper', name: 'Copper Frame', desc: 'Warm copper patina with a hint of verdigris.' },
  { theme: 'bone', name: 'Bone Frame', desc: 'Assembled from bleached rib bones — unsettling yet stylish.' },
];

for (const f of COMMON_FRAMES) {
  catalog.push({
    id: `frame_${f.theme}`,
    category: 'portrait_frame',
    name: f.name,
    description: f.desc,
    rarity: 'common',
    priceCrowns: 0,
    priceGlory: 500,
  });
}

// --- 5 Rare frames ---

const RARE_FRAMES: { theme: string; name: string; desc: string }[] = [
  { theme: 'shimmer', name: 'Shimmer Frame', desc: 'An iridescent border that shifts hue with every glance.' },
  { theme: 'thorns', name: 'Thorns Frame', desc: 'Sharp brambles weave a dangerous but beautiful edge.' },
  { theme: 'flames', name: 'Flames Frame', desc: 'Perpetual fire licks the borders without burning the portrait.' },
  { theme: 'frost', name: 'Frost Frame', desc: 'A rim of eternal ice crystals that never melts.' },
  { theme: 'vines', name: 'Vines Frame', desc: 'Living ivy that slowly grows and blooms in real time.' },
];

for (const f of RARE_FRAMES) {
  catalog.push({
    id: `frame_${f.theme}`,
    category: 'portrait_frame',
    name: f.name,
    description: f.desc,
    rarity: 'rare',
    priceCrowns: 150,
    priceGlory: null,
  });
}

// --- 3 Epic frames ---

const EPIC_FRAMES: { theme: string; name: string; desc: string }[] = [
  { theme: 'dragon', name: 'Dragon Frame', desc: 'Twin serpentine dragons coil around the portrait edge.' },
  { theme: 'celestial', name: 'Celestial Frame', desc: 'A rotating galaxy of tiny stars and nebulae.' },
  { theme: 'void', name: 'Void Frame', desc: 'A portal to nothingness — the border devours light itself.' },
];

for (const f of EPIC_FRAMES) {
  catalog.push({
    id: `frame_${f.theme}`,
    category: 'portrait_frame',
    name: f.name,
    description: f.desc,
    rarity: 'epic',
    priceCrowns: 350,
    priceGlory: null,
  });
}

// ═════════════════════════════════════════════════════════════════
//  VOICE PACKS  (8 items — unit personality variants)
// ═════════════════════════════════════════════════════════════════

const VOICE_PACKS: { id: string; unit: HordeUnitType; name: string; desc: string; price: number; voiceId?: string; sampleText?: string; personality?: string }[] = [
  // ── Gnome voices (5) ──
  { id: 'voice_gnome_enthusiast', unit: 'gnome', name: 'Enthusiast Gnome', desc: 'Quirky attitude and boundless excitement in every word.', price: 200, voiceId: 'FGY2WhTYpPnrIDTdsKH5', sampleText: 'Ooh ooh ooh! I found a shiny carrot! This is the BEST day of my tiny little life!', personality: "Quirky and curious. Asks weird questions mid-battle. Fascinated by EVERYTHING. Says 'ooh!' and 'fascinating!' constantly. Gets distracted by shiny objects." },
  { id: 'voice_gnome_energetic', unit: 'gnome', name: 'Energetic Gnome', desc: 'Hyper-charged chatter from a gnome who had too much mushroom tea.', price: 200, voiceId: 'TX3LPaxmHKxFdv7VOQHJ', sampleText: 'Go go go! No time to rest! We got carrots to grab and camps to smash! Lets goooo!', personality: "Hyperactive motivational speaker energy. Speaks in rapid-fire bursts. Never stops moving. Says 'lets GOOO' and 'NO TIME TO REST' constantly. Pure adrenaline." },
  { id: 'voice_gnome_playful', unit: 'gnome', name: 'Playful Gnome', desc: 'Bright and warm giggles between every command.', price: 220, voiceId: 'cgSgspJ2msm6clMCkdW9', sampleText: 'Hehe, they never see us coming! Tiny feet, big sneaky energy!', personality: "Mischievous prankster. Giggles between words (spell out: 'hehehe'). Treats battle like a game of tag. Teases enemies. Everything is funny to this gnome." },
  { id: 'voice_gnome_scholar', unit: 'gnome', name: 'Scholar Gnome', desc: 'A surprisingly educated gnome who quotes ancient texts mid-battle.', price: 250, voiceId: 'Xb7hH8MSUJpSbSDYk0k2', sampleText: 'According to chapter seven of Advanced Carrot Theory, optimal gathering requires a forty-five degree approach angle.', personality: "Intellectual gnome who quotes ancient texts. Uses big words (sometimes incorrectly). Starts sentences with 'According to my research...' or 'Historically speaking...'. Treats combat as a field study." },
  { id: 'voice_gnome_charming', unit: 'gnome', name: 'Charming Gnome', desc: 'Down-to-earth warmth with a winning smile you can hear.', price: 230, voiceId: 'iP95p4xoKVk53GoZ742B', sampleText: 'Hey friend, stick with me and we will be swimming in carrots by sundown. Trust me on this one.', personality: "Smooth-talking charmer. Reassuring and warm. Calls everyone 'friend' or 'pal'. Makes promises about future success. Confidence is infectious. Natural leader energy." },

  // ── Turtle voices (5) ──
  { id: 'voice_turtle_deep', unit: 'turtle', name: 'Deep Turtle', desc: 'Resonant and comforting, like a warm cave rumble.', price: 200, voiceId: 'nPczCjzI2devNBz1zQrb', sampleText: 'The mountain does not rush. The river does not hurry. And neither shall we.', personality: "Philosophical and deep. Speaks in nature metaphors. Every sentence sounds like ancient proverb. Rumbling gravitas. Sighs deeply (spell out: 'hmmmmm')." },
  { id: 'voice_turtle_storyteller', unit: 'turtle', name: 'Storyteller Turtle', desc: 'Warm and captivating, every order sounds like the start of an epic tale.', price: 220, voiceId: 'JBFqnCBsd6RMkjVDRZzb', sampleText: 'Gather round, little ones. I shall tell you of the Great Carrot War of ages past.', personality: "Narrator turtle. Frames every command as the beginning of an epic story. Says 'And so...' and 'Thus began...' constantly. Dramatic pauses between phrases." },
  { id: 'voice_turtle_wise', unit: 'turtle', name: 'Wise Turtle', desc: 'Mature and balanced, the voice of ancient wisdom.', price: 250, voiceId: 'pqHfZKP75CvOlQylNhV4', sampleText: 'Patience is not the ability to wait, but the ability to keep a good attitude while waiting for the enemy to make a mistake.', personality: "Sage-like wisdom. Gives unsolicited life advice mid-battle. Quotes made-up ancient turtle proverbs. Begins responses with 'In my three hundred years...' or 'The elders taught me...'" },
  { id: 'voice_turtle_steady', unit: 'turtle', name: 'Steady Turtle', desc: 'Calm broadcaster energy, delivering battlefield reports with poise.', price: 200, voiceId: 'onwK4e9ZLuTAKqWW03F9', sampleText: 'Advancing at standard turtle pace. Estimated arrival: sometime this afternoon. Shell integrity nominal.', personality: "Military radio operator. Deadpan status reports. Uses jargon like 'shell integrity nominal' and 'advancing at standard pace'. Never emotional. Everything is a field report." },
  { id: 'voice_turtle_relaxed', unit: 'turtle', name: 'Relaxed Turtle', desc: 'Laid-back and neutral, nothing phases this ancient shell.', price: 200, voiceId: 'SAz9YHcvj6GT2YYXdXww', sampleText: 'Yeah, the battle is heating up. But honestly? My shell has seen worse. Way worse.', personality: "Unflappable surfer dude energy. Nothing impresses this turtle. Responds to everything with 'yeah, that tracks' or 'been there, done that'. Casually dismisses danger." },

  // ── Skull voices (5) ──
  { id: 'voice_skull_trickster', unit: 'skull', name: 'Trickster Skull', desc: 'Husky and mischievous, delighting in the chaos of undeath.', price: 220, voiceId: 'N2lVS1w4EtoT3dr4eOWO', sampleText: 'Knock knock. Who is there? Death. Death who? Death comes for everyone, but today it brought snacks!', personality: "Dark comedian. Tells death jokes constantly. Finds everything about being undead hilarious. Puns about bones, graves, and dying. Cackles between sentences (spell out: 'kehehe')." },
  { id: 'voice_skull_dominant', unit: 'skull', name: 'Dominant Skull', desc: 'Firm and commanding, the skull that leads the skeleton army.', price: 250, voiceId: 'pNInz6obpgDQGcFmaJgB', sampleText: 'You WILL fall in line. You WILL march forward. And you WILL enjoy it. The grave demands it.', personality: "Tyrannical undead general. Barks orders. Uses 'you WILL' statements. References 'the grave demands it'. No tolerance for weakness. Speaks of death as a promotion." },
  { id: 'voice_skull_warrior', unit: 'skull', name: 'Warrior Skull', desc: 'Fierce and battle-hardened, screaming into the void.', price: 230, voiceId: 'SOYHLrjzK2X1ezoPC6cr', sampleText: 'CHARGE! Let them see what happens when bones have nothing left to lose!', personality: "Battle-crazed undead berserker. Screams war cries. LOVES violence and destruction. Spells out battle screams like 'CHAAAAARGE!!' and 'FOR THE GRAVE!!'. Has nothing to lose and revels in it." },
  { id: 'voice_skull_casual', unit: 'skull', name: 'Casual Skull', desc: 'Laid-back undead vibes, casually mentioning the afterlife.', price: 200, voiceId: 'CwhRBWXzGAHq8TQ4Fs17', sampleText: 'Yeah so being dead is not that bad actually. No taxes, no allergies, and I lost a ton of weight.', personality: "Chill skeleton who treats undeath like a lifestyle upgrade. Lists perks of being dead casually. Very 'meh' about combat. Says 'honestly not that bad' about everything terrible." },
  { id: 'voice_skull_smooth', unit: 'skull', name: 'Smooth Skull', desc: 'Trustworthy and smooth, the skull you would follow into the abyss.', price: 220, voiceId: 'cjVigY5qzO86Huf0OWal', sampleText: 'Follow me into the darkness. I promise it is not as scary as it looks. Well, maybe a little.', personality: "Charismatic undead recruiter. Makes the afterlife sound appealing. Smooth-talks allies into danger. Says 'trust me' and 'I promise' while leading into obvious peril. Suave and slightly sinister." },

  // ── Spider voices (5) ──
  { id: 'voice_spider_smooth', unit: 'spider', name: 'Smooth Spider', desc: 'Silky persuasion dripping from every word like venom.', price: 220, voiceId: 'cjVigY5qzO86Huf0OWal', sampleText: 'Come closer, little fly. I have woven something beautiful just for you.', personality: "Seductive predator. Calls enemies 'little fly' or 'dear prey'. Every sentence is an invitation into a trap. Purrs between words. Describes webs and silk with disturbing affection." },
  { id: 'voice_spider_dominant', unit: 'spider', name: 'Dominant Spider', desc: 'Firm and terrifying, the spider queen speaks.', price: 250, voiceId: 'pNInz6obpgDQGcFmaJgB', sampleText: 'Every web I weave is a trap. Every trap is a promise. And I always keep my promises.', personality: "Spider queen. Absolute authority. Speaks of her web as her kingdom. Commands with cold certainty. Every word is a decree. Says 'my web' and 'my domain'. Terrifying calm." },
  { id: 'voice_spider_trickster', unit: 'spider', name: 'Trickster Spider', desc: 'Husky whispers laced with eight-legged mischief.', price: 220, voiceId: 'N2lVS1w4EtoT3dr4eOWO', sampleText: 'Oh you thought you were safe? How adorable. I have been behind you this whole time.', personality: "Creepy trickster. Loves psychological games. Whispers threats disguised as observations. Says 'how adorable' when enemies try to fight back. Always claims to be watching from somewhere unseen." },
  { id: 'voice_spider_confident', unit: 'spider', name: 'Confident Spider', desc: 'Deep and confident, a spider that knows its worth.', price: 230, voiceId: 'IKne3meq5aSn9XLyUdCD', sampleText: 'Eight legs, eight plans, eight ways to ruin your day. Pick your favorite.', personality: "Supremely self-assured. References having eight legs/eyes as superiority. Counts things in eights. Offers enemies choices (all bad). Condescending but earned confidence." },
  { id: 'voice_spider_clear', unit: 'spider', name: 'Precise Spider', desc: 'Clear and precise, calculating every move.', price: 200, voiceId: 'Xb7hH8MSUJpSbSDYk0k2', sampleText: 'Analyzing target trajectory. Venom reserves at ninety-two percent. Engaging in three, two, one.', personality: "Clinical predator. Reports venom levels and web tension like a scientist. Uses percentages and countdowns. Zero emotion, pure efficiency. Every kill is data collection." },

  // ── Hyena voices (5) ──
  { id: 'voice_hyena_energetic', unit: 'hyena', name: 'Energetic Hyena', desc: 'Boundless manic energy that feeds off the chaos of battle.', price: 220, voiceId: 'TX3LPaxmHKxFdv7VOQHJ', sampleText: 'HAHAHA! Did you see that?! They ran! They actually RAN! This is the best fight EVER!', personality: "Pure chaos gremlin. Cannot stop laughing (spell out: 'AHAHAHA'). Narrates enemy failures with glee. Treats every battle like the best party ever. Speaks in exclamation marks." },
  { id: 'voice_hyena_warrior', unit: 'hyena', name: 'Warrior Hyena', desc: 'Fierce and aggressive, howling into battle with reckless abandon.', price: 250, voiceId: 'SOYHLrjzK2X1ezoPC6cr', sampleText: 'The pack hunts! The pack DEVOURS! Nothing escapes our jaws! NOTHING!', personality: "Alpha pack leader. Speaks of 'the pack' as sacred. Howls mid-sentence (spell out: 'AWOOOO'). Everything is about hunting, devouring, and dominance. Aggressive and territorial." },
  { id: 'voice_hyena_playful', unit: 'hyena', name: 'Playful Hyena', desc: 'Bright and teasing, toying with prey between giggles.', price: 200, voiceId: 'cgSgspJ2msm6clMCkdW9', sampleText: 'Tag, you are it! Hehe, just kidding. You are actually dinner.', personality: "Playful hunter who treats combat like a game. Giggles constantly (spell out: 'hehehehe'). Calls enemies 'it' like playing tag. Switches from cute to menacing mid-sentence." },
  { id: 'voice_hyena_quirky', unit: 'hyena', name: 'Quirky Hyena', desc: 'Unpredictable attitude shifts from silly to savage.', price: 230, voiceId: 'FGY2WhTYpPnrIDTdsKH5', sampleText: 'You know what is funny? Everything! Especially the look on their faces right now!', personality: "Unhinged comedian. Finds EVERYTHING funny. Makes observations about enemies that are accidentally terrifying. Mood swings from giggling to growling. Zero filter." },
  { id: 'voice_hyena_confident', unit: 'hyena', name: 'Bold Hyena', desc: 'Deep confidence radiating pure pack energy.', price: 230, voiceId: 'IKne3meq5aSn9XLyUdCD', sampleText: 'The pack grows stronger with every kill. And I am VERY hungry today.', personality: "Confident apex predator. Speaks of hunger as power. Counts kills with satisfaction. Deep voice, measured aggression. 'I smell weakness' type energy. Strategic hunter, not chaotic." },

  // ── Rogue voices (5) ──
  { id: 'voice_rogue_smooth', unit: 'rogue', name: 'Smooth Rogue', desc: 'Effortlessly cool, like a shadow with perfect diction.', price: 220, voiceId: 'cjVigY5qzO86Huf0OWal', sampleText: 'Nothing personal. Well, actually, it is a little personal. I just really enjoy this part.', personality: "James Bond energy. Cool one-liners before and after every action. Says 'nothing personal' while making it very personal. Effortlessly suave. Treats stealth missions like a hobby." },
  { id: 'voice_rogue_trickster', unit: 'rogue', name: 'Trickster Rogue', desc: 'Husky whispers from the darkness, always one step ahead.', price: 230, voiceId: 'N2lVS1w4EtoT3dr4eOWO', sampleText: 'You are looking the wrong way. By the time you turn around, it will be far too late.', personality: "Shadow whisper. Speaks from the darkness. Always claims to be three steps ahead. Taunts enemies about what they cannot see. Husky, intimate whispers. 'Behind you' energy." },
  { id: 'voice_rogue_charming', unit: 'rogue', name: 'Charming Rogue', desc: 'Disarming warmth that makes you forget the knife at your back.', price: 200, voiceId: 'iP95p4xoKVk53GoZ742B', sampleText: 'Hey, no hard feelings right? Just doing my job. Your stuff looks great on me though.', personality: "Lovable thief. Apologizes while stealing. Compliments enemies on their gear before taking it. Says 'no hard feelings' and 'just business'. Genuinely friendly while being terrible." },
  { id: 'voice_rogue_casual', unit: 'rogue', name: 'Casual Rogue', desc: 'Laid-back heist energy, stealing camps like it is a day job.', price: 200, voiceId: 'CwhRBWXzGAHq8TQ4Fs17', sampleText: 'So yeah, I just snuck past like twelve guards. No big deal. Happens every Tuesday.', personality: "Casual professional thief. Downplays incredible feats. Says 'no big deal' about impossible infiltrations. Treats every heist as routine. Bored by danger. Mentions Tuesdays randomly." },
  { id: 'voice_rogue_optimist', unit: 'rogue', name: 'Optimist Rogue', desc: 'A thief with a heart of gold and a permanently sunny outlook.', price: 220, voiceId: 'bIHbv24MWmeRgasZH58o', sampleText: 'Every locked door is just an unopened gift! And I love opening gifts!', personality: "Eternally positive thief. Sees every obstacle as an opportunity. Locked doors are 'gifts', guards are 'dance partners', and traps are 'puzzles'. Genuinely happy about everything including danger." },

  // ── Panda voices (5) ──
  { id: 'voice_panda_optimist', unit: 'panda', name: 'Optimist Panda', desc: 'Relaxed and endlessly positive, even when crushing enemies.', price: 200, voiceId: 'bIHbv24MWmeRgasZH58o', sampleText: 'You know what, today is a good day. Even the fighting is kind of nice. Fresh air, good company.', personality: "Wholesome tank. Finds the bright side of combat. Compliments the weather mid-battle. Says 'you know what, this is nice'. Crushes enemies while being genuinely pleasant about it." },
  { id: 'voice_panda_storyteller', unit: 'panda', name: 'Storyteller Panda', desc: 'Warm narration that turns every battle into a bedtime story.', price: 250, voiceId: 'JBFqnCBsd6RMkjVDRZzb', sampleText: 'And so the great panda lumbered forth, bamboo in paw, heart full of purpose and belly full of snacks.', personality: "Narrates own life in third person. 'And so the great panda...' style. Turns combat into bedtime stories. Mentions snacks constantly. Warm, fatherly, narrating his own epic journey." },
  { id: 'voice_panda_wise', unit: 'panda', name: 'Wise Panda', desc: 'Ancient wisdom wrapped in fluffy fur.', price: 230, voiceId: 'pqHfZKP75CvOlQylNhV4', sampleText: 'The bamboo bends but does not break. Be like bamboo. Also, eat bamboo. It is delicious.', personality: "Zen master who keeps accidentally making everything about food. Starts with deep wisdom, ends with bamboo cravings. Combines philosophy and appetite. 'Be like the river... which flows toward the bamboo grove.'" },
  { id: 'voice_panda_relaxed', unit: 'panda', name: 'Relaxed Panda', desc: 'So chill it is almost meditative, even mid-combat.', price: 200, voiceId: 'SAz9YHcvj6GT2YYXdXww', sampleText: 'Yeah I could fight harder. But honestly, this pace feels right. Balance in all things.', personality: "Maximum chill. Responds to urgency with 'yeah, we will get there'. Yawns mid-sentence (spell out: 'yaaawn'). Never rushes. Questions why everyone else is so stressed. Genuinely unbothered." },
  { id: 'voice_panda_deep', unit: 'panda', name: 'Deep Panda', desc: 'Resonant and comforting, the panda elder speaks.', price: 220, voiceId: 'nPczCjzI2devNBz1zQrb', sampleText: 'When I sit, the earth trembles. When I stand, my enemies reconsider their life choices.', personality: "Intimidating gentle giant. Speaks of his own size with quiet pride. Makes the ground shake as a casual flex. Politely warns enemies to reconsider. Deep rumbling voice, few words, maximum impact." },

  // ── Lizard voices (5) ──
  { id: 'voice_lizard_dominant', unit: 'lizard', name: 'Dominant Lizard', desc: 'Cold authority that demands immediate obedience.', price: 250, voiceId: 'pNInz6obpgDQGcFmaJgB', sampleText: 'Cold blood. Cold steel. Cold calculation. Your defeat was decided before this battle began.', personality: "Apex predator warlord. Speaks in declarations, never questions. Repeats words for emphasis ('Cold blood. Cold steel.'). Views all other creatures as prey. Absolute zero emotion, absolute authority." },
  { id: 'voice_lizard_confident', unit: 'lizard', name: 'Confident Lizard', desc: 'Deep and self-assured, a predator that knows the hunt is already won.', price: 230, voiceId: 'IKne3meq5aSn9XLyUdCD', sampleText: 'I can taste your fear on the air. It is... exquisite. Keep running. It makes the chase sweeter.', personality: "Gourmet predator. Describes fear and defeat as flavors and aromas. Savors the hunt. Says 'exquisite' and 'delectable'. Treats combat as fine dining. Sophisticated and terrifying." },
  { id: 'voice_lizard_trickster', unit: 'lizard', name: 'Trickster Lizard', desc: 'Husky reptilian cunning with a cruel sense of humor.', price: 220, voiceId: 'N2lVS1w4EtoT3dr4eOWO', sampleText: 'Oh you thought I was slow? That was me letting you build false hope. Much more entertaining this way.', personality: "Cruel strategist who gives enemies false hope on purpose. Explains traps AFTER they spring. Says 'much more entertaining this way'. Enjoys psychological warfare more than physical." },
  { id: 'voice_lizard_steady', unit: 'lizard', name: 'Steady Lizard', desc: 'Methodical and precise, like a reptile tracking prey.', price: 200, voiceId: 'onwK4e9ZLuTAKqWW03F9', sampleText: 'Target acquired. Distance closing. Temperature dropping. Initiating cold blood protocol.', personality: "Military precision. Reports everything like a targeting computer. Uses protocols and procedures. 'Target acquired. Engaging.' Zero personality, maximum efficiency. Cold-blooded in every sense." },
  { id: 'voice_lizard_smooth', unit: 'lizard', name: 'Smooth Lizard', desc: 'Deceptively smooth, the voice of a cold-blooded diplomat.', price: 220, voiceId: 'cjVigY5qzO86Huf0OWal', sampleText: 'Let us discuss terms. You surrender everything, and I consider not eating you. Fair, yes?', personality: "Diplomatic predator. Offers 'fair' deals that are entirely one-sided. Polite manners masking lethal intent. Says 'shall we?' and 'how reasonable'. A politician with fangs." },

  // ── Minotaur voices (5) ──
  { id: 'voice_minotaur_deep', unit: 'minotaur', name: 'Deep Minotaur', desc: 'Booming resonance that shakes the very ground.', price: 220, voiceId: 'nPczCjzI2devNBz1zQrb', sampleText: 'HEAR ME. The labyrinth is MY domain. Every wall, every shadow, every echo belongs to ME.', personality: "Territorial titan. Claims ownership of everything. 'This is MY domain. Those are MY enemies. That is MY carrot.' Deep, possessive, absolute. The ground shakes when he speaks." },
  { id: 'voice_minotaur_dominant', unit: 'minotaur', name: 'Dominant Minotaur', desc: 'Absolute authority from the alpha of the herd.', price: 250, voiceId: 'pNInz6obpgDQGcFmaJgB', sampleText: 'I do not ask. I do not request. I COMMAND. And the earth obeys.', personality: "Supreme commander. Does not ask — DEMANDS. Every word is a decree. Says 'I COMMAND' in all caps energy. Expects the very earth to obey. Zero patience for hesitation." },
  { id: 'voice_minotaur_storyteller', unit: 'minotaur', name: 'Noble Minotaur', desc: 'Warm gravitas from a warrior-poet with horns.', price: 230, voiceId: 'JBFqnCBsd6RMkjVDRZzb', sampleText: 'They call us beasts. But a beast does not compose war songs. A beast does not weep for fallen comrades.', personality: "Warrior-poet. Challenges the 'beast' label with eloquence. Composes war songs mid-battle. Mourns fallen allies with surprising tenderness. Noble, articulate, defying expectations of brute strength." },
  { id: 'voice_minotaur_warrior', unit: 'minotaur', name: 'Berserker Minotaur', desc: 'Fierce battle cries that echo across the entire battlefield.', price: 250, voiceId: 'SOYHLrjzK2X1ezoPC6cr', sampleText: 'BULL RUSH! OUT OF MY WAY! I will TRAMPLE everything between me and that nexus!', personality: "PURE BERSERKER RAGE. ALL CAPS ENERGY. Screams attack names: 'BULL RUSH!! HORN STRIKE!! GROUND POUND!!' Zero strategy, maximum violence. Charges first, thinks never. Spells out roars: 'RAAAAGH!!'" },
  { id: 'voice_minotaur_confident', unit: 'minotaur', name: 'Confident Minotaur', desc: 'Self-assured power rumbling in every syllable.', price: 220, voiceId: 'IKne3meq5aSn9XLyUdCD', sampleText: 'Size matters. Strength matters. And I have plenty of both. Shall we begin?', personality: "Quiet confidence from overwhelming power. Does not need to shout — whispers are just as threatening. Makes strength-based observations. 'I have plenty of both.' Calm menace." },

  // ── Shaman voices (5) ──
  { id: 'voice_shaman_wise', unit: 'shaman', name: 'Wise Shaman', desc: 'Ancient knowledge channeled through mystical incantations.', price: 250, voiceId: 'pqHfZKP75CvOlQylNhV4', sampleText: 'The spirits whisper of a convergence. Stars align, mana flows, and the arcane answers my call.', personality: "Elder sage. References spirits, stars, and convergences. Every command is a ritual. Says 'the spirits whisper' and 'the arcane answers'. Treats combat as cosmic alignment." },
  { id: 'voice_shaman_storyteller', unit: 'shaman', name: 'Oracle Shaman', desc: 'Warm prophecies delivered with captivating presence.', price: 230, voiceId: 'JBFqnCBsd6RMkjVDRZzb', sampleText: 'I have seen the threads of fate. Your enemy unravels. But we must act before the vision fades.', personality: "Prophet who has seen the future. References 'the threads of fate' and 'visions'. Urgency wrapped in mysticism. Claims to know the outcome but warns timing is critical. Dramatic oracle energy." },
  { id: 'voice_shaman_velvety', unit: 'shaman', name: 'Mystic Shaman', desc: 'Velvety tones weaving spells between syllables.', price: 220, voiceId: 'pFZP5JQG7iQjIQuC4Bku', sampleText: 'Breathe in the arcane. Feel it course through your veins. Now... unleash it.', personality: "Guided meditation meets combat. Tells allies to 'breathe in the arcane' and 'feel the mana flow'. Turns spellcasting into a sensory experience. Soothing, intimate, hypnotic. Dramatic pauses before 'unleash it.'" },
  { id: 'voice_shaman_relaxed', unit: 'shaman', name: 'Serene Shaman', desc: 'Tranquil energy flowing through every word like a gentle stream.', price: 200, voiceId: 'SAz9YHcvj6GT2YYXdXww', sampleText: 'The mana flows where it wills. We do not command it. We simply ask nicely and hope for the best.', personality: "Casual mystic. Admits magic is unpredictable. Says 'we ask nicely and hope for the best'. Downplays arcane power. Shrugs at explosions. 'It does what it does' energy. Accidentally powerful." },
  { id: 'voice_shaman_steady', unit: 'shaman', name: 'Ritualist Shaman', desc: 'Methodical and precise, every word is part of a greater spell.', price: 200, voiceId: 'onwK4e9ZLuTAKqWW03F9', sampleText: 'Initiating hex ward sequence. Arcane barrier at seventy percent. Splash damage reduction active.', personality: "Technical mage. Reports spell percentages and barrier integrity like an engineer. Uses 'initiating', 'calibrating', 'sequence active'. Magic as technology. Zero mysticism, pure spell-science." },

  // ── Troll voices (5) ──
  { id: 'voice_troll_dominant', unit: 'troll', name: 'Dominant Troll', desc: 'Absolute brute force condensed into terrifying speech.', price: 250, voiceId: 'pNInz6obpgDQGcFmaJgB', sampleText: 'TROLL SMASH. TROLL CRUSH. TROLL NOT STOP UNTIL EVERYTHING IS FLAT.', personality: "Alpha troll. Commands respect with short declarative sentences. 'TROLL SAYS SMASH. SO WE SMASH.' Third person but with authority. Every word is final. No arguments tolerated." },
  { id: 'voice_troll_confident', unit: 'troll', name: 'Confident Troll', desc: 'Surprising self-awareness from a walking siege engine.', price: 230, voiceId: 'IKne3meq5aSn9XLyUdCD', sampleText: 'You know what the best part of being a troll is? Regeneration. Hit me all you want. I will heal it all back.', personality: "Surprisingly articulate troll. Self-aware about being a walking tank. Makes strategic observations. 'The best part of being a troll is...' format. Smarter than expected. Still loves smashing." },
  { id: 'voice_troll_warrior', unit: 'troll', name: 'Warchief Troll', desc: 'Fierce leadership from the biggest, meanest troll in the horde.', price: 250, voiceId: 'SOYHLrjzK2X1ezoPC6cr', sampleText: 'The ground SHAKES when I walk! Walls CRUMBLE when I swing! NOTHING can stop the troll!', personality: "Warchief. Describes own destructive power in real-time. 'Ground SHAKES! Walls CRUMBLE!' Hypes himself up. Battle narrator of his own rampage. Screams ability names. UNSTOPPABLE energy." },
  { id: 'voice_troll_storyteller', unit: 'troll', name: 'Elder Troll', desc: 'Warm rumbles from a troll who has seen a thousand battles.', price: 220, voiceId: 'JBFqnCBsd6RMkjVDRZzb', sampleText: 'Long ago, when I was small troll, only twelve feet tall, I learned that patience is the greatest weapon.', personality: "Grandpa troll. Tells stories about 'when troll was small' (twelve feet). Accidentally wise. Nostalgic about past battles. Warm, slow, uses broken grammar charmingly. 'Long ago, troll learn...'" },
  { id: 'voice_troll_deep', unit: 'troll', name: 'Abyssal Troll', desc: 'So deep it sounds like the earth itself is speaking.', price: 220, voiceId: 'nPczCjzI2devNBz1zQrb', sampleText: 'I am the mountain that walks. I am the earthquake that thinks. I am very, very hungry.', personality: "Elemental force of nature. Describes self as geological phenomena. 'I am the mountain that walks.' Ends profound statements with basic needs: '...and I am very hungry.' Cosmic scale meets troll appetite." },
  // ── Snake voices (5) ──
  { id: 'voice_snake_hiss', unit: 'snake', name: 'Venomous Snake', desc: 'Every sibilant word drips with deadly promise.', price: 200, sampleText: 'Sssso many targetsss. Sssso little time. My venom is patient, but I am not.', personality: "Draws out S sounds into hisses. Patient predator. Describes venom lovingly. Cold, calculating, eerily calm." },
  { id: 'voice_snake_wise', unit: 'snake', name: 'Sage Snake', desc: 'Ancient wisdom coils within each measured sentence.', price: 200, sampleText: 'The wise serpent strikes only once. That is all it takes.', personality: "Philosophical snake. Speaks in ancient proverbs about patience and precision. Calm and composed." },
  { id: 'voice_snake_mischief', unit: 'snake', name: 'Trickster Snake', desc: 'Playful and cunning, always one slither ahead.', price: 200, sampleText: 'Peek-a-boo! Did you forget about me? Big mistake. Huge mistake.', personality: "Playful trickster. Pops up unexpectedly. Teases enemies about forgetting it. Cheerful about ambushes." },
  { id: 'voice_snake_cold', unit: 'snake', name: 'Frost Snake', desc: 'An icy whisper that chills the blood before the bite.', price: 220, sampleText: 'Feel the cold settling in? That is my venom working. Do not fight it.', personality: "Cold and clinical. Describes symptoms of its venom in detail. Eerily calm doctor energy." },
  { id: 'voice_snake_royal', unit: 'snake', name: 'King Cobra', desc: 'Regal authority from the sovereign of all serpents.', price: 230, sampleText: 'I am the king of serpents. All lesser creatures bow or become prey.', personality: "Royal snake. Speaks with absolute authority. Expects obedience. Dignified even while attacking." },
  // ── Bear voices (5) ──
  { id: 'voice_bear_grumpy', unit: 'bear', name: 'Grumpy Bear', desc: 'Perpetually annoyed and looking for something to maul.', price: 200, sampleText: 'I was sleeping. You woke me up. This was your last mistake.', personality: "Grumpy and irritable. Was sleeping and got woken up. Blames everyone for disturbing the peace." },
  { id: 'voice_bear_berserker', unit: 'bear', name: 'Berserker Bear', desc: 'Pure rage channeled through a wall of fur and muscle.', price: 200, sampleText: 'RAAAGH! Hit me! HIT ME HARDER! Every wound makes me STRONGER!', personality: "Berserker rage. LOVES getting hit because it makes it stronger. Completely unhinged battle joy." },
  { id: 'voice_bear_gentle', unit: 'bear', name: 'Gentle Bear', desc: 'Soft-spoken and kind, until you threaten the ones it protects.', price: 200, sampleText: 'I do not want to hurt anyone. But I will. Oh, I very much will.', personality: "Gentle giant. Speaks softly and kindly. Apologizes before mauling. Genuine remorse mixed with violence." },
  { id: 'voice_bear_hungry', unit: 'bear', name: 'Hungry Bear', desc: 'Everything is food. Everything.', price: 220, sampleText: 'Is that food? Is THAT food? Everything looks like food when you are this hungry.', personality: "Constantly hungry. Evaluates everything as potential food. Gets distracted by honey and berries." },
  { id: 'voice_bear_ancient', unit: 'bear', name: 'Elder Bear', desc: 'A rumbling voice from the oldest bear in the forest.', price: 230, sampleText: 'I have walked these woods for a thousand winters. I remember when the mountains were young.', personality: "Ancient and wise. Remembers geological time periods. Speaks slowly and deliberately." },
  // ── Harpoon Fish voices (5) ──
  { id: 'voice_harpoon_fish_captain', unit: 'harpoon_fish', name: 'Captain Fish', desc: 'A grizzled sea captain barking orders from the deep.', price: 200, sampleText: 'All hands on deck! Target sighted, two hundred yards! Fire the harpoon!', personality: "Naval captain. Barks orders using nautical terminology. Treats every fight like a ship battle." },
  { id: 'voice_harpoon_fish_stoic', unit: 'harpoon_fish', name: 'Silent Fisher', desc: 'Speaks rarely, but every word hits like a thrown spear.', price: 200, sampleText: 'One shot. One kill. That is the way of the deep.', personality: "Silent sniper. Minimal words, maximum impact. Zen-like focus. Every statement is final." },
  { id: 'voice_harpoon_fish_jolly', unit: 'harpoon_fish', name: 'Jolly Fisher', desc: 'A cheerful fisherman who treats battle like a day at sea.', price: 200, sampleText: 'What a beautiful day for fishing! And by fishing I mean throwing harpoons at your face!', personality: "Cheerful fisherman. Treats combat as a fun fishing trip. Rates enemies by size." },
  { id: 'voice_harpoon_fish_deep', unit: 'harpoon_fish', name: 'Abyssal Fisher', desc: 'Bubbling words from the crushing depths of the ocean floor.', price: 220, sampleText: 'You think you know pressure? I live where light fears to reach.', personality: "Deep-sea philosopher. References crushing depths and darkness. Otherworldly calm." },
  { id: 'voice_harpoon_fish_pirate', unit: 'harpoon_fish', name: 'Pirate Fish', desc: 'Yarr! A swashbuckling fish with a taste for treasure and combat.', price: 230, sampleText: 'Yarr harr! Surrender yer booty or taste me harpoon, ye landlubbers!', personality: "Full pirate. Wants treasure. Threatens with harpoon constantly. Extremely fun." },

  // ── Zesty voices (14) ──
  { id: 'voice_gnome_zesty', unit: 'gnome', name: 'Zesty Gnome', desc: 'Bold sass and fiery attitude packed into the tiniest body on the battlefield.', price: 220, voiceId: 'TX3LPaxmHKxFdv7VOQHJ', sampleText: 'Oh PLEASE. You think that scares me? I have eaten mushrooms scarier than you! Now get OUT of my way, tiny legs coming through!', personality: "Maximum sass in a tiny body. Trash-talks everything and everyone, including allies. Bold, spicy, never backs down from anything. Says 'oh PLEASE' and 'excuse ME' constantly. Roasts enemies for being slow, ugly, or boring. Calls itself fierce despite being three inches tall." },
  { id: 'voice_turtle_zesty', unit: 'turtle', name: 'Zesty Turtle', desc: 'A shell-cracking attitude that proves slow does not mean boring.', price: 220, voiceId: 'FGY2WhTYpPnrIDTdsKH5', sampleText: 'Slow? SLOW? Honey, I am not slow, I am SAVORING the moment. There is a difference. Now watch and LEARN.', personality: "Sassy turtle who is SICK of being called slow. Corrects everyone with attitude. Bold, dramatic, and fabulous. Says 'honey' and 'watch and learn' constantly. Turns every insult into a flex. Treats the shell like a fashion statement." },
  { id: 'voice_skull_zesty', unit: 'skull', name: 'Zesty Skull', desc: 'Death never looked this fabulous or talked this much trash.', price: 220, voiceId: 'TX3LPaxmHKxFdv7VOQHJ', sampleText: 'Oh you are scared of little old me? Sweetie, I am LITERALLY just bones and I still have more personality than your whole team!', personality: "Flamboyant undead diva. Roasts the living for being fragile. Constantly brags about the afterlife perks. Says 'sweetie' and 'honey' while being devastating. Makes death sound glamorous. Snaps fingers between insults (spell out: 'snap snap')." },
  { id: 'voice_spider_zesty', unit: 'spider', name: 'Zesty Spider', desc: 'Eight legs of pure attitude strutting across the battlefield.', price: 220, voiceId: 'cgSgspJ2msm6clMCkdW9', sampleText: 'Oh, you walked into MY web? Bold choice, darling. Bold and very, very stupid. Love that for you.', personality: "Sassy spider fashionista. Treats webs like haute couture. Eight legs means eight times the attitude. Says 'darling' and 'love that for you' dripping with sarcasm. Critiques enemies for their lack of style before wrapping them in silk." },
  { id: 'voice_hyena_zesty', unit: 'hyena', name: 'Zesty Hyena', desc: 'Cackling sass that cuts deeper than any bite.', price: 220, voiceId: 'FGY2WhTYpPnrIDTdsKH5', sampleText: 'AHAHA! Oh no no no, did you just TRY to hit me? That was adorable! Do it again, I need a good laugh!', personality: "Trash-talking hyena who laughs AT enemies, not with them. Mocks every attack that misses. Says 'adorable' sarcastically. Cackles mid-roast (spell out: 'AHAHAHA'). Treats battle like a comedy roast where the enemies are the punchline." },
  { id: 'voice_rogue_zesty', unit: 'rogue', name: 'Zesty Rogue', desc: 'A thief with a sharp tongue and even sharper comebacks.', price: 220, voiceId: 'cgSgspJ2msm6clMCkdW9', sampleText: 'Stealth? Please. I could rob you in broad daylight wearing a NEON sign and you still would not catch me. I am just THAT good.', personality: "Outrageously cocky thief who trash-talks while stealing. Brags about heists mid-combat. Says 'I am just THAT good' and 'you are welcome' unprompted. Over-the-top confidence that somehow backs itself up. Flamboyant and unapologetic." },
  { id: 'voice_panda_zesty', unit: 'panda', name: 'Zesty Panda', desc: 'A fluffy ball of attitude that will sit on you and roast you at the same time.', price: 220, voiceId: 'bIHbv24MWmeRgasZH58o', sampleText: 'Oh you want to fight ME? Cute. Real cute. I eat bamboo thicker than your whole army. Sit DOWN.', personality: "Sassy panda with BIG attitude. Weaponizes cuteness and then hits you with a verbal takedown. Says 'sit DOWN' and 'cute, real cute' to dismiss threats. Compares enemies unfavorably to bamboo. Unbothered queen energy in a fluffy body." },
  { id: 'voice_lizard_zesty', unit: 'lizard', name: 'Zesty Lizard', desc: 'Cold-blooded confidence with a razor tongue to match.', price: 220, voiceId: 'IKne3meq5aSn9XLyUdCD', sampleText: 'Oh, was that your best attack? How... quaint. My scales have seen better scratches from a gentle breeze. Try HARDER, darling.', personality: "Condescending reptilian diva. Calls everything 'quaint' or 'precious'. Treats enemies like amateurs at a talent show being judged. Says 'try harder, darling' and 'bless your heart'. Cold-blooded in attitude AND temperature. Absolute ruthless sass." },
  { id: 'voice_minotaur_zesty', unit: 'minotaur', name: 'Zesty Minotaur', desc: 'Thundering hooves and a personality that hits even harder.', price: 220, voiceId: 'SOYHLrjzK2X1ezoPC6cr', sampleText: 'Move. NOW. I did NOT wake up this fabulous to wait behind ANYONE. These horns are not just for show, people!', personality: "Diva minotaur who treats the battlefield like a runway. Bold, brash, and LOUD. Says 'I did NOT wake up this fabulous to...' as a catchphrase. Refers to horns as a fashion accessory AND a weapon. Commands attention and destroys anyone who does not give it." },
  { id: 'voice_shaman_zesty', unit: 'shaman', name: 'Zesty Shaman', desc: 'Arcane sass that makes spells hit different.', price: 220, voiceId: 'FGY2WhTYpPnrIDTdsKH5', sampleText: 'Oh, you brought a SWORD to a MAGIC fight? That is embarrassing for you. Let me show you what REAL power looks like, sweetie.', personality: "Sassy mage who judges everyone for not using magic. Roasts melee fighters constantly. Says 'sweetie' and 'that is embarrassing for you' while casting devastating spells. Treats spellcasting like an art form and everyone else like amateurs. Dramatic hand gestures described mid-speech." },
  { id: 'voice_troll_zesty', unit: 'troll', name: 'Zesty Troll', desc: 'Big mouth, bigger attitude, biggest troll on the field.', price: 220, voiceId: 'SOYHLrjzK2X1ezoPC6cr', sampleText: 'Oh you hit troll? CUTE. Troll REGENERATE. Troll also REMEMBER. And troll hold a GRUDGE, baby!', personality: "Sassy troll who talks in third person with massive attitude. Speaks in broken grammar but the trash talk is FLAWLESS. Says 'troll remember' as a threat. Calls enemies 'baby' condescendingly. Weaponizes regeneration as a flex -- brags about healing from hits. Loudest personality on the battlefield." },
  { id: 'voice_snake_zesty', unit: 'snake', name: 'Zesty Snake', desc: 'A serpent with venomous wit and enough attitude to fill a whole pit.', price: 220, sampleText: 'Excussse me, did you just ssstep on my tail? Oh honey, you have NO idea what you jussst started.', personality: "Sassy diva serpent. Draws out S sounds dramatically. Talks like a reality TV star who happens to be a deadly snake. Says 'oh honey' and 'excussse me' constantly. Critiques enemies' fashion and fighting style. Venomous in both senses." },
  { id: 'voice_bear_zesty', unit: 'bear', name: 'Zesty Bear', desc: 'A bear with big opinions and zero patience for nonsense.', price: 220, sampleText: 'Oh you want some of THIS? Honey, I am twelve hundred pounds of DO NOT MESS WITH ME. Read the room!', personality: "Sassy bear who is done with everyone's nonsense. Uses 'honey' as both a term of endearment and a threat. Says 'read the room' and 'do NOT' with dramatic emphasis. Big, loud, and full of opinions. Protective sass -- roasts enemies who threaten allies even harder." },
  { id: 'voice_harpoon_fish_zesty', unit: 'harpoon_fish', name: 'Zesty Fisher', desc: 'A fish with a harpoon and a mouth sharper than both.', price: 220, sampleText: 'Oh you think you can dodge MY harpoon? Sweetheart, I hit targets in the DARK at the bottom of the OCEAN. You do not stand a CHANCE.', personality: "Sassy sharpshooter fish who never misses and never shuts up about it. Brags about impossible shots. Says 'sweetheart' before devastating trash talk. Flexes ocean survival as proof of superiority. Dramatic about every harpoon throw like a diva taking a bow." },
];

for (const vp of VOICE_PACKS) {
  catalog.push({
    id: vp.id,
    category: 'voice_pack',
    name: vp.name,
    description: vp.desc,
    rarity: 'rare',
    priceCrowns: vp.price,
    priceGlory: null,
    unitType: vp.unit,
    voiceId: vp.voiceId,
    sampleText: vp.sampleText,
    personality: vp.personality,
  });
}

// ═════════════════════════════════════════════════════════════════
//  VOICE EFFECTS  (5 items)
// ═════════════════════════════════════════════════════════════════

const VOICE_EFFECTS: { id: string; name: string; desc: string; rarity: Rarity; price: number }[] = [
  { id: 'voice_fx_echo', name: 'Cavern Echo', desc: 'Every callout reverberates like a shout in a vast cave.', rarity: 'epic', price: 300 },
  { id: 'voice_fx_deep', name: 'Abyssal Depths', desc: 'Pitch-shifted to a rumbling, earth-shaking bass.', rarity: 'epic', price: 350 },
  { id: 'voice_fx_chipmunk', name: 'Chipmunk Chatter', desc: 'Sped-up squeaky vocals — maximum chaos energy.', rarity: 'epic', price: 300 },
  { id: 'voice_fx_robot', name: 'Automaton Protocol', desc: 'Metallic, synthesized speech from a clockwork throat.', rarity: 'epic', price: 400 },
  { id: 'voice_fx_ethereal', name: 'Ethereal Whisper', desc: 'Otherworldly harmonic overtones from beyond the veil.', rarity: 'legendary', price: 700 },
];

for (const vfx of VOICE_EFFECTS) {
  catalog.push({
    id: vfx.id,
    category: 'voice_effect',
    name: vfx.name,
    description: vfx.desc,
    rarity: vfx.rarity,
    priceCrowns: vfx.price,
    priceGlory: null,
  });
}

// ═════════════════════════════════════════════════════════════════
//  EQUIPMENT COSMETICS  (15 items — 3 tiers × 5 equipment types)
// ═════════════════════════════════════════════════════════════════

type EquipmentType = 'pickaxe' | 'sword' | 'shield' | 'boots' | 'banner';

const EQUIP_TYPES: EquipmentType[] = ['pickaxe', 'sword', 'shield', 'boots', 'banner'];

const EQUIP_NAMES: Record<EquipmentType, string> = {
  pickaxe: 'Pickaxe',
  sword: 'Sword',
  shield: 'Shield',
  boots: 'Boots',
  banner: 'Banner',
};

// Enchanted tier (blue glow, common, glory-purchasable)
const ENCHANTED_DESCS: Record<EquipmentType, string> = {
  pickaxe: 'A steadily pulsing blue aura coats the pick head.',
  sword: 'Azure runes shimmer along the blade when drawn.',
  shield: 'A sapphire ward glows across the shield face.',
  boots: 'Blue sparks trail from the soles with each stride.',
  banner: 'Cerulean light ripples through the fabric like water.',
};

for (const eq of EQUIP_TYPES) {
  catalog.push({
    id: `equip_${eq}_enchanted`,
    category: 'equipment_cosmetic',
    name: `Enchanted ${EQUIP_NAMES[eq]}`,
    description: ENCHANTED_DESCS[eq],
    rarity: 'common',
    priceCrowns: 0,
    priceGlory: 1500,
    equipType: eq,
  });
}

// Infernal tier (fire, rare)
const INFERNAL_DESCS: Record<EquipmentType, string> = {
  pickaxe: 'Hellfire erupts from the strike point with every swing.',
  sword: 'Flames dance along the edge, scorching the air around it.',
  shield: 'Molten lava flows across the face in a mesmerising pattern.',
  boots: 'Charred footprints smoulder behind the wearer.',
  banner: 'The fabric is living flame — it burns but is never consumed.',
};

for (const eq of EQUIP_TYPES) {
  catalog.push({
    id: `equip_${eq}_infernal`,
    category: 'equipment_cosmetic',
    name: `Infernal ${EQUIP_NAMES[eq]}`,
    description: INFERNAL_DESCS[eq],
    rarity: 'rare',
    priceCrowns: 250,
    priceGlory: null,
    equipType: eq,
  });
}

// Celestial tier (gold, epic)
const CELESTIAL_DESCS: Record<EquipmentType, string> = {
  pickaxe: 'Forged from condensed starlight, it hums with cosmic power.',
  sword: 'A blade of pure golden radiance that cuts through darkness.',
  shield: 'A disc of orbiting celestial bodies deflects all harm.',
  boots: 'Walk on beams of sunlight — gravity is merely a suggestion.',
  banner: 'Woven from threads of dawn, it inspires awe in all who see it.',
};

for (const eq of EQUIP_TYPES) {
  catalog.push({
    id: `equip_${eq}_celestial`,
    category: 'equipment_cosmetic',
    name: `Celestial ${EQUIP_NAMES[eq]}`,
    description: CELESTIAL_DESCS[eq],
    rarity: 'epic',
    priceCrowns: 400,
    priceGlory: null,
    equipType: eq,
  });
}

// ═════════════════════════════════════════════════════════════════
//  BUILDING THEMES  (6 items)
// ═════════════════════════════════════════════════════════════════

const BUILDING_THEMES: { id: string; name: string; desc: string; rarity: Rarity; price: number }[] = [
  { id: 'building_winter_castle', name: 'Winter Castle', desc: 'All structures become ice-crusted fairy-tale fortresses.', rarity: 'epic', price: 800 },
  { id: 'building_dark_fortress', name: 'Dark Fortress', desc: 'Obsidian walls, spiked battlements, and ominous red torches.', rarity: 'epic', price: 850 },
  { id: 'building_desert_citadel', name: 'Desert Citadel', desc: 'Sandstone domes and golden minarets shimmer in the heat.', rarity: 'epic', price: 850 },
  { id: 'building_crystal_palace', name: 'Crystal Palace', desc: 'Every surface is faceted crystal refracting prismatic light.', rarity: 'legendary', price: 1000 },
  { id: 'building_haunted_manor', name: 'Haunted Manor', desc: 'Creaking wood, flickering candles, and ghostly apparitions.', rarity: 'epic', price: 900 },
  { id: 'building_celestial_spire', name: 'Celestial Spire', desc: 'Gravity-defying towers of gold reaching into the cosmos.', rarity: 'legendary', price: 1000 },
];

for (const bt of BUILDING_THEMES) {
  catalog.push({
    id: bt.id,
    category: 'building_theme',
    name: bt.name,
    description: bt.desc,
    rarity: bt.rarity,
    priceCrowns: bt.price,
    priceGlory: null,
  });
}

// ═════════════════════════════════════════════════════════════════
//  MAP THEMES  (6 items)
// ═════════════════════════════════════════════════════════════════

const MAP_THEMES: { id: string; name: string; desc: string; rarity: Rarity; price: number }[] = [
  { id: 'map_cherry_blossom', name: 'Cherry Blossom Fields', desc: 'Soft pink petals blanket the battlefield in endless spring.', rarity: 'rare', price: 350 },
  { id: 'map_eternal_night', name: 'Eternal Night', desc: 'A moonlit realm where the sun never rises and stars blaze.', rarity: 'epic', price: 600 },
  { id: 'map_frozen_wastes', name: 'Frozen Wastes', desc: 'Howling blizzards and cracking ice sheets across the tundra.', rarity: 'epic', price: 600 },
  { id: 'map_scorching_sands', name: 'Scorching Sands', desc: 'Endless dunes ripple under a merciless sun — mirages shimmer.', rarity: 'epic', price: 650 },
  { id: 'map_haunted_realm', name: 'Haunted Realm', desc: 'Fog-choked graveyards and spectral ruins dot the landscape.', rarity: 'epic', price: 700 },
  { id: 'map_volcanic_depths', name: 'Volcanic Depths', desc: 'Rivers of lava carve through obsidian cliffs beneath a red sky.', rarity: 'legendary', price: 1000 },
];

for (const mt of MAP_THEMES) {
  catalog.push({
    id: mt.id,
    category: 'map_theme',
    name: mt.name,
    description: mt.desc,
    rarity: mt.rarity,
    priceCrowns: mt.price,
    priceGlory: null,
  });
}

// ═════════════════════════════════════════════════════════════════
//  DEATH EFFECTS  (6 items)
// ═════════════════════════════════════════════════════════════════

const DEATH_EFFECTS: { id: string; name: string; desc: string; rarity: Rarity; price: number }[] = [
  { id: 'death_shatter', name: 'Shatter', desc: 'Units explode into a shower of glass-like fragments.', rarity: 'common', price: 100 },
  { id: 'death_poof', name: 'Poof!', desc: 'A comical puff of colourful smoke and confetti.', rarity: 'common', price: 100 },
  { id: 'death_immolation', name: 'Immolation', desc: 'Engulfed in roaring flame before crumbling to ash.', rarity: 'rare', price: 250 },
  { id: 'death_flash_freeze', name: 'Flash Freeze', desc: 'Instantly frozen solid, then cracks into icy shards.', rarity: 'rare', price: 250 },
  { id: 'death_void_collapse', name: 'Void Collapse', desc: 'A miniature black hole swallows the unit whole.', rarity: 'epic', price: 500 },
  { id: 'death_flower_burst', name: 'Flower Burst', desc: 'A beautiful explosion of petals and golden pollen.', rarity: 'legendary', price: 700 },
];

for (const de of DEATH_EFFECTS) {
  catalog.push({
    id: de.id,
    category: 'death_effect',
    name: de.name,
    description: de.desc,
    rarity: de.rarity,
    priceCrowns: de.price,
    priceGlory: null,
  });
}

// ═════════════════════════════════════════════════════════════════
//  SPAWN EFFECTS  (3 items)
// ═════════════════════════════════════════════════════════════════

const SPAWN_EFFECTS: { id: string; name: string; desc: string; rarity: Rarity; price: number }[] = [
  { id: 'spawn_lightning_strike', name: 'Lightning Strike', desc: 'A bolt of lightning crashes down, revealing the unit in the flash.', rarity: 'rare', price: 200 },
  { id: 'spawn_dark_portal', name: 'Dark Portal', desc: 'A swirling vortex of shadow tears open, and the unit steps through.', rarity: 'epic', price: 350 },
  { id: 'spawn_nature_growth', name: 'Nature Growth', desc: 'Roots and vines burst from the earth, blossoming into the unit.', rarity: 'rare', price: 250 },
];

for (const se of SPAWN_EFFECTS) {
  catalog.push({
    id: se.id,
    category: 'spawn_effect',
    name: se.name,
    description: se.desc,
    rarity: se.rarity,
    priceCrowns: se.price,
    priceGlory: null,
  });
}

// ═════════════════════════════════════════════════════════════════
//  ATTACK TRAILS  (4 items)
// ═════════════════════════════════════════════════════════════════

const ATTACK_TRAILS: { id: string; name: string; desc: string; rarity: Rarity; price: number }[] = [
  { id: 'trail_fire', name: 'Fire Trail', desc: 'Attacks leave blazing streaks of flame across the battlefield.', rarity: 'rare', price: 200 },
  { id: 'trail_ice', name: 'Ice Trail', desc: 'A frozen crystalline wake follows every strike.', rarity: 'rare', price: 200 },
  { id: 'trail_lightning', name: 'Lightning Trail', desc: 'Crackling electricity arcs between the attacker and the target.', rarity: 'epic', price: 350 },
  { id: 'trail_stars', name: 'Star Trail', desc: 'A cascade of twinkling stars showers from each blow.', rarity: 'epic', price: 400 },
];

for (const at of ATTACK_TRAILS) {
  catalog.push({
    id: at.id,
    category: 'attack_trail',
    name: at.name,
    description: at.desc,
    rarity: at.rarity,
    priceCrowns: at.price,
    priceGlory: null,
  });
}

// ═════════════════════════════════════════════════════════════════
//  VICTORY EFFECTS  (5 items)
// ═════════════════════════════════════════════════════════════════

const VICTORY_EFFECTS: { id: string; name: string; desc: string; rarity: Rarity; price: number }[] = [
  { id: 'victory_fireworks', name: 'Fireworks', desc: 'A dazzling sky-wide firework display erupts on victory.', rarity: 'common', price: 100 },
  { id: 'victory_confetti', name: 'Confetti Cannon', desc: 'A blizzard of rainbow confetti showers the arena.', rarity: 'common', price: 100 },
  { id: 'victory_thunder', name: 'Thunderclap', desc: 'A deafening thunderbolt splits the sky in triumph.', rarity: 'rare', price: 200 },
  { id: 'victory_inferno', name: 'Victory Inferno', desc: 'The entire map erupts in a ring of towering fire.', rarity: 'epic', price: 350 },
  { id: 'victory_aurora', name: 'Aurora Borealis', desc: 'Majestic northern lights dance across the heavens.', rarity: 'epic', price: 400 },
];

for (const ve of VICTORY_EFFECTS) {
  catalog.push({
    id: ve.id,
    category: 'victory_effect',
    name: ve.name,
    description: ve.desc,
    rarity: ve.rarity,
    priceCrowns: ve.price,
    priceGlory: null,
  });
}

// ═════════════════════════════════════════════════════════════════
//  EMOTES  (100 items — emoji/emoticon based)
// ═════════════════════════════════════════════════════════════════

const ALL_EMOTES: { id: string; name: string; emoji: string; rarity: Rarity; price: number; glory: number | null }[] = [
  // ── FREE (3 emotes everyone gets) ──
  // These are granted on account creation, but still listed for display

  // ── Common (25 crowns, 300 glory) ── Basic expressions
  { id: 'emote_gg',          name: 'GG',            emoji: '\uD83E\uDD1D', rarity: 'common', price: 25, glory: 300 },
  { id: 'emote_wave',        name: 'Wave',          emoji: '\uD83D\uDC4B', rarity: 'common', price: 25, glory: 300 },
  { id: 'emote_wow',         name: 'Wow',           emoji: '\uD83D\uDE2E', rarity: 'common', price: 25, glory: 300 },
  { id: 'emote_thumbsup',    name: 'Thumbs Up',     emoji: '\uD83D\uDC4D', rarity: 'common', price: 25, glory: 300 },
  { id: 'emote_thumbsdown',  name: 'Thumbs Down',   emoji: '\uD83D\uDC4E', rarity: 'common', price: 25, glory: 300 },
  { id: 'emote_clap',        name: 'Clap',          emoji: '\uD83D\uDC4F', rarity: 'common', price: 25, glory: 300 },
  { id: 'emote_smile',       name: 'Smile',         emoji: '\uD83D\uDE04', rarity: 'common', price: 25, glory: 300 },
  { id: 'emote_wink',        name: 'Wink',          emoji: '\uD83D\uDE09', rarity: 'common', price: 25, glory: 300 },
  { id: 'emote_think',       name: 'Thinking',      emoji: '\uD83E\uDD14', rarity: 'common', price: 25, glory: 300 },
  { id: 'emote_shrug',       name: 'Shrug',         emoji: '\uD83E\uDD37', rarity: 'common', price: 25, glory: 300 },
  { id: 'emote_pray',        name: 'Please',        emoji: '\uD83D\uDE4F', rarity: 'common', price: 25, glory: 300 },
  { id: 'emote_ok',          name: 'OK',            emoji: '\uD83D\uDC4C', rarity: 'common', price: 25, glory: 300 },
  { id: 'emote_peace',       name: 'Peace',         emoji: '\u270C\uFE0F', rarity: 'common', price: 25, glory: 300 },
  { id: 'emote_salute',      name: 'Salute',        emoji: '\uD83E\uDEE1', rarity: 'common', price: 25, glory: 300 },
  { id: 'emote_eyes',        name: 'Eyes',          emoji: '\uD83D\uDC40', rarity: 'common', price: 25, glory: 300 },

  // ── Common (50 crowns) ── Emotions
  { id: 'emote_lol',         name: 'LOL',           emoji: '\uD83D\uDE02', rarity: 'common', price: 50, glory: null },
  { id: 'emote_cry',         name: 'Cry',           emoji: '\uD83D\uDE22', rarity: 'common', price: 50, glory: null },
  { id: 'emote_rage',        name: 'Rage',          emoji: '\uD83D\uDE21', rarity: 'common', price: 50, glory: null },
  { id: 'emote_heart',       name: 'Heart',         emoji: '\u2764\uFE0F', rarity: 'common', price: 50, glory: null },
  { id: 'emote_broken',      name: 'Heartbreak',    emoji: '\uD83D\uDC94', rarity: 'common', price: 50, glory: null },
  { id: 'emote_sleepy',      name: 'Sleepy',        emoji: '\uD83D\uDE34', rarity: 'common', price: 50, glory: null },
  { id: 'emote_sweat',       name: 'Nervous',       emoji: '\uD83D\uDE05', rarity: 'common', price: 50, glory: null },
  { id: 'emote_scream',      name: 'Scream',        emoji: '\uD83D\uDE31', rarity: 'common', price: 50, glory: null },
  { id: 'emote_cool',        name: 'Cool',          emoji: '\uD83D\uDE0E', rarity: 'common', price: 50, glory: null },
  { id: 'emote_nerd',        name: 'Nerd',          emoji: '\uD83E\uDD13', rarity: 'common', price: 50, glory: null },
  { id: 'emote_dizzy',       name: 'Dizzy',         emoji: '\uD83D\uDE35', rarity: 'common', price: 50, glory: null },
  { id: 'emote_sick',        name: 'Sick',          emoji: '\uD83E\uDD22', rarity: 'common', price: 50, glory: null },
  { id: 'emote_hot',         name: 'Hot',           emoji: '\uD83E\uDD75', rarity: 'common', price: 50, glory: null },
  { id: 'emote_cold',        name: 'Cold',          emoji: '\uD83E\uDD76', rarity: 'common', price: 50, glory: null },
  { id: 'emote_mindblown',   name: 'Mind Blown',    emoji: '\uD83E\uDD2F', rarity: 'common', price: 50, glory: null },

  // ── Rare (100 crowns) ── Battle & Taunt
  { id: 'emote_crown',       name: 'Crown',         emoji: '\uD83D\uDC51', rarity: 'rare', price: 100, glory: null },
  { id: 'emote_skull',       name: 'Skull',         emoji: '\uD83D\uDC80', rarity: 'rare', price: 100, glory: null },
  { id: 'emote_fire',        name: 'Fire',          emoji: '\uD83D\uDD25', rarity: 'rare', price: 100, glory: null },
  { id: 'emote_sword',       name: 'Swords',        emoji: '\u2694\uFE0F', rarity: 'rare', price: 100, glory: null },
  { id: 'emote_shield',      name: 'Shield',        emoji: '\uD83D\uDEE1\uFE0F', rarity: 'rare', price: 100, glory: null },
  { id: 'emote_trophy',      name: 'Trophy',        emoji: '\uD83C\uDFC6', rarity: 'rare', price: 100, glory: null },
  { id: 'emote_medal',       name: 'Medal',         emoji: '\uD83C\uDFC5', rarity: 'rare', price: 100, glory: null },
  { id: 'emote_muscle',      name: 'Flex',          emoji: '\uD83D\uDCAA', rarity: 'rare', price: 100, glory: null },
  { id: 'emote_fist',        name: 'Fist Bump',     emoji: '\uD83E\uDD1C', rarity: 'rare', price: 100, glory: null },
  { id: 'emote_handshake',   name: 'Handshake',     emoji: '\uD83E\uDD1D', rarity: 'rare', price: 100, glory: null },
  { id: 'emote_target',      name: 'Target',        emoji: '\uD83C\uDFAF', rarity: 'rare', price: 100, glory: null },
  { id: 'emote_bomb',        name: 'Bomb',          emoji: '\uD83D\uDCA3', rarity: 'rare', price: 100, glory: null },
  { id: 'emote_lightning',   name: 'Lightning',     emoji: '\u26A1', rarity: 'rare', price: 100, glory: null },
  { id: 'emote_tornado',     name: 'Tornado',       emoji: '\uD83C\uDF2A\uFE0F', rarity: 'rare', price: 100, glory: null },
  { id: 'emote_ghost',       name: 'Ghost',         emoji: '\uD83D\uDC7B', rarity: 'rare', price: 100, glory: null },
  { id: 'emote_alien',       name: 'Alien',         emoji: '\uD83D\uDC7D', rarity: 'rare', price: 100, glory: null },
  { id: 'emote_robot',       name: 'Robot',         emoji: '\uD83E\uDD16', rarity: 'rare', price: 100, glory: null },
  { id: 'emote_devil',       name: 'Devil',         emoji: '\uD83D\uDE08', rarity: 'rare', price: 100, glory: null },
  { id: 'emote_angel',       name: 'Angel',         emoji: '\uD83D\uDE07', rarity: 'rare', price: 100, glory: null },
  { id: 'emote_money',       name: 'Money',         emoji: '\uD83D\uDCB0', rarity: 'rare', price: 100, glory: null },

  // ── Rare (150 crowns) ── Nature & Animals
  { id: 'emote_dragon',      name: 'Dragon',        emoji: '\uD83D\uDC09', rarity: 'rare', price: 150, glory: null },
  { id: 'emote_wolf',        name: 'Wolf',          emoji: '\uD83D\uDC3A', rarity: 'rare', price: 150, glory: null },
  { id: 'emote_snake',       name: 'Snake',         emoji: '\uD83D\uDC0D', rarity: 'rare', price: 150, glory: null },
  { id: 'emote_eagle',       name: 'Eagle',         emoji: '\uD83E\uDD85', rarity: 'rare', price: 150, glory: null },
  { id: 'emote_bear',        name: 'Bear',          emoji: '\uD83D\uDC3B', rarity: 'rare', price: 150, glory: null },
  { id: 'emote_spider_e',    name: 'Spider',        emoji: '\uD83D\uDD77\uFE0F', rarity: 'rare', price: 150, glory: null },
  { id: 'emote_bat',         name: 'Bat',           emoji: '\uD83E\uDD87', rarity: 'rare', price: 150, glory: null },
  { id: 'emote_octopus',     name: 'Octopus',       emoji: '\uD83D\uDC19', rarity: 'rare', price: 150, glory: null },
  { id: 'emote_phoenix',     name: 'Phoenix',       emoji: '\uD83D\uDD25', rarity: 'rare', price: 150, glory: null },
  { id: 'emote_unicorn',     name: 'Unicorn',       emoji: '\uD83E\uDD84', rarity: 'rare', price: 150, glory: null },

  // ── Epic (200 crowns) ── Reactions & Memes
  { id: 'emote_dancing',     name: 'Dance',         emoji: '\uD83D\uDD7A', rarity: 'epic', price: 200, glory: null },
  { id: 'emote_flexing',     name: 'Power Pose',    emoji: '\uD83E\uDDD8', rarity: 'epic', price: 200, glory: null },
  { id: 'emote_laughing',    name: 'ROFL',          emoji: '\uD83E\uDD23', rarity: 'epic', price: 200, glory: null },
  { id: 'emote_sleeping',    name: 'Zzz',           emoji: '\uD83D\uDE34', rarity: 'epic', price: 200, glory: null },
  { id: 'emote_explosion',   name: 'Explosion',     emoji: '\uD83D\uDCA5', rarity: 'epic', price: 200, glory: null },
  { id: 'emote_sparkles',    name: 'Sparkles',      emoji: '\u2728',       rarity: 'epic', price: 200, glory: null },
  { id: 'emote_rainbow',     name: 'Rainbow',       emoji: '\uD83C\uDF08', rarity: 'epic', price: 200, glory: null },
  { id: 'emote_star',        name: 'Star',          emoji: '\u2B50',       rarity: 'epic', price: 200, glory: null },
  { id: 'emote_moon',        name: 'Moon',          emoji: '\uD83C\uDF19', rarity: 'epic', price: 200, glory: null },
  { id: 'emote_sun',         name: 'Sun',           emoji: '\u2600\uFE0F', rarity: 'epic', price: 200, glory: null },
  { id: 'emote_comet',       name: 'Comet',         emoji: '\u2604\uFE0F', rarity: 'epic', price: 200, glory: null },
  { id: 'emote_crystal',     name: 'Crystal Ball',  emoji: '\uD83D\uDD2E', rarity: 'epic', price: 200, glory: null },
  { id: 'emote_magic',       name: 'Magic Wand',    emoji: '\uD83E\uDE84', rarity: 'epic', price: 200, glory: null },
  { id: 'emote_potion',      name: 'Potion',        emoji: '\uD83E\uDDEA', rarity: 'epic', price: 200, glory: null },
  { id: 'emote_dice',        name: 'Dice',          emoji: '\uD83C\uDFB2', rarity: 'epic', price: 200, glory: null },

  // ── Epic (300 crowns) ── Taunts
  { id: 'emote_battle_cry',  name: 'Battle Cry',    emoji: '\uD83D\uDDE3\uFE0F', rarity: 'epic', price: 300, glory: null },
  { id: 'emote_mock',        name: 'Mock',          emoji: '\uD83E\uDD2A', rarity: 'epic', price: 300, glory: null },
  { id: 'emote_cheer',       name: 'Cheer',         emoji: '\uD83C\uDF89', rarity: 'epic', price: 300, glory: null },
  { id: 'emote_rip',         name: 'RIP',           emoji: '\uD83E\uDEA6', rarity: 'epic', price: 300, glory: null },
  { id: 'emote_clown',       name: 'Clown',         emoji: '\uD83E\uDD21', rarity: 'epic', price: 300, glory: null },

  // ── Legendary (500 crowns) ── Premium
  { id: 'emote_infinity',    name: 'Infinity',      emoji: '\u267E\uFE0F', rarity: 'legendary', price: 500, glory: null },
  { id: 'emote_diamond',     name: 'Diamond',       emoji: '\uD83D\uDC8E', rarity: 'legendary', price: 500, glory: null },
  { id: 'emote_trident',     name: 'Trident',       emoji: '\uD83D\uDD31', rarity: 'legendary', price: 500, glory: null },
  { id: 'emote_eye_of_ra',   name: 'Eye of Ra',     emoji: '\uD83D\uDC41\uFE0F', rarity: 'legendary', price: 500, glory: null },
  { id: 'emote_yin_yang',    name: 'Yin Yang',      emoji: '\u262F\uFE0F', rarity: 'legendary', price: 500, glory: null },
];

for (const e of ALL_EMOTES) {
  catalog.push({
    id: e.id,
    category: 'emote',
    name: e.name,
    description: `Show the ${e.emoji} ${e.name} emote in battle.`,
    rarity: e.rarity,
    priceCrowns: e.price,
    priceGlory: e.glory,
  });
}

// ═════════════════════════════════════════════════════════════════
//  PROFILE TITLES
// ═════════════════════════════════════════════════════════════════

const PROFILE_TITLES: { id: string; name: string; desc: string; rarity: Rarity; price: number }[] = [
  // Common (50-75 crowns)
  { id: 'title_the_magnificent', name: 'The Magnificent', desc: 'Proclaim your greatness for all to see.', rarity: 'common', price: 75 },
  { id: 'title_recruit', name: 'Recruit', desc: 'Everyone starts somewhere.', rarity: 'common', price: 50 },
  { id: 'title_wanderer', name: 'Wanderer', desc: 'No home, no master — just the road.', rarity: 'common', price: 50 },
  { id: 'title_strategist', name: 'Strategist', desc: 'Every move is calculated.', rarity: 'common', price: 75 },
  { id: 'title_horde_whisperer', name: 'Horde Whisperer', desc: 'They listen when you speak.', rarity: 'common', price: 75 },
  // Rare (100-200 crowns)
  { id: 'title_chaos_lord', name: 'Chaos Lord', desc: 'A title whispered in fear by lesser horde masters.', rarity: 'rare', price: 150 },
  { id: 'title_grand_marshal', name: 'Grand Marshal', desc: 'Commander of armies, strategist without equal.', rarity: 'rare', price: 200 },
  { id: 'title_beast_tamer', name: 'Beast Tamer', desc: 'Wild things bow before your will.', rarity: 'rare', price: 120 },
  { id: 'title_iron_will', name: 'Iron Will', desc: 'Unbroken. Unbowed. Unmatched.', rarity: 'rare', price: 150 },
  { id: 'title_war_chief', name: 'War Chief', desc: 'The hordes rally to your banner.', rarity: 'rare', price: 175 },
  { id: 'title_shadow_walker', name: 'Shadow Walker', desc: 'Seen by none, feared by all.', rarity: 'rare', price: 150 },
  { id: 'title_nexus_breaker', name: 'Nexus Breaker', desc: 'Fortresses crumble at your approach.', rarity: 'rare', price: 200 },
  // Epic (250-400 crowns)
  { id: 'title_doom_bringer', name: 'Doom Bringer', desc: 'Where you march, destruction follows.', rarity: 'epic', price: 250 },
  { id: 'title_soul_reaver', name: 'Soul Reaver', desc: 'Your enemies fall, and they do not rise.', rarity: 'epic', price: 300 },
  { id: 'title_arcane_sovereign', name: 'Arcane Sovereign', desc: 'Magic bends to your command.', rarity: 'epic', price: 350 },
  { id: 'title_the_undying', name: 'The Undying', desc: 'Death has tried. Death has failed.', rarity: 'epic', price: 300 },
  { id: 'title_world_eater', name: 'World Eater', desc: 'Maps are redrawn in your wake.', rarity: 'epic', price: 400 },
  // Legendary (500+ crowns)
  { id: 'title_the_eternal', name: 'The Eternal', desc: 'Legends fade. You do not.', rarity: 'legendary', price: 500 },
  { id: 'title_god_king', name: 'God-King', desc: 'Mortals kneel. Even the gods take notice.', rarity: 'legendary', price: 750 },
  { id: 'title_lord_of_hordes', name: 'Lord of Hordes', desc: 'The ultimate title. Every creature in the realm answers to you.', rarity: 'legendary', price: 1000 },
];

for (const t of PROFILE_TITLES) {
  catalog.push({
    id: t.id,
    category: 'profile_title',
    name: t.name,
    description: t.desc,
    rarity: t.rarity,
    priceCrowns: t.price,
    priceGlory: null,
  });
}

// ═════════════════════════════════════════════════════════════════
//  PROFILE BANNER COLORS  (30 items)
// ═════════════════════════════════════════════════════════════════

const BANNER_COLORS: { id: string; name: string; hex: string; rarity: Rarity; price: number }[] = [
  // Common solids (25 crowns each)
  { id: 'banner_crimson',        name: 'Crimson',         hex: '#DC143C', rarity: 'common', price: 25 },
  { id: 'banner_navy',           name: 'Navy',            hex: '#1B2A4A', rarity: 'common', price: 25 },
  { id: 'banner_forest',         name: 'Forest',          hex: '#228B22', rarity: 'common', price: 25 },
  { id: 'banner_slate',          name: 'Slate',           hex: '#4A5568', rarity: 'common', price: 25 },
  { id: 'banner_midnight',       name: 'Midnight',        hex: '#0D1117', rarity: 'common', price: 25 },
  { id: 'banner_copper',         name: 'Copper',          hex: '#B87333', rarity: 'common', price: 25 },
  { id: 'banner_sand',           name: 'Sand',            hex: '#C2B280', rarity: 'common', price: 25 },
  { id: 'banner_charcoal',       name: 'Charcoal',        hex: '#2D2D2D', rarity: 'common', price: 25 },
  { id: 'banner_ivory',          name: 'Ivory',           hex: '#FFFFF0', rarity: 'common', price: 25 },
  { id: 'banner_wine',           name: 'Wine',            hex: '#722F37', rarity: 'common', price: 25 },
  // Rare vibrants (75 crowns each)
  { id: 'banner_royal_purple',   name: 'Royal Purple',    hex: '#7B2D8E', rarity: 'rare', price: 75 },
  { id: 'banner_ocean_blue',     name: 'Ocean Blue',      hex: '#006994', rarity: 'rare', price: 75 },
  { id: 'banner_emerald',        name: 'Emerald',         hex: '#50C878', rarity: 'rare', price: 75 },
  { id: 'banner_sunset_orange',  name: 'Sunset Orange',   hex: '#FF6347', rarity: 'rare', price: 75 },
  { id: 'banner_arctic_blue',    name: 'Arctic Blue',     hex: '#71A6D2', rarity: 'rare', price: 75 },
  { id: 'banner_rose',           name: 'Rose',            hex: '#E75480', rarity: 'rare', price: 75 },
  { id: 'banner_teal',           name: 'Teal',            hex: '#008080', rarity: 'rare', price: 75 },
  { id: 'banner_amber',          name: 'Amber',           hex: '#FFBF00', rarity: 'rare', price: 75 },
  { id: 'banner_lavender',       name: 'Lavender',        hex: '#B57EDC', rarity: 'rare', price: 75 },
  { id: 'banner_moss',           name: 'Moss',            hex: '#8A9A5B', rarity: 'rare', price: 75 },
  // Epic gradients / special (150 crowns each)
  { id: 'banner_blood_moon',     name: 'Blood Moon',      hex: '#8B0000', rarity: 'epic', price: 150 },
  { id: 'banner_void_black',     name: 'Void Black',      hex: '#080010', rarity: 'epic', price: 150 },
  { id: 'banner_golden_dawn',    name: 'Golden Dawn',     hex: '#FFD700', rarity: 'epic', price: 150 },
  { id: 'banner_neon_green',     name: 'Neon Green',      hex: '#39FF14', rarity: 'epic', price: 150 },
  { id: 'banner_deep_magenta',   name: 'Deep Magenta',    hex: '#8B008B', rarity: 'epic', price: 150 },
  { id: 'banner_frost_white',    name: 'Frost White',     hex: '#F0F8FF', rarity: 'epic', price: 150 },
  { id: 'banner_obsidian',       name: 'Obsidian',        hex: '#1A1A2E', rarity: 'epic', price: 150 },
  // Legendary (300 crowns each)
  { id: 'banner_chromatic',      name: 'Chromatic',       hex: 'rainbow',  rarity: 'legendary', price: 300 },
  { id: 'banner_aurora',         name: 'Aurora',          hex: '#00FF87', rarity: 'legendary', price: 300 },
  { id: 'banner_inferno',        name: 'Inferno',         hex: '#FF4500', rarity: 'legendary', price: 300 },
];

for (const b of BANNER_COLORS) {
  catalog.push({
    id: b.id,
    category: 'profile_background',
    name: b.name,
    description: `Set your profile banner to ${b.name}.`,
    rarity: b.rarity,
    priceCrowns: b.price,
    priceGlory: b.rarity === 'common' ? 300 : null,
  });
}

// ═════════════════════════════════════════════════════════════════
//  CURSOR PACKS  (6 items)
// ═════════════════════════════════════════════════════════════════

const CURSOR_PACKS: { id: string; name: string; desc: string; rarity: Rarity; price: number }[] = [
  { id: 'cursor_flame', name: 'Flame Cursor', desc: 'A tiny torch that blazes wherever you point.', rarity: 'common', price: 100 },
  { id: 'cursor_crystal', name: 'Crystal Cursor', desc: 'A faceted gem pointer that sparkles on hover.', rarity: 'common', price: 100 },
  { id: 'cursor_shadow', name: 'Shadow Cursor', desc: 'A dark wisp that trails ink-like smoke behind it.', rarity: 'rare', price: 120 },
  { id: 'cursor_golden', name: 'Golden Cursor', desc: 'Midas-touched — everything you click turns to gold (visually).', rarity: 'rare', price: 130 },
  { id: 'cursor_enchanted', name: 'Enchanted Cursor', desc: 'Arcane sigils orbit the pointer in a slow dance.', rarity: 'rare', price: 140 },
  { id: 'cursor_seasonal', name: 'Seasonal Cursor', desc: 'Changes with the real-world season — snowflakes to sunbeams.', rarity: 'rare', price: 150 },
];

for (const c of CURSOR_PACKS) {
  catalog.push({
    id: c.id,
    category: 'cursor_pack',
    name: c.name,
    description: c.desc,
    rarity: c.rarity,
    priceCrowns: c.price,
    priceGlory: null,
  });
}

// ═════════════════════════════════════════════════════════════════
//  UI THEMES  (5 items)
// ═════════════════════════════════════════════════════════════════

const UI_THEMES: { id: string; name: string; desc: string; rarity: Rarity; price: number }[] = [
  { id: 'ui_frostborne', name: 'Frostborne UI', desc: 'Icy blue panels with frosted glass edges and snowfall accents.', rarity: 'rare', price: 300 },
  { id: 'ui_crimson', name: 'Crimson UI', desc: 'Deep red and black panels with smouldering ember highlights.', rarity: 'rare', price: 300 },
  { id: 'ui_royal_purple', name: 'Royal Purple UI', desc: 'Rich purple velvet textures with gold filigree borders.', rarity: 'epic', price: 400 },
  { id: 'ui_natures_embrace', name: "Nature's Embrace UI", desc: 'Living wood panels overgrown with moss and tiny flowers.', rarity: 'epic', price: 450 },
  { id: 'ui_void', name: 'Void UI', desc: 'Panels of pure darkness bordered by swirling void energy.', rarity: 'epic', price: 500 },
];

for (const ui of UI_THEMES) {
  catalog.push({
    id: ui.id,
    category: 'ui_theme',
    name: ui.name,
    description: ui.desc,
    rarity: ui.rarity,
    priceCrowns: ui.price,
    priceGlory: null,
  });
}

// ═════════════════════════════════════════════════════════════════
//  BOOSTERS  (4 items)
// ═════════════════════════════════════════════════════════════════

const BOOSTERS: { id: string; name: string; desc: string; price: number }[] = [
  { id: 'booster_glory_2x', name: 'Glory Boost (2x)', desc: 'Double all glory earned from battles for 24 hours.', price: 50 },
  { id: 'booster_xp_2x', name: 'XP Boost (2x)', desc: 'Double all experience gained from battles for 24 hours.', price: 50 },
  { id: 'booster_quest_refresh', name: 'Quest Refresh', desc: 'Instantly reroll all three daily quests.', price: 25 },
  { id: 'booster_tier_skip', name: 'Battle Pass Tier Skip', desc: 'Instantly advance one tier on the current battle pass.', price: 150 },
];

for (const b of BOOSTERS) {
  catalog.push({
    id: b.id,
    category: 'booster',
    name: b.name,
    description: b.desc,
    rarity: 'common',
    priceCrowns: b.price,
    priceGlory: null,
  });
}

// ─────────────────────────────────────────────────────────────────
//  Export the complete catalog
// ─────────────────────────────────────────────────────────────────

export const STORE_CATALOG: CatalogItem[] = catalog;

// ─────────────────────────────────────────────────────────────────
//  Store Bundles
// ─────────────────────────────────────────────────────────────────

export const STORE_BUNDLES: BundleDef[] = [
  {
    id: 'recruit_pack',
    name: 'Recruit Pack',
    description: 'A starter bundle for new horde masters — crowns, a random rare skin, and a portrait frame to kick things off.',
    priceUSD: 2.99,
    items: [
      'skin_gnome_golden',  // 1 random rare skin (representative pick)
      'frame_wooden',       // 1 portrait frame
    ],
    crownsIncluded: 300,
    oneTimePurchase: true,
    icon: '🎒',
  },
  {
    id: 'warrior_pack',
    name: 'Warrior Pack',
    description: 'Gear up with crowns, two rare skins, a voice pack, and a death effect — ready for real battles.',
    priceUSD: 9.99,
    items: [
      'skin_skull_jade',
      'skin_hyena_war_paint',
      'voice_gnome_energetic',
      'death_immolation',
    ],
    crownsIncluded: 1500,
    oneTimePurchase: true,
    icon: '⚔️',
  },
  {
    id: 'commander_pack',
    name: 'Commander Pack',
    description: 'A hefty war fund plus epic skins, a map theme, and a legendary portrait — command respect.',
    priceUSD: 24.99,
    items: [
      'skin_rogue_phantom',
      'skin_minotaur_titan',
      'map_eternal_night',
      'portrait_dragon_lord',
      'frame_dragon',
    ],
    crownsIncluded: 4000,
    oneTimePurchase: true,
    icon: '🏰',
  },
  {
    id: 'grand_marshal',
    name: 'Grand Marshal Pack',
    description: 'A massive crown stockpile, legendary skins, a building theme, UI theme, and exclusive voice effect.',
    priceUSD: 49.99,
    items: [
      'skin_panda_divine_emperor',
      'skin_shaman_arch_druid',
      'skin_troll_mountain_king',
      'building_crystal_palace',
      'ui_royal_purple',
      'voice_fx_ethereal',
      'trail_lightning',
    ],
    crownsIncluded: 10000,
    oneTimePurchase: true,
    icon: '👑',
  },
  {
    id: 'ultimate_patron',
    name: 'Ultimate Patron Pack',
    description: 'The definitive collection — a king\'s ransom in crowns, legendary items from every category, and eternal bragging rights.',
    priceUSD: 99.99,
    items: [
      'skin_gnome_celestial',
      'skin_turtle_ancient_guardian',
      'skin_spider_queen_broodmother',
      'skin_minotaur_worldbreaker',
      'skin_troll_mountain_king',
      'portrait_phoenix_knight',
      'portrait_shadow_queen',
      'frame_celestial',
      'frame_void',
      'building_celestial_spire',
      'map_volcanic_depths',
      'death_flower_burst',
      'victory_aurora',
      'bg_crystal_cave',
      'title_the_eternal',
      'voice_fx_ethereal',
    ],
    crownsIncluded: 20000,
    oneTimePurchase: true,
    icon: '💎',
  },
];

// ─────────────────────────────────────────────────────────────────
//  Helper Functions
// ─────────────────────────────────────────────────────────────────

/** Look up a single catalog item by its unique ID. */
export function getCatalogItem(id: string): CatalogItem | undefined {
  return STORE_CATALOG.find((item) => item.id === id);
}

/** Return all catalog items belonging to a given category. */
export function getCatalogByCategory(category: ItemCategory): CatalogItem[] {
  return STORE_CATALOG.filter((item) => item.category === category);
}

/** Look up a crown package by its unique ID. */
export function getCrownPackage(id: string): CrownPackage | undefined {
  return CROWN_PACKAGES.find((pkg) => pkg.id === id);
}
