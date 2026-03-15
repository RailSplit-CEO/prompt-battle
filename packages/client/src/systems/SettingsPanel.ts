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

export class SettingsPanel {
  private root: HTMLDivElement | null = null;
  private activeTab: Tab = 'audio';
  private settings = GameSettings.getInstance();
  private escHandler: ((e: KeyboardEvent) => void) | null = null;

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
    closeBtn.textContent = '✕';
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

    this.renderTab(content, tabBtns);
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
        this.buildAudioTab(container, s);
        break;
      case 'voice':
        this.buildVoiceTab(container, s);
        break;
      case 'display':
        this.buildDisplayTab(container, s);
        break;
      case 'accessibility':
        this.buildAccessibilityTab(container, s);
        break;
    }
  }

  // ─── AUDIO TAB ──────────────────────────────────────────────
  private buildAudioTab(el: HTMLElement, s: SettingsData): void {
    this.addToggle(el, 'Mute All', s.muteAll, v => this.settings.set('muteAll', v));
    this.addSlider(el, 'Master Volume', s.masterVolume, 0, 1, 0.05, v => this.settings.set('masterVolume', v));
    this.addSlider(el, 'SFX Volume', s.sfxVolume, 0, 1, 0.05, v => this.settings.set('sfxVolume', v));
    this.addSlider(el, 'Voice Volume', s.voiceVolume, 0, 1, 0.05, v => this.settings.set('voiceVolume', v),
      'Controls TTS character speech volume');
  }

  // ─── VOICE TAB ──────────────────────────────────────────────
  private buildVoiceTab(el: HTMLElement, s: SettingsData): void {
    this.addToggle(el, 'Voice Input', s.voiceInputEnabled, v => this.settings.set('voiceInputEnabled', v),
      'Enable microphone for voice commands');
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
  }

  // ─── DISPLAY TAB ────────────────────────────────────────────
  private buildDisplayTab(el: HTMLElement, s: SettingsData): void {
    this.addSlider(el, 'HUD Scale', s.hudScale, 0.75, 1.5, 0.05, v => this.settings.set('hudScale', v),
      'Scale all HUD panels');
    this.addSlider(el, 'Minimap Size', s.minimapSize, 120, 280, 10, v => this.settings.set('minimapSize', v),
      'Minimap width & height in pixels');
    this.addToggle(el, 'Damage Numbers', s.showDamageNumbers, v => this.settings.set('showDamageNumbers', v));
    this.addToggle(el, 'Camera Shake', s.cameraShake, v => this.settings.set('cameraShake', v));
    this.addToggle(el, 'Command Log', s.showCommandLog, v => this.settings.set('showCommandLog', v));
  }

  // ─── ACCESSIBILITY TAB ──────────────────────────────────────
  private buildAccessibilityTab(el: HTMLElement, s: SettingsData): void {
    this.addToggle(el, 'Reduced Motion', s.reducedMotion, v => this.settings.set('reducedMotion', v),
      'Disable floating animations and screen shake');
    this.addToggle(el, 'Larger Text', s.largerText, v => this.settings.set('largerText', v),
      'Increase HUD font sizes by 25%');
    this.addToggle(el, 'High Contrast', s.highContrast, v => this.settings.set('highContrast', v),
      'Increase border and text contrast');
    this.addToggle(el, 'Screen Reader Hints', s.screenReaderHints, v => this.settings.set('screenReaderHints', v),
      'Add ARIA labels to HUD elements');
  }

  // ─── UI COMPONENTS ──────────────────────────────────────────

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

  // ─── HELPERS ────────────────────────────────────────────────

  private createRow(parent: HTMLElement, label: string, hint?: string): HTMLDivElement {
    const row = document.createElement('div');
    row.style.cssText = `
      display:flex;align-items:center;justify-content:space-between;
      padding:8px 0;border-bottom:1px solid rgba(139,115,85,0.15);
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
    const style = document.createElement('style');
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
    if (!document.getElementById('settings-slider-style')) {
      style.id = 'settings-slider-style';
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
      width:min(520px,92vw);max-height:min(620px,88vh);
      background:linear-gradient(180deg,rgba(232,220,196,0.97) 0%,rgba(200,184,150,0.97) 100%);
      border:3px solid rgba(139,115,85,0.7);border-radius:16px;
      padding:20px 24px;box-shadow:0 8px 40px rgba(0,0,0,0.5),inset 0 1px 0 rgba(255,255,255,0.2);
      display:flex;flex-direction:column;
      transform:scale(0.96);transition:transform 0.25s cubic-bezier(0.16,1,0.3,1);
      font-family:"Nunito",sans-serif;
    `;
  }
}
