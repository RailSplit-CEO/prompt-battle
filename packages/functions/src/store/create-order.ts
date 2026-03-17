import * as functions from 'firebase-functions';
import * as admin from 'firebase-admin';
import { getSquareClient, getSquareLocationId } from './square-client';
import { CROWN_PACKAGES } from '@prompt-battle/shared';

/**
 * Creates a Square order for a Crown package purchase.
 * Called by the client before presenting the payment form.
 *
 * POST /api/store/createOrder
 * Body: { packageId: string }
 * Headers: Authorization: Bearer <Firebase ID token>
 *
 * Returns: { orderId, amount, currency }
 */
export const createOrder = functions.https.onRequest(async (req, res) => {
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
    // Block anonymous users from purchasing
    if (token.firebase?.sign_in_provider === 'anonymous') {
      res.status(403).json({ error: 'Sign in with Google to make purchases' });
      return;
    }
  } catch {
    res.status(401).json({ error: 'Invalid authorization token' });
    return;
  }

  const { packageId } = req.body;
  if (!packageId) {
    res.status(400).json({ error: 'Missing packageId' });
    return;
  }

  // Look up package from server-side catalog (prevents price manipulation)
  const pkg = CROWN_PACKAGES.find((p) => p.id === packageId);
  if (!pkg) {
    res.status(400).json({ error: 'Invalid package ID' });
    return;
  }

  const amountCents = Math.round(pkg.priceUSD * 100);

  try {
    const client = getSquareClient();
    const locationId = getSquareLocationId();

    // Create idempotency key from uid + packageId + timestamp window (5 min)
    const timeWindow = Math.floor(Date.now() / (5 * 60 * 1000));
    const idempotencyKey = `${uid}_${packageId}_${timeWindow}`;

    const { result } = await client.ordersApi.createOrder({
      order: {
        locationId,
        lineItems: [
          {
            name: `${pkg.name} (${pkg.crowns} Crowns)`,
            quantity: '1',
            basePriceMoney: {
              amount: BigInt(amountCents),
              currency: 'USD',
            },
          },
        ],
        metadata: {
          uid,
          packageId,
          crowns: String(pkg.crowns),
          bonusPercent: String(pkg.bonusPercent),
        },
      },
      idempotencyKey,
    });

    const orderId = result.order?.id;
    if (!orderId) {
      res.status(500).json({ error: 'Failed to create order' });
      return;
    }

    res.json({
      orderId,
      amount: amountCents,
      currency: 'USD',
      crowns: pkg.crowns,
      bonusPercent: pkg.bonusPercent,
    });
  } catch (err: any) {
    console.error('Square createOrder error:', err);
    res.status(500).json({ error: 'Payment service error' });
  }
});
