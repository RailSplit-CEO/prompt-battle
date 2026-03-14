// Talking avatar portrait — BongoCat/PNGTuber-style audio-reactive mouth
//
// How real BongoCat/PNGTuber overlays work:
//   1. Route audio through a Web Audio API AnalyserNode
//   2. Sample amplitude each frame via getByteTimeDomainData
//   3. When RMS volume exceeds a threshold → show mouth-open frame
//   4. When below threshold → show mouth-closed (base) frame
// This creates natural-looking lip sync that tracks the actual audio.

const AVATAR_BASE = 'assets/enemies/avatars';
const FADE_OUT_DELAY = 1500;
const VOLUME_THRESHOLD = 0.08; // RMS threshold to trigger mouth open

const HAS_TALK_AVATAR = new Set([
  'gnome', 'turtle', 'skull', 'spider', 'hyena', 'panda',
  'lizard', 'minotaur', 'shaman', 'troll', 'rogue',
]);

interface FrameCache {
  base: string;
  talk: string;
}

export class TalkingPortrait {
  private container: HTMLDivElement;
  private baseImg: HTMLImageElement;
  private talkImg: HTMLImageElement;
  private cache: Map<string, FrameCache> = new Map();
  private currentChar: string | null = null;
  private mouthOpen = false;
  private hideTimer: number | null = null;

  // Audio analysis
  private audioCtx: AudioContext | null = null;
  private analyser: AnalyserNode | null = null;
  private sourceNode: MediaElementAudioSourceNode | null = null;
  private timeDomainData: Uint8Array<ArrayBuffer> | null = null;
  private rafId: number | null = null;
  private connectedAudio: HTMLAudioElement | null = null;

  constructor(parent: HTMLElement) {
    this.container = document.createElement('div');
    this.container.id = 'talking-portrait';

    // Base image — always visible
    this.baseImg = document.createElement('img');
    this.baseImg.alt = '';
    this.baseImg.style.cssText = 'position:absolute;top:0;left:0;width:100%;height:100%;image-rendering:pixelated;object-fit:contain;';
    this.container.appendChild(this.baseImg);

    // Talk overlay — transparent bg mouth on top
    this.talkImg = document.createElement('img');
    this.talkImg.alt = '';
    this.talkImg.style.cssText = 'position:absolute;top:0;left:0;width:100%;height:100%;image-rendering:pixelated;object-fit:contain;opacity:0;';
    this.container.appendChild(this.talkImg);

    parent.appendChild(this.container);
  }

  startTalking(charId: string, audioEl?: HTMLAudioElement): void {
    if (!HAS_TALK_AVATAR.has(charId)) charId = 'gnome';

    // Cancel any pending fade-out
    if (this.hideTimer !== null) {
      clearTimeout(this.hideTimer);
      this.hideTimer = null;
    }

    // Cache frames
    if (!this.cache.has(charId)) {
      const base = `${AVATAR_BASE}/${charId}.png`;
      const talk = `${AVATAR_BASE}/${charId}_talk_nobg.png`;
      const img1 = new Image(); img1.src = base;
      const img2 = new Image(); img2.src = talk;
      this.cache.set(charId, { base, talk });
    }

    const frames = this.cache.get(charId)!;
    this.currentChar = charId;
    this.mouthOpen = false;
    this.baseImg.src = frames.base;
    this.talkImg.src = frames.talk;
    this.talkImg.style.opacity = '0';

    // Show
    this.container.classList.add('visible');

    // Connect audio analyser for amplitude-based mouth sync
    if (audioEl) {
      this.connectAudio(audioEl);
      this.startAnalysisLoop(frames);
    }
  }

  stopTalking(): void {
    // Stop analysis loop
    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }

    // Disconnect audio source (but keep AudioContext for reuse)
    this.disconnectSource();

    // Close mouth
    this.talkImg.style.opacity = '0';
    this.mouthOpen = false;

    // Fade out after delay
    if (this.hideTimer !== null) clearTimeout(this.hideTimer);
    this.hideTimer = window.setTimeout(() => {
      this.container.classList.remove('visible');
      this.hideTimer = null;
    }, FADE_OUT_DELAY);
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
      // Fall back to timer-based animation
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

  private startAnalysisLoop(frames: FrameCache): void {
    if (this.rafId !== null) cancelAnimationFrame(this.rafId);

    const tick = () => {
      this.rafId = requestAnimationFrame(tick);

      if (!this.analyser || !this.timeDomainData) {
        // Fallback: simple toggle at ~5fps if no analyser
        this.mouthOpen = !this.mouthOpen;
        this.talkImg.style.opacity = this.mouthOpen ? '1' : '0';
        return;
      }

      // Sample audio amplitude (BongoCat technique)
      this.analyser.getByteTimeDomainData(this.timeDomainData);

      // Calculate RMS volume (0-1)
      let sum = 0;
      for (let i = 0; i < this.timeDomainData.length; i++) {
        const sample = (this.timeDomainData[i] - 128) / 128; // normalize to -1..1
        sum += sample * sample;
      }
      const rms = Math.sqrt(sum / this.timeDomainData.length);

      // Mouth open when volume exceeds threshold
      const shouldOpen = rms > VOLUME_THRESHOLD;
      if (shouldOpen !== this.mouthOpen) {
        this.mouthOpen = shouldOpen;
        this.talkImg.style.opacity = shouldOpen ? '1' : '0';
      }
    };

    this.rafId = requestAnimationFrame(tick);
  }

  destroy(): void {
    if (this.rafId !== null) cancelAnimationFrame(this.rafId);
    if (this.hideTimer !== null) clearTimeout(this.hideTimer);
    this.disconnectSource();
    try { this.audioCtx?.close(); } catch { /* */ }
    this.audioCtx = null;
    this.container.remove();
    this.cache.clear();
  }
}
