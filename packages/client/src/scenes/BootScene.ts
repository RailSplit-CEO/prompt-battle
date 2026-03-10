import Phaser from 'phaser';
import { AnimalType, UNIT_DEFS } from '@prompt-battle/shared';
import { SPRITE_CONFIGS, HORDE_SPRITE_CONFIGS, ANIM_FRAME_RATES } from '../sprites/SpriteConfig';
import { SoundManager } from '../audio/SoundManager';

export class BootScene extends Phaser.Scene {
  constructor() {
    super({ key: 'BootScene' });
  }

  preload() {
    this.createTileTextures();
    this.createHeroTextures();
    this.createUnitTextures();
    this.createObjectiveTextures();
    this.createUITextures();

    // ─── Load enemy sprite sheets ──────────────────────────
    this.loadEnemySprites();

    // ─── Load sound effects ──────────────────────────────────
    SoundManager.preload(this);

    const { width, height } = this.cameras.main;
    this.cameras.main.setBackgroundColor('#1B1040');

    const titleText = this.add.text(width / 2, height / 2 - 80, 'ANIMAL ARMY', {
      fontSize: '52px',
      color: '#FF6B9D',
      fontFamily: '"Fredoka", sans-serif',
      fontStyle: 'bold',
    }).setOrigin(0.5).setAlpha(0);

    this.tweens.add({
      targets: titleText,
      alpha: 1,
      y: height / 2 - 90,
      scaleX: { from: 0.5, to: 1 },
      scaleY: { from: 0.5, to: 1 },
      duration: 800,
      ease: 'Back.easeOut',
    });

    const subtitle = this.add.text(width / 2, height / 2 - 40, 'LOADING...', {
      fontSize: '14px',
      color: '#8B6DB0',
      fontFamily: '"Nunito", sans-serif',
      fontStyle: 'bold',
      letterSpacing: 6,
    }).setOrigin(0.5).setAlpha(0);

    this.tweens.add({
      targets: subtitle,
      alpha: 0.8,
      duration: 600,
      delay: 400,
    });

    const barOutline = this.add.graphics();
    barOutline.fillStyle(0x000000, 0.5);
    barOutline.fillRoundedRect(width / 2 - 164, height / 2 + 4, 328, 16, 8);
    barOutline.fillStyle(0x2A1858, 1);
    barOutline.fillRoundedRect(width / 2 - 162, height / 2 + 6, 324, 12, 6);
    barOutline.setAlpha(0);
    this.tweens.add({ targets: barOutline, alpha: 1, duration: 400, delay: 600 });

    const fill = this.add.graphics();
    fill.setAlpha(0);
    this.tweens.add({ targets: fill, alpha: 1, duration: 400, delay: 600 });

    this.load.on('progress', (v: number) => {
      fill.clear();
      const fillW = 320 * v;
      if (fillW > 0) {
        fill.fillStyle(0xFF6B9D);
        fill.fillRoundedRect(width / 2 - 160, height / 2 + 7, fillW, 10, 5);
        fill.fillStyle(0xffffff, 0.3);
        fill.fillRoundedRect(width / 2 - 160, height / 2 + 7, fillW, 4, 3);
      }
    });

    this.add.text(width / 2, height - 30, 'v0.2.0 - Animal Army', {
      fontSize: '11px',
      color: '#4A2580',
      fontFamily: '"Nunito", sans-serif',
      fontStyle: 'bold',
    }).setOrigin(0.5);
  }

  create() {
    // ─── Create all enemy animations ─────────────────────
    this.createEnemyAnimations();

    this.cameras.main.fadeOut(400, 27, 16, 64);
    this.cameras.main.once('camerafadeoutcomplete', () => {
      this.scene.start('MenuScene');
    });
  }

  // ─── Load Enemy Sprite Sheets ─────────────────────────────
  private loadEnemySprites() {
    const loaded = new Set<string>();

    // Battle mode sprites
    const animalTypes: AnimalType[] = [
      'rabbit', 'parrot', 'wolf', 'falcon', 'goat',
      'bear', 'viper', 'deer', 'elephant', 'lion',
    ];
    for (const type of animalTypes) {
      const config = SPRITE_CONFIGS[type];
      for (const state of ['idle', 'walk', 'attack'] as const) {
        const sheet = config[state];
        if (!loaded.has(sheet.key)) {
          this.load.spritesheet(sheet.key, sheet.path, {
            frameWidth: sheet.frameWidth,
            frameHeight: sheet.frameHeight,
          });
          loaded.add(sheet.key);
        }
      }
    }

    // Horde mode sprites
    for (const type of Object.keys(HORDE_SPRITE_CONFIGS)) {
      const config = HORDE_SPRITE_CONFIGS[type];
      for (const state of ['idle', 'walk', 'attack'] as const) {
        const sheet = config[state];
        if (!loaded.has(sheet.key)) {
          this.load.spritesheet(sheet.key, sheet.path, {
            frameWidth: sheet.frameWidth,
            frameHeight: sheet.frameHeight,
          });
          loaded.add(sheet.key);
        }
      }
    }
  }

  // ─── Create Enemy Animations ──────────────────────────────
  private createEnemyAnimations() {
    const created = new Set<string>();

    const createAnimsForConfig = (prefix: string, config: typeof SPRITE_CONFIGS[AnimalType]) => {
      if (created.has(prefix)) return;
      created.add(prefix);

      this.anims.create({
        key: `${prefix}_idle`,
        frames: this.anims.generateFrameNumbers(config.idle.key, {
          start: 0, end: config.idle.frameCount - 1,
        }),
        frameRate: ANIM_FRAME_RATES.idle,
        repeat: -1,
      });

      this.anims.create({
        key: `${prefix}_walk`,
        frames: this.anims.generateFrameNumbers(config.walk.key, {
          start: 0, end: config.walk.frameCount - 1,
        }),
        frameRate: ANIM_FRAME_RATES.walk,
        repeat: -1,
      });

      this.anims.create({
        key: `${prefix}_attack`,
        frames: this.anims.generateFrameNumbers(config.attack.key, {
          start: 0, end: config.attack.frameCount - 1,
        }),
        frameRate: ANIM_FRAME_RATES.attack,
        repeat: 0,
      });
    };

    // Battle mode animations
    const animalTypes: AnimalType[] = [
      'rabbit', 'parrot', 'wolf', 'falcon', 'goat',
      'bear', 'viper', 'deer', 'elephant', 'lion',
    ];
    for (const type of animalTypes) {
      createAnimsForConfig(type, SPRITE_CONFIGS[type]);
    }

    // Horde mode animations (prefixed with h_)
    for (const [type, config] of Object.entries(HORDE_SPRITE_CONFIGS)) {
      createAnimsForConfig(`h_${type}`, config);
    }
  }

  // ─── Hero Textures ──────────────────────────────────────
  private createHeroTextures() {
    for (const team of ['p1', 'p2'] as const) {
      const outline = team === 'p1' ? 0x4499FF : 0xFF5555;
      const body = team === 'p1' ? 0x2266CC : 0xCC2222;

      const gfx = this.add.graphics();
      gfx.fillStyle(outline, 0.6);
      gfx.fillCircle(16, 16, 14);
      gfx.fillStyle(body, 0.4);
      gfx.fillCircle(16, 16, 12);
      gfx.fillStyle(0xffffff, 0.15);
      gfx.fillCircle(12, 12, 5);
      gfx.generateTexture(`hero_${team}`, 32, 32);
      gfx.destroy();
    }
  }

  // ─── Animal Unit Textures (fallback circles) ──────────────
  private createUnitTextures() {
    const unitColors: Record<string, number> = {
      rabbit: 0xCCBB99,
      parrot: 0x44CC44,
      wolf: 0x888888,
      falcon: 0x8B6B3A,
      goat: 0xDDDDCC,
      bear: 0x8B4513,
      viper: 0x55AA55,
      deer: 0xCC8844,
      elephant: 0x999999,
      lion: 0xDDAA44,
    };

    for (const [type, color] of Object.entries(unitColors)) {
      for (const team of ['p1', 'p2'] as const) {
        const outline = team === 'p1' ? 0x4499FF : 0xFF5555;

        const gfx = this.add.graphics();
        gfx.fillStyle(outline, 0.5);
        gfx.fillCircle(8, 8, 7);
        gfx.fillStyle(color, 0.8);
        gfx.fillCircle(8, 8, 5);
        gfx.fillStyle(0xffffff, 0.2);
        gfx.fillCircle(6, 6, 2);
        gfx.generateTexture(`unit_${type}_${team}`, 16, 16);
        gfx.destroy();
      }
    }
  }

  // ─── Camp & Structure Textures ──────────────────────────
  private createObjectiveTextures() {
    const campNeutral = this.add.graphics();
    campNeutral.fillStyle(0x000000, 0.4);
    campNeutral.fillCircle(16, 16, 14);
    campNeutral.fillStyle(0x888888, 0.7);
    campNeutral.fillCircle(16, 16, 12);
    campNeutral.lineStyle(2, 0xAAAAAA, 0.6);
    campNeutral.strokeCircle(16, 16, 12);
    campNeutral.generateTexture('camp_neutral', 32, 32);
    campNeutral.destroy();

    for (const [team, color] of [['p1', 0x4499FF], ['p2', 0xFF5555]] as const) {
      const gfx = this.add.graphics();
      gfx.fillStyle(0x000000, 0.4);
      gfx.fillCircle(16, 16, 14);
      gfx.fillStyle(color, 0.5);
      gfx.fillCircle(16, 16, 12);
      gfx.lineStyle(2, color, 0.8);
      gfx.strokeCircle(16, 16, 12);
      gfx.fillStyle(0xffffff, 0.2);
      gfx.fillCircle(12, 12, 4);
      gfx.generateTexture(`camp_${team}`, 32, 32);
      gfx.destroy();
    }

    const strGfx = this.add.graphics();
    strGfx.fillStyle(0x000000, 0.4);
    strGfx.fillRoundedRect(6, 2, 20, 28, 4);
    strGfx.fillStyle(0x886644, 0.9);
    strGfx.fillRoundedRect(8, 4, 16, 24, 3);
    strGfx.fillStyle(0xAA8855);
    strGfx.fillRect(10, 6, 12, 4);
    strGfx.fillStyle(0xCC9966);
    strGfx.fillRect(12, 2, 8, 6);
    strGfx.fillStyle(0xffffff, 0.2);
    strGfx.fillRect(10, 6, 6, 2);
    strGfx.lineStyle(2, 0x664422, 0.6);
    strGfx.strokeRoundedRect(8, 4, 16, 24, 3);
    strGfx.generateTexture('structure', 32, 32);
    strGfx.destroy();

    const strDestrGfx = this.add.graphics();
    strDestrGfx.fillStyle(0x555555, 0.5);
    strDestrGfx.fillRoundedRect(8, 12, 16, 16, 3);
    strDestrGfx.fillStyle(0x666666, 0.4);
    strDestrGfx.fillRect(10, 14, 12, 4);
    strDestrGfx.generateTexture('structure_destroyed', 32, 32);
    strDestrGfx.destroy();

    for (const [team, color] of [['p1', 0x2266CC], ['p2', 0xCC2222]] as const) {
      const gfx = this.add.graphics();
      gfx.fillStyle(color, 0.6);
      gfx.fillCircle(16, 16, 15);
      gfx.fillStyle(color, 0.3);
      gfx.fillCircle(16, 16, 12);
      gfx.lineStyle(3, color, 0.8);
      gfx.strokeCircle(16, 16, 14);
      gfx.fillStyle(0xffffff, 0.3);
      gfx.fillCircle(12, 12, 5);
      gfx.generateTexture(`base_${team}`, 32, 32);
      gfx.destroy();
    }
  }

  // ─── UI Textures ────────────────────────────────────────
  private createUITextures() {
    const selGfx = this.add.graphics();
    selGfx.lineStyle(4, 0xFFD93D, 1);
    selGfx.strokeCircle(20, 20, 18);
    selGfx.lineStyle(2, 0xffffff, 0.6);
    selGfx.strokeCircle(20, 20, 15);
    selGfx.generateTexture('selection_ring', 40, 40);
    selGfx.destroy();

    const particleGfx = this.add.graphics();
    particleGfx.fillStyle(0xffffff);
    particleGfx.fillCircle(4, 4, 4);
    particleGfx.generateTexture('particle', 8, 8);
    particleGfx.destroy();

    const glowGfx = this.add.graphics();
    glowGfx.fillStyle(0xffffff, 0.6);
    glowGfx.fillCircle(16, 16, 16);
    glowGfx.fillStyle(0xffffff, 0.3);
    glowGfx.fillCircle(16, 16, 12);
    glowGfx.fillStyle(0xffffff, 0.1);
    glowGfx.fillCircle(16, 16, 8);
    glowGfx.generateTexture('glow', 32, 32);
    glowGfx.destroy();
  }

  // ─── Tile Textures ──────────────────────────────────────
  private createTileTextures() {
    const S = 32;
    const g = (fn: (gfx: Phaser.GameObjects.Graphics) => void, name: string) => {
      const gfx = this.add.graphics();
      fn(gfx);
      gfx.generateTexture(`tile_${name}`, S, S);
      gfx.destroy();
    };

    g((gfx) => {
      gfx.fillStyle(0x5CC96B); gfx.fillRect(0, 0, S, S);
      gfx.fillStyle(0x6AD97A, 0.4); gfx.fillCircle(8, 8, 6);
      gfx.fillStyle(0x4FB85A, 0.3); gfx.fillCircle(24, 22, 7);
      gfx.lineStyle(1.5, 0x3EA050, 0.5);
      gfx.lineBetween(7, 26, 9, 20); gfx.lineBetween(23, 10, 25, 4);
      gfx.lineStyle(1, 0x3A9B48, 0.25); gfx.strokeRect(0, 0, S, S);
    }, 'grass');

    g((gfx) => {
      gfx.fillStyle(0x2E8B4E); gfx.fillRect(0, 0, S, S);
      gfx.fillStyle(0x6B4226); gfx.fillRect(14, 18, 5, 14);
      gfx.fillStyle(0x1B6B32); gfx.fillCircle(16, 8, 12);
      gfx.fillStyle(0x27893F); gfx.fillCircle(10, 11, 8);
      gfx.fillStyle(0x33A84E); gfx.fillCircle(20, 10, 7);
      gfx.fillStyle(0x3DBF58); gfx.fillCircle(16, 6, 6);
      gfx.fillStyle(0xffffff, 0.15); gfx.fillCircle(11, 5, 4);
      gfx.lineStyle(1, 0x155528, 0.3); gfx.strokeRect(0, 0, S, S);
    }, 'forest');

    g((gfx) => {
      gfx.fillStyle(0x3399EE); gfx.fillRect(0, 0, S, S);
      gfx.fillStyle(0x55BBFF, 0.4); gfx.fillCircle(10, 10, 8);
      gfx.fillStyle(0x2277CC, 0.3); gfx.fillCircle(22, 22, 9);
      gfx.lineStyle(2, 0x88DDFF, 0.5);
      gfx.beginPath(); gfx.arc(8, 13, 6, 3.14, 0, true); gfx.strokePath();
      gfx.beginPath(); gfx.arc(22, 13, 6, 3.14, 0, true); gfx.strokePath();
      gfx.fillStyle(0xffffff, 0.3); gfx.fillCircle(8, 8, 2);
      gfx.lineStyle(1, 0x2266AA, 0.3); gfx.strokeRect(0, 0, S, S);
    }, 'water');

    g((gfx) => {
      gfx.fillStyle(0xD4A940); gfx.fillRect(0, 0, S, S);
      gfx.fillStyle(0xC89B30); gfx.fillTriangle(16, 2, -2, 30, 34, 30);
      gfx.fillStyle(0xDEB245, 0.6); gfx.fillTriangle(16, 6, 4, 28, 24, 28);
      gfx.fillStyle(0xffffff, 0.15); gfx.fillTriangle(12, 6, 4, 24, 16, 24);
      gfx.lineStyle(1, 0x9A7A20, 0.3); gfx.strokeRect(0, 0, S, S);
    }, 'hill');

    g((gfx) => {
      gfx.fillStyle(0xEDD9A7); gfx.fillRect(0, 0, S, S);
      gfx.fillStyle(0xD4C090, 0.5); gfx.fillCircle(8, 8, 4); gfx.fillCircle(22, 24, 5);
      gfx.fillStyle(0xBBAA88, 0.6);
      gfx.fillCircle(6, 16, 2); gfx.fillCircle(26, 8, 1.5);
      gfx.lineStyle(1, 0xBFA070, 0.2); gfx.strokeRect(0, 0, S, S);
    }, 'path');

    g((gfx) => {
      gfx.fillStyle(0x3399EE); gfx.fillRect(0, 0, S, S);
      gfx.fillStyle(0x8B6B3A);
      gfx.fillRect(2, 4, 28, 5); gfx.fillRect(2, 12, 28, 5);
      gfx.fillRect(2, 20, 28, 5); gfx.fillRect(2, 28, 28, 4);
      gfx.fillStyle(0xA58050, 0.5);
      gfx.fillRect(4, 5, 24, 2); gfx.fillRect(4, 13, 24, 2);
      gfx.fillStyle(0x6B4226); gfx.fillRect(0, 0, 3, 32); gfx.fillRect(29, 0, 3, 32);
      gfx.lineStyle(1, 0x4A2E14, 0.4); gfx.strokeRect(0, 0, S, S);
    }, 'bridge');

    g((gfx) => {
      gfx.fillStyle(0xF0D890); gfx.fillRect(0, 0, S, S);
      gfx.fillStyle(0xE0C880, 0.4); gfx.fillCircle(12, 10, 7); gfx.fillCircle(24, 24, 8);
      gfx.fillStyle(0xC8B068, 0.5);
      gfx.fillCircle(6, 6, 1.5); gfx.fillCircle(20, 14, 1);
      gfx.lineStyle(1, 0xD0B060, 0.25); gfx.strokeRect(0, 0, S, S);
    }, 'sand');

    g((gfx) => {
      gfx.fillStyle(0x2288CC); gfx.fillRect(0, 0, S, S);
      gfx.fillStyle(0x44AAEE, 0.4); gfx.fillCircle(10, 10, 8);
      gfx.lineStyle(2, 0x77CCFF, 0.5);
      gfx.beginPath(); gfx.arc(16, 16, 8, 3.14, 0, true); gfx.strokePath();
      gfx.fillStyle(0xffffff, 0.2); gfx.fillCircle(8, 8, 2);
      gfx.lineStyle(1, 0x1166AA, 0.3); gfx.strokeRect(0, 0, S, S);
    }, 'river');

    g((gfx) => {
      gfx.fillStyle(0xD4C090); gfx.fillRect(0, 0, S, S);
      gfx.fillStyle(0xC8B080, 0.5); gfx.fillCircle(16, 16, 10);
      gfx.lineStyle(1, 0xBFA070, 0.3); gfx.strokeRect(0, 0, S, S);
    }, 'shore');

    g((gfx) => {
      gfx.fillStyle(0x2266CC); gfx.fillRect(0, 0, S, S);
      gfx.fillStyle(0x3388EE, 0.4); gfx.fillCircle(16, 16, 10);
      gfx.fillStyle(0x4499FF, 0.3); gfx.fillCircle(16, 16, 6);
      gfx.lineStyle(1, 0x1155AA, 0.4); gfx.strokeRect(0, 0, S, S);
    }, 'blue_base');

    g((gfx) => {
      gfx.fillStyle(0xCC2222); gfx.fillRect(0, 0, S, S);
      gfx.fillStyle(0xEE3838, 0.4); gfx.fillCircle(16, 16, 10);
      gfx.fillStyle(0xFF5555, 0.3); gfx.fillCircle(16, 16, 6);
      gfx.lineStyle(1, 0xAA1515, 0.4); gfx.strokeRect(0, 0, S, S);
    }, 'red_base');
  }
}
