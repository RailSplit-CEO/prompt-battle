// ─── EmoteWheel — Radial emote picker DOM overlay ────────────────
// Opens on hotkey (T / E), shows owned emotes as clickable buttons.
// Unowned emotes are dimmed with a lock overlay.
// 3 free emotes are available to everyone: GG, Wave, WOW.

import { C } from './UIColors';
import { InventoryManager } from '../store/InventoryManager';

// ── Emote definitions ────────────────────────────────────────────

interface EmoteDef {
  id: string;
  emoji: string;
  label: string;
}

const EMOTE_DEFS: EmoteDef[] = [
  { id: 'emote_gg', emoji: '🤝', label: 'GG' },
  { id: 'emote_wow', emoji: '😮', label: 'WOW' },
  { id: 'emote_lol', emoji: '😂', label: 'LOL' },
  { id: 'emote_cry', emoji: '😢', label: 'Cry' },
  { id: 'emote_rage', emoji: '😡', label: 'Rage' },
  { id: 'emote_heart', emoji: '❤️', label: 'Heart' },
  { id: 'emote_crown', emoji: '👑', label: 'Crown' },
  { id: 'emote_wave', emoji: '👋', label: 'Wave' },
  { id: 'emote_dancing', emoji: '💃', label: 'Dance' },
  { id: 'emote_flexing', emoji: '💪', label: 'Flex' },
  { id: 'emote_laughing', emoji: '🤣', label: 'Laugh' },
  { id: 'emote_sleeping', emoji: '😴', label: 'Sleep' },
  { id: 'emote_battle_cry', emoji: '⚔️', label: 'Battle!' },
  { id: 'emote_mock', emoji: '🤪', label: 'Mock' },
  { id: 'emote_cheer', emoji: '🎉', label: 'Cheer' },
];

/** Emotes available to all players regardless of inventory. */
const FREE_EMOTE_IDS = new Set(['emote_gg', 'emote_wave', 'emote_wow']);

// ─── EmoteWheel class ────────────────────────────────────────────

export class EmoteWheel {
  private overlay: HTMLDivElement | null = null;
  private onSelect: ((emoteId: string) => void) | null = null;
  private escHandler: ((e: KeyboardEvent) => void) | null = null;

  /**
   * Show the emote wheel centered on screen.
   * @param onSelect Called with the chosen emote ID when the player picks one.
   */
  show(onSelect: (emoteId: string) => void): void {
    if (this.overlay) return;
    this.onSelect = onSelect;

    const inventory = InventoryManager.getInstance();

    // ── Overlay (semi-transparent backdrop, click-outside-to-close) ──
    const overlay = document.createElement('div');
    overlay.id = 'emote-wheel-overlay';
    Object.assign(overlay.style, {
      position: 'fixed',
      inset: '0',
      zIndex: '9998',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      background: 'rgba(0,0,0,0.35)',
    } satisfies Partial<CSSStyleDeclaration>);

    // Click on backdrop → close
    overlay.addEventListener('mousedown', (e) => {
      if (e.target === overlay) this.close();
    });

    // ── Panel ────────────────────────────────────────────────────────
    const panel = document.createElement('div');
    Object.assign(panel.style, {
      background: C.panelBg,
      border: `1px solid ${C.panelBorder}`,
      borderRadius: '16px',
      boxShadow: C.panelShadow,
      backdropFilter: C.panelBlur,
      maxWidth: '400px',
      width: '90vw',
      padding: '20px 16px 16px',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      gap: '12px',
      animation: 'emoteWheelFadeIn 0.15s ease-out',
    } satisfies Partial<CSSStyleDeclaration>);

    // ── Title ────────────────────────────────────────────────────────
    const title = document.createElement('div');
    title.textContent = 'Send Emote';
    Object.assign(title.style, {
      color: C.gold,
      fontSize: '15px',
      fontWeight: '700',
      fontFamily: '"Nunito", sans-serif',
      letterSpacing: '0.5px',
      textTransform: 'uppercase' as const,
    });
    panel.appendChild(title);

    // ── Emote grid ───────────────────────────────────────────────────
    const grid = document.createElement('div');
    Object.assign(grid.style, {
      display: 'flex',
      flexWrap: 'wrap',
      justifyContent: 'center',
      gap: '8px',
      width: '100%',
    } satisfies Partial<CSSStyleDeclaration>);

    for (const def of EMOTE_DEFS) {
      const owned = FREE_EMOTE_IDS.has(def.id) || inventory.owns(def.id);
      const btn = this.createEmoteButton(def, owned);
      grid.appendChild(btn);
    }

    panel.appendChild(grid);

    // ── Hint text ────────────────────────────────────────────────────
    const hint = document.createElement('div');
    hint.textContent = 'ESC to close';
    Object.assign(hint.style, {
      color: C.textMuted,
      fontSize: '11px',
      fontFamily: '"Nunito", sans-serif',
      marginTop: '4px',
    });
    panel.appendChild(hint);

    overlay.appendChild(panel);

    // ── Inject keyframe animation ────────────────────────────────────
    if (!document.getElementById('emote-wheel-keyframes')) {
      const style = document.createElement('style');
      style.id = 'emote-wheel-keyframes';
      style.textContent = `
        @keyframes emoteWheelFadeIn {
          from { opacity: 0; transform: scale(0.92); }
          to   { opacity: 1; transform: scale(1); }
        }
      `;
      document.head.appendChild(style);
    }

    // ── ESC handler ──────────────────────────────────────────────────
    this.escHandler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        this.close();
      }
    };
    window.addEventListener('keydown', this.escHandler, true);

    document.body.appendChild(overlay);
    this.overlay = overlay;
  }

  /** Close the wheel without selecting anything. */
  close(): void {
    if (this.escHandler) {
      window.removeEventListener('keydown', this.escHandler, true);
      this.escHandler = null;
    }
    this.overlay?.remove();
    this.overlay = null;
    this.onSelect = null;
  }

  /** Whether the wheel is currently visible. */
  get isOpen(): boolean {
    return this.overlay !== null;
  }

  // ── Private helpers ────────────────────────────────────────────────

  private createEmoteButton(def: EmoteDef, owned: boolean): HTMLButtonElement {
    const btn = document.createElement('button');
    Object.assign(btn.style, {
      position: 'relative',
      width: '56px',
      height: '68px',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      gap: '2px',
      background: owned ? C.surface : 'transparent',
      border: `1.5px solid ${owned ? C.gold : C.divider}`,
      borderRadius: '10px',
      cursor: owned ? 'pointer' : 'default',
      opacity: owned ? '1' : '0.3',
      transition: 'all 0.15s ease',
      padding: '0',
      outline: 'none',
    } satisfies Partial<CSSStyleDeclaration>);

    // Emoji
    const emoji = document.createElement('span');
    emoji.textContent = def.emoji;
    Object.assign(emoji.style, {
      fontSize: '24px',
      lineHeight: '1',
      display: 'block',
      pointerEvents: 'none',
    });
    btn.appendChild(emoji);

    // Label
    const label = document.createElement('span');
    label.textContent = def.label;
    Object.assign(label.style, {
      fontSize: '10px',
      fontFamily: '"Nunito", sans-serif',
      fontWeight: '600',
      color: owned ? C.textPrimary : C.textMuted,
      lineHeight: '1',
      pointerEvents: 'none',
    });
    btn.appendChild(label);

    // Lock icon for unowned emotes
    if (!owned) {
      const lock = document.createElement('span');
      lock.textContent = '\uD83D\uDD12';
      Object.assign(lock.style, {
        position: 'absolute',
        top: '2px',
        right: '2px',
        fontSize: '10px',
        pointerEvents: 'none',
      });
      btn.appendChild(lock);
    }

    // Interaction
    if (owned) {
      btn.addEventListener('mouseenter', () => {
        btn.style.background = C.surfaceActive;
        btn.style.boxShadow = `0 0 10px rgba(255,217,61,0.25)`;
        btn.style.borderColor = C.gold;
        btn.style.transform = 'scale(1.08)';
      });
      btn.addEventListener('mouseleave', () => {
        btn.style.background = C.surface;
        btn.style.boxShadow = 'none';
        btn.style.borderColor = C.gold;
        btn.style.transform = 'scale(1)';
      });
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const callback = this.onSelect;
        this.close();
        callback?.(def.id);
      });
    }

    return btn;
  }
}
