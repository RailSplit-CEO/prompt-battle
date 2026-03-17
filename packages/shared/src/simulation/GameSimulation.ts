// ─── GameSimulation.ts ─────────────────────────────────────────
// Main orchestrator class. Holds all game state, runs the tick
// loop. Mirrors HordeScene.update() host path.
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
  PendingHit,
  MapDef,
} from './SimTypes';

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
} from './Constants';

import * as DayNight from './DayNight';
import * as CampLogic from './CampLogic';
import * as UnitAI from './UnitAI';
import * as MapEvents from './MapEvents';
import * as BotAI from './BotAI';

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

  // ─── Map Events ─────────────────────────────────────────────
  lastEventType: string | null = null;
  lastSoloSide: 'left' | 'right' = 'left';

  // ─── Map Definition ─────────────────────────────────────────
  mapDef: MapDef | null;
  isSolo: boolean;
  fogDisabled = true; // server sim has global vision

  // ─── Ground Item Lookup ─────────────────────────────────────
  private _groundItemMap = new Map<number, SimGroundItem>();

  constructor(mapDef: MapDef | null, _mapSeed: number, isSolo: boolean) {
    this.mapDef = mapDef;
    this.isSolo = isSolo;

    // Create nexuses
    this.nexuses = [
      { team: 1, x: P1_BASE.x, y: P1_BASE.y, hp: NEXUS_MAX_HP, maxHp: NEXUS_MAX_HP, attackTimer: 0 },
      { team: 2, x: P2_BASE.x, y: P2_BASE.y, hp: NEXUS_MAX_HP, maxHp: NEXUS_MAX_HP, attackTimer: 0 },
    ];

    // Spawn starting gnomes (3 per team)
    for (const team of [1, 2] as const) {
      const b = team === 1 ? P1_BASE : P2_BASE;
      for (let i = 0; i < 3; i++) {
        this.spawnUnit('gnome', team, b.x + (i - 1) * 30, b.y + 40);
      }
    }
  }

  // ─── SimState Interface Methods ─────────────────────────────

  groundItemById(id: number): SimGroundItem | undefined {
    return this._groundItemMap.get(id);
  }

  isInVision(_x: number, _y: number): boolean {
    // Server sim has full vision
    return true;
  }

  findWalkableSpawn(x: number, y: number): { x: number; y: number } {
    // TODO: integrate with tile map for proper pathfinding
    // For now, clamp to world bounds
    return {
      x: Math.max(50, Math.min(WORLD_W - 50, x)),
      y: Math.max(50, Math.min(WORLD_H - 50, y)),
    };
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
    let cap = MAX_SUPPLY;
    for (const b of this.teamBuffs) {
      if (b.team === team && b.stat === 'supply' && b.remaining > 0) cap += b.amount;
    }
    return cap;
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
    // Event buffs
    for (const b of this.eventBuffs) {
      if (b.team !== team) continue;
      if (b.stat === 'attack') attack += b.value;
      if (b.stat === 'speed') speed += b.value;
    }
    // Camp loot buffs
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
      // Random outskirts position
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
        attack: def.attack, speed: def.speed * (0.4 + Math.random() * 0.3),
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
    const eliteTypes = ['minotaur', 'shaman'];
    for (let i = 0; i < ELITE_PREY_COUNT; i++) {
      const type = eliteTypes[i % eliteTypes.length];
      const def = ANIMALS[type];
      if (!def) continue;
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
        id: this.nextId++, type, team: 0,
        hp: Math.round(def.hp * 2), maxHp: Math.round(def.hp * 2),
        attack: Math.round(def.attack * 1.5), speed: def.speed * 0.4,
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

  // ─── Main Tick ──────────────────────────────────────────────

  tick(deltaMs: number): void {
    if (this.gameOver) return;
    this.lastDeltaMs = deltaMs;
    const dt = deltaMs / 1000;
    this.gameTime += deltaMs;

    // Rebuild ground item lookup
    this._groundItemMap.clear();
    for (const i of this.groundItems) {
      if (!i.dead) this._groundItemMap.set(i.id, i);
    }

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

    // Movement is handled externally (Movement module)
    // Combat is handled externally (Combat module)

    // Nexus & tower combat
    CampLogic.updateNexusCombat(deltaMs, this);
    CampLogic.updateTowers(deltaMs, this);

    // Camp capture
    CampLogic.updateCampCapture(this);

    // Era progression
    CampLogic.updateEraProgression(this);

    // Map events
    MapEvents.updateMapEvents(deltaMs, this);

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

  processCommand(_team: 1 | 2, _orders: any[]): void {
    // Apply player orders to units.
    // This will be wired to the LLM command parser.
    // Each order sets unit.loop, unit.targetX/Y, unit.mods, etc.
  }

  // ─── Sync State ─────────────────────────────────────────────

  buildSyncState(): any {
    const syncUnits = this.units.filter(u => !u.dead).map(u => ({
      id: u.id, type: u.type, team: u.team,
      hp: u.hp, maxHp: u.maxHp, attack: u.attack, speed: u.speed,
      x: u.x, y: u.y, targetX: u.targetX, targetY: u.targetY,
      dead: false, campId: u.campId,
      carrying: u.carrying, equipment: u.equipment, equipLevel: u.equipLevel,
      animState: u.animState,
      loop: u.loop ? { steps: u.loop.steps.map(s => ({ ...(s as any) })), currentStep: u.loop.currentStep } : null,
    }));
    const syncCamps = this.camps.map(c => ({
      id: c.id, owner: c.owner, spawnTimer: c.spawnTimer, storedFood: c.storedFood,
    }));
    const syncNexuses = this.nexuses.map(n => ({
      team: n.team, hp: n.hp,
    }));
    return {
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
      mapEvents: this.mapEvents.map(e => ({
        id: e.id, type: e.type, x: e.x, y: e.y,
        timer: e.timer, duration: e.duration, state: e.state,
        progress: e.progress, claimedBy: e.claimedBy,
        data: {
          hp: e.data.hp, maxHp: e.data.maxHp, kills: e.data.kills,
          deliveries: e.data.deliveries, sacrifices: e.data.sacrifices,
          fedAmount: e.data.fedAmount, bearSize: e.data.bearSize,
          targetType: e.data.targetType, targetCount: e.data.targetCount,
          cost: e.data.cost, sacrificesNeeded: e.data.sacrificesNeeded,
        },
      })),
    };
  }

  isGameOver(): boolean {
    return this.gameOver;
  }

  // ─── Cleanup ────────────────────────────────────────────────

  private cleanupDead(): void {
    // In-place compaction for units
    let writeIdx = 0;
    for (let readIdx = 0; readIdx < this.units.length; readIdx++) {
      const u = this.units[readIdx];
      if (!u.dead) {
        this.units[writeIdx++] = u;
      }
    }
    this.units.length = writeIdx;

    // Ground items are cleaned up by UnitAI.updateGroundItems
  }
}
