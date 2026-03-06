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

export const MAP_WIDTH = 40;
export const MAP_HEIGHT = 30;
export const TILE_SIZE = 32;

export interface GameMap {
  tiles: TileType[][];
  seed: number;
  spawnP1: Position[];
  spawnP2: Position[];
  flagP1: Position;   // where P1's flag sits
  flagP2: Position;   // where P2's flag sits
  controlPointPositions: Position[];
}

export function generateMap(seed: number): GameMap {
  const noise = createNoise2D(seed);
  const noise2 = createNoise2D(seed + 1000);
  const halfWidth = Math.ceil(MAP_WIDTH / 2);
  const tiles: TileType[][] = [];

  // Generate left half
  for (let y = 0; y < MAP_HEIGHT; y++) {
    tiles[y] = [];
    for (let x = 0; x < halfWidth; x++) {
      const elevation = noise(x * 0.15, y * 0.15);
      const moisture = noise2(x * 0.12, y * 0.12);

      let tile: TileType;

      if (elevation < -0.35) {
        tile = 'water';
      } else if (elevation < -0.15) {
        tile = moisture > 0.2 ? 'bush' : 'grass';
      } else if (elevation < 0.2) {
        tile = 'grass';
      } else if (elevation < 0.4) {
        tile = moisture > 0 ? 'forest' : 'grass';
      } else if (elevation < 0.6) {
        tile = 'hill';
      } else {
        tile = 'rock';
      }

      tiles[y][x] = tile;
    }
  }

  // Mirror to right half
  for (let y = 0; y < MAP_HEIGHT; y++) {
    for (let x = halfWidth; x < MAP_WIDTH; x++) {
      tiles[y][x] = tiles[y][MAP_WIDTH - 1 - x];
    }
  }

  // Carve paths from spawn to center
  carvePath(tiles, 3, MAP_HEIGHT / 2, halfWidth, MAP_HEIGHT / 2);
  carvePath(tiles, 3, MAP_HEIGHT / 4, halfWidth, MAP_HEIGHT / 2);
  carvePath(tiles, 3, (3 * MAP_HEIGHT) / 4, halfWidth, MAP_HEIGHT / 2);
  // Mirror paths
  for (let y = 0; y < MAP_HEIGHT; y++) {
    for (let x = halfWidth; x < MAP_WIDTH; x++) {
      if (tiles[y][MAP_WIDTH - 1 - x] === 'path') {
        tiles[y][x] = 'path';
      }
    }
  }

  // Flag positions - centered vertically, near each base
  const flagP1: Position = { x: 4, y: Math.floor(MAP_HEIGHT / 2) };
  const flagP2: Position = { x: MAP_WIDTH - 5, y: Math.floor(MAP_HEIGHT / 2) };

  // Spawn positions (around flag area)
  const spawnP1: Position[] = [
    { x: 2, y: Math.floor(MAP_HEIGHT / 2) - 2 },
    { x: 2, y: Math.floor(MAP_HEIGHT / 2) },
    { x: 2, y: Math.floor(MAP_HEIGHT / 2) + 2 },
  ];
  const spawnP2: Position[] = [
    { x: MAP_WIDTH - 3, y: Math.floor(MAP_HEIGHT / 2) - 2 },
    { x: MAP_WIDTH - 3, y: Math.floor(MAP_HEIGHT / 2) },
    { x: MAP_WIDTH - 3, y: Math.floor(MAP_HEIGHT / 2) + 2 },
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
  addWallFeatures(tiles, mulberry32(seed + 2000));

  // Ensure connected after walls
  ensureConnected(tiles, spawnP1[0], spawnP2[0]);
  ensureConnected(tiles, spawnP1[0], { x: Math.floor(MAP_WIDTH / 2), y: Math.floor(MAP_HEIGHT / 2) });

  // Control point positions: left, center, right
  const cpRaw: Position[] = [
    { x: Math.floor(MAP_WIDTH / 4), y: Math.floor(MAP_HEIGHT / 2) },
    { x: Math.floor(MAP_WIDTH / 2), y: Math.floor(MAP_HEIGHT / 2) },
    { x: Math.floor((3 * MAP_WIDTH) / 4), y: Math.floor(MAP_HEIGHT / 2) },
  ];
  const controlPointPositions = cpRaw.map(p => snapToPassable(tiles, p));
  // Clear surrounding terrain to grass
  for (const cp of controlPointPositions) {
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const nx = cp.x + dx;
        const ny = cp.y + dy;
        if (nx >= 0 && nx < MAP_WIDTH && ny >= 0 && ny < MAP_HEIGHT) {
          if (tiles[ny][nx] === 'water' || tiles[ny][nx] === 'rock') {
            tiles[ny][nx] = 'grass';
          }
        }
      }
    }
  }

  return { tiles, seed, spawnP1, spawnP2, flagP1, flagP2, controlPointPositions };
}

function addWallFeatures(tiles: TileType[][], rng: () => number) {
  const cx = Math.floor(MAP_WIDTH / 2);
  const cy = Math.floor(MAP_HEIGHT / 2);

  // Central horizontal barrier with a gap in the middle
  for (let x = cx - 7; x <= cx + 7; x++) {
    if (Math.abs(x - cx) <= 1) continue; // gap
    if (x >= 0 && x < MAP_WIDTH && tiles[cy][x] !== 'path') {
      tiles[cy][x] = 'rock';
    }
  }

  // Partial vertical walls at 1/4 and 3/4 width
  const quartX1 = Math.floor(MAP_WIDTH / 4);
  const quartX2 = MAP_WIDTH - 1 - quartX1;
  for (let y = cy - 4; y <= cy + 4; y++) {
    if (Math.abs(y - cy) <= 1) continue; // gap
    if (y >= 0 && y < MAP_HEIGHT) {
      if (tiles[y][quartX1] !== 'path') tiles[y][quartX1] = 'rock';
      if (tiles[y][quartX2] !== 'path') tiles[y][quartX2] = 'rock';
    }
  }

  // Small cover walls at strategic positions (L-shapes)
  const coverSpots = [
    { x: cx - 5, y: cy - 5 }, { x: cx + 5, y: cy - 5 },
    { x: cx - 5, y: cy + 5 }, { x: cx + 5, y: cy + 5 },
    { x: cx - 10, y: cy - 3 }, { x: cx + 10, y: cy - 3 },
    { x: cx - 10, y: cy + 3 }, { x: cx + 10, y: cy + 3 },
  ];

  for (const pos of coverSpots) {
    if (pos.x >= 1 && pos.x < MAP_WIDTH - 1 && pos.y >= 1 && pos.y < MAP_HEIGHT - 1) {
      if (tiles[pos.y][pos.x] === 'path') continue;
      tiles[pos.y][pos.x] = 'rock';
      // Add 1 adjacent rock for an L-shape
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

  // Extra scattered small walls for complexity
  for (let i = 0; i < 8; i++) {
    const wx = Math.floor(rng() * (MAP_WIDTH - 8)) + 4;
    const wy = Math.floor(rng() * (MAP_HEIGHT - 8)) + 4;
    // Don't place near spawns
    if (wx < 6 || wx > MAP_WIDTH - 7) continue;
    if (tiles[wy][wx] !== 'grass') continue;
    tiles[wy][wx] = 'rock';
    // Mirror
    const mx = MAP_WIDTH - 1 - wx;
    if (tiles[wy][mx] === 'grass') tiles[wy][mx] = 'rock';
  }
}

function snapToPassable(tiles: TileType[][], pos: Position): Position {
  if (isPassable(tiles[pos.y]?.[pos.x])) return pos;
  for (let r = 1; r <= 3; r++) {
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
          && !visited.has(key) && tiles[ny][nx] !== 'water' && tiles[ny][nx] !== 'rock') {
        visited.add(key);
        queue.push({ x: nx, y: ny });
      }
    }
  }

  carvePath(tiles, start.x, start.y, end.x, end.y);
}

export function isPassable(tile: TileType): boolean {
  return tile !== 'water' && tile !== 'rock';
}

export function getMovementCost(tile: TileType): number {
  switch (tile) {
    case 'path': return 0.5;
    case 'forest': return 2;
    case 'bush': return 1.5;
    case 'hill': return 1.5;
    default: return 1;
  }
}
