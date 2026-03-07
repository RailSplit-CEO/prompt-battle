// Qwen3-TTS via AIML API
const AIML_TTS_URL = 'https://api.aimlapi.com/v1/tts';
const MODEL = 'alibaba/qwen3-tts-flash';

// Voices mapped to personality archetypes
const MALE_VOICES = ['Ethan', 'Ryan', 'Marcus', 'Rocky', 'Dylan', 'Eric', 'Peter'];
const FEMALE_VOICES = ['Cherry', 'Jennifer', 'Katerina', 'Jada', 'Sunny', 'Kiki'];
const ALL_VOICES = [...MALE_VOICES, ...FEMALE_VOICES];

interface QueueEntry {
  text: string;
  voice: string;
}

export class TtsService {
  private apiKey: string | null;
  private charVoices: Map<string, string> = new Map();
  private queue: QueueEntry[] = [];
  private playing = false;
  private currentAudio: HTMLAudioElement | null = null;
  private enabled = true;
  private volume = 0.7;

  constructor() {
    this.apiKey = (import.meta as any).env?.VITE_AIML_API_KEY || null;
    if (!this.apiKey) {
      console.warn('[TTS] No VITE_AIML_API_KEY set — TTS disabled');
    }
  }

  /** Assign a consistent voice to a character based on their ID */
  assignVoice(charId: string): string {
    if (this.charVoices.has(charId)) return this.charVoices.get(charId)!;
    // Deterministic pick based on charId hash
    let hash = 0;
    for (let i = 0; i < charId.length; i++) {
      hash = ((hash << 5) - hash + charId.charCodeAt(i)) | 0;
    }
    const voice = ALL_VOICES[Math.abs(hash) % ALL_VOICES.length];
    this.charVoices.set(charId, voice);
    return voice;
  }

  /** Speak a bark line for a character */
  speak(charId: string, text: string) {
    if (!this.enabled || !this.apiKey) return;
    const voice = this.assignVoice(charId);
    this.queue.push({ text, voice });
    this.processQueue();
  }

  setEnabled(enabled: boolean) { this.enabled = enabled; }
  setVolume(vol: number) { this.volume = Math.max(0, Math.min(1, vol)); }

  private async processQueue() {
    if (this.playing || this.queue.length === 0) return;
    this.playing = true;

    const entry = this.queue.shift()!;
    try {
      const response = await fetch(AIML_TTS_URL, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: MODEL,
          text: entry.text,
          voice: entry.voice,
        }),
      });

      if (!response.ok) {
        console.warn('[TTS] API error:', response.status, await response.text().catch(() => ''));
        this.playing = false;
        this.processQueue();
        return;
      }

      const contentType = response.headers.get('content-type') || '';
      let audioSrc: string;

      if (contentType.includes('application/json')) {
        const data = await response.json();
        const audioUrl = data?.audio?.url;
        if (!audioUrl) {
          console.warn('[TTS] No audio URL in response:', data);
          this.playing = false;
          this.processQueue();
          return;
        }
        audioSrc = audioUrl;
      } else {
        // Raw audio blob
        const blob = await response.blob();
        audioSrc = URL.createObjectURL(blob);
      }

      console.log('[TTS] Playing audio:', audioSrc.substring(0, 100));
      const audio = new Audio(audioSrc);
      audio.volume = this.volume;
      this.currentAudio = audio;

      const isBlob = audioSrc.startsWith('blob:');
      audio.onended = () => {
        if (isBlob) URL.revokeObjectURL(audioSrc);
        this.currentAudio = null;
        this.playing = false;
        this.processQueue();
      };
      audio.onerror = (e) => {
        console.warn('[TTS] Audio playback error:', e);
        if (isBlob) URL.revokeObjectURL(audioSrc);
        this.currentAudio = null;
        this.playing = false;
        this.processQueue();
      };

      await audio.play();
    } catch (err) {
      console.warn('[TTS] Failed:', err);
      this.playing = false;
      this.processQueue();
    }
  }

  stop() {
    this.queue = [];
    if (this.currentAudio) {
      this.currentAudio.pause();
      this.currentAudio = null;
    }
    this.playing = false;
  }

  destroy() {
    this.stop();
    this.charVoices.clear();
  }
}
