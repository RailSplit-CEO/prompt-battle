// ElevenLabs TTS — text-to-speech via streaming API
const TTS_BASE = 'https://api.elevenlabs.io/v1/text-to-speech';
const MODEL_ID = 'eleven_flash_v2_5';

// Custom cloned voices per hoard type (ElevenLabs voice IDs from voices.txt)
const HOARD_VOICES: Record<string, { id: string; name: string }> = {
  gnome:    { id: 'ouL9IsyrSnUkCmfnD02u', name: 'Gnome' },      // custom clone — light, small
  turtle:   { id: 'NOpBlnGInO9m6vDvFkFC', name: 'Turtle' },     // custom clone — calm, steady
  skull:    { id: 'VR6AewLTigWG4xSOukaG', name: 'Arnold' },     // stock voice — deep, menacing (no custom clone)
  spider:   { id: 'D2jw4N9m4xePLTQ3IHjU', name: 'Spider' },     // custom clone — sly, whispery
  hyena:    { id: 'ZwLTvq6uCfb4W00YFl7F', name: 'Hyena' },      // custom clone — wild, energetic
  panda:    { id: 'SMmCzq0obKgqq4BpVwlt', name: 'Panda' },      // custom clone — warm, big
  lizard:   { id: 'qhH5VOAvpCwvNpmn2srO', name: 'Lizard' },     // custom clone — cold, precise
  minotaur: { id: 'cPoqAvGWCPfCfyPMwe4z', name: 'Minotaur' },   // custom clone — powerful, gruff
  shaman:   { id: 'wXvR48IpOq9HACltTmt7', name: 'Shaman' },     // custom clone — mystical
  troll:    { id: 'dhwafD61uVd8h85wAZSE', name: 'Troll' },      // custom clone — deep, slow
  rogue:    { id: 'Z7RrOqZFTyLpIlzCgfsp', name: 'Rogue' },      // custom clone — smooth, sneaky
  all:      { id: 'ouL9IsyrSnUkCmfnD02u', name: 'Gnome' },      // default = gnome voice
  test:     { id: 'ouL9IsyrSnUkCmfnD02u', name: 'Gnome' },      // test = gnome voice
};

// Per-character voice_settings tuned to match unit personality
// stability: low=expressive/chaotic, high=monotone/steady (0-1)
// similarity_boost: how close to original voice (0-1)
// style: style exaggeration, adds latency (0-1, keep low on flash model)
// speed: speaking rate (0.7-1.2)
// use_speaker_boost: subtle clarity enhancement
interface VoiceSettings {
  stability: number;
  similarity_boost: number;
  style: number;
  speed: number;
  use_speaker_boost: boolean;
}

const HOARD_VOICE_SETTINGS: Record<string, VoiceSettings> = {
  gnome:    { stability: 0.05, similarity_boost: 0.85, style: 0.45, speed: 1.2,  use_speaker_boost: true },  // excitable, bubbly chaos energy
  turtle:   { stability: 0.85, similarity_boost: 0.85, style: 0.0,  speed: 0.70, use_speaker_boost: true },  // flat, minimum speed, truly plodding
  skull:    { stability: 0.70, similarity_boost: 0.85, style: 0.10, speed: 0.78, use_speaker_boost: true },  // ominous, dreadfully slow
  spider:   { stability: 0.35, similarity_boost: 0.85, style: 0.10, speed: 0.95, use_speaker_boost: false }, // hissy, deliberate, sinister
  hyena:    { stability: 0.20, similarity_boost: 0.85, style: 0.25, speed: 1.20, use_speaker_boost: true },  // manic, max speed, unhinged chaos
  panda:    { stability: 0.65, similarity_boost: 0.85, style: 0.0,  speed: 0.90, use_speaker_boost: true },  // warm, unhurried zen pace
  lizard:   { stability: 0.90, similarity_boost: 0.85, style: 0.0,  speed: 1.05, use_speaker_boost: false }, // robotic, clipped efficiency
  minotaur: { stability: 0.25, similarity_boost: 0.85, style: 0.20, speed: 1.20, use_speaker_boost: true },  // raging, fast furious intensity
  shaman:   { stability: 0.40, similarity_boost: 0.85, style: 0.15, speed: 0.73, use_speaker_boost: true },  // ethereal, slow prophetic drawl
  troll:    { stability: 0.60, similarity_boost: 0.85, style: 0.0,  speed: 0.85, use_speaker_boost: true },  // dim-witted, slow brute
  rogue:    { stability: 0.50, similarity_boost: 0.85, style: 0.05, speed: 1.10, use_speaker_boost: true },  // smooth, quick cocky delivery
};

const DEFAULT_VOICE_SETTINGS: VoiceSettings = { stability: 0.5, similarity_boost: 0.75, style: 0.0, speed: 1.0, use_speaker_boost: true };

interface QueueEntry {
  text: string;
  voiceId: string;
  charId: string;
}

export class TtsService {
  private apiKey: string | null;
  private charVoices: Map<string, string> = new Map();
  private queue: QueueEntry[] = [];
  private playing = false;
  private currentAudio: HTMLAudioElement | null = null;
  private enabled = true;
  private volume = 1.0;

  onPlayStart?: (charId: string, audioEl: HTMLAudioElement, voiceName: string) => void;
  onPlayEnd?: (charId: string) => void;

  get isPlaying(): boolean { return this.playing; }

  constructor() {
    this.apiKey = (import.meta as any).env?.VITE_ELEVENLABS_API_KEY || null;
    if (!this.apiKey) {
      console.warn('[TTS] No VITE_ELEVENLABS_API_KEY — TTS disabled');
    } else {
      console.log(`[TTS] ✓ ElevenLabs TTS enabled (key: ${this.apiKey.slice(0, 8)}...)`);
    }
  }

  assignVoice(charId: string): string {
    if (this.charVoices.has(charId)) return this.charVoices.get(charId)!;
    const voice = HOARD_VOICES[charId] || HOARD_VOICES['all'];
    console.log(`[TTS] Assigned voice "${voice.name}" to "${charId}"`);
    this.charVoices.set(charId, voice.id);
    return voice.id;
  }

  speak(charId: string, text: string) {
    console.log(`[TTS] speak("${charId}", "${text}") — enabled=${this.enabled} apiKey=${!!this.apiKey}`);
    if (!this.enabled || !this.apiKey) {
      console.warn('[TTS] Skipped — disabled or no key');
      return;
    }
    const voiceId = this.assignVoice(charId);
    this.queue.push({ text, voiceId, charId });
    console.log(`[TTS] Queued. Queue length: ${this.queue.length}, playing: ${this.playing}`);
    this.processQueue();
  }

  /** Fire a test TTS to verify the API works — gnome voice intro */
  test() {
    console.log('[TTS] === TEST CALL ===');
    this.speak('gnome', 'Ooh ooh! Boss is here! Hehehehe! Ready when you are boss!');
  }

  setEnabled(enabled: boolean) { this.enabled = enabled; }
  setVolume(vol: number) { this.volume = Math.max(0, Math.min(1, vol)); }

  private async processQueue() {
    if (this.playing || this.queue.length === 0) return;
    this.playing = true;

    const entry = this.queue.shift()!;
    const voiceName = Object.values(HOARD_VOICES).find(v => v.id === entry.voiceId)?.name || '?';
    console.log(`[TTS] Processing: "${entry.text}" voice=${voiceName}`);

    try {
      const url = `${TTS_BASE}/${entry.voiceId}/stream?output_format=mp3_44100_128`;
      console.log(`[TTS] Fetching: ${url.slice(0, 80)}...`);

      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'xi-api-key': this.apiKey!,
        },
        body: JSON.stringify({
          text: entry.text,
          model_id: MODEL_ID,
          voice_settings: HOARD_VOICE_SETTINGS[entry.charId] || DEFAULT_VOICE_SETTINGS,
        }),
      });

      console.log(`[TTS] Response: ${response.status} ${response.statusText}`);
      if (!response.ok) {
        const errBody = await response.text().catch(() => '');
        console.error(`[TTS] ✗ API error ${response.status}: ${errBody}`);
        this.playing = false;
        this.processQueue();
        return;
      }

      const arrayBuf = await response.arrayBuffer();
      console.log(`[TTS] Got audio: ${arrayBuf.byteLength} bytes`);

      // Play via HTML Audio element (most reliable for audible output)
      const mp3Blob = new Blob([arrayBuf], { type: 'audio/mpeg' });
      const blobUrl = URL.createObjectURL(mp3Blob);
      const audio = new Audio(blobUrl);
      audio.volume = this.volume;

      // Force append to DOM — some browsers need this
      audio.style.display = 'none';
      document.body.appendChild(audio);

      this.currentAudio = audio;
      console.log(`[TTS] ▶ Playing MP3 via <audio> element... vol=${audio.volume} muted=${audio.muted} readyState=${audio.readyState}`);
      this.onPlayStart?.(entry.charId, audio, voiceName);

      audio.onended = () => {
        console.log('[TTS] ✓ Playback ended');
        URL.revokeObjectURL(blobUrl);
        audio.remove();
        this.currentAudio = null;
        this.playing = false;
        this.onPlayEnd?.(entry.charId);
        this.processQueue();
      };
      audio.onerror = (e) => {
        console.error('[TTS] ✗ Audio error:', e);
        URL.revokeObjectURL(blobUrl);
        audio.remove();
        this.currentAudio = null;
        this.playing = false;
        this.onPlayEnd?.(entry.charId);
        this.processQueue();
      };

      try {
        await audio.play();
        console.log(`[TTS] ✓ play() resolved — duration=${audio.duration.toFixed(1)}s paused=${audio.paused} volume=${audio.volume}`);
      } catch (playErr) {
        console.error('[TTS] ✗ play() REJECTED:', playErr);
        URL.revokeObjectURL(blobUrl);
        audio.remove();
        this.playing = false;
        this.onPlayEnd?.(entry.charId);
        this.processQueue();
      }
    } catch (err) {
      console.error('[TTS] ✗ Failed:', err);
      this.playing = false;
      this.onPlayEnd?.(entry.charId);
      this.processQueue();
    }
  }

  stop() {
    this.queue = [];
    if (this.currentAudio) {
      this.currentAudio.pause();
      this.currentAudio.remove();
      this.currentAudio = null;
    }
    this.playing = false;
  }

  destroy() {
    this.stop();
    this.charVoices.clear();
  }
}
