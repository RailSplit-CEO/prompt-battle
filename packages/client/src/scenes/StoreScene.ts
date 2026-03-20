import Phaser from 'phaser';
import { AuthManager } from '../auth/AuthManager';
import { GameSettings } from '../systems/GameSettings';
import { C } from '../ui/UIColors';
import { WalletManager } from '../store/WalletManager';
import { InventoryManager } from '../store/InventoryManager';
import type { CatalogItem, Rarity, ItemCategory, CrownPackage } from '@prompt-battle/shared';

type StoreTab = 'featured' | 'skins' | 'portraits' | 'voices' | 'effects' | 'emotes' | 'profile' | 'themes' | 'equipment' | 'gems';

interface TabDef {
  key: StoreTab;
  label: string;
  categories: ItemCategory[] | null; // null = special (gems)
}

const TABS: TabDef[] = [
  { key: 'featured',  label: 'Featured',  categories: null },
  { key: 'skins',     label: 'Skins',     categories: ['unit_skin'] },
  { key: 'portraits', label: 'Portraits', categories: ['avatar_portrait', 'portrait_frame'] },
  { key: 'voices',    label: 'Voices',    categories: ['voice_pack', 'voice_effect'] },
  { key: 'effects',   label: 'Effects',   categories: ['death_effect', 'spawn_effect', 'attack_trail', 'victory_effect'] },
  { key: 'emotes',    label: 'Emotes',    categories: ['emote'] },
  { key: 'profile',   label: 'Profile',   categories: ['profile_title', 'profile_border', 'profile_background', 'cursor_pack'] },
  // themes tab removed (building_theme, map_theme, ui_theme no longer exist)
  { key: 'equipment', label: 'Equipment', categories: ['equipment_cosmetic'] },
  { key: 'gems',      label: 'Gems',      categories: null },
];

const RARITY_BORDER: Record<string, string> = {
  common: 'rgba(150,150,150,0.5)', rare: 'rgba(68,136,255,0.6)',
  epic: 'rgba(170,68,255,0.6)', legendary: 'rgba(255,217,61,0.6)',
};
const RARITY_GLOW: Record<string, string> = {
  common: 'none', rare: '0 0 8px rgba(68,136,255,0.2)',
  epic: '0 0 8px rgba(170,68,255,0.2)', legendary: '0 0 12px rgba(255,217,61,0.25)',
};
const RARITY_COLOR: Record<string, string> = {
  common: '#999', rare: '#4488FF', epic: '#AA44FF', legendary: '#FFD93D',
};
const CAT_EMOJI: Partial<Record<string, string>> = {
  unit_skin: '🎨', avatar_portrait: '🖼️', portrait_frame: '🖼️',
  voice_pack: '🎙️', voice_effect: '🎙️', equipment_cosmetic: '⚔️',
  death_effect: '💥', spawn_effect: '⚡', attack_trail: '✨', victory_effect: '🎆',
  emote: '😄', profile_title: '📛',
  profile_border: '🖼️', profile_background: '🌄', cursor_pack: '🕹️',
  booster: '🚀',
};

export class StoreScene extends Phaser.Scene {
  private activeTab: StoreTab = 'featured';
  private contentEl: HTMLDivElement | null = null;
  private tabContainers: Map<StoreTab, { container: Phaser.GameObjects.Container; bg: Phaser.GameObjects.Graphics; text: Phaser.GameObjects.Text }> = new Map();
  private muted: boolean = GameSettings.getInstance().get('muteAll');
  private floatingShapes: { sprite: Phaser.GameObjects.Image; vx: number; vy: number; rot: number }[] = [];
  private currencyText?: Phaser.GameObjects.Text;
  private walletUnsub?: () => void;
  private invUnsub?: () => void;
  private _resizeHandler: (() => void) | null = null;
  private _resizeTimer: number | null = null;

  constructor() {
    super({ key: 'StoreScene' });
  }

  create() {
    this._resizeHandler = () => {
      if (this._resizeTimer !== null) clearTimeout(this._resizeTimer);
      this._resizeTimer = window.setTimeout(() => { this.scene.restart(); }, 200);
    };
    this.scale.on('resize', this._resizeHandler);
    this.events.once('shutdown', () => {
      if (this._resizeHandler) this.scale.off('resize', this._resizeHandler);
      if (this._resizeTimer !== null) clearTimeout(this._resizeTimer);
      this.destroyContent();
      if (this.walletUnsub) this.walletUnsub();
      if (this.invUnsub) this.invUnsub();
    });

    const { width, height } = this.cameras.main;

    // === BACKGROUND ===
    this.cameras.main.setBackgroundColor('#0f1a0a');
    this.cameras.main.fadeIn(400, 15, 26, 10);
    const bg = this.add.graphics().setDepth(0);
    bg.fillStyle(0x0f1a0a, 1); bg.fillRect(0, 0, width, height);
    bg.fillStyle(0x1a2e10, 0.6); bg.fillCircle(width / 2, height * 0.45, Math.max(width, height) * 0.5);
    bg.fillStyle(0x243a18, 0.3); bg.fillCircle(width / 2, height * 0.45, Math.max(width, height) * 0.3);
    this.createFloatingIcons(width, height);

    // === BACK BUTTON ===
    const backBtn = this.createSmallButton(80, 28, 120, 32, '← BACK', 'yellow');
    backBtn.zone.on('pointerdown', () => {
      this.cameras.main.fadeOut(300, 15, 26, 10);
      this.cameras.main.once('camerafadeoutcomplete', () => this.scene.start('MenuScene'));
    });

    // === CURRENCY (top-right, live-updating) ===
    this.currencyText = this.add.text(width - 20, 28, '', {
      fontSize: '14px', color: '#d4c8a0', fontFamily: '"Fredoka", sans-serif', fontStyle: 'bold',
      stroke: '#000', strokeThickness: 2,
    }).setOrigin(1, 0.5).setDepth(11);
    this.updateCurrency();
    try {
      const wm = WalletManager.getInstance();
      this.walletUnsub = wm.onChange(() => this.updateCurrency());
    } catch {}

    // === TITLE ===
    const titleY = 70;
    this.add.text(width / 2 + 2, titleY + 2, 'STORE', {
      fontSize: '42px', color: '#000', fontFamily: '"Fredoka", sans-serif', fontStyle: 'bold',
    }).setOrigin(0.5).setAlpha(0.4).setDepth(10);
    const title = this.add.text(width / 2, titleY, 'STORE', {
      fontSize: '42px', color: '#FFD93D', fontFamily: '"Fredoka", sans-serif', fontStyle: 'bold',
      stroke: '#3a2a10', strokeThickness: 5,
    }).setOrigin(0.5).setAlpha(0).setScale(0.5).setDepth(11);
    this.tweens.add({ targets: title, alpha: 1, scaleX: 1, scaleY: 1, duration: 600, ease: 'Back.easeOut' });
    this.tweens.add({ targets: title, scaleX: { from: 1, to: 1.01 }, scaleY: { from: 1, to: 1.01 }, duration: 1400, yoyo: true, repeat: -1, ease: 'Sine.easeInOut', delay: 600 });

    const subtitle = this.add.text(width / 2, titleY + 32, 'Upgrade your arsenal', {
      fontSize: '13px', color: '#a89870', fontFamily: '"Nunito", sans-serif', fontStyle: 'bold',
      letterSpacing: 3, stroke: '#0a0f06', strokeThickness: 2,
    }).setOrigin(0.5).setAlpha(0).setDepth(11);
    this.tweens.add({ targets: subtitle, alpha: 0.9, duration: 500, delay: 300 });

    // === TAB BAR ===
    const tabY = titleY + 60;
    this.buildTabBar(width / 2, tabY);

    // === CONTENT AREA ===
    const contentTop = tabY + 32;
    this.createContentDiv(contentTop, width, height);
    this.renderTab(this.activeTab);

    // === ESC ===
    this.input.keyboard!.on('keydown-ESC', () => {
      this.cameras.main.fadeOut(300, 15, 26, 10);
      this.cameras.main.once('camerafadeoutcomplete', () => this.scene.start('MenuScene'));
    });

    // === Inventory change subscription ===
    try {
      const { InventoryManager } = require('../store/InventoryManager');
      const inv = InventoryManager.getInstance();
      this.invUnsub = inv.onInventoryChange(() => {
        if (this.activeTab !== 'gems') this.renderTab(this.activeTab);
      });
    } catch {}
  }

  update() {
    for (const s of this.floatingShapes) {
      s.sprite.x += s.vx; s.sprite.y += s.vy; s.sprite.angle += s.rot;
      const { width, height } = this.cameras.main;
      if (s.sprite.x < -40) s.sprite.x = width + 40;
      if (s.sprite.x > width + 40) s.sprite.x = -40;
      if (s.sprite.y < -40) s.sprite.y = height + 40;
      if (s.sprite.y > height + 40) s.sprite.y = -40;
    }
  }

  // ── Currency ───────────────────────────────────────────────────

  private updateCurrency() {
    if (!this.currencyText) return;
    try {
      const wm_ = WalletManager;
      const wm = WalletManager.getInstance();
      this.currencyText.setText(`👑 ${wm.crowns.toLocaleString()}   ★ ${wm.glory.toLocaleString()}`);
    } catch {
      this.currencyText.setText('👑 0   ★ 0');
    }
  }

  // ── Tab Bar ────────────────────────────────────────────────────

  private buildTabBar(cx: number, cy: number) {
    const tabW = 72, tabH = 28, gap = 3;
    const totalW = TABS.length * tabW + (TABS.length - 1) * gap;
    const startX = cx - totalW / 2 + tabW / 2;

    for (let i = 0; i < TABS.length; i++) {
      const tab = TABS[i];
      const x = startX + i * (tabW + gap);
      const container = this.add.container(x, cy).setDepth(12);
      const bg = this.add.graphics();
      const isActive = tab.key === this.activeTab;
      this.drawTabBg(bg, tabW, tabH, isActive);
      container.add(bg);

      const text = this.add.text(0, 0, tab.label, {
        fontSize: '10px', fontFamily: '"Nunito", sans-serif', fontStyle: '700',
        color: isActive ? '#FFD93D' : '#a89870',
      }).setOrigin(0.5);
      container.add(text);
      this.tabContainers.set(tab.key, { container, bg, text });

      const zone = this.add.zone(x, cy, tabW, tabH).setInteractive({ useHandCursor: true }).setDepth(13);
      zone.on('pointerover', () => { if (tab.key !== this.activeTab) { bg.clear(); this.drawTabBg(bg, tabW, tabH, false, true); text.setColor('#d4c8a0'); } });
      zone.on('pointerout', () => { if (tab.key !== this.activeTab) { bg.clear(); this.drawTabBg(bg, tabW, tabH, false); text.setColor('#a89870'); } });
      zone.on('pointerdown', () => { this.playsfx('button_click', 0.3); this.switchTab(tab.key); });

      container.setAlpha(0);
      this.tweens.add({ targets: container, alpha: 1, duration: 300, delay: 150 + i * 30 });
    }
  }

  private drawTabBg(g: Phaser.GameObjects.Graphics, w: number, h: number, active: boolean, hover = false) {
    if (active) { g.fillStyle(0xFFD93D, 0.12); g.fillRoundedRect(-w / 2, -h / 2, w, h, 5); g.lineStyle(1.5, 0xFFD93D, 0.5); g.strokeRoundedRect(-w / 2, -h / 2, w, h, 5); }
    else if (hover) { g.fillStyle(0xffffff, 0.05); g.fillRoundedRect(-w / 2, -h / 2, w, h, 5); }
    else { g.fillStyle(0xffffff, 0.02); g.fillRoundedRect(-w / 2, -h / 2, w, h, 5); }
  }

  private switchTab(key: StoreTab) {
    this.activeTab = key;
    for (const [k, { bg, text }] of this.tabContainers) {
      bg.clear(); this.drawTabBg(bg, 72, 28, k === key);
      text.setColor(k === key ? '#FFD93D' : '#a89870');
    }
    this.renderTab(key);
  }

  // ── Content Area ───────────────────────────────────────────────

  private createContentDiv(top: number, width: number, height: number) {
    this.destroyContent();
    const el = document.createElement('div');
    el.id = 'store-content';
    const w = Math.min(900, width - 32);
    el.style.cssText = `
      position:fixed;top:${top}px;left:50%;transform:translateX(-50%);
      width:${w}px;max-height:${height - top - 16}px;
      background:rgba(18,22,14,0.92);border:2px solid rgba(139,115,85,0.35);border-radius:14px;
      backdrop-filter:blur(12px);-webkit-backdrop-filter:blur(12px);
      overflow-y:auto;overflow-x:hidden;padding:16px 20px;box-sizing:border-box;
      z-index:100;font-family:'Nunito',sans-serif;color:#d4c8a0;
      scrollbar-width:thin;scrollbar-color:rgba(139,115,85,0.5) rgba(139,115,85,0.15);
      opacity:0;transition:opacity 0.3s ease;
    `;
    document.body.appendChild(el);
    this.contentEl = el;
    requestAnimationFrame(() => { el.style.opacity = '1'; });

    if (!document.getElementById('store-content-styles')) {
      const style = document.createElement('style');
      style.id = 'store-content-styles';
      style.textContent = `
        #store-content::-webkit-scrollbar { width:5px; }
        #store-content::-webkit-scrollbar-track { background:rgba(139,115,85,0.15);border-radius:3px; }
        #store-content::-webkit-scrollbar-thumb { background:rgba(139,115,85,0.5);border-radius:3px; }
        .store-grid { display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:12px; }
        .store-card { background:rgba(255,248,230,0.04);border-radius:10px;padding:14px 10px;
          text-align:center;cursor:pointer;transition:all 0.15s;position:relative;border:2px solid transparent; }
        .store-card:hover { background:rgba(255,248,230,0.08);transform:translateY(-3px); }
        .store-card-emoji { font-size:32px;margin-bottom:6px; }
        .store-card-name { font-size:13px;font-weight:700;color:#d4c8a0;margin-bottom:4px;word-wrap:break-word; }
        .store-card-rarity { font-size:9px;font-weight:700;text-transform:uppercase;margin-bottom:6px; }
        .store-card-price { font-size:12px;font-weight:700;display:flex;align-items:center;justify-content:center;gap:6px; }
        .store-owned { display:inline-block;padding:3px 10px;border-radius:4px;font-size:10px;font-weight:700;
          color:#fff;background:#3a6a2e;letter-spacing:1px; }
        .store-section-title { font-size:16px;font-weight:800;color:#FFD93D;font-family:'Fredoka',sans-serif;
          letter-spacing:2px;margin-bottom:12px; }
      `;
      document.head.appendChild(style);
    }
  }

  private destroyContent() {
    if (this.contentEl) { this.contentEl.remove(); this.contentEl = null; }
  }

  // ── Tab Renderers ──────────────────────────────────────────────

  private async renderTab(tab: StoreTab) {
    if (!this.contentEl) return;
    const el = this.contentEl;

    if (tab === 'gems') { this.renderGems(); return; }

    // Load services
    let catalog: any, inv: any;
    try {
      const [catMod, invMod] = await Promise.all([
        import('../store/CatalogService'),
        import('../store/InventoryManager'),
      ]);
      catalog = catMod.CatalogService.getInstance();
      inv = invMod.InventoryManager.getInstance();
    } catch { el.innerHTML = '<div style="text-align:center;color:#7a6e56;padding:20px;">Could not load store data.</div>'; return; }

    // Get items
    const tabDef = TABS.find(t => t.key === tab);
    let items: CatalogItem[];
    if (tab === 'featured' || !tabDef?.categories) {
      items = catalog.getAllItems();
    } else {
      items = tabDef.categories.flatMap((cat: ItemCategory) => catalog.getByCategory(cat));
    }

    // Sort: unowned first, then by rarity (legendary first), then name
    const rarityOrder: Record<string, number> = { legendary: 0, epic: 1, rare: 2, common: 3 };
    items.sort((a, b) => {
      const aOwned = inv.owns(a.id) ? 1 : 0;
      const bOwned = inv.owns(b.id) ? 1 : 0;
      if (aOwned !== bOwned) return aOwned - bOwned;
      const ra = rarityOrder[a.rarity] ?? 9;
      const rb = rarityOrder[b.rarity] ?? 9;
      if (ra !== rb) return ra - rb;
      return a.name.localeCompare(b.name);
    });

    el.innerHTML = `
      <div class="store-section-title">${tabDef?.label?.toUpperCase() || 'ALL ITEMS'} (${items.length})</div>
      <div class="store-grid">
        ${items.map(item => {
          const owned = inv.owns(item.id);
          const rc = RARITY_COLOR[item.rarity] || '#999';
          const bc = RARITY_BORDER[item.rarity] || 'rgba(150,150,150,0.5)';
          const glow = RARITY_GLOW[item.rarity] || 'none';
          const emoji = CAT_EMOJI[item.category] || '📦';
          return `
            <div class="store-card" data-item-id="${item.id}" style="border-left:3px solid ${bc};box-shadow:${glow};">
              <div class="store-card-emoji">${emoji}</div>
              <div class="store-card-name">${this.esc(item.name)}</div>
              <div class="store-card-rarity" style="color:${rc}">${item.rarity}</div>
              ${owned
                ? `<span class="store-owned">OWNED</span>`
                : `<div class="store-card-price">
                    <span style="color:#FFD93D">👑 ${item.priceCrowns}</span>
                    ${item.priceGlory ? `<span style="color:#7a6e56">/</span><span style="color:#C0C0D2">★ ${item.priceGlory}</span>` : ''}
                  </div>`
              }
            </div>
          `;
        }).join('')}
      </div>
    `;

    // Wire up click → purchase
    el.querySelectorAll('.store-card').forEach(card => {
      card.addEventListener('click', () => this.handleItemClick(card.getAttribute('data-item-id')!));
    });
  }

  private async renderGems() {
    const el = this.contentEl!;
    let catalog: any, wm: any;
    try {
      const [catMod, wmMod] = await Promise.all([import('../store/CatalogService'), import('../store/WalletManager')]);
      catalog = catMod.CatalogService.getInstance();
      wm = wmMod.WalletManager.getInstance();
    } catch { el.innerHTML = '<div style="text-align:center;color:#7a6e56;padding:20px;">Could not load gem data.</div>'; return; }

    const packages: CrownPackage[] = catalog.getCrownPackages();
    const isFirst = wm.isFirstPurchase;

    el.innerHTML = `
      <div class="store-section-title">CROWN PACKAGES</div>
      ${isFirst ? '<div style="text-align:center;font-size:13px;color:#45E6B0;font-weight:700;margin-bottom:12px;">🎁 First purchase gets +50% bonus crowns!</div>' : ''}
      <div class="store-grid">
        ${packages.map(pkg => `
          <div class="store-card" data-pkg-id="${pkg.id}" style="border-left:3px solid rgba(255,217,61,0.5);">
            <div style="font-size:28px;margin-bottom:6px;">👑</div>
            <div class="store-card-name">${this.esc(pkg.name)}</div>
            <div style="font-size:22px;font-weight:800;color:#FFD93D;font-family:'Fredoka',sans-serif;margin:6px 0;">${pkg.crowns.toLocaleString()}</div>
            ${pkg.bonusPercent ? `<div style="font-size:10px;color:#45E6B0;font-weight:700;margin-bottom:4px;">+${pkg.bonusPercent}% bonus</div>` : ''}
            <div style="font-size:16px;font-weight:700;color:#d4c8a0;margin-bottom:8px;">$${Math.round(pkg.priceUSD)}</div>
            <button style="width:100%;padding:8px;border-radius:8px;cursor:pointer;
              background:rgba(255,217,61,0.15);border:1.5px solid rgba(255,217,61,0.4);
              color:#FFD93D;font:bold 13px 'Fredoka',sans-serif;letter-spacing:1px;
              transition:all 0.15s;"
              onmouseenter="this.style.background='rgba(255,217,61,0.25)';this.style.borderColor='#FFD93D'"
              onmouseleave="this.style.background='rgba(255,217,61,0.15)';this.style.borderColor='rgba(255,217,61,0.4)'"
            >BUY</button>
          </div>
        `).join('')}
      </div>
    `;

    el.querySelectorAll('.store-card[data-pkg-id]').forEach(card => {
      card.querySelector('button')?.addEventListener('click', (e) => {
        e.stopPropagation();
        this.handleGemPurchase(card.getAttribute('data-pkg-id')!);
      });
    });
  }

  // ── Purchase Handlers ──────────────────────────────────────────

  private async handleItemClick(itemId: string) {
    const auth = AuthManager.getInstance();
    if (auth.isGuest) {
      const { showGuestLoginPrompt } = await import('../ui/LoginOverlay');
      showGuestLoginPrompt('purchase items');
      return;
    }

    let catalog: any, inv: any;
    try {
      catalog = (await import('../store/CatalogService')).CatalogService.getInstance();
      inv = (await import('../store/InventoryManager')).InventoryManager.getInstance();
    } catch { return; }

    const item = catalog.getItem(itemId);
    if (!item || inv.owns(itemId)) return;

    try {
      const { PaymentService } = await import('../store/PaymentService');
      const ps = PaymentService.getInstance();
      const currency: 'crowns' | 'glory' = (item.priceGlory != null && item.priceGlory > 0) ? 'glory' : 'crowns';
      const result = await ps.purchaseItem(itemId, currency);
      if (result.success) {
        this.renderTab(this.activeTab);
      } else {
        if (result.error?.includes('Not enough')) {
          const { showInsufficientFunds } = await import('../ui/InsufficientFundsModal');
          showInsufficientFunds(currency);
        } else {
          const { showToast } = await import('../ui/Toast');
          showToast(result.error || 'Purchase failed', 'error');
        }
      }
    } catch (err) {
      console.warn('[Store] Purchase failed:', err);
    }
  }

  private async handleGemPurchase(packageId: string) {
    const auth = AuthManager.getInstance();
    if (auth.isGuest) {
      const { showGuestLoginPrompt } = await import('../ui/LoginOverlay');
      showGuestLoginPrompt('purchase crowns');
      return;
    }

    try {
      const { PaymentService } = await import('../store/PaymentService');
      const ps = PaymentService.getInstance();
      const platform = ps.getPlatform();

      if (platform === 'test') {
        // Dev mode: grant crowns via admin endpoint
        const catalog = (await import('../store/CatalogService')).CatalogService.getInstance();
        const pkg = catalog.getCrownPackages().find((p: any) => p.id === packageId);
        if (pkg) {
          try { await (window as any).__devAddCrowns?.(pkg.crowns); } catch {}
          this.updateCurrency();
        }
      } else if (platform === 'itch') {
        const { ItchRedeemModal } = await import('../ui/ItchRedeemModal');
        new ItchRedeemModal().show({
          onSuccess: () => this.updateCurrency(),
          onCancel: () => {},
        });
      } else {
        const order = await ps.createOrder(packageId);
        const { PaymentModal } = await import('../ui/PaymentModal');
        await new PaymentModal().show({
          packageName: packageId,
          crowns: order.crowns ?? 0,
          amountUSD: order.amount ?? 0,
          orderId: order.orderId,
          onSuccess: async (sourceId: string) => {
            try { await ps.completePayment(order.orderId, sourceId, packageId); } catch {}
            this.updateCurrency();
          },
          onCancel: () => {},
          onError: (err: string) => console.warn('[Store] Payment error:', err),
        });
      }
    } catch (err) {
      console.warn('[Store] Gem purchase failed:', err);
    }
  }

  // ── Helpers ────────────────────────────────────────────────────

  private esc(s: string): string {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  private playsfx(key: string, volume = 0.5) {
    if (this.muted || !this.cache.audio.exists(key)) return;
    this.sound.play(key, { volume });
  }

  private createSmallButton(x: number, y: number, w: number, h: number, label: string, color: 'yellow' | 'green' | 'red') {
    const container = this.add.container(x, y).setDepth(12);
    const schemes = { green: { fill: 0x3a6a2e, border: 0x5a9a4e, text: '#e8e0c8' }, red: { fill: 0x8B3333, border: 0xBB4444, text: '#e8e0c8' }, yellow: { fill: 0x7a6a2a, border: 0xAA9944, text: '#e8e0c8' } };
    const s = schemes[color];
    const bg = this.add.graphics();
    bg.fillStyle(s.fill, 0.9); bg.fillRoundedRect(-w / 2, -h / 2, w, h, 6);
    bg.lineStyle(1.5, s.border, 0.8); bg.strokeRoundedRect(-w / 2, -h / 2, w, h, 6);
    container.add(bg);
    const text = this.add.text(0, 0, label, { fontSize: '12px', color: s.text, fontFamily: '"Fredoka", sans-serif', fontStyle: 'bold', stroke: '#000', strokeThickness: 2 }).setOrigin(0.5);
    container.add(text);
    const zone = this.add.zone(x, y, w, h).setInteractive({ useHandCursor: true }).setDepth(13);
    zone.on('pointerover', () => { this.tweens.add({ targets: container, scaleX: 1.06, scaleY: 1.06, duration: 100 }); text.setColor('#FFD93D'); });
    zone.on('pointerout', () => { this.tweens.add({ targets: container, scaleX: 1, scaleY: 1, duration: 100 }); text.setColor(s.text); });
    zone.on('pointerdown', () => { this.playsfx('button_click', 0.3); this.tweens.add({ targets: container, scaleX: 0.94, scaleY: 0.94, duration: 50, yoyo: true }); });
    return { container, zone };
  }

  private createFloatingIcons(width: number, height: number) {
    const iconKeys = ['ts_icon1', 'ts_icon2', 'ts_icon3', 'ts_icon4', 'ts_icon5', 'ts_icon6', 'ts_icon10'];
    const available = iconKeys.filter(k => this.textures.exists(k));
    if (available.length === 0) return;
    for (let i = 0; i < 8; i++) {
      const key = available[i % available.length];
      const img = this.add.image(Math.random() * width, Math.random() * height, key)
        .setScale(0.2 + Math.random() * 0.15).setAlpha(0.03 + Math.random() * 0.03).setDepth(1).setAngle(Math.random() * 360);
      this.tweens.add({ targets: img, alpha: { from: img.alpha, to: img.alpha * 0.3 }, scaleX: { from: img.scaleX, to: img.scaleX * 1.1 }, scaleY: { from: img.scaleY, to: img.scaleY * 1.1 }, duration: 3000 + Math.random() * 4000, yoyo: true, repeat: -1, ease: 'Sine.easeInOut', delay: Math.random() * 2000 });
      this.floatingShapes.push({ sprite: img, vx: (Math.random() - 0.5) * 0.15, vy: (Math.random() - 0.5) * 0.1, rot: (Math.random() - 0.5) * 0.08 });
    }
  }
}
