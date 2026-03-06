import Phaser from 'phaser';

interface ResultData {
  winner: string;
  playerId: string;
  isLocal: boolean;
}

export class ResultScene extends Phaser.Scene {
  private floatingOrbs: { sprite: Phaser.GameObjects.Arc; vx: number; vy: number }[] = [];

  constructor() {
    super({ key: 'ResultScene' });
  }

  create(data: ResultData) {
    const { width, height } = this.cameras.main;
    const won = data.winner === data.playerId;

    // Background
    this.cameras.main.setBackgroundColor(won ? '#050f08' : '#0f0508');
    this.cameras.main.fadeIn(300, 0, 0, 0);

    // Screen shake on entry
    this.cameras.main.shake(500, won ? 0.01 : 0.02);

    // ─── BACKGROUND EFFECTS ─────────────────────────────────────
    const accentColor = won ? 0x44ff88 : 0xff4444;

    // Grid
    const gridGfx = this.add.graphics();
    gridGfx.lineStyle(1, accentColor, 0.02);
    for (let x = 0; x < width; x += 60) gridGfx.lineBetween(x, 0, x, height);
    for (let y = 0; y < height; y += 60) gridGfx.lineBetween(0, y, width, y);

    // Floating particles
    for (let i = 0; i < 10; i++) {
      const x = Math.random() * width;
      const y = Math.random() * height;
      const r = 3 + Math.random() * 5;
      const orb = this.add.circle(x, y, r, accentColor, 0.03 + Math.random() * 0.05);

      this.tweens.add({
        targets: orb,
        alpha: { from: orb.alpha, to: orb.alpha * 0.2 },
        duration: 2000 + Math.random() * 3000,
        yoyo: true,
        repeat: -1,
        delay: Math.random() * 2000,
      });

      this.floatingOrbs.push({
        sprite: orb,
        vx: (Math.random() - 0.5) * 0.4,
        vy: won ? -(Math.random() * 0.5 + 0.2) : (Math.random() * 0.3 + 0.1),
      });
    }

    // ─── RESULT GLOW ─────────────────────────────────────────────
    // Soft glow behind result text
    const glowRect = this.add.rectangle(width / 2, height / 2 - 70, 500, 80,
      won ? 0x44ff88 : 0xff4444, 0.04);

    this.tweens.add({
      targets: glowRect,
      alpha: { from: 0.03, to: 0.08 },
      scaleX: { from: 1, to: 1.15 },
      scaleY: { from: 1, to: 1.4 },
      duration: 2000,
      yoyo: true,
      repeat: -1,
      ease: 'Sine.easeInOut',
    });

    // ─── MAIN TITLE ──────────────────────────────────────────────
    const mainTitle = this.add.text(width / 2, height / 2 - 70, won ? 'VICTORY' : 'DEFEAT', {
      fontSize: '72px',
      color: won ? '#44ff88' : '#ff4444',
      fontFamily: '"Orbitron", "Rajdhani", monospace',
      fontStyle: 'bold',
    }).setOrigin(0.5).setAlpha(0).setScale(0.5);

    this.tweens.add({
      targets: mainTitle,
      alpha: 1,
      scaleX: 1,
      scaleY: 1,
      duration: 800,
      ease: 'Back.easeOut',
      delay: 200,
    });

    // ─── SUBTITLE ────────────────────────────────────────────────
    const subtitle = this.add.text(width / 2, height / 2 + 10,
      won ? 'Your commands led to triumph!' : 'Your forces have been defeated.', {
      fontSize: '16px',
      color: '#888',
      fontFamily: 'monospace',
    }).setOrigin(0.5).setAlpha(0);

    this.tweens.add({
      targets: subtitle,
      alpha: 1,
      y: height / 2 + 5,
      duration: 600,
      delay: 700,
    });

    // ─── DECORATIVE LINES ────────────────────────────────────────
    const lineGfx = this.add.graphics();
    lineGfx.lineStyle(1, accentColor, 0.3);
    lineGfx.lineBetween(width / 2 - 100, height / 2 - 15, width / 2 + 100, height / 2 - 15);
    lineGfx.setAlpha(0);
    this.tweens.add({ targets: lineGfx, alpha: 1, duration: 600, delay: 500 });

    // ─── PLAY AGAIN BUTTON ───────────────────────────────────────
    const btnContainer = this.add.container(width / 2, height / 2 + 80);
    const btnW = 240, btnH = 50;

    // Button glow
    const btnGlow = this.add.rectangle(0, 0, btnW + 20, btnH + 20, 0x6c63ff, 0.06);
    btnContainer.add(btnGlow);
    this.tweens.add({
      targets: btnGlow,
      alpha: { from: 0.05, to: 0.15 },
      scaleX: { from: 1, to: 1.05 },
      scaleY: { from: 1, to: 1.1 },
      duration: 1500,
      yoyo: true,
      repeat: -1,
    });

    // Button bg
    const btnBg = this.add.graphics();
    btnBg.fillStyle(0x6c63ff, 0.25);
    btnBg.fillRoundedRect(-btnW / 2, -btnH / 2, btnW, btnH, 8);
    btnBg.lineStyle(1, 0x6c63ff, 0.6);
    btnBg.strokeRoundedRect(-btnW / 2, -btnH / 2, btnW, btnH, 8);
    btnContainer.add(btnBg);

    const btnText = this.add.text(0, 0, 'PLAY AGAIN', {
      fontSize: '18px',
      color: '#fff',
      fontFamily: '"Rajdhani", monospace',
      fontStyle: 'bold',
      letterSpacing: 2,
    }).setOrigin(0.5);
    btnContainer.add(btnText);

    btnContainer.setAlpha(0).setScale(0.9);
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
      this.tweens.add({ targets: btnContainer, scaleX: 1.05, scaleY: 1.05, duration: 200 });
      btnBg.clear();
      btnBg.fillStyle(0x6c63ff, 0.4);
      btnBg.fillRoundedRect(-btnW / 2, -btnH / 2, btnW, btnH, 8);
      btnBg.lineStyle(2, 0x6c63ff, 0.9);
      btnBg.strokeRoundedRect(-btnW / 2, -btnH / 2, btnW, btnH, 8);
    });

    zone.on('pointerout', () => {
      this.tweens.add({ targets: btnContainer, scaleX: 1, scaleY: 1, duration: 200 });
      btnBg.clear();
      btnBg.fillStyle(0x6c63ff, 0.25);
      btnBg.fillRoundedRect(-btnW / 2, -btnH / 2, btnW, btnH, 8);
      btnBg.lineStyle(1, 0x6c63ff, 0.6);
      btnBg.strokeRoundedRect(-btnW / 2, -btnH / 2, btnW, btnH, 8);
    });

    zone.on('pointerdown', () => {
      this.tweens.add({
        targets: btnContainer,
        scaleX: 0.95, scaleY: 0.95,
        duration: 60,
        yoyo: true,
      });
      this.cameras.main.fadeOut(400, 5, 5, 16);
      this.cameras.main.once('camerafadeoutcomplete', () => {
        this.scene.start('MenuScene');
      });
    });

    // ─── BACK TO MENU LINK ───────────────────────────────────────
    const backText = this.add.text(width / 2, height / 2 + 140, 'or press ESC to return to menu', {
      fontSize: '11px',
      color: '#444',
      fontFamily: 'monospace',
    }).setOrigin(0.5).setAlpha(0);

    this.tweens.add({ targets: backText, alpha: 0.6, duration: 600, delay: 1200 });

    this.input.keyboard!.on('keydown-ESC', () => {
      this.cameras.main.fadeOut(400, 5, 5, 16);
      this.cameras.main.once('camerafadeoutcomplete', () => {
        this.scene.start('MenuScene');
      });
    });

    // ─── FLASH EFFECT ON VICTORY ─────────────────────────────────
    if (won) {
      this.cameras.main.flash(600, 68, 255, 136, false);
    }
  }

  update() {
    const { width, height } = this.cameras.main;
    for (const orb of this.floatingOrbs) {
      orb.sprite.x += orb.vx;
      orb.sprite.y += orb.vy;
      if (orb.sprite.x < -20) orb.sprite.x = width + 20;
      if (orb.sprite.x > width + 20) orb.sprite.x = -20;
      if (orb.sprite.y < -20) orb.sprite.y = height + 20;
      if (orb.sprite.y > height + 20) orb.sprite.y = -20;
    }
  }
}
