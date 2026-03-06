import * as admin from 'firebase-admin';

export async function matchPlayers(newPlayerId: string): Promise<void> {
  const db = admin.database();
  const queueRef = db.ref('matchmaking/queue');

  const snapshot = await queueRef.orderByChild('status').equalTo('waiting').once('value');
  const waitingPlayers: string[] = [];

  snapshot.forEach((child) => {
    const data = child.val();
    if (data.playerId !== newPlayerId && data.status === 'waiting') {
      waitingPlayers.push(data.playerId);
    }
  });

  if (waitingPlayers.length === 0) return;

  // Match with the first waiting player
  const opponent = waitingPlayers[0];
  const gameId = `game_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;

  // Create game
  await db.ref(`games/${gameId}`).set({
    meta: {
      player1: opponent,
      player2: newPlayerId,
      mapSeed: Date.now(),
      status: 'drafting',
      currentTurn: 0,
      createdAt: Date.now(),
    },
  });

  // Update both players in queue
  await Promise.all([
    queueRef.child(opponent).update({ status: 'matched', gameId }),
    queueRef.child(newPlayerId).update({ status: 'matched', gameId }),
  ]);

  // Clean up queue after a delay
  setTimeout(async () => {
    await Promise.all([
      queueRef.child(opponent).remove(),
      queueRef.child(newPlayerId).remove(),
    ]);
  }, 5000);
}
