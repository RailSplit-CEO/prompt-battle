import * as functions from 'firebase-functions';
import * as admin from 'firebase-admin';
import * as crypto from 'crypto';
import { getSquareWebhookSignatureKey } from './square-client';

const db = () => admin.database();

/**
 * Handles Square webhook events (payment confirmations, refunds).
 *
 * POST /api/store/webhook/square
 */
export const squareWebhook = functions.https.onRequest(async (req, res) => {
  if (req.method !== 'POST') { res.status(405).send(''); return; }

  // Verify Square webhook signature
  const signatureKey = getSquareWebhookSignatureKey();
  if (signatureKey) {
    const signature = req.headers['x-square-hmacsha256-signature'] as string;
    const notificationUrl = `https://${req.hostname}${req.originalUrl}`;
    const body = JSON.stringify(req.body);

    const expectedSig = crypto
      .createHmac('sha256', signatureKey)
      .update(notificationUrl + body)
      .digest('base64');

    if (signature !== expectedSig) {
      console.warn('Invalid Square webhook signature');
      res.status(401).json({ error: 'Invalid signature' });
      return;
    }
  }

  const event = req.body;
  const eventType = event?.type;

  try {
    switch (eventType) {
      case 'payment.completed': {
        // Payment confirmed — we already grant on completePayment,
        // so this is a backup confirmation. Log it.
        const paymentId = event.data?.object?.payment?.id;
        console.log(`Webhook: payment.completed for ${paymentId}`);
        break;
      }

      case 'refund.created':
      case 'refund.updated': {
        const refund = event.data?.object?.refund;
        if (!refund) break;

        const paymentId = refund.payment_id;
        const refundAmountCents = Number(refund.amount_money?.amount || 0);

        console.log(`Webhook: refund for payment ${paymentId}, amount: ${refundAmountCents} cents`);

        // Find the transaction by squarePaymentId
        const txnSnap = await db().ref('transactions')
          .orderByChild('squarePaymentId')
          .equalTo(paymentId)
          .limitToFirst(1)
          .once('value');

        if (!txnSnap.exists()) {
          console.warn(`No transaction found for payment ${paymentId}`);
          break;
        }

        const txnEntries = txnSnap.val();
        const txnId = Object.keys(txnEntries)[0];
        const txn = txnEntries[txnId];

        if (txn.status === 'refunded') {
          console.log(`Transaction ${txnId} already refunded, skipping`);
          break;
        }

        // Mark transaction as refunded
        await db().ref(`transactions/${txnId}`).update({
          status: 'refunded',
          refundedAt: admin.database.ServerValue.TIMESTAMP,
        });

        // Deduct crowns from user (clamp to 0)
        const uid = txn.uid;
        const crownsToDeduct = txn.crownsChange || 0;

        if (uid && crownsToDeduct > 0) {
          const walletRef = db().ref(`users/${uid}/wallet`);
          await walletRef.transaction((current) => {
            if (!current) return current;
            return {
              ...current,
              crowns: Math.max(0, (current.crowns || 0) - crownsToDeduct),
            };
          });
          console.log(`Deducted ${crownsToDeduct} crowns from user ${uid} (refund)`);
        }
        break;
      }

      default:
        console.log(`Unhandled webhook event type: ${eventType}`);
    }

    res.status(200).json({ received: true });
  } catch (err: any) {
    console.error('Webhook processing error:', err);
    res.status(500).json({ error: 'Webhook processing failed' });
  }
});
