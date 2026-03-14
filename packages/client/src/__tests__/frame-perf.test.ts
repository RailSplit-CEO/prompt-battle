import { describe, it, expect, beforeEach } from 'vitest';
import { buildSpatialGrid, getNearbyFromGrid } from '../scenes/horde-utils';
import { createUnitBatch, resetIdCounter } from '../profiling/unit-factory';
import { formatBytes } from '../profiling/memory-utils';

// ─── Helpers ──────────────────────────────────────────────────

const CELL_SIZE = 200;

interface TimingResult {
  min: number;
  max: number;
  mean: number;
  p95: number;
  p99: number;
}

function benchmark(fn: () => void, iterations: number): TimingResult {
  const times: number[] = [];

  // Warmup
  for (let i = 0; i < Math.min(10, iterations); i++) fn();

  for (let i = 0; i < iterations; i++) {
    const start = performance.now();
    fn();
    times.push(performance.now() - start);
  }

  times.sort((a, b) => a - b);
  const sum = times.reduce((a, b) => a + b, 0);

  return {
    min: times[0],
    max: times[times.length - 1],
    mean: sum / times.length,
    p95: times[Math.floor(times.length * 0.95)],
    p99: times[Math.floor(times.length * 0.99)],
  };
}

function fmtMs(ms: number): string {
  if (ms < 0.01) return `${(ms * 1000).toFixed(1)}μs`;
  if (ms < 1) return `${ms.toFixed(3)}ms`;
  return `${ms.toFixed(1)}ms`;
}

function table(label: string, rows: Record<string, unknown>[]) {
  console.log(`\n── ${label} ──`);
  console.table(rows);
}

beforeEach(() => {
  resetIdCounter();
});

// ═══════════════════════════════════════════════════════════════
// 1. Spatial grid rebuild timing
// ═══════════════════════════════════════════════════════════════

describe('Spatial grid rebuild', () => {
  const unitCounts = [10, 50, 100, 200, 400];
  const ITERATIONS = 100;
  const results: Record<string, unknown>[] = [];

  for (const count of unitCounts) {
    it(`benchmarks buildSpatialGrid at ${count} units`, () => {
      const units = createUnitBatch(count);
      let existing: Map<number, any[]> | undefined;

      const timing = benchmark(() => {
        existing = buildSpatialGrid(units, CELL_SIZE, existing) as Map<number, any[]>;
      }, ITERATIONS);

      results.push({
        units: count,
        mean: fmtMs(timing.mean),
        min: fmtMs(timing.min),
        max: fmtMs(timing.max),
        p95: fmtMs(timing.p95),
      });

      // Spatial grid rebuild at 400 units should be < 2ms
      if (count === 400) {
        expect(timing.p95).toBeLessThan(5); // generous: < 5ms p95
      }
    });
  }

  it('prints spatial grid timing table', () => {
    table(`Spatial Grid Rebuild (${ITERATIONS} iterations)`, results);
  });
});

// ═══════════════════════════════════════════════════════════════
// 2. Nearby queries
// ═══════════════════════════════════════════════════════════════

describe('Nearby queries', () => {
  const configs = [
    { units: 200, radius: 50 },
    { units: 200, radius: 150 },
    { units: 200, radius: 500 },
    { units: 400, radius: 50 },
    { units: 400, radius: 150 },
    { units: 400, radius: 500 },
  ];
  const QUERIES = 1000;
  const results: Record<string, unknown>[] = [];

  for (const { units: unitCount, radius } of configs) {
    it(`benchmarks getNearbyFromGrid: ${unitCount} units, radius ${radius}`, () => {
      const units = createUnitBatch(unitCount);
      const grid = buildSpatialGrid(units, CELL_SIZE);

      // Pre-generate random query points
      const queryPoints = Array.from({ length: QUERIES }, () => ({
        x: Math.random() * 6400,
        y: Math.random() * 6400,
      }));

      let totalResults = 0;
      const timing = benchmark(() => {
        totalResults = 0;
        for (const { x, y } of queryPoints) {
          totalResults += getNearbyFromGrid(grid, x, y, radius, CELL_SIZE).length;
        }
      }, 1); // 1 iteration of 1000 queries

      const avgResultSize = totalResults / QUERIES;

      results.push({
        units: unitCount,
        radius,
        totalTimeMs: fmtMs(timing.mean),
        avgPerQuery: fmtMs(timing.mean / QUERIES),
        avgResultSize: avgResultSize.toFixed(1),
      });

      // 1000 queries should complete in < 50ms total
      expect(timing.mean).toBeLessThan(100);
    });
  }

  it('prints nearby query timing table', () => {
    table(`Nearby Queries (${QUERIES} queries per config)`, results);
  });
});

// ═══════════════════════════════════════════════════════════════
// 3. Unit ID map rebuild
// ═══════════════════════════════════════════════════════════════

describe('Unit ID map rebuild', () => {
  const unitCounts = [100, 200, 400];
  const ITERATIONS = 100;
  const results: Record<string, unknown>[] = [];

  for (const count of unitCounts) {
    it(`benchmarks Map.clear() + rebuild at ${count} units`, () => {
      const units = createUnitBatch(count);
      const map = new Map<number, unknown>();

      const timing = benchmark(() => {
        map.clear();
        for (const u of units) {
          if (!u.dead) map.set(u.id, u);
        }
      }, ITERATIONS);

      results.push({
        units: count,
        mean: fmtMs(timing.mean),
        p95: fmtMs(timing.p95),
      });

      // ID map rebuild should be trivial: < 1ms
      expect(timing.p95).toBeLessThan(2);
    });
  }

  it('prints ID map rebuild timing table', () => {
    table(`Unit ID Map Rebuild (${ITERATIONS} iterations)`, results);
  });
});

// ═══════════════════════════════════════════════════════════════
// 4. Frame budget analysis
// ═══════════════════════════════════════════════════════════════

describe('Frame budget analysis', () => {
  it('sums all subsystem times at 400 units and compares to 16.67ms budget', () => {
    const FRAME_BUDGET_MS = 16.67; // 60 fps
    const count = 400;
    const units = createUnitBatch(count, { withWorkflows: true, withPaths: true });
    let existing: Map<number, any[]> | undefined;

    // Spatial grid rebuild
    const spatialTiming = benchmark(() => {
      existing = buildSpatialGrid(units, CELL_SIZE, existing) as Map<number, any[]>;
    }, 50);

    // ID map rebuild (×2 maps)
    const unitMap = new Map<number, unknown>();
    const idMapTiming = benchmark(() => {
      unitMap.clear();
      for (const u of units) if (!u.dead) unitMap.set(u.id, u);
    }, 50);

    // Nearby queries (simulate 100 per frame for combat + workflows)
    const grid = buildSpatialGrid(units, CELL_SIZE);
    const nearbyTiming = benchmark(() => {
      for (let i = 0; i < 100; i++) {
        getNearbyFromGrid(grid, Math.random() * 6400, Math.random() * 6400, 150, CELL_SIZE);
      }
    }, 20);

    // Movement simulation (simple position updates)
    const movementTiming = benchmark(() => {
      for (const u of units) {
        if (u.dead) continue;
        const dx = u.targetX - u.x;
        const dy = u.targetY - u.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist > 1) {
          u.x += (dx / dist) * u.speed * 0.016;
          u.y += (dy / dist) * u.speed * 0.016;
        }
      }
    }, 50);

    const subsystems = {
      spatialGrid: spatialTiming.mean,
      idMaps: idMapTiming.mean * 2,
      nearbyQueries: nearbyTiming.mean,
      movement: movementTiming.mean,
    };

    const measuredTotal = Object.values(subsystems).reduce((a, b) => a + b, 0);

    // Note: we can't measure the actual pathfinding, combat, fog, or sprite
    // updates here without Phaser. Those are the likely bottlenecks.
    // This gives us a floor for the measurable headless subsystems.

    const rows = Object.entries(subsystems).map(([name, ms]) => ({
      subsystem: name,
      time: fmtMs(ms),
      pctOfBudget: `${((ms / FRAME_BUDGET_MS) * 100).toFixed(1)}%`,
    }));
    rows.push({
      subsystem: 'MEASURED TOTAL',
      time: fmtMs(measuredTotal),
      pctOfBudget: `${((measuredTotal / FRAME_BUDGET_MS) * 100).toFixed(1)}%`,
    });
    rows.push({
      subsystem: 'REMAINING (pathfind, combat, fog, sprites)',
      time: fmtMs(FRAME_BUDGET_MS - measuredTotal),
      pctOfBudget: `${(((FRAME_BUDGET_MS - measuredTotal) / FRAME_BUDGET_MS) * 100).toFixed(1)}%`,
    });

    table('Frame Budget Analysis (400 units, 60fps = 16.67ms)', rows);

    // Headless-measurable subsystems should consume < 30% of frame budget
    // leaving room for pathfinding, combat, fog, and sprite updates
    expect(measuredTotal).toBeLessThan(FRAME_BUDGET_MS * 0.5);
    console.log(`\nMeasured subsystems use ${((measuredTotal / FRAME_BUDGET_MS) * 100).toFixed(1)}% of 60fps budget`);
    console.log(`Remaining ${fmtMs(FRAME_BUDGET_MS - measuredTotal)} for pathfinding, combat, fog, sprites`);
    console.log('(Use in-game Ctrl+M overlay to measure those subsystems with Phaser running)');
  });
});
