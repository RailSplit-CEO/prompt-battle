import Phaser from 'phaser';
import { FirebaseSync } from '../network/FirebaseSync';
import { HORDE_SPRITE_CONFIGS } from '../sprites/SpriteConfig';

// ═══════════════════════════════════════════════════════════════
// GEMINI INTEGRATION
// ═══════════════════════════════════════════════════════════════

const GEMINI_API_KEY = (import.meta as any).env?.VITE_GEMINI_API_KEY || '';
const GEMINI_MODEL = 'gemini-2.0-flash';
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

interface HordeCommand {
  targetType: 'camp' | 'nearest_camp' | 'sweep_camps' | 'nexus' | 'base' | 'position' | 'defend' | 'retreat' | 'workflow';
  targetAnimal?: string;
  campIndex?: number;
  qualifier?: 'nearest' | 'furthest' | 'weakest' | 'strongest' | 'uncaptured' | 'enemy';
  // LLM-defined workflow steps — the LLM decides the full loop
  workflow?: { action: string; resourceType?: string; target?: string; targetType?: string; campIndex?: number; qualifier?: string; targetAnimal?: string; x?: number; y?: number }[];
  narration?: string;
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
Resources: 🥕 Carrots (spawn on ground everywhere), 🍖 Meat (drops from killed wild animals), 💎 Crystals (drops from elite prey)

SPAWN COSTS — each unit type requires a specific resource delivered to its camp:
  Tier 1: gnome (🧝) = 1 carrot, turtle (🐢) = 1 carrot
  Tier 2: skull (💀) = 3 meat, spider (🕷️) = 3 meat, gnoll (🐺) = 3 meat
  Tier 3: panda (🐼) = 5 meat, lizard (🦎) = 5 meat
  Tier 4: minotaur (🐂) = 8 crystals, shaman (🔮) = 8 crystals
  Tier 5: troll (👹) = 12 crystals

HOW SPAWNING WORKS: Units gather a resource → carry it to a camp of the desired type → camp uses it to spawn that unit type. E.g. "make gnomes" means gather carrots and deliver to a gnome camp. "make skulls" means gather meat and deliver to a skull camp.

To produce a unit, you MUST own a camp of that type. Camps start neutral with defenders — kill the defenders to capture.

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

The workflow LOOPS automatically. Design the steps so they make a sensible repeating cycle.

SPECIAL: Turtles carry 10x resources per trip — they're slow but incredibly efficient haulers! Prefer assigning turtles to gather/deliver workflows.

═══ UNIT TRAITS & ROLES ═══
Each unit has unique strengths — use these to make smart workflow decisions:

GNOME (T1, 🧝): Fast, nimble, 2x pickup range. BEST gatherer for carrots. Cheap (1 carrot). Weak fighter — keep gathering, not fighting.
TURTLE (T1, 🐢): Slow but carries 10x resources per trip! Ultimate hauler. 1 carrot. Always prefer turtles for any gather/deliver workflow.
SKULL (T2, 💀): Cheats death once (survives lethal at 1 HP). Good fighter. 3 meat. Can self-sustain: hunt → pick meat → deliver to own camp.
SPIDER (T2, 🕷️): Fast ambusher. Great for raiding and hit-and-run. 3 meat.
GNOLL (T2, 🐺): Ranged attacker (120 range vs normal 60). Excellent for defense and kiting. 3 meat.
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
"bootstrap pandas": [{"action":"attack_camp","targetAnimal":"panda","qualifier":"nearest"},{"action":"hunt"},{"action":"seek_resource","resourceType":"meat"},{"action":"deliver","target":"nearest_panda_camp"}]
"bootstrap lizards": [{"action":"attack_camp","targetAnimal":"lizard","qualifier":"nearest"},{"action":"hunt"},{"action":"seek_resource","resourceType":"meat"},{"action":"deliver","target":"nearest_lizard_camp"}]
"bootstrap minotaurs": [{"action":"attack_camp","targetAnimal":"minotaur","qualifier":"nearest"},{"action":"hunt","targetType":"minotaur"},{"action":"seek_resource","resourceType":"crystal"},{"action":"deliver","target":"nearest_minotaur_camp"}]
"bootstrap shamans": [{"action":"attack_camp","targetAnimal":"shaman","qualifier":"nearest"},{"action":"hunt","targetType":"minotaur"},{"action":"seek_resource","resourceType":"crystal"},{"action":"deliver","target":"nearest_shaman_camp"}]
"bootstrap troll": [{"action":"attack_camp","targetAnimal":"troll","qualifier":"nearest"},{"action":"hunt","targetType":"minotaur"},{"action":"seek_resource","resourceType":"crystal"},{"action":"deliver","target":"nearest_troll_camp"}]

═══ WORKFLOW EXAMPLES ═══

PRODUCTION (already own camp):
"make gnomes" → [{"action":"seek_resource","resourceType":"carrot"},{"action":"deliver","target":"nearest_gnome_camp"}]
"make skulls" → [{"action":"hunt"},{"action":"seek_resource","resourceType":"meat"},{"action":"deliver","target":"nearest_skull_camp"}]
"make shamans" → [{"action":"hunt","targetType":"minotaur"},{"action":"seek_resource","resourceType":"crystal"},{"action":"deliver","target":"nearest_shaman_camp"}]

CROSS-UNIT PRODUCTION:
"gnomes make skulls" → [{"action":"seek_resource","resourceType":"meat"},{"action":"deliver","target":"nearest_skull_camp"}]
"turtles make pandas" → [{"action":"seek_resource","resourceType":"meat"},{"action":"deliver","target":"nearest_panda_camp"}]
"skulls make skulls" → [{"action":"hunt"},{"action":"seek_resource","resourceType":"meat"},{"action":"deliver","target":"nearest_skull_camp"}]

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
"capture and produce skulls" → [{"action":"attack_camp","targetAnimal":"skull","qualifier":"nearest"},{"action":"hunt"},{"action":"seek_resource","resourceType":"meat"},{"action":"deliver","target":"nearest_skull_camp"}]

DEFEND & ATTACK:
"defend base" → [{"action":"defend","target":"base"}]
"guard gnome camp" → [{"action":"defend","target":"nearest_gnome_camp"}]
"attack enemies" → [{"action":"attack_enemies"}]
"hunt enemies then defend" → [{"action":"attack_enemies"},{"action":"defend","target":"base"}]

STRATEGIC:
"get started" → bootstrap gnomes (cheapest, fastest economy start)
"full pipeline" → [{"action":"attack_camp","targetAnimal":"skull","qualifier":"nearest"},{"action":"hunt"},{"action":"seek_resource","resourceType":"meat"},{"action":"deliver","target":"nearest_skull_camp"}]
"build up then push" → [{"action":"seek_resource","resourceType":"carrot"},{"action":"deliver","target":"nearest_gnome_camp"},{"action":"attack_camp","qualifier":"enemy"}]

SIMPLE MOVEMENT (no workflow):
"attack nearest camp" → targetType: "nearest_camp", qualifier: "nearest"
"attack nexus" → targetType: "nexus"
"retreat" → targetType: "retreat"

═══ STRATEGIC REASONING ═══
Before choosing a workflow, think:
1. What does the player want? (produce, gather, fight, defend, bootstrap?)
2. Do they own the required camp? If not → include attack_camp FIRST.
3. What resource? (carrots→T1, meat→T2-T3, crystals→T4-T5)
4. For meat/crystals → include "hunt" BEFORE "seek_resource" (those come from kills).
5. For carrots → just "seek_resource" (they spawn naturally).
6. Best unit for the job? (gnomes=fast gather, turtles=10x haul, skulls=self-sustain hunters)
7. Design the workflow as a LOOP that makes sense repeated forever.

═══ YOUR JOB ═══
Interpret the player's voice command using your deep understanding of the economy and unit traits.
- Adapt to current game state — if they lack a camp, capture it first
- "bootstrap X" → use the bootstrap sequence for unit type X
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
  "narration": "<One dramatic sentence>"
}`;

  const body = JSON.stringify({
    contents: [{ parts: [{ text: prompt }] }],
    generationConfig: {
      maxOutputTokens: 512,
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
}

type ResourceType = 'carrot' | 'meat' | 'crystal';

interface HGroundItem {
  id: number;
  type: ResourceType;
  x: number;
  y: number;
  sprite: Phaser.GameObjects.Text | null;
  dead: boolean;
  age: number; // ms since spawn, for despawn
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
  | { action: 'attack_enemies' };                             // seek and fight nearest enemy player units

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
  prevSpriteX: number;
  prevSpriteY: number;
  // Special mechanic flags
  hasRebirth: boolean;   // skull: cheats death once (survives at 1 HP)
  diveReady: boolean;    // (unused, kept for interface compat)
  diveTimer: number;     // (unused, kept for interface compat)
  // Resource economy
  carrying: ResourceType | null;
  carrySprite: Phaser.GameObjects.Text | null;
  loop: HWorkflow | null;
  isElite: boolean; // golden elite prey — drops crystals
  idleTimer: number; // ms spent idle — restarts loop after 4s
  claimItemId: number; // id of ground item this unit is pathing to (-1 = none)
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
  gnome:     { type: 'gnome',     emoji: '🧝', hp: 15,    attack: 3,    speed: 210, tier: 1, ability: 'Nimble Hands', desc: '2x pickup range, fastest gatherer' },
  turtle:    { type: 'turtle',    emoji: '🐢', hp: 65,    attack: 3,    speed: 55,  tier: 1, ability: 'Shell Stance', desc: '60% DR when guarding (stationary)' },
  skull:     { type: 'skull',     emoji: '💀', hp: 80,    attack: 14,   speed: 155, tier: 2, ability: 'Undying',      desc: 'Cheats death once (survives at 1 HP)' },
  spider:    { type: 'spider',    emoji: '🕷️', hp: 120,   attack: 18,   speed: 85,  tier: 2, ability: 'Venom Bite',   desc: '+5% target max HP per hit' },
  gnoll:     { type: 'gnoll',     emoji: '🐺', hp: 55,    attack: 28,   speed: 175, tier: 2, ability: 'Bone Toss',    desc: 'Extended range (120 vs 80)' },
  panda:     { type: 'panda',     emoji: '🐼', hp: 900,   attack: 35,   speed: 80,  tier: 3, ability: 'Thick Hide',   desc: 'Regenerates 1% max HP/sec' },
  lizard:    { type: 'lizard',    emoji: '🦎', hp: 450,   attack: 70,   speed: 110, tier: 3, ability: 'Cold Blood',   desc: '3x dmg to targets below 40% HP' },
  minotaur:  { type: 'minotaur',  emoji: '🐂', hp: 2200,  attack: 110,  speed: 120, tier: 4, ability: 'War Cry',      desc: 'Nearby allies +25% attack' },
  shaman:    { type: 'shaman',    emoji: '🔮', hp: 1400,  attack: 180,  speed: 100, tier: 4, ability: 'Arcane Blast', desc: 'All attacks splash 60px' },
  troll:     { type: 'troll',     emoji: '👹', hp: 14000, attack: 350,  speed: 50,  tier: 5, ability: 'Club Slam',    desc: 'Massive 90px splash, slows enemies' },
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
    gnome: 1, turtle: 1, skull: 1, spider: 1, gnoll: 1,
    panda: 1, lizard: 1, minotaur: 1, shaman: 1, troll: 1,
  };
  const SPAWN_MS: Record<string, number> = {
    gnome: 4000, turtle: 4500, skull: 6000, spider: 6000, gnoll: 5500,
    panda: 7500, lizard: 7500, minotaur: 10000, shaman: 10000, troll: 15000,
  };

  const cx = WORLD_W / 2, cy = WORLD_H / 2;
  const mirror = (x: number, y: number): [number, number] => [cx + (cx - x), cy + (cy - y)];

  let idx = 0;

  // ─── ONE CAMP PER UNIT TYPE PER SIDE (mirrored) ───
  // Layout: T1 near base, T2 mid, T3 far mid, T4 deep contested
  // Each unit type gets exactly 1 camp on each side = 18 camps (9 pairs)
  const campLayout: { type: string; distFromBase: number; angleOffset: number }[] = [
    // T1 — close to base
    { type: 'gnome',  distFromBase: 400,  angleOffset: -0.4 },
    { type: 'turtle', distFromBase: 450,  angleOffset: 0.4 },
    // T2 — mid range
    { type: 'skull',  distFromBase: 800,  angleOffset: -0.6 },
    { type: 'spider', distFromBase: 850,  angleOffset: 0.0 },
    { type: 'gnoll',  distFromBase: 900,  angleOffset: 0.6 },
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
const NEXUS_MAX_HP = 50000;
const MAX_UNITS = 80;
const BASE_SPAWN_MS = 5000;
const ATTACK_CD_MS = 1500;
const COMBAT_RANGE = 80;
const CAMP_RANGE = 120;
const AI_TICK_MS = 4000;
const TEAM_COLORS = { 1: 0x4499FF, 2: 0xFF5555 };
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
};
const RESOURCE_EMOJI: Record<ResourceType, string> = { carrot: '🥕', meat: '🍖', crystal: '💎' };
const CARROT_SPAWN_MS = 5000;       // new carrots every 5s
const MAX_GROUND_ITEMS = 150;
const ITEM_DESPAWN_MS = 90000;      // ground items vanish after 90s
const PICKUP_RANGE = 35;
const WILD_ANIMAL_COUNT = 30;       // neutral roaming animals — concentrated in corners
const ELITE_PREY_COUNT = 3;         // golden elite prey (T4 stats, drop crystals)
const WILD_RESPAWN_MS = 20000;      // respawn wild animals every 20s

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
  private baseStockpile = {
    1: { carrot: 0, meat: 0, crystal: 0 },
    2: { carrot: 0, meat: 0, crystal: 0 },
  };

  private hudTexts: Record<string, Phaser.GameObjects.Text> = {};
  private textInput: HTMLInputElement | null = null;
  private voiceStatusEl: HTMLDivElement | null = null;
  private transcriptEl: HTMLSpanElement | null = null;

  private wasdKeys!: Record<string, Phaser.Input.Keyboard.Key>;
  private spaceKey!: Phaser.Input.Keyboard.Key;
  private recognition: any = null;
  private isListening = false;

  private isDragging = false;
  private dragPrevX = 0;
  private dragPrevY = 0;

  // Persistent rally points: key = "type_team", value = {x, y}
  // When you command "gnomes attack skull camp", ALL future gnomes also go there
  private rallyPoints: Record<string, { x: number; y: number }> = {};
  // Active workflow per group — new spawns inherit this automatically
  private groupWorkflows: Record<string, HWorkflow> = {};
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
    this.selectedArmy = 'all';
    this.groundItems = [];
    this.nextItemId = 0;
    this.carrotSpawnTimer = 0;
    this.wildRespawnTimer = 0;
    this.baseStockpile = {
      1: { carrot: 0, meat: 0, crystal: 0 },
      2: { carrot: 0, meat: 0, crystal: 0 },
    };

    this.syncTimer = 0;

    this.cameras.main.setBackgroundColor('#1a1a2e');
    this.drawBackground();
    this.setupCamps();
    this.setupNexuses();
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
      this.spawnWildAnimals();
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

  // ─── CAMPS ───────────────────────────────────────────────────

  private setupCamps() {
    for (const def of CAMP_DEFS) {
      const animalDef = ANIMALS[def.type];

      const area = this.add.circle(def.x, def.y, CAMP_RANGE, 0xFFD93D, 0.06);
      area.setStrokeStyle(2, 0xFFD93D, 0.25);

      const label = this.add.text(def.x, def.y - 55, def.name, {
        fontSize: '18px', color: '#FFD93D', fontFamily: '"Nunito", sans-serif', fontStyle: 'bold',
        stroke: '#000000', strokeThickness: 4,
      }).setOrigin(0.5).setDepth(5);

      const captureBar = this.add.graphics().setDepth(6);

      const camp: HCamp = {
        id: def.id, name: def.name, animalType: def.type, tier: animalDef.tier,
        guardCount: def.guards,
        x: def.x, y: def.y, owner: 0,
        spawnMs: def.spawnMs, spawnTimer: 0, buff: def.buff,
        label, area, captureBar, storedFood: 0,
      };
      this.camps.push(camp);

      // Spawn real neutral defender units around the camp (host/solo only; guest gets via sync)
      if (!this.isOnline || this.isHost) {
        this.spawnCampDefenders(camp);
      }
    }
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
        carrying: null, carrySprite: null, loop: null, isElite: false, idleTimer: 0, claimItemId: -1,
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
        this.dragPrevX = ptr.x;
        this.dragPrevY = ptr.y;
      }
    });
    this.input.on('pointermove', (ptr: Phaser.Input.Pointer) => {
      if (!this.isDragging) return;
      const dx = ptr.x - this.dragPrevX;
      const dy = ptr.y - this.dragPrevY;
      cam.scrollX -= dx / cam.zoom;
      cam.scrollY -= dy / cam.zoom;
      this.dragPrevX = ptr.x;
      this.dragPrevY = ptr.y;
    });
    this.input.on('pointerup', () => { this.isDragging = false; });
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

    // Left panel background
    this.add.rectangle(0, 0, 260, cam.height, 0x000000, 0.45)
      .setOrigin(0, 0).setScrollFactor(0).setDepth(99);

    this.hudTexts['title'] = this.add.text(16, 12, 'HORDE CAPTURE', {
      fontSize: '18px', color: '#45E6B0', fontFamily: '"Fredoka", sans-serif', fontStyle: 'bold',
    }).setScrollFactor(0).setDepth(100);

    this.hudTexts['timer'] = this.add.text(130, 14, '0:00', {
      fontSize: '14px', color: '#FFD93D', fontFamily: '"Fredoka", sans-serif', fontStyle: 'bold',
    }).setOrigin(0, 0).setScrollFactor(0).setDepth(100);

    // Army section
    this.hudTexts['armyHeader'] = this.add.text(16, 44, 'YOUR ARMIES', {
      fontSize: '13px', color: '#4499FF', fontFamily: '"Fredoka", sans-serif', fontStyle: 'bold',
      letterSpacing: 1,
    }).setScrollFactor(0).setDepth(100);

    this.hudTexts['armies'] = this.add.text(16, 64, '', {
      fontSize: '12px', color: '#f0e8ff', fontFamily: '"Nunito", sans-serif', fontStyle: 'bold', lineSpacing: 5,
    }).setScrollFactor(0).setDepth(100);

    // Resources section
    this.hudTexts['resHeader'] = this.add.text(16, 195, 'RESOURCES', {
      fontSize: '13px', color: '#45E6B0', fontFamily: '"Fredoka", sans-serif', fontStyle: 'bold',
      letterSpacing: 1,
    }).setScrollFactor(0).setDepth(100);

    this.hudTexts['resources'] = this.add.text(16, 215, '', {
      fontSize: '12px', color: '#f0e8ff', fontFamily: '"Nunito", sans-serif', fontStyle: 'bold', lineSpacing: 3,
    }).setScrollFactor(0).setDepth(100);

    // Production section
    this.hudTexts['prodHeader'] = this.add.text(16, 265, 'PRODUCTION', {
      fontSize: '13px', color: '#C98FFF', fontFamily: '"Fredoka", sans-serif', fontStyle: 'bold',
      letterSpacing: 1,
    }).setScrollFactor(0).setDepth(100);

    this.hudTexts['production'] = this.add.text(16, 285, '', {
      fontSize: '12px', color: '#cbb8ee', fontFamily: '"Nunito", sans-serif', fontStyle: '600', lineSpacing: 4,
    }).setScrollFactor(0).setDepth(100);

    // Camps section
    this.hudTexts['campsHeader'] = this.add.text(16, 385, 'CAMPS', {
      fontSize: '13px', color: '#FFD93D', fontFamily: '"Fredoka", sans-serif', fontStyle: 'bold',
      letterSpacing: 1,
    }).setScrollFactor(0).setDepth(100);

    this.hudTexts['camps'] = this.add.text(16, 405, '', {
      fontSize: '11px', color: '#f0e8ff', fontFamily: '"Nunito", sans-serif', fontStyle: '600', lineSpacing: 3,
    }).setScrollFactor(0).setDepth(100);

    // Buffs
    this.hudTexts['buffs'] = this.add.text(16, cam.height - 80, '', {
      fontSize: '11px', color: '#C98FFF', fontFamily: '"Nunito", sans-serif', fontStyle: '600', lineSpacing: 2,
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
    this.hudTexts['timer']?.setText(`${Math.floor(secs / 60)}:${(secs % 60).toString().padStart(2, '0')}`);

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
    prodLines.push(`🧝 Base: 1🥕/gnome (${BASE_SPAWN_MS / 1000}s)`);
    const myCamps = this.camps.filter(c => c.owner === myT);
    for (const c of myCamps) {
      const cost = SPAWN_COSTS[c.animalType];
      if (!cost) continue;
      const emoji = ANIMALS[c.animalType]?.emoji || '';
      prodLines.push(`${emoji} ${cap(c.animalType)}: ${cost.amount}${RESOURCE_EMOJI[cost.type]} (${c.spawnMs / 1000}s)`);
    }
    this.hudTexts['production']?.setText(prodLines.join('\n'));

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
      this.drawNexusBars();
      this.updateHUD();
      return;
    }

    // Host (or solo): run full simulation
    this.gameTime += delta;
    this.updateCarrotSpawning(delta);
    this.updateWildAnimals(delta);
    this.updateWorkflows();
    this.updateResourcePickup();
    this.updateDeliveries();
    this.updateMovement(dt);
    this.updateCombat(delta);
    this.updateCampCapture();
    this.updateSweeps();
    // Only run AI when solo (not online PvP)
    if (!this.isOnline) this.updateAI(delta);
    this.cleanupDead();
    this.updateGroundItems(delta);
    this.updateUnitSprites();
    this.updateCampVisuals();
    this.drawNexusBars();
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

  /** No auto-spawning. Units spawn instantly when food is delivered via gather loops.
   *  Called from updateDeliveries() when a resource is dropped off. */
  private trySpawnFromDelivery(team: 1 | 2, location: 'base' | string) {
    if (this.units.filter(u => u.team === team && !u.dead).length >= MAX_UNITS) return;
    if (location === 'base') {
      // Base spawns gnomes from carrots
      const stock = this.baseStockpile[team];
      if (stock.carrot >= SPAWN_COSTS['gnome'].amount) {
        stock.carrot -= SPAWN_COSTS['gnome'].amount;
        const b = team === 1 ? P1_BASE : P2_BASE;
        this.spawnUnit('gnome', team, b.x + (team === 1 ? 60 : -60), b.y + (team === 1 ? -30 : 30));
      }
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

      const dx = u.targetX - u.x, dy = u.targetY - u.y;
      const d = Math.sqrt(dx * dx + dy * dy);
      if (d < 5) continue;

      const buffMult = u.team !== 0 ? (1 + this.getBuffs(u.team as 1 | 2).speed) : 1;
      const spd = u.speed * buffMult;
      const finalSpeed = spd * dt;
      const step = Math.min(finalSpeed, d);
      u.x += (dx / d) * step;
      u.y += (dy / d) * step;

      // Clamp to world bounds
      u.x = Math.max(0, Math.min(WORLD_W, u.x));
      u.y = Math.max(0, Math.min(WORLD_H, u.y));
    }
  }

  // ─── COMBAT ──────────────────────────────────────────────────

  private updateCombat(delta: number) {
    for (const u of this.units) {
      if (u.dead) continue;

      // Drop food and fight if enemy is nearby
      if (u.carrying && u.team !== 0) {
        const combatRange = u.type === 'gnoll' ? 120 : COMBAT_RANGE;
        const enemyNear = this.units.some(o => !o.dead && o.team !== u.team && o.team !== 0 && pdist(u, o) <= combatRange + 30);
        if (enemyNear) {
          // Drop carried resource on the ground and engage
          this.spawnGroundItem(u.carrying, u.x, u.y);
          u.carrying = null;
          if (u.carrySprite) { u.carrySprite.destroy(); u.carrySprite = null; }
          // Reset workflow to seeking phase so they re-pick after combat
          if (u.loop) {
            const step = u.loop.steps[u.loop.currentStep];
            if (step?.action === 'deliver') {
              // Go back to seek step
              u.loop.currentStep = (u.loop.currentStep - 1 + u.loop.steps.length) % u.loop.steps.length;
            }
          }
        } else {
          continue; // No enemies — keep carrying, skip combat
        }
      }

      // PANDA "Thick Hide": regenerate 1% max HP per second
      if (u.type === 'panda' && u.hp < u.maxHp) {
        u.hp = Math.min(u.maxHp, u.hp + u.maxHp * 0.01 * (delta / 1000));
      }

      u.attackTimer -= delta;

      if (u.attackTimer > 0) continue;

      // Find closest enemy: team 0 attacks anyone, team 1/2 attack each other AND team 0
      // GNOLL "Bone Toss": extended combat range (120 vs 80)
      const unitCombatRange = u.type === 'gnoll' ? 120 : COMBAT_RANGE;
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
        u.attackTimer = ATTACK_CD_MS;

        // Cute lunge toward target + attack animation
        const ldx = best.x - u.x, ldy = best.y - u.y;
        const ld = Math.sqrt(ldx * ldx + ldy * ldy) || 1;
        const lungeAmt = Math.min(20, ld * 0.4);
        u.lungeX = (ldx / ld) * lungeAmt;
        u.lungeY = (ldy / ld) * lungeAmt;
        this.tweens.add({
          targets: u, lungeX: 0, lungeY: 0,
          duration: 200, ease: 'Back.easeIn',
        });
        // Play attack animation
        if (u.sprite && u.animState !== 'attack' && HORDE_SPRITE_CONFIGS[u.type]) {
          u.animState = 'attack';
          u.sprite.play(`h_${u.type}_attack`);
        }
      } else if (nex && nexD <= COMBAT_RANGE && u.team !== 0) {
        nex.hp -= u.attack * (1 + this.getBuffs(u.team as 1 | 2).attack);
        u.attackTimer = ATTACK_CD_MS;

        // Lunge toward nexus + attack animation
        const ldx = nex.x - u.x, ldy = nex.y - u.y;
        const ld = Math.sqrt(ldx * ldx + ldy * ldy) || 1;
        const lungeAmt = Math.min(20, ld * 0.4);
        u.lungeX = (ldx / ld) * lungeAmt;
        u.lungeY = (ldy / ld) * lungeAmt;
        this.tweens.add({
          targets: u, lungeX: 0, lungeY: 0,
          duration: 200, ease: 'Back.easeIn',
        });
        // Play attack animation
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
      const dispX = u.x + Math.cos(a) * r + (u.lungeX || 0);
      const dispY = u.y + Math.sin(a) * r + (u.lungeY || 0);
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

      // Face direction: use target direction for reliable flipping
      const headingX = u.targetX - u.x;
      if (Math.abs(headingX) > 2) {
        u.sprite.setFlipX(headingX < 0);
      }

      if (u.animState !== 'attack') {
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
            fontSize: '12px',
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

  private updateCampVisuals() {
    for (const c of this.camps) {
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
    // Spawn carrots randomly across the entire map
    const MARGIN = 100;
    for (let i = 0; i < 2; i++) {
      const x = MARGIN + Math.random() * (WORLD_W - MARGIN * 2);
      const y = MARGIN + Math.random() * (WORLD_H - MARGIN * 2);
      this.spawnGroundItem('carrot', x, y);
    }
  }

  private updateGroundItems(delta: number) {
    for (const item of this.groundItems) {
      if (item.dead) continue;
      item.age += delta;
      if (item.age >= ITEM_DESPAWN_MS) { item.dead = true; continue; }
      if (!item.sprite) {
        item.sprite = this.add.text(item.x, item.y, RESOURCE_EMOJI[item.type], {
          fontSize: '16px',
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
      // Gnome Nimble Hands: 2x pickup range — born to gather
      const range = u.type === 'gnome' ? PICKUP_RANGE * 2 : PICKUP_RANGE;
      for (const item of this.groundItems) {
        if (item.dead) continue;
        if (pdist(u, item) < range) {
          u.carrying = item.type;
          u.claimItemId = -1; // release claim
          item.dead = true;
          if (item.sprite) { item.sprite.destroy(); item.sprite = null; }
          // Picked up a resource — advance workflow past seek_resource step
          if (u.loop) {
            const step = u.loop.steps[u.loop.currentStep];
            if (step?.action === 'seek_resource') this.advanceWorkflow(u);
          }
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

      // Deliver to owned camp that needs this resource type
      for (const camp of this.camps) {
        if (camp.owner !== team) continue;
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

    for (const u of this.units) {
      if (u.dead || u.team === 0) continue;

      // Units with a loop that are idle for 4s → restart their loop from step 0
      if (u.loop) {
        const distToTarget = Math.sqrt((u.targetX - u.x) ** 2 + (u.targetY - u.y) ** 2);
        const isIdle = distToTarget < 10 && !u.carrying && u.animState !== 'attack';
        if (isIdle) {
          u.idleTimer += dt;
          if (u.idleTimer >= 4000) {
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
          // Check if current claim is still valid
          if (u.claimItemId >= 0) {
            const claimed = this.groundItems.find(i => i.id === u.claimItemId);
            if (claimed && !claimed.dead) {
              // Still valid — keep pathing to it
              u.targetX = claimed.x; u.targetY = claimed.y;
              break;
            }
            u.claimItemId = -1; // item gone, find new one
          }
          // Find nearest unclaimed ground item of the right type
          let best: HGroundItem | null = null, bestD = Infinity;
          for (const item of this.groundItems) {
            if (item.dead || item.type !== step.resourceType) continue;
            if (claimedItems.has(item.id)) continue;
            const d = pdist(u, item);
            if (d < bestD) { bestD = d; best = item; }
          }
          if (best) {
            u.claimItemId = best.id;
            claimedItems.add(best.id);
            u.targetX = best.x; u.targetY = best.y;
          } else {
            // Nothing available — wait near base
            if (pdist(u, base) > 200) { u.targetX = base.x; u.targetY = base.y; }
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
            // Target camp not owned — go capture the nearest one of that type
            const nearestMatch = step.target.match(/^nearest_(\w+)_camp$/);
            if (nearestMatch) {
              const animalType = nearestMatch[1];
              const unowned = this.camps
                .filter(c => c.animalType === animalType && c.owner !== team)
                .sort((a, b) => pdist(a, base) - pdist(b, base));
              if (unowned.length > 0) {
                // Drop food, go capture, workflow will re-seek after
                this.spawnGroundItem(u.carrying, u.x, u.y);
                u.carrying = null;
                if (u.carrySprite) { u.carrySprite.destroy(); u.carrySprite = null; }
                u.targetX = unowned[0].x; u.targetY = unowned[0].y;
                break;
              }
            }
            // Last fallback: deliver to base
            u.targetX = base.x; u.targetY = base.y;
          }
          break;
        }

        case 'hunt': {
          // Find nearest wild animal to attack
          const prey = this.units
            .filter(w => w.team === 0 && !w.dead && !w.campId
              && (!step.targetType || w.type === step.targetType))
            .sort((a, b) => pdist(u, a) - pdist(u, b));
          if (prey.length > 0) {
            u.targetX = prey[0].x; u.targetY = prey[0].y;
          }
          // If we picked up a resource from a kill, advance
          if (u.carrying) this.advanceWorkflow(u);
          break;
        }

        case 'attack_camp': {
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
            // If captured, advance
            if (targetCamp.owner === team) this.advanceWorkflow(u);
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
    const MARGIN = 120;
    const CORNER_SIZE = 800; // corner zone size
    // 4 corners of the map (top-left, top-right, bottom-left, bottom-right)
    const corners = [
      { x: MARGIN, y: MARGIN },                         // top-left
      { x: WORLD_W - MARGIN, y: MARGIN },                // top-right
      { x: MARGIN, y: WORLD_H - MARGIN },                // bottom-left (near P1)
      { x: WORLD_W - MARGIN, y: WORLD_H - MARGIN },      // bottom-right
    ];
    for (let attempt = 0; attempt < 50; attempt++) {
      // 80% chance corner, 20% chance edge
      let x: number, y: number;
      if (Math.random() < 0.8) {
        // Pick a random corner and scatter within CORNER_SIZE
        const c = corners[Math.floor(Math.random() * corners.length)];
        x = c.x + (Math.random() - 0.5) * CORNER_SIZE;
        y = c.y + (Math.random() - 0.5) * CORNER_SIZE;
      } else {
        // Edge band fallback
        const edge = Math.floor(Math.random() * 4);
        if (edge === 0) { x = MARGIN + Math.random() * (WORLD_W - MARGIN * 2); y = MARGIN + Math.random() * 400; }
        else if (edge === 1) { x = MARGIN + Math.random() * (WORLD_W - MARGIN * 2); y = WORLD_H - MARGIN - Math.random() * 400; }
        else if (edge === 2) { x = MARGIN + Math.random() * 400; y = MARGIN + Math.random() * (WORLD_H - MARGIN * 2); }
        else { x = WORLD_W - MARGIN - Math.random() * 400; y = MARGIN + Math.random() * (WORLD_H - MARGIN * 2); }
      }
      x = Math.max(MARGIN, Math.min(WORLD_W - MARGIN, x));
      y = Math.max(MARGIN, Math.min(WORLD_H - MARGIN, y));
      if (pdist({ x, y }, P1_BASE) > 500 && pdist({ x, y }, P2_BASE) > 500) return { x, y };
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
        hasRebirth: false, diveReady: false, diveTimer: 0,
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
        hasRebirth: false, diveReady: false, diveTimer: 0,
        carrying: null, carrySprite: null, loop: null, isElite: true, idleTimer: 0, claimItemId: -1,
      });
    }
  }

  private updateWildAnimals(delta: number) {
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
          hasRebirth: false, diveReady: false, diveTimer: 0,
          carrying: null, carrySprite: null, loop: null, isElite: false, idleTimer: 0, claimItemId: -1,
        });
      }
      if (elites.length < ELITE_PREY_COUNT) {
        let x: number, y: number;
        do { x = WORLD_W * 0.2 + Math.random() * (WORLD_W * 0.6); y = WORLD_H * 0.2 + Math.random() * (WORLD_H * 0.6);
        } while (pdist({ x, y }, P1_BASE) < 600 || pdist({ x, y }, P2_BASE) < 600);
        this.units.push({
          id: this.nextId++, type: 'minotaur', team: 0,
          hp: 2000, maxHp: 2000, attack: 150, speed: 90,
          x, y, targetX: x + Math.random() * 80 - 40, targetY: y + Math.random() * 80 - 40,
          attackTimer: 0, sprite: null, dead: false, animState: 'idle' as const, prevSpriteX: 0, prevSpriteY: 0,
          campId: null, lungeX: 0, lungeY: 0,
          hasRebirth: false, diveReady: false, diveTimer: 0,
          carrying: null, carrySprite: null, loop: null, isElite: true, idleTimer: 0, claimItemId: -1,
        });
      }
    }
    // Wander wild animals — stay on outskirts, away from center AND player bases
    const cx = WORLD_W / 2, cy = WORLD_H / 2;
    const BASE_AVOID = 600; // wild animals stay this far from player bases
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
      carrying: null, carrySprite: null,
      // Inherit active group workflow so new spawns auto-join the loop
      loop: this.groupWorkflows[`${type}_${team}`]
        ? { ...this.groupWorkflows[`${type}_${team}`], currentStep: 0 }
        : null,
      isElite: false,
      idleTimer: 0,
      claimItemId: -1,
    });
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
          default:
            return { action: 'seek_resource' as const, resourceType: 'carrot' as ResourceType };
        }
      });

      const workflow: HWorkflow = { steps, currentStep: 0, label: cmd.narration || 'Custom workflow' };
      for (const u of sel) { u.loop = { ...workflow, currentStep: 0 }; }

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

    // "make [animal]" commands — set up gather loop for that animal's resource
    const makeMatch = lo.match(/\b(?:make|produce|spawn|create|breed|train)\s+(?:more\s+)?(\w+)/i);
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

          const deliverTo = `nearest_${animal}_camp`;
          const wf = makeGatherWorkflow(cost.type, deliverTo);
          for (const u of sel) { u.loop = { ...wf, currentStep: 0 }; }
          // Store as group workflow for future spawns
          if (subject === 'all') {
            const types = new Set(sel.map(u => u.type));
            for (const t of types) this.groupWorkflows[`${t}_${team}`] = wf;
          } else {
            this.groupWorkflows[`${subject}_${team}`] = wf;
          }
          const emoji = ANIMALS[animal]?.emoji || '';
          this.showFeedback(`${sel.length} units: ${RESOURCE_EMOJI[cost.type]} → ${emoji} ${cap(animal)} camp`, '#45E6B0');
          return;
        }
      }
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

  private showFeedback(msg: string, color: string) {
    const t = this.hudTexts['feedback'];
    if (!t) return;
    t.setText(msg).setColor(color).setAlpha(1);
    this.tweens.add({ targets: t, alpha: 0, duration: 3000, delay: 1000 });
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

      const bg = isActive ? 'rgba(69,230,176,0.25)' : 'rgba(13,26,13,0.8)';
      const border = isActive ? '#45E6B0' : '#3D5040';
      const borderW = isActive ? '3px' : '1px';
      const glow = isActive ? 'box-shadow:0 0 12px rgba(69,230,176,0.4);' : '';
      const scale = isActive ? 'transform:scale(1.1);' : '';

      html += `<div style="
        background:${bg};border:${borderW} solid ${border};border-radius:10px;
        padding:4px 10px;text-align:center;min-width:52px;
        ${glow}${scale}transition:all 0.15s ease;
      ">
        <div style="font-size:22px;line-height:1.1;">${emoji}</div>
        <div style="font-size:9px;color:${isActive ? '#45E6B0' : '#8BAA8B'};font-weight:800;letter-spacing:0.5px;">${name}</div>
        <div style="font-size:11px;color:#f0e8ff;font-weight:700;">${count}</div>
        ${tier ? `<div style="font-size:8px;color:#666;font-weight:600;">${tier}</div>` : ''}
        ${army !== 'all' && ANIMALS[army] ? `<div style="font-size:7px;color:#C98FFF;font-weight:600;white-space:nowrap;">${ANIMALS[army].ability}</div>` : ''}
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

  // ─── CLEANUP ────────────────────────────────────────────────

  private cleanupHTML() {
    this.textInput?.remove(); this.textInput = null;
    this.voiceStatusEl?.remove(); this.voiceStatusEl = null;
    this.selectionLabel = null;
    this.armyBarEl?.remove(); this.armyBarEl = null;
    try { this.recognition?.abort(); } catch (_e) { /* */ }
    if (this.firebase) { this.firebase.cleanup(); this.firebase = null; }
  }
}
