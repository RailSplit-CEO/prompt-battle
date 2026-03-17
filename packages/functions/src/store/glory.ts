import * as functions from 'firebase-functions';
import * as admin from 'firebase-admin';
import { addGlory, logTransaction } from './inventory-helpers';

const db = () => admin.database();

// Glory earning rates
const GLORY_RATES = {
  pvp_win: 100,
  pvp_loss: 30,
  solo_win: 50,
  solo_loss: 15,
  first_win_of_day: 50,      // bonus on top of win reward
  daily_login: 25,
  streak_bonus_7: 200,       // 7-day streak bonus
  quest_early: 10,
  quest_mid: 20,
  quest_late: 40,
};

/**
 * Grants Glory to a player based on a gameplay event.
 *
 * POST /api/store/grantGlory
 * Body: { event: string, matchResult?: 'win' | 'loss', questTier?: 'early' | 'mid' | 'late' }
 * Headers: Authorization: Bearer <Firebase ID token>
 */
export const grantGlory = functions.https.onRequest(async (req, res) => {
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

  const { event, matchResult, questTier, isOnline } = req.body;
  if (!event) {
    res.status(400).json({ error: 'Missing event type' });
    return;
  }

  let gloryAmount = 0;
  const breakdown: Record<string, number> = {};

  try {
    switch (event) {
      case 'match_complete': {
        const isPvP = isOnline === true;
        const isWin = matchResult === 'win';

        if (isPvP) {
          gloryAmount = isWin ? GLORY_RATES.pvp_win : GLORY_RATES.pvp_loss;
          breakdown[isWin ? 'pvp_win' : 'pvp_loss'] = gloryAmount;
        } else {
          gloryAmount = isWin ? GLORY_RATES.solo_win : GLORY_RATES.solo_loss;
          breakdown[isWin ? 'solo_win' : 'solo_loss'] = gloryAmount;
        }

        // Check first win of day bonus
        if (isWin) {
          const dailyRef = db().ref(`users/${uid}/dailyRewards`);
          const dailySnap = await dailyRef.once('value');
          const daily = dailySnap.val() || {};
          const now = Date.now();
          const todayStart = new Date().setHours(0, 0, 0, 0);

          if (!daily.lastFirstWin || daily.lastFirstWin < todayStart) {
            gloryAmount += GLORY_RATES.first_win_of_day;
            breakdown['first_win_of_day'] = GLORY_RATES.first_win_of_day;
            await dailyRef.update({ lastFirstWin: now });
          }
        }
        break;
      }

      case 'quest_complete': {
        const tier = questTier || 'early';
        const key = `quest_${tier}` as keyof typeof GLORY_RATES;
        gloryAmount = GLORY_RATES[key] || GLORY_RATES.quest_early;
        breakdown['quest'] = gloryAmount;
        break;
      }

      case 'daily_login': {
        const dailyRef = db().ref(`users/${uid}/dailyRewards`);
        const dailySnap = await dailyRef.once('value');
        const daily = dailySnap.val() || {};
        const now = Date.now();
        const todayStart = new Date().setHours(0, 0, 0, 0);

        // Check if already logged in today
        if (daily.lastLogin && daily.lastLogin >= todayStart) {
          res.json({ success: true, gloryGranted: 0, message: 'Already claimed today' });
          return;
        }

        gloryAmount = GLORY_RATES.daily_login;
        breakdown['daily_login'] = gloryAmount;

        // Calculate streak
        const yesterdayStart = todayStart - 86400000;
        const wasYesterday = daily.lastLogin && daily.lastLogin >= yesterdayStart;
        const newStreak = wasYesterday ? (daily.streak || 0) + 1 : 1;

        // 7-day streak bonus
        if (newStreak > 0 && newStreak % 7 === 0) {
          gloryAmount += GLORY_RATES.streak_bonus_7;
          breakdown['streak_bonus'] = GLORY_RATES.streak_bonus_7;
        }

        await dailyRef.set({
          lastLogin: now,
          streak: newStreak,
          lastFirstWin: daily.lastFirstWin || 0,
        });
        break;
      }

      default:
        res.status(400).json({ error: `Unknown event: ${event}` });
        return;
    }

    if (gloryAmount > 0) {
      const newBalance = await addGlory(uid, gloryAmount);

      await logTransaction({
        uid,
        type: 'glory_earn',
        itemIds: [],
        gloryChange: gloryAmount,
        status: 'completed',
      });

      res.json({
        success: true,
        gloryGranted: gloryAmount,
        breakdown,
        newBalance,
      });
    } else {
      res.json({ success: true, gloryGranted: 0 });
    }
  } catch (err: any) {
    console.error('Glory grant error:', err);
    res.status(500).json({ error: 'Failed to grant glory' });
  }
});
