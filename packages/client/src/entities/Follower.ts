import Phaser from 'phaser';
import { Follower, FollowerType } from '@prompt-battle/shared';
import { TILE_SIZE } from '../map/MapGenerator';

const FOLLOWER_EMOJIS: Record<FollowerType, string> = {
  wolf: '\uD83D\uDC3A',
  hawk: '\uD83E\uDD85',
  militia: '\u2694\uFE0F',
};

const FOLLOWER_COLORS: Record<FollowerType, number> = {
  wolf: 0x8B4513,
  hawk: 0x87CEEB,
  militia: 0x808080,
};

const RADIUS = 10;
const HP_BAR_WIDTH = 30;
const HP_BAR_HEIGHT = 4;
const LERP_FACTOR = 0.15;

export class FollowerEntity extends Phaser.GameObjects.Container {
  public followerType: FollowerType;
  private circle: Phaser.GameObjects.Arc;
  private label: Phaser.GameObjects.Text;
  private hpBarBg: Phaser.GameObjects.Rectangle;
  private hpBarFill: Phaser.GameObjects.Rectangle;
  private targetX: number;
  private targetY: number;

  constructor(scene: Phaser.Scene, follower: Follower) {
    const px = follower.position.x * TILE_SIZE + TILE_SIZE / 2;
    const py = follower.position.y * TILE_SIZE + TILE_SIZE / 2;
    super(scene, px, py);

    this.followerType = follower.type;
    this.targetX = px;
    this.targetY = py;

    // Colored circle
    const color = FOLLOWER_COLORS[follower.type];
    this.circle = scene.add.circle(0, 0, RADIUS, color);
    this.circle.setStrokeStyle(1.5, 0x000000, 0.6);
    this.add(this.circle);

    // Emoji label centered on circle
    const emoji = FOLLOWER_EMOJIS[follower.type];
    this.label = scene.add.text(0, -1, emoji, {
      fontSize: '10px',
    }).setOrigin(0.5);
    this.add(this.label);

    // HP bar background
    this.hpBarBg = scene.add.rectangle(0, RADIUS + 4, HP_BAR_WIDTH, HP_BAR_HEIGHT, 0x000000, 0.7);
    this.hpBarBg.setOrigin(0.5);
    this.add(this.hpBarBg);

    // HP bar fill
    this.hpBarFill = scene.add.rectangle(0, RADIUS + 4, HP_BAR_WIDTH, HP_BAR_HEIGHT, color);
    this.hpBarFill.setOrigin(0.5);
    this.add(this.hpBarFill);

    this.updateHp(follower.currentHp, follower.stats.hp);

    this.setDepth(10);
    scene.add.existing(this);
  }

  syncPosition(x: number, y: number): void {
    this.targetX = x * TILE_SIZE + TILE_SIZE / 2;
    this.targetY = y * TILE_SIZE + TILE_SIZE / 2;
  }

  updateHp(current: number, max: number): void {
    const ratio = Math.max(0, Math.min(1, current / max));
    const fillW = HP_BAR_WIDTH * ratio;
    this.hpBarFill.setDisplaySize(fillW, HP_BAR_HEIGHT);

    // Color: green when healthy, yellow when mid, red when low
    const color = ratio > 0.5
      ? FOLLOWER_COLORS[this.followerType]
      : ratio > 0.25 ? 0xFFD93D : 0xFF6B6B;
    this.hpBarFill.setFillStyle(color);
  }

  preUpdate(): void {
    // Smooth lerp toward target position
    const dx = this.targetX - this.x;
    const dy = this.targetY - this.y;
    if (Math.abs(dx) > 0.5 || Math.abs(dy) > 0.5) {
      this.x += dx * LERP_FACTOR;
      this.y += dy * LERP_FACTOR;
    } else {
      this.x = this.targetX;
      this.y = this.targetY;
    }
  }

  destroy(): void {
    this.circle.destroy();
    this.label.destroy();
    this.hpBarBg.destroy();
    this.hpBarFill.destroy();
    super.destroy();
  }
}
