import { getAuth } from 'firebase/auth';
import { getFirebaseApp } from '../auth/firebaseApp';

// ── Dev Tools ───────────────────────────────────────────────────
// Console-accessible helper functions for testing the store system
// in development. Call installDevTools() once at app startup when
// running in dev mode.

function getFunctionsUrl(): string {
  return (import.meta as any).env?.VITE_FUNCTIONS_URL || '';
}

export async function adminCall(action: string, data: Record<string, any> = {}): Promise<any> {
  const auth = getAuth(getFirebaseApp());
  const user = auth.currentUser;
  if (!user) {
    console.error('Not signed in');
    return;
  }
  const token = await user.getIdToken();
  const res = await fetch(`${getFunctionsUrl()}/api/store/adminGrantItems`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
      'x-dev-mode': 'true',
    },
    body: JSON.stringify({ targetUid: user.uid, action, ...data }),
  });
  const result = await res.json();
  console.log('[DEV]', result);
  return result;
}

/** Install window-level dev commands for store testing. */
export function installDevTools(): void {
  if (typeof window === 'undefined') return;

  (window as any).__devAddCrowns = (amount: number) =>
    adminCall('add_crowns', { crowns: amount });

  (window as any).__devAddGlory = (amount: number) =>
    adminCall('add_glory', { glory: amount });

  (window as any).__devGrantItem = (itemId: string) =>
    adminCall('grant_item', { itemId });

  (window as any).__devGrantItems = (itemIds: string[]) =>
    adminCall('grant_items', { itemIds });

  (window as any).__devRevokeItem = (itemId: string) =>
    adminCall('revoke_item', { itemId });

  (window as any).__devClearInventory = () =>
    adminCall('clear_inventory');

  (window as any).__devToggleBattlePass = () =>
    adminCall('toggle_battlepass');

  (window as any).__devResetCharacter = async () => {
    if (!confirm('DELETE your account and ALL data? This cannot be undone.')) return;
    await adminCall('reset_character');
    // Sign out after server-side deletion
    try { await getAuth(getFirebaseApp()).signOut(); } catch { /* ok */ }
    window.location.reload();
  };

  (window as any).__devUnlockAll = async () => {
    const { STORE_CATALOG } = await import('@prompt-battle/shared');
    const allIds = STORE_CATALOG.map((i: any) => i.id);
    return adminCall('grant_items', { itemIds: allIds });
  };

  console.log(
    '[DEV] Store dev tools installed. Commands: ' +
      '__devAddCrowns(n), __devAddGlory(n), __devGrantItem(id), ' +
      '__devUnlockAll(), __devClearInventory()',
  );
}
