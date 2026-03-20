import { GameSettings } from '../systems/GameSettings';

/**
 * Background music for Prompt Battle.
 * Plays real MP3 tracks (Matthew Pablo — CC-BY 3.0) with crossfade looping.
 * Tracks: "Woodland Fantasy" and "Enchanted Festival"
 * Credit: Music by Matthew Pablo — https://matthewpablo.com
 */

const TRACKS = [
  'assets/music/woodland_fantasy.mp3',
  'assets/music/enchanted_festival.mp3',
];

const FADE_DURATION = 3; // seconds for crossfade
const BASE_VOLUME = 0.18; // gentle background level

export class MusicManager {
  private currentAudio: HTMLAudioElement | null = null;
  private nextAudio: HTMLAudioElement | null = null;
  private trackIndex = 0;
  private playing = false;
  private volume = BASE_VOLUME;
  private fadeTimer: ReturnType<typeof setInterval> | null = null;
  private unsubSettings?: () => void;

  constructor() {
    const gs = GameSettings.getInstance();
    this.volume = gs.get('muteAll') ? 0 : Math.min(BASE_VOLUME, gs.effectiveSfxVolume * 0.35);
    this.unsubSettings = gs.onChange(() => {
      const muted = gs.get('muteAll');
      this.volume = muted ? 0 : Math.min(BASE_VOLUME, gs.effectiveSfxVolume * 0.35);
      if (this.currentAudio) this.currentAudio.volume = this.volume;
    });
  }

  start() {
    if (this.playing) return;
    this.playing = true;
    // Shuffle start track
    this.trackIndex = Math.floor(Math.random() * TRACKS.length);
    this.playTrack();
  }

  private playTrack() {
    if (!this.playing) return;
    const audio = new Audio(TRACKS[this.trackIndex % TRACKS.length]);
    audio.volume = 0;
    audio.loop = false;

    // Fade in
    audio.addEventListener('canplaythrough', () => {
      if (!this.playing) { audio.pause(); return; }
      audio.play().catch(() => {});
      this.fadeIn(audio);
    }, { once: true });

    // When track ends, crossfade to next
    audio.addEventListener('ended', () => {
      this.trackIndex++;
      this.playTrack();
    });

    // Also crossfade near end (before it actually ends, for smooth transition)
    audio.addEventListener('timeupdate', () => {
      if (audio.duration && audio.currentTime > audio.duration - FADE_DURATION - 0.5 && !this.nextAudio) {
        this.crossfadeToNext();
      }
    });

    this.currentAudio = audio;
  }

  private fadeIn(audio: HTMLAudioElement) {
    let vol = 0;
    const step = this.volume / (FADE_DURATION * 20); // 20 steps per second
    const timer = setInterval(() => {
      vol = Math.min(this.volume, vol + step);
      audio.volume = vol;
      if (vol >= this.volume) clearInterval(timer);
    }, 50);
  }

  private fadeOut(audio: HTMLAudioElement, onDone?: () => void) {
    let vol = audio.volume;
    const step = vol / (FADE_DURATION * 20);
    const timer = setInterval(() => {
      vol = Math.max(0, vol - step);
      audio.volume = vol;
      if (vol <= 0) {
        clearInterval(timer);
        audio.pause();
        onDone?.();
      }
    }, 50);
  }

  private crossfadeToNext() {
    if (!this.playing || !this.currentAudio) return;
    const old = this.currentAudio;
    this.fadeOut(old);

    this.trackIndex++;
    const next = new Audio(TRACKS[this.trackIndex % TRACKS.length]);
    next.volume = 0;
    next.loop = false;
    this.nextAudio = next;

    next.addEventListener('canplaythrough', () => {
      if (!this.playing) { next.pause(); return; }
      next.play().catch(() => {});
      this.fadeIn(next);
      this.nextAudio = null;
    }, { once: true });

    next.addEventListener('ended', () => {
      this.trackIndex++;
      this.playTrack();
    });

    next.addEventListener('timeupdate', () => {
      if (next.duration && next.currentTime > next.duration - FADE_DURATION - 0.5 && !this.nextAudio) {
        this.crossfadeToNext();
      }
    });

    this.currentAudio = next;
  }

  stop() {
    if (!this.playing) return;
    this.playing = false;
    if (this.currentAudio) {
      this.fadeOut(this.currentAudio, () => {
        this.currentAudio = null;
      });
    }
    if (this.nextAudio) {
      this.nextAudio.pause();
      this.nextAudio = null;
    }
    if (this.fadeTimer) { clearInterval(this.fadeTimer); this.fadeTimer = null; }
    if (this.unsubSettings) { this.unsubSettings(); this.unsubSettings = undefined; }
  }

  get isPlaying() { return this.playing; }
}
