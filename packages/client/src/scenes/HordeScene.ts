import Phaser from 'phaser';
import { FirebaseSync } from '../network/FirebaseSync';
import { HORDE_SPRITE_CONFIGS } from '../sprites/SpriteConfig';
import { MapDef, MapCampSlot, MapZoneDef, assignAnimalsToSlots, getMapById, ALL_MAPS } from '@prompt-battle/shared';

// ═══════════════════════════════════════════════════════════════
// GEMINI INTEGRATION
// ═══════════════════════════════════════════════════════════════

const GEMINI_API_KEY = (import.meta as any).env?.VITE_GEMINI_API_KEY || '';
const GEMINI_MODEL = 'gemini-2.5-flash';
const GEMINI_URL = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=`;
const GEMINI_MAX_RETRIES = 3;

interface GameContext {
  myUnits: { type: string; count: number; tier: number; gathering: number }[];
  camps: { name: string; animalType: string; tier: number; owner: string; index: number; x: number; y: number; dist: number; defenders: number; storedFood: number; spawnCost: number }[];
  nexusHp: { mine: number; enemy: number };
  resources: { carrot: number; meat: number; crystal: number };
  groundCarrots: number;
  groundMeat: number;
  groundCrystals: number;
  gameTime: number;
  selectedArmy: string;
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
  targetType: 'camp' | 'nearest_camp' | 'sweep_camps' | 'nexus' | 'base' | 'position' | 'defend' | 'retreat' | 'workflow';
  targetAnimal?: string;
  campIndex?: number;
  qualifier?: 'nearest' | 'furthest' | 'weakest' | 'strongest' | 'uncaptured' | 'enemy';
  // LLM-defined workflow steps — the LLM decides the full loop
  workflow?: { action: string; resourceType?: string; target?: string; targetType?: string; campIndex?: number; qualifier?: string; targetAnimal?: string; x?: number; y?: number }[];
  narration?: string;
  // Behavior modifiers — change how units execute, not what they do
  modifiers?: { formation?: string | null; caution?: string | null; pacing?: string | null };
  modifierOnly?: boolean; // true = only change modifiers, keep existing workflow
}

async function parseWithGemini(
  rawText: string,
  ctx: GameContext,
): Promise<HordeCommand[] | null> {
  if (!GEMINI_API_KEY) return null;

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
  Tier 1: gnome (🧝) = 1 carrot, turtle (🐢) = 1 carrot
  Tier 2: skull (💀) = 3 meat, spider (🕷️) = 3 meat, gnoll (🐺) = 3 meat
  Tier 3: panda (🐼) = 5 meat, lizard (🦎) = 5 meat
  Tier 4: minotaur (🐂) = 8 crystals, shaman (🔮) = 8 crystals
  Tier 5: troll (👹) = 12 crystals

HOW SPAWNING WORKS: Units gather a resource → carry it to a camp of the desired type → camp uses it to spawn that unit type. E.g. "make gnomes" means gather carrots and deliver to a gnome camp. "make skulls" means gather meat and deliver to a skull camp. Base stores resources but does NOT spawn units — only camps spawn units. Each team gets 1 free gnome from base every 30 seconds automatically.

To produce a unit, you MUST own a camp of that type. Camps start neutral with defenders — kill the defenders to capture.

ARMORY: 🏛️ Each team has an Armory building on their side of the map. Players can unlock equipment with resources, then units walk to the Armory to pick items up. Equipment is permanent (doesn't drop on death). Units can carry a resource AND have equipment.

EQUIPMENT (unlock once, unlimited pickups):
  ⛏️ Pickaxe (5🥕): Required to mine metal. +25% gather speed.
  ⚔️ Sword (5🍖+3⚙️): +50% attack, +25% attack speed. Offensive specialist.
  🛡️ Shield (5🍖+3⚙️): +60% HP, -25% damage taken, -15% speed. Tank.
  👢 Boots (5🥕+2⚙️): +60% move speed, +50% pickup range. Fast runner.
  🚩 Banner (8🍖+5⚙️): Aura — nearby allies +20% atk, +15% speed. Commander.

MINES: ⛏️ Mine nodes on the map. Only units with a Pickaxe can mine metal. Metal is used to unlock equipment.

To equip: include {"action":"equip","equipmentType":"pickaxe|sword|shield|boots|banner"} step BEFORE other steps. Unit walks to Armory, picks up item, then continues.
Example: "get pickaxes then go mine" → [{"action":"equip","equipmentType":"pickaxe"},{"action":"mine"},{"action":"deliver","target":"base"}]
Example: "get swords and attack wolf camp" → [{"action":"equip","equipmentType":"sword"},{"action":"attack_camp","targetAnimal":"gnoll","qualifier":"nearest"}]

═══ CURRENT GAME STATE ═══
Time: ${Math.floor(ctx.gameTime / 1000)}s
Selected army: ${ctx.selectedArmy} (player commands this group via hotkeys)

MY UNITS:
${unitList || '  (none)'}

MY RESOURCES: 🥕${ctx.resources.carrot} 🍖${ctx.resources.meat} 💎${ctx.resources.crystal}

CAMPS (sorted by distance):
${campList}

NEXUS HP: mine=${ctx.nexusHp.mine}/50000, enemy=${ctx.nexusHp.enemy}/50000

Ground items nearby: 🥕${ctx.groundCarrots} carrots, 🍖${ctx.groundMeat} meat, 💎${ctx.groundCrystals} crystals on the map

═══ BEHAVIOR MODIFIERS ═══
The player can set persistent modifiers that change HOW units execute. Modifiers don't change WHAT units do — just the style.
Available modifiers (all optional, persist until changed):

FORMATION: "spread" (fan out, space apart) | "tight" (group up, stay close) | null (clear)
  Keywords: spread out/fan out/scatter → spread | group up/stick together/stay close/cluster → tight

CAUTION: "safe" (retreat when hurt, avoid more, hunt weaker prey) | "aggressive" (no avoidance, engage from far, carriers fight) | null (clear)
  Keywords: careful/don't die/play safe/be careful → safe | go hard/no mercy/be aggressive/attack everything → aggressive

PACING: "rush" (faster restarts, lower idle tolerance) | "efficient" (1 claim per resource, smart picks) | null (clear)
  Keywords: rush/hurry/go fast → rush | be efficient/smart/one at a time → efficient

DISAMBIGUATION: "rush the base" → attack nexus (NOT rush modifier). "rush economy" → rush modifier.
  "go hard" → aggressive. Modifier-only commands (no workflow change): "be more careful" → modifierOnly=true.
  "back to normal" / "reset" → clear all modifiers. "stop spreading" → formation=null.

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
  {"action": "defend", "target": "base|nearest_TYPE_camp"} — guard a location, patrol nearby, fight enemies that approach
  {"action": "attack_enemies"} — seek and fight enemy player units relentlessly
  {"action": "scout"} — explore the map to reveal camps and enemy positions, AVOIDS all combat
  {"action": "collect", "resourceType": "carrot|meat|crystal"} — pick up ground resources while AVOIDING enemy units (safe gathering)
  {"action": "kill_only", "targetType": "skull|spider|..."} — hunt and kill wild animals but IGNORE resource drops (pure combat, no pickup)
  {"action": "mine"} — go to nearest mine node and extract metal, then carry it back (requires Pickaxe)
  {"action": "equip", "equipmentType": "pickaxe|sword|shield|boots|banner"} — walk to team Armory, pick up equipment

The workflow LOOPS automatically. Design the steps so they make a sensible repeating cycle.

SPECIAL: Turtles carry 10x resources per trip — they're slow but incredibly efficient haulers! Prefer assigning turtles to gather/deliver workflows.

═══ UNIT TRAITS & ROLES ═══
Each unit has unique strengths — use these to make smart workflow decisions:

GNOME (T1, 🧝): Fast, nimble, 2x pickup range. BEST gatherer for carrots. Cheap (1 carrot). Weak fighter — keep gathering, not fighting.
TURTLE (T1, 🐢): Slow but carries 10x resources per trip! Ultimate hauler. 1 carrot. Always prefer turtles for any gather/deliver workflow.
SKULL (T2, 💀): Cheats death once (survives lethal at 1 HP). Good fighter. 3 meat. Can self-sustain: hunt → pick meat → deliver to own camp.
SPIDER (T2, 🕷️): Fast ambusher. Great for raiding and hit-and-run. 3 meat.
GNOLL (T2, 🐺): Ranged attacker (120 range vs normal 60). Excellent for defense and kiting. 3 meat.
ROGUE (T2, 🗡️): Fast assassin. 3x damage on first hit against a new target (Backstab). Great for hit-and-run. 3 meat.
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
"bootstrap gnolls": [{"action":"attack_camp","targetAnimal":"gnoll","qualifier":"nearest"},{"action":"hunt"},{"action":"seek_resource","resourceType":"meat"},{"action":"deliver","target":"nearest_gnoll_camp"}]
"bootstrap rogues": [{"action":"attack_camp","targetAnimal":"rogue","qualifier":"nearest"},{"action":"hunt"},{"action":"seek_resource","resourceType":"meat"},{"action":"deliver","target":"nearest_rogue_camp"}]
"bootstrap pandas": [{"action":"attack_camp","targetAnimal":"panda","qualifier":"nearest"},{"action":"hunt"},{"action":"seek_resource","resourceType":"meat"},{"action":"deliver","target":"nearest_panda_camp"}]
"bootstrap lizards": [{"action":"attack_camp","targetAnimal":"lizard","qualifier":"nearest"},{"action":"hunt"},{"action":"seek_resource","resourceType":"meat"},{"action":"deliver","target":"nearest_lizard_camp"}]
"bootstrap minotaurs": [{"action":"attack_camp","targetAnimal":"minotaur","qualifier":"nearest"},{"action":"hunt","targetType":"minotaur"},{"action":"seek_resource","resourceType":"crystal"},{"action":"deliver","target":"nearest_minotaur_camp"}]
"bootstrap shamans": [{"action":"attack_camp","targetAnimal":"shaman","qualifier":"nearest"},{"action":"hunt","targetType":"minotaur"},{"action":"seek_resource","resourceType":"crystal"},{"action":"deliver","target":"nearest_shaman_camp"}]
"bootstrap troll": [{"action":"attack_camp","targetAnimal":"troll","qualifier":"nearest"},{"action":"hunt","targetType":"minotaur"},{"action":"seek_resource","resourceType":"crystal"},{"action":"deliver","target":"nearest_troll_camp"}]

═══ WORKFLOW EXAMPLES ═══

IMPORTANT: Any command involving "get", "make", "take", "produce", "create", "train", "spawn", or "breed" a unit type ALWAYS uses the FULL BOOTSTRAP workflow. This means: attack_camp FIRST (to capture it if needed), THEN gather resources, THEN deliver. NEVER skip the attack_camp step for production commands. NOTE: at runtime, if the player already owns a camp of the target type, the attack_camp step is automatically skipped — units go straight to gathering.

PRODUCTION (ALWAYS bootstrap — capture camp + gather + deliver):
"make gnomes" → [{"action":"attack_camp","targetAnimal":"gnome","qualifier":"nearest"},{"action":"seek_resource","resourceType":"carrot"},{"action":"deliver","target":"nearest_gnome_camp"}]
"get skulls" → [{"action":"attack_camp","targetAnimal":"skull","qualifier":"nearest"},{"action":"hunt"},{"action":"seek_resource","resourceType":"meat"},{"action":"deliver","target":"nearest_skull_camp"}]
"take pandas" → [{"action":"attack_camp","targetAnimal":"panda","qualifier":"nearest"},{"action":"hunt"},{"action":"seek_resource","resourceType":"meat"},{"action":"deliver","target":"nearest_panda_camp"}]
"make shamans" → [{"action":"attack_camp","targetAnimal":"shaman","qualifier":"nearest"},{"action":"hunt","targetType":"minotaur"},{"action":"seek_resource","resourceType":"crystal"},{"action":"deliver","target":"nearest_shaman_camp"}]

CROSS-UNIT PRODUCTION (still bootstraps):
"gnomes make skulls" → [{"action":"attack_camp","targetAnimal":"skull","qualifier":"nearest"},{"action":"seek_resource","resourceType":"meat"},{"action":"deliver","target":"nearest_skull_camp"}]
"turtles make pandas" → [{"action":"attack_camp","targetAnimal":"panda","qualifier":"nearest"},{"action":"seek_resource","resourceType":"meat"},{"action":"deliver","target":"nearest_panda_camp"}]
"skulls make skulls" → [{"action":"attack_camp","targetAnimal":"skull","qualifier":"nearest"},{"action":"hunt"},{"action":"seek_resource","resourceType":"meat"},{"action":"deliver","target":"nearest_skull_camp"}]

HUNTING:
"hunt wilds" → [{"action":"hunt"}]
"farm meat" → [{"action":"hunt"},{"action":"seek_resource","resourceType":"meat"},{"action":"deliver","target":"base"}]
"farm elites" → [{"action":"hunt","targetType":"minotaur"},{"action":"seek_resource","resourceType":"crystal"},{"action":"deliver","target":"base"}]

GATHER & STOCKPILE:
"stockpile carrots" → [{"action":"seek_resource","resourceType":"carrot"},{"action":"deliver","target":"base"}]
"stockpile meat" → [{"action":"seek_resource","resourceType":"meat"},{"action":"deliver","target":"base"}]

RAIDING & CAPTURE:
"raid enemy" → [{"action":"attack_camp","qualifier":"enemy"}]
"sweep uncaptured" → [{"action":"attack_camp","qualifier":"uncaptured"}]

DEFEND & ATTACK:
"defend base" → [{"action":"defend","target":"base"}]
"guard gnome camp" → [{"action":"defend","target":"nearest_gnome_camp"}]
"attack enemies" → [{"action":"attack_enemies"}]
"hunt enemies then defend" → [{"action":"attack_enemies"},{"action":"defend","target":"base"}]

SCOUTING:
"scout" / "explore" / "recon" → [{"action":"scout"}]

SAFE GATHERING (avoid enemies):
"collect meat" / "pick up meat safely" → [{"action":"collect","resourceType":"meat"}]
"collect carrots" / "gather carrots safely" → [{"action":"collect","resourceType":"carrot"}]
"collect crystals" → [{"action":"collect","resourceType":"crystal"}]

KILL ONLY (fight but skip drops):
"just kill" / "kill only" → [{"action":"kill_only"}]
"kill wilds" / "clear animals" → [{"action":"kill_only"}]
"kill elites" → [{"action":"kill_only","targetType":"minotaur"}]

MINING:
"mine metal" → [{"action":"mine"},{"action":"deliver","target":"base"}]
"farm metal" → [{"action":"mine"},{"action":"deliver","target":"base"}]

STRATEGIC:
"get started" → bootstrap gnomes (cheapest, fastest economy start)

SIMPLE MOVEMENT (no workflow):
"attack nearest camp" → targetType: "nearest_camp", qualifier: "nearest"
"attack nexus" → targetType: "nexus"
"retreat" → targetType: "retreat"

═══ STRATEGIC REASONING ═══
Before choosing a workflow, think:
1. What does the player want? (produce, gather, fight, defend?)
2. ANY command about getting/making/taking/producing a unit type → ALWAYS use FULL BOOTSTRAP (attack_camp + gather + deliver). Never skip attack_camp.
3. What resource? (carrots→T1, meat→T2-T3, crystals→T4-T5)
4. For meat/crystals → include "hunt" BEFORE "seek_resource" (those come from kills).
5. For carrots → just "seek_resource" (they spawn naturally).
6. Best unit for the job? (gnomes=fast gather, turtles=10x haul, skulls=self-sustain hunters)
7. Design the workflow as a LOOP that makes sense repeated forever.

═══ YOUR JOB ═══
Interpret the player's voice command using your deep understanding of the economy and unit traits.
- "get X" / "make X" / "take X" / "produce X" / "create X" / "train X" / "spawn X" → ALWAYS bootstrap X (attack_camp + resource gathering + deliver)
- "bootstrap X" → same as above
- "get started" → bootstrap gnomes (cheapest start)
- Be creative — combine steps based on what makes strategic sense
- If you can tell which unit type is selected, tailor the workflow to their strengths

RULES:
- Output exactly ONE command (army selection is handled separately by hotkeys).
- ALWAYS pick the best interpretation — never refuse.
- Match camp names by partial word.

PLAYER SAYS: "${rawText}"

JSON ONLY (no markdown):
{
  "targetType": "<camp|nearest_camp|sweep_camps|nexus|base|defend|retreat|workflow>",
  "targetAnimal": "<animal type or omit>",
  "campIndex": <index or -1>,
  "qualifier": "<nearest|furthest|weakest|uncaptured|enemy or omit>",
  "workflow": [<array of step objects, only if targetType=workflow>],
  "narration": "<One dramatic sentence>",
  "modifiers": {"formation": "spread|tight|null", "caution": "safe|aggressive|null", "pacing": "rush|efficient|null"},
  "modifierOnly": false
}`;

  const body = JSON.stringify({
    contents: [{ parts: [{ text: prompt }] }],
    generationConfig: {
      maxOutputTokens: 700,
      responseMimeType: 'application/json',
    },
  });

  for (let attempt = 0; attempt < GEMINI_MAX_RETRIES; attempt++) {
    try {
      const response = await fetch(GEMINI_URL + GEMINI_API_KEY, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body,
      });

      if (response.status === 429) {
        // Rate limited — wait and retry with exponential backoff
        const wait = 1000 * Math.pow(2, attempt); // 1s, 2s, 4s
        console.warn(`[Gemini] 429 rate limited, retrying in ${wait}ms (attempt ${attempt + 1}/${GEMINI_MAX_RETRIES})`);
        await new Promise(r => setTimeout(r, wait));
        continue;
      }

      if (!response.ok) {
        console.warn('[Gemini] API error:', response.status);
        return null;
      }

      const data = await response.json();
      const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
      if (!text) return null;

      const parsed = JSON.parse(text);
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
  mineSpeed: number; // mining speed multiplier (1.0 = base 2s tick, higher = faster)
}

type ResourceType = 'carrot' | 'meat' | 'crystal' | 'metal';

interface HGroundItem {
  id: number;
  type: ResourceType;
  x: number;
  y: number;
  sprite: Phaser.GameObjects.Text | null;
  dead: boolean;
  age: number; // ms since spawn, for despawn
}

interface HMineNode {
  id: string;
  x: number;
  y: number;
  sprite: Phaser.GameObjects.Text | null;
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
  | { action: 'scout' }                                       // explore the map, reveal camps/enemies, avoid combat
  | { action: 'collect'; resourceType: ResourceType }         // pick up ground resources while avoiding enemies
  | { action: 'kill_only'; targetType?: string }              // hunt and kill wild animals but ignore drops
  | { action: 'mine' };                                       // go to nearest mine, extract metal

interface HWorkflow {
  steps: WorkflowStep[];
  currentStep: number;
  label: string; // LLM-provided description, shown in HUD
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
  mods: BehaviorMods; // behavior modifiers (formation, caution, pacing)
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
  area: Phaser.GameObjects.Arc | null;
  captureBar: Phaser.GameObjects.Graphics | null;
  storedFood: number; // food stored toward next spawn
  // Fog of war: remember last-seen state
  scouted: boolean;          // has this camp ever been revealed?
  lastSeenOwner: 0 | 1 | 2;  // owner when last in vision
  lastSeenLabel: string;      // label text when last in vision
  lastSeenColor: string;      // label color when last in vision
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
}

interface HordeSyncUnit {
  id: number; type: string; team: number;
  hp: number; maxHp: number; attack: number; speed: number;
  x: number; y: number; targetX: number; targetY: number;
  dead: boolean; campId: string | null;
}

interface HordeSyncState {
  units: HordeSyncUnit[];
  camps: { id: string; owner: number; spawnTimer: number }[];
  nexuses: { team: number; hp: number }[];
  rallyPoints: Record<string, { x: number; y: number }>;
  baseSpawnTimers: { 1: number; 2: number };
  nextId: number;
  gameTime: number;
  gameOver: boolean;
  winner: number | null;
}

// ═══════════════════════════════════════════════════════════════
// CONSTANTS
// ═══════════════════════════════════════════════════════════════

const WORLD_W = 3200;
const WORLD_H = 3200;
const P1_BASE = { x: 250, y: WORLD_H - 250 };
const P2_BASE = { x: WORLD_W - 250, y: 250 };

// ─── UNIT ROSTER ──────────────────────────────────────────
// Each unit has a distinct role, stat profile, and unique ability.
//
// T1 WORKERS — cheap, resource gatherers
//   🧝 Gnome   "Nimble Hands" — Fastest gatherer. 2x pickup range. Born to gather.
//   🐢 Turtle  "Shell Stance" — Slowest unit but tankiest T1. 60% DR when guarding.
//
// T2 FIGHTERS — mid-game combat specialists
//   💀 Skull   "Undying"      — Cheats death once (survives at 1 HP).
//   🕷️ Spider  "Venom Bite"   — Slow assassin. +5% target max HP per hit.
//   🐺 Gnoll   "Bone Toss"    — Extended range (120 vs 80).
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

const ANIMALS: Record<string, AnimalDef> = {
  gnome:     { type: 'gnome',     emoji: '🧝', hp: 15,    attack: 3,    speed: 210, tier: 1, ability: 'Nimble Hands', desc: '2x pickup range, fastest gatherer', mineSpeed: 2.0 },
  turtle:    { type: 'turtle',    emoji: '🐢', hp: 65,    attack: 3,    speed: 55,  tier: 1, ability: 'Shell Stance', desc: '60% DR when guarding (stationary)', mineSpeed: 1.5 },
  skull:     { type: 'skull',     emoji: '💀', hp: 80,    attack: 14,   speed: 155, tier: 2, ability: 'Undying',      desc: 'Cheats death once (survives at 1 HP)', mineSpeed: 0.8 },
  spider:    { type: 'spider',    emoji: '🕷️', hp: 120,   attack: 18,   speed: 85,  tier: 2, ability: 'Venom Bite',   desc: '+5% target max HP per hit', mineSpeed: 0.6 },
  gnoll:     { type: 'gnoll',     emoji: '🐺', hp: 55,    attack: 28,   speed: 175, tier: 2, ability: 'Bone Toss',    desc: 'Extended range (120 vs 80)', mineSpeed: 0.8 },
  panda:     { type: 'panda',     emoji: '🐼', hp: 900,   attack: 35,   speed: 80,  tier: 3, ability: 'Thick Hide',   desc: 'Regenerates 1% max HP/sec', mineSpeed: 0.5 },
  lizard:    { type: 'lizard',    emoji: '🦎', hp: 450,   attack: 70,   speed: 110, tier: 3, ability: 'Cold Blood',   desc: '3x dmg to targets below 40% HP', mineSpeed: 0.7 },
  minotaur:  { type: 'minotaur',  emoji: '🐂', hp: 2200,  attack: 110,  speed: 120, tier: 4, ability: 'War Cry',      desc: 'Nearby allies +25% attack', mineSpeed: 0.4 },
  shaman:    { type: 'shaman',    emoji: '🔮', hp: 1400,  attack: 180,  speed: 100, tier: 4, ability: 'Arcane Blast', desc: 'All attacks splash 60px', mineSpeed: 0.5 },
  troll:     { type: 'troll',     emoji: '👹', hp: 14000, attack: 350,  speed: 50,  tier: 5, ability: 'Club Slam',    desc: 'Massive 90px splash, slows enemies', mineSpeed: 0.3 },
  rogue:     { type: 'rogue',     emoji: '🗡️', hp: 60,    attack: 45,   speed: 200, tier: 2, ability: 'Backstab',    desc: '3x damage on first hit against a target', mineSpeed: 1.0 },
};

// Hard counter map: attacker → types it deals 2x damage to
// Designed around the ability matchups:
const HARD_COUNTERS: Record<string, string[]> = {
  gnome:     [],                       // pure worker, wins by speed
  turtle:    ['gnome'],                // shell absorbs weak hits
  skull:     ['gnoll', 'spider'],      // undying outlasts fragile specialists
  spider:    ['panda', 'turtle'],      // venom shreds tanky slow targets
  gnoll:     ['spider', 'gnome'],      // ranged picks off slow/fragile targets
  panda:     ['skull', 'lizard'],      // regen too tanky to burst or execute
  lizard:    ['panda', 'minotaur'],    // cold blood executes the biggest targets
  minotaur:  ['skull', 'shaman'],      // war cry + stats overwhelm undying and casters
  shaman:    ['troll', 'minotaur'],    // arcane blast burns down big slow targets
  troll:     ['shaman', 'gnoll'],      // club slam crushes casters and ranged
  rogue:     ['gnome', 'shaman'],     // backstab bursts down fragile targets
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
    'Gear Gorge', 'Glimmer Gap', 'Gizmo Grounds', 'Grassy Gnoll',
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
  gnoll: [
    'Gnash Gate', 'Growl Gorge', 'Grunt Gully', 'Gnaw Grounds',
    'Grim Garrison', 'Growling Glen', 'Gnoll Notch', 'Gore Gulch',
    'Gravel Gap', 'Gnarl Grove', 'Grudge Garden', 'Gnoll Nook',
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
    gnome: 1, turtle: 1, skull: 1, spider: 1, gnoll: 1, rogue: 1,
    panda: 1, lizard: 1, minotaur: 1, shaman: 1, troll: 1,
  };
  const SPAWN_MS: Record<string, number> = {
    gnome: 4000, turtle: 4500, skull: 6000, spider: 6000, gnoll: 5500, rogue: 5500,
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
    { type: 'gnoll',  distFromBase: 900,  angleOffset: 0.6 },
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
      id: `camp_${idx++}`, name: `${def.emoji} ${name1}`,
      type: layout.type, x, y,
      guards: GUARD_COUNT[layout.type], spawnMs: SPAWN_MS[layout.type], buff: buff1,
    });
    camps.push({
      id: `camp_${idx++}`, name: `${def.emoji} ${name2}`,
      type: layout.type, x: Math.round(mx), y: Math.round(my),
      guards: GUARD_COUNT[layout.type], spawnMs: SPAWN_MS[layout.type], buff: buff2,
    });
  }

  // ─── TROLL — single camp in the center of the map ───
  const trollDef = ANIMALS['troll'];
  const trollName = pickCampName('troll', rng);
  camps.push({
    id: `camp_${idx++}`, name: `${trollDef.emoji} ${trollName}`,
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
    gnome: 1, turtle: 1, skull: 1, spider: 1, gnoll: 1, rogue: 1,
    panda: 1, lizard: 1, minotaur: 1, shaman: 1, troll: 1,
  };
  const SPAWN_MS: Record<string, number> = {
    gnome: 4000, turtle: 4500, skull: 6000, spider: 6000, gnoll: 5500, rogue: 5500,
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
      id: `camp_${idx++}`, name: `${def.emoji} ${name1}`,
      type: animalType, x: slot.bluePos.x, y: slot.bluePos.y,
      guards: GUARD_COUNT[animalType], spawnMs: SPAWN_MS[animalType], buff: buff1,
    });
    camps.push({
      id: `camp_${idx++}`, name: `${def.emoji} ${name2}`,
      type: animalType, x: slot.redPos.x, y: slot.redPos.y,
      guards: GUARD_COUNT[animalType], spawnMs: SPAWN_MS[animalType], buff: buff2,
    });
  }

  // Troll camp (center boss) if defined
  if (mapDef.trollSlot) {
    const trollDef = ANIMALS['troll'];
    const trollName = pickCampName('troll', rng);
    camps.push({
      id: `camp_${idx++}`, name: `${trollDef.emoji} ${trollName}`,
      type: 'troll', x: mapDef.trollSlot.x, y: mapDef.trollSlot.y,
      guards: GUARD_COUNT['troll'], spawnMs: SPAWN_MS['troll'],
      buff: { stat: 'all', value: 0.10 },
    });
  }

  return camps;
}
const NEXUS_MAX_HP = 50000;
const MAX_UNITS = 80;
const BASE_SPAWN_MS = 5000; // (legacy, unused)
const FREE_GNOME_MS = 30000; // free gnome from base every 30s
const ATTACK_CD_MS = 1500;
const COMBAT_RANGE = 80;
const CAMP_RANGE = 120;
const AI_TICK_MS = 4000;
const TEAM_COLORS = { 1: 0x4499FF, 2: 0xFF5555 };
const FOG_VISION_RANGE = 400; // radius of vision around each ally unit
const GOLDEN_ANGLE = 2.39996;

// ─── RESOURCE ECONOMY ──────────────────────────────────────
const SPAWN_COSTS: Record<string, { type: ResourceType; amount: number }> = {
  gnome:     { type: 'carrot',  amount: 1 },
  turtle:    { type: 'carrot',  amount: 1 },
  skull:     { type: 'meat',    amount: 3 },
  spider:    { type: 'meat',    amount: 3 },
  gnoll:     { type: 'meat',    amount: 3 },
  panda:     { type: 'meat',    amount: 5 },
  lizard:    { type: 'meat',    amount: 5 },
  minotaur:  { type: 'crystal', amount: 8 },
  shaman:    { type: 'crystal', amount: 8 },
  troll:     { type: 'crystal', amount: 12 },
  rogue:     { type: 'meat',    amount: 3 },
};
const RESOURCE_EMOJI: Record<ResourceType, string> = { carrot: '🥕', meat: '🍖', crystal: '💎', metal: '⚙️' };

// ─── FORGE UPGRADES ──────────────────────────────────────
interface ForgeUpgrade {
  id: string;
  name: string;
  emoji: string;
  tier: 1 | 2 | 3;
  cost: Partial<Record<ResourceType, number>>;
  effect: string; // description
}

const FORGE_UPGRADES: ForgeUpgrade[] = [
  // Tier 1 — Carrots + Metal
  { id: 'iron_weapons',    name: 'Iron Weapons',    emoji: '⚔️', tier: 1, cost: { carrot: 5, metal: 3 }, effect: '+20% attack' },
  { id: 'wooden_shields',  name: 'Wooden Shields',  emoji: '🛡️', tier: 1, cost: { carrot: 5, metal: 3 }, effect: '+20% max HP' },
  { id: 'swift_boots',     name: 'Swift Boots',     emoji: '👢', tier: 1, cost: { carrot: 5, metal: 3 }, effect: '+15% speed' },
  { id: 'gatherer_gloves', name: 'Gatherer Gloves', emoji: '🧤', tier: 1, cost: { carrot: 5, metal: 2 }, effect: '+50% pickup range' },
  // Tier 2 — Meat + Metal (requires 2 T1 upgrades)
  { id: 'steel_weapons',   name: 'Steel Weapons',   emoji: '🗡️', tier: 2, cost: { meat: 8, metal: 5 }, effect: '+30% attack' },
  { id: 'chainmail',       name: 'Chainmail',       emoji: '🔗', tier: 2, cost: { meat: 8, metal: 5 }, effect: '+30% max HP' },
  { id: 'war_drums',       name: 'War Drums',       emoji: '🥁', tier: 2, cost: { meat: 6, metal: 4 }, effect: '-25% attack cooldown' },
  { id: 'lifesteal',       name: 'Lifesteal',       emoji: '🩸', tier: 2, cost: { meat: 10, metal: 6 }, effect: '10% lifesteal' },
  { id: 'thorns',          name: 'Thorns',          emoji: '🌹', tier: 2, cost: { meat: 8, metal: 5 }, effect: '15% damage reflect' },
  // Tier 3 — Crystals + Metal (requires 2 T2 upgrades)
  { id: 'enchanted_blades', name: 'Enchanted Blades', emoji: '✨', tier: 3, cost: { crystal: 6, metal: 8 }, effect: '+50% attack' },
  { id: 'dragon_scale',     name: 'Dragon Scale',     emoji: '🐉', tier: 3, cost: { crystal: 6, metal: 8 }, effect: '+50% max HP' },
  { id: 'berserker_rage',   name: 'Berserker Rage',   emoji: '💢', tier: 3, cost: { crystal: 5, metal: 6 }, effect: '2x attack speed below 30% HP' },
  { id: 'siege_mastery',    name: 'Siege Mastery',     emoji: '🏰', tier: 3, cost: { crystal: 5, metal: 6 }, effect: '+100% nexus damage' },
];

const CARROT_SPAWN_MS = 5000;       // new carrots every 5s
const MAX_GROUND_ITEMS = 150;
const ITEM_DESPAWN_MS = 90000;      // ground items vanish after 90s
const PICKUP_RANGE = 35;
const WILD_ANIMAL_COUNT = 30;       // neutral roaming animals — concentrated in corners
const ELITE_PREY_COUNT = 3;         // golden elite prey (T4 stats, drop crystals)
const WILD_RESPAWN_MS = 20000;      // respawn wild animals every 20s
const MINE_COUNT = 4; // 2 per side, mirrored
const MINE_TICK_MS = 2000; // mine produces metal every 2s while a unit stands on it
const MINE_RANGE = 50; // how close to be "mining"

function pdist(a: { x: number; y: number }, b: { x: number; y: number }): number {
  const dx = a.x - b.x, dy = a.y - b.y;
  return Math.sqrt(dx * dx + dy * dy);
}

// ═══════════════════════════════════════════════════════════════
// SCENE
// ═══════════════════════════════════════════════════════════════

export class HordeScene extends Phaser.Scene {
  private units: HUnit[] = [];
  private camps: HCamp[] = [];
  private nexuses: HNexus[] = [];
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
  // Era progression — goal-based unlocks
  private currentEra = 1;
  private eliteKillCount = 0;
  private baseStockpile = {
    1: { carrot: 0, meat: 0, crystal: 0, metal: 0 },
    2: { carrot: 0, meat: 0, crystal: 0, metal: 0 },
  };
  private forgeUpgrades: Record<1 | 2, Set<string>> = { 1: new Set(), 2: new Set() };

  private hudTexts: Record<string, Phaser.GameObjects.Text> = {};
  private textInput: HTMLInputElement | null = null;
  private voiceStatusEl: HTMLDivElement | null = null;
  private transcriptEl: HTMLSpanElement | null = null;

  // Command history tracking
  private commandHistory: { command: string; outcome: string; color: string; time: number }[] = [];
  private cmdHistoryEl: HTMLDivElement | null = null;
  private pendingCommandText: string | null = null;
  // Last voice command per army type (shown on army bar cards)
  private lastArmyCommand: Record<string, string> = {};

  // Fog of war
  private fogRT: Phaser.GameObjects.RenderTexture | null = null;
  private fogBrush: Phaser.GameObjects.Graphics | null = null;

  private wasdKeys!: Record<string, Phaser.Input.Keyboard.Key>;
  private spaceKey!: Phaser.Input.Keyboard.Key;
  private recognition: any = null;
  private isListening = false;

  private isDragging = false;
  private dragPrevX = 0;
  private dragPrevY = 0;
  private dragMoved = false; // did mouse move during this drag? (to distinguish click vs drag)

  // Debug: click a unit to inspect it
  private debugUnit: HUnit | null = null;
  private debugText: Phaser.GameObjects.Text | null = null;
  private debugHighlight: Phaser.GameObjects.Arc | null = null;

  // Persistent rally points: key = "type_team", value = {x, y}
  // When you command "gnomes attack skull camp", ALL future gnomes also go there
  private rallyPoints: Record<string, { x: number; y: number }> = {};
  // Active workflow per group — new spawns inherit this automatically
  private groupWorkflows: Record<string, HWorkflow> = {};
  private groupModifiers: Record<string, BehaviorMods> = {};
  private activeSweeps: Record<string, {
    team: 1 | 2; subject: string;
    targets: { x: number; y: number; id: string }[]; currentIdx: number;
  }> = {};

  // Army selection: TAB cycles forward, Shift+TAB cycles back, number keys direct-pick
  private selectedArmy: string = 'all';
  // Cycle order: all → then only types the player currently has units of
  private allArmyTypes = ['all', 'gnome', 'turtle', 'skull', 'spider', 'gnoll', 'panda', 'lizard', 'minotaur', 'shaman', 'troll'];
  private armyKeys: Record<string, string> = {
    '1': 'all', '2': 'gnome', '3': 'skull', '4': 'panda', '5': 'minotaur', '6': 'troll',
    '7': 'turtle', '8': 'spider', '9': 'gnoll', '0': 'lizard',
  };
  private selectionLabel: Phaser.GameObjects.Text | null = null;
  private armyBarEl: HTMLDivElement | null = null;
  private charPanelEl: HTMLDivElement | null = null;

  // ─── MAP CONFIG ──────────────────────────────────────────────
  private mapDef: MapDef | null = null;
  private activeCampDefs: CampDef[] = CAMP_DEFS;

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

  init(data?: HordeSceneData) {
    this.isOnline = data?.isOnline || false;
    this.gameId = data?.gameId || null;
    this.playerId = data?.playerId || null;
    // Player 1 (host) = team 1 (bottom-left), Player 2 (guest) = team 2 (top-right)
    this.isHost = data?.amPlayer1 !== false; // default host if solo
    this.myTeam = this.isHost ? 1 : 2;

    // Map selection: solo can pick any map, multiplayer uses default
    const mapId = this.isOnline ? 'default' : (data?.mapId || 'default');
    if (mapId !== 'default') {
      this.mapDef = getMapById(mapId);
      const seed = Date.now();
      this.activeCampDefs = makeCampsFromMap(this.mapDef, seed);
    } else {
      this.mapDef = null;
      this.activeCampDefs = CAMP_DEFS;
    }
  }

  create() {
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
    this.selectedArmy = 'all';
    this.groundItems = [];
    this.nextItemId = 0;
    this.carrotSpawnTimer = 0;
    this.wildRespawnTimer = 0;
    this.freeGnomeTimer = 0;
    this.currentEra = 1;
    this.eliteKillCount = 0;
    this.baseStockpile = {
      1: { carrot: 0, meat: 0, crystal: 0, metal: 0 },
      2: { carrot: 0, meat: 0, crystal: 0, metal: 0 },
    };
    this.forgeUpgrades = { 1: new Set(), 2: new Set() };

    this.syncTimer = 0;

    this.cameras.main.setBackgroundColor('#1a1a2e');
    this.drawBackground();
    this.setupCamps();
    this.initMineNodes();
    this.setupNexuses();
    this.setupFog();
    this.setupCamera();
    this.setupInput();
    this.setupHUD();
    this.events.on('shutdown', () => this.cleanupHTML());

    // Starting gnomes — only host/solo spawns units; guest gets them via sync
    if (!this.isOnline || this.isHost) {
      for (let i = 0; i < 3; i++) {
        this.spawnUnit('gnome', 1, P1_BASE.x + 50 + i * 20, P1_BASE.y - 50);
        this.spawnUnit('gnome', 2, P2_BASE.x - 50 - i * 20, P2_BASE.y + 50);
      }
      // Wild animals no longer spawn at start — they unlock with Era 2
    }

    // ─── ONLINE SETUP ───
    if (this.isOnline && this.gameId) {
      this.firebase = FirebaseSync.getInstance();
      if (this.isHost) {
        // Host: listen for guest commands
        this.firebase.onRemoteOrders(this.gameId, (data) => {
          if (data.orders) {
            for (const entry of data.orders) {
              // entry is { heroId, order: { text, team } }
              const cmd = (entry as any).order || entry;
              if (cmd.text && cmd.team) {
                this.handleCommand(cmd.text, cmd.team as 1 | 2);
              }
            }
          }
          // Clean up processed order
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
    const g = this.add.graphics();

    // Solid clean grass field
    g.fillStyle(0x1e3a14, 1);
    g.fillRect(0, 0, WORLD_W, WORLD_H);

    // Subtle lighter patches for depth — large soft rectangles, not noisy
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
      g.fillStyle(0x254a1a, 0.25);
      g.fillRoundedRect(p.x, p.y, p.w, p.h, 80);
    }

    // Thin border around the play area
    g.lineStyle(3, 0x122e0e, 0.5);
    g.strokeRect(0, 0, WORLD_W, WORLD_H);

    // Very faint base territory indicators — soft circles, not harsh rings
    g.fillStyle(0x4499FF, 0.04);
    g.fillCircle(P1_BASE.x, P1_BASE.y, 500);
    g.fillStyle(0xFF5555, 0.04);
    g.fillCircle(P2_BASE.x, P2_BASE.y, 500);
  }

  // ─── FOG OF WAR ─────────────────────────────────────────────

  private setupFog() {
    // RenderTexture covering the whole world — filled dark, erased around allies
    this.fogRT = this.add.renderTexture(0, 0, WORLD_W, WORLD_H)
      .setOrigin(0)
      .setDepth(50) // above world objects (units=20, items=15) but below camps-above-fog (51-53) and HUD (100)
      .setAlpha(0.65); // semi-transparent — looks like real fog you can see through

    // Reusable brush for punching vision holes — sharp binary cutoff
    this.fogBrush = this.make.graphics({ x: 0, y: 0 }, false);
    this.fogBrush.fillStyle(0xffffff, 1.0);
    this.fogBrush.fillCircle(FOG_VISION_RANGE, FOG_VISION_RANGE, FOG_VISION_RANGE);
  }

  private updateFog() {
    if (!this.fogRT || !this.fogBrush) return;

    // Cache vision sources for this frame
    this.buildVisionCache();

    // Fill with black (fog)
    this.fogRT.fill(0x000000);

    // Erase fog around all vision sources (base, allies, enemy nexus)
    for (const s of this.visionSources) {
      this.fogRT.erase(this.fogBrush, s.x - FOG_VISION_RANGE, s.y - FOG_VISION_RANGE);
    }
  }

  /** Hide/show sprites based on fog of war vision */
  private updateFogVisibility() {
    const enemyTeam = this.myTeam === 1 ? 2 : 1;

    // Hide/show enemy and neutral unit sprites
    for (const u of this.units) {
      if (u.team === this.myTeam) continue; // always show own units
      const visible = this.isInVision(u.x, u.y);
      if (u.sprite) u.sprite.setVisible(visible);
      if (u.carrySprite) u.carrySprite.setVisible(visible);
    }

    // Hide/show ground items outside vision
    for (const item of this.groundItems) {
      if (item.dead || !item.sprite) continue;
      item.sprite.setVisible(this.isInVision(item.x, item.y));
    }

    // Camp visuals: always show outline, but use last-known info if not in vision
    for (const c of this.camps) {
      const visible = this.isInVision(c.x, c.y);
      // Own camps are always fully visible
      if (c.owner === this.myTeam) {
        c.scouted = true;
        c.lastSeenOwner = c.owner;
        if (c.label) { c.lastSeenLabel = c.label.text; c.lastSeenColor = c.label.style.color as string; }
        continue;
      }
      if (visible) {
        // Mark as scouted, snapshot current info
        c.scouted = true;
        c.lastSeenOwner = c.owner;
        if (c.label) { c.lastSeenLabel = c.label.text; c.lastSeenColor = c.label.style.color as string; }
        // updateCampVisuals() already set the correct live info
      } else {
        // Out of vision
        if (c.captureBar) c.captureBar.clear();
        if (c.scouted) {
          // Show last-known info (frozen state)
          const lastColor = c.lastSeenOwner === 0 ? 0xFFD93D
            : c.lastSeenOwner === this.myTeam ? 0x4499FF : 0xFF5555;
          c.area?.setFillStyle(lastColor, 0.05);
          c.area?.setStrokeStyle(2, lastColor, 0.2);
          if (c.label) {
            c.label.setText(c.lastSeenLabel);
            c.label.setColor(c.lastSeenColor);
          }
        } else {
          // Never scouted — yellow unknown, just show outline
          c.area?.setFillStyle(0xFFD93D, 0.04);
          c.area?.setStrokeStyle(2, 0xFFD93D, 0.15);
          if (c.label) {
            c.label.setText('???');
            c.label.setColor('#FFD93D');
          }
        }
      }
    }
  }

  // Cached vision sources for the current frame (avoids re-filtering allies per query)
  private visionSources: { x: number; y: number }[] = [];

  private buildVisionCache() {
    this.visionSources = [];
    // Own base
    this.visionSources.push(this.myTeam === 1 ? P1_BASE : P2_BASE);
    // Enemy nexus always visible
    this.visionSources.push(this.myTeam === 1 ? P2_BASE : P1_BASE);
    // Allied units
    for (const u of this.units) {
      if (u.dead || u.team !== this.myTeam) continue;
      this.visionSources.push(u);
    }
  }

  /** Check if a world position is currently visible (within vision range of any ally) */
  private isInVision(x: number, y: number): boolean {
    const r2 = FOG_VISION_RANGE * FOG_VISION_RANGE;
    for (const s of this.visionSources) {
      const dx = x - s.x, dy = y - s.y;
      if (dx * dx + dy * dy < r2) return true;
    }
    return false;
  }

  // ─── CAMPS ───────────────────────────────────────────────────

  private setupCamps() {
    for (const def of this.activeCampDefs) {
      const animalDef = ANIMALS[def.type];

      const area = this.add.circle(def.x, def.y, CAMP_RANGE, 0xFFD93D, 0.06);
      area.setStrokeStyle(2, 0xFFD93D, 0.25);
      area.setDepth(51); // above fog (50) — always visible through fog

      const label = this.add.text(def.x, def.y - 55, def.name, {
        fontSize: '18px', color: '#FFD93D', fontFamily: '"Nunito", sans-serif', fontStyle: 'bold',
        stroke: '#000000', strokeThickness: 4,
      }).setOrigin(0.5).setDepth(52); // above fog — shows "???" or scouted type

      const captureBar = this.add.graphics().setDepth(53); // above fog

      const camp: HCamp = {
        id: def.id, name: def.name, animalType: def.type, tier: animalDef.tier,
        guardCount: def.guards,
        x: def.x, y: def.y, owner: 0,
        spawnMs: def.spawnMs, spawnTimer: 0, buff: def.buff,
        label, area, captureBar, storedFood: 0,
        scouted: false, lastSeenOwner: 0, lastSeenLabel: '', lastSeenColor: '#FFD93D',
      };
      this.camps.push(camp);

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
      const gx = camp.x + Math.cos(angle) * 50;
      const gy = camp.y + Math.sin(angle) * 50;
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
        hasRebirth: camp.animalType === 'skull',
        diveReady: false,
        diveTimer: 0,
        lastAttackTarget: -1, attackFaceX: null, mods: { ...DEFAULT_MODS },
        carrying: null, carrySprite: null, loop: null, isElite: false, idleTimer: 0, claimItemId: -1,
      });
    }
  }

  // ─── MINE NODES ─────────────────────────────────────────────

  private initMineNodes() {
    this.mineNodes = [];
    const cx = WORLD_W / 2, cy = WORLD_H / 2;
    // 2 mines per side, placed at ~600px from each base, mirrored
    const mineOffsets = [
      { dist: 600, angle: -0.6 },
      { dist: 650, angle: 0.6 },
    ];
    const baseAngle = Math.atan2(cy - P1_BASE.y, cx - P1_BASE.x);
    let idx = 0;
    for (const off of mineOffsets) {
      const angle = baseAngle + off.angle;
      const x1 = Math.round(P1_BASE.x + Math.cos(angle) * off.dist);
      const y1 = Math.round(P1_BASE.y + Math.sin(angle) * off.dist);
      // Mirror for P2
      const x2 = Math.round(cx + (cx - x1));
      const y2 = Math.round(cy + (cy - y1));
      this.mineNodes.push({ id: `mine_${idx++}`, x: x1, y: y1, sprite: null, label: null });
      this.mineNodes.push({ id: `mine_${idx++}`, x: x2, y: y2, sprite: null, label: null });
    }
  }


  // ─── ERA PROGRESSION ─────────────────────────────────────────
  private static readonly ERA_NAMES: Record<number, string> = { 1: 'Foraging', 2: 'Hunting', 3: 'Expansion', 4: 'War', 5: 'Endgame' };

  private updateEraProgression() {
    if (this.currentEra >= 5) return;
    const oc = Math.max(this.camps.filter(c => c.owner === 1).length, this.camps.filter(c => c.owner === 2).length);
    const t4 = this.camps.some(c => (c.owner === 1 || c.owner === 2) && (ANIMALS[c.animalType]?.tier || 1) >= 4);
    let t = this.currentEra;
    if (t === 1 && oc >= 1) t = 2;
    if (t === 2 && oc >= 3) t = 3;
    if (t === 3 && (this.eliteKillCount > 0 || oc >= 5)) t = 4;
    if (t === 4 && t4) t = 5;
    if (t > this.currentEra) this.advanceEra(t);
  }

  private advanceEra(ne: number) {
    const om = this.eraMaxTier();
    this.currentEra = ne;
    const nm = this.eraMaxTier();
    this.showFeedback(`Era ${ne}: ${HordeScene.ERA_NAMES[ne]} — Tier ${nm} unlocked!`, '#45E6B0');
    for (const c of this.camps) {
      const ti = ANIMALS[c.animalType]?.tier || 1;
      if (ti > om && ti <= nm && c.owner === 0 && !this.units.some(u => u.campId === c.id && !u.dead)) {
        this.spawnCampDefenders(c);
      }
    }
    if (ne === 2) this.spawnWildAnimalsForEra(['skull', 'spider', 'gnoll'], WILD_ANIMAL_COUNT);
    if (ne === 3) this.spawnWildAnimalsForEra(['panda', 'lizard'], 10);
    if (ne === 4) this.spawnElitePreyBatch();
  }

  private spawnWildAnimalsForEra(types: string[], count: number) {
    for (let i = 0; i < count; i++) {
      const type = types[Math.floor(Math.random() * types.length)];
      const def = ANIMALS[type];
      if (!def) continue;
      const p = this.randomOutskirtsPos();
      this.units.push({
        id: this.nextId++, type, team: 0,
        hp: def.hp, maxHp: def.hp, attack: def.attack, speed: def.speed * 0.4,
        x: p.x, y: p.y, targetX: p.x + Math.random() * 100 - 50, targetY: p.y + Math.random() * 100 - 50,
        attackTimer: 0, sprite: null, dead: false, animState: 'idle' as const, prevSpriteX: 0, prevSpriteY: 0,
        campId: null, lungeX: 0, lungeY: 0,
        hasRebirth: false, diveReady: false, diveTimer: 0, lastAttackTarget: -1, attackFaceX: null, mods: { ...DEFAULT_MODS },
        carrying: null, carrySprite: null, loop: null, isElite: false, idleTimer: 0, claimItemId: -1,
      });
    }
  }

  private spawnElitePreyBatch() {
    for (let i = 0; i < ELITE_PREY_COUNT; i++) {
      let x: number, y: number;
      do {
        x = WORLD_W * 0.2 + Math.random() * (WORLD_W * 0.6);
        y = WORLD_H * 0.2 + Math.random() * (WORLD_H * 0.6);
      } while (pdist({ x, y }, P1_BASE) < 600 || pdist({ x, y }, P2_BASE) < 600);
      this.units.push({
        id: this.nextId++, type: 'minotaur', team: 0,
        hp: 2000, maxHp: 2000, attack: 150, speed: 90,
        x, y, targetX: x + Math.random() * 80 - 40, targetY: y + Math.random() * 80 - 40,
        attackTimer: 0, sprite: null, dead: false, animState: 'idle' as const, prevSpriteX: 0, prevSpriteY: 0,
        campId: null, lungeX: 0, lungeY: 0,
        hasRebirth: false, diveReady: false, diveTimer: 0, lastAttackTarget: -1, attackFaceX: null, mods: { ...DEFAULT_MODS },
        carrying: null, carrySprite: null, loop: null, isElite: true, idleTimer: 0, claimItemId: -1,
      });
    }
  }

  // ─── NEXUSES ─────────────────────────────────────────────────

  private setupNexuses() {
    for (const team of [1, 2] as const) {
      const base = team === 1 ? P1_BASE : P2_BASE;
      const c = this.add.container(base.x, base.y).setDepth(8);
      c.add(this.add.circle(0, 0, 50, TEAM_COLORS[team], 0.15));
      c.add(this.add.circle(0, 0, 35, TEAM_COLORS[team], 0.3));
      c.add(this.add.text(0, -5, '👑', { fontSize: '36px' }).setOrigin(0.5));
      const isMyNexus = team === this.myTeam;
      c.add(this.add.text(0, -55, isMyNexus ? 'YOUR NEXUS' : 'ENEMY NEXUS', {
        fontSize: '14px', color: isMyNexus ? '#4499FF' : '#FF5555',
        fontFamily: '"Fredoka", sans-serif', fontStyle: 'bold',
        stroke: '#000', strokeThickness: 3,
      }).setOrigin(0.5));

      this.nexuses.push({
        team, x: base.x, y: base.y,
        hp: NEXUS_MAX_HP, maxHp: NEXUS_MAX_HP,
        container: c,
        hpBar: this.add.graphics().setDepth(9),
        hpText: this.add.text(base.x, base.y + 50, `${NEXUS_MAX_HP}/${NEXUS_MAX_HP}`, {
          fontSize: '12px', color: '#f0e8ff', fontFamily: '"Nunito", sans-serif',
          fontStyle: 'bold', stroke: '#000', strokeThickness: 2,
        }).setOrigin(0.5).setDepth(9),
      });
    }
    this.drawNexusBars();
  }

  private drawNexusBars() {
    for (const n of this.nexuses) {
      const g = n.hpBar!;
      g.clear();
      const pct = Math.max(0, n.hp / n.maxHp);
      const w = 80, h = 8;
      g.fillStyle(0x000000, 0.6);
      g.fillRoundedRect(n.x - w / 2, n.y + 38, w, h, 4);
      g.fillStyle(pct > 0.5 ? 0x45E6B0 : pct > 0.25 ? 0xFFD93D : 0xFF5555);
      g.fillRoundedRect(n.x - w / 2, n.y + 38, w * pct, h, 4);
      n.hpText!.setText(`${Math.max(0, Math.ceil(n.hp))}/${n.maxHp}`);

      // Show stockpile near nexus (world-space, scales with zoom)
      const stock = this.baseStockpile[n.team as 1 | 2];
      const stockText = `🥕${stock.carrot} 🍖${stock.meat} 💎${stock.crystal}`;
      if (!this.hudTexts[`stock_${n.team}`]) {
        this.hudTexts[`stock_${n.team}`] = this.add.text(n.x, n.y + 65, stockText, {
          fontSize: '13px', color: '#f0e8ff', fontFamily: '"Nunito", sans-serif', fontStyle: 'bold',
          stroke: '#000', strokeThickness: 3, backgroundColor: 'rgba(0,0,0,0.5)',
          padding: { x: 6, y: 2 },
        }).setOrigin(0.5).setDepth(9);
      } else {
        this.hudTexts[`stock_${n.team}`].setText(stockText);
      }
      // Scale inversely with zoom
      const zoom = this.cameras.main.zoom;
      this.hudTexts[`stock_${n.team}`].setScale(Math.max(0.8, 1.0 / zoom));
    }
  }

  // ─── CAMERA ──────────────────────────────────────────────────

  private setupCamera() {
    const cam = this.cameras.main;
    cam.setBounds(0, 0, WORLD_W, WORLD_H);
    const myBase = this.myTeam === 1 ? P1_BASE : P2_BASE;
    const camOffX = this.myTeam === 1 ? 400 : -400;
    const camOffY = this.myTeam === 1 ? -400 : 400;
    cam.centerOn(myBase.x + camOffX, myBase.y + camOffY);
    cam.setZoom(0.7);
    this.input.on('wheel', (_ptr: any, _over: any, _dx: number, deltaY: number) => {
      cam.zoom = Phaser.Math.Clamp(cam.zoom + (deltaY > 0 ? -0.05 : 0.05), 0.2, 2.0);
    });

    // Drag to pan
    this.input.on('pointerdown', (ptr: Phaser.Input.Pointer) => {
      if (ptr.rightButtonDown() || ptr.middleButtonDown() || ptr.leftButtonDown()) {
        this.isDragging = true;
        this.dragMoved = false;
        this.dragPrevX = ptr.x;
        this.dragPrevY = ptr.y;
      }
    });
    this.input.on('pointermove', (ptr: Phaser.Input.Pointer) => {
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
      if (!this.dragMoved && ptr.leftButtonReleased()) {
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
    if (this.wasdKeys['W'].isDown) cam.scrollY -= s;
    if (this.wasdKeys['S'].isDown) cam.scrollY += s;
    if (this.wasdKeys['A'].isDown) cam.scrollX -= s;
    if (this.wasdKeys['D'].isDown) cam.scrollX += s;
  }

  // ─── INPUT ───────────────────────────────────────────────────

  private setupInput() {
    this.wasdKeys = {
      W: this.input.keyboard!.addKey('W'),
      A: this.input.keyboard!.addKey('A'),
      S: this.input.keyboard!.addKey('S'),
      D: this.input.keyboard!.addKey('D'),
    };
    this.spaceKey = this.input.keyboard!.addKey('SPACE');

    const input = document.createElement('input');
    input.id = 'horde-cmd-input';
    input.type = 'text';
    input.placeholder = 'Type command... (e.g. "gnomes attack skull camp")';
    input.style.cssText = `
      position:absolute;bottom:20px;left:50%;transform:translateX(-50%);
      width:520px;padding:10px 18px;font-size:15px;
      background:rgba(13,26,13,0.95);color:#f0e8ff;
      border:2px solid #45E6B0;border-radius:14px;outline:none;z-index:100;
      font-family:'Nunito',sans-serif;font-weight:600;
    `;
    input.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter' && input.value.trim()) {
        this.issueCommand(input.value.trim());
        input.value = '';
      }
    });
    input.addEventListener('focus', () => { this.input.keyboard!.enabled = false; });
    input.addEventListener('blur', () => { this.input.keyboard!.enabled = true; });
    document.getElementById('game-container')!.appendChild(input);
    this.textInput = input;

    const voiceDiv = document.createElement('div');
    voiceDiv.id = 'horde-voice-status';
    voiceDiv.style.cssText = `
      position:absolute;bottom:70px;left:50%;transform:translateX(-50%);
      padding:8px 18px;background:rgba(13,26,13,0.9);border:2px solid #3D5040;
      border-radius:12px;z-index:100;font-family:'Nunito',sans-serif;
      font-size:13px;color:#8BAA8B;font-weight:600;display:flex;align-items:center;gap:8px;
    `;
    const voiceLabel = document.createElement('span');
    voiceLabel.textContent = '🎤 Hold SPACE to speak';
    const transcript = document.createElement('span');
    transcript.style.cssText = 'color:#FFD93D;max-width:300px;';
    voiceDiv.appendChild(voiceLabel);
    voiceDiv.appendChild(transcript);
    document.getElementById('game-container')!.appendChild(voiceDiv);
    this.voiceStatusEl = voiceDiv;
    this.transcriptEl = transcript;

    this.setupVoice(voiceLabel);
    this.spaceKey.on('down', () => this.startListening());
    this.spaceKey.on('up', () => this.stopListening());

    // Number-key army selection (1-0)
    for (const [key, army] of Object.entries(this.armyKeys)) {
      const k = this.input.keyboard!.addKey(key);
      k.on('down', () => {
        if (document.activeElement === this.textInput) return;
        this.selectedArmy = army;
        this.updateSelectionLabel();
      });
    }

    // TAB / Q / E to cycle through armies you actually have
    const tabKey = this.input.keyboard!.addKey('TAB');
    const qKey = this.input.keyboard!.addKey('Q');
    const eKey = this.input.keyboard!.addKey('E');

    tabKey.on('down', (event: KeyboardEvent) => {
      if (document.activeElement === this.textInput) return;
      event.preventDefault(); // prevent browser tab-focus
      this.cycleArmy(event.shiftKey ? -1 : 1);
    });
    qKey.on('down', () => {
      if (document.activeElement === this.textInput) return;
      this.cycleArmy(-1);
    });
    eKey.on('down', () => {
      if (document.activeElement === this.textInput) return;
      this.cycleArmy(1);
    });
  }

  private cycleArmy(direction: 1 | -1) {
    // Build list of available armies: 'all' + types the player currently has
    const available = this.getAvailableArmies();
    const currentIdx = available.indexOf(this.selectedArmy);
    let nextIdx = currentIdx + direction;
    if (nextIdx < 0) nextIdx = available.length - 1;
    if (nextIdx >= available.length) nextIdx = 0;
    this.selectedArmy = available[nextIdx];
    this.updateSelectionLabel();

    // Quick feedback showing what's selected
    const count = this.selectedArmy === 'all'
      ? this.units.filter(u => u.team === this.myTeam && !u.dead).length
      : this.units.filter(u => u.team === this.myTeam && !u.dead && u.type === this.selectedArmy).length;
    const emoji = this.selectedArmy === 'all' ? '' : (ANIMALS[this.selectedArmy]?.emoji + ' ' || '');
    const name = this.selectedArmy === 'all' ? 'All units' : cap(this.selectedArmy);
    this.showFeedback(`${emoji}${name} selected (${count})`, '#FFD93D');
  }

  private getAvailableArmies(): string[] {
    const myTypes = new Set<string>();
    for (const u of this.units) {
      if (u.team === this.myTeam && !u.dead) myTypes.add(u.type);
    }
    // Always include 'all', then only types we have units of, in tier order
    const available = ['all'];
    for (const type of this.allArmyTypes) {
      if (type !== 'all' && myTypes.has(type)) available.push(type);
    }
    return available;
  }

  private setupVoice(label: HTMLSpanElement) {
    const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SR) { label.textContent = 'No speech support'; return; }
    const rec = new SR();
    rec.continuous = false;
    rec.interimResults = true;
    rec.lang = 'en-US';
    rec.onresult = (e: any) => {
      let text = '';
      for (let i = 0; i < e.results.length; i++) text += e.results[i][0].transcript;
      if (this.transcriptEl) this.transcriptEl.textContent = text;
      if (e.results[e.results.length - 1].isFinal && text.trim()) {
        this.issueCommand(text.trim());
        this.stopListening();
      }
    };
    rec.onerror = () => this.stopListening();
    rec.onend = () => this.stopListening();
    this.recognition = rec;
  }

  private startListening() {
    if (this.isListening || !this.recognition || document.activeElement === this.textInput) return;
    this.isListening = true;
    if (this.voiceStatusEl) this.voiceStatusEl.style.borderColor = '#FF6B6B';
    if (this.transcriptEl) this.transcriptEl.textContent = '';
    try { this.recognition.start(); } catch (_e) { /* */ }
  }

  private stopListening() {
    if (!this.isListening) return;
    this.isListening = false;
    if (this.voiceStatusEl) this.voiceStatusEl.style.borderColor = '#3D5040';
    try { this.recognition?.stop(); } catch (_e) { /* */ }
    setTimeout(() => { if (!this.isListening && this.transcriptEl) this.transcriptEl.textContent = ''; }, 3000);
  }

  // ─── HUD ─────────────────────────────────────────────────────

  private setupHUD() {
    const cam = this.cameras.main;

    // Left panel background — thin, flush against edge
    this.add.rectangle(0, 0, 190, cam.height, 0x000000, 0.5)
      .setOrigin(0, 0).setScrollFactor(0).setDepth(99);

    this.hudTexts['title'] = this.add.text(8, 8, 'HORDE', {
      fontSize: '14px', color: '#45E6B0', fontFamily: '"Fredoka", sans-serif', fontStyle: 'bold',
    }).setScrollFactor(0).setDepth(100);

    this.hudTexts['timer'] = this.add.text(80, 9, '0:00', {
      fontSize: '13px', color: '#FFD93D', fontFamily: '"Fredoka", sans-serif', fontStyle: 'bold',
    }).setOrigin(0, 0).setScrollFactor(0).setDepth(100);

    // Army section
    this.hudTexts['armyHeader'] = this.add.text(8, 30, 'ARMIES', {
      fontSize: '11px', color: '#4499FF', fontFamily: '"Fredoka", sans-serif', fontStyle: 'bold',
      letterSpacing: 1,
    }).setScrollFactor(0).setDepth(100);

    this.hudTexts['armies'] = this.add.text(8, 46, '', {
      fontSize: '10px', color: '#f0e8ff', fontFamily: '"Nunito", sans-serif', fontStyle: 'bold', lineSpacing: 3,
      wordWrap: { width: 175 },
    }).setScrollFactor(0).setDepth(100);

    // Resources section
    this.hudTexts['resHeader'] = this.add.text(8, 170, 'RESOURCES', {
      fontSize: '11px', color: '#45E6B0', fontFamily: '"Fredoka", sans-serif', fontStyle: 'bold',
      letterSpacing: 1,
    }).setScrollFactor(0).setDepth(100);

    this.hudTexts['resources'] = this.add.text(8, 186, '', {
      fontSize: '10px', color: '#f0e8ff', fontFamily: '"Nunito", sans-serif', fontStyle: 'bold', lineSpacing: 2,
      wordWrap: { width: 175 },
    }).setScrollFactor(0).setDepth(100);

    // Production section
    this.hudTexts['prodHeader'] = this.add.text(8, 250, 'PRODUCTION', {
      fontSize: '11px', color: '#C98FFF', fontFamily: '"Fredoka", sans-serif', fontStyle: 'bold',
      letterSpacing: 1,
    }).setScrollFactor(0).setDepth(100);

    this.hudTexts['production'] = this.add.text(8, 266, '', {
      fontSize: '10px', color: '#cbb8ee', fontFamily: '"Nunito", sans-serif', fontStyle: '600', lineSpacing: 3,
      wordWrap: { width: 175 },
    }).setScrollFactor(0).setDepth(100);

    // Camps section
    this.hudTexts['campsHeader'] = this.add.text(8, 360, 'CAMPS', {
      fontSize: '11px', color: '#FFD93D', fontFamily: '"Fredoka", sans-serif', fontStyle: 'bold',
      letterSpacing: 1,
    }).setScrollFactor(0).setDepth(100);

    this.hudTexts['camps'] = this.add.text(8, 376, '', {
      fontSize: '9px', color: '#f0e8ff', fontFamily: '"Nunito", sans-serif', fontStyle: '600', lineSpacing: 2,
      wordWrap: { width: 175 },
    }).setScrollFactor(0).setDepth(100);

    // Buffs
    this.hudTexts['buffs'] = this.add.text(8, cam.height - 80, '', {
      fontSize: '10px', color: '#C98FFF', fontFamily: '"Nunito", sans-serif', fontStyle: '600', lineSpacing: 2,
      wordWrap: { width: 175 },
    }).setScrollFactor(0).setDepth(100);

    // Right side: enemy info
    this.add.rectangle(cam.width, 0, 220, 160, 0x000000, 0.35)
      .setOrigin(1, 0).setScrollFactor(0).setDepth(99);

    this.hudTexts['enemyHeader'] = this.add.text(cam.width - 16, 12, 'ENEMY', {
      fontSize: '13px', color: '#FF5555', fontFamily: '"Fredoka", sans-serif', fontStyle: 'bold',
      letterSpacing: 1,
    }).setOrigin(1, 0).setScrollFactor(0).setDepth(100);

    this.hudTexts['enemy'] = this.add.text(cam.width - 16, 32, '', {
      fontSize: '12px', color: '#ffcccc', fontFamily: '"Nunito", sans-serif', fontStyle: '600',
      lineSpacing: 4, align: 'right',
    }).setOrigin(1, 0).setScrollFactor(0).setDepth(100);

    // Feedback (center bottom)
    this.hudTexts['feedback'] = this.add.text(cam.width / 2, cam.height - 115, '', {
      fontSize: '16px', color: '#45E6B0', fontFamily: '"Nunito", sans-serif', fontStyle: 'bold',
    }).setOrigin(0.5).setScrollFactor(0).setDepth(100).setAlpha(0);

    // Phaser selection label (minimal, above army bar)
    this.selectionLabel = this.add.text(cam.width / 2, cam.height - 175, '', {
      fontSize: '12px', color: '#8BAA8B', fontFamily: '"Nunito", sans-serif', fontStyle: 'bold',
      stroke: '#000', strokeThickness: 2,
    }).setOrigin(0.5).setScrollFactor(0).setDepth(100);

    // HTML Army Bar — big visible cards for each animal type
    const armyBar = document.createElement('div');
    armyBar.id = 'horde-army-bar';
    armyBar.style.cssText = `
      position:absolute;bottom:62px;left:50%;transform:translateX(-50%);
      display:flex;gap:4px;z-index:101;pointer-events:none;
      font-family:'Nunito',sans-serif;
    `;
    document.getElementById('game-container')!.appendChild(armyBar);
    this.armyBarEl = armyBar;
    this.updateSelectionLabel();

    // Command History Panel (bottom-left)
    const cmdPanel = document.createElement('div');
    cmdPanel.id = 'horde-cmd-history';
    cmdPanel.style.cssText = `
      position:absolute;bottom:62px;left:12px;width:320px;max-height:180px;
      overflow-y:auto;z-index:101;pointer-events:all;
      font-family:'Nunito',sans-serif;
      background:rgba(13,26,13,0.85);border:2px solid #3D5040;border-radius:12px;
      padding:8px 10px;
      scrollbar-width:thin;scrollbar-color:rgba(69,230,176,0.35) rgba(13,26,13,0.4);
    `;
    cmdPanel.innerHTML = `<div style="font-size:10px;color:#45E6B0;font-weight:800;letter-spacing:1px;margin-bottom:4px;">COMMAND LOG</div>
      <div id="cmd-history-entries" style="font-size:11px;color:#8BAA8B;"></div>`;
    document.getElementById('game-container')!.appendChild(cmdPanel);
    this.cmdHistoryEl = cmdPanel;

    // Help hint (bottom right)
    this.hudTexts['help'] = this.add.text(cam.width - 16, cam.height - 100, [
      'Drag: Pan  |  Scroll: Zoom  |  WASD: Pan',
      'SPACE: Voice  |  Type below: Text',
      'Q/E: Cycle army  |  TAB: Next  |  1-0: Direct pick',
      'Commands apply to selected army',
      '"attack nearest camp" | "make gnomes" | "make skulls"',
    ].join('\n'), {
      fontSize: '10px', color: '#4A6B4A', fontFamily: '"Nunito", sans-serif', lineSpacing: 2, align: 'right',
    }).setOrigin(1, 1).setScrollFactor(0).setDepth(100);

    // ─── Character Details Panel (Bestiary) ─────────────────────
    const charToggle = document.createElement('button');
    charToggle.id = 'horde-char-toggle';
    charToggle.textContent = '\u{1F4D6}';
    charToggle.style.cssText = `
      position:absolute;top:10px;right:260px;width:36px;height:36px;
      z-index:100;border:1px solid #3D5040;border-radius:8px;
      background:rgba(13,26,13,0.88);color:#45E6B0;font-size:18px;
      cursor:pointer;display:flex;align-items:center;justify-content:center;
      font-family:'Nunito',sans-serif;padding:0;
    `;
    charToggle.addEventListener('click', () => {
      if (this.charPanelEl) {
        const vis = this.charPanelEl.style.display === 'none';
        this.charPanelEl.style.display = vis ? 'block' : 'none';
        charToggle.style.right = vis ? '260px' : '10px';
      }
    });
    document.getElementById('game-container')!.appendChild(charToggle);

    const charPanel = document.createElement('div');
    charPanel.id = 'horde-char-panel';
    charPanel.style.cssText = `
      position:absolute;top:10px;right:10px;width:240px;max-height:calc(100vh - 20px);
      overflow-y:auto;z-index:99;
      background:rgba(13,26,13,0.88);border:1px solid #3D5040;border-radius:12px;
      padding:10px;font-family:'Nunito',sans-serif;
      scrollbar-width:thin;scrollbar-color:rgba(69,230,176,0.35) rgba(13,26,13,0.4);
    `;

    const tierColors: Record<number, string> = { 1: '#44CC44', 2: '#4499FF', 3: '#FF9933', 4: '#FF4444', 5: '#FFD700' };
    const unitData = [
      { emoji: '\u{1F9DD}', name: 'Gnome', hp: 15, atk: 3, spd: 210, tier: 1, ability: 'Nimble Hands', desc: '2x pickup range, fastest gatherer', cost: '1\u{1F955}' },
      { emoji: '\u{1F422}', name: 'Turtle', hp: 65, atk: 3, spd: 55, tier: 1, ability: 'Shell Stance', desc: '60% DR when guarding (stationary)', cost: '1\u{1F955}' },
      { emoji: '\u{1F480}', name: 'Skull', hp: 80, atk: 14, spd: 155, tier: 2, ability: 'Undying', desc: 'Cheats death once (survives at 1 HP)', cost: '3\u{1F356}' },
      { emoji: '\u{1F577}\uFE0F', name: 'Spider', hp: 120, atk: 18, spd: 85, tier: 2, ability: 'Venom Bite', desc: '+5% target max HP per hit', cost: '3\u{1F356}' },
      { emoji: '\u{1F43A}', name: 'Gnoll', hp: 55, atk: 28, spd: 175, tier: 2, ability: 'Bone Toss', desc: 'Extended range (120 vs 80)', cost: '3\u{1F356}' },
      { emoji: '\u{1F5E1}\uFE0F', name: 'Rogue', hp: 60, atk: 45, spd: 200, tier: 2, ability: 'Backstab', desc: '3x damage on first hit against a new target', cost: '3\u{1F356}' },
      { emoji: '\u{1F43C}', name: 'Panda', hp: 900, atk: 35, spd: 80, tier: 3, ability: 'Thick Hide', desc: 'Regenerates 1% max HP/sec', cost: '5\u{1F356}' },
      { emoji: '\u{1F98E}', name: 'Lizard', hp: 450, atk: 70, spd: 110, tier: 3, ability: 'Cold Blood', desc: '3x dmg to targets below 40% HP', cost: '5\u{1F955}' },
      { emoji: '\u{1F402}', name: 'Minotaur', hp: 2200, atk: 110, spd: 120, tier: 4, ability: 'War Cry', desc: 'Nearby allies +25% attack', cost: '8\u{1F48E}' },
      { emoji: '\u{1F52E}', name: 'Shaman', hp: 1400, atk: 180, spd: 100, tier: 4, ability: 'Arcane Blast', desc: 'All attacks splash 60px', cost: '8\u{1F48E}' },
      { emoji: '\u{1F479}', name: 'Troll', hp: 14000, atk: 350, spd: 50, tier: 5, ability: 'Club Slam', desc: 'Massive 90px splash, slows enemies', cost: '20\u{1F48E}' },
    ];

    let panelHTML = `<div style="font-size:12px;color:#45E6B0;font-weight:800;letter-spacing:1.5px;margin-bottom:8px;text-align:center;">BESTIARY</div>`;
    for (const u of unitData) {
      const tc = tierColors[u.tier];
      panelHTML += `
        <div style="background:rgba(30,50,30,0.6);border:1px solid #3D5040;border-radius:8px;padding:7px 8px;margin-bottom:6px;">
          <div style="display:flex;align-items:center;gap:6px;margin-bottom:3px;">
            <span style="font-size:18px;">${u.emoji}</span>
            <span style="font-size:12px;font-weight:800;color:#f0e8ff;">${u.name}</span>
            <span style="font-size:9px;font-weight:700;color:${tc};background:rgba(0,0,0,0.4);padding:1px 5px;border-radius:4px;margin-left:auto;">T${u.tier}</span>
          </div>
          <div style="display:flex;gap:8px;font-size:10px;color:#8BAA8B;margin-bottom:3px;">
            <span>\u2764\uFE0F ${u.hp}</span>
            <span>\u2694\uFE0F ${u.atk}</span>
            <span>\u{1F3C3} ${u.spd}</span>
            <span style="margin-left:auto;color:#FFD93D;">${u.cost}</span>
          </div>
          <div style="font-size:10px;color:#C98FFF;font-weight:700;">${u.ability}</div>
          <div style="font-size:9px;color:#8BAA8B;font-style:italic;">${u.desc}</div>
        </div>`;
    }
    charPanel.innerHTML = panelHTML;
    document.getElementById('game-container')!.appendChild(charPanel);
    this.charPanelEl = charPanel;
  }

  private updateHUD() {
    const myT = this.myTeam;
    const enemyT = myT === 1 ? 2 : 1;
    const p1 = this.units.filter(u => u.team === myT && !u.dead);
    const p2 = this.units.filter(u => u.team === enemyT && !u.dead);
    const countBy = (us: HUnit[]) => {
      const c: Record<string, number> = {};
      for (const u of us) c[u.type] = (c[u.type] || 0) + 1;
      return c;
    };
    const p1c = countBy(p1), p2c = countBy(p2);

    // Timer
    const secs = Math.floor(this.gameTime / 1000);
    const eraName = HordeScene.ERA_NAMES[this.currentEra] || ""; this.hudTexts["timer"]?.setText(Math.floor(secs / 60) + ":" + (secs % 60).toString().padStart(2, "0") + "  Era " + this.currentEra + ": " + eraName);

    // ─── YOUR ARMIES (left panel) ───
    const armyLines: string[] = [];
    armyLines.push(`Total: ${p1.length}/${MAX_UNITS}`);
    for (const [type, def] of Object.entries(ANIMALS)) {
      const count = p1c[type] || 0;
      if (count === 0) continue;
      armyLines.push(`${def.emoji} ${cap(type)}: ${count}  [${def.ability}]`);
    }
    if (armyLines.length === 1) armyLines.push('  (no units yet)');
    this.hudTexts['armies']?.setText(armyLines.join('\n'));

    // ─── RESOURCES ───
    const stock = this.baseStockpile[myT as 1 | 2];
    const resLines = [
      `🥕 Carrots: ${stock.carrot}`,
      `🍖 Meat: ${stock.meat}`,
      `💎 Crystals: ${stock.crystal}`,
    ];
    // Show camp food progress for owned camps
    const foodCamps = this.camps.filter(c => c.owner === myT);
    for (const c of foodCamps) {
      const cost = SPAWN_COSTS[c.animalType];
      if (cost) resLines.push(`  ${ANIMALS[c.animalType]?.emoji || ''} ${cap(c.animalType)}: ${c.storedFood}/${cost.amount}`);
    }
    this.hudTexts['resources']?.setText(resLines.join('\n'));

    // ─── PRODUCTION (food-gated) ───
    const prodLines: string[] = [];
    const gnomeCountdown = Math.max(0, Math.ceil((FREE_GNOME_MS - this.freeGnomeTimer) / 1000));
    prodLines.push(`🧝 Base: free gnome in ${gnomeCountdown}s`);
    const myCamps = this.camps.filter(c => c.owner === myT);
    for (const c of myCamps) {
      const cost = SPAWN_COSTS[c.animalType];
      if (!cost) continue;
      const emoji = ANIMALS[c.animalType]?.emoji || '';
      prodLines.push(`${emoji} ${cap(c.animalType)}: ${cost.amount}${RESOURCE_EMOJI[cost.type]} (${c.spawnMs / 1000}s)`);
    }
    this.hudTexts['production']?.setText(prodLines.join('\n'));

    // ─── FORGE ───
    const forgeLines: string[] = ['FORGE:'];
    const myUpgrades = this.forgeUpgrades[myT as 1 | 2];
    const ownedT1 = [...myUpgrades].filter(id => FORGE_UPGRADES.find(u => u.id === id)?.tier === 1).length;
    const ownedT2 = [...myUpgrades].filter(id => FORGE_UPGRADES.find(u => u.id === id)?.tier === 2).length;
    for (const up of FORGE_UPGRADES) {
      const owned = myUpgrades.has(up.id);
      const locked = (up.tier === 2 && ownedT1 < 2) || (up.tier === 3 && ownedT2 < 2);
      const costStr = Object.entries(up.cost).map(([r, a]) => `${a}${RESOURCE_EMOJI[r as ResourceType]}`).join('+');
      if (owned) {
        forgeLines.push(`  ${up.emoji} ${up.name} ✅`);
      } else if (locked) {
        forgeLines.push(`  🔒 ${up.name} (T${up.tier})`);
      } else {
        forgeLines.push(`  ${up.emoji} ${up.name}: ${costStr}`);
      }
    }
    if (!this.hudTexts['forge']) {
      this.hudTexts['forge'] = this.add.text(10, 520, '', {
        fontSize: '11px', color: '#FFD700',
        stroke: '#000', strokeThickness: 2,
        lineSpacing: 2,
      }).setScrollFactor(0).setDepth(100);
    }
    this.hudTexts['forge']?.setText(forgeLines.join('\n'));

    // ─── CAMPS ───
    const yourCamps = this.camps.filter(c => c.owner === myT).length;
    const enemyCamps = this.camps.filter(c => c.owner === enemyT).length;
    const neutralCamps = this.camps.filter(c => c.owner === 0).length;
    const campLines: string[] = [];
    campLines.push(`🔵 Yours: ${yourCamps}  🔴 Enemy: ${enemyCamps}  ⚪ Neutral: ${neutralCamps}`);
    campLines.push('');
    for (const c of this.camps) {
      const icon = c.owner === 0 ? '⚪' : c.owner === myT ? '🔵' : '🔴';
      const tag = c.owner === myT ? ' (YOU)' : c.owner === enemyT ? ' (ENEMY)' : '';
      campLines.push(`${icon} ${c.name}${tag}`);
    }
    this.hudTexts['camps']?.setText(campLines.join('\n'));

    // ─── BUFFS ───
    const b = this.getBuffs(myT as 1 | 2);
    const bl: string[] = [];
    if (b.speed > 0) bl.push(`⚡ Speed +${Math.round(b.speed * 100)}%`);
    if (b.attack > 0) bl.push(`⚔ Attack +${Math.round(b.attack * 100)}%`);
    if (b.hp > 0) bl.push(`❤ HP +${Math.round(b.hp * 100)}%`);
    this.hudTexts['buffs']?.setText(bl.length ? `BUFFS:\n${bl.join('\n')}` : '');

    // ─── ENEMY (right panel) ───
    const enemyLines: string[] = [];
    enemyLines.push(`Total: ${p2.length}`);
    for (const [type, def] of Object.entries(ANIMALS)) {
      const count = p2c[type] || 0;
      if (count === 0) continue;
      enemyLines.push(`${def.emoji} ${cap(type)}: ${count}`);
    }
    const enemyCampsCount = this.camps.filter(c => c.owner === enemyT).length;
    enemyLines.push(`Camps: ${enemyCampsCount}`);
    this.hudTexts['enemy']?.setText(enemyLines.join('\n'));

    // Update army selector counts
    this.updateSelectionLabel();
  }

  // ─── MAIN UPDATE ────────────────────────────────────────────

  update(_time: number, delta: number) {
    if (this.gameOver) return;
    const dt = delta / 1000;
    this.updateCamera(dt);

    if (this.isOnline && !this.isHost) {
      // Guest: only render, no simulation — state comes from host via sync
      this.updateUnitSprites();
      this.updateCampVisuals();
      this.updateMineVisuals();
      this.drawNexusBars();
      this.updateFog();
      this.updateFogVisibility();
      this.updateHUD();
      return;
    }

    // Host (or solo): run full simulation
    this.gameTime += delta;
    this.updateFreeGnomes(delta);
    this.updateCarrotSpawning(delta);
    this.updateWildAnimals(delta);
    this.updateWorkflows();
    this.updateResourcePickup();
    this.updateDeliveries();
    this.updateMovement(dt);
    this.updateCombat(delta);
    this.updateCampCapture();
    this.updateEraProgression();
    this.updateSweeps();
    // Only run AI when solo (not online PvP)
    if (!this.isOnline) this.updateAI(delta);
    this.cleanupDead();
    this.updateGroundItems(delta);
    this.updateUnitSprites();
    this.updateDebugOverlay();
    this.updateCampVisuals();
    this.updateMineVisuals();
    this.drawNexusBars();
    this.updateFog();
    this.updateFogVisibility();
    this.updateHUD();
    this.checkWin();

    // Host: push sync state to Firebase
    if (this.isOnline && this.isHost && this.firebase && this.gameId) {
      this.syncTimer += delta;
      if (this.syncTimer >= this.SYNC_INTERVAL_MS) {
        this.syncTimer -= this.SYNC_INTERVAL_MS;
        this.pushHostSync();
      }
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
      this.spawnUnit('gnome', team, b.x + (team === 1 ? 60 : -60), b.y + (team === 1 ? -30 : 30));
    }
  }

  /** Purchase a forge upgrade for a team — deducts resources from base stockpile */
  private purchaseUpgrade(team: 1 | 2, upgradeId: string): boolean {
    const upgrade = FORGE_UPGRADES.find(u => u.id === upgradeId);
    if (!upgrade) return false;
    if (this.forgeUpgrades[team].has(upgradeId)) return false; // already owned

    // Check tier requirements
    const ownedCount = (tier: number) =>
      [...this.forgeUpgrades[team]].filter(id => FORGE_UPGRADES.find(u => u.id === id)?.tier === tier).length;
    if (upgrade.tier === 2 && ownedCount(1) < 2) return false;
    if (upgrade.tier === 3 && ownedCount(2) < 2) return false;

    // Check resources
    const stock = this.baseStockpile[team];
    for (const [res, amt] of Object.entries(upgrade.cost)) {
      if ((stock[res as ResourceType] || 0) < amt!) return false;
    }

    // Deduct resources
    for (const [res, amt] of Object.entries(upgrade.cost)) {
      stock[res as ResourceType] -= amt!;
    }

    this.forgeUpgrades[team].add(upgradeId);

    // Apply HP upgrades immediately to existing units
    if (upgradeId === 'wooden_shields' || upgradeId === 'chainmail' || upgradeId === 'dragon_scale') {
      const hpMult = upgradeId === 'wooden_shields' ? 0.20 : upgradeId === 'chainmail' ? 0.30 : 0.50;
      for (const u of this.units) {
        if (u.team === team && !u.dead) {
          const bonus = u.maxHp * hpMult;
          u.maxHp += bonus;
          u.hp += bonus;
        }
      }
    }

    return true;
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
    for (const u of this.units) {
      if (u.dead) continue;

      let dx = u.targetX - u.x, dy = u.targetY - u.y;
      const d = Math.sqrt(dx * dx + dy * dy);
      if (d < 5) continue;

      // Avoidance: units carrying food on non-combat steps steer around threats
      // Caution modifiers: safe = wider avoidance (180), aggressive = no avoidance
      if (u.team !== 0 && this.isNonCombatStep(u) && u.mods.caution !== 'aggressive') {
        const AVOID_RANGE = u.mods.caution === 'safe' ? 180 : 100;
        let avoidX = 0, avoidY = 0;
        const team = u.team as 1 | 2;

        // Avoid enemy units and neutral camp defenders
        for (const o of this.units) {
          if (o.dead || o.team === u.team) continue;
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
          const hasDefenders = this.units.some(g => g.campId === c.id && g.team === 0 && !g.dead);
          if (!hasDefenders && c.owner === 0) continue;
          const cx2 = u.x - c.x, cy2 = u.y - c.y;
          const cd = Math.sqrt(cx2 * cx2 + cy2 * cy2);
          if (cd < AVOID_RANGE * 1.5 && cd > 1) {
            const strength = (AVOID_RANGE * 1.5 / cd) - 1;
            avoidX += (cx2 / cd) * strength;
            avoidY += (cy2 / cd) * strength;
          }
        }

        if (avoidX !== 0 || avoidY !== 0) {
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
            const buffMult = 1 + this.getBuffs(team).speed;
            const spd = u.speed * buffMult;
            const moveStep = Math.min(spd * dt, d);
            u.x += (finalX / fLen) * moveStep;
            u.y += (finalY / fLen) * moveStep;
            u.x = Math.max(0, Math.min(WORLD_W, u.x));
            u.y = Math.max(0, Math.min(WORLD_H, u.y));
            continue;
          }
        }
      }

      const buffMult = u.team !== 0 ? (1 + this.getBuffs(u.team as 1 | 2).speed) : 1;
      const spd = u.speed * buffMult;
      const finalSpeed = spd * dt;
      const step = Math.min(finalSpeed, d);
      u.x += (dx / d) * step;
      u.y += (dy / d) * step;

      // Clamp to world bounds
      u.x = Math.max(0, Math.min(WORLD_W, u.x));
      u.y = Math.max(0, Math.min(WORLD_H, u.y));

      // Formation: spread — repel from nearby same-team allies (min 120px)
      // Exempt turtles in combat (preserve Shell Stance)
      if (u.mods.formation === 'spread' && !(u.type === 'turtle' && u.animState === 'attack')) {
        const SPREAD_MIN = 120;
        for (const ally of this.units) {
          if (ally === u || ally.dead || ally.team !== u.team) continue;
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
      }

      // Formation: tight — leash to group centroid (max 150px)
      if (u.mods.formation === 'tight') {
        const allies = this.units.filter(a => !a.dead && a.team === u.team && a.type === u.type && a.mods.formation === 'tight');
        if (allies.length > 1) {
          let cx = 0, cy = 0;
          for (const a of allies) { cx += a.x; cy += a.y; }
          cx /= allies.length; cy /= allies.length;
          const distToCentroid = Math.sqrt((u.x - cx) ** 2 + (u.y - cy) ** 2);
          if (distToCentroid > 150) {
            const pull = Math.min(1, (distToCentroid - 150) / 200) * u.speed * dt;
            const dx2 = cx - u.x, dy2 = cy - u.y;
            const d2 = Math.sqrt(dx2 * dx2 + dy2 * dy2) || 1;
            u.x += (dx2 / d2) * pull;
            u.y += (dy2 / d2) * pull;
            u.x = Math.max(0, Math.min(WORLD_W, u.x));
            u.y = Math.max(0, Math.min(WORLD_H, u.y));
          }
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
    if (!u.loop) return false;
    const step = u.loop.steps[u.loop.currentStep];
    if (!step) return false;
    return step.action !== 'attack_camp'
      && step.action !== 'attack_enemies'
      && step.action !== 'hunt'
      && step.action !== 'kill_only'
      && step.action !== 'defend';
  }

  /** Spread out: assign each searching unit a unique angular sector from map center
   *  so they fan out evenly across the map instead of clumping. */
  private spreadOut(u: HUnit) {
    // Only pick a new target once we've reached the current one
    if (pdist(u, { x: u.targetX, y: u.targetY }) > 30) return;

    if (!u.loop) return;
    const step = u.loop.steps[u.loop.currentStep];
    if (!step) return;

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
        const pacifist = step && (step.action === 'scout' || step.action === 'collect' && u.mods.caution !== 'aggressive');
        if (pacifist || (u.carrying && u.mods.caution !== 'aggressive')) continue;
      }

      if (u.carrying && u.team !== 0) {
        const combatRange = u.type === 'gnoll' ? 120 : COMBAT_RANGE;
        const onCombatStep = !this.isNonCombatStep(u);
        // Include neutral defenders as threats when on attack_camp step
        const isAttackingCamp = u.loop?.steps[u.loop.currentStep]?.action === 'attack_camp';
        const enemyNear = this.units.some(o =>
          !o.dead && o.team !== u.team
          && (o.team !== 0 || isAttackingCamp)
          && pdist(u, o) <= combatRange + 30);
        if (enemyNear) {
          // Drop carried resource on the ground and engage
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
      // GNOLL "Bone Toss": extended combat range (120 vs 80)
      // Caution: aggressive — engage enemies from 200px even mid-delivery (but not through nexus area)
      const baseCombatRange = u.type === 'gnoll' ? 120 : COMBAT_RANGE;
      const unitCombatRange = u.mods.caution === 'aggressive' ? Math.max(baseCombatRange, 200) : baseCombatRange;
      let best: HUnit | null = null, bestD = Infinity;
      for (const o of this.units) {
        if (o.dead || o.team === u.team) continue;
        if (u.team === 0 && o.team === 0) continue;
        const d = pdist(u, o);
        if (d <= unitCombatRange && d < bestD) { bestD = d; best = o; }
      }

      // Nexus attack (only player units)
      const nex = u.team !== 0 ? this.nexuses.find(n => n.team !== u.team) : null;
      const nexD = nex ? pdist(u, nex) : Infinity;

      if (best) {
        const buffMult = u.team !== 0 ? (1 + this.getBuffs(u.team as 1 | 2).attack) : 1;
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
        if (u.type === 'lizard' && best.hp / best.maxHp < 0.4) {
          atk *= 3;
        }

        // ─── ROGUE BACKSTAB: 3x damage on first hit against a new target ───
        if (u.type === 'rogue') {
          if (u.lastAttackTarget !== best.id) {
            atk *= 3;
          }
          u.lastAttackTarget = best.id;
        }

        // ─── MINOTAUR WAR CRY: nearby allies get +25% attack (check if attacker has minotaur nearby) ───
        if (u.team !== 0 && u.type !== 'minotaur') {
          const hasMinotaurNearby = this.units.some(l =>
            !l.dead && l.type === 'minotaur' && l.team === u.team && pdist(u, l) < 150
          );
          if (hasMinotaurNearby) atk *= 1.25;
        }

        // ─── TURTLE SHELL STANCE: 60% damage reduction when stationary ───
        const isStationary = pdist(best, { x: best.targetX, y: best.targetY }) < 15;
        if (best.type === 'turtle' && isStationary) atk *= 0.4;

        // Splash: Troll = 90px, Shaman = 60px (always), T4 = 50px, T3 = 40px, others = none
        const splashRadius = u.type === 'troll' ? 90 : u.type === 'shaman' ? 60 : uTier >= 4 ? 50 : uTier >= 3 ? 40 : 0;
        const splashTargets: HUnit[] = [best];
        if (splashRadius > 0) {
          for (const o of this.units) {
            if (o === best || o.dead || o.team === u.team) continue;
            if (u.team === 0 && o.team === 0) continue;
            if (pdist(o, best) <= splashRadius) splashTargets.push(o);
          }
        }

        for (const target of splashTargets) {
          let dmg = target === best ? atk : atk * 0.5; // half damage for splash

          // Shell stance also applies to splash targets
          if (target.type === 'turtle') {
            const tStationary = pdist(target, { x: target.targetX, y: target.targetY }) < 15;
            if (tStationary && target !== best) dmg *= 0.4;
          }

          target.hp -= dmg;
          // Floating damage number
          this.spawnDmgNumber(target.x, target.y - 10, dmg, target === best, u);
          // Tight formation safety: units hit by splash auto-scatter briefly
          if (target !== best && !target.dead && target.mods.formation === 'tight') {
            // Push away from splash center to avoid repeated splash wipes
            const scatterDx = target.x - best.x, scatterDy = target.y - best.y;
            const scatterD = Math.sqrt(scatterDx * scatterDx + scatterDy * scatterDy) || 1;
            target.targetX = target.x + (scatterDx / scatterD) * 80;
            target.targetY = target.y + (scatterDy / scatterD) * 80;
          }

          // ─── TROLL CLUB SLAM: enemies hit by troll get their attack cooldown doubled ───
          if (u.type === 'troll' && !target.dead) {
            target.attackTimer += ATTACK_CD_MS;
          }

          // ─── SKULL UNDYING: cheats death once, survives at 1 HP ───
          if (target.hp <= 0 && target.type === 'skull' && target.hasRebirth) {
            target.hp = 1;
            target.hasRebirth = false;
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
            target.claimItemId = -1; // release any resource claim
            // Drop meat on death (all units)
            this.spawnGroundItem('meat', target.x + (Math.random() - 0.5) * 20, target.y + (Math.random() - 0.5) * 20);
            // Elite prey drops crystals
            if (target.isElite) {
              this.eliteKillCount++;
              for (let ci = 0; ci < 3; ci++) {
                this.spawnGroundItem('crystal', target.x + (Math.random() - 0.5) * 40, target.y + (Math.random() - 0.5) * 40);
              }
            }
            // Drop carried resource
            if (target.carrying) {
              this.spawnGroundItem(target.carrying, target.x, target.y);
              target.carrying = null;
            }
          }

          // Forge: Lifesteal — heal attacker for 10% of damage dealt
          if (u.team !== 0 && this.forgeUpgrades[u.team as 1 | 2]?.has('lifesteal') && !target.dead) {
            u.hp = Math.min(u.maxHp, u.hp + dmg * 0.10);
          }
          // Forge: Thorns — reflect 15% damage back to attacker
          if (target.team !== 0 && this.forgeUpgrades[target.team as 1 | 2]?.has('thorns') && !target.dead) {
            u.hp -= dmg * 0.15;
            if (u.hp <= 0) { u.dead = true; u.claimItemId = -1; }
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
        let cd = ATTACK_CD_MS;
        if (u.team !== 0 && this.forgeUpgrades[u.team as 1 | 2]?.has('war_drums')) cd *= 0.75;
        u.attackTimer = cd;
        // Forge: Berserker Rage — 2x attack speed below 30% HP
        if (u.team !== 0 && u.hp / u.maxHp < 0.3 && this.forgeUpgrades[u.team as 1 | 2]?.has('berserker_rage')) {
          u.attackTimer = Math.round(u.attackTimer / 2);
        }

        // Face attack target + play attack animation (no lunge movement)
        u.attackFaceX = best.x;
        if (u.sprite && u.animState !== 'attack' && HORDE_SPRITE_CONFIGS[u.type]) {
          u.animState = 'attack';
          u.sprite.play(`h_${u.type}_attack`);
        }
      } else if (nex && nexD <= COMBAT_RANGE && u.team !== 0) {
        let nexDmg = u.attack * (1 + this.getBuffs(u.team as 1 | 2).attack);
        if (this.forgeUpgrades[u.team as 1 | 2]?.has('siege_mastery')) nexDmg *= 2;
        nex.hp -= nexDmg;
        this.spawnDmgNumber(nex.x, nex.y - 20, nexDmg, true, u);
        u.attackTimer = ATTACK_CD_MS;

        // Face nexus + play attack animation (no lunge movement)
        u.attackFaceX = nex.x;
        if (u.sprite && u.animState !== 'attack' && HORDE_SPRITE_CONFIGS[u.type]) {
          u.animState = 'attack';
          u.sprite.play(`h_${u.type}_attack`);
        }
      }
    }
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
            this.showFeedback(
              `${winner === 1 ? 'You' : 'Enemy'} captured ${camp.name}!`,
              winner === 1 ? '#45E6B0' : '#FF6B6B',
            );
          }
        }
      } else {
        // Owned camp: if enemies arrive and no allies defend, reset to neutral with fresh defenders
        const enemy = camp.owner === 1 ? 2 : 1;
        const en = this.units.filter(u => u.team === enemy && !u.dead && pdist(u, camp) <= CAMP_RANGE);
        const al = this.units.filter(u => u.team === camp.owner && !u.dead && pdist(u, camp) <= CAMP_RANGE);
        if (en.length > 0 && al.length === 0) {
          camp.owner = 0;
          camp.spawnTimer = 0;
          this.spawnCampDefenders(camp);
          this.showFeedback(`${camp.name} is contested!`, '#FFD93D');
        }
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
          this.showFeedback('Sweep complete! All targets captured.', '#45E6B0');
          delete this.activeSweeps[key];
          continue;
        }

        const next = sweep.targets[sweep.currentIdx];
        const sel = this.units.filter(u => u.team === sweep.team && !u.dead && (sweep.subject === 'all' || u.type === sweep.subject));
        if (sel.length > 0) {
          this.sendUnitsTo(sel, next.x, next.y, true);
          const nextName = this.camps.find(c => c.id === next.id)?.name || 'next camp';
          this.showFeedback(`Sweeping to ${nextName}...`, '#45E6B0');
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
          .sort((a, b) => pdist(a, P2_BASE) - pdist(b, P2_BASE));
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
      .sort((a, b) => a.tier - b.tier || pdist(a, P2_BASE) - pdist(b, P2_BASE));

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
    // Group units for formation offsets
    const groups = new Map<string, HUnit[]>();
    for (const u of this.units) {
      if (u.dead) continue;
      const k = `${u.type}_${u.team}`;
      if (!groups.has(k)) groups.set(k, []);
      groups.get(k)!.push(u);
    }

    for (const u of this.units) {
      if (u.dead) {
        if (u.sprite) { u.sprite.destroy(); u.sprite = null; }
        continue;
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
          u.sprite.setDepth(20);
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
          u.carrySprite = this.add.text(0, 0, RESOURCE_EMOJI[u.carrying], {
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
    }
  }

  private setDebugUnit(u: HUnit | null) {
    // Clean up old debug visuals
    if (this.debugText) { this.debugText.destroy(); this.debugText = null; }
    if (this.debugHighlight) { this.debugHighlight.destroy(); this.debugHighlight = null; }
    this.debugUnit = u;
    if (!u) return;
    this.debugText = this.add.text(0, 0, '', {
      fontSize: '11px', color: '#FFFFFF', backgroundColor: '#000000AA',
      padding: { x: 6, y: 4 },
    }).setDepth(100).setOrigin(0, 1);
    this.debugHighlight = this.add.circle(0, 0, 20, 0xFFFF00, 0).setStrokeStyle(2, 0xFFFF00, 0.8).setDepth(99);
  }

  private updateDebugOverlay() {
    const u = this.debugUnit;
    if (!u || u.dead) { this.setDebugUnit(null); return; }
    if (!this.debugText || !this.debugHighlight) return;

    // Position highlight and text near the unit
    this.debugHighlight.setPosition(u.x, u.y);
    this.debugText.setPosition(u.x + 25, u.y - 10);

    const team = u.team === 0 ? 'neutral' : u.team === 1 ? 'P1' : 'P2';
    const def = ANIMALS[u.type];
    const stepInfo = u.loop
      ? `Step ${u.loop.currentStep}/${u.loop.steps.length}: ${JSON.stringify(u.loop.steps[u.loop.currentStep])}`
      : 'no workflow';
    const loopLabel = u.loop?.label || '-';
    const carry = u.carrying || 'none';
    const claim = u.claimItemId >= 0 ? `item#${u.claimItemId}` : 'none';
    const dist = Math.round(Math.sqrt((u.targetX - u.x) ** 2 + (u.targetY - u.y) ** 2));
    const nonCombat = this.isNonCombatStep(u) ? 'YES' : 'no';

    this.debugText.setText([
      `${def?.emoji || '?'} ${u.type} #${u.id} [${team}]`,
      `HP: ${Math.round(u.hp)}/${u.maxHp}  ATK: ${u.attack}  SPD: ${u.speed}`,
      `Pos: (${Math.round(u.x)}, ${Math.round(u.y)})`,
      `Target: (${Math.round(u.targetX)}, ${Math.round(u.targetY)}) dist=${dist}`,
      `Carrying: ${carry}  Claim: ${claim}`,
      `Workflow: ${loopLabel}`,
      `${stepInfo}`,
      `Idle: ${Math.round(u.idleTimer)}ms  NonCombat: ${nonCombat}`,
      `Anim: ${u.animState}  Camp: ${u.campId || '-'}`,
    ].join('\n'));
  }

  private updateMineVisuals() {
    for (const mine of this.mineNodes) {
      if (!mine.sprite) {
        mine.sprite = this.add.text(mine.x, mine.y, '⛏️', { fontSize: '32px' }).setOrigin(0.5).setDepth(14);
        mine.label = this.add.text(mine.x, mine.y + 25, 'Mine', {
          fontSize: '11px', color: '#FFD700',
          stroke: '#000', strokeThickness: 2,
        }).setOrigin(0.5).setDepth(14);
      }
      // Show how many units are mining here
      const miners = this.units.filter(u => !u.dead && u.team !== 0
        && u.loop?.steps[u.loop.currentStep]?.action === 'mine'
        && pdist(u, mine) < MINE_RANGE);
      if (mine.label) {
        mine.label.setText(miners.length > 0 ? `Mine (${miners.length} mining)` : 'Mine');
      }
    }
  }

  private updateCampVisuals() {
    for (const c of this.camps) {
      // Dormant camps (tier not yet unlocked) — dim and show locked label
      if (!this.isCampActive(c) && c.owner === 0) { c.area?.setFillStyle(0x555555, 0.03); c.area?.setStrokeStyle(2, 0x555555, 0.12); if (c.captureBar) c.captureBar.clear(); if (c.label) { const zoom = this.cameras.main.zoom; c.label.setScale(Math.max(0.8, 1.0 / zoom)); const tier = ANIMALS[c.animalType]?.tier || 1; c.label.setText(c.name + ' [T' + tier + ' locked]'); c.label.setColor('#555555'); } continue; }
      const color = c.owner === 0 ? 0xFFD93D : TEAM_COLORS[c.owner as 1 | 2];
      c.area?.setFillStyle(color, 0.08);
      c.area?.setStrokeStyle(2, color, 0.3);

      const defenders = this.units.filter(u => u.campId === c.id && u.team === 0 && !u.dead);
      const g = c.captureBar;
      if (g) {
        g.clear();
        if (c.owner === 0 && c.guardCount > 0) {
          // Show capture progress bar: how much HP remains
          const totalMaxHp = c.guardCount * (ANIMALS[c.animalType]?.hp ?? 25) * 1.5;
          const currentHp = defenders.reduce((s, u) => s + Math.max(0, u.hp), 0);
          const pct = Math.max(0, currentHp / totalMaxHp);
          const w = 90, h = 7;
          const bx = c.x - w / 2, by = c.y + 25;
          g.fillStyle(0x000000, 0.6);
          g.fillRoundedRect(bx, by, w, h, 3);
          const barColor = pct > 0.5 ? 0xFFD93D : pct > 0.25 ? 0xFF9F43 : 0xFF5555;
          g.fillStyle(barColor, 0.9);
          g.fillRoundedRect(bx, by, w * pct, h, 3);
        }
      }

      // Label — scale inversely with zoom so text stays readable at any zoom level
      if (c.label) {
        const zoom = this.cameras.main.zoom;
        const baseScale = 1.0 / zoom; // counter the zoom
        const minScale = 0.8;  // don't get too tiny when zoomed in a lot
        const scale = Math.max(minScale, baseScale);
        c.label.setScale(scale);

        if (c.owner === 0 && defenders.length > 0) {
          c.label.setText(`${c.name} (${defenders.length}/${c.guardCount})`);
          c.label.setColor('#FFD93D');
        } else {
          const tag = c.owner === 0 ? ' (cleared!)' : c.owner === 1 ? ' [YOU]' : ' [ENEMY]';
          // Show food progress for owned camps
          let foodTag = '';
          if (c.owner !== 0) {
            const cost = SPAWN_COSTS[c.animalType];
            if (cost && c.storedFood > 0) {
              foodTag = ` ${RESOURCE_EMOJI[cost.type]}${c.storedFood}/${cost.amount}`;
            }
          }
          c.label.setText(c.name + tag + foodTag);
          c.label.setColor(c.owner === 0 ? '#45E6B0' : c.owner === 1 ? '#4499FF' : '#FF5555');
        }
      }
    }
  }

  // ─── CLEANUP / WIN ──────────────────────────────────────────

  private cleanupDead() {
    this.units = this.units.filter(u => {
      if (u.dead) {
        if (u.sprite) { u.sprite.destroy(); u.sprite = null; }
        if (u.carrySprite) { u.carrySprite.destroy(); u.carrySprite = null; }
      }
      return !u.dead;
    });
  }

  // ─── RESOURCE ECONOMY: GROUND ITEMS ──────────────────────────

  private spawnGroundItem(type: ResourceType, x: number, y: number) {
    if (this.groundItems.filter(i => !i.dead).length >= MAX_GROUND_ITEMS) return;
    this.groundItems.push({
      id: this.nextItemId++, type,
      x: Math.max(20, Math.min(WORLD_W - 20, x)),
      y: Math.max(20, Math.min(WORLD_H - 20, y)),
      sprite: null, dead: false, age: 0,
    });
  }

  private updateCarrotSpawning(delta: number) {
    this.carrotSpawnTimer += delta;
    if (this.carrotSpawnTimer < CARROT_SPAWN_MS) return;
    this.carrotSpawnTimer -= CARROT_SPAWN_MS;

    if (this.mapDef && this.mapDef.carrotZones.length > 0) {
      // Map-driven carrot zones: spawn 1 carrot in a random zone per tick
      // Spawn 2 total (pick 2 random zones, or same zone twice)
      for (let i = 0; i < 2; i++) {
        const zone = this.mapDef.carrotZones[Math.floor(Math.random() * this.mapDef.carrotZones.length)];
        const x = zone.x + Math.random() * zone.w;
        const y = zone.y + Math.random() * zone.h;
        this.spawnGroundItem('carrot', x, y);
      }
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

  private updateGroundItems(delta: number) {
    for (const item of this.groundItems) {
      if (item.dead) continue;
      item.age += delta;
      if (item.age >= ITEM_DESPAWN_MS) { item.dead = true; continue; }
      if (!item.sprite) {
        const itemSize = (item.type === 'carrot' || item.type === 'meat') ? '32px' : '16px';
        item.sprite = this.add.text(item.x, item.y, RESOURCE_EMOJI[item.type], {
          fontSize: itemSize,
        }).setOrigin(0.5).setDepth(15);
        // Gentle bob animation
        this.tweens.add({ targets: item.sprite, y: item.y - 5, duration: 1200, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });
      }
      // Fade near end of life
      const remaining = ITEM_DESPAWN_MS - item.age;
      if (remaining < 10000 && item.sprite) item.sprite.setAlpha(remaining / 10000);
    }
    this.groundItems = this.groundItems.filter(i => {
      if (i.dead && i.sprite) { i.sprite.destroy(); i.sprite = null; }
      return !i.dead;
    });
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
      if (this.forgeUpgrades[u.team as 1 | 2]?.has('gatherer_gloves')) range *= 1.5;
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
          // Picked up a resource — advance workflow past seek_resource step
          if (curStep.action === 'seek_resource') this.advanceWorkflow(u);
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

      // Deliver to own base
      if (pdist(u, base) < PICKUP_RANGE + 25) {
        this.baseStockpile[team][u.carrying] += carryAmount;
        this.clearCarrying(u);
        this.trySpawnFromDelivery(team, 'base');
        continue;
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
        if (pdist(u, camp) < PICKUP_RANGE + 25) {
          const cost = SPAWN_COSTS[camp.animalType];
          if (cost && cost.type === u.carrying) {
            camp.storedFood += carryAmount;
            this.clearCarrying(u);
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

  /** Advance to next workflow step, looping back to 0 at the end */
  private advanceWorkflow(u: HUnit) {
    if (!u.loop) return;
    u.loop.currentStep = (u.loop.currentStep + 1) % u.loop.steps.length;
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
        const item = this.groundItems.find(i => i.id === u.claimItemId);
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
            u.loop.currentStep = 0;
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
            u.claimItemId = -1; // release claim on pickup
            this.advanceWorkflow(u);
            break;
          }
          // Invalidate claim if item is gone
          if (u.claimItemId >= 0) {
            const claimed = this.groundItems.find(i => i.id === u.claimItemId);
            if (!claimed || claimed.dead) u.claimItemId = -1;
          }
          // Scan for nearest unclaimed resource — exclusive claims, no sharing
          const currentClaimDist = u.claimItemId >= 0
            ? pdist(u, this.groundItems.find(i => i.id === u.claimItemId)!)
            : Infinity;
          let bestItem: HGroundItem | null = null, bestItemD = Infinity;
          for (const item of this.groundItems) {
            if (item.dead || item.type !== step.resourceType) continue;
            // Exclusive: skip items claimed by another unit
            if (claimedItems.has(item.id) && item.id !== u.claimItemId) continue;
            const itemD = pdist(u, item);
            if (itemD < bestItemD) { bestItemD = itemD; bestItem = item; }
          }
          if (bestItem && (u.claimItemId < 0 || bestItemD < currentClaimDist * 0.7)) {
            // Switch to closer resource (must be 30%+ closer to avoid thrashing)
            if (u.claimItemId >= 0) claimedItems.delete(u.claimItemId);
            u.claimItemId = bestItem.id;
            claimedItems.add(bestItem.id);
            u.targetX = bestItem.x; u.targetY = bestItem.y;
          } else if (u.claimItemId >= 0) {
            // Keep pathing to current claim
            const claimed = this.groundItems.find(i => i.id === u.claimItemId)!;
            u.targetX = claimed.x; u.targetY = claimed.y;
          } else {
            // Nothing unclaimed on the map — spread out to cover ground
            this.spreadOut(u);
          }
          break;
        }

        case 'deliver': {
          if (!u.carrying) {
            // Nothing to deliver — loop back to seek
            this.advanceWorkflow(u);
            break;
          }
          // Resolve delivery target
          const target = this.resolveDeliverTarget(step.target, team);
          if (target) {
            u.targetX = target.x; u.targetY = target.y;
          } else {
            // Target camp lost — drop food and restart workflow from step 0
            this.spawnGroundItem(u.carrying, u.x, u.y);
            u.carrying = null;
            if (u.carrySprite) { u.carrySprite.destroy(); u.carrySprite = null; }
            if (u.loop) {
              u.loop.currentStep = 0;
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

          // Look on the ground first — if matching unclaimed resource exists, go pick it up
          if (huntResType) {
            const groundRes = this.groundItems
              .filter(i => !i.dead && i.type === huntResType
                && (!claimedItems.has(i.id) || i.id === u.claimItemId))
              .sort((a, b) => pdist(u, a) - pdist(u, b));
            if (groundRes.length > 0) {
              if (u.claimItemId >= 0) claimedItems.delete(u.claimItemId);
              u.claimItemId = groundRes[0].id;
              claimedItems.add(groundRes[0].id);
              u.targetX = groundRes[0].x; u.targetY = groundRes[0].y;
              break;
            }
          }

          // No resource on ground — hunt the lowest tier wild animal (weakest first)
          // Caution: safe — only hunt prey at or below own tier (not 2+ below, that was too restrictive)
          const myTier = ANIMALS[u.type]?.tier || 1;
          const prey = this.units
            .filter(w => w.team === 0 && !w.dead && !w.campId
              && (!step.targetType || w.type === step.targetType)
              && (u.mods.caution !== 'safe' || (ANIMALS[w.type]?.tier || 1) <= myTier))
            .sort((a, b) => {
              const tierA = ANIMALS[a.type]?.tier || 1;
              const tierB = ANIMALS[b.type]?.tier || 1;
              if (tierA !== tierB) return tierA - tierB; // lowest tier first
              return pdist(u, a) - pdist(u, b); // then nearest
            });
          if (prey.length > 0) {
            u.targetX = prey[0].x; u.targetY = prey[0].y;
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
              c.animalType === step.targetAnimal && c.owner !== team);
            if (qualifier === 'nearest') filtered.sort((a, b) => pdist(a, base) - pdist(b, base));
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
          // If far from guard point, go there
          if (distToGuard > 120) {
            u.targetX = guardPos.x; u.targetY = guardPos.y;
          } else {
            // At guard point — look for nearby enemies to chase
            const nearby = this.units
              .filter(e => !e.dead && e.team !== 0 && e.team !== team && pdist(e, guardPos) < 250)
              .sort((a, b) => pdist(u, a) - pdist(u, b));
            if (nearby.length > 0) {
              u.targetX = nearby[0].x; u.targetY = nearby[0].y;
            } else {
              // Patrol near guard point
              if (pdist(u, { x: u.targetX, y: u.targetY }) < 12) {
                const a = Math.random() * Math.PI * 2;
                const r = 30 + Math.random() * 60;
                u.targetX = guardPos.x + Math.cos(a) * r;
                u.targetY = guardPos.y + Math.sin(a) * r;
              }
            }
          }
          // Defend loops never advance — they stay forever
          break;
        }

        case 'attack_enemies': {
          // Seek and fight nearest enemy player units (not neutrals)
          const enemyTeam = team === 1 ? 2 : 1;
          const enemies = this.units
            .filter(e => !e.dead && e.team === enemyTeam)
            .sort((a, b) => pdist(u, a) - pdist(u, b));
          if (enemies.length > 0) {
            u.targetX = enemies[0].x; u.targetY = enemies[0].y;
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
          // Pick the furthest unvisited camp or wander
          const scoutTarget = this.camps
            .filter(c => pdist(u, c) > 200)
            .sort((a, b) => pdist(u, b) - pdist(u, a));
          if (scoutTarget.length > 0) {
            // Pick a random far camp to explore
            const pick = scoutTarget[Math.floor(Math.random() * Math.min(3, scoutTarget.length))];
            if (pdist(u, { x: u.targetX, y: u.targetY }) < 30) {
              u.targetX = pick.x; u.targetY = pick.y;
            }
          } else {
            // All camps close, wander randomly
            if (pdist(u, { x: u.targetX, y: u.targetY }) < 30) {
              u.targetX = 100 + Math.random() * (WORLD_W - 200);
              u.targetY = 100 + Math.random() * (WORLD_H - 200);
            }
          }
          // Scout never advances — loops forever
          break;
        }

        case 'collect': {
          // Pick up ground resources while avoiding enemies — safe gathering
          if (u.carrying) {
            // Deliver to base
            u.targetX = base.x; u.targetY = base.y;
            break;
          }
          // Check if current claim is still valid
          if (u.claimItemId >= 0) {
            const claimed = this.groundItems.find(i => i.id === u.claimItemId);
            if (claimed && !claimed.dead) {
              u.targetX = claimed.x; u.targetY = claimed.y;
              break;
            }
            u.claimItemId = -1;
          }
          // Find nearest unclaimed resource of the right type, avoiding enemies
          const collectRes = step.resourceType;
          let bestItem: HGroundItem | null = null, bestItemD = Infinity;
          for (const item of this.groundItems) {
            if (item.dead || item.type !== collectRes) continue;
            if (claimedItems.has(item.id)) continue;
            // Skip items near enemy units
            const enemyNearItem = this.units.some(e =>
              !e.dead && e.team !== 0 && e.team !== team && pdist(e, item) < 200);
            if (enemyNearItem) continue;
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
          // Hunt and kill wild animals but do NOT pick up drops
          const killPrey = this.units
            .filter(w => w.team === 0 && !w.dead && !w.campId
              && (!step.targetType || w.type === step.targetType))
            .sort((a, b) => pdist(u, a) - pdist(u, b));
          if (killPrey.length > 0) {
            u.targetX = killPrey[0].x; u.targetY = killPrey[0].y;
          }
          // Kill_only never advances — loops forever
          break;
        }

        case 'mine': {
          // If carrying metal, advance to next step (probably deliver)
          if (u.carrying) { this.advanceWorkflow(u); break; }
          // Find nearest mine node
          const nearestMine = this.mineNodes
            .slice()
            .sort((a, b) => pdist(u, a) - pdist(u, b))[0];
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
                // carrySprite will be created by the rendering code
              }
            }
          } else {
            this.spreadOut(u);
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
      const camp = this.camps
        .filter(c => c.owner === team && c.animalType === animalType)
        .sort((a, b) => pdist(a, base) - pdist(b, base))[0];
      return camp || null;
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
    const wildTypes = ['skull', 'spider', 'gnoll', 'panda', 'lizard'];
    for (let i = 0; i < WILD_ANIMAL_COUNT; i++) {
      const type = wildTypes[Math.floor(Math.random() * wildTypes.length)];
      const def = ANIMALS[type];
      const pos = this.randomOutskirtsPos();
      const { x, y } = pos;
      this.units.push({
        id: this.nextId++, type, team: 0,
        hp: def.hp, maxHp: def.hp, attack: def.attack, speed: def.speed * 0.4,
        x, y, targetX: x + Math.random() * 100 - 50, targetY: y + Math.random() * 100 - 50,
        attackTimer: 0, sprite: null, dead: false, animState: 'idle' as const, prevSpriteX: 0, prevSpriteY: 0,
        campId: null, lungeX: 0, lungeY: 0,
        hasRebirth: false, diveReady: false, diveTimer: 0, lastAttackTarget: -1, attackFaceX: null, mods: { ...DEFAULT_MODS },
        carrying: null, carrySprite: null, loop: null, isElite: false, idleTimer: 0, claimItemId: -1,
      });
    }
    // Elite golden prey — very strong, drops crystals
    for (let i = 0; i < ELITE_PREY_COUNT; i++) {
      let x: number, y: number;
      do {
        x = WORLD_W * 0.2 + Math.random() * (WORLD_W * 0.6);
        y = WORLD_H * 0.2 + Math.random() * (WORLD_H * 0.6);
      } while (pdist({ x, y }, P1_BASE) < 600 || pdist({ x, y }, P2_BASE) < 600);
      this.units.push({
        id: this.nextId++, type: 'minotaur', team: 0,
        hp: 2000, maxHp: 2000, attack: 150, speed: 90,
        x, y, targetX: x + Math.random() * 80 - 40, targetY: y + Math.random() * 80 - 40,
        attackTimer: 0, sprite: null, dead: false, animState: 'idle' as const, prevSpriteX: 0, prevSpriteY: 0,
        campId: null, lungeX: 0, lungeY: 0,
        hasRebirth: false, diveReady: false, diveTimer: 0, lastAttackTarget: -1, attackFaceX: null, mods: { ...DEFAULT_MODS },
        carrying: null, carrySprite: null, loop: null, isElite: true, idleTimer: 0, claimItemId: -1,
      });
    }
  }

  private updateWildAnimals(delta: number) {
    if (this.currentEra < 2) return; // No wild animals before Era 2
    this.wildRespawnTimer += delta;
    if (this.wildRespawnTimer >= WILD_RESPAWN_MS) {
      this.wildRespawnTimer -= WILD_RESPAWN_MS;
      const wilds = this.units.filter(u => u.team === 0 && !u.campId && !u.dead && !u.isElite);
      const elites = this.units.filter(u => u.team === 0 && !u.campId && !u.dead && u.isElite);
      if (wilds.length < WILD_ANIMAL_COUNT) {
        const wt = ['skull', 'spider', 'gnoll', 'panda', 'lizard'];
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
          hasRebirth: false, diveReady: false, diveTimer: 0, lastAttackTarget: -1, attackFaceX: null, mods: { ...DEFAULT_MODS },
          carrying: null, carrySprite: null, loop: null, isElite: false, idleTimer: 0, claimItemId: -1,
        });
      }
      if (this.currentEra >= 4 && elites.length < ELITE_PREY_COUNT) {
        let x: number, y: number;
        do { x = WORLD_W * 0.2 + Math.random() * (WORLD_W * 0.6); y = WORLD_H * 0.2 + Math.random() * (WORLD_H * 0.6);
        } while (pdist({ x, y }, P1_BASE) < 600 || pdist({ x, y }, P2_BASE) < 600);
        this.units.push({
          id: this.nextId++, type: 'minotaur', team: 0,
          hp: 2000, maxHp: 2000, attack: 150, speed: 90,
          x, y, targetX: x + Math.random() * 80 - 40, targetY: y + Math.random() * 80 - 40,
          attackTimer: 0, sprite: null, dead: false, animState: 'idle' as const, prevSpriteX: 0, prevSpriteY: 0,
          campId: null, lungeX: 0, lungeY: 0,
          hasRebirth: false, diveReady: false, diveTimer: 0, lastAttackTarget: -1, attackFaceX: null, mods: { ...DEFAULT_MODS },
          carrying: null, carrySprite: null, loop: null, isElite: true, idleTimer: 0, claimItemId: -1,
        });
      }
    }
    // Wander wild animals — stay on outskirts, away from center AND player bases
    const cx = WORLD_W / 2, cy = WORLD_H / 2;
    const BASE_AVOID = this.mapDef?.safeRadius ? this.mapDef.safeRadius + 100 : 600; // wild animals stay this far from player bases
    for (const u of this.units) {
      if (u.team !== 0 || u.campId || u.dead) continue;

      // Continuously push wilds away from bases (even mid-path)
      const d1 = pdist(u, P1_BASE), d2 = pdist(u, P2_BASE);
      if (d1 < BASE_AVOID || d2 < BASE_AVOID) {
        const nearBase = d1 < d2 ? P1_BASE : P2_BASE;
        const awayX = u.x - nearBase.x, awayY = u.y - nearBase.y;
        const awayD = Math.sqrt(awayX * awayX + awayY * awayY) || 1;
        const pushR = 400 + Math.random() * 300;
        u.targetX = Math.max(100, Math.min(WORLD_W - 100, u.x + (awayX / awayD) * pushR));
        u.targetY = Math.max(100, Math.min(WORLD_H - 100, u.y + (awayY / awayD) * pushR));
        continue;
      }

      if (pdist(u, { x: u.targetX, y: u.targetY }) < 15) {
        // If too close to center, push back toward nearest edge
        const distToCenter = pdist(u, { x: cx, y: cy });
        if (distToCenter < 800) {
          // Move away from center toward nearest edge
          const awayX = u.x - cx, awayY = u.y - cy;
          const awayD = Math.sqrt(awayX * awayX + awayY * awayY) || 1;
          const pushR = 300 + Math.random() * 300;
          u.targetX = Math.max(100, Math.min(WORLD_W - 100, u.x + (awayX / awayD) * pushR));
          u.targetY = Math.max(100, Math.min(WORLD_H - 100, u.y + (awayY / awayD) * pushR));
        } else {
          // Normal wander along the edges
          const a = Math.random() * Math.PI * 2;
          const r = 80 + Math.random() * 150;
          let nx = u.x + Math.cos(a) * r;
          let ny = u.y + Math.sin(a) * r;
          // Clamp to world and keep away from center and bases
          nx = Math.max(100, Math.min(WORLD_W - 100, nx));
          ny = Math.max(100, Math.min(WORLD_H - 100, ny));
          if (pdist({ x: nx, y: ny }, { x: cx, y: cy }) < 700
              || pdist({ x: nx, y: ny }, P1_BASE) < BASE_AVOID
              || pdist({ x: nx, y: ny }, P2_BASE) < BASE_AVOID) {
            // Re-roll toward outskirts
            const pos = this.randomOutskirtsPos();
            nx = pos.x; ny = pos.y;
          }
          u.targetX = nx; u.targetY = ny;
        }
      }
    }
  }

  private checkWin() {
    for (const n of this.nexuses) {
      if (n.hp <= 0) {
        this.gameOver = true;
        this.winner = n.team === 1 ? 2 : 1;
        this.showGameOver();
        return;
      }
    }
  }

  private showGameOver() {
    const cam = this.cameras.main;
    const win = this.winner === this.myTeam;
    this.add.rectangle(cam.width / 2, cam.height / 2, cam.width, cam.height, 0x000000, 0.7)
      .setScrollFactor(0).setDepth(200);
    const t = this.add.text(cam.width / 2, cam.height / 2 - 40, win ? 'VICTORY!' : 'DEFEAT', {
      fontSize: '52px', color: win ? '#45E6B0' : '#FF6B6B',
      fontFamily: '"Fredoka", sans-serif', fontStyle: 'bold',
    }).setOrigin(0.5).setScrollFactor(0).setDepth(201);
    const s = Math.floor(this.gameTime / 1000);
    this.add.text(cam.width / 2, cam.height / 2 + 20,
      `Time: ${Math.floor(s / 60)}:${(s % 60).toString().padStart(2, '0')}`, {
        fontSize: '18px', color: '#cbb8ee', fontFamily: '"Nunito", sans-serif', fontStyle: 'bold',
      }).setOrigin(0.5).setScrollFactor(0).setDepth(201);
    const btn = this.add.text(cam.width / 2, cam.height / 2 + 70, 'BACK TO MENU', {
      fontSize: '20px', color: '#45E6B0', fontFamily: '"Fredoka", sans-serif', fontStyle: 'bold',
      backgroundColor: '#0d1a0d', padding: { x: 20, y: 10 },
    }).setOrigin(0.5).setScrollFactor(0).setDepth(201).setInteractive({ useHandCursor: true });
    btn.on('pointerdown', () => { this.cleanupHTML(); this.scene.start('MenuScene'); });
    btn.on('pointerover', () => btn.setColor('#FFD93D'));
    btn.on('pointerout', () => btn.setColor('#45E6B0'));
    this.tweens.add({ targets: t, scaleX: { from: 0.5, to: 1 }, scaleY: { from: 0.5, to: 1 }, duration: 600, ease: 'Back.easeOut' });
  }

  // ─── UNIT MANAGEMENT ────────────────────────────────────────

  private spawnUnit(type: string, team: 1 | 2, x: number, y: number) {
    const def = ANIMALS[type];
    if (!def) return;
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
      hasRebirth: type === 'skull',
      diveReady: false,
      diveTimer: 0,
      lastAttackTarget: -1, attackFaceX: null,
      carrying: null, carrySprite: null,
      // Inherit active group workflow so new spawns auto-join the loop
      loop: this.groupWorkflows[`${type}_${team}`]
        ? { ...this.groupWorkflows[`${type}_${team}`], currentStep: 0 }
        : null,
      isElite: false,
      idleTimer: 0,
      claimItemId: -1,
      mods: this.groupModifiers[`${type}_${team}`]
        ? { ...this.groupModifiers[`${type}_${team}`] }
        : { ...DEFAULT_MODS },
    });
  }

  /** Apply behavior modifiers to units of the selected army. Sticky: only update axes explicitly set. */
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
    this.pendingCommandText = text;
    // Track last command per army for display on army bar
    this.lastArmyCommand[this.selectedArmy] = text;
    if (this.isOnline && !this.isHost) {
      // Guest: send command to host via Firebase
      this.showFeedback('Sending command...', '#FFD93D');
      if (this.firebase && this.gameId) {
        this.firebase.sendRemoteOrders(this.gameId, this.playerId || '', [
          { heroId: '', order: { text, team: this.myTeam, selectedArmy: this.selectedArmy } as any },
        ]);
      }
      return;
    }
    // Host or solo: execute locally
    this.handleCommand(text, this.myTeam);
  }

  /** Host pushes full game state to Firebase for guest to render */
  private pushHostSync() {
    if (!this.firebase || !this.gameId) return;
    const syncUnits: HordeSyncUnit[] = this.units.filter(u => !u.dead).map(u => ({
      id: u.id, type: u.type, team: u.team,
      hp: u.hp, maxHp: u.maxHp, attack: u.attack, speed: u.speed,
      x: u.x, y: u.y, targetX: u.targetX, targetY: u.targetY,
      dead: false, campId: u.campId,
    }));
    const syncCamps = this.camps.map(c => ({
      id: c.id, owner: c.owner, spawnTimer: c.spawnTimer,
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
    };
    this.firebase.pushSyncState(this.gameId, state as any);
  }

  /** Guest applies state snapshot from host */
  private applyGuestSync(state: HordeSyncState) {
    if (!state) return;

    // Firebase RTDB converts arrays to objects with numeric keys — normalize
    const toArray = <T>(val: T[] | Record<string, T> | undefined): T[] => {
      if (!val) return [];
      if (Array.isArray(val)) return val;
      return Object.values(val);
    };

    const syncUnits = toArray(state.units);
    const syncCamps = toArray(state.camps);
    const syncNexuses = toArray(state.nexuses);

    this.gameTime = state.gameTime || 0;
    this.nextId = state.nextId || 0;
    this.rallyPoints = state.rallyPoints || {};
    this.baseSpawnTimers = state.baseSpawnTimers || { 1: 0, 2: 0 };

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
          hasRebirth: su.type === 'skull',
          diveReady: false,
          diveTimer: 0,
          lastAttackTarget: -1, attackFaceX: null, mods: { ...DEFAULT_MODS },
          carrying: null, carrySprite: null, loop: null, isElite: false, idleTimer: 0, claimItemId: -1,
        });
      }
    }

    // Check game over (only trigger once)
    if (state.gameOver && !this.gameOver) {
      this.gameOver = true;
      this.winner = state.winner as 1 | 2 | null;
      this.showGameOver();
    }
  }

  // ─── COMMAND PARSING ─────────────────────────────────────────

  private async handleCommand(text: string, team: 1 | 2) {
    this.pendingCommandText = text;
    this.showFeedback('Processing command...', '#FFD93D');

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

    // Camp context with stored food
    const campCtx = this.camps
      .map((c, i) => {
        const defenders = this.units.filter(u => u.campId === c.id && u.team === 0 && !u.dead).length;
        const cost = SPAWN_COSTS[c.animalType];
        return {
          name: c.name, animalType: c.animalType, tier: ANIMALS[c.animalType]?.tier || 1, index: i,
          owner: c.owner === 0 ? 'NEUTRAL' : c.owner === team ? 'YOURS' : 'ENEMY',
          x: Math.round(c.x), y: Math.round(c.y),
          dist: Math.round(pdist(c, base)),
          defenders, storedFood: c.storedFood, spawnCost: cost?.amount || 0,
        };
      })
      .sort((a, b) => a.dist - b.dist);

    const myNex = this.nexuses.find(n => n.team === team)!;
    const enemyNex = this.nexuses.find(n => n.team !== team)!;
    const nexusHp = { mine: Math.round(myNex.hp), enemy: Math.round(enemyNex.hp) };

    // Count ground resources
    const alive = this.groundItems.filter(g => !g.dead);
    const groundCarrots = alive.filter(g => g.type === 'carrot').length;
    const groundMeat = alive.filter(g => g.type === 'meat').length;
    const groundCrystals = alive.filter(g => g.type === 'crystal').length;

    const ctx: GameContext = {
      myUnits, camps: campCtx, nexusHp,
      resources: { ...this.baseStockpile[team] },
      groundCarrots, groundMeat, groundCrystals,
      gameTime: this.gameTime,
      selectedArmy: this.selectedArmy,
    };

    // Try Gemini first
    const geminiResult = await parseWithGemini(text, ctx);

    if (geminiResult && geminiResult.length > 0) {
      // Only use first command — army selection is separate, one command per input
      if (this.executeGeminiCommand(geminiResult[0], team)) return;
    }

    // Fallback to local regex parsing
    this.executeLocalCommand(text, team);
  }

  private executeGeminiCommand(cmd: HordeCommand, team: 1 | 2): boolean {
    const subject = this.selectedArmy; // army is selected via Q/E keys, not parsed from voice
    const base = team === 1 ? P1_BASE : P2_BASE;
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
      this.showFeedback(cmd.narration || `Behavior updated: ${modNames.join(', ')}`, '#FFD93D');
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
          .sort((a, b) => pdist(a, base) - pdist(b, base));
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
        candidates.sort((a, b) => pdist(a, base) - pdist(b, base));
      } else if (q === 'furthest') {
        candidates.sort((a, b) => pdist(b, base) - pdist(a, base));
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
      targets.sort((a, b) => pdist(a, base) - pdist(b, base));

      if (targets.length > 0) {
        // Send to first target, set up auto-chain via rally
        tx = targets[0].x; ty = targets[0].y; found = true;

        // Store the sweep queue so units auto-advance
        const sel = this.units.filter(u => u.team === team && !u.dead && (subject === 'all' || u.type === subject));
        if (sel.length > 0) {
          this.sendUnitsTo(sel, tx, ty, true);
          // Store sweep targets for auto-chaining in update loop
          const key = `sweep_${subject}_${team}`;
          this.activeSweeps[key] = {
            team, subject, targets: targets.map(c => ({ x: c.x, y: c.y, id: c.id })), currentIdx: 0,
          };
          const label = subject === 'all' ? 'All units' : `${sel.length} ${subject}(s)`;
          this.showFeedback(cmd.narration || `${label} sweeping ${cmd.targetAnimal || 'all'} camps!`, '#45E6B0');
          return true;
        }
      }

    } else if (cmd.targetType === 'workflow' && cmd.workflow && cmd.workflow.length > 0) {
      // LLM-defined workflow — parse steps and assign to selected units
      const sel = this.units.filter(u => u.team === team && !u.dead && (subject === 'all' || u.type === subject));
      if (sel.length === 0) { this.showFeedback(`No ${subject} units!`, '#FF6B6B'); return true; }

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
            return { action: 'scout' as const };
          case 'collect':
            return { action: 'collect' as const, resourceType: (s.resourceType || 'meat') as ResourceType };
          case 'kill_only':
            return { action: 'kill_only' as const, targetType: s.targetType };
          case 'mine':
            return { action: 'mine' as const };
          default:
            return { action: 'seek_resource' as const, resourceType: 'carrot' as ResourceType };
        }
      });

      const workflow: HWorkflow = { steps, currentStep: 0, label: cmd.narration || 'Custom workflow' };
      for (const u of sel) {
        u.loop = { ...workflow, currentStep: 0 };
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
      this.showFeedback(cmd.narration || `${sel.length} units: workflow started!`, '#45E6B0');
      return true;

    } else if (cmd.targetType === 'position') {
      tx = WORLD_W / 2; ty = WORLD_H / 2; found = true;
    }

    if (!found) return false;

    const sel = this.units.filter(u => u.team === team && !u.dead && (subject === 'all' || u.type === subject));
    if (sel.length === 0) {
      this.showFeedback(`No ${subject} units!`, '#FF6B6B');
      return true;
    }
    // Clear workflows — new movement command overrides
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
    const label = subject === 'all' ? 'All units' : `${sel.length} ${subject}(s)`;
    const narration = cmd.narration || `${label} moving out!`;
    this.showFeedback(narration, '#45E6B0');
    return true;
  }

  private executeLocalCommand(text: string, team: 1 | 2) {
    const lo = text.toLowerCase();
    const subject = this.selectedArmy; // always use selected army
    const base = team === 1 ? P1_BASE : P2_BASE;

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

    // "get/make/take [animal]" commands — ALWAYS use full bootstrap workflow
    const makeMatch = lo.match(/\b(?:get|make|take|produce|spawn|create|breed|train)\s+(?:more\s+)?(\w+)/i);
    if (makeMatch) {
      const animalPatterns: [RegExp, string][] = [
        [/gnome(s)?/i, 'gnome'], [/turtle(s)?/i, 'turtle'],
        [/skull(s)?/i, 'skull'], [/spider(s)?/i, 'spider'], [/gnoll(s)?/i, 'gnoll'],
        [/panda(s)?/i, 'panda'], [/lizard(s)?/i, 'lizard'],
        [/minotaur(s)?/i, 'minotaur'], [/shaman(s)?/i, 'shaman'], [/troll(s)?/i, 'troll'],
      ];
      let animal: string | null = null;
      for (const [pat, name] of animalPatterns) {
        if (pat.test(makeMatch[1])) { animal = name; break; }
      }
      if (animal) {
        const cost = SPAWN_COSTS[animal];
        if (cost) {
          const sel = this.units.filter(u => u.team === team && !u.dead && (subject === 'all' || u.type === subject));
          if (sel.length === 0) { this.showFeedback(`No ${subject} units!`, '#FF6B6B'); return; }

          const wf = makeBootstrapWorkflow(animal);
          for (const u of sel) { u.loop = { ...wf, currentStep: 0 }; }
          // Store as group workflow for future spawns
          if (subject === 'all') {
            const types = new Set(sel.map(u => u.type));
            for (const t of types) this.groupWorkflows[`${t}_${team}`] = wf;
          } else {
            this.groupWorkflows[`${subject}_${team}`] = wf;
          }
          const emoji = ANIMALS[animal]?.emoji || '';
          this.showFeedback(`${sel.length} units: bootstrap ${emoji} ${cap(animal)}!`, '#45E6B0');
          return;
        }
      }
    }

    // Scout / explore / recon commands
    if (/\b(scout|explore|recon|reconnaissance)\b/i.test(lo)) {
      const sel = this.units.filter(u => u.team === team && !u.dead && (subject === 'all' || u.type === subject));
      if (sel.length === 0) { this.showFeedback(`No ${subject} units!`, '#FF6B6B'); return; }

      const wf: HWorkflow = { steps: [{ action: 'scout' }], currentStep: 0, label: 'scouting' };
      for (const u of sel) { u.loop = { ...wf, currentStep: 0 }; }
      if (subject === 'all') {
        const types = new Set(sel.map(u => u.type));
        for (const t of types) this.groupWorkflows[`${t}_${team}`] = wf;
      } else {
        this.groupWorkflows[`${subject}_${team}`] = wf;
      }
      this.showFeedback(`${sel.length} units scouting!`, '#45E6B0');
      return;
    }

    // Collect safely (avoid enemies) commands
    if (/\b(collect|pick\s*up)\b.*\b(safe|avoid)/i.test(lo) || /\bcollect\s+(meat|carrot|crystal)/i.test(lo)) {
      let resType: ResourceType = 'carrot';
      if (/meat|flesh/i.test(lo)) resType = 'meat';
      else if (/crystal|gem|diamond/i.test(lo)) resType = 'crystal';

      const sel = this.units.filter(u => u.team === team && !u.dead && (subject === 'all' || u.type === subject));
      if (sel.length === 0) { this.showFeedback(`No ${subject} units!`, '#FF6B6B'); return; }

      const wf: HWorkflow = { steps: [{ action: 'collect', resourceType: resType }], currentStep: 0, label: `safe ${resType} collect` };
      for (const u of sel) { u.loop = { ...wf, currentStep: 0 }; }
      if (subject === 'all') {
        const types = new Set(sel.map(u => u.type));
        for (const t of types) this.groupWorkflows[`${t}_${team}`] = wf;
      } else {
        this.groupWorkflows[`${subject}_${team}`] = wf;
      }
      this.showFeedback(`${sel.length} units safely collecting ${RESOURCE_EMOJI[resType]}!`, '#45E6B0');
      return;
    }

    // Kill only (fight but skip drops) commands
    if (/\b(kill\s*only|just\s*kill|clear\s*animals|kill\s*wilds)\b/i.test(lo)) {
      const sel = this.units.filter(u => u.team === team && !u.dead && (subject === 'all' || u.type === subject));
      if (sel.length === 0) { this.showFeedback(`No ${subject} units!`, '#FF6B6B'); return; }

      let targetType: string | undefined;
      if (/elite|minotaur/i.test(lo)) targetType = 'minotaur';

      const step: WorkflowStep = targetType
        ? { action: 'kill_only', targetType }
        : { action: 'kill_only' };
      const wf: HWorkflow = { steps: [step], currentStep: 0, label: 'kill only' };
      for (const u of sel) { u.loop = { ...wf, currentStep: 0 }; }
      if (subject === 'all') {
        const types = new Set(sel.map(u => u.type));
        for (const t of types) this.groupWorkflows[`${t}_${team}`] = wf;
      } else {
        this.groupWorkflows[`${subject}_${team}`] = wf;
      }
      this.showFeedback(`${sel.length} units: kill only mode!`, '#45E6B0');
      return;
    }

    // Gather commands (generic resource gathering)
    if (/\b(gather|collect|farm|forage|harvest|get food)\b/i.test(lo)) {
      let resType: ResourceType = 'carrot';
      if (/meat|flesh|kill/i.test(lo)) resType = 'meat';
      else if (/crystal|gem|diamond|elite/i.test(lo)) resType = 'crystal';

      const sel = this.units.filter(u => u.team === team && !u.dead && (subject === 'all' || u.type === subject));
      if (sel.length === 0) { this.showFeedback(`No ${subject} units!`, '#FF6B6B'); return; }

      const wf = makeGatherWorkflow(resType, 'base');
      for (const u of sel) { u.loop = { ...wf, currentStep: 0 }; }
      if (subject === 'all') {
        const types = new Set(sel.map(u => u.type));
        for (const t of types) this.groupWorkflows[`${t}_${team}`] = wf;
      } else {
        this.groupWorkflows[`${subject}_${team}`] = wf;
      }
      this.showFeedback(`${sel.length} units gathering ${RESOURCE_EMOJI[resType]}!`, '#45E6B0');
      return;
    }

    // "upgrade [name]" / "buy [name]" / "research [name]"
    const upgradeMatch = lo.match(/\b(?:upgrade|buy|research|forge|unlock)\s+(.+)/i);
    if (upgradeMatch) {
      const query = upgradeMatch[1].toLowerCase().trim();
      // Find best matching upgrade
      const match = FORGE_UPGRADES.find(u =>
        u.name.toLowerCase().includes(query) || u.id.includes(query.replace(/\s+/g, '_'))
      );
      if (match) {
        const success = this.purchaseUpgrade(team, match.id);
        if (success) {
          this.showFeedback(`${match.emoji} ${match.name} researched!`, '#FFD700');
        } else if (this.forgeUpgrades[team].has(match.id)) {
          this.showFeedback(`Already have ${match.name}!`, '#FF6B6B');
        } else {
          // Check why it failed
          const ownedT1 = [...this.forgeUpgrades[team]].filter(id => FORGE_UPGRADES.find(u => u.id === id)?.tier === 1).length;
          const ownedT2 = [...this.forgeUpgrades[team]].filter(id => FORGE_UPGRADES.find(u => u.id === id)?.tier === 2).length;
          if (match.tier === 2 && ownedT1 < 2) {
            this.showFeedback(`Need 2 Tier 1 upgrades first!`, '#FF6B6B');
          } else if (match.tier === 3 && ownedT2 < 2) {
            this.showFeedback(`Need 2 Tier 2 upgrades first!`, '#FF6B6B');
          } else {
            const needed = Object.entries(match.cost).map(([r, a]) => `${a}${RESOURCE_EMOJI[r as ResourceType]}`).join(' ');
            this.showFeedback(`Not enough resources! Need ${needed}`, '#FF6B6B');
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
        [/gnome(s)?/i, 'gnome'], [/turtle(s)?/i, 'turtle'],
        [/skull(s)?/i, 'skull'], [/spider(s)?/i, 'spider'], [/gnoll(s)?/i, 'gnoll'],
        [/panda(s)?/i, 'panda'], [/lizard(s)?/i, 'lizard'],
        [/minotaur(s)?/i, 'minotaur'], [/shaman(s)?/i, 'shaman'], [/troll(s)?/i, 'troll'],
      ];
      for (const [pat, name] of animalPatterns) {
        if (pat.test(lo)) {
          const cs = this.camps.filter(c => c.animalType === name && c.owner !== team)
            .sort((a, b) => pdist(a, base) - pdist(b, base));
          if (cs.length > 0) { tx = cs[0].x; ty = cs[0].y; found = true; break; }
        }
      }
    }

    // Fallback: nearest unowned camp
    if (!found && /nearest|closest|camp/i.test(lo)) {
      const cs = this.camps.filter(c => c.owner !== team).sort((a, b) => pdist(a, base) - pdist(b, base));
      if (cs.length > 0) { tx = cs[0].x; ty = cs[0].y; found = true; }
    }

    if (!found) {
      this.showFeedback('Try: "attack nexus", "nearest camp", or a camp name', '#FF6B6B');
      return;
    }

    const sel = this.units.filter(u => u.team === team && !u.dead && (subject === 'all' || u.type === subject));
    if (sel.length === 0) {
      this.showFeedback(`No ${subject} units!`, '#FF6B6B');
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
    const emoji = subject === 'all' ? '' : (ANIMALS[subject]?.emoji + ' ' || '');
    const label = subject === 'all' ? 'All units' : `${emoji}${sel.length} ${cap(subject)}(s)`;
    this.showFeedback(`${label} moving out!`, '#45E6B0');
  }

  // ─── FLOATING DAMAGE NUMBERS ────────────────────────────────
  // Style matches horde-overview.html: bold, float up, fade out, scale 1.2→0.7
  private dmgNumberPool: Phaser.GameObjects.Text[] = [];
  private dmgNumberIdx = 0;
  private readonly DMG_POOL_SIZE = 60;

  private spawnDmgNumber(x: number, y: number, amount: number, isPrimary: boolean, attacker: HUnit) {
    // Color based on attacker's team relative to viewer
    let color: string;
    if (attacker.team === 0) {
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

  private showFeedback(msg: string, color: string) {
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

    const el = document.getElementById('cmd-history-entries');
    if (!el) return;

    let html = '';
    for (let i = this.commandHistory.length - 1; i >= 0; i--) {
      const entry = this.commandHistory[i];
      const t = `${Math.floor(entry.time / 60)}:${(entry.time % 60).toString().padStart(2, '0')}`;
      const isLatest = i === this.commandHistory.length - 1;
      const opacity = isLatest ? '1' : '0.6';
      const bg = isLatest ? 'rgba(69,230,176,0.1)' : 'transparent';
      html += `<div style="opacity:${opacity};background:${bg};padding:4px 6px;border-radius:6px;margin-bottom:3px;border-left:3px solid ${entry.color};">
        <div style="display:flex;justify-content:space-between;align-items:center;">
          <span style="color:#FFD93D;font-weight:700;font-size:11px;">&gt; ${entry.command}</span>
          <span style="color:#4A6B4A;font-size:9px;">${t}</span>
        </div>
        <div style="color:${entry.color};font-size:10px;font-weight:600;margin-top:1px;">${entry.outcome}</div>
      </div>`;
    }
    el.innerHTML = html;

    // Auto-scroll to top (latest entry is at top)
    if (this.cmdHistoryEl) this.cmdHistoryEl.scrollTop = 0;
  }

  private updateSelectionLabel() {
    // Update Phaser hint text
    if (this.selectionLabel) {
      this.selectionLabel.setText('Q ◀ cycle ▶ E');
    }

    // Update HTML army bar
    if (!this.armyBarEl) return;
    const available = this.getAvailableArmies();

    let html = '';
    for (const army of available) {
      const isActive = army === this.selectedArmy;
      const emoji = army === 'all' ? '⚔️' : (ANIMALS[army]?.emoji || '?');
      const name = army === 'all' ? 'ALL' : cap(army).toUpperCase();
      const count = army === 'all'
        ? this.units.filter(u => u.team === this.myTeam && !u.dead).length
        : this.units.filter(u => u.team === this.myTeam && !u.dead && u.type === army).length;
      const tier = army === 'all' ? '' : `T${ANIMALS[army]?.tier || '?'}`;
      const lastCmd = this.lastArmyCommand[army] || '';
      // Truncate command to fit card
      const cmdDisplay = lastCmd.length > 20 ? lastCmd.slice(0, 18) + '…' : lastCmd;

      const bg = isActive ? 'rgba(69,230,176,0.25)' : 'rgba(13,26,13,0.8)';
      const border = isActive ? '#45E6B0' : '#3D5040';
      const borderW = isActive ? '3px' : '1px';
      const glow = isActive ? 'box-shadow:0 0 12px rgba(69,230,176,0.4);' : '';
      const scale = isActive ? 'transform:scale(1.1);' : '';

      html += `<div style="
        background:${bg};border:${borderW} solid ${border};border-radius:10px;
        padding:6px 12px;text-align:center;min-width:64px;
        ${glow}${scale}transition:all 0.15s ease;
      ">
        <div style="font-size:28px;line-height:1.2;">${emoji}</div>
        <div style="font-size:10px;color:${isActive ? '#45E6B0' : '#8BAA8B'};font-weight:800;letter-spacing:0.5px;">${name}</div>
        <div style="font-size:13px;color:#f0e8ff;font-weight:700;">${count}</div>
        ${tier ? `<div style="font-size:9px;color:#666;font-weight:600;">${tier}</div>` : ''}
        ${army !== 'all' && ANIMALS[army] ? `<div style="font-size:8px;color:#C98FFF;font-weight:600;white-space:nowrap;">${ANIMALS[army].ability}</div>` : ''}
        ${cmdDisplay ? `<div style="font-size:8px;color:#FFD93D;font-style:italic;margin-top:2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:80px;" title="${lastCmd.replace(/"/g, '&quot;')}">"${cmdDisplay}"</div>` : ''}
      </div>`;
    }
    this.armyBarEl.innerHTML = html;
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
    // Forge upgrade bonuses
    const owned = this.forgeUpgrades[team];
    if (owned.has('iron_weapons')) attack += 0.20;
    if (owned.has('steel_weapons')) attack += 0.30;
    if (owned.has('enchanted_blades')) attack += 0.50;
    if (owned.has('swift_boots')) speed += 0.15;
    return { speed, attack, hp };
  }

  // ─── CLEANUP ────────────────────────────────────────────────

  private cleanupHTML() {
    this.textInput?.remove(); this.textInput = null;
    this.voiceStatusEl?.remove(); this.voiceStatusEl = null;
    this.selectionLabel = null;
    this.armyBarEl?.remove(); this.armyBarEl = null;
    this.cmdHistoryEl?.remove(); this.cmdHistoryEl = null;
    this.charPanelEl?.remove(); this.charPanelEl = null;
    document.getElementById('horde-char-toggle')?.remove();
    try { this.recognition?.abort(); } catch (_e) { /* */ }
    if (this.firebase) { this.firebase.cleanup(); this.firebase = null; }
  }
}
