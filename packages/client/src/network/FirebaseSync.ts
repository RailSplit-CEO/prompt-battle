import { initializeApp, FirebaseApp } from 'firebase/app';
import { getAuth, signInAnonymously, Auth, User } from 'firebase/auth';
import { getDatabase, ref, set, get, push, onValue, onChildAdded, update, remove, Database, off, runTransaction, onDisconnect } from 'firebase/database';
import { Hero, HeroOrder, CommandResponse, GameState } from '@prompt-battle/shared';

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

  // Atomic matchmaking using transaction on a semaphore node.
  // /matchmaking/waiting holds a single waiting player's ID, or null.
  // First player sets it to their ID (becomes player1, waits).
  // Second player claims it atomically (becomes player2, creates game).
  async findMatch(): Promise<MatchResult> {
    const playerId = this.getPlayerId();
    const waitingRef = ref(this.db, 'matchmaking/waiting');

    // Clean up on disconnect — if we're the one waiting, remove ourselves
    const disconnectRef = onDisconnect(waitingRef);

    let opponentId: string | null = null;

    const result = await runTransaction(waitingRef, (currentWaiting: string | null) => {
      if (!currentWaiting) {
        // Nobody waiting — we become the waiting player
        return playerId;
      }
      if (currentWaiting === playerId) {
        // Already waiting (reconnect case)
        return playerId;
      }
      // Someone else is waiting — capture their ID and claim the match
      opponentId = currentWaiting;
      return null; // clear the semaphore
    });

    if (!result.committed) {
      throw new Error('Matchmaking transaction failed');
    }

    const afterValue = result.snapshot.val();

    if (afterValue === playerId) {
      // We are player1, waiting for an opponent
      console.log('[Firebase] We are player1, waiting for opponent...');
      // Set up disconnect cleanup
      await disconnectRef.set(null);

      // Listen for our match node
      return this.waitForMatchAsPlayer1(playerId);
    }

    // We are player2 — we claimed the opponent
    console.log('[Firebase] We are player2, opponent:', opponentId);
    // Cancel disconnect handler since we're not waiting anymore
    await disconnectRef.cancel();

    const gameId = `game_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;

    // Create the game with correct roles
    const gameRef = ref(this.db, `games/${gameId}`);
    await set(gameRef, {
      meta: {
        player1: opponentId,
        player2: playerId,
        mapSeed: Date.now(),
        status: 'drafting',
        currentTurn: 0,
        createdAt: Date.now(),
      },
    });

    // Notify player1 by writing to their match node
    await set(ref(this.db, `matchmaking/matches/${opponentId}`), {
      gameId,
      amPlayer1: true,
    });

    console.log('[Firebase] Game created:', gameId, '(we are player2)');
    return { gameId, amPlayer1: false };
  }

  // Player1 waits for player2 to create the game and notify them
  private waitForMatchAsPlayer1(playerId: string): Promise<MatchResult> {
    return new Promise((resolve, reject) => {
      const matchRef = ref(this.db, `matchmaking/matches/${playerId}`);
      const timeout = setTimeout(() => {
        off(matchRef);
        // Clean up: remove ourselves from waiting
        runTransaction(ref(this.db, 'matchmaking/waiting'), (current) => {
          if (current === playerId) return null;
          return undefined;
        });
        reject(new Error('Matchmaking timed out after 60s'));
      }, 60000);

      onValue(matchRef, (snap) => {
        const data = snap.val();
        if (data?.gameId) {
          clearTimeout(timeout);
          off(matchRef);
          // Clean up the match notification node
          remove(matchRef);
          console.log('[Firebase] Match found:', data.gameId, '(we are player1)');
          resolve({ gameId: data.gameId, amPlayer1: true });
        }
      });
    });
  }

  async removeFromQueue(): Promise<void> {
    const playerId = this.getPlayerId();
    // Remove from waiting semaphore if we're the one waiting
    await runTransaction(ref(this.db, 'matchmaking/waiting'), (current) => {
      if (current === playerId) return null;
      return undefined; // abort if someone else is waiting
    });
    // Also clean up any match notification
    await remove(ref(this.db, `matchmaking/matches/${playerId}`));
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

  // Draft (legacy - not used in Animal Army)
  async submitDraftPick(gameId: string, pick: any): Promise<void> {
    const pickRef = push(ref(this.db, `games/${gameId}/draft/picks`));
    await set(pickRef, pick);
  }

  onDraftPick(gameId: string, callback: (pick: any) => void) {
    const picksRef = ref(this.db, `games/${gameId}/draft/picks`);
    onChildAdded(picksRef, (snap) => {
      const pick = snap.val();
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
  onGameStateUpdate(gameId: string, callback: (state: Record<string, Hero>) => void) {
    const stateRef = ref(this.db, `games/${gameId}/state/heroes`);
    onValue(stateRef, (snap) => {
      const state = snap.val();
      if (state) callback(state);
    });
    this.listeners.push({ ref: stateRef, unsub: () => off(stateRef) });
  }

  // Update game state
  async updateGameState(gameId: string, heroes: Record<string, Hero>): Promise<void> {
    await update(ref(this.db, `games/${gameId}/state`), { heroes });
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
  heroes: Record<string, Hero>;
  timeRemaining: number;
  gameOver?: boolean;
  winner?: string;
  winReason?: string;
}

export interface RemoteOrderPayload {
  heroId: string;
  order: HeroOrder;
}

export interface MatchResult {
  gameId: string;
  amPlayer1: boolean;
}
