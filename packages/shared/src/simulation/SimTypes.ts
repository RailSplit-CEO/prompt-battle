// ═══════════════════════════════════════════════════════════════
// SimTypes.ts — All simulation data types, Phaser-free.
// Foundation types that all other simulation modules depend on.
// ═══════════════════════════════════════════════════════════════

import type { EquipmentType } from '../data/maps';
export type { EquipmentType };

// ─── Resource Types ──────────────────────────────────────────

export type ResourceType = 'carrot' | 'meat' | 'crystal' | 'metal';

// ─── Behavior Modifiers ─────────────────────────────────────

export interface BehaviorMods {
  formation: 'normal' | 'spread' | 'tight';
  caution: 'normal' | 'safe' | 'aggressive';
  pacing: 'normal' | 'rush' | 'efficient';
}

export const DEFAULT_MODS: BehaviorMods = { formation: 'normal', caution: 'normal', pacing: 'normal' };

// ─── Workflow System ─────────────────────────────────────────

export type WorkflowStep =
  | { action: 'seek_resource'; resourceType: ResourceType }
  | { action: 'deliver'; target: string }
  | { action: 'hunt'; targetType?: string }
  | { action: 'attack_camp'; campIndex?: number; qualifier?: string; targetAnimal?: string }
  | { action: 'move'; x: number; y: number }
  | { action: 'defend'; target: string }
  | { action: 'attack_enemies' }
  | { action: 'scout'; x?: number; y?: number }
  | { action: 'collect'; resourceType: ResourceType }
  | { action: 'kill_only'; targetType?: string }
  | { action: 'mine' }
  | { action: 'equip'; equipmentType: EquipmentType }
  | { action: 'contest_event' }
  | { action: 'withdraw_base'; resourceType: ResourceType }
  | { action: 'upgrade'; equipmentType: EquipmentType };

export interface HWorkflow {
  steps: WorkflowStep[];
  currentStep: number;
  label: string;
  loopFrom: number;
  playedOnce: boolean;
  voiceCommand?: string;
}

// ─── Animal Definition ───────────────────────────────────────

export interface AnimalDef {
  type: string;
  emoji: string;
  hp: number;
  attack: number;
  speed: number; // pixels per second
  tier: number;
  ability: string;
  desc: string;
  ability2: string;
  desc2: string;
  mineSpeed: number; // mining speed multiplier (1.0 = base 2s tick, higher = faster)
}

// ─── Unit (Phaser-free simulation state) ─────────────────────

export interface HUnit {
  id: number;
  type: string;
  team: 0 | 1 | 2; // 0 = neutral camp defender
  hp: number;
  maxHp: number;
  attack: number;
  speed: number;
  x: number;
  y: number;
  targetX: number;
  targetY: number;
  attackTimer: number;
  dead: boolean;
  campId: string | null;
  lungeX: number;
  lungeY: number;
  animState: 'idle' | 'walk' | 'attack';
  attackFaceX: number | null;
  prevSpriteX: number;
  prevSpriteY: number;
  // Special mechanic flags
  gnomeShield: number;
  hasRebirth: boolean;
  diveReady: boolean;
  diveTimer: number;
  lastAttackTarget: number;
  // Resource economy
  carrying: ResourceType | null;
  loop: HWorkflow | null;
  isElite: boolean;
  idleTimer: number;
  claimItemId: number;
  equipment: EquipmentType | null;
  equipLevel: number;
  equipVisualApplied: EquipmentType | null;
  mods: BehaviorMods;
  // A* pathfinding
  pathWaypoints: { x: number; y: number }[] | null;
  pathAge: number;
  pathTargetX: number;
  pathTargetY: number;
  // Stuck detection
  lastCheckX: number;
  lastCheckY: number;
  stuckFrames: number;
  stuckCooldown: number;
}

// ─── Camp Definition (static map data) ───────────────────────

export interface CampDef {
  id: string;
  name: string;
  type: string;
  x: number;
  y: number;
  guards: number;
  spawnMs: number;
  buff: { stat: string; value: number };
}

// ─── Camp (runtime state) ────────────────────────────────────

export interface HCamp {
  id: string;
  name: string;
  animalType: string;
  tier: number;
  guardCount: number;
  x: number;
  y: number;
  owner: 0 | 1 | 2;
  spawnMs: number;
  spawnTimer: number;
  buff: { stat: string; value: number };
  storedFood: number;
  // Fog of war
  scouted: boolean;
  lastSeenOwner: 0 | 1 | 2;
  lastSeenLabel: string;
  lastSeenColor: string;
}

// ─── Nexus ───────────────────────────────────────────────────

export interface HNexus {
  team: 1 | 2;
  x: number;
  y: number;
  hp: number;
  maxHp: number;
  attackTimer: number;
}

// ─── Tower ───────────────────────────────────────────────────

export interface HTower {
  id: string;
  team: 1 | 2;
  x: number;
  y: number;
  hp: number;
  maxHp: number;
  damage: number;
  range: number;
  splashRange: number;
  attackCooldown: number;
  attackTimer: number;
  alive: boolean;
}

// ─── Pending Hit (projectile / melee in flight) ──────────────

export interface PendingHit {
  attackerId: number;
  targetId: number;
  nexusTeam: 1 | 2 | 0;
  dmg: number;
  splashTargets: { id: number; dmg: number }[];
  timer: number;
  isTroll: boolean;
  isRanged: boolean;
  isSplash: boolean;
  isCrit: boolean;
  // Projectile fields (ranged only)
  projX: number;
  projY: number;
  projSpeed: number; // 0 = melee, uses timer
}

// ─── Ground Items ────────────────────────────────────────────

export interface HGroundItem {
  id: number;
  type: ResourceType;
  x: number;
  y: number;
  dead: boolean;
  age: number; // ms since spawn, for despawn
}

// ─── Mine Nodes ──────────────────────────────────────────────

export interface HMineNode {
  id: string;
  x: number;
  y: number;
}

// ─── Armory ──────────────────────────────────────────────────

export interface HArmory {
  x: number;
  y: number;
  team: 1 | 2;
  equipmentType: EquipmentType;
}

// ─── Map Events ──────────────────────────────────────────────

export type MapEventType = 'fungal_bloom' | 'warchest' | 'kill_bounty' | 'mercenary_outpost' | 'bottomless_pit' | 'hungry_bear';

export interface MapEvent {
  id: number;
  type: MapEventType;
  x: number;
  y: number;
  timer: number;
  duration: number;
  state: 'active' | 'claimed' | 'expired';
  progress: { 1: number; 2: number };
  claimedBy: 1 | 2 | null;
  data: Record<string, any>;
}

// ─── Team Buffs ──────────────────────────────────────────────

export interface TeamBuff {
  team: 1 | 2;
  stat: 'speed' | 'attack' | 'supply';
  amount: number;
  remaining: number;
}

// ─── Center Shrine ───────────────────────────────────────────

export interface ShrineState {
  owner: 0 | 1 | 2;
  captureProgress: { 1: number; 2: number };
  active: boolean;
  trickleTimer: number;
  pulseTimer: number;
}

// ─── Bounty Camps ────────────────────────────────────────────

export interface BountyCamp {
  x: number;
  y: number;
  defenders: number[];
  cleared: boolean;
  respawnTimer: number;
  cache?: { x: number; y: number; resources: Record<string, number>; timer: number };
}

// ─── Match Stats ─────────────────────────────────────────────

export interface MatchStats {
  unitsSpawned: Record<1 | 2, number>;
  unitsLost: Record<1 | 2, number>;
  totalKills: Record<1 | 2, number>;
  totalDamage: Record<1 | 2, number>;
  campsCaptured: Record<1 | 2, number>;
  campsLost: Record<1 | 2, number>;
  resourcesDelivered: Record<1 | 2, Record<string, number>>;
  peakArmySize: Record<1 | 2, number>;
}

// ─── Equipment Definition ────────────────────────────────────

export interface EquipmentDef {
  id: EquipmentType;
  name: string;
  emoji: string;
  cost: Partial<Record<ResourceType, number>>;
  effect: string;
}

// ─── Advanced Plan Types ─────────────────────────────────────

export interface PlanPhase {
  id: string;
  workflow: HWorkflow | null;
  completionCheck: 'resource_threshold' | 'equipment_unlocked' | 'final';
  resourceTarget?: Partial<Record<ResourceType, number>>;
  equipTarget?: { type: EquipmentType; level: number };
  onComplete?: { unlock?: EquipmentType };
  label: string;
}

export interface AdvancedPlan {
  id: string;
  phases: PlanPhase[];
  currentPhase: number;
  team: 1 | 2;
  subject: string;
  goalLabel: string;
  originalCommand: string;
  completed: boolean;
  finalWorkflow?: HWorkflow;
}

// ─── Horde Command (LLM output) ─────────────────────────────

export interface HordeCommand {
  targetType: 'camp' | 'nearest_camp' | 'sweep_camps' | 'nexus' | 'base' | 'position' | 'defend' | 'retreat' | 'workflow' | 'query' | 'advanced_plan';
  targetAnimal?: string;
  campIndex?: number;
  qualifier?: 'nearest' | 'furthest' | 'weakest' | 'strongest' | 'uncaptured' | 'enemy';
  workflow?: { action: string; resourceType?: string; target?: string; targetType?: string; campIndex?: number; qualifier?: string; targetAnimal?: string; x?: number; y?: number; equipmentType?: string }[];
  loopFrom?: number;
  narration?: string;
  unitReaction?: string;
  modifiers?: { formation?: string | null; caution?: string | null; pacing?: string | null };
  modifierOnly?: boolean;
  responseType?: 'action' | 'unrecognized' | 'status_query' | 'acknowledgment';
  statusReport?: string;
  planGoal?: { type: string; equipment?: string; resource?: string; amount?: number; thenAction?: string };
}

// ─── Vision Source ───────────────────────────────────────────

export interface VisionSource {
  x: number;
  y: number;
  r: number; // vision radius in world pixels
}

// ═══════════════════════════════════════════════════════════════
// MULTIPLAYER SYNC TYPES
// ═══════════════════════════════════════════════════════════════

export interface HordeSyncUnit {
  id: number;
  type: string;
  team: number;
  hp: number;
  maxHp: number;
  attack: number;
  speed: number;
  x: number;
  y: number;
  targetX: number;
  targetY: number;
  dead: boolean;
  campId: string | null;
  carrying?: string | null;
  equipment?: string | null;
  equipLevel?: number;
  animState?: string;
  loop?: { steps: { action: string }[]; currentStep: number } | null;
}

export interface HordeSyncState {
  units: HordeSyncUnit[];
  camps: { id: string; owner: number; spawnTimer: number; storedFood: number }[];
  nexuses: { team: number; hp: number }[];
  rallyPoints: Record<string, { x: number; y: number }>;
  baseSpawnTimers: { 1: number; 2: number };
  nextId: number;
  gameTime: number;
  gameOver: boolean;
  winner: number | null;
  mapEvents?: { id: number; type: string; x: number; y: number; timer: number; duration: number; state: string; progress: { 1: number; 2: number }; claimedBy: number | null; data: Record<string, any> }[];
  baseStockpile?: { 1: Record<string, number>; 2: Record<string, number> };
  currentEra?: number;
  groundItems?: { id: number; type: string; x: number; y: number }[];
  teamBuffs?: { team: number; stat: string; amount: number; remaining: number }[];
  unlockedEquipment?: { 1: Record<string, number>; 2: Record<string, number> };
  matchStats?: any;
  topKiller?: Record<string, { type: string; kills: number }>;
  groupWorkflows?: Record<string, any>;
  groupModifiers?: Record<string, any>;
  freeGnomeTimer?: number;
  shrine?: { active: boolean; owner: number; captureProgress: { 1: number; 2: number }; trickleTimer: number; x: number; y: number };
  bountyCamps?: Array<{ campId: string; cleared: boolean; respawnTimer: number }>;
  activeSweeps?: Record<string, { team: number; subject: string; targets: string[]; currentIdx: number }>;
  activePlans?: Array<{ team: number; subject: string; phases: any[]; currentPhase: number; completed: boolean }>;
  isNight?: boolean;
  nightCount?: number;
  isBloodMoon?: boolean;
  freeSnakeTimer?: number;
}

// ─── Scene Init Data ─────────────────────────────────────────

export interface HordeSceneData {
  isOnline?: boolean;
  gameId?: string;
  playerId?: string;
  amPlayer1?: boolean;
  mapId?: string;
  isDebug?: boolean;
  opponentUid?: string;
}

// ─── Map Event Definitions ───────────────────────────────────

export interface MapEventDef {
  emoji: string;
  name: string;
  duration: number;
  minEra: number;
}

// ─── Game Context (for LLM) ──────────────────────────────────

export interface GameContext {
  myUnits: { type: string; count: number; tier: number; gathering: number }[];
  camps: { name: string; animalType: string; tier: number; owner: string; index: number; x: number; y: number; dist: number; defenders: number; storedFood: number; spawnCost: number }[];
  nexusHp: { mine: number; enemy: number };
  resources: { carrot: number; meat: number; crystal: number; metal: number };
  groundCarrots: number;
  groundMeat: number;
  groundCrystals: number;
  gameTime: number;
  selectedHoard: string;
  hoardCenter: { x: number; y: number };
  carrotZones: { x: number; y: number; w: number; h: number }[];
  activeEvents?: { type: string; emoji: string; name: string; x: number; y: number; timeLeft: number; info: string; howToWin: string }[];
  activeBuffs?: { stat: string; amount: number; remaining: number }[];
}

// ─── Movement / Combat Context Types ────────────────────────

export type SimWorkflow = HWorkflow;

export type Pos = { x: number; y: number };

export type EquipBuffs = {
  speed: number; attack: number; hp: number;
  damageTaken: number; atkSpeedMult: number;
  pickupRange: number; gatherSpeed: number;
};

export type BannerAura = { speed: number; attack: number };

export type TeamBuffs = { speed: number; attack: number; hp: number };

// ─── Type Aliases (sim-prefixed names for clarity) ──────────
// These allow simulation modules to use readable "Sim*" names
// while the core types retain "H*" for HordeScene compat.

export type SimUnit = HUnit;
export type SimCamp = HCamp;
export type SimNexus = HNexus;
export type SimTower = HTower & { projSpeed: number };
export type SimGroundItem = HGroundItem;
export type SimMineNode = HMineNode;
export type SimArmory = HArmory;

// ─── Map Definition ──────────────────────────────────────────
// Re-export the full MapDef from data/maps so simulation and server can use it.
import type { MapDef as _MapDef } from '../data/maps';
export type MapDef = _MapDef;

// ─── SimState Interface ─────────────────────────────────────
// Implemented by GameSimulation and consumed by all system modules.

export interface SimState {
  units: SimUnit[];
  camps: SimCamp[];
  nexuses: SimNexus[];
  groundItems: SimGroundItem[];
  towers: SimTower[];
  armories: SimArmory[];
  mineNodes: SimMineNode[];
  mapEvents: MapEvent[];
  pendingHits: PendingHit[];
  eventBuffs: { team: 1 | 2; stat: string; value: number; timer: number }[];
  teamBuffs: { team: 1 | 2; stat: 'speed' | 'attack' | 'supply'; amount: number; remaining: number }[];

  nextId: number;
  nextItemId: number;
  nextEventId: number;
  gameTime: number;
  lastDeltaMs: number;
  freeGnomeTimer: number;
  freeSnakeTimer: number;
  carrotSpawnTimer: number;
  aiTimer: number;
  eventCycleTimer: number;
  eventCycleCount: number;
  dayNightTimer: number;

  isNight: boolean;
  nightCount: number;
  isBloodMoon: boolean;
  duskWarned: boolean;
  shadowBeasts: number[];

  currentEra: number;
  gameOver: boolean;
  winner: 1 | 2 | null;
  eliteKillCount: number;
  gameStartBannerShown: boolean;

  baseStockpile: Record<1 | 2, Record<ResourceType, number>>;
  unlockedEquipment: Record<1 | 2, Map<EquipmentType, number>>;
  rallyPoints: Record<string, { x: number; y: number }>;
  groupWorkflows: Record<string, HWorkflow>;
  groupModifiers: Record<string, BehaviorMods>;
  matchStats: MatchStats;

  mapDef: MapDef | null;
  isSolo: boolean;
  fogDisabled: boolean;

  lastEventType: string | null;
  lastSoloSide: 'left' | 'right';

  // Methods
  groundItemById(id: number): SimGroundItem | undefined;
  isInVision(x: number, y: number): boolean;
  findWalkableSpawn(x: number, y: number): { x: number; y: number };
  spawnGroundItem(type: ResourceType, x: number, y: number): void;
  spawnUnit(type: string, team: 1 | 2, x: number, y: number): void;
  getTeamSupply(team: 1 | 2): number;
  getMaxSupply(team: 1 | 2): number;
  getSupplyCost(type: string): number;
  getUpkeepRate(team: 1 | 2): number;
  getBuffs(team: 1 | 2): { speed: number; attack: number; hp: number };
  getUnitEquipBuffs(u: SimUnit): { speed: number; attack: number; hp: number; damageTaken: number; atkSpeedMult: number; pickupRange: number; gatherSpeed: number };
  getEquipLevel(team: 1 | 2, eqType: EquipmentType): number;
  unlockEquipment(team: 1 | 2, eqType: EquipmentType): boolean;
  isCampActive(camp: SimCamp): boolean;
  spawnWildAnimals(types: string[], count: number): void;
  spawnElitePreyBatch(): void;
}
