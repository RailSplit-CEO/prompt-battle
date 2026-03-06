import { TileType, Position, MapPhase } from '@prompt-battle/shared';
import {
  GameMap, MAP_WIDTH, MAP_HEIGHT, SwitchGateLink, POIPlacement,
  ControlPointDef, isPassable, generateMap,
} from './MapGenerator';

// ─── JSON map definition types ──────────────────────────────────

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

// ─── Default legend ─────────────────────────────────────────────

const DEFAULT_LEGEND: Record<string, TileType> = {
  '.': 'grass', 'F': 'forest', 'W': 'water', 'R': 'rock',
  'H': 'hill', 'B': 'bush', 'P': 'path', 'b': 'bridge',
  'L': 'lava', 'S': 'sand', '~': 'swamp', '*': 'flowers',
  'm': 'mushroom', 'U': 'ruins', 'G': 'gate_closed',
  'O': 'gate_open', 'X': 'switch',
};

// ─── Loader ─────────────────────────────────────────────────────

export function loadMapFromDef(def: MapDef): GameMap {
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
    // Use procedural generation for terrain only, then override placements
    const procMap = generateMap(def.seed);
    tiles = procMap.tiles;
  } else {
    // Default to all grass
    tiles = Array.from({ length: h }, () => Array(w).fill('grass'));
  }

  // --- Carve lanes & connectors ---
  if (def.lanes) {
    for (const lane of def.lanes) {
      carvePath(tiles, w, h, lane.from.x, lane.from.y, lane.to.x, lane.to.y);
    }
  }
  if (def.connectors) {
    for (const conn of def.connectors) {
      carvePath(tiles, w, h, conn.from.x, conn.from.y, conn.to.x, conn.to.y);
    }
  }

  // --- Switch/gate pairs ---
  const switchGateLinks: SwitchGateLink[] = [];
  if (def.switchGates) {
    for (const sg of def.switchGates) {
      setBounded(tiles, w, h, sg.switch.x, sg.switch.y, 'switch');
      for (const g of sg.gates) {
        setBounded(tiles, w, h, g.x, g.y, 'gate_closed');
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
    clearArea(tiles, w, h, s, 1);
  }

  // --- Control points ---
  const controlPointDefs: ControlPointDef[] = [];
  const controlPointPositions: Position[] = [];
  for (const cp of def.controlPoints) {
    const pos = snapToPassable(tiles, w, h, { x: cp.x, y: cp.y });
    const r = cp.radius || 2;
    controlPointPositions.push(pos);
    controlPointDefs.push({
      id: cp.id,
      name: cp.name,
      position: pos,
      radius: r,
      buff: cp.buff as ControlPointDef['buff'],
    });
    // Clear the area and paint capture_point tiles
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (dx * dx + dy * dy > r * r) continue; // circular shape
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
    const pos = snapToPassable(tiles, w, h, { x: m.x, y: m.y });
    clearArea(tiles, w, h, pos, 1);
    return {
      id: m.id, name: m.name, position: pos,
      type: m.type as 'safe' | 'rich', depleted: false,
      goldPerSec: m.goldPerSec, currentGold: m.totalGold,
      activatePhase: m.phase as MapPhase, occupiedBy: null,
    };
  });

  // --- Tower sites ---
  const towerSites = def.towerSites.map(t => {
    const pos = snapToPassable(tiles, w, h, { x: t.x, y: t.y });
    clearArea(tiles, w, h, pos, 1);
    return {
      id: t.id, name: t.name, position: pos,
      builtTower: null, occupied: false, activatePhase: t.phase as MapPhase,
    };
  });

  // --- Scouting posts ---
  const scoutingPosts = def.scoutingPosts.map(sp => {
    const pos = snapToPassable(tiles, w, h, { x: sp.x, y: sp.y });
    tiles[pos.y][pos.x] = 'hill';
    return { id: sp.id, name: sp.name, position: pos, capturedBy: null, visionRadius: sp.visionRadius };
  });

  // --- Neutral camps ---
  const neutralCamps = def.neutralCamps.map(c => {
    const pos = snapToPassable(tiles, w, h, { x: c.x, y: c.y });
    clearArea(tiles, w, h, pos, 2);
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
    position: snapToPassable(tiles, w, h, { x: p.x, y: p.y }),
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
    ensureConnected(tiles, w, h, sp1, sp2);
    ensureConnected(tiles, w, h, sp1, center);
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

// ─── Helpers ────────────────────────────────────────────────────

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

function setBounded(tiles: TileType[][], w: number, h: number, x: number, y: number, tile: TileType) {
  if (x >= 0 && x < w && y >= 0 && y < h) tiles[y][x] = tile;
}

function clearArea(tiles: TileType[][], w: number, h: number, center: Position, radius: number) {
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

function snapToPassable(tiles: TileType[][], w: number, h: number, pos: Position): Position {
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

function carvePath(tiles: TileType[][], w: number, h: number, x1: number, y1: number, x2: number, y2: number) {
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

function ensureConnected(tiles: TileType[][], w: number, h: number, start: Position, end: Position) {
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
  carvePath(tiles, w, h, start.x, start.y, end.x, end.y);
}
