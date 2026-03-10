import Phaser from 'phaser';
import { FirebaseSync } from '../network/FirebaseSync';
import { HORDE_SPRITE_CONFIGS } from '../sprites/SpriteConfig';
import { MapDef, MapCampSlot, MapZoneDef, MapTerrainItem, assignAnimalsToSlots, getMapById, ALL_MAPS } from '@prompt-battle/shared';
import { SoundManager } from '../audio/SoundManager';

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
  workflow?: { action: string; resourceType?: string; target?: string; targetType?: string; campIndex?: number; qualifier?: string; targetAnimal?: string; x?: number; y?: number; equipmentType?: string }[];
  loopFrom?: number; // after end, loop back here (default 0 = loop everything)
  narration?: string;
  unitReaction?: string; // short in-character grunt/reaction for thought bubble (2-5 words)
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
  Tier 1: gnome (🧝) = 2 carrots, turtle (🐢) = 5 carrots
  Tier 2: skull (💀) = 5 meat, spider (🕷️) = 5 meat, gnoll (🐺) = 5 meat, rogue (🗡️) = 5 meat
  Tier 3: panda (🐼) = 8 meat, lizard (🦎) = 8 meat
  Tier 4: minotaur (🐂) = 12 crystals, shaman (🔮) = 12 crystals
  Tier 5: troll (👹) = 20 crystals

HOW SPAWNING WORKS: Units gather a resource → carry it to a camp of the desired type → camp uses it to spawn that unit type. E.g. "make gnomes" means gather carrots and deliver to a gnome camp. "make skulls" means gather meat and deliver to a skull camp. Base stores resources but does NOT spawn units — only camps spawn units. Each team gets 1 free gnome from base every 30 seconds automatically.

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
Example: "get swords and attack" → [{"action":"equip","equipmentType":"sword"},{"action":"attack_camp","targetAnimal":"gnoll","qualifier":"nearest"}]

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
  {"action": "scout", "x": 500, "y": 500} — explore the map, AVOIDS combat. Optional x,y to bias toward a region (e.g. "scout top left" → x:480, y:480). Omit x,y for full-map exploration.
  {"action": "collect", "resourceType": "carrot|meat|crystal"} — pick up ground resources while AVOIDING enemy units (safe gathering)
  {"action": "kill_only", "targetType": "skull|spider|..."} — hunt and kill wild animals but IGNORE resource drops (pure combat, no pickup)
  {"action": "mine"} — go to nearest mine node and extract metal, then carry it back (requires Pickaxe equipment)
  {"action": "equip", "equipmentType": "pickaxe|sword|shield|boots|banner"} — go to team Armory and equip item (must be unlocked first)

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
GNOLL (T2, 🐺): Ranged attacker (120 range vs normal 60). Excellent for defense and kiting. 3 meat.
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
"bootstrap gnolls": [{"action":"attack_camp","targetAnimal":"gnoll","qualifier":"nearest"},{"action":"hunt"},{"action":"seek_resource","resourceType":"meat"},{"action":"deliver","target":"nearest_gnoll_camp"}]
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

A) UNLOCK EQUIPMENT: "unlock/buy/research [equipment name]"
   → This is NOT a workflow. Return targetType="base" with narration about unlocking.
   → The game handles unlock logic separately from this JSON.

B) EQUIP + ACTION: "get/grab/equip [equipment] and/then [action]"
   → targetType="workflow", start with {"action":"equip","equipmentType":"..."}, then action steps
   Examples:
   "get pickaxes and mine" → [equip pickaxe, mine, deliver base]
   "grab swords and attack wolf camp" → [equip sword, attack_camp gnoll nearest]
   "get shields and defend base" → [equip shield, defend base]
   "equip boots and gather carrots" → [equip boots, seek_resource carrot, deliver base]
   "get banners and follow the army" → [equip banner, attack_enemies]
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

═══ STRATEGIC REASONING ═══
Before choosing, think step by step:
1. MODIFIERS: Does the tone imply formation/caution/pacing? Set them alongside the action.
2. INTENT: What's the primary goal? (produce unit, equip+action, gather, fight, defend, unlock?)
3. EQUIPMENT: Does the command mention equipment? "get a sword" ≠ "get skulls". Equipment names: pickaxe, sword, shield, boots, banner. Animal names: gnome, turtle, skull, spider, gnoll, panda, lizard, minotaur, shaman, troll, rogue.
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
  "loopFrom": <index where repeating loop starts, default 0>,
  "narration": "<Max 5 words, terse military tone>",
  "unitReaction": "<2-5 word in-character grunt reaction from the units, funny/cute personality. Examples: 'Aye aye!', 'SMASH TIME!', 'ooh shiny rocks!', 'hisssss yesss', '*rattles excitedly*', 'me hungry...', 'FOR GLORY!'>",
  "modifiers": {"formation": "spread|tight|null", "caution": "safe|aggressive|null", "pacing": "rush|efficient|null"},
  "modifierOnly": false
}`;

  const body = JSON.stringify({
    contents: [{ parts: [{ text: prompt }] }],
    generationConfig: {
      maxOutputTokens: 2048,
      responseMimeType: 'application/json',
      thinkingConfig: { thinkingBudget: 0 },
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
  | { action: 'scout'; x?: number; y?: number }               // explore the map, reveal camps/enemies, avoid combat. Optional x,y to bias toward a region.
  | { action: 'collect'; resourceType: ResourceType }         // pick up ground resources while avoiding enemies
  | { action: 'kill_only'; targetType?: string }              // hunt and kill wild animals but ignore drops
  | { action: 'mine' }                                        // go to nearest mine, extract metal
  | { action: 'equip'; equipmentType: EquipmentType };        // go to armory, pick up equipment

interface HWorkflow {
  steps: WorkflowStep[];
  currentStep: number;
  label: string; // LLM-provided description, shown in HUD
  loopFrom: number;    // after end, loop back here (default 0 = current behavior)
  playedOnce: boolean; // has the full sequence completed at least once?
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
  equipSprite: Phaser.GameObjects.Text | null; // visual for equipment
  mods: BehaviorMods; // behavior modifiers (formation, caution, pacing)
  // A* safe pathfinding
  pathWaypoints: {x: number; y: number}[] | null;
  pathAge: number;       // ms since last path computation
  pathTargetX: number;   // target when path was computed (invalidate on change)
  pathTargetY: number;
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

interface PendingHit {
  attackerId: number;
  targetId: number;       // unit id, or -1 for nexus
  nexusTeam: 1 | 2 | 0;  // which nexus (0 = not a nexus hit)
  dmg: number;            // pre-calculated damage
  splashTargets: { id: number; dmg: number }[]; // splash damage
  timer: number;          // ms remaining until hit lands
  isTroll: boolean;       // troll club slam effect
  isRanged: boolean;      // gnoll bone toss
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
//   🐢 Turtle  "Shell Stance" — Slowest unit but tankiest T1. 60% DR when stationary + taunts nearby foes.
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
  turtle:    { type: 'turtle',    emoji: '🐢', hp: 65,    attack: 3,    speed: 55,  tier: 1, ability: 'Shell Stance', desc: '60% DR when stationary + taunts nearby foes', mineSpeed: 1.5 },
  skull:     { type: 'skull',     emoji: '💀', hp: 80,    attack: 14,   speed: 155, tier: 2, ability: 'Undying',      desc: 'Cheats death once (survives at 1 HP)', mineSpeed: 0.8 },
  spider:    { type: 'spider',    emoji: '🕷️', hp: 120,   attack: 18,   speed: 140, tier: 2, ability: 'Venom Bite',   desc: '+5% target max HP per hit', mineSpeed: 0.6 },
  gnoll:     { type: 'gnoll',     emoji: '🐺', hp: 55,    attack: 28,   speed: 175, tier: 2, ability: 'Bone Toss',    desc: 'Extended range (120 vs 80)', mineSpeed: 0.8 },
  panda:     { type: 'panda',     emoji: '🐼', hp: 900,   attack: 35,   speed: 80,  tier: 3, ability: 'Thick Hide',   desc: 'Regenerates 1% max HP/sec', mineSpeed: 0.5 },
  lizard:    { type: 'lizard',    emoji: '🦎', hp: 450,   attack: 70,   speed: 110, tier: 3, ability: 'Cold Blood',   desc: '3x dmg to targets below 40% HP', mineSpeed: 0.7 },
  minotaur:  { type: 'minotaur',  emoji: '🐂', hp: 2200,  attack: 110,  speed: 120, tier: 4, ability: 'War Cry',      desc: 'Nearby allies +25% attack', mineSpeed: 0.4 },
  shaman:    { type: 'shaman',    emoji: '🔮', hp: 1400,  attack: 180,  speed: 100, tier: 4, ability: 'Arcane Blast', desc: 'All attacks splash 60px', mineSpeed: 0.5 },
  troll:     { type: 'troll',     emoji: '👹', hp: 14000, attack: 350,  speed: 50,  tier: 5, ability: 'Club Slam',    desc: 'Massive 90px splash, slows enemies', mineSpeed: 0.3 },
  rogue:     { type: 'rogue',     emoji: '🗡️', hp: 60,    attack: 45,   speed: 200, tier: 2, ability: 'Backstab',    desc: '3x first hit + invisible to neutrals', mineSpeed: 1.0 },
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
const MAX_UNITS = Infinity; // no swarm limit
const BASE_SPAWN_MS = 5000; // (legacy, unused)
const FREE_GNOME_MS = 30000; // free gnome from base every 30s
const ATTACK_CD_MS = 1500;
const COMBAT_RANGE = 80;
const TURTLE_TAUNT_RANGE = 100; // turtles force nearby foes to attack them
const PROJECTILE_SPEED = 450; // ranged projectile speed in pixels per second
const PROJECTILE_HIT_DIST = 18; // distance at which projectile hits target
const CAMP_RANGE = 120;
const AI_TICK_MS = 4000;
const TEAM_COLORS = { 1: 0x4499FF, 2: 0xFF5555 };
const FOG_VISION_RANGE = 400; // radius of vision around each ally unit
const GOLDEN_ANGLE = 2.39996;

// ─── RESOURCE ECONOMY ──────────────────────────────────────
const SPAWN_COSTS: Record<string, { type: ResourceType; amount: number }> = {
  gnome:     { type: 'carrot',  amount: 2 },
  turtle:    { type: 'carrot',  amount: 5 },
  skull:     { type: 'meat',    amount: 5 },
  spider:    { type: 'meat',    amount: 5 },
  gnoll:     { type: 'meat',    amount: 5 },
  panda:     { type: 'meat',    amount: 8 },
  lizard:    { type: 'meat',    amount: 8 },
  minotaur:  { type: 'crystal', amount: 12 },
  shaman:    { type: 'crystal', amount: 12 },
  troll:     { type: 'crystal', amount: 20 },
  rogue:     { type: 'meat',    amount: 5 },
};
const RESOURCE_EMOJI: Record<ResourceType, string> = { carrot: '🥕', meat: '🍖', crystal: '💎', metal: '⚙️' };

// ─── EQUIPMENT SYSTEM ──────────────────────────────────────
type EquipmentType = 'pickaxe' | 'sword' | 'shield' | 'boots' | 'banner';

interface EquipmentDef {
  id: EquipmentType;
  name: string;
  emoji: string;
  cost: Partial<Record<ResourceType, number>>;
  effect: string;
}

const EQUIPMENT: EquipmentDef[] = [
  { id: 'pickaxe', name: 'Pickaxe', emoji: '⛏️', cost: { carrot: 15 }, effect: 'Can mine metal, +25% gather speed' },
  { id: 'sword',   name: 'Sword',   emoji: '⚔️', cost: { meat: 15, metal: 5 }, effect: '+50% attack, +25% attack speed' },
  { id: 'shield',  name: 'Shield',  emoji: '🛡️', cost: { meat: 15, metal: 5 }, effect: '+60% HP, -25% damage taken, -15% speed' },
  { id: 'boots',   name: 'Boots',   emoji: '👢', cost: { carrot: 12, metal: 4 }, effect: '+60% move speed, +50% pickup range' },
  { id: 'banner',  name: 'Banner',  emoji: '🚩', cost: { meat: 20, metal: 8 }, effect: 'Aura: nearby allies +20% atk, +15% speed' },
];

const ARMORY_RANGE = 60; // how close to armory to pick up equipment

interface HArmory {
  x: number;
  y: number;
  team: 1 | 2;
  equipmentType: EquipmentType; // which equipment this armory provides
  sprite: Phaser.GameObjects.Text | null;
  label: Phaser.GameObjects.Text | null;
}

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
  private unlockedEquipment: Record<1 | 2, Set<EquipmentType>> = { 1: new Set(), 2: new Set() };
  private armories: HArmory[] = [];
  private equipPanelEl: HTMLDivElement | null = null;
  private sidebarEl: HTMLDivElement | null = null;

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
  private fogDisabled = false;

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

  // ─── SOUND ──────────────────────────────────────────────────
  private sfx!: SoundManager;

  // ─── THOUGHT BUBBLES ──────────────────────────────────────
  private thoughtBubbles: { container: Phaser.GameObjects.Container; unitId: number; timer: number }[] = [];

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

  // Editor-saved maps loaded from server file
  private static editorMaps: MapDef[] | null = null;

  /** Synchronous load — tries localStorage (editor's live data) first, then server file */
  private static loadEditorMapsSync(): void {
    // 1. Try localStorage — the HTML editor saves here on every change
    try {
      const raw = localStorage.getItem('horde-editor-maps');
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed) && parsed.length > 0) {
          // Convert editor-only _terrain field to terrain
          HordeScene.editorMaps = parsed.map((m: any) => {
            const clone = { ...m };
            // Editor stores terrain as _terrain internally, saved as terrain
            if (clone._terrain && !clone.terrain) {
              clone.terrain = clone._terrain;
            }
            delete clone._terrain;
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
    this.unlockedEquipment = { 1: new Set(), 2: new Set() };

    this.syncTimer = 0;

    this.cameras.main.setBackgroundColor('#1a1a2e');
    this.drawBackground();
    this.setupCamps();
    this.initMineNodes();
    this.initArmories();
    this.setupNexuses();
    this.setupFog();
    this.setupCamera();
    this.setupInput();
    this.setupHUD();
    this.events.on('shutdown', () => this.cleanupHTML());

    // Pre-capture T1 camps (gnome + turtle) for each team at game start
    if (!this.isOnline || this.isHost) {
      for (const animalType of ['gnome', 'turtle']) {
        const campsOfType = this.camps.filter(c => c.animalType === animalType);
        const p1Camp = campsOfType.slice().sort((a, b) => pdist(a, P1_BASE) - pdist(b, P1_BASE))[0];
        const p2Camp = campsOfType.filter(c => c !== p1Camp).sort((a, b) => pdist(a, P2_BASE) - pdist(b, P2_BASE))[0];
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

    // ─── TERRAIN PAINT FROM EDITOR ──────────────────────────
    this.drawTerrain(g);

    // Very faint base territory indicators — soft circles, not harsh rings
    g.fillStyle(0x4499FF, 0.04);
    g.fillCircle(P1_BASE.x, P1_BASE.y, 500);
    g.fillStyle(0xFF5555, 0.04);
    g.fillCircle(P2_BASE.x, P2_BASE.y, 500);
  }

  /** Seeded RNG for consistent terrain decoration placement */
  private terrainRng(seed: number): () => number {
    let s = seed;
    return () => { s = (s * 16807 + 1) % 2147483647; return (s - 1) / 2147483646; };
  }

  // Terrain base fill colors — fully opaque, drawn first so brush strokes merge
  private static readonly TERRAIN_BASE: Record<string, number> = {
    water:  0x14477a,  // deep blue
    lava:   0x661100,  // dark red
    swamp:  0x2a3f1a,  // murky green-brown
    ice:    0x6eaabb,  // cold blue-grey
    sand:   0xa08840,  // warm tan
    bridge: 0x6b4422,  // dark wood brown
    ruins:  0x555566,  // stone grey-purple
  };

  private drawTerrain(bgGraphics: Phaser.GameObjects.Graphics) {
    const terrain = this.mapDef?.terrain;
    if (!terrain || terrain.length === 0) {
      console.log('[Horde] No terrain data to render');
      return;
    }
    console.log('[Horde] Rendering terrain:', terrain.length, 'items');

    // ── PASS 1: Solid base fills on bgGraphics ──
    // All ground/liquid types get opaque fills so brush strokes merge into
    // continuous solid bodies with no gaps.
    for (const t of terrain) {
      const baseColor = HordeScene.TERRAIN_BASE[t.type];
      if (baseColor === undefined) continue;
      bgGraphics.fillStyle(baseColor, 1.0);
      const r = (t.radius || 40) + 3; // +3px to seal gaps between adjacent strokes
      if (t.shape === 'circle') {
        bgGraphics.fillCircle(t.x, t.y, r);
      } else if (t.w && t.h) {
        bgGraphics.fillRect(t.x - t.w / 2 - 2, t.y - t.h / 2 - 2, t.w + 4, t.h + 4);
      }
    }

    // ── PASS 2: Decorative surface details ──
    const dg = this.add.graphics();
    dg.setDepth(1);
    const rng = this.terrainRng(42);

    for (let i = 0; i < terrain.length; i++) {
      const t = terrain[i];
      const cx = t.x, cy = t.y;
      const sz = t.shape === 'circle' ? (t.radius || 40) : Math.max(t.w || 40, t.h || 40) / 2;
      const R = () => rng(); // shorthand

      switch (t.type) {

        // ─── WATER: lighter tint + sparse ripples + foam ─────────
        case 'water': {
          dg.fillStyle(0x1a6699, 0.45);
          dg.fillCircle(cx, cy, sz * 0.8);
          if (i % 5 === 0) {
            dg.lineStyle(2.5, 0x3399dd, 0.4);
            dg.beginPath();
            dg.arc(cx + (R() - 0.5) * sz, cy + (R() - 0.5) * sz, 10 + R() * 16, 0, Math.PI * 0.85);
            dg.strokePath();
          }
          if (i % 7 === 0) {
            dg.fillStyle(0xaaddff, 0.3);
            dg.fillCircle(cx + (R() - 0.5) * sz, cy + (R() - 0.5) * sz, 3 + R() * 5);
          }
          break;
        }

        // ─── LAVA: bright magma layer + glow spots + crust ──────
        case 'lava': {
          dg.fillStyle(0xaa2200, 0.65);
          dg.fillCircle(cx, cy, sz * 0.85);
          if (i % 3 === 0) {
            const lx = cx + (R() - 0.5) * sz * 0.7, ly = cy + (R() - 0.5) * sz * 0.7;
            const gs = 7 + R() * 12;
            dg.fillStyle(0xff5500, 0.6);
            dg.fillCircle(lx, ly, gs * 1.3);
            dg.fillStyle(0xff9900, 0.7);
            dg.fillCircle(lx, ly, gs);
            dg.fillStyle(0xffcc00, 0.5);
            dg.fillCircle(lx, ly, gs * 0.35);
          }
          if (i % 5 === 0) {
            dg.fillStyle(0x331100, 0.45);
            dg.fillCircle(cx + (R() - 0.5) * sz, cy + (R() - 0.5) * sz, 4 + R() * 6);
          }
          break;
        }

        // ─── SWAMP: murky green-brown + bubbles + reeds ─────────
        case 'swamp': {
          dg.fillStyle(0x3a5520, 0.4);
          dg.fillCircle(cx, cy, sz * 0.8);
          // Murky dark patches
          if (i % 3 === 0) {
            dg.fillStyle(0x1a2a10, 0.35);
            dg.fillCircle(cx + (R() - 0.5) * sz * 0.6, cy + (R() - 0.5) * sz * 0.6, 8 + R() * 14);
          }
          // Bubbles
          if (i % 6 === 0) {
            const bx = cx + (R() - 0.5) * sz * 0.7, by = cy + (R() - 0.5) * sz * 0.7;
            dg.fillStyle(0x556633, 0.5);
            dg.fillCircle(bx, by, 3 + R() * 3);
            dg.fillCircle(bx + 5, by - 3, 2 + R() * 2);
          }
          // Reeds
          if (i % 4 === 0) {
            const rx = cx + (R() - 0.5) * sz * 0.8, ry = cy + (R() - 0.5) * sz * 0.8;
            dg.lineStyle(2, 0x4a6630, 0.7);
            dg.beginPath(); dg.moveTo(rx, ry); dg.lineTo(rx - 3, ry - 18 - R() * 10); dg.strokePath();
            dg.beginPath(); dg.moveTo(rx + 4, ry); dg.lineTo(rx + 6, ry - 15 - R() * 8); dg.strokePath();
          }
          break;
        }

        // ─── ICE: frosted surface + cracks + sparkle ────────────
        case 'ice': {
          dg.fillStyle(0x8ad4ee, 0.4);
          dg.fillCircle(cx, cy, sz * 0.82);
          // Frost highlight
          if (i % 4 === 0) {
            dg.fillStyle(0xcceeff, 0.35);
            dg.fillCircle(cx + (R() - 0.5) * sz * 0.5, cy + (R() - 0.5) * sz * 0.5, 6 + R() * 10);
          }
          // Cracks
          if (i % 5 === 0) {
            const sx = cx + (R() - 0.5) * sz * 0.6, sy = cy + (R() - 0.5) * sz * 0.6;
            dg.lineStyle(1.5, 0xddffff, 0.5);
            dg.beginPath(); dg.moveTo(sx, sy);
            dg.lineTo(sx + (R() - 0.5) * 30, sy + (R() - 0.5) * 30);
            dg.lineTo(sx + (R() - 0.5) * 40, sy + (R() - 0.5) * 40);
            dg.strokePath();
          }
          // Sparkle dots
          if (i % 8 === 0) {
            dg.fillStyle(0xffffff, 0.6);
            dg.fillCircle(cx + (R() - 0.5) * sz, cy + (R() - 0.5) * sz, 1.5 + R() * 2);
          }
          break;
        }

        // ─── SAND: warm ground + dune lines + pebbles ───────────
        case 'sand': {
          dg.fillStyle(0xc4a850, 0.35);
          dg.fillCircle(cx, cy, sz * 0.8);
          // Dune ridges
          if (i % 4 === 0) {
            const dx = cx + (R() - 0.5) * sz * 0.5;
            const dy = cy + (R() - 0.5) * sz * 0.5;
            dg.lineStyle(2, 0xd4b866, 0.4);
            dg.beginPath();
            dg.arc(dx, dy, 12 + R() * 20, Math.PI * 0.1, Math.PI * 0.9);
            dg.strokePath();
          }
          // Pebbles / small rocks
          if (i % 6 === 0) {
            dg.fillStyle(0x8a7a50, 0.5);
            dg.fillCircle(cx + (R() - 0.5) * sz * 0.7, cy + (R() - 0.5) * sz * 0.7, 2 + R() * 3);
            dg.fillCircle(cx + (R() - 0.5) * sz * 0.7, cy + (R() - 0.5) * sz * 0.7, 1.5 + R() * 2);
          }
          break;
        }

        // ─── BRIDGE: wood planks ─────────────────────────────────
        case 'bridge': {
          // Lighter wood surface
          dg.fillStyle(0x8a6633, 0.5);
          dg.fillCircle(cx, cy, sz * 0.75);
          // Plank lines
          if (i % 3 === 0) {
            const px = cx + (R() - 0.5) * sz * 0.5;
            const py = cy + (R() - 0.5) * sz * 0.5;
            const angle = R() * Math.PI;
            const len = 15 + R() * 25;
            dg.lineStyle(3, 0x553311, 0.55);
            dg.beginPath();
            dg.moveTo(px - Math.cos(angle) * len, py - Math.sin(angle) * len);
            dg.lineTo(px + Math.cos(angle) * len, py + Math.sin(angle) * len);
            dg.strokePath();
          }
          // Nail dots
          if (i % 5 === 0) {
            dg.fillStyle(0x444444, 0.6);
            dg.fillCircle(cx + (R() - 0.5) * sz * 0.5, cy + (R() - 0.5) * sz * 0.5, 1.5);
            dg.fillCircle(cx + (R() - 0.5) * sz * 0.5, cy + (R() - 0.5) * sz * 0.5, 1.5);
          }
          break;
        }

        // ─── RUINS: stone blocks + broken columns ───────────────
        case 'ruins': {
          dg.fillStyle(0x6666777, 0.4);
          dg.fillCircle(cx, cy, sz * 0.75);
          // Stone blocks
          if (i % 3 === 0) {
            const bx = cx + (R() - 0.5) * sz * 0.6, by = cy + (R() - 0.5) * sz * 0.6;
            const bw = 8 + R() * 14, bh = 6 + R() * 10;
            dg.fillStyle(0x777788, 0.7);
            dg.fillRect(bx - bw / 2, by - bh / 2, bw, bh);
            dg.lineStyle(1, 0x555566, 0.5);
            dg.strokeRect(bx - bw / 2, by - bh / 2, bw, bh);
          }
          // Broken column
          if (i % 8 === 0) {
            const cx2 = cx + (R() - 0.5) * sz * 0.5, cy2 = cy + (R() - 0.5) * sz * 0.5;
            dg.fillStyle(0x888899, 0.75);
            dg.fillCircle(cx2, cy2, 5 + R() * 4);
            dg.fillStyle(0x999aaa, 0.6);
            dg.fillCircle(cx2, cy2 - 4, 3 + R() * 3);
          }
          break;
        }

        // ─── FOREST: trees with trunks + canopies ───────────────
        case 'forest': {
          const n = Math.max(1, Math.floor(sz / 16));
          for (let j = 0; j < n; j++) {
            const a = R() * Math.PI * 2, d = R() * sz * 0.75;
            const tx = cx + Math.cos(a) * d, ty = cy + Math.sin(a) * d;
            const h = 16 + R() * 22;
            dg.fillStyle(0x3d2b1a, 0.95);
            dg.fillRect(tx - 3, ty, 6, h * 0.5);
            const shade = R() > 0.5 ? 0x2d8a3a : 0x1d6a2a;
            dg.fillStyle(shade, 0.92);
            dg.fillCircle(tx, ty - h * 0.2, h * 0.7);
            dg.fillStyle(0x238a30, 0.85);
            dg.fillCircle(tx - h * 0.3, ty, h * 0.55);
            dg.fillCircle(tx + h * 0.3, ty, h * 0.55);
            dg.fillStyle(0x44bb55, 0.45);
            dg.fillCircle(tx - h * 0.12, ty - h * 0.3, h * 0.25);
          }
          break;
        }

        // ─── BUSH: thick puff clusters + berries ────────────────
        case 'bush': {
          const n = Math.max(1, Math.floor(sz / 18));
          for (let j = 0; j < n; j++) {
            const a = R() * Math.PI * 2, d = R() * sz * 0.7;
            const bx = cx + Math.cos(a) * d, by = cy + Math.sin(a) * d;
            const r = 8 + R() * 12;
            const shade = R() > 0.4 ? 0x4a9a3a : 0x3a8a2a;
            dg.fillStyle(shade, 0.9);
            dg.fillCircle(bx, by, r);
            dg.fillCircle(bx - r * 0.7, by + r * 0.3, r * 0.8);
            dg.fillCircle(bx + r * 0.7, by + r * 0.3, r * 0.8);
            dg.fillCircle(bx, by - r * 0.5, r * 0.7);
            if (R() > 0.5) {
              dg.fillStyle(0xcc3355, 0.85);
              dg.fillCircle(bx + R() * 6 - 3, by + R() * 6 - 3, 2.5);
              dg.fillCircle(bx + R() * 6 - 3, by + R() * 6 - 3, 2);
            }
          }
          break;
        }

        // ─── MOUNTAIN: rock peaks + snow caps + rubble ──────────
        case 'mountain': {
          const n = Math.max(1, Math.floor(sz / 20));
          for (let j = 0; j < n; j++) {
            const a = R() * Math.PI * 2, d = R() * sz * 0.6;
            const rx = cx + Math.cos(a) * d, ry = cy + Math.sin(a) * d;
            const h = 22 + R() * 30;
            const w = h * (0.55 + R() * 0.35);
            dg.fillStyle(0x7a7a7a, 0.95);
            dg.fillTriangle(rx, ry - h, rx - w, ry + h * 0.25, rx + w, ry + h * 0.25);
            dg.fillStyle(0x555555, 0.7);
            dg.fillTriangle(rx, ry - h, rx + w, ry + h * 0.25, rx + w * 0.2, ry + h * 0.25);
            if (h > 28) {
              dg.fillStyle(0xeaeaea, 0.85);
              dg.fillTriangle(rx, ry - h, rx - w * 0.3, ry - h * 0.4, rx + w * 0.3, ry - h * 0.4);
            }
            dg.fillStyle(0x6a6a6a, 0.75);
            dg.fillCircle(rx - w * 0.6, ry + h * 0.2, 4 + R() * 5);
            dg.fillCircle(rx + w * 0.7, ry + h * 0.15, 3 + R() * 5);
          }
          break;
        }
      }
    }
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
    if (this.fogDisabled) {
      this.fogRT.setVisible(false);
      return;
    }
    this.fogRT.setVisible(true);

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
      const visible = this.fogDisabled || this.isInVision(u.x, u.y);
      if (u.sprite) u.sprite.setVisible(visible);
      if (u.carrySprite) u.carrySprite.setVisible(visible);
    }

    // Hide/show ground items outside vision
    for (const item of this.groundItems) {
      if (item.dead || !item.sprite) continue;
      item.sprite.setVisible(this.fogDisabled || this.isInVision(item.x, item.y));
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
    // Owned camps grant vision
    for (const c of this.camps) {
      if (c.owner === this.myTeam) this.visionSources.push(c);
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
        lastAttackTarget: -1, attackFaceX: null, pathWaypoints: null, pathAge: 0, pathTargetX: 0, pathTargetY: 0, mods: { ...DEFAULT_MODS },
        carrying: null, carrySprite: null, loop: null, isElite: false, idleTimer: 0, claimItemId: -1,
        equipment: null, equipSprite: null,
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
    if (this.mapDef?.armorySlots && this.mapDef.armorySlots.length > 0) {
      for (const slot of this.mapDef.armorySlots) {
        this.armories.push({ x: slot.bluePos.x, y: slot.bluePos.y, team: 1, sprite: null, label: null });
        this.armories.push({ x: slot.redPos.x, y: slot.redPos.y, team: 2, sprite: null, label: null });
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
    this.sfx.playGlobal('wave_start');
    this.showFeedback(`Era ${ne}: Tier ${nm}!`, '#45E6B0');
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
        hasRebirth: false, diveReady: false, diveTimer: 0, lastAttackTarget: -1, attackFaceX: null, pathWaypoints: null, pathAge: 0, pathTargetX: 0, pathTargetY: 0, mods: { ...DEFAULT_MODS },
        carrying: null, carrySprite: null, loop: null, isElite: false, idleTimer: 0, claimItemId: -1,
        equipment: null, equipSprite: null,
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
        hasRebirth: false, diveReady: false, diveTimer: 0, lastAttackTarget: -1, attackFaceX: null, pathWaypoints: null, pathAge: 0, pathTargetX: 0, pathTargetY: 0, mods: { ...DEFAULT_MODS },
        carrying: null, carrySprite: null, loop: null, isElite: true, idleTimer: 0, claimItemId: -1,
        equipment: null, equipSprite: null,
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

    // Left panel — HTML Command Console overlay
    {
      const container = document.getElementById('game-container') ?? document.body;
      const sidebar = document.createElement('div');
      sidebar.id = 'horde-sidebar';
      sidebar.style.cssText = `
        position:absolute;top:0;left:0;width:220px;height:100%;
        background:rgba(10,14,25,0.85);
        backdrop-filter:blur(8px);-webkit-backdrop-filter:blur(8px);
        border-right:1px solid rgba(69,230,176,0.2);
        z-index:101;overflow-y:auto;padding:12px;
        font-family:'Nunito',sans-serif;
        scrollbar-width:thin;
        scrollbar-color:rgba(69,230,176,0.35) rgba(10,14,25,0.4);
      `;
      sidebar.innerHTML = `
        <div id="hud-header" style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px;">
          <span style="font-size:16px;font-weight:800;color:#45E6B0;font-family:'Fredoka',sans-serif;letter-spacing:2px;">HORDE</span>
          <span id="hud-timer" style="font-size:13px;font-weight:700;color:#FFD93D;font-family:'Fredoka',sans-serif;">0:00</span>
        </div>
        <div id="hud-era" style="font-size:10px;color:#8BAA8B;text-align:center;margin-bottom:12px;letter-spacing:1px;"></div>

        <div style="margin-bottom:14px;">
          <div style="display:flex;justify-content:space-between;font-size:10px;font-weight:700;margin-bottom:4px;">
            <span style="color:#45E6B0;">YOUR BASE</span>
            <span id="hud-nexus-mine" style="color:#45E6B0;">50000</span>
          </div>
          <div style="height:8px;background:rgba(255,255,255,0.08);border-radius:4px;overflow:hidden;margin-bottom:6px;">
            <div id="hud-nexus-mine-bar" style="height:100%;width:100%;background:linear-gradient(90deg,#45E6B0,#2ECFA0);border-radius:4px;transition:width 0.5s ease;"></div>
          </div>
          <div style="display:flex;justify-content:space-between;font-size:10px;font-weight:700;margin-bottom:4px;">
            <span style="color:#FF5555;">ENEMY BASE</span>
            <span id="hud-nexus-enemy" style="color:#FF5555;">50000</span>
          </div>
          <div style="height:8px;background:rgba(255,255,255,0.08);border-radius:4px;overflow:hidden;">
            <div id="hud-nexus-enemy-bar" style="height:100%;width:100%;background:linear-gradient(90deg,#FF5555,#CC3333);border-radius:4px;transition:width 0.5s ease;"></div>
          </div>
        </div>

        <div style="margin-bottom:14px;">
          <div style="font-size:11px;font-weight:800;color:#45E6B0;letter-spacing:1.5px;margin-bottom:6px;font-family:'Fredoka',sans-serif;">RESOURCES</div>
          <div id="hud-resources"></div>
        </div>

        <div style="margin-bottom:14px;">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;">
            <span style="font-size:11px;font-weight:800;color:#4499FF;letter-spacing:1.5px;font-family:'Fredoka',sans-serif;">ARMY</span>
            <span id="hud-army-total" style="font-size:11px;font-weight:700;color:#4499FF;"></span>
          </div>
          <div id="hud-army-list"></div>
        </div>

        <div style="margin-bottom:14px;">
          <div style="font-size:11px;font-weight:800;color:#C98FFF;letter-spacing:1.5px;margin-bottom:6px;font-family:'Fredoka',sans-serif;">PRODUCTION</div>
          <div id="hud-production"></div>
        </div>

        <div style="margin-bottom:14px;">
          <div style="font-size:11px;font-weight:800;color:#FFD93D;letter-spacing:1.5px;margin-bottom:6px;font-family:'Fredoka',sans-serif;">CAMPS</div>
          <div id="hud-camps"></div>
        </div>

        <div style="margin-bottom:14px;">
          <div style="font-size:11px;font-weight:800;color:#FF6B6B;letter-spacing:1.5px;margin-bottom:6px;font-family:'Fredoka',sans-serif;">MODIFIERS</div>
          <div id="hud-modifiers" style="display:flex;flex-wrap:wrap;gap:4px;"></div>
        </div>

        <div id="hud-buffs"></div>
      `;
      container.appendChild(sidebar);
      this.sidebarEl = sidebar;
    }

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

    // Equipment panel toggle
    const equipToggle = document.createElement('button');
    equipToggle.id = 'horde-equip-toggle';
    equipToggle.textContent = '🏛️';
    equipToggle.style.cssText = `
      position:absolute;top:10px;right:310px;width:36px;height:36px;
      z-index:100;border:1px solid #3D5040;border-radius:8px;
      background:rgba(13,26,13,0.88);color:#FFD700;font-size:18px;
      cursor:pointer;display:flex;align-items:center;justify-content:center;
      font-family:'Nunito',sans-serif;padding:0;
    `;
    equipToggle.addEventListener('click', () => {
      if (this.equipPanelEl) {
        const vis = this.equipPanelEl.style.display === 'none';
        this.equipPanelEl.style.display = vis ? 'block' : 'none';
      }
    });
    document.getElementById('game-container')!.appendChild(equipToggle);

    const equipPanel = document.createElement('div');
    equipPanel.id = 'horde-equip-panel';
    equipPanel.style.cssText = `
      position:absolute;top:10px;right:490px;width:220px;max-height:calc(100vh - 20px);
      overflow-y:auto;z-index:98;
      background:rgba(13,26,13,0.88);border:1px solid #3D5040;border-radius:12px;
      padding:10px;font-family:'Nunito',sans-serif;display:none;
      scrollbar-width:thin;scrollbar-color:rgba(69,230,176,0.35) rgba(13,26,13,0.4);
    `;
    document.getElementById('game-container')!.appendChild(equipPanel);
    this.equipPanelEl = equipPanel;

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
    const mineLabels: Record<string, string> = {
      gnome: '2.0x', turtle: '1.5x', rogue: '1.0x', skull: '0.8x', gnoll: '0.8x',
      lizard: '0.7x', spider: '0.6x', panda: '0.5x', shaman: '0.5x', minotaur: '0.4x', troll: '0.3x',
    };
    const counterEmojis: Record<string, string> = {
      gnome: '\u{1F9DD}', turtle: '\u{1F422}', skull: '\u{1F480}', spider: '\u{1F577}\uFE0F',
      gnoll: '\u{1F43A}', panda: '\u{1F43C}', lizard: '\u{1F98E}', minotaur: '\u{1F402}',
      shaman: '\u{1F52E}', troll: '\u{1F479}', rogue: '\u{1F5E1}\uFE0F',
    };
    const roleMap: Record<string, string> = {
      gnome: 'Gatherer', turtle: 'Tank / Hauler', skull: 'Bruiser', spider: 'Assassin',
      gnoll: 'Ranged DPS', rogue: 'Assassin', panda: 'Tank', lizard: 'Executioner',
      minotaur: 'Commander', shaman: 'Mage', troll: 'Juggernaut',
    };
    const specialNotes: Record<string, string[]> = {
      gnome: ['2x pickup range'],
      turtle: ['Carries 10x resources per trip', 'Taunts foes within 100px'],
      rogue: ['Invisible to neutral enemies', 'Hops over terrain'],
    };
    const unitData = [
      { key: 'gnome',    emoji: '\u{1F9DD}',       name: 'Gnome',    hp: 15,    atk: 3,   spd: 210, tier: 1, ability: 'Nimble Hands', desc: '2x pickup range, fastest gatherer', cost: '2\u{1F955}' },
      { key: 'turtle',   emoji: '\u{1F422}',       name: 'Turtle',   hp: 65,    atk: 3,   spd: 55,  tier: 1, ability: 'Shell Stance', desc: '60% DR when stationary + taunts nearby foes', cost: '5\u{1F955}' },
      { key: 'skull',    emoji: '\u{1F480}',       name: 'Skull',    hp: 80,    atk: 14,  spd: 155, tier: 2, ability: 'Undying',      desc: 'Cheats death once (survives at 1 HP)', cost: '5\u{1F356}' },
      { key: 'spider',   emoji: '\u{1F577}\uFE0F', name: 'Spider',   hp: 120,   atk: 18,  spd: 85,  tier: 2, ability: 'Venom Bite',   desc: '+5% target max HP per hit', cost: '5\u{1F356}' },
      { key: 'gnoll',    emoji: '\u{1F43A}',       name: 'Gnoll',    hp: 55,    atk: 28,  spd: 175, tier: 2, ability: 'Bone Toss',    desc: 'Extended range (120 vs 80)', cost: '5\u{1F356}' },
      { key: 'rogue',    emoji: '\u{1F5E1}\uFE0F', name: 'Rogue',    hp: 60,    atk: 45,  spd: 200, tier: 2, ability: 'Backstab',     desc: '3x first hit + invisible to neutrals', cost: '5\u{1F356}' },
      { key: 'panda',    emoji: '\u{1F43C}',       name: 'Panda',    hp: 900,   atk: 35,  spd: 80,  tier: 3, ability: 'Thick Hide',   desc: 'Regenerates 1% max HP/sec', cost: '8\u{1F356}' },
      { key: 'lizard',   emoji: '\u{1F98E}',       name: 'Lizard',   hp: 450,   atk: 70,  spd: 110, tier: 3, ability: 'Cold Blood',   desc: '3x dmg to targets below 40% HP', cost: '8\u{1F955}' },
      { key: 'minotaur', emoji: '\u{1F402}',       name: 'Minotaur', hp: 2200,  atk: 110, spd: 120, tier: 4, ability: 'War Cry',      desc: 'Nearby allies +25% attack', cost: '12\u{1F48E}' },
      { key: 'shaman',   emoji: '\u{1F52E}',       name: 'Shaman',   hp: 1400,  atk: 180, spd: 100, tier: 4, ability: 'Arcane Blast', desc: 'All attacks splash 60px', cost: '12\u{1F48E}' },
      { key: 'troll',    emoji: '\u{1F479}',       name: 'Troll',    hp: 14000, atk: 350, spd: 50,  tier: 5, ability: 'Club Slam',    desc: 'Massive 90px splash, slows enemies', cost: '20\u{1F48E}' },
    ];

    let panelHTML = `<div style="font-size:12px;color:#45E6B0;font-weight:800;letter-spacing:1.5px;margin-bottom:8px;text-align:center;">BESTIARY</div>`;
    for (const u of unitData) {
      const tc = tierColors[u.tier];
      const counters = HARD_COUNTERS[u.key] || [];
      const counterStr = counters.length > 0
        ? counters.map(c => (counterEmojis[c] || c)).join(' ')
        : '<span style="color:#555;">none</span>';
      const role = roleMap[u.key] || '';
      const mine = mineLabels[u.key] || '1.0x';
      const notes = specialNotes[u.key] || [];
      const notesHTML = notes.map(n => `<div style="font-size:8px;color:#45E6B0;margin-top:1px;">\u2605 ${n}</div>`).join('');
      panelHTML += `
        <div style="background:rgba(30,50,30,0.6);border:1px solid #3D5040;border-radius:8px;padding:7px 8px;margin-bottom:6px;">
          <div style="display:flex;align-items:center;gap:6px;margin-bottom:2px;">
            <span style="font-size:18px;">${u.emoji}</span>
            <span style="font-size:12px;font-weight:800;color:#f0e8ff;">${u.name}</span>
            <span style="font-size:9px;color:#8BAA8B;font-weight:600;">${role}</span>
            <span style="font-size:9px;font-weight:700;color:${tc};background:rgba(0,0,0,0.4);padding:1px 5px;border-radius:4px;margin-left:auto;">T${u.tier}</span>
          </div>
          <div style="display:flex;gap:6px;font-size:10px;color:#8BAA8B;margin-bottom:2px;flex-wrap:wrap;">
            <span>\u2764\uFE0F ${u.hp}</span>
            <span>\u2694\uFE0F ${u.atk}</span>
            <span>\u{1F3C3} ${u.spd}</span>
            <span>\u26CF\uFE0F ${mine}</span>
            <span style="margin-left:auto;color:#FFD93D;">${u.cost}</span>
          </div>
          <div style="font-size:10px;color:#C98FFF;font-weight:700;margin-bottom:1px;">${u.ability}</div>
          <div style="font-size:9px;color:#8BAA8B;font-style:italic;margin-bottom:2px;">${u.desc}</div>
          <div style="display:flex;gap:4px;align-items:center;font-size:9px;">
            <span style="color:#666;">Strong vs:</span> <span style="color:#FF7777;">${counterStr}</span>
          </div>${notesHTML}
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

    // Timer + Era
    const secs = Math.floor(this.gameTime / 1000);
    const eraName = HordeScene.ERA_NAMES[this.currentEra] || '';
    const timerEl = document.getElementById('hud-timer');
    if (timerEl) timerEl.textContent = Math.floor(secs / 60) + ':' + (secs % 60).toString().padStart(2, '0');
    const eraEl = document.getElementById('hud-era');
    if (eraEl) eraEl.textContent = `Era ${this.currentEra}: ${eraName}`;

    // Nexus HP bars
    const maxNexus = 50000;
    const myNexus = this.nexuses.find(n => n.team === myT);
    const enemyNexus = this.nexuses.find(n => n.team === enemyT);
    const myHp = myNexus ? myNexus.hp : maxNexus;
    const enemyHp = enemyNexus ? enemyNexus.hp : maxNexus;
    const mineHpEl = document.getElementById('hud-nexus-mine');
    const mineBarEl = document.getElementById('hud-nexus-mine-bar');
    const enemyHpEl = document.getElementById('hud-nexus-enemy');
    const enemyBarEl = document.getElementById('hud-nexus-enemy-bar');
    if (mineHpEl) mineHpEl.textContent = String(Math.ceil(myHp));
    if (mineBarEl) mineBarEl.style.width = `${(myHp / maxNexus) * 100}%`;
    if (enemyHpEl) enemyHpEl.textContent = String(Math.ceil(enemyHp));
    if (enemyBarEl) enemyBarEl.style.width = `${(enemyHp / maxNexus) * 100}%`;

    // Resources
    const stock = this.baseStockpile[myT as 1 | 2];
    const resEl = document.getElementById('hud-resources');
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
        html += `<div style="display:flex;align-items:center;gap:6px;margin-bottom:5px;">
          <span style="font-size:14px;">${r.emoji}</span>
          <div style="flex:1;">
            <div style="display:flex;justify-content:space-between;font-size:10px;font-weight:700;">
              <span style="color:#ccc;">${r.name}</span>
              <span style="color:${r.color};">${r.amount}</span>
            </div>
            <div style="height:4px;background:rgba(255,255,255,0.08);border-radius:2px;overflow:hidden;margin-top:2px;">
              <div style="height:100%;width:${pct}%;background:${r.gradient};border-radius:2px;transition:width 0.3s ease;"></div>
            </div>
          </div>
        </div>`;
      }
      resEl.innerHTML = html;
    }

    // Army
    const tierColors: Record<number, string> = { 1: '#44CC44', 2: '#4499FF', 3: '#FF9933', 4: '#FF4444', 5: '#FFD700' };
    const totalEl = document.getElementById('hud-army-total');
    if (totalEl) totalEl.textContent = `${p1.length} units`;
    const armyEl = document.getElementById('hud-army-list');
    if (armyEl) {
      let html = '';
      for (const [type, def] of Object.entries(ANIMALS)) {
        const count = p1c[type] || 0;
        if (count === 0) continue;
        const tc = tierColors[def.tier] || '#aaa';
        html += `<div style="display:flex;align-items:center;gap:5px;padding:3px 6px;margin-bottom:3px;background:rgba(255,255,255,0.04);border-radius:6px;border-left:3px solid ${tc};">
          <span style="font-size:14px;">${def.emoji}</span>
          <span style="font-size:10px;font-weight:700;color:#f0e8ff;flex:1;">${cap(type)}</span>
          <span style="font-size:12px;font-weight:800;color:${tc};">${count}</span>
        </div>`;
      }
      if (!html) html = '<div style="font-size:10px;color:#555;padding:4px;">No units yet</div>';
      armyEl.innerHTML = html;
    }

    // Production
    const prodEl = document.getElementById('hud-production');
    if (prodEl) {
      let html = '';
      const gnomeCountdown = Math.max(0, Math.ceil((FREE_GNOME_MS - this.freeGnomeTimer) / 1000));
      html += `<div style="display:flex;align-items:center;gap:5px;padding:3px 6px;margin-bottom:3px;background:rgba(255,255,255,0.04);border-radius:6px;">
        <span style="font-size:12px;">\u{1F9DD}</span>
        <span style="font-size:10px;color:#8BAA8B;flex:1;">Free gnome</span>
        <span style="font-size:10px;font-weight:700;color:#45E6B0;">${gnomeCountdown}s</span>
      </div>`;
      const myCamps = this.camps.filter(c => c.owner === myT);
      for (const c of myCamps) {
        const cost = SPAWN_COSTS[c.animalType];
        if (!cost) continue;
        const emoji = ANIMALS[c.animalType]?.emoji || '';
        const tc = tierColors[ANIMALS[c.animalType]?.tier] || '#aaa';
        html += `<div style="display:flex;align-items:center;gap:5px;padding:3px 6px;margin-bottom:3px;background:rgba(255,255,255,0.04);border-radius:6px;border-left:3px solid ${tc};">
          <span style="font-size:12px;">${emoji}</span>
          <span style="font-size:10px;color:#ccc;flex:1;">${cap(c.animalType)}</span>
          <span style="font-size:10px;color:#8BAA8B;">${c.storedFood}/${cost.amount}${RESOURCE_EMOJI[cost.type]}</span>
        </div>`;
      }
      if (myCamps.length === 0) html += '<div style="font-size:10px;color:#555;padding:4px;">No camps owned</div>';
      prodEl.innerHTML = html;
    }

    // ─── EQUIPMENT PANEL ───
    if (this.equipPanelEl) {
      const unlocked = this.unlockedEquipment[myT as 1 | 2];
      const stock = this.baseStockpile[myT as 1 | 2];
      let eqHTML = `<div style="font-size:12px;color:#FFD700;font-weight:800;letter-spacing:1.5px;margin-bottom:8px;text-align:center;">ARMORY</div>`;
      for (const eq of EQUIPMENT) {
        const owned = unlocked.has(eq.id);
        const costStr = Object.entries(eq.cost).map(([r, a]) => `${a}${RESOURCE_EMOJI[r as ResourceType]}`).join('+');
        const canAfford = Object.entries(eq.cost).every(([r, a]) => (stock[r as ResourceType] || 0) >= a!);
        const borderColor = owned ? '#45E6B0' : canAfford ? '#FFD700' : '#555';
        const equipped = this.units.filter(u => u.team === myT && !u.dead && u.equipment === eq.id).length;
        eqHTML += `
          <div style="background:rgba(30,50,30,0.6);border:1px solid ${borderColor};border-radius:8px;padding:7px 8px;margin-bottom:6px;">
            <div style="display:flex;align-items:center;gap:6px;margin-bottom:3px;">
              <span style="font-size:18px;">${eq.emoji}</span>
              <span style="font-size:12px;font-weight:800;color:#f0e8ff;">${eq.name}</span>
              ${owned ? '<span style="font-size:10px;color:#45E6B0;margin-left:auto;">UNLOCKED</span>' : `<span style="font-size:10px;color:${canAfford ? '#FFD700' : '#FF6B6B'};margin-left:auto;">${costStr}</span>`}
            </div>
            <div style="font-size:9px;color:#8BAA8B;font-style:italic;">${eq.effect}</div>
            ${owned && equipped > 0 ? `<div style="font-size:9px;color:#45E6B0;margin-top:2px;">${equipped} unit${equipped > 1 ? 's' : ''} equipped</div>` : ''}
            ${owned ? `<div style="font-size:9px;color:#8BAA8B;margin-top:2px;">Say: "get a ${eq.name.toLowerCase()} then go..."</div>` : ''}
          </div>`;
      }
      this.equipPanelEl.innerHTML = eqHTML;
    }

    // Camps
    const campsEl = document.getElementById('hud-camps');
    if (campsEl) {
      const yourCamps = this.camps.filter(c => c.owner === myT).length;
      const enemyCampsN = this.camps.filter(c => c.owner === enemyT).length;
      const neutralCamps = this.camps.filter(c => c.owner === 0).length;
      let html = `<div style="display:flex;gap:10px;font-size:10px;font-weight:700;margin-bottom:6px;">
        <span style="color:#45E6B0;">\u{1F535} ${yourCamps}</span>
        <span style="color:#FF5555;">\u{1F534} ${enemyCampsN}</span>
        <span style="color:#888;">\u26AA ${neutralCamps}</span>
      </div>`;
      for (const c of this.camps) {
        const color = c.owner === 0 ? '#666' : c.owner === myT ? '#45E6B0' : '#FF5555';
        const dot = c.owner === 0 ? '\u26AA' : c.owner === myT ? '\u{1F535}' : '\u{1F534}';
        const emoji = ANIMALS[c.animalType]?.emoji || '';
        html += `<div style="font-size:9px;color:${color};padding:1px 0;">${dot} ${emoji} ${c.name}</div>`;
      }
      campsEl.innerHTML = html;
    }

    // Modifiers
    const modsEl = document.getElementById('hud-modifiers');
    if (modsEl) {
      const modColors: Record<string, { bg: string; fg: string }> = {
        spread: { bg: 'rgba(69,153,255,0.2)', fg: '#4499FF' },
        tight: { bg: 'rgba(255,153,51,0.2)', fg: '#FF9933' },
        safe: { bg: 'rgba(68,204,68,0.2)', fg: '#44CC44' },
        aggressive: { bg: 'rgba(255,85,85,0.2)', fg: '#FF5555' },
        rush: { bg: 'rgba(255,217,61,0.2)', fg: '#FFD93D' },
        efficient: { bg: 'rgba(201,143,255,0.2)', fg: '#C98FFF' },
      };
      let html = '';
      const activeMods = new Set<string>();
      for (const [key, m] of Object.entries(this.groupModifiers)) {
        if (!key.endsWith(`_${myT}`)) continue;
        const bm = m as BehaviorMods;
        if (bm.formation && bm.formation !== 'normal') activeMods.add(bm.formation);
        if (bm.caution && bm.caution !== 'normal') activeMods.add(bm.caution);
        if (bm.pacing && bm.pacing !== 'normal') activeMods.add(bm.pacing);
      }
      for (const mod of activeMods) {
        const mc = modColors[mod] || { bg: 'rgba(255,255,255,0.1)', fg: '#aaa' };
        html += `<span style="font-size:9px;font-weight:700;padding:2px 8px;border-radius:10px;background:${mc.bg};color:${mc.fg};text-transform:uppercase;">${mod}</span>`;
      }
      if (!html) html = '<span style="font-size:9px;color:#555;">None active</span>';
      modsEl.innerHTML = html;
    }

    // Buffs
    const buffsEl = document.getElementById('hud-buffs');
    if (buffsEl) {
      const b = this.getBuffs(myT as 1 | 2);
      let html = '';
      if (b.speed > 0) html += `<div style="font-size:10px;color:#FFD93D;font-weight:700;">\u26A1 Speed +${Math.round(b.speed * 100)}%</div>`;
      if (b.attack > 0) html += `<div style="font-size:10px;color:#FF5555;font-weight:700;">\u2694\uFE0F Attack +${Math.round(b.attack * 100)}%</div>`;
      if (b.hp > 0) html += `<div style="font-size:10px;color:#45E6B0;font-weight:700;">\u2764\uFE0F HP +${Math.round(b.hp * 100)}%</div>`;
      buffsEl.innerHTML = html;
    }

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

    if (this.editorMode) {
      // Editor mode: render only, no simulation
      this.updateUnitSprites();
      this.updateCampVisuals();
      this.updateMineVisuals();
      this.updateArmoryVisuals();
      this.drawNexusBars();
      return;
    }

    if (this.isOnline && !this.isHost) {
      // Guest: only render, no simulation — state comes from host via sync
      this.updateUnitSprites();
      this.updateCampVisuals();
      this.updateMineVisuals();
      this.updateArmoryVisuals();
      this.drawNexusBars();
      this.updateFog();
      this.updateFogVisibility();
      this.updateHUD();
      this.updateThoughtBubbles(delta);
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
    this.processPendingHits(delta);
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
    this.updateArmoryVisuals();
    this.drawNexusBars();
    this.updateFog();
    this.updateFogVisibility();
    this.updateHUD();
    this.updateThoughtBubbles(delta);
    this.checkWin();

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
      this.spawnUnit('gnome', team, b.x + (team === 1 ? 60 : -60), b.y + (team === 1 ? -30 : 30));
    }
  }

  /** Unlock an equipment type for a team — deducts resources from base stockpile */
  private unlockEquipment(team: 1 | 2, eqType: EquipmentType): boolean {
    const def = EQUIPMENT.find(e => e.id === eqType);
    if (!def) return false;
    if (this.unlockedEquipment[team].has(eqType)) return false;

    const stock = this.baseStockpile[team];
    for (const [res, amt] of Object.entries(def.cost)) {
      if ((stock[res as ResourceType] || 0) < amt!) return false;
    }
    for (const [res, amt] of Object.entries(def.cost)) {
      stock[res as ResourceType] -= amt!;
    }

    this.unlockedEquipment[team].add(eqType);
    this.sfx.playGlobal('armory_equip');
    return true;
  }

  private getUnitEquipBuffs(u: HUnit) {
    let speed = 0, attack = 0, hp = 0, damageTaken = 1, atkSpeedMult = 1, pickupRange = 1, gatherSpeed = 1;
    if (!u.equipment) return { speed, attack, hp, damageTaken, atkSpeedMult, pickupRange, gatherSpeed };
    switch (u.equipment) {
      case 'pickaxe': gatherSpeed = 1.25; break;
      case 'sword': attack = 0.50; atkSpeedMult = 0.75; break;
      case 'shield': hp = 0.60; damageTaken = 0.75; speed = -0.15; break;
      case 'boots': speed = 0.60; pickupRange = 1.5; break;
      case 'banner': break;
    }
    return { speed, attack, hp, damageTaken, atkSpeedMult, pickupRange, gatherSpeed };
  }

  private getBannerAura(u: HUnit): { attack: number; speed: number } {
    if (u.team === 0) return { attack: 0, speed: 0 };
    const BANNER_RANGE = 120;
    for (const ally of this.units) {
      if (ally === u || ally.dead || ally.team !== u.team || ally.equipment !== 'banner') continue;
      if (pdist(u, ally) <= BANNER_RANGE) return { attack: 0.20, speed: 0.15 };
    }
    return { attack: 0, speed: 0 };
  }

  private updateArmoryVisuals() {
    for (const arm of this.armories) {
      const eqDef = EQUIPMENT.find(e => e.id === arm.equipmentType);
      const emoji = eqDef?.emoji || '🏛️';
      const name = eqDef?.name || 'Armory';
      if (!arm.sprite) {
        arm.sprite = this.add.text(arm.x, arm.y, emoji, { fontSize: '36px' }).setOrigin(0.5).setDepth(14);
        arm.label = this.add.text(arm.x, arm.y + 28, name, {
          fontSize: '11px', color: arm.team === 1 ? '#4499FF' : '#FF5555',
          stroke: '#000', strokeThickness: 2,
        }).setOrigin(0.5).setDepth(14);
      }
      const unlocked = this.unlockedEquipment[arm.team].has(arm.equipmentType);
      if (arm.label) {
        arm.label.setText(unlocked ? `${name} ✅` : `${name} 🔒`);
        arm.label.setColor(unlocked ? (arm.team === 1 ? '#4499FF' : '#FF5555') : '#666666');
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
    for (const u of this.units) {
      if (u.dead) continue;

      let dx = u.targetX - u.x, dy = u.targetY - u.y;
      const d = Math.sqrt(dx * dx + dy * dy);
      if (d < 5) { u.pathWaypoints = null; continue; }

      // Tick pathAge for all units
      u.pathAge += dt * 1000;

      // ─── A* PATHFINDING for safe non-combat units ───
      if (u.team !== 0 && this.isNonCombatStep(u) && u.mods.caution !== 'aggressive') {
        const astarTeam = u.team as 1 | 2;
        const astarAvoid = u.mods.caution === 'safe' ? 360 : 200;

        // Check if path needs recomputation
        const targetMoved = Math.abs(u.pathTargetX - u.targetX) > 48 || Math.abs(u.pathTargetY - u.targetY) > 48;
        const pathStale = u.pathAge > 1200;
        const needsPath = u.pathWaypoints === null || targetMoved || pathStale;

        if (needsPath) {
          // Quick threat check — only compute A* if threats are actually nearby on our route
          let threatOnRoute = false;
          for (const o of this.units) {
            if (o.dead || o.team === astarTeam) continue;
            if (o.team === 0 && o.campId === null) continue;
            const dist2 = (u.x - o.x) ** 2 + (u.y - o.y) ** 2;
            if (dist2 < astarAvoid * astarAvoid) { threatOnRoute = true; break; }
          }
          if (!threatOnRoute) {
            for (const c of this.camps) {
              if (c.owner === astarTeam) continue;
              const hasD = this.units.some(g => g.campId === c.id && g.team === 0 && !g.dead);
              if (!hasD && c.owner === 0) continue;
              const dist2 = (u.x - c.x) ** 2 + (u.y - c.y) ** 2;
              if (dist2 < (astarAvoid * 1.5) ** 2) { threatOnRoute = true; break; }
            }
          }

          if (threatOnRoute) {
            u.pathWaypoints = this.computeSafePath(u);
            u.pathAge = 0;
            u.pathTargetX = u.targetX;
            u.pathTargetY = u.targetY;
          } else {
            u.pathWaypoints = null;
          }
        }

        // Follow A* waypoints if we have them
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
          continue;
        }
        // A* returned null (no path) — fall through to force-based avoidance below
      }

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

  // ─── A* SAFE PATHFINDING ────────────────────────────────────
  private static readonly PATH_CELL = 64;
  private static readonly PATH_GRID = 50; // 3200 / 64

  /** Compute an A* path around threats for safe-caution units */
  private computeSafePath(u: HUnit): {x: number; y: number}[] | null {
    const CELL = HordeScene.PATH_CELL;
    const G = HordeScene.PATH_GRID;
    const team = u.team as 1 | 2;
    const avoidRange = u.mods.caution === 'safe' ? 180 : 100;

    // 1. Build blocked grid
    const blocked = new Uint8Array(G * G);

    // Mark cells near enemy units
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
          if ((cx - o.x) ** 2 + (cy - o.y) ** 2 < avoidRange * avoidRange) {
            blocked[gy * G + gx] = 1;
          }
        }
      }
    }

    // Mark cells near hostile camps
    const targetAnimal = u.loop ? this.getBootstrapAnimal(u.loop) : undefined;
    const campRange = avoidRange * 1.5;
    for (const c of this.camps) {
      if (c.owner === team) continue;
      if (targetAnimal && c.animalType === targetAnimal) continue;
      const hasDefenders = this.units.some(g => g.campId === c.id && g.team === 0 && !g.dead);
      if (!hasDefenders && c.owner === 0) continue;
      const ccx = Math.floor(c.x / CELL);
      const ccy = Math.floor(c.y / CELL);
      const r = Math.ceil(campRange / CELL);
      for (let dy = -r; dy <= r; dy++) {
        for (let dx = -r; dx <= r; dx++) {
          const gx = ccx + dx, gy = ccy + dy;
          if (gx < 0 || gx >= G || gy < 0 || gy >= G) continue;
          const cx = (gx + 0.5) * CELL, cy = (gy + 0.5) * CELL;
          if ((cx - c.x) ** 2 + (cy - c.y) ** 2 < campRange * campRange) {
            blocked[gy * G + gx] = 1;
          }
        }
      }
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

    const gScore = new Float32Array(G * G).fill(Infinity);
    const fScore = new Float32Array(G * G).fill(Infinity);
    const cameFrom = new Int32Array(G * G).fill(-1);
    const closed = new Uint8Array(G * G);

    const si = sy * G + sx;
    gScore[si] = 0;
    fScore[si] = Math.max(Math.abs(ex - sx), Math.abs(ey - sy)); // Chebyshev heuristic

    // Simple binary heap on fScore
    const open: number[] = [si];
    const inOpen = new Uint8Array(G * G);
    inOpen[si] = 1;

    const dirs = [[-1,0,1],[1,0,1],[0,-1,1],[0,1,1],[-1,-1,1.414],[-1,1,1.414],[1,-1,1.414],[1,1,1.414]];
    let found = false;
    let iters = 0;
    const MAX_ITERS = 800;

    while (open.length > 0 && iters < MAX_ITERS) {
      iters++;
      // Find lowest fScore in open (linear scan — fine for 50x50)
      let bestIdx = 0;
      for (let i = 1; i < open.length; i++) {
        if (fScore[open[i]] < fScore[open[bestIdx]]) bestIdx = i;
      }
      const cur = open[bestIdx];
      open[bestIdx] = open[open.length - 1];
      open.pop();
      inOpen[cur] = 0;

      const cx = cur % G, cy = (cur - cx) / G;
      if (cx === ex && cy === ey) { found = true; break; }

      closed[cur] = 1;

      for (const [ddx, ddy, cost] of dirs) {
        const nx = cx + ddx, ny = cy + ddy;
        if (nx < 0 || nx >= G || ny < 0 || ny >= G) continue;
        const ni = ny * G + nx;
        if (closed[ni] || blocked[ni]) continue;

        // Penalize cells adjacent to blocked cells (prefer paths with clearance)
        let penalty = 0;
        for (const [pdx, pdy] of dirs) {
          const px = nx + pdx, py = ny + pdy;
          if (px >= 0 && px < G && py >= 0 && py < G && blocked[py * G + px]) {
            penalty += 0.5;
          }
        }

        const tentG = gScore[cur] + cost + penalty;
        if (tentG < gScore[ni]) {
          cameFrom[ni] = cur;
          gScore[ni] = tentG;
          fScore[ni] = tentG + Math.max(Math.abs(ex - nx), Math.abs(ey - ny));
          if (!inOpen[ni]) { open.push(ni); inOpen[ni] = 1; }
        }
      }
    }

    if (!found) return null;

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
        const combatRange = u.type === 'gnoll' ? 120 : u.type === 'shaman' ? 100 : COMBAT_RANGE;
        const onCombatStep = !this.isNonCombatStep(u);
        // Include neutral defenders as threats when on attack_camp step
        const isAttackingCamp = u.loop?.steps[u.loop.currentStep]?.action === 'attack_camp';

        // Caution affects how carriers react to threats:
        // safe: never drop, flee to base instead
        // aggressive: only drop if enemy within melee range (not extended range)
        // normal: drop if enemy within combat range + 30
        const dropRange = u.mods.caution === 'aggressive' ? COMBAT_RANGE : combatRange + 30;
        const enemyNear = this.units.some(o =>
          !o.dead && o.team !== u.team
          && (o.team !== 0 || isAttackingCamp)
          && pdist(u, o) <= dropRange);

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
      // GNOLL "Bone Toss": extended combat range (120 vs 80)
      // Caution: aggressive — engage enemies from 200px even mid-delivery (but not through nexus area)
      const baseCombatRange = u.type === 'gnoll' ? 120 : u.type === 'shaman' ? 100 : COMBAT_RANGE;
      const unitCombatRange = u.mods.caution === 'aggressive' ? Math.max(baseCombatRange, 200) : baseCombatRange;
      let best: HUnit | null = null, bestD = Infinity;
      for (const o of this.units) {
        if (o.dead || o.team === u.team) continue;
        if (u.team === 0 && o.team === 0) continue;
        // ─── ROGUE STEALTH: invisible to neutral enemies ───
        if (u.team === 0 && o.type === 'rogue') continue;
        const d = pdist(u, o);
        if (d <= unitCombatRange && d < bestD) { bestD = d; best = o; }
      }

      // ─── TURTLE TAUNT: nearby enemy turtles force this unit to attack them ───
      if (best && u.type !== 'turtle') {
        let tauntTurtle: HUnit | null = null, tauntD = Infinity;
        for (const o of this.units) {
          if (o.dead || o.type !== 'turtle' || o.team === u.team) continue;
          if (u.team === 0 && o.team === 0) continue;
          const d = pdist(u, o);
          if (d <= TURTLE_TAUNT_RANGE && d < tauntD) { tauntD = d; tauntTurtle = o; }
        }
        if (tauntTurtle) { best = tauntTurtle; bestD = tauntD; }
      }

      // Nexus attack (only player units)
      const nex = u.team !== 0 ? this.nexuses.find(n => n.team !== u.team) : null;
      const nexD = nex ? pdist(u, nex) : Infinity;

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
        const splashList: { id: number; dmg: number }[] = [];
        if (splashRadius > 0) {
          for (const o of this.units) {
            if (o === best || o.dead || o.team === u.team) continue;
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
        const ranged = u.type === 'gnoll' || u.type === 'shaman';
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
      }
    }
  }

  // ─── PROJECTILE HELPERS ─────────────────────────────────────

  private spawnProjectile(attacker: HUnit, tx: number, ty: number): Phaser.GameObjects.Container {
    const container = this.add.container(attacker.x, attacker.y).setDepth(50);
    const isShaman = attacker.type === 'shaman';
    if (isShaman) {
      // Purple arcane bolt
      const glow = this.add.circle(0, 0, 8, 0xBB66FF, 0.6);
      const core = this.add.circle(0, 0, 4, 0xEEAAFF, 1.0);
      container.add([glow, core]);
    } else {
      // Gnoll bone toss — tan/brown elongated
      const bone = this.add.circle(0, 0, 5, 0xDDCC88, 1.0);
      const tip = this.add.circle(2, 0, 3, 0xFFEEAA, 0.9);
      container.add([bone, tip]);
    }
    // Rotate toward target
    const angle = Math.atan2(ty - attacker.y, tx - attacker.x);
    container.setRotation(angle);
    return container;
  }

  private destroyProjectile(hit: PendingHit) {
    if (hit.projectile) {
      hit.projectile.destroy();
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
          const tgt = this.units.find(u => u.id === hit.targetId);
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
          const attacker = this.units.find(u => u.id === hit.attackerId);
          if (attacker) this.spawnDmgNumber(nex.x, nex.y - 20, hit.dmg, true, attacker);
          this.sfx.playAt(nex.hp < 5000 ? 'nexus_critical' : 'nexus_damage', nex.x, nex.y);
        }
        this.destroyProjectile(hit);
        continue;
      }

      // Unit hit
      const target = this.units.find(u => u.id === hit.targetId);
      const attacker = this.units.find(u => u.id === hit.attackerId);
      if (!target || target.dead || !attacker) {
        this.destroyProjectile(hit);
        continue;
      }
      if (target && !target.dead && attacker) {
        target.hp -= hit.dmg;
        this.spawnDmgNumber(target.x, target.y - 10, hit.dmg, true, attacker);
        // Per-unit attack SFX (with generic fallbacks)
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

        // Tight formation scatter
        if (!target.dead && target.mods.formation === 'tight') {
          const scDx = target.x - attacker.x, scDy = target.y - attacker.y;
          const scD = Math.sqrt(scDx * scDx + scDy * scDy) || 1;
          target.targetX = target.x + (scDx / scD) * 80;
          target.targetY = target.y + (scDy / scD) * 80;
        }

        // Troll club slam
        if (hit.isTroll && !target.dead) {
          target.attackTimer += ATTACK_CD_MS;
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
        const sTarget = this.units.find(u => u.id === sp.id);
        if (!sTarget || sTarget.dead) continue;
        sTarget.hp -= sp.dmg;
        if (attacker) this.spawnDmgNumber(sTarget.x, sTarget.y - 10, sp.dmg, false, attacker);

        if (hit.isTroll && !sTarget.dead) {
          sTarget.attackTimer += ATTACK_CD_MS;
        }

        // Skull Undying for splash
        if (sTarget.hp <= 0 && sTarget.type === 'skull' && sTarget.hasRebirth) {
          sTarget.hp = 1;
          sTarget.hasRebirth = false;
        } else if (sTarget.hp <= 0) {
          sTarget.dead = true;
          sTarget.claimItemId = -1;
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
          this.sfx.playAt('camp_lost', camp.x, camp.y);
          this.showFeedback('Contested!', '#FFD93D');
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
        if (u.equipSprite) { u.equipSprite.destroy(); u.equipSprite = null; }
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

      // Equipment sprite
      if (u.equipment && !u.equipSprite) {
        const def = EQUIPMENT.find(e => e.id === u.equipment);
        if (def) u.equipSprite = this.add.text(u.x + 12, u.y - 18, def.emoji, { fontSize: '14px' }).setDepth(32);
      }
      if (u.equipSprite) {
        if (!u.equipment) { u.equipSprite.destroy(); u.equipSprite = null; }
        else u.equipSprite.setPosition(u.x + 12, u.y - 18);
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
    content.innerHTML = `
      <div style="display:flex;align-items:center;gap:10px;margin-bottom:8px;">
        <span style="font-size:32px;">${def?.emoji || '?'}</span>
        <div>
          <div style="font-size:20px;font-weight:800;color:#f0e8ff;">${u.type.toUpperCase()} <span style="font-size:14px;color:${teamColor};">#${u.id} [${team}]</span></div>
          <div style="font-size:12px;color:#C98FFF;">${def?.ability || ''} — ${def?.desc || ''}</div>
        </div>
      </div>
      <div style="display:flex;gap:16px;font-size:14px;margin-bottom:6px;flex-wrap:wrap;">
        <span style="color:${hpColor};font-weight:700;">HP: ${Math.round(u.hp)}/${u.maxHp} (${hpPct}%)</span>
        <span>ATK: ${u.attack}</span>
        <span>SPD: ${u.speed}</span>
        <span>Mine: ${mineSpd}x</span>
        <span>Tier: ${def?.tier || '?'}</span>
      </div>
      <div style="display:flex;gap:16px;font-size:12px;color:#8BAA8B;margin-bottom:6px;">
        <span>Pos: (${Math.round(u.x)}, ${Math.round(u.y)})</span>
        <span>Target: (${Math.round(u.targetX)}, ${Math.round(u.targetY)}) dist=${dist}</span>
        <span>Anim: ${u.animState}</span>
      </div>
      <div style="display:flex;gap:16px;font-size:12px;color:#8BAA8B;margin-bottom:6px;">
        <span>Carrying: <span style="color:#FFD93D;">${carry}</span></span>
        <span>Claim: ${claim}</span>
        <span>Idle: ${Math.round(u.idleTimer)}ms</span>
        <span>NonCombat: ${nonCombat}</span>
        <span>Camp: ${u.campId || '-'}</span>
      </div>
      <div style="font-size:12px;color:#FF7777;margin-bottom:4px;">Strong vs: ${counterStr}</div>
      <div style="font-size:13px;color:#45E6B0;font-weight:700;margin-bottom:2px;">Workflow: ${loopLabel}</div>
      <div style="font-size:11px;color:#AAA;margin-bottom:2px;">${stepInfo}</div>
      ${allSteps ? '<pre style="font-size:10px;color:#777;margin:4px 0 0 0;white-space:pre-wrap;line-height:1.4;">' + allSteps + '</pre>' : ''}
    `;
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
        if (u.equipSprite) { u.equipSprite.destroy(); u.equipSprite = null; }
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
        const depositRes = u.carrying;
        this.baseStockpile[team][u.carrying] += carryAmount;
        this.clearCarrying(u);
        const depositKey = ('deposit_' + depositRes) as import('../audio/SoundManager').SfxKey;
        this.sfx.playAt(this.sfx.hasSound(depositKey) ? depositKey : 'resource_deliver', u.x, u.y);
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
            const depositRes = u.carrying;
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
          // Scale defend radii by caution: aggressive = wider patrol+detection, safe = tighter
          const defendDetect = u.mods.caution === 'aggressive' ? 375 : u.mods.caution === 'safe' ? 150 : 250;
          const defendLeash = u.mods.caution === 'aggressive' ? 180 : u.mods.caution === 'safe' ? 80 : 120;
          const defendPatrol = u.mods.caution === 'aggressive' ? 50 + Math.random() * 80 : u.mods.caution === 'safe' ? 15 + Math.random() * 30 : 30 + Math.random() * 60;
          // If far from guard point, go there
          if (distToGuard > defendLeash) {
            u.targetX = guardPos.x; u.targetY = guardPos.y;
          } else {
            // At guard point — look for nearby enemies to chase
            const nearby = this.units
              .filter(e => !e.dead && e.team !== 0 && e.team !== team && pdist(e, guardPos) < defendDetect)
              .sort((a, b) => pdist(u, a) - pdist(u, b));
            if (nearby.length > 0) {
              u.targetX = nearby[0].x; u.targetY = nearby[0].y;
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
          // If target region specified, bias exploration toward it
          const scoutRegionX = step.x;
          const scoutRegionY = step.y;
          const hasRegion = scoutRegionX !== undefined && scoutRegionY !== undefined;

          if (pdist(u, { x: u.targetX, y: u.targetY }) < 30) {
            if (hasRegion) {
              // Wander within ~400px of the target region
              const spread = 400;
              u.targetX = Math.max(50, Math.min(WORLD_W - 50, scoutRegionX + (Math.random() - 0.5) * spread * 2));
              u.targetY = Math.max(50, Math.min(WORLD_H - 50, scoutRegionY + (Math.random() - 0.5) * spread * 2));
            } else {
              // Default: pick a random far camp or wander
              const scoutTarget = this.camps
                .filter(c => pdist(u, c) > 200)
                .sort((a, b) => pdist(u, b) - pdist(u, a));
              if (scoutTarget.length > 0) {
                const pick = scoutTarget[Math.floor(Math.random() * Math.min(3, scoutTarget.length))];
                u.targetX = pick.x; u.targetY = pick.y;
              } else {
                u.targetX = 100 + Math.random() * (WORLD_W - 200);
                u.targetY = 100 + Math.random() * (WORLD_H - 200);
              }
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
          // Scale avoidance by caution: aggressive ignores enemies, safe is extra cautious
          const collectProxAvoid = u.mods.caution === 'aggressive' ? 0 : u.mods.caution === 'safe' ? 300 : 200;
          const collectPathAvoid = u.mods.caution === 'aggressive' ? 0 : u.mods.caution === 'safe' ? 220 : 150;
          // Find nearest unclaimed resource of the right type, avoiding enemies
          const collectRes = step.resourceType;
          let bestItem: HGroundItem | null = null, bestItemD = Infinity;
          for (const item of this.groundItems) {
            if (item.dead || item.type !== collectRes) continue;
            if (claimedItems.has(item.id)) continue;
            // Skip items near enemy units (unless aggressive)
            if (collectProxAvoid > 0) {
              const enemyNearItem = this.units.some(e =>
                !e.dead && e.team !== 0 && e.team !== team && pdist(e, item) < collectProxAvoid);
              if (enemyNearItem) continue;
            }
            // Skip items if enemy is between us and the item (unless aggressive)
            if (collectPathAvoid > 0) {
              const pathBlocked = this.units.some(e => {
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
          // Hunt and kill wild animals but do NOT pick up drops
          const myKillTier = ANIMALS[u.type]?.tier || 1;
          const killPrey = this.units
            .filter(w => w.team === 0 && !w.dead && !w.campId
              && (!step.targetType || w.type === step.targetType)
              && (u.mods.caution !== 'safe' || (ANIMALS[w.type]?.tier || 1) <= myKillTier))
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
          // Requires pickaxe equipment
          if (u.equipment !== 'pickaxe') { this.advanceWorkflow(u); break; }
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
          if (!eqType || u.equipment === eqType) { this.advanceWorkflow(u); break; }
          if (!this.unlockedEquipment[team].has(eqType)) { this.advanceWorkflow(u); break; }
          const armory = this.armories.find(a => a.team === team && a.equipmentType === eqType);
          if (!armory) { this.advanceWorkflow(u); break; }
          u.targetX = armory.x; u.targetY = armory.y;
          if (pdist(u, armory) < ARMORY_RANGE) {
            if (u.equipment === 'shield') {
              const bonus = Math.round(u.maxHp * (0.60 / 1.60));
              u.maxHp -= bonus; u.hp = Math.min(u.hp, u.maxHp);
            }
            if (u.equipSprite) { u.equipSprite.destroy(); u.equipSprite = null; }
            u.equipment = eqType;
            if (eqType === 'shield') {
              const bonus = u.maxHp * 0.60;
              u.maxHp += bonus; u.hp += bonus;
            }
            this.advanceWorkflow(u);
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
        hasRebirth: false, diveReady: false, diveTimer: 0, lastAttackTarget: -1, attackFaceX: null, pathWaypoints: null, pathAge: 0, pathTargetX: 0, pathTargetY: 0, mods: { ...DEFAULT_MODS },
        carrying: null, carrySprite: null, loop: null, isElite: false, idleTimer: 0, claimItemId: -1,
        equipment: null, equipSprite: null,
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
        hasRebirth: false, diveReady: false, diveTimer: 0, lastAttackTarget: -1, attackFaceX: null, pathWaypoints: null, pathAge: 0, pathTargetX: 0, pathTargetY: 0, mods: { ...DEFAULT_MODS },
        carrying: null, carrySprite: null, loop: null, isElite: true, idleTimer: 0, claimItemId: -1,
        equipment: null, equipSprite: null,
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
          hasRebirth: false, diveReady: false, diveTimer: 0, lastAttackTarget: -1, attackFaceX: null, pathWaypoints: null, pathAge: 0, pathTargetX: 0, pathTargetY: 0, mods: { ...DEFAULT_MODS },
          carrying: null, carrySprite: null, loop: null, isElite: false, idleTimer: 0, claimItemId: -1,
          equipment: null, equipSprite: null,
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
          hasRebirth: false, diveReady: false, diveTimer: 0, lastAttackTarget: -1, attackFaceX: null, pathWaypoints: null, pathAge: 0, pathTargetX: 0, pathTargetY: 0, mods: { ...DEFAULT_MODS },
          carrying: null, carrySprite: null, loop: null, isElite: true, idleTimer: 0, claimItemId: -1,
          equipment: null, equipSprite: null,
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
        this.sfx.playAt('nexus_destroyed', n.x, n.y);
        this.sfx.playGlobal(this.winner === this.myTeam ? 'victory' : 'defeat');
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
      lastAttackTarget: -1, attackFaceX: null, pathWaypoints: null, pathAge: 0, pathTargetX: 0, pathTargetY: 0,
      carrying: null, carrySprite: null,
      // Inherit active group workflow so new spawns auto-join the loop
      loop: this.groupWorkflows[`${type}_${team}`]
        ? { ...this.groupWorkflows[`${type}_${team}`], currentStep: 0 }
        : null,
      isElite: false,
      idleTimer: 0,
      claimItemId: -1,
      equipment: null,
      equipSprite: null,
      mods: this.groupModifiers[`${type}_${team}`]
        ? { ...this.groupModifiers[`${type}_${team}`] }
        : { ...DEFAULT_MODS },
    });
    // Spawn SFX — per-unit voice grunt with generic fallbacks
    const spawnKey = ('spawn_' + type) as import('../audio/SoundManager').SfxKey;
    if (type === 'troll') {
      this.sfx.playAt('troll_awaken', x, y);
    } else if (this.sfx.hasSound(spawnKey)) {
      this.sfx.playAt(spawnKey, x, y);
    } else {
      this.sfx.playAt('unit_spawn', x, y);
    }
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
      this.showFeedback('Sending...', '#FFD93D');
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
        if (u.equipSprite) { u.equipSprite.destroy(); u.equipSprite = null; }
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
          lastAttackTarget: -1, attackFaceX: null, pathWaypoints: null, pathAge: 0, pathTargetX: 0, pathTargetY: 0, mods: { ...DEFAULT_MODS },
          carrying: null, carrySprite: null, loop: null, isElite: false, idleTimer: 0, claimItemId: -1,
          equipment: null, equipSprite: null,
        });
      }
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
    this.pendingCommandText = text;
    this.showFeedback('Thinking...', '#FFD93D');

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
      const gCmd = geminiResult[0];
      if (this.executeGeminiCommand(gCmd, team)) {
        this.sfx.playGlobal('voice_recognized');
        // Show thought bubbles with LLM-generated reaction
        if (gCmd.unitReaction) {
          const sel = this.units.filter(u => u.team === team && !u.dead && (this.selectedArmy === 'all' || u.type === this.selectedArmy));
          this.showThoughtBubbles(sel, gCmd.unitReaction);
        }
        return;
      }
    }

    // Fallback to local regex parsing
    this.executeLocalCommand(text, team);
  }

  /** Check workflow preconditions. Returns null if OK, or a short error string. */
  private checkPreconditions(steps: WorkflowStep[], team: 1 | 2): string | null {
    for (const s of steps) {
      if (s.action === 'equip') {
        const eqType = (s as { equipmentType: EquipmentType }).equipmentType;
        if (!this.unlockedEquipment[team].has(eqType)) {
          const def = EQUIPMENT.find(e => e.id === eqType);
          return `Unlock ${def?.name || eqType} first!`;
        }
      }
      if (s.action === 'mine') {
        if (!this.unlockedEquipment[team].has('pickaxe')) return 'Unlock pickaxe first!';
      }
      if (s.action === 'attack_camp') {
        const animal = (s as { targetAnimal?: string }).targetAnimal;
        if (animal && !this.camps.some(c => c.animalType === animal)) return `No ${animal} camp exists!`;
      }
      if (s.action === 'deliver') {
        const target = (s as { target: string }).target;
        const m = target.match(/^nearest_(\w+)_camp$/);
        if (m && !this.camps.some(c => c.animalType === m[1])) return `No ${m[1]} camp exists!`;
      }
    }
    return null;
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
          default:
            return { action: 'seek_resource' as const, resourceType: 'carrot' as ResourceType };
        }
      });

      // Reject overly complex or broken workflows
      if (steps.length > 7) { this.showFeedback('Too complex!', '#FF6B6B'); return true; }
      const knownActions = new Set(['seek_resource','deliver','hunt','attack_camp','move','defend','attack_enemies','scout','collect','kill_only','mine','equip']);
      if (steps.some(s => !knownActions.has(s.action))) { this.showFeedback('Too complex!', '#FF6B6B'); return true; }

      // Check preconditions (equipment unlocked, camps exist, etc.)
      const preErr = this.checkPreconditions(steps, team);
      if (preErr) { this.showFeedback(preErr, '#FF6B6B'); return true; }

      let rawLoopFrom = cmd.loopFrom ?? 0;
      // Safety net: if workflow has attack_camp and delivers to a camp (not base), force loopFrom: 0
      // The attack_camp step is a safeguard that re-checks camp ownership each cycle
      const hasAttackCamp = steps.some(s => s.action === 'attack_camp');
      const deliversToCamp = steps.some(s => s.action === 'deliver' && 'target' in s && (s as { target: string }).target.includes('_camp'));
      if (hasAttackCamp && deliversToCamp) rawLoopFrom = 0;
      const workflow: HWorkflow = { steps, currentStep: 0, label: cmd.narration || 'Custom workflow', loopFrom: Math.max(0, Math.min(rawLoopFrom, steps.length - 1)), playedOnce: false };
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
      // Charge cry if workflow starts with attack, otherwise affirmative
      const hasAttackStep = steps.some(s => s.action === 'attack_camp' || s.action === 'attack_enemies' || s.action === 'kill_only');
      this.unitReact(hasAttackStep ? 'charge' : 'yes', sel);
      this.showFeedback(cmd.narration || 'Roger!', '#45E6B0');
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
    this.sfx.playGlobal('move_command');
    // Charge cry for attack targets, affirmative for movement/defend
    const isAttack = cmd.targetType === 'nexus' || cmd.targetType === 'camp' || cmd.targetType === 'nearest_camp';
    this.unitReact(isAttack ? 'charge' : 'yes', sel);
    this.showFeedback(cmd.narration || 'Moving out!', '#45E6B0');
    return true;
  }

  /** Parse a text fragment into workflow steps, appending to `out`. Returns true if any steps were added. */
  private parseLocalSteps(text: string, out: WorkflowStep[], team: 1 | 2): boolean {
    const lo = text.toLowerCase().trim();
    const base = team === 1 ? P1_BASE : P2_BASE;

    // Equip
    const eqMatch = lo.match(/\b(?:get|grab|equip|pick up)\s+(?:a\s+)?(\w+)/i);
    if (eqMatch) {
      const eqName = eqMatch[1].toLowerCase();
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
      [/gnome/i, 'gnome'], [/turtle/i, 'turtle'], [/skull/i, 'skull'], [/spider/i, 'spider'],
      [/gnoll|wolf/i, 'gnoll'], [/panda/i, 'panda'], [/lizard/i, 'lizard'],
      [/minotaur/i, 'minotaur'], [/shaman/i, 'shaman'], [/troll/i, 'troll'], [/rogue/i, 'rogue'],
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
        if (preErr) { this.showFeedback(preErr, '#FF6B6B'); return; }

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
    const equipMatch = lo.match(/\b(?:get|grab|equip|pick up)\s+(?:a\s+)?(\w+)/i);
    if (equipMatch) {
      const eqName = equipMatch[1].toLowerCase();
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
            [/gnome/i, 'gnome'], [/turtle/i, 'turtle'], [/skull/i, 'skull'], [/spider/i, 'spider'],
            [/gnoll|wolf/i, 'gnoll'], [/panda/i, 'panda'], [/lizard/i, 'lizard'],
            [/minotaur/i, 'minotaur'], [/shaman/i, 'shaman'], [/troll/i, 'troll'],
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
        if (preErr) { this.showFeedback(preErr, '#FF6B6B'); return; }

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
      if (preErr) { this.showFeedback(preErr, '#FF6B6B'); return; }
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
        const success = this.unlockEquipment(team, match.id);
        if (success) {
          this.showFeedback(`${match.emoji} ${match.name} unlocked!`, '#FFD700');
        } else if (this.unlockedEquipment[team].has(match.id)) {
          this.showFeedback('Already unlocked!', '#FF6B6B');
        } else {
          const needed = Object.entries(match.cost).map(([r, a]) => `${a}${RESOURCE_EMOJI[r as ResourceType]}`).join(' ');
          this.sfx.playGlobal('no_resources');
          this.showFeedback(`Need ${needed}!`, '#FF6B6B');
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
      const confSel = this.units.filter(u => u.team === team && !u.dead && (subject === 'all' || u.type === subject));
      this.unitReact('confused', confSel);
      this.showFeedback('Huh? Try simpler.', '#FF6B6B');
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

  // ─── THOUGHT BUBBLES ──────────────────────────────────────
  // Shows a speech bubble above selected units when they receive a command.

  private static readonly CANNED_REACTIONS: Record<string, Record<string, string[]>> = {
    yes: {
      gnome: ['Okie dokie!', 'On it!', 'Yippee!', '*salutes tiny*'],
      turtle: ['Slow and steady...', 'Mmm, understood.', '*nods heavily*'],
      skull: ['*rattles bones*', 'The dead obey.', 'As you wish...'],
      spider: ['*clicks eagerly*', 'Yesss...', '*skitters off*'],
      gnoll: ['Heh, got it!', '*barks*', 'On the hunt!'],
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
      gnoll: ['AROOOOO!', 'GET EM!', '*throws bone*'],
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
      gnoll: ['Bark?', '*head tilt*', 'What say?'],
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
      }
      if (redIdx < this.camps.length) {
        const camp = this.camps[redIdx];
        camp.x = slot.redPos.x;
        camp.y = slot.redPos.y;
        camp.area?.setPosition(slot.redPos.x, slot.redPos.y);
        camp.label?.setPosition(slot.redPos.x, slot.redPos.y - 55);
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
      if (this.armyBarEl) this.armyBarEl.style.display = 'none';
      if (this.textInput) this.textInput.style.display = 'none';
      if (this.voiceStatusEl) this.voiceStatusEl.style.display = 'none';
      if (this.cmdHistoryEl) this.cmdHistoryEl.style.display = 'none';
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
      if (this.armyBarEl) this.armyBarEl.style.display = '';
      if (this.textInput) this.textInput.style.display = '';
      if (this.voiceStatusEl) this.voiceStatusEl.style.display = '';
      if (this.cmdHistoryEl) this.cmdHistoryEl.style.display = '';
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
      terrain: base.terrain || [],
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
        try { localStorage.setItem('horde-editor-maps', JSON.stringify(allMaps)); } catch { /* */ }
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
      id: `camp_${idx}`, name: `${def.emoji} New Camp`, type,
      x: x1, y: y1, guards: 1, spawnMs: 4000, buff: { stat: 'attack', value: 0.05 },
    });
    this.activeCampDefs.push({
      id: `camp_${idx + 1}`, name: `${def.emoji} New Camp`, type,
      x: x2, y: y2, guards: 1, spawnMs: 4000, buff: { stat: 'hp', value: 0.05 },
    });

    // Create game objects
    for (const [cx_, cy_, campId, campName] of [[x1, y1, `camp_${idx}`, `${def.emoji} New Camp`], [x2, y2, `camp_${idx + 1}`, `${def.emoji} New Camp`]] as [number, number, string, string][]) {
      const area = this.add.circle(cx_, cy_, CAMP_RANGE, 0xFFD93D, 0.06)
        .setStrokeStyle(2, 0xFFD93D, 0.25).setDepth(51);
      const label = this.add.text(cx_, cy_ - 55, campName, {
        fontSize: '18px', color: '#FFD93D', fontFamily: '"Nunito", sans-serif', fontStyle: 'bold',
        stroke: '#000000', strokeThickness: 4,
      }).setOrigin(0.5).setDepth(52);
      const captureBar = this.add.graphics().setDepth(53);
      this.camps.push({
        id: campId, name: campName, animalType: type, tier: def.tier,
        guardCount: 1, x: cx_, y: cy_, owner: 0,
        spawnMs: 4000, spawnTimer: 0, buff: { stat: 'attack', value: 0.05 },
        label, area, captureBar, storedFood: 0,
        scouted: false, lastSeenOwner: 0, lastSeenLabel: '', lastSeenColor: '#FFD93D',
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
    this.armories.push({ x: x1, y: y1, team: 1, sprite: null, label: null });
    this.armories.push({ x: x2, y: y2, team: 2, sprite: null, label: null });
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

  // ─── CLEANUP ────────────────────────────────────────────────

  private cleanupHTML() {
    this.textInput?.remove(); this.textInput = null;
    this.voiceStatusEl?.remove(); this.voiceStatusEl = null;
    this.selectionLabel = null;
    this.sidebarEl?.remove(); this.sidebarEl = null;
    this.armyBarEl?.remove(); this.armyBarEl = null;
    this.cmdHistoryEl?.remove(); this.cmdHistoryEl = null;
    this.charPanelEl?.remove(); this.charPanelEl = null;
    document.getElementById('horde-char-toggle')?.remove();
    this.equipPanelEl?.remove(); this.equipPanelEl = null;
    document.getElementById('horde-equip-toggle')?.remove();
    this.debugPanelEl?.remove(); this.debugPanelEl = null;
    // Destroy any in-flight projectiles
    for (const hit of this.pendingHits) this.destroyProjectile(hit);
    this.pendingHits = [];
    try { this.recognition?.abort(); } catch (_e) { /* */ }
    if (this.firebase) { this.firebase.cleanup(); this.firebase = null; }
    if (this.editorSyncChannel) { this.editorSyncChannel.close(); this.editorSyncChannel = null; }
    this.editorPanelEl?.remove(); this.editorPanelEl = null;
    this.editorHighlight?.destroy(); this.editorHighlight = null;
    if (this.editorSaveTimeout) { clearTimeout(this.editorSaveTimeout); this.editorSaveTimeout = null; }
  }
}
