import { getDb } from './FirebaseAdmin';
import { GameInstance } from './GameInstance';
import { GameSimulation } from '../../shared/src/simulation/GameSimulation';
import { getMapById } from '../../shared/src/data/maps';
import type { GameWebSocketServer } from './WebSocketServer';

export class GameManager {
  private games: Map<string, GameInstance> = new Map();
  private tickInterval: ReturnType<typeof setInterval> | null = null;
  private lastTickTime = Date.now();
  private wsServer: GameWebSocketServer | null = null;

  setWebSocketServer(wss: GameWebSocketServer): void {
    this.wsServer = wss;
  }

  start(): void {
    this.watchForGames();
    // Tick all games at ~15Hz (66ms)
    this.lastTickTime = Date.now();
    this.tickInterval = setInterval(() => {
      const now = Date.now();
      const deltaMs = now - this.lastTickTime;
      this.lastTickTime = now;
      this.tickAll(deltaMs);
    }, 66);
    console.log('[GameManager] Started, ticking at 15Hz');
  }

  stop(): void {
    if (this.tickInterval) {
      clearInterval(this.tickInterval);
      this.tickInterval = null;
    }
    for (const [, game] of this.games) {
      game.cleanup();
    }
    this.games.clear();
  }

  private tickAll(deltaMs: number): void {
    for (const [id, game] of this.games) {
      game.tick(deltaMs);
      if (game.finished) {
        console.log(`[GameManager] Game ${id} finished, cleaning up`);
        game.cleanup();
        this.games.delete(id);
      }
    }
  }

  private watchForGames(): void {
    const gamesRef = getDb().ref('games');
    // Listen for new games or status changes
    gamesRef.on('child_added', async (snap) => {
      const gameId = snap.key!;
      const data = snap.val();
      if (data?.meta?.status === 'playing' && !this.games.has(gameId)) {
        await this.startGame(gameId, data.meta);
      }
    });

    gamesRef.on('child_changed', async (snap) => {
      const gameId = snap.key!;
      const data = snap.val();
      if (data?.meta?.status === 'playing' && !this.games.has(gameId)) {
        await this.startGame(gameId, data.meta);
      }
    });

    console.log('[GameManager] Watching for new games on RTDB');
  }

  private async startGame(gameId: string, meta: any): Promise<void> {
    const isSolo = meta.isSolo === true || meta.player2 === 'bot';
    console.log(`[GameManager] Starting game ${gameId} (${meta.player1} vs ${isSolo ? 'BOT' : meta.player2})`);
    try {
      const mapDef = getMapById(meta.mapId || 'default');
      const sim = new GameSimulation(mapDef, meta.mapSeed || Date.now(), isSolo);

      const instance = new GameInstance(gameId, meta.player1, meta.player2, sim, this.wsServer);
      this.games.set(gameId, instance);
      console.log(`[GameManager] Game ${gameId} running (${this.games.size} active games)`);
    } catch (err) {
      console.error(`[GameManager] Failed to start game ${gameId}:`, err);
    }
  }

  /** WebSocket: handle a player joining a game */
  handleJoin(gameId: string, playerId: string): { team: 1 | 2 } | null {
    const game = this.games.get(gameId);
    if (!game) return null;
    const team = game.getTeamForPlayer(playerId);
    if (!team) return null;
    return { team };
  }

  /** WebSocket: handle a command from a player */
  handleCommand(gameId: string, team: 1 | 2, orders: any[]): void {
    const game = this.games.get(gameId);
    if (!game) return;
    game.handleCommand(team, orders);
  }

  getActiveGameCount(): number {
    return this.games.size;
  }
}
