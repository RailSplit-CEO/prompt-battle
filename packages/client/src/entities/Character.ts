import Phaser from 'phaser';
import { Hero, HERO_PASSIVES } from '@prompt-battle/shared';
import { HealthBar } from './HealthBar';
import { TILE_SIZE } from '../map/MapGenerator';

const PASSIVE_EMOJIS: Record<string, string> = {
  rally_leader: '📯',
  iron_will: '🛡️',
  swift_command: '⚡',
};

const ORDER_COLORS: Record<string, string> = {
  MOVE: '#45E6B0',
  ATK: '#FF6B6B',
  ATTACK: '#FF6B6B',
  DEFEND: '#6CC4FF',
  RETREAT: '#FF8EC8',
  HOLD: '#FFD93D',
  DEAD: '#FF6B6B',
  idle: '#8B6DB0',
};

function getOrderColor(text: string): string {
  const upper = text.toUpperCase();
  for (const [key, color] of Object.entries(ORDER_COLORS)) {
    if (upper.startsWith(key)) return color;
  }
  return '#8B6DB0';
}

export class CharacterEntity {
  public sprite: Phaser.GameObjects.Sprite;
  public data: Hero;
  public isMoving = false;
  public onArrived?: () => void;

  private healthBar: HealthBar;
  private nameLabel: Phaser.GameObjects.Text;
  private orderLabel: Phaser.GameObjects.Text;
  private orderBg: Phaser.GameObjects.Graphics;
  private emojiLabel: Phaser.GameObjects.Text;
  private barkBubble?: Phaser.GameObjects.Container;
  private barkTimer?: Phaser.Time.TimerEvent;
  private respawnOverlay?: Phaser.GameObjects.Text;
  private armyCountLabel: Phaser.GameObjects.Text;
  private scene: Phaser.Scene;
  private selectionRing?: Phaser.GameObjects.Sprite;
  private selectionGlow?: Phaser.GameObjects.Graphics;
  private glowTween?: Phaser.Tweens.Tween;
  private micLabel?: Phaser.GameObjects.Text;
  private isPlayer1: boolean;
  private _visible = true;
  private teamColor: number;

  constructor(scene: Phaser.Scene, heroData: Hero, isPlayer1: boolean) {
    this.scene = scene;
    this.data = heroData;
    this.isPlayer1 = isPlayer1;
    this.teamColor = isPlayer1 ? 0x4499FF : 0xFF5555;

    const px = heroData.position.x * TILE_SIZE + TILE_SIZE / 2;
    const py = heroData.position.y * TILE_SIZE + TILE_SIZE / 2;

    const textureKey = `hero_${isPlayer1 ? 'p1' : 'p2'}`;
    this.sprite = scene.add.sprite(px, py, textureKey);
    this.sprite.setDepth(10);
    this.sprite.setData('heroId', heroData.id);
    this.sprite.setInteractive({ useHandCursor: true });

    // Passive emoji as the hero's icon
    const passiveEmoji = PASSIVE_EMOJIS[heroData.passive] ?? '👤';
    this.emojiLabel = scene.add.text(px, py - 1, passiveEmoji, {
      fontSize: '22px',
    }).setOrigin(0.5).setDepth(11);

    // Health bar
    this.healthBar = new HealthBar(scene, px, py, heroData.maxHp, 30, this.teamColor);
    this.healthBar.setDepth(11);

    // Name label
    this.nameLabel = scene.add.text(px, py + 18, heroData.name, {
      fontSize: '9px',
      color: isPlayer1 ? '#6CC4FF' : '#FF8EC8',
      fontFamily: '"Nunito", sans-serif',
      fontStyle: 'bold',
      shadow: { offsetX: 1, offsetY: 1, color: '#000', blur: 3, fill: true, stroke: true },
      backgroundColor: 'rgba(0,0,0,0.35)',
      padding: { x: 2, y: 1 },
    }).setOrigin(0.5, 0).setDepth(11);

    // Army count label (shows number of followers)
    this.armyCountLabel = scene.add.text(px + 14, py - 14, '', {
      fontSize: '10px',
      color: '#FFD93D',
      fontFamily: '"Fredoka", sans-serif',
      fontStyle: 'bold',
      shadow: { offsetX: 1, offsetY: 1, color: '#000', blur: 2, fill: true, stroke: true },
      backgroundColor: 'rgba(0,0,0,0.5)',
      padding: { x: 2, y: 0 },
    }).setOrigin(0.5).setDepth(13);

    // Order bg + label
    this.orderBg = scene.add.graphics().setDepth(11);
    this.orderLabel = scene.add.text(px, py - 28, '', {
      fontSize: '11px',
      color: '#FFD93D',
      fontFamily: '"Nunito", sans-serif',
      fontStyle: 'bold',
      shadow: { offsetX: 1, offsetY: 1, color: '#000', blur: 2, fill: true, stroke: true },
    }).setOrigin(0.5, 1).setDepth(12);
  }

  setArmyCount(count: number) {
    if (count > 0) {
      this.armyCountLabel.setText(`x${count}`);
      this.armyCountLabel.setVisible(true);
    } else {
      this.armyCountLabel.setVisible(false);
    }
  }

  setOrderText(text: string) {
    this.orderLabel.setText(text);
    this.orderLabel.setColor(getOrderColor(text));
    this.drawOrderBg();
  }

  showBark(text: string) {
    if (this.barkBubble) { this.barkBubble.destroy(); this.barkBubble = undefined; }
    if (this.barkTimer) { this.barkTimer.destroy(); this.barkTimer = undefined; }

    const px = this.sprite.x;
    const py = this.sprite.y - 44;
    const container = this.scene.add.container(px, py).setDepth(30);

    const bg = this.scene.add.graphics();
    const textObj = this.scene.add.text(0, 0, text, {
      fontSize: '9px',
      color: '#fff',
      fontFamily: '"Nunito", sans-serif',
      fontStyle: 'bold',
      wordWrap: { width: 120 },
    }).setOrigin(0.5);
    const w = textObj.width + 10;
    const h = textObj.height + 6;
    bg.fillStyle(0x000000, 0.85);
    bg.fillRoundedRect(-w / 2, -h / 2, w, h, 5);
    bg.fillTriangle(0, h / 2, -4, h / 2 + 6, 4, h / 2);

    container.add(bg);
    container.add(textObj);
    container.setAlpha(0).setScale(0.8);
    this.scene.tweens.add({
      targets: container, alpha: 1, scaleX: 1, scaleY: 1,
      duration: 150, ease: 'Back.easeOut',
    });

    this.barkBubble = container;
    this.barkTimer = this.scene.time.delayedCall(2500, () => {
      if (this.barkBubble) {
        this.scene.tweens.add({
          targets: this.barkBubble, alpha: 0, y: this.barkBubble.y - 10,
          duration: 300, onComplete: () => { this.barkBubble?.destroy(); this.barkBubble = undefined; },
        });
      }
    });
  }

  private drawOrderBg() {
    this.orderBg.clear();
    const text = this.orderLabel.text;
    if (!text || text === 'idle') return;
    const w = this.orderLabel.width + 6;
    const h = this.orderLabel.height + 2;
    this.orderBg.fillStyle(0x000000, 0.8);
    this.orderBg.fillRoundedRect(this.orderLabel.x - w / 2, this.orderLabel.y - h, w, h, 3);
  }

  setFogVisible(visible: boolean) {
    if (this._visible === visible) return;
    this._visible = visible;
    const alpha = visible ? 1 : 0;
    this.sprite.setAlpha(alpha);
    this.emojiLabel.setAlpha(alpha);
    this.healthBar.setVisible(visible);
    this.nameLabel.setAlpha(alpha);
    this.orderLabel.setAlpha(alpha);
    this.orderBg.setAlpha(alpha);
    this.armyCountLabel.setAlpha(alpha);
    if (this.micLabel) this.micLabel.setAlpha(alpha);
    if (this.selectionGlow) this.selectionGlow.setAlpha(visible ? 0.7 : 0);
    if (this.barkBubble) this.barkBubble.setAlpha(alpha);
  }

  get fogVisible() { return this._visible; }

  showRespawning(secondsLeft: number) {
    if (!this.respawnOverlay) {
      this.respawnOverlay = this.scene.add.text(this.sprite.x, this.sprite.y, '', {
        fontSize: '16px', color: '#FF6B6B',
        fontFamily: '"Fredoka", sans-serif', fontStyle: 'bold',
        shadow: { offsetX: 1, offsetY: 1, color: '#000', blur: 3, fill: true, stroke: true },
        backgroundColor: 'rgba(0,0,0,0.5)', padding: { x: 4, y: 2 },
      }).setOrigin(0.5).setDepth(15);
    }
    this.respawnOverlay.setText(`\u2620 ${Math.ceil(secondsLeft)}`);
    this.respawnOverlay.setPosition(this.sprite.x, this.sprite.y);
    this.sprite.setAlpha(0.15);
    this.emojiLabel.setAlpha(0.15);
    this.nameLabel.setAlpha(0.25);
    this.healthBar.setVisible(false);
    this.setOrderText('DEAD');
  }

  hideRespawn() {
    if (this.respawnOverlay) { this.respawnOverlay.destroy(); this.respawnOverlay = undefined; }
    this.sprite.setAlpha(1);
    this.emojiLabel.setAlpha(1);
    this.nameLabel.setAlpha(1);
    this.healthBar.setVisible(true);
    this.setOrderText('');
  }

  stepToTile(tileX: number, tileY: number): Promise<void> {
    if (this.isMoving) return Promise.resolve();
    this.isMoving = true;
    const px = tileX * TILE_SIZE + TILE_SIZE / 2;
    const py = tileY * TILE_SIZE + TILE_SIZE / 2;

    return new Promise((resolve) => {
      this.scene.tweens.add({
        targets: this.sprite, x: px, y: py, duration: 820, ease: 'Sine.easeInOut',
        onUpdate: () => this.syncPositions(),
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
    this.emojiLabel.setPosition(this.sprite.x, this.sprite.y - 1);
    this.nameLabel.setPosition(this.sprite.x, this.sprite.y + 18);
    this.orderLabel.setPosition(this.sprite.x, this.sprite.y - 28);
    this.armyCountLabel.setPosition(this.sprite.x + 14, this.sprite.y - 14);
    this.drawOrderBg();
    if (this.selectionRing) this.selectionRing.setPosition(this.sprite.x, this.sprite.y);
    if (this.selectionGlow?.visible) this.drawSelectionGlow();
    if (this.micLabel?.visible) this.micLabel.setPosition(this.sprite.x + 16, this.sprite.y - 20);
    if (this.respawnOverlay) this.respawnOverlay.setPosition(this.sprite.x, this.sprite.y);
    if (this.barkBubble) this.barkBubble.setPosition(this.sprite.x, this.sprite.y - 44);
  }

  updateFromState(heroData: Hero) {
    this.data = heroData;
    this.healthBar.update(this.sprite.x, this.sprite.y, heroData.currentHp);
    this.nameLabel.setText(heroData.name);
  }

  showDamage(amount: number) {
    const text = this.scene.add.text(this.sprite.x, this.sprite.y - 30, `-${amount}`, {
      fontSize: '18px', color: '#FF6B6B',
      fontFamily: '"Fredoka", sans-serif', fontStyle: 'bold',
    }).setOrigin(0.5).setDepth(20);
    this.scene.tweens.add({
      targets: text, y: text.y - 35, alpha: 0,
      scaleX: { from: 1.3, to: 0.8 }, scaleY: { from: 1.3, to: 0.8 },
      duration: 900, ease: 'Cubic.easeOut', onComplete: () => text.destroy(),
    });
    this.sprite.setTint(0xff0000);
    this.scene.time.delayedCall(200, () => this.sprite.clearTint());
  }

  showHealing(amount: number) {
    const text = this.scene.add.text(this.sprite.x, this.sprite.y - 30, `+${amount}`, {
      fontSize: '18px', color: '#45E6B0',
      fontFamily: '"Fredoka", sans-serif', fontStyle: 'bold',
    }).setOrigin(0.5).setDepth(20);
    this.scene.tweens.add({
      targets: text, y: text.y - 30, alpha: 0, duration: 800, onComplete: () => text.destroy(),
    });
  }

  select() {
    if (!this.selectionRing) {
      this.selectionRing = this.scene.add.sprite(this.sprite.x, this.sprite.y, 'selection_ring').setDepth(9);
    }
    this.selectionRing.setVisible(true);
    if (!this.selectionGlow) this.selectionGlow = this.scene.add.graphics().setDepth(8);
    this.selectionGlow.setVisible(true).setAlpha(0.7);
    this.drawSelectionGlow();
    if (this.glowTween) this.glowTween.destroy();
    this.glowTween = this.scene.tweens.add({
      targets: this.selectionGlow, alpha: { from: 0.7, to: 0.2 },
      duration: 900, yoyo: true, repeat: -1, ease: 'Sine.easeInOut',
    });
    if (!this.micLabel) {
      this.micLabel = this.scene.add.text(this.sprite.x + 16, this.sprite.y - 20, '\uD83C\uDF99\uFE0F', {
        fontSize: '12px',
      }).setOrigin(0.5).setDepth(14);
    }
    this.micLabel.setVisible(true).setPosition(this.sprite.x + 16, this.sprite.y - 20);
  }

  deselect() {
    if (this.selectionRing) this.selectionRing.setVisible(false);
    if (this.selectionGlow) {
      this.selectionGlow.setVisible(false);
      if (this.glowTween) { this.glowTween.destroy(); this.glowTween = undefined; }
    }
    if (this.micLabel) this.micLabel.setVisible(false);
  }

  private drawSelectionGlow() {
    if (!this.selectionGlow) return;
    this.selectionGlow.clear();
    this.selectionGlow.lineStyle(5, this.teamColor, 1);
    this.selectionGlow.strokeCircle(this.sprite.x, this.sprite.y, 22);
    this.selectionGlow.lineStyle(2.5, 0xffffff, 0.5);
    this.selectionGlow.strokeCircle(this.sprite.x, this.sprite.y, 26);
  }

  destroy() {
    this.sprite.destroy();
    this.healthBar.destroy();
    this.nameLabel.destroy();
    this.orderLabel.destroy();
    this.orderBg.destroy();
    this.emojiLabel.destroy();
    this.armyCountLabel.destroy();
    if (this.selectionRing) this.selectionRing.destroy();
    if (this.selectionGlow) this.selectionGlow.destroy();
    if (this.glowTween) this.glowTween.destroy();
    if (this.micLabel) this.micLabel.destroy();
    if (this.respawnOverlay) this.respawnOverlay.destroy();
    if (this.barkBubble) this.barkBubble.destroy();
    if (this.barkTimer) this.barkTimer.destroy();
  }
}
