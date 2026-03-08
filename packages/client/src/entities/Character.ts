import Phaser from 'phaser';
import { Character as CharData, Position, ActiveEffect, ClassId } from '@prompt-battle/shared';
import { HealthBar } from './HealthBar';
import { TILE_SIZE } from '../map/MapGenerator';

const CLASS_EMOJIS: Record<string, string> = {
  warrior: '⚔️',
  mage: '🔮',
  archer: '🏹',
  healer: '💚',
  rogue: '🗡️',
  paladin: '🛡️',
  necromancer: '💀',
  bard: '🎵',
};

const ANIMAL_EMOJIS: Record<string, string> = {
  wolf: '🐺', lion: '🦁', turtle: '🐢', elephant: '🐘',
  cheetah: '🐆', falcon: '🦅', owl: '🦉', phoenix: '🔥',
  chameleon: '🦎', spider: '🕷️',
  bear: '🐻', tiger: '🐯', eagle: '🦅', rhino: '🦏',
  armadillo: '🐾', crab: '🦀', hare: '🐇', fox: '🦊',
  horse: '🐴', raven: '🐦‍⬛', dragon: '🐉', serpent: '🐍',
  scorpion: '🦂', bat: '🦇', cat: '🐱',
};

const CLASS_COLORS: Record<string, number> = {
  warrior: 0xFF5555,
  mage: 0x5577FF,
  archer: 0x55CC55,
  healer: 0xFFDD44,
  rogue: 0xBB55FF,
  paladin: 0xFFAA33,
  necromancer: 0x8855BB,
  bard: 0xFF69B4,
};

// Morale indicators
const MORALE_COLORS: Record<string, string> = {
  confident: '#45E6B0',
  shaken: '#FFD93D',
};

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
  MINE: '#FFD93D',
  BUILD: '#FF9F43',
  SCOUT: '#6CC4FF',
  LOOT: '#FF9F43',
  idle: '#8B6DB0',
  blocked: '#FF9F43',
};

function getOrderColor(text: string): string {
  const upper = text.toUpperCase();
  for (const [key, color] of Object.entries(ORDER_COLORS)) {
    if (upper.startsWith(key)) return color;
  }
  if (upper.length > 0 && upper !== 'IDLE') return '#C98FFF';
  return '#8B6DB0';
}

function numberToHex(color: number): string {
  return '#' + color.toString(16).padStart(6, '0');
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
  private emojiLabel: Phaser.GameObjects.Text;
  private barkBubble?: Phaser.GameObjects.Container;
  private barkTimer?: Phaser.Time.TimerEvent;
  private flagIcon?: Phaser.GameObjects.Graphics;
  private respawnOverlay?: Phaser.GameObjects.Text;
  private scene: Phaser.Scene;
  private selectionRing?: Phaser.GameObjects.Sprite;
  private selectionGlow?: Phaser.GameObjects.Graphics;
  private glowTween?: Phaser.Tweens.Tween;
  private micLabel?: Phaser.GameObjects.Text;
  private effectAuras: Map<string, Phaser.GameObjects.Graphics> = new Map();
  private isPlayer1: boolean;
  private _visible = true;
  private classColor: number;

  constructor(scene: Phaser.Scene, charData: CharData, isPlayer1: boolean) {
    this.scene = scene;
    this.data = charData;
    this.isPlayer1 = isPlayer1;
    this.classColor = CLASS_COLORS[charData.classId] ?? 0xAAAAAA;

    const px = charData.position.x * TILE_SIZE + TILE_SIZE / 2;
    const py = charData.position.y * TILE_SIZE + TILE_SIZE / 2;

    const textureKey = `char_${charData.classId}_${isPlayer1 ? 'p1' : 'p2'}`;
    this.sprite = scene.add.sprite(px, py, textureKey);
    this.sprite.setDepth(10);
    this.sprite.setData('charId', charData.id);
    this.sprite.setInteractive({ useHandCursor: true });

    // Animal emoji on the character (animals ARE the characters) — big and prominent
    const animalEmoji = ANIMAL_EMOJIS[charData.animalId] ?? CLASS_EMOJIS[charData.classId] ?? '?';
    this.emojiLabel = scene.add.text(px, py - 1, animalEmoji, {
      fontSize: '22px',
    }).setOrigin(0.5).setDepth(11);

    // Health bar with class color
    this.healthBar = new HealthBar(scene, px, py, charData.stats.hp, 30, this.classColor);
    this.healthBar.setDepth(11);

    // Name + morale indicator below character
    const moraleIcon = charData.morale === 'confident' ? '●' : '◐';
    const moraleColor = MORALE_COLORS[charData.morale ?? 'confident'] || '#45E6B0';
    this.nameLabel = scene.add.text(px, py + 18, `${charData.name}`, {
      fontSize: '9px',
      color: isPlayer1 ? '#6CC4FF' : '#FF8EC8',
      fontFamily: '"Nunito", sans-serif',
      fontStyle: 'bold',
      shadow: { offsetX: 1, offsetY: 1, color: '#000', blur: 3, fill: true, stroke: true },
      backgroundColor: 'rgba(0,0,0,0.35)',
      padding: { x: 2, y: 1 },
    });
    this.nameLabel.setOrigin(0.5, 0);
    this.nameLabel.setDepth(11);

    // Order label background
    this.orderBg = scene.add.graphics();
    this.orderBg.setDepth(11);

    this.orderLabel = scene.add.text(px, py - 28, '', {
      fontSize: '11px',
      color: '#FFD93D',
      fontFamily: '"Nunito", sans-serif',
      fontStyle: 'bold',
      shadow: { offsetX: 1, offsetY: 1, color: '#000', blur: 2, fill: true, stroke: true },
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

  showBark(text: string) {
    // Remove previous bark
    if (this.barkBubble) {
      this.barkBubble.destroy();
      this.barkBubble = undefined;
    }
    if (this.barkTimer) {
      this.barkTimer.destroy();
      this.barkTimer = undefined;
    }

    const px = this.sprite.x;
    const py = this.sprite.y - 44;
    const container = this.scene.add.container(px, py).setDepth(30);

    // Background
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
    // Speech bubble tail
    bg.fillTriangle(0, h / 2, -4, h / 2 + 6, 4, h / 2);

    container.add(bg);
    container.add(textObj);

    // Scale + fade in
    container.setAlpha(0);
    container.setScale(0.8);
    this.scene.tweens.add({
      targets: container,
      alpha: 1,
      scaleX: 1,
      scaleY: 1,
      duration: 150,
      ease: 'Back.easeOut',
    });

    this.barkBubble = container;

    // Auto-destroy after 2.5s
    this.barkTimer = this.scene.time.delayedCall(2500, () => {
      if (this.barkBubble) {
        this.scene.tweens.add({
          targets: this.barkBubble,
          alpha: 0,
          y: this.barkBubble.y - 10,
          duration: 300,
          onComplete: () => {
            this.barkBubble?.destroy();
            this.barkBubble = undefined;
          },
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
    const x = this.orderLabel.x - w / 2;
    const y = this.orderLabel.y - h;
    this.orderBg.fillStyle(0x000000, 0.8);
    this.orderBg.fillRoundedRect(x, y, w, h, 3);
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
    if (this.flagIcon) this.flagIcon.setAlpha(alpha);
    if (this.micLabel) this.micLabel.setAlpha(alpha);
    if (this.selectionGlow) this.selectionGlow.setAlpha(visible ? 0.7 : 0);
    if (this.barkBubble) this.barkBubble.setAlpha(alpha);
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
        fontSize: '16px',
        color: '#FF6B6B',
        fontFamily: '"Fredoka", sans-serif',
        fontStyle: 'bold',
        shadow: { offsetX: 1, offsetY: 1, color: '#000', blur: 3, fill: true, stroke: true },
        backgroundColor: 'rgba(0,0,0,0.5)',
        padding: { x: 4, y: 2 },
      }).setOrigin(0.5).setDepth(15);
    }
    const secs = Math.ceil(secondsLeft);
    this.respawnOverlay.setText(`\u2620 ${secs}`);
    this.respawnOverlay.setPosition(this.sprite.x, this.sprite.y);
    this.sprite.setAlpha(0.15);
    this.emojiLabel.setAlpha(0.15);
    this.nameLabel.setAlpha(0.25);
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
    this.emojiLabel.setAlpha(1);
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
        duration: 820,
        ease: 'Sine.easeInOut',
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
    this.emojiLabel.setPosition(this.sprite.x, this.sprite.y - 1);
    this.nameLabel.setPosition(this.sprite.x, this.sprite.y + 18);
    this.orderLabel.setPosition(this.sprite.x, this.sprite.y - 28);
    this.drawOrderBg();
    if (this.selectionRing) this.selectionRing.setPosition(this.sprite.x, this.sprite.y);
    if (this.selectionGlow?.visible) this.drawSelectionGlow();
    if (this.micLabel?.visible) this.micLabel.setPosition(this.sprite.x + 16, this.sprite.y - 20);
    if (this.flagIcon) this.drawFlagIcon();
    if (this.respawnOverlay) this.respawnOverlay.setPosition(this.sprite.x, this.sprite.y);
    if (this.barkBubble) this.barkBubble.setPosition(this.sprite.x, this.sprite.y - 44);
  }

  updateFromState(charData: CharData) {
    this.data = charData;
    this.healthBar.update(this.sprite.x, this.sprite.y, charData.currentHp);
    this.showFlagCarrier(!!charData.hasFlag);
    const animalEmoji = ANIMAL_EMOJIS[charData.animalId] ?? CLASS_EMOJIS[charData.classId] ?? '';
    const lvl = charData.level > 1 ? ` Lv${charData.level}` : '';
    const moraleIcon = charData.morale === 'shaken' ? ' ◐' : '';
    this.nameLabel.setText(`${animalEmoji} ${charData.name}${lvl}${moraleIcon}`);
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

  showGoldEarned(amount: number) {
    const text = this.scene.add.text(this.sprite.x + 10, this.sprite.y - 20, `+${amount}g`, {
      fontSize: '12px',
      color: '#FFD93D',
      fontFamily: '"Fredoka", sans-serif',
      fontStyle: 'bold',
    }).setOrigin(0.5).setDepth(20);

    this.scene.tweens.add({
      targets: text,
      y: text.y - 20,
      alpha: 0,
      duration: 700,
      onComplete: () => text.destroy(),
    });
  }

  select() {
    if (!this.selectionRing) {
      this.selectionRing = this.scene.add.sprite(this.sprite.x, this.sprite.y, 'selection_ring');
      this.selectionRing.setDepth(9);
    }
    this.selectionRing.setVisible(true);

    if (!this.selectionGlow) {
      this.selectionGlow = this.scene.add.graphics().setDepth(8);
    }
    this.selectionGlow.setVisible(true);
    this.selectionGlow.setAlpha(0.7);
    this.drawSelectionGlow();
    if (this.glowTween) this.glowTween.destroy();
    this.glowTween = this.scene.tweens.add({
      targets: this.selectionGlow,
      alpha: { from: 0.7, to: 0.2 },
      duration: 900,
      yoyo: true,
      repeat: -1,
      ease: 'Sine.easeInOut',
    });

    if (!this.micLabel) {
      this.micLabel = this.scene.add.text(
        this.sprite.x + 16, this.sprite.y - 20, '\uD83C\uDF99\uFE0F', {
          fontSize: '12px',
        },
      ).setOrigin(0.5).setDepth(14);
    }
    this.micLabel.setVisible(true);
    this.micLabel.setPosition(this.sprite.x + 16, this.sprite.y - 20);
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
    // Big, bright glow so selected character is unmistakable
    this.selectionGlow.lineStyle(5, this.classColor, 1);
    this.selectionGlow.strokeCircle(this.sprite.x, this.sprite.y, 22);
    this.selectionGlow.lineStyle(2.5, 0xffffff, 0.5);
    this.selectionGlow.strokeCircle(this.sprite.x, this.sprite.y, 26);
  }

  updateEffectAuras(effects: ActiveEffect[] = []) {
    const EFFECT_COLORS: Record<string, number> = {
      stun: 0xFF6B6B,
      slow: 0x6CC4FF,
      speed_boost: 0xFFD93D,
      damage_boost: 0xFF9F43,
      defense_debuff: 0xC98FFF,
      shield: 0x4488FF,
      iron_skin: 0xFFAA33,
    };

    const activeTypes = new Set(effects.map(e => e.type));

    for (const [type, gfx] of this.effectAuras) {
      if (!activeTypes.has(type)) {
        gfx.destroy();
        this.effectAuras.delete(type);
      }
    }

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
    this.emojiLabel.destroy();
    if (this.selectionRing) this.selectionRing.destroy();
    if (this.selectionGlow) this.selectionGlow.destroy();
    if (this.glowTween) this.glowTween.destroy();
    if (this.micLabel) this.micLabel.destroy();
    if (this.flagIcon) this.flagIcon.destroy();
    if (this.respawnOverlay) this.respawnOverlay.destroy();
    if (this.barkBubble) this.barkBubble.destroy();
    if (this.barkTimer) this.barkTimer.destroy();
    for (const gfx of this.effectAuras.values()) gfx.destroy();
    this.effectAuras.clear();
  }
}
