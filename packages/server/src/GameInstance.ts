import { getDb } from './FirebaseAdmin';
import type { GameSimulation } from '../../shared/src/simulation/GameSimulation';

export class GameInstance {
  private gameId: string;
  private sim: GameSimulation;
  private syncCounter = 0;
  private orderListener: (() => void) | null = null;
  private player1Id: string;
  private player2Id: string;
  public finished = false;

  constructor(gameId: string, player1Id: string, player2Id: string, sim: GameSimulation) {
    this.gameId = gameId;
    this.player1Id = player1Id;
    this.player2Id = player2Id;
    this.sim = sim;
    this.listenForOrders();
  }

  tick(deltaMs: number): void {
    if (this.finished) return;
    this.sim.tick(deltaMs);
    this.syncCounter++;
    // Push sync every 2 ticks (~130ms at 15Hz)
    if (this.syncCounter % 2 === 0) {
      this.pushSync();
    }
    if (this.sim.isGameOver()) {
      this.onGameOver();
    }
  }

  private async pushSync(): Promise<void> {
    try {
      const state = this.sim.buildSyncState();
      await getDb().ref(`games/${this.gameId}/sync`).set(state);
    } catch (err) {
      console.error(`[Game ${this.gameId}] Sync push failed:`, err);
    }
  }

  private listenForOrders(): void {
    const ordersRef = getDb().ref(`games/${this.gameId}/remoteOrders`);
    const handler = ordersRef.on('child_added', (snap) => {
      const data = snap.val();
      if (!data) return;
      const key = snap.key!;
      // Determine team from playerId
      const team = data.playerId === this.player1Id ? 1 : data.playerId === this.player2Id ? 2 : null;
      if (team && data.orders) {
        this.sim.processCommand(team, data.orders);
      }
      // Remove processed order
      ordersRef.child(key).remove().catch(() => {});
    });
    this.orderListener = () => ordersRef.off('child_added', handler);
  }

  private async onGameOver(): Promise<void> {
    this.finished = true;
    try {
      await getDb().ref(`games/${this.gameId}/meta`).update({
        status: 'finished',
        winner: this.sim.winner,
      });
      // Push final sync state
      await this.pushSync();
    } catch (err) {
      console.error(`[Game ${this.gameId}] Game over update failed:`, err);
    }
  }

  cleanup(): void {
    if (this.orderListener) {
      this.orderListener();
      this.orderListener = null;
    }
  }
}
