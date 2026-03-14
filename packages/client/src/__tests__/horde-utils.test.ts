import { describe, it, expect } from 'vitest';
import {
  buildSpatialGrid,
  getNearbyFromGrid,
  SPATIAL_KEY_STRIDE,
  detectStuck,
  isPointInWildZones,
  clampWanderTarget,
  validatePathInZones,
  computeNudgeDirection,
} from '../scenes/horde-utils';
import type { Zone, ExclusionZone } from '../scenes/horde-utils';

// ── Shared fixtures ────────────────────────────────────────────────

const zones: Zone[] = [
  { x: 0, y: 0, w: 500, h: 500 },
  { x: 600, y: 600, w: 400, h: 400 },
];
const exclusions: ExclusionZone[] = [{ x: 120, y: 120, radius: 30 }];

function mkUnit(x: number, y: number, id: string, dead = false) {
  return { x, y, dead, id } as any;
}

// ── Spatial Grid ───────────────────────────────────────────────────

describe('buildSpatialGrid', () => {
  it('inserts a unit into the correct cell based on its position', () => {
    const units = [mkUnit(150, 250, 'u1')];
    const grid = buildSpatialGrid(units, 200);
    // cell key = floor(250/200) * STRIDE + floor(150/200) = 1 * 256 + 0 = 256
    const key = 1 * SPATIAL_KEY_STRIDE + 0;
    expect(grid.has(key)).toBe(true);
    expect(grid.get(key)).toEqual(expect.arrayContaining([expect.objectContaining({ id: 'u1' })]));
  });

  it('places multiple units into distinct cells', () => {
    const units = [mkUnit(50, 50, 'a'), mkUnit(450, 450, 'b')];
    const grid = buildSpatialGrid(units, 200);
    const keyA = 0 * SPATIAL_KEY_STRIDE + 0; // cell (0,0)
    const keyB = 2 * SPATIAL_KEY_STRIDE + 2; // cell (2,2)
    expect(grid.get(keyA)).toEqual(expect.arrayContaining([expect.objectContaining({ id: 'a' })]));
    expect(grid.get(keyB)).toEqual(expect.arrayContaining([expect.objectContaining({ id: 'b' })]));
  });

  it('skips dead units', () => {
    const units = [mkUnit(50, 50, 'alive'), mkUnit(60, 60, 'dead', true)];
    const grid = buildSpatialGrid(units, 200);
    const key = 0 * SPATIAL_KEY_STRIDE + 0;
    const bucket = grid.get(key) ?? [];
    expect(bucket.length).toBe(1);
    expect(bucket[0].id).toBe('alive');
  });
});

describe('getNearbyFromGrid', () => {
  it('returns units within the given radius', () => {
    const units = [mkUnit(100, 100, 'near'), mkUnit(105, 105, 'alsoNear')];
    const grid = buildSpatialGrid(units, 200);
    const result = getNearbyFromGrid(grid, 100, 100, 50, 200);
    const ids = result.map((u: any) => u.id);
    expect(ids).toContain('near');
    expect(ids).toContain('alsoNear');
  });

  it('excludes units outside the radius', () => {
    const units = [mkUnit(100, 100, 'near'), mkUnit(900, 900, 'far')];
    const grid = buildSpatialGrid(units, 200);
    const result = getNearbyFromGrid(grid, 100, 100, 50, 200);
    const ids = result.map((u: any) => u.id);
    expect(ids).toContain('near');
    expect(ids).not.toContain('far');
  });

  it('returns empty array for an empty grid', () => {
    const grid = buildSpatialGrid([], 200);
    const result = getNearbyFromGrid(grid, 100, 100, 300, 200);
    expect(result).toEqual([]);
  });

  it('finds units at cell boundaries from adjacent cells', () => {
    const units = [mkUnit(199, 199, 'edge')];
    const grid = buildSpatialGrid(units, 200);
    // Query from cell (1,1) center but with radius that reaches into cell (0,0)
    const result = getNearbyFromGrid(grid, 210, 210, 30, 200);
    const ids = result.map((u: any) => u.id);
    expect(ids).toContain('edge');
  });
});

// ── Stuck Detection ────────────────────────────────────────────────

describe('detectStuck', () => {
  it('flags a unit as stuck when it moved less than the threshold', () => {
    // Moved ~4.24 px, threshold 5
    expect(detectStuck(100, 100, 103, 103, 5)).toBe(true);
  });

  it('does not flag a unit that moved more than the threshold', () => {
    // Moved ~14.14 px
    expect(detectStuck(100, 100, 110, 110, 5)).toBe(false);
  });

  it('returns false when distance is exactly at the threshold', () => {
    // Moved exactly 5 px (horizontal)
    expect(detectStuck(100, 100, 105, 100, 5)).toBe(false);
  });
});

// ── Zone Containment ───────────────────────────────────────────────

describe('isPointInWildZones', () => {
  it('returns true when point is inside a zone', () => {
    expect(isPointInWildZones(250, 250, zones, [])).toBe(true);
  });

  it('returns false when point is outside all zones', () => {
    expect(isPointInWildZones(550, 550, zones, [])).toBe(false);
  });

  it('returns true when point is inside one zone but outside another (any-zone rule)', () => {
    // Inside second zone only
    expect(isPointInWildZones(700, 700, zones, [])).toBe(true);
  });

  it('returns false when point is inside a zone but also inside an exclusion', () => {
    // (120, 120) is inside zone[0] AND within exclusion radius 30 of (120,120)
    expect(isPointInWildZones(120, 120, zones, exclusions)).toBe(false);
  });
});

describe('clampWanderTarget', () => {
  it('returns null when the target point is outside all zones', () => {
    const result = clampWanderTarget(250, 250, 550, 550, zones, []);
    expect(result).toBeNull();
  });

  it('returns {x, y} when the target is inside a zone', () => {
    const result = clampWanderTarget(250, 250, 300, 300, zones, []);
    expect(result).toEqual({ x: 300, y: 300 });
  });
});

describe('validatePathInZones', () => {
  it('rejects a path that has an out-of-zone waypoint', () => {
    const path = [
      { x: 100, y: 100 },
      { x: 550, y: 550 }, // outside both zones
      { x: 700, y: 700 },
    ];
    expect(validatePathInZones(path, zones, [])).toBe(false);
  });

  it('accepts a path where every waypoint is inside a zone', () => {
    const path = [
      { x: 100, y: 100 },
      { x: 200, y: 200 },
      { x: 300, y: 300 },
    ];
    expect(validatePathInZones(path, zones, [])).toBe(true);
  });
});

// ── Nudge Direction ────────────────────────────────────────────────

describe('computeNudgeDirection', () => {
  it('returns a direction perpendicular to the heading', () => {
    // Heading east (0 radians)
    const walkable = () => true;
    const dir = computeNudgeDirection(0, walkable);
    // Perpendicular to east is north/south: dx≈0, |dy|≈1
    expect(dir.dx).toBeCloseTo(0, 3);
    expect(Math.abs(dir.dy)).toBeCloseTo(1, 3);
  });

  it('respects walkability check and skips unwalkable directions', () => {
    // Heading east (0 radians). Block "right" perpendicular (positive dy)
    const walkable = (_x: number, y: number) => {
      // Block the +90 direction (sin(pi/2) = 1, so positive y probe)
      if (y > 0) return false;
      return true;
    };
    const dir = computeNudgeDirection(0, walkable);
    // Should pick the left perpendicular (negative dy)
    expect(dir.dx).toBeCloseTo(0, 3);
    expect(dir.dy).toBeCloseTo(-1, 3);
  });

  it('falls back to some direction when all perpendiculars are blocked', () => {
    const walkable = () => false;
    const dir = computeNudgeDirection(0, walkable);
    // Should still return something (random fallback)
    expect(dir).toBeDefined();
    expect(typeof dir.dx).toBe('number');
    expect(typeof dir.dy).toBe('number');
    expect(Math.hypot(dir.dx, dir.dy)).toBeGreaterThan(0);
  });
});
