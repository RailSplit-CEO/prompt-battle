/**
 * Era progression rules — extracted for testability.
 *
 * Era 1 (Foraging): game start
 * Era 2 (Hunting):  after 90 seconds
 * Era 3 (Expansion): any player has units of 4+ distinct types
 * Era 4 (War):      any player has 10+ tier 3 units
 * Era 5 (Endgame):  elite killed OR any player has 5+ tier 4 units
 */

export interface EraUnit {
  team: number;
  type: string;
  tier: number;
  dead: boolean;
}

export interface EraContext {
  currentEra: number;
  gameTimeMs: number;
  units: EraUnit[];
  eliteKillCount: number;
}

/**
 * Given current game state, returns the era the game should be in.
 * Does NOT skip eras — returns the next era only (currentEra + 1) or currentEra.
 */
export function computeNextEra(ctx: EraContext): number {
  const { currentEra, gameTimeMs, units, eliteKillCount } = ctx;
  if (currentEra >= 5) return 5;

  let t = currentEra;

  // Era 2 — after 1 minute 30 seconds
  if (t === 1 && gameTimeMs >= 90000) t = 2;

  // Era 3 — any player has units of 4+ distinct types
  if (t === 2) {
    for (const team of [1, 2]) {
      const types = new Set(units.filter(u => u.team === team && !u.dead).map(u => u.type));
      if (types.size >= 4) { t = 3; break; }
    }
  }

  // Era 4 — any player has 10+ tier 3 units
  if (t === 3) {
    for (const team of [1, 2]) {
      const t3count = units.filter(u => u.team === team && !u.dead && u.tier === 3).length;
      if (t3count >= 10) { t = 4; break; }
    }
  }

  // Endgame — elite killed OR any player has 5+ tier 4 units
  if (t === 4) {
    if (eliteKillCount > 0) { t = 5; }
    else {
      for (const team of [1, 2]) {
        const t4count = units.filter(u => u.team === team && !u.dead && u.tier === 4).length;
        if (t4count >= 5) { t = 5; break; }
      }
    }
  }

  return t;
}

/**
 * Notification queue priority ordering and rules.
 */
export type NotifPriority = 'game_start' | 'era_banner' | 'event_spawn' | 'event_resolve';

const PRIORITY_MAP: Record<NotifPriority, number> = {
  game_start: 4,
  era_banner: 3,
  event_spawn: 2,
  event_resolve: 1,
};

export function getNotifPriority(type: NotifPriority): number {
  return PRIORITY_MAP[type];
}

export function sortNotifQueue<T extends { priority: number }>(queue: T[]): T[] {
  return [...queue].sort((a, b) => b.priority - a.priority);
}

/**
 * Returns true if a new notification of `type` can be displayed right now.
 */
export function canShowNotif(
  type: NotifPriority,
  eraBannerActive: boolean,
  activeSpawnCount: number,
): boolean {
  if (type === 'game_start' || type === 'era_banner') {
    return !eraBannerActive;
  }
  if (eraBannerActive) return false;
  if (type === 'event_spawn') return activeSpawnCount < 3;
  return true; // event_resolve always allowed when no banner active
}
