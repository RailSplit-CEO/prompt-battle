import type { CrateDef, CrateTier } from '../types/store';

export const CRATE_DEFS: Record<CrateTier, CrateDef> = {
  bronze: {
    tier: 'bronze',
    name: 'Bronze Crate',
    icon: '\u{1F4E6}',
    priceCrowns: 50,
    priceGlory: 500,
    itemCount: 1,
    clicksRequired: 15,
    rarityWeights: { common: 60, rare: 30, epic: 9, legendary: 1 },
    eligibleCategories: [
      'emote', 'profile_title', 'profile_background', 'portrait_frame',
    ],
    currencyFallback: 25,
  },
  silver: {
    tier: 'silver',
    name: 'Silver Crate',
    icon: '\u{1F381}',
    priceCrowns: 150,
    priceGlory: 1500,
    itemCount: 2,
    clicksRequired: 25,
    rarityWeights: { common: 30, rare: 45, epic: 20, legendary: 5 },
    eligibleCategories: [
      'emote', 'profile_title', 'profile_background', 'portrait_frame',
      'unit_skin', 'voice_pack', 'cursor_pack', 'equipment_cosmetic',
    ],
    currencyFallback: 75,
  },
  gold: {
    tier: 'gold',
    name: 'Gold Crate',
    icon: '\u{1F451}',
    priceCrowns: 400,
    priceGlory: null,
    itemCount: 3,
    clicksRequired: 40,
    rarityWeights: { common: 0, rare: 30, epic: 50, legendary: 20 },
    eligibleCategories: [
      'emote', 'profile_title', 'profile_background', 'portrait_frame',
      'unit_skin', 'voice_pack', 'cursor_pack', 'equipment_cosmetic',
      'death_effect', 'spawn_effect', 'attack_trail', 'victory_effect',
      'building_theme', 'map_theme', 'ui_theme', 'voice_effect',
    ],
    currencyFallback: 200,
  },
};

export function getCrateDef(tier: CrateTier): CrateDef {
  return CRATE_DEFS[tier];
}
