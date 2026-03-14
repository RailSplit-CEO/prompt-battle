import {
  DraftPick, Character, computeStats, CLASSES, ANIMALS,
  Position, CharacterOrder, CTFState, ControlPoint,
  ConsumableId, CONSUMABLES, rollRandomConsumable,
  POI, Barricade, Trap, XP_THRESHOLDS, LEVEL_STAT_BONUS,
  Follower, PlayerEconomy, MapPhase,
  MineNode, Tower, TowerSite, NeutralCamp,
  getBark, randomPersonality, BARK_COOLDOWN,
  MINE_RATE_PER_SEC, BASE_INCOME_PER_SEC, TOWER_COST,
  TileType, BarkTrigger,
} from '@prompt-battle/shared';

// ─── CONSTANTS ──────────────────────────────────────────────────────
const GAME_DURATION = 300;
const RESPAWN_TIME = 20;
const TICK_RATE = 750;
const MOVE_TICK = 900;
const BASE_VISION = 5;
const PICKUP_RESPAWN = 25;
const DOM_POINTS_TO_WIN = 200;
const DOM_POINTS_PER_TICK = 1;
const ATTACK_INTERVAL = 2000;
const CENTER_CP_MULTIPLIER = 2;

const SCOUT_CHANNEL_TICKS = 13;
const LOOT_CHANNEL_TICKS = 11;
const BUILD_CHANNEL_TICKS = 8;
const TRAP_CHANNEL_TICKS = 5;
const UPGRADE_CP_TICKS = 11;
const MINE_CHANNEL_TICKS = 4;
const BUILD_TOWER_TICKS = 11;
const TOWER_HP = 300;
const TOWER_DPS = 10;
const TOWER_RANGE = 4;
const CACHE_RESPAWN_TIME = 45;
const LOOKOUT_VISION_RADIUS = 12;
const LOOKOUT_VISION_DURATION = 30;
const WELL_HEAL_PER_TICK = 8;
const BARRICADE_HP = 80;
const BARRICADE_DECAY = 60;
const MAX_TRAPS_PER_TEAM = 3;
const TRAP_DAMAGE = 25;
const TRAP_STUN = 3;
const MAX_INVENTORY = 2;
const XP_KILL = 50;
const XP_CAPTURE_CP = 40;
const XP_LOOT_CACHE = 30;
const XP_SCOUT = 20;

const MAP_WIDTH = 80;
const MAP_HEIGHT = 80;

// ─── INTERFACES ──────────────────────────────────────────────────────

export interface SyncSnapshot {
  characters: Record<string, Character>;
  ctf: CTFState;
  timeRemaining: number;
  controlPoints: ControlPoint[];
  orderQueues: Record<string, CharacterOrder[]>;
  domScore1: number;
  domScore2: number;
  gameOver?: boolean;
  winner?: string;
  winReason?: string;
  pickups: PickupState[];
  economy: { player1: PlayerEconomy; player2: PlayerEconomy };
  barricades: Barricade[];
  traps: TrapState[];
  pois: POI[];
  mineNodes: MineNode[];
  towers: Tower[];
  towerSites: TowerSite[];
  gamePhase: MapPhase;
  events: GameEvent[];
}

interface PickupState {
  id: string;
  type: 'health_potion' | 'speed_boost' | 'damage_boost';
  position: Position;
  active: boolean;
  respawnTimer: number;
}

interface TrapState {
  id: string;
  position: Position;
  owner: string;
  damage: number;
  stunDuration: number;
}

export interface GameEvent {
  type: 'attack' | 'ability' | 'kill' | 'capture' | 'announcement' | 'bark' | 'pickup' | 'levelup';
  data: any;
  timestamp: number;
}

export interface RemoteOrderPayload {
  characterId: string;
  order: CharacterOrder;
  queued: boolean;
}

// ─── MAP TYPES ──────────────────────────────────────────────────────

interface SwitchGateLink {
  switchPos: Position;
  gatePositions: Position[];
}

interface POIPlacement {
  type: 'lookout' | 'healing_well' | 'treasure_cache';
  position: Position;
  activatePhase?: MapPhase;
}

interface ControlPointDef {
  id: string;
  name: string;
  position: Position;
  radius: number;
  buff: { type: 'speed' | 'damage' | 'defense'; value: number; label: string };
}

interface GameMap {
  tiles: TileType[][];
  seed: number;
  spawnP1: Position[];
  spawnP2: Position[];
  flagP1: Position;
  flagP2: Position;
  controlPointPositions: Position[];
  controlPointDefs?: ControlPointDef[];
  switchGateLinks: SwitchGateLink[];
  poiPlacements: POIPlacement[];
  zones: any[];
  mineNodes: MineNode[];
  towerSites: TowerSite[];
  neutralCamps: NeutralCamp[];
  scoutingPosts: any[];
}

// ─── NAME GENERATOR ──────────────────────────────────────────────────

const NAMES = [
  'Axe', 'Bolt', 'Claw', 'Dart', 'Edge', 'Fang', 'Grit', 'Hex',
  'Ink', 'Jade', 'Knox', 'Lux', 'Mace', 'Nyx', 'Onyx', 'Pike',
  'Quill', 'Rust', 'Scar', 'Tusk', 'Urn', 'Vex', 'Wren', 'Zap',
  'Ash', 'Blaze', 'Crow', 'Dusk', 'Echo', 'Flint',
];
let usedNames = new Set<string>();

function generateCharacterName(): string {
  for (const name of NAMES) {
    if (!usedNames.has(name)) {
      usedNames.add(name);
      return name;
    }
  }
  // Fallback: append number
  const base = NAMES[Math.floor(Math.random() * NAMES.length)];
  const name = `${base}${usedNames.size}`;
  usedNames.add(name);
  return name;
}

function resetNames(): void {
  usedNames = new Set<string>();
}

// ─── PATHFINDING (A*) ────────────────────────────────────────────────

interface PathNode {
  x: number;
  y: number;
  g: number;
  h: number;
  f: number;
  parent: PathNode | null;
}

const DIRS: [number, number][] = [[1, 0], [-1, 0], [0, 1], [0, -1]];
const nodeKey = (x: number, y: number) => (y << 8) | x;

function isPassable(tile: TileType): boolean {
  return tile !== 'water' && tile !== 'rock' && tile !== 'lava' && tile !== 'ruins' && tile !== 'gate_closed';
}

function getMovementCost(tile: TileType): number {
  switch (tile) {
    case 'path': return 0.5;
    case 'bridge': return 0.6;
    case 'capture_point': return 0.7;
    case 'forest': return 2;
    case 'bush': return 1.5;
    case 'hill': return 1.5;
    case 'sand': return 1.3;
    case 'swamp': return 2.5;
    case 'mushroom': return 1.2;
    case 'flowers': return 0.9;
    case 'switch': return 0.8;
    case 'gate_open': return 0.5;
    default: return 1;
  }
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
  visited.add(nodeKey(x, y));

  while (queue.length > 0) {
    const pos = queue.shift()!;
    if (isPassable(tiles[pos.y]?.[pos.x])) return pos;

    for (const [dx, dy] of DIRS) {
      const nx = pos.x + dx;
      const ny = pos.y + dy;
      const k = nodeKey(nx, ny);
      if (nx >= 0 && nx < MAP_WIDTH && ny >= 0 && ny < MAP_HEIGHT && !visited.has(k)) {
        visited.add(k);
        queue.push({ x: nx, y: ny });
      }
    }
  }
  return { x, y };
}

function findBestPartialPath(
  _closedSet: Set<number>,
  open: PathNode[],
  _openMap: Map<number, PathNode>,
  tiles: TileType[][],
  start: Position,
  goal: Position,
): Position[] {
  let bestNode: PathNode | null = null;
  let bestDist = Infinity;

  for (const node of open) {
    const dist = heuristic(node.x, node.y, goal.x, goal.y);
    if (dist < bestDist) {
      bestDist = dist;
      bestNode = node;
    }
  }

  if (bestNode) {
    return reconstructPath(bestNode);
  }

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
      if (nx >= 0 && nx < MAP_WIDTH && ny >= 0 && ny < MAP_HEIGHT && isPassable(tiles[ny]?.[nx])) {
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

function findPath(
  tiles: TileType[][],
  start: Position,
  goal: Position,
  _maxSteps: number,
  occupiedPositions?: Set<string>,
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

  const open: PathNode[] = [];
  const openMap = new Map<number, PathNode>();
  const closedSet = new Set<number>();

  const startNode: PathNode = {
    x: sx, y: sy,
    g: 0,
    h: heuristic(sx, sy, finalGoal.x, finalGoal.y),
    f: heuristic(sx, sy, finalGoal.x, finalGoal.y),
    parent: null,
  };
  open.push(startNode);
  openMap.set(nodeKey(sx, sy), startNode);

  let iterations = 0;
  const maxIterations = 8000;

  while (open.length > 0 && iterations < maxIterations) {
    iterations++;

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

    const ck = nodeKey(current.x, current.y);
    openMap.delete(ck);

    if (current.x === finalGoal.x && current.y === finalGoal.y) {
      return reconstructPath(current);
    }

    closedSet.add(ck);

    for (const [dx, dy] of DIRS) {
      const nx = current.x + dx;
      const ny = current.y + dy;

      if (nx < 0 || nx >= MAP_WIDTH || ny < 0 || ny >= MAP_HEIGHT) continue;
      const nk = nodeKey(nx, ny);
      if (closedSet.has(nk)) continue;
      if (!isPassable(tiles[ny][nx])) continue;

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

  return findBestPartialPath(closedSet, open, openMap, tiles, { x: sx, y: sy }, finalGoal);
}

// ─── CLAMP UTILITY ────────────────────────────────────────────────────

function clamp(x: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, x));
}

// ─── GAME ROOM ──────────────────────────────────────────────────────

export class GameRoom {
  id: string;
  player1Id: string;
  player2Id: string;

  private gameMap: GameMap;
  private charData: Map<string, Character> = new Map();
  private orderQueues: Map<string, CharacterOrder[]> = new Map();

  private gameTimeRemaining = GAME_DURATION;
  private gameOver = false;
  private elapsedSeconds = 0;
  private gamePhase: MapPhase = 1;

  // Domination
  private ctf!: CTFState;
  private domScore1 = 0;
  private domScore2 = 0;
  private controlPoints: ControlPoint[] = [];

  // Pickups
  private pickups: PickupState[] = [];

  // Terrain
  private forestAmbushUsed: Set<string> = new Set();
  private lastCharTile: Map<string, string> = new Map();
  private lastAttackTime: Map<string, number> = new Map();
  private switchGateLinks: SwitchGateLink[];
  private activatedSwitches: Set<string> = new Set();
  private switchDebounceTimers: Map<string, NodeJS.Timeout> = new Map();

  // POIs, Barricades, Traps
  private pois: POI[] = [];
  private barricades: Barricade[] = [];
  private traps: Trap[] = [];
  private lookoutVisionZones: { center: Position; radius: number; expiresAt: number }[] = [];
  private visionFlareUntil = 0;

  // Economy
  private economy = {
    player1: { gold: 0, income: BASE_INCOME_PER_SEC, upkeepPenalty: 1 } as PlayerEconomy,
    player2: { gold: 0, income: BASE_INCOME_PER_SEC, upkeepPenalty: 1 } as PlayerEconomy,
  };

  // Timers
  private secondTimer?: NodeJS.Timeout;
  private gameTickTimer?: NodeJS.Timeout;
  private moveTickTimer?: NodeJS.Timeout;

  // Mine, towers
  private mineNodes: MineNode[] = [];
  private towers: Tower[] = [];
  private towerSites: TowerSite[] = [];
  private neutralCamps: NeutralCamp[] = [];

  // Events buffer (flushed each game tick)
  private events: GameEvent[] = [];

  // Bark cooldowns per character
  private lastBarkTime: Map<string, number> = new Map();

  // Followers (unused in animal-based system, kept for economy calc compat)
  private followers: Follower[] = [];

  // Callbacks
  private onStateUpdate: (snapshot: SyncSnapshot) => void;
  private onGameOver: (winner: string, reason: string) => void;

  constructor(
    id: string,
    player1Id: string,
    player2Id: string,
    picks: DraftPick[],
    gameMap: GameMap,
    onStateUpdate: (snapshot: SyncSnapshot) => void,
    onGameOver: (winner: string, reason: string) => void,
  ) {
    this.id = id;
    this.player1Id = player1Id;
    this.player2Id = player2Id;
    this.gameMap = gameMap;
    this.onStateUpdate = onStateUpdate;
    this.onGameOver = onGameOver;

    this.switchGateLinks = gameMap.switchGateLinks;
    resetNames();
    this.initDomination();
    this.initControlPoints();
    this.createCharacters(picks);
    this.spawnPickups();
    this.initPOIs();
    this.initMapFeatures();
  }

  // ─── PUBLIC API ────────────────────────────────────────────────────

  start(): void {
    this.secondTimer = setInterval(() => this.onSecondTick(), 1000);
    this.gameTickTimer = setInterval(() => this.onGameTick(), TICK_RATE);
    this.moveTickTimer = setInterval(() => this.onMoveTick(), MOVE_TICK);
  }

  stop(): void {
    if (this.secondTimer) { clearInterval(this.secondTimer); this.secondTimer = undefined; }
    if (this.gameTickTimer) { clearInterval(this.gameTickTimer); this.gameTickTimer = undefined; }
    if (this.moveTickTimer) { clearInterval(this.moveTickTimer); this.moveTickTimer = undefined; }
    // Clear all switch debounce timers
    for (const timer of this.switchDebounceTimers.values()) {
      clearTimeout(timer);
    }
    this.switchDebounceTimers.clear();
  }

  applyOrders(playerId: string, orders: RemoteOrderPayload[]): void {
    for (const o of orders) {
      const char = this.charData.get(o.characterId);
      if (!char || char.isDead || char.owner !== playerId) continue;

      if (o.queued) {
        const queue = this.orderQueues.get(char.id);
        if (queue && queue.length < 3) queue.push(o.order);
      } else {
        char.currentOrder = o.order;
        char.path = [];
        const q = this.orderQueues.get(char.id);
        if (q) q.length = 0;
      }
    }
  }

  // ─── CHARACTER CREATION ─────────────────────────────────────────────

  private createCharacters(picks: DraftPick[]): void {
    const p1Picks = picks.filter(p => p.playerId === this.player1Id);
    const p2Picks = picks.filter(p => p.playerId === this.player2Id);

    p1Picks.forEach((pick, i) => {
      const char = this.buildCharacter(pick, i, true);
      this.charData.set(char.id, char);
      this.orderQueues.set(char.id, []);
    });

    p2Picks.forEach((pick, i) => {
      const char = this.buildCharacter(pick, i, false);
      this.charData.set(char.id, char);
      this.orderQueues.set(char.id, []);
    });
  }

  private buildCharacter(pick: DraftPick, index: number, isPlayer1: boolean): Character {
    const cls = CLASSES[pick.classId];
    const classDef = cls || CLASSES['paladin'];
    const animal = ANIMALS[pick.animalId];
    const stats = animal ? computeStats(classDef.baseStats, animal.statModifiers) : { ...classDef.baseStats };
    const spawns = isPlayer1 ? this.gameMap.spawnP1 : this.gameMap.spawnP2;
    const name = generateCharacterName();

    let visionRange = animal?.vision ?? BASE_VISION;
    if (pick.classId === 'rogue') visionRange += 2;

    return {
      id: `${pick.playerId}_${pick.classId}_${pick.animalId}_${index}`,
      owner: pick.playerId,
      classId: pick.classId,
      animalId: pick.animalId,
      name,
      stats,
      baseStats: { ...stats },
      currentHp: stats.hp,
      position: { ...spawns[index % spawns.length] },
      cooldowns: {},
      effects: [],
      isDead: false,
      level: 1,
      xp: 0,
      inventory: [],
      personality: randomPersonality(),
      morale: 'confident' as const,
      moraleTimer: 0,
      lastPraised: 0,
      respawnTimer: 0,
      currentOrder: null,
      path: [],
      hasFlag: false,
      visionRange,
    };
  }

  // ─── TICK LOOPS ─────────────────────────────────────────────────────

  private onSecondTick(): void {
    if (this.gameOver) return;

    this.gameTimeRemaining--;
    this.elapsedSeconds++;
    this.updateGamePhase();

    // Economy: passive income + mining
    this.tickEconomy();

    // Respawn timers
    this.charData.forEach((char) => {
      if (char.isDead && (char.respawnTimer ?? 0) > 0) {
        char.respawnTimer = (char.respawnTimer ?? 0) - 1;
        if (char.respawnTimer! <= 0) this.respawnCharacter(char);
      }
    });

    // Morale decay
    this.tickMorale();

    this.tickCooldowns();
    this.tickPOIRespawns();
    this.tickBarricadeDecay();

    // Tick pickup respawns
    for (const pickup of this.pickups) {
      if (!pickup.active && pickup.respawnTimer > 0) {
        pickup.respawnTimer--;
        if (pickup.respawnTimer <= 0) {
          pickup.active = true;
        }
      }
    }

    // Domination scoring
    this.tickDominationScoring();

    if (this.gameTimeRemaining <= 0) {
      const winner = this.domScore1 > this.domScore2 ? this.player1Id
        : this.domScore2 > this.domScore1 ? this.player2Id
        : this.getHpLeader();
      this.endGame(winner, 'time_up');
    }
  }

  private onGameTick(): void {
    if (this.gameOver) return;

    this.charData.forEach((char) => {
      if (char.isDead) return;

      // Check stun
      if (char.effects.some(e => e.type === 'stun')) return;

      // Pop from order queue if no current order
      if (!char.currentOrder) {
        const queue = this.orderQueues.get(char.id);
        if (queue && queue.length > 0) {
          char.currentOrder = queue.shift()!;
          char.path = [];
        }
      }

      this.executeAutoActions(char);
    });

    this.checkPickupCollisions();
    this.updatePOIs();
    this.updateChanneling();
    this.updateBarricadesAndTraps();
    this.updateControlPoints();

    // Tower attacks
    this.tickTowers();

    // Broadcast state
    const snapshot = this.buildSyncSnapshot();
    this.onStateUpdate(snapshot);
    this.events = [];
  }

  private onMoveTick(): void {
    if (this.gameOver) return;

    this.charData.forEach((char, id) => {
      if (char.isDead) return;
      if (char.effects.some(e => e.type === 'stun')) return;
      if (char.effects.some(e => e.type === 'slow') && Math.random() < 0.5) return;

      // Track tile changes
      const tileKey = `${char.position.x},${char.position.y}`;
      const prevTile = this.lastCharTile.get(id);
      if (prevTile && prevTile !== tileKey) {
        this.forestAmbushUsed.delete(id);
      }
      this.lastCharTile.set(id, tileKey);

      // Check switch
      const currentTile = this.gameMap.tiles[char.position.y]?.[char.position.x];
      if (currentTile === 'switch') {
        this.triggerSwitch(char.position);
      }

      // Speed boost
      const cpBuffs = this.getTeamBuffs(char.owner);
      const hasSpeedBoost = char.effects.some(e => e.type === 'speed_boost') || cpBuffs.speed > 1;

      const doMove = () => {
        if (char.path && char.path.length > 0) {
          const next = char.path.shift()!;
          if (isPassable(this.gameMap.tiles[next.y]?.[next.x])) {
            char.position = { ...next };
          } else {
            char.path = [];
          }
        } else if (char.currentOrder) {
          this.recalculatePath(char);
        }
      };

      doMove();
      if (hasSpeedBoost && char.path && char.path.length > 0) {
        doMove(); // second move immediately
      }
    });
  }

  // ─── TOWER ATTACKS ──────────────────────────────────────────────────

  private tickTowers(): void {
    for (const tower of this.towers) {
      if (tower.hp <= 0) continue;
      // Find nearest enemy in range
      let nearestEnemy: Character | null = null;
      let nearestDist = Infinity;
      this.charData.forEach(char => {
        if (char.isDead) return;
        const charTeam = this.getTeamForPlayer(char.owner);
        if (charTeam === tower.owner) return; // same team
        const dist = this.tileDist(char.position, tower.position);
        if (dist <= tower.range && dist < nearestDist) {
          nearestDist = dist;
          nearestEnemy = char;
        }
      });
      if (nearestEnemy) {
        const target = nearestEnemy as Character;
        target.currentHp = Math.max(0, target.currentHp - tower.damage);
        this.events.push({
          type: 'attack',
          data: { attackerId: tower.id, targetId: target.id, damage: tower.damage, isTower: true },
          timestamp: Date.now(),
        });
        if (target.currentHp <= 0) {
          this.killCharacter(target);
        }
      }
    }
    // Remove destroyed towers
    this.towers = this.towers.filter(t => t.hp > 0);
  }

  // ─── AUTO ACTIONS ───────────────────────────────────────────────────

  private executeAutoActions(char: Character): void {
    if (char.isDead) return;
    if (char.effects.some(e => e.type === 'stun')) return;
    if (char.channelActivity) return;

    // Handle activity orders
    if (char.currentOrder) {
      const order = char.currentOrder;

      // Use item - instant
      if (order.type === 'use_item' && order.itemId) {
        this.useConsumable(char, order.itemId);
        char.currentOrder = null;
        return;
      }

      // Scout - at lookout position
      if (order.type === 'scout') {
        const lookout = this.pois.find(p =>
          p.type === 'lookout' && p.active &&
          this.tileDist(char.position, p.position) <= 0
        );
        if (lookout) {
          this.startChannel(char, 'scout');
          return;
        }
      }

      // Loot - at cache position
      if (order.type === 'loot') {
        const cache = this.pois.find(p =>
          p.type === 'treasure_cache' && p.active &&
          this.tileDist(char.position, p.position) <= 0
        );
        if (cache) {
          this.startChannel(char, 'loot');
          return;
        }
      }

      // Mine - at mine node
      if (order.type === 'mine' && !char.channelActivity) {
        const nearMine = this.mineNodes.find(m =>
          m.currentGold > 0 && m.activatePhase <= this.gamePhase &&
          this.tileDist(char.position, m.position) <= 1
        );
        if (nearMine) {
          this.startChannel(char, 'mine');
          return;
        }
      }

      // Build tower - at tower site, spend gold
      if (order.type === 'build_tower' && !char.channelActivity) {
        const nearSite = this.towerSites.find(s =>
          !s.occupied && s.activatePhase <= this.gamePhase &&
          this.tileDist(char.position, s.position) <= 1
        );
        if (nearSite && this.spendGold(char.owner, TOWER_COST)) {
          nearSite.occupied = true;
          this.startChannel(char, 'build_tower');
          return;
        }
      }

      // Build barricade
      if (order.type === 'build' && !char.channelActivity) {
        this.startChannel(char, 'build');
        return;
      }

      // Set trap
      if (order.type === 'set_trap' && !char.channelActivity) {
        this.startChannel(char, 'trap');
        return;
      }

      // Control order at owned CP - try to upgrade
      if (order.type === 'control' && order.targetPosition) {
        const team = this.getTeamForPlayer(char.owner);
        const cp = this.controlPoints.find(c =>
          c.position.x === order.targetPosition!.x &&
          c.position.y === order.targetPosition!.y
        );
        if (cp && cp.owner === team
          && !cp.upgraded
          && this.tileDist(char.position, cp.position) <= 1) {
          this.startChannel(char, 'upgrade_cp');
          return;
        }
      }
    }

    const enemies = Array.from(this.charData.values())
      .filter(c => c.owner !== char.owner && !c.isDead);

    // Execute ability order if in range
    if (char.currentOrder?.type === 'ability' && char.currentOrder.abilityId) {
      const target = char.currentOrder.targetCharacterId
        ? this.charData.get(char.currentOrder.targetCharacterId) : null;
      if (target && !target.isDead) {
        const cls = CLASSES[char.classId];
        const ability = cls.abilities.find(a => a.id === char.currentOrder!.abilityId);
        if (ability && this.tileDist(char.position, target.position) <= ability.range) {
          this.resolveAbility(char, ability.id, target.id);
          char.currentOrder = null;
          return;
        }
      }
    }

    const effectiveRange = this.getEffectiveRange(char);

    // Prioritize ordered attack target
    if (char.currentOrder?.type === 'attack' && char.currentOrder.targetCharacterId) {
      const target = this.charData.get(char.currentOrder.targetCharacterId);
      if (target && !target.isDead && !this.isConcealed(target)
        && this.tileDist(char.position, target.position) <= effectiveRange) {
        this.resolveAutoAttack(char, target);
        return;
      }
    }

    // Auto-attack nearest enemy in range
    for (const enemy of enemies) {
      if (this.isConcealed(enemy)) continue;
      if (this.tileDist(char.position, enemy.position) <= effectiveRange) {
        this.resolveAutoAttack(char, enemy);
        break;
      }
    }
  }

  // ─── COMBAT ──────────────────────────────────────────────────────────

  private resolveAutoAttack(attacker: Character, target: Character): void {
    const now = Date.now();
    const lastAtk = this.lastAttackTime.get(attacker.id) || 0;
    if (now - lastAtk < ATTACK_INTERVAL) return;
    this.lastAttackTime.set(attacker.id, now);

    let baseDamage = attacker.stats.attack;

    // Damage boost effect
    if (attacker.effects.some(e => e.type === 'damage_boost')) {
      baseDamage = Math.round(baseDamage * 1.5);
    }

    let defense = target.stats.defense;
    const defDebuff = target.effects.find(e => e.type === 'defense_debuff');
    if (defDebuff) {
      defense = Math.round(defense * 0.6);
    }

    let damage = Math.max(1, Math.round(baseDamage * (100 / (100 + defense))));

    // Terrain modifiers
    const attackerTile = this.gameMap.tiles[attacker.position.y]?.[attacker.position.x];
    const defenderTile = this.gameMap.tiles[target.position.y]?.[target.position.x];
    if (attackerTile === 'hill') damage = Math.round(damage * 1.25);
    if (defenderTile === 'forest') damage = Math.round(damage * 0.85);
    if (defenderTile === 'bush') damage = Math.round(damage * 0.9);

    // Forest ambush
    if (attackerTile === 'forest' && !this.forestAmbushUsed.has(attacker.id)) {
      damage = Math.round(damage * 1.3);
      this.forestAmbushUsed.add(attacker.id);
    }

    // Control point buffs
    const attackerBuffs = this.getTeamBuffs(attacker.owner);
    const defenderBuffs = this.getTeamBuffs(target.owner);
    if (attackerBuffs.damage > 1) damage = Math.round(damage * attackerBuffs.damage);
    if (defenderBuffs.defense > 1) damage = Math.max(1, Math.round(damage / defenderBuffs.defense));

    // Morale penalty
    if (attacker.morale === 'shaken') {
      damage = Math.round(damage * 0.9);
    }

    target.currentHp = Math.max(0, target.currentHp - damage);

    this.events.push({
      type: 'attack',
      data: { attackerId: attacker.id, targetId: target.id, damage },
      timestamp: now,
    });

    // Bark: taking damage
    this.triggerBark(target, 'taking_damage');

    // Bark: low HP
    if (target.currentHp > 0 && target.currentHp < target.stats.hp * 0.3) {
      this.triggerBark(target, 'low_hp');
      if (target.morale === 'confident') {
        target.morale = 'shaken';
        target.moraleTimer = 0;
      }
    }

    if (target.currentHp <= 0) {
      this.killCharacter(target, attacker.id);
    }
  }

  private resolveAbility(char: Character, abilityId: string, targetId?: string): void {
    const cls = CLASSES[char.classId];
    const ability = cls.abilities.find(a => a.id === abilityId);
    if (!ability) return;

    const cd = char.cooldowns[ability.id] || 0;
    if (cd > 0) return;
    char.cooldowns[ability.id] = ability.cooldown;

    // Damage
    if (ability.damage && targetId) {
      const target = this.charData.get(targetId);
      if (target && !target.isDead) {
        let damage = ability.damage + Math.round(char.stats.magic * 0.5);
        // Damage boost
        if (char.effects.some(e => e.type === 'damage_boost')) {
          damage = Math.round(damage * 1.5);
        }
        // Water fire penalty
        if (abilityId.includes('fireball') || abilityId.includes('fire')) {
          const tx = target.position.x;
          const ty = target.position.y;
          const adjWater = [[0, 1], [0, -1], [1, 0], [-1, 0]].some(([dx, dy]) => {
            const nx = tx + dx, ny = ty + dy;
            return nx >= 0 && nx < MAP_WIDTH && ny >= 0 && ny < MAP_HEIGHT
              && this.gameMap.tiles[ny]?.[nx] === 'water';
          });
          if (adjWater) damage = Math.round(damage * 0.8);
        }
        // CP damage buff
        const atkBuffs = this.getTeamBuffs(char.owner);
        if (atkBuffs.damage > 1) damage = Math.round(damage * atkBuffs.damage);

        target.currentHp = Math.max(0, target.currentHp - damage);

        this.events.push({
          type: 'ability',
          data: { casterId: char.id, targetId: target.id, abilityId, damage },
          timestamp: Date.now(),
        });

        if (target.currentHp <= 0) {
          this.killCharacter(target, char.id);
        }

        if (ability.effect) {
          this.applyAbilityEffect(target, ability.effect);
        }
      }
    }

    // Healing
    if (ability.healing) {
      const heal = ability.healing + Math.round(char.stats.magic * 0.3);
      if (ability.damage) {
        // Self-heal (Drain Life, Divine Smite)
        char.currentHp = Math.min(char.stats.hp, char.currentHp + heal);
      } else if (targetId) {
        // Heal target (Healing Light)
        const target = this.charData.get(targetId);
        if (target && !target.isDead) {
          target.currentHp = Math.min(target.stats.hp, target.currentHp + heal);
        }
      }
    }

    // Non-damage abilities with effects
    if (!ability.damage && ability.effect && targetId) {
      const target = this.charData.get(targetId);
      if (target) this.applyAbilityEffect(target, ability.effect);
    }
  }

  private applyAbilityEffect(target: Character, effect: any): void {
    switch (effect.type) {
      case 'stun':
        target.effects.push({ type: 'stun', duration: effect.duration, value: 1 });
        this.events.push({
          type: 'announcement',
          data: { text: `${target.name} STUNNED!` },
          timestamp: Date.now(),
        });
        break;
      case 'slow':
        target.effects.push({ type: 'slow', duration: effect.duration, value: effect.factor || 0.5 });
        break;
      case 'debuff':
        target.effects.push({ type: 'defense_debuff', duration: effect.duration, value: effect.amount || 5 });
        break;
    }
  }

  // ─── KILL / RESPAWN ──────────────────────────────────────────────────

  private killCharacter(char: Character, killerId?: string): void {
    char.isDead = true;
    const team = this.getTeamForPlayer(char.owner);
    const isLosingTeam = team === 'player1'
      ? this.domScore1 < this.domScore2
      : this.domScore2 < this.domScore1;
    char.respawnTimer = isLosingTeam ? Math.max(5, RESPAWN_TIME - 3) : RESPAWN_TIME;
    char.path = [];
    char.currentOrder = null;
    char.channelActivity = null;
    const queue = this.orderQueues.get(char.id);
    if (queue) queue.length = 0;

    if (killerId) {
      const killer = this.charData.get(killerId);
      if (killer) {
        this.grantXP(killer, XP_KILL);
        this.triggerBark(killer, 'got_kill');
      }
    }

    // Bark: ally down
    const nearbyAllies = Array.from(this.charData.values()).filter(c =>
      c.id !== char.id && c.owner === char.owner && !c.isDead &&
      this.tileDist(c.position, char.position) <= 5
    );
    for (const ally of nearbyAllies) {
      this.triggerBark(ally, 'ally_down');
      if (ally.morale === 'confident' && Math.random() < 0.5) {
        ally.morale = 'shaken';
        ally.moraleTimer = 0;
      }
    }

    this.events.push({ type: 'kill', data: { victimId: char.id, killerId }, timestamp: Date.now() });
  }

  private respawnCharacter(char: Character): void {
    char.isDead = false;
    char.currentHp = char.stats.hp;
    char.respawnTimer = 0;
    char.effects = [];
    char.cooldowns = {};
    const team = this.getTeamForPlayer(char.owner);
    const spawns = team === 'player1' ? this.gameMap.spawnP1 : this.gameMap.spawnP2;
    char.position = { ...spawns[Math.floor(Math.random() * spawns.length)] };
  }

  // ─── XP / LEVELING ──────────────────────────────────────────────────

  private grantXP(char: Character, amount: number): void {
    if (char.level >= 5) return;
    char.xp += amount;

    const nextThreshold = XP_THRESHOLDS[char.level] ?? Infinity;
    if (char.xp >= nextThreshold) {
      char.level++;
      this.applyLevelStats(char);
      this.events.push({
        type: 'levelup',
        data: { characterId: char.id, level: char.level },
        timestamp: Date.now(),
      });
    }
  }

  private applyLevelStats(char: Character): void {
    const bonus = 1 + (char.level - 1) * LEVEL_STAT_BONUS;
    const prevHpMax = char.stats.hp;
    char.stats = {
      hp: Math.round(char.baseStats.hp * bonus),
      attack: Math.round(char.baseStats.attack * bonus),
      defense: Math.round(char.baseStats.defense * bonus),
      speed: Math.round(char.baseStats.speed * bonus),
      range: char.baseStats.range,
      magic: Math.round(char.baseStats.magic * bonus),
    };
    const hpGain = char.stats.hp - prevHpMax;
    if (hpGain > 0) char.currentHp = Math.min(char.stats.hp, char.currentHp + hpGain);
  }

  // ─── CONTROL POINTS ──────────────────────────────────────────────────

  private initControlPoints(): void {
    const defs = this.gameMap.controlPointDefs;
    const positions = this.gameMap.controlPointPositions;
    const defaultBuffs = [
      { type: 'speed' as const, value: 1.1, label: '+10% Speed' },
      { type: 'damage' as const, value: 1.15, label: '+15% Damage' },
      { type: 'defense' as const, value: 1.1, label: '+10% Defense' },
    ];

    for (let i = 0; i < positions.length; i++) {
      const def = defs?.[i];
      const cp: ControlPoint = {
        id: def?.id || `cp_${i}`,
        name: def?.name || `Point ${String.fromCharCode(65 + i)}`,
        position: positions[i],
        radius: def?.radius || 2,
        owner: null,
        captureProgress: 0,
        capturingTeam: null,
        buff: def?.buff || defaultBuffs[i % defaultBuffs.length],
      };
      this.controlPoints.push(cp);
    }
  }

  private updateControlPoints(): void {
    for (const cp of this.controlPoints) {
      const nearby: Record<string, number> = { player1: 0, player2: 0 };
      this.charData.forEach(char => {
        if (char.isDead) return;
        if (this.tileDist(char.position, cp.position) <= (cp.radius || 2)) {
          const team = this.getTeamForPlayer(char.owner);
          nearby[team]++;
        }
      });

      const p1 = nearby.player1;
      const p2 = nearby.player2;

      if (p1 > 0 && p2 > 0) {
        // Contested - no progress
      } else if (p1 > 0) {
        if (cp.owner !== 'player1') {
          cp.capturingTeam = 'player1';
          cp.captureProgress = Math.min(100, cp.captureProgress + 3);
          if (cp.captureProgress >= 100) {
            cp.owner = 'player1';
            cp.captureProgress = 100;
            // Grant XP to nearby player1 chars
            this.charData.forEach(c => {
              if (this.getTeamForPlayer(c.owner) === 'player1' && !c.isDead
                && this.tileDist(c.position, cp.position) <= 2) {
                this.grantXP(c, XP_CAPTURE_CP);
              }
            });
            this.events.push({
              type: 'capture',
              data: { cpId: cp.id, team: 'player1', buff: cp.buff.label },
              timestamp: Date.now(),
            });
          }
        }
      } else if (p2 > 0) {
        if (cp.owner !== 'player2') {
          cp.capturingTeam = 'player2';
          cp.captureProgress = Math.min(100, cp.captureProgress + 3);
          if (cp.captureProgress >= 100) {
            cp.owner = 'player2';
            cp.captureProgress = 100;
            this.charData.forEach(c => {
              if (this.getTeamForPlayer(c.owner) === 'player2' && !c.isDead
                && this.tileDist(c.position, cp.position) <= 2) {
                this.grantXP(c, XP_CAPTURE_CP);
              }
            });
            this.events.push({
              type: 'capture',
              data: { cpId: cp.id, team: 'player2', buff: cp.buff.label },
              timestamp: Date.now(),
            });
          }
        }
      } else {
        // Empty - decay
        if (cp.captureProgress > 0 && !cp.owner) {
          cp.captureProgress = Math.max(0, cp.captureProgress - 2);
          if (cp.captureProgress === 0) cp.capturingTeam = null;
        }
      }
    }
  }

  // ─── DOMINATION ─────────────────────────────────────────────────────

  private initDomination(): void {
    this.domScore1 = 0;
    this.domScore2 = 0;
    this.ctf = {
      flag1: { position: { x: 0, y: 0 }, homePosition: { x: 0, y: 0 }, carrier: null, isHome: true },
      flag2: { position: { x: 0, y: 0 }, homePosition: { x: 0, y: 0 }, carrier: null, isHome: true },
      score1: 0, score2: 0, capturesNeeded: 999,
    };
  }

  private tickDominationScoring(): void {
    let p1Points = 0;
    let p2Points = 0;
    for (let i = 0; i < this.controlPoints.length; i++) {
      const cp = this.controlPoints[i];
      const mult = i === 1 ? CENTER_CP_MULTIPLIER : 1;
      if (cp.owner === 'player1') p1Points += DOM_POINTS_PER_TICK * mult;
      if (cp.owner === 'player2') p2Points += DOM_POINTS_PER_TICK * mult;
    }
    if (p1Points > 0 || p2Points > 0) {
      this.domScore1 += p1Points;
      this.domScore2 += p2Points;
    }

    if (this.domScore1 >= DOM_POINTS_TO_WIN) {
      this.endGame(this.player1Id, 'domination');
    } else if (this.domScore2 >= DOM_POINTS_TO_WIN) {
      this.endGame(this.player2Id, 'domination');
    }
  }

  // ─── PICKUPS ──────────────────────────────────────────────────────────

  private spawnPickups(): void {
    if (this.gameMap.controlPointDefs && this.gameMap.poiPlacements.length === 0) return;

    const cx = Math.floor(MAP_WIDTH / 2);
    const cy = Math.floor(MAP_HEIGHT / 2);

    const defs: { type: PickupState['type']; pos: Position }[] = [
      { type: 'health_potion', pos: { x: cx, y: cy - 8 } },
      { type: 'health_potion', pos: { x: cx, y: cy + 8 } },
      { type: 'health_potion', pos: { x: cx - 16, y: cy } },
      { type: 'health_potion', pos: { x: cx + 16, y: cy } },
      { type: 'speed_boost', pos: { x: cx - 12, y: cy - 10 } },
      { type: 'speed_boost', pos: { x: cx + 12, y: cy + 10 } },
      { type: 'damage_boost', pos: { x: cx - 10, y: cy + 12 } },
      { type: 'damage_boost', pos: { x: cx + 10, y: cy - 12 } },
    ];

    for (let i = 0; i < defs.length; i++) {
      let pos = defs[i].pos;
      if (!isPassable(this.gameMap.tiles[pos.y]?.[pos.x])) {
        for (const [dx, dy] of [[0, 1], [0, -1], [1, 0], [-1, 0], [1, 1], [-1, -1]]) {
          const nx = pos.x + dx;
          const ny = pos.y + dy;
          if (nx >= 0 && nx < MAP_WIDTH && ny >= 0 && ny < MAP_HEIGHT
            && isPassable(this.gameMap.tiles[ny]?.[nx])) {
            pos = { x: nx, y: ny };
            break;
          }
        }
      }

      this.pickups.push({
        id: `pickup_${i}`,
        type: defs[i].type,
        position: pos,
        active: true,
        respawnTimer: 0,
      });
    }
  }

  private checkPickupCollisions(): void {
    this.charData.forEach((char) => {
      if (char.isDead) return;
      for (const pickup of this.pickups) {
        if (!pickup.active) continue;
        if (char.position.x === pickup.position.x && char.position.y === pickup.position.y) {
          this.collectPickup(char, pickup);
        }
      }
    });
  }

  private collectPickup(char: Character, pickup: PickupState): void {
    pickup.active = false;
    pickup.respawnTimer = PICKUP_RESPAWN;

    switch (pickup.type) {
      case 'health_potion': {
        const heal = Math.round(char.stats.hp * 0.35);
        char.currentHp = Math.min(char.stats.hp, char.currentHp + heal);
        break;
      }
      case 'speed_boost':
        char.effects.push({ type: 'speed_boost', duration: 12, value: 2 });
        break;
      case 'damage_boost':
        char.effects.push({ type: 'damage_boost', duration: 12, value: 1.5 });
        break;
    }

    this.events.push({
      type: 'pickup',
      data: { characterId: char.id, pickupType: pickup.type },
      timestamp: Date.now(),
    });
  }

  // ─── POI SYSTEM ─────────────────────────────────────────────────────

  private initPOIs(): void {
    let poiIdx = 0;
    for (const placement of this.gameMap.poiPlacements) {
      const poi: POI = {
        id: `poi_${poiIdx++}`,
        type: placement.type,
        position: placement.position,
        active: true,
        respawnTimer: 0,
        channelTime: placement.type === 'lookout' ? SCOUT_CHANNEL_TICKS
          : placement.type === 'treasure_cache' ? LOOT_CHANNEL_TICKS : 0,
      };
      this.pois.push(poi);
    }
  }

  private updatePOIs(): void {
    // Healing wells: passively heal characters standing on them
    for (const poi of this.pois) {
      if (poi.type !== 'healing_well' || !poi.active) continue;
      this.charData.forEach(char => {
        if (char.isDead) return;
        if (char.position.x === poi.position.x && char.position.y === poi.position.y) {
          if (char.currentHp < char.stats.hp) {
            const heal = Math.min(WELL_HEAL_PER_TICK, char.stats.hp - char.currentHp);
            char.currentHp += heal;
          }
        }
      });
    }
  }

  private tickPOIRespawns(): void {
    for (const poi of this.pois) {
      if (!poi.active && poi.respawnTimer > 0) {
        poi.respawnTimer--;
        if (poi.respawnTimer <= 0) {
          poi.active = true;
        }
      }
    }
  }

  // ─── MAP FEATURES ───────────────────────────────────────────────────

  private initMapFeatures(): void {
    this.mineNodes = this.gameMap.mineNodes ? [...this.gameMap.mineNodes] : [];
    this.towerSites = this.gameMap.towerSites ? [...this.gameMap.towerSites] : [];
    this.neutralCamps = this.gameMap.neutralCamps ? [...this.gameMap.neutralCamps] : [];
  }

  // ─── ACTIVITY CHANNELING ────────────────────────────────────────────

  private updateChanneling(): void {
    this.charData.forEach(char => {
      if (char.isDead || !char.channelActivity) return;

      const activity = char.channelActivity;

      // Check if still at the position
      if (char.position.x !== activity.position.x || char.position.y !== activity.position.y) {
        char.channelActivity = null;
        return;
      }

      // Check if stunned = interrupt
      if (char.effects.some(e => e.type === 'stun')) {
        char.channelActivity = null;
        return;
      }

      activity.ticksRemaining--;

      if (activity.ticksRemaining <= 0) {
        this.completeChannel(char, activity.type);
        char.channelActivity = null;
        char.currentOrder = null;
      }
    });
  }

  private getChannelTotal(type: string): number {
    switch (type) {
      case 'scout': return SCOUT_CHANNEL_TICKS;
      case 'loot': return LOOT_CHANNEL_TICKS;
      case 'build': return BUILD_CHANNEL_TICKS;
      case 'trap': return TRAP_CHANNEL_TICKS;
      case 'upgrade_cp': return UPGRADE_CP_TICKS;
      case 'mine': return MINE_CHANNEL_TICKS;
      case 'build_tower': return BUILD_TOWER_TICKS;
      default: return 10;
    }
  }

  private startChannel(char: Character, type: 'scout' | 'loot' | 'build' | 'trap' | 'upgrade_cp' | 'mine' | 'build_tower'): void {
    char.channelActivity = {
      type,
      ticksRemaining: this.getChannelTotal(type),
      position: { ...char.position },
    };
    char.path = [];
  }

  private completeChannel(char: Character, type: string): void {
    switch (type) {
      case 'scout': {
        this.lookoutVisionZones.push({
          center: { ...char.position },
          radius: LOOKOUT_VISION_RADIUS,
          expiresAt: Date.now() + LOOKOUT_VISION_DURATION * 1000,
        });
        this.grantXP(char, XP_SCOUT);
        this.events.push({
          type: 'announcement',
          data: { text: `${char.name} scouted! Vision revealed for ${LOOKOUT_VISION_DURATION}s` },
          timestamp: Date.now(),
        });
        break;
      }
      case 'loot': {
        const poi = this.pois.find(p =>
          p.type === 'treasure_cache' && p.active &&
          p.position.x === char.position.x && p.position.y === char.position.y
        );
        if (poi) {
          poi.active = false;
          poi.respawnTimer = CACHE_RESPAWN_TIME;
        }
        if (char.inventory.length < MAX_INVENTORY) {
          const item = rollRandomConsumable();
          char.inventory.push(item);
          const def = CONSUMABLES[item];
          this.grantXP(char, XP_LOOT_CACHE);
          this.events.push({
            type: 'announcement',
            data: { text: `${char.name} looted: ${def.name}!` },
            timestamp: Date.now(),
          });
        }
        break;
      }
      case 'build': {
        const barricade: Barricade = {
          id: `barricade_${Date.now()}`,
          position: { ...char.position },
          owner: char.owner,
          hp: BARRICADE_HP,
          maxHp: BARRICADE_HP,
          decayTimer: BARRICADE_DECAY,
        };
        this.barricades.push(barricade);
        break;
      }
      case 'trap': {
        const team = this.getTeamForPlayer(char.owner);
        const teamTraps = this.traps.filter(t => this.getTeamForPlayer(t.owner) === team);
        if (teamTraps.length >= MAX_TRAPS_PER_TEAM) {
          const oldest = teamTraps[0];
          this.traps = this.traps.filter(t => t.id !== oldest.id);
        }
        const trap: Trap = {
          id: `trap_${Date.now()}`,
          position: { ...char.position },
          owner: char.owner,
          damage: TRAP_DAMAGE,
          stunDuration: TRAP_STUN,
          visible: false,
        };
        this.traps.push(trap);
        break;
      }
      case 'upgrade_cp': {
        const team = this.getTeamForPlayer(char.owner);
        const cp = this.controlPoints.find(c =>
          c.owner === team && this.tileDist(char.position, c.position) <= 2
        );
        if (cp && !cp.upgraded) {
          cp.upgraded = true;
          cp.buff.value *= 1.5;
          cp.buff.label = cp.buff.label + ' (UP)';
          this.events.push({
            type: 'announcement',
            data: { text: `${char.name} upgraded control point!` },
            timestamp: Date.now(),
          });
        }
        break;
      }
      case 'mine': {
        const mine = this.mineNodes.find(m =>
          m.currentGold > 0 && this.tileDist(char.position, m.position) <= 1
        );
        if (mine) {
          const goldEarned = Math.min(MINE_RATE_PER_SEC * 3, mine.currentGold);
          mine.currentGold -= goldEarned;
          const team = this.getTeamForPlayer(char.owner);
          this.economy[team].gold += goldEarned;
          // If mine still has gold, keep mining
          if (mine.currentGold > 0 && char.currentOrder?.type === 'mine') {
            this.startChannel(char, 'mine');
            return; // don't clear order
          } else if (mine.currentGold <= 0) {
            this.triggerBark(char, 'mine_depleted');
            this.events.push({
              type: 'announcement',
              data: { text: `${mine.name} depleted!` },
              timestamp: Date.now(),
            });
          }
        }
        break;
      }
      case 'build_tower': {
        const site = this.towerSites.find(s =>
          s.occupied && this.tileDist(char.position, s.position) <= 1
        );
        if (site) {
          const tower: Tower = {
            id: `tower_${Date.now()}`,
            position: { ...site.position },
            owner: this.getTeamForPlayer(char.owner),
            hp: TOWER_HP,
            maxHp: TOWER_HP,
            damage: TOWER_DPS,
            range: TOWER_RANGE,
          };
          this.towers.push(tower);
          this.events.push({
            type: 'announcement',
            data: { text: `${char.name} built a tower!` },
            timestamp: Date.now(),
          });
        }
        break;
      }
    }
  }

  // ─── BARRICADES & TRAPS ──────────────────────────────────────────────

  private updateBarricadesAndTraps(): void {
    // Remove destroyed/decayed barricades
    for (let i = this.barricades.length - 1; i >= 0; i--) {
      const b = this.barricades[i];
      if (b.hp <= 0 || b.decayTimer <= 0) {
        this.barricades.splice(i, 1);
      }
    }

    // Trap triggers
    this.charData.forEach(char => {
      if (char.isDead) return;
      for (let i = this.traps.length - 1; i >= 0; i--) {
        const trap = this.traps[i];
        if (trap.owner === char.owner) continue;
        if (char.position.x === trap.position.x && char.position.y === trap.position.y) {
          char.currentHp = Math.max(0, char.currentHp - trap.damage);
          char.effects.push({ type: 'stun', duration: trap.stunDuration, value: 1 });
          this.events.push({
            type: 'attack',
            data: { trapId: trap.id, targetId: char.id, damage: trap.damage },
            timestamp: Date.now(),
          });
          if (char.currentHp <= 0) this.killCharacter(char);
          this.traps.splice(i, 1);
          break;
        }
      }
    });
  }

  private tickBarricadeDecay(): void {
    for (const b of this.barricades) {
      b.decayTimer--;
    }
  }

  // ─── CONSUMABLE USE ──────────────────────────────────────────────────

  private useConsumable(char: Character, itemId: ConsumableId): void {
    const idx = char.inventory.indexOf(itemId);
    if (idx === -1) return;
    char.inventory.splice(idx, 1);

    switch (itemId) {
      case 'siege_bomb': {
        this.charData.forEach(target => {
          if (target.owner === char.owner || target.isDead) return;
          if (this.tileDist(char.position, target.position) <= 2) {
            target.currentHp = Math.max(0, target.currentHp - 40);
            this.events.push({
              type: 'attack',
              data: { attackerId: char.id, targetId: target.id, damage: 40, isSiegeBomb: true },
              timestamp: Date.now(),
            });
            if (target.currentHp <= 0) this.killCharacter(target, char.id);
          }
        });
        break;
      }
      case 'smoke_bomb': {
        // Simplified: grant stealth to nearby allies for 8s
        this.charData.forEach(ally => {
          if (ally.owner === char.owner && !ally.isDead
            && this.tileDist(char.position, ally.position) <= 3) {
            ally.effects.push({ type: 'stealth', duration: 8, value: 1 });
          }
        });
        break;
      }
      case 'battle_horn': {
        this.charData.forEach(ally => {
          if (ally.owner === char.owner && !ally.isDead) {
            ally.effects.push({ type: 'damage_boost', duration: 12, value: 1.3 });
          }
        });
        this.events.push({
          type: 'announcement',
          data: { text: 'BATTLE HORN! +30% DMG' },
          timestamp: Date.now(),
        });
        break;
      }
      case 'haste_elixir': {
        char.effects.push({ type: 'speed_boost', duration: 15, value: 2 });
        break;
      }
      case 'iron_skin': {
        char.effects.push({ type: 'iron_skin', duration: 20, value: 1.4 });
        break;
      }
      case 'vision_flare': {
        this.visionFlareUntil = Date.now() + 10000;
        this.events.push({
          type: 'announcement',
          data: { text: 'VISION FLARE! Map revealed!' },
          timestamp: Date.now(),
        });
        break;
      }
      case 'rally_banner': {
        this.charData.forEach(ally => {
          if (ally.owner === char.owner && ally.isDead && (ally.respawnTimer ?? 0) > 8) {
            ally.respawnTimer = Math.max(1, (ally.respawnTimer ?? 0) - 8);
          }
        });
        this.events.push({
          type: 'announcement',
          data: { text: 'RALLY! Respawns accelerated!' },
          timestamp: Date.now(),
        });
        break;
      }
      case 'purge_scroll': {
        for (let i = this.barricades.length - 1; i >= 0; i--) {
          const b = this.barricades[i];
          if (b.owner !== char.owner && this.tileDist(char.position, b.position) <= 5) {
            this.barricades.splice(i, 1);
          }
        }
        this.events.push({
          type: 'announcement',
          data: { text: 'PURGE! Enemy barricades destroyed!' },
          timestamp: Date.now(),
        });
        break;
      }
    }
  }

  // ─── ECONOMY ──────────────────────────────────────────────────────────

  private tickEconomy(): void {
    const p1Econ = this.economy.player1;
    const p2Econ = this.economy.player2;

    let p1Income = BASE_INCOME_PER_SEC;
    let p2Income = BASE_INCOME_PER_SEC;

    const incomeMultiplier = this.gamePhase >= 4 ? 2 : 1;

    // Upkeep penalty
    const p1UnitCount = Array.from(this.charData.values()).filter(c =>
      this.getTeamForPlayer(c.owner) === 'player1' && !c.isDead
    ).length;
    const p2UnitCount = Array.from(this.charData.values()).filter(c =>
      this.getTeamForPlayer(c.owner) === 'player2' && !c.isDead
    ).length;
    const p1Upkeep = p1UnitCount > p2UnitCount ? 0.85 : 1;
    const p2Upkeep = p2UnitCount > p1UnitCount ? 0.85 : 1;

    // Safe mine slowdown at Phase 3+
    const safeMineSlowdown = this.gamePhase >= 3 ? 0.5 : 1;

    // Mining income from characters at mine nodes
    this.charData.forEach(char => {
      if (char.isDead) return;
      if (char.channelActivity?.type === 'mine') {
        const nearMine = this.mineNodes.find(m =>
          this.tileDist(char.position, m.position) <= 1
        );
        const mineSlowdown = nearMine?.type === 'safe' ? safeMineSlowdown : 1;
        const rate = MINE_RATE_PER_SEC * incomeMultiplier * mineSlowdown;
        const team = this.getTeamForPlayer(char.owner);
        if (team === 'player1') {
          p1Income += rate * p1Upkeep;
        } else {
          p2Income += rate * p2Upkeep;
        }
      }
    });

    p1Econ.income = p1Income;
    p2Econ.income = p2Income;
    p1Econ.upkeepPenalty = p1Upkeep;
    p2Econ.upkeepPenalty = p2Upkeep;

    p1Econ.gold += p1Income;
    p2Econ.gold += p2Income;
  }

  // ─── GAME PHASE ──────────────────────────────────────────────────────

  private updateGamePhase(): void {
    const prev = this.gamePhase;
    if (this.elapsedSeconds >= 250) {
      this.gamePhase = 4;
    } else if (this.elapsedSeconds >= 180) {
      this.gamePhase = 3;
    } else if (this.elapsedSeconds >= 90) {
      this.gamePhase = 2;
    } else {
      this.gamePhase = 1;
    }

    if (this.gamePhase !== prev) {
      const labels: Record<number, string> = {
        2: 'MID GAME — Camps & rich mines open!',
        3: 'LATE GAME — Safe mines slow, fight for center!',
        4: 'OVERTIME — Double income, final push!',
      };
      if (labels[this.gamePhase]) {
        this.events.push({
          type: 'announcement',
          data: { text: labels[this.gamePhase] },
          timestamp: Date.now(),
        });
      }
    }
  }

  // ─── MORALE & BARKS ─────────────────────────────────────────────────

  private tickMorale(): void {
    this.charData.forEach((char) => {
      if (char.isDead) return;

      const nearAlly = Array.from(this.charData.values()).some(c =>
        c.id !== char.id && c.owner === char.owner && !c.isDead &&
        this.tileDist(c.position, char.position) <= 3
      );

      if (char.morale === 'shaken') {
        char.moraleTimer = (char.moraleTimer ?? 0) + 1;
        if (nearAlly || char.currentHp > char.stats.hp * 0.7 || (char.moraleTimer ?? 0) >= 15) {
          char.morale = 'confident';
          char.moraleTimer = 0;
        }
      }

      // Ignored while hurt: below 40% HP for 10+ seconds without praise
      if (char.currentHp < char.stats.hp * 0.4) {
        const timeSincePraise = Date.now() - (char.lastPraised ?? 0);
        if (timeSincePraise > 10000 && char.morale === 'confident') {
          this.triggerBark(char, 'ignored_while_hurt');
        }
      }
    });
  }

  private triggerBark(char: Character, trigger: BarkTrigger): void {
    const now = Date.now();
    const lastBark = this.lastBarkTime.get(char.id) || 0;
    if (now - lastBark < BARK_COOLDOWN * 1000) return;

    if (!char.personality) return;
    const text = getBark(char.personality, trigger);
    if (!text) return;

    this.lastBarkTime.set(char.id, now);
    this.events.push({
      type: 'bark',
      data: { characterId: char.id, text, trigger },
      timestamp: now,
    });
  }

  // ─── COOLDOWNS ──────────────────────────────────────────────────────

  private tickCooldowns(): void {
    this.charData.forEach(char => {
      for (const id of Object.keys(char.cooldowns)) {
        if (char.cooldowns[id] > 0) char.cooldowns[id]--;
      }
      char.effects = char.effects.filter(e => { e.duration--; return e.duration > 0; });
    });
  }

  // ─── SWITCH / GATE SYSTEM ────────────────────────────────────────────

  private triggerSwitch(pos: Position): void {
    const key = `${pos.x},${pos.y}`;
    if (this.activatedSwitches.has(key)) return;
    this.activatedSwitches.add(key);

    // Debounce: clear after 2 seconds using setTimeout
    const timer = setTimeout(() => {
      this.activatedSwitches.delete(key);
      this.switchDebounceTimers.delete(key);
    }, 2000);
    this.switchDebounceTimers.set(key, timer);

    for (const link of this.switchGateLinks) {
      if (link.switchPos.x === pos.x && link.switchPos.y === pos.y) {
        for (const gp of link.gatePositions) {
          const current = this.gameMap.tiles[gp.y]?.[gp.x];
          if (current === 'gate_closed') {
            this.gameMap.tiles[gp.y][gp.x] = 'gate_open' as TileType;
          } else if (current === 'gate_open') {
            this.gameMap.tiles[gp.y][gp.x] = 'gate_closed' as TileType;
          }
        }
        break;
      }
    }
  }

  // ─── PATHFINDING / MOVEMENT ──────────────────────────────────────────

  private recalculatePath(char: Character): void {
    const order = char.currentOrder;
    if (!order) return;
    const occupied = this.getOccupiedPositions(char.id);
    const team = this.getTeamForPlayer(char.owner);

    switch (order.type) {
      case 'move':
      case 'capture': {
        if (!order.targetPosition) return;
        if (this.tileDist(char.position, order.targetPosition) <= 1) {
          char.currentOrder = null;
          return;
        }
        char.path = findPath(this.gameMap.tiles, char.position, order.targetPosition,
          char.stats.speed + 2, occupied);
        break;
      }
      case 'patrol': {
        if (!order.targetPosition) return;
        if (this.tileDist(char.position, order.targetPosition) <= 1) {
          const origin = (order as any)._patrolOrigin || char.position;
          (order as any)._patrolOrigin = { ...order.targetPosition };
          order.targetPosition = { ...origin };
        }
        if (order.targetPosition) {
          char.path = findPath(this.gameMap.tiles, char.position, order.targetPosition,
            char.stats.speed + 2, occupied);
        }
        break;
      }
      case 'defend':
      case 'hold': {
        char.path = [];
        break;
      }
      case 'attack': {
        if (!order.targetCharacterId) return;
        const target = this.charData.get(order.targetCharacterId);
        if (!target || target.isDead) {
          const enemies = Array.from(this.charData.values())
            .filter(c => c.owner !== char.owner && !c.isDead);
          if (enemies.length > 0) {
            const nearest = this.findNearest(char.position, enemies);
            order.targetCharacterId = nearest.id;
          } else {
            char.currentOrder = null;
          }
          return;
        }
        if (this.tileDist(char.position, target.position) > char.stats.range) {
          char.path = findPath(this.gameMap.tiles, char.position, target.position,
            char.stats.speed + 2, occupied);
        }
        break;
      }
      case 'ability': {
        if (!order.targetCharacterId || !order.abilityId) return;
        const target = this.charData.get(order.targetCharacterId);
        if (!target || target.isDead) { char.currentOrder = null; return; }
        const cls = CLASSES[char.classId];
        const ability = cls.abilities.find(a => a.id === order.abilityId);
        if (!ability) { char.currentOrder = null; return; }
        if (this.tileDist(char.position, target.position) > ability.range) {
          char.path = findPath(this.gameMap.tiles, char.position, target.position,
            char.stats.speed + 2, occupied);
        }
        break;
      }
      case 'retreat': {
        const spawn = team === 'player1' ? this.gameMap.spawnP1[0] : this.gameMap.spawnP2[0];
        if (this.tileDist(char.position, spawn) <= 1) { char.currentOrder = null; return; }
        char.path = findPath(this.gameMap.tiles, char.position, spawn,
          char.stats.speed + 2, occupied);
        break;
      }
      case 'escort': {
        if (!order.targetCharacterId) return;
        const carrier = this.charData.get(order.targetCharacterId);
        if (!carrier || carrier.isDead) { char.currentOrder = null; return; }
        if (this.tileDist(char.position, carrier.position) > 2) {
          char.path = findPath(this.gameMap.tiles, char.position, carrier.position,
            char.stats.speed + 2, occupied);
        }
        break;
      }
      case 'control': {
        if (!order.targetPosition) return;
        if (this.tileDist(char.position, order.targetPosition) <= 1) {
          return;
        }
        char.path = findPath(this.gameMap.tiles, char.position, order.targetPosition,
          char.stats.speed + 2, occupied);
        break;
      }
      case 'scout': {
        const lookout = this.pois
          .filter(p => p.type === 'lookout' && p.active)
          .sort((a, b) => this.tileDist(char.position, a.position) - this.tileDist(char.position, b.position))[0];
        if (!lookout) { char.currentOrder = null; return; }
        if (this.tileDist(char.position, lookout.position) <= 0) return;
        char.path = findPath(this.gameMap.tiles, char.position, lookout.position,
          char.stats.speed + 2, occupied);
        break;
      }
      case 'loot': {
        const cache = this.pois
          .filter(p => p.type === 'treasure_cache' && p.active)
          .sort((a, b) => this.tileDist(char.position, a.position) - this.tileDist(char.position, b.position))[0];
        if (!cache) { char.currentOrder = null; return; }
        if (this.tileDist(char.position, cache.position) <= 0) return;
        char.path = findPath(this.gameMap.tiles, char.position, cache.position,
          char.stats.speed + 2, occupied);
        break;
      }
      case 'build':
      case 'set_trap': {
        if (order.targetPosition && this.tileDist(char.position, order.targetPosition) > 0) {
          char.path = findPath(this.gameMap.tiles, char.position, order.targetPosition,
            char.stats.speed + 2, occupied);
        }
        break;
      }
      case 'mine': {
        const mine = this.mineNodes
          .filter(m => m.currentGold > 0 && m.activatePhase <= this.gamePhase)
          .sort((a, b) => this.tileDist(char.position, a.position) - this.tileDist(char.position, b.position))[0];
        if (!mine) { char.currentOrder = null; return; }
        if (this.tileDist(char.position, mine.position) <= 1) return;
        char.path = findPath(this.gameMap.tiles, char.position, mine.position,
          char.stats.speed + 2, occupied);
        break;
      }
      case 'build_tower': {
        const site = this.towerSites
          .filter(s => !s.occupied && s.activatePhase <= this.gamePhase)
          .sort((a, b) => this.tileDist(char.position, a.position) - this.tileDist(char.position, b.position))[0];
        if (!site) { char.currentOrder = null; return; }
        if (this.tileDist(char.position, site.position) <= 1) return;
        char.path = findPath(this.gameMap.tiles, char.position, site.position,
          char.stats.speed + 2, occupied);
        break;
      }
      case 'praise': {
        char.currentOrder = null;
        break;
      }
      case 'use_item': {
        // Instant - handled in executeAutoActions
        break;
      }
    }
  }

  // ─── END GAME ────────────────────────────────────────────────────────

  private endGame(winner: string, reason: string): void {
    if (this.gameOver) return;
    this.gameOver = true;
    this.stop();

    // Send final snapshot
    const snapshot = this.buildSyncSnapshot();
    snapshot.gameOver = true;
    snapshot.winner = winner;
    snapshot.winReason = reason;
    this.onStateUpdate(snapshot);

    this.onGameOver(winner, reason);
  }

  // ─── STATE SNAPSHOT ──────────────────────────────────────────────────

  private buildSyncSnapshot(): SyncSnapshot {
    const characters: Record<string, Character> = {};
    this.charData.forEach((char, id) => characters[id] = char);
    const orderQueues: Record<string, CharacterOrder[]> = {};
    this.orderQueues.forEach((queue, id) => orderQueues[id] = [...queue]);

    return {
      characters,
      ctf: this.ctf,
      timeRemaining: this.gameTimeRemaining,
      controlPoints: this.controlPoints,
      orderQueues,
      domScore1: this.domScore1,
      domScore2: this.domScore2,
      gameOver: this.gameOver || undefined,
      pickups: this.pickups,
      economy: {
        player1: { ...this.economy.player1 },
        player2: { ...this.economy.player2 },
      },
      barricades: this.barricades,
      traps: this.traps.map(t => ({
        id: t.id,
        position: t.position,
        owner: t.owner,
        damage: t.damage,
        stunDuration: t.stunDuration,
      })),
      pois: this.pois,
      mineNodes: this.mineNodes,
      towers: this.towers,
      towerSites: this.towerSites,
      gamePhase: this.gamePhase,
      events: [...this.events],
    };
  }

  // ─── UTILITY ──────────────────────────────────────────────────────────

  private tileDist(a: Position, b: Position): number {
    return Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
  }

  private getOccupiedPositions(excludeId?: string): Set<string> {
    const occupied = new Set<string>();
    this.charData.forEach((c) => {
      if (!c.isDead && c.id !== excludeId) occupied.add(`${c.position.x},${c.position.y}`);
    });
    return occupied;
  }

  private getTeamBuffs(owner: string): { speed: number; damage: number; defense: number } {
    const team = this.getTeamForPlayer(owner);
    const buffs = { speed: 1, damage: 1, defense: 1 };
    for (const cp of this.controlPoints) {
      if (cp.owner === team) {
        if (cp.buff.type === 'speed') buffs.speed *= cp.buff.value;
        if (cp.buff.type === 'damage') buffs.damage *= cp.buff.value;
        if (cp.buff.type === 'defense') buffs.defense *= cp.buff.value;
      }
    }
    return buffs;
  }

  private getTeamForPlayer(playerId: string): 'player1' | 'player2' {
    return playerId === this.player1Id ? 'player1' : 'player2';
  }

  private findNearest(from: Position, targets: Character[]): Character {
    let nearest = targets[0];
    let minDist = Infinity;
    for (const t of targets) {
      const dist = this.tileDist(from, t.position);
      if (dist < minDist) { minDist = dist; nearest = t; }
    }
    return nearest;
  }

  private getEffectiveRange(char: Character): number {
    let range = char.stats.range;
    if (range >= 2 && this.gameMap.tiles[char.position.y]?.[char.position.x] === 'hill') {
      range += 1;
    }
    return range;
  }

  private isConcealed(char: Character): boolean {
    const tile = this.gameMap.tiles[char.position.y]?.[char.position.x];
    if (tile !== 'bush') return false;
    return !Array.from(this.charData.values()).some(e =>
      e.owner !== char.owner && !e.isDead &&
      Math.abs(e.position.x - char.position.x) + Math.abs(e.position.y - char.position.y) <= 1
    );
  }

  private getHpLeader(): string {
    let p1Hp = 0, p2Hp = 0;
    this.charData.forEach(c => {
      const team = this.getTeamForPlayer(c.owner);
      if (team === 'player1') p1Hp += c.currentHp;
      else p2Hp += c.currentHp;
    });
    return p1Hp >= p2Hp ? this.player1Id : this.player2Id;
  }

  private getMyGold(playerId: string): number {
    const team = this.getTeamForPlayer(playerId);
    return this.economy[team].gold;
  }

  private spendGold(playerId: string, amount: number): boolean {
    const team = this.getTeamForPlayer(playerId);
    const econ = this.economy[team];
    if (econ.gold < amount) return false;
    econ.gold -= amount;
    return true;
  }
}
