import {
  STORE_CATALOG,
  CROWN_PACKAGES,
  STORE_BUNDLES,
  getCatalogItem,
  getCatalogByCategory,
  getCrownPackage,
} from '@prompt-battle/shared';
import type {
  CatalogItem,
  CrownPackage,
  BundleDef,
  ItemCategory,
  Rarity,
  HordeUnitType,
} from '@prompt-battle/shared';

// ── CatalogService singleton ────────────────────────────────────
// Provides read-only access to the shared store catalog with
// filtering, searching, and daily-deal generation.

export class CatalogService {
  private static instance: CatalogService | null = null;

  private constructor() {}

  static getInstance(): CatalogService {
    if (!CatalogService.instance) {
      CatalogService.instance = new CatalogService();
    }
    return CatalogService.instance;
  }

  // ── Full catalog access ─────────────────────────────────────────

  getAllItems(): CatalogItem[] {
    return STORE_CATALOG;
  }

  getItem(id: string): CatalogItem | undefined {
    return getCatalogItem(id);
  }

  getByCategory(category: ItemCategory): CatalogItem[] {
    return getCatalogByCategory(category);
  }

  // ── Filtered queries ────────────────────────────────────────────

  getByUnit(unitType: HordeUnitType): CatalogItem[] {
    return STORE_CATALOG.filter((i) => i.unitType === unitType);
  }

  getByRarity(rarity: Rarity): CatalogItem[] {
    return STORE_CATALOG.filter((i) => i.rarity === rarity);
  }

  /** Filter items that can be purchased with Glory. */
  getGloryPurchasable(): CatalogItem[] {
    return STORE_CATALOG.filter((i) => i.priceGlory !== null && i.priceGlory !== undefined);
  }

  /** Get items the user does not yet own. */
  getUnowned(ownedIds: Set<string>): CatalogItem[] {
    return STORE_CATALOG.filter((i) => !ownedIds.has(i.id));
  }

  /** Search items by name or description substring. */
  search(query: string): CatalogItem[] {
    const q = query.toLowerCase();
    return STORE_CATALOG.filter(
      (i) => i.name.toLowerCase().includes(q) || i.description.toLowerCase().includes(q),
    );
  }

  // ── Crown packages & bundles ────────────────────────────────────

  getCrownPackages(): CrownPackage[] {
    return CROWN_PACKAGES;
  }

  getCrownPackage(id: string): CrownPackage | undefined {
    return getCrownPackage(id);
  }

  getBundles(): BundleDef[] {
    return STORE_BUNDLES;
  }

  // ── Daily deals ─────────────────────────────────────────────────
  // Deterministic selection based on date seed so every player sees
  // the same deals on a given day.

  getDailyDeals(
    ownedIds: Set<string>,
    count = 3,
  ): { item: CatalogItem; discount: number }[] {
    const today = new Date();
    const seed =
      today.getFullYear() * 10000 +
      (today.getMonth() + 1) * 100 +
      today.getDate();

    const unowned = this.getUnowned(ownedIds).filter(
      (i) => i.priceCrowns >= 50 && !i.battlePassExclusive,
    );
    if (unowned.length === 0) return [];

    // Simple seeded shuffle (LCG)
    const shuffled = [...unowned];
    let s = seed;
    for (let i = shuffled.length - 1; i > 0; i--) {
      s = (s * 1103515245 + 12345) & 0x7fffffff;
      const j = s % (i + 1);
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }

    return shuffled.slice(0, count).map((item, idx) => {
      // Discount between 20-40% based on seed + index
      const discSeed = ((seed + idx * 7) % 21) + 20;
      return { item, discount: discSeed };
    });
  }
}
