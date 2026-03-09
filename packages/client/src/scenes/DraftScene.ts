import Phaser from 'phaser';
import { HERO_PASSIVES, HeroPassive } from '@prompt-battle/shared';
import { generateCharacterName, resetNames } from '../systems/NameGenerator';

interface DraftSceneData {
  gameId: string;
  playerId: string;
  isLocal: boolean;
}

const ALL_PASSIVES: HeroPassive[] = ['rally_leader', 'iron_will', 'swift_command', 'keen_eye', 'battle_fury'];

interface HeroCard {
  name: string;
  passive: HeroPassive;
}

export class DraftScene extends Phaser.Scene {
  private gameId!: string;
  private playerId!: string;
  private isLocal!: boolean;

  private myHeroes: HeroCard[] = [];
  private enemyHeroes: HeroCard[] = [];

  constructor() {
    super({ key: 'DraftScene' });
  }

  init(data: DraftSceneData) {
    this.gameId = data.gameId;
    this.playerId = data.playerId;
    this.isLocal = data.isLocal;
  }

  create() {
    const { width, height } = this.cameras.main;
    this.cameras.main.setBackgroundColor('#1B1040');
    this.cameras.main.fadeIn(500, 27, 16, 64);

    resetNames();

    // Generate hero cards for both teams
    this.myHeroes = ALL_PASSIVES.map((passive) => ({
      name: generateCharacterName(),
      passive,
    }));
    this.enemyHeroes = ALL_PASSIVES.map((passive) => ({
      name: generateCharacterName(),
      passive,
    }));

    this.buildBriefingUI(width, height);
  }

  private buildBriefingUI(width: number, height: number) {
    // Background grid
    const gridGfx = this.add.graphics();
    gridGfx.lineStyle(1, 0xFF6B9D, 0.03);
    for (let x = 0; x < width; x += 50) gridGfx.lineBetween(x, 0, x, height);
    for (let y = 0; y < height; y += 50) gridGfx.lineBetween(0, y, width, y);

    // Title
    this.add.text(width / 2, 40, 'ANIMAL ARMY', {
      fontSize: '36px',
      color: '#FF6B9D',
      fontFamily: '"Fredoka", sans-serif',
      fontStyle: 'bold',
      letterSpacing: 8,
    }).setOrigin(0.5);

    this.add.text(width / 2, 78, 'BATTLE BRIEFING', {
      fontSize: '14px',
      color: '#cbb8ee',
      fontFamily: '"Nunito", sans-serif',
      fontStyle: 'bold',
      letterSpacing: 4,
    }).setOrigin(0.5);

    // Hero card dimensions (5 heroes now)
    const cardW = 140;
    const cardH = 110;
    const cardGap = 10;
    const heroCount = this.myHeroes.length;
    const totalCardsW = heroCount * cardW + (heroCount - 1) * cardGap;
    const cardsStartX = width / 2 - totalCardsW / 2 + cardW / 2;

    // "Your Heroes" section
    const yourLabelY = 120;
    this.add.text(width / 2, yourLabelY, 'Your Heroes:', {
      fontSize: '16px',
      color: '#6CC4FF',
      fontFamily: '"Fredoka", sans-serif',
      fontStyle: 'bold',
      letterSpacing: 2,
    }).setOrigin(0.5);

    const yourCardsY = yourLabelY + 30 + cardH / 2;
    this.myHeroes.forEach((hero, i) => {
      const x = cardsStartX + i * (cardW + cardGap);
      this.createHeroCard(x, yourCardsY, hero, cardW, cardH, 0x6CC4FF, i * 80);
    });

    // "Enemy Heroes" section
    const enemyLabelY = yourCardsY + cardH / 2 + 36;
    this.add.text(width / 2, enemyLabelY, 'Enemy Heroes:', {
      fontSize: '16px',
      color: '#FF6B6B',
      fontFamily: '"Fredoka", sans-serif',
      fontStyle: 'bold',
      letterSpacing: 2,
    }).setOrigin(0.5);

    const enemyCardsY = enemyLabelY + 30 + cardH / 2;
    this.enemyHeroes.forEach((hero, i) => {
      const x = cardsStartX + i * (cardW + cardGap);
      this.createHeroCard(x, enemyCardsY, hero, cardW, cardH, 0xFF6B6B, 200 + i * 80);
    });

    // START BATTLE button
    const btnY = Math.min(enemyCardsY + cardH / 2 + 50, height - 50);
    this.createStartButton(width / 2, btnY);
  }

  private createHeroCard(
    x: number, y: number,
    hero: HeroCard,
    w: number, h: number,
    accentColor: number,
    animDelay: number,
  ) {
    const container = this.add.container(x, y);

    // Card background
    const bg = this.add.graphics();
    bg.fillStyle(0x2A1555, 1);
    bg.fillRoundedRect(-w / 2, -h / 2, w, h, 10);
    bg.lineStyle(2, accentColor, 0.5);
    bg.strokeRoundedRect(-w / 2, -h / 2, w, h, 10);
    container.add(bg);

    // Accent line at top
    const accent = this.add.graphics();
    accent.fillStyle(accentColor, 0.7);
    accent.fillRoundedRect(-w / 2 + 3, -h / 2 + 3, w - 6, 3, 2);
    container.add(accent);

    const passiveInfo = HERO_PASSIVES[hero.passive];

    // Emoji
    const emoji = this.add.text(0, -h / 2 + 22, passiveInfo.emoji, {
      fontSize: '24px',
    }).setOrigin(0.5);
    container.add(emoji);

    // Hero name
    const nameText = this.add.text(0, -h / 2 + 46, hero.name.toUpperCase(), {
      fontSize: '15px',
      color: '#f0e8ff',
      fontFamily: '"Fredoka", sans-serif',
      fontStyle: 'bold',
    }).setOrigin(0.5);
    container.add(nameText);

    // Passive name
    const passiveName = this.add.text(0, -h / 2 + 66, passiveInfo.name, {
      fontSize: '11px',
      color: '#FFD93D',
      fontFamily: '"Nunito", sans-serif',
      fontStyle: 'bold',
    }).setOrigin(0.5);
    container.add(passiveName);

    // Passive description
    const passiveDesc = this.add.text(0, -h / 2 + 82, passiveInfo.description, {
      fontSize: '9px',
      color: '#8B6DB0',
      fontFamily: '"Nunito", sans-serif',
      wordWrap: { width: w - 20 },
      align: 'center',
    }).setOrigin(0.5, 0);
    container.add(passiveDesc);

    // Animate in
    container.setAlpha(0).setScale(0.85);
    this.tweens.add({
      targets: container,
      alpha: 1,
      scaleX: 1,
      scaleY: 1,
      duration: 350,
      delay: animDelay,
      ease: 'Back.easeOut',
    });

    return container;
  }

  private createStartButton(x: number, y: number) {
    const container = this.add.container(x, y);
    const w = 280;
    const h = 50;

    const bg = this.add.graphics();
    bg.fillStyle(0xFF6B9D, 0.3);
    bg.fillRoundedRect(-w / 2, -h / 2, w, h, 14);
    bg.lineStyle(2, 0xFF6B9D, 0.8);
    bg.strokeRoundedRect(-w / 2, -h / 2, w, h, 14);
    container.add(bg);

    const text = this.add.text(0, 0, 'START BATTLE', {
      fontSize: '18px',
      color: '#fff',
      fontFamily: '"Fredoka", sans-serif',
      fontStyle: 'bold',
      letterSpacing: 5,
    }).setOrigin(0.5);
    container.add(text);

    const zone = this.add.zone(0, 0, w, h).setInteractive({ useHandCursor: true });
    container.add(zone);

    zone.on('pointerover', () => {
      this.tweens.add({
        targets: container,
        scaleX: 1.05,
        scaleY: 1.05,
        duration: 150,
        ease: 'Back.easeOut',
      });
      bg.clear();
      bg.fillStyle(0xFF6B9D, 0.5);
      bg.fillRoundedRect(-w / 2, -h / 2, w, h, 14);
      bg.lineStyle(2, 0xFF6B9D, 1);
      bg.strokeRoundedRect(-w / 2, -h / 2, w, h, 14);
    });

    zone.on('pointerout', () => {
      this.tweens.add({
        targets: container,
        scaleX: 1,
        scaleY: 1,
        duration: 150,
      });
      bg.clear();
      bg.fillStyle(0xFF6B9D, 0.3);
      bg.fillRoundedRect(-w / 2, -h / 2, w, h, 14);
      bg.lineStyle(2, 0xFF6B9D, 0.8);
      bg.strokeRoundedRect(-w / 2, -h / 2, w, h, 14);
    });

    zone.on('pointerdown', () => {
      this.startBattle();
    });

    // Animate in
    container.setAlpha(0).setScale(0.9);
    this.tweens.add({
      targets: container,
      alpha: 1,
      scaleX: 1,
      scaleY: 1,
      duration: 400,
      delay: 600,
      ease: 'Back.easeOut',
    });
  }

  private startBattle() {
    this.cameras.main.fadeOut(400, 27, 16, 64);
    this.cameras.main.once('camerafadeoutcomplete', () => {
      this.scene.start('BattleScene', {
        gameId: this.gameId,
        playerId: this.playerId,
        isLocal: this.isLocal,
        picks: [],
        amPlayer1: true,
        heroConfig: {
          myHeroes: this.myHeroes,
          enemyHeroes: this.enemyHeroes,
        },
      });
    });
  }
}
