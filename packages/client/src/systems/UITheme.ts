// ─── Centralized UI Theme ────────────────────────────────────────
// Single source of truth for all colors, fonts, spacing, and panel styles.
// Import this everywhere instead of hardcoding values.

export const UITheme = {
  // ─── Colors ─────────────────────────────────────────────────
  colors: {
    // Primary palette
    gold:        '#FFD93D',
    goldDark:    '#E6A800',
    goldDim:     'rgba(255,217,61,0.3)',
    teal:        '#45E6B0',
    red:         '#FF6B6B',
    pink:        '#FF6B9D',
    purple:      '#C98FFF',
    purpleDark:  '#9B7FD4',
    orange:      '#FF9F43',
    blue:        '#6CC4FF',

    // Backgrounds
    bgDark:      '#0f1a0a',
    bgPanel:     'rgba(212,196,160,0.88)',
    bgPanelSolid:'rgba(212,196,160,0.9)',
    bgGlow:      '#1a2e10',
    bgDeep:      '#243a18',

    // Borders & muted
    border:      'rgba(139,115,85,0.6)',
    borderSolid: '#8B7355',
    borderLight: 'rgba(139,115,85,0.5)',
    disabled:    '#8B7355',

    // Text
    textPrimary: '#d4c8a0',
    textDark:    '#4a3520',
    textDarkAlt: '#2a1a0a',
    textLight:   '#e8e0c8',
    textMuted:   '#6a5a4a',
    textBrown:   '#8B5E34',

    // Scrollbar
    scrollThumb: 'rgba(139,115,85,0.4)',
    scrollTrack: 'rgba(139,115,85,0.15)',
  },

  // ─── Colors (hex for Phaser) ────────────────────────────────
  hex: {
    gold:       0xFFD93D,
    goldDark:   0xE6A800,
    teal:       0x45E6B0,
    red:        0xFF6B6B,
    pink:       0xFF6B9D,
    purple:     0xC98FFF,
    orange:     0xFF9F43,
    blue:       0x6CC4FF,
    bgDark:     0x0f1a0a,
    bgGlow:     0x1a2e10,
    bgDeep:     0x243a18,
    border:     0x8B7355,
    borderDark: 0x6B5335,
    panelFill:  0xd4c4a0,
    black:      0x000000,

    // Button schemes
    btnGreen:      0x3a6a2e,
    btnGreenBorder:0x5a9a4e,
    btnGreenHi:    0x8BC47A,
    btnRed:        0x8B3333,
    btnRedBorder:  0xBB4444,
    btnRedHi:      0xDD6666,
    btnBlue:       0x2a5a8a,
    btnBlueBorder: 0x4a8aBB,
    btnBlueHi:     0x6aAADD,
    btnYellow:     0x7a6a2a,
    btnYellowBorder:0xAA9944,
    btnYellowHi:   0xDDCC66,
  },

  // ─── Fonts ──────────────────────────────────────────────────
  fonts: {
    title:  '"Fredoka", sans-serif',
    body:   '"Nunito", sans-serif',
  },

  // ─── Standard text style presets (Phaser) ───────────────────
  text: {
    title: {
      fontSize: '56px', color: '#FFD93D',
      fontFamily: '"Fredoka", sans-serif', fontStyle: 'bold',
      stroke: '#3a2a10', strokeThickness: 6,
    } as Phaser.Types.GameObjects.Text.TextStyle,

    subtitle: {
      fontSize: '15px', color: '#a89870',
      fontFamily: '"Nunito", sans-serif', fontStyle: 'bold',
      stroke: '#0a0f06', strokeThickness: 3,
    } as Phaser.Types.GameObjects.Text.TextStyle,

    button: {
      fontSize: '18px', color: '#e8e0c8',
      fontFamily: '"Fredoka", sans-serif', fontStyle: 'bold',
      letterSpacing: 2, stroke: '#000000', strokeThickness: 3,
    } as Phaser.Types.GameObjects.Text.TextStyle,

    body: {
      fontSize: '14px', color: '#e8e0c8',
      fontFamily: '"Nunito", sans-serif', fontStyle: '700',
      stroke: '#0a0f06', strokeThickness: 1,
    } as Phaser.Types.GameObjects.Text.TextStyle,

    label: {
      fontSize: '12px', color: '#a89870',
      fontFamily: '"Nunito", sans-serif', fontStyle: '600',
    } as Phaser.Types.GameObjects.Text.TextStyle,

    hint: {
      fontSize: '11px', color: '#5a6a4a',
      fontFamily: '"Nunito", sans-serif', fontStyle: '600',
      stroke: '#0a0f06', strokeThickness: 2,
    } as Phaser.Types.GameObjects.Text.TextStyle,

    feedback: {
      fontSize: '16px', color: '#45E6B0',
      fontFamily: '"Nunito", sans-serif', fontStyle: 'bold',
    } as Phaser.Types.GameObjects.Text.TextStyle,
  },

  // ─── Spacing ────────────────────────────────────────────────
  spacing: {
    xs: 4,
    sm: 8,
    md: 12,
    lg: 16,
    xl: 24,
  },

  // ─── Panel styling (DOM) ────────────────────────────────────
  panel: {
    background:   'rgba(212,196,160,0.88)',
    border:       '2px solid rgba(139,115,85,0.6)',
    borderRadius: '12px',
    backdropFilter: 'blur(8px)',
    padding:      '10px 12px',
    fontFamily:   '"Nunito", sans-serif',
  },

  // ─── Animation durations ────────────────────────────────────
  anim: {
    fast:     150,
    normal:   300,
    slow:     500,
    entrance: 400,
    fadeOut:   300,
    sceneFade: 400,
  },
} as const;

// ─── DOM helper: apply standard panel styling ─────────────────
export function applyPanelStyle(el: HTMLElement, extras?: Partial<CSSStyleDeclaration>): void {
  const p = UITheme.panel;
  Object.assign(el.style, {
    background: p.background,
    border: p.border,
    borderRadius: p.borderRadius,
    backdropFilter: p.backdropFilter,
    WebkitBackdropFilter: p.backdropFilter,
    padding: p.padding,
    fontFamily: p.fontFamily,
    ...extras,
  });
}

// ─── Scene transition helpers ─────────────────────────────────
export function fadeToScene(
  scene: Phaser.Scene,
  targetScene: string,
  data?: object,
  duration = UITheme.anim.sceneFade,
): void {
  scene.cameras.main.fadeOut(duration, 15, 26, 10);
  scene.cameras.main.once('camerafadeoutcomplete', () => {
    scene.scene.start(targetScene, data);
  });
}

export function fadeInScene(scene: Phaser.Scene, duration = 600): void {
  scene.cameras.main.fadeIn(duration, 15, 26, 10);
}

// ─── Entrance animation helper for DOM panels ────────────────
export function animateEntrance(
  el: HTMLElement,
  direction: 'left' | 'right' | 'top' | 'bottom' | 'scale',
  delay = 0,
): void {
  const offsets: Record<string, string> = {
    left:   'translateX(-30px)',
    right:  'translateX(30px)',
    top:    'translateY(-20px)',
    bottom: 'translateY(20px)',
    scale:  'scale(0.9)',
  };

  el.style.opacity = '0';
  el.style.transform = (el.style.transform || '') + ' ' + offsets[direction];
  el.style.transition = 'none';

  setTimeout(() => {
    el.style.transition = `opacity ${UITheme.anim.entrance}ms cubic-bezier(0.16,1,0.3,1), transform ${UITheme.anim.entrance}ms cubic-bezier(0.16,1,0.3,1)`;
    el.style.opacity = '1';
    // Remove the offset transform but keep any existing transforms (like translateX(-50%))
    el.style.transform = el.style.transform.replace(offsets[direction], '').trim();
  }, delay);
}
