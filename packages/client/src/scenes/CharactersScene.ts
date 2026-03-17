import Phaser from 'phaser';
import { CharacterHub } from '../ui/CharacterHub';

// ═══════════════════════════════════════════════════════════
// CHARACTERS SCENE — Opens the CharacterHub UI overlay
// ═══════════════════════════════════════════════════════════

export class CharactersScene extends Phaser.Scene {
  constructor() {
    super({ key: 'CharactersScene' });
  }

  create() {
    const hub = new CharacterHub();
    hub.open(() => {
      // On close callback — return to menu
      this.scene.start('MenuScene');
    });

    // ESC fallback (hub handles its own ESC, but keep scene-level too)
    this.input.keyboard?.on('keydown-ESC', () => {
      if (hub.isOpen) hub.close();
    });
  }
}
