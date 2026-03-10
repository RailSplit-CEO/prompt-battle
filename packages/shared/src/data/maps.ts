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
  tier: 1 | 2 | 3 | 4;
  bluePos: { x: number; y: number };
  redPos: { x: number; y: number };
}

export interface MapZoneDef {
  x: number;
  y: number;
  w: number;
  h: number;
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
}

// ─── TIER POOLS ──────────────────────────────────────────
// Animals available for random assignment per tier

export const TIER_POOLS: Record<number, string[]> = {
  1: ['gnome', 'turtle'],
  2: ['skull', 'spider', 'gnoll'],
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
// Each animal appears at most once per tier (wraps if more slots than animals).

export function assignAnimalsToSlots(
  slots: MapCampSlot[],
  rng: () => number,
): string[] {
  // Group slots by tier
  const tierGroups: Map<number, number[]> = new Map();
  slots.forEach((slot, i) => {
    if (!tierGroups.has(slot.tier)) tierGroups.set(slot.tier, []);
    tierGroups.get(slot.tier)!.push(i);
  });

  const result: string[] = new Array(slots.length);

  for (const [tier, indices] of tierGroups) {
    const pool = TIER_POOLS[tier] || [];
    if (pool.length === 0) continue;

    const shuffled = seededShuffle(pool, rng);
    for (let i = 0; i < indices.length; i++) {
      result[indices[i]] = shuffled[i % shuffled.length];
    }
  }

  return result;
}

// ═══════════════════════════════════════════════════════════════
// MAP 0: DEFAULT — The Diagonal (current map, used in multiplayer)
// ═══════════════════════════════════════════════════════════════

const DEFAULT_MAP: MapDef = {
  id: 'default',
  name: 'The Diagonal',
  description: 'Classic layout. Bases at opposite corners, camps spiral inward.',
  worldW: 3200,
  worldH: 3200,
  p1Base: { x: 250, y: 2950 },
  p2Base: { x: 2950, y: 250 },
  safeRadius: 500,
  campSlots: [
    // T1 — near bases
    { tier: 1, bluePos: { x: 650, y: 2550 },  redPos: { x: 2550, y: 650 } },
    { tier: 1, bluePos: { x: 700, y: 2700 },  redPos: { x: 2500, y: 500 } },
    // T2 — mid range
    { tier: 2, bluePos: { x: 1050, y: 2150 }, redPos: { x: 2150, y: 1050 } },
    { tier: 2, bluePos: { x: 1100, y: 2350 }, redPos: { x: 2100, y: 850 } },
    { tier: 2, bluePos: { x: 850, y: 1950 },  redPos: { x: 2350, y: 1250 } },
    // T3 — far mid
    { tier: 3, bluePos: { x: 1350, y: 1700 }, redPos: { x: 1850, y: 1500 } },
    { tier: 3, bluePos: { x: 1400, y: 1850 }, redPos: { x: 1800, y: 1350 } },
    // T4 — contested center
    { tier: 4, bluePos: { x: 1500, y: 1450 }, redPos: { x: 1700, y: 1750 } },
    { tier: 4, bluePos: { x: 1650, y: 1500 }, redPos: { x: 1550, y: 1700 } },
  ],
  trollSlot: { x: 1600, y: 1600 },
  carrotZones: [
    // Blue half — lower-left
    { x: 100, y: 1600, w: 1500, h: 1500 },
    // Red half — upper-right
    { x: 1600, y: 100, w: 1500, h: 1500 },
  ],
  wildZones: [
    // Outskirts and mid-zones, avoiding bases
    { x: 100, y: 100, w: 800, h: 800 },       // top-left corner
    { x: 2300, y: 100, w: 800, h: 800 },       // top-right corner
    { x: 100, y: 2300, w: 800, h: 800 },       // bottom-left corner
    { x: 2300, y: 2300, w: 800, h: 800 },      // bottom-right corner
    { x: 800, y: 800, w: 1600, h: 1600 },      // center band
  ],
  wildExclusions: [
    { x: 250, y: 2950, radius: 500 },   // P1 base
    { x: 2950, y: 250, radius: 500 },   // P2 base
  ],
};

// ═══════════════════════════════════════════════════════════════
// MAP A: THE CROSSROADS — 4 horizontal lanes with ladder connections
// ═══════════════════════════════════════════════════════════════
//
//  Bases at bottom-left / top-right.
//  4 horizontal lanes run across the map.
//  2 vertical corridors connect them (like a ladder).
//  Horizontal river through center, crossed by 2 bridges at corridors.
//  12 camp slots (6 per side) placed at lane intersections.
//  Chokepoints at bridges create key fight zones.

const CROSSROADS_MAP: MapDef = {
  id: 'crossroads',
  name: 'The Crossroads',
  description: '4 lanes, 2 bridges. Pick your battles at the intersections.',
  worldW: 3200,
  worldH: 3200,
  p1Base: { x: 250, y: 2950 },
  p2Base: { x: 2950, y: 250 },
  safeRadius: 500,
  campSlots: [
    // T1 — closest to base, easy first captures
    { tier: 1, bluePos: { x: 600, y: 2600 },   redPos: { x: 2600, y: 600 } },
    { tier: 1, bluePos: { x: 500, y: 2300 },   redPos: { x: 2700, y: 900 } },
    // T2 — lane intersections, mid-outer
    { tier: 2, bluePos: { x: 1000, y: 2200 },  redPos: { x: 2200, y: 1000 } },
    { tier: 2, bluePos: { x: 800, y: 1900 },   redPos: { x: 2400, y: 1300 } },
    { tier: 2, bluePos: { x: 1200, y: 2500 },  redPos: { x: 2000, y: 700 } },
    // T3 — inner lane crossings, near river
    { tier: 3, bluePos: { x: 1300, y: 1800 },  redPos: { x: 1900, y: 1400 } },
    { tier: 3, bluePos: { x: 1100, y: 1650 },  redPos: { x: 2100, y: 1550 } },
    // T4 — bridge chokepoints, most contested
    { tier: 4, bluePos: { x: 1400, y: 1500 },  redPos: { x: 1800, y: 1700 } },
    { tier: 4, bluePos: { x: 1600, y: 1400 },  redPos: { x: 1600, y: 1800 } },
  ],
  trollSlot: { x: 1600, y: 1600 },
  carrotZones: [
    // Blue safe half — lower portion below river
    { x: 100, y: 1700, w: 1400, h: 1400 },
    // Red safe half — upper portion above river
    { x: 1700, y: 100, w: 1400, h: 1400 },
    // Small carrot patches along outer lanes
    { x: 100, y: 1200, w: 600, h: 400 },
    { x: 2500, y: 1600, w: 600, h: 400 },
  ],
  wildZones: [
    // Wild animals roam the lane corridors and outskirts
    { x: 800, y: 400, w: 1600, h: 600 },       // top lane
    { x: 800, y: 2200, w: 1600, h: 600 },      // bottom lane
    { x: 200, y: 600, w: 500, h: 1200 },       // left corridor
    { x: 2500, y: 1400, w: 500, h: 1200 },     // right corridor
    { x: 1200, y: 1100, w: 800, h: 1000 },     // central contested zone
  ],
  wildExclusions: [
    { x: 250, y: 2950, radius: 600 },
    { x: 2950, y: 250, radius: 600 },
  ],
};

// ═══════════════════════════════════════════════════════════════
// MAP B: THE RING — Central lake with ring path
// ═══════════════════════════════════════════════════════════════
//
//  Large impassable lake in the center.
//  A ring path circles the lake — main contested route.
//  T1 camps near bases, T2 at ring entrances, T3 on far flanks.
//  T4 camps on tiny islands inside the lake (2 bridge crossings).
//  Forests fill corners between ring and shore.
//  Forces fights around the ring. T4 is king-of-the-hill in center.

const RING_MAP: MapDef = {
  id: 'ring',
  name: 'The Ring',
  description: 'Circle the lake. The center island holds the strongest camps.',
  worldW: 3200,
  worldH: 3200,
  p1Base: { x: 300, y: 2900 },
  p2Base: { x: 2900, y: 300 },
  safeRadius: 500,
  campSlots: [
    // T1 — right outside base
    { tier: 1, bluePos: { x: 650, y: 2500 },   redPos: { x: 2550, y: 700 } },
    { tier: 1, bluePos: { x: 450, y: 2400 },   redPos: { x: 2750, y: 800 } },
    // T2 — ring entrances (4 cardinal points)
    { tier: 2, bluePos: { x: 900, y: 2100 },   redPos: { x: 2300, y: 1100 } },
    { tier: 2, bluePos: { x: 1100, y: 2400 },  redPos: { x: 2100, y: 800 } },
    { tier: 2, bluePos: { x: 700, y: 1800 },   redPos: { x: 2500, y: 1400 } },
    // T3 — far side of ring (flanks)
    { tier: 3, bluePos: { x: 1400, y: 2100 },  redPos: { x: 1800, y: 1100 } },
    { tier: 3, bluePos: { x: 900, y: 1400 },   redPos: { x: 2300, y: 1800 } },
    // T4 — center island (most contested, must cross bridges)
    { tier: 4, bluePos: { x: 1450, y: 1700 },  redPos: { x: 1750, y: 1500 } },
    { tier: 4, bluePos: { x: 1500, y: 1500 },  redPos: { x: 1700, y: 1700 } },
  ],
  trollSlot: { x: 1600, y: 1600 },
  carrotZones: [
    // Blue quadrant (south-west, outside the ring)
    { x: 100, y: 2000, w: 1000, h: 1100 },
    // Red quadrant (north-east, outside the ring)
    { x: 2100, y: 100, w: 1000, h: 1100 },
    // Small patches on the flanks
    { x: 100, y: 1200, w: 500, h: 700 },
    { x: 2600, y: 1300, w: 500, h: 700 },
  ],
  wildZones: [
    // Wild animals roam the outer ring and far flanks
    { x: 1200, y: 300, w: 800, h: 600 },      // north flank
    { x: 1200, y: 2300, w: 800, h: 600 },     // south flank
    { x: 200, y: 800, w: 600, h: 1000 },      // west edge
    { x: 2400, y: 1400, w: 600, h: 1000 },    // east edge
    { x: 1000, y: 1000, w: 1200, h: 1200 },   // ring area (not inner lake)
  ],
  wildExclusions: [
    { x: 300, y: 2900, radius: 600 },
    { x: 2900, y: 300, radius: 600 },
    // Inner lake — no wilds inside the water
    { x: 1600, y: 1600, radius: 350 },
  ],
};

// ═══════════════════════════════════════════════════════════════
// MAP C: THREE KINGDOMS — Single bridge, 3 triangular zones
// ═══════════════════════════════════════════════════════════════
//
//  Diagonal river with only 1 bridge at the center.
//  Dense forests split each side into 2 zones (left flank, right flank).
//  3 strategic zones total: left flank, right flank, central corridor.
//  14 camp slots (7 per side) — most camps of any map.
//  The single bridge T4 is THE key fight of the game.
//  Flanking requires going wide — commit to a side or fight center.

const THREE_KINGDOMS_MAP: MapDef = {
  id: 'three_kingdoms',
  name: 'Three Kingdoms',
  description: 'One bridge. Three zones. Commit to a side or fight for the center.',
  worldW: 3200,
  worldH: 3200,
  p1Base: { x: 300, y: 2900 },
  p2Base: { x: 2900, y: 300 },
  safeRadius: 550,
  campSlots: [
    // T1 — near base (2 per side, one left flank, one right flank)
    { tier: 1, bluePos: { x: 550, y: 2550 },   redPos: { x: 2650, y: 650 } },
    { tier: 1, bluePos: { x: 750, y: 2700 },   redPos: { x: 2450, y: 500 } },
    // T2 — mid, spread across flanks (3 per side)
    { tier: 2, bluePos: { x: 500, y: 2100 },   redPos: { x: 2700, y: 1100 } },  // left flank
    { tier: 2, bluePos: { x: 1100, y: 2400 },  redPos: { x: 2100, y: 800 } },   // right flank
    { tier: 2, bluePos: { x: 900, y: 2000 },   redPos: { x: 2300, y: 1200 } },  // central approach
    // T3 — contested mid (closer to river)
    { tier: 3, bluePos: { x: 700, y: 1700 },   redPos: { x: 2500, y: 1500 } },  // left flank deep
    { tier: 3, bluePos: { x: 1300, y: 2000 },  redPos: { x: 1900, y: 1200 } },  // right flank deep
    { tier: 3, bluePos: { x: 1100, y: 1750 },  redPos: { x: 2100, y: 1450 } },  // central push
    // T4 — bridge zone (most contested, very center)
    { tier: 4, bluePos: { x: 1400, y: 1500 },  redPos: { x: 1800, y: 1700 } },
    { tier: 4, bluePos: { x: 1500, y: 1650 },  redPos: { x: 1700, y: 1550 } },
  ],
  trollSlot: { x: 1600, y: 1600 },
  carrotZones: [
    // Blue side — wide area, split between flanks
    { x: 100, y: 1800, w: 800, h: 1300 },     // left flank
    { x: 900, y: 2100, w: 700, h: 1000 },     // right flank
    // Red side — mirrored
    { x: 2300, y: 100, w: 800, h: 1300 },
    { x: 1500, y: 100, w: 700, h: 1000 },
    // Small patch near bridge for risk/reward gathering
    { x: 1300, y: 1300, w: 600, h: 600 },
  ],
  wildZones: [
    // Wild animals roam the flanks and the corridor approaches
    { x: 200, y: 500, w: 800, h: 1000 },       // far left
    { x: 2200, y: 1700, w: 800, h: 1000 },     // far right (mirrored)
    { x: 1000, y: 700, w: 1200, h: 500 },      // top band
    { x: 800, y: 2000, w: 1200, h: 500 },      // bottom band
    { x: 1200, y: 1200, w: 800, h: 800 },      // central contested
  ],
  wildExclusions: [
    { x: 300, y: 2900, radius: 650 },
    { x: 2900, y: 300, radius: 650 },
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
