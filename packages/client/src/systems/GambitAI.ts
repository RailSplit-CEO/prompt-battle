// ═══════════════════════════════════════════════════════
// ANIMAL ARMY - Gambit AI System
// Auto-controls player 2's heroes with priority-based decisions
// ═══════════════════════════════════════════════════════

import { Hero, HeroOrder, Camp, Structure, AnimalUnit, Position } from '@prompt-battle/shared';

// ─── Context passed to the AI for each hero decision ───

export interface GambitContext {
  hero: Hero;
  allies: Hero[];           // alive allied heroes
  enemies: Hero[];          // alive enemy heroes
  camps: Camp[];
  structures: Structure[];
  units: AnimalUnit[];      // all units on the map
  enemyBasePos: Position;
  ownBasePos: Position;
  gameTime: number;         // elapsed seconds
}

// ─── Helpers ────────────────────────────────────────────

/** Manhattan distance between two positions. */
export function tileDist(a: Position, b: Position): number {
  return Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
}

/** Count alive units owned by a specific hero. */
function heroArmySize(heroId: string, units: AnimalUnit[]): number {
  return units.filter(u => u.ownerId === heroId && !u.isDead).length;
}

/** Find the nearest item from a list using Manhattan distance. */
function nearest<T extends { position: Position }>(
  from: Position,
  items: T[],
): T | null {
  let best: T | null = null;
  let bestDist = Infinity;
  for (const item of items) {
    const d = tileDist(from, item.position);
    if (d < bestDist) {
      bestDist = d;
      best = item;
    }
  }
  return best;
}

/** Find the enemy hero with the lowest HP that is within a given range. */
function lowestHpEnemyInRange(
  hero: Hero,
  enemies: Hero[],
  range: number,
): Hero | null {
  let best: Hero | null = null;
  let bestHp = Infinity;
  for (const e of enemies) {
    if (e.isDead) continue;
    const d = tileDist(hero.position, e.position);
    if (d <= range && e.currentHp < bestHp) {
      bestHp = e.currentHp;
      best = e;
    }
  }
  return best;
}

/** Get structures that are still alive and not already destroyed by our team. */
function attackableStructures(
  structures: Structure[],
  heroTeam: 'player1' | 'player2',
): Structure[] {
  return structures.filter(s => s.hp > 0 && s.destroyedBy !== heroTeam);
}

/** Get camps that are not captured by our team. */
function uncapturedCamps(
  camps: Camp[],
  heroTeam: 'player1' | 'player2',
): Camp[] {
  return camps.filter(c => c.capturedTeam !== heroTeam);
}

// ─── Tuning Constants ───────────────────────────────────

const ENGAGE_RANGE = 8;          // tiles to spot an enemy hero
const ARMY_THRESHOLD = 5;        // units needed to consider "has an army"
const LOW_HP_PERCENT = 0.30;     // 30% HP threshold for retreat
const STRUCTURE_PUSH_RANGE = 12; // look for structures within this range when pushing

// ─── Main AI Decision Function ──────────────────────────

/**
 * Returns the next order for a hero controlled by the Gambit AI.
 * Returns null if the hero is dead or no action change is needed.
 *
 * Priority:
 *  1. Low HP (< 30%) -> Retreat toward own base
 *  2. Enemy hero in engage range -> Attack lowest HP enemy
 *  3. Has army (5+ units) -> Push structures / enemy base
 *  4. Nearby uncaptured camp -> Attack it (prefer lower tier)
 *  5. Default -> Move toward nearest uncaptured camp
 */
export function getGambitOrder(ctx: GambitContext): HeroOrder | null {
  const { hero, enemies, camps, structures, units, enemyBasePos, ownBasePos } = ctx;

  // Dead heroes do nothing
  if (hero.isDead) return null;

  const hpPercent = hero.currentHp / hero.maxHp;
  const armySize = heroArmySize(hero.id, units);

  // ── Priority 1: Low HP -> Retreat ──────────────────────
  if (hpPercent < LOW_HP_PERCENT) {
    return {
      type: 'retreat',
      targetPosition: ownBasePos,
    };
  }

  // ── Priority 2: Enemy hero in range -> Attack ──────────
  const target = lowestHpEnemyInRange(hero, enemies, ENGAGE_RANGE);
  if (target) {
    return {
      type: 'attack_hero',
      targetId: target.id,
      targetPosition: target.position,
    };
  }

  // ── Priority 3: Has army -> Push toward enemy ──────────
  if (armySize >= ARMY_THRESHOLD) {
    // Look for nearby enemy structures to destroy first
    const enemyStructures = attackableStructures(structures, hero.team);
    const nearestStructure = nearest(hero.position, enemyStructures);

    if (nearestStructure && tileDist(hero.position, nearestStructure.position) <= STRUCTURE_PUSH_RANGE) {
      return {
        type: 'attack_structure',
        targetId: nearestStructure.id,
        targetPosition: nearestStructure.position,
      };
    }

    // No nearby structures -- push toward enemy base
    return {
      type: 'attack_base',
      targetPosition: enemyBasePos,
    };
  }

  // ── Priority 4: Nearby uncaptured camp -> Capture ──────
  const available = uncapturedCamps(camps, hero.team);

  if (available.length > 0) {
    // Prefer lower tier camps (easier to capture), break ties by distance
    const sorted = [...available].sort((a, b) => {
      const tierDiff = a.tier - b.tier;
      if (tierDiff !== 0) return tierDiff;
      return tileDist(hero.position, a.position) - tileDist(hero.position, b.position);
    });

    const bestCamp = sorted[0];

    return {
      type: 'attack_camp',
      targetId: bestCamp.id,
      targetPosition: bestCamp.position,
    };
  }

  // ── Priority 5: Default -> Move toward nearest camp ────
  // All camps captured by our team; roam toward a camp anyway
  const anyCamp = nearest(hero.position, camps);
  if (anyCamp) {
    return {
      type: 'move',
      targetPosition: anyCamp.position,
    };
  }

  // Nothing to do -- hold position
  return {
    type: 'hold',
  };
}
