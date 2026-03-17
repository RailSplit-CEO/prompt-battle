import { getDb } from './FirebaseAdmin';
import type { GameSimulation } from '../../shared/src/simulation/GameSimulation';
import type { GameWebSocketServer } from './WebSocketServer';

export class GameInstance {
  private gameId: string;
  private sim: GameSimulation;
  private syncCounter = 0;
  private player1Id: string;
  private player2Id: string;
  private wsServer: GameWebSocketServer | null;
  public finished = false;

  constructor(
    gameId: string,
    player1Id: string,
    player2Id: string,
    sim: GameSimulation,
    wsServer: GameWebSocketServer | null = null,
  ) {
    this.gameId = gameId;
    this.player1Id = player1Id;
    this.player2Id = player2Id;
    this.sim = sim;
    this.wsServer = wsServer;
  }

  getTeamForPlayer(playerId: string): 1 | 2 | null {
    if (playerId === this.player1Id) return 1;
    if (playerId === this.player2Id) return 2;
    return null;
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

  /** Handle a command from a player (via WebSocket) */
  handleCommand(team: 1 | 2, orders: any[]): void {
    this.sim.processCommand(team, orders);
  }

  private pushSync(): void {
    try {
      const state = this.sim.buildSyncState();
      if (this.wsServer) {
        // WebSocket: broadcast directly to connected clients
        this.wsServer.broadcastToGame(this.gameId, { type: 'sync', state });
      } else {
        // Fallback: push to Firebase RTDB (legacy)
        getDb().ref(`games/${this.gameId}/sync`).set(state).catch((err: any) => {
          console.error(`[Game ${this.gameId}] Firebase sync push failed:`, err);
        });
      }
    } catch (err) {
      console.error(`[Game ${this.gameId}] Sync push failed:`, err);
    }
  }

  private async onGameOver(): Promise<void> {
    this.finished = true;
    try {
      // Write final status to Firebase for persistence
      await getDb().ref(`games/${this.gameId}/meta`).update({
        status: 'finished',
        winner: this.sim.winner,
      });
      // Push final sync
      this.pushSync();
      // Notify clients via WebSocket
      if (this.wsServer) {
        this.wsServer.broadcastToGame(this.gameId, {
          type: 'gameOver',
          winner: this.sim.winner,
        });
      }
    } catch (err) {
      console.error(`[Game ${this.gameId}] Game over update failed:`, err);
    }
  }

  cleanup(): void {
    if (this.wsServer) {
      this.wsServer.removeGame(this.gameId);
    }
  }
}
