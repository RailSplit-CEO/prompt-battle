// ═══════════════════════════════════════════════════════════════
// TILESET ATLAS — Source rectangle mappings for Tiny Swords tileset
// ═══════════════════════════════════════════════════════════════
//
// Maps each TileRole to a source rectangle {x, y, w, h} in the
// tileset PNG (576×384, 9 cols × 6 rows of 64×64).
//
// Layout:
//   Left half (cols 0-3):  ground-level grass platform
//   Right half (cols 5-8): elevated grass platform with cliff face
//   Col 4: transition/special tiles
//
// Ground platform (cols 0-3):
//   Row 0: NW corner, N edge L, N edge R, NE corner
//   Row 1: W edge T,  Center TL, Center TR, E edge T
//   Row 2: W edge B,  Center BL, Center BR, E edge B
//   Row 3: SW corner, S edge L,  S edge R,  SE corner
//   Row 4: Inner corner SE, special, Inner corner SW
//   Row 5: Inner corner NE, special, Inner corner NW
//
// Elevated platform (cols 5-8, x offset = 320):
//   Row 0-1: Same as ground but elevated
//   Row 2-3: Cliff face tiles
//   Row 4-5: Inner corners (elevated)

import type { TileRole } from './AutoTileResolver';

export interface SourceRect {
  x: number;
  y: number;
  w: number;
  h: number;
  flipX?: boolean;
  flipY?: boolean;
}

const T = 64; // tile size in tileset

// ─── GROUND (normal) tile source rects ─────────────────────
const GROUND: Record<string, SourceRect> = {
  CORNER_NW:    { x: 0,     y: 0,   w: T, h: T },
  EDGE_N:       { x: T,     y: 0,   w: T, h: T },
  CORNER_NE:    { x: T * 3, y: 0,   w: T, h: T },
  EDGE_W:       { x: 0,     y: T,   w: T, h: T },
  CENTER:       { x: T,     y: T,   w: T, h: T },
  EDGE_E:       { x: T * 3, y: T,   w: T, h: T },
  CORNER_SW:    { x: 0,     y: T * 3, w: T, h: T },
  EDGE_S:       { x: T,     y: T * 3, w: T, h: T },
  CORNER_SE:    { x: T * 3, y: T * 3, w: T, h: T },
  // Inner corners (concave)
  INNER_NW:     { x: T * 2, y: T * 5, w: T, h: T },
  INNER_NE:     { x: 0,     y: T * 5, w: T, h: T },
  INNER_SW:     { x: T * 2, y: T * 4, w: T, h: T },
  INNER_SE:     { x: 0,     y: T * 4, w: T, h: T },
  // Special shapes - reuse edge/center tiles
  STRAIT_H:     { x: T,     y: T,   w: T, h: T },  // horizontal passage
  STRAIT_V:     { x: T,     y: T,   w: T, h: T },  // vertical passage
  ISLAND:       { x: T,     y: T,   w: T, h: T },  // isolated - use center
  PENINSULA_N:  { x: T,     y: 0,   w: T, h: T },  // tip pointing north
  PENINSULA_S:  { x: T,     y: T * 3, w: T, h: T },
  PENINSULA_E:  { x: T * 3, y: T,   w: T, h: T },
  PENINSULA_W:  { x: 0,     y: T,   w: T, h: T },
};

// ─── HIGH GROUND (elevated) tile source rects ──────────────
// Same roles but from right half of tileset (x offset = 320)
const HG_X = T * 5; // column 5 = x:320

const HIGH_GROUND: Record<string, SourceRect> = {
  CORNER_NW:    { x: HG_X,         y: 0,   w: T, h: T },
  EDGE_N:       { x: HG_X + T,     y: 0,   w: T, h: T },
  CORNER_NE:    { x: HG_X + T * 3, y: 0,   w: T, h: T },
  EDGE_W:       { x: HG_X,         y: T,   w: T, h: T },
  CENTER:       { x: HG_X + T,     y: T,   w: T, h: T },
  EDGE_E:       { x: HG_X + T * 3, y: T,   w: T, h: T },
  // South row & inner corners: right-half rows 2-3 are cliff faces, not platform edges.
  // Fall back to ground rects for these roles.
  CORNER_SW:    { x: 0,     y: T * 3, w: T, h: T },
  EDGE_S:       { x: T,     y: T * 3, w: T, h: T },
  CORNER_SE:    { x: T * 3, y: T * 3, w: T, h: T },
  INNER_NW:     { x: T * 2, y: T * 5, w: T, h: T },
  INNER_NE:     { x: 0,     y: T * 5, w: T, h: T },
  INNER_SW:     { x: T * 2, y: T * 4, w: T, h: T },
  INNER_SE:     { x: 0,     y: T * 4, w: T, h: T },
  STRAIT_H:     { x: HG_X + T,     y: T,   w: T, h: T },
  STRAIT_V:     { x: HG_X + T,     y: T,   w: T, h: T },
  ISLAND:       { x: HG_X + T,     y: T,   w: T, h: T },
  PENINSULA_N:  { x: HG_X + T,     y: 0,   w: T, h: T },
  PENINSULA_S:  { x: T,     y: T * 3, w: T, h: T },
  PENINSULA_E:  { x: HG_X + T * 3, y: T,   w: T, h: T },
  PENINSULA_W:  { x: HG_X,         y: T,   w: T, h: T },
};

// Cliff face source rect (for cells below high ground)
const CLIFF_FACE: SourceRect = { x: HG_X + T, y: T * 2, w: T, h: T };

export function getTileSourceRect(terrain: number, role: TileRole): SourceRect {
  const map = terrain === 1 ? HIGH_GROUND : GROUND;
  return map[role] || map['CENTER'];
}

export function getCliffSourceRect(): SourceRect {
  return CLIFF_FACE;
}

/** Water color for solid fill (turquoise from Water Background color.png) */
export const WATER_COLOR = '#3fa4d4';
export const WATER_COLOR_HEX = 0x3fa4d4;

/** All role names for iteration */
export const ALL_ROLES: TileRole[] = [
  'CENTER', 'EDGE_N', 'EDGE_S', 'EDGE_E', 'EDGE_W',
  'CORNER_NW', 'CORNER_NE', 'CORNER_SW', 'CORNER_SE',
  'INNER_NW', 'INNER_NE', 'INNER_SW', 'INNER_SE',
  'PENINSULA_N', 'PENINSULA_S', 'PENINSULA_E', 'PENINSULA_W',
  'STRAIT_H', 'STRAIT_V', 'ISLAND',
];

/** Get tileset image filename for a color variant (1-5) */
export function getTilesetFilename(colorVariant: number): string {
  const v = Math.max(1, Math.min(5, colorVariant || 4));
  return `assets/terrain/tilemap_color${v}.png`;
}
