// ─── StorePanel — DOM overlay for the in-game store ─────────────
// Dark glassmorphism panel matching SettingsPanel / FriendsPanel style.
// Categories, item grid, crown packages, and bundles.

import { C } from './UIColors';
import { CurrencyDisplay } from './CurrencyDisplay';
import { WalletManager } from '../store/WalletManager';
import { InventoryManager } from '../store/InventoryManager';
import { CatalogService } from '../store/CatalogService';
import type { CatalogItem, CrownPackage, Rarity, ItemCategory } from '@prompt-battle/shared';

// ── Category definitions ────────────────────────────────────────

interface StoreTab {
  id: string;
  label: string;
  /** ItemCategory values to include, or null for special tabs */
  categories: ItemCategory[] | null;
}

const TABS: StoreTab[] = [
  { id: 'all',        label: 'All',        categories: null },
  { id: 'skins',      label: 'Skins',      categories: ['unit_skin'] },
  { id: 'portraits',  label: 'Portraits',  categories: ['avatar_portrait', 'portrait_frame'] },
  { id: 'voices',     label: 'Voices',     categories: ['voice_pack', 'voice_effect'] },
  { id: 'equipment',  label: 'Equipment',  categories: ['equipment_cosmetic'] },
  { id: 'buildings',  label: 'Buildings',  categories: ['building_theme'] },
  { id: 'maps',       label: 'Maps',       categories: ['map_theme'] },
  { id: 'effects',    label: 'Effects',    categories: ['death_effect', 'spawn_effect', 'attack_trail', 'victory_effect'] },
  { id: 'emotes',     label: 'Emotes',     categories: ['emote'] },
  { id: 'profile',    label: 'Profile',    categories: ['profile_badge', 'profile_title', 'profile_border', 'profile_background', 'cursor_pack'] },
  { id: 'themes',     label: 'Themes',     categories: ['ui_theme'] },
  { id: 'gems',       label: 'Gems',       categories: null },  // special: crown packages
  { id: 'bundles',    label: 'Bundles',    categories: null },   // special: bundles
];

// ── Rarity border colours ───────────────────────────────────────

const RARITY_BORDER: Record<Rarity, string> = {
  common:    'rgba(150,150,150,0.5)',
  rare:      'rgba(68,136,255,0.6)',
  epic:      'rgba(170,68,255,0.6)',
  legendary: 'rgba(255,217,61,0.6)',
};

const RARITY_GLOW: Record<Rarity, string> = {
  common:    'none',
  rare:      '0 0 8px rgba(68,136,255,0.2)',
  epic:      '0 0 8px rgba(170,68,255,0.2)',
  legendary: '0 0 12px rgba(255,217,61,0.25)',
};

// ── Category → emoji map for item preview placeholders ──────────

const CATEGORY_EMOJI: Partial<Record<ItemCategory, string>> = {
  unit_skin:          '\uD83C\uDFA8',  // paint palette
  avatar_portrait:    '\uD83D\uDDBC\uFE0F',  // framed picture
  portrait_frame:     '\uD83D\uDDBC\uFE0F',
  voice_pack:         '\uD83C\uDF99\uFE0F',  // microphone
  voice_effect:       '\uD83C\uDF99\uFE0F',
  equipment_cosmetic: '\u2694\uFE0F',   // crossed swords
  building_theme:     '\uD83C\uDFF0',   // castle
  map_theme:          '\uD83D\uDDFA\uFE0F',  // world map
  death_effect:       '\uD83D\uDCA5',   // boom
  spawn_effect:       '\u26A1',          // lightning
  attack_trail:       '\u2728',          // sparkles
  victory_effect:     '\uD83C\uDF86',   // fireworks
  emote:              '\uD83D\uDE04',   // grinning face
  profile_badge:      '\uD83C\uDFC5',   // medal
  profile_title:      '\uD83D\uDCDB',   // name badge
  profile_border:     '\uD83D\uDDBC\uFE0F',
  profile_background: '\uD83C\uDF04',   // sunrise
  cursor_pack:        '\uD83D\uDD79\uFE0F',  // joystick
  ui_theme:           '\uD83C\uDFA8',
  booster:            '\uD83D\uDE80',   // rocket
};

// ─── StorePanel class ───────────────────────────────────────────

export class StorePanel {
  private root: HTMLDivElement | null = null;
  private activeCategory: string = 'all';
  private escHandler: ((e: KeyboardEvent) => void) | null = null;

  private gridContainer: HTMLDivElement | null = null;
  private tabBtns: HTMLButtonElement[] = [];
  private currencyDisplay: CurrencyDisplay | null = null;

  private catalog = CatalogService.getInstance();
  private wallet = WalletManager.getInstance();
  private inventory = InventoryManager.getInstance();

  private unsubInventory: (() => void) | null = null;

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
    if (this.root) {
      const r = this.root;
      r.style.opacity = '0';
      const panel = r.querySelector('[data-store-panel]') as HTMLElement | null;
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
    root.id = 'store-overlay';
    root.style.cssText = `
      position:fixed;inset:0;z-index:9998;
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
    panel.setAttribute('data-store-panel', '');
    panel.style.cssText = `
      width:min(900px,94vw);max-height:min(720px,90vh);
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
    `;
    panel.appendChild(header);

    // Left: title
    const titleWrap = document.createElement('div');
    titleWrap.style.cssText = 'display:flex;align-items:center;gap:10px;';

    const titleIcon = document.createElement('span');
    titleIcon.textContent = '\uD83D\uDED2'; // shopping cart
    titleIcon.style.cssText = 'font-size:20px;opacity:0.7;';
    titleWrap.appendChild(titleIcon);

    const title = document.createElement('h2');
    title.textContent = 'STORE';
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
      align-items:center;justify-content:center;
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

    // ── Tab Bar (horizontal scrollable) ──
    const tabBar = document.createElement('div');
    tabBar.style.cssText = `
      display:flex;gap:2px;padding:8px 22px 0;
      border-bottom:1px solid ${C.divider};
      overflow-x:auto;overflow-y:hidden;
      -webkit-overflow-scrolling:touch;
      scrollbar-width:none;
    `;
    panel.appendChild(tabBar);

    this.tabBtns = [];
    for (const tab of TABS) {
      const btn = document.createElement('button');
      btn.dataset.tab = tab.id;
      btn.textContent = tab.label;
      btn.style.cssText = `
        flex:0 0 auto;padding:8px 14px 10px;
        border:none;border-bottom:2px solid transparent;
        border-radius:0;background:none;color:${C.textMuted};
        font-size:11px;font-weight:700;cursor:pointer;
        font-family:"Nunito",sans-serif;transition:all 0.15s;
        white-space:nowrap;margin-bottom:-1px;
      `;
      btn.onmouseenter = () => {
        if (btn.dataset.tab !== this.activeCategory) {
          btn.style.color = C.textSecondary;
          btn.style.background = C.tabBg;
        }
      };
      btn.onmouseleave = () => {
        if (btn.dataset.tab !== this.activeCategory) {
          btn.style.color = C.textMuted;
          btn.style.background = 'none';
        }
      };
      btn.onclick = () => {
        this.activeCategory = tab.id;
        this.applyTabStyles();
        this.renderItems();
      };
      tabBar.appendChild(btn);
      this.tabBtns.push(btn);
    }

    // ── Grid container (scrollable) ──
    const gridContainer = document.createElement('div');
    gridContainer.className = 'store-grid-scroll';
    gridContainer.style.cssText = `
      flex:1;overflow-y:auto;padding:16px 22px 16px;min-height:0;
    `;
    panel.appendChild(gridContainer);
    this.gridContainer = gridContainer;

    // ── Footer hint ──
    const footer = document.createElement('div');
    footer.style.cssText = `
      padding:10px 22px;border-top:1px solid ${C.divider};
      display:flex;justify-content:flex-end;align-items:center;
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

    // Subscribe to inventory changes so we can re-render owned badges
    this.unsubInventory = this.inventory.onInventoryChange(() => {
      this.renderItems();
    });

    // Initial render
    this.applyTabStyles();
    this.renderItems();
  }

  // ────────────────────────────────────────────────────────────────
  //  Tab styling
  // ────────────────────────────────────────────────────────────────

  private applyTabStyles(): void {
    for (const btn of this.tabBtns) {
      const isActive = btn.dataset.tab === this.activeCategory;
      btn.style.color = isActive ? C.gold : C.textMuted;
      btn.style.borderBottomColor = isActive ? C.tabBorder : 'transparent';
      btn.style.background = isActive ? C.tabActive : 'none';
    }
  }

  // ────────────────────────────────────────────────────────────────
  //  Render items grid
  // ────────────────────────────────────────────────────────────────

  private renderItems(): void {
    const container = this.gridContainer;
    if (!container) return;
    container.innerHTML = '';

    // Special tab: Gems (crown packages)
    if (this.activeCategory === 'gems') {
      this.renderCrownPackages(container);
      return;
    }

    // Special tab: Bundles
    if (this.activeCategory === 'bundles') {
      this.renderBundles(container);
      return;
    }

    // Normal catalog items
    const tab = TABS.find((t) => t.id === this.activeCategory);
    let items: CatalogItem[];

    if (!tab || this.activeCategory === 'all') {
      items = this.catalog.getAllItems();
    } else if (tab.categories) {
      items = [];
      for (const cat of tab.categories) {
        items.push(...this.catalog.getByCategory(cat));
      }
    } else {
      items = this.catalog.getAllItems();
    }

    if (items.length === 0) {
      this.renderEmpty(container, 'No items in this category');
      return;
    }

    const grid = document.createElement('div');
    grid.style.cssText = `
      display:grid;
      grid-template-columns:repeat(auto-fill, minmax(140px, 1fr));
      gap:12px;
    `;

    for (const item of items) {
      grid.appendChild(this.createItemCard(item));
    }

    container.appendChild(grid);
  }

  // ────────────────────────────────────────────────────────────────
  //  Item card
  // ────────────────────────────────────────────────────────────────

  private createItemCard(item: CatalogItem): HTMLDivElement {
    const owned = this.inventory.owns(item.id);
    const borderColor = RARITY_BORDER[item.rarity];
    const glow = RARITY_GLOW[item.rarity];

    const card = document.createElement('div');
    card.style.cssText = `
      background:${C.surface};
      border:2px solid ${borderColor};
      border-radius:12px;
      padding:10px 8px 10px;
      display:flex;flex-direction:column;align-items:center;gap:6px;
      cursor:pointer;transition:all 0.15s;
      box-shadow:${glow};
      position:relative;
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
      console.log('Open detail:', item.id);
    };

    // ── Preview area ──
    const preview = document.createElement('div');
    preview.style.cssText = `
      width:100%;height:60px;display:flex;align-items:center;justify-content:center;
      font-size:28px;
      background:rgba(0,0,0,0.15);border-radius:8px;
    `;
    preview.textContent = CATEGORY_EMOJI[item.category] ?? '\uD83C\uDFA8';
    card.appendChild(preview);

    // ── Item name ──
    const name = document.createElement('div');
    name.textContent = item.name;
    name.style.cssText = `
      font-size:12px;font-weight:700;color:${C.textPrimary};
      font-family:"Nunito",sans-serif;
      width:100%;text-align:center;
      overflow:hidden;text-overflow:ellipsis;white-space:nowrap;
    `;
    card.appendChild(name);

    // ── Price line ──
    if (!owned) {
      const priceLine = document.createElement('div');
      priceLine.style.cssText = `
        font-size:11px;font-weight:700;
        display:flex;align-items:center;gap:4px;justify-content:center;
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
        gloryPrice.style.cssText = `color:${C.teal};`;
        gloryPrice.textContent = `\u2B50 ${item.priceGlory}`;
        priceLine.appendChild(gloryPrice);
      }

      card.appendChild(priceLine);
    }

    // ── Owned / Equip badge ──
    if (owned) {
      const badge = document.createElement('div');
      badge.textContent = 'OWNED';
      badge.style.cssText = `
        font-size:10px;font-weight:700;font-family:"Fredoka",sans-serif;
        color:#fff;background:${C.green};
        padding:2px 10px;border-radius:6px;letter-spacing:1px;
      `;
      card.appendChild(badge);
    }

    return card;
  }

  // ────────────────────────────────────────────────────────────────
  //  Crown Packages (Gems tab)
  // ────────────────────────────────────────────────────────────────

  private renderCrownPackages(container: HTMLDivElement): void {
    const packages = this.catalog.getCrownPackages();
    const isFirstPurchase = this.wallet.isFirstPurchase;

    const grid = document.createElement('div');
    grid.style.cssText = `
      display:grid;
      grid-template-columns:repeat(auto-fill, minmax(140px, 1fr));
      gap:12px;
    `;

    for (const pkg of packages) {
      grid.appendChild(this.createCrownPackageCard(pkg, isFirstPurchase));
    }

    container.appendChild(grid);
  }

  private createCrownPackageCard(pkg: CrownPackage, isFirstPurchase: boolean): HTMLDivElement {
    const card = document.createElement('div');
    card.style.cssText = `
      background:${C.surface};
      border:2px solid ${C.goldDim};
      border-radius:12px;
      padding:12px 10px 12px;
      display:flex;flex-direction:column;align-items:center;gap:6px;
      cursor:pointer;transition:all 0.15s;
      position:relative;
    `;
    card.onmouseenter = () => {
      card.style.background = C.surfaceActive;
      card.style.transform = 'translateY(-2px)';
      card.style.borderColor = C.gold;
      card.style.boxShadow = '0 4px 12px rgba(255,217,61,0.2)';
    };
    card.onmouseleave = () => {
      card.style.background = C.surface;
      card.style.transform = 'translateY(0)';
      card.style.borderColor = C.goldDim;
      card.style.boxShadow = 'none';
    };

    // ── First purchase bonus badge ──
    if (isFirstPurchase) {
      const bonusBadge = document.createElement('div');
      bonusBadge.textContent = '+50% BONUS';
      bonusBadge.style.cssText = `
        position:absolute;top:-8px;right:-6px;
        font-size:9px;font-weight:700;font-family:"Fredoka",sans-serif;
        color:${C.textDark};background:${C.teal};
        padding:2px 8px;border-radius:6px;letter-spacing:0.5px;
        box-shadow:0 2px 6px rgba(69,230,176,0.3);
        transform:rotate(4deg);
      `;
      card.appendChild(bonusBadge);
    }

    // ── Package icon ──
    const icon = document.createElement('div');
    icon.textContent = pkg.icon;
    icon.style.cssText = 'font-size:32px;line-height:1;';
    card.appendChild(icon);

    // ── Package name ──
    const name = document.createElement('div');
    name.textContent = pkg.name;
    name.style.cssText = `
      font-size:12px;font-weight:700;color:${C.textPrimary};
      font-family:"Nunito",sans-serif;text-align:center;
      overflow:hidden;text-overflow:ellipsis;white-space:nowrap;
      width:100%;
    `;
    card.appendChild(name);

    // ── Crown amount ──
    const amount = document.createElement('div');
    amount.style.cssText = `
      font-size:14px;font-weight:700;color:${C.gold};
      font-family:"Fredoka",sans-serif;
    `;
    amount.textContent = `${pkg.crowns.toLocaleString()} Crowns`;
    card.appendChild(amount);

    // ── Bonus info ──
    if (pkg.bonusPercent > 0) {
      const bonus = document.createElement('div');
      bonus.textContent = `+${pkg.bonusPercent}% bonus`;
      bonus.style.cssText = `
        font-size:10px;font-weight:600;color:${C.teal};
        font-family:"Nunito",sans-serif;
      `;
      card.appendChild(bonus);
    }

    // ── Price ──
    const price = document.createElement('div');
    price.textContent = `$${pkg.priceUSD.toFixed(2)}`;
    price.style.cssText = `
      font-size:12px;font-weight:700;color:${C.textSecondary};
      font-family:"Nunito",sans-serif;
    `;
    card.appendChild(price);

    // ── BUY button ──
    const buyBtn = document.createElement('button');
    buyBtn.textContent = 'BUY';
    buyBtn.style.cssText = `
      width:100%;padding:7px 0;border-radius:8px;font-size:12px;font-weight:700;
      font-family:"Fredoka",sans-serif;cursor:pointer;transition:all 0.15s;
      background:${C.gold};border:none;color:${C.textDark};
      letter-spacing:1px;
      box-shadow:0 2px 8px rgba(255,217,61,0.2);
    `;
    buyBtn.onmouseenter = () => {
      buyBtn.style.background = C.goldDark;
    };
    buyBtn.onmouseleave = () => {
      buyBtn.style.background = C.gold;
    };
    buyBtn.onclick = (e) => {
      e.stopPropagation();
      console.log('Buy crown package:', pkg.id);
    };
    card.appendChild(buyBtn);

    return card;
  }

  // ────────────────────────────────────────────────────────────────
  //  Bundles tab
  // ────────────────────────────────────────────────────────────────

  private renderBundles(container: HTMLDivElement): void {
    const bundles = this.catalog.getBundles();

    if (bundles.length === 0) {
      this.renderEmpty(container, 'No bundles available');
      return;
    }

    const grid = document.createElement('div');
    grid.style.cssText = `
      display:grid;
      grid-template-columns:repeat(auto-fill, minmax(160px, 1fr));
      gap:12px;
    `;

    for (const bundle of bundles) {
      const card = document.createElement('div');
      card.style.cssText = `
        background:${C.surface};
        border:2px solid rgba(255,217,61,0.4);
        border-radius:12px;
        padding:14px 10px 12px;
        display:flex;flex-direction:column;align-items:center;gap:6px;
        cursor:pointer;transition:all 0.15s;
      `;
      card.onmouseenter = () => {
        card.style.background = C.surfaceActive;
        card.style.transform = 'translateY(-2px)';
        card.style.borderColor = C.gold;
        card.style.boxShadow = '0 4px 12px rgba(255,217,61,0.15)';
      };
      card.onmouseleave = () => {
        card.style.background = C.surface;
        card.style.transform = 'translateY(0)';
        card.style.borderColor = 'rgba(255,217,61,0.4)';
        card.style.boxShadow = 'none';
      };
      card.onclick = () => {
        console.log('Open bundle detail:', bundle.id);
      };

      // ── Icon ──
      const icon = document.createElement('div');
      icon.textContent = bundle.icon;
      icon.style.cssText = 'font-size:32px;line-height:1;';
      card.appendChild(icon);

      // ── Name ──
      const name = document.createElement('div');
      name.textContent = bundle.name;
      name.style.cssText = `
        font-size:13px;font-weight:700;color:${C.textPrimary};
        font-family:"Nunito",sans-serif;text-align:center;
      `;
      card.appendChild(name);

      // ── Description ──
      const desc = document.createElement('div');
      desc.textContent = bundle.description;
      desc.style.cssText = `
        font-size:10px;color:${C.textSecondary};text-align:center;
        font-family:"Nunito",sans-serif;line-height:1.3;
        display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;
      `;
      card.appendChild(desc);

      // ── Items count + crowns included ──
      const meta = document.createElement('div');
      meta.style.cssText = `
        font-size:10px;color:${C.textMuted};text-align:center;
        font-family:"Nunito",sans-serif;
      `;
      meta.textContent = `${bundle.items.length} items + ${bundle.crownsIncluded.toLocaleString()} Crowns`;
      card.appendChild(meta);

      // ── Price ──
      const priceLine = document.createElement('div');
      priceLine.style.cssText = `
        font-size:12px;font-weight:700;
        font-family:"Nunito",sans-serif;
        display:flex;align-items:center;gap:6px;justify-content:center;
      `;
      if (bundle.priceUSD != null) {
        const usd = document.createElement('span');
        usd.textContent = `$${bundle.priceUSD.toFixed(2)}`;
        usd.style.cssText = `color:${C.textPrimary};`;
        priceLine.appendChild(usd);
      }
      if (bundle.priceCrowns != null) {
        const crowns = document.createElement('span');
        crowns.style.cssText = `color:${C.gold};`;
        crowns.textContent = `\u{1F451} ${bundle.priceCrowns}`;
        priceLine.appendChild(crowns);
      }
      card.appendChild(priceLine);

      // ── BUY button ──
      const buyBtn = document.createElement('button');
      buyBtn.textContent = 'BUY';
      buyBtn.style.cssText = `
        width:100%;padding:7px 0;border-radius:8px;font-size:12px;font-weight:700;
        font-family:"Fredoka",sans-serif;cursor:pointer;transition:all 0.15s;
        background:${C.gold};border:none;color:${C.textDark};
        letter-spacing:1px;
        box-shadow:0 2px 8px rgba(255,217,61,0.2);
      `;
      buyBtn.onmouseenter = () => { buyBtn.style.background = C.goldDark; };
      buyBtn.onmouseleave = () => { buyBtn.style.background = C.gold; };
      buyBtn.onclick = (e) => {
        e.stopPropagation();
        console.log('Buy bundle:', bundle.id);
      };
      card.appendChild(buyBtn);

      grid.appendChild(card);
    }

    container.appendChild(grid);
  }

  // ────────────────────────────────────────────────────────────────
  //  Empty state
  // ────────────────────────────────────────────────────────────────

  private renderEmpty(container: HTMLDivElement, message: string): void {
    const empty = document.createElement('div');
    empty.style.cssText = `
      display:flex;align-items:center;justify-content:center;
      padding:48px 20px;
    `;
    const text = document.createElement('span');
    text.textContent = message;
    text.style.cssText = `
      font-size:14px;color:${C.textMuted};font-family:"Nunito",sans-serif;
      font-style:italic;
    `;
    empty.appendChild(text);
    container.appendChild(empty);
  }

  // ────────────────────────────────────────────────────────────────
  //  Inject scoped styles
  // ────────────────────────────────────────────────────────────────

  private injectStyles(): void {
    if (document.getElementById('store-panel-styles')) return;
    const style = document.createElement('style');
    style.id = 'store-panel-styles';
    style.textContent = `
      /* Scrollbar for grid area */
      #store-overlay .store-grid-scroll::-webkit-scrollbar { width:5px; }
      #store-overlay .store-grid-scroll::-webkit-scrollbar-track { background:transparent; }
      #store-overlay .store-grid-scroll::-webkit-scrollbar-thumb {
        background:rgba(139,115,85,0.3);border-radius:3px;
      }
      #store-overlay .store-grid-scroll::-webkit-scrollbar-thumb:hover {
        background:rgba(139,115,85,0.5);
      }
      /* Hide tab bar scrollbar */
      #store-overlay div::-webkit-scrollbar { height:0; }
    `;
    document.head.appendChild(style);
  }
}
