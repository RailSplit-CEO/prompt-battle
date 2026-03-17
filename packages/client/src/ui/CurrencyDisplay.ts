// ─── CurrencyDisplay — Crown + Glory balance widget ─────────────
// Small inline widget used in the Store header and elsewhere.
// Subscribes to WalletManager for live updates.

import { C } from './UIColors';
import { WalletManager } from '../store/WalletManager';

export class CurrencyDisplay {
  private el: HTMLDivElement;
  private crownsEl: HTMLSpanElement;
  private gloryEl: HTMLSpanElement;
  private unsubscribe: (() => void) | null = null;

  constructor() {
    const wallet = WalletManager.getInstance();

    // Root container
    this.el = document.createElement('div');
    this.el.style.cssText = `
      display:inline-flex;align-items:center;gap:12px;
      font-family:"Fredoka",sans-serif;font-size:14px;font-weight:700;
    `;

    // ── Crowns ──
    const crownsWrap = document.createElement('div');
    crownsWrap.style.cssText = `
      display:inline-flex;align-items:center;gap:4px;
      background:${C.surface};padding:4px 10px;border-radius:8px;
      border:1px solid ${C.divider};
    `;

    const crownsIcon = document.createElement('span');
    crownsIcon.textContent = '\u{1F451}';
    crownsIcon.style.cssText = 'font-size:14px;line-height:1;';
    crownsWrap.appendChild(crownsIcon);

    this.crownsEl = document.createElement('span');
    this.crownsEl.style.cssText = `color:${C.gold};min-width:28px;text-align:right;`;
    this.crownsEl.textContent = String(wallet.crowns);
    crownsWrap.appendChild(this.crownsEl);

    this.el.appendChild(crownsWrap);

    // ── Glory ──
    const gloryWrap = document.createElement('div');
    gloryWrap.style.cssText = `
      display:inline-flex;align-items:center;gap:4px;
      background:${C.surface};padding:4px 10px;border-radius:8px;
      border:1px solid ${C.divider};
    `;

    const gloryIcon = document.createElement('span');
    gloryIcon.textContent = '\u2B50';
    gloryIcon.style.cssText = 'font-size:14px;line-height:1;';
    gloryWrap.appendChild(gloryIcon);

    this.gloryEl = document.createElement('span');
    this.gloryEl.style.cssText = `color:${C.teal};min-width:28px;text-align:right;`;
    this.gloryEl.textContent = String(wallet.glory);
    gloryWrap.appendChild(this.gloryEl);

    this.el.appendChild(gloryWrap);

    // ── Subscribe to wallet changes ──
    this.unsubscribe = wallet.onChange((w) => {
      this.crownsEl.textContent = String(w.crowns);
      this.gloryEl.textContent = String(w.glory);
    });
  }

  getElement(): HTMLElement {
    return this.el;
  }

  destroy(): void {
    this.unsubscribe?.();
    this.unsubscribe = null;
  }
}
