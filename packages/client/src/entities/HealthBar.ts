import Phaser from 'phaser';

export class HealthBar {
  private bar: Phaser.GameObjects.Graphics;
  private maxHp: number;
  private currentHp: number;
  private width: number;
  private _visible = true;

  constructor(scene: Phaser.Scene, x: number, y: number, maxHp: number, width = 28) {
    this.bar = scene.add.graphics();
    this.maxHp = maxHp;
    this.currentHp = maxHp;
    this.width = width;
    this.draw(x, y);
  }

  update(x: number, y: number, hp: number) {
    this.currentHp = hp;
    if (this._visible) this.draw(x, y);
  }

  setVisible(visible: boolean) {
    this._visible = visible;
    this.bar.setVisible(visible);
  }

  private draw(x: number, y: number) {
    this.bar.clear();
    const barX = x - this.width / 2;
    const barY = y - 22;

    this.bar.fillStyle(0x000000, 0.6);
    this.bar.fillRect(barX - 1, barY - 1, this.width + 2, 6);

    const ratio = Math.max(0, this.currentHp / this.maxHp);
    const color = ratio > 0.5 ? 0x4caf50 : ratio > 0.25 ? 0xffaa00 : 0xff4444;
    this.bar.fillStyle(color);
    this.bar.fillRect(barX, barY, this.width * ratio, 4);
  }

  setDepth(depth: number) {
    this.bar.setDepth(depth);
  }

  destroy() {
    this.bar.destroy();
  }
}
