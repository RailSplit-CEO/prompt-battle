// ═══════════════════════════════════════════════════════════════
// horde-utils.ts — Pure utility functions extracted from HordeScene
// No Phaser dependencies. Fully testable in isolation.
// ═══════════════════════════════════════════════════════════════

// ─── Interfaces ──────────────────────────────────────────────

/** Rectangular zone (matches MapZoneDef from shared) */
export interface Zone {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Circular exclusion zone (matches wildExclusions in MapDef) */
export interface ExclusionZone {
  x: number;
  y: number;
  radius: number;
}

/** Minimal unit shape needed by spatial-grid helpers */
export interface GridUnit {
  x: number;
  y: number;
  dead: boolean;
  [key: string]: any; // allow extra fields so HUnit works without importing it
}

// ─── Helpers ─────────────────────────────────────────────────

function dist(ax: number, ay: number, bx: number, by: number): number {
  const dx = ax - bx;
  const dy = ay - by;
  return Math.sqrt(dx * dx + dy * dy);
}

function pointInRect(px: number, py: number, z: Zone): boolean {
  return px >= z.x && px <= z.x + z.w && py >= z.y && py <= z.y + z.h;
}

function pointInExclusion(px: number, py: number, ex: ExclusionZone): boolean {
  return dist(px, py, ex.x, ex.y) < ex.radius;
}

// ─── Exported functions ──────────────────────────────────────

/**
 * Returns true if (x, y) is inside at least one zone AND not inside any exclusion.
 * Matches the `isInWildZone` inline lambda in HordeScene.
 */
export function isPointInWildZones(
  x: number,
  y: number,
  zones: Zone[],
  exclusions: ExclusionZone[],
): boolean {
  for (const z of zones) {
    if (pointInRect(x, y, z)) {
      let excluded = false;
      for (const ex of exclusions) {
        if (pointInExclusion(x, y, ex)) { excluded = true; break; }
      }
      if (!excluded) return true;
    }
  }
  return false;
}

/** Numeric spatial grid key stride — must be larger than max cells per dimension */
export const SPATIAL_KEY_STRIDE = 256;

/**
 * Build a spatial hash grid from an array of units.
 * Only alive units (dead === false) are inserted.
 * Uses numeric keys: cellY * SPATIAL_KEY_STRIDE + cellX (no string allocation).
 * Optionally pools bucket arrays to reduce GC pressure.
 */
export function buildSpatialGrid<T extends GridUnit>(
  units: T[],
  cellSize: number,
  existing?: Map<number, T[]>,
  bucketPool?: T[][],
): Map<number, T[]> {
  let grid: Map<number, T[]>;
  if (existing) {
    if (bucketPool) {
      for (const bucket of existing.values()) {
        bucket.length = 0;
        bucketPool.push(bucket);
      }
    }
    existing.clear();
    grid = existing;
  } else {
    grid = new Map<number, T[]>();
  }
  for (const u of units) {
    if (u.dead) continue;
    const key = Math.floor(u.y / cellSize) * SPATIAL_KEY_STRIDE + Math.floor(u.x / cellSize);
    const bucket = grid.get(key);
    if (bucket) {
      bucket.push(u);
    } else {
      const newBucket: T[] = bucketPool && bucketPool.length > 0 ? bucketPool.pop()! : [];
      newBucket.push(u);
      grid.set(key, newBucket);
    }
  }
  return grid;
}

/**
 * Query the 9 cells surrounding (x, y) in a spatial grid,
 * then filter by actual Euclidean distance <= radius.
 * Optionally accepts a reusable output array to avoid allocation.
 */
export function getNearbyFromGrid<T extends GridUnit>(
  grid: Map<number, T[]>,
  x: number,
  y: number,
  radius: number,
  cellSize: number,
  out?: T[],
): T[] {
  const cx = Math.floor(x / cellSize);
  const cy = Math.floor(y / cellSize);
  const r2 = radius * radius;
  const result: T[] = out || [];
  if (out) out.length = 0;

  for (let dx = -1; dx <= 1; dx++) {
    for (let dy = -1; dy <= 1; dy++) {
      const bucket = grid.get((cy + dy) * SPATIAL_KEY_STRIDE + (cx + dx));
      if (!bucket) continue;
      for (const u of bucket) {
        const ux = u.x - x;
        const uy = u.y - y;
        if (ux * ux + uy * uy <= r2) {
          result.push(u);
        }
      }
    }
  }
  return result;
}

/**
 * Returns true if the unit has barely moved (distance < threshold).
 * Used to detect pathfinding stuck situations.
 */
export function detectStuck(
  lastX: number,
  lastY: number,
  curX: number,
  curY: number,
  threshold: number,
): boolean {
  return dist(lastX, lastY, curX, curY) < threshold;
}

/**
 * Compute a perpendicular nudge direction to escape a stuck position.
 * Tries +90 and -90 degrees from the current heading.
 * Falls back to a random direction if both are blocked.
 *
 * `heading` is in radians.
 * `walkabilityCheck(x, y)` returns true if the position is passable.
 *
 * Returns a normalised {dx, dy} direction vector.
 */
export function computeNudgeDirection(
  heading: number,
  walkabilityCheck: (x: number, y: number) => boolean,
): { dx: number; dy: number } {
  // Try +90 degrees (turn right)
  const rightAngle = heading + Math.PI / 2;
  const rx = Math.cos(rightAngle);
  const ry = Math.sin(rightAngle);

  // Try -90 degrees (turn left)
  const leftAngle = heading - Math.PI / 2;
  const lx = Math.cos(leftAngle);
  const ly = Math.sin(leftAngle);

  // Check a probe point 40px in each perpendicular direction
  // (caller provides walkabilityCheck bound to the world)
  const probe = 40;

  const rightOk = walkabilityCheck(rx * probe, ry * probe);
  const leftOk = walkabilityCheck(lx * probe, ly * probe);

  if (rightOk && !leftOk) return { dx: rx, dy: ry };
  if (leftOk && !rightOk) return { dx: lx, dy: ly };
  if (rightOk && leftOk) {
    // Both open — pick one deterministically (right)
    return { dx: rx, dy: ry };
  }

  // Both blocked — random fallback
  const randomAngle = Math.random() * Math.PI * 2;
  return { dx: Math.cos(randomAngle), dy: Math.sin(randomAngle) };
}

/**
 * Returns {x, y} if the target is inside a wild zone (and not excluded),
 * otherwise returns null. Used to validate wander targets before assigning them.
 */
export function clampWanderTarget(
  _originX: number,
  _originY: number,
  targetX: number,
  targetY: number,
  zones: Zone[],
  exclusions: ExclusionZone[],
): { x: number; y: number } | null {
  if (isPointInWildZones(targetX, targetY, zones, exclusions)) {
    return { x: targetX, y: targetY };
  }
  return null;
}

/**
 * Returns true if every waypoint in `path` is inside some wild zone
 * (and not inside any exclusion zone).
 */
export function validatePathInZones(
  path: { x: number; y: number }[],
  zones: Zone[],
  exclusions: ExclusionZone[],
): boolean {
  for (const pt of path) {
    if (!isPointInWildZones(pt.x, pt.y, zones, exclusions)) {
      return false;
    }
  }
  return true;
}
