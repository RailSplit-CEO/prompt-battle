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
  warrior: '⚔️',
  mage: '🔮',
  archer: '🏹',
  healer: '💚',
  rogue: '🗡️',
  paladin: '🛡️',
  necromancer: '💀',
  bard: '🎵',
};

const ANIMAL_ICONS: Record<string, string> = {
  wolf: '🐺',
  lion: '🦁',
  turtle: '🐢',
  elephant: '🐘',
  cheetah: '🐆',
  falcon: '🦅',
  owl: '🦉',
  phoenix: '🔥',
  chameleon: '🦎',
  spider: '🕷️',
};

export class DraftScene extends Phaser.Scene {
  private gameId!: string;
  private playerId!: string;
  private isLocal!: boolean;
  private firebase!: FirebaseSync;
  private amPlayer1 = true;

  private selectedClass: ClassId | null = null;
  private selectedAnimal: AnimalId | null = null;
  private picks: DraftPick[] = [];
  private myPickCount = 0;
  private pickOrder!: string[];
  private currentPickIndex = 0;
  private processedPickIds = new Set<number>();
  private draftStarted = false;

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
  private usedAnimals: Set<string> = new Set();
  private activeSlotTween?: Phaser.Tweens.Tween;
  private animalLabel!: Phaser.GameObjects.Text;
  private animalHintTween?: Phaser.Tweens.Tween;

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

    if (this.isLocal) {
      const p1 = this.playerId;
      const p2 = 'player2_local';
      this.pickOrder = [p1, p2, p2, p1, p1, p2];
      this.amPlayer1 = true;
      this.draftStarted = true;
      this.buildDraftUI();
    } else {
      this.showCoinFlip();
    }
  }

  private async showCoinFlip() {
    const { width, height } = this.cameras.main;

    // Fetch game meta to know who is player1
    const meta = await this.firebase.getGameMeta(this.gameId);
    this.amPlayer1 = meta.player1 === this.playerId;
    const p1 = meta.player1;
    const p2 = meta.player2;
    this.pickOrder = [p1, p2, p2, p1, p1, p2];

    // Coin flip overlay
    const overlay = this.add.rectangle(width / 2, height / 2, width, height, 0x1B1040, 1).setDepth(100);

    // Coin circle
    const coinGfx = this.add.graphics().setDepth(101);
    const coinRadius = 70;
    const coinX = width / 2;
    const coinY = height / 2 - 30;

    // Coin text (flips between P1/P2)
    const coinLabel = this.add.text(coinX, coinY, '', {
      fontSize: '36px',
      color: '#FFD93D',
      fontFamily: '"Fredoka", sans-serif',
      fontStyle: 'bold',
    }).setOrigin(0.5).setDepth(102);

    const resultText = this.add.text(width / 2, coinY + 110, '', {
      fontSize: '22px',
      color: '#fff',
      fontFamily: '"Fredoka", sans-serif',
      fontStyle: 'bold',
    }).setOrigin(0.5).setDepth(102).setAlpha(0);

    const subText = this.add.text(width / 2, coinY + 145, '', {
      fontSize: '14px',
      color: '#cbb8ee',
      fontFamily: '"Nunito", sans-serif',
    }).setOrigin(0.5).setDepth(102).setAlpha(0);

    // Title
    const flipTitle = this.add.text(width / 2, coinY - 120, 'COIN FLIP', {
      fontSize: '20px',
      color: '#FF6B9D',
      fontFamily: '"Fredoka", sans-serif',
      fontStyle: 'bold',
      letterSpacing: 4,
    }).setOrigin(0.5).setDepth(102);

    // Animate the coin flip
    let flipCount = 0;
    const totalFlips = 16;
    const drawCoin = (label: string, color: number) => {
      coinGfx.clear();
      coinGfx.fillStyle(color, 0.25);
      coinGfx.fillCircle(coinX, coinY, coinRadius);
      coinGfx.lineStyle(3, color, 0.8);
      coinGfx.strokeCircle(coinX, coinY, coinRadius);
      coinLabel.setText(label);
    };

    const flipTimer = this.time.addEvent({
      delay: 80,
      callback: () => {
        flipCount++;
        const showP1 = flipCount % 2 === 0;
        drawCoin(showP1 ? 'P1' : 'P2', showP1 ? 0x6CC4FF : 0xFF6B6B);

        // Squash/stretch for spin effect
        this.tweens.add({
          targets: [coinGfx, coinLabel],
          scaleX: { from: 0.3, to: 1 },
          duration: 70,
          ease: 'Sine.easeOut',
        });

        if (flipCount >= totalFlips) {
          flipTimer.destroy();
          // Land on the actual result
          const iFirst = this.amPlayer1;
          drawCoin(iFirst ? 'P1' : 'P2', iFirst ? 0x6CC4FF : 0xFF6B6B);

          // Flash
          this.cameras.main.flash(200, 255, 217, 61, false);

          // Show result
          resultText.setText(iFirst ? 'YOU PICK FIRST!' : 'OPPONENT PICKS FIRST');
          resultText.setColor(iFirst ? '#45E6B0' : '#FF8EC8');
          subText.setText(iFirst ? 'Choose your class and animal' : 'Wait for opponent to pick...');

          this.tweens.add({ targets: resultText, alpha: 1, duration: 400, delay: 200 });
          this.tweens.add({ targets: subText, alpha: 1, duration: 400, delay: 400 });

          // Transition to draft UI
          this.time.delayedCall(2200, () => {
            this.tweens.add({
              targets: [overlay, coinGfx, coinLabel, resultText, subText, flipTitle],
              alpha: 0,
              duration: 500,
              onComplete: () => {
                overlay.destroy();
                coinGfx.destroy();
                coinLabel.destroy();
                resultText.destroy();
                subText.destroy();
                flipTitle.destroy();
                this.draftStarted = true;
                this.buildDraftUI();
              },
            });
          });
        }
      },
      loop: true,
    });
  }

  private buildDraftUI() {
    const { width, height } = this.cameras.main;

    // ─── BACKGROUND GRID ─────────────────────────────────────────
    const gridGfx = this.add.graphics();
    gridGfx.lineStyle(1, 0xFF6B9D, 0.03);
    for (let x = 0; x < width; x += 50) gridGfx.lineBetween(x, 0, x, height);
    for (let y = 0; y < height; y += 50) gridGfx.lineBetween(0, y, width, y);

    // ─── HEADER ──────────────────────────────────────────────────
    this.add.rectangle(width / 2, 0, width, 56, 0x1B1040, 0.92).setOrigin(0.5, 0);

    this.add.text(width / 2, 6, '🌟 DRAFT PHASE 🌟', {
      fontSize: '22px',
      color: '#FF6B9D',
      fontFamily: '"Fredoka", sans-serif',
      fontStyle: 'bold',
      letterSpacing: 5,
    }).setOrigin(0.5, 0);

    this.infoText = this.add.text(width / 2, 32, 'Select a class and animal', {
      fontSize: '13px',
      color: '#cbb8ee',
      fontFamily: '"Nunito", sans-serif',
      fontStyle: '600',
    }).setOrigin(0.5, 0);

    // ─── TIMER ───────────────────────────────────────────────────
    this.timerRing = this.add.graphics();
    this.timerText = this.add.text(width - 35, 28, '30', {
      fontSize: '20px',
      color: '#FFD93D',
      fontFamily: '"Fredoka", sans-serif',
      fontStyle: 'bold',
    }).setOrigin(0.5);
    this.drawTimerRing(1);

    // ─── PICK TIMELINE ───────────────────────────────────────────
    this.createPickTimeline(width / 2);

    // ─── CENTERED STACKED LAYOUT ─────────────────────────────────
    // Classes on top, animals below, confirm at bottom — all centered
    const classIds = Object.keys(CLASSES) as ClassId[];
    const animalIds = Object.keys(ANIMALS) as AnimalId[];

    // Card sizing — leave room for stats panel on the right
    const maxGridW = Math.min(width - 300, 900);
    const classCols = 4;
    const classGap = 12;
    const cardW = Math.min(150, Math.floor((maxGridW - (classCols - 1) * classGap) / classCols));
    const cardH = Math.min(120, Math.floor(cardW * 0.78));
    const classGridW = classCols * cardW + (classCols - 1) * classGap;
    const classStartX = width / 2 - classGridW / 2 + cardW / 2;

    const animalCols = 5;
    const animalGap = 10;
    const smallW = Math.min(130, Math.floor((maxGridW - (animalCols - 1) * animalGap) / animalCols));
    const smallH = Math.min(105, Math.floor(smallW * 0.78));
    const animalGridW = animalCols * smallW + (animalCols - 1) * animalGap;
    const animalStartX = width / 2 - animalGridW / 2 + smallW / 2;

    const classRows = Math.ceil(classIds.length / classCols);
    const animalRows = Math.ceil(animalIds.length / animalCols);
    const classGridH = classRows * cardH + (classRows - 1) * classGap;
    const animalGridH = animalRows * smallH + (animalRows - 1) * animalGap;

    // Compute vertical layout — distribute content with proper spacing
    const labelGap = 22;     // space from section label to first card row
    const sectionGap = 30;   // space between class grid bottom and animal label
    const confirmGap = 24;   // space before confirm button
    const confirmH = 44;
    const totalContentH = labelGap + classGridH + sectionGap + labelGap + animalGridH + confirmGap + confirmH;

    // Content starts below header+timeline (which ends ~y=88)
    const contentTop = 96;
    const contentBottom = height - 24;
    const extraSpace = Math.max(0, (contentBottom - contentTop) - totalContentH);
    const topPad = Math.floor(extraSpace * 0.22);

    const classLabelY = contentTop + topPad;
    const classY0 = classLabelY + labelGap;
    const animalLabelY = classY0 + classGridH + sectionGap;
    const animalY0 = animalLabelY + labelGap;
    const animalBottomY = animalY0 + animalGridH;

    this.add.text(classStartX - cardW / 2, classLabelY, '⚔️  PICK A CLASS', {
      fontSize: '12px',
      color: '#FF6B9D',
      fontFamily: '"Fredoka", sans-serif',
      letterSpacing: 3,
      fontStyle: 'bold',
    });

    classIds.forEach((id, i) => {
      const col = i % classCols;
      const row = Math.floor(i / classCols);
      const x = classStartX + col * (cardW + classGap);
      const y = classY0 + row * (cardH + classGap) + cardH / 2;
      const card = this.createClassCard(x, y, id, cardW, cardH);
      this.classCards.set(id, card);

      card.setAlpha(0).setScale(0.85);
      this.tweens.add({
        targets: card,
        alpha: 1, scaleX: 1, scaleY: 1,
        duration: 300,
        delay: 80 + i * 30,
        ease: 'Back.easeOut',
      });
    });

    this.animalLabel = this.add.text(animalStartX - smallW / 2, animalLabelY, '🐾  PICK AN ANIMAL', {
      fontSize: '12px',
      color: '#FFD93D',
      fontFamily: '"Fredoka", sans-serif',
      letterSpacing: 3,
      fontStyle: 'bold',
    });

    animalIds.forEach((id, i) => {
      const col = i % animalCols;
      const row = Math.floor(i / animalCols);
      const x = animalStartX + col * (smallW + animalGap);
      const y = animalY0 + row * (smallH + animalGap) + smallH / 2;
      const card = this.createAnimalCard(x, y, id, smallW, smallH);
      this.animalCards.set(id, card);

      card.setAlpha(0).setScale(0.85);
      this.tweens.add({
        targets: card,
        alpha: 1, scaleX: 1, scaleY: 1,
        duration: 300,
        delay: 200 + i * 25,
        ease: 'Back.easeOut',
      });
    });

    // ─── STATS PREVIEW PANEL (right side, shown when both selected) ───
    const statsPanelW = 240;
    this.statsPanel = this.add.container(width - statsPanelW - 16, classY0);
    this.statsPanel.setAlpha(0);

    // ─── CONFIRM BUTTON ──────────────────────────────────────────
    const confirmY = Math.min(animalBottomY + confirmGap, height - 50);
    this.confirmBtn = this.createConfirmButton(width / 2, confirmY);
    this.confirmBtn.setAlpha(0).setScale(0.9);
    this.tweens.add({
      targets: this.confirmBtn,
      alpha: 1, scaleX: 1, scaleY: 1,
      duration: 400, delay: 600,
      ease: 'Back.easeOut',
    });

    this.updateState();
    this.startTimer();

    // Listen for all picks in online mode (onChildAdded fires once per pick)
    if (!this.isLocal) {
      this.firebase.onDraftPick(this.gameId, (pick: DraftPick) => {
        // Skip picks we already know about (our own or already processed)
        if (this.processedPickIds.has(pick.pickOrder)) return;
        this.processedPickIds.add(pick.pickOrder);

        if (pick.playerId !== this.playerId) {
          this.picks.push(pick);
          this.currentPickIndex++;
          this.usedClasses.add(pick.classId);
          this.usedAnimals.add(pick.animalId);
          this.animatePickSlot(pick);
          this.updateState();

          if (this.currentPickIndex >= 6) {
            this.finishDraft();
          }
        }
      });
    }

  }

  // ─── CARD CREATION ──────────────────────────────────────────────

  private createClassCard(x: number, y: number, id: ClassId, w: number, h: number): Phaser.GameObjects.Container {
    const cls = CLASSES[id];
    const roleColor = ROLE_COLORS[cls.role] || 0x888888;
    const container = this.add.container(x, y);

    const bg = this.add.graphics();
    bg.fillStyle(0x2A1555, 1);
    bg.fillRoundedRect(-w / 2, -h / 2, w, h, 10);
    bg.lineStyle(2, 0x4A2880, 0.8);
    bg.strokeRoundedRect(-w / 2, -h / 2, w, h, 10);
    container.add(bg);

    // Role accent line
    const accent = this.add.graphics();
    accent.fillStyle(roleColor, 0.7);
    accent.fillRoundedRect(-w / 2 + 3, -h / 2 + 3, w - 6, 3, 2);
    container.add(accent);

    // Class icon centered
    const iconText = this.add.text(0, -h / 2 + 20, CLASS_ICONS[id] || '', {
      fontSize: '26px',
    }).setOrigin(0.5);
    container.add(iconText);

    // Class name
    const name = this.add.text(0, -h / 2 + 42, cls.name.toUpperCase(), {
      fontSize: '13px',
      color: '#f0e8ff',
      fontFamily: '"Nunito", sans-serif',
      fontStyle: 'bold',
    }).setOrigin(0.5, 0);
    container.add(name);

    // Role tag
    const roleText = this.add.text(0, -h / 2 + 60, cls.role.toUpperCase(), {
      fontSize: '9px',
      color: '#' + roleColor.toString(16).padStart(6, '0'),
      fontFamily: '"Nunito", sans-serif',
      letterSpacing: 1,
      fontStyle: 'bold',
    }).setOrigin(0.5, 0);
    container.add(roleText);

    // Ability name
    const ability = cls.abilities[0];
    if (ability) {
      const abilityText = this.add.text(0, -h / 2 + 78, ability.name, {
        fontSize: '10px',
        color: '#C98FFF',
        fontFamily: '"Nunito", sans-serif',
      }).setOrigin(0.5, 0);
      container.add(abilityText);
    }

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
        bg.fillStyle(0x352068, 1);
        bg.fillRoundedRect(-w / 2, -h / 2, w, h, 10);
        bg.lineStyle(2, 0xFF6B9D, 0.6);
        bg.strokeRoundedRect(-w / 2, -h / 2, w, h, 10);
      }
    });

    zone.on('pointerout', () => {
      if (container.getData('disabled')) return;
      if (!container.getData('selected')) {
        this.tweens.add({ targets: container, scaleX: 1, scaleY: 1, duration: 150 });
        bg.clear();
        bg.fillStyle(0x2A1555, 1);
        bg.fillRoundedRect(-w / 2, -h / 2, w, h, 10);
        bg.lineStyle(2, 0x4A2880, 0.8);
        bg.strokeRoundedRect(-w / 2, -h / 2, w, h, 10);
      }
    });

    zone.on('pointerdown', () => {
      if (container.getData('disabled')) return;
      this.selectClass(id);
    });

    return container;
  }

  private createAnimalCard(x: number, y: number, id: AnimalId, w: number, h: number): Phaser.GameObjects.Container {
    const animal = ANIMALS[id];
    const archColor = ARCHETYPE_COLORS[animal.archetype] || 0x888888;
    const container = this.add.container(x, y);

    const bg = this.add.graphics();
    bg.fillStyle(0x2A1555, 1);
    bg.fillRoundedRect(-w / 2, -h / 2, w, h, 10);
    bg.lineStyle(2, 0x4A2880, 0.8);
    bg.strokeRoundedRect(-w / 2, -h / 2, w, h, 10);
    container.add(bg);

    // Archetype accent
    const accent = this.add.graphics();
    accent.fillStyle(archColor, 0.6);
    accent.fillRoundedRect(-w / 2 + 3, -h / 2 + 3, w - 6, 3, 2);
    container.add(accent);

    // Icon
    const iconText = this.add.text(0, -h / 2 + 20, ANIMAL_ICONS[id] || id[0].toUpperCase(), {
      fontSize: '22px',
    }).setOrigin(0.5);
    container.add(iconText);

    // Name
    const name = this.add.text(0, -h / 2 + 44, animal.name.toUpperCase(), {
      fontSize: '11px',
      color: '#f0e8ff',
      fontFamily: '"Nunito", sans-serif',
      fontStyle: 'bold',
    }).setOrigin(0.5);
    container.add(name);

    // Stat hint
    const mods = animal.statModifiers;
    const modParts: string[] = [];
    if (mods.attack > 1) modParts.push('ATK+');
    if (mods.defense > 1) modParts.push('DEF+');
    if (mods.speed > 1) modParts.push('SPD+');
    if (mods.magic > 1) modParts.push('MAG+');
    if (mods.hp > 1) modParts.push('HP+');

    if (modParts.length > 0) {
      const modText = this.add.text(0, -h / 2 + 62, modParts.join(' '), {
        fontSize: '9px',
        color: '#' + archColor.toString(16).padStart(6, '0'),
        fontFamily: '"Nunito", sans-serif',
      }).setOrigin(0.5).setAlpha(0.8);
      container.add(modText);
    }

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
        bg.fillStyle(0x352068, 1);
        bg.fillRoundedRect(-w / 2, -h / 2, w, h, 10);
        bg.lineStyle(2, archColor, 0.6);
        bg.strokeRoundedRect(-w / 2, -h / 2, w, h, 10);
      }
    });

    zone.on('pointerout', () => {
      if (container.getData('disabled')) return;
      if (!container.getData('selected')) {
        this.tweens.add({ targets: container, scaleX: 1, scaleY: 1, duration: 150 });
        bg.clear();
        bg.fillStyle(0x2A1555, 1);
        bg.fillRoundedRect(-w / 2, -h / 2, w, h, 10);
        bg.lineStyle(2, 0x4A2880, 0.8);
        bg.strokeRoundedRect(-w / 2, -h / 2, w, h, 10);
      }
    });

    zone.on('pointerdown', () => {
      if (container.getData('disabled')) return;
      this.selectAnimal(id);
    });

    return container;
  }

  // ─── PICK TIMELINE ──────────────────────────────────────────────

  private createPickTimeline(centerX: number) {
    this.pickTimeline = this.add.container(centerX, 68);
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

      this.statsPanel.setAlpha(1);
      const panelW = 220;
      const panelH = 200;

      const panelBg = this.add.graphics();
      panelBg.fillStyle(0x1E1048, 0.95);
      panelBg.fillRoundedRect(0, 0, panelW, panelH, 10);
      panelBg.lineStyle(2, 0x4A2880, 0.6);
      panelBg.strokeRoundedRect(0, 0, panelW, panelH, 10);
      this.statsPanel.add(panelBg);

      const title = this.add.text(panelW / 2, 10, `${ANIMAL_ICONS[this.selectedAnimal] || ''} ${cls.name} + ${animal.name}`, {
        fontSize: '14px',
        color: '#fff',
        fontFamily: '"Nunito", sans-serif',
        fontStyle: 'bold',
      }).setOrigin(0.5, 0);
      this.statsPanel.add(title);

      // Compact stat bars
      const statConfig = [
        { key: 'HP', value: stats.hp, max: 210, color: 0x45E6B0 },
        { key: 'ATK', value: stats.attack, max: 50, color: 0xFF6B6B },
        { key: 'DEF', value: stats.defense, max: 30, color: 0x6CC4FF },
        { key: 'SPD', value: stats.speed, max: 7, color: 0x45E6B0 },
        { key: 'MAG', value: stats.magic, max: 50, color: 0xC98FFF },
      ];

      statConfig.forEach((s, i) => {
        const sy = 34 + i * 20;
        const label = this.add.text(10, sy, s.key, {
          fontSize: '9px', color: '#8B6DB0', fontFamily: '"Nunito", sans-serif', fontStyle: 'bold',
        });
        this.statsPanel.add(label);

        const barBg = this.add.rectangle(46, sy + 5, panelW - 80, 6, 0x2A1858).setOrigin(0, 0.5);
        this.statsPanel.add(barBg);
        const fillWidth = Math.min(1, s.value / s.max) * (panelW - 80);
        const barFill = this.add.rectangle(46, sy + 5, 0, 6, s.color, 0.8).setOrigin(0, 0.5);
        this.statsPanel.add(barFill);
        this.tweens.add({ targets: barFill, width: fillWidth, duration: 300, delay: i * 30, ease: 'Cubic.easeOut' });

        const value = this.add.text(panelW - 10, sy, String(s.value), {
          fontSize: '9px', color: '#cbb8ee', fontFamily: '"Nunito", sans-serif', fontStyle: 'bold',
        }).setOrigin(1, 0);
        this.statsPanel.add(value);
      });

      // Ability
      const ability = cls.abilities[0];
      if (ability) {
        const aName = this.add.text(10, 140, `⚡ ${ability.name}`, {
          fontSize: '11px', color: '#C98FFF', fontFamily: '"Nunito", sans-serif', fontStyle: 'bold',
        });
        this.statsPanel.add(aName);
        const aDesc = this.add.text(10, 155, ability.description, {
          fontSize: '8px', color: '#8B6DB0', fontFamily: '"Nunito", sans-serif',
          wordWrap: { width: panelW - 20 },
        });
        this.statsPanel.add(aDesc);
      }

      // Passive
      const passName = this.add.text(10, 175, `✨ ${animal.passive.name}`, {
        fontSize: '11px', color: '#FFD93D', fontFamily: '"Nunito", sans-serif', fontStyle: 'bold',
      });
      this.statsPanel.add(passName);

      this.tweens.add({
        targets: this.statsPanel,
        alpha: { from: 0, to: 1 },
        duration: 200,
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
    const w = 260, h = 44;

    const bg = this.add.graphics();
    bg.fillStyle(0x2A1858, 0.8);
    bg.fillRoundedRect(-w / 2, -h / 2, w, h, 12);
    bg.lineStyle(2, 0x4A2880, 0.5);
    bg.strokeRoundedRect(-w / 2, -h / 2, w, h, 12);
    container.add(bg);

    const text = this.add.text(0, 0, '✨ CONFIRM PICK ✨', {
      fontSize: '15px',
      color: '#7B5EA0',
      fontFamily: '"Fredoka", sans-serif',
      fontStyle: 'bold',
      letterSpacing: 3,
    }).setOrigin(0.5);
    container.add(text);

    // Zone is INSIDE the container at (0,0) so it moves/scales with the container
    const zone = this.add.zone(0, 0, w, h).setInteractive({ useHandCursor: true });
    container.add(zone);

    zone.on('pointerdown', () => {
      if (this.confirmBtnEnabled) {
        this.confirmPick();
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
    const w = 260, h = 44;

    bg.clear();
    if (enabled) {
      bg.fillStyle(0xFF6B9D, 0.3);
      bg.fillRoundedRect(-w / 2, -h / 2, w, h, 12);
      bg.lineStyle(2, 0xFF6B9D, 0.8);
      bg.strokeRoundedRect(-w / 2, -h / 2, w, h, 12);
      text.setColor('#fff');
    } else {
      bg.fillStyle(0x2A1858, 0.8);
      bg.fillRoundedRect(-w / 2, -h / 2, w, h, 12);
      bg.lineStyle(2, 0x4A2880, 0.5);
      bg.strokeRoundedRect(-w / 2, -h / 2, w, h, 12);
      text.setColor('#7B5EA0');
    }
  }

  // ─── SELECTION LOGIC ──────────────────────────────────────────

  private selectClass(id: ClassId) {
    if (this.draftFinished) return;
    if (this.usedClasses.has(id)) return;
    this.selectedClass = id;

    this.classCards.forEach((container, cid) => {
      const bg = container.getData('bg') as Phaser.GameObjects.Graphics;
      const w = container.getData('w') as number;
      const h = container.getData('h') as number;
      if (cid === id) {
        container.setData('selected', true);
        bg.clear();
        bg.fillStyle(0x352068, 1);
        bg.fillRoundedRect(-w / 2, -h / 2, w, h, 10);
        bg.lineStyle(3, 0xFF6B9D, 0.9);
        bg.strokeRoundedRect(-w / 2, -h / 2, w, h, 10);
        this.tweens.add({ targets: container, scaleX: 1.05, scaleY: 1.05, duration: 150 });
      } else {
        container.setData('selected', false);
        if (!this.usedClasses.has(cid)) {
          bg.clear();
          bg.fillStyle(0x2A1555, 1);
          bg.fillRoundedRect(-w / 2, -h / 2, w, h, 10);
          bg.lineStyle(2, 0x4A2880, 0.8);
          bg.strokeRoundedRect(-w / 2, -h / 2, w, h, 10);
        }
        this.tweens.add({ targets: container, scaleX: 1, scaleY: 1, duration: 150 });
      }
    });

    // Flash the animal label to draw attention if no animal selected yet
    if (!this.selectedAnimal && this.animalLabel) {
      if (this.animalHintTween) this.animalHintTween.stop();
      this.animalLabel.setColor('#FF6B9D');
      this.animalLabel.setText('🐾  ⬇ NOW PICK AN ANIMAL ⬇');
      this.animalHintTween = this.tweens.add({
        targets: this.animalLabel,
        alpha: { from: 1, to: 0.3 },
        duration: 400,
        yoyo: true,
        repeat: 5,
        onComplete: () => {
          this.animalLabel.setAlpha(1);
          this.animalLabel.setColor('#FFD93D');
          this.animalLabel.setText('🐾  PICK AN ANIMAL');
        },
      });
    }

    this.updatePreview();
  }

  private selectAnimal(id: AnimalId) {
    if (this.draftFinished) return;
    if (this.usedAnimals.has(id)) return;
    this.selectedAnimal = id;

    // Stop the hint flash
    if (this.animalHintTween) {
      this.animalHintTween.stop();
      this.animalLabel.setAlpha(1);
      this.animalLabel.setColor('#FFD93D');
      this.animalLabel.setText('🐾  PICK AN ANIMAL');
    }

    this.animalCards.forEach((container, aid) => {
      const bg = container.getData('bg') as Phaser.GameObjects.Graphics;
      const archColor = ARCHETYPE_COLORS[ANIMALS[aid as AnimalId]?.archetype] || 0x888888;
      const w = container.getData('w') as number;
      const h = container.getData('h') as number;
      if (aid === id) {
        container.setData('selected', true);
        bg.clear();
        bg.fillStyle(0x352068, 1);
        bg.fillRoundedRect(-w / 2, -h / 2, w, h, 10);
        bg.lineStyle(3, archColor, 0.9);
        bg.strokeRoundedRect(-w / 2, -h / 2, w, h, 10);
        this.tweens.add({ targets: container, scaleX: 1.06, scaleY: 1.06, duration: 150 });
      } else if (!this.usedAnimals.has(aid)) {
        container.setData('selected', false);
        bg.clear();
        bg.fillStyle(0x2A1555, 1);
        bg.fillRoundedRect(-w / 2, -h / 2, w, h, 10);
        bg.lineStyle(2, 0x4A2880, 0.8);
        bg.strokeRoundedRect(-w / 2, -h / 2, w, h, 10);
        this.tweens.add({ targets: container, scaleX: 1, scaleY: 1, duration: 150 });
      }
    });

    this.updatePreview();
  }

  // ─── CONFIRM & DRAFT LOGIC ───────────────────────────────────

  private confirmPick() {
    if (this.draftFinished) return;
    if (!this.selectedClass || !this.selectedAnimal) return;
    if (!this.isMyTurn()) return;
    if (this.usedClasses.has(this.selectedClass)) return;
    if (this.usedAnimals.has(this.selectedAnimal)) return;

    const pick: DraftPick = {
      playerId: this.playerId,
      classId: this.selectedClass,
      animalId: this.selectedAnimal,
      pickOrder: this.currentPickIndex,
    };

    this.processedPickIds.add(pick.pickOrder);
    this.picks.push(pick);
    this.usedClasses.add(this.selectedClass);
    this.usedAnimals.add(this.selectedAnimal);
    this.animatePickSlot(pick);
    this.myPickCount++;
    this.currentPickIndex++;

    if (!this.isLocal) {
      this.firebase.submitDraftPick(this.gameId, pick);
    }

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
    const availableAnimals = Object.keys(ANIMALS).filter(a => !this.usedAnimals.has(a));
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
    this.usedAnimals.add(animal);
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
        bg.fillStyle(0x2A1555, 1);
        bg.fillRoundedRect(-w / 2, -h / 2, w, h, 10);
        bg.lineStyle(2, 0x4A2880, 0.8);
        bg.strokeRoundedRect(-w / 2, -h / 2, w, h, 10);
        this.tweens.add({ targets: container, scaleX: 1, scaleY: 1, duration: 150 });
      }
    });
    this.animalCards.forEach((container, aid) => {
      const bg = container.getData('bg') as Phaser.GameObjects.Graphics;
      const w = container.getData('w') as number;
      const h = container.getData('h') as number;
      container.setData('selected', false);
      if (!this.usedAnimals.has(aid)) {
        bg.clear();
        bg.fillStyle(0x2A1555, 1);
        bg.fillRoundedRect(-w / 2, -h / 2, w, h, 10);
        bg.lineStyle(2, 0x4A2880, 0.8);
        bg.strokeRoundedRect(-w / 2, -h / 2, w, h, 10);
        this.tweens.add({ targets: container, scaleX: 1, scaleY: 1, duration: 150 });
      }
    });
    this.statsPanel.setAlpha(0);
    this.setConfirmEnabled(false);
  }

  private updateState() {
    // Grey out used classes
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

    // Grey out used animals
    this.animalCards.forEach((container, aid) => {
      if (this.usedAnimals.has(aid)) {
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

    // Stop previous slot pulse tween, start new one on current slot
    if (this.activeSlotTween) {
      this.activeSlotTween.stop();
      // Reset scale of all slots
      this.pickSlots.forEach(s => { s.scaleX = 1; s.scaleY = 1; });
    }
    if (this.currentPickIndex < 6) {
      const slot = this.pickSlots[this.currentPickIndex];
      this.activeSlotTween = this.tweens.add({
        targets: slot,
        scaleX: 1.1, scaleY: 1.1,
        duration: 400,
        yoyo: true,
        repeat: -1,
        ease: 'Sine.easeInOut',
      });
    }
  }

  // ─── TIMER ────────────────────────────────────────────────────

  private drawTimerRing(progress: number) {
    const { width } = this.cameras.main;
    const timerX = width - 35;
    this.timerRing.clear();
    this.timerRing.lineStyle(3, progress > 0.3 ? 0xFFD93D : 0xFF6B6B, 0.6);
    this.timerRing.beginPath();
    this.timerRing.arc(timerX, 28, 16, Phaser.Math.DegToRad(-90),
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
    const animals = Object.keys(ANIMALS).filter(a => !this.usedAnimals.has(a));
    this.selectedClass = available[0] as ClassId;
    this.selectedAnimal = animals[Math.floor(Math.random() * animals.length)] as AnimalId;
    this.confirmPick();
  }

  private draftFinished = false;

  private finishDraft() {
    if (this.draftFinished) return;
    this.draftFinished = true;
    if (this.timerEvent) this.timerEvent.destroy();
    if (this.activeSlotTween) this.activeSlotTween.stop();

    // Disable all cards immediately
    this.classCards.forEach(c => c.setData('disabled', true));
    this.animalCards.forEach(c => c.setData('disabled', true));
    this.confirmBtnEnabled = false;

    this.infoText.setText('DRAFT COMPLETE!');
    this.infoText.setColor('#45E6B0');

    // Transition to battle quickly
    this.cameras.main.fadeOut(400, 27, 16, 64);
    this.cameras.main.once('camerafadeoutcomplete', () => {
      this.scene.start('BattleScene', {
        gameId: this.gameId,
        playerId: this.playerId,
        isLocal: this.isLocal,
        picks: this.picks,
        amPlayer1: this.amPlayer1,
      });
    });
  }
}
