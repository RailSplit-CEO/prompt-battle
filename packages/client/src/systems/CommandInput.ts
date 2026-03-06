import Phaser from 'phaser';

type CommandCallback = (rawText: string) => void;

export class CommandInput {
  private scene: Phaser.Scene;
  private gameId: string;
  private playerId: string;
  private isLocal: boolean;
  private callback?: CommandCallback;
  private inputEl: HTMLInputElement;
  private voiceBtn: HTMLButtonElement;
  private sendBtn: HTMLButtonElement;
  private recognition?: SpeechRecognition;
  private isListening = false;

  constructor(scene: Phaser.Scene, gameId: string, playerId: string, isLocal: boolean) {
    this.scene = scene;
    this.gameId = gameId;
    this.playerId = playerId;
    this.isLocal = isLocal;

    this.inputEl = document.getElementById('command-input') as HTMLInputElement;
    this.voiceBtn = document.getElementById('voice-btn') as HTMLButtonElement;
    this.sendBtn = document.getElementById('send-btn') as HTMLButtonElement;

    this.setupTextInput();
    this.setupVoiceInput();
  }

  onCommand(callback: CommandCallback) {
    this.callback = callback;
  }

  private setupTextInput() {
    const submit = () => {
      const text = this.inputEl.value.trim();
      if (text && this.callback) {
        this.callback(text);
        this.inputEl.value = '';
      }
    };

    this.inputEl.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        submit();
      }
      // Prevent game keys from firing while typing
      e.stopPropagation();
    });

    this.sendBtn.addEventListener('click', submit);
  }

  private setupVoiceInput() {
    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRecognition) {
      this.voiceBtn.style.display = 'none';
      return;
    }

    const recognition = new SpeechRecognition();
    recognition.continuous = false;
    recognition.interimResults = true;
    recognition.lang = 'en-US';

    recognition.onresult = (event: SpeechRecognitionEvent) => {
      let transcript = '';
      for (let i = 0; i < event.results.length; i++) {
        transcript += event.results[i][0].transcript;
      }

      this.inputEl.value = transcript;

      if (event.results[event.results.length - 1].isFinal) {
        if (transcript.trim() && this.callback) {
          this.callback(transcript.trim());
          this.inputEl.value = '';
        }
        this.stopListening();
      }
    };

    recognition.onerror = () => {
      this.stopListening();
    };

    recognition.onend = () => {
      this.stopListening();
    };

    this.recognition = recognition;

    // Push-to-talk
    this.voiceBtn.addEventListener('mousedown', () => this.startListening());
    this.voiceBtn.addEventListener('mouseup', () => {
      if (this.isListening) {
        this.recognition?.stop();
      }
    });
    this.voiceBtn.addEventListener('mouseleave', () => {
      if (this.isListening) {
        this.recognition?.stop();
      }
    });
  }

  private startListening() {
    if (this.isListening) return;
    this.isListening = true;
    this.voiceBtn.classList.add('listening');
    this.inputEl.placeholder = 'Listening...';
    this.recognition?.start();
  }

  private stopListening() {
    this.isListening = false;
    this.voiceBtn.classList.remove('listening');
    this.inputEl.placeholder = "Type a command... (e.g., 'Send my warrior to attack the enemy mage')";
  }

  destroy() {
    if (this.recognition) {
      this.recognition.abort();
    }
  }
}
