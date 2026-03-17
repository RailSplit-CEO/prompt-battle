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

// ── Live player state from Firebase ──────────────────────────────

function getPlayerBattlePass(): PlayerBattlePass {
  return BattlePassManager.getInstance().getData();
}

// ─── BattlePassPanel class ──────────────────────────────────────

export class BattlePassPanel {
  private root: HTMLDivElement | null = null;
  private tierList: HTMLDivElement | null = null;
  private onLoginRequest: (() => void) | null = null;

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
    if (this.root) {
      this.root.remove();
      this.root = null;
      this.tierList = null;
    }
  }

  /** Refresh display (call after XP changes) */
  refresh(): void {
    const parent = this.root?.parentElement;
    if (parent) {
      this.unmount();
      this.mount(parent);
    }
  }

  // ──────────────────────────────────────────────────────────────
  //  Build
  // ──────────────────────────────────────────────────────────────

  private build(parent: HTMLElement): void {
    this.injectStyles();

    const season = CURRENT_SEASON;
    const player = getPlayerBattlePass();
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

    // Debug: +1000 XP button
    const dbgBtn = document.createElement('button');
    dbgBtn.textContent = '+1000 XP';
    dbgBtn.style.cssText = `
      font-size:9px;font-weight:700;font-family:"Nunito",sans-serif;
      padding:2px 6px;border-radius:4px;cursor:pointer;
      background:rgba(139,115,85,0.4);border:1px solid ${C.gold};
      color:${C.gold};margin-left:6px;
    `;
    dbgBtn.onmouseenter = () => { dbgBtn.style.background = 'rgba(255,217,61,0.25)'; };
    dbgBtn.onmouseleave = () => { dbgBtn.style.background = 'rgba(139,115,85,0.4)'; };
    dbgBtn.onclick = async () => {
      try {
        const { getAuth } = await import('firebase/auth');
        const { getFirebaseApp } = await import('../auth/firebaseApp');
        const auth = getAuth(getFirebaseApp());
        if (!auth.currentUser) {
          dbgBtn.textContent = 'NO AUTH';
          setTimeout(() => { dbgBtn.textContent = '+1000 XP'; }, 1200);
          return;
        }
        const token = await auth.currentUser.getIdToken(true);
        const res = await fetch('/api/store/grantBattlePassXp', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
          body: JSON.stringify({ xp: 1000 }),
        });
        const data = await res.json();
        dbgBtn.textContent = data.success ? `T${data.currentTier}!` : data.error || 'ERR';
        setTimeout(() => { dbgBtn.textContent = '+1000 XP'; }, 1200);
      } catch (e) { dbgBtn.textContent = 'ERR'; console.error('[BP debug]', e); setTimeout(() => { dbgBtn.textContent = '+1000 XP'; }, 1200); }
    };
    titleLeft.appendChild(dbgBtn);

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
    progressBar.appendChild(progressFill);
    progressWrap.appendChild(progressBar);

    const xpLabel = document.createElement('div');
    xpLabel.style.cssText = `
      display:flex;justify-content:space-between;margin-top:4px;
      font-size:11px;color:${C.textMuted};font-weight:600;
    `;
    const xpCur = document.createElement('span');
    xpCur.textContent = `${player.xp} XP`;
    const xpNext = document.createElement('span');
    xpNext.textContent = currentTier < season.tiers.length ? `${nextTierXp} XP` : 'MAX';
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
        padding:12px 18px;border-top:2px solid rgba(139,115,85,0.3);flex-shrink:0;
        background:rgba(139,115,85,0.06);
      `;

      const buyBtn = document.createElement('button');
      buyBtn.innerHTML = `\u{1F451} <span style="font-size:14px;">UPGRADE</span> <span style="font-size:11px;opacity:0.7;">${season.premiumPriceCrowns} Crowns</span>`;
      buyBtn.style.cssText = `
        width:100%;padding:8px 10px;border-radius:10px;font-weight:700;
        font-family:"Fredoka",sans-serif;cursor:pointer;transition:all 0.15s;
        background:linear-gradient(135deg, ${C.gold}, ${C.goldDark});
        border:none;color:${C.textDark};
        display:flex;align-items:center;justify-content:center;gap:6px;
        box-shadow:0 2px 8px rgba(255,217,61,0.25);
      `;
      buyBtn.onmouseenter = () => {
        buyBtn.style.transform = 'translateY(-1px)';
        buyBtn.style.boxShadow = '0 4px 14px rgba(255,217,61,0.35)';
      };
      buyBtn.onmouseleave = () => {
        buyBtn.style.transform = '';
        buyBtn.style.boxShadow = '0 2px 8px rgba(255,217,61,0.25)';
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
            buyBtn.textContent = '\u2713 PREMIUM';
            buyBtn.style.background = C.teal;
          } else {
            buyBtn.textContent = data.error || 'Failed';
            setTimeout(() => { buyBtn.innerHTML = `\u{1F451} <span style="font-size:14px;">UPGRADE</span> <span style="font-size:11px;opacity:0.7;">${season.premiumPriceCrowns} Crowns</span>`; }, 2000);
          }
        } catch {
          buyBtn.textContent = 'Error';
          setTimeout(() => { buyBtn.innerHTML = `\u{1F451} <span style="font-size:14px;">UPGRADE</span> <span style="font-size:11px;opacity:0.7;">${season.premiumPriceCrowns} Crowns</span>`; }, 2000);
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
      transition:background 0.15s;
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
  //  Build a square reward card
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
    const borderColor = isPremium ? 'rgba(255,217,61,0.5)' : 'rgba(139,115,85,0.25)';
    const bgColor = isPremium
      ? 'linear-gradient(135deg, rgba(255,217,61,0.12) 0%, rgba(230,168,0,0.08) 100%)'
      : 'rgba(212,196,160,0.06)';
    const boxShadow = isPremium ? '0 0 12px rgba(255,217,61,0.15), inset 0 0 20px rgba(255,217,61,0.05)' : 'none';
    card.style.cssText = `
      flex:1;
      aspect-ratio:1;
      display:flex;flex-direction:column;
      align-items:center;justify-content:center;
      gap:2px;
      padding:8px 4px;
      border-radius:10px;
      background:${bgColor};
      border:2px solid ${borderColor};
      box-shadow:${boxShadow};
      position:relative;
      min-width:0;
      transition:border-color 0.15s, background 0.15s, box-shadow 0.15s;
      ${isClaimed ? 'opacity:0.5;' : ''}
    `;

    if (!reward) {
      const dash = document.createElement('span');
      dash.textContent = '\u2014';
      dash.style.cssText = `font-size:16px;color:${C.textMuted};opacity:0.2;`;
      card.appendChild(dash);
      return card;
    }

    // Big emoji icon
    const icon = document.createElement('div');
    icon.textContent = rewardEmoji(reward);
    icon.style.cssText = `
      font-size:56px;line-height:1;margin-bottom:6px;
      ${isPremium && !isUnlocked ? 'filter:grayscale(1) brightness(0.5);' : ''}
    `;
    card.appendChild(icon);

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
    `;
    card.appendChild(label);

    // State overlay
    if (isClaimed) {
      const check = document.createElement('div');
      check.textContent = '\u2713';
      check.style.cssText = `
        position:absolute;top:4px;right:4px;
        width:18px;height:18px;border-radius:50%;
        background:${C.green};color:#fff;
        font-size:11px;font-weight:700;
        display:flex;align-items:center;justify-content:center;
      `;
      card.appendChild(check);
    } else if (isClaimable) {
      const claimBtn = document.createElement('button');
      claimBtn.textContent = 'CLAIM';
      claimBtn.style.cssText = `
        padding:3px 10px;border-radius:6px;font-size:10px;font-weight:700;
        cursor:pointer;transition:all 0.15s;
        background:${C.green};border:none;color:#fff;
        font-family:"Fredoka",sans-serif;letter-spacing:0.5px;
      `;
      claimBtn.onmouseenter = () => { claimBtn.style.background = C.greenDark; claimBtn.style.transform = 'scale(1.05)'; };
      claimBtn.onmouseleave = () => { claimBtn.style.background = C.green; claimBtn.style.transform = ''; };
      claimBtn.onclick = (e) => {
        e.stopPropagation();
        this.handleClaim(tier, isPremium);
      };
      card.appendChild(claimBtn);
      // Glow effect on claimable
      card.style.borderColor = C.green;
      card.style.boxShadow = `0 0 8px rgba(90,154,78,0.2)`;
    } else if (isPremium && !isUnlocked) {
      const lock = document.createElement('div');
      lock.textContent = '\uD83D\uDD12';
      lock.style.cssText = `
        position:absolute;top:40%;left:50%;transform:translate(-50%,-50%);
        font-size:72px;opacity:0.5;
      `;
      card.appendChild(lock);
    }

    return card;
  }

  // ──────────────────────────────────────────────────────────────
  //  Claim handling
  // ──────────────────────────────────────────────────────────────

  private async handleClaim(tier: number, isPremium: boolean): Promise<void> {
    const auth = AuthManager.getInstance();
    if (auth.isGuest) {
      showGuestLoginPrompt('claim rewards');
      return;
    }
    const token = await getAuth(getFirebaseApp()).currentUser?.getIdToken();
    if (!token) return;

    try {
      const res = await fetch('/api/store/claimBattlePassReward', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify({ tier, track: isPremium ? 'premium' : 'free' }),
      });
      const data = await res.json();
      if (data.success) {
        // Refresh the panel to reflect the claimed state
        this.refresh();
      } else {
        console.warn('[BattlePass] Claim failed:', data.error);
      }
    } catch (err) {
      console.warn('[BattlePass] Claim error:', err);
    }
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
    `;
    document.head.appendChild(style);
  }
}
