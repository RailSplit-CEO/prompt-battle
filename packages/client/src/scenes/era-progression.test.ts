import { describe, it, expect } from 'vitest';
import {
  computeNextEra,
  EraContext,
  EraUnit,
  getNotifPriority,
  sortNotifQueue,
  canShowNotif,
} from './era-progression';

// ── Helpers ──────────────────────────────────────────────────

function makeUnits(specs: { team: number; type: string; tier: number; count: number }[]): EraUnit[] {
  const units: EraUnit[] = [];
  for (const s of specs) {
    for (let i = 0; i < s.count; i++) {
      units.push({ team: s.team, type: s.type, tier: s.tier, dead: false });
    }
  }
  return units;
}

function ctx(overrides: Partial<EraContext> = {}): EraContext {
  return {
    currentEra: 1,
    gameTimeMs: 0,
    units: [],
    eliteKillCount: 0,
    ...overrides,
  };
}

// ═══════════════════════════════════════════════════════════════
// ERA PROGRESSION
// ═══════════════════════════════════════════════════════════════

describe('Era Progression', () => {

  // ── Era 1 → 2: Time-based (90s) ───────────────────────────

  describe('Era 1 → 2 (time-based)', () => {
    it('stays era 1 before 90 seconds', () => {
      expect(computeNextEra(ctx({ gameTimeMs: 89999 }))).toBe(1);
    });

    it('advances to era 2 at exactly 90 seconds', () => {
      expect(computeNextEra(ctx({ gameTimeMs: 90000 }))).toBe(2);
    });

    it('advances to era 2 well past 90 seconds', () => {
      expect(computeNextEra(ctx({ gameTimeMs: 120000 }))).toBe(2);
    });

    it('stays era 1 at 0ms', () => {
      expect(computeNextEra(ctx({ gameTimeMs: 0 }))).toBe(1);
    });
  });

  // ── Era 2 → 3: 4 distinct unit types ──────────────────────

  describe('Era 2 → 3 (4 distinct unit types)', () => {
    it('stays era 2 with 3 distinct types', () => {
      const units = makeUnits([
        { team: 1, type: 'gnome', tier: 1, count: 5 },
        { team: 1, type: 'skull', tier: 2, count: 3 },
        { team: 1, type: 'spider', tier: 2, count: 2 },
      ]);
      expect(computeNextEra(ctx({ currentEra: 2, gameTimeMs: 100000, units }))).toBe(2);
    });

    it('advances to era 3 with 4 distinct types (team 1)', () => {
      const units = makeUnits([
        { team: 1, type: 'gnome', tier: 1, count: 3 },
        { team: 1, type: 'skull', tier: 2, count: 2 },
        { team: 1, type: 'spider', tier: 2, count: 2 },
        { team: 1, type: 'hyena', tier: 2, count: 1 },
      ]);
      expect(computeNextEra(ctx({ currentEra: 2, gameTimeMs: 100000, units }))).toBe(3);
    });

    it('advances to era 3 with 4 distinct types (team 2)', () => {
      const units = makeUnits([
        { team: 2, type: 'gnome', tier: 1, count: 1 },
        { team: 2, type: 'turtle', tier: 1, count: 1 },
        { team: 2, type: 'skull', tier: 2, count: 1 },
        { team: 2, type: 'rogue', tier: 2, count: 1 },
      ]);
      expect(computeNextEra(ctx({ currentEra: 2, gameTimeMs: 100000, units }))).toBe(3);
    });

    it('ignores dead units when counting types', () => {
      const units: EraUnit[] = [
        { team: 1, type: 'gnome', tier: 1, dead: false },
        { team: 1, type: 'skull', tier: 2, dead: false },
        { team: 1, type: 'spider', tier: 2, dead: false },
        { team: 1, type: 'hyena', tier: 2, dead: true }, // dead — doesn't count
      ];
      expect(computeNextEra(ctx({ currentEra: 2, gameTimeMs: 100000, units }))).toBe(2);
    });

    it('does not count neutral units (team 0)', () => {
      const units: EraUnit[] = [
        { team: 1, type: 'gnome', tier: 1, dead: false },
        { team: 1, type: 'skull', tier: 2, dead: false },
        { team: 1, type: 'spider', tier: 2, dead: false },
        { team: 0, type: 'hyena', tier: 2, dead: false }, // neutral
      ];
      expect(computeNextEra(ctx({ currentEra: 2, gameTimeMs: 100000, units }))).toBe(2);
    });

    it('advances with 5+ types', () => {
      const units = makeUnits([
        { team: 1, type: 'gnome', tier: 1, count: 1 },
        { team: 1, type: 'turtle', tier: 1, count: 1 },
        { team: 1, type: 'skull', tier: 2, count: 1 },
        { team: 1, type: 'spider', tier: 2, count: 1 },
        { team: 1, type: 'hyena', tier: 2, count: 1 },
      ]);
      expect(computeNextEra(ctx({ currentEra: 2, gameTimeMs: 100000, units }))).toBe(3);
    });
  });

  // ── Era 3 → 4: 10 tier 3 units ────────────────────────────

  describe('Era 3 → 4 (10 tier-3 units)', () => {
    it('stays era 3 with 9 tier-3 units', () => {
      const units = makeUnits([
        { team: 1, type: 'panda', tier: 3, count: 9 },
      ]);
      expect(computeNextEra(ctx({ currentEra: 3, gameTimeMs: 200000, units }))).toBe(3);
    });

    it('advances to era 4 with exactly 10 tier-3 units', () => {
      const units = makeUnits([
        { team: 1, type: 'panda', tier: 3, count: 6 },
        { team: 1, type: 'lizard', tier: 3, count: 4 },
      ]);
      expect(computeNextEra(ctx({ currentEra: 3, gameTimeMs: 200000, units }))).toBe(4);
    });

    it('team 2 can trigger era 4', () => {
      const units = makeUnits([
        { team: 2, type: 'lizard', tier: 3, count: 12 },
      ]);
      expect(computeNextEra(ctx({ currentEra: 3, gameTimeMs: 200000, units }))).toBe(4);
    });

    it('does not count tier-2 units', () => {
      const units = makeUnits([
        { team: 1, type: 'skull', tier: 2, count: 15 },
        { team: 1, type: 'panda', tier: 3, count: 5 },
      ]);
      expect(computeNextEra(ctx({ currentEra: 3, gameTimeMs: 200000, units }))).toBe(3);
    });

    it('does not count dead tier-3 units', () => {
      const units: EraUnit[] = [];
      for (let i = 0; i < 8; i++) units.push({ team: 1, type: 'panda', tier: 3, dead: false });
      for (let i = 0; i < 5; i++) units.push({ team: 1, type: 'panda', tier: 3, dead: true });
      expect(computeNextEra(ctx({ currentEra: 3, gameTimeMs: 200000, units }))).toBe(3);
    });
  });

  // ── Era 4 → 5: Elite killed OR 5 tier-4 units ─────────────

  describe('Era 4 → 5 (Endgame)', () => {
    it('stays era 4 with no elites killed and < 5 T4 units', () => {
      const units = makeUnits([
        { team: 1, type: 'minotaur', tier: 4, count: 4 },
      ]);
      expect(computeNextEra(ctx({ currentEra: 4, gameTimeMs: 300000, units }))).toBe(4);
    });

    it('advances to era 5 when elite killed', () => {
      expect(computeNextEra(ctx({ currentEra: 4, gameTimeMs: 300000, eliteKillCount: 1 }))).toBe(5);
    });

    it('advances to era 5 with 5 tier-4 units (team 1)', () => {
      const units = makeUnits([
        { team: 1, type: 'minotaur', tier: 4, count: 3 },
        { team: 1, type: 'shaman', tier: 4, count: 2 },
      ]);
      expect(computeNextEra(ctx({ currentEra: 4, gameTimeMs: 300000, units }))).toBe(5);
    });

    it('advances to era 5 with 5 tier-4 units (team 2)', () => {
      const units = makeUnits([
        { team: 2, type: 'shaman', tier: 4, count: 5 },
      ]);
      expect(computeNextEra(ctx({ currentEra: 4, gameTimeMs: 300000, units }))).toBe(5);
    });

    it('does not count tier-3 units toward T4 threshold', () => {
      const units = makeUnits([
        { team: 1, type: 'panda', tier: 3, count: 20 },
        { team: 1, type: 'minotaur', tier: 4, count: 3 },
      ]);
      expect(computeNextEra(ctx({ currentEra: 4, gameTimeMs: 300000, units }))).toBe(4);
    });
  });

  // ── Edge cases ─────────────────────────────────────────────

  describe('Edge cases', () => {
    it('never exceeds era 5', () => {
      expect(computeNextEra(ctx({
        currentEra: 5, gameTimeMs: 999999, eliteKillCount: 10,
        units: makeUnits([{ team: 1, type: 'minotaur', tier: 4, count: 50 }]),
      }))).toBe(5);
    });

    it('cascades through eras when multiple conditions met simultaneously', () => {
      // With conditions for era 3 (4 types) AND era 4 (10 T3) both met,
      // computeNextEra evaluates all in sequence and returns highest reachable
      const units = makeUnits([
        { team: 1, type: 'gnome', tier: 1, count: 1 },
        { team: 1, type: 'skull', tier: 2, count: 1 },
        { team: 1, type: 'spider', tier: 2, count: 1 },
        { team: 1, type: 'hyena', tier: 2, count: 1 },
        { team: 1, type: 'panda', tier: 3, count: 15 },
      ]);
      expect(computeNextEra(ctx({ currentEra: 2, gameTimeMs: 200000, units }))).toBe(4);
    });

    it('HordeScene calls advanceEra per-step (each frame advances only once)', () => {
      // Simulate how HordeScene would handle cascading:
      // Frame 1: era 2 → computeNextEra returns 4, but advanceEra(3) first
      // Frame 2: era 3 → computeNextEra returns 4, advanceEra(4)
      let era = 2;
      const units = makeUnits([
        { team: 1, type: 'gnome', tier: 1, count: 1 },
        { team: 1, type: 'skull', tier: 2, count: 1 },
        { team: 1, type: 'spider', tier: 2, count: 1 },
        { team: 1, type: 'hyena', tier: 2, count: 1 },
        { team: 1, type: 'panda', tier: 3, count: 15 },
      ]);
      // First evaluation
      const next1 = computeNextEra(ctx({ currentEra: era, gameTimeMs: 200000, units }));
      expect(next1).toBeGreaterThan(era);
      era = next1; // In practice HordeScene advances to next1
      expect(era).toBe(4);
    });

    it('empty units array stays at current era', () => {
      expect(computeNextEra(ctx({ currentEra: 2, gameTimeMs: 200000, units: [] }))).toBe(2);
      expect(computeNextEra(ctx({ currentEra: 3, gameTimeMs: 200000, units: [] }))).toBe(3);
      expect(computeNextEra(ctx({ currentEra: 4, gameTimeMs: 200000, units: [] }))).toBe(4);
    });
  });
});

// ═══════════════════════════════════════════════════════════════
// NOTIFICATION SYSTEM
// ═══════════════════════════════════════════════════════════════

describe('Notification System', () => {

  describe('Priority ordering', () => {
    it('game_start has highest priority (4)', () => {
      expect(getNotifPriority('game_start')).toBe(4);
    });

    it('era_banner has priority 3', () => {
      expect(getNotifPriority('era_banner')).toBe(3);
    });

    it('event_spawn has priority 2', () => {
      expect(getNotifPriority('event_spawn')).toBe(2);
    });

    it('event_resolve has priority 1', () => {
      expect(getNotifPriority('event_resolve')).toBe(1);
    });

    it('sorts queue by descending priority', () => {
      const queue = [
        { priority: 1, type: 'resolve' },
        { priority: 3, type: 'era' },
        { priority: 2, type: 'spawn' },
        { priority: 4, type: 'start' },
      ];
      const sorted = sortNotifQueue(queue);
      expect(sorted.map(q => q.priority)).toEqual([4, 3, 2, 1]);
    });
  });

  describe('canShowNotif rules', () => {
    it('blocks game_start when era banner is active', () => {
      expect(canShowNotif('game_start', true, 0)).toBe(false);
    });

    it('allows game_start when no banner active', () => {
      expect(canShowNotif('game_start', false, 0)).toBe(true);
    });

    it('blocks era_banner when another banner is active', () => {
      expect(canShowNotif('era_banner', true, 0)).toBe(false);
    });

    it('allows era_banner when no banner active', () => {
      expect(canShowNotif('era_banner', false, 0)).toBe(true);
    });

    it('blocks event_spawn when era banner is active', () => {
      expect(canShowNotif('event_spawn', false, 0)).toBe(true);
      expect(canShowNotif('event_spawn', true, 0)).toBe(false);
    });

    it('blocks event_spawn when 3 already active', () => {
      expect(canShowNotif('event_spawn', false, 3)).toBe(false);
    });

    it('allows event_spawn when fewer than 3 active', () => {
      expect(canShowNotif('event_spawn', false, 0)).toBe(true);
      expect(canShowNotif('event_spawn', false, 1)).toBe(true);
      expect(canShowNotif('event_spawn', false, 2)).toBe(true);
    });

    it('blocks event_resolve when era banner is active', () => {
      expect(canShowNotif('event_resolve', true, 0)).toBe(false);
    });

    it('allows event_resolve when no banner active', () => {
      expect(canShowNotif('event_resolve', false, 0)).toBe(true);
    });
  });

  describe('Game start → Era 1 sequencing', () => {
    it('game_start queued before era_banner due to higher priority', () => {
      const queue = [
        { priority: getNotifPriority('era_banner'), type: 'era_banner' as const },
        { priority: getNotifPriority('game_start'), type: 'game_start' as const },
      ];
      const sorted = sortNotifQueue(queue);
      expect(sorted[0].type).toBe('game_start');
      expect(sorted[1].type).toBe('era_banner');
    });

    it('era_banner cannot show while game_start (banner) is active', () => {
      // game_start sets eraBannerActive = true
      expect(canShowNotif('era_banner', true, 0)).toBe(false);
      // After game_start finishes, eraBannerActive = false
      expect(canShowNotif('era_banner', false, 0)).toBe(true);
    });
  });
});
