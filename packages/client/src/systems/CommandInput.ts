import Phaser from 'phaser';
import { GameSettings } from './GameSettings';

type CommandCallback = (rawText: string) => void;

export class CommandInput {
  private scene: Phaser.Scene;
  private callback?: CommandCallback;
  private recognition?: any;
  private isListening = false;
  private transcriptEl: HTMLElement | null = null;
  private voiceLabelEl: HTMLElement | null = null;
  private voiceSectionEl: HTMLElement | null = null;
  private spaceKey?: Phaser.Input.Keyboard.Key;
  private pushToTalk: boolean;
  private continuousRestart = false;
  private unsubSettings?: () => void;

  constructor(scene: Phaser.Scene, _gameId: string, _playerId: string, _isLocal: boolean) {
    this.scene = scene;
    this.pushToTalk = GameSettings.getInstance().get('pushToTalk');
    this.setupVoiceInput();

    // React to settings changes
    this.unsubSettings = GameSettings.getInstance().onChange((s) => {
      const wasPTT = this.pushToTalk;
      this.pushToTalk = s.pushToTalk;
      // Mode changed — restart recognition
      if (wasPTT !== this.pushToTalk && this.recognition) {
        this.stopListening();
        if (!this.pushToTalk) {
          // Switch to always-listening
          this.recognition.continuous = true;
          this.startContinuousListening();
        } else {
          this.recognition.continuous = false;
          this.continuousRestart = false;
        }
      }
      // Update language
      if (this.recognition) {
        this.recognition.lang = s.voiceLanguage;
      }
    });
  }

  onCommand(callback: CommandCallback) {
    this.callback = callback;
  }

  private setupVoiceInput() {
    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRecognition) {
      // Hide voice section if no speech support
      const section = document.querySelector('.voice-section') as HTMLElement;
      if (section) {
        const label = section.querySelector('.voice-label') as HTMLElement;
        if (label) label.textContent = 'No speech support in this browser';
      }
      return;
    }

    const gs = GameSettings.getInstance();
    const recognition = new SpeechRecognition();
    recognition.continuous = !this.pushToTalk;
    recognition.interimResults = true;
    recognition.lang = gs.get('voiceLanguage');

    recognition.onresult = (event: any) => {
      let transcript = '';
      for (let i = 0; i < event.results.length; i++) {
        transcript += event.results[i][0].transcript;
      }

      // Show live transcript in hero bar
      this.updateTranscript(transcript);

      if (event.results[event.results.length - 1].isFinal) {
        if (transcript.trim() && this.callback) {
          this.callback(transcript.trim());
        }
        if (this.pushToTalk) {
          this.stopListening();
        }
      }
    };

    recognition.onerror = (e: any) => {
      console.warn('[Voice] error:', e.error);
      if (e.error !== 'no-speech' && e.error !== 'aborted') {
        this.stopListening();
      }
    };

    recognition.onend = () => {
      if (!this.pushToTalk && this.continuousRestart) {
        // Always-listening mode: auto-restart after a small delay
        setTimeout(() => {
          if (this.continuousRestart) {
            try { this.recognition?.start(); } catch { /* */ }
          }
        }, 300);
        return;
      }
      this.stopListening();
    };

    this.recognition = recognition;

    // Use Phaser's keyboard system for Space (no conflicts)
    this.spaceKey = this.scene.input.keyboard!.addKey('SPACE');
    this.spaceKey.on('down', () => {
      if (this.pushToTalk) {
        this.startListening();
      }
    });
    this.spaceKey.on('up', () => {
      if (this.pushToTalk && this.isListening) {
        this.recognition?.stop();
      }
    });

    // Start continuous listening if not push-to-talk
    if (!this.pushToTalk) {
      this.startContinuousListening();
    }
  }

  private startContinuousListening() {
    this.continuousRestart = true;
    this.isListening = true;
    this.getElements();
    if (this.voiceLabelEl) this.voiceLabelEl.textContent = '🔴 Listening...';
    try { this.recognition?.start(); } catch { /* */ }
  }

  private getElements() {
    if (!this.voiceSectionEl) {
      this.voiceSectionEl = document.querySelector('.voice-section');
    }
    if (!this.voiceLabelEl) {
      this.voiceLabelEl = document.querySelector('.voice-section .voice-label');
    }
    if (!this.transcriptEl) {
      this.transcriptEl = document.getElementById('voice-transcript');
    }
  }

  private startListening() {
    if (this.isListening) return;
    this.isListening = true;
    this.getElements();
    if (this.voiceSectionEl) this.voiceSectionEl.classList.add('listening');
    if (this.voiceLabelEl) this.voiceLabelEl.textContent = '🔴 Listening...';
    if (this.transcriptEl) this.transcriptEl.textContent = '';
    try {
      this.recognition?.start();
    } catch (e) {
      // Already started
    }
  }

  private stopListening() {
    if (!this.isListening) return;
    this.isListening = false;
    this.getElements();
    if (this.voiceSectionEl) this.voiceSectionEl.classList.remove('listening');
    if (this.voiceLabelEl) {
      this.voiceLabelEl.textContent = this.pushToTalk ? 'Hold [Space] to speak' : 'Listening...';
    }
    // Clear transcript after a short delay so user can see what was sent
    setTimeout(() => {
      if (!this.isListening && this.transcriptEl) {
        this.transcriptEl.textContent = '';
      }
    }, 3000);
  }

  private updateTranscript(text: string) {
    this.getElements();
    if (this.transcriptEl) {
      this.transcriptEl.textContent = text;
    }
  }

  destroy() {
    this.continuousRestart = false;
    if (this.recognition) {
      this.recognition.abort();
    }
    if (this.spaceKey) {
      this.spaceKey.removeAllListeners();
    }
    this.unsubSettings?.();
  }
}
