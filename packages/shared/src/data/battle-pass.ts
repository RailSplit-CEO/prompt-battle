import { BattlePassSeason, BattlePassReward } from '../types/store';

const XP_PER_TIER = 1000;

export const SEASON_1: BattlePassSeason = {
  id: 'season_1',
  name: 'Season of the Blade',
  startDate: Date.now(),
  endDate: Date.now() + 56 * 24 * 60 * 60 * 1000, // 8 weeks
  premiumPriceCrowns: 1000,
  premiumPlusPriceCrowns: 2500,
  tiers: Array.from({ length: 50 }, (_, i) => {
    const tier = i + 1;
    const xpRequired = tier * XP_PER_TIER;
    return {
      tier,
      xpRequired,
      freeReward: getFreeReward(tier),
      premiumReward: getPremiumReward(tier),
    };
  }),
};

function getFreeReward(tier: number): BattlePassReward {
  // Every tier has a reward — items at milestones, currency elsewhere
  // Milestone items
  if (tier === 3) return { type: 'item', itemId: 'emote_wave' };
  if (tier === 8) return { type: 'item', itemId: 'frame_wooden' };
  if (tier === 18) return { type: 'item', itemId: 'frame_iron' };
  if (tier === 28) return { type: 'item', itemId: 'emote_laugh' };
  if (tier === 38) return { type: 'item', itemId: 'cursor_crystal' };
  if (tier === 48) return { type: 'glory', amount: 200 };
  // Every 10 tiers: large glory
  if (tier % 10 === 0) return { type: 'glory', amount: tier <= 20 ? 50 : tier <= 40 ? 75 : 100 };
  // Every 5 tiers: medium glory
  if (tier % 5 === 0) return { type: 'glory', amount: 25 };
  // Alternating crowns and glory for remaining tiers
  if (tier % 3 === 0) return { type: 'crowns', amount: 15 + Math.floor(tier / 10) * 5 };
  if (tier % 2 === 0) return { type: 'glory', amount: 10 + Math.floor(tier / 10) * 5 };
  return { type: 'crowns', amount: 10 + Math.floor(tier / 10) * 5 };
}

function getPremiumReward(tier: number): BattlePassReward {
  // Every tier has a premium reward — skins/items at milestones, currency elsewhere
  // Milestone items
  if (tier === 1) return { type: 'item', itemId: 'title_recruit' };
  if (tier === 5) return { type: 'item', itemId: 'skin_gnome_frost' };
  if (tier === 10) return { type: 'item', itemId: 'portrait_skull_deluxe' };
  if (tier === 15) return { type: 'item', itemId: 'voice_gnome_hyper' };
  if (tier === 20) return { type: 'item', itemId: 'skin_spider_frost' };
  if (tier === 25) return { type: 'item', itemId: 'skin_panda_samurai' };
  if (tier === 30) return { type: 'item', itemId: 'death_fx_shatter' };
  if (tier === 35) return { type: 'item', itemId: 'skin_minotaur_berserker' };
  if (tier === 40) return { type: 'item', itemId: 'frame_dragon' };
  if (tier === 45) return { type: 'item', itemId: 'voice_fx_echo' };
  if (tier === 50) return { type: 'item', itemId: 'skin_troll_frost_king' };
  // Alternating crowns and glory for remaining tiers
  if (tier % 4 === 0) return { type: 'glory', amount: 30 + Math.floor(tier / 10) * 10 };
  if (tier % 3 === 0) return { type: 'crowns', amount: 20 + Math.floor(tier / 10) * 10 };
  if (tier % 2 === 0) return { type: 'glory', amount: 15 + Math.floor(tier / 10) * 5 };
  return { type: 'crowns', amount: 15 + Math.floor(tier / 10) * 5 };
}

export const CURRENT_SEASON = SEASON_1;
