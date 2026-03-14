// ═══════════════════════════════════════════════════════════════
// unit-factory.ts — Creates realistic mock game objects for
// headless profiling tests. No Phaser dependencies.
// ═══════════════════════════════════════════════════════════════

// ─── Types (mirrors HordeScene.ts interfaces) ─────────────────

type ResourceType = 'carrot' | 'meat' | 'crystal' | 'metal';
type EquipmentType = 'pickaxe' | 'sword' | 'shield' | 'boots' | 'banner';
type AnimState = 'idle' | 'walk' | 'attack';

interface BehaviorMods {
  formation: 'normal' | 'spread' | 'tight';
  caution: 'normal' | 'safe' | 'aggressive';
  pacing: 'normal' | 'rush' | 'efficient';
}

interface WorkflowStep {
  action: string;
  [key: string]: unknown;
}

interface HWorkflow {
  steps: WorkflowStep[];
  currentStep: number;
  label: string;
  loopFrom: number;
  playedOnce: boolean;
  voiceCommand?: string;
}

/** Headless HUnit — all 50+ fields from HordeScene.ts line 676, sprite fields nulled. */
export interface MockHUnit {
  id: number;
  type: string;
  team: 0 | 1 | 2;
  hp: number;
  maxHp: number;
  attack: number;
  speed: number;
  x: number;
  y: number;
  targetX: number;
  targetY: number;
  attackTimer: number;
  sprite: null;
  dead: boolean;
  campId: string | null;
  lungeX: number;
  lungeY: number;
  animState: AnimState;
  attackFaceX: number | null;
  prevSpriteX: number;
  prevSpriteY: number;
  gnomeShield: number;
  hasRebirth: boolean;
  diveReady: boolean;
  diveTimer: number;
  lastAttackTarget: number;
  carrying: ResourceType | null;
  carrySprite: null;
  loop: HWorkflow | null;
  isElite: boolean;
  idleTimer: number;
  claimItemId: number;
  equipment: EquipmentType | null;
  equipLevel: number;
  equipSprite: null;
  equipDragSprite: null;
  equipVisualApplied: EquipmentType | null;
  mods: BehaviorMods;
  pathWaypoints: { x: number; y: number }[] | null;
  pathAge: number;
  pathTargetX: number;
  pathTargetY: number;
  lastCheckX: number;
  lastCheckY: number;
  stuckFrames: number;
  stuckCooldown: number;
}

/** Headless HCamp — mirrors HordeScene.ts line 740. */
export interface MockHCamp {
  id: string;
  name: string;
  animalType: string;
  tier: number;
  guardCount: number;
  x: number;
  y: number;
  owner: 0 | 1 | 2;
  spawnMs: number;
  spawnTimer: number;
  buff: { stat: string; value: number };
  label: null;
  area: null;
  captureBar: null;
  storedFood: number;
  scouted: boolean;
  lastSeenOwner: 0 | 1 | 2;
  lastSeenLabel: string;
  lastSeenColor: string;
  idleGuard: null;
  idleGuardOwner: 0 | 1 | 2;
}

/** Headless HGroundItem — mirrors HordeScene.ts line 588. */
export interface MockGroundItem {
  id: number;
  type: ResourceType;
  x: number;
  y: number;
  sprite: null;
  dead: boolean;
  age: number;
}

/** Headless PendingHit — mirrors HordeScene.ts line 800. */
export interface MockPendingHit {
  attackerId: number;
  targetId: number;
  nexusTeam: 1 | 2 | 0;
  dmg: number;
  splashTargets: { id: number; dmg: number }[];
  timer: number;
  isTroll: boolean;
  isRanged: boolean;
  isSplash: boolean;
  isCrit: boolean;
  projectile: null;
  projX: number;
  projY: number;
  projSpeed: number;
}

// ─── Constants ────────────────────────────────────────────────

const WORLD_W = 6400;
const WORLD_H = 6400;

const UNIT_TYPES = ['gnome', 'turtle', 'skull', 'spider', 'hyena', 'panda', 'lizard', 'minotaur', 'shaman', 'troll', 'rogue'];

const UNIT_STATS: Record<string, { hp: number; attack: number; speed: number }> = {
  gnome:    { hp: 30,  attack: 5,   speed: 120 },
  turtle:   { hp: 80,  attack: 12,  speed: 60 },
  skull:    { hp: 45,  attack: 15,  speed: 100 },
  spider:   { hp: 35,  attack: 10,  speed: 140 },
  hyena:    { hp: 40,  attack: 12,  speed: 130 },
  panda:    { hp: 120, attack: 25,  speed: 50 },
  lizard:   { hp: 55,  attack: 20,  speed: 110 },
  minotaur: { hp: 200, attack: 40,  speed: 45 },
  shaman:   { hp: 60,  attack: 18,  speed: 80 },
  troll:    { hp: 350, attack: 60,  speed: 35 },
  rogue:    { hp: 40,  attack: 14,  speed: 135 },
};

const RESOURCE_TYPES: ResourceType[] = ['carrot', 'meat', 'crystal', 'metal'];
const CAMP_ANIMALS = ['gnome', 'turtle', 'skull', 'spider', 'hyena', 'panda', 'lizard', 'minotaur', 'shaman', 'troll'];

const DEFAULT_MODS: BehaviorMods = { formation: 'normal', caution: 'normal', pacing: 'normal' };

let _nextId = 0;

// ─── Factory functions ────────────────────────────────────────

export function createMockHUnit(overrides?: Partial<MockHUnit>): MockHUnit {
  const id = _nextId++;
  const type = overrides?.type ?? UNIT_TYPES[id % UNIT_TYPES.length];
  const stats = UNIT_STATS[type] ?? UNIT_STATS.gnome;
  const x = overrides?.x ?? Math.random() * WORLD_W;
  const y = overrides?.y ?? Math.random() * WORLD_H;

  return {
    id,
    type,
    team: 1,
    hp: stats.hp,
    maxHp: stats.hp,
    attack: stats.attack,
    speed: stats.speed,
    x,
    y,
    targetX: x + (Math.random() - 0.5) * 200,
    targetY: y + (Math.random() - 0.5) * 200,
    attackTimer: 0,
    sprite: null,
    dead: false,
    campId: null,
    lungeX: 0,
    lungeY: 0,
    animState: 'idle',
    attackFaceX: null,
    prevSpriteX: x,
    prevSpriteY: y,
    gnomeShield: type === 'gnome' ? 1 : 0,
    hasRebirth: type === 'skull',
    diveReady: false,
    diveTimer: 0,
    lastAttackTarget: -1,
    carrying: null,
    carrySprite: null,
    loop: null,
    isElite: false,
    idleTimer: 0,
    claimItemId: -1,
    equipment: null,
    equipLevel: 0,
    equipSprite: null,
    equipDragSprite: null,
    equipVisualApplied: null,
    mods: { ...DEFAULT_MODS },
    pathWaypoints: null,
    pathAge: 0,
    pathTargetX: 0,
    pathTargetY: 0,
    lastCheckX: x,
    lastCheckY: y,
    stuckFrames: 0,
    stuckCooldown: 0,
    ...overrides,
  };
}

export function createMockHCamp(overrides?: Partial<MockHCamp>): MockHCamp {
  const idx = _nextId++;
  return {
    id: `camp_${idx}`,
    name: `Camp ${idx}`,
    animalType: CAMP_ANIMALS[idx % CAMP_ANIMALS.length],
    tier: 1,
    guardCount: 3,
    x: Math.random() * WORLD_W,
    y: Math.random() * WORLD_H,
    owner: 0,
    spawnMs: 5000,
    spawnTimer: 0,
    buff: { stat: 'attack', value: 5 },
    label: null,
    area: null,
    captureBar: null,
    storedFood: 0,
    scouted: false,
    lastSeenOwner: 0,
    lastSeenLabel: '',
    lastSeenColor: '',
    idleGuard: null,
    idleGuardOwner: 0,
    ...overrides,
  };
}

export function createMockGroundItem(overrides?: Partial<MockGroundItem>): MockGroundItem {
  const id = _nextId++;
  return {
    id,
    type: RESOURCE_TYPES[id % RESOURCE_TYPES.length],
    x: Math.random() * WORLD_W,
    y: Math.random() * WORLD_H,
    sprite: null,
    dead: false,
    age: 0,
    ...overrides,
  };
}

export function createMockPendingHit(overrides?: Partial<MockPendingHit>): MockPendingHit {
  const id = _nextId++;
  const splashCount = overrides?.isSplash ? Math.floor(Math.random() * 5) + 1 : 0;
  return {
    attackerId: id,
    targetId: id + 1,
    nexusTeam: 0,
    dmg: 10 + Math.random() * 40,
    splashTargets: Array.from({ length: splashCount }, (_, i) => ({
      id: id + 2 + i,
      dmg: 5 + Math.random() * 15,
    })),
    timer: 500,
    isTroll: false,
    isRanged: false,
    isSplash: splashCount > 0,
    isCrit: false,
    projectile: null,
    projX: 0,
    projY: 0,
    projSpeed: 0,
    ...overrides,
  };
}

// ─── Batch / scenario creators ────────────────────────────────

export interface BatchOptions {
  teamDistribution?: [number, number, number]; // [team0, team1, team2] ratios
  types?: string[];
  withWorkflows?: boolean;
  withPaths?: boolean;
  withEquipment?: boolean;
}

export function createUnitBatch(count: number, options: BatchOptions = {}): MockHUnit[] {
  const {
    teamDistribution = [0.05, 0.475, 0.475],
    types = UNIT_TYPES,
    withWorkflows = false,
    withPaths = false,
    withEquipment = false,
  } = options;

  const units: MockHUnit[] = [];
  for (let i = 0; i < count; i++) {
    const r = Math.random();
    const team: 0 | 1 | 2 =
      r < teamDistribution[0] ? 0 :
      r < teamDistribution[0] + teamDistribution[1] ? 1 : 2;

    const type = types[i % types.length];
    const unit = createMockHUnit({ team, type });

    if (withWorkflows && Math.random() > 0.3) {
      unit.loop = createWorkflow(type);
    }

    if (withPaths && Math.random() > 0.4) {
      const waypointCount = 3 + Math.floor(Math.random() * 8);
      unit.pathWaypoints = Array.from({ length: waypointCount }, () => ({
        x: unit.x + (Math.random() - 0.5) * 600,
        y: unit.y + (Math.random() - 0.5) * 600,
      }));
    }

    if (withEquipment && Math.random() > 0.6) {
      const equipTypes: EquipmentType[] = ['pickaxe', 'sword', 'shield', 'boots', 'banner'];
      unit.equipment = equipTypes[Math.floor(Math.random() * equipTypes.length)];
      unit.equipLevel = 1 + Math.floor(Math.random() * 3);
      unit.equipVisualApplied = unit.equipment;
    }

    units.push(unit);
  }
  return units;
}

export interface ScenarioConfig {
  team1Units: number;
  team2Units: number;
  neutrals: number;
  camps: number;
  groundItems: number;
  pendingHits: number;
  withWorkflows?: boolean;
  withPaths?: boolean;
}

export function createRealisticScenario(config: ScenarioConfig) {
  _nextId = 0; // reset for clean IDs

  const team1 = createUnitBatch(config.team1Units, {
    teamDistribution: [0, 1, 0],
    withWorkflows: config.withWorkflows ?? true,
    withPaths: config.withPaths ?? true,
  });

  const team2 = createUnitBatch(config.team2Units, {
    teamDistribution: [0, 0, 1],
    withWorkflows: config.withWorkflows ?? true,
    withPaths: config.withPaths ?? true,
  });

  const neutrals = createUnitBatch(config.neutrals, {
    teamDistribution: [1, 0, 0],
    types: ['skull', 'spider', 'hyena', 'panda'],
  });

  const camps = Array.from({ length: config.camps }, () => createMockHCamp());
  const groundItems = Array.from({ length: config.groundItems }, () => createMockGroundItem());
  const pendingHits = Array.from({ length: config.pendingHits }, (_, i) =>
    createMockPendingHit({ isSplash: i % 3 === 0 }),
  );

  const allUnits = [...team1, ...team2, ...neutrals];

  return { units: allUnits, team1, team2, neutrals, camps, groundItems, pendingHits };
}

/** Reset the internal ID counter (for test isolation). */
export function resetIdCounter() {
  _nextId = 0;
}

// ─── Internal helpers ─────────────────────────────────────────

function createWorkflow(unitType: string): HWorkflow {
  const steps: WorkflowStep[] = [];

  // Create realistic multi-step workflows based on unit type
  if (unitType === 'gnome') {
    steps.push(
      { action: 'seek_resource', resourceType: 'carrot' },
      { action: 'deliver', target: 'base' },
    );
  } else if (unitType === 'turtle' || unitType === 'panda' || unitType === 'minotaur') {
    steps.push(
      { action: 'defend', target: 'base' },
    );
  } else {
    steps.push(
      { action: 'hunt', targetType: undefined },
      { action: 'attack_enemies' },
    );
  }

  return {
    steps,
    currentStep: 0,
    label: `${unitType} workflow`,
    loopFrom: 0,
    playedOnce: false,
    voiceCommand: `${unitType}s gather food`,
  };
}
