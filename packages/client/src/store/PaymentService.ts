import { getAuth } from 'firebase/auth';
import { getFirebaseApp } from '../auth/firebaseApp';
import type { CrownPackage } from '@prompt-battle/shared';

// ── Types ────────────────────────────────────────────────────────

export type PaymentPlatform = 'square' | 'itch' | 'test';

export interface PurchaseResult {
  success: boolean;
  crownsGranted?: number;
  newBalance?: number;
  firstPurchaseBonus?: boolean;
  error?: string;
}

// ── Helpers ──────────────────────────────────────────────────────

function detectPlatform(): PaymentPlatform {
  // Check for test / dev mode
  if (
    (import.meta as any).env?.VITE_DEV_MODE === 'true' ||
    localStorage.getItem('pb_dev') === 'true'
  ) {
    return 'test';
  }
  // Check for itch.io
  if (
    (import.meta as any).env?.VITE_PLATFORM === 'itch' ||
    window.location.hostname.includes('itch.zone')
  ) {
    return 'itch';
  }
  return 'square';
}

/** Get the Cloud Functions base URL from env. */
function getFunctionsUrl(): string {
  return (import.meta as any).env?.VITE_FUNCTIONS_URL || '';
}

/** Get a fresh Firebase ID token for authenticated requests. */
async function getIdToken(): Promise<string> {
  const auth = getAuth(getFirebaseApp());
  const user = auth.currentUser;
  if (!user) throw new Error('Not signed in');
  return user.getIdToken();
}

// ── PaymentService singleton ────────────────────────────────────
// Abstracts over Square / itch.io / test-mode payments so the UI
// layer never has to care which platform it's running on.

export class PaymentService {
  private static instance: PaymentService | null = null;
  private platform: PaymentPlatform;

  private constructor() {
    this.platform = detectPlatform();
  }

  static getInstance(): PaymentService {
    if (!PaymentService.instance) {
      PaymentService.instance = new PaymentService();
    }
    return PaymentService.instance;
  }

  getPlatform(): PaymentPlatform {
    return this.platform;
  }

  // ── Square flow ─────────────────────────────────────────────────

  /**
   * Create a Square order for a crown package.
   * Returns an orderId the payment form needs to complete the charge.
   */
  async createOrder(
    packageId: string,
  ): Promise<{ orderId: string; amount: number; crowns: number; bonusPercent: number }> {
    const token = await getIdToken();
    const res = await fetch(`${getFunctionsUrl()}/api/store/createOrder`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ packageId }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: 'Request failed' }));
      throw new Error(err.error || 'Failed to create order');
    }
    return res.json();
  }

  /** Complete a Square payment with the card nonce / source ID. */
  async completePayment(
    orderId: string,
    sourceId: string,
    packageId: string,
  ): Promise<PurchaseResult> {
    const token = await getIdToken();
    const res = await fetch(`${getFunctionsUrl()}/api/store/completePayment`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ orderId, sourceId, packageId }),
    });
    const data = await res.json();
    if (!res.ok) return { success: false, error: data.error };
    return data;
  }

  // ── Itch.io flow ────────────────────────────────────────────────

  /** Redeem an itch.io download key for crowns. */
  async redeemItchKey(key: string, packageId: string): Promise<PurchaseResult> {
    const token = await getIdToken();
    const res = await fetch(`${getFunctionsUrl()}/api/store/redeemItchKey`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ key, packageId }),
    });
    const data = await res.json();
    if (!res.ok) return { success: false, error: data.error };
    return data;
  }

  // ── In-game item purchases ──────────────────────────────────────

  /**
   * Purchase a catalog item with Crowns or Glory.
   * Deducting currency and granting items is handled server-side.
   */
  async purchaseItem(itemId: string, currency: 'crowns' | 'glory'): Promise<PurchaseResult> {
    const token = await getIdToken();
    const res = await fetch(`${getFunctionsUrl()}/api/store/purchaseItem`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
      body: JSON.stringify({ itemId, currency }),
    });
    const data = await res.json();
    if (!res.ok) return { success: false, error: data.error };
    return { success: true };
  }

  // ── Glory grants ────────────────────────────────────────────────

  /** Request a glory grant for a gameplay event (server validates). */
  async grantGlory(
    event: string,
    extra?: Record<string, any>,
  ): Promise<{ gloryGranted: number; breakdown?: Record<string, number> }> {
    const token = await getIdToken();
    const res = await fetch(`${getFunctionsUrl()}/api/store/grantGlory`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ event, ...extra }),
    });
    if (!res.ok) return { gloryGranted: 0 };
    return res.json();
  }
}
