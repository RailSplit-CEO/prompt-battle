import Phaser from 'phaser';
import {
  Faction,
  FACTION_CONFIGS,
  LobbySlot,
  SM_CONSTANTS,
  BOT_NAMES,
} from '@prompt-battle/shared';

interface LobbySceneData {
  isLocal: boolean;
}

// ─── Helpers ──────────────────────────────────────────────────────────────

const ALL_FACTIONS: Faction[] = ['titan', 'prometheus', 'catalyst', 'specter', 'openforge', 'nexus'];

function shuffleArray<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// ─── Scene ────────────────────────────────────────────────────────────────

export class SiliconMindsLobbyScene extends Phaser.Scene {
  // Data
  private isLocal = true;
  private lobbySlots: LobbySlot[] = [];
  private localPlayerFaction: Faction | null = null;
  private numSlots = SM_CONSTANTS.DEFAULT_PLAYERS; // 4

  // Display objects
  private slotContainers: Phaser.GameObjects.Container[] = [];
  private factionCards: Map<Faction, {
    container: Phaser.GameObjects.Container;
    bg: Phaser.GameObjects.Graphics;
    border: Phaser.GameObjects.Graphics;
    zone: Phaser.GameObjects.Zone;
  }> = new Map();
  private startBtn!: { container: Phaser.GameObjects.Container; zone: Phaser.GameObjects.Zone; bg: Phaser.GameObjects.Graphics; text: Phaser.GameObjects.Text };
  private startBtnEnabled = false;
  private floatingShapes: { sprite: Phaser.GameObjects.Arc | Phaser.GameObjects.Star; vx: number; vy: number; rotSpeed: number }[] = [];

  constructor() {
    super({ key: 'SiliconMindsLobbyScene' });
  }

  init(data: LobbySceneData) {
    this.isLocal = data?.isLocal ?? true;
  }

  create() {
    const { width, height } = this.cameras.main;
    this.cameras.main.setBackgroundColor('#1B1040');
    this.cameras.main.fadeIn(600, 27, 16, 64);

    // Background floating shapes
    this.createFloatingShapes(width, height);

    // Initialize lobby slots: player slot empty, bots with random factions
    this.initLobbySlots();

    // ── TITLE AREA ──
    this.createTitle(width, height);

    // ── PLAYER SLOTS (top-right area) ──
    this.createPlayerSlots(width, height);

    // ── FACTION PICKER (center-left area) ──
    this.createFactionPicker(width, height);

    // ── START BUTTON ──
    this.createStartButton(width, height);

    // Initial render
    this.refreshSlotDisplay();
    this.refreshFactionPicker();
    this.refreshStartButton();
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

  // ═══════════════════════════════════════════════════════════════════════
  // LOBBY DATA
  // ═══════════════════════════════════════════════════════════════════════

  private initLobbySlots() {
    this.lobbySlots = [];
    const shuffled = shuffleArray(ALL_FACTIONS);

    // Slot 0: local player, no faction yet
    this.lobbySlots.push({
      playerId: 'local',
      playerName: 'YOU',
      faction: null as unknown as Faction, // will be set when picked
      isBot: false,
      ready: false,
    });

    // Slots 1..(numSlots-1): bots with unique random factions
    for (let i = 1; i < this.numSlots; i++) {
      const botFaction = shuffled[i]; // skip index 0 to leave room for player choices
      this.lobbySlots.push({
        playerId: `bot-${i}`,
        playerName: BOT_NAMES[botFaction],
        faction: botFaction,
        isBot: true,
        ready: true,
      });
    }
  }

  private selectFaction(faction: Faction) {
    if (this.localPlayerFaction === faction) return;

    this.localPlayerFaction = faction;
    this.lobbySlots[0].faction = faction;
    this.lobbySlots[0].ready = true;

    // Reassign bot factions to avoid duplicates
    const usedFactions = new Set<Faction>([faction]);
    const available = shuffleArray(ALL_FACTIONS.filter(f => f !== faction));
    let availIdx = 0;

    for (let i = 1; i < this.lobbySlots.length; i++) {
      const slot = this.lobbySlots[i];
      if (usedFactions.has(slot.faction)) {
        // Need to reassign
        while (availIdx < available.length && usedFactions.has(available[availIdx])) {
          availIdx++;
        }
        if (availIdx < available.length) {
          slot.faction = available[availIdx];
          slot.playerName = BOT_NAMES[slot.faction];
          availIdx++;
        }
      }
      usedFactions.add(slot.faction);
    }

    this.refreshSlotDisplay();
    this.refreshFactionPicker();
    this.refreshStartButton();
  }

  private startGame() {
    if (!this.localPlayerFaction) return;

    // Flash and transition
    this.cameras.main.flash(300, 255, 107, 157, false);

    this.time.delayedCall(600, () => {
      this.cameras.main.fadeOut(500, 27, 16, 64);
      this.cameras.main.once('camerafadeoutcomplete', () => {
        this.scene.start('SiliconMindsScene', {
          lobby: this.lobbySlots,
          localPlayerIndex: 0,
        });
      });
    });
  }

  // ═══════════════════════════════════════════════════════════════════════
  // TITLE
  // ═══════════════════════════════════════════════════════════════════════

  private createTitle(width: number, height: number) {
    const titleY = height * 0.07;

    // Title shadow
    this.add.text(width / 2 + 4, titleY + 4, 'SILICON MINDS', {
      fontSize: '64px',
      color: '#0D0825',
      fontFamily: '"Fredoka", sans-serif',
      fontStyle: 'bold',
    }).setOrigin(0.5).setAlpha(0.6);

    // Main title
    const title = this.add.text(width / 2, titleY, 'SILICON MINDS', {
      fontSize: '64px',
      color: '#FF6B9D',
      fontFamily: '"Fredoka", sans-serif',
      fontStyle: 'bold',
    }).setOrigin(0.5).setAlpha(0).setScale(0.5);

    this.tweens.add({
      targets: title,
      alpha: 1, scaleX: 1, scaleY: 1,
      duration: 800,
      ease: 'Back.easeOut',
    });

    // Title hover
    this.tweens.add({
      targets: title,
      y: { from: titleY, to: titleY + 5 },
      duration: 2200,
      yoyo: true,
      repeat: -1,
      ease: 'Sine.easeInOut',
    });

    // Subtitle
    const subtitleY = titleY + 56;
    const subtitle = this.add.text(width / 2, subtitleY, 'AI  COMPANY  WARFARE', {
      fontSize: '18px',
      color: '#FFD93D',
      fontFamily: '"Nunito", sans-serif',
      fontStyle: 'bold',
      letterSpacing: 6,
    }).setOrigin(0.5).setAlpha(0);

    this.tweens.add({
      targets: subtitle,
      alpha: 0.9,
      duration: 600,
      delay: 400,
    });

    // Decorative line
    const lineY = subtitleY + 28;
    const line = this.add.graphics();
    line.lineStyle(3, 0xFFD93D, 0.5);
    line.lineBetween(width / 2 - 160, lineY, width / 2 + 160, lineY);
    line.fillStyle(0xFFD93D, 0.7);
    line.fillCircle(width / 2 - 164, lineY, 4);
    line.fillCircle(width / 2 + 164, lineY, 4);
    line.setAlpha(0);
    this.tweens.add({ targets: line, alpha: 1, duration: 600, delay: 600 });
  }

  // ═══════════════════════════════════════════════════════════════════════
  // PLAYER SLOTS
  // ═══════════════════════════════════════════════════════════════════════

  private createPlayerSlots(width: number, _height: number) {
    const startY = 220;
    const slotW = 380;
    const slotH = 72;
    const gap = 14;
    const slotsX = width - slotW / 2 - 80;

    // Section title
    const sectionTitle = this.add.text(slotsX, startY - 50, 'COMBATANTS', {
      fontSize: '20px',
      color: '#C98FFF',
      fontFamily: '"Fredoka", sans-serif',
      fontStyle: 'bold',
      letterSpacing: 4,
    }).setOrigin(0.5).setAlpha(0);

    this.tweens.add({ targets: sectionTitle, alpha: 1, duration: 600, delay: 500 });

    this.slotContainers = [];

    for (let i = 0; i < this.numSlots; i++) {
      const y = startY + i * (slotH + gap);
      const container = this.add.container(slotsX, y);

      // Shadow
      const shadow = this.add.graphics();
      shadow.fillStyle(0x000000, 0.3);
      shadow.fillRoundedRect(-slotW / 2 + 4, -slotH / 2 + 4, slotW, slotH, 14);
      container.add(shadow);

      // Background (will be redrawn on refresh)
      const bg = this.add.graphics();
      container.add(bg);
      container.setData('bg', bg);

      // Slot number badge
      const badge = this.add.graphics();
      badge.fillStyle(0x000000, 0.3);
      badge.fillCircle(-slotW / 2 + 32, 0, 16);
      badge.fillStyle(0xC98FFF, 0.8);
      badge.fillCircle(-slotW / 2 + 32, 0, 14);
      container.add(badge);

      const numText = this.add.text(-slotW / 2 + 32, 0, `${i + 1}`, {
        fontSize: '16px',
        color: '#1B1040',
        fontFamily: '"Fredoka", sans-serif',
        fontStyle: 'bold',
      }).setOrigin(0.5);
      container.add(numText);

      // Emoji text (faction emoji)
      const emojiText = this.add.text(-slotW / 2 + 66, -4, '', {
        fontSize: '28px',
      }).setOrigin(0.5);
      container.add(emojiText);
      container.setData('emoji', emojiText);

      // Faction name
      const nameText = this.add.text(-slotW / 2 + 94, -12, '', {
        fontSize: '17px',
        color: '#FFFFFF',
        fontFamily: '"Fredoka", sans-serif',
        fontStyle: 'bold',
      }).setOrigin(0, 0.5);
      container.add(nameText);
      container.setData('name', nameText);

      // Tagline
      const tagline = this.add.text(-slotW / 2 + 94, 10, '', {
        fontSize: '12px',
        color: '#9B8BC0',
        fontFamily: '"Nunito", sans-serif',
        fontStyle: '600',
      }).setOrigin(0, 0.5);
      container.add(tagline);
      container.setData('tagline', tagline);

      // Role badge (YOU / BOT / PLAYER N)
      const roleText = this.add.text(slotW / 2 - 28, 0, '', {
        fontSize: '13px',
        color: '#FFD93D',
        fontFamily: '"Fredoka", sans-serif',
        fontStyle: 'bold',
      }).setOrigin(1, 0.5);
      container.add(roleText);
      container.setData('role', roleText);

      // Animate in
      container.setAlpha(0).setScale(0.8);
      this.tweens.add({
        targets: container,
        alpha: 1, scaleX: 1, scaleY: 1,
        duration: 500,
        delay: 600 + i * 120,
        ease: 'Back.easeOut',
      });

      this.slotContainers.push(container);
    }
  }

  private refreshSlotDisplay() {
    const slotW = 380;
    const slotH = 72;

    for (let i = 0; i < this.numSlots; i++) {
      const container = this.slotContainers[i];
      const slot = this.lobbySlots[i];
      const bg = container.getData('bg') as Phaser.GameObjects.Graphics;
      const emojiText = container.getData('emoji') as Phaser.GameObjects.Text;
      const nameText = container.getData('name') as Phaser.GameObjects.Text;
      const taglineText = container.getData('tagline') as Phaser.GameObjects.Text;
      const roleText = container.getData('role') as Phaser.GameObjects.Text;

      bg.clear();

      if (slot.faction) {
        const cfg = FACTION_CONFIGS[slot.faction];

        // Filled slot: faction color tint
        bg.fillStyle(cfg.color, 0.15);
        bg.fillRoundedRect(-slotW / 2, -slotH / 2, slotW, slotH, 14);
        bg.lineStyle(2, cfg.color, 0.6);
        bg.strokeRoundedRect(-slotW / 2, -slotH / 2, slotW, slotH, 14);

        emojiText.setText(cfg.emoji);
        nameText.setText(cfg.name);
        nameText.setColor(cfg.colorStr);
        taglineText.setText(`"${cfg.tagline}"`);
      } else {
        // Empty slot: waiting
        bg.fillStyle(0xFFFFFF, 0.05);
        bg.fillRoundedRect(-slotW / 2, -slotH / 2, slotW, slotH, 14);
        bg.lineStyle(2, 0xFFFFFF, 0.15);
        bg.strokeRoundedRect(-slotW / 2, -slotH / 2, slotW, slotH, 14);

        emojiText.setText('?');
        nameText.setText('Awaiting Orders...');
        nameText.setColor('#6B5B8D');
        taglineText.setText('Select a faction below');
      }

      // Role badge
      if (!slot.isBot) {
        roleText.setText('YOU');
        roleText.setColor('#FFD93D');
      } else {
        roleText.setText('BOT');
        roleText.setColor('#6CC4FF');
      }
    }
  }

  // ═══════════════════════════════════════════════════════════════════════
  // FACTION PICKER
  // ═══════════════════════════════════════════════════════════════════════

  private createFactionPicker(width: number, height: number) {
    const startX = 80;
    const startY = 220;
    const cardW = 210;
    const cardH = 115;
    const gapX = 18;
    const gapY = 16;
    const cols = 3;

    // Section title
    const sectionTitle = this.add.text(startX + (cols * (cardW + gapX) - gapX) / 2, startY - 50, 'CHOOSE YOUR FACTION', {
      fontSize: '20px',
      color: '#FF6B9D',
      fontFamily: '"Fredoka", sans-serif',
      fontStyle: 'bold',
      letterSpacing: 4,
    }).setOrigin(0.5).setAlpha(0);

    this.tweens.add({ targets: sectionTitle, alpha: 1, duration: 600, delay: 500 });

    ALL_FACTIONS.forEach((factionId, idx) => {
      const cfg = FACTION_CONFIGS[factionId];
      const col = idx % cols;
      const row = Math.floor(idx / cols);
      const cx = startX + cardW / 2 + col * (cardW + gapX);
      const cy = startY + cardH / 2 + row * (cardH + gapY);

      const container = this.add.container(cx, cy);

      // Shadow
      const shadow = this.add.graphics();
      shadow.fillStyle(0x000000, 0.35);
      shadow.fillRoundedRect(-cardW / 2 + 4, -cardH / 2 + 4, cardW, cardH, 14);
      container.add(shadow);

      // Background
      const bg = this.add.graphics();
      container.add(bg);

      // Selection border (drawn on top separately)
      const border = this.add.graphics();
      container.add(border);

      // Emoji
      const emoji = this.add.text(-cardW / 2 + 22, -cardH / 2 + 18, cfg.emoji, {
        fontSize: '30px',
      }).setOrigin(0, 0);
      container.add(emoji);

      // Name
      const name = this.add.text(-cardW / 2 + 58, -cardH / 2 + 14, cfg.name, {
        fontSize: '16px',
        color: cfg.colorStr,
        fontFamily: '"Fredoka", sans-serif',
        fontStyle: 'bold',
      }).setOrigin(0, 0);
      container.add(name);

      // Tagline
      const tagline = this.add.text(-cardW / 2 + 58, -cardH / 2 + 36, `"${cfg.tagline}"`, {
        fontSize: '11px',
        color: '#9B8BC0',
        fontFamily: '"Nunito", sans-serif',
        fontStyle: '600',
      }).setOrigin(0, 0);
      container.add(tagline);

      // Stats preview (small)
      const statsY = -cardH / 2 + 62;
      const statsTexts = [
        `GPU ${this.formatMultiplier(cfg.computeMultiplier)}`,
        `RES ${this.formatMultiplier(cfg.researchMultiplier)}`,
        `REP ${this.formatMultiplier(cfg.reputationMultiplier)}`,
      ];
      statsTexts.forEach((s, si) => {
        const statText = this.add.text(
          -cardW / 2 + 16 + si * 65, statsY, s,
          {
            fontSize: '10px',
            color: '#8B7BAD',
            fontFamily: '"Nunito", sans-serif',
            fontStyle: 'bold',
          }
        ).setOrigin(0, 0);
        container.add(statText);
      });

      // Unique ability line
      const abilityLabel = cfg.uniqueAbility.replace(/_/g, ' ').toUpperCase();
      const abilityText = this.add.text(-cardW / 2 + 16, statsY + 20, `ABILITY: ${abilityLabel}`, {
        fontSize: '9px',
        color: '#6B5B8D',
        fontFamily: '"Nunito", sans-serif',
        fontStyle: 'bold',
        letterSpacing: 1,
      }).setOrigin(0, 0);
      container.add(abilityText);

      // Interactive zone
      const zone = this.add.zone(cx, cy, cardW, cardH).setInteractive({ useHandCursor: true });

      zone.on('pointerover', () => {
        if (this.localPlayerFaction !== factionId) {
          this.tweens.add({
            targets: container,
            scaleX: 1.05, scaleY: 1.05,
            duration: 200,
            ease: 'Back.easeOut',
          });
        }
      });

      zone.on('pointerout', () => {
        if (this.localPlayerFaction !== factionId) {
          this.tweens.add({
            targets: container,
            scaleX: 1, scaleY: 1,
            duration: 200,
          });
        }
      });

      zone.on('pointerdown', () => {
        // Click squish
        this.tweens.add({
          targets: container,
          scaleX: 0.93, scaleY: 0.93,
          duration: 80,
          yoyo: true,
          onComplete: () => {
            this.selectFaction(factionId);
          },
        });
      });

      // Animate entry
      container.setAlpha(0).setScale(0.7);
      this.tweens.add({
        targets: container,
        alpha: 1, scaleX: 1, scaleY: 1,
        duration: 500,
        delay: 700 + idx * 100,
        ease: 'Back.easeOut',
      });

      this.factionCards.set(factionId, { container, bg, border, zone });
    });
  }

  private refreshFactionPicker() {
    const cardW = 210;
    const cardH = 115;

    // Which factions are taken by bots?
    const botFactions = new Set<Faction>();
    for (let i = 1; i < this.lobbySlots.length; i++) {
      if (this.lobbySlots[i].faction) {
        botFactions.add(this.lobbySlots[i].faction);
      }
    }

    this.factionCards.forEach((card, factionId) => {
      const cfg = FACTION_CONFIGS[factionId];
      const isSelected = this.localPlayerFaction === factionId;
      const isBotTaken = botFactions.has(factionId);

      card.bg.clear();
      card.border.clear();

      if (isSelected) {
        // Selected: bright fill + thick glowing border
        card.bg.fillStyle(cfg.color, 0.3);
        card.bg.fillRoundedRect(-cardW / 2, -cardH / 2, cardW, cardH, 14);

        card.border.lineStyle(4, cfg.color, 1);
        card.border.strokeRoundedRect(-cardW / 2, -cardH / 2, cardW, cardH, 14);

        // Extra glow ring
        card.border.lineStyle(2, 0xFFFFFF, 0.4);
        card.border.strokeRoundedRect(-cardW / 2 - 3, -cardH / 2 - 3, cardW + 6, cardH + 6, 16);

        card.container.setScale(1.05);
      } else {
        // Unselected
        card.bg.fillStyle(cfg.color, 0.08);
        card.bg.fillRoundedRect(-cardW / 2, -cardH / 2, cardW, cardH, 14);
        card.border.lineStyle(2, cfg.color, 0.3);
        card.border.strokeRoundedRect(-cardW / 2, -cardH / 2, cardW, cardH, 14);

        card.container.setScale(1);
      }
    });
  }

  private formatMultiplier(val: number): string {
    if (val === 1.0) return '1.0x';
    if (val > 1.0) return `${val.toFixed(1)}x`;
    return `${val.toFixed(1)}x`;
  }

  // ═══════════════════════════════════════════════════════════════════════
  // START BUTTON
  // ═══════════════════════════════════════════════════════════════════════

  private createStartButton(width: number, height: number) {
    const btnX = width / 2;
    const btnY = height - 90;
    const btnW = 360;
    const btnH = 70;

    const container = this.add.container(btnX, btnY);

    // Shadow
    const shadow = this.add.graphics();
    shadow.fillStyle(0x000000, 0.3);
    shadow.fillRoundedRect(-btnW / 2 + 4, -btnH / 2 + 4, btnW, btnH, 18);
    container.add(shadow);

    // Background
    const bg = this.add.graphics();
    container.add(bg);

    // Text
    const text = this.add.text(0, 0, 'START GAME', {
      fontSize: '26px',
      color: '#FFFFFF',
      fontFamily: '"Fredoka", sans-serif',
      fontStyle: 'bold',
      letterSpacing: 4,
    }).setOrigin(0.5);
    container.add(text);

    // Subtitle hint
    const hint = this.add.text(0, 22, 'Pick a faction first', {
      fontSize: '11px',
      color: '#9B8BC0',
      fontFamily: '"Nunito", sans-serif',
      fontStyle: '600',
    }).setOrigin(0.5);
    container.add(hint);
    container.setData('hint', hint);

    // Interactive zone
    const zone = this.add.zone(btnX, btnY, btnW, btnH).setInteractive({ useHandCursor: true });

    zone.on('pointerover', () => {
      if (!this.startBtnEnabled) return;
      this.tweens.add({
        targets: container,
        scaleX: 1.06, scaleY: 1.06,
        duration: 200,
        ease: 'Back.easeOut',
      });
      // Brighten
      this.drawStartBtnBg(bg, btnW, btnH, true, true);
    });

    zone.on('pointerout', () => {
      if (!this.startBtnEnabled) return;
      this.tweens.add({
        targets: container,
        scaleX: 1, scaleY: 1,
        duration: 200,
      });
      this.drawStartBtnBg(bg, btnW, btnH, true, false);
    });

    zone.on('pointerdown', () => {
      if (!this.startBtnEnabled) return;
      this.tweens.add({
        targets: container,
        scaleX: 0.92, scaleY: 0.92,
        duration: 80,
        yoyo: true,
        onComplete: () => this.startGame(),
      });
    });

    // Animate in
    container.setAlpha(0).setScale(0.5);
    this.tweens.add({
      targets: container,
      alpha: 1, scaleX: 1, scaleY: 1,
      duration: 600,
      delay: 1200,
      ease: 'Back.easeOut',
    });

    this.startBtn = { container, zone, bg, text };
  }

  private refreshStartButton() {
    const btnW = 360;
    const btnH = 70;
    this.startBtnEnabled = this.localPlayerFaction !== null;

    const { bg, text, container } = this.startBtn;
    const hint = container.getData('hint') as Phaser.GameObjects.Text;

    this.drawStartBtnBg(bg, btnW, btnH, this.startBtnEnabled, false);

    if (this.startBtnEnabled) {
      text.setAlpha(1);
      hint.setText('All systems operational');
      hint.setColor('#45E6B0');

      // Idle pulse for enabled button
      this.tweens.getTweensOf(container).forEach(t => t.stop());
      this.tweens.add({
        targets: container,
        scaleX: { from: 1, to: 1.02 },
        scaleY: { from: 1, to: 1.02 },
        duration: 1200,
        yoyo: true,
        repeat: -1,
        ease: 'Sine.easeInOut',
      });
    } else {
      text.setAlpha(0.4);
      hint.setText('Pick a faction first');
      hint.setColor('#9B8BC0');
    }
  }

  private drawStartBtnBg(bg: Phaser.GameObjects.Graphics, w: number, h: number, enabled: boolean, hover: boolean) {
    bg.clear();
    if (enabled) {
      const alpha = hover ? 0.6 : 0.4;
      const borderAlpha = hover ? 1 : 0.8;
      const borderWidth = hover ? 4 : 3;
      bg.fillStyle(0xFF6B9D, alpha);
      bg.fillRoundedRect(-w / 2, -h / 2, w, h, 18);
      bg.lineStyle(borderWidth, 0xFF6B9D, borderAlpha);
      bg.strokeRoundedRect(-w / 2, -h / 2, w, h, 18);
    } else {
      bg.fillStyle(0xFFFFFF, 0.05);
      bg.fillRoundedRect(-w / 2, -h / 2, w, h, 18);
      bg.lineStyle(2, 0xFFFFFF, 0.1);
      bg.strokeRoundedRect(-w / 2, -h / 2, w, h, 18);
    }
  }

  // ═══════════════════════════════════════════════════════════════════════
  // FLOATING SHAPES (matches MenuScene style)
  // ═══════════════════════════════════════════════════════════════════════

  private createFloatingShapes(width: number, height: number) {
    const colors = [0xFF6B9D, 0xFFD93D, 0x45E6B0, 0x6CC4FF, 0xC98FFF, 0xFF9F43];

    for (let i = 0; i < 16; i++) {
      const x = Math.random() * width;
      const y = Math.random() * height;
      const color = colors[i % colors.length];
      const alpha = 0.04 + Math.random() * 0.06;

      let sprite: Phaser.GameObjects.Arc | Phaser.GameObjects.Star;
      if (i % 4 === 0) {
        sprite = this.add.star(x, y, 5, 3 + Math.random() * 4, 6 + Math.random() * 6, color, alpha);
      } else if (i % 4 === 1) {
        sprite = this.add.star(x, y, 4, 4 + Math.random() * 3, 8 + Math.random() * 5, color, alpha);
      } else {
        const r = 3 + Math.random() * 7;
        sprite = this.add.circle(x, y, r, color, alpha);
      }

      this.tweens.add({
        targets: sprite,
        alpha: { from: alpha, to: alpha * 0.3 },
        scaleX: { from: 1, to: 1.3 },
        scaleY: { from: 1, to: 1.3 },
        duration: 3000 + Math.random() * 4000,
        yoyo: true,
        repeat: -1,
        ease: 'Sine.easeInOut',
        delay: Math.random() * 2000,
      });

      this.floatingShapes.push({
        sprite,
        vx: (Math.random() - 0.5) * 0.25,
        vy: (Math.random() - 0.5) * 0.2,
        rotSpeed: (Math.random() - 0.5) * 0.3,
      });
    }
  }
}
