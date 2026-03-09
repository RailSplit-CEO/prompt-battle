import { TileType, Position, MapZone } from '@prompt-battle/shared';

export const MAP_WIDTH = 50;
export const MAP_HEIGHT = 40;
export const TILE_SIZE = 32;

export interface GameMap {
  tiles: TileType[][];
  seed: number;
  spawnP1: Position[];
  spawnP2: Position[];
  zones: MapZone[];
}

// ─── Helpers ─────────────────────────────────────────────

function fillRect(
  tiles: TileType[][],
  c1: number, r1: number, c2: number, r2: number,
  t: TileType,
) {
  for (let r = Math.max(0, r1); r <= Math.min(MAP_HEIGHT - 1, r2); r++) {
    for (let c = Math.max(0, c1); c <= Math.min(MAP_WIDTH - 1, c2); c++) {
      tiles[r][c] = t;
    }
  }
}

function fillCircle(
  tiles: TileType[][],
  cx: number, cy: number, rad: number,
  t: TileType,
) {
  for (let r = 0; r < MAP_HEIGHT; r++) {
    for (let c = 0; c < MAP_WIDTH; c++) {
      if (Math.hypot(c - cx, r - cy) <= rad) {
        tiles[r][c] = t;
      }
    }
  }
}

// ─── Map Generation ──────────────────────────────────────
// Symmetric map: Blue base bottom-left (5,35), Red base top-right (45,5)
// Camps placed symmetrically, structures at midpoints

export function generateMap(seed: number): GameMap {
  const tiles: TileType[][] = [];

  // STEP 1: All water
  for (let r = 0; r < MAP_HEIGHT; r++) {
    tiles[r] = [];
    for (let c = 0; c < MAP_WIDTH; c++) {
      tiles[r][c] = 'water';
    }
  }

  // STEP 2: Elliptical island
  for (let r = 0; r < MAP_HEIGHT; r++) {
    for (let c = 0; c < MAP_WIDTH; c++) {
      const dx = (c - MAP_WIDTH / 2) / (MAP_WIDTH / 2);
      const dy = (r - MAP_HEIGHT / 2) / (MAP_HEIGHT / 2);
      if (Math.sqrt(dx * dx * 0.6 + dy * dy * 0.8) < 0.85) {
        tiles[r][c] = 'grass';
      }
    }
  }

  // STEP 3: Shore tiles
  for (let r = 0; r < MAP_HEIGHT; r++) {
    for (let c = 0; c < MAP_WIDTH; c++) {
      if (tiles[r][c] === 'water') {
        for (let dr = -1; dr <= 1; dr++) {
          for (let dc = -1; dc <= 1; dc++) {
            const nr = r + dr;
            const nc = c + dc;
            if (nr >= 0 && nr < MAP_HEIGHT && nc >= 0 && nc < MAP_WIDTH && tiles[nr][nc] === 'grass') {
              tiles[r][c] = 'sand';
            }
          }
        }
      }
    }
  }

  // STEP 4: Bases
  // Blue base at (5,35)
  fillCircle(tiles, 5, 35, 3, 'hill');
  fillCircle(tiles, 5, 35, 2, 'blue_base');
  // Red base at (45,5)
  fillCircle(tiles, 45, 5, 3, 'hill');
  fillCircle(tiles, 45, 5, 2, 'red_base');

  // STEP 5: Main diagonal path (base to base)
  for (let i = 0; i <= 40; i++) {
    const c = 5 + i;
    const r = Math.round(35 - i * (30 / 40));
    if (r >= 0 && r < MAP_HEIGHT && c >= 0 && c < MAP_WIDTH) {
      fillRect(tiles, c - 1, r, c + 1, r, 'path');
    }
  }

  // STEP 6: Top path (horizontal-ish)
  for (let i = 0; i <= 40; i++) {
    const c = 5 + i;
    const r = Math.round(12 + Math.sin((i / 40) * Math.PI) * 2);
    if (r >= 0 && r < MAP_HEIGHT && c >= 0 && c < MAP_WIDTH) {
      fillRect(tiles, c, r, c, r + 1, 'path');
    }
  }

  // STEP 7: Bottom path (horizontal-ish)
  for (let i = 0; i <= 40; i++) {
    const c = 5 + i;
    const r = Math.round(28 - Math.sin((i / 40) * Math.PI) * 2);
    if (r >= 0 && r < MAP_HEIGHT && c >= 0 && c < MAP_WIDTH) {
      fillRect(tiles, c, r, c, r + 1, 'path');
    }
  }

  // STEP 8: Vertical connectors
  fillRect(tiles, 4, 12, 6, 35, 'path');   // Blue side
  fillRect(tiles, 44, 5, 46, 28, 'path');   // Red side

  // STEP 9: River (perpendicular to diagonal)
  for (let i = 0; i < 30; i++) {
    const c = Math.round(14 + i * 0.75);
    const r = Math.round(5 + i * 0.9);
    if (r < MAP_HEIGHT && c < MAP_WIDTH) {
      tiles[r][c] = 'water';
      if (r + 1 < MAP_HEIGHT) tiles[r + 1][c] = 'water';
    }
  }

  // STEP 10: Bridges
  const bridges = [
    { cx: 20, cy: 13 },
    { cx: 25, cy: 20 },
    { cx: 30, cy: 26 },
  ];
  for (const b of bridges) {
    for (let dr = -1; dr <= 1; dr++) {
      for (let dc = -1; dc <= 1; dc++) {
        const r = b.cy + dr;
        const c = b.cx + dc;
        if (r >= 0 && r < MAP_HEIGHT && c >= 0 && c < MAP_WIDTH) {
          tiles[r][c] = 'bridge';
        }
      }
    }
  }

  // STEP 11: Forest patches (symmetric)
  fillCircle(tiles, 10, 28, 2.2, 'forest');  // Blue side
  fillCircle(tiles, 40, 12, 2.2, 'forest');  // Red side (mirror)
  fillCircle(tiles, 15, 20, 2, 'forest');
  fillCircle(tiles, 35, 20, 2, 'forest');
  fillCircle(tiles, 20, 30, 1.8, 'forest');
  fillCircle(tiles, 30, 10, 1.8, 'forest');
  fillCircle(tiles, 12, 14, 1.5, 'forest');
  fillCircle(tiles, 38, 26, 1.5, 'forest');

  // STEP 12: Hills for tactical positioning
  fillCircle(tiles, 18, 16, 2, 'hill');
  fillCircle(tiles, 32, 24, 2, 'hill');
  fillCircle(tiles, 25, 20, 2.5, 'hill');  // Center hill

  // STEP 13: Re-shore
  for (let r = 0; r < MAP_HEIGHT; r++) {
    for (let c = 0; c < MAP_WIDTH; c++) {
      if (tiles[r][c] === 'grass') {
        let adjWater = false;
        for (let dr = -1; dr <= 1 && !adjWater; dr++) {
          for (let dc = -1; dc <= 1 && !adjWater; dc++) {
            const nr = r + dr;
            const nc = c + dc;
            if (nr >= 0 && nr < MAP_HEIGHT && nc >= 0 && nc < MAP_WIDTH && tiles[nr][nc] === 'water') {
              adjWater = true;
            }
          }
        }
        if (adjWater) tiles[r][c] = 'sand';
      }
    }
  }

  // Ensure camp and structure positions are passable
  const allObjectivePositions = [
    // Camps from camps.ts placements
    { x: 10, y: 30 }, { x: 40, y: 10 },
    { x: 14, y: 33 }, { x: 36, y: 7 },
    { x: 12, y: 25 }, { x: 38, y: 15 },
    { x: 18, y: 28 }, { x: 32, y: 12 },
    { x: 8, y: 22 }, { x: 42, y: 18 },
    { x: 18, y: 22 }, { x: 32, y: 18 },
    { x: 22, y: 18 }, { x: 28, y: 22 },
    { x: 15, y: 18 }, { x: 35, y: 22 },
    { x: 22, y: 22 }, { x: 28, y: 18 },
    { x: 25, y: 18 }, { x: 25, y: 22 },
    // Structures
    { x: 15, y: 15 }, { x: 35, y: 25 },
    { x: 35, y: 15 }, { x: 15, y: 25 },
  ];
  for (const pos of allObjectivePositions) {
    if (pos.y >= 0 && pos.y < MAP_HEIGHT && pos.x >= 0 && pos.x < MAP_WIDTH) {
      if (tiles[pos.y][pos.x] === 'water') {
        tiles[pos.y][pos.x] = 'grass';
      }
    }
  }

  // Spawn positions (5 per team)
  const spawnP1: Position[] = [
    { x: 5, y: 35 },
    { x: 4, y: 34 },
    { x: 6, y: 34 },
    { x: 3, y: 36 },
    { x: 7, y: 36 },
  ];

  const spawnP2: Position[] = [
    { x: 45, y: 5 },
    { x: 44, y: 6 },
    { x: 46, y: 6 },
    { x: 43, y: 4 },
    { x: 47, y: 4 },
  ];

  // Named zones for camps and structures
  const zones: MapZone[] = [
    { name: 'Blue Base', center: { x: 5, y: 35 }, radius: 3, type: 'base' },
    { name: 'Red Base', center: { x: 45, y: 5 }, radius: 3, type: 'base' },
    // Camp zones (alliterative names match camp names)
    { name: 'Rowdy Rabbit Run', center: { x: 10, y: 30 }, radius: 3, type: 'camp' },
    { name: 'Pecking Parrot Perch', center: { x: 14, y: 33 }, radius: 3, type: 'camp' },
    { name: 'Wily Wolf Warren', center: { x: 12, y: 25 }, radius: 3, type: 'camp' },
    { name: 'Fierce Falcon Fort', center: { x: 18, y: 28 }, radius: 3, type: 'camp' },
    { name: 'Gentle Goat Grove', center: { x: 8, y: 22 }, radius: 3, type: 'camp' },
    { name: 'Brutal Bear Bastion', center: { x: 18, y: 22 }, radius: 3, type: 'camp' },
    { name: 'Venomous Viper Vault', center: { x: 22, y: 18 }, radius: 3, type: 'camp' },
    { name: 'Deft Deer Dell', center: { x: 15, y: 18 }, radius: 3, type: 'camp' },
    { name: 'Enormous Elephant Estate', center: { x: 22, y: 22 }, radius: 3, type: 'camp' },
    { name: 'Lethal Lion Lair', center: { x: 25, y: 18 }, radius: 3, type: 'camp' },
    // Structures
    { name: 'Pummeling Pylon Palace', center: { x: 15, y: 15 }, radius: 3, type: 'structure' },
    { name: 'Stalwart Stone Stronghold', center: { x: 35, y: 25 }, radius: 3, type: 'structure' },
    { name: 'Arcane Arrow Alcazar', center: { x: 35, y: 15 }, radius: 3, type: 'structure' },
    { name: 'Thundering Titan Tower', center: { x: 15, y: 25 }, radius: 3, type: 'structure' },
  ];

  return { tiles, seed, spawnP1, spawnP2, zones };
}

// ─── Public Utilities ────────────────────────────────────

export function isPassable(tile: TileType): boolean {
  return tile !== 'water' && tile !== 'river';
}

export function getMovementCost(tile: TileType): number {
  switch (tile) {
    case 'water': return 999;
    case 'sand': return 1.3;
    case 'path': return 0.7;
    case 'bridge': return 0.8;
    case 'hill': return 1.2;
    case 'forest': return 1.5;
    case 'grass': return 1.0;
    default: return 1.0;
  }
}

export function getZoneAt(zones: MapZone[], pos: Position): MapZone | null {
  for (const zone of zones) {
    const dist = Math.abs(pos.x - zone.center.x) + Math.abs(pos.y - zone.center.y);
    if (dist <= zone.radius) return zone;
  }
  return null;
}

export function findZoneByName(zones: MapZone[], name: string): MapZone | null {
  const lower = name.toLowerCase();
  return zones.find(z => z.name.toLowerCase().includes(lower)) || null;
}
