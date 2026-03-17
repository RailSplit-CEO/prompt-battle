// ═══════════════════════════════════════════════════════════════
// Constants.ts — All game-rule constants, Phaser-free.
// Extracted from HordeScene.ts for shared simulation use.
// ═══════════════════════════════════════════════════════════════

import type { EquipmentType } from '../data/maps';
import { TILE_SIZE } from '../data/maps';
import type {
  AnimalDef,
  CampDef,
  EquipmentDef,
  MapEventDef,
  MapEventType,
  ResourceType,
} from './SimTypes';

// ─── World / Tile Constants ─────────────────────────────────

export const WORLD_W = 6400;
export const WORLD_H = 6400;
export const P1_BASE = { x: 250, y: WORLD_H - 250 };
export const P2_BASE = { x: WORLD_W - 250, y: 250 };

// ─── Nexus ───────────────────────────────────────────────────

export const NEXUS_MAX_HP = 20000;
export const NEXUS_DAMAGE = 80;
export const NEXUS_RANGE = 350;
export const NEXUS_SPLASH = 100;
export const NEXUS_COOLDOWN = 2000;
export const NEXUS_PROJ_SPEED = 400;

// ─── Supply / Upkeep ────────────────────────────────────────

export const MAX_SUPPLY = 80;

export const SUPPLY_COST: Record<string, number> = {
  gnome: 1, turtle: 1,
  skull: 2, spider: 2, hyena: 2, rogue: 2,
  panda: 3, lizard: 3,
  minotaur: 5, shaman: 5,
  troll: 8,
};

export const UPKEEP_THRESHOLDS = [
  { supply: 0,  rate: 1.0 },
  { supply: 30, rate: 0.85 },
  { supply: 50, rate: 0.70 },
  { supply: 70, rate: 0.55 },
] as const;

// ─── Combat Timing ───────────────────────────────────────────

export const ATTACK_CD_MS = 1500;
export const COMBAT_RANGE = 80;
export const TURTLE_TAUNT_RANGE = 100;
export const PROJECTILE_SPEED = 450;
export const PROJECTILE_HIT_DIST = 18;

// ─── Tower ───────────────────────────────────────────────────

export const TOWER_HP = 1500;
export const TOWER_DAMAGE = 120;
export const TOWER_RANGE = 400;
export const TOWER_SPLASH = 80;
export const TOWER_COOLDOWN = 2500;
export const TOWER_PROJ_SPEED = 350;

// ─── Camp ────────────────────────────────────────────────────

export const CAMP_RANGE = 120;

// ─── Spawning ────────────────────────────────────────────────

export const BASE_SPAWN_MS = 5000; // legacy, unused
export const FREE_GNOME_MS = 45000;
export const AI_TICK_MS = 2000;

// ─── Day / Night Cycle ───────────────────────────────────────

export const DAY_DURATION = 240000;
export const NIGHT_DURATION = 120000;
export const CYCLE_TOTAL = DAY_DURATION + NIGHT_DURATION;
export const DUSK_WARNING = 30000;
export const NIGHT_SPEED_PENALTY = 0.85;
export const NIGHT_DAMAGE_PENALTY = 0.90;
export const BLOOD_MOON_INTERVAL = 3;
export const NIGHT_BUILDING_SAFE_RANGE = 300;

// ─── Team Colors ─────────────────────────────────────────────

export const TEAM_COLORS = { 1: 0x4499FF, 2: 0xFF5555 } as const;

// ─── Fog / Vision ────────────────────────────────────────────

export const FOG_VISION_RANGE = 400;
export const FOG_STRUCTURE_VISION_RANGE = 650;
export const FOG_SCALE = 0.25;
export const FOG_W = Math.ceil(WORLD_W * FOG_SCALE);
export const FOG_H = Math.ceil(WORLD_H * FOG_SCALE);
export const FOG_VISION_TILES_W = Math.ceil(WORLD_W / TILE_SIZE);
export const FOG_VISION_TILES_H = Math.ceil(WORLD_H / TILE_SIZE);
export const GOLDEN_ANGLE = 2.39996;

// ─── Resource Economy ────────────────────────────────────────

export const SPAWN_COSTS: Record<string, { type: ResourceType; amount: number; secondary?: { type: ResourceType; amount: number } }> = {
  gnome:     { type: 'carrot',  amount: 2 },
  turtle:    { type: 'carrot',  amount: 4 },
  skull:     { type: 'meat',    amount: 4 },
  spider:    { type: 'meat',    amount: 5 },
  hyena:     { type: 'meat',    amount: 4 },
  rogue:     { type: 'meat',    amount: 5 },
  panda:     { type: 'meat',    amount: 6, secondary: { type: 'carrot', amount: 3 } },
  lizard:    { type: 'meat',    amount: 6, secondary: { type: 'carrot', amount: 2 } },
  minotaur:  { type: 'crystal', amount: 8, secondary: { type: 'meat', amount: 4 } },
  shaman:    { type: 'crystal', amount: 8, secondary: { type: 'meat', amount: 3 } },
  troll:     { type: 'crystal', amount: 12, secondary: { type: 'meat', amount: 6 } },
};

export const RESOURCE_EMOJI: Record<ResourceType, string> = {
  carrot: '🥕', meat: '🍖', crystal: '💎', metal: '⚙️',
};

export const CARROT_SPAWN_MS = 3000;
export const MAX_GROUND_ITEMS = 150;
export const ITEM_DESPAWN_MS = 30000;
export const PICKUP_RANGE = 35;
export const DELIVER_RANGE = 100;
export const WILD_ANIMAL_COUNT = 30;
export const ELITE_PREY_COUNT = 3;
export const WILD_RESPAWN_MS = 20000;

// ─── Mining ──────────────────────────────────────────────────

export const MINE_COUNT = 4;
export const MINE_TICK_MS = 2000;
export const MINE_RANGE = 180;

// ─── Center Shrine ───────────────────────────────────────────

export const SHRINE_X = 3200;
export const SHRINE_Y = 3200;
export const SHRINE_CAPTURE_TIME = 15000;
export const SHRINE_ACTIVATE_TIME = 90000;
export const SHRINE_TRICKLE_INTERVAL = 10000;
export const SHRINE_TRICKLE_CRYSTAL = 1;
export const SHRINE_TRICKLE_METAL = 1;
export const SHRINE_RADIUS = 200;

// ─── Bounty Camps ────────────────────────────────────────────

export const BOUNTY_CAMP_POSITIONS = [
  { x: 2200, y: 4200 },
  { x: 4200, y: 2200 },
] as const;

export const BOUNTY_RESPAWN_MS = 90000;
export const BOUNTY_CACHE_DESPAWN = 30000;

// ─── Equipment System ────────────────────────────────────────

export const MAX_EQUIP_LEVEL = 3;
export const EQUIP_LEVEL_STAT_MULT = [0, 1.0, 1.5, 2.0] as const;
export const EQUIP_LEVEL_COST_MULT = [0, 1.0, 2.5, 5.0] as const;

export const EQUIPMENT: EquipmentDef[] = [
  { id: 'pickaxe', name: 'Pickaxe', emoji: '⛏️', cost: { carrot: 40 }, effect: 'Can mine metal, +25% gather speed' },
  { id: 'sword',   name: 'Sword',   emoji: '⚔️', cost: { meat: 40, metal: 15, crystal: 10 }, effect: '+50% attack, +25% attack speed' },
  { id: 'shield',  name: 'Shield',  emoji: '🛡️', cost: { meat: 35, metal: 15, crystal: 10 }, effect: '+60% HP, -25% damage taken, -15% speed' },
  { id: 'boots',   name: 'Boots',   emoji: '👢', cost: { carrot: 35, metal: 10, crystal: 5 }, effect: '+60% move speed, +50% pickup range' },
  { id: 'banner',  name: 'Banner',  emoji: '🚩', cost: { meat: 50, metal: 20, crystal: 15 }, effect: 'Aura: nearby allies +20% atk, +15% speed' },
];

export const EQUIPMENT_PREREQS: Record<EquipmentType, EquipmentType[]> = {
  pickaxe: [],
  sword:   ['pickaxe'],
  shield:  ['pickaxe'],
  boots:   ['pickaxe'],
  banner:  ['pickaxe'],
};

export const RESOURCE_GATHER_NEEDS: Record<ResourceType, { needsEquipment?: EquipmentType }> = {
  carrot:  {},
  meat:    {},
  crystal: {},
  metal:   { needsEquipment: 'pickaxe' },
};

export const ARMORY_RANGE = 110;

export const ARMORY_BUILDING: Record<string, string> = {
  pickaxe: 'house1',
  sword: 'barracks',
  shield: 'house3',
  boots: 'monastery',
  banner: 'archery',
};

// ─── Rock Collision ──────────────────────────────────────────

export const ROCK_RADIUS = 80;
export const ROCK_PATH_RADIUS = 80;

// ─── Unit Roster ─────────────────────────────────────────────

export const ANIMALS: Record<string, AnimalDef> = {
  gnome:     { type: 'gnome',     emoji: '🧝', hp: 20,    attack: 4,    speed: 210, tier: 1, ability: 'Nimble Hands', desc: '2x pickup range, fastest gatherer', ability2: 'Plucky', desc2: 'Survives 1 lethal hit (scales with era)', mineSpeed: 2.0 },
  turtle:    { type: 'turtle',    emoji: '🐢', hp: 80,    attack: 5,    speed: 55,  tier: 1, ability: 'Shell Stance', desc: '60% DR when stationary + taunts nearby foes', ability2: 'Iron Shell', desc2: 'Carries 10x resources; nearby allies take 15% less damage', mineSpeed: 1.5 },
  skull:     { type: 'skull',     emoji: '💀', hp: 90,    attack: 16,   speed: 155, tier: 2, ability: 'Undying',      desc: 'Cheats death once (survives at 1 HP)', ability2: 'Dread Aura', desc2: 'Enemies nearby attack 15% slower', mineSpeed: 0.8 },
  spider:    { type: 'spider',    emoji: '🕷️', hp: 110,   attack: 20,   speed: 140, tier: 2, ability: 'Venom Bite',   desc: '+5% target max HP per hit', ability2: 'Web Trap', desc2: 'First attack slows target 40% for 3s', mineSpeed: 0.6 },
  hyena:     { type: 'hyena',     emoji: '🐺', hp: 65,    attack: 24,   speed: 175, tier: 2, ability: 'Bone Toss',    desc: 'Extended range (120 vs 80)', ability2: 'Pack Frenzy', desc2: '+10% atk per nearby allied hyena (max +50%)', mineSpeed: 0.8 },
  panda:     { type: 'panda',     emoji: '🐼', hp: 280,   attack: 32,   speed: 80,  tier: 3, ability: 'Thick Hide',   desc: 'Regenerates 1.5% max HP/sec', ability2: 'Bamboo Wall', desc2: 'Blocks projectiles for units behind', mineSpeed: 0.5 },
  lizard:    { type: 'lizard',    emoji: '🦎', hp: 200,   attack: 55,   speed: 110, tier: 3, ability: 'Cold Blood',   desc: '3x dmg to targets below 40% HP', ability2: 'Tail Whip', desc2: 'Attacks hit enemies in 50px arc behind target', mineSpeed: 0.7 },
  minotaur:  { type: 'minotaur',  emoji: '🐂', hp: 550,   attack: 85,   speed: 105, tier: 4, ability: 'War Cry',      desc: 'Nearby allies +25% attack', ability2: 'Bull Rush', desc2: 'Charges at targets >200px away for 2x impact', mineSpeed: 0.4 },
  shaman:    { type: 'shaman',    emoji: '🔮', hp: 350,   attack: 120,  speed: 95,  tier: 4, ability: 'Arcane Blast', desc: 'All attacks splash 60px', ability2: 'Hex Ward', desc2: 'Nearby allies take 20% less splash damage', mineSpeed: 0.5 },
  troll:     { type: 'troll',     emoji: '👹', hp: 1200,  attack: 200,  speed: 50,  tier: 5, ability: 'Club Slam',    desc: 'Massive 90px splash, slows enemies', ability2: 'Regeneration', desc2: '0.5% HP/s regen, doubles below 30% HP', mineSpeed: 0.3 },
  rogue:     { type: 'rogue',     emoji: '🗡️', hp: 70,    attack: 40,   speed: 200, tier: 2, ability: 'Backstab',    desc: '3x first hit + invisible to neutrals', ability2: 'Shadow Step', desc2: 'Invisible to neutral enemies, sneaks past defenders', mineSpeed: 1.0 },
};

// ─── Hard Counter Map ────────────────────────────────────────

export const HARD_COUNTERS: Record<string, string[]> = {
  gnome:     [],
  turtle:    ['gnome'],
  skull:     ['hyena', 'spider'],
  spider:    ['panda', 'turtle'],
  hyena:     ['spider', 'gnome'],
  panda:     ['skull', 'lizard'],
  lizard:    ['panda', 'minotaur'],
  minotaur:  ['skull', 'shaman'],
  shaman:    ['troll', 'minotaur'],
  troll:     ['shaman', 'hyena'],
  rogue:     ['gnome', 'shaman'],
};

// ─── Unit Strengths / Weaknesses (for LLM context) ───────────

export const UNIT_STRENGTHS: Record<string, string[]> = {
  gnome:    ['Fastest unit — outruns everything', 'Best economy builder', 'Cheap and expendable scouts'],
  turtle:   ['Incredible hauler — 10x carry capacity', 'Taunts enemies off your fragile units', 'Very tanky for T1 when stationary'],
  skull:    ['Guaranteed second life buys time', 'Debuffs enemy attack speed', 'Good speed for a combat unit'],
  spider:   ['Shreds tanks — % HP damage scales', 'Web opener cripples fast units', 'Great vs Panda, Turtle, Troll'],
  hyena:    ['Outranges every other unit', 'Pack bonus makes hyena balls deadly', 'Fast — good for hit-and-run raids'],
  rogue:    ['Massive burst on first hit', 'Fastest combat unit — great assassin', 'Sneaks past defenders for captures'],
  panda:    ['Insane regen — wins wars of attrition', 'Huge HP pool soaks damage', 'Shields backline from ranged attacks'],
  lizard:   ['Execute damage deletes wounded units', 'Cleave hits clustered enemies', 'Strong balanced stats for T3'],
  minotaur: ['Massive team-wide damage buff', 'Charge obliterates backlines', 'Tanky enough to lead from the front'],
  shaman:   ['AoE damage melts groups', 'Splash reduction protects your army', 'Highest DPS in the game per hit'],
  troll:    ['Unkillable wall of HP + regen', 'Splash slam wipes entire armies', 'Slow effect prevents escape'],
};

export const UNIT_WEAKNESSES: Record<string, string[]> = {
  gnome:    ['Lowest HP and attack in the game', 'Useless in a real fight', 'Dies to splash damage quickly'],
  turtle:   ['Slowest unit in the game', 'Nearly zero damage output', 'Easy to kite and ignore'],
  skull:    ['Low HP — dies fast after rebirth', 'Mediocre damage for T2', 'Only one rebirth per life'],
  spider:   ['Slow movement — easy to avoid', 'Fragile for a "tank killer"', 'Bad vs swarms of small units'],
  hyena:    ['Glass cannon — lowest T2 HP', 'Useless alone without pack bonus', 'Gets destroyed by splash damage'],
  rogue:    ['Paper thin HP — dies instantly', 'Backstab only works once per target', 'Terrible in prolonged fights'],
  panda:    ['Very slow — easy to run from', 'Low DPS for its cost', 'Gets shredded by Spider venom'],
  lizard:   ['Needs targets softened first', 'Expensive — 8 carrots', 'Countered by spread formations'],
  minotaur: ['Very expensive — 12 crystals', 'Charge can pull it out of position', 'Gets executed by Lizard Cold Blood'],
  shaman:   ['Expensive and slow to build', 'Splash hits your own pushes too close', 'Gets one-shot by Rogue backstab'],
  troll:    ['Slowest combat unit by far', 'Costs 20 crystals — huge investment', 'Gets kited and whittled by ranged'],
};

// ─── Camp Spawn Timers & Guard Counts ────────────────────────

export const CAMP_GUARD_COUNT: Record<string, number> = {
  gnome: 1, turtle: 1, skull: 1, spider: 1, hyena: 1, rogue: 1,
  panda: 1, lizard: 1, minotaur: 1, shaman: 1, troll: 1,
};

export const CAMP_SPAWN_MS: Record<string, number> = {
  gnome: 4000, turtle: 4500, skull: 6000, spider: 6000, hyena: 5500, rogue: 5500,
  panda: 7500, lizard: 7500, minotaur: 10000, shaman: 10000, troll: 15000,
};

// ─── Map Event Definitions ───────────────────────────────────

export const MAP_EVENT_DEFS: Record<MapEventType, MapEventDef> = {
  fungal_bloom:      { emoji: '🍄', name: 'Fungal Bloom',      duration: 45000,  minEra: 1 },
  warchest:          { emoji: '📦', name: 'Warchest',          duration: 60000,  minEra: 1 },
  kill_bounty:       { emoji: '🎯', name: 'Kill Bounty',       duration: 40000,  minEra: 2 },
  mercenary_outpost: { emoji: '🏕️', name: 'Mercenary Outpost', duration: 75000,  minEra: 2 },
  bottomless_pit:    { emoji: '🕳️', name: 'Bottomless Pit',    duration: 60000,  minEra: 3 },
  hungry_bear:       { emoji: '🐻', name: 'Hungry Bear',       duration: 90000,  minEra: 3 },
};

export const EVENT_SPOTS = {
  top:    { x: 1600, y: 1600 },
  bottom: { x: 4800, y: 4800 },
  left:   { x: 1600, y: 4800 },
  right:  { x: 4800, y: 1600 },
} as const;

export const SIMULTANEOUS_EVENTS: MapEventType[] = ['fungal_bloom', 'warchest', 'hungry_bear', 'kill_bounty'];
export const SOLO_EVENTS: MapEventType[] = ['mercenary_outpost', 'bottomless_pit'];

export const EVENT_COLORS: Record<string, string> = {
  fungal_bloom: '#66ff66', warchest: '#ffcc00', kill_bounty: '#ff4444',
  mercenary_outpost: '#44aaff', bottomless_pit: '#aa44ff', hungry_bear: '#ff8844',
};

export const EVENT_SPAWN_DESCS: Record<string, string> = {
  fungal_bloom: 'Gather mushroom pickups near the bloom zone!',
  warchest: 'Smash the chest to claim loot and buffs!',
  kill_bounty: 'Hunt the marked target before your opponent!',
  mercenary_outpost: 'Control the outpost to recruit mercenaries!',
  bottomless_pit: 'Sacrifice units into the pit for powerful rewards!',
  hungry_bear: 'Feed the bear to tame it as a siege weapon!',
};

// ─── Era Progression ─────────────────────────────────────────

export const ERA_BANNER_INFO: Record<number, string> = {
  1: 'Gather resources, capture camps, grow your horde',
  2: 'Tier 2 units — Skulls, Spiders & Hyenas roam the wilds',
  3: 'Tier 3 units — Pandas & Lizards appear in the wild',
  4: 'Tier 4 units — Minotaurs & Shamans join the fray',
  5: 'Tier 5 — The Troll has awoken',
};

export const ERA_ROMAN: Record<number, string> = { 1: 'I', 2: 'II', 3: 'III', 4: 'IV', 5: 'V' };

export const TIER_COLORS: Record<number, string> = { 1: '#2E8B2E', 2: '#2266BB', 3: '#CC6A00', 4: '#BB2222', 5: '#B8860B' };

// ─── Camp Name Generation ────────────────────────────────────

export const CAMP_NAMES: Record<string, string[]> = {
  gnome: [
    'Gnarly Grotto', 'Gemstone Glen', 'Gadget Garden', 'Goblin Gate',
    'Granite Glade', 'Gleaming Gulch', 'Gnome Nook', 'Golden Grove',
    'Gear Gorge', 'Glimmer Gap', 'Gizmo Grounds', 'Grassy Hyena',
  ],
  turtle: [
    'Tranquil Terrace', 'Tumble Town', 'Twilight Trail', 'Tidal Turn',
    'Thistle Tor', 'Timber Trench', 'Turtle Tavern', 'Topaz Tower',
    'Tangled Thicket', 'Tepid Tarn', 'Thunder Trail', 'Tundra Top',
  ],
  skull: [
    'Skull Sanctum', 'Shadow Shrine', 'Skeleton Shore', 'Specter Steppe',
    'Soul Swamp', 'Sinister Summit', 'Shade Springs', 'Spirit Stretch',
    'Sepulcher Sands', 'Sorrow Slope', 'Spook Shelf', 'Skull Sweep',
  ],
  spider: [
    'Silk Spindle', 'Shadow Silk', 'Spinner Spire', 'Strand Stretch',
    'Silken Sands', 'Spider Sweep', 'Sticky Springs', 'Spindle Steppe',
    'Silk Scar', 'Spinner Slope', 'Strand Shelf', 'Spider Strip',
  ],
  hyena: [
    'Gnash Gate', 'Growl Gorge', 'Grunt Gully', 'Gnaw Grounds',
    'Grim Garrison', 'Growling Glen', 'Hyena Notch', 'Gore Gulch',
    'Gravel Gap', 'Gnarl Grove', 'Grudge Garden', 'Hyena Nook',
  ],
  panda: [
    'Peaceful Peak', 'Plum Pagoda', 'Pine Paradise', 'Placid Pool',
    'Peony Plateau', 'Pebble Path', 'Panda Pavilion', 'Primrose Pass',
    'Pleasant Prairie', 'Porcelain Pond', 'Petal Point', 'Plum Pasture',
  ],
  lizard: [
    'Lava Lair', 'Lurking Ledge', 'Lizard Lagoon', 'Limestone Ledge',
    'Lush Landing', 'Lunar Lake', 'Lichen Lodge', 'Lost Lagoon',
    'Leafy Lane', 'Lantern Lair', 'Legacy Ledge', 'Lizard Loft',
  ],
  minotaur: [
    'Maze Manor', 'Might Mountain', 'Marble Mine', 'Mammoth Meadow',
    'Mystic Mesa', 'Monolith Mound', 'Minotaur March', 'Molten Moat',
    'Maul Mount', 'Magnus Mill', 'Mace Mire', 'Muscle Mesa',
  ],
  shaman: [
    'Spirit Shrine', 'Spell Spring', 'Sorcery Summit', 'Starfall Sanctum',
    'Sage Spire', 'Shimmer Shore', 'Sigil Swamp', 'Sacred Stone',
    'Spark Slope', 'Shaman Shelf', 'Spectral Sands', 'Storm Shrine',
  ],
  troll: [
    'Terror Tor', 'Thunder Throne', 'Titan Trench', 'Troll Tavern',
    'Tremor Trail', 'Twisted Tower', 'Thorned Thicket', 'Titan Tarn',
    'Tusk Terrace', 'Tyrant Top', 'Thrash Trench', 'Troll Tunnel',
  ],
  rogue: [
    'Rogue Ravine', 'Razor Ridge', 'Raider Roost', 'Reaper Run',
    'Ruin Reach', 'Raven Rest', 'Rascal Row', 'Rustblade Ruins',
    'Rebel Rise', 'Ridgeback Run', 'Rogue Retreat', 'Raptor Roost',
  ],
};

// ─── Pure Helper Functions ───────────────────────────────────

/** Seeded PRNG (Lehmer / Park-Miller) — deterministic for multiplayer sync */
export function seededRandom(seed: number): () => number {
  let s = seed;
  return () => { s = (s * 16807 + 0) % 2147483647; return s / 2147483647; };
}

/** Capitalize first letter */
export function cap(s: string): string {
  return s[0].toUpperCase() + s.slice(1);
}

/** Euclidean distance between two points */
export function pdist(a: { x: number; y: number }, b: { x: number; y: number }): number {
  const dx = a.x - b.x, dy = a.y - b.y;
  return Math.sqrt(dx * dx + dy * dy);
}

/** Squared Euclidean distance between two points (avoids sqrt) */
export function pdist2(a: { x: number; y: number }, b: { x: number; y: number }): number {
  const dx = a.x - b.x, dy = a.y - b.y;
  return dx * dx + dy * dy;
}

/**
 * Pick a unique camp name from the pool for an animal type.
 * Tracks used names to guarantee uniqueness via the passed-in tracker.
 */
export function pickCampName(
  animalType: string,
  rng: () => number,
  usedNames: Record<string, number>,
): string {
  const pool = CAMP_NAMES[animalType] || [`${cap(animalType)} Camp`];
  const idx = Math.floor(rng() * pool.length);
  const baseName = pool[idx];
  usedNames[baseName] = (usedNames[baseName] || 0) + 1;
  if (usedNames[baseName] > 1) return `${baseName} ${usedNames[baseName]}`;
  return baseName;
}
