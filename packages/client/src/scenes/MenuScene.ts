import Phaser from 'phaser';
import { FirebaseSync } from '../network/FirebaseSync';
import { Matchmaking } from '../network/Matchmaking';

export class MenuScene extends Phaser.Scene {
  private matchmaking!: Matchmaking;
  private statusText!: Phaser.GameObjects.Text;
  private floatingShapes: { sprite: Phaser.GameObjects.Arc | Phaser.GameObjects.Star; vx: number; vy: number; rotSpeed: number }[] = [];

  constructor() {
    super({ key: 'MenuScene' });
  }

  create() {
    const { width, height } = this.cameras.main;
    this.cameras.main.setBackgroundColor('#1B1040');
    this.cameras.main.fadeIn(600, 27, 16, 64);

    // Floating colorful shapes (stars, circles)
    this.createFloatingShapes(width, height);

    // Title shadow (offset behind main title for cartoon depth)
    this.add.text(width / 2 + 4, 124, 'PROMPT BATTLE', {
      fontSize: '60px',
      color: '#0D0825',
      fontFamily: '"Fredoka", sans-serif',
      fontStyle: 'bold',
    }).setOrigin(0.5).setAlpha(0.6);

    // Main title
    const title = this.add.text(width / 2, 120, 'PROMPT BATTLE', {
      fontSize: '60px',
      color: '#FF6B9D',
      fontFamily: '"Fredoka", sans-serif',
      fontStyle: 'bold',
    }).setOrigin(0.5).setAlpha(0).setScale(0.5);

    this.tweens.add({
      targets: title,
      alpha: 1,
      scaleX: 1,
      scaleY: 1,
      duration: 800,
      ease: 'Back.easeOut',
    });

    // Title bounce loop
    this.tweens.add({
      targets: title,
      y: { from: 120, to: 126 },
      duration: 2000,
      yoyo: true,
      repeat: -1,
      ease: 'Sine.easeInOut',
    });

    // Subtitle
    const subtitle = this.add.text(width / 2, 178, 'COMMAND YOUR ARMY WITH WORDS!', {
      fontSize: '15px',
      color: '#FFD93D',
      fontFamily: '"Nunito", sans-serif',
      fontStyle: 'bold',
      letterSpacing: 3,
    }).setOrigin(0.5).setAlpha(0);

    this.tweens.add({
      targets: subtitle,
      alpha: 0.9,
      duration: 600,
      delay: 500,
    });

    // Decorative line - bright and fun
    const line = this.add.graphics();
    line.lineStyle(3, 0xFFD93D, 0.5);
    line.lineBetween(width / 2 - 100, 200, width / 2 + 100, 200);
    // Dots at ends
    line.fillStyle(0xFFD93D, 0.7);
    line.fillCircle(width / 2 - 104, 200, 4);
    line.fillCircle(width / 2 + 104, 200, 4);
    line.setAlpha(0);
    this.tweens.add({ targets: line, alpha: 1, duration: 600, delay: 600 });

    // BUTTONS
    const playBtn = this.createCartoonButton(
      width / 2, 290, 300, 62, 'FIND MATCH', 0xFF6B9D, true
    );
    playBtn.container.setAlpha(0).setScale(0.5);
    this.tweens.add({
      targets: playBtn.container,
      alpha: 1, scaleX: 1, scaleY: 1,
      duration: 600, delay: 700, ease: 'Back.easeOut',
    });
    playBtn.zone.on('pointerdown', () => this.findMatch());

    const localBtn = this.createCartoonButton(
      width / 2, 372, 300, 62, 'LOCAL TEST', 0x6CC4FF, false
    );
    localBtn.container.setAlpha(0).setScale(0.5);
    this.tweens.add({
      targets: localBtn.container,
      alpha: 1, scaleX: 1, scaleY: 1,
      duration: 600, delay: 850, ease: 'Back.easeOut',
    });
    localBtn.zone.on('pointerdown', () => this.startLocalTest());

    // Status text
    this.statusText = this.add.text(width / 2, 440, '', {
      fontSize: '16px',
      color: '#FFD93D',
      fontFamily: '"Nunito", sans-serif',
      fontStyle: 'bold',
    }).setOrigin(0.5);

    // HOW TO PLAY
    const howToPlay = this.add.container(width / 2, height - 120);

    const howTitle = this.add.text(0, 0, 'HOW TO PLAY', {
      fontSize: '13px',
      color: '#FF6B9D',
      fontFamily: '"Fredoka", sans-serif',
      fontStyle: 'bold',
      letterSpacing: 3,
    }).setOrigin(0.5);

    const steps = [
      { icon: '1', text: 'Draft 3 characters (class + animal combo)' },
      { icon: '2', text: 'Type or speak commands to control them' },
      { icon: '3', text: 'Defeat all enemy characters to win!' },
    ];

    steps.forEach((step, i) => {
      const y = 30 + i * 28;
      // Step number circle - bright and chunky
      const circle = this.add.graphics();
      circle.fillStyle(0x000000, 0.3);
      circle.fillCircle(-180, y, 12);
      circle.fillStyle(0xFFD93D, 0.9);
      circle.fillCircle(-180, y, 10);
      howToPlay.add(circle);

      const num = this.add.text(-180, y, step.icon, {
        fontSize: '12px', color: '#1B1040', fontFamily: '"Fredoka", sans-serif', fontStyle: 'bold',
      }).setOrigin(0.5);
      howToPlay.add(num);

      const txt = this.add.text(-160, y, step.text, {
        fontSize: '13px', color: '#cbb8ee', fontFamily: '"Nunito", sans-serif', fontStyle: '600',
      }).setOrigin(0, 0.5);
      howToPlay.add(txt);
    });

    howToPlay.add(howTitle);
    howToPlay.setAlpha(0);
    this.tweens.add({ targets: howToPlay, alpha: 1, duration: 800, delay: 1200 });

    // Version
    this.add.text(width / 2, height - 16, 'v0.1.0  |  Phaser 3 + Firebase + Gemini', {
      fontSize: '11px',
      color: '#3D2070',
      fontFamily: '"Nunito", sans-serif',
    }).setOrigin(0.5);
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

  private createFloatingShapes(width: number, height: number) {
    const colors = [0xFF6B9D, 0xFFD93D, 0x45E6B0, 0x6CC4FF, 0xC98FFF, 0xFF9F43];

    for (let i = 0; i < 12; i++) {
      const x = Math.random() * width;
      const y = Math.random() * height;
      const color = colors[i % colors.length];
      const alpha = 0.06 + Math.random() * 0.08;

      let sprite: Phaser.GameObjects.Arc | Phaser.GameObjects.Star;
      if (i % 3 === 0) {
        // Star shape
        sprite = this.add.star(x, y, 5, 3 + Math.random() * 4, 6 + Math.random() * 6, color, alpha);
      } else {
        // Circle
        const r = 4 + Math.random() * 8;
        sprite = this.add.circle(x, y, r, color, alpha);
      }

      this.tweens.add({
        targets: sprite,
        alpha: { from: alpha, to: alpha * 0.3 },
        scaleX: { from: 1, to: 1.2 },
        scaleY: { from: 1, to: 1.2 },
        duration: 3000 + Math.random() * 4000,
        yoyo: true,
        repeat: -1,
        ease: 'Sine.easeInOut',
        delay: Math.random() * 2000,
      });

      this.floatingShapes.push({
        sprite,
        vx: (Math.random() - 0.5) * 0.3,
        vy: (Math.random() - 0.5) * 0.25,
        rotSpeed: (Math.random() - 0.5) * 0.3,
      });
    }
  }

  private createCartoonButton(
    x: number, y: number, w: number, h: number,
    label: string, color: number, isPrimary: boolean
  ): { container: Phaser.GameObjects.Container; zone: Phaser.GameObjects.Zone } {
    const container = this.add.container(x, y);

    // Shadow behind button
    const shadow = this.add.graphics();
    shadow.fillStyle(0x000000, 0.3);
    shadow.fillRoundedRect(-w / 2 + 4, -h / 2 + 4, w, h, 16);
    container.add(shadow);

    // Button background with thick cartoon border
    const bg = this.add.graphics();
    bg.fillStyle(color, 0.3);
    bg.fillRoundedRect(-w / 2, -h / 2, w, h, 16);
    bg.lineStyle(3, color, 0.8);
    bg.strokeRoundedRect(-w / 2, -h / 2, w, h, 16);
    container.add(bg);

    // Button text
    const text = this.add.text(0, 0, label, {
      fontSize: '20px',
      color: '#fff',
      fontFamily: '"Fredoka", sans-serif',
      fontStyle: 'bold',
      letterSpacing: 2,
    }).setOrigin(0.5);
    container.add(text);

    // Idle bounce for primary button
    if (isPrimary) {
      this.tweens.add({
        targets: container,
        scaleX: { from: 1, to: 1.02 },
        scaleY: { from: 1, to: 1.02 },
        duration: 1200,
        yoyo: true,
        repeat: -1,
        ease: 'Sine.easeInOut',
      });
    }

    // Interactive zone
    const zone = this.add.zone(x, y, w, h).setInteractive({ useHandCursor: true });

    zone.on('pointerover', () => {
      this.tweens.add({
        targets: container,
        scaleX: 1.08, scaleY: 1.08,
        duration: 200,
        ease: 'Back.easeOut',
      });
      text.setColor('#fff');
      bg.clear();
      bg.fillStyle(color, 0.5);
      bg.fillRoundedRect(-w / 2, -h / 2, w, h, 16);
      bg.lineStyle(4, color, 1);
      bg.strokeRoundedRect(-w / 2, -h / 2, w, h, 16);
    });

    zone.on('pointerout', () => {
      this.tweens.add({
        targets: container,
        scaleX: 1, scaleY: 1,
        duration: 200,
      });
      text.setColor('#fff');
      bg.clear();
      bg.fillStyle(color, 0.3);
      bg.fillRoundedRect(-w / 2, -h / 2, w, h, 16);
      bg.lineStyle(3, color, 0.8);
      bg.strokeRoundedRect(-w / 2, -h / 2, w, h, 16);
    });

    zone.on('pointerdown', () => {
      this.tweens.add({
        targets: container,
        scaleX: 0.92, scaleY: 0.92,
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
        this.statusText.setColor('#45E6B0');

        this.cameras.main.flash(300, 255, 107, 157, false);

        this.time.delayedCall(800, () => {
          this.cameras.main.fadeOut(400, 27, 16, 64);
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
      this.statusText.setColor('#FF6B6B');
    }
  }

  private async startLocalTest() {
    this.statusText.setText('Starting local test...');
    this.tweens.add({ targets: this.statusText, alpha: { from: 0, to: 1 }, duration: 300 });

    try {
      const firebase = FirebaseSync.getInstance();
      await firebase.initialize();

      const gameId = await firebase.createLocalGame();

      this.cameras.main.fadeOut(400, 27, 16, 64);
      this.cameras.main.once('camerafadeoutcomplete', () => {
        this.scene.start('DraftScene', {
          gameId,
          playerId: firebase.getPlayerId(),
          isLocal: true,
        });
      });
    } catch (err) {
      this.statusText.setText('Error: ' + (err as Error).message);
      this.statusText.setColor('#FF6B6B');
    }
  }
}
