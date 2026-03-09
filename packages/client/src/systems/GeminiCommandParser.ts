// ═══════════════════════════════════════════════════════
// ANIMAL ARMY - Gemini Command Parser
// Translates natural language voice/text commands into
// structured hero orders via the Gemini API.
// ═══════════════════════════════════════════════════════

import { Hero, HeroOrder, Camp, Structure, AnimalUnit, GameState, Position, Base } from '@prompt-battle/shared';

const GEMINI_API_KEY = (import.meta as any).env?.VITE_GEMINI_API_KEY || '';
const GEMINI_MODEL = 'gemini-3.1-flash-lite-preview';
const GEMINI_URL = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=`;

// ─── Output Types ───────────────────────────────────────

export interface ParsedGameAction {
  heroId: string;
  type: 'move' | 'attack_camp' | 'attack_structure' | 'attack_hero'
    | 'attack_base' | 'defend' | 'retreat' | 'hold';
  targetId?: string;
  targetPosition?: Position;
}

export interface GeminiParseResult {
  actions: ParsedGameAction[];
  narration: string;
}

// ─── Prompt Builder ─────────────────────────────────────

function buildAnimalArmyPrompt(
  rawText: string,
  myHeroes: Hero[],
  enemyHeroes: Hero[],
  camps: Camp[],
  structures: Structure[],
  units: AnimalUnit[],
  myBase: Base,
  enemyBase: Base,
  mapWidth: number,
  mapHeight: number,
  gameTime: number,
): string {

  // ── My heroes ──
  const myHeroList = myHeroes.map(h => {
    const armyCount = units.filter(u => u.ownerId === h.id && !u.isDead).length;
    return `  ID:"${h.id}" Name:"${h.name}" ` +
      `HP:${h.currentHp}/${h.maxHp} Pos:(${h.position.x},${h.position.y}) ` +
      `ATK:${h.attack} DEF:${h.defense} SPD:${h.speed} ` +
      `Army:${armyCount} units ` +
      `Passive:${h.passive} ` +
      `Upgrades:[${h.upgrades.join(', ') || 'none'}]` +
      `${h.isDead ? ` [DEAD - respawns in ${h.respawnTimer}s]` : ''}`;
  }).join('\n');

  // ── Enemy heroes ──
  const enemyHeroList = enemyHeroes.map(h => {
    const armyCount = units.filter(u => u.ownerId === h.id && !u.isDead).length;
    return `  ID:"${h.id}" Name:"${h.name}" ` +
      `HP:${h.currentHp}/${h.maxHp} Pos:(${h.position.x},${h.position.y}) ` +
      `Army:~${armyCount} units` +
      `${h.isDead ? ' [DEAD]' : ''}`;
  }).join('\n');

  // ── Camps ──
  const campList = camps.map(c => {
    const ownerStr = c.capturedTeam === 'player1' ? 'YOU'
      : c.capturedTeam === 'player2' ? 'ENEMY'
      : 'NEUTRAL';
    const guardsAlive = c.guards.filter(g => !g.isDead).length;
    return `  ${c.emoji} ${c.name} (id:"${c.id}"): Pos:(${c.position.x},${c.position.y}) ` +
      `Tier:${c.tier} Animal:${c.animalType} Owner:${ownerStr} ` +
      `Guards:${guardsAlive}/${c.guards.length}`;
  }).join('\n');

  // ── Structures ──
  const structureList = structures.map(s => {
    const statusStr = s.hp <= 0
      ? (s.destroyedBy === 'player1' ? '[DESTROYED by YOU]'
        : s.destroyedBy === 'player2' ? '[DESTROYED by ENEMY]'
        : '[DESTROYED]')
      : `HP:${Math.round(s.hp)}/${s.maxHp}`;
    return `  ${s.emoji} ${s.name} (id:"${s.id}"): Pos:(${s.position.x},${s.position.y}) ` +
      `${statusStr} Upgrade:${s.upgradeType} ATK:${s.attack} RNG:${s.range}`;
  }).join('\n');

  // ── Base info ──
  const baseInfo = `Your Base HP: ${Math.round(myBase.hp)}/${myBase.maxHp} at (${myBase.position.x},${myBase.position.y}) | ` +
    `Enemy Base HP: ${Math.round(enemyBase.hp)}/${enemyBase.maxHp} at (${enemyBase.position.x},${enemyBase.position.y})`;

  return `You are the AI command interpreter for "Animal Army", a real-time simplified MOBA game.
The player speaks natural language commands to control their 3 heroes on a ${mapWidth}x${mapHeight} tile map.
This is REAL-TIME: heroes continuously execute their last order until given a new one.
Game time: ${Math.floor(gameTime)}s elapsed.

YOUR HEROES:
${myHeroList}

ENEMY HEROES (visible):
${enemyHeroList}

GAME RULES:
- Each hero captures ANIMAL CAMPS to build an army of animal units that follow them.
- Destroy STRUCTURES to gain permanent upgrades for your entire team.
- DESTROY THE ENEMY BASE to win, or have more base HP when time runs out.
- ${baseInfo}
- Structures shoot back at attackers! Bring an army before attacking.
- Camps have neutral guards that must be defeated to capture.
- Captured camps periodically spawn animal units that follow the capturing hero.

ANIMAL CAMPS (capture for army units):
${campList}
- Attack a neutral camp to defeat its guards and capture it.
- Captured camps spawn units that follow the capturing hero.
- Lower tier camps are easier to capture but spawn weaker units.

STRUCTURES (destroy for team upgrades):
${structureList}
- Structures attack nearby enemies. Bring an army!
- Destroying a structure grants a permanent team-wide upgrade.
- Upgrade types: savage_strikes (+25% ATK), hardened_hides (+30% HP), mystic_missiles (melee gain ranged), rapid_reinforcements (2x spawn).

ACTION TYPES:
- "move": Move hero to a position. Requires targetPosition {x, y}.
- "attack_camp": Go fight a camp to capture it. Requires targetId (camp id). "capture Rowdy Rabbit Ranch", "take the bear camp".
- "attack_structure": Go attack a structure to destroy it for upgrades. Requires targetId (structure id). "destroy Brutal Bear Bastion", "attack the tower".
- "attack_hero": Chase and attack an enemy hero. Requires targetId (hero id). "attack their warrior", "kill Marcus".
- "attack_base": March toward and attack the enemy base. Requires targetPosition (enemy base position). "attack their base", "push the base".
- "defend": Hold position and fight anything that comes near. "defend here", "hold this position".
- "retreat": Fall back toward your own base. "retreat", "fall back", "run away".
- "hold": Stop moving and wait. "stop", "hold", "wait".

COMPLEX COMMANDS:
- Address heroes by name: "Marcus attack the bear camp, Luna go capture Rowdy Rabbit Ranch"
- "everyone" or "all" = all alive heroes: "everyone push the base"
- "focus [enemy]" = all attack that enemy hero
- Explicit coords: "move to 5,10" or "go 12 8"
- "retreat" / "fall back" / "disengage" = retreat to base
- "push" = attack_base (march toward enemy base)
- "capture [camp name]" or "take [camp name]" = attack_camp
- "destroy [structure name]" = attack_structure

RULES:
- Interpret the player's intent generously. "take the rabbits" = attack_camp for the rabbit camp. "get upgrades" = attack_structure.
- A single command can issue DIFFERENT orders to DIFFERENT heroes.
- If player names a hero by name, command THAT hero.
- "all" or "everyone" means all alive heroes.
- If ambiguous, pick the most logical hero for the task.
- NEVER ask for clarification. Always produce valid actions.
- Only include alive heroes in the actions.
- For directional moves: up=y-4, down=y+4, left=x-4, right=x+4 from hero's current position.

PLAYER COMMAND: "${rawText}"

Respond with ONLY valid JSON (no markdown, no code blocks):
{
  "actions": [
    {
      "heroId": "<exact hero ID>",
      "type": "<move|attack_camp|attack_structure|attack_hero|attack_base|defend|retreat|hold>",
      "targetId": "<camp/structure/hero ID if applicable>",
      "targetPosition": {"x": <number>, "y": <number>}
    }
  ],
  "narration": "<One dramatic sentence describing the orders, like a battle narrator>"
}`;
}

// ─── Main Parse Function ────────────────────────────────

export async function parseCommandWithGemini(
  rawText: string,
  gameState: GameState,
  playerId: string,
): Promise<GeminiParseResult> {
  const allHeroes = Object.values(gameState.heroes);
  const myHeroes = allHeroes.filter(h => h.team === playerId && !h.isDead);
  const enemyHeroes = allHeroes.filter(h => h.team !== playerId && !h.isDead);

  if (!GEMINI_API_KEY) {
    throw new Error('GEMINI_API_KEY not set. Add VITE_GEMINI_API_KEY to your .env file.');
  }

  const myBase = playerId === 'player1' ? gameState.bases.player1 : gameState.bases.player2;
  const enemyBase = playerId === 'player1' ? gameState.bases.player2 : gameState.bases.player1;

  // Use a reasonable default map size; the prompt doesn't require exact dimensions
  const mapWidth = 55;
  const mapHeight = 45;

  const prompt = buildAnimalArmyPrompt(
    rawText,
    myHeroes,
    enemyHeroes,
    gameState.camps,
    gameState.structures,
    gameState.units,
    myBase,
    enemyBase,
    mapWidth,
    mapHeight,
    gameState.meta.gameTime,
  );

  const response = await fetch(GEMINI_URL + GEMINI_API_KEY, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: {
        maxOutputTokens: 1024,
        responseMimeType: 'application/json',
      },
    }),
  });

  if (!response.ok) {
    const err = await response.text();
    console.error('Gemini API error:', err);
    throw new Error(`Gemini API error: ${response.status}`);
  }

  const data = await response.json();
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text;

  if (!text) {
    throw new Error('Empty response from Gemini');
  }

  try {
    const parsed = JSON.parse(text) as GeminiParseResult;

    // Validate: only include actions for our alive heroes
    parsed.actions = parsed.actions.filter(a => {
      const hero = gameState.heroes[a.heroId];
      return hero && hero.team === playerId && !hero.isDead;
    });

    return parsed;
  } catch {
    console.error('Failed to parse Gemini JSON:', text);
    throw new Error('Gemini returned invalid JSON');
  }
}
