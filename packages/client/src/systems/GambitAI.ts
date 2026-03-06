import { Character, CharacterOrder, ClassId, Position } from '@prompt-battle/shared';

// ─── Context passed to the Gambit AI each tick ──────────────────
export interface GambitContext {
  char: Character;
  allies: Character[];
  enemies: Character[];
  activeHeroId: string | null;
  gold: number;
  gamePhase: number;
  minePositions: Position[];
  healingWellPos?: Position;
  basePosition: Position;
  tileAt: (x: number, y: number) => string;
}

// ─── Helpers ────────────────────────────────────────────────────

function tileDist(a: Position, b: Position): number {
  return Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
}

function findNearestEnemy(pos: Position, enemies: Character[]): Character | null {
  let best: Character | null = null;
  let bestDist = Infinity;
  for (const e of enemies) {
    if (e.isDead) continue;
    const d = tileDist(pos, e.position);
    if (d < bestDist) { bestDist = d; best = e; }
  }
  return best;
}

function findLowestHpAlly(allies: Character[]): Character | null {
  let best: Character | null = null;
  let bestPct = Infinity;
  for (const a of allies) {
    if (a.isDead) continue;
    const pct = a.currentHp / a.stats.hp;
    if (pct < bestPct) { bestPct = pct; best = a; }
  }
  return best;
}

function isInRange(attacker: Character, target: Character): boolean {
  return tileDist(attacker.position, target.position) <= attacker.stats.range;
}

function findNearestPosition(from: Position, positions: Position[]): Position | null {
  let best: Position | null = null;
  let bestDist = Infinity;
  for (const p of positions) {
    const d = tileDist(from, p);
    if (d < bestDist) { bestDist = d; best = p; }
  }
  return best;
}

// ─── Default class behaviors ────────────────────────────────────

function defaultBehavior(ctx: GambitContext): CharacterOrder | null {
  const { char, allies, enemies, activeHeroId, tileAt } = ctx;

  switch (char.classId) {
    // Warrior: charge nearest enemy, tank hits
    case 'warrior': {
      const nearest = findNearestEnemy(char.position, enemies);
      if (nearest && tileDist(char.position, nearest.position) <= 5) {
        return { type: 'attack', targetCharacterId: nearest.id };
      }
      return { type: 'hold' };
    }

    // Mage: stay at range, cast abilities on nearest enemy
    case 'mage': {
      const target = enemies.find(
        e => !e.isDead && tileDist(char.position, e.position) <= char.stats.range,
      );
      if (target) {
        const abilityReady = Object.entries(char.cooldowns).find(([, cd]) => cd === 0);
        if (abilityReady) {
          return { type: 'ability', abilityId: abilityReady[0], targetPosition: target.position };
        }
        return { type: 'attack', targetCharacterId: target.id };
      }
      return { type: 'hold' };
    }

    // Archer: kite from range, attack furthest reachable enemy
    case 'archer': {
      const inRange = enemies.filter(
        e => !e.isDead && tileDist(char.position, e.position) <= char.stats.range,
      );
      if (inRange.length > 0) {
        // Pick the one furthest away (stay at max range)
        inRange.sort((a, b) => tileDist(char.position, b.position) - tileDist(char.position, a.position));
        return { type: 'attack', targetCharacterId: inRange[0].id };
      }
      return { type: 'hold' };
    }

    // Healer: follow lowest HP ally, heal if ability ready
    case 'healer': {
      const weakest = findLowestHpAlly(allies.filter(a => a.id !== char.id));
      const abilityReady = Object.entries(char.cooldowns).find(([, cd]) => cd === 0);
      if (weakest && weakest.currentHp < weakest.stats.hp && abilityReady) {
        return { type: 'ability', abilityId: abilityReady[0], targetCharacterId: weakest.id };
      }
      if (weakest && weakest.currentHp / weakest.stats.hp < 0.7) {
        return { type: 'escort', targetCharacterId: weakest.id };
      }
      return { type: 'hold' };
    }

    // Rogue: patrol between cover positions, stealth if available
    case 'rogue': {
      const coverPositions: Position[] = [];
      for (let dx = -5; dx <= 5; dx++) {
        for (let dy = -5; dy <= 5; dy++) {
          const tx = char.position.x + dx;
          const ty = char.position.y + dy;
          const tile = tileAt(tx, ty);
          if (tile === 'bush' || tile === 'forest') {
            coverPositions.push({ x: tx, y: ty });
          }
        }
      }
      const nearby = enemies.find(
        e => !e.isDead && tileDist(char.position, e.position) <= 3,
      );
      if (nearby) return { type: 'attack', targetCharacterId: nearby.id };
      const patrolTarget = findNearestPosition(char.position, coverPositions);
      if (patrolTarget && tileDist(char.position, patrolTarget) > 0) {
        return { type: 'patrol', targetPosition: patrolTarget };
      }
      return { type: 'hold' };
    }

    // Paladin: defend injured allies, heal aura if ready
    case 'paladin': {
      const abilityReady = Object.entries(char.cooldowns).find(([, cd]) => cd === 0);
      if (abilityReady) {
        const injured = allies.find(a => !a.isDead && a.currentHp < a.stats.hp);
        if (injured) return { type: 'ability', abilityId: abilityReady[0] };
      }
      const weakest = findLowestHpAlly(allies.filter(a => a.id !== char.id));
      if (weakest && weakest.currentHp / weakest.stats.hp < 0.7) {
        return { type: 'defend', targetCharacterId: weakest.id };
      }
      return { type: 'hold' };
    }

    // Necromancer: stay back, cast abilities, attack from range
    case 'necromancer': {
      const target = enemies.find(
        e => !e.isDead && tileDist(char.position, e.position) <= char.stats.range,
      );
      if (target) {
        const abilityReady = Object.entries(char.cooldowns).find(([, cd]) => cd === 0);
        if (abilityReady) {
          return { type: 'ability', abilityId: abilityReady[0], targetPosition: target.position };
        }
        return { type: 'attack', targetCharacterId: target.id };
      }
      return { type: 'hold' };
    }

    // Bard: follow active hero, buff allies
    case 'bard': {
      const activeHero = activeHeroId
        ? allies.find(a => a.id === activeHeroId && !a.isDead)
        : null;
      const abilityReady = Object.entries(char.cooldowns).find(([, cd]) => cd === 0);
      if (abilityReady) {
        return { type: 'ability', abilityId: abilityReady[0] };
      }
      if (activeHero) return { type: 'escort', targetCharacterId: activeHero.id };
      return { type: 'hold' };
    }

    default:
      return { type: 'hold' };
  }
}

// ─── Main Gambit evaluator ──────────────────────────────────────

export function getGambitOrder(ctx: GambitContext): CharacterOrder | null {
  const { char, enemies, gold, minePositions, healingWellPos, basePosition } = ctx;

  // Skip dead characters or the WASD-controlled hero
  if (char.isDead || char.isActiveHero) return null;

  const hpPct = char.currentHp / char.stats.hp;

  // 1. IF HP < 30% -> RETREAT toward healing well or base
  if (hpPct < 0.3) {
    const retreatTarget = healingWellPos ?? basePosition;
    return { type: 'retreat', targetPosition: retreatTarget };
  }

  // 2. IF enemy in attack range -> ATTACK highest threat enemy
  const inRange = enemies.filter(e => !e.isDead && isInRange(char, e));
  if (inRange.length > 0) {
    // Highest threat = highest attack stat among those in range
    inRange.sort((a, b) => b.stats.attack - a.stats.attack);
    return { type: 'attack', targetCharacterId: inRange[0].id };
  }

  // 3. IF has active order from player -> EXECUTE that order (keep it)
  if (char.currentOrder && char.currentOrder.type !== 'hold') {
    return null; // null = keep current order
  }

  // 4. IF nearby mine available and team gold < 500 -> GO MINE
  if (gold < 500 && minePositions.length > 0) {
    const nearestMine = findNearestPosition(char.position, minePositions);
    if (nearestMine && tileDist(char.position, nearestMine) <= 10) {
      return { type: 'mine', targetPosition: nearestMine };
    }
  }

  // 5. IF idle -> DEFAULT CLASS BEHAVIOR
  return defaultBehavior(ctx);
}
