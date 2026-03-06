import { ConsumableDefinition, ConsumableId } from '../types/game-state';

export const CONSUMABLES: Record<ConsumableId, ConsumableDefinition> = {
  siege_bomb: {
    id: 'siege_bomb',
    name: 'Siege Bomb',
    description: '40 AOE damage in 2-tile radius',
    icon: '\uD83D\uDCA3',
    category: 'combat',
  },
  smoke_bomb: {
    id: 'smoke_bomb',
    name: 'Smoke Bomb',
    description: 'Create 3-tile fog cloud for 8s, allies inside hidden',
    icon: '\uD83C\uDF2B\uFE0F',
    category: 'combat',
  },
  battle_horn: {
    id: 'battle_horn',
    name: 'Battle Horn',
    description: 'All allies +30% damage for 12s',
    icon: '\uD83D\uDCEF',
    category: 'combat',
  },
  haste_elixir: {
    id: 'haste_elixir',
    name: 'Haste Elixir',
    description: 'Double movement speed for 15s',
    icon: '\u26A1',
    category: 'personal',
  },
  iron_skin: {
    id: 'iron_skin',
    name: 'Iron Skin Potion',
    description: '+40% defense for 20s',
    icon: '\uD83D\uDEE1\uFE0F',
    category: 'personal',
  },
  vision_flare: {
    id: 'vision_flare',
    name: 'Vision Flare',
    description: 'Reveal entire map for 10s',
    icon: '\uD83D\uDD26',
    category: 'strategic',
  },
  rally_banner: {
    id: 'rally_banner',
    name: 'Rally Banner',
    description: 'All dead allies respawn 8s faster',
    icon: '\uD83D\uDEA9',
    category: 'strategic',
  },
  purge_scroll: {
    id: 'purge_scroll',
    name: 'Purge Scroll',
    description: 'Destroy all enemy barricades within 5 tiles',
    icon: '\uD83D\uDCDC',
    category: 'strategic',
  },
};

// Weighted random consumable from cache loot
const LOOT_TABLE: { id: ConsumableId; weight: number }[] = [
  { id: 'siege_bomb', weight: 12 },
  { id: 'smoke_bomb', weight: 10 },
  { id: 'battle_horn', weight: 10 },
  { id: 'haste_elixir', weight: 12 },
  { id: 'iron_skin', weight: 12 },
  { id: 'vision_flare', weight: 10 },
  { id: 'rally_banner', weight: 8 },
  { id: 'purge_scroll', weight: 8 },
];

const TOTAL_WEIGHT = LOOT_TABLE.reduce((s, e) => s + e.weight, 0);

export function rollRandomConsumable(): ConsumableId {
  let roll = Math.random() * TOTAL_WEIGHT;
  for (const entry of LOOT_TABLE) {
    roll -= entry.weight;
    if (roll <= 0) return entry.id;
  }
  return LOOT_TABLE[0].id;
}
