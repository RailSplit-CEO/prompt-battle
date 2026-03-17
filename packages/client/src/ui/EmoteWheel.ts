// ─── EmoteWheel — Radial emote picker DOM overlay ────────────────
// Opens on hotkey (T / E), shows owned emotes as clickable buttons.
// Unowned emotes are dimmed with a lock overlay.
// 3 free emotes are available to everyone: GG, Wave, WOW.

import { C } from './UIColors';
import { InventoryManager } from '../store/InventoryManager';
import { CatalogService } from '../store/CatalogService';

// ── Emote definitions — loaded from catalog ──────────────────────

interface EmoteDef {
  id: string;
  emoji: string;
  label: string;
}

// Emoji lookup for emotes (maps item ID → display emoji)
export const EMOTE_EMOJIS: Record<string, string> = {
  emote_gg: '\uD83E\uDD1D', emote_wave: '\uD83D\uDC4B', emote_wow: '\uD83D\uDE2E',
  emote_thumbsup: '\uD83D\uDC4D', emote_thumbsdown: '\uD83D\uDC4E', emote_clap: '\uD83D\uDC4F',
  emote_smile: '\uD83D\uDE04', emote_wink: '\uD83D\uDE09', emote_think: '\uD83E\uDD14',
  emote_shrug: '\uD83E\uDD37', emote_pray: '\uD83D\uDE4F', emote_ok: '\uD83D\uDC4C',
  emote_peace: '\u270C\uFE0F', emote_salute: '\uD83E\uDEE1', emote_eyes: '\uD83D\uDC40',
  emote_lol: '\uD83D\uDE02', emote_cry: '\uD83D\uDE22', emote_rage: '\uD83D\uDE21',
  emote_heart: '\u2764\uFE0F', emote_broken: '\uD83D\uDC94', emote_sleepy: '\uD83D\uDE34',
  emote_sweat: '\uD83D\uDE05', emote_scream: '\uD83D\uDE31', emote_cool: '\uD83D\uDE0E',
  emote_nerd: '\uD83E\uDD13', emote_dizzy: '\uD83D\uDE35', emote_sick: '\uD83E\uDD22',
  emote_hot: '\uD83E\uDD75', emote_cold: '\uD83E\uDD76', emote_mindblown: '\uD83E\uDD2F',
  emote_crown: '\uD83D\uDC51', emote_skull: '\uD83D\uDC80', emote_fire: '\uD83D\uDD25',
  emote_sword: '\u2694\uFE0F', emote_shield: '\uD83D\uDEE1\uFE0F', emote_trophy: '\uD83C\uDFC6',
  emote_medal: '\uD83C\uDFC5', emote_muscle: '\uD83D\uDCAA', emote_fist: '\uD83E\uDD1C',
  emote_handshake: '\uD83E\uDD1D', emote_target: '\uD83C\uDFAF', emote_bomb: '\uD83D\uDCA3',
  emote_lightning: '\u26A1', emote_tornado: '\uD83C\uDF2A\uFE0F', emote_ghost: '\uD83D\uDC7B',
  emote_alien: '\uD83D\uDC7D', emote_robot: '\uD83E\uDD16', emote_devil: '\uD83D\uDE08',
  emote_angel: '\uD83D\uDE07', emote_money: '\uD83D\uDCB0',
  emote_dragon: '\uD83D\uDC09', emote_wolf: '\uD83D\uDC3A', emote_snake: '\uD83D\uDC0D',
  emote_eagle: '\uD83E\uDD85', emote_bear: '\uD83D\uDC3B', emote_spider_e: '\uD83D\uDD77\uFE0F',
  emote_bat: '\uD83E\uDD87', emote_octopus: '\uD83D\uDC19', emote_phoenix: '\uD83D\uDD25',
  emote_unicorn: '\uD83E\uDD84',
  emote_dancing: '\uD83D\uDD7A', emote_flexing: '\uD83E\uDDD8', emote_laughing: '\uD83E\uDD23',
  emote_sleeping: '\uD83D\uDE34', emote_explosion: '\uD83D\uDCA5', emote_sparkles: '\u2728',
  emote_rainbow: '\uD83C\uDF08', emote_star: '\u2B50', emote_moon: '\uD83C\uDF19',
  emote_sun: '\u2600\uFE0F', emote_comet: '\u2604\uFE0F', emote_crystal: '\uD83D\uDD2E',
  emote_magic: '\uD83E\uDE84', emote_potion: '\uD83E\uDDEA', emote_dice: '\uD83C\uDFB2',
  emote_battle_cry: '\uD83D\uDDE3\uFE0F', emote_mock: '\uD83E\uDD2A', emote_cheer: '\uD83C\uDF89',
  emote_rip: '\uD83E\uDEA6', emote_clown: '\uD83E\uDD21',
  emote_infinity: '\u267E\uFE0F', emote_diamond: '\uD83D\uDC8E', emote_trident: '\uD83D\uDD31',
  emote_eye_of_ra: '\uD83D\uDC41\uFE0F', emote_yin_yang: '\u262F\uFE0F',
};

function getEmoteDefs(): EmoteDef[] {
  const catalog = CatalogService.getInstance();
  return catalog.getByCategory('emote').map(item => ({
    id: item.id,
    emoji: EMOTE_EMOJIS[item.id] || '\u2753',
    label: item.name,
  }));
}

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

    const emoteDefs = getEmoteDefs();
    for (const def of emoteDefs) {
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
