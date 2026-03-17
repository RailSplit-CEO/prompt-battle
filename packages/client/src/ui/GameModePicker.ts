import { C } from './UIColors';

export interface GameModePickerOptions {
  onSolo: () => void;
  onUnranked: () => void;
  onRanked: () => void;
  onFriendly: () => void;
}

// Medieval color schemes matching createMedievalButton
const MODES = [
  { id: 'solo',     emoji: '\u2694\uFE0F', label: 'SOLO',      desc: 'Battle the AI',   fill: '#3a6a2e', border: '#5a9a4e', highlight: '#8BC47A' },
  { id: 'unranked', emoji: '\uD83D\uDDE1\uFE0F', label: 'UNRANKED',  desc: 'Casual PvP',     fill: '#2a5a8a', border: '#4a8aBB', highlight: '#6aAADD' },
  { id: 'ranked',   emoji: '\uD83C\uDFC6', label: 'RANKED',    desc: 'Competitive',     fill: '#8B3333', border: '#BB4444', highlight: '#DD6666' },
  { id: 'friendly', emoji: '\uD83E\uDD1D', label: 'FRIENDLY',  desc: 'vs Friend',       fill: '#7a6a2a', border: '#AA9944', highlight: '#DDCC66' },
] as const;

export class GameModePicker {
  private overlay: HTMLDivElement | null = null;
  private escHandler: ((e: KeyboardEvent) => void) | null = null;

  show(opts: GameModePickerOptions): void {
    if (this.overlay) return;

    const overlay = document.createElement('div');
    overlay.style.cssText = `
      position:fixed;inset:0;z-index:9999;
      background:${C.overlay};backdrop-filter:${C.panelBlur};-webkit-backdrop-filter:${C.panelBlur};
      display:flex;align-items:center;justify-content:center;
      opacity:0;transition:opacity 0.25s ease;
      pointer-events:all;
    `;
    this.overlay = overlay;

    // Block ALL clicks behind the overlay
    overlay.addEventListener('click', (e) => e.stopPropagation());
    overlay.addEventListener('mousedown', (e) => {
      if (e.target === overlay) this.close();
      e.stopPropagation();
    });

    const panel = document.createElement('div');
    panel.style.cssText = `
      width:min(500px,88vw);
      background:${C.panelBg};
      border:2px solid ${C.panelBorder};border-radius:12px;
      box-shadow:${C.panelShadow};
      padding:24px 28px 20px;
      transform:scale(0.92);transition:transform 0.3s cubic-bezier(0.16,1,0.3,1);
    `;

    // Title — medieval style
    const title = document.createElement('div');
    title.style.cssText = `
      text-align:center;font-family:'Fredoka',sans-serif;font-size:20px;font-weight:700;
      color:${C.gold};letter-spacing:2px;margin-bottom:18px;
      text-shadow:0 2px 4px rgba(0,0,0,0.4);
    `;
    title.textContent = 'CHOOSE GAME MODE';
    panel.appendChild(title);

    // Divider
    const divider = document.createElement('div');
    divider.style.cssText = `height:1px;background:linear-gradient(90deg,transparent,${C.panelBorder},transparent);margin-bottom:18px;`;
    panel.appendChild(divider);

    // 2x2 grid of medieval-styled cards
    const grid = document.createElement('div');
    grid.style.cssText = 'display:grid;grid-template-columns:1fr 1fr;gap:12px;';

    for (const mode of MODES) {
      const card = document.createElement('button');
      card.style.cssText = `
        position:relative;
        background:${mode.fill};
        border:2px solid ${mode.border};border-radius:8px;
        padding:20px 14px;cursor:pointer;text-align:center;
        transition:all 0.15s ease;
        box-shadow:0 3px 0 3px rgba(0,0,0,0.4), inset 0 1px 0 rgba(255,255,255,0.06);
      `;

      // Inner highlight strip
      const hl = document.createElement('div');
      hl.style.cssText = `
        position:absolute;top:3px;left:4px;right:4px;height:33%;
        background:${mode.highlight}18;border-radius:4px;pointer-events:none;
      `;
      card.appendChild(hl);

      // Inner border
      const ib = document.createElement('div');
      ib.style.cssText = `position:absolute;inset:2px;border:1px solid rgba(0,0,0,0.3);border-radius:6px;pointer-events:none;`;
      card.appendChild(ib);

      // Corner rivets
      const rivet = (t: string, l: string) => {
        const r = document.createElement('div');
        r.style.cssText = `position:absolute;${t};${l};width:5px;height:5px;border-radius:50%;background:rgba(139,115,85,0.9);box-shadow:0 1px 0 rgba(0,0,0,0.4),inset 0 -0.5px 0 rgba(255,255,255,0.2);pointer-events:none;`;
        return r;
      };
      card.append(rivet('top:7px','left:8px'), rivet('top:7px','right:8px'), rivet('bottom:7px','left:8px'), rivet('bottom:7px','right:8px'));

      // Content (above decorations)
      const content = document.createElement('div');
      content.style.cssText = 'position:relative;z-index:1;';
      content.innerHTML = `
        <div style="font-size:28px;margin-bottom:4px;">${mode.emoji}</div>
        <div style="font-family:'Fredoka',sans-serif;font-size:16px;font-weight:700;color:#e8e0c8;letter-spacing:1px;text-shadow:0 1px 3px rgba(0,0,0,0.5);">${mode.label}</div>
        <div style="font-size:11px;color:rgba(232,224,200,0.5);margin-top:3px;font-family:'Nunito',sans-serif;">${mode.desc}</div>
      `;
      card.appendChild(content);

      card.onmouseenter = () => {
        card.style.transform = 'scale(1.06)';
        card.style.background = mode.highlight + '66';
        card.style.borderColor = '#FFD93D';
        const labelEl = content.children[1] as HTMLElement;
        if (labelEl) labelEl.style.color = '#FFD93D';
      };
      card.onmouseleave = () => {
        card.style.transform = 'scale(1)';
        card.style.background = mode.fill;
        card.style.borderColor = mode.border;
        const labelEl = content.children[1] as HTMLElement;
        if (labelEl) labelEl.style.color = '#e8e0c8';
      };
      card.onmousedown = () => { card.style.transform = 'scale(0.94)'; };
      card.onmouseup = () => { card.style.transform = 'scale(1.06)'; };
      card.onclick = () => {
        this.close();
        if (mode.id === 'solo') opts.onSolo();
        else if (mode.id === 'unranked') opts.onUnranked();
        else if (mode.id === 'ranked') opts.onRanked();
        else if (mode.id === 'friendly') opts.onFriendly();
      };
      grid.appendChild(card);
    }
    panel.appendChild(grid);

    // Cancel — muted text link
    const cancel = document.createElement('div');
    cancel.style.cssText = `
      text-align:center;margin-top:14px;font-size:12px;font-weight:600;
      color:${C.textMuted};cursor:pointer;transition:color 0.15s;
      font-family:'Nunito',sans-serif;
    `;
    cancel.textContent = 'Cancel';
    cancel.onmouseenter = () => { cancel.style.color = C.red; };
    cancel.onmouseleave = () => { cancel.style.color = C.textMuted; };
    cancel.onclick = () => this.close();
    panel.appendChild(cancel);

    overlay.appendChild(panel);
    document.body.appendChild(overlay);

    // ESC to close
    this.escHandler = (e: KeyboardEvent) => { if (e.key === 'Escape') this.close(); };
    window.addEventListener('keydown', this.escHandler);

    // Animate in
    requestAnimationFrame(() => requestAnimationFrame(() => {
      overlay.style.opacity = '1';
      panel.style.transform = 'scale(1)';
    }));
  }

  close(): void {
    if (!this.overlay) return;
    if (this.escHandler) {
      window.removeEventListener('keydown', this.escHandler);
      this.escHandler = null;
    }
    this.overlay.style.opacity = '0';
    const ol = this.overlay;
    setTimeout(() => ol.remove(), 250);
    this.overlay = null;
  }
}
