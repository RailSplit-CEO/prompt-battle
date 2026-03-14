import Phaser from 'phaser';

// ═══════════════════════════════════════════════════════════
// CHARACTERS SCENE — Embeds the full interactive bestiary
// (horde-overview.html) as an iframe overlay within the game
// ═══════════════════════════════════════════════════════════

export class CharactersScene extends Phaser.Scene {
  private iframeWrapper: HTMLDivElement | null = null;

  constructor() {
    super({ key: 'CharactersScene' });
  }

  create() {
    // Hide the Phaser canvas visually (iframe takes over)
    this.cameras.main.setBackgroundColor('#0a0c12');

    // Create full-screen iframe overlay
    const wrapper = document.createElement('div');
    wrapper.id = 'bestiary-overlay';
    wrapper.style.cssText = `
      position: fixed; top: 0; left: 0; width: 100vw; height: 100vh;
      z-index: 9999; background: #0a0c12;
    `;

    const iframe = document.createElement('iframe');
    iframe.src = 'horde-overview.html';
    iframe.style.cssText = `
      width: 100%; height: 100%; border: none;
    `;
    wrapper.appendChild(iframe);

    // Back button overlay (always visible on top of iframe)
    const backBtn = document.createElement('button');
    backBtn.textContent = '\u2190 BACK TO MENU';
    backBtn.style.cssText = `
      position: fixed; top: 16px; left: 16px; z-index: 10000;
      background: rgba(20, 23, 34, 0.9); color: #FF6B6B;
      border: 2px solid #FF6B6B; border-radius: 10px;
      padding: 8px 20px; font-size: 16px; font-weight: bold;
      font-family: "Fredoka", sans-serif; cursor: pointer;
      letter-spacing: 1px; transition: all 0.15s;
    `;
    backBtn.onmouseenter = () => {
      backBtn.style.background = '#FF6B6B';
      backBtn.style.color = '#fff';
    };
    backBtn.onmouseleave = () => {
      backBtn.style.background = 'rgba(20, 23, 34, 0.9)';
      backBtn.style.color = '#FF6B6B';
    };
    backBtn.onclick = () => this.goBack();
    wrapper.appendChild(backBtn);

    document.body.appendChild(wrapper);
    this.iframeWrapper = wrapper;

    // ESC to go back
    const escHandler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        this.goBack();
      }
    };
    window.addEventListener('keydown', escHandler);
    // Also listen inside iframe once loaded
    iframe.onload = () => {
      try {
        iframe.contentWindow?.addEventListener('keydown', escHandler);
      } catch (_) { /* cross-origin safety */ }
    };

    // Store handler ref for cleanup
    (this as any)._escHandler = escHandler;
    (this as any)._iframe = iframe;
  }

  private goBack() {
    this.cleanup();
    this.scene.start('MenuScene');
  }

  private cleanup() {
    if (this.iframeWrapper) {
      // Remove ESC listener
      const escHandler = (this as any)._escHandler;
      if (escHandler) {
        window.removeEventListener('keydown', escHandler);
        try {
          (this as any)._iframe?.contentWindow?.removeEventListener('keydown', escHandler);
        } catch (_) { /* */ }
      }
      this.iframeWrapper.remove();
      this.iframeWrapper = null;
    }
  }

  shutdown() {
    this.cleanup();
  }
}
