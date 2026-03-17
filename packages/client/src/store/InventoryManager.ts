import { getDatabase, ref, onValue, off } from 'firebase/database';
import { getFirebaseApp } from '../auth/firebaseApp';
import type { EquippedCosmetics, HordeUnitType, EquipmentType } from '@prompt-battle/shared';
import { DEFAULT_EQUIPPED } from '@prompt-battle/shared';

// ── InventoryManager singleton ──────────────────────────────────
// Listens to /users/{uid}/inventory/ and /users/{uid}/equipped/
// in Firebase RTDB. Provides ownership checks and equipped-state
// lookups for the UI layer.

export class InventoryManager {
  private static instance: InventoryManager | null = null;
  private ownedItems: Set<string> = new Set();
  private equipped: EquippedCosmetics = { ...DEFAULT_EQUIPPED };
  private inventoryListeners: Array<(items: Set<string>) => void> = [];
  private equippedListeners: Array<(eq: EquippedCosmetics) => void> = [];
  private unsubInventory: (() => void) | null = null;
  private unsubEquipped: (() => void) | null = null;
  private uid: string | null = null;

  private constructor() {}

  static getInstance(): InventoryManager {
    if (!InventoryManager.instance) {
      InventoryManager.instance = new InventoryManager();
    }
    return InventoryManager.instance;
  }

  // ── Lifecycle ───────────────────────────────────────────────────

  /** Start listening to inventory and equipped data for the given user. */
  init(uid: string): void {
    // Clean up any previous listeners
    this.teardownListeners();

    this.uid = uid;
    this.ownedItems = new Set();
    this.equipped = { ...DEFAULT_EQUIPPED };

    const db = getDatabase(getFirebaseApp());

    // ── Inventory listener ────────────────────────────────────────
    const inventoryRef = ref(db, `users/${uid}/inventory`);
    const invUnsub = onValue(inventoryRef, (snapshot) => {
      this.ownedItems = new Set();
      if (snapshot.exists()) {
        const data = snapshot.val() as Record<string, any>;
        for (const itemId of Object.keys(data)) {
          this.ownedItems.add(itemId);
        }
      }
      // Notify subscribers
      for (const cb of this.inventoryListeners) {
        cb(new Set(this.ownedItems));
      }
    });
    this.unsubInventory = () => off(inventoryRef, 'value', invUnsub as any);

    // ── Equipped listener ─────────────────────────────────────────
    const equippedRef = ref(db, `users/${uid}/equipped`);
    const eqUnsub = onValue(equippedRef, (snapshot) => {
      if (snapshot.exists()) {
        const data = snapshot.val();
        this.equipped = {
          unitSkins: data.unitSkins ?? {},
          avatar: data.avatar ?? 'default',
          portraitFrame: data.portraitFrame ?? 'none',
          voicePack: data.voicePack ?? 'default',
          buildingTheme: data.buildingTheme ?? 'default',
          mapTheme: data.mapTheme ?? 'default',
          deathEffect: data.deathEffect ?? 'default',
          spawnEffect: data.spawnEffect ?? 'default',
          attackTrail: data.attackTrail ?? 'default',
          victoryEffect: data.victoryEffect ?? 'default',
          profileBorder: data.profileBorder ?? 'none',
          profileBadge: data.profileBadge ?? 'none',
          profileTitle: data.profileTitle ?? 'none',
          profileBackground: data.profileBackground ?? 'none',
          cursor: data.cursor ?? 'default',
          uiTheme: data.uiTheme ?? 'default',
          equipmentSkins: data.equipmentSkins ?? {},
        };
      } else {
        this.equipped = { ...DEFAULT_EQUIPPED };
      }
      // Notify subscribers
      for (const cb of this.equippedListeners) {
        cb({ ...this.equipped });
      }
    });
    this.unsubEquipped = () => off(equippedRef, 'value', eqUnsub as any);
  }

  /** Stop listening and reset local state. */
  destroy(): void {
    this.teardownListeners();
    this.uid = null;
    this.ownedItems = new Set();
    this.equipped = { ...DEFAULT_EQUIPPED };
    this.inventoryListeners = [];
    this.equippedListeners = [];
  }

  private teardownListeners(): void {
    if (this.unsubInventory) {
      this.unsubInventory();
      this.unsubInventory = null;
    }
    if (this.unsubEquipped) {
      this.unsubEquipped();
      this.unsubEquipped = null;
    }
  }

  // ── Ownership Checks ───────────────────────────────────────────

  /** Check if the user owns a specific item. */
  owns(itemId: string): boolean {
    return this.ownedItems.has(itemId);
  }

  /** Get all owned item IDs as an array. */
  getOwnedItems(): string[] {
    return [...this.ownedItems];
  }

  /** Get the owned items as a Set (useful for filtering). */
  getOwnedSet(): Set<string> {
    return new Set(this.ownedItems);
  }

  // ── Equipped Accessors ──────────────────────────────────────────

  /** Get a snapshot of all equipped cosmetics. */
  getEquipped(): EquippedCosmetics {
    return { ...this.equipped };
  }

  /** Get the equipped skin for a specific unit type. */
  getEquippedSkin(unitType: HordeUnitType): string | undefined {
    return this.equipped.unitSkins[unitType];
  }

  /** Get the equipped skin for a specific equipment type. */
  getEquippedEquipmentSkin(equipType: EquipmentType): string | undefined {
    return this.equipped.equipmentSkins[equipType];
  }

  /** Get the equipped voice pack for a specific unit type, with legacy fallback. */
  getEquippedVoice(unitType: HordeUnitType): string | undefined {
    const perUnit = (this.equipped as any).voicePacks?.[unitType];
    if (perUnit && perUnit !== 'default') return perUnit;
    // Legacy fallback: check old single voicePack field
    const legacy = this.equipped.voicePack;
    if (legacy && legacy !== 'default') return legacy;
    return undefined;
  }

  // ── Subscriptions ───────────────────────────────────────────────

  /** Subscribe to inventory changes. Returns an unsubscribe function. */
  onInventoryChange(cb: (items: Set<string>) => void): () => void {
    this.inventoryListeners.push(cb);
    return () => {
      this.inventoryListeners = this.inventoryListeners.filter((l) => l !== cb);
    };
  }

  /** Subscribe to equipped cosmetic changes. Returns an unsubscribe function. */
  onEquippedChange(cb: (eq: EquippedCosmetics) => void): () => void {
    this.equippedListeners.push(cb);
    return () => {
      this.equippedListeners = this.equippedListeners.filter((l) => l !== cb);
    };
  }
}
