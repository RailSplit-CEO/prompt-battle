import Phaser from 'phaser';
import {
  Position, MONSTER_DEFS,
  JungleHero, LaneTower, Nexus, LaneMinion, JungleCamp, JungleMonster,
  ConvertedMonster, LaneId, TeamId, MonsterType, JLHeroOrder,
} from '../jungle-lane/types';
import { JL, HERO_NAMES, HERO_EMOJIS } from '../jungle-lane/constants';
import { MAP } from '../jungle-lane/map';
import { CommandInput } from '../systems/CommandInput';
import { TtsService } from '../systems/TtsService';

const TILE_SIZE = JL.TILE_SIZE;

// ─── CONSTANTS ────────────────────────────────────────────────
const C = JL;

type TileType = 'grass' | 'path' | 'water' | 'rock' | 'forest' | 'bush';

// ─── SCENE ────────────────────────────────────────────────────
export class JungleLaneScene extends Phaser.Scene {
  // Identity
  private playerId = 'player1';
  private myTeam: TeamId = 'team1';
  private enemyTeam: TeamId = 'team2';

  // Game state
  private heroes: Map<string, JungleHero> = new Map();
  private towers: LaneTower[] = [];
  private nexuses!: { team1: Nexus; team2: Nexus };
  private minions: LaneMinion[] = [];
  private camps: JungleCamp[] = [];
  private convertedMonsters: ConvertedMonster[] = [];
  private dragonAlive = true;
  private dragonMonster: JungleMonster | null = null;
  private dragonBuffTeam: TeamId | undefined;
  private dragonBuffTimer = 0;

  // Timing
  private timeRemaining = C.GAME_DURATION;
  private minionWaveTimer = C.MINION_SPAWN_INTERVAL;
  private gameOver = false;
  private lastTick = 0;
  private lastMoveTick = 0;
  private lastAttackTick = 0;
  private tickAccumulator = 0;
  private moveAccumulator = 0;
  private attackAccumulator = 0;
  private secondAccumulator = 0;

  // Map
  private tiles: TileType[][] = [];
  private tileLayer!: Phaser.GameObjects.Graphics;

  // Rendering
  private heroSprites: Map<string, Phaser.GameObjects.Container> = new Map();
  private towerSprites: Map<string, Phaser.GameObjects.Container> = new Map();
  private nexusSprites: Map<string, Phaser.GameObjects.Container> = new Map();
  private minionSprites: Map<string, Phaser.GameObjects.Container> = new Map();
  private campSprites: Map<string, Phaser.GameObjects.Container> = new Map();
  private monsterSprites: Map<string, Phaser.GameObjects.Container> = new Map();
  private convertedSprites: Map<string, Phaser.GameObjects.Container> = new Map();
  private dragonSprite: Phaser.GameObjects.Container | null = null;

  // UI
  private timerText!: Phaser.GameObjects.Text;
  private infoText!: Phaser.GameObjects.Text;
  private commandLogText!: Phaser.GameObjects.Text;
  private heroBarContainer!: Phaser.GameObjects.Container;
  private selectedHeroId: string | null = null;

  // Voice input
  private commandInput!: CommandInput;
  private ttsService!: TtsService;
  private transcriptText!: Phaser.GameObjects.Text;

  // Camera
  private isDragging = false;
  private dragStart = { x: 0, y: 0 };
  private camStart = { x: 0, y: 0 };

  // Next IDs
  private nextId = 1;

  constructor() {
    super({ key: 'JungleLaneScene' });
  }

  create() {
    const worldW = C.MAP_WIDTH * TILE_SIZE;
    const worldH = C.MAP_HEIGHT * TILE_SIZE;

    // Generate tile map
    this.generateTileMap();
    this.renderTileMap();

    // Camera setup
    this.cameras.main.setBounds(0, 0, worldW, worldH);
    this.cameras.main.setZoom(1.2);
    this.cameras.main.centerOn(MAP.nexus1.x * TILE_SIZE, MAP.nexus1.y * TILE_SIZE);

    // Initialize game state
    this.initializeGameState();

    // Render everything
    this.renderTowers();
    this.renderNexuses();
    this.renderCamps();
    this.renderDragon();
    this.renderHeroes();

    // UI
    this.createUI();

    // Camera controls
    this.setupCameraControls();

    // Voice input
    this.setupVoiceInput();

    // Spawn first minion wave
    this.spawnMinionWave();

    // Keyboard shortcuts for hero selection
    this.input.keyboard!.on('keydown-ONE', () => this.selectHeroByIndex(0));
    this.input.keyboard!.on('keydown-TWO', () => this.selectHeroByIndex(1));
    this.input.keyboard!.on('keydown-THREE', () => this.selectHeroByIndex(2));
    this.input.keyboard!.on('keydown-FOUR', () => this.selectHeroByIndex(3));
    this.input.keyboard!.on('keydown-FIVE', () => this.selectHeroByIndex(4));

    // Right-click to move/attack
    this.input.on('pointerdown', (pointer: Phaser.Input.Pointer) => {
      if (pointer.rightButtonDown() && this.selectedHeroId) {
        const worldX = Math.floor(pointer.worldX / TILE_SIZE);
        const worldY = Math.floor(pointer.worldY / TILE_SIZE);
        this.issueOrder(this.selectedHeroId, { type: 'move', targetPosition: { x: worldX, y: worldY } });
      }
    });
  }

  // ─── MAP GENERATION ───────────────────────────────────────────
  private generateTileMap() {
    this.tiles = [];
    for (let y = 0; y < C.MAP_HEIGHT; y++) {
      this.tiles[y] = [];
      for (let x = 0; x < C.MAP_WIDTH; x++) {
        this.tiles[y][x] = 'grass';
      }
    }

    // Draw lane paths
    const drawPathBetween = (a: Position, b: Position, width: number) => {
      const steps = Math.max(Math.abs(b.x - a.x), Math.abs(b.y - a.y));
      for (let i = 0; i <= steps; i++) {
        const t = steps === 0 ? 0 : i / steps;
        const cx = Math.round(a.x + (b.x - a.x) * t);
        const cy = Math.round(a.y + (b.y - a.y) * t);
        for (let dy = -width; dy <= width; dy++) {
          for (let dx = -width; dx <= width; dx++) {
            const nx = cx + dx;
            const ny = cy + dy;
            if (nx >= 0 && nx < C.MAP_WIDTH && ny >= 0 && ny < C.MAP_HEIGHT) {
              this.tiles[ny][nx] = 'path';
            }
          }
        }
      }
    };

    // Draw lanes
    for (const lane of ['top', 'mid', 'bot'] as LaneId[]) {
      const waypoints = MAP.lanes[lane];
      for (let i = 0; i < waypoints.length - 1; i++) {
        drawPathBetween(waypoints[i], waypoints[i + 1], 1);
      }
    }

    // Draw base areas
    for (let dy = -4; dy <= 4; dy++) {
      for (let dx = -4; dx <= 4; dx++) {
        const x1 = MAP.nexus1.x + dx, y1 = MAP.nexus1.y + dy;
        const x2 = MAP.nexus2.x + dx, y2 = MAP.nexus2.y + dy;
        if (x1 >= 0 && x1 < C.MAP_WIDTH && y1 >= 0 && y1 < C.MAP_HEIGHT) this.tiles[y1][x1] = 'path';
        if (x2 >= 0 && x2 < C.MAP_WIDTH && y2 >= 0 && y2 < C.MAP_HEIGHT) this.tiles[y2][x2] = 'path';
      }
    }

    // Place forest/bush around camps
    for (const camp of MAP.camps) {
      for (let dy = -2; dy <= 2; dy++) {
        for (let dx = -2; dx <= 2; dx++) {
          const nx = camp.position.x + dx;
          const ny = camp.position.y + dy;
          if (nx >= 0 && nx < C.MAP_WIDTH && ny >= 0 && ny < C.MAP_HEIGHT
            && this.tiles[ny][nx] === 'grass') {
            this.tiles[ny][nx] = Math.abs(dx) + Math.abs(dy) <= 1 ? 'bush' : 'forest';
          }
        }
      }
    }

    // Water features for aesthetics
    const waterSpots = [
      { x: 20, y: 20 }, { x: 60, y: 60 }, { x: 20, y: 50 }, { x: 50, y: 20 },
    ];
    for (const spot of waterSpots) {
      for (let dy = -2; dy <= 2; dy++) {
        for (let dx = -2; dx <= 2; dx++) {
          if (Math.abs(dx) + Math.abs(dy) <= 2) {
            const nx = spot.x + dx, ny = spot.y + dy;
            if (nx >= 0 && nx < C.MAP_WIDTH && ny >= 0 && ny < C.MAP_HEIGHT
              && this.tiles[ny][nx] === 'grass') {
              this.tiles[ny][nx] = 'water';
            }
          }
        }
      }
    }
  }

  private renderTileMap() {
    this.tileLayer = this.add.graphics();
    const tileColors: Record<TileType, number> = {
      grass: 0x2d5a1e,
      path: 0x8B7355,
      water: 0x2255AA,
      rock: 0x666666,
      forest: 0x1a4012,
      bush: 0x3a6a2e,
    };

    for (let y = 0; y < C.MAP_HEIGHT; y++) {
      for (let x = 0; x < C.MAP_WIDTH; x++) {
        const tile = this.tiles[y][x];
        this.tileLayer.fillStyle(tileColors[tile] || 0x2d5a1e, 1);
        this.tileLayer.fillRect(x * TILE_SIZE, y * TILE_SIZE, TILE_SIZE, TILE_SIZE);

        // Grid lines
        this.tileLayer.lineStyle(1, 0x000000, 0.08);
        this.tileLayer.strokeRect(x * TILE_SIZE, y * TILE_SIZE, TILE_SIZE, TILE_SIZE);
      }
    }
  }

  // ─── GAME STATE INIT ─────────────────────────────────────────
  private initializeGameState() {
    // Create heroes for both teams
    for (let i = 0; i < C.HEROES_PER_TEAM; i++) {
      const h1: JungleHero = {
        id: `hero_t1_${i}`,
        team: 'team1',
        name: HERO_NAMES[i],
        emoji: HERO_EMOJIS[i],
        position: { ...MAP.spawn1[i] },
        hp: C.HERO_BASE_HP,
        maxHp: C.HERO_BASE_HP,
        attack: C.HERO_BASE_ATTACK,
        defense: C.HERO_BASE_DEFENSE,
        speed: C.HERO_BASE_SPEED,
        range: C.HERO_BASE_RANGE,
        level: 1,
        xp: 0,
        isDead: false,
        respawnTimer: 0,
        attackCooldown: 0,
      };
      this.heroes.set(h1.id, h1);

      const h2: JungleHero = {
        id: `hero_t2_${i}`,
        team: 'team2',
        name: HERO_NAMES[i],
        emoji: HERO_EMOJIS[i],
        position: { ...MAP.spawn2[i] },
        hp: C.HERO_BASE_HP,
        maxHp: C.HERO_BASE_HP,
        attack: C.HERO_BASE_ATTACK,
        defense: C.HERO_BASE_DEFENSE,
        speed: C.HERO_BASE_SPEED,
        range: C.HERO_BASE_RANGE,
        level: 1,
        xp: 0,
        isDead: false,
        respawnTimer: 0,
        attackCooldown: 0,
      };
      this.heroes.set(h2.id, h2);
    }

    // Create towers
    for (const team of ['team1', 'team2'] as TeamId[]) {
      for (const lane of ['top', 'mid', 'bot'] as LaneId[]) {
        const positions = MAP.towers[team][lane];
        positions.forEach((pos, idx) => {
          this.towers.push({
            id: `tower_${team}_${lane}_${idx}`,
            lane,
            team,
            position: { ...pos },
            hp: C.TOWER_HP,
            maxHp: C.TOWER_HP,
            damage: C.TOWER_DAMAGE,
            range: C.TOWER_RANGE,
            index: idx,
            alive: true,
            attackCooldown: 0,
          });
        });
      }
    }

    // Create nexuses
    this.nexuses = {
      team1: {
        team: 'team1',
        position: { ...MAP.nexus1 },
        hp: C.NEXUS_HP,
        maxHp: C.NEXUS_HP,
        alive: true,
      },
      team2: {
        team: 'team2',
        position: { ...MAP.nexus2 },
        hp: C.NEXUS_HP,
        maxHp: C.NEXUS_HP,
        alive: true,
      },
    };

    // Create jungle camps
    for (let i = 0; i < MAP.camps.length; i++) {
      const campDef = MAP.camps[i];
      const monDef = MONSTER_DEFS[campDef.monsterType];
      const camp: JungleCamp = {
        id: `camp_${i}`,
        position: { ...campDef.position },
        monsterType: campDef.monsterType,
        tier: monDef.tier,
        nearestLane: campDef.nearestLane,
        monsters: [],
        respawnTimer: 0,
      };

      // Spawn initial monsters
      this.spawnCampMonsters(camp);
      this.camps.push(camp);
    }

    // Create dragon
    this.spawnDragon();
  }

  private spawnCampMonsters(camp: JungleCamp) {
    const def = MONSTER_DEFS[camp.monsterType];
    camp.monsters = [];
    for (let i = 0; i < def.groupSize; i++) {
      const offsetX = (i % 3 - 1) * 1;
      const offsetY = Math.floor(i / 3) * 1;
      camp.monsters.push({
        id: `${camp.id}_mon_${this.nextId++}`,
        campId: camp.id,
        type: camp.monsterType,
        position: { x: camp.position.x + offsetX, y: camp.position.y + offsetY },
        hp: def.stats.hp,
        maxHp: def.stats.hp,
        attack: def.stats.attack,
        defense: def.stats.defense,
        speed: def.stats.speed,
        range: def.stats.range,
        isDead: false,
      });
    }
  }

  private spawnDragon() {
    const def = MONSTER_DEFS.dragon;
    this.dragonMonster = {
      id: `dragon_${this.nextId++}`,
      campId: 'dragon',
      type: 'dragon',
      position: { ...MAP.dragonPit },
      hp: def.stats.hp,
      maxHp: def.stats.hp,
      attack: def.stats.attack,
      defense: def.stats.defense,
      speed: def.stats.speed,
      range: def.stats.range,
      isDead: false,
    };
    this.dragonAlive = true;
  }

  // ─── MINION WAVES ─────────────────────────────────────────────
  private spawnMinionWave() {
    for (const lane of ['top', 'mid', 'bot'] as LaneId[]) {
      for (const team of ['team1', 'team2'] as TeamId[]) {
        const waypoints = MAP.lanes[lane];
        const path = team === 'team1' ? [...waypoints] : [...waypoints].reverse();

        for (let i = 0; i < C.MINIONS_PER_WAVE; i++) {
          const startPos = path[0];
          const minion: LaneMinion = {
            id: `minion_${this.nextId++}`,
            team,
            lane,
            position: { x: startPos.x + (i % 2), y: startPos.y + Math.floor(i / 2) },
            hp: C.MINION_HP,
            maxHp: C.MINION_HP,
            attack: C.MINION_ATTACK,
            defense: C.MINION_DEFENSE,
            speed: C.MINION_SPEED,
            isDead: false,
            path: path.slice(1),
            pathIndex: 0,
          };
          this.minions.push(minion);
        }
      }
    }
  }

  // ─── RENDERING ────────────────────────────────────────────────
  private renderHeroes() {
    this.heroes.forEach((hero) => {
      const container = this.add.container(
        hero.position.x * TILE_SIZE + TILE_SIZE / 2,
        hero.position.y * TILE_SIZE + TILE_SIZE / 2
      );

      const isMyTeam = hero.team === this.myTeam;
      const bgColor = isMyTeam ? 0x2266FF : 0xFF2222;

      // Background circle
      const bg = this.add.graphics();
      bg.fillStyle(bgColor, 0.6);
      bg.fillCircle(0, 0, 14);
      bg.lineStyle(2, isMyTeam ? 0x4488FF : 0xFF4444, 1);
      bg.strokeCircle(0, 0, 14);
      container.add(bg);

      // Emoji
      const emoji = this.add.text(0, -1, hero.emoji, {
        fontSize: '18px',
      }).setOrigin(0.5);
      container.add(emoji);

      // Name label
      const name = this.add.text(0, -22, hero.name, {
        fontSize: '10px',
        color: isMyTeam ? '#88BBFF' : '#FF8888',
        fontFamily: '"Nunito", sans-serif',
        fontStyle: 'bold',
      }).setOrigin(0.5);
      container.add(name);

      // HP bar
      const hpBg = this.add.graphics();
      hpBg.fillStyle(0x000000, 0.5);
      hpBg.fillRect(-12, 14, 24, 3);
      container.add(hpBg);

      const hpFill = this.add.graphics();
      hpFill.fillStyle(0x44FF44, 1);
      hpFill.fillRect(-12, 14, 24, 3);
      container.add(hpFill);

      // Make interactive for selection
      if (isMyTeam) {
        const hitZone = this.add.zone(0, 0, 28, 28).setInteractive({ useHandCursor: true });
        hitZone.on('pointerdown', () => this.selectHero(hero.id));
        container.add(hitZone);
      }

      container.setDepth(10);
      this.heroSprites.set(hero.id, container);
    });
  }

  private renderTowers() {
    for (const tower of this.towers) {
      const container = this.add.container(
        tower.position.x * TILE_SIZE + TILE_SIZE / 2,
        tower.position.y * TILE_SIZE + TILE_SIZE / 2
      );

      const isMyTeam = tower.team === this.myTeam;
      const color = isMyTeam ? 0x4488FF : 0xFF4444;

      // Tower base
      const base = this.add.graphics();
      base.fillStyle(0x555555, 0.8);
      base.fillRect(-10, -10, 20, 20);
      base.lineStyle(2, color, 1);
      base.strokeRect(-10, -10, 20, 20);
      container.add(base);

      // Tower icon
      const icon = this.add.text(0, 0, '🏰', { fontSize: '16px' }).setOrigin(0.5);
      container.add(icon);

      // HP bar
      const hpBg = this.add.graphics();
      hpBg.fillStyle(0x000000, 0.5);
      hpBg.fillRect(-12, 14, 24, 3);
      container.add(hpBg);

      const hpFill = this.add.graphics();
      hpFill.fillStyle(color, 1);
      hpFill.fillRect(-12, 14, 24, 3);
      container.add(hpFill);

      container.setDepth(5);
      this.towerSprites.set(tower.id, container);
    }
  }

  private renderNexuses() {
    for (const team of ['team1', 'team2'] as TeamId[]) {
      const nexus = this.nexuses[team];
      const container = this.add.container(
        nexus.position.x * TILE_SIZE + TILE_SIZE / 2,
        nexus.position.y * TILE_SIZE + TILE_SIZE / 2
      );

      const isMyTeam = team === this.myTeam;
      const color = isMyTeam ? 0x4488FF : 0xFF4444;

      const base = this.add.graphics();
      base.fillStyle(color, 0.3);
      base.fillCircle(0, 0, 20);
      base.lineStyle(3, color, 0.8);
      base.strokeCircle(0, 0, 20);
      container.add(base);

      const icon = this.add.text(0, 0, '👑', { fontSize: '24px' }).setOrigin(0.5);
      container.add(icon);

      // HP bar
      const hpBg = this.add.graphics();
      hpBg.fillStyle(0x000000, 0.5);
      hpBg.fillRect(-18, 24, 36, 4);
      container.add(hpBg);

      const hpFill = this.add.graphics();
      hpFill.fillStyle(color, 1);
      hpFill.fillRect(-18, 24, 36, 4);
      container.add(hpFill);

      container.setDepth(5);
      this.nexusSprites.set(team, container);
    }
  }

  private renderCamps() {
    for (const camp of this.camps) {
      const def = MONSTER_DEFS[camp.monsterType];
      const container = this.add.container(
        camp.position.x * TILE_SIZE + TILE_SIZE / 2,
        camp.position.y * TILE_SIZE + TILE_SIZE / 2
      );

      // Camp area circle
      const area = this.add.graphics();
      area.fillStyle(0x553311, 0.3);
      area.fillCircle(0, 0, TILE_SIZE * 1.5);
      area.lineStyle(1, 0x886633, 0.4);
      area.strokeCircle(0, 0, TILE_SIZE * 1.5);
      container.add(area);

      // Camp type label
      const label = this.add.text(0, -TILE_SIZE * 1.8, `${def.emoji} ${def.name} x${def.groupSize}`, {
        fontSize: '9px',
        color: '#DDAA66',
        fontFamily: '"Nunito", sans-serif',
        fontStyle: 'bold',
      }).setOrigin(0.5);
      container.add(label);

      container.setDepth(1);
      this.campSprites.set(camp.id, container);

      // Render individual monsters
      for (const mon of camp.monsters) {
        this.createMonsterSprite(mon);
      }
    }
  }

  private createMonsterSprite(mon: JungleMonster) {
    const def = MONSTER_DEFS[mon.type];
    const container = this.add.container(
      mon.position.x * TILE_SIZE + TILE_SIZE / 2,
      mon.position.y * TILE_SIZE + TILE_SIZE / 2
    );

    const bg = this.add.graphics();
    bg.fillStyle(0x664422, 0.6);
    bg.fillCircle(0, 0, 10);
    container.add(bg);

    const emoji = this.add.text(0, -1, def.emoji, { fontSize: '14px' }).setOrigin(0.5);
    container.add(emoji);

    // HP bar
    const hpBg = this.add.graphics();
    hpBg.fillStyle(0x000000, 0.5);
    hpBg.fillRect(-8, 10, 16, 2);
    container.add(hpBg);

    const hpFill = this.add.graphics();
    hpFill.fillStyle(0xFFAA00, 1);
    hpFill.fillRect(-8, 10, 16, 2);
    container.add(hpFill);

    container.setDepth(8);
    this.monsterSprites.set(mon.id, container);
  }

  private renderDragon() {
    if (!this.dragonMonster) return;
    const container = this.add.container(
      MAP.dragonPit.x * TILE_SIZE + TILE_SIZE / 2,
      MAP.dragonPit.y * TILE_SIZE + TILE_SIZE / 2
    );

    // Dragon pit
    const pit = this.add.graphics();
    pit.fillStyle(0x440000, 0.4);
    pit.fillCircle(0, 0, TILE_SIZE * 2);
    pit.lineStyle(2, 0xFF4400, 0.5);
    pit.strokeCircle(0, 0, TILE_SIZE * 2);
    container.add(pit);

    const bg = this.add.graphics();
    bg.fillStyle(0x882200, 0.7);
    bg.fillCircle(0, 0, 16);
    container.add(bg);

    const emoji = this.add.text(0, -2, '🐉', { fontSize: '28px' }).setOrigin(0.5);
    container.add(emoji);

    // HP bar
    const hpBg = this.add.graphics();
    hpBg.fillStyle(0x000000, 0.5);
    hpBg.fillRect(-14, 18, 28, 4);
    container.add(hpBg);

    const hpFill = this.add.graphics();
    hpFill.fillStyle(0xFF4400, 1);
    hpFill.fillRect(-14, 18, 28, 4);
    container.add(hpFill);

    const label = this.add.text(0, -28, 'DRAGON', {
      fontSize: '10px',
      color: '#FF6600',
      fontFamily: '"Nunito", sans-serif',
      fontStyle: 'bold',
    }).setOrigin(0.5);
    container.add(label);

    container.setDepth(12);
    this.dragonSprite = container;
  }

  // ─── UI ───────────────────────────────────────────────────────
  private createUI() {
    const { width, height } = this.cameras.main;

    // Timer (top center, fixed to camera)
    this.timerText = this.add.text(width / 2, 10, this.formatTime(this.timeRemaining), {
      fontSize: '20px',
      color: '#FFD93D',
      fontFamily: '"Fredoka", sans-serif',
      fontStyle: 'bold',
      backgroundColor: '#00000066',
      padding: { x: 12, y: 4 },
    }).setOrigin(0.5, 0).setScrollFactor(0).setDepth(100);

    // Info text (top left)
    this.infoText = this.add.text(10, 10, '', {
      fontSize: '12px',
      color: '#CCCCCC',
      fontFamily: '"Nunito", sans-serif',
      backgroundColor: '#00000066',
      padding: { x: 8, y: 4 },
    }).setScrollFactor(0).setDepth(100);

    // Command log (bottom left)
    this.commandLogText = this.add.text(10, height - 120, '', {
      fontSize: '11px',
      color: '#88BBFF',
      fontFamily: '"Nunito", sans-serif',
      backgroundColor: '#00000066',
      padding: { x: 8, y: 4 },
      wordWrap: { width: 400 },
    }).setScrollFactor(0).setDepth(100);

    // Transcript (bottom center)
    this.transcriptText = this.add.text(width / 2, height - 40, '', {
      fontSize: '16px',
      color: '#FFD93D',
      fontFamily: '"Nunito", sans-serif',
      fontStyle: 'bold',
      backgroundColor: '#00000088',
      padding: { x: 12, y: 6 },
    }).setOrigin(0.5).setScrollFactor(0).setDepth(100);

    // Hero bar (bottom)
    this.createHeroBar();
  }

  private createHeroBar() {
    const { width, height } = this.cameras.main;
    this.heroBarContainer = this.add.container(width / 2, height - 80).setScrollFactor(0).setDepth(100);

    const myHeroes = Array.from(this.heroes.values()).filter(h => h.team === this.myTeam);
    const startX = -(myHeroes.length * 60) / 2;

    myHeroes.forEach((hero, i) => {
      const x = startX + i * 60 + 30;
      const bg = this.add.graphics();
      bg.fillStyle(0x1B1040, 0.8);
      bg.fillRoundedRect(x - 25, -25, 50, 50, 8);
      bg.lineStyle(2, 0x4488FF, 0.6);
      bg.strokeRoundedRect(x - 25, -25, 50, 50, 8);
      this.heroBarContainer.add(bg);

      const emoji = this.add.text(x, -5, hero.emoji, { fontSize: '22px' }).setOrigin(0.5);
      this.heroBarContainer.add(emoji);

      const name = this.add.text(x, 16, hero.name, {
        fontSize: '8px', color: '#88BBFF', fontFamily: '"Nunito", sans-serif',
      }).setOrigin(0.5);
      this.heroBarContainer.add(name);

      const hotkey = this.add.text(x - 20, -22, `${i + 1}`, {
        fontSize: '8px', color: '#FFD93D', fontFamily: '"Nunito", sans-serif', fontStyle: 'bold',
      });
      this.heroBarContainer.add(hotkey);

      // Click to select
      const zone = this.add.zone(x, 0, 50, 50).setInteractive({ useHandCursor: true });
      zone.setScrollFactor(0);
      zone.on('pointerdown', () => this.selectHero(hero.id));
      // We can't add the zone to the container directly since it needs scroll factor 0
      // but it's fine at the world level
    });
  }

  private formatTime(seconds: number): string {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m}:${s.toString().padStart(2, '0')}`;
  }

  // ─── CAMERA ───────────────────────────────────────────────────
  private setupCameraControls() {
    // Middle-click drag to pan
    this.input.on('pointerdown', (p: Phaser.Input.Pointer) => {
      if (p.middleButtonDown() || (p.leftButtonDown() && p.event.shiftKey)) {
        this.isDragging = true;
        this.dragStart = { x: p.x, y: p.y };
        this.camStart = { x: this.cameras.main.scrollX, y: this.cameras.main.scrollY };
      }
    });

    this.input.on('pointermove', (p: Phaser.Input.Pointer) => {
      if (this.isDragging) {
        const dx = this.dragStart.x - p.x;
        const dy = this.dragStart.y - p.y;
        this.cameras.main.scrollX = this.camStart.x + dx / this.cameras.main.zoom;
        this.cameras.main.scrollY = this.camStart.y + dy / this.cameras.main.zoom;
      }
    });

    this.input.on('pointerup', () => { this.isDragging = false; });

    // Scroll zoom
    this.input.on('wheel', (_pointer: any, _gx: any, _gy: any, _gz: any, deltaY: number) => {
      const zoom = this.cameras.main.zoom;
      const newZoom = Phaser.Math.Clamp(zoom - deltaY * 0.001, 0.3, 3);
      this.cameras.main.setZoom(newZoom);
    });

    // Edge scroll
    const edgeSpeed = 8;
    const edgeThreshold = 30;
    this.events.on('update', () => {
      const pointer = this.input.activePointer;
      const cam = this.cameras.main;
      if (pointer.x < edgeThreshold) cam.scrollX -= edgeSpeed / cam.zoom;
      if (pointer.x > cam.width - edgeThreshold) cam.scrollX += edgeSpeed / cam.zoom;
      if (pointer.y < edgeThreshold) cam.scrollY -= edgeSpeed / cam.zoom;
      if (pointer.y > cam.height - edgeThreshold) cam.scrollY += edgeSpeed / cam.zoom;
    });

    // Keyboard camera
    const keys = this.input.keyboard!.addKeys('W,A,S,D') as any;
    this.events.on('update', () => {
      const speed = 6 / this.cameras.main.zoom;
      if (keys.W.isDown) this.cameras.main.scrollY -= speed;
      if (keys.S.isDown) this.cameras.main.scrollY += speed;
      if (keys.A.isDown) this.cameras.main.scrollX -= speed;
      if (keys.D.isDown) this.cameras.main.scrollX += speed;
    });
  }

  // ─── VOICE INPUT ──────────────────────────────────────────────
  private setupVoiceInput() {
    this.commandInput = new CommandInput(this, 'jungle-lane', 'player1', true);
    this.commandInput.onCommand((rawText: string) => {
      this.transcriptText.setText(rawText);
      this.processVoiceCommand(rawText);
      this.time.delayedCall(3000, () => {
        this.transcriptText.setText('');
      });
    });

    this.ttsService = new TtsService();
  }

  private processVoiceCommand(text: string) {
    this.commandLogText.setText(`> ${text}`);

    const lower = text.toLowerCase().trim();

    // Parse commands for heroes
    // Simple command parser - matches patterns like:
    // "alpha go top", "bravo attack camp", "all mid", etc.
    const myHeroes = Array.from(this.heroes.values()).filter(h => h.team === this.myTeam && !h.isDead);

    // Find which heroes are targeted
    let targetHeroes: JungleHero[] = [];
    const heroNameMatch = HERO_NAMES.findIndex(n => lower.includes(n.toLowerCase()));

    if (lower.includes('all') || lower.includes('everyone') || lower.includes('everybody')) {
      targetHeroes = myHeroes;
    } else if (heroNameMatch >= 0) {
      const hero = myHeroes.find(h => h.name === HERO_NAMES[heroNameMatch]);
      if (hero) targetHeroes = [hero];
    } else if (this.selectedHeroId) {
      const hero = this.heroes.get(this.selectedHeroId);
      if (hero && !hero.isDead) targetHeroes = [hero];
    } else {
      targetHeroes = myHeroes;
    }

    if (targetHeroes.length === 0) return;

    // Parse action
    if (lower.includes('top') || lower.includes('top lane')) {
      const lanePos = MAP.lanes.top[Math.floor(MAP.lanes.top.length / 2)];
      for (const hero of targetHeroes) {
        this.issueOrder(hero.id, { type: 'move', targetPosition: lanePos });
      }
    } else if (lower.includes('mid') || lower.includes('middle')) {
      const lanePos = MAP.lanes.mid[Math.floor(MAP.lanes.mid.length / 2)];
      for (const hero of targetHeroes) {
        this.issueOrder(hero.id, { type: 'move', targetPosition: lanePos });
      }
    } else if (lower.includes('bot') || lower.includes('bottom')) {
      const lanePos = MAP.lanes.bot[Math.floor(MAP.lanes.bot.length / 2)];
      for (const hero of targetHeroes) {
        this.issueOrder(hero.id, { type: 'move', targetPosition: lanePos });
      }
    } else if (lower.includes('camp') || lower.includes('jungle') || lower.includes('farm') || lower.includes('clear')) {
      // Find nearest camp to each hero
      for (const hero of targetHeroes) {
        const nearestCamp = this.findNearestCamp(hero.position);
        if (nearestCamp) {
          this.issueOrder(hero.id, { type: 'attack_camp', campId: nearestCamp.id });
        }
      }
    } else if (lower.includes('dragon')) {
      for (const hero of targetHeroes) {
        this.issueOrder(hero.id, { type: 'move', targetPosition: MAP.dragonPit });
      }
    } else if (lower.includes('retreat') || lower.includes('back') || lower.includes('base')) {
      for (const hero of targetHeroes) {
        const spawn = hero.team === 'team1' ? MAP.spawn1[0] : MAP.spawn2[0];
        this.issueOrder(hero.id, { type: 'retreat', targetPosition: spawn });
      }
    } else if (lower.includes('attack') || lower.includes('fight') || lower.includes('push')) {
      // Attack nearest enemy
      for (const hero of targetHeroes) {
        this.issueOrder(hero.id, { type: 'attack' });
      }
    } else if (lower.includes('hold') || lower.includes('stay') || lower.includes('stop')) {
      for (const hero of targetHeroes) {
        this.issueOrder(hero.id, { type: 'hold' });
      }
    } else {
      // Try to interpret as a move to a specific area
      // Check for "bunny", "wolf", "bear", "lion", "turtle" to go to specific camp types
      const monsterTypes: MonsterType[] = ['bunny', 'turtle', 'wolf', 'bear', 'lion'];
      for (const mt of monsterTypes) {
        if (lower.includes(mt) || lower.includes(MONSTER_DEFS[mt].name.toLowerCase())) {
          for (const hero of targetHeroes) {
            const camp = this.findNearestCampOfType(hero.position, mt);
            if (camp) {
              this.issueOrder(hero.id, { type: 'attack_camp', campId: camp.id });
            }
          }
          return;
        }
      }
    }
  }

  // ─── HERO SELECTION ───────────────────────────────────────────
  private selectHero(heroId: string) {
    this.selectedHeroId = heroId;
    const hero = this.heroes.get(heroId);
    if (hero) {
      this.cameras.main.pan(
        hero.position.x * TILE_SIZE,
        hero.position.y * TILE_SIZE,
        300
      );
    }
    this.updateSelectionVisuals();
  }

  private selectHeroByIndex(index: number) {
    const myHeroes = Array.from(this.heroes.values())
      .filter(h => h.team === this.myTeam)
      .sort((a, b) => a.id.localeCompare(b.id));
    if (index < myHeroes.length) {
      this.selectHero(myHeroes[index].id);
    }
  }

  private updateSelectionVisuals() {
    // Update hero sprite visuals to show selection
    this.heroSprites.forEach((container, id) => {
      const isSelected = id === this.selectedHeroId;
      // We'll use a simple scale effect
      container.setScale(isSelected ? 1.3 : 1);
    });
  }

  // ─── ORDERS ───────────────────────────────────────────────────
  private issueOrder(heroId: string, order: JLHeroOrder) {
    const hero = this.heroes.get(heroId);
    if (!hero || hero.isDead) return;

    hero.currentOrder = order;

    // Calculate path if moving
    if (order.targetPosition) {
      hero.path = this.calculateSimplePath(hero.position, order.targetPosition);
    }

    if (order.type === 'attack_camp' && order.campId) {
      const camp = this.camps.find(c => c.id === order.campId);
      if (camp) {
        hero.path = this.calculateSimplePath(hero.position, camp.position);
      }
    }
  }

  private calculateSimplePath(from: Position, to: Position): Position[] {
    // Simple straight-line path with waypoints
    const path: Position[] = [];
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const dist = Math.max(Math.abs(dx), Math.abs(dy));

    for (let i = 1; i <= dist; i++) {
      path.push({
        x: Math.round(from.x + (dx * i) / dist),
        y: Math.round(from.y + (dy * i) / dist),
      });
    }
    return path;
  }

  // ─── HELPERS ──────────────────────────────────────────────────
  private findNearestCamp(pos: Position): JungleCamp | null {
    let nearest: JungleCamp | null = null;
    let minDist = Infinity;
    for (const camp of this.camps) {
      if (camp.monsters.length === 0 && camp.respawnTimer > 0) continue;
      const d = this.dist(pos, camp.position);
      if (d < minDist) {
        minDist = d;
        nearest = camp;
      }
    }
    return nearest;
  }

  private findNearestCampOfType(pos: Position, type: MonsterType): JungleCamp | null {
    let nearest: JungleCamp | null = null;
    let minDist = Infinity;
    for (const camp of this.camps) {
      if (camp.monsterType !== type) continue;
      if (camp.monsters.length === 0 && camp.respawnTimer > 0) continue;
      const d = this.dist(pos, camp.position);
      if (d < minDist) {
        minDist = d;
        nearest = camp;
      }
    }
    return nearest;
  }

  private dist(a: Position, b: Position): number {
    return Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
  }

  private getTeamColor(team: TeamId): number {
    return team === this.myTeam ? 0x4488FF : 0xFF4444;
  }

  // ─── GAME LOOP ────────────────────────────────────────────────
  update(time: number, delta: number) {
    if (this.gameOver) return;

    this.tickAccumulator += delta;
    this.moveAccumulator += delta;
    this.attackAccumulator += delta;
    this.secondAccumulator += delta;

    // Second timer
    while (this.secondAccumulator >= 1000) {
      this.secondAccumulator -= 1000;
      this.timeRemaining--;
      this.minionWaveTimer--;

      if (this.minionWaveTimer <= 0) {
        this.spawnMinionWave();
        this.minionWaveTimer = C.MINION_SPAWN_INTERVAL;
      }

      // Hero respawn countdown
      this.heroes.forEach(hero => {
        if (hero.isDead && hero.respawnTimer > 0) {
          hero.respawnTimer--;
          if (hero.respawnTimer <= 0) {
            this.respawnHero(hero);
          }
        }
      });

      // Passive XP
      this.heroes.forEach(hero => {
        if (!hero.isDead) {
          hero.xp += C.PASSIVE_XP_PER_TICK;
          this.checkLevelUp(hero);
        }
      });

      // Apply alive animal stat bonus
      this.applyAnimalStatBonus();

      // Camp respawn timers
      for (const camp of this.camps) {
        if (camp.monsters.every(m => m.isDead) && camp.respawnTimer > 0) {
          camp.respawnTimer--;
          if (camp.respawnTimer <= 0) {
            this.spawnCampMonsters(camp);
            // Render new monsters
            for (const mon of camp.monsters) {
              this.createMonsterSprite(mon);
            }
          }
        }
      }

      // Dragon respawn
      if (!this.dragonAlive) {
        // Respawn after 60 seconds
      }

      // Dragon buff countdown
      if (this.dragonBuffTeam && this.dragonBuffTimer > 0) {
        this.dragonBuffTimer--;
        if (this.dragonBuffTimer <= 0) {
          this.dragonBuffTeam = undefined;
        }
      }

      this.timerText.setText(this.formatTime(Math.max(0, this.timeRemaining)));
    }

    // Game tick (logic)
    while (this.tickAccumulator >= C.TICK_RATE) {
      this.tickAccumulator -= C.TICK_RATE;
      this.gameTick();
    }

    // Movement tick
    while (this.moveAccumulator >= C.MOVE_TICK) {
      this.moveAccumulator -= C.MOVE_TICK;
      this.moveTick();
    }

    // Attack tick
    while (this.attackAccumulator >= C.ATTACK_INTERVAL) {
      this.attackAccumulator -= C.ATTACK_INTERVAL;
      this.attackTick();
    }

    // Update visuals
    this.updateVisuals();
    this.updateInfoPanel();
  }

  // ─── GAME TICK ────────────────────────────────────────────────
  private gameTick() {
    // AI for enemy team (simple)
    this.runEnemyAI();
  }

  private runEnemyAI() {
    const enemyHeroes = Array.from(this.heroes.values())
      .filter(h => h.team === this.enemyTeam && !h.isDead);

    for (const hero of enemyHeroes) {
      if (hero.currentOrder) continue; // already has orders

      // Simple AI: alternate between farming and pushing
      const roll = Math.random();
      if (roll < 0.6) {
        // Farm nearest camp
        const camp = this.findNearestCamp(hero.position);
        if (camp) {
          this.issueOrder(hero.id, { type: 'attack_camp', campId: camp.id });
        }
      } else {
        // Push a lane
        const lanes: LaneId[] = ['top', 'mid', 'bot'];
        const lane = lanes[Math.floor(Math.random() * 3)];
        // Move towards enemy (team1) side
        const waypoints = MAP.lanes[lane];
        const targetIdx = Math.floor(waypoints.length * 0.3); // push towards team1
        this.issueOrder(hero.id, { type: 'move', targetPosition: waypoints[targetIdx] });
      }
    }
  }

  // ─── MOVEMENT TICK ────────────────────────────────────────────
  private moveTick() {
    // Move heroes along paths
    this.heroes.forEach(hero => {
      if (hero.isDead || !hero.path || hero.path.length === 0) return;

      const next = hero.path[0];
      hero.position = { ...next };
      hero.path.shift();

      // If arrived at camp, start attacking it
      if (hero.path.length === 0 && hero.currentOrder?.type === 'attack_camp') {
        // Camp attack is handled in attack tick via proximity
      }

      if (hero.path.length === 0 && hero.currentOrder?.type === 'move') {
        hero.currentOrder = null;
      }
    });

    // Move minions along lane paths
    for (const minion of this.minions) {
      if (minion.isDead || minion.targetId) continue; // don't move while fighting
      if (minion.pathIndex >= minion.path.length) continue;

      const target = minion.path[minion.pathIndex];
      const dx = target.x - minion.position.x;
      const dy = target.y - minion.position.y;

      if (Math.abs(dx) <= 1 && Math.abs(dy) <= 1) {
        minion.position = { ...target };
        minion.pathIndex++;
      } else {
        // Move towards waypoint
        minion.position.x += Math.sign(dx);
        minion.position.y += Math.sign(dy);
      }
    }

    // Move converted monsters along lane paths
    for (const mon of this.convertedMonsters) {
      if (mon.isDead || mon.targetId) continue;
      if (mon.pathIndex >= mon.path.length) continue;

      const target = mon.path[mon.pathIndex];
      const dx = target.x - mon.position.x;
      const dy = target.y - mon.position.y;

      if (Math.abs(dx) <= 1 && Math.abs(dy) <= 1) {
        mon.position = { ...target };
        mon.pathIndex++;
      } else {
        mon.position.x += Math.sign(dx);
        mon.position.y += Math.sign(dy);
      }
    }
  }

  // ─── ATTACK TICK ──────────────────────────────────────────────
  private attackTick() {
    // Heroes auto-attack
    this.heroes.forEach(hero => {
      if (hero.isDead) return;

      // Priority: enemy heroes > enemy converted/minions > jungle camps
      const target = this.findHeroTarget(hero);
      if (target) {
        this.dealDamage(target, hero.attack);
        return;
      }

      // Attack camp if near one and ordered to
      if (hero.currentOrder?.type === 'attack_camp') {
        const camp = this.camps.find(c => c.id === hero.currentOrder?.campId);
        if (camp) {
          const aliveMonsters = camp.monsters.filter(m => !m.isDead);
          if (aliveMonsters.length > 0) {
            const nearest = this.getNearestEntity(hero.position, aliveMonsters);
            if (nearest && this.dist(hero.position, nearest.position) <= hero.range + 2) {
              this.attackJungleMonster(hero, nearest);
            }
          } else {
            // Camp cleared, reset order
            hero.currentOrder = null;
          }
        }
      }

      // Also attack dragon if close
      if (this.dragonAlive && this.dragonMonster && this.dist(hero.position, MAP.dragonPit) <= 3) {
        this.attackDragon(hero);
      }
    });

    // Minions auto-attack
    for (const minion of this.minions) {
      if (minion.isDead) continue;
      const target = this.findMinionTarget(minion);
      if (target) {
        this.dealDamage(target, minion.attack);
        minion.targetId = target.id;
      } else {
        minion.targetId = undefined;
      }
    }

    // Converted monsters auto-attack
    for (const mon of this.convertedMonsters) {
      if (mon.isDead) continue;
      const target = this.findConvertedTarget(mon);
      if (target) {
        this.dealDamage(target, mon.attack);
        mon.targetId = target.id;
      } else {
        mon.targetId = undefined;
      }
    }

    // Towers attack
    for (const tower of this.towers) {
      if (!tower.alive) continue;
      const target = this.findTowerTarget(tower);
      if (target) {
        this.dealDamage(target, tower.damage);
      }
    }

    // Jungle monsters fight back when attacked
    for (const camp of this.camps) {
      for (const mon of camp.monsters) {
        if (mon.isDead) continue;
        // Attack nearest enemy hero in range
        const nearHero = this.getNearestEnemyHero(mon.position, 2);
        if (nearHero) {
          this.dealDamageToHero(nearHero, mon.attack);
        }
      }
    }

    // Dragon fights back
    if (this.dragonAlive && this.dragonMonster) {
      const nearHero = this.getNearestHeroToPosition(this.dragonMonster.position, 3);
      if (nearHero) {
        this.dealDamageToHero(nearHero, this.dragonMonster.attack);
      }
    }

    // Clean up dead minions and monsters
    this.cleanupDead();
  }

  private findHeroTarget(hero: JungleHero): { id: string; position: Position; hp: number; maxHp: number } | null {
    const range = hero.range + 1;
    const enemyTeam = hero.team === 'team1' ? 'team2' : 'team1';

    // Enemy heroes first
    const enemyHeroes = Array.from(this.heroes.values())
      .filter(h => h.team === enemyTeam && !h.isDead && this.dist(hero.position, h.position) <= range);
    if (enemyHeroes.length > 0) {
      return enemyHeroes[0];
    }

    // Enemy minions/converted
    const enemyUnits = [
      ...this.minions.filter(m => m.team === enemyTeam && !m.isDead && this.dist(hero.position, m.position) <= range),
      ...this.convertedMonsters.filter(m => m.team === enemyTeam && !m.isDead && this.dist(hero.position, m.position) <= range),
    ];
    if (enemyUnits.length > 0) {
      return enemyUnits[0];
    }

    return null;
  }

  private findMinionTarget(minion: LaneMinion): { id: string; position: Position; hp: number; maxHp: number } | null {
    const range = 2;
    const enemyTeam = minion.team === 'team1' ? 'team2' : 'team1';

    // Check enemy minions in range
    const enemies = this.minions
      .filter(m => m.team === enemyTeam && !m.isDead && m.lane === minion.lane && this.dist(minion.position, m.position) <= range);
    if (enemies.length > 0) return enemies[0];

    // Check enemy converted monsters
    const converted = this.convertedMonsters
      .filter(m => m.team === enemyTeam && !m.isDead && m.lane === minion.lane && this.dist(minion.position, m.position) <= range);
    if (converted.length > 0) return converted[0];

    // Check enemy towers
    const enemyTowers = this.towers
      .filter(t => t.team === enemyTeam && t.alive && t.lane === minion.lane && this.dist(minion.position, t.position) <= range);
    if (enemyTowers.length > 0) {
      // Only attack outermost alive tower
      const sorted = enemyTowers.sort((a, b) => a.index - b.index);
      return { id: sorted[0].id, position: sorted[0].position, hp: sorted[0].hp, maxHp: sorted[0].maxHp };
    }

    // Check nexus
    const nexus = this.nexuses[enemyTeam];
    if (nexus.alive && this.dist(minion.position, nexus.position) <= range) {
      return { id: `nexus_${enemyTeam}`, position: nexus.position, hp: nexus.hp, maxHp: nexus.maxHp };
    }

    return null;
  }

  private findConvertedTarget(mon: ConvertedMonster): { id: string; position: Position; hp: number; maxHp: number } | null {
    // Same logic as minion
    return this.findMinionTarget(mon as any);
  }

  private findTowerTarget(tower: LaneTower): { id: string; position: Position; hp: number; maxHp: number } | null {
    const range = tower.range;
    const enemyTeam = tower.team === 'team1' ? 'team2' : 'team1';

    // Priority: enemy heroes, then minions, then converted
    const heroes = Array.from(this.heroes.values())
      .filter(h => h.team === enemyTeam && !h.isDead && this.dist(tower.position, h.position) <= range);
    if (heroes.length > 0) return heroes[0];

    const enemyMinions = this.minions
      .filter(m => m.team === enemyTeam && !m.isDead && this.dist(tower.position, m.position) <= range);
    if (enemyMinions.length > 0) return enemyMinions[0];

    const converted = this.convertedMonsters
      .filter(m => m.team === enemyTeam && !m.isDead && this.dist(tower.position, m.position) <= range);
    if (converted.length > 0) return converted[0];

    return null;
  }

  // ─── DAMAGE ───────────────────────────────────────────────────
  private dealDamage(target: { id: string; hp: number; maxHp: number }, damage: number) {
    // Find what entity this is and apply damage
    const hero = this.heroes.get(target.id);
    if (hero) {
      this.dealDamageToHero(hero, damage);
      return;
    }

    const minion = this.minions.find(m => m.id === target.id);
    if (minion) {
      minion.hp = Math.max(0, minion.hp - Math.max(1, damage - minion.defense));
      if (minion.hp <= 0) minion.isDead = true;
      return;
    }

    const converted = this.convertedMonsters.find(m => m.id === target.id);
    if (converted) {
      converted.hp = Math.max(0, converted.hp - Math.max(1, damage - converted.defense));
      if (converted.hp <= 0) converted.isDead = true;
      return;
    }

    // Tower
    const tower = this.towers.find(t => t.id === target.id);
    if (tower) {
      tower.hp = Math.max(0, tower.hp - damage);
      if (tower.hp <= 0) {
        tower.alive = false;
        this.onTowerDestroyed(tower);
      }
      return;
    }

    // Nexus
    if (target.id.startsWith('nexus_')) {
      const team = target.id.replace('nexus_', '') as TeamId;
      const nexus = this.nexuses[team];
      nexus.hp = Math.max(0, nexus.hp - damage);
      if (nexus.hp <= 0) {
        nexus.alive = false;
        this.onNexusDestroyed(team);
      }
    }
  }

  private dealDamageToHero(hero: JungleHero, damage: number) {
    const actualDmg = Math.max(1, damage - hero.defense);
    hero.hp = Math.max(0, hero.hp - actualDmg);
    if (hero.hp <= 0) {
      hero.isDead = true;
      hero.respawnTimer = C.RESPAWN_TIME;
      hero.currentOrder = null;
      hero.path = [];
    }
  }

  private attackJungleMonster(hero: JungleHero, monster: JungleMonster) {
    const dmg = Math.max(1, hero.attack - monster.defense);
    monster.hp -= dmg;

    if (monster.hp <= 0) {
      monster.isDead = true;

      // Convert the monster - it joins the hero's team!
      const def = MONSTER_DEFS[monster.type];
      const lane = this.camps.find(c => c.id === monster.campId)?.nearestLane || 'mid';

      // Get lane path for converted monster
      const waypoints = MAP.lanes[lane];
      const path = hero.team === 'team1' ? [...waypoints] : [...waypoints].reverse();

      const converted: ConvertedMonster = {
        id: `conv_${this.nextId++}`,
        type: monster.type,
        team: hero.team,
        lane,
        position: { ...monster.position },
        hp: def.stats.hp,       // Full heal on conversion
        maxHp: def.stats.hp,
        attack: def.stats.attack,
        defense: def.stats.defense,
        speed: def.stats.speed,
        range: def.stats.range,
        isDead: false,
        path: path,
        pathIndex: 0,
      };

      this.convertedMonsters.push(converted);
      this.createConvertedSprite(converted);

      // Remove old monster sprite
      const sprite = this.monsterSprites.get(monster.id);
      if (sprite) {
        sprite.destroy();
        this.monsterSprites.delete(monster.id);
      }

      // XP for the hero
      hero.xp += 15 + def.tier * 10;
      this.checkLevelUp(hero);

      // Check if camp fully cleared
      const camp = this.camps.find(c => c.id === monster.campId);
      if (camp && camp.monsters.every(m => m.isDead)) {
        camp.respawnTimer = C.CAMP_RESPAWN_TICKS;
      }
    }
  }

  private attackDragon(hero: JungleHero) {
    if (!this.dragonMonster) return;
    const dmg = Math.max(1, hero.attack - this.dragonMonster.defense);
    this.dragonMonster.hp -= dmg;

    if (this.dragonMonster.hp <= 0) {
      this.dragonAlive = false;
      this.dragonBuffTeam = hero.team;
      this.dragonBuffTimer = C.DRAGON_BUFF_DURATION;

      // Dragon sprite hide
      if (this.dragonSprite) {
        this.dragonSprite.setVisible(false);
      }
    }
  }

  // ─── CONVERTED MONSTER SPRITE ─────────────────────────────────
  private createConvertedSprite(mon: ConvertedMonster) {
    const def = MONSTER_DEFS[mon.type];
    const container = this.add.container(
      mon.position.x * TILE_SIZE + TILE_SIZE / 2,
      mon.position.y * TILE_SIZE + TILE_SIZE / 2
    );

    const isMyTeam = mon.team === this.myTeam;
    const color = isMyTeam ? 0x2266FF : 0xFF2222;

    const bg = this.add.graphics();
    bg.fillStyle(color, 0.5);
    bg.fillCircle(0, 0, 10);
    bg.lineStyle(1, color, 0.8);
    bg.strokeCircle(0, 0, 10);
    container.add(bg);

    const emoji = this.add.text(0, -1, def.emoji, { fontSize: '13px' }).setOrigin(0.5);
    container.add(emoji);

    // HP bar
    const hpBg = this.add.graphics();
    hpBg.fillStyle(0x000000, 0.5);
    hpBg.fillRect(-8, 10, 16, 2);
    container.add(hpBg);

    const hpFill = this.add.graphics();
    hpFill.fillStyle(color, 1);
    hpFill.fillRect(-8, 10, 16, 2);
    container.add(hpFill);

    container.setDepth(9);
    this.convertedSprites.set(mon.id, container);
  }

  // ─── LEVEL UP ─────────────────────────────────────────────────
  private checkLevelUp(hero: JungleHero) {
    const thresholds = C.XP_PER_LEVEL;
    while (hero.level < thresholds.length - 1 && hero.xp >= thresholds[hero.level]) {
      hero.level++;
      const bonus = 1 + C.LEVEL_STAT_BONUS * (hero.level - 1);
      hero.maxHp = Math.round(C.HERO_BASE_HP * bonus);
      hero.attack = Math.round(C.HERO_BASE_ATTACK * bonus);
      hero.defense = Math.round(C.HERO_BASE_DEFENSE * bonus);
      hero.hp = hero.maxHp; // Full heal on level up
    }
  }

  private applyAnimalStatBonus() {
    // Count alive converted monsters per team
    const alivePerTeam: Record<TeamId, number> = { team1: 0, team2: 0 };
    for (const mon of this.convertedMonsters) {
      if (!mon.isDead) {
        alivePerTeam[mon.team]++;
      }
    }

    // Apply bonus to heroes (recalculate from base)
    this.heroes.forEach(hero => {
      if (hero.isDead) return;
      const bonus = 1 + C.LEVEL_STAT_BONUS * (hero.level - 1)
        + C.ALIVE_ANIMAL_STAT_BONUS * alivePerTeam[hero.team];
      const dragonMult = (this.dragonBuffTeam === hero.team) ? C.DRAGON_BUFF_MULTIPLIER : 1;
      hero.maxHp = Math.round(C.HERO_BASE_HP * bonus * dragonMult);
      hero.attack = Math.round(C.HERO_BASE_ATTACK * bonus * dragonMult);
      hero.defense = Math.round(C.HERO_BASE_DEFENSE * bonus * dragonMult);
    });
  }

  // ─── EVENTS ───────────────────────────────────────────────────
  private respawnHero(hero: JungleHero) {
    hero.isDead = false;
    hero.hp = hero.maxHp;
    const spawn = hero.team === 'team1' ? MAP.spawn1 : MAP.spawn2;
    const idx = parseInt(hero.id.split('_')[2]) || 0;
    hero.position = { ...spawn[idx % spawn.length] };
    hero.currentOrder = null;
    hero.path = [];
  }

  private onTowerDestroyed(tower: LaneTower) {
    const sprite = this.towerSprites.get(tower.id);
    if (sprite) {
      sprite.setAlpha(0.3);
    }
  }

  private onNexusDestroyed(team: TeamId) {
    this.gameOver = true;
    const winner = team === 'team1' ? 'team2' : 'team1';
    const isWin = winner === this.myTeam;

    // Show result
    const { width, height } = this.cameras.main;
    const resultText = this.add.text(width / 2, height / 2, isWin ? 'VICTORY!' : 'DEFEAT', {
      fontSize: '64px',
      color: isWin ? '#45E6B0' : '#FF6B6B',
      fontFamily: '"Fredoka", sans-serif',
      fontStyle: 'bold',
      backgroundColor: '#000000AA',
      padding: { x: 30, y: 20 },
    }).setOrigin(0.5).setScrollFactor(0).setDepth(200);

    this.tweens.add({
      targets: resultText,
      scaleX: { from: 0, to: 1 },
      scaleY: { from: 0, to: 1 },
      duration: 800,
      ease: 'Back.easeOut',
    });
  }

  private getNearestEntity<T extends { position: Position; isDead?: boolean }>(
    pos: Position, entities: T[]
  ): T | null {
    let nearest: T | null = null;
    let minDist = Infinity;
    for (const e of entities) {
      if (e.isDead) continue;
      const d = this.dist(pos, e.position);
      if (d < minDist) {
        minDist = d;
        nearest = e;
      }
    }
    return nearest;
  }

  private getNearestEnemyHero(pos: Position, range: number): JungleHero | null {
    // This is for jungle monsters - they attack any hero nearby
    let nearest: JungleHero | null = null;
    let minDist = Infinity;
    this.heroes.forEach(hero => {
      if (hero.isDead) return;
      const d = this.dist(pos, hero.position);
      if (d <= range && d < minDist) {
        minDist = d;
        nearest = hero;
      }
    });
    return nearest;
  }

  private getNearestHeroToPosition(pos: Position, range: number): JungleHero | null {
    return this.getNearestEnemyHero(pos, range);
  }

  // ─── CLEANUP ──────────────────────────────────────────────────
  private cleanupDead() {
    // Remove dead minion sprites
    for (let i = this.minions.length - 1; i >= 0; i--) {
      if (this.minions[i].isDead) {
        const sprite = this.minionSprites.get(this.minions[i].id);
        if (sprite) {
          sprite.destroy();
          this.minionSprites.delete(this.minions[i].id);
        }
        this.minions.splice(i, 1);
      }
    }

    // Remove dead converted monster sprites
    for (let i = this.convertedMonsters.length - 1; i >= 0; i--) {
      if (this.convertedMonsters[i].isDead) {
        const sprite = this.convertedSprites.get(this.convertedMonsters[i].id);
        if (sprite) {
          sprite.destroy();
          this.convertedSprites.delete(this.convertedMonsters[i].id);
        }
        this.convertedMonsters.splice(i, 1);
      }
    }
  }

  // ─── VISUAL UPDATES ──────────────────────────────────────────
  private updateVisuals() {
    // Update hero positions
    this.heroes.forEach((hero, id) => {
      const sprite = this.heroSprites.get(id);
      if (!sprite) return;

      const tx = hero.position.x * TILE_SIZE + TILE_SIZE / 2;
      const ty = hero.position.y * TILE_SIZE + TILE_SIZE / 2;

      // Smooth lerp
      sprite.x += (tx - sprite.x) * 0.15;
      sprite.y += (ty - sprite.y) * 0.15;

      // Update HP bar (4th child is the fill graphics)
      const hpFill = sprite.list[3] as Phaser.GameObjects.Graphics;
      if (hpFill) {
        hpFill.clear();
        const ratio = hero.hp / hero.maxHp;
        const color = ratio > 0.5 ? 0x44FF44 : ratio > 0.25 ? 0xFFDD00 : 0xFF4444;
        hpFill.fillStyle(color, 1);
        hpFill.fillRect(-12, 14, 24 * ratio, 3);
      }

      // Show/hide based on dead
      sprite.setVisible(!hero.isDead);
    });

    // Update tower HP
    for (const tower of this.towers) {
      const sprite = this.towerSprites.get(tower.id);
      if (!sprite) continue;
      const hpFill = sprite.list[3] as Phaser.GameObjects.Graphics;
      if (hpFill) {
        hpFill.clear();
        const ratio = tower.hp / tower.maxHp;
        const color = this.getTeamColor(tower.team);
        hpFill.fillStyle(color, 1);
        hpFill.fillRect(-12, 14, 24 * ratio, 3);
      }
      sprite.setVisible(tower.alive);
    }

    // Update nexus HP
    for (const team of ['team1', 'team2'] as TeamId[]) {
      const nexus = this.nexuses[team];
      const sprite = this.nexusSprites.get(team);
      if (!sprite) continue;
      const hpFill = sprite.list[3] as Phaser.GameObjects.Graphics;
      if (hpFill) {
        hpFill.clear();
        const ratio = nexus.hp / nexus.maxHp;
        const color = this.getTeamColor(team);
        hpFill.fillStyle(color, 1);
        hpFill.fillRect(-18, 24, 36 * ratio, 4);
      }
    }

    // Update jungle monster HP
    for (const camp of this.camps) {
      for (const mon of camp.monsters) {
        const sprite = this.monsterSprites.get(mon.id);
        if (!sprite) continue;
        sprite.setVisible(!mon.isDead);
        if (!mon.isDead) {
          const hpFill = sprite.list[3] as Phaser.GameObjects.Graphics;
          if (hpFill) {
            hpFill.clear();
            const ratio = mon.hp / mon.maxHp;
            hpFill.fillStyle(0xFFAA00, 1);
            hpFill.fillRect(-8, 10, 16 * ratio, 2);
          }
        }
      }
    }

    // Update dragon HP
    if (this.dragonSprite && this.dragonMonster) {
      const hpFill = this.dragonSprite.list[4] as Phaser.GameObjects.Graphics;
      if (hpFill) {
        hpFill.clear();
        const ratio = this.dragonMonster.hp / this.dragonMonster.maxHp;
        hpFill.fillStyle(0xFF4400, 1);
        hpFill.fillRect(-14, 18, 28 * ratio, 4);
      }
    }

    // Update/create minion sprites
    for (const minion of this.minions) {
      if (minion.isDead) continue;
      let sprite = this.minionSprites.get(minion.id);
      if (!sprite) {
        sprite = this.createMinionSprite(minion);
      }
      const tx = minion.position.x * TILE_SIZE + TILE_SIZE / 2;
      const ty = minion.position.y * TILE_SIZE + TILE_SIZE / 2;
      sprite.x += (tx - sprite.x) * 0.15;
      sprite.y += (ty - sprite.y) * 0.15;
    }

    // Update converted monster positions
    for (const mon of this.convertedMonsters) {
      if (mon.isDead) continue;
      const sprite = this.convertedSprites.get(mon.id);
      if (!sprite) continue;
      const tx = mon.position.x * TILE_SIZE + TILE_SIZE / 2;
      const ty = mon.position.y * TILE_SIZE + TILE_SIZE / 2;
      sprite.x += (tx - sprite.x) * 0.15;
      sprite.y += (ty - sprite.y) * 0.15;

      // Update HP
      const hpFill = sprite.list[3] as Phaser.GameObjects.Graphics;
      if (hpFill) {
        hpFill.clear();
        const ratio = mon.hp / mon.maxHp;
        const color = this.getTeamColor(mon.team);
        hpFill.fillStyle(color, 1);
        hpFill.fillRect(-8, 10, 16 * ratio, 2);
      }
    }
  }

  private createMinionSprite(minion: LaneMinion): Phaser.GameObjects.Container {
    const isMyTeam = minion.team === this.myTeam;
    const color = isMyTeam ? 0x2266FF : 0xFF2222;

    const container = this.add.container(
      minion.position.x * TILE_SIZE + TILE_SIZE / 2,
      minion.position.y * TILE_SIZE + TILE_SIZE / 2
    );

    const bg = this.add.graphics();
    bg.fillStyle(color, 0.4);
    bg.fillCircle(0, 0, 6);
    container.add(bg);

    const dot = this.add.graphics();
    dot.fillStyle(color, 0.8);
    dot.fillCircle(0, 0, 3);
    container.add(dot);

    container.setDepth(7);
    this.minionSprites.set(minion.id, container);
    return container;
  }

  // ─── INFO PANEL ───────────────────────────────────────────────
  private updateInfoPanel() {
    const myHeroes = Array.from(this.heroes.values()).filter(h => h.team === this.myTeam);
    const aliveAnimals = this.convertedMonsters.filter(m => m.team === this.myTeam && !m.isDead).length;
    const enemyAnimals = this.convertedMonsters.filter(m => m.team === this.enemyTeam && !m.isDead).length;

    let info = `Your Animals: ${aliveAnimals} | Enemy Animals: ${enemyAnimals}`;
    if (this.dragonBuffTeam) {
      info += `\nDragon Buff: ${this.dragonBuffTeam === this.myTeam ? 'YOURS' : 'ENEMY'} (${this.dragonBuffTimer}s)`;
    }
    info += '\n';

    for (const hero of myHeroes) {
      const status = hero.isDead ? `DEAD (${hero.respawnTimer}s)` : `HP:${hero.hp}/${hero.maxHp}`;
      const order = hero.currentOrder ? hero.currentOrder.type : 'idle';
      info += `\n${hero.emoji} ${hero.name} Lv${hero.level} ${status} [${order}]`;
    }

    if (this.selectedHeroId) {
      const hero = this.heroes.get(this.selectedHeroId);
      if (hero) {
        info += `\n\nSelected: ${hero.name} | ATK:${hero.attack} DEF:${hero.defense}`;
      }
    }

    this.infoText.setText(info);
  }
}
