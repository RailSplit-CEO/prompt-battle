import * as functions from 'firebase-functions';
import * as admin from 'firebase-admin';
import { deductCrowns, addGlory, logTransaction } from './inventory-helpers';

// Star packages — crowns to glory at a terrible exchange rate
const STAR_PACKAGES: Record<string, { crowns: number; stars: number }> = {
  stars_tiny:   { crowns: 100,   stars: 5 },
  stars_small:  { crowns: 250,   stars: 15 },
  stars_medium: { crowns: 500,   stars: 35 },
  stars_large:  { crowns: 1000,  stars: 80 },
  stars_mega:   { crowns: 2500,  stars: 220 },
  stars_ultra:  { crowns: 5000,  stars: 500 },
};

export const exchangeStars = functions.https.onRequest(async (req, res) => {
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

  const { packageId } = req.body;
  if (!packageId) { res.status(400).json({ error: 'Missing packageId' }); return; }

  const pkg = STAR_PACKAGES[packageId];
  if (!pkg) { res.status(400).json({ error: 'Invalid package' }); return; }

  // Deduct crowns
  const success = await deductCrowns(uid, pkg.crowns);
  if (!success) { res.status(400).json({ error: 'Not enough crowns' }); return; }

  // Grant glory (stars)
  const newGlory = await addGlory(uid, pkg.stars);

  // Log transaction
  await logTransaction({
    uid,
    type: 'crown_spend',
    itemIds: [packageId],
    crownsChange: -pkg.crowns,
    gloryChange: pkg.stars,
    status: 'completed',
  });

  res.json({ success: true, starsGranted: pkg.stars, newGlory });
});
