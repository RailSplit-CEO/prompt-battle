import { getDatabase, ref, set } from 'firebase/database';
import { getFirebaseApp } from '../auth/firebaseApp';
import type { HordeUnitType, EquipmentType } from '@prompt-battle/shared';

// ── EquipService singleton ──────────────────────────────────────
// Writes to /users/{uid}/equipped/ — the only store-related path
// the client is allowed to write to directly. All other mutations
// (wallet, inventory) are server-side only.

export class EquipService {
  private static instance: EquipService | null = null;
  private uid: string | null = null;

  private constructor() {}

  static getInstance(): EquipService {
    if (!EquipService.instance) {
      EquipService.instance = new EquipService();
    }
    return EquipService.instance;
  }

  /** Bind to a user — must be called after auth. */
  init(uid: string): void {
    this.uid = uid;
  }

  // ── Generic equip ───────────────────────────────────────────────

  /** Write a value to the appropriate equipped path. */
  async equipItem(slot: string, value: string): Promise<void> {
    if (!this.uid) return;
    const db = getDatabase(getFirebaseApp());
    await set(ref(db, `users/${this.uid}/equipped/${slot}`), value);
  }

  // ── Unit skins ──────────────────────────────────────────────────

  async equipUnitSkin(unitType: HordeUnitType, skinId: string): Promise<void> {
    await this.equipItem(`unitSkins/${unitType}`, skinId);
  }

  async unequipUnitSkin(unitType: HordeUnitType): Promise<void> {
    await this.equipItem(`unitSkins/${unitType}`, 'default');
  }

  // ── Per-unit voice packs ───────────────────────────────────────

  async equipUnitVoice(unitType: HordeUnitType, packId: string): Promise<void> {
    await this.equipItem(`voicePacks/${unitType}`, packId);
  }

  async unequipUnitVoice(unitType: HordeUnitType): Promise<void> {
    await this.equipItem(`voicePacks/${unitType}`, 'default');
  }

  // ── Individual cosmetic slots ───────────────────────────────────

  async equipAvatar(portraitId: string): Promise<void> {
    await this.equipItem('avatar', portraitId);
  }

  async equipVoicePack(packId: string): Promise<void> {
    await this.equipItem('voicePack', packId);
  }

  async equipDeathEffect(effectId: string): Promise<void> {
    await this.equipItem('deathEffect', effectId);
  }

  async equipSpawnEffect(effectId: string): Promise<void> {
    await this.equipItem('spawnEffect', effectId);
  }

  async equipAttackTrail(trailId: string): Promise<void> {
    await this.equipItem('attackTrail', trailId);
  }

  async equipVictoryEffect(effectId: string): Promise<void> {
    await this.equipItem('victoryEffect', effectId);
  }

  async equipProfileBorder(borderId: string): Promise<void> {
    await this.equipItem('profileBorder', borderId);
  }

  async equipBadge(badgeId: string): Promise<void> {
    await this.equipItem('profileBadge', badgeId);
  }

  async equipTitle(titleId: string): Promise<void> {
    await this.equipItem('profileTitle', titleId);
  }

  async equipCursor(cursorId: string): Promise<void> {
    await this.equipItem('cursor', cursorId);
  }

  async equipEquipmentSkin(equipType: EquipmentType, skinId: string): Promise<void> {
    await this.equipItem(`equipmentSkins/${equipType}`, skinId);
  }

  async equipPortraitFrame(frameId: string): Promise<void> {
    await this.equipItem('portraitFrame', frameId);
  }

  async equipBuildingTheme(themeId: string): Promise<void> {
    await this.equipItem('buildingTheme', themeId);
  }

  async equipMapTheme(themeId: string): Promise<void> {
    await this.equipItem('mapTheme', themeId);
  }

  async equipUiTheme(themeId: string): Promise<void> {
    await this.equipItem('uiTheme', themeId);
  }

  async equipProfileBackground(bgId: string): Promise<void> {
    await this.equipItem('profileBackground', bgId);
  }

  // ── Reset ───────────────────────────────────────────────────────

  /** Reset all equipped cosmetics back to defaults. */
  async resetAll(): Promise<void> {
    if (!this.uid) return;
    const db = getDatabase(getFirebaseApp());
    const { DEFAULT_EQUIPPED } = await import('@prompt-battle/shared');
    await set(ref(db, `users/${this.uid}/equipped`), DEFAULT_EQUIPPED);
  }
}
