import { getDb } from './FirebaseAdmin';
import type { GameSimulation } from '../../shared/src/simulation/GameSimulation';
import type { GameWebSocketServer } from './WebSocketServer';

const SNAPSHOT_INTERVAL = 45; // ticks (~3s at 15Hz)

export class GameInstance {
  private static MAX_GAME_DURATION_MS = 60 * 60 * 1000; // 1 hour max
  private gameId: string;
  private sim: GameSimulation;

  private player1Id: string;
  private player2Id: string;
  private wsServer: GameWebSocketServer | null;
  private createdAt = Date.now();
  public finished = false;

  private snapshotCounter = 0;
  private commandBuffer: Array<{ team: 1 | 2; orders: any[] }> = [];

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
    // Auto-expire games older than 1 hour
    if (Date.now() - this.createdAt > GameInstance.MAX_GAME_DURATION_MS) {
      console.log(`[Game ${this.gameId}] Expired after 1 hour, finishing`);
      this.onGameOver();
      return;
    }

    this.sim.tick(deltaMs);
    this.snapshotCounter++;

    // Broadcast buffered commands to opponent
    if (this.commandBuffer.length > 0) {
      this.broadcastCommands();
    }

    // Send full state sync every tick (15Hz) — client is render-only for online
    this.pushSnapshot();

    if (this.sim.isGameOver()) {
      this.onGameOver();
    }
  }

  /** Handle a command from a player (via WebSocket) */
  handleCommand(team: 1 | 2, orders: any[]): void {
    this.sim.processCommand(team, orders);
    this.commandBuffer.push({ team, orders });
  }

  private broadcastCommands(): void {
    try {
      const msg = {
        type: 'commands' as const,
        commands: this.commandBuffer,
        tick: this.snapshotCounter,
      };
      if (this.wsServer) {
        this.wsServer.broadcastToGame(this.gameId, msg);
      }
      this.commandBuffer = [];
    } catch (err) {
      console.error(`[Game ${this.gameId}] Command broadcast failed:`, err);
    }
  }

  private pushSnapshot(): void {
    try {
      const state = this.sim.buildSyncState();
      const checksum = this.computeChecksum(state);
      if (this.wsServer) {
        this.wsServer.broadcastToGame(this.gameId, {
          type: 'snapshot',
          state,
          checksum,
          tick: this.snapshotCounter,
        });
      } else {
        // Fallback: push to Firebase RTDB (legacy)
        // JSON round-trip strips any remaining undefined values Firebase rejects
        getDb().ref(`games/${this.gameId}/sync`).set(JSON.parse(JSON.stringify(state))).catch((err: any) => {
          console.error(`[Game ${this.gameId}] Firebase sync push failed:`, err);
        });
      }
    } catch (err) {
      console.error(`[Game ${this.gameId}] Snapshot push failed:`, err);
    }
  }

  private computeChecksum(state: any): number {
    let h = 0;
    h += state.units?.length || 0;
    h += Math.round(state.gameTime / 1000);
    h += (state.baseStockpile?.[1]?.carrot || 0) + (state.baseStockpile?.[2]?.carrot || 0);
    if (state.units) {
      for (const u of state.units) {
        h += Math.round(u.x) + Math.round(u.y) + Math.round(u.hp);
      }
    }
    return h;
  }

  private async onGameOver(): Promise<void> {
    this.finished = true;
    try {
      // Write final status to Firebase for persistence
      await getDb().ref(`games/${this.gameId}/meta`).update({
        status: 'finished',
        winner: this.sim.winner,
      });
      // Push final snapshot
      this.pushSnapshot();
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
