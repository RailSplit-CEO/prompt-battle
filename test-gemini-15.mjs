const API_KEY = 'AIzaSyAPNAqL9dQgNUW_zGXnN3gpmNQyRMtoX9A';
const URL = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${API_KEY}`;

// Late-game state: multiple camp types owned, some enemy, resources available
const buildPrompt = (rawText) => {
  const gameTime = 420;
  const selectedArmy = 'all';
  const unitList = `  gnome (T1): 12 units (6 gathering)
  turtle (T1): 5 units (3 gathering)
  skull (T2): 8 units
  spider (T2): 4 units
  panda (T3): 3 units`;
  const campList = `  [0] Bouncy Burrow (gnome, T1) - MINE - dist:200 - defenders:0
  [1] Shell Haven (turtle, T1) - MINE - dist:350 - defenders:0
  [2] Wailing Crypt (skull, T2) - MINE - food:2/3 - dist:500 - defenders:0
  [3] Stinger Nest (spider, T2) - MINE - dist:650 - defenders:0
  [4] Wolf Den (gnoll, T2) - neutral - dist:800 - defenders:4
  [5] Bamboo Grove (panda, T3) - MINE - dist:900 - defenders:0
  [6] Lizard Pit (lizard, T3) - neutral - dist:1200 - defenders:5
  [7] Horned Arena (minotaur, T4) - neutral - dist:1500 - defenders:6
  [8] Spirit Shrine (shaman, T4) - ENEMY - dist:1600 - defenders:0
  [9] Troll Bridge (troll, T5) - neutral - dist:2000 - defenders:8`;

  // Using the EXACT prompt from HordeScene.ts lines 69-366 with substitutions
  return `You are the AI commander for a voice-controlled RTS game called "Horde Capture." The player speaks commands and you interpret them into game actions. You deeply understand the game's economy and must reason about what the player wants.

═══ GAME ECONOMY ═══
Resources: 🥕 Carrots (spawn on ground everywhere), 🍖 Meat (drops from killed wild animals), 💎 Crystals (drops from elite prey), ⚙️ Metal (mined from mine nodes on the map)

SPAWN COSTS — each unit type requires a specific resource delivered to its camp:
  Tier 1: gnome (🧝) = 1 carrot, turtle (🐢) = 1 carrot
  Tier 2: skull (💀) = 3 meat, spider (🕷️) = 3 meat, gnoll (🐺) = 3 meat
  Tier 3: panda (🐼) = 5 meat, lizard (🦎) = 5 meat
  Tier 4: minotaur (🐂) = 8 crystals, shaman (🔮) = 8 crystals
  Tier 5: troll (👹) = 12 crystals

HOW SPAWNING WORKS: Units gather a resource → carry it to a camp of the desired type → camp uses it to spawn that unit type. Base stores resources but does NOT spawn units — only camps spawn units.

To produce a unit, you MUST own a camp of that type. Camps start neutral with defenders — kill the defenders to capture.

ARMORY: 🏛️ Each team has an Armory building. Players unlock equipment with resources, then units walk to the Armory to pick items up.

EQUIPMENT (unlock once, unlimited pickups):
  ⛏️ Pickaxe (5🥕), ⚔️ Sword (5🍖+3⚙️), 🛡️ Shield (5🍖+3⚙️), 👢 Boots (5🥕+2⚙️), 🚩 Banner (8🍖+5⚙️)

To equip: include {"action":"equip","equipmentType":"..."} step BEFORE other steps.

═══ CURRENT GAME STATE ═══
Time: ${gameTime}s
Selected army: ${selectedArmy}

MY UNITS:
${unitList}

MY RESOURCES: 🥕25 🍖18 💎3

CAMPS (sorted by distance):
${campList}

NEXUS HP: mine=42000/50000, enemy=50000/50000

Ground items nearby: 🥕22 carrots, 🍖14 meat, 💎2 crystals on the map

═══ BEHAVIOR MODIFIERS ═══
Modifiers change HOW units execute (not WHAT they do). They persist until changed.
FORMATION: "spread" | "tight" | null
CAUTION: "safe" | "aggressive" | null
PACING: "rush" | "efficient" | null

═══ ACTIONS ═══
Simple movement: camp, nearest_camp, sweep_camps, nexus, base/defend/retreat
QUALIFIERS: nearest, furthest, weakest, uncaptured, enemy

═══ WORKFLOWS ═══
Available step types:
  {"action": "seek_resource", "resourceType": "carrot|meat|crystal"}
  {"action": "deliver", "target": "base|nearest_TYPE_camp"}
  {"action": "hunt", "targetType": "skull|spider|..."}
  {"action": "attack_camp", "targetAnimal": "gnome|skull|...", "qualifier": "nearest"}
  {"action": "move", "x": 1000, "y": 1000}
  {"action": "defend", "target": "base|nearest_TYPE_camp"} — ALWAYS include target! "defend panda camp" → target:"nearest_panda_camp"
  {"action": "attack_enemies"}
  {"action": "scout", "x": 500, "y": 500} — optional x,y for region bias
  {"action": "collect", "resourceType": "carrot|meat|crystal"}
  {"action": "kill_only", "targetType": "skull|spider|..."}
  {"action": "mine"}
  {"action": "equip", "equipmentType": "pickaxe|sword|shield|boots|banner"}

═══ TASK CHAINING (loopFrom) ═══
Use "loopFrom" to mark where the repeating loop starts. Steps before loopFrom run once; steps from loopFrom onward loop forever.
loopFrom=0 (default) means everything loops. loopFrom>0 means steps 0..loopFrom-1 are one-shot setup.

═══ BOOTSTRAP SEQUENCES ═══
CRITICAL: ALWAYS include attack_camp as FIRST step for bootstrap, even if camp is owned. It's a runtime safeguard.
"make gnomes" → [attack_camp gnome, seek_resource carrot, deliver nearest_gnome_camp], loopFrom: 0
"get skulls" → [attack_camp skull, hunt, seek_resource meat, deliver nearest_skull_camp], loopFrom: 0

═══ EXAMPLES (all workflows show loopFrom) ═══

PRODUCTION: loopFrom: 0 always
"make gnomes" → [attack_camp gnome nearest, seek_resource carrot, deliver nearest_gnome_camp], loopFrom: 0
"get skulls" → [attack_camp skull nearest, hunt, seek_resource meat, deliver nearest_skull_camp], loopFrom: 0
"safely get gnomes" → [attack_camp gnome nearest, collect carrot, deliver nearest_gnome_camp], loopFrom: 0, caution: "safe"

GATHER: loopFrom: 0
"gather carrots" → [seek_resource carrot, deliver base], loopFrom: 0
"farm meat" → [hunt, seek_resource meat, deliver base], loopFrom: 0
"aggressively farm meat" → [hunt, seek_resource meat, deliver base], loopFrom: 0, caution: "aggressive"

HUNTING & KILL-ONLY:
"hunt wilds" → [hunt], loopFrom: 0
"kill animals but don't pick anything up" → [kill_only], loopFrom: 0
"just kill spiders, ignore the drops" → [kill_only spider], loopFrom: 0
NOTE: "don't pick up"/"ignore drops"/"just kill" → use kill_only (NOT hunt). hunt = kill + auto-pickup, kill_only = kill + ignore drops.

EQUIPMENT: loopFrom: 1 (equip one-shot)
"mine metal" → [equip pickaxe, mine, deliver base], loopFrom: 1
"get swords and fight" → [equip sword, attack_enemies], loopFrom: 1
"aggressively attack with swords" → [equip sword, attack_enemies], loopFrom: 1, caution: "aggressive"

CHAINING: equip → loopFrom: 1, camp+deliver_to_camp → loopFrom: 0
"equip sword then defend base" → [equip sword, defend base], loopFrom: 1
"capture skull camp then gather meat" → [attack_camp skull, hunt, seek_resource meat, deliver nearest_skull_camp], loopFrom: 0
"get shields then safely defend" → [equip shield, defend base], loopFrom: 1, caution: "safe"

═══ loopFrom RULES ═══
- loopFrom: 0 → ALL steps loop (default)
- equip steps → loopFrom >= 1
- CRITICAL: attack_camp + deliver to CAMP → loopFrom: 0 ALWAYS
- attack_camp + deliver to BASE → loopFrom: 1 OK
- When in doubt, loopFrom: 0

═══ INTENT CLASSIFICATION ═══
C) PRODUCE/BOOTSTRAP: "get/make [ANIMAL]" → ALWAYS [attack_camp, (hunt if meat/crystal), seek_resource, deliver to camp], loopFrom: 0
   CRITICAL: ALWAYS include attack_camp first, even if camp owned. NEVER omit.
   "get skulls" = bootstrap (animal). "get a sword" = equip (equipment).
B) EQUIP + ACTION: "get [equipment] and/then [action]" → [equip, action...], loopFrom: 1
F) MINING: → [equip pickaxe, mine, deliver base], loopFrom: 1

RULES:
- Output exactly ONE command.
- ALWAYS pick the best interpretation — never refuse.
- For meat/crystals, include "hunt" before "seek_resource". For carrots, just "seek_resource".

PLAYER SAYS: "${rawText}"

JSON ONLY (no markdown):
{
  "targetType": "<camp|nearest_camp|sweep_camps|nexus|base|defend|retreat|workflow>",
  "targetAnimal": "<animal type or omit>",
  "campIndex": -1,
  "qualifier": "<nearest|furthest|weakest|uncaptured|enemy or omit>",
  "workflow": [<array of step objects, only if targetType=workflow>],
  "loopFrom": <index where repeating loop starts, default 0>,
  "narration": "<Max 5 words, terse military tone>",
  "modifiers": {"formation": "spread|tight|null", "caution": "safe|aggressive|null", "pacing": "rush|efficient|null"},
  "modifierOnly": false
}`;
};

const tests = [
  // 1. Ambiguous "get" — animal vs equipment
  { input: "get spiders", expected: { targetType: "workflow", loopFrom: 0, firstAction: "attack_camp", note: "bootstrap spider, NOT equip" },
    check: r => r.workflow?.[0]?.action === 'attack_camp' && r.loopFrom === 0 },

  // 2. Ambiguous "get" — equipment
  { input: "get a shield", expected: { loopFrom: 1, firstAction: "equip", note: "equip shield, not bootstrap" },
    check: r => r.workflow?.[0]?.action === 'equip' && r.workflow?.[0]?.equipmentType === 'shield' && r.loopFrom >= 1 },

  // 3. Multi-modifier + action
  { input: "aggressively rush to farm meat spread out", expected: { loopFrom: 0, hasHunt: true, note: "3 modifiers: aggressive + rush + spread" },
    check: r => r.loopFrom === 0 && r.workflow?.some(s => s.action === 'hunt') && r.modifiers?.caution === 'aggressive' },

  // 4. "rush the base" = attack nexus or aggressive attack toward base
  { input: "rush the base", expected: { note: "attack nexus, or aggressive attack_enemies toward base" },
    check: r => r.targetType === 'nexus' || (r.workflow?.some(s => s.action === 'attack_enemies' || s.action === 'nexus') && r.modifiers?.pacing === 'rush') },

  // 5. Chaining: equip + bootstrap (code-side safeguard forces loopFrom 0, but LLM may return 1)
  { input: "get swords then capture the gnoll camp and make gnolls", expected: { firstAction: "equip", note: "equip sword + attack_camp gnoll + gather + deliver. Code forces loopFrom 0." },
    check: r => r.workflow?.[0]?.action === 'equip' && r.workflow?.some(s => s.action === 'attack_camp') },

  // 6. Safe production with hunt step
  { input: "carefully make pandas", expected: { loopFrom: 0, caution: "safe", note: "bootstrap panda safely: attack_camp + hunt + collect + deliver" },
    check: r => r.workflow?.[0]?.action === 'attack_camp' && r.modifiers?.caution === 'safe' && r.loopFrom === 0 },

  // 7. Complex chain: capture + equip + defend
  { input: "capture the lizard camp then equip shields and defend it", expected: { note: "attack_camp lizard + equip shield + defend nearest_lizard_camp" },
    check: r => r.workflow?.[0]?.action === 'attack_camp' && r.workflow?.some(s => s.action === 'equip') && r.workflow?.some(s => s.action === 'defend') },

  // 8. "sweep" command
  { input: "sweep all the uncaptured camps", expected: { targetType: "sweep_camps", note: "sweep_camps, no workflow" },
    check: r => r.targetType === 'sweep_camps' },

  // 9. Modifier-only command
  { input: "spread out more and be careful", expected: { modifierOnly: true, note: "modifier only: spread + safe" },
    check: r => r.modifierOnly === true && r.modifiers?.formation === 'spread' && r.modifiers?.caution === 'safe' },

  // 10. Bootstrap crystal unit (minotaur needs hunt minotaur + crystal)
  { input: "make minotaurs", expected: { loopFrom: 0, note: "bootstrap: attack_camp minotaur + hunt minotaur + seek crystal + deliver" },
    check: r => r.workflow?.[0]?.action === 'attack_camp' && r.workflow?.some(s => s.action === 'hunt') && r.workflow?.some(s => s.resourceType === 'crystal' || s.action === 'seek_resource') && r.loopFrom === 0 },

  // 11. Equip + mine (should always include equip pickaxe)
  { input: "go mine some metal quickly", expected: { loopFrom: 1, firstAction: "equip", pacing: "rush", note: "equip pickaxe + mine + deliver, rush" },
    check: r => r.workflow?.[0]?.action === 'equip' && r.workflow?.[0]?.equipmentType === 'pickaxe' && r.loopFrom >= 1 },

  // 12. Defend a specific camp
  { input: "defend the panda camp", expected: { loopFrom: 0, note: "defend nearest_panda_camp" },
    check: r => r.workflow?.some(s => s.action === 'defend' && s.target?.includes('panda')) && r.loopFrom === 0 },

  // 13. Kill-only (fight but ignore drops)
  { input: "just kill all the wild animals don't pick anything up", expected: { note: "kill_only workflow" },
    check: r => r.workflow?.some(s => s.action === 'kill_only') },

  // 14. Chaining: equip boots then gather crystals (needs hunt before seek)
  { input: "equip boots then farm crystals efficiently", expected: { loopFrom: 1, firstAction: "equip", pacing: "efficient", note: "equip boots + hunt minotaur + seek crystal + deliver, efficient" },
    check: r => r.workflow?.[0]?.action === 'equip' && r.workflow?.some(s => s.action === 'hunt') && r.loopFrom >= 1 },

  // 15. Vague/creative command
  { input: "let's get this economy going, we need more units fast", expected: { loopFrom: 0, note: "should bootstrap or gather — creative interpretation" },
    check: r => r.targetType === 'workflow' && r.loopFrom === 0 && r.workflow?.length >= 2 },
];

async function callGemini(rawText) {
  const body = JSON.stringify({
    contents: [{ parts: [{ text: buildPrompt(rawText) }] }],
    generationConfig: { maxOutputTokens: 2048, responseMimeType: 'application/json', thinkingConfig: { thinkingBudget: 0 } },
  });
  const resp = await fetch(URL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body });
  if (!resp.ok) return { error: `HTTP ${resp.status}: ${(await resp.text()).slice(0,200)}` };
  const data = await resp.json();
  const finishReason = data.candidates?.[0]?.finishReason;
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) return { error: `No text in response (finish: ${finishReason})` };
  try { const p = JSON.parse(text); return Array.isArray(p) ? p[0] : p; } catch { return { error: `JSON parse failed (finish: ${finishReason}, len: ${text.length}): ${text.slice(0,500)}` }; }
}

function fmtWorkflow(r) {
  if (!r.workflow) return r.targetType || '???';
  return r.workflow.map(s => {
    let str = s.action;
    if (s.equipmentType) str += `(${s.equipmentType})`;
    if (s.targetAnimal) str += `(${s.targetAnimal})`;
    if (s.resourceType) str += `(${s.resourceType})`;
    if (s.targetType) str += `[${s.targetType}]`;
    if (s.target) str += `→${s.target}`;
    return str;
  }).join(' → ');
}

function fmtMods(r) {
  if (!r.modifiers) return '';
  const parts = [];
  if (r.modifiers.formation && r.modifiers.formation !== 'null') parts.push(`formation:${r.modifiers.formation}`);
  if (r.modifiers.caution && r.modifiers.caution !== 'null') parts.push(`caution:${r.modifiers.caution}`);
  if (r.modifiers.pacing && r.modifiers.pacing !== 'null') parts.push(`pacing:${r.modifiers.pacing}`);
  return parts.length ? ` [${parts.join(', ')}]` : '';
}

(async () => {
  console.log('=== GEMINI 15-TEST SUITE (Complex Commands) ===\n');
  let pass = 0, fail = 0;

  for (let i = 0; i < tests.length; i++) {
    const t = tests[i];
    console.log(`--- #${i+1}: "${t.input}" ---`);
    console.log(`  Expect: ${t.expected.note}`);

    const r = await callGemini(t.input);
    if (r.error) {
      console.log(`  ❌ ERROR: ${r.error}`);
      fail++;
    } else {
      const wf = fmtWorkflow(r);
      const mods = fmtMods(r);
      console.log(`  Got: [${wf}] loopFrom:${r.loopFrom ?? 'N/A'}${mods}${r.modifierOnly ? ' MODIFIER_ONLY' : ''}`);
      console.log(`  Narration: "${r.narration}"`);

      if (t.check(r)) {
        console.log(`  ✅ PASS`);
        pass++;
      } else {
        console.log(`  ❌ FAIL`);
        fail++;
      }
    }
    console.log('');
    await new Promise(resolve => setTimeout(resolve, 1500));
  }

  console.log(`\n=== RESULTS: ${pass}/${pass+fail} passed, ${fail} failed ===`);
})();
