// ═══════════════════════════════════════════════════════════════
// MemoryOverlay.ts — In-game HTML overlay for live memory/perf stats
// Toggle with Ctrl+M. Updates at 1 Hz to avoid impacting game perf.
// ═══════════════════════════════════════════════════════════════

import {
  estimateObjectSize,
  estimateMapSize,
  estimateTypedArraySize,
  formatBytes,
  getHeapUsage,
} from './memory-utils';

// ─── Types ────────────────────────────────────────────────────

export interface ProfilingData {
  unitCount: number;
  aliveUnits: number;
  units: unknown[];
  spatialGridSize: number;
  nearbyCacheSize: number;
  framePathCacheSize: number;
  avoidPenaltyCount: number;
  avoidPoolCount: number;
  groundItemCount: number;
  pendingHitCount: number;
  campCount: number;
  towerCount: number;
  fogEnabled: boolean;
  perfTimings: Record<string, number>;
  frameTimes: number[];
  frameCount: number;
  pathQueueLength: number;
}

interface TrendPoint {
  time: number;
  heapUsed: number;
  unitCount: number;
}

// ─── Overlay ──────────────────────────────────────────────────

export class MemoryOverlay {
  private scene: any; // Phaser.Scene — avoid importing Phaser at module level
  private el: HTMLDivElement | null = null;
  private visible = false;
  private updateTimer = 0;
  private trendHistory: TrendPoint[] = [];
  private readonly TREND_WINDOW_MS = 30000; // 30 seconds of history
  private readonly UPDATE_INTERVAL_MS = 1000; // 1 Hz updates

  constructor(scene: any) {
    this.scene = scene;
  }

  toggle() {
    this.visible = !this.visible;
    if (this.visible) {
      this.createEl();
    } else {
      this.destroyEl();
    }
  }

  update(delta: number) {
    if (!this.visible || !this.el) return;

    this.updateTimer += delta;
    if (this.updateTimer < this.UPDATE_INTERVAL_MS) return;
    this.updateTimer = 0;

    this.refresh();
  }

  destroy() {
    this.destroyEl();
  }

  // ─── Internal ─────────────────────────────────────────────

  private createEl() {
    if (this.el) return;

    const el = document.createElement('div');
    el.id = 'memory-overlay';
    el.style.cssText = `
      position: fixed;
      top: 10px;
      left: 10px;
      width: 420px;
      max-height: 90vh;
      overflow-y: auto;
      background: rgba(0, 0, 0, 0.92);
      color: #e0e0e0;
      font-family: 'Courier New', monospace;
      font-size: 11px;
      line-height: 1.4;
      padding: 12px;
      border: 1px solid #444;
      border-radius: 6px;
      z-index: 10000;
      pointer-events: auto;
      user-select: text;
    `;
    (document.getElementById('game-container') ?? document.body).appendChild(el);
    this.el = el;
    this.refresh();
  }

  private destroyEl() {
    if (this.el) {
      this.el.remove();
      this.el = null;
    }
  }

  private refresh() {
    if (!this.el) return;

    const data: ProfilingData | null =
      typeof this.scene.getProfilingData === 'function'
        ? this.scene.getProfilingData()
        : null;

    const heap = getHeapUsage();
    const now = Date.now();

    // Record trend
    this.trendHistory.push({
      time: now,
      heapUsed: heap.heapUsed,
      unitCount: data?.aliveUnits ?? 0,
    });
    // Prune old entries
    while (this.trendHistory.length > 0 && now - this.trendHistory[0].time > this.TREND_WINDOW_MS) {
      this.trendHistory.shift();
    }

    let html = '<div style="color:#ffd700;font-size:13px;font-weight:bold;margin-bottom:8px">MEMORY PROFILER (Ctrl+M)</div>';

    // ── Section 1: Heap ──
    html += this.renderHeap(heap);

    // ── Section 2: Subsystems ──
    if (data) {
      html += this.renderSubsystems(data);

      // ── Section 3: Frame budget ──
      html += this.renderFrameBudget(data);
    }

    // ── Section 4: Trends ──
    html += this.renderTrends();

    this.el.innerHTML = html;
  }

  private renderHeap(heap: ReturnType<typeof getHeapUsage>): string {
    const pct = heap.heapTotal > 0 ? (heap.heapUsed / heap.heapTotal) * 100 : 0;
    const barWidth = 200;
    const filledWidth = Math.round((pct / 100) * barWidth);
    const barColor = pct > 80 ? '#ff4444' : pct > 60 ? '#ffaa00' : '#44ff44';

    // GC pressure estimate
    let gcPressure = '—';
    if (this.trendHistory.length >= 5) {
      const recent = this.trendHistory.slice(-5);
      const dt = (recent[recent.length - 1].time - recent[0].time) / 1000;
      const dHeap = recent[recent.length - 1].heapUsed - recent[0].heapUsed;
      if (dt > 0) {
        gcPressure = `${(dHeap / dt / (1024 * 1024)).toFixed(2)} MB/s`;
      }
    }

    return `
      <div style="margin-bottom:10px;padding:6px;border:1px solid #333;border-radius:4px">
        <div style="color:#88bbff;font-weight:bold;margin-bottom:4px">HEAP</div>
        <div>Used: ${formatBytes(heap.heapUsed)} / ${formatBytes(heap.heapTotal)}</div>
        <div style="background:#222;width:${barWidth}px;height:10px;border-radius:3px;margin:4px 0">
          <div style="background:${barColor};width:${filledWidth}px;height:10px;border-radius:3px"></div>
        </div>
        <div>Utilization: ${pct.toFixed(1)}% | GC Pressure: ${gcPressure}</div>
        ${heap.rss > 0 ? `<div>RSS: ${formatBytes(heap.rss)} | External: ${formatBytes(heap.external)}</div>` : ''}
      </div>
    `;
  }

  private renderSubsystems(data: ProfilingData): string {
    const WORLD_W = 6400, WORLD_H = 6400;
    const fogRTEstimate = data.fogEnabled ? WORLD_W * WORLD_H * 4 : 0;
    const fogBrushes = data.fogEnabled ? (256 * 256 * 4 + 512 * 512 * 4) : 0;
    const astarFixed = 7 * (10000 + 64) + 4 * (10000 * 4 + 64);
    const astarAvoid = data.avoidPenaltyCount * (10000 * 4 + 64);
    const astarPool = data.avoidPoolCount * (10000 * 4 + 64);

    const subsystems = [
      { name: 'Units',         size: '~',          count: data.aliveUnits,       perItem: '~1-2 KB' },
      { name: 'Spatial Grid',  size: formatBytes(data.spatialGridSize),  count: '-',  perItem: '-' },
      { name: 'Nearby Cache',  size: formatBytes(data.nearbyCacheSize),  count: '-',  perItem: '-' },
      { name: 'Path Cache',    size: formatBytes(data.framePathCacheSize), count: '-', perItem: '-' },
      { name: 'A* Fixed',      size: formatBytes(astarFixed),           count: '7 buffers',  perItem: '-' },
      { name: 'A* Avoid',      size: formatBytes(astarAvoid + astarPool), count: `${data.avoidPenaltyCount}+${data.avoidPoolCount}`, perItem: formatBytes(10000 * 4 + 64) },
      { name: 'Fog RT (GPU)',  size: formatBytes(fogRTEstimate + fogBrushes), count: data.fogEnabled ? '1' : '0', perItem: '-' },
      { name: 'Ground Items',  size: '~',          count: data.groundItemCount,  perItem: '~200 B' },
      { name: 'Pending Hits',  size: '~',          count: data.pendingHitCount,  perItem: '~400 B' },
      { name: 'Camps',         size: '~',          count: data.campCount,        perItem: '~500 B' },
      { name: 'Towers',        size: '~',          count: data.towerCount,       perItem: '~300 B' },
    ];

    let rows = '';
    for (const s of subsystems) {
      rows += `<tr><td style="padding:1px 6px">${s.name}</td><td style="padding:1px 6px;text-align:right">${s.size}</td><td style="padding:1px 6px;text-align:right">${s.count}</td><td style="padding:1px 6px;text-align:right">${s.perItem}</td></tr>`;
    }

    return `
      <div style="margin-bottom:10px;padding:6px;border:1px solid #333;border-radius:4px">
        <div style="color:#88bbff;font-weight:bold;margin-bottom:4px">SUBSYSTEMS</div>
        <table style="width:100%;border-collapse:collapse">
          <tr style="color:#888;border-bottom:1px solid #333">
            <th style="text-align:left;padding:1px 6px">System</th>
            <th style="text-align:right;padding:1px 6px">Size</th>
            <th style="text-align:right;padding:1px 6px">Count</th>
            <th style="text-align:right;padding:1px 6px">Per-Item</th>
          </tr>
          ${rows}
        </table>
      </div>
    `;
  }

  private renderFrameBudget(data: ProfilingData): string {
    const timings = data.perfTimings;
    if (!timings || Object.keys(timings).length === 0) {
      return `
        <div style="margin-bottom:10px;padding:6px;border:1px solid #333;border-radius:4px">
          <div style="color:#88bbff;font-weight:bold;margin-bottom:4px">FRAME BUDGET</div>
          <div style="color:#888">No timing data yet (waiting for instrumented update loop)</div>
        </div>
      `;
    }

    const BUDGET = 16.67;
    const total = timings.total ?? 0;
    const totalColor = total > BUDGET ? '#ff4444' : total > BUDGET * 0.7 ? '#ffaa00' : '#44ff44';

    // Per-subsystem bars
    const subsystemOrder = ['spatial', 'idMaps', 'pathfinding', 'workflows', 'movement', 'combat', 'fog', 'sprites'];
    let rows = '';
    for (const key of subsystemOrder) {
      const ms = timings[key] ?? 0;
      const pct = (ms / BUDGET) * 100;
      const barW = Math.min(Math.round(pct * 1.5), 150);
      const color = pct > 25 ? '#ff4444' : pct > 10 ? '#ffaa00' : '#44ff44';
      rows += `
        <tr>
          <td style="padding:1px 6px">${key}</td>
          <td style="padding:1px 6px;text-align:right">${ms.toFixed(2)}ms</td>
          <td style="padding:1px 6px;text-align:right">${pct.toFixed(1)}%</td>
          <td style="padding:1px 6px"><div style="background:${color};width:${barW}px;height:8px;border-radius:2px"></div></td>
        </tr>
      `;
    }

    // FPS from frameTimes
    let fpsStr = '—';
    if (data.frameTimes.length > 0) {
      const avgDelta = data.frameTimes.reduce((a, b) => a + b, 0) / data.frameTimes.length;
      fpsStr = `${(1000 / avgDelta).toFixed(0)} fps (avg ${avgDelta.toFixed(1)}ms)`;
    }

    return `
      <div style="margin-bottom:10px;padding:6px;border:1px solid #333;border-radius:4px">
        <div style="color:#88bbff;font-weight:bold;margin-bottom:4px">FRAME BUDGET <span style="color:${totalColor}">${total.toFixed(2)}ms / ${BUDGET}ms</span></div>
        <div style="margin-bottom:4px">${fpsStr} | Frame #${data.frameCount} | PathQueue: ${data.pathQueueLength}</div>
        <table style="width:100%;border-collapse:collapse">
          <tr style="color:#888;border-bottom:1px solid #333">
            <th style="text-align:left;padding:1px 6px">System</th>
            <th style="text-align:right;padding:1px 6px">Time</th>
            <th style="text-align:right;padding:1px 6px">%</th>
            <th style="padding:1px 6px"></th>
          </tr>
          ${rows}
        </table>
      </div>
    `;
  }

  private renderTrends(): string {
    if (this.trendHistory.length < 3) {
      return `
        <div style="padding:6px;border:1px solid #333;border-radius:4px">
          <div style="color:#88bbff;font-weight:bold;margin-bottom:4px">TRENDS (30s)</div>
          <div style="color:#888">Collecting data...</div>
        </div>
      `;
    }

    const first = this.trendHistory[0];
    const last = this.trendHistory[this.trendHistory.length - 1];
    const dt = (last.time - first.time) / 1000;
    const heapDelta = last.heapUsed - first.heapUsed;
    const heapRate = dt > 0 ? heapDelta / dt : 0;

    const isGrowing = heapRate > 500 * 1024; // > 500 KB/s is suspicious
    const isLeaking = heapRate > 2 * 1024 * 1024; // > 2 MB/s is a leak

    let trendStatus = '<span style="color:#44ff44">STABLE</span>';
    if (isLeaking) {
      trendStatus = '<span style="color:#ff4444;font-weight:bold">LEAKING</span>';
    } else if (isGrowing) {
      trendStatus = '<span style="color:#ffaa00">GROWING</span>';
    }

    const unitDelta = last.unitCount - first.unitCount;

    return `
      <div style="padding:6px;border:1px solid #333;border-radius:4px">
        <div style="color:#88bbff;font-weight:bold;margin-bottom:4px">TRENDS (${dt.toFixed(0)}s) ${trendStatus}</div>
        <div>Heap: ${formatBytes(first.heapUsed)} → ${formatBytes(last.heapUsed)} (${heapDelta > 0 ? '+' : ''}${formatBytes(heapDelta)})</div>
        <div>Rate: ${(heapRate / (1024 * 1024)).toFixed(2)} MB/s</div>
        <div>Units: ${first.unitCount} → ${last.unitCount} (${unitDelta > 0 ? '+' : ''}${unitDelta})</div>
      </div>
    `;
  }
}
