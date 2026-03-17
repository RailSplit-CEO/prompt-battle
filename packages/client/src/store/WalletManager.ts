import { getDatabase, ref, onValue, off } from 'firebase/database';
import { getFirebaseApp } from '../auth/firebaseApp';
import type { Wallet } from '@prompt-battle/shared';
import { DEFAULT_WALLET } from '@prompt-battle/shared';

// ── WalletManager singleton ─────────────────────────────────────
// Listens to /users/{uid}/wallet/ in Firebase RTDB and keeps a
// local copy that any UI component can subscribe to.

export class WalletManager {
  private static instance: WalletManager | null = null;
  private wallet: Wallet = { ...DEFAULT_WALLET };
  private listeners: Array<(w: Wallet) => void> = [];
  private unsubscribe: (() => void) | null = null;
  private uid: string | null = null;

  private constructor() {}

  static getInstance(): WalletManager {
    if (!WalletManager.instance) {
      WalletManager.instance = new WalletManager();
    }
    return WalletManager.instance;
  }

  // ── Lifecycle ───────────────────────────────────────────────────

  /** Start listening to wallet updates for the given user. */
  init(uid: string): void {
    // Clean up any previous listener before starting a new one
    if (this.unsubscribe) {
      this.unsubscribe();
      this.unsubscribe = null;
    }

    this.uid = uid;
    this.wallet = { ...DEFAULT_WALLET };

    const db = getDatabase(getFirebaseApp());
    const walletRef = ref(db, `users/${uid}/wallet`);

    const unsub = onValue(walletRef, (snapshot) => {
      if (snapshot.exists()) {
        const data = snapshot.val();
        this.wallet = {
          crowns: data.crowns ?? 0,
          glory: data.glory ?? 0,
          totalCrownsPurchased: data.totalCrownsPurchased ?? 0,
          totalCrownsSpent: data.totalCrownsSpent ?? 0,
          totalGlorySpent: data.totalGlorySpent ?? 0,
          firstPurchaseUsed: data.firstPurchaseUsed ?? false,
        };
      } else {
        this.wallet = { ...DEFAULT_WALLET };
      }

      // Notify all subscribers
      for (const cb of this.listeners) {
        cb({ ...this.wallet });
      }
    });

    this.unsubscribe = () => off(walletRef, 'value', unsub as any);
  }

  /** Stop listening and reset local state. */
  destroy(): void {
    if (this.unsubscribe) {
      this.unsubscribe();
      this.unsubscribe = null;
    }
    this.uid = null;
    this.wallet = { ...DEFAULT_WALLET };
    this.listeners = [];
  }

  // ── Accessors ───────────────────────────────────────────────────

  /** Get a snapshot of the current wallet state. */
  getWallet(): Wallet {
    return { ...this.wallet };
  }

  get crowns(): number {
    return this.wallet.crowns;
  }

  get glory(): number {
    return this.wallet.glory;
  }

  get isFirstPurchase(): boolean {
    return !this.wallet.firstPurchaseUsed;
  }

  // ── Subscriptions ───────────────────────────────────────────────

  /** Subscribe to wallet changes. Returns an unsubscribe function. */
  onChange(cb: (w: Wallet) => void): () => void {
    this.listeners.push(cb);
    return () => {
      this.listeners = this.listeners.filter((l) => l !== cb);
    };
  }
}
