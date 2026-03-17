import * as functions from 'firebase-functions';
import * as admin from 'firebase-admin';
import { getSquareClient, getSquareLocationId } from './square-client';
import { addCrowns, markFirstPurchaseUsed, logTransaction } from './inventory-helpers';
import { CROWN_PACKAGES } from '@prompt-battle/shared';

/**
 * Completes a Square payment using a card nonce (sourceId).
 * Called after the client tokenizes the card via Square Web Payments SDK.
 *
 * POST /api/store/completePayment
 * Body: { orderId: string, sourceId: string, packageId: string }
 * Headers: Authorization: Bearer <Firebase ID token>
 *
 * Returns: { success, crownsGranted, newBalance }
 */
export const completePayment = functions.https.onRequest(async (req, res) => {
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
      res.status(403).json({ error: 'Sign in with Google to make purchases' });
      return;
    }
  } catch {
    res.status(401).json({ error: 'Invalid authorization token' });
    return;
  }

  const { orderId, sourceId, packageId } = req.body;
  if (!orderId || !sourceId || !packageId) {
    res.status(400).json({ error: 'Missing orderId, sourceId, or packageId' });
    return;
  }

  // Validate package
  const pkg = CROWN_PACKAGES.find((p) => p.id === packageId);
  if (!pkg) {
    res.status(400).json({ error: 'Invalid package ID' });
    return;
  }

  const amountCents = Math.round(pkg.priceUSD * 100);

  // Create idempotency key to prevent double charges
  const idempotencyKey = `pay_${uid}_${orderId}`;

  try {
    const client = getSquareClient();

    // Charge the card
    const { result } = await client.paymentsApi.createPayment({
      sourceId,
      idempotencyKey,
      amountMoney: {
        amount: BigInt(amountCents),
        currency: 'USD',
      },
      orderId,
      locationId: getSquareLocationId(),
      note: `${pkg.name} for user ${uid}`,
    });

    const payment = result.payment;
    if (!payment || payment.status !== 'COMPLETED') {
      const errorDetail = payment?.status || 'unknown';
      await logTransaction({
        uid,
        type: 'crown_purchase',
        squareOrderId: orderId,
        squarePaymentId: payment?.id,
        itemIds: [packageId],
        amountCents,
        crownsChange: 0,
        status: 'failed',
      });
      res.status(400).json({ error: `Payment ${errorDetail}` });
      return;
    }

    // Payment succeeded — grant crowns
    let crownsToGrant = pkg.crowns;

    // Apply bonus percent
    if (pkg.bonusPercent > 0) {
      crownsToGrant += Math.floor(pkg.crowns * pkg.bonusPercent / 100);
    }

    // Check first purchase bonus (+50%)
    const wasFirst = await markFirstPurchaseUsed(uid);
    if (wasFirst) {
      crownsToGrant += Math.floor(pkg.crowns * 0.5);
    }

    const newBalance = await addCrowns(uid, crownsToGrant);

    // Log transaction
    await logTransaction({
      uid,
      type: 'crown_purchase',
      squareOrderId: orderId,
      squarePaymentId: payment.id,
      itemIds: [packageId],
      amountCents,
      crownsChange: crownsToGrant,
      status: 'completed',
    });

    res.json({
      success: true,
      crownsGranted: crownsToGrant,
      newBalance,
      firstPurchaseBonus: wasFirst,
    });
  } catch (err: any) {
    console.error('Square payment error:', err);

    // Log failed transaction
    await logTransaction({
      uid,
      type: 'crown_purchase',
      squareOrderId: orderId,
      itemIds: [packageId],
      amountCents,
      crownsChange: 0,
      status: 'failed',
    });

    res.status(500).json({ error: 'Payment processing failed' });
  }
});
