#!/usr/bin/env node
// ═══════════════════════════════════════════════════════════════
// Voice Command Test Harness — 50 Inputs vs Gemini
// Tests the exact same prompt template + micro-filter from HordeScene.ts
// Run: node packages/client/test-voice-commands.mjs
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

// ─── Mock Game State ─────────────────────────────────────────
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
  resources: { carrot: 12, meat: 8, crystal: 3 },
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
};

// ─── Micro-Filter (exact copy from HordeScene.ts lines 6417-6425) ───
function microFilter(text) {
  const trimmed = text.trim();
  if (trimmed.length < 2 || /^(.)\1{3,}$/.test(trimmed)) return { pass: false, reason: 'noise' };
  const lo = trimmed.toLowerCase();
  if (['um','uh','hmm','ok','okay','so','well','like','yeah','hey','hello','hi'].includes(lo)) return { pass: false, reason: 'filler' };
  if (/^(pause|save|quit|exit|restart|settings|options|menu|volume|mute|undo|skip)$/i.test(lo)) return { pass: false, reason: 'meta' };
  return { pass: true, reason: null };
}

// ─── Build Prompt (exact copy from HordeScene.ts lines 75-421) ──────
function buildPrompt(rawText, ctx) {
  const campList = ctx.camps.map(c =>
    `  [${c.index}] ${c.name} (${c.animalType}, T${c.tier}) - ${c.owner}${c.storedFood > 0 ? ` - food:${c.storedFood}/${c.spawnCost}` : ''} - dist:${c.dist} - defenders:${c.defenders}`
  ).join('\n');

  const unitList = ctx.myUnits.map(u => {
    let info = `  ${u.type} (T${u.tier}): ${u.count} units`;
    if (u.gathering > 0) info += ` (${u.gathering} gathering)`;
    return info;
  }).join('\n');

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

MY RESOURCES: 🥕${ctx.resources.carrot} 🍖${ctx.resources.meat} 💎${ctx.resources.crystal}

CAMPS (sorted by distance):
${campList}

NEXUS HP: mine=${ctx.nexusHp.mine}/50000, enemy=${ctx.nexusHp.enemy}/50000

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
  {"action": "scout", "x": 500, "y": 500} — explore the map, AVOIDS combat. Optional x,y to bias toward a region (e.g. "scout top left" → x:480, y:480). Omit x,y for full-map exploration.
  {"action": "collect", "resourceType": "carrot|meat|crystal"} — pick up ground resources while AVOIDING enemy units (safe gathering)
  {"action": "kill_only", "targetType": "skull|spider|..."} — hunt and kill wild animals but IGNORE resource drops (pure combat, no pickup)
  {"action": "mine"} — go to nearest mine node and extract metal, then carry it back (requires Pickaxe equipment)
  {"action": "contest_event"} — move to nearest active map event and interact (gather, deliver, attack, sacrifice, feed). Use when player says "go to event", "contest the event", "help with the bear", etc.
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

A) UNLOCK EQUIPMENT: "unlock/buy/research [equipment name]"
   → This is NOT a workflow. Return targetType="base" with narration about unlocking.
   → The game handles unlock logic separately from this JSON.

B) EQUIP + ACTION: "get/grab/equip [equipment] and/then [action]"
   → targetType="workflow", start with {"action":"equip","equipmentType":"..."}, then action steps
   Examples:
   "get pickaxes and mine" → [equip pickaxe, mine, deliver base]
   "grab swords and attack wolf camp" → [equip sword, attack_camp hyena nearest]
   "get shields and defend base" → [equip shield, defend base]
   "equip boots and gather carrots" → [equip boots, seek_resource carrot, deliver base]
   "get a banner and lead the charge" → [equip banner, attack_enemies]
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
  "targetType": "<camp|nearest_camp|sweep_camps|nexus|base|defend|retreat|workflow|query>",
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

// ─── Resolve Action (human-readable) ─────────────────────────
function resolveAction(cmd) {
  if (!cmd) return '(no response)';

  if (cmd.responseType === 'unrecognized') return `UNRECOGNIZED: ${cmd.narration || '?'}`;
  if (cmd.responseType === 'status_query' || cmd.targetType === 'query') return `STATUS: ${(cmd.statusReport || cmd.narration || '').slice(0, 60)}`;
  if (cmd.responseType === 'acknowledgment') return `ACK: ${cmd.narration || '?'}`;

  if (cmd.modifierOnly) {
    const mods = [];
    if (cmd.modifiers?.formation) mods.push(`fm=${cmd.modifiers.formation}`);
    if (cmd.modifiers?.caution) mods.push(`ct=${cmd.modifiers.caution}`);
    if (cmd.modifiers?.pacing) mods.push(`pc=${cmd.modifiers.pacing}`);
    return `MODIFIER: ${mods.join(', ')}`;
  }

  if (cmd.targetType === 'nexus') return 'Move to enemy nexus';
  if (cmd.targetType === 'base') return 'Move to base';
  if (cmd.targetType === 'defend') return 'Defend base';
  if (cmd.targetType === 'retreat') return 'Retreat to base';
  if (cmd.targetType === 'nearest_camp') return `Nearest camp${cmd.targetAnimal ? ` (${cmd.targetAnimal})` : ''}${cmd.qualifier ? ` [${cmd.qualifier}]` : ''}`;
  if (cmd.targetType === 'camp') return `Camp #${cmd.campIndex}${cmd.targetAnimal ? ` (${cmd.targetAnimal})` : ''}`;
  if (cmd.targetType === 'sweep_camps') return `Sweep${cmd.targetAnimal ? ` ${cmd.targetAnimal}` : ''} camps`;

  if (cmd.targetType === 'workflow' && cmd.workflow) {
    const steps = cmd.workflow.map(s => {
      if (s.action === 'equip') return `equip:${s.equipmentType}`;
      if (s.action === 'seek_resource') return `seek:${s.resourceType}`;
      if (s.action === 'collect') return `collect:${s.resourceType}`;
      if (s.action === 'deliver') return `deliver:${s.target}`;
      if (s.action === 'hunt') return s.targetType ? `hunt:${s.targetType}` : 'hunt';
      if (s.action === 'attack_camp') return `atk_camp:${s.targetAnimal || '?'}`;
      if (s.action === 'attack_enemies') return 'atk_enemies';
      if (s.action === 'defend') return `defend:${s.target || 'base'}`;
      if (s.action === 'move') return `move(${s.x},${s.y})`;
      if (s.action === 'mine') return 'mine';
      if (s.action === 'scout') return 'scout';
      if (s.action === 'kill_only') return `kill_only:${s.targetType || 'any'}`;
      return s.action;
    });
    const lf = cmd.loopFrom ?? 0;
    return `WF[${steps.join('→')}] lf=${lf}`;
  }

  return `tT=${cmd.targetType} ${cmd.narration || ''}`.trim();
}

// ─── Grade Result ────────────────────────────────────────────
function gradeResult(testCase, filterResult, cmd) {
  const { expected, input } = testCase;

  // --- Filtered cases ---
  if (expected.startsWith('FILTERED:')) {
    const expectedReason = expected.split(':')[1].trim();
    if (!filterResult.pass && filterResult.reason === expectedReason) return 'PASS';
    if (!filterResult.pass) return 'WARN'; // filtered but wrong reason
    return 'FAIL'; // should have been filtered but wasn't
  }

  // If it should NOT be filtered but was:
  if (!filterResult.pass) return 'FAIL';

  // No Gemini response
  if (!cmd) return 'FAIL';

  // --- Unrecognized ---
  if (expected.includes('responseType=unrecognized')) {
    if (cmd.responseType === 'unrecognized') return 'PASS';
    return 'FAIL';
  }

  // --- Status queries ---
  if (expected.includes('responseType=status_query')) {
    if (cmd.responseType === 'status_query' || cmd.targetType === 'query') {
      if (expected.includes('statusReport') && cmd.statusReport) return 'PASS';
      if (expected.includes('strategic advice') && (cmd.statusReport || cmd.narration)) return 'PASS';
      if (expected.includes('nexus HP') && cmd.statusReport && /\d/.test(cmd.statusReport)) return 'PASS';
      return 'PASS'; // any status_query is acceptable
    }
    return 'FAIL';
  }

  // --- Modifier-only ---
  if (expected.includes('modifierOnly=true')) {
    if (cmd.modifierOnly) {
      if (expected.includes('formation=spread') && cmd.modifiers?.formation === 'spread') return 'PASS';
      if (expected.includes('caution=aggressive') && cmd.modifiers?.caution === 'aggressive') return 'PASS';
      if (cmd.modifiers) return 'WARN'; // modifier-only but not the expected one
    }
    return 'FAIL';
  }

  // --- targetType checks ---
  if (expected.includes('targetType=nexus')) {
    if (cmd.targetType === 'nexus') return 'PASS';
    // Workflow with attack_enemies heading toward nexus is acceptable
    if (cmd.targetType === 'workflow' && cmd.workflow?.some(s => s.action === 'attack_enemies')) return 'WARN';
    return 'FAIL';
  }

  if (expected.includes('targetType=retreat')) {
    if (cmd.targetType === 'retreat' || cmd.targetType === 'base') return 'PASS';
    return 'FAIL';
  }

  if (expected.includes('targetType=nearest_camp')) {
    if (cmd.targetType === 'nearest_camp') return 'PASS';
    if (cmd.targetType === 'sweep_camps') return 'WARN';
    return 'FAIL';
  }

  if (expected.includes('targetType=defend')) {
    if (cmd.targetType === 'defend' || cmd.targetType === 'base') return 'PASS';
    if (cmd.targetType === 'workflow' && cmd.workflow?.some(s => s.action === 'defend')) return 'PASS';
    return 'FAIL';
  }

  // --- Workflow checks ---
  if (expected.includes('wf:')) {
    if (cmd.targetType !== 'workflow' || !cmd.workflow) {
      // Some simple commands might map to non-workflow targetTypes
      if (expected.includes('defend') && (cmd.targetType === 'defend' || cmd.targetType === 'base')) return 'PASS';
      return 'FAIL';
    }

    const actions = cmd.workflow.map(s => s.action);
    let grade = 'PASS';

    // Check key expected actions are present
    if (expected.includes('attack_camp') && !actions.includes('attack_camp')) grade = 'FAIL';
    if (expected.includes('seek_resource') && !actions.includes('seek_resource') && !actions.includes('collect')) grade = actions.includes('collect') ? 'WARN' : 'FAIL';
    if (expected.includes('deliver') && !actions.includes('deliver')) grade = 'WARN'; // some deliver to base implicitly
    if (expected.includes('hunt') && !actions.includes('hunt')) grade = grade === 'FAIL' ? 'FAIL' : 'WARN';
    if (expected.includes('equip') && !actions.includes('equip')) grade = 'FAIL';
    if (expected.includes('attack_enemies') && !actions.includes('attack_enemies')) grade = 'FAIL';
    if (expected.includes('defend') && !actions.includes('defend')) grade = 'FAIL';
    if (expected.includes('mine') && !actions.includes('mine')) grade = 'FAIL';

    // Check resource type if specified
    if (expected.includes('carrot')) {
      const hasCarrot = cmd.workflow.some(s => s.resourceType === 'carrot');
      if (!hasCarrot && grade === 'PASS') grade = 'WARN';
    }
    if (expected.includes('meat')) {
      const hasMeat = cmd.workflow.some(s => s.resourceType === 'meat');
      if (!hasMeat && grade === 'PASS') grade = 'WARN';
    }

    // Check camp target animal
    if (expected.includes('gnome') && expected.includes('attack_camp')) {
      if (!cmd.workflow.some(s => s.action === 'attack_camp' && s.targetAnimal === 'gnome')) {
        if (grade === 'PASS') grade = 'WARN';
      }
    }
    if (expected.includes('skull') && expected.includes('attack_camp')) {
      if (!cmd.workflow.some(s => s.action === 'attack_camp' && s.targetAnimal === 'skull')) {
        if (grade === 'PASS') grade = 'WARN';
      }
    }
    if (expected.includes('turtle') && expected.includes('attack_camp')) {
      if (!cmd.workflow.some(s => s.action === 'attack_camp' && s.targetAnimal === 'turtle')) {
        if (grade === 'PASS') grade = 'WARN';
      }
    }

    // Check loopFrom
    const lfMatch = expected.match(/lf=(\d+)/);
    if (lfMatch) {
      const expectedLf = parseInt(lfMatch[1]);
      const actualLf = cmd.loopFrom ?? 0;
      if (actualLf !== expectedLf && grade === 'PASS') grade = 'WARN';
    }

    return grade;
  }

  // --- Genre translation / ambiguous ---
  if (expected.includes('attack_enemies')) {
    if (cmd.targetType === 'workflow' && cmd.workflow?.some(s => s.action === 'attack_enemies')) return 'PASS';
    if (cmd.targetType === 'nearest_camp' || cmd.targetType === 'nexus') return 'WARN';
    return 'FAIL';
  }

  if (expected.includes('seek_resource')) {
    if (cmd.targetType === 'workflow' && cmd.workflow?.some(s => s.action === 'seek_resource' || s.action === 'collect')) return 'PASS';
    return 'FAIL';
  }

  if (expected.includes('bootstrap')) {
    if (cmd.targetType === 'workflow' && cmd.workflow?.some(s => s.action === 'attack_camp')) return 'PASS';
    return 'FAIL';
  }

  if (expected.includes('retreat') || expected.includes('base')) {
    if (cmd.targetType === 'retreat' || cmd.targetType === 'base') return 'PASS';
    if (cmd.targetType === 'defend') return 'WARN';
    if (cmd.targetType === 'workflow' && cmd.workflow?.some(s => s.action === 'defend' && s.target === 'base')) return 'WARN';
    return 'FAIL';
  }

  if (expected.includes('defend')) {
    if (cmd.targetType === 'defend' || cmd.targetType === 'base') return 'PASS';
    if (cmd.targetType === 'retreat') return 'WARN';
    if (cmd.targetType === 'workflow' && cmd.workflow?.some(s => s.action === 'defend')) return 'PASS';
    return 'FAIL';
  }

  if (expected.includes('pacing=rush')) {
    if (cmd.modifiers?.pacing === 'rush') return 'PASS';
    return 'WARN'; // rush is a modifier, might still have correct action
  }

  if (expected.includes('caution=safe')) {
    if (cmd.modifiers?.caution === 'safe') return 'PASS';
    return 'WARN';
  }

  if (expected.includes('caution=aggressive')) {
    if (cmd.modifiers?.caution === 'aggressive') return 'PASS';
    return 'WARN';
  }

  if (expected.includes('move to x~')) {
    const expectedX = parseInt(expected.match(/x~(\d+)/)?.[1] || '0');
    if (cmd.targetType === 'workflow' && cmd.workflow?.some(s => s.action === 'move')) {
      const moveStep = cmd.workflow.find(s => s.action === 'move');
      if (moveStep && Math.abs(moveStep.x - expectedX) < 400) return 'PASS';
      return 'WARN'; // has move but coords far off
    }
    return 'FAIL';
  }

  if (expected.includes('attack') && expected.includes('camp')) {
    const campAnimal = expected.match(/attack\s+(\w+)\s+camp/)?.[1];
    if (cmd.targetType === 'nearest_camp') {
      if (campAnimal && cmd.targetAnimal === campAnimal) return 'PASS';
      return 'WARN';
    }
    if (cmd.targetType === 'camp') return 'PASS';
    if (cmd.targetType === 'workflow' && cmd.workflow?.some(s => s.action === 'attack_camp')) return 'PASS';
    return 'FAIL';
  }

  // Fallback: if we got an action response at all, WARN
  if (cmd.responseType === 'action' || cmd.targetType) return 'WARN';

  return 'FAIL';
}

// ─── 50 Test Cases ───────────────────────────────────────────
const TEST_CASES = [
  // Cat 1: Core Commands (9)
  { id: 1, input: 'attack the nexus', category: 'Core', expected: 'targetType=nexus' },
  { id: 2, input: 'make gnomes', category: 'Core', expected: 'wf: [attack_camp gnome, seek_resource carrot, deliver gnome_camp] lf=0' },
  { id: 3, input: 'gather carrots', category: 'Core', expected: 'wf: [seek_resource carrot, deliver base] lf=0' },
  { id: 4, input: 'defend base', category: 'Core', expected: 'targetType=defend or wf: [defend base] lf=0' },
  { id: 5, input: 'get skulls', category: 'Core', expected: 'wf: [attack_camp skull, hunt, seek_resource meat, deliver skull_camp] lf=0' },
  { id: 6, input: 'retreat', category: 'Core', expected: 'targetType=retreat' },
  { id: 7, input: 'attack nearest camp', category: 'Core', expected: 'targetType=nearest_camp' },
  { id: 8, input: 'farm meat', category: 'Core', expected: 'wf: [hunt, seek_resource meat, deliver base] lf=0' },
  { id: 9, input: 'mine metal', category: 'Core', expected: 'wf: [equip pickaxe, mine, deliver base] lf=1' },

  // Cat 2: Meta / Micro-Filter (5)
  { id: 10, input: 'pause', category: 'Filter', expected: 'FILTERED: meta' },
  { id: 11, input: 'save', category: 'Filter', expected: 'FILTERED: meta' },
  { id: 12, input: 'quit', category: 'Filter', expected: 'FILTERED: meta' },
  { id: 13, input: 'um', category: 'Filter', expected: 'FILTERED: filler' },
  { id: 14, input: 'uh', category: 'Filter', expected: 'FILTERED: filler' },

  // Cat 3: Wrong-Genre Translation (8)
  { id: 15, input: 'shoot them', category: 'Genre', expected: 'attack_enemies (genre: shoot→attack)' },
  { id: 16, input: 'fire at the enemy', category: 'Genre', expected: 'attack_enemies or nexus' },
  { id: 17, input: 'loot the area', category: 'Genre', expected: 'seek_resource workflow' },
  { id: 18, input: 'reload', category: 'Genre', expected: 'responseType=unrecognized' },
  { id: 19, input: 'build a base', category: 'Genre', expected: 'responseType=unrecognized' },
  { id: 20, input: 'build an army', category: 'Genre', expected: 'bootstrap workflow' },
  { id: 21, input: 'sprint to the camp', category: 'Genre', expected: 'nearest_camp + pacing=rush' },
  { id: 22, input: 'crouch behind cover', category: 'Genre', expected: 'responseType=unrecognized' },

  // Cat 4: Emotional/Urgent (5)
  { id: 23, input: 'oh no run!', category: 'Emotional', expected: 'retreat/base' },
  { id: 24, input: 'help!', category: 'Emotional', expected: 'defend or retreat' },
  { id: 25, input: 'yes attack!', category: 'Emotional', expected: 'attack_enemies, possibly caution=aggressive' },
  { id: 26, input: 'go go go!', category: 'Emotional', expected: 'pacing=rush + forward action' },
  { id: 27, input: 'no no no come back!', category: 'Emotional', expected: 'retreat/base' },

  // Cat 5: Status Queries (4)
  { id: 28, input: 'how am I doing?', category: 'Status', expected: 'responseType=status_query, statusReport present' },
  { id: 29, input: 'what should I do?', category: 'Status', expected: 'responseType=status_query, strategic advice' },
  { id: 30, input: 'how many units do I have?', category: 'Status', expected: 'responseType=status_query' },
  { id: 31, input: "what's the score?", category: 'Status', expected: 'responseType=status_query, nexus HP' },

  // Cat 6: Avoidance/Pathing (6)
  { id: 32, input: "don't go there", category: 'Avoidance', expected: 'caution=safe, retreat/redirect' },
  { id: 33, input: 'avoid the skull camp', category: 'Avoidance', expected: 'caution=safe, different target' },
  { id: 34, input: 'go around the enemy', category: 'Avoidance', expected: 'workflow with move waypoints' },
  { id: 35, input: 'flank the hyena camp', category: 'Avoidance', expected: 'workflow with indirect move steps' },
  { id: 36, input: 'go left', category: 'Avoidance', expected: 'move to x~1200' },
  { id: 37, input: 'go right', category: 'Avoidance', expected: 'move to x~2400' },

  // Cat 7: Speech Mishears (4)
  { id: 38, input: 'make nomes', category: 'Mishear', expected: 'bootstrap gnomes (wf: [attack_camp gnome, seek_resource carrot, deliver] lf=0)' },
  { id: 39, input: 'attack the hi ena', category: 'Mishear', expected: 'attack hyena camp' },
  { id: 40, input: 'get minor tours', category: 'Mishear', expected: 'bootstrap minotaurs (wf: [attack_camp minotaur, hunt, seek_resource crystal, deliver] lf=0)' },
  { id: 41, input: 'capture the school camp', category: 'Mishear', expected: 'attack skull camp' },

  // Cat 8: Complex Multi-Step (4)
  { id: 42, input: 'get swords and attack', category: 'Complex', expected: 'wf: [equip sword, attack_enemies] lf=1' },
  { id: 43, input: 'capture turtle camp then make turtles', category: 'Complex', expected: 'wf: [attack_camp turtle, seek_resource carrot, deliver turtle_camp] lf=0' },
  { id: 44, input: 'equip shields then defend the panda camp', category: 'Complex', expected: 'wf: [equip shield, defend panda_camp] lf=1' },
  { id: 45, input: 'get pickaxes then mine', category: 'Complex', expected: 'wf: [equip pickaxe, mine, deliver base] lf=1' },

  // Cat 9: Modifier-Only (2)
  { id: 46, input: 'spread out', category: 'Modifier', expected: 'modifierOnly=true, formation=spread' },
  { id: 47, input: 'be aggressive', category: 'Modifier', expected: 'modifierOnly=true, caution=aggressive' },

  // Cat 10: Gibberish/Noise (3)
  { id: 48, input: 'aaaa', category: 'Noise', expected: 'FILTERED: noise' },
  { id: 49, input: 'blorp fizzle wompus', category: 'Noise', expected: 'responseType=unrecognized' },
  { id: 50, input: 'the', category: 'Noise', expected: 'responseType=unrecognized' },
];

// ─── Main ────────────────────────────────────────────────────
async function main() {
  console.log(`\n# Voice Command Test Results`);
  console.log(`Date: ${new Date().toISOString().slice(0, 10)} | Model: ${GEMINI_MODEL} | Tests: ${TEST_CASES.length}\n`);

  const results = [];
  let pass = 0, warn = 0, fail = 0;

  for (const tc of TEST_CASES) {
    process.stdout.write(`  [${String(tc.id).padStart(2)}/${TEST_CASES.length}] "${tc.input}" ...`);

    const filterResult = microFilter(tc.input);
    let cmd = null;
    let geminiRaw = '';

    if (filterResult.pass) {
      const prompt = buildPrompt(tc.input, MOCK_CTX);
      cmd = await callGemini(prompt);
      if (cmd) {
        // Compact Gemini response for table
        const parts = [];
        if (cmd.targetType) parts.push(`tT=${cmd.targetType}`);
        if (cmd.responseType && cmd.responseType !== 'action') parts.push(`rT=${cmd.responseType}`);
        if (cmd.modifierOnly) parts.push('modOnly');
        if (cmd.modifiers) {
          if (cmd.modifiers.formation && cmd.modifiers.formation !== 'normal' && cmd.modifiers.formation !== null) parts.push(`fm=${cmd.modifiers.formation}`);
          if (cmd.modifiers.caution && cmd.modifiers.caution !== 'normal' && cmd.modifiers.caution !== null) parts.push(`ct=${cmd.modifiers.caution}`);
          if (cmd.modifiers.pacing && cmd.modifiers.pacing !== 'normal' && cmd.modifiers.pacing !== null) parts.push(`pc=${cmd.modifiers.pacing}`);
        }
        if (cmd.narration) parts.push(`"${cmd.narration}"`);
        geminiRaw = parts.join(' ');
      } else {
        geminiRaw = '(null)';
      }
      // Delay between API calls
      await new Promise(r => setTimeout(r, 200));
    } else {
      geminiRaw = `(filtered: ${filterResult.reason})`;
    }

    const resolved = filterResult.pass ? resolveAction(cmd) : `(filtered: ${filterResult.reason})`;
    const grade = gradeResult(tc, filterResult, cmd);

    if (grade === 'PASS') pass++;
    else if (grade === 'WARN') warn++;
    else fail++;

    results.push({ ...tc, filterResult, cmd, geminiRaw, resolved, grade });
    console.log(` ${grade}`);
  }

  // Print markdown table
  console.log(`\n| # | Input | Category | Expected | Gemini Response | Resolved Action | Grade |`);
  console.log(`|---|-------|----------|----------|-----------------|-----------------|-------|`);
  for (const r of results) {
    const input = r.input.length > 30 ? r.input.slice(0, 27) + '...' : r.input;
    const expected = r.expected.length > 40 ? r.expected.slice(0, 37) + '...' : r.expected;
    const gemini = r.geminiRaw.length > 40 ? r.geminiRaw.slice(0, 37) + '...' : r.geminiRaw;
    const resolved = r.resolved.length > 45 ? r.resolved.slice(0, 42) + '...' : r.resolved;
    const gradeIcon = r.grade === 'PASS' ? 'PASS' : r.grade === 'WARN' ? 'WARN' : 'FAIL';
    console.log(`| ${r.id} | ${input} | ${r.category} | ${expected} | ${gemini} | ${resolved} | ${gradeIcon} |`);
  }

  // Summary
  console.log(`\n## Summary`);
  console.log(`- PASS: ${pass}/${TEST_CASES.length} (${Math.round(pass / TEST_CASES.length * 100)}%)`);
  console.log(`- WARN: ${warn}/${TEST_CASES.length} (${Math.round(warn / TEST_CASES.length * 100)}%)`);
  console.log(`- FAIL: ${fail}/${TEST_CASES.length} (${Math.round(fail / TEST_CASES.length * 100)}%)`);

  // Print failures detail
  const failures = results.filter(r => r.grade === 'FAIL');
  if (failures.length > 0) {
    console.log(`\n## Failures Detail`);
    for (const f of failures) {
      console.log(`\n### #${f.id}: "${f.input}" (${f.category})`);
      console.log(`Expected: ${f.expected}`);
      console.log(`Got: ${f.resolved}`);
      if (f.cmd) console.log(`Raw: ${JSON.stringify(f.cmd, null, 2)}`);
    }
  }

  // Print warnings detail
  const warnings = results.filter(r => r.grade === 'WARN');
  if (warnings.length > 0) {
    console.log(`\n## Warnings Detail`);
    for (const w of warnings) {
      console.log(`  #${w.id}: "${w.input}" — expected: ${w.expected.slice(0, 60)} — got: ${w.resolved.slice(0, 60)}`);
    }
  }

  console.log(`\n---`);
  console.log(`Done. ${pass >= 40 ? 'Target met (>=80% PASS).' : 'Below target (<80% PASS) — review prompt.'}`);
}

main().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});
