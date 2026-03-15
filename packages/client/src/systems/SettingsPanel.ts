// ─── Settings Panel — DOM overlay with tabbed categories ────────
// Dark glassmorphism panel, instant-apply, accessible.
// ESC or clicking backdrop closes it.

import { GameSettings, SettingsData } from './GameSettings';

type Tab = 'audio' | 'voice' | 'display' | 'accessibility';

const TABS: { id: Tab; label: string; icon: string }[] = [
  { id: 'audio',         label: 'Audio',         icon: '🔊' },
  { id: 'voice',         label: 'Voice',         icon: '🎙️' },
  { id: 'display',       label: 'Display',       icon: '🖥️' },
  { id: 'accessibility', label: 'Accessibility', icon: '♿' },
];

// ─── Color Tokens ──────────────────────────────────────────────
const C = {
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

export interface SettingsPanelCallbacks {
  onTestSfx?: () => void;
  onTestVoice?: () => void;
}

export class SettingsPanel {
  private root: HTMLDivElement | null = null;
  private activeTab: Tab = 'audio';
  private settings = GameSettings.getInstance();
  private escHandler: ((e: KeyboardEvent) => void) | null = null;
  private callbacks: SettingsPanelCallbacks;
  private contentEl: HTMLElement | null = null;
  private tabBtnsRef: HTMLButtonElement[] = [];

  constructor(callbacks: SettingsPanelCallbacks = {}) {
    this.callbacks = callbacks;
  }

  get isOpen(): boolean {
    return this.root !== null;
  }

  open(): void {
    if (this.root) return;
    this.build();
    this.escHandler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') this.close();
    };
    window.addEventListener('keydown', this.escHandler);
  }

  close(): void {
    if (this.escHandler) {
      window.removeEventListener('keydown', this.escHandler);
      this.escHandler = null;
    }
    if (this.root) {
      this.root.style.opacity = '0';
      this.root.style.transform = 'scale(0.97)';
      setTimeout(() => { this.root?.remove(); this.root = null; }, 200);
    }
  }

  toggle(): void {
    this.isOpen ? this.close() : this.open();
  }

  // ────────────────────────────────────────────────────────────
  private build(): void {
    this.injectStyles();

    const root = document.createElement('div');
    root.id = 'settings-overlay';
    root.style.cssText = `
      position:fixed;inset:0;z-index:9999;
      background:${C.overlay};backdrop-filter:${C.panelBlur};-webkit-backdrop-filter:${C.panelBlur};
      display:flex;align-items:center;justify-content:center;
      opacity:0;transition:opacity 0.25s ease;
    `;
    this.root = root;

    root.addEventListener('mousedown', (e) => {
      if (e.target === root) this.close();
    });

    // Panel
    const panel = document.createElement('div');
    panel.style.cssText = `
      width:min(560px,92vw);max-height:min(680px,88vh);
      background:${C.panelBg};
      border:2px solid ${C.panelBorder};border-radius:16px;
      padding:0;box-shadow:${C.panelShadow};
      display:flex;flex-direction:column;overflow:hidden;
      transform:scale(0.96);transition:transform 0.3s cubic-bezier(0.16,1,0.3,1);
      font-family:"Nunito",sans-serif;
    `;
    root.appendChild(panel);

    // ── Header ──
    const header = document.createElement('div');
    header.style.cssText = `
      display:flex;align-items:center;justify-content:space-between;
      padding:18px 22px 14px;
      border-bottom:1px solid ${C.divider};
    `;
    panel.appendChild(header);

    const titleWrap = document.createElement('div');
    titleWrap.style.cssText = 'display:flex;align-items:center;gap:10px;';

    const titleIcon = document.createElement('span');
    titleIcon.textContent = '⚙';
    titleIcon.style.cssText = `font-size:20px;opacity:0.7;`;
    titleWrap.appendChild(titleIcon);

    const title = document.createElement('h2');
    title.textContent = 'SETTINGS';
    title.style.cssText = `
      margin:0;font-size:20px;font-family:"Fredoka",sans-serif;font-weight:700;
      color:${C.gold};letter-spacing:3px;
    `;
    titleWrap.appendChild(title);
    header.appendChild(titleWrap);

    const closeBtn = document.createElement('button');
    closeBtn.textContent = '\u2715';
    closeBtn.style.cssText = `
      background:${C.inputBg};border:1px solid ${C.inputBorder};color:${C.textSecondary};
      width:32px;height:32px;border-radius:8px;font-size:15px;cursor:pointer;
      font-family:"Fredoka",sans-serif;transition:all 0.15s;display:flex;
      align-items:center;justify-content:center;
    `;
    closeBtn.onmouseenter = () => {
      closeBtn.style.borderColor = C.red;
      closeBtn.style.color = C.red;
      closeBtn.style.background = 'rgba(255,107,107,0.1)';
    };
    closeBtn.onmouseleave = () => {
      closeBtn.style.borderColor = C.inputBorder;
      closeBtn.style.color = C.textSecondary;
      closeBtn.style.background = C.inputBg;
    };
    closeBtn.onclick = () => this.close();
    header.appendChild(closeBtn);

    // ── Tab Bar ──
    const tabBar = document.createElement('div');
    tabBar.style.cssText = `
      display:flex;gap:4px;padding:10px 22px 0;
      border-bottom:1px solid ${C.divider};
    `;
    panel.appendChild(tabBar);

    const tabBtns: HTMLButtonElement[] = [];
    for (const tab of TABS) {
      const btn = document.createElement('button');
      btn.dataset.tab = tab.id;
      btn.innerHTML = `<span style="font-size:13px">${tab.icon}</span> ${tab.label}`;
      btn.style.cssText = `
        flex:1;padding:9px 4px 11px;
        border:none;border-bottom:2px solid transparent;
        border-radius:0;
        background:none;color:${C.textMuted};
        font-size:12px;font-weight:700;cursor:pointer;
        font-family:"Nunito",sans-serif;transition:all 0.15s;
        display:flex;align-items:center;justify-content:center;gap:5px;
        margin-bottom:-1px;
      `;
      btn.onmouseenter = () => {
        if (btn.dataset.tab !== this.activeTab) {
          btn.style.color = C.textSecondary;
        }
      };
      btn.onmouseleave = () => {
        if (btn.dataset.tab !== this.activeTab) {
          btn.style.color = C.textMuted;
        }
      };
      btn.onclick = () => {
        this.activeTab = tab.id;
        this.renderTab(content, tabBtns);
      };
      tabBar.appendChild(btn);
      tabBtns.push(btn);
    }

    // ── Content ──
    const content = document.createElement('div');
    content.className = 'settings-content';
    content.style.cssText = `
      flex:1;overflow-y:auto;padding:6px 22px 12px;
    `;
    panel.appendChild(content);

    // ── Footer ──
    const footer = document.createElement('div');
    footer.style.cssText = `
      padding:12px 22px;border-top:1px solid ${C.divider};
      display:flex;justify-content:space-between;align-items:center;
    `;
    panel.appendChild(footer);

    const resetBtn = document.createElement('button');
    resetBtn.textContent = 'Reset to Defaults';
    resetBtn.style.cssText = `
      background:rgba(255,107,107,0.08);border:1px solid rgba(255,107,107,0.25);
      color:${C.red};padding:7px 16px;border-radius:8px;font-size:12px;font-weight:700;
      cursor:pointer;font-family:"Nunito",sans-serif;transition:all 0.15s;
    `;
    resetBtn.onmouseenter = () => {
      resetBtn.style.background = 'rgba(255,107,107,0.18)';
      resetBtn.style.borderColor = 'rgba(255,107,107,0.45)';
    };
    resetBtn.onmouseleave = () => {
      resetBtn.style.background = 'rgba(255,107,107,0.08)';
      resetBtn.style.borderColor = 'rgba(255,107,107,0.25)';
    };
    resetBtn.onclick = () => {
      this.settings.reset();
      this.renderTab(content, tabBtns);
    };
    footer.appendChild(resetBtn);

    const hint = document.createElement('span');
    hint.textContent = 'ESC to close';
    hint.style.cssText = `font-size:11px;color:${C.textMuted};font-family:"Nunito",sans-serif;letter-spacing:0.5px;`;
    footer.appendChild(hint);

    document.body.appendChild(root);

    // Animate in
    requestAnimationFrame(() => {
      root.style.opacity = '1';
      panel.style.transform = 'scale(1)';
    });

    this.contentEl = content;
    this.tabBtnsRef = tabBtns;
    this.renderTab(content, tabBtns);
  }

  private rerender(): void {
    if (this.contentEl && this.tabBtnsRef.length) {
      this.renderTab(this.contentEl, this.tabBtnsRef);
    }
  }

  // ────────────────────────────────────────────────────────────
  private renderTab(container: HTMLElement, tabBtns: HTMLButtonElement[]): void {
    for (const btn of tabBtns) {
      const isActive = btn.dataset.tab === this.activeTab;
      btn.style.color = isActive ? C.gold : C.textMuted;
      btn.style.borderBottomColor = isActive ? C.gold : 'transparent';
      btn.style.background = isActive ? C.tabActive : 'none';
    }

    container.innerHTML = '';
    const s = this.settings.getAll();

    switch (this.activeTab) {
      case 'audio':
        this.buildAudioTab(container, s, tabBtns);
        break;
      case 'voice':
        this.buildVoiceTab(container, s);
        break;
      case 'display':
        this.buildDisplayTab(container, s);
        break;
      case 'accessibility':
        this.buildAccessibilityTab(container, s, tabBtns);
        break;
    }
  }

  // ─── AUDIO TAB ──────────────────────────────────────────────
  private buildAudioTab(el: HTMLElement, s: SettingsData, _tabBtns: HTMLButtonElement[]): void {
    this.addSectionHeader(el, 'Volume');
    this.addToggle(el, 'Mute All', s.muteAll, v => this.settings.set('muteAll', v));
    this.addSlider(el, 'Master Volume', s.masterVolume, 0, 1, 0.05, v => this.settings.set('masterVolume', v));
    this.addSliderWithButton(el, 'SFX Volume', s.sfxVolume, 0, 1, 0.05,
      v => this.settings.set('sfxVolume', v),
      'Test', () => this.callbacks.onTestSfx?.());
    this.addSliderWithButton(el, 'Voice Volume', s.voiceVolume, 0, 1, 0.05,
      v => this.settings.set('voiceVolume', v),
      'Test', () => this.callbacks.onTestVoice?.(),
      'TTS character speech volume');

    this.addSectionHeader(el, 'Effects');
    this.addToggle(el, 'Mono Audio', s.monoAudio, v => this.settings.set('monoAudio', v),
      'Mix stereo to mono — single speakers or hearing aid');
    this.addToggle(el, 'Audio Ducking', s.audioDucking, v => {
      this.settings.set('audioDucking', v);
      this.rerender();
    }, 'Lower SFX when characters speak');
    if (s.audioDucking) {
      this.addSlider(el, 'Duck Amount', s.audioDuckAmount, 0.1, 0.8, 0.05,
        v => this.settings.set('audioDuckAmount', v),
        'How much to reduce SFX (lower = quieter)');
    }
  }

  // ─── VOICE TAB ──────────────────────────────────────────────
  private buildVoiceTab(el: HTMLElement, s: SettingsData): void {
    this.addSectionHeader(el, 'Input');
    this.addToggle(el, 'Voice Input', s.voiceInputEnabled, v => this.settings.set('voiceInputEnabled', v),
      'Enable microphone for voice commands');
    this.addToggle(el, 'Push to Talk', s.pushToTalk, v => this.settings.set('pushToTalk', v),
      'Hold Space to speak. Off = always listening');
    this.addSelect(el, 'Language', s.voiceLanguage, [
      { value: 'en-US', label: 'English (US)' },
      { value: 'en-GB', label: 'English (UK)' },
      { value: 'es-ES', label: 'Spanish' },
      { value: 'fr-FR', label: 'French' },
      { value: 'de-DE', label: 'German' },
      { value: 'ja-JP', label: 'Japanese' },
      { value: 'ko-KR', label: 'Korean' },
      { value: 'pt-BR', label: 'Portuguese (BR)' },
      { value: 'zh-CN', label: 'Chinese (Simplified)' },
    ], v => this.settings.set('voiceLanguage', v));

    this.addSectionHeader(el, 'Text-to-Speech');
    this.addSlider(el, 'TTS Speed', s.ttsSpeed, 0.5, 2.0, 0.1,
      v => this.settings.set('ttsSpeed', v),
      'Speed of character speech');
  }

  // ─── DISPLAY TAB ────────────────────────────────────────────
  private buildDisplayTab(el: HTMLElement, s: SettingsData): void {
    this.addSectionHeader(el, 'Interface');
    this.addSlider(el, 'HUD Scale', s.hudScale, 0.75, 1.5, 0.05, v => this.settings.set('hudScale', v),
      'Scale all HUD panels');
    this.addSlider(el, 'Minimap Size', s.minimapSize, 120, 280, 10, v => this.settings.set('minimapSize', v),
      'Minimap width & height in pixels');
    this.addToggle(el, 'Damage Numbers', s.showDamageNumbers, v => this.settings.set('showDamageNumbers', v));
    this.addToggle(el, 'Command Log', s.showCommandLog, v => this.settings.set('showCommandLog', v));

    this.addSectionHeader(el, 'Screen');
    this.addToggle(el, 'Fullscreen', s.fullscreen, v => {
      this.settings.set('fullscreen', v);
      if (v && !document.fullscreenElement) {
        document.documentElement.requestFullscreen().catch(() => {
          this.settings.set('fullscreen', false);
        });
      } else if (!v && document.fullscreenElement) {
        document.exitFullscreen();
      }
    });
    this.addToggle(el, 'Show FPS', s.showFps, v => this.settings.set('showFps', v),
      'Display FPS counter in top-left corner');
    this.addSlider(el, 'Camera Shake', s.cameraShakeIntensity, 0, 1, 0.1,
      v => this.settings.set('cameraShakeIntensity', v),
      'Intensity of screen shake effects (0 = off)');
    this.addSelect(el, 'Colorblind Mode', s.colorblindMode, [
      { value: 'none', label: 'None' },
      { value: 'protanopia', label: 'Protanopia (red-weak)' },
      { value: 'deuteranopia', label: 'Deuteranopia (green-weak)' },
      { value: 'tritanopia', label: 'Tritanopia (blue-weak)' },
    ], v => this.settings.set('colorblindMode', v));
  }

  // ─── ACCESSIBILITY TAB ──────────────────────────────────────
  private buildAccessibilityTab(el: HTMLElement, s: SettingsData, _tabBtns: HTMLButtonElement[]): void {
    this.addSectionHeader(el, 'Quick Presets');
    this.addPresetButton(el, 'I have low vision',
      'Larger text, high contrast, bigger HUD', () => {
        this.settings.set('largerText', true);
        this.settings.set('hudScale', 1.3);
        this.settings.set('highContrast', true);
        this.rerender();
      });
    this.addPresetButton(el, 'I use a screen reader',
      'ARIA hints, reduced motion, larger text', () => {
        this.settings.set('screenReaderHints', true);
        this.settings.set('reducedMotion', true);
        this.settings.set('largerText', true);
        this.rerender();
      });
    this.addPresetButton(el, 'I have motor difficulties',
      'Reduced motion, always-listening voice, no shake', () => {
        this.settings.set('reducedMotion', true);
        this.settings.set('pushToTalk', false);
        this.settings.set('cameraShakeIntensity', 0);
        this.rerender();
      });

    this.addSectionHeader(el, 'Vision');
    this.addToggle(el, 'Reduced Motion', s.reducedMotion, v => this.settings.set('reducedMotion', v),
      'Disable floating animations and screen shake');
    this.addToggle(el, 'Larger Text', s.largerText, v => this.settings.set('largerText', v),
      'Increase HUD font sizes by 25%');
    this.addToggle(el, 'High Contrast', s.highContrast, v => this.settings.set('highContrast', v),
      'Increase border and text contrast');

    this.addSectionHeader(el, 'Assistive');
    this.addToggle(el, 'Screen Reader Hints', s.screenReaderHints, v => this.settings.set('screenReaderHints', v),
      'Add ARIA labels to HUD elements');
    this.addToggle(el, 'Mono Audio', s.monoAudio, v => this.settings.set('monoAudio', v),
      'Mix stereo to mono');
  }

  // ─── UI COMPONENTS ──────────────────────────────────────────

  private addSectionHeader(parent: HTMLElement, title: string): void {
    const header = document.createElement('div');
    const isFirst = parent.children.length === 0;
    header.style.cssText = `
      font-size:10px;text-transform:uppercase;letter-spacing:2.5px;
      color:${C.textSecondary};font-family:"Fredoka",sans-serif;font-weight:700;
      padding:${isFirst ? '10px' : '16px'} 0 6px 0;
      ${isFirst ? '' : `border-top:1px solid ${C.divider};margin-top:4px;`}
    `;
    header.textContent = title;
    parent.appendChild(header);
  }

  private addSlider(
    parent: HTMLElement, label: string, value: number,
    min: number, max: number, step: number,
    onChange: (v: number) => void, hint?: string,
  ): void {
    const row = this.createRow(parent, label, hint);

    const valDisplay = document.createElement('span');
    valDisplay.style.cssText = `font-size:13px;font-weight:700;color:${C.gold};min-width:38px;text-align:right;font-family:"Fredoka",sans-serif;`;
    valDisplay.textContent = this.formatSliderValue(value, min, max);

    const input = document.createElement('input');
    input.type = 'range';
    input.min = String(min);
    input.max = String(max);
    input.step = String(step);
    input.value = String(value);
    input.className = 'settings-slider';
    input.style.cssText = `
      flex:1;height:6px;-webkit-appearance:none;appearance:none;
      background:${C.sliderTrack};border-radius:3px;outline:none;cursor:pointer;
    `;

    input.oninput = () => {
      const v = parseFloat(input.value);
      valDisplay.textContent = this.formatSliderValue(v, min, max);
      onChange(v);
    };

    const controls = document.createElement('div');
    controls.style.cssText = 'display:flex;align-items:center;gap:8px;flex:1;max-width:220px;';
    controls.appendChild(input);
    controls.appendChild(valDisplay);
    row.appendChild(controls);
  }

  private addSliderWithButton(
    parent: HTMLElement, label: string, value: number,
    min: number, max: number, step: number,
    onChange: (v: number) => void,
    btnLabel: string, onBtnClick: () => void, hint?: string,
  ): void {
    const row = this.createRow(parent, label, hint);

    const valDisplay = document.createElement('span');
    valDisplay.style.cssText = `font-size:13px;font-weight:700;color:${C.gold};min-width:38px;text-align:right;font-family:"Fredoka",sans-serif;`;
    valDisplay.textContent = this.formatSliderValue(value, min, max);

    const input = document.createElement('input');
    input.type = 'range';
    input.min = String(min);
    input.max = String(max);
    input.step = String(step);
    input.value = String(value);
    input.className = 'settings-slider';
    input.style.cssText = `
      flex:1;height:6px;-webkit-appearance:none;appearance:none;
      background:${C.sliderTrack};border-radius:3px;outline:none;cursor:pointer;
    `;

    input.oninput = () => {
      const v = parseFloat(input.value);
      valDisplay.textContent = this.formatSliderValue(v, min, max);
      onChange(v);
    };

    const testBtn = document.createElement('button');
    testBtn.textContent = btnLabel;
    testBtn.style.cssText = `
      background:${C.inputBg};border:1px solid ${C.inputBorder};
      color:${C.textSecondary};padding:3px 10px;border-radius:6px;font-size:10px;
      font-family:"Nunito",sans-serif;font-weight:700;cursor:pointer;
      transition:all 0.15s;white-space:nowrap;
    `;
    testBtn.onmouseenter = () => {
      testBtn.style.borderColor = C.inputBorderHi;
      testBtn.style.color = C.gold;
      testBtn.style.background = C.surfaceActive;
    };
    testBtn.onmouseleave = () => {
      testBtn.style.borderColor = C.inputBorder;
      testBtn.style.color = C.textSecondary;
      testBtn.style.background = C.inputBg;
    };
    testBtn.onclick = onBtnClick;

    const controls = document.createElement('div');
    controls.style.cssText = 'display:flex;align-items:center;gap:6px;flex:1;max-width:260px;';
    controls.appendChild(input);
    controls.appendChild(valDisplay);
    controls.appendChild(testBtn);
    row.appendChild(controls);
  }

  private addToggle(
    parent: HTMLElement, label: string, value: boolean,
    onChange: (v: boolean) => void, hint?: string,
  ): void {
    const row = this.createRow(parent, label, hint);

    const toggle = document.createElement('button');
    toggle.setAttribute('role', 'switch');
    toggle.setAttribute('aria-checked', String(value));

    const knob = document.createElement('span');
    knob.style.cssText = `
      position:absolute;top:3px;left:3px;width:18px;height:18px;border-radius:50%;
      transition:all 0.2s cubic-bezier(0.16,1,0.3,1);
      box-shadow:0 1px 4px rgba(0,0,0,0.3);
    `;

    const applyState = (on: boolean) => {
      toggle.setAttribute('aria-checked', String(on));
      toggle.style.background = on
        ? `linear-gradient(135deg, ${C.greenDark}, ${C.green})`
        : C.sliderTrack;
      toggle.style.borderColor = on ? C.green : C.inputBorder;
      knob.style.transform = on ? 'translateX(18px)' : 'translateX(0)';
      knob.style.background = on
        ? `linear-gradient(180deg, ${C.gold}, ${C.goldDark})`
        : C.textMuted;
    };

    toggle.style.cssText = `
      position:relative;width:46px;height:26px;border-radius:13px;border:2px solid;
      cursor:pointer;transition:all 0.2s;padding:0;flex-shrink:0;
    `;
    toggle.appendChild(knob);
    applyState(value);

    toggle.onclick = () => {
      const next = toggle.getAttribute('aria-checked') !== 'true';
      applyState(next);
      onChange(next);
    };

    row.appendChild(toggle);
  }

  private addSelect(
    parent: HTMLElement, label: string, value: string,
    options: { value: string; label: string }[],
    onChange: (v: string) => void,
  ): void {
    const row = this.createRow(parent, label);

    const select = document.createElement('select');
    select.style.cssText = `
      background:${C.inputBg};border:1px solid ${C.inputBorder};
      color:${C.textPrimary};padding:6px 10px;border-radius:8px;font-size:12px;
      font-family:"Nunito",sans-serif;font-weight:600;cursor:pointer;
      min-width:150px;outline:none;transition:border-color 0.15s;
    `;
    select.onfocus = () => { select.style.borderColor = C.inputBorderHi; };
    select.onblur = () => { select.style.borderColor = C.inputBorder; };
    for (const opt of options) {
      const o = document.createElement('option');
      o.value = opt.value;
      o.textContent = opt.label;
      o.selected = opt.value === value;
      o.style.cssText = `background:#1a1e14;color:${C.textPrimary};`;
      select.appendChild(o);
    }
    select.onchange = () => onChange(select.value);
    row.appendChild(select);
  }

  private addPresetButton(
    parent: HTMLElement, label: string, description: string,
    onClick: () => void,
  ): void {
    const wrapper = document.createElement('div');
    wrapper.style.cssText = 'margin:4px 0;';

    const btn = document.createElement('button');
    btn.style.cssText = `
      width:100%;text-align:left;padding:10px 14px;border-radius:10px;cursor:pointer;
      background:${C.surface};border:1px solid ${C.inputBorder};
      transition:all 0.15s;font-family:"Nunito",sans-serif;
    `;
    btn.onmouseenter = () => {
      btn.style.background = C.surfaceActive;
      btn.style.borderColor = C.inputBorderHi;
    };
    btn.onmouseleave = () => {
      btn.style.background = C.surface;
      btn.style.borderColor = C.inputBorder;
    };

    const labelEl = document.createElement('div');
    labelEl.textContent = label;
    labelEl.style.cssText = `font-size:13px;font-weight:700;color:${C.textPrimary};`;
    btn.appendChild(labelEl);

    const descEl = document.createElement('div');
    descEl.textContent = description;
    descEl.style.cssText = `font-size:10px;color:${C.textSecondary};margin-top:2px;`;
    btn.appendChild(descEl);

    btn.onclick = onClick;
    wrapper.appendChild(btn);
    parent.appendChild(wrapper);
  }

  // ─── HELPERS ────────────────────────────────────────────────

  private createRow(parent: HTMLElement, label: string, hint?: string): HTMLDivElement {
    const row = document.createElement('div');
    row.style.cssText = `
      display:flex;align-items:center;justify-content:space-between;
      padding:8px 10px;margin:2px 0;border-radius:8px;gap:12px;
      transition:background 0.12s;
    `;
    row.onmouseenter = () => { row.style.background = C.surface; };
    row.onmouseleave = () => { row.style.background = 'transparent'; };

    const labelWrap = document.createElement('div');
    labelWrap.style.cssText = 'display:flex;flex-direction:column;gap:2px;min-width:0;';

    const labelEl = document.createElement('span');
    labelEl.textContent = label;
    labelEl.style.cssText = `font-size:13px;font-weight:700;color:${C.textPrimary};font-family:"Nunito",sans-serif;`;
    labelWrap.appendChild(labelEl);

    if (hint) {
      const hintEl = document.createElement('span');
      hintEl.textContent = hint;
      hintEl.style.cssText = `font-size:10px;color:${C.textMuted};font-family:"Nunito",sans-serif;line-height:1.3;`;
      labelWrap.appendChild(hintEl);
    }

    row.appendChild(labelWrap);
    parent.appendChild(row);
    return row;
  }

  private formatSliderValue(v: number, min: number, max: number): string {
    if (max <= 1) return Math.round(v * 100) + '%';
    if (max <= 2 && min >= 0.5) return v.toFixed(1) + 'x';
    if (Number.isInteger(min) && Number.isInteger(max)) return String(Math.round(v));
    return v.toFixed(2);
  }

  private injectStyles(): void {
    if (document.getElementById('settings-panel-styles')) return;
    const style = document.createElement('style');
    style.id = 'settings-panel-styles';
    style.textContent = `
      /* Slider thumb */
      #settings-overlay .settings-slider::-webkit-slider-thumb {
        -webkit-appearance:none;width:16px;height:16px;border-radius:50%;
        background:linear-gradient(180deg,${C.gold},${C.goldDark});
        border:2px solid rgba(0,0,0,0.2);cursor:pointer;
        box-shadow:0 1px 6px rgba(0,0,0,0.35);transition:transform 0.1s;
      }
      #settings-overlay .settings-slider::-webkit-slider-thumb:hover {
        transform:scale(1.2);
      }
      #settings-overlay .settings-slider::-moz-range-thumb {
        width:14px;height:14px;border-radius:50%;
        background:linear-gradient(180deg,${C.gold},${C.goldDark});
        border:2px solid rgba(0,0,0,0.2);cursor:pointer;
      }
      /* Scrollbar */
      #settings-overlay .settings-content::-webkit-scrollbar { width:5px; }
      #settings-overlay .settings-content::-webkit-scrollbar-track { background:transparent; }
      #settings-overlay .settings-content::-webkit-scrollbar-thumb {
        background:rgba(139,115,85,0.3);border-radius:3px;
      }
      #settings-overlay .settings-content::-webkit-scrollbar-thumb:hover {
        background:rgba(139,115,85,0.5);
      }
      /* Select arrow */
      #settings-overlay select {
        background-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='6'%3E%3Cpath d='M0 0l5 6 5-6z' fill='%23a89870'/%3E%3C/svg%3E");
        background-repeat:no-repeat;
        background-position:right 10px center;
        padding-right:28px;
        -webkit-appearance:none;appearance:none;
      }
    `;
    document.head.appendChild(style);
  }
}
