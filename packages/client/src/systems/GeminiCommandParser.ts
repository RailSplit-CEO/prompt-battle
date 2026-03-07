import { Character, CLASSES, Position, CTFState, ControlPoint, TileType, CONSUMABLES, ConsumableId, POI } from '@prompt-battle/shared';

const GEMINI_API_KEY = (import.meta as any).env?.VITE_GEMINI_API_KEY || '';
const GEMINI_MODEL = 'gemini-3.1-flash-lite-preview';
const GEMINI_URL = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=`;

export interface ParsedGameAction {
  characterId: string;
  type: 'move' | 'attack' | 'ability' | 'defend' | 'retreat' | 'hold' | 'capture' | 'escort' | 'patrol' | 'control'
    | 'mine' | 'build_tower' | 'praise'
    | 'use_item' | 'scout' | 'loot' | 'build' | 'set_trap';
  targetCharacterId?: string;
  targetPosition?: Position;
  abilityId?: string;
  itemId?: ConsumableId;
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
  pois: POI[] = [],
): string {
  const myList = myChars.map(c => {
    const cls = CLASSES[c.classId];
    const abilities = cls.abilities;
    const abilityStrs = abilities.map(ability => {
      const cd = c.cooldowns[ability.id] || 0;
      return `${ability.name}(id:${ability.id}) - ${ability.description} [range:${ability.range}, cd:${cd > 0 ? cd + 's' : 'READY'}]`;
    });
    const abilityStr = abilityStrs.length > 0
      ? `ABILITIES: ${abilityStrs.join(' | ')}`
      : 'NO ABILITIES';
    const terrain = tiles[c.position.y]?.[c.position.x] || 'grass';
    const invStr = c.inventory.length > 0
      ? `INVENTORY: [${c.inventory.map(i => CONSUMABLES[i].name).join(', ')}]`
      : 'INVENTORY: empty';
    return `  ID:"${c.id}" Name:"${c.name}" Class:${cls.name} Role:${cls.role} Lv.${c.level} ` +
      `HP:${c.currentHp}/${c.stats.hp} Pos:(${c.position.x},${c.position.y}) Terrain:${terrain} ` +
      `ATK:${c.stats.attack} DEF:${c.stats.defense} SPD:${c.stats.speed} RNG:${c.stats.range} MAG:${c.stats.magic} ` +
      `${abilityStr} ${invStr}` +
      `${c.isDead ? ` [DEAD - respawns in ${c.respawnTimer ?? 0}s]` : ''}`;
  }).join('\n');

  const enemyList = enemyChars.map(c => {
    const cls = CLASSES[c.classId];
    return `  ID:"${c.id}" Name:"${c.name}" Class:${cls.name} Role:${cls.role} ` +
      `HP:${c.currentHp}/${c.stats.hp} Pos:(${c.position.x},${c.position.y})` +
      `${c.isDead ? ' [DEAD]' : ''}`;
  }).join('\n');

  const modeInfo = `
DOMINATION MODE:
- There are 3 control points on the map. Hold them to score points every second.
- First team to 200 points wins, or highest score when time runs out.
- Score: You ${ctf.score1} - ${ctf.score2} Enemy
- Capture points by standing within 2 tiles. Contested if both teams are near.
- STRATEGY: Spread your team across multiple points. Holding more = scoring faster.`;

  return `You are the AI command interpreter for "Prompt Battle", a real-time tactical DOMINATION game.
The player speaks natural language commands to control their characters on a ${mapWidth}x${mapHeight} tile grid.
This is REAL-TIME: characters continuously execute their last order until given a new one. Be smart about interpretation.

YOUR CHARACTERS (you control these):
${myList}

ENEMY CHARACTERS (only visible ones shown):
${enemyList}
${modeInfo}

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

CHARACTER SYSTEM:
Each character is an ANIMAL (identity/stats) + CLASS (abilities/role). Players may refer to characters by animal name, class name, or character name.
CLASSES:
- Warrior (tank): Shield Bash (25 dmg + 3s stun, cd:8, rng:1)
- Mage (dps): Fireball (45 dmg, cd:6, rng:5)
- Archer (dps): Piercing Shot (40 dmg, cd:5, rng:7)
- Healer (support): Healing Light (40 heal, cd:5, rng:4)
- Rogue (assassin): Backstab (60 dmg, cd:7, rng:1)
- Paladin (tank): Divine Smite (30 dmg + 20 self-heal, cd:7, rng:1)
- Necromancer (dps): Drain Life (30 dmg + 20 self-heal, cd:5, rng:4)
- Bard (support): Discordant Note (20 dmg + 50% slow 4s, cd:6, rng:4)
ANIMALS modify stats: wolf (+30% atk), lion (+40% atk), turtle (+40% def), elephant (+40% hp), cheetah (+40% spd), falcon (+30% spd, +20% rng), owl (+30% mag), phoenix (+40% mag), chameleon (balanced), spider (+10% atk/spd/rng).

ACTION TYPES:
- "move": Move toward a position. Requires targetPosition {x, y}. Character keeps moving until arrival.
- "attack": Chase and attack an enemy. Requires targetCharacterId. Character will pursue and auto-attack in range.
- "ability": Use a specific ability. Requires abilityId and targetCharacterId.
- "defend": Hold position and fight any nearby enemies.
- "retreat": Fall back toward spawn base.
- "capture": Move toward a control point to capture it. Requires targetPosition (control point pos). Same as "control".
- "escort": Follow and protect a specific ally. Requires targetCharacterId.
- "patrol": Guard an area, pacing back and forth. Requires targetPosition.
- "hold": Stop and do nothing.
- "control": Move to and hold a control point. Requires targetPosition (the control point position). Use for "take the point", "capture", "cap", etc. THIS IS THE PRIMARY OBJECTIVE.
- "mine": Send a character to mine gold at the nearest mine node. "go mine", "mine west", "gather gold".
- "build_tower": Build a defensive tower at the nearest tower site (costs 200g). "build tower", "tower up".
- "praise": Praise a hero for morale boost (+15% dmg 10s). "good job rogue", "nice work paladin".
- "use_item": Use a consumable from inventory. Requires itemId (the consumable type ID). Use when player says "use bomb", "drink potion", "throw bomb", "activate horn", etc.
- "scout": Move to nearest lookout post and channel to reveal a large map area (10s channel). Rewards: vision + XP.
- "loot": Move to nearest treasure cache and loot it (8s channel). Rewards: random consumable item + XP.
- "build": Build a barricade at current position (6s channel). Creates an impassable wall that decays after 60s.
- "set_trap": Set a hidden trap at current position (4s channel). Deals 25 damage + 3s stun to enemies who walk over it.

POINTS OF INTEREST (POIs):
${pois.filter(p => p.active).map(p => `- ${p.type}: Pos:(${p.position.x},${p.position.y}) ${p.type === 'treasure_cache' ? '[LOOT for consumable]' : p.type === 'lookout' ? '[SCOUT for vision]' : '[Stand to heal]'}`).join('\n')}

LEVELING: Characters earn XP from kills (50), capturing CPs (40), looting caches (30), scouting (20). Levels 1-3, each level gives +40% all stats.

ECONOMY: Gold is earned from mining (3-5g/sec at mine nodes) and passive income (1g/sec). Towers cost 200g. Barricades cost nothing. At Phase 4 (4:00), income doubles.

INVENTORY: Each character can hold max 2 consumable items. Items are gained from looting treasure caches.
Available consumables: Siege Bomb (40 AOE dmg), Smoke Bomb (3-tile fog), Battle Horn (team +30% dmg), Haste Elixir (2x speed 15s), Iron Skin (+40% def 20s), Vision Flare (reveal map 10s), Rally Banner (allies respawn 8s faster), Purge Scroll (destroy enemy barricades).

HEALING WELLS: Stand on a healing well to passively regenerate HP each tick. No channeling needed - just go there!

MAP PICKUPS: Health potions (green, +35% HP), Speed boosts (yellow, 12s double speed), Damage boosts (red, 12s +50% dmg) spawn on the map. Characters auto-collect by walking over them.

COMMAND QUEUING:
- Players can say "then" to chain commands. Example: "warrior attack the mage then retreat"
- For queued actions, set "queued": true. First action for a character is immediate, subsequent are queued.
- Max 3 queued actions per character.

COMPLEX COMMANDS:
- Players can address MULTIPLE characters with different orders using commas or "and":
  "mage fireball the rogue, paladin defend"
  "warrior attack and bard rally cry"
- "focus [enemy]" = all targeted characters attack the same enemy.
- "spread out" / "scatter" = move characters apart in different directions from their center.
- "flank" = move to the side of the nearest enemy (perpendicular approach).
- "behind" = move past the nearest enemy to get behind them.
- "protect [ally]" or "follow [ally]" = escort that ally.
- "cap A" / "take point" / "capture" = move to nearest unowned control point.
- "attack weakest" / "attack strongest" = target by HP percentage.
- Explicit coordinates: "move to 5,10" or "go 12 8".
- "patrol center" = patrol around a position.
- "disengage" / "fall back" = retreat.

RULES:
- Interpret the player's intent HEAVILY. If they say "take the point" or "capture", that means control the nearest unowned point.
- A single command can issue DIFFERENT orders to DIFFERENT characters. Parse each clause independently.
- If the player names a character by class or name, command THAT character.
- "all" or "everyone" means all alive characters.
- If ambiguous, pick the most logical character for the task.
- NEVER ask for clarification. Always produce valid actions.
- Be SMART: prioritize capturing unowned control points. Defend owned ones. Attack enemies contesting your points.
- For directional moves: up=y-6, down=y+6, left=x-6, right=x+6, forward=toward map center.
- Only include alive characters in actions.

PLAYER COMMAND: "${rawText}"

Respond with ONLY valid JSON (no markdown, no code blocks):
{
  "actions": [
    {
      "characterId": "<exact character ID>",
      "type": "<move|attack|ability|defend|retreat|capture|escort|patrol|hold|control|mine|build_tower|praise|use_item|scout|loot|build|set_trap>",
      "targetCharacterId": "<ID if applicable>",
      "targetPosition": {"x": <number>, "y": <number>},
      "abilityId": "<ability id if applicable>",
      "itemId": "<consumable id if use_item, e.g. siege_bomb, haste_elixir>",
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
  pois: POI[] = [],
): Promise<GeminiParseResult> {
  const myChars = Array.from(allChars.values()).filter(c => c.owner === playerId && !c.isDead);
  const enemyChars = Array.from(allChars.values()).filter(c => c.owner !== playerId && !c.isDead);

  if (!GEMINI_API_KEY) {
    throw new Error('GEMINI_API_KEY not set. Add VITE_GEMINI_API_KEY to your .env file.');
  }

  const prompt = buildPrompt(rawText, myChars, enemyChars, mapWidth, mapHeight, ctf, controlPoints, tiles, pois);

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
