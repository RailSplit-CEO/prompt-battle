// ─── Match Invite Popup — toast notification for incoming match invites ──
// Slides down from top-center, auto-dismisses after 60s with progress bar.

import { C } from './UIColors';
import { createIconElement } from './FriendsPanel';

// ─── Interfaces ─────────────────────────────────────────────────────
export interface InvitePopupCallbacks {
  onAccept: (inviteId: string) => Promise<string>;  // returns gameId
  onDecline: (inviteId: string) => Promise<void>;
}

// ─── Popup ──────────────────────────────────────────────────────────
export class MatchInvitePopup {
  private root: HTMLDivElement | null = null;
  private callbacks: InvitePopupCallbacks;
  private currentInviteId: string | null = null;
  private timeoutId: ReturnType<typeof setTimeout> | null = null;
  private animFrameId: number | null = null;
  private progressBar: HTMLDivElement | null = null;
  private startTime: number = 0;
  private readonly TIMEOUT_MS = 60000;

  constructor(callbacks: InvitePopupCallbacks) {
    this.callbacks = callbacks;
  }

  show(invite: { inviteId: string; fromUsername: string; fromIcon: string }): void {
    // Dismiss any existing popup first
    if (this.root) {
      this.dismissImmediate();
    }

    this.injectStyles();
    this.currentInviteId = invite.inviteId;

    const root = document.createElement('div');
    root.id = 'match-invite-popup';
    root.style.cssText = `
      position:fixed;top:20px;left:50%;
      transform:translateX(-50%) translateY(-100%);
      z-index:9998;
      max-width:380px;width:max-content;
      background:${C.panelBg};
      border:2px solid ${C.gold};border-radius:12px;
      padding:16px 20px;
      box-shadow:0 8px 32px rgba(0,0,0,0.5);
      font-family:"Nunito",sans-serif;
      opacity:0;
      transition:transform 0.35s cubic-bezier(0.16,1,0.3,1), opacity 0.25s ease;
      overflow:hidden;
    `;
    this.root = root;

    // ── Content row: icon + text ──
    const contentRow = document.createElement('div');
    contentRow.style.cssText = `
      display:flex;align-items:center;gap:10px;margin-bottom:12px;
    `;

    const icon = createIconElement(invite.fromIcon, 32);
    contentRow.appendChild(icon);

    const textWrap = document.createElement('div');
    textWrap.style.cssText = 'display:flex;flex-wrap:wrap;align-items:baseline;gap:4px;';

    const nameEl = document.createElement('span');
    nameEl.textContent = invite.fromUsername;
    nameEl.style.cssText = `
      font-size:14px;font-weight:700;color:${C.textPrimary};
      font-family:"Nunito",sans-serif;
    `;
    textWrap.appendChild(nameEl);

    const msgEl = document.createElement('span');
    msgEl.textContent = 'invited you to a match!';
    msgEl.style.cssText = `
      font-size:13px;color:${C.textSecondary};
      font-family:"Nunito",sans-serif;
    `;
    textWrap.appendChild(msgEl);

    contentRow.appendChild(textWrap);
    root.appendChild(contentRow);

    // ── Button row ──
    const btnRow = document.createElement('div');
    btnRow.style.cssText = 'display:flex;gap:8px;';

    const acceptBtn = document.createElement('button');
    acceptBtn.textContent = 'Accept';
    acceptBtn.style.cssText = `
      flex:1;background:${C.green};color:#fff;border:none;border-radius:8px;
      font-size:13px;font-weight:700;font-family:"Nunito",sans-serif;
      padding:8px 16px;cursor:pointer;transition:all 0.15s;
    `;
    acceptBtn.onmouseenter = () => { acceptBtn.style.background = C.greenDark; };
    acceptBtn.onmouseleave = () => { acceptBtn.style.background = C.green; };
    acceptBtn.onclick = async () => {
      acceptBtn.textContent = 'Joining...';
      acceptBtn.style.opacity = '0.6';
      acceptBtn.style.pointerEvents = 'none';
      declineBtn.style.pointerEvents = 'none';
      this.stopTimer();
      try {
        await this.callbacks.onAccept(invite.inviteId);
      } catch {
        // If accept fails, just dismiss
      }
      this.dismissAnimated();
    };
    btnRow.appendChild(acceptBtn);

    const declineBtn = document.createElement('button');
    declineBtn.textContent = 'Decline';
    declineBtn.style.cssText = `
      flex:1;background:transparent;color:${C.red};
      border:1px solid ${C.red};border-radius:8px;
      font-size:13px;font-weight:700;font-family:"Nunito",sans-serif;
      padding:8px 16px;cursor:pointer;transition:all 0.15s;
    `;
    declineBtn.onmouseenter = () => {
      declineBtn.style.background = 'rgba(255,107,107,0.12)';
    };
    declineBtn.onmouseleave = () => {
      declineBtn.style.background = 'transparent';
    };
    declineBtn.onclick = async () => {
      declineBtn.textContent = '...';
      declineBtn.style.opacity = '0.6';
      declineBtn.style.pointerEvents = 'none';
      acceptBtn.style.pointerEvents = 'none';
      this.stopTimer();
      try {
        await this.callbacks.onDecline(invite.inviteId);
      } catch {
        // Ignore
      }
      this.dismissAnimated();
    };
    btnRow.appendChild(declineBtn);

    root.appendChild(btnRow);

    // ── Progress bar ──
    const progressTrack = document.createElement('div');
    progressTrack.style.cssText = `
      position:absolute;bottom:0;left:0;right:0;height:3px;
      background:rgba(255,217,61,0.1);
    `;

    const progressFill = document.createElement('div');
    progressFill.style.cssText = `
      height:100%;width:100%;background:${C.gold};
      border-radius:0 0 0 10px;
      transition:none;
    `;
    progressTrack.appendChild(progressFill);
    root.appendChild(progressTrack);
    this.progressBar = progressFill;

    document.body.appendChild(root);

    // Slide in
    requestAnimationFrame(() => {
      root.style.opacity = '1';
      root.style.transform = 'translateX(-50%) translateY(0)';
    });

    // Start auto-dismiss timer
    this.startTime = performance.now();
    this.startProgressAnimation();

    this.timeoutId = setTimeout(() => {
      this.stopTimer();
      this.callbacks.onDecline(invite.inviteId).catch(() => {});
      this.dismissAnimated();
    }, this.TIMEOUT_MS);
  }

  dismiss(): void {
    this.dismissAnimated();
  }

  destroy(): void {
    this.stopTimer();
    this.dismissImmediate();
  }

  // ────────────────────────────────────────────────────────────
  private startProgressAnimation(): void {
    const tick = () => {
      if (!this.progressBar) return;
      const elapsed = performance.now() - this.startTime;
      const remaining = Math.max(0, 1 - elapsed / this.TIMEOUT_MS);
      this.progressBar.style.width = `${remaining * 100}%`;
      if (remaining > 0) {
        this.animFrameId = requestAnimationFrame(tick);
      }
    };
    this.animFrameId = requestAnimationFrame(tick);
  }

  private stopTimer(): void {
    if (this.timeoutId !== null) {
      clearTimeout(this.timeoutId);
      this.timeoutId = null;
    }
    if (this.animFrameId !== null) {
      cancelAnimationFrame(this.animFrameId);
      this.animFrameId = null;
    }
  }

  private dismissAnimated(): void {
    this.stopTimer();
    if (this.root) {
      const root = this.root;
      root.style.opacity = '0';
      root.style.transform = 'translateX(-50%) translateY(-100%)';
      setTimeout(() => {
        root.remove();
        if (this.root === root) {
          this.root = null;
          this.currentInviteId = null;
          this.progressBar = null;
        }
      }, 350);
    }
  }

  private dismissImmediate(): void {
    this.stopTimer();
    if (this.root) {
      this.root.remove();
      this.root = null;
      this.currentInviteId = null;
      this.progressBar = null;
    }
  }

  private injectStyles(): void {
    if (document.getElementById('match-invite-popup-styles')) return;
    const style = document.createElement('style');
    style.id = 'match-invite-popup-styles';
    style.textContent = `
      #match-invite-popup button:active {
        transform: scale(0.96);
      }
    `;
    document.head.appendChild(style);
  }
}
