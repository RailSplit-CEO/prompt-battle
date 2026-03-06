import * as functions from 'firebase-functions';
import * as admin from 'firebase-admin';
import { matchPlayers } from './matchmaking';
import { processCommand } from './game-authority';

admin.initializeApp();

// Matchmaking: triggered when a player joins the queue
export const onPlayerJoinQueue = functions.database
  .ref('/matchmaking/queue/{playerId}')
  .onCreate(async (snapshot, context) => {
    const playerId = context.params.playerId;
    await matchPlayers(playerId);
  });

// Process a command from a player
export const processPlayerCommand = functions.https.onRequest(async (req, res) => {
  // CORS
  res.set('Access-Control-Allow-Origin', '*');
  res.set('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.set('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.status(204).send('');
    return;
  }

  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  const { gameId, playerId, rawText } = req.body;

  if (!gameId || !playerId || !rawText) {
    res.status(400).json({ error: 'Missing required fields: gameId, playerId, rawText' });
    return;
  }

  try {
    const result = await processCommand(gameId, playerId, rawText);
    res.json(result);
  } catch (error) {
    console.error('Command processing error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});
