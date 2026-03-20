/**
 * Combat.ts — Pure simulation logic for unit combat and pending hit resolution.
 * Extracted from HordeScene.updateCombat and HordeScene.processPendingHits.
 * Returns CombatEvent[] so the client can play sounds/VFX independently.
 */

import type {
  SimUnit,
  SimCamp,
  SimNexus,
  SimTower,
  SimWorkflow,
  EquipBuffs,
  BannerAura,
  TeamBuffs,
  Pos,
  ResourceType,
} from './SimTypes';

import {
  COMBAT_RANGE,
  ATTACK_CD_MS,
  TURTLE_TAUNT_RANGE,
  PROJECTILE_SPEED,
  PROJECTILE_HIT_DIST,
  NIGHT_DAMAGE_PENALTY,
  HIT_DELAY_MS,
  HARD_COUNTERS,
  ANIMALS,
} from './Constants';

// ─── Combat event for client VFX/SFX ───

export interface CombatEvent {
  type: 'attack' | 'damage' | 'death' | 'heal' | 'stun' | 'splash' | 'nexus_damage' | 'tower_damage' | 'drop_resource' | 'gnome_plucky' | 'skull_undying' | 'crit';
  attackerId?: number;
  targetId?: number;
  amount?: number;
  x?: number;
  y?: number;
  unitType?: string;
  targetType?: string;
  isTroll?: boolean;
  isRanged?: boolean;
  isSplash?: boolean;
  isCrit?: boolean;
  nexusTeam?: 1 | 2;
  resourceType?: ResourceType;
}

// ─── Pending hit (projectile / delayed melee) ───

export interface SimPendingHit {
  attackerId: number;
  targetId: number;       // unit id, or -1 for nexus
  nexusTeam: 1 | 2 | 0;  // which nexus (0 = not a nexus hit)
  dmg: number;
  splashTargets: { id: number; dmg: number }[];
  timer: number;          // ms remaining until hit lands
  isTroll: boolean;
  isRanged: boolean;
  isSplash: boolean;
  isCrit: boolean;
  projX: number;
  projY: number;
  projSpeed: number;      // pixels per second (0 = melee, uses timer)
}

// ─── Drop item request (returned to caller instead of calling this.spawnGroundItem) ───

export interface DropItemRequest {
  type: ResourceType;
  x: number;
  y: number;
}

// ─── Helpers ───

function pdist2(a: { x: number; y: number }, b: { x: number; y: number }): number {
  const dx = a.x - b.x, dy = a.y - b.y;
  return dx * dx + dy * dy;
}

function pdist(a: { x: number; y: number }, b: { x: number; y: number }): number {
  const dx = a.x - b.x, dy = a.y - b.y;
  return Math.sqrt(dx * dx + dy * dy);
}

// ─── Combat context ───

export interface CombatContext {
  units: SimUnit[];
  unitById: Map<number, SimUnit>;
  camps: SimCamp[];
  nexuses: SimNexus[];
  towers: SimTower[];
  pendingHits: SimPendingHit[];
  isNight: boolean;
  /** Callbacks for external lookups */
  getUnitEquipBuffs: (u: SimUnit) => EquipBuffs;
  getBannerAura: (u: SimUnit) => BannerAura;
  getBuffs: (team: 1 | 2) => TeamBuffs;
  isNearFriendlyBuilding: (u: SimUnit) => boolean;
  isNonCombatStep: (u: SimUnit) => boolean;
  getNearbyUnits: (x: number, y: number, radius: number) => SimUnit[];
  getElevation: (x: number, y: number) => number;
  /** Enemy nexus pre-cached per team */
  enemyNexus: { [team: number]: SimNexus | null };
  /** Base positions */
  p1Base: Pos;
  p2Base: Pos;
  /** Match stats tracking (mutated in place) */
  matchStats: {
    totalDamage: { 1: number; 2: number };
    totalKills: { 1: number; 2: number };
    unitsLost: { 1: number; 2: number };
  };
  unitKillCounts: Map<number, number>;
  topKiller: { 1: { type: string; kills: number }; 2: { type: string; kills: number } };
  eliteKillCount: number;
}

// ─── updateCombat ───

/**
 * Processes combat for all units. Mutates unit state and pending hits.
 * Returns combat events and drop item requests.
 */
export function updateCombat(
  delta: number,
  ctx: CombatContext,
): { events: CombatEvent[]; drops: DropItemRequest[]; newPendingHits: SimPendingHit[] } {
  const events: CombatEvent[] = [];
  const drops: DropItemRequest[] = [];
  const newHits: SimPendingHit[] = [];

  for (const u of ctx.units) {
    if (u.dead) continue;

    // Caution: safe — retreat to base at 40% HP (skulls exempt — let Undying proc)
    if (u.team !== 0 && u.mods.caution === 'safe' && u.type !== 'skull') {
      if (u.hp / u.maxHp < 0.4) {
        const retreatBase = u.team === 1 ? ctx.p1Base : ctx.p2Base;
        u.targetX = retreatBase.x; u.targetY = retreatBase.y;
        continue; // skip combat, flee
      }
    }

    // Scouts and collectors always skip combat (pacifist); carrying units on non-combat steps also skip
    if (u.team !== 0 && ctx.isNonCombatStep(u)) {
      const step = u.loop ? u.loop.steps[u.loop.currentStep] : undefined;
      const pacifist = step && ((step.action === 'scout' || step.action === 'collect') && u.mods.caution !== 'aggressive');
      if (pacifist || (u.carrying && u.mods.caution !== 'aggressive')) continue;
    }

    if (u.carrying && u.team !== 0) {
      const combatRange = u.type === 'hyena' ? 120 : u.type === 'shaman' ? 100 : u.type === 'snake' ? 110 : u.type === 'harpoon_fish' ? 160 : COMBAT_RANGE;
      const onCombatStep = !ctx.isNonCombatStep(u);
      const isAttackingCamp = u.loop?.steps[u.loop.currentStep]?.action === 'attack_camp';

      const dropRange = u.mods.caution === 'aggressive' ? COMBAT_RANGE : combatRange + 30;
      const nearbyForDrop = ctx.getNearbyUnits(u.x, u.y, dropRange);
      let enemyNear = false;
      for (let ni = 0; ni < nearbyForDrop.length; ni++) {
        const o = nearbyForDrop[ni];
        if (o.team !== u.team && (o.team !== 0 || isAttackingCamp)) { enemyNear = true; break; }
      }

      if (u.mods.caution === 'safe' && enemyNear) {
        // Safe: flee to base with resource, don't drop
        const base = u.team === 1 ? ctx.p1Base : ctx.p2Base;
        u.targetX = base.x; u.targetY = base.y;
        continue;
      } else if (enemyNear) {
        // Normal/aggressive: drop carried resource and engage
        drops.push({ type: u.carrying, x: u.x, y: u.y });
        events.push({ type: 'drop_resource', targetId: u.id, x: u.x, y: u.y, resourceType: u.carrying });
        u.carrying = null;
        // Reset workflow to seeking phase
        if (u.loop) {
          const step = u.loop.steps[u.loop.currentStep];
          if (step?.action === 'deliver') {
            u.loop.currentStep = (u.loop.currentStep - 1 + u.loop.steps.length) % u.loop.steps.length;
          }
        }
      } else if (!onCombatStep) {
        continue; // Non-combat step, no enemies — keep carrying
      }
    }

    // PANDA "Thick Hide": regenerate 1.5% max HP per second
    if (u.type === 'panda' && u.hp < u.maxHp) {
      const healAmt = u.maxHp * 0.015 * (delta / 1000);
      u.hp = Math.min(u.maxHp, u.hp + healAmt);
      if (healAmt > 0.5) {
        events.push({ type: 'heal', targetId: u.id, amount: healAmt, x: u.x, y: u.y, unitType: 'panda' });
      }
    }

    u.attackTimer -= delta;

    if (u.attackTimer > 0) continue;

    // Find closest enemy
    const baseCombatRange = u.type === 'hyena' ? 120 : u.type === 'shaman' ? 100 : u.type === 'snake' ? 110 : u.type === 'harpoon_fish' ? 160 : COMBAT_RANGE;
    const unitCombatRange = u.mods.caution === 'aggressive' ? Math.max(baseCombatRange, 200) : baseCombatRange;
    let best: SimUnit | null = null, bestD2 = Infinity;
    const unitCombatRange2 = unitCombatRange * unitCombatRange;
    const nearbyCombat = ctx.getNearbyUnits(u.x, u.y, unitCombatRange);
    for (const o of nearbyCombat) {
      if (o.team === u.team) continue;
      if (u.team === 0 && o.team === 0) continue;
      // ROGUE STEALTH: invisible to neutral enemies
      if (u.team === 0 && o.type === 'rogue') continue;
      const d2 = pdist2(u, o);
      if (d2 <= unitCombatRange2 && d2 < bestD2) { bestD2 = d2; best = o; }
    }

    // TURTLE TAUNT: nearby enemy turtles force this unit to attack them
    if (best && u.type !== 'turtle') {
      let tauntTurtle: SimUnit | null = null, tauntD2 = Infinity;
      const tauntRange2 = TURTLE_TAUNT_RANGE * TURTLE_TAUNT_RANGE;
      const nearbyTaunt = ctx.getNearbyUnits(u.x, u.y, TURTLE_TAUNT_RANGE);
      for (const o of nearbyTaunt) {
        if (o.type !== 'turtle' || o.team === u.team) continue;
        if (u.team === 0 && o.team === 0) continue;
        const d2 = pdist2(u, o);
        if (d2 <= tauntRange2 && d2 < tauntD2) { tauntD2 = d2; tauntTurtle = o; }
      }
      if (tauntTurtle) { best = tauntTurtle; bestD2 = tauntD2; }
    }

    // Tower attack — enemy player units attack nearby towers
    let closestTower: SimTower | null = null;
    let towerD2 = Infinity;
    if (u.team !== 0) {
      for (const tw of ctx.towers) {
        if (!tw.alive || tw.team === u.team) continue;
        const td2 = pdist2(u, tw);
        if (td2 < towerD2) { towerD2 = td2; closestTower = tw; }
      }
    }

    // Nexus attack (only player units)
    const nex = u.team !== 0 ? ctx.enemyNexus[u.team] : null;
    const nexD2 = nex ? pdist2(u, nex) : Infinity;

    // ELEVATION COMBAT CHECK
    // Melee from ground (elev 0) can't hit high ground (elev 1) units
    if (best) {
      const attackerElev = ctx.getElevation(u.x, u.y);
      const targetElev = ctx.getElevation(best.x, best.y);
      const isRangedUnit = u.type === 'hyena' || u.type === 'shaman' || u.type === 'snake' || u.type === 'harpoon_fish';
      if (attackerElev === 0 && targetElev === 1 && !isRangedUnit) {
        best = null;
      }
    }

    if (best) {
      const eqB = u.team !== 0 ? ctx.getUnitEquipBuffs(u) : null;
      const bannerB = u.team !== 0 ? ctx.getBannerAura(u) : { attack: 0 };
      const buffMult = u.team !== 0 ? (1 + ctx.getBuffs(u.team as 1 | 2).attack + (eqB?.attack || 0) + bannerB.attack) : 1;
      let atk = u.attack * buffMult;
      const uTier = ANIMALS[u.type]?.tier || 1;

      // HARD COUNTER: 2x damage
      const counters = HARD_COUNTERS[u.type];
      if (counters && counters.includes(best.type)) atk *= 2;

      // SPIDER VENOM BITE: +5% of target's max HP as bonus damage
      if (u.type === 'spider') {
        atk += best.maxHp * 0.05;
      }

      // SNAKE VENOM SPIT: +3% of target's max HP as bonus damage
      if (u.type === 'snake') {
        atk += best.maxHp * 0.03;
      }

      // BEAR RAGE: +2% damage per 1% missing HP
      if (u.type === 'bear') {
        const missingPct = 1 - (u.hp / u.maxHp);
        atk *= (1 + missingPct * 2);
      }

      // HARPOON FISH: extended range already handled by ranged check

      // LIZARD COLD BLOOD: 3x to targets below 40% HP
      let hitIsCrit = false;
      if (u.type === 'lizard' && best.hp / best.maxHp < 0.4) {
        atk *= 3;
        hitIsCrit = true;
      }

      // ROGUE BACKSTAB: 3x damage on first hit against a new target
      if (u.type === 'rogue') {
        if (u.lastAttackTarget !== best.id) {
          atk *= 3;
          hitIsCrit = true;
          events.push({ type: 'crit', attackerId: u.id, targetId: best.id, x: u.x, y: u.y, unitType: 'rogue' });
        }
        u.lastAttackTarget = best.id;
      }

      // MINOTAUR WAR CRY: nearby allies get +25% attack
      if (u.team !== 0 && u.type !== 'minotaur') {
        const nearbyAllies = ctx.getNearbyUnits(u.x, u.y, 150);
        let hasMinotaurNearby = false;
        for (let ni = 0; ni < nearbyAllies.length; ni++) {
          if (nearbyAllies[ni].type === 'minotaur' && nearbyAllies[ni].team === u.team) { hasMinotaurNearby = true; break; }
        }
        if (hasMinotaurNearby) atk *= 1.25;
      }

      // TURTLE SHELL STANCE: 60% damage reduction when stationary
      const stDx = best.x - best.targetX, stDy = best.y - best.targetY;
      const isStationary = (stDx * stDx + stDy * stDy) < 225; // 15*15
      if (best.type === 'turtle' && isStationary) {
        atk *= 0.4;
        events.push({ type: 'stun', targetId: best.id, x: best.x, y: best.y, unitType: 'turtle' });
      }

      // NIGHT DAMAGE PENALTY
      if (ctx.isNight && u.team !== 0 && !ctx.isNearFriendlyBuilding(u)) {
        atk *= NIGHT_DAMAGE_PENALTY;
      }

      // Splash: Troll = 90px, Shaman = 60px (always), T4 = 50px, T3 = 40px, others = none
      const splashRadius = u.type === 'troll' ? 90 : u.type === 'shaman' ? 60 : uTier >= 4 ? 50 : uTier >= 3 ? 40 : 0;
      const splashList: { id: number; dmg: number }[] = [];
      if (splashRadius > 0) {
        const nearbySplash = ctx.getNearbyUnits(best.x, best.y, splashRadius);
        for (const o of nearbySplash) {
          if (o === best || o.team === u.team) continue;
          if (u.team === 0 && o.team === 0) continue;
          if (pdist(o, best) <= splashRadius) {
            let sDmg = atk * 0.5;
            if (o.type === 'turtle') {
              const tsDx = o.x - o.targetX, tsDy = o.y - o.targetY;
              const tStat = (tsDx * tsDx + tsDy * tsDy) < 225;
              if (tStat) sDmg *= 0.4;
            }
            if (o.team !== 0) sDmg *= ctx.getUnitEquipBuffs(o).damageTaken;
            splashList.push({ id: o.id, dmg: sDmg });
          }
        }
      }

      // Apply equip damage reduction to primary target
      let primaryDmg = atk;
      if (best.team !== 0) primaryDmg *= ctx.getUnitEquipBuffs(best).damageTaken;

      // Queue delayed damage
      const ranged = u.type === 'hyena' || u.type === 'shaman' || u.type === 'snake' || u.type === 'harpoon_fish';
      newHits.push({
        attackerId: u.id,
        targetId: best.id,
        nexusTeam: 0,
        dmg: primaryDmg,
        splashTargets: splashList,
        timer: ranged ? 3000 : HIT_DELAY_MS,
        isTroll: u.type === 'troll',
        isRanged: ranged,
        isSplash: splashList.length > 0,
        isCrit: hitIsCrit,
        projX: u.x, projY: u.y,
        projSpeed: ranged ? PROJECTILE_SPEED : 0,
      });

      events.push({
        type: 'attack',
        attackerId: u.id,
        targetId: best.id,
        x: u.x, y: u.y,
        unitType: u.type,
        targetType: best.type,
        isRanged: ranged,
        isSplash: splashList.length > 0,
        isCrit: hitIsCrit,
        isTroll: u.type === 'troll',
      });

      let cd = ATTACK_CD_MS;
      if (u.team !== 0) { const eqCd = ctx.getUnitEquipBuffs(u); cd *= eqCd.atkSpeedMult; }
      u.attackTimer = cd;

      // Face attack target
      u.attackFaceX = best.x;
      u.animState = 'attack';

    } else if (nex && nexD2 <= COMBAT_RANGE * COMBAT_RANGE && u.team !== 0) {
      const neqB = ctx.getUnitEquipBuffs(u);
      const nBan = ctx.getBannerAura(u);
      const nexDmg = u.attack * (1 + ctx.getBuffs(u.team as 1 | 2).attack + neqB.attack + nBan.attack);

      newHits.push({
        attackerId: u.id,
        targetId: -1,
        nexusTeam: nex.team,
        dmg: nexDmg,
        splashTargets: [],
        timer: HIT_DELAY_MS,
        isTroll: false,
        isRanged: false,
        isSplash: false,
        isCrit: false,
        projX: 0, projY: 0,
        projSpeed: 0,
      });

      events.push({
        type: 'attack',
        attackerId: u.id,
        x: u.x, y: u.y,
        unitType: u.type,
        nexusTeam: nex.team,
      });

      u.attackTimer = ATTACK_CD_MS;
      u.attackFaceX = nex.x;
      u.animState = 'attack';

    } else if (closestTower && towerD2 <= COMBAT_RANGE * COMBAT_RANGE && u.team !== 0) {
      // Attack enemy tower
      const twB = ctx.getUnitEquipBuffs(u);
      const twBan = ctx.getBannerAura(u);
      const twDmg = u.attack * (1 + ctx.getBuffs(u.team as 1 | 2).attack + twB.attack + twBan.attack);
      closestTower.hp -= twDmg;

      events.push({
        type: 'tower_damage',
        attackerId: u.id,
        amount: twDmg,
        x: closestTower.x, y: closestTower.y,
        unitType: u.type,
      });

      u.attackTimer = ATTACK_CD_MS;
      u.attackFaceX = closestTower.x;
      u.animState = 'attack';
    }
  }

  // Append new hits to pending
  for (const h of newHits) {
    ctx.pendingHits.push(h);
  }

  return { events, drops, newPendingHits: newHits };
}

// ─── processPendingHits ───

/**
 * Resolves pending hits (projectile flight, melee timers).
 * Mutates unit HP, dead state, etc. Returns combat events and item drops.
 */
export function processPendingHits(
  delta: number,
  ctx: CombatContext,
): { events: CombatEvent[]; drops: DropItemRequest[] } {
  const events: CombatEvent[] = [];
  const drops: DropItemRequest[] = [];
  const still: SimPendingHit[] = [];

  for (const hit of ctx.pendingHits) {
    // Ranged: move projectile toward target, hit on arrival
    if (hit.isRanged && hit.projSpeed > 0) {
      let tx = hit.projX, ty = hit.projY;
      if (hit.targetId >= 0) {
        const tgt = ctx.unitById.get(hit.targetId);
        if (tgt && !tgt.dead) { tx = tgt.x; ty = tgt.y; }
      } else if (hit.nexusTeam !== 0) {
        const nex = ctx.nexuses.find(n => n.team === hit.nexusTeam);
        if (nex) { tx = nex.x; ty = nex.y; }
      }
      // Move projectile
      const dx = tx - hit.projX, dy = ty - hit.projY;
      const dist = Math.sqrt(dx * dx + dy * dy) || 1;
      const step = hit.projSpeed * (delta / 1000);
      if (dist <= PROJECTILE_HIT_DIST || step >= dist) {
        hit.projX = tx; hit.projY = ty;
        hit.timer = 0; // force damage
      } else {
        hit.projX += (dx / dist) * step;
        hit.projY += (dy / dist) * step;
        hit.timer -= delta;
        if (hit.timer > 0) { still.push(hit); continue; }
        // Fallback timeout — apply damage anyway
      }
    } else {
      // Melee: flat timer countdown
      hit.timer -= delta;
      if (hit.timer > 0) { still.push(hit); continue; }
    }

    // Nexus hit
    if (hit.targetId === -1 && hit.nexusTeam !== 0) {
      const nex = ctx.nexuses.find(n => n.team === hit.nexusTeam);
      if (nex) {
        nex.hp -= hit.dmg;
        events.push({
          type: 'nexus_damage',
          attackerId: hit.attackerId,
          amount: hit.dmg,
          x: nex.x, y: nex.y,
          nexusTeam: nex.team,
        });
      }
      continue;
    }

    // Unit hit
    const target = ctx.unitById.get(hit.targetId);
    const isTowerShot = hit.attackerId === -2;
    const attacker = isTowerShot ? null : (ctx.unitById.get(hit.attackerId) ?? null);
    if (!target || target.dead || (!attacker && !isTowerShot)) {
      continue;
    }
    if (target && !target.dead) {
      target.hp -= hit.dmg;
      // Track total damage for match stats
      if (attacker && attacker.team !== 0) ctx.matchStats.totalDamage[attacker.team as 1 | 2] += hit.dmg;

      events.push({
        type: 'damage',
        attackerId: hit.attackerId,
        targetId: target.id,
        amount: hit.dmg,
        x: target.x, y: target.y,
        isTroll: hit.isTroll,
        isRanged: hit.isRanged,
        isSplash: hit.isSplash,
        isCrit: hit.isCrit,
        unitType: attacker?.type,
        targetType: target.type,
      });

      // Tight formation scatter
      if (!target.dead && target.mods.formation === 'tight' && attacker) {
        const scDx = target.x - attacker.x, scDy = target.y - attacker.y;
        const scD = Math.sqrt(scDx * scDx + scDy * scDy) || 1;
        target.targetX = target.x + (scDx / scD) * 80;
        target.targetY = target.y + (scDy / scD) * 80;
      }

      // Troll club slam — increases enemy attack cooldown
      if (hit.isTroll && !target.dead) {
        target.attackTimer += ATTACK_CD_MS;
        events.push({ type: 'stun', targetId: target.id, x: target.x, y: target.y, unitType: 'troll' });
      }

      // Gnome Plucky — survives lethal hits
      if (target.hp <= 0 && target.type === 'gnome' && target.gnomeShield > 0) {
        target.hp = 1;
        target.gnomeShield--;
        events.push({ type: 'gnome_plucky', targetId: target.id, x: target.x, y: target.y });
      }

      // Skull Undying
      if (target.hp <= 0 && target.type === 'skull' && target.hasRebirth) {
        target.hp = 1;
        target.hasRebirth = false;
        events.push({ type: 'skull_undying', targetId: target.id, x: target.x, y: target.y });
      } else if (target.hp <= 0) {
        target.dead = true;
        target.claimItemId = -1;
        // Track kills, deaths, and top killer
        if (target.team !== 0) ctx.matchStats.unitsLost[target.team as 1 | 2]++;
        if (attacker && attacker.team !== 0) {
          const atkTeam = attacker.team as 1 | 2;
          ctx.matchStats.totalKills[atkTeam]++;
          const kc = (ctx.unitKillCounts.get(attacker.id) || 0) + 1;
          ctx.unitKillCounts.set(attacker.id, kc);
          if (kc > ctx.topKiller[atkTeam].kills) {
            ctx.topKiller[atkTeam] = { type: attacker.type, kills: kc };
          }
        }

        events.push({
          type: 'death',
          targetId: target.id,
          attackerId: attacker?.id,
          x: target.x, y: target.y,
          unitType: target.type,
        });

        // Drop meat on death
        drops.push({
          type: 'meat',
          x: target.x + (Math.random() - 0.5) * 20,
          y: target.y + (Math.random() - 0.5) * 20,
        });

        // Elite drops crystals
        if (target.isElite) {
          ctx.eliteKillCount++;
          for (let ci = 0; ci < 3; ci++) {
            drops.push({
              type: 'crystal',
              x: target.x + (Math.random() - 0.5) * 40,
              y: target.y + (Math.random() - 0.5) * 40,
            });
          }
        }

        // Drop carried resource
        if (target.carrying) {
          drops.push({ type: target.carrying, x: target.x, y: target.y });
          target.carrying = null;
        }
      }
    }

    // Splash targets
    for (const sp of hit.splashTargets) {
      const sTarget = ctx.unitById.get(sp.id);
      if (!sTarget || sTarget.dead) continue;
      sTarget.hp -= sp.dmg;

      events.push({
        type: 'splash',
        attackerId: hit.attackerId,
        targetId: sTarget.id,
        amount: sp.dmg,
        x: sTarget.x, y: sTarget.y,
        targetType: sTarget.type,
      });

      if (hit.isTroll && !sTarget.dead) {
        sTarget.attackTimer += ATTACK_CD_MS;
      }

      // Gnome Plucky for splash
      if (sTarget.hp <= 0 && sTarget.type === 'gnome' && sTarget.gnomeShield > 0) {
        sTarget.hp = 1;
        sTarget.gnomeShield--;
        events.push({ type: 'gnome_plucky', targetId: sTarget.id, x: sTarget.x, y: sTarget.y });
      }

      // Skull Undying for splash
      if (sTarget.hp <= 0 && sTarget.type === 'skull' && sTarget.hasRebirth) {
        sTarget.hp = 1;
        sTarget.hasRebirth = false;
        events.push({ type: 'skull_undying', targetId: sTarget.id, x: sTarget.x, y: sTarget.y });
      } else if (sTarget.hp <= 0) {
        sTarget.dead = true;
        sTarget.claimItemId = -1;
        // Track splash kills/deaths
        if (sTarget.team !== 0) ctx.matchStats.unitsLost[sTarget.team as 1 | 2]++;
        if (attacker && attacker.team !== 0) {
          const atkTeam = attacker.team as 1 | 2;
          ctx.matchStats.totalKills[atkTeam]++;
          const kc = (ctx.unitKillCounts.get(attacker.id) || 0) + 1;
          ctx.unitKillCounts.set(attacker.id, kc);
          if (kc > ctx.topKiller[atkTeam].kills) {
            ctx.topKiller[atkTeam] = { type: attacker.type, kills: kc };
          }
        }

        events.push({
          type: 'death',
          targetId: sTarget.id,
          attackerId: attacker?.id,
          x: sTarget.x, y: sTarget.y,
          unitType: sTarget.type,
        });

        drops.push({
          type: 'meat',
          x: sTarget.x + (Math.random() - 0.5) * 20,
          y: sTarget.y + (Math.random() - 0.5) * 20,
        });

        if (sTarget.isElite) {
          ctx.eliteKillCount++;
          for (let ci = 0; ci < 3; ci++) {
            drops.push({
              type: 'crystal',
              x: sTarget.x + (Math.random() - 0.5) * 40,
              y: sTarget.y + (Math.random() - 0.5) * 40,
            });
          }
        }

        if (sTarget.carrying) {
          drops.push({ type: sTarget.carrying, x: sTarget.x, y: sTarget.y });
          sTarget.carrying = null;
        }
      }

      // Splash scatter
      if (!sTarget.dead && sTarget.mods.formation === 'tight' && target) {
        const scDx = sTarget.x - target.x, scDy = sTarget.y - target.y;
        const scD = Math.sqrt(scDx * scDx + scDy * scDy) || 1;
        sTarget.targetX = sTarget.x + (scDx / scD) * 80;
        sTarget.targetY = sTarget.y + (scDy / scD) * 80;
      }
    }
  }

  ctx.pendingHits = still;

  return { events, drops };
}
