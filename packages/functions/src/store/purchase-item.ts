import * as functions from 'firebase-functions';
import * as admin from 'firebase-admin';
import { deductCrowns, deductGlory, grantItem, hasItem, logTransaction } from './inventory-helpers';
import { getCatalogItem } from '@prompt-battle/shared';

export const purchaseItem = functions.https.onRequest(async (req, res) => {
  // CORS headers
  res.set('Access-Control-Allow-Origin', '*');
  res.set('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.set('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') { res.status(204).send(''); return; }
  if (req.method !== 'POST') { res.status(405).json({ error: 'Method not allowed' }); return; }

  // Auth check
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) { res.status(401).json({ error: 'Missing auth' }); return; }
  let uid: string;
  try {
    const token = await admin.auth().verifyIdToken(authHeader.split('Bearer ')[1]);
    uid = token.uid;
  } catch { res.status(401).json({ error: 'Invalid token' }); return; }

  const { itemId, currency } = req.body; // currency: 'crowns' | 'glory'
  if (!itemId || !currency) { res.status(400).json({ error: 'Missing itemId or currency' }); return; }

  // Validate item exists
  const item = getCatalogItem(itemId);
  if (!item) { res.status(400).json({ error: 'Invalid item' }); return; }

  // Check if already owned
  if (await hasItem(uid, itemId)) { res.status(400).json({ error: 'Already owned' }); return; }

  // Get price
  let price: number;
  if (currency === 'glory') {
    if (item.priceGlory === null || item.priceGlory === undefined) {
      res.status(400).json({ error: 'Not purchasable with Glory' }); return;
    }
    price = item.priceGlory;
  } else {
    price = item.priceCrowns;
  }

  // Deduct currency
  const success = currency === 'glory'
    ? await deductGlory(uid, price)
    : await deductCrowns(uid, price);

  if (!success) { res.status(400).json({ error: `Not enough ${currency}` }); return; }

  // Grant item
  await grantItem(uid, itemId);

  // Log transaction
  await logTransaction({
    uid,
    type: currency === 'glory' ? 'glory_spend' : 'crown_spend',
    itemIds: [itemId],
    ...(currency === 'crowns' ? { crownsChange: -price } : { gloryChange: -price }),
    status: 'completed',
  });

  res.json({ success: true, itemId });
});
