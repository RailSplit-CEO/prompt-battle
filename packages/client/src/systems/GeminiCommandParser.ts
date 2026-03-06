import { Character, CLASSES, ANIMALS, Position, CTFState, ControlPoint, TileType } from '@prompt-battle/shared';

const GEMINI_API_KEY = (import.meta as any).env?.VITE_GEMINI_API_KEY || '';
const GEMINI_MODEL = 'gemini-2.0-flash';
const GEMINI_URL = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=`;

export interface ParsedGameAction {
  characterId: string;
  type: 'move' | 'attack' | 'ability' | 'defend' | 'retreat' | 'hold' | 'capture' | 'escort' | 'patrol' | 'control';
  targetCharacterId?: string;
  targetPosition?: Position;
  abilityId?: string;
  queued?: boolean;
}

export interface GeminiParseResult {
  actions: ParsedGameAction[];
  narration: string;
}

function buildPrompt(
  rawText: string,
  myChars: Character[],
  enemyChars: Character[],
  mapWidth: number,
  mapHeight: number,
  ctf: CTFState,
  controlPoints: ControlPoint[],
  tiles: TileType[][],
): string {
  const myList = myChars.map(c => {
    const cls = CLASSES[c.classId];
    const animal = ANIMALS[c.animalId];
    const ability = cls.abilities[0];
    const cd = ability ? (c.cooldowns[ability.id] || 0) : 0;
    const abilityStr = ability
      ? `ABILITY: ${ability.name}(id:${ability.id}) - ${ability.description} [range:${ability.range}, cd:${cd > 0 ? cd + 's' : 'READY'}]`
      : 'NO ABILITY';
    const flag = c.hasFlag ? ' [CARRYING FLAG]' : '';
    const terrain = tiles[c.position.y]?.[c.position.x] || 'grass';
    return `  ID:"${c.id}" Name:"${c.name}" Class:${cls.name} Animal:${animal.name} ` +
      `HP:${c.currentHp}/${c.stats.hp} Pos:(${c.position.x},${c.position.y}) Terrain:${terrain} ` +
      `ATK:${c.stats.attack} DEF:${c.stats.defense} SPD:${c.stats.speed} RNG:${c.stats.range} MAG:${c.stats.magic} ` +
      `${abilityStr}${flag}` +
      `${c.isDead ? ` [DEAD - respawns in ${c.respawnTimer ?? 0}s]` : ''}`;
  }).join('\n');

  const enemyList = enemyChars.map(c => {
    const cls = CLASSES[c.classId];
    const animal = ANIMALS[c.animalId];
    const flag = c.hasFlag ? ' [CARRYING FLAG]' : '';
    return `  ID:"${c.id}" Name:"${c.name}" Class:${cls.name} Animal:${animal.name} ` +
      `HP:${c.currentHp}/${c.stats.hp} Pos:(${c.position.x},${c.position.y})${flag}` +
      `${c.isDead ? ' [DEAD]' : ''}`;
  }).join('\n');

  const flagInfo = `
CTF STATUS:
- Your flag: Pos:(${ctf.flag1.position.x},${ctf.flag1.position.y}) ${ctf.flag1.isHome ? '[AT BASE]' : ctf.flag1.carrier ? '[STOLEN]' : '[DROPPED ON GROUND]'}
- Enemy flag: Pos:(${ctf.flag2.position.x},${ctf.flag2.position.y}) ${ctf.flag2.isHome ? '[AT ENEMY BASE]' : ctf.flag2.carrier ? '[YOU HAVE IT]' : '[DROPPED ON GROUND]'}
- Your flag home base: (${ctf.flag1.homePosition.x},${ctf.flag1.homePosition.y})
- Enemy flag home base: (${ctf.flag2.homePosition.x},${ctf.flag2.homePosition.y})
- Score: You ${ctf.score1} - ${ctf.score2} Enemy (first to ${ctf.capturesNeeded} wins)
- To CAPTURE: Pick up enemy flag and bring it to YOUR flag's home base (your flag must be home).
- To RETURN your flag: Walk over your dropped flag.`;

  return `You are the AI command interpreter for "Prompt Battle", a real-time tactical CTF (Capture the Flag) game.
The player speaks natural language commands to control their characters on a ${mapWidth}x${mapHeight} tile grid.
This is REAL-TIME: characters continuously execute their last order until given a new one. Be smart about interpretation.

YOUR CHARACTERS (you control these):
${myList}

ENEMY CHARACTERS (only visible ones shown):
${enemyList}
${flagInfo}

TERRAIN (each character's current terrain shown above):
- Water/Rock: Impassable.
- Forest: Slows movement 2x. Cover (-15% dmg taken). AMBUSH: First attack from forest = +30% bonus damage (resets when moving to new tile). Position units in forests for a strong first strike.
- Hill: +25% damage dealt. Ranged units (range >= 2) on hills get +1 range. Great for archers.
- Bush: Concealment - enemies on bush tiles are invisible unless you have a unit within 1 tile. -10% dmg taken. Use bushes for stealth positioning.
- Path: Fast movement (0.5x cost). Good for rapid repositioning.
- Water penalty: Fireball/fire abilities deal -20% damage if target is adjacent to water.
TACTICAL TIPS: Position ranged units on hills for range+damage. Use forests for ambush attacks. Hide units in bushes to surprise enemies. Avoid fire near water.

CONTROL POINTS (secondary objective - capture for team buffs):
${controlPoints.map(cp => {
  const owner = cp.owner === 'player1' ? 'YOU' : cp.owner === 'player2' ? 'ENEMY' : 'NEUTRAL';
  return `- ${cp.id}: Pos:(${cp.position.x},${cp.position.y}) Owner:${owner} Progress:${cp.captureProgress}% Buff:${cp.buff.label}`;
}).join('\n')}
- Stand within 2 tiles of a point to capture it (~5s). Contested if both teams present.

ACTION TYPES:
- "move": Move toward a position. Requires targetPosition {x, y}. Character keeps moving until arrival.
- "attack": Chase and attack an enemy. Requires targetCharacterId. Character will pursue and auto-attack in range.
- "ability": Use a specific ability. Requires abilityId and targetCharacterId.
- "defend": Hold position and fight any nearby enemies.
- "retreat": Fall back toward spawn base.
- "capture": Move toward enemy flag to pick it up. Requires targetPosition (enemy flag pos).
- "escort": Follow and protect a specific ally. Requires targetCharacterId (the flag carrier).
- "patrol": Guard an area, pacing back and forth. Requires targetPosition.
- "hold": Stop and do nothing.
- "control": Move to and hold a control point. Requires targetPosition (the control point position). Use for "take the point", "capture point", etc.

MAP PICKUPS: Health potions (green, +35% HP), Speed boosts (yellow, 12s double speed), Damage boosts (red, 12s +50% dmg) spawn on the map. Characters auto-collect by walking over them.

COMMAND QUEUING:
- Players can say "then" to chain commands. Example: "warrior attack the mage then retreat"
- For queued actions, set "queued": true. First action for a character is immediate, subsequent are queued.
- Max 3 queued actions per character.

RULES:
- Interpret the player's intent HEAVILY. If they say "go get their flag", that means capture. If they say "bring it home", that means move to your flag base.
- Each alive character can receive actions per command (multiple via "then" queuing).
- If the player names a character by class, animal, or name, command THAT character.
- "all" or "everyone" means all alive characters.
- If ambiguous, pick the most logical character for the task.
- NEVER ask for clarification. Always produce valid actions.
- Be SMART: if someone has the flag, suggest they head home. If the enemy has your flag, suggest attacking the carrier.
- For directional moves: up=y-6, down=y+6, left=x-6, right=x+6, forward=toward map center.
- Only include alive characters in actions.

PLAYER COMMAND: "${rawText}"

Respond with ONLY valid JSON (no markdown, no code blocks):
{
  "actions": [
    {
      "characterId": "<exact character ID>",
      "type": "<move|attack|ability|defend|retreat|capture|escort|patrol|hold|control>",
      "targetCharacterId": "<ID if applicable>",
      "targetPosition": {"x": <number>, "y": <number>},
      "abilityId": "<ability id if applicable>",
      "queued": false
    }
  ],
  "narration": "<One dramatic sentence describing the orders, like a battle narrator>"
}`;
}

export async function parseCommandWithGemini(
  rawText: string,
  allChars: Map<string, Character>,
  playerId: string,
  mapWidth: number,
  mapHeight: number,
  ctf: CTFState,
  controlPoints: ControlPoint[] = [],
  tiles: TileType[][] = [],
): Promise<GeminiParseResult> {
  const myChars = Array.from(allChars.values()).filter(c => c.owner === playerId && !c.isDead);
  const enemyChars = Array.from(allChars.values()).filter(c => c.owner !== playerId && !c.isDead);

  if (!GEMINI_API_KEY) {
    throw new Error('GEMINI_API_KEY not set. Add VITE_GEMINI_API_KEY to your .env file.');
  }

  const prompt = buildPrompt(rawText, myChars, enemyChars, mapWidth, mapHeight, ctf, controlPoints, tiles);

  const response = await fetch(GEMINI_URL + GEMINI_API_KEY, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: {
        temperature: 0.1,
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

    parsed.actions = parsed.actions.filter(a => {
      const char = allChars.get(a.characterId);
      return char && char.owner === playerId && !char.isDead;
    });

    return parsed;
  } catch {
    console.error('Failed to parse Gemini JSON:', text);
    throw new Error('Gemini returned invalid JSON');
  }
}
