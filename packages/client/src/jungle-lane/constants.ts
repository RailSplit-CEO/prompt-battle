// ═══════════════════════════════════════════════════════
// JUNGLE LANES - Game Constants (fully isolated)
// ═══════════════════════════════════════════════════════

export const JL = {
  MAP_WIDTH: 80,
  MAP_HEIGHT: 80,
  TILE_SIZE: 32,

  // Timing
  TICK_RATE: 750,
  MOVE_TICK: 600,
  ATTACK_INTERVAL: 1500,

  // Game
  GAME_DURATION: 600,       // 10 minutes
  RESPAWN_TIME: 20,         // seconds
  HEROES_PER_TEAM: 5,

  // Minion waves
  MINION_SPAWN_INTERVAL: 30,
  MINIONS_PER_WAVE: 4,
  MINION_HP: 60,
  MINION_ATTACK: 8,
  MINION_DEFENSE: 3,
  MINION_SPEED: 3,

  // Towers
  TOWER_HP: 800,
  TOWER_DAMAGE: 30,
  TOWER_RANGE: 5,
  TOWER_ATTACK_SPEED: 1500,

  // Nexus
  NEXUS_HP: 2000,

  // Heroes
  HERO_BASE_HP: 200,
  HERO_BASE_ATTACK: 20,
  HERO_BASE_DEFENSE: 10,
  HERO_BASE_SPEED: 4,
  HERO_BASE_RANGE: 1,
  LEVEL_STAT_BONUS: 0.06,
  PASSIVE_XP_PER_TICK: 1,
  XP_PER_LEVEL: [0, 80, 180, 300, 450, 650, 900, 1200],
  ALIVE_ANIMAL_STAT_BONUS: 0.02,

  // Camp respawn
  CAMP_RESPAWN_TICKS: 5,

  // Dragon
  DRAGON_BUFF_DURATION: 120,
  DRAGON_BUFF_MULTIPLIER: 1.3,
} as const;

export const HERO_NAMES = ['Alpha', 'Bravo', 'Charlie', 'Delta', 'Echo'];
export const HERO_EMOJIS = ['⚔️', '🏹', '🔮', '🛡️', '🗡️'];
