import Phaser from 'phaser';

export class HealthBar {
  private bar: Phaser.GameObjects.Graphics;
  private maxHp: number;
  private currentHp: number;
  private width: number;
  private _visible = true;
  private classColor: number;

  constructor(scene: Phaser.Scene, x: number, y: number, maxHp: number, width = 30, classColor = 0x45E6B0) {
    this.bar = scene.add.graphics();
    this.maxHp = maxHp;
    this.currentHp = maxHp;
    this.width = width;
    this.classColor = classColor;
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

    // Cartoon black outline
    this.bar.fillStyle(0x000000, 0.8);
    this.bar.fillRoundedRect(barX - 2, barY - 2, this.width + 4, 8, 4);

    // Dark background
    this.bar.fillStyle(0x2A1858, 1);
    this.bar.fillRoundedRect(barX, barY, this.width, 5, 3);

    // Health fill - use class color when healthy, yellow when mid, red when low
    const ratio = Math.max(0, this.currentHp / this.maxHp);
    const color = ratio > 0.5 ? this.classColor : ratio > 0.25 ? 0xFFD93D : 0xFF6B6B;
    const fillW = this.width * ratio;
    if (fillW > 0) {
      this.bar.fillStyle(color);
      this.bar.fillRoundedRect(barX, barY, fillW, 5, 3);
      // Shine highlight
      this.bar.fillStyle(0xffffff, 0.25);
      this.bar.fillRoundedRect(barX + 1, barY, Math.max(0, fillW - 2), 2, 2);
    }
  }

  setDepth(depth: number) {
    this.bar.setDepth(depth);
  }

  destroy() {
    this.bar.destroy();
  }
}
