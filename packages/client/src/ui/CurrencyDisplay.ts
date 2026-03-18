// ─── CurrencyDisplay — Crown + Glory balance widget ─────────────
// Small inline widget used in the Store header and elsewhere.
// Subscribes to WalletManager for live updates.

import { C } from './UIColors';
import { WalletManager } from '../store/WalletManager';

/** Global singleton so animation callers can find the active display */
let activeInstance: CurrencyDisplay | null = null;

export class CurrencyDisplay {
  private el: HTMLDivElement;
  private crownsEl: HTMLSpanElement;
  private gloryEl: HTMLSpanElement;
  private unsubscribe: (() => void) | null = null;

  constructor() {
    const wallet = WalletManager.getInstance();
    activeInstance = this;

    // Root container
    this.el = document.createElement('div');
    this.el.style.cssText = `
      display:inline-flex;align-items:center;gap:14px;
      font-family:"Fredoka",sans-serif;font-size:18px;font-weight:700;
    `;

    // ── Crowns ──
    const crownsWrap = document.createElement('div');
    crownsWrap.style.cssText = `
      display:inline-flex;align-items:center;gap:6px;
      background:${C.surface};padding:8px 14px;border-radius:10px;
      border:1px solid ${C.divider};min-width:80px;
    `;

    const crownsIcon = document.createElement('span');
    crownsIcon.textContent = '\u{1F451}';
    crownsIcon.style.cssText = 'font-size:20px;line-height:1;';
    crownsWrap.appendChild(crownsIcon);

    this.crownsEl = document.createElement('span');
    this.crownsEl.style.cssText = `color:${C.gold};min-width:32px;text-align:right;font-size:18px;`;
    this.crownsEl.textContent = String(wallet.crowns);
    crownsWrap.appendChild(this.crownsEl);

    this.el.appendChild(crownsWrap);

    // ── Glory ──
    const gloryWrap = document.createElement('div');
    gloryWrap.style.cssText = `
      display:inline-flex;align-items:center;gap:6px;
      background:${C.surface};padding:8px 14px;border-radius:10px;
      border:1px solid ${C.divider};min-width:80px;
    `;

    const gloryIcon = document.createElement('span');
    gloryIcon.textContent = '\u2605';
    gloryIcon.style.cssText = 'font-size:20px;line-height:1;color:#C0C0D2;';
    gloryWrap.appendChild(gloryIcon);

    this.gloryEl = document.createElement('span');
    this.gloryEl.style.cssText = `color:#C0C0D2;min-width:32px;text-align:right;font-size:18px;`;
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

  /** Get the crowns number element (fly animation target) */
  getCrownsEl(): HTMLElement {
    return this.crownsEl;
  }

  /** Get the glory number element (fly animation target) */
  getGloryEl(): HTMLElement {
    return this.gloryEl;
  }

  destroy(): void {
    this.unsubscribe?.();
    this.unsubscribe = null;
    if (activeInstance === this) activeInstance = null;
  }

  /** Get the currently mounted CurrencyDisplay instance (if any) */
  static getActive(): CurrencyDisplay | null {
    return activeInstance;
  }
}
