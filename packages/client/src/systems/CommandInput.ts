import Phaser from 'phaser';

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

  constructor(scene: Phaser.Scene, _gameId: string, _playerId: string, _isLocal: boolean) {
    this.scene = scene;
    this.setupVoiceInput();
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

    const recognition = new SpeechRecognition();
    recognition.continuous = false;
    recognition.interimResults = true;
    recognition.lang = 'en-US';

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
        this.stopListening();
      }
    };

    recognition.onerror = (e: any) => {
      console.warn('[Voice] error:', e.error);
      this.stopListening();
    };

    recognition.onend = () => {
      this.stopListening();
    };

    this.recognition = recognition;

    // Use Phaser's keyboard system for Space (no conflicts)
    this.spaceKey = this.scene.input.keyboard!.addKey('SPACE');
    this.spaceKey.on('down', () => {
      this.startListening();
    });
    this.spaceKey.on('up', () => {
      if (this.isListening) {
        this.recognition?.stop();
      }
    });
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
    if (this.voiceLabelEl) this.voiceLabelEl.textContent = 'Hold [Space] to speak';
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
    if (this.recognition) {
      this.recognition.abort();
    }
    if (this.spaceKey) {
      this.spaceKey.removeAllListeners();
    }
  }
}
