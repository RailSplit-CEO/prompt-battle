// ═══════════════════════════════════════════════════════════════
// AUTO-TILE RESOLVER — Pure-logic bitmask auto-tiling
// ═══════════════════════════════════════════════════════════════
//
// Given a 2D grid of tile values (0=normal, 1=high_ground, 2=water, 3=rock),
// resolves each cell into a TileRole for tileset rendering.
// Used by both the editor canvas and the Phaser game renderer.

export type TileValue = 0 | 1 | 2 | 3;

export type TileRole =
  | 'CENTER'
  | 'EDGE_N' | 'EDGE_S' | 'EDGE_E' | 'EDGE_W'
  | 'CORNER_NW' | 'CORNER_NE' | 'CORNER_SW' | 'CORNER_SE'
  | 'INNER_NW' | 'INNER_NE' | 'INNER_SW' | 'INNER_SE'
  | 'PENINSULA_N' | 'PENINSULA_S' | 'PENINSULA_E' | 'PENINSULA_W'
  | 'STRAIT_H' | 'STRAIT_V'
  | 'ISLAND';

export interface ResolvedTile {
  terrain: TileValue;
  role: TileRole;
  cliffBelow: boolean;   // cell below a high_ground edge (draw cliff face)
  foamEdges: number;     // bitmask: bit0=N, bit1=E, bit2=S, bit3=W (for water foam)
  isRamp: boolean;       // normal tile adjacent to high_ground (auto-ramp)
  innerCorners: number;  // bitmask for additional inner corners: bit0=NW, bit1=NE, bit2=SW, bit3=SE
}

// ─── Cardinal bitmask → TileRole lookup ─────────────────────
// Bits: bit0=N, bit1=E, bit2=S, bit3=W  (1 = same-type neighbor)
//
// Naming convention: position-based.
//   CORNER_NW = tile is at the NW corner of the platform (only E+S are same)
//   EDGE_N    = tile is on the north edge (N is different, E+S+W are same)
//   PENINSULA_S = tile is the south tip (only N is same)

const ROLE_MAP: TileRole[] = [
  /* 0  0000 */ 'ISLAND',
  /* 1  0001 N */ 'PENINSULA_S',    // only N same → tile is south tip
  /* 2  0010 E */ 'PENINSULA_W',    // only E same → tile is west tip
  /* 3  0011 N+E */ 'CORNER_SW',    // N+E same → tile is at SW position
  /* 4  0100 S */ 'PENINSULA_N',    // only S same → tile is north tip
  /* 5  0101 N+S */ 'STRAIT_V',
  /* 6  0110 E+S */ 'CORNER_NW',    // E+S same → tile is at NW position
  /* 7  0111 N+E+S */ 'EDGE_W',     // W is different → tile is on west edge
  /* 8  1000 W */ 'PENINSULA_E',    // only W same → tile is east tip
  /* 9  1001 N+W */ 'CORNER_SE',    // N+W same → tile is at SE position
  /* 10 1010 E+W */ 'STRAIT_H',
  /* 11 1011 N+E+W */ 'EDGE_S',     // S is different → tile is on south edge
  /* 12 1100 S+W */ 'CORNER_NE',    // S+W same → tile is at NE position
  /* 13 1101 N+S+W */ 'EDGE_E',     // E is different → tile is on east edge
  /* 14 1110 E+S+W */ 'EDGE_N',     // N is different → tile is on north edge
  /* 15 1111 all */ 'CENTER',
];

const tileGroup = (v: number) => v === 3 ? 0 : v;

function getCardinalBitmask(
  grid: number[][],
  row: number,
  col: number,
  rows: number,
  cols: number,
  terrain: TileValue,
): number {
  const same = (r: number, c: number) => {
    if (r < 0 || r >= rows || c < 0 || c >= cols) {
      // Out-of-bounds: treat as same for ground/high_ground, different for water
      return tileGroup(terrain) !== 2;
    }
    return tileGroup(grid[r][c]) === tileGroup(terrain);
  };

  let mask = 0;
  if (same(row - 1, col)) mask |= 1;  // N
  if (same(row, col + 1)) mask |= 2;  // E
  if (same(row + 1, col)) mask |= 4;  // S
  if (same(row, col - 1)) mask |= 8;  // W
  return mask;
}

function getDiagonalBitmask(
  grid: number[][],
  row: number,
  col: number,
  rows: number,
  cols: number,
  terrain: TileValue,
): number {
  const same = (r: number, c: number) => {
    if (r < 0 || r >= rows || c < 0 || c >= cols) return tileGroup(terrain) !== 2;
    return tileGroup(grid[r][c]) === tileGroup(terrain);
  };

  let mask = 0;
  if (same(row - 1, col - 1)) mask |= 1;  // NW
  if (same(row - 1, col + 1)) mask |= 2;  // NE
  if (same(row + 1, col - 1)) mask |= 4;  // SW
  if (same(row + 1, col + 1)) mask |= 8;  // SE
  return mask;
}

/** Resolve a single tile at (r, c). Shared by resolveGrid and resolveNeighborhood. */
function resolveTile(grid: number[][], r: number, c: number, rows: number, cols: number): ResolvedTile {
  const terrain = grid[r][c] as TileValue;
  const cardinal = getCardinalBitmask(grid, r, c, rows, cols, terrain);
  let role = ROLE_MAP[cardinal];

  // For CENTER tiles (all 4 cardinal same), check diagonals for inner corners
  let innerCorners = 0;
  if (cardinal === 15) {
    const diag = getDiagonalBitmask(grid, r, c, rows, cols, terrain);
    if ((diag & 1) === 0) innerCorners |= 1;  // NW diagonal missing
    if ((diag & 2) === 0) innerCorners |= 2;  // NE diagonal missing
    if ((diag & 4) === 0) innerCorners |= 4;  // SW diagonal missing
    if ((diag & 8) === 0) innerCorners |= 8;  // SE diagonal missing

    // If exactly one inner corner, use the specific inner corner role
    const count = ((innerCorners >> 0) & 1) + ((innerCorners >> 1) & 1) +
                  ((innerCorners >> 2) & 1) + ((innerCorners >> 3) & 1);
    if (count === 1) {
      if (innerCorners & 1) role = 'INNER_NW';
      else if (innerCorners & 2) role = 'INNER_NE';
      else if (innerCorners & 4) role = 'INNER_SW';
      else if (innerCorners & 8) role = 'INNER_SE';
    }
    // If multiple inner corners, keep CENTER and pass innerCorners bitmask
    // so renderer can overlay multiple inner corner sprites
  }

  const cliffBelow = terrain !== 1 && r > 0 && grid[r - 1][c] === 1;

  let foamEdges = 0;
  if (terrain !== 2) {
    if (r > 0 && grid[r - 1][c] === 2) foamEdges |= 1;
    if (c < cols - 1 && grid[r][c + 1] === 2) foamEdges |= 2;
    if (r < rows - 1 && grid[r + 1][c] === 2) foamEdges |= 4;
    if (c > 0 && grid[r][c - 1] === 2) foamEdges |= 8;
  }

  let isRamp = false;
  if (terrain === 0) {
    isRamp = (r > 0 && grid[r - 1][c] === 1) ||
             (r < rows - 1 && grid[r + 1][c] === 1) ||
             (c > 0 && grid[r][c - 1] === 1) ||
             (c < cols - 1 && grid[r][c + 1] === 1);
  }

  return { terrain, role, cliffBelow, foamEdges, isRamp, innerCorners };
}

export function resolveGrid(grid: number[][]): ResolvedTile[][] {
  const rows = grid.length;
  const cols = rows > 0 ? grid[0].length : 0;
  const result: ResolvedTile[][] = [];

  for (let r = 0; r < rows; r++) {
    const row: ResolvedTile[] = [];
    for (let c = 0; c < cols; c++) {
      row.push(resolveTile(grid, r, c, rows, cols));
    }
    result.push(row);
  }

  return result;
}

/** Re-resolve only a neighborhood around (centerRow, centerCol). Mutates resolved in place. */
export function resolveNeighborhood(
  grid: number[][],
  resolved: ResolvedTile[][],
  centerRow: number,
  centerCol: number,
  radius: number = 2,
): void {
  const rows = grid.length;
  const cols = rows > 0 ? grid[0].length : 0;
  const rMin = Math.max(0, centerRow - radius);
  const rMax = Math.min(rows - 1, centerRow + radius);
  const cMin = Math.max(0, centerCol - radius);
  const cMax = Math.min(cols - 1, centerCol + radius);

  for (let r = rMin; r <= rMax; r++) {
    for (let c = cMin; c <= cMax; c++) {
      resolved[r][c] = resolveTile(grid, r, c, rows, cols);
    }
  }
}

/** Create an empty grid (all normal/grass). */
export function createEmptyGrid(rows: number, cols: number): number[][] {
  return Array.from({ length: rows }, () => new Array(cols).fill(0));
}
