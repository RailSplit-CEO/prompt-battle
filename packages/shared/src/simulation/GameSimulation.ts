// ─── GameSimulation.ts ─────────────────────────────────────────
// Main orchestrator class. Holds all game state, runs the tick
// loop including movement and combat. Server-authoritative.
// ────────────────────────────────────────────────────────────────

import type {
  SimState,
  SimUnit,
  SimCamp,
  SimNexus,
  SimGroundItem,
  SimTower,
  SimArmory,
  SimMineNode,
  MapEvent,
  MapEventType,
  ResourceType,
  EquipmentType,
  BehaviorMods,
  HWorkflow,
  WorkflowStep,
  HordeCommand,
  PendingHit,
  CampDef,
} from './SimTypes';

import type { MapDef } from '../data/maps';

import { DEFAULT_MODS } from './SimTypes';

import {
  ANIMALS,
  SPAWN_COSTS,
  SUPPLY_COST,
  NEXUS_MAX_HP,
  MAX_SUPPLY,
  UPKEEP_THRESHOLDS,
  WORLD_W,
  WORLD_H,
  P1_BASE,
  P2_BASE,
  TOWER_HP,
  TOWER_DAMAGE,
  TOWER_RANGE,
  TOWER_SPLASH,
  TOWER_COOLDOWN,
  TOWER_PROJ_SPEED,
  EQUIP_LEVEL_STAT_MULT,
  GOLDEN_ANGLE,
  WILD_ANIMAL_COUNT,
  ELITE_PREY_COUNT,
  pdist2,
  PATH_CELL,
  PATH_GRID,
  MAX_PATHS_PER_FRAME,
  ROCK_RADIUS,
  ROCK_PATH_RADIUS,
  NIGHT_BUILDING_SAFE_RANGE,
  CAMP_GUARD_COUNT,
  CAMP_SPAWN_MS,
  seededRandom,
  cap,
  pickCampName,
} from './Constants';

import { TILE_SIZE, assignAnimalsToSlots } from '../data/maps';

import * as DayNight from './DayNight';
import * as CampLogic from './CampLogic';
import * as UnitAI from './UnitAI';
import * as MapEvents from './MapEvents';
import * as BotAI from './BotAI';
import * as Movement from './Movement';
import * as Combat from './Combat';
import { buildSpatialGrid, getNearbyFromGrid } from './SpatialGrid';
import type { PathRequest } from './Movement';
import type { MovementContext } from './Movement';
import type { CombatContext, DropItemRequest } from './Combat';

// ────────────────────────────────────────────────────────────────

export class GameSimulation implements SimState {
  // ─── Core State ─────────────────────────────────────────────
  units: SimUnit[] = [];
  camps: SimCamp[] = [];
  nexuses: SimNexus[] = [];
  groundItems: SimGroundItem[] = [];
  towers: SimTower[] = [];
  armories: SimArmory[] = [];
  mineNodes: SimMineNode[] = [];
  mapEvents: MapEvent[] = [];
  pendingHits: PendingHit[] = [];
  eventBuffs: { team: 1 | 2; stat: string; value: number; timer: number }[] = [];
  teamBuffs: { team: 1 | 2; stat: 'speed' | 'attack' | 'supply'; amount: number; remaining: number }[] = [];

  // ─── IDs ────────────────────────────────────────────────────
  nextId = 1;
  nextItemId = 1;
  nextEventId = 1;

  // ─── Timers ─────────────────────────────────────────────────
  gameTime = 0;
  lastDeltaMs = 0;
  freeGnomeTimer = 0;
  freeSnakeTimer = 0;
  carrotSpawnTimer = 0;
  aiTimer = 0;
  eventCycleTimer = 0;
  eventCycleCount = 0;
  dayNightTimer = 0;

  // ─── Day/Night ──────────────────────────────────────────────
  isNight = false;
  nightCount = 0;
  isBloodMoon = false;
  duskWarned = false;
  shadowBeasts: number[] = [];

  // ─── Era / Win ──────────────────────────────────────────────
  currentEra = 1;
  gameOver = false;
  winner: 1 | 2 | null = null;
  eliteKillCount = 0;
  gameStartBannerShown = false;

  // ─── Economy ────────────────────────────────────────────────
  baseStockpile: Record<1 | 2, Record<ResourceType, number>> = {
    1: { carrot: 0, meat: 0, crystal: 0, metal: 0 },
    2: { carrot: 0, meat: 0, crystal: 0, metal: 0 },
  };
  unlockedEquipment: Record<1 | 2, Map<EquipmentType, number>> = {
    1: new Map(),
    2: new Map(),
  };
  rallyPoints: Record<string, { x: number; y: number }> = {};
  groupWorkflows: Record<string, HWorkflow> = {};
  groupModifiers: Record<string, BehaviorMods> = {};

  // ─── Stats ──────────────────────────────────────────────────
  matchStats = {
    unitsSpawned: { 1: 0, 2: 0 } as Record<1 | 2, number>,
    unitsLost: { 1: 0, 2: 0 } as Record<1 | 2, number>,
    totalKills: { 1: 0, 2: 0 } as Record<1 | 2, number>,
    totalDamage: { 1: 0, 2: 0 } as Record<1 | 2, number>,
    campsCaptured: { 1: 0, 2: 0 } as Record<1 | 2, number>,
    campsLost: { 1: 0, 2: 0 } as Record<1 | 2, number>,
    resourcesDelivered: {
      1: { carrot: 0, meat: 0, crystal: 0, metal: 0 },
      2: { carrot: 0, meat: 0, crystal: 0, metal: 0 },
    } as Record<1 | 2, Record<ResourceType, number>>,
    peakArmySize: { 1: 0, 2: 0 } as Record<1 | 2, number>,
  };

  // ─── Shrine / Sweep / Plan State ────────────────────────────
  shrine: { active: boolean; owner: 0|1|2; captureProgress: { 1: number; 2: number }; trickleTimer: number; x: number; y: number } = { active: false, owner: 0, captureProgress: { 1: 0, 2: 0 }, trickleTimer: 0, x: 1600, y: 1600 };
  bountyCamps: Array<{ campId: string; cleared: boolean; respawnTimer: number }> = [];
  activeSweeps: Record<string, { team: 1|2; subject: string; targets: string[]; currentIdx: number }> = {};
  activePlans: Array<{ team: 1|2; subject: string; phases: any[]; currentPhase: number; completed: boolean }> = [];

  // ─── Map Events ─────────────────────────────────────────────
  lastEventType: string | null = null;
  lastSoloSide: 'left' | 'right' = 'left';

  // ─── Map Definition ─────────────────────────────────────────
  mapDef: MapDef | null;
  isSolo: boolean;
  fogDisabled = true; // server sim has global vision

  // ─── Ground Item Lookup ─────────────────────────────────────
  private _groundItemMap = new Map<number, SimGroundItem>();

  // ─── Tile / Walkability Grid ────────────────────────────────
  private _tiles: number[][] = [];
  private _walkableGrid: Uint8Array | null = null;
  private _walkGridRows = 0;
  private _walkGridCols = 0;
  private _staticBlockedGrid: Uint8Array | null = null;
  private _staticClearancePenalty: Float32Array = new Float32Array(0);
  private _rockCollisionPoints: { x: number; y: number }[] = [];

  // ─── A* Pathfinding Buffers ─────────────────────────────────
  private _astarBlocked: Uint8Array;
  private _astarGScore: Float32Array;
  private _astarFScore: Float32Array;
  private _astarCameFrom: Int32Array;
  private _astarClosed: Uint8Array;
  private _astarInOpen: Uint8Array;
  private _astarOccupied: Uint8Array;
  private _frameOccupiedReady = false;

  // ─── Per-Frame Caches ───────────────────────────────────────
  private _framePathCache = new Map<string, { x: number; y: number }[] | null>();
  private _frameAvoidPenalty = new Map<string, Float32Array>();
  private _avoidPenaltyPool: Float32Array[] = [];
  private _pathQueue: PathRequest[] = [];
  private _pathsThisFrame = 0;

  // ─── Spatial Grid ───────────────────────────────────────────
  private _spatialGrid = new Map<number, SimUnit[]>();
  private _spatialCellSize = 200;
  private _bucketPool: SimUnit[][] = [];

  // ─── Frame State ────────────────────────────────────────────
  private _frameCount = 0;
  private _stuckCheckCounter = 0;
  private _unitById = new Map<number, SimUnit>();
  private _defendedCamps = new Set<string>();

  // ─── Combat Tracking ────────────────────────────────────────
  private _unitKillCounts = new Map<number, number>();
  private _topKiller = {
    1: { type: '', kills: 0 },
    2: { type: '', kills: 0 },
  };

  constructor(mapDef: MapDef | null, mapSeed: number, isSolo: boolean) {
    this.mapDef = mapDef;
    this.isSolo = isSolo;

    // Pre-allocate A* buffers
    const gridSize = PATH_GRID * PATH_GRID;
    this._astarBlocked = new Uint8Array(gridSize);
    this._astarGScore = new Float32Array(gridSize);
    this._astarFScore = new Float32Array(gridSize);
    this._astarCameFrom = new Int32Array(gridSize);
    this._astarClosed = new Uint8Array(gridSize);
    this._astarInOpen = new Uint8Array(gridSize);
    this._astarOccupied = new Uint8Array(gridSize);

    // Create nexuses
    this.nexuses = [
      { team: 1, x: P1_BASE.x, y: P1_BASE.y, hp: NEXUS_MAX_HP, maxHp: NEXUS_MAX_HP, attackTimer: 0 },
      { team: 2, x: P2_BASE.x, y: P2_BASE.y, hp: NEXUS_MAX_HP, maxHp: NEXUS_MAX_HP, attackTimer: 0 },
    ];

    // Initialize map infrastructure
    if (mapDef) {
      this.initMapInfrastructure(mapDef);
      this.initCampsFromMap(mapDef, mapSeed);
    }

    // Pre-capture T1 camps (gnome + snake) for each team
    for (const animalType of ['gnome', 'snake']) {
      const campsOfType = this.camps.filter(c => c.animalType === animalType);
      const p1Camp = campsOfType.slice().sort((a, b) => pdist2(a, P1_BASE) - pdist2(b, P1_BASE))[0];
      const p2Camp = campsOfType.filter(c => c !== p1Camp).sort((a, b) => pdist2(a, P2_BASE) - pdist2(b, P2_BASE))[0];
      if (p1Camp) {
        p1Camp.owner = 1;
        this.units = this.units.filter(u => u.campId !== p1Camp.id);
      }
      if (p2Camp) {
        p2Camp.owner = 2;
        this.units = this.units.filter(u => u.campId !== p2Camp.id);
      }
    }

    // Starting units: 3 gnomes + 2 snakes per team (matches HordeScene)
    for (let i = 0; i < 3; i++) {
      this.spawnUnit('gnome', 1, P1_BASE.x + 50 + i * 20, P1_BASE.y - 50);
      this.spawnUnit('gnome', 2, P2_BASE.x - 50 - i * 20, P2_BASE.y + 50);
    }
    for (let i = 0; i < 2; i++) {
      this.spawnUnit('snake', 1, P1_BASE.x + 30 + i * 20, P1_BASE.y - 80);
      this.spawnUnit('snake', 2, P2_BASE.x - 30 - i * 20, P2_BASE.y + 80);
    }

    // Initialize towers from mapDef
    if (mapDef?.towerSlots) {
      for (const slot of mapDef.towerSlots) {
        this.towers.push({
          id: `tower_1_${this.towers.length}`,
          team: 1,
          x: slot.bluePos.x, y: slot.bluePos.y + 5,
          hp: TOWER_HP, maxHp: TOWER_HP,
          damage: TOWER_DAMAGE,
          range: TOWER_RANGE,
          splashRange: TOWER_SPLASH,
          attackCooldown: TOWER_COOLDOWN,
          attackTimer: 0,
          alive: true,
          projSpeed: TOWER_PROJ_SPEED,
        });
        this.towers.push({
          id: `tower_2_${this.towers.length}`,
          team: 2,
          x: slot.redPos.x, y: slot.redPos.y + 5,
          hp: TOWER_HP, maxHp: TOWER_HP,
          damage: TOWER_DAMAGE,
          range: TOWER_RANGE,
          splashRange: TOWER_SPLASH,
          attackCooldown: TOWER_COOLDOWN,
          attackTimer: 0,
          alive: true,
          projSpeed: TOWER_PROJ_SPEED,
        });
      }
    }

    // Initialize armories from mapDef
    if (mapDef?.armorySlots) {
      const eqTypesList: EquipmentType[] = ['pickaxe', 'sword', 'shield', 'boots', 'banner'];
      for (let i = 0; i < mapDef.armorySlots.length; i++) {
        const slot = mapDef.armorySlots[i];
        const eqType = (slot as any).equipmentType || eqTypesList[i % eqTypesList.length];
        this.armories.push({ x: slot.bluePos.x, y: slot.bluePos.y, team: 1, equipmentType: eqType });
        this.armories.push({ x: slot.redPos.x, y: slot.redPos.y, team: 2, equipmentType: eqType });
      }
    }

    // Initialize mines from mapDef
    if (mapDef?.mineSlots) {
      let mineIdx = 0;
      for (const slot of mapDef.mineSlots) {
        this.mineNodes.push({ id: `mine_${mineIdx++}`, x: slot.bluePos.x, y: slot.bluePos.y });
        this.mineNodes.push({ id: `mine_${mineIdx++}`, x: slot.redPos.x, y: slot.redPos.y });
      }
    }
  }

  // ─── Map Infrastructure Init ──────────────────────────────────

  private initMapInfrastructure(mapDef: MapDef): void {
    const tiles = mapDef.tiles;
    if (tiles && tiles.length > 0) {
      this._tiles = tiles;
      const rows = tiles.length;
      const cols = tiles[0].length;

      // Build walkability grid (TILE_SIZE resolution)
      const walkGrid = new Uint8Array(rows * cols);
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          const v = tiles[r][c];
          if (v === 2 || v === 3) walkGrid[r * cols + c] = 1;
        }
      }

      // Stamp boundary blocks
      const boundaries = mapDef.boundaryBlocks || [];
      for (const b of boundaries) {
        const minC = Math.floor(b.x / TILE_SIZE);
        const maxC = Math.ceil((b.x + b.w) / TILE_SIZE);
        const minR = Math.floor(b.y / TILE_SIZE);
        const maxR = Math.ceil((b.y + b.h) / TILE_SIZE);
        for (let r = minR; r < maxR; r++) {
          for (let c = minC; c < maxC; c++) {
            if (r >= 0 && r < rows && c >= 0 && c < cols) walkGrid[r * cols + c] = 1;
          }
        }
      }

      // Collect rock collision points
      this._rockCollisionPoints = [];
      for (const rock of (mapDef.rockPositions || [])) {
        this._rockCollisionPoints.push({ x: rock.bluePos.x, y: rock.bluePos.y });
        this._rockCollisionPoints.push({ x: rock.redPos.x, y: rock.redPos.y });
      }

      // Stamp rock collision points onto walkability grid
      const walkRockR = ROCK_RADIUS;
      const walkRockTiles = Math.ceil(walkRockR / TILE_SIZE);
      for (const rp of this._rockCollisionPoints) {
        const rc = Math.floor(rp.x / TILE_SIZE);
        const rr = Math.floor(rp.y / TILE_SIZE);
        for (let r = rr - walkRockTiles; r <= rr + walkRockTiles; r++) {
          for (let c = rc - walkRockTiles; c <= rc + walkRockTiles; c++) {
            if (r >= 0 && r < rows && c >= 0 && c < cols) {
              const dx = (c + 0.5) * TILE_SIZE - rp.x;
              const dy = (r + 0.5) * TILE_SIZE - rp.y;
              if (dx * dx + dy * dy <= walkRockR * walkRockR) {
                walkGrid[r * cols + c] = 1;
              }
            }
          }
        }
      }

      this._walkableGrid = walkGrid;
      this._walkGridCols = cols;
      this._walkGridRows = rows;

      // Build static blocked grid (PATH_CELL resolution for A*)
      const G = PATH_GRID;
      const CELL = PATH_CELL;
      const staticBlocked = new Uint8Array(G * G);
      for (let gy = 0; gy < G && gy < rows; gy++) {
        for (let gx = 0; gx < G && gx < cols; gx++) {
          if (tiles[gy][gx] === 2 || tiles[gy][gx] === 3) staticBlocked[gy * G + gx] = 1;
        }
      }
      for (const b of boundaries) {
        const minGX = Math.floor(b.x / CELL);
        const maxGX = Math.ceil((b.x + b.w) / CELL);
        const minGY = Math.floor(b.y / CELL);
        const maxGY = Math.ceil((b.y + b.h) / CELL);
        for (let gy = minGY; gy < maxGY; gy++) {
          for (let gx = minGX; gx < maxGX; gx++) {
            if (gx >= 0 && gx < G && gy >= 0 && gy < G) staticBlocked[gy * G + gx] = 1;
          }
        }
      }
      const rockR = ROCK_PATH_RADIUS;
      const rockCells = Math.ceil(rockR / CELL);
      for (const rp of this._rockCollisionPoints) {
        const rcx = Math.floor(rp.x / CELL);
        const rcy = Math.floor(rp.y / CELL);
        for (let ry = rcy - rockCells; ry <= rcy + rockCells; ry++) {
          for (let rx = rcx - rockCells; rx <= rcx + rockCells; rx++) {
            if (rx >= 0 && rx < G && ry >= 0 && ry < G) {
              const dx = (rx + 0.5) * CELL - rp.x;
              const dy = (ry + 0.5) * CELL - rp.y;
              if (dx * dx + dy * dy <= rockR * rockR) {
                staticBlocked[ry * G + rx] = 1;
              }
            }
          }
        }
      }
      this._staticBlockedGrid = staticBlocked;

      // Build clearance penalty
      const staticClearance = new Float32Array(G * G);
      for (let cy2 = 0; cy2 < G; cy2++) {
        for (let cx2 = 0; cx2 < G; cx2++) {
          const idx = cy2 * G + cx2;
          if (staticBlocked[idx]) continue;
          let pen = 0;
          for (let pdy = -1; pdy <= 1; pdy++) {
            for (let pdx = -1; pdx <= 1; pdx++) {
              if (pdx === 0 && pdy === 0) continue;
              const px = cx2 + pdx, py = cy2 + pdy;
              if (px >= 0 && px < G && py >= 0 && py < G && staticBlocked[py * G + px]) pen += 0.5;
            }
          }
          staticClearance[idx] = pen;
        }
      }
      this._staticClearancePenalty = staticClearance;
    }
  }

  // ─── Camp Initialization ──────────────────────────────────────

  private initCampsFromMap(mapDef: MapDef, seed: number): void {
    const rng = seededRandom(seed);
    const usedNames: Record<string, number> = {};
    const animalAssignments = assignAnimalsToSlots(mapDef.campSlots, rng);

    let idx = 0;
    for (let i = 0; i < mapDef.campSlots.length; i++) {
      const slot = mapDef.campSlots[i];
      const animalType = animalAssignments[i];
      const def = ANIMALS[animalType];
      if (!def) continue;

      const name1 = pickCampName(animalType, rng, usedNames);
      const name2 = pickCampName(animalType, rng, usedNames);
      const guards = CAMP_GUARD_COUNT[animalType] || 1;
      const spawnMs = CAMP_SPAWN_MS[animalType] || 5000;
      const buff1 = { stat: 'attack', value: 0.05 + rng() * 0.05 };
      const buff2 = { stat: 'hp', value: 0.05 + rng() * 0.05 };

      const blueCamp: SimCamp = {
        id: `camp_${idx++}`, name: name1, animalType, tier: def.tier,
        guardCount: guards, x: slot.bluePos.x, y: slot.bluePos.y,
        owner: 0, spawnMs, spawnTimer: 0, buff: buff1, storedFood: 0,
        scouted: false, lastSeenOwner: 0, lastSeenLabel: '', lastSeenColor: '#FFD93D',
      };
      this.camps.push(blueCamp);

      const redCamp: SimCamp = {
        id: `camp_${idx++}`, name: name2, animalType, tier: def.tier,
        guardCount: guards, x: slot.redPos.x, y: slot.redPos.y,
        owner: 0, spawnMs, spawnTimer: 0, buff: buff2, storedFood: 0,
        scouted: false, lastSeenOwner: 0, lastSeenLabel: '', lastSeenColor: '#FFD93D',
      };
      this.camps.push(redCamp);

      // Spawn camp defenders
      if (def.tier <= this.currentEra + 2) {
        this.spawnCampDefenders(blueCamp);
        this.spawnCampDefenders(redCamp);
      }
    }

    // Troll camp
    if (mapDef.trollSlot) {
      const trollDef = ANIMALS['troll'];
      if (trollDef) {
        const trollCamp: SimCamp = {
          id: `camp_${idx++}`, name: 'Troll Camp', animalType: 'troll', tier: trollDef.tier,
          guardCount: CAMP_GUARD_COUNT['troll'] || 1,
          x: mapDef.trollSlot.x, y: mapDef.trollSlot.y,
          owner: 0, spawnMs: CAMP_SPAWN_MS['troll'] || 15000, spawnTimer: 0,
          buff: { stat: 'all', value: 0.10 }, storedFood: 0,
          scouted: false, lastSeenOwner: 0, lastSeenLabel: '', lastSeenColor: '#FFD93D',
        };
        this.camps.push(trollCamp);
        if (trollDef.tier <= this.currentEra + 2) {
          this.spawnCampDefenders(trollCamp);
        }
      }
    }

    // Wild animals and elite prey are now spawned by era progression (Era 2+)
  }

  private spawnCampDefenders(camp: SimCamp): void {
    const def = ANIMALS[camp.animalType];
    if (!def) return;
    for (let i = 0; i < camp.guardCount; i++) {
      const angle = (i / camp.guardCount) * Math.PI * 2;
      const gx = camp.x + Math.cos(angle) * 50;
      const gy = camp.y + Math.sin(angle) * 50;
      const safe = this.findWalkableSpawn(gx, gy);
      const wanderAngle = Math.random() * Math.PI * 2;
      const wanderR = 20 + Math.random() * 40;
      const speedVar = 0.85 + Math.random() * 0.3;
      this.units.push({
        id: this.nextId++, type: camp.animalType, team: 0,
        hp: def.hp, maxHp: def.hp,
        attack: def.attack, speed: def.speed * speedVar,
        x: safe.x, y: safe.y,
        targetX: safe.x + Math.cos(wanderAngle) * wanderR,
        targetY: safe.y + Math.sin(wanderAngle) * wanderR,
        attackTimer: 0, dead: false, animState: 'idle' as const,
        campId: camp.id, lungeX: 0, lungeY: 0,
        gnomeShield: 0, hasRebirth: camp.animalType === 'skull',
        diveReady: false, diveTimer: 0,
        lastAttackTarget: -1, attackFaceX: null,
        prevSpriteX: 0, prevSpriteY: 0,
        pathWaypoints: null, pathAge: 0, pathTargetX: 0, pathTargetY: 0,
        lastCheckX: 0, lastCheckY: 0, stuckFrames: 0, stuckCooldown: 0,
        mods: { ...DEFAULT_MODS },
        carrying: null, loop: null, isElite: false, idleTimer: 0, claimItemId: -1,
        equipment: null, equipLevel: 0, equipVisualApplied: null,
      });
    }
  }

  // ─── SimState Interface Methods ─────────────────────────────

  groundItemById(id: number): SimGroundItem | undefined {
    return this._groundItemMap.get(id);
  }

  isInVision(_x: number, _y: number): boolean {
    return true; // server has global vision
  }

  findWalkableSpawn(x: number, y: number): { x: number; y: number } {
    const cx = Math.max(50, Math.min(WORLD_W - 50, x));
    const cy = Math.max(50, Math.min(WORLD_H - 50, y));
    if (!this._walkableGrid) return { x: cx, y: cy };
    // Check if requested position is walkable
    const col = Math.floor(cx / TILE_SIZE);
    const row = Math.floor(cy / TILE_SIZE);
    if (col >= 0 && col < this._walkGridCols && row >= 0 && row < this._walkGridRows) {
      if (!this._walkableGrid[row * this._walkGridCols + col]) return { x: cx, y: cy };
    }
    // Spiral search for nearest walkable tile
    for (let radius = 1; radius < 20; radius++) {
      for (let dr = -radius; dr <= radius; dr++) {
        for (let dc = -radius; dc <= radius; dc++) {
          if (Math.abs(dr) !== radius && Math.abs(dc) !== radius) continue;
          const r2 = row + dr, c2 = col + dc;
          if (r2 >= 0 && r2 < this._walkGridRows && c2 >= 0 && c2 < this._walkGridCols) {
            if (!this._walkableGrid[r2 * this._walkGridCols + c2]) {
              return { x: (c2 + 0.5) * TILE_SIZE, y: (r2 + 0.5) * TILE_SIZE };
            }
          }
        }
      }
    }
    return { x: cx, y: cy };
  }

  spawnGroundItem(type: ResourceType, x: number, y: number): void {
    const pos = this.findWalkableSpawn(x, y);
    const item: SimGroundItem = {
      id: this.nextItemId++, type,
      x: pos.x, y: pos.y, dead: false, age: 0,
    };
    this.groundItems.push(item);
    this._groundItemMap.set(item.id, item);
  }

  spawnUnit(type: string, team: 1 | 2, x: number, y: number): void {
    CampLogic.spawnUnit(type, team, x, y, this);
  }

  getTeamSupply(team: 1 | 2): number {
    let supply = 0;
    for (let i = 0; i < this.units.length; i++) {
      const u = this.units[i];
      if (u.team === team && !u.dead) supply += (SUPPLY_COST[u.type] || 1);
    }
    return supply;
  }

  getMaxSupply(team: 1 | 2): number {
    let maxCap = MAX_SUPPLY;
    for (const b of this.teamBuffs) {
      if (b.team === team && b.stat === 'supply' && b.remaining > 0) maxCap += b.amount;
    }
    return maxCap;
  }

  getSupplyCost(type: string): number {
    return SUPPLY_COST[type] || 1;
  }

  getUpkeepRate(team: 1 | 2): number {
    const supply = this.getTeamSupply(team);
    let rate = 1.0;
    for (const t of UPKEEP_THRESHOLDS) {
      if (supply >= t.supply) rate = t.rate;
    }
    return rate;
  }

  getBuffs(team: 1 | 2): { speed: number; attack: number; hp: number } {
    let speed = 0, attack = 0, hp = 0;
    for (const c of this.camps) {
      if (c.owner !== team) continue;
      const s = c.buff.stat;
      if (s === 'speed') speed += c.buff.value;
      else if (s === 'attack') attack += c.buff.value;
      else if (s === 'hp') hp += c.buff.value;
      else if (s === 'all') { speed += c.buff.value; attack += c.buff.value; hp += c.buff.value; }
    }
    for (const b of this.eventBuffs) {
      if (b.team !== team) continue;
      if (b.stat === 'attack') attack += b.value;
      if (b.stat === 'speed') speed += b.value;
    }
    for (const b of this.teamBuffs) {
      if (b.team !== team) continue;
      if (b.stat === 'speed') speed += b.amount;
      else if (b.stat === 'attack') attack += b.amount;
    }
    return { speed, attack, hp };
  }

  getUnitEquipBuffs(u: SimUnit): { speed: number; attack: number; hp: number; damageTaken: number; atkSpeedMult: number; pickupRange: number; gatherSpeed: number } {
    let speed = 0, attack = 0, hp = 0, damageTaken = 1, atkSpeedMult = 1, pickupRange = 1, gatherSpeed = 1;
    if (!u.equipment || u.equipLevel <= 0) {
      return { speed, attack, hp, damageTaken, atkSpeedMult, pickupRange, gatherSpeed };
    }
    const lm = EQUIP_LEVEL_STAT_MULT[u.equipLevel] || 1;
    switch (u.equipment) {
      case 'pickaxe': gatherSpeed = 1 + 0.25 * lm; break;
      case 'sword': attack = 0.50 * lm; atkSpeedMult = 1 - 0.25 * lm; break;
      case 'shield': hp = 0.60 * lm; damageTaken = 1 - 0.25 * lm; speed = -0.15; break;
      case 'boots': speed = 0.60 * lm; pickupRange = 1 + 0.5 * lm; break;
      case 'banner': break;
    }
    return { speed, attack, hp, damageTaken, atkSpeedMult, pickupRange, gatherSpeed };
  }

  getEquipLevel(team: 1 | 2, eqType: EquipmentType): number {
    return this.unlockedEquipment[team].get(eqType) || 0;
  }

  unlockEquipment(team: 1 | 2, eqType: EquipmentType): boolean {
    return CampLogic.unlockEquipment(team, eqType, this);
  }

  isCampActive(camp: SimCamp): boolean {
    return CampLogic.isCampActive(camp, this);
  }

  spawnWildAnimals(types: string[], count: number): void {
    for (let i = 0; i < count; i++) {
      const type = types[Math.floor(Math.random() * types.length)];
      const def = ANIMALS[type];
      if (!def) continue;
      let x: number, y: number;
      let tries = 0;
      do {
        x = 100 + Math.random() * (WORLD_W - 200);
        y = 100 + Math.random() * (WORLD_H - 200);
        tries++;
      } while (tries < 30 && (
        Math.sqrt((x - P1_BASE.x) ** 2 + (y - P1_BASE.y) ** 2) < 500 ||
        Math.sqrt((x - P2_BASE.x) ** 2 + (y - P2_BASE.y) ** 2) < 500
      ));
      const safe = this.findWalkableSpawn(x, y);
      this.units.push({
        id: this.nextId++, type, team: 0,
        hp: def.hp, maxHp: def.hp,
        attack: def.attack, speed: def.speed * 0.4,
        x: safe.x, y: safe.y,
        targetX: safe.x + Math.random() * 100 - 50,
        targetY: safe.y + Math.random() * 100 - 50,
        attackTimer: 0, dead: false, animState: 'idle' as const,
        campId: null, lungeX: 0, lungeY: 0,
        gnomeShield: 0, hasRebirth: type === 'skull',
        diveReady: false, diveTimer: 0,
        lastAttackTarget: -1, attackFaceX: null,
        prevSpriteX: 0, prevSpriteY: 0,
        pathWaypoints: null, pathAge: 0, pathTargetX: 0, pathTargetY: 0,
        lastCheckX: 0, lastCheckY: 0, stuckFrames: 0, stuckCooldown: 0,
        mods: { ...DEFAULT_MODS },
        carrying: null, loop: null, isElite: false, idleTimer: 0, claimItemId: -1,
        equipment: null, equipLevel: 0, equipVisualApplied: null,
      });
    }
  }

  spawnElitePreyBatch(): void {
    for (let i = 0; i < ELITE_PREY_COUNT; i++) {
      let x: number, y: number;
      let tries = 0;
      do {
        x = 1000 + Math.random() * (WORLD_W - 2000);
        y = 1000 + Math.random() * (WORLD_H - 2000);
        tries++;
      } while (tries < 30 && (
        Math.sqrt((x - P1_BASE.x) ** 2 + (y - P1_BASE.y) ** 2) < 800 ||
        Math.sqrt((x - P2_BASE.x) ** 2 + (y - P2_BASE.y) ** 2) < 800
      ));
      const safe = this.findWalkableSpawn(x, y);
      this.units.push({
        id: this.nextId++, type: 'minotaur', team: 0,
        hp: 2000, maxHp: 2000,
        attack: 150, speed: 90,
        x: safe.x, y: safe.y,
        targetX: safe.x, targetY: safe.y,
        attackTimer: 0, dead: false, animState: 'idle' as const,
        campId: null, lungeX: 0, lungeY: 0,
        gnomeShield: 0, hasRebirth: false, diveReady: false, diveTimer: 0,
        lastAttackTarget: -1, attackFaceX: null,
        prevSpriteX: 0, prevSpriteY: 0,
        pathWaypoints: null, pathAge: 0, pathTargetX: 0, pathTargetY: 0,
        lastCheckX: 0, lastCheckY: 0, stuckFrames: 0, stuckCooldown: 0,
        mods: { ...DEFAULT_MODS },
        carrying: null, loop: null, isElite: true, idleTimer: 0, claimItemId: -1,
        equipment: null, equipLevel: 0, equipVisualApplied: null,
      });
    }
  }

  // ─── Callback Helpers ─────────────────────────────────────────

  private isNonCombatStep(u: SimUnit): boolean {
    if (!u.loop) return true;
    const step = u.loop.steps[u.loop.currentStep];
    if (!step) return true;
    return step.action !== 'attack_camp'
      && step.action !== 'attack_enemies'
      && step.action !== 'hunt'
      && step.action !== 'kill_only'
      && step.action !== 'defend';
  }

  private isNearFriendlyBuilding(u: { x: number; y: number; team: 0 | 1 | 2 }): boolean {
    if (u.team === 0) return false;
    const range2 = NIGHT_BUILDING_SAFE_RANGE * NIGHT_BUILDING_SAFE_RANGE;
    const base = u.team === 1 ? P1_BASE : P2_BASE;
    if (pdist2(u, base) < range2) return true;
    for (const c of this.camps) {
      if (c.owner === u.team && pdist2(u, c) < range2) return true;
    }
    for (const tw of this.towers) {
      if (tw.alive && tw.team === u.team && pdist2(u, tw) < range2) return true;
    }
    for (const a of this.armories) {
      if (a.team === u.team && pdist2(u, a) < range2) return true;
    }
    return false;
  }

  private getBannerAura(u: SimUnit): { attack: number; speed: number } {
    if (u.team === 0) return { attack: 0, speed: 0 };
    const BANNER_RANGE = 120;
    const nearby = getNearbyFromGrid(this._spatialGrid, u.x, u.y, BANNER_RANGE, this._spatialCellSize);
    for (const ally of nearby) {
      if (ally === u || ally.team !== u.team || ally.equipment !== 'banner') continue;
      const lm = EQUIP_LEVEL_STAT_MULT[ally.equipLevel] || 1;
      return { attack: 0.20 * lm, speed: 0.15 * lm };
    }
    return { attack: 0, speed: 0 };
  }

  private getBootstrapAnimal(wf: { steps: { action: string; targetAnimal?: string }[] }): string | undefined {
    for (const s of wf.steps) {
      if (s.action === 'attack_camp' && s.targetAnimal) return s.targetAnimal;
    }
    return undefined;
  }

  private getNearbyUnits(x: number, y: number, radius: number): SimUnit[] {
    return getNearbyFromGrid(this._spatialGrid, x, y, radius, this._spatialCellSize);
  }

  private getElevation(x: number, y: number): number {
    if (!this._tiles || this._tiles.length === 0) return 0;
    const row = Math.floor(y / TILE_SIZE);
    const col = Math.floor(x / TILE_SIZE);
    if (row >= 0 && row < this._tiles.length && col >= 0 && col < this._tiles[0].length) {
      return this._tiles[row][col] === 1 ? 1 : 0;
    }
    return 0;
  }

  // ─── Movement Context Builder ─────────────────────────────────

  private buildMovementContext(dt: number): MovementContext {
    return {
      units: this.units,
      tiles: this._tiles.length > 0 ? this._tiles : null as any,
      walkableGrid: this._walkableGrid,
      walkGridRows: this._walkGridRows,
      walkGridCols: this._walkGridCols,
      staticBlockedGrid: this._staticBlockedGrid,
      isNight: this.isNight,
      frameCount: this._frameCount,
      stuckCheckCounter: this._stuckCheckCounter,
      camps: this.camps,
      defendedCamps: this._defendedCamps,
      spatialGrid: this._spatialGrid,
      spatialCellSize: this._spatialCellSize,
      framePathCache: this._framePathCache,
      pathsThisFrame: this._pathsThisFrame,
      pathQueue: this._pathQueue,
      astarBlocked: this._astarBlocked,
      astarGScore: this._astarGScore,
      astarFScore: this._astarFScore,
      astarCameFrom: this._astarCameFrom,
      astarClosed: this._astarClosed,
      astarInOpen: this._astarInOpen,
      astarOccupied: this._astarOccupied,
      frameOccupiedReady: this._frameOccupiedReady,
      frameAvoidPenalty: this._frameAvoidPenalty,
      avoidPenaltyPool: this._avoidPenaltyPool,
      staticClearancePenalty: this._staticClearancePenalty,
      getUnitEquipBuffs: (u) => this.getUnitEquipBuffs(u),
      getBannerAura: (u) => this.getBannerAura(u),
      getBuffs: (team) => this.getBuffs(team),
      isNearFriendlyBuilding: (u) => this.isNearFriendlyBuilding(u),
      isNonCombatStep: (u) => this.isNonCombatStep(u),
      getBootstrapAnimal: (wf) => this.getBootstrapAnimal(wf as any),
      getNearbyUnits: (x, y, r) => this.getNearbyUnits(x, y, r),
      p1Base: P1_BASE,
      p2Base: P2_BASE,
    };
  }

  // ─── Combat Context Builder ───────────────────────────────────

  private buildCombatContext(): CombatContext {
    const enemyNexus: { [team: number]: SimNexus | null } = {};
    for (const n of this.nexuses) {
      // For team 1, enemy nexus is team 2's, and vice versa
      enemyNexus[n.team === 1 ? 2 : 1] = enemyNexus[n.team === 1 ? 2 : 1] || null;
    }
    // Properly set: team 1's enemy is team 2's nexus, team 2's enemy is team 1's nexus
    enemyNexus[1] = this.nexuses.find(n => n.team === 2) || null;
    enemyNexus[2] = this.nexuses.find(n => n.team === 1) || null;

    return {
      units: this.units,
      unitById: this._unitById,
      camps: this.camps,
      nexuses: this.nexuses,
      towers: this.towers,
      pendingHits: this.pendingHits,
      isNight: this.isNight,
      getUnitEquipBuffs: (u) => this.getUnitEquipBuffs(u),
      getBannerAura: (u) => this.getBannerAura(u),
      getBuffs: (team) => this.getBuffs(team),
      isNearFriendlyBuilding: (u) => this.isNearFriendlyBuilding(u),
      isNonCombatStep: (u) => this.isNonCombatStep(u),
      getNearbyUnits: (x, y, r) => this.getNearbyUnits(x, y, r),
      getElevation: (x, y) => this.getElevation(x, y),
      enemyNexus,
      p1Base: P1_BASE,
      p2Base: P2_BASE,
      matchStats: this.matchStats,
      unitKillCounts: this._unitKillCounts,
      topKiller: this._topKiller,
      eliteKillCount: this.eliteKillCount,
    };
  }

  // ─── Main Tick ──────────────────────────────────────────────

  tick(deltaMs: number): void {
    if (this.gameOver) return;
    this.lastDeltaMs = deltaMs;
    const dt = deltaMs / 1000;
    this.gameTime += deltaMs;
    this._frameCount++;

    // Rebuild ground item lookup
    this._groundItemMap.clear();
    for (const i of this.groundItems) {
      if (!i.dead) this._groundItemMap.set(i.id, i);
    }

    // Rebuild spatial grid
    this._spatialGrid = buildSpatialGrid(this.units, this._spatialCellSize, this._spatialGrid, this._bucketPool);

    // Rebuild unit-by-id map
    this._unitById.clear();
    for (const u of this.units) if (!u.dead) this._unitById.set(u.id, u);

    // Build defended camps set
    this._defendedCamps.clear();
    for (const u of this.units) if (!u.dead && u.team === 0 && u.campId) this._defendedCamps.add(u.campId);

    // Clear per-frame caches
    this._framePathCache.clear();
    for (const arr of this._frameAvoidPenalty.values()) this._avoidPenaltyPool.push(arr);
    this._frameAvoidPenalty.clear();
    this._frameOccupiedReady = false;
    this._pathsThisFrame = 0;
    this._pathQueue.length = 0;

    // Tick down camp loot buffs
    for (let i = this.teamBuffs.length - 1; i >= 0; i--) {
      this.teamBuffs[i].remaining -= deltaMs;
      if (this.teamBuffs[i].remaining <= 0) this.teamBuffs.splice(i, 1);
    }

    // Day/night cycle
    DayNight.updateDayNight(deltaMs, this);

    // Free gnome spawning
    CampLogic.updateFreeGnomes(deltaMs, this);

    // Carrot spawning
    UnitAI.updateCarrotSpawning(deltaMs, this);

    // Workflow engine
    UnitAI.updateWorkflows(this);

    // Resource pickup & delivery
    UnitAI.updateResourcePickup(this);
    UnitAI.updateDeliveries(this);

    // Movement
    const movCtx = this.buildMovementContext(dt);
    const movResult = Movement.updateMovement(dt, movCtx);
    this._stuckCheckCounter = movResult.stuckCheckCounter;
    this._pathsThisFrame = movResult.pathsThisFrame;
    this._frameOccupiedReady = movResult.frameOccupiedReady;

    // Drain path queue
    while (this._pathQueue.length > 0 && this._pathsThisFrame < MAX_PATHS_PER_FRAME) {
      const req = this._pathQueue.shift()!;
      req.callback(null); // simplified: deferred paths get null (unit will retry next tick)
    }

    // Combat (every 2nd frame, 2x delta — matching client pattern)
    if (this._frameCount % 2 === 0) {
      const combatCtx = this.buildCombatContext();
      const combatResult = Combat.updateCombat(deltaMs * 2, combatCtx);
      for (const drop of combatResult.drops) {
        this.spawnGroundItem(drop.type as ResourceType, drop.x, drop.y);
      }
      // Merge new pending hits
      for (const hit of combatResult.newPendingHits) {
        this.pendingHits.push(hit as any);
      }
      // Process pending hits
      const hitResult = Combat.processPendingHits(deltaMs * 2, combatCtx);
      for (const drop of hitResult.drops) {
        this.spawnGroundItem(drop.type as ResourceType, drop.x, drop.y);
      }
      this.eliteKillCount = combatCtx.eliteKillCount;
    }

    // Nexus & tower combat
    CampLogic.updateNexusCombat(deltaMs, this);
    CampLogic.updateTowers(deltaMs, this);

    // Camp capture
    CampLogic.updateCampCapture(this);

    // Era progression
    CampLogic.updateEraProgression(this);

    // Map events
    MapEvents.updateMapEvents(deltaMs, this);

    // Shrine capture & trickle
    this.updateShrine(deltaMs);

    // Free snake spawning
    CampLogic.updateFreeSnakes(deltaMs, this);

    // Sweep tracking
    this.updateSweeps();

    // Advanced plan tracking
    this.updateAdvancedPlans();

    // AI (solo mode only)
    if (this.isSolo) BotAI.updateAI(deltaMs, this);

    // Win check
    CampLogic.checkWin(this);

    // Ground item aging/despawn
    UnitAI.updateGroundItems(deltaMs, this);

    // Cleanup dead
    this.cleanupDead();
  }

  // ─── Process Player Commands ────────────────────────────────

  processCommand(team: 1 | 2, orders: any[]): void {
    for (const order of orders) {
      const parsed = order.order?.parsed || order.parsed;
      const selectedHoard = order.order?.selectedHoard || order.selectedHoard || 'all';
      if (!parsed || !Array.isArray(parsed)) continue;
      for (const cmd of parsed) {
        this.executeCommand(cmd as HordeCommand, team, selectedHoard);
      }
    }
  }

  private executeCommand(cmd: HordeCommand, team: 1 | 2, subject: string): void {
    const base = team === 1 ? P1_BASE : P2_BASE;
    let tx = 0, ty = 0, found = false;

    // ─── Apply behavior modifiers (sticky) ───────────────────
    if (cmd.modifiers) {
      this.applyModifiers(cmd.modifiers, subject, team);
    }

    // Modifier-only command: update modifiers but keep existing workflow
    if (cmd.modifierOnly) {
      return;
    }

    // ─── Resolve target position ─────────────────────────────
    if (cmd.targetType === 'nexus') {
      const n = this.nexuses.find(n2 => n2.team !== team);
      if (n) { tx = n.x; ty = n.y; found = true; }

    } else if (cmd.targetType === 'base' || cmd.targetType === 'defend' || cmd.targetType === 'retreat') {
      tx = base.x; ty = base.y; found = true;

    } else if (cmd.targetType === 'camp') {
      if (cmd.campIndex != null && cmd.campIndex >= 0 && cmd.campIndex < this.camps.length) {
        const c = this.camps[cmd.campIndex];
        tx = c.x; ty = c.y; found = true;
      }
      if (!found && cmd.targetAnimal) {
        const cs = this.camps.filter(c => c.animalType === cmd.targetAnimal && c.owner !== team)
          .sort((a, b) => pdist2(a, base) - pdist2(b, base));
        if (cs.length > 0) { tx = cs[0].x; ty = cs[0].y; found = true; }
      }

    } else if (cmd.targetType === 'nearest_camp') {
      const result = this.findNearestCamp(team, cmd.targetAnimal, cmd.qualifier, subject);
      if (result) { tx = result.x; ty = result.y; found = true; }

    } else if (cmd.targetType === 'sweep_camps') {
      let targets = this.camps.filter(c => c.owner !== team);
      if (cmd.targetAnimal) targets = targets.filter(c => c.animalType === cmd.targetAnimal);
      targets.sort((a, b) => pdist2(a, base) - pdist2(b, base));

      if (targets.length > 0) {
        const steps: WorkflowStep[] = [];
        for (const t of targets) {
          const campIdx = this.camps.indexOf(t);
          steps.push({ action: 'attack_camp', campIndex: campIdx, targetAnimal: t.animalType });
        }
        const workflow: HWorkflow = {
          steps,
          currentStep: 0,
          label: cmd.narration || `Sweeping ${cmd.targetAnimal || 'all'}!`,
          loopFrom: 0,
          playedOnce: false,
          voiceCommand: '',
        };
        this.assignWorkflow(workflow, subject, team);
        return;
      }

    } else if (cmd.targetType === 'workflow' && cmd.workflow && cmd.workflow.length > 0) {
      const steps: WorkflowStep[] = this.parseWorkflowSteps(cmd.workflow);
      if (steps.length === 0) return;
      if (steps.length > 7) steps.length = 7;

      let rawLoopFrom = cmd.loopFrom ?? 0;
      const hasAttackCamp = steps.some(s => s.action === 'attack_camp');
      const deliversToCamp = steps.some(s => s.action === 'deliver' && 'target' in s && (s as { target: string }).target.includes('_camp'));
      if (hasAttackCamp && deliversToCamp) rawLoopFrom = 0;

      const workflow: HWorkflow = {
        steps,
        currentStep: 0,
        label: cmd.narration || 'Custom workflow',
        loopFrom: Math.max(0, Math.min(rawLoopFrom, steps.length - 1)),
        playedOnce: false,
        voiceCommand: '',
      };
      this.assignWorkflow(workflow, subject, team);
      return;

    } else if (cmd.targetType === 'position') {
      if (cmd.workflow && cmd.workflow.length > 0 && cmd.workflow[0].x != null && cmd.workflow[0].y != null) {
        tx = cmd.workflow[0].x;
        ty = cmd.workflow[0].y;
      } else {
        tx = WORLD_W / 2;
        ty = WORLD_H / 2;
      }
      found = true;

    } else if (cmd.targetType === 'advanced_plan') {
      if ((cmd as any).plan) {
        this.activePlans.push({
          team, subject,
          phases: (cmd as any).plan.phases || [],
          currentPhase: 0,
          completed: false,
        });
      }
      return;

    } else if (cmd.targetType === 'query') {
      return;
    }

    if (!found) return;

    // ─── Build workflow steps for simple target types ─────────
    let steps: WorkflowStep[];
    if (cmd.targetType === 'nexus') {
      steps = [{ action: 'attack_enemies' as const }];
    } else if (cmd.targetType === 'camp' || cmd.targetType === 'nearest_camp') {
      steps = [{ action: 'attack_camp' as const, targetAnimal: cmd.targetAnimal, qualifier: cmd.qualifier || 'nearest' }];
    } else if (cmd.targetType === 'defend') {
      steps = [{ action: 'defend' as const, target: 'base' }];
    } else if (cmd.targetType === 'retreat' || cmd.targetType === 'base') {
      steps = [{ action: 'move' as const, x: base.x, y: base.y }];
    } else {
      steps = [{ action: 'move' as const, x: tx, y: ty }];
    }

    const workflow: HWorkflow = {
      steps,
      currentStep: 0,
      label: cmd.narration || '',
      loopFrom: 0,
      playedOnce: false,
      voiceCommand: '',
    };
    this.assignWorkflow(workflow, subject, team);
  }

  private parseWorkflowSteps(rawSteps: { action: string; resourceType?: string; target?: string; targetType?: string; campIndex?: number; qualifier?: string; targetAnimal?: string; x?: number; y?: number; equipmentType?: string }[]): WorkflowStep[] {
    return rawSteps.map(s => {
      switch (s.action) {
        case 'seek_resource':
          return { action: 'seek_resource' as const, resourceType: (s.resourceType || 'carrot') as ResourceType };
        case 'deliver':
          return { action: 'deliver' as const, target: s.target || 'base' };
        case 'hunt':
          return { action: 'hunt' as const, targetType: s.targetType };
        case 'attack_camp':
          return { action: 'attack_camp' as const, campIndex: s.campIndex, qualifier: s.qualifier, targetAnimal: s.targetAnimal };
        case 'move':
          return { action: 'move' as const, x: s.x || WORLD_W / 2, y: s.y || WORLD_H / 2 };
        case 'defend':
          return { action: 'defend' as const, target: s.target || 'base' };
        case 'attack_enemies':
          return { action: 'attack_enemies' as const };
        case 'scout':
          return { action: 'scout' as const, x: s.x, y: s.y };
        case 'collect':
          return { action: 'collect' as const, resourceType: (s.resourceType || 'meat') as ResourceType };
        case 'kill_only':
          return { action: 'kill_only' as const, targetType: s.targetType };
        case 'mine':
          return { action: 'mine' as const };
        case 'equip':
          return { action: 'equip' as const, equipmentType: (s.equipmentType || 'pickaxe') as EquipmentType };
        case 'contest_event':
          return { action: 'contest_event' as const };
        case 'withdraw_base':
          return { action: 'withdraw_base' as const, resourceType: (s.resourceType || 'carrot') as ResourceType };
        case 'upgrade':
          return { action: 'upgrade' as const, equipmentType: (s.equipmentType || 'pickaxe') as EquipmentType };
        default:
          return null;
      }
    }).filter((s): s is WorkflowStep => s !== null);
  }

  private assignWorkflow(workflow: HWorkflow, subject: string, team: 1 | 2): void {
    const sel = this.units.filter(u => u.team === team && !u.dead &&
      (subject === 'all' || u.type === subject));
    if (sel.length === 0) return;

    for (const u of sel) {
      u.loop = { ...workflow, currentStep: 0 };
      u.targetX = u.x;
      u.targetY = u.y;
      u.pathWaypoints = null;
      u.claimItemId = -1;
      const gm = this.groupModifiers[`${u.type}_${team}`];
      if (gm) u.mods = { ...gm };
    }

    if (subject === 'all') {
      const types = new Set(sel.map(u => u.type));
      for (const t of types) this.groupWorkflows[`${t}_${team}`] = workflow;
    } else {
      this.groupWorkflows[`${subject}_${team}`] = workflow;
    }
  }

  private applyModifiers(mods: { formation?: string | null; caution?: string | null; pacing?: string | null }, subject: string, team: 1 | 2): void {
    const sel = this.units.filter(u => u.team === team && !u.dead && (subject === 'all' || u.type === subject));
    const types = subject === 'all' ? new Set(sel.map(u => u.type)) : new Set([subject]);

    for (const type of types) {
      const key = `${type}_${team}`;
      if (!this.groupModifiers[key]) this.groupModifiers[key] = { ...DEFAULT_MODS };
      const gm = this.groupModifiers[key];
      if (mods.formation !== undefined) gm.formation = (mods.formation as BehaviorMods['formation']) || 'normal';
      if (mods.caution !== undefined) gm.caution = (mods.caution as BehaviorMods['caution']) || 'normal';
      if (mods.pacing !== undefined) gm.pacing = (mods.pacing as BehaviorMods['pacing']) || 'normal';
    }

    for (const u of sel) {
      const key = `${u.type}_${team}`;
      const gm = this.groupModifiers[key] || DEFAULT_MODS;
      u.mods = { ...gm };
    }
  }

  // ─── Shrine Capture & Trickle ──────────────────────────────────

  private updateShrine(deltaMs: number): void {
    const SHRINE_ACTIVATE_TIME = 90000; // 1.5 min
    const CAPTURE_RATE = 0.001;
    const DECAY_RATE = 0.0005;
    const TRICKLE_INTERVAL = 10000;
    const TRICKLE_AMOUNT = 1;
    const CAPTURE_THRESHOLD = 1.0;

    if (!this.shrine.active && this.gameTime >= SHRINE_ACTIVATE_TIME) {
      this.shrine.active = true;
    }
    if (!this.shrine.active) return;

    // Count nearby units per team
    const nearby = getNearbyFromGrid(this._spatialGrid, this.shrine.x, this.shrine.y, 200, this._spatialCellSize);
    let count1 = 0, count2 = 0;
    for (const u of nearby) {
      if (u.dead || u.team === 0) continue;
      if (u.team === 1) count1++;
      else if (u.team === 2) count2++;
    }

    // Update capture progress
    for (const team of [1, 2] as const) {
      const myCount = team === 1 ? count1 : count2;
      const enemyCount = team === 1 ? count2 : count1;
      if (myCount > 0 && enemyCount === 0) {
        this.shrine.captureProgress[team] = Math.min(CAPTURE_THRESHOLD, this.shrine.captureProgress[team] + CAPTURE_RATE * deltaMs);
      } else if (myCount === 0) {
        this.shrine.captureProgress[team] = Math.max(0, this.shrine.captureProgress[team] - DECAY_RATE * deltaMs);
      }

      if (this.shrine.captureProgress[team] >= CAPTURE_THRESHOLD && this.shrine.owner !== team) {
        this.shrine.owner = team;
        this.shrine.captureProgress[team === 1 ? 2 : 1] = 0;
      }
    }

    // Trickle resources to owner
    if (this.shrine.owner !== 0) {
      this.shrine.trickleTimer += deltaMs;
      if (this.shrine.trickleTimer >= TRICKLE_INTERVAL) {
        this.shrine.trickleTimer -= TRICKLE_INTERVAL;
        const team = this.shrine.owner as 1 | 2;
        this.baseStockpile[team].crystal = (this.baseStockpile[team].crystal || 0) + TRICKLE_AMOUNT;
        this.baseStockpile[team].metal = (this.baseStockpile[team].metal || 0) + TRICKLE_AMOUNT;
      }
    }
  }

  // ─── Sweep Tracking ────────────────────────────────────────────

  private updateSweeps(): void {
    for (const [key, sweep] of Object.entries(this.activeSweeps)) {
      if (sweep.currentIdx >= sweep.targets.length) {
        delete this.activeSweeps[key];
        continue;
      }
      const targetCampId = sweep.targets[sweep.currentIdx];
      const camp = this.camps.find(c => c.id === targetCampId);
      if (camp && camp.owner === sweep.team) {
        // Camp already captured, advance to next
        sweep.currentIdx++;
        if (sweep.currentIdx < sweep.targets.length) {
          // Assign workflow to go to next camp
          const nextCamp = this.camps.find(c => c.id === sweep.targets[sweep.currentIdx]);
          if (nextCamp) {
            const campIdx = this.camps.indexOf(nextCamp);
            this.assignWorkflow(
              { steps: [{ action: 'attack_camp', campIndex: campIdx, targetAnimal: nextCamp.animalType }], currentStep: 0, label: 'Sweep', loopFrom: 0, playedOnce: false, voiceCommand: '' },
              sweep.subject, sweep.team,
            );
          }
        }
      }
    }
  }

  // ─── Advanced Plan Tracking ────────────────────────────────────

  private updateAdvancedPlans(): void {
    for (let i = this.activePlans.length - 1; i >= 0; i--) {
      const plan = this.activePlans[i];
      if (plan.completed) { this.activePlans.splice(i, 1); continue; }

      const phase = plan.phases[plan.currentPhase];
      if (!phase) { plan.completed = true; continue; }

      // Check phase completion conditions
      let phaseComplete = false;
      if (phase.type === 'gather' && phase.resource && phase.amount) {
        const current = this.baseStockpile[plan.team as 1|2]?.[phase.resource as ResourceType] || 0;
        if (current >= phase.amount) phaseComplete = true;
      } else if (phase.type === 'unlock_equipment' && phase.equipType) {
        const level = this.unlockedEquipment[plan.team as 1|2]?.get(phase.equipType as EquipmentType) || 0;
        if (level >= (phase.level || 1)) phaseComplete = true;
      }

      if (phaseComplete) {
        // Execute phase completion action
        if (phase.onComplete === 'unlock' && phase.equipType) {
          this.unlockEquipment(plan.team as 1|2, phase.equipType as EquipmentType);
        }
        plan.currentPhase++;
        if (plan.currentPhase >= plan.phases.length) {
          plan.completed = true;
          // Apply final workflow if specified
          if (plan.phases[plan.phases.length - 1]?.workflow) {
            this.assignWorkflow(plan.phases[plan.phases.length - 1].workflow, plan.subject, plan.team as 1|2);
          }
        }
      }
    }
  }

  private findNearestCamp(team: 1 | 2, animal?: string, qualifier?: string, _subject?: string): { x: number; y: number; campIndex: number } | null {
    const base = team === 1 ? P1_BASE : P2_BASE;
    let candidates = this.camps.slice();

    if (animal) candidates = candidates.filter(c => c.animalType === animal);

    const q = qualifier || 'nearest';
    if (q === 'uncaptured') candidates = candidates.filter(c => c.owner !== team);
    else if (q === 'enemy') candidates = candidates.filter(c => c.owner !== 0 && c.owner !== team);
    else candidates = candidates.filter(c => c.owner !== team);

    if (candidates.length === 0) {
      if (animal) candidates = this.camps.filter(c => c.animalType === animal);
      else candidates = this.camps.slice();
    }

    if (q === 'nearest' || q === 'uncaptured' || q === 'enemy') {
      candidates.sort((a, b) => pdist2(a, base) - pdist2(b, base));
    } else if (q === 'furthest') {
      candidates.sort((a, b) => pdist2(b, base) - pdist2(a, base));
    } else if (q === 'weakest') {
      candidates.sort((a, b) => {
        const da = this.units.filter(u => u.campId === a.id && u.team === 0 && !u.dead).length;
        const db = this.units.filter(u => u.campId === b.id && u.team === 0 && !u.dead).length;
        return da - db;
      });
    } else if (q === 'strongest') {
      candidates.sort((a, b) => {
        const da = this.units.filter(u => u.campId === a.id && u.team === 0 && !u.dead).length;
        const db = this.units.filter(u => u.campId === b.id && u.team === 0 && !u.dead).length;
        return db - da;
      });
    }

    if (candidates.length > 0) {
      const campIndex = this.camps.indexOf(candidates[0]);
      return { x: candidates[0].x, y: candidates[0].y, campIndex };
    }
    return null;
  }

  // ─── Sync State ─────────────────────────────────────────────

  /** Recursively strip undefined values (Firebase/JSON rejects them) */
  private static stripUndefined(obj: any): any {
    if (obj === null || obj === undefined) return null;
    if (typeof obj !== 'object') return obj;
    if (Array.isArray(obj)) return obj.map(v => GameSimulation.stripUndefined(v));
    const clean: Record<string, any> = {};
    for (const [k, v] of Object.entries(obj)) {
      if (v !== undefined) clean[k] = GameSimulation.stripUndefined(v);
    }
    return clean;
  }

  buildSyncState(): any {
    const syncUnits = this.units.filter(u => !u.dead).map(u => ({
      id: u.id, type: u.type, team: u.team,
      hp: u.hp, maxHp: u.maxHp, attack: u.attack, speed: u.speed,
      x: u.x, y: u.y, targetX: u.targetX, targetY: u.targetY,
      dead: false, campId: u.campId,
      carrying: u.carrying, equipment: u.equipment, equipLevel: u.equipLevel,
      animState: u.animState,
      loop: u.loop ? { steps: u.loop.steps.map(s => {
        const obj: Record<string, any> = {};
        for (const [k, v] of Object.entries(s)) { if (v !== undefined) obj[k] = v; }
        return obj;
      }), currentStep: u.loop.currentStep } : null,
    }));
    const syncCamps = this.camps.map(c => ({
      id: c.id, owner: c.owner, spawnTimer: c.spawnTimer, storedFood: c.storedFood,
    }));
    const syncNexuses = this.nexuses.map(n => ({
      team: n.team, hp: n.hp,
    }));
    return GameSimulation.stripUndefined({
      units: syncUnits,
      camps: syncCamps,
      nexuses: syncNexuses,
      rallyPoints: this.rallyPoints,
      nextId: this.nextId,
      gameTime: this.gameTime,
      gameOver: this.gameOver,
      winner: this.winner,
      baseStockpile: this.baseStockpile,
      currentEra: this.currentEra,
      groundItems: this.groundItems.filter(i => !i.dead).map(i => ({ id: i.id, type: i.type, x: i.x, y: i.y })),
      teamBuffs: this.teamBuffs.map(b => ({ team: b.team, stat: b.stat, amount: b.amount, remaining: b.remaining })),
      groupWorkflows: this.groupWorkflows,
      groupModifiers: this.groupModifiers,
      freeGnomeTimer: this.freeGnomeTimer,
      unlockedEquipment: {
        1: Object.fromEntries(this.unlockedEquipment[1]),
        2: Object.fromEntries(this.unlockedEquipment[2]),
      },
      matchStats: this.matchStats,
      shrine: this.shrine,
      bountyCamps: this.bountyCamps,
      activeSweeps: this.activeSweeps,
      activePlans: this.activePlans,
      isNight: this.isNight,
      nightCount: this.nightCount,
      isBloodMoon: this.isBloodMoon,
      freeSnakeTimer: this.freeSnakeTimer,
      mapEvents: this.mapEvents.map(e => ({
        id: e.id, type: e.type, x: e.x, y: e.y,
        timer: e.timer, duration: e.duration, state: e.state,
        progress: e.progress, claimedBy: e.claimedBy,
        data: GameSimulation.stripUndefined({
          hp: e.data.hp, maxHp: e.data.maxHp, kills: e.data.kills,
          deliveries: e.data.deliveries, sacrifices: e.data.sacrifices,
          fedAmount: e.data.fedAmount, bearSize: e.data.bearSize,
          targetType: e.data.targetType, targetCount: e.data.targetCount,
          cost: e.data.cost, sacrificesNeeded: e.data.sacrificesNeeded,
        }),
      })),
    });
  }

  isGameOver(): boolean {
    return this.gameOver;
  }

  // ─── Cleanup ────────────────────────────────────────────────

  private cleanupDead(): void {
    let writeIdx = 0;
    for (let readIdx = 0; readIdx < this.units.length; readIdx++) {
      const u = this.units[readIdx];
      if (!u.dead) {
        this.units[writeIdx++] = u;
      }
    }
    this.units.length = writeIdx;
  }
}
