export type SfxKey = string;

/** Stub SoundManager — audio not yet implemented */
export class SoundManager {
  private static instance: SoundManager | null = null;

  constructor(_scene: Phaser.Scene) {}

  static preload(_scene: Phaser.Scene) {}

  static getInstance(): SoundManager {
    if (!SoundManager.instance) SoundManager.instance = new SoundManager(null as any);
    return SoundManager.instance;
  }

  init() {}
  play(_key: SfxKey) {}
  playGlobal(_key: SfxKey) {}
  playAt(_key: SfxKey, _x: number, _y: number) {}
  hasSound(_key: SfxKey): boolean { return false; }
  playReaction(_reaction: any, _units?: any) {}
}
