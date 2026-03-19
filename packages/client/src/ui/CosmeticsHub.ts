// ─── CosmeticsHub — DOM overlay for equipping all non-character cosmetics ────
// Dark glassmorphism popup (same pattern as StorePanel / CharacterHub).
// Tabs: Profile, Effects, World, Equipment, More.
// Each tab has sub-sections with item grids and equip/buy interactions.

import { C } from './UIColors';
import { CurrencyDisplay } from './CurrencyDisplay';
import { CatalogService } from '../store/CatalogService';
import { InventoryManager } from '../store/InventoryManager';
import { EquipService } from '../store/EquipService';
import { PaymentService } from '../store/PaymentService';
import { showPurchaseConfirm } from './PurchaseConfirmModal';
import { AuthManager } from '../auth/AuthManager';
import { showGuestLoginPrompt } from './LoginOverlay';
import type { CatalogItem, ItemCategory, HordeUnitType, EquipmentType } from '@prompt-battle/shared';

// ── Rarity border colours ───────────────────────────────────────

type Rarity = 'common' | 'rare' | 'epic' | 'legendary';

const RARITY_BORDER: Record<Rarity, string> = {
  common:    'rgba(150,150,150,0.5)',
  rare:      'rgba(68,136,255,0.6)',
  epic:      'rgba(170,68,255,0.6)',
  legendary: 'rgba(255,217,61,0.6)',
};

const RARITY_LABEL_COLOR: Record<Rarity, string> = {
  common:    '#969696',
  rare:      '#4488FF',
  epic:      '#AA44FF',
  legendary: '#FFD93D',
};

const RARITY_GLOW: Record<Rarity, string> = {
  common:    'none',
  rare:      '0 0 8px rgba(68,136,255,0.2)',
  epic:      '0 0 8px rgba(170,68,255,0.2)',
  legendary: '0 0 12px rgba(255,217,61,0.25)',
};

// ── Category emoji map for item preview placeholders ────────────

const CATEGORY_EMOJI: Partial<Record<ItemCategory, string>> = {
  avatar_portrait:    '\uD83D\uDDBC\uFE0F',
  portrait_frame:     '\uD83D\uDDBC\uFE0F',
  profile_title:      '\uD83D\uDCDB',
  profile_background: '\uD83C\uDF04',
  death_effect:       '\uD83D\uDCA5',
  spawn_effect:       '\u26A1',
  attack_trail:       '\u2728',
  victory_effect:     '\uD83C\uDF86',
  map_theme:          '\uD83D\uDDFA\uFE0F',
  building_theme:     '\uD83C\uDFF0',
  ui_theme:           '\uD83C\uDFA8',
  cursor_pack:        '\uD83D\uDD79\uFE0F',
  equipment_cosmetic: '\u2694\uFE0F',
  emote:              '\uD83D\uDE04',
  voice_effect:       '\uD83C\uDF99\uFE0F',
};

// ── Equipment emoji map ─────────────────────────────────────────

const EQUIP_EMOJI: Record<EquipmentType, string> = {
  pickaxe: '\u26CF\uFE0F',
  sword:   '\u2694\uFE0F',
  shield:  '\uD83D\uDEE1\uFE0F',
  boots:   '\uD83E\uDD7E',
  banner:  '\uD83C\uDFF4',
  bow:     '\uD83C\uDFF9',
  quiver:  '\uD83C\uDFAF',
};

const EQUIP_LABEL: Record<EquipmentType, string> = {
  pickaxe: 'Pickaxe',
  sword:   'Sword',
  shield:  'Shield',
  boots:   'Boots',
  banner:  'Banner',
  bow:     'Bow',
  quiver:  'Quiver',
};

// ── Tab definitions ─────────────────────────────────────────────

interface CosmeticsTab {
  id: string;
  label: string;
  icon: string;
}

const TABS: CosmeticsTab[] = [
  { id: 'profile',   label: 'Profile',   icon: '\uD83D\uDC64' },
  { id: 'effects',   label: 'Effects',   icon: '\u2728' },
  { id: 'world',     label: 'World',     icon: '\uD83C\uDF0D' },
  { id: 'equipment', label: 'Equipment', icon: '\u2694\uFE0F' },
  { id: 'more',      label: 'More',      icon: '\uD83D\uDCE6' },
];

// ── Free emotes (always shown as owned) ─────────────────────────

const FREE_EMOTES = new Set(['emote_gg', 'emote_wave', 'emote_wow']);

// ── Equipment types list ────────────────────────────────────────

const EQUIPMENT_TYPES: EquipmentType[] = ['pickaxe', 'sword', 'shield', 'boots', 'banner'];

// ─── CosmeticsHub class ─────────────────────────────────────────

export class CosmeticsHub {
  private root: HTMLDivElement | null = null;
  private activeTab: string = 'profile';
  private activeSubSection: string = '';
  private contentEl: HTMLDivElement | null = null;
  private currencyDisplay: CurrencyDisplay | null = null;
  private escHandler: ((e: KeyboardEvent) => void) | null = null;
  private unsubInventory: (() => void) | null = null;
  private unsubEquipped: (() => void) | null = null;

  private tabBtns: HTMLButtonElement[] = [];

  private catalog = CatalogService.getInstance();
  private inventory = InventoryManager.getInstance();

  get isOpen(): boolean {
    return this.root !== null;
  }

  open(): void {
    if (this.root) return;
    this.build();
    this.escHandler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') this.close();
    };
    window.addEventListener('keydown', this.escHandler);
  }

  close(): void {
    if (this.escHandler) {
      window.removeEventListener('keydown', this.escHandler);
      this.escHandler = null;
    }
    // Destroy subscriptions
    this.currencyDisplay?.destroy();
    this.currencyDisplay = null;
    if (this.unsubInventory) {
      this.unsubInventory();
      this.unsubInventory = null;
    }
    if (this.unsubEquipped) {
      this.unsubEquipped();
      this.unsubEquipped = null;
    }
    if (this.root) {
      const r = this.root;
      r.style.opacity = '0';
      const panel = r.querySelector('[data-cosmetics-panel]') as HTMLElement | null;
      if (panel) panel.style.transform = 'scale(0.97)';
      setTimeout(() => {
        r.remove();
        if (this.root === r) this.root = null;
      }, 200);
    }
  }

  toggle(): void {
    this.isOpen ? this.close() : this.open();
  }

  // ────────────────────────────────────────────────────────────────
  //  Build
  // ────────────────────────────────────────────────────────────────

  private build(): void {
    this.injectStyles();

    // ── Overlay ──
    const root = document.createElement('div');
    root.id = 'cosmetics-hub-overlay';
    root.style.cssText = `
      position:fixed;inset:0;z-index:9999;
      background:${C.overlay};backdrop-filter:${C.panelBlur};-webkit-backdrop-filter:${C.panelBlur};
      display:flex;align-items:center;justify-content:center;
      opacity:0;transition:opacity 0.25s ease;
    `;
    this.root = root;

    root.addEventListener('mousedown', (e) => {
      if (e.target === root) this.close();
    });

    // ── Panel ──
    const panel = document.createElement('div');
    panel.setAttribute('data-cosmetics-panel', '');
    panel.style.cssText = `
      width:min(960px,95vw);max-height:min(680px,90vh);
      background:${C.panelBg};
      border:2px solid ${C.panelBorder};border-radius:16px;
      padding:0;box-shadow:${C.panelShadow};
      display:flex;flex-direction:column;overflow:hidden;
      transform:scale(0.96);transition:transform 0.3s cubic-bezier(0.16,1,0.3,1);
      font-family:"Nunito",sans-serif;
    `;
    root.appendChild(panel);

    // ── Header ──
    const header = document.createElement('div');
    header.style.cssText = `
      display:flex;align-items:center;justify-content:space-between;
      padding:18px 22px 14px;
      border-bottom:1px solid ${C.divider};
      flex-shrink:0;
    `;
    panel.appendChild(header);

    // Left: title
    const titleWrap = document.createElement('div');
    titleWrap.style.cssText = 'display:flex;align-items:center;gap:10px;';

    const titleIcon = document.createElement('span');
    titleIcon.textContent = '\uD83C\uDFA8';
    titleIcon.style.cssText = 'font-size:20px;opacity:0.7;';
    titleWrap.appendChild(titleIcon);

    const title = document.createElement('h2');
    title.textContent = 'COSMETICS';
    title.style.cssText = `
      margin:0;font-size:20px;font-family:"Fredoka",sans-serif;font-weight:700;
      color:${C.gold};letter-spacing:3px;
    `;
    titleWrap.appendChild(title);
    header.appendChild(titleWrap);

    // Right: currency + close
    const rightWrap = document.createElement('div');
    rightWrap.style.cssText = 'display:flex;align-items:center;gap:14px;';

    this.currencyDisplay = new CurrencyDisplay();
    rightWrap.appendChild(this.currencyDisplay.getElement());

    const closeBtn = document.createElement('button');
    closeBtn.textContent = '\u2715';
    closeBtn.style.cssText = `
      background:${C.inputBg};border:1px solid ${C.inputBorder};color:${C.textSecondary};
      width:32px;height:32px;border-radius:8px;font-size:15px;cursor:pointer;
      font-family:"Fredoka",sans-serif;transition:all 0.15s;display:flex;
      align-items:center;justify-content:center;flex-shrink:0;
    `;
    closeBtn.onmouseenter = () => {
      closeBtn.style.borderColor = C.red;
      closeBtn.style.color = C.red;
      closeBtn.style.background = 'rgba(255,107,107,0.1)';
    };
    closeBtn.onmouseleave = () => {
      closeBtn.style.borderColor = C.inputBorder;
      closeBtn.style.color = C.textSecondary;
      closeBtn.style.background = C.inputBg;
    };
    closeBtn.onclick = () => this.close();
    rightWrap.appendChild(closeBtn);

    header.appendChild(rightWrap);

    // ── Tab Bar (horizontal) ──
    const tabBar = document.createElement('div');
    tabBar.style.cssText = `
      display:flex;gap:2px;padding:8px 22px 0;
      border-bottom:1px solid ${C.divider};
      overflow-x:auto;overflow-y:hidden;
      -webkit-overflow-scrolling:touch;
      scrollbar-width:none;flex-shrink:0;
    `;
    panel.appendChild(tabBar);

    this.tabBtns = [];
    for (const tab of TABS) {
      const btn = document.createElement('button');
      btn.dataset.tab = tab.id;
      btn.textContent = `${tab.icon} ${tab.label}`;
      btn.style.cssText = `
        flex:0 0 auto;padding:8px 16px 10px;
        border:none;border-bottom:2px solid transparent;
        border-radius:0;background:none;color:${C.textMuted};
        font-size:12px;font-weight:700;cursor:pointer;
        font-family:"Nunito",sans-serif;transition:all 0.15s;
        white-space:nowrap;margin-bottom:-1px;
      `;
      btn.onmouseenter = () => {
        if (btn.dataset.tab !== this.activeTab) {
          btn.style.color = C.textSecondary;
          btn.style.background = C.tabBg;
        }
      };
      btn.onmouseleave = () => {
        if (btn.dataset.tab !== this.activeTab) {
          btn.style.color = C.textMuted;
          btn.style.background = 'none';
        }
      };
      btn.onclick = () => {
        this.activeTab = tab.id;
        this.activeSubSection = '';
        this.applyTabStyles();
        this.renderTabContent();
      };
      tabBar.appendChild(btn);
      this.tabBtns.push(btn);
    }

    // ── Content container (scrollable) ──
    const contentEl = document.createElement('div');
    contentEl.className = 'cosmetics-hub-scroll';
    contentEl.style.cssText = `
      flex:1;overflow-y:auto;padding:16px 22px 16px;min-height:0;
    `;
    panel.appendChild(contentEl);
    this.contentEl = contentEl;

    // ── Footer hint ──
    const footer = document.createElement('div');
    footer.style.cssText = `
      padding:10px 22px;border-top:1px solid ${C.divider};
      display:flex;justify-content:flex-end;align-items:center;flex-shrink:0;
    `;
    const hint = document.createElement('span');
    hint.textContent = 'ESC to close';
    hint.style.cssText = `font-size:11px;color:${C.textMuted};font-family:"Nunito",sans-serif;letter-spacing:0.5px;`;
    footer.appendChild(hint);
    panel.appendChild(footer);

    // ── Mount ──
    document.body.appendChild(root);

    // Animate in
    requestAnimationFrame(() => {
      root.style.opacity = '1';
      panel.style.transform = 'scale(1)';
    });

    // Subscribe to inventory + equipped changes to re-render
    this.unsubInventory = this.inventory.onInventoryChange(() => {
      this.renderTabContent();
    });
    this.unsubEquipped = this.inventory.onEquippedChange(() => {
      this.renderTabContent();
    });

    // Initial render
    this.applyTabStyles();
    this.renderTabContent();
  }

  // ────────────────────────────────────────────────────────────────
  //  Tab styling
  // ────────────────────────────────────────────────────────────────

  private applyTabStyles(): void {
    for (const btn of this.tabBtns) {
      const isActive = btn.dataset.tab === this.activeTab;
      btn.style.color = isActive ? C.gold : C.textMuted;
      btn.style.borderBottomColor = isActive ? C.tabBorder : 'transparent';
      btn.style.background = isActive ? C.tabActive : 'none';
    }
  }

  // ────────────────────────────────────────────────────────────────
  //  Tab content dispatcher
  // ────────────────────────────────────────────────────────────────

  private renderTabContent(): void {
    const container = this.contentEl;
    if (!container) return;
    container.innerHTML = '';

    switch (this.activeTab) {
      case 'profile':   this.renderProfileTab(container); break;
      case 'effects':   this.renderEffectsTab(container); break;
      case 'world':     this.renderWorldTab(container); break;
      case 'equipment': this.renderEquipmentTab(container); break;
      case 'more':      this.renderMoreTab(container); break;
      default:          this.renderProfileTab(container); break;
    }
  }

  // ────────────────────────────────────────────────────────────────
  //  Profile Tab
  // ────────────────────────────────────────────────────────────────

  private renderProfileTab(container: HTMLDivElement): void {
    // Avatar section — non-unit portraits only
    const avatarItems = this.catalog.getByCategory('avatar_portrait')
      .filter((item) => !item.unitType);
    container.appendChild(
      this.renderSubSection('Avatar', avatarItems, 'avatar', '\uD83D\uDDBC\uFE0F')
    );

    // Frame section
    const frameItems = this.catalog.getByCategory('portrait_frame');
    container.appendChild(
      this.renderSubSection('Frame', frameItems, 'portraitFrame', '\uD83D\uDDBC\uFE0F')
    );

    // Title section (compact text-only cards)
    const titleItems = this.catalog.getByCategory('profile_title');
    container.appendChild(
      this.renderTitleSection(titleItems)
    );

    // Background section
    const bgItems = this.catalog.getByCategory('profile_background');
    container.appendChild(
      this.renderSubSection('Background', bgItems, 'profileBackground', '\uD83C\uDF04')
    );
  }

  // ────────────────────────────────────────────────────────────────
  //  Effects Tab
  // ────────────────────────────────────────────────────────────────

  private renderEffectsTab(container: HTMLDivElement): void {
    const deathItems = this.catalog.getByCategory('death_effect');
    container.appendChild(
      this.renderSubSection('Death Effect', deathItems, 'deathEffect', '\uD83D\uDCA5')
    );

    const spawnItems = this.catalog.getByCategory('spawn_effect');
    container.appendChild(
      this.renderSubSection('Spawn Effect', spawnItems, 'spawnEffect', '\u26A1')
    );

    const trailItems = this.catalog.getByCategory('attack_trail');
    container.appendChild(
      this.renderSubSection('Attack Trail', trailItems, 'attackTrail', '\u2728')
    );

    const victoryItems = this.catalog.getByCategory('victory_effect');
    container.appendChild(
      this.renderSubSection('Victory Effect', victoryItems, 'victoryEffect', '\uD83C\uDF86')
    );
  }

  // ────────────────────────────────────────────────────────────────
  //  World Tab
  // ────────────────────────────────────────────────────────────────

  private renderWorldTab(container: HTMLDivElement): void {
    const mapItems = this.catalog.getByCategory('map_theme');
    container.appendChild(
      this.renderSubSection('Map Theme', mapItems, 'mapTheme', '\uD83D\uDDFA\uFE0F')
    );

    const buildingItems = this.catalog.getByCategory('building_theme');
    container.appendChild(
      this.renderSubSection('Building Theme', buildingItems, 'buildingTheme', '\uD83C\uDFF0')
    );

    const uiItems = this.catalog.getByCategory('ui_theme');
    container.appendChild(
      this.renderSubSection('UI Theme', uiItems, 'uiTheme', '\uD83C\uDFA8')
    );

    const cursorItems = this.catalog.getByCategory('cursor_pack');
    container.appendChild(
      this.renderSubSection('Cursor', cursorItems, 'cursor', '\uD83D\uDD79\uFE0F')
    );
  }

  // ────────────────────────────────────────────────────────────────
  //  Equipment Tab
  // ────────────────────────────────────────────────────────────────

  private renderEquipmentTab(container: HTMLDivElement): void {
    const allEquipItems = this.catalog.getByCategory('equipment_cosmetic');

    for (const equipType of EQUIPMENT_TYPES) {
      const items = allEquipItems.filter((item) => item.equipType === equipType);
      const equipped = this.inventory.getEquippedEquipmentSkin(equipType) ?? 'default';
      const section = this.renderEquipmentSubSection(
        `${EQUIP_EMOJI[equipType]} ${EQUIP_LABEL[equipType]}`,
        items,
        equipType,
        equipped
      );
      container.appendChild(section);
    }
  }

  // ────────────────────────────────────────────────────────────────
  //  More Tab
  // ────────────────────────────────────────────────────────────────

  private renderMoreTab(container: HTMLDivElement): void {
    // Emotes section
    const emoteItems = this.catalog.getByCategory('emote');
    container.appendChild(this.renderEmotesSection(emoteItems));

    // Voice Effects section
    const voiceItems = this.catalog.getByCategory('voice_effect');
    container.appendChild(
      this.renderSubSection('Voice Effects', voiceItems, 'voicePack', '\uD83C\uDF99\uFE0F')
    );
  }

  // ────────────────────────────────────────────────────────────────
  //  Shared: Sub-section with header + item grid
  // ────────────────────────────────────────────────────────────────

  private renderSubSection(
    title: string,
    items: CatalogItem[],
    equipSlot: string,
    icon: string
  ): HTMLElement {
    const section = document.createElement('div');
    section.style.cssText = `margin-bottom:24px;`;

    // Section header
    const header = this.createSectionHeader(icon, title);
    section.appendChild(header);

    // Divider
    section.appendChild(this.createDivider());

    // Get currently equipped value for this slot
    const currentEquipped = this.getEquippedValue(equipSlot);

    // Grid
    const grid = this.renderItemGrid(items, equipSlot, currentEquipped);
    section.appendChild(grid);

    return section;
  }

  // ────────────────────────────────────────────────────────────────
  //  Title section (compact text-only cards — name, rarity, cost)
  // ────────────────────────────────────────────────────────────────

  private renderTitleSection(items: CatalogItem[]): HTMLElement {
    const section = document.createElement('div');
    section.style.cssText = `margin-bottom:24px;`;

    const header = this.createSectionHeader('', 'Title');
    section.appendChild(header);
    section.appendChild(this.createDivider());

    const currentEquipped = this.getEquippedValue('profileTitle');

    const grid = document.createElement('div');
    grid.style.cssText = `
      display:grid;
      grid-template-columns:repeat(auto-fill, minmax(160px, 1fr));
      gap:8px;padding:8px 0;
    `;

    // Default "None" option
    const isDefaultEquipped = currentEquipped === 'default' || currentEquipped === 'none' || currentEquipped === '';
    const defCard = document.createElement('div');
    defCard.style.cssText = `
      background:${C.surface};
      border:2px solid ${isDefaultEquipped ? C.teal : RARITY_BORDER.common};
      border-radius:10px;padding:8px 12px;
      display:flex;align-items:center;justify-content:space-between;
      cursor:pointer;transition:all 0.15s;
    `;
    defCard.onmouseenter = () => { defCard.style.background = C.surfaceHover; };
    defCard.onmouseleave = () => { defCard.style.background = C.surface; };
    defCard.onclick = () => { if (!isDefaultEquipped) this.equipItem('profileTitle', 'default'); };
    defCard.innerHTML = `
      <span style="font:600 13px 'Nunito',sans-serif;color:${C.textPrimary};">None</span>
      ${isDefaultEquipped ? '<span style="font:600 10px \'Nunito\',sans-serif;color:' + C.teal + ';letter-spacing:0.5px;">EQUIPPED</span>' : ''}
    `;
    grid.appendChild(defCard);

    // Title item cards
    for (const item of items) {
      const owned = this.inventory.owns(item.id);
      const isEquipped = currentEquipped === item.id;
      const borderColor = isEquipped ? C.teal : RARITY_BORDER[item.rarity];
      const rarityColor = RARITY_LABEL_COLOR[item.rarity];

      const card = document.createElement('div');
      card.style.cssText = `
        background:${C.surface};
        border:2px solid ${borderColor};
        border-left:3px solid ${RARITY_BORDER[item.rarity]};
        border-radius:10px;padding:8px 12px;
        display:flex;flex-direction:column;gap:3px;
        cursor:pointer;transition:all 0.15s;
        box-shadow:${RARITY_GLOW[item.rarity]};
      `;
      card.onmouseenter = () => { card.style.background = C.surfaceHover; card.style.transform = 'translateY(-1px)'; };
      card.onmouseleave = () => { card.style.background = C.surface; card.style.transform = 'translateY(0)'; };
      card.onclick = () => {
        if (owned) { if (!isEquipped) this.equipItem('profileTitle', item.id); }
        else { this.purchaseItem(item); }
      };

      // Row 1: name + equipped/price
      const topRow = document.createElement('div');
      topRow.style.cssText = `display:flex;align-items:center;justify-content:space-between;gap:6px;`;

      const nameEl = document.createElement('span');
      nameEl.textContent = item.name;
      nameEl.style.cssText = `font:700 13px 'Nunito',sans-serif;color:${C.textPrimary};overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:1;`;
      topRow.appendChild(nameEl);

      if (isEquipped) {
        const eqBadge = document.createElement('span');
        eqBadge.textContent = 'EQUIPPED';
        eqBadge.style.cssText = `font:600 9px 'Nunito',sans-serif;color:${C.teal};letter-spacing:0.5px;flex-shrink:0;`;
        topRow.appendChild(eqBadge);
      } else if (!owned) {
        const priceEl = document.createElement('span');
        priceEl.textContent = `\u{1F451} ${item.priceCrowns}`;
        priceEl.style.cssText = `font:700 11px 'Fredoka',sans-serif;color:${C.gold};flex-shrink:0;`;
        topRow.appendChild(priceEl);
      } else {
        const ownedBadge = document.createElement('span');
        ownedBadge.textContent = 'OWNED';
        ownedBadge.style.cssText = `font:600 9px 'Nunito',sans-serif;color:${C.textMuted};letter-spacing:0.5px;flex-shrink:0;`;
        topRow.appendChild(ownedBadge);
      }
      card.appendChild(topRow);

      // Row 2: rarity
      const rarityEl = document.createElement('div');
      rarityEl.style.cssText = `font:600 10px 'Nunito',sans-serif;color:${rarityColor};letter-spacing:0.5px;`;
      rarityEl.textContent = `\u2605 ${item.rarity.charAt(0).toUpperCase() + item.rarity.slice(1)}`;
      card.appendChild(rarityEl);

      grid.appendChild(card);
    }

    if (items.length === 0) {
      grid.appendChild(this.createEmptyCell('No titles available yet'));
    }

    section.appendChild(grid);
    return section;
  }

  // ────────────────────────────────────────────────────────────────
  //  Equipment sub-section (uses equipmentSkins path)
  // ────────────────────────────────────────────────────────────────

  private renderEquipmentSubSection(
    title: string,
    items: CatalogItem[],
    equipType: EquipmentType,
    currentEquipped: string
  ): HTMLElement {
    const section = document.createElement('div');
    section.style.cssText = `margin-bottom:24px;`;

    // Section header
    const header = this.createSectionHeader('', title);
    section.appendChild(header);

    // Divider
    section.appendChild(this.createDivider());

    // Build grid with equipment-specific equip logic
    const grid = document.createElement('div');
    grid.style.cssText = `
      display:grid;
      grid-template-columns:repeat(auto-fill, minmax(130px, 1fr));
      gap:10px;padding:8px 0;
    `;

    // Default card (always first)
    grid.appendChild(
      this.createItemCardDefault(
        `equipmentSkins/${equipType}`,
        currentEquipped === 'default' || currentEquipped === '',
        equipType
      )
    );

    // Item cards
    for (const item of items) {
      grid.appendChild(
        this.createEquipmentItemCard(item, equipType, currentEquipped)
      );
    }

    section.appendChild(grid);
    return section;
  }

  // ────────────────────────────────────────────────────────────────
  //  Emotes section (special rendering — no equip, just owned/locked)
  // ────────────────────────────────────────────────────────────────

  private renderEmotesSection(items: CatalogItem[]): HTMLElement {
    const section = document.createElement('div');
    section.style.cssText = `margin-bottom:24px;`;

    // Section header
    const header = this.createSectionHeader('\uD83D\uDE04', 'Emotes');
    section.appendChild(header);

    // Divider
    section.appendChild(this.createDivider());

    // Grid
    const grid = document.createElement('div');
    grid.style.cssText = `
      display:grid;
      grid-template-columns:repeat(auto-fill, minmax(130px, 1fr));
      gap:10px;padding:8px 0;
    `;

    for (const item of items) {
      grid.appendChild(this.createEmoteCard(item));
    }

    // If no items, show empty message
    if (items.length === 0) {
      grid.appendChild(this.createEmptyCell('No emotes available'));
    }

    section.appendChild(grid);
    return section;
  }

  // ────────────────────────────────────────────────────────────────
  //  Shared: Item grid with default option
  // ────────────────────────────────────────────────────────────────

  private renderItemGrid(
    items: CatalogItem[],
    equipSlot: string,
    currentEquipped: string
  ): HTMLElement {
    const grid = document.createElement('div');
    grid.style.cssText = `
      display:grid;
      grid-template-columns:repeat(auto-fill, minmax(130px, 1fr));
      gap:10px;padding:8px 0;
    `;

    // Default option — always first, always owned
    const isDefaultEquipped =
      currentEquipped === 'default' ||
      currentEquipped === 'none' ||
      currentEquipped === '';
    grid.appendChild(this.createItemCardDefault(equipSlot, isDefaultEquipped));

    // Item cards
    for (const item of items) {
      grid.appendChild(this.createStandardItemCard(item, equipSlot, currentEquipped));
    }

    // If no items besides default, show hint
    if (items.length === 0) {
      grid.appendChild(this.createEmptyCell('No items available yet'));
    }

    return grid;
  }

  // ────────────────────────────────────────────────────────────────
  //  Default item card (always owned, free)
  // ────────────────────────────────────────────────────────────────

  private createItemCardDefault(
    equipSlot: string,
    isEquipped: boolean,
    equipType?: EquipmentType
  ): HTMLDivElement {
    const card = document.createElement('div');
    card.style.cssText = `
      background:${C.surface};
      border:2px solid ${isEquipped ? C.teal : RARITY_BORDER.common};
      border-radius:12px;
      padding:10px 8px 10px;
      display:flex;flex-direction:column;align-items:center;gap:6px;
      cursor:pointer;transition:all 0.15s;
      position:relative;min-height:140px;
    `;

    card.onmouseenter = () => {
      card.style.background = C.surfaceHover;
      card.style.transform = 'translateY(-2px)';
      card.style.boxShadow = '0 4px 12px rgba(0,0,0,0.3)';
    };
    card.onmouseleave = () => {
      card.style.background = C.surface;
      card.style.transform = 'translateY(0)';
      card.style.boxShadow = 'none';
    };

    card.onclick = () => {
      if (isEquipped) return;
      if (equipType) {
        this.equipItem(`equipmentSkins/${equipType}`, 'default');
      } else {
        this.equipItem(equipSlot, 'default');
      }
    };

    // Preview area
    const preview = document.createElement('div');
    preview.style.cssText = `
      width:100%;height:40px;display:flex;align-items:center;justify-content:center;
      font-size:24px;
      background:rgba(0,0,0,0.15);border-radius:8px;
    `;
    preview.textContent = '\u2205'; // empty set symbol for "none/default"
    card.appendChild(preview);

    // Name
    const name = document.createElement('div');
    name.textContent = 'Default';
    name.style.cssText = `
      font-size:12px;font-weight:700;color:${C.textPrimary};
      font-family:"Nunito",sans-serif;
      width:100%;text-align:center;
      overflow:hidden;text-overflow:ellipsis;white-space:nowrap;
    `;
    card.appendChild(name);

    // Rarity label
    const rarityLabel = document.createElement('div');
    rarityLabel.textContent = 'Free';
    rarityLabel.style.cssText = `
      font-size:10px;font-weight:600;color:${C.textMuted};
      font-family:"Nunito",sans-serif;letter-spacing:0.5px;
    `;
    card.appendChild(rarityLabel);

    // Status
    if (isEquipped) {
      card.appendChild(this.createEquippedBadge());
    } else {
      card.appendChild(this.createEquipButton());
    }

    return card;
  }

  // ────────────────────────────────────────────────────────────────
  //  Standard item card (for all non-equipment, non-emote items)
  // ────────────────────────────────────────────────────────────────

  private createStandardItemCard(
    item: CatalogItem,
    equipSlot: string,
    currentEquipped: string
  ): HTMLDivElement {
    const owned = this.inventory.owns(item.id);
    const isEquipped = currentEquipped === item.id;
    const borderColor = isEquipped ? C.teal : RARITY_BORDER[item.rarity];
    const glow = RARITY_GLOW[item.rarity];

    const card = document.createElement('div');
    card.style.cssText = `
      background:${C.surface};
      border:2px solid ${borderColor};
      border-left:4px solid ${RARITY_BORDER[item.rarity]};
      border-radius:12px;
      padding:10px 8px 10px;
      display:flex;flex-direction:column;align-items:center;gap:6px;
      cursor:pointer;transition:all 0.15s;
      box-shadow:${glow};
      position:relative;min-height:140px;
    `;
    card.onmouseenter = () => {
      card.style.background = C.surfaceHover;
      card.style.transform = 'translateY(-2px)';
      card.style.boxShadow = `${glow}, 0 4px 12px rgba(0,0,0,0.3)`;
    };
    card.onmouseleave = () => {
      card.style.background = C.surface;
      card.style.transform = 'translateY(0)';
      card.style.boxShadow = glow;
    };

    card.onclick = () => {
      if (owned) {
        if (!isEquipped) {
          this.equipItem(equipSlot, item.id);
        }
      } else {
        this.purchaseItem(item);
      }
    };

    // Preview area
    const preview = document.createElement('div');
    preview.style.cssText = `
      width:100%;height:40px;display:flex;align-items:center;justify-content:center;
      font-size:24px;
      background:rgba(0,0,0,0.15);border-radius:8px;
    `;
    preview.textContent = CATEGORY_EMOJI[item.category] ?? '\uD83C\uDFA8';
    card.appendChild(preview);

    // Item name
    const name = document.createElement('div');
    name.textContent = item.name;
    name.style.cssText = `
      font-size:12px;font-weight:700;color:${C.textPrimary};
      font-family:"Nunito",sans-serif;
      width:100%;text-align:center;
      overflow:hidden;text-overflow:ellipsis;white-space:nowrap;
    `;
    card.appendChild(name);

    // Rarity label
    const rarityLabel = document.createElement('div');
    rarityLabel.style.cssText = `
      font-size:10px;font-weight:600;
      color:${RARITY_LABEL_COLOR[item.rarity]};
      font-family:"Nunito",sans-serif;
      display:flex;align-items:center;gap:3px;
      letter-spacing:0.5px;
    `;
    const star = document.createElement('span');
    star.textContent = '\u2605';
    star.style.cssText = 'font-size:9px;';
    rarityLabel.appendChild(star);
    const rarityText = document.createElement('span');
    rarityText.textContent = item.rarity.charAt(0).toUpperCase() + item.rarity.slice(1);
    rarityLabel.appendChild(rarityText);
    card.appendChild(rarityLabel);

    // Status: equipped badge, price, or equip button
    if (isEquipped) {
      card.appendChild(this.createEquippedBadge());
    } else if (owned) {
      card.appendChild(this.createEquipButton());
    } else {
      card.appendChild(this.createPriceLine(item));
    }

    return card;
  }

  // ────────────────────────────────────────────────────────────────
  //  Equipment-specific item card
  // ────────────────────────────────────────────────────────────────

  private createEquipmentItemCard(
    item: CatalogItem,
    equipType: EquipmentType,
    currentEquipped: string
  ): HTMLDivElement {
    const owned = this.inventory.owns(item.id);
    const isEquipped = currentEquipped === item.id;
    const borderColor = isEquipped ? C.teal : RARITY_BORDER[item.rarity];
    const glow = RARITY_GLOW[item.rarity];

    const card = document.createElement('div');
    card.style.cssText = `
      background:${C.surface};
      border:2px solid ${borderColor};
      border-left:4px solid ${RARITY_BORDER[item.rarity]};
      border-radius:12px;
      padding:10px 8px 10px;
      display:flex;flex-direction:column;align-items:center;gap:6px;
      cursor:pointer;transition:all 0.15s;
      box-shadow:${glow};
      position:relative;min-height:140px;
    `;
    card.onmouseenter = () => {
      card.style.background = C.surfaceHover;
      card.style.transform = 'translateY(-2px)';
      card.style.boxShadow = `${glow}, 0 4px 12px rgba(0,0,0,0.3)`;
    };
    card.onmouseleave = () => {
      card.style.background = C.surface;
      card.style.transform = 'translateY(0)';
      card.style.boxShadow = glow;
    };

    card.onclick = () => {
      if (owned) {
        if (!isEquipped) {
          EquipService.getInstance().equipEquipmentSkin(equipType, item.id);
        }
      } else {
        this.purchaseItem(item);
      }
    };

    // Preview area
    const preview = document.createElement('div');
    preview.style.cssText = `
      width:100%;height:40px;display:flex;align-items:center;justify-content:center;
      font-size:24px;
      background:rgba(0,0,0,0.15);border-radius:8px;
    `;
    preview.textContent = EQUIP_EMOJI[equipType] ?? '\u2694\uFE0F';
    card.appendChild(preview);

    // Item name
    const name = document.createElement('div');
    name.textContent = item.name;
    name.style.cssText = `
      font-size:12px;font-weight:700;color:${C.textPrimary};
      font-family:"Nunito",sans-serif;
      width:100%;text-align:center;
      overflow:hidden;text-overflow:ellipsis;white-space:nowrap;
    `;
    card.appendChild(name);

    // Rarity label
    const rarityLabel = document.createElement('div');
    rarityLabel.style.cssText = `
      font-size:10px;font-weight:600;
      color:${RARITY_LABEL_COLOR[item.rarity]};
      font-family:"Nunito",sans-serif;
      display:flex;align-items:center;gap:3px;
      letter-spacing:0.5px;
    `;
    const star = document.createElement('span');
    star.textContent = '\u2605';
    star.style.cssText = 'font-size:9px;';
    rarityLabel.appendChild(star);
    const rarityText = document.createElement('span');
    rarityText.textContent = item.rarity.charAt(0).toUpperCase() + item.rarity.slice(1);
    rarityLabel.appendChild(rarityText);
    card.appendChild(rarityLabel);

    // Status: equipped badge, price, or equip button
    if (isEquipped) {
      card.appendChild(this.createEquippedBadge());
    } else if (owned) {
      card.appendChild(this.createEquipButton());
    } else {
      card.appendChild(this.createPriceLine(item));
    }

    return card;
  }

  // ────────────────────────────────────────────────────────────────
  //  Emote card (no equip — just owned/locked display)
  // ────────────────────────────────────────────────────────────────

  private createEmoteCard(item: CatalogItem): HTMLDivElement {
    const isFree = FREE_EMOTES.has(item.id);
    const owned = isFree || this.inventory.owns(item.id);
    const borderColor = owned
      ? RARITY_BORDER[item.rarity]
      : 'rgba(100,90,70,0.3)';
    const glow = owned ? RARITY_GLOW[item.rarity] : 'none';

    const card = document.createElement('div');
    card.style.cssText = `
      background:${C.surface};
      border:2px solid ${borderColor};
      border-radius:12px;
      padding:10px 8px 10px;
      display:flex;flex-direction:column;align-items:center;gap:6px;
      cursor:${owned ? 'default' : 'pointer'};transition:all 0.15s;
      box-shadow:${glow};
      position:relative;min-height:140px;
      ${!owned ? 'opacity:0.65;' : ''}
    `;
    card.onmouseenter = () => {
      card.style.background = C.surfaceHover;
      card.style.transform = 'translateY(-2px)';
    };
    card.onmouseleave = () => {
      card.style.background = C.surface;
      card.style.transform = 'translateY(0)';
    };

    card.onclick = () => {
      if (!owned) {
        this.purchaseItem(item);
      }
    };

    // Emoji preview
    const preview = document.createElement('div');
    preview.style.cssText = `
      width:100%;height:40px;display:flex;align-items:center;justify-content:center;
      font-size:28px;
      background:rgba(0,0,0,0.15);border-radius:8px;
    `;
    preview.textContent = CATEGORY_EMOJI.emote ?? '\uD83D\uDE04';
    card.appendChild(preview);

    // Name
    const name = document.createElement('div');
    name.textContent = item.name;
    name.style.cssText = `
      font-size:12px;font-weight:700;color:${C.textPrimary};
      font-family:"Nunito",sans-serif;
      width:100%;text-align:center;
      overflow:hidden;text-overflow:ellipsis;white-space:nowrap;
    `;
    card.appendChild(name);

    // Rarity label
    const rarityLabel = document.createElement('div');
    rarityLabel.style.cssText = `
      font-size:10px;font-weight:600;
      color:${RARITY_LABEL_COLOR[item.rarity]};
      font-family:"Nunito",sans-serif;letter-spacing:0.5px;
    `;
    rarityLabel.textContent = item.rarity.charAt(0).toUpperCase() + item.rarity.slice(1);
    card.appendChild(rarityLabel);

    // Status
    if (owned) {
      const badge = document.createElement('div');
      badge.textContent = isFree ? 'FREE' : 'OWNED';
      badge.style.cssText = `
        font-size:10px;font-weight:700;font-family:"Fredoka",sans-serif;
        color:#fff;background:${C.green};
        padding:2px 10px;border-radius:6px;letter-spacing:1px;
      `;
      card.appendChild(badge);
    } else {
      card.appendChild(this.createPriceLine(item));
    }

    return card;
  }

  // ────────────────────────────────────────────────────────────────
  //  Shared UI helpers
  // ────────────────────────────────────────────────────────────────

  private createSectionHeader(icon: string, title: string): HTMLElement {
    const header = document.createElement('div');
    header.style.cssText = `
      display:flex;align-items:center;gap:8px;
      padding:6px 0 4px;
    `;

    if (icon) {
      const iconEl = document.createElement('span');
      iconEl.textContent = icon;
      iconEl.style.cssText = 'font-size:16px;';
      header.appendChild(iconEl);
    }

    const titleEl = document.createElement('h3');
    titleEl.textContent = title;
    titleEl.style.cssText = `
      margin:0;font-size:14px;font-family:"Fredoka",sans-serif;font-weight:700;
      color:${C.textH1};letter-spacing:1.5px;text-transform:uppercase;
    `;
    header.appendChild(titleEl);

    return header;
  }

  private createDivider(): HTMLElement {
    const div = document.createElement('div');
    div.style.cssText = `
      width:100%;height:1px;background:${C.divider};margin:2px 0 6px;
    `;
    return div;
  }

  private createEquippedBadge(): HTMLElement {
    const badge = document.createElement('div');
    badge.textContent = 'EQUIPPED';
    badge.style.cssText = `
      font-size:10px;font-weight:700;font-family:"Fredoka",sans-serif;
      color:#fff;background:${C.teal};
      padding:2px 10px;border-radius:6px;letter-spacing:1px;
      box-shadow:0 2px 6px rgba(69,230,176,0.25);
    `;
    return badge;
  }

  private createEquipButton(): HTMLElement {
    const btn = document.createElement('button');
    btn.textContent = 'EQUIP';
    btn.style.cssText = `
      padding:3px 14px;border-radius:6px;font-size:10px;font-weight:700;
      font-family:"Fredoka",sans-serif;cursor:pointer;transition:all 0.15s;
      background:${C.surface};border:1px solid ${C.teal};color:${C.teal};
      letter-spacing:1px;
    `;
    btn.onmouseenter = () => {
      btn.style.background = 'rgba(69,230,176,0.12)';
      btn.style.boxShadow = '0 2px 8px rgba(69,230,176,0.2)';
    };
    btn.onmouseleave = () => {
      btn.style.background = C.surface;
      btn.style.boxShadow = 'none';
    };
    // Clicks bubble up to card onclick
    return btn;
  }

  private createPriceLine(item: CatalogItem): HTMLElement {
    const priceLine = document.createElement('div');
    priceLine.style.cssText = `
      font-size:11px;font-weight:700;
      display:flex;align-items:center;gap:4px;justify-content:center;
      flex-wrap:wrap;
    `;

    const crownPrice = document.createElement('span');
    crownPrice.style.cssText = `color:${C.gold};`;
    crownPrice.textContent = `\u{1F451} ${item.priceCrowns}`;
    priceLine.appendChild(crownPrice);

    if (item.priceGlory != null) {
      const sep = document.createElement('span');
      sep.textContent = '/';
      sep.style.cssText = `color:${C.textMuted};font-size:10px;`;
      priceLine.appendChild(sep);

      const gloryPrice = document.createElement('span');
      gloryPrice.style.cssText = `color:#C0C0D2;`;
      gloryPrice.textContent = `\u2605 ${item.priceGlory}`;
      priceLine.appendChild(gloryPrice);
    }

    return priceLine;
  }

  private createEmptyCell(message: string): HTMLElement {
    const empty = document.createElement('div');
    empty.style.cssText = `
      grid-column:1/-1;
      display:flex;align-items:center;justify-content:center;
      padding:24px 20px;
    `;
    const text = document.createElement('span');
    text.textContent = message;
    text.style.cssText = `
      font-size:13px;color:${C.textMuted};font-family:"Nunito",sans-serif;
      font-style:italic;
    `;
    empty.appendChild(text);
    return empty;
  }

  // ────────────────────────────────────────────────────────────────
  //  Equip logic
  // ────────────────────────────────────────────────────────────────

  /**
   * Read the currently equipped value for a given slot.
   * For equipment skins, pass the full path like `equipmentSkins/sword`
   * and we split it apart. For simple slots, read directly from equipped snapshot.
   */
  private getEquippedValue(slot: string): string {
    const equipped = this.inventory.getEquipped();

    // Equipment skins path: equipmentSkins/{type}
    if (slot.startsWith('equipmentSkins/')) {
      const equipType = slot.split('/')[1] as EquipmentType;
      return equipped.equipmentSkins[equipType] ?? 'default';
    }

    // Simple slot — read from the EquippedCosmetics object
    const val = (equipped as any)[slot];
    return val ?? 'default';
  }

  /**
   * Equip an item to a slot.
   * For equipment skins, the slot is `equipmentSkins/{type}` and we call the
   * specialized method. For simple slots, use generic equipItem.
   */
  private equipItem(slot: string, value: string): void {
    if (AuthManager.getInstance().isGuest) {
      showGuestLoginPrompt('equip cosmetics');
      return;
    }
    const equip = EquipService.getInstance();

    if (slot.startsWith('equipmentSkins/')) {
      const equipType = slot.split('/')[1] as EquipmentType;
      equip.equipEquipmentSkin(equipType, value);
      return;
    }

    equip.equipItem(slot, value);
  }

  /**
   * Trigger the purchase confirmation flow for an unowned item.
   */
  private purchaseItem(item: CatalogItem): void {
    showPurchaseConfirm({
      itemName: item.name,
      priceCrowns: item.priceCrowns,
      priceGlory: item.priceGlory ?? undefined,
      onConfirm: async () => {
        const currency = item.priceGlory ? 'glory' : 'crowns';
        const result = await PaymentService.getInstance().purchaseItem(item.id, currency);
        if (!result.success) {
          alert(result.error || 'Purchase failed');
        }
      },
      onCancel: () => {},
    });
  }

  // ────────────────────────────────────────────────────────────────
  //  Inject scoped styles
  // ────────────────────────────────────────────────────────────────

  private injectStyles(): void {
    if (document.getElementById('cosmetics-hub-styles')) return;
    const style = document.createElement('style');
    style.id = 'cosmetics-hub-styles';
    style.textContent = `
      /* Scrollbar for content area */
      #cosmetics-hub-overlay .cosmetics-hub-scroll::-webkit-scrollbar { width:5px; }
      #cosmetics-hub-overlay .cosmetics-hub-scroll::-webkit-scrollbar-track { background:transparent; }
      #cosmetics-hub-overlay .cosmetics-hub-scroll::-webkit-scrollbar-thumb {
        background:rgba(139,115,85,0.3);border-radius:3px;
      }
      #cosmetics-hub-overlay .cosmetics-hub-scroll::-webkit-scrollbar-thumb:hover {
        background:rgba(139,115,85,0.5);
      }
      /* Hide tab bar scrollbar */
      #cosmetics-hub-overlay div::-webkit-scrollbar { height:0; }
    `;
    document.head.appendChild(style);
  }
}
