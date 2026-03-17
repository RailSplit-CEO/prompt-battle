import Phaser from 'phaser';
import { FirebaseSync } from '../network/FirebaseSync';
import { Matchmaking } from '../network/Matchmaking';
import { SettingsPanel } from '../systems/SettingsPanel';
import { GameSettings } from '../systems/GameSettings';
import { AuthManager } from '../auth/AuthManager';
import { FriendsPanel } from '../ui/FriendsPanel';
import { MatchHistoryPanel } from '../ui/MatchHistoryPanel';
import { MatchInvitePopup } from '../ui/MatchInvitePopup';
import { createIconElement } from '../ui/FriendsPanel';
import { C } from '../ui/UIColors';
import { StorePanel } from '../ui/StorePanel';
import { HORDE_SPRITE_CONFIGS } from '../sprites/SpriteConfig';

export class MenuScene extends Phaser.Scene {
  private matchmaking!: Matchmaking;
  private statusText!: Phaser.GameObjects.Text;
  private floatingShapes: { sprite: Phaser.GameObjects.Image; vx: number; vy: number; rot: number }[] = [];
  private muted: boolean = GameSettings.getInstance().get('muteAll');
  private settingsPanel = new SettingsPanel();
  private _resizeTimer: number | null = null;
  private _resizeHandler: (() => void) | null = null;
  private profileCardEl: HTMLDivElement | null = null;
  private friendsPanel: FriendsPanel | null = null;
  private matchHistoryPanel: MatchHistoryPanel | null = null;
  private matchInvitePopup: MatchInvitePopup | null = null;
  private friendsUnsub: (() => void) | null = null;
  private invitesUnsub: (() => void) | null = null;
  private vignetteTimer?: Phaser.Time.TimerEvent;

  constructor() {
    super({ key: 'MenuScene' });
  }

  create() {
    // Rebuild layout on window resize (debounced)
    this._resizeHandler = () => {
      if (this._resizeTimer !== null) clearTimeout(this._resizeTimer);
      this._resizeTimer = window.setTimeout(() => { this.scene.restart(); }, 200);
    };
    this.scale.on('resize', this._resizeHandler);
    this.events.once('shutdown', () => {
      if (this._resizeHandler) this.scale.off('resize', this._resizeHandler);
      if (this._resizeTimer !== null) clearTimeout(this._resizeTimer);
      this.cleanupSocialUI();
    });
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

    // === BACKGROUND UNIT VIGNETTES ===
    this.startBackgroundVignettes();

    // === VERTICALLY CENTERED LAYOUT ===
    const centerY = height / 2;
    const titleY = centerY - 220;
    const subtitleY = titleY + 58;
    const dividerY = subtitleY + 28;
    const btn1Y = dividerY + 60;
    const btn2Y = btn1Y + 68;
    const btn3Y = btn2Y + 68;
    const btnStoreY = btn3Y + 68;
    const btn4Y = btnStoreY + 68;
    const howToPlayY = btn4Y + 75;

    // === TITLE ===
    // Sword decorations on each side of title
    if (this.textures.exists('ts_icon5')) {
      const swordL = this.add.image(width / 2 - 270, titleY + 5, 'ts_icon5')
        .setScale(1.0).setDepth(10).setAngle(-30).setAlpha(0.7);
      const swordR = this.add.image(width / 2 + 270, titleY + 5, 'ts_icon5')
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

    if (this.textures.exists('ts_icon5')) {
      const soloSword = this.add.image(0, 0, 'ts_icon5').setScale(0.65).setDepth(15);
      hordeBtn.container.add(soloSword);
      soloSword.setPosition(-120, 0);
    }

    const pvpBtn = this.createMedievalButton(width / 2, btn2Y, 340, 54, 'HORDE PVP', 'red', true);
    pvpBtn.container.setAlpha(0).setScale(0.5);
    this.tweens.add({ targets: pvpBtn.container, alpha: 1, scaleX: 1, scaleY: 1, duration: 600, delay: 850, ease: 'Back.easeOut' });
    pvpBtn.zone.on('pointerdown', () => this.findHordeMatch());

    if (this.textures.exists('ts_icon5')) {
      // Crossed swords — two copies angled and overlapping
      const swordL = this.add.image(0, 0, 'ts_icon5').setScale(0.55).setDepth(15).setAngle(0);
      const swordR = this.add.image(0, 0, 'ts_icon5').setScale(0.55).setDepth(15).setAngle(0).setFlipX(true);
      pvpBtn.container.add(swordL);
      pvpBtn.container.add(swordR);
      swordL.setPosition(-121, 0);
      swordR.setPosition(-119, 0);
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

    if (this.textures.exists('ts_icon3')) {
      const charIcon = this.add.image(0, 0, 'ts_icon3').setScale(0.85).setDepth(15);
      charBtn.container.add(charIcon);
      charIcon.setPosition(-120, 0);
    }

    // ═══ STORE BUTTON ═══
    const storeBtn = this.createMedievalButton(width / 2, btnStoreY, 340, 54, 'STORE', 'yellow', false);
    storeBtn.container.setAlpha(0).setScale(0.5);
    this.tweens.add({ targets: storeBtn.container, alpha: 1, scaleX: 1, scaleY: 1, duration: 600, delay: 1050, ease: 'Back.easeOut' });
    if (this.textures.exists('ts_icon1')) {
      const storeIcon = this.add.image(0, 0, 'ts_icon1').setScale(0.65).setDepth(15);
      storeBtn.container.add(storeIcon);
      storeIcon.setPosition(-120, 0);
    }
    storeBtn.zone.on('pointerdown', () => {
      const store = new StorePanel();
      store.open();
    });

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

    // Settings gear button (top-right area, left of profile card)
    const gearContainer = this.add.container(36, 36).setDepth(20);
    const gearBg = this.add.graphics();
    gearBg.fillStyle(0x243a18, 0.85);
    gearBg.fillCircle(0, 0, 22);
    gearBg.lineStyle(2, 0x5a9a4e, 0.6);
    gearBg.strokeCircle(0, 0, 22);
    gearContainer.add(gearBg);

    const gearText = this.add.text(0, 0, '\u2699', {
      fontSize: '22px', color: '#a89870',
    }).setOrigin(0.5);
    gearContainer.add(gearText);

    const gearZone = this.add.zone(36, 36, 48, 48)
      .setInteractive({ useHandCursor: true }).setDepth(21);
    gearZone.on('pointerover', () => {
      gearText.setColor('#FFD93D');
      gearBg.clear();
      gearBg.fillStyle(0x3a5a28, 0.95);
      gearBg.fillCircle(0, 0, 22);
      gearBg.lineStyle(2, 0xFFD93D, 0.8);
      gearBg.strokeCircle(0, 0, 22);
    });
    gearZone.on('pointerout', () => {
      gearText.setColor('#a89870');
      gearBg.clear();
      gearBg.fillStyle(0x243a18, 0.85);
      gearBg.fillCircle(0, 0, 22);
      gearBg.lineStyle(2, 0x5a9a4e, 0.6);
      gearBg.strokeCircle(0, 0, 22);
    });
    gearZone.on('pointerdown', () => {
      this.playsfx('button_click', 0.4);
      this.settingsPanel.toggle();
      if (this.settingsPanel.isOpen) {
        this.blockGameInput();
        // Watch for settings panel close to unblock
        const checkClose = setInterval(() => {
          if (!this.settingsPanel.isOpen) {
            clearInterval(checkClose);
            this.unblockGameInput();
          }
        }, 200);
      }
    });

    gearContainer.setAlpha(0);
    this.tweens.add({ targets: gearContainer, alpha: 1, duration: 600, delay: 1400 });

    // Version
    this.add.text(width / 2, height - 18, 'v0.2.0  |  Mark My Hordes', {
      fontSize: '10px', color: '#3a4a2a', fontFamily: '"Nunito", sans-serif',
      stroke: '#0a0f06', strokeThickness: 2,
    }).setOrigin(0.5).setDepth(11);

    // === SOCIAL UI (DOM overlay) ===
    this.setupSocialUI();

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

  // === BACKGROUND UNIT VIGNETTES ===

  // Unit speeds from game data, used to scale walk speed + anim sync
  private static readonly VIGNETTE_UNITS: { type: string; speed: number; tier: number }[] = [
    { type: 'gnome',    speed: 210, tier: 1 },
    { type: 'turtle',   speed: 55,  tier: 1 },
    { type: 'skull',    speed: 155, tier: 2 },
    { type: 'spider',   speed: 140, tier: 2 },
    { type: 'hyena',    speed: 175, tier: 2 },
    { type: 'rogue',    speed: 200, tier: 2 },
    { type: 'panda',    speed: 80,  tier: 3 },
    { type: 'lizard',   speed: 110, tier: 3 },
    { type: 'minotaur', speed: 105, tier: 4 },
    { type: 'shaman',   speed: 95,  tier: 4 },
    { type: 'troll',    speed: 50,  tier: 5 },
  ];

  // Rarity weights by tier: T1 45%, T2 20%, T3 15%, T4 12%, T5 8%
  private static readonly TIER_WEIGHTS: Record<number, number> = { 1: 45, 2: 20, 3: 15, 4: 12, 5: 8 };

  private startBackgroundVignettes() {
    // Filter to units whose walk anim texture is loaded
    const available = MenuScene.VIGNETTE_UNITS.filter(
      u => this.textures.exists(HORDE_SPRITE_CONFIGS[u.type]?.walk.key)
    );
    if (available.length === 0) return;

    // Build weighted pool
    this._vignettePool = [];
    for (const u of available) {
      const w = MenuScene.TIER_WEIGHTS[u.tier] || 5;
      for (let i = 0; i < w; i++) this._vignettePool.push(u);
    }

    const spawn = () => this.spawnVignette();

    // First one after 2s, then every 5s
    this.time.delayedCall(2000, spawn);
    this.vignetteTimer = this.time.addEvent({ delay: 5000, loop: true, callback: spawn });
  }

  private _vignettePool: { type: string; speed: number; tier: number }[] = [];

  private spawnVignette() {
    if (this._vignettePool.length === 0) return;
    const { width, height } = this.cameras.main;
    const pick = this._vignettePool[Math.floor(Math.random() * this._vignettePool.length)];
    const cfg = HORDE_SPRITE_CONFIGS[pick.type];
    const walkKey = cfg.walk.key;
    const animKey = `h_${pick.type}_walk`;

    // Edge positions
    const edges = [
      { x: -50, y: height * (0.3 + Math.random() * 0.4) },   // left
      { x: width + 50, y: height * (0.3 + Math.random() * 0.4) }, // right
      { x: width * (0.2 + Math.random() * 0.6), y: -50 },    // top
      { x: width * (0.2 + Math.random() * 0.6), y: height + 50 }, // bottom
    ];
    const entryIdx = Math.floor(Math.random() * 4);
    let exitIdx = Math.floor(Math.random() * 3);
    if (exitIdx >= entryIdx) exitIdx++;
    const start = edges[entryIdx];
    const exit = edges[exitIdx];

    // Carrot in middle area but offset from center menu column
    const side = Math.random() < 0.5 ? -1 : 1;
    const carrotX = width / 2 + side * (200 + Math.random() * 150);
    const carrotY = height * 0.35 + Math.random() * height * 0.35;

    // Pickup point — stop 30px short of carrot
    const angleToCarrot = Math.atan2(carrotY - start.y, carrotX - start.x);
    const pickupX = carrotX - Math.cos(angleToCarrot) * 30;
    const pickupY = carrotY - Math.sin(angleToCarrot) * 30;

    // Walk speed derived from game speed — scale to screen px/s
    // Game speeds range 50-210; map to ~40-170 px/s on screen
    const gameSpeed = pick.speed;
    const screenSpeed = (gameSpeed / 210) * 170 + 15;

    // Anim timeScale — sync animation pace to movement speed
    // Base anim (20fps) feels right at gnome speed (210). Scale proportionally.
    // Floor at 0.45 so slow units (turtle/troll) don't look frozen
    const animTimeScale = Math.max(0.45, gameSpeed / 210);

    // Random resource drop: 80% carrot, 10% meat, 5% crystal, 5% metal
    const roll = Math.random();
    const emoji = roll < 0.80 ? '🥕' : roll < 0.90 ? '🍖' : roll < 0.95 ? '💎' : '⚙️';

    // Create resource emoji — sits on ground
    const carrot = this.add.text(carrotX, carrotY, emoji, { fontSize: '18px' })
      .setOrigin(0.5).setDepth(2).setAlpha(0.55);
    this.tweens.add({
      targets: carrot, y: carrotY - 3,
      duration: 1000, yoyo: true, repeat: -1, ease: 'Sine.easeInOut',
    });

    // Create unit sprite — above carrot
    const unit = this.add.sprite(start.x, start.y, walkKey)
      .setDepth(3).setAlpha(0.55).setScale(cfg.displayScale * 0.5);
    if (carrotX < start.x) unit.setFlipX(true);
    if (this.anims.exists(animKey)) {
      unit.play(animKey);
      unit.anims.timeScale = animTimeScale;
    }

    // Dragged carrot physics state
    let dragX = 0, dragY = 0, dragVx = 0, dragVy = 0;
    let bouncePhase = Math.random() * Math.PI * 2;

    // Step 1: walk to pickup point near carrot
    const distToPickup = Math.hypot(pickupX - start.x, pickupY - start.y);
    this.tweens.add({
      targets: unit, x: pickupX, y: pickupY,
      duration: (distToPickup / screenSpeed) * 1000, ease: 'Linear',
      onComplete: () => {
        if (!unit.active) return;

        // Immediately flip for exit direction & start walking out
        unit.setFlipX(exit.x < pickupX);

        // Shrink carrot emoji for carrying
        this.tweens.killTweensOf(carrot);
        carrot.setFontSize(12).setAlpha(0.5);
        dragX = carrot.x;
        dragY = carrot.y;

        const distToExit = Math.hypot(exit.x - pickupX, exit.y - pickupY);

        // Tween unit to exit
        this.tweens.add({
          targets: unit, x: exit.x, y: exit.y,
          duration: (distToExit / screenSpeed) * 1000, ease: 'Linear',
          onUpdate: () => {
            if (!carrot.active || !unit.active) return;
            // Dragged/pulled item with springy bounce — trails far behind
            const trailDist = 35;
            const dx = unit.flipX ? trailDist : -trailDist;
            const targetX = unit.x + dx;
            const targetY = unit.y + 12;

            // Soft spring — low stiffness + damping = laggy drag
            const springK = 0.08;
            const damping = 0.82;
            dragVx = (dragVx + (targetX - dragX) * springK) * damping;
            dragVy = (dragVy + (targetY - dragY) * springK) * damping;
            dragX += dragVx;
            dragY += dragVy;

            // Bounce wobble
            bouncePhase += 0.18;
            const bounce = Math.sin(bouncePhase) * 3;

            carrot.setPosition(dragX, dragY + bounce);
          },
          onComplete: () => {
            unit.destroy();
            if (carrot.active) carrot.destroy();
          },
        });
      },
    });
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

  private async startHordeMode() {
    this.playsfx('wave_start', 0.4);
    try {
      const firebase = FirebaseSync.getInstance();
      await firebase.initialize();
      const gameId = await firebase.createSoloGame();

      this.cameras.main.fadeOut(400, 15, 26, 10);
      this.cameras.main.once('camerafadeoutcomplete', () => {
        this.cleanupSocialUI();
        this.scene.start('HordeScene', {
          isOnline: true,
          gameId,
          playerId: firebase.getPlayerId(),
          amPlayer1: true,
        });
      });
    } catch (err) {
      console.error('[MenuScene] Failed to create solo game:', err);
      // Fallback to local mode if server is unavailable
      this.cameras.main.fadeOut(400, 15, 26, 10);
      this.cameras.main.once('camerafadeoutcomplete', () => {
        this.scene.start('HordeScene', { mapId: 'default' });
      });
    }
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

        // Fetch opponent UID from game meta for match history
        let opponentUid: string | undefined;
        try {
          const meta = await firebase.getGameMeta(matchResult.gameId);
          opponentUid = matchResult.amPlayer1 ? meta.player2 : meta.player1;
        } catch { /* non-critical */ }

        this.time.delayedCall(800, () => {
          this.cleanupSocialUI();
          this.cameras.main.fadeOut(400, 15, 26, 10);
          this.cameras.main.once('camerafadeoutcomplete', () => {
            this.scene.start('HordeScene', {
              isOnline: true,
              gameId: matchResult.gameId,
              playerId: firebase.getPlayerId(),
              amPlayer1: matchResult.amPlayer1,
              opponentUid,
            });
          });
        });
      }
    } catch (err) {
      this.statusText.setText('Error: ' + (err as Error).message);
      this.statusText.setColor('#BB4444');
    }
  }

  private setupSocialUI() {
    const auth = AuthManager.getInstance();

    // === TOP-RIGHT VERTICAL ACCOUNT PANEL (DOM overlay) ===
    this.profileCardEl = document.createElement('div');
    this.profileCardEl.id = 'menu-profile-card';
    this.profileCardEl.style.cssText = `
      position:fixed;top:16px;right:16px;z-index:100;
      display:flex;flex-direction:column;align-items:stretch;gap:0;
      padding:0;
      background:${C.panelBg};
      border:2px solid ${C.panelBorder};border-radius:14px;
      backdrop-filter:${C.panelBlur};-webkit-backdrop-filter:${C.panelBlur};
      font-family:"Nunito",sans-serif;
      opacity:0;transition:opacity 0.6s ease 0.8s;
      box-shadow:${C.panelShadow};
      overflow:hidden;width:240px;
    `;

    if (!auth.isGuest && auth.userProfile) {
      // Profile header — avatar + name + online dot
      const header = document.createElement('div');
      header.style.cssText = `
        display:flex;align-items:center;gap:10px;
        padding:12px 14px;
        background:rgba(255,217,61,0.06);
        border-bottom:1px solid ${C.divider};
      `;

      const iconEl = createIconElement(auth.userProfile.icon, 48);
      iconEl.style.borderRadius = '50%';
      iconEl.style.border = `2px solid ${C.gold}`;
      iconEl.style.flexShrink = '0';
      iconEl.style.boxShadow = '0 0 8px rgba(255,217,61,0.2)';
      header.appendChild(iconEl);

      const nameWrap = document.createElement('div');
      nameWrap.style.cssText = `display:flex;flex-direction:column;gap:2px;min-width:0;`;

      const nameEl = document.createElement('div');
      nameEl.textContent = auth.userProfile.username;
      nameEl.style.cssText = `font-size:15px;font-weight:700;color:${C.textH1};white-space:nowrap;`;
      nameWrap.appendChild(nameEl);

      const statusRow = document.createElement('div');
      statusRow.style.cssText = `display:flex;align-items:center;gap:5px;`;
      const dot = document.createElement('span');
      dot.style.cssText = `width:6px;height:6px;border-radius:50%;background:#45E6B0;box-shadow:0 0 6px rgba(69,230,176,0.5);`;
      statusRow.appendChild(dot);
      const statusText = document.createElement('span');
      statusText.textContent = 'Online';
      statusText.style.cssText = `font-size:10px;color:${C.teal};font-weight:600;`;
      statusRow.appendChild(statusText);
      nameWrap.appendChild(statusRow);

      header.appendChild(nameWrap);
      this.profileCardEl.appendChild(header);

      // Action buttons — distinct styled cards
      const btnList = document.createElement('div');
      btnList.style.cssText = `display:flex;flex-direction:column;gap:6px;padding:10px 10px 8px;`;

      const makeSocialBtn = (iconSrc: string, label: string, borderColor: string, glowColor: string, hoverBorder: string, onClick: () => void) => {
        const btn = document.createElement('button');
        const iconImg = `<img src="${iconSrc}" style="width:32px;height:32px;object-fit:contain;image-rendering:pixelated;flex-shrink:0;">`;
        btn.innerHTML = `${iconImg}<span style="flex:1;text-align:left;">${label}</span><span style="font-size:11px;color:${C.textMuted};transition:transform 0.15s;">&#x276F;</span>`;
        btn.style.cssText = `
          display:flex;align-items:center;gap:10px;
          padding:10px 12px;font-size:15px;font-weight:700;
          font-family:"Nunito",sans-serif;
          background:${C.surface};
          border:1.5px solid ${borderColor};
          color:${C.textPrimary};border-radius:8px;cursor:pointer;
          transition:all 0.2s;text-align:left;width:100%;
          box-shadow:0 1px 4px rgba(0,0,0,0.15);
        `;
        btn.onmouseenter = () => {
          btn.style.borderColor = hoverBorder;
          btn.style.background = C.surfaceHover;
          btn.style.boxShadow = `0 2px 10px ${glowColor}`;
          btn.style.transform = 'translateX(-2px)';
        };
        btn.onmouseleave = () => {
          btn.style.borderColor = borderColor;
          btn.style.background = C.surface;
          btn.style.boxShadow = '0 1px 4px rgba(0,0,0,0.15)';
          btn.style.transform = 'translateX(0)';
        };
        btn.onclick = onClick;
        return btn;
      };

      btnList.appendChild(makeSocialBtn(
        'assets/ui/icons/Icon_06.png', 'Friends',
        'rgba(69,230,176,0.3)', 'rgba(69,230,176,0.15)', C.teal,
        () => this.openFriendsPanel()
      ));

      btnList.appendChild(makeSocialBtn(
        'assets/ui/icons/Icon_11.png', 'History',
        'rgba(255,217,61,0.25)', 'rgba(255,217,61,0.12)', C.gold,
        () => this.openMatchHistory()
      ));

      this.profileCardEl.appendChild(btnList);

      // Sign out — small text link at bottom
      const signOutRow = document.createElement('div');
      signOutRow.style.cssText = `
        padding:4px 14px 8px;text-align:center;
        border-top:1px solid ${C.divider};
      `;
      const signOutBtn = document.createElement('button');
      signOutBtn.textContent = 'Sign Out';
      signOutBtn.style.cssText = `
        font-size:11px;font-weight:600;font-family:"Nunito",sans-serif;
        background:none;border:none;color:${C.textMuted};
        cursor:pointer;transition:color 0.15s;padding:4px 8px;
      `;
      signOutBtn.onmouseenter = () => { signOutBtn.style.color = C.red; };
      signOutBtn.onmouseleave = () => { signOutBtn.style.color = C.textMuted; };
      signOutBtn.onclick = async () => { await auth.signOut(); window.location.reload(); };
      signOutRow.appendChild(signOutBtn);
      this.profileCardEl.appendChild(signOutRow);
    } else {
      // Guest — compact card with sign in CTA
      const guestHeader = document.createElement('div');
      guestHeader.style.cssText = `
        display:flex;align-items:center;gap:10px;
        padding:12px 14px;
        border-bottom:1px solid ${C.divider};
      `;
      const guestIcon = document.createElement('span');
      guestIcon.textContent = '\u2694';
      guestIcon.style.cssText = `font-size:20px;opacity:0.4;`;
      guestHeader.appendChild(guestIcon);

      const guestName = document.createElement('div');
      guestName.textContent = 'Guest';
      guestName.style.cssText = `font-size:14px;font-weight:700;color:${C.textMuted};`;
      guestHeader.appendChild(guestName);
      this.profileCardEl.appendChild(guestHeader);

      const signInBtn = document.createElement('button');
      signInBtn.innerHTML = `<span style="font-size:14px;">&#x1F511;</span> Sign in with Google`;
      signInBtn.style.cssText = `
        display:flex;align-items:center;gap:8px;justify-content:center;
        margin:10px 12px 12px;padding:10px 14px;font-size:13px;font-weight:700;
        font-family:"Nunito",sans-serif;
        background:rgba(255,217,61,0.1);border:1.5px solid ${C.goldDim};
        color:${C.gold};border-radius:8px;cursor:pointer;
        transition:all 0.2s;
      `;
      signInBtn.onmouseenter = () => { signInBtn.style.background = 'rgba(255,217,61,0.18)'; signInBtn.style.borderColor = C.gold; signInBtn.style.transform = 'translateY(-1px)'; };
      signInBtn.onmouseleave = () => { signInBtn.style.background = 'rgba(255,217,61,0.1)'; signInBtn.style.borderColor = C.goldDim; signInBtn.style.transform = 'translateY(0)'; };
      signInBtn.onclick = async () => {
        try { await auth.linkGuestToGoogle(); window.location.reload(); } catch { /* cancelled */ }
      };
      this.profileCardEl.appendChild(signInBtn);
    }

    document.body.appendChild(this.profileCardEl);
    requestAnimationFrame(() => { if (this.profileCardEl) this.profileCardEl.style.opacity = '1'; });

    // === INVITE POPUP LISTENER (signed-in users only) ===
    if (!auth.isGuest && auth.userProfile) {
      this.matchInvitePopup = new MatchInvitePopup({
        onAccept: async (inviteId: string) => {
          const gameId = await auth.acceptInvite(inviteId);
          this.cleanupSocialUI();
          this.cameras.main.fadeOut(400, 15, 26, 10);
          this.cameras.main.once('camerafadeoutcomplete', () => {
            this.scene.start('HordeScene', {
              isOnline: true,
              gameId,
              playerId: auth.currentUser?.uid,
              amPlayer1: false,
            });
          });
          return gameId;
        },
        onDecline: async (inviteId: string) => {
          await auth.declineInvite(inviteId);
        },
      });

      this.invitesUnsub = auth.onIncomingInvites((invite) => {
        this.matchInvitePopup?.show({
          inviteId: invite.inviteId,
          fromUsername: invite.fromUsername,
          fromIcon: invite.fromIcon,
        });
      });
    }
  }

  /** Block Phaser canvas interaction while a DOM overlay is open */
  private blockGameInput() {
    const canvas = document.querySelector('#game-container canvas') as HTMLCanvasElement | null;
    if (canvas) canvas.style.pointerEvents = 'none';
  }

  /** Restore Phaser canvas interaction */
  private unblockGameInput() {
    const canvas = document.querySelector('#game-container canvas') as HTMLCanvasElement | null;
    if (canvas) canvas.style.pointerEvents = '';
  }

  private openFriendsPanel() {
    if (this.friendsPanel?.isOpen) { this.friendsPanel.close(); this.unblockGameInput(); return; }
    const auth = AuthManager.getInstance();

    this.friendsPanel = new FriendsPanel({
      onAddFriend: async (username: string) => {
        try {
          const target = await auth.searchByUsername(username);
          if (!target) return { success: false, error: 'User not found' };
          if (target.uid === auth.currentUser?.uid) return { success: false, error: "That's you!" };
          await auth.sendFriendRequest(target.uid);
          return { success: true };
        } catch (e) { return { success: false, error: (e as Error).message }; }
      },
      onAcceptRequest: (uid) => auth.acceptRequest(uid),
      onDeclineRequest: (uid) => auth.declineRequest(uid),
      onRemoveFriend: (uid) => auth.removeFriend(uid),
      onInvite: async (friendUid) => {
        const { inviteId, gameId } = await auth.sendInvite(friendUid);
        const response = await auth.waitForInviteResponse(friendUid, inviteId);
        if (response === 'accepted') {
          this.friendsPanel?.close();
          this.cleanupSocialUI();
          this.cameras.main.fadeOut(400, 15, 26, 10);
          this.cameras.main.once('camerafadeoutcomplete', () => {
            this.scene.start('HordeScene', {
              isOnline: true,
              gameId,
              playerId: auth.currentUser?.uid,
              amPlayer1: true,
              opponentUid: friendUid,
            });
          });
        }
      },
    });
    this.friendsPanel.open();
    this.blockGameInput();
    const checkFriendsClose = setInterval(() => {
      if (!this.friendsPanel?.isOpen) { clearInterval(checkFriendsClose); this.unblockGameInput(); }
    }, 200);

    // Feed friends data
    if (this.friendsUnsub) this.friendsUnsub();
    this.friendsUnsub = auth.onFriendsChanged((friends) => {
      this.friendsPanel?.updateFriends(friends);
    });
  }

  private async openMatchHistory() {
    if (this.matchHistoryPanel?.isOpen) { this.matchHistoryPanel.close(); this.unblockGameInput(); return; }
    const auth = AuthManager.getInstance();
    this.matchHistoryPanel = new MatchHistoryPanel();
    this.matchHistoryPanel.openLoading();
    this.blockGameInput();
    const checkHistoryClose = setInterval(() => {
      if (!this.matchHistoryPanel?.isOpen) { clearInterval(checkHistoryClose); this.unblockGameInput(); }
    }, 200);

    try {
      const entries = await auth.getMatchHistory(20);
      this.matchHistoryPanel.setEntries(entries);
    } catch {
      this.matchHistoryPanel.setEntries([]);
    }
  }

  private cleanupSocialUI() {
    this.profileCardEl?.remove();
    this.profileCardEl = null;
    this.friendsPanel?.destroy();
    this.friendsPanel = null;
    this.matchHistoryPanel?.destroy();
    this.matchHistoryPanel = null;
    this.matchInvitePopup?.destroy();
    this.matchInvitePopup = null;
    if (this.friendsUnsub) { this.friendsUnsub(); this.friendsUnsub = null; }
    if (this.invitesUnsub) { this.invitesUnsub(); this.invitesUnsub = null; }
    this.unblockGameInput();
  }

  private playsfx(key: string, volume = 0.5) {
    if (this.muted || !this.cache.audio.exists(key)) return;
    this.sound.play(key, { volume });
  }

}
