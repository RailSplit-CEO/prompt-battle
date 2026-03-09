// ═══════════════════════════════════════════════════════
// ANIMAL ARMY - Simplified Game State
// ═══════════════════════════════════════════════════════

export interface Position {
  x: number;
  y: number;
}

// ─── Animal Types ────────────────────────────────────────
export type AnimalType =
  | 'rabbit' | 'parrot' | 'wolf' | 'falcon' | 'goat'
  | 'bear' | 'viper' | 'deer' | 'elephant' | 'lion';

export type UnitRole = 'swift_melee' | 'ranged' | 'melee_dps' | 'ranged_dps'
  | 'healer' | 'tank' | 'ranged_dot' | 'support' | 'elite_tank' | 'elite_melee';

export type CampTier = 1 | 2 | 3 | 4;

// ─── Hero System ─────────────────────────────────────────
export type HeroPassive = 'rally_leader' | 'iron_will' | 'swift_command' | 'keen_eye' | 'battle_fury';

export interface Hero {
  id: string;
  name: string;
  team: 'player1' | 'player2';
  passive: HeroPassive;
  currentHp: number;
  maxHp: number;
  attack: number;
  defense: number;
  speed: number;
  range: number;
  position: Position;
  isDead: boolean;
  respawnTimer: number;
  path: Position[];
  currentOrder: HeroOrder | null;
  orderQueue: HeroOrder[];
  upgrades: UpgradeType[];
  visionRange: number;
  isActiveHero: boolean;
  attackCooldown: number;
}

export const HERO_BASE_STATS = {
  maxHp: 200,
  attack: 20,
  defense: 15,
  speed: 4,
  range: 1,
  visionRange: 8,
};

export const HERO_RESPAWN_BASE = 10; // seconds
export const HERO_RESPAWN_COMEBACK_BONUS = 3; // seconds faster for losing team

export interface HeroOrder {
  type: 'move' | 'attack_camp' | 'attack_structure' | 'attack_hero'
    | 'attack_base' | 'defend' | 'retreat' | 'hold' | 'attack_unit';
  targetPosition?: Position;
  targetId?: string;
}

// ─── Passive Descriptions ────────────────────────────────
export const HERO_PASSIVES: Record<HeroPassive, { name: string; description: string; emoji: string }> = {
  rally_leader: { name: 'Rally Leader', description: 'Armies spawn 20% faster from captured camps', emoji: '📯' },
  iron_will: { name: 'Iron Will', description: 'All units gain +15% max HP', emoji: '🛡️' },
  swift_command: { name: 'Swift Command', description: 'Hero and all units move 15% faster', emoji: '⚡' },
  keen_eye: { name: 'Keen Eye', description: 'Hero vision +50%, captured camps reveal more area', emoji: '👁️' },
  battle_fury: { name: 'Battle Fury', description: 'All units deal +20% damage', emoji: '🔥' },
};

// ─── Animal Units ────────────────────────────────────────
export interface AnimalUnit {
  id: string;
  type: AnimalType;
  ownerId: string;       // hero who owns this unit
  team: 'player1' | 'player2';
  currentHp: number;
  maxHp: number;
  attack: number;
  defense: number;
  speed: number;
  range: number;
  position: Position;
  isDead: boolean;
  behavior: 'follow' | 'hold' | 'attack' | 'return_to_camp';
  attackCooldown: number;
  specialTimer: number;  // for healers (heal tick), vipers (poison tick), etc.
  targetId?: string;     // current attack target
  campId?: string;       // which camp spawned this unit
}

// ─── Camps ───────────────────────────────────────────────
export interface CampGuard {
  id: string;
  hp: number;
  maxHp: number;
  attack: number;
  defense: number;
  range: number;
  position: Position;
  isDead: boolean;
  attackCooldown: number;
}

export interface Camp {
  id: string;
  name: string;           // alliterative name
  position: Position;
  tier: CampTier;
  animalType: AnimalType;
  emoji: string;
  // Guards (neutral enemies to fight)
  guards: CampGuard[];
  guardRespawnTimer: number;  // respawn guards when camp goes neutral
  // Capture state
  capturedBy: string | null;  // hero ID who captured
  capturedTeam: 'player1' | 'player2' | null;
  // Spawning
  spawnTimer: number;
  spawnRate: number;          // seconds between spawns
  // Scaling
  scalingFactor: number;      // increases over time (1.0 = base)
  // Vision
  visionRange: number;
}

export const CAMP_SCALING_INTERVAL = 60;   // seconds between scaling ticks
export const CAMP_SCALING_AMOUNT = 0.10;   // +10% per interval
export const CAMP_NEUTRAL_TIMER = 30;      // seconds after owner dies before camp goes neutral

// ─── Structures ──────────────────────────────────────────
export type UpgradeType = 'savage_strikes' | 'hardened_hides' | 'mystic_missiles' | 'rapid_reinforcements';

export interface Structure {
  id: string;
  name: string;           // alliterative name
  position: Position;
  hp: number;
  maxHp: number;
  attack: number;
  range: number;
  attackCooldown: number;
  destroyedBy: 'player1' | 'player2' | null;
  upgradeType: UpgradeType;
  emoji: string;
  label: string;           // upgrade label shown on map
}

export const UPGRADE_EFFECTS: Record<UpgradeType, { name: string; description: string; emoji: string }> = {
  savage_strikes: { name: 'Savage Strikes', description: '+25% attack damage for all units', emoji: '⚔️' },
  hardened_hides: { name: 'Hardened Hides', description: '+30% max HP for all units', emoji: '🛡️' },
  mystic_missiles: { name: 'Mystic Missiles', description: 'Melee units gain ranged attack', emoji: '🏹' },
  rapid_reinforcements: { name: 'Rapid Reinforcements', description: '2x unit spawn rate', emoji: '⏩' },
};

// ─── Bases ───────────────────────────────────────────────
export interface Base {
  position: Position;
  hp: number;
  maxHp: number;
}

export const BASE_MAX_HP = 500;

// ─── Tile Types (simplified) ────────────────────────────
export type TileType =
  | 'grass' | 'forest' | 'water' | 'hill' | 'path'
  | 'bridge' | 'sand' | 'river' | 'shore'
  | 'blue_base' | 'red_base';

// ─── Game Meta ───────────────────────────────────────────
export type GameStatus = 'waiting' | 'playing' | 'finished';
export type WinReason = 'base_destroyed' | 'time_up' | 'disconnect';

export interface GameMeta {
  player1: string;
  player2: string;
  mapSeed: number;
  status: GameStatus;
  currentTurn: number;
  winner?: string;
  winReason?: WinReason;
  createdAt: number;
  gameDuration: number;       // total game time in seconds
  timeRemaining: number;      // seconds left
  gameTime: number;           // elapsed seconds (for scaling)
}

// ─── Commands ────────────────────────────────────────────
export type ActionType = 'move' | 'attack_camp' | 'attack_structure'
  | 'attack_hero' | 'attack_base' | 'defend' | 'retreat' | 'hold' | 'attack_unit';

export interface ResolvedAction {
  heroId: string;
  type: ActionType;
  targetPosition?: Position;
  targetId?: string;
}

export interface CommandLogEntry {
  id: string;
  playerId: string;
  rawText: string;
  timestamp: number;
  actions: ResolvedAction[];
}

// ─── Barks (simplified) ─────────────────────────────────
export type BarkTrigger =
  | 'order_attack' | 'order_move' | 'order_defend'
  | 'taking_damage' | 'got_kill' | 'ally_down'
  | 'enemy_spotted' | 'low_hp' | 'camp_captured';

export interface BarkEvent {
  heroId: string;
  text: string;
  trigger: BarkTrigger;
  timestamp: number;
}

// ─── Named Map Zones ────────────────────────────────────
export interface MapZone {
  name: string;
  center: Position;
  radius: number;
  type: 'camp' | 'structure' | 'base' | 'general';
}

// ─── Overall Game State ─────────────────────────────────
export interface GameState {
  meta: GameMeta;
  heroes: Record<string, Hero>;
  units: AnimalUnit[];
  camps: Camp[];
  structures: Structure[];
  bases: { player1: Base; player2: Base };
  commandLog: CommandLogEntry[];
}

// ─── Max Units ──────────────────────────────────────────
export const MAX_UNITS = 200;
export const MAX_UNITS_PER_HERO = 30;
