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

export function findPath(
  tiles: TileType[][],
  start: Position,
  goal: Position,
  maxSteps: number,
  occupiedPositions?: Set<string>
): Position[] {
  // Clamp goal to map bounds
  const gx = Math.max(0, Math.min(MAP_WIDTH - 1, Math.round(goal.x)));
  const gy = Math.max(0, Math.min(MAP_HEIGHT - 1, Math.round(goal.y)));

  // If goal is impassable, find nearest passable tile to it
  let finalGoal = { x: gx, y: gy };
  if (!isPassable(tiles[gy][gx])) {
    finalGoal = findNearestPassable(tiles, gx, gy);
  }

  const sx = Math.max(0, Math.min(MAP_WIDTH - 1, Math.round(start.x)));
  const sy = Math.max(0, Math.min(MAP_HEIGHT - 1, Math.round(start.y)));

  if (sx === finalGoal.x && sy === finalGoal.y) return [];

  const open: PathNode[] = [];
  const closed = new Set<string>();
  const key = (x: number, y: number) => `${x},${y}`;

  const startNode: PathNode = {
    x: sx, y: sy,
    g: 0,
    h: heuristic(sx, sy, finalGoal.x, finalGoal.y),
    f: 0,
    parent: null,
  };
  startNode.f = startNode.g + startNode.h;
  open.push(startNode);

  const dirs = [[1, 0], [-1, 0], [0, 1], [0, -1]];
  let iterations = 0;
  const maxIterations = 500; // safety limit

  while (open.length > 0 && iterations < maxIterations) {
    iterations++;

    // Find node with lowest f
    let bestIdx = 0;
    for (let i = 1; i < open.length; i++) {
      if (open[i].f < open[bestIdx].f) bestIdx = i;
    }
    const current = open.splice(bestIdx, 1)[0];
    const ck = key(current.x, current.y);

    if (current.x === finalGoal.x && current.y === finalGoal.y) {
      return reconstructPath(current, maxSteps);
    }

    closed.add(ck);

    for (const [dx, dy] of dirs) {
      const nx = current.x + dx;
      const ny = current.y + dy;
      const nk = key(nx, ny);

      if (nx < 0 || nx >= MAP_WIDTH || ny < 0 || ny >= MAP_HEIGHT) continue;
      if (closed.has(nk)) continue;
      if (!isPassable(tiles[ny][nx])) continue;
      if (occupiedPositions && occupiedPositions.has(nk) && !(nx === finalGoal.x && ny === finalGoal.y)) continue;

      const moveCost = getMovementCost(tiles[ny][nx]);
      const g = current.g + moveCost;
      const h = heuristic(nx, ny, finalGoal.x, finalGoal.y);

      const existing = open.find(n => n.x === nx && n.y === ny);
      if (existing) {
        if (g < existing.g) {
          existing.g = g;
          existing.f = g + existing.h;
          existing.parent = current;
        }
      } else {
        open.push({ x: nx, y: ny, g, h, f: g + h, parent: current });
      }
    }
  }

  // No path to goal - return partial path toward goal
  return findPartialPath(tiles, { x: sx, y: sy }, finalGoal, maxSteps);
}

function heuristic(x1: number, y1: number, x2: number, y2: number): number {
  return Math.abs(x1 - x2) + Math.abs(y1 - y2);
}

function reconstructPath(node: PathNode, maxSteps: number): Position[] {
  const fullPath: Position[] = [];
  let current: PathNode | null = node;
  while (current && current.parent) {
    fullPath.unshift({ x: current.x, y: current.y });
    current = current.parent;
  }

  // Limit by movement budget (maxSteps = speed stat)
  // Walk along path consuming movement cost
  const result: Position[] = [];
  let budget = maxSteps;
  for (const pos of fullPath) {
    budget -= 1; // simplified: 1 step per tile on the result path
    if (budget < 0) break;
    result.push(pos);
  }

  return result;
}

function findNearestPassable(tiles: TileType[][], x: number, y: number): Position {
  const visited = new Set<string>();
  const queue: Position[] = [{ x, y }];
  visited.add(`${x},${y}`);

  while (queue.length > 0) {
    const pos = queue.shift()!;
    if (isPassable(tiles[pos.y][pos.x])) return pos;

    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = pos.x + dx;
      const ny = pos.y + dy;
      const k = `${nx},${ny}`;
      if (nx >= 0 && nx < MAP_WIDTH && ny >= 0 && ny < MAP_HEIGHT && !visited.has(k)) {
        visited.add(k);
        queue.push({ x: nx, y: ny });
      }
    }
  }
  return { x, y }; // fallback
}

function findPartialPath(
  tiles: TileType[][],
  start: Position,
  goal: Position,
  maxSteps: number
): Position[] {
  // Greedy walk: try to step closer to goal each step, avoiding impassable
  const path: Position[] = [];
  let cx = start.x;
  let cy = start.y;

  for (let step = 0; step < maxSteps; step++) {
    const dx = goal.x - cx;
    const dy = goal.y - cy;
    if (dx === 0 && dy === 0) break;

    // Try primary direction, then secondary
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
    if (!moved) break; // completely blocked
  }

  return path;
}
