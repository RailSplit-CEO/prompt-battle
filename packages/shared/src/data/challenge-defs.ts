export interface ChallengeDef {
  id: string;
  title: string;
  description: string;
  type: 'daily' | 'weekly';
  target: number;           // e.g. "kill 20 units" -> target = 20
  xpReward: number;         // battle pass XP
  gloryReward: number;      // bonus glory
  trackingKey: string;      // key used to track progress: 'kills', 'camps_captured', 'resources_gathered', 'units_spawned', 'matches_played', 'matches_won', 'damage_dealt'
}

// Pool of daily challenges (3 selected per day)
export const DAILY_CHALLENGE_POOL: ChallengeDef[] = [
  { id: 'daily_kill_15', title: 'Blood Thirst', description: 'Eliminate 15 enemy units', type: 'daily', target: 15, xpReward: 200, gloryReward: 15, trackingKey: 'kills' },
  { id: 'daily_capture_2', title: 'Land Grab', description: 'Capture 2 camps', type: 'daily', target: 2, xpReward: 200, gloryReward: 15, trackingKey: 'camps_captured' },
  { id: 'daily_gather_100', title: 'Hoarder', description: 'Gather 100 resources', type: 'daily', target: 100, xpReward: 200, gloryReward: 15, trackingKey: 'resources_gathered' },
  { id: 'daily_spawn_20', title: 'Army Builder', description: 'Spawn 20 units', type: 'daily', target: 20, xpReward: 200, gloryReward: 15, trackingKey: 'units_spawned' },
  { id: 'daily_play_2', title: 'Dedicated', description: 'Play 2 matches', type: 'daily', target: 2, xpReward: 200, gloryReward: 15, trackingKey: 'matches_played' },
  { id: 'daily_win_1', title: 'Champion', description: 'Win a match', type: 'daily', target: 1, xpReward: 250, gloryReward: 20, trackingKey: 'matches_won' },
  { id: 'daily_damage_500', title: 'Destruction', description: 'Deal 500 damage', type: 'daily', target: 500, xpReward: 200, gloryReward: 15, trackingKey: 'damage_dealt' },
  { id: 'daily_kill_30', title: 'Massacre', description: 'Eliminate 30 enemy units', type: 'daily', target: 30, xpReward: 250, gloryReward: 20, trackingKey: 'kills' },
  { id: 'daily_capture_3', title: 'Conqueror', description: 'Capture 3 camps', type: 'daily', target: 3, xpReward: 250, gloryReward: 20, trackingKey: 'camps_captured' },
  { id: 'daily_gather_200', title: 'Stockpiler', description: 'Gather 200 resources', type: 'daily', target: 200, xpReward: 250, gloryReward: 20, trackingKey: 'resources_gathered' },
];

// Pool of weekly challenges (3 selected per week)
export const WEEKLY_CHALLENGE_POOL: ChallengeDef[] = [
  { id: 'weekly_kill_100', title: 'Warmonger', description: 'Eliminate 100 enemy units', type: 'weekly', target: 100, xpReward: 500, gloryReward: 50, trackingKey: 'kills' },
  { id: 'weekly_win_5', title: 'Winning Streak', description: 'Win 5 matches', type: 'weekly', target: 5, xpReward: 500, gloryReward: 50, trackingKey: 'matches_won' },
  { id: 'weekly_play_10', title: 'Veteran', description: 'Play 10 matches', type: 'weekly', target: 10, xpReward: 500, gloryReward: 50, trackingKey: 'matches_played' },
  { id: 'weekly_capture_10', title: 'Empire Builder', description: 'Capture 10 camps', type: 'weekly', target: 10, xpReward: 500, gloryReward: 50, trackingKey: 'camps_captured' },
  { id: 'weekly_gather_1000', title: 'Dragon\'s Hoard', description: 'Gather 1000 resources', type: 'weekly', target: 1000, xpReward: 500, gloryReward: 50, trackingKey: 'resources_gathered' },
  { id: 'weekly_damage_5000', title: 'Devastator', description: 'Deal 5000 total damage', type: 'weekly', target: 5000, xpReward: 500, gloryReward: 50, trackingKey: 'damage_dealt' },
];

/**
 * Get today's 3 daily challenges using a deterministic date-based seed.
 */
export function getTodaysDailies(): ChallengeDef[] {
  const today = new Date();
  const seed = today.getFullYear() * 10000 + (today.getMonth() + 1) * 100 + today.getDate();
  return pickFromPool(DAILY_CHALLENGE_POOL, 3, seed);
}

/**
 * Get this week's 3 weekly challenges using a deterministic week-based seed.
 */
export function getThisWeeksWeeklies(): ChallengeDef[] {
  const now = new Date();
  const startOfYear = new Date(now.getFullYear(), 0, 1);
  const weekNum = Math.floor((now.getTime() - startOfYear.getTime()) / (7 * 24 * 60 * 60 * 1000));
  const seed = now.getFullYear() * 100 + weekNum;
  return pickFromPool(WEEKLY_CHALLENGE_POOL, 3, seed);
}

function pickFromPool(pool: ChallengeDef[], count: number, seed: number): ChallengeDef[] {
  const shuffled = [...pool];
  let s = seed;
  for (let i = shuffled.length - 1; i > 0; i--) {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    const j = s % (i + 1);
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled.slice(0, count);
}
