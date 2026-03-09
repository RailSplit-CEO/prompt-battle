import Phaser from 'phaser';
import { AnimalUnit, AnimalType, UNIT_DEFS } from '@prompt-battle/shared';
import { TILE_SIZE } from '../map/MapGenerator';

const UNIT_EMOJIS: Record<AnimalType, string> = {
  rabbit: '🐇', parrot: '🦜', wolf: '🐺', falcon: '🦅', goat: '🐐',
  bear: '🐻', viper: '🐍', deer: '🦌', elephant: '🐘', lion: '🦁',
};

const UNIT_COLORS: Record<AnimalType, number> = {
  rabbit: 0xCCBB99, parrot: 0x44CC44, wolf: 0x888888, falcon: 0x8B6B3A, goat: 0xDDDDCC,
  bear: 0x8B4513, viper: 0x55AA55, deer: 0xCC8844, elephant: 0x999999, lion: 0xDDAA44,
};

const RADIUS = 8;
const HP_BAR_WIDTH = 20;
const HP_BAR_HEIGHT = 3;
const LERP_FACTOR = 0.12;

export class FollowerEntity extends Phaser.GameObjects.Container {
  public unitId: string;
  public unitType: AnimalType;
  public team: 'player1' | 'player2';

  private circle: Phaser.GameObjects.Arc;
  private label: Phaser.GameObjects.Text;
  private hpBarBg: Phaser.GameObjects.Rectangle;
  private hpBarFill: Phaser.GameObjects.Rectangle;
  private targetX: number;
  private targetY: number;

  constructor(scene: Phaser.Scene, unit: AnimalUnit) {
    const px = unit.position.x * TILE_SIZE + TILE_SIZE / 2;
    const py = unit.position.y * TILE_SIZE + TILE_SIZE / 2;
    super(scene, px, py);

    this.unitId = unit.id;
    this.unitType = unit.type;
    this.team = unit.team;
    this.targetX = px;
    this.targetY = py;

    // Team-tinted circle
    const teamColor = unit.team === 'player1' ? 0x4499FF : 0xFF5555;
    const baseColor = UNIT_COLORS[unit.type];

    this.circle = scene.add.circle(0, 0, RADIUS, baseColor);
    this.circle.setStrokeStyle(1.5, teamColor, 0.8);
    this.add(this.circle);

    // Animal emoji
    const emoji = UNIT_EMOJIS[unit.type];
    this.label = scene.add.text(0, -1, emoji, {
      fontSize: '10px',
    }).setOrigin(0.5);
    this.add(this.label);

    // HP bar
    this.hpBarBg = scene.add.rectangle(0, RADIUS + 3, HP_BAR_WIDTH, HP_BAR_HEIGHT, 0x000000, 0.7).setOrigin(0.5);
    this.add(this.hpBarBg);
    this.hpBarFill = scene.add.rectangle(0, RADIUS + 3, HP_BAR_WIDTH, HP_BAR_HEIGHT, baseColor).setOrigin(0.5);
    this.add(this.hpBarFill);

    this.updateHp(unit.currentHp, unit.maxHp);
    this.setDepth(9);
    scene.add.existing(this);
  }

  syncPosition(tileX: number, tileY: number): void {
    // Add slight offset based on unit id hash for spread
    const hash = this.unitId.split('').reduce((a, c) => a + c.charCodeAt(0), 0);
    const offsetX = ((hash % 7) - 3) * 3;
    const offsetY = (((hash >> 3) % 7) - 3) * 3;
    this.targetX = tileX * TILE_SIZE + TILE_SIZE / 2 + offsetX;
    this.targetY = tileY * TILE_SIZE + TILE_SIZE / 2 + offsetY;
  }

  updateHp(current: number, max: number): void {
    const ratio = Math.max(0, Math.min(1, current / max));
    this.hpBarFill.setDisplaySize(HP_BAR_WIDTH * ratio, HP_BAR_HEIGHT);
    const color = ratio > 0.5 ? UNIT_COLORS[this.unitType] : ratio > 0.25 ? 0xFFD93D : 0xFF6B6B;
    this.hpBarFill.setFillStyle(color);
  }

  preUpdate(): void {
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

  setFogVisible(visible: boolean) {
    this.setAlpha(visible ? 1 : 0);
  }

  destroy(): void {
    this.circle.destroy();
    this.label.destroy();
    this.hpBarBg.destroy();
    this.hpBarFill.destroy();
    super.destroy();
  }
}
