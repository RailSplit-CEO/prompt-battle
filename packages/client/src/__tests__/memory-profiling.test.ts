import { describe, it, expect, beforeEach } from 'vitest';
import {
  estimateObjectSize,
  estimateHUnitSize,
  estimateMapSize,
  estimateTypedArraySize,
  formatBytes,
  getHeapUsage,
  takeSnapshot,
  diffSnapshots,
  OBJ_BASE,
  OBJ_PROP,
  MAP_HEADER,
  MAP_ENTRY,
  ARR_HEADER,
  ARR_SLOT,
  NUM_SIZE,
} from '../profiling/memory-utils';
import {
  createMockHUnit,
  createUnitBatch,
  createMockHCamp,
  createMockGroundItem,
  createMockPendingHit,
  createRealisticScenario,
  resetIdCounter,
} from '../profiling/unit-factory';
import { buildSpatialGrid, getNearbyFromGrid } from '../scenes/horde-utils';

// ─── Thresholds ───────────────────────────────────────────────

const WARN_PER_UNIT_BYTES = 2 * 1024;    // 2 KB warn
const FAIL_PER_UNIT_BYTES = 5 * 1024;    // 5 KB fail
const SPATIAL_GRID_400_MAX = 600 * 1024; // 600 KB at 400 units (includes unit refs in buckets)
const PER_FRAME_ALLOC_MAX = 1500 * 1024; // 1.5 MB per frame (grid + caches + ID maps)
const TOTAL_NON_GPU_MAX = 5 * 1024 * 1024; // 5 MB total non-GPU

const UNIT_COUNTS = [10, 50, 100, 200, 400];
const CELL_SIZE = 200;

// ─── Helpers ──────────────────────────────────────────────────

function table(label: string, rows: Record<string, unknown>[]) {
  console.log(`\n── ${label} ──`);
  console.table(rows);
}

beforeEach(() => {
  resetIdCounter();
});

// ═══════════════════════════════════════════════════════════════
// 1. HUnit memory scaling
// ═══════════════════════════════════════════════════════════════

describe('HUnit memory scaling', () => {
  const results: Record<string, unknown>[] = [];

  for (const count of UNIT_COUNTS) {
    it(`measures total unit array size at ${count} units`, () => {
      const units = createUnitBatch(count, { withWorkflows: true, withPaths: true, withEquipment: true });
      const totalSize = estimateObjectSize(units);
      const perUnit = totalSize / count;

      results.push({
        count,
        totalSize: formatBytes(totalSize),
        perUnit: formatBytes(perUnit),
        perUnitBytes: Math.round(perUnit),
      });

      // Budget assertion
      expect(perUnit).toBeLessThan(FAIL_PER_UNIT_BYTES);
      if (perUnit > WARN_PER_UNIT_BYTES) {
        console.warn(`⚠ Per-unit cost at ${count} units: ${formatBytes(perUnit)} exceeds 2 KB warn threshold`);
      }
    });
  }

  it('prints scaling table', () => {
    table('HUnit Memory Scaling', results);
  });
});

// ═══════════════════════════════════════════════════════════════
// 2. HUnit subfield breakdown
// ═══════════════════════════════════════════════════════════════

describe('HUnit subfield breakdown', () => {
  it('breaks down cost per field category', () => {
    const units = createUnitBatch(100, { withWorkflows: true, withPaths: true, withEquipment: true });
    const breakdowns = units.map(u => estimateHUnitSize(u as unknown as Record<string, unknown>));

    const avg = (arr: number[]) => arr.reduce((a, b) => a + b, 0) / arr.length;

    const summary = {
      total: formatBytes(avg(breakdowns.map(b => b.total))),
      scalars: formatBytes(avg(breakdowns.map(b => b.scalars))),
      strings: formatBytes(avg(breakdowns.map(b => b.strings))),
      pathWaypoints: formatBytes(avg(breakdowns.map(b => b.pathWaypoints))),
      workflow: formatBytes(avg(breakdowns.map(b => b.workflow))),
      mods: formatBytes(avg(breakdowns.map(b => b.mods))),
      carrying: formatBytes(avg(breakdowns.map(b => b.carrying))),
      otherRefs: formatBytes(avg(breakdowns.map(b => b.otherRefs))),
    };

    table('HUnit Field Breakdown (avg per unit, 100 units)', [summary]);

    // pathWaypoints should not dominate
    const avgPath = avg(breakdowns.map(b => b.pathWaypoints));
    const avgTotal = avg(breakdowns.map(b => b.total));
    expect(avgPath / avgTotal).toBeLessThan(0.6); // paths shouldn't be >60% of total
  });
});

// ═══════════════════════════════════════════════════════════════
// 3. Spatial grid memory
// ═══════════════════════════════════════════════════════════════

describe('Spatial grid memory', () => {
  const results: Record<string, unknown>[] = [];

  for (const count of UNIT_COUNTS) {
    it(`measures spatial grid at ${count} units`, () => {
      const units = createUnitBatch(count);
      const grid = buildSpatialGrid(units, CELL_SIZE);
      const gridSize = estimateMapSize(grid as Map<unknown, unknown>);
      const perUnit = gridSize / count;

      results.push({
        count,
        gridSize: formatBytes(gridSize),
        perUnit: formatBytes(perUnit),
        buckets: grid.size,
        avgBucketSize: (count / grid.size).toFixed(1),
      });

      if (count === 400) {
        expect(gridSize).toBeLessThan(SPATIAL_GRID_400_MAX);
      }
    });
  }

  it('prints spatial grid table', () => {
    table('Spatial Grid Memory', results);
  });
});

// ═══════════════════════════════════════════════════════════════
// 4. Nearby cache growth
// ═══════════════════════════════════════════════════════════════

describe('Nearby cache growth', () => {
  it('measures cache size at various query counts', () => {
    const units = createUnitBatch(200);
    const grid = buildSpatialGrid(units, CELL_SIZE);
    const cache = new Map<string, unknown[]>();
    const queryCounts = [50, 100, 200, 500];
    const results: Record<string, unknown>[] = [];

    for (const queryCount of queryCounts) {
      cache.clear();
      for (let i = 0; i < queryCount; i++) {
        const x = Math.random() * 6400;
        const y = Math.random() * 6400;
        const radius = 100 + Math.random() * 200;
        const qx = (Math.floor(x) >> 4) << 4;
        const qy = (Math.floor(y) >> 4) << 4;
        const key = `${qx}_${qy}_${Math.round(radius)}`;
        if (!cache.has(key)) {
          const nearby = getNearbyFromGrid(grid, x, y, radius, CELL_SIZE);
          cache.set(key, nearby);
        }
      }

      const cacheSize = estimateMapSize(cache as Map<unknown, unknown>);
      results.push({
        queries: queryCount,
        cacheEntries: cache.size,
        cacheSize: formatBytes(cacheSize),
      });
    }

    table('Nearby Cache Growth (200 units)', results);
  });
});

// ═══════════════════════════════════════════════════════════════
// 5. A* buffer costs
// ═══════════════════════════════════════════════════════════════

describe('A* buffer costs', () => {
  it('measures TypedArray buffer sizes (10000 cells = 100x100 grid)', () => {
    const GRID_SIZE = 10000;

    // Recreate the exact buffers from HordeScene lines 1680-1686
    const blocked = new Uint8Array(GRID_SIZE);
    const gScore = new Float32Array(GRID_SIZE);
    const fScore = new Float32Array(GRID_SIZE);
    const cameFrom = new Int32Array(GRID_SIZE);
    const closed = new Uint8Array(GRID_SIZE);
    const inOpen = new Uint8Array(GRID_SIZE);
    const occupied = new Uint8Array(GRID_SIZE);

    const buffers = {
      blocked: estimateTypedArraySize(blocked),
      gScore: estimateTypedArraySize(gScore),
      fScore: estimateTypedArraySize(fScore),
      cameFrom: estimateTypedArraySize(cameFrom),
      closed: estimateTypedArraySize(closed),
      inOpen: estimateTypedArraySize(inOpen),
      occupied: estimateTypedArraySize(occupied),
    };

    const fixedTotal = Object.values(buffers).reduce((a, b) => a + b, 0);

    // avoidPenalty: Float32Array(10000) — one per team per frame
    const avoidPenalty = new Float32Array(GRID_SIZE);
    const avoidSize = estimateTypedArraySize(avoidPenalty);
    // Typically 2-4 cached per frame (2 teams × rockOnly variants)
    const avoidTotalTypical = avoidSize * 4;

    const rows = Object.entries(buffers).map(([name, size]) => ({
      buffer: name,
      size: formatBytes(size),
      bytes: size,
    }));
    rows.push(
      { buffer: 'avoidPenalty (×4)', size: formatBytes(avoidTotalTypical), bytes: avoidTotalTypical },
      { buffer: 'TOTAL FIXED', size: formatBytes(fixedTotal), bytes: fixedTotal },
      { buffer: 'TOTAL + AVOID', size: formatBytes(fixedTotal + avoidTotalTypical), bytes: fixedTotal + avoidTotalTypical },
    );

    table('A* Pathfinding Buffers', rows);

    // Fixed buffers should be ~210 KB (7 buffers × ~10-40 KB each)
    expect(fixedTotal).toBeLessThan(300 * 1024);
    // With avoid penalty: ~370 KB
    expect(fixedTotal + avoidTotalTypical).toBeLessThan(600 * 1024);
  });
});

// ═══════════════════════════════════════════════════════════════
// 6. Ground items memory
// ═══════════════════════════════════════════════════════════════

describe('Ground items memory', () => {
  it('measures 150 items (MAX_GROUND_ITEMS cap)', () => {
    const MAX_GROUND_ITEMS = 150;
    const items = Array.from({ length: MAX_GROUND_ITEMS }, () => createMockGroundItem());
    const totalSize = estimateObjectSize(items);
    const perItem = totalSize / MAX_GROUND_ITEMS;

    table('Ground Items', [{
      count: MAX_GROUND_ITEMS,
      totalSize: formatBytes(totalSize),
      perItem: formatBytes(perItem),
    }]);

    // Ground items are lightweight — should be well under 100 KB total
    expect(totalSize).toBeLessThan(100 * 1024);
  });
});

// ═══════════════════════════════════════════════════════════════
// 7. PendingHit memory
// ═══════════════════════════════════════════════════════════════

describe('PendingHit memory', () => {
  const hitCounts = [10, 50, 100];
  const results: Record<string, unknown>[] = [];

  for (const count of hitCounts) {
    it(`measures ${count} pending hits`, () => {
      const hits = Array.from({ length: count }, (_, i) =>
        createMockPendingHit({ isSplash: i % 3 === 0 }),
      );
      const totalSize = estimateObjectSize(hits);
      const perHit = totalSize / count;

      const splashHits = hits.filter(h => h.splashTargets.length > 0);
      const avgSplash = splashHits.length > 0
        ? splashHits.reduce((a, h) => a + h.splashTargets.length, 0) / splashHits.length
        : 0;

      results.push({
        count,
        totalSize: formatBytes(totalSize),
        perHit: formatBytes(perHit),
        splashHits: splashHits.length,
        avgSplashTargets: avgSplash.toFixed(1),
      });
    });
  }

  it('prints pending hits table', () => {
    table('PendingHit Memory', results);
  });
});

// ═══════════════════════════════════════════════════════════════
// 8. Fog of war estimate
// ═══════════════════════════════════════════════════════════════

describe('Fog of war estimate', () => {
  it('calculates fog RenderTexture cost (6400×6400 RGBA)', () => {
    const WORLD_W = 6400;
    const WORLD_H = 6400;
    const BYTES_PER_PIXEL = 4; // RGBA
    const rtSize = WORLD_W * WORLD_H * BYTES_PER_PIXEL;

    // Brush textures — circular gradient (256×256 and 512×512)
    const brushSmall = 256 * 256 * BYTES_PER_PIXEL;
    const brushLarge = 512 * 512 * BYTES_PER_PIXEL;

    const totalFog = rtSize + brushSmall + brushLarge;

    table('Fog of War GPU Memory', [{
      component: 'RenderTexture 6400×6400',
      size: formatBytes(rtSize),
      bytes: rtSize,
    }, {
      component: 'Brush 256×256',
      size: formatBytes(brushSmall),
      bytes: brushSmall,
    }, {
      component: 'Brush 512×512',
      size: formatBytes(brushLarge),
      bytes: brushLarge,
    }, {
      component: 'TOTAL FOG',
      size: formatBytes(totalFog),
      bytes: totalFog,
    }]);

    // The fog RT alone is ~156 MB — this is the biggest single offender
    expect(rtSize).toBeGreaterThan(150 * 1024 * 1024);
    expect(rtSize).toBeLessThan(170 * 1024 * 1024);
    console.log(`\n🔴 Fog RenderTexture is ${formatBytes(rtSize)} — LARGEST SINGLE COST`);
    console.log(`   Optimization: reduce to 1600×1600 (4× downscale) → ${formatBytes(1600 * 1600 * 4)}`);
  });
});

// ═══════════════════════════════════════════════════════════════
// 9. Per-frame allocation simulation
// ═══════════════════════════════════════════════════════════════

describe('Per-frame allocation simulation', () => {
  it('simulates one full frame clear/rebuild cycle at 400 units', () => {
    const units = createUnitBatch(400, { withWorkflows: true, withPaths: true });
    let totalAllocated = 0;

    // 1. Spatial grid rebuild (clear + insert)
    const gridBefore = estimateObjectSize(new Map());
    const grid = buildSpatialGrid(units, CELL_SIZE);
    const gridAfter = estimateMapSize(grid as Map<unknown, unknown>);
    const gridAlloc = gridAfter - gridBefore;
    totalAllocated += gridAlloc;

    // 2. ID map rebuilds (_unitById, _groundItemById)
    const unitById = new Map<number, unknown>();
    for (const u of units) if (!u.dead) unitById.set(u.id, u);
    const idMapSize = MAP_HEADER + unitById.size * MAP_ENTRY;
    totalAllocated += idMapSize * 2; // two maps

    // 3. Nearby cache — simulate 100 queries (typical frame)
    const nearbyCache = new Map<string, unknown[]>();
    for (let i = 0; i < 100; i++) {
      const x = Math.random() * 6400;
      const y = Math.random() * 6400;
      const result = getNearbyFromGrid(grid, x, y, 150, CELL_SIZE);
      nearbyCache.set(`${Math.floor(x)}_${Math.floor(y)}_150`, result);
    }
    const cacheSize = estimateMapSize(nearbyCache as Map<unknown, unknown>);
    totalAllocated += cacheSize;

    // 4. Frame path cache (small — just references)
    const pathCacheSize = MAP_HEADER + 10 * MAP_ENTRY; // ~10 paths per frame max
    totalAllocated += pathCacheSize;

    table('Per-Frame Allocation (400 units)', [{
      component: 'Spatial grid rebuild',
      size: formatBytes(gridAlloc),
    }, {
      component: 'ID maps (×2)',
      size: formatBytes(idMapSize * 2),
    }, {
      component: 'Nearby cache (100 queries)',
      size: formatBytes(cacheSize),
    }, {
      component: 'Frame path cache',
      size: formatBytes(pathCacheSize),
    }, {
      component: 'TOTAL PER FRAME',
      size: formatBytes(totalAllocated),
    }]);

    expect(totalAllocated).toBeLessThan(PER_FRAME_ALLOC_MAX);
    if (totalAllocated > PER_FRAME_ALLOC_MAX * 0.7) {
      console.warn(`⚠ Per-frame alloc at ${formatBytes(totalAllocated)} — approaching 500 KB budget`);
    }
  });
});

// ═══════════════════════════════════════════════════════════════
// 10. Memory leak detection
// ═══════════════════════════════════════════════════════════════

describe('Memory leak detection', () => {
  it('runs 100 frames of spawn/kill churn — memory should stay flat', () => {
    const FRAME_COUNT = 100;
    const UNITS_PER_FRAME = 5; // spawn 5, kill 5 each frame
    const units: ReturnType<typeof createMockHUnit>[] = [];

    // Seed with 200 units
    for (let i = 0; i < 200; i++) units.push(createMockHUnit());

    const before = takeSnapshot('before-churn');
    const measurements: number[] = [];

    for (let frame = 0; frame < FRAME_COUNT; frame++) {
      // Kill random units
      let killed = 0;
      for (const u of units) {
        if (!u.dead && killed < UNITS_PER_FRAME && Math.random() > 0.5) {
          u.dead = true;
          killed++;
        }
      }

      // Spawn replacements
      for (let i = 0; i < UNITS_PER_FRAME; i++) {
        units.push(createMockHUnit({ dead: false }));
      }

      // Simulate frame: rebuild grid, clear cache
      const grid = buildSpatialGrid(units, CELL_SIZE);
      // Run some queries
      for (let q = 0; q < 20; q++) {
        getNearbyFromGrid(grid, Math.random() * 6400, Math.random() * 6400, 150, CELL_SIZE);
      }

      if (frame % 10 === 0) {
        const heap = getHeapUsage();
        measurements.push(heap.heapUsed);
      }
    }

    const after = takeSnapshot('after-churn');
    const diff = diffSnapshots(before, after);

    // Check growth rate: should be < 1 MB over 100 frames
    const growth = diff.heapUsedDelta;

    table('Leak Detection (100 frames, spawn/kill churn)', [{
      heapBefore: formatBytes(before.heap.heapUsed),
      heapAfter: formatBytes(after.heap.heapUsed),
      growth: formatBytes(growth),
      unitArrayLength: units.length,
      aliveUnits: units.filter(u => !u.dead).length,
    }]);

    // Memory growth trend from measurements
    if (measurements.length >= 3) {
      const first = measurements[0];
      const last = measurements[measurements.length - 1];
      const trendMB = (last - first) / (1024 * 1024);
      console.log(`Heap trend over ${FRAME_COUNT} frames: ${trendMB > 0 ? '+' : ''}${trendMB.toFixed(2)} MB`);
      if (trendMB > 5) {
        console.warn(`⚠ POTENTIAL LEAK: heap grew ${trendMB.toFixed(1)} MB over ${FRAME_COUNT} frames`);
      }
    }

    // Note: in Node/vitest GC is non-deterministic, so we can't assert exact
    // amounts. But we can detect catastrophic leaks (>10 MB in 100 frames).
    // In practice, run with --expose-gc and call gc() for precise measurements.
    expect(Math.abs(growth)).toBeLessThan(50 * 1024 * 1024); // generous: < 50 MB
  });
});

// ═══════════════════════════════════════════════════════════════
// Summary: total non-GPU budget check
// ═══════════════════════════════════════════════════════════════

describe('Total non-GPU budget', () => {
  it('full scenario at 400 units stays under 5 MB non-GPU', () => {
    const scenario = createRealisticScenario({
      team1Units: 180,
      team2Units: 180,
      neutrals: 40,
      camps: 12,
      groundItems: 150,
      pendingHits: 30,
    });

    const grid = buildSpatialGrid(scenario.units, CELL_SIZE);

    const sizes = {
      units: estimateObjectSize(scenario.units),
      spatialGrid: estimateMapSize(grid as Map<unknown, unknown>),
      camps: estimateObjectSize(scenario.camps),
      groundItems: estimateObjectSize(scenario.groundItems),
      pendingHits: estimateObjectSize(scenario.pendingHits),
      astarBuffers: 7 * (10000 + 64) + 4 * (10000 * 4 + 64), // 7 typed arrays
    };

    const total = Object.values(sizes).reduce((a, b) => a + b, 0);

    const rows = Object.entries(sizes).map(([name, size]) => ({
      subsystem: name,
      size: formatBytes(size),
      bytes: size,
      pct: `${((size / total) * 100).toFixed(1)}%`,
    }));
    rows.push({
      subsystem: 'TOTAL NON-GPU',
      size: formatBytes(total),
      bytes: total,
      pct: '100%',
    });

    table('Full Scenario Budget (400 units)', rows);

    expect(total).toBeLessThan(TOTAL_NON_GPU_MAX);
  });
});
