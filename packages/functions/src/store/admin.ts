import * as functions from 'firebase-functions';
import * as admin from 'firebase-admin';
import { addCrowns, addGlory, grantItem, grantItems, revokeItem, logTransaction } from './inventory-helpers';

/**
 * Admin tool for granting/revoking items and currency.
 * Used for testing and customer support.
 *
 * Requires either:
 * - Firebase custom claim: { admin: true }
 * - Dev mode header: x-dev-mode: true (only works in emulator/sandbox)
 *
 * POST /api/store/adminGrant
 * Body: { targetUid, action, itemId?, itemIds?, crowns?, glory? }
 */
export const adminGrantItems = functions.https.onRequest(async (req, res) => {
  // CORS
  res.set('Access-Control-Allow-Origin', '*');
  res.set('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.set('Access-Control-Allow-Headers', 'Content-Type, Authorization, x-dev-mode');
  if (req.method === 'OPTIONS') { res.status(204).send(''); return; }
  if (req.method !== 'POST') { res.status(405).json({ error: 'Method not allowed' }); return; }

  // Check authorization
  const config = functions.config();
  const isEmulator = process.env.FUNCTIONS_EMULATOR === 'true';
  const isSandbox = (config.square?.environment || process.env.SQUARE_ENVIRONMENT) !== 'production';
  const devModeHeader = req.headers['x-dev-mode'] === 'true';

  // In emulator/sandbox, allow dev mode header
  if (devModeHeader && (isEmulator || isSandbox)) {
    // Allowed — dev mode
  } else {
    // Require admin custom claim
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith('Bearer ')) {
      res.status(401).json({ error: 'Missing authorization' });
      return;
    }
    try {
      const token = await admin.auth().verifyIdToken(authHeader.split('Bearer ')[1]);
      if (!token.admin) {
        res.status(403).json({ error: 'Admin access required' });
        return;
      }
    } catch {
      res.status(401).json({ error: 'Invalid token' });
      return;
    }
  }

  const { targetUid, action, itemId, itemIds, crowns, glory } = req.body;

  if (!targetUid || !action) {
    res.status(400).json({ error: 'Missing targetUid or action' });
    return;
  }

  try {
    switch (action) {
      case 'grant_item':
        if (!itemId) { res.status(400).json({ error: 'Missing itemId' }); return; }
        await grantItem(targetUid, itemId);
        res.json({ success: true, action: 'granted', itemId });
        break;

      case 'grant_items':
        if (!itemIds?.length) { res.status(400).json({ error: 'Missing itemIds' }); return; }
        await grantItems(targetUid, itemIds);
        res.json({ success: true, action: 'granted', itemIds });
        break;

      case 'revoke_item':
        if (!itemId) { res.status(400).json({ error: 'Missing itemId' }); return; }
        await revokeItem(targetUid, itemId);
        res.json({ success: true, action: 'revoked', itemId });
        break;

      case 'add_crowns':
        if (!crowns || crowns <= 0) { res.status(400).json({ error: 'Invalid crowns amount' }); return; }
        const newCrowns = await addCrowns(targetUid, crowns);
        await logTransaction({
          uid: targetUid,
          type: 'crown_purchase',
          itemIds: [],
          crownsChange: crowns,
          status: 'completed',
        });
        res.json({ success: true, action: 'added_crowns', crowns, newBalance: newCrowns });
        break;

      case 'add_glory':
        if (!glory || glory <= 0) { res.status(400).json({ error: 'Invalid glory amount' }); return; }
        const newGlory = await addGlory(targetUid, glory);
        res.json({ success: true, action: 'added_glory', glory, newBalance: newGlory });
        break;

      case 'clear_inventory':
        await admin.database().ref(`users/${targetUid}/inventory`).remove();
        await admin.database().ref(`users/${targetUid}/wallet`).remove();
        await admin.database().ref(`users/${targetUid}/equipped`).remove();
        res.json({ success: true, action: 'cleared' });
        break;

      default:
        res.status(400).json({ error: `Unknown action: ${action}` });
    }
  } catch (err: any) {
    console.error('Admin action error:', err);
    res.status(500).json({ error: 'Admin action failed' });
  }
});
