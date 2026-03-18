import * as functions from 'firebase-functions';
import * as admin from 'firebase-admin';
import { deductCrowns, addCrowns, addGlory, grantItem, logTransaction } from './inventory-helpers';
import { CURRENT_SEASON } from '@prompt-battle/shared';

const db = () => admin.database();

// ─── Helpers ──────────────────────────────────────────────────────

function cors(res: functions.Response): void {
  res.set('Access-Control-Allow-Origin', '*');
  res.set('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.set('Access-Control-Allow-Headers', 'Content-Type, Authorization');
}

async function verifyAuth(req: functions.Request): Promise<string> {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) throw new Error('Missing authorization token');
  const token = await admin.auth().verifyIdToken(authHeader.split('Bearer ')[1]);
  return token.uid;
}

function getDefaultBattlePass() {
  return {
    season: CURRENT_SEASON.id,
    premium: false,
    premiumPlus: false,
    xp: 0,
    claimedFree: {},
    claimedPremium: {},
  };
}

function getCurrentTier(xp: number): number {
  let tier = 0;
  for (const t of CURRENT_SEASON.tiers) {
    if (xp >= t.xpRequired) tier = t.tier;
    else break;
  }
  return tier;
}

// ─── A) purchaseBattlePass ────────────────────────────────────────

export const purchaseBattlePass = functions.https.onRequest(async (req, res) => {
  cors(res);
  if (req.method === 'OPTIONS') { res.status(204).send(''); return; }
  if (req.method !== 'POST') { res.status(405).json({ error: 'Method not allowed' }); return; }

  let uid: string;
  try {
    uid = await verifyAuth(req);
  } catch {
    res.status(401).json({ error: 'Invalid token' });
    return;
  }

  const { tier } = req.body;
  if (tier !== 'premium' && tier !== 'premiumPlus') {
    res.status(400).json({ error: 'Invalid tier. Must be "premium" or "premiumPlus".' });
    return;
  }

  try {
    const bpRef = db().ref(`users/${uid}/battlePass`);
    const snap = await bpRef.once('value');
    const current = snap.val() || getDefaultBattlePass();

    // Reject if already has premium
    if (current.premium) {
      res.status(400).json({ error: 'Already has premium battle pass' });
      return;
    }

    // Deduct crowns
    const cost = tier === 'premiumPlus'
      ? CURRENT_SEASON.premiumPlusPriceCrowns
      : CURRENT_SEASON.premiumPriceCrowns;

    const deducted = await deductCrowns(uid, cost);
    if (!deducted) {
      res.status(400).json({ error: 'Not enough crowns' });
      return;
    }

    // Write premium status
    const updates: Record<string, boolean> = { premium: true };
    if (tier === 'premiumPlus') {
      updates.premiumPlus = true;
    }
    await bpRef.update({
      ...updates,
      season: CURRENT_SEASON.id,
    });

    // Log transaction
    await logTransaction({
      uid,
      type: 'battle_pass_purchase',
      itemIds: [tier],
      crownsChange: -cost,
      status: 'completed',
    });

    res.json({ success: true });
  } catch (err: any) {
    console.error('purchaseBattlePass error:', err);
    res.status(500).json({ error: 'Failed to purchase battle pass' });
  }
});

// ─── B) grantBattlePassXp ────────────────────────────────────────

export const grantBattlePassXp = functions.https.onRequest(async (req, res) => {
  cors(res);
  if (req.method === 'OPTIONS') { res.status(204).send(''); return; }
  if (req.method !== 'POST') { res.status(405).json({ error: 'Method not allowed' }); return; }

  let uid: string;
  try {
    uid = await verifyAuth(req);
  } catch {
    res.status(401).json({ error: 'Invalid token' });
    return;
  }

  const { xp } = req.body;
  if (typeof xp !== 'number' || xp < 0) {
    res.status(400).json({ error: 'Invalid xp value' });
    return;
  }

  try {
    const bpRef = db().ref(`users/${uid}/battlePass`);
    const snap = await bpRef.once('value');
    const current = snap.val() || getDefaultBattlePass();

    // Ensure season is up to date
    if (current.season !== CURRENT_SEASON.id) {
      // New season — reset progress
      const fresh = getDefaultBattlePass();
      fresh.xp = xp;
      await bpRef.set(fresh);
      res.json({ success: true, newXp: xp, currentTier: getCurrentTier(xp) });
      return;
    }

    const newXp = (current.xp || 0) + xp;
    await bpRef.update({ xp: newXp });

    res.json({ success: true, newXp, currentTier: getCurrentTier(newXp) });
  } catch (err: any) {
    console.error('grantBattlePassXp error:', err);
    res.status(500).json({ error: 'Failed to grant battle pass XP' });
  }
});

// ─── C) claimBattlePassReward ─────────────────────────────────────

export const claimBattlePassReward = functions.https.onRequest(async (req, res) => {
  cors(res);
  if (req.method === 'OPTIONS') { res.status(204).send(''); return; }
  if (req.method !== 'POST') { res.status(405).json({ error: 'Method not allowed' }); return; }

  let uid: string;
  try {
    uid = await verifyAuth(req);
  } catch {
    res.status(401).json({ error: 'Invalid token' });
    return;
  }

  const { tier, track } = req.body;
  if (typeof tier !== 'number' || (track !== 'free' && track !== 'premium')) {
    res.status(400).json({ error: 'Invalid tier or track' });
    return;
  }

  try {
    const bpRef = db().ref(`users/${uid}/battlePass`);
    const snap = await bpRef.once('value');
    const current = snap.val();

    if (!current) {
      res.status(400).json({ error: 'No battle pass data found' });
      return;
    }

    // Find the tier definition
    const tierDef = CURRENT_SEASON.tiers.find((t) => t.tier === tier);
    if (!tierDef) {
      res.status(400).json({ error: 'Invalid tier number' });
      return;
    }

    // Verify player XP meets tier requirement
    if ((current.xp || 0) < tierDef.xpRequired) {
      res.status(400).json({ error: 'Not enough XP to claim this tier' });
      return;
    }

    // If premium track, verify player has premium
    if (track === 'premium' && !current.premium) {
      res.status(400).json({ error: 'Premium battle pass required' });
      return;
    }

    // Verify not already claimed
    const claimedKey = track === 'free' ? 'claimedFree' : 'claimedPremium';
    const claimed = current[claimedKey] || {};
    if (claimed[tier]) {
      res.status(400).json({ error: 'Reward already claimed' });
      return;
    }

    // Get reward from tier definition
    const reward = track === 'free' ? tierDef.freeReward : tierDef.premiumReward;
    if (!reward) {
      res.status(400).json({ error: 'No reward available for this tier/track' });
      return;
    }

    // Grant reward
    if (reward.type === 'crowns' && reward.amount) {
      await addCrowns(uid, reward.amount);
    } else if (reward.type === 'glory' && reward.amount) {
      await addGlory(uid, reward.amount);
    } else if (reward.type === 'item' && reward.itemId) {
      await grantItem(uid, reward.itemId);
    }

    // Mark claimed
    await bpRef.child(`${claimedKey}/${tier}`).set(true);

    // Transaction logging is non-critical. Do not turn a successful claim into
    // a client-visible failure if analytics/audit logging throws.
    try {
      const txn: Parameters<typeof logTransaction>[0] = {
        uid,
        type: 'battle_pass_claim',
        itemIds: reward.itemId ? [reward.itemId] : [],
        status: 'completed',
      };
      if (reward.type === 'crowns' && reward.amount) txn.crownsChange = reward.amount;
      if (reward.type === 'glory' && reward.amount) txn.gloryChange = reward.amount;
      await logTransaction(txn);
    } catch (err) {
      console.error('claimBattlePassReward logTransaction error:', err);
    }

    res.json({ success: true, reward });
  } catch (err: any) {
    console.error('claimBattlePassReward error:', err);
    res.status(500).json({ error: 'Failed to claim reward' });
  }
});
