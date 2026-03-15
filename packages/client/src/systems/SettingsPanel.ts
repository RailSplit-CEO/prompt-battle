// ─── Settings Panel — DOM overlay with tabbed categories ────────
// Medieval-themed, instant-apply, accessible.
// ESC or clicking backdrop closes it.

import { GameSettings, SettingsData } from './GameSettings';

type Tab = 'audio' | 'voice' | 'display' | 'accessibility';

const TABS: { id: Tab; label: string; icon: string }[] = [
  { id: 'audio',         label: 'Audio',         icon: '🔊' },
  { id: 'voice',         label: 'Voice',         icon: '🎙️' },
  { id: 'display',       label: 'Display',       icon: '🖥️' },
  { id: 'accessibility', label: 'Accessibility', icon: '♿' },
];

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
      this.root.style.transform = 'scale(0.96)';
      setTimeout(() => { this.root?.remove(); this.root = null; }, 200);
    }
  }

  toggle(): void {
    this.isOpen ? this.close() : this.open();
  }

  // ────────────────────────────────────────────────────────────
  private build(): void {
    const root = document.createElement('div');
    root.id = 'settings-overlay';
    this.applyOverlayStyle(root);
    this.root = root;

    // Backdrop click to close
    root.addEventListener('mousedown', (e) => {
      if (e.target === root) this.close();
    });

    // Panel
    const panel = document.createElement('div');
    this.applyPanelStyle(panel);
    root.appendChild(panel);

    // Header
    const header = document.createElement('div');
    header.style.cssText = 'display:flex;align-items:center;justify-content:space-between;margin-bottom:16px;';
    panel.appendChild(header);

    const title = document.createElement('h2');
    title.textContent = 'SETTINGS';
    title.style.cssText = `
      margin:0;font-size:22px;font-family:"Fredoka",sans-serif;font-weight:700;
      color:#FFD93D;letter-spacing:3px;text-shadow:0 2px 4px rgba(0,0,0,0.4);
    `;
    header.appendChild(title);

    const closeBtn = document.createElement('button');
    closeBtn.textContent = '\u2715';
    closeBtn.style.cssText = `
      background:none;border:2px solid rgba(139,115,85,0.5);color:#d4c8a0;
      width:32px;height:32px;border-radius:8px;font-size:16px;cursor:pointer;
      font-family:"Fredoka",sans-serif;transition:all 0.15s;display:flex;
      align-items:center;justify-content:center;
    `;
    closeBtn.onmouseenter = () => { closeBtn.style.borderColor = '#FF6B6B'; closeBtn.style.color = '#FF6B6B'; };
    closeBtn.onmouseleave = () => { closeBtn.style.borderColor = 'rgba(139,115,85,0.5)'; closeBtn.style.color = '#d4c8a0'; };
    closeBtn.onclick = () => this.close();
    header.appendChild(closeBtn);

    // Tab bar
    const tabBar = document.createElement('div');
    tabBar.style.cssText = 'display:flex;gap:4px;margin-bottom:16px;border-bottom:2px solid rgba(139,115,85,0.3);padding-bottom:8px;';
    panel.appendChild(tabBar);

    // Content area
    const content = document.createElement('div');
    content.style.cssText = 'flex:1;overflow-y:auto;padding-right:4px;';
    panel.appendChild(content);

    // Build tabs
    const tabBtns: HTMLButtonElement[] = [];
    for (const tab of TABS) {
      const btn = document.createElement('button');
      btn.dataset.tab = tab.id;
      btn.innerHTML = `<span style="font-size:14px">${tab.icon}</span> ${tab.label}`;
      btn.style.cssText = `
        flex:1;padding:8px 4px;border:2px solid transparent;border-radius:8px 8px 0 0;
        background:none;color:#8B7355;font-size:12px;font-weight:700;cursor:pointer;
        font-family:"Nunito",sans-serif;transition:all 0.15s;display:flex;
        align-items:center;justify-content:center;gap:4px;
      `;
      btn.onclick = () => {
        this.activeTab = tab.id;
        this.renderTab(content, tabBtns);
      };
      tabBar.appendChild(btn);
      tabBtns.push(btn);
    }

    // Footer
    const footer = document.createElement('div');
    footer.style.cssText = 'margin-top:12px;padding-top:10px;border-top:2px solid rgba(139,115,85,0.3);display:flex;justify-content:space-between;align-items:center;';
    panel.appendChild(footer);

    const resetBtn = document.createElement('button');
    resetBtn.textContent = 'Reset to Defaults';
    resetBtn.style.cssText = `
      background:rgba(255,107,107,0.12);border:2px solid rgba(255,107,107,0.3);
      color:#FF6B6B;padding:6px 14px;border-radius:8px;font-size:12px;font-weight:700;
      cursor:pointer;font-family:"Nunito",sans-serif;transition:all 0.15s;
    `;
    resetBtn.onmouseenter = () => { resetBtn.style.background = 'rgba(255,107,107,0.25)'; };
    resetBtn.onmouseleave = () => { resetBtn.style.background = 'rgba(255,107,107,0.12)'; };
    resetBtn.onclick = () => {
      this.settings.reset();
      this.renderTab(content, tabBtns);
    };
    footer.appendChild(resetBtn);

    const hint = document.createElement('span');
    hint.textContent = 'ESC to close';
    hint.style.cssText = 'font-size:11px;color:#6a5a4a;font-family:"Nunito",sans-serif;';
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
    // Update tab button styles
    for (const btn of tabBtns) {
      const isActive = btn.dataset.tab === this.activeTab;
      btn.style.color = isActive ? '#FFD93D' : '#8B7355';
      btn.style.borderColor = isActive ? 'rgba(255,217,61,0.5)' : 'transparent';
      btn.style.background = isActive ? 'rgba(255,217,61,0.08)' : 'none';
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
      font-size:10px;text-transform:uppercase;letter-spacing:2px;
      color:#8B7355;font-family:"Fredoka",sans-serif;font-weight:700;
      padding:${isFirst ? '2px' : '12px'} 0 4px 0;
      ${isFirst ? '' : 'border-top:1px solid rgba(139,115,85,0.2);margin-top:4px;'}
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
    valDisplay.style.cssText = 'font-size:13px;font-weight:700;color:#FFD93D;min-width:36px;text-align:right;font-family:"Fredoka",sans-serif;';
    valDisplay.textContent = this.formatSliderValue(value, min, max);

    const input = document.createElement('input');
    input.type = 'range';
    input.min = String(min);
    input.max = String(max);
    input.step = String(step);
    input.value = String(value);
    this.styleSlider(input);

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
    valDisplay.style.cssText = 'font-size:13px;font-weight:700;color:#FFD93D;min-width:36px;text-align:right;font-family:"Fredoka",sans-serif;';
    valDisplay.textContent = this.formatSliderValue(value, min, max);

    const input = document.createElement('input');
    input.type = 'range';
    input.min = String(min);
    input.max = String(max);
    input.step = String(step);
    input.value = String(value);
    this.styleSlider(input);

    input.oninput = () => {
      const v = parseFloat(input.value);
      valDisplay.textContent = this.formatSliderValue(v, min, max);
      onChange(v);
    };

    const testBtn = document.createElement('button');
    testBtn.textContent = btnLabel;
    testBtn.style.cssText = `
      background:rgba(139,115,85,0.15);border:1px solid rgba(139,115,85,0.4);
      color:#d4c8a0;padding:2px 8px;border-radius:5px;font-size:10px;
      font-family:"Nunito",sans-serif;font-weight:700;cursor:pointer;
      transition:all 0.15s;white-space:nowrap;
    `;
    testBtn.onmouseenter = () => { testBtn.style.borderColor = '#FFD93D'; testBtn.style.color = '#FFD93D'; };
    testBtn.onmouseleave = () => { testBtn.style.borderColor = 'rgba(139,115,85,0.4)'; testBtn.style.color = '#d4c8a0'; };
    testBtn.onclick = onBtnClick;

    const controls = document.createElement('div');
    controls.style.cssText = 'display:flex;align-items:center;gap:6px;flex:1;max-width:240px;';
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
    const applyState = (on: boolean) => {
      toggle.setAttribute('aria-checked', String(on));
      toggle.style.background = on
        ? 'linear-gradient(90deg, #3a6a2e, #5a9a4e)'
        : 'rgba(139,115,85,0.3)';
      toggle.style.borderColor = on ? '#5a9a4e' : 'rgba(139,115,85,0.4)';
      knob.style.transform = on ? 'translateX(20px)' : 'translateX(0)';
      knob.style.background = on ? '#FFD93D' : '#8B7355';
    };

    toggle.style.cssText = `
      position:relative;width:46px;height:26px;border-radius:13px;border:2px solid;
      cursor:pointer;transition:all 0.2s;padding:0;flex-shrink:0;
    `;

    const knob = document.createElement('span');
    knob.style.cssText = `
      position:absolute;top:2px;left:2px;width:18px;height:18px;border-radius:50%;
      transition:all 0.2s;box-shadow:0 1px 3px rgba(0,0,0,0.3);
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
      background:rgba(42,26,10,0.6);border:2px solid rgba(139,115,85,0.5);
      color:#d4c8a0;padding:5px 8px;border-radius:8px;font-size:12px;
      font-family:"Nunito",sans-serif;font-weight:600;cursor:pointer;
      min-width:140px;outline:none;
    `;
    for (const opt of options) {
      const o = document.createElement('option');
      o.value = opt.value;
      o.textContent = opt.label;
      o.selected = opt.value === value;
      o.style.cssText = 'background:#2a1a0a;color:#d4c8a0;';
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
      width:100%;text-align:left;padding:8px 12px;border-radius:8px;cursor:pointer;
      background:rgba(139,115,85,0.08);border:1px solid rgba(139,115,85,0.25);
      transition:all 0.15s;font-family:"Nunito",sans-serif;
    `;
    btn.onmouseenter = () => { btn.style.background = 'rgba(255,217,61,0.1)'; btn.style.borderColor = 'rgba(255,217,61,0.4)'; };
    btn.onmouseleave = () => { btn.style.background = 'rgba(139,115,85,0.08)'; btn.style.borderColor = 'rgba(139,115,85,0.25)'; };

    const labelEl = document.createElement('div');
    labelEl.textContent = label;
    labelEl.style.cssText = 'font-size:13px;font-weight:700;color:#d4c8a0;';
    btn.appendChild(labelEl);

    const descEl = document.createElement('div');
    descEl.textContent = description;
    descEl.style.cssText = 'font-size:10px;color:#8B7355;margin-top:1px;';
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
      padding:7px 0;border-bottom:1px solid rgba(139,115,85,0.12);
      gap:12px;
    `;

    const labelWrap = document.createElement('div');
    labelWrap.style.cssText = 'display:flex;flex-direction:column;gap:1px;min-width:0;';

    const labelEl = document.createElement('span');
    labelEl.textContent = label;
    labelEl.style.cssText = 'font-size:13px;font-weight:700;color:#d4c8a0;font-family:"Nunito",sans-serif;';
    labelWrap.appendChild(labelEl);

    if (hint) {
      const hintEl = document.createElement('span');
      hintEl.textContent = hint;
      hintEl.style.cssText = 'font-size:10px;color:#6a5a4a;font-family:"Nunito",sans-serif;';
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

  private styleSlider(input: HTMLInputElement): void {
    input.style.cssText = `
      flex:1;height:6px;-webkit-appearance:none;appearance:none;
      background:rgba(139,115,85,0.3);border-radius:3px;outline:none;
      cursor:pointer;
    `;
    // Webkit thumb styling via class
    if (!document.getElementById('settings-slider-style')) {
      const style = document.createElement('style');
      style.id = 'settings-slider-style';
      style.textContent = `
        #settings-overlay input[type=range]::-webkit-slider-thumb {
          -webkit-appearance:none;width:16px;height:16px;border-radius:50%;
          background:linear-gradient(180deg,#FFD93D,#E6A800);
          border:2px solid rgba(139,115,85,0.6);cursor:pointer;
          box-shadow:0 1px 4px rgba(0,0,0,0.3);transition:transform 0.1s;
        }
        #settings-overlay input[type=range]::-webkit-slider-thumb:hover {
          transform:scale(1.15);
        }
        #settings-overlay input[type=range]::-moz-range-thumb {
          width:14px;height:14px;border-radius:50%;
          background:linear-gradient(180deg,#FFD93D,#E6A800);
          border:2px solid rgba(139,115,85,0.6);cursor:pointer;
        }
      `;
      document.head.appendChild(style);
    }
  }

  // ─── STYLES ─────────────────────────────────────────────────

  private applyOverlayStyle(el: HTMLDivElement): void {
    el.style.cssText = `
      position:fixed;inset:0;z-index:9999;
      background:rgba(10,15,6,0.75);backdrop-filter:blur(6px);-webkit-backdrop-filter:blur(6px);
      display:flex;align-items:center;justify-content:center;
      opacity:0;transition:opacity 0.2s ease;
    `;
  }

  private applyPanelStyle(el: HTMLElement): void {
    el.style.cssText = `
      width:min(540px,92vw);max-height:min(660px,88vh);
      background:linear-gradient(180deg,rgba(232,220,196,0.97) 0%,rgba(200,184,150,0.97) 100%);
      border:3px solid rgba(139,115,85,0.7);border-radius:16px;
      padding:20px 24px;box-shadow:0 8px 40px rgba(0,0,0,0.5),inset 0 1px 0 rgba(255,255,255,0.2);
      display:flex;flex-direction:column;
      transform:scale(0.96);transition:transform 0.25s cubic-bezier(0.16,1,0.3,1);
      font-family:"Nunito",sans-serif;
    `;
  }
}
