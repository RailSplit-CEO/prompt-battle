/**
 * GameSocket — WebSocket client for server-authoritative multiplayer.
 * Connects to the game server, sends commands, receives sync state.
 * Falls back gracefully if the server is unreachable.
 */

export interface GameSocketCallbacks {
  onJoined: (team: 1 | 2) => void;
  onSync: (state: any) => void;
  onGameOver: (winner: 1 | 2) => void;
  onDisconnect: () => void;
  onError: (error: string) => void;
  /** Called when all reconnect attempts fail — caller should fall back to Firebase */
  onFallback?: () => void;
}

export class GameSocket {
  private ws: WebSocket | null = null;
  private serverUrl: string;
  private gameId: string;
  private playerId: string;
  private callbacks: GameSocketCallbacks;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectAttempts = 0;
  private maxReconnects = 10;
  private closed = false;
  private everConnected = false;

  constructor(serverUrl: string, gameId: string, playerId: string, callbacks: GameSocketCallbacks) {
    this.serverUrl = serverUrl;
    this.gameId = gameId;
    this.playerId = playerId;
    this.callbacks = callbacks;
  }

  connect(): void {
    this.closed = false;
    try {
      this.ws = new WebSocket(this.serverUrl);
    } catch (err) {
      console.warn('[GameSocket] Failed to create WebSocket:', err);
      this.callbacks.onError('Failed to connect to server');
      this.callbacks.onFallback?.();
      return;
    }

    this.ws.onopen = () => {
      console.log('[GameSocket] Connected to', this.serverUrl);
      this.reconnectAttempts = 0;
      this.everConnected = true;
      this.send({ type: 'join', gameId: this.gameId, playerId: this.playerId });
    };

    this.ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data as string);
        switch (msg.type) {
          case 'joined':
            this.callbacks.onJoined(msg.team);
            break;
          case 'sync':
            this.callbacks.onSync(msg.state);
            break;
          case 'gameOver':
            this.callbacks.onGameOver(msg.winner);
            break;
          case 'error':
            this.callbacks.onError(msg.message || 'Server error');
            break;
        }
      } catch (err) {
        console.error('[GameSocket] Bad message:', err);
      }
    };

    this.ws.onclose = () => {
      if (this.closed) return;
      this.callbacks.onDisconnect();
      this.tryReconnect();
    };

    this.ws.onerror = () => {
      // onerror always fires before onclose — don't log twice
    };
  }

  sendCommand(orders: any[]): void {
    this.send({ type: 'command', orders });
  }

  private send(msg: object): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(msg));
    }
  }

  private tryReconnect(): void {
    if (this.closed || this.reconnectAttempts >= this.maxReconnects) {
      if (!this.closed) {
        console.warn(`[GameSocket] Max reconnect attempts reached (${this.maxReconnects}), giving up`);
        this.callbacks.onFallback?.();
      }
      return;
    }
    this.reconnectAttempts++;
    // Only reconnect if we previously connected — if we never connected, the server is down
    if (!this.everConnected && this.reconnectAttempts > 1) {
      console.warn('[GameSocket] Server unreachable, falling back');
      this.callbacks.onFallback?.();
      return;
    }
    const delay = Math.min(1000 * this.reconnectAttempts, 5000);
    console.log(`[GameSocket] Reconnecting in ${delay}ms (attempt ${this.reconnectAttempts})`);
    this.reconnectTimer = setTimeout(() => {
      this.connect();
    }, delay);
  }

  disconnect(): void {
    this.closed = true;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.ws) {
      this.ws.onclose = null;
      this.ws.close();
      this.ws = null;
    }
  }

  isConnected(): boolean {
    return this.ws !== null && this.ws.readyState === WebSocket.OPEN;
  }
}

/**
 * Get the game server WebSocket URL based on environment.
 */
export function getGameServerUrl(): string {
  if (typeof import.meta !== 'undefined' && (import.meta as any).env?.VITE_GAME_SERVER_URL) {
    return (import.meta as any).env.VITE_GAME_SERVER_URL;
  }
  if (typeof window !== 'undefined' && window.location.hostname !== 'localhost' && window.location.hostname !== '127.0.0.1') {
    return 'wss://prompt-battle-server.fly.dev';
  }
  return 'ws://localhost:8080';
}
