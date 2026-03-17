import * as functions from 'firebase-functions';
import * as admin from 'firebase-admin';
import * as crypto from 'crypto';
import { addCrowns, logTransaction } from './inventory-helpers';
import { CROWN_PACKAGES } from '@prompt-battle/shared';

const db = () => admin.database();

function getItchApiKey(): string {
  const config = functions.config();
  return config.itch?.api_key || process.env.ITCH_API_KEY || '';
}

function getItchGameId(): string {
  const config = functions.config();
  return config.itch?.game_id || process.env.ITCH_GAME_ID || '';
}

/**
 * Redeems an itch.io download/reward key for Crowns.
 * Verifies the key via itch.io server API, then grants Crowns.
 *
 * POST /api/store/redeemItchKey
 * Body: { key: string, packageId: string }
 * Headers: Authorization: Bearer <Firebase ID token>
 */
export const redeemItchKey = functions.https.onRequest(async (req, res) => {
  // CORS
  res.set('Access-Control-Allow-Origin', '*');
  res.set('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.set('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') { res.status(204).send(''); return; }
  if (req.method !== 'POST') { res.status(405).json({ error: 'Method not allowed' }); return; }

  // Verify Firebase auth
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Missing authorization token' });
    return;
  }
  let uid: string;
  try {
    const token = await admin.auth().verifyIdToken(authHeader.split('Bearer ')[1]);
    uid = token.uid;
    if (token.firebase?.sign_in_provider === 'anonymous') {
      res.status(403).json({ error: 'Sign in with Google to redeem keys' });
      return;
    }
  } catch {
    res.status(401).json({ error: 'Invalid authorization token' });
    return;
  }

  const { key, packageId } = req.body;
  if (!key || !packageId) {
    res.status(400).json({ error: 'Missing key or packageId' });
    return;
  }

  // Validate package
  const pkg = CROWN_PACKAGES.find((p) => p.id === packageId);
  if (!pkg) {
    res.status(400).json({ error: 'Invalid package ID' });
    return;
  }

  // Hash the key to check for reuse (don't store raw keys)
  const keyHash = crypto.createHash('sha256').update(key.trim()).digest('hex');

  // Check if already redeemed
  const existingSnap = await db().ref(`redeemedKeys/${keyHash}`).once('value');
  if (existingSnap.exists()) {
    res.status(400).json({ error: 'This key has already been redeemed' });
    return;
  }

  // Verify key with itch.io API
  const apiKey = getItchApiKey();
  const gameId = getItchGameId();

  if (!apiKey || !gameId) {
    console.error('itch.io API key or game ID not configured');
    res.status(500).json({ error: 'itch.io integration not configured' });
    return;
  }

  try {
    const itchUrl = `https://itch.io/api/1/${apiKey}/game/${gameId}/download_keys?key=${encodeURIComponent(key.trim())}`;
    const response = await fetch(itchUrl);
    const data = await response.json();

    if (!response.ok || data.errors || !data.download_key) {
      res.status(400).json({ error: 'Invalid itch.io key' });
      return;
    }

    // Key is valid — mark as redeemed atomically
    const redeemRef = db().ref(`redeemedKeys/${keyHash}`);
    const txnResult = await redeemRef.transaction((current) => {
      if (current) return; // already exists, abort
      return {
        uid,
        timestamp: Date.now(),
        packageId,
        crowns: pkg.crowns,
      };
    });

    if (!txnResult.committed) {
      res.status(400).json({ error: 'This key has already been redeemed' });
      return;
    }

    // Grant crowns (include bonus percent but not first-purchase bonus for itch keys)
    let crownsToGrant = pkg.crowns;
    if (pkg.bonusPercent > 0) {
      crownsToGrant += Math.floor(pkg.crowns * pkg.bonusPercent / 100);
    }

    const newBalance = await addCrowns(uid, crownsToGrant);

    await logTransaction({
      uid,
      type: 'itch_redeem',
      itchKeyHash: keyHash,
      itemIds: [packageId],
      crownsChange: crownsToGrant,
      status: 'completed',
    });

    res.json({
      success: true,
      crownsGranted: crownsToGrant,
      newBalance,
    });
  } catch (err: any) {
    console.error('itch.io key verification error:', err);
    res.status(500).json({ error: 'Failed to verify itch.io key' });
  }
});
