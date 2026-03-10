import Phaser from 'phaser';
import { AnimalUnit, AnimalType } from '@prompt-battle/shared';
import { TILE_SIZE } from '../map/MapGenerator';
import { SPRITE_CONFIGS } from '../sprites/SpriteConfig';

const HP_BAR_WIDTH = 24;
const HP_BAR_HEIGHT = 3;
const LERP_FACTOR = 0.12;
const MOVE_THRESHOLD = 1.5;      // px delta to count as "moving"
const ATTACK_ANIM_COOLDOWN = 800; // ms before attack anim can replay

type AnimState = 'idle' | 'walk' | 'attack';

export class FollowerEntity extends Phaser.GameObjects.Container {
  public unitId: string;
  public unitType: AnimalType;
  public team: 'player1' | 'player2';

  private sprite: Phaser.GameObjects.Sprite;
  private teamIndicator: Phaser.GameObjects.Arc;
  private hpBarBg: Phaser.GameObjects.Rectangle;
  private hpBarFill: Phaser.GameObjects.Rectangle;
  private targetX: number;
  private targetY: number;
  private prevX: number;
  private prevY: number;
  private animState: AnimState = 'idle';
  private lastAttackTime: number = 0;
  private spriteScale: number;

  constructor(scene: Phaser.Scene, unit: AnimalUnit) {
    const px = unit.position.x * TILE_SIZE + TILE_SIZE / 2;
    const py = unit.position.y * TILE_SIZE + TILE_SIZE / 2;
    super(scene, px, py);

    this.unitId = unit.id;
    this.unitType = unit.type;
    this.team = unit.team;
    this.targetX = px;
    this.targetY = py;
    this.prevX = px;
    this.prevY = py;

    const config = SPRITE_CONFIGS[unit.type];
    this.spriteScale = config.displayScale;

    // Team-color dot underneath the sprite
    const teamColor = unit.team === 'player1' ? 0x4499FF : 0xFF5555;
    this.teamIndicator = scene.add.circle(0, 4, 5, teamColor, 0.5);
    this.add(this.teamIndicator);

    // Animated sprite
    this.sprite = scene.add.sprite(0, 0, config.idle.key);
    this.sprite.setScale(this.spriteScale);
    this.sprite.setOrigin(0.5, config.originY);
    this.add(this.sprite);

    // Start idle animation
    this.sprite.play(`${unit.type}_idle`);

    // Apply team tint (subtle) - red team gets a slight red tint
    if (unit.team === 'player2') {
      this.sprite.setTint(0xFFCCCC);
    }

    // HP bar background
    const barY = -(config.idle.frameHeight * this.spriteScale * config.originY) - 2;
    this.hpBarBg = scene.add.rectangle(0, barY, HP_BAR_WIDTH, HP_BAR_HEIGHT, 0x000000, 0.7).setOrigin(0.5);
    this.add(this.hpBarBg);
    this.hpBarFill = scene.add.rectangle(0, barY, HP_BAR_WIDTH, HP_BAR_HEIGHT, 0x44DD66).setOrigin(0.5);
    this.add(this.hpBarFill);

    this.updateHp(unit.currentHp, unit.maxHp);
    this.setDepth(9);
    scene.add.existing(this);

    // When attack animation completes, return to idle or walk
    this.sprite.on('animationcomplete', (anim: Phaser.Animations.Animation) => {
      if (anim.key === `${this.unitType}_attack`) {
        this.animState = 'idle';
        this.sprite.play(`${this.unitType}_idle`);
      }
    });
  }

  syncPosition(tileX: number, tileY: number): void {
    const hash = this.unitId.split('').reduce((a, c) => a + c.charCodeAt(0), 0);
    const offsetX = ((hash % 7) - 3) * 3;
    const offsetY = (((hash >> 3) % 7) - 3) * 3;
    this.targetX = tileX * TILE_SIZE + TILE_SIZE / 2 + offsetX;
    this.targetY = tileY * TILE_SIZE + TILE_SIZE / 2 + offsetY;
  }

  updateHp(current: number, max: number): void {
    const ratio = Math.max(0, Math.min(1, current / max));
    this.hpBarFill.setDisplaySize(HP_BAR_WIDTH * ratio, HP_BAR_HEIGHT);
    const color = ratio > 0.5 ? 0x44DD66 : ratio > 0.25 ? 0xFFD93D : 0xFF6B6B;
    this.hpBarFill.setFillStyle(color);
  }

  playAttack(): void {
    const now = this.scene.time.now;
    if (now - this.lastAttackTime < ATTACK_ANIM_COOLDOWN) return;
    if (this.animState === 'attack') return;

    this.animState = 'attack';
    this.lastAttackTime = now;
    this.sprite.play(`${this.unitType}_attack`);
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

    // Determine movement for animation state
    const movedX = this.x - this.prevX;
    const movedY = this.y - this.prevY;
    const isMoving = Math.abs(movedX) > MOVE_THRESHOLD || Math.abs(movedY) > MOVE_THRESHOLD;

    // Flip sprite based on horizontal movement direction
    if (Math.abs(movedX) > 0.3) {
      this.sprite.setFlipX(movedX < 0);
    }

    // Update animation state (attack takes priority)
    if (this.animState !== 'attack') {
      if (isMoving && this.animState !== 'walk') {
        this.animState = 'walk';
        this.sprite.play(`${this.unitType}_walk`);
      } else if (!isMoving && this.animState !== 'idle') {
        this.animState = 'idle';
        this.sprite.play(`${this.unitType}_idle`);
      }
    }

    this.prevX = this.x;
    this.prevY = this.y;
  }

  setFogVisible(visible: boolean) {
    this.setAlpha(visible ? 1 : 0);
  }

  destroy(): void {
    this.sprite.destroy();
    this.teamIndicator.destroy();
    this.hpBarBg.destroy();
    this.hpBarFill.destroy();
    super.destroy();
  }
}
