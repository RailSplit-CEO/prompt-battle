import Phaser from 'phaser';
import { FirebaseSync } from '../network/FirebaseSync';
import { HORDE_SPRITE_CONFIGS } from '../sprites/SpriteConfig';
import { MapDef, MapCampSlot, MapZoneDef, MapTowerSlot, MapBushZone, MapRockDef, MapBoundaryBlock, assignAnimalsToSlots, getMapById, ALL_MAPS, TILE_SIZE, EquipmentType as SharedEquipmentType } from '@prompt-battle/shared';
import { resolveGrid, ResolvedTile } from '../map/AutoTileResolver';
import { getTileSourceRect, getCliffSourceRect, WATER_COLOR_HEX, getTilesetFilename } from '../map/TilesetAtlas';
import { SoundManager } from '../audio/SoundManager';
import { buildSpatialGrid, getNearbyFromGrid, SPATIAL_KEY_STRIDE } from './horde-utils';
import { QuestManager, QState } from './QuestDefs';
import { ElevenLabsVoiceAgent } from '../systems/ElevenLabsVoiceAgent';
import type { GameContext as ELGameContext } from '../systems/ElevenLabsVoiceAgent';
import { MemoryOverlay } from '../profiling/MemoryOverlay';
import { ProfilingRecorder } from '../profiling/ProfilingRecorder';
import type { ProfilingData } from '../profiling/MemoryOverlay';
import { TtsService } from '../systems/TtsService';
import { ScribeService } from '../systems/ScribeService';
import { VoiceOrb } from '../systems/VoiceOrb';
import { TalkingPortrait } from '../systems/TalkingPortrait';
import bundledHordeMaps from '../map/maps/horde-maps.json';

// ═══════════════════════════════════════════════════════════════
// GEMINI INTEGRATION
// ═══════════════════════════════════════════════════════════════

const _GEMINI_ENV_KEY = (import.meta as any).env?.VITE_GEMINI_API_KEY || '';
const getGeminiKey = () => localStorage.getItem('pb_gemini_key') || _GEMINI_ENV_KEY;
const GEMINI_MODEL = 'gemini-3.1-flash-lite-preview';
const GEMINI_URL = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=`;
const GEMINI_MAX_RETRIES = 3;

interface GameContext {
  myUnits: { type: string; count: number; tier: number; gathering: number }[];
  camps: { name: string; animalType: string; tier: number; owner: string; index: number; x: number; y: number; dist: number; defenders: number; storedFood: number; spawnCost: number }[];
  nexusHp: { mine: number; enemy: number };
  resources: { carrot: number; meat: number; crystal: number; metal: number };
  groundCarrots: number;
  groundMeat: number;
  groundCrystals: number;
  gameTime: number;
  selectedHoard: string;
  hoardCenter: { x: number; y: number };
  carrotZones: { x: number; y: number; w: number; h: number }[];
  activeEvents?: { type: string; emoji: string; name: string; x: number; y: number; timeLeft: number; info: string; howToWin: string }[];
  activeBuffs?: { stat: string; amount: number; remaining: number }[];
}

// ─── Behavior Modifiers ──────────────────────────────────────
// Modify HOW units execute their workflow, not WHAT they do.
// Three independent, composable axes.
interface BehaviorMods {
  formation: 'normal' | 'spread' | 'tight';
  caution: 'normal' | 'safe' | 'aggressive';
  pacing: 'normal' | 'rush' | 'efficient';
}

const DEFAULT_MODS: BehaviorMods = { formation: 'normal', caution: 'normal', pacing: 'normal' };

interface HordeCommand {
  targetType: 'camp' | 'nearest_camp' | 'sweep_camps' | 'nexus' | 'base' | 'position' | 'defend' | 'retreat' | 'workflow' | 'query' | 'advanced_plan';
  targetAnimal?: string;
  campIndex?: number;
  qualifier?: 'nearest' | 'furthest' | 'weakest' | 'strongest' | 'uncaptured' | 'enemy';
  // LLM-defined workflow steps — the LLM decides the full loop
  workflow?: { action: string; resourceType?: string; target?: string; targetType?: string; campIndex?: number; qualifier?: string; targetAnimal?: string; x?: number; y?: number; equipmentType?: string }[];
  loopFrom?: number; // after end, loop back here (default 0 = loop everything)
  narration?: string;
  unitReaction?: string; // short in-character grunt/reaction for thought bubble (2-5 words)
  // Behavior modifiers — change how units execute, not what they do
  modifiers?: { formation?: string | null; caution?: string | null; pacing?: string | null };
  modifierOnly?: boolean; // true = only change modifiers, keep existing workflow
  responseType?: 'action' | 'unrecognized' | 'status_query' | 'acknowledgment';
  statusReport?: string;
  // Advanced plan goal — resolved client-side into multi-phase plan
  planGoal?: { type: string; equipment?: string; resource?: string; amount?: number; thenAction?: string };
}

let _lastGeminiCall = 0;
let _geminiCooldownMs = 4000; // starts at 4s, grows on 429
const GEMINI_BASE_COOLDOWN = 4000;
const GEMINI_MAX_COOLDOWN = 60000; // max 60s backoff

// ─── STT Pre-Correction ─────────────────────────────────────
// Fix common speech-to-text mishearings BEFORE sending to Gemini.
// Maps regex → replacement. Order matters (first match wins per token).
const STT_CORRECTIONS: [RegExp, string][] = [
  // Action verbs
  [/\bmoning\b/gi, 'mining'],
  [/\bmoning\b/gi, 'mining'],
  [/\bmon(?:e|ing)\b/gi, 'mining'],
  [/\bmind?\b/gi, 'mine'],
  [/\bmi(?:ne|ning)\s*(?:ing)?\b/gi, 'mining'], // "mine ing" → "mining"
  [/\bgathur\b/gi, 'gather'],
  [/\bgathiring\b/gi, 'gathering'],
  [/\battact\b/gi, 'attack'],
  [/\battck\b/gi, 'attack'],
  [/\bdefned\b/gi, 'defend'],
  [/\bretrete?\b/gi, 'retreat'],
  [/\bscowt\b/gi, 'scout'],
  // Unit names
  [/\bhi\s*ena\b/gi, 'hyena'],
  [/\bhyenn?a\b/gi, 'hyena'],
  [/\bhigh\s*ena\b/gi, 'hyena'],
  [/\bhyna\b/gi, 'hyena'],
  [/\bhire\s*na\b/gi, 'hyena'],
  [/\bn[o]me\b/gi, 'gnome'],
  [/\bhome(?=s?\b)/gi, 'gnome'], // "homes" → "gnomes" only at word boundary
  [/\bno\s*me\b/gi, 'gnome'],
  [/\bminor\s*tour\b/gi, 'minotaur'],
  [/\bmin[ao]t(?:ou?|oo)r\b/gi, 'minotaur'],
  [/\bminute\s*(?:or|er)\b/gi, 'minotaur'],
  [/\bshow\s*man\b/gi, 'shaman'],
  [/\bshay?\s*man\b/gi, 'shaman'],
  [/\bsherman\b/gi, 'shaman'],
  [/\brobe\b/gi, 'rogue'],
  [/\bro(?:ad|w|g)\b/gi, 'rogue'],
  [/\bschool\b/gi, 'skull'],
  [/\bscull\b/gi, 'skull'],
  [/\bspy?ders?\b/gi, 'spider'],
  // Equipment names
  [/\bpick\s*ax(?:e|es?)?\b/gi, 'pickaxe'],
  [/\bpic(?:k\s*)?acts?\b/gi, 'pickaxe'],
  [/\bpickets?\b/gi, 'pickaxe'],
  [/\bbatter\b/gi, 'banner'],
  [/\bbanter\b/gi, 'banner'],
  [/\bmanner\b/gi, 'banner'],
  [/\bshe(?:'ll|eld)\b/gi, 'shield'],
  [/\byield\b/gi, 'shield'],
  // Resources
  [/\bcarrits?\b/gi, 'carrot'],
  [/\bcarrets?\b/gi, 'carrot'],
  [/\bcristals?\b/gi, 'crystal'],
  [/\bchristals?\b/gi, 'crystal'],
  // Common game intent
  [/\bgo\s+mon(?:e|ing)\b/gi, 'go mining'],
  [/\bstart\s+mon(?:e|ing)\b/gi, 'start mining'],
];

function correctSTT(text: string): string {
  let corrected = text;
  for (const [pattern, replacement] of STT_CORRECTIONS) {
    corrected = corrected.replace(pattern, replacement);
  }
  if (corrected !== text) {
    console.log(`[STT] Corrected: "${text}" → "${corrected}"`);
  }
  return corrected;
}

// ─── Post-Gemini Workflow Validation ─────────────────────────
// Fix common Gemini mistakes and validate logical coherence.
function validateAndFixWorkflow(cmd: HordeCommand): HordeCommand {
  if (!cmd.workflow || cmd.workflow.length === 0) return cmd;

  const steps = cmd.workflow;
  const actions = steps.map(s => s.action);

  // Fix 1: mine without equip pickaxe → prepend equip pickaxe
  if (actions.includes('mine') && !actions.includes('equip')) {
    steps.unshift({ action: 'equip', equipmentType: 'pickaxe' });
    // Push loopFrom forward to account for inserted step
    if (cmd.loopFrom != null) cmd.loopFrom = Math.max(1, (cmd.loopFrom || 0) + 1);
    else cmd.loopFrom = 1;
    console.log('[Validate] Added missing equip pickaxe before mine');
  }

  // Fix 2: mine without deliver → append deliver base
  if (actions.includes('mine') && !actions.includes('deliver')) {
    steps.push({ action: 'deliver', target: 'base' });
    console.log('[Validate] Added missing deliver base after mine');
  }

  // Fix 3: seek_resource/collect without deliver → append deliver base
  const hasGather = actions.includes('seek_resource') || actions.includes('collect');
  if (hasGather && !actions.includes('deliver') && !actions.includes('attack_camp')) {
    steps.push({ action: 'deliver', target: 'base' });
    console.log('[Validate] Added missing deliver base after gather');
  }

  // Fix 4: deliver to camp without attack_camp → prepend attack_camp
  for (const s of steps) {
    if (s.action === 'deliver' && s.target && s.target.includes('_camp') && !actions.includes('attack_camp')) {
      const m = s.target.match(/^nearest_(\w+)_camp$/);
      if (m) {
        steps.unshift({ action: 'attack_camp', targetAnimal: m[1], qualifier: 'nearest' });
        if (cmd.loopFrom != null && cmd.loopFrom > 0) cmd.loopFrom++;
        console.log(`[Validate] Added missing attack_camp for ${m[1]}`);
      }
      break;
    }
  }

  // Fix 5: hunt for meat/crystal producers without seek_resource after → append seek + deliver
  const hasHunt = actions.includes('hunt') || actions.includes('kill_only');
  if (hasHunt && !hasGather && !actions.includes('deliver') && !actions.includes('attack_enemies')) {
    // hunt-only is intentional (kill_only), but hunt without pickup is usually a mistake
    if (actions.includes('hunt') && !actions.includes('kill_only')) {
      steps.push({ action: 'seek_resource', resourceType: 'meat' });
      steps.push({ action: 'deliver', target: 'base' });
      console.log('[Validate] Added seek_resource meat + deliver after hunt');
    }
  }

  // Fix 6: equip step with loopFrom 0 → should be loopFrom 1+
  if (steps.length > 0 && steps[0].action === 'equip' && (cmd.loopFrom == null || cmd.loopFrom === 0)) {
    cmd.loopFrom = 1;
    console.log('[Validate] Fixed loopFrom for equip one-shot');
  }

  // Fix 6b: normalize loopFrom — null/-1/undefined → 0
  if (cmd.loopFrom == null || cmd.loopFrom < 0) {
    cmd.loopFrom = 0;
  }
  // Clamp loopFrom to valid range
  if (cmd.loopFrom >= steps.length) {
    cmd.loopFrom = Math.max(0, steps.length - 1);
  }

  // Fix 9: caution=safe → convert seek_resource to collect (auto-pickup near base)
  if (cmd.modifiers?.caution === 'safe') {
    for (let i = 0; i < steps.length; i++) {
      if (steps[i].action === 'seek_resource') {
        steps[i] = { ...steps[i], action: 'collect' };
        console.log(`[Validate] caution=safe: seek_resource → collect at step ${i}`);
      }
    }
    // In safe collect mode, remove separate deliver steps (collect auto-delivers)
    for (let i = steps.length - 1; i >= 0; i--) {
      if (steps[i].action === 'deliver') {
        steps.splice(i, 1);
        console.log('[Validate] caution=safe: removed deliver (collect handles it)');
      }
    }
  }

  // Fix 10: lone attack_camp → full bootstrap (attack → gather resource → deliver to camp)
  const currentActions = steps.map(s => s.action);
  if (currentActions.length === 1 && currentActions[0] === 'attack_camp') {
    const campStep = steps[0];
    const animal = campStep.targetAnimal || campStep.targetType;
    if (animal) {
      const CAMP_RESOURCE: Record<string, string> = {
        spider: 'carrot', gnome: 'carrot', turtle: 'carrot',
        hyena: 'meat', lizard: 'meat', skull: 'meat',
        rogue: 'crystal', shaman: 'crystal',
        panda: 'metal', minotaur: 'crystal',
      };
      const res = CAMP_RESOURCE[animal] || 'carrot';
      const gatherAction = res === 'metal' ? 'mine' : 'seek_resource';
      const gatherStep = gatherAction === 'mine'
        ? { action: 'mine' }
        : { action: 'seek_resource', resourceType: res };
      const deliverStep = { action: 'deliver', target: `nearest_${animal}_camp` };

      // Full bootstrap: attack_camp → gather → deliver (loop from gather)
      steps.length = 0;
      steps.push(campStep, gatherStep, deliverStep);
      cmd.loopFrom = 1;
      console.log(`[Validate] Expanded lone attack_camp to bootstrap: attack → ${gatherAction} ${res} → deliver`);
    }
  }

  // Fix 7: reject unknown action names (don't silently default to carrot gathering)
  const knownActions = new Set(['seek_resource','deliver','hunt','attack_camp','move','defend',
    'attack_enemies','scout','collect','kill_only','mine','equip','contest_event','withdraw_base']);
  cmd.workflow = steps.filter(s => {
    if (!knownActions.has(s.action)) {
      console.warn(`[Validate] Removed unknown action: ${s.action}`);
      return false;
    }
    return true;
  });

  // Fix 8: empty workflow after filtering → mark as unrecognized
  if (cmd.workflow.length === 0) {
    cmd.responseType = 'unrecognized';
    cmd.narration = cmd.narration || 'Could not understand that';
  }

  return cmd;
}

async function parseWithGemini(
  rawText: string,
  ctx: GameContext,
): Promise<HordeCommand[] | null> {
  if (!getGeminiKey()) return null;
  const now = Date.now();
  if (now - _lastGeminiCall < _geminiCooldownMs) return null;
  _lastGeminiCall = now;

  const campList = ctx.camps.map(c =>
    `  [${c.index}] ${c.name} (${c.animalType}, T${c.tier}) - ${c.owner}${c.storedFood > 0 ? ` - food:${c.storedFood}/${c.spawnCost}` : ''} - dist:${c.dist} - defenders:${c.defenders}`
  ).join('\n');

  const unitList = ctx.myUnits.map(u => {
    let info = `  ${u.type} (T${u.tier}): ${u.count} units`;
    if (u.gathering > 0) info += ` (${u.gathering} gathering)`;
    return info;
  }).join('\n');

  const prompt = `You are the AI commander for a voice-controlled RTS game called "Horde Capture." The player speaks commands and you interpret them into game actions. You deeply understand the game's economy and must reason about what the player wants.

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

CASTLE HP: mine=${ctx.nexusHp.mine}/50000, enemy=${ctx.nexusHp.enemy >= 0 ? ctx.nexusHp.enemy + '/50000' : 'unknown (not in vision)'}

Ground items nearby: 🥕${ctx.groundCarrots} carrots, 🍖${ctx.groundMeat} meat, 💎${ctx.groundCrystals} crystals on the map

CARROT SPAWN ZONES (carrots appear in these areas every 5s):
${ctx.carrotZones.length > 0 ? ctx.carrotZones.map((z, i) => `  Zone ${i + 1}: (${z.x},${z.y}) to (${z.x + z.w},${z.y + z.h}) — center (${Math.round(z.x + z.w / 2)},${Math.round(z.y + z.h / 2)})`).join('\n') : '  (scattered across map)'}

ACTIVE MAP EVENTS:
${ctx.activeEvents && ctx.activeEvents.length > 0 ? ctx.activeEvents.map(e => `  ${e.emoji} ${e.name} (${e.type}) at (${e.x},${e.y}) — ${e.info} — ${e.timeLeft}s left\n    HOW TO WIN: ${e.howToWin}`).join('\n') : '  (none)'}

ACTIVE BUFFS:
${ctx.activeBuffs && ctx.activeBuffs.length > 0 ? ctx.activeBuffs.map(b => `  +${Math.round(b.amount * 100)}% ${b.stat} (${b.remaining}s left)`).join('\n') : '  (none)'}

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
- "rush the base" → attack enemy castle (NOT rush modifier). "rush economy" → rush modifier.
- ALWAYS include modifiers if the tone/adjectives imply them, even alongside workflows.

═══ ACTIONS ═══
ALL commands use targetType="workflow" with a workflow array. Even simple commands:
- "go to camp" → workflow: [attack_camp with targetAnimal and qualifier]
- "attack nexus/castle" → workflow: [attack_enemies] (units fight their way to the enemy)
- "defend"/"retreat"/"go home" → workflow: [defend base] or [move to base coords]

QUALIFIERS for attack_camp steps: nearest, furthest, weakest, uncaptured, enemy

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
"go get some gnomes" → [attack_camp gnome nearest, seek_resource carrot, deliver nearest_gnome_camp], loopFrom: 0
"I want more turtles" → [attack_camp turtle nearest, seek_resource carrot, deliver nearest_turtle_camp], loopFrom: 0
"let's get some spiders" → [attack_camp spider nearest, hunt, seek_resource meat, deliver nearest_spider_camp], loopFrom: 0
"I need skulls" → [attack_camp skull nearest, hunt, seek_resource meat, deliver nearest_skull_camp], loopFrom: 0

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

SIMPLE MOVEMENT (still uses workflow):
"attack nearest camp" → [attack_camp, qualifier: "nearest"], loopFrom: 0
"attack nexus" → [attack_enemies], loopFrom: 0
"retreat" → [defend base], loopFrom: 0
"go to the skull camp" → [attack_camp skull nearest], loopFrom: 0

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
Focus on the INTENT behind the words, not the literal phrasing. Players speak casually and imprecisely.

CRITICAL INTENT RULES:
- "get X" / "make X" / "take X" / "produce X" / "create X" / "train X" / "spawn X" / "go get X" / "go make X" / "let's get some X" / "I want X" / "I need X" / "more X" → ALWAYS bootstrap X (targetType="workflow" with attack_camp + resource gathering + deliver)
- "bootstrap X" → same as above
- "get started" / "start" / "let's go" / "begin" → bootstrap gnomes (cheapest start)
- ANY command mentioning an animal name with production intent → FULL bootstrap workflow, NEVER just a simple move
- Be creative — combine steps based on what makes strategic sense
- If you can tell which unit type is selected, tailor the workflow to their strengths
- When in doubt, prefer returning a WORKFLOW (targetType="workflow") over simple movement commands. Workflows are more useful to the player.

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

NOISE, GIBBERISH & CASUAL CHAT — If there is clearly no game command in the input:
- Nonsensical words (e.g. "blorp fizzle wompus", "asdf") or single filler words ("the", "a", "is") → unrecognized
- Casual chat, jokes, greetings, or off-topic remarks (e.g. "hello", "you're cute", "what's your favorite color", "I love you") → unrecognized
- Return responseType:"unrecognized" — do NOT guess a random action
- Still provide a narration: a fun, in-character quip, helpful hint, or confused comment from the units — MUST match selected unit personality! Examples by type: gnomes='Hehe, that's funny boss! But where do we go?', skulls='...the void speaks nonsense. Give us a real command.', spiders='*hisss* confusssing... tell usss what to hunt!', hyenas='HAHAHA WHAT?! Just tell us what to SMASH!', turtles='*sigh* We waited... and for that? Try a real order...', pandas='Hmm, that was nice. But maybe tell us where to walk?', lizards='Input not recognized. Awaiting valid directive.', minotaurs='WHAT?! STOP TALKING, START COMMANDING!!', shamans='The spirits heard you... but understood nothing.', rogues='Real clever. Wanna try an actual order this time?'

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
- You MUST return targetType="workflow" with a "workflow" array for EVERY actionable command. There are no other action targetTypes — workflow is the ONLY way to give units orders. Even "attack", "defend", "retreat" must be workflows.
- EVERY voice command = a NEW workflow. The player is giving a new order — always create full workflow steps.
- NEVER return responseType="acknowledgment". Either it's an action (produce a workflow) or it's unrecognized/status_query.
- If the player says ANYTHING that implies an action (attack, defend, gather, make, get, go, move, retreat, scout, mine, hunt, etc.), you MUST return a workflow.

PLAYER SAYS: "${rawText}"

JSON ONLY (no markdown):
{
  "targetType": "<workflow|query|advanced_plan>",
  "responseType": "<action|unrecognized|status_query>",
  "statusReport": "<1-2 sentence tactical answer, only if responseType=status_query>",
  "targetAnimal": "<animal type or omit>",
  "campIndex": <index or -1>,
  "qualifier": "<nearest|furthest|weakest|uncaptured|enemy or omit>",
  "workflow": [<array of step objects, only if targetType=workflow>],
  "loopFrom": <index where repeating loop starts, default 0>,
  "narration": "<6-12 words, in-character response from the units receiving the order. STRICTLY match unit personality: gnomes=bubbly, excitable, childlike joy, love food and shiny things, say 'boss' a lot; skulls=grim, ominous, speak of death/darkness/doom, hollow echoing tone; spiders=creepy, hissy, stretch out S sounds ('sssspy', 'yesss'), sinister and skittery; hyenas=unhinged, manic, LOUD, love chaos and destruction, laugh a lot ('AHAHAHA'); turtles=melancholic, reluctant, slow, sad, always complaining or sighing, everything is too hard or too fast; pandas=gentle giants, warm, zen-like, talk about food and naps, peaceful but strong; lizards=cold, calculating, robotic precision, no emotion, clinical; minotaurs=RAGING, furious, primal screaming, all-caps energy, SMASH EVERYTHING; shamans=mystical, cryptic, speak in riddles and prophecy, ethereal; rogues=sarcastic, cocky, street-smart, too cool for this, snarky one-liners. Examples: gnomes='Ooh ooh carrots! We love carrots boss!', skulls='The grave awaits those we march toward...', spiders='*hisss* we ssscatter into the shadowsss', hyenas='AHAHAHA YEAH LETS WRECK EM!!', turtles='*sigh* Do we have to? ...fine, moving.', pandas='Mmm okay, nice walk, maybe snack after?', lizards='Acknowledged. Executing patrol route.', minotaurs='RAAAAGH!! CHARGE!! SMASH THEM ALL!!', shamans='The spirits whisper... this path is fated.', rogues='Yeah yeah, on it. Try to keep up.'>",
  "unitReaction": "<2-5 word in-character grunt reaction from the units, funny/cute personality. Examples: 'Aye aye!', 'SMASH TIME!', 'ooh shiny rocks!', 'hisssss yesss', '*rattles excitedly*', 'me hungry...', 'FOR GLORY!'>",
  "modifiers": {"formation": "spread|tight|null", "caution": "safe|aggressive|null", "pacing": "rush|efficient|null"},
  "planGoal": {"type": "unlock_equipment|stockpile_resource", "equipment": "<equipment id, only if type=unlock_equipment>", "resource": "<resource type, only if type=stockpile_resource>", "amount": "<number, only if stockpile_resource>", "thenAction": "<optional follow-up: defend, attack, etc>"},
  "modifierOnly": false
}`;

  const body = JSON.stringify({
    contents: [{ parts: [{ text: prompt }] }],
    generationConfig: {
      maxOutputTokens: 2048,
      temperature: 0.15, // low temp for deterministic command parsing
      responseMimeType: 'application/json',
    },
  });

  for (let attempt = 0; attempt < GEMINI_MAX_RETRIES; attempt++) {
    try {
      const response = await fetch(GEMINI_URL + getGeminiKey(), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body,
      });

      if (response.status === 429) {
        // Rate limited — exponential backoff, don't retry
        _geminiCooldownMs = Math.min(_geminiCooldownMs * 2, GEMINI_MAX_COOLDOWN);
        console.warn(`[Gemini] 429 rate limited, backing off to ${_geminiCooldownMs / 1000}s`);
        return null;
      }

      if (!response.ok) {
        console.warn('[Gemini] API error:', response.status);
        return null;
      }

      // Successful call — reset cooldown to base
      _geminiCooldownMs = GEMINI_BASE_COOLDOWN;

      const data = await response.json();
      // With thinking enabled, parts[0] may be the thinking part — find the last text part
      const parts = data.candidates?.[0]?.content?.parts;
      if (!parts || parts.length === 0) return null;
      const text = parts[parts.length - 1]?.text;
      if (!text) return null;

      // Strip markdown fencing if present (safety net — responseMimeType should give clean JSON)
      const cleaned = text.replace(/^```(?:json)?\s*\n?/i, '').replace(/\n?```\s*$/i, '').trim();
      console.log('[Gemini] Raw response:', cleaned.slice(0, 500));
      const parsed = JSON.parse(cleaned);
      if (Array.isArray(parsed)) return parsed as HordeCommand[];
      return [parsed] as HordeCommand[];
    } catch (err) {
      console.warn('[Gemini] Parse failed, falling back to local:', err);
      return null;
    }
  }

  console.warn('[Gemini] All retries exhausted, falling back to local parser');
  return null;
}

// ═══════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════

interface AnimalDef {
  type: string;
  emoji: string;
  hp: number;
  attack: number;
  speed: number; // pixels per second
  tier: number;
  ability: string; // unique ability name
  desc: string;    // short description
  ability2: string; // second ability name
  desc2: string;    // second ability description
  mineSpeed: number; // mining speed multiplier (1.0 = base 2s tick, higher = faster)
}

type ResourceType = 'carrot' | 'meat' | 'crystal' | 'metal';

interface HGroundItem {
  id: number;
  type: ResourceType;
  x: number;
  y: number;
  sprite: Phaser.GameObjects.Text | Phaser.GameObjects.Image | null;
  dead: boolean;
  age: number; // ms since spawn, for despawn
}

interface HMineNode {
  id: string;
  x: number;
  y: number;
  sprite: Phaser.GameObjects.Text | Phaser.GameObjects.Image | null;
  label: Phaser.GameObjects.Text | null;
}

// ─── LLM-Defined Workflows ────────────────────────────────
// The LLM outputs workflow steps; the game engine executes them in order and loops.
type WorkflowStep =
  | { action: 'seek_resource'; resourceType: ResourceType }   // find & walk to a ground resource
  | { action: 'deliver'; target: string }                     // carry item to target: 'base', 'nearest_TYPE_camp' (e.g. 'nearest_gnome_camp'), or a campId
  | { action: 'hunt'; targetType?: string }                   // attack nearest wild animal (for meat/crystal drops)
  | { action: 'attack_camp'; campIndex?: number; qualifier?: string; targetAnimal?: string } // go fight a camp
  | { action: 'move'; x: number; y: number }                  // move to position
  | { action: 'defend'; target: string }                      // guard a location: 'base', 'nearest_TYPE_camp', or campId — fight enemies that come near
  | { action: 'attack_enemies' }                              // seek and fight nearest enemy player units
  | { action: 'scout'; x?: number; y?: number }               // explore the map, reveal camps/enemies, avoid combat. Optional x,y to bias toward a region.
  | { action: 'collect'; resourceType: ResourceType }         // pick up ground resources while avoiding enemies
  | { action: 'kill_only'; targetType?: string }              // hunt and kill wild animals but ignore drops
  | { action: 'mine' }                                        // go to nearest mine, extract metal
  | { action: 'equip'; equipmentType: EquipmentType }         // go to armory, pick up equipment
  | { action: 'contest_event' }                                // move to nearest active map event
  | { action: 'withdraw_base'; resourceType: ResourceType };   // take a resource from base stockpile

interface HWorkflow {
  steps: WorkflowStep[];
  currentStep: number;
  label: string; // LLM-provided description, shown in HUD
  loopFrom: number;    // after end, loop back here (default 0 = current behavior)
  playedOnce: boolean; // has the full sequence completed at least once?
  voiceCommand?: string; // the original voice/text command that created this workflow
}

// Backward compat helper — build a workflow from old-style gather loop params
function makeGatherWorkflow(resourceType: ResourceType, deliverTo: string): HWorkflow {
  return {
    steps: [
      { action: 'seek_resource', resourceType },
      { action: 'deliver', target: deliverTo },
    ],
    currentStep: 0,
    label: `${resourceType} → ${deliverTo}`,
    loopFrom: 0,
    playedOnce: false,
  };
}

// Build a full bootstrap workflow for an animal type: attack_camp → gather → deliver
function makeBootstrapWorkflow(animalType: string): HWorkflow {
  const cost = SPAWN_COSTS[animalType];
  if (!cost) return makeGatherWorkflow('carrot', 'base');

  const deliverTo = `nearest_${animalType}_camp`;
  const steps: WorkflowStep[] = [
    { action: 'attack_camp', targetAnimal: animalType, qualifier: 'nearest' },
  ];

  // Meat/crystal units need hunting before resource pickup
  if (cost.type === 'meat') {
    steps.push({ action: 'hunt' });
  } else if (cost.type === 'crystal') {
    steps.push({ action: 'hunt', targetType: 'minotaur' });
  }

  steps.push({ action: 'seek_resource', resourceType: cost.type });
  steps.push({ action: 'deliver', target: deliverTo });

  return {
    steps,
    currentStep: 0,
    label: `bootstrap ${animalType}`,
    loopFrom: 0,
    playedOnce: false,
  };
}

interface HUnit {
  id: number;
  type: string;
  team: 0 | 1 | 2; // 0 = neutral camp defender
  hp: number;
  maxHp: number;
  attack: number;
  speed: number;
  x: number;
  y: number;
  targetX: number;
  targetY: number;
  attackTimer: number;
  sprite: Phaser.GameObjects.Sprite | null;
  dead: boolean;
  campId: string | null; // if this unit is a camp defender, which camp
  lungeX: number; // sprite offset during attack lunge
  lungeY: number;
  animState: 'idle' | 'walk' | 'attack';
  attackFaceX: number | null; // x of current attack target for facing
  prevSpriteX: number;
  prevSpriteY: number;
  // Special mechanic flags
  gnomeShield: number;   // gnome: survives this many lethal hits (starts at 1)
  hasRebirth: boolean;   // skull: cheats death once (survives at 1 HP)
  diveReady: boolean;    // (unused, kept for interface compat)
  diveTimer: number;     // (unused, kept for interface compat)
  lastAttackTarget: number; // rogue backstab: id of last target attacked (-1 = none, first hit = 3x)
  // Resource economy
  carrying: ResourceType | null;
  carrySprite: Phaser.GameObjects.Text | null;
  loop: HWorkflow | null;
  isElite: boolean; // golden elite prey — drops crystals
  idleTimer: number; // ms spent idle — restarts loop after 4s
  claimItemId: number; // id of ground item this unit is pathing to (-1 = none)
  equipment: EquipmentType | null; // equipped item (pickaxe, sword, shield, boots, banner)
  equipLevel: number; // level of equipped item (1-3), 0 = none
  equipSprite: Phaser.GameObjects.Text | null; // visual for equipment
  equipDragSprite: Phaser.GameObjects.Text | null; // trailing drag sprite (pickaxe)
  equipVisualApplied: EquipmentType | null; // tracks which visual is currently rendered
  mods: BehaviorMods; // behavior modifiers (formation, caution, pacing)
  // A* safe pathfinding
  pathWaypoints: {x: number; y: number}[] | null;
  pathAge: number;       // ms since last path computation
  pathTargetX: number;   // target when path was computed (invalidate on change)
  pathTargetY: number;
  // Stuck detection
  lastCheckX: number;
  lastCheckY: number;
  stuckFrames: number;
  stuckCooldown: number;
}

interface CampDef {
  id: string;
  name: string;
  type: string;
  x: number;
  y: number;
  guards: number;
  spawnMs: number;
  buff: { stat: string; value: number };
}

interface HCamp {
  id: string;
  name: string;
  animalType: string;
  tier: number;
  guardCount: number; // how many defenders to spawn
  x: number;
  y: number;
  owner: 0 | 1 | 2;
  spawnMs: number;
  spawnTimer: number;
  buff: { stat: string; value: number };
  label: Phaser.GameObjects.Text | null;
  area: Phaser.GameObjects.Ellipse | null;
  captureBar: Phaser.GameObjects.Graphics | null;
  storedFood: number; // food stored toward next spawn
  // Fog of war: remember last-seen state
  scouted: boolean;          // has this camp ever been revealed?
  lastSeenOwner: 0 | 1 | 2;  // owner when last in vision
  lastSeenLabel: string;      // label text when last in vision
  lastSeenColor: string;      // label color when last in vision
  // Idle guard visual at captured camps
  idleGuard: Phaser.GameObjects.Sprite | null;
  idleGuardOwner: 0 | 1 | 2; // track which team the guard was created for
  // Spawn cost label (e.g. "2🥕 = 1 gnome")
  costLabel: Phaser.GameObjects.Text | null;
}

interface HNexus {
  team: 1 | 2;
  x: number;
  y: number;
  hp: number;
  maxHp: number;
  container: Phaser.GameObjects.Container | null;
  hpBar: Phaser.GameObjects.Graphics | null;
  hpText: Phaser.GameObjects.Text | null;
  label: Phaser.GameObjects.Text | null;
  _lastHitFx?: number;
  attackTimer: number;
}

interface HTower {
  id: string;
  team: 1 | 2;
  x: number;
  y: number;
  hp: number;
  maxHp: number;
  damage: number;
  range: number;         // detection/attack range in px
  splashRange: number;   // AoE splash radius
  attackCooldown: number; // ms between shots
  attackTimer: number;   // ms until next shot
  alive: boolean;
  sprite: Phaser.GameObjects.Image | null;
  hpBar: Phaser.GameObjects.Graphics | null;
  hpText: Phaser.GameObjects.Text | null;
  rangeCircle: Phaser.GameObjects.Arc | null;
  label: Phaser.GameObjects.Text | null;
}

interface PendingHit {
  attackerId: number;
  targetId: number;       // unit id, or -1 for nexus
  nexusTeam: 1 | 2 | 0;  // which nexus (0 = not a nexus hit)
  dmg: number;            // pre-calculated damage
  splashTargets: { id: number; dmg: number }[]; // splash damage
  timer: number;          // ms remaining until hit lands
  isTroll: boolean;       // troll club slam effect
  isRanged: boolean;      // hyena bone toss
  isSplash: boolean;      // shaman/troll splash
  isCrit: boolean;        // lizard execute / rogue backstab
  // Projectile fields (ranged only)
  projectile: Phaser.GameObjects.Container | null;
  projX: number;          // current projectile world position
  projY: number;
  projSpeed: number;      // pixels per second (0 = melee, uses timer)
}



// ═══════════════════════════════════════════════════════════════
// MULTIPLAYER SYNC TYPES
// ═══════════════════════════════════════════════════════════════

interface HordeSceneData {
  isOnline?: boolean;
  gameId?: string;
  playerId?: string;
  amPlayer1?: boolean;
  mapId?: string;
  mapDef?: MapDef; // direct map definition from editor live sync
  isDebug?: boolean;
}

interface HordeSyncUnit {
  id: number; type: string; team: number;
  hp: number; maxHp: number; attack: number; speed: number;
  x: number; y: number; targetX: number; targetY: number;
  dead: boolean; campId: string | null;
  carrying?: string | null;
  equipment?: string | null;
  equipLevel?: number;
  animState?: string;
  loop?: { steps: { action: string }[]; currentStep: number } | null;
}

interface HordeSyncState {
  units: HordeSyncUnit[];
  camps: { id: string; owner: number; spawnTimer: number; storedFood: number }[];
  nexuses: { team: number; hp: number }[];
  rallyPoints: Record<string, { x: number; y: number }>;
  baseSpawnTimers: { 1: number; 2: number };
  nextId: number;
  gameTime: number;
  gameOver: boolean;
  winner: number | null;
  mapEvents?: { id: number; type: string; x: number; y: number; timer: number; duration: number; state: string; progress: { 1: number; 2: number }; claimedBy: number | null; data: Record<string, any> }[];
  baseStockpile?: { 1: Record<string, number>; 2: Record<string, number> };
  currentEra?: number;
  groundItems?: { id: number; type: string; x: number; y: number }[];
  teamBuffs?: { team: number; stat: string; amount: number; remaining: number }[];
  unlockedEquipment?: { 1: Record<string, number>; 2: Record<string, number> };
  matchStats?: any;
  topKiller?: Record<string, { type: string; kills: number }>;
  groupWorkflows?: Record<string, any>;
  groupModifiers?: Record<string, any>;
  freeGnomeTimer?: number;
}

// ═══════════════════════════════════════════════════════════════
// MAP EVENTS
// ═══════════════════════════════════════════════════════════════

type MapEventType = 'fungal_bloom' | 'warchest' | 'kill_bounty' | 'mercenary_outpost' | 'bottomless_pit' | 'hungry_bear';

const MAP_EVENT_DEFS: Record<MapEventType, { emoji: string; name: string; duration: number; minEra: number }> = {
  fungal_bloom:      { emoji: '🍄', name: 'Fungal Bloom',      duration: 45000,  minEra: 1 },
  warchest:          { emoji: '📦', name: 'Warchest',          duration: 60000,  minEra: 1 },
  kill_bounty:       { emoji: '🎯', name: 'Kill Bounty',       duration: 40000,  minEra: 2 },
  mercenary_outpost: { emoji: '🏕️', name: 'Mercenary Outpost', duration: 75000,  minEra: 2 },
  bottomless_pit:    { emoji: '🕳️', name: 'Bottomless Pit',    duration: 60000,  minEra: 3 },
  hungry_bear:       { emoji: '🐻', name: 'Hungry Bear',       duration: 90000,  minEra: 3 },
};

// ═══════════════════════════════════════════════════════════════
// NOTIFICATION SYSTEM TYPES & DATA
// ═══════════════════════════════════════════════════════════════

type NotifType = 'era_banner' | 'event_spawn' | 'event_resolve' | 'game_start' | 'game_start_controls';

interface EraBannerData { eraNumber: number; eraName: string; tierMax: number; description: string }
interface EventSpawnData { eventType: MapEventType; emoji: string; name: string; description: string; color: string }
interface EventResolveData { eventType: MapEventType; emoji: string; winner: 1 | 2 | null; rewardText: string; color: string }
interface GameStartData { _brand?: 'game_start' }

interface NotifItem {
  type: NotifType;
  priority: number; // 4=game_start, 3=era, 2=spawn, 1=resolve
  data: EraBannerData | EventSpawnData | EventResolveData | GameStartData;
}

interface ActiveNotif {
  type: NotifType;
  el: HTMLElement;
  spawnTime: number;
  duration: number; // ms
  exiting: boolean;
}

const ERA_BANNER_INFO: Record<number, string> = {
  1: 'Gather resources, capture camps, grow your horde',
  2: 'Tier 2 units — Skulls, Spiders & Hyenas roam the wilds',
  3: 'Tier 3 units — Pandas & Lizards appear in the wild',
  4: 'Tier 4 units — Minotaurs & Shamans join the fray',
  5: 'Tier 5 — The Troll has awoken',
};

const ERA_ROMAN: Record<number, string> = { 1: 'I', 2: 'II', 3: 'III', 4: 'IV', 5: 'V' };

const TIER_COLORS: Record<number, string> = { 1: '#2E8B2E', 2: '#2266BB', 3: '#CC6A00', 4: '#BB2222', 5: '#B8860B' };

const EVENT_COLORS: Record<string, string> = {
  fungal_bloom: '#66ff66', warchest: '#ffcc00', kill_bounty: '#ff4444',
  mercenary_outpost: '#44aaff', bottomless_pit: '#aa44ff', hungry_bear: '#ff8844',
};

const EVENT_SPAWN_DESCS: Record<string, string> = {
  fungal_bloom: 'Gather mushroom pickups near the bloom zone!',
  warchest: 'Smash the chest to claim loot and buffs!',
  kill_bounty: 'Hunt the marked target before your opponent!',
  mercenary_outpost: 'Control the outpost to recruit mercenaries!',
  bottomless_pit: 'Sacrifice units into the pit for powerful rewards!',
  hungry_bear: 'Feed the bear to tame it as a siege weapon!',
};

// 4 event spots — symmetrically placed around map center (3200,3200)
// Top/Bottom = off-diagonal corners (equidistant from both bases, used for simultaneous events)
// Left/Right  = diagonal flanks (blue-side / red-side, used for solo events that alternate)
const EVENT_SPOTS = {
  top:    { x: 1600, y: 1600 },  // NW corner — off-diagonal
  bottom: { x: 4800, y: 4800 },  // SE corner — off-diagonal
  left:   { x: 1600, y: 4800 },  // SW — near blue base
  right:  { x: 4800, y: 1600 },  // NE — near red base
};

// Simultaneous events → spawn on BOTH top + bottom spots at once
const SIMULTANEOUS_EVENTS: MapEventType[] = ['fungal_bloom', 'warchest', 'hungry_bear', 'kill_bounty'];
// Solo events → spawn on left OR right, alternating each cycle
const SOLO_EVENTS: MapEventType[] = ['mercenary_outpost', 'bottomless_pit'];

interface MapEvent {
  id: number;
  type: MapEventType;
  x: number; y: number;
  timer: number;
  duration: number;
  state: 'active' | 'claimed' | 'expired';
  progress: { 1: number; 2: number };
  claimedBy: 1 | 2 | null;
  container: Phaser.GameObjects.Container | null;
  data: Record<string, any>;
}

// ═══════════════════════════════════════════════════════════════
// CONSTANTS
// ═══════════════════════════════════════════════════════════════

const WORLD_W = 6400;
const WORLD_H = 6400;
const P1_BASE = { x: 250, y: WORLD_H - 250 };
const P2_BASE = { x: WORLD_W - 250, y: 250 };

// ─── UNIT ROSTER ──────────────────────────────────────────
// Each unit has a distinct role, stat profile, and unique ability.
//
// T1 WORKERS — cheap, resource gatherers
//   🧝 Gnome   "Nimble Hands" — Fastest gatherer. 2x pickup range. Born to gather.
//   🐢 Turtle  "Shell Stance" — Slowest unit but tankiest T1. 60% DR when stationary + taunts nearby foes.
//
// T2 FIGHTERS — mid-game combat specialists
//   💀 Skull   "Undying"      — Cheats death once (survives at 1 HP).
//   🕷️ Spider  "Venom Bite"   — Slow assassin. +5% target max HP per hit.
//   🐺 Hyena   "Bone Toss"    — Extended range (120 vs 80).
//
// T3 HEAVIES — expensive powerhouses
//   🐼 Panda   "Thick Hide"   — Regenerates 1% max HP/sec. Very tanky.
//   🦎 Lizard  "Cold Blood"   — 3x dmg to targets below 40% HP.
//
// T4 ELITES — game-changers
//   🐂 Minotaur "War Cry"     — Commander. Nearby allies +25% attack.
//   🔮 Shaman   "Arcane Blast" — All attacks splash 60px.
//
// T5 LEGENDARY
//   👹 Troll   "Club Slam"    — Massive 90px splash, slows enemies.

// Avatar image URLs for unit icons (served from public/assets/enemies/avatars/)
const AVATAR_URL: Record<string, string> = {
  gnome: 'assets/enemies/avatars/gnome.png',
  turtle: 'assets/enemies/avatars/turtle.png',
  skull: 'assets/enemies/avatars/skull.png',
  spider: 'assets/enemies/avatars/spider.png',
  hyena: 'assets/enemies/avatars/hyena.png',
  rogue: 'assets/enemies/avatars/rogue.png',
  panda: 'assets/enemies/avatars/panda.png',
  lizard: 'assets/enemies/avatars/lizard.png',
  minotaur: 'assets/enemies/avatars/minotaur.png',
  shaman: 'assets/enemies/avatars/shaman.png',
  troll: 'assets/enemies/avatars/troll.png',
};
function avatarImg(type: string, size = 24): string {
  const url = AVATAR_URL[type];
  if (!url) return '';
  return `<img src="${url}" width="${size}" height="${size}" style="image-rendering:pixelated;object-fit:contain;" alt="${type}">`;
}

const ANIMALS: Record<string, AnimalDef> = {
  gnome:     { type: 'gnome',     emoji: '🧝', hp: 15,    attack: 3,    speed: 210, tier: 1, ability: 'Nimble Hands', desc: '2x pickup range, fastest gatherer', ability2: 'Plucky', desc2: 'Survives 1 lethal hit no matter the damage', mineSpeed: 2.0 },
  turtle:    { type: 'turtle',    emoji: '🐢', hp: 65,    attack: 3,    speed: 55,  tier: 1, ability: 'Shell Stance', desc: '60% DR when stationary + taunts nearby foes', ability2: 'Beast of Burden', desc2: 'Carries 10x resources per trip', mineSpeed: 1.5 },
  skull:     { type: 'skull',     emoji: '💀', hp: 80,    attack: 14,   speed: 155, tier: 2, ability: 'Undying',      desc: 'Cheats death once (survives at 1 HP)', ability2: 'Dread Aura', desc2: 'Enemies nearby attack 15% slower', mineSpeed: 0.8 },
  spider:    { type: 'spider',    emoji: '🕷️', hp: 120,   attack: 18,   speed: 140, tier: 2, ability: 'Venom Bite',   desc: '+5% target max HP per hit', ability2: 'Web Trap', desc2: 'First attack slows target 40% for 3s', mineSpeed: 0.6 },
  hyena:     { type: 'hyena',     emoji: '🐺', hp: 55,    attack: 28,   speed: 175, tier: 2, ability: 'Bone Toss',    desc: 'Extended range (120 vs 80)', ability2: 'Pack Frenzy', desc2: '+10% atk per nearby allied hyena (max +50%)', mineSpeed: 0.8 },
  panda:     { type: 'panda',     emoji: '🐼', hp: 900,   attack: 35,   speed: 80,  tier: 3, ability: 'Thick Hide',   desc: 'Regenerates 1% max HP/sec', ability2: 'Bamboo Wall', desc2: 'Blocks projectiles for units behind', mineSpeed: 0.5 },
  lizard:    { type: 'lizard',    emoji: '🦎', hp: 450,   attack: 70,   speed: 110, tier: 3, ability: 'Cold Blood',   desc: '3x dmg to targets below 40% HP', ability2: 'Tail Whip', desc2: 'Attacks hit enemies in 50px arc behind target', mineSpeed: 0.7 },
  minotaur:  { type: 'minotaur',  emoji: '🐂', hp: 2200,  attack: 110,  speed: 120, tier: 4, ability: 'War Cry',      desc: 'Nearby allies +25% attack', ability2: 'Bull Rush', desc2: 'Charges at targets >200px away for 2x impact', mineSpeed: 0.4 },
  shaman:    { type: 'shaman',    emoji: '🔮', hp: 1400,  attack: 180,  speed: 100, tier: 4, ability: 'Arcane Blast', desc: 'All attacks splash 60px', ability2: 'Hex Ward', desc2: 'Nearby allies take 20% less splash damage', mineSpeed: 0.5 },
  troll:     { type: 'troll',     emoji: '👹', hp: 14000, attack: 350,  speed: 50,  tier: 5, ability: 'Club Slam',    desc: 'Massive 90px splash, slows enemies', ability2: 'Regeneration', desc2: '0.5% HP/s regen, doubles below 30% HP', mineSpeed: 0.3 },
  rogue:     { type: 'rogue',     emoji: '🗡️', hp: 60,    attack: 45,   speed: 200, tier: 2, ability: 'Backstab',    desc: '3x first hit + invisible to neutrals', ability2: 'Shadow Step', desc2: 'Invisible to neutral enemies, sneaks past defenders', mineSpeed: 1.0 },
};

// Hard counter map: attacker → types it deals 2x damage to
// Designed around the ability matchups:
const HARD_COUNTERS: Record<string, string[]> = {
  gnome:     [],                       // pure worker, wins by speed
  turtle:    ['gnome'],                // shell absorbs weak hits
  skull:     ['hyena', 'spider'],      // undying outlasts fragile specialists
  spider:    ['panda', 'turtle'],      // venom shreds tanky slow targets
  hyena:     ['spider', 'gnome'],      // ranged picks off slow/fragile targets
  panda:     ['skull', 'lizard'],      // regen too tanky to burst or execute
  lizard:    ['panda', 'minotaur'],    // cold blood executes the biggest targets
  minotaur:  ['skull', 'shaman'],      // war cry + stats overwhelm undying and casters
  shaman:    ['troll', 'minotaur'],    // arcane blast burns down big slow targets
  troll:     ['shaman', 'hyena'],      // club slam crushes casters and ranged
  rogue:     ['gnome', 'shaman'],     // backstab bursts down fragile targets
};

const UNIT_STRENGTHS: Record<string, string[]> = {
  gnome:    ['Fastest unit — outruns everything', 'Best economy builder', 'Cheap and expendable scouts'],
  turtle:   ['Incredible hauler — 10x carry capacity', 'Taunts enemies off your fragile units', 'Very tanky for T1 when stationary'],
  skull:    ['Guaranteed second life buys time', 'Debuffs enemy attack speed', 'Good speed for a combat unit'],
  spider:   ['Shreds tanks — % HP damage scales', 'Web opener cripples fast units', 'Great vs Panda, Turtle, Troll'],
  hyena:    ['Outranges every other unit', 'Pack bonus makes hyena balls deadly', 'Fast — good for hit-and-run raids'],
  rogue:    ['Massive burst on first hit', 'Fastest combat unit — great assassin', 'Sneaks past defenders for captures'],
  panda:    ['Insane regen — wins wars of attrition', 'Huge HP pool soaks damage', 'Shields backline from ranged attacks'],
  lizard:   ['Execute damage deletes wounded units', 'Cleave hits clustered enemies', 'Strong balanced stats for T3'],
  minotaur: ['Massive team-wide damage buff', 'Charge obliterates backlines', 'Tanky enough to lead from the front'],
  shaman:   ['AoE damage melts groups', 'Splash reduction protects your army', 'Highest DPS in the game per hit'],
  troll:    ['Unkillable wall of HP + regen', 'Splash slam wipes entire armies', 'Slow effect prevents escape'],
};

const UNIT_WEAKNESSES: Record<string, string[]> = {
  gnome:    ['Lowest HP and attack in the game', 'Useless in a real fight', 'Dies to splash damage quickly'],
  turtle:   ['Slowest unit in the game', 'Nearly zero damage output', 'Easy to kite and ignore'],
  skull:    ['Low HP — dies fast after rebirth', 'Mediocre damage for T2', 'Only one rebirth per life'],
  spider:   ['Slow movement — easy to avoid', 'Fragile for a "tank killer"', 'Bad vs swarms of small units'],
  hyena:    ['Glass cannon — lowest T2 HP', 'Useless alone without pack bonus', 'Gets destroyed by splash damage'],
  rogue:    ['Paper thin HP — dies instantly', 'Backstab only works once per target', 'Terrible in prolonged fights'],
  panda:    ['Very slow — easy to run from', 'Low DPS for its cost', 'Gets shredded by Spider venom'],
  lizard:   ['Needs targets softened first', 'Expensive — 8 carrots', 'Countered by spread formations'],
  minotaur: ['Very expensive — 12 crystals', 'Charge can pull it out of position', 'Gets executed by Lizard Cold Blood'],
  shaman:   ['Expensive and slow to build', 'Splash hits your own pushes too close', 'Gets one-shot by Rogue backstab'],
  troll:    ['Slowest combat unit by far', 'Costs 20 crystals — huge investment', 'Gets kited and whittled by ranged'],
};

// Procedural map: competitive symmetric layout.
// Distribution: ~50% T1, ~25% T2, ~12% T3, ~8% T4, ~5% T5
// Mirror-symmetric across the diagonal (P1↔P2 fair) with camps in all quadrants.
// Seeded RNG so both players get the same map in multiplayer.

function seededRandom(seed: number) {
  let s = seed;
  return () => { s = (s * 16807 + 0) % 2147483647; return s / 2147483647; };
}

// Unique alliterative/rhyming camp names per unit — easy to call out by voice
const CAMP_NAMES: Record<string, string[]> = {
  gnome: [
    'Gnarly Grotto', 'Gemstone Glen', 'Gadget Garden', 'Goblin Gate',
    'Granite Glade', 'Gleaming Gulch', 'Gnome Nook', 'Golden Grove',
    'Gear Gorge', 'Glimmer Gap', 'Gizmo Grounds', 'Grassy Hyena',
  ],
  turtle: [
    'Tranquil Terrace', 'Tumble Town', 'Twilight Trail', 'Tidal Turn',
    'Thistle Tor', 'Timber Trench', 'Turtle Tavern', 'Topaz Tower',
    'Tangled Thicket', 'Tepid Tarn', 'Thunder Trail', 'Tundra Top',
  ],
  skull: [
    'Skull Sanctum', 'Shadow Shrine', 'Skeleton Shore', 'Specter Steppe',
    'Soul Swamp', 'Sinister Summit', 'Shade Springs', 'Spirit Stretch',
    'Sepulcher Sands', 'Sorrow Slope', 'Spook Shelf', 'Skull Sweep',
  ],
  spider: [
    'Silk Spindle', 'Shadow Silk', 'Spinner Spire', 'Strand Stretch',
    'Silken Sands', 'Spider Sweep', 'Sticky Springs', 'Spindle Steppe',
    'Silk Scar', 'Spinner Slope', 'Strand Shelf', 'Spider Strip',
  ],
  hyena: [
    'Gnash Gate', 'Growl Gorge', 'Grunt Gully', 'Gnaw Grounds',
    'Grim Garrison', 'Growling Glen', 'Hyena Notch', 'Gore Gulch',
    'Gravel Gap', 'Gnarl Grove', 'Grudge Garden', 'Hyena Nook',
  ],
  panda: [
    'Peaceful Peak', 'Plum Pagoda', 'Pine Paradise', 'Placid Pool',
    'Peony Plateau', 'Pebble Path', 'Panda Pavilion', 'Primrose Pass',
    'Pleasant Prairie', 'Porcelain Pond', 'Petal Point', 'Plum Pasture',
  ],
  lizard: [
    'Lava Lair', 'Lurking Ledge', 'Lizard Lagoon', 'Limestone Ledge',
    'Lush Landing', 'Lunar Lake', 'Lichen Lodge', 'Lost Lagoon',
    'Leafy Lane', 'Lantern Lair', 'Legacy Ledge', 'Lizard Loft',
  ],
  minotaur: [
    'Maze Manor', 'Might Mountain', 'Marble Mine', 'Mammoth Meadow',
    'Mystic Mesa', 'Monolith Mound', 'Minotaur March', 'Molten Moat',
    'Maul Mount', 'Magnus Mill', 'Mace Mire', 'Muscle Mesa',
  ],
  shaman: [
    'Spirit Shrine', 'Spell Spring', 'Sorcery Summit', 'Starfall Sanctum',
    'Sage Spire', 'Shimmer Shore', 'Sigil Swamp', 'Sacred Stone',
    'Spark Slope', 'Shaman Shelf', 'Spectral Sands', 'Storm Shrine',
  ],
  troll: [
    'Terror Tor', 'Thunder Throne', 'Titan Trench', 'Troll Tavern',
    'Tremor Trail', 'Twisted Tower', 'Thorned Thicket', 'Titan Tarn',
    'Tusk Terrace', 'Tyrant Top', 'Thrash Trench', 'Troll Tunnel',
  ],
  rogue: [
    'Rogue Ravine', 'Razor Ridge', 'Raider Roost', 'Reaper Run',
    'Ruin Reach', 'Raven Rest', 'Rascal Row', 'Rustblade Ruins',
    'Rebel Rise', 'Ridgeback Run', 'Rogue Retreat', 'Raptor Roost',
  ],
};

// Track used names to guarantee uniqueness
const usedNames: Record<string, number> = {};

function pickCampName(animalType: string, rng: () => number): string {
  const pool = CAMP_NAMES[animalType] || [`${cap(animalType)} Camp`];
  // Pick a random name from the pool
  const idx = Math.floor(rng() * pool.length);
  const baseName = pool[idx];
  // Ensure uniqueness — append number if reused
  usedNames[baseName] = (usedNames[baseName] || 0) + 1;
  if (usedNames[baseName] > 1) return `${baseName} ${usedNames[baseName]}`;
  return baseName;
}

function makeCamps(): CampDef[] {
  const camps: CampDef[] = [];
  const rng = seededRandom(42069);
  for (const k of Object.keys(usedNames)) delete usedNames[k];

  const GUARD_COUNT: Record<string, number> = {
    gnome: 1, turtle: 1, skull: 1, spider: 1, hyena: 1, rogue: 1,
    panda: 1, lizard: 1, minotaur: 1, shaman: 1, troll: 1,
  };
  const SPAWN_MS: Record<string, number> = {
    gnome: 4000, turtle: 4500, skull: 6000, spider: 6000, hyena: 5500, rogue: 5500,
    panda: 7500, lizard: 7500, minotaur: 10000, shaman: 10000, troll: 15000,
  };

  const cx = WORLD_W / 2, cy = WORLD_H / 2;
  const mirror = (x: number, y: number): [number, number] => [cx + (cx - x), cy + (cy - y)];

  let idx = 0;

  // ─── ONE CAMP PER UNIT TYPE PER SIDE (mirrored) ───
  const campLayout: { type: string; distFromBase: number; angleOffset: number }[] = [
    // T1 — close to base
    { type: 'gnome',  distFromBase: 400,  angleOffset: -0.4 },
    { type: 'turtle', distFromBase: 450,  angleOffset: 0.4 },
    // T2 — mid range
    { type: 'skull',  distFromBase: 800,  angleOffset: -0.6 },
    { type: 'spider', distFromBase: 850,  angleOffset: 0.0 },
    { type: 'hyena',  distFromBase: 900,  angleOffset: 0.6 },
    { type: 'rogue',  distFromBase: 750,  angleOffset: 0.8 },
    // T3 — far mid
    { type: 'panda',  distFromBase: 1300, angleOffset: -0.3 },
    { type: 'lizard', distFromBase: 1350, angleOffset: 0.3 },
    // T4 — deep contested, close to center
    { type: 'minotaur', distFromBase: 1700, angleOffset: -0.2 },
    { type: 'shaman',   distFromBase: 1750, angleOffset: 0.2 },
  ];

  // Base angle from P1 base toward center
  const baseAngle = Math.atan2(cy - P1_BASE.y, cx - P1_BASE.x);

  for (const layout of campLayout) {
    const def = ANIMALS[layout.type];
    const angle = baseAngle + layout.angleOffset + (rng() - 0.5) * 0.2;
    const dist = layout.distFromBase + (rng() - 0.5) * 80;

    const x = Math.round(Math.max(120, Math.min(WORLD_W - 120, P1_BASE.x + Math.cos(angle) * dist)));
    const y = Math.round(Math.max(120, Math.min(WORLD_H - 120, P1_BASE.y + Math.sin(angle) * dist)));
    const [mx, my] = mirror(x, y);

    const name1 = pickCampName(layout.type, rng);
    const name2 = pickCampName(layout.type, rng);
    const buff1 = { stat: 'attack', value: 0.05 + rng() * 0.05 };
    const buff2 = { stat: 'hp', value: 0.05 + rng() * 0.05 };

    camps.push({
      id: `camp_${idx++}`, name: `${cap(layout.type)} Camp`,
      type: layout.type, x, y,
      guards: GUARD_COUNT[layout.type], spawnMs: SPAWN_MS[layout.type], buff: buff1,
    });
    camps.push({
      id: `camp_${idx++}`, name: `${cap(layout.type)} Camp`,
      type: layout.type, x: Math.round(mx), y: Math.round(my),
      guards: GUARD_COUNT[layout.type], spawnMs: SPAWN_MS[layout.type], buff: buff2,
    });
  }

  // ─── TROLL — single camp in the center of the map ───
  camps.push({
    id: `camp_${idx++}`, name: 'Troll Camp',
    type: 'troll', x: Math.round(cx + (rng() - 0.5) * 100), y: Math.round(cy + (rng() - 0.5) * 100),
    guards: GUARD_COUNT['troll'], spawnMs: SPAWN_MS['troll'],
    buff: { stat: 'all', value: 0.10 },
  });

  return camps;
}

function cap(s: string) { return s[0].toUpperCase() + s.slice(1); }

const CAMP_DEFS = makeCamps();

// ─── MAP-DRIVEN CAMP GENERATION ─────────────────────────────
// Creates CampDef[] from a MapDef by assigning random animals to fixed slots.

function makeCampsFromMap(mapDef: MapDef, seed: number): CampDef[] {
  const rng = seededRandom(seed);
  for (const k of Object.keys(usedNames)) delete usedNames[k];

  const GUARD_COUNT: Record<string, number> = {
    gnome: 1, turtle: 1, skull: 1, spider: 1, hyena: 1, rogue: 1,
    panda: 1, lizard: 1, minotaur: 1, shaman: 1, troll: 1,
  };
  const SPAWN_MS: Record<string, number> = {
    gnome: 4000, turtle: 4500, skull: 6000, spider: 6000, hyena: 5500, rogue: 5500,
    panda: 7500, lizard: 7500, minotaur: 10000, shaman: 10000, troll: 15000,
  };

  // Assign random animals to slots
  const animalAssignments = assignAnimalsToSlots(mapDef.campSlots, rng);

  const camps: CampDef[] = [];
  let idx = 0;

  for (let i = 0; i < mapDef.campSlots.length; i++) {
    const slot = mapDef.campSlots[i];
    const animalType = animalAssignments[i];
    const def = ANIMALS[animalType];
    if (!def) continue;

    const name1 = pickCampName(animalType, rng);
    const name2 = pickCampName(animalType, rng);
    const buff1 = { stat: 'attack', value: 0.05 + rng() * 0.05 };
    const buff2 = { stat: 'hp', value: 0.05 + rng() * 0.05 };

    camps.push({
      id: `camp_${idx++}`, name: `${cap(animalType)} Camp`,
      type: animalType, x: slot.bluePos.x, y: slot.bluePos.y,
      guards: GUARD_COUNT[animalType], spawnMs: SPAWN_MS[animalType], buff: buff1,
    });
    camps.push({
      id: `camp_${idx++}`, name: `${cap(animalType)} Camp`,
      type: animalType, x: slot.redPos.x, y: slot.redPos.y,
      guards: GUARD_COUNT[animalType], spawnMs: SPAWN_MS[animalType], buff: buff2,
    });
  }

  // Troll camp (center boss) if defined
  if (mapDef.trollSlot) {
    camps.push({
      id: `camp_${idx++}`, name: 'Troll Camp',
      type: 'troll', x: mapDef.trollSlot.x, y: mapDef.trollSlot.y,
      guards: GUARD_COUNT['troll'], spawnMs: SPAWN_MS['troll'],
      buff: { stat: 'all', value: 0.10 },
    });
  }

  return camps;
}
const NEXUS_MAX_HP = 50000;
const MAX_UNITS = Infinity; // no swarm limit
const BASE_SPAWN_MS = 5000; // (legacy, unused)
const FREE_GNOME_MS = 30000; // free gnome from base every 30s
const ATTACK_CD_MS = 1500;
const COMBAT_RANGE = 80;
const TURTLE_TAUNT_RANGE = 100; // turtles force nearby foes to attack them
const PROJECTILE_SPEED = 450;
const TOWER_HP = 3000;
const TOWER_DAMAGE = 900;
const TOWER_RANGE = 450;
const TOWER_SPLASH = 100;
const TOWER_COOLDOWN = 2500; // ms between shots
const TOWER_PROJ_SPEED = 350;
const NEXUS_DAMAGE = 350;
const NEXUS_RANGE = 350;
const NEXUS_SPLASH = 120;
const NEXUS_COOLDOWN = 2000;
const NEXUS_PROJ_SPEED = 400; // ranged projectile speed in pixels per second
const PROJECTILE_HIT_DIST = 18; // distance at which projectile hits target
const CAMP_RANGE = 120;
const AI_TICK_MS = 4000;
const TEAM_COLORS = { 1: 0x4499FF, 2: 0xFF5555 };
const FOG_VISION_RANGE = 400; // radius of vision around each ally unit
const FOG_STRUCTURE_VISION_RANGE = 650; // radius of vision around camps, towers, armories, nexus
const FOG_SCALE = 0.25; // downscale factor for fog RT (4x smaller)
const FOG_W = Math.ceil(WORLD_W * FOG_SCALE); // 1600
const FOG_H = Math.ceil(WORLD_H * FOG_SCALE); // 1600
const FOG_VISION_TILES_W = Math.ceil(WORLD_W / TILE_SIZE); // tile-resolution vision grid width
const FOG_VISION_TILES_H = Math.ceil(WORLD_H / TILE_SIZE); // tile-resolution vision grid height
const GOLDEN_ANGLE = 2.39996;

// ─── RESOURCE ECONOMY ──────────────────────────────────────
const SPAWN_COSTS: Record<string, { type: ResourceType; amount: number }> = {
  gnome:     { type: 'carrot',  amount: 2 },
  turtle:    { type: 'carrot',  amount: 5 },
  skull:     { type: 'meat',    amount: 5 },
  spider:    { type: 'meat',    amount: 5 },
  hyena:     { type: 'meat',    amount: 5 },
  panda:     { type: 'meat',    amount: 8 },
  lizard:    { type: 'meat',    amount: 8 },
  minotaur:  { type: 'crystal', amount: 12 },
  shaman:    { type: 'crystal', amount: 12 },
  troll:     { type: 'crystal', amount: 20 },
  rogue:     { type: 'meat',    amount: 5 },
};
const RESOURCE_EMOJI: Record<ResourceType, string> = { carrot: '🥕', meat: '🍖', crystal: '💎', metal: '⚙️' };

// ─── EQUIPMENT SYSTEM ──────────────────────────────────────
type EquipmentType = SharedEquipmentType;

interface EquipmentDef {
  id: EquipmentType;
  name: string;
  emoji: string;
  cost: Partial<Record<ResourceType, number>>;
  effect: string;
}

const MAX_EQUIP_LEVEL = 3;
const EQUIP_LEVEL_STAT_MULT = [0, 1.0, 1.5, 2.0]; // index = level
const EQUIP_LEVEL_COST_MULT = [0, 1.0, 2.0, 3.0]; // cost multiplier per level upgrade

const EQUIPMENT: EquipmentDef[] = [
  { id: 'pickaxe', name: 'Pickaxe', emoji: '⛏️', cost: { carrot: 15 }, effect: 'Can mine metal, +25% gather speed' },
  { id: 'sword',   name: 'Sword',   emoji: '⚔️', cost: { meat: 15, metal: 5 }, effect: '+50% attack, +25% attack speed' },
  { id: 'shield',  name: 'Shield',  emoji: '🛡️', cost: { meat: 15, metal: 5 }, effect: '+60% HP, -25% damage taken, -15% speed' },
  { id: 'boots',   name: 'Boots',   emoji: '👢', cost: { carrot: 12, metal: 4 }, effect: '+60% move speed, +50% pickup range' },
  { id: 'banner',  name: 'Banner',  emoji: '🚩', cost: { meat: 20, metal: 8 }, effect: 'Aura: nearby allies +20% atk, +15% speed' },
];

// ─── ADVANCED PLANS: prerequisite resolution ──────────────
const EQUIPMENT_PREREQS: Record<EquipmentType, EquipmentType[]> = {
  pickaxe: [],
  sword:   ['pickaxe'],
  shield:  ['pickaxe'],
  boots:   ['pickaxe'],
  banner:  ['pickaxe'],
};

const RESOURCE_GATHER_NEEDS: Record<ResourceType, { needsEquipment?: EquipmentType }> = {
  carrot:  {},
  meat:    {},
  crystal: {},
  metal:   { needsEquipment: 'pickaxe' },
};

interface PlanPhase {
  id: string;
  workflow: HWorkflow | null;        // null = instant phase (just fires onComplete)
  completionCheck: 'resource_threshold' | 'equipment_unlocked' | 'final';
  resourceTarget?: Partial<Record<ResourceType, number>>;
  equipTarget?: { type: EquipmentType; level: number };
  onComplete?: { unlock?: EquipmentType };
  label: string;
}

interface AdvancedPlan {
  id: string;
  phases: PlanPhase[];
  currentPhase: number;
  team: 1 | 2;
  subject: string;
  goalLabel: string;
  originalCommand: string;
  completed: boolean;
  finalWorkflow?: HWorkflow;
}

const ARMORY_RANGE = 110; // how close to armory to pick up equipment

interface HArmory {
  x: number;
  y: number;
  team: 1 | 2;
  equipmentType: EquipmentType; // which equipment this armory provides
  sprite: Phaser.GameObjects.Text | Phaser.GameObjects.Image | null;
  label: Phaser.GameObjects.Text | null;
}

const ARMORY_BUILDING: Record<string, string> = {
  pickaxe: 'house1',
  sword: 'barracks',
  shield: 'house3',
  boots: 'monastery',
  banner: 'archery',
};

const CARROT_SPAWN_MS = 3000;       // new carrots every 3s
const MAX_GROUND_ITEMS = 150;
const ITEM_DESPAWN_MS = 30000;      // ground items vanish after 30s
const PICKUP_RANGE = 35;
const DELIVER_RANGE = 100; // how close to base/camp to drop off resources
const WILD_ANIMAL_COUNT = 30;       // neutral roaming animals — concentrated in corners
const ELITE_PREY_COUNT = 3;         // golden elite prey (T4 stats, drop crystals)
const WILD_RESPAWN_MS = 20000;      // respawn wild animals every 20s
const MINE_COUNT = 4; // 2 per side, mirrored
const MINE_TICK_MS = 2000; // mine produces metal every 2s while a unit stands on it
const MINE_RANGE = 180; // how close to be "mining" — big mine area

function pdist(a: { x: number; y: number }, b: { x: number; y: number }): number {
  const dx = a.x - b.x, dy = a.y - b.y;
  return Math.sqrt(dx * dx + dy * dy);
}

function pdist2(a: { x: number; y: number }, b: { x: number; y: number }): number {
  const dx = a.x - b.x, dy = a.y - b.y;
  return dx * dx + dy * dy;
}

// ═══════════════════════════════════════════════════════════════
// SCENE
// ═══════════════════════════════════════════════════════════════

export class HordeScene extends Phaser.Scene {
  private units: HUnit[] = [];
  private camps: HCamp[] = [];
  private nexuses: HNexus[] = [];
  private towers: HTower[] = [];
  private mineNodes: HMineNode[] = [];
  private nextId = 0;
  private gameTime = 0;
  private gameOver = false;
  private winner: 1 | 2 | null = null;

  private baseSpawnTimers = { 1: 0, 2: 0 };
  private aiTimer = 0;

  // Resource economy
  private groundItems: HGroundItem[] = [];
  private nextItemId = 0;
  private carrotSpawnTimer = 0;
  private wildRespawnTimer = 0;
  private freeGnomeTimer = 0;
  private lastTurtleGuardSfx = 0;
  // Era progression — goal-based unlocks
  private currentEra = 1;
  private eliteKillCount = 0;
  private baseStockpile = {
    1: { carrot: 0, meat: 0, crystal: 0, metal: 0 },
    2: { carrot: 0, meat: 0, crystal: 0, metal: 0 },
  };
  private unlockedEquipment: Record<1 | 2, Map<EquipmentType, number>> = { 1: new Map(), 2: new Map() };
  private armories: HArmory[] = [];
  private equipPanelEl: HTMLDivElement | null = null;
  private sidebarEl: HTMLDivElement | null = null;

  private hudTexts: Record<string, Phaser.GameObjects.Text> = {};
  private textInput: HTMLInputElement | null = null;
  private voiceStatusEl: HTMLDivElement | null = null;

  // Command history tracking
  private commandHistory: { command: string; outcome: string; color: string; time: number }[] = [];
  private pendingCommandText: string | null = null;
  private pendingRemoteCommands: { text: string; team: 1 | 2; selectedHoard: string }[] = [];
  private pendingLocalCommands: { text: string; team: 1 | 2 }[] = [];
  private isProcessingCommand = false;
  // Last voice command per hoard type (shown on hoard bar cards)
  private lastHoardCommand: Record<string, string> = {};
  private lastHoardReaction: Record<string, string> = {};

  // Fog of war
  private fogRT: Phaser.GameObjects.RenderTexture | null = null;
  private fogBrush: Phaser.GameObjects.Image | null = null;
  private fogBrushLarge: Phaser.GameObjects.Image | null = null;
  private fogDisabled = false;

  // Stuck detection frame counter
  private stuckCheckCounter = 0;

  // Rock collision points — centers of rock clusters for pathfinding/collision
  private static readonly ROCK_RADIUS = 80; // collision radius — unified with ROCK_PATH_RADIUS so all systems agree
  private static readonly ROCK_PATH_RADIUS = 80; // wider radius for A* grid to give units clearance
  private rockCollisionPoints: { x: number; y: number }[] = [];
  private _staticBlockedGrid: Uint8Array | null = null;
  private _frameAvoidPenalty: Map<string, Float32Array> = new Map();
  private _avoidPenaltyPool: Float32Array[] = [];
  private _staticClearancePenalty: Float32Array | null = null;

  // Boundary blocks — invisible walls from map editor
  private boundaryBlocks: MapBoundaryBlock[] = [];

  // Bush zones (LoL-style brush) — flattened list of all bush rects for visibility checks
  private bushRects: { x: number; y: number; w: number; h: number }[] = [];
  private bushSpriteContainer: Phaser.GameObjects.Container | null = null;

  private arrowKeys!: Record<string, Phaser.Input.Keyboard.Key>;
  private adKeys!: Record<string, Phaser.Input.Keyboard.Key>;
  private spaceKey!: Phaser.Input.Keyboard.Key;
  private _speechMuted = false;
  private recognition: any = null;
  private isListening = false;
  private voiceAgent: ElevenLabsVoiceAgent | null = null;
  private voiceAgentReady = false; // true once ElevenLabs session is connected

  // Voice conversation system
  private ttsService: TtsService | null = null;
  private scribeService: ScribeService | null = null;
  private voiceOrb: VoiceOrb | null = null;
  private talkingPortrait: TalkingPortrait | null = null;

  private isDragging = false;
  private dragPrevX = 0;
  private dragPrevY = 0;
  private dragMoved = false; // did mouse move during this drag? (to distinguish click vs drag)

  // Debug: click a unit to inspect it
  private debugUnit: HUnit | null = null;
  private debugHighlight: Phaser.GameObjects.Arc | null = null;
  private debugPanelEl: HTMLDivElement | null = null;

  // Delayed damage: attack anim plays first, damage lands after 500ms
  private pendingHits: PendingHit[] = [];
  private readonly HIT_DELAY_MS = 500;

  // Persistent rally points: key = "type_team", value = {x, y}
  // When you command "gnomes attack skull camp", ALL future gnomes also go there
  private rallyPoints: Record<string, { x: number; y: number }> = {};
  // Active workflow per group — new spawns inherit this automatically
  private groupWorkflows: Record<string, HWorkflow> = {};
  private groupModifiers: Record<string, BehaviorMods> = {};
  // Advanced plans — multi-phase prerequisite chains resolved client-side
  private activePlans: AdvancedPlan[] = [];
  private activeSweeps: Record<string, {
    team: 1 | 2; subject: string;
    targets: { x: number; y: number; id: string }[]; currentIdx: number;
  }> = {};

  // Hoard selection: TAB cycles forward, Shift+TAB cycles back, number keys direct-pick
  private selectedHoard: string = 'all';
  // Cycle order: all → then only types the player currently has units of
  private allHoardTypes = ['all', 'gnome', 'turtle', 'skull', 'spider', 'hyena', 'panda', 'lizard', 'minotaur', 'shaman', 'troll'];
  private hoardKeys: Record<string, string> = {
    '1': 'all', '2': 'gnome', '3': 'skull', '4': 'panda', '5': 'minotaur', '6': 'troll',
    '7': 'turtle', '8': 'spider', '9': 'hyena', '0': 'lizard',
  };
  private selectionLabel: Phaser.GameObjects.Text | null = null;
  private hoardBarEl: HTMLDivElement | null = null;
  private cmdAvatarEl: HTMLDivElement | null = null;
  private charPanelEl: HTMLDivElement | null = null;
  private charPanelTab: 'horde' | 'armory' | 'commands' = 'horde';
  private _resizeHandler: (() => void) | null = null;

  // ─── NEW FLOATING OVERLAY PANELS ─────────────────────────────
  private topBarEl: HTMLDivElement | null = null;
  private resourcePanelEl: HTMLDivElement | null = null;
  private cmdLogPanelEl: HTMLDivElement | null = null;
  private minimapEl: HTMLCanvasElement | null = null;
  private minimapCtx: CanvasRenderingContext2D | null = null;
  private minimapTerrainCanvas: HTMLCanvasElement | null = null;

  // ─── NOTIFICATION SYSTEM ─────────────────────────────────────
  private notifContainerEl: HTMLDivElement | null = null;
  private notifEventStackEl: HTMLDivElement | null = null;
  private notifQueue: NotifItem[] = [];
  private activeNotifs: ActiveNotif[] = [];
  private eraBannerActive = false;
  private gameStartBannerShown = false;
  private introComplete = false;
  private introVeilEl: HTMLElement | null = null;

  // ─── SOUND ──────────────────────────────────────────────────
  private sfx!: SoundManager;

  // ─── MAP EVENTS ──────────────────────────────────────────────
  private mapEvents: MapEvent[] = [];
  private eventCycleTimer = 0;
  private eventCycleCount = 0;
  private lastEventType = '';
  private lastSoloSide: 'left' | 'right' = 'right'; // alternates — next will be 'left'
  private nextEventId = 0;
  private hungryBearBonusTeam: { team: 1 | 2; timer: number } | null = null;
  private eventBuffs: { team: 1 | 2; stat: 'attack' | 'speed'; value: number; timer: number }[] = [];

  // ─── THOUGHT BUBBLES ──────────────────────────────────────
  private thoughtBubbles: { container: Phaser.GameObjects.Container; unitId: number; timer: number }[] = [];

  // ─── CAMP LOOT DROPS ──────────────────────────────────────
  private teamBuffs: { team: 1 | 2; stat: 'speed' | 'attack'; amount: number; remaining: number }[] = [];

  // ─── MATCH STATS ──────────────────────────────────────────
  private matchStats = {
    unitsSpawned: { 1: 0, 2: 0 } as Record<1|2, number>,
    unitsLost: { 1: 0, 2: 0 } as Record<1|2, number>,
    totalKills: { 1: 0, 2: 0 } as Record<1|2, number>,
    totalDamage: { 1: 0, 2: 0 } as Record<1|2, number>,
    campsCaptured: { 1: 0, 2: 0 } as Record<1|2, number>,
    campsLost: { 1: 0, 2: 0 } as Record<1|2, number>,
    resourcesDelivered: {
      1: { carrot: 0, meat: 0, crystal: 0, metal: 0 },
      2: { carrot: 0, meat: 0, crystal: 0, metal: 0 },
    } as Record<1|2, Record<ResourceType, number>>,
    peakArmySize: { 1: 0, 2: 0 } as Record<1|2, number>,
  };
  private unitKillCounts = new Map<number, number>(); // unitId → kill count
  private topKiller: Record<1|2, { type: string; kills: number }> = {
    1: { type: '', kills: 0 }, 2: { type: '', kills: 0 },
  };

  // ─── QUEST SYSTEM ──────────────────────────────────────────
  private questManager: QuestManager | null = null;
  private questPanelEl: HTMLDivElement | null = null;
  private _questTowersDestroyed = { 1: 0, 2: 0 } as Record<1|2, number>;
  private _questEventsWon = { 1: 0, 2: 0 } as Record<1|2, number>;
  private _prevQuestHTML = '';

  // ─── MAP CONFIG ──────────────────────────────────────────────
  private mapDef: MapDef | null = null;
  private activeCampDefs: CampDef[] = CAMP_DEFS;

  // ─── EDITOR LIVE SYNC ──────────────────────────────────────
  private editorSyncChannel: BroadcastChannel | null = null;
  private editorSyncTimer = 0;
  private readonly EDITOR_SYNC_INTERVAL_MS = 500; // push state to editor ~2x/sec

  // ─── IN-GAME MAP EDITOR ──────────────────────────────────────
  private editorMode = false;
  private editorPanelEl: HTMLDivElement | null = null;
  private editorSelected: { type: 'camp' | 'mine' | 'armory' | 'nexus'; index: number } | null = null;
  private editorDragging = false;
  private editorDragOffsetX = 0;
  private editorDragOffsetY = 0;
  private editorHighlight: Phaser.GameObjects.Arc | null = null;
  private editorSaveTimeout: ReturnType<typeof setTimeout> | null = null;

  // ─── DEBUG MODE ──────────────────────────────────────────────
  private isDebug = false;
  private debugControlTeam: 1 | 2 = 1;
  private debugNeutralsEnabled = true;
  private debugModePanelEl: HTMLDivElement | null = null;
  private debugEventsSpawned = false;
  private debugHitboxes = false;
  private debugHitboxGfx: Phaser.GameObjects.Graphics | null = null;
  private debugBoundaryGfx: Phaser.GameObjects.Graphics | null = null;

  // ─── PERFORMANCE: spatial grid & path budget ───────────────
  private spatialGrid: Map<number, any[]> = new Map();
  private spatialCellSize = 200;
  // Walkability grid: O(1) tile lookup replacing per-rock distance checks
  private _walkableGrid: Uint8Array | null = null;
  private _walkGridCols = 0;
  private _walkGridRows = 0;
  // HUD dirty-flag caching (avoid innerHTML reflows every frame)
  private _prevResHTML = '';
  private _prevHoardHTML = '';
  private _prevProdHTML = '';
  private _prevEquipHTML = '';
  private _prevHordeTabHTML = '';
  private _prevCmdHTML = '';
  private _prevCampsHTML = '';
  private _prevModsHTML = '';
  private _prevBuffsHTML = '';
  private _hudTimerEl: HTMLElement | null = null;
  private _hudEraEl: HTMLElement | null = null;
  private _hudResourcesEl: HTMLElement | null = null;
  private _hudHoardTotalEl: HTMLElement | null = null;
  private _hudHoardListEl: HTMLElement | null = null;
  private _hudProductionEl: HTMLElement | null = null;
  private _hudCampsEl: HTMLElement | null = null;
  private _hudModifiersEl: HTMLElement | null = null;
  private _hudBuffsEl: HTMLElement | null = null;
  private pathQueue: Array<{unit: any, targetX: number, targetY: number, callback: (path: any) => void}> = [];
  // 4g: Ring buffer for frameTimes (avoids shift() O(n))
  private _frameTimesRing = new Float64Array(60);
  private _frameTimesIdx = 0;
  private _frameTimesCount = 0;
  private frameTimes: number[] = []; // kept for profiling snapshot compatibility
  private _frameCount = 0;
  private _unitById = new Map<number, HUnit>();
  private _groundItemById = new Map<number, HGroundItem>();
  private _pathsThisFrame = 0;
  private _spatialGrid: Map<number, HUnit[]> | null = null;
  private static readonly MAX_PATHS_PER_FRAME = 15; // 5c: increased from 10
  private _framePathCache = new Map<string, {x:number,y:number}[]|null>();
  // 4a: Bucket array pool for spatial grid
  private _bucketPool: HUnit[][] = [];
  // 4b: Round-robin pool for getNearbyFromGrid results
  private _nearbyResultPool: HUnit[][] = Array.from({ length: 8 }, () => []);
  private _nearbyPoolIdx = 0;
  // 2c: Ground item spatial grid
  private _groundItemGrid: Map<number, HGroundItem[]> | null = null;
  private _groundItemBucketPool: HGroundItem[][] = [];
  // 1b: Vision hash for skipping fog redraws
  private _lastVisionHash = 0;
  // 1c: Integer vision grid for O(1) fog visibility lookups
  private _visionGrid: Uint8Array | null = null;
  // 3b: Per-frame caches for equip buffs and banner aura
  private _equipBuffCache = new Map<number, { speed: number; attack: number; hp: number; damageTaken: number; atkSpeedMult: number; pickupRange: number; gatherSpeed: number }>();
  private _bannerAuraCache = new Map<number, { attack: number; speed: number }>();
  // 4f: Reusable formation groups map
  private _formationGroups = new Map<string, HUnit[]>();
  // 2d: Defended camps set (rebuilt each frame in updateMovement)
  private _defendedCamps = new Set<string>();
  private _astarBlocked = new Uint8Array(10000);
  private _astarGScore = new Float32Array(10000);
  private _astarFScore = new Float32Array(10000);
  private _astarCameFrom = new Int32Array(10000);
  private _astarClosed = new Uint8Array(10000);
  private _astarInOpen = new Uint8Array(10000);
  private _astarOccupied = new Uint8Array(10000);
  private _frameOccupiedReady = false;

  // ─── PROFILING ──────────────────────────────────────────────
  private _perfTimings: Record<string, number> = {};
  private memoryOverlay: MemoryOverlay | null = null;
  private profilingRecorder: ProfilingRecorder | null = null;

  // ─── MULTIPLAYER ──────────────────────────────────────────────
  private isOnline = false;
  private isHost = true; // host = runs simulation; guest = renders sync state
  private myTeam: 1 | 2 = 1;
  private gameId: string | null = null;
  private playerId: string | null = null;
  private firebase: FirebaseSync | null = null;
  private syncTimer = 0;
  private readonly SYNC_INTERVAL_MS = 150; // push state 6-7 times/sec

  constructor() {
    super({ key: 'HordeScene' });
  }

  /** Returns a snapshot of key metrics for the memory overlay / profiling tests. */
  getProfilingData(): ProfilingData {
    const aliveUnits = this.units.filter(u => !u.dead).length;
    return {
      unitCount: this.units.length,
      aliveUnits,
      units: this.units,
      spatialGridSize: this._spatialGrid ? this._spatialGrid.size * 80 + 64 : 0,
      nearbyCacheSize: this._nearbyCache.size * 80 + 64,
      framePathCacheSize: this._framePathCache.size * 80 + 64,
      avoidPenaltyCount: this._frameAvoidPenalty.size,
      avoidPoolCount: this._avoidPenaltyPool.length,
      groundItemCount: this.groundItems.filter(i => !i.dead).length,
      pendingHitCount: this.pendingHits.length,
      campCount: this.camps.length,
      towerCount: this.towers.length,
      fogEnabled: !this.fogDisabled,
      perfTimings: { ...this._perfTimings },
      frameTimes: this._getFrameTimesArray(),
      frameCount: this._frameCount,
      pathQueueLength: this.pathQueue.length,
    };
  }

  /** Extract frameTimes from ring buffer as a plain array */
  private _getFrameTimesArray(): number[] {
    const count = this._frameTimesCount;
    const arr: number[] = new Array(count);
    const start = count < 60 ? 0 : this._frameTimesIdx;
    for (let i = 0; i < count; i++) {
      arr[i] = this._frameTimesRing[(start + i) % 60];
    }
    return arr;
  }

  // Editor-saved maps loaded from server file
  private static editorMaps: MapDef[] | null = null;

  /** Synchronous load — tries localStorage (editor's live data) first, then server file */
  private static loadEditorMapsSync(): void {
    // 1. Try localStorage — the HTML editor saves here on every change
    try {
      const raw = localStorage.getItem('pb_horde-editor-maps');
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed) && parsed.length > 0) {
          // Convert editor fields: _tiles → tiles, drop legacy _terrain
          HordeScene.editorMaps = parsed.map((m: any) => {
            const clone = { ...m };
            if (clone._tiles && !clone.tiles) {
              clone.tiles = clone._tiles;
            }
            delete clone._tiles;
            delete clone._terrain;
            delete clone.terrain;
            return clone;
          });
          console.log('[Horde] Loaded', parsed.length, 'maps from localStorage:', parsed.map((m: any) => m.id).join(', '));
          // Log first map's camp positions for debugging
          const def = HordeScene.editorMaps.find((m: any) => m.id === 'default');
          if (def) {
            console.log('[Horde] default map camps:', def.campSlots.length, 'p1Base:', def.p1Base, 'p2Base:', def.p2Base);
            console.log('[Horde] camp[0]:', def.campSlots[0]?.bluePos, def.campSlots[0]?.redPos);
          }
          return;
        }
      }
    } catch (e) {
      console.warn('[Horde] localStorage parse failed:', e);
    }

    // 2. Fallback: server file
    try {
      const xhr = new XMLHttpRequest();
      xhr.open('GET', '/__save_horde_maps', false); // synchronous
      xhr.send();
      console.log('[Horde] Server file XHR status:', xhr.status, 'size:', xhr.responseText?.length);
      if (xhr.status === 200) {
        const parsed = JSON.parse(xhr.responseText);
        if (Array.isArray(parsed) && parsed.length > 0) {
          HordeScene.editorMaps = parsed;
          console.log('[Horde] Loaded', parsed.length, 'maps from server file:', parsed.map((m: any) => m.id).join(', '));
          return;
        }
      }
    } catch (e) {
      console.warn('[Horde] Server file load failed:', e);
    }
    // 3. Fallback: bundled horde-maps.json (baked into build)
    if (bundledHordeMaps && Array.isArray(bundledHordeMaps) && bundledHordeMaps.length > 0) {
      HordeScene.editorMaps = (bundledHordeMaps as any[]).map((m: any) => {
        const clone = { ...m };
        if (clone._tiles && !clone.tiles) clone.tiles = clone._tiles;
        delete clone._tiles;
        delete clone._terrain;
        delete clone.terrain;
        return clone;
      });
      console.log('[Horde] Loaded', bundledHordeMaps.length, 'maps from bundled JSON');
      return;
    }
    HordeScene.editorMaps = null;
  }

  private static getEditorMap(id: string): MapDef | null {
    if (!HordeScene.editorMaps) return null;
    return HordeScene.editorMaps.find((m: MapDef) => m.id === id) || null;
  }

  init(data?: HordeSceneData) {
    this.isOnline = data?.isOnline || false;
    this.gameId = data?.gameId || null;
    this.playerId = data?.playerId || null;
    // Player 1 (host) = team 1 (bottom-left), Player 2 (guest) = team 2 (top-right)
    this.isHost = data?.amPlayer1 !== false; // default host if solo
    this.myTeam = this.isHost ? 1 : 2;
    this.isDebug = data?.isDebug || false;
    if (this.isDebug) this.fogDisabled = true;

    // Map selection: direct mapDef from editor, or editor-saved file, or hardcoded, or default
    if (data?.mapDef) {
      // Direct map definition from editor live sync restart
      this.mapDef = data.mapDef;
      const seed = Date.now();
      this.activeCampDefs = makeCampsFromMap(this.mapDef, seed);
    } else {
      // Always re-fetch editor maps from server (synchronous) to pick up latest edits
      HordeScene.loadEditorMapsSync();
      const mapId = this.isOnline ? 'default' : (data?.mapId || 'default');
      const editorMap = HordeScene.getEditorMap(mapId);
      const resolvedMap = editorMap || getMapById(mapId);
      this.mapDef = resolvedMap;
      const seed = Date.now();
      this.activeCampDefs = makeCampsFromMap(this.mapDef, seed);
      console.log('[Horde] Map resolution:', mapId, editorMap ? 'FROM EDITOR FILE' : 'FROM HARDCODED',
        '— camps:', resolvedMap.campSlots.length, 'mines:', resolvedMap.mineSlots?.length || 0);
      // Log positions so we can verify they match the editor
      for (let i = 0; i < resolvedMap.campSlots.length; i++) {
        const s = resolvedMap.campSlots[i];
        console.log(`[Horde]   camp[${i}] T${s.tier} blue=(${s.bluePos.x},${s.bluePos.y}) red=(${s.redPos.x},${s.redPos.y})`);
      }
      console.log('[Horde]   troll:', resolvedMap.trollSlot);
      console.log('[Horde]   p1Base:', resolvedMap.p1Base, 'p2Base:', resolvedMap.p2Base);
      // Log generated camp defs (after animal assignment)
      console.log('[Horde] Generated camps:');
      for (const c of this.activeCampDefs) {
        console.log(`[Horde]   ${c.id} ${c.type} at (${c.x},${c.y})`);
      }
    }
  }

  create() {
    // Smooth fade-in from menu transition
    this.cameras.main.fadeIn(600, 15, 26, 10);

    // ─── Init Sound Manager ──────────────────────────────────
    this.sfx = new SoundManager(this);
    this.sfx.init();

    this.units = [];
    this.camps = [];
    this.nexuses = [];
    this.nextId = 0;
    this.gameTime = 0;
    this.gameOver = false;
    this.winner = null;
    this.baseSpawnTimers = { 1: 0, 2: 0 };
    this.aiTimer = 0;
    this.hudTexts = {};
    this.rallyPoints = {};
    this.activeSweeps = {};
    this.groupModifiers = {};
    this.selectedHoard = 'all';
    this.groundItems = [];
    this.nextItemId = 0;
    this.carrotSpawnTimer = 0;
    this.wildRespawnTimer = 0;
    this.freeGnomeTimer = 0;
    this.mapEvents = [];
    this.eventCycleTimer = 0;
    this.eventCycleCount = 0;
    this.lastEventType = '';
    this.nextEventId = 0;
    this.hungryBearBonusTeam = null;
    this.eventBuffs = [];
    this.currentEra = 1;
    this.eliteKillCount = 0;
    this.gameStartBannerShown = false;
    this.introComplete = false;
    // Create persistent dark veil that stays until intro is done
    const veil = document.createElement('div');
    veil.id = 'horde-intro-veil';
    veil.style.cssText = 'position:fixed;top:0;left:0;width:100vw;height:100vh;z-index:9998;background:rgba(0,0,0,0.88);pointer-events:none;';
    (document.getElementById('game-container') ?? document.body).appendChild(veil);
    this.introVeilEl = veil;
    this.baseStockpile = {
      1: { carrot: 0, meat: 0, crystal: 0, metal: 0 },
      2: { carrot: 0, meat: 0, crystal: 0, metal: 0 },
    };
    this.unlockedEquipment = { 1: new Map(), 2: new Map() };
    this.debugControlTeam = 1;
    this.debugNeutralsEnabled = true;
    this.debugEventsSpawned = false;

    this.syncTimer = 0;

    this.cameras.main.setBackgroundColor('#1a1a2e');
    this.drawBackground();
    this.setupCamps();
    this.initMineNodes();
    this.initArmories();
    this.setupNexuses();
    this.setupTowers();
    this.setupFog();
    this.setupCamera();
    this.setupInput();
    this.setupHUD();
    this.events.on('shutdown', () => this.cleanupHTML());
    if (this.isDebug) this.setupDebugModePanel();

    // Memory profiling overlay (Ctrl+M)
    this.memoryOverlay = new MemoryOverlay(this);
    this.input.keyboard!.on('keydown-M', (e: KeyboardEvent) => {
      if (e.ctrlKey) this.memoryOverlay?.toggle();
    });

    // Performance recorder (F9) — records whole game, generates report
    this.profilingRecorder = new ProfilingRecorder(this);
    this.input.keyboard!.on('keydown-F9', () => {
      this.profilingRecorder?.toggle();
    });

    // Set custom pixel art cursor
    this.input.setDefaultCursor('url(assets/ui/cursors/Cursor_01.png) 0 0, auto');

    // Pre-capture T1 camps (gnome + turtle) for each team at game start
    if (!this.isOnline || this.isHost) {
      for (const animalType of ['gnome', 'turtle']) {
        const campsOfType = this.camps.filter(c => c.animalType === animalType);
        const p1Camp = campsOfType.slice().sort((a, b) => pdist2(a, P1_BASE) - pdist2(b, P1_BASE))[0];
        const p2Camp = campsOfType.filter(c => c !== p1Camp).sort((a, b) => pdist2(a, P2_BASE) - pdist2(b, P2_BASE))[0];
        if (p1Camp) {
          p1Camp.owner = 1;
          this.units = this.units.filter(u => u.campId !== p1Camp.id);
        }
        if (p2Camp) {
          p2Camp.owner = 2;
          this.units = this.units.filter(u => u.campId !== p2Camp.id);
        }
      }

      // Starting gnomes
      for (let i = 0; i < 3; i++) {
        this.spawnUnit('gnome', 1, P1_BASE.x + 50 + i * 20, P1_BASE.y - 50);
        this.spawnUnit('gnome', 2, P2_BASE.x - 50 - i * 20, P2_BASE.y + 50);
      }
    }

    // ─── EDITOR LIVE SYNC ───
    this.setupEditorSync();

    // ─── ONLINE SETUP ───
    if (this.isOnline && this.gameId) {
      this.firebase = FirebaseSync.getInstance();
      if (this.isHost) {
        // Host: listen for guest commands
        this.firebase.onRemoteOrders(this.gameId, (data) => {
          if (data.orders) {
            for (const entry of data.orders) {
              const cmd = (entry as any).order || entry;
              if (cmd.text && cmd.team) {
                this.pendingRemoteCommands.push({
                  text: cmd.text,
                  team: cmd.team as 1 | 2,
                  selectedHoard: cmd.selectedHoard || 'all',
                });
              }
            }
          }
          if (this.gameId) this.firebase!.removeRemoteOrder(this.gameId, data.key);
        });
      } else {
        // Guest: listen for sync state from host
        this.firebase.onSyncState(this.gameId, (state: any) => {
          this.applyGuestSync(state as HordeSyncState);
        });
      }
    }
  }

  // ─── BACKGROUND ──────────────────────────────────────────────

  private drawBackground() {
    // Solid clean grass field (base layer, below tile grid)
    const bgFill = this.add.graphics();
    bgFill.fillStyle(0x1e3a14, 1);
    bgFill.fillRect(0, 0, WORLD_W, WORLD_H);

    // Subtle lighter patches for depth
    const patches = [
      { x: 400, y: 400, w: 800, h: 600 },
      { x: 1800, y: 200, w: 700, h: 500 },
      { x: 100, y: 1600, w: 600, h: 700 },
      { x: 2200, y: 1400, w: 800, h: 600 },
      { x: 1200, y: 800, w: 900, h: 700 },
      { x: 600, y: 2400, w: 700, h: 500 },
      { x: 2400, y: 2500, w: 600, h: 500 },
    ];
    for (const p of patches) {
      bgFill.fillStyle(0x254a1a, 0.25);
      bgFill.fillRoundedRect(p.x, p.y, p.w, p.h, 80);
    }

    // Thin border around the play area
    bgFill.lineStyle(3, 0x122e0e, 0.5);
    bgFill.strokeRect(0, 0, WORLD_W, WORLD_H);
    bgFill.setDepth(0);

    // ─── TILE GRID FROM EDITOR ──────────────────────────
    this.drawTileGrid();

    // ─── GRASS TINT OVERLAY ─────────────────────────────
    this.drawGrassTintOverlay();

    // ─── RENDER ROCKS (decorative, from map data) ──────
    this.renderMapRocks();

    // ─── RENDER BUSHES (LoL-style brush zones) ─────────
    this.renderMapBushes();

    // ─── LOAD BOUNDARY BLOCKS ────────────────────────────
    this.boundaryBlocks = this.mapDef?.boundaryBlocks || [];

    // ─── RENDER MAP TOWERS (from towerSlots) ───────────
    this.renderMapTowers();

    // Very faint base territory indicators — soft circles, not harsh rings
    const g = this.add.graphics();
    g.fillStyle(0x4499FF, 0.04);
    g.fillCircle(P1_BASE.x, P1_BASE.y, 500);
    g.fillStyle(0xFF5555, 0.04);
    g.fillCircle(P2_BASE.x, P2_BASE.y, 500);
    g.setDepth(2);
  }

  // ─── TILE GRID STATE ──────────────────────────────────────
  private resolvedTiles: ResolvedTile[][] | null = null;
  private tileGridSprites: Phaser.GameObjects.Container | null = null;

  private drawTileGrid() {
    // Clean up previous tile grid container if re-drawing
    if (this.tileGridSprites) {
      this.tileGridSprites.destroy(true);
      this.tileGridSprites = null;
    }

    const tiles = this.mapDef?.tiles;
    if (!tiles || tiles.length === 0) {
      console.log('[Horde] No tile grid data to render');
      return;
    }

    const rows = tiles.length;
    const cols = tiles[0].length;
    console.log('[Horde] Rendering tile grid:', rows, 'x', cols);

    // Resolve auto-tiling
    this.resolvedTiles = resolveGrid(tiles);

    // Determine tileset key
    const colorVariant = this.mapDef?.tilesetColor || 4;
    const tilesetKey = `ts_tileset_color${colorVariant}`;
    const tilesetTex = this.textures.get(tilesetKey);
    if (!tilesetTex || tilesetTex.key === '__MISSING') {
      console.warn('[Horde] Tileset texture not found:', tilesetKey);
      return;
    }

    const container = this.add.container(0, 0);
    container.setDepth(1);
    this.tileGridSprites = container;

    const source = tilesetTex.getSourceImage() as HTMLImageElement;

    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const resolved = this.resolvedTiles[r][c];
        const wx = c * TILE_SIZE;
        const wy = r * TILE_SIZE;

        if (resolved.terrain === 2) {
          // Water: solid color fill
          const waterRect = this.add.rectangle(wx + TILE_SIZE / 2, wy + TILE_SIZE / 2, TILE_SIZE, TILE_SIZE, WATER_COLOR_HEX, 1);
          container.add(waterRect);
        } else {
          // Ground, high_ground, or rock: draw tileset sprite
          // For rock tiles (3), render as grass (0) underneath
          const tileTerrain = (resolved.terrain === 3 ? 0 : resolved.terrain) as 0 | 1 | 2;
          const src = getTileSourceRect(tileTerrain, resolved.role);

          // Create a canvas texture for this tile
          const key = `tile_r${r}_c${c}`;
          if (this.textures.exists(key)) this.textures.remove(key);
          const canvasTex = this.textures.createCanvas(key, TILE_SIZE, TILE_SIZE);
          if (canvasTex) {
            const ctx2d = canvasTex.getContext();
            ctx2d.drawImage(source, src.x, src.y, src.w, src.h, 0, 0, TILE_SIZE, TILE_SIZE);

            // Draw inner corners overlay if multiple
            if (resolved.innerCorners > 0 && resolved.role === 'CENTER') {
              const innerRoles = [
                { bit: 1, role: 'INNER_NW' as const },
                { bit: 2, role: 'INNER_NE' as const },
                { bit: 4, role: 'INNER_SW' as const },
                { bit: 8, role: 'INNER_SE' as const },
              ];
              for (const ir of innerRoles) {
                if (resolved.innerCorners & ir.bit) {
                  const irSrc = getTileSourceRect(tileTerrain, ir.role);
                  ctx2d.drawImage(source, irSrc.x, irSrc.y, irSrc.w, irSrc.h, 0, 0, TILE_SIZE, TILE_SIZE);
                }
              }
            }

            canvasTex.refresh();
            const sprite = this.add.image(wx + TILE_SIZE / 2, wy + TILE_SIZE / 2, key);
            container.add(sprite);
          }

          // Rock overlay for rock tiles (terrain === 3)
          if (resolved.terrain === 3) {
            const rockVariant = ((r * 7 + c * 13 + r * c) & 0xFFFF) % 4;
            const rockKey = `ts_rock${rockVariant + 1}`;
            if (this.textures.exists(rockKey)) {
              const rockSprite = this.add.image(wx + TILE_SIZE / 2, wy + TILE_SIZE / 2, rockKey);
              rockSprite.setDisplaySize(TILE_SIZE, TILE_SIZE);
              container.add(rockSprite);
            }
          }

          // Cliff face below high ground edges
          if (resolved.cliffBelow) {
            const cliffSrc = getCliffSourceRect();
            const cliffKey = `cliff_r${r}_c${c}`;
            if (this.textures.exists(cliffKey)) this.textures.remove(cliffKey);
            const cliffTex = this.textures.createCanvas(cliffKey, TILE_SIZE, TILE_SIZE);
            if (cliffTex) {
              const ctx2d = cliffTex.getContext();
              ctx2d.drawImage(source, cliffSrc.x, cliffSrc.y, cliffSrc.w, cliffSrc.h, 0, 0, TILE_SIZE, TILE_SIZE);
              cliffTex.refresh();
              const cliffSprite = this.add.image(wx + TILE_SIZE / 2, wy + TILE_SIZE / 2, cliffKey);
              cliffSprite.setAlpha(0.6);
              container.add(cliffSprite);
            }
          }

          // Ramp indicator (subtle tint)
          if (resolved.isRamp) {
            const rampRect = this.add.rectangle(wx + TILE_SIZE / 2, wy + TILE_SIZE / 2, TILE_SIZE, TILE_SIZE, 0xffff88, 0.08);
            container.add(rampRect);
          }
        }
      }
    }

    // ── Manual ground layer tiles ──
    const groundLayer = this.mapDef?.groundLayer;
    if (groundLayer) {
      const gRows = groundLayer.length;
      const gCols = gRows > 0 ? groundLayer[0].length : 0;
      for (let r = 0; r < gRows; r++) {
        for (let c = 0; c < gCols; c++) {
          const tileIdx = groundLayer[r][c];
          if (tileIdx == null) continue;
          const srcCol = tileIdx % 9;
          const srcRow = Math.floor(tileIdx / 9);
          const wx = c * TILE_SIZE;
          const wy = r * TILE_SIZE;
          const key = `manual_g_r${r}_c${c}`;
          if (this.textures.exists(key)) this.textures.remove(key);
          const canvasTex = this.textures.createCanvas(key, TILE_SIZE, TILE_SIZE);
          if (canvasTex) {
            const ctx2d = canvasTex.getContext();
            ctx2d.drawImage(source, srcCol * 64, srcRow * 64, 64, 64, 0, 0, TILE_SIZE, TILE_SIZE);
            canvasTex.refresh();
            const sprite = this.add.image(wx + TILE_SIZE / 2, wy + TILE_SIZE / 2, key);
            container.add(sprite);
          }
        }
      }
    }

    // ── Manual high ground layer tiles ──
    const highLayer = this.mapDef?.highLayer;
    if (highLayer) {
      const hRows = highLayer.length;
      const hCols = hRows > 0 ? highLayer[0].length : 0;
      for (let r = 0; r < hRows; r++) {
        for (let c = 0; c < hCols; c++) {
          const tileIdx = highLayer[r][c];
          if (tileIdx == null) continue;
          const srcCol = tileIdx % 9;
          const srcRow = Math.floor(tileIdx / 9);
          const wx = c * TILE_SIZE;
          const wy = r * TILE_SIZE;
          const key = `manual_h_r${r}_c${c}`;
          if (this.textures.exists(key)) this.textures.remove(key);
          const canvasTex = this.textures.createCanvas(key, TILE_SIZE, TILE_SIZE);
          if (canvasTex) {
            const ctx2d = canvasTex.getContext();
            ctx2d.drawImage(source, srcCol * 64, srcRow * 64, 64, 64, 0, 0, TILE_SIZE, TILE_SIZE);
            canvasTex.refresh();
            const sprite = this.add.image(wx + TILE_SIZE / 2, wy + TILE_SIZE / 2, key);
            container.add(sprite);
          }
        }
      }
    }
  }

  private drawGrassTintOverlay() {
    const grassTint = (this.mapDef as any)?.grassTint;
    if (!grassTint || grassTint.length === 0) return;

    const TINT_COLORS: Record<number, { color: number; alpha: number }> = {
      1: { color: 0x78b43c, alpha: 0.25 },  // light
      2: { color: 0x143c0a, alpha: 0.3 },   // dark
      3: { color: 0xa09628, alpha: 0.2 },   // yellow
      4: { color: 0x78501e, alpha: 0.25 },  // brown
      5: { color: 0x286450, alpha: 0.2 },   // damp
    };

    const tintGfx = this.add.graphics();
    const rows = grassTint.length;
    const cols = rows > 0 ? grassTint[0].length : 0;

    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const tintIdx = grassTint[r][c];
        if (!tintIdx) continue;
        const tintDef = TINT_COLORS[tintIdx];
        if (!tintDef) continue;
        tintGfx.fillStyle(tintDef.color, tintDef.alpha);
        tintGfx.fillRect(c * TILE_SIZE, r * TILE_SIZE, TILE_SIZE, TILE_SIZE);
      }
    }
    tintGfx.setDepth(1.5);
  }

  /** Get elevation at world position: 0=normal/water, 1=high_ground */
  private getElevation(worldX: number, worldY: number): number {
    const tiles = this.mapDef?.tiles;
    if (!tiles) return 0;
    const col = Math.floor(worldX / TILE_SIZE);
    const row = Math.floor(worldY / TILE_SIZE);
    if (row < 0 || row >= tiles.length || col < 0 || col >= tiles[0].length) return 0;
    return tiles[row][col] === 1 ? 1 : 0;
  }

  /** Check if a tile is walkable (not water, not inside a rock cluster) */
  private isTileWalkable(worldX: number, worldY: number): boolean {
    // Fast path: O(1) grid lookup when walkability grid is built
    if (this._walkableGrid) {
      const col = Math.floor(worldX / TILE_SIZE);
      const row = Math.floor(worldY / TILE_SIZE);
      if (row < 0 || row >= this._walkGridRows || col < 0 || col >= this._walkGridCols) return true;
      return this._walkableGrid[row * this._walkGridCols + col] === 0;
    }
    // Fallback: original logic before grid is built
    const tiles = this.mapDef?.tiles;
    if (tiles) {
      const col = Math.floor(worldX / TILE_SIZE);
      const row = Math.floor(worldY / TILE_SIZE);
      if (row >= 0 && row < tiles.length && col >= 0 && col < tiles[0].length) {
        const v = tiles[row][col];
        if (v === 2 || v === 3) return false; // water + rock
      }
    }
    return true;
  }

  private scatterDecorations(rand: () => number) {
    // Avoidance zones: bases and center corridor
    const avoidZones: Array<{x: number; y: number; r: number}> = [
      { x: P1_BASE.x, y: P1_BASE.y, r: 400 },
      { x: P2_BASE.x, y: P2_BASE.y, r: 400 },
      { x: WORLD_W / 2, y: WORLD_H / 2, r: 200 },
    ];

    const isClear = (px: number, py: number, minDist: number) => {
      for (const z of avoidZones) {
        const dx = px - z.x, dy = py - z.y;
        if (dx * dx + dy * dy < (z.r + minDist) * (z.r + minDist)) return false;
      }
      return px > 60 && px < WORLD_W - 60 && py > 60 && py < WORLD_H - 60;
    };

    const place = (count: number, minDist: number, fn: (x: number, y: number) => void) => {
      let placed = 0, attempts = 0;
      while (placed < count && attempts < count * 5) {
        attempts++;
        const px = rand() * WORLD_W;
        const py = rand() * WORLD_H;
        if (isClear(px, py, minDist)) { fn(px, py); placed++; }
      }
    };

    // Trees
    place(30, 60, (x, y) => {
      const v = Math.floor(rand() * 4) + 1;
      if (this.textures.exists(`ts_tree${v}`)) {
        this.add.image(x, y, `ts_tree${v}`, 0).setDepth(5).setScale(0.4 + rand() * 0.15);
      } else {
        const key = `ts_terrain_tree${v}`;
        if (this.textures.exists(key)) this.add.image(x, y, key).setDepth(5).setScale(0.4);
      }
    });

    // Rocks
    place(60, 30, (x, y) => {
      const v = Math.floor(rand() * 4) + 1;
      const key = `ts_rock${v}`;
      if (this.textures.exists(key)) {
        this.add.image(x, y, key).setDepth(3).setScale(0.5 + rand() * 0.3);
      }
    });
  }

  // ─── MAP ROCKS ──────────────────────────────────────────────

  private renderMapRocks() {
    const rocks = this.mapDef?.rockPositions;
    if (!rocks || rocks.length === 0) return;

    // Cache collision centers for pathfinding and movement blocking
    this.rockCollisionPoints = [];
    for (const rock of rocks) {
      this.rockCollisionPoints.push({ x: rock.bluePos.x, y: rock.bluePos.y });
      this.rockCollisionPoints.push({ x: rock.redPos.x, y: rock.redPos.y });
    }

    // Dense rock cluster at each position — looks like impassable rocky terrain
    const clusterOffsets = [
      { dx: 0, dy: 0, s: 72 },
      { dx: -30, dy: -20, s: 56 },
      { dx: 28, dy: -18, s: 52 },
      { dx: -32, dy: 16, s: 50 },
      { dx: 26, dy: 22, s: 54 },
      { dx: -8, dy: -34, s: 44 },
      { dx: -6, dy: 30, s: 46 },
      { dx: -40, dy: -2, s: 40 },
      { dx: 38, dy: 2, s: 42 },
      { dx: 14, dy: -30, s: 38 },
      { dx: -18, dy: 28, s: 36 },
    ];

    for (let ri = 0; ri < rocks.length; ri++) {
      const rock = rocks[ri];
      for (let ci = 0; ci < clusterOffsets.length; ci++) {
        const off = clusterOffsets[ci];
        const v = ((ri * 7 + ci * 3 + 1) % 4) + 1;
        const key = `ts_rock${v}`;
        if (!this.textures.exists(key)) continue;

        this.add.image(rock.bluePos.x + off.dx, rock.bluePos.y + off.dy, key)
          .setDepth(6).setDisplaySize(off.s, off.s).setAlpha(0.95);
        this.add.image(rock.redPos.x + off.dx, rock.redPos.y + off.dy, key)
          .setDepth(6).setDisplaySize(off.s, off.s).setAlpha(0.95);
      }
    }

    // Pre-compute static blocked grid (water + rocks) for A* — never changes after this point
    const CELL = HordeScene.PATH_CELL;
    const G = HordeScene.PATH_GRID;
    const staticBlocked = new Uint8Array(G * G);
    const tiles = this.mapDef?.tiles;
    if (tiles) {
      for (let gy = 0; gy < G && gy < tiles.length; gy++) {
        for (let gx = 0; gx < G && gx < tiles[0].length; gx++) {
          if (tiles[gy][gx] === 2 || tiles[gy][gx] === 3) staticBlocked[gy * G + gx] = 1;
        }
      }
    }
    // Stamp boundary blocks onto static A* grid
    const boundaries = this.mapDef?.boundaryBlocks || [];
    for (const b of boundaries) {
      const minGX = Math.floor(b.x / CELL);
      const maxGX = Math.ceil((b.x + b.w) / CELL);
      const minGY = Math.floor(b.y / CELL);
      const maxGY = Math.ceil((b.y + b.h) / CELL);
      for (let gy = minGY; gy < maxGY; gy++) {
        for (let gx = minGX; gx < maxGX; gx++) {
          if (gx >= 0 && gx < G && gy >= 0 && gy < G) staticBlocked[gy * G + gx] = 1;
        }
      }
    }
    // Stamp rock collision points onto static A* grid
    const rockR = HordeScene.ROCK_PATH_RADIUS;
    const rockCells = Math.ceil(rockR / CELL);
    for (const rp of this.rockCollisionPoints) {
      const rcx = Math.floor(rp.x / CELL);
      const rcy = Math.floor(rp.y / CELL);
      for (let ry = rcy - rockCells; ry <= rcy + rockCells; ry++) {
        for (let rx = rcx - rockCells; rx <= rcx + rockCells; rx++) {
          if (rx >= 0 && rx < G && ry >= 0 && ry < G) {
            const dx = (rx + 0.5) * CELL - rp.x;
            const dy = (ry + 0.5) * CELL - rp.y;
            if (dx * dx + dy * dy <= rockR * rockR) {
              staticBlocked[ry * G + rx] = 1;
            }
          }
        }
      }
    }
    this._staticBlockedGrid = staticBlocked;

    // Precompute clearance penalty (distance-to-wall cost) — only depends on static grid
    const staticClearance = new Float32Array(G * G);
    for (let cy2 = 0; cy2 < G; cy2++) {
      for (let cx2 = 0; cx2 < G; cx2++) {
        const idx = cy2 * G + cx2;
        if (staticBlocked[idx]) continue;
        let pen = 0;
        for (let pdy = -1; pdy <= 1; pdy++) {
          for (let pdx = -1; pdx <= 1; pdx++) {
            if (pdx === 0 && pdy === 0) continue;
            const px = cx2 + pdx, py = cy2 + pdy;
            if (px >= 0 && px < G && py >= 0 && py < G && staticBlocked[py * G + px]) pen += 0.5;
          }
        }
        staticClearance[idx] = pen;
      }
    }
    this._staticClearancePenalty = staticClearance;

    // Build walkability grid for O(1) isTileWalkable() lookups
    if (tiles && tiles.length > 0) {
      const rows = tiles.length;
      const cols = tiles[0].length;
      const grid = new Uint8Array(rows * cols); // 0 = walkable, 1 = blocked
      // Mark water (2) and rock (3) tiles as blocked
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          const v = tiles[r][c];
          if (v === 2 || v === 3) grid[r * cols + c] = 1;
        }
      }
      // Stamp boundary blocks onto walkability grid
      for (const b of boundaries) {
        const minC = Math.floor(b.x / TILE_SIZE);
        const maxC = Math.ceil((b.x + b.w) / TILE_SIZE);
        const minR = Math.floor(b.y / TILE_SIZE);
        const maxR = Math.ceil((b.y + b.h) / TILE_SIZE);
        for (let r = minR; r < maxR; r++) {
          for (let c = minC; c < maxC; c++) {
            if (r >= 0 && r < rows && c >= 0 && c < cols) grid[r * cols + c] = 1;
          }
        }
      }
      // Stamp rock collision points onto walkability grid
      const walkRockR = HordeScene.ROCK_RADIUS;
      const walkRockTiles = Math.ceil(walkRockR / TILE_SIZE);
      for (const rp of this.rockCollisionPoints) {
        const rc = Math.floor(rp.x / TILE_SIZE);
        const rr = Math.floor(rp.y / TILE_SIZE);
        for (let r = rr - walkRockTiles; r <= rr + walkRockTiles; r++) {
          for (let c = rc - walkRockTiles; c <= rc + walkRockTiles; c++) {
            if (r >= 0 && r < rows && c >= 0 && c < cols) {
              const dx = (c + 0.5) * TILE_SIZE - rp.x;
              const dy = (r + 0.5) * TILE_SIZE - rp.y;
              if (dx * dx + dy * dy <= walkRockR * walkRockR) {
                grid[r * cols + c] = 1;
              }
            }
          }
        }
      }
      this._walkableGrid = grid;
      this._walkGridCols = cols;
      this._walkGridRows = rows;
    }
  }

  // ─── MAP BUSHES (LoL-style brush) ─────────────────────────

  private renderMapBushes() {
    const zones = this.mapDef?.bushZones;
    if (!zones || zones.length === 0) return;

    // Build flattened rect list for visibility checks
    this.bushRects = [];
    for (const bz of zones) {
      this.bushRects.push(bz.blueZone);
      this.bushRects.push(bz.redZone);
    }

    // Clean up previous container
    if (this.bushSpriteContainer) {
      this.bushSpriteContainer.destroy(true);
      this.bushSpriteContainer = null;
    }

    const container = this.add.container(0, 0);
    container.setDepth(4); // above ground, below units
    this.bushSpriteContainer = container;

    for (const rect of this.bushRects) {
      // Semi-transparent green base zone
      const baseGfx = this.add.graphics();
      baseGfx.fillStyle(0x1e6414, 0.3);
      baseGfx.fillRoundedRect(rect.x, rect.y, rect.w, rect.h, 8);
      baseGfx.lineStyle(1, 0x2d8c1f, 0.25);
      baseGfx.strokeRoundedRect(rect.x, rect.y, rect.w, rect.h, 8);
      container.add(baseGfx);

      // Tile bush sprites inside the zone
      const bushKeys = ['ts_bush1', 'ts_bush2'];
      const bushSize = 48;
      const cols = Math.floor(rect.w / bushSize);
      const rows = Math.floor(rect.h / bushSize);
      const offsetX = (rect.w - cols * bushSize) / 2;
      const offsetY = (rect.h - rows * bushSize) / 2;

      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          const bKey = bushKeys[(r + c) % 2];
          if (!this.textures.exists(bKey)) continue;
          const bx = rect.x + offsetX + c * bushSize + bushSize / 2;
          const by = rect.y + offsetY + r * bushSize + bushSize / 2;
          const bushSprite = this.add.image(bx, by, bKey)
            .setDisplaySize(bushSize, bushSize)
            .setAlpha(0.85);

          // Subtle sway animation
          this.tweens.add({
            targets: bushSprite,
            angle: { from: -2, to: 2 },
            duration: 1500 + Math.random() * 1000,
            yoyo: true,
            repeat: -1,
            ease: 'Sine.easeInOut',
            delay: Math.random() * 1000,
          });

          container.add(bushSprite);
        }
      }
    }
  }

  // ─── MAP TOWERS (from towerSlots) ─────────────────────────

  private renderMapTowers() {
    // Towers are now fully handled by setupTowers() which reads from mapDef.towerSlots
    // This method is kept as a no-op for backward compatibility with drawBackground() calls
  }

  // ─── BUSH VISIBILITY HELPERS ──────────────────────────────

  /** Check if a world position is inside any bush zone */
  private isInBush(x: number, y: number): boolean {
    for (const r of this.bushRects) {
      if (x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h) return true;
    }
    return false;
  }

  /** Get the specific bush rect a position is in, or null */
  private getBushRect(x: number, y: number): { x: number; y: number; w: number; h: number } | null {
    for (const r of this.bushRects) {
      if (x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h) return r;
    }
    return null;
  }

  /** Check if a team has any unit inside a specific bush rect */
  private teamHasUnitInBush(team: 1 | 2, bush: { x: number; y: number; w: number; h: number }): boolean {
    for (const u of this.units) {
      if (u.dead || u.team !== team) continue;
      if (u.x >= bush.x && u.x <= bush.x + bush.w && u.y >= bush.y && u.y <= bush.y + bush.h) {
        return true;
      }
    }
    return false;
  }

  // ─── FOG OF WAR ─────────────────────────────────────────────

  private setupFog() {
    // 1a: Downscaled RT — FOG_W×FOG_H instead of WORLD_W×WORLD_H (156MB → ~10MB)
    this.fogRT = this.add.renderTexture(0, 0, FOG_W, FOG_H)
      .setOrigin(0)
      .setDepth(50)
      .setAlpha(0.3)
      .setScale(1 / FOG_SCALE); // scale up to cover full world

    // Generate a circular radial-gradient brush via canvas (scaled down by FOG_SCALE)
    const brushSize = Math.ceil(FOG_VISION_RANGE * 2 * FOG_SCALE);
    const canvas = document.createElement('canvas');
    canvas.width = brushSize;
    canvas.height = brushSize;
    const ctx2d = canvas.getContext('2d')!;
    const grad = ctx2d.createRadialGradient(
      brushSize / 2, brushSize / 2, 0,
      brushSize / 2, brushSize / 2, brushSize / 2,
    );
    grad.addColorStop(0, 'rgba(255,255,255,1)');
    grad.addColorStop(0.85, 'rgba(255,255,255,1)');
    grad.addColorStop(1, 'rgba(255,255,255,0)');
    ctx2d.fillStyle = grad;
    ctx2d.fillRect(0, 0, brushSize, brushSize);
    const texKey = '__fog_circle_brush__';
    if (this.textures.exists(texKey)) this.textures.remove(texKey);
    this.textures.addCanvas(texKey, canvas);
    this.fogBrush = this.make.image({ key: texKey, x: 0, y: 0 }, false);
    this.fogBrush.setOrigin(0, 0);

    // Large brush for structure vision (scaled down by FOG_SCALE)
    const lgSize = Math.ceil(FOG_STRUCTURE_VISION_RANGE * 2 * FOG_SCALE);
    const lgCanvas = document.createElement('canvas');
    lgCanvas.width = lgSize;
    lgCanvas.height = lgSize;
    const lgCtx = lgCanvas.getContext('2d')!;
    const lgGrad = lgCtx.createRadialGradient(
      lgSize / 2, lgSize / 2, 0,
      lgSize / 2, lgSize / 2, lgSize / 2,
    );
    lgGrad.addColorStop(0, 'rgba(255,255,255,1)');
    lgGrad.addColorStop(0.85, 'rgba(255,255,255,1)');
    lgGrad.addColorStop(1, 'rgba(255,255,255,0)');
    lgCtx.fillStyle = lgGrad;
    lgCtx.fillRect(0, 0, lgSize, lgSize);
    const lgTexKey = '__fog_circle_brush_lg__';
    if (this.textures.exists(lgTexKey)) this.textures.remove(lgTexKey);
    this.textures.addCanvas(lgTexKey, lgCanvas);
    this.fogBrushLarge = this.make.image({ key: lgTexKey, x: 0, y: 0 }, false);
    this.fogBrushLarge.setOrigin(0, 0);

    // 1c: Allocate vision grid at tile resolution
    this._visionGrid = new Uint8Array(FOG_VISION_TILES_W * FOG_VISION_TILES_H);
  }

  private updateFog() {
    if (!this.fogRT || !this.fogBrush || !this.fogBrushLarge) return;
    if (this.fogDisabled) {
      this.fogRT.setVisible(false);
      return;
    }
    // Throttle fog updates to every 8th frame for performance
    if (this._frameCount % 8 !== 0) return;
    this.fogRT.setVisible(true);

    // Cache vision sources for this frame (4c: reuses array)
    this.buildVisionCache();

    // 1b: Skip fog redraw when vision sources haven't moved
    let visionHash = 0;
    for (const s of this.visionSources) {
      visionHash = (visionHash ^ ((s.x | 0) * 73856093 ^ (s.y | 0) * 19349663)) | 0;
    }
    if (visionHash === this._lastVisionHash) return;
    this._lastVisionHash = visionHash;

    // Fill with black (fog)
    this.fogRT.fill(0x000000);

    // 1a: Erase fog with scaled coordinates and brushes
    for (const s of this.visionSources) {
      if (s.r > FOG_VISION_RANGE) {
        this.fogRT.erase(this.fogBrushLarge, (s.x - s.r) * FOG_SCALE, (s.y - s.r) * FOG_SCALE);
      } else {
        this.fogRT.erase(this.fogBrush, (s.x - FOG_VISION_RANGE) * FOG_SCALE, (s.y - FOG_VISION_RANGE) * FOG_SCALE);
      }
    }

    // 1c: Rebuild integer vision grid at tile resolution
    if (this._visionGrid) {
      this._visionGrid.fill(0);
      const tw = FOG_VISION_TILES_W, th = FOG_VISION_TILES_H;
      for (const s of this.visionSources) {
        const rTiles = Math.ceil(s.r / TILE_SIZE);
        const cxT = Math.floor(s.x / TILE_SIZE), cyT = Math.floor(s.y / TILE_SIZE);
        const r2 = rTiles * rTiles;
        for (let dy = -rTiles; dy <= rTiles; dy++) {
          const ty = cyT + dy;
          if (ty < 0 || ty >= th) continue;
          for (let dx = -rTiles; dx <= rTiles; dx++) {
            const tx = cxT + dx;
            if (tx < 0 || tx >= tw) continue;
            if (dx * dx + dy * dy <= r2) {
              this._visionGrid[ty * tw + tx] = 1;
            }
          }
        }
      }
    }
  }

  /** Hide/show sprites based on fog of war vision */
  private updateFogVisibility() {
    // Throttle visibility updates to every 8th frame (synced with fog)
    if (this._frameCount % 8 !== 0) return;
    const enemyTeam = this.myTeam === 1 ? 2 : 1;

    // Hide/show enemy and neutral unit sprites (with bush visibility)
    for (const u of this.units) {
      if (u.team === this.myTeam) continue; // always show own units
      let visible = this.fogDisabled || this.isInVision(u.x, u.y);

      // Bush visibility: if enemy is in a bush, they are hidden unless
      // our team also has a unit in that same bush
      if (visible && !this.fogDisabled && this.bushRects.length > 0) {
        const enemyBush = this.getBushRect(u.x, u.y);
        if (enemyBush) {
          // Enemy is in a bush — only visible if our team has a unit in the SAME bush
          visible = this.teamHasUnitInBush(this.myTeam, enemyBush);
        }
      }

      if (u.sprite) u.sprite.setVisible(visible);
      if (u.carrySprite) u.carrySprite.setVisible(visible);
    }

    // Hide/show ground items outside vision
    for (const item of this.groundItems) {
      if (item.dead || !item.sprite) continue;
      item.sprite.setVisible(this.fogDisabled || this.isInVision(item.x, item.y));
    }

    // Camp visuals: always show buildings, labels, and area circles regardless of fog
    for (const c of this.camps) {
      const visible = this.fogDisabled || this.isInVision(c.x, c.y);
      const bldg = (c as any).buildingSprite as Phaser.GameObjects.Image | undefined;
      if (bldg) bldg.setVisible(true);
      if (c.label) c.label.setVisible(true);
      if (c.area) c.area.setVisible(true);
      // Update scouted info when in vision
      if (visible || c.owner === this.myTeam) {
        c.scouted = true;
        c.lastSeenOwner = c.owner;
        if (c.label) { c.lastSeenLabel = c.label.text; c.lastSeenColor = c.label.style.color as string; }
      }
    }

    // Towers: always show sprite, range, labels, and hp regardless of fog
    for (const t of this.towers) {
      if (!t.alive) continue;
      if ((t as any).sprite) (t as any).sprite.setVisible(true);
      if (t.rangeCircle) t.rangeCircle.setVisible(true);
      if ((t as any).label) (t as any).label.setVisible(true);
      if (t.hpBar) t.hpBar.setVisible(true);
      if (t.hpText) t.hpText.setVisible(true);
    }

    // Mines: always show sprite and label regardless of fog
    for (const mine of this.mineNodes) {
      if (mine.sprite) mine.sprite.setVisible(true);
      if (mine.label) mine.label.setVisible(true);
    }

    // Armories: always show sprite and label regardless of fog
    for (const arm of this.armories) {
      if (arm.sprite) arm.sprite.setVisible(true);
      if (arm.label) arm.label.setVisible(true);
    }

    // Nexuses: always show all visuals regardless of fog
    for (const n of this.nexuses) {
      if ((n as any).sprite) (n as any).sprite.setVisible(true);
      if (n.hpBar) n.hpBar.setVisible(true);
      if (n.hpText) n.hpText.setVisible(true);
      if (n.label) n.label.setVisible(true);
      const stockLabel = this.hudTexts[`stock_${n.team}`];
      if (stockLabel) stockLabel.setVisible(true);
    }

    // Map events are always visible regardless of fog
    for (const ev of this.mapEvents) {
      if (!ev.container || ev.state !== 'active') continue;
      ev.container.setVisible(true);
    }
  }

  // Cached vision sources for the current frame (avoids re-filtering allies per query)
  private visionSources: { x: number; y: number; r: number }[] = [];

  private buildVisionCache() {
    // 4c: Reuse visionSources array instead of allocating new one
    this.visionSources.length = 0;
    // Own nexus — large structure vision
    const base = this.myTeam === 1 ? P1_BASE : P2_BASE;
    this.visionSources.push({ x: base.x, y: base.y, r: FOG_STRUCTURE_VISION_RANGE });
    // Allied units — standard vision
    for (const u of this.units) {
      if (u.dead || u.team !== this.myTeam) continue;
      this.visionSources.push({ x: u.x, y: u.y, r: FOG_VISION_RANGE });
    }
    // Owned camps — structure vision
    for (const c of this.camps) {
      if (c.owner === this.myTeam) this.visionSources.push({ x: c.x, y: c.y, r: FOG_STRUCTURE_VISION_RANGE });
    }
    // Allied towers — structure vision
    for (const t of this.towers) {
      if (t.alive && t.team === this.myTeam) this.visionSources.push({ x: t.x, y: t.y, r: FOG_STRUCTURE_VISION_RANGE });
    }
    // Allied armories — structure vision (only if unlocked)
    for (const arm of this.armories) {
      if (arm.team === this.myTeam && this.unlockedEquipment[this.myTeam].has(arm.equipmentType)) {
        this.visionSources.push({ x: arm.x, y: arm.y, r: FOG_STRUCTURE_VISION_RANGE });
      }
    }
    // Active map events — always visible to both teams
    for (const ev of this.mapEvents) {
      if (ev.state === 'active') {
        this.visionSources.push({ x: ev.x, y: ev.y, r: FOG_STRUCTURE_VISION_RANGE });
      }
    }
  }

  /** Check if a world position is currently visible. Uses vision grid for O(1) fast path. */
  private isInVision(x: number, y: number): boolean {
    // 1c: Fast O(1) lookup via integer vision grid
    if (this._visionGrid) {
      const tx = Math.floor(x / TILE_SIZE), ty = Math.floor(y / TILE_SIZE);
      if (tx >= 0 && tx < FOG_VISION_TILES_W && ty >= 0 && ty < FOG_VISION_TILES_H) {
        return this._visionGrid[ty * FOG_VISION_TILES_W + tx] > 0;
      }
    }
    // Fallback to per-source check
    for (const s of this.visionSources) {
      const dx = x - s.x, dy = y - s.y;
      if (dx * dx + dy * dy < s.r * s.r && this.hasLineOfSight(s.x, s.y, x, y)) return true;
    }
    return false;
  }

  /** 1d: Integer DDA raycast — returns false if a rock (3) tile blocks the line */
  private hasLineOfSight(x0: number, y0: number, x1: number, y1: number): boolean {
    const tiles = this.mapDef?.tiles;
    if (!tiles || tiles.length === 0) return true;
    const rows = tiles.length, cols = tiles[0].length;
    // Integer DDA (Bresenham-style) — no Math.sqrt, no per-step division
    let col0 = (x0 / TILE_SIZE) | 0, row0 = (y0 / TILE_SIZE) | 0;
    const col1 = (x1 / TILE_SIZE) | 0, row1 = (y1 / TILE_SIZE) | 0;
    let dc = col1 - col0, dr = row1 - row0;
    const sc = dc > 0 ? 1 : dc < 0 ? -1 : 0;
    const sr = dr > 0 ? 1 : dr < 0 ? -1 : 0;
    dc = dc < 0 ? -dc : dc;
    dr = dr < 0 ? -dr : dr;
    if (dc === 0 && dr === 0) return true;
    let err: number;
    if (dc >= dr) {
      err = dc >> 1;
      for (let i = 0; i < dc; i++) {
        col0 += sc;
        err -= dr;
        if (err < 0) { row0 += sr; err += dc; }
        if (row0 >= 0 && row0 < rows && col0 >= 0 && col0 < cols && tiles[row0][col0] === 3) return false;
      }
    } else {
      err = dr >> 1;
      for (let i = 0; i < dr; i++) {
        row0 += sr;
        err -= dc;
        if (err < 0) { col0 += sc; err += dr; }
        if (row0 >= 0 && row0 < rows && col0 >= 0 && col0 < cols && tiles[row0][col0] === 3) return false;
      }
    }
    return true;
  }

  // ─── CAMPS ───────────────────────────────────────────────────

  private setupCamps() {
    for (const def of this.activeCampDefs) {
      const animalDef = ANIMALS[def.type];

      const area = this.add.ellipse(def.x, def.y, CAMP_RANGE * 2.6, CAMP_RANGE * 1.5, 0xFFD93D, 0.06);
      area.setStrokeStyle(2, 0xFFD93D, 0.25);
      area.setDepth(4); // above fog (50) — always visible through fog

      const label = this.add.text(def.x, def.y + 35, def.name, {
        fontSize: '20px', color: '#FFD93D', fontFamily: '"Nunito", sans-serif', fontStyle: 'bold',
        stroke: '#000000', strokeThickness: 4,
      }).setOrigin(0.5).setDepth(55); // above fog — shows "???" or scouted type

      const captureBar = this.add.graphics().setDepth(55); // above fog

      // Spawn cost label — e.g. "2🥕 = 1 gnome" (hidden until captured)
      const cost = SPAWN_COSTS[def.type];
      const resEmoji = cost ? RESOURCE_EMOJI[cost.type] : '?';
      const costText = cost ? `${cost.amount}${resEmoji} = 1 ${def.type}` : '';
      const costLabel = this.add.text(def.x, def.y + 55, costText, {
        fontSize: '14px', color: '#CCCCCC', fontFamily: '"Nunito", sans-serif', fontStyle: 'bold',
        stroke: '#000000', strokeThickness: 3,
      }).setOrigin(0.5).setDepth(55).setVisible(false);

      const camp: HCamp = {
        id: def.id, name: def.name, animalType: def.type, tier: animalDef.tier,
        guardCount: def.guards,
        x: def.x, y: def.y, owner: 0,
        spawnMs: def.spawnMs, spawnTimer: 0, buff: def.buff,
        label, area, captureBar, storedFood: 0,
        scouted: false, lastSeenOwner: 0, lastSeenLabel: '', lastSeenColor: '#FFD93D',
        idleGuard: null, idleGuardOwner: 0,
        costLabel,
      };
      this.camps.push(camp);

      // Add building sprite to camp center — higher tiers get bigger buildings
      const buildingVariant = (this.camps.length % 3) + 1;
      const tier = animalDef.tier;
      const campScale = tier <= 1 ? 0.75 : tier === 2 ? 0.9 : tier === 3 ? 1.05 : tier === 4 ? 1.2 : 1.4;
      const shadowW = tier <= 1 ? 70 : tier === 2 ? 85 : tier === 3 ? 100 : tier === 4 ? 115 : 130;
      const campFootY = def.y + 5;
      // shadow removed
      const campSide = (Math.sqrt((def.x - P1_BASE.x) ** 2 + (def.y - P1_BASE.y) ** 2) <
                        Math.sqrt((def.x - P2_BASE.x) ** 2 + (def.y - P2_BASE.y) ** 2)) ? 'blue' : 'red';
      const campBuilding = this.add.image(def.x, campFootY, `ts_house${buildingVariant}_${campSide}`)
        .setScale(campScale).setOrigin(0.5, 1.0).setDepth(10 + Math.round(campFootY * 0.01));
      (camp as any).buildingSprite = campBuilding;

      // Spawn defenders only for camps whose tier is unlocked by the current era
      if (!this.isOnline || this.isHost) {
        if (animalDef.tier <= this.eraMaxTier()) {
          this.spawnCampDefenders(camp);
        }
      }
    }
  }

  /** Max animal tier unlocked at current era */
  private eraMaxTier(): number {
    return this.currentEra; // Era 1→T1, Era 2→T2, Era 3→T3, Era 4→T4, Era 5→T5
  }

  /** Is this camp active (tier unlocked) in the current era? */
  private isCampActive(camp: HCamp): boolean {
    return (ANIMALS[camp.animalType]?.tier || 1) <= this.eraMaxTier();
  }

  private spawnCampDefenders(camp: HCamp) {
    const def = ANIMALS[camp.animalType];
    for (let i = 0; i < camp.guardCount; i++) {
      const angle = (i / camp.guardCount) * Math.PI * 2;
      let gx = camp.x + Math.cos(angle) * 50;
      let gy = camp.y + Math.sin(angle) * 50;
      const safe = this.findWalkableSpawn(gx, gy);
      gx = safe.x; gy = safe.y;
      // Neutral defenders wander near their camp
      const wanderAngle = Math.random() * Math.PI * 2;
      const wanderR = 20 + Math.random() * 40;
      const speedVar = 0.85 + Math.random() * 0.3;
      this.units.push({
        id: this.nextId++, type: camp.animalType, team: 0,
        hp: def.hp * 1.5, maxHp: def.hp * 1.5,
        attack: def.attack * 1.2, speed: def.speed * 0.5 * speedVar,
        x: gx, y: gy,
        targetX: camp.x + Math.cos(wanderAngle) * wanderR,
        targetY: camp.y + Math.sin(wanderAngle) * wanderR,
        attackTimer: 0, sprite: null, dead: false, animState: 'idle' as const, prevSpriteX: 0, prevSpriteY: 0,
        campId: camp.id, lungeX: 0, lungeY: 0,
        gnomeShield: camp.animalType === 'gnome' ? 1 : 0,
        hasRebirth: camp.animalType === 'skull',
        diveReady: false,
        diveTimer: 0,
        lastAttackTarget: -1, attackFaceX: null, pathWaypoints: null, pathAge: 0, pathTargetX: 0, pathTargetY: 0, lastCheckX: 0, lastCheckY: 0, stuckFrames: 0, stuckCooldown: 0, mods: { ...DEFAULT_MODS },
        carrying: null, carrySprite: null, loop: null, isElite: false, idleTimer: 0, claimItemId: -1,
        equipment: null, equipLevel: 0, equipSprite: null, equipDragSprite: null, equipVisualApplied: null,
      });
    }
  }

  // ─── MINE NODES ─────────────────────────────────────────────

  private initMineNodes() {
    this.mineNodes = [];
    let idx = 0;

    // Use MapDef mine positions if available
    if (this.mapDef?.mineSlots && this.mapDef.mineSlots.length > 0) {
      for (const slot of this.mapDef.mineSlots) {
        this.mineNodes.push({ id: `mine_${idx++}`, x: slot.bluePos.x, y: slot.bluePos.y, sprite: null, label: null });
        this.mineNodes.push({ id: `mine_${idx++}`, x: slot.redPos.x, y: slot.redPos.y, sprite: null, label: null });
      }
      return;
    }

    // Fallback: hardcoded positions from bases
    const cx = WORLD_W / 2, cy = WORLD_H / 2;
    const mineOffsets = [
      { dist: 600, angle: -0.6 },
      { dist: 650, angle: 0.6 },
    ];
    const baseAngle = Math.atan2(cy - P1_BASE.y, cx - P1_BASE.x);
    for (const off of mineOffsets) {
      const angle = baseAngle + off.angle;
      const x1 = Math.round(P1_BASE.x + Math.cos(angle) * off.dist);
      const y1 = Math.round(P1_BASE.y + Math.sin(angle) * off.dist);
      const x2 = Math.round(cx + (cx - x1));
      const y2 = Math.round(cy + (cy - y1));
      this.mineNodes.push({ id: `mine_${idx++}`, x: x1, y: y1, sprite: null, label: null });
      this.mineNodes.push({ id: `mine_${idx++}`, x: x2, y: y2, sprite: null, label: null });
    }
  }

  private initArmories() {
    this.armories = [];

    // Use MapDef armory positions if available
    const eqTypesList: EquipmentType[] = ['pickaxe', 'sword', 'shield', 'boots', 'banner'];
    if (this.mapDef?.armorySlots && this.mapDef.armorySlots.length > 0) {
      for (let i = 0; i < this.mapDef.armorySlots.length; i++) {
        const slot = this.mapDef.armorySlots[i];
        const eqType = (slot as any).equipmentType || eqTypesList[i % eqTypesList.length];
        this.armories.push({ x: slot.bluePos.x, y: slot.bluePos.y, team: 1, equipmentType: eqType, sprite: null, label: null });
        this.armories.push({ x: slot.redPos.x, y: slot.redPos.y, team: 2, equipmentType: eqType, sprite: null, label: null });
      }
      return;
    }

    // Fallback: random positions near bases
    const cx = WORLD_W / 2, cy = WORLD_H / 2;
    const baseAngle = Math.atan2(cy - P1_BASE.y, cx - P1_BASE.x);
    const eqTypes: EquipmentType[] = ['pickaxe', 'sword', 'shield', 'boots', 'banner'];
    // Spread 5 armories in an arc on each team's side
    for (let i = 0; i < eqTypes.length; i++) {
      const angleSpread = (i - 2) * 0.45; // -0.9, -0.45, 0, 0.45, 0.9 radians
      const angle = baseAngle + angleSpread + (Math.random() - 0.5) * 0.2;
      const dist = 350 + Math.random() * 250;
      const x1 = Math.round(Math.max(120, Math.min(WORLD_W - 120, P1_BASE.x + Math.cos(angle) * dist)));
      const y1 = Math.round(Math.max(120, Math.min(WORLD_H - 120, P1_BASE.y + Math.sin(angle) * dist)));
      // Mirror for P2
      const x2 = Math.round(cx + (cx - x1));
      const y2 = Math.round(cy + (cy - y1));
      this.armories.push({ x: x1, y: y1, team: 1, equipmentType: eqTypes[i], sprite: null, label: null });
      this.armories.push({ x: x2, y: y2, team: 2, equipmentType: eqTypes[i], sprite: null, label: null });
    }
  }


  // ─── ERA PROGRESSION ─────────────────────────────────────────
  private static readonly ERA_NAMES: Record<number, string> = { 1: 'Foraging', 2: 'Hunting', 3: 'Expansion', 4: 'War', 5: 'Endgame' };

  private updateEraProgression() {
    if (this.currentEra >= 5) return;

    // Show game start banner once, then queue Era 1 banner after it
    if (!this.gameStartBannerShown) {
      this.gameStartBannerShown = true;
      this.notifQueue.push({ type: 'game_start', priority: 4, data: {} });
      this.showEraBanner(1);
      return;
    }

    let t = this.currentEra;

    // Era 2 — after 1 minute 30 seconds
    if (t === 1 && this.gameTime >= 90000) t = 2;

    // Era 3 — any player has units of 4+ distinct types
    if (t === 2) {
      for (const team of [1, 2] as const) {
        const types = new Set(this.units.filter(u => u.team === team && !u.dead).map(u => u.type));
        if (types.size >= 4) { t = 3; break; }
      }
    }

    // Era 4 — any player has 4+ tier 3 units
    if (t === 3) {
      for (const team of [1, 2] as const) {
        const t3count = this.units.filter(u => u.team === team && !u.dead && (ANIMALS[u.type]?.tier || 1) === 3).length;
        if (t3count >= 4) { t = 4; break; }
      }
    }

    // Endgame — elite killed OR any player has 2+ tier 4 units
    if (t === 4) {
      if (this.eliteKillCount > 0) { t = 5; }
      else {
        for (const team of [1, 2] as const) {
          const t4count = this.units.filter(u => u.team === team && !u.dead && (ANIMALS[u.type]?.tier || 1) === 4).length;
          if (t4count >= 2) { t = 5; break; }
        }
      }
    }

    if (t > this.currentEra) this.advanceEra(t);
  }

  private advanceEra(ne: number) {
    const om = this.eraMaxTier();
    this.currentEra = ne;
    const nm = this.eraMaxTier();
    this.sfx.playGlobal('wave_start');
    this.showFeedback(`Era ${ne}: Tier ${nm}!`, '#45E6B0');
    this.showEraBanner(ne);
    for (const c of this.camps) {
      const ti = ANIMALS[c.animalType]?.tier || 1;
      if (ti > om && ti <= nm && c.owner === 0 && !this.units.some(u => u.campId === c.id && !u.dead)) {
        this.spawnCampDefenders(c);
      }
    }
    if (ne === 2) this.spawnWildAnimalsForEra(['skull', 'spider', 'hyena'], WILD_ANIMAL_COUNT);
    if (ne === 3) this.spawnWildAnimalsForEra(['panda', 'lizard'], 10);
    if (ne === 4) this.spawnElitePreyBatch();
  }

  private spawnWildAnimalsForEra(types: string[], count: number) {
    for (let i = 0; i < count; i++) {
      const type = types[Math.floor(Math.random() * types.length)];
      const def = ANIMALS[type];
      if (!def) continue;
      const rawP = this.randomOutskirtsPos();
      const p = this.findWalkableSpawn(rawP.x, rawP.y);
      this.units.push({
        id: this.nextId++, type, team: 0,
        hp: def.hp, maxHp: def.hp, attack: def.attack, speed: def.speed * 0.4,
        x: p.x, y: p.y, targetX: p.x + Math.random() * 100 - 50, targetY: p.y + Math.random() * 100 - 50,
        attackTimer: 0, sprite: null, dead: false, animState: 'idle' as const, prevSpriteX: 0, prevSpriteY: 0,
        campId: null, lungeX: 0, lungeY: 0,
        gnomeShield: 0, hasRebirth: false, diveReady: false, diveTimer: 0, lastAttackTarget: -1, attackFaceX: null, pathWaypoints: null, pathAge: 0, pathTargetX: 0, pathTargetY: 0, lastCheckX: 0, lastCheckY: 0, stuckFrames: 0, stuckCooldown: 0, mods: { ...DEFAULT_MODS },
        carrying: null, carrySprite: null, loop: null, isElite: false, idleTimer: 0, claimItemId: -1,
        equipment: null, equipLevel: 0, equipSprite: null, equipDragSprite: null, equipVisualApplied: null,
      });
    }
  }

  private spawnElitePreyBatch() {
    for (let i = 0; i < ELITE_PREY_COUNT; i++) {
      const rawE = this.randomOutskirtsPos();
      const ePos = this.findWalkableSpawn(rawE.x, rawE.y);
      const { x, y } = ePos;
      this.units.push({
        id: this.nextId++, type: 'minotaur', team: 0,
        hp: 2000, maxHp: 2000, attack: 150, speed: 90,
        x, y, targetX: x + Math.random() * 80 - 40, targetY: y + Math.random() * 80 - 40,
        attackTimer: 0, sprite: null, dead: false, animState: 'idle' as const, prevSpriteX: 0, prevSpriteY: 0,
        campId: null, lungeX: 0, lungeY: 0,
        gnomeShield: 0, hasRebirth: false, diveReady: false, diveTimer: 0, lastAttackTarget: -1, attackFaceX: null, pathWaypoints: null, pathAge: 0, pathTargetX: 0, pathTargetY: 0, lastCheckX: 0, lastCheckY: 0, stuckFrames: 0, stuckCooldown: 0, mods: { ...DEFAULT_MODS },
        carrying: null, carrySprite: null, loop: null, isElite: true, idleTimer: 0, claimItemId: -1,
        equipment: null, equipLevel: 0, equipSprite: null, equipDragSprite: null, equipVisualApplied: null,
      });
    }
  }

  // ─── NEXUSES ─────────────────────────────────────────────────

  private setupNexuses() {
    for (const team of [1, 2] as const) {
      const base = team === 1 ? P1_BASE : P2_BASE;
      // Shadow at ground level, separate from container
      const nexFootY = base.y + 5;
      const c = this.add.container(base.x, nexFootY).setDepth(10 + Math.round(nexFootY * 0.01));
      const castleKey = team === 1 ? 'ts_castle_blue' : 'ts_castle_red';
      const castle = this.add.image(0, 0, castleKey).setScale(1.5).setOrigin(0.5, 1.0);
      c.add(castle);
      const isMyNexus = team === this.myTeam;
      const nexLabel = this.add.text(0, 90, isMyNexus ? 'YOUR CASTLE' : 'ENEMY CASTLE', {
        fontSize: '18px', color: isMyNexus ? '#4499FF' : '#FF5555',
        fontFamily: '"Fredoka", sans-serif', fontStyle: 'bold',
        stroke: '#000', strokeThickness: 3,
      }).setOrigin(0.5);
      c.add(nexLabel);

      this.nexuses.push({
        team, x: base.x, y: base.y,
        hp: NEXUS_MAX_HP, maxHp: NEXUS_MAX_HP,
        attackTimer: 0,
        container: c,
        label: nexLabel,
        hpBar: this.add.graphics().setDepth(55),
        hpText: this.add.text(base.x, base.y + 50, `${NEXUS_MAX_HP}/${NEXUS_MAX_HP}`, {
          fontSize: '12px', color: '#f0e8ff', fontFamily: '"Nunito", sans-serif',
          fontStyle: 'bold', stroke: '#000', strokeThickness: 2,
        }).setOrigin(0.5).setDepth(55),
      });
    }
    this.drawNexusBars();
  }

  /** Add a soft elliptical shadow beneath a building */
  private addBuildingShadow(x: number, y: number, w: number, h: number, _depth: number = 7): Phaser.GameObjects.Ellipse {
    return this.add.ellipse(x, y, w, h, 0x000000, 0.25).setDepth(6);
  }

  private setupTowers() {
    // Build tower positions from map towerSlots (editor-driven)
    const towerPositions: { team: 1 | 2; x: number; y: number }[] = [];
    const slots = this.mapDef?.towerSlots;
    if (slots && slots.length > 0) {
      for (const slot of slots) {
        towerPositions.push({ team: 1, x: slot.bluePos.x, y: slot.bluePos.y });
        towerPositions.push({ team: 2, x: slot.redPos.x, y: slot.redPos.y });
      }
    } else {
      // Fallback: default tower positions if map has no towerSlots
      const base1 = this.mapDef?.p1Base || { x: 400, y: WORLD_H - 400 };
      const base2 = this.mapDef?.p2Base || { x: WORLD_W - 400, y: 400 };
      towerPositions.push(
        { team: 1, x: base1.x + 300, y: base1.y - 350 },
        { team: 1, x: base1.x, y: base1.y - 400 },
        { team: 1, x: base1.x + 350, y: base1.y - 50 },
        { team: 2, x: base2.x - 300, y: base2.y + 350 },
        { team: 2, x: base2.x, y: base2.y + 400 },
        { team: 2, x: base2.x - 350, y: base2.y + 50 },
      );
    }

    for (const pos of towerPositions) {
      const key = pos.team === 1 ? 'ts_tower_blue' : 'ts_tower_red';
      const towerFootY = pos.y + 5;
      const sprite = this.add.image(pos.x, towerFootY, key)
        .setScale(1.8)
        .setOrigin(0.5, 1.0)
        .setDepth(10 + Math.round(towerFootY * 0.01));

      // Tower label — below building
      const tLabel = this.add.text(pos.x, towerFootY + 50, pos.team === this.myTeam ? 'Allied Tower' : 'Enemy Tower', {
        fontSize: '14px', color: pos.team === 1 ? '#4499FF' : '#FF5555',
        fontFamily: '"Nunito", sans-serif', fontStyle: 'bold',
        stroke: '#000', strokeThickness: 3,
      }).setOrigin(0.5).setDepth(55);

      const hpBar = this.add.graphics().setDepth(55);

      const rangeCircle = this.add.circle(pos.x, pos.y, TOWER_RANGE)
        .setStrokeStyle(3, pos.team === 1 ? 0x4499FF : 0xFF5555, 0.4)
        .setFillStyle(pos.team === 1 ? 0x4499FF : 0xFF5555, 0.07)
        .setDepth(5);

      this.towers.push({
        id: `tower_${pos.team}_${this.towers.length}`,
        team: pos.team,
        x: pos.x, y: towerFootY,
        hp: TOWER_HP, maxHp: TOWER_HP,
        damage: TOWER_DAMAGE,
        range: TOWER_RANGE,
        splashRange: TOWER_SPLASH,
        attackCooldown: TOWER_COOLDOWN,
        attackTimer: 0,
        alive: true,
        sprite,
        hpBar,
        hpText: null,
        rangeCircle,
        label: tLabel,
      });
    }
    this.drawTowerBars();
  }

  private drawTowerBars() {
    for (const t of this.towers) {
      if (!t.alive || !t.hpBar) continue;
      // Skip redraw if HP hasn't changed
      const curHp = Math.ceil(t.hp);
      if ((t as any)._prevHp === curHp) {
        // Still update zoom-dependent scale
        const zoom = this.cameras.main.zoom;
        const labelScale = Math.max(0.8, 1.0 / zoom);
        if (t.label) t.label.setScale(labelScale);
        if (t.hpText) t.hpText.setScale(labelScale);
        continue;
      }
      (t as any)._prevHp = curHp;
      const g = t.hpBar;
      g.clear();
      const pct = Math.max(0, t.hp / t.maxHp);
      const w = 140, h = 14;
      const barY = t.y + 20;
      g.fillStyle(0x000000, 0.7);
      g.fillRoundedRect(t.x - w / 2, barY, w, h, 4);
      g.fillStyle(pct > 0.5 ? 0x45E6B0 : pct > 0.25 ? 0xFFD93D : 0xFF5555);
      g.fillRoundedRect(t.x - w / 2, barY, w * pct, h, 4);
      g.lineStyle(1, 0xffffff, 0.3);
      g.strokeRoundedRect(t.x - w / 2, barY, w, h, 4);
      if (!t.hpText) {
        t.hpText = this.add.text(t.x, barY + h / 2, '', {
          fontSize: '10px', color: '#ffffff', fontFamily: '"Nunito", sans-serif',
          fontStyle: 'bold', stroke: '#000', strokeThickness: 2,
        }).setOrigin(0.5).setDepth(55);
      }
      t.hpText.setText(`${Math.max(0, Math.ceil(t.hp))}/${t.maxHp}`);
      t.hpText.setPosition(t.x, barY + h / 2);
      // Scale label and hp text with zoom
      const zoom = this.cameras.main.zoom;
      const labelScale = Math.max(0.8, 1.0 / zoom);
      if (t.label) t.label.setScale(labelScale);
      if (t.hpText) t.hpText.setScale(labelScale);
    }
  }

  private updateNexusCombat(delta: number) {
    // 3c: Throttle structure combat to every 2nd frame
    if (this._frameCount % 2 !== 0) return;
    for (const n of this.nexuses) {
      if (n.hp <= 0) continue;

      n.attackTimer -= delta;
      if (n.attackTimer > 0) continue;

      // Find nearest enemy unit in range (spatial grid lookup)
      let bestTarget: HUnit | null = null;
      let bestDist = Infinity;
      const nexusNearby = this.getNearbyUnits(n.x, n.y, NEXUS_RANGE);
      for (const u of nexusNearby) {
        if (u.dead || u.team === n.team || u.team === 0) continue;
        const dx = u.x - n.x, dy = u.y - n.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist < bestDist) {
          bestDist = dist;
          bestTarget = u;
        }
      }

      if (!bestTarget) continue;

      n.attackTimer = NEXUS_COOLDOWN;

      // Spawn animated projectile
      const proj = this.add.sprite(n.x, n.y - 40, 'tower_projectile')
        .setScale(0.55).setDepth(50).setOrigin(0.5);
      proj.play('tower_proj_anim');
      // Tint projectile to match team color
      proj.setTint(n.team === 1 ? 0x88BBFF : 0xFF8888);

      // Splash targets (spatial grid lookup)
      const splashList: { id: number; dmg: number }[] = [];
      const nexusSplashNearby = this.getNearbyUnits(bestTarget.x, bestTarget.y, NEXUS_SPLASH);
      for (const o of nexusSplashNearby) {
        if (o.dead || o.id === bestTarget.id || o.team === n.team || o.team === 0) continue;
        const sd = Math.sqrt((o.x - bestTarget.x) ** 2 + (o.y - bestTarget.y) ** 2);
        if (sd <= NEXUS_SPLASH) {
          const falloff = 1 - (sd / NEXUS_SPLASH) * 0.5;
          splashList.push({ id: o.id, dmg: Math.round(NEXUS_DAMAGE * 0.6 * falloff) });
        }
      }

      // Queue pending hit
      const projContainer = this.add.container(n.x, n.y - 40).setDepth(50);
      projContainer.add(proj);
      proj.setPosition(0, 0);

      this.pendingHits.push({
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
        projectile: projContainer,
        projX: n.x, projY: n.y - 40,
        projSpeed: NEXUS_PROJ_SPEED,
      });
    }
  }

  private updateTowers(delta: number) {
    // 3c: Throttle structure combat to every 2nd frame
    if (this._frameCount % 2 !== 0) return;
    for (const t of this.towers) {
      if (!t.alive) continue;

      // Check if tower is destroyed
      if (t.hp <= 0) {
        t.alive = false;
        t.hp = 0;
        // Screen shake on tower destruction
        this.cameras.main.shake(200, 0.012);
        // Quest: track tower kills (attacker is enemy of tower)
        const towerKillerTeam: 1 | 2 = t.team === 1 ? 2 : 1;
        this._questTowersDestroyed[towerKillerTeam]++;
        if (t.sprite) { t.sprite.destroy(); t.sprite = null; }
        if (t.hpBar) { t.hpBar.clear(); t.hpBar.destroy(); t.hpBar = null; }
        if (t.hpText) { t.hpText.destroy(); t.hpText = null; }
        if (t.rangeCircle) { t.rangeCircle.destroy(); t.rangeCircle = null; }
        if (t.label) { t.label.destroy(); t.label = null; }
        // Death explosion
        if (this.textures.exists('ts_explosion01')) {
          const fx = this.add.sprite(t.x, t.y, 'ts_explosion01')
            .setScale(0.8).setDepth(10).setOrigin(0.5);
          fx.play('ts_explosion01_anim');
          fx.once('animationcomplete', () => fx.destroy());
        }
        continue;
      }

      // Cooldown
      t.attackTimer -= delta;
      if (t.attackTimer > 0) continue;

      // Find nearest enemy unit in range (spatial grid lookup)
      let bestTarget: HUnit | null = null;
      let bestDist = Infinity;
      const towerNearby = this.getNearbyUnits(t.x, t.y, t.range);
      for (const u of towerNearby) {
        if (u.dead || u.team === t.team || u.team === 0) continue;
        const dx = u.x - t.x, dy = u.y - t.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist < bestDist) {
          bestDist = dist;
          bestTarget = u;
        }
      }

      if (!bestTarget) continue;

      // Fire!
      t.attackTimer = t.attackCooldown;

      // Spawn animated projectile sprite
      const proj = this.add.sprite(t.x, t.y - 30, 'tower_projectile')
        .setScale(0.4)
        .setDepth(50)
        .setOrigin(0.5);
      proj.play('tower_proj_anim');

      // Calculate splash targets at time of fire (spatial grid lookup)
      const splashList: { id: number; dmg: number }[] = [];
      const towerSplashNearby = this.getNearbyUnits(bestTarget.x, bestTarget.y, t.splashRange);
      for (const o of towerSplashNearby) {
        if (o.dead || o.id === bestTarget.id || o.team === t.team || o.team === 0) continue;
        const sd = Math.sqrt((o.x - bestTarget.x) ** 2 + (o.y - bestTarget.y) ** 2);
        if (sd <= t.splashRange) {
          const falloff = 1 - (sd / t.splashRange) * 0.5;
          splashList.push({ id: o.id, dmg: Math.round(t.damage * 0.6 * falloff) });
        }
      }

      // Queue as pending hit with projectile tracking
      this.pendingHits.push({
        attackerId: -2, // -2 = tower
        targetId: bestTarget.id,
        nexusTeam: 0,
        dmg: t.damage,
        splashTargets: splashList,
        timer: 3000,
        isTroll: false,
        isRanged: true,
        isSplash: splashList.length > 0,
        isCrit: false,
        projectile: null, // we track the sprite separately
        projX: t.x, projY: t.y - 30,
        projSpeed: TOWER_PROJ_SPEED,
      });

      // Store the sprite on the last pending hit for tracking
      // We use a slightly different approach — store ref on the pending hit's projectile field
      // by wrapping the sprite in a container
      const projContainer = this.add.container(t.x, t.y - 30).setDepth(50);
      projContainer.add(proj);
      proj.setPosition(0, 0);
      this.pendingHits[this.pendingHits.length - 1].projectile = projContainer;
      this.pendingHits[this.pendingHits.length - 1].projX = t.x;
      this.pendingHits[this.pendingHits.length - 1].projY = t.y - 30;
    }

    this.drawTowerBars();
  }

  private drawNexusBars() {
    for (const n of this.nexuses) {
      const curHp = Math.ceil(n.hp);
      const g = n.hpBar!;
      // Skip bar redraw if HP unchanged
      if ((n as any)._prevHp !== curHp) {
        (n as any)._prevHp = curHp;
        g.clear();
        const pct = Math.max(0, n.hp / n.maxHp);
        const w = 80, h = 8;
        g.fillStyle(0x000000, 0.6);
        g.fillRoundedRect(n.x - w / 2, n.y + 38, w, h, 4);
        g.fillStyle(pct > 0.5 ? 0x45E6B0 : pct > 0.25 ? 0xFFD93D : 0xFF5555);
        g.fillRoundedRect(n.x - w / 2, n.y + 38, w * pct, h, 4);
        n.hpText!.setText(`${Math.max(0, Math.ceil(n.hp))}/${n.maxHp}`);
      }

      // Show stockpile near nexus — only update text when values change
      const stock = this.baseStockpile[n.team as 1 | 2];
      const stockKey = `stock_${n.team}`;
      if (!this.hudTexts[stockKey]) {
        const stockText = `🥕${stock.carrot} 🍖${stock.meat} 💎${stock.crystal} ⚙️${stock.metal}`;
        this.hudTexts[stockKey] = this.add.text(n.x, n.y + 65, stockText, {
          fontSize: '13px', color: '#f0e8ff', fontFamily: '"Nunito", sans-serif', fontStyle: 'bold',
          stroke: '#000', strokeThickness: 3, backgroundColor: 'rgba(0,0,0,0.5)',
          padding: { x: 6, y: 2 },
        }).setOrigin(0.5).setDepth(55);
        (n as any)._prevStock = stockText;
      } else if (this._frameCount % 20 === 0) {
        const stockText = `🥕${stock.carrot} 🍖${stock.meat} 💎${stock.crystal} ⚙️${stock.metal}`;
        if ((n as any)._prevStock !== stockText) {
          this.hudTexts[stockKey].setText(stockText);
          (n as any)._prevStock = stockText;
        }
      }
      // Scale inversely with zoom — only recalc when zoom changes
      const zoom = this.cameras.main.zoom;
      if ((n as any)._prevZoom !== zoom) {
        (n as any)._prevZoom = zoom;
        const invScale = Math.max(0.8, 1.0 / zoom);
        this.hudTexts[stockKey].setScale(invScale);
        if (n.label) n.label.setScale(invScale);
      }
    }
  }

  // ─── CAMERA ──────────────────────────────────────────────────

  /** Recalculates camera viewport to fill entire browser window. */
  private updateLayout() {
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const cam = this.cameras.main;
    cam.setViewport(0, 0, vw, vh);
  }

  private setupCamera() {
    const cam = this.cameras.main;
    cam.setBounds(0, 0, WORLD_W, WORLD_H);

    // Initial layout
    this.updateLayout();

    // Re-layout on window/game resize
    this._resizeHandler = () => this.updateLayout();
    window.addEventListener('resize', this._resizeHandler);
    this.scale.on('resize', this._resizeHandler);

    const myBase = this.myTeam === 1 ? P1_BASE : P2_BASE;
    const camOffX = this.myTeam === 1 ? 400 : -400;
    const camOffY = this.myTeam === 1 ? -400 : 400;
    cam.centerOn(myBase.x + camOffX, myBase.y + camOffY);
    cam.setZoom(0.7);
    this.input.on('wheel', (ptr: Phaser.Input.Pointer, _over: any, _dx: number, deltaY: number) => {
      const vpW = cam.width;
      const vpH = cam.height;
      const minZoom = Math.max(vpW / WORLD_W, vpH / WORLD_H, 0.3);
      const oldZoom = cam.zoom;
      const newZoom = Phaser.Math.Clamp(oldZoom + (deltaY > 0 ? -0.05 : 0.05), minZoom, 2.0);
      if (newZoom === oldZoom) return;

      // Zoom toward cursor: keep the world point under the mouse fixed
      const worldBefore = cam.getWorldPoint(ptr.x, ptr.y);
      cam.zoom = newZoom;
      cam.preRender();
      const worldAfter = cam.getWorldPoint(ptr.x, ptr.y);
      cam.scrollX -= worldAfter.x - worldBefore.x;
      cam.scrollY -= worldAfter.y - worldBefore.y;
    });

    // Drag to pan (or editor drag)
    this.input.on('pointerdown', (ptr: Phaser.Input.Pointer) => {
      if (this.editorMode && ptr.leftButtonDown()) {
        const wx = ptr.worldX, wy = ptr.worldY;
        const hit = this.editorHitTest(wx, wy);
        if (hit) {
          this.editorSelected = hit;
          this.editorDragging = true;
          const obj = this.editorGetSelectedPos();
          this.editorDragOffsetX = obj ? obj.x - wx : 0;
          this.editorDragOffsetY = obj ? obj.y - wy : 0;
          this.dragMoved = false;
          this.editorUpdateHighlight();
          this.editorUpdatePanel();
          return;
        } else {
          this.editorSelected = null;
          this.editorUpdateHighlight();
          this.editorUpdatePanel();
        }
      }
      if (ptr.rightButtonDown() || ptr.middleButtonDown() || ptr.leftButtonDown()) {
        this.isDragging = true;
        this.dragMoved = false;
        this.dragPrevX = ptr.x;
        this.dragPrevY = ptr.y;
      }
    });
    this.input.on('pointermove', (ptr: Phaser.Input.Pointer) => {
      if (this.editorDragging && this.editorSelected) {
        this.dragMoved = true;
        this.editorMoveSelected(ptr.worldX + this.editorDragOffsetX, ptr.worldY + this.editorDragOffsetY);
        this.editorUpdateHighlight();
        return;
      }
      if (!this.isDragging) return;
      const dx = ptr.x - this.dragPrevX;
      const dy = ptr.y - this.dragPrevY;
      if (Math.abs(dx) > 3 || Math.abs(dy) > 3) this.dragMoved = true;
      cam.scrollX -= dx / cam.zoom;
      cam.scrollY -= dy / cam.zoom;
      this.dragPrevX = ptr.x;
      this.dragPrevY = ptr.y;
    });
    this.input.on('pointerup', (ptr: Phaser.Input.Pointer) => {
      if (this.editorDragging) {
        this.editorDragging = false;
        if (this.dragMoved) this.editorAutoSave();
        this.editorUpdatePanel();
        this.isDragging = false;
        return;
      }
      if (!this.dragMoved && ptr.leftButtonReleased() && !this.editorMode) {
        // Click (not drag) — try to select a unit for debug
        const wx = ptr.worldX, wy = ptr.worldY;
        let closest: HUnit | null = null, closestD = 40; // 40px click radius
        for (const u of this.units) {
          if (u.dead) continue;
          const d = Math.sqrt((u.x - wx) ** 2 + (u.y - wy) ** 2);
          if (d < closestD) { closestD = d; closest = u; }
        }
        this.setDebugUnit(closest);
      }
      this.isDragging = false;
    });
  }

  private updateCamera(dt: number) {
    const cam = this.cameras.main;
    const s = 800 * dt / cam.zoom;
    if (this.arrowKeys['UP'].isDown) cam.scrollY -= s;
    if (this.arrowKeys['DOWN'].isDown) cam.scrollY += s;
    if (this.arrowKeys['LEFT'].isDown) cam.scrollX -= s;
    if (this.arrowKeys['RIGHT'].isDown) cam.scrollX += s;
  }

  // ─── INPUT ───────────────────────────────────────────────────

  private setupInput() {
    this.arrowKeys = {
      UP: this.input.keyboard!.addKey('UP'),
      DOWN: this.input.keyboard!.addKey('DOWN'),
      LEFT: this.input.keyboard!.addKey('LEFT'),
      RIGHT: this.input.keyboard!.addKey('RIGHT'),
    };
    this.adKeys = {
      A: this.input.keyboard!.addKey('A'),
      D: this.input.keyboard!.addKey('D'),
    };
    this.spaceKey = this.input.keyboard!.addKey('SPACE');
    this.spaceKey.on('down', () => {
      if (document.activeElement === this.textInput) return;
      this.toggleSpeechMute();
    });

    // Voice Orb replaces old bottom command bar
    const gc = document.getElementById('game-container')!;
    this.voiceOrb = new VoiceOrb(gc);
    this.voiceOrb.onTextSubmit = (text) => this.issueCommand(text);
    this.talkingPortrait = new TalkingPortrait(gc);
    // Store ref for keyboard guard compatibility
    this.textInput = this.voiceOrb.getTextInput();
    // Expose Phaser keyboard for VoiceOrb focus/blur guards
    (window as any).__phaserKeyboard = this.input.keyboard;

    // Always-on voice — no push-to-talk, auto-starts
    this.voiceStatusEl = null;
    this.setupVoice();

    // Number keys 1-5: dynamic control group selection
    // 1=all, 2-5=dynamic from available unit types
    const numKeyCodes = [
      Phaser.Input.Keyboard.KeyCodes.ONE,
      Phaser.Input.Keyboard.KeyCodes.TWO,
      Phaser.Input.Keyboard.KeyCodes.THREE,
      Phaser.Input.Keyboard.KeyCodes.FOUR,
      Phaser.Input.Keyboard.KeyCodes.FIVE,
    ];
    for (let n = 0; n < numKeyCodes.length; n++) {
      const k = this.input.keyboard!.addKey(numKeyCodes[n]);
      const slotIdx = n; // 0=all, 1-4=dynamic
      k.on('down', () => {
        if (document.activeElement === this.textInput) return;
        if (slotIdx === 0) {
          this.selectedHoard = 'all';
        } else {
          const available = this.getAvailableHoards().filter(h => h !== 'all');
          const idx = slotIdx - 1;
          if (idx < available.length) this.selectedHoard = available[idx];
          else return; // slot empty, ignore
        }
        this.updateSelectionLabel();
        this.updateTopBar();
        // Quick feedback
        const count = this.selectedHoard === 'all'
          ? this.units.filter(u => u.team === this.myTeam && !u.dead).length
          : this.units.filter(u => u.team === this.myTeam && !u.dead && u.type === this.selectedHoard).length;
        const emoji = this.selectedHoard === 'all' ? '' : (ANIMALS[this.selectedHoard]?.emoji + ' ' || '');
        const name = this.selectedHoard === 'all' ? 'All units' : cap(this.selectedHoard);
        this.showFeedback(`${emoji}${name} selected (${count})`, '#FFD93D');
      });
    }

    // Q / E to cycle through hoards
    const qKey = this.input.keyboard!.addKey('Q');
    const eKey = this.input.keyboard!.addKey('E');
    qKey.on('down', () => {
      if (document.activeElement === this.textInput) return;
      this.cycleHoard(-1);
    });
    eKey.on('down', () => {
      if (document.activeElement === this.textInput) return;
      this.cycleHoard(1);
    });

    // TAB still cycles
    const tabKey = this.input.keyboard!.addKey('TAB');
    tabKey.on('down', (event: KeyboardEvent) => {
      if (document.activeElement === this.textInput) return;
      event.preventDefault();
      this.cycleHoard(event.shiftKey ? -1 : 1);
    });

    // F2 — toggle in-game map editor
    const f2Key = this.input.keyboard!.addKey('F2');
    f2Key.on('down', () => {
      if (document.activeElement === this.textInput) return;
      this.toggleEditorMode();
    });

    // F3 — toggle fog of war
    const f3Key = this.input.keyboard!.addKey('F3');
    f3Key.on('down', () => {
      if (document.activeElement === this.textInput) return;
      this.fogDisabled = !this.fogDisabled;
      this.showFeedback(this.fogDisabled ? 'Fog of War: OFF' : 'Fog of War: ON', '#FFD93D');
    });

    // T — toggle text input on voice orb
    const tKey = this.input.keyboard!.addKey('T');
    tKey.on('down', () => {
      if (document.activeElement === this.textInput) return;
      this.voiceOrb?.showTextInput();
    });
  }

  private cycleHoard(direction: 1 | -1) {
    // Build list of available hoards: 'all' + types the player currently has
    const available = this.getAvailableHoards();
    const currentIdx = available.indexOf(this.selectedHoard);
    let nextIdx = currentIdx + direction;
    if (nextIdx < 0) nextIdx = available.length - 1;
    if (nextIdx >= available.length) nextIdx = 0;
    this.selectedHoard = available[nextIdx];
    this.updateSelectionLabel();

    // Quick feedback showing what's selected
    const count = this.selectedHoard === 'all'
      ? this.units.filter(u => u.team === this.myTeam && !u.dead).length
      : this.units.filter(u => u.team === this.myTeam && !u.dead && u.type === this.selectedHoard).length;
    const emoji = this.selectedHoard === 'all' ? '' : (ANIMALS[this.selectedHoard]?.emoji + ' ' || '');
    const name = this.selectedHoard === 'all' ? 'All units' : cap(this.selectedHoard);
    this.showFeedback(`${emoji}${name} selected (${count})`, '#FFD93D');
  }

  private getAvailableHoards(): string[] {
    const myTypes = new Set<string>();
    for (const u of this.units) {
      if (u.team === this.myTeam && !u.dead) myTypes.add(u.type);
    }
    // Always include 'all', then only types we have units of, in tier order
    const available = ['all'];
    for (const type of this.allHoardTypes) {
      if (type !== 'all' && myTypes.has(type)) available.push(type);
    }
    return available;
  }

  private setupVoice() {
    // 1. Create TTS service with coordination callbacks
    this.ttsService = new TtsService();
    this.ttsService.onPlayStart = (charId: string, audioEl: HTMLAudioElement) => {
      this.scribeService?.pause();
      this.voiceOrb?.setState('speaking');
      this.talkingPortrait?.startTalking(charId, audioEl);
      // Also pause Web Speech API fallback
      if (this.recognition && this.isListening) {
        try { this.recognition.stop(); } catch (_e) { /* */ }
      }
    };
    this.ttsService.onPlayEnd = (_charId: string) => {
      this.scribeService?.resume();
      this.voiceOrb?.setState('listening');
      this.talkingPortrait?.stopTalking();
      // Resume Web Speech API fallback
      if (this.recognition && !this.ttsService?.isPlaying) {
        this.startListening();
      }
    };

    // 2. Create ScribeService (ElevenLabs Scribe v2 Realtime STT)
    this.scribeService = new ScribeService({
      onPartialTranscript: (text) => {
        this.voiceOrb?.setPartialTranscript(text);
      },
      onFinalTranscript: (text) => {
        if (text.trim()) {
          this.voiceOrb?.setPartialTranscript('');
          this.issueCommand(text.trim());
        }
      },
      onStateChange: (state) => {
        if (state === 'listening') this.voiceOrb?.setState('listening');
        else if (state === 'error') this.voiceOrb?.setState('error');
        else if (state === 'connecting') this.voiceOrb?.setState('idle');
      },
    });

    // 3. If Scribe is available, use it; otherwise fall back to Web Speech API
    if (this.scribeService.isAvailable()) {
      console.log('[Voice] ✓ Using ElevenLabs Scribe v2 Realtime STT');
      this.scribeService.start();
    } else {
      console.log('[Voice] ✗ No ElevenLabs key — falling back to Web Speech API');
      this.setupWebSpeechFallback();
      this.showFallbackWarning();
    }

    // Test TTS on startup — you should hear "Ready for battle, commander."
    console.log('[Voice] Firing test TTS...');
    this.ttsService!.test();
  }

  /** Show AI response text on both voice orb and portrait speech bubble */
  private showAIResponse(text: string, durationMs?: number): void {
    this.voiceOrb?.showResponse(text, durationMs);
    this.talkingPortrait?.showMessage(text);
  }

  private resumeMicIfNeeded() {
    if (this._speechMuted) { this.voiceOrb?.setState('muted'); return; }
    if (this.ttsService?.isPlaying) return; // TTS callbacks handle resume
    this.scribeService?.resume();
    if (this.recognition && !this.scribeService?.isAvailable()) {
      this.startListening();
    }
    this.voiceOrb?.setState('listening');
  }

  private toggleSpeechMute() {
    this._speechMuted = !this._speechMuted;
    if (this._speechMuted) {
      // Mute: pause STT
      this.scribeService?.pause();
      if (this.recognition && this.isListening) {
        try { this.recognition.stop(); } catch (_e) { /* */ }
        this.isListening = false;
      }
      this.voiceOrb?.setState('muted');
      this.showFeedback('Speech muted (SPACE to unmute)', '#888');
    } else {
      // Unmute: resume STT
      if (this.scribeService?.isAvailable()) {
        this.scribeService.resume();
      } else if (this.recognition) {
        this.startListening();
      }
      this.voiceOrb?.setState('listening');
      this.showFeedback('Speech unmuted', '#45E6B0');
    }
  }

  private showFallbackWarning() {
    const el = document.createElement('div');
    el.style.cssText = 'position:fixed;top:20px;left:50%;transform:translateX(-50%);z-index:10000;background:linear-gradient(135deg,rgba(180,60,30,0.95),rgba(160,50,20,0.97));color:#fff;font-family:Fredoka,sans-serif;font-size:18px;font-weight:600;padding:16px 32px;border-radius:12px;border:2px solid rgba(255,180,100,0.4);box-shadow:0 8px 32px rgba(0,0,0,0.5);text-align:center;max-width:600px;animation:notif-era-child 400ms ease-out forwards;cursor:pointer;';
    el.innerHTML = '<div style="font-size:22px;margin-bottom:6px;">\u26A0\uFE0F Using Browser Speech Fallback</div>'
      + '<div style="font-size:15px;font-weight:400;font-family:Nunito,sans-serif;color:rgba(255,255,255,0.85);">ElevenLabs API key missing \u2014 voice quality will be limited. Add VITE_ELEVENLABS_API_KEY to your .env file.</div>';
    el.addEventListener('click', () => el.remove());
    document.body.appendChild(el);
    setTimeout(() => { if (el.parentNode) el.style.animation = 'notif-start-out 500ms ease-in forwards'; setTimeout(() => el.remove(), 500); }, 8000);
  }

  /** Web Speech API fallback — routed through VoiceOrb */
  private setupWebSpeechFallback() {
    const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SR) return;
    const rec = new SR();
    rec.continuous = true;
    rec.interimResults = true;
    rec.lang = 'en-US';
    rec.onresult = (e: any) => {
      // Only look at the latest result (not accumulated history)
      const lastResult = e.results[e.results.length - 1];
      const text = lastResult[0].transcript;
      // Show live transcript on voice orb
      this.voiceOrb?.setPartialTranscript(text);
      if (lastResult.isFinal && text.trim()) {
        this.voiceOrb?.setPartialTranscript('');
        this.issueCommand(text.trim());
      }
    };
    rec.onerror = () => this.restartVoice();
    rec.onend = () => this.restartVoice();
    this.recognition = rec;
    this.startListening();
    this.voiceOrb?.setState('listening');
  }

  /** Initialize or reconnect the ElevenLabs voice agent session */
  private async initVoiceAgentSession() {
    if (!this.voiceAgent) return;
    const team = this.isDebug ? this.debugControlTeam : this.myTeam;
    const ctx = this.buildVoiceAgentContext(team);
    const ok = await this.voiceAgent.startSession(ctx);
    if (!ok) {
      console.warn('[Voice] ElevenLabs session failed to start, using Web Speech API fallback');
    }
  }

  /** Build game context for the ElevenLabs voice agent */
  private buildVoiceAgentContext(team: 1 | 2): ELGameContext {
    const base = team === 1 ? P1_BASE : P2_BASE;
    const countBy: Record<string, { count: number; gathering: number }> = {};
    for (const u of this.units) {
      if (u.team === team && !u.dead) {
        if (!countBy[u.type]) countBy[u.type] = { count: 0, gathering: 0 };
        countBy[u.type].count++;
        if (u.loop) countBy[u.type].gathering++;
      }
    }
    const myUnits = Object.entries(countBy).map(([type, info]) => ({
      type, count: info.count, tier: ANIMALS[type]?.tier || 1, gathering: info.gathering,
    }));

    const campCtx = this.camps
      .filter(c => c.owner === team || c.scouted || this.isInVision(c.x, c.y))
      .map((c, i) => {
        const inVision = this.isInVision(c.x, c.y);
        const defenders = inVision ? this.units.filter(u => u.campId === c.id && u.team === 0 && !u.dead).length : 0;
        const cost = SPAWN_COSTS[c.animalType];
        const effectiveOwner = inVision ? c.owner : c.lastSeenOwner;
        return {
          name: c.name, animalType: c.animalType, tier: ANIMALS[c.animalType]?.tier || 1, index: i,
          owner: effectiveOwner === 0 ? 'NEUTRAL' : effectiveOwner === team ? 'YOURS' : 'ENEMY',
          x: Math.round(c.x), y: Math.round(c.y),
          dist: Math.round(pdist(c, base)),
          defenders, storedFood: c.owner === team ? c.storedFood : 0, spawnCost: cost?.amount || 0,
        };
      })
      .sort((a, b) => a.dist - b.dist);

    const myNex = this.nexuses.find(n => n.team === team)!;
    const enemyNex = this.nexuses.find(n => n.team !== team)!;
    const enemyNexVisible = this.fogDisabled || this.isInVision(enemyNex.x, enemyNex.y);
    const nexusHp = { mine: Math.round(myNex.hp), enemy: enemyNexVisible ? Math.round(enemyNex.hp) : -1 };

    const alive = this.groundItems.filter(g => !g.dead && (this.fogDisabled || this.isInVision(g.x, g.y)));
    const selUnits = this.units.filter(u => u.team === team && !u.dead && (this.selectedHoard === 'all' || u.type === this.selectedHoard));
    const hcx = selUnits.length > 0 ? Math.round(selUnits.reduce((s, u) => s + u.x, 0) / selUnits.length) : base.x;
    const hcy = selUnits.length > 0 ? Math.round(selUnits.reduce((s, u) => s + u.y, 0) / selUnits.length) : base.y;

    const activeEvents = this.mapEvents.filter(e => e.state === 'active').map(e => {
      const def = MAP_EVENT_DEFS[e.type];
      let info = '', howToWin = '';
      if (e.type === 'mercenary_outpost') { info = `deliver ${e.data.cost?.amount} ${e.data.cost?.type}`; howToWin = 'Deliver required resources to outpost.'; }
      else if (e.type === 'kill_bounty') { info = `kill ${e.data.targetType}s`; howToWin = 'Hunt marked targets near the event.'; }
      else if (e.type === 'bottomless_pit') { info = `sacrifice ${e.data.sacrificesNeeded} units`; howToWin = 'Send units to sacrifice.'; }
      else if (e.type === 'hungry_bear') { info = `feed carrots/meat`; howToWin = 'Deliver food to the bear.'; }
      else if (e.type === 'warchest') { info = `attack to break`; howToWin = 'Attack the chest.'; }
      else if (e.type === 'fungal_bloom') { info = `gather in zone`; howToWin = 'Gather mushroom resources.'; }
      return { type: e.type, emoji: def.emoji, name: def.name, x: Math.round(e.x), y: Math.round(e.y), timeLeft: Math.round(e.timer / 1000), info, howToWin };
    });

    return {
      myUnits, camps: campCtx, nexusHp,
      resources: { ...this.baseStockpile[team] },
      groundCarrots: alive.filter(g => g.type === 'carrot').length,
      groundMeat: alive.filter(g => g.type === 'meat').length,
      groundCrystals: alive.filter(g => g.type === 'crystal').length,
      gameTime: this.gameTime,
      selectedHoard: this.selectedHoard,
      hoardCenter: { x: hcx, y: hcy },
      carrotZones: this.mapDef?.carrotZones || [],
      activeEvents,
      activeBuffs: this.teamBuffs.filter(b => b.team === team).map(b => ({
        stat: b.stat, amount: b.amount, remaining: Math.round(b.remaining / 1000),
      })),
    };
  }

  private startListening() {
    if (this.isListening || !this.recognition) return;
    this.isListening = true;
    try { this.recognition.start(); } catch (_e) { /* */ }
  }

  private stopListening() {
    if (!this.isListening) return;
    this.isListening = false;
    try { this.recognition?.stop(); } catch (_e) { /* */ }
  }

  private restartVoice() {
    this.isListening = false;
    // Auto-restart after a small delay to avoid rapid restart loops
    setTimeout(() => {
      if (!this.gameOver) this.startListening();
    }, 500);
  }

  // ─── HUD ─────────────────────────────────────────────────────

  private setupHUD() {
    const cam = this.cameras.main;
    const gc = document.getElementById('game-container') ?? document.body;

    // Feedback (bottom center, above command input)
    this.hudTexts['feedback'] = this.add.text(cam.width / 2, cam.height - 105, '', {
      fontSize: '16px', color: '#45E6B0', fontFamily: '"Nunito", sans-serif', fontStyle: 'bold',
    }).setOrigin(0.5).setScrollFactor(0).setDepth(100).setAlpha(0);

    // Phaser selection label — hidden (top bar replaces it)
    this.selectionLabel = this.add.text(0, 0, '', {
      fontSize: '1px', color: '#6a5a4a',
    }).setAlpha(0).setScrollFactor(0).setDepth(0);


    // Armory panel (hidden, used internally for equipment tracking)
    const equipPanel = document.createElement('div');
    equipPanel.id = 'horde-equip-panel';
    equipPanel.style.cssText = 'display:none;';
    this.equipPanelEl = equipPanel;

    // ═══ TOP CONTROL GROUP BAR (keys 1-5) ═══
    this.setupTopBar(gc);

    // ═══ RIGHT RESOURCE PANEL ═══
    this.setupResourcePanel(gc);

    // ═══ LEFT COMMAND LOG PANEL ═══
    this.setupCmdLogPanel(gc);

    // ═══ QUEST CARDS ═══
    this.setupQuestPanel(gc);

    // ═══ BOTTOM-RIGHT MINIMAP ═══
    this.setupMinimap(gc);

    // Update top bar with initial state
    this.updateTopBar();

    this.setupNotificationSystem();
  }

  // ─── SETUP: TOP CONTROL GROUP BAR ─────────────────────────────
  private setupTopBar(gc: HTMLElement) {
    const bar = document.createElement('div');
    bar.id = 'horde-top-bar';
    gc.appendChild(bar);
    this.topBarEl = bar;
  }

  private updateTopBar() {
    if (!this.topBarEl) return;
    const available = this.getAvailableHoards().filter(h => h !== 'all');
    // Slot 1 = all, slots 2-5 = dynamic unit types
    const slots: { key: number; id: string; emoji: string; name: string; count: number }[] = [
      { key: 1, id: 'all', emoji: '\u2694\uFE0F', name: 'ALL',
        count: this.units.filter(u => u.team === this.myTeam && !u.dead).length },
    ];
    for (let i = 0; i < Math.min(4, available.length); i++) {
      const t = available[i];
      const def = ANIMALS[t];
      if (!def) continue;
      slots.push({
        key: i + 2, id: t, emoji: def.emoji, name: cap(t).toUpperCase(),
        count: this.units.filter(u => u.team === this.myTeam && !u.dead && u.type === t).length,
      });
    }
    let html = '';
    for (const s of slots) {
      const active = s.id === this.selectedHoard;
      html += `<div class="ctrl-card${active ? ' active' : ''}" data-hoard="${s.id}">
        <div class="hotkey">${s.key}</div>
        <div style="display:flex;align-items:center;justify-content:center;min-height:56px;">
          ${avatarImg(s.id === 'all' ? '' : s.id, 56) || `<span style="font-size:36px;">${s.emoji}</span>`}
        </div>
        <div style="font-size:11px;font-weight:800;color:#4a3520;letter-spacing:0.5px;">${s.name}</div>
        <div style="font-size:14px;font-weight:700;color:#2a1a0a;">${s.count}</div>
      </div>`;
    }
    this.topBarEl.innerHTML = html;
    // Click handlers + just-selected pop animation
    this.topBarEl.querySelectorAll('.ctrl-card').forEach(card => {
      const el = card as HTMLElement;
      el.addEventListener('click', () => {
        const hoard = el.getAttribute('data-hoard');
        if (hoard) { this.selectedHoard = hoard; this.updateSelectionLabel(); }
      });
      // Apply pop animation on active card if selection just changed
      if (el.classList.contains('active')) {
        el.classList.add('just-selected');
        setTimeout(() => el.classList.remove('just-selected'), 300);
      }
    });
  }

  // ─── SETUP: RIGHT RESOURCE PANEL ──────────────────────────────
  private setupResourcePanel(gc: HTMLElement) {
    const panel = document.createElement('div');
    panel.id = 'horde-resource-panel';
    panel.innerHTML = `
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px;">
        <span id="hud-timer" style="font-size:15px;font-weight:700;color:#8B5E34;font-family:'Fredoka',sans-serif;">0:00</span>
        <span id="hud-era" style="font-size:11px;color:#6a5a4a;letter-spacing:1px;"></span>
      </div>
      <div id="hud-resources"></div>
    `;
    gc.appendChild(panel);
    this.resourcePanelEl = panel;
  }

  // ─── SETUP: LEFT COMMAND LOG PANEL ────────────────────────────
  private setupCmdLogPanel(gc: HTMLElement) {
    const panel = document.createElement('div');
    panel.id = 'horde-cmd-log';
    panel.innerHTML = `
      <div style="font-size:13px;font-weight:800;color:#4a3520;letter-spacing:1.5px;margin-bottom:6px;font-family:'Fredoka',sans-serif;">ACTIVE COMMANDS</div>
      <div id="horde-cmd-log-entries"></div>
    `;
    gc.appendChild(panel);
    this.cmdLogPanelEl = panel;
  }

  // ─── SETUP: QUEST CARDS ───────────────────────────────────────
  private setupQuestPanel(gc: HTMLElement) {
    const panel = document.createElement('div');
    panel.id = 'horde-quest-panel';
    // Position below resource panel
    panel.style.top = '140px';
    gc.appendChild(panel);
    this.questPanelEl = panel;
    this.questManager = new QuestManager(this.myTeam);
  }

  private buildQuestState(): QState {
    const team = this.myTeam;
    const enemyTeam: 1 | 2 = team === 1 ? 2 : 1;
    const aliveUnits = this.units.filter(u => u.team === team && !u.dead);
    const typeCounts: Record<string, number> = {};
    let equipped = 0;
    for (const u of aliveUnits) {
      typeCounts[u.type] = (typeCounts[u.type] || 0) + 1;
      if (u.equipment) equipped++;
    }
    const rd = this.matchStats.resourcesDelivered[team];
    const st = this.baseStockpile[team];
    const totalStockpiled = st.carrot + st.meat + st.crystal + st.metal;
    const activeBuffCount = this.teamBuffs.filter(b => b.team === team && b.remaining > 0).length
      + this.eventBuffs.filter(b => b.team === team && b.timer > 0).length;
    // Build minimal unit list for tier checks
    const unitSnap = this.units.filter(u => !u.dead).map(u => ({
      id: u.id, type: u.type, team: u.team, dead: u.dead,
      equipment: u.equipment, equipLevel: u.equipLevel,
      tier: ANIMALS[u.type]?.tier || 1,
    }));
    // Unlocked equipment as simple Map<string, number>
    const eqMap = new Map<string, number>();
    this.unlockedEquipment[team].forEach((lvl, eqType) => eqMap.set(eqType, lvl));

    return {
      alive: aliveUnits.length,
      typeCount: Object.keys(typeCounts).length,
      typeCounts,
      equipped,
      units: unitSnap,
      camps: this.camps.map(c => ({ owner: c.owner })),
      myCamps: this.camps.filter(c => c.owner === team).length,
      towers: this.towers.map(t => ({ team: t.team, alive: t.alive, hp: t.hp, maxHp: t.maxHp })),
      nexuses: this.nexuses.map(n => ({ team: n.team, hp: n.hp, maxHp: n.maxHp })),
      currentEra: this.currentEra,
      gameTime: this.gameTime,
      totalKills: this.matchStats.totalKills[team],
      campsCaptured: this.matchStats.campsCaptured[team],
      resourcesDelivered: { ...rd },
      totalResourcesStockpiled: totalStockpiled,
      stockpile: { ...st },
      peakArmySize: this.matchStats.peakArmySize[team],
      unlockedEquipment: eqMap,
      towersDestroyed: this._questTowersDestroyed[team],
      eventsWon: this._questEventsWon[team],
      teamBuffs: activeBuffCount,
      myTeam: team,
      enemyTeam,
    };
  }

  private updateQuestPanel(): void {
    if (!this.questManager || !this.questPanelEl) return;
    const quests = this.questManager.getActiveQuests();
    const total = this.questManager.totalCount;
    const done = this.questManager.completedCount;
    let html = `<div style="font-size:11px;font-weight:800;color:#4a3520;letter-spacing:1.5px;margin-bottom:4px;font-family:'Fredoka',sans-serif;display:flex;justify-content:space-between;">
      <span>QUESTS</span><span style="color:#6a5a4a;font-weight:600;">${done}/${total}</span>
    </div>`;
    for (const { def, progress } of quests) {
      const pct = Math.round(progress * 100);
      const cur = def.target ? Math.min(def.target, Math.round(progress * def.target)) : (progress >= 1 ? 1 : 0);
      const counter = def.target ? `${cur}/${def.target}` : '';
      const barColor = pct >= 100 ? '#45E6B0' : '#c4a96a';
      html += `<div style="background:rgba(245,235,220,0.92);border:1px solid rgba(139,115,85,0.35);border-radius:8px;padding:6px 8px;display:flex;align-items:center;gap:6px;">
        <span style="font-size:18px;line-height:1;">${def.icon}</span>
        <div style="flex:1;min-width:0;">
          <div style="font-size:11px;font-weight:700;color:#2a1a0a;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${def.title}</div>
          <div style="font-size:9px;color:#6a5a4a;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${def.desc}</div>
          <div style="margin-top:3px;height:5px;background:rgba(0,0,0,0.1);border-radius:3px;overflow:hidden;">
            <div style="height:100%;width:${pct}%;background:${barColor};border-radius:3px;transition:width 0.3s;"></div>
          </div>
        </div>
        ${counter ? `<span style="font-size:10px;font-weight:700;color:#4a3520;white-space:nowrap;">${counter}</span>` : ''}
      </div>`;
    }
    if (html !== this._prevQuestHTML) {
      this.questPanelEl.innerHTML = html;
      this._prevQuestHTML = html;
    }
  }

  // ─── SETUP: MINIMAP ───────────────────────────────────────────
  private setupMinimap(gc: HTMLElement) {
    const wrapper = document.createElement('div');
    wrapper.id = 'horde-minimap';
    const canvas = document.createElement('canvas');
    canvas.width = 200;
    canvas.height = 200;
    canvas.style.cssText = 'width:100%;height:100%;display:block;';
    wrapper.appendChild(canvas);
    gc.appendChild(wrapper);
    this.minimapEl = canvas;
    this.minimapCtx = canvas.getContext('2d');

    // Pre-render terrain
    this.preRenderMinimapTerrain();

    // Click & drag to pan camera (standard RTS minimap)
    let dragging = false;
    const panTo = (e: MouseEvent) => {
      const rect = canvas.getBoundingClientRect();
      const mx = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
      const my = Math.max(0, Math.min(1, (e.clientY - rect.top) / rect.height));
      this.cameras.main.centerOn(mx * WORLD_W, my * WORLD_H);
    };
    wrapper.addEventListener('mousedown', (e) => {
      dragging = true;
      panTo(e);
      e.preventDefault();
    });
    window.addEventListener('mousemove', (e) => {
      if (dragging) panTo(e);
    });
    window.addEventListener('mouseup', () => { dragging = false; });
  }

  private preRenderMinimapTerrain() {
    const tc = document.createElement('canvas');
    tc.width = 200;
    tc.height = 200;
    const ctx = tc.getContext('2d')!;
    const tiles = this.mapDef?.tiles;
    if (tiles) {
      const cols = tiles[0]?.length || 0;
      const rows = tiles.length;
      const sx = 200 / (cols * TILE_SIZE);
      const sy = 200 / (rows * TILE_SIZE);
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          const t = tiles[r][c];
          let color = '#4a7a3a'; // grass (0)
          if (t === 2) color = '#2a5a8a'; // water
          else if (t === 1) color = '#3a6a2a'; // high_ground
          else if (t === 3) color = '#777'; // rock
          ctx.fillStyle = color;
          ctx.fillRect(c * TILE_SIZE * sx, r * TILE_SIZE * sy, Math.ceil(TILE_SIZE * sx), Math.ceil(TILE_SIZE * sy));
        }
      }
    } else {
      ctx.fillStyle = '#4a7a3a';
      ctx.fillRect(0, 0, 200, 200);
    }
    this.minimapTerrainCanvas = tc;
  }

  private updateMinimap() {
    const ctx = this.minimapCtx;
    if (!ctx || !this.minimapTerrainCanvas) return;
    // Restore terrain
    ctx.drawImage(this.minimapTerrainCanvas, 0, 0);
    const scaleX = 200 / WORLD_W;
    const scaleY = 200 / WORLD_H;

    // Draw camps as triangles
    for (const c of this.camps) {
      ctx.fillStyle = c.owner === this.myTeam ? '#4488ff' : c.owner === 0 ? '#888' : '#ff4444';
      const cx = c.x * scaleX, cy = c.y * scaleY;
      ctx.beginPath();
      ctx.moveTo(cx, cy - 4);
      ctx.lineTo(cx - 3, cy + 3);
      ctx.lineTo(cx + 3, cy + 3);
      ctx.closePath();
      ctx.fill();
    }

    // Draw nexuses as squares
    for (const n of this.nexuses) {
      ctx.fillStyle = n.team === this.myTeam ? '#4488ff' : '#ff4444';
      ctx.fillRect(n.x * scaleX - 4, n.y * scaleY - 4, 8, 8);
    }

    // Draw unit dots
    for (const u of this.units) {
      if (u.dead) continue;
      ctx.fillStyle = u.team === this.myTeam ? '#6699ff' : '#ff6666';
      ctx.fillRect(u.x * scaleX - 1, u.y * scaleY - 1, 2, 2);
    }

    // Camera viewport rect
    const cam = this.cameras.main;
    const left = cam.scrollX * scaleX;
    const top = cam.scrollY * scaleY;
    const w = (cam.width / cam.zoom) * scaleX;
    const h = (cam.height / cam.zoom) * scaleY;
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 1;
    ctx.strokeRect(left, top, w, h);
  }

  // ─── UPDATE: COMMAND LOG PANEL ────────────────────────────────
  private updateCmdLogPanel() {
    const entriesEl = document.getElementById('horde-cmd-log-entries');
    if (!entriesEl) return;
    const myT = this.myTeam;
    const available = this.selectedHoard === 'all'
      ? this.getAvailableHoards().filter(h => h !== 'all')
      : [this.selectedHoard];

    const modColors: Record<string, { bg: string; fg: string; label: string }> = {
      spread: { bg: 'rgba(30,100,220,0.2)', fg: '#1a60CC', label: '\u{1F4A0} Spread' },
      tight: { bg: 'rgba(200,100,20,0.2)', fg: '#B06000', label: '\u{1F91D} Tight' },
      safe: { bg: 'rgba(30,140,30,0.2)', fg: '#1a6a1a', label: '\u{1F6E1}\uFE0F Safe' },
      aggressive: { bg: 'rgba(200,50,50,0.2)', fg: '#BB2222', label: '\u{1F525} Aggressive' },
      rush: { bg: 'rgba(180,140,20,0.2)', fg: '#8B6914', label: '\u26A1 Rush' },
      efficient: { bg: 'rgba(120,60,180,0.2)', fg: '#7B2FBE', label: '\u{1F9E0} Efficient' },
    };

    let html = '';
    for (const hType of available) {
      const def = ANIMALS[hType];
      if (!def) continue;
      const wfKey = `${hType}_${myT}`;
      const wf = this.groupWorkflows[wfKey] as HWorkflow | undefined;
      const mods = this.groupModifiers[wfKey] as BehaviorMods | undefined;
      const lastCmd = this.lastHoardCommand[hType] || '';
      const displayCmd = (wf && wf.voiceCommand) ? wf.voiceCommand : lastCmd;
      const count = this.units.filter(u => u.team === myT && !u.dead && u.type === hType).length;

      html += `<div style="background:rgba(255,248,230,0.5);border:1px solid rgba(139,115,85,0.35);border-radius:8px;padding:6px 8px;margin-bottom:6px;">`;
      // Header
      html += `<div style="display:flex;align-items:center;gap:6px;margin-bottom:4px;">
        ${avatarImg(hType, 40) || `<span style="font-size:28px;">${def.emoji}</span>`}
        <span style="font-size:12px;font-weight:700;color:#2a1a0a;">${cap(hType)}</span>
        <span style="font-size:11px;color:#6a5a4a;margin-left:auto;">\u00D7${count}</span>
      </div>`;
      // Voice command
      if (displayCmd) {
        html += `<div style="font-size:10px;color:#2a1a0a;font-style:italic;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;background:rgba(0,0,0,0.06);padding:2px 6px;border-radius:4px;margin-bottom:4px;" title="${displayCmd.replace(/"/g, '&quot;')}">\u{1F3A4} "${displayCmd}"</div>`;
      }
      // Workflow steps
      if (wf && wf.steps.length > 0) {
        for (let si = 0; si < wf.steps.length; si++) {
          const step = wf.steps[si];
          const label = this.formatWorkflowStep(step);
          const isLoop = si === wf.loopFrom && si > 0;
          html += `<div style="display:flex;align-items:center;gap:4px;font-size:10px;font-weight:600;padding:2px 6px;color:#3a2a1a;">
            <span style="color:#6a5a4a;font-size:9px;">${si + 1}.</span>
            ${isLoop ? '<span style="font-size:8px;color:#7B2FBE;">\u{1F504}</span>' : ''}
            <span>${label}</span>
          </div>`;
        }
      } else {
        html += `<div style="font-size:10px;color:#888;font-style:italic;">No orders</div>`;
      }
      // Modifiers
      if (mods) {
        let modsHTML = '';
        for (const val of [mods.formation, mods.caution, mods.pacing]) {
          if (val && val !== 'normal') {
            const mc = modColors[val];
            if (mc) modsHTML += `<span style="font-size:9px;font-weight:700;padding:1px 6px;border-radius:8px;background:${mc.bg};color:${mc.fg};">${mc.label}</span>`;
          }
        }
        if (modsHTML) html += `<div style="display:flex;gap:3px;flex-wrap:wrap;margin-top:3px;">${modsHTML}</div>`;
      }
      html += `</div>`;
    }
    if (!html) html = '<div style="font-size:11px;color:#888;text-align:center;padding:10px;">No units yet</div>';
    if (html !== this._prevCmdHTML) { entriesEl.innerHTML = html; this._prevCmdHTML = html; }
  }

  // ─── UPDATE: QUEST PANEL ──────────────────────────────────────
  // ─── CHAR PANEL STUBS (removed — no longer used) ──────────────
  private cycleCharPanelTab(_direction: 1 | -1) { /* removed */ }
  private refreshCharPanelVisibility() { /* removed */ }
  private buildCharPanelTabs(): string { return ''; }

  // ─── NOTIFICATION SYSTEM ────────────────────────────────────

  private setupNotificationSystem() {
    if (!document.getElementById('notif-keyframes-style')) {
      const style = document.createElement('style');
      style.id = 'notif-keyframes-style';
      style.textContent = `
        @keyframes notif-era-in {
          0% { transform: scaleX(0); opacity: 0; }
          70% { transform: scaleX(1.03); opacity: 1; }
          100% { transform: scaleX(1); opacity: 1; }
        }
        @keyframes notif-era-out {
          0% { transform: scaleX(1); opacity: 1; }
          100% { transform: scaleX(0.8); opacity: 0; }
        }
        @keyframes notif-era-child {
          0% { opacity: 0; transform: translateY(8px); }
          100% { opacity: 1; transform: translateY(0); }
        }
        @keyframes notif-era-shimmer {
          0%, 100% { filter: brightness(1); }
          50% { filter: brightness(1.3); }
        }
        @keyframes notif-event-in {
          0% { transform: translateY(-100%); opacity: 0; }
          70% { transform: translateY(4px); }
          100% { transform: translateY(0); opacity: 1; }
        }
        @keyframes notif-event-out {
          0% { transform: translateY(0); opacity: 1; }
          100% { transform: translateY(-30px); opacity: 0; }
        }
        @keyframes notif-resolve-in {
          0% { transform: translateY(-20px) scale(0.95); opacity: 0; }
          100% { transform: translateY(0) scale(1); opacity: 1; }
        }
        @keyframes notif-resolve-out {
          0% { opacity: 1; }
          100% { opacity: 0; }
        }
        @keyframes notif-start-in {
          0% { opacity: 0; transform: scale(0.9); }
          100% { opacity: 1; transform: scale(1); }
        }
        @keyframes notif-start-out {
          0% { opacity: 1; transform: scale(1); }
          100% { opacity: 0; transform: scale(0.95); }
        }
        @keyframes notif-start-row {
          0% { opacity: 0; transform: translateX(-12px); }
          100% { opacity: 1; transform: translateX(0); }
        }
        @keyframes notif-start-pulse {
          0%, 100% { text-shadow: 0 0 6px rgba(255,215,0,0.3); }
          50% { text-shadow: 0 0 18px rgba(255,215,0,0.7); }
        }
        @keyframes eventPulse {
          0%, 100% { opacity: 1; border-color: rgba(139,115,85,0.5); }
          50% { opacity: 0.85; border-color: rgba(204,51,51,0.8); }
        }
      `;
      document.head.appendChild(style);
    }

    const c = document.getElementById('game-container') ?? document.body;
    const container = document.createElement('div');
    container.id = 'notif-container';
    container.style.cssText = `
      position:absolute;top:0;left:0;right:0;
      height:100%;z-index:300;pointer-events:none;overflow:hidden;
    `;
    c.appendChild(container);
    this.notifContainerEl = container;

    const stack = document.createElement('div');
    stack.id = 'notif-event-stack';
    stack.style.cssText = `
      position:absolute;top:80px;left:0;right:0;
      display:flex;flex-direction:column;align-items:center;gap:8px;
    `;
    container.appendChild(stack);
    this.notifEventStackEl = stack;
  }

  private renderEraBanner(data: EraBannerData): HTMLElement {
    const tierColor = TIER_COLORS[data.tierMax] || '#B8860B';
    const el = document.createElement('div');
    el.style.cssText = `
      position:absolute;top:33%;left:0;right:0;
      display:flex;flex-direction:column;align-items:center;justify-content:center;
      padding:18px 0;
      background:linear-gradient(90deg, transparent 0%, rgba(212,196,160,0.88) 15%, rgba(212,196,160,0.95) 50%, rgba(212,196,160,0.88) 85%, transparent 100%);
      backdrop-filter:blur(8px);transform-origin:center;
      animation: notif-era-in 600ms cubic-bezier(0.34,1.56,0.64,1) forwards;
      border-top:2px solid ${tierColor}44;border-bottom:2px solid ${tierColor}44;
      box-shadow:0 0 30px rgba(0,0,0,0.3);
    `;
    el.innerHTML = `
      <div style="display:inline-block;padding:2px 14px;border-radius:4px;background:${tierColor};color:#fff;font-family:'Fredoka',sans-serif;font-size:13px;font-weight:600;letter-spacing:2px;opacity:0;animation:notif-era-child 400ms ease-out 200ms forwards;">ERA ${ERA_ROMAN[data.eraNumber] || data.eraNumber}</div>
      <div style="font-family:'Fredoka',sans-serif;font-size:36px;font-weight:700;color:${tierColor};text-shadow:0 2px 8px rgba(0,0,0,0.2);margin:4px 0 2px;opacity:0;animation:notif-era-child 400ms ease-out 450ms forwards, notif-era-shimmer 600ms ease-in-out 800ms 1;">${data.eraName.toUpperCase()}</div>
      <div style="font-family:'Nunito',sans-serif;font-size:13px;color:#4a4030;opacity:0;animation:notif-era-child 400ms ease-out 650ms forwards;">${data.description}</div>
    `;
    return el;
  }

  private renderGameStart(): HTMLElement {
    const wrapper = document.createElement('div');
    wrapper.style.cssText = 'position:fixed;top:0;left:0;width:100vw;height:100vh;z-index:9999;display:flex;align-items:center;justify-content:center;cursor:pointer;';
    const el = document.createElement('div');
    el.style.cssText = 'width:900px;padding:70px 80px;background:linear-gradient(135deg,rgba(212,196,160,0.95),rgba(196,180,148,0.97) 50%,rgba(212,196,160,0.93));backdrop-filter:blur(14px);border-radius:18px;border:3px solid rgba(120,90,50,0.35);box-shadow:0 12px 60px rgba(0,0,0,0.6),inset 0 1px 0 rgba(255,255,255,0.3),inset 0 -1px 0 rgba(0,0,0,0.1);text-align:center;animation:notif-start-in 700ms cubic-bezier(0.22,1,0.36,1) forwards;';
    el.innerHTML = '<div style="font-family:Fredoka,sans-serif;font-size:18px;letter-spacing:5px;color:rgba(100,70,30,0.6);margin-bottom:6px;opacity:0;animation:notif-era-child 400ms ease-out 200ms forwards;">PROMPT BATTLE</div>'
      + '<div style="font-family:Fredoka,sans-serif;font-size:54px;font-weight:700;color:#5a3a1a;text-shadow:0 2px 4px rgba(0,0,0,0.1);margin-bottom:10px;white-space:nowrap;opacity:0;animation:notif-era-child 400ms ease-out 400ms forwards,notif-start-pulse 2.5s ease-in-out 1s infinite;">COMMAND YOUR HORDES</div>'
      + '<div style="font-family:Nunito,sans-serif;font-size:22px;color:#6a5a4a;margin-bottom:14px;white-space:nowrap;opacity:0;animation:notif-era-child 400ms ease-out 550ms forwards;">Use <span style="font-family:Fredoka,sans-serif;font-weight:600;font-size:22px;color:#5a3a1a;background:rgba(120,90,50,0.12);border:1px solid rgba(120,90,50,0.2);border-radius:4px;padding:2px 10px;">1</span>\u2013<span style="font-family:Fredoka,sans-serif;font-weight:600;font-size:22px;color:#5a3a1a;background:rgba(120,90,50,0.12);border:1px solid rgba(120,90,50,0.2);border-radius:4px;padding:2px 10px;">5</span> to select a horde \u2014 press <span style="font-family:Fredoka,sans-serif;font-weight:600;font-size:22px;color:#5a3a1a;background:rgba(120,90,50,0.12);border:1px solid rgba(120,90,50,0.2);border-radius:4px;padding:2px 10px;">SPACE</span> to mute speech</div>'
      + '<div style="width:60%;height:2px;background:linear-gradient(90deg,transparent,rgba(120,90,50,0.4),transparent);margin:0 auto 28px;opacity:0;animation:notif-era-child 400ms ease-out 650ms forwards;"></div>'
      + '<div style="font-family:Nunito,sans-serif;font-size:28px;color:#3a2a1a;line-height:1.5;opacity:0;animation:notif-era-child 400ms ease-out 750ms forwards;">Just tell them what to do, they will figure it out.</div>'
      + '<div style="display:flex;gap:24px;justify-content:center;margin-top:28px;opacity:0;animation:notif-era-child 400ms ease-out 900ms forwards;">'
      + '<div style="font-family:Fredoka,sans-serif;font-size:24px;font-weight:600;color:#5a3a1a;background:rgba(120,90,50,0.08);border:1px solid rgba(120,90,50,0.2);border-radius:10px;padding:14px 24px;">\u201CGo gather carrots\u201D</div>'
      + '<div style="font-family:Fredoka,sans-serif;font-size:24px;font-weight:600;color:#5a3a1a;background:rgba(120,90,50,0.08);border:1px solid rgba(120,90,50,0.2);border-radius:10px;padding:14px 24px;">\u201CMake turtles\u201D</div>'
      + '</div>'
      + '<div style="font-family:Nunito,sans-serif;font-size:17px;color:rgba(90,58,26,0.5);margin-top:34px;opacity:0;animation:notif-era-child 400ms ease-out 1100ms forwards;">Click anywhere to continue</div>';
    wrapper.appendChild(el);
    // Click to dismiss
    const dismiss = () => { this.dismissIntroNotif(); };
    wrapper.addEventListener('click', dismiss);
    return wrapper;
  }

  private renderGameStartControls(): HTMLElement {
    const wrapper = document.createElement('div');
    wrapper.style.cssText = 'position:fixed;top:0;left:0;width:100vw;height:100vh;z-index:9999;display:flex;align-items:center;justify-content:center;cursor:pointer;';
    const el = document.createElement('div');
    el.style.cssText = 'width:700px;padding:52px 60px;background:linear-gradient(135deg,rgba(212,196,160,0.95),rgba(196,180,148,0.97) 50%,rgba(212,196,160,0.93));backdrop-filter:blur(14px);border-radius:14px;border:3px solid rgba(120,90,50,0.35);box-shadow:0 12px 60px rgba(0,0,0,0.6),inset 0 1px 0 rgba(255,255,255,0.3),inset 0 -1px 0 rgba(0,0,0,0.1);text-align:center;animation:notif-start-in 700ms cubic-bezier(0.22,1,0.36,1) forwards;';
    const phrases = [
      { cmd: 'Create more gnomes but stay safe', desc: 'Spawn units with a cautious behavior modifier' },
      { cmd: 'Get your pickaxe and go mining', desc: 'Equip gear then head to the mines' },
      { cmd: 'Attack the enemy turret in the southeast', desc: 'Target specific structures by direction' },
    ];
    const controls = [
      { key: '1-5', desc: 'Control groups' },
      { key: 'Q / E', desc: 'Cycle hoards' },
      { key: 'Arrows / Drag', desc: 'Pan map' },
      { key: 'Scroll', desc: 'Zoom' },
    ];
    el.innerHTML = '<div style="font-family:Fredoka,sans-serif;font-size:16px;letter-spacing:4px;color:rgba(100,70,30,0.6);margin-bottom:4px;opacity:0;animation:notif-era-child 400ms ease-out 200ms forwards;">SPEAK OR TYPE</div>'
      + '<div style="font-family:Fredoka,sans-serif;font-size:46px;font-weight:700;color:#5a3a1a;text-shadow:0 2px 4px rgba(0,0,0,0.1);margin-bottom:12px;opacity:0;animation:notif-era-child 400ms ease-out 400ms forwards;">\u{1F399}\uFE0F VOICE COMMANDS</div>'
      + '<div style="width:60%;height:2px;background:linear-gradient(90deg,transparent,rgba(120,90,50,0.4),transparent);margin:0 auto 22px;opacity:0;animation:notif-era-child 400ms ease-out 500ms forwards;"></div>'
      + '<div style="display:flex;flex-direction:column;gap:18px;text-align:left;">'
      + phrases.map((p, i) => '<div style="opacity:0;animation:notif-start-row 400ms ease-out ' + (600 + i * 180) + 'ms forwards;"><div style="font-family:Fredoka,sans-serif;font-size:19px;font-weight:600;color:#5a3a1a;background:rgba(120,90,50,0.08);border:1px solid rgba(120,90,50,0.2);border-radius:8px;padding:10px 16px;margin-bottom:4px;">\u201C' + p.cmd + '\u201D</div><div style="font-family:Nunito,sans-serif;font-size:15px;color:#7a6a5a;padding-left:16px;">' + p.desc + '</div></div>').join('')
      + '</div>'
      + '<div style="font-family:Nunito,sans-serif;font-size:17px;color:rgba(90,58,26,0.5);margin-top:34px;opacity:0;animation:notif-era-child 400ms ease-out 1300ms forwards;">Click anywhere to start</div>';
    wrapper.appendChild(el);
    // Click to dismiss
    const dismiss = () => { this.dismissIntroNotif(); };
    wrapper.addEventListener('click', dismiss);
    return wrapper;
  }

  private dismissIntroNotif() {
    const n = this.activeNotifs.find(a => a.type === 'game_start' || a.type === 'game_start_controls');
    if (!n || n.exiting) return;
    n.exiting = true;
    const isControls = n.type === 'game_start_controls';
    const queueControls = n.type === 'game_start';
    // Clean up space handler
    if ((n.el as any)._spaceHandler) document.removeEventListener('keydown', (n.el as any)._spaceHandler);
    n.el.style.animation = 'notif-start-out 500ms ease-in forwards';
    setTimeout(() => {
      n.el.remove();
      this.eraBannerActive = false;
      if (queueControls) {
        this.notifQueue.push({ type: 'game_start_controls', priority: 4, data: {} });
      }
      if (isControls) {
        this.introComplete = true;
        // Fade out the persistent veil
        if (this.introVeilEl) {
          this.introVeilEl.style.transition = 'opacity 800ms ease';
          this.introVeilEl.style.opacity = '0';
          setTimeout(() => { this.introVeilEl?.remove(); this.introVeilEl = null; }, 800);
        }
      }
    }, 500);
    this.activeNotifs = this.activeNotifs.filter(a => a !== n);
  }

  private renderEventSpawn(data: EventSpawnData): HTMLElement {
    const el = document.createElement('div');
    el.style.cssText = `
      width:320px;background:rgba(8,12,20,0.92);backdrop-filter:blur(8px);
      border-radius:8px;border:1px solid ${data.color}44;
      display:flex;overflow:hidden;
      animation: notif-event-in 350ms cubic-bezier(0.34,1.56,0.64,1) forwards;
      box-shadow:0 4px 16px rgba(0,0,0,0.4);
    `;
    el.innerHTML = `
      <div style="width:4px;background:${data.color};flex-shrink:0;"></div>
      <div style="padding:10px 12px;display:flex;align-items:center;gap:10px;flex:1;min-width:0;">
        <div style="width:36px;height:36px;border-radius:50%;background:${data.color}22;border:2px solid ${data.color}66;display:flex;align-items:center;justify-content:center;font-size:18px;flex-shrink:0;">${data.emoji}</div>
        <div style="min-width:0;">
          <div style="font-family:'Fredoka',sans-serif;font-size:10px;color:${data.color};letter-spacing:1.5px;font-weight:600;">EVENT</div>
          <div style="font-family:'Fredoka',sans-serif;font-size:15px;color:#fff;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${data.name.toUpperCase()}</div>
          <div style="font-family:'Nunito',sans-serif;font-size:11px;color:#aaa;margin-top:1px;">${data.description}</div>
        </div>
      </div>
    `;
    return el;
  }

  private renderEventResolve(data: EventResolveData): HTMLElement {
    const teamColor = data.winner === 1 ? '#4488ff' : data.winner === 2 ? '#ff4444' : '#888';
    const teamName = data.winner === 1 ? 'Blue' : data.winner === 2 ? 'Red' : 'Nobody';
    const verb = data.winner ? 'wins' : 'expired:';
    const el = document.createElement('div');
    el.style.cssText = `
      width:280px;background:rgba(8,12,20,0.88);backdrop-filter:blur(8px);
      border-radius:6px;border:1px solid ${data.color}33;
      padding:8px 12px;display:flex;align-items:center;gap:8px;
      animation: notif-resolve-in 250ms ease-out forwards;
      box-shadow:0 2px 10px rgba(0,0,0,0.3);
    `;
    el.innerHTML = `
      <span style="font-size:16px;">${data.emoji}</span>
      <span style="font-family:'Nunito',sans-serif;font-size:12px;color:#ccc;flex:1;">
        <strong style="color:${teamColor}">${teamName}</strong> ${verb} ${MAP_EVENT_DEFS[data.eventType]?.name || ''}${data.rewardText ? ` <span style="color:#FFD93D;font-weight:600;">${data.rewardText}</span>` : ''}
      </span>
    `;
    return el;
  }

  private updateNotifications() {
    const now = performance.now();
    for (let i = this.activeNotifs.length - 1; i >= 0; i--) {
      const n = this.activeNotifs[i];
      if (!n.exiting && (now - n.spawnTime) >= n.duration) {
        n.exiting = true;
        const isBanner = n.type === 'era_banner' || n.type === 'game_start' || n.type === 'game_start_controls';
        const exitAnim = isBanner ? 'notif-start-out 700ms ease-in forwards'
          : n.type === 'event_spawn' ? 'notif-event-out 300ms ease-in forwards'
          : 'notif-resolve-out 250ms ease-in forwards';
        const exitDur = isBanner ? 700 : n.type === 'event_spawn' ? 300 : 250;
        n.el.style.animation = exitAnim;
        const queueControls = n.type === 'game_start';
        setTimeout(() => {
          n.el.remove();
          if (isBanner) this.eraBannerActive = false;
          if (queueControls) this.notifQueue.push({ type: 'game_start_controls', priority: 4, data: {} });
        }, exitDur);
        this.activeNotifs.splice(i, 1);
      }
    }
    if (this.notifQueue.length === 0) return;
    this.notifQueue.sort((a, b) => b.priority - a.priority);
    for (let i = 0; i < this.notifQueue.length; i++) {
      const item = this.notifQueue[i];
      if (item.type === 'game_start' || item.type === 'game_start_controls') {
        if (this.eraBannerActive) continue;
        this.notifQueue.splice(i, 1); i--;
        const el = item.type === 'game_start' ? this.renderGameStart() : this.renderGameStartControls();
        const gameContainer = document.getElementById('game-container') ?? document.body;
        gameContainer.appendChild(el);
        this.activeNotifs.push({ type: item.type, el, spawnTime: now, duration: 999999999, exiting: false });
        this.eraBannerActive = true;
        return;
      }
      if (item.type === 'era_banner') {
        if (this.eraBannerActive || !this.introComplete) continue;
        this.notifQueue.splice(i, 1); i--;
        const el = this.renderEraBanner(item.data as EraBannerData);
        this.notifContainerEl?.appendChild(el);
        this.activeNotifs.push({ type: 'era_banner', el, spawnTime: now, duration: 5500, exiting: false });
        this.eraBannerActive = true;
        return;
      }
      if (this.eraBannerActive) continue;
      if (item.type === 'event_spawn') {
        if (this.activeNotifs.filter(n => n.type === 'event_spawn').length >= 3) continue;
        this.notifQueue.splice(i, 1); i--;
        const el = this.renderEventSpawn(item.data as EventSpawnData);
        this.notifEventStackEl?.appendChild(el);
        this.activeNotifs.push({ type: 'event_spawn', el, spawnTime: now, duration: 3500, exiting: false });
      } else if (item.type === 'event_resolve') {
        this.notifQueue.splice(i, 1); i--;
        const el = this.renderEventResolve(item.data as EventResolveData);
        this.notifEventStackEl?.appendChild(el);
        this.activeNotifs.push({ type: 'event_resolve', el, spawnTime: now, duration: 3000, exiting: false });
      }
    }
  }

  private showEraBanner(eraNumber: number) {
    const eraName = HordeScene.ERA_NAMES[eraNumber] || `Era ${eraNumber}`;
    const tierMax = eraNumber <= 1 ? 1 : eraNumber <= 2 ? 2 : eraNumber <= 3 ? 3 : eraNumber <= 4 ? 4 : 5;
    this.notifQueue.push({
      type: 'era_banner', priority: 3,
      data: { eraNumber, eraName, tierMax, description: ERA_BANNER_INFO[eraNumber] || '' },
    });
  }

  private showEventSpawnNotif(_eventType: MapEventType) {
    // Removed: dark event notifications from top
  }

  private showEventResolveNotif(_eventType: MapEventType, _winner: 1 | 2 | null, _rewardText: string) {
    // Removed: dark event resolve notifications from top
  }

  private formatWorkflowStep(step: WorkflowStep): string {
    const RESOURCE_ICONS: Record<string, string> = { carrot: '\u{1F955}', meat: '\u{1F356}', crystal: '\u{1F48E}', metal: '\u2699\uFE0F' };
    const EQUIP_ICONS: Record<string, string> = { pickaxe: '\u26CF\uFE0F', sword: '\u2694\uFE0F', shield: '\u{1F6E1}\uFE0F', boots: '\u{1F462}', banner: '\u{1F6A9}' };
    switch (step.action) {
      case 'seek_resource': return `${RESOURCE_ICONS[step.resourceType] || ''} Gather ${step.resourceType}`;
      case 'deliver': { const t = step.target.replace('nearest_', '').replace('_camp', ' camp'); return `\u{1F4E6} Deliver \u2192 ${t}`; }
      case 'hunt': return step.targetType ? `\u2694\uFE0F Hunt ${step.targetType}` : '\u2694\uFE0F Hunt wilds';
      case 'attack_camp': return step.targetAnimal ? `\u{1F3F4} Capture ${step.targetAnimal} camp` : '\u{1F3F4} Capture camp';
      case 'move': return `\u{1F3AF} Move (${Math.round(step.x)},${Math.round(step.y)})`;
      case 'defend': { const t = step.target.replace('nearest_', '').replace('_camp', ' camp'); return `\u{1F6E1}\uFE0F Defend ${t}`; }
      case 'attack_enemies': return '\u2694\uFE0F Attack enemies';
      case 'scout': return step.x !== undefined ? `\u{1F441}\uFE0F Scout (${Math.round(step.x)},${Math.round(step.y!)})` : '\u{1F441}\uFE0F Scout map';
      case 'collect': return `${RESOURCE_ICONS[step.resourceType] || ''} Safe gather ${step.resourceType}`;
      case 'kill_only': return step.targetType ? `\u{1F480} Kill ${step.targetType}` : '\u{1F480} Kill wilds';
      case 'mine': return '\u26CF\uFE0F Mine metal';
      case 'equip': return `${EQUIP_ICONS[step.equipmentType] || '\u{1F3DB}\uFE0F'} Equip ${step.equipmentType}`;
      case 'contest_event': return '\u26A1 Contest event';
      case 'withdraw_base': return `\u{1F3E6} Take ${RESOURCE_ICONS[step.resourceType] || ''} ${step.resourceType} from base`;
      default: return (step as any).action || '???';
    }
  }

  private updateHUD() {
    const myT = this.myTeam;
    const enemyT = myT === 1 ? 2 : 1;

    // Timer + Era (in resource panel)
    const secs = Math.floor(this.gameTime / 1000);
    const eraName = HordeScene.ERA_NAMES[this.currentEra] || '';
    const timerEl = this._hudTimerEl || (this._hudTimerEl = document.getElementById('hud-timer'));
    if (timerEl) timerEl.textContent = Math.floor(secs / 60) + ':' + (secs % 60).toString().padStart(2, '0');
    const eraEl = this._hudEraEl || (this._hudEraEl = document.getElementById('hud-era'));
    if (eraEl) eraEl.textContent = `Era ${this.currentEra}: ${eraName}`;

    // Resources
    const stock = this.baseStockpile[myT as 1 | 2];
    const resEl = this._hudResourcesEl || (this._hudResourcesEl = document.getElementById('hud-resources'));
    if (resEl) {
      const maxRes = 50; // visual bar max
      const resources = [
        { emoji: '\u{1F955}', name: 'Carrots', amount: stock.carrot, color: '#FF9944', gradient: 'linear-gradient(90deg,#FF9944,#FFB366)' },
        { emoji: '\u{1F356}', name: 'Meat', amount: stock.meat, color: '#FF5555', gradient: 'linear-gradient(90deg,#FF5555,#FF7777)' },
        { emoji: '\u{1F48E}', name: 'Crystals', amount: stock.crystal, color: '#C98FFF', gradient: 'linear-gradient(90deg,#C98FFF,#DDB3FF)' },
        { emoji: '\u2699\uFE0F', name: 'Metal', amount: stock.metal, color: '#88AACC', gradient: 'linear-gradient(90deg,#88AACC,#AACCDD)' },
      ];
      let html = '';
      for (const r of resources) {
        const pct = Math.min(100, (r.amount / maxRes) * 100);
        // Detect value change for flash animation
        const prevKey = `res_${r.name}`;
        const prev = (this as any)._prevResAmounts?.[prevKey] ?? r.amount;
        const flashClass = r.amount > prev ? 'res-gain' : r.amount < prev ? 'res-loss' : '';
        if (!(this as any)._prevResAmounts) (this as any)._prevResAmounts = {};
        (this as any)._prevResAmounts[prevKey] = r.amount;

        html += `<div style="display:flex;align-items:center;gap:6px;margin-bottom:4px;">
          <span style="font-size:14px;">${r.emoji}</span>
          <div style="flex:1;">
            <div style="display:flex;justify-content:space-between;font-size:12px;font-weight:700;">
              <span style="color:#6a5a4a;">${r.name}</span>
              <span class="${flashClass}" style="color:${r.color};display:inline-block;">${r.amount}</span>
            </div>
            <div style="height:4px;background:#a89870;border-radius:2px;overflow:hidden;margin-top:2px;">
              <div style="height:100%;width:${pct}%;background:${r.gradient};border-radius:2px;transition:width 0.3s ease;"></div>
            </div>
          </div>
        </div>`;
      }
      if (html !== this._prevResHTML) { resEl.innerHTML = html; this._prevResHTML = html; }
    }

    // ─── NEW FLOATING PANELS ───
    this.updateTopBar();
    this.updateCmdLogPanel();
    this.updateMinimap();
    this.updateSelectionLabel();
  }


  // ─── MAIN UPDATE ────────────────────────────────────────────

  update(_time: number, delta: number) {
    if (this.gameOver) return;
    // Clamp delta to prevent huge simulation spikes when tab is backgrounded
    // Browsers throttle rAF to ~1fps in background, causing delta of 1000ms+
    if (delta > 100) delta = 100;
    const dt = delta / 1000;
    this.updateCamera(dt);

    if (this.editorMode) {
      // Editor mode: render only, no simulation
      this._frameCount++;
      this.updateUnitSprites();
      if (this._frameCount % 2 === 0) {
        this.updateCampVisuals();
        this.updateMineVisuals();
        this.updateArmoryVisuals();
      }
      if (this._frameCount % 4 === 0) this.drawNexusBars();
      return;
    }

    if (this.isOnline && !this.isHost) {
      // Guest: only render, no simulation — state comes from host via sync
      this._frameCount++;
      this.updateUnitSprites();
      if (this._frameCount % 2 === 0) {
        this.updateCampVisuals();
        this.updateMineVisuals();
        this.updateArmoryVisuals();
      }
      if (this._frameCount % 4 === 0) this.drawNexusBars();
      this.updateFog();
      this.updateFogVisibility();
      if (this._frameCount % 20 === 0) this.updateHUD();
      this.updateThoughtBubbles(delta);
      return;
    }

    // Host (or solo): run full simulation
    const _perfT0 = performance.now();
    this._frameCount++;

    // Push game state to ElevenLabs voice agent periodically (every ~300 frames ≈ 5s at 60fps)
    if (this.voiceAgent && this.voiceAgentReady && this._frameCount % 300 === 0) {
      const team = this.isDebug ? this.debugControlTeam : this.myTeam;
      this.voiceAgent.updateGameState(this.buildVoiceAgentContext(team));
    }

    let _t0 = performance.now();
    this.rebuildSpatialGrid();
    this._perfTimings.spatial = performance.now() - _t0;

    // Build ID lookup maps for O(1) access
    _t0 = performance.now();
    this._unitById.clear();
    for (const u of this.units) if (!u.dead) this._unitById.set(u.id, u);
    this._groundItemById.clear();
    for (const i of this.groundItems) if (!i.dead) this._groundItemById.set(i.id, i);
    this._perfTimings.idMaps = performance.now() - _t0;

    // Fix C: clear spatial query cache each frame
    this._nearbyCache.clear();
    this._nearbyPoolIdx = 0; // 4b: reset round-robin pool index

    // 2c: Build ground item spatial grid
    this._groundItemGrid = buildSpatialGrid(this.groundItems as any, this.spatialCellSize, this._groundItemGrid as any || undefined, this._groundItemBucketPool as any) as any;

    // 2d: Build defended camps set once per frame
    this._defendedCamps.clear();
    for (const u of this.units) { if (!u.dead && u.team === 0 && u.campId) this._defendedCamps.add(u.campId); }

    // 3b: Clear per-frame equip/banner caches
    this._equipBuffCache.clear();
    this._bannerAuraCache.clear();

    // Process queued A* pathfinding requests
    _t0 = performance.now();
    this._pathsThisFrame = 0;
    this._framePathCache.clear();
    for (const arr of this._frameAvoidPenalty.values()) this._avoidPenaltyPool.push(arr);
    this._frameAvoidPenalty.clear();
    this._frameOccupiedReady = false;
    while (this.pathQueue.length > 0 && this._pathsThisFrame < HordeScene.MAX_PATHS_PER_FRAME) {
      const req = this.pathQueue.shift()!;
      const unit = req.unit as HUnit;
      if (!unit.dead) {
        unit.targetX = req.targetX;
        unit.targetY = req.targetY;
        const isSafe = this.isNonCombatStep(unit) && unit.mods.caution !== 'aggressive';
        const path = this.computeSafePath(unit, !isSafe);
        req.callback(path);
      }
      this._pathsThisFrame++;
    }
    this._perfTimings.pathfinding = performance.now() - _t0;

    // 4g: Ring buffer for frameTimes (avoids shift() O(n))
    this._frameTimesRing[this._frameTimesIdx] = delta;
    this._frameTimesIdx = (this._frameTimesIdx + 1) % 60;
    if (this._frameTimesCount < 60) this._frameTimesCount++;
    if (this.isDebug && this._frameCount % 300 === 0) {
      let sum = 0, maxFt = 0;
      for (let i = 0; i < this._frameTimesCount; i++) {
        const v = this._frameTimesRing[i];
        sum += v;
        if (v > maxFt) maxFt = v;
      }
      const avg = sum / this._frameTimesCount;
      let aliveCount = 0;
      for (const u of this.units) if (!u.dead) aliveCount++;
      console.log(`[Perf] avg=${avg.toFixed(1)}ms max=${maxFt.toFixed(1)}ms units=${aliveCount} pathQueue=${this.pathQueue.length}`);
    }

    this.gameTime += delta;

    // Tick down camp loot buffs
    for (let i = this.teamBuffs.length - 1; i >= 0; i--) {
      this.teamBuffs[i].remaining -= delta;
      if (this.teamBuffs[i].remaining <= 0) this.teamBuffs.splice(i, 1);
    }

    // Track peak army size (every 30 frames — not critical)
    if (this._frameCount % 30 === 0) {
      for (const t of [1, 2] as const) {
        let alive = 0;
        for (const u of this.units) if (u.team === t && !u.dead) alive++;
        if (alive > this.matchStats.peakArmySize[t]) this.matchStats.peakArmySize[t] = alive;
      }
    }

    this.updateFreeGnomes(delta);
    this.updateCarrotSpawning(delta);
    this.updateWildAnimals(delta);

    _t0 = performance.now();
    this.updateWorkflows();
    this._perfTimings.workflows = performance.now() - _t0;

    if (this._frameCount % 2 === 0) this.updateAdvancedPlans();
    this.updateResourcePickup();
    this.updateDeliveries();

    _t0 = performance.now();
    this.updateMovement(dt);
    this._perfTimings.movement = performance.now() - _t0;

    // Fix E: throttle combat + hits to every 2nd frame (heavy spatial queries)
    _t0 = performance.now();
    if (this._frameCount % 2 === 0) {
      this.updateCombat(delta * 2);
      this.processPendingHits(delta * 2);
    }
    this._perfTimings.combat = performance.now() - _t0;

    this.updateNexusCombat(delta);
    this.updateTowers(delta);
    if (this._frameCount % 2 === 0) this.updateCampCapture();
    if (this._frameCount % 4 === 0) this.updateEraProgression();
    this.updateNotifications();
    if (this._frameCount % 3 === 0) this.updateMapEvents(delta * 3);
    if (this._frameCount % 2 === 0) this.updateSweeps();
    // Only run AI when solo (not online PvP)
    if (!this.isOnline && !this.isDebug) this.updateAI(delta);
    this.cleanupDead();
    this.updateGroundItems(delta);

    _t0 = performance.now();
    this.updateUnitSprites();
    this._perfTimings.sprites = performance.now() - _t0;

    if (this._frameCount % 4 === 0) this.updateDebugOverlay();
    if (this.debugHitboxes && this._frameCount % 3 === 0) this.drawDebugHitboxes();
    if (this.isDebug && this._frameCount % 3 === 0) this.drawDebugBoundaries();
    if (this._frameCount % 2 === 0) {
      this.updateCampVisuals();
      this.updateMineVisuals();
      this.updateArmoryVisuals();
    }
    if (this._frameCount % 4 === 0) this.drawNexusBars();

    _t0 = performance.now();
    this.updateFog();
    this.updateFogVisibility();
    this._perfTimings.fog = performance.now() - _t0;

    // Fix A: throttle HUD from every 4 frames to every 20 frames
    if (this._frameCount % 20 === 0) this.updateHUD();
    if (this.isDebug && this._frameCount % 20 === 0) this.updateDebugResourceDisplay();
    // Quest system: check every 30 frames (~500ms at 60fps)
    if (this.questManager && this._frameCount % 30 === 0) {
      const qs = this.buildQuestState();
      this.questManager.update(qs);
      const completed = this.questManager.popCompleted();
      for (const q of completed) {
        this.showFeedback(`✅ Quest: ${q.title}`, '#45E6B0');
      }
      this.updateQuestPanel();
    }
    this.updateThoughtBubbles(delta);
    this.checkWin();

    this._perfTimings.total = performance.now() - _perfT0;
    this.memoryOverlay?.update(delta);
    this.profilingRecorder?.update(delta);

    // Drain queued local commands (issued while previous was still processing)
    if (!this.isProcessingCommand && this.pendingLocalCommands.length > 0) {
      const cmd = this.pendingLocalCommands.shift()!;
      this.handleCommand(cmd.text, cmd.team);
    }

    // Host: drain queued remote commands from guest
    if (this.isOnline && this.isHost && !this.isProcessingCommand && this.pendingRemoteCommands.length > 0) {
      const cmd = this.pendingRemoteCommands.shift()!;
      const prevHoard = this.selectedHoard;
      this.selectedHoard = cmd.selectedHoard;
      this.handleCommand(cmd.text, cmd.team);
      this.selectedHoard = prevHoard;
    }

    // Host: push sync state to Firebase
    if (this.isOnline && this.isHost && this.firebase && this.gameId) {
      this.syncTimer += delta;
      if (this.syncTimer >= this.SYNC_INTERVAL_MS) {
        this.syncTimer -= this.SYNC_INTERVAL_MS;
        this.pushHostSync();
      }
    }

    // Push game state to editor (if connected)
    this.editorSyncTimer += delta;
    if (this.editorSyncTimer >= this.EDITOR_SYNC_INTERVAL_MS) {
      this.editorSyncTimer -= this.EDITOR_SYNC_INTERVAL_MS;
      this.pushEditorSync();
    }
  }

  // ─── SPAWNING ────────────────────────────────────────────────

  /** Free gnome from base every 30 seconds for both teams */
  private updateFreeGnomes(delta: number) {
    this.freeGnomeTimer += delta;
    if (this.freeGnomeTimer < FREE_GNOME_MS) return;
    this.freeGnomeTimer -= FREE_GNOME_MS;
    for (const team of [1, 2] as const) {
      if (this.units.filter(u => u.team === team && !u.dead).length >= MAX_UNITS) continue;
      const b = team === 1 ? P1_BASE : P2_BASE;
      const gx = b.x + (team === 1 ? 60 : -60), gy = b.y + (team === 1 ? -30 : 30);
      this.spawnUnit('gnome', team, gx, gy);
      if (team === this.myTeam) this.sfx.playAt('gnome_spawn', gx, gy);
    }
  }

  /** Unlock or upgrade an equipment type for a team — deducts resources from base stockpile */
  private unlockEquipment(team: 1 | 2, eqType: EquipmentType): boolean {
    const def = EQUIPMENT.find(e => e.id === eqType);
    if (!def) return false;
    const currentLevel = this.unlockedEquipment[team].get(eqType) || 0;
    if (currentLevel >= MAX_EQUIP_LEVEL) return false;

    const nextLevel = currentLevel + 1;
    const costMult = EQUIP_LEVEL_COST_MULT[nextLevel];
    const stock = this.baseStockpile[team];
    for (const [res, amt] of Object.entries(def.cost)) {
      if ((stock[res as ResourceType] || 0) < Math.ceil(amt! * costMult)) return false;
    }
    for (const [res, amt] of Object.entries(def.cost)) {
      stock[res as ResourceType] -= Math.ceil(amt! * costMult);
    }

    this.unlockedEquipment[team].set(eqType, nextLevel);
    this.sfx.playGlobal('armory_equip');
    return true;
  }

  /** Get current unlock level for an equipment type (0 = not unlocked) */
  private getEquipLevel(team: 1 | 2, eqType: EquipmentType): number {
    return this.unlockedEquipment[team].get(eqType) || 0;
  }

  // ─── ADVANCED PLANS ────────────────────────────────────────

  /**
   * Resolve a plan goal into a sequence of phases. Pure logic — no side effects.
   * Returns null if the goal is invalid or already satisfied.
   */
  private resolvePlan(
    goal: { type: string; equipment?: EquipmentType; resource?: ResourceType; amount?: number; thenAction?: string },
    team: 1 | 2,
    subject: string,
    originalCommand: string,
  ): AdvancedPlan | null {
    const planId = `plan_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    const stock = this.baseStockpile[team];
    const projectedStock = { ...stock };
    const phases: PlanPhase[] = [];
    let phaseIdx = 0;

    const makePhaseId = () => `${planId}_p${phaseIdx++}`;

    // Helper: build gathering workflow for a resource type
    const gatherWorkflow = (res: ResourceType, mods?: { caution?: string }): HWorkflow => {
      let steps: WorkflowStep[];
      const useSafe = mods?.caution === 'safe';
      if (res === 'carrot') {
        steps = useSafe
          ? [{ action: 'collect', resourceType: 'carrot' as ResourceType }]
          : [{ action: 'seek_resource', resourceType: 'carrot' as ResourceType }, { action: 'deliver', target: 'base' }];
      } else if (res === 'meat') {
        steps = useSafe
          ? [{ action: 'hunt' }, { action: 'collect', resourceType: 'meat' as ResourceType }, { action: 'deliver', target: 'base' }]
          : [{ action: 'hunt' }, { action: 'seek_resource', resourceType: 'meat' as ResourceType }, { action: 'deliver', target: 'base' }];
      } else if (res === 'crystal') {
        steps = useSafe
          ? [{ action: 'hunt', targetType: 'minotaur' }, { action: 'collect', resourceType: 'crystal' as ResourceType }, { action: 'deliver', target: 'base' }]
          : [{ action: 'hunt', targetType: 'minotaur' }, { action: 'seek_resource', resourceType: 'crystal' as ResourceType }, { action: 'deliver', target: 'base' }];
      } else {
        // metal — requires pickaxe equipped
        steps = [{ action: 'equip', equipmentType: 'pickaxe' as EquipmentType }, { action: 'mine' }, { action: 'deliver', target: 'base' }];
        return { steps, currentStep: 0, label: `Mine ⚙️ → base`, loopFrom: 1, playedOnce: false, voiceCommand: originalCommand };
      }
      const label = useSafe ? `Safe gather ${RESOURCE_EMOJI[res]}` : `Gather ${RESOURCE_EMOJI[res]} → base`;
      return { steps, currentStep: 0, label, loopFrom: 0, playedOnce: false, voiceCommand: originalCommand };
    };

    // Helper: add phases to unlock a single equipment type at a target level,
    // assuming all its prerequisites are already met.
    const addUnlockPhases = (eqType: EquipmentType, targetLevel: number, mods?: { caution?: string }) => {
      const def = EQUIPMENT.find(e => e.id === eqType)!;
      const costMult = EQUIP_LEVEL_COST_MULT[targetLevel];

      // Compute required resources and deficit (using projectedStock to account for earlier unlock costs)
      for (const [res, baseAmt] of Object.entries(def.cost)) {
        const needed = Math.ceil(baseAmt! * costMult);
        const have = projectedStock[res as ResourceType] || 0;
        const deficit = needed - have;
        if (deficit > 0) {
          phases.push({
            id: makePhaseId(),
            workflow: gatherWorkflow(res as ResourceType, mods),
            completionCheck: 'resource_threshold',
            resourceTarget: { [res]: needed },
            label: `Gather ${deficit} ${RESOURCE_EMOJI[res as ResourceType]}`,
          });
        }
      }

      // Unlock phase (instant — resources are now sufficient)
      const totalCost = Object.entries(def.cost).map(([r, a]) => `${Math.ceil(a! * costMult)}${RESOURCE_EMOJI[r as ResourceType]}`).join('+');
      phases.push({
        id: makePhaseId(),
        workflow: null, // instant
        completionCheck: 'equipment_unlocked',
        equipTarget: { type: eqType, level: targetLevel },
        onComplete: { unlock: eqType },
        label: `Unlock ${def.emoji} ${def.name} (${totalCost})`,
      });

      // Deduct projected cost so subsequent phases see correct resource levels
      for (const [res2, baseAmt2] of Object.entries(def.cost)) {
        projectedStock[res2 as ResourceType] = Math.max(0, (projectedStock[res2 as ResourceType] || 0) - Math.ceil(baseAmt2! * costMult));
      }
    };

    if (goal.type === 'unlock_equipment' && goal.equipment) {
      const eqType = goal.equipment;
      const def = EQUIPMENT.find(e => e.id === eqType);
      if (!def) return null;

      const currentLevel = this.getEquipLevel(team, eqType);
      const targetLevel = currentLevel + 1;
      if (targetLevel > MAX_EQUIP_LEVEL) return null; // already maxed

      const costMult = EQUIP_LEVEL_COST_MULT[targetLevel];

      // Check if we can afford it right now (instant plan)
      let canAfford = true;
      for (const [res, amt] of Object.entries(def.cost)) {
        if ((projectedStock[res as ResourceType] || 0) < Math.ceil(amt! * costMult)) { canAfford = false; break; }
      }

      if (canAfford) {
        // Instant unlock — just do it now
        phases.push({
          id: makePhaseId(),
          workflow: null,
          completionCheck: 'equipment_unlocked',
          equipTarget: { type: eqType, level: targetLevel },
          onComplete: { unlock: eqType },
          label: `Unlock ${def.emoji} ${def.name}`,
        });
      } else {
        // Resolve prerequisite chain
        // Check if any resource in the cost needs equipment we don't have
        for (const res of Object.keys(def.cost) as ResourceType[]) {
          const gatherNeed = RESOURCE_GATHER_NEEDS[res];
          if (gatherNeed.needsEquipment) {
            const prereqEq = gatherNeed.needsEquipment;
            if (this.getEquipLevel(team, prereqEq) === 0) {
              // Need to unlock prerequisite equipment first
              // Also check THAT equipment's prereqs (recursive, but only 1 level deep in practice)
              for (const deepPrereq of EQUIPMENT_PREREQS[prereqEq]) {
                if (this.getEquipLevel(team, deepPrereq) === 0) {
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
        const finalWf = this.parseThenAction(goal.thenAction, eqType, originalCommand);
        if (finalWf) {
          phases.push({
            id: makePhaseId(),
            workflow: finalWf,
            completionCheck: 'final',
            label: `${goal.thenAction}`,
          });
        }
      }

      const levelLabel = currentLevel === 0 ? '' : ` Lvl ${targetLevel}`;
      return {
        id: planId,
        phases,
        currentPhase: 0,
        team,
        subject,
        goalLabel: `${def.emoji} ${def.name}${levelLabel}`,
        originalCommand,
        completed: false,
        finalWorkflow: undefined,
      };

    } else if (goal.type === 'stockpile_resource' && goal.resource) {
      const res = goal.resource;
      const gatherNeed = RESOURCE_GATHER_NEEDS[res];

      // If resource needs equipment we don't have, prepend unlock phases
      if (gatherNeed.needsEquipment) {
        const prereqEq = gatherNeed.needsEquipment;
        if (this.getEquipLevel(team, prereqEq) === 0) {
          for (const deepPrereq of EQUIPMENT_PREREQS[prereqEq]) {
            if (this.getEquipLevel(team, deepPrereq) === 0) {
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
        currentPhase: 0,
        team,
        subject,
        goalLabel: `Stockpile ${RESOURCE_EMOJI[res]}`,
        originalCommand,
        completed: false,
      };
    }

    return null;
  }

  /** Parse a "thenAction" string into a final workflow (e.g. "defend" → defend base) */
  private parseThenAction(action: string, equippedType: EquipmentType, voiceCmd: string): HWorkflow | null {
    const lo = action.toLowerCase().trim();
    const steps: WorkflowStep[] = [{ action: 'equip', equipmentType: equippedType }];
    if (/defend|guard|protect/.test(lo)) {
      steps.push({ action: 'defend', target: 'base' });
    } else if (/attack|fight|charge|assault/.test(lo)) {
      steps.push({ action: 'attack_enemies' });
    } else if (/nexus|throne|enemy.?base/.test(lo)) {
      steps.push({ action: 'attack_enemies' });
    } else if (/gather|farm|collect/.test(lo)) {
      steps.push({ action: 'seek_resource', resourceType: 'carrot' as ResourceType }, { action: 'deliver', target: 'base' });
    } else if (/mine/.test(lo)) {
      steps.push({ action: 'mine' }, { action: 'deliver', target: 'base' });
    } else {
      return null;
    }
    return { steps, currentStep: 0, label: `${action}`, loopFrom: 1, playedOnce: false, voiceCommand: voiceCmd };
  }

  /** Assign a workflow to all units of a subject+team group, and store as group workflow */
  private assignWorkflowToGroup(workflow: HWorkflow, subject: string, team: 1 | 2) {
    const sel = this.units.filter(u => u.team === team && !u.dead && (subject === 'all' || u.type === subject));
    for (const u of sel) {
      u.loop = { ...workflow, currentStep: 0 };
      const gm = this.groupModifiers[`${u.type}_${team}`];
      if (gm) u.mods = { ...gm };
    }
    if (subject === 'all') {
      const types = new Set(sel.map(u => u.type));
      for (const t of types) this.groupWorkflows[`${t}_${team}`] = workflow;
    } else {
      this.groupWorkflows[`${subject}_${team}`] = workflow;
    }
  }

  /** Cancel all active plans for a given subject+team */
  private cancelPlansForGroup(subject: string, team: 1 | 2) {
    this.activePlans = this.activePlans.filter(p => {
      if (p.team !== team) return true;
      if (subject === 'all' || p.subject === subject || p.subject === 'all') {
        return false; // remove it
      }
      return true;
    });
  }

  /** Called each frame — monitor plan phases and advance when conditions are met */
  private updateAdvancedPlans() {
    for (let i = this.activePlans.length - 1; i >= 0; i--) {
      const plan = this.activePlans[i];
      if (plan.completed) { this.activePlans.splice(i, 1); continue; }

      const phase = plan.phases[plan.currentPhase];
      if (!phase) { plan.completed = true; this.activePlans.splice(i, 1); continue; }

      let phaseComplete = false;

      if (phase.completionCheck === 'resource_threshold' && phase.resourceTarget) {
        const stock = this.baseStockpile[plan.team];
        phaseComplete = true;
        for (const [res, target] of Object.entries(phase.resourceTarget)) {
          if ((stock[res as ResourceType] || 0) < target!) { phaseComplete = false; break; }
        }
      } else if (phase.completionCheck === 'equipment_unlocked' && phase.equipTarget) {
        const currentLevel = this.getEquipLevel(plan.team, phase.equipTarget.type);
        if (phase.workflow === null) {
          // Instant phase — try to unlock now
          if (currentLevel >= phase.equipTarget.level) {
            phaseComplete = true; // already at level
          } else {
            const success = this.unlockEquipment(plan.team, phase.equipTarget.type);
            if (success) {
              const def = EQUIPMENT.find(e => e.id === phase.equipTarget!.type);
              const newLevel = this.getEquipLevel(plan.team, phase.equipTarget.type);
              const msg = newLevel === 1
                ? `${def?.emoji} ${def?.name} unlocked!`
                : `${def?.emoji} ${def?.name} upgraded to Lvl ${newLevel}!`;
              if (plan.team === this.myTeam) this.showFeedback(msg, '#FFD700');
              phaseComplete = true;
            }
            // If unlock fails (shouldn't happen if resource phases ran), keep waiting
          }
        } else {
          phaseComplete = currentLevel >= phase.equipTarget.level;
        }
      }
      // 'final' never completes — loops forever

      if (phaseComplete) {
        // Fire onComplete actions
        if (phase.onComplete?.unlock && phase.completionCheck !== 'equipment_unlocked') {
          // Resource threshold phases that also unlock — try to unlock
          const success = this.unlockEquipment(plan.team, phase.onComplete.unlock);
          if (success) {
            const def = EQUIPMENT.find(e => e.id === phase.onComplete!.unlock);
            const newLevel = this.getEquipLevel(plan.team, phase.onComplete.unlock);
            const msg = newLevel === 1
              ? `${def?.emoji} ${def?.name} unlocked!`
              : `${def?.emoji} ${def?.name} upgraded to Lvl ${newLevel}!`;
            if (plan.team === this.myTeam) this.showFeedback(msg, '#FFD700');
          }
        }

        // Advance to next phase
        plan.currentPhase++;
        if (plan.currentPhase >= plan.phases.length) {
          // Plan complete
          plan.completed = true;
          if (plan.team === this.myTeam) {
            this.showFeedback(`Plan complete: ${plan.goalLabel}`, '#45E6B0');
          }
          if (plan.finalWorkflow) {
            this.assignWorkflowToGroup(plan.finalWorkflow, plan.subject, plan.team);
          }
          this.activePlans.splice(i, 1);
        } else {
          // Start next phase
          const nextPhase = plan.phases[plan.currentPhase];
          if (plan.team === this.myTeam) {
            this.showFeedback(`Phase ${plan.currentPhase + 1}/${plan.phases.length}: ${nextPhase.label}`, '#FFD93D');
          }
          if (nextPhase.workflow) {
            this.assignWorkflowToGroup(nextPhase.workflow, plan.subject, plan.team);
          }
          // If null workflow (instant phase), it'll be processed next frame
        }
      }
    }
  }

  private getUnitEquipBuffs(u: HUnit) {
    // 3b: Per-frame cache
    const cached = this._equipBuffCache.get(u.id);
    if (cached) return cached;
    let speed = 0, attack = 0, hp = 0, damageTaken = 1, atkSpeedMult = 1, pickupRange = 1, gatherSpeed = 1;
    if (!u.equipment || u.equipLevel <= 0) {
      const result = { speed, attack, hp, damageTaken, atkSpeedMult, pickupRange, gatherSpeed };
      this._equipBuffCache.set(u.id, result);
      return result;
    }
    const lm = EQUIP_LEVEL_STAT_MULT[u.equipLevel] || 1;
    switch (u.equipment) {
      case 'pickaxe': gatherSpeed = 1 + 0.25 * lm; break;
      case 'sword': attack = 0.50 * lm; atkSpeedMult = 1 - 0.25 * lm; break;
      case 'shield': hp = 0.60 * lm; damageTaken = 1 - 0.25 * lm; speed = -0.15; break;
      case 'boots': speed = 0.60 * lm; pickupRange = 1 + 0.5 * lm; break;
      case 'banner': break;
    }
    const result = { speed, attack, hp, damageTaken, atkSpeedMult, pickupRange, gatherSpeed };
    this._equipBuffCache.set(u.id, result);
    return result;
  }

  private getBannerAura(u: HUnit): { attack: number; speed: number } {
    if (u.team === 0) return { attack: 0, speed: 0 };
    // 3b: Per-frame cache
    const cached = this._bannerAuraCache.get(u.id);
    if (cached) return cached;
    const BANNER_RANGE = 120;
    const nearbyBanner = this.getNearbyUnits(u.x, u.y, BANNER_RANGE);
    for (const ally of nearbyBanner) {
      if (ally === u || ally.team !== u.team || ally.equipment !== 'banner') continue;
      const lm = EQUIP_LEVEL_STAT_MULT[ally.equipLevel] || 1;
      const result = { attack: 0.20 * lm, speed: 0.15 * lm };
      this._bannerAuraCache.set(u.id, result);
      return result;
    }
    const result = { attack: 0, speed: 0 };
    this._bannerAuraCache.set(u.id, result);
    return result;
  }

  private updateArmoryVisuals() {
    for (const arm of this.armories) {
      const eqDef = EQUIPMENT.find(e => e.id === arm.equipmentType);
      const name = eqDef?.name || 'Armory';
      if (!arm.sprite) {
        const building = ARMORY_BUILDING[arm.equipmentType] || 'house1';
        const teamColor = arm.team === this.myTeam ? 'purple' : 'red';
        const texKey = `ts_${building}_${teamColor}`;
        const armFootY = arm.y + 5;
        arm.sprite = this.add.image(arm.x, armFootY, texKey).setScale(0.8).setOrigin(0.5, 1.0).setDepth(10 + Math.round(armFootY * 0.01));
        arm.label = this.add.text(arm.x, armFootY + 50, name, {
          fontSize: '14px', color: arm.team === 1 ? '#4499FF' : '#FF5555',
          fontFamily: '"Nunito", sans-serif', fontStyle: 'bold',
          stroke: '#000', strokeThickness: 3,
        }).setOrigin(0.5).setDepth(55);
      }
      const eqLevel = this.unlockedEquipment[arm.team].get(arm.equipmentType) || 0;
      const unlocked = eqLevel > 0;
      if (arm.label) {
        const lvlTag = eqLevel > 0 ? ` ${'⭐'.repeat(eqLevel)}` : '';
        const newText = unlocked ? `${name}${lvlTag}` : `${name} 🔒`;
        const newColor = unlocked ? (arm.team === 1 ? '#4499FF' : '#FF5555') : '#888888';
        if (arm.label.text !== newText) arm.label.setText(newText);
        if ((arm as any)._prevColor !== newColor) { arm.label.setColor(newColor); (arm as any)._prevColor = newColor; }
        const zoom = this.cameras.main.zoom;
        const newScale = Math.max(0.8, 1.0 / zoom);
        if (Math.abs(arm.label.scaleX - newScale) > 0.01) arm.label.setScale(newScale);
      }
    }
  }

  /** Units spawn when food is delivered to camps. Base just stores resources.
   *  Called from updateDeliveries() when a resource is dropped off. */
  private trySpawnFromDelivery(team: 1 | 2, location: 'base' | string) {
    if (this.units.filter(u => u.team === team && !u.dead).length >= MAX_UNITS) return;
    if (location === 'base') {
      // Base only stores — no spawning from base deliveries
      return;
    } else {
      const camp = this.camps.find(c => c.id === location);
      if (!camp || camp.owner !== team) return;
      const cost = SPAWN_COSTS[camp.animalType];
      if (!cost || camp.storedFood < cost.amount) return;
      camp.storedFood -= cost.amount;
      this.spawnUnit(camp.animalType, team, camp.x + 20, camp.y + 30);
    }
  }

  // ─── MOVEMENT (horde flocking) ─────────────────────────────

  private updateMovement(dt: number) {
    // ─── Stuck detection (every 60 frames ≈ once per second at 60fps) ───
    this.stuckCheckCounter++;
    if (this.stuckCheckCounter % 60 === 0) {
      for (const u of this.units) {
        if (u.dead || u.team === 0) continue;
        if (u.stuckCooldown > 0) { u.stuckCooldown--; continue; }
        const checkDx = u.x - u.lastCheckX;
        const checkDy = u.y - u.lastCheckY;
        const checkDist = Math.sqrt(checkDx * checkDx + checkDy * checkDy);
        if (checkDist < 5) {
          u.stuckFrames++;
          if (u.stuckFrames >= 2) {
            this.nudgeUnit(u);
            u.stuckFrames = 0;
          }
        } else {
          u.stuckFrames = 0;
        }
        u.lastCheckX = u.x;
        u.lastCheckY = u.y;
      }
    }

    // 2d: Use class-level _defendedCamps (already built at frame start)
    const defendedCamps = this._defendedCamps;

    // Pre-compute tight formation groups
    const tightGroups = new Map<string, HUnit[]>();
    for (const u of this.units) {
      if (u.dead || u.mods.formation !== 'tight') continue;
      const k = `${u.team}_${u.type}`;
      const g = tightGroups.get(k); g ? g.push(u) : tightGroups.set(k, [u]);
    }

    for (const u of this.units) {
      if (u.dead) continue;

      let dx = u.targetX - u.x, dy = u.targetY - u.y;
      const d = Math.sqrt(dx * dx + dy * dy);
      if (d < 5) { u.pathWaypoints = null; continue; }

      // Tick pathAge for all units
      u.pathAge += dt * 1000;

      // ─── A* PATHFINDING for all player units (rocks) + safe non-combat (threats) ───
      if (u.team !== 0) {
        const astarTeam = u.team as 1 | 2;
        const isSafeMover = this.isNonCombatStep(u) && u.mods.caution !== 'aggressive';

        // Check if path needs recomputation
        // 5a: Relaxed repath triggers (256px threshold, 3s stale timer)
        const targetMoved = Math.abs(u.pathTargetX - u.targetX) > 256 || Math.abs(u.pathTargetY - u.targetY) > 256;
        const pathStale = u.pathAge > 3000;
        const needsPath = !u.pathWaypoints?.length || targetMoved || pathStale;

        if (needsPath) {
          const routeDx = u.targetX - u.x, routeDy = u.targetY - u.y;
          const routeLen = Math.sqrt(routeDx * routeDx + routeDy * routeDy);
          const _CELL = HordeScene.PATH_CELL;
          const _G = HordeScene.PATH_GRID;
          const halfCell = _CELL * 0.5;
          const sampleCount = Math.max(2, Math.ceil(routeLen / halfCell));
          let obstacleOnRoute = false;

          // Grid cell-walk: sample at half-cell intervals using _staticBlockedGrid (same grid A* uses)
          if (this._staticBlockedGrid) {
            for (let si = 0; si <= sampleCount && !obstacleOnRoute; si++) {
              const t = si / Math.max(sampleCount, 1);
              const sx = u.x + routeDx * t, sy = u.y + routeDy * t;
              const gx = Math.floor(sx / _CELL), gy = Math.floor(sy / _CELL);
              if (gx >= 0 && gx < _G && gy >= 0 && gy < _G && this._staticBlockedGrid[gy * _G + gx] === 1) {
                obstacleOnRoute = true;
              }
            }
          }

          // Skip A* for very close targets with no obstacle — direct movement handles it
          if (routeLen < 192 && !obstacleOnRoute) { u.pathWaypoints = null; }

          // 5d: Reduced threat route sampling — 3 points (start, mid, end) instead of full route
          let threatOnRoute = false;
          if (isSafeMover) {
            const astarAvoid = u.mods.caution === 'safe' ? 360 : 250;
            const threatSamples = [0, 0.5, 1]; // start, midpoint, end
            for (let si = 0; si < threatSamples.length && !threatOnRoute; si++) {
              const t = threatSamples[si];
              const sx = u.x + routeDx * t, sy = u.y + routeDy * t;
              const nearbyThreats = this.getNearbyUnits(sx, sy, astarAvoid);
              for (const o of nearbyThreats) {
                if (o.dead || o.team === astarTeam) continue;
                if (o.team === 0 && o.campId === null) continue;
                threatOnRoute = true; break;
              }
              if (!threatOnRoute) {
                for (const c of this.camps) {
                  if (c.owner === astarTeam) continue;
                  const hasD = defendedCamps.has(c.id);
                  if (!hasD && c.owner === 0) continue;
                  const dist2 = (sx - c.x) ** 2 + (sy - c.y) ** 2;
                  if (dist2 < (astarAvoid * 1.5) ** 2) { threatOnRoute = true; break; }
                }
              }
            }
          }

          if (obstacleOnRoute || threatOnRoute) {
            // Path sharing: check cache by bucketed (start, target, team)
            const cacheKey = `${Math.round(u.x/128)}_${Math.round(u.y/128)}_${Math.round(u.targetX/128)}_${Math.round(u.targetY/128)}_${u.team}`;
            if (this._framePathCache.has(cacheKey)) {
              const cached = this._framePathCache.get(cacheKey)!;
              u.pathWaypoints = cached ? cached.map(p => ({...p})) : null;
              u.pathAge = 0;
              u.pathTargetX = u.targetX;
              u.pathTargetY = u.targetY;
            } else if (this._pathsThisFrame < HordeScene.MAX_PATHS_PER_FRAME) {
              u.pathWaypoints = this.computeSafePath(u, !isSafeMover);
              if (!u.pathWaypoints && isSafeMover) {
                u.pathWaypoints = this.computeSafePath(u, true);
              }
              this._framePathCache.set(cacheKey, u.pathWaypoints);
              u.pathAge = 0;
              u.pathTargetX = u.targetX;
              u.pathTargetY = u.targetY;
              this._pathsThisFrame++;
            } else {
              // Budget exceeded — queue for next frame
              this.pathQueue.push({ unit: u, targetX: u.targetX, targetY: u.targetY, callback: (path) => {
                u.pathWaypoints = path;
                u.pathAge = 0;
                u.pathTargetX = u.targetX;
                u.pathTargetY = u.targetY;
              }});
            }
          } else {
            u.pathWaypoints = null;
          }
        }

        // Follow A* waypoints if we have them
        const prevWpX = u.x, prevWpY = u.y;
        if (u.pathWaypoints && u.pathWaypoints.length > 0) {
          const wp = u.pathWaypoints[0];
          const wpDx = wp.x - u.x, wpDy = wp.y - u.y;
          const wpD = Math.sqrt(wpDx * wpDx + wpDy * wpDy);

          if (wpD < 40) {
            u.pathWaypoints.shift();
            if (u.pathWaypoints.length === 0) continue;
            // Re-read next waypoint
            const nwp = u.pathWaypoints[0];
            const nDx = nwp.x - u.x, nDy = nwp.y - u.y;
            const nD = Math.sqrt(nDx * nDx + nDy * nDy);
            if (nD < 1) continue;
            const eb = this.getUnitEquipBuffs(u);
            const ba = this.getBannerAura(u);
            const bm = 1 + this.getBuffs(astarTeam).speed + (eb?.speed || 0) + ba.speed;
            const ms = Math.min(u.speed * bm * dt, nD);
            u.x += (nDx / nD) * ms;
            u.y += (nDy / nD) * ms;
          } else {
            const eb = this.getUnitEquipBuffs(u);
            const ba = this.getBannerAura(u);
            const bm = 1 + this.getBuffs(astarTeam).speed + (eb?.speed || 0) + ba.speed;
            const ms = Math.min(u.speed * bm * dt, wpD);
            u.x += (wpDx / wpD) * ms;
            u.y += (wpDy / wpD) * ms;
          }
          u.x = Math.max(0, Math.min(WORLD_W, u.x));
          u.y = Math.max(0, Math.min(WORLD_H, u.y));
          if (!this.isTileWalkable(u.x, u.y)) {
            // Axis-aligned sliding around corners instead of abandoning path
            const xOk = this.isTileWalkable(u.x, prevWpY);
            const yOk = this.isTileWalkable(prevWpX, u.y);
            if (xOk) {
              u.y = prevWpY;
            } else if (yOk) {
              u.x = prevWpX;
            } else {
              u.x = prevWpX;
              u.y = prevWpY;
            }
          }
          continue;
        }
        // A* returned null (no path) — fall through to force-based avoidance below
      }

      // Avoidance: units carrying food on non-combat steps steer around threats
      // Caution modifiers: safe = wider avoidance (180), aggressive = no avoidance
      const prevAvoidX = u.x, prevAvoidY = u.y;
      if (u.team !== 0 && this.isNonCombatStep(u) && u.mods.caution !== 'aggressive') {
        const AVOID_RANGE = u.mods.caution === 'safe' ? 180 : 100;
        let avoidX = 0, avoidY = 0;
        const team = u.team as 1 | 2;

        // Avoid enemy units and neutral camp defenders
        const nearbyAvoid = this.getNearbyUnits(u.x, u.y, AVOID_RANGE);
        for (const o of nearbyAvoid) {
          if (o.team === u.team) continue;
          const ex = u.x - o.x, ey = u.y - o.y;
          const ed = Math.sqrt(ex * ex + ey * ey);
          if (ed < AVOID_RANGE && ed > 1) {
            // Very strong close up, drops off sharply — lets units pass between two threats
            const strength = (AVOID_RANGE / ed) - 1; // inverse: 1/ed scaled, approaches 0 at range
            avoidX += (ex / ed) * strength;
            avoidY += (ey / ed) * strength;
          }
        }

        // Avoid hostile camps (not owned by us, with defenders alive)
        const targetAnimal = u.loop ? this.getBootstrapAnimal(u.loop) : undefined;
        for (const c of this.camps) {
          if (c.owner === team) continue;
          if (targetAnimal && c.animalType === targetAnimal) continue;
          // 2d: Use pre-built _defendedCamps instead of O(n) scan
          if (!this._defendedCamps.has(c.id) && c.owner === 0) continue;
          const cx2 = u.x - c.x, cy2 = u.y - c.y;
          const cd = Math.sqrt(cx2 * cx2 + cy2 * cy2);
          if (cd < AVOID_RANGE * 1.5 && cd > 1) {
            const strength = (AVOID_RANGE * 1.5 / cd) - 1;
            avoidX += (cx2 / cd) * strength;
            avoidY += (cy2 / cd) * strength;
          }
        }

        if (avoidX !== 0 || avoidY !== 0) {
          // On collect step: don't try to squeeze past — retreat toward base
          const isCollecting = u.loop?.steps[u.loop.currentStep]?.action === 'collect';
          if (isCollecting) {
            // Abort: move away from threats, toward base
            const base = team === 1 ? P1_BASE : P2_BASE;
            const bx = base.x - u.x, by = base.y - u.y;
            const bLen = Math.sqrt(bx * bx + by * by);
            const eb1 = this.getUnitEquipBuffs(u);
            const ba1 = this.getBannerAura(u);
            const buffMult = 1 + this.getBuffs(team).speed + (eb1?.speed || 0) + ba1.speed;
            const spd = u.speed * buffMult;
            const moveStep = Math.min(spd * dt, d);
            if (bLen > 1) {
              // Blend: mostly away from enemies, slightly toward base
              const avLen = Math.sqrt(avoidX * avoidX + avoidY * avoidY);
              const fx = (avoidX / avLen) * 0.7 + (bx / bLen) * 0.3;
              const fy = (avoidY / avLen) * 0.7 + (by / bLen) * 0.3;
              const fLen = Math.sqrt(fx * fx + fy * fy);
              if (fLen > 0.01) {
                u.x += (fx / fLen) * moveStep;
                u.y += (fy / fLen) * moveStep;
              }
            } else {
              u.x += (avoidX / Math.sqrt(avoidX * avoidX + avoidY * avoidY)) * moveStep;
              u.y += (avoidY / Math.sqrt(avoidX * avoidX + avoidY * avoidY)) * moveStep;
            }
            u.x = Math.max(0, Math.min(WORLD_W, u.x));
            u.y = Math.max(0, Math.min(WORLD_H, u.y));
            if (!this.isTileWalkable(u.x, u.y)) { u.x = prevAvoidX; u.y = prevAvoidY; }
            continue;
          }
          // Normal non-collect: lateral dodge (squeeze between threats)
          // Blend: strong avoidance perpendicular to movement allows squeezing between threats
          const normD = d > 0 ? d : 1;
          const moveNX = dx / normD, moveNY = dy / normD; // normalized movement dir
          // Project avoidance onto perpendicular-to-movement (lateral dodge)
          const dot = avoidX * moveNX + avoidY * moveNY;
          let perpX = avoidX - dot * moveNX; // remove forward/backward component
          let perpY = avoidY - dot * moveNY;
          // If enemy is directly ahead, pick a deterministic side to dodge
          if (Math.abs(perpX) + Math.abs(perpY) < 0.1 && (avoidX !== 0 || avoidY !== 0)) {
            const side = (u.id % 2 === 0) ? 1 : -1;
            perpX = -moveNY * side;
            perpY = moveNX * side;
          }
          // Final direction: forward movement + strong lateral dodge
          const finalX = moveNX + perpX * 2.0 + (dot < 0 ? avoidX * 0.5 : 0);
          const finalY = moveNY + perpY * 2.0 + (dot < 0 ? avoidY * 0.5 : 0);
          const fLen = Math.sqrt(finalX * finalX + finalY * finalY);
          if (fLen > 0.01) {
            const eb1 = this.getUnitEquipBuffs(u);
            const ba1 = this.getBannerAura(u);
            const buffMult = 1 + this.getBuffs(team).speed + (eb1?.speed || 0) + ba1.speed;
            const spd = u.speed * buffMult;
            const moveStep = Math.min(spd * dt, d);
            u.x += (finalX / fLen) * moveStep;
            u.y += (finalY / fLen) * moveStep;
            u.x = Math.max(0, Math.min(WORLD_W, u.x));
            u.y = Math.max(0, Math.min(WORLD_H, u.y));
            if (!this.isTileWalkable(u.x, u.y)) { u.x = prevAvoidX; u.y = prevAvoidY; }
            continue;
          }
        }
      }

      const equipBuff = u.team !== 0 ? this.getUnitEquipBuffs(u) : null;
      const bannerAura = u.team !== 0 ? this.getBannerAura(u) : { speed: 0, attack: 0 };
      const buffMult = u.team !== 0 ? (1 + this.getBuffs(u.team as 1 | 2).speed + (equipBuff?.speed || 0) + bannerAura.speed) : 1;
      const spd = u.speed * buffMult;
      const finalSpeed = spd * dt;
      const step = Math.min(finalSpeed, d);
      const prevX = u.x, prevY = u.y;
      u.x += (dx / d) * step;
      u.y += (dy / d) * step;

      // Clamp to world bounds
      u.x = Math.max(0, Math.min(WORLD_W, u.x));
      u.y = Math.max(0, Math.min(WORLD_H, u.y));

      // Block movement into water tiles and rock clusters — try axis-independent sliding
      if (!this.isTileWalkable(u.x, u.y)) {
        const xOk = this.isTileWalkable(u.x, prevY);
        const yOk = this.isTileWalkable(prevX, u.y);
        if (xOk) {
          u.y = prevY; // slide along X axis
        } else if (yOk) {
          u.x = prevX; // slide along Y axis
        } else {
          u.x = prevX;
          u.y = prevY;
        }
        // Trigger reactive A* on ANY collision (not just full block), with 200ms debounce
        if (u.team !== 0 && !u.pathWaypoints && u.pathAge > 200) {
          const isSafe = this.isNonCombatStep(u) && u.mods.caution !== 'aggressive';
          if (this._pathsThisFrame < HordeScene.MAX_PATHS_PER_FRAME) {
            u.pathWaypoints = this.computeSafePath(u, !isSafe);
            u.pathAge = 0;
            u.pathTargetX = u.targetX;
            u.pathTargetY = u.targetY;
            this._pathsThisFrame++;
          } else {
            this.pathQueue.push({ unit: u, targetX: u.targetX, targetY: u.targetY, callback: (path) => {
              u.pathWaypoints = path;
              u.pathAge = 0;
              u.pathTargetX = u.targetX;
              u.pathTargetY = u.targetY;
            }});
          }
        }
      }

      // 3d: Throttle formation spread to every 2nd frame
      // Formation: spread — repel from nearby same-team allies (min 120px)
      // Exempt turtles in combat (preserve Shell Stance)
      if (this._frameCount % 2 === 0 && u.mods.formation === 'spread' && !(u.type === 'turtle' && u.animState === 'attack')) {
        const SPREAD_MIN = 120;
        const preSpreadX = u.x, preSpreadY = u.y;
        const nearbySpread = this.getNearbyUnits(u.x, u.y, SPREAD_MIN);
        for (const ally of nearbySpread) {
          if (ally === u || ally.team !== u.team) continue;
          const adx = u.x - ally.x, ady = u.y - ally.y;
          const ad = Math.sqrt(adx * adx + ady * ady);
          if (ad < SPREAD_MIN && ad > 1) {
            const push = ((SPREAD_MIN - ad) / SPREAD_MIN) * 0.3;
            u.x += (adx / ad) * push * u.speed * dt;
            u.y += (ady / ad) * push * u.speed * dt;
          }
        }
        u.x = Math.max(0, Math.min(WORLD_W, u.x));
        u.y = Math.max(0, Math.min(WORLD_H, u.y));
        if (!this.isTileWalkable(u.x, u.y)) { u.x = preSpreadX; u.y = preSpreadY; }
      }

      // Formation: tight — leash to group centroid (max 150px)
      if (u.mods.formation === 'tight') {
        const allies = tightGroups.get(`${u.team}_${u.type}`) || [];
        if (allies.length > 1) {
          let cx = 0, cy = 0;
          for (const a of allies) { cx += a.x; cy += a.y; }
          cx /= allies.length; cy /= allies.length;
          const distToCentroid = Math.sqrt((u.x - cx) ** 2 + (u.y - cy) ** 2);
          if (distToCentroid > 150) {
            const preTightX = u.x, preTightY = u.y;
            const pull = Math.min(1, (distToCentroid - 150) / 200) * u.speed * dt;
            const dx2 = cx - u.x, dy2 = cy - u.y;
            const d2 = Math.sqrt(dx2 * dx2 + dy2 * dy2) || 1;
            u.x += (dx2 / d2) * pull;
            u.y += (dy2 / d2) * pull;
            u.x = Math.max(0, Math.min(WORLD_W, u.x));
            u.y = Math.max(0, Math.min(WORLD_H, u.y));
            if (!this.isTileWalkable(u.x, u.y)) { u.x = preTightX; u.y = preTightY; }
          }
        }
      }

      // 3d: Throttle separation to every 2nd frame
      // ─── Separation force: push apart overlapping units ───
      if (this._frameCount % 2 === 0 && u.team !== 0) {
        const nearby = this.getNearbyUnits(u.x, u.y, 30);
        let sepX = 0, sepY = 0;
        for (const neighbor of nearby) {
          if (neighbor === u || neighbor.dead) continue;
          const ndx = u.x - neighbor.x, ndy = u.y - neighbor.y;
          const nd = Math.sqrt(ndx * ndx + ndy * ndy);
          if (nd < 20 && nd > 0.1) {
            sepX += (ndx / nd) * 0.3;
            sepY += (ndy / nd) * 0.3;
          }
        }
        const sepMag = Math.sqrt(sepX * sepX + sepY * sepY);
        if (sepMag > 3) { sepX *= 3 / sepMag; sepY *= 3 / sepMag; }
        if (sepMag > 0.01) {
          const preSepX = u.x, preSepY = u.y;
          u.x += sepX;
          u.y += sepY;
          u.x = Math.max(0, Math.min(WORLD_W, u.x));
          u.y = Math.max(0, Math.min(WORLD_H, u.y));
          if (!this.isTileWalkable(u.x, u.y)) { u.x = preSepX; u.y = preSepY; }
        }
      }
    }
  }

  /** Nudge a stuck unit in multiple directions/distances to unstick it */
  private nudgeUnit(u: HUnit) {
    const hdx = u.targetX - u.x;
    const hdy = u.targetY - u.y;
    const hd = Math.sqrt(hdx * hdx + hdy * hdy);
    if (hd < 1) return;
    const nx = hdx / hd, ny = hdy / hd;

    // Try 8 directions: perp, forward-diag, back-diag, backward, forward
    const dirs: [number, number][] = [
      [-ny, nx], [ny, -nx],                           // perpendicular
      [nx - ny, ny + nx], [nx + ny, ny - nx],         // forward-diagonal
      [-nx - ny, -ny + nx], [-nx + ny, -ny - nx],     // back-diagonal
      [-nx, -ny],                                      // backward
      [nx, ny],                                        // forward
    ];
    // Normalize directions
    const normDirs = dirs.map(([dx, dy]) => {
      const m = Math.sqrt(dx * dx + dy * dy);
      return m > 0.01 ? [dx / m, dy / m] as [number, number] : [dx, dy] as [number, number];
    });

    const distances = [40, 70, 100];
    for (const dist of distances) {
      for (const [px, py] of normDirs) {
        const testX = u.x + px * dist;
        const testY = u.y + py * dist;
        if (testX >= 0 && testX <= WORLD_W && testY >= 0 && testY <= WORLD_H && this.isTileWalkable(testX, testY)) {
          u.x = testX;
          u.y = testY;
          u.pathWaypoints = null;
          u.pathAge = 9999; // force recomputation
          u.stuckCooldown = 60;
          return;
        }
      }
    }
  }

  /** Check if a workflow is a bootstrap (has an attack_camp step) */
  private isBootstrapWorkflow(wf: HWorkflow): boolean {
    return wf.steps.some(s => s.action === 'attack_camp');
  }

  /** Get the target animal type from a bootstrap workflow's attack_camp step */
  private getBootstrapAnimal(wf: HWorkflow): string | undefined {
    const campStep = wf.steps.find(s => s.action === 'attack_camp');
    if (campStep && campStep.action === 'attack_camp') return campStep.targetAnimal;
    return undefined;
  }

  /** Check if a unit is on a non-combat workflow step (should avoid enemies, not fight) */
  private isNonCombatStep(u: HUnit): boolean {
    if (!u.loop) return true; // no workflow = simple move, treat as non-combat
    const step = u.loop.steps[u.loop.currentStep];
    if (!step) return true;
    return step.action !== 'attack_camp'
      && step.action !== 'attack_enemies'
      && step.action !== 'hunt'
      && step.action !== 'kill_only'
      && step.action !== 'defend';
  }

  // ─── SPATIAL GRID ──────────────────────────────────────────
  private rebuildSpatialGrid() {
    // 4a: Pass bucket pool for array reuse; 4e: numeric keys via updated buildSpatialGrid
    this._spatialGrid = buildSpatialGrid(this.units, this.spatialCellSize, this._spatialGrid || undefined, this._bucketPool);
    this.spatialGrid = this._spatialGrid;
  }

  // Fix C: per-frame spatial query cache to avoid redundant lookups
  private _nearbyCache = new Map<string, HUnit[]>();

  private getNearbyUnits(x: number, y: number, radius: number): HUnit[] {
    // Quantize position to 16px grid for cache hits on nearby queries
    const qx = (x >> 4) << 4, qy = (y >> 4) << 4;
    const cacheKey = `${qx}_${qy}_${radius}`;
    const cached = this._nearbyCache.get(cacheKey);
    if (cached) return cached;

    let result: HUnit[];
    // For small radii (within one cell), use the optimized 3x3 lookup
    if (radius <= this.spatialCellSize) {
      result = getNearbyFromGrid(this.spatialGrid, x, y, radius, this.spatialCellSize) as HUnit[];
    } else {
      // 4e: For larger radii, scan the full cell range with numeric keys
      const cs = this.spatialCellSize;
      const r2 = radius * radius;
      const minCX = Math.floor((x - radius) / cs);
      const maxCX = Math.floor((x + radius) / cs);
      const minCY = Math.floor((y - radius) / cs);
      const maxCY = Math.floor((y + radius) / cs);
      result = [];
      for (let cx = minCX; cx <= maxCX; cx++) {
        for (let cy = minCY; cy <= maxCY; cy++) {
          const bucket = this.spatialGrid.get(cy * SPATIAL_KEY_STRIDE + cx);
          if (!bucket) continue;
          for (const u of bucket) {
            const ux = u.x - x, uy = u.y - y;
            if (ux * ux + uy * uy <= r2) result.push(u as HUnit);
          }
        }
      }
    }
    this._nearbyCache.set(cacheKey, result);
    return result;
  }

  // ─── A* SAFE PATHFINDING ────────────────────────────────────
  private static readonly PATH_CELL = 64;
  private static readonly PATH_GRID = 100; // 6400 / 64

  /** Compute an A* path around obstacles. rockOnly=true skips threat avoidance (for combat/aggressive units). */
  private computeSafePath(u: HUnit, rockOnly = false): {x: number; y: number}[] | null {
    const CELL = HordeScene.PATH_CELL;
    const G = HordeScene.PATH_GRID;
    const team = u.team as 1 | 2;
    const avoidRange = u.mods.caution === 'safe' ? 250 : 180;

    // 1. Build blocked grid — reuse class buffer, copy from cached static grid
    const blocked = this._astarBlocked;
    if (this._staticBlockedGrid) {
      blocked.set(this._staticBlockedGrid);
    } else {
      blocked.fill(0);
      // Fallback if cache not built yet
      const tiles = this.mapDef?.tiles;
      if (tiles) {
        for (let gy = 0; gy < G && gy < tiles.length; gy++) {
          for (let gx = 0; gx < G && gx < tiles[0].length; gx++) {
            if (tiles[gy][gx] === 2 || tiles[gy][gx] === 3) blocked[gy * G + gx] = 1;
          }
        }
      }
    }

    // Soft avoidance penalty grid — cached per-frame by team + rockOnly
    const avoidKey = `${team}_${rockOnly}_${avoidRange}`;
    let avoidPenalty: Float32Array;
    if (this._frameAvoidPenalty.has(avoidKey)) {
      avoidPenalty = this._frameAvoidPenalty.get(avoidKey)!;
    } else {
      avoidPenalty = this._avoidPenaltyPool.pop() || new Float32Array(G * G);
      avoidPenalty.fill(0);
      if (!rockOnly) {
        for (const o of this.units) {
          if (o.dead || o.team === team || (o.team === 0 && o.campId === null)) continue;
          const ocx = Math.floor(o.x / CELL);
          const ocy = Math.floor(o.y / CELL);
          const r = Math.ceil(avoidRange / CELL);
          for (let dy = -r; dy <= r; dy++) {
            for (let dx = -r; dx <= r; dx++) {
              const gx = ocx + dx, gy = ocy + dy;
              if (gx < 0 || gx >= G || gy < 0 || gy >= G) continue;
              const cx = (gx + 0.5) * CELL, cy = (gy + 0.5) * CELL;
              const dist2 = (cx - o.x) ** 2 + (cy - o.y) ** 2;
              if (dist2 < avoidRange * avoidRange) {
                const t = 1 - Math.sqrt(dist2) / avoidRange;
                avoidPenalty[gy * G + gx] = Math.max(avoidPenalty[gy * G + gx], 2 + 6 * t);
              }
            }
          }
        }

        // Soft penalty near hostile camps
        const targetAnimal = u.loop ? this.getBootstrapAnimal(u.loop) : undefined;
        const campRange = avoidRange * 1.5;
        for (const c of this.camps) {
          if (c.owner === team) continue;
          if (targetAnimal && c.animalType === targetAnimal) continue;
          // 2d: Use pre-built _defendedCamps instead of O(n) scan
          if (!this._defendedCamps.has(c.id) && c.owner === 0) continue;
          const ccx = Math.floor(c.x / CELL);
          const ccy = Math.floor(c.y / CELL);
          const r = Math.ceil(campRange / CELL);
          for (let dy = -r; dy <= r; dy++) {
            for (let dx = -r; dx <= r; dx++) {
              const gx = ccx + dx, gy = ccy + dy;
              if (gx < 0 || gx >= G || gy < 0 || gy >= G) continue;
              const cx = (gx + 0.5) * CELL, cy = (gy + 0.5) * CELL;
              const dist2 = (cx - c.x) ** 2 + (cy - c.y) ** 2;
              if (dist2 < campRange * campRange) {
                const t = 1 - Math.sqrt(dist2) / campRange;
                avoidPenalty[gy * G + gx] = Math.max(avoidPenalty[gy * G + gx], 3 + 7 * t);
              }
            }
          }
        }
      } // end if (!rockOnly)
      this._frameAvoidPenalty.set(avoidKey, avoidPenalty);
    }

    // 2. A* search (8-directional)
    const sx = Math.max(0, Math.min(G - 1, Math.floor(u.x / CELL)));
    const sy = Math.max(0, Math.min(G - 1, Math.floor(u.y / CELL)));
    const ex = Math.max(0, Math.min(G - 1, Math.floor(u.targetX / CELL)));
    const ey = Math.max(0, Math.min(G - 1, Math.floor(u.targetY / CELL)));

    // Unblock start and end
    blocked[sy * G + sx] = 0;
    blocked[ey * G + ex] = 0;

    if (sx === ex && sy === ey) return [];

    // Use precomputed static clearance penalty
    const clearancePenalty = this._staticClearancePenalty!;

    // Per-frame cached unit occupancy grid — reuse class buffer
    if (!this._frameOccupiedReady) {
      this._astarOccupied.fill(0);
      for (const o of this.units) {
        if (o.dead) continue;
        const ox = Math.floor(o.x / CELL), oy = Math.floor(o.y / CELL);
        if (ox >= 0 && ox < G && oy >= 0 && oy < G) this._astarOccupied[oy * G + ox] = 1;
      }
      this._frameOccupiedReady = true;
    }
    const occupied = this._astarOccupied;

    // Reuse scratch typed arrays (fill instead of allocate)
    const gScore = this._astarGScore; gScore.fill(Infinity);
    const fScore = this._astarFScore; fScore.fill(Infinity);
    const cameFrom = this._astarCameFrom; cameFrom.fill(-1);
    const closed = this._astarClosed; closed.fill(0);

    const si = sy * G + sx;
    gScore[si] = 0;
    fScore[si] = Math.max(Math.abs(ex - sx), Math.abs(ey - sy)); // Chebyshev heuristic

    // Binary min-heap on fScore
    const heap: number[] = [si];
    const inOpen = this._astarInOpen; inOpen.fill(0);
    inOpen[si] = 1;

    const heapPush = (node: number) => {
      heap.push(node);
      let i = heap.length - 1;
      while (i > 0) {
        const parent = (i - 1) >> 1;
        if (fScore[heap[i]] < fScore[heap[parent]]) {
          const tmp = heap[i]; heap[i] = heap[parent]; heap[parent] = tmp;
          i = parent;
        } else break;
      }
    };

    const heapPop = (): number => {
      const top = heap[0];
      const last = heap.pop()!;
      if (heap.length > 0) {
        heap[0] = last;
        let i = 0;
        const len = heap.length;
        while (true) {
          let smallest = i;
          const l = 2 * i + 1, r = 2 * i + 2;
          if (l < len && fScore[heap[l]] < fScore[heap[smallest]]) smallest = l;
          if (r < len && fScore[heap[r]] < fScore[heap[smallest]]) smallest = r;
          if (smallest === i) break;
          const tmp = heap[i]; heap[i] = heap[smallest]; heap[smallest] = tmp;
          i = smallest;
        }
      }
      return top;
    };

    const dirs = [[-1,0,1],[1,0,1],[0,-1,1],[0,1,1],[-1,-1,1.414],[-1,1,1.414],[1,-1,1.414],[1,1,1.414]];
    let found = false;
    let iters = 0;
    const manhattan = Math.abs(ex - sx) + Math.abs(ey - sy);
    const MAX_ITERS = Math.min(10000, manhattan * 50 + 500);

    while (heap.length > 0 && iters < MAX_ITERS) {
      iters++;
      const cur = heapPop();
      inOpen[cur] = 0;

      // Skip stale duplicates
      if (closed[cur]) continue;

      const cx = cur % G, cy = (cur - cx) / G;
      if (cx === ex && cy === ey) { found = true; break; }

      closed[cur] = 1;

      for (const [ddx, ddy, cost] of dirs) {
        const nx = cx + ddx, ny = cy + ddy;
        if (nx < 0 || nx >= G || ny < 0 || ny >= G) continue;
        const ni = ny * G + nx;
        if (closed[ni] || blocked[ni]) continue;

        // Pre-computed clearance penalty + occupancy lookup
        const penalty = clearancePenalty[ni] + avoidPenalty[ni] + (occupied[ni] ? 2 : 0);

        const tentG = gScore[cur] + cost + penalty;
        if (tentG < gScore[ni]) {
          cameFrom[ni] = cur;
          gScore[ni] = tentG;
          fScore[ni] = tentG + Math.max(Math.abs(ex - nx), Math.abs(ey - ny));
          if (!inOpen[ni]) { heapPush(ni); inOpen[ni] = 1; }
        }
      }
    }

    if (!found) {
      console.warn(`[A*] No path: unit ${u.id} (${u.type}) at (${Math.round(u.x)},${Math.round(u.y)}) → (${Math.round(u.targetX)},${Math.round(u.targetY)}), iters=${iters}`);
      return null;
    }

    // 3. Reconstruct path
    const rawPath: {x: number; y: number}[] = [];
    let ci = ey * G + ex;
    while (ci !== si && ci >= 0) {
      const px = ci % G, py = (ci - px) / G;
      rawPath.unshift({ x: (px + 0.5) * CELL, y: (py + 0.5) * CELL });
      ci = cameFrom[ci];
    }

    // 4. Smooth path — skip waypoints with clear line of sight
    if (rawPath.length <= 2) return rawPath;
    const smoothed: {x: number; y: number}[] = [rawPath[0]];
    let anchor2 = 0;
    while (anchor2 < rawPath.length - 1) {
      let furthest = anchor2 + 1;
      for (let test = rawPath.length - 1; test > anchor2 + 1; test--) {
        if (this.lineOfSightClear(rawPath[anchor2], rawPath[test], blocked, G, CELL)) {
          furthest = test;
          break;
        }
      }
      smoothed.push(rawPath[furthest]);
      anchor2 = furthest;
    }
    return smoothed;
  }

  /** Check if straight line between two points passes through any blocked cell */
  private lineOfSightClear(
    a: {x: number; y: number}, b: {x: number; y: number},
    blocked: Uint8Array, G: number, CELL: number
  ): boolean {
    const dx = b.x - a.x, dy = b.y - a.y;
    const dist = Math.sqrt(dx * dx + dy * dy);
    const steps = Math.ceil(dist / (CELL * 0.5)); // sample every half-cell
    for (let i = 0; i <= steps; i++) {
      const t = i / Math.max(steps, 1);
      const px = a.x + dx * t, py = a.y + dy * t;
      const gx = Math.floor(px / CELL), gy = Math.floor(py / CELL);
      if (gx >= 0 && gx < G && gy >= 0 && gy < G && blocked[gy * G + gx]) return false;
    }
    return true;
  }

  /** Spread out: when seeking carrots, stay in home zone; otherwise fan out from map center. */
  private spreadOut(u: HUnit) {
    // Only pick a new target once we've reached the current one
    if (pdist(u, { x: u.targetX, y: u.targetY }) > 30) return;

    if (!u.loop) return;
    const step = u.loop.steps[u.loop.currentStep];
    if (!step) return;

    // For carrot seeking: spread within the team's home carrot zone
    if (step.action === 'seek_resource' && (step as any).resourceType === 'carrot' && u.team !== 0) {
      const zone = this.getHomeCarrotZone(u.team as 1 | 2);
      if (zone) {
        u.targetX = zone.x + Math.random() * zone.w;
        u.targetY = zone.y + Math.random() * zone.h;
        return;
      }
    }

    // Gather all allies (including this unit) on the same workflow action
    const searchers = this.units.filter(a =>
      !a.dead && a.team === u.team
      && a.loop && a.loop.steps[a.loop.currentStep]?.action === step.action);

    const cx = WORLD_W / 2, cy = WORLD_H / 2;

    if (searchers.length <= 1) {
      // Solo — random direction from map center
      const angle = Math.random() * Math.PI * 2;
      const range = 300 + Math.random() * 500;
      u.targetX = Math.max(100, Math.min(WORLD_W - 100, cx + Math.cos(angle) * range));
      u.targetY = Math.max(100, Math.min(WORLD_H - 100, cy + Math.sin(angle) * range));
      return;
    }

    // Sort searchers by ID for stable sector assignment
    searchers.sort((a, b) => a.id - b.id);
    const myIndex = searchers.indexOf(u);
    const n = searchers.length;

    // Each unit gets a unique sector wedge from the map center
    const sectorAngle = (2 * Math.PI) / n;
    const baseAngle = sectorAngle * myIndex;
    // Add small random jitter within the sector so units don't path to the exact same point
    const angle = baseAngle + (Math.random() * 0.6 - 0.3) * sectorAngle;
    const range = 400 + Math.random() * 600;

    u.targetX = Math.max(100, Math.min(WORLD_W - 100, cx + Math.cos(angle) * range));
    u.targetY = Math.max(100, Math.min(WORLD_H - 100, cy + Math.sin(angle) * range));
  }

  // ─── COMBAT ──────────────────────────────────────────────────

  private updateCombat(delta: number) {
    for (const u of this.units) {
      if (u.dead) continue;

      // Caution: safe — retreat to base at 40% HP (skulls exempt — let Undying proc)
      if (u.team !== 0 && u.mods.caution === 'safe' && u.type !== 'skull') {
        if (u.hp / u.maxHp < 0.4) {
          const retreatBase = u.team === 1 ? P1_BASE : P2_BASE;
          u.targetX = retreatBase.x; u.targetY = retreatBase.y;
          continue; // skip combat, flee
        }
      }

      // Scouts and collectors always skip combat (pacifist); carrying units on non-combat steps also skip
      // Caution: aggressive — carrying units fight back instead of skipping
      if (u.team !== 0 && this.isNonCombatStep(u)) {
        const step = u.loop ? u.loop.steps[u.loop.currentStep] : undefined;
        const pacifist = step && ((step.action === 'scout' || step.action === 'collect') && u.mods.caution !== 'aggressive');
        if (pacifist || (u.carrying && u.mods.caution !== 'aggressive')) continue;
      }

      if (u.carrying && u.team !== 0) {
        const combatRange = u.type === 'hyena' ? 120 : u.type === 'shaman' ? 100 : COMBAT_RANGE;
        const onCombatStep = !this.isNonCombatStep(u);
        // Include neutral defenders as threats when on attack_camp step
        const isAttackingCamp = u.loop?.steps[u.loop.currentStep]?.action === 'attack_camp';

        // Caution affects how carriers react to threats:
        // safe: never drop, flee to base instead
        // aggressive: only drop if enemy within melee range (not extended range)
        // normal: drop if enemy within combat range + 30
        const dropRange = u.mods.caution === 'aggressive' ? COMBAT_RANGE : combatRange + 30;
        const nearbyForDrop = this.getNearbyUnits(u.x, u.y, dropRange);
        const enemyNear = nearbyForDrop.some(o =>
          o.team !== u.team
          && (o.team !== 0 || isAttackingCamp));

        if (u.mods.caution === 'safe' && enemyNear) {
          // Safe: flee to base with resource, don't drop
          const base = u.team === 1 ? P1_BASE : P2_BASE;
          u.targetX = base.x; u.targetY = base.y;
          continue;
        } else if (enemyNear) {
          // Normal/aggressive: drop carried resource and engage
          this.spawnGroundItem(u.carrying, u.x, u.y);
          u.carrying = null;
          if (u.carrySprite) { u.carrySprite.destroy(); u.carrySprite = null; }
          // Reset workflow to seeking phase so they re-pick after combat
          if (u.loop) {
            const step = u.loop.steps[u.loop.currentStep];
            if (step?.action === 'deliver') {
              u.loop.currentStep = (u.loop.currentStep - 1 + u.loop.steps.length) % u.loop.steps.length;
            }
          }
        } else if (!onCombatStep) {
          continue; // Non-combat step, no enemies — keep carrying, skip combat
        }
        // Combat step with no nearby enemy — fall through to normal combat processing
      }

      // PANDA "Thick Hide": regenerate 1% max HP per second
      if (u.type === 'panda' && u.hp < u.maxHp) {
        u.hp = Math.min(u.maxHp, u.hp + u.maxHp * 0.01 * (delta / 1000));
      }

      u.attackTimer -= delta;

      if (u.attackTimer > 0) continue;

      // Find closest enemy: team 0 attacks anyone, team 1/2 attack each other AND team 0
      // HYENA "Bone Toss": extended combat range (120 vs 80)
      // Caution: aggressive — engage enemies from 200px even mid-delivery (but not through nexus area)
      const baseCombatRange = u.type === 'hyena' ? 120 : u.type === 'shaman' ? 100 : COMBAT_RANGE;
      const unitCombatRange = u.mods.caution === 'aggressive' ? Math.max(baseCombatRange, 200) : baseCombatRange;
      let best: HUnit | null = null, bestD = Infinity;
      const nearbyCombat = this.getNearbyUnits(u.x, u.y, unitCombatRange);
      for (const o of nearbyCombat) {
        if (o.team === u.team) continue;
        if (u.team === 0 && o.team === 0) continue;
        // ─── ROGUE STEALTH: invisible to neutral enemies ───
        if (u.team === 0 && o.type === 'rogue') continue;
        const d = pdist(u, o);
        if (d <= unitCombatRange && d < bestD) { bestD = d; best = o; }
      }

      // ─── TURTLE TAUNT: nearby enemy turtles force this unit to attack them ───
      if (best && u.type !== 'turtle') {
        let tauntTurtle: HUnit | null = null, tauntD = Infinity;
        const nearbyTaunt = this.getNearbyUnits(u.x, u.y, TURTLE_TAUNT_RANGE);
        for (const o of nearbyTaunt) {
          if (o.type !== 'turtle' || o.team === u.team) continue;
          if (u.team === 0 && o.team === 0) continue;
          const d = pdist(u, o);
          if (d <= TURTLE_TAUNT_RANGE && d < tauntD) { tauntD = d; tauntTurtle = o; }
        }
        if (tauntTurtle) { best = tauntTurtle; bestD = tauntD; }
      }

      // Tower attack — enemy player units attack nearby towers
      let closestTower: HTower | null = null;
      let towerD = Infinity;
      if (u.team !== 0) {
        for (const tw of this.towers) {
          if (!tw.alive || tw.team === u.team) continue;
          const td = pdist(u, tw);
          if (td < towerD) { towerD = td; closestTower = tw; }
        }
      }

      // Nexus attack (only player units)
      const nex = u.team !== 0 ? this.nexuses.find(n => n.team !== u.team) : null;
      const nexD = nex ? pdist(u, nex) : Infinity;

      // ─── ELEVATION COMBAT CHECK ───
      // Melee from ground (elev 0) can't hit high ground (elev 1) units
      if (best) {
        const attackerElev = this.getElevation(u.x, u.y);
        const targetElev = this.getElevation(best.x, best.y);
        const isRangedUnit = u.type === 'hyena' || u.type === 'shaman';
        if (attackerElev === 0 && targetElev === 1 && !isRangedUnit) {
          best = null;
        }
      }

      if (best) {
        const eqB = u.team !== 0 ? this.getUnitEquipBuffs(u) : null;
        const bannerB = u.team !== 0 ? this.getBannerAura(u) : { attack: 0 };
        const buffMult = u.team !== 0 ? (1 + this.getBuffs(u.team as 1 | 2).attack + (eqB?.attack || 0) + bannerB.attack) : 1;
        let atk = u.attack * buffMult;
        const uTier = ANIMALS[u.type]?.tier || 1;

        // ─── HARD COUNTER: 2x damage ───
        const counters = HARD_COUNTERS[u.type];
        if (counters && counters.includes(best.type)) atk *= 2;

        // ─── SPIDER VENOM BITE: +5% of target's max HP as bonus damage ───
        if (u.type === 'spider') {
          atk += best.maxHp * 0.05;
        }

        // ─── LIZARD COLD BLOOD: 3x to targets below 40% HP ───
        let hitIsCrit = false;
        if (u.type === 'lizard' && best.hp / best.maxHp < 0.4) {
          atk *= 3;
          hitIsCrit = true;
        }

        // ─── ROGUE BACKSTAB: 3x damage on first hit against a new target ───
        if (u.type === 'rogue') {
          if (u.lastAttackTarget !== best.id) {
            atk *= 3;
            hitIsCrit = true;
            this.sfx.playAt('thief_hop', u.x, u.y);
          }
          u.lastAttackTarget = best.id;
        }

        // ─── MINOTAUR WAR CRY: nearby allies get +25% attack (check if attacker has minotaur nearby) ───
        if (u.team !== 0 && u.type !== 'minotaur') {
          const nearbyAllies = this.getNearbyUnits(u.x, u.y, 150);
          const hasMinotaurNearby = nearbyAllies.some(l =>
            l.type === 'minotaur' && l.team === u.team
          );
          if (hasMinotaurNearby) atk *= 1.25;
        }

        // ─── TURTLE SHELL STANCE: 60% damage reduction when stationary ───
        const isStationary = pdist(best, { x: best.targetX, y: best.targetY }) < 15;
        if (best.type === 'turtle' && isStationary) {
          atk *= 0.4;
          const now = this.time.now;
          if (now - this.lastTurtleGuardSfx > 3000) {
            this.sfx.playAt('turtle_guard', best.x, best.y);
            this.lastTurtleGuardSfx = now;
          }
        }

        // Splash: Troll = 90px, Shaman = 60px (always), T4 = 50px, T3 = 40px, others = none
        const splashRadius = u.type === 'troll' ? 90 : u.type === 'shaman' ? 60 : uTier >= 4 ? 50 : uTier >= 3 ? 40 : 0;
        const splashList: { id: number; dmg: number }[] = [];
        if (splashRadius > 0) {
          const nearbySplash = this.getNearbyUnits(best.x, best.y, splashRadius);
          for (const o of nearbySplash) {
            if (o === best || o.team === u.team) continue;
            if (u.team === 0 && o.team === 0) continue;
            if (pdist(o, best) <= splashRadius) {
              let sDmg = atk * 0.5;
              if (o.type === 'turtle') {
                const tStat = pdist(o, { x: o.targetX, y: o.targetY }) < 15;
                if (tStat) sDmg *= 0.4;
              }
              if (o.team !== 0) sDmg *= this.getUnitEquipBuffs(o).damageTaken;
              splashList.push({ id: o.id, dmg: sDmg });
            }
          }
        }

        // Apply equip damage reduction to primary target
        let primaryDmg = atk;
        if (best.team !== 0) primaryDmg *= this.getUnitEquipBuffs(best).damageTaken;

        // Queue delayed damage — animation plays now, damage lands later
        const ranged = u.type === 'hyena' || u.type === 'shaman';
        const proj = ranged ? this.spawnProjectile(u, best.x, best.y) : null;
        if (ranged) this.sfx.playAt('ranged_throw', u.x, u.y);
        this.pendingHits.push({
          attackerId: u.id,
          targetId: best.id,
          nexusTeam: 0,
          dmg: primaryDmg,
          splashTargets: splashList,
          timer: ranged ? 3000 : this.HIT_DELAY_MS,
          isTroll: u.type === 'troll',
          isRanged: ranged,
          isSplash: splashList.length > 0,
          isCrit: hitIsCrit,
          projectile: proj,
          projX: u.x, projY: u.y,
          projSpeed: ranged ? PROJECTILE_SPEED : 0,
        });

        let cd = ATTACK_CD_MS;
        if (u.team !== 0) { const eqCd = this.getUnitEquipBuffs(u); cd *= eqCd.atkSpeedMult; }
        u.attackTimer = cd;

        // Face attack target + play attack animation immediately
        u.attackFaceX = best.x;
        if (u.sprite && u.animState !== 'attack' && HORDE_SPRITE_CONFIGS[u.type]) {
          u.animState = 'attack';
          u.sprite.play(`h_${u.type}_attack`);
        }
      } else if (nex && nexD <= COMBAT_RANGE && u.team !== 0) {
        const neqB = this.getUnitEquipBuffs(u);
        const nBan = this.getBannerAura(u);
        const nexDmg = u.attack * (1 + this.getBuffs(u.team as 1 | 2).attack + neqB.attack + nBan.attack);

        // Queue delayed nexus damage
        this.pendingHits.push({
          attackerId: u.id,
          targetId: -1,
          nexusTeam: nex.team,
          dmg: nexDmg,
          splashTargets: [],
          timer: this.HIT_DELAY_MS,
          isTroll: false,
          isRanged: false,
          isSplash: false,
          isCrit: false,
          projectile: null,
          projX: 0, projY: 0,
          projSpeed: 0,
        });
        u.attackTimer = ATTACK_CD_MS;

        // Face nexus + play attack animation immediately
        u.attackFaceX = nex.x;
        if (u.sprite && u.animState !== 'attack' && HORDE_SPRITE_CONFIGS[u.type]) {
          u.animState = 'attack';
          u.sprite.play(`h_${u.type}_attack`);
        }
      } else if (closestTower && towerD <= COMBAT_RANGE && u.team !== 0) {
        // Attack enemy tower
        const twB = this.getUnitEquipBuffs(u);
        const twBan = this.getBannerAura(u);
        const twDmg = u.attack * (1 + this.getBuffs(u.team as 1 | 2).attack + twB.attack + twBan.attack);
        closestTower.hp -= twDmg;
        this.spawnDmgNumber(closestTower.x, closestTower.y - 20, twDmg, true, u);
        u.attackTimer = ATTACK_CD_MS;
        u.attackFaceX = closestTower.x;
        if (u.sprite && u.animState !== 'attack' && HORDE_SPRITE_CONFIGS[u.type]) {
          u.animState = 'attack';
          u.sprite.play(`h_${u.type}_attack`);
        }
      }
    }
  }

  // ─── PROJECTILE HELPERS (Fix G: object pooling) ────────────

  private _projPool: Phaser.GameObjects.Container[] = [];

  private spawnProjectile(attacker: HUnit, tx: number, ty: number): Phaser.GameObjects.Container {
    let container = this._projPool.pop();
    if (container) {
      container.setPosition(attacker.x, attacker.y).setVisible(true).setActive(true);
    } else {
      container = this.add.container(attacker.x, attacker.y).setDepth(50);
      const isShaman = attacker.type === 'shaman';
      if (isShaman) {
        const glow = this.add.circle(0, 0, 8, 0xBB66FF, 0.6);
        const core = this.add.circle(0, 0, 4, 0xEEAAFF, 1.0);
        container.add([glow, core]);
      } else {
        const bone = this.add.circle(0, 0, 5, 0xDDCC88, 1.0);
        const tip = this.add.circle(2, 0, 3, 0xFFEEAA, 0.9);
        container.add([bone, tip]);
      }
    }
    const angle = Math.atan2(ty - attacker.y, tx - attacker.x);
    container.setRotation(angle);
    return container;
  }

  private destroyProjectile(hit: PendingHit) {
    if (hit.projectile) {
      hit.projectile.setVisible(false).setActive(false);
      if (this._projPool.length < 50) {
        this._projPool.push(hit.projectile);
      } else {
        hit.projectile.destroy();
      }
      hit.projectile = null;
    }
  }

  // ─── DELAYED DAMAGE: process pending hits after animation wind-up ───

  private processPendingHits(delta: number) {
    const still: PendingHit[] = [];
    for (const hit of this.pendingHits) {
      // Ranged: move projectile toward target, hit on arrival
      if (hit.isRanged && hit.projSpeed > 0) {
        // Find current target position (homing)
        let tx = hit.projX, ty = hit.projY;
        if (hit.targetId >= 0) {
          const tgt = this._unitById.get(hit.targetId);
          if (tgt && !tgt.dead) { tx = tgt.x; ty = tgt.y; }
        } else if (hit.nexusTeam !== 0) {
          const nex = this.nexuses.find(n => n.team === hit.nexusTeam);
          if (nex) { tx = nex.x; ty = nex.y; }
        }
        // Move projectile
        const dx = tx - hit.projX, dy = ty - hit.projY;
        const dist = Math.sqrt(dx * dx + dy * dy) || 1;
        const step = hit.projSpeed * (delta / 1000);
        if (dist <= PROJECTILE_HIT_DIST || step >= dist) {
          // Arrived — apply damage below
          hit.projX = tx; hit.projY = ty;
          hit.timer = 0; // force damage
        } else {
          hit.projX += (dx / dist) * step;
          hit.projY += (dy / dist) * step;
          // Update projectile visual
          if (hit.projectile) {
            hit.projectile.setPosition(hit.projX, hit.projY);
            hit.projectile.setRotation(Math.atan2(dy, dx));
          }
          hit.timer -= delta;
          if (hit.timer > 0) { still.push(hit); continue; }
          // Fallback timeout — apply damage anyway
        }
        this.destroyProjectile(hit);
      } else {
        // Melee: flat timer countdown
        hit.timer -= delta;
        if (hit.timer > 0) { still.push(hit); continue; }
      }

      // Nexus hit
      if (hit.targetId === -1 && hit.nexusTeam !== 0) {
        const nex = this.nexuses.find(n => n.team === hit.nexusTeam);
        if (nex) {
          nex.hp -= hit.dmg;
          const attacker = this._unitById.get(hit.attackerId);
          if (attacker) this.spawnDmgNumber(nex.x, nex.y - 20, hit.dmg, true, attacker);
          this.sfx.playAt(nex.hp < 5000 ? 'nexus_critical' : 'nexus_damage', nex.x, nex.y);
          // Nexus hit explosion (throttled to max 1 per second)
          const now = Date.now();
          if (!nex._lastHitFx || now - nex._lastHitFx > 1000) {
            nex._lastHitFx = now;
            if (this.textures.exists('ts_explosion01')) {
              const hitFx = this.add.sprite(nex.x, nex.y, 'ts_explosion01').setScale(0.6).setDepth(10).setOrigin(0.5);
              hitFx.play('ts_explosion01_anim');
              hitFx.once('animationcomplete', () => hitFx.destroy());
            }
          }
        }
        this.destroyProjectile(hit);
        continue;
      }

      // Unit hit
      const target = this._unitById.get(hit.targetId);
      const isTowerShot = hit.attackerId === -2;
      const attacker = isTowerShot ? null : (this._unitById.get(hit.attackerId) ?? null);
      if (!target || target.dead || (!attacker && !isTowerShot)) {
        this.destroyProjectile(hit);
        continue;
      }
      if (target && !target.dead) {
        target.hp -= hit.dmg;
        // Track total damage for match stats
        if (attacker && attacker.team !== 0) this.matchStats.totalDamage[attacker.team as 1|2] += hit.dmg;
        if (attacker) {
          this.spawnDmgNumber(target.x, target.y - 10, hit.dmg, true, attacker);
        } else {
          // Tower shot damage number (no attacker unit)
          this.spawnDmgNumber(target.x, target.y - 10, hit.dmg, true, null);
        }

        // Tower shot: spawn explosion at impact
        if (isTowerShot && this.textures.exists('tower_explosion')) {
          const expl = this.add.sprite(target.x, target.y, 'tower_explosion')
            .setScale(0.6).setDepth(51).setOrigin(0.5);
          expl.play('tower_explode_anim');
          expl.once('animationcomplete', () => expl.destroy());
          this.sfx.playAt('splash_impact', target.x, target.y);
        }

        // Per-unit attack SFX (with generic fallbacks)
        if (!isTowerShot && attacker) {
        const atkKey = ('atk_' + attacker.type) as import('../audio/SoundManager').SfxKey;
        if (hit.isTroll) {
          this.sfx.playAt('troll_slam', target.x, target.y);
        } else if (this.sfx.hasSound(atkKey)) {
          this.sfx.playAt(atkKey, target.x, target.y);
        } else if (hit.isSplash) {
          this.sfx.playAt('splash_impact', target.x, target.y);
        } else if (hit.isCrit) {
          this.sfx.playAt('critical_hit', target.x, target.y);
        } else {
          const tier = ANIMALS[attacker.type]?.tier ?? 1;
          this.sfx.playAt(tier >= 3 ? 'hit_heavy' : 'hit_light', target.x, target.y);
        }
        }

        // Tight formation scatter
        if (!target.dead && target.mods.formation === 'tight' && attacker) {
          const scDx = target.x - attacker.x, scDy = target.y - attacker.y;
          const scD = Math.sqrt(scDx * scDx + scDy * scDy) || 1;
          target.targetX = target.x + (scDx / scD) * 80;
          target.targetY = target.y + (scDy / scD) * 80;
        }

        // Troll club slam
        if (hit.isTroll && !target.dead) {
          target.attackTimer += ATTACK_CD_MS;
        }

        // Gnome Plucky — survives 2 lethal hits
        if (target.hp <= 0 && target.type === 'gnome' && target.gnomeShield > 0) {
          target.hp = 1;
          target.gnomeShield--;
          if (target.sprite) {
            this.tweens.killTweensOf(target.sprite);
            target.sprite.setAlpha(1);
            target.sprite.setTint(0xffffff);
            this.tweens.add({
              targets: target.sprite, alpha: 0.3, duration: 60, yoyo: true, repeat: 2,
              onComplete: () => { if (target.sprite) target.sprite.setAlpha(1); },
            });
          }
        }

        // Skull Undying
        if (target.hp <= 0 && target.type === 'skull' && target.hasRebirth) {
          target.hp = 1;
          target.hasRebirth = false;
          this.sfx.playAt('undying_proc', target.x, target.y);
          if (target.sprite) {
            this.tweens.killTweensOf(target.sprite);
            target.sprite.setAlpha(1);
            target.sprite.setScale(1.8);
            this.tweens.add({
              targets: target.sprite, scaleX: 1, scaleY: 1, duration: 400, ease: 'Back.easeOut',
            });
          }
        } else if (target.hp <= 0) {
          target.dead = true;
          target.claimItemId = -1;
          // Track kills, deaths, and top killer
          if (target.team !== 0) this.matchStats.unitsLost[target.team as 1|2]++;
          if (attacker && attacker.team !== 0) {
            const atkTeam = attacker.team as 1 | 2;
            this.matchStats.totalKills[atkTeam]++;
            const kc = (this.unitKillCounts.get(attacker.id) || 0) + 1;
            this.unitKillCounts.set(attacker.id, kc);
            if (kc > this.topKiller[atkTeam].kills) {
              this.topKiller[atkTeam] = { type: attacker.type, kills: kc };
            }
          }
          const deathKey = ('death_' + target.type) as import('../audio/SoundManager').SfxKey;
          if (this.sfx.hasSound(deathKey)) {
            this.sfx.playAt(deathKey, target.x, target.y);
          } else {
            const deathTier = ANIMALS[target.type]?.tier ?? 1;
            this.sfx.playAt(deathTier >= 3 ? 'death_heavy' : 'death_small', target.x, target.y);
          }
          this.spawnGroundItem('meat', target.x + (Math.random() - 0.5) * 20, target.y + (Math.random() - 0.5) * 20);
          if (target.isElite) {
            this.eliteKillCount++;
            for (let ci = 0; ci < 3; ci++) {
              this.spawnGroundItem('crystal', target.x + (Math.random() - 0.5) * 40, target.y + (Math.random() - 0.5) * 40);
            }
          }
          if (target.carrying) {
            this.spawnGroundItem(target.carrying, target.x, target.y);
            target.carrying = null;
          }
        }

        // Hit flash
        if (target.sprite && !target.dead) {
          this.tweens.killTweensOf(target.sprite);
          target.sprite.setAlpha(1);
          this.tweens.add({
            targets: target.sprite, alpha: 0.4, duration: 80, yoyo: true,
            onComplete: () => { if (target.sprite) target.sprite.setAlpha(1); },
          });
        }
      }

      // Splash targets
      for (const sp of hit.splashTargets) {
        const sTarget = this._unitById.get(sp.id);
        if (!sTarget || sTarget.dead) continue;
        sTarget.hp -= sp.dmg;
        if (attacker) this.spawnDmgNumber(sTarget.x, sTarget.y - 10, sp.dmg, false, attacker);
        else if (isTowerShot) this.spawnDmgNumber(sTarget.x, sTarget.y - 10, sp.dmg, false, null);

        if (hit.isTroll && !sTarget.dead) {
          sTarget.attackTimer += ATTACK_CD_MS;
        }

        // Gnome Plucky for splash
        if (sTarget.hp <= 0 && sTarget.type === 'gnome' && sTarget.gnomeShield > 0) {
          sTarget.hp = 1;
          sTarget.gnomeShield--;
        }

        // Skull Undying for splash
        if (sTarget.hp <= 0 && sTarget.type === 'skull' && sTarget.hasRebirth) {
          sTarget.hp = 1;
          sTarget.hasRebirth = false;
        } else if (sTarget.hp <= 0) {
          sTarget.dead = true;
          sTarget.claimItemId = -1;
          // Track splash kills/deaths
          if (sTarget.team !== 0) this.matchStats.unitsLost[sTarget.team as 1|2]++;
          if (attacker && attacker.team !== 0) {
            const atkTeam = attacker.team as 1 | 2;
            this.matchStats.totalKills[atkTeam]++;
            const kc = (this.unitKillCounts.get(attacker.id) || 0) + 1;
            this.unitKillCounts.set(attacker.id, kc);
            if (kc > this.topKiller[atkTeam].kills) {
              this.topKiller[atkTeam] = { type: attacker.type, kills: kc };
            }
          }
          this.spawnGroundItem('meat', sTarget.x + (Math.random() - 0.5) * 20, sTarget.y + (Math.random() - 0.5) * 20);
          if (sTarget.isElite) {
            this.eliteKillCount++;
            for (let ci = 0; ci < 3; ci++) {
              this.spawnGroundItem('crystal', sTarget.x + (Math.random() - 0.5) * 40, sTarget.y + (Math.random() - 0.5) * 40);
            }
          }
          if (sTarget.carrying) {
            this.spawnGroundItem(sTarget.carrying, sTarget.x, sTarget.y);
            sTarget.carrying = null;
          }
        }

        // Hit flash for splash
        if (sTarget.sprite && !sTarget.dead) {
          this.tweens.killTweensOf(sTarget.sprite);
          sTarget.sprite.setAlpha(1);
          this.tweens.add({
            targets: sTarget.sprite, alpha: 0.4, duration: 80, yoyo: true,
            onComplete: () => { if (sTarget.sprite) sTarget.sprite.setAlpha(1); },
          });
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
    this.pendingHits = still;
  }

  // ─── CAMP CAPTURE (real unit combat) ────────────────────────

  private updateCampCapture() {
    for (const camp of this.camps) {
      // Skip dormant camps (tier not yet unlocked by era)
      if (!this.isCampActive(camp)) continue;

      const defenders = this.units.filter(u => u.campId === camp.id && u.team === 0 && !u.dead);

      // Make neutral defenders patrol around their camp — always walking
      for (const d of defenders) {
        const distToCamp = pdist(d, camp);
        const distToTarget = pdist(d, { x: d.targetX, y: d.targetY });
        // Pick new patrol point when arrived or drifted too far
        if (distToTarget < 12 || distToCamp > 120) {
          const a = Math.random() * Math.PI * 2;
          const r = 40 + Math.random() * 60;
          d.targetX = camp.x + Math.cos(a) * r;
          d.targetY = camp.y + Math.sin(a) * r;
        }
      }

      if (camp.owner === 0) {
        // Neutral camp: if all defenders dead, whoever is nearby captures it
        if (defenders.length === 0) {
          const nearby = this.units.filter(u => !u.dead && u.team !== 0 && pdist(u, camp) <= CAMP_RANGE);
          const teams = new Set(nearby.map(u => u.team));
          if (teams.size === 1) {
            const winner = [...teams][0] as 1 | 2;
            camp.owner = winner;
            camp.spawnTimer = 0;
            this.sfx.playAt('camp_captured', camp.x, camp.y);
            this.showFeedback(
              `Captured ${camp.name}!`,
              winner === 1 ? '#45E6B0' : '#FF6B6B',
            );
            this.matchStats.campsCaptured[winner]++;
            this.spawnCampLoot(camp, winner);
            // Camp capture explosion
            if (this.textures.exists('ts_explosion02')) {
              const boom = this.add.sprite(camp.x, camp.y, 'ts_explosion02').setScale(1.0).setDepth(15).setOrigin(0.5);
              boom.play('ts_explosion02_anim');
              boom.once('animationcomplete', () => boom.destroy());
            }
          }
        }
      } else {
        // Owned camp: if enemies arrive and no allies defend, reset to neutral with fresh defenders
        const enemy = camp.owner === 1 ? 2 : 1;
        const en = this.units.filter(u => u.team === enemy && !u.dead && pdist(u, camp) <= CAMP_RANGE);
        const al = this.units.filter(u => u.team === camp.owner && !u.dead && pdist(u, camp) <= CAMP_RANGE);
        if (en.length > 0 && al.length === 0) {
          const prevOwner = camp.owner as 1 | 2;
          camp.owner = 0;
          camp.spawnTimer = 0;
          this.spawnCampDefenders(camp);
          this.sfx.playAt('camp_lost', camp.x, camp.y);
          this.showFeedback('Contested!', '#FFD93D');
          this.matchStats.campsLost[prevOwner]++;
        }
      }
    }
  }

  // ─── CAMP LOOT DROPS ──────────────────────────────────────

  private spawnCampLoot(camp: HCamp, team: 1 | 2) {
    const tier = ANIMALS[camp.animalType]?.tier ?? 1;
    const rolls = tier >= 3 ? 2 : 1;
    for (let r = 0; r < rolls; r++) {
      const roll = Math.random();
      if (roll < 0.4) {
        // Resource Burst: scatter 3-5 of the camp's resource type
        const cost = SPAWN_COSTS[camp.animalType];
        const resType = cost?.type || 'carrot';
        const count = 3 + Math.floor(Math.random() * 3); // 3-5
        for (let i = 0; i < count; i++) {
          const ox = (Math.random() - 0.5) * 80;
          const oy = (Math.random() - 0.5) * 80;
          this.spawnGroundItem(resType, camp.x + ox, camp.y + oy);
        }
        this.showFeedback(`💰 Resource Burst! +${count} ${RESOURCE_EMOJI[resType]}`, '#FFD93D');
      } else if (roll < 0.6) {
        // Speed Surge: +15% speed for 20s
        this.teamBuffs.push({ team, stat: 'speed', amount: 0.15, remaining: 20000 });
        this.showFeedback('⚡ Speed Surge! +15% for 20s', '#FFD93D');
      } else if (roll < 0.8) {
        // Attack Surge: +15% attack for 20s
        this.teamBuffs.push({ team, stat: 'attack', amount: 0.15, remaining: 20000 });
        this.showFeedback('⚔️ Attack Surge! +15% for 20s', '#FFD93D');
      } else {
        // Heal Burst: heal all friendly units within 200px for 30% max HP
        const nearby = this.units.filter(u => u.team === team && !u.dead && pdist(u, camp) <= 200);
        for (const u of nearby) {
          u.hp = Math.min(u.maxHp, u.hp + Math.round(u.maxHp * 0.3));
        }
        this.showFeedback(`💚 Heal Burst! ${nearby.length} units healed`, '#FFD93D');
      }
    }
  }

  // ─── SWEEP AUTO-CHAIN ──────────────────────────────────────

  private updateSweeps() {
    for (const key of Object.keys(this.activeSweeps)) {
      const sweep = this.activeSweeps[key];
      const currentTarget = sweep.targets[sweep.currentIdx];
      if (!currentTarget) { delete this.activeSweeps[key]; continue; }

      const camp = this.camps.find(c => c.id === currentTarget.id);
      if (!camp) { delete this.activeSweeps[key]; continue; }

      // Check if current target camp is captured by our team
      if (camp.owner === sweep.team) {
        // Advance past any already-captured camps
        sweep.currentIdx++;
        while (sweep.currentIdx < sweep.targets.length) {
          const nextId = sweep.targets[sweep.currentIdx].id;
          const nextCamp = this.camps.find(c => c.id === nextId);
          if (nextCamp && nextCamp.owner !== sweep.team) break; // found uncaptured
          sweep.currentIdx++;
        }

        if (sweep.currentIdx >= sweep.targets.length) {
          this.showFeedback('Sweep done!', '#45E6B0');
          delete this.activeSweeps[key];
          continue;
        }

        const next = sweep.targets[sweep.currentIdx];
        const sel = this.units.filter(u => u.team === sweep.team && !u.dead && (sweep.subject === 'all' || u.type === sweep.subject));
        if (sel.length > 0) {
          this.sendUnitsTo(sel, next.x, next.y, true);
          const nextName = this.camps.find(c => c.id === next.id)?.name || 'next camp';
          this.showFeedback(`Next: ${nextName}`, '#45E6B0');
        } else {
          delete this.activeSweeps[key];
        }
      }
    }
  }

  // ─── AI ──────────────────────────────────────────────────────

  private updateAI(delta: number) {
    this.aiTimer += delta;
    if (this.aiTimer < AI_TICK_MS) return;
    this.aiTimer -= AI_TICK_MS;

    // AI resource management: assign some idle units to gather
    const aiUnits = this.units.filter(u => u.team === 2 && !u.dead);
    const gatherers = aiUnits.filter(u => u.loop);
    const nonGatherers = aiUnits.filter(u => !u.loop);

    // Keep ~30% of units gathering if we have few resources
    const stock = this.baseStockpile[2];
    const needGatherers = (stock.carrot < 5 || stock.meat < 3) && gatherers.length < Math.ceil(aiUnits.length * 0.3);
    if (needGatherers) {
      const idle = nonGatherers.filter(u => !u.carrying && pdist(u, { x: u.targetX, y: u.targetY }) < 30);
      const toAssign = idle.slice(0, Math.max(1, Math.floor(idle.length * 0.3)));
      const resType: ResourceType = stock.carrot < 3 ? 'carrot' : 'meat';
      let deliverTo = 'base';
      if (resType === 'meat') {
        const mc = this.camps.filter(c => c.owner === 2 && SPAWN_COSTS[c.animalType]?.type === 'meat')
          .sort((a, b) => pdist2(a, P2_BASE) - pdist2(b, P2_BASE));
        if (mc.length > 0) deliverTo = mc[0].id;
      }
      for (const u of toAssign) {
        u.loop = makeGatherWorkflow(resType, deliverTo);
      }
    }

    const idle = nonGatherers.filter(u => pdist(u, { x: u.targetX, y: u.targetY }) < 20);
    if (idle.length === 0) return;

    // Find best target camp
    const uncaptured = this.camps
      .filter(c => c.owner !== 2)
      .sort((a, b) => a.tier - b.tier || pdist2(a, P2_BASE) - pdist2(b, P2_BASE));

    const power = idle.reduce((s, u) => s + u.attack * u.hp, 0);
    let target: { x: number; y: number } | null = null;

    for (const c of uncaptured) {
      if (c.owner === 0) {
        const defenders = this.units.filter(u => u.campId === c.id && u.team === 0 && !u.dead);
        const gp = defenders.reduce((s, u) => s + u.attack * u.hp, 0);
        if (power > gp * 1.5) { target = c; break; }
      } else {
        target = c; break;
      }
    }

    if (!target && idle.length > 20) {
      target = this.nexuses.find(n => n.team === 1)!;
    }

    if (target) this.sendUnitsTo(idle, target.x, target.y);

    // Defend nexus
    const nex = this.nexuses.find(n => n.team === 2)!;
    const threats = this.units.filter(u => u.team === 1 && !u.dead && pdist(u, nex) < 300);
    if (threats.length > 0) {
      const defs = nonGatherers.filter(u => pdist(u, nex) < 600);
      if (defs.length > 0) {
        for (const u of defs) { u.loop = null; } // Cancel gather for defense
        this.sendUnitsTo(defs, nex.x, nex.y);
      }
    }
  }

  // ─── UNIT SPRITES ───────────────────────────────────────────

  private updateUnitSprites() {
    // 4f: Reuse formation groups map instead of allocating new one
    const groups = this._formationGroups;
    for (const arr of groups.values()) arr.length = 0;
    groups.clear();
    for (const u of this.units) {
      if (u.dead) continue;
      const k = `${u.type}_${u.team}`;
      const g = groups.get(k);
      if (g) g.push(u);
      else groups.set(k, [u]);
    }

    // Fix B: off-screen culling — compute camera bounds once
    const cam = this.cameras.main;
    const cullMargin = 150;
    const camL = cam.scrollX - cullMargin;
    const camR = cam.scrollX + cam.width / cam.zoom + cullMargin;
    const camT = cam.scrollY - cullMargin;
    const camB = cam.scrollY + cam.height / cam.zoom + cullMargin;

    for (const u of this.units) {
      if (u.dead) {
        if (u.sprite) {
          this.playDeathEffect(u);
          u.sprite.destroy(); u.sprite = null;
        }
        if (u.equipSprite) { u.equipSprite.destroy(); u.equipSprite = null; }
        if (u.equipDragSprite) { u.equipDragSprite.destroy(); u.equipDragSprite = null; }
        continue;
      }
      // Off-screen culling & fog visibility
      const isOwn = u.team === (this.isDebug ? this.debugControlTeam : this.myTeam);
      const offScreen = u.x < camL || u.x > camR || u.y < camT || u.y > camB;
      if (isOwn) {
        // Own units: ALWAYS visible — never hide them
        if (u.sprite) u.sprite.setVisible(true);
        if (u.carrySprite) u.carrySprite.setVisible(true);
        if (u.equipSprite) u.equipSprite.setVisible(true);
        if (u.equipDragSprite) u.equipDragSprite.setVisible(true);
      } else if (offScreen) {
        if (u.sprite) u.sprite.setVisible(false);
        if (u.carrySprite) u.carrySprite.setVisible(false);
        if (u.equipSprite) u.equipSprite.setVisible(false);
        if (u.equipDragSprite) u.equipDragSprite.setVisible(false);
      } else if (u.sprite) {
        // Non-own on-screen units: respect fog of war
        const fogVisible = this.fogDisabled || this.isInVision(u.x, u.y);
        u.sprite.setVisible(fogVisible);
        if (u.carrySprite) u.carrySprite.setVisible(fogVisible);
        if (u.equipSprite) u.equipSprite.setVisible(fogVisible);
        if (u.equipDragSprite) u.equipDragSprite.setVisible(fogVisible);
      }
      if (!u.sprite) {
        const spriteConf = HORDE_SPRITE_CONFIGS[u.type];
        if (spriteConf) {
          // Create animated sprite at unit's actual position
          u.sprite = this.add.sprite(u.x, u.y, spriteConf.idle.key);
          u.prevSpriteX = u.x;
          u.prevSpriteY = u.y;
          const scale = u.isElite ? spriteConf.displayScale * 1.3 : spriteConf.displayScale;
          u.sprite.setScale(scale);
          u.sprite.setOrigin(0.5, spriteConf.originY);
          const initDepth = 51 + Math.round(u.y * 0.01);
          u.sprite.setDepth(initDepth);
          (u as any)._lastDepth = initDepth;
          // Start with correct animation based on whether unit is already moving
          const initDist = Math.sqrt((u.targetX - u.x) ** 2 + (u.targetY - u.y) ** 2);
          if (initDist > 8) {
            u.sprite.play(`h_${u.type}_walk`);
            u.animState = 'walk';
          } else {
            u.sprite.play(`h_${u.type}_idle`);
            u.animState = 'idle';
          }

          // Team tint: subtle coloring to distinguish teams without overwhelming the sprite
          if (u.isElite) {
            u.sprite.setTint(0xEEDD88);
          } else if (u.team === 0) {
            u.sprite.setTint(0xDDDD99); // soft warm for neutral
          } else if (u.team === 1) {
            u.sprite.setTint(0xAADDAA); // soft green for player
          } else if (u.team === 2) {
            u.sprite.setTint(0xDD9999); // soft red for enemy
          }

          // Return to idle after attack animation completes
          u.sprite.on('animationcomplete', (anim: Phaser.Animations.Animation) => {
            if (anim.key === `h_${u.type}_attack`) {
              u.animState = 'idle';
              if (u.sprite) u.sprite.play(`h_${u.type}_idle`);
            }
          });
        } else {
          // Fallback for unknown types: use emoji text as Sprite placeholder
          const def = ANIMALS[u.type];
          const fallback = this.add.sprite(0, 0, 'particle'); // tiny white dot fallback
          fallback.setDepth(20);
          u.sprite = fallback;
        }
      }

      // Sunflower spiral formation offset based on stable unit ID
      // Tighter for horde units (bunnies), wider for big animals
      const tier = ANIMALS[u.type]?.tier || 1;
      const tierSpacing = tier <= 1 ? 16 : tier <= 2 ? 22 : tier >= 4 ? 28 : 20;
      const maxSpread = tier <= 1 ? 70 : tier <= 2 ? 90 : tier >= 4 ? 100 : 80;
      const a = u.id * GOLDEN_ANGLE;
      const grp = groups.get(`${u.type}_${u.team}`) || [u];
      const idx = grp.indexOf(u);
      const r = Math.min(Math.sqrt(idx) * tierSpacing, maxSpread);
      const dispX = u.x + Math.cos(a) * r;
      const dispY = u.y + Math.sin(a) * r;
      // Smooth sprite position to avoid jitter
      const prev = u.sprite;
      const lerpFactor = 0.3;
      const sx = prev.x + (dispX - prev.x) * lerpFactor;
      const sy = prev.y + (dispY - prev.y) * lerpFactor;
      u.sprite.setPosition(sx, sy);
      // Y-based depth sorting: all units above fog (depth 50)
      const newDepth = 51 + Math.round(sy * 0.01);
      if ((u as any)._lastDepth !== newDepth) {
        u.sprite.setDepth(newDepth);
        (u as any)._lastDepth = newDepth;
      }

      // Animation state: flip based on movement, switch idle/walk
      // Use actual unit-to-target distance (not lerped sprite delta) for reliable walk detection
      const distToTarget = Math.sqrt((u.targetX - u.x) ** 2 + (u.targetY - u.y) ** 2);
      const isMoving = distToTarget > 8;

      // ─── ROGUE HOP: bouncy hop animation while moving ───
      if (u.type === 'rogue' && isMoving) {
        const hopHeight = 8;
        const hopSpeed = 12; // hops per second
        const hopOffset = -Math.abs(Math.sin((this.gameTime / 1000) * hopSpeed * Math.PI + u.id * 1.7)) * hopHeight;
        u.sprite.setPosition(sx, sy + hopOffset);
      }

      // Face direction: face attack target when attacking, otherwise face movement target
      if (u.animState === 'attack' && u.attackFaceX !== null) {
        const atkDx = u.attackFaceX - u.x;
        if (Math.abs(atkDx) > 2) u.sprite.setFlipX(atkDx < 0);
      } else {
        const headingX = u.targetX - u.x;
        if (Math.abs(headingX) > 2) u.sprite.setFlipX(headingX < 0);
      }

      if (u.animState !== 'attack') {
        u.attackFaceX = null;
        if (isMoving && u.animState !== 'walk') {
          u.animState = 'walk';
          u.sprite.play(`h_${u.type}_walk`);
        } else if (!isMoving && u.animState !== 'idle') {
          u.animState = 'idle';
          u.sprite.play(`h_${u.type}_idle`);
        }
      }

      u.prevSpriteX = sx;
      u.prevSpriteY = sy;

      // Carry sprite — trails behind the unit based on movement direction
      if (u.carrying) {
        if (!u.carrySprite) {
          u.carrySprite = this.add.text(sx, sy, RESOURCE_EMOJI[u.carrying], {
            fontSize: '20px',
          }).setOrigin(0.5).setDepth(19);
        }
        // Compute trailing offset: opposite of movement direction
        const dx = u.targetX - u.x, dy = u.targetY - u.y;
        const d = Math.sqrt(dx * dx + dy * dy);
        let trailX = sx, trailY = sy + 14; // default: below unit
        if (d > 5) {
          // Trail behind (opposite of heading)
          trailX = sx - (dx / d) * 18;
          trailY = sy - (dy / d) * 18;
        }
        // Smooth lerp so it feels like it's dragging behind
        const prevCX = u.carrySprite.x, prevCY = u.carrySprite.y;
        u.carrySprite.setPosition(
          prevCX + (trailX - prevCX) * 0.15,
          prevCY + (trailY - prevCY) * 0.15,
        );
      } else if (u.carrySprite) {
        u.carrySprite.destroy(); u.carrySprite = null;
      }

      // ─── Equipment visual modifiers ───
      const spriteConf = HORDE_SPRITE_CONFIGS[u.type];
      const baseScale = spriteConf ? (u.isElite ? spriteConf.displayScale * 1.3 : spriteConf.displayScale) : 1;

      // Clean up visuals if equipment changed
      if (u.equipVisualApplied !== u.equipment) {
        if (u.equipSprite) { u.equipSprite.destroy(); u.equipSprite = null; }
        if (u.equipDragSprite) { u.equipDragSprite.destroy(); u.equipDragSprite = null; }
        // Reset scale (undo shield enlargement)
        if (u.sprite) u.sprite.setScale(baseScale);
        // Reset animation timeScale (undo boots speed)
        if (u.sprite) u.sprite.anims.timeScale = 1;
        u.equipVisualApplied = u.equipment;
      }

      if (u.equipment && u.sprite) {
        switch (u.equipment) {
          case 'shield': {
            // Shield: character 50% bigger
            u.sprite.setScale(baseScale * 1.5);
            break;
          }
          case 'boots': {
            // Boots: run animation plays faster (1.6x-2.2x based on level)
            const bootsSpeed = 1.0 + 0.6 * (EQUIP_LEVEL_STAT_MULT[u.equipLevel] || 1);
            u.sprite.anims.timeScale = bootsSpeed;
            break;
          }
          case 'pickaxe': {
            // Pickaxe: drag a pick emoji behind unit (like carry sprite)
            if (!u.equipDragSprite) {
              u.equipDragSprite = this.add.text(sx, sy, '⛏️', { fontSize: '18px' }).setOrigin(0.5).setDepth(19);
            }
            const pdx = u.targetX - u.x, pdy = u.targetY - u.y;
            const pd = Math.sqrt(pdx * pdx + pdy * pdy);
            let pickTrailX = sx + 14, pickTrailY = sy + 10;
            if (pd > 5) {
              pickTrailX = sx - (pdx / pd) * 20;
              pickTrailY = sy - (pdy / pd) * 20 + 4;
            }
            const ppx = u.equipDragSprite.x, ppy = u.equipDragSprite.y;
            u.equipDragSprite.setPosition(
              ppx + (pickTrailX - ppx) * 0.12,
              ppy + (pickTrailY - ppy) * 0.12,
            );
            break;
          }
          case 'sword': {
            // Attack up: character is shiny (pulsing bright tint)
            const pulse = 0.5 + 0.5 * Math.sin(this.gameTime / 200 + u.id);
            const bright = Math.floor(0xDD + pulse * 0x22);
            const shimmer = (bright << 16) | (bright << 8) | 0xFF;
            u.sprite.setTint(shimmer);
            break;
          }
          case 'banner': {
            // Banner: flag emoji floating above head
            if (!u.equipSprite) {
              u.equipSprite = this.add.text(sx, sy - 30, '🚩', { fontSize: '16px' }).setOrigin(0.5).setDepth(32);
            }
            // Bob gently up and down
            const bob = Math.sin(this.gameTime / 400 + u.id * 2) * 3;
            u.equipSprite.setPosition(sx, sy - 28 + bob);
            break;
          }
        }
      }

      // Clean up drag sprite if no longer has pickaxe
      if (u.equipment !== 'pickaxe' && u.equipDragSprite) {
        u.equipDragSprite.destroy(); u.equipDragSprite = null;
      }
      // Clean up banner sprite if no longer has banner
      if (u.equipment !== 'banner' && u.equipSprite) {
        u.equipSprite.destroy(); u.equipSprite = null;
      }
    }
  }

  private setDebugUnit(u: HUnit | null) {
    // Clean up old debug visuals
    if (this.debugHighlight) { this.debugHighlight.destroy(); this.debugHighlight = null; }
    if (this.debugPanelEl) { this.debugPanelEl.remove(); this.debugPanelEl = null; }
    this.debugUnit = u;
    if (!u) return;
    this.debugHighlight = this.add.circle(0, 0, 20, 0xFFFF00, 0).setStrokeStyle(2, 0xFFFF00, 0.8).setDepth(99);

    // Create HTML overlay panel at top of screen
    const panel = document.createElement('div');
    panel.id = 'horde-debug-panel';
    panel.style.cssText = `
      position:absolute;top:10px;left:50%;transform:translateX(-50%);
      min-width:500px;max-width:700px;z-index:200;
      background:rgba(10,10,10,0.92);border:2px solid #FFD700;border-radius:12px;
      padding:14px 18px;font-family:'Nunito',monospace;color:#fff;
      pointer-events:auto;
    `;
    // Close button
    const closeBtn = document.createElement('button');
    closeBtn.textContent = 'X';
    closeBtn.style.cssText = `
      position:absolute;top:6px;right:10px;
      background:none;border:1px solid #666;border-radius:6px;
      color:#FF6666;font-size:16px;font-weight:800;cursor:pointer;
      padding:2px 8px;line-height:1;
    `;
    closeBtn.addEventListener('click', () => this.setDebugUnit(null));
    panel.appendChild(closeBtn);

    // Content area
    const content = document.createElement('div');
    content.id = 'horde-debug-content';
    panel.appendChild(content);

    document.getElementById('game-container')!.appendChild(panel);
    this.debugPanelEl = panel;
  }

  private updateDebugOverlay() {
    const u = this.debugUnit;
    if (!u || u.dead) { this.setDebugUnit(null); return; }
    if (!this.debugHighlight || !this.debugPanelEl) return;

    // Position highlight on the unit
    this.debugHighlight.setPosition(u.x, u.y);

    const team = u.team === 0 ? 'neutral' : u.team === 1 ? 'P1 (blue)' : 'P2 (red)';
    const teamColor = u.team === 0 ? '#AAA' : u.team === 1 ? '#4499FF' : '#FF5555';
    const def = ANIMALS[u.type];
    const stepInfo = u.loop
      ? 'Step ' + u.loop.currentStep + '/' + u.loop.steps.length + ': ' + JSON.stringify(u.loop.steps[u.loop.currentStep])
      : 'no workflow';
    const loopLabel = u.loop?.label || '-';
    const carry = u.carrying || 'none';
    const claim = u.claimItemId >= 0 ? 'item#' + u.claimItemId : 'none';
    const dist = Math.round(Math.sqrt((u.targetX - u.x) ** 2 + (u.targetY - u.y) ** 2));
    const nonCombat = this.isNonCombatStep(u) ? 'YES' : 'no';
    const hpPct = Math.round((u.hp / u.maxHp) * 100);
    const hpColor = hpPct > 60 ? '#44CC44' : hpPct > 30 ? '#FFD700' : '#FF4444';
    const counters = HARD_COUNTERS[u.type] || [];
    const counterStr = counters.length > 0 ? counters.join(', ') : 'none';
    const mineSpd = def?.mineSpeed || 1.0;
    const allSteps = u.loop ? u.loop.steps.map((s, i) => {
      const marker = i === u.loop!.currentStep ? '>>>' : '   ';
      const loopMarker = (u.loop!.loopFrom > 0 && i === u.loop!.loopFrom) ? ' ↺' : '';
      const dimmed = (u.loop!.loopFrom > 0 && u.loop!.playedOnce && i < u.loop!.loopFrom);
      const prefix = dimmed ? '<span style="opacity:0.4">' : '';
      const suffix = dimmed ? '</span>' : '';
      return prefix + marker + ' [' + i + '] ' + s.action + ('targetAnimal' in s ? ' (' + (s as { targetAnimal?: string }).targetAnimal + ')' : '') + ('resourceType' in s ? ' (' + (s as { resourceType?: string }).resourceType + ')' : '') + ('target' in s ? ' -> ' + (s as { target?: string }).target : '') + loopMarker + suffix;
    }).join('\n') : '';

    const content = this.debugPanelEl.querySelector('#horde-debug-content');
    if (!content) return;
    const dTierColors: Record<number, string> = { 1: '#2E8B2E', 2: '#2266BB', 3: '#CC6A00', 4: '#BB2222', 5: '#B8860B' };
    const dTc = dTierColors[def?.tier || 1] || '#555';
    const gnomeShieldStr = u.type === 'gnome' ? ` | Plucky: ${u.gnomeShield} hits left` : '';
    const rebirthStr = u.type === 'skull' ? ` | Undying: ${u.hasRebirth ? 'ready' : 'spent'}` : '';
    content.innerHTML = `
      <div style="display:flex;gap:14px;margin-bottom:10px;">
        <div style="flex-shrink:0;width:72px;height:72px;background:rgba(255,255,255,0.06);border:3px solid ${dTc};border-radius:12px;display:flex;align-items:center;justify-content:center;overflow:hidden;">
          ${avatarImg(u.type, 90) || `<span style="font-size:40px;">${def?.emoji || '?'}</span>`}
        </div>
        <div style="flex:1;">
          <div style="font-size:22px;font-weight:800;color:#f0e8ff;font-family:'Fredoka',sans-serif;">${u.type.toUpperCase()} <span style="font-size:13px;font-weight:700;color:${dTc};background:rgba(255,255,255,0.1);padding:2px 8px;border-radius:5px;">T${def?.tier || '?'}</span> <span style="font-size:13px;color:${teamColor};">#${u.id} [${team}]</span></div>
          <div style="display:flex;gap:16px;font-size:14px;margin-top:4px;flex-wrap:wrap;">
            <span style="color:${hpColor};font-weight:700;">HP: ${Math.round(u.hp)}/${u.maxHp} (${hpPct}%)</span>
            <span>ATK: ${u.attack}</span>
            <span>SPD: ${u.speed}</span>
            <span>Mine: ${mineSpd}x</span>
          </div>
        </div>
      </div>
      <div style="display:flex;gap:8px;margin-bottom:8px;">
        <div style="flex:1;background:rgba(198,143,255,0.12);border-radius:8px;padding:5px 8px;">
          <div style="font-size:12px;color:#C98FFF;font-weight:700;">${def?.ability || ''}</div>
          <div style="font-size:11px;color:#aaa;">${def?.desc || ''}</div>
        </div>
        <div style="flex:1;background:rgba(96,176,255,0.12);border-radius:8px;padding:5px 8px;">
          <div style="font-size:12px;color:#60B0FF;font-weight:700;">${def?.ability2 || ''}</div>
          <div style="font-size:11px;color:#aaa;">${def?.desc2 || ''}</div>
        </div>
      </div>
      <div style="font-size:12px;color:#FF7777;margin-bottom:4px;">Counters: ${counterStr}${gnomeShieldStr}${rebirthStr}</div>
      <div style="display:flex;gap:16px;font-size:11px;color:#888;margin-bottom:4px;">
        <span>Pos: (${Math.round(u.x)}, ${Math.round(u.y)})</span>
        <span>Target: (${Math.round(u.targetX)}, ${Math.round(u.targetY)}) dist=${dist}</span>
        <span>Anim: ${u.animState}</span>
      </div>
      <div style="display:flex;gap:16px;font-size:11px;color:#888;margin-bottom:4px;">
        <span>Carrying: <span style="color:#FFD93D;">${carry}</span></span>
        <span>Claim: ${claim}</span>
        <span>Idle: ${Math.round(u.idleTimer)}ms</span>
        <span>NonCombat: ${nonCombat}</span>
        <span>Camp: ${u.campId || '-'}</span>
      </div>
      <div style="font-size:13px;color:#ddd;font-weight:700;margin-bottom:2px;">Workflow: ${loopLabel}</div>
      <div style="font-size:11px;color:#AAA;margin-bottom:2px;">${stepInfo}</div>
      ${allSteps ? '<pre style="font-size:10px;color:#777;margin:4px 0 0 0;white-space:pre-wrap;line-height:1.4;">' + allSteps + '</pre>' : ''}
    `;
  }

  private updateMineVisuals() {
    for (const mine of this.mineNodes) {
      if (!mine.sprite) {
        const idx = this.mineNodes.indexOf(mine);
        const baseDepth = 10 + Math.round(mine.y * 0.01);
        // Massive pile of gold stones scattered across the mine area
        const pileOffsets = [
          // Center cluster (big)
          { dx: 0, dy: 0, s: 1.1, v: 1 },
          { dx: -28, dy: -18, s: 0.9, v: 2 },
          { dx: 30, dy: -14, s: 0.95, v: 3 },
          { dx: -22, dy: 20, s: 0.85, v: 4 },
          { dx: 26, dy: 22, s: 0.9, v: 5 },
          // Mid ring
          { dx: -55, dy: -40, s: 0.75, v: 6 },
          { dx: 50, dy: -45, s: 0.8, v: 1 },
          { dx: -60, dy: 10, s: 0.7, v: 3 },
          { dx: 58, dy: 5, s: 0.75, v: 2 },
          { dx: -10, dy: -55, s: 0.7, v: 5 },
          { dx: 15, dy: 50, s: 0.72, v: 4 },
          { dx: -45, dy: 45, s: 0.68, v: 6 },
          { dx: 48, dy: 42, s: 0.7, v: 1 },
          // Outer scatter
          { dx: -85, dy: -30, s: 0.6, v: 2 },
          { dx: 80, dy: -35, s: 0.55, v: 4 },
          { dx: -75, dy: 40, s: 0.58, v: 5 },
          { dx: 82, dy: 38, s: 0.6, v: 3 },
          { dx: -30, dy: -80, s: 0.55, v: 6 },
          { dx: 35, dy: -75, s: 0.5, v: 1 },
          { dx: -35, dy: 75, s: 0.52, v: 2 },
          { dx: 30, dy: 78, s: 0.55, v: 5 },
          // Extra far scatter
          { dx: -100, dy: -60, s: 0.45, v: 3 },
          { dx: 95, dy: -55, s: 0.48, v: 6 },
          { dx: -95, dy: 55, s: 0.42, v: 4 },
          { dx: 100, dy: 60, s: 0.45, v: 1 },
          { dx: 0, dy: -90, s: 0.48, v: 2 },
          { dx: 0, dy: 88, s: 0.45, v: 5 },
          { dx: -110, dy: 0, s: 0.4, v: 3 },
          { dx: 108, dy: 0, s: 0.42, v: 6 },
        ];
        for (const off of pileOffsets) {
          const variant = ((off.v + idx) % 6) + 1;
          this.add.image(mine.x + off.dx, mine.y + off.dy, `ts_gold_stone${variant}`)
            .setScale(off.s).setTint(0x889999).setOrigin(0.5)
            .setDepth(baseDepth + (off.dy > 0 ? 1 : 0));
        }
        // Keep the main sprite reference for fog visibility (just use a central one)
        const mainVariant = ((idx % 6) + 1);
        mine.sprite = this.add.image(mine.x, mine.y, `ts_gold_stone${mainVariant}`)
          .setScale(1.1).setTint(0x889999).setOrigin(0.5).setDepth(baseDepth);
        mine.label = this.add.text(mine.x, mine.y + 90, 'Mine', {
          fontSize: '20px', color: '#FFD700',
          fontFamily: '"Nunito", sans-serif', fontStyle: 'bold',
          stroke: '#000', strokeThickness: 4,
        }).setOrigin(0.5).setDepth(55);
      }
      // Show how many units are mining here (spatial grid lookup)
      const mineNearby = this.getNearbyUnits(mine.x, mine.y, MINE_RANGE);
      let minerCount = 0;
      for (const u of mineNearby) {
        if (!u.dead && u.team !== 0 && u.loop?.steps[u.loop.currentStep]?.action === 'mine') minerCount++;
      }
      if (mine.label) {
        const newText = minerCount > 0 ? `Mine (${minerCount} mining)` : 'Mine';
        if (mine.label.text !== newText) mine.label.setText(newText);
        const zoom = this.cameras.main.zoom;
        const newScale = Math.max(0.8, 1.0 / zoom);
        if (Math.abs(mine.label.scaleX - newScale) > 0.01) mine.label.setScale(newScale);
      }
    }
  }

  private updateCampVisuals() {
    for (const c of this.camps) {
      // Dormant camps (tier not yet unlocked) — dim and show locked label
      if (!this.isCampActive(c) && c.owner === 0) { c.area?.setFillStyle(0x555555, 0.03); c.area?.setStrokeStyle(2, 0x555555, 0.12); if (c.captureBar) c.captureBar.clear(); if (c.label) { const zoom = this.cameras.main.zoom; c.label.setScale(Math.max(0.8, 1.0 / zoom)); const tier = ANIMALS[c.animalType]?.tier || 1; c.label.setText(cap(c.animalType) + ' [T' + tier + ' locked]'); c.label.setColor('#555555'); } continue; }
      const color = c.owner === 0 ? 0xFFD93D : TEAM_COLORS[c.owner as 1 | 2];
      c.area?.setFillStyle(color, 0.08);
      c.area?.setStrokeStyle(2, color, 0.3);

      const bldg = (c as any).buildingSprite as Phaser.GameObjects.Image | undefined;
      if (bldg) {
        if (c.owner === 0) bldg.setTint(0xFFDD88);
        else if (c.owner === this.myTeam) bldg.clearTint();
        else bldg.setTint(0xFF8888);
      }

      // Clean up any existing idle guard sprites (no longer used)
      if (c.idleGuard) {
        c.idleGuard.destroy();
        c.idleGuard = null;
        c.idleGuardOwner = 0;
      }

      const defenders = this.units.filter(u => u.campId === c.id && u.team === 0 && !u.dead);
      const g = c.captureBar;
      if (g) {
        // Dirty check: only redraw capture bar when defender HP changes
        const currentHpSum = defenders.reduce((s, u) => s + Math.max(0, Math.ceil(u.hp)), 0);
        if ((c as any)._prevDefHp !== currentHpSum) {
          (c as any)._prevDefHp = currentHpSum;
          g.clear();
          if (c.owner === 0 && c.guardCount > 0) {
            const totalMaxHp = c.guardCount * (ANIMALS[c.animalType]?.hp ?? 25) * 1.5;
            const pct = Math.max(0, currentHpSum / totalMaxHp);
            const w = 120, h = 10;
            const bx = c.x - w / 2, by = c.y + 45;
            g.fillStyle(0x000000, 0.6);
            g.fillRoundedRect(bx, by, w, h, 3);
            const barColor = pct > 0.5 ? 0xFFD93D : pct > 0.25 ? 0xFF9F43 : 0xFF5555;
            g.fillStyle(barColor, 0.9);
            g.fillRoundedRect(bx, by, w * pct, h, 3);
          }
        }
      }

      // Label — scale inversely with zoom so text stays readable at any zoom level
      if (c.label) {
        const zoom = this.cameras.main.zoom;
        const baseScale = 1.0 / zoom;
        const minScale = 0.8;
        const scale = Math.max(minScale, baseScale);
        if (Math.abs(c.label.scaleX - scale) > 0.01) c.label.setScale(scale);

        // Skip label text for camps not yet discovered (fog will show '???')
        const inVision = this.fogDisabled || c.owner === this.myTeam || this.isInVision(c.x, c.y);
        let newText: string;
        let newColor: string;
        if (!inVision && !c.scouted) {
          newText = '???';
          newColor = '#FFD93D';
        } else {
          const displayName = cap(c.animalType);
          if (c.owner === 0 && defenders.length > 0) {
            newText = displayName;
            newColor = '#FFD93D';
          } else {
            const tag = c.owner === 0 ? ' (cleared!)' : '';
            newText = displayName + tag;
            newColor = c.owner === 0 ? '#45E6B0' : c.owner === 1 ? '#4499FF' : '#FF5555';
          }
        }
        if (c.label.text !== newText) c.label.setText(newText);
        if ((c as any)._prevLabelColor !== newColor) { c.label.setColor(newColor); (c as any)._prevLabelColor = newColor; }
      }

      // Cost label — show below camp name only for captured camps (owner > 0)
      if (c.costLabel) {
        const showCost = c.owner > 0;
        if (c.costLabel.visible !== showCost) c.costLabel.setVisible(showCost);
        if (showCost && c.label) {
          const zoom = this.cameras.main.zoom;
          const scale = Math.max(0.8, 1.0 / zoom);
          if (Math.abs(c.costLabel.scaleX - scale) > 0.01) c.costLabel.setScale(scale);
          c.costLabel.setPosition(c.x, c.label.y + 20 * scale);
          const costColor = c.owner === this.myTeam ? '#88BBFF' : '#FF8888';
          if ((c as any)._prevCostColor !== costColor) {
            c.costLabel.setColor(costColor);
            (c as any)._prevCostColor = costColor;
          }
        }
      }
    }
  }

  // ─── CLEANUP / WIN ──────────────────────────────────────────

  private cleanupDead() {
    // Quick check: skip if no units died this frame
    let hasDead = false;
    for (const u of this.units) { if (u.dead) { hasDead = true; break; } }
    if (!hasDead) return;
    // Destroy sprites for dead units, then compact array in-place
    let write = 0;
    for (let read = 0; read < this.units.length; read++) {
      const u = this.units[read];
      if (u.dead) {
        if (u.sprite) {
          this.playDeathEffect(u);
          u.sprite.destroy(); u.sprite = null;
        }
        if (u.equipSprite) { u.equipSprite.destroy(); u.equipSprite = null; }
        if (u.carrySprite) { u.carrySprite.destroy(); u.carrySprite = null; }
      } else {
        this.units[write++] = u;
      }
    }
    this.units.length = write;
  }

  private playDeathEffect(u: HUnit) {
    const animalDef = ANIMALS[u.type];
    const t = animalDef?.tier || 1;
    const isBig = t >= 3;
    const animKey = isBig ? 'ts_dust02_anim' : 'ts_dust01_anim';
    const texKey = isBig ? 'ts_dust02' : 'ts_dust01';
    const scale = isBig ? 1.8 : 1.2;

    const sx = u.sprite ? u.sprite.x : u.x;
    const sy = u.sprite ? u.sprite.y : u.y;
    const poof = this.add.sprite(sx, sy, texKey).setScale(scale).setDepth(25).setOrigin(0.5);
    poof.play(animKey);
    poof.once('animationcomplete', () => poof.destroy());
  }

  // ─── RESOURCE ECONOMY: GROUND ITEMS ──────────────────────────

  private spawnGroundItem(type: ResourceType, x: number, y: number) {
    if (this.groundItems.filter(i => !i.dead).length >= MAX_GROUND_ITEMS) return;
    x = Math.max(20, Math.min(WORLD_W - 20, x));
    y = Math.max(20, Math.min(WORLD_H - 20, y));
    // Nudge out of barriers so items never spawn inside rocks/water/walls
    if (!this.isTileWalkable(x, y)) {
      const pos = this.findWalkableSpawn(x, y);
      x = pos.x; y = pos.y;
    }
    this.groundItems.push({
      id: this.nextItemId++, type,
      x, y, sprite: null, dead: false, age: 0,
    });
  }

  private updateCarrotSpawning(delta: number) {
    this.carrotSpawnTimer += delta;
    if (this.carrotSpawnTimer < CARROT_SPAWN_MS) return;
    this.carrotSpawnTimer -= CARROT_SPAWN_MS;

    if (this.mapDef && this.mapDef.carrotZones.length > 0) {
      // Map-driven carrot zones: 3 carrots per tick, 1 guaranteed per zone + 1 random
      const zones = this.mapDef.carrotZones;
      for (const zone of zones) {
        const x = zone.x + Math.random() * zone.w;
        const y = zone.y + Math.random() * zone.h;
        this.spawnGroundItem('carrot', x, y);
      }
      // +1 bonus in a random zone
      const bonus = zones[Math.floor(Math.random() * zones.length)];
      this.spawnGroundItem('carrot', bonus.x + Math.random() * bonus.w, bonus.y + Math.random() * bonus.h);
    } else {
      // Default: spawn carrots symmetrically — 1 per side = 2 total per tick
      const MARGIN = 100;
      const cx = WORLD_W / 2, cy = WORLD_H / 2;
      const x = MARGIN + Math.random() * (cx - MARGIN);
      const y = cy + Math.random() * (cy - MARGIN);
      this.spawnGroundItem('carrot', x, y);
      // Mirror to P2's half (top-right)
      this.spawnGroundItem('carrot', WORLD_W - x, WORLD_H - y);
    }
  }

  /** Returns the carrot zone closest to the team's base (their "home" jungle). */
  private getHomeCarrotZone(team: 1 | 2): { x: number; y: number; w: number; h: number } | null {
    const zones = this.mapDef?.carrotZones;
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

  private updateGroundItems(delta: number) {
    for (const item of this.groundItems) {
      if (item.dead) continue;
      item.age += delta;
      if (item.age >= ITEM_DESPAWN_MS) { item.dead = true; continue; }
      if (!item.sprite) {
        if (item.type === 'meat') {
          item.sprite = this.add.image(item.x, item.y, 'ts_meat').setScale(0.9).setDepth(15).setOrigin(0.5);
        } else if (item.type === 'crystal') {
          item.sprite = this.add.image(item.x, item.y, 'ts_gold').setScale(0.65).setDepth(15).setOrigin(0.5).setTint(0xCC88FF);
        } else {
          item.sprite = this.add.text(item.x, item.y, RESOURCE_EMOJI[item.type], { fontSize: '48px' }).setOrigin(0.5).setDepth(15) as any;
        }
        // Gentle bob animation
        this.tweens.add({ targets: item.sprite, y: item.y - 5, duration: 1200, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });
      }
      // Fade near end of life
      const remaining = ITEM_DESPAWN_MS - item.age;
      if (remaining < 10000 && item.sprite) item.sprite.setAlpha(remaining / 10000);
    }
    // 4d: In-place compaction instead of filter() (avoids new array allocation)
    let writeIdx = 0;
    for (let readIdx = 0; readIdx < this.groundItems.length; readIdx++) {
      const i = this.groundItems[readIdx];
      if (i.dead) {
        if (i.sprite) { i.sprite.destroy(); i.sprite = null; }
      } else {
        this.groundItems[writeIdx++] = i;
      }
    }
    this.groundItems.length = writeIdx;
  }

  // ─── RESOURCE ECONOMY: PICKUP & DELIVERY ─────────────────────

  private updateResourcePickup() {
    for (const u of this.units) {
      if (u.dead || u.carrying || u.team === 0) continue;
      // Only pick up items on steps that actively want resources
      if (!u.loop) continue;
      const curStep = u.loop.steps[u.loop.currentStep];
      if (!curStep || (curStep.action !== 'seek_resource' && curStep.action !== 'collect' && curStep.action !== 'hunt')) continue;
      // Gnome Nimble Hands: 2x pickup range — born to gather
      let range = u.type === 'gnome' ? PICKUP_RANGE * 2 : PICKUP_RANGE;
      range *= this.getUnitEquipBuffs(u).pickupRange;
      for (const item of this.groundItems) {
        if (item.dead) continue;
        // Filter by matching resource type
        if (curStep.action === 'seek_resource' && item.type !== curStep.resourceType) continue;
        if (curStep.action === 'collect' && item.type !== curStep.resourceType) continue;
        if (curStep.action === 'hunt') {
          let huntRes: string | null = null;
          for (let i = 1; i < u.loop.steps.length; i++) {
            const next = u.loop.steps[(u.loop.currentStep + i) % u.loop.steps.length];
            if (next.action === 'seek_resource' && next.resourceType) { huntRes = next.resourceType; break; }
          }
          if (!huntRes) huntRes = curStep.targetType === 'minotaur' ? 'crystal' : 'meat';
          if (item.type !== huntRes) continue;
        }
        if (pdist(u, item) < range) {
          u.carrying = item.type;
          u.claimItemId = -1; // release claim
          item.dead = true;
          if (item.sprite) { item.sprite.destroy(); item.sprite = null; }
          const pickupKey = ('pickup_' + item.type) as import('../audio/SoundManager').SfxKey;
          this.sfx.playAt(this.sfx.hasSound(pickupKey) ? pickupKey : 'resource_pickup', u.x, u.y);
          // Picked up a resource — advance workflow past seek/collect step
          if (curStep.action === 'seek_resource' || curStep.action === 'collect') this.advanceWorkflow(u);
          break;
        }
      }
    }
  }

  private updateDeliveries() {
    for (const u of this.units) {
      if (u.dead || !u.carrying || u.team === 0) continue;
      const team = u.team as 1 | 2;
      const base = team === 1 ? P1_BASE : P2_BASE;

      // Turtle carries 10x per trip — slow but massive hauler
      const carryAmount = u.type === 'turtle' ? 10 : 1;

      // Deliver to own base — but NOT if the unit's workflow targets a camp (e.g. withdraw_base → deliver to camp)
      if (pdist(u, base) < DELIVER_RANGE) {
        let wantsBaseDelivery = true;
        if (u.loop) {
          const curStep = u.loop.steps[u.loop.currentStep];
          const deliverStep = u.loop.steps.find(s => s.action === 'deliver');
          // If current step is deliver to a camp, don't deposit at base
          if (curStep?.action === 'deliver' && 'target' in curStep && (curStep as { target: string }).target.includes('_camp')) {
            wantsBaseDelivery = false;
          }
          // If workflow has a deliver-to-camp step and unit just withdrew from base, skip base deposit
          if (deliverStep && deliverStep.action === 'deliver' && (deliverStep as { target: string }).target.includes('_camp')) {
            const hasWithdraw = u.loop.steps.some(s => s.action === 'withdraw_base');
            if (hasWithdraw) wantsBaseDelivery = false;
          }
        }
        if (wantsBaseDelivery) {
          const depositRes = u.carrying;
          this.matchStats.resourcesDelivered[team][u.carrying] += carryAmount;
          this.baseStockpile[team][u.carrying] += carryAmount;
          this.clearCarrying(u);
          const depositKey = ('deposit_' + depositRes) as import('../audio/SoundManager').SfxKey;
          this.sfx.playAt(this.sfx.hasSound(depositKey) ? depositKey : 'resource_deliver', u.x, u.y);
          this.trySpawnFromDelivery(team, 'base');
          continue;
        }
      }

      // Collect workflow only delivers to base, never camps
      if (u.loop) {
        const curStep = u.loop.steps[u.loop.currentStep];
        if (curStep?.action === 'collect') continue;
      }

      // Deliver to owned camp that needs this resource type
      for (const camp of this.camps) {
        if (camp.owner !== team) continue;
        // Only deliver to the camp type matching the workflow target
        if (u.loop) {
          const deliverStep = u.loop.steps.find(s => s.action === 'deliver');
          if (deliverStep && deliverStep.action === 'deliver') {
            const match = deliverStep.target.match(/^nearest_(\w+)_camp$/);
            if (match && camp.animalType !== match[1]) continue;
          }
        }
        if (pdist(u, camp) < DELIVER_RANGE) {
          const cost = SPAWN_COSTS[camp.animalType];
          if (cost && cost.type === u.carrying) {
            const depositRes = u.carrying;
            this.matchStats.resourcesDelivered[team][u.carrying] += carryAmount;
            camp.storedFood += carryAmount;
            this.clearCarrying(u);
            const depositKey = ('deposit_' + depositRes) as import('../audio/SoundManager').SfxKey;
            this.sfx.playAt(this.sfx.hasSound(depositKey) ? depositKey : 'resource_deliver', u.x, u.y);
            this.trySpawnFromDelivery(team, camp.id);
          }
          break;
        }
      }
    }
  }

  private clearCarrying(u: HUnit) {
    u.carrying = null;
    if (u.carrySprite) { u.carrySprite.destroy(); u.carrySprite = null; }
    // Advance workflow to next step after delivery
    if (u.loop) this.advanceWorkflow(u);
  }

  /** Advance to next workflow step, looping back to loopFrom at the end */
  private advanceWorkflow(u: HUnit) {
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

  // ─── WORKFLOW ENGINE ──────────────────────────────────────────
  // Executes LLM-defined multi-step workflows on units each frame.

  private updateWorkflows() {
    const dt = this.game.loop.delta; // ms since last frame

    // Build set of item IDs currently claimed by living units
    const claimedItems = new Set<number>();
    for (const u of this.units) {
      if (!u.dead && u.claimItemId >= 0) {
        // Validate claim: item must still exist and not be dead
        const item = this._groundItemById.get(u.claimItemId);
        if (item && !item.dead) {
          claimedItems.add(u.claimItemId);
        } else {
          u.claimItemId = -1; // item gone, release claim
        }
      }
    }
    const claimCounts = new Map<number, number>();
    for (const u of this.units) {
      if (!u.dead && u.claimItemId >= 0) {
        claimCounts.set(u.claimItemId, (claimCounts.get(u.claimItemId) || 0) + 1);
      }
    }

    for (const u of this.units) {
      if (u.dead || u.team === 0) continue;

      // Units with a loop that are idle for 4s → restart their loop from step 0
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
          if (u.carrying) {
            if (u.carrying !== step.resourceType) {
              // Carrying wrong resource for this step — drop it and keep seeking
              this.spawnGroundItem(u.carrying, u.x, u.y);
              u.carrying = null;
              if (u.carrySprite) { u.carrySprite.destroy(); u.carrySprite = null; }
              // Don't advance — keep seeking the correct resource
            } else {
              u.claimItemId = -1; // release claim on pickup
              this.advanceWorkflow(u);
              break;
            }
          }
          // Invalidate claim if item is gone or no longer visible
          const hadSeekClaim = u.claimItemId >= 0;
          if (u.claimItemId >= 0) {
            const claimed = this._groundItemById.get(u.claimItemId);
            if (!claimed || claimed.dead || (!this.fogDisabled && !this.isInVision(claimed.x, claimed.y))) u.claimItemId = -1;
          }
          // Home zone bias for carrots: prefer items in team's own carrot zone
          const homeZone = this.getHomeCarrotZone(team);
          const inZone = (ix: number, iy: number) =>
            homeZone && ix >= homeZone.x && ix < homeZone.x + homeZone.w
                     && iy >= homeZone.y && iy < homeZone.y + homeZone.h;
          // 2c: Scan nearby items via ground item spatial grid, fall back to full scan
          let bestItem: HGroundItem | null = null, bestItemD = Infinity;
          const seekSearchRadius = 1500;
          let seekNearbyItems: HGroundItem[] = this._groundItemGrid
            ? getNearbyFromGrid(this._groundItemGrid as any, u.x, u.y, seekSearchRadius, this.spatialCellSize) as unknown as HGroundItem[]
            : this.groundItems;
          // Fall back to full array if spatial query found nothing nearby
          if (seekNearbyItems.length === 0 && this._groundItemGrid) {
            seekNearbyItems = this.groundItems;
          }
          for (const item of seekNearbyItems) {
            if (item.dead || item.type !== step.resourceType) continue;
            if (!this.fogDisabled && !this.isInVision(item.x, item.y)) continue;
            // Exclusive: skip items claimed by another unit
            if (claimedItems.has(item.id) && item.id !== u.claimItemId) continue;
            let itemD = pdist(u, item);
            // Penalise carrots outside home zone so units stay in their jungle
            if (step.resourceType === 'carrot' && homeZone && !inZone(item.x, item.y)) {
              itemD *= 2.5;
            }
            if (itemD < bestItemD) { bestItemD = itemD; bestItem = item; }
          }
          if (bestItem) {
            // Always switch to closest unclaimed resource
            if (u.claimItemId >= 0 && u.claimItemId !== bestItem.id) claimedItems.delete(u.claimItemId);
            u.claimItemId = bestItem.id;
            claimedItems.add(bestItem.id);
            u.targetX = bestItem.x; u.targetY = bestItem.y;
          } else if (u.claimItemId >= 0) {
            // Keep pathing to current claim (nothing closer exists)
            const claimed = this._groundItemById.get(u.claimItemId)!;
            u.targetX = claimed.x; u.targetY = claimed.y;
          } else {
            // Nothing visible — pick new explore target immediately if claim was just lost
            // (so units don't walk to a ghost item), otherwise wait until arrival
            const claimJustLost = hadSeekClaim && u.claimItemId < 0;
            if (claimJustLost || pdist(u, { x: u.targetX, y: u.targetY }) < 30) {
              if (step.resourceType === 'carrot') {
                const zone = this.getHomeCarrotZone(team);
                if (zone) {
                  u.targetX = zone.x + Math.random() * zone.w;
                  u.targetY = zone.y + Math.random() * zone.h;
                } else {
                  this.spreadOut(u);
                }
              } else {
                this.spreadOut(u);
              }
            }
          }
          break;
        }

        case 'deliver': {
          if (!u.carrying) {
            // Nothing to deliver — loop back to seek
            this.advanceWorkflow(u);
            break;
          }
          // Check if unit is carrying the WRONG resource for the target camp
          const campMatch = step.target.match(/^nearest_(\w+)_camp$/);
          if (campMatch) {
            const expectedCost = SPAWN_COSTS[campMatch[1]];
            if (expectedCost && expectedCost.type !== u.carrying) {
              // Wrong resource — drop it and loop back to gather the right one
              this.spawnGroundItem(u.carrying, u.x, u.y);
              u.carrying = null;
              if (u.carrySprite) { u.carrySprite.destroy(); u.carrySprite = null; }
              // Go back to the gather step (loopFrom) to pick up the correct resource
              if (u.loop) {
                u.loop.currentStep = u.loop.loopFrom;
                u.pathWaypoints = null;
              }
              break;
            }
          }
          // Resolve delivery target
          const target = this.resolveDeliverTarget(step.target, team);
          if (target) {
            u.targetX = target.x; u.targetY = target.y;
          } else {
            // Target camp lost — drop food and restart workflow
            this.spawnGroundItem(u.carrying, u.x, u.y);
            u.carrying = null;
            if (u.carrySprite) { u.carrySprite.destroy(); u.carrySprite = null; }
            if (u.loop) {
              u.loop.currentStep = u.loop.playedOnce ? u.loop.loopFrom : 0;
            } else {
              u.targetX = base.x; u.targetY = base.y;
            }
          }
          break;
        }

        case 'hunt': {
          // If we picked up a resource from a kill, advance
          if (u.carrying) { this.advanceWorkflow(u); break; }

          // Determine the resource type we're hunting for (look ahead to next seek_resource step)
          const huntResType: ResourceType | null = (() => {
            if (!u.loop) return null;
            for (let i = 1; i < u.loop.steps.length; i++) {
              const next = u.loop.steps[(u.loop.currentStep + i) % u.loop.steps.length];
              if (next.action === 'seek_resource') return (next.resourceType as ResourceType) || null;
            }
            return step.targetType === 'minotaur' ? 'crystal' : 'meat';
          })();

          // Look on the ground first — if matching unclaimed resource exists in vision, go pick it up
          if (huntResType) {
            let nearestRes: HGroundItem | null = null, nearestResD = Infinity;
            for (const i of this.groundItems) {
              if (i.dead || i.type !== huntResType) continue;
              if (!this.fogDisabled && !this.isInVision(i.x, i.y)) continue;
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

          // No resource on ground — hunt the lowest tier wild animal in vision (weakest first)
          // Caution: safe — only hunt prey at or below own tier (not 2+ below, that was too restrictive)
          const myTier = ANIMALS[u.type]?.tier || 1;
          let bestPrey: HUnit | null = null, bestPreyTier = Infinity, bestPreyD = Infinity;
          for (const w of this.units) {
            if (w.team !== 0 || w.dead || w.campId) continue;
            if (!this.fogDisabled && !this.isInVision(w.x, w.y)) continue;
            if (step.targetType && w.type !== step.targetType) continue;
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
            // No prey and no ground resource — spread out to find something
            this.spreadOut(u);
          }
          break;
        }

        case 'attack_camp': {
          // If we already own a camp of this type, skip capture step entirely
          if (step.targetAnimal) {
            const ownedOfType = this.camps.some(c => c.animalType === step.targetAnimal && c.owner === team);
            if (ownedOfType) { this.advanceWorkflow(u); break; }
          }
          // Drop carried food before going to attack a camp
          if (u.carrying) {
            this.spawnGroundItem(u.carrying, u.x, u.y);
            u.carrying = null;
            if (u.carrySprite) { u.carrySprite.destroy(); u.carrySprite = null; }
          }
          // Find target camp
          let targetCamp: HCamp | undefined;
          if (step.campIndex !== undefined && step.campIndex >= 0) {
            targetCamp = this.camps[step.campIndex];
          } else if (step.targetAnimal) {
            const qualifier = step.qualifier || 'nearest';
            const filtered = this.camps.filter(c =>
              c.animalType === step.targetAnimal && c.owner !== team
              && (this.fogDisabled || c.scouted || this.isInVision(c.x, c.y)));
            if (qualifier === 'nearest') filtered.sort((a, b) => pdist2(a, base) - pdist2(b, base));
            targetCamp = filtered[0];
          }
          if (targetCamp) {
            u.targetX = targetCamp.x; u.targetY = targetCamp.y;
            // Formation: tight — wait for group within 120px before engaging
            if (u.mods.formation === 'tight' && targetCamp.owner !== team) {
              const allies = this.units.filter(a => !a.dead && a.team === team && a.type === u.type
                && a.loop?.steps[a.loop.currentStep]?.action === 'attack_camp');
              const nearCamp = allies.filter(a => pdist(a, targetCamp) < 120);
              if (nearCamp.length < allies.length * 0.6) {
                // Wait — don't advance into the camp yet, hold at 130px
                const distToCamp = pdist(u, targetCamp);
                if (distToCamp < 130) {
                  u.targetX = u.x; u.targetY = u.y; // hold position
                }
                break;
              }
            }
            // If captured, advance
            if (targetCamp.owner === team) this.advanceWorkflow(u);
          } else {
            // No target camp found — spread out
            this.spreadOut(u);
          }
          break;
        }

        case 'move': {
          u.targetX = step.x; u.targetY = step.y;
          if (pdist(u, { x: step.x, y: step.y }) < 20) this.advanceWorkflow(u);
          break;
        }

        case 'defend': {
          // Guard a location — go there and stay, fighting anything that comes close
          const guardPos = this.resolveDeliverTarget(step.target, team) || base;
          const distToGuard = pdist(u, guardPos);
          // Caution: safe + defend — retreat TO guard point when hurt (guard point IS the safe spot)
          if (u.mods.caution === 'safe' && u.hp / u.maxHp < 0.4 && distToGuard > 30) {
            u.targetX = guardPos.x; u.targetY = guardPos.y;
            break;
          }
          // Scale defend radii by caution: aggressive = wider patrol+detection, safe = tighter
          const defendDetect = u.mods.caution === 'aggressive' ? 375 : u.mods.caution === 'safe' ? 150 : 250;
          const defendLeash = u.mods.caution === 'aggressive' ? 180 : u.mods.caution === 'safe' ? 80 : 120;
          const defendPatrol = u.mods.caution === 'aggressive' ? 50 + Math.random() * 80 : u.mods.caution === 'safe' ? 15 + Math.random() * 30 : 30 + Math.random() * 60;
          // If far from guard point, go there
          if (distToGuard > defendLeash) {
            u.targetX = guardPos.x; u.targetY = guardPos.y;
          } else {
            // 2b: At guard point — spatial query instead of full unit scan
            let nearestDefEnemy: HUnit | null = null, nearestDefD = Infinity;
            const defendNearby = this.getNearbyUnits(guardPos.x, guardPos.y, defendDetect);
            for (const e of defendNearby) {
              if (e.dead || e.team === 0 || e.team === team) continue;
              const d = pdist2(u, e);
              if (d < nearestDefD) { nearestDefD = d; nearestDefEnemy = e; }
            }
            if (nearestDefEnemy) {
              u.targetX = nearestDefEnemy.x; u.targetY = nearestDefEnemy.y;
            } else {
              // Patrol near guard point
              if (pdist(u, { x: u.targetX, y: u.targetY }) < 12) {
                const a = Math.random() * Math.PI * 2;
                const r = defendPatrol;
                u.targetX = guardPos.x + Math.cos(a) * r;
                u.targetY = guardPos.y + Math.sin(a) * r;
              }
            }
          }
          // Defend loops never advance — they stay forever
          break;
        }

        case 'attack_enemies': {
          // 2b: Seek nearest enemy via spatial query instead of full unit scan
          const enemyTeam = team === 1 ? 2 : 1;
          let nearestEnemy: HUnit | null = null, nearestEnemyD = Infinity;
          const attackSearchRadius = 800; // search radius for enemy units
          const attackNearby = this.getNearbyUnits(u.x, u.y, attackSearchRadius);
          for (const e of attackNearby) {
            if (e.dead || e.team !== enemyTeam) continue;
            const d = pdist2(u, e);
            if (d < nearestEnemyD) { nearestEnemyD = d; nearestEnemy = e; }
          }
          if (nearestEnemy) {
            u.targetX = nearestEnemy.x; u.targetY = nearestEnemy.y;
          } else {
            // No enemies — push toward enemy base
            const enemyBase = team === 1 ? P2_BASE : P1_BASE;
            u.targetX = enemyBase.x; u.targetY = enemyBase.y;
          }
          // Attack_enemies loops never advance — continuous hunting
          break;
        }

        case 'scout': {
          // Explore the map — visit camps to reveal them, avoid enemies
          const scoutRegionX = step.x;
          const scoutRegionY = step.y;
          const hasRegion = scoutRegionX !== undefined && scoutRegionY !== undefined;
          // Multi-step scouts: if there are multiple scout steps, advance after ~5s of wandering in region
          const isMultiScout = hasRegion && u.loop!.steps.filter(s => s.action === 'scout').length > 1;

          if (pdist(u, { x: u.targetX, y: u.targetY }) < 30) {
            if (hasRegion) {
              // Track wander visits; after 3 arrivals in a region, advance to next scout step
              u.idleTimer += 1;
              if (isMultiScout && u.idleTimer >= 3) {
                u.idleTimer = 0;
                this.advanceWorkflow(u);
                break;
              }
              // Wander within ~600px of the target region
              const spread = 600;
              u.targetX = Math.max(50, Math.min(WORLD_W - 50, scoutRegionX + (Math.random() - 0.5) * spread * 2));
              u.targetY = Math.max(50, Math.min(WORLD_H - 50, scoutRegionY + (Math.random() - 0.5) * spread * 2));
            } else {
              // Default: pick a random far camp or wander
              const scoutTarget = this.camps
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
          // Pick up ground resources while avoiding enemies — safe gathering
          if (u.carrying) {
            // Deliver to base
            u.targetX = base.x; u.targetY = base.y;
            break;
          }
          // Check if current claim is still valid and visible
          if (u.claimItemId >= 0) {
            const claimed = this._groundItemById.get(u.claimItemId);
            if (claimed && !claimed.dead && (this.fogDisabled || this.isInVision(claimed.x, claimed.y))) {
              u.targetX = claimed.x; u.targetY = claimed.y;
              break;
            }
            u.claimItemId = -1;
          }
          // Scale avoidance by caution: aggressive ignores enemies, safe is extra cautious
          const collectProxAvoid = u.mods.caution === 'aggressive' ? 0 : u.mods.caution === 'safe' ? 300 : 200;
          const collectPathAvoid = u.mods.caution === 'aggressive' ? 0 : u.mods.caution === 'safe' ? 220 : 150;
          // 2c: Find nearest unclaimed resource via ground item spatial grid
          const collectRes = step.resourceType;
          let bestItem: HGroundItem | null = null, bestItemD = Infinity;
          const collectSearchRadius = 1500;
          let nearbyItems: HGroundItem[] = this._groundItemGrid
            ? getNearbyFromGrid(this._groundItemGrid as any, u.x, u.y, collectSearchRadius, this.spatialCellSize) as unknown as HGroundItem[]
            : this.groundItems;
          // Fall back to full array if spatial query found nothing nearby
          if (nearbyItems.length === 0 && this._groundItemGrid) {
            nearbyItems = this.groundItems;
          }
          for (const item of nearbyItems) {
            if (item.dead || item.type !== collectRes) continue;
            if (!this.fogDisabled && !this.isInVision(item.x, item.y)) continue;
            if (claimedItems.has(item.id)) continue;
            // Skip items near enemy units (unless aggressive)
            if (collectProxAvoid > 0) {
              const enemyNearItem = this.getNearbyUnits(item.x, item.y, collectProxAvoid).some(e =>
                e.team !== 0 && e.team !== team);
              if (enemyNearItem) continue;
            }
            // Skip items if enemy is between us and the item (unless aggressive)
            if (collectPathAvoid > 0) {
              // 2b: Use spatial query instead of full unit scan for path blocking check
              const midX = (u.x + item.x) / 2, midY = (u.y + item.y) / 2;
              const pathCheckRadius = Math.max(collectPathAvoid, pdist(u, item) / 2 + collectPathAvoid);
              const pathCheckNearby = this.getNearbyUnits(midX, midY, pathCheckRadius);
              const pathBlocked = pathCheckNearby.some(e => {
                if (e.dead || e.team === 0 || e.team === team) return false;
                const px = item.x - u.x, py = item.y - u.y;
                const pLen = Math.sqrt(px * px + py * py);
                if (pLen < 1) return false;
                const ex = e.x - u.x, ey = e.y - u.y;
                const t = (ex * px + ey * py) / (pLen * pLen);
                if (t < 0 || t > 1) return false;
                const closestX = u.x + t * px, closestY = u.y + t * py;
                const distToPath = Math.sqrt((e.x - closestX) ** 2 + (e.y - closestY) ** 2);
                return distToPath < collectPathAvoid;
              });
              if (pathBlocked) continue;
            }
            const itemD = pdist(u, item);
            if (itemD < bestItemD) { bestItemD = itemD; bestItem = item; }
          }
          if (bestItem) {
            u.claimItemId = bestItem.id;
            claimedItems.add(bestItem.id);
            u.targetX = bestItem.x; u.targetY = bestItem.y;
          } else {
            // Nothing safe — wait near base
            if (pdist(u, base) > 200) { u.targetX = base.x; u.targetY = base.y; }
          }
          // Collect never auto-advances — pickup handler advances it
          break;
        }

        case 'kill_only': {
          // Hunt and kill visible wild animals but do NOT pick up drops
          const myKillTier = ANIMALS[u.type]?.tier || 1;
          let bestKill: HUnit | null = null, bestKillD = Infinity;
          for (const w of this.units) {
            if (w.team !== 0 || w.dead || w.campId) continue;
            if (!this.fogDisabled && !this.isInVision(w.x, w.y)) continue;
            if (step.targetType && w.type !== step.targetType) continue;
            if (u.mods.caution === 'safe' && (ANIMALS[w.type]?.tier || 1) > myKillTier) continue;
            const d = pdist2(u, w);
            if (d < bestKillD) { bestKillD = d; bestKill = w; }
          }
          if (bestKill) {
            u.targetX = bestKill.x; u.targetY = bestKill.y;
          }
          // Kill_only never advances — loops forever
          break;
        }

        case 'mine': {
          // If carrying metal, advance to next step (probably deliver)
          if (u.carrying) { this.advanceWorkflow(u); break; }
          // Requires pickaxe equipment
          if (u.equipment !== 'pickaxe') { this.advanceWorkflow(u); break; }
          // Find nearest visible mine node
          let nearestMine: HMineNode | null = null, nearestMineD = Infinity;
          for (const m of this.mineNodes) {
            if (!this.fogDisabled && !this.isInVision(m.x, m.y)) continue;
            const d = pdist2(u, m);
            if (d < nearestMineD) { nearestMineD = d; nearestMine = m; }
          }
          if (nearestMine) {
            u.targetX = nearestMine.x; u.targetY = nearestMine.y;
            // If at the mine, extract metal
            if (pdist(u, nearestMine) < MINE_RANGE) {
              // Mine tick — produce metal periodically, scaled by unit's mineSpeed
              // Use idleTimer as mining timer (repurposed when at mine)
              const mineSpeedMul = ANIMALS[u.type]?.mineSpeed || 1.0;
              const tickMs = MINE_TICK_MS / mineSpeedMul;
              u.idleTimer += this.game.loop.delta;
              if (u.idleTimer >= tickMs) {
                u.idleTimer -= tickMs;
                u.carrying = 'metal';
                this.sfx.playAt('mining_hit', u.x, u.y);
                // carrySprite will be created by the rendering code
              }
            }
          } else {
            this.spreadOut(u);
          }
          break;
        }

        case 'equip': {
          const eqType = step.equipmentType;
          const teamEqLevel = this.getEquipLevel(team, eqType!);
          // Skip if not unlocked, or already equipped at current team level
          if (!eqType || (u.equipment === eqType && u.equipLevel >= teamEqLevel)) { this.advanceWorkflow(u); break; }
          if (!this.unlockedEquipment[team].has(eqType)) { this.advanceWorkflow(u); break; }
          const armory = this.armories.find(a => a.team === team && a.equipmentType === eqType);
          if (!armory) { this.advanceWorkflow(u); break; }
          u.targetX = armory.x; u.targetY = armory.y;
          if (pdist(u, armory) < ARMORY_RANGE) {
            // Remove old shield HP bonus using old level
            if (u.equipment === 'shield' && u.equipLevel > 0) {
              const oldLm = EQUIP_LEVEL_STAT_MULT[u.equipLevel] || 1;
              const bonus = Math.round(u.maxHp * (0.60 * oldLm / (1 + 0.60 * oldLm)));
              u.maxHp -= bonus; u.hp = Math.min(u.hp, u.maxHp);
            }
            // Clear old visuals
            if (u.equipSprite) { u.equipSprite.destroy(); u.equipSprite = null; }
            if (u.equipDragSprite) { u.equipDragSprite.destroy(); u.equipDragSprite = null; }
            u.equipVisualApplied = null;
            u.equipment = eqType;
            u.equipLevel = teamEqLevel;
            // Apply new shield HP bonus with new level
            if (eqType === 'shield') {
              const lm = EQUIP_LEVEL_STAT_MULT[u.equipLevel] || 1;
              const bonus = u.maxHp * 0.60 * lm;
              u.maxHp += bonus; u.hp += bonus;
            }
            this.advanceWorkflow(u);
          }
          break;
        }

        case 'contest_event': {
          // Find nearest active map event in vision
          let nearestEv: MapEvent | null = null, nearestEvD = Infinity;
          for (const e of this.mapEvents) {
            if (e.state !== 'active') continue;
            const d = pdist2(u, e);
            if (d < nearestEvD) { nearestEvD = d; nearestEv = e; }
          }
          if (!nearestEv) { this.advanceWorkflow(u); break; }
          u.targetX = nearestEv.x; u.targetY = nearestEv.y;
          // Advance when event resolves (unit stays near event while it's active — tick handles interaction)
          if (nearestEv.state !== 'active') {
            this.advanceWorkflow(u);
          }
          break;
        }

        case 'withdraw_base': {
          // Take a resource from the base stockpile
          if (u.carrying) {
            // Already carrying — skip to next step
            this.advanceWorkflow(u);
            break;
          }
          const wbStock = this.baseStockpile[team];
          const wbRes = step.resourceType;
          // Walk to base first
          u.targetX = base.x; u.targetY = base.y;
          if (pdist(u, base) < DELIVER_RANGE) {
            if (wbStock[wbRes] > 0) {
              wbStock[wbRes] -= 1;
              u.carrying = wbRes;
              this.sfx.playAt('resource_pickup', u.x, u.y);
              this.advanceWorkflow(u);
            } else {
              // Nothing in stockpile — idle briefly then retry
              u.idleTimer += this.game.loop.delta;
              if (u.idleTimer > 2000) {
                u.idleTimer = 0;
                // Try to find ground resources instead
                this.advanceWorkflow(u);
              }
            }
          }
          break;
        }
      }
    }
  }

  /** Resolve a deliver target string to coordinates */
  private resolveDeliverTarget(target: string, team: 1 | 2): { x: number; y: number } | null {
    if (target === 'base') {
      return team === 1 ? P1_BASE : P2_BASE;
    }
    // "nearest_TYPE_camp" pattern — e.g. "nearest_gnome_camp"
    const nearestMatch = target.match(/^nearest_(\w+)_camp$/);
    if (nearestMatch) {
      const animalType = nearestMatch[1];
      const base = team === 1 ? P1_BASE : P2_BASE;
      let camp: HCamp | null = null, campD = Infinity;
      for (const c of this.camps) {
        if (c.owner !== team || c.animalType !== animalType) continue;
        const d = pdist2(c, base);
        if (d < campD) { campD = d; camp = c; }
      }
      return camp;
    }
    // Direct camp ID
    const camp = this.camps.find(c => c.id === target && c.owner === team);
    return camp || null;
  }

  // ─── RESOURCE ECONOMY: WILD ANIMALS ──────────────────────────

  /** Spawn position on the outskirts — heavily biased toward corners, away from bases */
  private randomOutskirtsPos(): { x: number; y: number } {
    const safeR = this.mapDef?.safeRadius ?? 500;

    // Map-driven wild zones: pick random position within a random wild zone
    if (this.mapDef && this.mapDef.wildZones.length > 0) {
      const exclusions = this.mapDef.wildExclusions || [];
      for (let attempt = 0; attempt < 50; attempt++) {
        const zone = this.mapDef.wildZones[Math.floor(Math.random() * this.mapDef.wildZones.length)];
        const x = zone.x + Math.random() * zone.w;
        const y = zone.y + Math.random() * zone.h;
        // Check exclusions (bases, lakes, etc.)
        let excluded = false;
        for (const ex of exclusions) {
          if (pdist({ x, y }, { x: ex.x, y: ex.y }) < ex.radius) { excluded = true; break; }
        }
        if (!excluded && pdist({ x, y }, P1_BASE) > safeR && pdist({ x, y }, P2_BASE) > safeR) {
          return { x: Math.max(50, Math.min(WORLD_W - 50, x)), y: Math.max(50, Math.min(WORLD_H - 50, y)) };
        }
      }
      return { x: WORLD_W / 2, y: 200 }; // fallback
    }

    // Default behavior: corner-biased outskirts spawning
    const MARGIN = 120;
    const CORNER_SIZE = 800;
    const corners = [
      { x: MARGIN, y: MARGIN },
      { x: WORLD_W - MARGIN, y: MARGIN },
      { x: MARGIN, y: WORLD_H - MARGIN },
      { x: WORLD_W - MARGIN, y: WORLD_H - MARGIN },
    ];
    for (let attempt = 0; attempt < 50; attempt++) {
      let x: number, y: number;
      if (Math.random() < 0.8) {
        const c = corners[Math.floor(Math.random() * corners.length)];
        x = c.x + (Math.random() - 0.5) * CORNER_SIZE;
        y = c.y + (Math.random() - 0.5) * CORNER_SIZE;
      } else {
        const edge = Math.floor(Math.random() * 4);
        if (edge === 0) { x = MARGIN + Math.random() * (WORLD_W - MARGIN * 2); y = MARGIN + Math.random() * 400; }
        else if (edge === 1) { x = MARGIN + Math.random() * (WORLD_W - MARGIN * 2); y = WORLD_H - MARGIN - Math.random() * 400; }
        else if (edge === 2) { x = MARGIN + Math.random() * 400; y = MARGIN + Math.random() * (WORLD_H - MARGIN * 2); }
        else { x = WORLD_W - MARGIN - Math.random() * 400; y = MARGIN + Math.random() * (WORLD_H - MARGIN * 2); }
      }
      x = Math.max(MARGIN, Math.min(WORLD_W - MARGIN, x));
      y = Math.max(MARGIN, Math.min(WORLD_H - MARGIN, y));
      if (pdist({ x, y }, P1_BASE) > safeR && pdist({ x, y }, P2_BASE) > safeR) return { x, y };
    }
    return { x: WORLD_W / 2, y: MARGIN + 100 }; // fallback
  }

  private spawnWildAnimals() {
    // Higher-tier enemies on outskirts — no gnomes/turtles (those are gatherers)
    const wildTypes = ['skull', 'spider', 'hyena', 'panda', 'lizard'];
    for (let i = 0; i < WILD_ANIMAL_COUNT; i++) {
      const type = wildTypes[Math.floor(Math.random() * wildTypes.length)];
      const def = ANIMALS[type];
      const rawPos = this.randomOutskirtsPos();
      const pos = this.findWalkableSpawn(rawPos.x, rawPos.y);
      const { x, y } = pos;
      this.units.push({
        id: this.nextId++, type, team: 0,
        hp: def.hp, maxHp: def.hp, attack: def.attack, speed: def.speed * 0.4,
        x, y, targetX: x + Math.random() * 100 - 50, targetY: y + Math.random() * 100 - 50,
        attackTimer: 0, sprite: null, dead: false, animState: 'idle' as const, prevSpriteX: 0, prevSpriteY: 0,
        campId: null, lungeX: 0, lungeY: 0,
        gnomeShield: 0, hasRebirth: false, diveReady: false, diveTimer: 0, lastAttackTarget: -1, attackFaceX: null, pathWaypoints: null, pathAge: 0, pathTargetX: 0, pathTargetY: 0, lastCheckX: 0, lastCheckY: 0, stuckFrames: 0, stuckCooldown: 0, mods: { ...DEFAULT_MODS },
        carrying: null, carrySprite: null, loop: null, isElite: false, idleTimer: 0, claimItemId: -1,
        equipment: null, equipLevel: 0, equipSprite: null, equipDragSprite: null, equipVisualApplied: null,
      });
    }
    // Elite golden prey — very strong, drops crystals
    for (let i = 0; i < ELITE_PREY_COUNT; i++) {
      const rawElite = this.randomOutskirtsPos();
      const elitePos = this.findWalkableSpawn(rawElite.x, rawElite.y);
      const { x, y } = elitePos;
      this.units.push({
        id: this.nextId++, type: 'minotaur', team: 0,
        hp: 2000, maxHp: 2000, attack: 150, speed: 90,
        x, y, targetX: x + Math.random() * 80 - 40, targetY: y + Math.random() * 80 - 40,
        attackTimer: 0, sprite: null, dead: false, animState: 'idle' as const, prevSpriteX: 0, prevSpriteY: 0,
        campId: null, lungeX: 0, lungeY: 0,
        gnomeShield: 0, hasRebirth: false, diveReady: false, diveTimer: 0, lastAttackTarget: -1, attackFaceX: null, pathWaypoints: null, pathAge: 0, pathTargetX: 0, pathTargetY: 0, lastCheckX: 0, lastCheckY: 0, stuckFrames: 0, stuckCooldown: 0, mods: { ...DEFAULT_MODS },
        carrying: null, carrySprite: null, loop: null, isElite: true, idleTimer: 0, claimItemId: -1,
        equipment: null, equipLevel: 0, equipSprite: null, equipDragSprite: null, equipVisualApplied: null,
      });
    }
  }

  private updateWildAnimals(delta: number) {
    if (this.currentEra < 2) return; // No wild animals before Era 2
    if (this.isDebug && !this.debugNeutralsEnabled) return;
    this.wildRespawnTimer += delta;
    if (this.wildRespawnTimer >= WILD_RESPAWN_MS) {
      this.wildRespawnTimer -= WILD_RESPAWN_MS;
      const wilds = this.units.filter(u => u.team === 0 && !u.campId && !u.dead && !u.isElite);
      const elites = this.units.filter(u => u.team === 0 && !u.campId && !u.dead && u.isElite);
      if (wilds.length < WILD_ANIMAL_COUNT) {
        const wt = ['skull', 'spider', 'hyena', 'panda', 'lizard'];
        const type = wt[Math.floor(Math.random() * wt.length)];
        const def = ANIMALS[type];
        const pos = this.randomOutskirtsPos();
        const { x, y } = pos;
        this.units.push({
          id: this.nextId++, type, team: 0,
          hp: def.hp, maxHp: def.hp, attack: def.attack, speed: def.speed * 0.4,
          x, y, targetX: x + Math.random() * 80 - 40, targetY: y + Math.random() * 80 - 40,
          attackTimer: 0, sprite: null, dead: false, animState: 'idle' as const, prevSpriteX: 0, prevSpriteY: 0,
          campId: null, lungeX: 0, lungeY: 0,
          gnomeShield: 0, hasRebirth: false, diveReady: false, diveTimer: 0, lastAttackTarget: -1, attackFaceX: null, pathWaypoints: null, pathAge: 0, pathTargetX: 0, pathTargetY: 0, lastCheckX: 0, lastCheckY: 0, stuckFrames: 0, stuckCooldown: 0, mods: { ...DEFAULT_MODS },
          carrying: null, carrySprite: null, loop: null, isElite: false, idleTimer: 0, claimItemId: -1,
          equipment: null, equipLevel: 0, equipSprite: null, equipDragSprite: null, equipVisualApplied: null,
        });
      }
      if (this.currentEra >= 4 && elites.length < ELITE_PREY_COUNT) {
        const rawE = this.randomOutskirtsPos();
        const ePos = this.findWalkableSpawn(rawE.x, rawE.y);
        const { x, y } = ePos;
        this.units.push({
          id: this.nextId++, type: 'minotaur', team: 0,
          hp: 2000, maxHp: 2000, attack: 150, speed: 90,
          x, y, targetX: x + Math.random() * 80 - 40, targetY: y + Math.random() * 80 - 40,
          attackTimer: 0, sprite: null, dead: false, animState: 'idle' as const, prevSpriteX: 0, prevSpriteY: 0,
          campId: null, lungeX: 0, lungeY: 0,
          gnomeShield: 0, hasRebirth: false, diveReady: false, diveTimer: 0, lastAttackTarget: -1, attackFaceX: null, pathWaypoints: null, pathAge: 0, pathTargetX: 0, pathTargetY: 0, lastCheckX: 0, lastCheckY: 0, stuckFrames: 0, stuckCooldown: 0, mods: { ...DEFAULT_MODS },
          carrying: null, carrySprite: null, loop: null, isElite: true, idleTimer: 0, claimItemId: -1,
          equipment: null, equipLevel: 0, equipSprite: null, equipDragSprite: null, equipVisualApplied: null,
        });
      }
    }
    // Wander wild animals — keep inside wild zones (if defined), away from player bases
    const BASE_AVOID = this.mapDef?.safeRadius ? this.mapDef.safeRadius + 100 : 600;
    const hasWildZones = this.mapDef && this.mapDef.wildZones.length > 0;
    const wildZones = this.mapDef?.wildZones || [];
    const exclusions = this.mapDef?.wildExclusions || [];

    const isInWildZone = (px: number, py: number): boolean => {
      if (!hasWildZones) return true; // no zones defined = everywhere is valid
      for (const z of wildZones) {
        if (px >= z.x && px <= z.x + z.w && py >= z.y && py <= z.y + z.h) {
          let excluded = false;
          for (const ex of exclusions) {
            if (pdist({ x: px, y: py }, { x: ex.x, y: ex.y }) < ex.radius) { excluded = true; break; }
          }
          if (!excluded) return true;
        }
      }
      return false;
    };

    // Helper: compute distance from a point to the nearest wild zone edge
    const distToNearestZoneEdge = (px: number, py: number): number => {
      let minDist = Infinity;
      for (const z of wildZones) {
        // Clamp point to zone rect, then measure distance
        const cx = Math.max(z.x, Math.min(z.x + z.w, px));
        const cy = Math.max(z.y, Math.min(z.y + z.h, py));
        const d = Math.sqrt((px - cx) ** 2 + (py - cy) ** 2);
        if (d < minDist) minDist = d;
      }
      return minDist;
    };

    for (const u of this.units) {
      if (u.team !== 0 || u.campId || u.dead) continue;

      // Phase 3B: Zone boundary enforcement — severe drift (>200px from any zone) teleports immediately
      if (hasWildZones && !isInWildZone(u.x, u.y) && distToNearestZoneEdge(u.x, u.y) > 200) {
        const pos = this.randomOutskirtsPos();
        u.x = pos.x; u.y = pos.y;
        u.targetX = pos.x; u.targetY = pos.y;
        continue;
      }

      // Push wilds back into wild zones if they've drifted out
      if (hasWildZones && !isInWildZone(u.x, u.y)) {
        const pos = this.randomOutskirtsPos();
        u.targetX = pos.x; u.targetY = pos.y;
        continue;
      }

      // Push wilds away from bases
      const d1 = pdist(u, P1_BASE), d2 = pdist(u, P2_BASE);
      if (d1 < BASE_AVOID || d2 < BASE_AVOID) {
        const pos = this.randomOutskirtsPos();
        u.targetX = pos.x; u.targetY = pos.y;
        continue;
      }

      // Every 10s or when arrived, pick a new wander target in the opposite direction
      u.idleTimer += delta;
      const arrived = pdist(u, { x: u.targetX, y: u.targetY }) < 15;
      if (arrived || u.idleTimer >= 10000) {
        u.idleTimer = 0;
        // Reverse: go opposite to current heading
        const dx = u.x - u.targetX, dy = u.y - u.targetY;
        const baseAngle = Math.atan2(dy, dx); // opposite direction
        const spread = 0.4; // slight randomness
        let nx = 0, ny = 0, found = false;
        for (let attempt = 0; attempt < 5; attempt++) {
          const a = baseAngle + (Math.random() - 0.5) * spread;
          const r = 120 + Math.random() * 200;
          nx = u.x + Math.cos(a) * r;
          ny = u.y + Math.sin(a) * r;
          nx = Math.max(100, Math.min(WORLD_W - 100, nx));
          ny = Math.max(100, Math.min(WORLD_H - 100, ny));

          if (isInWildZone(nx, ny)
              && pdist({ x: nx, y: ny }, P1_BASE) >= BASE_AVOID
              && pdist({ x: nx, y: ny }, P2_BASE) >= BASE_AVOID) {
            found = true;
            break;
          }
        }
        if (!found) {
          const pos = this.randomOutskirtsPos();
          nx = pos.x; ny = pos.y;
        }
        u.targetX = nx; u.targetY = ny;
      }
    }
  }

  private checkWin() {
    for (const n of this.nexuses) {
      if (n.hp <= 0) {
        this.gameOver = true;
        this.winner = n.team === 1 ? 2 : 1;
        this.cameras.main.shake(500, 0.02);
        this.sfx.playAt('nexus_destroyed', n.x, n.y);
        this.sfx.playGlobal(this.winner === this.myTeam ? 'victory' : 'defeat');
        this.profilingRecorder?.finalize();
        this.showGameOver();
        return;
      }
    }
  }

  private showGameOver() {
    const cam = this.cameras.main;
    const win = this.winner === this.myTeam;
    const myT = this.myTeam;
    const enemyT: 1 | 2 = myT === 1 ? 2 : 1;
    const cx = cam.width / 2;
    const s = Math.floor(this.gameTime / 1000);
    const timeStr = `${Math.floor(s / 60)}:${(s % 60).toString().padStart(2, '0')}`;
    const stats = this.matchStats;

    // Phase 1: Dark overlay + VICTORY/DEFEAT
    const overlay = this.add.rectangle(cx, cam.height / 2, cam.width, cam.height, 0x000000, 0)
      .setScrollFactor(0).setDepth(200);
    this.tweens.add({ targets: overlay, fillAlpha: 0.8, duration: 800 });

    const titleText = this.add.text(cx, 80, win ? 'VICTORY!' : 'DEFEAT', {
      fontSize: '52px', color: win ? '#45E6B0' : '#FF6B6B',
      fontFamily: '"Fredoka", sans-serif', fontStyle: 'bold',
    }).setOrigin(0.5).setScrollFactor(0).setDepth(201).setAlpha(0);

    const timeText = this.add.text(cx, 125, `Time: ${timeStr}`, {
      fontSize: '16px', color: '#cbb8ee', fontFamily: '"Nunito", sans-serif', fontStyle: 'bold',
    }).setOrigin(0.5).setScrollFactor(0).setDepth(201).setAlpha(0);

    this.tweens.add({ targets: titleText, alpha: 1, scaleX: { from: 0.5, to: 1 }, scaleY: { from: 0.5, to: 1 }, duration: 600, ease: 'Back.easeOut', delay: 400 });
    this.tweens.add({ targets: timeText, alpha: 1, duration: 400, delay: 800 });

    // Phase 2: Stat cards (delay 1500ms)
    const headerStyle = { fontSize: '13px', color: '#FFD93D', fontFamily: '"Fredoka", sans-serif', fontStyle: 'bold' };
    const labelStyle = { fontSize: '12px', color: '#a89bba', fontFamily: '"Nunito", sans-serif' };
    const valueMyStyle = { fontSize: '14px', color: '#45E6B0', fontFamily: '"Nunito", sans-serif', fontStyle: 'bold' };
    const valueEnStyle = { fontSize: '14px', color: '#FF6B6B', fontFamily: '"Nunito", sans-serif', fontStyle: 'bold' };

    const leftCol = cx - 120;
    const rightCol = cx + 120;
    const labelCol = cx;
    let row = 160;
    const rowH = 22;
    const phase2Objects: Phaser.GameObjects.Text[] = [];

    const addHeader = (y: number, text: string) => {
      phase2Objects.push(this.add.text(labelCol, y, text, headerStyle).setOrigin(0.5).setScrollFactor(0).setDepth(201).setAlpha(0));
    };

    const addStatRow = (y: number, label: string, myVal: string | number, enVal: string | number) => {
      phase2Objects.push(this.add.text(leftCol, y, String(myVal), valueMyStyle).setOrigin(0.5).setScrollFactor(0).setDepth(201).setAlpha(0));
      phase2Objects.push(this.add.text(labelCol, y, label, labelStyle).setOrigin(0.5).setScrollFactor(0).setDepth(201).setAlpha(0));
      phase2Objects.push(this.add.text(rightCol, y, String(enVal), valueEnStyle).setOrigin(0.5).setScrollFactor(0).setDepth(201).setAlpha(0));
    };

    // Column headers
    addStatRow(row, '', 'Your Team', 'Enemy'); row += rowH + 4;

    // Units section
    addHeader(row, '--- UNITS ---'); row += rowH;
    addStatRow(row, 'Spawned', stats.unitsSpawned[myT], stats.unitsSpawned[enemyT]); row += rowH;
    addStatRow(row, 'Lost', stats.unitsLost[myT], stats.unitsLost[enemyT]); row += rowH;
    addStatRow(row, 'Peak Army', stats.peakArmySize[myT], stats.peakArmySize[enemyT]); row += rowH + 4;

    // Combat section
    addHeader(row, '--- COMBAT ---'); row += rowH;
    addStatRow(row, 'Kills', stats.totalKills[myT], stats.totalKills[enemyT]); row += rowH;
    const fmtDmg = (d: number) => d >= 1000 ? `${(d / 1000).toFixed(1)}k` : String(d);
    addStatRow(row, 'Damage', fmtDmg(stats.totalDamage[myT]), fmtDmg(stats.totalDamage[enemyT])); row += rowH;
    addStatRow(row, 'Camps Won', stats.campsCaptured[myT], stats.campsCaptured[enemyT]); row += rowH;
    addStatRow(row, 'Camps Lost', stats.campsLost[myT], stats.campsLost[enemyT]); row += rowH + 4;

    // Economy section
    addHeader(row, '--- ECONOMY ---'); row += rowH;
    const myRes = stats.resourcesDelivered[myT];
    const enRes = stats.resourcesDelivered[enemyT];
    addStatRow(row, '🥕 Carrots', myRes.carrot, enRes.carrot); row += rowH;
    addStatRow(row, '🍖 Meat', myRes.meat, enRes.meat); row += rowH;
    addStatRow(row, '💎 Crystals', myRes.crystal, enRes.crystal); row += rowH;
    addStatRow(row, '⚙️ Metal', myRes.metal, enRes.metal); row += rowH + 8;

    // Animate stat cards in
    phase2Objects.forEach((obj, i) => {
      this.tweens.add({ targets: obj, alpha: 1, y: obj.y, duration: 300, delay: 1500 + i * 40, ease: 'Power2' });
    });

    // Phase 3: Top Killer card (delay ~4000ms)
    const tkRow = row;
    const tk = this.topKiller[myT];
    const tkEmoji = tk.type ? (ANIMALS[tk.type]?.emoji || '') : '';
    const tkLabel = tk.kills > 0 ? `${tkEmoji} ${tk.type.charAt(0).toUpperCase() + tk.type.slice(1)} — ${tk.kills} kills` : 'No kills recorded';
    const tkHeader = this.add.text(cx, tkRow, '⭐ TOP KILLER', {
      fontSize: '14px', color: '#FFD93D', fontFamily: '"Fredoka", sans-serif', fontStyle: 'bold',
    }).setOrigin(0.5).setScrollFactor(0).setDepth(201).setAlpha(0);
    const tkText = this.add.text(cx, tkRow + 22, tkLabel, {
      fontSize: '16px', color: '#ffffff', fontFamily: '"Nunito", sans-serif', fontStyle: 'bold',
    }).setOrigin(0.5).setScrollFactor(0).setDepth(201).setAlpha(0);

    const phase3Delay = 1500 + phase2Objects.length * 40 + 500;
    this.tweens.add({ targets: tkHeader, alpha: 1, scaleX: { from: 0.8, to: 1 }, scaleY: { from: 0.8, to: 1 }, duration: 400, delay: phase3Delay, ease: 'Back.easeOut' });
    this.tweens.add({ targets: tkText, alpha: 1, duration: 400, delay: phase3Delay + 200 });

    // Phase 4: Buttons (delay ~6000ms)
    const btnDelay = phase3Delay + 800;
    const btnY = tkRow + 60;

    const playAgainBtn = this.add.text(cx - 90, btnY, 'PLAY AGAIN', {
      fontSize: '18px', color: '#45E6B0', fontFamily: '"Fredoka", sans-serif', fontStyle: 'bold',
      backgroundColor: '#0d1a0d', padding: { x: 16, y: 8 },
    }).setOrigin(0.5).setScrollFactor(0).setDepth(201).setAlpha(0).setInteractive({ useHandCursor: true });
    playAgainBtn.on('pointerdown', () => {
      this.cameras.main.fadeOut(400, 15, 26, 10);
      this.cameras.main.once('camerafadeoutcomplete', () => { this.cleanupHTML(); this.scene.restart(); });
    });
    playAgainBtn.on('pointerover', () => { playAgainBtn.setColor('#FFD93D'); playAgainBtn.setScale(1.05); });
    playAgainBtn.on('pointerout', () => { playAgainBtn.setColor('#45E6B0'); playAgainBtn.setScale(1); });

    const menuBtn = this.add.text(cx + 90, btnY, 'BACK TO MENU', {
      fontSize: '18px', color: '#45E6B0', fontFamily: '"Fredoka", sans-serif', fontStyle: 'bold',
      backgroundColor: '#0d1a0d', padding: { x: 16, y: 8 },
    }).setOrigin(0.5).setScrollFactor(0).setDepth(201).setAlpha(0).setInteractive({ useHandCursor: true });
    menuBtn.on('pointerdown', () => {
      this.cameras.main.fadeOut(400, 15, 26, 10);
      this.cameras.main.once('camerafadeoutcomplete', () => { this.cleanupHTML(); this.scene.start('MenuScene'); });
    });
    menuBtn.on('pointerover', () => { menuBtn.setColor('#FFD93D'); menuBtn.setScale(1.05); });
    menuBtn.on('pointerout', () => { menuBtn.setColor('#45E6B0'); menuBtn.setScale(1); });

    this.tweens.add({ targets: playAgainBtn, alpha: 1, duration: 400, delay: btnDelay });
    this.tweens.add({ targets: menuBtn, alpha: 1, duration: 400, delay: btnDelay + 100 });
  }

  // ─── UNIT MANAGEMENT ────────────────────────────────────────

  /** Nudge a position out of impassable tiles (rock/water) by searching nearby */
  private findWalkableSpawn(x: number, y: number): { x: number; y: number } {
    if (this.isTileWalkable(x, y)) return { x, y };
    // Spiral outward to find a walkable cell
    for (let r = 1; r <= 5; r++) {
      for (let a = 0; a < 8; a++) {
        const angle = (a / 8) * Math.PI * 2;
        const nx = x + Math.cos(angle) * r * TILE_SIZE;
        const ny = y + Math.sin(angle) * r * TILE_SIZE;
        if (this.isTileWalkable(nx, ny)) return { x: nx, y: ny };
      }
    }
    return { x, y }; // give up
  }

  private spawnUnit(type: string, team: 1 | 2, x: number, y: number) {
    const def = ANIMALS[type];
    if (!def) return;
    // Nudge spawn point down so units appear below buildings/nexus
    y += 40;
    // Ensure spawn is not on a rock/water tile
    const safe = this.findWalkableSpawn(x, y);
    x = safe.x; y = safe.y;
    const maxHp = Math.round(def.hp * (1 + this.getBuffs(team).hp));

    // New spawns go to the rally point for this type+team (set by last command)
    let targetX = x, targetY = y;
    const rally = this.rallyPoints[`${type}_${team}`];
    if (rally) {
      const a = this.nextId * GOLDEN_ANGLE;
      const r = Math.sqrt(this.units.filter(u => u.type === type && u.team === team && !u.dead).length) * 18;
      targetX = rally.x + Math.cos(a) * r;
      targetY = rally.y + Math.sin(a) * r;
    }

    // Tighter speed variance so horde units stay together as a mob
    const speedVariance = 0.93 + Math.random() * 0.14;
    this.units.push({
      id: this.nextId++, type, team,
      hp: maxHp, maxHp, attack: def.attack, speed: def.speed * speedVariance,
      x, y, targetX, targetY,
      attackTimer: 0, sprite: null, dead: false, animState: 'idle' as const, prevSpriteX: 0, prevSpriteY: 0,
      campId: null, lungeX: 0, lungeY: 0,
      gnomeShield: type === 'gnome' ? 1 : 0,
      hasRebirth: type === 'skull',
      diveReady: false,
      diveTimer: 0,
      lastAttackTarget: -1, attackFaceX: null, pathWaypoints: null, pathAge: 0, pathTargetX: 0, pathTargetY: 0,
      lastCheckX: x, lastCheckY: y, stuckFrames: 0, stuckCooldown: 0,
      carrying: null, carrySprite: null,
      // Inherit active group workflow so new spawns auto-join the loop
      loop: this.groupWorkflows[`${type}_${team}`]
        ? { ...this.groupWorkflows[`${type}_${team}`], currentStep: 0 }
        : null,
      isElite: false,
      idleTimer: 0,
      claimItemId: -1,
      equipment: null,
      equipLevel: 0,
      equipSprite: null,
      equipDragSprite: null,
      equipVisualApplied: null,
      mods: this.groupModifiers[`${type}_${team}`]
        ? { ...this.groupModifiers[`${type}_${team}`] }
        : { ...DEFAULT_MODS },
    });
    this.matchStats.unitsSpawned[team]++;
    // Spawn SFX — per-unit voice grunt with generic fallbacks
    const spawnKey = ('spawn_' + type) as import('../audio/SoundManager').SfxKey;
    if (type === 'troll') {
      this.sfx.playAt('troll_awaken', x, y);
    } else if (type === 'minotaur') {
      this.sfx.playAt('minotaur_warcry', x, y);
    } else if (this.sfx.hasSound(spawnKey)) {
      this.sfx.playAt(spawnKey, x, y);
    } else {
      this.sfx.playAt('unit_spawn', x, y);
    }
  }

  /** Apply behavior modifiers to units of the selected hoard. Sticky: only update axes explicitly set. */
  private applyModifiers(mods: { formation?: string | null; caution?: string | null; pacing?: string | null }, subject: string, team: 1 | 2) {
    const sel = this.units.filter(u => u.team === team && !u.dead && (subject === 'all' || u.type === subject));
    const types = subject === 'all' ? new Set(sel.map(u => u.type)) : new Set([subject]);

    for (const type of types) {
      const key = `${type}_${team}`;
      if (!this.groupModifiers[key]) this.groupModifiers[key] = { ...DEFAULT_MODS };
      const gm = this.groupModifiers[key];

      // null = clear that axis back to normal. undefined = leave unchanged (sticky).
      if (mods.formation !== undefined) gm.formation = (mods.formation as any) || 'normal';
      if (mods.caution !== undefined) gm.caution = (mods.caution as any) || 'normal';
      if (mods.pacing !== undefined) gm.pacing = (mods.pacing as any) || 'normal';
    }

    // Apply to living units
    for (const u of sel) {
      const key = `${u.type}_${team}`;
      const gm = this.groupModifiers[key] || DEFAULT_MODS;
      u.mods = { ...gm };
    }

    // Log for debugging
    const active = [];
    if (mods.formation && mods.formation !== 'normal') active.push(`formation:${mods.formation}`);
    if (mods.caution && mods.caution !== 'normal') active.push(`caution:${mods.caution}`);
    if (mods.pacing && mods.pacing !== 'normal') active.push(`pacing:${mods.pacing}`);
    if (active.length > 0) console.log(`[Mods] ${subject} team ${team}: ${active.join(', ')}`);
  }

  private sendUnitsTo(units: HUnit[], tx: number, ty: number, setRally = false) {
    // Save rally point per type+team so new spawns also go here
    if (setRally) {
      const types = new Set(units.map(u => u.type));
      const teams = new Set(units.map(u => u.team));
      for (const type of types) {
        for (const team of teams) {
          if (team === 0) continue;
          this.rallyPoints[`${type}_${team}`] = { x: tx, y: ty };
        }
      }
      // If "all" was sent, set rally for every type this team has
      if (types.size > 1) {
        const team = [...teams].find(t => t !== 0);
        if (team != null) {
          for (const type of Object.keys(ANIMALS)) {
            this.rallyPoints[`${type}_${team}`] = { x: tx, y: ty };
          }
        }
      }
    }

    for (let i = 0; i < units.length; i++) {
      const a = i * GOLDEN_ANGLE;
      // Tighter spiral for low-tier horde units, wider for big units
      const tier = ANIMALS[units[i].type]?.tier || 1;
      const spacing = tier <= 1 ? 28 : tier <= 2 ? 36 : 46;
      const r = Math.sqrt(i) * spacing;
      units[i].targetX = tx + Math.cos(a) * r;
      units[i].targetY = ty + Math.sin(a) * r;
    }
  }

  // ─── MULTIPLAYER SYNC ──────────────────────────────────────

  /** Called when the local player issues a voice/text command */
  private issueCommand(text: string) {
    this.voiceOrb?.setState('processing');
    // Immediately mute mic so it doesn't pick up noise while we process
    this.scribeService?.pause();
    if (this.recognition && this.isListening) {
      try { this.recognition.stop(); } catch (_e) { /* */ }
    }
    this.pendingCommandText = text;
    // Track last command per hoard for display on hoard bar
    if (this.selectedHoard === 'all') {
      // When commanding 'all', store per each unit type so each card shows the command
      const team = this.isDebug ? this.debugControlTeam : this.myTeam;
      for (const h of this.getAvailableHoards()) {
        if (h !== 'all') this.lastHoardCommand[h] = text;
      }
    }
    this.lastHoardCommand[this.selectedHoard] = text;
    if (this.isOnline && !this.isHost) {
      // Guest: send command to host via Firebase
      this.showFeedback('Sending...', '#FFD93D');
      if (this.firebase && this.gameId) {
        this.firebase.sendRemoteOrders(this.gameId, this.playerId || '', [
          { heroId: '', order: { text, team: this.myTeam, selectedHoard: this.selectedHoard } as any },
        ]);
      }
      return;
    }
    // Host or solo: execute locally
    const team = this.isDebug ? this.debugControlTeam : this.myTeam;
    this.handleCommand(text, team);
  }

  /** Host pushes full game state to Firebase for guest to render */
  private pushHostSync() {
    if (!this.firebase || !this.gameId) return;
    const syncUnits: HordeSyncUnit[] = this.units.filter(u => !u.dead).map(u => ({
      id: u.id, type: u.type, team: u.team,
      hp: u.hp, maxHp: u.maxHp, attack: u.attack, speed: u.speed,
      x: u.x, y: u.y, targetX: u.targetX, targetY: u.targetY,
      dead: false, campId: u.campId,
      carrying: u.carrying, equipment: u.equipment, equipLevel: u.equipLevel,
      animState: u.animState,
      loop: u.loop ? { steps: u.loop.steps.map(s => ({ ...(s as any) })), currentStep: u.loop.currentStep } : null,
    }));
    const syncCamps = this.camps.map(c => ({
      id: c.id, owner: c.owner, spawnTimer: c.spawnTimer, storedFood: c.storedFood,
    }));
    const syncNexuses = this.nexuses.map(n => ({
      team: n.team, hp: n.hp,
    }));
    const state: HordeSyncState = {
      units: syncUnits,
      camps: syncCamps,
      nexuses: syncNexuses,
      rallyPoints: this.rallyPoints,
      baseSpawnTimers: this.baseSpawnTimers,
      nextId: this.nextId,
      gameTime: this.gameTime,
      gameOver: this.gameOver,
      winner: this.winner,
      baseStockpile: this.baseStockpile,
      currentEra: this.currentEra,
      groundItems: this.groundItems.filter(i => !i.dead).map(i => ({ id: i.id, type: i.type, x: i.x, y: i.y })),
      teamBuffs: this.teamBuffs.map(b => ({ team: b.team, stat: b.stat, amount: b.amount, remaining: b.remaining })),
      groupWorkflows: this.groupWorkflows,
      groupModifiers: this.groupModifiers,
      freeGnomeTimer: this.freeGnomeTimer,
      unlockedEquipment: {
        1: Object.fromEntries(this.unlockedEquipment[1]),
        2: Object.fromEntries(this.unlockedEquipment[2]),
      },
      matchStats: this.matchStats,
      topKiller: this.topKiller,
      mapEvents: this.mapEvents.map(e => ({
        id: e.id, type: e.type, x: e.x, y: e.y,
        timer: e.timer, duration: e.duration, state: e.state,
        progress: e.progress, claimedBy: e.claimedBy,
        data: { hp: e.data.hp, maxHp: e.data.maxHp, kills: e.data.kills, deliveries: e.data.deliveries, sacrifices: e.data.sacrifices, fedAmount: e.data.fedAmount, bearSize: e.data.bearSize, targetType: e.data.targetType, targetCount: e.data.targetCount, cost: e.data.cost, sacrificesNeeded: e.data.sacrificesNeeded },
      })),
    };
    this.firebase.pushSyncState(this.gameId, state as any);
  }

  /** Guest applies state snapshot from host */
  private applyGuestSync(state: HordeSyncState) {
    if (!state) return;

    // Firebase RTDB converts arrays to objects with numeric keys — normalize
    const toArray = <T>(val: T[] | Record<string, T> | undefined): T[] => {
      if (!val) return [];
      if (Array.isArray(val)) return val.filter(v => v != null);
      return Object.values(val).filter(v => v != null);
    };

    const syncUnits = toArray(state.units);
    const syncCamps = toArray(state.camps);
    const syncNexuses = toArray(state.nexuses);

    this.gameTime = state.gameTime || 0;
    this.nextId = state.nextId || 0;
    this.rallyPoints = state.rallyPoints || {};
    this.baseSpawnTimers = state.baseSpawnTimers || { 1: 0, 2: 0 };

    // Sync resources, era, buffs
    if (state.baseStockpile) this.baseStockpile = state.baseStockpile as any;
    if (state.currentEra !== undefined) this.currentEra = state.currentEra;
    if (state.teamBuffs) {
      this.teamBuffs = (Array.isArray(state.teamBuffs) ? state.teamBuffs : Object.values(state.teamBuffs)).map((b: any) => ({
        team: b.team as 1 | 2, stat: b.stat as 'speed' | 'attack', amount: b.amount, remaining: b.remaining,
      }));
    }
    if (state.unlockedEquipment) {
      for (const team of [1, 2] as const) {
        const data = state.unlockedEquipment[team];
        if (data) {
          this.unlockedEquipment[team] = new Map(
            Object.entries(data).map(([k, v]) => [k as EquipmentType, v as number])
          );
        }
      }
    }
    if (state.matchStats) this.matchStats = state.matchStats;
    if (state.topKiller) this.topKiller = state.topKiller as any;

    // Sync ground items
    if (state.groundItems) {
      const syncItems = Array.isArray(state.groundItems) ? state.groundItems : Object.values(state.groundItems);
      const incomingItemIds = new Set(syncItems.map((i: any) => i.id));
      // Remove items no longer present
      for (const gi of this.groundItems) {
        if (!incomingItemIds.has(gi.id)) {
          gi.dead = true;
          if (gi.sprite) { gi.sprite.destroy(); gi.sprite = null; }
        }
      }
      this.groundItems = this.groundItems.filter(i => !i.dead);
      // Update or create items
      const existingItems = new Map(this.groundItems.map(i => [i.id, i]));
      for (const si of syncItems as { id: number; type: string; x: number; y: number }[]) {
        const existing = existingItems.get(si.id);
        if (existing) {
          existing.x = si.x; existing.y = si.y;
        } else {
          this.groundItems.push({
            id: si.id, type: si.type as ResourceType, x: si.x, y: si.y,
            sprite: null, dead: false, age: 0,
          });
        }
      }
    }

    if (state.groupWorkflows) this.groupWorkflows = state.groupWorkflows as any;
    if (state.groupModifiers) this.groupModifiers = state.groupModifiers as any;
    if (state.freeGnomeTimer !== undefined) this.freeGnomeTimer = state.freeGnomeTimer;

    // Sync nexuses
    for (const sn of syncNexuses) {
      const n = this.nexuses.find(nx => nx.team === sn.team);
      if (n) n.hp = sn.hp;
    }

    // Sync camps
    for (const sc of syncCamps) {
      const c = this.camps.find(cx => cx.id === sc.id);
      if (c) {
        c.owner = sc.owner as 0 | 1 | 2;
        c.spawnTimer = sc.spawnTimer;
        if (sc.storedFood !== undefined) c.storedFood = sc.storedFood;
      }
    }

    // Sync units: reconcile existing with incoming
    const liveUnits = syncUnits.filter(u => !u.dead);
    const incomingIds = new Set(liveUnits.map(u => u.id));

    // Remove units that no longer exist
    for (const u of this.units) {
      if (!incomingIds.has(u.id)) {
        u.dead = true;
        if (u.sprite) { u.sprite.destroy(); u.sprite = null; }
        if (u.equipSprite) { u.equipSprite.destroy(); u.equipSprite = null; }
        if (u.carrySprite) { u.carrySprite.destroy(); u.carrySprite = null; }
        if (u.equipDragSprite) { u.equipDragSprite.destroy(); u.equipDragSprite = null; }
      }
    }
    this.units = this.units.filter(u => !u.dead);

    // Update or create units
    const existingMap = new Map(this.units.map(u => [u.id, u]));
    for (const su of liveUnits) {
      const existing = existingMap.get(su.id);
      if (existing) {
        // Update in place — lerp position for smoothness
        existing.hp = su.hp;
        existing.maxHp = su.maxHp;
        existing.targetX = su.targetX;
        existing.targetY = su.targetY;
        existing.team = su.team as 0 | 1 | 2;
        existing.type = su.type;
        existing.carrying = (su.carrying || null) as ResourceType | null;
        existing.equipment = (su.equipment || null) as any;
        existing.equipLevel = su.equipLevel || 0;
        existing.animState = (su.animState || 'idle') as any;
        if (su.loop) {
          if (existing.loop) {
            existing.loop.currentStep = su.loop.currentStep;
          }
        } else {
          existing.loop = null;
        }
        // Lerp actual position toward synced position
        existing.x += (su.x - existing.x) * 0.3;
        existing.y += (su.y - existing.y) * 0.3;
      } else {
        // New unit from host
        this.units.push({
          id: su.id, type: su.type, team: su.team as 0 | 1 | 2,
          hp: su.hp, maxHp: su.maxHp, attack: su.attack, speed: su.speed,
          x: su.x, y: su.y, targetX: su.targetX, targetY: su.targetY,
          attackTimer: 0, sprite: null, dead: false, animState: 'idle' as const, prevSpriteX: 0, prevSpriteY: 0,
          campId: su.campId, lungeX: 0, lungeY: 0,
          gnomeShield: su.type === 'gnome' ? 1 : 0,
          hasRebirth: su.type === 'skull',
          diveReady: false,
          diveTimer: 0,
          lastAttackTarget: -1, attackFaceX: null, pathWaypoints: null, pathAge: 0, pathTargetX: 0, pathTargetY: 0, lastCheckX: 0, lastCheckY: 0, stuckFrames: 0, stuckCooldown: 0, mods: { ...DEFAULT_MODS },
          carrying: (su.carrying || null) as ResourceType | null, carrySprite: null, loop: null, isElite: false, idleTimer: 0, claimItemId: -1,
          equipment: (su.equipment || null) as any, equipLevel: su.equipLevel || 0, equipSprite: null, equipDragSprite: null, equipVisualApplied: null,
        });
      }
    }

    // Sync map events from host
    if (state.mapEvents) {
      const syncEvents = toArray(state.mapEvents);
      const existingEvMap = new Map(this.mapEvents.map(e => [e.id, e]));
      for (const se of syncEvents) {
        const existing = existingEvMap.get(se.id);
        if (existing) {
          existing.timer = se.timer;
          existing.state = se.state as 'active' | 'claimed' | 'expired';
          existing.progress = se.progress as { 1: number; 2: number };
          existing.claimedBy = se.claimedBy as 1 | 2 | null;
          Object.assign(existing.data, se.data);
        } else {
          // New event — create visuals
          this.spawnEvent(se.type as MapEventType, se.x, se.y);
          const newEv = this.mapEvents[this.mapEvents.length - 1];
          if (newEv) {
            newEv.id = se.id;
            newEv.timer = se.timer;
            newEv.state = se.state as 'active' | 'claimed' | 'expired';
            newEv.progress = se.progress as { 1: number; 2: number };
            newEv.claimedBy = se.claimedBy as 1 | 2 | null;
            Object.assign(newEv.data, se.data);
          }
        }
      }
      // Remove events no longer in sync
      const syncIds = new Set(syncEvents.map(e => e.id));
      for (let i = this.mapEvents.length - 1; i >= 0; i--) {
        if (!syncIds.has(this.mapEvents[i].id)) {
          this.mapEvents[i].container?.destroy();
          this.mapEvents.splice(i, 1);
        }
      }
      this.updateEventHUD();
    }

    // Check game over (only trigger once)
    if (state.gameOver && !this.gameOver) {
      this.gameOver = true;
      this.winner = state.winner as 1 | 2 | null;
      this.sfx.playGlobal(this.winner === this.myTeam ? 'victory' : 'defeat');
      this.showGameOver();
    }
  }

  // ─── COMMAND PARSING ─────────────────────────────────────────

  private async handleCommand(text: string, team: 1 | 2) {
    // Micro-filter: reject obvious non-commands before Gemini call
    const trimmed = text.trim();
    if (trimmed.length < 2 || /^(.)\1{3,}$/.test(trimmed)) { this.resumeMicIfNeeded(); return; } // noise
    const lo = trimmed.toLowerCase();
    if (['um','uh','hmm','ok','okay','so','well','like','yeah','hey','hello','hi'].includes(lo)) { this.resumeMicIfNeeded(); return; } // filler
    if (/^(pause|save|quit|exit|restart|settings|options|menu|volume|mute|undo|skip)$/i.test(lo)) {
      this.showFeedback("Voice commands only! Try: 'attack' or 'make gnomes'", '#FFD93D');
      this.resumeMicIfNeeded();
      return;
    }

    // Pre-correct common STT mishearings before Gemini
    text = correctSTT(text);

    // Guard against concurrent command processing (Gemini is async) — queue instead of dropping
    if (this.isProcessingCommand) {
      this.pendingLocalCommands.push({ text, team });
      this.showFeedback('Queued — processing previous command...', '#FFD93D');
      return; // mic stays paused — will resume when current command finishes
    }
    this.isProcessingCommand = true;
    this.voiceOrb?.setState('processing');

    this.pendingCommandText = text;
    console.log(`[Command] Heard: "${text}" | Gemini cooldown: ${Math.round((_geminiCooldownMs - (Date.now() - _lastGeminiCall)) / 1000)}s left`);
    this.showFeedback(`"${text.length > 40 ? text.slice(0, 37) + '...' : text}"`, '#FFD93D');

    try {
    // Build rich context for Gemini — full game state
    const base = team === 1 ? P1_BASE : P2_BASE;

    // Unit counts with gathering info
    const countBy: Record<string, { count: number; gathering: number }> = {};
    for (const u of this.units) {
      if (u.team === team && !u.dead) {
        if (!countBy[u.type]) countBy[u.type] = { count: 0, gathering: 0 };
        countBy[u.type].count++;
        if (u.loop) countBy[u.type].gathering++;
      }
    }
    const myUnits = Object.entries(countBy).map(([type, info]) => ({
      type, count: info.count, tier: ANIMALS[type]?.tier || 1, gathering: info.gathering,
    }));

    // Camp context — only include camps the player has evidence for (own, scouted, or in vision)
    const campCtx = this.camps
      .filter(c => c.owner === team || c.scouted || this.isInVision(c.x, c.y))
      .map((c, i) => {
        const inVision = this.isInVision(c.x, c.y);
        const defenders = inVision ? this.units.filter(u => u.campId === c.id && u.team === 0 && !u.dead).length : 0;
        const cost = SPAWN_COSTS[c.animalType];
        const effectiveOwner = inVision ? c.owner : c.lastSeenOwner;
        return {
          name: c.name, animalType: c.animalType, tier: ANIMALS[c.animalType]?.tier || 1, index: i,
          owner: effectiveOwner === 0 ? 'NEUTRAL' : effectiveOwner === team ? 'YOURS' : 'ENEMY',
          x: Math.round(c.x), y: Math.round(c.y),
          dist: Math.round(pdist(c, base)),
          defenders, storedFood: c.owner === team ? c.storedFood : 0, spawnCost: cost?.amount || 0,
        };
      })
      .sort((a, b) => a.dist - b.dist);

    const myNex = this.nexuses.find(n => n.team === team)!;
    const enemyNex = this.nexuses.find(n => n.team !== team)!;
    const enemyNexVisible = this.fogDisabled || this.isInVision(enemyNex.x, enemyNex.y);
    const nexusHp = { mine: Math.round(myNex.hp), enemy: enemyNexVisible ? Math.round(enemyNex.hp) : -1 };

    // Count ground resources (only those in vision)
    const alive = this.groundItems.filter(g => !g.dead && (this.fogDisabled || this.isInVision(g.x, g.y)));
    const groundCarrots = alive.filter(g => g.type === 'carrot').length;
    const groundMeat = alive.filter(g => g.type === 'meat').length;
    const groundCrystals = alive.filter(g => g.type === 'crystal').length;

    const activeEvents = this.mapEvents.filter(e => e.state === 'active').map(e => {
      const def = MAP_EVENT_DEFS[e.type];
      let info = '';
      let howToWin = '';
      if (e.type === 'mercenary_outpost') { info = `deliver ${e.data.cost?.amount} ${e.data.cost?.type}`; howToWin = 'Send units carrying the required resource to the outpost to deliver it. First team to deliver enough wins mercenary units.'; }
      else if (e.type === 'kill_bounty') { info = `kill ${e.data.targetType}s`; howToWin = 'Hunt and kill the marked target animals near the event. The team that gets the most kills wins bonus resources.'; }
      else if (e.type === 'bottomless_pit') { info = `sacrifice ${e.data.sacrificesNeeded} units`; howToWin = 'Send units to the pit — they will be sacrificed. First team to sacrifice enough units wins a powerful reward.'; }
      else if (e.type === 'hungry_bear') { info = `feed carrots/meat`; howToWin = 'Deliver food (carrots or meat) to the bear. First team to feed it enough tames it as a powerful siege unit.'; }
      else if (e.type === 'warchest') { info = `attack to break`; howToWin = 'Send combat units to attack the chest. First team to deal enough damage breaks it open and claims loot.'; }
      else if (e.type === 'fungal_bloom') { info = `gather resources in zone`; howToWin = 'Send gatherers into the bloom zone to pick up mushroom resources that spawn there. Collect as many as you can before time runs out.'; }
      return { type: e.type, emoji: def.emoji, name: def.name, x: Math.round(e.x), y: Math.round(e.y), timeLeft: Math.round(e.timer / 1000), info, howToWin };
    });

    // Compute hoard centroid for spatial awareness
    const subject = this.selectedHoard;
    const selUnits = this.units.filter(u => u.team === team && !u.dead && (subject === 'all' || u.type === subject));
    const hcx = selUnits.length > 0 ? Math.round(selUnits.reduce((s, u) => s + u.x, 0) / selUnits.length) : base.x;
    const hcy = selUnits.length > 0 ? Math.round(selUnits.reduce((s, u) => s + u.y, 0) / selUnits.length) : base.y;

    const ctx: GameContext = {
      myUnits, camps: campCtx, nexusHp,
      resources: { ...this.baseStockpile[team] },
      groundCarrots, groundMeat, groundCrystals,
      gameTime: this.gameTime,
      selectedHoard: this.selectedHoard,
      hoardCenter: { x: hcx, y: hcy },
      carrotZones: this.mapDef?.carrotZones || [],
      activeEvents,
      activeBuffs: this.teamBuffs.filter(b => b.team === team).map(b => ({
        stat: b.stat, amount: b.amount, remaining: Math.round(b.remaining / 1000),
      })),
    };

    // Try Gemini first, with error protection so local fallback always runs
    let geminiHandled = false;
    try {
      const geminiResult = await parseWithGemini(text, ctx);

      if (geminiResult && geminiResult.length > 0) {
        // Only use first command — hoard selection is separate, one command per input
        const gCmd = validateAndFixWorkflow(geminiResult[0]);
        console.log('[Gemini] Validated command:', JSON.stringify(gCmd));

        // Handle non-action responses from Gemini
        if (gCmd.responseType === 'unrecognized' && !gCmd.workflow?.length && gCmd.targetType !== 'workflow') {
          const quip = gCmd.narration || this.getContextualHint(team);
          this.showFeedback(quip, '#FFD93D');
          this.showAIResponse(quip);
          const voiceHoard = this.selectedHoard !== 'all' ? this.selectedHoard : 'all';
          this.ttsService?.speak(voiceHoard, quip);
          const confSel = this.units.filter(u => u.team === team && !u.dead);
          this.unitReact('confused', confSel);
          geminiHandled = true;
        } else if (gCmd.responseType === 'status_query' || gCmd.targetType === 'query') {
          const report = gCmd.statusReport || gCmd.narration || 'All good, Commander!';
          this.showFeedback(report, '#6CC4FF');
          this.showAIResponse(report);
          // Use selectedHoard for status queries — the "narrator" for that group
          const statusVoice = this.selectedHoard !== 'all' ? this.selectedHoard : 'all';
          this.ttsService?.speak(statusVoice, report);
          this.sfx.playGlobal('voice_recognized');
          geminiHandled = true;
        } else if (this.executeGeminiCommand(gCmd, team)) {
          this.sfx.playGlobal('voice_recognized');
          // Show thought bubbles with LLM-generated reaction
          if (gCmd.unitReaction) {
            const sel = this.units.filter(u => u.team === team && !u.dead && (this.selectedHoard === 'all' || u.type === this.selectedHoard));
            this.showThoughtBubbles(sel, gCmd.unitReaction);
            // Store reaction per hoard for sidebar display
            if (this.selectedHoard === 'all') {
              for (const h of this.getAvailableHoards()) {
                if (h !== 'all') this.lastHoardReaction[h] = gCmd.unitReaction;
              }
            } else {
              this.lastHoardReaction[this.selectedHoard] = gCmd.unitReaction;
            }
          }
          // TTS voice = selected hoard (who's responding), not target animal
          if (gCmd.narration) {
            this.showAIResponse(gCmd.narration);
            const ttsVoice = this.selectedHoard !== 'all' ? this.selectedHoard : 'all';
            console.log(`[TTS] Voice: selectedHoard=${this.selectedHoard} → "${ttsVoice}"`);
            this.ttsService?.speak(ttsVoice, gCmd.narration);
          }
          geminiHandled = true;
        }
      }
    } catch (err) {
      console.warn('[Command] Gemini failed, falling back to local:', err);
    }

    if (!geminiHandled) {
      this.showFeedback('Gemini unavailable — try again', '#FF6B6B');
    }

    } finally {
      this.isProcessingCommand = false;
      // Resume mic and orb (unless TTS is playing, which manages its own state via onPlayStart/onPlayEnd)
      this.resumeMicIfNeeded();
    }
  }

  /** Check workflow preconditions. Returns null if OK, or { error, missingEquipment?, thenAction? } */
  private checkPreconditions(steps: WorkflowStep[], team: 1 | 2): { error: string; missingEquipment?: EquipmentType; thenAction?: string } | null {
    for (const s of steps) {
      if (s.action === 'equip') {
        const eqType = (s as { equipmentType: EquipmentType }).equipmentType;
        if (!this.unlockedEquipment[team].has(eqType)) {
          // Determine the "then action" — what to do after equipping
          const equipIdx = steps.indexOf(s);
          const afterSteps = steps.slice(equipIdx + 1);
          let thenAction: string | undefined;
          if (afterSteps.length > 0) {
            const mainStep = afterSteps.find(a => a.action !== 'deliver' && a.action !== 'seek_resource');
            thenAction = mainStep?.action || afterSteps[0].action;
          }
          return { error: `Need to unlock ${eqType}`, missingEquipment: eqType, thenAction };
        }
      }
      if (s.action === 'mine') {
        if (!this.unlockedEquipment[team].has('pickaxe')) {
          return { error: 'Need to unlock pickaxe', missingEquipment: 'pickaxe' as EquipmentType, thenAction: 'mine' };
        }
      }
      if (s.action === 'attack_camp') {
        const animal = (s as { targetAnimal?: string }).targetAnimal;
        if (animal && !this.camps.some(c => c.animalType === animal)) return { error: `No ${animal} camp exists!` };
      }
      if (s.action === 'deliver') {
        const target = (s as { target: string }).target;
        const m = target.match(/^nearest_(\w+)_camp$/);
        if (m && !this.camps.some(c => c.animalType === m[1])) return { error: `No ${m[1]} camp exists!` };
      }
    }
    return null;
  }

  private executeGeminiCommand(cmd: HordeCommand, team: 1 | 2): boolean {
    const subject = this.selectedHoard; // hoard is selected via Q/E keys, not parsed from voice
    const base = team === 1 ? P1_BASE : P2_BASE;

    // Cancel active plans when a non-plan command is issued for the same group
    if (cmd.targetType !== 'advanced_plan' && !cmd.modifierOnly) {
      this.cancelPlansForGroup(subject, team);
    }
    let tx = 0, ty = 0, found = false;

    // Apply behavior modifiers (sticky — only update axes that are explicitly set)
    if (cmd.modifiers) {
      this.applyModifiers(cmd.modifiers, subject, team);
    }

    // Modifier-only command: update modifiers but keep existing workflow
    if (cmd.modifierOnly) {
      const modNames = [];
      if (cmd.modifiers?.formation) modNames.push(`formation: ${cmd.modifiers.formation}`);
      if (cmd.modifiers?.caution) modNames.push(`caution: ${cmd.modifiers.caution}`);
      if (cmd.modifiers?.pacing) modNames.push(`pacing: ${cmd.modifiers.pacing}`);
      this.showFeedback(cmd.narration || `Style: ${modNames.join(', ')}`, '#FFD93D');
      return true;
    }

    if (cmd.targetType === 'nexus') {
      const n = this.nexuses.find(n2 => n2.team !== team)!;
      tx = n.x; ty = n.y; found = true;

    } else if (cmd.targetType === 'base' || cmd.targetType === 'defend' || cmd.targetType === 'retreat') {
      tx = base.x; ty = base.y; found = true;

    } else if (cmd.targetType === 'camp') {
      // Specific camp by index
      if (cmd.campIndex != null && cmd.campIndex >= 0 && cmd.campIndex < this.camps.length) {
        const c = this.camps[cmd.campIndex];
        tx = c.x; ty = c.y; found = true;
      }
      // By animal type — nearest not owned by me
      if (!found && cmd.targetAnimal) {
        const cs = this.camps.filter(c => c.animalType === cmd.targetAnimal && c.owner !== team)
          .sort((a, b) => pdist2(a, base) - pdist2(b, base));
        if (cs.length > 0) { tx = cs[0].x; ty = cs[0].y; found = true; }
      }

    } else if (cmd.targetType === 'nearest_camp') {
      // Find camp matching filters, sorted by qualifier
      let candidates = this.camps.slice();

      // Filter by animal type if specified
      if (cmd.targetAnimal) candidates = candidates.filter(c => c.animalType === cmd.targetAnimal);

      // Filter by qualifier
      const q = cmd.qualifier || 'nearest';
      if (q === 'uncaptured') candidates = candidates.filter(c => c.owner !== team);
      else if (q === 'enemy') candidates = candidates.filter(c => c.owner !== 0 && c.owner !== team);
      else candidates = candidates.filter(c => c.owner !== team); // default: not mine

      if (candidates.length === 0) {
        // If no uncaptured, try any camp of that type
        if (cmd.targetAnimal) candidates = this.camps.filter(c => c.animalType === cmd.targetAnimal);
        else candidates = this.camps.slice();
      }

      // Sort by qualifier
      if (q === 'nearest' || q === 'uncaptured' || q === 'enemy') {
        candidates.sort((a, b) => pdist2(a, base) - pdist2(b, base));
      } else if (q === 'furthest') {
        candidates.sort((a, b) => pdist2(b, base) - pdist2(a, base));
      } else if (q === 'weakest') {
        candidates.sort((a, b) => {
          const da = this.units.filter(u => u.campId === a.id && u.team === 0 && !u.dead).length;
          const db = this.units.filter(u => u.campId === b.id && u.team === 0 && !u.dead).length;
          return da - db;
        });
      }

      if (candidates.length > 0) { tx = candidates[0].x; ty = candidates[0].y; found = true; }

    } else if (cmd.targetType === 'sweep_camps') {
      // Chain-capture: find all matching uncaptured camps, sorted nearest-first
      let targets = this.camps.filter(c => c.owner !== team);
      if (cmd.targetAnimal) targets = targets.filter(c => c.animalType === cmd.targetAnimal);
      targets.sort((a, b) => pdist2(a, base) - pdist2(b, base));

      if (targets.length > 0) {
        // Send to first target, set up auto-chain via rally
        tx = targets[0].x; ty = targets[0].y; found = true;

        // Store the sweep queue so units auto-advance
        const sel = this.units.filter(u => u.team === team && !u.dead && (subject === 'all' || u.type === subject));
        if (sel.length > 0) {
          this.sendUnitsTo(sel, tx, ty, true);
          this.unitReact('charge', sel);
          // Store sweep targets for auto-chaining in update loop
          const key = `sweep_${subject}_${team}`;
          this.activeSweeps[key] = {
            team, subject, targets: targets.map(c => ({ x: c.x, y: c.y, id: c.id })), currentIdx: 0,
          };
          this.showFeedback(cmd.narration || `Sweeping ${cmd.targetAnimal || 'all'}!`, '#45E6B0');
          return true;
        }
      }

    } else if (cmd.targetType === 'workflow' && cmd.workflow && cmd.workflow.length > 0) {
      // LLM-defined workflow — parse steps and assign to selected units
      const sel = this.units.filter(u => u.team === team && !u.dead && (subject === 'all' || u.type === subject));
      if (sel.length === 0) { this.showFeedback(`No ${subject}!`, '#FF6B6B'); return true; }

      const steps: WorkflowStep[] = cmd.workflow.map(s => {
        switch (s.action) {
          case 'seek_resource':
            return { action: 'seek_resource' as const, resourceType: (s.resourceType || 'carrot') as ResourceType };
          case 'deliver':
            return { action: 'deliver' as const, target: s.target || 'base' };
          case 'hunt':
            return { action: 'hunt' as const, targetType: s.targetType };
          case 'attack_camp':
            return { action: 'attack_camp' as const, campIndex: s.campIndex, qualifier: s.qualifier, targetAnimal: s.targetAnimal };
          case 'move':
            return { action: 'move' as const, x: s.x || WORLD_W / 2, y: s.y || WORLD_H / 2 };
          case 'defend':
            return { action: 'defend' as const, target: s.target || 'base' };
          case 'attack_enemies':
            return { action: 'attack_enemies' as const };
          case 'scout':
            return { action: 'scout' as const, x: s.x, y: s.y };
          case 'collect':
            return { action: 'collect' as const, resourceType: (s.resourceType || 'meat') as ResourceType };
          case 'kill_only':
            return { action: 'kill_only' as const, targetType: s.targetType };
          case 'mine':
            return { action: 'mine' as const };
          case 'equip':
            return { action: 'equip' as const, equipmentType: (s.equipmentType || 'pickaxe') as EquipmentType };
          case 'contest_event':
            return { action: 'contest_event' as const };
          case 'withdraw_base':
            return { action: 'withdraw_base' as const, resourceType: (s.resourceType || 'carrot') as ResourceType };
          default:
            console.warn(`[Execute] Unknown action "${s.action}", skipping`);
            return null;
        }
      }).filter((s): s is WorkflowStep => s !== null);

      // Reject overly complex or empty workflows
      if (steps.length === 0) { this.showFeedback('Could not understand that', '#FF6B6B'); return true; }
      if (steps.length > 7) { this.showFeedback('Too complex!', '#FF6B6B'); return true; }

      // Check preconditions (equipment unlocked, camps exist, etc.)
      const preErr = this.checkPreconditions(steps, team);
      if (preErr) {
        if (preErr.missingEquipment) {
          // Auto-convert to advanced_plan: gather resources → unlock → equip → then action
          console.log(`[Execute] Auto-converting to advanced_plan: need ${preErr.missingEquipment}, thenAction=${preErr.thenAction}`);
          const planCmd: HordeCommand = {
            targetType: 'advanced_plan',
            narration: cmd.narration || `Getting ${preErr.missingEquipment} ready`,
            planGoal: {
              type: 'unlock_equipment',
              equipment: preErr.missingEquipment,
              thenAction: preErr.thenAction,
            },
            modifiers: cmd.modifiers,
          };
          return this.executeGeminiCommand(planCmd, team);
        }
        this.showFeedback(preErr.error, '#FF6B6B');
        return true;
      }

      let rawLoopFrom = cmd.loopFrom ?? 0;
      // Safety net: if workflow has attack_camp and delivers to a camp (not base), force loopFrom: 0
      // The attack_camp step is a safeguard that re-checks camp ownership each cycle
      const hasAttackCamp = steps.some(s => s.action === 'attack_camp');
      const deliversToCamp = steps.some(s => s.action === 'deliver' && 'target' in s && (s as { target: string }).target.includes('_camp'));
      if (hasAttackCamp && deliversToCamp) rawLoopFrom = 0;
      const workflow: HWorkflow = { steps, currentStep: 0, label: cmd.narration || 'Custom workflow', loopFrom: Math.max(0, Math.min(rawLoopFrom, steps.length - 1)), playedOnce: false, voiceCommand: this.pendingCommandText || '' };
      for (const u of sel) {
        // Stop current action: clear movement, pathfinding, item claims, and drop wrong resource
        u.loop = { ...workflow, currentStep: 0 };
        u.pathWaypoints = null;
        u.claimItemId = -1;
        u.targetX = u.x; u.targetY = u.y; // stop moving to old target
        // If carrying a resource that doesn't match the new workflow's needs, drop it
        if (u.carrying) {
          const deliverStep = steps.find(s => s.action === 'deliver');
          if (deliverStep && 'target' in deliverStep) {
            const m = (deliverStep as { target: string }).target.match(/^nearest_(\w+)_camp$/);
            if (m) {
              const cost = SPAWN_COSTS[m[1]];
              if (cost && cost.type !== u.carrying) {
                this.spawnGroundItem(u.carrying, u.x, u.y);
                u.carrying = null;
                if (u.carrySprite) { u.carrySprite.destroy(); u.carrySprite = null; }
              }
            }
          }
        }
        // Ensure mods are up-to-date from group modifiers
        const gm = this.groupModifiers[`${u.type}_${team}`];
        if (gm) u.mods = { ...gm };
      }

      // Store as group workflow so new spawns inherit it
      if (subject === 'all') {
        // Apply to all unit types in the selection
        const types = new Set(sel.map(u => u.type));
        for (const t of types) this.groupWorkflows[`${t}_${team}`] = workflow;
      } else {
        this.groupWorkflows[`${subject}_${team}`] = workflow;
      }

      console.log('[Workflow] LLM designed:', JSON.stringify(steps));
      // Charge cry if workflow starts with attack, otherwise affirmative
      const hasAttackStep = steps.some(s => s.action === 'attack_camp' || s.action === 'attack_enemies' || s.action === 'kill_only');
      this.unitReact(hasAttackStep ? 'charge' : 'yes', sel);
      this.showFeedback(cmd.narration || 'Roger!', '#45E6B0');
      return true;

    } else if (cmd.targetType === 'advanced_plan' && cmd.planGoal) {
      // Cancel existing plan for this subject+team
      this.cancelPlansForGroup(subject, team);

      const plan = this.resolvePlan(
        {
          type: cmd.planGoal.type,
          equipment: cmd.planGoal.equipment as EquipmentType | undefined,
          resource: cmd.planGoal.resource as ResourceType | undefined,
          amount: cmd.planGoal.amount,
          thenAction: cmd.planGoal.thenAction,
        },
        team,
        subject,
        this.pendingCommandText || '',
      );

      if (!plan) {
        // Could not resolve (already maxed, invalid goal, etc.)
        this.showFeedback(cmd.narration || 'Already done!', '#FFD93D');
        return true;
      }

      this.activePlans.push(plan);

      // Assign first phase workflow
      const firstPhase = plan.phases[0];
      if (firstPhase?.workflow) {
        this.assignWorkflowToGroup(firstPhase.workflow, subject, team);
      }

      // Show plan feedback
      const sel = this.units.filter(u => u.team === team && !u.dead && (subject === 'all' || u.type === subject));
      this.unitReact('yes', sel);
      this.showFeedback(`Plan: ${plan.goalLabel} (${plan.phases.length} phases)`, '#45E6B0');
      console.log('[AdvancedPlan] Created:', plan.id, plan.phases.map(p => p.label));
      return true;

    } else if (cmd.targetType === 'position') {
      tx = WORLD_W / 2; ty = WORLD_H / 2; found = true;
    }

    if (!found) return false;

    const sel = this.units.filter(u => u.team === team && !u.dead && (subject === 'all' || u.type === subject));
    if (sel.length === 0) {
      this.showFeedback(`No ${subject}!`, '#FF6B6B');
      return true;
    }

    // Convert simple movement into a proper workflow so units always have an active plan
    const isAttack = cmd.targetType === 'nexus' || cmd.targetType === 'camp' || cmd.targetType === 'nearest_camp';
    let steps: WorkflowStep[];
    if (cmd.targetType === 'nexus') {
      steps = [{ action: 'attack_enemies' as const }];
    } else if (cmd.targetType === 'camp' || cmd.targetType === 'nearest_camp') {
      steps = [{ action: 'attack_camp' as const, targetAnimal: cmd.targetAnimal, qualifier: cmd.qualifier || 'nearest' }];
    } else if (cmd.targetType === 'defend') {
      steps = [{ action: 'defend' as const, target: 'base' }];
    } else if (cmd.targetType === 'retreat' || cmd.targetType === 'base') {
      steps = [{ action: 'move' as const, x: base.x, y: base.y }];
    } else {
      steps = [{ action: 'move' as const, x: tx, y: ty }];
    }

    const wf: HWorkflow = { steps, currentStep: 0, label: cmd.narration || (isAttack ? 'Attack!' : 'Moving out'), loopFrom: 0, playedOnce: false, voiceCommand: this.pendingCommandText || '' };
    for (const u of sel) { u.loop = { ...wf, currentStep: 0 }; }
    // Store as group workflow so new spawns inherit
    if (subject === 'all') {
      const types = new Set(sel.map(u => u.type));
      for (const t of types) this.groupWorkflows[`${t}_${team}`] = wf;
    } else {
      this.groupWorkflows[`${subject}_${team}`] = wf;
    }

    this.sendUnitsTo(sel, tx, ty, true);
    this.sfx.playGlobal('move_command');
    this.unitReact(isAttack ? 'charge' : 'yes', sel);
    this.showFeedback(cmd.narration || 'Moving out!', '#45E6B0');
    return true;
  }

  /** Parse a text fragment into workflow steps, appending to `out`. Returns true if any steps were added. */
  private parseLocalSteps(text: string, out: WorkflowStep[], team: 1 | 2): boolean {
    const lo = text.toLowerCase().trim();
    const base = team === 1 ? P1_BASE : P2_BASE;

    // Speech alias map for equipment (voice recognition mishears)
    const eqAliases: Record<string, string> = {
      'pick axe': 'pickaxe', 'pick acts': 'pickaxe', 'pickets': 'pickaxe', 'pic axe': 'pickaxe',
      'batter': 'banner', 'manner': 'banner', 'banter': 'banner',
    };

    // Equip
    const eqMatch = lo.match(/\b(?:get|grab|equip|pick up)\s+(?:a\s+)?(.+?)(?:\s+(?:then|and|after)\b|$)/i);
    if (eqMatch) {
      let eqName = eqMatch[1].toLowerCase().trim();
      if (eqAliases[eqName]) eqName = eqAliases[eqName];
      const eqDef = EQUIPMENT.find(e => e.id === eqName || e.name.toLowerCase() === eqName || eqName.startsWith(e.id));
      if (eqDef) { out.push({ action: 'equip', equipmentType: eqDef.id }); return true; }
    }

    // Mine
    if (/\b(mine|mining)\b/i.test(lo) && !/\bunlock\b|\bbuy\b/i.test(lo)) {
      out.push({ action: 'mine' });
      out.push({ action: 'deliver', target: 'base' });
      return true;
    }

    // Defend
    if (/\b(defend|guard|protect)\b/i.test(lo)) {
      let target = 'base';
      const campMatch = lo.match(/\bnearest[_ ](\w+)[_ ]camp\b/);
      if (campMatch) target = `nearest_${campMatch[1]}_camp`;
      out.push({ action: 'defend', target });
      return true;
    }

    // Attack enemies / nexus
    if (/\b(attack enemies|attack enemy|fight enemies|attack players)\b/i.test(lo)) {
      out.push({ action: 'attack_enemies' });
      return true;
    }
    if (/\b(nexus|enemy base|throne)\b/i.test(lo)) {
      out.push({ action: 'attack_enemies' }); // will path to nexus area and fight
      return true;
    }

    // Bootstrap / produce animal: "get skulls", "make gnomes", etc.
    const animalPatterns: [RegExp, string][] = [
      [/gnome|nome|home/i, 'gnome'], [/turtle/i, 'turtle'], [/skull/i, 'skull'], [/spider/i, 'spider'],
      [/hyena|hyenna|hi\s?ena|hyna|hiena|wolf/i, 'hyena'], [/panda/i, 'panda'], [/lizard/i, 'lizard'],
      [/minotaur|minor\s?tour|minator/i, 'minotaur'], [/shaman|showman|shayman|sherman/i, 'shaman'], [/troll/i, 'troll'], [/rogue|robe|road/i, 'rogue'],
    ];
    if (/\b(get|make|take|produce|spawn|create|breed|train|bootstrap)\b/i.test(lo) && !/\bcamp\b/i.test(lo)) {
      for (const [pat, name] of animalPatterns) {
        if (pat.test(lo)) {
          const cost = SPAWN_COSTS[name];
          if (cost) {
            const deliverTo = `nearest_${name}_camp`;
            out.push({ action: 'attack_camp', targetAnimal: name, qualifier: 'nearest' });
            if (cost.type === 'meat') out.push({ action: 'hunt' });
            else if (cost.type === 'crystal') out.push({ action: 'hunt', targetType: 'minotaur' });
            out.push({ action: 'seek_resource', resourceType: cost.type });
            out.push({ action: 'deliver', target: deliverTo });
            return true;
          }
        }
      }
    }

    // Attack camp
    if (/\b(attack|capture|take|raid|fight)\b/i.test(lo)) {
      for (const [pat, name] of animalPatterns) {
        if (pat.test(lo)) {
          out.push({ action: 'attack_camp', targetAnimal: name, qualifier: 'nearest' });
          return true;
        }
      }
      // Generic camp attack
      if (/\bcamp\b/i.test(lo)) {
        out.push({ action: 'attack_camp', qualifier: 'nearest' });
        return true;
      }
    }

    // Scout
    if (/\b(scout|explore|recon)\b/i.test(lo)) {
      out.push({ action: 'scout' });
      return true;
    }

    // Gather / collect
    if (/\b(gather|collect|farm|forage|harvest)\b/i.test(lo)) {
      let resType: ResourceType = 'carrot';
      if (/meat|flesh/i.test(lo)) resType = 'meat';
      else if (/crystal|gem/i.test(lo)) resType = 'crystal';
      if (/meat|flesh/i.test(lo) || /crystal|gem/i.test(lo)) {
        out.push({ action: 'hunt', targetType: resType === 'crystal' ? 'minotaur' : undefined });
      }
      out.push({ action: 'seek_resource', resourceType: resType });
      out.push({ action: 'deliver', target: 'base' });
      return true;
    }

    // Hunt
    if (/\bhunt\b/i.test(lo)) {
      out.push({ action: 'hunt' });
      return true;
    }

    return false;
  }

  private executeLocalCommand(text: string, team: 1 | 2) {
    const lo = text.toLowerCase();
    const subject = this.selectedHoard; // always use selected hoard
    const base = team === 1 ? P1_BASE : P2_BASE;

    // Cancel active plans when a new local command is issued
    this.cancelPlansForGroup(subject, team);

    // Local modifier parsing fallback
    const localMods: { formation?: string | null; caution?: string | null; pacing?: string | null } = {};
    let hasLocalMods = false;
    if (/\b(spread out|fan out|scatter|don'?t clump)\b/i.test(lo)) { localMods.formation = 'spread'; hasLocalMods = true; }
    if (/\b(group up|stick together|stay close|cluster|bunch up)\b/i.test(lo)) { localMods.formation = 'tight'; hasLocalMods = true; }
    if (/\b(play safe|be careful|careful|don'?t die|stay alive|cautious)\b/i.test(lo)) { localMods.caution = 'safe'; hasLocalMods = true; }
    if (/\b(go hard|no mercy|be aggressive|aggressive|attack everything)\b/i.test(lo)) { localMods.caution = 'aggressive'; hasLocalMods = true; }
    if (/\b(rush|hurry|go fast|faster)\b/i.test(lo) && !/\brush (the |their |enemy )?(base|nexus|camp)/i.test(lo)) { localMods.pacing = 'rush'; hasLocalMods = true; }
    if (/\b(be efficient|efficient|smart|one at a time)\b/i.test(lo)) { localMods.pacing = 'efficient'; hasLocalMods = true; }
    if (/\b(back to normal|reset (modifiers|behavior)|normal formation|stop spreading|stop grouping)\b/i.test(lo)) {
      localMods.formation = null; localMods.caution = null; localMods.pacing = null; hasLocalMods = true;
    }
    if (hasLocalMods) this.applyModifiers(localMods, subject, team);

    // ─── "THEN" SPLITTING — compound commands like "equip sword then defend" ───
    const thenParts = lo.split(/\b(?:and then|after that|then)\b/).map(s => s.trim()).filter(Boolean);
    if (thenParts.length >= 2) {
      const allSteps: WorkflowStep[] = [];
      let loopFromIdx = 0;
      let valid = true;
      for (let pi = 0; pi < thenParts.length; pi++) {
        const part = thenParts[pi];
        const before = allSteps.length;
        // Try to parse each part into steps
        if (this.parseLocalSteps(part, allSteps, team)) {
          if (pi === 1) loopFromIdx = before; // second part = loop start
        } else {
          valid = false;
          break;
        }
      }
      if (valid && allSteps.length >= 2) {
        // Check preconditions
        const preErr = this.checkPreconditions(allSteps, team);
        if (preErr) { this.showFeedback(preErr.error, '#FF6B6B'); return; }

        const sel = this.units.filter(u => u.team === team && !u.dead && (subject === 'all' || u.type === subject));
        if (sel.length === 0) { this.showFeedback(`No ${subject}!`, '#FF6B6B'); return; }

        // Safety net: attack_camp + deliver to camp → force loopFrom: 0 (camp safeguard)
        const hasAtkCamp = allSteps.some(s => s.action === 'attack_camp');
        const delToCamp = allSteps.some(s => s.action === 'deliver' && 'target' in s && (s as { target: string }).target.includes('_camp'));
        if (hasAtkCamp && delToCamp) loopFromIdx = 0;
        const wf: HWorkflow = { steps: allSteps, currentStep: 0, label: thenParts.join(' → '), loopFrom: Math.max(0, Math.min(loopFromIdx, allSteps.length - 1)), playedOnce: false };
        for (const u of sel) { u.loop = { ...wf, currentStep: 0 }; }
        if (subject === 'all') {
          const types = new Set(sel.map(u => u.type));
          for (const t of types) this.groupWorkflows[`${t}_${team}`] = wf;
        } else {
          this.groupWorkflows[`${subject}_${team}`] = wf;
        }
        const hasAtkStep = allSteps.some(s => s.action === 'attack_camp' || s.action === 'attack_enemies' || s.action === 'kill_only');
        this.unitReact(hasAtkStep ? 'charge' : 'yes', sel);
        this.showFeedback(`${wf.label}!`, '#45E6B0');
        return;
      }
    }

    // Equipment commands: "get a pickaxe and mine", "grab swords and attack", "equip boots"
    const equipNames = ['pickaxe', 'sword', 'shield', 'boots', 'banner'];
    const eqAliasMap: Record<string, string> = {
      'pick axe': 'pickaxe', 'pick acts': 'pickaxe', 'pickets': 'pickaxe', 'pic axe': 'pickaxe',
      'batter': 'banner', 'manner': 'banner', 'banter': 'banner',
    };
    const equipMatch = lo.match(/\b(?:get|grab|equip|pick up)\s+(?:a\s+)?(.+?)(?:\s+(?:then|and|after)\b|$)/i);
    if (equipMatch) {
      let eqName = equipMatch[1].toLowerCase().trim();
      if (eqAliasMap[eqName]) eqName = eqAliasMap[eqName];
      const eqDef = EQUIPMENT.find(e => e.id === eqName || e.name.toLowerCase() === eqName || eqName.startsWith(e.id));
      if (eqDef) {
        const sel = this.units.filter(u => u.team === team && !u.dead && (subject === 'all' || u.type === subject));
        if (sel.length === 0) { this.showFeedback(`No ${subject}!`, '#FF6B6B'); return; }

        // Build workflow: equip step + inferred action
        const steps: WorkflowStep[] = [{ action: 'equip', equipmentType: eqDef.id }];

        // Infer the action from the rest of the command
        if (/\bmine\b/i.test(lo)) {
          steps.push({ action: 'mine' });
          steps.push({ action: 'deliver', target: 'base' });
        } else if (/\battack\b.*\bnexus\b|\bnexus\b/i.test(lo)) {
          steps.push({ action: 'attack_enemies' });
        } else if (/\battack\b|\bfight\b|\bcharge\b/i.test(lo)) {
          // Check for camp target
          let campAnimal: string | undefined;
          for (const [pat, name] of [
            [/gnome|nome|home/i, 'gnome'], [/turtle/i, 'turtle'], [/skull/i, 'skull'], [/spider/i, 'spider'],
            [/hyena|hyenna|hi\s?ena|hyna|hiena|wolf/i, 'hyena'], [/panda/i, 'panda'], [/lizard/i, 'lizard'],
            [/minotaur|minor\s?tour|minator/i, 'minotaur'], [/shaman|showman|shayman|sherman/i, 'shaman'], [/troll/i, 'troll'],
          ] as [RegExp, string][]) {
            if (pat.test(lo)) { campAnimal = name; break; }
          }
          if (campAnimal) {
            steps.push({ action: 'attack_camp', targetAnimal: campAnimal, qualifier: 'nearest' });
          } else {
            steps.push({ action: 'attack_enemies' });
          }
        } else if (/\bdefend\b|\bguard\b|\bprotect\b/i.test(lo)) {
          steps.push({ action: 'defend', target: 'base' });
        } else if (/\bgather\b|\bcollect\b|\bforage\b|\bharvest\b/i.test(lo)) {
          let resType: ResourceType = 'carrot';
          if (/meat|flesh/i.test(lo)) resType = 'meat';
          else if (/crystal|gem/i.test(lo)) resType = 'crystal';
          steps.push({ action: 'seek_resource', resourceType: resType });
          steps.push({ action: 'deliver', target: 'base' });
        } else if (/\bscout\b|\bexplore\b/i.test(lo)) {
          steps.push({ action: 'scout' });
        } else {
          // Default action based on equipment type
          if (eqDef.id === 'pickaxe') { steps.push({ action: 'mine' }); steps.push({ action: 'deliver', target: 'base' }); }
          else if (eqDef.id === 'sword') { steps.push({ action: 'attack_enemies' }); }
          else if (eqDef.id === 'shield') { steps.push({ action: 'defend', target: 'base' }); }
          else if (eqDef.id === 'boots') { steps.push({ action: 'seek_resource', resourceType: 'carrot' }); steps.push({ action: 'deliver', target: 'base' }); }
          else if (eqDef.id === 'banner') { steps.push({ action: 'attack_enemies' }); }
        }

        const preErr = this.checkPreconditions(steps, team);
        if (preErr) { this.showFeedback(preErr.error, '#FF6B6B'); return; }

        const wf: HWorkflow = { steps, currentStep: 0, label: `equip ${eqDef.name} + action`, loopFrom: 1, playedOnce: false };
        for (const u of sel) { u.loop = { ...wf, currentStep: 0 }; }
        if (subject === 'all') {
          const types = new Set(sel.map(u => u.type));
          for (const t of types) this.groupWorkflows[`${t}_${team}`] = wf;
        } else {
          this.groupWorkflows[`${subject}_${team}`] = wf;
        }
        this.unitReact('yes', sel);
        this.showFeedback(`Equipping ${eqDef.emoji}!`, '#45E6B0');
        return;
      }
    }

    // Mine commands: "mine metal", "go mine", "start mining"
    if (/\b(mine|mining)\b/i.test(lo) && !/\bunlock\b|\bbuy\b/i.test(lo)) {
      const sel = this.units.filter(u => u.team === team && !u.dead && (subject === 'all' || u.type === subject));
      if (sel.length === 0) { this.showFeedback(`No ${subject}!`, '#FF6B6B'); return; }

      const steps: WorkflowStep[] = [
        { action: 'equip', equipmentType: 'pickaxe' },
        { action: 'mine' },
        { action: 'deliver', target: 'base' },
      ];
      const preErr = this.checkPreconditions(steps, team);
      if (preErr) { this.showFeedback(preErr.error, '#FF6B6B'); return; }
      const wf: HWorkflow = { steps, currentStep: 0, label: 'mine metal', loopFrom: 1, playedOnce: false };
      for (const u of sel) { u.loop = { ...wf, currentStep: 0 }; }
      if (subject === 'all') {
        const types = new Set(sel.map(u => u.type));
        for (const t of types) this.groupWorkflows[`${t}_${team}`] = wf;
      } else {
        this.groupWorkflows[`${subject}_${team}`] = wf;
      }
      this.unitReact('yes', sel);
      this.showFeedback('Mining!', '#45E6B0');
      return;
    }

    // "get/make/take [animal]" commands — ALWAYS use full bootstrap workflow
    const makeMatch = lo.match(/\b(?:go\s+)?(?:get|make|take|produce|spawn|create|breed|train|need|want)\s+(?:me\s+)?(?:some\s+)?(?:more\s+)?(\w+)/i);
    if (makeMatch) {
      const animalPatterns: [RegExp, string][] = [
        [/gnome(s)?|nome(s)?/i, 'gnome'], [/turtle(s)?/i, 'turtle'],
        [/skull(s)?/i, 'skull'], [/spider(s)?/i, 'spider'], [/hyena(s)?|hyenna(s)?|hi\s?ena(s)?|hyna(s)?|hiena(s)?|wolf|wolve(s)?/i, 'hyena'],
        [/panda(s)?/i, 'panda'], [/lizard(s)?/i, 'lizard'],
        [/minotaur(s)?|minor\s?tour(s)?|minator(s)?/i, 'minotaur'], [/shaman(s)?|showman|shayman|sherman/i, 'shaman'], [/troll(s)?/i, 'troll'],
      ];
      let animal: string | null = null;
      for (const [pat, name] of animalPatterns) {
        if (pat.test(makeMatch[1])) { animal = name; break; }
      }
      if (animal) {
        const cost = SPAWN_COSTS[animal];
        if (cost) {
          const sel = this.units.filter(u => u.team === team && !u.dead && (subject === 'all' || u.type === subject));
          if (sel.length === 0) { this.showFeedback(`No ${subject}!`, '#FF6B6B'); return; }

          const wf = makeBootstrapWorkflow(animal);
          // "safely" → swap seek_resource for collect and set safe modifier
          if (/\bsafe(ly)?\b|\bcareful(ly)?\b/i.test(lo)) {
            for (const s of wf.steps) {
              if (s.action === 'seek_resource') {
                (s as any).action = 'collect';
              }
            }
            this.applyModifiers({ caution: 'safe' }, subject, team);
          }
          for (const u of sel) { u.loop = { ...wf, currentStep: 0 }; }
          // Store as group workflow for future spawns
          if (subject === 'all') {
            const types = new Set(sel.map(u => u.type));
            for (const t of types) this.groupWorkflows[`${t}_${team}`] = wf;
          } else {
            this.groupWorkflows[`${subject}_${team}`] = wf;
          }
          this.unitReact('yes', sel);
          const emoji = ANIMALS[animal]?.emoji || '';
          this.showFeedback(`Making ${emoji}${cap(animal)}!`, '#45E6B0');
          return;
        }
      }
    }

    // Scout / explore / recon commands — with optional region targeting
    if (/\b(scout|explore|recon|reconnaissance|check out|see what|look around|look over)\b/i.test(lo)) {
      const sel = this.units.filter(u => u.team === team && !u.dead && (subject === 'all' || u.type === subject));
      if (sel.length === 0) { this.showFeedback(`No ${subject}!`, '#FF6B6B'); return; }

      // Parse optional region from the command
      let sx: number | undefined, sy: number | undefined;
      let label = 'scouting';
      // Corners
      if (/\b(top|upper)\s*(left|west)\b|north\s*west\b/i.test(lo)) { sx = WORLD_W * 0.15; sy = WORLD_H * 0.15; label = 'scouting NW'; }
      else if (/\b(top|upper)\s*(right|east)\b|north\s*east\b/i.test(lo)) { sx = WORLD_W * 0.85; sy = WORLD_H * 0.15; label = 'scouting NE'; }
      else if (/\b(bottom|lower)\s*(left|west)\b|south\s*west\b/i.test(lo)) { sx = WORLD_W * 0.15; sy = WORLD_H * 0.85; label = 'scouting SW'; }
      else if (/\b(bottom|lower)\s*(right|east)\b|south\s*east\b/i.test(lo)) { sx = WORLD_W * 0.85; sy = WORLD_H * 0.85; label = 'scouting SE'; }
      // Edges
      else if (/\b(top|north|up)\b/i.test(lo) && !/\b(left|right|east|west)\b/i.test(lo)) { sx = WORLD_W * 0.5; sy = WORLD_H * 0.15; label = 'scouting N'; }
      else if (/\b(bottom|south|down)\b/i.test(lo) && !/\b(left|right|east|west)\b/i.test(lo)) { sx = WORLD_W * 0.5; sy = WORLD_H * 0.85; label = 'scouting S'; }
      else if (/\b(left|west)\b/i.test(lo) && !/\b(top|bottom|north|south|upper|lower)\b/i.test(lo)) { sx = WORLD_W * 0.15; sy = WORLD_H * 0.5; label = 'scouting W'; }
      else if (/\b(right|east)\b/i.test(lo) && !/\b(top|bottom|north|south|upper|lower)\b/i.test(lo)) { sx = WORLD_W * 0.85; sy = WORLD_H * 0.5; label = 'scouting E'; }
      // Center
      else if (/\b(center|middle|mid)\b/i.test(lo)) { sx = WORLD_W * 0.5; sy = WORLD_H * 0.5; label = 'scouting center'; }
      // "over here" / "over there" / "this area" / "that corner" — use camera center as target
      else if (/\b(over here|over there|this area|this corner|that area|that corner|around here|nearby)\b/i.test(lo)) {
        const cam = this.cameras.main;
        sx = cam.scrollX + cam.width / 2;
        sy = cam.scrollY + cam.height / 2;
        label = 'scouting area';
      }

      const scoutStep: WorkflowStep = sx !== undefined && sy !== undefined
        ? { action: 'scout', x: sx, y: sy }
        : { action: 'scout' };
      const wf: HWorkflow = { steps: [scoutStep], currentStep: 0, label, loopFrom: 0, playedOnce: false };
      for (const u of sel) { u.loop = { ...wf, currentStep: 0 }; }
      if (subject === 'all') {
        const types = new Set(sel.map(u => u.type));
        for (const t of types) this.groupWorkflows[`${t}_${team}`] = wf;
      } else {
        this.groupWorkflows[`${subject}_${team}`] = wf;
      }
      this.unitReact('yes', sel);
      this.showFeedback(`${label}!`, '#45E6B0');
      return;
    }

    // Collect safely (avoid enemies) commands
    if (/\b(collect|pick\s*up)\b.*\b(safe|avoid)/i.test(lo) || /\bcollect\s+(meat|carrot|crystal)/i.test(lo)) {
      let resType: ResourceType = 'carrot';
      if (/meat|flesh/i.test(lo)) resType = 'meat';
      else if (/crystal|gem|diamond/i.test(lo)) resType = 'crystal';

      const sel = this.units.filter(u => u.team === team && !u.dead && (subject === 'all' || u.type === subject));
      if (sel.length === 0) { this.showFeedback(`No ${subject}!`, '#FF6B6B'); return; }

      const wf: HWorkflow = { steps: [{ action: 'collect', resourceType: resType }], currentStep: 0, label: `safe ${resType} collect`, loopFrom: 0, playedOnce: false };
      for (const u of sel) { u.loop = { ...wf, currentStep: 0 }; }
      if (subject === 'all') {
        const types = new Set(sel.map(u => u.type));
        for (const t of types) this.groupWorkflows[`${t}_${team}`] = wf;
      } else {
        this.groupWorkflows[`${subject}_${team}`] = wf;
      }
      this.unitReact('yes', sel);
      this.showFeedback(`Collecting ${RESOURCE_EMOJI[resType]}!`, '#45E6B0');
      return;
    }

    // Kill only (fight but skip drops) commands
    if (/\b(kill\s*only|just\s*kill|clear\s*animals|kill\s*wilds)\b/i.test(lo)) {
      const sel = this.units.filter(u => u.team === team && !u.dead && (subject === 'all' || u.type === subject));
      if (sel.length === 0) { this.showFeedback(`No ${subject}!`, '#FF6B6B'); return; }

      let targetType: string | undefined;
      if (/elite|minotaur/i.test(lo)) targetType = 'minotaur';

      const step: WorkflowStep = targetType
        ? { action: 'kill_only', targetType }
        : { action: 'kill_only' };
      const wf: HWorkflow = { steps: [step], currentStep: 0, label: 'kill only', loopFrom: 0, playedOnce: false };
      for (const u of sel) { u.loop = { ...wf, currentStep: 0 }; }
      if (subject === 'all') {
        const types = new Set(sel.map(u => u.type));
        for (const t of types) this.groupWorkflows[`${t}_${team}`] = wf;
      } else {
        this.groupWorkflows[`${subject}_${team}`] = wf;
      }
      this.unitReact('charge', sel);
      this.showFeedback('Kill mode!', '#45E6B0');
      return;
    }

    // Gather commands (generic resource gathering)
    if (/\b(gather|collect|farm|forage|harvest|get food)\b/i.test(lo)) {
      let resType: ResourceType = 'carrot';
      if (/meat|flesh|kill/i.test(lo)) resType = 'meat';
      else if (/crystal|gem|diamond|elite/i.test(lo)) resType = 'crystal';

      const sel = this.units.filter(u => u.team === team && !u.dead && (subject === 'all' || u.type === subject));
      if (sel.length === 0) { this.showFeedback(`No ${subject}!`, '#FF6B6B'); return; }

      let wf: HWorkflow;
      if (/\bsafe(ly)?\b|\bcareful(ly)?\b/i.test(lo)) {
        wf = { steps: [{ action: 'collect', resourceType: resType }], currentStep: 0, label: `safe ${resType} gather`, loopFrom: 0, playedOnce: false };
        this.applyModifiers({ caution: 'safe' }, subject, team);
      } else {
        wf = makeGatherWorkflow(resType, 'base');
      }
      for (const u of sel) { u.loop = { ...wf, currentStep: 0 }; }
      if (subject === 'all') {
        const types = new Set(sel.map(u => u.type));
        for (const t of types) this.groupWorkflows[`${t}_${team}`] = wf;
      } else {
        this.groupWorkflows[`${subject}_${team}`] = wf;
      }
      this.unitReact('yes', sel);
      this.showFeedback(`Gathering ${RESOURCE_EMOJI[resType]}!`, '#45E6B0');
      return;
    }

    // "unlock [equipment]" / "buy [equipment]" / "research [equipment]"
    const unlockMatch = lo.match(/(?:unlock|buy|research|forge|upgrade)\s+(.+)/i);
    if (unlockMatch) {
      const query = unlockMatch[1].toLowerCase().trim();
      const match = EQUIPMENT.find(e =>
        e.name.toLowerCase().includes(query) || e.id.includes(query.replace(/\s+/g, '_'))
      );
      if (match) {
        const curLevel = this.getEquipLevel(team, match.id);
        const success = this.unlockEquipment(team, match.id);
        if (success) {
          const newLevel = this.getEquipLevel(team, match.id);
          const msg = curLevel === 0 ? `${match.emoji} ${match.name} unlocked!` : `${match.emoji} ${match.name} upgraded to Lvl ${newLevel}!`;
          this.showFeedback(msg, '#FFD700');
        } else if (curLevel >= MAX_EQUIP_LEVEL) {
          this.showFeedback(`${match.name} already max level!`, '#FF6B6B');
        } else {
          // Insufficient resources — auto-create an advanced plan to gather and unlock
          this.cancelPlansForGroup(subject, team);
          const plan = this.resolvePlan(
            { type: 'unlock_equipment', equipment: match.id },
            team, subject, text,
          );
          if (plan) {
            this.activePlans.push(plan);
            const firstPhase = plan.phases[0];
            if (firstPhase?.workflow) {
              this.assignWorkflowToGroup(firstPhase.workflow, subject, team);
            }
            this.showFeedback(`Plan: ${plan.goalLabel} (${plan.phases.length} phases)`, '#45E6B0');
            console.log('[AdvancedPlan] Auto-created from local unlock:', plan.id, plan.phases.map(p => p.label));
          } else {
            const nextMult = EQUIP_LEVEL_COST_MULT[curLevel + 1];
            const needed = Object.entries(match.cost).map(([r, a]) => `${Math.ceil(a! * nextMult)}${RESOURCE_EMOJI[r as ResourceType]}`).join(' ');
            this.sfx.playGlobal('no_resources');
            this.showFeedback(`Need ${needed}!`, '#FF6B6B');
          }
        }
        return;
      }
    }

    let tx = 0, ty = 0, found = false;

    // Nexus / enemy base
    if (/nexus|throne|enemy\s*base/i.test(lo)) {
      const n = this.nexuses.find(n2 => n2.team !== team)!;
      tx = n.x; ty = n.y; found = true;
    }

    // Home / defend / retreat
    if (!found && /\b(base|home|retreat|defend)\b/i.test(lo)) {
      tx = base.x; ty = base.y; found = true;
    }

    // Center / middle
    if (!found && /center|middle/i.test(lo)) {
      tx = WORLD_W / 2; ty = WORLD_H / 2; found = true;
    }

    // Directional: "go left", "move up", "head right", "go north", etc.
    if (!found) {
      const dirMatch = lo.match(/\b(?:go|move|head|run|walk|march|push)\s+(left|right|up|down|north|south|east|west|forward|back|backward)\b/)
        || lo.match(/^(left|right|up|down|north|south|east|west|forward|back|backward)$/);
      if (dirMatch) {
        const dir = dirMatch[1];
        const sel = this.units.filter(u => u.team === team && !u.dead && (subject === 'all' || u.type === subject));
        let cx = base.x, cy = base.y;
        if (sel.length > 0) {
          cx = sel.reduce((s, u) => s + u.x, 0) / sel.length;
          cy = sel.reduce((s, u) => s + u.y, 0) / sel.length;
        }
        const dist = 600;
        let dx = 0, dy = 0;
        if (dir === 'left' || dir === 'west') dx = -1;
        else if (dir === 'right' || dir === 'east') dx = 1;
        else if (dir === 'up' || dir === 'north' || dir === 'forward') dy = -1;
        else if (dir === 'down' || dir === 'south' || dir === 'back' || dir === 'backward') dy = 1;
        tx = Math.max(50, Math.min(WORLD_W - 50, cx + dx * dist));
        ty = Math.max(50, Math.min(WORLD_H - 50, cy + dy * dist));
        found = true;
      }
    }

    // Match camp by unique name ("bouncy", "wailing", "stinger", etc.)
    if (!found) {
      for (const c of this.camps) {
        const cleanName = c.name.replace(/^[^\w]+/, '').toLowerCase();
        const words = cleanName.split(/\s+/).filter(w => w.length > 2);
        if (words.some(w => lo.includes(w))) {
          tx = c.x; ty = c.y; found = true; break;
        }
      }
    }

    // Match camp by unit type keyword: "skull camp" → nearest unowned skull camp
    if (!found) {
      const animalPatterns: [RegExp, string][] = [
        [/gnome(s)?|nome(s)?/i, 'gnome'], [/turtle(s)?/i, 'turtle'],
        [/skull(s)?/i, 'skull'], [/spider(s)?/i, 'spider'], [/hyena(s)?|hyenna(s)?|hi\s?ena(s)?|hyna(s)?|hiena(s)?|wolf|wolve(s)?/i, 'hyena'],
        [/panda(s)?/i, 'panda'], [/lizard(s)?/i, 'lizard'],
        [/minotaur(s)?|minor\s?tour(s)?|minator(s)?/i, 'minotaur'], [/shaman(s)?|showman|shayman|sherman/i, 'shaman'], [/troll(s)?/i, 'troll'],
      ];
      for (const [pat, name] of animalPatterns) {
        if (pat.test(lo)) {
          const cs = this.camps.filter(c => c.animalType === name && c.owner !== team)
            .sort((a, b) => pdist2(a, base) - pdist2(b, base));
          if (cs.length > 0) { tx = cs[0].x; ty = cs[0].y; found = true; break; }
        }
      }
    }

    // Fallback: nearest unowned camp
    if (!found && /nearest|closest|camp/i.test(lo)) {
      const cs = this.camps.filter(c => c.owner !== team).sort((a, b) => pdist2(a, base) - pdist2(b, base));
      if (cs.length > 0) { tx = cs[0].x; ty = cs[0].y; found = true; }
    }

    if (!found) {
      const confSel = this.units.filter(u => u.team === team && !u.dead && (subject === 'all' || u.type === subject));
      this.unitReact('confused', confSel);
      this.showFeedback(this.getContextualHint(team), '#FFD93D');
      return;
    }

    const sel = this.units.filter(u => u.team === team && !u.dead && (subject === 'all' || u.type === subject));
    if (sel.length === 0) {
      this.showFeedback(`No ${subject}!`, '#FF6B6B');
      return;
    }
    for (const u of sel) { u.loop = null; }
    // Clear group workflow so new spawns don't inherit old loop
    if (subject === 'all') {
      for (const key of Object.keys(this.groupWorkflows)) {
        if (key.endsWith(`_${team}`)) delete this.groupWorkflows[key];
      }
    } else {
      delete this.groupWorkflows[`${subject}_${team}`];
    }
    this.sendUnitsTo(sel, tx, ty, true);
    const localIsAttack = /nexus|throne|enemy|camp|attack|fight|charge/i.test(lo);
    this.unitReact(localIsAttack ? 'charge' : 'yes', sel);
    this.showFeedback('Moving out!', '#45E6B0');
  }

  private getContextualHint(team: 1 | 2): string {
    const myUnits = this.units.filter(u => u.team === team && !u.dead);
    const myCamps = this.camps.filter(c => c.owner === team);
    const myNex = this.nexuses.find(n => n.team === team);
    const enemyNex = this.nexuses.find(n => n.team !== team);

    if (myUnits.length === 0 && myCamps.length === 0)
      return "Say 'get started' to spawn your first gnomes!";
    if (myUnits.length === 0)
      return "No units! Say 'make gnomes' to spawn more.";
    if (myCamps.length === 0)
      return "No camps! Say 'attack nearest camp' to capture one.";
    if (myNex && myNex.hp < myNex.maxHp * 0.5)
      return "Base in danger! Say 'defend base' or 'retreat'.";
    if (myUnits.length > 10 && enemyNex && enemyNex.hp > 0)
      return "Strong army! Say 'attack nexus' to win!";
    return "Try: 'make gnomes', 'gather carrots', or 'attack camp'.";
  }

  // ─── THOUGHT BUBBLES ──────────────────────────────────────
  // Shows a speech bubble above selected units when they receive a command.

  private static readonly CANNED_REACTIONS: Record<string, Record<string, string[]>> = {
    yes: {
      gnome: ['Okie dokie!', 'On it!', 'Yippee!', '*salutes tiny*'],
      turtle: ['Slow and steady...', 'Mmm, understood.', '*nods heavily*'],
      skull: ['*rattles bones*', 'The dead obey.', 'As you wish...'],
      spider: ['*clicks eagerly*', 'Yesss...', '*skitters off*'],
      hyena: ['Heh, got it!', '*barks*', 'On the hunt!'],
      rogue: ['...understood.', '*vanishes*', 'Silent and swift.'],
      panda: ['Hai!', '*bows*', 'With honor.', 'Bamboo later...'],
      lizard: ['*hisses agreement*', 'Sss, fine.', '*chirps*'],
      minotaur: ['HMPH. Fine.', '*snorts*', 'It shall be done.'],
      shaman: ['The spirits agree...', '*chants softly*', 'So mote it be.'],
      troll: ['Uhhh... ok!', 'TROLL DO THING!', '*grunts*', 'Me go now.'],
    },
    charge: {
      gnome: ['CHAAARGE!', 'Tiny but fierce!', 'For the base!'],
      turtle: ['SHELL SHOCK!', '*charges slowly*', 'Unstoppable!'],
      skull: ['TO DEATH!', '*war rattle*', 'BONES WILL FLY!'],
      spider: ['FEAST TIME!', '*screeches*', 'BITE BITE BITE!'],
      hyena: ['AROOOOO!', 'GET EM!', '*throws bone*'],
      rogue: ['From the shadows...', '*blade gleams*', 'Strike hard.'],
      panda: ['HIYAAA!', 'No mercy!', '*staff spins*'],
      lizard: ['RAZOR SPIN!', '*hissing fury*', 'SHRED THEM!'],
      minotaur: ['RAAAAAGH!', 'CRUSH THEM!', 'STAMPEDE!'],
      shaman: ['DARK POWER!', '*orbs crackle*', 'BURN THEM!'],
      troll: ['SMASH TIME!', 'TROLL ANGRY!', 'BIG BONK!'],
    },
    confused: {
      gnome: ['Huh?', 'Wha...?', '*scratches head*'],
      turtle: ['...what?', '*blinks slowly*', 'Hmm?'],
      skull: ['???', '*skull tilts*', 'The dead are confused.'],
      spider: ['*confused clicking*', '???', '*tilts body*'],
      hyena: ['Bark?', '*head tilt*', 'What say?'],
      rogue: ['...come again?', '*raises eyebrow*', '???'],
      panda: ['Nani?', '*confused grunt*', 'Hm?'],
      lizard: ['*confused trill*', '???', '*blinks*'],
      minotaur: ['HUH?!', '*angry snort*', 'SPEAK CLEAR!'],
      shaman: ['The spirits are puzzled.', '*static*', '???'],
      troll: ['Troll no understand...', 'Wut?', 'Head hurt...'],
    },
  };

  private getCannedReaction(reaction: 'yes' | 'charge' | 'confused', unitType: string): string {
    const pool = HordeScene.CANNED_REACTIONS[reaction]?.[unitType];
    if (!pool || pool.length === 0) return reaction === 'charge' ? 'CHARGE!' : reaction === 'confused' ? '???' : 'Roger!';
    return pool[Math.floor(Math.random() * pool.length)];
  }

  /** Play reaction sound + show thought bubbles on affected units */
  private unitReact(reaction: 'yes' | 'charge' | 'confused', units: HUnit[]) {
    this.sfx.playReaction(reaction, units);
    this.showCannedThoughtBubbles(units, reaction);
  }

  private showCannedThoughtBubbles(units: HUnit[], reaction: 'yes' | 'charge' | 'confused') {
    if (units.length === 0) return;
    const shuffled = units.slice().sort(() => Math.random() - 0.5);
    const picks = shuffled.slice(0, Math.min(3, shuffled.length));
    for (const u of picks) {
      this.showThoughtBubble(u, this.getCannedReaction(reaction, u.type));
    }
  }

  private showThoughtBubbles(units: HUnit[], text: string) {
    if (!text || units.length === 0) return;
    const shuffled = units.slice().sort(() => Math.random() - 0.5);
    const picks = shuffled.slice(0, Math.min(3, shuffled.length));
    for (const u of picks) this.showThoughtBubble(u, text);
  }

  private showThoughtBubble(u: HUnit, text: string) {
    // Remove existing bubble on this unit
    this.thoughtBubbles = this.thoughtBubbles.filter(b => {
      if (b.unitId === u.id) { b.container.destroy(); return false; }
      return true;
    });

    const sx = u.sprite ? u.sprite.x : u.x;
    const sy = u.sprite ? u.sprite.y : u.y;
    const container = this.add.container(sx, sy - 40).setDepth(600);

    const bubbleW = Math.min(text.length * 6.5 + 20, 150);
    const bubbleH = 26;
    const bg = this.add.graphics();
    bg.fillStyle(0xFFFFFF, 0.92);
    bg.fillRoundedRect(-bubbleW / 2, -bubbleH / 2, bubbleW, bubbleH, 8);
    bg.lineStyle(1.5, 0x666666, 0.5);
    bg.strokeRoundedRect(-bubbleW / 2, -bubbleH / 2, bubbleW, bubbleH, 8);
    bg.fillStyle(0xFFFFFF, 0.92);
    bg.fillTriangle(-4, bubbleH / 2, 4, bubbleH / 2, 0, bubbleH / 2 + 7);
    container.add(bg);

    const txt = this.add.text(0, -1, text, {
      fontFamily: '"Fredoka", "Segoe UI", sans-serif',
      fontSize: '10px',
      fontStyle: 'bold',
      color: '#333',
      align: 'center',
      wordWrap: { width: bubbleW - 10 },
    }).setOrigin(0.5).setDepth(601);
    container.add(txt);

    container.setScale(0);
    this.tweens.add({
      targets: container, scaleX: 1, scaleY: 1, duration: 200, ease: 'Back.easeOut',
    });

    this.thoughtBubbles.push({ container, unitId: u.id, timer: 3000 });
  }

  private updateThoughtBubbles(delta: number) {
    for (let i = this.thoughtBubbles.length - 1; i >= 0; i--) {
      const b = this.thoughtBubbles[i];
      b.timer -= delta;

      // Follow the unit
      const u = this.units.find(u2 => u2.id === b.unitId);
      if (u && u.sprite && !u.dead) {
        b.container.setPosition(u.sprite.x, u.sprite.y - 40);
      }

      // Fade out in last 500ms
      if (b.timer < 500) {
        b.container.setAlpha(b.timer / 500);
      }

      if (b.timer <= 0 || !u || u.dead) {
        b.container.destroy();
        this.thoughtBubbles.splice(i, 1);
      }
    }
  }

  // ─── FLOATING DAMAGE NUMBERS ────────────────────────────────
  // Style matches horde-overview.html: bold, float up, fade out, scale 1.2→0.7
  private dmgNumberPool: Phaser.GameObjects.Text[] = [];
  private dmgNumberIdx = 0;
  private readonly DMG_POOL_SIZE = 60;

  private spawnDmgNumber(x: number, y: number, amount: number, isPrimary: boolean, attacker: HUnit | null) {
    // Color based on attacker's team relative to viewer
    let color: string;
    if (!attacker) {
      color = '#dd88ff'; // tower/structure — purple
    } else if (attacker.team === 0) {
      color = '#ff9944'; // neutral/wild — orange
    } else if (attacker.team === this.myTeam) {
      color = '#5fdd5f'; // my team dealing damage — green
    } else {
      color = '#e04040'; // enemy dealing damage — red
    }
    const fontSize = isPrimary ? 14 : 11;
    const alpha = isPrimary ? 1 : 0.75;

    // Random scatter so overlapping hits don't stack
    const offsetX = (Math.random() - 0.5) * 24;
    const offsetY = (Math.random() - 0.5) * 8;
    const displayAmount = Math.ceil(amount);

    // Reuse pooled text objects to avoid GC pressure
    let txt: Phaser.GameObjects.Text;
    if (this.dmgNumberPool.length < this.DMG_POOL_SIZE) {
      txt = this.add.text(0, 0, '', {
        fontFamily: '"Fredoka", "Segoe UI", sans-serif',
        fontStyle: 'bold',
        fontSize: '14px',
        color: '#fff',
        stroke: '#000',
        strokeThickness: 3,
      }).setDepth(500).setOrigin(0.5);
      this.dmgNumberPool.push(txt);
    } else {
      txt = this.dmgNumberPool[this.dmgNumberIdx % this.DMG_POOL_SIZE];
      this.dmgNumberIdx++;
      this.tweens.killTweensOf(txt);
    }

    txt.setText(`-${displayAmount}`)
      .setPosition(x + offsetX, y + offsetY - 5)
      .setColor(color)
      .setFontSize(fontSize)
      .setAlpha(alpha)
      .setScale(isPrimary ? 1.3 : 1.0)
      .setVisible(true);

    // Animate: float up, shrink, fade — matching dmgFloat keyframes
    this.tweens.add({
      targets: txt,
      y: txt.y - 35,
      scaleX: isPrimary ? 0.7 : 0.5,
      scaleY: isPrimary ? 0.7 : 0.5,
      alpha: 0,
      duration: 750,
      ease: 'Cubic.easeOut',
      onComplete: () => { txt.setVisible(false); },
    });
  }

  private _lastFeedbackText: string | null = null;
  private showFeedback(msg: string, color: string) {
    this._lastFeedbackText = msg;
    const t = this.hudTexts['feedback'];
    if (!t) return;
    t.setText(msg).setColor(color).setAlpha(1);
    this.tweens.add({ targets: t, alpha: 0, duration: 3000, delay: 1000 });

    // Auto-log command outcome (skip intermediate "processing/sending" messages)
    if (this.pendingCommandText && msg !== 'Processing command...' && msg !== 'Sending command...') {
      this.logCommandHistory(this.pendingCommandText, msg, color);
      this.pendingCommandText = null;
    }
  }

  private logCommandHistory(command: string, outcome: string, color: string) {
    const secs = Math.floor(this.gameTime / 1000);
    const timeStr = `${Math.floor(secs / 60)}:${(secs % 60).toString().padStart(2, '0')}`;
    this.commandHistory.push({ command, outcome, color, time: secs });
    // Keep last 20 entries
    if (this.commandHistory.length > 20) this.commandHistory.shift();

  }

  private updateSelectionLabel() {
    // Update command area avatar to show selected hoard
    if (this.cmdAvatarEl) {
      const h = this.selectedHoard;
      if (h === 'all') {
        this.cmdAvatarEl.innerHTML = '<span style="font-size:32px;">\u2694\uFE0F</span>';
      } else {
        this.cmdAvatarEl.innerHTML = avatarImg(h, 64) || `<span style="font-size:44px;">${ANIMALS[h]?.emoji || '?'}</span>`;
      }
    }
    // Update voice orb avatar badge
    if (this.voiceOrb) {
      const h = this.selectedHoard;
      const html = h === 'all' ? undefined : (avatarImg(h, 36) || undefined);
      this.voiceOrb.showAvatar(h, html);
    }
    // Top bar is updated directly by updateTopBar() in the HUD cycle
  }

  // ─── BUFFS ──────────────────────────────────────────────────

  private getBuffs(team: 1 | 2) {
    let speed = 0, attack = 0, hp = 0;
    for (const c of this.camps) {
      if (c.owner !== team) continue;
      const s = c.buff.stat;
      if (s === 'speed') speed += c.buff.value;
      else if (s === 'attack') attack += c.buff.value;
      else if (s === 'hp') hp += c.buff.value;
      else if (s === 'all') { speed += c.buff.value; attack += c.buff.value; hp += c.buff.value; }
    }
    // Add event buffs
    const eb = this.getEventBuffs(team);
    attack += eb.attack;
    speed += eb.speed;
    // Add camp loot buffs
    for (const b of this.teamBuffs) {
      if (b.team !== team) continue;
      if (b.stat === 'speed') speed += b.amount;
      else if (b.stat === 'attack') attack += b.amount;
    }
    return { speed, attack, hp };
  }

  // ─── EDITOR LIVE SYNC ──────────────────────────────────────

  private setupEditorSync() {
    try {
      this.editorSyncChannel = new BroadcastChannel('horde-editor-sync');
    } catch {
      return; // BroadcastChannel not available
    }

    this.editorSyncChannel.onmessage = (event: MessageEvent) => {
      const msg = event.data;
      switch (msg.type) {
        case 'MAP_UPDATE':
          this.handleEditorMapUpdate(msg.map);
          break;
        case 'COMMAND':
          this.handleEditorCommand(msg.cmd, msg.mapDef);
          break;
        case 'PING':
          this.editorSyncChannel?.postMessage({ type: 'PONG', sceneActive: true });
          break;
      }
    };
  }

  private handleEditorMapUpdate(newMap: MapDef) {
    if (!newMap) return;

    // If game is running in default mode (no mapDef), store for reference
    // but only hot-apply positions if camp counts match
    const hadMapDef = !!this.mapDef;
    this.mapDef = newMap;

    // If the game was started without a map, we can only overlay —
    // structural changes (camp count) require a restart via the editor button
    if (!hadMapDef) return;

    // ── Update base/nexus positions ──
    const p1 = newMap.p1Base;
    const p2 = newMap.p2Base;
    if (this.nexuses.length >= 2) {
      const n1 = this.nexuses.find(n => n.team === 1);
      const n2 = this.nexuses.find(n => n.team === 2);
      if (n1 && (n1.x !== p1.x || n1.y !== p1.y)) {
        n1.x = p1.x; n1.y = p1.y;
        n1.container?.setPosition(p1.x, p1.y);
      }
      if (n2 && (n2.x !== p2.x || n2.y !== p2.y)) {
        n2.x = p2.x; n2.y = p2.y;
        n2.container?.setPosition(p2.x, p2.y);
      }
    }

    // ── Update camp positions ──
    // Map editor camp slots come in pairs (blue/red per slot).
    // activeCampDefs has 2 entries per slot + optional troll.
    // We match by index and update positions.
    const totalSlotCamps = newMap.campSlots.length * 2;
    for (let slotIdx = 0; slotIdx < newMap.campSlots.length; slotIdx++) {
      const slot = newMap.campSlots[slotIdx];
      const blueIdx = slotIdx * 2;
      const redIdx = slotIdx * 2 + 1;

      // Update activeCampDefs positions
      if (blueIdx < this.activeCampDefs.length) {
        this.activeCampDefs[blueIdx].x = slot.bluePos.x;
        this.activeCampDefs[blueIdx].y = slot.bluePos.y;
      }
      if (redIdx < this.activeCampDefs.length) {
        this.activeCampDefs[redIdx].x = slot.redPos.x;
        this.activeCampDefs[redIdx].y = slot.redPos.y;
      }

      // Update camp game objects
      if (blueIdx < this.camps.length) {
        const camp = this.camps[blueIdx];
        camp.x = slot.bluePos.x;
        camp.y = slot.bluePos.y;
        camp.area?.setPosition(slot.bluePos.x, slot.bluePos.y);
        camp.label?.setPosition(slot.bluePos.x, slot.bluePos.y - 55);
        camp.costLabel?.setPosition(slot.bluePos.x, slot.bluePos.y - 35);
      }
      if (redIdx < this.camps.length) {
        const camp = this.camps[redIdx];
        camp.x = slot.redPos.x;
        camp.y = slot.redPos.y;
        camp.area?.setPosition(slot.redPos.x, slot.redPos.y);
        camp.label?.setPosition(slot.redPos.x, slot.redPos.y - 55);
        camp.costLabel?.setPosition(slot.redPos.x, slot.redPos.y - 35);
      }
    }

    // ── Update troll camp position ──
    if (newMap.trollSlot) {
      // Troll camp is the last one (after all slot pairs)
      const trollIdx = totalSlotCamps;
      if (trollIdx < this.camps.length) {
        const camp = this.camps[trollIdx];
        camp.x = newMap.trollSlot.x;
        camp.y = newMap.trollSlot.y;
        camp.area?.setPosition(newMap.trollSlot.x, newMap.trollSlot.y);
        camp.label?.setPosition(newMap.trollSlot.x, newMap.trollSlot.y - 55);
        camp.costLabel?.setPosition(newMap.trollSlot.x, newMap.trollSlot.y - 35);
      }
      if (trollIdx < this.activeCampDefs.length) {
        this.activeCampDefs[trollIdx].x = newMap.trollSlot.x;
        this.activeCampDefs[trollIdx].y = newMap.trollSlot.y;
      }
    }

    // ── Update neutral unit positions to follow their camps ──
    // Move camp defenders to track their camp's new position
    for (const u of this.units) {
      if (u.team !== 0 || u.dead || !u.campId) continue;
      const camp = this.camps.find(c => c.id === u.campId);
      if (!camp) continue;
      const wanderAngle = Math.random() * Math.PI * 2;
      const wanderR = 20 + Math.random() * 40;
      u.targetX = camp.x + Math.cos(wanderAngle) * wanderR;
      u.targetY = camp.y + Math.sin(wanderAngle) * wanderR;
    }

    // ── Update mine node positions ──
    if (newMap.mineSlots && newMap.mineSlots.length > 0) {
      let mIdx = 0;
      for (const slot of newMap.mineSlots) {
        if (mIdx < this.mineNodes.length) {
          const mine = this.mineNodes[mIdx];
          mine.x = slot.bluePos.x; mine.y = slot.bluePos.y;
          mine.sprite?.setPosition(slot.bluePos.x, slot.bluePos.y);
          mine.label?.setPosition(slot.bluePos.x, slot.bluePos.y - 20);
        }
        mIdx++;
        if (mIdx < this.mineNodes.length) {
          const mine = this.mineNodes[mIdx];
          mine.x = slot.redPos.x; mine.y = slot.redPos.y;
          mine.sprite?.setPosition(slot.redPos.x, slot.redPos.y);
          mine.label?.setPosition(slot.redPos.x, slot.redPos.y - 20);
        }
        mIdx++;
      }
    }

    // ── Update armory positions ──
    if (newMap.armorySlots && newMap.armorySlots.length > 0) {
      let aIdx = 0;
      for (const slot of newMap.armorySlots) {
        if (aIdx < this.armories.length) {
          const arm = this.armories[aIdx];
          arm.x = slot.bluePos.x; arm.y = slot.bluePos.y;
          arm.sprite?.setPosition(slot.bluePos.x, slot.bluePos.y);
          arm.label?.setPosition(slot.bluePos.x, slot.bluePos.y + 20);
        }
        aIdx++;
        if (aIdx < this.armories.length) {
          const arm = this.armories[aIdx];
          arm.x = slot.redPos.x; arm.y = slot.redPos.y;
          arm.sprite?.setPosition(slot.redPos.x, slot.redPos.y);
          arm.label?.setPosition(slot.redPos.x, slot.redPos.y + 20);
        }
        aIdx++;
      }
    }

    // ── Redraw tile grid (picks up groundLayer / highLayer changes) ──
    this.drawTileGrid();

    // ── Re-render map objects (picks up towerSlots / bushZones / rockPositions changes) ──
    this.renderMapRocks();
    this.renderMapBushes();
    this.renderMapTowers();
    this.boundaryBlocks = this.mapDef?.boundaryBlocks || [];
  }

  private handleEditorCommand(cmd: string, mapDef?: MapDef) {
    switch (cmd) {
      case 'restart':
        // Restart the scene with the editor's current map
        if (mapDef) {
          // Store the map temporarily so init() can pick it up
          this.scene.restart({ mapDef: mapDef });
        } else {
          this.scene.restart();
        }
        break;
    }
  }

  private pushEditorSync() {
    if (!this.editorSyncChannel) return;
    try {
      const units = this.units
        .filter(u => !u.dead)
        .map(u => ({
          x: Math.round(u.x),
          y: Math.round(u.y),
          type: u.type,
          team: u.team,
          hp: Math.round(u.hp),
          maxHp: Math.round(u.maxHp),
          campId: u.campId || null,
          dead: u.dead,
        }));

      const camps = this.camps.map(c => ({
        id: c.id,
        x: c.x,
        y: c.y,
        owner: c.owner,
        animalType: c.animalType,
        tier: c.tier,
      }));

      const nexuses = this.nexuses.map(n => ({
        x: n.x,
        y: n.y,
        team: n.team,
        hp: Math.round(n.hp),
        maxHp: n.maxHp,
      }));

      const mines = this.mineNodes.map(m => ({
        id: m.id,
        x: m.x,
        y: m.y,
      }));

      const armories = this.armories.map(a => ({
        x: a.x,
        y: a.y,
        team: a.team,
      }));

      this.editorSyncChannel.postMessage({
        type: 'GAME_STATE',
        units,
        camps,
        nexuses,
        mines,
        armories,
        gameTime: this.gameTime,
        era: this.currentEra,
      });
    } catch {
      // ignore serialization errors
    }
  }

  // ─── IN-GAME MAP EDITOR ────────────────────────────────────

  private toggleEditorMode() {
    this.editorMode = !this.editorMode;
    if (this.editorMode) {
      this.editorSelected = null;
      this.editorDragging = false;
      this.setupEditorPanel();
      // Hide game HUD elements
      if (this.sidebarEl) this.sidebarEl.style.display = 'none';
      if (this.hoardBarEl) this.hoardBarEl.style.display = 'none';
      const cmdWrapEl = document.getElementById('horde-cmd-wrap');
      if (cmdWrapEl) cmdWrapEl.style.display = 'none';
      if (this.voiceStatusEl) this.voiceStatusEl.style.display = 'none';
      if (this.equipPanelEl) this.equipPanelEl.style.display = 'none';
      if (this.charPanelEl) this.charPanelEl.style.display = 'none';
      this.showFeedback('Editor Mode (F2 to exit)', '#00ff88');
    } else {
      this.editorPanelEl?.remove();
      this.editorPanelEl = null;
      this.editorHighlight?.destroy();
      this.editorHighlight = null;
      // Restore game HUD
      if (this.sidebarEl) this.sidebarEl.style.display = '';
      if (this.hoardBarEl) this.hoardBarEl.style.display = '';
      const cmdWrapEl2 = document.getElementById('horde-cmd-wrap');
      if (cmdWrapEl2) cmdWrapEl2.style.display = '';
      if (this.voiceStatusEl) this.voiceStatusEl.style.display = '';
      if (this.equipPanelEl) this.equipPanelEl.style.display = '';
      if (this.charPanelEl) this.charPanelEl.style.display = '';
      this.showFeedback('Game Resumed', '#45E6B0');
    }
  }

  private setupEditorPanel() {
    if (this.editorPanelEl) this.editorPanelEl.remove();
    const container = document.getElementById('game-container') ?? document.body;
    const panel = document.createElement('div');
    panel.id = 'horde-editor-panel';
    panel.style.cssText = `
      position:absolute;top:0;right:0;width:260px;height:100%;
      background:rgba(8,12,20,0.92);backdrop-filter:blur(8px);
      border-left:2px solid #00ff88;z-index:200;overflow-y:auto;padding:14px;
      font-family:'Nunito',sans-serif;
      scrollbar-width:thin;scrollbar-color:rgba(0,255,136,0.3) rgba(10,14,25,0.4);
    `;
    panel.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;">
        <span style="font-size:16px;font-weight:800;color:#00ff88;font-family:'Fredoka',sans-serif;letter-spacing:2px;">MAP EDITOR</span>
        <span style="font-size:11px;color:#555;">F2 close</span>
      </div>
      <div style="background:#FF5555;color:#fff;text-align:center;padding:5px;border-radius:6px;font-weight:800;font-size:12px;margin-bottom:8px;letter-spacing:1px;">GAME PAUSED</div>
      <div id="editor-sync-bar" style="display:flex;align-items:center;gap:8px;padding:8px 10px;background:rgba(0,0,0,0.4);border:1px solid #333;border-radius:6px;margin-bottom:12px;">
        <div id="editor-sync-dot" style="width:10px;height:10px;border-radius:50%;background:#555;flex-shrink:0;"></div>
        <div id="editor-sync-text" style="font-size:11px;color:#888;font-weight:700;">No changes yet</div>
      </div>
      <div style="font-size:10px;color:#666;margin-bottom:12px;">Click objects to select. Drag to reposition. Auto-saves.</div>
      <div id="editor-selection-info" style="margin-bottom:14px;min-height:60px;"></div>
      <div style="margin-bottom:14px;">
        <div style="font-size:11px;font-weight:800;color:#00ff88;letter-spacing:1px;margin-bottom:6px;">OBJECTS</div>
        <div id="editor-object-list" style="max-height:300px;overflow-y:auto;"></div>
      </div>
      <div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:14px;">
        <button id="editor-add-camp" style="flex:1;padding:6px 8px;background:#1a2a1a;border:1px solid #FFD93D;color:#FFD93D;border-radius:6px;cursor:pointer;font-size:11px;font-weight:700;">+ Camp</button>
        <button id="editor-add-mine" style="flex:1;padding:6px 8px;background:#1a2a1a;border:1px solid #88ccff;color:#88ccff;border-radius:6px;cursor:pointer;font-size:11px;font-weight:700;">+ Mine</button>
        <button id="editor-add-armory" style="flex:1;padding:6px 8px;background:#1a2a1a;border:1px solid #cc88ff;color:#cc88ff;border-radius:6px;cursor:pointer;font-size:11px;font-weight:700;">+ Armory</button>
      </div>
      <div id="editor-save-status" style="font-size:11px;color:#555;text-align:center;margin-bottom:8px;"></div>
      <button id="editor-save-btn" style="width:100%;padding:8px;background:#00aa66;color:#fff;border:none;border-radius:6px;cursor:pointer;font-weight:800;font-size:13px;letter-spacing:1px;">SAVE MAP</button>
      <button id="editor-restart-btn" style="width:100%;padding:8px;margin-top:6px;background:#aa4400;color:#fff;border:none;border-radius:6px;cursor:pointer;font-weight:800;font-size:12px;">RESTART WITH CHANGES</button>
    `;
    // Inject pulse animation
    if (!document.getElementById('editor-pulse-style')) {
      const style = document.createElement('style');
      style.id = 'editor-pulse-style';
      style.textContent = `@keyframes pulse { 0%,100% { opacity:1; } 50% { opacity:0.3; } }`;
      document.head.appendChild(style);
    }

    container.appendChild(panel);
    this.editorPanelEl = panel;

    // Wire up buttons
    panel.querySelector('#editor-save-btn')!.addEventListener('click', () => this.editorSaveToServer());
    panel.querySelector('#editor-restart-btn')!.addEventListener('click', () => {
      this.editorSaveToServer().then(() => {
        const mapDef = this.editorBuildMapDef();
        this.editorMode = false;
        this.editorPanelEl?.remove();
        this.editorPanelEl = null;
        this.editorHighlight?.destroy();
        this.editorHighlight = null;
        this.scene.restart({ mapDef });
      });
    });
    panel.querySelector('#editor-add-camp')!.addEventListener('click', () => this.editorAddCampSlot());
    panel.querySelector('#editor-add-mine')!.addEventListener('click', () => this.editorAddMineSlot());
    panel.querySelector('#editor-add-armory')!.addEventListener('click', () => this.editorAddArmorySlot());

    // Prevent keyboard events from reaching the game
    panel.addEventListener('keydown', (e) => e.stopPropagation());

    this.editorUpdatePanel();
  }

  private editorUpdatePanel() {
    if (!this.editorPanelEl) return;

    // Selection info
    const infoEl = this.editorPanelEl.querySelector('#editor-selection-info') as HTMLDivElement;
    if (this.editorSelected) {
      const sel = this.editorSelected;
      const pos = this.editorGetSelectedPos();
      let info = '';
      if (sel.type === 'camp') {
        const c = this.camps[sel.index];
        info = `
          <div style="font-size:12px;font-weight:800;color:#FFD93D;margin-bottom:4px;">CAMP: ${c.name}</div>
          <div style="font-size:11px;color:#aaa;">Type: ${c.animalType} (T${c.tier})</div>
          <div style="font-size:11px;color:#aaa;">Owner: ${c.owner === 0 ? 'Neutral' : c.owner === 1 ? 'Blue' : 'Red'}</div>
          <div style="font-size:11px;color:#aaa;">Pos: (${Math.round(pos?.x || 0)}, ${Math.round(pos?.y || 0)})</div>
          <button id="editor-del-sel" style="margin-top:6px;padding:4px 10px;background:#441a1a;border:1px solid #FF5555;color:#FF5555;border-radius:4px;cursor:pointer;font-size:11px;">Delete</button>
        `;
      } else if (sel.type === 'mine') {
        info = `
          <div style="font-size:12px;font-weight:800;color:#88ccff;margin-bottom:4px;">MINE NODE</div>
          <div style="font-size:11px;color:#aaa;">Pos: (${Math.round(pos?.x || 0)}, ${Math.round(pos?.y || 0)})</div>
          <button id="editor-del-sel" style="margin-top:6px;padding:4px 10px;background:#441a1a;border:1px solid #FF5555;color:#FF5555;border-radius:4px;cursor:pointer;font-size:11px;">Delete</button>
        `;
      } else if (sel.type === 'armory') {
        const a = this.armories[sel.index];
        info = `
          <div style="font-size:12px;font-weight:800;color:#cc88ff;margin-bottom:4px;">ARMORY (Team ${a.team})</div>
          <div style="font-size:11px;color:#aaa;">Pos: (${Math.round(pos?.x || 0)}, ${Math.round(pos?.y || 0)})</div>
          <button id="editor-del-sel" style="margin-top:6px;padding:4px 10px;background:#441a1a;border:1px solid #FF5555;color:#FF5555;border-radius:4px;cursor:pointer;font-size:11px;">Delete</button>
        `;
      } else if (sel.type === 'nexus') {
        const n = this.nexuses[sel.index];
        info = `
          <div style="font-size:12px;font-weight:800;color:${n.team === 1 ? '#4499FF' : '#FF5555'};margin-bottom:4px;">${n.team === 1 ? 'BLUE' : 'RED'} BASE</div>
          <div style="font-size:11px;color:#aaa;">Pos: (${Math.round(pos?.x || 0)}, ${Math.round(pos?.y || 0)})</div>
        `;
      }
      infoEl.innerHTML = info;
      const delBtn = infoEl.querySelector('#editor-del-sel');
      if (delBtn) delBtn.addEventListener('click', () => this.editorDeleteSelected());
    } else {
      infoEl.innerHTML = '<div style="font-size:11px;color:#555;font-style:italic;">No selection — click an object</div>';
    }

    // Object list
    const listEl = this.editorPanelEl.querySelector('#editor-object-list') as HTMLDivElement;
    let listHtml = '';
    // Bases
    for (let i = 0; i < this.nexuses.length; i++) {
      const n = this.nexuses[i];
      const sel = this.editorSelected?.type === 'nexus' && this.editorSelected.index === i;
      listHtml += `<div style="padding:3px 6px;margin-bottom:2px;border-radius:4px;font-size:11px;cursor:pointer;${sel ? 'background:#1a3a1a;border:1px solid #00ff88;' : 'border:1px solid transparent;'}" data-type="nexus" data-idx="${i}">
        <span style="color:${n.team === 1 ? '#4499FF' : '#FF5555'};">BASE ${n.team === 1 ? 'Blue' : 'Red'}</span> <span style="color:#555;">(${Math.round(n.x)},${Math.round(n.y)})</span></div>`;
    }
    // Camps
    for (let i = 0; i < this.camps.length; i++) {
      const c = this.camps[i];
      const sel = this.editorSelected?.type === 'camp' && this.editorSelected.index === i;
      const emoji = ANIMALS[c.animalType]?.emoji || '';
      listHtml += `<div style="padding:3px 6px;margin-bottom:2px;border-radius:4px;font-size:11px;cursor:pointer;${sel ? 'background:#1a3a1a;border:1px solid #00ff88;' : 'border:1px solid transparent;'}" data-type="camp" data-idx="${i}">
        <span style="color:#FFD93D;">${emoji} ${c.animalType}</span> <span style="color:#555;">(${Math.round(c.x)},${Math.round(c.y)})</span></div>`;
    }
    // Mines
    for (let i = 0; i < this.mineNodes.length; i++) {
      const m = this.mineNodes[i];
      const sel = this.editorSelected?.type === 'mine' && this.editorSelected.index === i;
      listHtml += `<div style="padding:3px 6px;margin-bottom:2px;border-radius:4px;font-size:11px;cursor:pointer;${sel ? 'background:#1a3a1a;border:1px solid #00ff88;' : 'border:1px solid transparent;'}" data-type="mine" data-idx="${i}">
        <span style="color:#88ccff;">Mine ${m.id}</span> <span style="color:#555;">(${Math.round(m.x)},${Math.round(m.y)})</span></div>`;
    }
    // Armories
    for (let i = 0; i < this.armories.length; i++) {
      const a = this.armories[i];
      const sel = this.editorSelected?.type === 'armory' && this.editorSelected.index === i;
      listHtml += `<div style="padding:3px 6px;margin-bottom:2px;border-radius:4px;font-size:11px;cursor:pointer;${sel ? 'background:#1a3a1a;border:1px solid #00ff88;' : 'border:1px solid transparent;'}" data-type="armory" data-idx="${i}">
        <span style="color:#cc88ff;">Armory T${a.team}</span> <span style="color:#555;">(${Math.round(a.x)},${Math.round(a.y)})</span></div>`;
    }
    listEl.innerHTML = listHtml;

    // Click items in the list to select
    listEl.querySelectorAll('[data-type]').forEach((el) => {
      el.addEventListener('click', () => {
        const type = el.getAttribute('data-type') as 'camp' | 'mine' | 'armory' | 'nexus';
        const idx = parseInt(el.getAttribute('data-idx')!);
        this.editorSelected = { type, index: idx };
        this.editorUpdateHighlight();
        this.editorUpdatePanel();
        // Pan camera to selected object
        const pos = this.editorGetSelectedPos();
        if (pos) this.cameras.main.centerOn(pos.x, pos.y);
      });
    });
  }

  private editorHitTest(wx: number, wy: number): { type: 'camp' | 'mine' | 'armory' | 'nexus'; index: number } | null {
    let bestDist = 80;
    let bestHit: { type: 'camp' | 'mine' | 'armory' | 'nexus'; index: number } | null = null;

    for (let i = 0; i < this.nexuses.length; i++) {
      const d = pdist({ x: wx, y: wy }, this.nexuses[i]);
      if (d < bestDist) { bestDist = d; bestHit = { type: 'nexus', index: i }; }
    }
    for (let i = 0; i < this.camps.length; i++) {
      const d = pdist({ x: wx, y: wy }, this.camps[i]);
      if (d < bestDist) { bestDist = d; bestHit = { type: 'camp', index: i }; }
    }
    for (let i = 0; i < this.mineNodes.length; i++) {
      const d = pdist({ x: wx, y: wy }, this.mineNodes[i]);
      if (d < bestDist) { bestDist = d; bestHit = { type: 'mine', index: i }; }
    }
    for (let i = 0; i < this.armories.length; i++) {
      const d = pdist({ x: wx, y: wy }, this.armories[i]);
      if (d < bestDist) { bestDist = d; bestHit = { type: 'armory', index: i }; }
    }
    return bestHit;
  }

  private editorGetSelectedPos(): { x: number; y: number } | null {
    if (!this.editorSelected) return null;
    const sel = this.editorSelected;
    switch (sel.type) {
      case 'camp': return this.camps[sel.index];
      case 'mine': return this.mineNodes[sel.index];
      case 'armory': return this.armories[sel.index];
      case 'nexus': return this.nexuses[sel.index];
    }
  }

  private editorMoveSelected(x: number, y: number) {
    if (!this.editorSelected) return;
    const sel = this.editorSelected;
    // Clamp to world bounds
    x = Math.max(50, Math.min(WORLD_W - 50, x));
    y = Math.max(50, Math.min(WORLD_H - 50, y));

    switch (sel.type) {
      case 'camp': {
        const camp = this.camps[sel.index];
        camp.x = Math.round(x); camp.y = Math.round(y);
        camp.area?.setPosition(camp.x, camp.y);
        camp.label?.setPosition(camp.x, camp.y - 55);
        camp.costLabel?.setPosition(camp.x, camp.y - 35);
        // Also update activeCampDefs
        if (sel.index < this.activeCampDefs.length) {
          this.activeCampDefs[sel.index].x = camp.x;
          this.activeCampDefs[sel.index].y = camp.y;
        }
        break;
      }
      case 'mine': {
        const mine = this.mineNodes[sel.index];
        mine.x = Math.round(x); mine.y = Math.round(y);
        mine.sprite?.setPosition(mine.x, mine.y);
        mine.label?.setPosition(mine.x, mine.y - 20);
        break;
      }
      case 'armory': {
        const arm = this.armories[sel.index];
        arm.x = Math.round(x); arm.y = Math.round(y);
        arm.sprite?.setPosition(arm.x, arm.y);
        arm.label?.setPosition(arm.x, arm.y + 20);
        break;
      }
      case 'nexus': {
        const n = this.nexuses[sel.index];
        n.x = Math.round(x); n.y = Math.round(y);
        n.container?.setPosition(n.x, n.y);
        n.hpText?.setPosition(n.x, n.y + 50);
        if (this.hudTexts[`stock_${n.team}`]) {
          this.hudTexts[`stock_${n.team}`].setPosition(n.x, n.y + 65);
        }
        // Redraw HP bars at new position
        this.drawNexusBars();
        break;
      }
    }
  }

  private editorUpdateHighlight() {
    if (this.editorHighlight) {
      this.editorHighlight.destroy();
      this.editorHighlight = null;
    }
    if (!this.editorSelected) return;
    const pos = this.editorGetSelectedPos();
    if (!pos) return;
    this.editorHighlight = this.add.circle(pos.x, pos.y, 70, 0x00ff88, 0.12)
      .setStrokeStyle(3, 0x00ff88, 0.8)
      .setDepth(200);
  }

  private editorAutoSave() {
    if (this.editorSaveTimeout) clearTimeout(this.editorSaveTimeout);
    this.editorSetSyncState('pending');
    this.editorSaveTimeout = setTimeout(() => this.editorSaveToServer(), 800);
  }

  private editorSetSyncState(state: 'idle' | 'pending' | 'saving' | 'saved' | 'error') {
    const dot = this.editorPanelEl?.querySelector('#editor-sync-dot') as HTMLDivElement | null;
    const text = this.editorPanelEl?.querySelector('#editor-sync-text') as HTMLDivElement | null;
    const bar = this.editorPanelEl?.querySelector('#editor-sync-bar') as HTMLDivElement | null;
    if (!dot || !text || !bar) return;
    switch (state) {
      case 'idle':
        dot.style.background = '#555';
        text.textContent = 'No changes yet';
        text.style.color = '#888';
        bar.style.borderColor = '#333';
        break;
      case 'pending':
        dot.style.background = '#FFD93D';
        dot.style.animation = 'none';
        text.textContent = 'Unsaved changes...';
        text.style.color = '#FFD93D';
        bar.style.borderColor = '#FFD93D';
        break;
      case 'saving':
        dot.style.background = '#FFD93D';
        dot.style.animation = 'pulse 0.5s infinite';
        text.textContent = 'Saving to server...';
        text.style.color = '#FFD93D';
        bar.style.borderColor = '#FFD93D';
        break;
      case 'saved': {
        const now = new Date();
        const time = now.toLocaleTimeString();
        dot.style.background = '#00ff88';
        dot.style.animation = 'none';
        text.textContent = `Synced at ${time}`;
        text.style.color = '#00ff88';
        bar.style.borderColor = '#00ff88';
        // Fade back to neutral after 5s
        setTimeout(() => {
          if (dot.style.background === 'rgb(0, 255, 136)') {
            dot.style.background = '#00aa66';
            text.style.color = '#00aa66';
            bar.style.borderColor = '#333';
          }
        }, 5000);
        break;
      }
      case 'error':
        dot.style.background = '#FF5555';
        dot.style.animation = 'none';
        text.textContent = 'SAVE FAILED!';
        text.style.color = '#FF5555';
        bar.style.borderColor = '#FF5555';
        break;
    }
  }

  private editorBuildMapDef(): MapDef {
    const base = this.mapDef || ALL_MAPS[0];

    // Build campSlots from camps (pairs: blue=even idx, red=odd idx)
    const campSlots: MapCampSlot[] = [];
    const campCount = this.camps.length;
    const hasTroll = campCount % 2 === 1; // odd means last camp is troll
    const pairCount = hasTroll ? (campCount - 1) / 2 : Math.floor(campCount / 2);

    for (let i = 0; i < pairCount; i++) {
      const blue = this.camps[i * 2];
      const red = this.camps[i * 2 + 1];
      campSlots.push({
        tier: (blue.tier || 1) as 1 | 2 | 3 | 4,
        bluePos: { x: blue.x, y: blue.y },
        redPos: { x: red.x, y: red.y },
      });
    }

    const trollSlot = hasTroll
      ? { x: this.camps[campCount - 1].x, y: this.camps[campCount - 1].y }
      : base.trollSlot;

    const n1 = this.nexuses.find(n => n.team === 1);
    const n2 = this.nexuses.find(n => n.team === 2);

    // Mine slots (pairs: blue=even, red=odd)
    const mineSlots: { bluePos: { x: number; y: number }; redPos: { x: number; y: number } }[] = [];
    for (let i = 0; i + 1 < this.mineNodes.length; i += 2) {
      mineSlots.push({
        bluePos: { x: this.mineNodes[i].x, y: this.mineNodes[i].y },
        redPos: { x: this.mineNodes[i + 1].x, y: this.mineNodes[i + 1].y },
      });
    }

    // Armory slots (pairs: blue=even, red=odd)
    const armorySlots: { bluePos: { x: number; y: number }; redPos: { x: number; y: number } }[] = [];
    for (let i = 0; i + 1 < this.armories.length; i += 2) {
      armorySlots.push({
        bluePos: { x: this.armories[i].x, y: this.armories[i].y },
        redPos: { x: this.armories[i + 1].x, y: this.armories[i + 1].y },
      });
    }

    return {
      id: base.id,
      name: base.name,
      description: base.description || '',
      worldW: base.worldW || WORLD_W,
      worldH: base.worldH || WORLD_H,
      p1Base: { x: n1?.x || base.p1Base.x, y: n1?.y || base.p1Base.y },
      p2Base: { x: n2?.x || base.p2Base.x, y: n2?.y || base.p2Base.y },
      safeRadius: base.safeRadius || 500,
      campSlots,
      trollSlot,
      carrotZones: base.carrotZones || [],
      wildZones: base.wildZones || [],
      wildExclusions: base.wildExclusions || [],
      mineSlots,
      armorySlots,
      tiles: base.tiles || [],
      groundLayer: base.groundLayer,
      highLayer: base.highLayer,
      grassTint: base.grassTint,
      towerSlots: base.towerSlots,
      bushZones: base.bushZones,
      rockPositions: base.rockPositions,
    };
  }

  private async editorSaveToServer(): Promise<void> {
    this.editorSetSyncState('saving');
    const currentMap = this.editorBuildMapDef();
    let allMaps: MapDef[] = [];
    try {
      const res = await fetch('/__save_horde_maps');
      if (res.ok) {
        const parsed = await res.json();
        if (Array.isArray(parsed)) allMaps = parsed;
      }
    } catch { /* no existing maps */ }

    const existingIdx = allMaps.findIndex((m: MapDef) => m.id === currentMap.id);
    if (existingIdx >= 0) {
      allMaps[existingIdx] = currentMap;
    } else {
      allMaps.push(currentMap);
    }

    try {
      const res = await fetch('/__save_horde_maps', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(allMaps),
      });
      if (res.ok) {
        HordeScene.editorMaps = allMaps;
        // Also save to localStorage so HTML editor and game stay in sync
        try { localStorage.setItem('pb_horde-editor-maps', JSON.stringify(allMaps)); } catch { /* */ }
        this.editorSetSyncState('saved');
        this.editorShowSaveStatus('Saved!', '#00ff88');
      } else {
        this.editorSetSyncState('error');
        this.editorShowSaveStatus('Save failed!', '#FF5555');
      }
    } catch {
      this.editorSetSyncState('error');
      this.editorShowSaveStatus('Save failed!', '#FF5555');
    }
  }

  private editorShowSaveStatus(text: string, color: string) {
    // Panel status
    const el = this.editorPanelEl?.querySelector('#editor-save-status') as HTMLDivElement | null;
    if (el) {
      el.textContent = text;
      el.style.color = color;
      setTimeout(() => { if (el) el.textContent = ''; }, 3000);
    }
    // Big center toast so it's unmissable
    const container = document.getElementById('game-container') ?? document.body;
    const toast = document.createElement('div');
    toast.style.cssText = `
      position:absolute;top:50%;left:50%;transform:translate(-50%,-50%) scale(0.8);
      padding:14px 32px;background:${color === '#00ff88' ? 'rgba(0,80,40,0.95)' : 'rgba(80,0,0,0.95)'};
      border:2px solid ${color};border-radius:12px;z-index:999;
      font-family:'Fredoka',sans-serif;font-size:18px;font-weight:800;
      color:${color};letter-spacing:2px;pointer-events:none;
      transition:all 0.3s ease;opacity:0;
    `;
    toast.textContent = text === 'Saved!' ? 'SAVED' : 'SAVE FAILED';
    container.appendChild(toast);
    // Animate in
    requestAnimationFrame(() => {
      toast.style.opacity = '1';
      toast.style.transform = 'translate(-50%,-50%) scale(1)';
    });
    // Fade out and remove
    setTimeout(() => {
      toast.style.opacity = '0';
      toast.style.transform = 'translate(-50%,-60%) scale(0.9)';
      setTimeout(() => toast.remove(), 300);
    }, 1200);
  }

  private editorAddCampSlot() {
    // Add a pair of camps (blue + red) near the center
    const cx = WORLD_W / 2, cy = WORLD_H / 2;
    const offset = 200 + Math.random() * 200;
    const angle = Math.random() * Math.PI * 2;
    const x1 = Math.round(cx + Math.cos(angle) * offset);
    const y1 = Math.round(cy + Math.sin(angle) * offset);
    const x2 = Math.round(cx + (cx - x1));
    const y2 = Math.round(cy + (cy - y1));

    // Pick a random animal type (T1)
    const type = 'gnome';
    const def = ANIMALS[type];
    const idx = this.camps.length;

    // Create CampDefs
    this.activeCampDefs.push({
      id: `camp_${idx}`, name: 'Gnome Camp', type,
      x: x1, y: y1, guards: 1, spawnMs: 4000, buff: { stat: 'attack', value: 0.05 },
    });
    this.activeCampDefs.push({
      id: `camp_${idx + 1}`, name: 'Gnome Camp', type,
      x: x2, y: y2, guards: 1, spawnMs: 4000, buff: { stat: 'hp', value: 0.05 },
    });

    // Create game objects
    for (const [cx_, cy_, campId, campName] of [[x1, y1, `camp_${idx}`, 'Gnome Camp'], [x2, y2, `camp_${idx + 1}`, 'Gnome Camp']] as [number, number, string, string][]) {
      const area = this.add.ellipse(cx_, cy_, CAMP_RANGE * 2.6, CAMP_RANGE * 1.5, 0xFFD93D, 0.06)
        .setStrokeStyle(2, 0xFFD93D, 0.25).setDepth(4);
      const label = this.add.text(cx_, cy_ - 55, campName, {
        fontSize: '18px', color: '#FFD93D', fontFamily: '"Nunito", sans-serif', fontStyle: 'bold',
        stroke: '#000000', strokeThickness: 4,
      }).setOrigin(0.5).setDepth(52);
      const captureBar = this.add.graphics().setDepth(53);
      const cost = SPAWN_COSTS[type];
      const resEmoji = cost ? RESOURCE_EMOJI[cost.type] : '?';
      const costText = cost ? `${cost.amount}${resEmoji} = 1 ${type}` : '';
      const costLabel = this.add.text(cx_, cy_ - 35, costText, {
        fontSize: '14px', color: '#CCCCCC', fontFamily: '"Nunito", sans-serif', fontStyle: 'bold',
        stroke: '#000000', strokeThickness: 3,
      }).setOrigin(0.5).setDepth(55).setVisible(false);
      this.camps.push({
        id: campId, name: campName, animalType: type, tier: def.tier,
        guardCount: 1, x: cx_, y: cy_, owner: 0,
        spawnMs: 4000, spawnTimer: 0, buff: { stat: 'attack', value: 0.05 },
        label, area, captureBar, storedFood: 0,
        scouted: false, lastSeenOwner: 0, lastSeenLabel: '', lastSeenColor: '#FFD93D',
        idleGuard: null, idleGuardOwner: 0, costLabel,
      });
    }
    this.editorAutoSave();
    this.editorUpdatePanel();
  }

  private editorAddMineSlot() {
    const cx = WORLD_W / 2, cy = WORLD_H / 2;
    const offset = 400 + Math.random() * 300;
    const angle = Math.random() * Math.PI * 2;
    const x1 = Math.round(cx + Math.cos(angle) * offset);
    const y1 = Math.round(cy + Math.sin(angle) * offset);
    const x2 = Math.round(cx + (cx - x1));
    const y2 = Math.round(cy + (cy - y1));
    const idx = this.mineNodes.length;
    this.mineNodes.push({ id: `mine_${idx}`, x: x1, y: y1, sprite: null, label: null });
    this.mineNodes.push({ id: `mine_${idx + 1}`, x: x2, y: y2, sprite: null, label: null });
    // Sprites will be created by updateMineVisuals
    this.editorAutoSave();
    this.editorUpdatePanel();
  }

  private editorAddArmorySlot() {
    const cx = WORLD_W / 2, cy = WORLD_H / 2;
    const offset = 300 + Math.random() * 200;
    const angle = Math.random() * Math.PI * 2;
    const x1 = Math.round(cx + Math.cos(angle) * offset);
    const y1 = Math.round(cy + Math.sin(angle) * offset);
    const x2 = Math.round(cx + (cx - x1));
    const y2 = Math.round(cy + (cy - y1));
    const eqTypes: EquipmentType[] = ['pickaxe', 'sword', 'shield', 'boots', 'banner'];
    const existingCount = this.armories.filter(a => a.team === 1).length;
    const eqType = eqTypes[existingCount % eqTypes.length];
    this.armories.push({ x: x1, y: y1, team: 1, equipmentType: eqType, sprite: null, label: null });
    this.armories.push({ x: x2, y: y2, team: 2, equipmentType: eqType, sprite: null, label: null });
    this.editorAutoSave();
    this.editorUpdatePanel();
  }

  private editorDeleteSelected() {
    if (!this.editorSelected) return;
    const sel = this.editorSelected;

    switch (sel.type) {
      case 'camp': {
        // Delete camp + its pair (must delete in pairs: even=blue, odd=red)
        const pairBase = sel.index % 2 === 0 ? sel.index : sel.index - 1;
        // Remove game objects
        for (let i = pairBase + 1; i >= pairBase && i < this.camps.length; i--) {
          const c = this.camps[i];
          c.area?.destroy();
          c.label?.destroy();
          c.costLabel?.destroy();
          c.captureBar?.destroy();
          // Remove defenders
          this.units = this.units.filter(u => u.campId !== c.id);
        }
        this.camps.splice(pairBase, 2);
        this.activeCampDefs.splice(pairBase, 2);
        break;
      }
      case 'mine': {
        const pairBase = sel.index % 2 === 0 ? sel.index : sel.index - 1;
        for (let i = pairBase + 1; i >= pairBase && i < this.mineNodes.length; i--) {
          const m = this.mineNodes[i];
          m.sprite?.destroy();
          m.label?.destroy();
        }
        this.mineNodes.splice(pairBase, 2);
        break;
      }
      case 'armory': {
        const pairBase = sel.index % 2 === 0 ? sel.index : sel.index - 1;
        for (let i = pairBase + 1; i >= pairBase && i < this.armories.length; i--) {
          const a = this.armories[i];
          a.sprite?.destroy();
          a.label?.destroy();
        }
        this.armories.splice(pairBase, 2);
        break;
      }
      case 'nexus':
        // Don't allow deleting nexuses
        return;
    }
    this.editorSelected = null;
    this.editorUpdateHighlight();
    this.editorAutoSave();
    this.editorUpdatePanel();
  }

  // ═══════════════════════════════════════════════════════════════
  // MAP EVENTS SYSTEM
  // ═══════════════════════════════════════════════════════════════

  private static readonly DEBUG_EVENT_POSITIONS = [
    { x: 1600, y: 1600 },  // top spot
    { x: 4800, y: 4800 },  // bottom spot
    { x: 1600, y: 4800 },  // left spot (blue-side)
    { x: 4800, y: 1600 },  // right spot (red-side)
    { x: 3200, y: 1600 },  // extra: N center
    { x: 3200, y: 4800 },  // extra: S center
  ];
  private static readonly DEBUG_EVENT_TYPES: MapEventType[] = [
    'fungal_bloom', 'warchest', 'kill_bounty', 'mercenary_outpost', 'bottomless_pit', 'hungry_bear',
  ];

  private updateMapEvents(delta: number) {
    if (this.gameOver) return;
    if (this.isOnline && !this.isHost) return;

    // DEBUG: spawn all 6 events immediately, respawn when expired
    if (this.isDebug) {
      if (!this.debugEventsSpawned) {
        this.debugEventsSpawned = true;
        HordeScene.DEBUG_EVENT_TYPES.forEach((type, i) => {
          const pos = HordeScene.DEBUG_EVENT_POSITIONS[i];
          this.spawnEvent(type as MapEventType, pos.x, pos.y);
        });
      }
    } else {
      this.eventCycleTimer += delta;
      if (this.eventCycleTimer >= 120000) {
        this.eventCycleTimer -= 120000;
        this.spawnEventCycle();
      }
    }

    for (const ev of this.mapEvents) {
      if (ev.state !== 'active') continue;
      ev.timer -= delta;
      this.tickEvent(ev, delta);
      this.updateEventVisuals(ev);
      if (ev.timer <= 0) this.expireEvent(ev);
    }

    // Hotspot continuation for fungal bloom
    for (const ev of this.mapEvents) {
      if (ev.type === 'fungal_bloom' && ev.state !== 'active' && ev.data.hotspotTimer > 0) {
        ev.data.hotspotTimer -= delta;
        ev.data.spawnTimer = (ev.data.spawnTimer || 0) + delta;
        if (ev.data.spawnTimer >= 2000) {
          ev.data.spawnTimer -= 2000;
          const angle = Math.random() * Math.PI * 2;
          const dist = Math.random() * 140;
          this.spawnGroundItem('carrot', ev.x + Math.cos(angle) * dist, ev.y + Math.sin(angle) * dist);
        }
      }
    }

    for (let i = this.eventBuffs.length - 1; i >= 0; i--) {
      this.eventBuffs[i].timer -= delta;
      if (this.eventBuffs[i].timer <= 0) this.eventBuffs.splice(i, 1);
    }

    if (this.hungryBearBonusTeam) {
      this.hungryBearBonusTeam.timer -= delta;
      if (this.hungryBearBonusTeam.timer <= 0) this.hungryBearBonusTeam = null;
    }

    this.updateEventHUD();

    for (let i = this.mapEvents.length - 1; i >= 0; i--) {
      const ev = this.mapEvents[i];
      if (ev.state !== 'active' && ev.timer < -5000) {
        ev.container?.destroy();
        this.mapEvents.splice(i, 1);
      }
    }

    // DEBUG: respawn any expired/claimed events
    if (this.isDebug) {
      HordeScene.DEBUG_EVENT_TYPES.forEach((type, i) => {
        const hasActive = this.mapEvents.some(e => e.type === type && e.state === 'active');
        if (!hasActive) {
          const pos = HordeScene.DEBUG_EVENT_POSITIONS[i];
          this.spawnEvent(type as MapEventType, pos.x, pos.y);
        }
      });
    }
  }

  private spawnEventCycle() {
    const pool: MapEventType[] = [];
    for (const [type, def] of Object.entries(MAP_EVENT_DEFS)) {
      if (this.currentEra >= def.minEra && type !== this.lastEventType) {
        pool.push(type as MapEventType);
      }
    }
    if (pool.length === 0) return;

    const type = pool[Math.floor(Math.random() * pool.length)];
    const jitter = 150;
    const jit = () => (Math.random() - 0.5) * 2 * jitter;
    const clamp = (v: number) => Math.max(200, Math.min(WORLD_W - 200, v));
    const def = MAP_EVENT_DEFS[type];

    if (SIMULTANEOUS_EVENTS.includes(type)) {
      // Simultaneous → spawn at BOTH top and bottom spots
      this.spawnEvent(type, clamp(EVENT_SPOTS.top.x + jit()), clamp(EVENT_SPOTS.top.y + jit()));
      this.spawnEvent(type, clamp(EVENT_SPOTS.bottom.x + jit()), clamp(EVENT_SPOTS.bottom.y + jit()));
      this.showFeedback(`⚡ EVENT: ${def.emoji} ${def.name} x2!`, '#FF9933');
      this.showEventSpawnNotif(type);
    } else {
      // Solo → alternate between left and right spots
      this.lastSoloSide = this.lastSoloSide === 'left' ? 'right' : 'left';
      const spot = EVENT_SPOTS[this.lastSoloSide];
      this.spawnEvent(type, clamp(spot.x + jit()), clamp(spot.y + jit()));
      this.showFeedback(`⚡ EVENT: ${def.emoji} ${def.name}!`, '#FF9933');
      this.showEventSpawnNotif(type);
    }

    this.lastEventType = type;
    this.eventCycleCount++;
  }

  private spawnEvent(type: MapEventType, x: number, y: number) {
    const def = MAP_EVENT_DEFS[type];
    const era = this.currentEra;

    const ev: MapEvent = {
      id: this.nextEventId++,
      type, x, y,
      timer: def.duration,
      duration: def.duration,
      state: 'active',
      progress: { 1: 0, 2: 0 },
      claimedBy: null,
      container: null,
      data: {},
    };

    switch (type) {
      case 'fungal_bloom':
        ev.data = { spawnTimer: 0, pickups: { 1: 0, 2: 0 }, hotspotTimer: 0 };
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
        // Prefer types that actually have living neutrals on the map
        const withNeutrals = bountyPool.filter(t => this.units.some(u => u.team === 0 && u.type === t && !u.dead));
        const finalPool = withNeutrals.length > 0 ? withNeutrals : bountyPool;
        const targetType = finalPool[Math.floor(Math.random() * finalPool.length)];
        const targetCount = Math.min(6 + era * 2, Math.max(3, this.units.filter(u => u.team === 0 && u.type === targetType && !u.dead).length));
        const trackedIds = this.units.filter(u => u.team === 0 && u.type === targetType && !u.dead).map(u => u.id);
        ev.data = { targetType, targetCount, kills: { 1: 0, 2: 0 }, trackedIds, deadChecked: new Set<number>() };
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

    // Visual container
    const container = this.add.container(x, y);
    container.setDepth(45);

    const glowColors: Record<MapEventType, number> = {
      fungal_bloom: 0x66ff66, warchest: 0xffcc00, kill_bounty: 0xff4444,
      mercenary_outpost: 0x44aaff, bottomless_pit: 0xaa44ff, hungry_bear: 0xff8844,
    };
    const glow = this.add.graphics();
    glow.fillStyle(glowColors[type] || 0xff9933, 0.12);
    glow.fillCircle(0, 0, type === 'fungal_bloom' ? 150 : 80);
    container.add(glow);
    this.tweens.add({ targets: glow, alpha: { from: 0.12, to: 0.35 }, duration: 1200, yoyo: true, repeat: -1 });

    const outline = this.add.graphics();
    outline.lineStyle(2, glowColors[type] || 0xff9933, 0.6);
    outline.strokeCircle(0, 0, type === 'fungal_bloom' ? 150 : 80);
    container.add(outline);

    const emoji = this.add.text(0, -55, def.emoji, { fontSize: '36px' }).setOrigin(0.5);
    container.add(emoji);
    this.tweens.add({ targets: emoji, y: -60, duration: 800, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });

    const nameW = def.name.length * 7 + 16;
    const nameBg = this.add.graphics();
    nameBg.fillStyle(0x000000, 0.7);
    nameBg.fillRoundedRect(-nameW / 2, -35, nameW, 16, 4);
    container.add(nameBg);

    const nameText = this.add.text(0, -27, def.name.toUpperCase(), {
      fontSize: '10px', color: '#FFD93D',
      fontFamily: 'Fredoka', fontStyle: 'bold',
      stroke: '#000', strokeThickness: 1,
    }).setOrigin(0.5);
    container.add(nameText);

    const timerText = this.add.text(0, -16, '', {
      fontSize: '11px', color: '#FFFFFF',
      fontFamily: 'Nunito', fontStyle: 'bold',
      stroke: '#000', strokeThickness: 2,
    }).setOrigin(0.5);
    container.add(timerText);
    ev.data._timerText = timerText;

    const progressGfx = this.add.graphics();
    container.add(progressGfx);
    ev.data._progressGfx = progressGfx;
    ev.data._emoji = emoji;

    const infoText = this.add.text(0, 22, '', {
      fontSize: '9px', color: '#CCCCCC',
      fontFamily: 'Nunito', fontStyle: 'bold',
      stroke: '#000', strokeThickness: 1,
    }).setOrigin(0.5);
    container.add(infoText);
    ev.data._infoText = infoText;

    ev.container = container;
    this.mapEvents.push(ev);
  }

  private tickEvent(ev: MapEvent, delta: number) {
    switch (ev.type) {
      case 'fungal_bloom': this.tickFungalBloom(ev, delta); break;
      case 'warchest': this.tickWarchest(ev, delta); break;
      case 'kill_bounty': this.tickKillBounty(ev, delta); break;
      case 'mercenary_outpost': this.tickMercenaryOutpost(ev, delta); break;
      case 'bottomless_pit': this.tickBottomlessPit(ev, delta); break;
      case 'hungry_bear': this.tickHungryBear(ev, delta); break;
    }
  }

  private tickFungalBloom(ev: MapEvent, delta: number) {
    const era = this.currentEra;
    ev.data.spawnTimer += delta;
    if (ev.data.spawnTimer >= 1500) {
      ev.data.spawnTimer -= 1500;
      const angle = Math.random() * Math.PI * 2;
      const dist = Math.random() * 140;
      const sx = ev.x + Math.cos(angle) * dist;
      const sy = ev.y + Math.sin(angle) * dist;
      if (era <= 2) {
        this.spawnGroundItem('carrot', sx, sy);
      } else if (era === 3) {
        this.spawnGroundItem(Math.random() < 0.6 ? 'carrot' : 'meat', sx, sy);
      } else {
        const roll = Math.random();
        if (roll < 0.5) this.spawnGroundItem('carrot', sx, sy);
        else if (roll < 0.85) this.spawnGroundItem('meat', sx, sy);
        else this.spawnGroundItem('crystal', sx, sy);
      }
    }
    // Track pickups per team: count units carrying resources out of the zone
    // Use a Set to track which units already credited a pickup this carry cycle
    if (!ev.data._creditedIds) ev.data._creditedIds = new Set<number>();
    for (const u of this.units) {
      if (u.dead || u.team === 0) continue;
      if (pdist(u, ev) < 200 && u.carrying) {
        if (!ev.data._creditedIds.has(u.id)) {
          ev.data._creditedIds.add(u.id);
          ev.data.pickups[u.team] = (ev.data.pickups[u.team] || 0) + 1;
        }
      } else {
        // Reset credit when unit leaves zone or drops resource
        ev.data._creditedIds.delete(u.id);
      }
    }
    ev.progress[1] = ev.data.pickups[1] || 0;
    ev.progress[2] = ev.data.pickups[2] || 0;
  }

  private tickWarchest(ev: MapEvent, delta: number) {
    if (ev.data.hp <= 0) return;
    ev.data.hitTimer = (ev.data.hitTimer || 0) + delta;
    if (ev.data.hitTimer >= 1000) {
      ev.data.hitTimer -= 1000;
      let totalDmg = 0;
      for (const u of this.units) {
        if (u.dead || u.team === 0) continue;
        if (pdist(u, ev) < 80) {
          const tier = ANIMALS[u.type]?.tier || 1;
          const reduction = tier < this.currentEra ? 0.5 : 1.0;
          totalDmg += u.attack * reduction;
        }
      }
      ev.data.hp -= totalDmg;
    }
    ev.progress[1] = Math.max(0, Math.round((ev.data.hp / ev.data.maxHp) * 100));
    if (ev.data.hp <= 0) {
      const era = this.currentEra;
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
        this.spawnGroundItem(rtype, dx, dy);
      }
      this.eventBuffs.push({ team: 1, stat: 'attack', value: 0.15, timer: 60000 });
      this.eventBuffs.push({ team: 2, stat: 'attack', value: 0.15, timer: 60000 });
      this.resolveEvent(ev, null);
    }
  }

  private tickKillBounty(ev: MapEvent, _delta: number) {
    if (!(ev.data.deadChecked instanceof Set)) ev.data.deadChecked = new Set(ev.data.deadChecked);
    const deadChecked: Set<number> = ev.data.deadChecked;
    const targetType = ev.data.targetType;

    // Scan ALL neutral units of target type (including new wild spawns since event started)
    for (const u of this.units) {
      if (u.team !== 0 || u.type !== targetType || !u.dead) continue;
      if (deadChecked.has(u.id)) continue;
      deadChecked.add(u.id);

      // Attribute kill to nearest player unit
      let bestDist = Infinity;
      let bestTeam: 1 | 2 | null = null;
      for (const pu of this.units) {
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
    if (ev.data.kills[1] >= ev.data.targetCount) { this.resolveEvent(ev, 1); return; }
    if (ev.data.kills[2] >= ev.data.targetCount) { this.resolveEvent(ev, 2); return; }
  }

  private tickMercenaryOutpost(ev: MapEvent, _delta: number) {
    const costType = ev.data.cost.type;
    const costAmount = ev.data.cost.amount;
    for (const u of this.units) {
      if (u.dead || u.team === 0) continue;
      if (pdist(u, ev) < 60 && u.carrying === costType) {
        u.carrying = null;
        if (u.carrySprite) { u.carrySprite.destroy(); u.carrySprite = null; }
        ev.data.deliveries[u.team]++;
      }
    }
    ev.progress[1] = ev.data.deliveries[1] || 0;
    ev.progress[2] = ev.data.deliveries[2] || 0;
    if (ev.data.deliveries[1] >= costAmount) { this.resolveEvent(ev, 1); return; }
    if (ev.data.deliveries[2] >= costAmount) { this.resolveEvent(ev, 2); return; }
  }

  private tickBottomlessPit(ev: MapEvent, _delta: number) {
    const needed = ev.data.sacrificesNeeded;
    for (const u of this.units) {
      if (u.dead || u.team === 0) continue;
      if (pdist(u, ev) < 80) {
        const distTarget = Math.sqrt((u.targetX - ev.x) ** 2 + (u.targetY - ev.y) ** 2);
        if (distTarget < 100) {
          u.hp = 0;
          u.dead = true;
          ev.data.sacrifices[u.team]++;
          const poof = this.add.text(u.x, u.y, '💀', { fontSize: '20px' }).setOrigin(0.5).setDepth(55);
          this.tweens.add({ targets: poof, alpha: 0, y: u.y - 40, duration: 800, onComplete: () => poof.destroy() });
        }
      }
    }
    ev.progress[1] = ev.data.sacrifices[1] || 0;
    ev.progress[2] = ev.data.sacrifices[2] || 0;
    if (ev.data.sacrifices[1] >= needed) { this.resolveEvent(ev, 1); return; }
    if (ev.data.sacrifices[2] >= needed) { this.resolveEvent(ev, 2); return; }
  }

  private tickHungryBear(ev: MapEvent, delta: number) {
    ev.data.feedTimer = (ev.data.feedTimer || 0) + delta;
    if (ev.data.feedTimer < 500) return;
    ev.data.feedTimer -= 500;
    for (const u of this.units) {
      if (u.dead || u.team === 0) continue;
      if (pdist(u, ev) < 80 && (u.carrying === 'carrot' || u.carrying === 'meat')) {
        u.carrying = null;
        if (u.carrySprite) { u.carrySprite.destroy(); u.carrySprite = null; }
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
      this.resolveEvent(ev, winner as 1 | 2 | null);
    }
  }

  private resolveEvent(ev: MapEvent, winner: 1 | 2 | null) {
    if (ev.state !== 'active') return;
    ev.state = 'claimed';
    ev.claimedBy = winner;
    // Quest: track event wins
    if (winner) this._questEventsWon[winner]++;
    const era = this.currentEra;
    switch (ev.type) {
      case 'fungal_bloom': {
        if (winner) {
          const stock = this.baseStockpile[winner];
          const scarcest = stock.carrot <= stock.meat && stock.carrot <= stock.crystal ? 'carrot'
            : stock.meat <= stock.crystal ? 'meat' : 'crystal';
          this.baseStockpile[winner][scarcest] += 5;
          this.showFeedback(`🍄 P${winner} wins Bloom! +5 ${scarcest}`, '#45E6B0');
          this.showEventResolveNotif('fungal_bloom', winner, `+5 ${scarcest}`);
        } else {
          this.showFeedback('🍄 Fungal Bloom expired!', '#888');
          this.showEventResolveNotif('fungal_bloom', null, '');
        }
        ev.data.hotspotTimer = 30000;
        ev.data.spawnTimer = 0;
        break;
      }
      case 'warchest':
        this.showFeedback('📦 Warchest smashed! Loot drops! +15% ATK 60s', '#FFD93D');
        this.showEventResolveNotif('warchest', winner, '+15% ATK 60s');
        break;
      case 'kill_bounty': {
        if (winner) {
          const resType = (ANIMALS[ev.data.targetType]?.tier || 1) <= 1 ? 'carrot' : 'meat';
          this.baseStockpile[winner][resType] += 5;
          this.eventBuffs.push({ team: winner, stat: 'speed', value: 0.10, timer: 30000 });
          this.showFeedback(`🎯 P${winner} wins Bounty! +5 ${resType} +10% speed`, '#45E6B0');
          this.showEventResolveNotif('kill_bounty', winner, `+5 ${resType} +10% speed`);
        } else {
          this.showFeedback('🎯 Kill Bounty expired!', '#888');
          this.showEventResolveNotif('kill_bounty', null, '');
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
          const enemyCamp = this.camps
            .filter(c => c.owner === enemyTeam)
            .sort((a, b) => pdist2(a, ev) - pdist2(b, ev))[0];
          const tX = enemyCamp ? enemyCamp.x : (winner === 1 ? P2_BASE.x : P1_BASE.x);
          const tY = enemyCamp ? enemyCamp.y : (winner === 1 ? P2_BASE.y : P1_BASE.y);
          for (let i = 0; i < mercCount; i++) {
            this.spawnUnit(mercType, winner, ev.x + (Math.random() - 0.5) * 60, ev.y + (Math.random() - 0.5) * 60);
            const merc = this.units[this.units.length - 1];
            if (merc) { merc.targetX = tX; merc.targetY = tY; }
          }
          this.showFeedback(`🏕️ P${winner} hires ${mercCount} ${mercType}s!`, '#45E6B0');
          this.showEventResolveNotif('mercenary_outpost', winner, `+${mercCount} ${mercType}s`);
        } else {
          this.showFeedback('🏕️ Outpost expired!', '#888');
          this.showEventResolveNotif('mercenary_outpost', null, '');
        }
        break;
      }
      case 'bottomless_pit': {
        if (winner) {
          this.eventBuffs.push({ team: winner, stat: 'attack', value: 0.20, timer: 45000 });
          for (let i = 0; i < 3; i++) {
            const types: ('carrot' | 'meat' | 'crystal')[] = ['carrot', 'meat', 'crystal'];
            this.spawnGroundItem(types[Math.floor(Math.random() * types.length)], ev.x + (Math.random() - 0.5) * 60, ev.y + (Math.random() - 0.5) * 60);
          }
          this.showFeedback(`🕳️ P${winner} wins Pit! +20% ATK 45s`, '#45E6B0');
          this.showEventResolveNotif('bottomless_pit', winner, '+20% ATK 45s');
        } else {
          this.showFeedback('🕳️ Pit expired!', '#888');
          this.showEventResolveNotif('bottomless_pit', null, '');
        }
        break;
      }
      case 'hungry_bear': {
        if (winner) {
          const size = ev.data.bearSize || 1.0;
          this.spawnUnit('panda', winner, ev.x, ev.y);
          const bear = this.units[this.units.length - 1];
          if (bear) {
            bear.maxHp = ev.data.bearHp || 2000;
            bear.hp = bear.maxHp;
            bear.attack = Math.round(50 * size);
            bear.speed = 40;
            bear.targetX = winner === 1 ? P2_BASE.x : P1_BASE.x;
            bear.targetY = winner === 1 ? P2_BASE.y : P1_BASE.y;
          }
          this.showFeedback(`🐻 P${winner}'s Mega Bear! ${Math.round(ev.data.bearHp)} HP`, '#45E6B0');
          this.showEventResolveNotif('hungry_bear', winner, `Mega Bear ${Math.round(ev.data.bearHp)} HP`);
        } else {
          this.showFeedback('🐻 Bear wanders off...', '#888');
          this.showEventResolveNotif('hungry_bear', null, '');
        }
        break;
      }
    }
    if (ev.container) {
      this.tweens.add({ targets: ev.container, alpha: 0, duration: 2000 });
    }
  }

  private expireEvent(ev: MapEvent) {
    if (ev.state !== 'active') return;
    const p1 = ev.progress[1] || 0;
    const p2 = ev.progress[2] || 0;
    let winner: 1 | 2 | null = null;
    if (p1 > p2) winner = 1;
    else if (p2 > p1) winner = 2;
    if (ev.type === 'warchest' && ev.data.hp > 0) {
      ev.state = 'expired';
      this.showFeedback('📦 Warchest despawns...', '#888');
      this.showEventResolveNotif('warchest', null, '');
      if (ev.container) this.tweens.add({ targets: ev.container, alpha: 0, duration: 1500 });
      return;
    }
    this.resolveEvent(ev, winner);
  }

  private updateEventVisuals(ev: MapEvent) {
    if (!ev.data._timerText || !ev.data._progressGfx) return;
    const secs = Math.max(0, Math.ceil(ev.timer / 1000));
    ev.data._timerText.setText(`⏱ ${secs}s`);

    const gfx: Phaser.GameObjects.Graphics = ev.data._progressGfx;
    gfx.clear();
    const barW = 70, barH = 6, barY = 12;
    gfx.fillStyle(0x111111, 0.8);
    gfx.fillRoundedRect(-barW / 2 - 1, barY - 1, barW + 2, barH + 2, 2);

    if (ev.type === 'warchest') {
      const pct = Math.max(0, (ev.data.hp || 0) / (ev.data.maxHp || 1));
      const color = pct > 0.5 ? 0x44ff44 : pct > 0.25 ? 0xffaa00 : 0xff4444;
      gfx.fillStyle(color, 0.9);
      gfx.fillRoundedRect(-barW / 2, barY, barW * pct, barH, 2);
    } else {
      // Use appropriate denominator per event type
      let total: number;
      if (ev.data.sacrificesNeeded) total = ev.data.sacrificesNeeded;
      else if (ev.data.targetCount) total = ev.data.targetCount;
      else if (ev.data.cost?.amount) total = ev.data.cost.amount;
      else total = Math.max(1, (ev.progress[1] || 0) + (ev.progress[2] || 0), 1); // relative for fungal/bear
      const p1pct = Math.min(1, (ev.progress[1] || 0) / total);
      const p2pct = Math.min(1, (ev.progress[2] || 0) / total);
      gfx.fillStyle(0x4488ff, 0.9);
      gfx.fillRoundedRect(-barW / 2, barY, barW * 0.5 * p1pct, barH, 2);
      gfx.fillStyle(0xff4444, 0.9);
      gfx.fillRoundedRect(barW / 2 - barW * 0.5 * p2pct, barY, barW * 0.5 * p2pct, barH, 2);
    }

    const info = ev.data._infoText;
    if (info) {
      switch (ev.type) {
        case 'fungal_bloom':
          info.setText(`🔵${ev.progress[1]} vs ${ev.progress[2]}🔴`);
          break;
        case 'warchest':
          info.setText(`❤️ ${Math.max(0, Math.round(ev.data.hp))}/${ev.data.maxHp}`);
          break;
        case 'kill_bounty': {
          const em = ANIMALS[ev.data.targetType]?.emoji || '';
          info.setText(`Kill ${em}! 🔵${ev.progress[1]} vs ${ev.progress[2]}🔴 /${ev.data.targetCount}`);
          break;
        }
        case 'mercenary_outpost':
          info.setText(`Deliver ${ev.data.cost.amount} ${ev.data.cost.type}! 🔵${ev.progress[1]} vs ${ev.progress[2]}🔴`);
          break;
        case 'bottomless_pit':
          info.setText(`Sacrifice ${ev.data.sacrificesNeeded}! 🔵${ev.progress[1]} vs ${ev.progress[2]}🔴`);
          break;
        case 'hungry_bear': {
          const sz = (ev.data.bearSize || 1).toFixed(1);
          info.setText(`Feed! ${sz}x 🔵${ev.progress[1]} vs ${ev.progress[2]}🔴`);
          if (ev.data._emoji) ev.data._emoji.setScale(Math.min(3, ev.data.bearSize || 1));
          break;
        }
      }
    }
  }

  // ─── EVENT TAB (top-left, right of sidebar) ─────────────────

  private eventHudEl: HTMLDivElement | null = null;

  private panCameraToEvent(ev: MapEvent) {
    const cam = this.cameras.main;
    const duration = 400;
    const startX = cam.scrollX + cam.width / 2;
    const startY = cam.scrollY + cam.height / 2;
    const dx = ev.x - startX;
    const dy = ev.y - startY;
    let elapsed = 0;
    const step = (dt: number) => {
      elapsed += dt;
      const t = Math.min(1, elapsed / duration);
      const ease = t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t;
      cam.centerOn(startX + dx * ease, startY + dy * ease);
      if (t < 1) this.time.delayedCall(16, () => step(16));
    };
    step(0);
  }

  private getEventHowTo(ev: MapEvent): string {
    switch (ev.type) {
      case 'fungal_bloom': return 'Send gatherers into the zone to collect mushroom pickups';
      case 'warchest': return 'Attack the chest with combat units to break it open';
      case 'kill_bounty': return `Hunt and kill the marked ${ev.data.targetType || 'target'}s nearby`;
      case 'mercenary_outpost': return `Deliver ${ev.data.cost?.amount || '?'} ${ev.data.cost?.type || 'resources'} to the outpost`;
      case 'bottomless_pit': return `Sacrifice ${ev.data.sacrificesNeeded || '?'} units into the pit`;
      case 'hungry_bear': return 'Deliver food (carrots or meat) to tame the bear';
      default: return 'Contest the event zone!';
    }
  }

  private getEventReward(ev: MapEvent): string {
    switch (ev.type) {
      case 'fungal_bloom': return 'Resources for your team';
      case 'warchest': return 'Loot drop + both teams get +15% ATK (60s)';
      case 'kill_bounty': return 'Most kills wins +10% SPD (30s) + bonus resources';
      case 'mercenary_outpost': return 'Winner recruits 3-5 mercenary units';
      case 'bottomless_pit': return '+20% ATK buff (45s) + resources';
      case 'hungry_bear': return 'Tame the bear as a powerful siege unit';
      default: return 'Rewards!';
    }
  }

  private updateEventHUD() {
    const active = this.mapEvents.filter(e => e.state === 'active');
    if (active.length === 0 && this.eventCycleTimer < 90000) {
      if (this.eventHudEl) this.eventHudEl.style.display = 'none';
      return;
    }

    if (!this.eventHudEl) {
      const c = document.getElementById('game-container') ?? document.body;
      const el = document.createElement('div');
      el.id = 'horde-quest-panel';
      c.appendChild(el);
      this.eventHudEl = el;
    }
    this.eventHudEl.style.display = 'flex';
    // Position dynamically below resource panel
    if (this.resourcePanelEl) {
      const rpRect = this.resourcePanelEl.getBoundingClientRect();
      this.eventHudEl.style.top = (rpRect.bottom + 8) + 'px';
    }

    const glowColors: Record<string, string> = {
      fungal_bloom: '#66ff66', warchest: '#ffcc00', kill_bounty: '#ff4444',
      mercenary_outpost: '#44aaff', bottomless_pit: '#aa44ff', hungry_bear: '#ff8844',
    };

    let html = '';
    for (const ev of active) {
      const def = MAP_EVENT_DEFS[ev.type];
      const secs = Math.max(0, Math.ceil(ev.timer / 1000));
      const pctTime = Math.max(0, ev.timer / ev.duration);
      const color = glowColors[ev.type] || '#FF9933';
      const howTo = this.getEventHowTo(ev);
      const reward = this.getEventReward(ev);

      let progressStr = '';
      const p1 = ev.progress[1] || 0;
      const p2 = ev.progress[2] || 0;
      if (ev.type === 'warchest') {
        progressStr = `<span style="color:#ff6666">\u2764\uFE0F ${Math.max(0, Math.round(ev.data.hp))}/${ev.data.maxHp}</span>`;
      } else if (ev.type === 'kill_bounty') {
        const bountyIcon = avatarImg(ev.data.targetType, 28) || (ANIMALS[ev.data.targetType]?.emoji || '');
        progressStr = `${bountyIcon} <span style="color:#6af">${p1}</span> vs <span style="color:#f66">${p2}</span> / ${ev.data.targetCount}`;
      } else if (ev.type === 'mercenary_outpost') {
        progressStr = `<span style="color:#6af">${p1}</span> vs <span style="color:#f66">${p2}</span> / ${ev.data.cost.amount} ${ev.data.cost.type}`;
      } else if (ev.type === 'bottomless_pit') {
        progressStr = `<span style="color:#6af">${p1}</span> vs <span style="color:#f66">${p2}</span> / ${ev.data.sacrificesNeeded}`;
      } else if (ev.type === 'hungry_bear') {
        progressStr = `${(ev.data.bearSize || 1).toFixed(1)}x <span style="color:#6af">${p1}</span> vs <span style="color:#f66">${p2}</span>`;
      } else {
        progressStr = `<span style="color:#6af">${p1}</span> vs <span style="color:#f66">${p2}</span>`;
      }

      const timerColor = pctTime > 0.5 ? '#5a9e3a' : pctTime > 0.2 ? '#C98F00' : '#CC3333';
      const urgentPulse = pctTime <= 0.2 ? 'animation:eventPulse 1s ease-in-out infinite;' : '';

      html += `<div data-event-id="${ev.id}" style="
        background:linear-gradient(180deg, rgba(255,248,230,0.95) 0%, rgba(240,228,200,0.95) 100%);
        border:2px solid rgba(139,115,85,0.5);border-radius:10px;
        padding:8px 10px;cursor:pointer;pointer-events:auto;
        box-shadow:0 2px 8px rgba(0,0,0,0.15), inset 0 0 8px ${color}15;
        border-left:4px solid ${color};
        transition:all 0.15s ease;${urgentPulse}
      ">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:4px;">
          <div style="display:flex;align-items:center;gap:5px;">
            <span style="font-size:18px;">${def.emoji}</span>
            <span style="font-size:12px;font-weight:800;color:#4a3520;font-family:'Fredoka',sans-serif;letter-spacing:0.5px;">${def.name.toUpperCase()}</span>
          </div>
          <span style="font-size:11px;font-weight:700;color:${timerColor};font-family:'Fredoka',sans-serif;">${secs}s</span>
        </div>

        <div style="background:rgba(139,115,85,0.15);border-radius:4px;height:4px;overflow:hidden;margin-bottom:5px;">
          <div style="background:${timerColor};height:100%;width:${(pctTime * 100).toFixed(1)}%;border-radius:4px;transition:width 0.5s;"></div>
        </div>

        <div style="font-size:10px;color:#5a4a3a;margin-bottom:3px;line-height:1.3;">\u2694\uFE0F ${howTo}</div>
        <div style="font-size:9px;color:#8B7355;margin-bottom:4px;line-height:1.3;">\uD83C\uDFC6 ${reward}</div>

        <div style="font-size:10px;color:#4a3520;font-weight:600;">${progressStr}</div>

        <div style="display:flex;align-items:center;gap:3px;margin-top:4px;opacity:0.6;">
          <span style="font-size:8px;color:#8B7355;">\uD83D\uDCCD Click to view</span>
        </div>
      </div>`;
    }

    // Next event countdown
    const nextIn = Math.max(0, Math.ceil((120000 - this.eventCycleTimer) / 1000));
    if (nextIn <= 30) {
      html += `<div style="
        background:rgba(255,248,230,0.8);border:1px solid rgba(139,115,85,0.3);border-radius:8px;
        padding:6px 10px;text-align:center;
      "><span style="font-size:10px;color:#8B7355;font-weight:700;font-family:'Fredoka',sans-serif;">\u26A1 Next event in ${nextIn}s</span></div>`;
    }

    // No-events placeholder
    if (active.length === 0 && nextIn > 30) {
      html += `<div style="
        background:rgba(255,248,230,0.7);border:1px solid rgba(139,115,85,0.2);border-radius:8px;
        padding:8px 10px;text-align:center;
      "><span style="font-size:10px;color:#a89870;font-style:italic;">No active events</span></div>`;
    }

    this.eventHudEl.innerHTML = html;

    // Attach click handlers to pan camera
    const cards = this.eventHudEl.querySelectorAll('[data-event-id]');
    cards.forEach((card) => {
      card.addEventListener('click', () => {
        const id = parseInt((card as HTMLElement).dataset.eventId || '0', 10);
        const ev = this.mapEvents.find(e => e.id === id && e.state === 'active');
        if (ev) this.panCameraToEvent(ev);
      });
    });
  }

  private getEventBuffs(team: 1 | 2) {
    let attack = 0, speed = 0;
    for (const b of this.eventBuffs) {
      if (b.team !== team) continue;
      if (b.stat === 'attack') attack += b.value;
      if (b.stat === 'speed') speed += b.value;
    }
    return { attack, speed };
  }

  // ─── CLEANUP ────────────────────────────────────────────────

  private cleanupHTML() {
    if (this._resizeHandler) {
      window.removeEventListener('resize', this._resizeHandler);
      this._resizeHandler = null;
    }
    document.getElementById('horde-cmd-wrap')?.remove();
    this.cmdAvatarEl = null;
    this.textInput = null;
    this.voiceStatusEl?.remove(); this.voiceStatusEl = null;
    // Destroy voice conversation system
    this.voiceOrb?.destroy(); this.voiceOrb = null;
    this.talkingPortrait?.destroy(); this.talkingPortrait = null;
    this.scribeService?.destroy(); this.scribeService = null;
    this.ttsService?.destroy(); this.ttsService = null;
    this.introVeilEl?.remove(); this.introVeilEl = null;
    this.selectionLabel = null;
    this.sidebarEl?.remove(); this.sidebarEl = null;
    this.hoardBarEl?.remove(); this.hoardBarEl = null;
    this.charPanelEl?.remove(); this.charPanelEl = null;
    document.getElementById('horde-char-toggle')?.remove();
    this.equipPanelEl?.remove(); this.equipPanelEl = null;
    document.getElementById('horde-equip-toggle')?.remove();
    // New floating overlay panels
    this.topBarEl?.remove(); this.topBarEl = null;
    this.resourcePanelEl?.remove(); this.resourcePanelEl = null;
    this.cmdLogPanelEl?.remove(); this.cmdLogPanelEl = null;
    document.getElementById('horde-minimap')?.remove();
    this.minimapEl = null; this.minimapCtx = null; this.minimapTerrainCanvas = null;
    document.getElementById('horde-ai-settings')?.remove();
    this.debugPanelEl?.remove(); this.debugPanelEl = null;
    this.memoryOverlay?.destroy(); this.memoryOverlay = null;
    this.profilingRecorder?.destroy(); this.profilingRecorder = null;
    this.eventHudEl?.remove(); this.eventHudEl = null;
    this.notifContainerEl?.remove(); this.notifContainerEl = null;
    this.notifEventStackEl = null;
    this.notifQueue = []; this.activeNotifs = []; this.eraBannerActive = false;
    // Destroy map event containers
    for (const ev of this.mapEvents) ev.container?.destroy();
    this.mapEvents = [];
    // Destroy any in-flight projectiles
    for (const hit of this.pendingHits) this.destroyProjectile(hit);
    this.pendingHits = [];
    try { this.recognition?.abort(); } catch (_e) { /* */ }
    // End ElevenLabs voice agent session on cleanup
    if (this.voiceAgent) { this.voiceAgent.endSession().catch(() => {}); this.voiceAgent = null; this.voiceAgentReady = false; }
    if (this.firebase) { this.firebase.cleanup(); this.firebase = null; }
    if (this.editorSyncChannel) { this.editorSyncChannel.close(); this.editorSyncChannel = null; }
    this.editorPanelEl?.remove(); this.editorPanelEl = null;
    this.editorHighlight?.destroy(); this.editorHighlight = null;
    if (this.editorSaveTimeout) { clearTimeout(this.editorSaveTimeout); this.editorSaveTimeout = null; }
    this.debugModePanelEl?.remove(); this.debugModePanelEl = null;
  }

  // ─── DEBUG MODE PANEL ────────────────────────────────────────

  private setupDebugModePanel() {
    const container = document.getElementById('game-container') ?? document.body;
    const panel = document.createElement('div');
    panel.id = 'horde-debug-mode-panel';
    panel.style.cssText = `
      position:absolute; top:10px; right:10px; width:210px;
      background:rgba(20,15,10,0.94); border:2px solid #FFD700; border-radius:10px;
      padding:10px 8px; font-family:'Nunito',sans-serif; color:#e8dcc4; z-index:150;
      max-height:92vh; overflow-y:auto; font-size:11px;
      scrollbar-width:thin; scrollbar-color:#8B7355 transparent;
    `;

    const btnStyle = `background:#8B7355;border:1px solid #FFD93D;border-radius:4px;color:#FFD93D;cursor:pointer;padding:2px 6px;font-size:10px;font-weight:700;font-family:'Nunito',sans-serif;`;
    const sectionStyle = `margin-bottom:8px;padding-bottom:6px;border-bottom:1px solid #4a3a2a;`;
    const headerStyle = `font-size:13px;font-weight:800;color:#FFD93D;margin-bottom:4px;letter-spacing:1px;`;

    // Title
    panel.innerHTML = `<div style="text-align:center;${headerStyle}font-size:15px;margin-bottom:8px;">🛠️ DEBUG MODE</div>`;

    // === TEAM CONTROL ===
    const teamSection = document.createElement('div');
    teamSection.style.cssText = sectionStyle;
    teamSection.innerHTML = `<div style="${headerStyle}">⚔️ TEAM CONTROL</div>`;
    const teamLabel = document.createElement('div');
    teamLabel.style.cssText = 'margin-bottom:4px;font-size:12px;';
    teamLabel.innerHTML = `Controlling: <span id="debug-team-label" style="color:#4499FF;font-weight:800;">Team 1 (Blue)</span>`;
    teamSection.appendChild(teamLabel);
    const teamBtn = document.createElement('button');
    teamBtn.style.cssText = btnStyle + 'width:100%;padding:4px 8px;font-size:12px;margin-top:2px;';
    teamBtn.textContent = 'Switch to Team 2';
    teamBtn.addEventListener('click', () => {
      this.debugControlTeam = this.debugControlTeam === 1 ? 2 : 1;
      const label = document.getElementById('debug-team-label');
      if (label) {
        label.textContent = this.debugControlTeam === 1 ? 'Team 1 (Blue)' : 'Team 2 (Red)';
        label.style.color = this.debugControlTeam === 1 ? '#4499FF' : '#FF5555';
      }
      teamBtn.textContent = `Switch to Team ${this.debugControlTeam === 1 ? 2 : 1}`;
    });
    teamSection.appendChild(teamBtn);
    panel.appendChild(teamSection);

    // === RESOURCES ===
    const resSection = document.createElement('div');
    resSection.style.cssText = sectionStyle;
    resSection.innerHTML = `<div style="${headerStyle}">💰 RESOURCES</div>`;
    const resources: { key: 'carrot' | 'meat' | 'crystal' | 'metal'; emoji: string; color: string }[] = [
      { key: 'carrot', emoji: '🥕', color: '#FF9933' },
      { key: 'meat', emoji: '🍖', color: '#CC6644' },
      { key: 'crystal', emoji: '💎', color: '#AA66FF' },
      { key: 'metal', emoji: '⚙️', color: '#88AACC' },
    ];

    for (const team of [1, 2] as const) {
      const teamColor = team === 1 ? '#4499FF' : '#FF5555';
      const teamHeader = document.createElement('div');
      teamHeader.style.cssText = `font-size:11px;font-weight:700;color:${teamColor};margin:4px 0 2px;`;
      teamHeader.textContent = `Team ${team}`;
      resSection.appendChild(teamHeader);

      for (const res of resources) {
        const row = document.createElement('div');
        row.style.cssText = 'display:flex;align-items:center;gap:3px;margin-bottom:2px;';
        const label = document.createElement('span');
        label.style.cssText = 'width:24px;text-align:center;';
        label.textContent = res.emoji;
        row.appendChild(label);

        const countSpan = document.createElement('span');
        countSpan.id = `debug-res-${team}-${res.key}`;
        countSpan.style.cssText = `width:36px;text-align:right;font-weight:700;color:${res.color};font-size:10px;`;
        countSpan.textContent = '0';
        row.appendChild(countSpan);

        for (const amt of [1, 10, 100]) {
          const btn = document.createElement('button');
          btn.style.cssText = btnStyle + 'padding:1px 4px;font-size:9px;';
          btn.textContent = `+${amt}`;
          btn.addEventListener('click', () => {
            this.baseStockpile[team][res.key] += amt;
            this.updateDebugResourceDisplay();
          });
          row.appendChild(btn);
        }
        resSection.appendChild(row);
      }
    }
    panel.appendChild(resSection);

    // === NEUTRALS ===
    const neutralSection = document.createElement('div');
    neutralSection.style.cssText = sectionStyle;
    neutralSection.innerHTML = `<div style="${headerStyle}">🐾 NEUTRALS</div>`;

    const neutralToggle = document.createElement('button');
    neutralToggle.id = 'debug-neutral-toggle';
    neutralToggle.style.cssText = btnStyle + 'width:100%;padding:4px 8px;font-size:11px;margin-bottom:4px;';
    neutralToggle.textContent = 'Spawning: ON';
    neutralToggle.addEventListener('click', () => {
      this.debugNeutralsEnabled = !this.debugNeutralsEnabled;
      neutralToggle.textContent = `Spawning: ${this.debugNeutralsEnabled ? 'ON' : 'OFF'}`;
      neutralToggle.style.borderColor = this.debugNeutralsEnabled ? '#FFD93D' : '#FF4444';
    });
    neutralSection.appendChild(neutralToggle);

    const killAllBtn = document.createElement('button');
    killAllBtn.style.cssText = btnStyle + 'width:100%;padding:4px 8px;font-size:11px;background:#6B2222;border-color:#FF4444;color:#FF6666;';
    killAllBtn.textContent = '☠️ Kill All Neutrals';
    killAllBtn.addEventListener('click', () => {
      let killed = 0;
      for (const u of this.units) {
        if (u.team === 0 && !u.dead) {
          u.hp = 0;
          u.dead = true;
          killed++;
        }
      }
      this.showFeedback(`☠️ Killed ${killed} neutrals`, '#FF4444');
    });
    neutralSection.appendChild(killAllBtn);
    panel.appendChild(neutralSection);

    // === HITBOX / BOUNDARY VISUALIZATION ===
    const hitboxSection = document.createElement('div');
    hitboxSection.style.cssText = sectionStyle;
    hitboxSection.innerHTML = `<div style="${headerStyle}">📐 HITBOXES</div>`;
    const hitboxToggle = document.createElement('button');
    hitboxToggle.id = 'debug-hitbox-toggle';
    hitboxToggle.style.cssText = btnStyle + 'width:100%;padding:4px 8px;font-size:11px;margin-bottom:4px;';
    hitboxToggle.textContent = 'Show Hitboxes: OFF';
    hitboxToggle.addEventListener('click', () => {
      this.debugHitboxes = !this.debugHitboxes;
      hitboxToggle.textContent = `Show Hitboxes: ${this.debugHitboxes ? 'ON' : 'OFF'}`;
      hitboxToggle.style.borderColor = this.debugHitboxes ? '#00FF88' : '#FFD93D';
      if (!this.debugHitboxes && this.debugHitboxGfx) {
        this.debugHitboxGfx.clear();
      }
    });
    hitboxSection.appendChild(hitboxToggle);
    panel.appendChild(hitboxSection);

    container.appendChild(panel);
    this.debugModePanelEl = panel;

    // Initial resource display
    this.updateDebugResourceDisplay();
  }

  private drawDebugBoundaries() {
    if (this.boundaryBlocks.length === 0) {
      if (this.debugBoundaryGfx) this.debugBoundaryGfx.clear();
      return;
    }
    if (!this.debugBoundaryGfx) {
      this.debugBoundaryGfx = this.add.graphics().setDepth(998);
    }
    const bg = this.debugBoundaryGfx;
    bg.clear();
    const cam = this.cameras.main;
    const cL = cam.scrollX - 50, cR = cam.scrollX + cam.width / cam.zoom + 50;
    const cT = cam.scrollY - 50, cB = cam.scrollY + cam.height / cam.zoom + 50;
    for (const b of this.boundaryBlocks) {
      if (b.x + b.w < cL || b.x > cR || b.y + b.h < cT || b.y > cB) continue;
      bg.fillStyle(0xFF2222, 0.15);
      bg.fillRect(b.x, b.y, b.w, b.h);
      bg.lineStyle(3, 0xFF4422, 0.8);
      bg.strokeRect(b.x, b.y, b.w, b.h);
      bg.lineStyle(1, 0xFF4422, 0.3);
      const step = 20;
      for (let d = 0; d < b.w + b.h; d += step) {
        const x1 = b.x + Math.max(0, d - b.h), y1 = b.y + Math.min(b.h, d);
        const x2 = b.x + Math.min(b.w, d), y2 = b.y + Math.max(0, d - b.w);
        bg.lineBetween(x1, y1, x2, y2);
      }
    }
  }

  private drawDebugHitboxes() {
    if (!this.debugHitboxGfx) {
      this.debugHitboxGfx = this.add.graphics().setDepth(999);
    }
    const g = this.debugHitboxGfx;
    g.clear();

    const cam = this.cameras.main;
    const pad = 200;
    const camL = cam.scrollX - pad;
    const camR = cam.scrollX + cam.width / cam.zoom + pad;
    const camT = cam.scrollY - pad;
    const camB = cam.scrollY + cam.height / cam.zoom + pad;
    const inView = (x: number, y: number, r: number) =>
      x + r > camL && x - r < camR && y + r > camT && y - r < camB;

    // ── Blocked tiles (water + rock tiles) — red overlay ──
    const tiles = this.mapDef?.tiles;
    if (tiles) {
      g.fillStyle(0xFF0000, 0.18);
      for (let r = 0; r < tiles.length; r++) {
        for (let c = 0; c < tiles[0].length; c++) {
          const v = tiles[r][c];
          if (v === 2) {
            const wx = c * TILE_SIZE, wy = r * TILE_SIZE;
            if (wx + TILE_SIZE > camL && wx < camR && wy + TILE_SIZE > camT && wy < camB) {
              g.fillRect(wx, wy, TILE_SIZE, TILE_SIZE);
            }
          }
        }
      }
    }

    // ── A* blocked grid — cyan overlay (shows what A* pathfinding sees) ──
    if (this._staticBlockedGrid) {
      const CELL = HordeScene.PATH_CELL;
      const G = HordeScene.PATH_GRID;
      g.fillStyle(0x00FFFF, 0.15);
      g.lineStyle(1, 0x00FFFF, 0.4);
      for (let gy = 0; gy < G; gy++) {
        for (let gx = 0; gx < G; gx++) {
          if (this._staticBlockedGrid[gy * G + gx] === 1) {
            const wx = gx * CELL, wy = gy * CELL;
            if (wx + CELL > camL && wx < camR && wy + CELL > camT && wy < camB) {
              g.fillRect(wx, wy, CELL, CELL);
              g.strokeRect(wx, wy, CELL, CELL);
            }
          }
        }
      }
    }

    // ── Unit A* paths — green(p1)/red(p2) connected lines ──
    for (const u of this.units) {
      if (u.dead || !u.pathWaypoints || u.pathWaypoints.length === 0) continue;
      const color = u.team === 1 ? 0x44FF44 : u.team === 2 ? 0xFF4444 : 0xFFFFFF;
      g.lineStyle(2, color, 0.8);
      g.beginPath();
      g.moveTo(u.x, u.y);
      for (const wp of u.pathWaypoints) {
        g.lineTo(wp.x, wp.y);
      }
      g.strokePath();
      // Draw waypoint dots
      g.fillStyle(color, 0.9);
      for (const wp of u.pathWaypoints) {
        g.fillCircle(wp.x, wp.y, 4);
      }
    }


    // ── Bush zones — green outlines ──
    g.lineStyle(2, 0x00FF44, 0.6);
    for (const rect of this.bushRects) {
      if (rect.x + rect.w > camL && rect.x < camR && rect.y + rect.h > camT && rect.y < camB) {
        g.strokeRect(rect.x, rect.y, rect.w, rect.h);
      }
    }

    // ── Camp boundaries — yellow ellipses ──
    g.lineStyle(2, 0xFFDD00, 0.5);
    for (const c of this.camps) {
      if (inView(c.x, c.y, CAMP_RANGE * 1.3)) {
        g.strokeEllipse(c.x, c.y, CAMP_RANGE * 2.6, CAMP_RANGE * 1.5);
      }
    }

    // ── Tower attack ranges — cyan circles ──
    g.lineStyle(2, 0x00DDFF, 0.5);
    for (const t of this.towers) {
      if (!t.alive) continue;
      if (inView(t.x, t.y, t.range)) {
        g.strokeCircle(t.x, t.y, t.range);
      }
    }

    // ── Nexus attack ranges — magenta circles ──
    g.lineStyle(2, 0xFF44FF, 0.5);
    for (const n of this.nexuses) {
      if (inView(n.x, n.y, NEXUS_RANGE)) {
        g.strokeCircle(n.x, n.y, NEXUS_RANGE);
      }
    }

    // ── Mine ranges — gold circles ──
    g.lineStyle(2, 0xFFD700, 0.5);
    for (const m of this.mineNodes) {
      if (inView(m.x, m.y, MINE_RANGE)) {
        g.strokeCircle(m.x, m.y, MINE_RANGE);
      }
    }

    // ── Boundary blocks — white dashed rectangles (invisible walls) ──
    g.lineStyle(2, 0xFFFFFF, 0.6);
    for (const b of this.boundaryBlocks) {
      if (b.x + b.w > camL && b.x < camR && b.y + b.h > camT && b.y < camB) {
        g.strokeRect(b.x, b.y, b.w, b.h);
      }
    }

    // ── Unit hitboxes — green (friendly), red (enemy), white (neutral) ──
    for (const u of this.units) {
      if (u.dead || !inView(u.x, u.y, 30)) continue;
      // Separation/collision radius (20px)
      const color = u.team === 0 ? 0xAAAAAA : u.team === 1 ? 0x4499FF : 0xFF5555;
      g.lineStyle(1, color, 0.6);
      g.strokeCircle(u.x, u.y, 20);
      // Attack range
      g.lineStyle(1, 0xFF3333, 0.25);
      const atkRange = u.type === 'hyena' ? 120 : u.type === 'shaman' ? 100 : COMBAT_RANGE;
      g.strokeCircle(u.x, u.y, atkRange);
    }
  }

  private updateDebugResourceDisplay() {
    for (const team of [1, 2] as const) {
      for (const key of ['carrot', 'meat', 'crystal', 'metal'] as const) {
        const el = document.getElementById(`debug-res-${team}-${key}`);
        if (el) el.textContent = String(this.baseStockpile[team][key]);
      }
    }
  }
}
