// ─── Match History Panel — DOM overlay showing recent PvP matches ────
// Dark glassmorphism panel matching FriendsPanel / SettingsPanel style.

import { C } from './UIColors';
import { createIconElement, renderBadgeHTML } from './FriendsPanel';

// ─── Interfaces ─────────────────────────────────────────────────────
export interface MatchHistoryEntry {
  result: 'win' | 'loss';
  opponentName: string;
  opponentIcon: string;
  opponentUid: string;
  durationMs: number;
  datePlayed: number;
  mapName: string;
  opponentBadge?: string;
}

// ─── Panel ──────────────────────────────────────────────────────────
export class MatchHistoryPanel {
  private root: HTMLDivElement | null = null;
  private entries: MatchHistoryEntry[] = [];
  private escHandler: ((e: KeyboardEvent) => void) | null = null;
  private contentEl: HTMLDivElement | null = null;
  private statsEl: HTMLDivElement | null = null;

  constructor() {}

  get isOpen(): boolean {
    return this.root !== null;
  }

  open(entries: MatchHistoryEntry[]): void {
    if (this.root) return;
    this.entries = entries;
    this.build(false);
    this.escHandler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') this.close();
    };
    window.addEventListener('keydown', this.escHandler);
  }

  openLoading(): void {
    if (this.root) return;
    this.entries = [];
    this.build(true);
    this.escHandler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') this.close();
    };
    window.addEventListener('keydown', this.escHandler);
  }

  setEntries(entries: MatchHistoryEntry[]): void {
    this.entries = entries;
    if (this.contentEl) {
      this.renderContent(false);
    }
    if (this.statsEl) {
      this.renderStats();
    }
  }

  close(): void {
    if (this.escHandler) {
      window.removeEventListener('keydown', this.escHandler);
      this.escHandler = null;
    }
    if (this.root) {
      const root = this.root;
      root.style.opacity = '0';
      const panel = root.querySelector('[data-history-panel]') as HTMLElement | null;
      if (panel) panel.style.transform = 'scale(0.97)';
      setTimeout(() => {
        root.remove();
        if (this.root === root) this.root = null;
      }, 200);
    }
  }

  destroy(): void {
    this.close();
    this.entries = [];
  }

  // ────────────────────────────────────────────────────────────
  private build(loading: boolean): void {
    this.injectStyles();

    const root = document.createElement('div');
    root.id = 'matchhistory-overlay';
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
    panel.setAttribute('data-history-panel', '');
    panel.style.cssText = `
      width:min(520px,92vw);max-height:min(600px,88vh);
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
    title.textContent = 'MATCH HISTORY';
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

    // ── Content ──
    const content = document.createElement('div');
    content.className = 'history-list';
    content.style.cssText = `
      flex:1;overflow-y:auto;min-height:0;
    `;
    panel.appendChild(content);
    this.contentEl = content;

    // ── Stats footer ──
    const stats = document.createElement('div');
    stats.style.cssText = `
      padding:10px 22px;border-top:1px solid ${C.divider};
      text-align:center;min-height:20px;
    `;
    panel.appendChild(stats);
    this.statsEl = stats;

    document.body.appendChild(root);

    // Render content
    this.renderContent(loading);
    this.renderStats();

    // Animate in
    requestAnimationFrame(() => {
      root.style.opacity = '1';
      panel.style.transform = 'scale(1)';
    });
  }

  // ────────────────────────────────────────────────────────────
  private renderContent(loading: boolean): void {
    const container = this.contentEl;
    if (!container) return;
    container.innerHTML = '';

    if (loading) {
      this.renderLoading(container);
      return;
    }

    if (this.entries.length === 0) {
      this.renderEmpty(container);
      return;
    }

    // Sort by most recent first
    const sorted = [...this.entries].sort((a, b) => b.datePlayed - a.datePlayed);

    for (const entry of sorted) {
      const row = document.createElement('div');
      row.style.cssText = `
        display:flex;align-items:center;padding:10px 16px;
        border-bottom:1px solid ${C.divider};
        transition:background 0.12s;gap:12px;
      `;
      row.onmouseenter = () => { row.style.background = C.surfaceHover; };
      row.onmouseleave = () => { row.style.background = 'transparent'; };

      // Left: date
      const dateEl = document.createElement('div');
      dateEl.textContent = this.formatDate(entry.datePlayed);
      dateEl.style.cssText = `
        font-size:11px;color:${C.textMuted};font-family:"Nunito",sans-serif;
        min-width:80px;flex-shrink:0;
      `;
      row.appendChild(dateEl);

      // Center: opponent icon + name
      const center = document.createElement('div');
      center.style.cssText = `
        display:flex;align-items:center;gap:8px;flex:1;min-width:0;
      `;

      const icon = createIconElement(entry.opponentIcon, 24);
      center.appendChild(icon);

      const nameEl = document.createElement('span');
      nameEl.textContent = entry.opponentName;
      nameEl.style.cssText = `
        font-size:13px;font-weight:700;color:${C.textPrimary};
        font-family:"Nunito",sans-serif;
        overflow:hidden;text-overflow:ellipsis;white-space:nowrap;
      `;
      center.appendChild(nameEl);

      const badgeHTML = renderBadgeHTML(entry.opponentBadge);
      if (badgeHTML) {
        const badgeSpan = document.createElement('span');
        badgeSpan.innerHTML = badgeHTML;
        center.appendChild(badgeSpan);
      }

      row.appendChild(center);

      // Right: result badge + duration
      const right = document.createElement('div');
      right.style.cssText = 'display:flex;align-items:center;gap:10px;flex-shrink:0;';

      const badge = document.createElement('span');
      const isWin = entry.result === 'win';
      badge.textContent = isWin ? 'W' : 'L';
      badge.style.cssText = `
        font-size:10px;font-weight:700;font-family:"Nunito",sans-serif;
        padding:2px 8px;border-radius:4px;
        background:${isWin ? '#45E6B0' : '#FF6B6B'};color:#fff;
        letter-spacing:0.5px;
      `;
      right.appendChild(badge);

      const duration = document.createElement('span');
      duration.textContent = this.formatDuration(entry.durationMs);
      duration.style.cssText = `
        font-size:11px;color:${C.textMuted};font-family:"Nunito",sans-serif;
        min-width:36px;text-align:right;
      `;
      right.appendChild(duration);

      row.appendChild(right);
      container.appendChild(row);
    }
  }

  private renderStats(): void {
    const stats = this.statsEl;
    if (!stats) return;
    stats.innerHTML = '';

    if (this.entries.length === 0) return;

    const wins = this.entries.filter(e => e.result === 'win').length;
    const losses = this.entries.filter(e => e.result === 'loss').length;

    const text = document.createElement('span');
    text.style.cssText = `
      font-size:12px;font-family:"Nunito",sans-serif;font-weight:700;
      color:${C.textSecondary};
    `;

    const winSpan = document.createElement('span');
    winSpan.textContent = `${wins} Win${wins !== 1 ? 's' : ''}`;
    winSpan.style.color = '#45E6B0';

    const sep = document.createElement('span');
    sep.textContent = '  —  ';
    sep.style.color = C.textMuted;

    const lossSpan = document.createElement('span');
    lossSpan.textContent = `${losses} Loss${losses !== 1 ? 'es' : ''}`;
    lossSpan.style.color = '#FF6B6B';

    text.appendChild(winSpan);
    text.appendChild(sep);
    text.appendChild(lossSpan);
    stats.appendChild(text);
  }

  private renderLoading(container: HTMLDivElement): void {
    const wrapper = document.createElement('div');
    wrapper.style.cssText = `
      display:flex;flex-direction:column;align-items:center;justify-content:center;
      padding:48px 20px;gap:14px;
    `;

    const spinner = document.createElement('div');
    spinner.className = 'history-spinner';
    spinner.style.cssText = `
      width:24px;height:24px;border:3px solid ${C.inputBg};
      border-top-color:${C.gold};border-radius:50%;
      animation:history-spin 0.8s linear infinite;
    `;
    wrapper.appendChild(spinner);

    const text = document.createElement('span');
    text.textContent = 'Loading...';
    text.style.cssText = `
      font-size:13px;color:${C.textMuted};font-family:"Nunito",sans-serif;
    `;
    wrapper.appendChild(text);

    container.appendChild(wrapper);
  }

  private renderEmpty(container: HTMLDivElement): void {
    const empty = document.createElement('div');
    empty.style.cssText = `
      display:flex;align-items:center;justify-content:center;
      padding:48px 20px;
    `;
    const text = document.createElement('span');
    text.textContent = 'No matches yet. Play PvP to see your history!';
    text.style.cssText = `
      font-size:14px;color:${C.textMuted};font-family:"Nunito",sans-serif;
      font-style:italic;text-align:center;
    `;
    empty.appendChild(text);
    container.appendChild(empty);
  }

  // ── Helpers ────────────────────────────────────────────────
  private formatDate(timestamp: number): string {
    const d = new Date(timestamp);
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const month = months[d.getMonth()];
    const day = d.getDate();
    const hours = String(d.getHours()).padStart(2, '0');
    const mins = String(d.getMinutes()).padStart(2, '0');
    return `${month} ${day}, ${hours}:${mins}`;
  }

  private formatDuration(ms: number): string {
    const totalSec = Math.floor(ms / 1000);
    const m = Math.floor(totalSec / 60);
    const s = totalSec % 60;
    return `${m}:${String(s).padStart(2, '0')}`;
  }

  private injectStyles(): void {
    if (document.getElementById('matchhistory-panel-styles')) return;
    const style = document.createElement('style');
    style.id = 'matchhistory-panel-styles';
    style.textContent = `
      @keyframes history-spin {
        to { transform: rotate(360deg); }
      }
      #matchhistory-overlay .history-list::-webkit-scrollbar { width:5px; }
      #matchhistory-overlay .history-list::-webkit-scrollbar-track { background:transparent; }
      #matchhistory-overlay .history-list::-webkit-scrollbar-thumb {
        background:rgba(139,115,85,0.3);border-radius:3px;
      }
      #matchhistory-overlay .history-list::-webkit-scrollbar-thumb:hover {
        background:rgba(139,115,85,0.5);
      }
    `;
    document.head.appendChild(style);
  }
}
