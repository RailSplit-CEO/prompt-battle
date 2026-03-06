import { CLASSES } from './classes';
import { Ability } from '../types/characters';

// Export all abilities as a flat lookup
export const ABILITIES: Record<string, Ability> = {};

for (const cls of Object.values(CLASSES)) {
  for (const ability of cls.abilities) {
    ABILITIES[ability.id] = ability;
  }
}

export function getAbilitiesForClass(classId: string): [Ability, Ability] {
  const cls = CLASSES[classId];
  if (!cls) throw new Error(`Unknown class: ${classId}`);
  return cls.abilities as [Ability, Ability];
}
