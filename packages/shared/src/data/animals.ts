import { AnimalDefinition } from '../types/characters';

// Week 1 scope: 10 animals (2 per archetype)
// Post-launch: expand to 25
export const ANIMALS: Record<string, AnimalDefinition> = {
  // Power archetype
  wolf: {
    id: 'wolf',
    name: 'Wolf',
    archetype: 'power',
    statModifiers: { hp: 1.0, attack: 1.3, defense: 0.9, speed: 1.1, range: 1.0, magic: 0.8 },
    passive: { name: 'Pack Hunter', description: 'Deal 20% more damage when an ally is adjacent to the target.' },
  },
  lion: {
    id: 'lion',
    name: 'Lion',
    archetype: 'power',
    statModifiers: { hp: 1.1, attack: 1.4, defense: 1.0, speed: 1.0, range: 1.0, magic: 0.7 },
    passive: { name: 'Roar', description: 'First attack each combat round intimidates the target, reducing their attack by 10% for 1 turn.' },
  },
  // Defense archetype
  turtle: {
    id: 'turtle',
    name: 'Turtle',
    archetype: 'defense',
    statModifiers: { hp: 1.3, attack: 0.8, defense: 1.4, speed: 0.7, range: 1.0, magic: 0.9 },
    passive: { name: 'Shell Guard', description: 'When below 30% HP, gain +50% defense.' },
  },
  elephant: {
    id: 'elephant',
    name: 'Elephant',
    archetype: 'defense',
    statModifiers: { hp: 1.4, attack: 1.0, defense: 1.2, speed: 0.7, range: 1.0, magic: 0.8 },
    passive: { name: 'Thick Skin', description: 'Reduce all incoming damage by 3 (flat).' },
  },
  // Speed archetype
  cheetah: {
    id: 'cheetah',
    name: 'Cheetah',
    archetype: 'speed',
    statModifiers: { hp: 0.8, attack: 1.1, defense: 0.8, speed: 1.4, range: 1.0, magic: 0.9 },
    passive: { name: 'Sprint', description: 'First move each turn has double speed.' },
  },
  falcon: {
    id: 'falcon',
    name: 'Falcon',
    archetype: 'speed',
    statModifiers: { hp: 0.8, attack: 1.2, defense: 0.7, speed: 1.3, range: 1.2, magic: 1.0 },
    passive: { name: 'Dive', description: 'Attacks from 3+ tiles away deal 25% bonus damage.' },
  },
  // Magic archetype
  owl: {
    id: 'owl',
    name: 'Owl',
    archetype: 'magic',
    statModifiers: { hp: 0.9, attack: 0.8, defense: 0.9, speed: 1.0, range: 1.2, magic: 1.3 },
    passive: { name: 'Wisdom', description: 'Ability cooldowns reduced by 1 turn.' },
  },
  phoenix: {
    id: 'phoenix',
    name: 'Phoenix',
    archetype: 'magic',
    statModifiers: { hp: 0.9, attack: 0.9, defense: 0.8, speed: 1.1, range: 1.1, magic: 1.4 },
    passive: { name: 'Rebirth', description: 'Once per game, revive with 30% HP upon death.' },
  },
  // Utility archetype
  chameleon: {
    id: 'chameleon',
    name: 'Chameleon',
    archetype: 'utility',
    statModifiers: { hp: 0.9, attack: 1.0, defense: 1.0, speed: 1.0, range: 1.0, magic: 1.1 },
    passive: { name: 'Camouflage', description: 'When standing still for 1 turn, become hidden until you act.' },
  },
  spider: {
    id: 'spider',
    name: 'Spider',
    archetype: 'utility',
    statModifiers: { hp: 0.8, attack: 1.1, defense: 0.9, speed: 1.1, range: 1.1, magic: 1.0 },
    passive: { name: 'Web Trap', description: 'Leaving a tile has a 30% chance to leave a web that slows enemies passing through.' },
  },
};
