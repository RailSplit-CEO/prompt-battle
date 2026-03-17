// ─── EmoteRenderer — BIG screen-side emote display ────────────────
// Shows emoji large on the left (opponent) or right (yours) side of the screen.
// Uses a CSS pop animation that scales in, holds, then fades out.

import { EMOTE_EMOJIS } from '../ui/EmoteWheel';

export class EmoteRenderer {
  private activeEmotes: HTMLDivElement[] = [];

  /**
   * Show an emote BIG on one side of the screen.
   * @param emoteId  The emote item ID (e.g. 'emote_smile').
   * @param side     'right' for your emotes, 'left' for opponent.
   */
  showEmote(emoteId: string, side: 'left' | 'right'): void {
    const emoji = EMOTE_EMOJIS[emoteId] || '\u2753';

    // Inject animation keyframes once
    if (!document.getElementById('emote-anim-style')) {
      const style = document.createElement('style');
      style.id = 'emote-anim-style';
      style.textContent = `
        @keyframes emote-pop-right {
          0%   { opacity:0; transform:translateY(-50%) scale(0.3); }
          15%  { opacity:1; transform:translateY(-50%) scale(1.2); }
          25%  { transform:translateY(-50%) scale(1); }
          75%  { opacity:1; transform:translateY(-50%) scale(1); }
          100% { opacity:0; transform:translateY(-60%) scale(0.8); }
        }
        @keyframes emote-pop-left {
          0%   { opacity:0; transform:translateY(-50%) scale(0.3); }
          15%  { opacity:1; transform:translateY(-50%) scale(1.2); }
          25%  { transform:translateY(-50%) scale(1); }
          75%  { opacity:1; transform:translateY(-50%) scale(1); }
          100% { opacity:0; transform:translateY(-60%) scale(0.8); }
        }
      `;
      document.head.appendChild(style);
    }

    const el = document.createElement('div');
    el.style.cssText = `
      position:fixed;
      ${side}:5%;
      top:50%;
      transform:translateY(-50%);
      font-size:120px;
      z-index:500;
      pointer-events:none;
      opacity:0;
      filter:drop-shadow(0 4px 20px rgba(0,0,0,0.5));
      animation:emote-pop-${side} 2.5s ease-out forwards;
    `;
    el.textContent = emoji;
    document.body.appendChild(el);
    this.activeEmotes.push(el);

    // Remove after animation completes
    setTimeout(() => {
      el.remove();
      this.activeEmotes = this.activeEmotes.filter(e => e !== el);
    }, 2500);
  }

  /** Clean up all active emote elements. Call on scene shutdown. */
  destroy(): void {
    for (const e of this.activeEmotes) e.remove();
    this.activeEmotes = [];
  }
}
