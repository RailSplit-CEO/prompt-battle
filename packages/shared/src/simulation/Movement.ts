/**
 * Movement.ts — Pure simulation logic for unit movement, pathfinding, collision avoidance,
 * stuck detection, and formation movement. Extracted from HordeScene.updateMovement.
 */

import type {
  SimUnit,
  SimCamp,
  SimWorkflow,
  WorkflowStep,
  BehaviorMods,
  EquipBuffs,
  BannerAura,
  TeamBuffs,
  Pos,
} from './SimTypes';

import {
  WORLD_W,
  WORLD_H,
  TILE_SIZE,
  NIGHT_SPEED_PENALTY,
  PATH_CELL,
  PATH_GRID,
  MAX_PATHS_PER_FRAME,
  SPATIAL_KEY_STRIDE,
} from './Constants';

// ─── Helper types local to movement ───

export interface PathRequest {
  unit: SimUnit;
  targetX: number;
  targetY: number;
  callback: (path: { x: number; y: number }[] | null) => void;
}

/** Context object passed into updateMovement with all required external state */
export interface MovementContext {
  units: SimUnit[];
  tiles: number[][];
  walkableGrid: Uint8Array | null;
  walkGridRows: number;
  walkGridCols: number;
  staticBlockedGrid: Uint8Array | null;
  isNight: boolean;
  frameCount: number;
  stuckCheckCounter: number;
  camps: SimCamp[];
  defendedCamps: Set<string>;
  spatialGrid: Map<number, SimUnit[]>;
  spatialCellSize: number;
  framePathCache: Map<string, { x: number; y: number }[] | null>;
  pathsThisFrame: number;
  pathQueue: PathRequest[];
  /** Pre-allocated A* buffers */
  astarBlocked: Uint8Array;
  astarGScore: Float32Array;
  astarFScore: Float32Array;
  astarCameFrom: Int32Array;
  astarClosed: Uint8Array;
  astarInOpen: Uint8Array;
  astarOccupied: Uint8Array;
  frameOccupiedReady: boolean;
  frameAvoidPenalty: Map<string, Float32Array>;
  avoidPenaltyPool: Float32Array[];
  staticClearancePenalty: Float32Array;
  /** Callbacks for external lookups */
  getUnitEquipBuffs: (u: SimUnit) => EquipBuffs;
  getBannerAura: (u: SimUnit) => BannerAura;
  getBuffs: (team: 1 | 2) => TeamBuffs;
  isNearFriendlyBuilding: (u: SimUnit) => boolean;
  isNonCombatStep: (u: SimUnit) => boolean;
  getBootstrapAnimal: (wf: SimWorkflow) => string | undefined;
  getNearbyUnits: (x: number, y: number, radius: number) => SimUnit[];
  /** Base positions */
  p1Base: Pos;
  p2Base: Pos;
}

// ─── Tile walkability ───

export function isTileWalkable(
  worldX: number,
  worldY: number,
  walkableGrid: Uint8Array | null,
  walkGridRows: number,
  walkGridCols: number,
  tiles: number[][] | null,
): boolean {
  if (walkableGrid) {
    const col = Math.floor(worldX / TILE_SIZE);
    const row = Math.floor(worldY / TILE_SIZE);
    if (row < 0 || row >= walkGridRows || col < 0 || col >= walkGridCols) return true;
    return walkableGrid[row * walkGridCols + col] === 0;
  }
  // Fallback: original logic before grid is built
  if (tiles) {
    const col = Math.floor(worldX / TILE_SIZE);
    const row = Math.floor(worldY / TILE_SIZE);
    if (row < 0 || row >= tiles.length || col < 0 || col >= tiles[0].length) return true;
    const t = tiles[row][col];
    return t !== 2 && t !== 3; // water = 2, rock = 3
  }
  return true;
}

function _walkable(x: number, y: number, ctx: MovementContext): boolean {
  return isTileWalkable(x, y, ctx.walkableGrid, ctx.walkGridRows, ctx.walkGridCols, ctx.tiles);
}

// ─── Find walkable spawn (spiral outward) ───

export function findWalkableSpawn(
  x: number,
  y: number,
  walkableGrid: Uint8Array | null,
  walkGridRows: number,
  walkGridCols: number,
  tiles: number[][] | null,
): { x: number; y: number } {
  if (isTileWalkable(x, y, walkableGrid, walkGridRows, walkGridCols, tiles)) return { x, y };
  for (let r = 1; r <= 5; r++) {
    for (let a = 0; a < 8; a++) {
      const angle = (a / 8) * Math.PI * 2;
      const nx = x + Math.cos(angle) * r * TILE_SIZE;
      const ny = y + Math.sin(angle) * r * TILE_SIZE;
      if (isTileWalkable(nx, ny, walkableGrid, walkGridRows, walkGridCols, tiles)) return { x: nx, y: ny };
    }
  }
  return { x, y }; // give up
}

// ─── Nudge a stuck unit ───

export function nudgeUnit(u: SimUnit, ctx: MovementContext): void {
  const hdx = u.targetX - u.x;
  const hdy = u.targetY - u.y;
  const hd = Math.sqrt(hdx * hdx + hdy * hdy);
  if (hd < 1) return;
  const nx = hdx / hd, ny = hdy / hd;

  // Try 8 directions: perp, forward-diag, back-diag, backward, forward
  const dirs: [number, number][] = [
    [-ny, nx], [ny, -nx],                           // perpendicular
    [nx - ny, ny + nx], [nx + ny, ny - nx],         // forward-diagonal
    [-nx - ny, -ny + nx], [-nx + ny, -ny - nx],     // back-diagonal
    [-nx, -ny],                                      // backward
    [nx, ny],                                        // forward
  ];
  // Normalize directions
  const normDirs = dirs.map(([ddx, ddy]) => {
    const m = Math.sqrt(ddx * ddx + ddy * ddy);
    return m > 0.01 ? [ddx / m, ddy / m] as [number, number] : [ddx, ddy] as [number, number];
  });

  const distances = [40, 70, 100];
  for (const dist of distances) {
    for (const [px, py] of normDirs) {
      const testX = u.x + px * dist;
      const testY = u.y + py * dist;
      if (testX >= 0 && testX <= WORLD_W && testY >= 0 && testY <= WORLD_H && _walkable(testX, testY, ctx)) {
        u.x = testX;
        u.y = testY;
        u.pathWaypoints = null;
        u.pathAge = 9999; // force recomputation
        u.stuckCooldown = 60;
        return;
      }
    }
  }
}

// ─── Spread out (sector-based fan) ───

export function spreadOut(
  u: SimUnit,
  allUnits: SimUnit[],
  worldW: number,
  worldH: number,
): void {
  // Only pick a new target once we've reached the current one
  const dToTarget = Math.sqrt((u.x - u.targetX) ** 2 + (u.y - u.targetY) ** 2);
  if (dToTarget > 30) return;

  if (!u.loop) return;
  const step = u.loop.steps[u.loop.currentStep];
  if (!step) return;

  // Gather all allies on the same workflow action
  const searchers = allUnits.filter(a =>
    !a.dead && a.team === u.team
    && a.loop && a.loop.steps[a.loop.currentStep]?.action === step.action);

  const cx = worldW / 2, cy = worldH / 2;

  if (searchers.length <= 1) {
    // Solo — random direction from map center
    const angle = Math.random() * Math.PI * 2;
    const range = 300 + Math.random() * 500;
    u.targetX = Math.max(100, Math.min(worldW - 100, cx + Math.cos(angle) * range));
    u.targetY = Math.max(100, Math.min(worldH - 100, cy + Math.sin(angle) * range));
    return;
  }

  // Sort searchers by ID for stable sector assignment
  searchers.sort((a, b) => a.id - b.id);
  const myIndex = searchers.indexOf(u);
  const n = searchers.length;

  // Each unit gets a unique sector wedge from the map center
  const sectorAngle = (2 * Math.PI) / n;
  const baseAngle = sectorAngle * myIndex;
  // Add small random jitter within the sector
  const angle = baseAngle + (Math.random() * 0.6 - 0.3) * sectorAngle;
  const range = 400 + Math.random() * 600;

  u.targetX = Math.max(100, Math.min(worldW - 100, cx + Math.cos(angle) * range));
  u.targetY = Math.max(100, Math.min(worldH - 100, cy + Math.sin(angle) * range));
}

// ─── Line of sight check for path smoothing ───

function lineOfSightClear(
  a: { x: number; y: number },
  b: { x: number; y: number },
  blocked: Uint8Array,
  G: number,
  CELL: number,
): boolean {
  const dx = b.x - a.x, dy = b.y - a.y;
  const dist = Math.sqrt(dx * dx + dy * dy);
  const steps = Math.ceil(dist / (CELL * 0.5));
  for (let i = 0; i <= steps; i++) {
    const t = i / Math.max(steps, 1);
    const px = a.x + dx * t, py = a.y + dy * t;
    const gx = Math.floor(px / CELL), gy = Math.floor(py / CELL);
    if (gx >= 0 && gx < G && gy >= 0 && gy < G && blocked[gy * G + gx]) return false;
  }
  return true;
}

// ─── A* safe pathfinding ───

export function computeSafePath(
  u: SimUnit,
  rockOnly: boolean,
  ctx: MovementContext,
): { x: number; y: number }[] | null {
  const CELL = PATH_CELL;
  const G = PATH_GRID;
  const team = u.team as 1 | 2;
  const avoidRange = u.mods.caution === 'safe' ? 250 : 180;

  // 1. Build blocked grid — copy from cached static grid
  const blocked = ctx.astarBlocked;
  if (ctx.staticBlockedGrid) {
    blocked.set(ctx.staticBlockedGrid);
  } else {
    blocked.fill(0);
    const tiles = ctx.tiles;
    if (tiles) {
      for (let gy = 0; gy < G && gy < tiles.length; gy++) {
        for (let gx = 0; gx < G && gx < tiles[0].length; gx++) {
          if (tiles[gy][gx] === 2 || tiles[gy][gx] === 3) blocked[gy * G + gx] = 1;
        }
      }
    }
  }

  // Soft avoidance penalty grid — cached per-frame by team + rockOnly
  const avoidKey = `${team}_${rockOnly}_${avoidRange}`;
  let avoidPenalty: Float32Array;
  if (ctx.frameAvoidPenalty.has(avoidKey)) {
    avoidPenalty = ctx.frameAvoidPenalty.get(avoidKey)!;
  } else {
    avoidPenalty = ctx.avoidPenaltyPool.pop() || new Float32Array(G * G);
    avoidPenalty.fill(0);
    if (!rockOnly) {
      for (const o of ctx.units) {
        if (o.dead || o.team === team || (o.team === 0 && o.campId === null)) continue;
        const ocx = Math.floor(o.x / CELL);
        const ocy = Math.floor(o.y / CELL);
        const r = Math.ceil(avoidRange / CELL);
        for (let dy = -r; dy <= r; dy++) {
          for (let dx = -r; dx <= r; dx++) {
            const gx = ocx + dx, gy = ocy + dy;
            if (gx < 0 || gx >= G || gy < 0 || gy >= G) continue;
            const cx = (gx + 0.5) * CELL, cy = (gy + 0.5) * CELL;
            const dist2 = (cx - o.x) ** 2 + (cy - o.y) ** 2;
            if (dist2 < avoidRange * avoidRange) {
              const t = 1 - Math.sqrt(dist2) / avoidRange;
              avoidPenalty[gy * G + gx] = Math.max(avoidPenalty[gy * G + gx], 2 + 6 * t);
            }
          }
        }
      }

      // Soft penalty near hostile camps
      const targetAnimal = u.loop ? ctx.getBootstrapAnimal(u.loop) : undefined;
      const campRange = avoidRange * 1.5;
      for (const c of ctx.camps) {
        if (c.owner === team) continue;
        if (targetAnimal && c.animalType === targetAnimal) continue;
        if (!ctx.defendedCamps.has(c.id) && c.owner === 0) continue;
        const ccx = Math.floor(c.x / CELL);
        const ccy = Math.floor(c.y / CELL);
        const r = Math.ceil(campRange / CELL);
        for (let dy = -r; dy <= r; dy++) {
          for (let dx = -r; dx <= r; dx++) {
            const gx = ccx + dx, gy = ccy + dy;
            if (gx < 0 || gx >= G || gy < 0 || gy >= G) continue;
            const cx = (gx + 0.5) * CELL, cy = (gy + 0.5) * CELL;
            const dist2 = (cx - c.x) ** 2 + (cy - c.y) ** 2;
            if (dist2 < campRange * campRange) {
              const t = 1 - Math.sqrt(dist2) / campRange;
              avoidPenalty[gy * G + gx] = Math.max(avoidPenalty[gy * G + gx], 3 + 7 * t);
            }
          }
        }
      }
    }
    ctx.frameAvoidPenalty.set(avoidKey, avoidPenalty);
  }

  // 2. A* search (8-directional)
  const sx = Math.max(0, Math.min(G - 1, Math.floor(u.x / CELL)));
  const sy = Math.max(0, Math.min(G - 1, Math.floor(u.y / CELL)));
  const ex = Math.max(0, Math.min(G - 1, Math.floor(u.targetX / CELL)));
  const ey = Math.max(0, Math.min(G - 1, Math.floor(u.targetY / CELL)));

  // Unblock start and end
  blocked[sy * G + sx] = 0;
  blocked[ey * G + ex] = 0;

  if (sx === ex && sy === ey) return [];

  const clearancePenalty = ctx.staticClearancePenalty;

  // Per-frame cached unit occupancy grid
  if (!ctx.frameOccupiedReady) {
    ctx.astarOccupied.fill(0);
    for (const o of ctx.units) {
      if (o.dead) continue;
      const ox = Math.floor(o.x / CELL), oy = Math.floor(o.y / CELL);
      if (ox >= 0 && ox < G && oy >= 0 && oy < G) ctx.astarOccupied[oy * G + ox] = 1;
    }
    ctx.frameOccupiedReady = true;
  }
  const occupied = ctx.astarOccupied;

  // Reuse scratch typed arrays
  const gScore = ctx.astarGScore; gScore.fill(Infinity);
  const fScore = ctx.astarFScore; fScore.fill(Infinity);
  const cameFrom = ctx.astarCameFrom; cameFrom.fill(-1);
  const closed = ctx.astarClosed; closed.fill(0);

  const si = sy * G + sx;
  gScore[si] = 0;
  fScore[si] = Math.max(Math.abs(ex - sx), Math.abs(ey - sy)); // Chebyshev heuristic

  // Binary min-heap on fScore
  const heap: number[] = [si];
  const inOpen = ctx.astarInOpen; inOpen.fill(0);
  inOpen[si] = 1;

  const heapPush = (node: number) => {
    heap.push(node);
    let i = heap.length - 1;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (fScore[heap[i]] < fScore[heap[parent]]) {
        const tmp = heap[i]; heap[i] = heap[parent]; heap[parent] = tmp;
        i = parent;
      } else break;
    }
  };

  const heapPop = (): number => {
    const top = heap[0];
    const last = heap.pop()!;
    if (heap.length > 0) {
      heap[0] = last;
      let i = 0;
      const len = heap.length;
      while (true) {
        let smallest = i;
        const l = 2 * i + 1, r = 2 * i + 2;
        if (l < len && fScore[heap[l]] < fScore[heap[smallest]]) smallest = l;
        if (r < len && fScore[heap[r]] < fScore[heap[smallest]]) smallest = r;
        if (smallest === i) break;
        const tmp = heap[i]; heap[i] = heap[smallest]; heap[smallest] = tmp;
        i = smallest;
      }
    }
    return top;
  };

  const dirs = [[-1, 0, 1], [1, 0, 1], [0, -1, 1], [0, 1, 1], [-1, -1, 1.414], [-1, 1, 1.414], [1, -1, 1.414], [1, 1, 1.414]];
  let found = false;
  let iters = 0;
  const manhattan = Math.abs(ex - sx) + Math.abs(ey - sy);
  const MAX_ITERS = Math.min(10000, manhattan * 50 + 500);

  while (heap.length > 0 && iters < MAX_ITERS) {
    iters++;
    const cur = heapPop();
    inOpen[cur] = 0;

    if (closed[cur]) continue;

    const curX = cur % G, curY = (cur - curX) / G;
    if (curX === ex && curY === ey) { found = true; break; }

    closed[cur] = 1;

    for (const [ddx, ddy, cost] of dirs) {
      const nextX = curX + ddx, nextY = curY + ddy;
      if (nextX < 0 || nextX >= G || nextY < 0 || nextY >= G) continue;
      const ni = nextY * G + nextX;
      if (closed[ni] || blocked[ni]) continue;

      const penalty = clearancePenalty[ni] + avoidPenalty[ni] + (occupied[ni] ? 2 : 0);

      const tentG = gScore[cur] + cost + penalty;
      if (tentG < gScore[ni]) {
        cameFrom[ni] = cur;
        gScore[ni] = tentG;
        fScore[ni] = tentG + Math.max(Math.abs(ex - nextX), Math.abs(ey - nextY));
        if (!inOpen[ni]) { heapPush(ni); inOpen[ni] = 1; }
      }
    }
  }

  if (!found) {
    return null;
  }

  // 3. Reconstruct path
  const rawPath: { x: number; y: number }[] = [];
  let ci = ey * G + ex;
  while (ci !== si && ci >= 0) {
    const px = ci % G, py = (ci - px) / G;
    rawPath.unshift({ x: (px + 0.5) * CELL, y: (py + 0.5) * CELL });
    ci = cameFrom[ci];
  }

  // 4. Smooth path — skip waypoints with clear line of sight
  if (rawPath.length <= 2) return rawPath;
  const smoothed: { x: number; y: number }[] = [rawPath[0]];
  let anchor = 0;
  while (anchor < rawPath.length - 1) {
    let furthest = anchor + 1;
    for (let test = rawPath.length - 1; test > anchor + 1; test--) {
      if (lineOfSightClear(rawPath[anchor], rawPath[test], blocked, G, CELL)) {
        furthest = test;
        break;
      }
    }
    smoothed.push(rawPath[furthest]);
    anchor = furthest;
  }
  return smoothed;
}

// ─── Main movement update ───

/**
 * Updates movement for all units. Mutates unit positions in place.
 * Returns updated stuckCheckCounter and pathsThisFrame for the caller to store.
 */
export function updateMovement(
  dt: number,
  ctx: MovementContext,
): { stuckCheckCounter: number; pathsThisFrame: number; frameOccupiedReady: boolean } {
  let { stuckCheckCounter, pathsThisFrame } = ctx;

  // ─── Stuck detection (every 60 frames) ───
  stuckCheckCounter++;
  if (stuckCheckCounter % 60 === 0) {
    for (const u of ctx.units) {
      if (u.dead || u.team === 0) continue;
      if (u.stuckCooldown > 0) { u.stuckCooldown--; continue; }
      const checkDx = u.x - u.lastCheckX;
      const checkDy = u.y - u.lastCheckY;
      const checkDist2 = checkDx * checkDx + checkDy * checkDy;
      if (checkDist2 < 25) { // 5*5 = 25
        u.stuckFrames++;
        if (u.stuckFrames >= 2) {
          nudgeUnit(u, ctx);
          u.stuckFrames = 0;
        }
      } else {
        u.stuckFrames = 0;
      }
      u.lastCheckX = u.x;
      u.lastCheckY = u.y;
    }
  }

  const defendedCamps = ctx.defendedCamps;

  // Pre-compute tight formation groups
  const tightGroups = new Map<string, SimUnit[]>();
  for (const u of ctx.units) {
    if (u.dead || u.mods.formation !== 'tight') continue;
    const k = `${u.team}_${u.type}`;
    const g = tightGroups.get(k);
    if (g) g.push(u); else tightGroups.set(k, [u]);
  }

  for (const u of ctx.units) {
    if (u.dead) continue;

    let dx = u.targetX - u.x, dy = u.targetY - u.y;
    const d2 = dx * dx + dy * dy;
    if (d2 < 25) { u.pathWaypoints = null; continue; } // 5*5 = 25
    const d = Math.sqrt(d2);

    // Tick pathAge for all units
    u.pathAge += dt * 1000;

    // ─── A* PATHFINDING for all player units ───
    if (u.team !== 0) {
      const astarTeam = u.team as 1 | 2;
      const isSafeMover = ctx.isNonCombatStep(u) && u.mods.caution !== 'aggressive';

      // Check if path needs recomputation
      const targetMoved = Math.abs(u.pathTargetX - u.targetX) > 256 || Math.abs(u.pathTargetY - u.targetY) > 256;
      const pathStale = u.pathAge > 3000;
      const needsPath = !u.pathWaypoints?.length || targetMoved || pathStale;

      if (needsPath) {
        const routeDx = u.targetX - u.x, routeDy = u.targetY - u.y;
        const routeLen = Math.sqrt(routeDx * routeDx + routeDy * routeDy);
        const _CELL = PATH_CELL;
        const _G = PATH_GRID;
        const halfCell = _CELL * 0.5;
        const sampleCount = Math.max(2, Math.ceil(routeLen / halfCell));
        let obstacleOnRoute = false;

        // Grid cell-walk: sample at half-cell intervals
        if (ctx.staticBlockedGrid) {
          for (let si = 0; si <= sampleCount && !obstacleOnRoute; si++) {
            const t = si / Math.max(sampleCount, 1);
            const sx = u.x + routeDx * t, sy = u.y + routeDy * t;
            const gx = Math.floor(sx / _CELL), gy = Math.floor(sy / _CELL);
            if (gx >= 0 && gx < _G && gy >= 0 && gy < _G && ctx.staticBlockedGrid[gy * _G + gx] === 1) {
              obstacleOnRoute = true;
            }
          }
        }

        // Skip A* for very close targets with no obstacle
        if (routeLen < 192 && !obstacleOnRoute) { u.pathWaypoints = null; }

        // Reduced threat route sampling — 3 points
        let threatOnRoute = false;
        if (isSafeMover) {
          const astarAvoid = u.mods.caution === 'safe' ? 360 : 250;
          const threatSamples = [0, 0.5, 1];
          for (let si = 0; si < threatSamples.length && !threatOnRoute; si++) {
            const t = threatSamples[si];
            const sx = u.x + routeDx * t, sy = u.y + routeDy * t;
            const nearbyThreats = ctx.getNearbyUnits(sx, sy, astarAvoid);
            for (const o of nearbyThreats) {
              if (o.dead || o.team === astarTeam) continue;
              if (o.team === 0 && o.campId === null) continue;
              threatOnRoute = true; break;
            }
            if (!threatOnRoute) {
              for (const c of ctx.camps) {
                if (c.owner === astarTeam) continue;
                const hasD = defendedCamps.has(c.id);
                if (!hasD && c.owner === 0) continue;
                const dist2 = (sx - c.x) ** 2 + (sy - c.y) ** 2;
                if (dist2 < (astarAvoid * 1.5) ** 2) { threatOnRoute = true; break; }
              }
            }
          }
        }

        if (obstacleOnRoute || threatOnRoute) {
          // Path sharing: check cache
          const cacheKey = `${Math.round(u.x / 128)}_${Math.round(u.y / 128)}_${Math.round(u.targetX / 128)}_${Math.round(u.targetY / 128)}_${u.team}`;
          if (ctx.framePathCache.has(cacheKey)) {
            const cached = ctx.framePathCache.get(cacheKey)!;
            u.pathWaypoints = cached ? cached.map(p => ({ ...p })) : null;
            u.pathAge = 0;
            u.pathTargetX = u.targetX;
            u.pathTargetY = u.targetY;
          } else if (pathsThisFrame < MAX_PATHS_PER_FRAME) {
            u.pathWaypoints = computeSafePath(u, !isSafeMover, ctx);
            if (!u.pathWaypoints && isSafeMover) {
              u.pathWaypoints = computeSafePath(u, true, ctx);
            }
            ctx.framePathCache.set(cacheKey, u.pathWaypoints);
            u.pathAge = 0;
            u.pathTargetX = u.targetX;
            u.pathTargetY = u.targetY;
            pathsThisFrame++;
          } else {
            // Budget exceeded — queue for next frame
            ctx.pathQueue.push({
              unit: u, targetX: u.targetX, targetY: u.targetY, callback: (path) => {
                u.pathWaypoints = path;
                u.pathAge = 0;
                u.pathTargetX = u.targetX;
                u.pathTargetY = u.targetY;
              },
            });
          }
        } else {
          u.pathWaypoints = null;
        }
      }

      // Follow A* waypoints if we have them
      const prevWpX = u.x, prevWpY = u.y;
      if (u.pathWaypoints && u.pathWaypoints.length > 0) {
        const wp = u.pathWaypoints[0];
        const wpDx = wp.x - u.x, wpDy = wp.y - u.y;
        const wpD = Math.sqrt(wpDx * wpDx + wpDy * wpDy);

        if (wpD < 40) {
          u.pathWaypoints.shift();
          if (u.pathWaypoints.length === 0) continue;
          // Re-read next waypoint
          const nwp = u.pathWaypoints[0];
          const nDx = nwp.x - u.x, nDy = nwp.y - u.y;
          const nD = Math.sqrt(nDx * nDx + nDy * nDy);
          if (nD < 1) continue;
          const eb = ctx.getUnitEquipBuffs(u);
          const ba = ctx.getBannerAura(u);
          const bm = 1 + ctx.getBuffs(astarTeam).speed + (eb?.speed || 0) + ba.speed;
          const ms = Math.min(u.speed * bm * dt, nD);
          u.x += (nDx / nD) * ms;
          u.y += (nDy / nD) * ms;
        } else {
          const eb = ctx.getUnitEquipBuffs(u);
          const ba = ctx.getBannerAura(u);
          const bm = 1 + ctx.getBuffs(astarTeam).speed + (eb?.speed || 0) + ba.speed;
          const ms = Math.min(u.speed * bm * dt, wpD);
          u.x += (wpDx / wpD) * ms;
          u.y += (wpDy / wpD) * ms;
        }
        u.x = Math.max(0, Math.min(WORLD_W, u.x));
        u.y = Math.max(0, Math.min(WORLD_H, u.y));
        if (!_walkable(u.x, u.y, ctx)) {
          // Axis-aligned sliding around corners
          const xOk = _walkable(u.x, prevWpY, ctx);
          const yOk = _walkable(prevWpX, u.y, ctx);
          if (xOk) {
            u.y = prevWpY;
          } else if (yOk) {
            u.x = prevWpX;
          } else {
            u.x = prevWpX;
            u.y = prevWpY;
          }
        }
        continue;
      }
      // A* returned null — fall through to force-based avoidance below
    }

    // Avoidance: units carrying food on non-combat steps steer around threats
    const prevAvoidX = u.x, prevAvoidY = u.y;
    if (u.team !== 0 && ctx.isNonCombatStep(u) && u.mods.caution !== 'aggressive') {
      const AVOID_RANGE = u.mods.caution === 'safe' ? 180 : 100;
      let avoidX = 0, avoidY = 0;
      const team = u.team as 1 | 2;

      // Avoid enemy units and neutral camp defenders
      const nearbyAvoid = ctx.getNearbyUnits(u.x, u.y, AVOID_RANGE);
      for (const o of nearbyAvoid) {
        if (o.team === u.team) continue;
        const ex = u.x - o.x, ey = u.y - o.y;
        const ed = Math.sqrt(ex * ex + ey * ey);
        if (ed < AVOID_RANGE && ed > 1) {
          const strength = (AVOID_RANGE / ed) - 1;
          avoidX += (ex / ed) * strength;
          avoidY += (ey / ed) * strength;
        }
      }

      // Avoid hostile camps
      const targetAnimal = u.loop ? ctx.getBootstrapAnimal(u.loop) : undefined;
      for (const c of ctx.camps) {
        if (c.owner === team) continue;
        if (targetAnimal && c.animalType === targetAnimal) continue;
        if (!ctx.defendedCamps.has(c.id) && c.owner === 0) continue;
        const cx2 = u.x - c.x, cy2 = u.y - c.y;
        const cd = Math.sqrt(cx2 * cx2 + cy2 * cy2);
        if (cd < AVOID_RANGE * 1.5 && cd > 1) {
          const strength = (AVOID_RANGE * 1.5 / cd) - 1;
          avoidX += (cx2 / cd) * strength;
          avoidY += (cy2 / cd) * strength;
        }
      }

      if (avoidX !== 0 || avoidY !== 0) {
        // On collect step: don't try to squeeze past — retreat toward base
        const isCollecting = u.loop?.steps[u.loop.currentStep]?.action === 'collect';
        if (isCollecting) {
          const base = team === 1 ? ctx.p1Base : ctx.p2Base;
          const bx = base.x - u.x, by = base.y - u.y;
          const bLen = Math.sqrt(bx * bx + by * by);
          const eb1 = ctx.getUnitEquipBuffs(u);
          const ba1 = ctx.getBannerAura(u);
          const buffMult = 1 + ctx.getBuffs(team).speed + (eb1?.speed || 0) + ba1.speed;
          const spd = u.speed * buffMult;
          const moveStep = Math.min(spd * dt, d);
          if (bLen > 1) {
            const avLen = Math.sqrt(avoidX * avoidX + avoidY * avoidY);
            const fx = (avoidX / avLen) * 0.7 + (bx / bLen) * 0.3;
            const fy = (avoidY / avLen) * 0.7 + (by / bLen) * 0.3;
            const fLen = Math.sqrt(fx * fx + fy * fy);
            if (fLen > 0.01) {
              u.x += (fx / fLen) * moveStep;
              u.y += (fy / fLen) * moveStep;
            }
          } else {
            u.x += (avoidX / Math.sqrt(avoidX * avoidX + avoidY * avoidY)) * moveStep;
            u.y += (avoidY / Math.sqrt(avoidX * avoidX + avoidY * avoidY)) * moveStep;
          }
          u.x = Math.max(0, Math.min(WORLD_W, u.x));
          u.y = Math.max(0, Math.min(WORLD_H, u.y));
          if (!_walkable(u.x, u.y, ctx)) { u.x = prevAvoidX; u.y = prevAvoidY; }
          continue;
        }
        // Normal non-collect: lateral dodge
        const normD = d > 0 ? d : 1;
        const moveNX = dx / normD, moveNY = dy / normD;
        const dot = avoidX * moveNX + avoidY * moveNY;
        let perpX = avoidX - dot * moveNX;
        let perpY = avoidY - dot * moveNY;
        // If enemy is directly ahead, pick a deterministic side to dodge
        if (Math.abs(perpX) + Math.abs(perpY) < 0.1 && (avoidX !== 0 || avoidY !== 0)) {
          const side = (u.id % 2 === 0) ? 1 : -1;
          perpX = -moveNY * side;
          perpY = moveNX * side;
        }
        // Final direction: forward movement + strong lateral dodge
        const finalX = moveNX + perpX * 2.0 + (dot < 0 ? avoidX * 0.5 : 0);
        const finalY = moveNY + perpY * 2.0 + (dot < 0 ? avoidY * 0.5 : 0);
        const fLen = Math.sqrt(finalX * finalX + finalY * finalY);
        if (fLen > 0.01) {
          const eb1 = ctx.getUnitEquipBuffs(u);
          const ba1 = ctx.getBannerAura(u);
          const buffMult = 1 + ctx.getBuffs(team).speed + (eb1?.speed || 0) + ba1.speed;
          const spd = u.speed * buffMult;
          const moveStep = Math.min(spd * dt, d);
          u.x += (finalX / fLen) * moveStep;
          u.y += (finalY / fLen) * moveStep;
          u.x = Math.max(0, Math.min(WORLD_W, u.x));
          u.y = Math.max(0, Math.min(WORLD_H, u.y));
          if (!_walkable(u.x, u.y, ctx)) { u.x = prevAvoidX; u.y = prevAvoidY; }
          continue;
        }
      }
    }

    const equipBuff = u.team !== 0 ? ctx.getUnitEquipBuffs(u) : null;
    const bannerAura = u.team !== 0 ? ctx.getBannerAura(u) : { speed: 0, attack: 0 };
    let buffMult = u.team !== 0 ? (1 + ctx.getBuffs(u.team as 1 | 2).speed + (equipBuff?.speed || 0) + bannerAura.speed) : 1;
    // Night speed penalty: slower units not near friendly buildings
    if (ctx.isNight && u.team !== 0 && !ctx.isNearFriendlyBuilding(u)) {
      buffMult *= NIGHT_SPEED_PENALTY;
    }
    const spd = u.speed * buffMult;
    const finalSpeed = spd * dt;
    const step = Math.min(finalSpeed, d);
    const prevX = u.x, prevY = u.y;
    u.x += (dx / d) * step;
    u.y += (dy / d) * step;

    // Clamp to world bounds
    u.x = Math.max(0, Math.min(WORLD_W, u.x));
    u.y = Math.max(0, Math.min(WORLD_H, u.y));

    // Block movement into water tiles and rock clusters — try axis-independent sliding
    if (!_walkable(u.x, u.y, ctx)) {
      const xOk = _walkable(u.x, prevY, ctx);
      const yOk = _walkable(prevX, u.y, ctx);
      if (xOk) {
        u.y = prevY;
      } else if (yOk) {
        u.x = prevX;
      } else {
        u.x = prevX;
        u.y = prevY;
      }
      // Trigger reactive A* on ANY collision, with 200ms debounce
      if (u.team !== 0 && !u.pathWaypoints && u.pathAge > 200) {
        const isSafe = ctx.isNonCombatStep(u) && u.mods.caution !== 'aggressive';
        if (pathsThisFrame < MAX_PATHS_PER_FRAME) {
          u.pathWaypoints = computeSafePath(u, !isSafe, ctx);
          u.pathAge = 0;
          u.pathTargetX = u.targetX;
          u.pathTargetY = u.targetY;
          pathsThisFrame++;
        } else {
          ctx.pathQueue.push({
            unit: u, targetX: u.targetX, targetY: u.targetY, callback: (path) => {
              u.pathWaypoints = path;
              u.pathAge = 0;
              u.pathTargetX = u.targetX;
              u.pathTargetY = u.targetY;
            },
          });
        }
      }
    }

    // Formation: spread — repel from nearby same-team allies (min 120px)
    // Exempt turtles in combat (preserve Shell Stance)
    if (ctx.frameCount % 2 === 0 && u.mods.formation === 'spread' && !(u.type === 'turtle' && u.animState === 'attack')) {
      const SPREAD_MIN = 120;
      const preSpreadX = u.x, preSpreadY = u.y;
      const nearbySpread = ctx.getNearbyUnits(u.x, u.y, SPREAD_MIN);
      for (const ally of nearbySpread) {
        if (ally === u || ally.team !== u.team) continue;
        const adx = u.x - ally.x, ady = u.y - ally.y;
        const ad = Math.sqrt(adx * adx + ady * ady);
        if (ad < SPREAD_MIN && ad > 1) {
          const push = ((SPREAD_MIN - ad) / SPREAD_MIN) * 0.3;
          u.x += (adx / ad) * push * u.speed * dt;
          u.y += (ady / ad) * push * u.speed * dt;
        }
      }
      u.x = Math.max(0, Math.min(WORLD_W, u.x));
      u.y = Math.max(0, Math.min(WORLD_H, u.y));
      if (!_walkable(u.x, u.y, ctx)) { u.x = preSpreadX; u.y = preSpreadY; }
    }

    // Formation: tight — leash to group centroid (max 150px)
    if (u.mods.formation === 'tight') {
      const allies = tightGroups.get(`${u.team}_${u.type}`) || [];
      if (allies.length > 1) {
        let cx = 0, cy = 0;
        for (const a of allies) { cx += a.x; cy += a.y; }
        cx /= allies.length; cy /= allies.length;
        const distToCentroid = Math.sqrt((u.x - cx) ** 2 + (u.y - cy) ** 2);
        if (distToCentroid > 150) {
          const preTightX = u.x, preTightY = u.y;
          const pull = Math.min(1, (distToCentroid - 150) / 200) * u.speed * dt;
          const dx2 = cx - u.x, dy2 = cy - u.y;
          const d2Inner = Math.sqrt(dx2 * dx2 + dy2 * dy2) || 1;
          u.x += (dx2 / d2Inner) * pull;
          u.y += (dy2 / d2Inner) * pull;
          u.x = Math.max(0, Math.min(WORLD_W, u.x));
          u.y = Math.max(0, Math.min(WORLD_H, u.y));
          if (!_walkable(u.x, u.y, ctx)) { u.x = preTightX; u.y = preTightY; }
        }
      }
    }

    // Separation force: push apart overlapping units
    if (ctx.frameCount % 2 === 0 && u.team !== 0) {
      const nearby = ctx.getNearbyUnits(u.x, u.y, 30);
      let sepX = 0, sepY = 0;
      for (const neighbor of nearby) {
        if (neighbor === u || neighbor.dead) continue;
        const ndx = u.x - neighbor.x, ndy = u.y - neighbor.y;
        const nd = Math.sqrt(ndx * ndx + ndy * ndy);
        if (nd < 20 && nd > 0.1) {
          sepX += (ndx / nd) * 0.3;
          sepY += (ndy / nd) * 0.3;
        }
      }
      const sepMag = Math.sqrt(sepX * sepX + sepY * sepY);
      if (sepMag > 3) { sepX *= 3 / sepMag; sepY *= 3 / sepMag; }
      if (sepMag > 0.01) {
        const preSepX = u.x, preSepY = u.y;
        u.x += sepX;
        u.y += sepY;
        u.x = Math.max(0, Math.min(WORLD_W, u.x));
        u.y = Math.max(0, Math.min(WORLD_H, u.y));
        if (!_walkable(u.x, u.y, ctx)) { u.x = preSepX; u.y = preSepY; }
      }
    }
  }

  return {
    stuckCheckCounter,
    pathsThisFrame,
    frameOccupiedReady: ctx.frameOccupiedReady,
  };
}
