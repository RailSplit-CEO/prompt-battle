import { InventoryManager } from './InventoryManager';

// Theme color overrides — only the tokens that change per theme
export interface ThemeOverrides {
  gold: string;
  goldDark: string;
  panelBg: string;
  panelBorder: string;
  surface: string;
  surfaceHover: string;
  tabActive: string;
  tabBorder: string;
  textH1: string;
}

const THEME_DEFS: Record<string, ThemeOverrides> = {
  frostborne: {
    gold: '#88CCFF',
    goldDark: '#5599CC',
    panelBg: 'rgba(14,22,38,0.94)',
    panelBorder: 'rgba(80,130,200,0.45)',
    surface: 'rgba(100,180,255,0.05)',
    surfaceHover: 'rgba(100,180,255,0.08)',
    tabActive: 'rgba(100,180,255,0.14)',
    tabBorder: 'rgba(100,180,255,0.5)',
    textH1: '#d0e8f8',
  },
  crimson: {
    gold: '#FF6B6B',
    goldDark: '#CC4444',
    panelBg: 'rgba(28,12,12,0.94)',
    panelBorder: 'rgba(180,60,60,0.45)',
    surface: 'rgba(255,100,100,0.05)',
    surfaceHover: 'rgba(255,100,100,0.08)',
    tabActive: 'rgba(255,100,100,0.14)',
    tabBorder: 'rgba(255,100,100,0.5)',
    textH1: '#f8d0d0',
  },
  royal_purple: {
    gold: '#C98FFF',
    goldDark: '#9955CC',
    panelBg: 'rgba(20,14,30,0.94)',
    panelBorder: 'rgba(140,80,200,0.45)',
    surface: 'rgba(170,100,255,0.05)',
    surfaceHover: 'rgba(170,100,255,0.08)',
    tabActive: 'rgba(170,100,255,0.14)',
    tabBorder: 'rgba(170,100,255,0.5)',
    textH1: '#e8d8f8',
  },
  natures_embrace: {
    gold: '#5AE65A',
    goldDark: '#339933',
    panelBg: 'rgba(10,24,10,0.94)',
    panelBorder: 'rgba(60,140,60,0.45)',
    surface: 'rgba(80,200,80,0.05)',
    surfaceHover: 'rgba(80,200,80,0.08)',
    tabActive: 'rgba(80,200,80,0.14)',
    tabBorder: 'rgba(80,200,80,0.5)',
    textH1: '#d8f0d0',
  },
  void: {
    gold: '#BB66FF',
    goldDark: '#8833CC',
    panelBg: 'rgba(5,2,12,0.96)',
    panelBorder: 'rgba(120,50,200,0.5)',
    surface: 'rgba(150,80,255,0.06)',
    surfaceHover: 'rgba(150,80,255,0.1)',
    tabActive: 'rgba(150,80,255,0.15)',
    tabBorder: 'rgba(150,80,255,0.6)',
    textH1: '#e0d0f8',
  },
};

export class ThemeManager {
  private static instance: ThemeManager | null = null;
  private currentTheme: string = 'default';
  private overrides: ThemeOverrides | null = null;
  private listeners: Array<(theme: string) => void> = [];
  private unsubscribe: (() => void) | null = null;

  static getInstance(): ThemeManager {
    if (!ThemeManager.instance) ThemeManager.instance = new ThemeManager();
    return ThemeManager.instance;
  }

  init(): void {
    // Subscribe to equipped changes to auto-apply theme
    try {
      const inv = InventoryManager.getInstance();
      this.unsubscribe = inv.onEquippedChange(() => {
        // Theme system simplified — always use default
      });
      this.applyTheme('default');
    } catch { /* not initialized yet */ }
  }

  destroy(): void {
    this.unsubscribe?.();
    this.unsubscribe = null;
  }

  applyTheme(themeId: string): void {
    this.currentTheme = themeId;
    this.overrides = THEME_DEFS[themeId] || null;
    this.listeners.forEach(cb => cb(themeId));
  }

  // Get a color token, with theme override applied
  getColor(key: keyof ThemeOverrides): string | undefined {
    return this.overrides?.[key];
  }

  getCurrentTheme(): string { return this.currentTheme; }
  getOverrides(): ThemeOverrides | null { return this.overrides; }

  onChange(cb: (theme: string) => void): () => void {
    this.listeners.push(cb);
    return () => { this.listeners = this.listeners.filter(l => l !== cb); };
  }
}

/**
 * Helper to get a themed color value — falls back to the default C token.
 * Usage: `getThemedColor('gold')` returns the theme's gold or the default.
 */
export function getThemedColor(key: keyof ThemeOverrides, defaultValue: string): string {
  const override = ThemeManager.getInstance().getColor(key);
  return override ?? defaultValue;
}
