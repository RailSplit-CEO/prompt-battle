import * as functions from 'firebase-functions';
import * as admin from 'firebase-admin';
import {
  computeMatchXp,
  getLevelForTotalXp,
  getXpInCurrentLevel,
  getRewardForLevel,
  DEFAULT_PLAYER_LEVEL,
  CURRENT_SEASON,
} from '@prompt-battle/shared';
import { addCrowns, addGlory, grantItem, logTransaction } from './inventory-helpers';

const db = () => admin.database();

function getBpTier(xp: number): number {
  let tier = 0;
  for (const t of CURRENT_SEASON.tiers) {
    if (xp >= t.xpRequired) tier = t.tier;
    else break;
  }
  return tier;
}

/**
 * Grants XP to a player based on match stats.
 *
 * POST /api/store/grantXp
 * Body: { kills, damage, campsCaptured, resourcesDelivered, unitsSpawned, peakArmy, isWin, isOnline, gameTimeMs }
 * Headers: Authorization: Bearer <Firebase ID token>
 */
export const grantXp = functions.https.onRequest(async (req, res) => {
  // CORS
  res.set('Access-Control-Allow-Origin', '*');
  res.set('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.set('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') { res.status(204).send(''); return; }
  if (req.method !== 'POST') { res.status(405).json({ error: 'Method not allowed' }); return; }

  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Missing authorization token' });
    return;
  }

  let uid: string;
  try {
    const token = await admin.auth().verifyIdToken(authHeader.split('Bearer ')[1]);
    uid = token.uid;
  } catch {
    res.status(401).json({ error: 'Invalid token' });
    return;
  }

  const {
    kills, damage, campsCaptured, resourcesDelivered,
    unitsSpawned, peakArmy, isWin, isOnline, gameTimeMs,
  } = req.body;

  if (typeof kills !== 'number' || typeof damage !== 'number') {
    res.status(400).json({ error: 'Missing required match stats' });
    return;
  }

  try {
    // Check for active XP booster
    const boosterSnap = await db().ref(`users/${uid}/activeBoosters/xp_2x`).once('value');
    const boosterData = boosterSnap.val();
    const boosterActive = boosterData && boosterData.expiresAt > Date.now();

    // Compute XP
    const xpGranted = computeMatchXp({
      kills: kills || 0,
      damage: damage || 0,
      campsCaptured: campsCaptured || 0,
      resourcesDelivered: resourcesDelivered || 0,
      unitsSpawned: unitsSpawned || 0,
      peakArmy: peakArmy || 0,
      isWin: isWin === true,
      isOnline: isOnline === true,
      gameTimeMs: gameTimeMs || 0,
      boosterActive,
    });

    // Read current player level
    const levelRef = db().ref(`users/${uid}/playerLevel`);
    const levelSnap = await levelRef.once('value');
    const current = levelSnap.val() || { ...DEFAULT_PLAYER_LEVEL };

    const oldLevel = current.level || 1;
    const newTotalXp = (current.totalXp || 0) + xpGranted;
    const newLevel = getLevelForTotalXp(newTotalXp);
    const leveledUp = newLevel > oldLevel;

    // Grant level-up rewards
    const rewards: Array<{ level: number; crowns?: number; glory?: number; itemId?: string }> = [];
    if (leveledUp) {
      for (let lvl = oldLevel + 1; lvl <= newLevel; lvl++) {
        const reward = getRewardForLevel(lvl);
        if (reward) {
          if (reward.crowns) await addCrowns(uid, reward.crowns);
          if (reward.glory) await addGlory(uid, reward.glory);
          if (reward.itemId) await grantItem(uid, reward.itemId);
          rewards.push({ level: lvl, ...reward });
        }
      }
    }

    // Write updated player level
    const updatedLevel = {
      level: newLevel,
      xp: getXpInCurrentLevel(newTotalXp),
      totalXp: newTotalXp,
      lastMatchXp: xpGranted,
    };
    await levelRef.set(updatedLevel);

    // Log transaction
    await logTransaction({
      uid,
      type: 'glory_earn', // reusing existing type; XP grant
      itemIds: rewards.filter((r) => r.itemId).map((r) => r.itemId!),
      gloryChange: rewards.reduce((sum, r) => sum + (r.glory || 0), 0) || undefined,
      crownsChange: rewards.reduce((sum, r) => sum + (r.crowns || 0), 0) || undefined,
      status: 'completed',
    });

    // ── Also grant Battle Pass XP ──────────────────────────────────
    let bpTier = 0;
    try {
      const bpRef = db().ref(`users/${uid}/battlePass`);
      const bpSnap = await bpRef.once('value');
      const bp = bpSnap.val();

      if (!bp || bp.season !== CURRENT_SEASON.id) {
        // New season or first time — initialize with earned XP
        await bpRef.set({
          season: CURRENT_SEASON.id,
          premium: false,
          premiumPlus: false,
          xp: xpGranted,
          claimedFree: {},
          claimedPremium: {},
        });
        bpTier = getBpTier(xpGranted);
      } else {
        const newBpXp = (bp.xp || 0) + xpGranted;
        await bpRef.update({ xp: newBpXp });
        bpTier = getBpTier(newBpXp);
      }
    } catch (bpErr) {
      console.error('Battle pass XP grant failed (non-critical):', bpErr);
    }

    res.json({
      success: true,
      xpGranted,
      newLevel,
      oldLevel,
      leveledUp,
      rewards,
      playerLevel: updatedLevel,
      battlePassTier: bpTier,
    });
  } catch (err: any) {
    console.error('XP grant error:', err);
    res.status(500).json({ error: 'Failed to grant XP' });
  }
});
