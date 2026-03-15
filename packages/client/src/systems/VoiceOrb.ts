// Voice Orb UI — floating mic orb replacing the bottom chat bar

export type OrbState = 'idle' | 'listening' | 'processing' | 'speaking' | 'error' | 'muted';

const MIC_SVG = `<svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" y1="19" x2="12" y2="23"/><line x1="8" y1="23" x2="16" y2="23"/></svg>`;
const MIC_OFF_SVG = `<svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" y1="19" x2="12" y2="23"/><line x1="8" y1="23" x2="16" y2="23"/><line x1="2" y1="2" x2="22" y2="22" stroke="#FF6B6B" stroke-width="2.5"/></svg>`;
const PROCESSING_SVG = `<svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10" stroke-dasharray="31.4 31.4" stroke-dashoffset="0"><animateTransform attributeName="transform" type="rotate" from="0 12 12" to="360 12 12" dur="1s" repeatCount="indefinite"/></circle><circle cx="12" cy="12" r="3" fill="currentColor"/></svg>`;
const SPEAKER_SVG = `<svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M19.07 4.93a10 10 0 0 1 0 14.14"/><path d="M15.54 8.46a5 5 0 0 1 0 7.07"/></svg>`;

const STATE_LABELS: Record<OrbState, string> = {
  idle: '',
  listening: 'LISTENING',
  processing: 'THINKING...',
  speaking: 'SPEAKING',
  error: 'ERROR',
  muted: 'MIC OFF',
};

export class VoiceOrb {
  private container: HTMLDivElement;
  private orb: HTMLDivElement;
  private iconEl: HTMLDivElement;
  private statusLabel: HTMLDivElement;
  private partialEl: HTMLDivElement;
  private responseEl: HTMLDivElement;
  private textInputEl: HTMLInputElement;
  private avatarBadge: HTMLDivElement;
  private state: OrbState = 'idle';
  private responseFadeTimer: ReturnType<typeof setTimeout> | null = null;
  private errorResetTimer: ReturnType<typeof setTimeout> | null = null;
  private textInputVisible = false;
  private destroyed = false;

  // Callbacks
  onTextSubmit?: (text: string) => void;

  constructor(parent: HTMLElement) {
    // Container
    this.container = document.createElement('div');
    this.container.id = 'voice-orb-container';

    // Transcript area (above orb)
    const transcriptArea = document.createElement('div');
    transcriptArea.id = 'voice-transcript-area';

    this.responseEl = document.createElement('div');
    this.responseEl.id = 'voice-response-text';
    transcriptArea.appendChild(this.responseEl);

    this.partialEl = document.createElement('div');
    this.partialEl.id = 'voice-partial-text';
    transcriptArea.appendChild(this.partialEl);

    this.container.appendChild(transcriptArea);

    // Orb
    this.orb = document.createElement('div');
    this.orb.id = 'voice-orb';
    this.orb.classList.add('idle');

    // Icon container (swaps SVG based on state)
    this.iconEl = document.createElement('div');
    this.iconEl.id = 'voice-orb-icon';
    this.iconEl.innerHTML = MIC_SVG;
    this.orb.appendChild(this.iconEl);

    // Avatar badge (top-right of orb)
    this.avatarBadge = document.createElement('div');
    this.avatarBadge.id = 'voice-orb-avatar';
    this.avatarBadge.innerHTML = '<span style="font-size:16px;">⚔️</span>';
    this.orb.appendChild(this.avatarBadge);

    this.container.appendChild(this.orb);

    // Status label (below orb)
    this.statusLabel = document.createElement('div');
    this.statusLabel.id = 'voice-orb-status';
    this.container.appendChild(this.statusLabel);

    // Text input (hidden by default)
    this.textInputEl = document.createElement('input');
    this.textInputEl.id = 'voice-text-input';
    this.textInputEl.type = 'text';
    this.textInputEl.placeholder = 'Type a command...';
    this.textInputEl.className = 'hidden';
    this.container.appendChild(this.textInputEl);

    parent.appendChild(this.container);

    // Event listeners
    this.orb.addEventListener('click', () => this.toggleTextInput());

    this.textInputEl.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter' && this.textInputEl.value.trim()) {
        const text = this.textInputEl.value.trim();
        this.textInputEl.value = '';
        this.hideTextInput();
        this.onTextSubmit?.(text);
      } else if (e.key === 'Escape') {
        this.hideTextInput();
      }
    });
    this.textInputEl.addEventListener('focus', () => {
      // Disable Phaser keyboard when typing
      const kbPlugin = (window as any).__phaserKeyboard;
      if (kbPlugin) kbPlugin.enabled = false;
    });
    this.textInputEl.addEventListener('blur', () => {
      const kbPlugin = (window as any).__phaserKeyboard;
      if (kbPlugin) kbPlugin.enabled = true;
    });
  }

  /** Get the text input element (for keyboard guard compatibility) */
  getTextInput(): HTMLInputElement {
    return this.textInputEl;
  }

  /** Set the visual state of the orb */
  setState(newState: OrbState): void {
    if (this.destroyed) return;
    // Clear error reset timer
    if (this.errorResetTimer) { clearTimeout(this.errorResetTimer); this.errorResetTimer = null; }

    this.orb.classList.remove('idle', 'listening', 'processing', 'speaking', 'error', 'muted');
    this.state = newState;
    this.orb.classList.add(newState);

    // Swap icon based on state
    if (newState === 'muted') {
      this.iconEl.innerHTML = MIC_OFF_SVG;
    } else if (newState === 'processing') {
      this.iconEl.innerHTML = PROCESSING_SVG;
    } else if (newState === 'speaking') {
      this.iconEl.innerHTML = SPEAKER_SVG;
    } else {
      this.iconEl.innerHTML = MIC_SVG;
    }

    // Update status label
    const label = STATE_LABELS[newState] || '';
    this.statusLabel.textContent = label;
    this.statusLabel.className = `voice-status-${newState}`;

    if (newState === 'error') {
      // Brief red flash then return to idle
      this.errorResetTimer = setTimeout(() => this.setState('idle'), 1500);
    }
  }

  /** Show partial (live) transcript above orb */
  setPartialTranscript(text: string): void {
    if (this.destroyed) return;
    this.partialEl.textContent = text;
    this.partialEl.style.opacity = text ? '1' : '0';
  }

  /** Show AI response text above orb with typewriter animation */
  showResponse(text: string, durationMs = 4000): void {
    if (this.destroyed) return;
    if (this.responseFadeTimer) { clearTimeout(this.responseFadeTimer); this.responseFadeTimer = null; }

    // Clear partial
    this.setPartialTranscript('');

    this.responseEl.textContent = '';
    this.responseEl.style.opacity = '1';
    this.responseEl.classList.add('typing');

    // Typewriter effect — show text progressively
    let idx = 0;
    const speed = Math.max(15, Math.min(40, 1200 / text.length)); // adaptive speed
    const typeInterval = setInterval(() => {
      if (this.destroyed) { clearInterval(typeInterval); return; }
      idx++;
      this.responseEl.textContent = text.slice(0, idx);
      if (idx >= text.length) {
        clearInterval(typeInterval);
        this.responseEl.classList.remove('typing');
      }
    }, speed);

    // Fade after duration
    this.responseFadeTimer = setTimeout(() => {
      this.responseEl.style.opacity = '0';
    }, durationMs);
  }

  /** Update avatar badge to show selected hoard */
  showAvatar(hoardType: string, avatarHtml?: string): void {
    if (this.destroyed) return;
    if (avatarHtml) {
      this.avatarBadge.innerHTML = avatarHtml;
    } else {
      // Fallback emoji
      this.avatarBadge.innerHTML = `<span style="font-size:16px;">${hoardType === 'all' ? '⚔️' : '🐾'}</span>`;
    }
  }

  /** Toggle text input visibility */
  private toggleTextInput(): void {
    if (this.textInputVisible) {
      this.hideTextInput();
    } else {
      this.showTextInput();
    }
  }

  showTextInput(): void {
    this.textInputVisible = true;
    this.textInputEl.className = 'shown';
    this.textInputEl.focus();
  }

  hideTextInput(): void {
    this.textInputVisible = false;
    this.textInputEl.className = 'hidden';
    this.textInputEl.blur();
  }

  destroy(): void {
    this.destroyed = true;
    if (this.responseFadeTimer) clearTimeout(this.responseFadeTimer);
    if (this.errorResetTimer) clearTimeout(this.errorResetTimer);
    this.container.remove();
  }
}
