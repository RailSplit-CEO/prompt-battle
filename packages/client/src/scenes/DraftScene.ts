import Phaser from 'phaser';
import { CLASSES } from '@prompt-battle/shared';
import { ANIMALS } from '@prompt-battle/shared';
import { ClassId, AnimalId, DraftPick, computeStats } from '@prompt-battle/shared';
import { FirebaseSync } from '../network/FirebaseSync';

interface DraftSceneData {
  gameId: string;
  playerId: string;
  isLocal: boolean;
}

const ROLE_COLORS: Record<string, number> = {
  tank: 0xFF5555,
  dps: 0xFF9F43,
  support: 0x45E6B0,
  assassin: 0xBB55FF,
};

const ARCHETYPE_COLORS: Record<string, number> = {
  power: 0xFF6B6B,
  defense: 0x6CC4FF,
  speed: 0x45E6B0,
  magic: 0xC98FFF,
  utility: 0xFFD93D,
};

const CLASS_ICONS: Record<string, string> = {
  warrior: 'WR',
  mage: 'MG',
  archer: 'AR',
  healer: 'HL',
  rogue: 'RG',
  paladin: 'PL',
  necromancer: 'NC',
  bard: 'BD',
};

const ANIMAL_ICONS: Record<string, string> = {
  wolf: 'Wf',
  lion: 'Ln',
  turtle: 'Tu',
  elephant: 'El',
  cheetah: 'Ch',
  falcon: 'Fc',
  owl: 'Ow',
  phoenix: 'Px',
  chameleon: 'Cm',
  spider: 'Sp',
};

export class DraftScene extends Phaser.Scene {
  private gameId!: string;
  private playerId!: string;
  private isLocal!: boolean;
  private firebase!: FirebaseSync;

  private selectedClass: ClassId | null = null;
  private selectedAnimal: AnimalId | null = null;
  private picks: DraftPick[] = [];
  private myPickCount = 0;
  private pickOrder!: string[];
  private currentPickIndex = 0;

  private classCards: Map<string, Phaser.GameObjects.Container> = new Map();
  private animalCards: Map<string, Phaser.GameObjects.Container> = new Map();
  private confirmBtn!: Phaser.GameObjects.Container;
  private confirmBtnEnabled = false;
  private infoText!: Phaser.GameObjects.Text;
  private timerText!: Phaser.GameObjects.Text;
  private timerRing!: Phaser.GameObjects.Graphics;
  private statsPanel!: Phaser.GameObjects.Container;
  private pickTimeline!: Phaser.GameObjects.Container;
  private pickSlots: Phaser.GameObjects.Container[] = [];

  private timerEvent?: Phaser.Time.TimerEvent;
  private timeLeft = 30;
  private usedClasses: Set<string> = new Set();

  constructor() {
    super({ key: 'DraftScene' });
  }

  init(data: DraftSceneData) {
    this.gameId = data.gameId;
    this.playerId = data.playerId;
    this.isLocal = data.isLocal;
    this.firebase = FirebaseSync.getInstance();
  }

  create() {
    const { width, height } = this.cameras.main;
    this.cameras.main.setBackgroundColor('#1B1040');
    this.cameras.main.fadeIn(500, 27, 16, 64);

    const p1 = this.playerId;
    const p2 = this.isLocal ? 'player2_local' : 'opponent';
    this.pickOrder = [p1, p2, p2, p1, p1, p2];

    // ─── BACKGROUND GRID ─────────────────────────────────────────
    const gridGfx = this.add.graphics();
    gridGfx.lineStyle(1, 0xFF6B9D, 0.03);
    for (let x = 0; x < width; x += 50) gridGfx.lineBetween(x, 0, x, height);
    for (let y = 0; y < height; y += 50) gridGfx.lineBetween(0, y, width, y);

    // ─── LAYOUT METRICS ─────────────────────────────────────────
    const statsPanelW = 280;
    const contentW = width - statsPanelW - 40; // left content area
    const contentCenterX = contentW / 2 + 20;

    // ─── HEADER ──────────────────────────────────────────────────
    this.add.rectangle(width / 2, 0, width, 80, 0x1B1040, 0.92).setOrigin(0.5, 0);

    this.add.text(contentCenterX, 20, 'DRAFT PHASE', {
      fontSize: '30px',
      color: '#FF6B9D',
      fontFamily: '"Fredoka", sans-serif',
      fontStyle: 'bold',
      letterSpacing: 4,
    }).setOrigin(0.5, 0);

    this.infoText = this.add.text(contentCenterX, 54, 'Select a class and animal', {
      fontSize: '15px',
      color: '#cbb8ee',
      fontFamily: '"Nunito", sans-serif',
      fontStyle: '600',
    }).setOrigin(0.5, 0);

    // ─── TIMER ───────────────────────────────────────────────────
    this.timerRing = this.add.graphics();
    this.timerText = this.add.text(width - statsPanelW - 60, 42, '30', {
      fontSize: '26px',
      color: '#FFD93D',
      fontFamily: '"Fredoka", sans-serif',
      fontStyle: 'bold',
    }).setOrigin(0.5);
    this.drawTimerRing(1);

    // ─── PICK TIMELINE ───────────────────────────────────────────
    this.createPickTimeline(contentCenterX);

    // ─── CLASS CARDS ─────────────────────────────────────────────
    const classIds = Object.keys(CLASSES) as ClassId[];
    const cardW = 160;
    const cardH = 180;
    const cardGap = 12;
    const classGridW = 4 * cardW + 3 * cardGap;
    const classStartX = contentCenterX - classGridW / 2 + cardW / 2;
    const classY = 130;

    this.add.text(classStartX - cardW / 2, classY - 22, 'CLASSES', {
      fontSize: '12px',
      color: '#FF6B9D',
      fontFamily: '"Fredoka", sans-serif',
      letterSpacing: 3,
      fontStyle: 'bold',
    });

    classIds.forEach((id, i) => {
      const col = i % 4;
      const row = Math.floor(i / 4);
      const x = classStartX + col * (cardW + cardGap);
      const y = classY + row * (cardH + cardGap) + cardH / 2;
      const card = this.createClassCard(x, y, id, cardW, cardH);
      this.classCards.set(id, card);

      card.setAlpha(0).setScale(0.85);
      this.tweens.add({
        targets: card,
        alpha: 1, scaleX: 1, scaleY: 1,
        duration: 400,
        delay: 100 + i * 60,
        ease: 'Back.easeOut',
      });
    });

    // ─── ANIMAL CARDS ────────────────────────────────────────────
    const animalIds = Object.keys(ANIMALS) as AnimalId[];
    const smallW = 125;
    const smallH = 140;
    const smallGap = 10;
    const animalGridW = 5 * smallW + 4 * smallGap;
    const animalStartX = contentCenterX - animalGridW / 2 + smallW / 2;
    const animalYBase = classY + Math.ceil(classIds.length / 4) * (cardH + cardGap) + 20;

    this.add.text(animalStartX - smallW / 2, animalYBase - 22, 'ANIMALS', {
      fontSize: '12px',
      color: '#FFD93D',
      fontFamily: '"Fredoka", sans-serif',
      letterSpacing: 3,
      fontStyle: 'bold',
    });

    animalIds.forEach((id, i) => {
      const col = i % 5;
      const row = Math.floor(i / 5);
      const x = animalStartX + col * (smallW + smallGap);
      const y = animalYBase + row * (smallH + smallGap) + smallH / 2;
      const card = this.createAnimalCard(x, y, id, smallW, smallH);
      this.animalCards.set(id, card);

      card.setAlpha(0).setScale(0.85);
      this.tweens.add({
        targets: card,
        alpha: 1, scaleX: 1, scaleY: 1,
        duration: 400,
        delay: 500 + i * 50,
        ease: 'Back.easeOut',
      });
    });

    // ─── STATS PREVIEW PANEL (right side) ────────────────────────
    this.statsPanel = this.add.container(width - statsPanelW - 10, 120);
    this.statsPanel.setAlpha(0);

    // ─── CONFIRM BUTTON ──────────────────────────────────────────
    const confirmY = animalYBase + Math.ceil(animalIds.length / 5) * (smallH + smallGap) + 30;
    this.confirmBtn = this.createConfirmButton(contentCenterX, Math.min(confirmY, height - 50));
    this.confirmBtn.setAlpha(0).setScale(0.9);
    this.tweens.add({
      targets: this.confirmBtn,
      alpha: 1, scaleX: 1, scaleY: 1,
      duration: 500, delay: 900,
      ease: 'Back.easeOut',
    });

    this.updateState();
    this.startTimer();

    // Listen for opponent picks in online mode
    if (!this.isLocal) {
      this.firebase.onDraftPick(this.gameId, (pick: DraftPick) => {
        if (pick.playerId !== this.playerId) {
          this.picks.push(pick);
          this.currentPickIndex++;
          this.usedClasses.add(pick.classId);
          this.animatePickSlot(pick);
          this.updateState();
        }
      });
    }

    // Enable camera scrolling if content overflows
    const maxY = confirmY + 60;
    if (maxY > height) {
      this.cameras.main.setBounds(0, 0, width, maxY);
      this.input.on('wheel', (_p: unknown, _gx: unknown, _gy: unknown, _gz: unknown, dy: number) => {
        this.cameras.main.scrollY = Phaser.Math.Clamp(
          this.cameras.main.scrollY + dy * 0.5, 0, maxY - height
        );
      });
    }
  }

  // ─── CARD CREATION ──────────────────────────────────────────────

  private createClassCard(x: number, y: number, id: ClassId, w: number, h: number): Phaser.GameObjects.Container {
    const cls = CLASSES[id];
    const roleColor = ROLE_COLORS[cls.role] || 0x888888;
    const container = this.add.container(x, y);

    // Card background
    const bg = this.add.graphics();
    bg.fillStyle(0x231250, 1);
    bg.fillRoundedRect(-w / 2, -h / 2, w, h, 10);
    bg.lineStyle(1, 0x3D2070, 1);
    bg.strokeRoundedRect(-w / 2, -h / 2, w, h, 10);
    container.add(bg);

    // Role color accent line at top
    const accent = this.add.graphics();
    accent.fillStyle(roleColor, 0.7);
    accent.fillRoundedRect(-w / 2 + 3, -h / 2 + 3, w - 6, 4, 2);
    container.add(accent);

    // Class icon (large letters in circle)
    const iconBg = this.add.graphics();
    iconBg.fillStyle(roleColor, 0.15);
    iconBg.fillCircle(0, -h / 2 + 50, 28);
    iconBg.lineStyle(2, roleColor, 0.3);
    iconBg.strokeCircle(0, -h / 2 + 50, 28);
    container.add(iconBg);

    const iconText = this.add.text(0, -h / 2 + 50, CLASS_ICONS[id] || id[0].toUpperCase(), {
      fontSize: '22px',
      color: '#' + roleColor.toString(16).padStart(6, '0'),
      fontFamily: '"Fredoka", sans-serif',
      fontStyle: 'bold',
    }).setOrigin(0.5);
    container.add(iconText);

    // Class name
    const name = this.add.text(0, -h / 2 + 90, cls.name.toUpperCase(), {
      fontSize: '15px',
      color: '#f0e8ff',
      fontFamily: '"Nunito", sans-serif',
      fontStyle: 'bold',
    }).setOrigin(0.5);
    container.add(name);

    // Role tag
    const roleBg = this.add.graphics();
    roleBg.fillStyle(roleColor, 0.14);
    roleBg.fillRoundedRect(-28, -h / 2 + 102, 56, 18, 5);
    container.add(roleBg);

    const roleText = this.add.text(0, -h / 2 + 111, cls.role.toUpperCase(), {
      fontSize: '10px',
      color: '#' + roleColor.toString(16).padStart(6, '0'),
      fontFamily: '"Nunito", sans-serif',
      letterSpacing: 1,
      fontStyle: 'bold',
    }).setOrigin(0.5);
    container.add(roleText);

    // Ability name preview
    const ability = cls.abilities[0];
    if (ability) {
      const abilityText = this.add.text(0, -h / 2 + 132, ability.name, {
        fontSize: '10px',
        color: '#C98FFF',
        fontFamily: '"Nunito", sans-serif',
        fontStyle: 'bold',
      }).setOrigin(0.5);
      container.add(abilityText);
    }

    // Mini stat bars
    const stats = cls.baseStats;
    const maxStat = 150;
    const barY = -h / 2 + 148;
    const barNames = ['HP', 'ATK', 'DEF', 'SPD'];
    const barValues = [stats.hp, stats.attack, stats.defense, stats.speed];
    const barColors = [0x45E6B0, 0xFF6B6B, 0x6CC4FF, 0x45E6B0];

    barNames.forEach((stat, i) => {
      const by = barY + i * 14;
      const label = this.add.text(-w / 2 + 14, by, stat, {
        fontSize: '9px', color: '#7B5EA0', fontFamily: '"Nunito", sans-serif', fontStyle: 'bold',
      }).setOrigin(0, 0.5);
      container.add(label);

      const barBg = this.add.rectangle(-w / 2 + 46, by, w - 66, 5, 0x2A1858).setOrigin(0, 0.5);
      container.add(barBg);

      const barFill = this.add.rectangle(-w / 2 + 46, by, (barValues[i] / maxStat) * (w - 66), 5, barColors[i], 0.7)
        .setOrigin(0, 0.5);
      container.add(barFill);
    });

    // Interactive zone
    const zone = this.add.zone(0, 0, w, h).setInteractive({ useHandCursor: true });
    container.add(zone);

    container.setData('id', id);
    container.setData('bg', bg);
    container.setData('w', w);
    container.setData('h', h);
    container.setData('disabled', false);
    container.setData('selected', false);

    zone.on('pointerover', () => {
      if (container.getData('disabled')) return;
      if (!container.getData('selected')) {
        this.tweens.add({ targets: container, scaleX: 1.05, scaleY: 1.05, duration: 150, ease: 'Back.easeOut' });
        bg.clear();
        bg.fillStyle(0x2E1860, 1);
        bg.fillRoundedRect(-w / 2, -h / 2, w, h, 10);
        bg.lineStyle(2, 0xFF6B9D, 0.5);
        bg.strokeRoundedRect(-w / 2, -h / 2, w, h, 10);
      }
    });

    zone.on('pointerout', () => {
      if (container.getData('disabled')) return;
      if (!container.getData('selected')) {
        this.tweens.add({ targets: container, scaleX: 1, scaleY: 1, duration: 150 });
        bg.clear();
        bg.fillStyle(0x231250, 1);
        bg.fillRoundedRect(-w / 2, -h / 2, w, h, 10);
        bg.lineStyle(1, 0x3D2070, 1);
        bg.strokeRoundedRect(-w / 2, -h / 2, w, h, 10);
      }
    });

    zone.on('pointerdown', () => {
      if (container.getData('disabled')) return;
      this.selectClass(id);
      this.tweens.add({
        targets: container,
        scaleX: 0.95, scaleY: 0.95,
        duration: 60,
        yoyo: true,
        ease: 'Quad.easeIn',
      });
    });

    return container;
  }

  private createAnimalCard(x: number, y: number, id: AnimalId, w: number, h: number): Phaser.GameObjects.Container {
    const animal = ANIMALS[id];
    const archColor = ARCHETYPE_COLORS[animal.archetype] || 0x888888;
    const container = this.add.container(x, y);

    const bg = this.add.graphics();
    bg.fillStyle(0x231250, 1);
    bg.fillRoundedRect(-w / 2, -h / 2, w, h, 8);
    bg.lineStyle(1, 0x3D2070, 1);
    bg.strokeRoundedRect(-w / 2, -h / 2, w, h, 8);
    container.add(bg);

    // Archetype accent
    const accent = this.add.graphics();
    accent.fillStyle(archColor, 0.6);
    accent.fillRoundedRect(-w / 2 + 3, -h / 2 + 3, w - 6, 3, 1);
    container.add(accent);

    // Animal icon
    const iconBg = this.add.graphics();
    iconBg.fillStyle(archColor, 0.12);
    iconBg.fillCircle(0, -h / 2 + 38, 22);
    iconBg.lineStyle(1, archColor, 0.3);
    iconBg.strokeCircle(0, -h / 2 + 38, 22);
    container.add(iconBg);

    const iconText = this.add.text(0, -h / 2 + 38, ANIMAL_ICONS[id] || id[0].toUpperCase(), {
      fontSize: '16px',
      color: '#' + archColor.toString(16).padStart(6, '0'),
      fontFamily: '"Fredoka", sans-serif',
      fontStyle: 'bold',
    }).setOrigin(0.5);
    container.add(iconText);

    // Animal name
    const name = this.add.text(0, -h / 2 + 70, animal.name.toUpperCase(), {
      fontSize: '13px',
      color: '#f0e8ff',
      fontFamily: '"Nunito", sans-serif',
      fontStyle: 'bold',
    }).setOrigin(0.5);
    container.add(name);

    // Archetype tag
    const archBg = this.add.graphics();
    archBg.fillStyle(archColor, 0.12);
    archBg.fillRoundedRect(-30, -h / 2 + 80, 60, 16, 4);
    container.add(archBg);

    const archText = this.add.text(0, -h / 2 + 88, animal.archetype.toUpperCase(), {
      fontSize: '9px',
      color: '#' + archColor.toString(16).padStart(6, '0'),
      fontFamily: '"Nunito", sans-serif',
      letterSpacing: 1,
      fontStyle: 'bold',
    }).setOrigin(0.5);
    container.add(archText);

    // Passive preview
    const passiveText = this.add.text(0, -h / 2 + 108, animal.passive.name, {
      fontSize: '9px',
      color: '#FFD93D',
      fontFamily: '"Nunito", sans-serif',
      fontStyle: 'bold',
    }).setOrigin(0.5);
    container.add(passiveText);

    // Stat modifier hints
    const mods = animal.statModifiers;
    const modParts: string[] = [];
    if (mods.attack > 1) modParts.push(`ATK+`);
    if (mods.defense > 1) modParts.push(`DEF+`);
    if (mods.speed > 1) modParts.push(`SPD+`);
    if (mods.magic > 1) modParts.push(`MAG+`);
    if (mods.hp > 1) modParts.push(`HP+`);

    if (modParts.length > 0) {
      const modText = this.add.text(0, -h / 2 + 124, modParts.join(' '), {
        fontSize: '8px',
        color: '#' + archColor.toString(16).padStart(6, '0'),
        fontFamily: '"Nunito", sans-serif',
      }).setOrigin(0.5).setAlpha(0.7);
      container.add(modText);
    }

    // Interactive zone
    const zone = this.add.zone(0, 0, w, h).setInteractive({ useHandCursor: true });
    container.add(zone);

    container.setData('id', id);
    container.setData('bg', bg);
    container.setData('w', w);
    container.setData('h', h);
    container.setData('disabled', false);
    container.setData('selected', false);

    zone.on('pointerover', () => {
      if (container.getData('disabled')) return;
      if (!container.getData('selected')) {
        this.tweens.add({ targets: container, scaleX: 1.06, scaleY: 1.06, duration: 150, ease: 'Back.easeOut' });
        bg.clear();
        bg.fillStyle(0x2E1860, 1);
        bg.fillRoundedRect(-w / 2, -h / 2, w, h, 8);
        bg.lineStyle(2, archColor, 0.5);
        bg.strokeRoundedRect(-w / 2, -h / 2, w, h, 8);
      }
    });

    zone.on('pointerout', () => {
      if (container.getData('disabled')) return;
      if (!container.getData('selected')) {
        this.tweens.add({ targets: container, scaleX: 1, scaleY: 1, duration: 150 });
        bg.clear();
        bg.fillStyle(0x231250, 1);
        bg.fillRoundedRect(-w / 2, -h / 2, w, h, 8);
        bg.lineStyle(1, 0x3D2070, 1);
        bg.strokeRoundedRect(-w / 2, -h / 2, w, h, 8);
      }
    });

    zone.on('pointerdown', () => {
      if (container.getData('disabled')) return;
      this.selectAnimal(id);
      this.tweens.add({
        targets: container,
        scaleX: 0.94, scaleY: 0.94,
        duration: 60,
        yoyo: true,
      });
    });

    return container;
  }

  // ─── PICK TIMELINE ──────────────────────────────────────────────

  private createPickTimeline(centerX: number) {
    this.pickTimeline = this.add.container(centerX, 95);
    const slotW = 90, slotH = 22, gap = 10;
    const totalW = 6 * slotW + 5 * gap;
    const startX = -totalW / 2 + slotW / 2;

    for (let i = 0; i < 6; i++) {
      const slot = this.add.container(startX + i * (slotW + gap), 0);
      const isMyPick = this.pickOrder[i] === this.playerId;

      const slotBg = this.add.graphics();
      slotBg.fillStyle(isMyPick ? 0x2A1858 : 0x2A1030, 0.7);
      slotBg.fillRoundedRect(-slotW / 2, -slotH / 2, slotW, slotH, 6);
      slotBg.lineStyle(2, isMyPick ? 0x6CC4FF : 0xFF6B6B, 0.5);
      slotBg.strokeRoundedRect(-slotW / 2, -slotH / 2, slotW, slotH, 6);
      slot.add(slotBg);

      const label = this.add.text(0, 0, isMyPick ? 'YOUR PICK' : 'OPPONENT', {
        fontSize: '9px',
        color: isMyPick ? '#6CC4FF' : '#FF8EC8',
        fontFamily: '"Nunito", sans-serif',
        fontStyle: 'bold',
      }).setOrigin(0.5);
      slot.add(label);

      slot.setData('bg', slotBg);
      slot.setData('label', label);
      this.pickSlots.push(slot);
      this.pickTimeline.add(slot);
    }
  }

  private animatePickSlot(pick: DraftPick) {
    const slotIndex = pick.pickOrder;
    if (slotIndex >= this.pickSlots.length) return;
    const slot = this.pickSlots[slotIndex];
    const bg = slot.getData('bg') as Phaser.GameObjects.Graphics;
    const label = slot.getData('label') as Phaser.GameObjects.Text;
    const isMyPick = pick.playerId === this.playerId;
    const cls = CLASSES[pick.classId];
    const animal = ANIMALS[pick.animalId];

    const slotW = 90, slotH = 22;
    bg.clear();
    bg.fillStyle(isMyPick ? 0x2A2068 : 0x4A1838, 0.85);
    bg.fillRoundedRect(-slotW / 2, -slotH / 2, slotW, slotH, 6);
    bg.lineStyle(2, isMyPick ? 0xFF6B9D : 0xFF6B6B, 0.8);
    bg.strokeRoundedRect(-slotW / 2, -slotH / 2, slotW, slotH, 6);

    label.setText(`${cls.name.slice(0, 3)}+${animal.name.slice(0, 3)}`);
    label.setColor(isMyPick ? '#FF8EC8' : '#FF8888');
    label.setFontSize(10);

    this.tweens.add({
      targets: slot,
      scaleX: 1.2, scaleY: 1.3,
      duration: 100,
      yoyo: true,
      ease: 'Quad.easeOut',
    });
  }

  // ─── STATS PANEL ──────────────────────────────────────────────

  private updatePreview() {
    this.statsPanel.removeAll(true);

    if (this.selectedClass && this.selectedAnimal) {
      const cls = CLASSES[this.selectedClass];
      const animal = ANIMALS[this.selectedAnimal];
      const stats = computeStats(cls.baseStats, animal.statModifiers);
      const roleColor = ROLE_COLORS[cls.role] || 0x888888;

      this.statsPanel.setAlpha(1);

      // Panel background
      const panelW = 260;
      const panelBg = this.add.graphics();
      panelBg.fillStyle(0x1B1040, 0.95);
      panelBg.fillRoundedRect(0, 0, panelW, 420, 10);
      panelBg.lineStyle(1, 0x3D2070, 0.6);
      panelBg.strokeRoundedRect(0, 0, panelW, 420, 10);
      this.statsPanel.add(panelBg);

      // Combo title
      const title = this.add.text(panelW / 2, 18, `${cls.name} + ${animal.name}`, {
        fontSize: '17px',
        color: '#fff',
        fontFamily: '"Nunito", sans-serif',
        fontStyle: 'bold',
      }).setOrigin(0.5, 0);
      this.statsPanel.add(title);

      // Role + Archetype tags
      const roleColorHex = '#' + roleColor.toString(16).padStart(6, '0');
      const archColor = ARCHETYPE_COLORS[animal.archetype] || 0x888888;
      const archColorHex = '#' + archColor.toString(16).padStart(6, '0');

      const tags = this.add.text(panelW / 2, 42, `${cls.role.toUpperCase()} + ${animal.archetype.toUpperCase()}`, {
        fontSize: '10px',
        color: roleColorHex,
        fontFamily: '"Nunito", sans-serif',
        fontStyle: 'bold',
        letterSpacing: 1,
      }).setOrigin(0.5, 0);
      this.statsPanel.add(tags);

      // Divider
      const div = this.add.graphics();
      div.lineStyle(1, 0xFF6B9D, 0.2);
      div.lineBetween(16, 60, panelW - 16, 60);
      this.statsPanel.add(div);

      // Stat bars
      const statConfig = [
        { key: 'HP', value: stats.hp, max: 210, color: 0x45E6B0 },
        { key: 'ATK', value: stats.attack, max: 50, color: 0xFF6B6B },
        { key: 'DEF', value: stats.defense, max: 30, color: 0x6CC4FF },
        { key: 'SPD', value: stats.speed, max: 7, color: 0x45E6B0 },
        { key: 'RNG', value: stats.range, max: 8, color: 0xFFD93D },
        { key: 'MAG', value: stats.magic, max: 50, color: 0xC98FFF },
      ];

      statConfig.forEach((s, i) => {
        const sy = 75 + i * 30;
        const label = this.add.text(16, sy, s.key, {
          fontSize: '11px', color: '#8B6DB0', fontFamily: '"Nunito", sans-serif', fontStyle: 'bold',
        });
        this.statsPanel.add(label);

        const value = this.add.text(panelW - 16, sy, String(s.value), {
          fontSize: '11px', color: '#cbb8ee', fontFamily: '"Nunito", sans-serif', fontStyle: 'bold',
        }).setOrigin(1, 0);
        this.statsPanel.add(value);

        const barBg = this.add.rectangle(56, sy + 7, panelW - 90, 7, 0x2A1858).setOrigin(0, 0.5);
        this.statsPanel.add(barBg);

        const fillWidth = Math.min(1, s.value / s.max) * (panelW - 90);
        const barFill = this.add.rectangle(56, sy + 7, 0, 7, s.color, 0.8).setOrigin(0, 0.5);
        this.statsPanel.add(barFill);

        this.tweens.add({
          targets: barFill,
          width: fillWidth,
          duration: 400,
          delay: i * 50,
          ease: 'Cubic.easeOut',
        });
      });

      // Ability section
      const abY = 265;
      const abTitle = this.add.text(16, abY, 'ABILITY', {
        fontSize: '10px', color: '#6c63ff', fontFamily: '"Nunito", sans-serif',
        letterSpacing: 2, fontStyle: 'bold',
      });
      this.statsPanel.add(abTitle);

      cls.abilities.forEach((ability, i) => {
        const ay = abY + 20 + i * 40;
        const aName = this.add.text(16, ay, ability.name, {
          fontSize: '13px', color: '#C98FFF', fontFamily: '"Nunito", sans-serif', fontStyle: 'bold',
        });
        this.statsPanel.add(aName);

        const aDesc = this.add.text(16, ay + 16, ability.description, {
          fontSize: '9px', color: '#8B6DB0', fontFamily: '"Nunito", sans-serif',
          wordWrap: { width: panelW - 32 },
        });
        this.statsPanel.add(aDesc);
      });

      // Passive section
      const passY = abY + 80;
      const passTitle = this.add.text(16, passY, `PASSIVE (${animal.name})`, {
        fontSize: '10px', color: '#FFD93D', fontFamily: '"Nunito", sans-serif',
        letterSpacing: 1, fontStyle: 'bold',
      });
      this.statsPanel.add(passTitle);

      const passName = this.add.text(16, passY + 18, animal.passive.name, {
        fontSize: '13px', color: '#FFD93D', fontFamily: '"Nunito", sans-serif', fontStyle: 'bold',
      });
      this.statsPanel.add(passName);

      const passDesc = this.add.text(16, passY + 34, animal.passive.description, {
        fontSize: '9px', color: '#8B6DB0', fontFamily: '"Nunito", sans-serif',
        wordWrap: { width: panelW - 32 },
      });
      this.statsPanel.add(passDesc);

      // Panel entrance animation
      this.tweens.add({
        targets: this.statsPanel,
        alpha: { from: 0, to: 1 },
        x: { from: this.statsPanel.x + 20, to: this.statsPanel.x },
        duration: 300,
        ease: 'Cubic.easeOut',
      });

      this.setConfirmEnabled(true);
    } else {
      this.statsPanel.setAlpha(0);
      this.setConfirmEnabled(false);
    }
  }

  // ─── CONFIRM BUTTON ──────────────────────────────────────────

  private createConfirmButton(x: number, y: number): Phaser.GameObjects.Container {
    const container = this.add.container(x, y);
    const w = 260, h = 50;

    const bg = this.add.graphics();
    bg.fillStyle(0x2A1858, 0.8);
    bg.fillRoundedRect(-w / 2, -h / 2, w, h, 8);
    bg.lineStyle(1, 0x3D2070, 0.5);
    bg.strokeRoundedRect(-w / 2, -h / 2, w, h, 8);
    container.add(bg);

    const text = this.add.text(0, 0, 'CONFIRM PICK', {
      fontSize: '16px',
      color: '#7B5EA0',
      fontFamily: '"Nunito", sans-serif',
      fontStyle: 'bold',
      letterSpacing: 3,
    }).setOrigin(0.5);
    container.add(text);

    const zone = this.add.zone(x, y, w, h).setInteractive({ useHandCursor: true });
    zone.on('pointerdown', () => {
      if (this.confirmBtnEnabled) {
        this.confirmPick();
        this.tweens.add({
          targets: container,
          scaleX: 0.95, scaleY: 0.95,
          duration: 60,
          yoyo: true,
        });
      }
    });

    zone.on('pointerover', () => {
      if (this.confirmBtnEnabled) {
        this.tweens.add({ targets: container, scaleX: 1.03, scaleY: 1.03, duration: 150 });
      }
    });
    zone.on('pointerout', () => {
      this.tweens.add({ targets: container, scaleX: 1, scaleY: 1, duration: 150 });
    });

    container.setData('bg', bg);
    container.setData('text', text);

    return container;
  }

  private setConfirmEnabled(enabled: boolean) {
    this.confirmBtnEnabled = enabled;
    const bg = this.confirmBtn.getData('bg') as Phaser.GameObjects.Graphics;
    const text = this.confirmBtn.getData('text') as Phaser.GameObjects.Text;
    const w = 260, h = 50;

    bg.clear();
    if (enabled) {
      bg.fillStyle(0xFF6B9D, 0.3);
      bg.fillRoundedRect(-w / 2, -h / 2, w, h, 8);
      bg.lineStyle(2, 0xFF6B9D, 0.7);
      bg.strokeRoundedRect(-w / 2, -h / 2, w, h, 8);
      text.setColor('#fff');
    } else {
      bg.fillStyle(0x2A1858, 0.8);
      bg.fillRoundedRect(-w / 2, -h / 2, w, h, 8);
      bg.lineStyle(1, 0x3D2070, 0.5);
      bg.strokeRoundedRect(-w / 2, -h / 2, w, h, 8);
      text.setColor('#7B5EA0');
    }
  }

  // ─── SELECTION LOGIC ──────────────────────────────────────────

  private selectClass(id: ClassId) {
    if (this.usedClasses.has(id)) return;
    this.selectedClass = id;

    this.classCards.forEach((container, cid) => {
      const bg = container.getData('bg') as Phaser.GameObjects.Graphics;
      const w = container.getData('w') as number;
      const h = container.getData('h') as number;
      if (cid === id) {
        container.setData('selected', true);
        bg.clear();
        bg.fillStyle(0x2A1858, 1);
        bg.fillRoundedRect(-w / 2, -h / 2, w, h, 10);
        bg.lineStyle(2, 0xFF6B9D, 0.9);
        bg.strokeRoundedRect(-w / 2, -h / 2, w, h, 10);
        this.tweens.add({ targets: container, scaleX: 1.05, scaleY: 1.05, duration: 150 });
      } else {
        container.setData('selected', false);
        if (!this.usedClasses.has(cid)) {
          bg.clear();
          bg.fillStyle(0x231250, 1);
          bg.fillRoundedRect(-w / 2, -h / 2, w, h, 10);
          bg.lineStyle(1, 0x3D2070, 1);
          bg.strokeRoundedRect(-w / 2, -h / 2, w, h, 10);
        }
        this.tweens.add({ targets: container, scaleX: 1, scaleY: 1, duration: 150 });
      }
    });

    this.updatePreview();
  }

  private selectAnimal(id: AnimalId) {
    this.selectedAnimal = id;

    this.animalCards.forEach((container, aid) => {
      const bg = container.getData('bg') as Phaser.GameObjects.Graphics;
      const archColor = ARCHETYPE_COLORS[ANIMALS[aid as AnimalId]?.archetype] || 0x888888;
      const w = container.getData('w') as number;
      const h = container.getData('h') as number;
      if (aid === id) {
        container.setData('selected', true);
        bg.clear();
        bg.fillStyle(0x2A1858, 1);
        bg.fillRoundedRect(-w / 2, -h / 2, w, h, 8);
        bg.lineStyle(2, archColor, 0.8);
        bg.strokeRoundedRect(-w / 2, -h / 2, w, h, 8);
        this.tweens.add({ targets: container, scaleX: 1.06, scaleY: 1.06, duration: 150 });
      } else {
        container.setData('selected', false);
        bg.clear();
        bg.fillStyle(0x231250, 1);
        bg.fillRoundedRect(-w / 2, -h / 2, w, h, 8);
        bg.lineStyle(1, 0x3D2070, 1);
        bg.strokeRoundedRect(-w / 2, -h / 2, w, h, 8);
        this.tweens.add({ targets: container, scaleX: 1, scaleY: 1, duration: 150 });
      }
    });

    this.updatePreview();
  }

  // ─── CONFIRM & DRAFT LOGIC ───────────────────────────────────

  private confirmPick() {
    if (!this.selectedClass || !this.selectedAnimal) return;
    if (!this.isMyTurn()) return;
    if (this.usedClasses.has(this.selectedClass)) return;

    const pick: DraftPick = {
      playerId: this.pickOrder[this.currentPickIndex],
      classId: this.selectedClass,
      animalId: this.selectedAnimal,
      pickOrder: this.currentPickIndex,
    };

    this.picks.push(pick);
    this.usedClasses.add(this.selectedClass);
    this.animatePickSlot(pick);
    this.myPickCount++;
    this.currentPickIndex++;

    if (!this.isLocal) {
      this.firebase.submitDraftPick(this.gameId, pick);
    }

    this.cameras.main.flash(150, 255, 107, 157, false);

    if (this.isLocal && this.currentPickIndex < 6 && !this.isMyTurn()) {
      this.time.delayedCall(300, () => {
        this.autoPickForOpponent();
        this.updateState();
        if (this.currentPickIndex >= 6) {
          this.finishDraft();
        }
      });
    }

    this.selectedClass = null;
    this.selectedAnimal = null;
    this.resetSelections();
    this.updateState();

    if (this.currentPickIndex >= 6) {
      this.finishDraft();
    }
  }

  private autoPickForOpponent() {
    const availableClasses = Object.keys(CLASSES).filter(c => !this.usedClasses.has(c));
    const availableAnimals = Object.keys(ANIMALS);
    const cls = availableClasses[Math.floor(Math.random() * availableClasses.length)] as ClassId;
    const animal = availableAnimals[Math.floor(Math.random() * availableAnimals.length)] as AnimalId;

    const pick: DraftPick = {
      playerId: this.pickOrder[this.currentPickIndex],
      classId: cls,
      animalId: animal,
      pickOrder: this.currentPickIndex,
    };

    this.picks.push(pick);
    this.usedClasses.add(cls);
    this.animatePickSlot(pick);
    this.currentPickIndex++;

    if (this.currentPickIndex < 6 && !this.isMyTurn()) {
      this.autoPickForOpponent();
    }
  }

  private isMyTurn(): boolean {
    if (this.currentPickIndex >= 6) return false;
    return this.pickOrder[this.currentPickIndex] === this.playerId;
  }

  private resetSelections() {
    this.classCards.forEach((container, cid) => {
      const bg = container.getData('bg') as Phaser.GameObjects.Graphics;
      const w = container.getData('w') as number;
      const h = container.getData('h') as number;
      container.setData('selected', false);
      if (!this.usedClasses.has(cid)) {
        bg.clear();
        bg.fillStyle(0x231250, 1);
        bg.fillRoundedRect(-w / 2, -h / 2, w, h, 10);
        bg.lineStyle(1, 0x3D2070, 1);
        bg.strokeRoundedRect(-w / 2, -h / 2, w, h, 10);
        this.tweens.add({ targets: container, scaleX: 1, scaleY: 1, duration: 150 });
      }
    });
    this.animalCards.forEach((container) => {
      const bg = container.getData('bg') as Phaser.GameObjects.Graphics;
      const w = container.getData('w') as number;
      const h = container.getData('h') as number;
      container.setData('selected', false);
      bg.clear();
      bg.fillStyle(0x231250, 1);
      bg.fillRoundedRect(-w / 2, -h / 2, w, h, 8);
      bg.lineStyle(1, 0x3D2070, 1);
      bg.strokeRoundedRect(-w / 2, -h / 2, w, h, 8);
      this.tweens.add({ targets: container, scaleX: 1, scaleY: 1, duration: 150 });
    });
    this.statsPanel.setAlpha(0);
    this.setConfirmEnabled(false);
  }

  private updateState() {
    this.classCards.forEach((container, cid) => {
      if (this.usedClasses.has(cid)) {
        const bg = container.getData('bg') as Phaser.GameObjects.Graphics;
        const w = container.getData('w') as number;
        const h = container.getData('h') as number;
        container.setData('disabled', true);
        bg.clear();
        bg.fillStyle(0x150A30, 0.5);
        bg.fillRoundedRect(-w / 2, -h / 2, w, h, 10);
        container.setAlpha(0.3);
      }
    });

    if (this.currentPickIndex >= 6) {
      this.infoText.setText('Draft complete! Preparing battle...');
      this.infoText.setColor('#45E6B0');
    } else if (this.isMyTurn()) {
      const pickNum = this.myPickCount + 1;
      this.infoText.setText(`Your pick (${pickNum}/3) — Select a class and animal`);
      this.infoText.setColor('#FF8EC8');
      this.timeLeft = 30;
    } else {
      this.infoText.setText('Waiting for opponent...');
      this.infoText.setColor('#7B5EA0');
    }

    this.pickSlots.forEach((slot, i) => {
      if (i === this.currentPickIndex && this.currentPickIndex < 6) {
        this.tweens.add({
          targets: slot,
          scaleX: 1.1, scaleY: 1.1,
          duration: 400,
          yoyo: true,
          repeat: -1,
          ease: 'Sine.easeInOut',
        });
      }
    });
  }

  // ─── TIMER ────────────────────────────────────────────────────

  private drawTimerRing(progress: number) {
    const { width } = this.cameras.main;
    const statsPanelW = 280;
    const timerX = width - statsPanelW - 60;
    this.timerRing.clear();
    this.timerRing.lineStyle(3, progress > 0.3 ? 0xFFD93D : 0xFF6B6B, 0.6);
    this.timerRing.beginPath();
    this.timerRing.arc(timerX, 42, 20, Phaser.Math.DegToRad(-90),
      Phaser.Math.DegToRad(-90 + 360 * progress), false);
    this.timerRing.strokePath();
  }

  private startTimer() {
    this.timerEvent = this.time.addEvent({
      delay: 1000,
      callback: () => {
        if (this.isMyTurn()) {
          this.timeLeft--;
          this.timerText.setText(String(this.timeLeft));
          this.drawTimerRing(this.timeLeft / 30);

          if (this.timeLeft <= 5) {
            this.timerText.setColor('#FF6B6B');
            this.tweens.add({
              targets: this.timerText,
              scaleX: 1.3, scaleY: 1.3,
              duration: 100,
              yoyo: true,
            });
          } else {
            this.timerText.setColor('#FFD93D');
          }

          if (this.timeLeft <= 0) {
            this.autoPickForSelf();
          }
        }
      },
      loop: true,
    });
  }

  private autoPickForSelf() {
    const available = Object.keys(CLASSES).filter(c => !this.usedClasses.has(c));
    const animals = Object.keys(ANIMALS);
    this.selectedClass = available[0] as ClassId;
    this.selectedAnimal = animals[Math.floor(Math.random() * animals.length)] as AnimalId;
    this.confirmPick();
  }

  private finishDraft() {
    if (this.timerEvent) this.timerEvent.destroy();

    this.infoText.setText('DRAFT COMPLETE!');
    this.infoText.setColor('#45E6B0');

    this.cameras.main.flash(400, 69, 230, 176, false);

    this.time.delayedCall(1500, () => {
      this.cameras.main.fadeOut(500, 27, 16, 64);
      this.cameras.main.once('camerafadeoutcomplete', () => {
        this.scene.start('BattleScene', {
          gameId: this.gameId,
          playerId: this.playerId,
          isLocal: this.isLocal,
          picks: this.picks,
        });
      });
    });
  }
}
