// Talking avatar portrait — BongoCat/PNGTuber-style audio-reactive mouth
//
// Uses two stacked <img> elements with CSS opacity toggling for flicker-free
// frame swapping. Both images are preloaded and always in the DOM — toggling
// the .speaking class on the container controls which is visible via CSS.

const AVATAR_BASE = 'assets/enemies/avatars';
const FADE_OUT_DELAY = 1500;

// Adaptive mouth detection — self-calibrating noise floor + relative threshold
const NOISE_ADAPT_RATE = 0.08; // How fast noise floor tracks silence (0=never, 1=instant)
const OPEN_RATIO = 1.4;        // RMS must exceed noise floor by this factor to open mouth
const HOLD_MS = 50;            // Minimum ms mouth stays open once triggered (prevents jitter)
const MIN_NOISE_FLOOR = 0.001; // Floor clamp — prevents dead-silence edge cases

const HAS_TALK_AVATAR = new Set([
  'gnome', 'turtle', 'skull', 'spider', 'hyena', 'panda',
  'lizard', 'minotaur', 'shaman', 'troll', 'rogue',
]);

export class TalkingPortrait {
  private container: HTMLDivElement;
  private idleImg: HTMLImageElement;
  private talkImg: HTMLImageElement;
  private currentChar: string | null = null;
  private mouthOpen = false;
  private hideTimer: number | null = null;
  private lastOpenTime = 0; // timestamp of last mouth-open trigger
  private noiseFloor = 0.01; // adaptive noise floor estimate — recalibrates each TTS playback

  // Audio analysis
  private audioCtx: AudioContext | null = null;
  private analyser: AnalyserNode | null = null;
  private sourceNode: MediaElementAudioSourceNode | null = null;
  private timeDomainData: Uint8Array<ArrayBuffer> | null = null;
  private rafId: number | null = null;
  private connectedAudio: HTMLAudioElement | null = null;
  private fallbackTimer: number | null = null;
  private _bubbleTimer: number | null = null;
  private voiceLabel: HTMLDivElement;

  constructor(parent: HTMLElement) {
    this.container = document.createElement('div');
    this.container.id = 'talking-portrait';

    // Idle frame — visible by default
    this.idleImg = document.createElement('img');
    this.idleImg.alt = '';
    this.idleImg.className = 'portrait-frame portrait-idle';
    this.container.appendChild(this.idleImg);

    // Talk frame — hidden by default, shown via .speaking class
    this.talkImg = document.createElement('img');
    this.talkImg.alt = '';
    this.talkImg.className = 'portrait-frame portrait-talk';
    this.container.appendChild(this.talkImg);

    // Voice name label below portrait
    this.voiceLabel = document.createElement('div');
    this.voiceLabel.className = 'portrait-voice-label';
    this.container.appendChild(this.voiceLabel);

    // Always visible — show default avatar immediately
    this.container.classList.add('visible');
    this.setIdleAvatar('gnome');

    parent.appendChild(this.container);
  }

  /** Expose container for reparenting into sidebar */
  getContainer(): HTMLDivElement { return this.container; }

  setVoiceName(name: string): void {
    this.voiceLabel.textContent = name;
  }

  /** Update portrait avatar without starting speech */
  setIdleAvatar(charId: string): void {
    if (!HAS_TALK_AVATAR.has(charId)) charId = 'gnome';
    this.currentChar = charId;
    this.idleImg.src = `${AVATAR_BASE}/${charId}.png`;
    this.talkImg.src = `${AVATAR_BASE}/${charId}_talk_nobg.png`;
  }

  startTalking(charId: string, audioEl?: HTMLAudioElement): void {
    if (!HAS_TALK_AVATAR.has(charId)) charId = 'gnome';

    // Cancel any pending fade-out
    if (this.hideTimer !== null) {
      clearTimeout(this.hideTimer);
      this.hideTimer = null;
    }

    // Set image sources (browser caches after first load — no flicker)
    this.currentChar = charId;
    this.mouthOpen = false;
    this.noiseFloor = 0.01; // reset so it recalibrates for this playback
    this.idleImg.src = `${AVATAR_BASE}/${charId}.png`;
    this.talkImg.src = `${AVATAR_BASE}/${charId}_talk_nobg.png`;
    this.container.classList.remove('speaking');

    // Connect audio analyser for amplitude-based mouth sync
    if (audioEl) {
      this.connectAudio(audioEl);
      if (this.analyser) {
        this.startAnalysisLoop();
      } else {
        this.startFallbackLoop();
      }
    }
  }

  stopTalking(): void {
    // Stop analysis loop
    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
    if (this.fallbackTimer !== null) {
      clearInterval(this.fallbackTimer);
      this.fallbackTimer = null;
    }

    // Disconnect audio source (but keep AudioContext for reuse)
    this.disconnectSource();

    // Close mouth — portrait stays visible
    this.container.classList.remove('speaking');
    this.mouthOpen = false;
  }

  private setMouthOpen(open: boolean): void {
    const now = performance.now();

    if (open) {
      this.lastOpenTime = now;
      if (!this.mouthOpen) {
        this.mouthOpen = true;
        this.container.classList.add('speaking');
      }
    } else {
      // Hold mouth open for HOLD_MS to prevent jittery rapid closing
      if (this.mouthOpen && (now - this.lastOpenTime) >= HOLD_MS) {
        this.mouthOpen = false;
        this.container.classList.remove('speaking');
      }
    }
  }

  private connectAudio(audioEl: HTMLAudioElement): void {
    // Don't reconnect the same element
    if (this.connectedAudio === audioEl) return;
    this.disconnectSource();

    if (!this.audioCtx) {
      this.audioCtx = new AudioContext();
    }

    this.analyser = this.audioCtx.createAnalyser();
    this.analyser.fftSize = 256;
    this.timeDomainData = new Uint8Array(this.analyser.fftSize) as Uint8Array<ArrayBuffer>;

    try {
      this.sourceNode = this.audioCtx.createMediaElementSource(audioEl);
      this.sourceNode.connect(this.analyser);
      // Also connect to destination so audio is still audible
      this.analyser.connect(this.audioCtx.destination);
      this.connectedAudio = audioEl;
    } catch (_e) {
      // MediaElementSource can only be created once per element
      console.warn('[TalkingPortrait] Could not create audio source, using fallback');
      this.analyser = null;
      this.timeDomainData = null;
    }
  }

  private disconnectSource(): void {
    try { this.sourceNode?.disconnect(); } catch { /* */ }
    try { this.analyser?.disconnect(); } catch { /* */ }
    this.sourceNode = null;
    this.analyser = null;
    this.connectedAudio = null;
  }

  private startAnalysisLoop(): void {
    if (this.rafId !== null) cancelAnimationFrame(this.rafId);

    const tick = () => {
      this.rafId = requestAnimationFrame(tick);
      if (!this.analyser || !this.timeDomainData) return;

      this.analyser.getByteTimeDomainData(this.timeDomainData);

      let sum = 0;
      for (let i = 0; i < this.timeDomainData.length; i++) {
        const s = (this.timeDomainData[i] - 128) / 128;
        sum += s * s;
      }
      const rms = Math.sqrt(sum / this.timeDomainData.length);

      // Adapt noise floor only during silence (mouth closed) — speech would inflate it
      if (!this.mouthOpen) {
        this.noiseFloor += (rms - this.noiseFloor) * NOISE_ADAPT_RATE;
        if (this.noiseFloor < MIN_NOISE_FLOOR) this.noiseFloor = MIN_NOISE_FLOOR;
      }

      this.setMouthOpen(rms > this.noiseFloor * OPEN_RATIO);
    };

    this.rafId = requestAnimationFrame(tick);
  }

  /** Fallback: toggle mouth at ~6Hz when audio analyser isn't available */
  private startFallbackLoop(): void {
    if (this.fallbackTimer !== null) clearInterval(this.fallbackTimer);
    this.fallbackTimer = window.setInterval(() => {
      if (this.mouthOpen) {
        this.mouthOpen = false;
        this.container.classList.remove('speaking');
      } else {
        this.mouthOpen = true;
        this.container.classList.add('speaking');
      }
    }, 170); // ~6 toggles/sec feels natural for speech
  }

  /** Show a speech-bubble message over the portrait */
  showMessage(text: string, durationMs = 4000): void {
    // Reuse or create the bubble element
    let bubble = this.container.querySelector('.portrait-bubble') as HTMLDivElement | null;
    if (!bubble) {
      bubble = document.createElement('div');
      bubble.className = 'portrait-bubble';
      this.container.appendChild(bubble);
    }
    bubble.textContent = text;
    bubble.classList.add('visible');

    // Auto-hide after duration
    if (this._bubbleTimer !== null) clearTimeout(this._bubbleTimer);
    this._bubbleTimer = window.setTimeout(() => {
      bubble!.classList.remove('visible');
      this._bubbleTimer = null;
    }, durationMs);
  }

  destroy(): void {
    if (this.rafId !== null) cancelAnimationFrame(this.rafId);
    if (this.fallbackTimer !== null) clearInterval(this.fallbackTimer);
    if (this.hideTimer !== null) clearTimeout(this.hideTimer);
    if (this._bubbleTimer !== null) clearTimeout(this._bubbleTimer);
    this.disconnectSource();
    try { this.audioCtx?.close(); } catch { /* */ }
    this.audioCtx = null;
    this.container.remove();
  }
}
