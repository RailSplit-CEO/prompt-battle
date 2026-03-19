// ─── CrateOpeningModal — Mash-to-open crate with reward reveal ──────────
// Full-screen glassmorphism overlay. Player mashes to fill a depleting bar.
// Once full, crate opens and rewards are revealed one by one.

import { C } from './UIColors';
import { PaymentService } from '../store/PaymentService';
import { CRATE_DEFS } from '@prompt-battle/shared';
import type { CrateTier, CatalogItem } from '@prompt-battle/shared';

// Rarity colours (matching CosmeticsHub/StorePanel)
const RARITY_BORDER: Record<string, string> = {
  common:    'rgba(150,150,150,0.5)',
  rare:      'rgba(68,136,255,0.6)',
  epic:      'rgba(170,68,255,0.6)',
  legendary: 'rgba(255,170,0,0.7)',
};
const RARITY_GLOW: Record<string, string> = {
  common:    'none',
  rare:      '0 0 12px rgba(68,136,255,0.25)',
  epic:      '0 0 16px rgba(170,68,255,0.3)',
  legendary: '0 0 20px rgba(255,170,0,0.4)',
};
const RARITY_LABEL: Record<string, string> = {
  common: 'COMMON', rare: 'RARE', epic: 'EPIC', legendary: 'LEGENDARY',
};

const TIER_COLOR: Record<CrateTier, string> = {
  bronze: '#CD7F32',
  silver: '#C0C0C0',
  gold:   '#FFD700',
};
const TIER_GLOW: Record<CrateTier, string> = {
  bronze: 'rgba(205,127,50,0.4)',
  silver: 'rgba(192,192,192,0.4)',
  gold:   'rgba(255,215,0,0.5)',
};

// Mash tuning
const DRAIN_RATE = 0.005;  // 0.5% per frame (~60fps = drains in ~12s)
const FILL_PER_CLICK = 0.22; // 22% per click → ~5 clicks to fill

let isOpen = false; // prevent multiple simultaneous modals

export class CrateOpeningModal {
  private overlay: HTMLDivElement | null = null;
  private animFrame = 0;
  private fill = 0;
  private phase: 'mash' | 'opening' | 'reveal' | 'done' = 'mash';
  private escHandler: ((e: KeyboardEvent) => void) | null = null;

  private crateResult: { items: CatalogItem[]; rewards: any[] } | null = null;

  async open(tier: CrateTier, currency: 'crowns' | 'glory'): Promise<void> {
    if (isOpen) return;
    isOpen = true;

    const def = CRATE_DEFS[tier];
    if (!def) { isOpen = false; return; }

    // Purchase the crate FIRST (deducts currency + generates rewards)
    try {
      const result = await PaymentService.getInstance().openCrate(tier, currency);
      this.crateResult = {
        items: result.items || [],
        rewards: result.rewards || [],
      };
    } catch (err: any) {
      isOpen = false;
      throw err; // Let the caller handle the error (e.g. insufficient funds)
    }

    this.fill = 0;
    this.phase = 'mash';

    // Inject keyframes
    this.injectStyles();

    // Disable Phaser keyboard
    const phaserKb = (window as any).__phaserKeyboard;
    if (phaserKb) phaserKb.enabled = false;

    // ── Overlay ──
    const overlay = document.createElement('div');
    this.overlay = overlay;
    overlay.style.cssText = `
      position:fixed;inset:0;z-index:10010;
      background:${C.overlay};
      backdrop-filter:${C.panelBlur};-webkit-backdrop-filter:${C.panelBlur};
      display:flex;align-items:center;justify-content:center;flex-direction:column;
      font-family:'Nunito',sans-serif;
      opacity:0;transition:opacity 0.3s ease;
      cursor:pointer;user-select:none;
    `;
    // Block all background interaction
    overlay.addEventListener('mousedown', (e) => e.stopPropagation());
    overlay.addEventListener('mouseup', (e) => e.stopPropagation());
    overlay.addEventListener('click', (e) => e.stopPropagation());
    overlay.addEventListener('contextmenu', (e) => e.preventDefault());

    // ── Panel ──
    const panel = document.createElement('div');
    panel.style.cssText = `
      background:${C.panelBg};
      border:2px solid ${C.panelBorder};border-radius:20px;
      padding:32px 40px;box-shadow:${C.panelShadow};
      display:flex;flex-direction:column;align-items:center;gap:20px;
      min-width:320px;max-width:420px;
      animation:crate-panel-in 0.4s cubic-bezier(0.16,1,0.3,1) forwards;
      pointer-events:auto;
    `;
    overlay.appendChild(panel);

    // ── Crate icon ──
    const crateIcon = document.createElement('div');
    crateIcon.id = 'crate-icon';
    const tierColor = TIER_COLOR[tier];
    crateIcon.style.cssText = `
      font-size:80px;line-height:1;
      filter:drop-shadow(0 0 20px ${TIER_GLOW[tier]});
      transition:transform 0.05s;
    `;
    crateIcon.textContent = def.icon;
    panel.appendChild(crateIcon);

    // ── Title ──
    const title = document.createElement('div');
    title.style.cssText = `
      font-family:'Fredoka',sans-serif;font-size:22px;font-weight:700;
      color:${tierColor};letter-spacing:1px;
    `;
    title.textContent = def.name;
    panel.appendChild(title);

    // ── "Mash to open!" text ──
    const mashText = document.createElement('div');
    mashText.id = 'crate-mash-text';
    mashText.style.cssText = `
      font-size:14px;font-weight:700;color:${C.textSecondary};
      letter-spacing:0.5px;animation:crate-pulse 1s infinite;
    `;
    mashText.textContent = 'TAP TO OPEN!';
    panel.appendChild(mashText);

    // ── Progress bar ──
    const barWrap = document.createElement('div');
    barWrap.id = 'crate-bar-wrap';
    barWrap.style.cssText = `
      width:100%;height:16px;border-radius:8px;
      background:rgba(0,0,0,0.4);border:1px solid ${C.divider};
      overflow:hidden;position:relative;
    `;
    const barFill = document.createElement('div');
    barFill.id = 'crate-bar-fill';
    barFill.style.cssText = `
      height:100%;width:0%;border-radius:8px;
      background:linear-gradient(90deg, #ff4444, #ffaa00);
      transition:background 0.1s;
      box-shadow:0 0 8px rgba(255,170,0,0.3);
    `;
    barWrap.appendChild(barFill);
    panel.appendChild(barWrap);

    // ── Reward container (hidden initially) ──
    const rewardContainer = document.createElement('div');
    rewardContainer.id = 'crate-rewards';
    rewardContainer.style.cssText = `
      display:none;flex-direction:column;align-items:center;gap:12px;width:100%;
    `;
    panel.appendChild(rewardContainer);

    // ── Collect button (hidden initially) ──
    const collectBtn = document.createElement('button');
    collectBtn.id = 'crate-collect-btn';
    collectBtn.textContent = 'Collect';
    collectBtn.style.cssText = `
      display:none;
      padding:12px 40px;border-radius:12px;font-size:15px;font-weight:700;
      font-family:'Fredoka',sans-serif;cursor:pointer;transition:all 0.15s;
      background:${C.gold};border:none;color:${C.textDark};
      box-shadow:0 2px 12px rgba(255,217,61,0.3);
    `;
    collectBtn.onmouseenter = () => { collectBtn.style.background = C.goldDark; };
    collectBtn.onmouseleave = () => { collectBtn.style.background = C.gold; };
    collectBtn.onclick = () => this.close();
    panel.appendChild(collectBtn);

    // Mount
    document.body.appendChild(overlay);
    requestAnimationFrame(() => { overlay.style.opacity = '1'; });

    // ── ESC handler ──
    this.escHandler = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && this.phase === 'mash') {
        this.close();
      }
    };
    window.addEventListener('keydown', this.escHandler);

    // ── Mash click handler ──
    const onMash = () => {
      if (this.phase !== 'mash') return;
      this.fill = Math.min(1, this.fill + FILL_PER_CLICK);
      // Shake crate
      const intensity = Math.round(this.fill * 8);
      const rx = (Math.random() - 0.5) * intensity * 2;
      const ry = (Math.random() - 0.5) * intensity * 2;
      crateIcon.style.transform = `translate(${rx}px, ${ry}px) scale(${1 + this.fill * 0.1})`;
      setTimeout(() => { crateIcon.style.transform = `scale(${1 + this.fill * 0.1})`; }, 50);
    };
    overlay.addEventListener('mousedown', onMash);
    overlay.addEventListener('touchstart', onMash, { passive: true });

    // Helper to trigger opening — called from loop or click handler
    const triggerOpen = () => {
      this.phase = 'opening';
      overlay.removeEventListener('mousedown', onMash);
      overlay.removeEventListener('touchstart', onMash);
      overlay.style.cursor = 'default';
      barFill.style.width = '100%';
      barFill.style.background = `linear-gradient(90deg, #44cc44, #66ff66)`;
      barFill.style.boxShadow = '0 0 16px rgba(100,255,100,0.5)';
      this.triggerOpening(tier, currency, crateIcon, mashText, barWrap, rewardContainer, collectBtn);
    };

    // ── Animation loop — drain bar ──
    const loop = () => {
      if (!this.overlay) return;

      if (this.phase === 'mash') {
        // Check if filled BEFORE draining
        if (this.fill >= 1) {
          triggerOpen();
          return;
        }

        this.fill = Math.max(0, this.fill - DRAIN_RATE);
        const pct = Math.round(this.fill * 100);
        barFill.style.width = pct + '%';

        // Color transition: red → yellow → green
        if (this.fill < 0.4) {
          barFill.style.background = `linear-gradient(90deg, #ff4444, #ff6644)`;
        } else if (this.fill < 0.7) {
          barFill.style.background = `linear-gradient(90deg, #ff8800, #ffcc00)`;
        } else {
          barFill.style.background = `linear-gradient(90deg, #44cc44, #66ff66)`;
          barFill.style.boxShadow = '0 0 16px rgba(100,255,100,0.5)';
        }
      }

      this.animFrame = requestAnimationFrame(loop);
    };
    this.animFrame = requestAnimationFrame(loop);
  }

  private async triggerOpening(
    tier: CrateTier,
    currency: 'crowns' | 'glory',
    crateIcon: HTMLDivElement,
    mashText: HTMLDivElement,
    barWrap: HTMLDivElement,
    rewardContainer: HTMLDivElement,
    collectBtn: HTMLButtonElement,
  ) {
    // Opening burst animation
    mashText.textContent = 'OPENING...';
    mashText.style.color = TIER_COLOR[tier];
    mashText.style.animation = 'none';
    crateIcon.style.transition = 'transform 0.4s cubic-bezier(0.16,1,0.3,1)';
    crateIcon.style.transform = 'scale(1.5)';
    barWrap.style.transition = 'opacity 0.3s';
    barWrap.style.opacity = '0';

    // Flash effect
    const flash = document.createElement('div');
    flash.style.cssText = `
      position:fixed;inset:0;z-index:10011;
      background:radial-gradient(circle, ${TIER_GLOW[tier]} 0%, transparent 70%);
      opacity:0;transition:opacity 0.15s;pointer-events:none;
    `;
    document.body.appendChild(flash);
    requestAnimationFrame(() => { flash.style.opacity = '1'; });
    setTimeout(() => { flash.style.opacity = '0'; setTimeout(() => flash.remove(), 200); }, 300);

    // Use pre-fetched result (purchased before mash animation started)
    const items = this.crateResult?.items || [];
    const rewards = this.crateResult?.rewards || [];

    // Hide crate icon
    crateIcon.style.transition = 'transform 0.3s, opacity 0.3s';
    crateIcon.style.transform = 'scale(2)';
    crateIcon.style.opacity = '0';
    mashText.style.display = 'none';
    barWrap.style.display = 'none';

    await this.delay(400);

    crateIcon.style.display = 'none';

    // Reveal rewards
    this.phase = 'reveal';
    rewardContainer.style.display = 'flex';

    // Build reward cards
    const fallbackCrowns = rewards.filter((r: any) => r.type === 'currency').reduce((s: number, r: any) => s + (r.amount || 0), 0);

    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      await this.delay(400);
      const card = this.buildRewardCard(item);
      rewardContainer.appendChild(card);
    }

    if (fallbackCrowns > 0) {
      await this.delay(400);
      const crownsCard = this.buildCrownsCard(fallbackCrowns);
      rewardContainer.appendChild(crownsCard);
    }

    if (items.length === 0 && fallbackCrowns === 0) {
      // Edge case: empty rewards (shouldn't happen but handle gracefully)
      const empty = document.createElement('div');
      empty.textContent = 'No rewards available';
      empty.style.cssText = `font-size:14px;color:${C.textMuted};padding:20px;`;
      rewardContainer.appendChild(empty);
    }

    await this.delay(300);
    collectBtn.style.display = 'block';
    collectBtn.style.animation = 'crate-panel-in 0.3s ease forwards';
    this.phase = 'done';
  }

  private buildRewardCard(item: CatalogItem): HTMLDivElement {
    const rarity = item.rarity || 'common';
    const card = document.createElement('div');
    card.style.cssText = `
      width:100%;padding:14px 18px;
      background:${C.surface};
      border:2px solid ${RARITY_BORDER[rarity] || RARITY_BORDER.common};
      border-radius:12px;
      box-shadow:${RARITY_GLOW[rarity] || 'none'};
      display:flex;align-items:center;gap:14px;
      animation:crate-item-reveal 0.5s cubic-bezier(0.16,1,0.3,1) forwards;
      opacity:0;transform:scale(0.8) translateY(10px);
    `;

    // Item info
    const info = document.createElement('div');
    info.style.cssText = 'flex:1;min-width:0;';

    const name = document.createElement('div');
    name.textContent = item.name;
    name.style.cssText = `font-size:15px;font-weight:700;color:${C.textH1};overflow:hidden;text-overflow:ellipsis;white-space:nowrap;`;
    info.appendChild(name);

    const desc = document.createElement('div');
    desc.textContent = item.description || '';
    desc.style.cssText = `font-size:11px;color:${C.textMuted};margin-top:2px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;`;
    info.appendChild(desc);

    card.appendChild(info);

    // Rarity badge
    const badge = document.createElement('span');
    badge.textContent = RARITY_LABEL[rarity] || 'COMMON';
    const badgeColor = RARITY_BORDER[rarity] || RARITY_BORDER.common;
    badge.style.cssText = `
      font-size:9px;font-weight:800;letter-spacing:1.5px;
      padding:3px 10px;border-radius:8px;
      background:${badgeColor.replace(/[\d.]+\)$/, '0.15)')};
      color:${badgeColor.replace(/[\d.]+\)$/, '1)')};
      flex-shrink:0;
    `;
    card.appendChild(badge);

    return card;
  }

  private buildCrownsCard(amount: number): HTMLDivElement {
    const card = document.createElement('div');
    card.style.cssText = `
      width:100%;padding:14px 18px;
      background:rgba(255,217,61,0.08);
      border:2px solid rgba(255,217,61,0.4);
      border-radius:12px;
      box-shadow:0 0 16px rgba(255,217,61,0.2);
      display:flex;align-items:center;gap:14px;
      animation:crate-item-reveal 0.5s cubic-bezier(0.16,1,0.3,1) forwards;
      opacity:0;transform:scale(0.8) translateY(10px);
    `;

    const icon = document.createElement('span');
    icon.textContent = '\uD83D\uDC51';
    icon.style.cssText = 'font-size:28px;';
    card.appendChild(icon);

    const text = document.createElement('div');
    text.style.cssText = `font-size:18px;font-weight:700;color:${C.gold};font-family:'Fredoka',sans-serif;`;
    text.textContent = `${amount} Crowns`;
    card.appendChild(text);

    return card;
  }

  private close() {
    cancelAnimationFrame(this.animFrame);
    if (this.escHandler) {
      window.removeEventListener('keydown', this.escHandler);
      this.escHandler = null;
    }
    if (this.overlay) {
      this.overlay.style.opacity = '0';
      const ov = this.overlay;
      setTimeout(() => ov.remove(), 300);
      this.overlay = null;
    }
    // Re-enable Phaser keyboard
    const phaserKb = (window as any).__phaserKeyboard;
    if (phaserKb) phaserKb.enabled = true;
    isOpen = false;
    this.phase = 'done';
  }

  private delay(ms: number): Promise<void> {
    return new Promise(r => setTimeout(r, ms));
  }

  private injectStyles() {
    if (document.getElementById('crate-modal-styles')) return;
    const style = document.createElement('style');
    style.id = 'crate-modal-styles';
    style.textContent = `
      @keyframes crate-panel-in {
        from { opacity:0; transform:scale(0.9) translateY(20px); }
        to   { opacity:1; transform:scale(1)   translateY(0); }
      }
      @keyframes crate-pulse {
        0%, 100% { opacity:0.7; transform:scale(1); }
        50%      { opacity:1;   transform:scale(1.05); }
      }
      @keyframes crate-item-reveal {
        from { opacity:0; transform:scale(0.7) translateY(15px); }
        to   { opacity:1; transform:scale(1)   translateY(0); }
      }
    `;
    document.head.appendChild(style);
  }
}
