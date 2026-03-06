import { ClassDefinition } from '../types/characters';

export const CLASSES: Record<string, ClassDefinition> = {
  warrior: {
    id: 'warrior',
    name: 'Warrior',
    description: 'Heavily armored frontline fighter.',
    role: 'tank',
    baseStats: { hp: 150, attack: 25, defense: 20, speed: 3, range: 1, magic: 5 },
    abilities: [
      {
        id: 'shield_bash',
        name: 'Shield Bash',
        description: 'Stun an enemy for 3s.',
        cooldown: 8,
        range: 1,
        damage: 25,
        effect: { type: 'stun', duration: 3 },
      },
    ],
  },
  mage: {
    id: 'mage',
    name: 'Mage',
    description: 'Devastating ranged magic damage.',
    role: 'dps',
    baseStats: { hp: 80, attack: 10, defense: 8, speed: 3, range: 5, magic: 35 },
    abilities: [
      {
        id: 'fireball',
        name: 'Fireball',
        description: 'Hurl a fireball that deals heavy magic damage.',
        cooldown: 6,
        range: 5,
        damage: 45,
      },
    ],
  },
  archer: {
    id: 'archer',
    name: 'Archer',
    description: 'Nimble ranged attacker with long reach.',
    role: 'dps',
    baseStats: { hp: 90, attack: 30, defense: 10, speed: 4, range: 6, magic: 5 },
    abilities: [
      {
        id: 'piercing_shot',
        name: 'Piercing Shot',
        description: 'Fire a devastating arrow at extreme range.',
        cooldown: 5,
        range: 7,
        damage: 40,
      },
    ],
  },
  healer: {
    id: 'healer',
    name: 'Healer',
    description: 'Keeps allies alive with restorative magic.',
    role: 'support',
    baseStats: { hp: 90, attack: 8, defense: 12, speed: 3, range: 4, magic: 30 },
    abilities: [
      {
        id: 'heal',
        name: 'Healing Light',
        description: 'Restore 40 HP to an ally.',
        cooldown: 5,
        range: 4,
        healing: 40,
      },
    ],
  },
  rogue: {
    id: 'rogue',
    name: 'Rogue',
    description: 'Stealthy assassin with massive burst damage.',
    role: 'assassin',
    baseStats: { hp: 85, attack: 35, defense: 8, speed: 5, range: 1, magic: 10 },
    abilities: [
      {
        id: 'backstab',
        name: 'Backstab',
        description: 'Strike from the shadows for 60 damage.',
        cooldown: 7,
        range: 1,
        damage: 60,
      },
    ],
  },
  paladin: {
    id: 'paladin',
    name: 'Paladin',
    description: 'Holy warrior who deals damage and heals.',
    role: 'tank',
    baseStats: { hp: 130, attack: 20, defense: 18, speed: 3, range: 1, magic: 20 },
    abilities: [
      {
        id: 'smite',
        name: 'Divine Smite',
        description: 'Deal 30 holy damage and heal self for 20.',
        cooldown: 7,
        range: 1,
        damage: 30,
        healing: 20,
      },
    ],
  },
  necromancer: {
    id: 'necromancer',
    name: 'Necromancer',
    description: 'Dark caster who drains life from enemies.',
    role: 'dps',
    baseStats: { hp: 85, attack: 12, defense: 10, speed: 3, range: 4, magic: 32 },
    abilities: [
      {
        id: 'drain_life',
        name: 'Drain Life',
        description: 'Deal 30 damage and heal self for 20.',
        cooldown: 5,
        range: 4,
        damage: 30,
        healing: 20,
      },
    ],
  },
  bard: {
    id: 'bard',
    name: 'Bard',
    description: 'Performer who damages and slows enemies.',
    role: 'support',
    baseStats: { hp: 95, attack: 15, defense: 10, speed: 4, range: 3, magic: 25 },
    abilities: [
      {
        id: 'discord',
        name: 'Discordant Note',
        description: 'Deal 20 damage and slow enemy 50% for 4s.',
        cooldown: 6,
        range: 4,
        damage: 20,
        effect: { type: 'slow', factor: 0.5, duration: 4 },
      },
    ],
  },
};
