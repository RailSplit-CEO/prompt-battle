import { Position, Structure, UpgradeType } from '../types/game-state';

export interface StructureTemplate {
  name: string;
  upgradeType: UpgradeType;
  emoji: string;
  label: string;
  hp: number;
  attack: number;
  range: number;
}

export const STRUCTURE_TEMPLATES: StructureTemplate[] = [
  {
    name: 'Pummeling Pylon Palace',
    upgradeType: 'savage_strikes',
    emoji: '⚔️',
    label: 'Savage Strikes (+25% ATK)',
    hp: 300,
    attack: 12,
    range: 4,
  },
  {
    name: 'Stalwart Stone Stronghold',
    upgradeType: 'hardened_hides',
    emoji: '🛡️',
    label: 'Hardened Hides (+30% HP)',
    hp: 400,
    attack: 8,
    range: 3,
  },
  {
    name: 'Arcane Arrow Alcazar',
    upgradeType: 'mystic_missiles',
    emoji: '🏹',
    label: 'Mystic Missiles (melee→ranged)',
    hp: 250,
    attack: 15,
    range: 5,
  },
  {
    name: 'Thundering Titan Tower',
    upgradeType: 'rapid_reinforcements',
    emoji: '⏩',
    label: 'Rapid Reinforcements (2x spawn)',
    hp: 350,
    attack: 10,
    range: 4,
  },
];

// Structure positions on the map (50x40)
// Placed at strategic midpoints between bases
export interface StructurePlacement {
  templateIndex: number;
  position: Position;
}

export const STRUCTURE_PLACEMENTS: StructurePlacement[] = [
  { templateIndex: 0, position: { x: 15, y: 15 } },  // Pummeling Pylon Palace (blue quadrant)
  { templateIndex: 1, position: { x: 35, y: 25 } },  // Stalwart Stone Stronghold (red quadrant)
  { templateIndex: 2, position: { x: 35, y: 15 } },  // Arcane Arrow Alcazar (top-right)
  { templateIndex: 3, position: { x: 15, y: 25 } },  // Thundering Titan Tower (bottom-left)
];

let structureIdCounter = 0;

export function createStructure(template: StructureTemplate, position: Position): Structure {
  return {
    id: `structure_${structureIdCounter++}`,
    name: template.name,
    position,
    hp: template.hp,
    maxHp: template.hp,
    attack: template.attack,
    range: template.range,
    attackCooldown: 0,
    destroyedBy: null,
    upgradeType: template.upgradeType,
    emoji: template.emoji,
    label: template.label,
  };
}

export function createAllStructures(): Structure[] {
  structureIdCounter = 0;
  return STRUCTURE_PLACEMENTS.map(p => {
    const template = STRUCTURE_TEMPLATES[p.templateIndex];
    return createStructure(template, p.position);
  });
}
