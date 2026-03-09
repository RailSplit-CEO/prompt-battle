import { BarkTrigger } from '../types/game-state';

// Simplified bark system - no personality axis, just trigger-based lines
const BARK_TABLE: Record<BarkTrigger, string[]> = {
  order_attack: ["Let's go!", "Charge!", "On my way!", "Moving in!", "Attack!"],
  order_move: ["Moving out!", "On it!", "Heading there!", "Going!", "Right away!"],
  order_defend: ["Holding position!", "I'll guard this!", "Standing firm!", "Defending!"],
  taking_damage: ["I'm hit!", "Under attack!", "Taking fire!", "Ouch!", "Need backup!"],
  got_kill: ["One down!", "Got 'em!", "Target eliminated!", "Ha!", "Next!"],
  ally_down: ["We lost one!", "No! Fight on!", "Avenge them!", "Regroup!"],
  enemy_spotted: ["Enemy spotted!", "Contact!", "Heads up!", "Incoming!"],
  low_hp: ["I'm hurting!", "Need help!", "Critical!", "Almost down!"],
  camp_captured: ["Camp secured!", "It's ours now!", "Setting up camp!", "New recruits incoming!"],
};

// Critical triggers always fire
const CRITICAL_TRIGGERS: Set<BarkTrigger> = new Set([
  'enemy_spotted', 'low_hp', 'ally_down', 'taking_damage',
]);

export const BARK_COOLDOWN = 12;
export const BARK_CHANCE = 0.4;

export function getBark(trigger: BarkTrigger): string | null {
  if (!CRITICAL_TRIGGERS.has(trigger) && Math.random() > BARK_CHANCE) {
    return null;
  }
  const options = BARK_TABLE[trigger];
  if (!options || options.length === 0) return null;
  return options[Math.floor(Math.random() * options.length)];
}
