// ElevenLabs Scribe v2 Realtime STT Service

export type ScribeState = 'idle' | 'connecting' | 'listening' | 'paused' | 'error' | 'closed';

export interface ScribeCallbacks {
  onPartialTranscript?: (text: string) => void;
  onFinalTranscript?: (text: string) => void;
  onStateChange?: (state: ScribeState) => void;
}

const TOKEN_URL = 'https://api.elevenlabs.io/v1/single-use-token/realtime_scribe';
const WS_BASE = 'wss://api.elevenlabs.io/v1/speech-to-text/realtime';
const MAX_RETRIES = 3;

export class ScribeService {
  private apiKey: string | null;
  private ws: WebSocket | null = null;
  private mediaStream: MediaStream | null = null;
  private audioContext: AudioContext | null = null;
  private scriptNode: ScriptProcessorNode | null = null;
  private sourceNode: MediaStreamAudioSourceNode | null = null;
  private state: ScribeState = 'idle';
  private retryCount = 0;
  private callbacks: ScribeCallbacks = {};
  private destroyed = false;
  private _paused = false;
  private chunksSent = 0;

  constructor(callbacks?: ScribeCallbacks) {
    this.apiKey = (import.meta as any).env?.VITE_ELEVENLABS_API_KEY || null;
    console.log(`[Scribe] Constructor — API key ${this.apiKey ? 'FOUND (' + this.apiKey.slice(0, 8) + '...)' : 'MISSING'}`);
    if (callbacks) this.callbacks = callbacks;
  }

  isAvailable(): boolean {
    return !!this.apiKey;
  }

  async start(): Promise<void> {
    console.log('[Scribe] start() called');
    if (this.destroyed) { console.warn('[Scribe] Already destroyed'); return; }
    if (!this.apiKey) { console.warn('[Scribe] No API key'); return; }
    this.retryCount = 0;
    await this.connect();
  }

  stop(): void {
    console.log('[Scribe] stop()');
    this.cleanup();
    this.setState('idle');
  }

  pause(): void {
    this._paused = true;
    this.setState('paused');
  }

  resume(): void {
    this._paused = false;
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.setState('listening');
    }
  }

  destroy(): void {
    this.destroyed = true;
    this.cleanup();
    this.setState('closed');
  }

  private setState(s: ScribeState) {
    if (this.state === s) return;
    console.log(`[Scribe] State: ${this.state} → ${s}`);
    this.state = s;
    this.callbacks.onStateChange?.(s);
  }

  private async connect(): Promise<void> {
    if (this.destroyed) return;
    this.setState('connecting');

    try {
      console.log('[Scribe] Requesting token...');
      const tokenRes = await fetch(TOKEN_URL, {
        method: 'POST',
        headers: {
          'xi-api-key': this.apiKey!,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ scopes: ['speech-to-text'] }),
      });
      console.log(`[Scribe] Token response: ${tokenRes.status}`);
      if (!tokenRes.ok) {
        const errText = await tokenRes.text().catch(() => '');
        console.error(`[Scribe] Token failed: ${tokenRes.status} — ${errText}`);
        this.handleError();
        return;
      }
      const tokenData = await tokenRes.json();
      const token = tokenData.token;
      console.log(`[Scribe] Got token: ${token ? token.slice(0, 20) + '...' : 'NULL'}`);

      const wsUrl = `${WS_BASE}?token=${token}&model_id=scribe_v2_realtime&language_code=en&commit_strategy=vad&audio_format=pcm_16000`;
      console.log('[Scribe] Connecting WebSocket...');
      this.ws = new WebSocket(wsUrl);

      this.ws.onopen = () => {
        if (this.destroyed) { this.ws?.close(); return; }
        console.log('[Scribe] ✓ WebSocket CONNECTED');
        this.retryCount = 0;
        this.startMic();
      };

      this.ws.onmessage = (ev) => {
        try {
          const msg = JSON.parse(ev.data);
          const mt = msg.message_type;
          if (mt === 'partial_transcript' && msg.text) {
            console.log(`[Scribe] Partial: "${msg.text}"`);
            this.callbacks.onPartialTranscript?.(msg.text);
          } else if ((mt === 'committed_transcript' || mt === 'committed_transcript_with_timestamps') && msg.text) {
            console.log(`[Scribe] ✓ FINAL: "${msg.text}"`);
            this.callbacks.onFinalTranscript?.(msg.text);
          } else if (mt === 'session_started') {
            console.log('[Scribe] Session started:', msg.session_id);
          } else if (mt === 'input_error' || mt === 'error') {
            console.error(`[Scribe] ✗ ${mt}: ${msg.error}`);
          } else {
            console.log(`[Scribe] WS msg: ${mt}`, msg);
          }
        } catch { /* ignore */ }
      };

      this.ws.onerror = (ev) => {
        console.error('[Scribe] ✗ WebSocket ERROR', ev);
        this.handleError();
      };

      this.ws.onclose = (ev) => {
        console.warn(`[Scribe] WebSocket closed: code=${ev.code} reason="${ev.reason}"`);
        if (!this.destroyed && this.state !== 'idle') {
          this.handleError();
        }
      };
    } catch (err) {
      console.error('[Scribe] ✗ Connection failed:', err);
      this.handleError();
    }
  }

  private async startMic(): Promise<void> {
    try {
      console.log('[Scribe] Requesting mic access...');
      this.mediaStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          sampleRate: 16000,
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
        },
      });
      console.log(`[Scribe] ✓ Mic granted — tracks: ${this.mediaStream.getTracks().length}`);

      this.audioContext = new AudioContext({ sampleRate: 16000 });
      console.log(`[Scribe] AudioContext rate=${this.audioContext.sampleRate} state=${this.audioContext.state}`);
      this.sourceNode = this.audioContext.createMediaStreamSource(this.mediaStream);
      this.scriptNode = this.audioContext.createScriptProcessor(4096, 1, 1);
      this.chunksSent = 0;

      this.scriptNode.onaudioprocess = (e) => {
        if (this._paused || this.destroyed) return;
        if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;

        const float32 = e.inputBuffer.getChannelData(0);
        const int16 = new Int16Array(float32.length);
        for (let i = 0; i < float32.length; i++) {
          const s = Math.max(-1, Math.min(1, float32[i]));
          int16[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
        }

        const bytes = new Uint8Array(int16.buffer);
        let binary = '';
        for (let i = 0; i < bytes.byteLength; i++) {
          binary += String.fromCharCode(bytes[i]);
        }
        const b64 = btoa(binary);

        // ElevenLabs Scribe protocol: message_type + audio_base_64
        this.ws!.send(JSON.stringify({
          message_type: 'input_audio_chunk',
          audio_base_64: b64,
          sample_rate: 16000,
        }));
        this.chunksSent++;
        if (this.chunksSent % 50 === 1) {
          console.log(`[Scribe] Streaming... chunks=${this.chunksSent}`);
        }
      };

      this.sourceNode.connect(this.scriptNode);
      this.scriptNode.connect(this.audioContext.destination);
      console.log('[Scribe] ✓ Audio pipeline connected — LISTENING');
      this.setState('listening');
    } catch (err) {
      console.error('[Scribe] ✗ Mic FAILED:', err);
      this.handleError();
    }
  }

  private handleError(): void {
    this.releaseMic();
    if (this.destroyed) return;
    if (this.retryCount < MAX_RETRIES) {
      this.retryCount++;
      console.log(`[Scribe] Retrying (${this.retryCount}/${MAX_RETRIES}) in ${this.retryCount}s...`);
      this.setState('connecting');
      setTimeout(() => this.connect(), 1000 * this.retryCount);
    } else {
      console.error('[Scribe] ✗ All retries exhausted');
      this.setState('error');
    }
  }

  private releaseMic(): void {
    try { this.scriptNode?.disconnect(); } catch { /* */ }
    try { this.sourceNode?.disconnect(); } catch { /* */ }
    try { this.audioContext?.close(); } catch { /* */ }
    if (this.mediaStream) {
      this.mediaStream.getTracks().forEach(t => t.stop());
    }
    this.scriptNode = null;
    this.sourceNode = null;
    this.audioContext = null;
    this.mediaStream = null;
  }

  private cleanup(): void {
    this.releaseMic();
    if (this.ws) {
      try { this.ws.close(); } catch { /* */ }
      this.ws = null;
    }
  }
}
