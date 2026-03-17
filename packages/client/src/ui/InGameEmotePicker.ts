// ─── InGameEmotePicker — small popup grid for in-game emote selection ──
// Appears above the emote button (NOT full-screen like EmoteWheel).
// Only shows owned emotes + free emotes as clickable buttons.

import { C } from './UIColors';
import { EMOTE_EMOJIS } from './EmoteWheel';
import { InventoryManager } from '../store/InventoryManager';

/** Emotes available to every player regardless of inventory. */
const FREE_EMOTES = new Set(['emote_smile', 'emote_gg', 'emote_wave', 'emote_wow']);

export class InGameEmotePicker {
  private el: HTMLDivElement | null = null;
  private outsideHandler: ((e: MouseEvent) => void) | null = null;

  /**
   * Show or toggle the emote picker popup.
   * @param anchorRight  CSS `right` value in px for the popup.
   * @param anchorBottom CSS `bottom` value in px for the popup.
   * @param onSelect     Called with the chosen emote ID.
   */
  show(anchorRight: number, anchorBottom: number, onSelect: (emoteId: string) => void): void {
    if (this.el) { this.close(); return; } // toggle off

    // Inject animation once
    if (!document.getElementById('emote-picker-anim')) {
      const style = document.createElement('style');
      style.id = 'emote-picker-anim';
      style.textContent = `
        @keyframes emote-picker-in {
          from { opacity:0; transform:translateY(10px); }
          to   { opacity:1; transform:translateY(0); }
        }
      `;
      document.head.appendChild(style);
    }

    const el = document.createElement('div');
    el.id = 'ingame-emote-picker';
    el.style.cssText = `
      position:fixed;
      right:${anchorRight}px;
      bottom:${anchorBottom}px;
      width:240px;
      max-height:280px;
      background:${C.panelBg};
      border:2px solid ${C.panelBorder};
      border-radius:12px;
      box-shadow:${C.panelShadow};
      backdrop-filter:blur(12px);
      -webkit-backdrop-filter:blur(12px);
      z-index:300;
      pointer-events:all;
      display:flex;
      flex-wrap:wrap;
      gap:4px;
      padding:8px;
      overflow-y:auto;
      animation:emote-picker-in 0.15s ease-out;
      scrollbar-width:thin;
      scrollbar-color:rgba(139,115,85,0.4) transparent;
    `;

    const inv = InventoryManager.getInstance();

    // Show only owned + free emotes
    const allEmoteIds = Object.keys(EMOTE_EMOJIS).filter(id => id.startsWith('emote_'));

    for (const emoteId of allEmoteIds) {
      const owned = inv.owns(emoteId) || FREE_EMOTES.has(emoteId);
      if (!owned) continue;

      const btn = document.createElement('button');
      btn.style.cssText = `
        width:40px;height:40px;
        border:none;border-radius:8px;
        background:${C.surface};
        cursor:pointer;
        font-size:24px;
        display:flex;align-items:center;justify-content:center;
        transition:all 0.1s;
        padding:0;
      `;
      btn.textContent = EMOTE_EMOJIS[emoteId] || '?';
      btn.title = emoteId.replace('emote_', '');

      btn.addEventListener('mouseenter', () => {
        btn.style.background = C.surfaceHover;
        btn.style.transform = 'scale(1.15)';
      });
      btn.addEventListener('mouseleave', () => {
        btn.style.background = C.surface;
        btn.style.transform = 'scale(1)';
      });
      btn.addEventListener('click', () => {
        this.close();
        onSelect(emoteId);
      });

      el.appendChild(btn);
    }

    document.body.appendChild(el);
    this.el = el;

    // Close on click outside (after a short delay to avoid instant close)
    setTimeout(() => {
      this.outsideHandler = (e: MouseEvent) => {
        if (this.el && !this.el.contains(e.target as Node)) {
          this.close();
        }
      };
      document.addEventListener('mousedown', this.outsideHandler);
    }, 50);
  }

  /** Close the picker popup. */
  close(): void {
    if (this.outsideHandler) {
      document.removeEventListener('mousedown', this.outsideHandler);
      this.outsideHandler = null;
    }
    this.el?.remove();
    this.el = null;
  }

  /** Whether the picker is currently visible. */
  get isOpen(): boolean {
    return this.el !== null;
  }
}
