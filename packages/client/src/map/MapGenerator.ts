import { TileType, Position, MapZone, MineNode, TowerSite, NeutralCamp, ScoutingPost, MapPhase } from '@prompt-battle/shared';

// Simple seeded PRNG (mulberry32)
function mulberry32(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function createNoise2D(seed: number) {
  const rng = mulberry32(seed);
  const perm = new Uint8Array(512);
  for (let i = 0; i < 256; i++) perm[i] = i;
  for (let i = 255; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [perm[i], perm[j]] = [perm[j], perm[i]];
  }
  for (let i = 0; i < 256; i++) perm[i + 256] = perm[i];

  return (x: number, y: number): number => {
    const ix = Math.floor(x);
    const iy = Math.floor(y);
    const fx = x - ix;
    const fy = y - iy;

    const sx = fx * fx * (3 - 2 * fx);
    const sy = fy * fy * (3 - 2 * fy);

    const hash = (xi: number, yi: number) => {
      const h = perm[(perm[xi & 255] + yi) & 255];
      return h / 255;
    };

    const v00 = hash(ix, iy);
    const v10 = hash(ix + 1, iy);
    const v01 = hash(ix, iy + 1);
    const v11 = hash(ix + 1, iy + 1);

    const i1 = v00 + sx * (v10 - v00);
    const i2 = v01 + sx * (v11 - v01);

    return (i1 + sy * (i2 - i1)) * 2 - 1;
  };
}

export const MAP_WIDTH = 80;
export const MAP_HEIGHT = 80;
export const TILE_SIZE = 32;

export interface SwitchGateLink {
  switchPos: Position;
  gatePositions: Position[];
}

export interface POIPlacement {
  type: 'lookout' | 'healing_well' | 'treasure_cache';
  position: Position;
  activatePhase?: MapPhase;
}

export interface ControlPointDef {
  id: string;
  name: string;
  position: Position;
  radius: number;
  buff: { type: 'speed' | 'damage' | 'defense'; value: number; label: string };
}

export interface GameMap {
  tiles: TileType[][];
  seed: number;
  spawnP1: Position[];
  spawnP2: Position[];
  flagP1: Position;
  flagP2: Position;
  controlPointPositions: Position[];
  controlPointDefs?: ControlPointDef[];
  switchGateLinks: SwitchGateLink[];
  poiPlacements: POIPlacement[];
  zones: MapZone[];
  mineNodes: MineNode[];
  towerSites: TowerSite[];
  neutralCamps: NeutralCamp[];
  scoutingPosts: ScoutingPost[];
}

export function generateMap(seed: number): GameMap {
  const noise = createNoise2D(seed);
  const noise2 = createNoise2D(seed + 1000);
  const noise3 = createNoise2D(seed + 2000);
  const tiles: TileType[][] = [];
  const rng = mulberry32(seed + 3000);
  const cx = Math.floor(MAP_WIDTH / 2);
  const cy = Math.floor(MAP_HEIGHT / 2);

  // ─── STEP 1: Generate LEFT half with Perlin noise ──────────────
  for (let y = 0; y < MAP_HEIGHT; y++) {
    tiles[y] = [];
    for (let x = 0; x < MAP_WIDTH; x++) {
      // Generate left half only; right will be mirrored rotationally
      const srcX = x < cx ? x : MAP_WIDTH - 1 - x;
      const srcY = x < cx ? y : MAP_HEIGHT - 1 - y;

      const n1 = noise(srcX * 0.12, srcY * 0.12);
      const n2 = noise2(srcX * 0.10, srcY * 0.10);
      const n3 = noise3(srcX * 0.20, srcY * 0.20);

      // Center danger gradient
      const distFromCenter = Math.abs(srcX - cx) / cx;
      const centerDanger = (1 - distFromCenter) * 0.12;

      const elevation = n1 + centerDanger;
      const moisture = n2;
      const detail = n3;

      let tile: TileType;

      if (elevation < -0.4) {
        tile = moisture < -0.3 ? 'lava' : 'water';
      } else if (elevation < -0.2) {
        if (moisture > 0.3) tile = 'swamp';
        else if (moisture > 0.1) tile = 'bush';
        else tile = 'sand';
      } else if (elevation < 0.15) {
        if (detail > 0.5) tile = 'flowers';
        else if (detail < -0.4 && moisture > 0) tile = 'mushroom';
        else tile = 'grass';
      } else if (elevation < 0.35) {
        tile = moisture > 0 ? 'forest' : 'grass';
      } else if (elevation < 0.55) {
        tile = 'hill';
      } else {
        tile = rng() > 0.3 ? 'rock' : 'ruins';
      }

      tiles[y][x] = tile;
    }
  }

  // ─── STEP 2: Carve lanes (3 horizontal + connectors) ──────────
  // These provide the "familiar structure" while terrain details vary
  carvePath(tiles, 4, cy, MAP_WIDTH - 5, cy);                                     // mid lane
  carvePath(tiles, 4, Math.floor(MAP_HEIGHT / 4), MAP_WIDTH - 5, Math.floor(MAP_HEIGHT / 4));  // top lane
  carvePath(tiles, 4, Math.floor(3 * MAP_HEIGHT / 4), MAP_WIDTH - 5, Math.floor(3 * MAP_HEIGHT / 4)); // bot lane

  // Vertical connectors
  carvePath(tiles, Math.floor(MAP_WIDTH / 4), Math.floor(MAP_HEIGHT / 4),
    Math.floor(MAP_WIDTH / 4), Math.floor(3 * MAP_HEIGHT / 4));
  carvePath(tiles, Math.floor(3 * MAP_WIDTH / 4), Math.floor(MAP_HEIGHT / 4),
    Math.floor(3 * MAP_WIDTH / 4), Math.floor(3 * MAP_HEIGHT / 4));

  // Diagonal connectors to center
  carvePath(tiles, Math.floor(MAP_WIDTH / 3), Math.floor(MAP_HEIGHT / 4), cx, cy);
  carvePath(tiles, Math.floor(2 * MAP_WIDTH / 3), Math.floor(MAP_HEIGHT / 4), cx, cy);
  carvePath(tiles, Math.floor(MAP_WIDTH / 3), Math.floor(3 * MAP_HEIGHT / 4), cx, cy);
  carvePath(tiles, Math.floor(2 * MAP_WIDTH / 3), Math.floor(3 * MAP_HEIGHT / 4), cx, cy);

  // ─── STEP 3: Place bridges ────────────────────────────────────
  for (let y = 0; y < MAP_HEIGHT; y++) {
    for (let x = 0; x < MAP_WIDTH; x++) {
      if (tiles[y][x] === 'path') continue;
      if (tiles[y][x] === 'water' || tiles[y][x] === 'lava') {
        const hasHorizNeighbors =
          x > 0 && x < MAP_WIDTH - 1 &&
          isPassableTerrain(tiles[y][x - 1]) && isPassableTerrain(tiles[y][x + 1]);
        const hasVertNeighbors =
          y > 0 && y < MAP_HEIGHT - 1 &&
          isPassableTerrain(tiles[y - 1][x]) && isPassableTerrain(tiles[y + 1][x]);
        if ((hasHorizNeighbors || hasVertNeighbors) && rng() > 0.7) {
          tiles[y][x] = 'bridge';
        }
      }
    }
  }

  // ─── STEP 4: Named zone positions (ALWAYS same structure) ─────

  // Spawns
  const spawnP1: Position[] = [
    { x: 3, y: cy - 4 },
    { x: 3, y: cy },
    { x: 3, y: cy + 4 },
    { x: 5, y: cy - 2 },
    { x: 5, y: cy + 2 },
  ];
  const spawnP2: Position[] = [
    { x: MAP_WIDTH - 4, y: cy + 4 },
    { x: MAP_WIDTH - 4, y: cy },
    { x: MAP_WIDTH - 4, y: cy - 4 },
    { x: MAP_WIDTH - 6, y: cy + 2 },
    { x: MAP_WIDTH - 6, y: cy - 2 },
  ];

  // Flags (legacy, kept for type compat)
  const flagP1: Position = { x: 6, y: cy };
  const flagP2: Position = { x: MAP_WIDTH - 7, y: cy };

  // Clear spawn areas
  const clearPositions = [...spawnP1, ...spawnP2, flagP1, flagP2];
  for (const s of clearPositions) {
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const nx = s.x + dx;
        const ny = s.y + dy;
        if (nx >= 0 && nx < MAP_WIDTH && ny >= 0 && ny < MAP_HEIGHT) {
          tiles[ny][nx] = 'grass';
        }
      }
    }
  }

  // ─── MINE NODES ───────────────────────────────────────────────
  const mineNodes: MineNode[] = [
    // Safe Mines (Phase 1) — near each base
    {
      id: 'west_mine', name: 'West Mine',
      position: snapToPassable(tiles, { x: 12, y: cy - 6 }),
      type: 'safe', depleted: false, goldPerSec: 3, currentGold: 300, activatePhase: 1, occupiedBy: null,
    },
    {
      id: 'east_mine', name: 'East Mine',
      position: snapToPassable(tiles, { x: MAP_WIDTH - 13, y: cy + 6 }),
      type: 'safe', depleted: false, goldPerSec: 3, currentGold: 300, activatePhase: 1, occupiedBy: null,
    },
    // Rich Mines (Phase 3) — contested center
    {
      id: 'gold_vein', name: 'Gold Vein',
      position: snapToPassable(tiles, { x: cx - 6, y: cy - 4 }),
      type: 'rich', depleted: false, goldPerSec: 5, currentGold: 500, activatePhase: 3, occupiedBy: null,
    },
    {
      id: 'crystal_mine', name: 'Crystal Mine',
      position: snapToPassable(tiles, { x: cx + 6, y: cy + 4 }),
      type: 'rich', depleted: false, goldPerSec: 5, currentGold: 500, activatePhase: 3, occupiedBy: null,
    },
  ];

  // Clear mine areas
  for (const mine of mineNodes) {
    clearArea(tiles, mine.position, 1);
  }

  // ─── TOWER SITES ──────────────────────────────────────────────
  const towerSites: TowerSite[] = [
    {
      id: 'your_bridge', name: 'Your Bridge',
      position: snapToPassable(tiles, { x: Math.floor(MAP_WIDTH / 3), y: cy }),
      builtTower: null, occupied: false, activatePhase: 1,
    },
    {
      id: 'their_bridge', name: 'Their Bridge',
      position: snapToPassable(tiles, { x: Math.floor(2 * MAP_WIDTH / 3), y: cy }),
      builtTower: null, occupied: false, activatePhase: 1,
    },
    {
      id: 'north_tower', name: 'North Tower',
      position: snapToPassable(tiles, { x: cx, y: Math.floor(MAP_HEIGHT / 4) }),
      builtTower: null, occupied: false, activatePhase: 1,
    },
    {
      id: 'south_tower', name: 'South Tower',
      position: snapToPassable(tiles, { x: cx, y: Math.floor(3 * MAP_HEIGHT / 4) }),
      builtTower: null, occupied: false, activatePhase: 1,
    },
  ];

  for (const site of towerSites) {
    clearArea(tiles, site.position, 1);
  }

  // ─── SCOUTING POSTS ───────────────────────────────────────────
  const scoutingPosts: ScoutingPost[] = [
    {
      id: 'north_ridge', name: 'North Ridge',
      position: snapToPassable(tiles, { x: Math.floor(MAP_WIDTH / 6), y: Math.floor(MAP_HEIGHT / 5) }),
      capturedBy: null, visionRadius: 12,
    },
    {
      id: 'south_ridge', name: 'South Ridge',
      position: snapToPassable(tiles, { x: Math.floor(5 * MAP_WIDTH / 6), y: Math.floor(4 * MAP_HEIGHT / 5) }),
      capturedBy: null, visionRadius: 12,
    },
  ];

  for (const post of scoutingPosts) {
    tiles[post.position.y][post.position.x] = 'hill';
  }

  // ─── NEUTRAL CAMPS ────────────────────────────────────────────
  const neutralCamps: NeutralCamp[] = [
    {
      id: 'wolf_den', name: 'Wolf Den',
      position: snapToPassable(tiles, { x: Math.floor(MAP_WIDTH / 5), y: Math.floor(MAP_HEIGHT / 3) }),
      type: 'easy', activatePhase: 2, cleared: false, respawnTimer: 0,
      enemies: [
        { id: 'wolf_den_1', hp: 80, maxHp: 80, attack: 10, position: { x: 0, y: 0 }, isDead: false },
        { id: 'wolf_den_2', hp: 80, maxHp: 80, attack: 10, position: { x: 0, y: 0 }, isDead: false },
      ],
      reward: { gold: 50, xp: 40 },
    },
    {
      id: 'spider_nest', name: 'Spider Nest',
      position: snapToPassable(tiles, { x: Math.floor(4 * MAP_WIDTH / 5), y: Math.floor(2 * MAP_HEIGHT / 3) }),
      type: 'easy', activatePhase: 2, cleared: false, respawnTimer: 0,
      enemies: [
        { id: 'spider_1', hp: 80, maxHp: 80, attack: 10, position: { x: 0, y: 0 }, isDead: false },
        { id: 'spider_2', hp: 80, maxHp: 80, attack: 10, position: { x: 0, y: 0 }, isDead: false },
      ],
      reward: { gold: 50, xp: 40 },
    },
    {
      id: 'dragons_lair', name: "Dragon's Lair",
      position: snapToPassable(tiles, { x: cx, y: cy }),
      type: 'hard', activatePhase: 2, cleared: false, respawnTimer: 0,
      enemies: [
        { id: 'dragon', hp: 500, maxHp: 500, attack: 25, position: { x: 0, y: 0 }, isDead: false },
      ],
      reward: { gold: 100, xp: 80, buff: 'team_damage_15' },
    },
  ];

  // Set camp enemy positions relative to camp center
  for (const camp of neutralCamps) {
    clearArea(tiles, camp.position, 2);
    camp.enemies.forEach((e, i) => {
      e.position = {
        x: camp.position.x + (i % 2 === 0 ? -1 : 1),
        y: camp.position.y + (i < 2 ? 0 : 1),
      };
    });
  }

  // ─── WALL FEATURES ────────────────────────────────────────────
  addWallFeatures(tiles, mulberry32(seed + 4000));

  // ─── SWITCH/GATE PAIRS ────────────────────────────────────────
  const switchGateLinks = placeSwitchGates(tiles, rng);

  // ─── ENSURE CONNECTIVITY ──────────────────────────────────────
  ensureConnected(tiles, spawnP1[0], spawnP2[0]);
  ensureConnected(tiles, spawnP1[0], { x: cx, y: cy });

  // ─── CONTROL POINTS ───────────────────────────────────────────
  const cpRaw: Position[] = [
    { x: Math.floor(MAP_WIDTH / 4), y: cy },
    { x: cx, y: cy },
    { x: Math.floor(3 * MAP_WIDTH / 4), y: cy },
  ];
  const controlPointPositions = cpRaw.map(p => snapToPassable(tiles, p));
  for (const cp of controlPointPositions) {
    clearArea(tiles, cp, 2);
  }

  // ─── POI PLACEMENTS ───────────────────────────────────────────
  const poiPlacements: POIPlacement[] = [];

  // Lookouts (Phase 1)
  for (const post of scoutingPosts) {
    poiPlacements.push({ type: 'lookout', position: post.position, activatePhase: 1 });
  }

  // Healing Well (Phase 3 — center)
  const wellPos = snapToPassable(tiles, { x: cx, y: cy - 8 });
  poiPlacements.push({ type: 'healing_well', position: wellPos, activatePhase: 3 });
  // Second well
  const wellPos2 = snapToPassable(tiles, { x: cx, y: cy + 8 });
  poiPlacements.push({ type: 'healing_well', position: wellPos2, activatePhase: 3 });

  // Treasure caches (Phase 1 — spread around)
  const cacheCandidates = [
    { x: cx - 5, y: cy - 10 },
    { x: cx + 5, y: cy + 10 },
    { x: Math.floor(MAP_WIDTH / 3), y: cy - 8 },
    { x: Math.floor(2 * MAP_WIDTH / 3), y: cy + 8 },
  ];
  for (const pos of cacheCandidates) {
    poiPlacements.push({ type: 'treasure_cache', position: snapToPassable(tiles, pos), activatePhase: 1 });
  }

  // ─── NAMED ZONES ──────────────────────────────────────────────
  const zones: MapZone[] = [
    { name: 'Your Base', center: spawnP1[1], radius: 5, type: 'spawn' },
    { name: 'Enemy Base', center: spawnP2[1], radius: 5, type: 'spawn' },
    { name: 'West Mine', center: mineNodes[0].position, radius: 3, type: 'mine' },
    { name: 'East Mine', center: mineNodes[1].position, radius: 3, type: 'mine' },
    { name: 'Gold Vein', center: mineNodes[2].position, radius: 3, type: 'mine' },
    { name: 'Crystal Mine', center: mineNodes[3].position, radius: 3, type: 'mine' },
    { name: 'North Ridge', center: scoutingPosts[0].position, radius: 3, type: 'scouting_post' },
    { name: 'South Ridge', center: scoutingPosts[1].position, radius: 3, type: 'scouting_post' },
    { name: 'Your Bridge', center: towerSites[0].position, radius: 3, type: 'tower_site' },
    { name: 'Their Bridge', center: towerSites[1].position, radius: 3, type: 'tower_site' },
    { name: 'Wolf Den', center: neutralCamps[0].position, radius: 3, type: 'camp' },
    { name: 'Spider Nest', center: neutralCamps[1].position, radius: 3, type: 'camp' },
    { name: "Dragon's Lair", center: neutralCamps[2].position, radius: 4, type: 'camp' },
    { name: 'The Well', center: wellPos, radius: 2, type: 'healing_well' },
    { name: 'Center', center: { x: cx, y: cy }, radius: 6, type: 'general' },
  ];

  return {
    tiles, seed, spawnP1, spawnP2, flagP1, flagP2,
    controlPointPositions, switchGateLinks, poiPlacements,
    zones, mineNodes, towerSites, neutralCamps, scoutingPosts,
  };
}

// ─── HELPERS ──────────────────────────────────────────────────────

function clearArea(tiles: TileType[][], center: Position, radius: number) {
  for (let dy = -radius; dy <= radius; dy++) {
    for (let dx = -radius; dx <= radius; dx++) {
      const nx = center.x + dx;
      const ny = center.y + dy;
      if (nx >= 0 && nx < MAP_WIDTH && ny >= 0 && ny < MAP_HEIGHT) {
        if (!isPassable(tiles[ny][nx])) {
          tiles[ny][nx] = 'grass';
        }
      }
    }
  }
}

function placeSwitchGates(tiles: TileType[][], rng: () => number): SwitchGateLink[] {
  const links: SwitchGateLink[] = [];
  const cx = Math.floor(MAP_WIDTH / 2);
  const cy = Math.floor(MAP_HEIGHT / 2);

  const candidates: { sw: Position; gates: Position[] }[] = [
    {
      sw: { x: cx - 5, y: Math.floor(MAP_HEIGHT / 4) },
      gates: [
        { x: cx - 2, y: Math.floor(MAP_HEIGHT / 4) - 1 },
        { x: cx - 2, y: Math.floor(MAP_HEIGHT / 4) },
        { x: cx - 2, y: Math.floor(MAP_HEIGHT / 4) + 1 },
      ],
    },
    {
      sw: { x: cx + 5, y: Math.floor(3 * MAP_HEIGHT / 4) },
      gates: [
        { x: cx + 2, y: Math.floor(3 * MAP_HEIGHT / 4) - 1 },
        { x: cx + 2, y: Math.floor(3 * MAP_HEIGHT / 4) },
        { x: cx + 2, y: Math.floor(3 * MAP_HEIGHT / 4) + 1 },
      ],
    },
  ];

  for (const c of candidates) {
    if (rng() > 0.5) continue;
    const { sw, gates } = c;
    if (sw.x < 1 || sw.x >= MAP_WIDTH - 1 || sw.y < 1 || sw.y >= MAP_HEIGHT - 1) continue;
    let valid = true;
    for (const g of gates) {
      if (g.x < 0 || g.x >= MAP_WIDTH || g.y < 0 || g.y >= MAP_HEIGHT) { valid = false; break; }
    }
    if (!valid) continue;

    tiles[sw.y][sw.x] = 'switch';
    for (const g of gates) tiles[g.y][g.x] = 'gate_closed';
    links.push({ switchPos: sw, gatePositions: gates });
  }
  return links;
}

function addWallFeatures(tiles: TileType[][], rng: () => number) {
  const cx = Math.floor(MAP_WIDTH / 2);
  const cy = Math.floor(MAP_HEIGHT / 2);

  // Central horizontal barrier with gaps
  for (let x = cx - 12; x <= cx + 12; x++) {
    if (Math.abs(x - cx) <= 2) continue;
    if (x >= 0 && x < MAP_WIDTH && tiles[cy][x] !== 'path') {
      tiles[cy][x] = rng() > 0.3 ? 'rock' : 'ruins';
    }
  }

  // Partial vertical walls
  const wallXs = [Math.floor(MAP_WIDTH / 4), Math.floor(3 * MAP_WIDTH / 4)];
  for (const wx of wallXs) {
    for (let y = cy - 6; y <= cy + 6; y++) {
      if (Math.abs(y - cy) <= 2) continue;
      if (y >= 0 && y < MAP_HEIGHT && rng() > 0.4 && tiles[y][wx] !== 'path') {
        tiles[y][wx] = rng() > 0.5 ? 'rock' : 'ruins';
      }
    }
  }

  // Cover walls at strategic positions
  const coverSpots = [
    { x: cx - 8, y: cy - 8 }, { x: cx + 8, y: cy - 8 },
    { x: cx - 8, y: cy + 8 }, { x: cx + 8, y: cy + 8 },
    { x: cx - 16, y: cy - 5 }, { x: cx + 16, y: cy - 5 },
    { x: cx - 16, y: cy + 5 }, { x: cx + 16, y: cy + 5 },
  ];

  for (const pos of coverSpots) {
    if (pos.x >= 1 && pos.x < MAP_WIDTH - 1 && pos.y >= 1 && pos.y < MAP_HEIGHT - 1) {
      if (tiles[pos.y][pos.x] === 'path') continue;
      tiles[pos.y][pos.x] = rng() > 0.4 ? 'rock' : 'ruins';
      if (rng() > 0.5 && pos.y + 1 < MAP_HEIGHT && tiles[pos.y + 1][pos.x] !== 'path') {
        tiles[pos.y + 1][pos.x] = 'rock';
      }
    }
  }

  // Scattered walls
  for (let i = 0; i < 12; i++) {
    const wx = Math.floor(rng() * (MAP_WIDTH - 12)) + 6;
    const wy = Math.floor(rng() * (MAP_HEIGHT - 12)) + 6;
    if (wx < 8 || wx > MAP_WIDTH - 9) continue;
    if (tiles[wy][wx] !== 'grass' && tiles[wy][wx] !== 'flowers') continue;
    tiles[wy][wx] = 'rock';
  }
}

function isPassableTerrain(tile: TileType): boolean {
  return tile !== 'water' && tile !== 'lava' && tile !== 'rock' && tile !== 'ruins' && tile !== 'gate_closed';
}

function snapToPassable(tiles: TileType[][], pos: Position): Position {
  if (isPassable(tiles[pos.y]?.[pos.x])) return pos;
  for (let r = 1; r <= 5; r++) {
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        const nx = pos.x + dx;
        const ny = pos.y + dy;
        if (nx >= 0 && nx < MAP_WIDTH && ny >= 0 && ny < MAP_HEIGHT && isPassable(tiles[ny][nx])) {
          return { x: nx, y: ny };
        }
      }
    }
  }
  return pos;
}

function carvePath(tiles: TileType[][], x1: number, y1: number, x2: number, y2: number) {
  let x = Math.floor(x1);
  let y = Math.floor(y1);
  const ex = Math.floor(x2);
  const ey = Math.floor(y2);

  while (x !== ex || y !== ey) {
    if (y >= 0 && y < MAP_HEIGHT && x >= 0 && x < MAP_WIDTH) {
      tiles[y][x] = 'path';
    }
    if (Math.abs(ex - x) > Math.abs(ey - y)) {
      x += x < ex ? 1 : -1;
    } else {
      y += y < ey ? 1 : -1;
    }
  }
}

function ensureConnected(tiles: TileType[][], start: Position, end: Position) {
  const visited = new Set<string>();
  const queue: Position[] = [start];
  visited.add(`${start.x},${start.y}`);

  while (queue.length > 0) {
    const pos = queue.shift()!;
    if (pos.x === end.x && pos.y === end.y) return;

    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = pos.x + dx;
      const ny = pos.y + dy;
      const key = `${nx},${ny}`;
      if (nx >= 0 && nx < MAP_WIDTH && ny >= 0 && ny < MAP_HEIGHT
          && !visited.has(key) && isPassable(tiles[ny][nx])) {
        visited.add(key);
        queue.push({ x: nx, y: ny });
      }
    }
  }

  carvePath(tiles, start.x, start.y, end.x, end.y);
}

export function isPassable(tile: TileType): boolean {
  return tile !== 'water' && tile !== 'rock' && tile !== 'lava' && tile !== 'ruins' && tile !== 'gate_closed';
}

export function getMovementCost(tile: TileType): number {
  switch (tile) {
    case 'path': return 0.5;
    case 'bridge': return 0.6;
    case 'capture_point': return 0.7;
    case 'forest': return 2;
    case 'bush': return 1.5;
    case 'hill': return 1.5;
    case 'sand': return 1.3;
    case 'swamp': return 2.5;
    case 'mushroom': return 1.2;
    case 'flowers': return 0.9;
    case 'switch': return 0.8;
    case 'gate_open': return 0.5;
    default: return 1;
  }
}

// Helper to find which named zone a position is in
export function getZoneAt(zones: MapZone[], pos: Position): MapZone | null {
  for (const zone of zones) {
    const dist = Math.abs(pos.x - zone.center.x) + Math.abs(pos.y - zone.center.y);
    if (dist <= zone.radius) return zone;
  }
  return null;
}

// Helper to find a zone by name (for NL commands)
export function findZoneByName(zones: MapZone[], name: string): MapZone | null {
  const lower = name.toLowerCase();
  return zones.find(z => z.name.toLowerCase().includes(lower)) || null;
}
