import * as admin from 'firebase-admin';

const db = () => admin.database();

function stripUndefined<T>(value: T): T {
  if (Array.isArray(value)) {
    return value.map((item) => stripUndefined(item)) as T;
  }
  if (value && typeof value === 'object') {
    const clean: Record<string, unknown> = {};
    for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
      if (nested !== undefined) {
        clean[key] = stripUndefined(nested);
      }
    }
    return clean as T;
  }
  return value;
}

// ─── Currency Operations (atomic via transaction) ───────────────

export async function addCrowns(uid: string, amount: number): Promise<number> {
  const walletRef = db().ref(`users/${uid}/wallet`);
  const result = await walletRef.transaction((current) => {
    if (!current) {
      return {
        crowns: amount,
        glory: 0,
        totalCrownsPurchased: amount,
        totalCrownsSpent: 0,
        totalGlorySpent: 0,
        firstPurchaseUsed: false,
      };
    }
    return {
      ...current,
      crowns: (current.crowns || 0) + amount,
      totalCrownsPurchased: (current.totalCrownsPurchased || 0) + amount,
    };
  });
  return result.snapshot.val()?.crowns ?? 0;
}

export async function deductCrowns(uid: string, amount: number): Promise<boolean> {
  const walletRef = db().ref(`users/${uid}/wallet`);
  let success = false;
  await walletRef.transaction((current) => {
    if (!current || (current.crowns || 0) < amount) {
      success = false;
      return; // abort
    }
    success = true;
    return {
      ...current,
      crowns: current.crowns - amount,
      totalCrownsSpent: (current.totalCrownsSpent || 0) + amount,
    };
  });
  return success;
}

export async function addGlory(uid: string, amount: number): Promise<number> {
  const walletRef = db().ref(`users/${uid}/wallet`);
  const result = await walletRef.transaction((current) => {
    if (!current) {
      return {
        crowns: 0,
        glory: amount,
        totalCrownsPurchased: 0,
        totalCrownsSpent: 0,
        totalGlorySpent: 0,
        firstPurchaseUsed: false,
      };
    }
    return {
      ...current,
      glory: (current.glory || 0) + amount,
    };
  });
  return result.snapshot.val()?.glory ?? 0;
}

export async function deductGlory(uid: string, amount: number): Promise<boolean> {
  const walletRef = db().ref(`users/${uid}/wallet`);
  let success = false;
  await walletRef.transaction((current) => {
    if (!current || (current.glory || 0) < amount) {
      success = false;
      return;
    }
    success = true;
    return {
      ...current,
      glory: current.glory - amount,
      totalGlorySpent: (current.totalGlorySpent || 0) + amount,
    };
  });
  return success;
}

export async function markFirstPurchaseUsed(uid: string): Promise<boolean> {
  const walletRef = db().ref(`users/${uid}/wallet`);
  let wasFirst = false;
  await walletRef.transaction((current) => {
    if (!current) return current;
    if (!current.firstPurchaseUsed) {
      wasFirst = true;
      return { ...current, firstPurchaseUsed: true };
    }
    wasFirst = false;
    return current;
  });
  return wasFirst;
}

// ─── Inventory Operations ───────────────────────────────────────

export async function grantItem(uid: string, itemId: string): Promise<void> {
  await db().ref(`users/${uid}/inventory/${itemId}`).set(true);
}

export async function grantItems(uid: string, itemIds: string[]): Promise<void> {
  const updates: Record<string, boolean> = {};
  for (const id of itemIds) {
    updates[`users/${uid}/inventory/${id}`] = true;
  }
  await db().ref().update(updates);
}

export async function revokeItem(uid: string, itemId: string): Promise<void> {
  await db().ref(`users/${uid}/inventory/${itemId}`).remove();
}

export async function hasItem(uid: string, itemId: string): Promise<boolean> {
  const snap = await db().ref(`users/${uid}/inventory/${itemId}`).once('value');
  return snap.val() === true;
}

// ─── Transaction Logging ────────────────────────────────────────

export async function logTransaction(data: {
  uid: string;
  type: string;
  squareOrderId?: string;
  squarePaymentId?: string;
  itchKeyHash?: string;
  itemIds: string[];
  amountCents?: number;
  crownsChange?: number;
  gloryChange?: number;
  status: string;
}): Promise<string> {
  const txnRef = db().ref('transactions').push();
  await txnRef.set(stripUndefined({
    ...data,
    createdAt: admin.database.ServerValue.TIMESTAMP,
    completedAt: data.status === 'completed' ? admin.database.ServerValue.TIMESTAMP : null,
  }));
  return txnRef.key!;
}

export async function updateTransactionStatus(
  txnId: string,
  status: string,
): Promise<void> {
  await db().ref(`transactions/${txnId}`).update({
    status,
    ...(status === 'completed' ? { completedAt: admin.database.ServerValue.TIMESTAMP } : {}),
  });
}
