import { ThemeManager } from '../store/ThemeManager';

// Shared color tokens — extracted from SettingsPanel for reuse across all UI overlays
export const C = {
  // Panel
  overlay:      'rgba(5,8,3,0.82)',
  panelBg:      'rgba(18,22,14,0.94)',
  panelBorder:  'rgba(139,115,85,0.45)',
  panelShadow:  '0 12px 48px rgba(0,0,0,0.6), 0 0 0 1px rgba(255,217,61,0.06)',
  panelBlur:    'blur(16px)',

  // Surface (rows, cards)
  surface:      'rgba(255,248,230,0.05)',
  surfaceHover: 'rgba(255,248,230,0.08)',
  surfaceActive:'rgba(255,217,61,0.08)',
  divider:      'rgba(139,115,85,0.18)',

  // Tab
  tabBg:        'rgba(139,115,85,0.12)',
  tabActive:    'rgba(255,217,61,0.14)',
  tabBorder:    'rgba(255,217,61,0.5)',

  // Accent
  gold:         '#FFD93D',
  goldDark:     '#E6A800',
  goldDim:      'rgba(255,217,61,0.35)',
  teal:         '#45E6B0',
  red:          '#FF6B6B',
  green:        '#5a9a4e',
  greenDark:    '#3a6a2e',

  // Text
  textH1:       '#f0e8d0',
  textPrimary:  '#d4c8a0',
  textSecondary:'#a89870',
  textMuted:    '#7a6e56',
  textDark:     '#4a3520',

  // Controls
  sliderTrack:  'rgba(139,115,85,0.25)',
  sliderFill:   'rgba(255,217,61,0.4)',
  inputBg:      'rgba(139,115,85,0.15)',
  inputBorder:  'rgba(139,115,85,0.35)',
  inputBorderHi:'rgba(255,217,61,0.5)',
} as const;

// Theme-aware accessor — returns overridden value if a UI theme is equipped
export function themed<K extends keyof typeof C>(key: K): (typeof C)[K] {
  try {
    const override = ThemeManager.getInstance().getColor(key as any);
    if (override) return override as (typeof C)[K];
  } catch { /* ThemeManager not initialized */ }
  return C[key];
}
