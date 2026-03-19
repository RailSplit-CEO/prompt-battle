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
const RECOVERY_INTERVAL = 30_000; // 30s recovery after all retries exhausted

// AudioWorklet processor — runs on audio thread, not main thread.
// Buffers 4096 samples (~256ms at 16kHz) before posting to main thread.
const WORKLET_CODE = `
class ScribeProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this._buf = new Float32Array(4096);
    this._idx = 0;
  }
  process(inputs) {
    const ch = inputs[0]?.[0];
    if (!ch) return true;
    for (let i = 0; i < ch.length; i++) {
      this._buf[this._idx++] = ch[i];
      if (this._idx >= 4096) {
        this.port.postMessage(this._buf, [this._buf.buffer]);
        this._buf = new Float32Array(4096);
        this._idx = 0;
      }
    }
    return true;
  }
}
registerProcessor('scribe-processor', ScribeProcessor);
`;

export class ScribeService {
  private apiKey: string | null;
  private ws: WebSocket | null = null;
  private mediaStream: MediaStream | null = null;
  private audioContext: AudioContext | null = null;
  private workletNode: AudioWorkletNode | null = null;
  private scriptNode: ScriptProcessorNode | null = null;
  private sourceNode: MediaStreamAudioSourceNode | null = null;
  private state: ScribeState = 'idle';
  private retryCount = 0;
  private callbacks: ScribeCallbacks = {};
  private destroyed = false;
  private _paused = false;
  private _pausedDuringConnect = false;
  private chunksSent = 0;
  private recoveryTimer: ReturnType<typeof setTimeout> | null = null;

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
    this.clearRecoveryTimer();
    await this.connect();
  }

  stop(): void {
    console.log('[Scribe] stop()');
    this.clearRecoveryTimer();
    this.cleanup();
    this.setState('idle');
  }

  pause(): void {
    this._paused = true;
    if (this.state === 'connecting') {
      this._pausedDuringConnect = true;
    }
    this.setState('paused');
  }

  resume(): void {
    this._paused = false;
    this._pausedDuringConnect = false;

    // BUG 1 FIX: If WebSocket died while paused, reconnect instead of silently failing
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      console.log('[Scribe] resume() — WebSocket not open, reconnecting...');
      this.retryCount = 0;
      this.clearRecoveryTimer();
      this.connect();
      return;
    }

    this.setState('listening');
  }

  destroy(): void {
    this.destroyed = true;
    this.clearRecoveryTimer();
    this.cleanup();
    this.setState('closed');
  }

  private setState(s: ScribeState) {
    if (this.state === s) return;
    console.log(`[Scribe] State: ${this.state} → ${s}`);
    this.state = s;
    this.callbacks.onStateChange?.(s);
  }

  private clearRecoveryTimer() {
    if (this.recoveryTimer) {
      clearTimeout(this.recoveryTimer);
      this.recoveryTimer = null;
    }
  }

  // ─── CONNECTION ──────────────────────────────────────────────

  private async connect(): Promise<void> {
    if (this.destroyed) return;
    this.setState('connecting');

    try {
      // BUG 5 FIX: Acquire mic once, keep it alive across reconnections
      if (!this.mediaStream || this.mediaStream.getTracks().every(t => t.readyState === 'ended')) {
        await this.acquireMic();
      }

      // Setup audio pipeline if needed (persists across WS reconnections)
      if (!this.audioContext || this.audioContext.state === 'closed') {
        await this.setupAudioPipeline();
      }

      // Close stale WebSocket before reconnecting
      if (this.ws) {
        try { this.ws.close(); } catch { /* */ }
        this.ws = null;
      }

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
        this.clearRecoveryTimer();

        // BUG 6 FIX: Respect pause state if pause() was called during connection
        if (this._paused || this._pausedDuringConnect) {
          this._pausedDuringConnect = false;
          this.setState('paused');
        } else {
          this.setState('listening');
        }
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

  // ─── MIC & AUDIO PIPELINE ───────────────────────────────────

  private async acquireMic(): Promise<void> {
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
  }

  /** BUG 3 FIX: Use AudioWorklet (off main thread) with ScriptProcessor fallback */
  private async setupAudioPipeline(): Promise<void> {
    this.disconnectPipeline();
    if (!this.mediaStream) return;

    this.audioContext = new AudioContext({ sampleRate: 16000 });
    if (this.audioContext.state === 'suspended') {
      await this.audioContext.resume();
    }
    console.log(`[Scribe] AudioContext rate=${this.audioContext.sampleRate} state=${this.audioContext.state}`);
    this.sourceNode = this.audioContext.createMediaStreamSource(this.mediaStream);
    this.chunksSent = 0;

    // Try AudioWorklet first (processes audio on a separate thread)
    if (this.audioContext.audioWorklet) {
      try {
        const blob = new Blob([WORKLET_CODE], { type: 'application/javascript' });
        const url = URL.createObjectURL(blob);
        await this.audioContext.audioWorklet.addModule(url);
        URL.revokeObjectURL(url);

        this.workletNode = new AudioWorkletNode(this.audioContext, 'scribe-processor');
        this.workletNode.port.onmessage = (e) => this.sendChunk(e.data as Float32Array);
        this.sourceNode.connect(this.workletNode);
        this.workletNode.connect(this.audioContext.destination);
        console.log('[Scribe] ✓ AudioWorklet pipeline connected');
        return;
      } catch (err) {
        console.warn('[Scribe] AudioWorklet failed, falling back to ScriptProcessor:', err);
      }
    }

    // Fallback: ScriptProcessorNode (deprecated but broadly supported)
    this.scriptNode = this.audioContext.createScriptProcessor(4096, 1, 1);
    this.scriptNode.onaudioprocess = (e) => this.sendChunk(e.inputBuffer.getChannelData(0));
    this.sourceNode.connect(this.scriptNode);
    this.scriptNode.connect(this.audioContext.destination);
    console.log('[Scribe] ✓ ScriptProcessor fallback pipeline connected');
  }

  // ─── ENCODING & SENDING ─────────────────────────────────────

  /** BUG 2 FIX: O(1) chunked base64 instead of O(n²) string concatenation */
  private encodeChunk(float32: Float32Array): string {
    const int16 = new Int16Array(float32.length);
    for (let i = 0; i < float32.length; i++) {
      const s = Math.max(-1, Math.min(1, float32[i]));
      int16[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
    }
    const bytes = new Uint8Array(int16.buffer);
    // Build binary string in chunks to avoid O(n²) concatenation
    const CHUNK = 4096;
    const parts: string[] = [];
    for (let i = 0; i < bytes.length; i += CHUNK) {
      parts.push(String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK) as any));
    }
    return btoa(parts.join(''));
  }

  private sendChunk(float32: Float32Array): void {
    if (this._paused || this.destroyed) return;
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;

    const b64 = this.encodeChunk(float32);
    this.ws.send(JSON.stringify({
      message_type: 'input_audio_chunk',
      audio_base_64: b64,
      sample_rate: 16000,
    }));
    this.chunksSent++;
    if (this.chunksSent % 50 === 1) {
      console.log(`[Scribe] Streaming... chunks=${this.chunksSent}`);
    }
  }

  // ─── ERROR HANDLING & CLEANUP ────────────────────────────────

  /** BUG 4 FIX: Long-interval recovery after max retries instead of giving up */
  private handleError(): void {
    // Close WebSocket but keep mic + audio pipeline alive for reconnection
    if (this.ws) {
      try { this.ws.close(); } catch { /* */ }
      this.ws = null;
    }
    if (this.destroyed) return;

    if (this.retryCount < MAX_RETRIES) {
      this.retryCount++;
      console.log(`[Scribe] Retrying (${this.retryCount}/${MAX_RETRIES}) in ${this.retryCount}s...`);
      this.setState('connecting');
      setTimeout(() => this.connect(), 1000 * this.retryCount);
    } else {
      console.error(`[Scribe] ✗ All retries exhausted — recovery in ${RECOVERY_INTERVAL / 1000}s`);
      this.setState('error');
      this.recoveryTimer = setTimeout(() => {
        if (!this.destroyed && this.state === 'error') {
          console.log('[Scribe] Recovery attempt...');
          this.retryCount = 0;
          this.connect();
        }
      }, RECOVERY_INTERVAL);
    }
  }

  /** Disconnect audio processing nodes without releasing mic */
  private disconnectPipeline(): void {
    try { this.workletNode?.disconnect(); } catch { /* */ }
    try { this.scriptNode?.disconnect(); } catch { /* */ }
    try { this.sourceNode?.disconnect(); } catch { /* */ }
    try { this.audioContext?.close(); } catch { /* */ }
    this.workletNode = null;
    this.scriptNode = null;
    this.sourceNode = null;
    this.audioContext = null;
  }

  private releaseMic(): void {
    if (this.mediaStream) {
      this.mediaStream.getTracks().forEach(t => t.stop());
    }
    this.mediaStream = null;
  }

  private cleanup(): void {
    this.disconnectPipeline();
    this.releaseMic();
    if (this.ws) {
      try { this.ws.close(); } catch { /* */ }
      this.ws = null;
    }
  }
}
