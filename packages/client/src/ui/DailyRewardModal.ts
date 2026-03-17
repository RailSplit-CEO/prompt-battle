// --- DailyRewardModal -- daily login reward + streak display -----------
// Shown on login to grant daily glory and display the user's login streak.
// Follows the same glassmorphism pattern as ItchRedeemModal.

import { C } from './UIColors';
import { WalletManager } from '../store/WalletManager';
import { PaymentService } from '../store/PaymentService';

export class DailyRewardModal {
  private overlay: HTMLDivElement | null = null;
  private autoCloseTimer: ReturnType<typeof setTimeout> | null = null;
  private escHandler: ((e: KeyboardEvent) => void) | null = null;

  async show(): Promise<void> {
    // Call glory grant for daily login
    const ps = PaymentService.getInstance();
    const result = await ps.grantGlory('daily_login');

    if (result.gloryGranted === 0) return; // already claimed today, don't show

    const streak = result.breakdown?.login_streak ?? 1;
    const streakBonus = result.breakdown?.streak_bonus ?? 0;
    const gloryGranted = result.gloryGranted;

    // -- Inject keyframes ------------------------------------------------
    if (!document.getElementById('daily-reward-modal-styles')) {
      const style = document.createElement('style');
      style.id = 'daily-reward-modal-styles';
      style.textContent = `
        @keyframes dr-panel-in {
          from { opacity:0; transform:scale(0.92) translateY(20px); }
          to   { opacity:1; transform:scale(1)    translateY(0); }
        }
        @keyframes dr-glory-glow {
          0%, 100% { text-shadow:0 0 8px rgba(69,230,176,0.4), 0 0 24px rgba(69,230,176,0.15); }
          50%      { text-shadow:0 0 16px rgba(69,230,176,0.6), 0 0 40px rgba(69,230,176,0.3); }
        }
        @keyframes dr-streak-pulse {
          0%, 100% { transform:scale(1); }
          50%      { transform:scale(1.06); }
        }
        @keyframes dr-bonus-shimmer {
          0%, 100% { text-shadow:0 0 6px rgba(255,217,61,0.3); }
          50%      { text-shadow:0 0 18px rgba(255,217,61,0.6), 0 0 36px rgba(255,217,61,0.25); }
        }
      `;
      document.head.appendChild(style);
    }

    // -- 1. Overlay ------------------------------------------------------
    const overlay = document.createElement('div');
    this.overlay = overlay;
    overlay.style.cssText = `
      position:fixed;inset:0;z-index:9999;
      background:${C.overlay};
      backdrop-filter:${C.panelBlur};-webkit-backdrop-filter:${C.panelBlur};
      display:flex;align-items:center;justify-content:center;
      font-family:'Nunito',sans-serif;
      opacity:0;transition:opacity 0.35s ease;
    `;

    // Close on backdrop click
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) this.close();
    });

    // Close on ESC
    this.escHandler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') this.close();
    };
    document.addEventListener('keydown', this.escHandler);

    // -- 2. Panel --------------------------------------------------------
    const panel = document.createElement('div');
    panel.style.cssText = `
      position:relative;
      width:min(360px, 90vw);
      background:${C.panelBg};
      border:2px solid ${C.panelBorder};
      border-radius:20px;
      padding:32px 28px 24px;
      box-shadow:${C.panelShadow};
      backdrop-filter:${C.panelBlur};-webkit-backdrop-filter:${C.panelBlur};
      display:flex;flex-direction:column;align-items:center;
      animation:dr-panel-in 0.5s ease-out;
    `;

    // Decorative gold line at top
    const topBar = document.createElement('div');
    topBar.style.cssText = `
      position:absolute;top:-1px;left:15%;right:15%;height:3px;
      background:linear-gradient(90deg, transparent, ${C.gold}, transparent);
      border-radius:0 0 4px 4px;
    `;
    panel.appendChild(topBar);

    // -- 3. Header -------------------------------------------------------
    const header = document.createElement('div');
    header.textContent = 'Daily Reward!';
    header.style.cssText = `
      font-family:'Fredoka',sans-serif;font-size:26px;font-weight:bold;
      color:${C.gold};text-align:center;margin-bottom:6px;
      text-shadow:0 2px 12px rgba(255,217,61,0.25);
    `;
    panel.appendChild(header);

    // -- 4. Streak display -----------------------------------------------
    const streakRow = document.createElement('div');
    streakRow.style.cssText = `
      display:flex;align-items:center;justify-content:center;gap:8px;
      margin-bottom:20px;
    `;

    const fireIcon = document.createElement('span');
    fireIcon.textContent = '\u{1F525}';
    fireIcon.style.cssText = `
      font-size:28px;
      animation:dr-streak-pulse 2s ease-in-out infinite;
    `;
    streakRow.appendChild(fireIcon);

    const streakText = document.createElement('span');
    streakText.textContent = `Day ${streak}`;
    streakText.style.cssText = `
      font-family:'Fredoka',sans-serif;font-size:24px;font-weight:bold;
      color:${C.textH1};letter-spacing:1px;
    `;
    streakRow.appendChild(streakText);

    panel.appendChild(streakRow);

    // -- 5. Divider ------------------------------------------------------
    const dividerTop = document.createElement('div');
    dividerTop.style.cssText = `
      width:100%;height:1px;background:${C.divider};margin-bottom:20px;
    `;
    panel.appendChild(dividerTop);

    // -- 6. Glory reward -------------------------------------------------
    const rewardContainer = document.createElement('div');
    rewardContainer.style.cssText = `
      display:flex;flex-direction:column;align-items:center;gap:4px;
      margin-bottom:16px;
    `;

    const gloryAmount = document.createElement('div');
    gloryAmount.textContent = `+${gloryGranted} \u2B50 Glory`;
    gloryAmount.style.cssText = `
      font-family:'Fredoka',sans-serif;font-size:32px;font-weight:bold;
      color:${C.teal};letter-spacing:1px;
      animation:dr-glory-glow 2.5s ease-in-out infinite;
    `;
    rewardContainer.appendChild(gloryAmount);

    // Current balance hint
    const wm = WalletManager.getInstance();
    const balanceHint = document.createElement('div');
    balanceHint.textContent = `Balance: ${wm.glory.toLocaleString()} Glory`;
    balanceHint.style.cssText = `
      font-size:12px;color:${C.textMuted};letter-spacing:0.5px;
    `;
    rewardContainer.appendChild(balanceHint);

    panel.appendChild(rewardContainer);

    // -- 7. Streak bonus (if present) ------------------------------------
    if (streakBonus > 0) {
      const bonusContainer = document.createElement('div');
      bonusContainer.style.cssText = `
        display:flex;align-items:center;justify-content:center;gap:6px;
        padding:10px 18px;border-radius:12px;
        background:rgba(255,217,61,0.08);
        border:1px solid rgba(255,217,61,0.2);
        margin-bottom:16px;
      `;

      const giftIcon = document.createElement('span');
      giftIcon.textContent = '\u{1F381}';
      giftIcon.style.cssText = 'font-size:18px;';
      bonusContainer.appendChild(giftIcon);

      const bonusText = document.createElement('span');
      bonusText.textContent = `7-Day Streak Bonus: +${streakBonus} Glory!`;
      bonusText.style.cssText = `
        font-family:'Fredoka',sans-serif;font-size:14px;font-weight:bold;
        color:${C.gold};
        animation:dr-bonus-shimmer 2s ease-in-out infinite;
      `;
      bonusContainer.appendChild(bonusText);

      panel.appendChild(bonusContainer);
    }

    // -- 8. Divider ------------------------------------------------------
    const dividerBottom = document.createElement('div');
    dividerBottom.style.cssText = `
      width:100%;height:1px;background:${C.divider};margin-bottom:18px;
    `;
    panel.appendChild(dividerBottom);

    // -- 9. Claim button -------------------------------------------------
    const claimBtn = document.createElement('button');
    claimBtn.textContent = 'Claim';
    claimBtn.style.cssText = `
      width:100%;padding:12px;border:none;border-radius:10px;
      background:${C.gold};color:${C.textDark};
      font-family:'Fredoka',sans-serif;font-size:16px;font-weight:bold;
      cursor:pointer;transition:filter 0.15s, transform 0.1s;
      box-shadow:0 2px 12px rgba(255,217,61,0.25);
    `;
    claimBtn.onmouseenter = () => { claimBtn.style.filter = 'brightness(1.12)'; };
    claimBtn.onmouseleave = () => { claimBtn.style.filter = 'brightness(1)'; };
    claimBtn.onmousedown = () => { claimBtn.style.transform = 'scale(0.97)'; };
    claimBtn.onmouseup = () => { claimBtn.style.transform = 'scale(1)'; };
    claimBtn.onclick = () => this.close();
    panel.appendChild(claimBtn);

    // -- 10. Hint --------------------------------------------------------
    const hint = document.createElement('div');
    hint.textContent = 'ESC to dismiss';
    hint.style.cssText = `
      font-size:10px;color:${C.textMuted};letter-spacing:0.5px;margin-top:10px;
    `;
    panel.appendChild(hint);

    // -- Mount and animate in --------------------------------------------
    overlay.appendChild(panel);
    document.body.appendChild(overlay);

    requestAnimationFrame(() => {
      requestAnimationFrame(() => { overlay.style.opacity = '1'; });
    });

    // Auto-close after 5 seconds
    this.autoCloseTimer = setTimeout(() => this.close(), 5000);
  }

  close(): void {
    if (this.autoCloseTimer) {
      clearTimeout(this.autoCloseTimer);
      this.autoCloseTimer = null;
    }
    if (this.escHandler) {
      document.removeEventListener('keydown', this.escHandler);
      this.escHandler = null;
    }
    if (this.overlay) {
      this.overlay.style.opacity = '0';
      const el = this.overlay;
      setTimeout(() => el.remove(), 250);
      this.overlay = null;
    }
  }
}
