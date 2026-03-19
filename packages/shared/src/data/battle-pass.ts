import { BattlePassSeason, BattlePassReward } from '../types/store';

// XP cost per tier, scaling so early tiers are fast and late tiers are slow.
// Early (1-10): ~100-125 XP/tier → 1 game ≈ 2-3 tiers
// Mid  (20-30): ~225-325 XP/tier → 1 game ≈ 1 tier
// Late (40-50): ~425-525 XP/tier → 1 game ≈ 0.5 tiers
function getXpForTier(tier: number): number {
  if (tier <= 5) return 100;
  if (tier <= 10) return 125;
  if (tier <= 15) return 175;
  if (tier <= 20) return 225;
  if (tier <= 25) return 275;
  if (tier <= 30) return 325;
  if (tier <= 35) return 375;
  if (tier <= 40) return 425;
  if (tier <= 45) return 475;
  return 525;
}

// Build tiers with cumulative XP thresholds
const tiers = (() => {
  let cumulative = 0;
  return Array.from({ length: 50 }, (_, i) => {
    const tier = i + 1;
    cumulative += getXpForTier(tier);
    return {
      tier,
      xpRequired: cumulative,
      freeReward: getFreeReward(tier),
      premiumReward: getPremiumReward(tier),
    };
  });
})();

export const SEASON_1: BattlePassSeason = {
  id: 'season_1',
  name: 'Season of the Horde',
  startDate: Date.now(),
  endDate: Date.now() + 56 * 24 * 60 * 60 * 1000, // 8 weeks
  premiumPriceCrowns: 1000,
  premiumPriceUSD: 10,
  premiumPlusPriceCrowns: 2500,
  tiers,
};

function getFreeReward(tier: number): BattlePassReward {
  // ~1/3 crates, minimal crowns, glory + unique items at milestones

  // Big milestones: gold/silver crates
  if (tier === 50) return { type: 'crate', crateTier: 'gold' };
  if (tier === 40) return { type: 'crate', crateTier: 'gold' };
  if (tier === 30) return { type: 'crate', crateTier: 'silver' };
  if (tier === 25) return { type: 'crate', crateTier: 'silver' };
  if (tier === 20) return { type: 'crate', crateTier: 'silver' };
  if (tier === 10) return { type: 'crate', crateTier: 'silver' };

  // Unique free items at select tiers
  if (tier === 3) return { type: 'item', itemId: 'emote_wave' };
  if (tier === 8) return { type: 'item', itemId: 'frame_wooden' };
  if (tier === 18) return { type: 'item', itemId: 'frame_iron' };
  if (tier === 28) return { type: 'item', itemId: 'emote_laughing' };
  if (tier === 38) return { type: 'item', itemId: 'cursor_crystal' };
  if (tier === 48) return { type: 'glory', amount: 200 };

  // Bronze crates every 3 tiers (fills ~1/3 of remaining slots)
  if (tier % 3 === 0) return { type: 'crate', crateTier: 'bronze' };

  // Glory for remaining tiers (no crowns on free side)
  if (tier % 5 === 0) return { type: 'glory', amount: 25 + Math.floor(tier / 10) * 10 };
  return { type: 'glory', amount: 10 + Math.floor(tier / 10) * 5 };
}

function getPremiumReward(tier: number): BattlePassReward {
  // Unique items at key milestones, ~1/3 crates, currency fills the rest

  // Unique premium items (skins, voices, effects, frames)
  if (tier === 1) return { type: 'item', itemId: 'title_recruit' };
  if (tier === 5) return { type: 'item', itemId: 'skin_gnome_frost' };
  if (tier === 10) return { type: 'item', itemId: 'portrait_skull_deluxe' };
  if (tier === 15) return { type: 'item', itemId: 'voice_gnome_energetic' };
  if (tier === 20) return { type: 'item', itemId: 'skin_spider_frost' };
  if (tier === 25) return { type: 'item', itemId: 'skin_panda_samurai' };
  if (tier === 30) return { type: 'item', itemId: 'death_shatter' };
  if (tier === 35) return { type: 'item', itemId: 'skin_minotaur_berserker' };
  if (tier === 40) return { type: 'item', itemId: 'frame_dragon' };
  if (tier === 45) return { type: 'item', itemId: 'voice_fx_echo' };
  if (tier === 50) return { type: 'item', itemId: 'skin_troll_frost_king' };

  // Big milestone crates (tiers near unique items get premium crates)
  if (tier === 48) return { type: 'crate', crateTier: 'gold' };
  if (tier === 42) return { type: 'crate', crateTier: 'gold' };
  if (tier === 38) return { type: 'crate', crateTier: 'silver' };
  if (tier === 32) return { type: 'crate', crateTier: 'silver' };
  if (tier === 28) return { type: 'crate', crateTier: 'silver' };
  if (tier === 22) return { type: 'crate', crateTier: 'silver' };
  if (tier === 18) return { type: 'crate', crateTier: 'silver' };
  if (tier === 12) return { type: 'crate', crateTier: 'silver' };
  if (tier === 8) return { type: 'crate', crateTier: 'bronze' };

  // Bronze crates every 4 tiers for remaining slots
  if (tier % 4 === 0) return { type: 'crate', crateTier: 'bronze' };

  // Currency for filler tiers
  if (tier % 3 === 0) return { type: 'crowns', amount: 25 + Math.floor(tier / 10) * 10 };
  if (tier % 2 === 0) return { type: 'glory', amount: 20 + Math.floor(tier / 10) * 5 };
  return { type: 'crowns', amount: 20 + Math.floor(tier / 10) * 5 };
}

export const CURRENT_SEASON = SEASON_1;
