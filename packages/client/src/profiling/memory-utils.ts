// ═══════════════════════════════════════════════════════════════
// memory-utils.ts — Shared utilities for measuring memory usage
// Used by both vitest tests (headless) and in-game overlay.
// ═══════════════════════════════════════════════════════════════

// ─── V8 size estimation constants ─────────────────────────────
// Calibrated to V8 (Chrome/Node) internal object layouts.

/** Base overhead per JS object (hidden class + property backing store pointer). */
export const OBJ_BASE = 64;
/** Bytes per own property slot. */
export const OBJ_PROP = 8;
/** Heap-boxed number. */
export const NUM_SIZE = 8;
/** String header + 2 bytes per UTF-16 char. */
export const STR_HEADER = 40;
export const STR_CHAR = 2;
/** Array header (JSArray + FixedArray backing). */
export const ARR_HEADER = 64;
/** Bytes per array slot (pointer). */
export const ARR_SLOT = 8;
/** Map object header. */
export const MAP_HEADER = 64;
/** Approximate per-entry overhead in a V8 Map (key + value + hash bucket). */
export const MAP_ENTRY = 80;
/** TypedArray header overhead (ArrayBuffer + view). */
export const TYPED_ARRAY_HEADER = 64;

// ─── Size estimators ──────────────────────────────────────────

/**
 * Recursive shallow size estimator for any JS value.
 * Does NOT follow into prototypes or WeakRef targets.
 * Uses a `seen` Set to avoid infinite loops on circular refs.
 */
export function estimateObjectSize(obj: unknown, seen = new WeakSet<object>()): number {
  if (obj === null || obj === undefined) return 0;

  const t = typeof obj;
  if (t === 'number' || t === 'boolean') return NUM_SIZE;
  if (t === 'string') return STR_HEADER + (obj as string).length * STR_CHAR;

  if (t !== 'object' && t !== 'function') return 8; // symbol, bigint, etc.

  const o = obj as object;
  if (seen.has(o)) return 0; // already counted
  seen.add(o);

  // TypedArray
  if (ArrayBuffer.isView(o)) {
    return estimateTypedArraySize(o as { byteLength: number });
  }

  // Array
  if (Array.isArray(o)) {
    let size = ARR_HEADER + o.length * ARR_SLOT;
    for (const item of o) size += estimateObjectSize(item, seen);
    return size;
  }

  // Map
  if (o instanceof Map) {
    let size = MAP_HEADER + o.size * MAP_ENTRY;
    for (const [k, v] of o) {
      size += estimateObjectSize(k, seen) + estimateObjectSize(v, seen);
    }
    return size;
  }

  // Set
  if (o instanceof Set) {
    let size = MAP_HEADER + o.size * MAP_ENTRY;
    for (const v of o) size += estimateObjectSize(v, seen);
    return size;
  }

  // Plain object
  const keys = Object.keys(o);
  let size = OBJ_BASE + keys.length * OBJ_PROP;
  for (const key of keys) {
    const val = (o as Record<string, unknown>)[key];
    // Skip Phaser/DOM objects — they're GPU-side, not our concern
    if (val !== null && typeof val === 'object' && val.constructor?.name?.startsWith('Phaser')) continue;
    if (typeof HTMLElement !== 'undefined' && val instanceof HTMLElement) continue;
    size += estimateObjectSize(val, seen);
  }
  return size;
}

/**
 * Specialized estimator for HUnit's 50+ fields.
 * Returns a breakdown of costs by field category.
 */
export function estimateHUnitSize(unit: Record<string, unknown>): {
  total: number;
  scalars: number;
  strings: number;
  pathWaypoints: number;
  workflow: number;
  mods: number;
  carrying: number;
  otherRefs: number;
} {
  let scalars = 0;
  let strings = 0;
  let pathWaypoints = 0;
  let workflow = 0;
  let mods = 0;
  let carrying = 0;
  let otherRefs = 0;

  for (const [key, val] of Object.entries(unit)) {
    // Skip Phaser sprite refs — they're GPU objects
    if (key === 'sprite' || key === 'carrySprite' || key === 'equipSprite' ||
        key === 'equipDragSprite') continue;

    if (val === null || val === undefined) {
      scalars += 8;
      continue;
    }

    const t = typeof val;
    if (t === 'number' || t === 'boolean') {
      scalars += NUM_SIZE;
    } else if (t === 'string') {
      if (key === 'type' || key === 'carrying' || key === 'equipment' ||
          key === 'equipVisualApplied' || key === 'animState') {
        carrying += STR_HEADER + (val as string).length * STR_CHAR;
      } else {
        strings += STR_HEADER + (val as string).length * STR_CHAR;
      }
    } else if (key === 'pathWaypoints') {
      const wp = val as { x: number; y: number }[] | null;
      if (wp) {
        pathWaypoints += ARR_HEADER + wp.length * ARR_SLOT;
        pathWaypoints += wp.length * (OBJ_BASE + 2 * OBJ_PROP + 2 * NUM_SIZE);
      }
    } else if (key === 'loop') {
      const w = val as Record<string, unknown>;
      workflow += OBJ_BASE + Object.keys(w).length * OBJ_PROP;
      if (w.steps && Array.isArray(w.steps)) {
        workflow += ARR_HEADER + w.steps.length * ARR_SLOT;
        for (const step of w.steps) {
          workflow += estimateObjectSize(step);
        }
      }
      if (typeof w.label === 'string') {
        workflow += STR_HEADER + (w.label as string).length * STR_CHAR;
      }
      workflow += NUM_SIZE * 3; // currentStep, loopFrom, playedOnce
    } else if (key === 'mods') {
      const m = val as Record<string, unknown>;
      mods += OBJ_BASE + Object.keys(m).length * OBJ_PROP;
      for (const v of Object.values(m)) {
        if (typeof v === 'string') mods += STR_HEADER + v.length * STR_CHAR;
        else mods += NUM_SIZE;
      }
    } else {
      otherRefs += estimateObjectSize(val);
    }
  }

  return {
    total: OBJ_BASE + Object.keys(unit).length * OBJ_PROP + scalars + strings +
           pathWaypoints + workflow + mods + carrying + otherRefs,
    scalars,
    strings,
    pathWaypoints,
    workflow,
    mods,
    carrying,
    otherRefs,
  };
}

/** Measure Map overhead + entry sizes. */
export function estimateMapSize(map: Map<unknown, unknown>): number {
  let size = MAP_HEADER + map.size * MAP_ENTRY;
  const seen = new WeakSet<object>();
  for (const [k, v] of map) {
    size += estimateObjectSize(k, seen) + estimateObjectSize(v, seen);
  }
  return size;
}

/** TypedArray: byteLength + header overhead. */
export function estimateTypedArraySize(arr: { byteLength: number }): number {
  return arr.byteLength + TYPED_ARRAY_HEADER;
}

// ─── Formatting ────────────────────────────────────────────────

/** Human-readable byte formatting: "1.2 MB", "384 KB", "64 B". */
export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  return `${(n / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

// ─── Heap usage ────────────────────────────────────────────────

export interface HeapInfo {
  heapUsed: number;
  heapTotal: number;
  external: number;
  rss: number;
}

/** Get current heap usage. Node: process.memoryUsage(). Browser: performance.memory. */
export function getHeapUsage(): HeapInfo {
  // Node.js
  if (typeof process !== 'undefined' && process.memoryUsage) {
    const m = process.memoryUsage();
    return { heapUsed: m.heapUsed, heapTotal: m.heapTotal, external: m.external, rss: m.rss };
  }
  // Chrome (non-standard)
  const perf = performance as any;
  if (perf.memory) {
    return {
      heapUsed: perf.memory.usedJSHeapSize,
      heapTotal: perf.memory.totalJSHeapSize,
      external: 0,
      rss: perf.memory.jsHeapSizeLimit,
    };
  }
  return { heapUsed: 0, heapTotal: 0, external: 0, rss: 0 };
}

// ─── Snapshots & diffs ─────────────────────────────────────────

export interface MemorySnapshot {
  timestamp: number;
  heap: HeapInfo;
  label: string;
}

export function takeSnapshot(label: string): MemorySnapshot {
  return {
    timestamp: Date.now(),
    heap: getHeapUsage(),
    label,
  };
}

export interface SnapshotDiff {
  heapUsedDelta: number;
  heapTotalDelta: number;
  externalDelta: number;
  rssDelta: number;
  durationMs: number;
  from: string;
  to: string;
}

export function diffSnapshots(before: MemorySnapshot, after: MemorySnapshot): SnapshotDiff {
  return {
    heapUsedDelta: after.heap.heapUsed - before.heap.heapUsed,
    heapTotalDelta: after.heap.heapTotal - before.heap.heapTotal,
    externalDelta: after.heap.external - before.heap.external,
    rssDelta: after.heap.rss - before.heap.rss,
    durationMs: after.timestamp - before.timestamp,
    from: before.label,
    to: after.label,
  };
}
