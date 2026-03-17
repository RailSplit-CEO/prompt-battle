// ─── MapEvents.ts ──────────────────────────────────────────────
// Dynamic map events: fungal bloom, warchest, kill bounty,
// mercenary outpost, bottomless pit, hungry bear.
// All pure simulation — no Phaser dependencies.
// ────────────────────────────────────────────────────────────────

import type {
  SimState,
  SimUnit,
  MapEvent,
  MapEventType,
} from './SimTypes';

import {
  ANIMALS,
  SPAWN_COSTS,
  MAP_EVENT_DEFS,
  EVENT_SPOTS,
  SIMULTANEOUS_EVENTS,
  WORLD_W,
  P1_BASE,
  P2_BASE,
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

// ─── Main Update ──────────────────────────────────────────────

export function updateMapEvents(delta: number, state: SimState): void {
  if (state.gameOver) return;

  state.eventCycleTimer += delta;
  if (state.eventCycleTimer >= 120000) {
    state.eventCycleTimer -= 120000;
    spawnEventCycle(state);
  }

  for (const ev of state.mapEvents) {
    if (ev.state !== 'active') continue;
    ev.timer -= delta;
    tickEvent(ev, delta, state);
    if (ev.timer <= 0) expireEvent(ev, state);
  }

  // Hotspot continuation for fungal bloom
  for (const ev of state.mapEvents) {
    if (ev.type === 'fungal_bloom' && ev.state !== 'active' && ev.data.hotspotTimer > 0) {
      ev.data.hotspotTimer -= delta;
      ev.data.spawnTimer = (ev.data.spawnTimer || 0) + delta;
      if (ev.data.spawnTimer >= 2000) {
        ev.data.spawnTimer -= 2000;
        const angle = Math.random() * Math.PI * 2;
        const dist = Math.random() * 140;
        state.spawnGroundItem('carrot', ev.x + Math.cos(angle) * dist, ev.y + Math.sin(angle) * dist);
      }
    }
  }

  // Tick down event buffs
  for (let i = state.eventBuffs.length - 1; i >= 0; i--) {
    state.eventBuffs[i].timer -= delta;
    if (state.eventBuffs[i].timer <= 0) state.eventBuffs.splice(i, 1);
  }

  // Clean up resolved events after fade period
  for (let i = state.mapEvents.length - 1; i >= 0; i--) {
    const ev = state.mapEvents[i];
    if (ev.state !== 'active' && ev.timer < -5000) {
      state.mapEvents.splice(i, 1);
    }
  }
}

// ─── Spawn Event Cycle ────────────────────────────────────────

export function spawnEventCycle(state: SimState): void {
  const pool: MapEventType[] = [];
  for (const [type, def] of Object.entries(MAP_EVENT_DEFS)) {
    if (state.currentEra >= def.minEra && type !== state.lastEventType) {
      pool.push(type as MapEventType);
    }
  }
  if (pool.length === 0) return;

  const type = pool[Math.floor(Math.random() * pool.length)];
  const jitter = 150;
  const jit = () => (Math.random() - 0.5) * 2 * jitter;
  const clamp = (v: number) => Math.max(200, Math.min(WORLD_W - 200, v));

  if (SIMULTANEOUS_EVENTS.includes(type)) {
    // Simultaneous: spawn at BOTH top and bottom spots
    spawnEvent(type, clamp(EVENT_SPOTS.top.x + jit()), clamp(EVENT_SPOTS.top.y + jit()), state);
    spawnEvent(type, clamp(EVENT_SPOTS.bottom.x + jit()), clamp(EVENT_SPOTS.bottom.y + jit()), state);
  } else {
    // Solo: alternate between left and right spots
    state.lastSoloSide = state.lastSoloSide === 'left' ? 'right' : 'left';
    const spot = EVENT_SPOTS[state.lastSoloSide];
    spawnEvent(type, clamp(spot.x + jit()), clamp(spot.y + jit()), state);
  }

  state.lastEventType = type;
  state.eventCycleCount++;
}

function spawnEvent(type: MapEventType, x: number, y: number, state: SimState): void {
  const def = MAP_EVENT_DEFS[type];
  const era = state.currentEra;

  const ev: MapEvent = {
    id: state.nextEventId++,
    type, x, y,
    timer: def.duration,
    duration: def.duration,
    state: 'active',
    progress: { 1: 0, 2: 0 },
    claimedBy: null,
    data: {},
  };

  switch (type) {
    case 'fungal_bloom':
      ev.data = { spawnTimer: 0, pickups: { 1: 0, 2: 0 }, hotspotTimer: 0, _creditedIds: new Set<number>() };
      break;
    case 'warchest': {
      const hpByEra = [0, 200, 500, 1500, 5000, 8000];
      const hp = hpByEra[era] || 200;
      ev.data = { hp, maxHp: hp, hitTimer: 0 };
      break;
    }
    case 'kill_bounty': {
      const bountyPool: string[] = [];
      if (era >= 1) bountyPool.push('gnome', 'turtle');
      if (era >= 2) bountyPool.push('skull', 'spider', 'hyena');
      if (era >= 3) bountyPool.push('panda', 'lizard');
      const withNeutrals = bountyPool.filter(t => state.units.some(u => u.team === 0 && u.type === t && !u.dead));
      const finalPool = withNeutrals.length > 0 ? withNeutrals : bountyPool;
      const targetType = finalPool[Math.floor(Math.random() * finalPool.length)];
      const targetCount = Math.min(6 + era * 2, Math.max(3, state.units.filter(u => u.team === 0 && u.type === targetType && !u.dead).length));
      ev.data = { targetType, targetCount, kills: { 1: 0, 2: 0 }, deadChecked: new Set<number>() };
      break;
    }
    case 'mercenary_outpost': {
      let cost: { type: string; amount: number };
      if (era <= 2) cost = { type: 'meat', amount: 6 };
      else if (era === 3) cost = { type: 'crystal', amount: 4 };
      else cost = { type: 'crystal', amount: 6 };
      ev.data = { cost, deliveries: { 1: 0, 2: 0 } };
      break;
    }
    case 'bottomless_pit':
      ev.data = { sacrificesNeeded: 3 + era, sacrifices: { 1: 0, 2: 0 } };
      break;
    case 'hungry_bear':
      ev.data = { fedAmount: { 1: 0, 2: 0 }, bearSize: 1.0, bearHp: 500 + era * 500, feedTimer: 0 };
      break;
  }

  state.mapEvents.push(ev);
}

// ─── Tick Event (per-type logic) ──────────────────────────────

export function tickEvent(ev: MapEvent, delta: number, state: SimState): void {
  switch (ev.type) {
    case 'fungal_bloom': tickFungalBloom(ev, delta, state); break;
    case 'warchest': tickWarchest(ev, delta, state); break;
    case 'kill_bounty': tickKillBounty(ev, delta, state); break;
    case 'mercenary_outpost': tickMercenaryOutpost(ev, delta, state); break;
    case 'bottomless_pit': tickBottomlessPit(ev, delta, state); break;
    case 'hungry_bear': tickHungryBear(ev, delta, state); break;
  }
}

function tickFungalBloom(ev: MapEvent, delta: number, state: SimState): void {
  const era = state.currentEra;
  ev.data.spawnTimer += delta;
  if (ev.data.spawnTimer >= 1500) {
    ev.data.spawnTimer -= 1500;
    const angle = Math.random() * Math.PI * 2;
    const dist = Math.random() * 140;
    const sx = ev.x + Math.cos(angle) * dist;
    const sy = ev.y + Math.sin(angle) * dist;
    if (era <= 2) {
      state.spawnGroundItem('carrot', sx, sy);
    } else if (era === 3) {
      state.spawnGroundItem(Math.random() < 0.6 ? 'carrot' : 'meat', sx, sy);
    } else {
      const roll = Math.random();
      if (roll < 0.5) state.spawnGroundItem('carrot', sx, sy);
      else if (roll < 0.85) state.spawnGroundItem('meat', sx, sy);
      else state.spawnGroundItem('crystal', sx, sy);
    }
  }
  // Track pickups per team
  if (!ev.data._creditedIds) ev.data._creditedIds = new Set<number>();
  for (const u of state.units) {
    if (u.dead || u.team === 0) continue;
    if (pdist(u, ev) < 200 && u.carrying) {
      if (!ev.data._creditedIds.has(u.id)) {
        ev.data._creditedIds.add(u.id);
        ev.data.pickups[u.team] = (ev.data.pickups[u.team] || 0) + 1;
      }
    } else {
      ev.data._creditedIds.delete(u.id);
    }
  }
  ev.progress[1] = ev.data.pickups[1] || 0;
  ev.progress[2] = ev.data.pickups[2] || 0;
}

function tickWarchest(ev: MapEvent, delta: number, state: SimState): void {
  if (ev.data.hp <= 0) return;
  ev.data.hitTimer = (ev.data.hitTimer || 0) + delta;
  if (ev.data.hitTimer >= 1000) {
    ev.data.hitTimer -= 1000;
    let totalDmg = 0;
    for (const u of state.units) {
      if (u.dead || u.team === 0) continue;
      if (pdist(u, ev) < 80) {
        const tier = ANIMALS[u.type]?.tier || 1;
        const reduction = tier < state.currentEra ? 0.5 : 1.0;
        totalDmg += u.attack * reduction;
      }
    }
    ev.data.hp -= totalDmg;
  }
  ev.progress[1] = Math.max(0, Math.round((ev.data.hp / ev.data.maxHp) * 100));
  if (ev.data.hp <= 0) {
    const era = state.currentEra;
    const dropCount = 8 + Math.floor(Math.random() * 8);
    for (let i = 0; i < dropCount; i++) {
      const angle = Math.random() * Math.PI * 2;
      const r = 30 + Math.random() * 80;
      const dx = ev.x + Math.cos(angle) * r;
      const dy = ev.y + Math.sin(angle) * r;
      let rtype: 'carrot' | 'meat' | 'crystal' = 'carrot';
      if (era >= 4) rtype = Math.random() < 0.4 ? 'crystal' : Math.random() < 0.6 ? 'meat' : 'carrot';
      else if (era >= 3) rtype = Math.random() < 0.5 ? 'meat' : 'carrot';
      else if (era >= 2) rtype = Math.random() < 0.3 ? 'meat' : 'carrot';
      state.spawnGroundItem(rtype, dx, dy);
    }
    state.eventBuffs.push({ team: 1, stat: 'attack', value: 0.15, timer: 60000 });
    state.eventBuffs.push({ team: 2, stat: 'attack', value: 0.15, timer: 60000 });
    resolveEvent(ev, null, state);
  }
}

function tickKillBounty(ev: MapEvent, _delta: number, state: SimState): void {
  if (!(ev.data.deadChecked instanceof Set)) ev.data.deadChecked = new Set(ev.data.deadChecked);
  const deadChecked: Set<number> = ev.data.deadChecked;
  const targetType = ev.data.targetType;

  for (const u of state.units) {
    if (u.team !== 0 || u.type !== targetType || !u.dead) continue;
    if (deadChecked.has(u.id)) continue;
    deadChecked.add(u.id);

    // Attribute kill to nearest player unit
    let bestDist = Infinity;
    let bestTeam: 1 | 2 | null = null;
    for (const pu of state.units) {
      if (pu.dead || pu.team === 0) continue;
      const d = pdist(pu, u);
      if (d < bestDist) { bestDist = d; bestTeam = pu.team as 1 | 2; }
    }
    if (bestTeam && bestDist < 400) {
      ev.data.kills[bestTeam]++;
    }
  }
  ev.progress[1] = ev.data.kills[1] || 0;
  ev.progress[2] = ev.data.kills[2] || 0;
  if (ev.data.kills[1] >= ev.data.targetCount) { resolveEvent(ev, 1, state); return; }
  if (ev.data.kills[2] >= ev.data.targetCount) { resolveEvent(ev, 2, state); return; }
}

function tickMercenaryOutpost(ev: MapEvent, _delta: number, state: SimState): void {
  const costType = ev.data.cost.type;
  const costAmount = ev.data.cost.amount;
  for (const u of state.units) {
    if (u.dead || u.team === 0) continue;
    if (pdist(u, ev) < 60 && u.carrying === costType) {
      u.carrying = null;
      ev.data.deliveries[u.team]++;
    }
  }
  ev.progress[1] = ev.data.deliveries[1] || 0;
  ev.progress[2] = ev.data.deliveries[2] || 0;
  if (ev.data.deliveries[1] >= costAmount) { resolveEvent(ev, 1, state); return; }
  if (ev.data.deliveries[2] >= costAmount) { resolveEvent(ev, 2, state); return; }
}

function tickBottomlessPit(ev: MapEvent, _delta: number, state: SimState): void {
  const needed = ev.data.sacrificesNeeded;
  for (const u of state.units) {
    if (u.dead || u.team === 0) continue;
    if (pdist(u, ev) < 80) {
      const distTarget = Math.sqrt((u.targetX - ev.x) ** 2 + (u.targetY - ev.y) ** 2);
      if (distTarget < 100) {
        u.hp = 0;
        u.dead = true;
        ev.data.sacrifices[u.team]++;
      }
    }
  }
  ev.progress[1] = ev.data.sacrifices[1] || 0;
  ev.progress[2] = ev.data.sacrifices[2] || 0;
  if (ev.data.sacrifices[1] >= needed) { resolveEvent(ev, 1, state); return; }
  if (ev.data.sacrifices[2] >= needed) { resolveEvent(ev, 2, state); return; }
}

function tickHungryBear(ev: MapEvent, delta: number, state: SimState): void {
  ev.data.feedTimer = (ev.data.feedTimer || 0) + delta;
  if (ev.data.feedTimer < 500) return;
  ev.data.feedTimer -= 500;
  for (const u of state.units) {
    if (u.dead || u.team === 0) continue;
    if (pdist(u, ev) < 80 && (u.carrying === 'carrot' || u.carrying === 'meat')) {
      u.carrying = null;
      ev.data.fedAmount[u.team]++;
      ev.data.bearSize += 0.1;
      ev.data.bearHp += 200;
    }
  }
  ev.progress[1] = ev.data.fedAmount[1] || 0;
  ev.progress[2] = ev.data.fedAmount[2] || 0;
  const totalFed = (ev.data.fedAmount[1] || 0) + (ev.data.fedAmount[2] || 0);
  if (totalFed >= 20) {
    const winner = (ev.data.fedAmount[1] || 0) > (ev.data.fedAmount[2] || 0) ? 1 :
                   (ev.data.fedAmount[2] || 0) > (ev.data.fedAmount[1] || 0) ? 2 : null;
    resolveEvent(ev, winner as 1 | 2 | null, state);
  }
}

// ─── Resolve Event ────────────────────────────────────────────

export function resolveEvent(ev: MapEvent, winner: 1 | 2 | null, state: SimState): void {
  if (ev.state !== 'active') return;
  ev.state = 'claimed';
  ev.claimedBy = winner;
  const era = state.currentEra;

  switch (ev.type) {
    case 'fungal_bloom': {
      if (winner) {
        const stock = state.baseStockpile[winner];
        const scarcest = stock.carrot <= stock.meat && stock.carrot <= stock.crystal ? 'carrot'
          : stock.meat <= stock.crystal ? 'meat' : 'crystal';
        state.baseStockpile[winner][scarcest] += 5;
      }
      ev.data.hotspotTimer = 30000;
      ev.data.spawnTimer = 0;
      break;
    }
    case 'warchest':
      // Loot and buffs already handled in tickWarchest
      break;
    case 'kill_bounty': {
      if (winner) {
        const resType = (ANIMALS[ev.data.targetType]?.tier || 1) <= 1 ? 'carrot' : 'meat';
        state.baseStockpile[winner][resType] += 5;
        state.eventBuffs.push({ team: winner, stat: 'speed', value: 0.10, timer: 30000 });
      }
      break;
    }
    case 'mercenary_outpost': {
      if (winner) {
        const mercCount = 3 + Math.floor(Math.random() * 3);
        let mercType = 'skull';
        if (era >= 4) mercType = 'minotaur';
        else if (era >= 3) mercType = 'panda';
        else mercType = Math.random() < 0.5 ? 'skull' : 'hyena';
        const enemyTeam = winner === 1 ? 2 : 1;
        const enemyCamp = state.camps
          .filter(c => c.owner === enemyTeam)
          .sort((a, b) => pdist2(a, ev) - pdist2(b, ev))[0];
        const tX = enemyCamp ? enemyCamp.x : (winner === 1 ? P2_BASE.x : P1_BASE.x);
        const tY = enemyCamp ? enemyCamp.y : (winner === 1 ? P2_BASE.y : P1_BASE.y);
        for (let i = 0; i < mercCount; i++) {
          state.spawnUnit(mercType, winner, ev.x + (Math.random() - 0.5) * 60, ev.y + (Math.random() - 0.5) * 60);
          const merc = state.units[state.units.length - 1];
          if (merc) { merc.targetX = tX; merc.targetY = tY; }
        }
      }
      break;
    }
    case 'bottomless_pit': {
      if (winner) {
        state.eventBuffs.push({ team: winner, stat: 'attack', value: 0.20, timer: 45000 });
        for (let i = 0; i < 3; i++) {
          const types: ('carrot' | 'meat' | 'crystal')[] = ['carrot', 'meat', 'crystal'];
          state.spawnGroundItem(types[Math.floor(Math.random() * types.length)], ev.x + (Math.random() - 0.5) * 60, ev.y + (Math.random() - 0.5) * 60);
        }
      }
      break;
    }
    case 'hungry_bear': {
      if (winner) {
        const size = ev.data.bearSize || 1.0;
        state.spawnUnit('panda', winner, ev.x, ev.y);
        const bear = state.units[state.units.length - 1];
        if (bear) {
          bear.maxHp = ev.data.bearHp || 2000;
          bear.hp = bear.maxHp;
          bear.attack = Math.round(50 * size);
          bear.speed = 40;
          bear.targetX = winner === 1 ? P2_BASE.x : P1_BASE.x;
          bear.targetY = winner === 1 ? P2_BASE.y : P1_BASE.y;
        }
      }
      break;
    }
  }
}

function expireEvent(ev: MapEvent, state: SimState): void {
  if (ev.state !== 'active') return;
  const p1 = ev.progress[1] || 0;
  const p2 = ev.progress[2] || 0;
  let winner: 1 | 2 | null = null;
  if (p1 > p2) winner = 1;
  else if (p2 > p1) winner = 2;
  if (ev.type === 'warchest' && ev.data.hp > 0) {
    ev.state = 'expired';
    return;
  }
  resolveEvent(ev, winner, state);
}
