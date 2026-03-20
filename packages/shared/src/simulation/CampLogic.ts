// ─── CampLogic.ts ──────────────────────────────────────────────
// Camp management, structures, era progression, spawning logic.
// All pure simulation — no Phaser dependencies.
// ────────────────────────────────────────────────────────────────

import type {
  SimState,
  SimUnit,
  SimCamp,
  SimNexus,
  ResourceType,
  EquipmentType,
  PendingHit,
} from './SimTypes';

import { DEFAULT_MODS } from './SimTypes';

import {
  ANIMALS,
  SPAWN_COSTS,
  SUPPLY_COST,
  CAMP_RANGE,
  FREE_GNOME_MS,
  NEXUS_DAMAGE,
  NEXUS_RANGE,
  NEXUS_SPLASH,
  NEXUS_COOLDOWN,
  NEXUS_PROJ_SPEED,
  NEXUS_MAX_HP,
  MAX_SUPPLY,
  WORLD_W,
  WORLD_H,
  P1_BASE,
  P2_BASE,
  EQUIPMENT,
  EQUIPMENT_PREREQS,
  MAX_EQUIP_LEVEL,
  EQUIP_LEVEL_COST_MULT,
  EQUIP_LEVEL_STAT_MULT,
  GOLDEN_ANGLE,
  WILD_ANIMAL_COUNT,
  UPKEEP_THRESHOLDS,
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

// ─── Camp Active Check ────────────────────────────────────────

export function eraMaxTier(state: SimState): number {
  return state.currentEra; // Era 1->T1, Era 2->T2, etc.
}

export function isCampActive(camp: SimCamp, state: SimState): boolean {
  return (ANIMALS[camp.animalType]?.tier || 1) <= eraMaxTier(state);
}

// ─── Free Gnome Spawning ─────────────────────────────────────

export function updateFreeGnomes(delta: number, state: SimState): void {
  state.freeGnomeTimer += delta;
  if (state.freeGnomeTimer < FREE_GNOME_MS) return;
  state.freeGnomeTimer -= FREE_GNOME_MS;
  for (const team of [1, 2] as const) {
    if (state.getTeamSupply(team) + 1 > state.getMaxSupply(team)) continue;
    const b = team === 1 ? P1_BASE : P2_BASE;
    const gx = b.x + (team === 1 ? 60 : -60), gy = b.y + (team === 1 ? -30 : 30);
    state.spawnUnit('gnome', team, gx, gy);
  }
}

// ─── Free Snake Spawning ─────────────────────────────────────

export function updateFreeSnakes(deltaMs: number, state: SimState): void {
  const FREE_SNAKE_MS = 60000; // 60 seconds
  state.freeSnakeTimer = (state.freeSnakeTimer || 0) + deltaMs;
  if (state.freeSnakeTimer >= FREE_SNAKE_MS) {
    state.freeSnakeTimer -= FREE_SNAKE_MS;
    // Spawn 1 snake per team at their base
    for (const team of [1, 2] as const) {
      const base = team === 1 ? P1_BASE : P2_BASE;
      state.spawnUnit('snake', team, base.x + (Math.random() - 0.5) * 100, base.y + (Math.random() - 0.5) * 100);
    }
  }
}

// ─── Spawn Camp Defenders ─────────────────────────────────────

export function spawnCampDefenders(camp: SimCamp, state: SimState): void {
  const def = ANIMALS[camp.animalType];
  if (!def) return;
  for (let i = 0; i < camp.guardCount; i++) {
    const angle = (i / camp.guardCount) * Math.PI * 2;
    let gx = camp.x + Math.cos(angle) * 50;
    let gy = camp.y + Math.sin(angle) * 50;
    const safe = state.findWalkableSpawn(gx, gy);
    gx = safe.x; gy = safe.y;
    const wanderAngle = Math.random() * Math.PI * 2;
    const wanderR = 20 + Math.random() * 40;
    const speedVar = 0.85 + Math.random() * 0.3;
    state.units.push({
      id: state.nextId++, type: camp.animalType, team: 0,
      hp: def.hp * 1.5, maxHp: def.hp * 1.5,
      attack: def.attack * 1.2, speed: def.speed * 0.5 * speedVar,
      x: gx, y: gy,
      targetX: camp.x + Math.cos(wanderAngle) * wanderR,
      targetY: camp.y + Math.sin(wanderAngle) * wanderR,
      attackTimer: 0, dead: false, animState: 'idle' as const,
      campId: camp.id, lungeX: 0, lungeY: 0,
      gnomeShield: camp.animalType === 'gnome' ? 1 : 0,
      hasRebirth: camp.animalType === 'skull' || camp.animalType === 'snake',
      diveReady: false,
      diveTimer: 0,
      lastAttackTarget: -1, attackFaceX: null,
      prevSpriteX: 0, prevSpriteY: 0,
      pathWaypoints: null, pathAge: 0, pathTargetX: 0, pathTargetY: 0,
      lastCheckX: 0, lastCheckY: 0, stuckFrames: 0, stuckCooldown: 0,
      mods: { ...DEFAULT_MODS },
      carrying: null, loop: null, isElite: false, idleTimer: 0, claimItemId: -1,
      equipment: null, equipLevel: 0, equipVisualApplied: null,
    });
  }
}

// ─── Spawn Unit ───────────────────────────────────────────────

export function spawnUnit(
  type: string,
  team: 1 | 2,
  x: number,
  y: number,
  state: SimState,
): void {
  const def = ANIMALS[type];
  if (!def) return;
  y += 40; // Nudge spawn point down
  const safe = state.findWalkableSpawn(x, y);
  x = safe.x; y = safe.y;
  const maxHp = Math.round(def.hp * (1 + state.getBuffs(team).hp));

  // Rally point targeting
  let targetX = x, targetY = y;
  const rally = state.rallyPoints[`${type}_${team}`];
  if (rally) {
    const a = state.nextId * GOLDEN_ANGLE;
    let _spawnTypeCount = 0;
    for (let si = 0; si < state.units.length; si++) {
      const su = state.units[si];
      if (su.type === type && su.team === team && !su.dead) _spawnTypeCount++;
    }
    const r = Math.sqrt(_spawnTypeCount) * 18;
    targetX = rally.x + Math.cos(a) * r;
    targetY = rally.y + Math.sin(a) * r;
  }

  const speedVariance = 0.93 + Math.random() * 0.14;
  state.units.push({
    id: state.nextId++, type, team,
    hp: maxHp, maxHp, attack: def.attack, speed: def.speed * speedVariance,
    x, y, targetX, targetY,
    attackTimer: 0, dead: false, animState: 'idle' as const,
    campId: null, lungeX: 0, lungeY: 0,
    gnomeShield: type === 'gnome' ? 1 : 0,
    hasRebirth: type === 'skull',
    diveReady: false,
    diveTimer: 0,
    lastAttackTarget: -1, attackFaceX: null,
    prevSpriteX: 0, prevSpriteY: 0,
    pathWaypoints: null, pathAge: 0, pathTargetX: 0, pathTargetY: 0,
    lastCheckX: x, lastCheckY: y, stuckFrames: 0, stuckCooldown: 0,
    carrying: null,
    // Inherit active group workflow so new spawns auto-join the loop
    loop: state.groupWorkflows[`${type}_${team}`]
      ? { ...state.groupWorkflows[`${type}_${team}`], currentStep: 0 }
      : null,
    isElite: false,
    idleTimer: 0,
    claimItemId: -1,
    equipment: null,
    equipLevel: 0,
    equipVisualApplied: null,
    mods: state.groupModifiers[`${type}_${team}`]
      ? { ...state.groupModifiers[`${type}_${team}`] }
      : { ...DEFAULT_MODS },
  });
  state.matchStats.unitsSpawned[team]++;
}

// ─── Camp Capture ─────────────────────────────────────────────

export function updateCampCapture(state: SimState): void {
  for (const camp of state.camps) {
    if (!isCampActive(camp, state)) continue;

    const defenders = state.units.filter(u => u.campId === camp.id && u.team === 0 && !u.dead);

    // Make neutral defenders patrol
    for (const d of defenders) {
      const distToCamp = pdist(d, camp);
      const distToTarget = pdist(d, { x: d.targetX, y: d.targetY });
      if (distToTarget < 12 || distToCamp > 120) {
        const a = Math.random() * Math.PI * 2;
        const r = 40 + Math.random() * 60;
        d.targetX = camp.x + Math.cos(a) * r;
        d.targetY = camp.y + Math.sin(a) * r;
      }
    }

    if (camp.owner === 0) {
      // Neutral camp: if all defenders dead, whoever is nearby captures
      if (defenders.length === 0) {
        let nearbyTeam = 0;
        let nearbyMixed = false;
        for (let ui = 0; ui < state.units.length; ui++) {
          const u = state.units[ui];
          if (u.dead || u.team === 0) continue;
          if (pdist(u, camp) > CAMP_RANGE) continue;
          if (nearbyTeam === 0) nearbyTeam = u.team;
          else if (nearbyTeam !== u.team) { nearbyMixed = true; break; }
        }
        const teams = nearbyMixed ? new Set([1, 2]) : nearbyTeam > 0 ? new Set([nearbyTeam]) : new Set<number>();
        if (teams.size === 1) {
          const winner = [...teams][0] as 1 | 2;
          camp.owner = winner;
          camp.spawnTimer = 0;
          state.matchStats.campsCaptured[winner]++;
          spawnCampLoot(camp, winner, state);
        }
      }
    } else {
      // Owned camp: if enemies arrive and no allies defend, reset to neutral
      const enemy = camp.owner === 1 ? 2 : 1;
      const en = state.units.filter(u => u.team === enemy && !u.dead && pdist(u, camp) <= CAMP_RANGE);
      const al = state.units.filter(u => u.team === camp.owner && !u.dead && pdist(u, camp) <= CAMP_RANGE);
      if (en.length > 0 && al.length === 0) {
        const prevOwner = camp.owner as 1 | 2;
        camp.owner = 0;
        camp.spawnTimer = 0;
        spawnCampDefenders(camp, state);
        state.matchStats.campsLost[prevOwner]++;
      }
    }
  }
}

// ─── Camp Loot ────────────────────────────────────────────────

function spawnCampLoot(camp: SimCamp, team: 1 | 2, state: SimState): void {
  const tier = ANIMALS[camp.animalType]?.tier ?? 1;
  const rolls = tier >= 3 ? 2 : 1;
  for (let r = 0; r < rolls; r++) {
    const roll = Math.random();
    if (roll < 0.4) {
      // Resource Burst
      const cost = SPAWN_COSTS[camp.animalType];
      const resType = cost?.type || 'carrot';
      const count = 3 + Math.floor(Math.random() * 3);
      for (let i = 0; i < count; i++) {
        const ox = (Math.random() - 0.5) * 80;
        const oy = (Math.random() - 0.5) * 80;
        state.spawnGroundItem(resType, camp.x + ox, camp.y + oy);
      }
    } else if (roll < 0.6) {
      // Speed Surge
      state.teamBuffs.push({ team, stat: 'speed', amount: 0.15, remaining: 20000 });
    } else if (roll < 0.8) {
      // Attack Surge
      state.teamBuffs.push({ team, stat: 'attack', amount: 0.15, remaining: 20000 });
    } else {
      // Heal Burst
      const nearby = state.units.filter(u => u.team === team && !u.dead && pdist(u, camp) <= 200);
      for (const u of nearby) {
        u.hp = Math.min(u.maxHp, u.hp + Math.round(u.maxHp * 0.3));
      }
    }
  }
}

// ─── Era Progression ──────────────────────────────────────────

export function updateEraProgression(state: SimState): void {
  if (state.currentEra >= 5) return;

  // Game start: set era to 1 if not yet
  if (!state.gameStartBannerShown) {
    state.gameStartBannerShown = true;
    return;
  }

  let t = state.currentEra;

  // Era 2 - after 90 seconds
  if (t === 1 && state.gameTime >= 90000) t = 2;

  // Era 3 - any player has units of 4+ distinct types
  if (t === 2) {
    for (const team of [1, 2] as const) {
      const seen = new Set<string>();
      for (let i = 0; i < state.units.length; i++) {
        const u = state.units[i];
        if (u.team === team && !u.dead) seen.add(u.type);
      }
      if (seen.size >= 4) { t = 3; break; }
    }
  }

  // Era 4 - any player has 4+ tier 3 units
  if (t === 3) {
    for (const team of [1, 2] as const) {
      let t3count = 0;
      for (let i = 0; i < state.units.length; i++) {
        const u = state.units[i];
        if (u.team === team && !u.dead && (ANIMALS[u.type]?.tier || 1) === 3) t3count++;
      }
      if (t3count >= 4) { t = 4; break; }
    }
  }

  // Endgame - elite killed OR any player has 2+ tier 4 units
  if (t === 4) {
    if (state.eliteKillCount > 0) { t = 5; }
    else {
      for (const team of [1, 2] as const) {
        let t4count = 0;
        for (let i = 0; i < state.units.length; i++) {
          const u = state.units[i];
          if (u.team === team && !u.dead && (ANIMALS[u.type]?.tier || 1) === 4) t4count++;
        }
        if (t4count >= 2) { t = 5; break; }
      }
    }
  }

  if (t > state.currentEra) advanceEra(t, state);
}

function advanceEra(ne: number, state: SimState): void {
  const om = state.currentEra; // old max tier
  state.currentEra = ne;
  const nm = ne; // new max tier

  // Spawn camp defenders for newly available camps
  for (const c of state.camps) {
    const ti = ANIMALS[c.animalType]?.tier || 1;
    if (ti > om && ti <= nm && c.owner === 0 && !state.units.some(u => u.campId === c.id && !u.dead)) {
      spawnCampDefenders(c, state);
    }
  }

  if (ne === 2) state.spawnWildAnimals(['skull', 'spider', 'hyena'], WILD_ANIMAL_COUNT);
  if (ne === 3) state.spawnWildAnimals(['panda', 'lizard'], 10);
  if (ne === 4) state.spawnElitePreyBatch();
}

// ─── Nexus Combat ─────────────────────────────────────────────

export function updateNexusCombat(delta: number, state: SimState): void {
  for (const n of state.nexuses) {
    if (n.hp <= 0) continue;

    n.attackTimer -= delta;
    if (n.attackTimer > 0) continue;

    // Find nearest enemy unit in range
    let bestTarget: SimUnit | null = null;
    let bestDist2 = Infinity;
    for (const u of state.units) {
      if (u.dead || u.team === n.team || u.team === 0) continue;
      const dx = u.x - n.x, dy = u.y - n.y;
      const d2 = dx * dx + dy * dy;
      if (d2 > NEXUS_RANGE * NEXUS_RANGE) continue;
      if (d2 < bestDist2) {
        bestDist2 = d2;
        bestTarget = u;
      }
    }

    if (!bestTarget) continue;

    n.attackTimer = NEXUS_COOLDOWN;

    // Splash targets
    const splashList: { id: number; dmg: number }[] = [];
    const nexusSplashR2 = NEXUS_SPLASH * NEXUS_SPLASH;
    for (const o of state.units) {
      if (o.dead || o.id === bestTarget.id || o.team === n.team || o.team === 0) continue;
      const sdx = o.x - bestTarget.x, sdy = o.y - bestTarget.y;
      const sd2 = sdx * sdx + sdy * sdy;
      if (sd2 <= nexusSplashR2) {
        const sd = Math.sqrt(sd2);
        const falloff = 1 - (sd / NEXUS_SPLASH) * 0.5;
        splashList.push({ id: o.id, dmg: Math.round(NEXUS_DAMAGE * 0.6 * falloff) });
      }
    }

    // Queue pending hit (structure shot: attackerId = -2)
    state.pendingHits.push({
      attackerId: -2,
      targetId: bestTarget.id,
      nexusTeam: 0,
      dmg: NEXUS_DAMAGE,
      splashTargets: splashList,
      timer: 3000,
      isTroll: false,
      isRanged: true,
      isSplash: splashList.length > 0,
      isCrit: false,
      projX: n.x, projY: n.y - 40,
      projSpeed: NEXUS_PROJ_SPEED,
    });
  }
}

// ─── Tower Combat ─────────────────────────────────────────────

export function updateTowers(delta: number, state: SimState): void {
  for (const t of state.towers) {
    if (!t.alive) continue;

    // Check if tower is destroyed
    if (t.hp <= 0) {
      t.alive = false;
      t.hp = 0;
      continue;
    }

    // Cooldown
    t.attackTimer -= delta;
    if (t.attackTimer > 0) continue;

    // Find nearest enemy unit in range
    let bestTarget: SimUnit | null = null;
    let bestDist2 = Infinity;
    for (const u of state.units) {
      if (u.dead || u.team === t.team || u.team === 0) continue;
      const dx = u.x - t.x, dy = u.y - t.y;
      const d2 = dx * dx + dy * dy;
      if (d2 > t.range * t.range) continue;
      if (d2 < bestDist2) {
        bestDist2 = d2;
        bestTarget = u;
      }
    }

    if (!bestTarget) continue;

    // Fire!
    t.attackTimer = t.attackCooldown;

    // Splash targets
    const splashList: { id: number; dmg: number }[] = [];
    const tSplashR2 = t.splashRange * t.splashRange;
    for (const o of state.units) {
      if (o.dead || o.id === bestTarget.id || o.team === t.team || o.team === 0) continue;
      const sdx = o.x - bestTarget.x, sdy = o.y - bestTarget.y;
      const sd2 = sdx * sdx + sdy * sdy;
      if (sd2 <= tSplashR2) {
        const sd = Math.sqrt(sd2);
        const falloff = 1 - (sd / t.splashRange) * 0.5;
        splashList.push({ id: o.id, dmg: Math.round(t.damage * 0.6 * falloff) });
      }
    }

    // Queue pending hit
    state.pendingHits.push({
      attackerId: -2, // tower
      targetId: bestTarget.id,
      nexusTeam: 0,
      dmg: t.damage,
      splashTargets: splashList,
      timer: 3000,
      isTroll: false,
      isRanged: true,
      isSplash: splashList.length > 0,
      isCrit: false,
      projX: t.x, projY: t.y - 30,
      projSpeed: t.projSpeed,
    });
  }
}

// ─── Equipment Unlock ─────────────────────────────────────────

export function unlockEquipment(
  team: 1 | 2,
  eqType: EquipmentType,
  state: SimState,
): boolean {
  const def = EQUIPMENT.find(e => e.id === eqType);
  if (!def) return false;
  const currentLevel = state.unlockedEquipment[team].get(eqType) || 0;
  if (currentLevel >= MAX_EQUIP_LEVEL) return false;

  const nextLevel = currentLevel + 1;
  const costMult = EQUIP_LEVEL_COST_MULT[nextLevel];
  const stock = state.baseStockpile[team];
  for (const [res, amt] of Object.entries(def.cost)) {
    if ((stock[res as ResourceType] || 0) < Math.ceil(amt! * costMult)) return false;
  }
  for (const [res, amt] of Object.entries(def.cost)) {
    stock[res as ResourceType] -= Math.ceil(amt! * costMult);
  }

  state.unlockedEquipment[team].set(eqType, nextLevel);
  return true;
}

// ─── Win Check ────────────────────────────────────────────────

export function checkWin(state: SimState): void {
  for (const n of state.nexuses) {
    if (n.hp <= 0) {
      state.gameOver = true;
      state.winner = n.team === 1 ? 2 : 1;
      return;
    }
  }
}
