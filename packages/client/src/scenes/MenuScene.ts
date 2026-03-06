import Phaser from 'phaser';
import { FirebaseSync } from '../network/FirebaseSync';
import { Matchmaking } from '../network/Matchmaking';

export class MenuScene extends Phaser.Scene {
  private matchmaking!: Matchmaking;
  private statusText!: Phaser.GameObjects.Text;
  private bgParticles: Phaser.GameObjects.Arc[] = [];
  private gridLines: Phaser.GameObjects.Graphics[] = [];
  private floatingOrbs: { sprite: Phaser.GameObjects.Arc; vx: number; vy: number }[] = [];

  constructor() {
    super({ key: 'MenuScene' });
  }

  create() {
    const { width, height } = this.cameras.main;
    this.cameras.main.setBackgroundColor('#050510');
    this.cameras.main.fadeIn(600, 5, 5, 16);

    // ─── ANIMATED GRID BACKGROUND ────────────────────────────────
    this.createAnimatedGrid(width, height);

    // ─── FLOATING ORBS ───────────────────────────────────────────
    this.createFloatingOrbs(width, height);

    // ─── TITLE WITH GLOW ─────────────────────────────────────────
    // Title glow (behind text)
    // Subtle glow behind title using a soft rectangle
    const titleGlow = this.add.rectangle(width / 2, 120, 400, 60, 0x6c63ff, 0.04);

    this.tweens.add({
      targets: titleGlow,
      alpha: { from: 0.03, to: 0.07 },
      scaleX: { from: 1, to: 1.1 },
      scaleY: { from: 1, to: 1.3 },
      duration: 2500,
      yoyo: true,
      repeat: -1,
      ease: 'Sine.easeInOut',
    });

    // Main title
    const title = this.add.text(width / 2, 130, 'PROMPT BATTLE', {
      fontSize: '56px',
      color: '#8a82ff',
      fontFamily: '"Orbitron", "Rajdhani", monospace',
      fontStyle: 'bold',
    }).setOrigin(0.5).setAlpha(0);

    this.tweens.add({
      targets: title,
      alpha: 1,
      y: 120,
      duration: 1000,
      ease: 'Back.easeOut',
    });

    // Subtitle
    const subtitle = this.add.text(width / 2, 180, 'COMMAND YOUR ARMY WITH WORDS', {
      fontSize: '13px',
      color: '#4a4a6a',
      fontFamily: 'monospace',
      letterSpacing: 4,
    }).setOrigin(0.5).setAlpha(0);

    this.tweens.add({
      targets: subtitle,
      alpha: 0.8,
      duration: 800,
      delay: 500,
    });

    // Decorative line under title
    const line = this.add.graphics();
    line.lineStyle(1, 0x6c63ff, 0.4);
    line.lineBetween(width / 2 - 120, 200, width / 2 + 120, 200);
    line.setAlpha(0);
    this.tweens.add({ targets: line, alpha: 1, duration: 800, delay: 600 });

    // ─── BUTTONS ─────────────────────────────────────────────────
    const playBtn = this.createGlowButton(
      width / 2, 290, 280, 58, 'FIND MATCH', 0x6c63ff, true
    );
    playBtn.container.setAlpha(0).setScale(0.9);
    this.tweens.add({
      targets: playBtn.container,
      alpha: 1, scaleX: 1, scaleY: 1,
      duration: 600, delay: 700, ease: 'Back.easeOut',
    });
    playBtn.zone.on('pointerdown', () => this.findMatch());

    const localBtn = this.createGlowButton(
      width / 2, 368, 280, 58, 'LOCAL TEST', 0x333366, false
    );
    localBtn.container.setAlpha(0).setScale(0.9);
    this.tweens.add({
      targets: localBtn.container,
      alpha: 1, scaleX: 1, scaleY: 1,
      duration: 600, delay: 850, ease: 'Back.easeOut',
    });
    localBtn.zone.on('pointerdown', () => this.startLocalTest());

    // ─── STATUS TEXT ─────────────────────────────────────────────
    this.statusText = this.add.text(width / 2, 440, '', {
      fontSize: '14px',
      color: '#ffaa44',
      fontFamily: 'monospace',
    }).setOrigin(0.5);

    // ─── HOW TO PLAY ─────────────────────────────────────────────
    const howToPlay = this.add.container(width / 2, height - 120);

    const howTitle = this.add.text(0, 0, 'HOW TO PLAY', {
      fontSize: '11px',
      color: '#3a3a5a',
      fontFamily: 'monospace',
      letterSpacing: 3,
    }).setOrigin(0.5);

    const steps = [
      { icon: '1', text: 'Draft 3 characters (class + animal combo)' },
      { icon: '2', text: 'Type or speak commands to control them' },
      { icon: '3', text: 'Defeat all enemy characters to win' },
    ];

    steps.forEach((step, i) => {
      const y = 28 + i * 26;
      // Step number circle
      const circle = this.add.graphics();
      circle.fillStyle(0x6c63ff, 0.15);
      circle.fillCircle(-180, y, 10);
      circle.fillStyle(0x6c63ff, 0.6);
      circle.fillCircle(-180, y, 6);
      howToPlay.add(circle);

      const num = this.add.text(-180, y, step.icon, {
        fontSize: '10px', color: '#fff', fontFamily: 'monospace', fontStyle: 'bold',
      }).setOrigin(0.5);
      howToPlay.add(num);

      const txt = this.add.text(-160, y, step.text, {
        fontSize: '12px', color: '#555', fontFamily: 'monospace',
      }).setOrigin(0, 0.5);
      howToPlay.add(txt);
    });

    howToPlay.add(howTitle);
    howToPlay.setAlpha(0);
    this.tweens.add({ targets: howToPlay, alpha: 1, duration: 800, delay: 1200 });

    // Version
    this.add.text(width / 2, height - 16, 'v0.1.0  |  Phaser 3 + Firebase + Gemini', {
      fontSize: '10px',
      color: '#222',
      fontFamily: 'monospace',
    }).setOrigin(0.5);
  }

  update() {
    // Animate floating orbs
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

  private createAnimatedGrid(width: number, height: number) {
    const gridGfx = this.add.graphics();
    gridGfx.lineStyle(1, 0x6c63ff, 0.03);

    // Vertical lines
    for (let x = 0; x < width; x += 60) {
      gridGfx.lineBetween(x, 0, x, height);
    }
    // Horizontal lines
    for (let y = 0; y < height; y += 60) {
      gridGfx.lineBetween(0, y, width, y);
    }

    // Subtle animated scan line
    const scanLine = this.add.rectangle(0, 0, width, 1, 0x6c63ff, 0.04);
    scanLine.setOrigin(0, 0);
    this.tweens.add({
      targets: scanLine,
      y: height,
      duration: 10000,
      repeat: -1,
      ease: 'Linear',
    });
  }

  private createFloatingOrbs(width: number, height: number) {
    for (let i = 0; i < 8; i++) {
      const x = Math.random() * width;
      const y = Math.random() * height;
      const r = 3 + Math.random() * 4;
      const orb = this.add.circle(x, y, r, 0x6c63ff, 0.04 + Math.random() * 0.06);

      this.tweens.add({
        targets: orb,
        alpha: { from: orb.alpha, to: orb.alpha * 0.3 },
        duration: 3000 + Math.random() * 4000,
        yoyo: true,
        repeat: -1,
        ease: 'Sine.easeInOut',
        delay: Math.random() * 2000,
      });

      this.floatingOrbs.push({
        sprite: orb,
        vx: (Math.random() - 0.5) * 0.2,
        vy: (Math.random() - 0.5) * 0.15,
      });
    }
  }

  private createGlowButton(
    x: number, y: number, w: number, h: number,
    label: string, color: number, isPrimary: boolean
  ): { container: Phaser.GameObjects.Container; zone: Phaser.GameObjects.Zone } {
    const container = this.add.container(x, y);

    // Glow behind button (only for primary)
    if (isPrimary) {
      const glow = this.add.rectangle(0, 0, w + 20, h + 20, color, 0.08);
      glow.setBlendMode(Phaser.BlendModes.ADD);
      container.add(glow);

      this.tweens.add({
        targets: glow,
        alpha: { from: 0.08, to: 0.15 },
        scaleX: { from: 1, to: 1.05 },
        scaleY: { from: 1, to: 1.08 },
        duration: 1500,
        yoyo: true,
        repeat: -1,
        ease: 'Sine.easeInOut',
      });
    }

    // Button background
    const bg = this.add.graphics();
    bg.fillStyle(color, isPrimary ? 0.25 : 0.1);
    bg.fillRoundedRect(-w / 2, -h / 2, w, h, 8);
    bg.lineStyle(1, color, isPrimary ? 0.6 : 0.3);
    bg.strokeRoundedRect(-w / 2, -h / 2, w, h, 8);
    container.add(bg);

    // Button text
    const text = this.add.text(0, 0, label, {
      fontSize: '18px',
      color: isPrimary ? '#fff' : '#888',
      fontFamily: '"Rajdhani", monospace',
      fontStyle: 'bold',
      letterSpacing: 2,
    }).setOrigin(0.5);
    container.add(text);

    // Subtle arrow indicators for primary
    if (isPrimary) {
      const arrowL = this.add.text(-w / 2 + 20, 0, '>', {
        fontSize: '14px', color: '#6c63ff', fontFamily: 'monospace',
      }).setOrigin(0.5).setAlpha(0.4);
      const arrowR = this.add.text(w / 2 - 20, 0, '<', {
        fontSize: '14px', color: '#6c63ff', fontFamily: 'monospace',
      }).setOrigin(0.5).setAlpha(0.4);
      container.add([arrowL, arrowR]);

      this.tweens.add({
        targets: [arrowL, arrowR],
        alpha: { from: 0.2, to: 0.6 },
        duration: 1000,
        yoyo: true,
        repeat: -1,
      });
    }

    // Interactive zone
    const zone = this.add.zone(x, y, w, h).setInteractive({ useHandCursor: true });

    zone.on('pointerover', () => {
      this.tweens.add({
        targets: container,
        scaleX: 1.04, scaleY: 1.04,
        duration: 200,
        ease: 'Back.easeOut',
      });
      text.setColor('#fff');
      // Redraw bg brighter
      bg.clear();
      bg.fillStyle(color, isPrimary ? 0.4 : 0.2);
      bg.fillRoundedRect(-w / 2, -h / 2, w, h, 8);
      bg.lineStyle(2, color, isPrimary ? 0.9 : 0.5);
      bg.strokeRoundedRect(-w / 2, -h / 2, w, h, 8);
    });

    zone.on('pointerout', () => {
      this.tweens.add({
        targets: container,
        scaleX: 1, scaleY: 1,
        duration: 200,
      });
      text.setColor(isPrimary ? '#fff' : '#888');
      bg.clear();
      bg.fillStyle(color, isPrimary ? 0.25 : 0.1);
      bg.fillRoundedRect(-w / 2, -h / 2, w, h, 8);
      bg.lineStyle(1, color, isPrimary ? 0.6 : 0.3);
      bg.strokeRoundedRect(-w / 2, -h / 2, w, h, 8);
    });

    zone.on('pointerdown', () => {
      this.tweens.add({
        targets: container,
        scaleX: 0.96, scaleY: 0.96,
        duration: 80,
        yoyo: true,
      });
    });

    return { container, zone };
  }

  private async findMatch() {
    this.statusText.setText('Connecting...');
    this.tweens.add({ targets: this.statusText, alpha: { from: 0, to: 1 }, duration: 300 });

    try {
      const firebase = FirebaseSync.getInstance();
      await firebase.initialize();
      this.statusText.setText('Signed in. Searching for opponent...');

      // Animated dots
      let dots = 0;
      const dotTimer = this.time.addEvent({
        delay: 500,
        callback: () => {
          dots = (dots + 1) % 4;
          this.statusText.setText('Searching for opponent' + '.'.repeat(dots));
        },
        loop: true,
      });

      this.matchmaking = new Matchmaking(firebase);
      const gameId = await this.matchmaking.joinQueue();

      dotTimer.destroy();

      if (gameId) {
        this.statusText.setText('Match found!');
        this.statusText.setColor('#44ff88');

        // Flash effect
        this.cameras.main.flash(300, 108, 99, 255, false);

        this.time.delayedCall(800, () => {
          this.cameras.main.fadeOut(400, 5, 5, 16);
          this.cameras.main.once('camerafadeoutcomplete', () => {
            this.scene.start('DraftScene', {
              gameId,
              playerId: firebase.getPlayerId(),
              isLocal: false,
            });
          });
        });
      }
    } catch (err) {
      this.statusText.setText('Error: ' + (err as Error).message);
      this.statusText.setColor('#ff4444');
    }
  }

  private async startLocalTest() {
    this.statusText.setText('Starting local test...');
    this.tweens.add({ targets: this.statusText, alpha: { from: 0, to: 1 }, duration: 300 });

    try {
      const firebase = FirebaseSync.getInstance();
      await firebase.initialize();

      const gameId = await firebase.createLocalGame();

      this.cameras.main.fadeOut(400, 5, 5, 16);
      this.cameras.main.once('camerafadeoutcomplete', () => {
        this.scene.start('DraftScene', {
          gameId,
          playerId: firebase.getPlayerId(),
          isLocal: true,
        });
      });
    } catch (err) {
      this.statusText.setText('Error: ' + (err as Error).message);
      this.statusText.setColor('#ff4444');
    }
  }
}
