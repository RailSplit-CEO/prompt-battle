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

  constructor() {
    super({ key: 'MenuScene' });
  }

  create() {
    const { width, height } = this.cameras.main;

    // === BACKGROUND: tiled grass with warm overlay ===
    this.cameras.main.setBackgroundColor('#2a4a1e');
    this.cameras.main.fadeIn(600, 20, 35, 15);

    // Tile grass if available, else solid color
    if (this.textures.exists('ts_grass')) {
      const TILE = 64;
      const grassFrames = [10, 11, 12, 13, 19, 20, 21, 22];
      let seed = 99;
      for (let y = 0; y < height; y += TILE) {
        for (let x = 0; x < width; x += TILE) {
          seed = (seed * 16807) % 2147483647;
          const frame = grassFrames[seed % grassFrames.length];
          this.add.image(x + TILE / 2, y + TILE / 2, 'ts_grass', frame).setDepth(0);
        }
      }
    }

    // Warm vignette overlay
    const vig = this.add.graphics().setDepth(1);
    vig.fillStyle(0x000000, 0.3);
    vig.fillRect(0, 0, width, height);
    // Lighter center
    vig.fillStyle(0x000000, -0.15);
    const vigR = Math.max(width, height) * 0.6;
    vig.fillCircle(width / 2, height / 2, vigR);

    // === FLOATING DECORATIVE ICONS ===
    this.createFloatingIcons(width, height);

    // Layout positions
    const titleY = height * 0.18;
    const subtitleY = titleY + 62;
    const dividerY = subtitleY + 24;
    const btn1Y = dividerY + 80;
    const btn2Y = btn1Y + 80;
    const btn3Y = btn2Y + 80;
    const statusY = btn3Y + 70;
    const howToPlayY = statusY + 50;

    // === TITLE with Swords banner ===
    // Sword decorations on each side of title
    if (this.textures.exists('ts_icon5')) {
      const swordL = this.add.image(width / 2 - 220, titleY + 5, 'ts_icon5')
        .setScale(1.0).setDepth(10).setAngle(-30).setAlpha(0.8);
      const swordR = this.add.image(width / 2 + 220, titleY + 5, 'ts_icon5')
        .setScale(1.0).setDepth(10).setAngle(30).setFlipX(true).setAlpha(0.8);
      this.tweens.add({ targets: [swordL, swordR], alpha: 0.9, duration: 800, delay: 300 });
    }

    // Title shadow
    this.add.text(width / 2 + 3, titleY + 3, 'PROMPT BATTLE', {
      fontSize: '56px', color: '#1a0e05', fontFamily: '"Fredoka", sans-serif', fontStyle: 'bold',
    }).setOrigin(0.5).setAlpha(0.5).setDepth(10);

    // Main title — warm parchment gold
    const title = this.add.text(width / 2, titleY, 'PROMPT BATTLE', {
      fontSize: '56px', color: '#FFD93D', fontFamily: '"Fredoka", sans-serif', fontStyle: 'bold',
      stroke: '#6B4226', strokeThickness: 6,
    }).setOrigin(0.5).setAlpha(0).setScale(0.5).setDepth(11);

    this.tweens.add({
      targets: title, alpha: 1, scaleX: 1, scaleY: 1,
      duration: 800, ease: 'Back.easeOut',
    });
    this.tweens.add({
      targets: title, y: { from: titleY, to: titleY + 5 },
      duration: 2400, yoyo: true, repeat: -1, ease: 'Sine.easeInOut',
    });

    // Subtitle — parchment style
    const subtitle = this.add.text(width / 2, subtitleY, 'COMMAND YOUR ARMY WITH WORDS!', {
      fontSize: '14px', color: '#e8dcc4', fontFamily: '"Nunito", sans-serif', fontStyle: 'bold',
      letterSpacing: 3, stroke: '#4a3520', strokeThickness: 3,
    }).setOrigin(0.5).setAlpha(0).setDepth(11);
    this.tweens.add({ targets: subtitle, alpha: 0.95, duration: 600, delay: 500 });

    // Decorative divider — crossed swords style
    const divLine = this.add.graphics().setDepth(10);
    divLine.lineStyle(2, 0xFFD93D, 0.6);
    divLine.lineBetween(width / 2 - 120, dividerY, width / 2 + 120, dividerY);
    // Diamond at center
    divLine.fillStyle(0xFFD93D, 0.8);
    const dx = width / 2, dy = dividerY;
    divLine.fillTriangle(dx - 6, dy, dx, dy - 6, dx + 6, dy);
    divLine.fillTriangle(dx - 6, dy, dx, dy + 6, dx + 6, dy);
    // Dots at ends
    divLine.fillCircle(width / 2 - 124, dividerY, 3);
    divLine.fillCircle(width / 2 + 124, dividerY, 3);
    divLine.setAlpha(0);
    this.tweens.add({ targets: divLine, alpha: 1, duration: 600, delay: 600 });

    // === BUTTONS — Medieval styled ===
    const hordeBtn = this.createMedievalButton(width / 2, btn1Y, 320, 60, 'HORDE (SOLO)', 'green', true);
    hordeBtn.container.setAlpha(0).setScale(0.5);
    this.tweens.add({ targets: hordeBtn.container, alpha: 1, scaleX: 1, scaleY: 1, duration: 600, delay: 700, ease: 'Back.easeOut' });
    hordeBtn.zone.on('pointerdown', () => this.startHordeMode());

    // Shield icon on solo button
    if (this.textures.exists('ts_icon6')) {
      const shieldIcon = this.add.image(width / 2 - 130, btn1Y, 'ts_icon6').setScale(0.5).setDepth(15);
      hordeBtn.container.add(shieldIcon);
      shieldIcon.setPosition(-130, 0);
    }

    const pvpBtn = this.createMedievalButton(width / 2, btn2Y, 320, 60, 'HORDE PVP', 'red', true);
    pvpBtn.container.setAlpha(0).setScale(0.5);
    this.tweens.add({ targets: pvpBtn.container, alpha: 1, scaleX: 1, scaleY: 1, duration: 600, delay: 850, ease: 'Back.easeOut' });
    pvpBtn.zone.on('pointerdown', () => this.findHordeMatch());

    // Sword icon on PvP button
    if (this.textures.exists('ts_icon5')) {
      const swordIcon = this.add.image(0, 0, 'ts_icon5').setScale(0.45).setDepth(15);
      pvpBtn.container.add(swordIcon);
      swordIcon.setPosition(-130, 0);
    }

    const charBtn = this.createMedievalButton(width / 2, btn3Y, 320, 60, 'CHARACTERS', 'blue', false);
    charBtn.container.setAlpha(0).setScale(0.5);
    this.tweens.add({ targets: charBtn.container, alpha: 1, scaleX: 1, scaleY: 1, duration: 600, delay: 1000, ease: 'Back.easeOut' });
    charBtn.zone.on('pointerdown', () => {
      this.cameras.main.fadeOut(300, 20, 35, 15);
      this.cameras.main.once('camerafadeoutcomplete', () => {
        this.scene.start('CharactersScene');
      });
    });

    // Info icon on characters button
    if (this.textures.exists('ts_icon11')) {
      const infoIcon = this.add.image(0, 0, 'ts_icon11').setScale(0.45).setDepth(15);
      charBtn.container.add(infoIcon);
      infoIcon.setPosition(-130, 0);
    }

    // Keyboard shortcut
    const hint = this.add.text(width / 2, btn3Y + 42, 'Press ENTER to start horde mode', {
      fontSize: '11px', color: '#a89870', fontFamily: '"Nunito", sans-serif', fontStyle: '600',
      stroke: '#2a1a0a', strokeThickness: 2,
    }).setOrigin(0.5).setAlpha(0).setDepth(11);
    this.tweens.add({ targets: hint, alpha: 0.7, duration: 600, delay: 1000 });
    this.input.keyboard!.on('keydown-ENTER', () => this.startHordeMode());

    // Status text
    this.statusText = this.add.text(width / 2, statusY, '', {
      fontSize: '16px', color: '#FFD93D', fontFamily: '"Nunito", sans-serif', fontStyle: 'bold',
      stroke: '#4a3520', strokeThickness: 3,
    }).setOrigin(0.5).setDepth(11);

    // === HOW TO PLAY — parchment scroll style ===
    const howContainer = this.add.container(width / 2, howToPlayY).setDepth(11);

    // Parchment background
    const parchBg = this.add.graphics();
    parchBg.fillStyle(0xd4c4a0, 0.85);
    parchBg.fillRoundedRect(-200, -15, 400, 115, 8);
    parchBg.lineStyle(2, 0x8B7355, 0.8);
    parchBg.strokeRoundedRect(-200, -15, 400, 115, 8);
    howContainer.add(parchBg);

    const howTitle = this.add.text(0, -5, 'HOW TO PLAY', {
      fontSize: '13px', color: '#6B4226', fontFamily: '"Fredoka", sans-serif', fontStyle: 'bold',
      letterSpacing: 3,
    }).setOrigin(0.5);
    howContainer.add(howTitle);

    const steps = [
      { icon: '1', text: 'Draft 3 characters (class + animal combo)' },
      { icon: '2', text: 'Type or speak commands to control them' },
      { icon: '3', text: 'Capture & hold control points to win!' },
    ];

    steps.forEach((step, i) => {
      const y = 22 + i * 26;
      // Step number in a wooden circle
      const circle = this.add.graphics();
      circle.fillStyle(0x8B7355, 0.9);
      circle.fillCircle(-180, y, 10);
      circle.fillStyle(0xd4c4a0, 0.9);
      circle.fillCircle(-180, y, 8);
      howContainer.add(circle);

      const num = this.add.text(-180, y, step.icon, {
        fontSize: '11px', color: '#4a3520', fontFamily: '"Fredoka", sans-serif', fontStyle: 'bold',
      }).setOrigin(0.5);
      howContainer.add(num);

      const txt = this.add.text(-160, y, step.text, {
        fontSize: '12px', color: '#4a3520', fontFamily: '"Nunito", sans-serif', fontStyle: '600',
      }).setOrigin(0, 0.5);
      howContainer.add(txt);
    });

    howContainer.setAlpha(0);
    this.tweens.add({ targets: howContainer, alpha: 1, duration: 800, delay: 1200 });

    // Version
    this.add.text(width / 2, height - 18, 'v0.2.0  |  Prompt Battle — Tiny Swords Edition', {
      fontSize: '10px', color: '#6a5a4a', fontFamily: '"Nunito", sans-serif',
      stroke: '#1a0e05', strokeThickness: 2,
    }).setOrigin(0.5).setDepth(11);

    // === CASTLE decorations in corners ===
    if (this.textures.exists('ts_castle_blue')) {
      this.add.image(80, height - 60, 'ts_castle_blue').setScale(0.3).setAlpha(0.25).setDepth(2);
    }
    if (this.textures.exists('ts_castle_red')) {
      this.add.image(width - 80, height - 60, 'ts_castle_red').setScale(0.3).setAlpha(0.25).setDepth(2);
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
    // Float various Tiny Swords icons across the background
    const iconKeys = ['ts_icon1', 'ts_icon2', 'ts_icon3', 'ts_icon4', 'ts_icon5', 'ts_icon6', 'ts_icon10'];
    const available = iconKeys.filter(k => this.textures.exists(k));
    if (available.length === 0) return;

    for (let i = 0; i < 15; i++) {
      const key = available[i % available.length];
      const x = Math.random() * width;
      const y = Math.random() * height;
      const img = this.add.image(x, y, key)
        .setScale(0.35 + Math.random() * 0.25)
        .setAlpha(0.06 + Math.random() * 0.06)
        .setDepth(2)
        .setAngle(Math.random() * 360);

      this.tweens.add({
        targets: img,
        alpha: { from: img.alpha, to: img.alpha * 0.3 },
        scaleX: { from: img.scaleX, to: img.scaleX * 1.15 },
        scaleY: { from: img.scaleY, to: img.scaleY * 1.15 },
        duration: 3000 + Math.random() * 4000,
        yoyo: true, repeat: -1, ease: 'Sine.easeInOut',
        delay: Math.random() * 2000,
      });

      this.floatingShapes.push({
        sprite: img,
        vx: (Math.random() - 0.5) * 0.25,
        vy: (Math.random() - 0.5) * 0.2,
        rot: (Math.random() - 0.5) * 0.15,
      });
    }
  }

  private createMedievalButton(
    x: number, y: number, w: number, h: number,
    label: string, color: 'green' | 'red' | 'blue', isPrimary: boolean
  ): { container: Phaser.GameObjects.Container; zone: Phaser.GameObjects.Zone } {
    const container = this.add.container(x, y).setDepth(12);

    // Color schemes
    const schemes = {
      green: { fill: 0x45703a, border: 0x6B9B5E, highlight: 0x8BC47A, text: '#e8dcc4' },
      red:   { fill: 0x8B3A3A, border: 0xBB5555, highlight: 0xDD7777, text: '#e8dcc4' },
      blue:  { fill: 0x3A5A8B, border: 0x5588BB, highlight: 0x77AADD, text: '#e8dcc4' },
    };
    const s = schemes[color];

    // Drop shadow
    const shadow = this.add.graphics();
    shadow.fillStyle(0x000000, 0.4);
    shadow.fillRoundedRect(-w / 2 + 4, -h / 2 + 4, w, h, 8);
    container.add(shadow);

    // Wood-textured button background
    const bg = this.add.graphics();
    // Base fill
    bg.fillStyle(s.fill, 0.9);
    bg.fillRoundedRect(-w / 2, -h / 2, w, h, 8);
    // Inner lighter stripe (wood grain effect)
    bg.fillStyle(s.highlight, 0.15);
    bg.fillRoundedRect(-w / 2 + 4, -h / 2 + 3, w - 8, h / 3, 4);
    // Border — thick medieval style
    bg.lineStyle(3, s.border, 1);
    bg.strokeRoundedRect(-w / 2, -h / 2, w, h, 8);
    // Inner border for depth
    bg.lineStyle(1, 0x000000, 0.2);
    bg.strokeRoundedRect(-w / 2 + 3, -h / 2 + 3, w - 6, h - 6, 6);
    container.add(bg);

    // Corner rivets
    const rivetPositions = [
      [-w / 2 + 10, -h / 2 + 10], [w / 2 - 10, -h / 2 + 10],
      [-w / 2 + 10, h / 2 - 10], [w / 2 - 10, h / 2 - 10],
    ];
    const rivets = this.add.graphics();
    for (const [rx, ry] of rivetPositions) {
      rivets.fillStyle(0x000000, 0.3);
      rivets.fillCircle(rx + 1, ry + 1, 3);
      rivets.fillStyle(0xc8b890, 0.9);
      rivets.fillCircle(rx, ry, 3);
      rivets.fillStyle(0xffffff, 0.3);
      rivets.fillCircle(rx - 1, ry - 1, 1.5);
    }
    container.add(rivets);

    // Button text
    const text = this.add.text(0, -1, label, {
      fontSize: '19px', color: s.text, fontFamily: '"Fredoka", sans-serif', fontStyle: 'bold',
      letterSpacing: 2, stroke: '#1a0e05', strokeThickness: 3,
    }).setOrigin(0.5);
    container.add(text);

    // Idle breathing for primary buttons
    if (isPrimary) {
      this.tweens.add({
        targets: container,
        scaleX: { from: 1, to: 1.015 }, scaleY: { from: 1, to: 1.015 },
        duration: 1400, yoyo: true, repeat: -1, ease: 'Sine.easeInOut',
      });
    }

    // Interactive zone
    const zone = this.add.zone(x, y, w, h).setInteractive({ useHandCursor: true }).setDepth(13);

    zone.on('pointerover', () => {
      this.tweens.add({ targets: container, scaleX: 1.06, scaleY: 1.06, duration: 150, ease: 'Back.easeOut' });
      bg.clear();
      bg.fillStyle(s.highlight, 0.5);
      bg.fillRoundedRect(-w / 2, -h / 2, w, h, 8);
      bg.fillStyle(0xffffff, 0.08);
      bg.fillRoundedRect(-w / 2 + 4, -h / 2 + 3, w - 8, h / 3, 4);
      bg.lineStyle(3, 0xFFD93D, 1);
      bg.strokeRoundedRect(-w / 2, -h / 2, w, h, 8);
      bg.lineStyle(1, 0x000000, 0.2);
      bg.strokeRoundedRect(-w / 2 + 3, -h / 2 + 3, w - 6, h - 6, 6);
      text.setColor('#FFD93D');
    });

    zone.on('pointerout', () => {
      this.tweens.add({ targets: container, scaleX: 1, scaleY: 1, duration: 150 });
      bg.clear();
      bg.fillStyle(s.fill, 0.9);
      bg.fillRoundedRect(-w / 2, -h / 2, w, h, 8);
      bg.fillStyle(s.highlight, 0.15);
      bg.fillRoundedRect(-w / 2 + 4, -h / 2 + 3, w - 8, h / 3, 4);
      bg.lineStyle(3, s.border, 1);
      bg.strokeRoundedRect(-w / 2, -h / 2, w, h, 8);
      bg.lineStyle(1, 0x000000, 0.2);
      bg.strokeRoundedRect(-w / 2 + 3, -h / 2 + 3, w - 6, h - 6, 6);
      text.setColor(s.text);
    });

    zone.on('pointerdown', () => {
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
        this.statusText.setText('Match found!');
        this.statusText.setColor('#8BC47A');

        this.cameras.main.flash(300, 139, 196, 122, false);

        this.time.delayedCall(800, () => {
          this.cameras.main.fadeOut(400, 20, 35, 15);
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
      this.statusText.setColor('#DD7777');
    }
  }

  private startJungleLane() {
    this.cameras.main.fadeOut(400, 20, 35, 15);
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
    overlay.fillStyle(0x0a0a0a, 0.75);
    overlay.fillRect(-width / 2, -height / 2, width, height);
    container.add(overlay);

    // Title on parchment ribbon
    const titleBg = this.add.graphics();
    titleBg.fillStyle(0x8B7355, 0.9);
    titleBg.fillRoundedRect(-160, -height * 0.35 - 22, 320, 44, 6);
    titleBg.fillStyle(0xd4c4a0, 0.9);
    titleBg.fillRoundedRect(-155, -height * 0.35 - 19, 310, 38, 4);
    container.add(titleBg);

    const title = this.add.text(0, -height * 0.35, 'CHOOSE YOUR MAP', {
      fontSize: '24px', color: '#4a3520', fontFamily: '"Fredoka", sans-serif', fontStyle: 'bold',
      letterSpacing: 2,
    }).setOrigin(0.5);
    container.add(title);

    // Map cards — parchment style
    const cardW = 260, cardH = 140, gap = 20;
    const totalW = maps.length * cardW + (maps.length - 1) * gap;
    const startX = -totalW / 2 + cardW / 2;
    const cardY = -20;

    const cardColors = [
      { fill: 0x45703a, border: 0x6B9B5E, accent: '#8BC47A' },
      { fill: 0x3A5A8B, border: 0x5588BB, accent: '#77AADD' },
      { fill: 0x8B6B3A, border: 0xBB9955, accent: '#DDBB77' },
      { fill: 0x6B3A6B, border: 0x9955AA, accent: '#BB77CC' },
    ];

    maps.forEach((map, i) => {
      const cx = startX + i * (cardW + gap);
      const cc = cardColors[i % cardColors.length];

      // Card shadow
      const cardShadow = this.add.graphics();
      cardShadow.fillStyle(0x000000, 0.5);
      cardShadow.fillRoundedRect(cx - cardW / 2 + 5, cardY - cardH / 2 + 5, cardW, cardH, 8);
      container.add(cardShadow);

      // Card — parchment with colored border
      const bg = this.add.graphics();
      bg.fillStyle(0xd4c4a0, 0.92);
      bg.fillRoundedRect(cx - cardW / 2, cardY - cardH / 2, cardW, cardH, 8);
      // Colored header stripe
      bg.fillStyle(cc.fill, 0.8);
      bg.fillRoundedRect(cx - cardW / 2, cardY - cardH / 2, cardW, 36, { tl: 8, tr: 8, bl: 0, br: 0 });
      bg.lineStyle(3, cc.border, 1);
      bg.strokeRoundedRect(cx - cardW / 2, cardY - cardH / 2, cardW, cardH, 8);
      container.add(bg);

      // Map name — in the colored header
      const nameText = this.add.text(cx, cardY - cardH / 2 + 18, map.name, {
        fontSize: '16px', color: '#e8dcc4', fontFamily: '"Fredoka", sans-serif', fontStyle: 'bold',
        stroke: '#1a0e05', strokeThickness: 2,
      }).setOrigin(0.5);
      container.add(nameText);

      // Description — on parchment body
      const descText = this.add.text(cx, cardY + 5, map.description, {
        fontSize: '11px', color: '#4a3520', fontFamily: '"Nunito", sans-serif',
        wordWrap: { width: cardW - 24 }, align: 'center',
      }).setOrigin(0.5, 0);
      container.add(descText);

      // Camp count — accent colored
      const slotsText = this.add.text(cx, cardY + cardH / 2 - 18, `${map.campSlots.length * 2 + (map.trollSlot ? 1 : 0)} camps`, {
        fontSize: '10px', color: cc.accent, fontFamily: '"Nunito", sans-serif', fontStyle: 'bold',
        stroke: '#1a0e05', strokeThickness: 2,
      }).setOrigin(0.5);
      container.add(slotsText);

      // Interactive zone
      const zone = this.add.zone(width / 2 + cx, height / 2 + cardY, cardW, cardH)
        .setInteractive({ useHandCursor: true }).setDepth(201);
      this.mapPickerZones.push(zone);

      zone.on('pointerover', () => {
        bg.clear();
        bg.fillStyle(0xe8dcc4, 0.95);
        bg.fillRoundedRect(cx - cardW / 2, cardY - cardH / 2, cardW, cardH, 8);
        bg.fillStyle(cc.fill, 0.95);
        bg.fillRoundedRect(cx - cardW / 2, cardY - cardH / 2, cardW, 36, { tl: 8, tr: 8, bl: 0, br: 0 });
        bg.lineStyle(3, 0xFFD93D, 1);
        bg.strokeRoundedRect(cx - cardW / 2, cardY - cardH / 2, cardW, cardH, 8);
      });
      zone.on('pointerout', () => {
        bg.clear();
        bg.fillStyle(0xd4c4a0, 0.92);
        bg.fillRoundedRect(cx - cardW / 2, cardY - cardH / 2, cardW, cardH, 8);
        bg.fillStyle(cc.fill, 0.8);
        bg.fillRoundedRect(cx - cardW / 2, cardY - cardH / 2, cardW, 36, { tl: 8, tr: 8, bl: 0, br: 0 });
        bg.lineStyle(3, cc.border, 1);
        bg.strokeRoundedRect(cx - cardW / 2, cardY - cardH / 2, cardW, cardH, 8);
      });
      zone.on('pointerdown', () => this.selectMap(map.id));
    });

    // Back button — medieval styled
    const backY = cardY + cardH / 2 + 55;
    const backBg = this.add.graphics();
    backBg.fillStyle(0x8B3A3A, 0.8);
    backBg.fillRoundedRect(-50, backY - 15, 100, 30, 6);
    backBg.lineStyle(2, 0xBB5555, 0.9);
    backBg.strokeRoundedRect(-50, backY - 15, 100, 30, 6);
    container.add(backBg);

    const backText = this.add.text(0, backY, 'BACK', {
      fontSize: '14px', color: '#e8dcc4', fontFamily: '"Fredoka", sans-serif', fontStyle: 'bold',
      stroke: '#1a0e05', strokeThickness: 2,
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
    backZone.on('pointerover', () => {
      backBg.clear();
      backBg.fillStyle(0xBB5555, 0.9);
      backBg.fillRoundedRect(-50, backY - 15, 100, 30, 6);
      backBg.lineStyle(2, 0xFFD93D, 1);
      backBg.strokeRoundedRect(-50, backY - 15, 100, 30, 6);
    });
    backZone.on('pointerout', () => {
      backBg.clear();
      backBg.fillStyle(0x8B3A3A, 0.8);
      backBg.fillRoundedRect(-50, backY - 15, 100, 30, 6);
      backBg.lineStyle(2, 0xBB5555, 0.9);
      backBg.strokeRoundedRect(-50, backY - 15, 100, 30, 6);
    });

    // Animate in
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

    this.cameras.main.fadeOut(400, 20, 35, 15);
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
        this.statusText.setText('Opponent found! Starting Horde PvP...');
        this.statusText.setColor('#8BC47A');

        this.cameras.main.flash(300, 139, 159, 67, false);

        this.time.delayedCall(800, () => {
          this.cameras.main.fadeOut(400, 20, 35, 15);
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
      this.statusText.setColor('#DD7777');
    }
  }

  private async startLocalTest() {
    this.statusText.setText('Starting local test...');
    this.tweens.add({ targets: this.statusText, alpha: { from: 0, to: 1 }, duration: 300 });

    try {
      const firebase = FirebaseSync.getInstance();
      await firebase.initialize();

      const gameId = await firebase.createLocalGame();

      this.cameras.main.fadeOut(400, 20, 35, 15);
      this.cameras.main.once('camerafadeoutcomplete', () => {
        this.scene.start('DraftScene', {
          gameId,
          playerId: firebase.getPlayerId(),
          isLocal: true,
        });
      });
    } catch (err) {
      this.statusText.setText('Error: ' + (err as Error).message);
      this.statusText.setColor('#DD7777');
    }
  }
}
