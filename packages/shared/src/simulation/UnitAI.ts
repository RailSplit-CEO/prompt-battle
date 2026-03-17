// ─── UnitAI.ts ─────────────────────────────────────────────────
// Workflow state machine and resource economy systems extracted
// from HordeScene. All pure logic — no Phaser dependencies.
// ────────────────────────────────────────────────────────────────

import type {
  SimState,
  SimUnit,
  SimGroundItem,
  SimCamp,
  ResourceType,
  WorkflowStep,
  BehaviorMods,
} from './SimTypes';

import { DEFAULT_MODS } from './SimTypes';

import {
  ANIMALS,
  SPAWN_COSTS,
  PICKUP_RANGE,
  DELIVER_RANGE,
  CARROT_SPAWN_MS,
  ITEM_DESPAWN_MS,
  MINE_RANGE,
  MINE_TICK_MS,
  ARMORY_RANGE,
  WORLD_W,
  WORLD_H,
  P1_BASE,
  P2_BASE,
  EQUIP_LEVEL_STAT_MULT,
} from './Constants';

// ─── Helpers ──────────────────────────────────────────────────

function pdist(a: { x: number; y: number }, b: { x: number; y: number }): number {
  const dx = a.x - b.x, dy = a.y - b.y;
  return Math.sqrt(dx * dx + dy * dy);
}

function pdist2(a: { x: number; y: number }, b: { x: number; y: number }): number {
  const dx = a.x - b.x, dy = a.y - b.y;
  return dx * dx + dy * dy;
}

// ─── Advance / Clear helpers ──────────────────────────────────

export function advanceWorkflow(u: SimUnit): void {
  if (!u.loop) return;
  const next = u.loop.currentStep + 1;
  if (next >= u.loop.steps.length) {
    u.loop.currentStep = u.loop.loopFrom;
    u.loop.playedOnce = true;
  } else {
    u.loop.currentStep = next;
  }
  u.pathWaypoints = null; // invalidate A* path on step change
}

export function clearCarrying(u: SimUnit): void {
  u.carrying = null;
  // Advance workflow to next step after delivery
  if (u.loop) advanceWorkflow(u);
}

export function resolveDeliverTarget(
  target: string,
  team: 1 | 2,
  state: SimState,
): { x: number; y: number } | null {
  if (target === 'base') {
    return team === 1 ? P1_BASE : P2_BASE;
  }
  // "nearest_TYPE_camp" pattern
  const nearestMatch = target.match(/^nearest_(\w+)_camp$/);
  if (nearestMatch) {
    const animalType = nearestMatch[1];
    const base = team === 1 ? P1_BASE : P2_BASE;
    let camp: SimCamp | null = null, campD = Infinity;
    for (const c of state.camps) {
      if (c.owner !== team || c.animalType !== animalType) continue;
      const d = pdist2(c, base);
      if (d < campD) { campD = d; camp = c; }
    }
    return camp;
  }
  // Direct camp ID
  const camp = state.camps.find(c => c.id === target && c.owner === team);
  return camp || null;
}

export function trySpawnFromDelivery(
  team: 1 | 2,
  location: 'base' | string,
  state: SimState,
): void {
  if (location === 'base') return; // Base only stores — no spawning
  let camp: SimCamp | undefined;
  for (let i = 0; i < state.camps.length; i++) {
    if (state.camps[i].id === location) { camp = state.camps[i]; break; }
  }
  if (!camp || camp.owner !== team) return;

  // Check supply cap
  const unitSupply = state.getSupplyCost(camp.animalType);
  if (state.getTeamSupply(team) + unitSupply > state.getMaxSupply(team)) return;

  const cost = SPAWN_COSTS[camp.animalType];
  if (!cost || camp.storedFood < cost.amount) return;
  // Check secondary cost from base stockpile
  if (cost.secondary) {
    const stock = state.baseStockpile[team][cost.secondary.type];
    if (stock < cost.secondary.amount) return;
  }
  camp.storedFood -= cost.amount;
  if (cost.secondary) {
    state.baseStockpile[team][cost.secondary.type] -= cost.secondary.amount;
  }
  state.spawnUnit(camp.animalType, team, camp.x + 20, camp.y + 30);
}

/** Returns the carrot zone closest to the team's base. */
function getHomeCarrotZone(
  team: 1 | 2,
  state: SimState,
): { x: number; y: number; w: number; h: number } | null {
  const zones = state.mapDef?.carrotZones;
  if (!zones || zones.length === 0) return null;
  const base = team === 1 ? P1_BASE : P2_BASE;
  let best = zones[0], bestD = Infinity;
  for (const z of zones) {
    const cx = z.x + z.w / 2, cy = z.y + z.h / 2;
    const d = (cx - base.x) ** 2 + (cy - base.y) ** 2;
    if (d < bestD) { bestD = d; best = z; }
  }
  return best;
}

function spreadOut(u: SimUnit, state: SimState): void {
  if (pdist(u, { x: u.targetX, y: u.targetY }) > 30) return;
  if (!u.loop) return;
  const step = u.loop.steps[u.loop.currentStep];
  if (!step) return;

  // For carrot seeking: spread within the team's home carrot zone
  if (step.action === 'seek_resource' && (step as any).resourceType === 'carrot' && u.team !== 0) {
    const zone = getHomeCarrotZone(u.team as 1 | 2, state);
    if (zone) {
      u.targetX = zone.x + Math.random() * zone.w;
      u.targetY = zone.y + Math.random() * zone.h;
      return;
    }
  }

  // Gather all allies on the same workflow action
  const searchers = state.units.filter(a =>
    !a.dead && a.team === u.team
    && a.loop && a.loop.steps[a.loop.currentStep]?.action === step.action);

  const cx = WORLD_W / 2, cy = WORLD_H / 2;

  if (searchers.length <= 1) {
    const angle = Math.random() * Math.PI * 2;
    const range = 300 + Math.random() * 500;
    u.targetX = Math.max(100, Math.min(WORLD_W - 100, cx + Math.cos(angle) * range));
    u.targetY = Math.max(100, Math.min(WORLD_H - 100, cy + Math.sin(angle) * range));
  } else {
    // Find average position of peers
    let avgX = 0, avgY = 0;
    for (const s of searchers) { avgX += s.x; avgY += s.y; }
    avgX /= searchers.length; avgY /= searchers.length;
    // Move away from peers
    const dx = u.x - avgX, dy = u.y - avgY;
    const len = Math.sqrt(dx * dx + dy * dy) || 1;
    const range = 200 + Math.random() * 300;
    u.targetX = Math.max(100, Math.min(WORLD_W - 100, u.x + (dx / len) * range));
    u.targetY = Math.max(100, Math.min(WORLD_H - 100, u.y + (dy / len) * range));
  }
}

// ─── Carrot Spawning ──────────────────────────────────────────

export function updateCarrotSpawning(delta: number, state: SimState): void {
  state.carrotSpawnTimer += delta;
  if (state.carrotSpawnTimer < CARROT_SPAWN_MS) return;
  state.carrotSpawnTimer -= CARROT_SPAWN_MS;

  if (state.mapDef && state.mapDef.carrotZones.length > 0) {
    const zones = state.mapDef.carrotZones;
    for (const zone of zones) {
      const x = zone.x + Math.random() * zone.w;
      const y = zone.y + Math.random() * zone.h;
      state.spawnGroundItem('carrot', x, y);
    }
    // +1 bonus in a random zone
    const bonus = zones[Math.floor(Math.random() * zones.length)];
    state.spawnGroundItem('carrot', bonus.x + Math.random() * bonus.w, bonus.y + Math.random() * bonus.h);
  } else {
    const MARGIN = 100;
    const cx = WORLD_W / 2, cy = WORLD_H / 2;
    const x = MARGIN + Math.random() * (cx - MARGIN);
    const y = cy + Math.random() * (cy - MARGIN);
    state.spawnGroundItem('carrot', x, y);
    // Mirror to P2's half
    state.spawnGroundItem('carrot', WORLD_W - x, WORLD_H - y);
  }
}

// ─── Ground Items ─────────────────────────────────────────────

export function updateGroundItems(delta: number, state: SimState): void {
  for (const item of state.groundItems) {
    if (item.dead) continue;
    item.age += delta;
    if (item.age >= ITEM_DESPAWN_MS) { item.dead = true; continue; }
  }
  // In-place compaction
  let writeIdx = 0;
  for (let readIdx = 0; readIdx < state.groundItems.length; readIdx++) {
    const i = state.groundItems[readIdx];
    if (!i.dead) {
      state.groundItems[writeIdx++] = i;
    }
  }
  state.groundItems.length = writeIdx;
}

// ─── Resource Pickup ──────────────────────────────────────────

export function updateResourcePickup(state: SimState): void {
  for (const u of state.units) {
    if (u.dead || u.carrying || u.team === 0) continue;
    if (!u.loop) continue;
    const curStep = u.loop.steps[u.loop.currentStep];
    if (!curStep || (curStep.action !== 'seek_resource' && curStep.action !== 'collect' && curStep.action !== 'hunt')) continue;

    // Gnome Nimble Hands: 2x pickup range
    let range = u.type === 'gnome' ? PICKUP_RANGE * 2 : PICKUP_RANGE;
    range *= state.getUnitEquipBuffs(u).pickupRange;

    for (const item of state.groundItems) {
      if (item.dead) continue;
      // Filter by matching resource type
      if (curStep.action === 'seek_resource' && item.type !== (curStep as any).resourceType) continue;
      if (curStep.action === 'collect' && item.type !== (curStep as any).resourceType) continue;
      if (curStep.action === 'hunt') {
        let huntRes: string | null = null;
        for (let i = 1; i < u.loop!.steps.length; i++) {
          const next = u.loop!.steps[(u.loop!.currentStep + i) % u.loop!.steps.length];
          if (next.action === 'seek_resource' && (next as any).resourceType) { huntRes = (next as any).resourceType; break; }
        }
        if (!huntRes) huntRes = (curStep as any).targetType === 'minotaur' ? 'crystal' : 'meat';
        if (item.type !== huntRes) continue;
      }
      if (pdist(u, item) < range) {
        u.carrying = item.type;
        u.claimItemId = -1;
        item.dead = true;
        // Advance workflow past seek/collect step
        if (curStep.action === 'seek_resource' || curStep.action === 'collect') advanceWorkflow(u);
        break;
      }
    }
  }
}

// ─── Deliveries ───────────────────────────────────────────────

export function updateDeliveries(state: SimState): void {
  for (const u of state.units) {
    if (u.dead || !u.carrying || u.team === 0) continue;
    const team = u.team as 1 | 2;
    const base = team === 1 ? P1_BASE : P2_BASE;

    // Turtle carries 10x per trip
    const carryAmount = u.type === 'turtle' ? 10 : 1;

    // Deliver to own base
    if (pdist(u, base) < DELIVER_RANGE) {
      let wantsBaseDelivery = true;
      if (u.loop) {
        const curStep = u.loop.steps[u.loop.currentStep];
        if (curStep?.action === 'deliver' && 'target' in curStep && (curStep as { target: string }).target.includes('_camp')) {
          wantsBaseDelivery = false;
        }
        if (wantsBaseDelivery) {
          let deliverStep: typeof curStep | undefined;
          let hasWithdraw = false;
          for (let si = 0; si < u.loop.steps.length; si++) {
            const s = u.loop.steps[si];
            if (!deliverStep && s.action === 'deliver') deliverStep = s;
            if (s.action === 'withdraw_base') hasWithdraw = true;
          }
          if (deliverStep && deliverStep.action === 'deliver' && (deliverStep as { target: string }).target.includes('_camp') && hasWithdraw) {
            wantsBaseDelivery = false;
          }
        }
      }
      if (wantsBaseDelivery) {
        const upkeepMult = state.getUpkeepRate(team);
        const effectiveAmount = Math.max(1, Math.round(carryAmount * upkeepMult));
        state.matchStats.resourcesDelivered[team][u.carrying] += effectiveAmount;
        state.baseStockpile[team][u.carrying] += effectiveAmount;
        clearCarrying(u);
        trySpawnFromDelivery(team, 'base', state);
        continue;
      }
    }

    // Collect workflow only delivers to base, never camps
    if (u.loop) {
      const curStep = u.loop.steps[u.loop.currentStep];
      if (curStep?.action === 'collect') continue;
    }

    // Deliver to owned camp that needs this resource type
    for (const camp of state.camps) {
      if (camp.owner !== team) continue;
      if (u.loop) {
        let deliverStep: WorkflowStep | undefined;
        for (let si = 0; si < u.loop.steps.length; si++) {
          if (u.loop.steps[si].action === 'deliver') { deliverStep = u.loop.steps[si]; break; }
        }
        if (deliverStep && deliverStep.action === 'deliver') {
          const match = (deliverStep as any).target.match(/^nearest_(\w+)_camp$/);
          if (match && camp.animalType !== match[1]) continue;
        }
      }
      if (pdist(u, camp) < DELIVER_RANGE) {
        const cost = SPAWN_COSTS[camp.animalType];
        if (cost && cost.type === u.carrying) {
          state.matchStats.resourcesDelivered[team][u.carrying] += carryAmount;
          camp.storedFood += carryAmount;
          clearCarrying(u);
          trySpawnFromDelivery(team, camp.id, state);
        }
        break;
      }
    }
  }
}

// ─── Workflow Engine ──────────────────────────────────────────

export function updateWorkflows(state: SimState): void {
  const dt = state.lastDeltaMs;

  // Build set of item IDs currently claimed by living units
  const claimedItems = new Set<number>();
  for (const u of state.units) {
    if (!u.dead && u.claimItemId >= 0) {
      const item = state.groundItemById(u.claimItemId);
      if (item && !item.dead) {
        claimedItems.add(u.claimItemId);
      } else {
        u.claimItemId = -1;
      }
    }
  }
  const claimCounts = new Map<number, number>();
  for (const u of state.units) {
    if (!u.dead && u.claimItemId >= 0) {
      claimCounts.set(u.claimItemId, (claimCounts.get(u.claimItemId) || 0) + 1);
    }
  }

  for (const u of state.units) {
    if (u.dead || u.team === 0) continue;

    // Units with a loop that are idle for ~4s restart their loop
    if (u.loop) {
      const distToTarget = Math.sqrt((u.targetX - u.x) ** 2 + (u.targetY - u.y) ** 2);
      const isIdle = distToTarget < 10 && !u.carrying && u.animState !== 'attack';
      if (isIdle) {
        u.idleTimer += dt;
        const idleThreshold = u.mods.pacing === 'rush' ? 1500 : u.mods.pacing === 'efficient' ? 6000 : 4000;
        if (u.idleTimer >= idleThreshold) {
          u.loop.currentStep = u.loop.playedOnce ? u.loop.loopFrom : 0;
          u.idleTimer = 0;
        }
      } else {
        u.idleTimer = 0;
      }
    }

    if (!u.loop) continue;
    const team = u.team as 1 | 2;
    const base = team === 1 ? P1_BASE : P2_BASE;
    const step = u.loop.steps[u.loop.currentStep];
    if (!step) continue;

    switch (step.action) {
      case 'seek_resource': {
        const stepRes = (step as any).resourceType as ResourceType;
        if (u.carrying) {
          if (u.carrying !== stepRes) {
            state.spawnGroundItem(u.carrying, u.x, u.y);
            u.carrying = null;
          } else {
            u.claimItemId = -1;
            advanceWorkflow(u);
            break;
          }
        }
        // Invalidate claim if item is gone
        const hadSeekClaim = u.claimItemId >= 0;
        if (u.claimItemId >= 0) {
          const claimed = state.groundItemById(u.claimItemId);
          if (!claimed || claimed.dead || (!state.fogDisabled && !state.isInVision(claimed.x, claimed.y))) u.claimItemId = -1;
        }
        // Home zone bias for carrots
        const homeZone = getHomeCarrotZone(team, state);
        const inZone = (ix: number, iy: number) =>
          homeZone && ix >= homeZone.x && ix < homeZone.x + homeZone.w
                   && iy >= homeZone.y && iy < homeZone.y + homeZone.h;
        let bestItem: SimGroundItem | null = null, bestItemD = Infinity;
        for (const item of state.groundItems) {
          if (item.dead || item.type !== stepRes) continue;
          if (!state.fogDisabled && !state.isInVision(item.x, item.y)) continue;
          if (claimedItems.has(item.id) && item.id !== u.claimItemId) continue;
          let itemD = pdist(u, item);
          if (stepRes === 'carrot' && homeZone && !inZone(item.x, item.y)) {
            itemD *= 2.5;
          }
          if (itemD < bestItemD) { bestItemD = itemD; bestItem = item; }
        }
        if (bestItem) {
          if (u.claimItemId >= 0 && u.claimItemId !== bestItem.id) claimedItems.delete(u.claimItemId);
          u.claimItemId = bestItem.id;
          claimedItems.add(bestItem.id);
          u.targetX = bestItem.x; u.targetY = bestItem.y;
        } else if (u.claimItemId >= 0) {
          const claimed = state.groundItemById(u.claimItemId)!;
          u.targetX = claimed.x; u.targetY = claimed.y;
        } else {
          const claimJustLost = hadSeekClaim && u.claimItemId < 0;
          if (claimJustLost || pdist(u, { x: u.targetX, y: u.targetY }) < 30) {
            if (stepRes === 'carrot') {
              const zone = getHomeCarrotZone(team, state);
              if (zone) {
                u.targetX = zone.x + Math.random() * zone.w;
                u.targetY = zone.y + Math.random() * zone.h;
              } else {
                spreadOut(u, state);
              }
            } else {
              spreadOut(u, state);
            }
          }
        }
        break;
      }

      case 'deliver': {
        if (!u.carrying) {
          advanceWorkflow(u);
          break;
        }
        const campMatch = (step as any).target.match(/^nearest_(\w+)_camp$/);
        if (campMatch) {
          const expectedCost = SPAWN_COSTS[campMatch[1]];
          if (expectedCost && expectedCost.type !== u.carrying) {
            state.spawnGroundItem(u.carrying, u.x, u.y);
            u.carrying = null;
            if (u.loop) {
              u.loop.currentStep = u.loop.loopFrom;
              u.pathWaypoints = null;
            }
            break;
          }
        }
        const target = resolveDeliverTarget((step as any).target, team, state);
        if (target) {
          u.targetX = target.x; u.targetY = target.y;
        } else {
          state.spawnGroundItem(u.carrying, u.x, u.y);
          u.carrying = null;
          if (u.loop) {
            u.loop.currentStep = u.loop.playedOnce ? u.loop.loopFrom : 0;
          } else {
            u.targetX = base.x; u.targetY = base.y;
          }
        }
        break;
      }

      case 'hunt': {
        if (u.carrying) { advanceWorkflow(u); break; }
        const huntResType: ResourceType | null = (() => {
          if (!u.loop) return null;
          for (let i = 1; i < u.loop.steps.length; i++) {
            const next = u.loop.steps[(u.loop.currentStep + i) % u.loop.steps.length];
            if (next.action === 'seek_resource') return ((next as any).resourceType as ResourceType) || null;
          }
          return (step as any).targetType === 'minotaur' ? 'crystal' : 'meat';
        })();

        // Look on ground first
        if (huntResType) {
          let nearestRes: SimGroundItem | null = null, nearestResD = Infinity;
          for (const i of state.groundItems) {
            if (i.dead || i.type !== huntResType) continue;
            if (!state.fogDisabled && !state.isInVision(i.x, i.y)) continue;
            if (claimedItems.has(i.id) && i.id !== u.claimItemId) continue;
            const d = pdist2(u, i);
            if (d < nearestResD) { nearestResD = d; nearestRes = i; }
          }
          if (nearestRes) {
            if (u.claimItemId >= 0) claimedItems.delete(u.claimItemId);
            u.claimItemId = nearestRes.id;
            claimedItems.add(nearestRes.id);
            u.targetX = nearestRes.x; u.targetY = nearestRes.y;
            break;
          }
        }

        // Hunt lowest tier wild animal in vision
        const myTier = ANIMALS[u.type]?.tier || 1;
        let bestPrey: SimUnit | null = null, bestPreyTier = Infinity, bestPreyD = Infinity;
        for (const w of state.units) {
          if (w.team !== 0 || w.dead || w.campId) continue;
          if (!state.fogDisabled && !state.isInVision(w.x, w.y)) continue;
          if ((step as any).targetType && w.type !== (step as any).targetType) continue;
          if (u.mods.caution === 'safe' && (ANIMALS[w.type]?.tier || 1) > myTier) continue;
          const wTier = ANIMALS[w.type]?.tier || 1;
          const wD = pdist2(u, w);
          if (wTier < bestPreyTier || (wTier === bestPreyTier && wD < bestPreyD)) {
            bestPreyTier = wTier; bestPreyD = wD; bestPrey = w;
          }
        }
        if (bestPrey) {
          u.targetX = bestPrey.x; u.targetY = bestPrey.y;
        } else {
          spreadOut(u, state);
        }
        break;
      }

      case 'attack_camp': {
        if ((step as any).targetAnimal) {
          const ownedOfType = state.camps.some(c => c.animalType === (step as any).targetAnimal && c.owner === team);
          if (ownedOfType) { advanceWorkflow(u); break; }
        }
        if (u.carrying) {
          state.spawnGroundItem(u.carrying, u.x, u.y);
          u.carrying = null;
        }
        let targetCamp: SimCamp | undefined;
        if ((step as any).campIndex !== undefined && (step as any).campIndex >= 0) {
          targetCamp = state.camps[(step as any).campIndex];
        } else if ((step as any).targetAnimal) {
          const qualifier = (step as any).qualifier || 'nearest';
          const filtered = state.camps.filter(c =>
            c.animalType === (step as any).targetAnimal && c.owner !== team
            && (state.fogDisabled || state.isInVision(c.x, c.y)));
          if (qualifier === 'nearest') filtered.sort((a, b) => pdist2(a, base) - pdist2(b, base));
          targetCamp = filtered[0];
        }
        if (targetCamp) {
          u.targetX = targetCamp.x; u.targetY = targetCamp.y;
          // Tight formation: wait for group
          if (u.mods.formation === 'tight' && targetCamp.owner !== team) {
            const allies = state.units.filter(a => !a.dead && a.team === team && a.type === u.type
              && a.loop?.steps[a.loop.currentStep]?.action === 'attack_camp');
            const nearCamp = allies.filter(a => pdist(a, targetCamp!) < 120);
            if (nearCamp.length < allies.length * 0.6) {
              const distToCamp = pdist(u, targetCamp);
              if (distToCamp < 130) {
                u.targetX = u.x; u.targetY = u.y;
              }
              break;
            }
          }
          if (targetCamp.owner === team) advanceWorkflow(u);
        } else {
          spreadOut(u, state);
        }
        break;
      }

      case 'move': {
        u.targetX = (step as any).x; u.targetY = (step as any).y;
        if (pdist(u, { x: (step as any).x, y: (step as any).y }) < 20) advanceWorkflow(u);
        break;
      }

      case 'defend': {
        const guardPos = resolveDeliverTarget((step as any).target, team, state) || base;
        const distToGuard = pdist(u, guardPos);
        if (u.mods.caution === 'safe' && u.hp / u.maxHp < 0.4 && distToGuard > 30) {
          u.targetX = guardPos.x; u.targetY = guardPos.y;
          break;
        }
        const defendDetect = u.mods.caution === 'aggressive' ? 375 : u.mods.caution === 'safe' ? 150 : 250;
        const defendLeash = u.mods.caution === 'aggressive' ? 180 : u.mods.caution === 'safe' ? 80 : 120;
        const defendPatrol = u.mods.caution === 'aggressive' ? 50 + Math.random() * 80 : u.mods.caution === 'safe' ? 15 + Math.random() * 30 : 30 + Math.random() * 60;
        if (distToGuard > defendLeash) {
          u.targetX = guardPos.x; u.targetY = guardPos.y;
        } else {
          let nearestDefEnemy: SimUnit | null = null, nearestDefD = Infinity;
          for (const e of state.units) {
            if (e.dead || e.team === 0 || e.team === team) continue;
            if (pdist(e, guardPos) > defendDetect) continue;
            const d = pdist2(u, e);
            if (d < nearestDefD) { nearestDefD = d; nearestDefEnemy = e; }
          }
          if (nearestDefEnemy) {
            u.targetX = nearestDefEnemy.x; u.targetY = nearestDefEnemy.y;
          } else {
            if (pdist(u, { x: u.targetX, y: u.targetY }) < 12) {
              const a = Math.random() * Math.PI * 2;
              const r = defendPatrol;
              u.targetX = guardPos.x + Math.cos(a) * r;
              u.targetY = guardPos.y + Math.sin(a) * r;
            }
          }
        }
        break;
      }

      case 'attack_enemies': {
        const enemyTeam = team === 1 ? 2 : 1;
        let nearestEnemy: SimUnit | null = null, nearestEnemyD = Infinity;
        for (const e of state.units) {
          if (e.dead || e.team !== enemyTeam) continue;
          const d = pdist2(u, e);
          if (d < nearestEnemyD) { nearestEnemyD = d; nearestEnemy = e; }
        }
        if (nearestEnemy) {
          u.targetX = nearestEnemy.x; u.targetY = nearestEnemy.y;
        } else {
          const enemyBase = team === 1 ? P2_BASE : P1_BASE;
          u.targetX = enemyBase.x; u.targetY = enemyBase.y;
        }
        break;
      }

      case 'scout': {
        const scoutRegionX = (step as any).x;
        const scoutRegionY = (step as any).y;
        const hasRegion = scoutRegionX !== undefined && scoutRegionY !== undefined;
        const isMultiScout = hasRegion && u.loop!.steps.filter(s => s.action === 'scout').length > 1;

        if (pdist(u, { x: u.targetX, y: u.targetY }) < 30) {
          if (hasRegion) {
            u.idleTimer += 1;
            if (isMultiScout && u.idleTimer >= 3) {
              u.idleTimer = 0;
              advanceWorkflow(u);
              break;
            }
            const spread = 600;
            u.targetX = Math.max(50, Math.min(WORLD_W - 50, scoutRegionX + (Math.random() - 0.5) * spread * 2));
            u.targetY = Math.max(50, Math.min(WORLD_H - 50, scoutRegionY + (Math.random() - 0.5) * spread * 2));
          } else {
            const scoutTarget = state.camps
              .filter(c => pdist(u, c) > 200)
              .sort((a, b) => pdist2(u, b) - pdist2(u, a));
            if (scoutTarget.length > 0) {
              const pick = scoutTarget[Math.floor(Math.random() * Math.min(3, scoutTarget.length))];
              u.targetX = pick.x; u.targetY = pick.y;
            } else {
              u.targetX = 100 + Math.random() * (WORLD_W - 200);
              u.targetY = 100 + Math.random() * (WORLD_H - 200);
            }
          }
        }
        break;
      }

      case 'collect': {
        if (u.carrying) {
          u.targetX = base.x; u.targetY = base.y;
          break;
        }
        if (u.claimItemId >= 0) {
          const claimed = state.groundItemById(u.claimItemId);
          if (claimed && !claimed.dead && (state.fogDisabled || state.isInVision(claimed.x, claimed.y))) {
            u.targetX = claimed.x; u.targetY = claimed.y;
            break;
          }
          u.claimItemId = -1;
        }
        const collectRes = (step as any).resourceType as ResourceType;
        let bestCollectItem: SimGroundItem | null = null, bestCollectD = Infinity;
        for (const item of state.groundItems) {
          if (item.dead || item.type !== collectRes) continue;
          if (!state.fogDisabled && !state.isInVision(item.x, item.y)) continue;
          if (claimedItems.has(item.id)) continue;
          const itemD = pdist(u, item);
          if (itemD < bestCollectD) { bestCollectD = itemD; bestCollectItem = item; }
        }
        if (bestCollectItem) {
          u.claimItemId = bestCollectItem.id;
          claimedItems.add(bestCollectItem.id);
          u.targetX = bestCollectItem.x; u.targetY = bestCollectItem.y;
        } else {
          if (pdist(u, base) > 200) { u.targetX = base.x; u.targetY = base.y; }
        }
        break;
      }

      case 'kill_only': {
        const myKillTier = ANIMALS[u.type]?.tier || 1;
        let bestKill: SimUnit | null = null, bestKillD = Infinity;
        for (const w of state.units) {
          if (w.team !== 0 || w.dead || w.campId) continue;
          if (!state.fogDisabled && !state.isInVision(w.x, w.y)) continue;
          if ((step as any).targetType && w.type !== (step as any).targetType) continue;
          if (u.mods.caution === 'safe' && (ANIMALS[w.type]?.tier || 1) > myKillTier) continue;
          const d = pdist2(u, w);
          if (d < bestKillD) { bestKillD = d; bestKill = w; }
        }
        if (bestKill) {
          u.targetX = bestKill.x; u.targetY = bestKill.y;
        }
        break;
      }

      case 'mine': {
        if (u.carrying) { advanceWorkflow(u); break; }
        if (u.equipment !== 'pickaxe') { advanceWorkflow(u); break; }
        let nearestMine: { x: number; y: number } | null = null, nearestMineD = Infinity;
        for (const m of state.mineNodes) {
          if (!state.fogDisabled && !state.isInVision(m.x, m.y)) continue;
          const d = pdist2(u, m);
          if (d < nearestMineD) { nearestMineD = d; nearestMine = m; }
        }
        if (nearestMine) {
          u.targetX = nearestMine.x; u.targetY = nearestMine.y;
          if (pdist(u, nearestMine) < MINE_RANGE) {
            const mineSpeedMul = ANIMALS[u.type]?.mineSpeed || 1.0;
            const tickMs = MINE_TICK_MS / mineSpeedMul;
            u.idleTimer += dt;
            if (u.idleTimer >= tickMs) {
              u.idleTimer -= tickMs;
              u.carrying = 'metal';
            }
          }
        } else {
          spreadOut(u, state);
        }
        break;
      }

      case 'equip': {
        const eqType = (step as any).equipmentType;
        const teamEqLevel = state.getEquipLevel(team, eqType);
        if (!eqType || (u.equipment === eqType && u.equipLevel >= teamEqLevel)) { advanceWorkflow(u); break; }
        if (!state.unlockedEquipment[team].has(eqType)) { advanceWorkflow(u); break; }
        const armory = state.armories.find(a => a.team === team && a.equipmentType === eqType);
        if (!armory) { advanceWorkflow(u); break; }
        u.targetX = armory.x; u.targetY = armory.y;
        if (pdist(u, armory) < ARMORY_RANGE) {
          // Remove old shield HP bonus
          if (u.equipment === 'shield' && u.equipLevel > 0) {
            const oldLm = EQUIP_LEVEL_STAT_MULT[u.equipLevel] || 1;
            const bonus = Math.round(u.maxHp * (0.60 * oldLm / (1 + 0.60 * oldLm)));
            u.maxHp -= bonus; u.hp = Math.min(u.hp, u.maxHp);
          }
          u.equipment = eqType;
          u.equipLevel = teamEqLevel;
          // Apply new shield HP bonus
          if (eqType === 'shield') {
            const lm = EQUIP_LEVEL_STAT_MULT[u.equipLevel] || 1;
            const bonus = u.maxHp * 0.60 * lm;
            u.maxHp += bonus; u.hp += bonus;
          }
          advanceWorkflow(u);
        }
        break;
      }

      case 'contest_event': {
        let nearestEv: { x: number; y: number; state: string } | null = null, nearestEvD = Infinity;
        for (const e of state.mapEvents) {
          if (e.state !== 'active') continue;
          const d = pdist2(u, e);
          if (d < nearestEvD) { nearestEvD = d; nearestEv = e; }
        }
        if (!nearestEv) { advanceWorkflow(u); break; }
        u.targetX = nearestEv.x; u.targetY = nearestEv.y;
        if (nearestEv.state !== 'active') {
          advanceWorkflow(u);
        }
        break;
      }

      case 'withdraw_base': {
        const wbRes = (step as any).resourceType as ResourceType;
        if (u.carrying) { advanceWorkflow(u); break; }
        const wbStock = state.baseStockpile[team];
        u.targetX = base.x; u.targetY = base.y;
        if (pdist(u, base) < DELIVER_RANGE) {
          if (wbStock[wbRes] > 0) {
            wbStock[wbRes] -= 1;
            u.carrying = wbRes;
            advanceWorkflow(u);
          } else {
            u.idleTimer += dt;
            if (u.idleTimer > 2000) {
              u.idleTimer = 0;
              advanceWorkflow(u);
            }
          }
        }
        break;
      }

      case 'upgrade': {
        const eqType = (step as any).equipmentType;
        if (!eqType) { advanceWorkflow(u); break; }
        state.unlockEquipment(team, eqType);
        advanceWorkflow(u);
        break;
      }
    }
  }
}
