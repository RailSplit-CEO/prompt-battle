// ═══════════════════════════════════════════════════════════════
// MAP DEFINITIONS — Static camp slots, randomized spawns
// ═══════════════════════════════════════════════════════════════
//
// Each map defines FIXED camp slot positions with tiers.
// At game start, a random animal from the tier pool is assigned
// to each slot. Mirrored blue/red slots always get the same animal.
//
// Solo mode: player picks from all 4 maps.
// Multiplayer: always uses 'default'.

export interface MapCampSlot {
  tier: 0 | 1 | 2 | 3 | 4;
  bluePos: { x: number; y: number };
  redPos: { x: number; y: number };
}

export interface MapZoneDef {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface MapMineSlot {
  bluePos: { x: number; y: number };
  redPos: { x: number; y: number };
}

export interface MapArmorySlot {
  bluePos: { x: number; y: number };
  redPos: { x: number; y: number };
  equipmentType?: EquipmentType;
}

export interface MapTowerSlot {
  bluePos: { x: number; y: number };
  redPos: { x: number; y: number };
}

export interface MapBushZone {
  blueZone: { x: number; y: number; w: number; h: number };
  redZone: { x: number; y: number; w: number; h: number };
}

export interface MapRockDef {
  bluePos: { x: number; y: number };
  redPos: { x: number; y: number };
  variant: 1 | 2 | 3;
}

export interface MapBoundaryBlock {
  x: number;
  y: number;
  w: number;
  h: number;
}

// ─── TILE GRID TYPES ──────────────────────────────────────
export const TILE_SIZE = 64;
export type TileValue = 0 | 1 | 2 | 3; // 0=normal(grass), 1=high_ground, 2=water, 3=rock(impassable)
export type EquipmentType = 'pickaxe' | 'sword' | 'shield' | 'boots' | 'banner';

export interface MapEventCircle {
  x: number;
  y: number;
  radius: number;
  id?: string;
}

export interface MapDef {
  id: string;
  name: string;
  description: string;
  worldW: number;
  worldH: number;
  p1Base: { x: number; y: number };
  p2Base: { x: number; y: number };
  safeRadius: number;              // no wild animals within this radius of bases
  campSlots: MapCampSlot[];        // static positions, animal randomized per game
  trollSlot: { x: number; y: number } | null; // center boss camp (always troll)
  carrotZones: MapZoneDef[];       // areas where carrots can spawn
  wildZones: MapZoneDef[];         // areas where roaming neutrals can spawn
  wildExclusions: { x: number; y: number; radius: number }[]; // extra no-wild zones
  mineSlots?: MapMineSlot[];       // metal mine positions (blue/red pairs, mirrored)
  armorySlots?: MapArmorySlot[];   // armory positions (blue/red pairs)
  tiles?: number[][];              // 2D grid [row][col], values: 0=normal, 1=high_ground, 2=water
  tilesetColor?: number;           // 1-5, default 4
  groundLayer?: (number | null)[][];   // per-cell tileset indices for ground layer (index = tilesetRow * 9 + tilesetCol)
  highLayer?: (number | null)[][];     // per-cell tileset indices for high ground layer overlay
  eventCircles?: MapEventCircle[]; // event trigger zones
  grassTint?: number[][];          // per-cell grass tint overlay (0=none, 1=light, 2=dark, 3=yellow, 4=brown, 5=damp)
  towerSlots?: MapTowerSlot[];     // defensive tower positions (blue/red pairs)
  bushZones?: MapBushZone[];       // LoL-style brush zones (hide units inside, blue/red pairs)
  rockPositions?: MapRockDef[];    // decorative rock positions (blue/red pairs)
  boundaryBlocks?: MapBoundaryBlock[]; // invisible rectangular walls that block unit movement
}

// ─── TIER POOLS ──────────────────────────────────────────
// Animals available for random assignment per tier

export const TIER_POOLS: Record<number, string[]> = {
  0: ['gnome'],
  1: ['gnome', 'turtle'],
  2: ['skull', 'spider', 'hyena', 'rogue', 'turtle'],
  3: ['panda', 'lizard'],
  4: ['minotaur', 'shaman'],
};

// ─── SHUFFLE HELPER ──────────────────────────────────────

function seededShuffle<T>(arr: T[], rng: () => number): T[] {
  const copy = [...arr];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

// ─── ASSIGN ANIMALS TO CAMP SLOTS ───────────────────────
// Returns array parallel to campSlots with assigned animal type.
// Mirrored slots (blue/red) always get the same animal.
// Guarantees one of each animal type per tier before wrapping.

export function assignAnimalsToSlots(
  slots: MapCampSlot[],
  rng: () => number,
): string[] {
  // Slot 0 is always gnome (the safe starter camp near base)
  const result: string[] = new Array(slots.length);
  if (slots.length > 0) result[0] = 'gnome';

  // Group remaining slots by tier
  const tierGroups: Map<number, number[]> = new Map();
  slots.forEach((slot, i) => {
    if (i === 0) return; // already assigned gnome
    if (!tierGroups.has(slot.tier)) tierGroups.set(slot.tier, []);
    tierGroups.get(slot.tier)!.push(i);
  });

  for (const [tier, indices] of tierGroups) {
    let pool = TIER_POOLS[tier] || [];
    if (pool.length === 0) continue;

    // For T1, exclude gnome since slot 0 already has it
    if (tier === 1) pool = pool.filter(a => a !== 'gnome');

    const shuffled = seededShuffle(pool, rng);
    for (let i = 0; i < indices.length; i++) {
      result[indices[i]] = shuffled[i % shuffled.length];
    }
  }

  return result;
}

// ═══════════════════════════════════════════════════════════════
// MAP 0: THE DIAGONAL — Classic LoL-style symmetric layout
// ═══════════════════════════════════════════════════════════════
//
//  Bases at opposite corners (SW blue, NE red).
//  Three lanes: top lane, mid lane, bot lane.
//  Jungle between lanes with camps at key intersections.
//  Towers guard lane approaches. Bushes at ambush points.
//  River runs diagonal from NW to SE through center.

const DEFAULT_MAP: MapDef = {
  id: 'default',
  name: 'The Diagonal',
  description: 'Classic 3-lane layout with jungle, towers, and bushes.',
  worldW: 6400,
  worldH: 6400,
  p1Base: { x: 500, y: 5900 },
  p2Base: { x: 5900, y: 500 },
  safeRadius: 900,
  campSlots: [
    // T0 — gnome starter camp (always pre-captured); T2 — near-base jungle
    { tier: 0, bluePos: { x: 1400, y: 5000 },  redPos: { x: 5000, y: 1400 } },
    { tier: 2, bluePos: { x: 800, y: 4600 },   redPos: { x: 5600, y: 1800 } },
    { tier: 2, bluePos: { x: 1600, y: 5500 },  redPos: { x: 4800, y: 900 } },
    // T2 — mid jungle, lane intersections
    { tier: 2, bluePos: { x: 2000, y: 4200 },  redPos: { x: 4400, y: 2200 } },
    { tier: 2, bluePos: { x: 1200, y: 3800 },  redPos: { x: 5200, y: 2600 } },
    { tier: 2, bluePos: { x: 2400, y: 4800 },  redPos: { x: 4000, y: 1600 } },
    // T3 — deep jungle, near river (risky clears)
    { tier: 3, bluePos: { x: 2600, y: 3600 },  redPos: { x: 3800, y: 2800 } },
    { tier: 3, bluePos: { x: 1800, y: 3200 },  redPos: { x: 4600, y: 3200 } },
    // T4 — contested river objectives
    { tier: 4, bluePos: { x: 2800, y: 2600 },  redPos: { x: 3600, y: 3800 } },
    { tier: 4, bluePos: { x: 3400, y: 2800 },  redPos: { x: 3000, y: 3600 } },
  ],
  trollSlot: { x: 3200, y: 3200 },
  carrotZones: [
    { x: 200, y: 3400, w: 2800, h: 2800 },   // blue jungle
    { x: 3400, y: 200, w: 2800, h: 2800 },   // red jungle
  ],
  wildZones: [
    { x: 200, y: 200, w: 2000, h: 2000 },     // NW wilderness
    { x: 4200, y: 4200, w: 2000, h: 2000 },   // SE wilderness
    { x: 1800, y: 1800, w: 2800, h: 2800 },   // center contested
  ],
  wildExclusions: [
    { x: 500, y: 5900, radius: 1000 },
    { x: 5900, y: 500, radius: 1000 },
  ],
  mineSlots: [
    { bluePos: { x: 700, y: 4700 },   redPos: { x: 5700, y: 1700 } },
    { bluePos: { x: 1700, y: 5600 },  redPos: { x: 4700, y: 800 } },
    { bluePos: { x: 2200, y: 3400 },  redPos: { x: 4200, y: 3000 } },
  ],
  armorySlots: [
    { bluePos: { x: 1100, y: 5200 },  redPos: { x: 5300, y: 1200 }, equipmentType: 'sword' },
    { bluePos: { x: 600, y: 4200 },   redPos: { x: 5800, y: 2200 }, equipmentType: 'shield' },
    { bluePos: { x: 1500, y: 5600 },  redPos: { x: 4900, y: 800 },  equipmentType: 'pickaxe' },
    { bluePos: { x: 400, y: 5000 },   redPos: { x: 6000, y: 1400 }, equipmentType: 'boots' },
    { bluePos: { x: 1800, y: 4600 },  redPos: { x: 4600, y: 1800 }, equipmentType: 'banner' },
  ],
  towerSlots: [
    // Outer towers — lane defense
    { bluePos: { x: 1600, y: 5800 },  redPos: { x: 4800, y: 600 } },   // bot/top lane outer
    { bluePos: { x: 500, y: 4400 },   redPos: { x: 5900, y: 2000 } },  // side lane outer
    { bluePos: { x: 2000, y: 4600 },  redPos: { x: 4400, y: 1800 } },  // mid lane outer
    // Inner towers — base defense
    { bluePos: { x: 1000, y: 5400 },  redPos: { x: 5400, y: 1000 } },  // base inner
  ],
  bushZones: [
    // Lane bushes — ambush points along routes
    { blueZone: { x: 1800, y: 5600, w: 250, h: 120 }, redZone: { x: 4350, y: 680, w: 250, h: 120 } },
    { blueZone: { x: 400, y: 4000, w: 120, h: 280 },  redZone: { x: 5880, y: 2120, w: 120, h: 280 } },
    // Jungle bushes — near camps
    { blueZone: { x: 1200, y: 4400, w: 200, h: 150 }, redZone: { x: 5000, y: 1850, w: 200, h: 150 } },
    { blueZone: { x: 2200, y: 3800, w: 180, h: 200 }, redZone: { x: 4020, y: 2400, w: 180, h: 200 } },
    // River bushes — key vision control
    { blueZone: { x: 2400, y: 2800, w: 250, h: 140 }, redZone: { x: 3750, y: 3460, w: 250, h: 140 } },
    { blueZone: { x: 3000, y: 2400, w: 140, h: 250 }, redZone: { x: 3260, y: 3750, w: 140, h: 250 } },
  ],
  rockPositions: [
    // Jungle terrain obstacles
    { bluePos: { x: 1600, y: 4400 }, redPos: { x: 4800, y: 2000 }, variant: 1 },
    { bluePos: { x: 2400, y: 5200 }, redPos: { x: 4000, y: 1200 }, variant: 2 },
    { bluePos: { x: 1000, y: 3600 }, redPos: { x: 5400, y: 2800 }, variant: 3 },
    { bluePos: { x: 2800, y: 3200 }, redPos: { x: 3600, y: 3200 }, variant: 1 },
    // Lane decorations
    { bluePos: { x: 600, y: 5200 },  redPos: { x: 5800, y: 1200 }, variant: 2 },
    { bluePos: { x: 2000, y: 5800 }, redPos: { x: 4400, y: 600 },  variant: 3 },
  ],
};

// ═══════════════════════════════════════════════════════════════
// MAP A: THE CROSSROADS — 4 lanes with bridge chokepoints
// ═══════════════════════════════════════════════════════════════
//
//  4 horizontal lanes crossed by 2 vertical corridors.
//  River through center, crossed at 2 bridge chokepoints.
//  Towers at lane entrances. Bushes at every intersection.

const CROSSROADS_MAP: MapDef = {
  id: 'crossroads',
  name: 'The Crossroads',
  description: '4 lanes, 2 bridges. Bushes at every intersection.',
  worldW: 6400,
  worldH: 6400,
  p1Base: { x: 500, y: 5900 },
  p2Base: { x: 5900, y: 500 },
  safeRadius: 900,
  campSlots: [
    // T0 — gnome starter camp (always pre-captured); T2 — near-base jungle
    { tier: 0, bluePos: { x: 1200, y: 5200 },  redPos: { x: 5200, y: 1200 } },
    { tier: 2, bluePos: { x: 1000, y: 4600 },  redPos: { x: 5400, y: 1800 } },
    { tier: 2, bluePos: { x: 1800, y: 5600 },  redPos: { x: 4600, y: 800 } },
    // T2 — lane intersections
    { tier: 2, bluePos: { x: 2000, y: 4400 },  redPos: { x: 4400, y: 2000 } },
    { tier: 2, bluePos: { x: 1400, y: 3800 },  redPos: { x: 5000, y: 2600 } },
    { tier: 2, bluePos: { x: 2600, y: 5000 },  redPos: { x: 3800, y: 1400 } },
    // T3 — river approaches
    { tier: 3, bluePos: { x: 2400, y: 3600 },  redPos: { x: 4000, y: 2800 } },
    { tier: 3, bluePos: { x: 2000, y: 3200 },  redPos: { x: 4400, y: 3200 } },
    // T4 — bridge fights
    { tier: 4, bluePos: { x: 2600, y: 2800 },  redPos: { x: 3800, y: 3600 } },
    { tier: 4, bluePos: { x: 3200, y: 2600 },  redPos: { x: 3200, y: 3800 } },
  ],
  trollSlot: { x: 3200, y: 3200 },
  carrotZones: [
    { x: 200, y: 3400, w: 2600, h: 2800 },
    { x: 3600, y: 200, w: 2600, h: 2800 },
  ],
  wildZones: [
    { x: 1600, y: 600, w: 3200, h: 1400 },
    { x: 1600, y: 4400, w: 3200, h: 1400 },
    { x: 2200, y: 2200, w: 2000, h: 2000 },
  ],
  wildExclusions: [
    { x: 500, y: 5900, radius: 1000 },
    { x: 5900, y: 500, radius: 1000 },
  ],
  mineSlots: [
    { bluePos: { x: 700, y: 4700 },   redPos: { x: 5700, y: 1700 } },
    { bluePos: { x: 1700, y: 5600 },  redPos: { x: 4700, y: 800 } },
  ],
  armorySlots: [
    { bluePos: { x: 1100, y: 5200 },  redPos: { x: 5300, y: 1200 }, equipmentType: 'sword' },
    { bluePos: { x: 800, y: 4000 },   redPos: { x: 5600, y: 2400 }, equipmentType: 'boots' },
    { bluePos: { x: 1400, y: 5600 },  redPos: { x: 5000, y: 800 },  equipmentType: 'pickaxe' },
    { bluePos: { x: 500, y: 4800 },   redPos: { x: 5900, y: 1600 }, equipmentType: 'shield' },
    { bluePos: { x: 1700, y: 4400 },  redPos: { x: 4700, y: 2000 }, equipmentType: 'banner' },
  ],
  towerSlots: [
    { bluePos: { x: 1400, y: 5600 },  redPos: { x: 5000, y: 800 } },
    { bluePos: { x: 600, y: 4400 },   redPos: { x: 5800, y: 2000 } },
    { bluePos: { x: 1800, y: 4600 },  redPos: { x: 4600, y: 1800 } },
    { bluePos: { x: 900, y: 5200 },   redPos: { x: 5500, y: 1200 } },
  ],
  bushZones: [
    // Intersection bushes — one at each lane crossing
    { blueZone: { x: 1600, y: 4200, w: 200, h: 160 }, redZone: { x: 4600, y: 2040, w: 200, h: 160 } },
    { blueZone: { x: 2200, y: 3600, w: 200, h: 160 }, redZone: { x: 4000, y: 2640, w: 200, h: 160 } },
    { blueZone: { x: 1200, y: 3400, w: 160, h: 240 }, redZone: { x: 5040, y: 2760, w: 160, h: 240 } },
    // Bridge bushes
    { blueZone: { x: 2600, y: 2600, w: 240, h: 140 }, redZone: { x: 3560, y: 3660, w: 240, h: 140 } },
    { blueZone: { x: 3000, y: 2200, w: 140, h: 240 }, redZone: { x: 3260, y: 3960, w: 140, h: 240 } },
  ],
  rockPositions: [
    { bluePos: { x: 1400, y: 4800 }, redPos: { x: 5000, y: 1600 }, variant: 1 },
    { bluePos: { x: 2200, y: 5200 }, redPos: { x: 4200, y: 1200 }, variant: 2 },
    { bluePos: { x: 800, y: 3600 },  redPos: { x: 5600, y: 2800 }, variant: 3 },
    { bluePos: { x: 2800, y: 3000 }, redPos: { x: 3600, y: 3400 }, variant: 1 },
  ],
};

// ═══════════════════════════════════════════════════════════════
// MAP B: THE RING — Central lake with ring path
// ═══════════════════════════════════════════════════════════════
//
//  Large lake in center. Ring path around it.
//  Towers guard ring entrances. Bushes along ring path.
//  T4 camps on center island accessible via 2 bridges.

const RING_MAP: MapDef = {
  id: 'ring',
  name: 'The Ring',
  description: 'Circle the lake. Center island holds the best camps.',
  worldW: 6400,
  worldH: 6400,
  p1Base: { x: 600, y: 5800 },
  p2Base: { x: 5800, y: 600 },
  safeRadius: 900,
  campSlots: [
    // T0 — gnome starter camp (always pre-captured); T2 — near-base jungle
    { tier: 0, bluePos: { x: 1300, y: 5000 },  redPos: { x: 5100, y: 1400 } },
    { tier: 2, bluePos: { x: 900, y: 4600 },   redPos: { x: 5500, y: 1800 } },
    { tier: 2, bluePos: { x: 1600, y: 5500 },  redPos: { x: 4800, y: 900 } },
    // T2 — ring entrances
    { tier: 2, bluePos: { x: 1800, y: 4200 },  redPos: { x: 4600, y: 2200 } },
    { tier: 2, bluePos: { x: 2200, y: 4800 },  redPos: { x: 4200, y: 1600 } },
    { tier: 2, bluePos: { x: 1200, y: 3600 },  redPos: { x: 5200, y: 2800 } },
    // T3 — far side of ring
    { tier: 3, bluePos: { x: 2800, y: 4400 },  redPos: { x: 3600, y: 2000 } },
    { tier: 3, bluePos: { x: 1600, y: 2800 },  redPos: { x: 4800, y: 3600 } },
    // T4 — center island
    { tier: 4, bluePos: { x: 2900, y: 3400 },  redPos: { x: 3500, y: 3000 } },
    { tier: 4, bluePos: { x: 3000, y: 2900 },  redPos: { x: 3400, y: 3500 } },
  ],
  trollSlot: { x: 3200, y: 3200 },
  carrotZones: [
    { x: 200, y: 4000, w: 2200, h: 2200 },
    { x: 4000, y: 200, w: 2200, h: 2200 },
    { x: 200, y: 2200, w: 1000, h: 1600 },
    { x: 5200, y: 2600, w: 1000, h: 1600 },
  ],
  wildZones: [
    { x: 2200, y: 600, w: 2000, h: 1400 },
    { x: 2200, y: 4400, w: 2000, h: 1400 },
    { x: 400, y: 1400, w: 1400, h: 2200 },
    { x: 4600, y: 2800, w: 1400, h: 2200 },
  ],
  wildExclusions: [
    { x: 600, y: 5800, radius: 1000 },
    { x: 5800, y: 600, radius: 1000 },
    { x: 3200, y: 3200, radius: 800 },
  ],
  mineSlots: [
    { bluePos: { x: 800, y: 4600 },   redPos: { x: 5600, y: 1800 } },
    { bluePos: { x: 1800, y: 5500 },  redPos: { x: 4600, y: 900 } },
    { bluePos: { x: 2400, y: 3200 },  redPos: { x: 4000, y: 3200 }, },
  ],
  armorySlots: [
    { bluePos: { x: 1200, y: 5200 },  redPos: { x: 5200, y: 1200 }, equipmentType: 'sword' },
    { bluePos: { x: 1600, y: 3400 },  redPos: { x: 4800, y: 3000 }, equipmentType: 'shield' },
    { bluePos: { x: 1500, y: 5600 },  redPos: { x: 4900, y: 800 },  equipmentType: 'pickaxe' },
    { bluePos: { x: 600, y: 4400 },   redPos: { x: 5800, y: 2000 }, equipmentType: 'boots' },
    { bluePos: { x: 1900, y: 4400 },  redPos: { x: 4500, y: 2000 }, equipmentType: 'banner' },
  ],
  towerSlots: [
    // Base defense
    { bluePos: { x: 1200, y: 5600 },  redPos: { x: 5200, y: 800 } },
    { bluePos: { x: 600, y: 4800 },   redPos: { x: 5800, y: 1600 } },
    // Ring entrance towers
    { bluePos: { x: 1800, y: 4600 },  redPos: { x: 4600, y: 1800 } },
    { bluePos: { x: 1200, y: 3400 },  redPos: { x: 5200, y: 3000 } },
  ],
  bushZones: [
    // Ring path bushes
    { blueZone: { x: 2000, y: 4000, w: 200, h: 200 }, redZone: { x: 4200, y: 2200, w: 200, h: 200 } },
    { blueZone: { x: 2600, y: 4400, w: 250, h: 140 }, redZone: { x: 3550, y: 1860, w: 250, h: 140 } },
    { blueZone: { x: 1400, y: 3200, w: 140, h: 250 }, redZone: { x: 4860, y: 2950, w: 140, h: 250 } },
    // Bridge approach bushes
    { blueZone: { x: 2600, y: 3000, w: 200, h: 160 }, redZone: { x: 3600, y: 3240, w: 200, h: 160 } },
    { blueZone: { x: 3000, y: 2600, w: 160, h: 200 }, redZone: { x: 3240, y: 3600, w: 160, h: 200 } },
  ],
  rockPositions: [
    // Ring path obstacles
    { bluePos: { x: 2400, y: 4200 }, redPos: { x: 4000, y: 2200 }, variant: 1 },
    { bluePos: { x: 1600, y: 3000 }, redPos: { x: 4800, y: 3400 }, variant: 2 },
    { bluePos: { x: 2800, y: 4600 }, redPos: { x: 3600, y: 1800 }, variant: 3 },
    // Base area rocks
    { bluePos: { x: 800, y: 5400 },  redPos: { x: 5600, y: 1000 }, variant: 1 },
    { bluePos: { x: 1400, y: 4400 }, redPos: { x: 5000, y: 2000 }, variant: 2 },
  ],
};

// ═══════════════════════════════════════════════════════════════
// MAP C: THREE KINGDOMS — Single bridge, 3 zones
// ═══════════════════════════════════════════════════════════════
//
//  Diagonal river, single bridge at center.
//  3 zones: left flank, right flank, central bridge.
//  Most camp-dense map. Heavy bush coverage for flanking.
//  Towers at bridge and flank entrances.

const THREE_KINGDOMS_MAP: MapDef = {
  id: 'three_kingdoms',
  name: 'Three Kingdoms',
  description: 'One bridge. Three zones. Heavy bush coverage for ambushes.',
  worldW: 6400,
  worldH: 6400,
  p1Base: { x: 600, y: 5800 },
  p2Base: { x: 5800, y: 600 },
  safeRadius: 1000,
  campSlots: [
    // T0 — gnome starter camp (always pre-captured); T2 — near-base jungle
    { tier: 0, bluePos: { x: 1100, y: 5100 },  redPos: { x: 5300, y: 1300 } },
    { tier: 2, bluePos: { x: 1500, y: 5500 },  redPos: { x: 4900, y: 900 } },
    { tier: 2, bluePos: { x: 800, y: 4600 },   redPos: { x: 5600, y: 1800 } },
    // T2 — flanks (3 per side)
    { tier: 2, bluePos: { x: 1000, y: 4000 },  redPos: { x: 5400, y: 2400 } },
    { tier: 2, bluePos: { x: 2200, y: 4800 },  redPos: { x: 4200, y: 1600 } },
    { tier: 2, bluePos: { x: 1800, y: 4200 },  redPos: { x: 4600, y: 2200 } },
    // T3 — river approach (3 per side)
    { tier: 3, bluePos: { x: 1400, y: 3400 },  redPos: { x: 5000, y: 3000 } },
    { tier: 3, bluePos: { x: 2600, y: 4000 },  redPos: { x: 3800, y: 2400 } },
    { tier: 3, bluePos: { x: 2200, y: 3600 },  redPos: { x: 4200, y: 2800 } },
    // T4 — bridge zone (2 per side)
    { tier: 4, bluePos: { x: 2800, y: 3000 },  redPos: { x: 3600, y: 3400 } },
    { tier: 4, bluePos: { x: 3000, y: 3300 },  redPos: { x: 3400, y: 3100 } },
  ],
  trollSlot: { x: 3200, y: 3200 },
  carrotZones: [
    { x: 200, y: 3600, w: 1800, h: 2600 },
    { x: 4400, y: 200, w: 1800, h: 2600 },
    { x: 2000, y: 4400, w: 1400, h: 1800 },
    { x: 3000, y: 200, w: 1400, h: 1800 },
    { x: 2600, y: 2600, w: 1200, h: 1200 },
  ],
  wildZones: [
    { x: 400, y: 1000, w: 1800, h: 2200 },
    { x: 4200, y: 3200, w: 1800, h: 2200 },
    { x: 2000, y: 1200, w: 2400, h: 1200 },
    { x: 1600, y: 4000, w: 2400, h: 1200 },
    { x: 2400, y: 2400, w: 1600, h: 1600 },
  ],
  wildExclusions: [
    { x: 600, y: 5800, radius: 1200 },
    { x: 5800, y: 600, radius: 1200 },
  ],
  mineSlots: [
    { bluePos: { x: 800, y: 4600 },   redPos: { x: 5600, y: 1800 } },
    { bluePos: { x: 1800, y: 5500 },  redPos: { x: 4600, y: 900 } },
    { bluePos: { x: 2400, y: 3200 },  redPos: { x: 4000, y: 3200 } },
  ],
  armorySlots: [
    { bluePos: { x: 1200, y: 5200 },  redPos: { x: 5200, y: 1200 }, equipmentType: 'sword' },
    { bluePos: { x: 1600, y: 4400 },  redPos: { x: 4800, y: 2000 }, equipmentType: 'shield' },
    { bluePos: { x: 800, y: 3800 },   redPos: { x: 5600, y: 2600 }, equipmentType: 'boots' },
    { bluePos: { x: 1400, y: 5600 },  redPos: { x: 5000, y: 800 },  equipmentType: 'pickaxe' },
    { bluePos: { x: 2000, y: 4800 },  redPos: { x: 4400, y: 1600 }, equipmentType: 'banner' },
  ],
  towerSlots: [
    // Base defense
    { bluePos: { x: 1200, y: 5600 },  redPos: { x: 5200, y: 800 } },
    { bluePos: { x: 600, y: 5000 },   redPos: { x: 5800, y: 1400 } },
    // Flank defense
    { bluePos: { x: 1600, y: 4400 },  redPos: { x: 4800, y: 2000 } },
    { bluePos: { x: 1000, y: 3600 },  redPos: { x: 5400, y: 2800 } },
    // Bridge approach
    { bluePos: { x: 2400, y: 3400 },  redPos: { x: 4000, y: 3000 } },
  ],
  bushZones: [
    // Left flank bushes (heavy coverage for flanking)
    { blueZone: { x: 800, y: 3800, w: 200, h: 300 },  redZone: { x: 5400, y: 2300, w: 200, h: 300 } },
    { blueZone: { x: 1200, y: 3200, w: 260, h: 160 }, redZone: { x: 4940, y: 3040, w: 260, h: 160 } },
    // Right flank bushes
    { blueZone: { x: 2400, y: 4600, w: 200, h: 200 }, redZone: { x: 3800, y: 1600, w: 200, h: 200 } },
    { blueZone: { x: 2000, y: 4000, w: 260, h: 140 }, redZone: { x: 4140, y: 2260, w: 260, h: 140 } },
    // Central corridor bushes (bridge approach)
    { blueZone: { x: 2600, y: 3200, w: 200, h: 200 }, redZone: { x: 3600, y: 3000, w: 200, h: 200 } },
    { blueZone: { x: 2200, y: 2800, w: 240, h: 140 }, redZone: { x: 3960, y: 3460, w: 240, h: 140 } },
    // Deep flanking bushes (risky but rewarding)
    { blueZone: { x: 1400, y: 2600, w: 180, h: 280 }, redZone: { x: 4820, y: 3520, w: 180, h: 280 } },
  ],
  rockPositions: [
    // Flank obstacles
    { bluePos: { x: 1000, y: 4200 }, redPos: { x: 5400, y: 2200 }, variant: 1 },
    { bluePos: { x: 2000, y: 4600 }, redPos: { x: 4400, y: 1800 }, variant: 2 },
    { bluePos: { x: 1600, y: 3000 }, redPos: { x: 4800, y: 3400 }, variant: 3 },
    // Bridge area rocks
    { bluePos: { x: 2600, y: 2800 }, redPos: { x: 3800, y: 3600 }, variant: 1 },
    { bluePos: { x: 3200, y: 2600 }, redPos: { x: 3200, y: 3800 }, variant: 2 },
    // Base decoration
    { bluePos: { x: 800, y: 5400 },  redPos: { x: 5600, y: 1000 }, variant: 3 },
    { bluePos: { x: 1400, y: 5600 }, redPos: { x: 5000, y: 800 },  variant: 1 },
  ],
};

// ═══════════════════════════════════════════════════════════════
// MAP REGISTRY
// ═══════════════════════════════════════════════════════════════

export const ALL_MAPS: MapDef[] = [
  DEFAULT_MAP,
  CROSSROADS_MAP,
  RING_MAP,
  THREE_KINGDOMS_MAP,
];

export function getMapById(id: string): MapDef {
  return ALL_MAPS.find(m => m.id === id) || DEFAULT_MAP;
}

export function getSoloMaps(): MapDef[] {
  return ALL_MAPS;
}
