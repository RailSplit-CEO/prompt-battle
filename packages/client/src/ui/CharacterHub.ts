// ─── CharacterHub — Full-screen character browsing & customization panel ─────
// Two-view layout: grid (all 11 units) and detail (single unit with tabs).
// Dark glassmorphism UI matching existing panels.

import { C } from './UIColors';
import { CurrencyDisplay } from './CurrencyDisplay';
import { XpBar } from './XpBar';
import { SpritePreview } from './SpritePreview';
import { CatalogService } from '../store/CatalogService';
import { InventoryManager } from '../store/InventoryManager';
import { EquipService } from '../store/EquipService';
import { PaymentService } from '../store/PaymentService';
import { showPurchaseConfirm } from './PurchaseConfirmModal';
import { AuthManager } from '../auth/AuthManager';
import { showGuestLoginPrompt } from './LoginOverlay';
import { HORDE_SPRITE_CONFIGS } from '../sprites/SpriteConfig';
import type { HordeUnitType, CatalogItem } from '@prompt-battle/shared';

// ─── Unit data (hardcoded to avoid circular import from HordeScene) ─────────

interface UnitInfo {
  type: HordeUnitType;
  emoji: string;
  name: string;
  tier: number;
  hp: number;
  attack: number;
  speed: number;
  ability: string;
  desc: string;
  ability2: string;
  desc2: string;
}

const UNIT_ORDER: UnitInfo[] = [
  { type: 'gnome', emoji: '\uD83E\uDDDD', name: 'Gnome', tier: 1, hp: 20, attack: 4, speed: 210, ability: 'Nimble Hands', desc: '2x pickup range, fastest gatherer', ability2: 'Plucky', desc2: 'Survives 1 lethal hit' },
  { type: 'snake', emoji: '\uD83D\uDC0D', name: 'Snake', tier: 1, hp: 30, attack: 6, speed: 190, ability: 'Venom Spit', desc: 'Ranged attack (110 range), +3% max HP poison', ability2: 'Shed Skin', desc2: 'Drops aggro once when hit below 30% HP' },
  { type: 'turtle', emoji: '\uD83D\uDC22', name: 'Turtle', tier: 1, hp: 80, attack: 5, speed: 55, ability: 'Shell Stance', desc: '60% DR when stationary + taunt', ability2: 'Iron Shell', desc2: '10x carry, nearby allies -15% dmg' },
  { type: 'skull', emoji: '\uD83D\uDC80', name: 'Skull', tier: 2, hp: 90, attack: 16, speed: 155, ability: 'Undying', desc: 'Survives at 1 HP once', ability2: 'Dread Aura', desc2: 'Enemies nearby -15% attack speed' },
  { type: 'spider', emoji: '\uD83D\uDD77\uFE0F', name: 'Spider', tier: 2, hp: 110, attack: 20, speed: 140, ability: 'Venom Bite', desc: '+5% target max HP per hit', ability2: 'Web Trap', desc2: 'First attack slows 40% for 3s' },
  { type: 'hyena', emoji: '\uD83D\uDC3A', name: 'Hyena', tier: 2, hp: 65, attack: 24, speed: 175, ability: 'Bone Toss', desc: 'Extended range (120 vs 80)', ability2: 'Pack Frenzy', desc2: '+10% atk per nearby hyena' },
  { type: 'rogue', emoji: '\uD83D\uDDE1\uFE0F', name: 'Rogue', tier: 2, hp: 70, attack: 40, speed: 200, ability: 'Backstab', desc: '3x first hit + invisible to neutrals', ability2: 'Shadow Step', desc2: 'Sneak past defenders' },
  { type: 'panda', emoji: '\uD83D\uDC3C', name: 'Panda', tier: 3, hp: 280, attack: 32, speed: 80, ability: 'Thick Hide', desc: 'Regen 1.5% max HP/sec', ability2: 'Bamboo Wall', desc2: 'Blocks projectiles for backline' },
  { type: 'lizard', emoji: '\uD83E\uDD8E', name: 'Lizard', tier: 3, hp: 200, attack: 55, speed: 110, ability: 'Cold Blood', desc: '3x dmg to targets <40% HP', ability2: 'Tail Whip', desc2: 'Hits enemies in 50px arc' },
  { type: 'bear', emoji: '\uD83D\uDC3B', name: 'Bear', tier: 3, hp: 320, attack: 45, speed: 90, ability: 'Rage', desc: '+2% atk per 1% missing HP', ability2: 'Maul', desc2: 'Attacks stun for 0.5s' },
  { type: 'harpoon_fish', emoji: '\uD83D\uDC21', name: 'Harpoon Fish', tier: 3, hp: 150, attack: 65, speed: 70, ability: 'Harpoon', desc: 'Longest range (160), pierces first target', ability2: 'Anchor Shot', desc2: 'Slows target 50% for 2s' },
  { type: 'minotaur', emoji: '\uD83D\uDC02', name: 'Minotaur', tier: 4, hp: 550, attack: 85, speed: 105, ability: 'War Cry', desc: 'Nearby allies +25% attack', ability2: 'Bull Rush', desc2: 'Charges for 2x impact' },
  { type: 'shaman', emoji: '\uD83D\uDD2E', name: 'Shaman', tier: 4, hp: 350, attack: 120, speed: 95, ability: 'Arcane Blast', desc: 'All attacks splash 60px', ability2: 'Hex Ward', desc2: 'Allies -20% splash dmg taken' },
  { type: 'troll', emoji: '\uD83D\uDC79', name: 'Troll', tier: 5, hp: 1200, attack: 200, speed: 50, ability: 'Club Slam', desc: '90px splash + slow', ability2: 'Regeneration', desc2: '0.5% HP/s, doubles <30% HP' },
];

const TIER_COLORS: Record<number, string> = {
  1: '#2E8B2E',
  2: '#2266BB',
  3: '#CC6A00',
  4: '#BB2222',
  5: '#B8860B',
};

const RARITY_BORDER: Record<string, string> = {
  common: 'rgba(150,150,150,0.5)',
  rare: 'rgba(68,136,255,0.6)',
  epic: 'rgba(170,68,255,0.6)',
  legendary: 'rgba(255,217,61,0.6)',
};

// ─── Shared style helpers ───────────────────────────────────────────────────

const TRANSITION_EASE = 'transform 0.3s cubic-bezier(0.16,1,0.3,1)';

function makeBtn(text: string, primary = false): HTMLButtonElement {
  const btn = document.createElement('button');
  btn.textContent = text;
  btn.style.cssText = primary
    ? `padding:8px 18px;border-radius:10px;font:bold 13px 'Fredoka',sans-serif;
       cursor:pointer;transition:all 0.15s;background:${C.gold};border:none;
       color:${C.textDark};box-shadow:0 2px 8px rgba(255,217,61,0.25);`
    : `padding:8px 18px;border-radius:10px;font:bold 13px 'Nunito',sans-serif;
       cursor:pointer;transition:all 0.15s;background:${C.inputBg};
       border:1px solid ${C.inputBorder};color:${C.textSecondary};`;
  btn.onmouseenter = () => {
    if (primary) {
      btn.style.background = C.goldDark;
    } else {
      btn.style.borderColor = C.inputBorderHi;
      btn.style.color = C.textPrimary;
      btn.style.background = C.surfaceHover;
    }
  };
  btn.onmouseleave = () => {
    if (primary) {
      btn.style.background = C.gold;
    } else {
      btn.style.borderColor = C.inputBorder;
      btn.style.color = C.textSecondary;
      btn.style.background = C.inputBg;
    }
  };
  return btn;
}

// ─── CharacterHub class ─────────────────────────────────────────────────────

export class CharacterHub {
  private root: HTMLDivElement | null = null;
  private currentView: 'grid' | 'detail' = 'grid';
  private selectedUnit: HordeUnitType | null = null;
  private _previewAudio: HTMLAudioElement | null = null;
  private selectedTab: 'skins' | 'voice' | 'effects' = 'skins';
  private spritePreview: SpritePreview | null = null;
  private xpBar: XpBar | null = null;
  private currencyDisplay: CurrencyDisplay | null = null;
  private onCloseCallback: (() => void) | null = null;
  private escHandler: ((e: KeyboardEvent) => void) | null = null;

  // Viewport containers for slide transitions
  private viewport: HTMLDivElement | null = null;
  private gridSlide: HTMLDivElement | null = null;
  private detailSlide: HTMLDivElement | null = null;

  // Skin preview state
  private previewedSkinId: string = 'default';
  private skinCards: Map<string, HTMLElement> = new Map();
  private currentAnimState: 'idle' | 'walk' | 'attack' = 'idle';

  // Subscriptions to clean up
  private unsubInventory: (() => void) | null = null;
  private unsubEquipped: (() => void) | null = null;

  get isOpen(): boolean {
    return this.root !== null;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // OPEN / CLOSE
  // ═══════════════════════════════════════════════════════════════════════════

  open(onClose?: () => void): void {
    if (this.root) return;
    this.onCloseCallback = onClose ?? null;
    this.build();

    // ESC to close
    this.escHandler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (this.currentView === 'detail') {
          this.showGrid();
        } else {
          this.close();
        }
      }
    };
    window.addEventListener('keydown', this.escHandler);
  }

  close(): void {
    if (!this.root) return;

    // Tear down subscriptions
    this.unsubInventory?.();
    this.unsubInventory = null;
    this.unsubEquipped?.();
    this.unsubEquipped = null;

    // Tear down sub-components
    this.spritePreview?.destroy();
    this.spritePreview = null;
    this.xpBar?.destroy();
    this.xpBar = null;
    this.currencyDisplay?.destroy();
    this.currencyDisplay = null;

    // ESC handler
    if (this.escHandler) {
      window.removeEventListener('keydown', this.escHandler);
      this.escHandler = null;
    }

    // Animate out
    const r = this.root;
    r.style.opacity = '0';
    const panel = r.querySelector('[data-hub-panel]') as HTMLElement | null;
    if (panel) panel.style.transform = 'scale(0.95)';
    setTimeout(() => r.remove(), 200);
    this.root = null;
    this.viewport = null;
    this.gridSlide = null;
    this.detailSlide = null;

    this.onCloseCallback?.();
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // BUILD ROOT
  // ═══════════════════════════════════════════════════════════════════════════

  private build(): void {
    // ── Overlay ──
    this.root = document.createElement('div');
    this.root.style.cssText = `
      position:fixed;inset:0;z-index:10000;
      background:${C.overlay};backdrop-filter:${C.panelBlur};-webkit-backdrop-filter:${C.panelBlur};
      display:flex;align-items:center;justify-content:center;
      opacity:0;transition:opacity 0.2s ease;
    `;
    this.root.addEventListener('mousedown', (e) => {
      if (e.target === this.root) {
        if (this.currentView === 'detail') this.showGrid();
        else this.close();
      }
    });

    // ── Panel ──
    const panel = document.createElement('div');
    panel.setAttribute('data-hub-panel', '');
    panel.style.cssText = `
      width:min(960px,95vw);height:min(680px,90vh);
      background:${C.panelBg};
      border:2px solid ${C.panelBorder};border-radius:18px;
      box-shadow:${C.panelShadow};
      display:flex;flex-direction:column;overflow:hidden;
      transform:scale(0.92);transition:transform 0.25s cubic-bezier(0.16,1,0.3,1);
      font-family:'Nunito',sans-serif;
    `;
    this.root.appendChild(panel);

    // ── Slide viewport (clips both views and slides them left/right) ──
    this.viewport = document.createElement('div');
    this.viewport.style.cssText = `
      flex:1;position:relative;overflow:hidden;
    `;
    panel.appendChild(this.viewport);

    // Grid slide
    this.gridSlide = document.createElement('div');
    this.gridSlide.style.cssText = `
      position:absolute;inset:0;transition:${TRANSITION_EASE};
      display:flex;flex-direction:column;
    `;
    this.viewport.appendChild(this.gridSlide);

    // Detail slide (starts offscreen right)
    this.detailSlide = document.createElement('div');
    this.detailSlide.style.cssText = `
      position:absolute;inset:0;transition:${TRANSITION_EASE};
      transform:translateX(100%);display:flex;flex-direction:column;
    `;
    this.viewport.appendChild(this.detailSlide);

    // Populate the grid view
    this.buildGridView(this.gridSlide);

    // Mount
    document.body.appendChild(this.root);
    requestAnimationFrame(() => {
      if (this.root) this.root.style.opacity = '1';
      panel.style.transform = 'scale(1)';
    });
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // GRID VIEW
  // ═══════════════════════════════════════════════════════════════════════════

  private buildGridView(container: HTMLElement): void {
    container.innerHTML = '';

    // ── Header row ──
    const header = document.createElement('div');
    header.style.cssText = `
      display:flex;align-items:center;gap:12px;
      padding:16px 20px 12px;border-bottom:1px solid ${C.divider};
      flex-shrink:0;
    `;

    // Title
    const title = document.createElement('h2');
    title.textContent = 'CHARACTERS';
    title.style.cssText = `
      margin:0;font:bold 20px 'Fredoka',sans-serif;color:${C.gold};
      letter-spacing:3px;flex:1;
    `;
    header.appendChild(title);

    // Currency
    this.currencyDisplay = new CurrencyDisplay();
    header.appendChild(this.currencyDisplay.getElement());

    // Close [X]
    const closeBtn = document.createElement('button');
    closeBtn.textContent = '\u2715';
    closeBtn.style.cssText = `
      width:34px;height:34px;border-radius:50%;background:${C.surface};
      border:1px solid ${C.divider};color:${C.textSecondary};
      font-size:16px;cursor:pointer;display:flex;align-items:center;
      justify-content:center;transition:all 0.15s;flex-shrink:0;
    `;
    closeBtn.onmouseenter = () => {
      closeBtn.style.background = C.surfaceHover;
      closeBtn.style.borderColor = C.inputBorderHi;
      closeBtn.style.color = C.textPrimary;
    };
    closeBtn.onmouseleave = () => {
      closeBtn.style.background = C.surface;
      closeBtn.style.borderColor = C.divider;
      closeBtn.style.color = C.textSecondary;
    };
    closeBtn.onclick = () => this.close();
    header.appendChild(closeBtn);

    container.appendChild(header);

    // ── Scrollable grid ──
    const scroll = document.createElement('div');
    scroll.style.cssText = `
      flex:1;overflow-y:auto;padding:16px 20px 20px;
      display:grid;grid-template-columns:repeat(auto-fill,minmax(160px,1fr));
      gap:16px;align-content:start;
    `;

    for (const unit of UNIT_ORDER) {
      scroll.appendChild(this.buildUnitCard(unit));
    }

    container.appendChild(scroll);
  }

  private buildUnitCard(unit: UnitInfo): HTMLElement {
    const card = document.createElement('div');
    const tierColor = TIER_COLORS[unit.tier] || TIER_COLORS[1];
    card.style.cssText = `
      display:flex;flex-direction:column;align-items:center;
      padding:16px 12px 14px;border-radius:14px;
      background:${C.surface};border:1px solid ${C.divider};
      cursor:pointer;transition:all 0.2s ease;
      position:relative;
    `;
    card.onmouseenter = () => {
      card.style.transform = 'translateY(-4px)';
      card.style.boxShadow = `0 8px 24px rgba(0,0,0,0.35), 0 0 0 1px ${tierColor}40`;
      card.style.borderColor = tierColor;
      card.style.background = C.surfaceHover;
    };
    card.onmouseleave = () => {
      card.style.transform = 'translateY(0)';
      card.style.boxShadow = 'none';
      card.style.borderColor = C.divider;
      card.style.background = C.surface;
    };
    card.onclick = () => this.showDetail(unit.type);

    // Avatar image
    const avatar = document.createElement('img');
    avatar.src = `assets/enemies/avatars/${unit.type}.png`;
    avatar.alt = unit.name;
    avatar.style.cssText = `
      width:120px;height:120px;image-rendering:pixelated;
      border-radius:12px;background:rgba(0,0,0,0.2);
      object-fit:contain;
    `;
    avatar.onerror = () => {
      // Fallback: show emoji
      avatar.style.display = 'none';
      const fallback = document.createElement('div');
      fallback.textContent = unit.emoji;
      fallback.style.cssText = 'font-size:56px;width:120px;height:120px;display:flex;align-items:center;justify-content:center;';
      card.insertBefore(fallback, card.firstChild);
    };
    card.appendChild(avatar);

    // Name
    const name = document.createElement('span');
    name.textContent = unit.name;
    name.style.cssText = `
      font:bold 15px 'Fredoka',sans-serif;color:${C.textH1};
      margin-top:8px;text-align:center;
    `;
    card.appendChild(name);

    // Tier badge
    const badge = document.createElement('span');
    badge.textContent = `T${unit.tier}`;
    badge.style.cssText = `
      position:absolute;top:6px;right:6px;
      font:bold 10px 'Fredoka',sans-serif;color:#fff;
      background:${tierColor};padding:1px 6px;border-radius:8px;
      letter-spacing:0.5px;
    `;
    card.appendChild(badge);

    return card;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // DETAIL VIEW
  // ═══════════════════════════════════════════════════════════════════════════

  private showDetail(unitType: HordeUnitType): void {
    const unit = UNIT_ORDER.find((u) => u.type === unitType);
    if (!unit || !this.detailSlide || !this.gridSlide) return;

    this.currentView = 'detail';
    this.selectedUnit = unitType;
    this.selectedTab = 'skins';

    // Populate detail slide
    this.buildDetailView(unit, this.detailSlide);

    // Slide grid left, detail in from right
    this.gridSlide.style.transform = 'translateX(-100%)';
    this.detailSlide.style.transform = 'translateX(0)';
  }

  private showGrid(): void {
    if (!this.gridSlide || !this.detailSlide) return;
    this.currentView = 'grid';

    // Clean up sprite preview and skin state from detail
    this.spritePreview?.destroy();
    this.spritePreview = null;
    this.skinCards.clear();

    // Clean up subscriptions
    this.unsubInventory?.();
    this.unsubInventory = null;
    this.unsubEquipped?.();
    this.unsubEquipped = null;

    // Slide back
    this.gridSlide.style.transform = 'translateX(0)';
    this.detailSlide.style.transform = 'translateX(100%)';
  }

  private buildDetailView(unit: UnitInfo, container: HTMLElement): void {
    container.innerHTML = '';

    // Clean up old preview
    this.spritePreview?.destroy();
    this.spritePreview = null;

    // ── Detail header ──
    const header = document.createElement('div');
    header.style.cssText = `
      display:flex;align-items:center;gap:12px;
      padding:14px 20px 10px;border-bottom:1px solid ${C.divider};
      flex-shrink:0;
    `;

    // Back button
    const backBtn = makeBtn('\u25C0 Back');
    backBtn.onclick = () => this.showGrid();
    header.appendChild(backBtn);

    // Unit name + emoji
    const tierColor = TIER_COLORS[unit.tier] || TIER_COLORS[1];
    const nameEl = document.createElement('h2');
    nameEl.innerHTML = `${unit.emoji} ${unit.name} <span style="font-size:12px;color:${tierColor};vertical-align:middle;background:${tierColor}22;padding:2px 8px;border-radius:8px;margin-left:6px;">Tier ${unit.tier}</span>`;
    nameEl.style.cssText = `
      margin:0;font:bold 18px 'Fredoka',sans-serif;color:${C.textH1};flex:1;
    `;
    header.appendChild(nameEl);

    // Close [X]
    const closeBtn = document.createElement('button');
    closeBtn.textContent = '\u2715';
    closeBtn.style.cssText = `
      width:34px;height:34px;border-radius:50%;background:${C.surface};
      border:1px solid ${C.divider};color:${C.textSecondary};
      font-size:16px;cursor:pointer;display:flex;align-items:center;
      justify-content:center;transition:all 0.15s;flex-shrink:0;
    `;
    closeBtn.onmouseenter = () => {
      closeBtn.style.background = C.surfaceHover;
      closeBtn.style.color = C.textPrimary;
    };
    closeBtn.onmouseleave = () => {
      closeBtn.style.background = C.surface;
      closeBtn.style.color = C.textSecondary;
    };
    closeBtn.onclick = () => this.close();
    header.appendChild(closeBtn);

    container.appendChild(header);

    // ── Two-column body ──
    const body = document.createElement('div');
    body.style.cssText = `
      flex:1;display:flex;overflow:hidden;min-height:0;
    `;

    // ── Left column (40%) ──
    const left = document.createElement('div');
    left.style.cssText = `
      width:40%;flex-shrink:0;display:flex;flex-direction:column;
      padding:16px;gap:12px;overflow-y:auto;border-right:1px solid ${C.divider};
    `;

    // Sprite preview
    this.spritePreview = new SpritePreview(280, 280);
    const equippedSkin = InventoryManager.getInstance().getEquippedSkin(unit.type);
    this.spritePreview.loadUnit(unit.type, 'idle', equippedSkin || undefined);
    this.previewedSkinId = equippedSkin || 'default';
    this.currentAnimState = 'idle';
    const canvasWrap = document.createElement('div');
    canvasWrap.style.cssText = 'display:flex;justify-content:center;';
    canvasWrap.appendChild(this.spritePreview.getElement());
    left.appendChild(canvasWrap);

    // Anim state buttons
    const stateRow = document.createElement('div');
    stateRow.style.cssText = 'display:flex;gap:8px;justify-content:center;';
    const states: Array<'idle' | 'walk' | 'attack'> = ['idle', 'walk', 'attack'];
    const stateButtons: HTMLButtonElement[] = [];

    for (const st of states) {
      const btn = document.createElement('button');
      btn.textContent = st.charAt(0).toUpperCase() + st.slice(1);
      const isActive = st === 'idle';
      btn.style.cssText = `
        padding:5px 14px;border-radius:16px;font:bold 11px 'Nunito',sans-serif;
        cursor:pointer;transition:all 0.15s;border:1px solid ${isActive ? C.tabBorder : C.divider};
        background:${isActive ? C.tabActive : C.tabBg};color:${isActive ? C.gold : C.textSecondary};
      `;
      btn.onclick = () => {
        this.currentAnimState = st;
        this.spritePreview?.setState(st);
        for (const b of stateButtons) {
          const active = b === btn;
          b.style.borderColor = active ? C.tabBorder : C.divider;
          b.style.background = active ? C.tabActive : C.tabBg;
          b.style.color = active ? C.gold : C.textSecondary;
        }
      };
      stateButtons.push(btn);
      stateRow.appendChild(btn);
    }
    left.appendChild(stateRow);

    // ── Stat bars ──
    const statsWrap = document.createElement('div');
    statsWrap.style.cssText = 'display:flex;flex-direction:column;gap:8px;';
    const maxHp = 1200;
    const maxAtk = 200;
    const maxSpd = 210;
    statsWrap.appendChild(this.buildStatBar('HP', unit.hp, maxHp, '#5a9a4e'));
    statsWrap.appendChild(this.buildStatBar('ATK', unit.attack, maxAtk, C.red));
    statsWrap.appendChild(this.buildStatBar('SPD', unit.speed, maxSpd, C.teal));
    left.appendChild(statsWrap);

    // ── Abilities ──
    const abilitiesWrap = document.createElement('div');
    abilitiesWrap.style.cssText = 'display:flex;flex-direction:column;gap:8px;';

    for (const ab of [
      { name: unit.ability, desc: unit.desc },
      { name: unit.ability2, desc: unit.desc2 },
    ]) {
      const row = document.createElement('div');
      row.style.cssText = `
        padding:8px 12px;border-radius:10px;background:${C.surface};
        border:1px solid ${C.divider};
      `;
      const aName = document.createElement('div');
      aName.textContent = ab.name;
      aName.style.cssText = `font:bold 12px 'Fredoka',sans-serif;color:${C.gold};margin-bottom:2px;`;
      row.appendChild(aName);
      const aDesc = document.createElement('div');
      aDesc.textContent = ab.desc;
      aDesc.style.cssText = `font:11px 'Nunito',sans-serif;color:${C.textSecondary};`;
      row.appendChild(aDesc);
      abilitiesWrap.appendChild(row);
    }
    left.appendChild(abilitiesWrap);

    body.appendChild(left);

    // ── Right column (60%) ──
    const right = document.createElement('div');
    right.style.cssText = `
      flex:1;display:flex;flex-direction:column;min-width:0;
    `;

    // Tab bar
    const tabBar = document.createElement('div');
    tabBar.style.cssText = `
      display:flex;gap:0;border-bottom:1px solid ${C.divider};flex-shrink:0;
    `;
    const tabs: Array<{ id: 'skins' | 'voice' | 'effects'; label: string }> = [
      { id: 'skins', label: 'Skins' },
      { id: 'voice', label: 'Voice' },
      { id: 'effects', label: 'Effects' },
    ];
    const tabButtons: HTMLButtonElement[] = [];

    // Tab content area
    const tabContent = document.createElement('div');
    tabContent.style.cssText = 'flex:1;overflow-y:auto;padding:14px 16px;';

    for (const tab of tabs) {
      const btn = document.createElement('button');
      btn.textContent = tab.label;
      const isActive = tab.id === this.selectedTab;
      btn.style.cssText = `
        flex:1;padding:10px 0;border:none;cursor:pointer;transition:all 0.15s;
        font:bold 13px 'Fredoka',sans-serif;
        background:${isActive ? C.tabActive : 'transparent'};
        color:${isActive ? C.gold : C.textSecondary};
        border-bottom:2px solid ${isActive ? C.tabBorder : 'transparent'};
      `;
      btn.onmouseenter = () => {
        if (this.selectedTab !== tab.id) btn.style.background = C.tabBg;
      };
      btn.onmouseleave = () => {
        if (this.selectedTab !== tab.id) btn.style.background = 'transparent';
      };
      btn.onclick = () => {
        this.selectedTab = tab.id;
        for (const b of tabButtons) {
          const active = b === btn;
          b.style.background = active ? C.tabActive : 'transparent';
          b.style.color = active ? C.gold : C.textSecondary;
          b.style.borderBottom = `2px solid ${active ? C.tabBorder : 'transparent'}`;
        }
        this.renderTabContent(unit, tabContent);
      };
      tabButtons.push(btn);
      tabBar.appendChild(btn);
    }
    right.appendChild(tabBar);

    // Initial tab content
    this.renderTabContent(unit, tabContent);
    right.appendChild(tabContent);

    body.appendChild(right);
    container.appendChild(body);

    // ── Footer navigation ──
    const footer = document.createElement('div');
    footer.style.cssText = `
      display:flex;align-items:center;justify-content:space-between;
      padding:10px 20px;border-top:1px solid ${C.divider};flex-shrink:0;
    `;

    const idx = UNIT_ORDER.findIndex((u) => u.type === unit.type);
    const prevUnit = UNIT_ORDER[(idx - 1 + UNIT_ORDER.length) % UNIT_ORDER.length];
    const nextUnit = UNIT_ORDER[(idx + 1) % UNIT_ORDER.length];

    const prevBtn = makeBtn(`\u25C0 ${prevUnit.name}`);
    prevBtn.onclick = () => this.navigateUnit(-1);
    footer.appendChild(prevBtn);

    const counter = document.createElement('span');
    counter.textContent = `${idx + 1} / ${UNIT_ORDER.length}`;
    counter.style.cssText = `font:bold 12px 'Nunito',sans-serif;color:${C.textMuted};`;
    footer.appendChild(counter);

    const nextBtn = makeBtn(`${nextUnit.name} \u25B6`);
    nextBtn.onclick = () => this.navigateUnit(1);
    footer.appendChild(nextBtn);

    container.appendChild(footer);

    // ── Subscribe to inventory/equipped changes to auto-refresh tabs ──
    this.unsubInventory?.();
    this.unsubEquipped?.();
    const inv = InventoryManager.getInstance();
    this.unsubInventory = inv.onInventoryChange(() => {
      if (this.currentView === 'detail' && this.selectedUnit) {
        const u = UNIT_ORDER.find((x) => x.type === this.selectedUnit);
        if (u) this.renderTabContent(u, tabContent);
      }
    });
    this.unsubEquipped = inv.onEquippedChange(() => {
      if (this.currentView === 'detail' && this.selectedUnit) {
        const u = UNIT_ORDER.find((x) => x.type === this.selectedUnit);
        if (u) this.renderTabContent(u, tabContent);
      }
    });
  }

  // ─── Stat bar widget ───────────────────────────────────────────────────────

  private buildStatBar(label: string, value: number, max: number, color: string): HTMLElement {
    const row = document.createElement('div');
    row.style.cssText = 'display:flex;align-items:center;gap:8px;';

    const lbl = document.createElement('span');
    lbl.textContent = label;
    lbl.style.cssText = `
      width:32px;font:bold 11px 'Fredoka',sans-serif;color:${C.textSecondary};
      text-align:right;flex-shrink:0;
    `;
    row.appendChild(lbl);

    const bar = document.createElement('div');
    bar.style.cssText = `
      flex:1;height:8px;background:rgba(139,115,85,0.2);border-radius:4px;overflow:hidden;
    `;
    const fill = document.createElement('div');
    const pct = Math.min(100, (value / max) * 100);
    fill.style.cssText = `
      height:100%;width:${pct}%;background:${color};border-radius:4px;
      transition:width 0.3s ease;
    `;
    bar.appendChild(fill);
    row.appendChild(bar);

    const val = document.createElement('span');
    val.textContent = String(value);
    val.style.cssText = `
      width:36px;font:bold 11px 'Nunito',sans-serif;color:${C.textPrimary};
      text-align:left;flex-shrink:0;
    `;
    row.appendChild(val);

    return row;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // TAB CONTENT RENDERERS
  // ═══════════════════════════════════════════════════════════════════════════

  private renderTabContent(unit: UnitInfo, container: HTMLElement): void {
    container.innerHTML = '';
    switch (this.selectedTab) {
      case 'skins':
        container.appendChild(this.buildSkinsTab(unit.type));
        break;
      case 'voice':
        container.appendChild(this.buildVoiceTab(unit.type));
        break;
      case 'effects':
        container.appendChild(this.buildEffectsTab());
        break;
    }
  }

  // ─── Skins Tab ─────────────────────────────────────────────────────────────

  private buildSkinsTab(unitType: HordeUnitType): HTMLElement {
    this.skinCards.clear();

    const frag = document.createElement('div');
    frag.style.cssText = `
      display:grid;grid-template-columns:repeat(2,1fr);gap:10px;
    `;

    const catalog = CatalogService.getInstance();
    const inv = InventoryManager.getInstance();
    const equip = EquipService.getInstance();
    const equippedSkin = inv.getEquippedSkin(unitType) || 'default';

    // Items for this unit in the "unit_skin" category
    const skinItems = catalog.getByUnit(unitType).filter((i) => i.category === 'unit_skin');

    // Default card (always first, always owned)
    frag.appendChild(
      this.buildSkinCard(
        'Default',
        'default',
        'common',
        unitType,
        true,
        equippedSkin === 'default',
        null,
        null,
      ),
    );

    // Catalog skins
    for (const item of skinItems) {
      const owned = inv.owns(item.id);
      const skinId = item.id; // skin ID matches item ID
      const isEquipped = equippedSkin === skinId;
      frag.appendChild(
        this.buildSkinCard(
          item.name,
          skinId,
          item.rarity,
          unitType,
          owned,
          isEquipped,
          item.priceCrowns,
          item.priceGlory,
        ),
      );
    }

    this.refreshSkinCardHighlights();
    return frag;
  }

  private buildSkinCard(
    name: string,
    skinId: string,
    rarity: string,
    unitType: HordeUnitType,
    owned: boolean,
    equipped: boolean,
    priceCrowns: number | null,
    priceGlory: number | null,
  ): HTMLElement {
    const card = document.createElement('div');
    const borderColor = RARITY_BORDER[rarity] || RARITY_BORDER.common;
    card.style.cssText = `
      padding:12px;border-radius:12px;background:${C.surface};
      border:1px solid ${C.divider};border-left:3px solid ${borderColor};
      display:flex;flex-direction:column;gap:6px;transition:all 0.15s;
      cursor:pointer;
    `;
    card.onmouseenter = () => {
      card.style.background = C.surfaceHover;
    };
    card.onmouseleave = () => {
      card.style.background = C.surface;
    };
    this.skinCards.set(skinId, card);

    // Skin name
    const nameEl = document.createElement('div');
    nameEl.textContent = name;
    nameEl.style.cssText = `font:bold 13px 'Fredoka',sans-serif;color:${C.textH1};`;
    card.appendChild(nameEl);

    // Rarity label
    const rarityEl = document.createElement('div');
    rarityEl.textContent = rarity.charAt(0).toUpperCase() + rarity.slice(1);
    rarityEl.style.cssText = `font:10px 'Nunito',sans-serif;color:${C.textMuted};text-transform:uppercase;letter-spacing:1px;`;
    card.appendChild(rarityEl);

    // Action row
    const actionRow = document.createElement('div');
    actionRow.style.cssText = 'display:flex;align-items:center;gap:6px;margin-top:4px;';

    if (equipped) {
      // Equipped badge
      const badge = document.createElement('span');
      badge.textContent = 'EQUIPPED';
      badge.style.cssText = `
        font:bold 10px 'Fredoka',sans-serif;color:${C.teal};
        background:rgba(69,230,176,0.12);padding:3px 10px;border-radius:8px;
        letter-spacing:1px;
      `;
      actionRow.appendChild(badge);
    } else if (owned) {
      // Equip button
      const equipBtn = makeBtn('EQUIP', true);
      equipBtn.style.padding = '4px 14px';
      equipBtn.style.fontSize = '11px';
      equipBtn.onclick = (e) => {
        e.stopPropagation();
        if (AuthManager.getInstance().isGuest) {
          showGuestLoginPrompt('equip skins');
          return;
        }
        const equip = EquipService.getInstance();
        if (skinId === 'default') {
          equip.unequipUnitSkin(unitType);
        } else {
          equip.equipUnitSkin(unitType, skinId);
        }
        // Update preview preserving current animation
        this.spritePreview?.loadUnit(unitType, this.currentAnimState, skinId === 'default' ? undefined : skinId);
        this.previewedSkinId = skinId;
        this.refreshSkinCardHighlights();
      };
      actionRow.appendChild(equipBtn);
    } else {
      // Locked — show single price + buy
      const lockIcon = document.createElement('span');
      lockIcon.textContent = '\uD83D\uDD12';
      lockIcon.style.cssText = 'font-size:12px;';
      actionRow.appendChild(lockIcon);

      // Determine which currency this skin uses (glory or crowns, never both)
      const useGlory = priceGlory != null && priceGlory > 0;

      if (useGlory) {
        const gloryEl = document.createElement('span');
        gloryEl.textContent = `\u2605 ${priceGlory}`;
        gloryEl.style.cssText = `font:bold 11px 'Nunito',sans-serif;color:#C0C0D2;`;
        actionRow.appendChild(gloryEl);
      } else if (priceCrowns != null && priceCrowns > 0) {
        const priceEl = document.createElement('span');
        priceEl.textContent = `\uD83D\uDC51 ${priceCrowns}`;
        priceEl.style.cssText = `font:bold 11px 'Nunito',sans-serif;color:${C.gold};`;
        actionRow.appendChild(priceEl);
      }

      const currency: 'crowns' | 'glory' = useGlory ? 'glory' : 'crowns';
      const buyBtn = makeBtn('BUY', true);
      buyBtn.style.padding = '4px 12px';
      buyBtn.style.fontSize = '11px';
      buyBtn.onclick = (e) => {
        e.stopPropagation();
        showPurchaseConfirm({
          itemName: name,
          priceCrowns: useGlory ? undefined : (priceCrowns ?? undefined),
          priceGlory: useGlory ? (priceGlory ?? undefined) : undefined,
          onConfirm: async () => {
            const result = await PaymentService.getInstance().purchaseItem(skinId, currency);
            if (!result.success) {
              console.warn('Purchase failed:', result.error);
            }
          },
          onCancel: () => {},
        });
      };
      actionRow.appendChild(buyBtn);
    }

    card.appendChild(actionRow);

    // Click card to preview skin in sprite viewer (all skins, including locked)
    card.onclick = () => {
      const skinArg = skinId === 'default' ? undefined : skinId;
      this.spritePreview?.loadUnit(unitType, this.currentAnimState, skinArg);
      this.previewedSkinId = skinId;
      this.refreshSkinCardHighlights();
    };

    return card;
  }

  /** Highlight the currently previewed skin card with a gold outline. */
  private refreshSkinCardHighlights(): void {
    for (const [id, el] of this.skinCards) {
      const isActive = id === this.previewedSkinId;
      el.style.outline = isActive ? `2px solid ${C.gold}` : 'none';
      el.style.outlineOffset = isActive ? '2px' : '0';
    }
  }

  // ─── Voice Tab ─────────────────────────────────────────────────────────────

  private buildVoiceTab(unitType: HordeUnitType): HTMLElement {
    const wrap = document.createElement('div');
    wrap.style.cssText = 'display:flex;flex-direction:column;gap:10px;';

    const inv = InventoryManager.getInstance();
    const equipped = inv.getEquipped();
    const equippedVoice = equipped.voicePacks?.[unitType] || 'default';

    // Default voice row
    wrap.appendChild(
      this.buildVoiceRow('Default Voice', 'default', 'common', unitType, true, equippedVoice === 'default'),
    );

    // Voice packs for this unit from the catalog
    const catalog = CatalogService.getInstance();
    const voiceItems = catalog.getByUnit(unitType).filter((i) => i.category === 'voice_pack');

    for (const item of voiceItems) {
      const owned = inv.owns(item.id);
      const isEquipped = equippedVoice === item.id;
      wrap.appendChild(
        this.buildVoiceRow(item.name, item.id, item.rarity, unitType, owned, isEquipped, item.priceCrowns, item.priceGlory),
      );
    }

    if (voiceItems.length === 0) {
      const empty = document.createElement('div');
      empty.textContent = 'No additional voice packs available for this unit yet.';
      empty.style.cssText = `font:12px 'Nunito',sans-serif;color:${C.textMuted};padding:20px 0;text-align:center;`;
      wrap.appendChild(empty);
    }

    return wrap;
  }

  private buildVoiceRow(
    name: string,
    packId: string,
    rarity: string,
    unitType: HordeUnitType,
    owned: boolean,
    equipped: boolean,
    priceCrowns?: number | null,
    priceGlory?: number | null,
  ): HTMLElement {
    const row = document.createElement('div');
    const borderColor = RARITY_BORDER[rarity] || RARITY_BORDER.common;
    row.style.cssText = `
      display:flex;align-items:center;gap:10px;
      padding:10px 14px;border-radius:12px;background:${C.surface};
      border:1px solid ${C.divider};border-left:3px solid ${borderColor};
      transition:all 0.15s;
    `;
    row.onmouseenter = () => { row.style.background = C.surfaceHover; };
    row.onmouseleave = () => { row.style.background = C.surface; };

    // Play preview button
    const playBtn = document.createElement('button');
    playBtn.textContent = '\uD83D\uDD0A';
    playBtn.style.cssText = `
      width:32px;height:32px;border-radius:50%;background:${C.tabBg};
      border:1px solid ${C.divider};cursor:pointer;font-size:14px;
      display:flex;align-items:center;justify-content:center;
      transition:all 0.15s;flex-shrink:0;
    `;
    playBtn.onmouseenter = () => {
      playBtn.style.background = C.surfaceHover;
      playBtn.style.borderColor = C.inputBorderHi;
    };
    playBtn.onmouseleave = () => {
      playBtn.style.background = C.tabBg;
      playBtn.style.borderColor = C.divider;
    };
    playBtn.onclick = (e) => {
      e.stopPropagation();
      this.playVoicePreview(packId, unitType, playBtn);
    };
    row.appendChild(playBtn);

    // Name
    const nameEl = document.createElement('div');
    nameEl.style.cssText = 'flex:1;min-width:0;';
    const nameText = document.createElement('div');
    nameText.textContent = name;
    nameText.style.cssText = `font:bold 13px 'Fredoka',sans-serif;color:${C.textH1};`;
    nameEl.appendChild(nameText);
    const rarityText = document.createElement('div');
    rarityText.textContent = rarity.charAt(0).toUpperCase() + rarity.slice(1);
    rarityText.style.cssText = `font:10px 'Nunito',sans-serif;color:${C.textMuted};text-transform:uppercase;letter-spacing:1px;`;
    nameEl.appendChild(rarityText);
    row.appendChild(nameEl);

    // Status / action
    if (equipped) {
      const badge = document.createElement('span');
      badge.textContent = 'EQUIPPED';
      badge.style.cssText = `
        font:bold 10px 'Fredoka',sans-serif;color:${C.teal};
        background:rgba(69,230,176,0.12);padding:3px 10px;border-radius:8px;
        letter-spacing:1px;flex-shrink:0;
      `;
      row.appendChild(badge);
    } else if (owned) {
      const equipBtn = makeBtn('EQUIP', true);
      equipBtn.style.padding = '4px 14px';
      equipBtn.style.fontSize = '11px';
      equipBtn.onclick = (e) => {
        e.stopPropagation();
        if (AuthManager.getInstance().isGuest) {
          showGuestLoginPrompt('equip voice packs');
          return;
        }
        const equip = EquipService.getInstance();
        if (packId === 'default') {
          equip.equipItem(`voicePacks/${unitType}`, 'default');
        } else {
          equip.equipItem(`voicePacks/${unitType}`, packId);
        }
      };
      row.appendChild(equipBtn);
    } else {
      // Price + buy
      const priceWrap = document.createElement('div');
      priceWrap.style.cssText = 'display:flex;align-items:center;gap:6px;flex-shrink:0;';

      const lockIcon = document.createElement('span');
      lockIcon.textContent = '\uD83D\uDD12';
      lockIcon.style.cssText = 'font-size:12px;';
      priceWrap.appendChild(lockIcon);

      if (priceCrowns != null && priceCrowns > 0) {
        const priceEl = document.createElement('span');
        priceEl.textContent = `\uD83D\uDC51 ${priceCrowns}`;
        priceEl.style.cssText = `font:bold 11px 'Nunito',sans-serif;color:${C.gold};`;
        priceWrap.appendChild(priceEl);
      }

      const buyBtn = makeBtn('BUY', true);
      buyBtn.style.padding = '4px 12px';
      buyBtn.style.fontSize = '11px';
      buyBtn.onclick = (e) => {
        e.stopPropagation();
        showPurchaseConfirm({
          itemName: name,
          priceCrowns: priceCrowns ?? undefined,
          priceGlory: priceGlory ?? undefined,
          onConfirm: async () => {
            const currency = priceGlory ? 'glory' : 'crowns';
            const result = await PaymentService.getInstance().purchaseItem(packId, currency);
            if (!result.success) console.warn('Purchase failed:', result.error);
          },
          onCancel: () => {},
        });
      };
      priceWrap.appendChild(buyBtn);
      row.appendChild(priceWrap);
    }

    return row;
  }

  // ─── Voice Preview ─────────────────────────────────────────────────────────

  private async playVoicePreview(packId: string, unitType: HordeUnitType, _btn: HTMLButtonElement): Promise<void> {
    // Stop any currently playing preview
    if (this._previewAudio) {
      this._previewAudio.pause();
      this._previewAudio.currentTime = 0;
      this._previewAudio = null;
    }

    // Play from static file
    const fileKey = packId === 'default' ? `default_${unitType}` : packId;
    const staticUrl = `assets/audio/voice_samples/${fileKey}.mp3`;

    try {
      const audio = new Audio(staticUrl);
      audio.volume = 0.8;
      await new Promise<void>((resolve, reject) => {
        audio.oncanplaythrough = () => resolve();
        audio.onerror = () => reject();
        audio.load();
      });
      this._previewAudio = audio;
      audio.play().catch(() => {});
    } catch {
      console.warn(`[Voice Preview] Static file not found: ${staticUrl}`);
    }
  }

  // ─── Effects Tab ───────────────────────────────────────────────────────────

  private buildEffectsTab(): HTMLElement {
    const wrap = document.createElement('div');
    wrap.style.cssText = 'display:flex;flex-direction:column;gap:14px;';

    const inv = InventoryManager.getInstance();
    const equipped = inv.getEquipped();
    const catalog = CatalogService.getInstance();

    // Global cosmetic effect slots
    const effectSlots: Array<{
      label: string;
      slot: string;
      category: string;
      currentValue: string;
      equipFn: (id: string) => Promise<void>;
    }> = [
      {
        label: 'Death Effect',
        slot: 'deathEffect',
        category: 'death_effect',
        currentValue: equipped.deathEffect,
        equipFn: (id) => EquipService.getInstance().equipDeathEffect(id),
      },
      {
        label: 'Spawn Effect',
        slot: 'spawnEffect',
        category: 'spawn_effect',
        currentValue: equipped.spawnEffect,
        equipFn: (id) => EquipService.getInstance().equipSpawnEffect(id),
      },
      {
        label: 'Attack Trail',
        slot: 'attackTrail',
        category: 'attack_trail',
        currentValue: equipped.attackTrail,
        equipFn: (id) => EquipService.getInstance().equipAttackTrail(id),
      },
      {
        label: 'Victory Effect',
        slot: 'victoryEffect',
        category: 'victory_effect',
        currentValue: equipped.victoryEffect,
        equipFn: (id) => EquipService.getInstance().equipVictoryEffect(id),
      },
    ];

    for (const slot of effectSlots) {
      const section = document.createElement('div');
      section.style.cssText = `
        padding:12px 14px;border-radius:12px;background:${C.surface};
        border:1px solid ${C.divider};
      `;

      // Label
      const label = document.createElement('div');
      label.textContent = slot.label;
      label.style.cssText = `font:bold 13px 'Fredoka',sans-serif;color:${C.textH1};margin-bottom:8px;`;
      section.appendChild(label);

      // Current value display
      const currentName = slot.currentValue === 'default'
        ? 'Default'
        : (catalog.getItem(slot.currentValue)?.name || slot.currentValue);

      const currentEl = document.createElement('div');
      currentEl.style.cssText = `
        font:12px 'Nunito',sans-serif;color:${C.textSecondary};margin-bottom:8px;
      `;
      currentEl.textContent = `Currently: ${currentName}`;
      section.appendChild(currentEl);

      // Build dropdown-style selector from owned items in this category
      const items = catalog.getByCategory(slot.category as any).filter((i) => inv.owns(i.id));
      const selectRow = document.createElement('div');
      selectRow.style.cssText = 'display:flex;flex-wrap:wrap;gap:6px;';

      // Default option
      const defaultPill = this.buildEffectPill('Default', 'default', slot.currentValue === 'default', () => {
        slot.equipFn('default');
      });
      selectRow.appendChild(defaultPill);

      for (const item of items) {
        const isActive = slot.currentValue === item.id;
        const pill = this.buildEffectPill(item.name, item.id, isActive, () => {
          slot.equipFn(item.id);
        });
        selectRow.appendChild(pill);
      }

      section.appendChild(selectRow);

      if (items.length === 0) {
        const hint = document.createElement('div');
        hint.textContent = 'Visit the Store to unlock more effects!';
        hint.style.cssText = `font:11px 'Nunito',sans-serif;color:${C.textMuted};margin-top:6px;font-style:italic;`;
        section.appendChild(hint);
      }

      wrap.appendChild(section);
    }

    return wrap;
  }

  private buildEffectPill(
    name: string,
    id: string,
    active: boolean,
    onSelect: () => void,
  ): HTMLElement {
    const pill = document.createElement('button');
    pill.textContent = name;
    pill.style.cssText = `
      padding:5px 12px;border-radius:16px;font:bold 11px 'Nunito',sans-serif;
      cursor:pointer;transition:all 0.15s;
      border:1px solid ${active ? C.tabBorder : C.divider};
      background:${active ? C.tabActive : C.tabBg};
      color:${active ? C.gold : C.textSecondary};
    `;
    pill.onmouseenter = () => {
      if (!active) {
        pill.style.background = C.surfaceHover;
        pill.style.borderColor = C.inputBorderHi;
      }
    };
    pill.onmouseleave = () => {
      if (!active) {
        pill.style.background = C.tabBg;
        pill.style.borderColor = C.divider;
      }
    };
    pill.onclick = (e) => {
      e.stopPropagation();
      onSelect();
    };
    return pill;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // NAVIGATION
  // ═══════════════════════════════════════════════════════════════════════════

  private navigateUnit(direction: -1 | 1): void {
    if (!this.selectedUnit || !this.detailSlide) return;
    const idx = UNIT_ORDER.findIndex((u) => u.type === this.selectedUnit);
    if (idx < 0) return;
    const newIdx = (idx + direction + UNIT_ORDER.length) % UNIT_ORDER.length;
    const newUnit = UNIT_ORDER[newIdx];
    this.selectedUnit = newUnit.type;
    this.selectedTab = 'skins';
    this.spritePreview?.destroy();
    this.spritePreview = null;
    this.skinCards.clear();
    this.currentAnimState = 'idle';
    this.buildDetailView(newUnit, this.detailSlide);
  }
}
