import { TileType, Position } from '@prompt-battle/shared';

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
export const MAP_HEIGHT = 60;
export const TILE_SIZE = 32;

export interface SwitchGateLink {
  switchPos: Position;
  gatePositions: Position[];
}

export interface POIPlacement {
  type: 'lookout' | 'healing_well' | 'treasure_cache';
  position: Position;
}

export interface GameMap {
  tiles: TileType[][];
  seed: number;
  spawnP1: Position[];
  spawnP2: Position[];
  flagP1: Position;
  flagP2: Position;
  controlPointPositions: Position[];
  switchGateLinks: SwitchGateLink[];
  poiPlacements: POIPlacement[];
}

export function generateMap(seed: number): GameMap {
  const noise = createNoise2D(seed);
  const noise2 = createNoise2D(seed + 1000);
  const noise3 = createNoise2D(seed + 2000);
  // Different noise for right side = asymmetric terrain
  const noiseR = createNoise2D(seed + 5000);
  const noise2R = createNoise2D(seed + 6000);
  const noise3R = createNoise2D(seed + 7000);
  const tiles: TileType[][] = [];
  const rng = mulberry32(seed + 3000);
  const cx = Math.floor(MAP_WIDTH / 2);

  // Generate full map - left and right sides use different noise for asymmetry
  for (let y = 0; y < MAP_HEIGHT; y++) {
    tiles[y] = [];
    for (let x = 0; x < MAP_WIDTH; x++) {
      // Use different noise sources for each side
      const isLeft = x < cx;
      const n1 = isLeft ? noise(x * 0.12, y * 0.12) : noiseR(x * 0.12, y * 0.12);
      const n2 = isLeft ? noise2(x * 0.10, y * 0.10) : noise2R(x * 0.10, y * 0.10);
      const n3 = isLeft ? noise3(x * 0.20, y * 0.20) : noise3R(x * 0.20, y * 0.20);

      // Center danger gradient: more lava/rock near center
      const distFromCenter = Math.abs(x - cx) / cx; // 0 at center, 1 at edges
      const centerDanger = (1 - distFromCenter) * 0.15; // raises elevation near center

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

  const cy = Math.floor(MAP_HEIGHT / 2);

  // Carve lanes - 3 horizontal + vertical connectors
  carvePath(tiles, 4, cy, MAP_WIDTH - 5, cy);                           // mid lane
  carvePath(tiles, 4, Math.floor(MAP_HEIGHT / 4), MAP_WIDTH - 5, Math.floor(MAP_HEIGHT / 4));  // top lane
  carvePath(tiles, 4, Math.floor(3 * MAP_HEIGHT / 4), MAP_WIDTH - 5, Math.floor(3 * MAP_HEIGHT / 4)); // bot lane

  // Vertical connectors on both sides
  carvePath(tiles, Math.floor(MAP_WIDTH / 4), Math.floor(MAP_HEIGHT / 4),
    Math.floor(MAP_WIDTH / 4), Math.floor(3 * MAP_HEIGHT / 4));
  carvePath(tiles, Math.floor(3 * MAP_WIDTH / 4), Math.floor(MAP_HEIGHT / 4),
    Math.floor(3 * MAP_WIDTH / 4), Math.floor(3 * MAP_HEIGHT / 4));

  // Diagonal connectors for more pathing options
  carvePath(tiles, Math.floor(MAP_WIDTH / 3), Math.floor(MAP_HEIGHT / 4),
    cx, cy);
  carvePath(tiles, Math.floor(2 * MAP_WIDTH / 3), Math.floor(MAP_HEIGHT / 4),
    cx, cy);
  carvePath(tiles, Math.floor(MAP_WIDTH / 3), Math.floor(3 * MAP_HEIGHT / 4),
    cx, cy);
  carvePath(tiles, Math.floor(2 * MAP_WIDTH / 3), Math.floor(3 * MAP_HEIGHT / 4),
    cx, cy);

  // Place bridges over water/lava on paths
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

  // Flag positions (legacy, not used in domination but kept for type compat)
  const flagP1: Position = { x: 6, y: cy };
  const flagP2: Position = { x: MAP_WIDTH - 7, y: cy };

  // Spawn positions - spread vertically
  const spawnP1: Position[] = [
    { x: 3, y: cy - 4 },
    { x: 3, y: cy },
    { x: 3, y: cy + 4 },
  ];
  const spawnP2: Position[] = [
    { x: MAP_WIDTH - 4, y: cy - 4 },
    { x: MAP_WIDTH - 4, y: cy },
    { x: MAP_WIDTH - 4, y: cy + 4 },
  ];

  // Clear spawn and flag areas
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

  // Add wall features for strategic gameplay
  addWallFeatures(tiles, mulberry32(seed + 4000));

  // Place switch-gate pairs
  const switchGateLinks = placeSwitchGates(tiles, rng);

  // Ensure connectivity
  ensureConnected(tiles, spawnP1[0], spawnP2[0]);
  ensureConnected(tiles, spawnP1[0], { x: cx, y: cy });

  // Control point positions: left, center (worth 2x), right
  // Center CP in the middle, side CPs at 1/4 and 3/4
  const cpRaw: Position[] = [
    { x: Math.floor(MAP_WIDTH / 4), y: cy },
    { x: cx, y: cy },
    { x: Math.floor(3 * MAP_WIDTH / 4), y: cy },
  ];
  const controlPointPositions = cpRaw.map(p => snapToPassable(tiles, p));
  for (const cp of controlPointPositions) {
    for (let dy = -2; dy <= 2; dy++) {
      for (let dx = -2; dx <= 2; dx++) {
        const nx = cp.x + dx;
        const ny = cp.y + dy;
        if (nx >= 0 && nx < MAP_WIDTH && ny >= 0 && ny < MAP_HEIGHT) {
          if (!isPassable(tiles[ny][nx])) {
            tiles[ny][nx] = 'grass';
          }
        }
      }
    }
  }

  // ─── POI Placement ─────────────────────────────────────────────
  const poiPlacements: POIPlacement[] = [];

  // Lookout posts: 2 on each side, elevated positions (near hills)
  const lookoutCandidates = [
    { x: Math.floor(MAP_WIDTH / 6), y: Math.floor(MAP_HEIGHT / 4) },
    { x: Math.floor(MAP_WIDTH / 6), y: Math.floor(3 * MAP_HEIGHT / 4) },
    { x: Math.floor(5 * MAP_WIDTH / 6), y: Math.floor(MAP_HEIGHT / 4) },
    { x: Math.floor(5 * MAP_WIDTH / 6), y: Math.floor(3 * MAP_HEIGHT / 4) },
  ];
  for (const pos of lookoutCandidates) {
    const snapped = snapToPassable(tiles, pos);
    tiles[snapped.y][snapped.x] = 'hill'; // lookouts are on hills
    poiPlacements.push({ type: 'lookout', position: snapped });
  }

  // Healing wells: 1 near each team's side, slightly forward
  const wellCandidates = [
    { x: Math.floor(MAP_WIDTH / 5), y: cy },
    { x: Math.floor(4 * MAP_WIDTH / 5), y: cy },
    { x: cx, y: Math.floor(MAP_HEIGHT / 5) },
    { x: cx, y: Math.floor(4 * MAP_HEIGHT / 5) },
  ];
  for (const pos of wellCandidates) {
    const snapped = snapToPassable(tiles, pos);
    poiPlacements.push({ type: 'healing_well', position: snapped });
  }

  // Treasure caches: mostly center, some off to sides — risk/reward gradient
  const cacheCandidates = [
    // Center area (best loot, highest risk)
    { x: cx - 3, y: cy - 5 },
    { x: cx + 3, y: cy + 5 },
    { x: cx, y: Math.floor(MAP_HEIGHT / 4) },
    { x: cx, y: Math.floor(3 * MAP_HEIGHT / 4) },
    // Off-center (still good, moderate risk)
    { x: Math.floor(MAP_WIDTH / 3), y: cy - 8 },
    { x: Math.floor(2 * MAP_WIDTH / 3), y: cy + 8 },
  ];
  for (const pos of cacheCandidates) {
    const snapped = snapToPassable(tiles, pos);
    poiPlacements.push({ type: 'treasure_cache', position: snapped });
  }

  return { tiles, seed, spawnP1, spawnP2, flagP1, flagP2, controlPointPositions, switchGateLinks, poiPlacements };
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
    {
      sw: { x: cx - 10, y: cy },
      gates: [
        { x: cx - 7, y: cy - 2 },
        { x: cx - 7, y: cy - 1 },
      ],
    },
    {
      sw: { x: cx + 10, y: cy },
      gates: [
        { x: cx + 7, y: cy + 1 },
        { x: cx + 7, y: cy + 2 },
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
    for (const g of gates) {
      tiles[g.y][g.x] = 'gate_closed';
    }

    links.push({ switchPos: sw, gatePositions: gates });
  }

  return links;
}

function addWallFeatures(tiles: TileType[][], rng: () => number) {
  const cx = Math.floor(MAP_WIDTH / 2);
  const cy = Math.floor(MAP_HEIGHT / 2);

  // Central horizontal barrier with gaps
  for (let x = cx - 12; x <= cx + 12; x++) {
    if (Math.abs(x - cx) <= 2) continue; // gap in middle
    if (x >= 0 && x < MAP_WIDTH && tiles[cy][x] !== 'path') {
      tiles[cy][x] = rng() > 0.3 ? 'rock' : 'ruins';
    }
  }

  // Partial vertical walls at strategic positions
  const wallXs = [
    Math.floor(MAP_WIDTH / 4),
    Math.floor(3 * MAP_WIDTH / 4),
    Math.floor(MAP_WIDTH / 3),
    Math.floor(2 * MAP_WIDTH / 3),
  ];
  for (const wx of wallXs) {
    for (let y = cy - 6; y <= cy + 6; y++) {
      if (Math.abs(y - cy) <= 2) continue;
      if (y >= 0 && y < MAP_HEIGHT && rng() > 0.4) {
        if (tiles[y][wx] !== 'path') tiles[y][wx] = rng() > 0.5 ? 'rock' : 'ruins';
      }
    }
  }

  // Cover walls at strategic positions (L-shapes)
  const coverSpots = [
    { x: cx - 8, y: cy - 8 }, { x: cx + 8, y: cy - 8 },
    { x: cx - 8, y: cy + 8 }, { x: cx + 8, y: cy + 8 },
    { x: cx - 16, y: cy - 5 }, { x: cx + 16, y: cy - 5 },
    { x: cx - 16, y: cy + 5 }, { x: cx + 16, y: cy + 5 },
    { x: cx - 12, y: cy - 12 }, { x: cx + 12, y: cy + 12 },
  ];

  for (const pos of coverSpots) {
    if (pos.x >= 1 && pos.x < MAP_WIDTH - 1 && pos.y >= 1 && pos.y < MAP_HEIGHT - 1) {
      if (tiles[pos.y][pos.x] === 'path') continue;
      tiles[pos.y][pos.x] = rng() > 0.4 ? 'rock' : 'ruins';
      if (rng() > 0.5) {
        if (pos.y + 1 < MAP_HEIGHT && tiles[pos.y + 1][pos.x] !== 'path') tiles[pos.y + 1][pos.x] = 'rock';
      } else {
        const dx = pos.x < cx ? 1 : -1;
        if (pos.x + dx >= 0 && pos.x + dx < MAP_WIDTH && tiles[pos.y][pos.x + dx] !== 'path') {
          tiles[pos.y][pos.x + dx] = 'rock';
        }
      }
    }
  }

  // Scattered walls
  for (let i = 0; i < 16; i++) {
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
