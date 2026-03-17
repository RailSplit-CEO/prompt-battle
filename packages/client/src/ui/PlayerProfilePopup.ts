// ─── Player Profile Popup — centered modal showing a player's public profile ───
// Dark glassmorphism popup, ESC / backdrop-click to close.

import { C } from './UIColors';
import { AuthManager } from '../auth/AuthManager';
import { createIconElement, renderBadgeHTML, renderTitleHTML, getFrameStyle } from './FriendsPanel';
import { getDatabase, ref, get } from 'firebase/database';
import { getFirebaseApp } from '../auth/firebaseApp';

interface ProfileData {
  uid: string;
  username: string;
  icon: string;
  provider: string;
  createdAt: number;
  lastSeen: number;
  online: boolean;
  equipped?: {
    profileBadge?: string;
    profileTitle?: string;
    profileBorder?: string;
  };
}

interface ProfileStats {
  wins: number;
  losses: number;
  hidden: boolean;
}

export class PlayerProfilePopup {
  private overlay: HTMLDivElement | null = null;
  private escHandler: ((e: KeyboardEvent) => void) | null = null;

  async show(
    targetUid: string,
    options?: {
      isFriend?: boolean;
      onChallenge?: () => void;
      onRemove?: () => void;
    },
  ): Promise<void> {
    // Close any existing popup first
    this.close();

    const db = getDatabase(getFirebaseApp());

    // Load data in parallel
    const [profileSnap, levelSnap, equippedSnap, stats] = await Promise.all([
      get(ref(db, `users/${targetUid}`)),
      get(ref(db, `users/${targetUid}/playerLevel`)),
      get(ref(db, `users/${targetUid}/equipped`)),
      this.loadStats(db, targetUid),
    ]);

    if (!profileSnap.exists()) {
      // Player not found — show a brief error popup
      this.showError('Player not found');
      return;
    }

    const profile: ProfileData = {
      ...profileSnap.val(),
      equipped: equippedSnap.exists() ? equippedSnap.val() : undefined,
    };

    const playerLevel = levelSnap.exists() ? (levelSnap.val().level ?? 1) : 1;

    this.build(targetUid, profile, playerLevel, stats, options);
  }

  close(): void {
    if (this.escHandler) {
      window.removeEventListener('keydown', this.escHandler);
      this.escHandler = null;
    }
    if (this.overlay) {
      const overlay = this.overlay;
      overlay.style.opacity = '0';
      const panel = overlay.querySelector('[data-profile-panel]') as HTMLElement | null;
      if (panel) panel.style.transform = 'scale(0.95) translateY(8px)';
      setTimeout(() => {
        overlay.remove();
      }, 200);
      this.overlay = null;
    }
  }

  private async loadStats(
    db: ReturnType<typeof getDatabase>,
    targetUid: string,
  ): Promise<ProfileStats> {
    try {
      const historySnap = await get(ref(db, `matchHistory/${targetUid}`));
      if (!historySnap.exists()) {
        return { wins: 0, losses: 0, hidden: false };
      }
      let wins = 0;
      let losses = 0;
      historySnap.forEach((child) => {
        const entry = child.val();
        if (entry?.result === 'win') wins++;
        else if (entry?.result === 'loss') losses++;
      });
      return { wins, losses, hidden: false };
    } catch {
      // Permission denied or other error — stats are hidden
      return { wins: 0, losses: 0, hidden: true };
    }
  }

  private build(
    targetUid: string,
    profile: ProfileData,
    playerLevel: number,
    stats: ProfileStats,
    options?: {
      isFriend?: boolean;
      onChallenge?: () => void;
      onRemove?: () => void;
    },
  ): void {
    this.injectStyles();

    // Overlay
    const overlay = document.createElement('div');
    overlay.id = 'player-profile-overlay';
    overlay.style.cssText = `
      position:fixed;inset:0;z-index:9999;
      background:${C.overlay};backdrop-filter:${C.panelBlur};-webkit-backdrop-filter:${C.panelBlur};
      display:flex;align-items:center;justify-content:center;
      opacity:0;transition:opacity 0.25s ease;
    `;
    this.overlay = overlay;

    overlay.addEventListener('mousedown', (e) => {
      if (e.target === overlay) this.close();
    });

    this.escHandler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') this.close();
    };
    window.addEventListener('keydown', this.escHandler);

    // Panel
    const panel = document.createElement('div');
    panel.setAttribute('data-profile-panel', '');
    panel.style.cssText = `
      width:min(360px,90vw);
      background:${C.panelBg};
      border:2px solid ${C.panelBorder};border-radius:16px;
      box-shadow:${C.panelShadow};
      display:flex;flex-direction:column;align-items:center;
      padding:24px 28px 20px;
      font-family:"Nunito",sans-serif;
      transform:scale(0.95) translateY(8px);
      transition:transform 0.3s cubic-bezier(0.16,1,0.3,1);
    `;
    overlay.appendChild(panel);

    // ── Header title ──
    const title = document.createElement('h2');
    title.textContent = 'PLAYER PROFILE';
    title.style.cssText = `
      margin:0 0 16px;font-size:16px;font-family:"Fredoka",sans-serif;
      font-weight:700;color:${C.gold};letter-spacing:2.5px;
      text-align:center;
    `;
    panel.appendChild(title);

    // ── Avatar with frame ──
    const avatarContainer = document.createElement('div');
    avatarContainer.style.cssText = 'position:relative;margin-bottom:12px;';

    const avatar = createIconElement(
      profile.icon || 'default',
      80,
      profile.equipped?.profileBorder,
    );
    avatarContainer.appendChild(avatar);
    panel.appendChild(avatarContainer);

    // ── Username + badge ──
    const nameRow = document.createElement('div');
    nameRow.style.cssText = 'display:flex;align-items:center;justify-content:center;gap:2px;';

    const nameEl = document.createElement('span');
    nameEl.textContent = profile.username;
    nameEl.style.cssText = `
      font-size:18px;font-weight:700;color:${C.textH1};
      font-family:"Fredoka",sans-serif;
    `;
    nameRow.appendChild(nameEl);

    const badgeHTML = renderBadgeHTML(profile.equipped?.profileBadge);
    if (badgeHTML) {
      const badgeSpan = document.createElement('span');
      badgeSpan.innerHTML = badgeHTML;
      nameRow.appendChild(badgeSpan);
    }

    panel.appendChild(nameRow);

    // ── Title ──
    const titleHTML = renderTitleHTML(profile.equipped?.profileTitle);
    if (titleHTML) {
      const titleEl = document.createElement('div');
      titleEl.innerHTML = titleHTML;
      titleEl.style.cssText = 'text-align:center;margin-top:2px;';
      panel.appendChild(titleEl);
    }

    // ── Level badge ──
    const levelBadge = document.createElement('div');
    levelBadge.style.cssText = `
      display:inline-flex;align-items:center;justify-content:center;
      background:linear-gradient(135deg, ${C.gold}, ${C.goldDark});
      color:${C.textDark};font-family:"Fredoka",sans-serif;
      font-size:12px;font-weight:700;
      min-width:56px;height:24px;border-radius:12px;
      padding:0 10px;margin-top:10px;
      box-shadow:0 2px 8px rgba(255,217,61,0.25);
    `;
    levelBadge.textContent = `Level ${playerLevel}`;
    panel.appendChild(levelBadge);

    // ── Divider ──
    panel.appendChild(this.makeDivider());

    // ── Stats row ──
    if (stats.hidden) {
      const hidden = document.createElement('div');
      hidden.textContent = 'Stats hidden';
      hidden.style.cssText = `
        font-size:13px;color:${C.textMuted};font-style:italic;
        font-family:"Nunito",sans-serif;margin:4px 0;
      `;
      panel.appendChild(hidden);
    } else {
      const statsRow = document.createElement('div');
      statsRow.style.cssText = `
        display:flex;align-items:center;justify-content:center;
        gap:12px;margin:4px 0;
      `;

      const totalGames = stats.wins + stats.losses;
      const winRate = totalGames > 0 ? Math.round((stats.wins / totalGames) * 100) : 0;

      const statItems: { label: string; value: string; color: string }[] = [
        { label: 'Wins', value: String(stats.wins), color: C.teal },
        { label: 'Losses', value: String(stats.losses), color: C.red },
        { label: 'Win Rate', value: `${winRate}%`, color: C.gold },
      ];

      for (let i = 0; i < statItems.length; i++) {
        const item = statItems[i];
        const statEl = document.createElement('div');
        statEl.style.cssText = 'display:flex;flex-direction:column;align-items:center;';

        const val = document.createElement('span');
        val.textContent = item.value;
        val.style.cssText = `
          font-size:16px;font-weight:700;color:${item.color};
          font-family:"Fredoka",sans-serif;
        `;
        statEl.appendChild(val);

        const label = document.createElement('span');
        label.textContent = item.label;
        label.style.cssText = `
          font-size:10px;color:${C.textMuted};
          font-family:"Nunito",sans-serif;text-transform:uppercase;
          letter-spacing:0.5px;
        `;
        statEl.appendChild(label);

        statsRow.appendChild(statEl);

        // Separator between stats
        if (i < statItems.length - 1) {
          const sep = document.createElement('span');
          sep.textContent = '|';
          sep.style.cssText = `font-size:14px;color:${C.divider};margin:0 2px;`;
          statsRow.appendChild(sep);
        }
      }

      panel.appendChild(statsRow);
    }

    // ── Member since ──
    const memberSince = document.createElement('div');
    const date = new Date(profile.createdAt);
    const dateStr = date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
    memberSince.textContent = `Member since ${dateStr}`;
    memberSince.style.cssText = `
      font-size:11px;color:${C.textMuted};font-family:"Nunito",sans-serif;
      margin-top:6px;
    `;
    panel.appendChild(memberSince);

    // ── Divider ──
    panel.appendChild(this.makeDivider());

    // ── Action buttons ──
    const actions = document.createElement('div');
    actions.style.cssText = `
      display:flex;flex-direction:column;align-items:center;
      gap:8px;width:100%;margin-top:4px;
    `;

    const isFriend = options?.isFriend ?? false;
    const isMe = AuthManager.getInstance().currentUser?.uid === targetUid;

    // Challenge button — only if online and not self
    if (profile.online && !isMe) {
      const challengeBtn = document.createElement('button');
      challengeBtn.textContent = 'Challenge';
      challengeBtn.style.cssText = `
        width:100%;padding:10px 0;border:none;border-radius:10px;
        background:linear-gradient(135deg, ${C.green}, ${C.greenDark});
        color:#fff;font-family:"Fredoka",sans-serif;font-size:14px;
        font-weight:700;cursor:pointer;transition:all 0.15s;
        letter-spacing:0.5px;
      `;
      challengeBtn.onmouseenter = () => {
        challengeBtn.style.filter = 'brightness(1.15)';
      };
      challengeBtn.onmouseleave = () => {
        challengeBtn.style.filter = 'none';
      };
      challengeBtn.onclick = async () => {
        (window as any).__menuPlaySfx?.('button_click', 0.3);
        challengeBtn.textContent = 'Sending...';
        challengeBtn.style.pointerEvents = 'none';
        challengeBtn.style.opacity = '0.6';
        try {
          if (options?.onChallenge) {
            options.onChallenge();
          } else {
            await AuthManager.getInstance().sendInvite(targetUid);
          }
          challengeBtn.textContent = 'Invite Sent!';
        } catch {
          challengeBtn.textContent = 'Failed';
          setTimeout(() => {
            challengeBtn.textContent = 'Challenge';
            challengeBtn.style.pointerEvents = 'auto';
            challengeBtn.style.opacity = '1';
          }, 2000);
        }
      };
      actions.appendChild(challengeBtn);
    }

    // Add Friend button — only if NOT friend and not self
    if (!isFriend && !isMe) {
      const addBtn = document.createElement('button');
      addBtn.textContent = 'Add Friend';
      addBtn.style.cssText = `
        width:100%;padding:10px 0;border:none;border-radius:10px;
        background:${C.teal};color:${C.textDark};
        font-family:"Fredoka",sans-serif;font-size:14px;
        font-weight:700;cursor:pointer;transition:all 0.15s;
        letter-spacing:0.5px;
      `;
      addBtn.onmouseenter = () => { addBtn.style.filter = 'brightness(1.15)'; };
      addBtn.onmouseleave = () => { addBtn.style.filter = 'none'; };
      addBtn.onclick = async () => {
        (window as any).__menuPlaySfx?.('button_click', 0.3);
        addBtn.textContent = 'Sending...';
        addBtn.style.pointerEvents = 'none';
        try {
          await AuthManager.getInstance().sendFriendRequest(targetUid);
          addBtn.textContent = 'Request Sent!';
          addBtn.style.opacity = '0.6';
        } catch {
          addBtn.textContent = 'Failed';
          setTimeout(() => {
            addBtn.textContent = 'Add Friend';
            addBtn.style.pointerEvents = 'auto';
          }, 2000);
        }
      };
      actions.appendChild(addBtn);
    }

    // Remove Friend button — only if friend
    if (isFriend && !isMe) {
      const removeBtn = document.createElement('button');
      removeBtn.textContent = 'Remove Friend';
      removeBtn.style.cssText = `
        width:100%;padding:9px 0;border:1.5px solid ${C.red};border-radius:10px;
        background:transparent;color:${C.red};
        font-family:"Fredoka",sans-serif;font-size:13px;
        font-weight:700;cursor:pointer;transition:all 0.15s;
        letter-spacing:0.5px;
      `;
      removeBtn.onmouseenter = () => {
        removeBtn.style.background = 'rgba(255,107,107,0.1)';
      };
      removeBtn.onmouseleave = () => {
        removeBtn.style.background = 'transparent';
      };
      removeBtn.onclick = async () => {
        (window as any).__menuPlaySfx?.('button_click', 0.3);
        removeBtn.textContent = 'Removing...';
        removeBtn.style.pointerEvents = 'none';
        try {
          if (options?.onRemove) {
            options.onRemove();
          } else {
            await AuthManager.getInstance().removeFriend(targetUid);
          }
          removeBtn.textContent = 'Removed';
          removeBtn.style.opacity = '0.5';
          // Close popup after a beat
          setTimeout(() => this.close(), 800);
        } catch {
          removeBtn.textContent = 'Failed';
          setTimeout(() => {
            removeBtn.textContent = 'Remove Friend';
            removeBtn.style.pointerEvents = 'auto';
          }, 2000);
        }
      };
      actions.appendChild(removeBtn);
    }

    // Close text link
    const closeLink = document.createElement('button');
    closeLink.textContent = 'Close';
    closeLink.style.cssText = `
      background:none;border:none;color:${C.textMuted};
      font-family:"Nunito",sans-serif;font-size:12px;
      font-weight:600;cursor:pointer;padding:4px 8px;
      transition:color 0.15s;margin-top:2px;
    `;
    closeLink.onmouseenter = () => { closeLink.style.color = C.textSecondary; };
    closeLink.onmouseleave = () => { closeLink.style.color = C.textMuted; };
    closeLink.onclick = () => this.close();
    actions.appendChild(closeLink);

    panel.appendChild(actions);

    // ── Append and animate in ──
    document.body.appendChild(overlay);
    requestAnimationFrame(() => {
      overlay.style.opacity = '1';
      panel.style.transform = 'scale(1) translateY(0)';
    });
  }

  private showError(message: string): void {
    this.injectStyles();

    const overlay = document.createElement('div');
    overlay.id = 'player-profile-overlay';
    overlay.style.cssText = `
      position:fixed;inset:0;z-index:9999;
      background:${C.overlay};backdrop-filter:${C.panelBlur};-webkit-backdrop-filter:${C.panelBlur};
      display:flex;align-items:center;justify-content:center;
      opacity:0;transition:opacity 0.25s ease;
    `;
    this.overlay = overlay;

    overlay.addEventListener('mousedown', (e) => {
      if (e.target === overlay) this.close();
    });

    this.escHandler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') this.close();
    };
    window.addEventListener('keydown', this.escHandler);

    const panel = document.createElement('div');
    panel.setAttribute('data-profile-panel', '');
    panel.style.cssText = `
      width:min(300px,80vw);
      background:${C.panelBg};
      border:2px solid ${C.panelBorder};border-radius:16px;
      box-shadow:${C.panelShadow};
      padding:28px 24px;text-align:center;
      font-family:"Nunito",sans-serif;
      transform:scale(0.95);
      transition:transform 0.3s cubic-bezier(0.16,1,0.3,1);
    `;

    const msg = document.createElement('p');
    msg.textContent = message;
    msg.style.cssText = `
      font-size:14px;color:${C.textSecondary};margin:0 0 16px;
    `;
    panel.appendChild(msg);

    const closeBtn = document.createElement('button');
    closeBtn.textContent = 'Close';
    closeBtn.style.cssText = `
      background:none;border:none;color:${C.textMuted};
      font-family:"Nunito",sans-serif;font-size:12px;
      font-weight:600;cursor:pointer;padding:4px 8px;
    `;
    closeBtn.onclick = () => this.close();
    panel.appendChild(closeBtn);

    overlay.appendChild(panel);
    document.body.appendChild(overlay);

    requestAnimationFrame(() => {
      overlay.style.opacity = '1';
      panel.style.transform = 'scale(1)';
    });
  }

  private makeDivider(): HTMLDivElement {
    const div = document.createElement('div');
    div.style.cssText = `
      width:100%;height:1px;background:${C.divider};
      margin:12px 0;flex-shrink:0;
    `;
    return div;
  }

  private injectStyles(): void {
    if (document.getElementById('profile-popup-styles')) return;
    const style = document.createElement('style');
    style.id = 'profile-popup-styles';
    style.textContent = `
      #player-profile-overlay [data-profile-panel]::-webkit-scrollbar { width:5px; }
      #player-profile-overlay [data-profile-panel]::-webkit-scrollbar-track { background:transparent; }
      #player-profile-overlay [data-profile-panel]::-webkit-scrollbar-thumb {
        background:rgba(139,115,85,0.3);border-radius:3px;
      }
    `;
    document.head.appendChild(style);
  }
}
