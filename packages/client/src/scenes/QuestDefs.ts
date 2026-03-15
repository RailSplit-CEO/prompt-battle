// ─── Quest System ─────────────────────────────────────────────

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
}

interface QuestDef {
  id: string;
  icon: string;
  title: string;
  desc: string;
  target?: number;
  check: (s: QState) => number; // returns 0..1 progress
}

const QUEST_DEFS: QuestDef[] = [
  { id: 'recruit5',    icon: '🐾', title: 'Growing Pack',      desc: 'Have 5 units alive',              target: 5,  check: s => Math.min(1, s.alive / 5) },
  { id: 'recruit15',   icon: '🐾', title: 'Army Rising',       desc: 'Have 15 units alive',             target: 15, check: s => Math.min(1, s.alive / 15) },
  { id: 'variety3',    icon: '🎭', title: 'Diverse Horde',     desc: 'Have 3 different unit types',     target: 3,  check: s => Math.min(1, s.typeCount / 3) },
  { id: 'equip3',      icon: '⚔️', title: 'Armed Up',          desc: 'Equip 3 units',                   target: 3,  check: s => Math.min(1, s.equipped / 3) },
  { id: 'cap2',        icon: '🏕️', title: 'Territory',         desc: 'Capture 2 camps',                 target: 2,  check: s => Math.min(1, s.myCamps / 2) },
  { id: 'kill10',      icon: '💀', title: 'First Blood',       desc: 'Eliminate 10 enemies',            target: 10, check: s => Math.min(1, s.totalKills / 10) },
  { id: 'deliver50',   icon: '📦', title: 'Supply Line',       desc: 'Deliver 50 total resources',      target: 50, check: s => { const t = Object.values(s.resourcesDelivered).reduce((a, b) => a + b, 0); return Math.min(1, t / 50); } },
  { id: 'tower1',      icon: '🗼', title: 'Siege!',            desc: 'Destroy an enemy tower',          target: 1,  check: s => Math.min(1, s.towersDestroyed) },
  { id: 'event1',      icon: '🏆', title: 'Event Victor',      desc: 'Win a map event',                 target: 1,  check: s => Math.min(1, s.eventsWon) },
  { id: 'era2',        icon: '🔬', title: 'Age Up',            desc: 'Reach Era 2',                              check: s => s.currentEra >= 2 ? 1 : 0 },
  { id: 'stockpile100',icon: '🏦', title: 'Hoarder',           desc: 'Stockpile 100 resources',         target: 100, check: s => Math.min(1, s.totalResourcesStockpiled / 100) },
  { id: 'buff2',       icon: '✨', title: 'Empowered',         desc: 'Have 2 active buffs',             target: 2,  check: s => Math.min(1, s.teamBuffs / 2) },
];

interface ActiveQuest {
  def: QuestDef;
  progress: number;
  completed: boolean;
}

export class QuestManager {
  private quests: ActiveQuest[];

  constructor(_team: 1 | 2) {
    this.quests = QUEST_DEFS.map(def => ({ def, progress: 0, completed: false }));
  }

  get totalCount(): number { return this.quests.length; }
  get completedCount(): number { return this.quests.filter(q => q.completed).length; }

  getActiveQuests(): { def: QuestDef; progress: number }[] {
    return this.quests
      .filter(q => !q.completed)
      .slice(0, 4)
      .map(q => ({ def: q.def, progress: q.progress }));
  }

  update(s: QState): void {
    for (const q of this.quests) {
      if (q.completed) continue;
      q.progress = q.def.check(s);
    }
  }

  popCompleted(): { title: string }[] {
    const freshlyDone: { title: string }[] = [];
    for (const q of this.quests) {
      if (!q.completed && q.progress >= 1) {
        q.completed = true;
        freshlyDone.push({ title: q.def.title });
      }
    }
    return freshlyDone;
  }
}
