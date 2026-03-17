// ─── BotAI.ts ──────────────────────────────────────────────────
// AI opponent for solo mode. Strategic economy, equipment,
// expand/build/attack/defend phases.
// All pure simulation — no Phaser dependencies.
// ────────────────────────────────────────────────────────────────

import type {
  SimState,
  SimUnit,
  SimCamp,
  ResourceType,
  EquipmentType,
  HWorkflow,
} from './SimTypes';

import {
  ANIMALS,
  SPAWN_COSTS,
  AI_TICK_MS,
  P1_BASE,
  P2_BASE,
  EQUIPMENT,
  EQUIPMENT_PREREQS,
} from './Constants';

import { unlockEquipment } from './CampLogic';

// ─── Helpers ──────────────────────────────────────────────────

function pdist(a: { x: number; y: number }, b: { x: number; y: number }): number {
  const dx = a.x - b.x, dy = a.y - b.y;
  return Math.sqrt(dx * dx + dy * dy);
}

function pdist2(a: { x: number; y: number }, b: { x: number; y: number }): number {
  const dx = a.x - b.x, dy = a.y - b.y;
  return dx * dx + dy * dy;
}

function makeGatherWorkflow(resourceType: ResourceType, deliverTo: string): HWorkflow {
  return {
    steps: [
      { action: 'seek_resource', resourceType } as any,
      { action: 'deliver', target: deliverTo } as any,
    ],
    currentStep: 0,
    label: `${resourceType} -> ${deliverTo}`,
    loopFrom: 0,
    playedOnce: false,
  };
}

function sendUnitsTo(units: SimUnit[], x: number, y: number): void {
  for (const u of units) {
    u.targetX = x;
    u.targetY = y;
    u.loop = null; // clear workflow so they fight
  }
}

// ─── AI State (stored on SimState as _ai prefixed fields) ─────

/** Main AI tick — runs every AI_TICK_MS */
export function updateAI(delta: number, state: SimState): void {
  state.aiTimer += delta;
  if (state.aiTimer < AI_TICK_MS) return;
  state.aiTimer -= AI_TICK_MS;

  const team: 1 | 2 = 2;
  const stock = state.baseStockpile[team];
  const nex = state.nexuses.find(n => n.team === team)!;
  const enemyNex = state.nexuses.find(n => n.team === 1)!;

  // Classify units (single pass)
  const aiUnits: SimUnit[] = [];
  const idle: SimUnit[] = [];
  const gatherers: SimUnit[] = [];
  const combat: SimUnit[] = [];
  let enemyThreatNearNexus = 0;

  for (const u of state.units) {
    if (u.dead) continue;
    if (u.team === team) {
      aiUnits.push(u);
      if (u.loop) {
        gatherers.push(u);
      } else if (pdist(u, { x: u.targetX, y: u.targetY }) < 30) {
        idle.push(u);
      } else {
        combat.push(u);
      }
    } else if (u.team === 1 && pdist(u, nex) < 400) {
      enemyThreatNearNexus += u.attack * u.hp;
    }
  }

  const myCamps = state.camps.filter(c => c.owner === team && state.isCampActive(c));
  const neutralCamps = state.camps.filter(c => c.owner === 0 && state.isCampActive(c));
  const enemyCamps = state.camps.filter(c => c.owner === 1 && state.isCampActive(c));
  const totalPower = aiUnits.reduce((s, u) => s + u.attack * u.hp, 0);

  // Phase decision
  let phase: 'expand' | 'build' | 'attack' | 'defend';
  if (enemyThreatNearNexus > totalPower * 0.3) {
    phase = 'defend';
  } else if (neutralCamps.length > 0 && myCamps.length < 4) {
    phase = 'expand';
  } else if (aiUnits.length < 15 || stock.carrot < 10) {
    phase = 'build';
  } else {
    phase = 'attack';
  }

  // 1. Economy
  aiManageEconomy(team, stock, myCamps, aiUnits, idle, gatherers, phase, state);

  // 2. Equipment
  aiManageEquipment(team, stock, state);

  // 3. Equip idle units
  aiEquipUnits(team, idle, state);

  // 4. Phase-specific combat orders
  switch (phase) {
    case 'defend':
      aiDefend(team, nex, idle, combat, gatherers);
      break;
    case 'expand':
      aiExpand(team, idle, neutralCamps, state);
      break;
    case 'build':
      if (idle.length > 3) {
        const guards = idle.slice(0, Math.floor(idle.length * 0.5));
        sendUnitsTo(guards, nex.x + 100, nex.y - 100);
      }
      break;
    case 'attack':
      aiAttack(team, idle, combat, enemyCamps, enemyNex);
      break;
  }
}

// ─── Economy Management ───────────────────────────────────────

export function aiManageEconomy(
  team: 1 | 2,
  stock: Record<ResourceType, number>,
  myCamps: SimCamp[],
  allUnits: SimUnit[],
  idle: SimUnit[],
  gatherers: SimUnit[],
  phase: string,
  state: SimState,
): void {
  const needCarrot = stock.carrot < 15;
  const needMeat = stock.meat < 10;
  const needCrystal = stock.crystal < 5 && state.currentEra >= 4;
  const needMetal = stock.metal < 5 && state.getEquipLevel(team, 'pickaxe') > 0;

  const targetGatherers = Math.ceil(allUnits.length * (needCarrot || needMeat ? 0.45 : 0.25));
  const gatherersNeeded = targetGatherers - gatherers.length;

  if (gatherersNeeded > 0 && idle.length > 0) {
    const toAssign = idle.splice(0, Math.min(gatherersNeeded, idle.length));

    for (const u of toAssign) {
      let resType: ResourceType = 'carrot';
      let deliverTo = 'base';

      if (needMetal && u.equipment === 'pickaxe') {
        u.loop = { steps: [{ action: 'mine' } as any, { action: 'deliver', target: 'base' } as any], currentStep: 0, label: 'mine metal', loopFrom: 0, playedOnce: false };
        continue;
      } else if (needMeat) {
        resType = 'meat';
        const meatCamp = myCamps.find(c => SPAWN_COSTS[c.animalType]?.type === 'meat');
        if (meatCamp) deliverTo = meatCamp.id;
      } else if (needCrystal) {
        resType = 'crystal';
        const crystalCamp = myCamps.find(c => SPAWN_COSTS[c.animalType]?.type === 'crystal');
        if (crystalCamp) deliverTo = crystalCamp.id;
      } else {
        const carrotCamp = myCamps.find(c => SPAWN_COSTS[c.animalType]?.type === 'carrot');
        if (carrotCamp) deliverTo = carrotCamp.id;
      }

      u.loop = makeGatherWorkflow(resType, deliverTo);
    }
  }

  // Convert excess gatherers back to fighters
  if (gatherers.length > targetGatherers + 3 && phase === 'attack') {
    const excess = gatherers.slice(0, gatherers.length - targetGatherers);
    for (const u of excess) { u.loop = null; }
    idle.push(...excess);
  }
}

// ─── Equipment Management ─────────────────────────────────────

export function aiManageEquipment(
  team: 1 | 2,
  stock: Record<ResourceType, number>,
  state: SimState,
): void {
  // Priority: pickaxe -> sword -> boots -> shield -> banner
  const queue: EquipmentType[] = ['pickaxe', 'sword', 'boots', 'shield', 'banner'];

  for (const next of queue) {
    const currentLevel = state.getEquipLevel(team, next);
    if (currentLevel >= 1) {
      // Try level 2 if era >= 3
      if (currentLevel < 2 && state.currentEra >= 3) {
        unlockEquipment(team, next, state);
      }
      continue;
    }
    // Check prereqs
    const prereqs = EQUIPMENT_PREREQS[next];
    const prereqsMet = prereqs.every(p => state.getEquipLevel(team, p) >= 1);
    if (!prereqsMet) continue;
    // Try to unlock
    unlockEquipment(team, next, state);
    break; // only try one per tick
  }
}

// ─── Equip Units ──────────────────────────────────────────────

export function aiEquipUnits(team: 1 | 2, idle: SimUnit[], state: SimState): void {
  const priorities: EquipmentType[] = ['sword', 'boots', 'shield', 'pickaxe', 'banner'];
  for (const eqType of priorities) {
    if (state.getEquipLevel(team, eqType) <= 0) continue;

    for (const u of idle) {
      if (u.equipment) continue;
      if (u.type === 'gnome' && eqType !== 'pickaxe') continue;
      if (eqType === 'pickaxe' && u.type !== 'gnome' && u.type !== 'turtle') continue;

      u.loop = {
        steps: [{ action: 'equip', equipmentType: eqType } as any],
        currentStep: 0, label: `equip ${eqType}`, loopFrom: -1, playedOnce: false,
      };
      return; // one equip per tick
    }
  }
}

// ─── Defend ───────────────────────────────────────────────────

export function aiDefend(
  team: 1 | 2,
  nex: { x: number; y: number },
  idle: SimUnit[],
  combat: SimUnit[],
  gatherers: SimUnit[],
): void {
  const allAvailable = [...idle, ...combat];
  const pullGatherers = gatherers.slice(0, Math.floor(gatherers.length * 0.5));
  for (const u of pullGatherers) { u.loop = null; }
  allAvailable.push(...pullGatherers);

  if (allAvailable.length > 0) {
    sendUnitsTo(allAvailable, nex.x, nex.y);
  }
}

// ─── Expand ───────────────────────────────────────────────────

export function aiExpand(
  team: 1 | 2,
  idle: SimUnit[],
  neutralCamps: SimCamp[],
  state: SimState,
): void {
  if (idle.length === 0) return;

  const sorted = neutralCamps
    .sort((a, b) => a.tier - b.tier || pdist2(a, P2_BASE) - pdist2(b, P2_BASE));

  for (const camp of sorted) {
    let defPower = 0;
    for (const u of state.units) {
      if (u.dead || u.team !== 0 || u.campId !== camp.id) continue;
      defPower += u.attack * u.hp;
    }

    const idlePower = idle.reduce((s, u) => s + u.attack * u.hp, 0);
    if (idlePower > defPower * 1.3) {
      sendUnitsTo(idle, camp.x, camp.y);
      return;
    }
  }

  // Can't take any camp, rally near nearest neutral
  if (sorted.length > 0 && idle.length >= 3) {
    const nearest = sorted[0];
    const rallyX = nearest.x + (P2_BASE.x > nearest.x ? 100 : -100);
    const rallyY = nearest.y + (P2_BASE.y > nearest.y ? 100 : -100);
    sendUnitsTo(idle, rallyX, rallyY);
  }
}

// ─── Attack ───────────────────────────────────────────────────

export function aiAttack(
  team: 1 | 2,
  idle: SimUnit[],
  combat: SimUnit[],
  enemyCamps: SimCamp[],
  enemyNex: { x: number; y: number },
): void {
  if (idle.length === 0) return;

  // Attack weakest enemy camp first
  if (enemyCamps.length > 0) {
    const weakest = enemyCamps
      .sort((a, b) => a.tier - b.tier || pdist2(a, P2_BASE) - pdist2(b, P2_BASE))[0];
    sendUnitsTo(idle, weakest.x, weakest.y);
    return;
  }

  // No enemy camps left — push nexus
  if (idle.length >= 5) {
    const allForce = [...idle];
    if (combat.length > 3) {
      allForce.push(...combat.slice(0, Math.floor(combat.length * 0.5)));
    }
    sendUnitsTo(allForce, enemyNex.x, enemyNex.y);
  }
}
