// ─── Friends Panel — DOM overlay for friends list, requests, adding ───
// Dark glassmorphism panel matching SettingsPanel style.

import { C } from './UIColors';

// ─── Avatar portrait paths (same as TalkingPortrait system) ──────────
const AVATAR_BASE = 'assets/enemies/avatars';

/**
 * Creates an HTML div showing the avatar portrait for the given icon key.
 * Reusable across panels.
 */
export function createIconElement(iconKey: string, size: number): HTMLDivElement {
  const div = document.createElement('div');
  div.style.cssText = `
    width:${size}px;height:${size}px;flex-shrink:0;
    border-radius:50%;overflow:hidden;
    background:${C.inputBg};
  `;
  const img = document.createElement('img');
  img.src = `${AVATAR_BASE}/${iconKey}.png`;
  img.alt = iconKey;
  img.style.cssText = `width:100%;height:100%;object-fit:cover;display:block;image-rendering:pixelated;`;
  img.onerror = () => { img.style.display = 'none'; };
  div.appendChild(img);
  return div;
}

// ─── Interfaces ─────────────────────────────────────────────────────
export interface FriendsPanelCallbacks {
  onAddFriend: (username: string) => Promise<{ success: boolean; error?: string }>;
  onAcceptRequest: (friendUid: string) => Promise<void>;
  onDeclineRequest: (friendUid: string) => Promise<void>;
  onRemoveFriend: (friendUid: string) => Promise<void>;
  onInvite: (friendUid: string) => Promise<void>;
}

export interface FriendEntry {
  uid: string;
  username: string;
  icon: string;
  status: 'accepted' | 'pending_sent' | 'pending_received';
  online: boolean;
}

type Tab = 'friends' | 'requests';

// ─── Panel ──────────────────────────────────────────────────────────
export class FriendsPanel {
  private root: HTMLDivElement | null = null;
  private callbacks: FriendsPanelCallbacks;
  private friends: FriendEntry[] = [];
  private activeTab: Tab = 'friends';
  private escHandler: ((e: KeyboardEvent) => void) | null = null;
  private listContainer: HTMLDivElement | null = null;
  private tabBtns: HTMLButtonElement[] = [];
  private feedbackEl: HTMLSpanElement | null = null;

  constructor(callbacks: FriendsPanelCallbacks) {
    this.callbacks = callbacks;
  }

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
      const root = this.root;
      root.style.opacity = '0';
      const panel = root.querySelector('[data-friends-panel]') as HTMLElement | null;
      if (panel) panel.style.transform = 'scale(0.97)';
      setTimeout(() => {
        root.remove();
        if (this.root === root) this.root = null;
      }, 200);
    }
  }

  toggle(): void {
    this.isOpen ? this.close() : this.open();
  }

  updateFriends(friends: FriendEntry[]): void {
    this.friends = friends;
    if (this.listContainer) {
      this.renderList();
    }
  }

  destroy(): void {
    this.close();
    this.friends = [];
  }

  // ────────────────────────────────────────────────────────────
  private build(): void {
    this.injectStyles();

    const root = document.createElement('div');
    root.id = 'friends-overlay';
    root.style.cssText = `
      position:fixed;inset:0;z-index:9997;
      background:${C.overlay};backdrop-filter:${C.panelBlur};-webkit-backdrop-filter:${C.panelBlur};
      display:flex;align-items:center;justify-content:center;
      opacity:0;transition:opacity 0.25s ease;
    `;
    this.root = root;

    root.addEventListener('mousedown', (e) => {
      if (e.target === root) this.close();
    });

    // Panel
    const panel = document.createElement('div');
    panel.setAttribute('data-friends-panel', '');
    panel.style.cssText = `
      width:min(480px,92vw);max-height:min(650px,88vh);
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
    `;
    panel.appendChild(header);

    const title = document.createElement('h2');
    title.textContent = 'FRIENDS';
    title.style.cssText = `
      margin:0;font-size:20px;font-family:"Fredoka",sans-serif;font-weight:700;
      color:${C.gold};letter-spacing:3px;
    `;
    header.appendChild(title);

    const closeBtn = document.createElement('button');
    closeBtn.textContent = '\u2715';
    closeBtn.style.cssText = `
      background:${C.inputBg};border:1px solid ${C.inputBorder};color:${C.textSecondary};
      width:32px;height:32px;border-radius:8px;font-size:15px;cursor:pointer;
      font-family:"Fredoka",sans-serif;transition:all 0.15s;display:flex;
      align-items:center;justify-content:center;
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

    // ── Search bar ──
    const searchRow = document.createElement('div');
    searchRow.style.cssText = `
      display:flex;gap:8px;padding:14px 22px 4px;align-items:center;
    `;
    panel.appendChild(searchRow);

    const searchInput = document.createElement('input');
    searchInput.type = 'text';
    searchInput.placeholder = 'Add friend by username...';
    searchInput.style.cssText = `
      flex:1;padding:8px 12px;border-radius:8px;border:1px solid ${C.inputBorder};
      background:${C.inputBg};color:${C.textPrimary};font-family:"Nunito",sans-serif;
      font-size:13px;outline:none;transition:border-color 0.15s;
    `;
    searchInput.onfocus = () => { searchInput.style.borderColor = C.inputBorderHi; };
    searchInput.onblur = () => { searchInput.style.borderColor = C.inputBorder; };
    searchRow.appendChild(searchInput);

    const addBtn = document.createElement('button');
    addBtn.textContent = 'Add';
    addBtn.style.cssText = `
      background:${C.gold};color:${C.textDark};font-family:"Fredoka",sans-serif;
      font-size:13px;font-weight:700;border:none;border-radius:8px;
      padding:8px 16px;cursor:pointer;transition:all 0.15s;white-space:nowrap;
    `;
    addBtn.onmouseenter = () => { addBtn.style.background = C.goldDark; };
    addBtn.onmouseleave = () => { addBtn.style.background = C.gold; };
    searchRow.appendChild(addBtn);

    // Feedback text
    const feedback = document.createElement('div');
    feedback.style.cssText = `
      padding:2px 22px 8px;min-height:18px;
    `;
    panel.appendChild(feedback);

    const feedbackText = document.createElement('span');
    feedbackText.style.cssText = `
      font-size:11px;font-family:"Nunito",sans-serif;font-weight:600;
      transition:opacity 0.2s;
    `;
    feedback.appendChild(feedbackText);
    this.feedbackEl = feedbackText;

    const showFeedback = (msg: string, isError: boolean) => {
      feedbackText.textContent = msg;
      feedbackText.style.color = isError ? C.red : C.teal;
      feedbackText.style.opacity = '1';
      setTimeout(() => { feedbackText.style.opacity = '0'; }, 3000);
    };

    const doAdd = async () => {
      const username = searchInput.value.trim();
      if (!username) return;
      addBtn.style.opacity = '0.6';
      addBtn.style.pointerEvents = 'none';
      try {
        const result = await this.callbacks.onAddFriend(username);
        if (result.success) {
          showFeedback('Friend request sent!', false);
          searchInput.value = '';
        } else {
          showFeedback(result.error || 'User not found', true);
        }
      } catch {
        showFeedback('Something went wrong', true);
      } finally {
        addBtn.style.opacity = '1';
        addBtn.style.pointerEvents = 'auto';
      }
    };

    addBtn.onclick = doAdd;
    searchInput.onkeydown = (e) => {
      if (e.key === 'Enter') doAdd();
    };

    // ── Tab bar ──
    const tabBar = document.createElement('div');
    tabBar.style.cssText = `
      display:flex;gap:4px;padding:0 22px;
      border-bottom:1px solid ${C.divider};
    `;
    panel.appendChild(tabBar);

    this.tabBtns = [];
    const tabs: { id: Tab; label: string }[] = [
      { id: 'friends', label: 'Friends' },
      { id: 'requests', label: 'Requests' },
    ];

    for (const tab of tabs) {
      const btn = document.createElement('button');
      btn.dataset.tab = tab.id;
      btn.style.cssText = `
        flex:1;padding:10px 4px 12px;
        border:none;border-bottom:2px solid transparent;
        border-radius:0;background:none;color:${C.textMuted};
        font-size:13px;font-weight:700;cursor:pointer;
        font-family:"Nunito",sans-serif;transition:all 0.15s;
        display:flex;align-items:center;justify-content:center;gap:6px;
        margin-bottom:-1px;
      `;
      btn.onmouseenter = () => {
        if (btn.dataset.tab !== this.activeTab) btn.style.color = C.textSecondary;
      };
      btn.onmouseleave = () => {
        if (btn.dataset.tab !== this.activeTab) btn.style.color = C.textMuted;
      };
      btn.onclick = () => {
        this.activeTab = tab.id as Tab;
        this.applyTabStyles();
        this.renderList();
      };
      tabBar.appendChild(btn);
      this.tabBtns.push(btn);
    }

    // ── List container ──
    const listContainer = document.createElement('div');
    listContainer.className = 'friends-list';
    listContainer.style.cssText = `
      flex:1;overflow-y:auto;min-height:0;
    `;
    panel.appendChild(listContainer);
    this.listContainer = listContainer;

    document.body.appendChild(root);

    // Animate in
    requestAnimationFrame(() => {
      root.style.opacity = '1';
      panel.style.transform = 'scale(1)';
    });

    this.applyTabStyles();
    this.renderList();
  }

  // ────────────────────────────────────────────────────────────
  private applyTabStyles(): void {
    const pendingCount = this.friends.filter(
      f => f.status === 'pending_received' || f.status === 'pending_sent'
    ).length;

    for (const btn of this.tabBtns) {
      const isActive = btn.dataset.tab === this.activeTab;
      btn.style.color = isActive ? C.gold : C.textMuted;
      btn.style.borderBottomColor = isActive ? C.tabBorder : 'transparent';
      btn.style.background = isActive ? C.tabActive : 'none';

      // Build inner content
      const tabId = btn.dataset.tab;
      if (tabId === 'requests') {
        let html = 'Requests';
        if (pendingCount > 0) {
          html += ` <span style="
            display:inline-flex;align-items:center;justify-content:center;
            background:${C.gold};color:${C.textDark};
            font-size:10px;font-weight:700;border-radius:10px;
            min-width:18px;height:18px;padding:0 5px;
            font-family:'Fredoka',sans-serif;
          ">${pendingCount}</span>`;
        }
        btn.innerHTML = html;
      } else {
        btn.textContent = 'Friends';
      }
    }
  }

  // ────────────────────────────────────────────────────────────
  private renderList(): void {
    const container = this.listContainer;
    if (!container) return;
    container.innerHTML = '';

    if (this.activeTab === 'friends') {
      this.renderFriendsTab(container);
    } else {
      this.renderRequestsTab(container);
    }
  }

  private renderFriendsTab(container: HTMLDivElement): void {
    const accepted = this.friends.filter(f => f.status === 'accepted');

    if (accepted.length === 0) {
      this.renderEmpty(container, 'No friends yet');
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
        display:flex;align-items:center;justify-content:space-between;
        padding:10px 14px;border-bottom:1px solid ${C.divider};
        transition:background 0.12s;
      `;
      row.onmouseenter = () => { row.style.background = C.surfaceHover; };
      row.onmouseleave = () => { row.style.background = 'transparent'; };

      // Left side: icon + name + online dot
      const left = document.createElement('div');
      left.style.cssText = 'display:flex;align-items:center;gap:10px;min-width:0;';

      const icon = createIconElement(friend.icon, 44);
      left.appendChild(icon);

      const name = document.createElement('span');
      name.textContent = friend.username;
      name.style.cssText = `
        font-size:16px;font-weight:700;color:${C.textPrimary};
        font-family:"Nunito",sans-serif;
        overflow:hidden;text-overflow:ellipsis;white-space:nowrap;
      `;
      left.appendChild(name);

      const dot = document.createElement('span');
      dot.style.cssText = `
        width:8px;height:8px;border-radius:50%;flex-shrink:0;
        background:${friend.online ? '#45E6B0' : '#555'};
      `;
      left.appendChild(dot);

      row.appendChild(left);

      // Right side: Invite + Remove
      const right = document.createElement('div');
      right.style.cssText = 'display:flex;align-items:center;gap:6px;flex-shrink:0;';

      const inviteBtn = document.createElement('button');
      inviteBtn.textContent = 'Invite';
      inviteBtn.style.cssText = `
        background:${C.gold};color:${C.textDark};border:none;border-radius:6px;
        font-size:11px;font-weight:700;font-family:"Nunito",sans-serif;
        padding:4px 12px;cursor:pointer;transition:all 0.15s;
      `;
      if (!friend.online) {
        inviteBtn.style.opacity = '0.35';
        inviteBtn.style.pointerEvents = 'none';
        inviteBtn.style.cursor = 'default';
      } else {
        inviteBtn.onmouseenter = () => { inviteBtn.style.background = C.goldDark; };
        inviteBtn.onmouseleave = () => { inviteBtn.style.background = C.gold; };
        inviteBtn.onclick = () => {
          inviteBtn.textContent = 'Sent!';
          inviteBtn.style.opacity = '0.6';
          inviteBtn.style.pointerEvents = 'none';
          this.callbacks.onInvite(friend.uid);
        };
      }
      right.appendChild(inviteBtn);

      const removeBtn = document.createElement('button');
      removeBtn.textContent = 'Remove';
      removeBtn.style.cssText = `
        background:transparent;color:${C.red};border:1px solid ${C.red};
        border-radius:6px;font-size:11px;font-weight:700;
        font-family:"Nunito",sans-serif;padding:4px 12px;
        cursor:pointer;transition:all 0.15s;
      `;
      removeBtn.onmouseenter = () => {
        removeBtn.style.background = 'rgba(255,107,107,0.12)';
      };
      removeBtn.onmouseleave = () => {
        removeBtn.style.background = 'transparent';
      };
      removeBtn.onclick = async () => {
        removeBtn.textContent = '...';
        removeBtn.style.pointerEvents = 'none';
        await this.callbacks.onRemoveFriend(friend.uid);
      };
      right.appendChild(removeBtn);

      row.appendChild(right);
      container.appendChild(row);
    }
  }

  private renderRequestsTab(container: HTMLDivElement): void {
    const incoming = this.friends.filter(f => f.status === 'pending_received');
    const outgoing = this.friends.filter(f => f.status === 'pending_sent');

    if (incoming.length === 0 && outgoing.length === 0) {
      this.renderEmpty(container, 'No pending requests');
      return;
    }

    // Incoming
    for (const req of incoming) {
      const row = document.createElement('div');
      row.style.cssText = `
        display:flex;align-items:center;justify-content:space-between;
        padding:10px 14px;border-bottom:1px solid ${C.divider};
        transition:background 0.12s;
      `;
      row.onmouseenter = () => { row.style.background = C.surfaceHover; };
      row.onmouseleave = () => { row.style.background = 'transparent'; };

      const left = document.createElement('div');
      left.style.cssText = 'display:flex;align-items:center;gap:10px;min-width:0;';

      const icon = createIconElement(req.icon, 44);
      left.appendChild(icon);

      const name = document.createElement('span');
      name.textContent = req.username;
      name.style.cssText = `
        font-size:16px;font-weight:700;color:${C.textPrimary};
        font-family:"Nunito",sans-serif;
        overflow:hidden;text-overflow:ellipsis;white-space:nowrap;
      `;
      left.appendChild(name);

      row.appendChild(left);

      const right = document.createElement('div');
      right.style.cssText = 'display:flex;align-items:center;gap:6px;flex-shrink:0;';

      const acceptBtn = document.createElement('button');
      acceptBtn.textContent = 'Accept';
      acceptBtn.style.cssText = `
        background:${C.green};color:#fff;border:none;border-radius:6px;
        font-size:11px;font-weight:700;font-family:"Nunito",sans-serif;
        padding:5px 14px;cursor:pointer;transition:all 0.15s;
      `;
      acceptBtn.onmouseenter = () => { acceptBtn.style.background = C.greenDark; };
      acceptBtn.onmouseleave = () => { acceptBtn.style.background = C.green; };
      acceptBtn.onclick = async () => {
        acceptBtn.textContent = '...';
        acceptBtn.style.pointerEvents = 'none';
        await this.callbacks.onAcceptRequest(req.uid);
      };
      right.appendChild(acceptBtn);

      const declineBtn = document.createElement('button');
      declineBtn.textContent = 'Decline';
      declineBtn.style.cssText = `
        background:${C.red};color:#fff;border:none;border-radius:6px;
        font-size:11px;font-weight:700;font-family:"Nunito",sans-serif;
        padding:5px 14px;cursor:pointer;transition:all 0.15s;
      `;
      declineBtn.onmouseenter = () => { declineBtn.style.background = '#e05555'; };
      declineBtn.onmouseleave = () => { declineBtn.style.background = C.red; };
      declineBtn.onclick = async () => {
        declineBtn.textContent = '...';
        declineBtn.style.pointerEvents = 'none';
        await this.callbacks.onDeclineRequest(req.uid);
      };
      right.appendChild(declineBtn);

      row.appendChild(right);
      container.appendChild(row);
    }

    // Outgoing
    for (const req of outgoing) {
      const row = document.createElement('div');
      row.style.cssText = `
        display:flex;align-items:center;justify-content:space-between;
        padding:10px 14px;border-bottom:1px solid ${C.divider};
        transition:background 0.12s;
      `;
      row.onmouseenter = () => { row.style.background = C.surfaceHover; };
      row.onmouseleave = () => { row.style.background = 'transparent'; };

      const left = document.createElement('div');
      left.style.cssText = 'display:flex;align-items:center;gap:10px;min-width:0;';

      const icon = createIconElement(req.icon, 44);
      left.appendChild(icon);

      const name = document.createElement('span');
      name.textContent = req.username;
      name.style.cssText = `
        font-size:16px;font-weight:700;color:${C.textPrimary};
        font-family:"Nunito",sans-serif;
        overflow:hidden;text-overflow:ellipsis;white-space:nowrap;
      `;
      left.appendChild(name);

      row.appendChild(left);

      const pendingText = document.createElement('span');
      pendingText.textContent = 'Pending...';
      pendingText.style.cssText = `
        font-size:12px;color:${C.textMuted};font-family:"Nunito",sans-serif;
        font-style:italic;flex-shrink:0;
      `;
      row.appendChild(pendingText);

      container.appendChild(row);
    }
  }

  private renderEmpty(container: HTMLDivElement, message: string): void {
    const empty = document.createElement('div');
    empty.style.cssText = `
      display:flex;align-items:center;justify-content:center;
      padding:48px 20px;
    `;
    const text = document.createElement('span');
    text.textContent = message;
    text.style.cssText = `
      font-size:14px;color:${C.textMuted};font-family:"Nunito",sans-serif;
      font-style:italic;
    `;
    empty.appendChild(text);
    container.appendChild(empty);
  }

  // ────────────────────────────────────────────────────────────
  private injectStyles(): void {
    if (document.getElementById('friends-panel-styles')) return;
    const style = document.createElement('style');
    style.id = 'friends-panel-styles';
    style.textContent = `
      #friends-overlay .friends-list::-webkit-scrollbar { width:5px; }
      #friends-overlay .friends-list::-webkit-scrollbar-track { background:transparent; }
      #friends-overlay .friends-list::-webkit-scrollbar-thumb {
        background:rgba(139,115,85,0.3);border-radius:3px;
      }
      #friends-overlay .friends-list::-webkit-scrollbar-thumb:hover {
        background:rgba(139,115,85,0.5);
      }
    `;
    document.head.appendChild(style);
  }
}
