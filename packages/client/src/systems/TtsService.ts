// ElevenLabs TTS — text-to-speech via streaming API
const TTS_BASE = 'https://api.elevenlabs.io/v1/text-to-speech';
const MODEL_ID = 'eleven_flash_v2_5';

// Fixed voice per hoard type — each unit type has a thematically matched voice
const HOARD_VOICES: Record<string, { id: string; name: string }> = {
  gnome:    { id: 'MF3mGyEYCl7XYWbV9V6O', name: 'Elli' },       // light, small
  turtle:   { id: 'onwK4e9ZLuTAKqWW03F9', name: 'Daniel' },     // calm, steady
  skull:    { id: 'VR6AewLTigWG4xSOukaG', name: 'Arnold' },     // deep, menacing
  spider:   { id: 'EXAVITQu4vr4xnSDxMaL', name: 'Bella' },     // sly, whispery
  hyena:    { id: 'TxGEqnHWrfWFTfGW9XjX', name: 'Josh' },      // wild, energetic
  panda:    { id: 'JBFqnCBsd6RMkjVDRZzb', name: 'George' },     // warm, big
  lizard:   { id: 'yoZ06aMxZJJ28mfd3POQ', name: 'Sam' },        // cold, precise
  minotaur: { id: 'pNInz6obpgDQGcFmaJgB', name: 'Adam' },       // powerful, gruff
  shaman:   { id: '21m00Tcm4TlvDq8ikWAM', name: 'Rachel' },     // mystical
  troll:    { id: 'VR6AewLTigWG4xSOukaG', name: 'Arnold' },     // deep, slow
  rogue:    { id: 'ErXwobaYiN019PkySvjV', name: 'Antoni' },     // smooth, sneaky
  all:      { id: 'onwK4e9ZLuTAKqWW03F9', name: 'Daniel' },     // narrator default
  test:     { id: 'ErXwobaYiN019PkySvjV', name: 'Antoni' },     // test voice
};

interface QueueEntry {
  text: string;
  voiceId: string;
}

export class TtsService {
  private apiKey: string | null;
  private charVoices: Map<string, string> = new Map();
  private queue: QueueEntry[] = [];
  private playing = false;
  private currentAudio: HTMLAudioElement | null = null;
  private enabled = true;
  private volume = 1.0;

  onPlayStart?: () => void;
  onPlayEnd?: () => void;

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
    this.queue.push({ text, voiceId });
    console.log(`[TTS] Queued. Queue length: ${this.queue.length}, playing: ${this.playing}`);
    this.processQueue();
  }

  /** Fire a test TTS to verify the API works */
  test() {
    console.log('[TTS] === TEST CALL ===');
    this.speak('skull', 'Ready for battle, commander.');
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
          voice_settings: {
            stability: 0.5,
            similarity_boost: 0.75,
            speed: 1.0,
          },
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
      this.onPlayStart?.();

      audio.onended = () => {
        console.log('[TTS] ✓ Playback ended');
        URL.revokeObjectURL(blobUrl);
        audio.remove();
        this.currentAudio = null;
        this.playing = false;
        this.onPlayEnd?.();
        this.processQueue();
      };
      audio.onerror = (e) => {
        console.error('[TTS] ✗ Audio error:', e);
        URL.revokeObjectURL(blobUrl);
        audio.remove();
        this.currentAudio = null;
        this.playing = false;
        this.onPlayEnd?.();
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
        this.onPlayEnd?.();
        this.processQueue();
      }
    } catch (err) {
      console.error('[TTS] ✗ Failed:', err);
      this.playing = false;
      this.onPlayEnd?.();
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
