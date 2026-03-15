// ─── Centralized Game Settings with localStorage persistence ────
// Single source of truth for all user preferences.
// Changes fire callbacks so systems react instantly (no save/cancel flow).

export interface SettingsData {
  // Audio
  masterVolume: number;   // 0–1
  sfxVolume: number;      // 0–1
  voiceVolume: number;    // 0–1 (TTS output)
  muteAll: boolean;

  // Voice Input
  voiceInputEnabled: boolean;
  voiceLanguage: string;  // BCP-47 e.g. 'en-US'

  // Display
  hudScale: number;       // 0.75–1.5
  minimapSize: number;    // 120–280 px
  showDamageNumbers: boolean;
  cameraShake: boolean;
  showCommandLog: boolean;

  // Accessibility
  reducedMotion: boolean;
  largerText: boolean;
  highContrast: boolean;
  screenReaderHints: boolean;
}

const STORAGE_KEY = 'pb_settings';

const DEFAULTS: SettingsData = {
  masterVolume: 0.5,
  sfxVolume: 0.6,
  voiceVolume: 0.3,
  muteAll: false,

  voiceInputEnabled: true,
  voiceLanguage: 'en-US',

  hudScale: 1.0,
  minimapSize: 200,
  showDamageNumbers: true,
  cameraShake: true,
  showCommandLog: true,

  reducedMotion: false,
  largerText: false,
  highContrast: false,
  screenReaderHints: false,
};

type Listener = (settings: SettingsData) => void;

export class GameSettings {
  private static instance: GameSettings;
  private data: SettingsData;
  private listeners: Listener[] = [];

  private constructor() {
    this.data = this.load();
  }

  static getInstance(): GameSettings {
    if (!GameSettings.instance) GameSettings.instance = new GameSettings();
    return GameSettings.instance;
  }

  get<K extends keyof SettingsData>(key: K): SettingsData[K] {
    return this.data[key];
  }

  set<K extends keyof SettingsData>(key: K, value: SettingsData[K]): void {
    if (this.data[key] === value) return;
    this.data[key] = value;
    this.save();
    this.notify();
  }

  getAll(): Readonly<SettingsData> {
    return { ...this.data };
  }

  /** Effective SFX volume (master * sfx, or 0 if muted) */
  get effectiveSfxVolume(): number {
    return this.data.muteAll ? 0 : this.data.masterVolume * this.data.sfxVolume;
  }

  /** Effective TTS volume (master * voice, or 0 if muted) */
  get effectiveVoiceVolume(): number {
    return this.data.muteAll ? 0 : this.data.masterVolume * this.data.voiceVolume;
  }

  onChange(listener: Listener): () => void {
    this.listeners.push(listener);
    return () => {
      this.listeners = this.listeners.filter(l => l !== listener);
    };
  }

  reset(): void {
    this.data = { ...DEFAULTS };
    this.save();
    this.notify();
  }

  private load(): SettingsData {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        // Merge with defaults so new keys get default values
        return { ...DEFAULTS, ...parsed };
      }
    } catch { /* corrupted, use defaults */ }

    // Migrate legacy mute setting
    const legacyMute = localStorage.getItem('pb_sound_muted');
    if (legacyMute === 'true') {
      const d = { ...DEFAULTS, muteAll: true };
      return d;
    }
    return { ...DEFAULTS };
  }

  private save(): void {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(this.data));
    // Keep legacy key in sync for backward compat
    localStorage.setItem('pb_sound_muted', String(this.data.muteAll));
  }

  private notify(): void {
    const snapshot = { ...this.data };
    for (const l of this.listeners) l(snapshot);
  }
}
