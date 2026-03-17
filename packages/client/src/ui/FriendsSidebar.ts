// ─── Friends Sidebar — persistent right-side panel on menu screen ───
// Dark glassmorphism sidebar, always visible. NOT a popup overlay.

import { C } from './UIColors';
import { AuthManager, FriendEntry } from '../auth/AuthManager';
import { WalletManager } from '../store/WalletManager';
import { PlayerLevelManager } from '../store/PlayerLevelManager';
import { createIconElement, renderBadgeHTML, getFrameStyle } from './FriendsPanel';
import { SettingsPanel } from '../systems/SettingsPanel';

export class FriendsSidebar {
  private el: HTMLDivElement | null = null;
  private friendListEl: HTMLDivElement | null = null;
  private requestListEl: HTMLDivElement | null = null;
  private unsubFriends: (() => void) | null = null;
  private unsubWallet: (() => void) | null = null;
  private unsubLevel: (() => void) | null = null;
  private onProfileClick: ((uid: string) => void) | null = null;
  private settingsPanel: SettingsPanel;
  private friends: FriendEntry[] = [];
  private walletEl: HTMLSpanElement | null = null;
  private gloryEl: HTMLSpanElement | null = null;
  private levelEl: HTMLSpanElement | null = null;
  private onlineCountEl: HTMLSpanElement | null = null;
  private feedbackEl: HTMLSpanElement | null = null;
  private requestSectionEl: HTMLDivElement | null = null;
  private requestCountEl: HTMLSpanElement | null = null;

  constructor(settingsPanel: SettingsPanel, onProfileClick: (uid: string) => void) {
    this.settingsPanel = settingsPanel;
    this.onProfileClick = onProfileClick;
  }

  show(parent: HTMLElement, embedded = false): void {
    if (this.el) return;
    this.injectStyles();
    this.el = embedded ? this.buildEmbedded() : this.build();
    parent.appendChild(this.el);

    // Subscribe to friends changes
    try {
      this.unsubFriends = AuthManager.getInstance().onFriendsChanged((friends) => {
        this.friends = friends;
        this.renderFriendsList(friends);
        this.renderRequests(friends);
      });
    } catch {
      // Not authenticated — no-op
    }

    // Subscribe to wallet changes
    this.unsubWallet = WalletManager.getInstance().onChange((w) => {
      if (this.walletEl) this.walletEl.textContent = String(w.crowns);
      if (this.gloryEl) this.gloryEl.textContent = String(w.glory);
    });

    // Subscribe to level changes
    this.unsubLevel = PlayerLevelManager.getInstance().onChange((d) => {
      if (this.levelEl) this.levelEl.textContent = `Lv.${d.level}`;
    });

    // Animate in
    requestAnimationFrame(() => {
      if (this.el) {
        this.el.style.opacity = '1';
        this.el.style.transform = 'translateX(0)';
      }
    });
  }

  hide(): void {
    if (!this.el) return;
    const el = this.el;
    el.style.opacity = '0';
    el.style.transform = 'translateX(12px)';
    setTimeout(() => {
      el.remove();
      if (this.el === el) this.el = null;
    }, 200);
  }

  private build(): HTMLDivElement {
    const root = document.createElement('div');
    root.id = 'friends-sidebar';
    root.style.cssText = `
      position:fixed;bottom:16px;right:16px;z-index:100;
      width:min(260px, 22vw);max-height:calc(100vh - 200px);
      background:${C.panelBg};
      border:1.5px solid ${C.panelBorder};border-radius:14px;
      box-shadow:${C.panelShadow};
      backdrop-filter:${C.panelBlur};-webkit-backdrop-filter:${C.panelBlur};
      display:flex;flex-direction:column;overflow:hidden;
      font-family:"Nunito",sans-serif;
      opacity:0;transform:translateX(12px);
      transition:opacity 0.25s ease, transform 0.25s ease;
    `;

    // Friends section
    const friendsHeader = document.createElement('div');
    friendsHeader.style.cssText = `
      padding:8px 12px 4px;display:flex;align-items:center;gap:4px;
    `;
    const friendsLabel = document.createElement('span');
    friendsLabel.style.cssText = `
      font-size:11px;font-family:"Fredoka",sans-serif;font-weight:700;
      color:${C.gold};letter-spacing:1.5px;text-transform:uppercase;
    `;
    friendsLabel.textContent = 'FRIENDS';
    friendsHeader.appendChild(friendsLabel);

    const onlineCount = document.createElement('span');
    onlineCount.style.cssText = `
      font-size:10px;color:${C.textMuted};font-family:"Nunito",sans-serif;
      margin-left:2px;
    `;
    onlineCount.textContent = '(0 online)';
    this.onlineCountEl = onlineCount;
    friendsHeader.appendChild(onlineCount);
    root.appendChild(friendsHeader);

    const friendList = document.createElement('div');
    friendList.className = 'sidebar-friends-list';
    friendList.style.cssText = `
      max-height:300px;overflow-y:auto;padding:2px 0;
      flex-shrink:1;min-height:40px;
    `;
    this.friendListEl = friendList;
    root.appendChild(friendList);

    // Empty state
    this.renderEmptyFriends();

    // Divider
    root.appendChild(this.makeDivider());

    // 3. Add Friend
    root.appendChild(this.renderAddFriend());

    // 4. Requests section (initially hidden)
    const requestSection = document.createElement('div');
    requestSection.style.cssText = 'display:none;';
    this.requestSectionEl = requestSection;

    requestSection.appendChild(this.makeDivider());

    const reqHeader = document.createElement('div');
    reqHeader.style.cssText = `
      padding:6px 12px 2px;display:flex;align-items:center;gap:6px;
    `;
    const reqLabel = document.createElement('span');
    reqLabel.style.cssText = `
      font-size:11px;font-family:"Fredoka",sans-serif;font-weight:700;
      color:${C.gold};letter-spacing:1.5px;text-transform:uppercase;
    `;
    reqLabel.textContent = 'REQUESTS';
    reqHeader.appendChild(reqLabel);

    const reqCount = document.createElement('span');
    reqCount.style.cssText = `
      display:inline-flex;align-items:center;justify-content:center;
      background:${C.gold};color:${C.textDark};
      font-size:9px;font-weight:700;border-radius:8px;
      min-width:16px;height:16px;padding:0 4px;
      font-family:'Fredoka',sans-serif;
    `;
    reqCount.textContent = '0';
    this.requestCountEl = reqCount;
    reqHeader.appendChild(reqCount);
    requestSection.appendChild(reqHeader);

    const requestList = document.createElement('div');
    requestList.style.cssText = 'padding:2px 0;';
    this.requestListEl = requestList;
    requestSection.appendChild(requestList);

    root.appendChild(requestSection);

    return root;
  }

  /** Build an embedded version (no outer shell, no header — for embedding inside a profile card) */
  private buildEmbedded(): HTMLDivElement {
    const root = document.createElement('div');
    root.id = 'friends-sidebar-embedded';
    root.style.cssText = `
      display:flex;flex-direction:column;overflow:hidden;
      font-family:"Nunito",sans-serif;
    `;

    // Friends section (same as build() but without header/outer panel)
    const friendsHeader = document.createElement('div');
    friendsHeader.style.cssText = `padding:8px 12px 4px;display:flex;align-items:center;gap:4px;`;
    const friendsLabel = document.createElement('span');
    friendsLabel.style.cssText = `font-size:11px;font-family:"Fredoka",sans-serif;font-weight:700;color:${C.gold};letter-spacing:1.5px;text-transform:uppercase;`;
    friendsLabel.textContent = 'FRIENDS';
    friendsHeader.appendChild(friendsLabel);
    const onlineCount = document.createElement('span');
    onlineCount.style.cssText = `font-size:10px;color:${C.textMuted};font-family:"Nunito",sans-serif;margin-left:2px;`;
    onlineCount.textContent = '(0 online)';
    this.onlineCountEl = onlineCount;
    friendsHeader.appendChild(onlineCount);
    root.appendChild(friendsHeader);

    const friendList = document.createElement('div');
    friendList.className = 'sidebar-friends-list';
    friendList.style.cssText = `max-height:220px;overflow-y:auto;padding:2px 0;flex-shrink:1;min-height:40px;`;
    this.friendListEl = friendList;
    root.appendChild(friendList);
    this.renderEmptyFriends();

    root.appendChild(this.makeDivider());
    root.appendChild(this.renderAddFriend());

    // Requests section
    const requestSection = document.createElement('div');
    requestSection.style.cssText = 'display:none;';
    this.requestSectionEl = requestSection;
    requestSection.appendChild(this.makeDivider());
    const reqHeader = document.createElement('div');
    reqHeader.style.cssText = `padding:6px 12px 2px;display:flex;align-items:center;gap:6px;`;
    const reqLabel = document.createElement('span');
    reqLabel.style.cssText = `font-size:11px;font-family:"Fredoka",sans-serif;font-weight:700;color:${C.gold};letter-spacing:1.5px;text-transform:uppercase;`;
    reqLabel.textContent = 'REQUESTS';
    reqHeader.appendChild(reqLabel);
    const reqCount = document.createElement('span');
    reqCount.style.cssText = `display:inline-flex;align-items:center;justify-content:center;background:${C.gold};color:${C.textDark};font-size:9px;font-weight:700;border-radius:8px;min-width:16px;height:16px;padding:0 4px;font-family:'Fredoka',sans-serif;`;
    reqCount.textContent = '0';
    this.requestCountEl = reqCount;
    reqHeader.appendChild(reqCount);
    requestSection.appendChild(reqHeader);
    const requestList = document.createElement('div');
    requestList.style.cssText = 'padding:2px 0;';
    this.requestListEl = requestList;
    requestSection.appendChild(requestList);
    root.appendChild(requestSection);

    return root;
  }

  private renderHeader(): HTMLDivElement {
    const header = document.createElement('div');
    header.style.cssText = `padding:10px 12px 6px;`;

    // Row 1: avatar + username + gear
    const topRow = document.createElement('div');
    topRow.style.cssText = 'display:flex;align-items:center;gap:8px;';

    const auth = AuthManager.getInstance();
    const profile = auth.userProfile;
    const iconKey = profile?.icon ?? 'default';

    const avatar = createIconElement(iconKey, 32);
    topRow.appendChild(avatar);

    const username = document.createElement('span');
    username.textContent = profile?.username ?? 'Player';
    username.style.cssText = `
      font-size:13px;font-family:"Fredoka",sans-serif;font-weight:700;
      color:${C.textH1};flex:1;overflow:hidden;text-overflow:ellipsis;
      white-space:nowrap;
    `;
    topRow.appendChild(username);

    const gearBtn = document.createElement('button');
    gearBtn.textContent = '\u2699\uFE0F';
    gearBtn.title = 'Settings';
    gearBtn.style.cssText = `
      background:none;border:none;font-size:16px;cursor:pointer;
      padding:2px;line-height:1;opacity:0.6;transition:opacity 0.15s;
      flex-shrink:0;
    `;
    gearBtn.onmouseenter = () => { gearBtn.style.opacity = '1'; };
    gearBtn.onmouseleave = () => { gearBtn.style.opacity = '0.6'; };
    gearBtn.onclick = () => {
      (window as any).__menuPlaySfx?.('button_click', 0.3);
      this.settingsPanel.toggle();
    };
    topRow.appendChild(gearBtn);

    header.appendChild(topRow);

    // Row 2: crowns | glory | level
    const statsRow = document.createElement('div');
    statsRow.style.cssText = `
      display:flex;align-items:center;gap:6px;
      margin-top:6px;padding-left:2px;
    `;

    const wallet = WalletManager.getInstance();
    const levelMgr = PlayerLevelManager.getInstance();

    // Crowns
    const crownEl = document.createElement('span');
    crownEl.style.cssText = `font-size:11px;color:${C.textSecondary};font-family:"Nunito",sans-serif;`;
    crownEl.innerHTML = `<span style="font-size:12px;">\u{1F451}</span> `;
    const crownVal = document.createElement('span');
    crownVal.textContent = String(wallet.crowns);
    crownVal.style.cssText = `font-weight:700;color:${C.gold};`;
    this.walletEl = crownVal;
    crownEl.appendChild(crownVal);
    statsRow.appendChild(crownEl);

    // Separator
    const sep1 = document.createElement('span');
    sep1.textContent = '|';
    sep1.style.cssText = `font-size:10px;color:${C.textMuted};`;
    statsRow.appendChild(sep1);

    // Glory
    const gloryEl = document.createElement('span');
    gloryEl.style.cssText = `font-size:11px;color:${C.textSecondary};font-family:"Nunito",sans-serif;`;
    gloryEl.innerHTML = `<span style="font-size:12px;color:#C0C0D2;">\u2605</span> `;
    const gloryVal = document.createElement('span');
    gloryVal.textContent = String(wallet.glory);
    gloryVal.style.cssText = `font-weight:700;color:#C0C0D2;`;
    this.gloryEl = gloryVal;
    gloryEl.appendChild(gloryVal);
    statsRow.appendChild(gloryEl);

    // Separator
    const sep2 = document.createElement('span');
    sep2.textContent = '|';
    sep2.style.cssText = `font-size:10px;color:${C.textMuted};`;
    statsRow.appendChild(sep2);

    // Level
    const lvlEl = document.createElement('span');
    lvlEl.textContent = `Lv.${levelMgr.level}`;
    lvlEl.style.cssText = `
      font-size:11px;font-weight:700;color:${C.teal};
      font-family:"Nunito",sans-serif;
    `;
    this.levelEl = lvlEl;
    statsRow.appendChild(lvlEl);

    header.appendChild(statsRow);

    return header;
  }

  private renderFriendsList(friends: FriendEntry[]): void {
    if (!this.friendListEl) return;
    this.friendListEl.innerHTML = '';

    const accepted = friends.filter(f => f.status === 'accepted');
    const onlineCount = accepted.filter(f => f.online).length;

    // Update online count label
    if (this.onlineCountEl) {
      this.onlineCountEl.textContent = `(${onlineCount} online)`;
    }

    if (accepted.length === 0) {
      this.renderEmptyFriends();
      return;
    }

    // Sort: online first, then alphabetical
    accepted.sort((a, b) => {
      if (a.online !== b.online) return a.online ? -1 : 1;
      return a.username.localeCompare(b.username);
    });

    for (const friend of accepted) {
      const row = document.createElement('div');
      row.style.cssText = `
        display:flex;align-items:center;gap:8px;
        padding:5px 12px;cursor:pointer;
        transition:background 0.12s;
      `;
      row.onmouseenter = () => { row.style.background = C.surfaceHover; };
      row.onmouseleave = () => { row.style.background = 'transparent'; };
      row.onclick = () => {
        (window as any).__menuPlaySfx?.('button_click', 0.3);
        this.onProfileClick?.(friend.uid);
      };

      // Online/offline dot
      const dot = document.createElement('span');
      dot.style.cssText = `
        width:8px;height:8px;border-radius:50%;flex-shrink:0;
        background:${friend.online ? '#45E6B0' : '#555'};
        ${friend.online ? 'box-shadow:0 0 6px rgba(69,230,176,0.5);' : ''}
      `;
      row.appendChild(dot);

      // Avatar
      const avatar = createIconElement(friend.icon, 24, friend.profileBorder);
      row.appendChild(avatar);

      // Username
      const name = document.createElement('span');
      name.textContent = friend.username;
      name.style.cssText = `
        font-size:12px;font-weight:600;color:${C.textPrimary};
        font-family:"Nunito",sans-serif;
        overflow:hidden;text-overflow:ellipsis;white-space:nowrap;
        flex:1;min-width:0;
      `;
      row.appendChild(name);

      this.friendListEl.appendChild(row);
    }
  }

  private renderEmptyFriends(): void {
    if (!this.friendListEl) return;
    this.friendListEl.innerHTML = '';
    const empty = document.createElement('div');
    empty.style.cssText = `
      padding:16px 12px;text-align:center;
    `;
    const text = document.createElement('span');
    text.textContent = 'No friends yet';
    text.style.cssText = `
      font-size:11px;color:${C.textMuted};font-family:"Nunito",sans-serif;
      font-style:italic;
    `;
    empty.appendChild(text);
    this.friendListEl.appendChild(empty);
  }

  private renderRequests(friends: FriendEntry[]): void {
    if (!this.requestListEl || !this.requestSectionEl) return;
    this.requestListEl.innerHTML = '';

    const incoming = friends.filter(f => f.status === 'pending_received');
    const outgoing = friends.filter(f => f.status === 'pending_sent');
    const total = incoming.length + outgoing.length;

    if (total === 0) {
      this.requestSectionEl.style.display = 'none';
      return;
    }

    this.requestSectionEl.style.display = 'block';
    if (this.requestCountEl) {
      this.requestCountEl.textContent = String(total);
    }

    const auth = AuthManager.getInstance();

    // Incoming requests
    for (const req of incoming) {
      const row = document.createElement('div');
      row.style.cssText = `
        display:flex;align-items:center;gap:6px;
        padding:4px 12px;transition:background 0.12s;
      `;
      row.onmouseenter = () => { row.style.background = C.surfaceHover; };
      row.onmouseleave = () => { row.style.background = 'transparent'; };

      // Avatar
      const avatar = createIconElement(req.icon, 24, req.profileBorder);
      row.appendChild(avatar);

      // Name
      const name = document.createElement('span');
      name.textContent = req.username;
      name.style.cssText = `
        font-size:11px;font-weight:600;color:${C.textPrimary};
        font-family:"Nunito",sans-serif;flex:1;min-width:0;
        overflow:hidden;text-overflow:ellipsis;white-space:nowrap;
      `;
      row.appendChild(name);

      // Accept button
      const acceptBtn = document.createElement('button');
      acceptBtn.textContent = '\u2713';
      acceptBtn.title = 'Accept';
      acceptBtn.style.cssText = `
        background:none;border:none;color:${C.teal};font-size:14px;
        cursor:pointer;padding:2px 4px;font-weight:700;
        transition:opacity 0.15s;opacity:0.8;line-height:1;
      `;
      acceptBtn.onmouseenter = () => { acceptBtn.style.opacity = '1'; };
      acceptBtn.onmouseleave = () => { acceptBtn.style.opacity = '0.8'; };
      acceptBtn.onclick = async (e) => {
        e.stopPropagation();
        acceptBtn.textContent = '...';
        acceptBtn.style.pointerEvents = 'none';
        await auth.acceptRequest(req.uid);
      };
      row.appendChild(acceptBtn);

      // Decline button
      const declineBtn = document.createElement('button');
      declineBtn.textContent = '\u2717';
      declineBtn.title = 'Decline';
      declineBtn.style.cssText = `
        background:none;border:none;color:${C.red};font-size:14px;
        cursor:pointer;padding:2px 4px;font-weight:700;
        transition:opacity 0.15s;opacity:0.8;line-height:1;
      `;
      declineBtn.onmouseenter = () => { declineBtn.style.opacity = '1'; };
      declineBtn.onmouseleave = () => { declineBtn.style.opacity = '0.8'; };
      declineBtn.onclick = async (e) => {
        e.stopPropagation();
        declineBtn.textContent = '...';
        declineBtn.style.pointerEvents = 'none';
        await auth.declineRequest(req.uid);
      };
      row.appendChild(declineBtn);

      this.requestListEl.appendChild(row);
    }

    // Outgoing requests
    for (const req of outgoing) {
      const row = document.createElement('div');
      row.style.cssText = `
        display:flex;align-items:center;gap:6px;
        padding:4px 12px;transition:background 0.12s;
      `;

      // Avatar
      const avatar = createIconElement(req.icon, 24, req.profileBorder);
      row.appendChild(avatar);

      // Name
      const name = document.createElement('span');
      name.textContent = req.username;
      name.style.cssText = `
        font-size:11px;font-weight:600;color:${C.textPrimary};
        font-family:"Nunito",sans-serif;flex:1;min-width:0;
        overflow:hidden;text-overflow:ellipsis;white-space:nowrap;
      `;
      row.appendChild(name);

      // Pending text
      const pending = document.createElement('span');
      pending.textContent = 'Pending...';
      pending.style.cssText = `
        font-size:9px;color:${C.textMuted};font-family:"Nunito",sans-serif;
        font-style:italic;flex-shrink:0;
      `;
      row.appendChild(pending);

      this.requestListEl.appendChild(row);
    }
  }

  private renderAddFriend(): HTMLDivElement {
    const wrapper = document.createElement('div');
    wrapper.style.cssText = 'padding:6px 12px;';

    const inputRow = document.createElement('div');
    inputRow.style.cssText = 'display:flex;gap:4px;align-items:center;';

    const input = document.createElement('input');
    input.type = 'text';
    input.placeholder = 'Add by username...';
    input.style.cssText = `
      flex:1;padding:5px 8px;border-radius:6px;
      border:1px solid ${C.inputBorder};
      background:${C.inputBg};color:${C.textPrimary};
      font-family:"Nunito",sans-serif;font-size:12px;
      outline:none;transition:border-color 0.15s;
      min-width:0;
    `;
    input.onfocus = () => { input.style.borderColor = C.inputBorderHi; };
    input.onblur = () => { input.style.borderColor = C.inputBorder; };
    inputRow.appendChild(input);

    const searchBtn = document.createElement('button');
    searchBtn.innerHTML = '\u{1F50D}';
    searchBtn.title = 'Search';
    searchBtn.style.cssText = `
      background:${C.gold};border:none;border-radius:6px;
      width:28px;height:28px;font-size:12px;cursor:pointer;
      display:flex;align-items:center;justify-content:center;
      transition:background 0.15s;flex-shrink:0;
    `;
    searchBtn.onmouseenter = () => { searchBtn.style.background = C.goldDark; };
    searchBtn.onmouseleave = () => { searchBtn.style.background = C.gold; };
    inputRow.appendChild(searchBtn);

    wrapper.appendChild(inputRow);

    // Feedback
    const feedback = document.createElement('span');
    feedback.style.cssText = `
      display:block;font-size:10px;font-family:"Nunito",sans-serif;
      font-weight:600;min-height:14px;margin-top:3px;padding-left:2px;
      transition:opacity 0.2s;opacity:0;
    `;
    this.feedbackEl = feedback;
    wrapper.appendChild(feedback);

    const showFeedback = (msg: string, isError: boolean) => {
      feedback.textContent = msg;
      feedback.style.color = isError ? C.red : C.teal;
      feedback.style.opacity = '1';
      setTimeout(() => { feedback.style.opacity = '0'; }, 3000);
    };

    const doAdd = async () => {
      (window as any).__menuPlaySfx?.('button_click', 0.3);
      const username = input.value.trim();
      if (!username) return;
      searchBtn.style.pointerEvents = 'none';
      searchBtn.style.opacity = '0.5';
      try {
        const auth = AuthManager.getInstance();
        const found = await auth.searchByUsername(username);
        if (!found) {
          showFeedback('User not found', true);
          return;
        }
        if (found.uid === auth.currentUser?.uid) {
          showFeedback("That's you!", true);
          return;
        }
        await auth.sendFriendRequest(found.uid);
        showFeedback('Request sent!', false);
        input.value = '';
      } catch {
        showFeedback('Something went wrong', true);
      } finally {
        searchBtn.style.pointerEvents = 'auto';
        searchBtn.style.opacity = '1';
      }
    };

    searchBtn.onclick = doAdd;
    input.onkeydown = (e) => {
      if (e.key === 'Enter') doAdd();
    };

    return wrapper;
  }

  private renderBottomLinks(): HTMLDivElement {
    const bar = document.createElement('div');
    bar.style.cssText = `
      display:flex;align-items:center;justify-content:center;
      gap:4px;padding:8px 12px 10px;
    `;

    const buttons: { icon: string; title: string; onClick: () => void }[] = [
      {
        icon: '\u{1F4DC}',
        title: 'History',
        onClick: () => {
          (window as any).__menuPlaySfx?.('button_click', 0.3);
          (window as any).__openMatchHistory?.();
        },
      },
      {
        icon: '\u{1F3C6}',
        title: 'Ranked',
        onClick: () => {
          (window as any).__menuPlaySfx?.('button_click', 0.3);
          (window as any).__openRanked?.();
        },
      },
      {
        icon: '\u{1F6D2}',
        title: 'Store',
        onClick: () => {
          (window as any).__menuPlaySfx?.('button_click', 0.3);
          (window as any).__openStore?.();
        },
      },
      {
        icon: '\u{1F6AA}',
        title: 'Sign Out',
        onClick: async () => {
          (window as any).__menuPlaySfx?.('button_click', 0.3);
          await AuthManager.getInstance().signOut();
          window.location.reload();
        },
      },
    ];

    for (const btn of buttons) {
      const el = document.createElement('button');
      el.innerHTML = `<span style="font-size:14px;">${btn.icon}</span>`;
      el.title = btn.title;
      el.style.cssText = `
        background:none;border:none;cursor:pointer;
        width:32px;height:32px;border-radius:8px;
        display:flex;align-items:center;justify-content:center;
        transition:all 0.15s;opacity:0.5;
      `;
      el.onmouseenter = () => {
        el.style.opacity = '1';
        el.style.background = C.surfaceHover;
      };
      el.onmouseleave = () => {
        el.style.opacity = '0.5';
        el.style.background = 'none';
      };
      el.onclick = btn.onClick;
      bar.appendChild(el);
    }

    return bar;
  }

  private makeDivider(): HTMLDivElement {
    const div = document.createElement('div');
    div.style.cssText = `
      height:1px;background:${C.divider};margin:0 12px;flex-shrink:0;
    `;
    return div;
  }

  destroy(): void {
    if (this.unsubFriends) {
      this.unsubFriends();
      this.unsubFriends = null;
    }
    if (this.unsubWallet) {
      this.unsubWallet();
      this.unsubWallet = null;
    }
    if (this.unsubLevel) {
      this.unsubLevel();
      this.unsubLevel = null;
    }
    if (this.el) {
      this.el.remove();
      this.el = null;
    }
    this.friendListEl = null;
    this.requestListEl = null;
    this.walletEl = null;
    this.gloryEl = null;
    this.levelEl = null;
    this.onlineCountEl = null;
    this.feedbackEl = null;
    this.requestSectionEl = null;
    this.requestCountEl = null;
    this.friends = [];
  }

  private injectStyles(): void {
    if (document.getElementById('friends-sidebar-styles')) return;
    const style = document.createElement('style');
    style.id = 'friends-sidebar-styles';
    style.textContent = `
      #friends-sidebar .sidebar-friends-list::-webkit-scrollbar { width:4px; }
      #friends-sidebar .sidebar-friends-list::-webkit-scrollbar-track { background:transparent; }
      #friends-sidebar .sidebar-friends-list::-webkit-scrollbar-thumb {
        background:rgba(139,115,85,0.3);border-radius:2px;
      }
      #friends-sidebar .sidebar-friends-list::-webkit-scrollbar-thumb:hover {
        background:rgba(139,115,85,0.5);
      }
      @keyframes sidebar-online-pulse {
        0%, 100% { box-shadow:0 0 4px rgba(69,230,176,0.4); }
        50%      { box-shadow:0 0 8px rgba(69,230,176,0.7); }
      }
    `;
    document.head.appendChild(style);
  }
}
