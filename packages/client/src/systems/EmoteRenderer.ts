// ─── EmoteRenderer — floating emote bubbles in the Phaser world ──
// Shows emoji text that floats up and fades out above a world position.
// Used for both the local player's emotes and synced opponent emotes.

import Phaser from 'phaser';

// ── Emote display strings (emoji + optional short label) ─────────

const EMOTE_DISPLAY: Record<string, string> = {
  emote_gg: '\uD83E\uDD1D GG',
  emote_wow: '\uD83D\uDE2E WOW',
  emote_lol: '\uD83D\uDE02 LOL',
  emote_cry: '\uD83D\uDE22',
  emote_rage: '\uD83D\uDE21',
  emote_heart: '\u2764\uFE0F',
  emote_crown: '\uD83D\uDC51',
  emote_wave: '\uD83D\uDC4B',
  emote_dancing: '\uD83D\uDC83',
  emote_flexing: '\uD83D\uDCAA',
  emote_laughing: '\uD83E\uDD23',
  emote_sleeping: '\uD83D\uDE34',
  emote_battle_cry: '\u2694\uFE0F',
  emote_mock: '\uD83E\uDD2A',
  emote_cheer: '\uD83C\uDF89',
};

/** Duration of the float-up-and-fade animation in ms. */
const EMOTE_DURATION = 3000;

/** How far the emote floats upward (in world pixels). */
const FLOAT_DISTANCE = 60;

// ─── EmoteRenderer class ─────────────────────────────────────────

export class EmoteRenderer {
  private scene: Phaser.Scene;
  private activeEmotes: Phaser.GameObjects.Text[] = [];

  constructor(scene: Phaser.Scene) {
    this.scene = scene;
  }

  /**
   * Show an emote bubble floating above a position in the game world.
   * Used for both local player emotes and synced opponent emotes.
   *
   * @param emoteId  One of the emote item IDs (e.g. 'emote_gg').
   * @param worldX   World X coordinate to anchor the bubble.
   * @param worldY   World Y coordinate to anchor the bubble.
   */
  showEmote(emoteId: string, worldX: number, worldY: number): void {
    const display = EMOTE_DISPLAY[emoteId] || '\u2753';

    const startY = worldY - 40;

    const text = this.scene.add
      .text(worldX, startY, display, {
        fontSize: '28px',
        fontFamily: '"Nunito", sans-serif',
        fontStyle: 'bold',
        backgroundColor: 'rgba(0,0,0,0.7)',
        padding: { x: 10, y: 6 },
        // @ts-ignore — Phaser supports borderRadius on text background
        borderRadius: 8,
      })
      .setOrigin(0.5)
      .setDepth(200)
      .setScrollFactor(1);

    this.activeEmotes.push(text);

    // Float upward and fade out
    this.scene.tweens.add({
      targets: text,
      y: startY - FLOAT_DISTANCE,
      alpha: { from: 1, to: 0 },
      duration: EMOTE_DURATION,
      ease: 'Power2',
      onComplete: () => {
        text.destroy();
        this.activeEmotes = this.activeEmotes.filter((e) => e !== text);
      },
    });
  }

  /**
   * Show emote at the player's nexus position (for PvP visibility).
   * Offsets slightly higher so it sits above the nexus structure.
   *
   * @param emoteId  One of the emote item IDs.
   * @param nexusX   Nexus world X.
   * @param nexusY   Nexus world Y.
   */
  showEmoteAtNexus(emoteId: string, nexusX: number, nexusY: number): void {
    this.showEmote(emoteId, nexusX, nexusY - 30);
  }

  /** Clean up all active emote texts. Call on scene shutdown. */
  destroy(): void {
    for (const e of this.activeEmotes) {
      e.destroy();
    }
    this.activeEmotes = [];
  }
}
