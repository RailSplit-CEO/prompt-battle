import * as admin from 'firebase-admin';
import { parseCommand } from './ai/command-parser';

interface CommandResult {
  success: boolean;
  actions?: Array<{
    characterId: string;
    type: string;
    target?: unknown;
    abilityId?: string;
    result?: unknown;
  }>;
  error?: string;
  reasoning?: string;
}

export async function processCommand(
  gameId: string,
  playerId: string,
  rawText: string
): Promise<CommandResult> {
  const db = admin.database();

  // Fetch current game state
  const gameSnap = await db.ref(`games/${gameId}`).once('value');
  const game = gameSnap.val();

  if (!game) {
    return { success: false, error: 'Game not found' };
  }

  if (game.meta.status !== 'playing') {
    return { success: false, error: 'Game is not in playing state' };
  }

  // Verify player is in this game
  if (game.meta.player1 !== playerId && game.meta.player2 !== playerId) {
    return { success: false, error: 'Player not in this game' };
  }

  // Get current character states
  const characters = game.state?.characters || {};

  // Get player's characters
  const playerChars = Object.entries(characters)
    .filter(([, c]: [string, any]) => c.owner === playerId && !c.isDead)
    .map(([id, c]: [string, any]) => ({ id, ...c }));

  if (playerChars.length === 0) {
    return { success: false, error: 'No alive characters to command' };
  }

  // Parse command via Gemini
  try {
    const parsed = await parseCommand(rawText, characters, playerId);

    if (!parsed || !parsed.actions || parsed.actions.length === 0) {
      return { success: false, error: 'Could not understand command', reasoning: parsed?.reasoning };
    }

    // Validate actions
    const validActions = parsed.actions.filter(action => {
      const char = characters[action.characterRef];
      return char && char.owner === playerId && !char.isDead;
    });

    if (validActions.length === 0) {
      return { success: false, error: 'No valid actions from command' };
    }

    // Convert parsed actions to resolved actions
    const resolvedActions = validActions.map(action => ({
      characterId: action.characterRef,
      type: action.action,
      target: action.targetRef || action.targetPosition,
      abilityId: action.abilityId,
    }));

    // Log the command
    const cmdRef = db.ref(`games/${gameId}/commands`).push();
    await cmdRef.set({
      playerId,
      rawText,
      parsedActions: resolvedActions,
      timestamp: Date.now(),
    });

    return {
      success: true,
      actions: resolvedActions,
      reasoning: parsed.reasoning,
    };
  } catch (err) {
    console.error('AI parsing error:', err);
    return { success: false, error: 'Failed to parse command' };
  }
}
