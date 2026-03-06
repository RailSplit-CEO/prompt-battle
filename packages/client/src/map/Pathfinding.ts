import { Position, TileType } from '@prompt-battle/shared';
import { MAP_WIDTH, MAP_HEIGHT, isPassable, getMovementCost } from './MapGenerator';

interface PathNode {
  x: number;
  y: number;
  g: number; // cost from start
  h: number; // heuristic to goal
  f: number; // g + h
  parent: PathNode | null;
}

const DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1]];
const key = (x: number, y: number) => (y << 8) | x; // fast numeric key for 256-wide maps

export function findPath(
  tiles: TileType[][],
  start: Position,
  goal: Position,
  _maxSteps: number,
  occupiedPositions?: Set<string>
): Position[] {
  const gx = Math.max(0, Math.min(MAP_WIDTH - 1, Math.round(goal.x)));
  const gy = Math.max(0, Math.min(MAP_HEIGHT - 1, Math.round(goal.y)));

  let finalGoal = { x: gx, y: gy };
  if (!isPassable(tiles[gy]?.[gx])) {
    finalGoal = findNearestPassable(tiles, gx, gy);
  }

  const sx = Math.max(0, Math.min(MAP_WIDTH - 1, Math.round(start.x)));
  const sy = Math.max(0, Math.min(MAP_HEIGHT - 1, Math.round(start.y)));

  if (sx === finalGoal.x && sy === finalGoal.y) return [];

  // A* with Map-based open set for fast lookup
  const open: PathNode[] = [];
  const openMap = new Map<number, PathNode>(); // key -> node in open list
  const closedSet = new Set<number>();

  const startNode: PathNode = {
    x: sx, y: sy,
    g: 0,
    h: heuristic(sx, sy, finalGoal.x, finalGoal.y),
    f: heuristic(sx, sy, finalGoal.x, finalGoal.y),
    parent: null,
  };
  open.push(startNode);
  openMap.set(key(sx, sy), startNode);

  let iterations = 0;
  const maxIterations = 8000;

  while (open.length > 0 && iterations < maxIterations) {
    iterations++;

    // Find node with lowest f
    let bestIdx = 0;
    for (let i = 1; i < open.length; i++) {
      if (open[i].f < open[bestIdx].f ||
        (open[i].f === open[bestIdx].f && open[i].h < open[bestIdx].h)) {
        bestIdx = i;
      }
    }
    const current = open[bestIdx];
    open[bestIdx] = open[open.length - 1];
    open.pop();

    const ck = key(current.x, current.y);
    openMap.delete(ck);

    if (current.x === finalGoal.x && current.y === finalGoal.y) {
      return reconstructPath(current);
    }

    closedSet.add(ck);

    for (const [dx, dy] of DIRS) {
      const nx = current.x + dx;
      const ny = current.y + dy;

      if (nx < 0 || nx >= MAP_WIDTH || ny < 0 || ny >= MAP_HEIGHT) continue;
      const nk = key(nx, ny);
      if (closedSet.has(nk)) continue;
      if (!isPassable(tiles[ny][nx])) continue;

      // Allow moving to the goal even if occupied, but avoid other occupied tiles
      if (occupiedPositions) {
        const posKey = `${nx},${ny}`;
        if (occupiedPositions.has(posKey) && !(nx === finalGoal.x && ny === finalGoal.y)) continue;
      }

      const moveCost = getMovementCost(tiles[ny][nx]);
      const g = current.g + moveCost;

      const existing = openMap.get(nk);
      if (existing) {
        if (g < existing.g) {
          existing.g = g;
          existing.f = g + existing.h;
          existing.parent = current;
        }
      } else {
        const h = heuristic(nx, ny, finalGoal.x, finalGoal.y);
        const node: PathNode = { x: nx, y: ny, g, h, f: g + h, parent: current };
        open.push(node);
        openMap.set(nk, node);
      }
    }
  }

  // A* didn't reach goal — return best partial path (closest node explored)
  return findBestPartialPath(closedSet, open, openMap, tiles, { x: sx, y: sy }, finalGoal);
}

function heuristic(x1: number, y1: number, x2: number, y2: number): number {
  return Math.abs(x1 - x2) + Math.abs(y1 - y2);
}

function reconstructPath(node: PathNode): Position[] {
  const fullPath: Position[] = [];
  let current: PathNode | null = node;
  while (current && current.parent) {
    fullPath.unshift({ x: current.x, y: current.y });
    current = current.parent;
  }
  return fullPath;
}

function findNearestPassable(tiles: TileType[][], x: number, y: number): Position {
  const visited = new Set<number>();
  const queue: Position[] = [{ x, y }];
  visited.add(key(x, y));

  while (queue.length > 0) {
    const pos = queue.shift()!;
    if (isPassable(tiles[pos.y][pos.x])) return pos;

    for (const [dx, dy] of DIRS) {
      const nx = pos.x + dx;
      const ny = pos.y + dy;
      const k = key(nx, ny);
      if (nx >= 0 && nx < MAP_WIDTH && ny >= 0 && ny < MAP_HEIGHT && !visited.has(k)) {
        visited.add(k);
        queue.push({ x: nx, y: ny });
      }
    }
  }
  return { x, y };
}

function findBestPartialPath(
  closedSet: Set<number>,
  open: PathNode[],
  openMap: Map<number, PathNode>,
  tiles: TileType[][],
  start: Position,
  goal: Position,
): Position[] {
  // Among all explored nodes, find the one closest to goal and reconstruct to it
  let bestNode: PathNode | null = null;
  let bestDist = Infinity;

  // Check both closed (fully explored) and remaining open nodes
  const allNodes = [...open];
  // We need to also check closed nodes — rebuild from open parents
  // Instead, just use the open list nodes that have parents chain
  for (const node of allNodes) {
    const dist = heuristic(node.x, node.y, goal.x, goal.y);
    if (dist < bestDist) {
      bestDist = dist;
      bestNode = node;
    }
  }

  if (bestNode) {
    return reconstructPath(bestNode);
  }

  // Absolute fallback: greedy walk
  return greedyWalk(tiles, start, goal, 20);
}

function greedyWalk(tiles: TileType[][], start: Position, goal: Position, maxSteps: number): Position[] {
  const path: Position[] = [];
  let cx = start.x;
  let cy = start.y;

  for (let step = 0; step < maxSteps; step++) {
    const dx = goal.x - cx;
    const dy = goal.y - cy;
    if (dx === 0 && dy === 0) break;

    const candidates: [number, number][] = [];
    if (Math.abs(dx) >= Math.abs(dy)) {
      candidates.push([Math.sign(dx), 0]);
      if (dy !== 0) candidates.push([0, Math.sign(dy)]);
      candidates.push([0, -Math.sign(dy || 1)]);
    } else {
      candidates.push([0, Math.sign(dy)]);
      if (dx !== 0) candidates.push([Math.sign(dx), 0]);
      candidates.push([-Math.sign(dx || 1), 0]);
    }

    let moved = false;
    for (const [mx, my] of candidates) {
      const nx = cx + mx;
      const ny = cy + my;
      if (nx >= 0 && nx < MAP_WIDTH && ny >= 0 && ny < MAP_HEIGHT && isPassable(tiles[ny][nx])) {
        cx = nx;
        cy = ny;
        path.push({ x: cx, y: cy });
        moved = true;
        break;
      }
    }
    if (!moved) break;
  }

  return path;
}
