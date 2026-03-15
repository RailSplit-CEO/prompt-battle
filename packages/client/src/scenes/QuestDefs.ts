// ─── Quest System ─────────────────────────────────────────────
// Quests are organized into tiers that unlock progressively.
// Each quest has a tangible reward that affects gameplay.
// Quests create meaningful decisions — not just passive milestones.

export interface QState {
  alive: number;
  typeCount: number;
  typeCounts: Record<string, number>;
  equipped: number;
  units: { id: number; type: string; team: 1 | 2; dead: boolean; equipment?: string; equipLevel?: number; tier: number }[];
  camps: { owner: number }[];
  myCamps: number;
  towers: { team: number; alive: boolean; hp: number; maxHp: number }[];
  nexuses: { team: number; hp: number; maxHp: number }[];
  currentEra: number;
  gameTime: number;
  totalKills: number;
  campsCaptured: number;
  resourcesDelivered: Record<string, number>;
  totalResourcesStockpiled: number;
  stockpile: Record<string, number>;
  peakArmySize: number;
  unlockedEquipment: Map<string, number>;
  towersDestroyed: number;
  eventsWon: number;
  teamBuffs: number;
  myTeam: 1 | 2;
  enemyTeam: 1 | 2;
  // Extended state for richer quests
  supply?: number;
  enemyCamps?: number;
  enemyNexusHp?: number;
  enemyNexusMaxHp?: number;
  controlledCenterCamp?: boolean;
  eliteKills?: number;
  t3PlusUnits?: number;
  consecutiveCampsHeld?: number;
}

export type QuestRewardType =
  | 'resources'       // Grant resources to base stockpile
  | 'free_units'      // Spawn free units at base
  | 'buff'            // Temporary team-wide buff
  | 'supply_bonus'    // Temporarily increase supply cap
  | 'heal_nexus'      // Heal nexus
  | 'reveal_map';     // Briefly reveal fog of war

export interface QuestReward {
  type: QuestRewardType;
  desc: string;
  // Reward data
  resources?: Partial<Record<string, number>>;
  unitType?: string;
  unitCount?: number;
  buffStat?: string;
  buffAmount?: number;
  buffDuration?: number; // ms
  supplyBonus?: number;
  healAmount?: number;
}

interface QuestDef {
  id: string;
  icon: string;
  title: string;
  desc: string;
  target?: number;
  tier: 'early' | 'mid' | 'late';  // unlock timing
  check: (s: QState) => number;     // returns 0..1 progress
  reward: QuestReward;
}

const QUEST_DEFS: QuestDef[] = [
  // ═══ EARLY GAME (available from start) ═══
  // These guide new players and reward map exploration
  {
    id: 'first_camp', icon: '🏕️', title: 'Claim the Wild',
    desc: 'Capture your first camp',
    target: 1, tier: 'early',
    check: s => Math.min(1, s.campsCaptured),
    reward: { type: 'resources', desc: '+8 carrots, +4 meat', resources: { carrot: 8, meat: 4 } },
  },
  {
    id: 'scout_ahead', icon: '👁️', title: 'Scout Ahead',
    desc: 'Have 3 different unit types',
    target: 3, tier: 'early',
    check: s => Math.min(1, s.typeCount / 3),
    reward: { type: 'free_units', desc: '2 free gnomes at base', unitType: 'gnome', unitCount: 2 },
  },
  {
    id: 'first_blood', icon: '💀', title: 'First Blood',
    desc: 'Eliminate 5 enemies',
    target: 5, tier: 'early',
    check: s => Math.min(1, s.totalKills / 5),
    reward: { type: 'buff', desc: '+15% attack for 60s', buffStat: 'attack', buffAmount: 0.15, buffDuration: 60000 },
  },
  {
    id: 'supply_line', icon: '📦', title: 'Supply Line',
    desc: 'Deliver 20 total resources',
    target: 20, tier: 'early',
    check: s => { const t = Object.values(s.resourcesDelivered).reduce((a, b) => a + b, 0); return Math.min(1, t / 20); },
    reward: { type: 'resources', desc: '+5 meat, +3 metal', resources: { meat: 5, metal: 3 } },
  },

  // ═══ MID GAME (unlock after Era 2 or 3+ camps) ═══
  // These force strategic decisions and player conflict
  {
    id: 'territory_3', icon: '🗺️', title: 'Expanding Empire',
    desc: 'Control 3 camps simultaneously',
    target: 3, tier: 'mid',
    check: s => Math.min(1, s.myCamps / 3),
    reward: { type: 'buff', desc: '+20% speed for 90s', buffStat: 'speed', buffAmount: 0.20, buffDuration: 90000 },
  },
  {
    id: 'arms_race', icon: '⚔️', title: 'Arms Race',
    desc: 'Equip 5 units with gear',
    target: 5, tier: 'mid',
    check: s => Math.min(1, s.equipped / 5),
    reward: { type: 'resources', desc: '+10 metal', resources: { metal: 10 } },
  },
  {
    id: 'war_machine', icon: '🐾', title: 'War Machine',
    desc: 'Have 30+ supply worth of units',
    target: 30, tier: 'mid',
    check: s => Math.min(1, (s.supply || 0) / 30),
    reward: { type: 'heal_nexus', desc: 'Heal nexus for 2000 HP', healAmount: 2000 },
  },
  {
    id: 'siege_tower', icon: '🗼', title: 'Siege!',
    desc: 'Destroy an enemy tower',
    target: 1, tier: 'mid',
    check: s => Math.min(1, s.towersDestroyed),
    reward: { type: 'free_units', desc: '2 free skulls at base', unitType: 'skull', unitCount: 2 },
  },
  {
    id: 'age_up', icon: '🔬', title: 'Age of War',
    desc: 'Reach Era 3',
    tier: 'mid',
    check: s => s.currentEra >= 3 ? 1 : 0,
    reward: { type: 'supply_bonus', desc: '+10 supply cap for 120s', supplyBonus: 10, buffDuration: 120000 },
  },
  {
    id: 'event_victor', icon: '🏆', title: 'Event Victor',
    desc: 'Win a map event',
    target: 1, tier: 'mid',
    check: s => Math.min(1, s.eventsWon),
    reward: { type: 'resources', desc: '+6 crystal, +6 meat', resources: { crystal: 6, meat: 6 } },
  },

  // ═══ LATE GAME (unlock after Era 3 or 4+ camps) ═══
  // These are high-risk, game-swinging objectives
  {
    id: 'elite_hunter', icon: '🏅', title: 'Elite Hunter',
    desc: 'Kill 2 elite prey',
    target: 2, tier: 'late',
    check: s => Math.min(1, (s.eliteKills || 0) / 2),
    reward: { type: 'resources', desc: '+15 crystal', resources: { crystal: 15 } },
  },
  {
    id: 'army_diversity', icon: '🎭', title: 'Combined Arms',
    desc: 'Have 5+ different unit types alive',
    target: 5, tier: 'late',
    check: s => Math.min(1, s.typeCount / 5),
    reward: { type: 'buff', desc: '+10% attack and speed for 120s', buffStat: 'attack', buffAmount: 0.10, buffDuration: 120000 },
  },
  {
    id: 'domination', icon: '👑', title: 'Domination',
    desc: 'Control 5+ camps at once',
    target: 5, tier: 'late',
    check: s => Math.min(1, s.myCamps / 5),
    reward: { type: 'heal_nexus', desc: 'Heal nexus for 5000 HP', healAmount: 5000 },
  },
  {
    id: 'stockpile_200', icon: '🏦', title: 'War Chest',
    desc: 'Stockpile 200 total resources',
    target: 200, tier: 'late',
    check: s => Math.min(1, s.totalResourcesStockpiled / 200),
    reward: { type: 'supply_bonus', desc: '+15 supply cap for 180s', supplyBonus: 15, buffDuration: 180000 },
  },
  {
    id: 'bring_pain', icon: '💥', title: 'Bring the Pain',
    desc: 'Eliminate 40 enemies',
    target: 40, tier: 'late',
    check: s => Math.min(1, s.totalKills / 40),
    reward: { type: 'buff', desc: '+25% attack for 90s', buffStat: 'attack', buffAmount: 0.25, buffDuration: 90000 },
  },
  {
    id: 'titan', icon: '👹', title: 'Unleash the Titan',
    desc: 'Have a Tier 5 unit alive',
    tier: 'late',
    check: s => (s.t3PlusUnits || 0) > 0 && s.units.some(u => u.tier >= 5 && !u.dead && u.team === s.myTeam) ? 1 : 0,
    reward: { type: 'buff', desc: '+15% all stats for 120s', buffStat: 'attack', buffAmount: 0.15, buffDuration: 120000 },
  },
];

interface ActiveQuest {
  def: QuestDef;
  progress: number;
  completed: boolean;
  rewardClaimed: boolean;
}

export class QuestManager {
  private quests: ActiveQuest[];
  private _pendingRewards: QuestReward[] = [];
  private currentEra = 1;
  private myCamps = 0;

  constructor(_team: 1 | 2) {
    this.quests = QUEST_DEFS.map(def => ({ def, progress: 0, completed: false, rewardClaimed: false }));
  }

  get totalCount(): number { return this.quests.length; }
  get completedCount(): number { return this.quests.filter(q => q.completed).length; }

  /** Which quests are currently visible/active based on game progression */
  private isUnlocked(q: ActiveQuest): boolean {
    if (q.def.tier === 'early') return true;
    if (q.def.tier === 'mid') return this.currentEra >= 2 || this.myCamps >= 3;
    if (q.def.tier === 'late') return this.currentEra >= 3 || this.myCamps >= 4;
    return true;
  }

  getActiveQuests(): { def: QuestDef; progress: number }[] {
    return this.quests
      .filter(q => !q.completed && this.isUnlocked(q))
      .slice(0, 4)
      .map(q => ({ def: q.def, progress: q.progress }));
  }

  /** Get all quests grouped by tier for display */
  getAllQuests(): { def: QuestDef; progress: number; completed: boolean; locked: boolean }[] {
    return this.quests.map(q => ({
      def: q.def,
      progress: q.progress,
      completed: q.completed,
      locked: !this.isUnlocked(q),
    }));
  }

  update(s: QState): void {
    this.currentEra = s.currentEra;
    this.myCamps = s.myCamps;
    for (const q of this.quests) {
      if (q.completed) continue;
      if (!this.isUnlocked(q)) continue;
      q.progress = q.def.check(s);
    }
  }

  popCompleted(): { title: string; reward: QuestReward }[] {
    const freshlyDone: { title: string; reward: QuestReward }[] = [];
    for (const q of this.quests) {
      if (!q.completed && q.progress >= 1 && this.isUnlocked(q)) {
        q.completed = true;
        q.rewardClaimed = true;
        freshlyDone.push({ title: q.def.title, reward: q.def.reward });
        this._pendingRewards.push(q.def.reward);
      }
    }
    return freshlyDone;
  }

  /** Drain pending rewards (consumed by HordeScene to apply effects) */
  drainRewards(): QuestReward[] {
    const rewards = [...this._pendingRewards];
    this._pendingRewards.length = 0;
    return rewards;
  }
}
