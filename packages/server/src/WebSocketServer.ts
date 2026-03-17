import { WebSocketServer as WSServer, WebSocket } from 'ws';
import type { Server as HttpServer } from 'http';

interface ClientConnection {
  gameId: string;
  playerId: string;
  team: 1 | 2;
}

export interface WSHandlers {
  onJoin: (gameId: string, playerId: string) => { team: 1 | 2 } | null;
  onCommand: (gameId: string, team: 1 | 2, orders: any[]) => void;
}

export class GameWebSocketServer {
  private wss: WSServer;
  private clients = new Map<WebSocket, ClientConnection>();
  private gameClients = new Map<string, Set<WebSocket>>();

  constructor(server: HttpServer, private handlers: WSHandlers) {
    this.wss = new WSServer({ server });

    this.wss.on('connection', (ws) => {
      ws.on('message', (raw) => {
        try {
          const msg = JSON.parse(raw.toString());
          this.handleMessage(ws, msg);
        } catch (err) {
          console.error('[WS] Bad message:', err);
        }
      });

      ws.on('close', () => this.removeClient(ws));
      ws.on('error', () => this.removeClient(ws));
    });

    console.log('[WS] WebSocket server attached');
  }

  private handleMessage(ws: WebSocket, msg: any): void {
    if (msg.type === 'join') {
      const { gameId, playerId } = msg;
      if (!gameId || !playerId) return;

      const result = this.handlers.onJoin(gameId, playerId);
      if (!result) {
        this.sendTo(ws, { type: 'error', message: 'Game not found or not joinable' });
        return;
      }

      const conn: ClientConnection = { gameId, playerId, team: result.team };
      this.clients.set(ws, conn);

      if (!this.gameClients.has(gameId)) {
        this.gameClients.set(gameId, new Set());
      }
      this.gameClients.get(gameId)!.add(ws);

      this.sendTo(ws, { type: 'joined', team: result.team });
      console.log(`[WS] Player ${playerId} joined game ${gameId} as team ${result.team}`);

    } else if (msg.type === 'command') {
      const conn = this.clients.get(ws);
      if (!conn) return;
      this.handlers.onCommand(conn.gameId, conn.team, msg.orders || []);
    }
  }

  broadcastToGame(gameId: string, message: object): void {
    const clients = this.gameClients.get(gameId);
    if (!clients) return;
    const data = JSON.stringify(message);
    for (const ws of clients) {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(data);
      }
    }
  }

  sendTo(ws: WebSocket, message: object): void {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(message));
    }
  }

  removeClient(ws: WebSocket): void {
    const conn = this.clients.get(ws);
    if (conn) {
      const gameSet = this.gameClients.get(conn.gameId);
      if (gameSet) {
        gameSet.delete(ws);
        if (gameSet.size === 0) this.gameClients.delete(conn.gameId);
      }
      console.log(`[WS] Player ${conn.playerId} disconnected from game ${conn.gameId}`);
    }
    this.clients.delete(ws);
  }

  removeGame(gameId: string): void {
    const clients = this.gameClients.get(gameId);
    if (clients) {
      for (const ws of clients) {
        this.clients.delete(ws);
      }
      this.gameClients.delete(gameId);
    }
  }
}
