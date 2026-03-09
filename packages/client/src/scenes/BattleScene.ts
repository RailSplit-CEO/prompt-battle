import Phaser from 'phaser';
import {
  Hero, HeroOrder, AnimalUnit, Camp, Structure, Base,
  GameState, Position, AnimalType, TileType,
  HERO_BASE_STATS, HERO_RESPAWN_BASE, HERO_RESPAWN_COMEBACK_BONUS,
  BASE_MAX_HP, MAX_UNITS, MAX_UNITS_PER_HERO,
  CAMP_SCALING_INTERVAL, CAMP_SCALING_AMOUNT, CAMP_NEUTRAL_TIMER,
  HERO_PASSIVES, HeroPassive, UpgradeType, UPGRADE_EFFECTS,
  UNIT_DEFS, getScaledUnitStats, getCounterMultiplier,
  createAllCamps, createAllStructures,
  getBark, BarkTrigger,
} from '@prompt-battle/shared';
import { CharacterEntity } from '../entities/Character';
import { FollowerEntity } from '../entities/Follower';
import {
  generateMap, GameMap, MAP_WIDTH, MAP_HEIGHT, TILE_SIZE, isPassable,
} from '../map/MapGenerator';
import { findPath } from '../map/Pathfinding';
import { CommandInput } from '../systems/CommandInput';
import { generateCharacterName, resetNames } from '../systems/NameGenerator';
import {
  parseCommandWithGemini, GeminiParseResult,
} from '../systems/GeminiCommandParser';
import { SoundManager } from '../systems/SoundManager';
import { TtsService } from '../systems/TtsService';
import { getGambitOrder, GambitContext } from '../systems/GambitAI';
import { MiniMap } from '../systems/MiniMap';

// ─── CONSTANTS ────────────────────────────────────────────────
const GAME_DURATION = 300;
const TICK_RATE = 750;
const MOVE_TICK = 500;
const BASE_VISION = 8;
const CAMP_ATTACK_RANGE = 2;
const STRUCTURE_ATTACK_RANGE = 2;
const HERO_ATTACK_RANGE = 2;
const BASE_ATTACK_RANGE = 3;

// ─── TYPES ────────────────────────────────────────────────────

interface HeroConfig {
  name: string;
  passive: HeroPassive;
}

interface BattleSceneData {
  gameId: string;
  playerId: string;
  isLocal: boolean;
  picks: any[];
  amPlayer1?: boolean;
  heroConfig?: {
    myHeroes: HeroConfig[];
    enemyHeroes: HeroConfig[];
  };
}

// ─── SCENE ────────────────────────────────────────────────────

export class BattleScene extends Phaser.Scene {
  private gameId!: string;
  private playerId!: string;
  private isLocal!: boolean;

  private get myTeam(): 'player1' | 'player2' { return 'player1'; }
  private get enemyTeam(): 'player1' | 'player2' { return 'player2'; }

  private gameMap!: GameMap;
  private state!: GameState;
  private heroEntities: Map<string, CharacterEntity> = new Map();
  private unitEntities: Map<string, FollowerEntity> = new Map();

  // Camp & structure sprites
  private campSprites: Map<string, Phaser.GameObjects.Container> = new Map();
  private structureSprites: Map<string, Phaser.GameObjects.Container> = new Map();
  private baseSprites: Map<string, Phaser.GameObjects.Container> = new Map();

  // Input
  private commandInput!: CommandInput;
  private hasGemini = false;
  private selectedHeroIdx = 0; // 0, 1, or 2

  // Fog of war
  private fogLayer!: Phaser.GameObjects.Graphics;
  private visibleTiles: Set<string> = new Set();

  // Timers
  private gameTickTimer?: Phaser.Time.TimerEvent;
  private moveTickTimer?: Phaser.Time.TimerEvent;
  private secondTimer?: Phaser.Time.TimerEvent;
  private gameOver = false;

  // Systems
  private sound_: SoundManager = SoundManager.getInstance();
  private tts: TtsService = new TtsService();
  private miniMap!: MiniMap;

  // HUD
  private timerText!: Phaser.GameObjects.Text;
  private baseHpTexts!: { p1: Phaser.GameObjects.Text; p2: Phaser.GameObjects.Text };
  private upgradeIcons: Phaser.GameObjects.Text[] = [];
  private heroSelectTexts: Phaser.GameObjects.Text[] = [];

  // Map rendering
  private tileSprites: Phaser.GameObjects.Sprite[][] = [];

  // Path visualization
  private pathGraphics!: Phaser.GameObjects.Graphics;

  // Unit ID counter
  private unitIdCounter = 0;

  constructor() {
    super({ key: 'BattleScene' });
  }

  init(data: BattleSceneData) {
    this.gameId = data.gameId;
    this.playerId = data.playerId;
    this.isLocal = data.isLocal;
  }

  create(data: BattleSceneData) {
    this.cameras.main.setBackgroundColor('#1B1040');

    // Generate map
    const seed = Date.now();
    this.gameMap = generateMap(seed);

    // Check Gemini
    this.hasGemini = !!(import.meta as any).env?.VITE_GEMINI_API_KEY;

    // Create initial game state
    const heroConfig = data.heroConfig;
    this.state = this.createInitialState(heroConfig);

    // Render map tiles
    this.renderMap();

    // Render objectives
    this.renderCamps();
    this.renderStructures();
    this.renderBases();

    // Render heroes
    this.renderHeroes();

    // Path graphics
    this.pathGraphics = this.add.graphics().setDepth(5);

    // Fog of war
    this.fogLayer = this.add.graphics().setDepth(50);

    // Camera
    this.cameras.main.setBounds(0, 0, MAP_WIDTH * TILE_SIZE, MAP_HEIGHT * TILE_SIZE);
    const spawnPos = this.gameMap.spawnP1[0];
    this.cameras.main.centerOn(spawnPos.x * TILE_SIZE, spawnPos.y * TILE_SIZE);

    // MiniMap
    this.miniMap = new MiniMap(this, this.gameMap.tiles);

    // HUD
    this.createHUD();
    this.buildHeroBar();

    // Input
    this.setupInput(data);

    // Select first hero
    this.selectHero(0);

    // Start game ticks
    this.startTicks();

    // Fade in
    this.cameras.main.fadeIn(600, 27, 16, 64);
  }

  // ─── STATE CREATION ──────────────────────────────────────

  private createInitialState(heroConfig?: { myHeroes: HeroConfig[]; enemyHeroes: HeroConfig[] }): GameState {
    resetNames();

    const heroes: Record<string, Hero> = {};
    const passives: HeroPassive[] = ['rally_leader', 'iron_will', 'swift_command', 'keen_eye', 'battle_fury'];

    // Player 1 heroes
    const p1Spawns = this.gameMap.spawnP1;
    const p1Configs = heroConfig?.myHeroes ?? passives.map(p => ({ name: generateCharacterName(), passive: p }));
    for (let i = 0; i < 5; i++) {
      const id = `p1_hero_${i}`;
      const cfg = p1Configs[i];
      heroes[id] = {
        id,
        name: cfg.name,
        team: 'player1',
        passive: cfg.passive,
        currentHp: HERO_BASE_STATS.maxHp,
        maxHp: HERO_BASE_STATS.maxHp,
        attack: HERO_BASE_STATS.attack,
        defense: HERO_BASE_STATS.defense,
        speed: HERO_BASE_STATS.speed,
        range: HERO_BASE_STATS.range,
        position: { ...p1Spawns[i % p1Spawns.length] },
        isDead: false,
        respawnTimer: 0,
        path: [],
        currentOrder: null,
        orderQueue: [],
        upgrades: [],
        visionRange: HERO_BASE_STATS.visionRange,
        isActiveHero: i === 0,
        attackCooldown: 0,
      };
    }

    // Player 2 heroes
    const p2Spawns = this.gameMap.spawnP2;
    const p2Configs = heroConfig?.enemyHeroes ?? passives.map(p => ({ name: generateCharacterName(), passive: p }));
    for (let i = 0; i < 5; i++) {
      const id = `p2_hero_${i}`;
      const cfg = p2Configs[i];
      heroes[id] = {
        id,
        name: cfg.name,
        team: 'player2',
        passive: cfg.passive,
        currentHp: HERO_BASE_STATS.maxHp,
        maxHp: HERO_BASE_STATS.maxHp,
        attack: HERO_BASE_STATS.attack,
        defense: HERO_BASE_STATS.defense,
        speed: HERO_BASE_STATS.speed,
        range: HERO_BASE_STATS.range,
        position: { ...p2Spawns[i % p2Spawns.length] },
        isDead: false,
        respawnTimer: 0,
        path: [],
        currentOrder: null,
        orderQueue: [],
        upgrades: [],
        visionRange: HERO_BASE_STATS.visionRange,
        isActiveHero: false,
        attackCooldown: 0,
      };
    }

    const camps = createAllCamps();
    const structures = createAllStructures();

    const blueBase: Base = {
      position: { x: 5, y: 35 },
      hp: BASE_MAX_HP,
      maxHp: BASE_MAX_HP,
    };
    const redBase: Base = {
      position: { x: 45, y: 5 },
      hp: BASE_MAX_HP,
      maxHp: BASE_MAX_HP,
    };

    return {
      meta: {
        player1: 'player1',
        player2: 'player2',
        mapSeed: Date.now(),
        status: 'playing',
        currentTurn: 0,
        createdAt: Date.now(),
        gameDuration: GAME_DURATION,
        timeRemaining: GAME_DURATION,
        gameTime: 0,
      },
      heroes,
      units: [],
      camps,
      structures,
      bases: { player1: blueBase, player2: redBase },
      commandLog: [],
    };
  }

  // ─── RENDERING ───────────────────────────────────────────

  private renderMap() {
    this.tileSprites = [];
    for (let y = 0; y < MAP_HEIGHT; y++) {
      this.tileSprites[y] = [];
      for (let x = 0; x < MAP_WIDTH; x++) {
        const tile = this.gameMap.tiles[y][x];
        const sprite = this.add.sprite(
          x * TILE_SIZE + TILE_SIZE / 2,
          y * TILE_SIZE + TILE_SIZE / 2,
          `tile_${tile}`,
        ).setDepth(0);
        this.tileSprites[y][x] = sprite;
      }
    }
  }

  private renderCamps() {
    for (const camp of this.state.camps) {
      const px = camp.position.x * TILE_SIZE + TILE_SIZE / 2;
      const py = camp.position.y * TILE_SIZE + TILE_SIZE / 2;

      const container = this.add.container(px, py).setDepth(3);

      // Capture ring (large, visible from distance) — starts gray
      const ring = this.add.graphics();
      ring.lineStyle(3, 0x666666, 0.6);
      ring.strokeCircle(0, 0, 22);
      container.add(ring);
      (container as any)._ring = ring;

      // Camp marker sprite
      const marker = this.add.sprite(0, 0, 'camp_neutral').setScale(1.2);
      container.add(marker);

      // Camp emoji
      const emoji = this.add.text(0, -2, camp.emoji, { fontSize: '16px' }).setOrigin(0.5);
      container.add(emoji);

      // Camp name label
      const label = this.add.text(0, 20, camp.name, {
        fontSize: '7px',
        color: '#888',
        fontFamily: '"Nunito", sans-serif',
        fontStyle: 'bold',
        shadow: { offsetX: 1, offsetY: 1, color: '#000', blur: 2, fill: true, stroke: true },
      }).setOrigin(0.5);
      container.add(label);
      (container as any)._label = label;

      // Status text (shows "CAPTURED" or "NEUTRAL")
      const statusText = this.add.text(0, -22, '', {
        fontSize: '6px',
        color: '#FFD93D',
        fontFamily: '"Fredoka", sans-serif',
        fontStyle: 'bold',
        backgroundColor: 'rgba(0,0,0,0.6)',
        padding: { x: 3, y: 1 },
      }).setOrigin(0.5).setVisible(false);
      container.add(statusText);
      (container as any)._statusText = statusText;

      this.campSprites.set(camp.id, container);
    }
  }

  private renderStructures() {
    for (const structure of this.state.structures) {
      const px = structure.position.x * TILE_SIZE + TILE_SIZE / 2;
      const py = structure.position.y * TILE_SIZE + TILE_SIZE / 2;

      const container = this.add.container(px, py).setDepth(3);

      const marker = this.add.sprite(0, 0, 'structure').setScale(1.3);
      container.add(marker);

      const emoji = this.add.text(0, -3, structure.emoji, { fontSize: '18px' }).setOrigin(0.5);
      container.add(emoji);

      // HP bar
      const hpBg = this.add.rectangle(0, 18, 30, 4, 0x000000, 0.7).setOrigin(0.5);
      container.add(hpBg);
      const hpFill = this.add.rectangle(0, 18, 30, 4, 0x45E6B0).setOrigin(0.5);
      container.add(hpFill);
      (container as any)._hpFill = hpFill;

      // Label
      const label = this.add.text(0, 26, structure.name, {
        fontSize: '7px',
        color: '#FFD93D',
        fontFamily: '"Nunito", sans-serif',
        fontStyle: 'bold',
        shadow: { offsetX: 1, offsetY: 1, color: '#000', blur: 2, fill: true, stroke: true },
      }).setOrigin(0.5);
      container.add(label);

      this.structureSprites.set(structure.id, container);
    }
  }

  private renderBases() {
    const renderBase = (base: Base, team: 'player1' | 'player2') => {
      const px = base.position.x * TILE_SIZE + TILE_SIZE / 2;
      const py = base.position.y * TILE_SIZE + TILE_SIZE / 2;

      const container = this.add.container(px, py).setDepth(3);
      const sprite = this.add.sprite(0, 0, `base_${team === 'player1' ? 'p1' : 'p2'}`).setScale(1.5);
      container.add(sprite);

      const emoji = this.add.text(0, -2, team === 'player1' ? '🏰' : '🏯', { fontSize: '20px' }).setOrigin(0.5);
      container.add(emoji);

      // HP bar
      const hpBg = this.add.rectangle(0, 24, 40, 5, 0x000000, 0.7).setOrigin(0.5);
      container.add(hpBg);
      const hpFill = this.add.rectangle(0, 24, 40, 5, team === 'player1' ? 0x4499FF : 0xFF5555).setOrigin(0.5);
      container.add(hpFill);
      (container as any)._hpFill = hpFill;

      this.baseSprites.set(team, container);
    };

    renderBase(this.state.bases.player1, 'player1');
    renderBase(this.state.bases.player2, 'player2');
  }

  private renderHeroes() {
    const heroIds = Object.keys(this.state.heroes);
    for (const heroId of heroIds) {
      const hero = this.state.heroes[heroId];
      const isP1 = hero.team === 'player1';
      const entity = new CharacterEntity(this, hero, isP1);
      this.heroEntities.set(heroId, entity);
    }
  }

  // ─── HUD ─────────────────────────────────────────────────

  private createHUD() {
    const { width, height } = this.cameras.main;

    // Timer
    this.timerText = this.add.text(width / 2, 10, '5:00', {
      fontSize: '18px',
      color: '#FFD93D',
      fontFamily: '"Fredoka", sans-serif',
      fontStyle: 'bold',
      shadow: { offsetX: 1, offsetY: 1, color: '#000', blur: 3, fill: true, stroke: true },
      backgroundColor: 'rgba(0,0,0,0.5)',
      padding: { x: 8, y: 4 },
    }).setOrigin(0.5, 0).setScrollFactor(0).setDepth(100);

    // Base HP texts
    this.baseHpTexts = {
      p1: this.add.text(10, 10, '🏰 500/500', {
        fontSize: '12px', color: '#6CC4FF',
        fontFamily: '"Nunito", sans-serif', fontStyle: 'bold',
        shadow: { offsetX: 1, offsetY: 1, color: '#000', blur: 2, fill: true, stroke: true },
      }).setScrollFactor(0).setDepth(100),
      p2: this.add.text(width - 10, 10, '🏯 500/500', {
        fontSize: '12px', color: '#FF6B6B',
        fontFamily: '"Nunito", sans-serif', fontStyle: 'bold',
        shadow: { offsetX: 1, offsetY: 1, color: '#000', blur: 2, fill: true, stroke: true },
      }).setOrigin(1, 0).setScrollFactor(0).setDepth(100),
    };

    // Hero selection indicators (bottom-left)
    const myHeroIds = this.getMyHeroIds();
    for (let i = 0; i < myHeroIds.length; i++) {
      const hero = this.state.heroes[myHeroIds[i]];
      const text = this.add.text(10, height - 80 + i * 22, `[${i + 1}] ${hero.name}`, {
        fontSize: '12px',
        color: i === 0 ? '#FFD93D' : '#8B6DB0',
        fontFamily: '"Nunito", sans-serif',
        fontStyle: 'bold',
        shadow: { offsetX: 1, offsetY: 1, color: '#000', blur: 2, fill: true, stroke: true },
        backgroundColor: 'rgba(0,0,0,0.4)',
        padding: { x: 4, y: 2 },
      }).setScrollFactor(0).setDepth(100);
      this.heroSelectTexts.push(text);
    }
  }

  private updateHUD() {
    const tr = this.state.meta.timeRemaining;
    const min = Math.floor(tr / 60);
    const sec = tr % 60;
    this.timerText.setText(`${min}:${sec.toString().padStart(2, '0')}`);

    const b1 = this.state.bases.player1;
    const b2 = this.state.bases.player2;
    this.baseHpTexts.p1.setText(`🏰 ${Math.round(b1.hp)}/${b1.maxHp}`);
    this.baseHpTexts.p2.setText(`🏯 ${Math.round(b2.hp)}/${b2.maxHp}`);

    // Update hero select labels
    const myHeroIds = this.getMyHeroIds();
    for (let i = 0; i < myHeroIds.length; i++) {
      const hero = this.state.heroes[myHeroIds[i]];
      const armyCount = this.state.units.filter(u => u.ownerId === hero.id && !u.isDead).length;
      const statusStr = hero.isDead ? ' [DEAD]' : ` (x${armyCount})`;
      this.heroSelectTexts[i].setText(`[${i + 1}] ${hero.name}${statusStr}`);
      this.heroSelectTexts[i].setColor(i === this.selectedHeroIdx ? '#FFD93D' : '#8B6DB0');
    }

    // Update base sprite HP bars
    this.updateBaseSprite('player1', b1);
    this.updateBaseSprite('player2', b2);

    // Update structure HP bars
    for (const structure of this.state.structures) {
      const container = this.structureSprites.get(structure.id);
      if (!container) continue;
      const hpFill = (container as any)._hpFill as Phaser.GameObjects.Rectangle;
      if (hpFill) {
        const ratio = Math.max(0, structure.hp / structure.maxHp);
        hpFill.setDisplaySize(30 * ratio, 4);
      }
      if (structure.hp <= 0) {
        container.setAlpha(0.4);
      }
    }

    // Update HTML hero bar
    this.updateHeroBar();

    // Update camp visuals — ring, label, status for capture state
    for (const camp of this.state.camps) {
      const container = this.campSprites.get(camp.id);
      if (!container) continue;

      const ring = (container as any)._ring as Phaser.GameObjects.Graphics;
      const label = (container as any)._label as Phaser.GameObjects.Text;
      const statusText = (container as any)._statusText as Phaser.GameObjects.Text;
      // marker is after ring in list (index 1)
      const marker = container.list[1] as Phaser.GameObjects.Sprite;

      if (camp.capturedTeam === 'player1') {
        marker.setTexture('camp_p1');
        ring.clear();
        ring.lineStyle(3, 0x4499FF, 0.9);
        ring.strokeCircle(0, 0, 22);
        ring.fillStyle(0x4499FF, 0.12);
        ring.fillCircle(0, 0, 22);
        label.setColor('#6CC4FF');
        statusText.setText('BLUE').setColor('#6CC4FF').setVisible(true);
        container.setScale(1.1);
      } else if (camp.capturedTeam === 'player2') {
        marker.setTexture('camp_p2');
        ring.clear();
        ring.lineStyle(3, 0xFF5555, 0.9);
        ring.strokeCircle(0, 0, 22);
        ring.fillStyle(0xFF5555, 0.12);
        ring.fillCircle(0, 0, 22);
        label.setColor('#FF6B6B');
        statusText.setText('RED').setColor('#FF6B6B').setVisible(true);
        container.setScale(1.1);
      } else {
        marker.setTexture('camp_neutral');
        ring.clear();
        ring.lineStyle(2, 0x666666, 0.4);
        ring.strokeCircle(0, 0, 22);
        label.setColor('#888');
        statusText.setVisible(false);
        container.setScale(1.0);
      }
    }
  }

  private updateBaseSprite(team: string, base: Base) {
    const container = this.baseSprites.get(team);
    if (!container) return;
    const hpFill = (container as any)._hpFill as Phaser.GameObjects.Rectangle;
    if (hpFill) {
      const ratio = Math.max(0, base.hp / base.maxHp);
      hpFill.setDisplaySize(40 * ratio, 5);
    }
  }

  // ─── HTML HERO BAR & VOICE UI ──────────────────────────────

  private buildHeroBar() {
    const heroBar = document.getElementById('hero-bar');
    const heroRow = document.getElementById('hero-row');
    if (!heroBar || !heroRow) return;

    heroRow.innerHTML = '';
    heroBar.style.display = 'block';

    const myHeroIds = this.getMyHeroIds();
    for (let i = 0; i < myHeroIds.length; i++) {
      const hero = this.state.heroes[myHeroIds[i]];
      const passiveEmoji = HERO_PASSIVES[hero.passive]?.emoji || '⭐';

      const slot = document.createElement('div');
      slot.className = `hero-slot${i === 0 ? ' active' : ''}`;
      slot.id = `hero-slot-${i}`;
      slot.innerHTML = `
        <span class="hotkey">${i + 1}</span>
        <span class="hero-icon">${passiveEmoji}</span>
        <div class="hero-info">
          <span class="hero-name">${hero.name}</span>
          <span class="hero-class">${HERO_PASSIVES[hero.passive].name}</span>
          <span class="hero-companion" id="hero-army-${i}">Army: 0</span>
          <div class="hero-hp-bar"><div class="hero-hp-fill" id="hero-hp-${i}" style="width:100%"></div></div>
        </div>
      `;
      slot.addEventListener('click', () => this.selectHero(i));
      heroRow.appendChild(slot);
    }

    // Voice section
    const voiceSection = document.createElement('div');
    voiceSection.className = 'voice-section';
    voiceSection.innerHTML = `
      <span class="voice-label">Hold [Space] to speak</span>
      <span class="voice-transcript" id="voice-transcript"></span>
    `;
    heroRow.appendChild(voiceSection);

    // Command log
    const cmdLog = document.getElementById('command-log');
    if (cmdLog) {
      cmdLog.style.display = 'block';
      cmdLog.innerHTML = '';
    }
  }

  private updateHeroBar() {
    const myHeroIds = this.getMyHeroIds();
    for (let i = 0; i < myHeroIds.length; i++) {
      const hero = this.state.heroes[myHeroIds[i]];
      const armyCount = this.state.units.filter(u => u.ownerId === hero.id && !u.isDead).length;

      const slot = document.getElementById(`hero-slot-${i}`);
      if (slot) {
        slot.className = `hero-slot${i === this.selectedHeroIdx ? ' active' : ''}${hero.isDead ? ' dead' : ''}`;
      }

      const armyEl = document.getElementById(`hero-army-${i}`);
      if (armyEl) {
        armyEl.textContent = hero.isDead
          ? `Respawn: ${Math.ceil(hero.respawnTimer)}s`
          : `Army: ${armyCount}`;
      }

      const hpFill = document.getElementById(`hero-hp-${i}`) as HTMLElement;
      if (hpFill) {
        const ratio = hero.isDead ? 0 : (hero.currentHp / hero.maxHp) * 100;
        hpFill.style.width = `${ratio}%`;
        hpFill.className = 'hero-hp-fill' + (ratio < 25 ? ' low' : ratio < 50 ? ' mid' : '');
      }
    }
  }

  private addCommandLog(playerLabel: string, rawText: string, result: string) {
    const cmdLog = document.getElementById('command-log');
    if (!cmdLog) return;

    const entry = document.createElement('div');
    entry.className = 'log-entry';
    entry.innerHTML = `
      <span class="player">${playerLabel}</span>: <span class="text">"${rawText}"</span>
      <div class="result">${result}</div>
    `;
    cmdLog.appendChild(entry);
    cmdLog.scrollTop = cmdLog.scrollHeight;

    // Keep max 20 entries
    while (cmdLog.children.length > 20) {
      cmdLog.removeChild(cmdLog.children[0]);
    }
  }

  // ─── INPUT ───────────────────────────────────────────────

  private setupInput(data: BattleSceneData) {
    // Keyboard
    if (this.input.keyboard) {
      // Hero selection: 1-5
      this.input.keyboard.on('keydown-ONE', () => this.selectHero(0));
      this.input.keyboard.on('keydown-TWO', () => this.selectHero(1));
      this.input.keyboard.on('keydown-THREE', () => this.selectHero(2));
      this.input.keyboard.on('keydown-FOUR', () => this.selectHero(3));
      this.input.keyboard.on('keydown-FIVE', () => this.selectHero(4));

      // Camera: WASD + zoom with Q/E + center on hero with F
      const cursors = {
        w: this.input.keyboard.addKey('W'),
        a: this.input.keyboard.addKey('A'),
        s: this.input.keyboard.addKey('S'),
        d: this.input.keyboard.addKey('D'),
      };

      // Zoom in/out with Q/E
      this.input.keyboard.on('keydown-Q', () => {
        const cam = this.cameras.main;
        cam.setZoom(Math.min(cam.zoom + 0.25, 3));
      });
      this.input.keyboard.on('keydown-E', () => {
        const cam = this.cameras.main;
        cam.setZoom(Math.max(cam.zoom - 0.25, 0.5));
      });

      // Center camera on selected hero with F
      this.input.keyboard.on('keydown-F', () => {
        const hero = this.getSelectedHero();
        if (hero && !hero.isDead) {
          this.cameras.main.centerOn(
            hero.position.x * TILE_SIZE + TILE_SIZE / 2,
            hero.position.y * TILE_SIZE + TILE_SIZE / 2,
          );
        }
      });

      this.events.on('update', () => {
        const cam = this.cameras.main;
        const speed = 6 / cam.zoom; // scale speed by zoom
        if (cursors.w.isDown) cam.scrollY -= speed;
        if (cursors.s.isDown) cam.scrollY += speed;
        if (cursors.a.isDown) cam.scrollX -= speed;
        if (cursors.d.isDown) cam.scrollX += speed;
      });

      // Mouse wheel zoom
      this.input.on('wheel', (_pointer: any, _gos: any, _dx: number, dy: number) => {
        const cam = this.cameras.main;
        const newZoom = Phaser.Math.Clamp(cam.zoom - dy * 0.001, 0.5, 3);
        cam.setZoom(newZoom);
      });
    }

    // Mouse click: right-click to move, left-click on objectives to attack
    this.input.on('pointerdown', (pointer: Phaser.Input.Pointer) => {
      if (this.gameOver) return;

      // Check minimap click first
      if (this.miniMap) {
        const mmPos = this.miniMap.handleClick(pointer);
        if (mmPos) {
          const cam = this.cameras.main;
          cam.centerOn(mmPos.x * TILE_SIZE, mmPos.y * TILE_SIZE);
          return;
        }
      }

      const worldX = pointer.worldX;
      const worldY = pointer.worldY;
      const tileX = Math.floor(worldX / TILE_SIZE);
      const tileY = Math.floor(worldY / TILE_SIZE);

      const hero = this.getSelectedHero();
      if (!hero || hero.isDead) return;

      if (pointer.rightButtonDown()) {
        // Right-click: move
        this.issueOrder(hero.id, { type: 'move', targetPosition: { x: tileX, y: tileY } });
      } else {
        // Left-click: check for targets
        const target = this.findClickTarget(tileX, tileY);
        if (target) {
          this.issueOrder(hero.id, target);
        } else {
          // Move to clicked position
          this.issueOrder(hero.id, { type: 'move', targetPosition: { x: tileX, y: tileY } });
        }
      }
    });

    // Voice commands
    this.commandInput = new CommandInput(this, this.gameId, this.playerId, this.isLocal);
    this.commandInput.onCommand(async (rawText: string) => {
      if (this.gameOver || !this.hasGemini) return;
      try {
        const result = await parseCommandWithGemini(rawText, this.state, 'player1');
        const actionNames: string[] = [];
        for (const action of result.actions) {
          this.issueOrder(action.heroId, {
            type: action.type as any,
            targetId: action.targetId,
            targetPosition: action.targetPosition,
          });
          const hero = this.state.heroes[action.heroId];
          actionNames.push(`${hero?.name || '?'} → ${action.type.replace(/_/g, ' ')}`);
        }
        this.addCommandLog('You', rawText, actionNames.join(', ') || 'No actions');
      } catch (err) {
        console.error('Gemini parse error:', err);
        this.addCommandLog('You', rawText, 'Failed to parse command');
      }
    });
  }

  private findClickTarget(tileX: number, tileY: number): HeroOrder | null {
    // Check camps
    for (const camp of this.state.camps) {
      if (this.tileDist(camp.position, { x: tileX, y: tileY }) <= 2) {
        return { type: 'attack_camp', targetId: camp.id, targetPosition: camp.position };
      }
    }
    // Check structures
    for (const structure of this.state.structures) {
      if (structure.hp <= 0) continue;
      if (this.tileDist(structure.position, { x: tileX, y: tileY }) <= 2) {
        return { type: 'attack_structure', targetId: structure.id, targetPosition: structure.position };
      }
    }
    // Check enemy heroes
    for (const heroId of Object.keys(this.state.heroes)) {
      const enemy = this.state.heroes[heroId];
      if (enemy.team === this.myTeam || enemy.isDead) continue;
      if (this.tileDist(enemy.position, { x: tileX, y: tileY }) <= 1) {
        return { type: 'attack_hero', targetId: enemy.id, targetPosition: enemy.position };
      }
    }
    // Check enemy base
    const enemyBase = this.state.bases[this.enemyTeam];
    if (this.tileDist(enemyBase.position, { x: tileX, y: tileY }) <= 3) {
      return { type: 'attack_base', targetPosition: enemyBase.position };
    }
    return null;
  }

  private selectHero(idx: number) {
    const myHeroIds = this.getMyHeroIds();
    if (idx >= myHeroIds.length) return;

    // Deselect previous
    const prevId = myHeroIds[this.selectedHeroIdx];
    const prevEntity = this.heroEntities.get(prevId);
    if (prevEntity) prevEntity.deselect();

    this.selectedHeroIdx = idx;
    const newId = myHeroIds[idx];
    const newEntity = this.heroEntities.get(newId);
    if (newEntity) {
      newEntity.select();
      // Center camera on selected hero
      const hero = this.state.heroes[newId];
      this.cameras.main.centerOn(
        hero.position.x * TILE_SIZE + TILE_SIZE / 2,
        hero.position.y * TILE_SIZE + TILE_SIZE / 2,
      );
    }
  }

  private issueOrder(heroId: string, order: HeroOrder) {
    const hero = this.state.heroes[heroId];
    if (!hero || hero.isDead) return;

    hero.currentOrder = order;
    hero.path = [];

    // Update order text on entity
    const entity = this.heroEntities.get(heroId);
    if (entity) {
      const orderText = order.type.replace(/_/g, ' ').toUpperCase();
      entity.setOrderText(orderText);
    }

    // Show bark + TTS
    const barkTrigger: BarkTrigger | null =
      order.type.startsWith('attack') ? 'order_attack'
        : order.type === 'move' ? 'order_move'
          : order.type === 'defend' ? 'order_defend'
            : null;
    if (barkTrigger) {
      const bark = getBark(barkTrigger);
      if (bark && entity) {
        entity.showBark(bark);
        // Only TTS for player heroes
        if (hero.team === this.myTeam) {
          this.tts.speak(heroId, bark);
        }
      }
    }
  }

  // ─── GAME TICKS ──────────────────────────────────────────

  private startTicks() {
    this.secondTimer = this.time.addEvent({
      delay: 1000, loop: true,
      callback: () => this.secondTick(),
    });
    this.gameTickTimer = this.time.addEvent({
      delay: TICK_RATE, loop: true,
      callback: () => this.gameTick(),
    });
    this.moveTickTimer = this.time.addEvent({
      delay: MOVE_TICK, loop: true,
      callback: () => this.moveTick(),
    });
  }

  // ─── SECOND TICK (1s) ────────────────────────────────────

  private secondTick() {
    if (this.gameOver) return;

    const meta = this.state.meta;
    meta.timeRemaining--;
    meta.gameTime++;

    // Camp scaling
    if (meta.gameTime > 0 && meta.gameTime % CAMP_SCALING_INTERVAL === 0) {
      for (const camp of this.state.camps) {
        camp.scalingFactor += CAMP_SCALING_AMOUNT;
      }
    }

    // Respawn timers
    for (const heroId of Object.keys(this.state.heroes)) {
      const hero = this.state.heroes[heroId];
      if (hero.isDead) {
        hero.respawnTimer--;
        if (hero.respawnTimer <= 0) {
          this.respawnHero(hero);
        }
      }
    }

    // Spawn units from captured camps
    this.spawnUnitsFromCamps();

    // Structure attacks
    this.structureAttackTick();

    // AI for player 2
    this.runAI();

    // Win condition check
    this.checkWinCondition();

    // Update HUD
    this.updateHUD();
  }

  // ─── GAME TICK (750ms) ──────────────────────────────────

  private gameTick() {
    if (this.gameOver) return;

    // Execute hero orders
    for (const heroId of Object.keys(this.state.heroes)) {
      const hero = this.state.heroes[heroId];
      if (hero.isDead) continue;
      this.executeHeroOrder(hero);
    }

    // Unit AI
    this.unitAI();

    // Combat resolution
    this.resolveCombat();

    // Update army counts on hero entities
    for (const [heroId, entity] of this.heroEntities) {
      const count = this.state.units.filter(u => u.ownerId === heroId && !u.isDead).length;
      entity.setArmyCount(count);
    }

    // Fog of war
    this.updateFogOfWar();

    // Sync entity positions
    this.syncEntities();

    // Clean up dead units
    this.cleanupDeadUnits();
  }

  // ─── MOVE TICK (500ms) ──────────────────────────────────

  private moveTick() {
    if (this.gameOver) return;

    // Move heroes along their paths
    for (const heroId of Object.keys(this.state.heroes)) {
      const hero = this.state.heroes[heroId];
      if (hero.isDead || hero.path.length === 0) continue;

      const entity = this.heroEntities.get(heroId);
      if (entity?.isMoving) continue;

      const next = hero.path.shift()!;
      hero.position = { ...next };

      if (entity) {
        entity.stepToTile(next.x, next.y);
      }
    }

    // Move units toward their owners (follow behavior)
    for (const unit of this.state.units) {
      if (unit.isDead) continue;
      if (unit.behavior === 'follow') {
        const owner = this.state.heroes[unit.ownerId];
        if (!owner || owner.isDead) {
          unit.behavior = 'hold';
          continue;
        }
        const dist = this.tileDist(unit.position, owner.position);
        if (dist > 2) {
          // Move one step toward owner
          const dx = Math.sign(owner.position.x - unit.position.x);
          const dy = Math.sign(owner.position.y - unit.position.y);
          const nx = unit.position.x + dx;
          const ny = unit.position.y + dy;
          if (nx >= 0 && nx < MAP_WIDTH && ny >= 0 && ny < MAP_HEIGHT
            && isPassable(this.gameMap.tiles[ny][nx])) {
            unit.position = { x: nx, y: ny };
          }
        }
      }
    }

    // Sync follower entity positions
    for (const [unitId, entity] of this.unitEntities) {
      const unit = this.state.units.find(u => u.id === unitId);
      if (unit && !unit.isDead) {
        entity.syncPosition(unit.position.x, unit.position.y);
      }
    }
  }

  // ─── HERO ORDER EXECUTION ───────────────────────────────

  private executeHeroOrder(hero: Hero) {
    const order = hero.currentOrder;
    if (!order) return;

    switch (order.type) {
      case 'move':
        if (order.targetPosition && hero.path.length === 0) {
          hero.path = findPath(this.gameMap.tiles, hero.position, order.targetPosition, 100);
          if (hero.path.length === 0) hero.currentOrder = null;
        }
        break;

      case 'attack_camp': {
        const camp = this.state.camps.find(c => c.id === order.targetId);
        if (!camp) { hero.currentOrder = null; break; }
        const dist = this.tileDist(hero.position, camp.position);
        if (dist <= CAMP_ATTACK_RANGE) {
          this.heroAttackCamp(hero, camp);
        } else if (hero.path.length === 0) {
          hero.path = findPath(this.gameMap.tiles, hero.position, camp.position, 100);
        }
        break;
      }

      case 'attack_structure': {
        const structure = this.state.structures.find(s => s.id === order.targetId);
        if (!structure || structure.hp <= 0) { hero.currentOrder = null; break; }
        const dist = this.tileDist(hero.position, structure.position);
        if (dist <= STRUCTURE_ATTACK_RANGE) {
          this.heroAttackStructure(hero, structure);
        } else if (hero.path.length === 0) {
          hero.path = findPath(this.gameMap.tiles, hero.position, structure.position, 100);
        }
        break;
      }

      case 'attack_hero': {
        const target = this.state.heroes[order.targetId ?? ''];
        if (!target || target.isDead) { hero.currentOrder = null; break; }
        const dist = this.tileDist(hero.position, target.position);
        if (dist <= HERO_ATTACK_RANGE) {
          this.heroAttackHero(hero, target);
        } else {
          // Chase
          hero.path = findPath(this.gameMap.tiles, hero.position, target.position, 100);
        }
        break;
      }

      case 'attack_base': {
        const enemyBase = hero.team === 'player1' ? this.state.bases.player2 : this.state.bases.player1;
        const dist = this.tileDist(hero.position, enemyBase.position);
        if (dist <= BASE_ATTACK_RANGE) {
          this.heroAttackBase(hero, enemyBase);
        } else if (hero.path.length === 0) {
          hero.path = findPath(this.gameMap.tiles, hero.position, enemyBase.position, 100);
        }
        break;
      }

      case 'defend':
        // Stay put, attack nearby enemies (handled in resolveCombat)
        break;

      case 'retreat': {
        const ownBase = hero.team === 'player1' ? this.state.bases.player1 : this.state.bases.player2;
        if (hero.path.length === 0) {
          hero.path = findPath(this.gameMap.tiles, hero.position, ownBase.position, 100);
          if (hero.path.length === 0) hero.currentOrder = null;
        }
        break;
      }

      case 'hold':
        // Do nothing
        break;
    }
  }

  // ─── COMBAT ──────────────────────────────────────────────

  private heroAttackCamp(hero: Hero, camp: Camp) {
    hero.attackCooldown--;
    if (hero.attackCooldown > 0) return;
    hero.attackCooldown = 2; // Every 2 game ticks

    // Attack alive guards
    const aliveGuards = camp.guards.filter(g => !g.isDead);
    if (aliveGuards.length === 0) {
      // Camp captured!
      this.captureCamp(hero, camp);
      return;
    }

    // Hero attacks first alive guard
    const guard = aliveGuards[0];
    const dmg = Math.max(1, hero.attack - guard.defense);
    guard.hp -= dmg;
    if (guard.hp <= 0) {
      guard.isDead = true;
      // Check if all guards dead
      if (camp.guards.every(g => g.isDead)) {
        this.captureCamp(hero, camp);
      }
    }

    // Guards attack hero back
    for (const g of aliveGuards) {
      if (g.isDead) continue;
      const guardDmg = Math.max(1, g.attack - hero.defense);
      hero.currentHp -= guardDmg;
      const entity = this.heroEntities.get(hero.id);
      if (entity) entity.showDamage(guardDmg);
      if (hero.currentHp <= 0) {
        this.killHero(hero);
        return;
      }
    }

    // Army units also attack guards
    const armyUnits = this.state.units.filter(u => u.ownerId === hero.id && !u.isDead);
    for (const unit of armyUnits) {
      if (aliveGuards.every(g => g.isDead)) break;
      const alive = aliveGuards.find(g => !g.isDead);
      if (!alive) break;
      const unitDmg = Math.max(1, unit.attack - alive.defense);
      alive.hp -= unitDmg;
      if (alive.hp <= 0) alive.isDead = true;
    }

    if (camp.guards.every(g => g.isDead)) {
      this.captureCamp(hero, camp);
    }
  }

  private captureCamp(hero: Hero, camp: Camp) {
    camp.capturedBy = hero.id;
    camp.capturedTeam = hero.team;
    camp.spawnTimer = camp.spawnRate;

    const entity = this.heroEntities.get(hero.id);
    const bark = getBark('camp_captured');
    if (bark && entity) {
      entity.showBark(bark);
      if (hero.team === this.myTeam) this.tts.speak(hero.id, bark);
    }
  }

  private heroAttackStructure(hero: Hero, structure: Structure) {
    hero.attackCooldown--;
    if (hero.attackCooldown > 0) return;
    hero.attackCooldown = 2;

    const dmg = Math.max(1, hero.attack);
    structure.hp -= dmg;

    // Army also attacks
    const army = this.state.units.filter(u => u.ownerId === hero.id && !u.isDead);
    for (const unit of army) {
      const unitDmg = Math.max(1, unit.attack);
      structure.hp -= unitDmg;
    }

    if (structure.hp <= 0) {
      structure.hp = 0;
      structure.destroyedBy = hero.team;
      // Grant upgrade
      this.grantUpgrade(hero.team, structure.upgradeType);
    }
  }

  private heroAttackHero(attacker: Hero, defender: Hero) {
    attacker.attackCooldown--;
    if (attacker.attackCooldown > 0) return;
    attacker.attackCooldown = 2;

    const dmg = Math.max(1, attacker.attack - defender.defense);
    defender.currentHp -= dmg;

    const defEntity = this.heroEntities.get(defender.id);
    if (defEntity) defEntity.showDamage(dmg);

    if (defender.currentHp <= 0) {
      this.killHero(defender);
    }
  }

  private heroAttackBase(hero: Hero, base: Base) {
    hero.attackCooldown--;
    if (hero.attackCooldown > 0) return;
    hero.attackCooldown = 2;

    const dmg = Math.max(1, hero.attack);
    base.hp -= dmg;

    // Army also attacks base
    const army = this.state.units.filter(u => u.ownerId === hero.id && !u.isDead);
    for (const unit of army) {
      const unitDmg = Math.max(1, unit.attack);
      base.hp -= unitDmg;
    }

    if (base.hp <= 0) base.hp = 0;
  }

  private structureAttackTick() {
    for (const structure of this.state.structures) {
      if (structure.hp <= 0) continue;
      structure.attackCooldown--;
      if (structure.attackCooldown > 0) continue;
      structure.attackCooldown = 2;

      // Find nearest enemy hero or unit in range
      for (const heroId of Object.keys(this.state.heroes)) {
        const hero = this.state.heroes[heroId];
        if (hero.isDead) continue;
        const dist = this.tileDist(structure.position, hero.position);
        if (dist <= structure.range) {
          const dmg = Math.max(1, structure.attack - hero.defense);
          hero.currentHp -= dmg;
          const entity = this.heroEntities.get(heroId);
          if (entity) entity.showDamage(dmg);
          if (hero.currentHp <= 0) this.killHero(hero);
          break; // Only attack one target per tick
        }
      }
    }
  }

  private resolveCombat() {
    // Hero auto-attack nearby enemies (for defend order or close combat)
    for (const heroId of Object.keys(this.state.heroes)) {
      const hero = this.state.heroes[heroId];
      if (hero.isDead) continue;

      // Auto-attack nearby enemy heroes
      for (const eId of Object.keys(this.state.heroes)) {
        const enemy = this.state.heroes[eId];
        if (enemy.team === hero.team || enemy.isDead) continue;
        const dist = this.tileDist(hero.position, enemy.position);
        if (dist <= hero.range) {
          hero.attackCooldown--;
          if (hero.attackCooldown <= 0) {
            hero.attackCooldown = 2;
            const dmg = Math.max(1, hero.attack - enemy.defense);
            enemy.currentHp -= dmg;
            const entity = this.heroEntities.get(eId);
            if (entity) entity.showDamage(dmg);
            if (enemy.currentHp <= 0) this.killHero(enemy);
          }
          break;
        }
      }
    }
  }

  // ─── UNIT AI ─────────────────────────────────────────────

  private unitAI() {
    for (const unit of this.state.units) {
      if (unit.isDead) continue;

      const owner = this.state.heroes[unit.ownerId];
      if (!owner || owner.isDead) {
        unit.behavior = 'hold';
        continue;
      }

      // Find nearby enemies
      let closestEnemy: Hero | null = null;
      let closestDist = Infinity;
      for (const heroId of Object.keys(this.state.heroes)) {
        const enemy = this.state.heroes[heroId];
        if (enemy.team === unit.team || enemy.isDead) continue;
        const dist = this.tileDist(unit.position, enemy.position);
        if (dist < closestDist && dist <= unit.range + 2) {
          closestDist = dist;
          closestEnemy = enemy;
        }
      }

      if (closestEnemy && closestDist <= unit.range) {
        // Attack!
        unit.attackCooldown--;
        if (unit.attackCooldown <= 0) {
          const def = UNIT_DEFS[unit.type];
          unit.attackCooldown = Math.ceil(def.attackInterval / TICK_RATE);

          const dmg = Math.max(1, unit.attack - closestEnemy.defense);
          closestEnemy.currentHp -= dmg;
          const entity = this.heroEntities.get(closestEnemy.id);
          if (entity) entity.showDamage(dmg);
          if (closestEnemy.currentHp <= 0) this.killHero(closestEnemy);
        }
      } else {
        // Follow owner
        unit.behavior = 'follow';
      }

      // Unit-on-unit combat
      for (const other of this.state.units) {
        if (other.isDead || other.team === unit.team) continue;
        const dist = this.tileDist(unit.position, other.position);
        if (dist <= unit.range) {
          unit.attackCooldown--;
          if (unit.attackCooldown <= 0) {
            const def = UNIT_DEFS[unit.type];
            unit.attackCooldown = Math.ceil(def.attackInterval / TICK_RATE);

            const counterMult = getCounterMultiplier(def.tags, UNIT_DEFS[other.type].tags);
            const dmg = Math.max(1, Math.round((unit.attack - other.defense) * counterMult));
            other.currentHp -= dmg;
            if (other.currentHp <= 0) {
              other.isDead = true;
            }
          }
          break; // Only fight one enemy unit per tick
        }
      }
    }
  }

  // ─── SPAWNING ────────────────────────────────────────────

  private spawnUnitsFromCamps() {
    for (const camp of this.state.camps) {
      if (!camp.capturedBy || !camp.capturedTeam) continue;

      const owner = this.state.heroes[camp.capturedBy];
      if (!owner) continue;

      // Check if owner is dead - units hold but don't spawn
      if (owner.isDead) continue;

      camp.spawnTimer--;
      if (camp.spawnTimer > 0) continue;

      // Check unit limits
      const totalUnits = this.state.units.filter(u => !u.isDead).length;
      const heroUnits = this.state.units.filter(u => u.ownerId === owner.id && !u.isDead).length;
      if (totalUnits >= MAX_UNITS || heroUnits >= MAX_UNITS_PER_HERO) {
        camp.spawnTimer = camp.spawnRate;
        continue;
      }

      // Calculate spawn rate with passives and upgrades
      let spawnRate = camp.spawnRate;
      if (owner.passive === 'rally_leader') spawnRate = Math.round(spawnRate * 0.8);
      if (owner.upgrades.includes('rapid_reinforcements')) spawnRate = Math.round(spawnRate * 0.5);
      camp.spawnTimer = spawnRate;

      // Create unit
      const def = UNIT_DEFS[camp.animalType];
      let hpBonus = 0;
      let atkBonus = 0;
      if (owner.passive === 'iron_will') hpBonus += 0.15;
      if (owner.passive === 'battle_fury') atkBonus += 0.20;
      if (owner.upgrades.includes('hardened_hides')) hpBonus += 0.30;
      if (owner.upgrades.includes('savage_strikes')) atkBonus += 0.25;

      const stats = getScaledUnitStats(def, camp.scalingFactor, hpBonus, atkBonus);

      const unit: AnimalUnit = {
        id: `unit_${this.unitIdCounter++}`,
        type: camp.animalType,
        ownerId: owner.id,
        team: owner.team,
        currentHp: stats.maxHp,
        maxHp: stats.maxHp,
        attack: stats.attack,
        defense: stats.defense,
        speed: stats.speed,
        range: stats.range,
        position: { ...camp.position },
        isDead: false,
        behavior: 'follow',
        attackCooldown: 0,
        specialTimer: 0,
        campId: camp.id,
      };

      // Mystic missiles upgrade: melee units gain ranged attack
      if (owner.upgrades.includes('mystic_missiles') && unit.range <= 1) {
        unit.range = 3;
      }

      this.state.units.push(unit);

      // Create entity
      const entity = new FollowerEntity(this, unit);
      this.unitEntities.set(unit.id, entity);
    }
  }

  // ─── HERO DEATH & RESPAWN ────────────────────────────────

  private killHero(hero: Hero) {
    hero.isDead = true;
    hero.currentHp = 0;
    hero.path = [];
    hero.currentOrder = null;

    // Comeback mechanic: losing team respawns faster
    const p1BaseHp = this.state.bases.player1.hp;
    const p2BaseHp = this.state.bases.player2.hp;
    let respawnTime = HERO_RESPAWN_BASE;
    if ((hero.team === 'player1' && p1BaseHp < p2BaseHp) ||
      (hero.team === 'player2' && p2BaseHp < p1BaseHp)) {
      respawnTime -= HERO_RESPAWN_COMEBACK_BONUS;
    }
    hero.respawnTimer = Math.max(5, respawnTime);

    // Units hold position
    for (const unit of this.state.units) {
      if (unit.ownerId === hero.id && !unit.isDead) {
        unit.behavior = 'hold';
      }
    }

    const entity = this.heroEntities.get(hero.id);
    if (entity) entity.showRespawning(hero.respawnTimer);

    // Bark: allies react to death
    if (hero.team === this.myTeam) {
      const allyIds = this.getMyHeroIds().filter(id => id !== hero.id && !this.state.heroes[id].isDead);
      if (allyIds.length > 0) {
        const allyId = allyIds[0];
        const bark = getBark('ally_down');
        const allyEntity = this.heroEntities.get(allyId);
        if (bark && allyEntity) {
          allyEntity.showBark(bark);
          this.tts.speak(allyId, bark);
        }
      }
    }
  }

  private respawnHero(hero: Hero) {
    hero.isDead = false;
    hero.respawnTimer = 0;
    hero.currentHp = hero.maxHp;
    hero.attackCooldown = 0;

    // Respawn at base
    const base = hero.team === 'player1' ? this.state.bases.player1 : this.state.bases.player2;
    hero.position = { ...base.position };

    const entity = this.heroEntities.get(hero.id);
    if (entity) {
      entity.hideRespawn();
      entity.snapToPosition();
      entity.updateFromState(hero);
    }

    // Resume unit following
    for (const unit of this.state.units) {
      if (unit.ownerId === hero.id && !unit.isDead) {
        unit.behavior = 'follow';
      }
    }
  }

  // ─── UPGRADES ────────────────────────────────────────────

  private grantUpgrade(team: 'player1' | 'player2', upgradeType: UpgradeType) {
    for (const heroId of Object.keys(this.state.heroes)) {
      const hero = this.state.heroes[heroId];
      if (hero.team !== team) continue;
      if (!hero.upgrades.includes(upgradeType)) {
        hero.upgrades.push(upgradeType);
      }
    }

    // Apply retroactively to existing units
    if (upgradeType === 'hardened_hides') {
      for (const unit of this.state.units) {
        if (unit.team === team && !unit.isDead) {
          const bonus = Math.round(unit.maxHp * 0.30);
          unit.maxHp += bonus;
          unit.currentHp += bonus;
        }
      }
    }
    if (upgradeType === 'savage_strikes') {
      for (const unit of this.state.units) {
        if (unit.team === team && !unit.isDead) {
          unit.attack = Math.round(unit.attack * 1.25);
        }
      }
    }
    if (upgradeType === 'mystic_missiles') {
      for (const unit of this.state.units) {
        if (unit.team === team && !unit.isDead && unit.range <= 1) {
          unit.range = 3;
        }
      }
    }
  }

  // ─── AI (PLAYER 2) ──────────────────────────────────────

  private runAI() {
    const p2Heroes = Object.values(this.state.heroes).filter(h => h.team === 'player2');
    const p1Heroes = Object.values(this.state.heroes).filter(h => h.team === 'player1');

    for (const hero of p2Heroes) {
      if (hero.isDead) continue;
      // Only reconsider order if idle or no current order
      if (hero.currentOrder && hero.path.length > 0) continue;

      const ctx: GambitContext = {
        hero,
        allies: p2Heroes.filter(h => h.id !== hero.id),
        enemies: p1Heroes,
        camps: this.state.camps,
        structures: this.state.structures,
        units: this.state.units,
        enemyBasePos: this.state.bases.player1.position,
        ownBasePos: this.state.bases.player2.position,
        gameTime: this.state.meta.gameTime,
      };

      const order = getGambitOrder(ctx);
      if (order) {
        this.issueOrder(hero.id, order);
      }
    }
  }

  // ─── FOG OF WAR ──────────────────────────────────────────

  private updateFogOfWar() {
    this.visibleTiles.clear();

    // Vision from my heroes
    const myHeroes = Object.values(this.state.heroes).filter(h => h.team === this.myTeam && !h.isDead);
    // Check if any of our heroes has keen_eye
    const hasKeenEye = myHeroes.some(h => h.passive === 'keen_eye');
    for (const hero of myHeroes) {
      const vr = hero.passive === 'keen_eye' ? Math.round(hero.visionRange * 1.5) : hero.visionRange;
      this.revealArea(hero.position, vr);
    }

    // Vision from my captured camps
    for (const camp of this.state.camps) {
      if (camp.capturedTeam === this.myTeam) {
        const campVision = hasKeenEye ? Math.round(camp.visionRange * 1.3) : camp.visionRange;
        this.revealArea(camp.position, campVision);
      }
    }

    // Vision from my units
    for (const unit of this.state.units) {
      if (unit.team === this.myTeam && !unit.isDead) {
        this.revealArea(unit.position, 4);
      }
    }

    // Apply fog
    this.fogLayer.clear();
    this.fogLayer.fillStyle(0x0D0A18, 0.6);

    for (let y = 0; y < MAP_HEIGHT; y++) {
      for (let x = 0; x < MAP_WIDTH; x++) {
        if (!this.visibleTiles.has(`${x},${y}`)) {
          this.fogLayer.fillRect(x * TILE_SIZE, y * TILE_SIZE, TILE_SIZE, TILE_SIZE);
        }
      }
    }

    // Set entity visibility
    for (const [heroId, entity] of this.heroEntities) {
      const hero = this.state.heroes[heroId];
      if (hero.team === this.myTeam) {
        entity.setFogVisible(true);
      } else {
        const key = `${hero.position.x},${hero.position.y}`;
        entity.setFogVisible(this.visibleTiles.has(key));
      }
    }

    for (const [unitId, entity] of this.unitEntities) {
      const unit = this.state.units.find(u => u.id === unitId);
      if (!unit) continue;
      if (unit.team === this.myTeam) {
        entity.setFogVisible(true);
      } else {
        const key = `${unit.position.x},${unit.position.y}`;
        entity.setFogVisible(this.visibleTiles.has(key));
      }
    }
  }

  private revealArea(center: Position, radius: number) {
    for (let dy = -radius; dy <= radius; dy++) {
      for (let dx = -radius; dx <= radius; dx++) {
        if (dx * dx + dy * dy > radius * radius) continue;
        const x = center.x + dx;
        const y = center.y + dy;
        if (x >= 0 && x < MAP_WIDTH && y >= 0 && y < MAP_HEIGHT) {
          this.visibleTiles.add(`${x},${y}`);
        }
      }
    }
  }

  // ─── ENTITY SYNC ────────────────────────────────────────

  private syncEntities() {
    // Update hero entities from state
    for (const [heroId, entity] of this.heroEntities) {
      const hero = this.state.heroes[heroId];
      entity.updateFromState(hero);

      if (hero.isDead) {
        entity.showRespawning(hero.respawnTimer);
      }
    }

    // Update unit entities
    for (const [unitId, entity] of this.unitEntities) {
      const unit = this.state.units.find(u => u.id === unitId);
      if (unit && !unit.isDead) {
        entity.updateHp(unit.currentHp, unit.maxHp);
      }
    }
  }

  private cleanupDeadUnits() {
    const deadUnits = this.state.units.filter(u => u.isDead);
    for (const dead of deadUnits) {
      const entity = this.unitEntities.get(dead.id);
      if (entity) {
        entity.destroy();
        this.unitEntities.delete(dead.id);
      }
    }
    this.state.units = this.state.units.filter(u => !u.isDead);
  }

  // ─── WIN CONDITION ───────────────────────────────────────

  private checkWinCondition() {
    if (this.gameOver) return;

    let winner: string | undefined;
    let reason: 'base_destroyed' | 'time_up' = 'base_destroyed';

    if (this.state.bases.player1.hp <= 0) {
      winner = 'player2';
    } else if (this.state.bases.player2.hp <= 0) {
      winner = 'player1';
    } else if (this.state.meta.timeRemaining <= 0) {
      reason = 'time_up';
      if (this.state.bases.player1.hp > this.state.bases.player2.hp) {
        winner = 'player1';
      } else if (this.state.bases.player2.hp > this.state.bases.player1.hp) {
        winner = 'player2';
      } else {
        winner = 'draw';
      }
    }

    if (winner) {
      this.gameOver = true;
      this.state.meta.status = 'finished';
      this.state.meta.winner = winner;
      this.state.meta.winReason = reason;
      this.showGameOver(winner, reason);
    }
  }

  private showGameOver(winner: string, reason: string) {
    const { width, height } = this.cameras.main;
    const isWin = winner === this.myTeam;
    const title = winner === 'draw' ? 'DRAW!' : isWin ? 'VICTORY!' : 'DEFEAT!';
    const color = winner === 'draw' ? '#FFD93D' : isWin ? '#45E6B0' : '#FF6B6B';

    const overlay = this.add.rectangle(width / 2, height / 2, width, height, 0x000000, 0.7)
      .setScrollFactor(0).setDepth(200);

    this.add.text(width / 2, height / 2 - 30, title, {
      fontSize: '48px',
      color,
      fontFamily: '"Fredoka", sans-serif',
      fontStyle: 'bold',
    }).setOrigin(0.5).setScrollFactor(0).setDepth(201);

    const reasonText = reason === 'base_destroyed' ? 'Base Destroyed!' : 'Time Up!';
    this.add.text(width / 2, height / 2 + 20, reasonText, {
      fontSize: '18px',
      color: '#cbb8ee',
      fontFamily: '"Nunito", sans-serif',
    }).setOrigin(0.5).setScrollFactor(0).setDepth(201);

    // Stop ticks
    if (this.secondTimer) this.secondTimer.destroy();
    if (this.gameTickTimer) this.gameTickTimer.destroy();
    if (this.moveTickTimer) this.moveTickTimer.destroy();
  }

  // ─── HELPERS ─────────────────────────────────────────────

  private getMyHeroIds(): string[] {
    return Object.keys(this.state.heroes).filter(id => this.state.heroes[id].team === this.myTeam);
  }

  private getSelectedHero(): Hero | null {
    const ids = this.getMyHeroIds();
    return ids[this.selectedHeroIdx] ? this.state.heroes[ids[this.selectedHeroIdx]] : null;
  }

  private tileDist(a: Position, b: Position): number {
    return Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
  }

  // ─── PHASER UPDATE ───────────────────────────────────────

  update(_time: number, _delta: number) {
    // Update follower preUpdate for lerp
    for (const [, entity] of this.unitEntities) {
      entity.preUpdate();
    }

    // Update minimap
    if (this.miniMap && this.state) {
      const cam = this.cameras.main;
      this.miniMap.update(this.state, {
        x: cam.scrollX,
        y: cam.scrollY,
        w: cam.width,
        h: cam.height,
      });
    }
  }
}
