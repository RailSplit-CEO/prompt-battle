export type ClassId =
  | 'warrior' | 'mage' | 'archer' | 'healer'
  | 'rogue' | 'paladin' | 'necromancer' | 'bard';

export type AnimalId =
  | 'wolf' | 'lion' | 'bear' | 'tiger' | 'eagle'
  | 'turtle' | 'rhino' | 'elephant' | 'armadillo' | 'crab'
  | 'cheetah' | 'falcon' | 'hare' | 'fox' | 'horse'
  | 'owl' | 'raven' | 'phoenix' | 'dragon' | 'serpent'
  | 'chameleon' | 'spider' | 'scorpion' | 'bat' | 'cat';

export type AnimalArchetype = 'power' | 'defense' | 'speed' | 'magic' | 'utility';

export interface Stats {
  hp: number;
  attack: number;
  defense: number;
  speed: number;
  range: number;
  magic: number;
}

export interface Ability {
  id: string;
  name: string;
  description: string;
  cooldown: number;
  range: number;
  damage?: number;
  healing?: number;
  effect?: AbilityEffect;
}

export type AbilityEffect =
  | { type: 'stun'; duration: number }
  | { type: 'slow'; factor: number; duration: number }
  | { type: 'dot'; damage: number; duration: number }
  | { type: 'shield'; amount: number; duration: number }
  | { type: 'buff'; stat: keyof Stats; amount: number; duration: number }
  | { type: 'debuff'; stat: keyof Stats; amount: number; duration: number }
  | { type: 'summon'; unitId: string; duration: number }
  | { type: 'teleport' }
  | { type: 'stealth'; duration: number }
  | { type: 'aoe'; radius: number };

export interface ClassDefinition {
  id: ClassId;
  name: string;
  description: string;
  baseStats: Stats;
  abilities: Ability[];
  role: 'tank' | 'dps' | 'support' | 'assassin';
}

export interface AnimalDefinition {
  id: AnimalId;
  name: string;
  archetype: AnimalArchetype;
  statModifiers: Stats;
  vision: number;
  passive: {
    name: string;
    description: string;
  };
}

export interface CharacterBuild {
  classId: ClassId;
  animalId: AnimalId;
}

export function computeStats(baseStats: Stats, modifiers: Stats): Stats {
  return {
    hp: Math.round(baseStats.hp * modifiers.hp),
    attack: Math.round(baseStats.attack * modifiers.attack),
    defense: Math.round(baseStats.defense * modifiers.defense),
    speed: Math.round(baseStats.speed * modifiers.speed),
    range: Math.round(baseStats.range * modifiers.range),
    magic: Math.round(baseStats.magic * modifiers.magic),
  };
}
