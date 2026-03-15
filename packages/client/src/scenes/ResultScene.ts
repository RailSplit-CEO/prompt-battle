import Phaser from 'phaser';
import { GameSettings } from '../systems/GameSettings';

interface ResultData {
  winner: string;
  playerId: string;
  isLocal: boolean;
  score?: string;
}

export class ResultScene extends Phaser.Scene {
  private floatingShapes: { sprite: Phaser.GameObjects.Arc | Phaser.GameObjects.Star; vx: number; vy: number; rotSpeed: number }[] = [];
  private muted: boolean = GameSettings.getInstance().get('muteAll');

  constructor() {
    super({ key: 'ResultScene' });
  }

  create(data: ResultData) {
    const { width, height } = this.cameras.main;
    const won = data.winner === data.playerId;

    this.cameras.main.setBackgroundColor(won ? '#0D2818' : '#2A0D18');
    this.cameras.main.fadeIn(300, 0, 0, 0);
    const gs = GameSettings.getInstance();
    const shakeIntensity = gs.get('cameraShakeIntensity');
    if (shakeIntensity > 0 && !gs.get('reducedMotion')) {
      this.cameras.main.shake(500, (won ? 0.015 : 0.025) * shakeIntensity);
    }

    // Victory/defeat fanfare
    if (!this.muted) {
      const sfxKey = won ? 'victory' : 'defeat';
      if (this.cache.audio.exists(sfxKey)) this.sound.play(sfxKey, { volume: 0.6 });
    }

    const accentColor = won ? 0x45E6B0 : 0xFF6B6B;
    const accentHex = won ? '#45E6B0' : '#FF6B6B';

    // Floating celebration shapes
    const colors = won
      ? [0x45E6B0, 0xFFD93D, 0x6CC4FF, 0xFF6B9D, 0xC98FFF]
      : [0xFF6B6B, 0xFF9F43, 0xC98FFF];

    for (let i = 0; i < (won ? 16 : 8); i++) {
      const x = Math.random() * width;
      const y = Math.random() * height;
      const color = colors[i % colors.length];
      const alpha = 0.05 + Math.random() * 0.08;

      let sprite: Phaser.GameObjects.Arc | Phaser.GameObjects.Star;
      if (i % 3 === 0) {
        sprite = this.add.star(x, y, 5, 3 + Math.random() * 4, 6 + Math.random() * 8, color, alpha);
      } else if (i % 3 === 1) {
        sprite = this.add.star(x, y, 4, 2 + Math.random() * 3, 5 + Math.random() * 5, color, alpha);
      } else {
        const r = 3 + Math.random() * 6;
        sprite = this.add.circle(x, y, r, color, alpha);
      }

      this.tweens.add({
        targets: sprite,
        alpha: { from: alpha, to: alpha * 0.2 },
        duration: 2000 + Math.random() * 3000,
        yoyo: true,
        repeat: -1,
        delay: Math.random() * 2000,
      });

      this.floatingShapes.push({
        sprite,
        vx: (Math.random() - 0.5) * 0.5,
        vy: won ? -(Math.random() * 0.6 + 0.2) : (Math.random() * 0.3 + 0.1),
        rotSpeed: (Math.random() - 0.5) * 0.5,
      });
    }

    // Result glow
    const glowRect = this.add.rectangle(width / 2, height / 2 - 70, 500, 80,
      accentColor, 0.05);

    this.tweens.add({
      targets: glowRect,
      alpha: { from: 0.04, to: 0.1 },
      scaleX: { from: 1, to: 1.2 },
      scaleY: { from: 1, to: 1.5 },
      duration: 2000,
      yoyo: true,
      repeat: -1,
      ease: 'Sine.easeInOut',
    });

    // Title shadow
    this.add.text(width / 2 + 5, height / 2 - 65, won ? 'VICTORY!' : 'DEFEAT', {
      fontSize: '80px',
      color: '#000000',
      fontFamily: '"Fredoka", sans-serif',
      fontStyle: 'bold',
    }).setOrigin(0.5).setAlpha(0.4);

    // Main title
    const mainTitle = this.add.text(width / 2, height / 2 - 70, won ? 'VICTORY!' : 'DEFEAT', {
      fontSize: '80px',
      color: accentHex,
      fontFamily: '"Fredoka", sans-serif',
      fontStyle: 'bold',
    }).setOrigin(0.5).setAlpha(0).setScale(0.3);

    this.tweens.add({
      targets: mainTitle,
      alpha: 1,
      scaleX: 1,
      scaleY: 1,
      duration: 800,
      ease: 'Back.easeOut',
      delay: 200,
    });

    // Victory bounce
    if (won) {
      this.tweens.add({
        targets: mainTitle,
        y: { from: height / 2 - 70, to: height / 2 - 76 },
        duration: 1500,
        yoyo: true,
        repeat: -1,
        ease: 'Sine.easeInOut',
        delay: 1000,
      });
    }

    // Subtitle
    const subtitle = this.add.text(width / 2, height / 2 + 10,
      won ? 'Your commands led to triumph!' : 'Your forces have been defeated.', {
      fontSize: '18px',
      color: '#cbb8ee',
      fontFamily: '"Nunito", sans-serif',
      fontStyle: '600',
    }).setOrigin(0.5).setAlpha(0);

    this.tweens.add({
      targets: subtitle,
      alpha: 1,
      y: height / 2 + 5,
      duration: 600,
      delay: 700,
    });

    // Score display (if provided)
    if (data.score) {
      const scoreText = this.add.text(width / 2, height / 2 + 30, data.score, {
        fontSize: '16px',
        color: '#FFD93D',
        fontFamily: '"Nunito", sans-serif',
        fontStyle: 'bold',
      }).setOrigin(0.5).setAlpha(0);

      this.tweens.add({
        targets: scoreText,
        alpha: 1,
        duration: 600,
        delay: 900,
      });
    }

    // Decorative line
    const lineGfx = this.add.graphics();
    lineGfx.lineStyle(3, accentColor, 0.4);
    lineGfx.lineBetween(width / 2 - 100, height / 2 - 15, width / 2 + 100, height / 2 - 15);
    lineGfx.fillStyle(accentColor, 0.6);
    lineGfx.fillCircle(width / 2 - 104, height / 2 - 15, 4);
    lineGfx.fillCircle(width / 2 + 104, height / 2 - 15, 4);
    lineGfx.setAlpha(0);
    this.tweens.add({ targets: lineGfx, alpha: 1, duration: 600, delay: 500 });

    // PLAY AGAIN button
    const btnContainer = this.add.container(width / 2, height / 2 + 80);
    const btnW = 260, btnH = 56;

    // Button shadow
    const btnShadow = this.add.graphics();
    btnShadow.fillStyle(0x000000, 0.3);
    btnShadow.fillRoundedRect(-btnW / 2 + 4, -btnH / 2 + 4, btnW, btnH, 16);
    btnContainer.add(btnShadow);

    const btnBg = this.add.graphics();
    btnBg.fillStyle(0xFF6B9D, 0.35);
    btnBg.fillRoundedRect(-btnW / 2, -btnH / 2, btnW, btnH, 16);
    btnBg.lineStyle(3, 0xFF6B9D, 0.8);
    btnBg.strokeRoundedRect(-btnW / 2, -btnH / 2, btnW, btnH, 16);
    btnContainer.add(btnBg);

    const btnText = this.add.text(0, 0, 'PLAY AGAIN', {
      fontSize: '20px',
      color: '#fff',
      fontFamily: '"Fredoka", sans-serif',
      fontStyle: 'bold',
      letterSpacing: 2,
    }).setOrigin(0.5);
    btnContainer.add(btnText);

    btnContainer.setAlpha(0).setScale(0.5);
    this.tweens.add({
      targets: btnContainer,
      alpha: 1, scaleX: 1, scaleY: 1,
      duration: 500, delay: 1000,
      ease: 'Back.easeOut',
    });

    // Button interaction
    const zone = this.add.zone(width / 2, height / 2 + 80, btnW, btnH)
      .setInteractive({ useHandCursor: true });

    zone.on('pointerover', () => {
      if (!this.muted && this.cache.audio.exists('button_click')) this.sound.play('button_click', { volume: 0.15 });
      this.tweens.add({ targets: btnContainer, scaleX: 1.08, scaleY: 1.08, duration: 200, ease: 'Back.easeOut' });
      btnBg.clear();
      btnBg.fillStyle(0xFF6B9D, 0.5);
      btnBg.fillRoundedRect(-btnW / 2, -btnH / 2, btnW, btnH, 16);
      btnBg.lineStyle(4, 0xFF6B9D, 1);
      btnBg.strokeRoundedRect(-btnW / 2, -btnH / 2, btnW, btnH, 16);
    });

    zone.on('pointerout', () => {
      this.tweens.add({ targets: btnContainer, scaleX: 1, scaleY: 1, duration: 200 });
      btnBg.clear();
      btnBg.fillStyle(0xFF6B9D, 0.35);
      btnBg.fillRoundedRect(-btnW / 2, -btnH / 2, btnW, btnH, 16);
      btnBg.lineStyle(3, 0xFF6B9D, 0.8);
      btnBg.strokeRoundedRect(-btnW / 2, -btnH / 2, btnW, btnH, 16);
    });

    zone.on('pointerdown', () => {
      if (!this.muted && this.cache.audio.exists('button_click')) this.sound.play('button_click', { volume: 0.4 });
      this.tweens.add({
        targets: btnContainer,
        scaleX: 0.92, scaleY: 0.92,
        duration: 80,
        yoyo: true,
      });
      this.cameras.main.fadeOut(400, 27, 16, 64);
      this.cameras.main.once('camerafadeoutcomplete', () => {
        this.scene.start('MenuScene');
      });
    });

    // Back to menu hint
    const backText = this.add.text(width / 2, height / 2 + 140, 'Press SPACE or ESC to return to menu', {
      fontSize: '12px',
      color: '#8B6DB0',
      fontFamily: '"Nunito", sans-serif',
      fontStyle: '600',
    }).setOrigin(0.5).setAlpha(0);

    this.tweens.add({ targets: backText, alpha: 0.7, duration: 600, delay: 1200 });

    const returnToMenu = () => {
      if (!this.muted && this.cache.audio.exists('button_click')) this.sound.play('button_click', { volume: 0.4 });
      this.cameras.main.fadeOut(400, 27, 16, 64);
      this.cameras.main.once('camerafadeoutcomplete', () => {
        this.scene.start('MenuScene');
      });
    };

    this.input.keyboard!.on('keydown-ESC', returnToMenu);
    this.input.keyboard!.on('keydown-SPACE', returnToMenu);

    // Flash effect on victory
    if (won) {
      this.cameras.main.flash(600, 69, 230, 176, false);

      // Sparkle burst on victory (after title appears)
      this.time.delayedCall(1200, () => {
        const sparkleColors = [0xFFD93D, 0xFFE066, 0xFFC107, 0xFFAB00, 0xFFD93D, 0xFFE066, 0xFFC107, 0xFFAB00];
        for (let i = 0; i < 8; i++) {
          const angle = (i / 8) * Math.PI * 2;
          const star = this.add.star(
            width / 2, height / 2 - 70,
            5, 2, 5,
            sparkleColors[i], 1
          );
          this.tweens.add({
            targets: star,
            x: width / 2 + Math.cos(angle) * 120,
            y: height / 2 - 70 + Math.sin(angle) * 80,
            alpha: 0,
            scaleX: 0.3,
            scaleY: 0.3,
            duration: 800,
            ease: 'Power2',
            onComplete: () => star.destroy(),
          });
        }
      });
    }
  }

  update() {
    const { width, height } = this.cameras.main;
    for (const shape of this.floatingShapes) {
      shape.sprite.x += shape.vx;
      shape.sprite.y += shape.vy;
      if ('angle' in shape.sprite) {
        shape.sprite.angle += shape.rotSpeed;
      }
      if (shape.sprite.x < -30) shape.sprite.x = width + 30;
      if (shape.sprite.x > width + 30) shape.sprite.x = -30;
      if (shape.sprite.y < -30) shape.sprite.y = height + 30;
      if (shape.sprite.y > height + 30) shape.sprite.y = -30;
    }
  }
}
