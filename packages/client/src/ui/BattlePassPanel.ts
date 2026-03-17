// ─── BattlePassPanel — DOM overlay for the Battle Pass ──────────
// Dark glassmorphism panel matching StorePanel / FriendsPanel style.
// Horizontal scrolling tier track with free + premium reward rows.

import { C } from './UIColors';
import { WalletManager } from '../store/WalletManager';
import { CURRENT_SEASON } from '@prompt-battle/shared';
import type { BattlePassTier, BattlePassReward, PlayerBattlePass } from '@prompt-battle/shared';

// ── Reward display helpers ──────────────────────────────────────

function rewardLabel(r: BattlePassReward): string {
  if (r.type === 'crowns') return `${r.amount ?? 0} \u{1F451}`;
  if (r.type === 'glory') return `${r.amount ?? 0} \u2B50`;
  // Item — derive a short display name from the itemId
  return formatItemId(r.itemId ?? 'item');
}

function rewardEmoji(r: BattlePassReward): string {
  if (r.type === 'crowns') return '\u{1F451}';
  if (r.type === 'glory') return '\u2B50';
  const id = r.itemId ?? '';
  if (id.startsWith('skin_')) return '\uD83C\uDFA8';
  if (id.startsWith('portrait_')) return '\uD83D\uDDBC\uFE0F';
  if (id.startsWith('frame_')) return '\uD83D\uDDBC\uFE0F';
  if (id.startsWith('voice_')) return '\uD83C\uDF99\uFE0F';
  if (id.startsWith('emote_')) return '\uD83D\uDE04';
  if (id.startsWith('badge_')) return '\uD83C\uDFC5';
  if (id.startsWith('death_')) return '\uD83D\uDCA5';
  if (id.startsWith('cursor_')) return '\uD83D\uDD79\uFE0F';
  return '\uD83C\uDF81';
}

function formatItemId(id: string): string {
  return id
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

// ── Stub player state (will be replaced by a real manager) ──────

function getPlayerBattlePass(): PlayerBattlePass {
  // TODO: wire up to Firebase RTDB /users/{uid}/battlePass
  return {
    season: CURRENT_SEASON.id,
    premium: false,
    premiumPlus: false,
    xp: 0,
    claimedFree: {},
    claimedPremium: {},
  };
}

// ─── BattlePassPanel class ──────────────────────────────────────

export class BattlePassPanel {
  private root: HTMLDivElement | null = null;
  private escHandler: ((e: KeyboardEvent) => void) | null = null;
  private tierTrack: HTMLDivElement | null = null;
  private wallet = WalletManager.getInstance();

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
    if (this.root) {
      const r = this.root;
      r.style.opacity = '0';
      const panel = r.querySelector('[data-bp-panel]') as HTMLElement | null;
      if (panel) panel.style.transform = 'scale(0.97)';
      setTimeout(() => {
        r.remove();
        if (this.root === r) this.root = null;
      }, 200);
    }
    this.tierTrack = null;
  }

  toggle(): void {
    this.isOpen ? this.close() : this.open();
  }

  // ──────────────────────────────────────────────────────────────
  //  Build
  // ──────────────────────────────────────────────────────────────

  private build(): void {
    this.injectStyles();

    const season = CURRENT_SEASON;
    const player = getPlayerBattlePass();
    const currentTier = this.computeCurrentTier(player.xp);
    const xpIntoTier = this.computeXpIntoTier(player.xp, currentTier);
    const nextTierXp = currentTier < season.tiers.length
      ? season.tiers[currentTier].xpRequired
      : season.tiers[season.tiers.length - 1].xpRequired;
    const prevTierXp = currentTier > 1
      ? season.tiers[currentTier - 2]?.xpRequired ?? 0
      : 0;

    // ── Overlay ──
    const root = document.createElement('div');
    root.id = 'bp-overlay';
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
    panel.setAttribute('data-bp-panel', '');
    panel.style.cssText = `
      width:min(95vw,1000px);height:min(85vh,500px);
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

    // Left: title + season end
    const titleWrap = document.createElement('div');
    titleWrap.style.cssText = 'display:flex;flex-direction:column;gap:2px;';

    const titleRow = document.createElement('div');
    titleRow.style.cssText = 'display:flex;align-items:center;gap:10px;';

    const titleIcon = document.createElement('span');
    titleIcon.textContent = '\u2694\uFE0F';
    titleIcon.style.cssText = 'font-size:20px;opacity:0.7;';
    titleRow.appendChild(titleIcon);

    const title = document.createElement('h2');
    title.textContent = `BATTLE PASS \u2014 ${season.name}`;
    title.style.cssText = `
      margin:0;font-size:18px;font-family:"Fredoka",sans-serif;font-weight:700;
      color:${C.gold};letter-spacing:2px;
    `;
    titleRow.appendChild(title);
    titleWrap.appendChild(titleRow);

    const endDate = document.createElement('span');
    const daysLeft = Math.max(0, Math.ceil((season.endDate - Date.now()) / (24 * 60 * 60 * 1000)));
    endDate.textContent = `${daysLeft} days remaining \u2022 Ends ${new Date(season.endDate).toLocaleDateString()}`;
    endDate.style.cssText = `
      font-size:11px;color:${C.textMuted};font-family:"Nunito",sans-serif;
      letter-spacing:0.3px;
    `;
    titleWrap.appendChild(endDate);

    header.appendChild(titleWrap);

    // Right: close
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
    header.appendChild(closeBtn);

    // ── Progress bar section ──
    const progressSection = document.createElement('div');
    progressSection.style.cssText = `
      padding:14px 22px 10px;border-bottom:1px solid ${C.divider};
      display:flex;align-items:center;gap:16px;flex-shrink:0;
    `;
    panel.appendChild(progressSection);

    // Tier badge
    const tierBadge = document.createElement('div');
    tierBadge.style.cssText = `
      background:linear-gradient(135deg, ${C.gold}, ${C.goldDark});
      color:${C.textDark};font-family:"Fredoka",sans-serif;font-weight:700;
      font-size:14px;padding:6px 14px;border-radius:10px;
      letter-spacing:1px;white-space:nowrap;
      box-shadow:0 2px 8px rgba(255,217,61,0.25);
    `;
    tierBadge.textContent = `TIER ${currentTier}`;
    progressSection.appendChild(tierBadge);

    // Progress bar container
    const progressWrap = document.createElement('div');
    progressWrap.style.cssText = 'flex:1;display:flex;flex-direction:column;gap:4px;';

    const progressBarOuter = document.createElement('div');
    progressBarOuter.style.cssText = `
      width:100%;height:14px;background:${C.sliderTrack};border-radius:7px;
      overflow:hidden;position:relative;
    `;

    const xpRange = nextTierXp - prevTierXp;
    const progressFraction = xpRange > 0 ? Math.min(1, xpIntoTier / xpRange) : 1;

    const progressBarFill = document.createElement('div');
    progressBarFill.style.cssText = `
      width:${progressFraction * 100}%;height:100%;
      background:linear-gradient(90deg, ${C.gold}, ${C.goldDark});
      border-radius:7px;
      transition:width 0.5s ease;
    `;
    progressBarOuter.appendChild(progressBarFill);
    progressWrap.appendChild(progressBarOuter);

    const progressLabel = document.createElement('div');
    progressLabel.style.cssText = `
      display:flex;justify-content:space-between;
      font-size:10px;color:${C.textMuted};font-family:"Nunito",sans-serif;
    `;
    const xpCurrent = document.createElement('span');
    xpCurrent.textContent = `${player.xp.toLocaleString()} XP`;
    const xpNext = document.createElement('span');
    xpNext.textContent = currentTier < season.tiers.length
      ? `${nextTierXp.toLocaleString()} XP to Tier ${currentTier + 1}`
      : 'MAX TIER';
    progressLabel.appendChild(xpCurrent);
    progressLabel.appendChild(xpNext);
    progressWrap.appendChild(progressLabel);

    progressSection.appendChild(progressWrap);

    // Premium status / buy button
    if (!player.premium) {
      const buyPremBtn = document.createElement('button');
      buyPremBtn.textContent = `\u{1F451} BUY PREMIUM \u2022 ${season.premiumPriceCrowns}`;
      buyPremBtn.style.cssText = `
        flex-shrink:0;padding:8px 16px;border-radius:10px;font-size:12px;font-weight:700;
        font-family:"Fredoka",sans-serif;cursor:pointer;transition:all 0.15s;
        background:linear-gradient(135deg, ${C.gold}, ${C.goldDark});
        border:none;color:${C.textDark};letter-spacing:0.5px;
        box-shadow:0 2px 8px rgba(255,217,61,0.25);
        white-space:nowrap;
      `;
      buyPremBtn.onmouseenter = () => {
        buyPremBtn.style.transform = 'translateY(-1px)';
        buyPremBtn.style.boxShadow = '0 4px 14px rgba(255,217,61,0.35)';
      };
      buyPremBtn.onmouseleave = () => {
        buyPremBtn.style.transform = 'translateY(0)';
        buyPremBtn.style.boxShadow = '0 2px 8px rgba(255,217,61,0.25)';
      };
      buyPremBtn.onclick = () => {
        console.log('Buy battle pass premium');
      };
      progressSection.appendChild(buyPremBtn);
    } else {
      const premBadge = document.createElement('div');
      premBadge.textContent = player.premiumPlus ? '\u2B50 PREMIUM+' : '\u2B50 PREMIUM';
      premBadge.style.cssText = `
        flex-shrink:0;padding:6px 14px;border-radius:10px;font-size:12px;font-weight:700;
        font-family:"Fredoka",sans-serif;
        background:rgba(255,217,61,0.12);border:1px solid ${C.goldDim};
        color:${C.gold};letter-spacing:0.5px;white-space:nowrap;
      `;
      progressSection.appendChild(premBadge);
    }

    // ── Track labels ──
    const trackLabels = document.createElement('div');
    trackLabels.style.cssText = `
      display:flex;align-items:stretch;padding:0;flex-shrink:0;
    `;

    // Left labels column (fixed)
    const labelsCol = document.createElement('div');
    labelsCol.style.cssText = `
      width:80px;flex-shrink:0;display:flex;flex-direction:column;
      border-right:1px solid ${C.divider};
    `;

    const premLabel = document.createElement('div');
    premLabel.textContent = 'PREMIUM';
    premLabel.style.cssText = `
      flex:1;display:flex;align-items:center;justify-content:center;
      font-size:10px;font-weight:700;color:${C.gold};
      font-family:"Fredoka",sans-serif;letter-spacing:1px;
      border-bottom:1px solid ${C.divider};
      padding:8px 4px;
    `;
    labelsCol.appendChild(premLabel);

    const freeLabel = document.createElement('div');
    freeLabel.textContent = 'FREE';
    freeLabel.style.cssText = `
      flex:1;display:flex;align-items:center;justify-content:center;
      font-size:10px;font-weight:700;color:${C.textSecondary};
      font-family:"Fredoka",sans-serif;letter-spacing:1px;
      padding:8px 4px;
    `;
    labelsCol.appendChild(freeLabel);

    trackLabels.appendChild(labelsCol);

    // ── Tier track (horizontal scroll) ──
    const tierTrack = document.createElement('div');
    tierTrack.className = 'bp-tier-scroll';
    tierTrack.style.cssText = `
      flex:1;overflow-x:auto;overflow-y:hidden;
      display:flex;flex-direction:row;
      min-width:0;
      -webkit-overflow-scrolling:touch;
    `;
    this.tierTrack = tierTrack;
    trackLabels.appendChild(tierTrack);

    panel.appendChild(trackLabels);

    // ── Build tier columns ──
    for (const tierDef of season.tiers) {
      const col = this.buildTierColumn(tierDef, currentTier, player);
      tierTrack.appendChild(col);
    }

    // ── Footer hint ──
    const footer = document.createElement('div');
    footer.style.cssText = `
      padding:8px 22px;border-top:1px solid ${C.divider};
      display:flex;justify-content:space-between;align-items:center;flex-shrink:0;
    `;
    const scrollHint = document.createElement('span');
    scrollHint.textContent = '\u2190 Scroll to browse tiers \u2192';
    scrollHint.style.cssText = `font-size:11px;color:${C.textMuted};font-family:"Nunito",sans-serif;`;
    footer.appendChild(scrollHint);

    const escHint = document.createElement('span');
    escHint.textContent = 'ESC to close';
    escHint.style.cssText = `font-size:11px;color:${C.textMuted};font-family:"Nunito",sans-serif;letter-spacing:0.5px;`;
    footer.appendChild(escHint);

    panel.appendChild(footer);

    // ── Mount ──
    document.body.appendChild(root);

    // Animate in
    requestAnimationFrame(() => {
      root.style.opacity = '1';
      panel.style.transform = 'scale(1)';
    });

    // Auto-scroll to current tier
    requestAnimationFrame(() => {
      this.scrollToCurrentTier(currentTier);
    });
  }

  // ──────────────────────────────────────────────────────────────
  //  Build a single tier column
  // ──────────────────────────────────────────────────────────────

  private buildTierColumn(
    tierDef: BattlePassTier,
    currentTier: number,
    player: PlayerBattlePass,
  ): HTMLDivElement {
    const tier = tierDef.tier;
    const isUnlocked = tier <= currentTier;
    const isCurrent = tier === currentTier;
    const isFuture = tier > currentTier;

    const freeClaimed = !!player.claimedFree[tier];
    const premClaimed = !!player.claimedPremium[tier];
    const hasFree = !!tierDef.freeReward;
    const hasPrem = !!tierDef.premiumReward;
    const freeClaimable = isUnlocked && hasFree && !freeClaimed;
    const premClaimable = isUnlocked && hasPrem && !premClaimed && player.premium;

    // Column
    const col = document.createElement('div');
    col.dataset.tier = String(tier);
    col.style.cssText = `
      flex:0 0 80px;width:80px;
      display:flex;flex-direction:column;
      border-right:1px solid ${C.divider};
      position:relative;
      ${isFuture ? 'opacity:0.45;' : ''}
    `;
    if (isCurrent) {
      col.style.boxShadow = `inset 0 0 0 2px ${C.gold}`;
      col.style.background = 'rgba(255,217,61,0.04)';
    }

    // ── Tier number strip ──
    const tierNum = document.createElement('div');
    tierNum.textContent = String(tier);
    tierNum.style.cssText = `
      text-align:center;font-size:10px;font-weight:700;
      color:${isCurrent ? C.gold : C.textMuted};
      font-family:"Fredoka",sans-serif;
      padding:3px 0;
      background:${isCurrent ? 'rgba(255,217,61,0.08)' : 'transparent'};
      border-bottom:1px solid ${C.divider};
    `;
    col.appendChild(tierNum);

    // ── Premium reward cell (top) ──
    const premCell = this.buildRewardCell(
      tierDef.premiumReward,
      isUnlocked,
      premClaimed,
      premClaimable,
      true,
      tier,
    );
    col.appendChild(premCell);

    // ── Divider ──
    const divLine = document.createElement('div');
    divLine.style.cssText = `
      height:1px;background:${C.divider};flex-shrink:0;
    `;
    col.appendChild(divLine);

    // ── Free reward cell (bottom) ──
    const freeCell = this.buildRewardCell(
      tierDef.freeReward,
      isUnlocked,
      freeClaimed,
      freeClaimable,
      false,
      tier,
    );
    col.appendChild(freeCell);

    return col;
  }

  // ──────────────────────────────────────────────────────────────
  //  Build a single reward cell
  // ──────────────────────────────────────────────────────────────

  private buildRewardCell(
    reward: BattlePassReward | undefined,
    isUnlocked: boolean,
    isClaimed: boolean,
    isClaimable: boolean,
    isPremium: boolean,
    tier: number,
  ): HTMLDivElement {
    const cell = document.createElement('div');
    cell.style.cssText = `
      flex:1;display:flex;flex-direction:column;
      align-items:center;justify-content:center;
      padding:6px 4px;gap:3px;
      min-height:0;
      position:relative;
    `;

    if (!reward) {
      // Empty tier
      const dash = document.createElement('span');
      dash.textContent = '\u2014';
      dash.style.cssText = `font-size:14px;color:${C.textMuted};opacity:0.3;`;
      cell.appendChild(dash);
      return cell;
    }

    // Reward icon
    const icon = document.createElement('div');
    icon.textContent = rewardEmoji(reward);
    icon.style.cssText = `
      font-size:20px;line-height:1;
      ${isPremium && !isUnlocked ? 'filter:grayscale(1) brightness(0.5);' : ''}
    `;
    cell.appendChild(icon);

    // Reward label
    const label = document.createElement('div');
    label.textContent = rewardLabel(reward);
    label.style.cssText = `
      font-size:9px;font-weight:700;
      color:${isPremium ? C.gold : C.textPrimary};
      font-family:"Nunito",sans-serif;
      text-align:center;white-space:nowrap;
      overflow:hidden;text-overflow:ellipsis;
      max-width:72px;
    `;
    cell.appendChild(label);

    // Claimed checkmark
    if (isClaimed) {
      const check = document.createElement('div');
      check.textContent = '\u2713';
      check.style.cssText = `
        font-size:11px;font-weight:700;color:${C.green};
        background:rgba(90,154,78,0.15);
        border-radius:50%;width:18px;height:18px;
        display:flex;align-items:center;justify-content:center;
      `;
      cell.appendChild(check);
    }

    // Claim button
    if (isClaimable) {
      const claimBtn = document.createElement('button');
      claimBtn.textContent = 'CLAIM';
      claimBtn.style.cssText = `
        padding:2px 10px;border-radius:6px;font-size:9px;font-weight:700;
        font-family:"Fredoka",sans-serif;cursor:pointer;transition:all 0.15s;
        background:${C.green};border:none;color:#fff;
        letter-spacing:0.5px;
      `;
      claimBtn.onmouseenter = () => {
        claimBtn.style.background = C.greenDark;
        claimBtn.style.transform = 'scale(1.05)';
      };
      claimBtn.onmouseleave = () => {
        claimBtn.style.background = C.green;
        claimBtn.style.transform = 'scale(1)';
      };
      claimBtn.onclick = (e) => {
        e.stopPropagation();
        console.log(`Claim ${isPremium ? 'premium' : 'free'} reward at tier ${tier}`);
      };
      cell.appendChild(claimBtn);
    }

    // Lock icon for premium rewards on non-premium players
    if (isPremium && !isUnlocked) {
      const lock = document.createElement('div');
      lock.textContent = '\uD83D\uDD12';
      lock.style.cssText = `
        position:absolute;top:4px;right:4px;font-size:10px;opacity:0.5;
      `;
      cell.appendChild(lock);
    }

    return cell;
  }

  // ──────────────────────────────────────────────────────────────
  //  XP / tier helpers
  // ──────────────────────────────────────────────────────────────

  private computeCurrentTier(xp: number): number {
    const tiers = CURRENT_SEASON.tiers;
    let tier = 0;
    for (const t of tiers) {
      if (xp >= t.xpRequired) {
        tier = t.tier;
      } else {
        break;
      }
    }
    return tier;
  }

  private computeXpIntoTier(xp: number, currentTier: number): number {
    if (currentTier <= 0) return xp;
    const prevXp = currentTier >= 2
      ? CURRENT_SEASON.tiers[currentTier - 2].xpRequired
      : 0;
    return xp - prevXp;
  }

  // ──────────────────────────────────────────────────────────────
  //  Scroll to current tier
  // ──────────────────────────────────────────────────────────────

  private scrollToCurrentTier(currentTier: number): void {
    if (!this.tierTrack) return;
    const tierCol = this.tierTrack.querySelector(`[data-tier="${currentTier}"]`) as HTMLElement | null;
    if (tierCol) {
      // Center the current tier in the scroll area
      const trackWidth = this.tierTrack.clientWidth;
      const colLeft = tierCol.offsetLeft;
      const colWidth = tierCol.offsetWidth;
      const scrollTarget = colLeft - (trackWidth / 2) + (colWidth / 2);
      this.tierTrack.scrollTo({ left: Math.max(0, scrollTarget), behavior: 'smooth' });
    }
  }

  // ──────────────────────────────────────────────────────────────
  //  Inject scoped styles
  // ──────────────────────────────────────────────────────────────

  private injectStyles(): void {
    if (document.getElementById('bp-panel-styles')) return;
    const style = document.createElement('style');
    style.id = 'bp-panel-styles';
    style.textContent = `
      /* Horizontal scrollbar for tier track */
      #bp-overlay .bp-tier-scroll::-webkit-scrollbar { height:6px; }
      #bp-overlay .bp-tier-scroll::-webkit-scrollbar-track { background:transparent; }
      #bp-overlay .bp-tier-scroll::-webkit-scrollbar-thumb {
        background:rgba(139,115,85,0.35);border-radius:3px;
      }
      #bp-overlay .bp-tier-scroll::-webkit-scrollbar-thumb:hover {
        background:rgba(139,115,85,0.55);
      }
      /* Firefox */
      #bp-overlay .bp-tier-scroll {
        scrollbar-width:thin;
        scrollbar-color:rgba(139,115,85,0.35) transparent;
      }
    `;
    document.head.appendChild(style);
  }
}
