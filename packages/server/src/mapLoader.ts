import {
  TileType, Position, MapPhase, MineNode, TowerSite, NeutralCamp, ScoutingPost, MapZone,
} from '@prompt-battle/shared';

// --- Map types (mirrored from client MapGenerator.ts) ---

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

export const MAP_WIDTH = 80;
export const MAP_HEIGHT = 80;

export function isPassable(tile: TileType): boolean {
  return tile !== 'water' && tile !== 'rock' && tile !== 'lava' && tile !== 'ruins' && tile !== 'gate_closed';
}

// --- Seeded PRNG (mulberry32) ---

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

// --- Procedural map generation (from MapGenerator.ts) ---

function isPassableTerrain(tile: TileType): boolean {
  return tile !== 'water' && tile !== 'lava' && tile !== 'rock' && tile !== 'ruins' && tile !== 'gate_closed';
}

function genClearArea(tiles: TileType[][], center: Position, radius: number) {
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

function genSnapToPassable(tiles: TileType[][], pos: Position): Position {
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

function genCarvePath(tiles: TileType[][], x1: number, y1: number, x2: number, y2: number) {
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

function genEnsureConnected(tiles: TileType[][], start: Position, end: Position) {
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

  genCarvePath(tiles, start.x, start.y, end.x, end.y);
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

export function generateMap(seed: number): GameMap {
  const noise = createNoise2D(seed);
  const noise2 = createNoise2D(seed + 1000);
  const noise3 = createNoise2D(seed + 2000);
  const tiles: TileType[][] = [];
  const rng = mulberry32(seed + 3000);
  const cx = Math.floor(MAP_WIDTH / 2);
  const cy = Math.floor(MAP_HEIGHT / 2);

  // STEP 1: Generate LEFT half with Perlin noise, mirror rotationally
  for (let y = 0; y < MAP_HEIGHT; y++) {
    tiles[y] = [];
    for (let x = 0; x < MAP_WIDTH; x++) {
      const srcX = x < cx ? x : MAP_WIDTH - 1 - x;
      const srcY = x < cx ? y : MAP_HEIGHT - 1 - y;

      const n1 = noise(srcX * 0.12, srcY * 0.12);
      const n2 = noise2(srcX * 0.10, srcY * 0.10);
      const n3 = noise3(srcX * 0.20, srcY * 0.20);

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

  // STEP 2: Carve lanes
  genCarvePath(tiles, 4, cy, MAP_WIDTH - 5, cy);
  genCarvePath(tiles, 4, Math.floor(MAP_HEIGHT / 4), MAP_WIDTH - 5, Math.floor(MAP_HEIGHT / 4));
  genCarvePath(tiles, 4, Math.floor(3 * MAP_HEIGHT / 4), MAP_WIDTH - 5, Math.floor(3 * MAP_HEIGHT / 4));

  // Vertical connectors
  genCarvePath(tiles, Math.floor(MAP_WIDTH / 4), Math.floor(MAP_HEIGHT / 4),
    Math.floor(MAP_WIDTH / 4), Math.floor(3 * MAP_HEIGHT / 4));
  genCarvePath(tiles, Math.floor(3 * MAP_WIDTH / 4), Math.floor(MAP_HEIGHT / 4),
    Math.floor(3 * MAP_WIDTH / 4), Math.floor(3 * MAP_HEIGHT / 4));

  // Diagonal connectors to center
  genCarvePath(tiles, Math.floor(MAP_WIDTH / 3), Math.floor(MAP_HEIGHT / 4), cx, cy);
  genCarvePath(tiles, Math.floor(2 * MAP_WIDTH / 3), Math.floor(MAP_HEIGHT / 4), cx, cy);
  genCarvePath(tiles, Math.floor(MAP_WIDTH / 3), Math.floor(3 * MAP_HEIGHT / 4), cx, cy);
  genCarvePath(tiles, Math.floor(2 * MAP_WIDTH / 3), Math.floor(3 * MAP_HEIGHT / 4), cx, cy);

  // STEP 3: Place bridges
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

  // STEP 4: Named zone positions
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

  // Mine nodes
  const mineNodes: MineNode[] = [
    {
      id: 'west_mine', name: 'West Mine',
      position: genSnapToPassable(tiles, { x: 12, y: cy - 6 }),
      type: 'safe', depleted: false, goldPerSec: 3, currentGold: 300, activatePhase: 1, occupiedBy: null,
    },
    {
      id: 'east_mine', name: 'East Mine',
      position: genSnapToPassable(tiles, { x: MAP_WIDTH - 13, y: cy + 6 }),
      type: 'safe', depleted: false, goldPerSec: 3, currentGold: 300, activatePhase: 1, occupiedBy: null,
    },
    {
      id: 'gold_vein', name: 'Gold Vein',
      position: genSnapToPassable(tiles, { x: cx - 6, y: cy - 4 }),
      type: 'rich', depleted: false, goldPerSec: 5, currentGold: 500, activatePhase: 3, occupiedBy: null,
    },
    {
      id: 'crystal_mine', name: 'Crystal Mine',
      position: genSnapToPassable(tiles, { x: cx + 6, y: cy + 4 }),
      type: 'rich', depleted: false, goldPerSec: 5, currentGold: 500, activatePhase: 3, occupiedBy: null,
    },
  ];

  for (const mine of mineNodes) {
    genClearArea(tiles, mine.position, 1);
  }

  // Tower sites
  const towerSites: TowerSite[] = [
    {
      id: 'your_bridge', name: 'Your Bridge',
      position: genSnapToPassable(tiles, { x: Math.floor(MAP_WIDTH / 3), y: cy }),
      builtTower: null, occupied: false, activatePhase: 1,
    },
    {
      id: 'their_bridge', name: 'Their Bridge',
      position: genSnapToPassable(tiles, { x: Math.floor(2 * MAP_WIDTH / 3), y: cy }),
      builtTower: null, occupied: false, activatePhase: 1,
    },
    {
      id: 'north_tower', name: 'North Tower',
      position: genSnapToPassable(tiles, { x: cx, y: Math.floor(MAP_HEIGHT / 4) }),
      builtTower: null, occupied: false, activatePhase: 1,
    },
    {
      id: 'south_tower', name: 'South Tower',
      position: genSnapToPassable(tiles, { x: cx, y: Math.floor(3 * MAP_HEIGHT / 4) }),
      builtTower: null, occupied: false, activatePhase: 1,
    },
  ];

  for (const site of towerSites) {
    genClearArea(tiles, site.position, 1);
  }

  // Scouting posts
  const scoutingPosts: ScoutingPost[] = [
    {
      id: 'north_ridge', name: 'North Ridge',
      position: genSnapToPassable(tiles, { x: Math.floor(MAP_WIDTH / 6), y: Math.floor(MAP_HEIGHT / 5) }),
      capturedBy: null, visionRadius: 12,
    },
    {
      id: 'south_ridge', name: 'South Ridge',
      position: genSnapToPassable(tiles, { x: Math.floor(5 * MAP_WIDTH / 6), y: Math.floor(4 * MAP_HEIGHT / 5) }),
      capturedBy: null, visionRadius: 12,
    },
  ];

  for (const post of scoutingPosts) {
    tiles[post.position.y][post.position.x] = 'hill';
  }

  // Neutral camps
  const neutralCamps: NeutralCamp[] = [
    {
      id: 'wolf_den', name: 'Wolf Den',
      position: genSnapToPassable(tiles, { x: Math.floor(MAP_WIDTH / 5), y: Math.floor(MAP_HEIGHT / 3) }),
      type: 'easy', activatePhase: 2, cleared: false, respawnTimer: 0,
      enemies: [
        { id: 'wolf_den_1', hp: 80, maxHp: 80, attack: 10, position: { x: 0, y: 0 }, isDead: false },
        { id: 'wolf_den_2', hp: 80, maxHp: 80, attack: 10, position: { x: 0, y: 0 }, isDead: false },
      ],
      reward: { gold: 50, xp: 40 },
    },
    {
      id: 'spider_nest', name: 'Spider Nest',
      position: genSnapToPassable(tiles, { x: Math.floor(4 * MAP_WIDTH / 5), y: Math.floor(2 * MAP_HEIGHT / 3) }),
      type: 'easy', activatePhase: 2, cleared: false, respawnTimer: 0,
      enemies: [
        { id: 'spider_1', hp: 80, maxHp: 80, attack: 10, position: { x: 0, y: 0 }, isDead: false },
        { id: 'spider_2', hp: 80, maxHp: 80, attack: 10, position: { x: 0, y: 0 }, isDead: false },
      ],
      reward: { gold: 50, xp: 40 },
    },
    {
      id: 'dragons_lair', name: "Dragon's Lair",
      position: genSnapToPassable(tiles, { x: cx, y: cy }),
      type: 'hard', activatePhase: 2, cleared: false, respawnTimer: 0,
      enemies: [
        { id: 'dragon', hp: 500, maxHp: 500, attack: 25, position: { x: 0, y: 0 }, isDead: false },
      ],
      reward: { gold: 100, xp: 80, buff: 'team_damage_15' },
    },
  ];

  for (const camp of neutralCamps) {
    genClearArea(tiles, camp.position, 2);
    camp.enemies.forEach((e, i) => {
      e.position = {
        x: camp.position.x + (i % 2 === 0 ? -1 : 1),
        y: camp.position.y + (i < 2 ? 0 : 1),
      };
    });
  }

  // Wall features
  addWallFeatures(tiles, mulberry32(seed + 4000));

  // Switch/gate pairs
  const switchGateLinks = placeSwitchGates(tiles, rng);

  // Ensure connectivity
  genEnsureConnected(tiles, spawnP1[0], spawnP2[0]);
  genEnsureConnected(tiles, spawnP1[0], { x: cx, y: cy });

  // Control points
  const cpRaw: Position[] = [
    { x: Math.floor(MAP_WIDTH / 4), y: cy },
    { x: cx, y: cy },
    { x: Math.floor(3 * MAP_WIDTH / 4), y: cy },
  ];
  const controlPointPositions = cpRaw.map(p => genSnapToPassable(tiles, p));
  for (const cp of controlPointPositions) {
    genClearArea(tiles, cp, 2);
  }

  // POI placements
  const poiPlacements: POIPlacement[] = [];

  for (const post of scoutingPosts) {
    poiPlacements.push({ type: 'lookout', position: post.position, activatePhase: 1 });
  }

  const wellPos = genSnapToPassable(tiles, { x: cx, y: cy - 8 });
  poiPlacements.push({ type: 'healing_well', position: wellPos, activatePhase: 3 });
  const wellPos2 = genSnapToPassable(tiles, { x: cx, y: cy + 8 });
  poiPlacements.push({ type: 'healing_well', position: wellPos2, activatePhase: 3 });

  const cacheCandidates = [
    { x: cx - 5, y: cy - 10 },
    { x: cx + 5, y: cy + 10 },
    { x: Math.floor(MAP_WIDTH / 3), y: cy - 8 },
    { x: Math.floor(2 * MAP_WIDTH / 3), y: cy + 8 },
  ];
  for (const pos of cacheCandidates) {
    poiPlacements.push({ type: 'treasure_cache', position: genSnapToPassable(tiles, pos), activatePhase: 1 });
  }

  // Named zones
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

// --- JSON map definition types (from MapLoader.ts) ---

interface MapDef {
  name: string;
  width: number;
  height: number;
  legend?: Record<string, TileType>;
  terrain?: string[];
  useProcedural?: boolean;
  seed?: number;
  spawns: {
    player1: Position[];
    player2: Position[];
  };
  flags: {
    player1: Position;
    player2: Position;
  };
  controlPoints: { id: string; name: string; x: number; y: number; radius: number; buff: { type: string; value: number; label: string } }[];
  mines: { id: string; name: string; x: number; y: number; type: 'safe' | 'rich'; goldPerSec: number; totalGold: number; phase: MapPhase }[];
  towerSites: { id: string; name: string; x: number; y: number; phase: MapPhase }[];
  scoutingPosts: { id: string; name: string; x: number; y: number; visionRadius: number }[];
  neutralCamps: {
    id: string; name: string; x: number; y: number; type: 'easy' | 'hard'; phase: MapPhase;
    enemies: { id: string; hp: number; attack: number }[];
    reward: { gold: number; xp: number; buff?: string };
  }[];
  pois: { type: 'lookout' | 'healing_well' | 'treasure_cache'; x: number; y: number; phase: MapPhase }[];
  lanes?: { name: string; from: Position; to: Position }[];
  connectors?: { from: Position; to: Position }[];
  switchGates?: { switch: Position; gates: Position[] }[];
  wallFeatures?: {
    centerBarrier?: { y: number; xMin: number; xMax: number; gapHalfWidth: number };
    verticalWalls?: { x: number; yMin: number; yMax: number; gapHalfWidth: number }[];
    coverSpots?: Position[];
  };
  zones: { name: string; x: number; y: number; radius: number; type: string }[];
}

// --- Default legend ---

const DEFAULT_LEGEND: Record<string, TileType> = {
  '.': 'grass', 'F': 'forest', 'W': 'water', 'R': 'rock',
  'H': 'hill', 'B': 'bush', 'P': 'path', 'b': 'bridge',
  'L': 'lava', 'S': 'sand', '~': 'swamp', '*': 'flowers',
  'm': 'mushroom', 'U': 'ruins', 'G': 'gate_closed',
  'O': 'gate_open', 'X': 'switch',
};

// --- loadMapFromDef (from MapLoader.ts) ---

function loadMapFromDef(def: MapDef): GameMap {
  const w = def.width || MAP_WIDTH;
  const h = def.height || MAP_HEIGHT;
  const legend = { ...DEFAULT_LEGEND, ...def.legend };

  // --- Terrain ---
  let tiles: TileType[][];
  const hasRealTerrain = def.terrain &&
    def.terrain.length >= h &&
    !def.terrain[0].startsWith('COMMENT');

  if (hasRealTerrain) {
    tiles = parseTerrain(def.terrain!, w, h, legend);
  } else if (def.useProcedural && def.seed != null) {
    const procMap = generateMap(def.seed);
    tiles = procMap.tiles;
  } else {
    tiles = Array.from({ length: h }, () => Array(w).fill('grass'));
  }

  // --- Carve lanes & connectors ---
  if (def.lanes) {
    for (const lane of def.lanes) {
      loaderCarvePath(tiles, w, h, lane.from.x, lane.from.y, lane.to.x, lane.to.y);
    }
  }
  if (def.connectors) {
    for (const conn of def.connectors) {
      loaderCarvePath(tiles, w, h, conn.from.x, conn.from.y, conn.to.x, conn.to.y);
    }
  }

  // --- Switch/gate pairs ---
  const switchGateLinks: SwitchGateLink[] = [];
  if (def.switchGates) {
    for (const sg of def.switchGates) {
      loaderSetBounded(tiles, w, h, sg.switch.x, sg.switch.y, 'switch');
      for (const g of sg.gates) {
        loaderSetBounded(tiles, w, h, g.x, g.y, 'gate_closed');
      }
      switchGateLinks.push({ switchPos: sg.switch, gatePositions: sg.gates });
    }
  }

  // --- Wall features ---
  if (def.wallFeatures) {
    const wf = def.wallFeatures;
    if (wf.centerBarrier) {
      const cb = wf.centerBarrier;
      const cx = Math.floor(w / 2);
      for (let x = cb.xMin; x <= cb.xMax; x++) {
        if (Math.abs(x - cx) <= cb.gapHalfWidth) continue;
        if (x >= 0 && x < w && cb.y >= 0 && cb.y < h && tiles[cb.y][x] !== 'path') {
          tiles[cb.y][x] = 'rock';
        }
      }
    }
    if (wf.verticalWalls) {
      for (const vw of wf.verticalWalls) {
        const cy = Math.floor((vw.yMin + vw.yMax) / 2);
        for (let y = vw.yMin; y <= vw.yMax; y++) {
          if (Math.abs(y - cy) <= vw.gapHalfWidth) continue;
          if (vw.x >= 0 && vw.x < w && y >= 0 && y < h && tiles[y][vw.x] !== 'path') {
            tiles[y][vw.x] = 'rock';
          }
        }
      }
    }
    if (wf.coverSpots) {
      for (const pos of wf.coverSpots) {
        if (pos.x >= 0 && pos.x < w && pos.y >= 0 && pos.y < h && tiles[pos.y][pos.x] !== 'path') {
          tiles[pos.y][pos.x] = 'rock';
        }
      }
    }
  }

  // --- Clear spawn areas ---
  const allClearPositions = [...def.spawns.player1, ...def.spawns.player2, def.flags.player1, def.flags.player2];
  for (const s of allClearPositions) {
    loaderClearArea(tiles, w, h, s, 1);
  }

  // --- Control points ---
  const controlPointDefs: ControlPointDef[] = [];
  const controlPointPositions: Position[] = [];
  for (const cp of def.controlPoints) {
    const pos = loaderSnapToPassable(tiles, w, h, { x: cp.x, y: cp.y });
    const r = cp.radius || 2;
    controlPointPositions.push(pos);
    controlPointDefs.push({
      id: cp.id,
      name: cp.name,
      position: pos,
      radius: r,
      buff: cp.buff as ControlPointDef['buff'],
    });
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (dx * dx + dy * dy > r * r) continue;
        const nx = pos.x + dx;
        const ny = pos.y + dy;
        if (nx >= 0 && nx < w && ny >= 0 && ny < h) {
          tiles[ny][nx] = 'capture_point';
        }
      }
    }
  }

  // --- Mines ---
  const mineNodes = def.mines.map(m => {
    const pos = loaderSnapToPassable(tiles, w, h, { x: m.x, y: m.y });
    loaderClearArea(tiles, w, h, pos, 1);
    return {
      id: m.id, name: m.name, position: pos,
      type: m.type as 'safe' | 'rich', depleted: false,
      goldPerSec: m.goldPerSec, currentGold: m.totalGold,
      activatePhase: m.phase as MapPhase, occupiedBy: null,
    };
  });

  // --- Tower sites ---
  const towerSites = def.towerSites.map(t => {
    const pos = loaderSnapToPassable(tiles, w, h, { x: t.x, y: t.y });
    loaderClearArea(tiles, w, h, pos, 1);
    return {
      id: t.id, name: t.name, position: pos,
      builtTower: null, occupied: false, activatePhase: t.phase as MapPhase,
    };
  });

  // --- Scouting posts ---
  const scoutingPosts = def.scoutingPosts.map(sp => {
    const pos = loaderSnapToPassable(tiles, w, h, { x: sp.x, y: sp.y });
    tiles[pos.y][pos.x] = 'hill';
    return { id: sp.id, name: sp.name, position: pos, capturedBy: null, visionRadius: sp.visionRadius };
  });

  // --- Neutral camps ---
  const neutralCamps = def.neutralCamps.map(c => {
    const pos = loaderSnapToPassable(tiles, w, h, { x: c.x, y: c.y });
    loaderClearArea(tiles, w, h, pos, 2);
    const enemies = c.enemies.map((e, i) => ({
      id: e.id, hp: e.hp, maxHp: e.hp, attack: e.attack,
      position: { x: pos.x + (i % 2 === 0 ? -1 : 1), y: pos.y + (i < 2 ? 0 : 1) },
      isDead: false,
    }));
    return {
      id: c.id, name: c.name, position: pos,
      type: c.type as 'easy' | 'hard', activatePhase: c.phase as MapPhase,
      cleared: false, respawnTimer: 0, enemies,
      reward: c.reward,
    };
  });

  // --- POIs ---
  const poiPlacements: POIPlacement[] = def.pois.map(p => ({
    type: p.type,
    position: loaderSnapToPassable(tiles, w, h, { x: p.x, y: p.y }),
    activatePhase: p.phase,
  }));

  // --- Zones ---
  const zones = def.zones.map(z => ({
    name: z.name,
    center: { x: z.x, y: z.y },
    radius: z.radius,
    type: z.type as any,
  }));

  // --- Ensure connectivity (only for procedural maps) ---
  if (def.useProcedural) {
    const sp1 = def.spawns.player1[0];
    const sp2 = def.spawns.player2[0];
    const center = { x: Math.floor(w / 2), y: Math.floor(h / 2) };
    loaderEnsureConnected(tiles, w, h, sp1, sp2);
    loaderEnsureConnected(tiles, w, h, sp1, center);
  }

  return {
    tiles,
    seed: def.seed || 0,
    spawnP1: def.spawns.player1,
    spawnP2: def.spawns.player2,
    flagP1: def.flags.player1,
    flagP2: def.flags.player2,
    controlPointPositions,
    controlPointDefs,
    switchGateLinks,
    poiPlacements,
    zones,
    mineNodes,
    towerSites,
    neutralCamps,
    scoutingPosts,
  };
}

// --- Loader helpers ---

function parseTerrain(rows: string[], w: number, h: number, legend: Record<string, TileType>): TileType[][] {
  const tiles: TileType[][] = [];
  for (let y = 0; y < h; y++) {
    tiles[y] = [];
    const row = rows[y] || '';
    for (let x = 0; x < w; x++) {
      const ch = row[x] || '.';
      tiles[y][x] = legend[ch] || 'grass';
    }
  }
  return tiles;
}

function loaderSetBounded(tiles: TileType[][], w: number, h: number, x: number, y: number, tile: TileType) {
  if (x >= 0 && x < w && y >= 0 && y < h) tiles[y][x] = tile;
}

function loaderClearArea(tiles: TileType[][], w: number, h: number, center: Position, radius: number) {
  for (let dy = -radius; dy <= radius; dy++) {
    for (let dx = -radius; dx <= radius; dx++) {
      const nx = center.x + dx;
      const ny = center.y + dy;
      if (nx >= 0 && nx < w && ny >= 0 && ny < h && !isPassable(tiles[ny][nx])) {
        tiles[ny][nx] = 'grass';
      }
    }
  }
}

function loaderSnapToPassable(tiles: TileType[][], w: number, h: number, pos: Position): Position {
  if (pos.y >= 0 && pos.y < h && pos.x >= 0 && pos.x < w && isPassable(tiles[pos.y][pos.x])) return pos;
  for (let r = 1; r <= 5; r++) {
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        const nx = pos.x + dx;
        const ny = pos.y + dy;
        if (nx >= 0 && nx < w && ny >= 0 && ny < h && isPassable(tiles[ny][nx])) {
          return { x: nx, y: ny };
        }
      }
    }
  }
  return pos;
}

function loaderCarvePath(tiles: TileType[][], w: number, h: number, x1: number, y1: number, x2: number, y2: number) {
  let x = Math.floor(x1);
  let y = Math.floor(y1);
  const ex = Math.floor(x2);
  const ey = Math.floor(y2);
  while (x !== ex || y !== ey) {
    if (y >= 0 && y < h && x >= 0 && x < w) tiles[y][x] = 'path';
    if (Math.abs(ex - x) > Math.abs(ey - y)) x += x < ex ? 1 : -1;
    else y += y < ey ? 1 : -1;
  }
}

function loaderEnsureConnected(tiles: TileType[][], w: number, h: number, start: Position, end: Position) {
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
      if (nx >= 0 && nx < w && ny >= 0 && ny < h && !visited.has(key) && isPassable(tiles[ny][nx])) {
        visited.add(key);
        queue.push({ x: nx, y: ny });
      }
    }
  }
  loaderCarvePath(tiles, w, h, start.x, start.y, end.x, end.y);
}

// --- Default map definition (inlined from packages/client/src/map/maps/default.json) ---

const defaultMapDef: MapDef = {
  name: "King's Valley",
  width: 80,
  height: 80,
  legend: {
    ".": "grass",
    "F": "forest",
    "W": "water",
    "R": "rock",
    "H": "hill",
    "B": "bush",
    "P": "path",
    "b": "bridge",
    "L": "lava",
    "S": "sand",
    "~": "swamp",
    "*": "flowers",
    "m": "mushroom",
    "U": "ruins",
    "G": "gate_closed",
    "O": "gate_open",
    "X": "switch",
    "C": "capture_point",
  },
  terrain: [
    ".RRRRRRRRR..........RRRRRRRRRRRR................................................",
    "...RRRRRRR............RRRRRRRR..........RRRR....................................",
    ".....RRRR.............RRRRRRRR........RRRRR.SSS.................................",
    ".......................RRRRRR........RRRRR.SSSSS................................",
    "........................RRRR........RRRRR.SSSSSSSSSSSSSSSSSSSSSSSSSSSSS.........",
    "........................RRRR........RRRRR.SSSSSSSSSSSSSSSSSSSSSSSSSSSSSSSSSS....",
    "........................RRRR..........RRR.SSSSSSSSSSSSSSSSSSSSSSSSSSSSSSSSSS....",
    ".........SSSSS...........RR............RRR.SSSSS...................SSSSSSSSS....",
    "........SSSSSSS..........RR............RRRR.SSS.................SSSSSSSSSSS.....",
    ".......SSSSSSSSS......................RRRRRR..................SSSSSSSSS.SSS.....",
    ".......SSSSSSSSS.......................RRR...................SSSSSSSS...SSS.....",
    ".......SSSSSSSSSR..........................................SSSSSSSS.....SSS.....",
    ".......SSSSSSSSSRR..........WWWWW........................SSSSSSSS.......SSS.....",
    ".......SSSSSSSSSRR.......WWWWWWWW......................SSSSSSSS.........SSS.....",
    ".......SSSSSSSSRRR......WWWWWWWWW...................SSSSSSSSSS..........SSS.....",
    ".......SSSSSSSRRR...........WWWW..................SSSSSSSSSS............SSS.....",
    ".......SSS.RRRRRR................................SSSSSSSS...............SSS.....",
    "......SSSS.RRRRRR..............................SSSSSSSS.................SSS.....",
    "......SSSS..RRRR..............................SSSSSSS.........RRRR......SSS.....",
    "......SSSS....RR.............................SSSSSS..........RRRRRR.....SSS.....",
    "......SSS..................................SSSSSSS.............RRRR.....SSS.....",
    "......SSS................................SSSSSSSS................RRR....SSS.....",
    "......SSS..............................SSSSSSSS...................RR....SSS.....",
    "......SSS.............................SSSSSSSS....................RRR...SSS.....",
    "......SSS.............RR............SSSSSSSS......................RRR...SSS.....",
    "......SSS............RRR...........SSSSSSS.........................RR...SSS.....",
    "......SSS...........RRRR..........SSSSSSS..........................R....SSS.....",
    "......SSS..........RRRR..........SSSSSS.................................SSS.....",
    "......SSS..........RRRR.........SSSSSS..................................SSS.....",
    "......SSS..........RRRR.....SSSSSSSSS...................................SSS.....",
    "......SSS..........RRR....SSSSSSSSSS....................................SSS.....",
    "......SSS..........RRR...SSSSSSSSSS.....................................SSS.....",
    "......SSS..........RRR...SSSSSSSSSS.....................................SSS.....",
    "......SSS.........RRRR..SSSSSSSSSSS.....................................SSS.....",
    "......SSS.........RRRR..SSSSSSSSSSS.....................................SSS.....",
    "......SSS.........RRRR..SSSSSSSSSSS..........RRRRRRRRRR.................SSS.....",
    ".....SSSS.........RRRR...SSSSSSSSS.........RRRRRRRRRRRRRRR..............SSS.....",
    ".....SSSS.........RRRR...SSSSSSSSS......RRRRRRRRRRRRRRRRRRR.............SSS.....",
    ".....SSSS..........RRRR...SSSSSSS.......RRRRRRRR.....RRRRRRR............SSS.....",
    ".....SSS...........RRRRR....SSS......RRRRRRRRR.........RRRRRR...........SSS.....",
    ".....SSS...........RRRRRR.........RRRRRRRRR......SSS....RRRRR...........SSS.....",
    ".....SSS............RRRRRRR.....RRRRRRRR.......SSSSSSS...RRRR..........SSSS.....",
    ".....SSS.............RRRRRRRRRRRRRRRRRRR......SSSSSSSSS...RRRR.........SSSS.....",
    ".....SSS..............RRRRRRRRRRRRRRR.........SSSSSSSSS...RRRR.........SSSS.....",
    ".....SSS.................RRRRRRRRRR..........SSSSSSSSSSS..RRRR.........SSS......",
    ".....SSS.....................................SSSSSSSSSSS..RRRR.........SSS......",
    ".....SSS.....................................SSSSSSSSSSS..RRRR.........SSS......",
    ".....SSS.....................................SSSSSSSSSS...RRR..........SSS......",
    ".....SSS.....................................SSSSSSSSSS...RRR..........SSS......",
    ".....SSS....................................SSSSSSSSSS....RRR..........SSS......",
    ".....SSS...................................SSSSSSSSS.....RRRR..........SSS......",
    ".....SSS..................................SSSSSS.........RRRR..........SSS......",
    ".....SSS.................................SSSSSS..........RRRR..........SSS......",
    ".....SSS....R..........................SSSSSSS..........RRRR...........SSS......",
    ".....SSS...RR.........................SSSSSSS...........RRR............SSS......",
    ".....SSS...RRR......................SSSSSSSS............RR.............SSS......",
    ".....SSS...RRR....................SSSSSSSS.............................SSS......",
    ".....SSS....RR...................SSSSSSSS..............................SSS......",
    ".....SSS....RRR................SSSSSSSS................................SSS......",
    ".....SSS.....RRRR.............SSSSSSS..................................SSS......",
    ".....SSS.....RRRRRR..........SSSSSS.............................RR....SSSS......",
    ".....SSS......RRRR.........SSSSSSS..............................RRRR..SSSS......",
    ".....SSS.................SSSSSSSS..............................RRRRRR.SSSS......",
    ".....SSS...............SSSSSSSS................................RRRRRR.SSS.......",
    ".....SSS............SSSSSSSSSS..................WWWW...........RRRSSSSSSS.......",
    ".....SSS..........SSSSSSSSSS...................WWWWWWWWW......RRRSSSSSSSS.......",
    ".....SSS.........SSSSSSSS......................WWWWWWWW.......RRSSSSSSSSS.......",
    ".....SSS.......SSSSSSSS........................WWWWW..........RRSSSSSSSSS.......",
    ".....SSS.....SSSSSSSS..........................................RSSSSSSSSS.......",
    ".....SSS...SSSSSSSS...................RRR.......................SSSSSSSSS.......",
    ".....SSS.SSSSSSSSS..................RRRRRR......................SSSSSSSSS.......",
    ".....SSSSSSSSSSS.................SSS.RRRR............RR..........SSSSSSS........",
    "....SSSSSSSSS...................SSSSS.RRR............RR...........SSSSS.........",
    "....SSSSSSSSSSSSSSSSSSSSSSSSSSSSSSSSSS.RRR..........RRRR........................",
    "....SSSSSSSSSSSSSSSSSSSSSSSSSSSSSSSSSS.RRRRR........RRRR........................",
    ".........SSSSSSSSSSSSSSSSSSSSSSSSSSSSS.RRRRR........RRRR........................",
    "................................SSSSS.RRRRR........RRRRRR.......................",
    ".................................SSS.RRRRR........RRRRRRRR.............RRRR.....",
    "....................................RRRR..........RRRRRRRR............RRRRRRR...",
    "................................................RRRRRRRRRRRR..........RRRRRRRRR.",
  ],
  useProcedural: false,
  seed: 42,
  spawns: {
    player1: [
      { x: 3, y: 74 },
      { x: 3, y: 76 },
      { x: 5, y: 74 },
      { x: 5, y: 76 },
      { x: 7, y: 75 },
    ],
    player2: [
      { x: 76, y: 3 },
      { x: 76, y: 5 },
      { x: 74, y: 3 },
      { x: 74, y: 5 },
      { x: 72, y: 4 },
    ],
  },
  flags: {
    player1: { x: -1, y: -1 },
    player2: { x: -1, y: -1 },
  },
  controlPoints: [
    { id: "cp_1772834414692", name: "D", x: 68, y: 68, radius: 4, buff: { type: "damage", value: 1.15, label: "+15% Damage" } },
    { id: "cp_1772834448098", name: "C", x: 50, y: 45, radius: 5, buff: { type: "damage", value: 1.15, label: "+15% Damage" } },
    { id: "cp_1772834470258", name: "B", x: 29, y: 34, radius: 5, buff: { type: "damage", value: 1.15, label: "+15% Damage" } },
    { id: "cp_1772834525809", name: "L", x: 45, y: 5, radius: 3, buff: { type: "damage", value: 1.15, label: "+15% Damage" } },
    { id: "cp_1772834923769", name: "M", x: 34, y: 74, radius: 3, buff: { type: "damage", value: 1.15, label: "+15% Damage" } },
    { id: "cp_1772834966593", name: "A", x: 11, y: 11, radius: 4, buff: { type: "damage", value: 1.15, label: "+15% Damage" } },
  ],
  mines: [],
  towerSites: [],
  scoutingPosts: [],
  neutralCamps: [],
  pois: [],
  lanes: [],
  connectors: [],
  switchGates: [],
  wallFeatures: {},
  zones: [],
};

// --- Public API ---

export function loadMap(): GameMap {
  return loadMapFromDef(defaultMapDef);
}
