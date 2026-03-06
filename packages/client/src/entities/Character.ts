import Phaser from 'phaser';
import { Character as CharData, Position, ActiveEffect } from '@prompt-battle/shared';
import { HealthBar } from './HealthBar';
import { TILE_SIZE } from '../map/MapGenerator';

// Color per order type
const ORDER_COLORS: Record<string, string> = {
  MOVE: '#45E6B0',
  ATK: '#FF6B6B',
  ATTACK: '#FF6B6B',
  CAPTURE: '#FFD93D',
  DEFEND: '#6CC4FF',
  RETREAT: '#FF8EC8',
  ESCORT: '#45E6E6',
  PATROL: '#95E6B0',
  CONTROL: '#FFD93D',
  STUNNED: '#FF6B6B',
  DEAD: '#FF6B6B',
  idle: '#8B6DB0',
  blocked: '#FF9F43',
};

function getOrderColor(text: string): string {
  const upper = text.toUpperCase();
  for (const [key, color] of Object.entries(ORDER_COLORS)) {
    if (upper.startsWith(key)) return color;
  }
  // Ability names (casting) - purple
  if (upper.length > 0 && upper !== 'IDLE') return '#C98FFF';
  return '#8B6DB0';
}

export class CharacterEntity {
  public sprite: Phaser.GameObjects.Sprite;
  public data: CharData;
  public isMoving = false;
  public onArrived?: () => void;

  private healthBar: HealthBar;
  private nameLabel: Phaser.GameObjects.Text;
  private orderLabel: Phaser.GameObjects.Text;
  private orderBg: Phaser.GameObjects.Graphics;
  private flagIcon?: Phaser.GameObjects.Graphics;
  private respawnOverlay?: Phaser.GameObjects.Text;
  private scene: Phaser.Scene;
  private selectionRing?: Phaser.GameObjects.Sprite;
  private effectAuras: Map<string, Phaser.GameObjects.Graphics> = new Map();
  private isPlayer1: boolean;
  private _visible = true;

  constructor(scene: Phaser.Scene, charData: CharData, isPlayer1: boolean) {
    this.scene = scene;
    this.data = charData;
    this.isPlayer1 = isPlayer1;

    const px = charData.position.x * TILE_SIZE + TILE_SIZE / 2;
    const py = charData.position.y * TILE_SIZE + TILE_SIZE / 2;

    const textureKey = `char_${charData.classId}_${isPlayer1 ? 'p1' : 'p2'}`;
    this.sprite = scene.add.sprite(px, py, textureKey);
    this.sprite.setDepth(10);
    this.sprite.setData('charId', charData.id);
    this.sprite.setInteractive({ useHandCursor: true });

    this.healthBar = new HealthBar(scene, px, py, charData.stats.hp);
    this.healthBar.setDepth(11);

    this.nameLabel = scene.add.text(px, py + 18, charData.name, {
      fontSize: '10px',
      color: isPlayer1 ? '#6CC4FF' : '#FF8EC8',
      fontFamily: '"Nunito", sans-serif',
      fontStyle: 'bold',
    });
    this.nameLabel.setOrigin(0.5, 0);
    this.nameLabel.setDepth(11);

    // Order label background
    this.orderBg = scene.add.graphics();
    this.orderBg.setDepth(11);

    this.orderLabel = scene.add.text(px, py - 28, '', {
      fontSize: '10px',
      color: '#FFD93D',
      fontFamily: '"Nunito", sans-serif',
      fontStyle: 'bold',
    });
    this.orderLabel.setOrigin(0.5, 1);
    this.orderLabel.setDepth(12);
  }

  setOrderText(text: string) {
    this.orderLabel.setText(text);
    const color = getOrderColor(text);
    this.orderLabel.setColor(color);
    this.drawOrderBg();
  }

  private drawOrderBg() {
    this.orderBg.clear();
    const text = this.orderLabel.text;
    if (!text || text === 'idle') return;
    const w = this.orderLabel.width + 6;
    const h = this.orderLabel.height + 2;
    const x = this.orderLabel.x - w / 2;
    const y = this.orderLabel.y - h;
    this.orderBg.fillStyle(0x000000, 0.6);
    this.orderBg.fillRoundedRect(x, y, w, h, 3);
  }

  setFogVisible(visible: boolean) {
    if (this._visible === visible) return;
    this._visible = visible;
    const alpha = visible ? 1 : 0;
    this.sprite.setAlpha(alpha);
    this.healthBar.setVisible(visible);
    this.nameLabel.setAlpha(alpha);
    this.orderLabel.setAlpha(alpha);
    this.orderBg.setAlpha(alpha);
    if (this.flagIcon) this.flagIcon.setAlpha(alpha);
  }

  get fogVisible() { return this._visible; }

  showFlagCarrier(carrying: boolean) {
    if (carrying && !this.flagIcon) {
      this.flagIcon = this.scene.add.graphics();
      this.flagIcon.setDepth(13);
      this.drawFlagIcon();
    } else if (!carrying && this.flagIcon) {
      this.flagIcon.destroy();
      this.flagIcon = undefined;
    }
  }

  private drawFlagIcon() {
    if (!this.flagIcon) return;
    this.flagIcon.clear();
    const x = this.sprite.x + 10;
    const y = this.sprite.y - 16;
    this.flagIcon.lineStyle(2, 0xffffff);
    this.flagIcon.lineBetween(x, y, x, y - 12);
    const flagColor = this.isPlayer1 ? 0xFF6B6B : 0x6CC4FF;
    this.flagIcon.fillStyle(flagColor);
    this.flagIcon.fillTriangle(x, y - 12, x + 8, y - 9, x, y - 6);
  }

  showRespawning(secondsLeft: number) {
    if (!this.respawnOverlay) {
      this.respawnOverlay = this.scene.add.text(this.sprite.x, this.sprite.y, '', {
        fontSize: '14px',
        color: '#FF6B6B',
        fontFamily: '"Fredoka", sans-serif',
        fontStyle: 'bold',
      }).setOrigin(0.5).setDepth(15);
    }
    this.respawnOverlay.setText(String(Math.ceil(secondsLeft)));
    this.respawnOverlay.setPosition(this.sprite.x, this.sprite.y);
    this.sprite.setAlpha(0.2);
    this.nameLabel.setAlpha(0.3);
    this.healthBar.setVisible(false);
    this.orderLabel.setText('DEAD');
    this.orderLabel.setColor('#FF6B6B');
    this.drawOrderBg();
  }

  hideRespawn() {
    if (this.respawnOverlay) {
      this.respawnOverlay.destroy();
      this.respawnOverlay = undefined;
    }
    this.sprite.setAlpha(1);
    this.nameLabel.setAlpha(1);
    this.healthBar.setVisible(true);
    this.orderLabel.setText('');
    this.orderLabel.setColor('#FFD93D');
    this.orderBg.clear();
  }

  stepToTile(tileX: number, tileY: number): Promise<void> {
    if (this.isMoving) return Promise.resolve();
    this.isMoving = true;

    const px = tileX * TILE_SIZE + TILE_SIZE / 2;
    const py = tileY * TILE_SIZE + TILE_SIZE / 2;

    return new Promise((resolve) => {
      this.scene.tweens.add({
        targets: this.sprite,
        x: px,
        y: py,
        duration: 250,
        ease: 'Linear',
        onUpdate: () => {
          this.syncPositions();
        },
        onComplete: () => {
          this.data.position = { x: tileX, y: tileY };
          this.isMoving = false;
          resolve();
        },
      });
    });
  }

  snapToPosition() {
    const px = this.data.position.x * TILE_SIZE + TILE_SIZE / 2;
    const py = this.data.position.y * TILE_SIZE + TILE_SIZE / 2;
    this.sprite.setPosition(px, py);
    this.syncPositions();
  }

  private syncPositions() {
    this.healthBar.update(this.sprite.x, this.sprite.y, this.data.currentHp);
    this.nameLabel.setPosition(this.sprite.x, this.sprite.y + 18);
    this.orderLabel.setPosition(this.sprite.x, this.sprite.y - 28);
    this.drawOrderBg();
    if (this.selectionRing) this.selectionRing.setPosition(this.sprite.x, this.sprite.y);
    if (this.flagIcon) this.drawFlagIcon();
    if (this.respawnOverlay) this.respawnOverlay.setPosition(this.sprite.x, this.sprite.y);
  }

  updateFromState(charData: CharData) {
    this.data = charData;
    this.healthBar.update(this.sprite.x, this.sprite.y, charData.currentHp);
    this.showFlagCarrier(!!charData.hasFlag);
  }

  refreshVisuals() {
    this.healthBar.update(this.sprite.x, this.sprite.y, this.data.currentHp);
  }

  showDamage(amount: number) {
    const text = this.scene.add.text(this.sprite.x, this.sprite.y - 30, `-${amount}`, {
      fontSize: '18px',
      color: '#FF6B6B',
      fontFamily: '"Fredoka", sans-serif',
      fontStyle: 'bold',
    }).setOrigin(0.5).setDepth(20);

    this.scene.tweens.add({
      targets: text,
      y: text.y - 35,
      alpha: 0,
      scaleX: { from: 1.3, to: 0.8 },
      scaleY: { from: 1.3, to: 0.8 },
      duration: 900,
      ease: 'Cubic.easeOut',
      onComplete: () => text.destroy(),
    });

    this.sprite.setTint(0xff0000);
    this.scene.time.delayedCall(200, () => this.sprite.clearTint());
  }

  showHealing(amount: number) {
    const text = this.scene.add.text(this.sprite.x, this.sprite.y - 30, `+${amount}`, {
      fontSize: '18px',
      color: '#45E6B0',
      fontFamily: '"Fredoka", sans-serif',
      fontStyle: 'bold',
    }).setOrigin(0.5).setDepth(20);

    this.scene.tweens.add({
      targets: text,
      y: text.y - 30,
      alpha: 0,
      duration: 800,
      onComplete: () => text.destroy(),
    });
  }

  select() {
    if (!this.selectionRing) {
      this.selectionRing = this.scene.add.sprite(this.sprite.x, this.sprite.y, 'selection_ring');
      this.selectionRing.setDepth(9);
    }
    this.selectionRing.setVisible(true);
  }

  deselect() {
    if (this.selectionRing) this.selectionRing.setVisible(false);
  }

  updateEffectAuras(effects: ActiveEffect[]) {
    const EFFECT_COLORS: Record<string, number> = {
      stun: 0xFF6B6B,
      slow: 0x6CC4FF,
      speed_boost: 0xFFD93D,
      damage_boost: 0xFF9F43,
      defense_debuff: 0xC98FFF,
    };

    const activeTypes = new Set(effects.map(e => e.type));

    // Remove auras for expired effects
    for (const [type, gfx] of this.effectAuras) {
      if (!activeTypes.has(type)) {
        gfx.destroy();
        this.effectAuras.delete(type);
      }
    }

    // Add/update auras for active effects
    for (const type of activeTypes) {
      const color = EFFECT_COLORS[type];
      if (!color) continue;
      let gfx = this.effectAuras.get(type);
      if (!gfx) {
        gfx = this.scene.add.graphics().setDepth(9);
        this.effectAuras.set(type, gfx);
      }
      gfx.clear();
      gfx.lineStyle(1.5, color, 0.4);
      gfx.strokeCircle(this.sprite.x, this.sprite.y, 16);
    }
  }

  destroy() {
    this.sprite.destroy();
    this.healthBar.destroy();
    this.nameLabel.destroy();
    this.orderLabel.destroy();
    this.orderBg.destroy();
    if (this.selectionRing) this.selectionRing.destroy();
    if (this.flagIcon) this.flagIcon.destroy();
    if (this.respawnOverlay) this.respawnOverlay.destroy();
    for (const gfx of this.effectAuras.values()) gfx.destroy();
    this.effectAuras.clear();
  }
}
