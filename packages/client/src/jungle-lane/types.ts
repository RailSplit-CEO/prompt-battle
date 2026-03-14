// ═══════════════════════════════════════════════════════
// JUNGLE LANES - Fully isolated types
// No imports from shared package
// ═══════════════════════════════════════════════════════

export interface Position {
  x: number;
  y: number;
}

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
    speed: number;
    range: number;
  };
  groupSize: number;
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
  range: number;
  index: number;
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
  path: Position[];
  pathIndex: number;
  targetId?: string;
}

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
}

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

export interface JungleCamp {
  id: string;
  position: Position;
  monsterType: MonsterType;
  tier: MonsterTier;
  nearestLane: LaneId;
  monsters: JungleMonster[];
  respawnTimer: number;
}

export interface JLHeroOrder {
  type: 'move' | 'attack' | 'attack_camp' | 'hold' | 'retreat';
  targetPosition?: Position;
  targetId?: string;
  campId?: string;
}

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

// ─── Targetable entity (for combat resolution) ─────────────────
export interface Targetable {
  id: string;
  position: Position;
  hp: number;
  maxHp: number;
}
