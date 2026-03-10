import Phaser from 'phaser';
import { FirebaseSync } from '../network/FirebaseSync';

// ═══════════════════════════════════════════════════════════════
// GEMINI INTEGRATION
// ═══════════════════════════════════════════════════════════════

const GEMINI_API_KEY = (import.meta as any).env?.VITE_GEMINI_API_KEY || '';
const GEMINI_MODEL = 'gemini-2.0-flash';
const GEMINI_URL = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=`;
const GEMINI_MAX_RETRIES = 3;

interface HordeCommand {
  targetType: 'camp' | 'nearest_camp' | 'sweep_camps' | 'nexus' | 'base' | 'position' | 'defend' | 'retreat' | 'gather';
  targetAnimal?: string; // filter camps by animal type
  campIndex?: number; // specific camp index (-1 = auto-pick)
  qualifier?: 'nearest' | 'furthest' | 'weakest' | 'strongest' | 'uncaptured' | 'enemy';
  gatherResource?: ResourceType; // for gather commands
  narration?: string;
}

async function parseWithGemini(
  rawText: string,
  myUnits: { type: string; count: number }[],
  camps: { name: string; animalType: string; owner: string; index: number; x: number; y: number; dist: number; defenders: number }[],
  nexusHp: { mine: number; enemy: number },
  gameTime: number,
): Promise<HordeCommand[] | null> {
  if (!GEMINI_API_KEY) return null;

  const unitList = myUnits.map(u => `  ${u.type}: ${u.count} units`).join('\n');
  const campList = camps.map(c =>
    `  [${c.index}] ${c.name} (${c.animalType}) - ${c.owner} - dist:${c.dist} - defenders:${c.defenders}`
  ).join('\n');

  const prompt = `You parse voice commands for an RTS game. The player has already selected which army to command (via hotkey). You just determine WHERE to send them.

CAMPS (sorted by distance from player):
${campList}

NEXUS HP: mine=${nexusHp.mine}/50000, enemy=${nexusHp.enemy}/50000

ACTIONS:
- "camp": Go to a SPECIFIC camp. Set campIndex from the list above.
- "nearest_camp": Go to nearest camp matching filters.
- "sweep_camps": Auto-chain capture ALL matching camps one by one.
- "nexus": Attack enemy nexus/base/throne.
- "base"/"defend"/"retreat": Go home / hold position / fall back.
- "position": Go to map center.
- "gather": Gather resources. Set gatherResource to "carrot", "meat", or "crystal". Units loop: pick up → deliver → repeat.

QUALIFIERS (for nearest_camp): nearest, furthest, weakest, uncaptured, enemy

EXAMPLES:
- "attack Bouncy Burrow" → camp, campIndex=(index of Bouncy Burrow)
- "go to Wailing Woods" → camp, campIndex=(index of Wailing Woods)
- "nearest bunny camp" → nearest_camp, targetAnimal=bunny, qualifier=nearest
- "sweep wolf camps" → sweep_camps, targetAnimal=wolf
- "attack nexus" → nexus
- "closest camp" → nearest_camp, qualifier=nearest
- "weakest camp" → nearest_camp, qualifier=weakest
- "enemy camps" → nearest_camp, qualifier=enemy
- "defend" → defend
- "retreat" → retreat
- "gather carrots" → gather, gatherResource=carrot
- "gather meat" → gather, gatherResource=meat
- "get food" → gather, gatherResource=carrot
- "collect crystals" → gather, gatherResource=crystal
- "farm" → gather, gatherResource=carrot
- "make more bunnies" → gather, gatherResource=carrot

RULES:
- Output exactly ONE command (army selection is handled separately).
- Match camp names by partial word (e.g. "bouncy" = "Bouncy Burrow").
- ALWAYS pick the best interpretation — never refuse.

COMMAND: "${rawText}"

JSON ONLY (no markdown):
{
  "targetType": "<camp|nearest_camp|sweep_camps|nexus|base|position|defend|retreat|gather>",
  "targetAnimal": "<bunny|turtle|wolf|scorpion|hawk|bear|crocodile|lion|phoenix|dragon or omit>",
  "campIndex": <index or -1>,
  "qualifier": "<nearest|furthest|weakest|uncaptured|enemy or omit>",
  "gatherResource": "<carrot|meat|crystal or omit>",
  "narration": "<One dramatic sentence>"
}`;

  const body = JSON.stringify({
    contents: [{ parts: [{ text: prompt }] }],
    generationConfig: {
      maxOutputTokens: 256,
      responseMimeType: 'application/json',
    },
  });

  for (let attempt = 0; attempt < GEMINI_MAX_RETRIES; attempt++) {
    try {
      const response = await fetch(GEMINI_URL + GEMINI_API_KEY, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body,
      });

      if (response.status === 429) {
        // Rate limited — wait and retry with exponential backoff
        const wait = 1000 * Math.pow(2, attempt); // 1s, 2s, 4s
        console.warn(`[Gemini] 429 rate limited, retrying in ${wait}ms (attempt ${attempt + 1}/${GEMINI_MAX_RETRIES})`);
        await new Promise(r => setTimeout(r, wait));
        continue;
      }

      if (!response.ok) {
        console.warn('[Gemini] API error:', response.status);
        return null;
      }

      const data = await response.json();
      const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
      if (!text) return null;

      const parsed = JSON.parse(text);
      if (Array.isArray(parsed)) return parsed as HordeCommand[];
      return [parsed] as HordeCommand[];
    } catch (err) {
      console.warn('[Gemini] Parse failed, falling back to local:', err);
      return null;
    }
  }

  console.warn('[Gemini] All retries exhausted, falling back to local parser');
  return null;
}

// ═══════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════

interface AnimalDef {
  type: string;
  emoji: string;
  hp: number;
  attack: number;
  speed: number; // pixels per second
  tier: number;
}

type ResourceType = 'carrot' | 'meat' | 'crystal';

interface HGroundItem {
  id: number;
  type: ResourceType;
  x: number;
  y: number;
  sprite: Phaser.GameObjects.Text | null;
  dead: boolean;
  age: number; // ms since spawn, for despawn
}

interface HGatherLoop {
  action: 'gather';
  resourceType: ResourceType;
  deliverTo: string; // campId or 'base'
  phase: 'seeking' | 'carrying' | 'delivering';
}

interface HUnit {
  id: number;
  type: string;
  team: 0 | 1 | 2; // 0 = neutral camp defender
  hp: number;
  maxHp: number;
  attack: number;
  speed: number;
  x: number;
  y: number;
  targetX: number;
  targetY: number;
  attackTimer: number;
  sprite: Phaser.GameObjects.Text | null;
  dead: boolean;
  campId: string | null; // if this unit is a camp defender, which camp
  lungeX: number; // sprite offset during attack lunge
  lungeY: number;
  // Special mechanic flags
  hasRebirth: boolean;   // phoenix: respawn once on death
  diveReady: boolean;    // hawk: next attack does 2x
  diveTimer: number;     // hawk: cooldown before dive recharges
  // Resource economy
  carrying: ResourceType | null;
  carrySprite: Phaser.GameObjects.Text | null;
  loop: HGatherLoop | null;
  isElite: boolean; // golden elite prey — drops crystals
}

interface CampDef {
  id: string;
  name: string;
  type: string;
  x: number;
  y: number;
  guards: number;
  spawnMs: number;
  buff: { stat: string; value: number };
}

interface HCamp {
  id: string;
  name: string;
  animalType: string;
  tier: number;
  guardCount: number; // how many defenders to spawn
  x: number;
  y: number;
  owner: 0 | 1 | 2;
  spawnMs: number;
  spawnTimer: number;
  buff: { stat: string; value: number };
  label: Phaser.GameObjects.Text | null;
  area: Phaser.GameObjects.Arc | null;
  captureBar: Phaser.GameObjects.Graphics | null;
  storedFood: number; // food stored toward next spawn
}

interface HNexus {
  team: 1 | 2;
  x: number;
  y: number;
  hp: number;
  maxHp: number;
  container: Phaser.GameObjects.Container | null;
  hpBar: Phaser.GameObjects.Graphics | null;
  hpText: Phaser.GameObjects.Text | null;
}

// ═══════════════════════════════════════════════════════════════
// MULTIPLAYER SYNC TYPES
// ═══════════════════════════════════════════════════════════════

interface HordeSceneData {
  isOnline?: boolean;
  gameId?: string;
  playerId?: string;
  amPlayer1?: boolean;
}

interface HordeSyncUnit {
  id: number; type: string; team: number;
  hp: number; maxHp: number; attack: number; speed: number;
  x: number; y: number; targetX: number; targetY: number;
  dead: boolean; campId: string | null;
}

interface HordeSyncState {
  units: HordeSyncUnit[];
  camps: { id: string; owner: number; spawnTimer: number }[];
  nexuses: { team: number; hp: number }[];
  rallyPoints: Record<string, { x: number; y: number }>;
  baseSpawnTimers: { 1: number; 2: number };
  nextId: number;
  gameTime: number;
  gameOver: boolean;
  winner: number | null;
}

// ═══════════════════════════════════════════════════════════════
// CONSTANTS
// ═══════════════════════════════════════════════════════════════

const WORLD_W = 3200;
const WORLD_H = 3200;
const P1_BASE = { x: 250, y: WORLD_H - 250 };
const P2_BASE = { x: WORLD_W - 250, y: 250 };

// Each tier is ~10x stronger than the previous
// 1 wolf ≈ 10 bunnies, 1 bear ≈ 10 wolves, 1 lion ≈ 10 bears, 1 dragon ≈ 10 lions
const ANIMALS: Record<string, AnimalDef> = {
  bunny:     { type: 'bunny',     emoji: '🐰', hp: 20,    attack: 4,    speed: 160, tier: 1 },
  turtle:    { type: 'turtle',    emoji: '🐢', hp: 40,    attack: 4,    speed: 80,  tier: 1 },
  wolf:      { type: 'wolf',      emoji: '🐺', hp: 120,   attack: 15,   speed: 140, tier: 2 },
  scorpion:  { type: 'scorpion',  emoji: '🦂', hp: 100,   attack: 20,   speed: 120, tier: 2 },
  hawk:      { type: 'hawk',      emoji: '🦅', hp: 80,    attack: 18,   speed: 180, tier: 2 },
  bear:      { type: 'bear',      emoji: '🐻', hp: 600,   attack: 50,   speed: 100, tier: 3 },
  crocodile: { type: 'crocodile', emoji: '🐊', hp: 500,   attack: 60,   speed: 90,  tier: 3 },
  lion:      { type: 'lion',      emoji: '🦁', hp: 2000,  attack: 150,  speed: 120, tier: 4 },
  phoenix:   { type: 'phoenix',   emoji: '🔥', hp: 1800,  attack: 140,  speed: 110, tier: 4 },
  dragon:    { type: 'dragon',    emoji: '🐉', hp: 8000,  attack: 500,  speed: 80,  tier: 5 },
};

// Hard counter map: attacker type → list of types it deals 2x damage to
const HARD_COUNTERS: Record<string, string[]> = {
  turtle:    ['bunny'],              // shell blocks weak hits
  scorpion:  ['bear', 'turtle'],     // armor pierce shreds tanks
  hawk:      ['scorpion'],           // dive strike picks off scorpions
  crocodile: ['bear', 'lion'],       // death roll executes big targets
  phoenix:   ['lion', 'dragon'],     // rebirth outlasts burst damage
  wolf:      ['scorpion', 'hawk'],   // pack swarms fragile specialists
  bunny:     [],                     // no hard counters (numbers advantage)
  bear:      ['turtle', 'crocodile'],// raw power crushes slower tanks
  lion:      ['crocodile', 'phoenix'],// speed + burst kills before execute/rebirth
  dragon:    ['phoenix', 'hawk'],    // splash kills phoenix twice, swats hawks
};

// Procedural map: competitive symmetric layout.
// Distribution: ~50% T1, ~25% T2, ~12% T3, ~8% T4, ~5% T5
// Mirror-symmetric across the diagonal (P1↔P2 fair) with camps in all quadrants.
// Seeded RNG so both players get the same map in multiplayer.

function seededRandom(seed: number) {
  let s = seed;
  return () => { s = (s * 16807 + 0) % 2147483647; return s / 2147483647; };
}

// Unique alliterative/rhyming camp names per animal — easy to call out by voice
const CAMP_NAMES: Record<string, string[]> = {
  bunny: [
    'Bouncy Burrow', 'Bramble Borough', 'Breezy Bluff', 'Bubbling Brook',
    'Bashful Basin', 'Bright Bend', 'Buttercup Bay', 'Berry Bramble',
    'Bumble Bridge', 'Blossom Bank', 'Bunny Bazaar', 'Bristle Bog',
  ],
  turtle: [
    'Tranquil Terrace', 'Tumble Town', 'Twilight Trail', 'Tidal Turn',
    'Thistle Tor', 'Timber Trench', 'Turtle Tavern', 'Topaz Tower',
    'Tangled Thicket', 'Tepid Tarn', 'Thunder Trail', 'Tundra Top',
  ],
  wolf: [
    'Wailing Woods', 'Whispering Wilds', 'Windswept Watch', 'Wicked Warren',
    'Warden Wall', 'Wanderer Way', 'Winter Wake', 'Wolven Weald',
    'Withered Walk', 'Wild Whistle', 'Warpath West', 'Wooded Wharf',
  ],
  scorpion: [
    'Stinger Sands', 'Scorched Strip', 'Shadow Sting', 'Sunken Spire',
    'Sand Sweep', 'Silent Strike', 'Sulfur Springs', 'Stone Steppe',
    'Skull Stretch', 'Searing Scar', 'Serpent Slope', 'Storm Shelf',
  ],
  hawk: [
    'Howling Heights', 'High Hollow', 'Hazy Hilltop', 'Hawk Haven',
    'Hidden Helm', 'Highland Haunt', 'Halo Hill', 'Horizon Hook',
    'Hanging Heath', 'Harvest Holt', 'Hero Helm', 'Humble Hearth',
  ],
  bear: [
    'Boulder Basin', 'Blackberry Bluff', 'Brawler Bay', 'Big Bear Bog',
    'Broken Bridge', 'Brute Barracks', 'Bark Bastion', 'Beast Bunker',
    'Bitter Bend', 'Blizzard Base', 'Bronze Berm', 'Burly Bank',
  ],
  crocodile: [
    'Croc Creek', 'Crimson Cove', 'Cruel Canyon', 'Crumbling Court',
    'Crystal Crossing', 'Cobalt Cliff', 'Coral Camp', 'Cursed Cavern',
    'Copper Crag', 'Cedar Cut', 'Clawed Coast', 'Crater Core',
  ],
  lion: [
    'Lion Lodge', 'Lofty Lair', 'Lonely Ledge', 'Lunar Landing',
    'Lavender Lake', 'Lightning Leap', 'Lost Lookout', 'Lumber Line',
    'Lusty Lawn', 'Lantern Lane', 'Legacy Loft', 'Lynx Lagoon',
  ],
  phoenix: [
    'Flame Forge', 'Fiery Falls', 'Furnace Field', 'Flash Frontier',
    'Frozen Fire', 'Fury Fort', 'Fading Flare', 'Fossil Flat',
    'Phantom Pyre', 'Phoenix Peak', 'Flickering Fen', 'First Fire',
  ],
  dragon: [
    'Dragon Dome', 'Dread Den', 'Dark Divide', 'Dire Dungeon',
    'Doom Dale', 'Dragonfire Deep', 'Devil Drop', 'Dust Devil',
    'Diamond Drift', 'Dusk Domain', 'Demon Ditch', 'Dawn Depths',
  ],
};

// Track used names to guarantee uniqueness
const usedNames: Record<string, number> = {};

function pickCampName(animalType: string, rng: () => number): string {
  const pool = CAMP_NAMES[animalType] || [`${cap(animalType)} Camp`];
  // Pick a random name from the pool
  const idx = Math.floor(rng() * pool.length);
  const baseName = pool[idx];
  // Ensure uniqueness — append number if reused
  usedNames[baseName] = (usedNames[baseName] || 0) + 1;
  if (usedNames[baseName] > 1) return `${baseName} ${usedNames[baseName]}`;
  return baseName;
}

function makeCamps(): CampDef[] {
  const camps: CampDef[] = [];
  const rng = seededRandom(42069);
  // Reset used names
  for (const k of Object.keys(usedNames)) delete usedNames[k];

  const TIER_ANIMALS: Record<number, string[]> = {
    1: ['bunny', 'turtle'],
    2: ['wolf', 'scorpion', 'hawk'],
    3: ['bear', 'crocodile'],
    4: ['lion', 'phoenix'],
    5: ['dragon'],
  };

  const BUFF_POOL: { stat: string; value: number }[] = [
    { stat: 'speed', value: 0.05 }, { stat: 'attack', value: 0.08 },
    { stat: 'hp', value: 0.10 }, { stat: 'attack', value: 0.06 },
    { stat: 'speed', value: 0.07 }, { stat: 'hp', value: 0.08 },
    { stat: 'all', value: 0.04 },
  ];

  const GUARD_COUNT: Record<string, number> = {
    bunny: 3, turtle: 3, wolf: 3, scorpion: 3, hawk: 3,
    bear: 2, crocodile: 2, lion: 2, phoenix: 2, dragon: 1,
  };
  const SPAWN_MS: Record<string, number> = {
    bunny: 4000, turtle: 4500, wolf: 6000, scorpion: 6000, hawk: 5500,
    bear: 7500, crocodile: 7500, lion: 10000, phoenix: 10000, dragon: 15000,
  };

  // Pre-roll the tier list with correct distribution
  // 40 camps total (20 mirrored pairs): 50% T1, 25% T2, 12.5% T3, 7.5% T4, 5% T5
  const tierList: number[] = [];
  const counts = { 1: 20, 2: 10, 3: 5, 4: 3, 5: 2 }; // = 40
  for (const [tier, count] of Object.entries(counts)) {
    for (let i = 0; i < count; i++) tierList.push(Number(tier));
  }
  // Shuffle tier list
  for (let i = tierList.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [tierList[i], tierList[j]] = [tierList[j], tierList[i]];
  }

  const MARGIN = 150;
  const BASE_CLEAR = 350;
  const CAMP_SPACING = 320; // wider spacing = more spread out
  const placed: { x: number; y: number }[] = [];

  const tooClose = (x: number, y: number) => {
    if (pdist({ x, y }, P1_BASE) < BASE_CLEAR) return true;
    if (pdist({ x, y }, P2_BASE) < BASE_CLEAR) return true;
    for (const p of placed) {
      if (pdist({ x, y }, p) < CAMP_SPACING) return true;
    }
    return false;
  };

  // Mirror a point across the map center diagonal (swap relative to center)
  const cx = WORLD_W / 2, cy = WORLD_H / 2;
  const mirror = (x: number, y: number): [number, number] => {
    return [cx + (cx - x), cy + (cy - y)];
  };

  // Place camps in mirrored pairs for fairness
  // Half are placed on P1's side, half mirrored to P2's side
  // Higher tiers go toward the center/contested zones
  let idx = 0;
  let tierIdx = 0;

  // Sort tiers so low tiers go near bases, high tiers toward center
  const sortedTiers = [...tierList].sort((a, b) => a - b);

  for (let i = 0; i < sortedTiers.length && tierIdx < sortedTiers.length; i++) {
    const tier = sortedTiers[tierIdx];

    // Determine placement zone based on tier
    // T1: near own base (300-900 from base)
    // T2: mid-range (700-1400 from base)
    // T3: contested zone (1000-1800 from base)
    // T4-5: center/deep enemy territory (1300-2200 from base)
    const minR = tier <= 1 ? 350 : tier <= 2 ? 600 : tier <= 3 ? 900 : 1100;
    const maxR = tier <= 1 ? 1200 : tier <= 2 ? 1800 : tier <= 3 ? 2400 : 2800;

    let placed1 = false;
    for (let attempt = 0; attempt < 80; attempt++) {
      // Generate point at random angle from P1 base, within tier distance range
      const angle = rng() * Math.PI * 2;
      const dist = minR + rng() * (maxR - minR);
      const x = P1_BASE.x + Math.cos(angle) * dist;
      const y = P1_BASE.y + Math.sin(angle) * dist;

      // Clamp to world bounds
      if (x < MARGIN || x > WORLD_W - MARGIN || y < MARGIN || y > WORLD_H - MARGIN) continue;
      if (tooClose(x, y)) continue;

      // Check the mirrored point too
      const [mx, my] = mirror(x, y);
      if (mx < MARGIN || mx > WORLD_W - MARGIN || my < MARGIN || my > WORLD_H - MARGIN) continue;
      if (tooClose(mx, my)) continue;

      // Both points are valid — place pair
      const pool = TIER_ANIMALS[tier];
      const animalType = pool[Math.floor(rng() * pool.length)];
      const def = ANIMALS[animalType];
      const buff = BUFF_POOL[Math.floor(rng() * BUFF_POOL.length)];
      // Mirror gets same animal type for fairness, different buff
      const buff2 = BUFF_POOL[Math.floor(rng() * BUFF_POOL.length)];

      const name1 = pickCampName(animalType, rng);
      const name2 = pickCampName(animalType, rng);

      camps.push({
        id: `camp_${idx++}`, name: `${def.emoji} ${name1}`,
        type: animalType, x: Math.round(x), y: Math.round(y),
        guards: GUARD_COUNT[animalType], spawnMs: SPAWN_MS[animalType], buff,
      });
      placed.push({ x, y });

      camps.push({
        id: `camp_${idx++}`, name: `${def.emoji} ${name2}`,
        type: animalType, x: Math.round(mx), y: Math.round(my),
        guards: GUARD_COUNT[animalType], spawnMs: SPAWN_MS[animalType], buff: buff2,
      });
      placed.push({ x: mx, y: my });

      tierIdx += 2; // consumed 2 from the tier list
      placed1 = true;
      break;
    }
    if (!placed1) tierIdx += 2; // skip if couldn't place
  }

  return camps;
}

function cap(s: string) { return s[0].toUpperCase() + s.slice(1); }

const CAMP_DEFS = makeCamps();
const NEXUS_MAX_HP = 50000;
const MAX_UNITS = 80;
const BASE_SPAWN_MS = 5000;
const ATTACK_CD_MS = 1500;
const COMBAT_RANGE = 80;
const CAMP_RANGE = 120;
const AI_TICK_MS = 4000;
const TEAM_COLORS = { 1: 0x4499FF, 2: 0xFF5555 };
const GOLDEN_ANGLE = 2.39996;

// ─── RESOURCE ECONOMY ──────────────────────────────────────
const SPAWN_COSTS: Record<string, { type: ResourceType; amount: number }> = {
  bunny:     { type: 'carrot',  amount: 1 },
  turtle:    { type: 'carrot',  amount: 1 },
  wolf:      { type: 'meat',    amount: 3 },
  scorpion:  { type: 'meat',    amount: 3 },
  hawk:      { type: 'meat',    amount: 3 },
  bear:      { type: 'meat',    amount: 5 },
  crocodile: { type: 'meat',    amount: 5 },
  lion:      { type: 'crystal', amount: 8 },
  phoenix:   { type: 'crystal', amount: 8 },
  dragon:    { type: 'crystal', amount: 12 },
};
const RESOURCE_EMOJI: Record<ResourceType, string> = { carrot: '🥕', meat: '🍖', crystal: '💎' };
const CARROT_SPAWN_MS = 4000;       // new carrot every 4s
const MAX_GROUND_ITEMS = 120;
const ITEM_DESPAWN_MS = 90000;      // ground items vanish after 90s
const PICKUP_RANGE = 35;
const WILD_ANIMAL_COUNT = 15;       // neutral roaming animals on outskirts
const ELITE_PREY_COUNT = 3;         // golden elite prey (T4 stats, drop crystals)
const WILD_RESPAWN_MS = 20000;      // respawn wild animals every 20s

function pdist(a: { x: number; y: number }, b: { x: number; y: number }): number {
  const dx = a.x - b.x, dy = a.y - b.y;
  return Math.sqrt(dx * dx + dy * dy);
}

// ═══════════════════════════════════════════════════════════════
// SCENE
// ═══════════════════════════════════════════════════════════════

export class HordeScene extends Phaser.Scene {
  private units: HUnit[] = [];
  private camps: HCamp[] = [];
  private nexuses: HNexus[] = [];
  private nextId = 0;
  private gameTime = 0;
  private gameOver = false;
  private winner: 1 | 2 | null = null;

  private baseSpawnTimers = { 1: 0, 2: 0 };
  private aiTimer = 0;

  // Resource economy
  private groundItems: HGroundItem[] = [];
  private nextItemId = 0;
  private carrotSpawnTimer = 0;
  private wildRespawnTimer = 0;
  private baseStockpile = {
    1: { carrot: 0, meat: 0, crystal: 0 },
    2: { carrot: 0, meat: 0, crystal: 0 },
  };

  private hudTexts: Record<string, Phaser.GameObjects.Text> = {};
  private textInput: HTMLInputElement | null = null;
  private voiceStatusEl: HTMLDivElement | null = null;
  private transcriptEl: HTMLSpanElement | null = null;

  private wasdKeys!: Record<string, Phaser.Input.Keyboard.Key>;
  private spaceKey!: Phaser.Input.Keyboard.Key;
  private recognition: any = null;
  private isListening = false;

  private isDragging = false;
  private dragPrevX = 0;
  private dragPrevY = 0;

  // Persistent rally points: key = "type_team", value = {x, y}
  // When you command "bunnies attack wolf camp", ALL future bunnies also go there
  private rallyPoints: Record<string, { x: number; y: number }> = {};
  private activeSweeps: Record<string, {
    team: 1 | 2; subject: string;
    targets: { x: number; y: number; id: string }[]; currentIdx: number;
  }> = {};

  // Army selection: TAB cycles forward, Shift+TAB cycles back, number keys direct-pick
  private selectedArmy: string = 'all';
  // Cycle order: all → then only types the player currently has units of
  private allArmyTypes = ['all', 'bunny', 'turtle', 'wolf', 'scorpion', 'hawk', 'bear', 'crocodile', 'lion', 'phoenix', 'dragon'];
  private armyKeys: Record<string, string> = {
    '1': 'all', '2': 'bunny', '3': 'wolf', '4': 'bear', '5': 'lion', '6': 'dragon',
    '7': 'turtle', '8': 'scorpion', '9': 'hawk', '0': 'crocodile',
  };
  private selectionLabel: Phaser.GameObjects.Text | null = null;
  private armyBarEl: HTMLDivElement | null = null;

  // ─── MULTIPLAYER ──────────────────────────────────────────────
  private isOnline = false;
  private isHost = true; // host = runs simulation; guest = renders sync state
  private myTeam: 1 | 2 = 1;
  private gameId: string | null = null;
  private playerId: string | null = null;
  private firebase: FirebaseSync | null = null;
  private syncTimer = 0;
  private readonly SYNC_INTERVAL_MS = 150; // push state 6-7 times/sec

  constructor() {
    super({ key: 'HordeScene' });
  }

  init(data?: HordeSceneData) {
    this.isOnline = data?.isOnline || false;
    this.gameId = data?.gameId || null;
    this.playerId = data?.playerId || null;
    // Player 1 (host) = team 1 (bottom-left), Player 2 (guest) = team 2 (top-right)
    this.isHost = data?.amPlayer1 !== false; // default host if solo
    this.myTeam = this.isHost ? 1 : 2;
  }

  create() {
    this.units = [];
    this.camps = [];
    this.nexuses = [];
    this.nextId = 0;
    this.gameTime = 0;
    this.gameOver = false;
    this.winner = null;
    this.baseSpawnTimers = { 1: 0, 2: 0 };
    this.aiTimer = 0;
    this.hudTexts = {};
    this.rallyPoints = {};
    this.activeSweeps = {};
    this.selectedArmy = 'all';
    this.groundItems = [];
    this.nextItemId = 0;
    this.carrotSpawnTimer = 0;
    this.wildRespawnTimer = 0;
    this.baseStockpile = {
      1: { carrot: 3, meat: 0, crystal: 0 },  // start with 3 carrots
      2: { carrot: 3, meat: 0, crystal: 0 },
    };

    this.syncTimer = 0;

    this.cameras.main.setBackgroundColor('#0d1a0d');
    this.drawBackground();
    this.setupCamps();
    this.setupNexuses();
    this.setupCamera();
    this.setupInput();
    this.setupHUD();
    this.events.on('shutdown', () => this.cleanupHTML());

    // Starting bunnies — only host/solo spawns units; guest gets them via sync
    if (!this.isOnline || this.isHost) {
      for (let i = 0; i < 3; i++) {
        this.spawnUnit('bunny', 1, P1_BASE.x + 50 + i * 20, P1_BASE.y - 50);
        this.spawnUnit('bunny', 2, P2_BASE.x - 50 - i * 20, P2_BASE.y + 50);
      }
      this.spawnWildAnimals();
    }

    // ─── ONLINE SETUP ───
    if (this.isOnline && this.gameId) {
      this.firebase = FirebaseSync.getInstance();
      if (this.isHost) {
        // Host: listen for guest commands
        this.firebase.onRemoteOrders(this.gameId, (data) => {
          if (data.orders) {
            for (const entry of data.orders) {
              // entry is { heroId, order: { text, team } }
              const cmd = (entry as any).order || entry;
              if (cmd.text && cmd.team) {
                this.handleCommand(cmd.text, cmd.team as 1 | 2);
              }
            }
          }
          // Clean up processed order
          if (this.gameId) this.firebase!.removeRemoteOrder(this.gameId, data.key);
        });
      } else {
        // Guest: listen for sync state from host
        this.firebase.onSyncState(this.gameId, (state: any) => {
          this.applyGuestSync(state as HordeSyncState);
        });
      }
    }
  }

  // ─── BACKGROUND ──────────────────────────────────────────────

  private drawBackground() {
    const g = this.add.graphics();

    // Faint concentric rings from each nexus
    for (const [base, color] of [[P1_BASE, 0x4499FF], [P2_BASE, 0xFF5555]] as const) {
      for (const r of [350, 750, 1100]) {
        g.lineStyle(1, color as number, 0.08);
        g.strokeCircle(base.x, base.y, r);
      }
    }

    // Diagonal lane
    g.lineStyle(2, 0xffffff, 0.04);
    g.lineBetween(P1_BASE.x, P1_BASE.y, P2_BASE.x, P2_BASE.y);

    // Subtle grid
    g.lineStyle(1, 0xffffff, 0.015);
    for (let x = 0; x < WORLD_W; x += 200) g.lineBetween(x, 0, x, WORLD_H);
    for (let y = 0; y < WORLD_H; y += 200) g.lineBetween(0, y, WORLD_W, y);
  }

  // ─── CAMPS ───────────────────────────────────────────────────

  private setupCamps() {
    for (const def of CAMP_DEFS) {
      const animalDef = ANIMALS[def.type];

      const area = this.add.circle(def.x, def.y, CAMP_RANGE, 0xFFD93D, 0.06);
      area.setStrokeStyle(2, 0xFFD93D, 0.25);

      const label = this.add.text(def.x, def.y - 55, def.name, {
        fontSize: '18px', color: '#FFD93D', fontFamily: '"Nunito", sans-serif', fontStyle: 'bold',
        stroke: '#000000', strokeThickness: 4,
      }).setOrigin(0.5).setDepth(5);

      const captureBar = this.add.graphics().setDepth(6);

      const camp: HCamp = {
        id: def.id, name: def.name, animalType: def.type, tier: animalDef.tier,
        guardCount: def.guards,
        x: def.x, y: def.y, owner: 0,
        spawnMs: def.spawnMs, spawnTimer: 0, buff: def.buff,
        label, area, captureBar, storedFood: 0,
      };
      this.camps.push(camp);

      // Spawn real neutral defender units around the camp (host/solo only; guest gets via sync)
      if (!this.isOnline || this.isHost) {
        this.spawnCampDefenders(camp);
      }
    }
  }

  private spawnCampDefenders(camp: HCamp) {
    const def = ANIMALS[camp.animalType];
    for (let i = 0; i < camp.guardCount; i++) {
      const angle = (i / camp.guardCount) * Math.PI * 2;
      const gx = camp.x + Math.cos(angle) * 50;
      const gy = camp.y + Math.sin(angle) * 50;
      // Neutral defenders wander near their camp
      const wanderAngle = Math.random() * Math.PI * 2;
      const wanderR = 20 + Math.random() * 40;
      const speedVar = 0.85 + Math.random() * 0.3;
      this.units.push({
        id: this.nextId++, type: camp.animalType, team: 0,
        hp: def.hp * 1.5, maxHp: def.hp * 1.5,
        attack: def.attack * 1.2, speed: def.speed * 0.5 * speedVar,
        x: gx, y: gy,
        targetX: camp.x + Math.cos(wanderAngle) * wanderR,
        targetY: camp.y + Math.sin(wanderAngle) * wanderR,
        attackTimer: 0, sprite: null, dead: false,
        campId: camp.id, lungeX: 0, lungeY: 0,
        hasRebirth: camp.animalType === 'phoenix',
        diveReady: camp.animalType === 'hawk',
        diveTimer: 0,
        carrying: null, carrySprite: null, loop: null, isElite: false,
      });
    }
  }

  // ─── NEXUSES ─────────────────────────────────────────────────

  private setupNexuses() {
    for (const team of [1, 2] as const) {
      const base = team === 1 ? P1_BASE : P2_BASE;
      const c = this.add.container(base.x, base.y).setDepth(8);
      c.add(this.add.circle(0, 0, 50, TEAM_COLORS[team], 0.15));
      c.add(this.add.circle(0, 0, 35, TEAM_COLORS[team], 0.3));
      c.add(this.add.text(0, -5, '👑', { fontSize: '36px' }).setOrigin(0.5));
      const isMyNexus = team === this.myTeam;
      c.add(this.add.text(0, -55, isMyNexus ? 'YOUR NEXUS' : 'ENEMY NEXUS', {
        fontSize: '14px', color: isMyNexus ? '#4499FF' : '#FF5555',
        fontFamily: '"Fredoka", sans-serif', fontStyle: 'bold',
        stroke: '#000', strokeThickness: 3,
      }).setOrigin(0.5));

      this.nexuses.push({
        team, x: base.x, y: base.y,
        hp: NEXUS_MAX_HP, maxHp: NEXUS_MAX_HP,
        container: c,
        hpBar: this.add.graphics().setDepth(9),
        hpText: this.add.text(base.x, base.y + 50, `${NEXUS_MAX_HP}/${NEXUS_MAX_HP}`, {
          fontSize: '12px', color: '#f0e8ff', fontFamily: '"Nunito", sans-serif',
          fontStyle: 'bold', stroke: '#000', strokeThickness: 2,
        }).setOrigin(0.5).setDepth(9),
      });
    }
    this.drawNexusBars();
  }

  private drawNexusBars() {
    for (const n of this.nexuses) {
      const g = n.hpBar!;
      g.clear();
      const pct = Math.max(0, n.hp / n.maxHp);
      const w = 80, h = 8;
      g.fillStyle(0x000000, 0.6);
      g.fillRoundedRect(n.x - w / 2, n.y + 38, w, h, 4);
      g.fillStyle(pct > 0.5 ? 0x45E6B0 : pct > 0.25 ? 0xFFD93D : 0xFF5555);
      g.fillRoundedRect(n.x - w / 2, n.y + 38, w * pct, h, 4);
      n.hpText!.setText(`${Math.max(0, Math.ceil(n.hp))}/${n.maxHp}`);

      // Show stockpile near nexus (world-space, scales with zoom)
      const stock = this.baseStockpile[n.team as 1 | 2];
      const stockText = `🥕${stock.carrot} 🍖${stock.meat} 💎${stock.crystal}`;
      if (!this.hudTexts[`stock_${n.team}`]) {
        this.hudTexts[`stock_${n.team}`] = this.add.text(n.x, n.y + 65, stockText, {
          fontSize: '13px', color: '#f0e8ff', fontFamily: '"Nunito", sans-serif', fontStyle: 'bold',
          stroke: '#000', strokeThickness: 3, backgroundColor: 'rgba(0,0,0,0.5)',
          padding: { x: 6, y: 2 },
        }).setOrigin(0.5).setDepth(9);
      } else {
        this.hudTexts[`stock_${n.team}`].setText(stockText);
      }
      // Scale inversely with zoom
      const zoom = this.cameras.main.zoom;
      this.hudTexts[`stock_${n.team}`].setScale(Math.max(0.8, 1.0 / zoom));
    }
  }

  // ─── CAMERA ──────────────────────────────────────────────────

  private setupCamera() {
    const cam = this.cameras.main;
    cam.setBounds(0, 0, WORLD_W, WORLD_H);
    const myBase = this.myTeam === 1 ? P1_BASE : P2_BASE;
    const camOffX = this.myTeam === 1 ? 400 : -400;
    const camOffY = this.myTeam === 1 ? -400 : 400;
    cam.centerOn(myBase.x + camOffX, myBase.y + camOffY);
    cam.setZoom(0.7);
    this.input.on('wheel', (_ptr: any, _over: any, _dx: number, deltaY: number) => {
      cam.zoom = Phaser.Math.Clamp(cam.zoom + (deltaY > 0 ? -0.05 : 0.05), 0.2, 2.0);
    });

    // Drag to pan
    this.input.on('pointerdown', (ptr: Phaser.Input.Pointer) => {
      if (ptr.rightButtonDown() || ptr.middleButtonDown() || ptr.leftButtonDown()) {
        this.isDragging = true;
        this.dragPrevX = ptr.x;
        this.dragPrevY = ptr.y;
      }
    });
    this.input.on('pointermove', (ptr: Phaser.Input.Pointer) => {
      if (!this.isDragging) return;
      const dx = ptr.x - this.dragPrevX;
      const dy = ptr.y - this.dragPrevY;
      cam.scrollX -= dx / cam.zoom;
      cam.scrollY -= dy / cam.zoom;
      this.dragPrevX = ptr.x;
      this.dragPrevY = ptr.y;
    });
    this.input.on('pointerup', () => { this.isDragging = false; });
  }

  private updateCamera(dt: number) {
    const cam = this.cameras.main;
    const s = 800 * dt / cam.zoom;
    if (this.wasdKeys['W'].isDown) cam.scrollY -= s;
    if (this.wasdKeys['S'].isDown) cam.scrollY += s;
    if (this.wasdKeys['A'].isDown) cam.scrollX -= s;
    if (this.wasdKeys['D'].isDown) cam.scrollX += s;
  }

  // ─── INPUT ───────────────────────────────────────────────────

  private setupInput() {
    this.wasdKeys = {
      W: this.input.keyboard!.addKey('W'),
      A: this.input.keyboard!.addKey('A'),
      S: this.input.keyboard!.addKey('S'),
      D: this.input.keyboard!.addKey('D'),
    };
    this.spaceKey = this.input.keyboard!.addKey('SPACE');

    const input = document.createElement('input');
    input.id = 'horde-cmd-input';
    input.type = 'text';
    input.placeholder = 'Type command... (e.g. "bunnies attack wolf camp")';
    input.style.cssText = `
      position:absolute;bottom:20px;left:50%;transform:translateX(-50%);
      width:520px;padding:10px 18px;font-size:15px;
      background:rgba(13,26,13,0.95);color:#f0e8ff;
      border:2px solid #45E6B0;border-radius:14px;outline:none;z-index:100;
      font-family:'Nunito',sans-serif;font-weight:600;
    `;
    input.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter' && input.value.trim()) {
        this.issueCommand(input.value.trim());
        input.value = '';
      }
    });
    input.addEventListener('focus', () => { this.input.keyboard!.enabled = false; });
    input.addEventListener('blur', () => { this.input.keyboard!.enabled = true; });
    document.getElementById('game-container')!.appendChild(input);
    this.textInput = input;

    const voiceDiv = document.createElement('div');
    voiceDiv.id = 'horde-voice-status';
    voiceDiv.style.cssText = `
      position:absolute;bottom:70px;left:50%;transform:translateX(-50%);
      padding:8px 18px;background:rgba(13,26,13,0.9);border:2px solid #3D5040;
      border-radius:12px;z-index:100;font-family:'Nunito',sans-serif;
      font-size:13px;color:#8BAA8B;font-weight:600;display:flex;align-items:center;gap:8px;
    `;
    const voiceLabel = document.createElement('span');
    voiceLabel.textContent = '🎤 Hold SPACE to speak';
    const transcript = document.createElement('span');
    transcript.style.cssText = 'color:#FFD93D;max-width:300px;';
    voiceDiv.appendChild(voiceLabel);
    voiceDiv.appendChild(transcript);
    document.getElementById('game-container')!.appendChild(voiceDiv);
    this.voiceStatusEl = voiceDiv;
    this.transcriptEl = transcript;

    this.setupVoice(voiceLabel);
    this.spaceKey.on('down', () => this.startListening());
    this.spaceKey.on('up', () => this.stopListening());

    // Number-key army selection (1-0)
    for (const [key, army] of Object.entries(this.armyKeys)) {
      const k = this.input.keyboard!.addKey(key);
      k.on('down', () => {
        if (document.activeElement === this.textInput) return;
        this.selectedArmy = army;
        this.updateSelectionLabel();
      });
    }

    // TAB / Q / E to cycle through armies you actually have
    const tabKey = this.input.keyboard!.addKey('TAB');
    const qKey = this.input.keyboard!.addKey('Q');
    const eKey = this.input.keyboard!.addKey('E');

    tabKey.on('down', (event: KeyboardEvent) => {
      if (document.activeElement === this.textInput) return;
      event.preventDefault(); // prevent browser tab-focus
      this.cycleArmy(event.shiftKey ? -1 : 1);
    });
    qKey.on('down', () => {
      if (document.activeElement === this.textInput) return;
      this.cycleArmy(-1);
    });
    eKey.on('down', () => {
      if (document.activeElement === this.textInput) return;
      this.cycleArmy(1);
    });
  }

  private cycleArmy(direction: 1 | -1) {
    // Build list of available armies: 'all' + types the player currently has
    const available = this.getAvailableArmies();
    const currentIdx = available.indexOf(this.selectedArmy);
    let nextIdx = currentIdx + direction;
    if (nextIdx < 0) nextIdx = available.length - 1;
    if (nextIdx >= available.length) nextIdx = 0;
    this.selectedArmy = available[nextIdx];
    this.updateSelectionLabel();

    // Quick feedback showing what's selected
    const count = this.selectedArmy === 'all'
      ? this.units.filter(u => u.team === this.myTeam && !u.dead).length
      : this.units.filter(u => u.team === this.myTeam && !u.dead && u.type === this.selectedArmy).length;
    const emoji = this.selectedArmy === 'all' ? '' : (ANIMALS[this.selectedArmy]?.emoji + ' ' || '');
    const name = this.selectedArmy === 'all' ? 'All units' : cap(this.selectedArmy);
    this.showFeedback(`${emoji}${name} selected (${count})`, '#FFD93D');
  }

  private getAvailableArmies(): string[] {
    const myTypes = new Set<string>();
    for (const u of this.units) {
      if (u.team === this.myTeam && !u.dead) myTypes.add(u.type);
    }
    // Always include 'all', then only types we have units of, in tier order
    const available = ['all'];
    for (const type of this.allArmyTypes) {
      if (type !== 'all' && myTypes.has(type)) available.push(type);
    }
    return available;
  }

  private setupVoice(label: HTMLSpanElement) {
    const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SR) { label.textContent = 'No speech support'; return; }
    const rec = new SR();
    rec.continuous = false;
    rec.interimResults = true;
    rec.lang = 'en-US';
    rec.onresult = (e: any) => {
      let text = '';
      for (let i = 0; i < e.results.length; i++) text += e.results[i][0].transcript;
      if (this.transcriptEl) this.transcriptEl.textContent = text;
      if (e.results[e.results.length - 1].isFinal && text.trim()) {
        this.issueCommand(text.trim());
        this.stopListening();
      }
    };
    rec.onerror = () => this.stopListening();
    rec.onend = () => this.stopListening();
    this.recognition = rec;
  }

  private startListening() {
    if (this.isListening || !this.recognition || document.activeElement === this.textInput) return;
    this.isListening = true;
    if (this.voiceStatusEl) this.voiceStatusEl.style.borderColor = '#FF6B6B';
    if (this.transcriptEl) this.transcriptEl.textContent = '';
    try { this.recognition.start(); } catch (_e) { /* */ }
  }

  private stopListening() {
    if (!this.isListening) return;
    this.isListening = false;
    if (this.voiceStatusEl) this.voiceStatusEl.style.borderColor = '#3D5040';
    try { this.recognition?.stop(); } catch (_e) { /* */ }
    setTimeout(() => { if (!this.isListening && this.transcriptEl) this.transcriptEl.textContent = ''; }, 3000);
  }

  // ─── HUD ─────────────────────────────────────────────────────

  private setupHUD() {
    const cam = this.cameras.main;

    // Left panel background
    this.add.rectangle(0, 0, 260, cam.height, 0x000000, 0.45)
      .setOrigin(0, 0).setScrollFactor(0).setDepth(99);

    this.hudTexts['title'] = this.add.text(16, 12, 'HORDE CAPTURE', {
      fontSize: '18px', color: '#45E6B0', fontFamily: '"Fredoka", sans-serif', fontStyle: 'bold',
    }).setScrollFactor(0).setDepth(100);

    this.hudTexts['timer'] = this.add.text(130, 14, '0:00', {
      fontSize: '14px', color: '#FFD93D', fontFamily: '"Fredoka", sans-serif', fontStyle: 'bold',
    }).setOrigin(0, 0).setScrollFactor(0).setDepth(100);

    // Army section
    this.hudTexts['armyHeader'] = this.add.text(16, 44, 'YOUR ARMIES', {
      fontSize: '13px', color: '#4499FF', fontFamily: '"Fredoka", sans-serif', fontStyle: 'bold',
      letterSpacing: 1,
    }).setScrollFactor(0).setDepth(100);

    this.hudTexts['armies'] = this.add.text(16, 64, '', {
      fontSize: '12px', color: '#f0e8ff', fontFamily: '"Nunito", sans-serif', fontStyle: 'bold', lineSpacing: 5,
    }).setScrollFactor(0).setDepth(100);

    // Resources section
    this.hudTexts['resHeader'] = this.add.text(16, 195, 'RESOURCES', {
      fontSize: '13px', color: '#45E6B0', fontFamily: '"Fredoka", sans-serif', fontStyle: 'bold',
      letterSpacing: 1,
    }).setScrollFactor(0).setDepth(100);

    this.hudTexts['resources'] = this.add.text(16, 215, '', {
      fontSize: '12px', color: '#f0e8ff', fontFamily: '"Nunito", sans-serif', fontStyle: 'bold', lineSpacing: 3,
    }).setScrollFactor(0).setDepth(100);

    // Production section
    this.hudTexts['prodHeader'] = this.add.text(16, 265, 'PRODUCTION', {
      fontSize: '13px', color: '#C98FFF', fontFamily: '"Fredoka", sans-serif', fontStyle: 'bold',
      letterSpacing: 1,
    }).setScrollFactor(0).setDepth(100);

    this.hudTexts['production'] = this.add.text(16, 285, '', {
      fontSize: '12px', color: '#cbb8ee', fontFamily: '"Nunito", sans-serif', fontStyle: '600', lineSpacing: 4,
    }).setScrollFactor(0).setDepth(100);

    // Camps section
    this.hudTexts['campsHeader'] = this.add.text(16, 385, 'CAMPS', {
      fontSize: '13px', color: '#FFD93D', fontFamily: '"Fredoka", sans-serif', fontStyle: 'bold',
      letterSpacing: 1,
    }).setScrollFactor(0).setDepth(100);

    this.hudTexts['camps'] = this.add.text(16, 405, '', {
      fontSize: '11px', color: '#f0e8ff', fontFamily: '"Nunito", sans-serif', fontStyle: '600', lineSpacing: 3,
    }).setScrollFactor(0).setDepth(100);

    // Buffs
    this.hudTexts['buffs'] = this.add.text(16, cam.height - 80, '', {
      fontSize: '11px', color: '#C98FFF', fontFamily: '"Nunito", sans-serif', fontStyle: '600', lineSpacing: 2,
    }).setScrollFactor(0).setDepth(100);

    // Right side: enemy info
    this.add.rectangle(cam.width, 0, 220, 160, 0x000000, 0.35)
      .setOrigin(1, 0).setScrollFactor(0).setDepth(99);

    this.hudTexts['enemyHeader'] = this.add.text(cam.width - 16, 12, 'ENEMY', {
      fontSize: '13px', color: '#FF5555', fontFamily: '"Fredoka", sans-serif', fontStyle: 'bold',
      letterSpacing: 1,
    }).setOrigin(1, 0).setScrollFactor(0).setDepth(100);

    this.hudTexts['enemy'] = this.add.text(cam.width - 16, 32, '', {
      fontSize: '12px', color: '#ffcccc', fontFamily: '"Nunito", sans-serif', fontStyle: '600',
      lineSpacing: 4, align: 'right',
    }).setOrigin(1, 0).setScrollFactor(0).setDepth(100);

    // Feedback (center bottom)
    this.hudTexts['feedback'] = this.add.text(cam.width / 2, cam.height - 115, '', {
      fontSize: '16px', color: '#45E6B0', fontFamily: '"Nunito", sans-serif', fontStyle: 'bold',
    }).setOrigin(0.5).setScrollFactor(0).setDepth(100).setAlpha(0);

    // Phaser selection label (minimal, above army bar)
    this.selectionLabel = this.add.text(cam.width / 2, cam.height - 175, '', {
      fontSize: '12px', color: '#8BAA8B', fontFamily: '"Nunito", sans-serif', fontStyle: 'bold',
      stroke: '#000', strokeThickness: 2,
    }).setOrigin(0.5).setScrollFactor(0).setDepth(100);

    // HTML Army Bar — big visible cards for each animal type
    const armyBar = document.createElement('div');
    armyBar.id = 'horde-army-bar';
    armyBar.style.cssText = `
      position:absolute;bottom:62px;left:50%;transform:translateX(-50%);
      display:flex;gap:4px;z-index:101;pointer-events:none;
      font-family:'Nunito',sans-serif;
    `;
    document.getElementById('game-container')!.appendChild(armyBar);
    this.armyBarEl = armyBar;
    this.updateSelectionLabel();

    // Help hint (bottom right)
    this.hudTexts['help'] = this.add.text(cam.width - 16, cam.height - 100, [
      'Drag: Pan  |  Scroll: Zoom  |  WASD: Pan',
      'SPACE: Voice  |  Type below: Text',
      'Q/E: Cycle army  |  TAB: Next  |  1-0: Direct pick',
      'Commands apply to selected army',
      '"attack nearest camp" | "sweep camps" | "gather carrots"',
    ].join('\n'), {
      fontSize: '10px', color: '#4A6B4A', fontFamily: '"Nunito", sans-serif', lineSpacing: 2, align: 'right',
    }).setOrigin(1, 1).setScrollFactor(0).setDepth(100);
  }

  private updateHUD() {
    const myT = this.myTeam;
    const enemyT = myT === 1 ? 2 : 1;
    const p1 = this.units.filter(u => u.team === myT && !u.dead);
    const p2 = this.units.filter(u => u.team === enemyT && !u.dead);
    const countBy = (us: HUnit[]) => {
      const c: Record<string, number> = {};
      for (const u of us) c[u.type] = (c[u.type] || 0) + 1;
      return c;
    };
    const p1c = countBy(p1), p2c = countBy(p2);

    // Timer
    const secs = Math.floor(this.gameTime / 1000);
    this.hudTexts['timer']?.setText(`${Math.floor(secs / 60)}:${(secs % 60).toString().padStart(2, '0')}`);

    // ─── YOUR ARMIES (left panel) ───
    const armyLines: string[] = [];
    armyLines.push(`Total: ${p1.length}/${MAX_UNITS}`);
    for (const [type, def] of Object.entries(ANIMALS)) {
      const count = p1c[type] || 0;
      if (count === 0) continue;
      armyLines.push(`${def.emoji} ${cap(type)}:  ${count} units`);
    }
    if (armyLines.length === 1) armyLines.push('  (no units yet)');
    this.hudTexts['armies']?.setText(armyLines.join('\n'));

    // ─── RESOURCES ───
    const stock = this.baseStockpile[myT as 1 | 2];
    const resLines = [
      `🥕 Carrots: ${stock.carrot}`,
      `🍖 Meat: ${stock.meat}`,
      `💎 Crystals: ${stock.crystal}`,
    ];
    // Show camp food progress for owned camps
    const foodCamps = this.camps.filter(c => c.owner === myT);
    for (const c of foodCamps) {
      const cost = SPAWN_COSTS[c.animalType];
      if (cost) resLines.push(`  ${ANIMALS[c.animalType]?.emoji || ''} ${cap(c.animalType)}: ${c.storedFood}/${cost.amount}`);
    }
    this.hudTexts['resources']?.setText(resLines.join('\n'));

    // ─── PRODUCTION (food-gated) ───
    const prodLines: string[] = [];
    prodLines.push(`🐰 Base: 1🥕/bunny (${BASE_SPAWN_MS / 1000}s)`);
    const myCamps = this.camps.filter(c => c.owner === myT);
    for (const c of myCamps) {
      const cost = SPAWN_COSTS[c.animalType];
      if (!cost) continue;
      const emoji = ANIMALS[c.animalType]?.emoji || '';
      prodLines.push(`${emoji} ${cap(c.animalType)}: ${cost.amount}${RESOURCE_EMOJI[cost.type]} (${c.spawnMs / 1000}s)`);
    }
    this.hudTexts['production']?.setText(prodLines.join('\n'));

    // ─── CAMPS ───
    const yourCamps = this.camps.filter(c => c.owner === myT).length;
    const enemyCamps = this.camps.filter(c => c.owner === enemyT).length;
    const neutralCamps = this.camps.filter(c => c.owner === 0).length;
    const campLines: string[] = [];
    campLines.push(`🔵 Yours: ${yourCamps}  🔴 Enemy: ${enemyCamps}  ⚪ Neutral: ${neutralCamps}`);
    campLines.push('');
    for (const c of this.camps) {
      const icon = c.owner === 0 ? '⚪' : c.owner === myT ? '🔵' : '🔴';
      const tag = c.owner === myT ? ' (YOU)' : c.owner === enemyT ? ' (ENEMY)' : '';
      campLines.push(`${icon} ${c.name}${tag}`);
    }
    this.hudTexts['camps']?.setText(campLines.join('\n'));

    // ─── BUFFS ───
    const b = this.getBuffs(myT as 1 | 2);
    const bl: string[] = [];
    if (b.speed > 0) bl.push(`⚡ Speed +${Math.round(b.speed * 100)}%`);
    if (b.attack > 0) bl.push(`⚔ Attack +${Math.round(b.attack * 100)}%`);
    if (b.hp > 0) bl.push(`❤ HP +${Math.round(b.hp * 100)}%`);
    this.hudTexts['buffs']?.setText(bl.length ? `BUFFS:\n${bl.join('\n')}` : '');

    // ─── ENEMY (right panel) ───
    const enemyLines: string[] = [];
    enemyLines.push(`Total: ${p2.length}`);
    for (const [type, def] of Object.entries(ANIMALS)) {
      const count = p2c[type] || 0;
      if (count === 0) continue;
      enemyLines.push(`${def.emoji} ${cap(type)}: ${count}`);
    }
    const enemyCampsCount = this.camps.filter(c => c.owner === enemyT).length;
    enemyLines.push(`Camps: ${enemyCampsCount}`);
    this.hudTexts['enemy']?.setText(enemyLines.join('\n'));

    // Update army selector counts
    this.updateSelectionLabel();
  }

  // ─── MAIN UPDATE ────────────────────────────────────────────

  update(_time: number, delta: number) {
    if (this.gameOver) return;
    const dt = delta / 1000;
    this.updateCamera(dt);

    if (this.isOnline && !this.isHost) {
      // Guest: only render, no simulation — state comes from host via sync
      this.updateUnitSprites();
      this.updateCampVisuals();
      this.drawNexusBars();
      this.updateHUD();
      return;
    }

    // Host (or solo): run full simulation
    this.gameTime += delta;
    this.updateCarrotSpawning(delta);
    this.updateWildAnimals(delta);
    this.updateGatherLoops();
    this.updateResourcePickup();
    this.updateDeliveries();
    this.updateSpawning(delta);
    this.updateMovement(dt);
    this.updateCombat(delta);
    this.updateCampCapture();
    this.updateSweeps();
    // Only run AI when solo (not online PvP)
    if (!this.isOnline) this.updateAI(delta);
    this.cleanupDead();
    this.updateGroundItems(delta);
    this.updateUnitSprites();
    this.updateCampVisuals();
    this.drawNexusBars();
    this.updateHUD();
    this.checkWin();

    // Host: push sync state to Firebase
    if (this.isOnline && this.isHost && this.firebase && this.gameId) {
      this.syncTimer += delta;
      if (this.syncTimer >= this.SYNC_INTERVAL_MS) {
        this.syncTimer -= this.SYNC_INTERVAL_MS;
        this.pushHostSync();
      }
    }
  }

  // ─── SPAWNING ────────────────────────────────────────────────

  private updateSpawning(delta: number) {
    // Base spawning: consumes carrots from stockpile to spawn bunnies
    for (const team of [1, 2] as const) {
      if (this.units.filter(u => u.team === team && !u.dead).length >= MAX_UNITS) continue;
      this.baseSpawnTimers[team] += delta;
      if (this.baseSpawnTimers[team] >= BASE_SPAWN_MS) {
        if (this.baseStockpile[team].carrot >= 1) {
          this.baseSpawnTimers[team] -= BASE_SPAWN_MS;
          this.baseStockpile[team].carrot -= 1;
          const b = team === 1 ? P1_BASE : P2_BASE;
          this.spawnUnit('bunny', team, b.x + (team === 1 ? 60 : -60), b.y + (team === 1 ? -30 : 30));
        }
        // Don't subtract timer if no food — it stays ready to spawn when food arrives
      }
    }

    // Camp spawning: consumes storedFood when threshold reached
    for (const camp of this.camps) {
      if (camp.owner === 0) continue;
      if (this.units.filter(u => u.team === camp.owner && !u.dead).length >= MAX_UNITS) continue;
      const cost = SPAWN_COSTS[camp.animalType];
      if (!cost) continue;
      // Spawn when enough food is stored
      if (camp.storedFood >= cost.amount) {
        camp.spawnTimer += delta;
        if (camp.spawnTimer >= camp.spawnMs) {
          camp.spawnTimer -= camp.spawnMs;
          camp.storedFood -= cost.amount;
          this.spawnUnit(camp.animalType, camp.owner as 1 | 2, camp.x + 20, camp.y + 30);
        }
      }
    }
  }

  // ─── MOVEMENT (horde flocking) ─────────────────────────────

  private updateMovement(dt: number) {
    // Build spatial groups: same type + same team = one horde
    const hordes = new Map<string, HUnit[]>();
    for (const u of this.units) {
      if (u.dead) continue;
      const k = `${u.type}_${u.team}`;
      if (!hordes.has(k)) hordes.set(k, []);
      hordes.get(k)!.push(u);
    }

    // Precompute horde centers
    const hordeCenters = new Map<string, { cx: number; cy: number; count: number }>();
    for (const [k, group] of hordes) {
      let sx = 0, sy = 0;
      for (const u of group) { sx += u.x; sy += u.y; }
      hordeCenters.set(k, { cx: sx / group.length, cy: sy / group.length, count: group.length });
    }

    // Flocking strengths by tier — low tier = tight horde, high tier = more independent
    const COHESION_BY_TIER: Record<number, number> = { 1: 0.7, 2: 0.45, 3: 0.25, 4: 0.15, 5: 0.08 };
    const SEPARATION_DIST = 22; // min distance before pushing apart
    const SEPARATION_FORCE = 60; // push-apart strength

    for (const u of this.units) {
      if (u.dead) continue;

      // Base: move toward target
      const dx = u.targetX - u.x, dy = u.targetY - u.y;
      const d = Math.sqrt(dx * dx + dy * dy);
      if (d < 5) continue; // already there

      const buffMult = u.team !== 0 ? (1 + this.getBuffs(u.team as 1 | 2).speed) : 1;
      const spd = u.speed * buffMult;

      // Primary: always move at full speed toward target
      const forwardX = (dx / d) * spd;
      const forwardY = (dy / d) * spd;

      // Lateral nudges (cohesion, separation, avoidance) — added as offsets, never slow down forward speed
      let nudgeX = 0, nudgeY = 0;

      // Cohesion: steer toward horde center (skip neutral defenders)
      if (u.team !== 0) {
        const k = `${u.type}_${u.team}`;
        const center = hordeCenters.get(k);
        if (center && center.count > 1) {
          const tier = ANIMALS[u.type]?.tier || 1;
          const cohesion = COHESION_BY_TIER[tier] ?? 0.3;
          const cdx = center.cx - u.x, cdy = center.cy - u.y;
          const cd = Math.sqrt(cdx * cdx + cdy * cdy);
          if (cd > 10) {
            const pull = Math.min(cd * 0.02, 1.0) * cohesion * spd;
            nudgeX += (cdx / cd) * pull;
            nudgeY += (cdy / cd) * pull;
          }
        }
      }

      // Camp avoidance: steer away from neutral camps the unit is NOT targeting
      if (u.team !== 0) {
        for (const camp of this.camps) {
          if (camp.owner === u.team) continue;
          const campDist = pdist(u, camp);
          const avoidRadius = CAMP_RANGE + 60;
          if (campDist < avoidRadius && campDist > 5) {
            const targetToCamp = pdist({ x: u.targetX, y: u.targetY }, camp);
            if (targetToCamp < CAMP_RANGE) continue;
            const awayX = u.x - camp.x, awayY = u.y - camp.y;
            const awayD = Math.sqrt(awayX * awayX + awayY * awayY) || 1;
            const pushStrength = ((avoidRadius - campDist) / avoidRadius) * spd * 0.5;
            nudgeX += (awayX / awayD) * pushStrength;
            nudgeY += (awayY / awayD) * pushStrength;
          }
        }
      }

      // Separation: avoid stacking on nearby same-team units
      const horde = hordes.get(`${u.type}_${u.team}`);
      if (horde && horde.length > 1) {
        for (const o of horde) {
          if (o === u) continue;
          const ox = u.x - o.x, oy = u.y - o.y;
          const od = Math.sqrt(ox * ox + oy * oy);
          if (od < SEPARATION_DIST && od > 0.1) {
            const push = (SEPARATION_DIST - od) / SEPARATION_DIST;
            nudgeX += (ox / od) * push * SEPARATION_FORCE;
            nudgeY += (oy / od) * push * SEPARATION_FORCE;
          }
        }
      }

      // Combine: full-speed forward + capped lateral nudges
      let moveX = forwardX + nudgeX;
      let moveY = forwardY + nudgeY;

      // Normalize to ensure units always move at full speed (nudges steer, never slow)
      const moveD = Math.sqrt(moveX * moveX + moveY * moveY);
      if (moveD > 0) {
        const finalSpeed = spd * dt;
        u.x += (moveX / moveD) * finalSpeed;
        u.y += (moveY / moveD) * finalSpeed;
      }

      // Clamp to world bounds
      u.x = Math.max(0, Math.min(WORLD_W, u.x));
      u.y = Math.max(0, Math.min(WORLD_H, u.y));
    }
  }

  // ─── COMBAT ──────────────────────────────────────────────────

  private updateCombat(delta: number) {
    for (const u of this.units) {
      if (u.dead) continue;
      // Units carrying resources can't fight
      if (u.carrying) continue;
      u.attackTimer -= delta;

      // Hawk dive recharge: after 5s without attacking, dive is ready again
      if (u.type === 'hawk' && !u.diveReady) {
        u.diveTimer -= delta;
        if (u.diveTimer <= 0) u.diveReady = true;
      }

      if (u.attackTimer > 0) continue;

      // Find closest enemy: team 0 attacks anyone, team 1/2 attack each other AND team 0
      let best: HUnit | null = null, bestD = Infinity;
      for (const o of this.units) {
        if (o.dead || o.team === u.team) continue;
        if (u.team === 0 && o.team === 0) continue;
        const d = pdist(u, o);
        if (d <= COMBAT_RANGE && d < bestD) { bestD = d; best = o; }
      }

      // Nexus attack (only player units)
      const nex = u.team !== 0 ? this.nexuses.find(n => n.team !== u.team) : null;
      const nexD = nex ? pdist(u, nex) : Infinity;

      if (best) {
        const buffMult = u.team !== 0 ? (1 + this.getBuffs(u.team as 1 | 2).attack) : 1;
        let atk = u.attack * buffMult;
        const uTier = ANIMALS[u.type]?.tier || 1;

        // ─── HARD COUNTER: 2x damage ───
        const counters = HARD_COUNTERS[u.type];
        if (counters && counters.includes(best.type)) atk *= 2;

        // ─── TURTLE SHELL GUARD: 50% damage reduction when stationary ───
        const isStationary = pdist(best, { x: best.targetX, y: best.targetY }) < 15;
        if (best.type === 'turtle' && isStationary) atk *= 0.5;

        // ─── HAWK DIVE STRIKE: first attack = 2x damage ───
        if (u.type === 'hawk' && u.diveReady) {
          atk *= 2;
          u.diveReady = false;
          u.diveTimer = 5000; // 5s recharge
        }

        // ─── CROCODILE DEATH ROLL: 3x to targets below 40% HP ───
        if (u.type === 'crocodile' && best.hp / best.maxHp < 0.4) {
          atk *= 3;
        }

        // Tier 3+ get cleave/splash: damage primary + nearby enemies
        const splashRadius = uTier >= 5 ? 60 : uTier >= 4 ? 50 : uTier >= 3 ? 40 : 0;
        const splashTargets: HUnit[] = [best];
        if (splashRadius > 0) {
          for (const o of this.units) {
            if (o === best || o.dead || o.team === u.team) continue;
            if (u.team === 0 && o.team === 0) continue;
            if (pdist(o, best) <= splashRadius) splashTargets.push(o);
          }
        }

        for (const target of splashTargets) {
          let dmg = target === best ? atk : atk * 0.5; // half damage for splash

          // Shell guard also applies to splash targets
          if (target.type === 'turtle') {
            const tStationary = pdist(target, { x: target.targetX, y: target.targetY }) < 15;
            if (tStationary && target !== best) dmg *= 0.5;
          }

          target.hp -= dmg;

          // ─── PHOENIX REBIRTH: respawn at 50% HP instead of dying ───
          if (target.hp <= 0 && target.type === 'phoenix' && target.hasRebirth) {
            target.hp = target.maxHp * 0.5;
            target.hasRebirth = false;
            if (target.sprite) {
              this.tweens.killTweensOf(target.sprite);
              target.sprite.setAlpha(1);
              target.sprite.setScale(1.8);
              this.tweens.add({
                targets: target.sprite, scaleX: 1, scaleY: 1, duration: 400, ease: 'Back.easeOut',
              });
            }
          } else if (target.hp <= 0) {
            target.dead = true;
            // Drop meat on death (all units)
            this.spawnGroundItem('meat', target.x + (Math.random() - 0.5) * 20, target.y + (Math.random() - 0.5) * 20);
            // Elite prey drops crystals
            if (target.isElite) {
              for (let ci = 0; ci < 3; ci++) {
                this.spawnGroundItem('crystal', target.x + (Math.random() - 0.5) * 40, target.y + (Math.random() - 0.5) * 40);
              }
            }
            // Drop carried resource
            if (target.carrying) {
              this.spawnGroundItem(target.carrying, target.x, target.y);
              target.carrying = null;
            }
          }

          // Hit flash
          if (target.sprite && !target.dead) {
            this.tweens.killTweensOf(target.sprite);
            target.sprite.setAlpha(1);
            this.tweens.add({
              targets: target.sprite, alpha: 0.4, duration: 80, yoyo: true,
              onComplete: () => { if (target.sprite) target.sprite.setAlpha(1); },
            });
          }
        }
        u.attackTimer = ATTACK_CD_MS;

        // Cute lunge toward target
        const ldx = best.x - u.x, ldy = best.y - u.y;
        const ld = Math.sqrt(ldx * ldx + ldy * ldy) || 1;
        const lungeAmt = Math.min(20, ld * 0.4);
        u.lungeX = (ldx / ld) * lungeAmt;
        u.lungeY = (ldy / ld) * lungeAmt;
        this.tweens.add({
          targets: u, lungeX: 0, lungeY: 0,
          duration: 200, ease: 'Back.easeIn',
        });
      } else if (nex && nexD <= COMBAT_RANGE && u.team !== 0) {
        nex.hp -= u.attack * (1 + this.getBuffs(u.team as 1 | 2).attack);
        u.attackTimer = ATTACK_CD_MS;

        // Lunge toward nexus
        const ldx = nex.x - u.x, ldy = nex.y - u.y;
        const ld = Math.sqrt(ldx * ldx + ldy * ldy) || 1;
        const lungeAmt = Math.min(20, ld * 0.4);
        u.lungeX = (ldx / ld) * lungeAmt;
        u.lungeY = (ldy / ld) * lungeAmt;
        this.tweens.add({
          targets: u, lungeX: 0, lungeY: 0,
          duration: 200, ease: 'Back.easeIn',
        });
      }
    }
  }

  // ─── CAMP CAPTURE (real unit combat) ────────────────────────

  private updateCampCapture() {
    for (const camp of this.camps) {
      const defenders = this.units.filter(u => u.campId === camp.id && u.team === 0 && !u.dead);

      // Make neutral defenders wander slowly near their camp
      for (const d of defenders) {
        const distToCamp = pdist(d, camp);
        const distToTarget = pdist(d, { x: d.targetX, y: d.targetY });
        // Only pick new target when arrived or drifted too far — not every frame
        if (distToTarget < 8 || distToCamp > 80) {
          const a = Math.random() * Math.PI * 2;
          const r = 15 + Math.random() * 35;
          d.targetX = camp.x + Math.cos(a) * r;
          d.targetY = camp.y + Math.sin(a) * r;
        }
      }

      if (camp.owner === 0) {
        // Neutral camp: if all defenders dead, whoever is nearby captures it
        if (defenders.length === 0) {
          const nearby = this.units.filter(u => !u.dead && u.team !== 0 && pdist(u, camp) <= CAMP_RANGE);
          const teams = new Set(nearby.map(u => u.team));
          if (teams.size === 1) {
            const winner = [...teams][0] as 1 | 2;
            camp.owner = winner;
            camp.spawnTimer = 0;
            this.showFeedback(
              `${winner === 1 ? 'You' : 'Enemy'} captured ${camp.name}!`,
              winner === 1 ? '#45E6B0' : '#FF6B6B',
            );
          }
        }
      } else {
        // Owned camp: if enemies arrive and no allies defend, reset to neutral with fresh defenders
        const enemy = camp.owner === 1 ? 2 : 1;
        const en = this.units.filter(u => u.team === enemy && !u.dead && pdist(u, camp) <= CAMP_RANGE);
        const al = this.units.filter(u => u.team === camp.owner && !u.dead && pdist(u, camp) <= CAMP_RANGE);
        if (en.length > 0 && al.length === 0) {
          camp.owner = 0;
          camp.spawnTimer = 0;
          this.spawnCampDefenders(camp);
          this.showFeedback(`${camp.name} is contested!`, '#FFD93D');
        }
      }
    }
  }

  // ─── SWEEP AUTO-CHAIN ──────────────────────────────────────

  private updateSweeps() {
    for (const key of Object.keys(this.activeSweeps)) {
      const sweep = this.activeSweeps[key];
      const currentTarget = sweep.targets[sweep.currentIdx];
      if (!currentTarget) { delete this.activeSweeps[key]; continue; }

      const camp = this.camps.find(c => c.id === currentTarget.id);
      if (!camp) { delete this.activeSweeps[key]; continue; }

      // Check if current target camp is captured by our team
      if (camp.owner === sweep.team) {
        // Advance past any already-captured camps
        sweep.currentIdx++;
        while (sweep.currentIdx < sweep.targets.length) {
          const nextId = sweep.targets[sweep.currentIdx].id;
          const nextCamp = this.camps.find(c => c.id === nextId);
          if (nextCamp && nextCamp.owner !== sweep.team) break; // found uncaptured
          sweep.currentIdx++;
        }

        if (sweep.currentIdx >= sweep.targets.length) {
          this.showFeedback('Sweep complete! All targets captured.', '#45E6B0');
          delete this.activeSweeps[key];
          continue;
        }

        const next = sweep.targets[sweep.currentIdx];
        const sel = this.units.filter(u => u.team === sweep.team && !u.dead && (sweep.subject === 'all' || u.type === sweep.subject));
        if (sel.length > 0) {
          this.sendUnitsTo(sel, next.x, next.y, true);
          const nextName = this.camps.find(c => c.id === next.id)?.name || 'next camp';
          this.showFeedback(`Sweeping to ${nextName}...`, '#45E6B0');
        } else {
          delete this.activeSweeps[key];
        }
      }
    }
  }

  // ─── AI ──────────────────────────────────────────────────────

  private updateAI(delta: number) {
    this.aiTimer += delta;
    if (this.aiTimer < AI_TICK_MS) return;
    this.aiTimer -= AI_TICK_MS;

    // AI resource management: assign some idle units to gather
    const aiUnits = this.units.filter(u => u.team === 2 && !u.dead);
    const gatherers = aiUnits.filter(u => u.loop);
    const nonGatherers = aiUnits.filter(u => !u.loop);

    // Keep ~30% of units gathering if we have few resources
    const stock = this.baseStockpile[2];
    const needGatherers = (stock.carrot < 5 || stock.meat < 3) && gatherers.length < Math.ceil(aiUnits.length * 0.3);
    if (needGatherers) {
      const idle = nonGatherers.filter(u => !u.carrying && pdist(u, { x: u.targetX, y: u.targetY }) < 30);
      const toAssign = idle.slice(0, Math.max(1, Math.floor(idle.length * 0.3)));
      const resType: ResourceType = stock.carrot < 3 ? 'carrot' : 'meat';
      let deliverTo = 'base';
      if (resType === 'meat') {
        const mc = this.camps.filter(c => c.owner === 2 && SPAWN_COSTS[c.animalType]?.type === 'meat')
          .sort((a, b) => pdist(a, P2_BASE) - pdist(b, P2_BASE));
        if (mc.length > 0) deliverTo = mc[0].id;
      }
      for (const u of toAssign) {
        u.loop = { action: 'gather', resourceType: resType, deliverTo, phase: 'seeking' };
      }
    }

    const idle = nonGatherers.filter(u => pdist(u, { x: u.targetX, y: u.targetY }) < 20);
    if (idle.length === 0) return;

    // Find best target camp
    const uncaptured = this.camps
      .filter(c => c.owner !== 2)
      .sort((a, b) => a.tier - b.tier || pdist(a, P2_BASE) - pdist(b, P2_BASE));

    const power = idle.reduce((s, u) => s + u.attack * u.hp, 0);
    let target: { x: number; y: number } | null = null;

    for (const c of uncaptured) {
      if (c.owner === 0) {
        const defenders = this.units.filter(u => u.campId === c.id && u.team === 0 && !u.dead);
        const gp = defenders.reduce((s, u) => s + u.attack * u.hp, 0);
        if (power > gp * 1.5) { target = c; break; }
      } else {
        target = c; break;
      }
    }

    if (!target && idle.length > 20) {
      target = this.nexuses.find(n => n.team === 1)!;
    }

    if (target) this.sendUnitsTo(idle, target.x, target.y);

    // Defend nexus
    const nex = this.nexuses.find(n => n.team === 2)!;
    const threats = this.units.filter(u => u.team === 1 && !u.dead && pdist(u, nex) < 300);
    if (threats.length > 0) {
      const defs = nonGatherers.filter(u => pdist(u, nex) < 600);
      if (defs.length > 0) {
        for (const u of defs) { u.loop = null; } // Cancel gather for defense
        this.sendUnitsTo(defs, nex.x, nex.y);
      }
    }
  }

  // ─── UNIT SPRITES ───────────────────────────────────────────

  private updateUnitSprites() {
    // Group units for formation offsets
    const groups = new Map<string, HUnit[]>();
    for (const u of this.units) {
      if (u.dead) continue;
      const k = `${u.type}_${u.team}`;
      if (!groups.has(k)) groups.set(k, []);
      groups.get(k)!.push(u);
    }

    for (const u of this.units) {
      if (u.dead) {
        if (u.sprite) { u.sprite.destroy(); u.sprite = null; }
        continue;
      }
      if (!u.sprite) {
        const def = ANIMALS[u.type];
        // Distinct team colors: gold for elite, amber for neutral, blue/red for players
        const strokeColor = u.isElite ? '#FFD700' : u.team === 0 ? '#DD8800' : u.team === 1 ? '#3388FF' : '#FF3333';
        const thickness = u.isElite ? 6 : u.team === 2 ? 5 : u.team === 0 ? 4 : 3;
        const fontSize = u.isElite ? '28px' : '22px';
        u.sprite = this.add.text(0, 0, u.isElite ? '👑' : def.emoji, {
          fontSize, stroke: strokeColor, strokeThickness: thickness,
        }).setOrigin(0.5).setDepth(20);
      }

      // Sunflower spiral formation offset based on stable unit ID
      // Tighter for horde units (bunnies), wider for big animals
      const tier = ANIMALS[u.type]?.tier || 1;
      const tierSpacing = tier <= 1 ? 8 : tier <= 2 ? 12 : tier >= 4 ? 14 : 10;
      const maxSpread = tier <= 1 ? 35 : tier <= 2 ? 50 : tier >= 4 ? 50 : 40;
      const a = u.id * GOLDEN_ANGLE;
      const grp = groups.get(`${u.type}_${u.team}`) || [u];
      const idx = grp.indexOf(u);
      const r = Math.min(Math.sqrt(idx) * tierSpacing, maxSpread);
      const dispX = u.x + Math.cos(a) * r + (u.lungeX || 0);
      const dispY = u.y + Math.sin(a) * r + (u.lungeY || 0);
      // Smooth sprite position to avoid jitter
      const prev = u.sprite;
      const lerpFactor = 0.3;
      const sx = prev.x + (dispX - prev.x) * lerpFactor;
      const sy = prev.y + (dispY - prev.y) * lerpFactor;
      u.sprite.setPosition(sx, sy);

      // Carry sprite — small resource icon above unit
      if (u.carrying) {
        if (!u.carrySprite) {
          u.carrySprite = this.add.text(0, 0, RESOURCE_EMOJI[u.carrying], {
            fontSize: '10px',
          }).setOrigin(0.5).setDepth(25);
        }
        u.carrySprite.setPosition(sx, sy - 16);
      } else if (u.carrySprite) {
        u.carrySprite.destroy(); u.carrySprite = null;
      }
    }
  }

  private updateCampVisuals() {
    for (const c of this.camps) {
      const color = c.owner === 0 ? 0xFFD93D : TEAM_COLORS[c.owner as 1 | 2];
      c.area?.setFillStyle(color, 0.08);
      c.area?.setStrokeStyle(2, color, 0.3);

      const defenders = this.units.filter(u => u.campId === c.id && u.team === 0 && !u.dead);
      const g = c.captureBar;
      if (g) {
        g.clear();
        if (c.owner === 0 && c.guardCount > 0) {
          // Show capture progress bar: how much HP remains
          const totalMaxHp = c.guardCount * (ANIMALS[c.animalType]?.hp ?? 25) * 1.5;
          const currentHp = defenders.reduce((s, u) => s + Math.max(0, u.hp), 0);
          const pct = Math.max(0, currentHp / totalMaxHp);
          const w = 90, h = 7;
          const bx = c.x - w / 2, by = c.y + 25;
          g.fillStyle(0x000000, 0.6);
          g.fillRoundedRect(bx, by, w, h, 3);
          const barColor = pct > 0.5 ? 0xFFD93D : pct > 0.25 ? 0xFF9F43 : 0xFF5555;
          g.fillStyle(barColor, 0.9);
          g.fillRoundedRect(bx, by, w * pct, h, 3);
        }
      }

      // Label — scale inversely with zoom so text stays readable at any zoom level
      if (c.label) {
        const zoom = this.cameras.main.zoom;
        const baseScale = 1.0 / zoom; // counter the zoom
        const minScale = 0.8;  // don't get too tiny when zoomed in a lot
        const scale = Math.max(minScale, baseScale);
        c.label.setScale(scale);

        if (c.owner === 0 && defenders.length > 0) {
          c.label.setText(`${c.name} (${defenders.length}/${c.guardCount})`);
          c.label.setColor('#FFD93D');
        } else {
          const tag = c.owner === 0 ? ' (cleared!)' : c.owner === 1 ? ' [YOU]' : ' [ENEMY]';
          // Show food progress for owned camps
          let foodTag = '';
          if (c.owner !== 0) {
            const cost = SPAWN_COSTS[c.animalType];
            if (cost && c.storedFood > 0) {
              foodTag = ` ${RESOURCE_EMOJI[cost.type]}${c.storedFood}/${cost.amount}`;
            }
          }
          c.label.setText(c.name + tag + foodTag);
          c.label.setColor(c.owner === 0 ? '#45E6B0' : c.owner === 1 ? '#4499FF' : '#FF5555');
        }
      }
    }
  }

  // ─── CLEANUP / WIN ──────────────────────────────────────────

  private cleanupDead() {
    this.units = this.units.filter(u => {
      if (u.dead) {
        if (u.sprite) { u.sprite.destroy(); u.sprite = null; }
        if (u.carrySprite) { u.carrySprite.destroy(); u.carrySprite = null; }
      }
      return !u.dead;
    });
  }

  // ─── RESOURCE ECONOMY: GROUND ITEMS ──────────────────────────

  private spawnGroundItem(type: ResourceType, x: number, y: number) {
    if (this.groundItems.filter(i => !i.dead).length >= MAX_GROUND_ITEMS) return;
    this.groundItems.push({
      id: this.nextItemId++, type,
      x: Math.max(20, Math.min(WORLD_W - 20, x)),
      y: Math.max(20, Math.min(WORLD_H - 20, y)),
      sprite: null, dead: false, age: 0,
    });
  }

  private updateCarrotSpawning(delta: number) {
    this.carrotSpawnTimer += delta;
    if (this.carrotSpawnTimer < CARROT_SPAWN_MS) return;
    this.carrotSpawnTimer -= CARROT_SPAWN_MS;
    // Spawn carrots near both bases
    for (const base of [P1_BASE, P2_BASE]) {
      const angle = Math.random() * Math.PI * 2;
      const dist = 80 + Math.random() * 350;
      this.spawnGroundItem('carrot', base.x + Math.cos(angle) * dist, base.y + Math.sin(angle) * dist);
    }
  }

  private updateGroundItems(delta: number) {
    for (const item of this.groundItems) {
      if (item.dead) continue;
      item.age += delta;
      if (item.age >= ITEM_DESPAWN_MS) { item.dead = true; continue; }
      if (!item.sprite) {
        item.sprite = this.add.text(item.x, item.y, RESOURCE_EMOJI[item.type], {
          fontSize: '16px',
        }).setOrigin(0.5).setDepth(15);
        // Gentle bob animation
        this.tweens.add({ targets: item.sprite, y: item.y - 5, duration: 1200, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });
      }
      // Fade near end of life
      const remaining = ITEM_DESPAWN_MS - item.age;
      if (remaining < 10000 && item.sprite) item.sprite.setAlpha(remaining / 10000);
    }
    this.groundItems = this.groundItems.filter(i => {
      if (i.dead && i.sprite) { i.sprite.destroy(); i.sprite = null; }
      return !i.dead;
    });
  }

  // ─── RESOURCE ECONOMY: PICKUP & DELIVERY ─────────────────────

  private updateResourcePickup() {
    for (const u of this.units) {
      if (u.dead || u.carrying || u.team === 0) continue;
      for (const item of this.groundItems) {
        if (item.dead) continue;
        if (pdist(u, item) < PICKUP_RANGE) {
          u.carrying = item.type;
          item.dead = true;
          if (item.sprite) { item.sprite.destroy(); item.sprite = null; }
          if (u.loop) u.loop.phase = 'delivering';
          break;
        }
      }
    }
  }

  private updateDeliveries() {
    for (const u of this.units) {
      if (u.dead || !u.carrying || u.team === 0) continue;
      const team = u.team as 1 | 2;
      const base = team === 1 ? P1_BASE : P2_BASE;

      // Deliver to own base
      if (pdist(u, base) < PICKUP_RANGE + 25) {
        this.baseStockpile[team][u.carrying] += 1;
        this.clearCarrying(u);
        continue;
      }

      // Deliver to owned camp that needs this resource type
      for (const camp of this.camps) {
        if (camp.owner !== team) continue;
        if (pdist(u, camp) < PICKUP_RANGE + 25) {
          const cost = SPAWN_COSTS[camp.animalType];
          if (cost && cost.type === u.carrying) {
            camp.storedFood += 1;
            this.clearCarrying(u);
          } else {
            // Wrong type for this camp — deliver to base stockpile instead by proximity later
          }
          break;
        }
      }
    }
  }

  private clearCarrying(u: HUnit) {
    u.carrying = null;
    if (u.carrySprite) { u.carrySprite.destroy(); u.carrySprite = null; }
    if (u.loop) u.loop.phase = 'seeking';
  }

  // ─── RESOURCE ECONOMY: GATHER LOOPS ──────────────────────────

  private updateGatherLoops() {
    // Auto-assign idle player units to gather loops (always looping)
    for (const u of this.units) {
      if (u.dead || u.team === 0 || u.loop) continue;
      // If unit is idle (near its target, not carrying)
      const atTarget = pdist(u, { x: u.targetX, y: u.targetY }) < 25;
      if (!atTarget && !u.carrying) continue;
      // Don't auto-gather if enemies are nearby (unit is in combat)
      const hasNearbyEnemy = this.units.some(e => !e.dead && e.team !== u.team && e.team !== 0 && pdist(u, e) < COMBAT_RANGE + 50);
      if (hasNearbyEnemy) continue;
      // Don't auto-gather if near enemy nexus (attacking)
      const enemyNex = this.nexuses.find(n => n.team !== u.team);
      if (enemyNex && pdist(u, enemyNex) < COMBAT_RANGE + 80) continue;
      // Default gather: T1 gathers carrots, T2+ gathers meat
      const tier = ANIMALS[u.type]?.tier || 1;
      const resType: ResourceType = tier <= 1 ? 'carrot' : 'meat';
      let deliverTo = 'base';
      if (resType === 'meat') {
        const base = u.team === 1 ? P1_BASE : P2_BASE;
        const mc = this.camps.filter(c => c.owner === u.team && SPAWN_COSTS[c.animalType]?.type === 'meat')
          .sort((a, b) => pdist(a, base) - pdist(b, base));
        if (mc.length > 0) deliverTo = mc[0].id;
      }
      u.loop = { action: 'gather', resourceType: resType, deliverTo, phase: u.carrying ? 'delivering' : 'seeking' };
    }

    // Track which ground items are already targeted so each unit picks a unique one
    const claimedItems = new Set<number>();

    for (const u of this.units) {
      if (u.dead || !u.loop || u.team === 0) continue;
      const team = u.team as 1 | 2;
      const base = team === 1 ? P1_BASE : P2_BASE;

      if (u.loop.phase === 'seeking' && !u.carrying) {
        // Find nearest UNCLAIMED matching ground item unique to this unit
        let best: HGroundItem | null = null, bestD = Infinity;
        for (const item of this.groundItems) {
          if (item.dead || item.type !== u.loop.resourceType) continue;
          if (claimedItems.has(item.id)) continue; // skip already-claimed
          const d = pdist(u, item);
          if (d < bestD) { bestD = d; best = item; }
        }
        if (best) {
          claimedItems.add(best.id); // claim it
          u.targetX = best.x; u.targetY = best.y;
        } else {
          // No unclaimed items — wait near base
          if (pdist(u, base) > 200) { u.targetX = base.x; u.targetY = base.y; }
        }
      } else if (u.loop.phase === 'delivering' && u.carrying) {
        // Head to delivery target
        if (u.loop.deliverTo === 'base') {
          u.targetX = base.x; u.targetY = base.y;
        } else {
          const camp = this.camps.find(c => c.id === u.loop!.deliverTo);
          if (camp && camp.owner === team) {
            u.targetX = camp.x; u.targetY = camp.y;
          } else {
            u.targetX = base.x; u.targetY = base.y;
          }
        }
      }
    }
  }

  // ─── RESOURCE ECONOMY: WILD ANIMALS ──────────────────────────

  /** Spawn position on the outskirts — edges and corners of the map, away from bases */
  private randomOutskirtsPos(): { x: number; y: number } {
    const MARGIN = 150;
    const EDGE_BAND = 500; // how deep into the map "outskirts" extends
    let x: number, y: number;
    for (let attempt = 0; attempt < 50; attempt++) {
      // Pick a random edge (top, bottom, left, right)
      const edge = Math.floor(Math.random() * 4);
      if (edge === 0) { // top
        x = MARGIN + Math.random() * (WORLD_W - MARGIN * 2);
        y = MARGIN + Math.random() * EDGE_BAND;
      } else if (edge === 1) { // bottom
        x = MARGIN + Math.random() * (WORLD_W - MARGIN * 2);
        y = WORLD_H - MARGIN - Math.random() * EDGE_BAND;
      } else if (edge === 2) { // left
        x = MARGIN + Math.random() * EDGE_BAND;
        y = MARGIN + Math.random() * (WORLD_H - MARGIN * 2);
      } else { // right
        x = WORLD_W - MARGIN - Math.random() * EDGE_BAND;
        y = MARGIN + Math.random() * (WORLD_H - MARGIN * 2);
      }
      if (pdist({ x, y }, P1_BASE) > 500 && pdist({ x, y }, P2_BASE) > 500) return { x, y };
    }
    return { x: WORLD_W / 2, y: MARGIN + 100 }; // fallback
  }

  private spawnWildAnimals() {
    const wildTypes = ['bunny', 'turtle', 'wolf', 'scorpion', 'hawk'];
    for (let i = 0; i < WILD_ANIMAL_COUNT; i++) {
      const type = wildTypes[Math.floor(Math.random() * wildTypes.length)];
      const def = ANIMALS[type];
      const pos = this.randomOutskirtsPos();
      const { x, y } = pos;
      this.units.push({
        id: this.nextId++, type, team: 0,
        hp: def.hp, maxHp: def.hp, attack: def.attack, speed: def.speed * 0.4,
        x, y, targetX: x + Math.random() * 100 - 50, targetY: y + Math.random() * 100 - 50,
        attackTimer: 0, sprite: null, dead: false,
        campId: null, lungeX: 0, lungeY: 0,
        hasRebirth: false, diveReady: false, diveTimer: 0,
        carrying: null, carrySprite: null, loop: null, isElite: false,
      });
    }
    // Elite golden prey — very strong, drops crystals
    for (let i = 0; i < ELITE_PREY_COUNT; i++) {
      let x: number, y: number;
      do {
        x = WORLD_W * 0.2 + Math.random() * (WORLD_W * 0.6);
        y = WORLD_H * 0.2 + Math.random() * (WORLD_H * 0.6);
      } while (pdist({ x, y }, P1_BASE) < 600 || pdist({ x, y }, P2_BASE) < 600);
      this.units.push({
        id: this.nextId++, type: 'lion', team: 0,
        hp: 2000, maxHp: 2000, attack: 150, speed: 90,
        x, y, targetX: x + Math.random() * 80 - 40, targetY: y + Math.random() * 80 - 40,
        attackTimer: 0, sprite: null, dead: false,
        campId: null, lungeX: 0, lungeY: 0,
        hasRebirth: false, diveReady: false, diveTimer: 0,
        carrying: null, carrySprite: null, loop: null, isElite: true,
      });
    }
  }

  private updateWildAnimals(delta: number) {
    this.wildRespawnTimer += delta;
    if (this.wildRespawnTimer >= WILD_RESPAWN_MS) {
      this.wildRespawnTimer -= WILD_RESPAWN_MS;
      const wilds = this.units.filter(u => u.team === 0 && !u.campId && !u.dead && !u.isElite);
      const elites = this.units.filter(u => u.team === 0 && !u.campId && !u.dead && u.isElite);
      if (wilds.length < WILD_ANIMAL_COUNT) {
        const wt = ['bunny', 'turtle', 'wolf', 'scorpion', 'hawk'];
        const type = wt[Math.floor(Math.random() * wt.length)];
        const def = ANIMALS[type];
        const pos = this.randomOutskirtsPos();
        const { x, y } = pos;
        this.units.push({
          id: this.nextId++, type, team: 0,
          hp: def.hp, maxHp: def.hp, attack: def.attack, speed: def.speed * 0.4,
          x, y, targetX: x + Math.random() * 80 - 40, targetY: y + Math.random() * 80 - 40,
          attackTimer: 0, sprite: null, dead: false,
          campId: null, lungeX: 0, lungeY: 0,
          hasRebirth: false, diveReady: false, diveTimer: 0,
          carrying: null, carrySprite: null, loop: null, isElite: false,
        });
      }
      if (elites.length < ELITE_PREY_COUNT) {
        let x: number, y: number;
        do { x = WORLD_W * 0.2 + Math.random() * (WORLD_W * 0.6); y = WORLD_H * 0.2 + Math.random() * (WORLD_H * 0.6);
        } while (pdist({ x, y }, P1_BASE) < 600 || pdist({ x, y }, P2_BASE) < 600);
        this.units.push({
          id: this.nextId++, type: 'lion', team: 0,
          hp: 2000, maxHp: 2000, attack: 150, speed: 90,
          x, y, targetX: x + Math.random() * 80 - 40, targetY: y + Math.random() * 80 - 40,
          attackTimer: 0, sprite: null, dead: false,
          campId: null, lungeX: 0, lungeY: 0,
          hasRebirth: false, diveReady: false, diveTimer: 0,
          carrying: null, carrySprite: null, loop: null, isElite: true,
        });
      }
    }
    // Wander wild animals — stay on outskirts, don't drift to center
    const cx = WORLD_W / 2, cy = WORLD_H / 2;
    for (const u of this.units) {
      if (u.team !== 0 || u.campId || u.dead) continue;
      if (pdist(u, { x: u.targetX, y: u.targetY }) < 15) {
        // If too close to center, push back toward nearest edge
        const distToCenter = pdist(u, { x: cx, y: cy });
        if (distToCenter < 800) {
          // Move away from center toward nearest edge
          const awayX = u.x - cx, awayY = u.y - cy;
          const awayD = Math.sqrt(awayX * awayX + awayY * awayY) || 1;
          const pushR = 300 + Math.random() * 300;
          u.targetX = Math.max(100, Math.min(WORLD_W - 100, u.x + (awayX / awayD) * pushR));
          u.targetY = Math.max(100, Math.min(WORLD_H - 100, u.y + (awayY / awayD) * pushR));
        } else {
          // Normal wander along the edges
          const a = Math.random() * Math.PI * 2;
          const r = 80 + Math.random() * 150;
          let nx = u.x + Math.cos(a) * r;
          let ny = u.y + Math.sin(a) * r;
          // Clamp to world and keep away from center
          nx = Math.max(100, Math.min(WORLD_W - 100, nx));
          ny = Math.max(100, Math.min(WORLD_H - 100, ny));
          if (pdist({ x: nx, y: ny }, { x: cx, y: cy }) < 700) {
            // Re-roll toward outskirts
            const pos = this.randomOutskirtsPos();
            nx = pos.x; ny = pos.y;
          }
          u.targetX = nx; u.targetY = ny;
        }
      }
    }
  }

  private checkWin() {
    for (const n of this.nexuses) {
      if (n.hp <= 0) {
        this.gameOver = true;
        this.winner = n.team === 1 ? 2 : 1;
        this.showGameOver();
        return;
      }
    }
  }

  private showGameOver() {
    const cam = this.cameras.main;
    const win = this.winner === this.myTeam;
    this.add.rectangle(cam.width / 2, cam.height / 2, cam.width, cam.height, 0x000000, 0.7)
      .setScrollFactor(0).setDepth(200);
    const t = this.add.text(cam.width / 2, cam.height / 2 - 40, win ? 'VICTORY!' : 'DEFEAT', {
      fontSize: '52px', color: win ? '#45E6B0' : '#FF6B6B',
      fontFamily: '"Fredoka", sans-serif', fontStyle: 'bold',
    }).setOrigin(0.5).setScrollFactor(0).setDepth(201);
    const s = Math.floor(this.gameTime / 1000);
    this.add.text(cam.width / 2, cam.height / 2 + 20,
      `Time: ${Math.floor(s / 60)}:${(s % 60).toString().padStart(2, '0')}`, {
        fontSize: '18px', color: '#cbb8ee', fontFamily: '"Nunito", sans-serif', fontStyle: 'bold',
      }).setOrigin(0.5).setScrollFactor(0).setDepth(201);
    const btn = this.add.text(cam.width / 2, cam.height / 2 + 70, 'BACK TO MENU', {
      fontSize: '20px', color: '#45E6B0', fontFamily: '"Fredoka", sans-serif', fontStyle: 'bold',
      backgroundColor: '#0d1a0d', padding: { x: 20, y: 10 },
    }).setOrigin(0.5).setScrollFactor(0).setDepth(201).setInteractive({ useHandCursor: true });
    btn.on('pointerdown', () => { this.cleanupHTML(); this.scene.start('MenuScene'); });
    btn.on('pointerover', () => btn.setColor('#FFD93D'));
    btn.on('pointerout', () => btn.setColor('#45E6B0'));
    this.tweens.add({ targets: t, scaleX: { from: 0.5, to: 1 }, scaleY: { from: 0.5, to: 1 }, duration: 600, ease: 'Back.easeOut' });
  }

  // ─── UNIT MANAGEMENT ────────────────────────────────────────

  private spawnUnit(type: string, team: 1 | 2, x: number, y: number) {
    const def = ANIMALS[type];
    if (!def) return;
    const maxHp = Math.round(def.hp * (1 + this.getBuffs(team).hp));

    // New spawns go to the rally point for this type+team (set by last command)
    let targetX = x, targetY = y;
    const rally = this.rallyPoints[`${type}_${team}`];
    if (rally) {
      const a = this.nextId * GOLDEN_ANGLE;
      const r = Math.sqrt(this.units.filter(u => u.type === type && u.team === team && !u.dead).length) * 18;
      targetX = rally.x + Math.cos(a) * r;
      targetY = rally.y + Math.sin(a) * r;
    }

    // Tighter speed variance so horde units stay together as a mob
    const speedVariance = 0.93 + Math.random() * 0.14;
    this.units.push({
      id: this.nextId++, type, team,
      hp: maxHp, maxHp, attack: def.attack, speed: def.speed * speedVariance,
      x, y, targetX, targetY,
      attackTimer: 0, sprite: null, dead: false,
      campId: null, lungeX: 0, lungeY: 0,
      hasRebirth: type === 'phoenix',
      diveReady: type === 'hawk',
      diveTimer: 0,
      carrying: null, carrySprite: null, loop: null, isElite: false,
    });
  }

  private sendUnitsTo(units: HUnit[], tx: number, ty: number, setRally = false) {
    // Save rally point per type+team so new spawns also go here
    if (setRally) {
      const types = new Set(units.map(u => u.type));
      const teams = new Set(units.map(u => u.team));
      for (const type of types) {
        for (const team of teams) {
          if (team === 0) continue;
          this.rallyPoints[`${type}_${team}`] = { x: tx, y: ty };
        }
      }
      // If "all" was sent, set rally for every type this team has
      if (types.size > 1) {
        const team = [...teams].find(t => t !== 0);
        if (team != null) {
          for (const type of Object.keys(ANIMALS)) {
            this.rallyPoints[`${type}_${team}`] = { x: tx, y: ty };
          }
        }
      }
    }

    for (let i = 0; i < units.length; i++) {
      const a = i * GOLDEN_ANGLE;
      // Tighter spiral for low-tier horde units, wider for big units
      const tier = ANIMALS[units[i].type]?.tier || 1;
      const spacing = tier <= 1 ? 10 : tier <= 2 ? 14 : 18;
      const r = Math.sqrt(i) * spacing;
      units[i].targetX = tx + Math.cos(a) * r;
      units[i].targetY = ty + Math.sin(a) * r;
    }
  }

  // ─── MULTIPLAYER SYNC ──────────────────────────────────────

  /** Called when the local player issues a voice/text command */
  private issueCommand(text: string) {
    if (this.isOnline && !this.isHost) {
      // Guest: send command to host via Firebase
      this.showFeedback('Sending command...', '#FFD93D');
      if (this.firebase && this.gameId) {
        this.firebase.sendRemoteOrders(this.gameId, this.playerId || '', [
          { heroId: '', order: { text, team: this.myTeam, selectedArmy: this.selectedArmy } as any },
        ]);
      }
      return;
    }
    // Host or solo: execute locally
    this.handleCommand(text, this.myTeam);
  }

  /** Host pushes full game state to Firebase for guest to render */
  private pushHostSync() {
    if (!this.firebase || !this.gameId) return;
    const syncUnits: HordeSyncUnit[] = this.units.filter(u => !u.dead).map(u => ({
      id: u.id, type: u.type, team: u.team,
      hp: u.hp, maxHp: u.maxHp, attack: u.attack, speed: u.speed,
      x: u.x, y: u.y, targetX: u.targetX, targetY: u.targetY,
      dead: false, campId: u.campId,
    }));
    const syncCamps = this.camps.map(c => ({
      id: c.id, owner: c.owner, spawnTimer: c.spawnTimer,
    }));
    const syncNexuses = this.nexuses.map(n => ({
      team: n.team, hp: n.hp,
    }));
    const state: HordeSyncState = {
      units: syncUnits,
      camps: syncCamps,
      nexuses: syncNexuses,
      rallyPoints: this.rallyPoints,
      baseSpawnTimers: this.baseSpawnTimers,
      nextId: this.nextId,
      gameTime: this.gameTime,
      gameOver: this.gameOver,
      winner: this.winner,
    };
    this.firebase.pushSyncState(this.gameId, state as any);
  }

  /** Guest applies state snapshot from host */
  private applyGuestSync(state: HordeSyncState) {
    if (!state) return;

    // Firebase RTDB converts arrays to objects with numeric keys — normalize
    const toArray = <T>(val: T[] | Record<string, T> | undefined): T[] => {
      if (!val) return [];
      if (Array.isArray(val)) return val;
      return Object.values(val);
    };

    const syncUnits = toArray(state.units);
    const syncCamps = toArray(state.camps);
    const syncNexuses = toArray(state.nexuses);

    this.gameTime = state.gameTime || 0;
    this.nextId = state.nextId || 0;
    this.rallyPoints = state.rallyPoints || {};
    this.baseSpawnTimers = state.baseSpawnTimers || { 1: 0, 2: 0 };

    // Sync nexuses
    for (const sn of syncNexuses) {
      const n = this.nexuses.find(nx => nx.team === sn.team);
      if (n) n.hp = sn.hp;
    }

    // Sync camps
    for (const sc of syncCamps) {
      const c = this.camps.find(cx => cx.id === sc.id);
      if (c) {
        c.owner = sc.owner as 0 | 1 | 2;
        c.spawnTimer = sc.spawnTimer;
      }
    }

    // Sync units: reconcile existing with incoming
    const liveUnits = syncUnits.filter(u => !u.dead);
    const incomingIds = new Set(liveUnits.map(u => u.id));

    // Remove units that no longer exist
    for (const u of this.units) {
      if (!incomingIds.has(u.id)) {
        u.dead = true;
        if (u.sprite) { u.sprite.destroy(); u.sprite = null; }
      }
    }
    this.units = this.units.filter(u => !u.dead);

    // Update or create units
    const existingMap = new Map(this.units.map(u => [u.id, u]));
    for (const su of liveUnits) {
      const existing = existingMap.get(su.id);
      if (existing) {
        // Update in place — lerp position for smoothness
        existing.hp = su.hp;
        existing.maxHp = su.maxHp;
        existing.targetX = su.targetX;
        existing.targetY = su.targetY;
        existing.team = su.team as 0 | 1 | 2;
        existing.type = su.type;
        // Lerp actual position toward synced position
        existing.x += (su.x - existing.x) * 0.3;
        existing.y += (su.y - existing.y) * 0.3;
      } else {
        // New unit from host
        this.units.push({
          id: su.id, type: su.type, team: su.team as 0 | 1 | 2,
          hp: su.hp, maxHp: su.maxHp, attack: su.attack, speed: su.speed,
          x: su.x, y: su.y, targetX: su.targetX, targetY: su.targetY,
          attackTimer: 0, sprite: null, dead: false,
          campId: su.campId, lungeX: 0, lungeY: 0,
          hasRebirth: su.type === 'phoenix',
          diveReady: su.type === 'hawk',
          diveTimer: 0,
          carrying: null, carrySprite: null, loop: null, isElite: false,
        });
      }
    }

    // Check game over (only trigger once)
    if (state.gameOver && !this.gameOver) {
      this.gameOver = true;
      this.winner = state.winner as 1 | 2 | null;
      this.showGameOver();
    }
  }

  // ─── COMMAND PARSING ─────────────────────────────────────────

  private async handleCommand(text: string, team: 1 | 2) {
    this.showFeedback('Processing command...', '#FFD93D');

    // Build rich context for Gemini
    const countBy: Record<string, number> = {};
    for (const u of this.units) {
      if (u.team === team && !u.dead) countBy[u.type] = (countBy[u.type] || 0) + 1;
    }
    const myUnits = Object.entries(countBy).map(([type, count]) => ({ type, count }));
    const base = team === 1 ? P1_BASE : P2_BASE;
    const campCtx = this.camps
      .map((c, i) => {
        const defenders = this.units.filter(u => u.campId === c.id && u.team === 0 && !u.dead).length;
        return {
          name: c.name, animalType: c.animalType, index: i,
          owner: c.owner === 0 ? 'NEUTRAL' : c.owner === team ? 'YOURS' : 'ENEMY',
          x: Math.round(c.x), y: Math.round(c.y),
          dist: Math.round(pdist(c, base)),
          defenders,
        };
      })
      .sort((a, b) => a.dist - b.dist); // sort by distance from player base

    const myNex = this.nexuses.find(n => n.team === team)!;
    const enemyNex = this.nexuses.find(n => n.team !== team)!;
    const nexusHp = { mine: Math.round(myNex.hp), enemy: Math.round(enemyNex.hp) };

    // Try Gemini first
    const geminiResult = await parseWithGemini(text, myUnits, campCtx, nexusHp, this.gameTime);

    if (geminiResult && geminiResult.length > 0) {
      // Only use first command — army selection is separate, one command per input
      if (this.executeGeminiCommand(geminiResult[0], team)) return;
    }

    // Fallback to local regex parsing
    this.executeLocalCommand(text, team);
  }

  private executeGeminiCommand(cmd: HordeCommand, team: 1 | 2): boolean {
    const subject = this.selectedArmy; // army is selected via Q/E keys, not parsed from voice
    const base = team === 1 ? P1_BASE : P2_BASE;
    let tx = 0, ty = 0, found = false;

    if (cmd.targetType === 'nexus') {
      const n = this.nexuses.find(n2 => n2.team !== team)!;
      tx = n.x; ty = n.y; found = true;

    } else if (cmd.targetType === 'base' || cmd.targetType === 'defend' || cmd.targetType === 'retreat') {
      tx = base.x; ty = base.y; found = true;

    } else if (cmd.targetType === 'camp') {
      // Specific camp by index
      if (cmd.campIndex != null && cmd.campIndex >= 0 && cmd.campIndex < this.camps.length) {
        const c = this.camps[cmd.campIndex];
        tx = c.x; ty = c.y; found = true;
      }
      // By animal type — nearest not owned by me
      if (!found && cmd.targetAnimal) {
        const cs = this.camps.filter(c => c.animalType === cmd.targetAnimal && c.owner !== team)
          .sort((a, b) => pdist(a, base) - pdist(b, base));
        if (cs.length > 0) { tx = cs[0].x; ty = cs[0].y; found = true; }
      }

    } else if (cmd.targetType === 'nearest_camp') {
      // Find camp matching filters, sorted by qualifier
      let candidates = this.camps.slice();

      // Filter by animal type if specified
      if (cmd.targetAnimal) candidates = candidates.filter(c => c.animalType === cmd.targetAnimal);

      // Filter by qualifier
      const q = cmd.qualifier || 'nearest';
      if (q === 'uncaptured') candidates = candidates.filter(c => c.owner !== team);
      else if (q === 'enemy') candidates = candidates.filter(c => c.owner !== 0 && c.owner !== team);
      else candidates = candidates.filter(c => c.owner !== team); // default: not mine

      if (candidates.length === 0) {
        // If no uncaptured, try any camp of that type
        if (cmd.targetAnimal) candidates = this.camps.filter(c => c.animalType === cmd.targetAnimal);
        else candidates = this.camps.slice();
      }

      // Sort by qualifier
      if (q === 'nearest' || q === 'uncaptured' || q === 'enemy') {
        candidates.sort((a, b) => pdist(a, base) - pdist(b, base));
      } else if (q === 'furthest') {
        candidates.sort((a, b) => pdist(b, base) - pdist(a, base));
      } else if (q === 'weakest') {
        candidates.sort((a, b) => {
          const da = this.units.filter(u => u.campId === a.id && u.team === 0 && !u.dead).length;
          const db = this.units.filter(u => u.campId === b.id && u.team === 0 && !u.dead).length;
          return da - db;
        });
      }

      if (candidates.length > 0) { tx = candidates[0].x; ty = candidates[0].y; found = true; }

    } else if (cmd.targetType === 'sweep_camps') {
      // Chain-capture: find all matching uncaptured camps, sorted nearest-first
      let targets = this.camps.filter(c => c.owner !== team);
      if (cmd.targetAnimal) targets = targets.filter(c => c.animalType === cmd.targetAnimal);
      targets.sort((a, b) => pdist(a, base) - pdist(b, base));

      if (targets.length > 0) {
        // Send to first target, set up auto-chain via rally
        tx = targets[0].x; ty = targets[0].y; found = true;

        // Store the sweep queue so units auto-advance
        const sel = this.units.filter(u => u.team === team && !u.dead && (subject === 'all' || u.type === subject));
        if (sel.length > 0) {
          this.sendUnitsTo(sel, tx, ty, true);
          // Store sweep targets for auto-chaining in update loop
          const key = `sweep_${subject}_${team}`;
          this.activeSweeps[key] = {
            team, subject, targets: targets.map(c => ({ x: c.x, y: c.y, id: c.id })), currentIdx: 0,
          };
          const label = subject === 'all' ? 'All units' : `${sel.length} ${subject}(s)`;
          this.showFeedback(cmd.narration || `${label} sweeping ${cmd.targetAnimal || 'all'} camps!`, '#45E6B0');
          return true;
        }
      }

    } else if (cmd.targetType === 'gather') {
      // Set up gather loop for selected units
      const resType = cmd.gatherResource || 'carrot';
      const sel = this.units.filter(u => u.team === team && !u.dead && (subject === 'all' || u.type === subject));
      if (sel.length === 0) {
        this.showFeedback(`No ${subject} units!`, '#FF6B6B');
        return true;
      }

      // Find best delivery target for this resource
      let deliverTo = 'base';
      if (resType !== 'carrot') {
        // Find nearest owned camp that needs this resource type
        const base = team === 1 ? P1_BASE : P2_BASE;
        const matchingCamps = this.camps
          .filter(c => c.owner === team && SPAWN_COSTS[c.animalType]?.type === resType)
          .sort((a, b) => pdist(a, base) - pdist(b, base));
        if (matchingCamps.length > 0) deliverTo = matchingCamps[0].id;
      }

      for (const u of sel) {
        u.loop = { action: 'gather', resourceType: resType, deliverTo, phase: 'seeking' };
      }
      const emoji = RESOURCE_EMOJI[resType];
      this.showFeedback(cmd.narration || `${sel.length} units gathering ${emoji}!`, '#45E6B0');
      return true;

    } else if (cmd.targetType === 'position') {
      tx = WORLD_W / 2; ty = WORLD_H / 2; found = true;
    }

    if (!found) return false;

    const sel = this.units.filter(u => u.team === team && !u.dead && (subject === 'all' || u.type === subject));
    if (sel.length === 0) {
      this.showFeedback(`No ${subject} units!`, '#FF6B6B');
      return true;
    }
    // Clear gather loops — new command overrides
    for (const u of sel) { u.loop = null; }
    this.sendUnitsTo(sel, tx, ty, true);
    const label = subject === 'all' ? 'All units' : `${sel.length} ${subject}(s)`;
    const narration = cmd.narration || `${label} moving out!`;
    this.showFeedback(narration, '#45E6B0');
    return true;
  }

  private executeLocalCommand(text: string, team: 1 | 2) {
    const lo = text.toLowerCase();
    const subject = this.selectedArmy; // always use selected army
    const base = team === 1 ? P1_BASE : P2_BASE;

    // Gather commands
    if (/\b(gather|collect|farm|forage|harvest|get food|make more)\b/i.test(lo)) {
      let resType: ResourceType = 'carrot';
      if (/meat|flesh|kill/i.test(lo)) resType = 'meat';
      else if (/crystal|gem|diamond|elite/i.test(lo)) resType = 'crystal';

      const sel = this.units.filter(u => u.team === team && !u.dead && (subject === 'all' || u.type === subject));
      if (sel.length === 0) { this.showFeedback(`No ${subject} units!`, '#FF6B6B'); return; }

      let deliverTo = 'base';
      if (resType !== 'carrot') {
        const matchCamps = this.camps.filter(c => c.owner === team && SPAWN_COSTS[c.animalType]?.type === resType)
          .sort((a, b) => pdist(a, base) - pdist(b, base));
        if (matchCamps.length > 0) deliverTo = matchCamps[0].id;
      }
      for (const u of sel) { u.loop = { action: 'gather', resourceType: resType, deliverTo, phase: 'seeking' }; }
      this.showFeedback(`${sel.length} units gathering ${RESOURCE_EMOJI[resType]}!`, '#45E6B0');
      return;
    }

    let tx = 0, ty = 0, found = false;

    // Nexus / enemy base
    if (/nexus|throne|enemy\s*base/i.test(lo)) {
      const n = this.nexuses.find(n2 => n2.team !== team)!;
      tx = n.x; ty = n.y; found = true;
    }

    // Home / defend / retreat
    if (!found && /\b(base|home|retreat|defend)\b/i.test(lo)) {
      tx = base.x; ty = base.y; found = true;
    }

    // Center / middle
    if (!found && /center|middle/i.test(lo)) {
      tx = WORLD_W / 2; ty = WORLD_H / 2; found = true;
    }

    // Match camp by unique name ("bouncy", "wailing", "stinger", etc.)
    if (!found) {
      for (const c of this.camps) {
        const cleanName = c.name.replace(/^[^\w]+/, '').toLowerCase();
        const words = cleanName.split(/\s+/).filter(w => w.length > 2);
        if (words.some(w => lo.includes(w))) {
          tx = c.x; ty = c.y; found = true; break;
        }
      }
    }

    // Match camp by animal type keyword: "wolf camp" → nearest unowned wolf camp
    if (!found) {
      const animalPatterns: [RegExp, string][] = [
        [/bunn(y|ies)|rabbit/i, 'bunny'], [/turtle/i, 'turtle'],
        [/wol(f|ves)/i, 'wolf'], [/scorpion/i, 'scorpion'], [/hawk/i, 'hawk'],
        [/bear/i, 'bear'], [/croc(odile)?/i, 'crocodile'],
        [/lion/i, 'lion'], [/phoenix/i, 'phoenix'], [/dragon/i, 'dragon'],
      ];
      for (const [pat, name] of animalPatterns) {
        if (pat.test(lo)) {
          const cs = this.camps.filter(c => c.animalType === name && c.owner !== team)
            .sort((a, b) => pdist(a, base) - pdist(b, base));
          if (cs.length > 0) { tx = cs[0].x; ty = cs[0].y; found = true; break; }
        }
      }
    }

    // Fallback: nearest unowned camp
    if (!found && /nearest|closest|camp/i.test(lo)) {
      const cs = this.camps.filter(c => c.owner !== team).sort((a, b) => pdist(a, base) - pdist(b, base));
      if (cs.length > 0) { tx = cs[0].x; ty = cs[0].y; found = true; }
    }

    if (!found) {
      this.showFeedback('Try: "attack nexus", "nearest camp", or a camp name', '#FF6B6B');
      return;
    }

    const sel = this.units.filter(u => u.team === team && !u.dead && (subject === 'all' || u.type === subject));
    if (sel.length === 0) {
      this.showFeedback(`No ${subject} units!`, '#FF6B6B');
      return;
    }
    for (const u of sel) { u.loop = null; } // Clear gather loops
    this.sendUnitsTo(sel, tx, ty, true);
    const emoji = subject === 'all' ? '' : (ANIMALS[subject]?.emoji + ' ' || '');
    const label = subject === 'all' ? 'All units' : `${emoji}${sel.length} ${cap(subject)}(s)`;
    this.showFeedback(`${label} moving out!`, '#45E6B0');
  }

  private showFeedback(msg: string, color: string) {
    const t = this.hudTexts['feedback'];
    if (!t) return;
    t.setText(msg).setColor(color).setAlpha(1);
    this.tweens.add({ targets: t, alpha: 0, duration: 3000, delay: 1000 });
  }

  private updateSelectionLabel() {
    // Update Phaser hint text
    if (this.selectionLabel) {
      this.selectionLabel.setText('Q ◀ cycle ▶ E');
    }

    // Update HTML army bar
    if (!this.armyBarEl) return;
    const available = this.getAvailableArmies();

    let html = '';
    for (const army of available) {
      const isActive = army === this.selectedArmy;
      const emoji = army === 'all' ? '⚔️' : (ANIMALS[army]?.emoji || '?');
      const name = army === 'all' ? 'ALL' : cap(army).toUpperCase();
      const count = army === 'all'
        ? this.units.filter(u => u.team === this.myTeam && !u.dead).length
        : this.units.filter(u => u.team === this.myTeam && !u.dead && u.type === army).length;
      const tier = army === 'all' ? '' : `T${ANIMALS[army]?.tier || '?'}`;

      const bg = isActive ? 'rgba(69,230,176,0.25)' : 'rgba(13,26,13,0.8)';
      const border = isActive ? '#45E6B0' : '#3D5040';
      const borderW = isActive ? '3px' : '1px';
      const glow = isActive ? 'box-shadow:0 0 12px rgba(69,230,176,0.4);' : '';
      const scale = isActive ? 'transform:scale(1.1);' : '';

      html += `<div style="
        background:${bg};border:${borderW} solid ${border};border-radius:10px;
        padding:4px 10px;text-align:center;min-width:52px;
        ${glow}${scale}transition:all 0.15s ease;
      ">
        <div style="font-size:22px;line-height:1.1;">${emoji}</div>
        <div style="font-size:9px;color:${isActive ? '#45E6B0' : '#8BAA8B'};font-weight:800;letter-spacing:0.5px;">${name}</div>
        <div style="font-size:11px;color:#f0e8ff;font-weight:700;">${count}</div>
        ${tier ? `<div style="font-size:8px;color:#666;font-weight:600;">${tier}</div>` : ''}
      </div>`;
    }
    this.armyBarEl.innerHTML = html;
  }

  // ─── BUFFS ──────────────────────────────────────────────────

  private getBuffs(team: 1 | 2) {
    let speed = 0, attack = 0, hp = 0;
    for (const c of this.camps) {
      if (c.owner !== team) continue;
      const s = c.buff.stat;
      if (s === 'speed') speed += c.buff.value;
      else if (s === 'attack') attack += c.buff.value;
      else if (s === 'hp') hp += c.buff.value;
      else if (s === 'all') { speed += c.buff.value; attack += c.buff.value; hp += c.buff.value; }
    }
    return { speed, attack, hp };
  }

  // ─── CLEANUP ────────────────────────────────────────────────

  private cleanupHTML() {
    this.textInput?.remove(); this.textInput = null;
    this.voiceStatusEl?.remove(); this.voiceStatusEl = null;
    this.selectionLabel = null;
    this.armyBarEl?.remove(); this.armyBarEl = null;
    try { this.recognition?.abort(); } catch (_e) { /* */ }
    if (this.firebase) { this.firebase.cleanup(); this.firebase = null; }
  }
}
