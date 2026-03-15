// Procedural sound effects using Web Audio API (no external assets)

import { GameSettings } from './GameSettings';

export class SoundManager {
  private static instance: SoundManager;
  private ctx: AudioContext | null = null;
  private masterGain: GainNode | null = null;
  private muted = false;
  private volume = 1.0;
  private unsubSettings?: () => void;

  private constructor() {
    const gs = GameSettings.getInstance();
    this.muted = gs.get('muteAll');
    this.volume = gs.effectiveSfxVolume;
    this.unsubSettings = gs.onChange(() => {
      this.muted = gs.get('muteAll');
      this.volume = gs.effectiveSfxVolume;
      if (this.masterGain) {
        this.masterGain.gain.value = this.muted ? 0 : this.volume;
      }
      // Mono audio
      if (this.ctx) {
        try {
          this.ctx.destination.channelCount = gs.get('monoAudio') ? 1 : 2;
        } catch { /* some browsers restrict this */ }
      }
    });
  }

  static getInstance(): SoundManager {
    if (!SoundManager.instance) SoundManager.instance = new SoundManager();
    return SoundManager.instance;
  }

  private ensureCtx(): AudioContext | null {
    if (!this.ctx) {
      try {
        this.ctx = new AudioContext();
        this.masterGain = this.ctx.createGain();
        this.masterGain.gain.value = this.muted ? 0 : this.volume;
        this.masterGain.connect(this.ctx.destination);
        // Apply mono if needed
        const gs = GameSettings.getInstance();
        if (gs.get('monoAudio')) {
          try { this.ctx.destination.channelCount = 1; } catch { /* */ }
        }
      } catch { return null; }
    }
    if (this.ctx.state === 'suspended') this.ctx.resume();
    return this.ctx;
  }

  private getOutput(): AudioNode | null {
    this.ensureCtx();
    return this.masterGain;
  }

  get isMuted() { return this.muted; }

  toggleMute() {
    const gs = GameSettings.getInstance();
    gs.set('muteAll', !gs.get('muteAll'));
    return gs.get('muteAll');
  }

  // Short oscillator tone helper
  private tone(freq: number, duration: number, type: OscillatorType = 'square', vol = 0.15) {
    if (this.muted) return;
    const ctx = this.ensureCtx();
    const out = this.getOutput();
    if (!ctx || !out) return;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = type;
    osc.frequency.value = freq;
    gain.gain.setValueAtTime(vol, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + duration);
    osc.connect(gain).connect(out);
    osc.start();
    osc.stop(ctx.currentTime + duration);
  }

  // Noise burst helper
  private noise(duration: number, vol = 0.08) {
    if (this.muted) return;
    const ctx = this.ensureCtx();
    const out = this.getOutput();
    if (!ctx || !out) return;
    const bufferSize = Math.floor(ctx.sampleRate * duration);
    const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) data[i] = Math.random() * 2 - 1;
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(vol, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + duration);
    src.connect(gain).connect(out);
    src.start();
  }

  playAttackHit() {
    this.noise(0.08, 0.1);
    this.tone(200, 0.06, 'sawtooth', 0.08);
  }

  playAbilityCast() {
    this.tone(440, 0.08, 'sine', 0.12);
    this.tone(660, 0.12, 'sine', 0.1);
  }

  playKill() {
    this.tone(300, 0.1, 'sawtooth', 0.12);
    this.tone(150, 0.2, 'sawtooth', 0.1);
  }

  playFlagPickup() {
    this.tone(523, 0.1, 'square', 0.1);
    this.tone(659, 0.1, 'square', 0.1);
  }

  playFlagCapture() {
    this.tone(523, 0.08, 'square', 0.12);
    this.tone(659, 0.08, 'square', 0.12);
    this.tone(784, 0.15, 'square', 0.12);
  }

  playPickupCollect() {
    this.tone(880, 0.06, 'sine', 0.08);
    this.tone(1100, 0.08, 'sine', 0.06);
  }

  playControlCapture() {
    this.tone(392, 0.1, 'triangle', 0.1);
    this.tone(494, 0.1, 'triangle', 0.1);
    this.tone(587, 0.15, 'triangle', 0.1);
  }

  playCommandReady() {
    this.tone(700, 0.06, 'sine', 0.06);
  }
}
