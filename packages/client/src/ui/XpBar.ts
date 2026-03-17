// ─── XpBar — Reusable XP progress bar widget ─────────────────────
// Shows [Level badge] [progress bar] [XP text].
// Can auto-subscribe to PlayerLevelManager for live updates.

import { C } from './UIColors';

export class XpBar {
  private el: HTMLDivElement;
  private fillEl: HTMLDivElement;
  private labelEl: HTMLSpanElement;
  private levelEl: HTMLSpanElement;
  private unsubscribe: (() => void) | null = null;

  constructor(compact = false) {
    this.el = document.createElement('div');
    this.el.style.cssText = `display:flex;align-items:center;gap:${compact ? '6' : '10'}px;width:100%;`;

    // ── Level badge (gold circle) ──
    this.levelEl = document.createElement('span');
    this.levelEl.style.cssText = `
      display:flex;align-items:center;justify-content:center;
      width:${compact ? '28' : '36'}px;height:${compact ? '28' : '36'}px;
      border-radius:50%;background:${C.gold};color:#1a1a0a;
      font:bold ${compact ? '12' : '15'}px 'Fredoka',sans-serif;
      flex-shrink:0;box-shadow:0 2px 8px rgba(255,217,61,0.3);
    `;
    this.levelEl.textContent = '1';
    this.el.appendChild(this.levelEl);

    // ── Bar container ──
    const bar = document.createElement('div');
    bar.style.cssText = `
      flex:1;height:${compact ? '8' : '12'}px;background:rgba(139,115,85,0.25);
      border-radius:${compact ? '4' : '6'}px;overflow:hidden;position:relative;
    `;
    this.fillEl = document.createElement('div');
    this.fillEl.style.cssText = `
      height:100%;width:0%;border-radius:inherit;
      background:linear-gradient(90deg,${C.gold},${C.teal});
      transition:width 0.5s ease;
    `;
    bar.appendChild(this.fillEl);
    this.el.appendChild(bar);

    // ── XP label ──
    this.labelEl = document.createElement('span');
    this.labelEl.style.cssText = `
      font:${compact ? '10' : '12'}px 'Nunito',sans-serif;color:${C.textMuted};
      white-space:nowrap;flex-shrink:0;
    `;
    this.labelEl.textContent = '0 / 200 XP';
    this.el.appendChild(this.labelEl);
  }

  update(level: number, xpInLevel: number, xpForNext: number): void {
    this.levelEl.textContent = String(level);
    const pct = xpForNext > 0 ? Math.min(100, (xpInLevel / xpForNext) * 100) : 100;
    this.fillEl.style.width = pct + '%';
    this.labelEl.textContent = xpForNext > 0 ? `${xpInLevel} / ${xpForNext} XP` : 'MAX';
  }

  /** Auto-subscribe to PlayerLevelManager for live updates. */
  autoSubscribe(): void {
    import('../store/PlayerLevelManager').then(({ PlayerLevelManager }) => {
      const mgr = PlayerLevelManager.getInstance();
      this.update(mgr.level, mgr.xpInLevel, mgr.xpForNext);
      this.unsubscribe = mgr.onChange(() => {
        this.update(mgr.level, mgr.xpInLevel, mgr.xpForNext);
      });
    }).catch(() => {
      /* PlayerLevelManager not initialized — leave at defaults */
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
