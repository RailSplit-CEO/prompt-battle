// ─── Player Level System ────────────────────────────────────────

export interface PlayerLevel {
  level: number;       // 1-100
  xp: number;          // XP within current level
  totalXp: number;     // lifetime cumulative
  lastMatchXp: number; // most recent match
}

export const DEFAULT_PLAYER_LEVEL: PlayerLevel = {
  level: 1, xp: 0, totalXp: 0, lastMatchXp: 0,
};

// Cumulative XP thresholds for each level (index 0 = level 1 = 0 XP needed)
export const LEVEL_THRESHOLDS: number[] = [0]; // level 1 starts at 0
// Generate thresholds for levels 2-100
(function() {
  let cumulative = 0;
  for (let lvl = 2; lvl <= 100; lvl++) {
    let xpNeeded: number;
    if (lvl <= 10) xpNeeded = 200;
    else if (lvl <= 30) xpNeeded = 350;
    else if (lvl <= 50) xpNeeded = 500;
    else if (lvl <= 75) xpNeeded = 750;
    else xpNeeded = 1000;
    cumulative += xpNeeded;
    LEVEL_THRESHOLDS.push(cumulative);
  }
})();

export function getLevelForTotalXp(totalXp: number): number {
  for (let i = LEVEL_THRESHOLDS.length - 1; i >= 0; i--) {
    if (totalXp >= LEVEL_THRESHOLDS[i]) return i + 1;
  }
  return 1;
}

export function getXpForNextLevel(level: number): number {
  if (level >= 100) return 0;
  return LEVEL_THRESHOLDS[level] - LEVEL_THRESHOLDS[level - 1];
}

export function getXpInCurrentLevel(totalXp: number): number {
  const level = getLevelForTotalXp(totalXp);
  return totalXp - LEVEL_THRESHOLDS[level - 1];
}

export interface MatchXpInput {
  kills: number;
  damage: number;
  campsCaptured: number;
  resourcesDelivered: number;
  unitsSpawned: number;
  peakArmy: number;
  isWin: boolean;
  isOnline: boolean;
  gameTimeMs: number;
  boosterActive: boolean;
}

export function computeMatchXp(input: MatchXpInput): number {
  let xp = 0;
  // Base
  if (input.isOnline) xp += input.isWin ? 200 : 80;
  else xp += input.isWin ? 120 : 50;
  // Stats
  xp += input.kills * 3;
  xp += Math.floor(input.damage / 500);
  xp += input.campsCaptured * 8;
  xp += Math.floor(input.resourcesDelivered / 50);
  xp += Math.floor(input.unitsSpawned / 5);
  xp += Math.floor(input.peakArmy / 10) * 2;
  // Duration (5 XP per minute, capped at 30)
  const minutes = Math.min(30, Math.floor(input.gameTimeMs / 60000));
  xp += minutes * 5;
  // Booster
  if (input.boosterActive) xp *= 2;
  // Cap
  return Math.min(500, xp);
}

export interface LevelReward {
  crowns?: number;
  glory?: number;
  itemId?: string;
}

export const LEVEL_REWARDS: Record<number, LevelReward> = {
  2: { glory: 50 },
  5: { glory: 100, itemId: 'frame_wooden' },
  10: { crowns: 200, itemId: 'title_the_magnificent' },
  15: { glory: 150 },
  20: { crowns: 300, itemId: 'emote_dancing' },
  25: { glory: 500, itemId: 'frame_iron' },
  30: { crowns: 500, itemId: 'spawn_fx_lightning' },
  35: { glory: 200 },
  40: { crowns: 600, itemId: 'frame_shimmer' },
  50: { crowns: 1000, itemId: 'title_iron_will' },
  60: { glory: 800, itemId: 'title_beast_tamer' },
  70: { crowns: 1500, itemId: 'title_grand_marshal' },
  80: { glory: 1000, itemId: 'title_doom_bringer' },
  90: { crowns: 2000 },
  100: { crowns: 5000, glory: 2000, itemId: 'frame_celestial' },
};

// Non-milestone levels: alternating 25 glory / 25 crowns
export function getRewardForLevel(level: number): LevelReward | null {
  if (LEVEL_REWARDS[level]) return LEVEL_REWARDS[level];
  if (level <= 1) return null;
  return level % 2 === 0 ? { glory: 25 } : { crowns: 25 };
}

// ─── Crate grants on level-up ──────────────────────────────────
// Every level-up: 1 Silver Crate. Every 10 levels: bonus Gold Crate.
import type { CrateTier } from '../types/store';

export function getCratesForLevel(level: number): CrateTier[] {
  if (level <= 1) return [];
  const crates: CrateTier[] = ['silver'];
  if (level % 10 === 0) crates.push('gold');
  return crates;
}
