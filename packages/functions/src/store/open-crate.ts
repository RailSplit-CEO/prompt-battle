import * as functions from 'firebase-functions';
import * as admin from 'firebase-admin';
import { addCrowns, grantItems, logTransaction } from './inventory-helpers';
import { CRATE_DEFS, STORE_CATALOG, type CrateTier, type Rarity, type CatalogItem, type CrateReward } from '@prompt-battle/shared';

const RARITY_ORDER: Rarity[] = ['common', 'rare', 'epic', 'legendary'];

function rollRarity(weights: Record<Rarity, number>): Rarity {
  const roll = Math.random() * 100;
  let cumulative = 0;
  for (const r of RARITY_ORDER) {
    cumulative += weights[r];
    if (roll < cumulative) return r;
  }
  return 'legendary';
}

function pickRandomItem(items: CatalogItem[]): CatalogItem {
  return items[Math.floor(Math.random() * items.length)];
}

export const openCrate = functions.https.onRequest(async (req, res) => {
  // CORS
  res.set('Access-Control-Allow-Origin', '*');
  res.set('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.set('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') { res.status(204).send(''); return; }
  if (req.method !== 'POST') { res.status(405).json({ error: 'Method not allowed' }); return; }

  // Auth
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) { res.status(401).json({ error: 'Missing auth' }); return; }
  let uid: string;
  try {
    const token = await admin.auth().verifyIdToken(authHeader.split('Bearer ')[1]);
    uid = token.uid;
  } catch { res.status(401).json({ error: 'Invalid token' }); return; }

  const { tier, currency, free, source } = req.body as {
    tier: CrateTier;
    currency?: 'crowns' | 'glory';
    free?: boolean;
    source?: string;
  };

  // Validate tier
  const crateDef = CRATE_DEFS[tier];
  if (!crateDef) { res.status(400).json({ error: 'Invalid crate tier' }); return; }

  // Deduct currency (unless free)
  if (!free) {
    if (!currency) { res.status(400).json({ error: 'Missing currency' }); return; }
    const price = currency === 'glory' ? crateDef.priceGlory : crateDef.priceCrowns;
    if (price === null || price === undefined) {
      res.status(400).json({ error: `Cannot buy ${tier} crate with ${currency}` }); return;
    }

    const db = admin.database();
    const walletRef = db.ref(`users/${uid}/wallet`);
    let deductSuccess = false;
    await walletRef.transaction((current) => {
      if (!current) { deductSuccess = false; return; }
      const field = currency === 'glory' ? 'glory' : 'crowns';
      const spentField = currency === 'glory' ? 'totalGlorySpent' : 'totalCrownsSpent';
      if ((current[field] || 0) < price) { deductSuccess = false; return; }
      deductSuccess = true;
      return {
        ...current,
        [field]: current[field] - price,
        [spentField]: (current[spentField] || 0) + price,
      };
    });
    if (!deductSuccess) {
      res.status(400).json({ error: `Not enough ${currency}` }); return;
    }
  }

  // Get player inventory
  const invSnap = await admin.database().ref(`users/${uid}/inventory`).once('value');
  const owned = new Set<string>(Object.keys(invSnap.val() || {}));

  // Build eligible pool
  const eligible = STORE_CATALOG.filter((item) =>
    !owned.has(item.id) &&
    !item.battlePassExclusive &&
    !item.seasonal &&
    !item.limited &&
    item.category !== 'booster' &&
    crateDef.eligibleCategories.includes(item.category) &&
    crateDef.rarityWeights[item.rarity] > 0
  );

  // Group by rarity
  const byRarity: Record<Rarity, CatalogItem[]> = {
    common: [], rare: [], epic: [], legendary: [],
  };
  for (const item of eligible) {
    byRarity[item.rarity].push(item);
  }

  // Roll items
  const rewards: CrateReward[] = [];
  const grantedItems: CatalogItem[] = [];
  const usedIds = new Set<string>();

  for (let slot = 0; slot < crateDef.itemCount; slot++) {
    let rolledRarity = rollRarity(crateDef.rarityWeights);

    // Find available items at rolled rarity, escalating if empty
    let pool: CatalogItem[] = [];
    const startIdx = RARITY_ORDER.indexOf(rolledRarity);
    for (let i = startIdx; i < RARITY_ORDER.length; i++) {
      const r = RARITY_ORDER[i];
      pool = byRarity[r].filter((it) => !usedIds.has(it.id));
      if (pool.length > 0) { rolledRarity = r; break; }
    }
    // Also try lower rarities if higher are empty
    if (pool.length === 0) {
      for (let i = startIdx - 1; i >= 0; i--) {
        const r = RARITY_ORDER[i];
        pool = byRarity[r].filter((it) => !usedIds.has(it.id));
        if (pool.length > 0) { rolledRarity = r; break; }
      }
    }

    if (pool.length === 0) {
      // Currency fallback — player owns everything eligible
      rewards.push({ itemId: null, fallbackCrowns: crateDef.currencyFallback });
    } else {
      const picked = pickRandomItem(pool);
      usedIds.add(picked.id);
      rewards.push({ itemId: picked.id });
      grantedItems.push(picked);
    }
  }

  // Grant items to inventory
  const itemIds = grantedItems.map((it) => it.id);
  if (itemIds.length > 0) {
    await grantItems(uid, itemIds);
  }

  // Grant fallback crowns
  let totalFallbackCrowns = 0;
  for (const r of rewards) {
    if (r.fallbackCrowns) totalFallbackCrowns += r.fallbackCrowns;
  }
  if (totalFallbackCrowns > 0) {
    await addCrowns(uid, totalFallbackCrowns);
  }

  // Track crate count
  const countRef = admin.database().ref(`users/${uid}/cratesOpened/${tier}`);
  await countRef.transaction((current) => (current || 0) + 1);

  // Log transaction
  await logTransaction({
    uid,
    type: 'crate_open',
    itemIds: itemIds.length > 0 ? itemIds : [],
    crownsChange: totalFallbackCrowns > 0 ? totalFallbackCrowns : undefined,
    status: 'completed',
  });

  res.json({ rewards, items: grantedItems });
});
