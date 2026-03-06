import { ClassId, AnimalId, Stats } from './characters';

export interface Position {
  x: number;
  y: number;
}

export interface ActiveEffect {
  type: string;
  duration: number;
  value?: number;
}

// ─── Consumables ────────────────────────────────────────────────
export type ConsumableId =
  | 'siege_bomb' | 'smoke_bomb' | 'battle_horn'
  | 'haste_elixir' | 'iron_skin' | 'vision_flare'
  | 'rally_banner' | 'purge_scroll';

export interface ConsumableDefinition {
  id: ConsumableId;
  name: string;
  description: string;
  icon: string;
  category: 'combat' | 'strategic' | 'personal';
}

// ─── Character ──────────────────────────────────────────────────
export interface Character {
  id: string;
  owner: string;
  classId: ClassId;
  animalId: AnimalId;
  name: string;
  stats: Stats;
  baseStats: Stats;      // stats before level scaling
  currentHp: number;
  position: Position;
  cooldowns: Record<string, number>;
  effects: ActiveEffect[];
  isDead: boolean;
  // Leveling
  level: number;          // 1-5
  xp: number;            // current XP
  // Inventory
  inventory: ConsumableId[];  // max 2 slots
  // Activity channeling
  channelActivity?: {
    type: 'scout' | 'loot' | 'build' | 'trap' | 'upgrade_cp' | 'mine' | 'build_tower';
    ticksRemaining: number;
    position: Position;
  } | null;
  // Personality & Morale
  personality?: Personality;
  morale?: MoraleState;
  moraleTimer?: number;
  lastPraised?: number;
  // Optional real-time fields
  respawnTimer?: number;
  currentOrder?: CharacterOrder | null;
  path?: Position[];
  hasFlag?: boolean;
  visionRange?: number;
  isActiveHero?: boolean;
}

export interface CharacterOrder {
  type: 'move' | 'attack' | 'ability' | 'defend' | 'retreat' | 'capture' | 'hold'
    | 'escort' | 'patrol' | 'control'
    | 'use_item' | 'scout' | 'loot' | 'build' | 'set_trap'
    | 'mine' | 'build_tower' | 'praise';
  targetPosition?: Position;
  targetCharacterId?: string;
  abilityId?: string;
  itemId?: ConsumableId;
}

// ─── XP / Leveling ──────────────────────────────────────────────
export const XP_THRESHOLDS = [0, 100, 250, 450, 700]; // XP needed for levels 1-5
export const LEVEL_STAT_BONUS = 0.08; // +8% all stats per level

export type GameStatus = 'waiting' | 'drafting' | 'playing' | 'finished';
export type TileType =
  | 'grass' | 'forest' | 'water' | 'rock' | 'hill' | 'bush' | 'path'
  | 'bridge' | 'lava' | 'sand' | 'swamp' | 'flowers' | 'mushroom' | 'ruins'
  | 'gate_open' | 'gate_closed' | 'switch';

export type GameMode = 'domination';
export type WinReason = 'domination' | 'time_up' | 'elimination' | 'disconnect';

export interface FlagState {
  position: Position;         // current position on map
  homePosition: Position;     // where it spawns
  carrier: string | null;     // character id carrying it, or null
  isHome: boolean;            // is it at its home base?
}

export interface CTFState {
  flag1: FlagState;           // player 1's flag
  flag2: FlagState;           // player 2's flag
  score1: number;             // player 1 captures
  score2: number;             // player 2 captures
  capturesNeeded: number;     // captures to win (1 for now)
}

export interface GameMeta {
  player1: string;
  player2: string;
  mapSeed: number;
  status: GameStatus;
  mode: GameMode;
  currentTurn: number;
  winner?: string;
  winReason?: WinReason;
  createdAt: number;
  gameDuration: number;       // total game time in seconds (300 = 5 min)
  timeRemaining: number;      // seconds left
}

export interface DraftPick {
  playerId: string;
  classId: ClassId;
  animalId: AnimalId;
  pickOrder: number;
}

export interface DraftState {
  picks: DraftPick[];
  currentPickIndex: number;
  pickOrder: string[];
  timer: number;
  phase: 'picking' | 'done';
}

export interface GameState {
  meta: GameMeta;
  characters: Record<string, Character>;
  draft: DraftState;
  ctf: CTFState;
  commandLog: CommandLogEntry[];
}

export interface CommandLogEntry {
  id: string;
  playerId: string;
  rawText: string;
  timestamp: number;
  actions: ResolvedAction[];
}

export interface ResolvedAction {
  characterId: string;
  type: ActionType;
  target?: Position | string;
  abilityId?: string;
  result?: ActionResult;
}

export type ActionType = 'move' | 'attack' | 'ability' | 'defend' | 'retreat' | 'hold' | 'capture' | 'escort' | 'patrol' | 'control'
  | 'use_item' | 'scout' | 'loot' | 'build' | 'set_trap'
  | 'mine' | 'build_tower' | 'praise';

// ─── Points of Interest ─────────────────────────────────────────
export interface POI {
  id: string;
  type: 'lookout' | 'healing_well' | 'treasure_cache';
  position: Position;
  active: boolean;
  respawnTimer: number;        // seconds until respawn (caches only)
  channelTime: number;         // ticks to complete channel
  upgraded?: boolean;          // for CP upgrades
}

export interface Barricade {
  id: string;
  position: Position;
  owner: string;               // player who built it
  hp: number;                  // destructible, 80 HP
  maxHp: number;
  decayTimer: number;          // seconds until decay
}

export interface Trap {
  id: string;
  position: Position;
  owner: string;
  damage: number;
  stunDuration: number;
  visible: boolean;            // only visible to owner
}

export interface ControlPointBuff {
  type: 'speed' | 'damage' | 'defense';
  value: number;   // multiplier, e.g. 1.1 = +10%
  label: string;
}

export interface ControlPoint {
  id: string;
  position: Position;
  owner: 'player1' | 'player2' | null;
  captureProgress: number; // 0-100
  capturingTeam: 'player1' | 'player2' | null;
  buff: ControlPointBuff;
  upgraded?: boolean;
}

export interface ActionResult {
  damage?: number;
  healing?: number;
  moved?: Position;
  killed?: string;
  effectApplied?: string;
  flagPickedUp?: boolean;
  flagCaptured?: boolean;
  flagReturned?: boolean;
  goldEarned?: number;
}

// ─── Personality & Morale ────────────────────────────────────────
export type BoldnessAxis = 'bold' | 'cautious';
export type LoyaltyAxis = 'loyal' | 'independent';
export interface Personality {
  boldness: BoldnessAxis;
  loyalty: LoyaltyAxis;
}
export type MoraleState = 'confident' | 'shaken';

// ─── Follower (companions) ──────────────────────────────────────
export type FollowerType = 'wolf' | 'hawk' | 'militia';
export interface Follower {
  id: string;
  type: FollowerType;
  ownerId: string;
  ownerTeam: string;
  stats: Stats;
  currentHp: number;
  position: Position;
  isDead: boolean;
  behavior: 'follow' | 'guard' | 'attack' | 'scout';
  targetPosition?: Position;
}

// ─── Economy ────────────────────────────────────────────────────
export type MapPhase = 1 | 2 | 3 | 4;
export const MINE_RATE_PER_SEC = 3;
export const BASE_INCOME_PER_SEC = 1;
export const TOWER_COST = 200;

export interface PlayerEconomy {
  gold: number;
  income: number;
  upkeepPenalty: number;
}

export interface MineNode {
  id: string;
  name: string;
  position: Position;
  type: 'safe' | 'rich';
  depleted: boolean;
  goldPerSec: number;
  currentGold: number;
  activatePhase: MapPhase;
  occupiedBy: string | null;
}

export interface Tower {
  id: string;
  position: Position;
  owner: string;
  hp: number;
  maxHp: number;
  damage: number;
  range: number;
}

export interface TowerSite {
  id: string;
  name: string;
  position: Position;
  builtTower: Tower | null;
  occupied: boolean;
  activatePhase: MapPhase;
}

export interface NeutralCamp {
  id: string;
  name: string;
  position: Position;
  type: 'easy' | 'hard';
  activatePhase: MapPhase;
  cleared: boolean;
  respawnTimer: number;
  enemies: CampEnemy[];
  reward: { gold: number; xp: number; buff?: string };
}

export interface CampEnemy {
  id: string;
  hp: number;
  maxHp: number;
  attack: number;
  position: Position;
  isDead: boolean;
}

export interface ScoutingPost {
  id: string;
  name: string;
  position: Position;
  capturedBy: string | null;
  visionRadius: number;
}

// ─── Barks ──────────────────────────────────────────────────────
export type BarkTrigger =
  | 'order_attack' | 'order_defend' | 'order_move'
  | 'taking_damage' | 'got_kill' | 'praised'
  | 'ignored_while_hurt' | 'ally_down'
  | 'enemy_spotted' | 'low_hp' | 'mine_depleted';

export interface BarkEvent {
  characterId: string;
  text: string;
  trigger: BarkTrigger;
  timestamp: number;
}

// ─── Named Map Zones ────────────────────────────────────────────
export interface MapZone {
  name: string;
  center: Position;
  radius: number;
  type: 'mine' | 'camp' | 'tower_site' | 'scouting_post' | 'healing_well' | 'spawn' | 'general';
}
