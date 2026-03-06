import { initializeApp, FirebaseApp } from 'firebase/app';
import { getAuth, signInAnonymously, Auth, User } from 'firebase/auth';
import { getDatabase, ref, set, get, push, onValue, onChildAdded, update, remove, Database, off } from 'firebase/database';
import { DraftPick, Character, CommandResponse, CharacterOrder, CTFState, ControlPoint } from '@prompt-battle/shared';

const firebaseConfig = {
  apiKey: "AIzaSyAT4zIS0piAqGfW5ZTCWnbkQPzyLHNDRHY",
  authDomain: "prompt-battle-c5e6a.firebaseapp.com",
  databaseURL: "https://prompt-battle-c5e6a-default-rtdb.firebaseio.com",
  projectId: "prompt-battle-c5e6a",
  storageBucket: "prompt-battle-c5e6a.firebasestorage.app",
  messagingSenderId: "329010584107",
  appId: "1:329010584107:web:c8b08fe0487459e1c1286e",
};

export class FirebaseSync {
  private static instance: FirebaseSync;
  private app!: FirebaseApp;
  private auth!: Auth;
  private db!: Database;
  private user: User | null = null;
  private initialized = false;
  private listeners: Array<{ ref: any; unsub: () => void }> = [];

  static getInstance(): FirebaseSync {
    if (!FirebaseSync.instance) {
      FirebaseSync.instance = new FirebaseSync();
    }
    return FirebaseSync.instance;
  }

  async initialize(): Promise<void> {
    if (this.initialized) return;

    try {
      this.app = initializeApp(firebaseConfig);
      this.auth = getAuth(this.app);
      this.db = getDatabase(this.app);

      console.log('[Firebase] Signing in anonymously...');
      const cred = await signInAnonymously(this.auth);
      this.user = cred.user;
      this.initialized = true;
      console.log('[Firebase] Signed in as', this.user.uid);
    } catch (err) {
      console.error('[Firebase] Init failed:', err);
      throw new Error('Firebase connection failed: ' + (err as Error).message);
    }
  }

  getPlayerId(): string {
    return this.user?.uid || 'local_player';
  }

  isReady(): boolean {
    return this.initialized && this.user !== null;
  }

  // Matchmaking (client-side: each client checks for waiting opponents)
  async joinMatchmakingQueue(): Promise<string> {
    const playerId = this.getPlayerId();
    const queueRef = ref(this.db, `matchmaking/queue/${playerId}`);
    await set(queueRef, {
      playerId,
      timestamp: Date.now(),
      status: 'waiting',
    });
    console.log('[Firebase] Joined matchmaking queue');

    // Try to match with an existing waiting player
    const allRef = ref(this.db, `matchmaking/queue`);
    const snapshot = await get(allRef);
    if (snapshot.exists()) {
      const queue = snapshot.val() as Record<string, { playerId: string; status: string; timestamp: number }>;
      for (const [key, entry] of Object.entries(queue)) {
        if (entry.playerId !== playerId && entry.status === 'waiting') {
          // Found an opponent — create a game and match both players
          const gameId = `game_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
          console.log('[Firebase] Found opponent, creating game:', gameId);

          const gameRef = ref(this.db, `games/${gameId}`);
          await set(gameRef, {
            meta: {
              player1: entry.playerId,
              player2: playerId,
              mapSeed: Date.now(),
              status: 'drafting',
              currentTurn: 0,
              createdAt: Date.now(),
            },
          });

          await Promise.all([
            update(ref(this.db, `matchmaking/queue/${entry.playerId}`), { status: 'matched', gameId }),
            update(ref(this.db, `matchmaking/queue/${playerId}`), { status: 'matched', gameId }),
          ]);

          // Clean up queue after a short delay
          setTimeout(async () => {
            await Promise.all([
              remove(ref(this.db, `matchmaking/queue/${entry.playerId}`)),
              remove(ref(this.db, `matchmaking/queue/${playerId}`)),
            ]);
          }, 5000);

          break;
        }
      }
    }

    return playerId;
  }

  async waitForMatch(playerId: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const playerRef = ref(this.db, `matchmaking/queue/${playerId}`);
      const timeout = setTimeout(() => {
        off(playerRef);
        reject(new Error('Matchmaking timed out after 60s'));
      }, 60000);

      onValue(playerRef, (snap) => {
        const data = snap.val();
        if (data?.status === 'matched' && data?.gameId) {
          clearTimeout(timeout);
          off(playerRef);
          console.log('[Firebase] Match found:', data.gameId);
          resolve(data.gameId);
        }
      });
    });
  }

  async removeFromQueue(): Promise<void> {
    const playerId = this.getPlayerId();
    await remove(ref(this.db, `matchmaking/queue/${playerId}`));
  }

  // Game creation (local mode)
  async createLocalGame(): Promise<string> {
    const gameRef = push(ref(this.db, 'games'));
    const gameId = gameRef.key!;
    const gameData = {
      meta: {
        player1: this.getPlayerId(),
        player2: 'player2_local',
        mapSeed: Date.now(),
        status: 'drafting',
        currentTurn: 0,
        createdAt: Date.now(),
      },
    };

    try {
      await set(gameRef, gameData);
      console.log('[Firebase] Local game created:', gameId);
    } catch (err) {
      console.error('[Firebase] Failed to create game:', err);
      throw err;
    }

    return gameId;
  }

  // Game meta
  async getGameMeta(gameId: string): Promise<{ player1: string; player2: string; mapSeed: number }> {
    const snap = await get(ref(this.db, `games/${gameId}/meta`));
    return snap.val();
  }

  // Draft
  async submitDraftPick(gameId: string, pick: DraftPick): Promise<void> {
    const pickRef = push(ref(this.db, `games/${gameId}/draft/picks`));
    await set(pickRef, pick);
  }

  onDraftPick(gameId: string, callback: (pick: DraftPick) => void) {
    const picksRef = ref(this.db, `games/${gameId}/draft/picks`);
    onChildAdded(picksRef, (snap) => {
      const pick = snap.val() as DraftPick;
      if (pick) callback(pick);
    });
    this.listeners.push({ ref: picksRef, unsub: () => off(picksRef) });
  }

  // Commands - for online mode, sends to Cloud Function
  async sendCommand(gameId: string, playerId: string, rawText: string): Promise<CommandResponse> {
    const functionUrl = `https://us-central1-prompt-battle-c5e6a.cloudfunctions.net`;

    const response = await fetch(`${functionUrl}/processPlayerCommand`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ gameId, playerId, rawText }),
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Command failed (${response.status}): ${text}`);
    }

    return response.json();
  }

  // Game state sync
  onGameStateUpdate(gameId: string, callback: (state: Record<string, Character>) => void) {
    const stateRef = ref(this.db, `games/${gameId}/state/characters`);
    onValue(stateRef, (snap) => {
      const state = snap.val();
      if (state) callback(state);
    });
    this.listeners.push({ ref: stateRef, unsub: () => off(stateRef) });
  }

  // Update game state
  async updateGameState(gameId: string, characters: Record<string, Character>): Promise<void> {
    await update(ref(this.db, `games/${gameId}/state`), { characters });
  }

  async updateGameStatus(gameId: string, status: string, winner?: string): Promise<void> {
    const updates: Record<string, unknown> = { status };
    if (winner) updates.winner = winner;
    await update(ref(this.db, `games/${gameId}/meta`), updates);
  }

  // Log command to RTDB
  async logCommand(gameId: string, playerId: string, rawText: string, actions: unknown[]): Promise<void> {
    const cmdRef = push(ref(this.db, `games/${gameId}/commands`));
    await set(cmdRef, {
      playerId,
      rawText,
      actions,
      timestamp: Date.now(),
    });
  }

  // ─── ONLINE SYNC (Host-Authority Model) ─────────────────────

  // Host pushes full game state snapshot
  async pushSyncState(gameId: string, syncState: SyncSnapshot): Promise<void> {
    await set(ref(this.db, `games/${gameId}/sync`), syncState);
  }

  // Guest listens for state snapshots from host
  onSyncState(gameId: string, callback: (state: SyncSnapshot) => void) {
    const syncRef = ref(this.db, `games/${gameId}/sync`);
    onValue(syncRef, (snap) => {
      const state = snap.val();
      if (state) callback(state);
    });
    this.listeners.push({ ref: syncRef, unsub: () => off(syncRef) });
  }

  // Guest sends parsed orders to host
  async sendRemoteOrders(gameId: string, playerId: string, orders: RemoteOrderPayload[]): Promise<void> {
    const cmdRef = push(ref(this.db, `games/${gameId}/remoteOrders`));
    await set(cmdRef, { playerId, orders, timestamp: Date.now() });
  }

  // Host listens for guest's orders
  onRemoteOrders(gameId: string, callback: (data: { playerId: string; orders: RemoteOrderPayload[]; key: string }) => void) {
    const ordersRef = ref(this.db, `games/${gameId}/remoteOrders`);
    onChildAdded(ordersRef, (snap) => {
      const data = snap.val();
      if (data) callback({ ...data, key: snap.key! });
    });
    this.listeners.push({ ref: ordersRef, unsub: () => off(ordersRef) });
  }

  // Host cleans up processed orders
  async removeRemoteOrder(gameId: string, key: string): Promise<void> {
    await remove(ref(this.db, `games/${gameId}/remoteOrders/${key}`));
  }

  cleanup() {
    this.listeners.forEach(l => l.unsub());
    this.listeners = [];
  }
}

export interface SyncSnapshot {
  characters: Record<string, Character>;
  ctf: CTFState;
  timeRemaining: number;
  controlPoints: ControlPoint[];
  orderQueues: Record<string, CharacterOrder[]>;
  gameOver?: boolean;
  winner?: string;
  winReason?: string;
}

export interface RemoteOrderPayload {
  characterId: string;
  order: CharacterOrder;
  queued: boolean;
}
