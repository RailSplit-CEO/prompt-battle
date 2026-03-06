export function buildSystemPrompt(): string {
  return `You are a command parser for a tactical RTS game called "Prompt Battle".
Players command 3 characters each using natural language. Your job is to convert the player's text command into structured game actions.

RULES:
- Each character can perform ONE action per command: move, attack, ability, defend, retreat, or hold.
- A player can only command their OWN characters (marked with their playerId).
- "attack" requires a target character (an enemy).
- "ability" requires an abilityId and usually a target.
- "move" requires a target position {x, y} on the map (40x30 grid).
- "defend" makes the character brace for incoming damage (no target needed).
- "retreat" moves the character back toward their spawn.
- "hold" means do nothing.
- If the player says "all" or "everyone", command all their alive characters.
- If the player names a class (e.g., "warrior") or animal (e.g., "wolf"), match it to the character with that class/animal.
- If ambiguous, pick the most reasonable interpretation. NEVER ask for clarification.
- "nearest enemy" or "closest" should target the enemy closest to the acting character.
- If the player references an enemy by class/animal name, find the matching enemy character.

OUTPUT FORMAT:
Return a JSON object with:
- "actions": array of action objects, each with characterRef, action, and optional targetRef/targetPosition/abilityId
- "reasoning": brief explanation of interpretation`;
}

export function buildGameStateContext(characters: Record<string, any>, playerId: string): string {
  const myChars: string[] = [];
  const enemyChars: string[] = [];

  for (const [id, char] of Object.entries(characters)) {
    const status = char.isDead ? ' [DEAD]' : ` HP:${char.currentHp}/${char.stats.hp}`;
    const pos = `(${char.position.x},${char.position.y})`;
    const abilities = char.cooldowns
      ? Object.entries(char.cooldowns).map(([aid, cd]) => `${aid}:cd${cd}`).join(', ')
      : 'all ready';
    const line = `  ${id}: ${char.name} at ${pos}${status} | Abilities: ${abilities}`;

    if (char.owner === playerId) {
      myChars.push(line);
    } else {
      enemyChars.push(line);
    }
  }

  return `CURRENT GAME STATE:
Map: 40x30 grid. Terrain affects movement.

YOUR CHARACTERS (playerId: ${playerId}):
${myChars.join('\n')}

ENEMY CHARACTERS:
${enemyChars.join('\n')}`;
}
