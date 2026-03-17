// ─── StorePanel — DOM overlay for the in-game store ─────────────
// Dark glassmorphism panel matching SettingsPanel / FriendsPanel style.
// Categories, item grid, crown packages, and bundles.

import { C } from './UIColors';
import { CurrencyDisplay } from './CurrencyDisplay';
import { WalletManager } from '../store/WalletManager';
import { InventoryManager } from '../store/InventoryManager';
import { CatalogService } from '../store/CatalogService';
import type { CatalogItem, CrownPackage, Rarity, ItemCategory } from '@prompt-battle/shared';
import { PaymentService } from '../store/PaymentService';
import { PaymentModal } from './PaymentModal';
import { ItchRedeemModal } from './ItchRedeemModal';
import { showPurchaseConfirm } from './PurchaseConfirmModal';
import { showGuestLoginPrompt } from './LoginOverlay';
import { AuthManager } from '../auth/AuthManager';

// ── Category definitions ────────────────────────────────────────

interface StoreTab {
  id: string;
  label: string;
  /** ItemCategory values to include, or null for special tabs */
  categories: ItemCategory[] | null;
}

const TABS: StoreTab[] = [
  { id: 'gems',       label: '\uD83D\uDC51 Crowns',      categories: null },
  { id: 'stars',      label: '\u2605 Stars',              categories: null },
  { id: 'battlepass', label: '\uD83C\uDFC6 Horde Pass',  categories: null },
  { id: 'bundles',    label: '\uD83C\uDF81 Bundles',      categories: null },
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
  private activeCategory: string = 'gems';
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
    // Reset container styles that special tabs may have set
    container.style.display = '';
    container.style.flexDirection = '';
    container.style.alignItems = '';
    container.style.gap = '';
    container.style.padding = '16px 22px 16px';

    // Special tab: Gems (crown packages)
    if (this.activeCategory === 'gems') {
      this.renderCrownPackages(container);
      return;
    }

    // Special tab: Stars (crowns → glory exchange)
    if (this.activeCategory === 'stars') {
      this.renderStarsExchange(container);
      return;
    }

    // Special tab: Bundles
    if (this.activeCategory === 'bundles') {
      this.renderBundles(container);
      return;
    }

    // Special tab: Battle Pass
    if (this.activeCategory === 'battlepass') {
      this.renderBattlePass(container);
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
      grid-template-columns:repeat(auto-fill, minmax(160px, 1fr));
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
      if (AuthManager.getInstance().isGuest) {
        showGuestLoginPrompt('make purchases');
        return;
      }
      const inv = InventoryManager.getInstance();
      if (inv.owns(item.id)) return; // already owned
      showPurchaseConfirm({
        itemName: item.name,
        priceCrowns: item.priceCrowns,
        priceGlory: item.priceGlory ?? undefined,
        onConfirm: async () => {
          const currency = item.priceGlory ? 'glory' : 'crowns';
          const result = await PaymentService.getInstance().purchaseItem(item.id, currency);
          if (!result.success) alert(result.error || 'Purchase failed');
        },
        onCancel: () => {},
      });
    };

    // ── Preview area ──
    const preview = document.createElement('div');
    const isPortrait = item.category === 'avatar_portrait';
    preview.style.cssText = `
      width:100%;height:${isPortrait ? '100px' : '60px'};display:flex;align-items:center;justify-content:center;
      font-size:${isPortrait ? '14px' : '28px'};
      background:rgba(0,0,0,0.15);border-radius:8px;
      overflow:hidden;
    `;
    if (isPortrait && item.id.startsWith('portrait_') && item.unitType) {
      // Show actual avatar image for unit portraits
      const img = document.createElement('img');
      img.src = `assets/enemies/avatars/${item.unitType}.png`;
      img.style.cssText = 'width:80px;height:80px;object-fit:cover;image-rendering:pixelated;border-radius:50%;';
      preview.appendChild(img);
    } else {
      preview.textContent = CATEGORY_EMOJI[item.category] ?? '\uD83C\uDFA8';
    }
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

    // ── Price line (single currency) ──
    if (!owned) {
      const priceLine = document.createElement('div');
      priceLine.style.cssText = `
        font-size:12px;font-weight:700;
        display:flex;align-items:center;gap:4px;justify-content:center;
      `;

      if (item.priceGlory && item.priceGlory > 0) {
        const gloryPrice = document.createElement('span');
        gloryPrice.style.cssText = `color:#C0C0D2;`;
        gloryPrice.textContent = `\u2605 ${item.priceGlory}`;
        priceLine.appendChild(gloryPrice);
      } else {
        const crownPrice = document.createElement('span');
        crownPrice.style.cssText = `color:${C.gold};`;
        crownPrice.textContent = `\u{1F451} ${item.priceCrowns}`;
        priceLine.appendChild(crownPrice);
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
      grid-template-columns:repeat(auto-fill, minmax(160px, 1fr));
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

    // ── Bonus badge — show package bonus %, skip if 0% ──
    if (pkg.bonusPercent > 0) {
      const bonusBadge = document.createElement('div');
      bonusBadge.textContent = `+${pkg.bonusPercent}% BONUS`;
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
    buyBtn.onclick = async (e) => {
      e.stopPropagation();
      if (AuthManager.getInstance().isGuest) {
        showGuestLoginPrompt('buy crowns');
        return;
      }
      const platform = PaymentService.getInstance().getPlatform();
      if (platform === 'test') {
        // Dev mode: grant crowns directly
        PaymentService.getInstance().purchaseItem(pkg.id, 'crowns').catch(() => {});
        // Or use dev tools
        (window as any).__devAddCrowns?.(pkg.crowns);
      } else if (platform === 'itch') {
        const modal = new ItchRedeemModal();
        modal.show({ onSuccess: () => {}, onCancel: () => {} });
      } else {
        // Square payment
        try {
          const order = await PaymentService.getInstance().createOrder(pkg.id);
          const payModal = new PaymentModal();
          payModal.show({
            packageName: pkg.name,
            crowns: order.crowns,
            amountUSD: pkg.priceUSD,
            orderId: order.orderId,
            onSuccess: async (sourceId: string) => {
              payModal.close();
              const result = await PaymentService.getInstance().completePayment(order.orderId, sourceId, pkg.id);
              if (result.success) {
                // Show success feedback - wallet updates automatically via listener
                alert(`+${result.crownsGranted} Crowns!`);
              } else {
                alert(result.error || 'Payment failed');
              }
            },
            onCancel: () => payModal.close(),
            onError: (err) => { payModal.close(); alert(err); },
          });
        } catch (err: any) {
          alert(err.message || 'Failed to start payment');
        }
      }
    };
    card.appendChild(buyBtn);

    return card;
  }

  // ────────────────────────────────────────────────────────────────
  //  Bundles tab
  // ────────────────────────────────────────────────────────────────

  private renderBattlePass(container: HTMLDivElement): void {
    container.style.display = 'flex';
    container.style.flexDirection = 'column';
    container.style.alignItems = 'center';
    container.style.gap = '16px';
    container.style.padding = '20px';

    // Season banner
    const banner = document.createElement('div');
    banner.style.cssText = `
      width:100%;max-width:500px;text-align:center;
      background:${C.surface};border:2px solid ${C.panelBorder};border-radius:14px;
      padding:28px 24px;
    `;
    banner.innerHTML = `
      <div style="font-size:13px;color:${C.gold};font-family:'Fredoka',sans-serif;letter-spacing:2px;margin-bottom:6px;">SEASON 1</div>
      <div style="font-size:28px;font-weight:700;color:${C.textH1};font-family:'Fredoka',sans-serif;margin-bottom:8px;">Season of the Blade</div>
      <div style="font-size:13px;color:${C.textMuted};margin-bottom:16px;">50 tiers of exclusive rewards. Earn XP by playing matches and completing challenges.</div>
      <div style="display:flex;justify-content:center;gap:20px;margin-bottom:16px;">
        <div style="text-align:center;">
          <div style="font-size:11px;color:${C.textMuted};letter-spacing:1px;">FREE TRACK</div>
          <div style="font-size:14px;color:${C.teal};font-weight:700;margin-top:2px;">Always included</div>
        </div>
        <div style="width:1px;background:${C.divider};"></div>
        <div style="text-align:center;">
          <div style="font-size:11px;color:${C.textMuted};letter-spacing:1px;">BATTLE PASS</div>
          <div style="font-size:14px;color:${C.gold};font-weight:700;margin-top:2px;">\uD83D\uDC51 1,000 Crowns</div>
        </div>
      </div>
    `;

    // Buy button
    const buyBtn = document.createElement('button');
    buyBtn.textContent = 'BUY BATTLE PASS — 1,000 \uD83D\uDC51';
    buyBtn.style.cssText = `
      width:100%;max-width:360px;font-family:'Fredoka',sans-serif;font-size:16px;font-weight:700;
      color:#1a1a0a;background:${C.gold};border:none;border-radius:12px;
      padding:16px 32px;cursor:pointer;transition:all 0.15s;
      box-shadow:0 4px 16px rgba(255,217,61,0.3);
    `;
    buyBtn.onmouseenter = () => { buyBtn.style.filter = 'brightness(1.15)'; buyBtn.style.transform = 'scale(1.03)'; };
    buyBtn.onmouseleave = () => { buyBtn.style.filter = ''; buyBtn.style.transform = ''; };
    buyBtn.onclick = async () => {
      buyBtn.textContent = '...';
      try {
        const { getAuth } = await import('firebase/auth');
        const { getFirebaseApp } = await import('../auth/firebaseApp');
        const token = await getAuth(getFirebaseApp()).currentUser?.getIdToken();
        if (!token) return;
        const baseUrl = (import.meta as any).env?.VITE_FUNCTIONS_URL || '';
        const res = await fetch(`${baseUrl}/api/store/purchaseBattlePass`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
          body: JSON.stringify({ tier: 'premium' }),
        });
        const data = await res.json().catch(() => ({ error: 'Failed' }));
        buyBtn.textContent = data.success ? '\u2713 BATTLE PASS UNLOCKED' : (data.error || 'Failed');
        if (data.success) buyBtn.style.background = C.teal;
      } catch { buyBtn.textContent = 'Error'; }
    };
    banner.appendChild(buyBtn);

    // View full pass link
    const viewLink = document.createElement('div');
    viewLink.style.cssText = `text-align:center;margin-top:14px;font-size:12px;color:${C.teal};cursor:pointer;transition:color 0.15s;`;
    viewLink.textContent = 'View full Horde Pass \u2192';
    viewLink.onmouseenter = () => { viewLink.style.color = C.gold; };
    viewLink.onmouseleave = () => { viewLink.style.color = C.teal; };
    viewLink.onclick = () => {
      this.close();
      import('./BattlePassPanel').then(({ BattlePassPanel }) => {
        new BattlePassPanel().mount(document.body);
      });
    };
    banner.appendChild(viewLink);

    container.appendChild(banner);
  }

  // ────────────────────────────────────────────────────────────────
  //  Stars Exchange (crowns → glory at a terrible rate)
  // ────────────────────────────────────────────────────────────────

  private static readonly STAR_PACKAGES = [
    { id: 'stars_tiny',   name: 'Handful of Stars', crowns: 100,   stars: 5,    icon: '\u2B50' },
    { id: 'stars_small',  name: 'Star Pouch',       crowns: 250,   stars: 15,   icon: '\uD83C\uDF1F' },
    { id: 'stars_medium', name: 'Star Crate',       crowns: 500,   stars: 35,   icon: '\u2728' },
    { id: 'stars_large',  name: 'Star Chest',       crowns: 1000,  stars: 80,   icon: '\uD83D\uDCAB' },
    { id: 'stars_mega',   name: 'Star Vault',       crowns: 2500,  stars: 220,  icon: '\uD83C\uDF20' },
    { id: 'stars_ultra',  name: 'Cosmic Haul',      crowns: 5000,  stars: 500,  icon: '\uD83C\uDF0C' },
  ];

  private renderStarsExchange(container: HTMLDivElement): void {
    // Disclaimer banner
    const disclaimer = document.createElement('div');
    disclaimer.style.cssText = `
      text-align:center;margin-bottom:14px;padding:10px 16px;
      background:rgba(192,192,210,0.08);border:1px solid rgba(192,192,210,0.15);
      border-radius:10px;
    `;
    disclaimer.innerHTML = `
      <div style="font-size:12px;color:#C0C0D2;font-family:'Fredoka',sans-serif;font-weight:700;letter-spacing:1px;margin-bottom:4px;">\u2605 STAR EXCHANGE</div>
      <div style="font-size:11px;color:${C.textMuted};font-family:'Nunito',sans-serif;">Convert Crowns into Stars. Stars can buy exclusive glory-priced cosmetics.<br><span style="color:${C.red};font-weight:600;">Warning: exchange rates are not great.</span></div>
    `;
    container.appendChild(disclaimer);

    const grid = document.createElement('div');
    grid.style.cssText = `
      display:grid;
      grid-template-columns:repeat(auto-fill, minmax(160px, 1fr));
      gap:12px;
    `;

    for (const pkg of StorePanel.STAR_PACKAGES) {
      grid.appendChild(this.createStarPackageCard(pkg));
    }

    container.appendChild(grid);
  }

  private createStarPackageCard(pkg: { id: string; name: string; crowns: number; stars: number; icon: string }): HTMLDivElement {
    const rate = (pkg.crowns / pkg.stars).toFixed(1);
    const card = document.createElement('div');
    card.style.cssText = `
      background:${C.surface};
      border:2px solid rgba(192,192,210,0.25);
      border-radius:12px;
      padding:12px 10px 12px;
      display:flex;flex-direction:column;align-items:center;gap:6px;
      cursor:pointer;transition:all 0.15s;
      position:relative;
    `;
    card.onmouseenter = () => {
      card.style.background = C.surfaceActive;
      card.style.transform = 'translateY(-2px)';
      card.style.borderColor = 'rgba(192,192,210,0.5)';
      card.style.boxShadow = '0 4px 12px rgba(192,192,210,0.15)';
    };
    card.onmouseleave = () => {
      card.style.background = C.surface;
      card.style.transform = 'translateY(0)';
      card.style.borderColor = 'rgba(192,192,210,0.25)';
      card.style.boxShadow = 'none';
    };

    // Icon
    const icon = document.createElement('div');
    icon.textContent = pkg.icon;
    icon.style.cssText = 'font-size:32px;line-height:1;';
    card.appendChild(icon);

    // Name
    const name = document.createElement('div');
    name.textContent = pkg.name;
    name.style.cssText = `
      font-size:12px;font-weight:700;color:${C.textPrimary};
      font-family:"Nunito",sans-serif;text-align:center;
      overflow:hidden;text-overflow:ellipsis;white-space:nowrap;width:100%;
    `;
    card.appendChild(name);

    // Stars amount
    const amount = document.createElement('div');
    amount.style.cssText = `font-size:14px;font-weight:700;color:#C0C0D2;font-family:"Fredoka",sans-serif;`;
    amount.textContent = `\u2605 ${pkg.stars} Stars`;
    card.appendChild(amount);

    // Rate
    const rateEl = document.createElement('div');
    rateEl.textContent = `${rate} crowns/star`;
    rateEl.style.cssText = `font-size:9px;font-weight:600;color:${C.textMuted};font-family:"Nunito",sans-serif;`;
    card.appendChild(rateEl);

    // Price
    const price = document.createElement('div');
    price.style.cssText = `font-size:12px;font-weight:700;color:${C.gold};font-family:"Nunito",sans-serif;`;
    price.textContent = `\u{1F451} ${pkg.crowns.toLocaleString()}`;
    card.appendChild(price);

    // BUY button
    const buyBtn = document.createElement('button');
    buyBtn.textContent = 'EXCHANGE';
    buyBtn.style.cssText = `
      width:100%;padding:7px 0;border-radius:8px;font-size:11px;font-weight:700;
      font-family:"Fredoka",sans-serif;cursor:pointer;transition:all 0.15s;
      background:rgba(192,192,210,0.2);border:1px solid rgba(192,192,210,0.3);color:#C0C0D2;
      letter-spacing:1px;
    `;
    buyBtn.onmouseenter = () => {
      buyBtn.style.background = 'rgba(192,192,210,0.3)';
      buyBtn.style.borderColor = 'rgba(192,192,210,0.5)';
    };
    buyBtn.onmouseleave = () => {
      buyBtn.style.background = 'rgba(192,192,210,0.2)';
      buyBtn.style.borderColor = 'rgba(192,192,210,0.3)';
    };
    buyBtn.onclick = async (e) => {
      e.stopPropagation();
      if (AuthManager.getInstance().isGuest) {
        showGuestLoginPrompt('exchange crowns for stars');
        return;
      }
      const wallet = this.wallet;
      if (wallet.crowns < pkg.crowns) {
        showPurchaseConfirm({
          itemName: pkg.name,
          priceCrowns: pkg.crowns,
          onConfirm: async () => {},
          onCancel: () => {},
        });
        return;
      }
      showPurchaseConfirm({
        itemName: `${pkg.name} (\u2605 ${pkg.stars} Stars)`,
        priceCrowns: pkg.crowns,
        onConfirm: async () => {
          buyBtn.textContent = '...';
          try {
            const { getAuth } = await import('firebase/auth');
            const { getFirebaseApp } = await import('../auth/firebaseApp');
            const token = await getAuth(getFirebaseApp()).currentUser?.getIdToken();
            if (!token) return;
            const baseUrl = (import.meta as any).env?.VITE_FUNCTIONS_URL || '';
            const res = await fetch(`${baseUrl}/api/store/exchangeStars`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
              body: JSON.stringify({ packageId: pkg.id }),
            });
            const data = await res.json().catch(() => ({ error: 'Failed' }));
            if (data.success) {
              buyBtn.textContent = `\u2713 +${pkg.stars} \u2605`;
              buyBtn.style.background = C.teal;
              buyBtn.style.color = C.textDark;
              buyBtn.style.borderColor = C.teal;
              setTimeout(() => {
                buyBtn.textContent = 'EXCHANGE';
                buyBtn.style.background = 'rgba(192,192,210,0.2)';
                buyBtn.style.color = '#C0C0D2';
                buyBtn.style.borderColor = 'rgba(192,192,210,0.3)';
              }, 2000);
            } else {
              buyBtn.textContent = data.error || 'Failed';
              setTimeout(() => { buyBtn.textContent = 'EXCHANGE'; }, 2000);
            }
          } catch {
            buyBtn.textContent = 'Error';
            setTimeout(() => { buyBtn.textContent = 'EXCHANGE'; }, 2000);
          }
        },
        onCancel: () => {},
      });
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
        if (AuthManager.getInstance().isGuest) {
          showGuestLoginPrompt('buy bundles');
          return;
        }
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
