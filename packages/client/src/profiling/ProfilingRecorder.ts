// ═══════════════════════════════════════════════════════════════
// ProfilingRecorder.ts — Records per-frame profiling data over a
// session and generates a downloadable performance report (F9).
// ═══════════════════════════════════════════════════════════════

import type { ProfilingData } from './MemoryOverlay';
import { getHeapUsage, formatBytes } from './memory-utils';

interface FrameSnapshot {
  t: number;       // timestamp (ms)
  delta: number;   // frame delta (ms)
  heap: number;    // heapUsed bytes
  units: number;   // alive unit count
  timings: Record<string, number>;
}

export class ProfilingRecorder {
  private scene: any;
  private recording = false;
  private snapshots: FrameSnapshot[] = [];
  private startTime = 0;
  private badge: HTMLDivElement | null = null;
  private readonly SAMPLE_INTERVAL_MS = 250; // sample every 250ms to keep data manageable
  private sampleAccum = 0;

  constructor(scene: any) {
    this.scene = scene;
  }

  toggle() {
    if (this.recording) {
      this.stop();
    } else {
      this.start();
    }
  }

  update(delta: number) {
    if (!this.recording) return;

    this.sampleAccum += delta;
    if (this.sampleAccum < this.SAMPLE_INTERVAL_MS) return;
    this.sampleAccum = 0;

    const data: ProfilingData | null =
      typeof this.scene.getProfilingData === 'function'
        ? this.scene.getProfilingData()
        : null;

    const heap = getHeapUsage();

    this.snapshots.push({
      t: performance.now(),
      delta,
      heap: heap.heapUsed,
      units: data?.aliveUnits ?? 0,
      timings: data?.perfTimings ? { ...data.perfTimings } : {},
    });

    this.updateBadge();
  }

  finalize() {
    if (this.recording) {
      this.stop();
    }
  }

  destroy() {
    this.recording = false;
    this.snapshots = [];
    this.removeBadge();
  }

  // ─── Internal ─────────────────────────────────────────────

  private start() {
    this.recording = true;
    this.snapshots = [];
    this.sampleAccum = 0;
    this.startTime = performance.now();
    this.showBadge();
  }

  private stop() {
    this.recording = false;
    const report = this.buildReport();
    this.downloadReport(report);
    this.removeBadge();
  }

  private showBadge() {
    if (this.badge) return;
    const el = document.createElement('div');
    el.id = 'profiling-recorder-badge';
    el.style.cssText = `
      position: fixed;
      top: 10px;
      right: 10px;
      background: rgba(200, 0, 0, 0.85);
      color: #fff;
      font-family: 'Courier New', monospace;
      font-size: 12px;
      padding: 6px 12px;
      border-radius: 4px;
      z-index: 10001;
      pointer-events: none;
    `;
    el.textContent = '● REC 0s';
    (document.getElementById('game-container') ?? document.body).appendChild(el);
    this.badge = el;
  }

  private updateBadge() {
    if (!this.badge) return;
    const elapsed = ((performance.now() - this.startTime) / 1000).toFixed(0);
    this.badge.textContent = `● REC ${elapsed}s (${this.snapshots.length} samples)`;
  }

  private removeBadge() {
    if (this.badge) {
      this.badge.remove();
      this.badge = null;
    }
  }

  private buildReport(): string {
    const snaps = this.snapshots;
    if (snaps.length === 0) return 'No profiling data recorded.';

    const duration = ((snaps[snaps.length - 1].t - snaps[0].t) / 1000).toFixed(1);
    const heapStart = snaps[0].heap;
    const heapEnd = snaps[snaps.length - 1].heap;
    const heapPeak = Math.max(...snaps.map(s => s.heap));

    // Timing averages
    const timingKeys = new Set<string>();
    for (const s of snaps) {
      for (const k of Object.keys(s.timings)) timingKeys.add(k);
    }

    const timingAvgs: Record<string, string> = {};
    for (const key of timingKeys) {
      const vals = snaps.map(s => s.timings[key] ?? 0).filter(v => v > 0);
      if (vals.length > 0) {
        const avg = vals.reduce((a, b) => a + b, 0) / vals.length;
        const max = Math.max(...vals);
        timingAvgs[key] = `avg ${avg.toFixed(2)}ms, max ${max.toFixed(2)}ms`;
      }
    }

    // Unit count
    const unitPeak = Math.max(...snaps.map(s => s.units));
    const unitAvg = (snaps.reduce((a, s) => a + s.units, 0) / snaps.length).toFixed(0);

    const lines: string[] = [
      `Prompt Battle — Profiling Report`,
      `Generated: ${new Date().toISOString()}`,
      `Duration: ${duration}s | Samples: ${snaps.length}`,
      ``,
      `── HEAP ──`,
      `  Start: ${formatBytes(heapStart)}`,
      `  End:   ${formatBytes(heapEnd)}`,
      `  Peak:  ${formatBytes(heapPeak)}`,
      `  Delta: ${formatBytes(heapEnd - heapStart)}`,
      ``,
      `── UNITS ──`,
      `  Avg: ${unitAvg} | Peak: ${unitPeak}`,
      ``,
      `── FRAME TIMINGS ──`,
    ];

    for (const [key, val] of Object.entries(timingAvgs)) {
      lines.push(`  ${key}: ${val}`);
    }

    // CSV section for detailed analysis
    lines.push('', '── RAW DATA (CSV) ──');
    const csvKeys = Array.from(timingKeys);
    lines.push(['time_ms', 'delta_ms', 'heap_bytes', 'units', ...csvKeys].join(','));
    for (const s of snaps) {
      const row = [
        (s.t - snaps[0].t).toFixed(0),
        s.delta.toFixed(1),
        s.heap,
        s.units,
        ...csvKeys.map(k => (s.timings[k] ?? 0).toFixed(2)),
      ];
      lines.push(row.join(','));
    }

    return lines.join('\n');
  }

  private downloadReport(content: string) {
    const blob = new Blob([content], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `profiling-${new Date().toISOString().replace(/[:.]/g, '-')}.txt`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }
}
