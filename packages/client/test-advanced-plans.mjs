#!/usr/bin/env node
// ═══════════════════════════════════════════════════════════════
// Advanced Plans Test Harness — 50 Tests (20 deterministic + 30 Gemini)
// Tests resolvePlan() logic and Gemini classification for advanced_plan
// Run: node packages/client/test-advanced-plans.mjs
// ═══════════════════════════════════════════════════════════════

import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

// ─── Load API Key ────────────────────────────────────────────
function loadApiKey() {
  try {
    const envPath = resolve(__dirname, '.env');
    const envContent = readFileSync(envPath, 'utf-8');
    for (const line of envContent.split(/\r?\n/)) {
      const match = line.trim().match(/^VITE_GEMINI_API_KEY=(.+)$/);
      if (match) return match[1].trim();
    }
  } catch { /* fall through */ }
  throw new Error('Missing VITE_GEMINI_API_KEY in .env');
}

const GEMINI_API_KEY = loadApiKey();
const GEMINI_MODEL = 'gemini-2.5-flash';
const GEMINI_URL = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=`;
const MAX_RETRIES = 3;

// ═══════════════════════════════════════════════════════════════
// Section 2: Game Constants (replicated from HordeScene.ts)
// ═══════════════════════════════════════════════════════════════

const EQUIPMENT = [
  { id: 'pickaxe', name: 'Pickaxe', emoji: '⛏️', cost: { carrot: 15 } },
  { id: 'sword',   name: 'Sword',   emoji: '⚔️', cost: { meat: 15, metal: 5 } },
  { id: 'shield',  name: 'Shield',  emoji: '🛡️', cost: { meat: 15, metal: 5 } },
  { id: 'boots',   name: 'Boots',   emoji: '👢', cost: { carrot: 12, metal: 4 } },
  { id: 'banner',  name: 'Banner',  emoji: '🚩', cost: { meat: 20, metal: 8 } },
];

const EQUIP_LEVEL_COST_MULT = [0, 1.0, 2.0, 3.0];
const MAX_EQUIP_LEVEL = 3;

const EQUIPMENT_PREREQS = {
  pickaxe: [],
  sword:   ['pickaxe'],
  shield:  ['pickaxe'],
  boots:   ['pickaxe'],
  banner:  ['pickaxe'],
};

const RESOURCE_GATHER_NEEDS = {
  carrot:  {},
  meat:    {},
  crystal: {},
  metal:   { needsEquipment: 'pickaxe' },
};

const RESOURCE_EMOJI = { carrot: '🥕', meat: '🍖', crystal: '💎', metal: '⚙️' };

// ═══════════════════════════════════════════════════════════════
// Section 3: resolvePlan() replica
// ═══════════════════════════════════════════════════════════════

function resolvePlan(goal, stock, equipLevels, originalCommand) {
  const planId = `plan_test`;
  const projectedStock = { ...stock };
  const phases = [];
  let phaseIdx = 0;

  const getEquipLevel = (eqType) => equipLevels[eqType] || 0;
  const makePhaseId = () => `${planId}_p${phaseIdx++}`;

  // Helper: build gathering workflow for a resource type
  const gatherWorkflow = (res) => {
    if (res === 'carrot') {
      return { label: `Gather ${RESOURCE_EMOJI[res]} → base`, type: 'gather', resource: res };
    } else if (res === 'meat') {
      return { label: `Gather ${RESOURCE_EMOJI[res]} → base`, type: 'gather', resource: res };
    } else if (res === 'crystal') {
      return { label: `Gather ${RESOURCE_EMOJI[res]} → base`, type: 'gather', resource: res };
    } else {
      // metal — requires pickaxe equipped
      return { label: `Mine ⚙️ → base`, type: 'mine', resource: res };
    }
  };

  // Helper: add phases to unlock equipment
  const addUnlockPhases = (eqType, targetLevel) => {
    const def = EQUIPMENT.find(e => e.id === eqType);
    if (!def) return;
    const costMult = EQUIP_LEVEL_COST_MULT[targetLevel];

    // Compute required resources and deficit using projectedStock
    for (const [res, baseAmt] of Object.entries(def.cost)) {
      const needed = Math.ceil(baseAmt * costMult);
      const have = projectedStock[res] || 0;
      const deficit = needed - have;
      if (deficit > 0) {
        phases.push({
          id: makePhaseId(),
          workflow: gatherWorkflow(res),
          completionCheck: 'resource_threshold',
          resourceTarget: { [res]: needed },
          label: `Gather ${deficit} ${RESOURCE_EMOJI[res]}`,
        });
      }
    }

    // Unlock phase
    const totalCost = Object.entries(def.cost).map(([r, a]) => `${Math.ceil(a * costMult)}${RESOURCE_EMOJI[r]}`).join('+');
    phases.push({
      id: makePhaseId(),
      workflow: null,
      completionCheck: 'equipment_unlocked',
      equipTarget: { type: eqType, level: targetLevel },
      onComplete: { unlock: eqType },
      label: `Unlock ${def.emoji} ${def.name} (${totalCost})`,
    });

    // Deduct projected cost
    for (const [res2, baseAmt2] of Object.entries(def.cost)) {
      projectedStock[res2] = Math.max(0, (projectedStock[res2] || 0) - Math.ceil(baseAmt2 * costMult));
    }
  };

  if (goal.type === 'unlock_equipment' && goal.equipment) {
    const eqType = goal.equipment;
    const def = EQUIPMENT.find(e => e.id === eqType);
    if (!def) return null;

    const currentLevel = getEquipLevel(eqType);
    const targetLevel = currentLevel + 1;
    if (targetLevel > MAX_EQUIP_LEVEL) return null; // already maxed

    const costMult = EQUIP_LEVEL_COST_MULT[targetLevel];

    // Check if we can afford it right now
    let canAfford = true;
    for (const [res, amt] of Object.entries(def.cost)) {
      if ((projectedStock[res] || 0) < Math.ceil(amt * costMult)) { canAfford = false; break; }
    }

    if (canAfford) {
      phases.push({
        id: makePhaseId(),
        workflow: null,
        completionCheck: 'equipment_unlocked',
        equipTarget: { type: eqType, level: targetLevel },
        onComplete: { unlock: eqType },
        label: `Unlock ${def.emoji} ${def.name}`,
      });
      // Deduct projected cost for canAfford instant unlock too
      for (const [res2, baseAmt2] of Object.entries(def.cost)) {
        projectedStock[res2] = Math.max(0, (projectedStock[res2] || 0) - Math.ceil(baseAmt2 * costMult));
      }
    } else {
      // Resolve prerequisite chain
      for (const res of Object.keys(def.cost)) {
        const gatherNeed = RESOURCE_GATHER_NEEDS[res];
        if (gatherNeed.needsEquipment) {
          const prereqEq = gatherNeed.needsEquipment;
          if (getEquipLevel(prereqEq) === 0 && !phases.some(p => p.equipTarget?.type === prereqEq)) {
            // Check deeper prereqs
            for (const deepPrereq of EQUIPMENT_PREREQS[prereqEq]) {
              if (getEquipLevel(deepPrereq) === 0 && !phases.some(p => p.equipTarget?.type === deepPrereq)) {
                addUnlockPhases(deepPrereq, 1);
              }
            }
            addUnlockPhases(prereqEq, 1);
          }
        }
      }
      // Now add phases for the actual target equipment
      addUnlockPhases(eqType, targetLevel);
    }

    // Add thenAction as final phase if specified
    if (goal.thenAction) {
      const finalLabel = goal.thenAction;
      phases.push({
        id: makePhaseId(),
        workflow: { label: finalLabel, type: 'thenAction' },
        completionCheck: 'final',
        label: finalLabel,
      });
    }

    const levelLabel = currentLevel === 0 ? '' : ` Lvl ${targetLevel}`;
    return {
      id: planId,
      phases,
      goalLabel: `${def.emoji} ${def.name}${levelLabel}`,
    };

  } else if (goal.type === 'stockpile_resource' && goal.resource) {
    const res = goal.resource;
    const gatherNeed = RESOURCE_GATHER_NEEDS[res];

    // If resource needs equipment we don't have, prepend unlock phases
    if (gatherNeed.needsEquipment) {
      const prereqEq = gatherNeed.needsEquipment;
      if (getEquipLevel(prereqEq) === 0) {
        for (const deepPrereq of EQUIPMENT_PREREQS[prereqEq]) {
          if (getEquipLevel(deepPrereq) === 0) {
            addUnlockPhases(deepPrereq, 1);
          }
        }
        addUnlockPhases(prereqEq, 1);
      }
    }

    // Final looping gather phase
    phases.push({
      id: makePhaseId(),
      workflow: gatherWorkflow(res),
      completionCheck: 'final',
      label: `Stockpile ${RESOURCE_EMOJI[res]}`,
    });

    return {
      id: planId,
      phases,
      goalLabel: `Stockpile ${RESOURCE_EMOJI[res]}`,
    };
  }

  return null;
}

// ═══════════════════════════════════════════════════════════════
// Section 4: Mock Game States
// ═══════════════════════════════════════════════════════════════

const STATE_FRESH    = { stock: {carrot:0, meat:0, crystal:0, metal:0}, equip: {} };
const STATE_SOME_RES = { stock: {carrot:8, meat:5, crystal:0, metal:2}, equip: {} };
const STATE_PICKAXE  = { stock: {carrot:3, meat:8, crystal:0, metal:2}, equip: {pickaxe:1} };
const STATE_RICH     = { stock: {carrot:20, meat:20, crystal:10, metal:10}, equip: {pickaxe:1} };
const STATE_FULL     = { stock: {carrot:50, meat:50, crystal:20, metal:20}, equip: {pickaxe:1, sword:1, shield:1} };

// ═══════════════════════════════════════════════════════════════
// Section 5: buildPrompt() — CURRENT prompt from HordeScene.ts
// ═══════════════════════════════════════════════════════════════

const MOCK_CTX = {
  myUnits: [
    { type: 'gnome', count: 8, tier: 1, gathering: 3 },
    { type: 'skull', count: 4, tier: 2, gathering: 0 },
    { type: 'hyena', count: 2, tier: 2, gathering: 0 },
  ],
  camps: [
    { name: 'Gnome Hollow', animalType: 'gnome', tier: 1, owner: 'YOURS', index: 0, x: 800, y: 1200, dist: 400, defenders: 0, storedFood: 1, spawnCost: 2 },
    { name: 'Turtle Pond', animalType: 'turtle', tier: 1, owner: 'NEUTRAL', index: 1, x: 1600, y: 1000, dist: 900, defenders: 3, storedFood: 0, spawnCost: 5 },
    { name: 'Skull Pit', animalType: 'skull', tier: 2, owner: 'YOURS', index: 2, x: 2200, y: 2000, dist: 1500, defenders: 0, storedFood: 2, spawnCost: 5 },
    { name: 'Spider Den', animalType: 'spider', tier: 2, owner: 'NEUTRAL', index: 3, x: 3000, y: 1400, dist: 2100, defenders: 4, storedFood: 0, spawnCost: 5 },
    { name: 'Hyena Ridge', animalType: 'hyena', tier: 2, owner: 'ENEMY', index: 4, x: 4500, y: 3200, dist: 3800, defenders: 2, storedFood: 3, spawnCost: 5 },
    { name: 'Panda Grove', animalType: 'panda', tier: 3, owner: 'NEUTRAL', index: 5, x: 3500, y: 4000, dist: 3200, defenders: 5, storedFood: 0, spawnCost: 8 },
  ],
  nexusHp: { mine: 45000, enemy: 48000 },
  resources: { carrot: 12, meat: 8, crystal: 3, metal: 0 },
  groundCarrots: 15,
  groundMeat: 6,
  groundCrystals: 2,
  gameTime: 120000,
  selectedHoard: 'all',
  hoardCenter: { x: 1800, y: 2500 },
  carrotZones: [
    { x: 200, y: 3400, w: 2800, h: 2800 },
    { x: 3400, y: 200, w: 2800, h: 2800 },
  ],
  activeEvents: [],
  equipment: {},
};

function buildPrompt(rawText, ctx) {
  const campList = ctx.camps.map(c =>
    `  [${c.index}] ${c.name} (${c.animalType}, T${c.tier}) - ${c.owner}${c.storedFood > 0 ? ` - food:${c.storedFood}/${c.spawnCost}` : ''} - dist:${c.dist} - defenders:${c.defenders}`
  ).join('\n');

  const unitList = ctx.myUnits.map(u => {
    let info = `  ${u.type} (T${u.tier}): ${u.count} units`;
    if (u.gathering > 0) info += ` (${u.gathering} gathering)`;
    return info;
  }).join('\n');

  const equipStr = ctx.equipment ? Object.entries(ctx.equipment).map(([k,v]) => `${k}:L${v}`).join(', ') || 'none' : 'none';

  return `You are the AI commander for a voice-controlled RTS game called "Horde Capture." The player speaks commands and you interpret them into game actions. You deeply understand the game's economy and must reason about what the player wants.

═══ GAME ECONOMY ═══
Resources: 🥕 Carrots (spawn on ground everywhere), 🍖 Meat (drops from killed wild animals), 💎 Crystals (drops from elite prey), ⚙️ Metal (mined from mine nodes on the map)

SPAWN COSTS — each unit type requires a specific resource delivered to its camp:
  Tier 1: gnome (🧝) = 2 carrots, turtle (🐢) = 5 carrots
  Tier 2: skull (💀) = 5 meat, spider (🕷️) = 5 meat, hyena (🐺) = 5 meat, rogue (🗡️) = 5 meat
  Tier 3: panda (🐼) = 8 meat, lizard (🦎) = 8 meat
  Tier 4: minotaur (🐂) = 12 crystals, shaman (🔮) = 12 crystals
  Tier 5: troll (👹) = 20 crystals

HOW SPAWNING WORKS: Units gather a resource → carry it to a camp of the desired type → camp uses it to spawn that unit type. E.g. "make gnomes" means gather carrots and deliver to a gnome camp. "make skulls" means gather meat and deliver to a skull camp. Base stores resources but does NOT spawn units — only camps spawn units. Each team gets 1 free gnome from base every 30 seconds automatically.

BASE STOCKPILE: Units can WITHDRAW resources from the base stockpile using {"action":"withdraw_base","resourceType":"carrot|meat|crystal|metal"}. This lets you redistribute stored resources — e.g. take carrots from base and deliver to a gnome camp. Use this when base has surplus resources and you want to feed camps directly.

To produce a unit, you MUST own a camp of that type. Camps start neutral with defenders — kill the defenders to capture.

ARMORY: 🏛️ Each team has an Armory building on their side of the map. Players unlock equipment with resources ("unlock swords"), then units walk to the Armory to pick items up. Equipment is permanent (doesn't drop on death). Units can carry a resource AND have equipment. One equipment per unit.

EQUIPMENT (unlock once, unlimited pickups):
  ⛏️ Pickaxe (15🥕): Required to mine metal. +25% gather speed.
  ⚔️ Sword (15🍖+5⚙️): +50% attack, +25% attack speed.
  🛡️ Shield (15🍖+5⚙️): +60% HP, -25% damage taken, -15% speed.
  👢 Boots (12🥕+4⚙️): +60% move speed, +50% pickup range.
  🚩 Banner (20🍖+8⚙️): Aura — nearby allies +20% atk, +15% speed.

EQUIPMENT STATUS: ${equipStr}

MINES: ⛏️ Mine nodes on the map. Only units with a Pickaxe can mine metal. Metal is used to unlock equipment.

To equip: include {"action":"equip","equipmentType":"pickaxe|sword|shield|boots|banner"} step BEFORE other steps. Unit walks to Armory, picks up item, then continues.
Example: "get pickaxes then mine" → [{"action":"equip","equipmentType":"pickaxe"},{"action":"mine"},{"action":"deliver","target":"base"}]
Example: "get swords and attack" → [{"action":"equip","equipmentType":"sword"},{"action":"attack_camp","targetAnimal":"hyena","qualifier":"nearest"}]

═══ CURRENT GAME STATE ═══
Time: ${Math.floor(ctx.gameTime / 1000)}s
Selected hoard: ${ctx.selectedHoard} (player commands this group via hotkeys)

MY UNITS:
${unitList || '  (none)'}

MY BASE STOCKPILE: 🥕${ctx.resources.carrot} 🍖${ctx.resources.meat} 💎${ctx.resources.crystal} ⚙️${ctx.resources.metal}
(Units can withdraw from base stockpile using withdraw_base action to redistribute to camps)

CAMPS (sorted by distance):
${campList}

NEXUS HP: mine=${ctx.nexusHp.mine}/50000, enemy=${ctx.nexusHp.enemy >= 0 ? ctx.nexusHp.enemy + '/50000' : 'unknown (not in vision)'}

Ground items nearby: 🥕${ctx.groundCarrots} carrots, 🍖${ctx.groundMeat} meat, 💎${ctx.groundCrystals} crystals on the map

CARROT SPAWN ZONES (carrots appear in these areas every 5s):
${ctx.carrotZones.length > 0 ? ctx.carrotZones.map((z, i) => `  Zone ${i + 1}: (${z.x},${z.y}) to (${z.x + z.w},${z.y + z.h}) — center (${Math.round(z.x + z.w / 2)},${Math.round(z.y + z.h / 2)})`).join('\n') : '  (scattered across map)'}

ACTIVE MAP EVENTS:
${ctx.activeEvents && ctx.activeEvents.length > 0 ? ctx.activeEvents.map(e => `  ${e.emoji} ${e.type} at (${e.x},${e.y}) — ${e.info} — ${e.timeLeft}s left`).join('\n') : '  (none)'}

HOARD POSITION: Your selected units are centered at (${ctx.hoardCenter.x}, ${ctx.hoardCenter.y})
Map is 6400x6400. My base is at (250, 6150). Enemy base is at (6150, 250).

SPATIAL REFERENCE (relative to hoard center):
  Left: x-600  |  Right: x+600  |  Up: y-600  |  Down: y+600
  For "go left": move to (${Math.max(50, ctx.hoardCenter.x - 600)}, ${ctx.hoardCenter.y})
  For "go right": move to (${Math.min(6350, ctx.hoardCenter.x + 600)}, ${ctx.hoardCenter.y})
  For "go up/forward": move to (${ctx.hoardCenter.x}, ${Math.max(50, ctx.hoardCenter.y - 600)})
  For "go down/back": move to (${ctx.hoardCenter.x}, ${Math.min(6350, ctx.hoardCenter.y + 600)})

When the player says a RELATIVE direction ("go left", "move right", "push forward"):
  → Use the hoard center as origin, offset by ~600 in that direction
  → Clamp to map bounds [50, 6350]
  → Do NOT use absolute map edges — the player means relative to where their units ARE

When flanking or going around a target:
  → Compute waypoints that arc from hoard center around the target
  → E.g. if hoard=(2000,3000) and target=(4500,3200), flank via (3500,1500)→(5000,2000)→(4500,3200)

═══ BEHAVIOR MODIFIERS ═══
Modifiers change HOW units execute (not WHAT they do). They persist until changed. Can be combined with ANY workflow.

FORMATION: "spread" | "tight" | null
  spread: fan out/scatter/spread out/don't clump → units space apart
  tight: group up/stick together/stay close/cluster → units bunch up
  null: clear formation

CAUTION: "safe" | "aggressive" | null
  safe: careful/don't die/play safe/be careful → avoid threats, hunt weaker prey
  aggressive: go hard/no mercy/be aggressive → no avoidance, engage everything
  null: clear caution

PACING: "rush" | "efficient" | null
  rush: rush/hurry/go fast/faster → lower idle tolerance, faster restarts
  efficient: be efficient/smart/one at a time → careful resource claiming
  null: clear pacing

MODIFIER RULES:
- Modifiers can appear WITH a workflow command: "aggressively attack with swords" → caution:"aggressive" + equip sword + attack_enemies
- Modifier-only commands (no action change): "be more careful" / "spread out" → modifierOnly=true
- "back to normal" / "reset" → clear all to null, modifierOnly=true
- "rush the base" → attack nexus (NOT rush modifier). "rush economy" → rush modifier.
- ALWAYS include modifiers if the tone/adjectives imply them, even alongside workflows.

═══ ACTIONS ═══
Simple movement commands (no workflow needed):
- "camp": Go to a specific camp. Set campIndex.
- "nearest_camp": Go to nearest camp matching filters (targetAnimal, qualifier).
- "sweep_camps": Chain-capture multiple camps of a type.
- "nexus": Attack enemy nexus.
- "base"/"defend"/"retreat": Fall back / hold / go home.

QUALIFIERS: nearest, furthest, weakest, uncaptured, enemy

═══ WORKFLOWS ═══
For economy/production commands, you design a WORKFLOW — a repeating loop of steps the units execute automatically. Use targetType="workflow" and provide a "workflow" array.

Available step types:
  {"action": "seek_resource", "resourceType": "carrot|meat|crystal"} — find and pick up a ground resource
  {"action": "deliver", "target": "base|nearest_TYPE_camp"} — carry item to a destination. Use "nearest_gnome_camp", "nearest_skull_camp", etc.
  {"action": "hunt", "targetType": "skull|spider|..."} — attack wild animals (they drop meat/crystals on death). Optional targetType filter.
  {"action": "attack_camp", "targetAnimal": "gnome|skull|...", "qualifier": "nearest"} — go capture a camp
  {"action": "move", "x": 1000, "y": 1000} — move to coordinates
  {"action": "defend", "target": "base|nearest_TYPE_camp"} — guard a location, patrol nearby, fight enemies that approach. ALWAYS include target! "defend the panda camp" → target:"nearest_panda_camp"
  {"action": "attack_enemies"} — seek and fight enemy player units relentlessly
  {"action": "scout", "x": 500, "y": 500} — explore a region, AVOIDS combat. Use x,y to target a specific area. For directional scouting ("explore the right side"), set x,y to the CENTER of that region. Use MULTIPLE scout steps with different x,y coords for patrol routes. Map regions: left side x≈800, right side x≈5600, top y≈800, bottom y≈5600, center x≈3200,y≈3200. Omit x,y for random full-map exploration.
  {"action": "collect", "resourceType": "carrot|meat|crystal"} — pick up ground resources while AVOIDING enemy units (safe gathering)
  {"action": "kill_only", "targetType": "skull|spider|..."} — hunt and kill wild animals but IGNORE resource drops (pure combat, no pickup)
  {"action": "mine"} — go to nearest mine node and extract metal, then carry it back (requires Pickaxe equipment)
  {"action": "contest_event"} — move to nearest active map event and interact (gather, deliver, attack, sacrifice, feed). Use when player says "go to event", "contest the event", "help with the bear", etc.
  {"action": "equip", "equipmentType": "pickaxe|sword|shield|boots|banner"} — go to team Armory and equip item (must be unlocked first)
  {"action": "withdraw_base", "resourceType": "carrot|meat|crystal|metal"} — go to base and take 1 resource from stockpile (unit carries it, then deliver to camp)

The workflow LOOPS automatically. Design the steps so they make a sensible repeating cycle.

═══ TASK CHAINING (loopFrom) ═══
Use "loopFrom" to mark where the repeating loop starts. Steps before loopFrom run once; steps from loopFrom onward loop forever.
loopFrom=0 (default) means everything loops. loopFrom>0 means steps 0..loopFrom-1 are one-shot setup.
"then"/"after that" in player speech signals a phase boundary → set loopFrom where the second part starts.

SPECIAL: Turtles carry 10x resources per trip — they're slow but incredibly efficient haulers! Prefer assigning turtles to gather/deliver workflows.

═══ UNIT TRAITS & ROLES ═══
Each unit has unique strengths — use these to make smart workflow decisions:

GNOME (T1, 🧝): Fast, nimble, 2x pickup range. BEST gatherer for carrots. Cheap (1 carrot). Weak fighter — keep gathering, not fighting.
TURTLE (T1, 🐢): Slow but carries 10x resources per trip! Ultimate hauler. 1 carrot. Taunts nearby enemies (forces them to attack the turtle). Always prefer turtles for any gather/deliver workflow.
SKULL (T2, 💀): Cheats death once (survives lethal at 1 HP). Good fighter. 3 meat. Can self-sustain: hunt → pick meat → deliver to own camp.
SPIDER (T2, 🕷️): Fast ambusher. Great for raiding and hit-and-run. 3 meat.
HYENA (T2, 🐺): Ranged attacker (120 range vs normal 60). Excellent for defense and kiting. 5 meat.
ROGUE (T2, 🗡️): Fast assassin. 3x damage on first hit against a new target (Backstab). Invisible to neutral enemies — can sneak past camp defenders! Great for hit-and-run. 3 meat.
PANDA (T3, 🐼): Tanky brawler, high HP. Excellent frontline defender. 5 meat.
LIZARD (T3, 🦎): Agile, good damage. Great raider. 5 meat.
MINOTAUR (T4, 🐂): Massive HP and damage. Late-game powerhouse. 8 crystals.
SHAMAN (T4, 🔮): Support/caster. Strong but expensive. 8 crystals.
TROLL (T5, 👹): Ultimate unit — enormous stats. Only 1 camp at map center. 12 crystals. Game-ender.

═══ RESOURCE FLOW ═══
Carrots → spawn on ground naturally (slow). Gnomes/turtles eat these.
Meat → drops when wild animals die. Need to HUNT first. For T2-T3.
Crystals → drop from elite golden minotaurs (rare, tough, map center). For T4-T5.
KEY: For meat/crystals, include "hunt" step BEFORE "seek_resource". For carrots, just "seek_resource".

═══ BOOTSTRAP SEQUENCES (per unit type) ═══
"bootstrap gnomes": [{"action":"attack_camp","targetAnimal":"gnome","qualifier":"nearest"},{"action":"seek_resource","resourceType":"carrot"},{"action":"deliver","target":"nearest_gnome_camp"}]
"bootstrap turtles": [{"action":"attack_camp","targetAnimal":"turtle","qualifier":"nearest"},{"action":"seek_resource","resourceType":"carrot"},{"action":"deliver","target":"nearest_turtle_camp"}]
"bootstrap skulls": [{"action":"attack_camp","targetAnimal":"skull","qualifier":"nearest"},{"action":"hunt"},{"action":"seek_resource","resourceType":"meat"},{"action":"deliver","target":"nearest_skull_camp"}]
"bootstrap spiders": [{"action":"attack_camp","targetAnimal":"spider","qualifier":"nearest"},{"action":"hunt"},{"action":"seek_resource","resourceType":"meat"},{"action":"deliver","target":"nearest_spider_camp"}]
"bootstrap hyenas": [{"action":"attack_camp","targetAnimal":"hyena","qualifier":"nearest"},{"action":"hunt"},{"action":"seek_resource","resourceType":"meat"},{"action":"deliver","target":"nearest_hyena_camp"}]
"bootstrap rogues": [{"action":"attack_camp","targetAnimal":"rogue","qualifier":"nearest"},{"action":"hunt"},{"action":"seek_resource","resourceType":"meat"},{"action":"deliver","target":"nearest_rogue_camp"}]
"bootstrap pandas": [{"action":"attack_camp","targetAnimal":"panda","qualifier":"nearest"},{"action":"hunt"},{"action":"seek_resource","resourceType":"meat"},{"action":"deliver","target":"nearest_panda_camp"}]
"bootstrap lizards": [{"action":"attack_camp","targetAnimal":"lizard","qualifier":"nearest"},{"action":"hunt"},{"action":"seek_resource","resourceType":"meat"},{"action":"deliver","target":"nearest_lizard_camp"}]
"bootstrap minotaurs": [{"action":"attack_camp","targetAnimal":"minotaur","qualifier":"nearest"},{"action":"hunt","targetType":"minotaur"},{"action":"seek_resource","resourceType":"crystal"},{"action":"deliver","target":"nearest_minotaur_camp"}]
"bootstrap shamans": [{"action":"attack_camp","targetAnimal":"shaman","qualifier":"nearest"},{"action":"hunt","targetType":"minotaur"},{"action":"seek_resource","resourceType":"crystal"},{"action":"deliver","target":"nearest_shaman_camp"}]
"bootstrap troll": [{"action":"attack_camp","targetAnimal":"troll","qualifier":"nearest"},{"action":"hunt","targetType":"minotaur"},{"action":"seek_resource","resourceType":"crystal"},{"action":"deliver","target":"nearest_troll_camp"}]

═══ INTENT CLASSIFICATION ═══

STEP 1: Detect modifiers from tone/adjectives (can combine with any action below):
  - "aggressively", "carefully", "spread out", "rush", "efficiently" → set modifiers
  - Pure modifier commands ("be careful", "spread out") → modifierOnly=true, NO workflow

STEP 2: Classify the PRIMARY intent:

A) ADVANCED PLAN (UNLOCK/UPGRADE EQUIPMENT): "get me shields", "unlock pickaxe", "upgrade swords", "I want banners", "work on getting boots"
   When player wants to UNLOCK or UPGRADE equipment (whether or not they have the resources):
   → targetType="advanced_plan"
   → planGoal: { "type": "unlock_equipment", "equipment": "[id]" }
   The game will automatically resolve the full prerequisite chain (gather resources, unlock prerequisites, etc).

   With follow-up action: "get shields and defend", "unlock swords and attack"
   → planGoal: { "type": "unlock_equipment", "equipment": "shield", "thenAction": "defend" }

   Resource stockpiling: "stockpile metal", "I need metal", "gather metal for me"
   → planGoal: { "type": "stockpile_resource", "resource": "metal", "amount": 20 }

   DISAMBIGUATION:
   - "equip swords" (already unlocked, just pick up) → regular workflow with equip step (B below)
   - "unlock/upgrade/get swords" (unlock new or upgrade) → advanced_plan
   - "get [animal]" (e.g. "get skulls") → bootstrap (C below), NOT advanced_plan
   - Equipment names: pickaxe, sword, shield, boots, banner

AA) UNLOCK EQUIPMENT (text command fallback): "unlock/buy/research [equipment name]"
   → This is NOT a workflow. Return targetType="base" with narration about unlocking.
   → The game handles unlock logic separately from this JSON.
   → Prefer advanced_plan (A) over this for voice commands.

B) EQUIP + ACTION: "get/grab/equip [equipment] and/then [action]"
   → targetType="workflow", start with {"action":"equip","equipmentType":"..."}, then action steps
   Examples:
   "get pickaxes and mine" → [equip pickaxe, mine, deliver base]
   "grab swords and attack wolf camp" → [equip sword, attack_camp hyena nearest]
   "get shields and defend base" → [equip shield, defend base]
   "equip boots and gather carrots" → [equip boots, seek_resource carrot, deliver base]
   "get banners and follow the hoard" → [equip banner, attack_enemies]
   "get pickaxes and mine aggressively" → [equip pickaxe, mine, deliver base] + caution:"aggressive"

C) PRODUCE/BOOTSTRAP UNIT: "get/make/take/produce/train/spawn [ANIMAL TYPE]"
   → ALWAYS full bootstrap: [attack_camp, (hunt if meat/crystal), seek_resource, deliver]
   → CRITICAL: ALWAYS include attack_camp as the FIRST step, even if we already own a camp of that type! The attack_camp step is a runtime safeguard — the game auto-skips it when the camp is owned but re-captures if lost. NEVER omit it.
   → "get" + animal name = bootstrap, NOT equip! "get gnomes" = bootstrap gnomes, "get a sword" = equip sword
   → CRITICAL: "get skulls" = bootstrap skulls. "get a pickaxe" = equip pickaxe. Distinguish animal names from equipment names!
   → If "safely"/"safe"/"careful" is mentioned: use "collect" instead of "seek_resource" AND set caution:"safe"
   → "safely make gnomes" → [attack_camp gnome, collect carrot, deliver nearest_gnome_camp] + caution:"safe"

D) GATHER/FARM: "gather/farm/harvest/stockpile [resource]"
   → [seek_resource, deliver base] or [hunt, seek_resource, deliver base]
   → EXCEPTION: "stockpile metal" or "gather metal" → advanced_plan (A) because metal requires pickaxe prerequisite chain

E) COMBAT: "attack/fight/kill/raid [target]"
   → attack_camp, attack_enemies, kill_only, or nexus

F) MINING: "mine/mine metal/go mine"
   → [equip pickaxe, mine, deliver base] — ALWAYS include equip pickaxe step for mining commands
   → If "safely"/"safe"/"careful" is mentioned: set caution:"safe"

G) DEFEND: "defend/guard/protect [location]"
   → [defend target]

H) MOVEMENT: "go to/move to/retreat/scout"
   → Simple movement or scout workflow

═══ EXAMPLES (all workflows show loopFrom) ═══

PRODUCTION (bootstrap — capture camp + gather + deliver, loopFrom: 0 = all steps loop):
"make gnomes" → [attack_camp gnome nearest, seek_resource carrot, deliver nearest_gnome_camp], loopFrom: 0
"get skulls" → [attack_camp skull nearest, hunt, seek_resource meat, deliver nearest_skull_camp], loopFrom: 0
"take pandas" → [attack_camp panda nearest, hunt, seek_resource meat, deliver nearest_panda_camp], loopFrom: 0
"gnomes make skulls" → [attack_camp skull nearest, seek_resource meat, deliver nearest_skull_camp], loopFrom: 0

SAFE PRODUCTION (collect instead of seek_resource, avoids enemies):
"safely get gnomes" → [attack_camp gnome nearest, collect carrot, deliver nearest_gnome_camp], loopFrom: 0, caution: "safe"
"make skulls safely" → [attack_camp skull nearest, hunt, collect meat, deliver nearest_skull_camp], loopFrom: 0, caution: "safe"
"carefully bootstrap turtles" → [attack_camp turtle nearest, collect carrot, deliver nearest_turtle_camp], loopFrom: 0, caution: "safe"

GATHER & STOCKPILE:
"gather carrots" → [seek_resource carrot, deliver base], loopFrom: 0
"stockpile carrots" → [seek_resource carrot, deliver base], loopFrom: 0
"farm meat" → [hunt, seek_resource meat, deliver base], loopFrom: 0
"safely gather carrots" → [collect carrot], loopFrom: 0, caution: "safe"
"aggressively farm meat" → [hunt, seek_resource meat, deliver base], loopFrom: 0, caution: "aggressive"
"spread out and gather crystals" → [hunt minotaur, seek_resource crystal, deliver base], loopFrom: 0, formation: "spread"

HUNTING & KILL-ONLY:
"hunt wilds" → [hunt], loopFrom: 0
"aggressively hunt everything" → [hunt], loopFrom: 0
"kill animals but don't pick anything up" → [kill_only], loopFrom: 0
"just kill spiders, ignore the drops" → [kill_only spider], loopFrom: 0
NOTE: "don't pick up"/"ignore drops"/"just kill" → use kill_only (NOT hunt). hunt = kill + auto-pickup, kill_only = kill + ignore drops., caution: "aggressive"

EQUIPMENT (equip is one-shot, loopFrom after equip step):
"mine metal" → [equip pickaxe, mine, deliver base], loopFrom: 1
"get swords and fight" → [equip sword, attack_enemies], loopFrom: 1
"grab boots and collect carrots" → [equip boots, collect carrot], loopFrom: 1
"carefully get pickaxes and mine" → [equip pickaxe, mine, deliver base], loopFrom: 1, caution: "safe"
"aggressively attack with swords" → [equip sword, attack_enemies], loopFrom: 1, caution: "aggressive"
"spread out and gather carrots with boots" → [equip boots, seek_resource carrot, deliver base], loopFrom: 1, formation: "spread"
"rush to get shields and defend" → [equip shield, defend base], loopFrom: 1, pacing: "rush"
"get a banner and lead the charge" → [equip banner, attack_enemies], loopFrom: 1, caution: "aggressive"

TASK CHAINING ("then"/"after that" = one-shot setup + looping action):
"equip sword then defend base" → [equip sword, defend base], loopFrom: 1
"get pickaxes then mine" → [equip pickaxe, mine, deliver base], loopFrom: 1
"grab shields then defend base safely" → [equip shield, defend base], loopFrom: 1, caution: "safe"
"get swords then aggressively attack enemies" → [equip sword, attack_enemies], loopFrom: 1, caution: "aggressive"
"equip boots then gather carrots spread out" → [equip boots, seek_resource carrot, deliver base], loopFrom: 1, formation: "spread"
"get banners then rush the enemy" → [equip banner, attack_enemies], loopFrom: 1, pacing: "rush"

CHAINING WITH CAMPS (attack_camp + deliver to camp = loopFrom: 0 ALWAYS — camp safeguard):
"capture skull camp then gather meat" → [attack_camp skull nearest, hunt, seek_resource meat, deliver nearest_skull_camp], loopFrom: 0
"take the gnome camp then make gnomes" → [attack_camp gnome nearest, seek_resource carrot, deliver nearest_gnome_camp], loopFrom: 0
"capture spider camp then spread out and gather meat" → [attack_camp spider nearest, hunt, seek_resource meat, deliver nearest_spider_camp], loopFrom: 0, formation: "spread"
"rush to capture panda camp after that farm meat" → [attack_camp panda nearest, hunt, seek_resource meat, deliver nearest_panda_camp], loopFrom: 0, pacing: "rush"
"safely take gnome camp and then gather carrots" → [attack_camp gnome nearest, collect carrot, deliver nearest_gnome_camp], loopFrom: 0, caution: "safe"

DEFEND & COMBAT (single-step loops):
"defend base" → [defend base], loopFrom: 0
"aggressively defend base" → [defend base], loopFrom: 0, caution: "aggressive"
"carefully scout the map" → [scout], loopFrom: 0, caution: "safe"
"explore the right side" → [scout x:5600 y:2000, scout x:5600 y:4400], loopFrom: 0
"scout top left" → [scout x:800 y:800], loopFrom: 0
"patrol the middle" → [scout x:2400 y:3200, scout x:4000 y:3200], loopFrom: 0
"scout around the enemy base" → [scout x:5500 y:800, scout x:5800 y:1500], loopFrom: 0, caution: "safe"

REDISTRIBUTE BASE RESOURCES:
"use base carrots to make gnomes" → [withdraw_base carrot, deliver nearest_gnome_camp], loopFrom: 0
"take meat from base and feed skull camp" → [withdraw_base meat, deliver nearest_skull_camp], loopFrom: 0
"redistribute carrots to gnome camp" → [withdraw_base carrot, deliver nearest_gnome_camp], loopFrom: 0
"spread out and defend" → [defend base], loopFrom: 0, formation: "spread"

SIMPLE MOVEMENT (no workflow, no loopFrom):
"attack nearest camp" → targetType: "nearest_camp", qualifier: "nearest"
"attack nexus" → targetType: "nexus"
"retreat" → targetType: "retreat"

STRATEGIC:
"get started" → [attack_camp gnome nearest, seek_resource carrot, deliver nearest_gnome_camp], loopFrom: 0

═══ loopFrom RULES ═══
- loopFrom: 0 → ALL steps loop (default, use for gather/bootstrap/defend/hunt)
- loopFrom: 1+ → steps before loopFrom run ONCE, steps from loopFrom onward loop forever
- equip steps are ALWAYS one-shot → loopFrom >= 1 whenever workflow starts with equip
- CRITICAL: attack_camp + deliver to a CAMP (nearest_X_camp) → loopFrom: 0 ALWAYS. The attack_camp step is a safeguard that re-checks camp ownership each cycle. Without it, units break if the camp is lost.
- attack_camp + deliver to BASE (not a camp) → loopFrom: 1 is OK (camp loss doesn't matter for base delivery)
- "then"/"after that" in player speech = phase boundary, BUT still respect the camp safeguard rule above
- When in doubt, use loopFrom: 0 (safe default, everything loops)

═══ VOICE RECOGNITION CONTINGENCY ═══
Input comes from speech-to-text which often mishears names. Always match the INTENDED word:
  UNIT NAMES:
  - "hyena" may appear as: "hyenna", "hi ena", "hyna", "hiena", "high ena", "hire na" → all mean HYENA
  - "gnome" may appear as: "nome", "home", "no me", "gnome" → all mean GNOME
  - "minotaur" may appear as: "minor tour", "minator", "minotour", "minute or" → all mean MINOTAUR
  - "shaman" may appear as: "showman", "shaman", "shayman", "sherman", "shaman" → all mean SHAMAN
  - "rogue" may appear as: "robe", "road", "row", "rog" → all mean ROGUE
  - "skull" may appear as: "school", "scull" → all mean SKULL
  - "spider" may appear as: "spyder", "spiders" → all mean SPIDER
  EQUIPMENT NAMES:
  - "pickaxe" may appear as: "pick axe", "pick acts", "pickets", "pic axe" → all mean PICKAXE
  - "banner" may appear as: "batter", "manner", "banter" → all mean BANNER
  - "shield" may appear as: "she'll", "yield" → all mean SHIELD
  ALWAYS interpret the closest matching unit/equipment name — never treat a mishearing as an unknown command.

═══ STRATEGIC REASONING ═══
Before choosing, think step by step:
1. MODIFIERS: Does the tone imply formation/caution/pacing? Set them alongside the action.
2. INTENT: What's the primary goal? (produce unit, equip+action, gather, fight, defend, unlock?)
3. EQUIPMENT: Does the command mention equipment? "get a sword" ≠ "get skulls". Equipment names: pickaxe, sword, shield, boots, banner. Animal names: gnome, turtle, skull, spider, hyena, panda, lizard, minotaur, shaman, troll, rogue.
4. DISAMBIGUATION: "get [equipment]" → equip workflow. "get [animal]" → bootstrap workflow. "mine" → always include equip pickaxe.
5. RESOURCE: carrots→T1, meat→T2-T3, crystals→T4-T5. Meat/crystals need "hunt" before "seek_resource".
6. SAFETY: If "safely/safe/careful" appears → use "collect" (avoids enemies) instead of "seek_resource", AND set caution:"safe".
7. LOOPFROM: Is there a one-shot setup phase (equip, capture)? Set loopFrom after it. Otherwise loopFrom: 0.
8. MINE commands ALWAYS start with equip pickaxe (can't mine without one).

═══ YOUR JOB ═══
Interpret the player's voice command using your deep understanding of the economy and unit traits.
- "get X" / "make X" / "take X" / "produce X" / "create X" / "train X" / "spawn X" → ALWAYS bootstrap X (attack_camp + resource gathering + deliver)
- "bootstrap X" → same as above
- "get started" → bootstrap gnomes (cheapest start)
- Be creative — combine steps based on what makes strategic sense
- If you can tell which unit type is selected, tailor the workflow to their strengths

GENRE TRANSLATION — Players may use words from other game genres. Translate the INTENT:
- shoot/fire/blast → attack_enemies or attack_camp
- loot/collect → seek_resource workflow
- sprint/rush/dash → rush pacing modifier + nearest_camp or forward action
- heal/rest → retreat to base
- block/shield → defend
- cast/spell → unrecognized (no magic system)
- build/construct/place → unrecognized (no building system), BUT "build an army" = bootstrap gnomes (cheapest start)
- jump/crouch/reload/aim/scope → unrecognized (no FPS mechanics)

EMOTIONAL & URGENT — Players shout in the heat of battle. Interpret the INTENT behind the emotion:
- "oh no run!" / "run away!" / "flee!" → retreat to base, pacing:"rush"
- "help!" / "we're dying!" → defend base OR retreat (either is valid)
- "yes attack!" / "charge!" / "let's go!" → attack_enemies, caution:"aggressive"
- "go go go!" / "move move move!" → pacing:"rush" + forward action (attack_enemies or nearest_camp)
- "no no no come back!" / "stop!" / "come back!" → retreat to base
- Exclamation marks and repeated words indicate urgency → prefer pacing:"rush"

NOISE & GIBBERISH — If the input is nonsensical words with no game meaning (e.g. "blorp fizzle wompus", "the", "asdf"):
- Return responseType:"unrecognized" — do NOT guess a random action
- Single common words like "the", "a", "is" with no command intent → unrecognized

STATUS QUERIES — If the player asks about their status ("how am I doing?", "what should I do?", "how many units?"):
- Return targetType "query" with a statusReport containing a 1-2 sentence tactical answer using the game context above
- DO NOT force a movement action for questions

AVOIDANCE & PATHING — Players may give negative commands or route instructions:
- "don't go there" / "stay away from X" / "avoid the skull camp" → set caution:"safe" and redirect units elsewhere. If a specific camp/area is mentioned, pick a different target (e.g. nearest camp that ISN'T the avoided one).
- "go around" / "take the long way" / "flank" → use multiple "move" steps in the workflow to create waypoints that route around obstacles or enemy positions. Use map coordinates to plot an indirect path.
- "don't attack" / "stop fighting" / "pull back" → retreat to base with caution:"safe"
- "go left/right/up/down" → move step RELATIVE to hoard center (offset ~600). See SPATIAL REFERENCE above.
- "go far left" / "all the way right" → move to map edge in that direction.
- "not that way" / "wrong way" / "come back" → retreat to base
- When routing around an area, use 2-3 move steps as waypoints from hoard center around the target before the final destination.

RULES:
- Output exactly ONE command (hoard selection is handled separately by hotkeys).
- Pick the BEST game interpretation if one exists. If there is genuinely NO game action (e.g. "pause", "save game", "open menu", "what's the weather"), return responseType "unrecognized".
- Match camp names by partial word.

PLAYER SAYS: "${rawText}"

JSON ONLY (no markdown):
{
  "targetType": "<camp|nearest_camp|sweep_camps|nexus|base|defend|retreat|workflow|query|advanced_plan>",
  "responseType": "<action|unrecognized|status_query|acknowledgment>",
  "statusReport": "<1-2 sentence tactical answer, only if responseType=status_query>",
  "targetAnimal": "<animal type or omit>",
  "campIndex": <index or -1>,
  "qualifier": "<nearest|furthest|weakest|uncaptured|enemy or omit>",
  "workflow": [<array of step objects, only if targetType=workflow>],
  "loopFrom": <index where repeating loop starts, default 0>,
  "narration": "<Max 5 words, terse military tone>",
  "unitReaction": "<2-5 word in-character grunt reaction from the units, funny/cute personality. Examples: 'Aye aye!', 'SMASH TIME!', 'ooh shiny rocks!', 'hisssss yesss', '*rattles excitedly*', 'me hungry...', 'FOR GLORY!'>",
  "modifiers": {"formation": "spread|tight|null", "caution": "safe|aggressive|null", "pacing": "rush|efficient|null"},
  "planGoal": {"type": "unlock_equipment|stockpile_resource", "equipment": "<equipment id, only if type=unlock_equipment>", "resource": "<resource type, only if type=stockpile_resource>", "amount": "<number, only if stockpile_resource>", "thenAction": "<optional follow-up: defend, attack, etc>"},
  "modifierOnly": false
}`;
}

// ─── Call Gemini ──────────────────────────────────────────────
async function callGemini(prompt) {
  const body = JSON.stringify({
    contents: [{ parts: [{ text: prompt }] }],
    generationConfig: {
      maxOutputTokens: 2048,
      responseMimeType: 'application/json',
      thinkingConfig: { thinkingBudget: 0 },
    },
  });

  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      const response = await fetch(GEMINI_URL + GEMINI_API_KEY, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body,
      });

      if (response.status === 429) {
        const wait = 1000 * Math.pow(2, attempt);
        console.warn(`  [429] Rate limited, retrying in ${wait}ms (attempt ${attempt + 1}/${MAX_RETRIES})`);
        await new Promise(r => setTimeout(r, wait));
        continue;
      }

      if (!response.ok) {
        const errText = await response.text().catch(() => '');
        console.warn(`  [${response.status}] API error: ${errText.slice(0, 200)}`);
        return null;
      }

      const data = await response.json();
      const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
      if (!text) return null;

      const parsed = JSON.parse(text);
      return Array.isArray(parsed) ? parsed[0] : parsed;
    } catch (err) {
      console.warn(`  [ERR] ${err.message}`);
      if (attempt < MAX_RETRIES - 1) {
        await new Promise(r => setTimeout(r, 1000 * Math.pow(2, attempt)));
      }
    }
  }
  return null;
}

// ═══════════════════════════════════════════════════════════════
// Section 6: 20 Deterministic resolvePlan Tests
// ═══════════════════════════════════════════════════════════════

const DETERMINISTIC_TESTS = [
  // D1: unlock pickaxe from fresh — gather 15 carrots + unlock
  {
    id: 'D1', desc: 'unlock pickaxe, fresh start',
    goal: { type: 'unlock_equipment', equipment: 'pickaxe' },
    stock: {carrot:0, meat:0, crystal:0, metal:0}, equip: {},
    expectedPhases: 2,
    expectedChecks: ['resource_threshold', 'equipment_unlocked'],
    expectedEquipTargets: [null, {type:'pickaxe', level:1}],
  },
  // D2: unlock pickaxe when already have 20 carrots — instant
  {
    id: 'D2', desc: 'unlock pickaxe, already have carrots',
    goal: { type: 'unlock_equipment', equipment: 'pickaxe' },
    stock: {carrot:20, meat:0, crystal:0, metal:0}, equip: {},
    expectedPhases: 1,
    expectedChecks: ['equipment_unlocked'],
    expectedEquipTargets: [{type:'pickaxe', level:1}],
  },
  // D3: unlock sword from fresh — full prereq chain (5 phases)
  {
    id: 'D3', desc: 'unlock sword, fresh start',
    goal: { type: 'unlock_equipment', equipment: 'sword' },
    stock: {carrot:0, meat:0, crystal:0, metal:0}, equip: {},
    expectedPhases: 5,
    expectedChecks: ['resource_threshold', 'equipment_unlocked', 'resource_threshold', 'resource_threshold', 'equipment_unlocked'],
    expectedEquipTargets: [null, {type:'pickaxe', level:1}, null, null, {type:'sword', level:1}],
  },
  // D4: unlock sword with pickaxe + plenty of resources — instant
  {
    id: 'D4', desc: 'unlock sword, have pickaxe + resources',
    goal: { type: 'unlock_equipment', equipment: 'sword' },
    stock: {carrot:0, meat:20, crystal:0, metal:10}, equip: {pickaxe:1},
    expectedPhases: 1,
    expectedChecks: ['equipment_unlocked'],
    expectedEquipTargets: [{type:'sword', level:1}],
  },
  // D5: unlock sword with pickaxe, partial resources
  {
    id: 'D5', desc: 'unlock sword, pickaxe, partial resources',
    goal: { type: 'unlock_equipment', equipment: 'sword' },
    stock: {carrot:0, meat:8, crystal:0, metal:2}, equip: {pickaxe:1},
    expectedPhases: 3,
    expectedChecks: ['resource_threshold', 'resource_threshold', 'equipment_unlocked'],
    expectedEquipTargets: [null, null, {type:'sword', level:1}],
  },
  // D6: unlock shield from fresh — same chain as sword
  {
    id: 'D6', desc: 'unlock shield, fresh start',
    goal: { type: 'unlock_equipment', equipment: 'shield' },
    stock: {carrot:0, meat:0, crystal:0, metal:0}, equip: {},
    expectedPhases: 5,
    expectedChecks: ['resource_threshold', 'equipment_unlocked', 'resource_threshold', 'resource_threshold', 'equipment_unlocked'],
    expectedEquipTargets: [null, {type:'pickaxe', level:1}, null, null, {type:'shield', level:1}],
  },
  // D7: unlock shield with exact resources + pickaxe
  {
    id: 'D7', desc: 'unlock shield, exact resources',
    goal: { type: 'unlock_equipment', equipment: 'shield' },
    stock: {carrot:0, meat:15, crystal:0, metal:5}, equip: {pickaxe:1},
    expectedPhases: 1,
    expectedChecks: ['equipment_unlocked'],
    expectedEquipTargets: [{type:'shield', level:1}],
  },
  // D8: unlock boots from fresh — projected stock bug test!
  // Need pickaxe (15c) first, then boots (12c+4g). After pickaxe unlock, carrots deplete to 0.
  // So boots needs: gather carrots to 12, mine metal to 4, unlock boots.
  // Full chain: gather 15c, unlock pickaxe, gather 12c, mine 4g, unlock boots = 5 phases
  {
    id: 'D8', desc: 'unlock boots, fresh (projected stock bug test)',
    goal: { type: 'unlock_equipment', equipment: 'boots' },
    stock: {carrot:0, meat:0, crystal:0, metal:0}, equip: {},
    expectedPhases: 5,
    expectedChecks: ['resource_threshold', 'equipment_unlocked', 'resource_threshold', 'resource_threshold', 'equipment_unlocked'],
    expectedEquipTargets: [null, {type:'pickaxe', level:1}, null, null, {type:'boots', level:1}],
  },
  // D9: unlock banner with pickaxe, 5 meat, 0 metal
  {
    id: 'D9', desc: 'unlock banner, pickaxe, partial resources',
    goal: { type: 'unlock_equipment', equipment: 'banner' },
    stock: {carrot:0, meat:5, crystal:0, metal:0}, equip: {pickaxe:1},
    expectedPhases: 3,
    expectedChecks: ['resource_threshold', 'resource_threshold', 'equipment_unlocked'],
    expectedEquipTargets: [null, null, {type:'banner', level:1}],
  },
  // D10: unlock banner with pickaxe + enough resources
  {
    id: 'D10', desc: 'unlock banner, have all resources',
    goal: { type: 'unlock_equipment', equipment: 'banner' },
    stock: {carrot:0, meat:20, crystal:0, metal:8}, equip: {pickaxe:1},
    expectedPhases: 1,
    expectedChecks: ['equipment_unlocked'],
    expectedEquipTargets: [{type:'banner', level:1}],
  },
  // D11: upgrade pickaxe to L2 — cost = 15*2 = 30 carrots
  {
    id: 'D11', desc: 'upgrade pickaxe L2, have 5 carrots',
    goal: { type: 'unlock_equipment', equipment: 'pickaxe' },
    stock: {carrot:5, meat:0, crystal:0, metal:0}, equip: {pickaxe:1},
    expectedPhases: 2,
    expectedChecks: ['resource_threshold', 'equipment_unlocked'],
    expectedEquipTargets: [null, {type:'pickaxe', level:2}],
  },
  // D12: upgrade sword L2 — cost = 15*2=30 meat, 5*2=10 metal
  {
    id: 'D12', desc: 'upgrade sword L2, partial resources',
    goal: { type: 'unlock_equipment', equipment: 'sword' },
    stock: {carrot:0, meat:10, crystal:0, metal:3}, equip: {pickaxe:1, sword:1},
    expectedPhases: 3,
    expectedChecks: ['resource_threshold', 'resource_threshold', 'equipment_unlocked'],
    expectedEquipTargets: [null, null, {type:'sword', level:2}],
  },
  // D13: unlock pickaxe when already at max level — null
  {
    id: 'D13', desc: 'unlock pickaxe, already max level',
    goal: { type: 'unlock_equipment', equipment: 'pickaxe' },
    stock: {carrot:20, meat:0, crystal:0, metal:0}, equip: {pickaxe:3},
    expectedPhases: null, // expect null result
  },
  // D14: stockpile metal from fresh — needs pickaxe first
  {
    id: 'D14', desc: 'stockpile metal, fresh start',
    goal: { type: 'stockpile_resource', resource: 'metal' },
    stock: {carrot:0, meat:0, crystal:0, metal:0}, equip: {},
    expectedPhases: 3,
    expectedChecks: ['resource_threshold', 'equipment_unlocked', 'final'],
  },
  // D15: stockpile metal with pickaxe — just the mine loop
  {
    id: 'D15', desc: 'stockpile metal, have pickaxe',
    goal: { type: 'stockpile_resource', resource: 'metal' },
    stock: {carrot:5, meat:5, crystal:0, metal:0}, equip: {pickaxe:1},
    expectedPhases: 1,
    expectedChecks: ['final'],
  },
  // D16: stockpile carrot — just gather loop
  {
    id: 'D16', desc: 'stockpile carrot',
    goal: { type: 'stockpile_resource', resource: 'carrot' },
    stock: {carrot:0, meat:0, crystal:0, metal:0}, equip: {},
    expectedPhases: 1,
    expectedChecks: ['final'],
  },
  // D17: stockpile crystal — no equipment prereqs
  {
    id: 'D17', desc: 'stockpile crystal',
    goal: { type: 'stockpile_resource', resource: 'crystal' },
    stock: {carrot:0, meat:0, crystal:0, metal:0}, equip: {},
    expectedPhases: 1,
    expectedChecks: ['final'],
  },
  // D18: unlock sword + thenAction "defend", already affordable
  {
    id: 'D18', desc: 'unlock sword + thenAction defend, instant',
    goal: { type: 'unlock_equipment', equipment: 'sword', thenAction: 'defend' },
    stock: {carrot:0, meat:20, crystal:0, metal:10}, equip: {pickaxe:1},
    expectedPhases: 2,
    expectedChecks: ['equipment_unlocked', 'final'],
  },
  // D19: unlock shield + thenAction "attack", fresh start (6 phases)
  {
    id: 'D19', desc: 'unlock shield + thenAction attack, fresh',
    goal: { type: 'unlock_equipment', equipment: 'shield', thenAction: 'attack' },
    stock: {carrot:0, meat:0, crystal:0, metal:0}, equip: {},
    expectedPhases: 6,
    expectedChecks: ['resource_threshold', 'equipment_unlocked', 'resource_threshold', 'resource_threshold', 'equipment_unlocked', 'final'],
  },
  // D20: unlock boots with exact resources + pickaxe — instant
  {
    id: 'D20', desc: 'unlock boots, exact resources + pickaxe',
    goal: { type: 'unlock_equipment', equipment: 'boots' },
    stock: {carrot:12, meat:0, crystal:0, metal:4}, equip: {pickaxe:1},
    expectedPhases: 1,
    expectedChecks: ['equipment_unlocked'],
    expectedEquipTargets: [{type:'boots', level:1}],
  },
];

// ═══════════════════════════════════════════════════════════════
// Section 7: 30 Gemini Classification Tests
// ═══════════════════════════════════════════════════════════════

const GEMINI_TESTS = [
  // Category A: Should be advanced_plan (15 tests)
  { id: 'G1',  input: 'unlock swords', shouldBePlan: true, expectedEquipment: 'sword', category: 'A' },
  { id: 'G2',  input: 'get me shields', shouldBePlan: true, expectedEquipment: 'shield', category: 'A' },
  { id: 'G3',  input: 'I want a pickaxe', shouldBePlan: true, expectedEquipment: 'pickaxe', category: 'A' },
  { id: 'G4',  input: 'upgrade boots', shouldBePlan: true, expectedEquipment: 'boots', category: 'A',
    ctxOverride: { equipment: {pickaxe:1, boots:1} } },
  { id: 'G5',  input: 'research banners', shouldBePlan: true, expectedEquipment: 'banner', category: 'A' },
  { id: 'G6',  input: 'get shields and defend', shouldBePlan: true, expectedEquipment: 'shield', expectThenAction: /defend/i, category: 'A' },
  { id: 'G7',  input: 'unlock swords and attack', shouldBePlan: true, expectedEquipment: 'sword', expectThenAction: /attack/i, category: 'A' },
  { id: 'G8',  input: 'work on getting boots', shouldBePlan: true, expectedEquipment: 'boots', category: 'A' },
  { id: 'G9',  input: 'I need better swords', shouldBePlan: true, expectedEquipment: 'sword', category: 'A',
    ctxOverride: { equipment: {pickaxe:1, sword:1} } },
  { id: 'G10', input: 'get the shield upgrade', shouldBePlan: true, expectedEquipment: 'shield', category: 'A' },
  { id: 'G11', input: 'stockpile metal', shouldBePlan: true, expectedResource: 'metal', category: 'A' },
  { id: 'G12', input: 'I need metal', shouldBePlan: true, expectedResource: 'metal', category: 'A' },
  { id: 'G13', input: "let's get pickaxes going", shouldBePlan: true, expectedEquipment: 'pickaxe', category: 'A' },
  { id: 'G14', input: 'unlock pick axe', shouldBePlan: true, expectedEquipment: 'pickaxe', category: 'A' },
  { id: 'G15', input: 'we need shields for defense', shouldBePlan: true, expectedEquipment: 'shield', category: 'A' },

  // Category B: Should NOT be advanced_plan (15 tests)
  { id: 'G16', input: 'equip swords', shouldBePlan: false, expectedType: 'workflow', category: 'B',
    ctxOverride: { equipment: {pickaxe:1, sword:1} } },
  { id: 'G17', input: 'get skulls', shouldBePlan: false, expectedType: 'workflow', category: 'B' },
  { id: 'G18', input: 'make gnomes', shouldBePlan: false, expectedType: 'workflow', category: 'B' },
  { id: 'G19', input: 'get swords and fight', shouldBePlan: false, expectedType: 'workflow', category: 'B',
    ctxOverride: { equipment: {pickaxe:1, sword:1} } },
  { id: 'G20', input: 'gather carrots', shouldBePlan: false, expectedType: 'workflow', category: 'B' },
  { id: 'G21', input: 'defend base', shouldBePlan: false, category: 'B' },
  { id: 'G22', input: 'mine metal', shouldBePlan: false, expectedType: 'workflow', category: 'B',
    ctxOverride: { equipment: {pickaxe:1} } },
  { id: 'G23', input: 'attack nearest camp', shouldBePlan: false, expectedType: 'nearest_camp', category: 'B' },
  { id: 'G24', input: 'get a pickaxe and mine', shouldBePlan: false, expectedType: 'workflow', category: 'B',
    ctxOverride: { equipment: {pickaxe:1} } },
  { id: 'G25', input: 'retreat', shouldBePlan: false, expectedType: 'retreat', category: 'B' },
  { id: 'G26', input: 'get turtles', shouldBePlan: false, expectedType: 'workflow', category: 'B' },
  { id: 'G27', input: 'grab a sword and attack', shouldBePlan: false, expectedType: 'workflow', category: 'B',
    ctxOverride: { equipment: {pickaxe:1, sword:1} } },
  { id: 'G28', input: 'farm meat', shouldBePlan: false, expectedType: 'workflow', category: 'B' },
  { id: 'G29', input: 'go to the skull camp', shouldBePlan: false, category: 'B' },
  { id: 'G30', input: 'stockpile carrots', shouldBePlan: false, expectedType: 'workflow', category: 'B' },
];

// ═══════════════════════════════════════════════════════════════
// Section 8: Grading Functions
// ═══════════════════════════════════════════════════════════════

function gradeResolvePlan(tc, result) {
  // Null expected
  if (tc.expectedPhases === null) {
    return result === null ? 'PASS' : 'FAIL';
  }
  if (result === null) return 'FAIL';

  const phases = result.phases;
  if (phases.length !== tc.expectedPhases) {
    return 'FAIL';
  }

  // Check completionChecks
  if (tc.expectedChecks) {
    for (let i = 0; i < tc.expectedChecks.length; i++) {
      if (phases[i]?.completionCheck !== tc.expectedChecks[i]) return 'FAIL';
    }
  }

  // Check equipTargets
  if (tc.expectedEquipTargets) {
    for (let i = 0; i < tc.expectedEquipTargets.length; i++) {
      const expected = tc.expectedEquipTargets[i];
      const actual = phases[i]?.equipTarget;
      if (expected === null) {
        // Should not have equipTarget (it's a gather phase)
        continue;
      }
      if (!actual) return 'FAIL';
      if (actual.type !== expected.type || actual.level !== expected.level) return 'FAIL';
    }
  }

  return 'PASS';
}

function gradeGeminiResult(tc, cmd) {
  if (!cmd) return 'FAIL';

  if (tc.shouldBePlan) {
    // Should be advanced_plan
    if (cmd.targetType !== 'advanced_plan') return 'FAIL';

    if (tc.expectedEquipment) {
      if (!cmd.planGoal) return 'FAIL';
      if (cmd.planGoal.type !== 'unlock_equipment') return 'FAIL';
      if (cmd.planGoal.equipment !== tc.expectedEquipment) return 'WARN';
    }

    if (tc.expectedResource) {
      if (!cmd.planGoal) return 'FAIL';
      if (cmd.planGoal.type !== 'stockpile_resource') return 'FAIL';
      if (cmd.planGoal.resource !== tc.expectedResource) return 'WARN';
    }

    if (tc.expectThenAction) {
      if (!cmd.planGoal?.thenAction) return 'WARN';
      if (!tc.expectThenAction.test(cmd.planGoal.thenAction)) return 'WARN';
    }

    return 'PASS';
  } else {
    // Should NOT be advanced_plan
    if (cmd.targetType === 'advanced_plan') return 'FAIL';

    if (tc.expectedType) {
      if (cmd.targetType === tc.expectedType) return 'PASS';
      // Some acceptable alternatives
      if (tc.expectedType === 'workflow' && (cmd.targetType === 'defend' || cmd.targetType === 'base')) return 'PASS';
      if (tc.expectedType === 'retreat' && cmd.targetType === 'base') return 'PASS';
      if (tc.expectedType === 'nearest_camp' && cmd.targetType === 'camp') return 'PASS';
      return 'WARN';
    }

    // No specific expected type — just not advanced_plan
    return 'PASS';
  }
}

// ═══════════════════════════════════════════════════════════════
// Section 9: Main Runner
// ═══════════════════════════════════════════════════════════════

async function main() {
  console.log(`\n# Advanced Plans Test Results`);
  console.log(`Date: ${new Date().toISOString().slice(0, 10)} | Model: ${GEMINI_MODEL} | Tests: ${DETERMINISTIC_TESTS.length + GEMINI_TESTS.length}\n`);

  // ─── Phase 1: Deterministic resolvePlan tests ───
  console.log(`## Phase 1: Deterministic resolvePlan Tests (${DETERMINISTIC_TESTS.length})\n`);

  let dPass = 0, dWarn = 0, dFail = 0;
  const dResults = [];

  for (const tc of DETERMINISTIC_TESTS) {
    const result = resolvePlan(tc.goal, tc.stock, tc.equip, 'test');
    const grade = gradeResolvePlan(tc, result);

    if (grade === 'PASS') dPass++;
    else if (grade === 'WARN') dWarn++;
    else dFail++;

    const phaseCount = result ? result.phases.length : 'null';
    const phaseLabels = result ? result.phases.map(p => p.label).join(' → ') : 'null';
    dResults.push({ ...tc, result, grade, phaseCount, phaseLabels });

    const icon = grade === 'PASS' ? 'PASS' : grade === 'WARN' ? 'WARN' : 'FAIL';
    console.log(`  [${tc.id}] ${tc.desc} — ${phaseCount} phases — ${icon}`);
  }

  // Print deterministic table
  console.log(`\n| # | Description | Expected Phases | Actual Phases | Phase Chain | Grade |`);
  console.log(`|---|-------------|:-:|:-:|-------------|-------|`);
  for (const r of dResults) {
    const desc = r.desc.length > 40 ? r.desc.slice(0, 37) + '...' : r.desc;
    const chain = r.phaseLabels.length > 60 ? r.phaseLabels.slice(0, 57) + '...' : r.phaseLabels;
    const expected = r.expectedPhases === null ? 'null' : r.expectedPhases;
    console.log(`| ${r.id} | ${desc} | ${expected} | ${r.phaseCount} | ${chain} | ${r.grade} |`);
  }

  console.log(`\nDeterministic: ${dPass}/${DETERMINISTIC_TESTS.length} PASS, ${dWarn} WARN, ${dFail} FAIL\n`);

  // ─── Phase 2: Gemini classification tests ───
  console.log(`## Phase 2: Gemini Classification Tests (${GEMINI_TESTS.length})\n`);

  let gPass = 0, gWarn = 0, gFail = 0;
  const gResults = [];

  for (const tc of GEMINI_TESTS) {
    process.stdout.write(`  [${tc.id}] "${tc.input}" ...`);

    // Build context with overrides
    const ctx = { ...MOCK_CTX };
    if (tc.ctxOverride) {
      ctx.resources = { ...MOCK_CTX.resources };
      if (tc.ctxOverride.equipment) {
        ctx.equipment = tc.ctxOverride.equipment;
      }
    }

    const prompt = buildPrompt(tc.input, ctx);
    const cmd = await callGemini(prompt);
    const grade = gradeGeminiResult(tc, cmd);

    if (grade === 'PASS') gPass++;
    else if (grade === 'WARN') gWarn++;
    else gFail++;

    const summary = cmd ? `tT=${cmd.targetType}${cmd.planGoal ? ` planGoal=${JSON.stringify(cmd.planGoal)}` : ''}` : '(null)';
    gResults.push({ ...tc, cmd, grade, summary });
    console.log(` ${grade}`);

    // Delay between API calls
    await new Promise(r => setTimeout(r, 200));
  }

  // Print Gemini table
  console.log(`\n| # | Input | Cat | Should Plan? | Actual targetType | planGoal | Grade |`);
  console.log(`|---|-------|-----|:---:|-------------------|----------|-------|`);
  for (const r of gResults) {
    const input = r.input.length > 25 ? r.input.slice(0, 22) + '...' : r.input;
    const actualTT = r.cmd ? r.cmd.targetType : '(null)';
    const planGoal = r.cmd?.planGoal ? JSON.stringify(r.cmd.planGoal).slice(0, 50) : '-';
    console.log(`| ${r.id} | ${input} | ${r.category} | ${r.shouldBePlan ? 'YES' : 'NO'} | ${actualTT} | ${planGoal} | ${r.grade} |`);
  }

  console.log(`\nGemini: ${gPass}/${GEMINI_TESTS.length} PASS, ${gWarn} WARN, ${gFail} FAIL\n`);

  // ─── Overall Summary ───
  const totalPass = dPass + gPass;
  const totalWarn = dWarn + gWarn;
  const totalFail = dFail + gFail;
  const total = DETERMINISTIC_TESTS.length + GEMINI_TESTS.length;

  console.log(`## Overall Summary`);
  console.log(`- PASS: ${totalPass}/${total} (${Math.round(totalPass / total * 100)}%)`);
  console.log(`- WARN: ${totalWarn}/${total} (${Math.round(totalWarn / total * 100)}%)`);
  console.log(`- FAIL: ${totalFail}/${total} (${Math.round(totalFail / total * 100)}%)`);

  // Print failures detail
  const allResults = [...dResults, ...gResults];
  const failures = allResults.filter(r => r.grade === 'FAIL');
  if (failures.length > 0) {
    console.log(`\n## Failures Detail`);
    for (const f of failures) {
      console.log(`\n### ${f.id}: ${f.desc || `"${f.input}"`}`);
      if (f.expectedPhases !== undefined) {
        // Deterministic test
        console.log(`Expected phases: ${f.expectedPhases === null ? 'null' : f.expectedPhases}`);
        console.log(`Actual phases: ${f.phaseCount}`);
        if (f.result) {
          console.log(`Phase labels: ${f.phaseLabels}`);
          console.log(`Phase details:`);
          for (const p of f.result.phases) {
            console.log(`  - ${p.label} [${p.completionCheck}]${p.resourceTarget ? ` res=${JSON.stringify(p.resourceTarget)}` : ''}${p.equipTarget ? ` equip=${JSON.stringify(p.equipTarget)}` : ''}`);
          }
        }
      } else {
        // Gemini test
        console.log(`Should be plan: ${f.shouldBePlan}`);
        console.log(`Got: ${f.summary}`);
        if (f.cmd) console.log(`Raw: ${JSON.stringify(f.cmd, null, 2)}`);
      }
    }
  }

  // Print warnings detail
  const warnings = allResults.filter(r => r.grade === 'WARN');
  if (warnings.length > 0) {
    console.log(`\n## Warnings Detail`);
    for (const w of warnings) {
      if (w.desc) {
        console.log(`  ${w.id}: ${w.desc} — ${w.phaseLabels || ''}`);
      } else {
        console.log(`  ${w.id}: "${w.input}" — ${w.summary}`);
      }
    }
  }

  console.log(`\n---`);
  console.log(`Done. ${totalPass >= 45 ? 'Target met (>=45/50 PASS).' : 'Below target (<45/50 PASS) — review failures.'}`);
}

main().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});
