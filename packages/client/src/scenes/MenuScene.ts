import Phaser from 'phaser';
import { FirebaseSync } from '../network/FirebaseSync';
import { Matchmaking } from '../network/Matchmaking';
import { getSoloMaps, MapDef } from '@prompt-battle/shared';

export class MenuScene extends Phaser.Scene {
  private matchmaking!: Matchmaking;
  private statusText!: Phaser.GameObjects.Text;
  private floatingShapes: { sprite: Phaser.GameObjects.Image; vx: number; vy: number; rot: number }[] = [];
  private mapPickerContainer: Phaser.GameObjects.Container | null = null;
  private mapPickerZones: Phaser.GameObjects.Zone[] = [];
  private muted: boolean = localStorage.getItem('pb_sound_muted') === 'true';

  constructor() {
    super({ key: 'MenuScene' });
  }

  create() {
    const { width, height } = this.cameras.main;

    // === BACKGROUND: dark earthy gradient ===
    this.cameras.main.setBackgroundColor('#0f1a0a');
    this.cameras.main.fadeIn(600, 15, 26, 10);

    // Dark earthy overlay with soft radial glow in center
    const bg = this.add.graphics().setDepth(0);
    bg.fillStyle(0x0f1a0a, 1);
    bg.fillRect(0, 0, width, height);
    // Subtle warm center glow
    bg.fillStyle(0x1a2e10, 0.6);
    bg.fillCircle(width / 2, height * 0.45, Math.max(width, height) * 0.5);
    bg.fillStyle(0x243a18, 0.3);
    bg.fillCircle(width / 2, height * 0.45, Math.max(width, height) * 0.3);

    // === FLOATING DECORATIVE ICONS ===
    this.createFloatingIcons(width, height);

    // === VERTICALLY CENTERED LAYOUT ===
    const centerY = height / 2;
    const titleY = centerY - 220;
    const subtitleY = titleY + 58;
    const dividerY = subtitleY + 28;
    const btn1Y = dividerY + 60;
    const btn2Y = btn1Y + 68;
    const btn3Y = btn2Y + 68;
    const btn4Y = btn3Y + 68;
    const howToPlayY = btn4Y + 75;

    // === TITLE ===
    // Sword decorations on each side of title
    if (this.textures.exists('ts_icon5')) {
      const swordL = this.add.image(width / 2 - 240, titleY + 5, 'ts_icon5')
        .setScale(1.0).setDepth(10).setAngle(-30).setAlpha(0.7);
      const swordR = this.add.image(width / 2 + 240, titleY + 5, 'ts_icon5')
        .setScale(1.0).setDepth(10).setAngle(30).setFlipX(true).setAlpha(0.7);
      this.tweens.add({ targets: [swordL, swordR], alpha: 0.85, duration: 800, delay: 300 });
    }

    // Title shadow
    this.add.text(width / 2 + 3, titleY + 3, 'MARK MY HORDES', {
      fontSize: '56px', color: '#000000', fontFamily: '"Fredoka", sans-serif', fontStyle: 'bold',
    }).setOrigin(0.5).setAlpha(0.4).setDepth(10);

    // Main title
    const title = this.add.text(width / 2, titleY, 'MARK MY HORDES', {
      fontSize: '56px', color: '#FFD93D', fontFamily: '"Fredoka", sans-serif', fontStyle: 'bold',
      stroke: '#3a2a10', strokeThickness: 6,
    }).setOrigin(0.5).setAlpha(0).setScale(0.5).setDepth(11);

    this.tweens.add({
      targets: title, alpha: 1, scaleX: 1, scaleY: 1,
      duration: 800, ease: 'Back.easeOut',
    });
    this.tweens.add({
      targets: title, y: { from: titleY, to: titleY + 5 },
      duration: 2400, yoyo: true, repeat: -1, ease: 'Sine.easeInOut',
    });

    // Subtitle
    const subtitle = this.add.text(width / 2, subtitleY, 'COMMAND YOUR ARMY WITH WORDS', {
      fontSize: '15px', color: '#a89870', fontFamily: '"Nunito", sans-serif', fontStyle: 'bold',
      letterSpacing: 4, stroke: '#0a0f06', strokeThickness: 3,
    }).setOrigin(0.5).setAlpha(0).setDepth(11);
    this.tweens.add({ targets: subtitle, alpha: 0.9, duration: 600, delay: 500 });

    // Decorative divider
    const divLine = this.add.graphics().setDepth(10);
    divLine.lineStyle(2, 0x8B7355, 0.5);
    divLine.lineBetween(width / 2 - 140, dividerY, width / 2 + 140, dividerY);
    // Diamond at center
    divLine.fillStyle(0xFFD93D, 0.7);
    const dx = width / 2, dy = dividerY;
    divLine.fillTriangle(dx - 5, dy, dx, dy - 5, dx + 5, dy);
    divLine.fillTriangle(dx - 5, dy, dx, dy + 5, dx + 5, dy);
    // Dots at ends
    divLine.fillStyle(0x8B7355, 0.6);
    divLine.fillCircle(width / 2 - 144, dividerY, 3);
    divLine.fillCircle(width / 2 + 144, dividerY, 3);
    divLine.setAlpha(0);
    this.tweens.add({ targets: divLine, alpha: 1, duration: 600, delay: 600 });

    // === BUTTONS ===
    const hordeBtn = this.createMedievalButton(width / 2, btn1Y, 340, 54, 'HORDE (SOLO)', 'green', true);
    hordeBtn.container.setAlpha(0).setScale(0.5);
    this.tweens.add({ targets: hordeBtn.container, alpha: 1, scaleX: 1, scaleY: 1, duration: 600, delay: 700, ease: 'Back.easeOut' });
    hordeBtn.zone.on('pointerdown', () => this.startHordeMode());

    if (this.textures.exists('ts_icon6')) {
      const shieldIcon = this.add.image(width / 2 - 140, btn1Y, 'ts_icon6').setScale(0.7).setDepth(15);
      hordeBtn.container.add(shieldIcon);
      shieldIcon.setPosition(-120, 0);
    }

    const pvpBtn = this.createMedievalButton(width / 2, btn2Y, 340, 54, 'HORDE PVP', 'red', true);
    pvpBtn.container.setAlpha(0).setScale(0.5);
    this.tweens.add({ targets: pvpBtn.container, alpha: 1, scaleX: 1, scaleY: 1, duration: 600, delay: 850, ease: 'Back.easeOut' });
    pvpBtn.zone.on('pointerdown', () => this.findHordeMatch());

    if (this.textures.exists('ts_icon5')) {
      const swordIcon = this.add.image(0, 0, 'ts_icon5').setScale(0.65).setDepth(15);
      pvpBtn.container.add(swordIcon);
      swordIcon.setPosition(-120, 0);
    }

    const charBtn = this.createMedievalButton(width / 2, btn3Y, 340, 54, 'CHARACTERS', 'blue', false);
    charBtn.container.setAlpha(0).setScale(0.5);
    this.tweens.add({ targets: charBtn.container, alpha: 1, scaleX: 1, scaleY: 1, duration: 600, delay: 1000, ease: 'Back.easeOut' });
    charBtn.zone.on('pointerdown', () => {
      this.cameras.main.fadeOut(300, 15, 26, 10);
      this.cameras.main.once('camerafadeoutcomplete', () => {
        this.scene.start('CharactersScene');
      });
    });

    if (this.textures.exists('ts_icon11')) {
      const infoIcon = this.add.image(0, 0, 'ts_icon11').setScale(0.65).setDepth(15);
      charBtn.container.add(infoIcon);
      infoIcon.setPosition(-120, 0);
    }

    const debugBtn = this.createMedievalButton(width / 2, btn4Y, 340, 54, 'DEBUG MODE', 'yellow', false);
    debugBtn.container.setAlpha(0).setScale(0.5);
    this.tweens.add({ targets: debugBtn.container, alpha: 1, scaleX: 1, scaleY: 1, duration: 600, delay: 1150, ease: 'Back.easeOut' });
    if (this.textures.exists('ts_icon10')) {
      const gearIcon = this.add.image(0, 0, 'ts_icon10').setScale(0.65).setDepth(15);
      debugBtn.container.add(gearIcon);
      gearIcon.setPosition(-120, 0);
    }

    debugBtn.zone.on('pointerdown', () => {
      this.cameras.main.fadeOut(400, 15, 26, 10);
      this.cameras.main.once('camerafadeoutcomplete', () => {
        this.scene.start('HordeScene', { mapId: 'default', isDebug: true });
      });
    });

    // Keyboard shortcut hint
    const hint = this.add.text(width / 2, btn4Y + 38, 'Press ENTER to start horde mode', {
      fontSize: '11px', color: '#5a6a4a', fontFamily: '"Nunito", sans-serif', fontStyle: '600',
      stroke: '#0a0f06', strokeThickness: 2,
    }).setOrigin(0.5).setAlpha(0).setDepth(11);
    this.tweens.add({ targets: hint, alpha: 0.7, duration: 600, delay: 1200 });
    this.input.keyboard!.on('keydown-ENTER', () => { this.playsfx('button_click', 0.4); this.startHordeMode(); });

    // Status text (for matchmaking)
    this.statusText = this.add.text(width / 2, btn4Y + 58, '', {
      fontSize: '14px', color: '#FFD93D', fontFamily: '"Nunito", sans-serif', fontStyle: 'bold',
      stroke: '#0a0f06', strokeThickness: 3,
    }).setOrigin(0.5).setDepth(11);

    // === HOW TO PLAY — clean, readable ===
    const howContainer = this.add.container(width / 2, howToPlayY).setDepth(11);

    // Panel background — brighter, more visible
    const howBg = this.add.graphics();
    howBg.fillStyle(0x243a18, 0.92);
    howBg.fillRoundedRect(-230, -16, 460, 140, 12);
    howBg.lineStyle(2, 0x5a9a4e, 0.8);
    howBg.strokeRoundedRect(-230, -16, 460, 140, 12);
    // Inner glow line
    howBg.lineStyle(1, 0x8BC47A, 0.15);
    howBg.strokeRoundedRect(-227, -13, 454, 134, 10);
    howContainer.add(howBg);

    const howTitle = this.add.text(0, 0, 'HOW TO PLAY', {
      fontSize: '16px', color: '#FFD93D', fontFamily: '"Fredoka", sans-serif', fontStyle: 'bold',
      letterSpacing: 4, stroke: '#0a0f06', strokeThickness: 2,
    }).setOrigin(0.5);
    howContainer.add(howTitle);

    const steps = [
      { num: '1', text: 'Gather resources and capture camps to grow your army' },
      { num: '2', text: 'Type or speak commands to control your units' },
      { num: '3', text: 'Destroy the enemy nexus to win!' },
    ];

    steps.forEach((step, i) => {
      const y = 32 + i * 32;

      // Number badge
      const badge = this.add.graphics();
      badge.fillStyle(0x4a7a3e, 0.9);
      badge.fillCircle(-200, y, 12);
      badge.lineStyle(1.5, 0xFFD93D, 0.5);
      badge.strokeCircle(-200, y, 12);
      howContainer.add(badge);

      const num = this.add.text(-200, y, step.num, {
        fontSize: '14px', color: '#FFD93D', fontFamily: '"Fredoka", sans-serif', fontStyle: 'bold',
      }).setOrigin(0.5);
      howContainer.add(num);

      const txt = this.add.text(-178, y, step.text, {
        fontSize: '14px', color: '#e8e0c8', fontFamily: '"Nunito", sans-serif', fontStyle: '700',
        stroke: '#0a0f06', strokeThickness: 1,
      }).setOrigin(0, 0.5);
      howContainer.add(txt);
    });

    howContainer.setAlpha(0);
    this.tweens.add({ targets: howContainer, alpha: 1, duration: 800, delay: 1300 });

    // Version
    this.add.text(width / 2, height - 18, 'v0.2.0  |  Mark My Hordes', {
      fontSize: '10px', color: '#3a4a2a', fontFamily: '"Nunito", sans-serif',
      stroke: '#0a0f06', strokeThickness: 2,
    }).setOrigin(0.5).setDepth(11);

    // Castle decorations in corners
    if (this.textures.exists('ts_castle_blue')) {
      this.add.image(80, height - 60, 'ts_castle_blue').setScale(0.3).setAlpha(0.15).setDepth(2);
    }
    if (this.textures.exists('ts_castle_red')) {
      this.add.image(width - 80, height - 60, 'ts_castle_red').setScale(0.3).setAlpha(0.15).setDepth(2);
    }
  }

  update() {
    for (const shape of this.floatingShapes) {
      shape.sprite.x += shape.vx;
      shape.sprite.y += shape.vy;
      shape.sprite.angle += shape.rot;
      const { width, height } = this.cameras.main;
      if (shape.sprite.x < -40) shape.sprite.x = width + 40;
      if (shape.sprite.x > width + 40) shape.sprite.x = -40;
      if (shape.sprite.y < -40) shape.sprite.y = height + 40;
      if (shape.sprite.y > height + 40) shape.sprite.y = -40;
    }
  }

  private createFloatingIcons(width: number, height: number) {
    const iconKeys = ['ts_icon1', 'ts_icon2', 'ts_icon3', 'ts_icon4', 'ts_icon5', 'ts_icon6', 'ts_icon10'];
    const available = iconKeys.filter(k => this.textures.exists(k));
    if (available.length === 0) return;

    for (let i = 0; i < 12; i++) {
      const key = available[i % available.length];
      const x = Math.random() * width;
      const y = Math.random() * height;
      const img = this.add.image(x, y, key)
        .setScale(0.3 + Math.random() * 0.2)
        .setAlpha(0.04 + Math.random() * 0.04)
        .setDepth(1)
        .setAngle(Math.random() * 360);

      this.tweens.add({
        targets: img,
        alpha: { from: img.alpha, to: img.alpha * 0.3 },
        scaleX: { from: img.scaleX, to: img.scaleX * 1.1 },
        scaleY: { from: img.scaleY, to: img.scaleY * 1.1 },
        duration: 3000 + Math.random() * 4000,
        yoyo: true, repeat: -1, ease: 'Sine.easeInOut',
        delay: Math.random() * 2000,
      });

      this.floatingShapes.push({
        sprite: img,
        vx: (Math.random() - 0.5) * 0.2,
        vy: (Math.random() - 0.5) * 0.15,
        rot: (Math.random() - 0.5) * 0.1,
      });
    }
  }

  private createMedievalButton(
    x: number, y: number, w: number, h: number,
    label: string, color: 'green' | 'red' | 'blue' | 'yellow', isPrimary: boolean
  ): { container: Phaser.GameObjects.Container; zone: Phaser.GameObjects.Zone } {
    const container = this.add.container(x, y).setDepth(12);

    const schemes = {
      green:  { fill: 0x3a6a2e, border: 0x5a9a4e, highlight: 0x8BC47A, text: '#e8e0c8' },
      red:    { fill: 0x8B3333, border: 0xBB4444, highlight: 0xDD6666, text: '#e8e0c8' },
      blue:   { fill: 0x2a5a8a, border: 0x4a8aBB, highlight: 0x6aAADD, text: '#e8e0c8' },
      yellow: { fill: 0x7a6a2a, border: 0xAA9944, highlight: 0xDDCC66, text: '#e8e0c8' },
    };
    const s = schemes[color];

    // Drop shadow
    const shadow = this.add.graphics();
    shadow.fillStyle(0x000000, 0.5);
    shadow.fillRoundedRect(-w / 2 + 3, -h / 2 + 3, w, h, 8);
    container.add(shadow);

    // Button background
    const bg = this.add.graphics();
    bg.fillStyle(s.fill, 0.95);
    bg.fillRoundedRect(-w / 2, -h / 2, w, h, 8);
    bg.fillStyle(s.highlight, 0.1);
    bg.fillRoundedRect(-w / 2 + 4, -h / 2 + 3, w - 8, h / 3, 4);
    bg.lineStyle(2, s.border, 0.9);
    bg.strokeRoundedRect(-w / 2, -h / 2, w, h, 8);
    bg.lineStyle(1, 0x000000, 0.3);
    bg.strokeRoundedRect(-w / 2 + 2, -h / 2 + 2, w - 4, h - 4, 6);
    container.add(bg);

    // Corner rivets
    const rivetPositions = [
      [-w / 2 + 10, -h / 2 + 10], [w / 2 - 10, -h / 2 + 10],
      [-w / 2 + 10, h / 2 - 10], [w / 2 - 10, h / 2 - 10],
    ];
    const rivets = this.add.graphics();
    for (const [rx, ry] of rivetPositions) {
      rivets.fillStyle(0x000000, 0.4);
      rivets.fillCircle(rx + 1, ry + 1, 2.5);
      rivets.fillStyle(0x8B7355, 0.9);
      rivets.fillCircle(rx, ry, 2.5);
      rivets.fillStyle(0xffffff, 0.2);
      rivets.fillCircle(rx - 0.5, ry - 0.5, 1);
    }
    container.add(rivets);

    // Button text
    const text = this.add.text(0, -1, label, {
      fontSize: '18px', color: s.text, fontFamily: '"Fredoka", sans-serif', fontStyle: 'bold',
      letterSpacing: 2, stroke: '#000000', strokeThickness: 3,
    }).setOrigin(0.5);
    container.add(text);

    // Idle breathing for primary buttons
    if (isPrimary) {
      this.tweens.add({
        targets: container,
        scaleX: { from: 1, to: 1.012 }, scaleY: { from: 1, to: 1.012 },
        duration: 1400, yoyo: true, repeat: -1, ease: 'Sine.easeInOut',
      });
    }

    // Interactive zone
    const zone = this.add.zone(x, y, w, h).setInteractive({ useHandCursor: true }).setDepth(13);

    zone.on('pointerover', () => {
      this.playsfx('button_click', 0.15);
      this.tweens.add({ targets: container, scaleX: 1.06, scaleY: 1.06, duration: 150, ease: 'Back.easeOut' });
      bg.clear();
      bg.fillStyle(s.highlight, 0.4);
      bg.fillRoundedRect(-w / 2, -h / 2, w, h, 8);
      bg.fillStyle(0xffffff, 0.06);
      bg.fillRoundedRect(-w / 2 + 4, -h / 2 + 3, w - 8, h / 3, 4);
      bg.lineStyle(2, 0xFFD93D, 0.9);
      bg.strokeRoundedRect(-w / 2, -h / 2, w, h, 8);
      bg.lineStyle(1, 0x000000, 0.3);
      bg.strokeRoundedRect(-w / 2 + 2, -h / 2 + 2, w - 4, h - 4, 6);
      text.setColor('#FFD93D');
    });

    zone.on('pointerout', () => {
      this.tweens.add({ targets: container, scaleX: 1, scaleY: 1, duration: 150 });
      bg.clear();
      bg.fillStyle(s.fill, 0.95);
      bg.fillRoundedRect(-w / 2, -h / 2, w, h, 8);
      bg.fillStyle(s.highlight, 0.1);
      bg.fillRoundedRect(-w / 2 + 4, -h / 2 + 3, w - 8, h / 3, 4);
      bg.lineStyle(2, s.border, 0.9);
      bg.strokeRoundedRect(-w / 2, -h / 2, w, h, 8);
      bg.lineStyle(1, 0x000000, 0.3);
      bg.strokeRoundedRect(-w / 2 + 2, -h / 2 + 2, w - 4, h - 4, 6);
      text.setColor(s.text);
    });

    zone.on('pointerdown', () => {
      this.playsfx('button_click', 0.4);
      this.tweens.add({ targets: container, scaleX: 0.94, scaleY: 0.94, duration: 60, yoyo: true });
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

      const pulseTween = this.tweens.add({
        targets: this.statusText,
        alpha: { from: 1, to: 0.5 },
        duration: 800, yoyo: true, repeat: -1, ease: 'Sine.easeInOut',
      });

      this.matchmaking = new Matchmaking(firebase);
      const matchResult = await this.matchmaking.joinQueue();

      dotTimer.destroy();
      pulseTween.stop();
      this.statusText.setAlpha(1);

      if (matchResult.gameId) {
        this.playsfx('wave_start', 0.5);
        this.statusText.setText('Match found!');
        this.statusText.setColor('#6B9B5E');

        this.cameras.main.flash(300, 107, 155, 94, false);

        this.time.delayedCall(800, () => {
          this.cameras.main.fadeOut(400, 15, 26, 10);
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
      this.statusText.setColor('#BB4444');
    }
  }

  private startJungleLane() {
    this.cameras.main.fadeOut(400, 15, 26, 10);
    this.cameras.main.once('camerafadeoutcomplete', () => {
      this.scene.start('JungleLaneScene');
    });
  }

  private startHordeMode() {
    this.playsfx('wave_start', 0.4);
    this.cameras.main.fadeOut(400, 15, 26, 10);
    this.cameras.main.once('camerafadeoutcomplete', () => {
      this.scene.start('HordeScene', { mapId: 'default' });
    });
  }

  private showMapPicker() {
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
    overlay.fillStyle(0x0a0a0a, 0.8);
    overlay.fillRect(-width / 2, -height / 2, width, height);
    container.add(overlay);

    // Title
    const titleBg = this.add.graphics();
    titleBg.fillStyle(0x1a2e10, 0.95);
    titleBg.fillRoundedRect(-160, -height * 0.35 - 22, 320, 44, 6);
    titleBg.lineStyle(2, 0x3a5a28, 0.8);
    titleBg.strokeRoundedRect(-160, -height * 0.35 - 22, 320, 44, 6);
    container.add(titleBg);

    const title = this.add.text(0, -height * 0.35, 'CHOOSE YOUR MAP', {
      fontSize: '24px', color: '#FFD93D', fontFamily: '"Fredoka", sans-serif', fontStyle: 'bold',
      letterSpacing: 2,
    }).setOrigin(0.5);
    container.add(title);

    // Map cards
    const cardW = 260, cardH = 140, gap = 20;
    const totalW = maps.length * cardW + (maps.length - 1) * gap;
    const startX = -totalW / 2 + cardW / 2;
    const cardY = -20;

    const cardColors = [
      { fill: 0x2a4a1e, border: 0x4a7a3e, accent: '#6B9B5E' },
      { fill: 0x1e3a5a, border: 0x3a6a9a, accent: '#5588BB' },
      { fill: 0x5a4a1e, border: 0x8a7a3a, accent: '#BBA855' },
      { fill: 0x4a2a2a, border: 0x7a4a4a, accent: '#BB6644' },
    ];

    maps.forEach((map, i) => {
      const cx = startX + i * (cardW + gap);
      const cc = cardColors[i % cardColors.length];

      const cardShadow = this.add.graphics();
      cardShadow.fillStyle(0x000000, 0.5);
      cardShadow.fillRoundedRect(cx - cardW / 2 + 5, cardY - cardH / 2 + 5, cardW, cardH, 8);
      container.add(cardShadow);

      const bg = this.add.graphics();
      bg.fillStyle(0x1a2e10, 0.92);
      bg.fillRoundedRect(cx - cardW / 2, cardY - cardH / 2, cardW, cardH, 8);
      bg.fillStyle(cc.fill, 0.8);
      bg.fillRoundedRect(cx - cardW / 2, cardY - cardH / 2, cardW, 36, { tl: 8, tr: 8, bl: 0, br: 0 });
      bg.lineStyle(2, cc.border, 1);
      bg.strokeRoundedRect(cx - cardW / 2, cardY - cardH / 2, cardW, cardH, 8);
      container.add(bg);

      const nameText = this.add.text(cx, cardY - cardH / 2 + 18, map.name, {
        fontSize: '16px', color: '#d4c8a0', fontFamily: '"Fredoka", sans-serif', fontStyle: 'bold',
        stroke: '#000000', strokeThickness: 2,
      }).setOrigin(0.5);
      container.add(nameText);

      const descText = this.add.text(cx, cardY + 5, map.description, {
        fontSize: '11px', color: '#a89870', fontFamily: '"Nunito", sans-serif',
        wordWrap: { width: cardW - 24 }, align: 'center',
      }).setOrigin(0.5, 0);
      container.add(descText);

      const slotsText = this.add.text(cx, cardY + cardH / 2 - 18, `${map.campSlots.length * 2 + (map.trollSlot ? 1 : 0)} camps`, {
        fontSize: '10px', color: cc.accent, fontFamily: '"Nunito", sans-serif', fontStyle: 'bold',
        stroke: '#000000', strokeThickness: 2,
      }).setOrigin(0.5);
      container.add(slotsText);

      const zone = this.add.zone(width / 2 + cx, height / 2 + cardY, cardW, cardH)
        .setInteractive({ useHandCursor: true }).setDepth(201);
      this.mapPickerZones.push(zone);

      zone.on('pointerover', () => {
        this.playsfx('button_click', 0.15);
        bg.clear();
        bg.fillStyle(0x243a18, 0.95);
        bg.fillRoundedRect(cx - cardW / 2, cardY - cardH / 2, cardW, cardH, 8);
        bg.fillStyle(cc.fill, 0.95);
        bg.fillRoundedRect(cx - cardW / 2, cardY - cardH / 2, cardW, 36, { tl: 8, tr: 8, bl: 0, br: 0 });
        bg.lineStyle(2, 0xFFD93D, 1);
        bg.strokeRoundedRect(cx - cardW / 2, cardY - cardH / 2, cardW, cardH, 8);
      });
      zone.on('pointerout', () => {
        bg.clear();
        bg.fillStyle(0x1a2e10, 0.92);
        bg.fillRoundedRect(cx - cardW / 2, cardY - cardH / 2, cardW, cardH, 8);
        bg.fillStyle(cc.fill, 0.8);
        bg.fillRoundedRect(cx - cardW / 2, cardY - cardH / 2, cardW, 36, { tl: 8, tr: 8, bl: 0, br: 0 });
        bg.lineStyle(2, cc.border, 1);
        bg.strokeRoundedRect(cx - cardW / 2, cardY - cardH / 2, cardW, cardH, 8);
      });
      zone.on('pointerdown', () => {
        this.playsfx('button_click', 0.4);
        this.selectMap(map.id);
      });
    });

    // Back button
    const backY = cardY + cardH / 2 + 55;
    const backBg = this.add.graphics();
    backBg.fillStyle(0x6B2222, 0.8);
    backBg.fillRoundedRect(-50, backY - 15, 100, 30, 6);
    backBg.lineStyle(2, 0x993333, 0.9);
    backBg.strokeRoundedRect(-50, backY - 15, 100, 30, 6);
    container.add(backBg);

    const backText = this.add.text(0, backY, 'BACK', {
      fontSize: '14px', color: '#d4c8a0', fontFamily: '"Fredoka", sans-serif', fontStyle: 'bold',
      stroke: '#000000', strokeThickness: 2,
    }).setOrigin(0.5);
    container.add(backText);

    const backZone = this.add.zone(width / 2, height / 2 + backY, 100, 30)
      .setInteractive({ useHandCursor: true }).setDepth(201);
    this.mapPickerZones.push(backZone);
    backZone.on('pointerdown', () => {
      this.playsfx('button_click', 0.4);
      container.destroy();
      this.mapPickerZones.forEach(z => z.destroy());
      this.mapPickerZones = [];
      this.mapPickerContainer = null;
    });
    backZone.on('pointerover', () => {
      this.playsfx('button_click', 0.15);
      backBg.clear();
      backBg.fillStyle(0x993333, 0.9);
      backBg.fillRoundedRect(-50, backY - 15, 100, 30, 6);
      backBg.lineStyle(2, 0xFFD93D, 1);
      backBg.strokeRoundedRect(-50, backY - 15, 100, 30, 6);
    });
    backZone.on('pointerout', () => {
      backBg.clear();
      backBg.fillStyle(0x6B2222, 0.8);
      backBg.fillRoundedRect(-50, backY - 15, 100, 30, 6);
      backBg.lineStyle(2, 0x993333, 0.9);
      backBg.strokeRoundedRect(-50, backY - 15, 100, 30, 6);
    });

    container.setAlpha(0).setScale(0.9);
    this.tweens.add({ targets: container, alpha: 1, scaleX: 1, scaleY: 1, duration: 300, ease: 'Back.easeOut' });
  }

  private selectMap(mapId: string) {
    if (this.mapPickerContainer) {
      this.mapPickerContainer.destroy();
      this.mapPickerZones.forEach(z => z.destroy());
      this.mapPickerZones = [];
      this.mapPickerContainer = null;
    }

    this.cameras.main.fadeOut(400, 15, 26, 10);
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
        duration: 800, yoyo: true, repeat: -1, ease: 'Sine.easeInOut',
      });

      this.matchmaking = new Matchmaking(firebase, 'horde_waiting');
      const matchResult = await this.matchmaking.joinQueue();

      dotTimer.destroy();
      pulseTween.stop();
      this.statusText.setAlpha(1);

      if (matchResult.gameId) {
        this.playsfx('wave_start', 0.5);
        this.statusText.setText('Opponent found! Starting Horde PvP...');
        this.statusText.setColor('#6B9B5E');

        this.cameras.main.flash(300, 107, 155, 94, false);

        this.time.delayedCall(800, () => {
          this.cameras.main.fadeOut(400, 15, 26, 10);
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
      this.statusText.setColor('#BB4444');
    }
  }

  private playsfx(key: string, volume = 0.5) {
    if (this.muted || !this.cache.audio.exists(key)) return;
    this.sound.play(key, { volume });
  }

  private async startLocalTest() {
    this.statusText.setText('Starting local test...');
    this.tweens.add({ targets: this.statusText, alpha: { from: 0, to: 1 }, duration: 300 });

    try {
      const firebase = FirebaseSync.getInstance();
      await firebase.initialize();

      const gameId = await firebase.createLocalGame();

      this.cameras.main.fadeOut(400, 15, 26, 10);
      this.cameras.main.once('camerafadeoutcomplete', () => {
        this.scene.start('DraftScene', {
          gameId,
          playerId: firebase.getPlayerId(),
          isLocal: true,
        });
      });
    } catch (err) {
      this.statusText.setText('Error: ' + (err as Error).message);
      this.statusText.setColor('#BB4444');
    }
  }
}
