import { getDatabase, ref, onValue, off } from 'firebase/database';
import { getFirebaseApp } from '../auth/firebaseApp';
import type { PlayerBattlePass } from '@prompt-battle/shared';
import { CURRENT_SEASON } from '@prompt-battle/shared';

// ── BattlePassManager singleton ──────────────────────────────────
// Listens to /users/{uid}/battlePass/ in Firebase RTDB and keeps
// a local copy that any UI component can subscribe to.

const DEFAULT_BP: PlayerBattlePass = {
  season: CURRENT_SEASON.id,
  premium: false,
  premiumPlus: false,
  xp: 0,
  claimedFree: {},
  claimedPremium: {},
};

export class BattlePassManager {
  private static instance: BattlePassManager | null = null;
  private data: PlayerBattlePass = { ...DEFAULT_BP };
  private listeners: Array<(d: PlayerBattlePass) => void> = [];
  private unsubscribe: (() => void) | null = null;
  private uid: string | null = null;

  private constructor() {}

  static getInstance(): BattlePassManager {
    if (!BattlePassManager.instance) {
      BattlePassManager.instance = new BattlePassManager();
    }
    return BattlePassManager.instance;
  }

  // ── Lifecycle ───────────────────────────────────────────────────

  /** Start listening to battle pass updates for the given user. */
  init(uid: string): void {
    // Clean up any previous listener before starting a new one
    if (this.unsubscribe) {
      this.unsubscribe();
      this.unsubscribe = null;
    }

    this.uid = uid;
    this.data = { ...DEFAULT_BP };

    const db = getDatabase(getFirebaseApp());
    const bpRef = ref(db, `users/${uid}/battlePass`);

    const unsub = onValue(bpRef, (snapshot) => {
      if (snapshot.exists()) {
        const raw = snapshot.val();
        this.data = {
          season: raw.season ?? CURRENT_SEASON.id,
          premium: raw.premium ?? false,
          premiumPlus: raw.premiumPlus ?? false,
          xp: raw.xp ?? 0,
          claimedFree: raw.claimedFree ?? {},
          claimedPremium: raw.claimedPremium ?? {},
        };
      } else {
        this.data = { ...DEFAULT_BP };
      }

      // Notify all subscribers
      for (const cb of this.listeners) {
        cb({ ...this.data });
      }
    });

    this.unsubscribe = () => off(bpRef, 'value', unsub as any);
  }

  /** Stop listening and reset local state. */
  destroy(): void {
    if (this.unsubscribe) {
      this.unsubscribe();
      this.unsubscribe = null;
    }
    this.uid = null;
    this.data = { ...DEFAULT_BP };
    this.listeners = [];
  }

  // ── Accessors ───────────────────────────────────────────────────

  get xp(): number {
    return this.data.xp;
  }

  get premium(): boolean {
    return this.data.premium;
  }

  get premiumPlus(): boolean {
    return this.data.premiumPlus;
  }

  /** Find the highest tier where xpRequired <= current XP. */
  getCurrentTier(): number {
    for (let i = CURRENT_SEASON.tiers.length - 1; i >= 0; i--) {
      if (this.data.xp >= CURRENT_SEASON.tiers[i].xpRequired) {
        return CURRENT_SEASON.tiers[i].tier;
      }
    }
    return 0;
  }

  isFreeClaimed(tier: number): boolean {
    return !!this.data.claimedFree[tier];
  }

  isPremiumClaimed(tier: number): boolean {
    return !!this.data.claimedPremium[tier];
  }

  /** Get a snapshot of the current battle pass state. */
  getData(): PlayerBattlePass {
    return { ...this.data };
  }

  // ── Subscriptions ──────────────────────────────────────────────

  /** Subscribe to battle pass changes. Returns an unsubscribe function. */
  onChange(cb: (d: PlayerBattlePass) => void): () => void {
    this.listeners.push(cb);
    return () => {
      this.listeners = this.listeners.filter((l) => l !== cb);
    };
  }
}
