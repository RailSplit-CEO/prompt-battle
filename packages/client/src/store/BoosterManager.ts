import { getDatabase, ref, onValue, set, remove, off } from 'firebase/database';
import { getFirebaseApp } from '../auth/firebaseApp';

// ── Booster durations (ms) ────────────────────────────────────────
export const BOOSTER_DURATIONS: Record<string, number> = {
  glory_2x: 3_600_000, // 60 min
  xp_2x: 3_600_000, // 60 min
};

// ── BoosterManager singleton ──────────────────────────────────────
// Listens to /users/{uid}/activeBoosters/ in Firebase RTDB and keeps
// a local map of active boosters that any UI component can subscribe to.

export class BoosterManager {
  private static instance: BoosterManager | null = null;
  private boosters: Map<string, { expiresAt: number }> = new Map();
  private listeners: Array<() => void> = [];
  private unsubscribe: (() => void) | null = null;
  private uid: string | null = null;

  private constructor() {}

  static getInstance(): BoosterManager {
    if (!BoosterManager.instance) {
      BoosterManager.instance = new BoosterManager();
    }
    return BoosterManager.instance;
  }

  // ── Lifecycle ───────────────────────────────────────────────────

  /** Start listening to active boosters for the given user. */
  init(uid: string): void {
    // Clean up any previous listener before starting a new one
    if (this.unsubscribe) {
      this.unsubscribe();
      this.unsubscribe = null;
    }

    this.uid = uid;
    this.boosters = new Map();

    const db = getDatabase(getFirebaseApp());
    const boostersRef = ref(db, `users/${uid}/activeBoosters`);

    const unsub = onValue(boostersRef, (snapshot) => {
      this.boosters = new Map();

      if (snapshot.exists()) {
        const data = snapshot.val() as Record<string, { expiresAt: number }>;
        const now = Date.now();
        const expiredKeys: string[] = [];

        for (const [type, value] of Object.entries(data)) {
          if (value && typeof value.expiresAt === 'number') {
            if (value.expiresAt > now) {
              this.boosters.set(type, { expiresAt: value.expiresAt });
            } else {
              expiredKeys.push(type);
            }
          }
        }

        // Auto-cleanup: remove expired boosters from Firebase
        for (const key of expiredKeys) {
          const expiredRef = ref(db, `users/${uid}/activeBoosters/${key}`);
          remove(expiredRef);
        }
      }

      // Notify all subscribers
      for (const cb of this.listeners) {
        cb();
      }
    });

    this.unsubscribe = () => off(boostersRef, 'value', unsub as any);
  }

  /** Stop listening and reset local state. */
  destroy(): void {
    if (this.unsubscribe) {
      this.unsubscribe();
      this.unsubscribe = null;
    }
    this.uid = null;
    this.boosters = new Map();
    this.listeners = [];
  }

  // ── Accessors ───────────────────────────────────────────────────

  /** Check if a booster is currently active (exists and not expired). */
  isActive(type: string): boolean {
    const booster = this.boosters.get(type);
    if (!booster) return false;
    return booster.expiresAt > Date.now();
  }

  /** Get remaining time in ms for a booster, or 0 if expired/missing. */
  getTimeRemaining(type: string): number {
    const booster = this.boosters.get(type);
    if (!booster) return 0;
    return Math.max(0, booster.expiresAt - Date.now());
  }

  /** Get all currently active (non-expired) boosters. */
  getActiveBoosters(): { type: string; expiresAt: number }[] {
    const now = Date.now();
    const result: { type: string; expiresAt: number }[] = [];
    for (const [type, { expiresAt }] of this.boosters) {
      if (expiresAt > now) {
        result.push({ type, expiresAt });
      }
    }
    return result;
  }

  // ── Mutations ─────────────────────────────────────────────────

  /** Activate a booster by writing it to Firebase. */
  async activateBooster(type: string, durationMs: number): Promise<void> {
    if (!this.uid) return;
    const db = getDatabase(getFirebaseApp());
    const boosterRef = ref(db, `users/${this.uid}/activeBoosters/${type}`);
    await set(boosterRef, { expiresAt: Date.now() + durationMs });
  }

  /** Deactivate a booster by removing it from Firebase. */
  async deactivateBooster(type: string): Promise<void> {
    if (!this.uid) return;
    const db = getDatabase(getFirebaseApp());
    const boosterRef = ref(db, `users/${this.uid}/activeBoosters/${type}`);
    await remove(boosterRef);
  }

  // ── Subscriptions ─────────────────────────────────────────────

  /** Subscribe to booster changes. Returns an unsubscribe function. */
  onChange(cb: () => void): () => void {
    this.listeners.push(cb);
    return () => {
      this.listeners = this.listeners.filter((l) => l !== cb);
    };
  }
}
