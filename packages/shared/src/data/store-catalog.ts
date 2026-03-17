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
  turtle: 1,
  skull: 2,
  spider: 2,
  hyena: 2,
  rogue: 3,
  panda: 3,
  lizard: 3,
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
  turtle: [
    { theme: 'mossy', name: 'Mossy Turtle', desc: 'Centuries of forest growth cling to this ancient shell.', rarity: 'common' },
    { theme: 'crystal', name: 'Crystal Turtle', desc: 'A translucent carapace refracts light into rainbows.', rarity: 'rare' },
    { theme: 'magma', name: 'Magma Turtle', desc: 'Molten rock flows through deep cracks in its shell.', rarity: 'epic' },
    { theme: 'ancient_guardian', name: 'Ancient Guardian Turtle', desc: 'An elder of the deep, adorned with fossilized runes.', rarity: 'legendary' },
  ],
  skull: [
    { theme: 'ashen', name: 'Ashen Skull', desc: 'Coated in grey ash from a long-forgotten pyre.', rarity: 'common' },
    { theme: 'jade', name: 'Jade Skull', desc: 'Carved from enchanted jade, glowing with spectral light.', rarity: 'rare' },
    { theme: 'plague', name: 'Plague Skull', desc: 'Toxic miasma seeps from every crack and hollow.', rarity: 'epic' },
    { theme: 'death_emperor', name: 'Death Emperor Skull', desc: 'Crowned in bone and shadow, sovereign of the grave.', rarity: 'legendary' },
  ],
  spider: [
    { theme: 'crimson', name: 'Crimson Spider', desc: 'Blood-red chitin glistens under torchlight.', rarity: 'common' },
    { theme: 'jeweled', name: 'Jeweled Spider', desc: 'Encrusted with sapphires and amethysts along each leg.', rarity: 'rare' },
    { theme: 'void_weaver', name: 'Void Weaver Spider', desc: 'Spins webs of dark matter between dimensions.', rarity: 'epic' },
    { theme: 'queen_broodmother', name: 'Queen Broodmother Spider', desc: 'Massive and regal, trailing a living mantle of silk.', rarity: 'legendary' },
  ],
  hyena: [
    { theme: 'sandy', name: 'Sandy Hyena', desc: 'Desert-camouflaged with sun-bleached fur.', rarity: 'common' },
    { theme: 'war_paint', name: 'War Paint Hyena', desc: 'Tribal markings glow across its snarling face.', rarity: 'rare' },
    { theme: 'spectral', name: 'Spectral Hyena', desc: 'Flickering between planes, half-ghost and all menace.', rarity: 'epic' },
    { theme: 'alpha_packmaster', name: 'Alpha Packmaster Hyena', desc: 'Pack leader draped in trophies from a hundred hunts.', rarity: 'legendary' },
  ],
  rogue: [
    { theme: 'shadow', name: 'Shadow Rogue', desc: 'Cloaked in living darkness — barely visible at dusk.', rarity: 'common' },
    { theme: 'silver_blade', name: 'Silver Blade Rogue', desc: 'Moonlit daggers and polished leather, deadly elegance.', rarity: 'rare' },
    { theme: 'phantom', name: 'Phantom Rogue', desc: 'A translucent assassin that phases through solid walls.', rarity: 'epic' },
    { theme: 'nightfall_sovereign', name: 'Nightfall Sovereign Rogue', desc: 'Master of every shadow, ruler of the unseen world.', rarity: 'legendary' },
  ],
  panda: [
    { theme: 'bamboo', name: 'Bamboo Panda', desc: 'Wrapped in woven bamboo armor, smelling of fresh leaves.', rarity: 'common' },
    { theme: 'samurai', name: 'Samurai Panda', desc: 'Adorned in lacquered red armor with a fearsome mempo.', rarity: 'rare' },
    { theme: 'storm_monk', name: 'Storm Monk Panda', desc: 'Lightning crackles between its paws in meditation.', rarity: 'epic' },
    { theme: 'divine_emperor', name: 'Divine Emperor Panda', desc: 'Draped in clouds and imperial silk, a living legend.', rarity: 'legendary' },
  ],
  lizard: [
    { theme: 'jungle', name: 'Jungle Lizard', desc: 'Vibrant green scales blend seamlessly into the canopy.', rarity: 'common' },
    { theme: 'prismatic', name: 'Prismatic Lizard', desc: 'Scales shift colour with every movement like a living gem.', rarity: 'rare' },
    { theme: 'venomous', name: 'Venomous Lizard', desc: 'Dripping toxic purple, each step corrodes the ground.', rarity: 'epic' },
    { theme: 'primordial_drake', name: 'Primordial Drake Lizard', desc: 'An echo of the first dragons, wreathed in primal flame.', rarity: 'legendary' },
  ],
  minotaur: [
    { theme: 'bronze', name: 'Bronze Minotaur', desc: 'Plated in tarnished bronze from horn to hoof.', rarity: 'common' },
    { theme: 'bloodforge', name: 'Bloodforge Minotaur', desc: 'Rune-scarred hide pulses with crimson forge-light.', rarity: 'rare' },
    { theme: 'titan', name: 'Titan Minotaur', desc: 'Earthquake with every step — stone crumbles in its wake.', rarity: 'epic' },
    { theme: 'worldbreaker', name: 'Worldbreaker Minotaur', desc: 'Cracks reality itself when it charges, horns ablaze.', rarity: 'legendary' },
  ],
  shaman: [
    { theme: 'verdant', name: 'Verdant Shaman', desc: 'Draped in living vines that bloom with every spell.', rarity: 'common' },
    { theme: 'spirit_walker', name: 'Spirit Walker Shaman', desc: 'Surrounded by ghostly animal totems at all times.', rarity: 'rare' },
    { theme: 'blood_oracle', name: 'Blood Oracle Shaman', desc: 'Reads fate in crimson runes that hover mid-air.', rarity: 'epic' },
    { theme: 'arch_druid', name: 'Arch-Druid Shaman', desc: 'Nature incarnate — trees bow and beasts kneel.', rarity: 'legendary' },
  ],
  troll: [
    { theme: 'swamp', name: 'Swamp Troll', desc: 'Covered in dripping mud and tangled river weed.', rarity: 'common' },
    { theme: 'war_chief', name: 'War Chief Troll', desc: 'Bedecked in bone trophies and tribal war banners.', rarity: 'rare' },
    { theme: 'abyssal', name: 'Abyssal Troll', desc: 'Risen from the ocean deep, barnacled and terrible.', rarity: 'epic' },
    { theme: 'mountain_king', name: 'Mountain King Troll', desc: 'A living mountain crowned with stone and thunder.', rarity: 'legendary' },
  ],
};

// ─────────────────────────────────────────────────────────────────
//  Build the catalog
// ─────────────────────────────────────────────────────────────────

const catalog: CatalogItem[] = [];

// ═════════════════════════════════════════════════════════════════
//  UNIT SKINS  (44 items — 4 per unit × 11 units)
// ═════════════════════════════════════════════════════════════════

for (const unit of Object.keys(UNIT_SKINS) as HordeUnitType[]) {
  const tier = UNIT_TIER[unit];
  for (const skin of UNIT_SKINS[unit]) {
    catalog.push({
      id: `skin_${unit}_${skin.theme}`,
      category: 'unit_skin',
      name: skin.name,
      description: skin.desc,
      rarity: skin.rarity,
      priceCrowns: skinPrice(tier, skin.rarity),
      priceGlory: skin.rarity === 'common' ? 1500 : null,
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
  turtle: 'A serene close-up of ancient, knowing eyes peering from a weathered shell.',
  skull: 'A hauntingly detailed portrait wreathed in ghostly green flame.',
  spider: 'Eight gleaming eyes stare back from a web-framed masterpiece.',
  hyena: 'A snarling portrait that seems to laugh even when still.',
  rogue: 'A half-shadowed face — you can only ever see one cunning eye.',
  panda: 'A regal portrait radiating calm wisdom and quiet strength.',
  lizard: 'Iridescent scales shimmer as you tilt the frame.',
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
    priceCrowns: 50,
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

const VOICE_PACKS: { id: string; unit: HordeUnitType; name: string; desc: string; price: number }[] = [
  { id: 'voice_gnome_hyper', unit: 'gnome', name: 'Hyper Gnome Voice', desc: 'Rapid-fire squeaky chatter that never stops for breath.', price: 200 },
  { id: 'voice_turtle_zen', unit: 'turtle', name: 'Zen Turtle Voice', desc: 'Calm, meditative tones that soothe even the fiercest battle.', price: 200 },
  { id: 'voice_skull_whisper', unit: 'skull', name: 'Whispering Skull Voice', desc: 'Eerie whispers that seem to come from inside your own head.', price: 220 },
  { id: 'voice_spider_hiss', unit: 'spider', name: 'Hissing Spider Voice', desc: 'Sibilant clicks and hisses that raise the hairs on your neck.', price: 220 },
  { id: 'voice_hyena_manic', unit: 'hyena', name: 'Manic Hyena Voice', desc: 'Unhinged cackling punctuated by gleeful battle howls.', price: 230 },
  { id: 'voice_rogue_suave', unit: 'rogue', name: 'Suave Rogue Voice', desc: 'Silky smooth one-liners delivered with effortless cool.', price: 230 },
  { id: 'voice_panda_sleepy', unit: 'panda', name: 'Sleepy Panda Voice', desc: 'Drowsy mumbles and contented yawns mid-combat.', price: 240 },
  { id: 'voice_minotaur_calm', unit: 'minotaur', name: 'Calm Minotaur Voice', desc: 'A deep, surprisingly gentle baritone from a massive beast.', price: 250 },
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
    priceCrowns: 100,
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
//  EMOTES  (15 items)
// ═════════════════════════════════════════════════════════════════

// --- 8 Emoji emotes (common, 50 crowns) ---

const EMOJI_EMOTES: { id: string; name: string; desc: string }[] = [
  { id: 'emote_gg', name: 'GG', desc: 'A sportsmanlike "good game" — golden letters flash on screen.' },
  { id: 'emote_wow', name: 'WOW', desc: 'Wide eyes and an open mouth — genuine astonishment.' },
  { id: 'emote_lol', name: 'LOL', desc: 'Rolling on the floor laughing — tears streaming.' },
  { id: 'emote_cry', name: 'Cry', desc: 'A single dramatic tear rolls down — peak sadness.' },
  { id: 'emote_rage', name: 'Rage', desc: 'A furious red face with steam blasting from both ears.' },
  { id: 'emote_heart', name: 'Heart', desc: 'A big pulsing heart radiates love across the battlefield.' },
  { id: 'emote_crown', name: 'Crown', desc: 'A sparkling crown descends — you are royalty today.' },
  { id: 'emote_wave', name: 'Wave', desc: 'A friendly hand wave — hello or goodbye, your choice.' },
];

for (const e of EMOJI_EMOTES) {
  catalog.push({
    id: e.id,
    category: 'emote',
    name: e.name,
    description: e.desc,
    rarity: 'common',
    priceCrowns: 50,
    priceGlory: null,
  });
}

// --- 4 Animated emotes (rare, 150 crowns) ---

const ANIMATED_EMOTES: { id: string; name: string; desc: string }[] = [
  { id: 'emote_dancing', name: 'Victory Dance', desc: 'Your avatar breaks into an irresistible celebratory jig.' },
  { id: 'emote_flexing', name: 'Flex', desc: 'Muscles bulge comically as your avatar strikes a power pose.' },
  { id: 'emote_laughing', name: 'Belly Laugh', desc: 'Full-body laughter so contagious even enemies might smile.' },
  { id: 'emote_sleeping', name: 'Naptime', desc: 'A cozy snoring animation complete with floating Zs.' },
];

for (const e of ANIMATED_EMOTES) {
  catalog.push({
    id: e.id,
    category: 'emote',
    name: e.name,
    description: e.desc,
    rarity: 'rare',
    priceCrowns: 150,
    priceGlory: null,
  });
}

// --- 3 Voice taunts (rare, 200 crowns) ---

const VOICE_TAUNTS: { id: string; name: string; desc: string }[] = [
  { id: 'emote_battle_cry', name: 'Battle Cry', desc: 'A thunderous war shout that echoes across the map.' },
  { id: 'emote_mock', name: 'Mockery', desc: 'A taunting "nyah nyah" guaranteed to tilt your opponent.' },
  { id: 'emote_cheer', name: 'Cheer', desc: 'An enthusiastic cheer of encouragement for your horde.' },
];

for (const e of VOICE_TAUNTS) {
  catalog.push({
    id: e.id,
    category: 'emote',
    name: e.name,
    description: e.desc,
    rarity: 'rare',
    priceCrowns: 200,
    priceGlory: null,
  });
}

// ═════════════════════════════════════════════════════════════════
//  PROFILE BADGES  (5 items)
// ═════════════════════════════════════════════════════════════════

const PROFILE_BADGES: { id: string; name: string; desc: string; rarity: Rarity; price: number }[] = [
  { id: 'badge_crown', name: 'Crown Badge', desc: 'A gleaming golden crown — mark of a true patron.', rarity: 'common', price: 100 },
  { id: 'badge_skull_mark', name: 'Skull Mark Badge', desc: 'A menacing skull sigil branded into your profile.', rarity: 'rare', price: 150 },
  { id: 'badge_gold_star', name: 'Gold Star Badge', desc: 'A radiant five-pointed star — you earned it.', rarity: 'rare', price: 200 },
  { id: 'badge_flames', name: 'Flames Badge', desc: 'Your profile border smoulders with perpetual embers.', rarity: 'epic', price: 250 },
  { id: 'badge_diamond', name: 'Diamond Badge', desc: 'A flawless diamond that refracts light across the page.', rarity: 'legendary', price: 300 },
];

for (const b of PROFILE_BADGES) {
  catalog.push({
    id: b.id,
    category: 'profile_badge',
    name: b.name,
    description: b.desc,
    rarity: b.rarity,
    priceCrowns: b.price,
    priceGlory: null,
  });
}

// ═════════════════════════════════════════════════════════════════
//  PROFILE TITLES  (5 items)
// ═════════════════════════════════════════════════════════════════

const PROFILE_TITLES: { id: string; name: string; desc: string; rarity: Rarity; price: number }[] = [
  { id: 'title_the_magnificent', name: 'The Magnificent', desc: 'Proclaim your greatness for all to see.', rarity: 'common', price: 75 },
  { id: 'title_chaos_lord', name: 'Chaos Lord', desc: 'A title whispered in fear by lesser horde masters.', rarity: 'rare', price: 150 },
  { id: 'title_grand_marshal', name: 'Grand Marshal', desc: 'Commander of armies, strategist without equal.', rarity: 'rare', price: 200 },
  { id: 'title_doom_bringer', name: 'Doom Bringer', desc: 'Where you march, destruction follows.', rarity: 'epic', price: 250 },
  { id: 'title_the_eternal', name: 'The Eternal', desc: 'Legends fade. You do not.', rarity: 'legendary', price: 300 },
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
//  PROFILE BACKGROUNDS  (5 items)
// ═════════════════════════════════════════════════════════════════

const PROFILE_BACKGROUNDS: { id: string; name: string; desc: string; rarity: Rarity; price: number }[] = [
  { id: 'bg_dark_forest', name: 'Dark Forest', desc: 'An ominous moonlit woodland — something watches from the trees.', rarity: 'rare', price: 200 },
  { id: 'bg_volcanic', name: 'Volcanic Hellscape', desc: 'Rivers of lava and plumes of ash frame your profile.', rarity: 'epic', price: 400 },
  { id: 'bg_starfield', name: 'Starfield', desc: 'A slowly rotating galaxy fills the void behind your stats.', rarity: 'epic', price: 500 },
  { id: 'bg_battlefield', name: 'Battlefield', desc: 'Tattered banners and crossed swords on scorched earth.', rarity: 'rare', price: 300 },
  { id: 'bg_crystal_cave', name: 'Crystal Cave', desc: 'Bioluminescent crystals pulse gently in the deep dark.', rarity: 'legendary', price: 700 },
];

for (const bg of PROFILE_BACKGROUNDS) {
  catalog.push({
    id: bg.id,
    category: 'profile_background',
    name: bg.name,
    description: bg.desc,
    rarity: bg.rarity,
    priceCrowns: bg.price,
    priceGlory: null,
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
      'voice_gnome_hyper',
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
      'badge_diamond',
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
