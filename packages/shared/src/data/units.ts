import { AnimalType, UnitRole } from '../types/game-state';

export interface UnitDefinition {
  type: AnimalType;
  name: string;
  emoji: string;
  role: UnitRole;
  tier: 1 | 2 | 3 | 4;
  // Base stats
  hp: number;
  attack: number;
  defense: number;
  speed: number;
  range: number;        // 1 = melee, 2+ = ranged
  // Timing
  attackInterval: number;  // ms between attacks
  // Special ability
  special?: UnitSpecial;
  // Counter tags
  tags: UnitTag[];
}

export type UnitTag = 'swift' | 'ranged' | 'melee' | 'tank' | 'healer' | 'aoe' | 'swarm' | 'dot' | 'support';

export type UnitSpecial =
  | { type: 'pack_bonus'; threshold: number; damageBonus: number }  // wolf: +15% when 3+
  | { type: 'heal_aura'; radius: number; healAmount: number; interval: number }  // goat
  | { type: 'poison_dot'; damage: number; duration: number }  // viper
  | { type: 'buff_aura'; radius: number; stat: 'speed' | 'attack'; amount: number }  // deer
  | { type: 'splash'; radius: number; damagePercent: number }  // elephant
  | { type: 'roar_stun'; radius: number; duration: number; cooldown: number };  // lion

// Counter multipliers: attacker tag vs defender tag
export const COUNTER_TABLE: Partial<Record<UnitTag, Partial<Record<UnitTag, number>>>> = {
  swift:  { ranged: 1.25 },           // swift beats ranged
  ranged: { tank: 1.25 },             // ranged beats tank
  tank:   { melee: 1.25 },            // tank beats melee DPS
  aoe:    { swarm: 1.40 },            // AoE beats swarms
};

// Damage multiplier when attacker has tag advantage over defender
export function getCounterMultiplier(attackerTags: UnitTag[], defenderTags: UnitTag[]): number {
  let best = 1.0;
  for (const atag of attackerTags) {
    const counters = COUNTER_TABLE[atag];
    if (!counters) continue;
    for (const dtag of defenderTags) {
      const mult = counters[dtag];
      if (mult && mult > best) best = mult;
    }
  }
  return best;
}

// ─── Unit Definitions ────────────────────────────────────

export const UNIT_DEFS: Record<AnimalType, UnitDefinition> = {
  // ── Tier 1: Near Base (Easy) ──
  rabbit: {
    type: 'rabbit',
    name: 'Rabbit',
    emoji: '🐇',
    role: 'swift_melee',
    tier: 1,
    hp: 25,
    attack: 8,
    defense: 2,
    speed: 5,
    range: 1,
    attackInterval: 1200,
    tags: ['swift', 'melee', 'swarm'],
  },
  parrot: {
    type: 'parrot',
    name: 'Parrot',
    emoji: '🦜',
    role: 'ranged',
    tier: 1,
    hp: 20,
    attack: 6,
    defense: 2,
    speed: 3,
    range: 4,
    attackInterval: 1800,
    tags: ['ranged'],
  },

  // ── Tier 2: Mid-Outer ──
  wolf: {
    type: 'wolf',
    name: 'Wolf',
    emoji: '🐺',
    role: 'melee_dps',
    tier: 2,
    hp: 40,
    attack: 14,
    defense: 5,
    speed: 4,
    range: 1,
    attackInterval: 1500,
    special: { type: 'pack_bonus', threshold: 3, damageBonus: 0.15 },
    tags: ['melee', 'swarm'],
  },
  falcon: {
    type: 'falcon',
    name: 'Falcon',
    emoji: '🦅',
    role: 'ranged_dps',
    tier: 2,
    hp: 30,
    attack: 12,
    defense: 3,
    speed: 5,
    range: 5,
    attackInterval: 1600,
    tags: ['swift', 'ranged'],
  },
  goat: {
    type: 'goat',
    name: 'Goat',
    emoji: '🐐',
    role: 'healer',
    tier: 2,
    hp: 35,
    attack: 5,
    defense: 6,
    speed: 3,
    range: 3,
    attackInterval: 2000,
    special: { type: 'heal_aura', radius: 3, healAmount: 4, interval: 2000 },
    tags: ['healer', 'support'],
  },

  // ── Tier 3: Mid-Inner ──
  bear: {
    type: 'bear',
    name: 'Bear',
    emoji: '🐻',
    role: 'tank',
    tier: 3,
    hp: 80,
    attack: 12,
    defense: 12,
    speed: 2,
    range: 1,
    attackInterval: 2000,
    tags: ['tank', 'melee'],
  },
  viper: {
    type: 'viper',
    name: 'Viper',
    emoji: '🐍',
    role: 'ranged_dot',
    tier: 3,
    hp: 30,
    attack: 10,
    defense: 4,
    speed: 3,
    range: 4,
    attackInterval: 1800,
    special: { type: 'poison_dot', damage: 3, duration: 4000 },
    tags: ['ranged', 'dot'],
  },
  deer: {
    type: 'deer',
    name: 'Deer',
    emoji: '🦌',
    role: 'support',
    tier: 3,
    hp: 35,
    attack: 6,
    defense: 5,
    speed: 4,
    range: 1,
    attackInterval: 2000,
    special: { type: 'buff_aura', radius: 3, stat: 'attack', amount: 0.15 },
    tags: ['swift', 'support'],
  },

  // ── Tier 4: Center (Hardest) ──
  elephant: {
    type: 'elephant',
    name: 'Elephant',
    emoji: '🐘',
    role: 'elite_tank',
    tier: 4,
    hp: 120,
    attack: 18,
    defense: 15,
    speed: 1,
    range: 1,
    attackInterval: 2500,
    special: { type: 'splash', radius: 2, damagePercent: 0.5 },
    tags: ['tank', 'aoe'],
  },
  lion: {
    type: 'lion',
    name: 'Lion',
    emoji: '🦁',
    role: 'elite_melee',
    tier: 4,
    hp: 70,
    attack: 22,
    defense: 8,
    speed: 4,
    range: 1,
    attackInterval: 1400,
    special: { type: 'roar_stun', radius: 2, duration: 1500, cooldown: 8000 },
    tags: ['melee', 'aoe'],
  },
};

// Helper to get scaled unit stats
export function getScaledUnitStats(def: UnitDefinition, scalingFactor: number, hpBonus: number = 0, atkBonus: number = 0) {
  return {
    maxHp: Math.round(def.hp * scalingFactor * (1 + hpBonus)),
    attack: Math.round(def.attack * scalingFactor * (1 + atkBonus)),
    defense: Math.round(def.defense * scalingFactor),
    speed: def.speed,
    range: def.range,
  };
}
