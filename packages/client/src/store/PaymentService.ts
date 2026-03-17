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
  if (
    (import.meta as any).env?.VITE_DEV_MODE === 'true' ||
    localStorage.getItem('pb_dev') === 'true'
  ) {
    return 'test';
  }
  if (
    (import.meta as any).env?.VITE_PLATFORM === 'itch' ||
    window.location.hostname.includes('itch.zone')
  ) {
    return 'itch';
  }
  return 'square';
}

function getFunctionsUrl(): string {
  // Explicit env override takes priority
  return (import.meta as any).env?.VITE_FUNCTIONS_URL || '';
  // Empty string = relative URLs. Works in:
  //   - Production: Firebase Hosting rewrites /api/store/* → Cloud Functions
  //   - Dev: Vite proxy in vite.config.ts rewrites /api/store/* → deployed Cloud Functions
}

async function getIdToken(): Promise<string> {
  const auth = getAuth(getFirebaseApp());
  const user = auth.currentUser;
  if (!user) throw new Error('Not signed in');
  return user.getIdToken();
}

/** Safely parse JSON from a response — returns fallback on failure */
async function safeJson(res: Response, fallback: any = {}): Promise<any> {
  try {
    const text = await res.text();
    if (!text) return fallback;
    return JSON.parse(text);
  } catch {
    return fallback;
  }
}

/** Make an authenticated POST to a Cloud Function endpoint */
async function apiPost(path: string, body: Record<string, any>): Promise<{ res: Response; data: any }> {
  const baseUrl = getFunctionsUrl();
  const token = await getIdToken();
  const res = await fetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`,
    },
    body: JSON.stringify(body),
  });
  const data = await safeJson(res, { error: `Server returned ${res.status}` });
  return { res, data };
}

// ── PaymentService singleton ────────────────────────────────────

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

  async createOrder(
    packageId: string,
  ): Promise<{ orderId: string; amount: number; crowns: number; bonusPercent: number }> {
    const { res, data } = await apiPost('/api/store/createOrder', { packageId });
    if (!res.ok) throw new Error(data.error || 'Failed to create order');
    return data;
  }

  async completePayment(
    orderId: string,
    sourceId: string,
    packageId: string,
  ): Promise<PurchaseResult> {
    try {
      const { res, data } = await apiPost('/api/store/completePayment', { orderId, sourceId, packageId });
      if (!res.ok) return { success: false, error: data.error || 'Payment failed' };
      return data;
    } catch (err: any) {
      return { success: false, error: err.message || 'Payment request failed' };
    }
  }

  // ── Itch.io flow ────────────────────────────────────────────────

  async redeemItchKey(key: string, packageId: string): Promise<PurchaseResult> {
    try {
      const { res, data } = await apiPost('/api/store/redeemItchKey', { key, packageId });
      if (!res.ok) return { success: false, error: data.error || 'Key redemption failed' };
      return data;
    } catch (err: any) {
      return { success: false, error: err.message || 'Key redemption request failed' };
    }
  }

  // ── In-game item purchases ──────────────────────────────────────

  async purchaseItem(itemId: string, currency: 'crowns' | 'glory'): Promise<PurchaseResult> {
    try {
      const { res, data } = await apiPost('/api/store/purchaseItem', { itemId, currency });
      if (!res.ok) return { success: false, error: data.error || 'Purchase failed' };
      return { success: true };
    } catch (err: any) {
      return { success: false, error: err.message || 'Purchase request failed' };
    }
  }

  // ── Glory grants ────────────────────────────────────────────────

  async grantGlory(
    event: string,
    extra?: Record<string, any>,
  ): Promise<{ gloryGranted: number; breakdown?: Record<string, number> }> {
    try {
      const { res, data } = await apiPost('/api/store/grantGlory', { event, ...extra });
      if (!res.ok) return { gloryGranted: 0 };
      return data;
    } catch {
      return { gloryGranted: 0 };
    }
  }
}
