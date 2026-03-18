// ─── Store / Monetization Types ─────────────────────────────────

export type ItemCategory =
  | 'unit_skin'
  | 'avatar_portrait'
  | 'portrait_frame'
  | 'voice_pack'
  | 'voice_effect'
  | 'equipment_cosmetic'
  | 'building_theme'
  | 'map_theme'
  | 'death_effect'
  | 'spawn_effect'
  | 'attack_trail'
  | 'victory_effect'
  | 'emote'
  | 'profile_title'
  | 'profile_border'
  | 'profile_background'
  | 'cursor_pack'
  | 'ui_theme'
  | 'booster';

export type Rarity = 'common' | 'rare' | 'epic' | 'legendary';

export type CrateTier = 'bronze' | 'silver' | 'gold';

export type HordeUnitType =
  | 'gnome' | 'snake' | 'turtle' | 'skull' | 'spider' | 'hyena'
  | 'rogue' | 'panda' | 'lizard' | 'bear' | 'harpoon_fish'
  | 'minotaur' | 'shaman' | 'troll';

export const HORDE_UNIT_TYPES: HordeUnitType[] = [
  'gnome', 'snake', 'turtle', 'skull', 'spider', 'hyena',
  'rogue', 'panda', 'lizard', 'bear', 'harpoon_fish',
  'minotaur', 'shaman', 'troll',
];

// EquipmentType is re-exported from data/maps.ts — use that definition
// Re-import here for convenience within store types
import type { EquipmentType } from '../data/maps';
export type { EquipmentType } from '../data/maps';

// ─── Catalog Item ───────────────────────────────────────────────

export interface CatalogItem {
  id: string;
  category: ItemCategory;
  name: string;
  description: string;
  rarity: Rarity;
  priceCrowns: number;
  priceGlory: number | null;       // null = crowns-only
  previewAsset?: string;            // path to preview image
  unitType?: HordeUnitType;         // for unit-specific items
  equipType?: EquipmentType;        // for equipment-specific items
  seasonal?: string;                // e.g. 'winter_2026', undefined if permanent
  limited?: boolean;                // limited-time availability
  battlePassExclusive?: boolean;    // only obtainable via battle pass
  voiceId?: string;                 // ElevenLabs voice ID override for voice packs
  sampleText?: string;              // Text for audio preview generation
  personality?: string;             // Gemini personality prompt override for voice packs
}

// ─── Crown Packages (real-money purchases) ──────────────────────

export interface CrownPackage {
  id: string;
  name: string;
  crowns: number;
  priceUSD: number;                 // in dollars
  bonusPercent: number;             // e.g. 20 for 20% bonus
  icon: string;                     // emoji or asset key
}

// ─── Bundles (real-money or crown purchases) ────────────────────

export interface BundleDef {
  id: string;
  name: string;
  description: string;
  priceUSD?: number;                // real-money bundle (Square/itch)
  priceCrowns?: number;             // crown-priced bundle
  items: string[];                  // item IDs included
  crownsIncluded: number;           // bonus crowns in bundle
  oneTimePurchase: boolean;
  icon: string;
}

// ─── Wallet ─────────────────────────────────────────────────────

export interface Wallet {
  crowns: number;
  glory: number;
  totalCrownsPurchased: number;
  totalCrownsSpent: number;
  totalGlorySpent: number;
  firstPurchaseUsed: boolean;
}

export const DEFAULT_WALLET: Wallet = {
  crowns: 0,
  glory: 0,
  totalCrownsPurchased: 0,
  totalCrownsSpent: 0,
  totalGlorySpent: 0,
  firstPurchaseUsed: false,
};

// ─── Equipped Cosmetics ─────────────────────────────────────────

export interface EquippedCosmetics {
  unitSkins: Partial<Record<HordeUnitType, string>>;  // unitType → skinId
  avatar: string;                   // portraitId or 'default'
  portraitFrame: string;            // frameId or 'none'
  voicePack: string;                // packId or 'default' (legacy)
  voicePacks: Partial<Record<HordeUnitType, string>>;  // per-unit voice packs
  buildingTheme: string;
  mapTheme: string;
  deathEffect: string;
  spawnEffect: string;
  attackTrail: string;
  victoryEffect: string;
  profileBorder: string;
  profileTitle: string;
  profileBackground: string;
  cursor: string;
  uiTheme: string;
  equipmentSkins: Partial<Record<EquipmentType, string>>;
}

export const DEFAULT_EQUIPPED: EquippedCosmetics = {
  unitSkins: {},
  avatar: 'default',
  portraitFrame: 'none',
  voicePack: 'default',
  voicePacks: {},
  buildingTheme: 'default',
  mapTheme: 'default',
  deathEffect: 'default',
  spawnEffect: 'default',
  attackTrail: 'default',
  victoryEffect: 'default',
  profileBorder: 'none',
  profileTitle: 'none',
  profileBackground: 'none',
  cursor: 'default',
  uiTheme: 'default',
  equipmentSkins: {},
};

// ─── Transaction Record ─────────────────────────────────────────

export type TransactionType =
  | 'crown_purchase'   // bought crowns with real money
  | 'crown_spend'      // spent crowns on item
  | 'glory_spend'      // spent glory on item
  | 'itch_redeem'      // redeemed itch.io key
  | 'glory_earn'       // earned glory from gameplay
  | 'battle_pass'      // bought battle pass
  | 'bundle_purchase'  // bought a bundle
  | 'crate_open';      // opened a loot crate

export interface TransactionRecord {
  uid: string;
  type: TransactionType;
  squareOrderId?: string;
  squarePaymentId?: string;
  itchKeyHash?: string;
  itemIds: string[];
  amountCents?: number;
  crownsChange?: number;          // positive = gained, negative = spent
  gloryChange?: number;
  status: 'pending' | 'completed' | 'failed' | 'refunded';
  createdAt: number;
  completedAt?: number;
}

// ─── Battle Pass ────────────────────────────────────────────────

export interface BattlePassReward {
  type: 'item' | 'crowns' | 'glory' | 'crate';
  itemId?: string;
  amount?: number;                 // for crowns/glory rewards
  crateTier?: CrateTier;           // for crate rewards
}

export interface BattlePassTier {
  tier: number;
  xpRequired: number;             // cumulative XP to reach this tier
  freeReward?: BattlePassReward;
  premiumReward?: BattlePassReward;
}

export interface BattlePassSeason {
  id: string;
  name: string;
  startDate: number;              // timestamp
  endDate: number;
  tiers: BattlePassTier[];
  premiumPriceCrowns: number;
  premiumPlusPriceCrowns: number;
}

export interface PlayerBattlePass {
  season: string;
  premium: boolean;
  premiumPlus: boolean;
  xp: number;
  claimedFree: Record<number, boolean>;
  claimedPremium: Record<number, boolean>;
}

// ─── Daily Rewards ──────────────────────────────────────────────

export interface DailyRewards {
  lastLogin: number;
  streak: number;
  lastFirstWin: number;
}

// ─── Booster ────────────────────────────────────────────────────

export type BoosterType = 'glory_2x' | 'xp_2x' | 'quest_refresh' | 'tier_skip';

export interface ActiveBooster {
  type: BoosterType;
  expiresAt: number;
}

// ─── Loot Crates ──────────────────────────────────────────────

export interface CrateDef {
  tier: CrateTier;
  name: string;
  icon: string;
  priceCrowns: number;
  priceGlory: number | null;       // null = crowns-only
  itemCount: number;
  clicksRequired: number;
  rarityWeights: Record<Rarity, number>;   // must sum to 100
  eligibleCategories: ItemCategory[];
  currencyFallback: number;                // crowns granted if loot pool exhausted
}

export interface CrateReward {
  itemId: string | null;            // null = currency fallback
  fallbackCrowns?: number;
}

export interface CrateOpenResult {
  rewards: CrateReward[];
  items: CatalogItem[];             // resolved catalog items for display
}
