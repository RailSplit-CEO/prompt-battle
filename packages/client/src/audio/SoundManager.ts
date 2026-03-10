export type SfxKey = string;

/** Stub SoundManager — audio not yet implemented */
export class SoundManager {
  constructor(_scene: Phaser.Scene) {}
  static preload(_scene: Phaser.Scene) {}
  play(_key: SfxKey) {}
}
