import { Position } from './game-state';

// ─── Monster Types ──────────────────────────────────────────────
export type MonsterTier = 1 | 2 | 3 | 4 | 5;
export type MonsterType = 'bunny' | 'turtle' | 'wolf' | 'bear' | 'lion' | 'dragon';

export interface MonsterDefinition {
  type: MonsterType;
  tier: MonsterTier;
  name: string;
  emoji: string;
  stats: {
    hp: number;
    attack: number;
    defense: number;
    speed: number;   // tiles per move tick
    range: number;
  };
  groupSize: number;  // how many spawn per camp
}

export const MONSTER_DEFS: Record<MonsterType, MonsterDefinition> = {
  bunny: {
    type: 'bunny', tier: 1, name: 'Bunny', emoji: '🐇',
    stats: { hp: 30, attack: 5, defense: 2, speed: 5, range: 1 },
    groupSize: 6,
  },
  turtle: {
    type: 'turtle', tier: 2, name: 'Turtle', emoji: '🐢',
    stats: { hp: 80, attack: 8, defense: 15, speed: 2, range: 1 },
    groupSize: 4,
  },
  wolf: {
    type: 'wolf', tier: 2, name: 'Wolf', emoji: '🐺',
    stats: { hp: 50, attack: 15, defense: 5, speed: 4, range: 1 },
    groupSize: 4,
  },
  bear: {
    type: 'bear', tier: 3, name: 'Bear', emoji: '🐻',
    stats: { hp: 120, attack: 25, defense: 12, speed: 3, range: 1 },
    groupSize: 2,
  },
  lion: {
    type: 'lion', tier: 4, name: 'Lion', emoji: '🦁',
    stats: { hp: 100, attack: 35, defense: 8, speed: 4, range: 1 },
    groupSize: 2,
  },
  dragon: {
    type: 'dragon', tier: 5, name: 'Dragon', emoji: '🐉',
    stats: { hp: 500, attack: 50, defense: 25, speed: 3, range: 2 },
    groupSize: 1,
  },
};

// ─── Lane Types ─────────────────────────────────────────────────
export type LaneId = 'top' | 'mid' | 'bot';
export type TeamId = 'team1' | 'team2';

export interface LaneTower {
  id: string;
  lane: LaneId;
  team: TeamId;
  position: Position;
  hp: number;
  maxHp: number;
  damage: number;
  range: number;   // tiles
  index: number;   // 0=outer, 1=mid, 2=inner (closest to nexus)
  alive: boolean;
  attackCooldown: number;
}

export interface Nexus {
  team: TeamId;
  position: Position;
  hp: number;
  maxHp: number;
  alive: boolean;
}

// ─── Minion (auto-spawning lane creep) ──────────────────────────
export interface LaneMinion {
  id: string;
  team: TeamId;
  lane: LaneId;
  position: Position;
  hp: number;
  maxHp: number;
  attack: number;
  defense: number;
  speed: number;
  isDead: boolean;
  path: Position[];       // waypoints to walk
  pathIndex: number;
  targetId?: string;      // what it's attacking
}

// ─── Jungle Monster (in a camp) ─────────────────────────────────
export interface JungleMonster {
  id: string;
  campId: string;
  type: MonsterType;
  position: Position;
  hp: number;
  maxHp: number;
  attack: number;
  defense: number;
  speed: number;
  range: number;
  isDead: boolean;
  convertedBy?: TeamId;   // when killed, joins this team
}

// ─── Converted Monster (fighting in lane) ───────────────────────
export interface ConvertedMonster {
  id: string;
  type: MonsterType;
  team: TeamId;
  lane: LaneId;
  position: Position;
  hp: number;
  maxHp: number;
  attack: number;
  defense: number;
  speed: number;
  range: number;
  isDead: boolean;
  path: Position[];
  pathIndex: number;
  targetId?: string;
}

// ─── Jungle Camp ────────────────────────────────────────────────
export interface JungleCamp {
  id: string;
  position: Position;          // center of camp
  monsterType: MonsterType;
  tier: MonsterTier;
  nearestLane: LaneId;
  monsters: JungleMonster[];
  respawnTimer: number;        // ticks until full respawn (0 = active)
}

// ─── Hero (player-controlled character) ─────────────────────────
export interface JungleHero {
  id: string;
  team: TeamId;
  name: string;
  emoji: string;
  position: Position;
  hp: number;
  maxHp: number;
  attack: number;
  defense: number;
  speed: number;
  range: number;
  level: number;
  xp: number;
  isDead: boolean;
  respawnTimer: number;
  currentOrder?: JLHeroOrder | null;
  path?: Position[];
  attackCooldown: number;
}

export interface JLHeroOrder {
  type: 'move' | 'attack' | 'attack_camp' | 'hold' | 'retreat';
  targetPosition?: Position;
  targetId?: string;
  campId?: string;
}

// ─── Game Constants ─────────────────────────────────────────────
export const JL_CONSTANTS = {
  MAP_WIDTH: 80,
  MAP_HEIGHT: 80,
  TILE_SIZE: 32,

  // Timing
  TICK_RATE: 750,           // ms per game tick
  MOVE_TICK: 600,           // ms per movement step
  ATTACK_INTERVAL: 1500,    // ms between auto-attacks

  // Game
  GAME_DURATION: 600,       // 10 minutes max
  RESPAWN_TIME: 20,         // seconds for hero respawn
  HEROES_PER_TEAM: 5,

  // Minion waves
  MINION_SPAWN_INTERVAL: 30, // seconds between minion waves
  MINIONS_PER_WAVE: 4,
  MINION_HP: 60,
  MINION_ATTACK: 8,
  MINION_DEFENSE: 3,
  MINION_SPEED: 3,

  // Towers
  TOWER_HP: 800,
  TOWER_DAMAGE: 30,
  TOWER_RANGE: 5,
  TOWER_ATTACK_SPEED: 1500, // ms

  // Nexus
  NEXUS_HP: 2000,

  // Heroes
  HERO_BASE_HP: 200,
  HERO_BASE_ATTACK: 20,
  HERO_BASE_DEFENSE: 10,
  HERO_BASE_SPEED: 4,
  HERO_BASE_RANGE: 1,
  LEVEL_STAT_BONUS: 0.06,     // +6% all stats per level
  PASSIVE_XP_PER_TICK: 1,     // XP gained per tick passively
  XP_PER_LEVEL: [0, 80, 180, 300, 450, 650, 900, 1200], // levels 1-8
  ALIVE_ANIMAL_STAT_BONUS: 0.02, // +2% all stats per alive converted monster

  // Camp respawn
  CAMP_RESPAWN_TICKS: 5,     // ticks after full clear before camp respawns

  // Dragon
  DRAGON_BUFF_DURATION: 120,  // seconds
  DRAGON_BUFF_MULTIPLIER: 1.3, // 30% stat boost to all units
};

// ─── Map Layout ─────────────────────────────────────────────────
// Diagonal mirror: P1 base at bottom-left, P2 base at top-right
// Top lane: up the left edge, across the top
// Bot lane: across the bottom, up the right edge
// Mid lane: diagonal through center

export interface JungleLaneMapDef {
  // Base positions
  nexus1: Position;   // team1 (bottom-left)
  nexus2: Position;   // team2 (top-right)

  // Spawn points for heroes
  spawn1: Position[];
  spawn2: Position[];

  // Lane waypoints (ordered from team1 side to team2 side)
  lanes: Record<LaneId, Position[]>;

  // Tower positions per lane per team
  towers: {
    team1: Record<LaneId, Position[]>;
    team2: Record<LaneId, Position[]>;
  };

  // Jungle camps
  camps: Array<{
    position: Position;
    monsterType: MonsterType;
    nearestLane: LaneId;
    side: TeamId;  // which side of the map
  }>;

  // Dragon pit
  dragonPit: Position;
}

// Default map layout
export const JUNGLE_LANE_MAP: JungleLaneMapDef = {
  nexus1: { x: 5, y: 74 },
  nexus2: { x: 74, y: 5 },

  spawn1: [
    { x: 7, y: 72 }, { x: 9, y: 72 }, { x: 7, y: 74 },
    { x: 9, y: 74 }, { x: 8, y: 73 },
  ],
  spawn2: [
    { x: 72, y: 7 }, { x: 70, y: 7 }, { x: 72, y: 5 },
    { x: 70, y: 5 }, { x: 71, y: 6 },
  ],

  // Lane waypoints from team1 towards team2
  lanes: {
    top: [
      { x: 5, y: 70 }, { x: 5, y: 60 }, { x: 5, y: 50 },
      { x: 5, y: 40 }, { x: 5, y: 30 }, { x: 5, y: 20 },
      { x: 5, y: 10 }, { x: 5, y: 5 },
      { x: 15, y: 5 }, { x: 25, y: 5 }, { x: 35, y: 5 },
      { x: 45, y: 5 }, { x: 55, y: 5 }, { x: 65, y: 5 },
      { x: 74, y: 5 },
    ],
    mid: [
      { x: 10, y: 70 }, { x: 16, y: 64 }, { x: 22, y: 58 },
      { x: 28, y: 52 }, { x: 34, y: 46 }, { x: 40, y: 40 },
      { x: 46, y: 34 }, { x: 52, y: 28 }, { x: 58, y: 22 },
      { x: 64, y: 16 }, { x: 70, y: 10 },
    ],
    bot: [
      { x: 10, y: 74 }, { x: 20, y: 74 }, { x: 30, y: 74 },
      { x: 40, y: 74 }, { x: 50, y: 74 }, { x: 60, y: 74 },
      { x: 70, y: 74 }, { x: 74, y: 74 },
      { x: 74, y: 65 }, { x: 74, y: 55 }, { x: 74, y: 45 },
      { x: 74, y: 35 }, { x: 74, y: 25 }, { x: 74, y: 15 },
      { x: 74, y: 5 },
    ],
  },

  // 3 towers per lane per team (outer, mid, inner)
  towers: {
    team1: {
      top: [{ x: 5, y: 60 }, { x: 5, y: 50 }, { x: 5, y: 40 }],
      mid: [{ x: 16, y: 64 }, { x: 24, y: 56 }, { x: 32, y: 48 }],
      bot: [{ x: 20, y: 74 }, { x: 35, y: 74 }, { x: 50, y: 74 }],
    },
    team2: {
      top: [{ x: 55, y: 5 }, { x: 45, y: 5 }, { x: 35, y: 5 }],
      mid: [{ x: 64, y: 16 }, { x: 56, y: 24 }, { x: 48, y: 32 }],
      bot: [{ x: 74, y: 20 }, { x: 74, y: 35 }, { x: 74, y: 50 }],
    },
  },

  // Jungle camps - 16 per side
  // Team 1 side (bottom-left half)
  camps: [
    // Top lane camps (5 per side) - left side jungle
    { position: { x: 12, y: 60 }, monsterType: 'bunny', nearestLane: 'top', side: 'team1' },
    { position: { x: 12, y: 52 }, monsterType: 'wolf', nearestLane: 'top', side: 'team1' },
    { position: { x: 12, y: 44 }, monsterType: 'turtle', nearestLane: 'top', side: 'team1' },
    { position: { x: 12, y: 36 }, monsterType: 'bear', nearestLane: 'top', side: 'team1' },
    { position: { x: 12, y: 28 }, monsterType: 'lion', nearestLane: 'top', side: 'team1' },

    // Mid lane camps (6 per side, 3 on each side of mid) - team1
    { position: { x: 18, y: 56 }, monsterType: 'bunny', nearestLane: 'mid', side: 'team1' },
    { position: { x: 24, y: 50 }, monsterType: 'wolf', nearestLane: 'mid', side: 'team1' },
    { position: { x: 30, y: 44 }, monsterType: 'bear', nearestLane: 'mid', side: 'team1' },
    { position: { x: 22, y: 66 }, monsterType: 'bunny', nearestLane: 'mid', side: 'team1' },
    { position: { x: 28, y: 60 }, monsterType: 'turtle', nearestLane: 'mid', side: 'team1' },
    { position: { x: 34, y: 54 }, monsterType: 'wolf', nearestLane: 'mid', side: 'team1' },

    // Bot lane camps (5 per side) - bottom jungle
    { position: { x: 20, y: 68 }, monsterType: 'bunny', nearestLane: 'bot', side: 'team1' },
    { position: { x: 28, y: 68 }, monsterType: 'wolf', nearestLane: 'bot', side: 'team1' },
    { position: { x: 36, y: 68 }, monsterType: 'turtle', nearestLane: 'bot', side: 'team1' },
    { position: { x: 44, y: 68 }, monsterType: 'bear', nearestLane: 'bot', side: 'team1' },
    { position: { x: 52, y: 68 }, monsterType: 'lion', nearestLane: 'bot', side: 'team1' },

    // Team 2 side (top-right half) - mirrored diagonally
    // Top lane camps (5) - top jungle
    { position: { x: 60, y: 12 }, monsterType: 'bunny', nearestLane: 'top', side: 'team2' },
    { position: { x: 52, y: 12 }, monsterType: 'wolf', nearestLane: 'top', side: 'team2' },
    { position: { x: 44, y: 12 }, monsterType: 'turtle', nearestLane: 'top', side: 'team2' },
    { position: { x: 36, y: 12 }, monsterType: 'bear', nearestLane: 'top', side: 'team2' },
    { position: { x: 28, y: 12 }, monsterType: 'lion', nearestLane: 'top', side: 'team2' },

    // Mid lane camps (6) - team2
    { position: { x: 56, y: 18 }, monsterType: 'bunny', nearestLane: 'mid', side: 'team2' },
    { position: { x: 50, y: 24 }, monsterType: 'wolf', nearestLane: 'mid', side: 'team2' },
    { position: { x: 44, y: 30 }, monsterType: 'bear', nearestLane: 'mid', side: 'team2' },
    { position: { x: 66, y: 22 }, monsterType: 'bunny', nearestLane: 'mid', side: 'team2' },
    { position: { x: 60, y: 28 }, monsterType: 'turtle', nearestLane: 'mid', side: 'team2' },
    { position: { x: 54, y: 34 }, monsterType: 'wolf', nearestLane: 'mid', side: 'team2' },

    // Bot lane camps (5) - right jungle
    { position: { x: 68, y: 20 }, monsterType: 'bunny', nearestLane: 'bot', side: 'team2' },
    { position: { x: 68, y: 28 }, monsterType: 'wolf', nearestLane: 'bot', side: 'team2' },
    { position: { x: 68, y: 36 }, monsterType: 'turtle', nearestLane: 'bot', side: 'team2' },
    { position: { x: 68, y: 44 }, monsterType: 'bear', nearestLane: 'bot', side: 'team2' },
    { position: { x: 68, y: 52 }, monsterType: 'lion', nearestLane: 'bot', side: 'team2' },
  ],

  dragonPit: { x: 40, y: 40 },
};

// ─── Full Game State ────────────────────────────────────────────
export interface JungleLaneState {
  meta: {
    gameId: string;
    player1: string;
    player2: string;
    status: 'playing' | 'finished';
    timeRemaining: number;
    winner?: string;
  };
  heroes: Record<string, JungleHero>;
  towers: LaneTower[];
  nexuses: { team1: Nexus; team2: Nexus };
  minions: LaneMinion[];
  camps: JungleCamp[];
  convertedMonsters: ConvertedMonster[];
  dragonAlive: boolean;
  dragonRespawnTimer: number;
  dragonBuffTeam?: TeamId;
  dragonBuffTimer: number;
  minionWaveTimer: number;  // ticks until next wave
}

// ─── Sync snapshot sent to clients ──────────────────────────────
export interface JungleLaneSyncSnapshot {
  heroes: Record<string, JungleHero>;
  towers: LaneTower[];
  nexuses: { team1: Nexus; team2: Nexus };
  minions: LaneMinion[];
  camps: JungleCamp[];
  convertedMonsters: ConvertedMonster[];
  dragonAlive: boolean;
  dragonBuffTeam?: TeamId;
  dragonBuffTimer: number;
  timeRemaining: number;
  gameOver?: boolean;
  winner?: string;
  events: JLGameEvent[];
}

export interface JLGameEvent {
  type: 'kill' | 'tower_destroyed' | 'nexus_destroyed' | 'dragon_slain' |
    'monster_converted' | 'hero_died' | 'hero_respawn';
  data: any;
  timestamp: number;
}
