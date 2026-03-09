import { AnimalType, CampTier, Position, Camp, CampGuard } from '../types/game-state';

export interface CampTemplate {
  name: string;
  animalType: AnimalType;
  tier: CampTier;
  emoji: string;
  // Guard configuration (neutral enemies to fight)
  guardCount: number;
  guardHp: number;
  guardAttack: number;
  guardDefense: number;
  guardRange: number;
  // Spawn rate (seconds between unit spawns once captured)
  spawnRate: number;
  // Vision provided when captured
  visionRange: number;
}

// ─── Camp Templates ──────────────────────────────────────
// Each side of the map gets a mirrored copy of these camps
// Names are alliterative for easy voice commands

export const CAMP_TEMPLATES: CampTemplate[] = [
  // ── Tier 1: Near Base (Easy) ──
  {
    name: 'Rowdy Rabbit Run',
    animalType: 'rabbit',
    tier: 1,
    emoji: '🐇',
    guardCount: 2,
    guardHp: 30,
    guardAttack: 6,
    guardDefense: 2,
    guardRange: 1,
    spawnRate: 8,
    visionRange: 5,
  },
  {
    name: 'Pecking Parrot Perch',
    animalType: 'parrot',
    tier: 1,
    emoji: '🦜',
    guardCount: 2,
    guardHp: 25,
    guardAttack: 5,
    guardDefense: 2,
    guardRange: 3,
    spawnRate: 10,
    visionRange: 6,
  },

  // ── Tier 2: Mid-Outer ──
  {
    name: 'Wily Wolf Warren',
    animalType: 'wolf',
    tier: 2,
    emoji: '🐺',
    guardCount: 3,
    guardHp: 45,
    guardAttack: 10,
    guardDefense: 5,
    guardRange: 1,
    spawnRate: 12,
    visionRange: 5,
  },
  {
    name: 'Fierce Falcon Fort',
    animalType: 'falcon',
    tier: 2,
    emoji: '🦅',
    guardCount: 3,
    guardHp: 35,
    guardAttack: 9,
    guardDefense: 3,
    guardRange: 4,
    spawnRate: 12,
    visionRange: 7,
  },
  {
    name: 'Gentle Goat Grove',
    animalType: 'goat',
    tier: 2,
    emoji: '🐐',
    guardCount: 3,
    guardHp: 50,
    guardAttack: 7,
    guardDefense: 6,
    guardRange: 2,
    spawnRate: 14,
    visionRange: 5,
  },

  // ── Tier 3: Mid-Inner (Contested) ──
  {
    name: 'Brutal Bear Bastion',
    animalType: 'bear',
    tier: 3,
    emoji: '🐻',
    guardCount: 3,
    guardHp: 80,
    guardAttack: 14,
    guardDefense: 10,
    guardRange: 1,
    spawnRate: 16,
    visionRange: 5,
  },
  {
    name: 'Venomous Viper Vault',
    animalType: 'viper',
    tier: 3,
    emoji: '🐍',
    guardCount: 4,
    guardHp: 40,
    guardAttack: 12,
    guardDefense: 5,
    guardRange: 3,
    spawnRate: 14,
    visionRange: 6,
  },
  {
    name: 'Deft Deer Dell',
    animalType: 'deer',
    tier: 3,
    emoji: '🦌',
    guardCount: 3,
    guardHp: 50,
    guardAttack: 10,
    guardDefense: 6,
    guardRange: 1,
    spawnRate: 14,
    visionRange: 5,
  },

  // ── Tier 4: Center (Hardest) ──
  {
    name: 'Enormous Elephant Estate',
    animalType: 'elephant',
    tier: 4,
    emoji: '🐘',
    guardCount: 3,
    guardHp: 120,
    guardAttack: 18,
    guardDefense: 14,
    guardRange: 1,
    spawnRate: 20,
    visionRange: 5,
  },
  {
    name: 'Lethal Lion Lair',
    animalType: 'lion',
    tier: 4,
    emoji: '🦁',
    guardCount: 4,
    guardHp: 70,
    guardAttack: 20,
    guardDefense: 8,
    guardRange: 1,
    spawnRate: 18,
    visionRange: 6,
  },
];

// ─── Map Positions ───────────────────────────────────────
// Symmetric positions for a ~50x40 map
// Player 1 (blue) base at bottom-left, Player 2 (red) base at top-right
// Camps are mirrored: blue side camps at (x,y), red side at (mapW-x, mapH-y)

export interface CampPlacement {
  templateIndex: number;  // index into CAMP_TEMPLATES
  bluePos: Position;      // position on blue (player1) side
  redPos: Position;       // mirrored position on red (player2) side
}

// Map is 50x40, blue base at (5,35), red base at (45,5)
export const CAMP_PLACEMENTS: CampPlacement[] = [
  // Tier 1: Near bases
  { templateIndex: 0, bluePos: { x: 10, y: 30 }, redPos: { x: 40, y: 10 } },  // Rabbit
  { templateIndex: 1, bluePos: { x: 14, y: 33 }, redPos: { x: 36, y: 7 } },   // Parrot

  // Tier 2: Mid-outer (each side)
  { templateIndex: 2, bluePos: { x: 12, y: 25 }, redPos: { x: 38, y: 15 } },  // Wolf
  { templateIndex: 3, bluePos: { x: 18, y: 28 }, redPos: { x: 32, y: 12 } },  // Falcon
  { templateIndex: 4, bluePos: { x: 8, y: 22 }, redPos: { x: 42, y: 18 } },   // Goat

  // Tier 3: Contested center area
  { templateIndex: 5, bluePos: { x: 18, y: 22 }, redPos: { x: 32, y: 18 } },  // Bear
  { templateIndex: 6, bluePos: { x: 22, y: 18 }, redPos: { x: 28, y: 22 } },  // Viper
  { templateIndex: 7, bluePos: { x: 15, y: 18 }, redPos: { x: 35, y: 22 } },  // Deer

  // Tier 4: Dead center
  { templateIndex: 8, bluePos: { x: 22, y: 22 }, redPos: { x: 28, y: 18 } },  // Elephant
  { templateIndex: 9, bluePos: { x: 25, y: 18 }, redPos: { x: 25, y: 22 } },  // Lion
];

// ─── Helper: Create camp instances from templates ────────

let campIdCounter = 0;

export function createCampFromTemplate(
  template: CampTemplate,
  position: Position,
  side: 'blue' | 'red',
  scalingFactor: number = 1.0,
): Camp {
  const campId = `camp_${side}_${template.animalType}_${campIdCounter++}`;

  const guards: CampGuard[] = [];
  for (let i = 0; i < template.guardCount; i++) {
    const guardOffset = i - Math.floor(template.guardCount / 2);
    guards.push({
      id: `${campId}_guard_${i}`,
      hp: Math.round(template.guardHp * scalingFactor),
      maxHp: Math.round(template.guardHp * scalingFactor),
      attack: Math.round(template.guardAttack * scalingFactor),
      defense: Math.round(template.guardDefense * scalingFactor),
      range: template.guardRange,
      position: { x: position.x + guardOffset, y: position.y },
      isDead: false,
      attackCooldown: 0,
    });
  }

  return {
    id: campId,
    name: `${side === 'red' ? template.name.replace(template.name.split(' ')[0], template.name.split(' ')[0]) : template.name}`,
    position,
    tier: template.tier,
    animalType: template.animalType,
    emoji: template.emoji,
    guards,
    guardRespawnTimer: 0,
    capturedBy: null,
    capturedTeam: null,
    spawnTimer: 0,
    spawnRate: template.spawnRate,
    scalingFactor,
    visionRange: template.visionRange,
  };
}

// Create all camps for both sides
export function createAllCamps(): Camp[] {
  campIdCounter = 0;
  const camps: Camp[] = [];

  for (const placement of CAMP_PLACEMENTS) {
    const template = CAMP_TEMPLATES[placement.templateIndex];
    camps.push(createCampFromTemplate(template, placement.bluePos, 'blue'));
    camps.push(createCampFromTemplate(template, placement.redPos, 'red'));
  }

  return camps;
}
