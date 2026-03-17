// ─── DayNight.ts ───────────────────────────────────────────────
// Day/night cycle and shadow beast spawning.
// All pure simulation — no Phaser dependencies.
// ────────────────────────────────────────────────────────────────

import type { SimState, SimUnit } from './SimTypes';

import { DEFAULT_MODS } from './SimTypes';

import {
  ANIMALS,
  DAY_DURATION,
  NIGHT_DURATION,
  CYCLE_TOTAL,
  DUSK_WARNING,
  BLOOD_MOON_INTERVAL,
  P1_BASE,
  P2_BASE,
} from './Constants';

// ─── Helpers ──────────────────────────────────────────────────

function pdist2(a: { x: number; y: number }, b: { x: number; y: number }): number {
  const dx = a.x - b.x, dy = a.y - b.y;
  return dx * dx + dy * dy;
}

// ─── Public Query Helpers ─────────────────────────────────────

export function isNight(gameTime: number): boolean {
  const cyclePos = gameTime % CYCLE_TOTAL;
  return cyclePos >= DAY_DURATION;
}

export function isBloodMoon(gameTime: number, nightCount: number): boolean {
  return isNight(gameTime) && nightCount > 0 && nightCount % BLOOD_MOON_INTERVAL === 0;
}

export type DayNightPhase = 'day' | 'dusk' | 'night' | 'blood_moon';

export function getDayNightPhase(gameTime: number, nightCount: number): DayNightPhase {
  const cyclePos = gameTime % CYCLE_TOTAL;
  if (cyclePos >= DAY_DURATION) {
    return nightCount > 0 && nightCount % BLOOD_MOON_INTERVAL === 0 ? 'blood_moon' : 'night';
  }
  if (cyclePos > DAY_DURATION - DUSK_WARNING) return 'dusk';
  return 'day';
}

// ─── Main Update ──────────────────────────────────────────────

export function updateDayNight(delta: number, state: SimState): void {
  state.dayNightTimer += delta;
  const cyclePos = state.dayNightTimer % CYCLE_TOTAL;
  const wasNight = state.isNight;
  state.isNight = cyclePos >= DAY_DURATION;

  // Transition to night
  if (!wasNight && state.isNight) {
    state.nightCount++;
    state.isBloodMoon = state.nightCount % BLOOD_MOON_INTERVAL === 0;
    spawnShadowBeasts(state);
    state.duskWarned = false;
  }

  // Transition to day
  if (wasNight && !state.isNight) {
    state.isBloodMoon = false;
    // Despawn remaining shadow beasts
    for (const id of state.shadowBeasts) {
      const u = state.units.find(u => u.id === id && !u.dead);
      if (u) {
        u.hp = 0;
        u.dead = true;
      }
    }
    state.shadowBeasts = [];
  }

  // Dusk warning flag
  if (!state.isNight && cyclePos > DAY_DURATION - DUSK_WARNING && !state.duskWarned) {
    state.duskWarned = true;
  }
}

// ─── Shadow Beasts ────────────────────────────────────────────

export function spawnShadowBeasts(state: SimState): void {
  // Determine count based on era and blood moon
  let baseCount: number;
  if (state.currentEra <= 1) baseCount = 4;
  else if (state.currentEra === 2) baseCount = 6;
  else baseCount = 8;
  const count = state.isBloodMoon ? baseCount * 2 : baseCount;

  // Determine unit type based on era
  let beastType: string;
  if (state.currentEra <= 1) beastType = 'skull';
  else if (state.currentEra === 2) beastType = 'spider';
  else if (state.currentEra === 3) beastType = 'hyena';
  else beastType = 'panda';

  const def = ANIMALS[beastType];
  if (!def) return;

  state.shadowBeasts = [];

  for (let i = 0; i < count; i++) {
    // Random position in center area, avoiding bases
    let x: number, y: number;
    let tries = 0;
    do {
      x = 2000 + Math.random() * 2400;
      y = 2000 + Math.random() * 2400;
      tries++;
    } while (tries < 20 && (
      pdist2({ x, y }, P1_BASE) < 800 * 800 ||
      pdist2({ x, y }, P2_BASE) < 800 * 800
    ));

    const safe = state.findWalkableSpawn(x, y);
    x = safe.x; y = safe.y;

    const hpMult = state.isBloodMoon ? 1.5 : 1.0;
    state.units.push({
      id: state.nextId++, type: beastType, team: 0,
      hp: Math.round(def.hp * hpMult), maxHp: Math.round(def.hp * hpMult),
      attack: Math.round(def.attack * 1.2), speed: def.speed * 0.6,
      x, y, targetX: x + Math.random() * 80 - 40, targetY: y + Math.random() * 80 - 40,
      attackTimer: 0, dead: false, animState: 'idle' as const,
      campId: null, lungeX: 0, lungeY: 0,
      gnomeShield: 0, hasRebirth: beastType === 'skull', diveReady: false, diveTimer: 0,
      lastAttackTarget: -1, attackFaceX: null,
      prevSpriteX: 0, prevSpriteY: 0,
      pathWaypoints: null, pathAge: 0, pathTargetX: 0, pathTargetY: 0,
      lastCheckX: 0, lastCheckY: 0, stuckFrames: 0, stuckCooldown: 0, mods: { ...DEFAULT_MODS },
      carrying: null, loop: null, isElite: true, idleTimer: 0, claimItemId: -1,
      equipment: null, equipLevel: 0, equipVisualApplied: null,
    });
    state.shadowBeasts.push(state.nextId - 1);
  }

  // Blood moon boss: Nightmare at center
  if (state.isBloodMoon) {
    const bossDef = ANIMALS['minotaur'];
    if (bossDef) {
      const bx = 3200, by = 3200;
      const safe = state.findWalkableSpawn(bx, by);
      state.units.push({
        id: state.nextId++, type: 'minotaur', team: 0,
        hp: Math.round(bossDef.hp * 3), maxHp: Math.round(bossDef.hp * 3),
        attack: Math.round(bossDef.attack * 2), speed: bossDef.speed * 0.5,
        x: safe.x, y: safe.y, targetX: safe.x, targetY: safe.y,
        attackTimer: 0, dead: false, animState: 'idle' as const,
        campId: null, lungeX: 0, lungeY: 0,
        gnomeShield: 0, hasRebirth: false, diveReady: false, diveTimer: 0,
        lastAttackTarget: -1, attackFaceX: null,
        prevSpriteX: 0, prevSpriteY: 0,
        pathWaypoints: null, pathAge: 0, pathTargetX: 0, pathTargetY: 0,
        lastCheckX: 0, lastCheckY: 0, stuckFrames: 0, stuckCooldown: 0, mods: { ...DEFAULT_MODS },
        carrying: null, loop: null, isElite: true, idleTimer: 0, claimItemId: -1,
        equipment: null, equipLevel: 0, equipVisualApplied: null,
      });
      state.shadowBeasts.push(state.nextId - 1);
    }
  }
}
