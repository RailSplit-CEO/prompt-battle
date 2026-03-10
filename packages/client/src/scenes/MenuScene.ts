import Phaser from 'phaser';
import { FirebaseSync } from '../network/FirebaseSync';
import { Matchmaking } from '../network/Matchmaking';
import { getSoloMaps, MapDef } from '@prompt-battle/shared';

export class MenuScene extends Phaser.Scene {
  private matchmaking!: Matchmaking;
  private statusText!: Phaser.GameObjects.Text;
  private floatingShapes: { sprite: Phaser.GameObjects.Arc | Phaser.GameObjects.Star; vx: number; vy: number; rotSpeed: number }[] = [];
  private mapPickerContainer: Phaser.GameObjects.Container | null = null;
  private mapPickerZones: Phaser.GameObjects.Zone[] = [];

  constructor() {
    super({ key: 'MenuScene' });
  }

  create() {
    const { width, height } = this.cameras.main;
    this.cameras.main.setBackgroundColor('#1B1040');
    this.cameras.main.fadeIn(600, 27, 16, 64);

    // Floating colorful shapes (stars, circles)
    this.createFloatingShapes(width, height);

    // Vertical centering: derive positions from title Y
    const titleY = height * 0.22;
    const subtitleY = titleY + 58;
    const lineY = subtitleY + 22;
    const playBtnY = lineY + 90;
    const localBtnY = playBtnY + 82;
    const statusY = localBtnY + 230;

    // Title shadow (offset behind main title for cartoon depth)
    this.add.text(width / 2 + 4, titleY + 4, 'PROMPT BATTLE', {
      fontSize: '60px',
      color: '#0D0825',
      fontFamily: '"Fredoka", sans-serif',
      fontStyle: 'bold',
    }).setOrigin(0.5).setAlpha(0.6);

    // Main title
    const title = this.add.text(width / 2, titleY, 'PROMPT BATTLE', {
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
      y: { from: titleY, to: titleY + 6 },
      duration: 2000,
      yoyo: true,
      repeat: -1,
      ease: 'Sine.easeInOut',
    });

    // Subtitle
    const subtitle = this.add.text(width / 2, subtitleY, 'COMMAND YOUR ARMY WITH WORDS!', {
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
    line.lineBetween(width / 2 - 100, lineY, width / 2 + 100, lineY);
    // Dots at ends
    line.fillStyle(0xFFD93D, 0.7);
    line.fillCircle(width / 2 - 104, lineY, 4);
    line.fillCircle(width / 2 + 104, lineY, 4);
    line.setAlpha(0);
    this.tweens.add({ targets: line, alpha: 1, duration: 600, delay: 600 });

    // BUTTONS — Horde modes + Characters only
    const hordeBtn = this.createCartoonButton(
      width / 2, playBtnY, 300, 62, 'HORDE (SOLO)', 0x45E6B0, true
    );
    hordeBtn.container.setAlpha(0).setScale(0.5);
    this.tweens.add({
      targets: hordeBtn.container,
      alpha: 1, scaleX: 1, scaleY: 1,
      duration: 600, delay: 700, ease: 'Back.easeOut',
    });
    hordeBtn.zone.on('pointerdown', () => this.startHordeMode());

    // Horde PvP (online multiplayer)
    const hordePvpBtnY = playBtnY + 82;
    const hordePvpBtn = this.createCartoonButton(
      width / 2, hordePvpBtnY, 300, 62, 'HORDE PVP', 0xFF9F43, true
    );
    hordePvpBtn.container.setAlpha(0).setScale(0.5);
    this.tweens.add({
      targets: hordePvpBtn.container,
      alpha: 1, scaleX: 1, scaleY: 1,
      duration: 600, delay: 850, ease: 'Back.easeOut',
    });
    hordePvpBtn.zone.on('pointerdown', () => this.findHordeMatch());

    // Characters (in-game bestiary)
    const charBtnY = hordePvpBtnY + 82;
    const charBtn = this.createCartoonButton(
      width / 2, charBtnY, 300, 62, 'CHARACTERS', 0x6BB0F0, false
    );
    charBtn.container.setAlpha(0).setScale(0.5);
    this.tweens.add({
      targets: charBtn.container,
      alpha: 1, scaleX: 1, scaleY: 1,
      duration: 600, delay: 1000, ease: 'Back.easeOut',
    });
    charBtn.zone.on('pointerdown', () => {
      this.cameras.main.fadeOut(300, 27, 16, 64);
      this.cameras.main.once('camerafadeoutcomplete', () => {
        this.scene.start('CharactersScene');
      });
    });

    // Keyboard shortcut hint
    const shortcutHint = this.add.text(width / 2, charBtnY + 44, 'Press ENTER to start horde mode', {
      fontSize: '12px',
      color: '#8B6DB0',
      fontFamily: '"Nunito", sans-serif',
      fontStyle: '600',
    }).setOrigin(0.5).setAlpha(0);
    this.tweens.add({ targets: shortcutHint, alpha: 0.6, duration: 600, delay: 1000 });

    // ENTER key listener
    this.input.keyboard!.on('keydown-ENTER', () => this.startHordeMode());

    // Status text
    this.statusText = this.add.text(width / 2, statusY, '', {
      fontSize: '16px',
      color: '#FFD93D',
      fontFamily: '"Nunito", sans-serif',
      fontStyle: 'bold',
    }).setOrigin(0.5);

    // HOW TO PLAY — positioned relative to buttons
    const howToPlayY = statusY + 50;
    const howToPlay = this.add.container(width / 2, howToPlayY);

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
      { icon: '3', text: 'Capture & hold control points to win!' },
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
    this.add.text(width / 2, height - 20, 'v0.1.0  |  Phaser 3 + Firebase + Gemini', {
      fontSize: '11px',
      color: '#6B4DB0',
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

      // Pulsing alpha on searching status
      const pulseTween = this.tweens.add({
        targets: this.statusText,
        alpha: { from: 1, to: 0.5 },
        duration: 800,
        yoyo: true,
        repeat: -1,
        ease: 'Sine.easeInOut',
      });

      this.matchmaking = new Matchmaking(firebase);
      const matchResult = await this.matchmaking.joinQueue();

      dotTimer.destroy();
      pulseTween.stop();
      this.statusText.setAlpha(1);

      if (matchResult.gameId) {
        this.statusText.setText('Match found!');
        this.statusText.setColor('#45E6B0');

        this.cameras.main.flash(300, 255, 107, 157, false);

        this.time.delayedCall(800, () => {
          this.cameras.main.fadeOut(400, 27, 16, 64);
          this.cameras.main.once('camerafadeoutcomplete', () => {
            this.scene.start('DraftScene', {
              gameId: matchResult.gameId,
              playerId: firebase.getPlayerId(),
              isLocal: false,
              amPlayer1: matchResult.amPlayer1,
            });
          });
        });
      }
    } catch (err) {
      this.statusText.setText('Error: ' + (err as Error).message);
      this.statusText.setColor('#FF6B6B');
    }
  }

  private startJungleLane() {
    this.cameras.main.fadeOut(400, 27, 16, 64);
    this.cameras.main.once('camerafadeoutcomplete', () => {
      this.scene.start('JungleLaneScene');
    });
  }

  private startHordeMode() {
    // Skip map picker — go straight to game using the editor-saved map
    this.cameras.main.fadeOut(400, 27, 16, 64);
    this.cameras.main.once('camerafadeoutcomplete', () => {
      this.scene.start('HordeScene', { mapId: 'default' });
    });
  }

  private showMapPicker() {
    // Remove existing picker if any
    if (this.mapPickerContainer) {
      this.mapPickerContainer.destroy();
      this.mapPickerZones.forEach(z => z.destroy());
    }
    this.mapPickerZones = [];

    const { width, height } = this.cameras.main;
    const maps = getSoloMaps();
    const container = this.add.container(width / 2, height / 2).setDepth(200);
    this.mapPickerContainer = container;

    // Dim overlay
    const overlay = this.add.graphics();
    overlay.fillStyle(0x000000, 0.7);
    overlay.fillRect(-width / 2, -height / 2, width, height);
    container.add(overlay);

    // Title
    const title = this.add.text(0, -height * 0.35, 'CHOOSE YOUR MAP', {
      fontSize: '32px', color: '#FFD93D', fontFamily: '"Fredoka", sans-serif', fontStyle: 'bold',
      letterSpacing: 3,
    }).setOrigin(0.5);
    container.add(title);

    // Map cards
    const cardW = 260, cardH = 130, gap = 20;
    const totalW = maps.length * cardW + (maps.length - 1) * gap;
    const startX = -totalW / 2 + cardW / 2;
    const cardY = -30;

    const mapColors = [0xFF6B9D, 0x6CC4FF, 0x45E6B0, 0xC98FFF];

    maps.forEach((map, i) => {
      const cx = startX + i * (cardW + gap);
      const color = mapColors[i % mapColors.length];

      // Card shadow
      const shadow = this.add.graphics();
      shadow.fillStyle(0x000000, 0.4);
      shadow.fillRoundedRect(cx - cardW / 2 + 4, cardY - cardH / 2 + 4, cardW, cardH, 12);
      container.add(shadow);

      // Card background
      const bg = this.add.graphics();
      bg.fillStyle(color, 0.25);
      bg.fillRoundedRect(cx - cardW / 2, cardY - cardH / 2, cardW, cardH, 12);
      bg.lineStyle(3, color, 0.8);
      bg.strokeRoundedRect(cx - cardW / 2, cardY - cardH / 2, cardW, cardH, 12);
      container.add(bg);

      // Map name
      const nameText = this.add.text(cx, cardY - 30, map.name, {
        fontSize: '18px', color: '#fff', fontFamily: '"Fredoka", sans-serif', fontStyle: 'bold',
      }).setOrigin(0.5);
      container.add(nameText);

      // Map description
      const descText = this.add.text(cx, cardY + 5, map.description, {
        fontSize: '11px', color: '#cbb8ee', fontFamily: '"Nunito", sans-serif',
        wordWrap: { width: cardW - 20 }, align: 'center',
      }).setOrigin(0.5, 0);
      container.add(descText);

      // Camps/slots info
      const slotsText = this.add.text(cx, cardY + cardH / 2 - 15, `${map.campSlots.length * 2 + (map.trollSlot ? 1 : 0)} camps`, {
        fontSize: '10px', color: '#FFD93D', fontFamily: '"Nunito", sans-serif', fontStyle: 'bold',
      }).setOrigin(0.5);
      container.add(slotsText);

      // Interactive zone (positioned in world space, not container space)
      const zone = this.add.zone(width / 2 + cx, height / 2 + cardY, cardW, cardH)
        .setInteractive({ useHandCursor: true }).setDepth(201);
      this.mapPickerZones.push(zone);

      zone.on('pointerover', () => {
        bg.clear();
        bg.fillStyle(color, 0.45);
        bg.fillRoundedRect(cx - cardW / 2, cardY - cardH / 2, cardW, cardH, 12);
        bg.lineStyle(4, color, 1);
        bg.strokeRoundedRect(cx - cardW / 2, cardY - cardH / 2, cardW, cardH, 12);
      });
      zone.on('pointerout', () => {
        bg.clear();
        bg.fillStyle(color, 0.25);
        bg.fillRoundedRect(cx - cardW / 2, cardY - cardH / 2, cardW, cardH, 12);
        bg.lineStyle(3, color, 0.8);
        bg.strokeRoundedRect(cx - cardW / 2, cardY - cardH / 2, cardW, cardH, 12);
      });
      zone.on('pointerdown', () => {
        this.selectMap(map.id);
      });
    });

    // Back button
    const backY = cardY + cardH / 2 + 60;
    const backText = this.add.text(0, backY, 'BACK', {
      fontSize: '16px', color: '#FF6B6B', fontFamily: '"Fredoka", sans-serif', fontStyle: 'bold',
    }).setOrigin(0.5);
    container.add(backText);

    const backZone = this.add.zone(width / 2, height / 2 + backY, 100, 30)
      .setInteractive({ useHandCursor: true }).setDepth(201);
    this.mapPickerZones.push(backZone);
    backZone.on('pointerdown', () => {
      container.destroy();
      this.mapPickerZones.forEach(z => z.destroy());
      this.mapPickerZones = [];
      this.mapPickerContainer = null;
    });
    backZone.on('pointerover', () => backText.setColor('#fff'));
    backZone.on('pointerout', () => backText.setColor('#FF6B6B'));

    // Animate in
    container.setAlpha(0).setScale(0.9);
    this.tweens.add({ targets: container, alpha: 1, scaleX: 1, scaleY: 1, duration: 300, ease: 'Back.easeOut' });
  }

  private selectMap(mapId: string) {
    // Clean up picker
    if (this.mapPickerContainer) {
      this.mapPickerContainer.destroy();
      this.mapPickerZones.forEach(z => z.destroy());
      this.mapPickerZones = [];
      this.mapPickerContainer = null;
    }

    this.cameras.main.fadeOut(400, 27, 16, 64);
    this.cameras.main.once('camerafadeoutcomplete', () => {
      this.scene.start('HordeScene', { mapId });
    });
  }

  private async findHordeMatch() {
    this.statusText.setText('Connecting for Horde PvP...');
    this.tweens.add({ targets: this.statusText, alpha: { from: 0, to: 1 }, duration: 300 });

    try {
      const firebase = FirebaseSync.getInstance();
      await firebase.initialize();
      this.statusText.setText('Searching for opponent...');

      let dots = 0;
      const dotTimer = this.time.addEvent({
        delay: 500,
        callback: () => {
          dots = (dots + 1) % 4;
          this.statusText.setText('Searching for Horde opponent' + '.'.repeat(dots));
        },
        loop: true,
      });

      const pulseTween = this.tweens.add({
        targets: this.statusText,
        alpha: { from: 1, to: 0.5 },
        duration: 800,
        yoyo: true,
        repeat: -1,
        ease: 'Sine.easeInOut',
      });

      this.matchmaking = new Matchmaking(firebase, 'horde_waiting');
      const matchResult = await this.matchmaking.joinQueue();

      dotTimer.destroy();
      pulseTween.stop();
      this.statusText.setAlpha(1);

      if (matchResult.gameId) {
        this.statusText.setText('Opponent found! Starting Horde PvP...');
        this.statusText.setColor('#45E6B0');

        this.cameras.main.flash(300, 255, 159, 67, false);

        this.time.delayedCall(800, () => {
          this.cameras.main.fadeOut(400, 27, 16, 64);
          this.cameras.main.once('camerafadeoutcomplete', () => {
            this.scene.start('HordeScene', {
              isOnline: true,
              gameId: matchResult.gameId,
              playerId: firebase.getPlayerId(),
              amPlayer1: matchResult.amPlayer1,
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
