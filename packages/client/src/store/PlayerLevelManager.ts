import { getDatabase, ref, onValue, off } from 'firebase/database';
import { getFirebaseApp } from '../auth/firebaseApp';
import type { PlayerLevel } from '@prompt-battle/shared';
import {
  DEFAULT_PLAYER_LEVEL,
  getLevelForTotalXp,
  getXpInCurrentLevel,
  getXpForNextLevel,
} from '@prompt-battle/shared';

// ── PlayerLevelManager singleton ────────────────────────────────
// Listens to /users/{uid}/playerLevel/ in Firebase RTDB and keeps
// a local copy that any UI component can subscribe to.

export class PlayerLevelManager {
  private static instance: PlayerLevelManager | null = null;
  private data: PlayerLevel = { ...DEFAULT_PLAYER_LEVEL };
  private listeners: Array<(d: PlayerLevel) => void> = [];
  private unsubscribe: (() => void) | null = null;
  private uid: string | null = null;

  private constructor() {}

  static getInstance(): PlayerLevelManager {
    if (!PlayerLevelManager.instance) {
      PlayerLevelManager.instance = new PlayerLevelManager();
    }
    return PlayerLevelManager.instance;
  }

  // ── Lifecycle ───────────────────────────────────────────────────

  /** Start listening to player level updates for the given user. */
  init(uid: string): void {
    // Clean up any previous listener before starting a new one
    if (this.unsubscribe) {
      this.unsubscribe();
      this.unsubscribe = null;
    }

    this.uid = uid;
    this.data = { ...DEFAULT_PLAYER_LEVEL };

    const db = getDatabase(getFirebaseApp());
    const levelRef = ref(db, `users/${uid}/playerLevel`);

    const unsub = onValue(levelRef, (snapshot) => {
      if (snapshot.exists()) {
        const raw = snapshot.val();
        this.data = {
          level: raw.level ?? 1,
          xp: raw.xp ?? 0,
          totalXp: raw.totalXp ?? 0,
          lastMatchXp: raw.lastMatchXp ?? 0,
        };
      } else {
        this.data = { ...DEFAULT_PLAYER_LEVEL };
      }

      // Notify all subscribers
      for (const cb of this.listeners) {
        cb({ ...this.data });
      }
    });

    this.unsubscribe = () => off(levelRef, 'value', unsub as any);
  }

  /** Stop listening and reset local state. */
  destroy(): void {
    if (this.unsubscribe) {
      this.unsubscribe();
      this.unsubscribe = null;
    }
    this.uid = null;
    this.data = { ...DEFAULT_PLAYER_LEVEL };
    this.listeners = [];
  }

  // ── Accessors ───────────────────────────────────────────────────

  get level(): number {
    return this.data.level;
  }

  get xp(): number {
    return this.data.xp;
  }

  get totalXp(): number {
    return this.data.totalXp;
  }

  get lastMatchXp(): number {
    return this.data.lastMatchXp;
  }

  get xpForNext(): number {
    return getXpForNextLevel(this.data.level);
  }

  get xpInLevel(): number {
    return getXpInCurrentLevel(this.data.totalXp);
  }

  // ── Subscriptions ─────────────────────────────────────────────

  /** Subscribe to player level changes. Returns an unsubscribe function. */
  onChange(cb: (d: PlayerLevel) => void): () => void {
    this.listeners.push(cb);
    return () => {
      this.listeners = this.listeners.filter((l) => l !== cb);
    };
  }
}
