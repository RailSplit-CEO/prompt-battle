// ─── BattlePassPanel — Vertical left sidebar for the Battle Pass ─────
// Clash Royale style: free rewards left, premium rewards right per tier.
// Always visible on menu screen as a slim sidebar.

import { C } from './UIColors';
import { CURRENT_SEASON } from '@prompt-battle/shared';
import type { BattlePassTier, BattlePassReward, PlayerBattlePass } from '@prompt-battle/shared';
import { AuthManager } from '../auth/AuthManager';
import { showGuestLoginPrompt } from './LoginOverlay';
import { BattlePassManager } from '../store/BattlePassManager';
import { getAuth } from 'firebase/auth';
import { getFirebaseApp } from '../auth/firebaseApp';
import { showToast } from './Toast';
import { CurrencyDisplay } from './CurrencyDisplay';
import { playCurrencyFly, prefreezeElement, unfreezeElement } from './CurrencyFlyAnimation';
import { SpritePreview } from './SpritePreview';
import { getSkinDef } from '@prompt-battle/shared';

// ── Reward display helpers ──────────────────────────────────────

function rewardLabel(r: BattlePassReward): string {
  if (r.type === 'crowns') return `${r.amount ?? 0}`;
  if (r.type === 'glory') return `${r.amount ?? 0}`;
  return formatItemId(r.itemId ?? 'item');
}

function rewardEmoji(r: BattlePassReward): string {
  if (r.type === 'crowns') return '\u{1F451}';
  if (r.type === 'glory') return '\u2605';
  const id = r.itemId ?? '';
  if (id.startsWith('skin_')) return '\uD83C\uDFA8';
  if (id.startsWith('portrait_')) return '\uD83D\uDDBC\uFE0F';
  if (id.startsWith('frame_')) return '\uD83D\uDDBC\uFE0F';
  if (id.startsWith('voice_')) return '\uD83C\uDF99\uFE0F';
  if (id.startsWith('emote_')) return '\uD83D\uDE04';
  if (id.startsWith('death_')) return '\uD83D\uDCA5';
  if (id.startsWith('cursor_')) return '\uD83D\uDD79\uFE0F';
  return '\uD83C\uDF81';
}

function formatItemId(id: string): string {
  return id.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

function rewardToastText(r: BattlePassReward): string {
  if (r.type === 'crowns') return `Claimed ${r.amount ?? 0} Crowns`;
  if (r.type === 'glory') return `Claimed ${r.amount ?? 0} Glory`;
  return `Claimed ${formatItemId(r.itemId ?? 'reward')}`;
}

// ── Live player state from Firebase ──────────────────────────────

function getPlayerBattlePass(): PlayerBattlePass {
  return BattlePassManager.getInstance().getData();
}

// ─── BattlePassPanel class ──────────────────────────────────────

export class BattlePassPanel {
  private root: HTMLDivElement | null = null;
  private tierList: HTMLDivElement | null = null;
  private onLoginRequest: (() => void) | null = null;

  // DOM refs for targeted updates
  private tierBadgeEl: HTMLElement | null = null;
  private xpCurEl: HTMLElement | null = null;
  private xpNextEl: HTMLElement | null = null;
  private progressFillEl: HTMLElement | null = null;
  private footerEl: HTMLElement | null = null;
  private cardMap: Map<string, HTMLDivElement> = new Map();

  // Live subscription
  private unsubscribeBP: (() => void) | null = null;
  private lastPlayerData: PlayerBattlePass | null = null;

  // Claim animation guard
  private animatingCards: Set<string> = new Set();
  private claiming = false;
  private _lastFlyTarget: HTMLElement | null = null;
  private spritePreviews: SpritePreview[] = [];

  constructor(onLoginRequest?: () => void) {
    this.onLoginRequest = onLoginRequest ?? null;
  }

  get isOpen(): boolean {
    return this.root !== null;
  }

  /** Mount the sidebar into a parent element */
  mount(parent: HTMLElement): void {
    if (this.root) return;
    this.build(parent);
  }

  /** Remove the sidebar */
  unmount(): void {
    this.unsubscribeBP?.();
    this.unsubscribeBP = null;
    for (const sp of this.spritePreviews) sp.destroy();
    this.spritePreviews = [];
    if (this.root) {
      this.root.remove();
      this.root = null;
      this.tierList = null;
      this.tierBadgeEl = null;
      this.xpCurEl = null;
      this.xpNextEl = null;
      this.progressFillEl = null;
      this.footerEl = null;
      this.cardMap.clear();
      this.lastPlayerData = null;
      this.animatingCards.clear();
    }
  }

  /** Refresh display — uses in-place updates when possible */
  refresh(): void {
    if (this.root?.parentElement) {
      this.updatePanel(getPlayerBattlePass());
    }
  }

  // ──────────────────────────────────────────────────────────────
  //  Build
  // ──────────────────────────────────────────────────────────────

  private build(parent: HTMLElement): void {
    this.injectStyles();

    const season = CURRENT_SEASON;
    const player = getPlayerBattlePass();
    this.lastPlayerData = { ...player, claimedFree: { ...player.claimedFree }, claimedPremium: { ...player.claimedPremium } };
    const currentTier = this.computeCurrentTier(player.xp);

    // ── Root container — warm earthy style matching in-game HUD ──
    const root = document.createElement('div');
    root.id = 'bp-sidebar';
    root.style.cssText = `
      position:fixed;top:0;left:0;bottom:0;
      width:clamp(260px, 22vw, 320px);
      background:linear-gradient(180deg, rgba(42,34,22,0.97) 0%, rgba(28,22,14,0.98) 100%);
      border-right:2px solid rgba(139,115,85,0.5);
      display:flex;flex-direction:column;overflow:hidden;
      font-family:"Nunito",sans-serif;
      z-index:90;
      opacity:0;transition:opacity 0.5s ease 0.6s;
    `;
    this.root = root;

    // ── Header ──
    const header = document.createElement('div');
    header.style.cssText = `
      padding:18px 18px 14px;
      background:linear-gradient(180deg, rgba(139,115,85,0.15) 0%, transparent 100%);
      border-bottom:2px solid rgba(139,115,85,0.3);
      flex-shrink:0;
    `;

    const titleRow = document.createElement('div');
    titleRow.style.cssText = 'display:flex;align-items:center;justify-content:space-between;';

    const titleLeft = document.createElement('div');
    titleLeft.style.cssText = 'display:flex;align-items:center;gap:8px;';

    const titleIcon = document.createElement('span');
    titleIcon.textContent = '\u2694\uFE0F';
    titleIcon.style.cssText = 'font-size:20px;';
    titleLeft.appendChild(titleIcon);

    const title = document.createElement('span');
    title.textContent = 'HORDE PASS';
    title.style.cssText = `
      font-family:"Fredoka",sans-serif;font-weight:700;font-size:16px;
      color:${C.gold};letter-spacing:2px;
    `;
    titleLeft.appendChild(title);

    titleRow.appendChild(titleLeft);

    const tierBadge = document.createElement('span');
    tierBadge.textContent = `TIER ${currentTier}`;
    tierBadge.style.cssText = `
      background:linear-gradient(135deg, ${C.gold}, ${C.goldDark});
      color:${C.textDark};font-family:"Fredoka",sans-serif;font-weight:800;
      font-size:15px;padding:6px 14px;border-radius:10px;
      letter-spacing:1px;
      box-shadow:0 2px 8px rgba(255,217,61,0.3);
    `;
    this.tierBadgeEl = tierBadge;
    titleRow.appendChild(tierBadge);
    header.appendChild(titleRow);

    // Season info
    const daysLeft = Math.max(0, Math.ceil((season.endDate - Date.now()) / (24 * 60 * 60 * 1000)));
    const seasonInfo = document.createElement('div');
    seasonInfo.textContent = `${season.name} \u2022 ${daysLeft} days left`;
    seasonInfo.style.cssText = `
      font-size:12px;color:${C.textSecondary};margin-top:6px;
    `;
    header.appendChild(seasonInfo);

    // XP Progress bar
    const xpIntoTier = this.computeXpIntoTier(player.xp, currentTier);
    const nextTierXp = currentTier < season.tiers.length
      ? season.tiers[currentTier].xpRequired
      : season.tiers[season.tiers.length - 1].xpRequired;
    const prevTierXp = currentTier >= 2 ? season.tiers[currentTier - 2]?.xpRequired ?? 0 : 0;
    const xpRange = nextTierXp - prevTierXp;
    const progressFrac = xpRange > 0 ? Math.min(1, xpIntoTier / xpRange) : 1;

    const progressWrap = document.createElement('div');
    progressWrap.style.cssText = 'margin-top:10px;';

    const progressBar = document.createElement('div');
    progressBar.style.cssText = `
      width:100%;height:10px;background:rgba(139,115,85,0.25);border-radius:5px;overflow:hidden;
      border:1px solid rgba(139,115,85,0.2);
    `;
    const progressFill = document.createElement('div');
    progressFill.style.cssText = `
      width:${progressFrac * 100}%;height:100%;
      background:linear-gradient(90deg, ${C.gold}, ${C.goldDark});
      border-radius:5px;transition:width 0.5s ease;
    `;
    this.progressFillEl = progressFill;
    progressBar.appendChild(progressFill);
    progressWrap.appendChild(progressBar);

    const xpLabel = document.createElement('div');
    xpLabel.style.cssText = `
      display:flex;justify-content:space-between;margin-top:4px;
      font-size:11px;color:${C.textMuted};font-weight:600;
    `;
    const xpCur = document.createElement('span');
    xpCur.textContent = `${player.xp} XP`;
    this.xpCurEl = xpCur;
    const xpNext = document.createElement('span');
    xpNext.textContent = currentTier < season.tiers.length ? `${nextTierXp} XP` : 'MAX';
    this.xpNextEl = xpNext;
    xpLabel.appendChild(xpCur);
    xpLabel.appendChild(xpNext);
    progressWrap.appendChild(xpLabel);
    header.appendChild(progressWrap);

    root.appendChild(header);

    // ── Track labels row ──
    const labelsRow = document.createElement('div');
    labelsRow.style.cssText = `
      display:flex;align-items:center;padding:8px 18px;
      border-bottom:2px solid rgba(139,115,85,0.3);flex-shrink:0;
      gap:6px;
      background:rgba(139,115,85,0.06);
    `;
    const tierLabel = document.createElement('span');
    tierLabel.style.cssText = `width:32px;font-size:11px;font-weight:700;color:${C.textMuted};font-family:"Fredoka",sans-serif;text-align:center;flex-shrink:0;`;
    tierLabel.textContent = '#';
    labelsRow.appendChild(tierLabel);

    const premLabel = document.createElement('span');
    premLabel.style.cssText = `flex:1;font-size:12px;font-weight:800;color:${C.gold};font-family:"Fredoka",sans-serif;text-align:center;letter-spacing:2px;text-shadow:0 0 8px rgba(255,217,61,0.4);`;
    premLabel.textContent = 'PREMIUM';
    labelsRow.appendChild(premLabel);

    const freeLabel = document.createElement('span');
    freeLabel.style.cssText = `flex:1;font-size:11px;font-weight:700;color:${C.teal};font-family:"Fredoka",sans-serif;text-align:center;letter-spacing:1px;`;
    freeLabel.textContent = 'FREE';
    labelsRow.appendChild(freeLabel);

    root.appendChild(labelsRow);

    // ── Tier list (scrollable) ──
    const tierList = document.createElement('div');
    tierList.className = 'bp-tier-list';
    tierList.style.cssText = `
      flex:1;overflow-y:auto;overflow-x:hidden;
      display:flex;flex-direction:column;
    `;
    this.tierList = tierList;

    // Build tiers in REVERSE order (highest first, current near top)
    const tiers = [...season.tiers].reverse();
    for (const tierDef of tiers) {
      const row = this.buildTierRow(tierDef, currentTier, player);
      tierList.appendChild(row);
    }

    root.appendChild(tierList);

    // ── Premium buy button (footer) ──
    if (!player.premium) {
      const footer = document.createElement('div');
      footer.style.cssText = `
        padding:16px 18px;border-top:2px solid rgba(139,115,85,0.3);flex-shrink:0;
        background:linear-gradient(180deg, rgba(255,217,61,0.08) 0%, rgba(139,115,85,0.06) 100%);
        transition:opacity 0.3s ease, max-height 0.3s ease;
        max-height:120px;overflow:hidden;
      `;
      this.footerEl = footer;

      const defaultHtml = `<div style="font-size:20px;font-weight:800;letter-spacing:1px;">BUY HORDE PASS</div><div style="font-size:14px;opacity:0.8;margin-top:2px;">$${season.premiumPriceUSD}</div>`;
      const buyBtn = document.createElement('button');
      buyBtn.innerHTML = defaultHtml;
      buyBtn.style.cssText = `
        width:100%;padding:16px 10px;border-radius:14px;font-weight:700;
        font-family:"Fredoka",sans-serif;cursor:pointer;transition:all 0.15s;
        background:linear-gradient(135deg, ${C.gold}, ${C.goldDark});
        border:2px solid rgba(255,217,61,0.6);color:${C.textDark};
        display:flex;flex-direction:column;align-items:center;justify-content:center;
        box-shadow:0 4px 16px rgba(255,217,61,0.3);
        text-shadow:0 1px 2px rgba(0,0,0,0.1);
      `;
      buyBtn.onmouseenter = () => {
        buyBtn.style.transform = 'translateY(-2px)';
        buyBtn.style.boxShadow = '0 6px 24px rgba(255,217,61,0.45)';
      };
      buyBtn.onmouseleave = () => {
        buyBtn.style.transform = '';
        buyBtn.style.boxShadow = '0 4px 16px rgba(255,217,61,0.3)';
      };
      buyBtn.onclick = async () => {
        if (AuthManager.getInstance().isGuest) {
          showGuestLoginPrompt('upgrade the Horde Pass');
          return;
        }
        const token = await getAuth(getFirebaseApp()).currentUser?.getIdToken();
        if (!token) return;
        buyBtn.textContent = '...';
        try {
          const res = await fetch('/api/store/purchaseBattlePass', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
            body: JSON.stringify({ tier: 'premium' }),
          });
          const data = await res.json();
          if (data.success) {
            buyBtn.textContent = '\u2713 PREMIUM UNLOCKED';
            buyBtn.style.background = C.teal;
          } else {
            buyBtn.textContent = data.error || 'Failed';
            setTimeout(() => { buyBtn.innerHTML = defaultHtml; }, 2000);
          }
        } catch {
          buyBtn.textContent = 'Error';
          setTimeout(() => { buyBtn.innerHTML = defaultHtml; }, 2000);
        }
      };
      footer.appendChild(buyBtn);
      root.appendChild(footer);
    }

    // ── Mount ──
    parent.appendChild(root);

    // Animate in
    requestAnimationFrame(() => { root.style.opacity = '1'; });

    // Scroll to current tier — delay to ensure DOM layout is computed
    setTimeout(() => this.scrollToCurrentTier(currentTier), 100);

    // ── Subscribe to live data updates ──
    this.unsubscribeBP = BattlePassManager.getInstance().onChange((newData) => {
      this.updatePanel(newData);
    });
  }

  // ──────────────────────────────────────────────────────────────
  //  In-place panel update (no DOM rebuild)
  // ──────────────────────────────────────────────────────────────

  private updatePanel(player: PlayerBattlePass): void {
    if (!this.root) return;

    const season = CURRENT_SEASON;
    const currentTier = this.computeCurrentTier(player.xp);
    const prev = this.lastPlayerData;

    // Update header
    if (this.tierBadgeEl) this.tierBadgeEl.textContent = `TIER ${currentTier}`;
    if (this.xpCurEl) this.xpCurEl.textContent = `${player.xp} XP`;

    const nextTierXp = currentTier < season.tiers.length
      ? season.tiers[currentTier].xpRequired
      : season.tiers[season.tiers.length - 1].xpRequired;
    if (this.xpNextEl) this.xpNextEl.textContent = currentTier < season.tiers.length ? `${nextTierXp} XP` : 'MAX';

    const prevTierXp = currentTier >= 2 ? season.tiers[currentTier - 2]?.xpRequired ?? 0 : 0;
    const xpRange = nextTierXp - prevTierXp;
    const xpIntoTier = this.computeXpIntoTier(player.xp, currentTier);
    const progressFrac = xpRange > 0 ? Math.min(1, xpIntoTier / xpRange) : 1;
    if (this.progressFillEl) this.progressFillEl.style.width = `${progressFrac * 100}%`;

    // Premium purchased — fade out footer
    if (player.premium && prev && !prev.premium && this.footerEl) {
      this.footerEl.style.opacity = '0';
      this.footerEl.style.maxHeight = '0';
      setTimeout(() => { this.footerEl?.remove(); this.footerEl = null; }, 300);
    }

    // Update each card
    for (const tierDef of season.tiers) {
      const tier = tierDef.tier;
      const isUnlocked = tier <= currentTier;
      const isFuture = tier > currentTier;

      // Update row opacity for tier unlock transitions
      if (this.tierList) {
        const row = this.tierList.querySelector(`[data-tier="${tier}"]`) as HTMLElement | null;
        if (row) {
          row.style.opacity = isFuture ? '0.3' : '';
          row.style.transition = 'opacity 0.4s ease';
        }
      }

      // Update free card
      const freeKey = `${tier}-free`;
      const freeCard = this.cardMap.get(freeKey);
      if (freeCard && !this.animatingCards.has(freeKey)) {
        const freeClaimed = !!player.claimedFree[tier];
        const freeClaimable = isUnlocked && !!tierDef.freeReward && !player.claimedFree[tier];
        this.populateRewardCard(freeCard, tierDef.freeReward, isUnlocked, freeClaimed, freeClaimable, false, tier);
      }

      // Update premium card
      const premKey = `${tier}-prem`;
      const premCard = this.cardMap.get(premKey);
      if (premCard && !this.animatingCards.has(premKey)) {
        const premClaimed = !!player.claimedPremium[tier];
        const premClaimable = isUnlocked && !!tierDef.premiumReward && !player.claimedPremium[tier] && player.premium;
        this.populateRewardCard(premCard, tierDef.premiumReward, isUnlocked, premClaimed, premClaimable, true, tier);
      }
    }

    this.lastPlayerData = { ...player, claimedFree: { ...player.claimedFree }, claimedPremium: { ...player.claimedPremium } };
  }

  // ──────────────────────────────────────────────────────────────
  //  Build a single tier row
  // ──────────────────────────────────────────────────────────────

  private buildTierRow(
    tierDef: BattlePassTier,
    currentTier: number,
    player: PlayerBattlePass,
  ): HTMLDivElement {
    const tier = tierDef.tier;
    const isUnlocked = tier <= currentTier;
    const isCurrent = tier === currentTier;
    const isFuture = tier > currentTier;

    const row = document.createElement('div');
    row.dataset.tier = String(tier);
    row.style.cssText = `
      display:flex;align-items:stretch;
      padding:8px 12px;gap:8px;
      border-bottom:1px solid rgba(139,115,85,0.15);
      transition:background 0.15s, opacity 0.4s ease;
      ${isFuture ? 'opacity:0.3;' : ''}
      ${isCurrent ? `background:rgba(255,217,61,0.08);border-left:4px solid ${C.gold};padding-left:8px;` : ''}
    `;

    // Tier number badge
    const tierBadge = document.createElement('div');
    tierBadge.textContent = String(tier);
    tierBadge.style.cssText = `
      width:28px;flex-shrink:0;
      display:flex;align-items:center;justify-content:center;
      font-size:15px;font-weight:800;
      color:${isCurrent ? C.gold : C.textMuted};
      font-family:"Fredoka",sans-serif;
    `;
    row.appendChild(tierBadge);

    // Premium reward square card (left side — highlighted)
    const premCard = this.buildRewardCard(
      tierDef.premiumReward, isUnlocked,
      !!player.claimedPremium[tier],
      isUnlocked && !!tierDef.premiumReward && !player.claimedPremium[tier] && player.premium,
      true, tier,
    );
    row.appendChild(premCard);

    // Free reward square card (right side)
    const freeCard = this.buildRewardCard(
      tierDef.freeReward, isUnlocked,
      !!player.claimedFree[tier],
      isUnlocked && !!tierDef.freeReward && !player.claimedFree[tier],
      false, tier,
    );
    row.appendChild(freeCard);

    return row;
  }

  // ──────────────────────────────────────────────────────────────
  //  Build a square reward card (outer shell + populate)
  // ──────────────────────────────────────────────────────────────

  private buildRewardCard(
    reward: BattlePassReward | undefined,
    isUnlocked: boolean,
    isClaimed: boolean,
    isClaimable: boolean,
    isPremium: boolean,
    tier: number,
  ): HTMLDivElement {
    const card = document.createElement('div');
    card.dataset.rewardCard = `${tier}-${isPremium ? 'prem' : 'free'}`;

    // Store in map for targeted updates
    this.cardMap.set(`${tier}-${isPremium ? 'prem' : 'free'}`, card);

    // Base card styles (non-content styles that don't change per state)
    card.style.cssText = `
      flex:1;
      aspect-ratio:1;
      display:flex;flex-direction:column;
      align-items:center;justify-content:center;
      gap:2px;
      padding:8px 4px;
      border-radius:10px;
      position:relative;
      min-width:0;
      transition:border-color 0.3s ease, background 0.3s ease, box-shadow 0.3s ease, opacity 0.3s ease;
    `;

    this.populateRewardCard(card, reward, isUnlocked, isClaimed, isClaimable, isPremium, tier);
    return card;
  }

  // ──────────────────────────────────────────────────────────────
  //  Populate / repopulate card contents
  // ──────────────────────────────────────────────────────────────

  private populateRewardCard(
    card: HTMLDivElement,
    reward: BattlePassReward | undefined,
    isUnlocked: boolean,
    isClaimed: boolean,
    isClaimable: boolean,
    isPremium: boolean,
    tier: number,
  ): void {
    // Destroy any SpritePreview attached to this card before clearing
    const oldCanvas = card.querySelector('canvas');
    if (oldCanvas) {
      const idx = this.spritePreviews.findIndex(sp => sp.getElement() === oldCanvas);
      if (idx >= 0) { this.spritePreviews[idx].destroy(); this.spritePreviews.splice(idx, 1); }
    }
    // Clear existing children and click handlers
    card.innerHTML = '';
    card.onclick = null;
    card.onmouseenter = null;
    card.onmouseleave = null;
    card.style.cursor = '';
    card.style.transform = '';

    const showLock = isPremium && !isClaimed && !isClaimable && !!reward;
    const borderColor = isPremium ? 'rgba(255,217,61,0.5)' : 'rgba(139,115,85,0.25)';
    const bgColor = isPremium
      ? 'linear-gradient(135deg, rgba(255,217,61,0.12) 0%, rgba(230,168,0,0.08) 100%)'
      : 'rgba(212,196,160,0.06)';
    const boxShadow = isPremium ? '0 0 12px rgba(255,217,61,0.15), inset 0 0 20px rgba(255,217,61,0.05)' : 'none';

    // Update dynamic styles
    card.style.background = bgColor;
    card.style.border = `2px solid ${borderColor}`;
    card.style.boxShadow = boxShadow;
    card.style.overflow = 'hidden';
    // Don't use card-level opacity — it dims skin previews. Use an overlay instead.
    card.style.opacity = '';

    if (!reward) {
      const dash = document.createElement('span');
      dash.textContent = '\u2014';
      dash.style.cssText = `font-size:16px;color:${C.textMuted};opacity:0.2;`;
      card.appendChild(dash);
      return;
    }

    // Skin items get an animated sprite preview; everything else gets an emoji
    const skinId = reward.type === 'item' && reward.itemId?.startsWith('skin_') ? reward.itemId : null;
    const skinDef = skinId ? getSkinDef(skinId) : null;
    if (skinDef) {
      const preview = new SpritePreview(300, 300);
      preview.loadUnit(skinDef.unitType as any, 'attack', skinId!);
      const canvas = preview.getElement();
      // Skin stays fully visible — no opacity or grayscale
      canvas.style.cssText += `width:100%;height:100%;object-fit:contain;border-radius:8px;background:transparent;position:absolute;top:50%;left:50%;transform:translate(-50%,-50%) scale(1.75);z-index:2;`;
      card.appendChild(canvas);
      this.spritePreviews.push(preview);
    } else {
      const icon = document.createElement('div');
      icon.textContent = rewardEmoji(reward);
      icon.style.cssText = `
        font-size:56px;line-height:1;margin-bottom:6px;
        transition:filter 0.3s ease;
        ${showLock ? 'filter:grayscale(1) brightness(0.5);' : ''}
        ${isClaimed ? 'opacity:0.5;' : ''}
      `;
      card.appendChild(icon);
    }

    // Dimming overlay for locked/claimed non-skin items
    if (!skinDef && (isClaimed || showLock)) {
      const dimOverlay = document.createElement('div');
      dimOverlay.style.cssText = `
        position:absolute;inset:0;border-radius:8px;
        background:rgba(0,0,0,${isClaimed ? '0.35' : '0.45'});
        z-index:0;pointer-events:none;
      `;
      card.appendChild(dimOverlay);
    }

    // Reward label
    const label = document.createElement('div');
    label.textContent = rewardLabel(reward);
    label.style.cssText = `
      font-size:13px;font-weight:700;
      color:${isPremium ? C.gold : C.textPrimary};
      text-align:center;
      word-wrap:break-word;overflow-wrap:break-word;
      white-space:normal;
      max-width:92%;
      line-height:1.2;
      margin-top:2px;
      font-family:"Fredoka",sans-serif;
      ${skinDef ? 'position:relative;z-index:3;margin-top:auto;text-shadow:0 1px 3px rgba(0,0,0,0.8);' : 'position:relative;z-index:1;'}
    `;
    card.appendChild(label);

    // State overlay
    if (isClaimed) {
      card.appendChild(this.createCheckmark());
    } else if (isClaimable) {
      const claimBtn = document.createElement('button');
      claimBtn.textContent = 'CLAIM';
      claimBtn.className = 'bp-claim-btn';
      claimBtn.style.cssText = `
        padding:3px 10px;border-radius:6px;font-size:10px;font-weight:700;
        cursor:pointer;transition:all 0.15s;
        background:${C.green};border:none;color:#fff;
        font-family:"Fredoka",sans-serif;letter-spacing:0.5px;
        pointer-events:none;
      `;
      card.appendChild(claimBtn);
      // Make the entire card clickable for claiming
      card.style.cursor = 'pointer';
      card.onmouseenter = () => {
        claimBtn.style.background = C.greenDark;
        claimBtn.style.transform = 'scale(1.05)';
        card.style.transform = 'scale(1.03)';
      };
      card.onmouseleave = () => {
        claimBtn.style.background = C.green;
        claimBtn.style.transform = '';
        card.style.transform = '';
      };
      card.onclick = (e) => {
        e.stopPropagation();
        this.handleClaim(tier, isPremium);
      };
      // Glow effect on claimable
      card.style.borderColor = C.green;
      card.style.boxShadow = `0 0 8px rgba(90,154,78,0.2)`;
    } else if (showLock) {
      const lock = document.createElement('div');
      lock.textContent = '\uD83D\uDD12';
      lock.style.cssText = `
        position:absolute;top:4px;right:4px;
        font-size:20px;opacity:1;
        line-height:1;
      `;
      card.appendChild(lock);
    }
  }

  // ──────────────────────────────────────────────────────────────
  //  Create a checkmark badge element
  // ──────────────────────────────────────────────────────────────

  private createCheckmark(): HTMLDivElement {
    const check = document.createElement('div');
    check.textContent = '\u2713';
    check.className = 'bp-checkmark';
    check.style.cssText = `
      position:absolute;top:4px;right:4px;
      width:18px;height:18px;border-radius:50%;
      background:${C.green};color:#fff;
      font-size:11px;font-weight:700;
      display:flex;align-items:center;justify-content:center;
    `;
    return check;
  }

  // ──────────────────────────────────────────────────────────────
  //  Claim handling
  // ──────────────────────────────────────────────────────────────

  private async handleClaim(tier: number, isPremium: boolean): Promise<void> {
    if (this.claiming) return; // prevent rapid-fire claims
    const auth = AuthManager.getInstance();
    if (auth.isGuest) {
      showGuestLoginPrompt('claim rewards');
      return;
    }
    const token = await getAuth(getFirebaseApp()).currentUser?.getIdToken();
    if (!token) return;

    this.claiming = true;
    // Visually disable all claim buttons while in-flight
    this.root?.querySelectorAll<HTMLButtonElement>('.bp-claim-btn').forEach(btn => {
      btn.disabled = true;
    });

    // Pre-freeze currency displays so Firebase listener doesn't update them before the fly animation
    const crownsEl = document.getElementById('menu-crowns-display');
    const gloryEl = document.getElementById('menu-glory-display');
    if (crownsEl) prefreezeElement(crownsEl);
    if (gloryEl) prefreezeElement(gloryEl);

    try {
      const res = await fetch('/api/store/claimBattlePassReward', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify({ tier, track: isPremium ? 'premium' : 'free' }),
      });
      const data = await res.json();
      if (res.ok && data.success) {
        showToast(rewardToastText(data.reward), 'success');
        this.animateClaim(tier, isPremium);
        // Fly currency icons to the top-right HUD counter
        const reward = data.reward as BattlePassReward;
        if ((reward.type === 'crowns' || reward.type === 'glory') && (reward.amount ?? 0) > 0) {
          // Try menu scene display first, then fall back to CurrencyDisplay singleton
          const menuEl = document.getElementById(reward.type === 'crowns' ? 'menu-crowns-display' : 'menu-glory-display');
          const display = CurrencyDisplay.getActive();
          const targetEl = menuEl || (reward.type === 'crowns' ? display?.getCrownsEl() : display?.getGloryEl());
          const key = `${tier}-${isPremium ? 'prem' : 'free'}`;
          const card = this.cardMap.get(key);
          if (targetEl && card) {
            this._lastFlyTarget = targetEl;
            const cardRect = card.getBoundingClientRect();
            playCurrencyFly({
              type: reward.type,
              amount: reward.amount!,
              fromX: cardRect.left + cardRect.width / 2,
              fromY: cardRect.top + cardRect.height / 2,
              toElement: targetEl,
            });
          }
        }
      } else {
        console.warn('[BattlePass] Claim failed:', data.error);
        showToast(data.error || 'Failed to claim reward', 'error');
      }
    } catch (err) {
      console.warn('[BattlePass] Claim error:', err);
      showToast('Failed to claim reward', 'error');
    } finally {
      this.claiming = false;
      // Re-enable claim buttons
      this.root?.querySelectorAll<HTMLButtonElement>('.bp-claim-btn').forEach(btn => {
        btn.disabled = false;
      });
      // Unfreeze whichever currency element was NOT used by the fly animation
      // (the animated one gets unfrozen by the animation itself when it finishes)
      if (gloryEl && gloryEl !== this._lastFlyTarget) unfreezeElement(gloryEl);
      if (crownsEl && crownsEl !== this._lastFlyTarget) unfreezeElement(crownsEl);
      this._lastFlyTarget = null;
    }
  }

  // ──────────────────────────────────────────────────────────────
  //  Claim animation (Clash Royale style)
  // ──────────────────────────────────────────────────────────────

  private animateClaim(tier: number, isPremium: boolean): void {
    const key = `${tier}-${isPremium ? 'prem' : 'free'}`;
    const card = this.cardMap.get(key);
    if (!card) return;

    // Guard against updatePanel stomping our animation
    this.animatingCards.add(key);

    // Phase 1: Glow + scale up
    card.style.animation = 'bp-claim-glow 500ms ease forwards';

    // Flash overlay
    const flash = document.createElement('div');
    flash.style.cssText = `
      position:absolute;inset:0;border-radius:10px;
      background:radial-gradient(circle, rgba(255,255,255,0.8) 0%, rgba(255,217,61,0.3) 100%);
      pointer-events:none;
      animation:bp-claim-flash 400ms ease 150ms forwards;
      opacity:0;
    `;
    card.appendChild(flash);

    // Phase 2: After glow, transition to claimed state
    setTimeout(() => {
      // Remove flash
      flash.remove();
      card.style.animation = '';

      // Remove CLAIM button
      const btn = card.querySelector('.bp-claim-btn');
      if (btn) btn.remove();

      // Transition to claimed look
      card.style.opacity = '0.5';
      const borderColor = isPremium ? 'rgba(255,217,61,0.5)' : 'rgba(139,115,85,0.25)';
      card.style.borderColor = borderColor;
      const boxShadow = isPremium ? '0 0 12px rgba(255,217,61,0.15), inset 0 0 20px rgba(255,217,61,0.05)' : 'none';
      card.style.boxShadow = boxShadow;

      // Phase 3: Checkmark pops in
      const check = this.createCheckmark();
      check.style.animation = 'bp-check-pop 300ms cubic-bezier(0.175,0.885,0.32,1.275) forwards';
      card.appendChild(check);

      // Done animating
      setTimeout(() => {
        check.style.animation = '';
        this.animatingCards.delete(key);
      }, 350);
    }, 550);
  }

  private showLoginPrompt(): void {
    // Small modal overlay
    const overlay = document.createElement('div');
    overlay.style.cssText = `
      position:fixed;inset:0;z-index:9999;
      background:${C.overlay};
      backdrop-filter:${C.panelBlur};-webkit-backdrop-filter:${C.panelBlur};
      display:flex;align-items:center;justify-content:center;
      opacity:0;transition:opacity 0.2s ease;
    `;

    const modal = document.createElement('div');
    modal.style.cssText = `
      width:min(320px, 85vw);padding:24px 20px;
      background:${C.panelBg};border:2px solid ${C.panelBorder};
      border-radius:16px;box-shadow:${C.panelShadow};
      text-align:center;
    `;

    const icon = document.createElement('div');
    icon.textContent = '\uD83D\uDD12';
    icon.style.cssText = 'font-size:32px;margin-bottom:12px;';
    modal.appendChild(icon);

    const msg = document.createElement('div');
    msg.textContent = 'Log in to save your progress and claim rewards!';
    msg.style.cssText = `
      font-size:14px;color:${C.textPrimary};margin-bottom:18px;
      font-family:"Nunito",sans-serif;line-height:1.4;
    `;
    modal.appendChild(msg);

    const btnRow = document.createElement('div');
    btnRow.style.cssText = 'display:flex;gap:8px;justify-content:center;';

    const loginBtn = document.createElement('button');
    loginBtn.textContent = 'Log In';
    loginBtn.style.cssText = `
      padding:8px 20px;border-radius:8px;font-size:13px;font-weight:700;
      font-family:"Fredoka",sans-serif;cursor:pointer;
      background:${C.gold};border:none;color:${C.textDark};
      transition:filter 0.15s;
    `;
    loginBtn.onmouseenter = () => { loginBtn.style.filter = 'brightness(1.1)'; };
    loginBtn.onmouseleave = () => { loginBtn.style.filter = ''; };
    loginBtn.onclick = () => {
      overlay.remove();
      this.onLoginRequest?.();
    };
    btnRow.appendChild(loginBtn);

    const laterBtn = document.createElement('button');
    laterBtn.textContent = 'Later';
    laterBtn.style.cssText = `
      padding:8px 20px;border-radius:8px;font-size:13px;font-weight:700;
      font-family:"Fredoka",sans-serif;cursor:pointer;
      background:${C.surface};border:1px solid ${C.panelBorder};color:${C.textSecondary};
      transition:all 0.15s;
    `;
    laterBtn.onclick = () => {
      overlay.style.opacity = '0';
      setTimeout(() => overlay.remove(), 200);
    };
    btnRow.appendChild(laterBtn);
    modal.appendChild(btnRow);

    overlay.appendChild(modal);
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) {
        overlay.style.opacity = '0';
        setTimeout(() => overlay.remove(), 200);
      }
    });

    document.body.appendChild(overlay);
    requestAnimationFrame(() => { overlay.style.opacity = '1'; });
  }

  // ──────────────────────────────────────────────────────────────
  //  XP / tier helpers
  // ──────────────────────────────────────────────────────────────

  private computeCurrentTier(xp: number): number {
    let tier = 0;
    for (const t of CURRENT_SEASON.tiers) {
      if (xp >= t.xpRequired) tier = t.tier;
      else break;
    }
    return tier;
  }

  private computeXpIntoTier(xp: number, currentTier: number): number {
    if (currentTier <= 0) return xp;
    const prevXp = currentTier >= 2 ? CURRENT_SEASON.tiers[currentTier - 2].xpRequired : 0;
    return xp - prevXp;
  }

  private scrollToCurrentTier(currentTier: number): void {
    if (!this.tierList) return;
    // If tier 0 (no progress), show tier 1 near the bottom
    const targetTier = Math.max(1, currentTier);
    const tierRow = this.tierList.querySelector(`[data-tier="${targetTier}"]`) as HTMLElement | null;
    if (tierRow) {
      const listHeight = this.tierList.clientHeight;
      const rowTop = tierRow.offsetTop;
      const rowHeight = tierRow.offsetHeight;
      // Center the current tier in the visible area
      this.tierList.scrollTop = Math.max(0, rowTop - listHeight / 3 + rowHeight / 2);
    }
  }

  // ──────────────────────────────────────────────────────────────
  //  Inject scoped styles
  // ──────────────────────────────────────────────────────────────

  private injectStyles(): void {
    if (document.getElementById('bp-sidebar-styles')) return;
    const style = document.createElement('style');
    style.id = 'bp-sidebar-styles';
    style.textContent = `
      #bp-sidebar .bp-tier-list::-webkit-scrollbar { width:5px; }
      #bp-sidebar .bp-tier-list::-webkit-scrollbar-track { background:transparent; }
      #bp-sidebar .bp-tier-list::-webkit-scrollbar-thumb {
        background:rgba(139,115,85,0.35);border-radius:3px;
      }
      #bp-sidebar .bp-tier-list::-webkit-scrollbar-thumb:hover {
        background:rgba(139,115,85,0.55);
      }
      #bp-sidebar .bp-tier-list {
        scrollbar-width:thin;
        scrollbar-color:rgba(139,115,85,0.35) transparent;
      }

      @keyframes bp-claim-glow {
        0%   { transform:scale(1);    box-shadow:0 0 0 rgba(90,154,78,0); }
        50%  { transform:scale(1.12); box-shadow:0 0 24px rgba(90,154,78,0.5), 0 0 48px rgba(255,217,61,0.25); }
        100% { transform:scale(1);    box-shadow:0 0 0 rgba(90,154,78,0); }
      }

      @keyframes bp-claim-flash {
        0%   { opacity:0; }
        40%  { opacity:0.7; }
        100% { opacity:0; }
      }

      @keyframes bp-check-pop {
        0%   { transform:scale(0.3); opacity:0; }
        70%  { transform:scale(1.2); opacity:1; }
        100% { transform:scale(1);   opacity:1; }
      }
    `;
    document.head.appendChild(style);
  }
}
