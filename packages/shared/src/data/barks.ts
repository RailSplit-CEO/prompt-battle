import { BoldnessAxis, LoyaltyAxis, Personality, BarkTrigger } from '../types/game-state';

type PersonalityKey = `${BoldnessAxis}_${LoyaltyAxis}`;

function key(p: Personality): PersonalityKey {
  return `${p.boldness}_${p.loyalty}`;
}

// Bark text tables per personality combo and trigger
const BARK_TABLE: Record<BarkTrigger, Record<PersonalityKey, string[]>> = {
  order_attack: {
    bold_loyal: ["Finally! Let's go!", "For the commander!", "Charge!"],
    bold_independent: ["I was already heading there.", "About time.", "On my way."],
    cautious_loyal: ["Understood, moving in carefully.", "Yes, commander.", "Proceeding with caution."],
    cautious_independent: ["...if you say so.", "Fine.", "I guess."],
  },
  order_defend: {
    bold_loyal: ["I'll hold this line!", "Nobody gets through!", "Stand firm!"],
    bold_independent: ["I'll handle it.", "Fine, I'll stay.", "Don't worry about this spot."],
    cautious_loyal: ["Understood. Holding position.", "I'll keep watch.", "Defending, commander."],
    cautious_independent: ["Sure, I'll just... stand here.", "Alright.", "Holding."],
  },
  order_move: {
    bold_loyal: ["On it!", "Moving out!", "Right away!"],
    bold_independent: ["Already going.", "Yeah, yeah.", "Moving."],
    cautious_loyal: ["On my way, commander.", "Moving carefully.", "Understood."],
    cautious_independent: ["If I must.", "Fine.", "Going."],
  },
  taking_damage: {
    bold_loyal: ["I can handle this!", "Just a scratch!", "Still standing!"],
    bold_independent: ["Little help here?", "Getting hit over here!", "Could use some backup!"],
    cautious_loyal: ["Commander, I need support!", "Taking fire!", "Help!"],
    cautious_independent: ["This isn't working!", "I'm getting hurt!", "Bad position!"],
  },
  got_kill: {
    bold_loyal: ["Ha! Too easy!", "One down!", "For the team!"],
    bold_independent: ["Another one down.", "Easy.", "Next."],
    cautious_loyal: ["Threat neutralized.", "Target down.", "Area clear."],
    cautious_independent: ["Can we go now?", "Done.", "There."],
  },
  praised: {
    bold_loyal: ["For the team!", "Thank you, commander!", "Let's keep going!"],
    bold_independent: ["About time you noticed.", "Yeah, I know.", "Thanks."],
    cautious_loyal: ["Thank you, commander.", "I appreciate that.", "I'll do my best."],
    cautious_independent: ["Hmph. Thanks.", "...thanks.", "Sure."],
  },
  ignored_while_hurt: {
    bold_loyal: ["Still in the fight!", "I'm fine!", "Don't worry about me!"],
    bold_independent: ["Guess I'll handle it myself.", "Hello? Anyone?", "Whatever."],
    cautious_loyal: ["Commander? I'm injured...", "Could use some help...", "Hurting here..."],
    cautious_independent: ["*silence*", "...", "Great."],
  },
  ally_down: {
    bold_loyal: ["NO! I'll avenge them!", "They won't get away with this!", "Fight on!"],
    bold_independent: ["Damn. Stay focused.", "One less. Keep moving.", "Don't stop."],
    cautious_loyal: ["We need to regroup!", "Fall back!", "Commander, we lost one!"],
    cautious_independent: ["...this plan isn't working.", "We should retreat.", "Bad sign."],
  },
  enemy_spotted: {
    bold_loyal: ["Enemy spotted!", "Contact!", "I see them!"],
    bold_independent: ["Heads up.", "Over there.", "Incoming."],
    cautious_loyal: ["Commander, enemy ahead!", "Be careful, enemies near.", "I see hostiles."],
    cautious_independent: ["...company.", "Enemies.", "Watch out, I guess."],
  },
  low_hp: {
    bold_loyal: ["I won't fall!", "Still fighting!", "Not yet!"],
    bold_independent: ["Getting rough.", "Need to pull back.", "Running low."],
    cautious_loyal: ["I need healing, commander!", "Critical condition!", "Help me!"],
    cautious_independent: ["I'm done if this keeps up.", "Almost dead.", "..."],
  },
  mine_depleted: {
    bold_loyal: ["Mine's dry! What's next?", "Done mining, ready for action!", "Gold's out here."],
    bold_independent: ["Nothing left to mine.", "Mine's empty.", "Moving on."],
    cautious_loyal: ["Mine depleted, commander. Awaiting orders.", "No more gold here.", "Mine exhausted."],
    cautious_independent: ["Empty mine. Surprise.", "Nothing here.", "Done."],
  },
};

// Gameplay-critical triggers always fire (100% chance)
const CRITICAL_TRIGGERS: Set<BarkTrigger> = new Set([
  'enemy_spotted', 'low_hp', 'ally_down', 'taking_damage',
]);

// Minimum seconds between barks per hero
export const BARK_COOLDOWN = 12;

// Chance for non-critical barks to fire
export const BARK_CHANCE = 0.4;

export function getBark(personality: Personality, trigger: BarkTrigger): string | null {
  // Critical triggers always fire; flavor triggers have 40% chance
  if (!CRITICAL_TRIGGERS.has(trigger) && Math.random() > BARK_CHANCE) {
    return null;
  }

  const k = key(personality);
  const options = BARK_TABLE[trigger]?.[k];
  if (!options || options.length === 0) return null;
  return options[Math.floor(Math.random() * options.length)];
}

export function randomPersonality(): Personality {
  return {
    boldness: Math.random() > 0.5 ? 'bold' : 'cautious',
    loyalty: Math.random() > 0.5 ? 'loyal' : 'independent',
  };
}
