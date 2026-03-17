// ═══════════════════════════════════════════════════════════════
// Vision.ts — Fog-of-war vision system, Phaser-free.
// All functions take explicit parameters (no `this.` references).
// Extracted from HordeScene.ts (~lines 3266-3360).
// ═══════════════════════════════════════════════════════════════

import { TILE_SIZE } from '../data/maps';
import type { VisionSource, HUnit, HCamp, HTower, HArmory, MapEvent } from './SimTypes';
import type { EquipmentType } from '../data/maps';
import {
  FOG_VISION_RANGE,
  FOG_STRUCTURE_VISION_RANGE,
  FOG_VISION_TILES_W,
  FOG_VISION_TILES_H,
} from './Constants';

// ─── Build Vision Sources ────────────────────────────────────

/**
 * Collects all entities that provide vision for a team.
 * Returns an array of VisionSource objects (position + radius).
 *
 * @param myTeam          The team to build vision for (1 or 2)
 * @param basePos         Position of the team's nexus/base
 * @param units           All units in the game
 * @param camps           All camps in the game
 * @param towers          All towers in the game
 * @param armories        All armories in the game
 * @param unlockedEquipment  Map of unlocked equipment for the team
 * @param mapEvents       All active map events
 * @param out             Optional reusable output array (cleared before use)
 */
export function buildVisionSources(
  myTeam: 1 | 2,
  basePos: { x: number; y: number },
  units: readonly HUnit[],
  camps: readonly HCamp[],
  towers: readonly HTower[],
  armories: readonly HArmory[],
  unlockedEquipment: Map<EquipmentType, number>,
  mapEvents: readonly MapEvent[],
  out?: VisionSource[],
): VisionSource[] {
  const sources: VisionSource[] = out || [];
  if (out) out.length = 0;

  // Own nexus — large structure vision
  sources.push({ x: basePos.x, y: basePos.y, r: FOG_STRUCTURE_VISION_RANGE });

  // Allied units — standard vision
  for (const u of units) {
    if (u.dead || u.team !== myTeam) continue;
    sources.push({ x: u.x, y: u.y, r: FOG_VISION_RANGE });
  }

  // Owned camps — structure vision
  for (const c of camps) {
    if (c.owner === myTeam) {
      sources.push({ x: c.x, y: c.y, r: FOG_STRUCTURE_VISION_RANGE });
    }
  }

  // Allied towers — structure vision
  for (const t of towers) {
    if (t.alive && t.team === myTeam) {
      sources.push({ x: t.x, y: t.y, r: FOG_STRUCTURE_VISION_RANGE });
    }
  }

  // Allied armories — structure vision (only if unlocked)
  for (const arm of armories) {
    if (arm.team === myTeam && unlockedEquipment.has(arm.equipmentType)) {
      sources.push({ x: arm.x, y: arm.y, r: FOG_STRUCTURE_VISION_RANGE });
    }
  }

  // Active map events — always visible to both teams
  for (const ev of mapEvents) {
    if (ev.state === 'active') {
      sources.push({ x: ev.x, y: ev.y, r: FOG_STRUCTURE_VISION_RANGE });
    }
  }

  return sources;
}

// ─── Is In Vision ────────────────────────────────────────────

/**
 * Check if a world position is currently visible.
 * Uses the integer vision grid for O(1) fast path when available,
 * falls back to per-source distance + line-of-sight check.
 *
 * @param x              World x coordinate
 * @param y              World y coordinate
 * @param visionGrid     Uint8Array tile grid (or null if not built)
 * @param visionSources  Array of vision-providing entities
 * @param tiles          2D tile grid for line-of-sight (or null)
 */
export function isInVision(
  x: number,
  y: number,
  visionGrid: Uint8Array | null,
  visionSources: readonly VisionSource[],
  tiles: readonly (readonly number[])[] | null,
): boolean {
  // Fast O(1) lookup via integer vision grid
  if (visionGrid) {
    const tx = Math.floor(x / TILE_SIZE);
    const ty = Math.floor(y / TILE_SIZE);
    if (tx >= 0 && tx < FOG_VISION_TILES_W && ty >= 0 && ty < FOG_VISION_TILES_H) {
      return visionGrid[ty * FOG_VISION_TILES_W + tx] > 0;
    }
  }

  // Fallback to per-source check
  for (const s of visionSources) {
    const dx = x - s.x;
    const dy = y - s.y;
    if (dx * dx + dy * dy < s.r * s.r && hasLineOfSight(s.x, s.y, x, y, tiles)) {
      return true;
    }
  }
  return false;
}

// ─── Is In Vision Relaxed ────────────────────────────────────

/**
 * Relaxed vision check with extra buffer radius.
 * Used for hysteresis to prevent edge flicker on units exiting vision.
 *
 * @param x              World x coordinate
 * @param y              World y coordinate
 * @param buffer         Extra radius in world pixels
 * @param visionSources  Array of vision-providing entities
 * @param tiles          2D tile grid for line-of-sight (or null)
 */
export function isInVisionRelaxed(
  x: number,
  y: number,
  buffer: number,
  visionSources: readonly VisionSource[],
  tiles: readonly (readonly number[])[] | null,
): boolean {
  for (const s of visionSources) {
    const dx = x - s.x;
    const dy = y - s.y;
    const r = s.r + buffer;
    if (dx * dx + dy * dy < r * r && hasLineOfSight(s.x, s.y, x, y, tiles)) {
      return true;
    }
  }
  return false;
}

// ─── Has Line of Sight ───────────────────────────────────────

/**
 * Integer DDA raycast (Bresenham-style) through the tile grid.
 * Returns false if a rock (tile value 3) blocks the line of sight.
 * Returns true if tiles is null/empty (no blocking information).
 *
 * @param x0     Start world x
 * @param y0     Start world y
 * @param x1     End world x
 * @param y1     End world y
 * @param tiles  2D tile grid (row-major). Tile value 3 = rock/impassable.
 */
export function hasLineOfSight(
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  tiles: readonly (readonly number[])[] | null,
): boolean {
  if (!tiles || tiles.length === 0) return true;
  const rows = tiles.length;
  const cols = tiles[0].length;

  // Integer DDA — no Math.sqrt, no per-step division
  let col0 = (x0 / TILE_SIZE) | 0;
  let row0 = (y0 / TILE_SIZE) | 0;
  const col1 = (x1 / TILE_SIZE) | 0;
  const row1 = (y1 / TILE_SIZE) | 0;

  let dc = col1 - col0;
  let dr = row1 - row0;
  const sc = dc > 0 ? 1 : dc < 0 ? -1 : 0;
  const sr = dr > 0 ? 1 : dr < 0 ? -1 : 0;
  dc = dc < 0 ? -dc : dc;
  dr = dr < 0 ? -dr : dr;

  if (dc === 0 && dr === 0) return true;

  let err: number;
  if (dc >= dr) {
    err = dc >> 1;
    for (let i = 0; i < dc; i++) {
      col0 += sc;
      err -= dr;
      if (err < 0) { row0 += sr; err += dc; }
      if (row0 >= 0 && row0 < rows && col0 >= 0 && col0 < cols && tiles[row0][col0] === 3) {
        return false;
      }
    }
  } else {
    err = dr >> 1;
    for (let i = 0; i < dr; i++) {
      row0 += sr;
      err -= dc;
      if (err < 0) { col0 += sc; err += dr; }
      if (row0 >= 0 && row0 < rows && col0 >= 0 && col0 < cols && tiles[row0][col0] === 3) {
        return false;
      }
    }
  }
  return true;
}

// ─── Build Vision Grid ───────────────────────────────────────

/**
 * Populate a Uint8Array tile grid marking which tiles are visible.
 * Each tile that falls within any vision source's radius is set to 1.
 *
 * @param visionSources  Array of vision-providing entities
 * @param grid           Uint8Array of size FOG_VISION_TILES_W * FOG_VISION_TILES_H (filled with 0 first)
 */
export function buildVisionGrid(
  visionSources: readonly VisionSource[],
  grid: Uint8Array,
): void {
  grid.fill(0);
  const tw = FOG_VISION_TILES_W;
  const th = FOG_VISION_TILES_H;

  for (const s of visionSources) {
    const rTiles = Math.ceil(s.r / TILE_SIZE);
    const cxT = Math.floor(s.x / TILE_SIZE);
    const cyT = Math.floor(s.y / TILE_SIZE);
    const r2 = rTiles * rTiles;

    for (let dy = -rTiles; dy <= rTiles; dy++) {
      const ty = cyT + dy;
      if (ty < 0 || ty >= th) continue;
      for (let dx = -rTiles; dx <= rTiles; dx++) {
        const tx = cxT + dx;
        if (tx < 0 || tx >= tw) continue;
        if (dx * dx + dy * dy <= r2) {
          grid[ty * tw + tx] = 1;
        }
      }
    }
  }
}
