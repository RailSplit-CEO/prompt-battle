import Phaser from 'phaser';
import {
  DraftPick, Character, computeStats, CLASSES, ANIMALS,
  Position, CharacterOrder, CTFState, ControlPoint,
} from '@prompt-battle/shared';
import { CharacterEntity } from '../entities/Character';
import {
  generateMap, GameMap, MAP_WIDTH, MAP_HEIGHT, TILE_SIZE, isPassable,
} from '../map/MapGenerator';
import { findPath } from '../map/Pathfinding';
import { CommandInput } from '../systems/CommandInput';
import { FirebaseSync } from '../network/FirebaseSync';
import { generateCharacterName, resetNames } from '../systems/NameGenerator';
import {
  parseCommandWithGemini, GeminiParseResult,
} from '../systems/GeminiCommandParser';
import { SoundManager } from '../systems/SoundManager';
import { MiniMap } from '../systems/MiniMap';

// ─── CONSTANTS ────────────────────────────────────────────────────
const COMMAND_COOLDOWN = 4000;
const GAME_DURATION = 300;
const RESPAWN_TIME = 30;
const TICK_RATE = 500;
const MOVE_TICK = 600;
const BASE_VISION = 5;
const PICKUP_RESPAWN = 25; // seconds

// ─── TYPES ────────────────────────────────────────────────────────

interface GameAction {
  characterId: string;
  type: string;
  target?: Position | string;
  abilityId?: string;
  result?: { damage?: number; killed?: string };
}

interface Pickup {
  id: string;
  type: 'health_potion' | 'speed_boost' | 'damage_boost';
  position: Position;
  active: boolean;
  respawnTimer: number;
  sprite?: Phaser.GameObjects.Sprite;
  label?: Phaser.GameObjects.Text;
}

interface BattleSceneData {
  gameId: string;
  playerId: string;
  isLocal: boolean;
  picks: DraftPick[];
}

export class BattleScene extends Phaser.Scene {
  private gameId!: string;
  private playerId!: string;
  private isLocal!: boolean;
  private picks!: DraftPick[];

  private gameMap!: GameMap;
  private characters: Map<string, CharacterEntity> = new Map();
  private charData: Map<string, Character> = new Map();
  private commandInput!: CommandInput;
  private firebase!: FirebaseSync;
  private hasGemini = false;

  // Real-time state
  private gameTimeRemaining = GAME_DURATION;
  private lastCommandTime = 0;
  private commandCooldownRemaining = 0;
  private gameOver = false;

  // CTF
  private ctf!: CTFState;
  private flag1Sprite!: Phaser.GameObjects.Container;
  private flag2Sprite!: Phaser.GameObjects.Container;

  // Fog of war
  private fogLayer!: Phaser.GameObjects.Graphics;
  private visibleTiles: Set<string> = new Set();

  // Pickups
  private pickups: Pickup[] = [];

  // Order queues (charId -> queued orders)
  private orderQueues: Map<string, CharacterOrder[]> = new Map();

  // Tick timers
  private gameTickTimer?: Phaser.Time.TimerEvent;
  private moveTickTimer?: Phaser.Time.TimerEvent;
  private secondTimer?: Phaser.Time.TimerEvent;

  // Control Points
  private controlPoints: ControlPoint[] = [];
  private cpSprites: Map<string, Phaser.GameObjects.Container> = new Map();

  // Terrain mechanics
  private forestAmbushUsed: Set<string> = new Set(); // charId -> used
  private lastCharTile: Map<string, string> = new Map(); // charId -> "x,y"

  // Sound
  private sound_: SoundManager = SoundManager.getInstance();

  // Mini-map
  private miniMap!: MiniMap;

  // Path visualization
  private pathGraphics!: Phaser.GameObjects.Graphics;

  // Map rendering
  private tileLayer!: Phaser.GameObjects.Group;

  // HUD elements (HTML)
  private commandLogEl!: HTMLElement;
  private statusBarEl!: HTMLElement;
  private commandBarEl!: HTMLElement;
  private abilityPanelEl!: HTMLElement;

  // HUD elements (Phaser)
  private timerText!: Phaser.GameObjects.Text;
  private cooldownBar!: Phaser.GameObjects.Graphics;
  private cooldownText!: Phaser.GameObjects.Text;
  private scoreText!: Phaser.GameObjects.Text;
  private objectiveText!: Phaser.GameObjects.Text;

  constructor() {
    super({ key: 'BattleScene' });
  }

  init(data: BattleSceneData) {
    this.gameId = data.gameId;
    this.playerId = data.playerId;
    this.isLocal = data.isLocal;
    this.picks = data.picks;
  }

  create() {
    this.firebase = FirebaseSync.getInstance();
    resetNames();
    this.gameOver = false;
    this.gameTimeRemaining = GAME_DURATION;
    this.lastCommandTime = 0;
    this.commandCooldownRemaining = 0;
    this.orderQueues.clear();

    this.hasGemini = !!((import.meta as any).env?.VITE_GEMINI_API_KEY);

    const seed = this.isLocal
      ? Date.now()
      : this.gameId.split('').reduce((a, c) => a + c.charCodeAt(0), 0);
    this.gameMap = generateMap(seed);

    this.renderMap();
    this.createCharacters();
    this.initCTF();
    this.initControlPoints();
    this.spawnPickups();
    this.initFogOfWar();
    this.pathGraphics = this.add.graphics().setDepth(4);
    this.miniMap = new MiniMap(this);

    const worldWidth = MAP_WIDTH * TILE_SIZE;
    const worldHeight = MAP_HEIGHT * TILE_SIZE;
    this.cameras.main.setBounds(0, 0, worldWidth, worldHeight);
    this.cameras.main.centerOn(worldWidth / 2, worldHeight / 2);
    this.setupCameraControls();

    // HUD (HTML)
    this.commandBarEl = document.getElementById('command-bar')!;
    this.commandLogEl = document.getElementById('command-log')!;
    this.statusBarEl = document.getElementById('status-bar')!;
    this.abilityPanelEl = document.getElementById('ability-panel')!;
    this.commandBarEl.style.display = 'block';
    this.commandLogEl.style.display = 'block';
    this.statusBarEl.style.display = 'flex';
    this.abilityPanelEl.style.display = 'block';

    this.createPhaserHUD();

    this.commandInput = new CommandInput(this, this.gameId, this.playerId, this.isLocal);
    this.commandInput.onCommand((rawText) => this.handleCommand(rawText));
    this.updateStatusBar();

    this.characters.forEach((charEntity) => {
      charEntity.sprite.on('pointerdown', () => {
        this.characters.forEach(c => c.deselect());
        charEntity.select();
      });
    });

    this.startGameLoop();
    this.cameras.main.fadeIn(500, 5, 5, 16);

    if (!this.isLocal) {
      this.firebase.onGameStateUpdate(this.gameId, (state) => {
        this.applyServerState(state);
      });
    }
  }

  // ─── MAP RENDERING ──────────────────────────────────────────────

  private renderMap() {
    this.tileLayer = this.add.group();
    for (let y = 0; y < MAP_HEIGHT; y++) {
      for (let x = 0; x < MAP_WIDTH; x++) {
        const tile = this.gameMap.tiles[y][x];
        const sprite = this.add.sprite(
          x * TILE_SIZE + TILE_SIZE / 2,
          y * TILE_SIZE + TILE_SIZE / 2,
          `tile_${tile}`
        );
        sprite.setDepth(0);
        this.tileLayer.add(sprite);
      }
    }
  }

  // ─── CHARACTER CREATION ─────────────────────────────────────────

  private createCharacters() {
    const myPicks = this.picks.filter(p => p.playerId === this.playerId);
    const oppPicks = this.picks.filter(p => p.playerId !== this.playerId);

    myPicks.forEach((pick, i) => {
      const charData = this.buildCharacter(pick, i, true);
      this.charData.set(charData.id, charData);
      const entity = new CharacterEntity(this, charData, true);
      this.characters.set(charData.id, entity);
      this.orderQueues.set(charData.id, []);
    });

    oppPicks.forEach((pick, i) => {
      const charData = this.buildCharacter(pick, i, false);
      this.charData.set(charData.id, charData);
      const entity = new CharacterEntity(this, charData, false);
      this.characters.set(charData.id, entity);
      this.orderQueues.set(charData.id, []);
    });
  }

  private buildCharacter(pick: DraftPick, index: number, isPlayer1: boolean): Character {
    const cls = CLASSES[pick.classId];
    const animal = ANIMALS[pick.animalId];
    const stats = computeStats(cls.baseStats, animal.statModifiers);
    const spawns = isPlayer1 ? this.gameMap.spawnP1 : this.gameMap.spawnP2;
    const name = generateCharacterName();

    let visionRange = BASE_VISION;
    if (pick.classId === 'archer' || pick.animalId === 'falcon' || pick.animalId === 'owl') {
      visionRange = 7;
    }
    if (pick.classId === 'rogue' || pick.animalId === 'spider') {
      visionRange = 6;
    }

    return {
      id: `${pick.playerId}_${pick.classId}_${index}`,
      owner: pick.playerId,
      classId: pick.classId,
      animalId: pick.animalId,
      name,
      stats,
      currentHp: stats.hp,
      position: { ...spawns[index] },
      cooldowns: {},
      effects: [],
      isDead: false,
      respawnTimer: 0,
      currentOrder: null,
      path: [],
      hasFlag: false,
      visionRange,
    };
  }

  // ─── CTF ────────────────────────────────────────────────────────

  private initCTF() {
    this.ctf = {
      flag1: {
        position: { ...this.gameMap.flagP1 },
        homePosition: { ...this.gameMap.flagP1 },
        carrier: null,
        isHome: true,
      },
      flag2: {
        position: { ...this.gameMap.flagP2 },
        homePosition: { ...this.gameMap.flagP2 },
        carrier: null,
        isHome: true,
      },
      score1: 0,
      score2: 0,
      capturesNeeded: 1,
    };

    this.flag1Sprite = this.createFlagSprite(this.gameMap.flagP1, 0x4444ff);
    this.flag2Sprite = this.createFlagSprite(this.gameMap.flagP2, 0xff4444);
  }

  private createFlagSprite(pos: Position, color: number): Phaser.GameObjects.Container {
    const px = pos.x * TILE_SIZE + TILE_SIZE / 2;
    const py = pos.y * TILE_SIZE + TILE_SIZE / 2;
    const container = this.add.container(px, py);

    const base = this.add.graphics();
    base.fillStyle(color, 0.3);
    base.fillCircle(0, 0, 12);
    base.lineStyle(2, color, 0.6);
    base.strokeCircle(0, 0, 12);
    container.add(base);

    const pole = this.add.graphics();
    pole.lineStyle(2, 0xffffff);
    pole.lineBetween(0, 4, 0, -14);
    pole.fillStyle(color);
    pole.fillTriangle(0, -14, 10, -10, 0, -6);
    container.add(pole);

    const glow = this.add.circle(0, 0, 16, color, 0.15);
    container.add(glow);
    this.tweens.add({
      targets: glow,
      alpha: { from: 0.1, to: 0.25 },
      scaleX: { from: 1, to: 1.3 },
      scaleY: { from: 1, to: 1.3 },
      duration: 1500,
      yoyo: true,
      repeat: -1,
    });

    container.setDepth(8);
    return container;
  }

  private updateFlagPositions() {
    this.updateSingleFlag(this.ctf.flag1, this.flag1Sprite);
    this.updateSingleFlag(this.ctf.flag2, this.flag2Sprite);

    this.charData.forEach((char) => {
      if (char.isDead) return;
      const pos = char.position;
      const isMine = char.owner === this.playerId;

      const enemyFlag = isMine ? this.ctf.flag2 : this.ctf.flag1;
      const ownFlag = isMine ? this.ctf.flag1 : this.ctf.flag2;
      const enemyFlagSprite = isMine ? this.flag2Sprite : this.flag1Sprite;
      const ownFlagSprite = isMine ? this.flag1Sprite : this.flag2Sprite;

      if (!enemyFlag.carrier && !char.hasFlag
        && pos.x === enemyFlag.position.x && pos.y === enemyFlag.position.y) {
        enemyFlag.carrier = char.id;
        enemyFlag.isHome = false;
        char.hasFlag = true;
        enemyFlagSprite.setVisible(false);
        const entity = this.characters.get(char.id);
        if (entity) entity.showFlagCarrier(true);
        if (isMine || this.isLocal) this.showAnnouncement('FLAG PICKED UP!', '#ffaa44');
        this.sound_.playFlagPickup();
      }

      if (char.hasFlag && ownFlag.isHome
        && pos.x === ownFlag.homePosition.x && pos.y === ownFlag.homePosition.y) {
        this.scoreCapture(char.owner);
      }

      if (!ownFlag.isHome && !ownFlag.carrier
        && pos.x === ownFlag.position.x && pos.y === ownFlag.position.y) {
        ownFlag.position = { ...ownFlag.homePosition };
        ownFlag.isHome = true;
        this.updateFlagSpritePos(ownFlagSprite, ownFlag.position);
        ownFlagSprite.setVisible(true);
        if (isMine || this.isLocal) this.showAnnouncement('FLAG RETURNED!', '#4488ff');
      }
    });
  }

  private updateSingleFlag(flag: typeof this.ctf.flag1, sprite: Phaser.GameObjects.Container) {
    if (flag.carrier) {
      const carrier = this.charData.get(flag.carrier);
      if (carrier && !carrier.isDead) {
        flag.position = { ...carrier.position };
        sprite.setVisible(false);
      } else {
        flag.carrier = null;
        if (carrier) carrier.hasFlag = false;
        sprite.setVisible(true);
        this.updateFlagSpritePos(sprite, flag.position);
        this.showAnnouncement('FLAG DROPPED!', '#ffaa44');
      }
    }
  }

  private scoreCapture(capturingPlayer: string) {
    if (capturingPlayer === this.playerId) {
      this.ctf.score1++;
    } else {
      this.ctf.score2++;
    }

    this.resetFlags();
    this.cameras.main.flash(500, 108, 99, 255);
    this.sound_.playFlagCapture();
    this.showAnnouncement(
      capturingPlayer === this.playerId ? 'FLAG CAPTURED!' : 'ENEMY CAPTURED!',
      capturingPlayer === this.playerId ? '#44ff88' : '#ff4444'
    );
    this.updateScoreDisplay();

    if (this.ctf.score1 >= this.ctf.capturesNeeded) {
      this.endGame(this.playerId, 'flag_captured');
    } else if (this.ctf.score2 >= this.ctf.capturesNeeded) {
      this.endGame('opponent', 'flag_captured');
    }
  }

  private resetFlags() {
    this.charData.forEach(c => {
      if (c.hasFlag) {
        c.hasFlag = false;
        const entity = this.characters.get(c.id);
        if (entity) entity.showFlagCarrier(false);
      }
    });

    this.ctf.flag1 = {
      position: { ...this.gameMap.flagP1 },
      homePosition: { ...this.gameMap.flagP1 },
      carrier: null, isHome: true,
    };
    this.ctf.flag2 = {
      position: { ...this.gameMap.flagP2 },
      homePosition: { ...this.gameMap.flagP2 },
      carrier: null, isHome: true,
    };

    this.updateFlagSpritePos(this.flag1Sprite, this.ctf.flag1.position);
    this.updateFlagSpritePos(this.flag2Sprite, this.ctf.flag2.position);
    this.flag1Sprite.setVisible(true);
    this.flag2Sprite.setVisible(true);
  }

  private updateFlagSpritePos(sprite: Phaser.GameObjects.Container, pos: Position) {
    sprite.setPosition(pos.x * TILE_SIZE + TILE_SIZE / 2, pos.y * TILE_SIZE + TILE_SIZE / 2);
  }

  // ─── PICKUPS ────────────────────────────────────────────────────

  private spawnPickups() {
    const cx = Math.floor(MAP_WIDTH / 2);
    const cy = Math.floor(MAP_HEIGHT / 2);

    const defs: { type: Pickup['type']; pos: Position }[] = [
      { type: 'health_potion', pos: { x: cx, y: cy - 4 } },
      { type: 'health_potion', pos: { x: cx, y: cy + 4 } },
      { type: 'speed_boost', pos: { x: cx - 8, y: cy } },
      { type: 'speed_boost', pos: { x: cx + 8, y: cy } },
      { type: 'damage_boost', pos: { x: cx - 5, y: cy - 7 } },
      { type: 'damage_boost', pos: { x: cx + 5, y: cy + 7 } },
    ];

    for (let i = 0; i < defs.length; i++) {
      let pos = defs[i].pos;
      // Find nearest passable tile
      if (!isPassable(this.gameMap.tiles[pos.y]?.[pos.x])) {
        for (const [dx, dy] of [[0, 1], [0, -1], [1, 0], [-1, 0], [1, 1], [-1, -1]]) {
          const nx = pos.x + dx;
          const ny = pos.y + dy;
          if (nx >= 0 && nx < MAP_WIDTH && ny >= 0 && ny < MAP_HEIGHT
            && isPassable(this.gameMap.tiles[ny][nx])) {
            pos = { x: nx, y: ny };
            break;
          }
        }
      }

      const px = pos.x * TILE_SIZE + TILE_SIZE / 2;
      const py = pos.y * TILE_SIZE + TILE_SIZE / 2;

      const sprite = this.add.sprite(px, py, `pickup_${defs[i].type}`);
      sprite.setDepth(5);
      sprite.setScale(0.8);
      this.tweens.add({
        targets: sprite,
        scaleX: 0.9, scaleY: 0.9, alpha: 0.7,
        duration: 800, yoyo: true, repeat: -1, ease: 'Sine.easeInOut',
      });

      const labelMap: Record<string, string> = {
        health_potion: 'HP', speed_boost: 'SPD', damage_boost: 'DMG',
      };
      const colorMap: Record<string, string> = {
        health_potion: '#44cc44', speed_boost: '#ffcc00', damage_boost: '#ff4444',
      };

      const label = this.add.text(px, py + 18, labelMap[defs[i].type], {
        fontSize: '7px',
        color: colorMap[defs[i].type],
        fontFamily: 'monospace',
        fontStyle: 'bold',
      }).setOrigin(0.5).setDepth(6);

      this.pickups.push({
        id: `pickup_${i}`,
        type: defs[i].type,
        position: pos,
        active: true,
        respawnTimer: 0,
        sprite,
        label,
      });
    }
  }

  private checkPickupCollisions() {
    this.charData.forEach((char) => {
      if (char.isDead) return;
      for (const pickup of this.pickups) {
        if (!pickup.active) continue;
        if (char.position.x === pickup.position.x && char.position.y === pickup.position.y) {
          this.collectPickup(char, pickup);
        }
      }
    });
  }

  private collectPickup(char: Character, pickup: Pickup) {
    pickup.active = false;
    pickup.respawnTimer = PICKUP_RESPAWN;
    if (pickup.sprite) pickup.sprite.setVisible(false);
    if (pickup.label) pickup.label.setVisible(false);

    const entity = this.characters.get(char.id);

    switch (pickup.type) {
      case 'health_potion': {
        const heal = Math.round(char.stats.hp * 0.35);
        char.currentHp = Math.min(char.stats.hp, char.currentHp + heal);
        if (entity) entity.showHealing(heal);
        this.addCommandLog('System', `${char.name} picked up Health Potion! (+${heal} HP)`, 'pickup');
        break;
      }
      case 'speed_boost':
        char.effects.push({ type: 'speed_boost', duration: 12, value: 2 });
        if (entity) {
          entity.sprite.setTint(0xffff00);
          this.time.delayedCall(12000, () => entity.sprite.clearTint());
        }
        this.addCommandLog('System', `${char.name} picked up Speed Boost! (12s)`, 'pickup');
        break;
      case 'damage_boost':
        char.effects.push({ type: 'damage_boost', duration: 12, value: 1.5 });
        if (entity) {
          entity.sprite.setTint(0xff6600);
          this.time.delayedCall(12000, () => entity.sprite.clearTint());
        }
        this.addCommandLog('System', `${char.name} picked up Damage Boost! (12s)`, 'pickup');
        break;
    }

    this.sound_.playPickupCollect();
    if (entity) entity.refreshVisuals();
    this.updateStatusBar();
  }

  // ─── FOG OF WAR ─────────────────────────────────────────────────

  private initFogOfWar() {
    this.fogLayer = this.add.graphics();
    this.fogLayer.setDepth(50);
    this.updateFogOfWar();
  }

  private updateFogOfWar() {
    this.visibleTiles.clear();

    this.charData.forEach((char) => {
      if (char.owner !== this.playerId || char.isDead) return;
      const vision = char.visionRange ?? BASE_VISION;
      const cx = char.position.x;
      const cy = char.position.y;

      for (let dy = -vision; dy <= vision; dy++) {
        for (let dx = -vision; dx <= vision; dx++) {
          if (dx * dx + dy * dy > vision * vision) continue;
          const tx = cx + dx;
          const ty = cy + dy;
          if (tx < 0 || tx >= MAP_WIDTH || ty < 0 || ty >= MAP_HEIGHT) continue;
          if (this.hasLineOfSight(cx, cy, tx, ty)) {
            this.visibleTiles.add(`${tx},${ty}`);
          }
        }
      }
    });

    this.fogLayer.clear();
    this.fogLayer.fillStyle(0x050510, 0.85);
    for (let y = 0; y < MAP_HEIGHT; y++) {
      for (let x = 0; x < MAP_WIDTH; x++) {
        if (!this.visibleTiles.has(`${x},${y}`)) {
          this.fogLayer.fillRect(x * TILE_SIZE, y * TILE_SIZE, TILE_SIZE, TILE_SIZE);
        }
      }
    }

    this.characters.forEach((entity, id) => {
      const char = this.charData.get(id);
      if (!char || char.owner === this.playerId) return;
      const key = `${char.position.x},${char.position.y}`;
      let visible = this.visibleTiles.has(key);
      // Bush concealment: enemies on bush tiles are invisible unless a friendly is within 1 tile (Manhattan)
      if (visible && this.gameMap.tiles[char.position.y]?.[char.position.x] === 'bush') {
        const friendlyNearby = Array.from(this.charData.values()).some(f =>
          f.owner === this.playerId && !f.isDead &&
          Math.abs(f.position.x - char.position.x) + Math.abs(f.position.y - char.position.y) <= 1
        );
        if (!friendlyNearby) visible = false;
      }
      entity.setFogVisible(visible);
    });

    if (!this.ctf.flag2.carrier) {
      const key = `${this.ctf.flag2.position.x},${this.ctf.flag2.position.y}`;
      this.flag2Sprite.setVisible(this.visibleTiles.has(key));
    }

    // Hide pickups in fog
    for (const pickup of this.pickups) {
      if (!pickup.active) continue;
      const key = `${pickup.position.x},${pickup.position.y}`;
      const visible = this.visibleTiles.has(key);
      if (pickup.sprite) pickup.sprite.setVisible(visible);
      if (pickup.label) pickup.label.setVisible(visible);
    }
  }

  private hasLineOfSight(x1: number, y1: number, x2: number, y2: number): boolean {
    const dx = Math.abs(x2 - x1);
    const dy = Math.abs(y2 - y1);
    const sx = x1 < x2 ? 1 : -1;
    const sy = y1 < y2 ? 1 : -1;
    let err = dx - dy;
    let cx = x1, cy = y1;

    while (cx !== x2 || cy !== y2) {
      const e2 = 2 * err;
      if (e2 > -dy) { err -= dy; cx += sx; }
      if (e2 < dx) { err += dx; cy += sy; }
      if (cx === x2 && cy === y2) break;
      if (cx >= 0 && cx < MAP_WIDTH && cy >= 0 && cy < MAP_HEIGHT) {
        if (this.gameMap.tiles[cy][cx] === 'rock') return false;
      }
    }
    return true;
  }

  // ─── GAME LOOP ──────────────────────────────────────────────────

  private startGameLoop() {
    this.secondTimer = this.time.addEvent({
      delay: 1000,
      callback: () => this.onSecondTick(),
      loop: true,
    });

    this.gameTickTimer = this.time.addEvent({
      delay: TICK_RATE,
      callback: () => this.onGameTick(),
      loop: true,
    });

    this.moveTickTimer = this.time.addEvent({
      delay: MOVE_TICK,
      callback: () => this.onMoveTick(),
      loop: true,
    });
  }

  private onSecondTick() {
    if (this.gameOver) return;

    this.gameTimeRemaining--;
    this.updateTimerDisplay();

    // Respawn timers
    this.charData.forEach((char, id) => {
      if (char.isDead && (char.respawnTimer ?? 0) > 0) {
        char.respawnTimer = (char.respawnTimer ?? 0) - 1;
        const entity = this.characters.get(id);
        if (entity) entity.showRespawning(char.respawnTimer!);
        if (char.respawnTimer! <= 0) this.respawnCharacter(char);
      }
    });

    this.tickCooldowns();

    // Tick pickup respawns
    for (const pickup of this.pickups) {
      if (!pickup.active && pickup.respawnTimer > 0) {
        pickup.respawnTimer--;
        if (pickup.respawnTimer <= 0) {
          pickup.active = true;
          if (pickup.sprite) pickup.sprite.setVisible(true);
          if (pickup.label) pickup.label.setVisible(true);
        }
      }
    }

    if (this.gameTimeRemaining <= 0) {
      const winner = this.ctf.score1 > this.ctf.score2 ? this.playerId
        : this.ctf.score2 > this.ctf.score1 ? 'opponent'
        : this.getHpLeader();
      this.endGame(winner, 'time_up');
    }
  }

  private onGameTick() {
    if (this.gameOver) return;

    this.charData.forEach((char) => {
      if (char.isDead) return;

      // Check stun - skip actions
      if (char.effects.some(e => e.type === 'stun')) {
        const entity = this.characters.get(char.id);
        if (entity) entity.setOrderText('STUNNED');
        return;
      }

      // Pop from order queue if no current order
      if (!char.currentOrder) {
        const queue = this.orderQueues.get(char.id);
        if (queue && queue.length > 0) {
          char.currentOrder = queue.shift()!;
          char.path = [];
          const entity = this.characters.get(char.id);
          if (entity) entity.setOrderText(this.getOrderLabel(char.currentOrder));
        }
      }

      this.executeAutoActions(char);
    });

    this.updateFlagPositions();
    this.checkPickupCollisions();
    this.updateControlPoints();
    this.updateFogOfWar();

    this.characters.forEach((entity, id) => {
      const data = this.charData.get(id);
      if (data) {
        entity.updateFromState(data);
        entity.updateEffectAuras(data.effects);
      }
    });

    this.renderPaths();
    this.updateMiniMap();
    this.updateStatusBar();
    this.updateAbilityPanel();
  }

  private onMoveTick() {
    if (this.gameOver) return;

    this.charData.forEach((char, id) => {
      if (char.isDead) return;
      // Skip movement if stunned
      if (char.effects.some(e => e.type === 'stun')) return;
      // Slow effect: skip every other move tick
      if (char.effects.some(e => e.type === 'slow')) {
        if (Math.random() < 0.5) return; // 50% chance to skip
      }
      // Track tile changes for forest ambush reset
      const tileKey = `${char.position.x},${char.position.y}`;
      const prevTile = this.lastCharTile.get(id);
      if (prevTile && prevTile !== tileKey) {
        this.forestAmbushUsed.delete(id); // Reset ambush on tile change
      }
      this.lastCharTile.set(id, tileKey);

      // Speed boost: double move (move twice per tick)
      const cpBuffs = this.getTeamBuffs(char.owner);
      const hasSpeedBoost = char.effects.some(e => e.type === 'speed_boost') || cpBuffs.speed > 1;

      const entity = this.characters.get(id);
      if (!entity || entity.isMoving) return;

      const doMove = () => {
        if (char.path && char.path.length > 0) {
          const next = char.path.shift()!;
          if (isPassable(this.gameMap.tiles[next.y]?.[next.x])) {
            entity.stepToTile(next.x, next.y);
            char.position = { ...next };
          } else {
            char.path = []; // path invalidated
          }
        } else if (char.currentOrder) {
          this.recalculatePath(char);
        }
      };

      doMove();
      // Speed boost: schedule a second move
      if (hasSpeedBoost && char.path && char.path.length > 0) {
        this.time.delayedCall(MOVE_TICK / 2, () => {
          if (!entity.isMoving && char.path && char.path.length > 0) {
            const next = char.path.shift()!;
            if (isPassable(this.gameMap.tiles[next.y]?.[next.x])) {
              entity.stepToTile(next.x, next.y);
              char.position = { ...next };
            }
          }
        });
      }
    });
  }

  // ─── ORDER EXECUTION ───────────────────────────────────────────

  private recalculatePath(char: Character) {
    const order = char.currentOrder;
    if (!order) return;
    const occupied = this.getOccupiedPositions(char.id);

    switch (order.type) {
      case 'move':
      case 'capture': {
        if (!order.targetPosition) return;
        if (this.tileDist(char.position, order.targetPosition) <= 1) {
          char.currentOrder = null;
          return;
        }
        char.path = findPath(this.gameMap.tiles, char.position, order.targetPosition,
          char.stats.speed + 2, occupied);
        break;
      }
      case 'attack': {
        if (!order.targetCharacterId) return;
        const target = this.charData.get(order.targetCharacterId);
        if (!target || target.isDead) {
          // Auto-retarget nearest enemy
          const enemies = Array.from(this.charData.values())
            .filter(c => c.owner !== char.owner && !c.isDead);
          if (enemies.length > 0) {
            const nearest = this.findNearest(char.position, enemies);
            order.targetCharacterId = nearest.id;
          } else {
            char.currentOrder = null;
          }
          return;
        }
        if (this.tileDist(char.position, target.position) > char.stats.range) {
          char.path = findPath(this.gameMap.tiles, char.position, target.position,
            char.stats.speed + 2, occupied);
        }
        break;
      }
      case 'ability': {
        if (!order.targetCharacterId || !order.abilityId) return;
        const target = this.charData.get(order.targetCharacterId);
        if (!target || target.isDead) { char.currentOrder = null; return; }
        const cls = CLASSES[char.classId];
        const ability = cls.abilities.find(a => a.id === order.abilityId);
        if (!ability) { char.currentOrder = null; return; }
        if (this.tileDist(char.position, target.position) > ability.range) {
          char.path = findPath(this.gameMap.tiles, char.position, target.position,
            char.stats.speed + 2, occupied);
        }
        break;
      }
      case 'retreat': {
        const spawn = char.owner === this.playerId
          ? this.gameMap.spawnP1[0] : this.gameMap.spawnP2[0];
        if (this.tileDist(char.position, spawn) <= 1) { char.currentOrder = null; return; }
        char.path = findPath(this.gameMap.tiles, char.position, spawn,
          char.stats.speed + 2, occupied);
        break;
      }
      case 'escort': {
        if (!order.targetCharacterId) return;
        const carrier = this.charData.get(order.targetCharacterId);
        if (!carrier || carrier.isDead) { char.currentOrder = null; return; }
        if (this.tileDist(char.position, carrier.position) > 2) {
          char.path = findPath(this.gameMap.tiles, char.position, carrier.position,
            char.stats.speed + 2, occupied);
        }
        break;
      }
      case 'control': {
        if (!order.targetPosition) return;
        if (this.tileDist(char.position, order.targetPosition) <= 1) {
          // At the point - hold position (defend)
          return;
        }
        char.path = findPath(this.gameMap.tiles, char.position, order.targetPosition,
          char.stats.speed + 2, occupied);
        break;
      }
    }
  }

  private getEffectiveRange(char: Character): number {
    let range = char.stats.range;
    // Hill range bonus: ranged units on hills get +1 range
    if (range >= 2 && this.gameMap.tiles[char.position.y]?.[char.position.x] === 'hill') {
      range += 1;
    }
    return range;
  }

  private isConcealed(char: Character): boolean {
    const tile = this.gameMap.tiles[char.position.y]?.[char.position.x];
    if (tile !== 'bush') return false;
    // Concealed unless an enemy is within 1 tile
    return !Array.from(this.charData.values()).some(e =>
      e.owner !== char.owner && !e.isDead &&
      Math.abs(e.position.x - char.position.x) + Math.abs(e.position.y - char.position.y) <= 1
    );
  }

  private executeAutoActions(char: Character) {
    if (char.isDead) return;
    // Stunned characters can't act
    if (char.effects.some(e => e.type === 'stun')) return;

    const enemies = Array.from(this.charData.values())
      .filter(c => c.owner !== char.owner && !c.isDead);

    // Execute ability order if in range
    if (char.currentOrder?.type === 'ability' && char.currentOrder.abilityId) {
      const target = char.currentOrder.targetCharacterId
        ? this.charData.get(char.currentOrder.targetCharacterId) : null;
      if (target && !target.isDead) {
        const cls = CLASSES[char.classId];
        const ability = cls.abilities.find(a => a.id === char.currentOrder!.abilityId);
        if (ability && this.tileDist(char.position, target.position) <= ability.range) {
          this.resolveAbility(char, ability.id, target.id);
          char.currentOrder = null; // ability is one-shot
          const entity = this.characters.get(char.id);
          if (entity) entity.setOrderText('idle');
          return;
        }
      }
    }

    const effectiveRange = this.getEffectiveRange(char);

    // Prioritize ordered attack target
    if (char.currentOrder?.type === 'attack' && char.currentOrder.targetCharacterId) {
      const target = this.charData.get(char.currentOrder.targetCharacterId);
      if (target && !target.isDead && !this.isConcealed(target)
        && this.tileDist(char.position, target.position) <= effectiveRange) {
        this.resolveAutoAttack(char, target);
        return;
      }
    }

    // Auto-attack nearest enemy in range (skip concealed)
    for (const enemy of enemies) {
      if (this.isConcealed(enemy)) continue;
      if (this.tileDist(char.position, enemy.position) <= effectiveRange) {
        this.resolveAutoAttack(char, enemy);
        break;
      }
    }
  }

  private resolveAutoAttack(attacker: Character, target: Character) {
    const targetEntity = this.characters.get(target.id);
    if (!targetEntity) return;

    let baseDamage = attacker.stats.attack;

    // Damage boost effect
    if (attacker.effects.some(e => e.type === 'damage_boost')) {
      baseDamage = Math.round(baseDamage * 1.5);
    }

    let defense = target.stats.defense;
    // Defense debuff on target
    const defDebuff = target.effects.find(e => e.type === 'defense_debuff');
    if (defDebuff) {
      defense = Math.round(defense * 0.6); // 40% reduction
    }

    let damage = Math.max(1, Math.round(baseDamage * (100 / (100 + defense))));

    // Terrain modifiers
    const attackerTile = this.gameMap.tiles[attacker.position.y]?.[attacker.position.x];
    const defenderTile = this.gameMap.tiles[target.position.y]?.[target.position.x];
    if (attackerTile === 'hill') damage = Math.round(damage * 1.25);
    if (defenderTile === 'forest') damage = Math.round(damage * 0.85);
    if (defenderTile === 'bush') damage = Math.round(damage * 0.9);

    // Forest ambush: first attack from forest = +30% damage
    if (attackerTile === 'forest' && !this.forestAmbushUsed.has(attacker.id)) {
      damage = Math.round(damage * 1.3);
      this.forestAmbushUsed.add(attacker.id);
    }

    // Control point buffs
    const attackerBuffs = this.getTeamBuffs(attacker.owner);
    const defenderBuffs = this.getTeamBuffs(target.owner);
    if (attackerBuffs.damage > 1) damage = Math.round(damage * attackerBuffs.damage);
    if (defenderBuffs.defense > 1) damage = Math.max(1, Math.round(damage / defenderBuffs.defense));

    target.currentHp = Math.max(0, target.currentHp - damage);

    if (targetEntity.fogVisible || target.owner === this.playerId) {
      targetEntity.showDamage(damage);
    }

    this.showAttackVFX(attacker, target);
    this.sound_.playAttackHit();

    if (target.currentHp <= 0) {
      this.killCharacter(target);
      this.sound_.playKill();
    }
  }

  private killCharacter(char: Character) {
    char.isDead = true;
    char.respawnTimer = RESPAWN_TIME;
    char.path = [];
    char.currentOrder = null;
    // Clear order queue
    const queue = this.orderQueues.get(char.id);
    if (queue) queue.length = 0;

    if (char.hasFlag) {
      char.hasFlag = false;
      const entity = this.characters.get(char.id);
      if (entity) entity.showFlagCarrier(false);

      if (this.ctf.flag1.carrier === char.id) {
        this.ctf.flag1.carrier = null;
        this.ctf.flag1.position = { ...char.position };
        this.ctf.flag1.isHome = false;
        this.updateFlagSpritePos(this.flag1Sprite, this.ctf.flag1.position);
        this.flag1Sprite.setVisible(true);
      }
      if (this.ctf.flag2.carrier === char.id) {
        this.ctf.flag2.carrier = null;
        this.ctf.flag2.position = { ...char.position };
        this.ctf.flag2.isHome = false;
        this.updateFlagSpritePos(this.flag2Sprite, this.ctf.flag2.position);
        this.flag2Sprite.setVisible(true);
      }
      this.showAnnouncement('FLAG DROPPED!', '#ffaa44');
    }

    const entity = this.characters.get(char.id);
    if (entity) entity.showRespawning(char.respawnTimer!);
  }

  private respawnCharacter(char: Character) {
    char.isDead = false;
    char.currentHp = char.stats.hp;
    char.respawnTimer = 0;
    char.effects = [];
    char.cooldowns = {};

    const spawns = char.owner === this.playerId ? this.gameMap.spawnP1 : this.gameMap.spawnP2;
    char.position = { ...spawns[Math.floor(Math.random() * spawns.length)] };

    const entity = this.characters.get(char.id);
    if (entity) {
      entity.hideRespawn();
      entity.snapToPosition();
      entity.refreshVisuals();
    }
  }

  // ─── ABILITY RESOLUTION ─────────────────────────────────────────

  private resolveAbility(char: Character, abilityId: string, targetId?: string) {
    const cls = CLASSES[char.classId];
    const ability = cls.abilities.find(a => a.id === abilityId);
    if (!ability) return;

    const cd = char.cooldowns[ability.id] || 0;
    if (cd > 0) return;
    char.cooldowns[ability.id] = ability.cooldown;

    const casterEntity = this.characters.get(char.id);

    // Visual: flash caster blue
    if (casterEntity) {
      casterEntity.sprite.setTint(0x6666ff);
      this.time.delayedCall(300, () => casterEntity.sprite.clearTint());
    }

    this.sound_.playAbilityCast();

    // Damage
    if (ability.damage && targetId) {
      const target = this.charData.get(targetId);
      if (target && !target.isDead) {
        const targetEntity = this.characters.get(targetId);
        let damage = ability.damage + Math.round(char.stats.magic * 0.5);
        // Damage boost
        if (char.effects.some(e => e.type === 'damage_boost')) {
          damage = Math.round(damage * 1.5);
        }
        // Water fire penalty: fireball does -20% if target is adjacent to water
        if (abilityId.includes('fireball') || abilityId.includes('fire')) {
          const tx = target.position.x;
          const ty = target.position.y;
          const adjWater = [[0,1],[0,-1],[1,0],[-1,0]].some(([dx,dy]) => {
            const nx = tx+dx, ny = ty+dy;
            return nx >= 0 && nx < MAP_WIDTH && ny >= 0 && ny < MAP_HEIGHT
              && this.gameMap.tiles[ny][nx] === 'water';
          });
          if (adjWater) damage = Math.round(damage * 0.8);
        }
        // Control point damage buff
        const atkBuffs = this.getTeamBuffs(char.owner);
        if (atkBuffs.damage > 1) damage = Math.round(damage * atkBuffs.damage);

        target.currentHp = Math.max(0, target.currentHp - damage);
        if (targetEntity) targetEntity.showDamage(damage);
        this.showAbilityVFX(char, target, abilityId);
        if (target.currentHp <= 0) {
          this.killCharacter(target);
          this.sound_.playKill();
        }

        // Apply ability effects to target
        if (ability.effect) {
          this.applyAbilityEffect(target, ability.effect);
        }
      }
    }

    // Healing
    if (ability.healing) {
      const heal = ability.healing + Math.round(char.stats.magic * 0.3);
      if (ability.damage) {
        // Self-heal (Drain Life, Divine Smite)
        char.currentHp = Math.min(char.stats.hp, char.currentHp + heal);
        if (casterEntity) casterEntity.showHealing(heal);
      } else if (targetId) {
        // Heal target (Healing Light)
        const target = this.charData.get(targetId);
        if (target && !target.isDead) {
          const targetEntity = this.characters.get(targetId);
          target.currentHp = Math.min(target.stats.hp, target.currentHp + heal);
          if (targetEntity) targetEntity.showHealing(heal);
        }
      }
    }

    // Non-damage abilities with effects (rare but handle it)
    if (!ability.damage && ability.effect && targetId) {
      const target = this.charData.get(targetId);
      if (target) this.applyAbilityEffect(target, ability.effect);
    }
  }

  private applyAbilityEffect(target: Character, effect: any) {
    switch (effect.type) {
      case 'stun':
        target.effects.push({ type: 'stun', duration: effect.duration, value: 1 });
        this.showAnnouncement(`${target.name} STUNNED!`, '#ffaa44');
        break;
      case 'slow':
        target.effects.push({ type: 'slow', duration: effect.duration, value: effect.factor || 0.5 });
        break;
      case 'debuff':
        target.effects.push({ type: 'defense_debuff', duration: effect.duration, value: effect.amount || 5 });
        break;
    }
  }

  // ─── COMMAND HANDLING ──────────────────────────────────────────

  private async handleCommand(rawText: string) {
    if (this.gameOver) return;

    const now = Date.now();
    if (now - this.lastCommandTime < COMMAND_COOLDOWN) {
      const remaining = Math.ceil((COMMAND_COOLDOWN - (now - this.lastCommandTime)) / 1000);
      this.addCommandLog('System', `Cooldown: ${remaining}s remaining`, 'cooldown');
      return;
    }
    this.lastCommandTime = now;
    this.commandCooldownRemaining = COMMAND_COOLDOWN;

    this.addCommandLog('You', rawText, 'processing');

    try {
      if (this.hasGemini) {
        const result = await parseCommandWithGemini(
          rawText, this.charData, this.playerId, MAP_WIDTH, MAP_HEIGHT, this.ctf,
          this.controlPoints, this.gameMap.tiles,
        );
        this.applyParsedOrders(result);
        this.updateCommandLogResult(result.narration || 'Orders issued!');
      } else {
        this.parseCommandLocally(rawText);
        this.updateCommandLogResult('Orders issued!');
      }
    } catch (err) {
      console.error('Command error:', err);
      try {
        this.parseCommandLocally(rawText);
        this.updateCommandLogResult(this.hasGemini ? '(AI unavailable, used local parser)' : 'Orders issued!');
      } catch {
        this.updateCommandLogResult('Error: ' + (err as Error).message);
      }
    }

    this.updateCooldownDisplay();
  }

  private applyParsedOrders(result: GeminiParseResult) {
    const seenChars = new Set<string>();

    for (const action of result.actions) {
      const char = this.charData.get(action.characterId);
      if (!char || char.isDead || char.owner !== this.playerId) continue;

      const order: CharacterOrder = {
        type: action.type as CharacterOrder['type'],
        targetPosition: action.targetPosition,
        targetCharacterId: action.targetCharacterId,
        abilityId: action.abilityId,
      };

      // Queue if this char already got a primary order or if explicitly queued
      const isQueued = action.queued || seenChars.has(action.characterId);
      seenChars.add(action.characterId);

      if (isQueued) {
        const queue = this.orderQueues.get(char.id);
        if (queue && queue.length < 3) queue.push(order);
      } else {
        char.currentOrder = order;
        char.path = [];
        // Clear old queue
        const queue = this.orderQueues.get(char.id);
        if (queue) queue.length = 0;

        if (action.type === 'ability' && action.abilityId) {
          // Don't resolve immediately - let the game tick handle range check
        }

        const entity = this.characters.get(char.id);
        if (entity) {
          const queueLen = this.orderQueues.get(char.id)?.length || 0;
          const label = this.getOrderLabel(order) + (queueLen > 0 ? ` (+${queueLen})` : '');
          entity.setOrderText(label);
        }
      }
    }
  }

  private getOrderLabel(order: CharacterOrder): string {
    switch (order.type) {
      case 'move': return 'MOVE';
      case 'attack': {
        const t = order.targetCharacterId ? this.charData.get(order.targetCharacterId) : null;
        return t ? `ATK ${t.name.split(' ')[0]}` : 'ATK';
      }
      case 'ability': {
        if (order.abilityId) {
          // Find ability name from any class
          for (const cls of Object.values(CLASSES)) {
            const a = cls.abilities.find(ab => ab.id === order.abilityId);
            if (a) return a.name;
          }
        }
        return 'ABL';
      }
      case 'capture': return 'CAPTURE';
      case 'defend': return 'DEFEND';
      case 'retreat': return 'RETREAT';
      case 'escort': return 'ESCORT';
      case 'patrol': return 'PATROL';
      case 'control': return 'CONTROL';
      default: return '';
    }
  }

  // ─── LOCAL PARSER ───────────────────────────────────────────────

  private parseCommandLocally(rawText: string) {
    // Split on "then" for command queuing
    const parts = rawText.split(/\s+then\s+/i);

    for (let partIdx = 0; partIdx < parts.length; partIdx++) {
      const isQueued = partIdx > 0;
      this.parseCommandPart(parts[partIdx], isQueued);
    }
  }

  private parseCommandPart(rawText: string, queued: boolean) {
    const text = rawText.toLowerCase();
    const myChars = Array.from(this.charData.values())
      .filter(c => c.owner === this.playerId && !c.isDead);
    const enemyChars = Array.from(this.charData.values())
      .filter(c => c.owner !== this.playerId && !c.isDead);

    if (myChars.length === 0) return;

    let targetChars = myChars;
    for (const char of myChars) {
      const cls = CLASSES[char.classId];
      const animal = ANIMALS[char.animalId];
      if (text.includes(cls.name.toLowerCase()) || text.includes(animal.name.toLowerCase())
          || text.includes(char.name.toLowerCase())) {
        targetChars = [char];
        break;
      }
    }
    if (text.includes('all') || text.includes('everyone')) {
      targetChars = myChars;
    }

    const setOrder = (char: Character, order: CharacterOrder) => {
      if (queued) {
        const queue = this.orderQueues.get(char.id);
        if (queue && queue.length < 3) queue.push(order);
      } else {
        char.currentOrder = order;
        char.path = [];
        const q = this.orderQueues.get(char.id);
        if (q) q.length = 0;
      }
    };

    // Control point commands
    if (text.includes('control point') || text.includes('take the point') || text.includes('capture point')) {
      // Find nearest uncaptured point
      const unowned = this.controlPoints
        .filter(cp => cp.owner !== 'player1')
        .sort((a, b) => this.tileDist(targetChars[0].position, a.position) - this.tileDist(targetChars[0].position, b.position));
      const targetCP = unowned[0] || this.controlPoints[1]; // default center
      for (const char of targetChars) {
        setOrder(char, { type: 'control', targetPosition: targetCP.position });
      }
      for (const char of targetChars) {
        const entity = this.characters.get(char.id);
        if (entity && char.currentOrder) entity.setOrderText(this.getOrderLabel(char.currentOrder));
      }
      return;
    }

    // CTF commands
    if (text.includes('flag') || text.includes('capture') || text.includes('grab')) {
      for (const char of targetChars) {
        setOrder(char, { type: 'capture', targetPosition: this.ctf.flag2.position });
      }
    } else if (text.includes('escort') || text.includes('guard carrier')) {
      const carrier = myChars.find(c => c.hasFlag);
      if (carrier) {
        for (const char of targetChars) {
          if (char.id !== carrier.id) {
            setOrder(char, { type: 'escort', targetCharacterId: carrier.id });
          }
        }
      }
    } else if (text.includes('return') && text.includes('flag')) {
      for (const char of targetChars) {
        setOrder(char, { type: 'move', targetPosition: this.ctf.flag1.homePosition });
      }
    } else if (text.includes('attack') || text.includes('hit') || text.includes('strike')
      || text.includes('kill') || text.includes('fight')) {
      let target = enemyChars[0];
      for (const enemy of enemyChars) {
        if (text.includes(CLASSES[enemy.classId].name.toLowerCase())
          || text.includes(ANIMALS[enemy.animalId].name.toLowerCase())
          || text.includes(enemy.name.toLowerCase())) {
          target = enemy; break;
        }
      }
      if (text.includes('nearest') || text.includes('closest')) {
        target = this.findNearest(targetChars[0].position, enemyChars);
      }
      for (const char of targetChars) {
        if (target) {
          setOrder(char, { type: 'attack', targetCharacterId: target.id });
        }
      }
    } else if (text.includes('ability') || text.includes('skill') || text.includes('spell')
      || text.includes('cast') || text.includes('use')) {
      for (const char of targetChars) {
        const cls = CLASSES[char.classId];
        let abilityToUse = cls.abilities[0];
        for (const ability of cls.abilities) {
          if (text.includes(ability.name.toLowerCase()) || text.includes(ability.id.replace(/_/g, ' '))) {
            abilityToUse = ability; break;
          }
        }
        if (abilityToUse) {
          const target = (abilityToUse.healing && !abilityToUse.damage)
            ? myChars.reduce((a, b) => a.currentHp / a.stats.hp < b.currentHp / b.stats.hp ? a : b)
            : enemyChars.length > 0 ? this.findNearest(char.position, enemyChars) : undefined;
          if (target) {
            setOrder(char, { type: 'ability', targetCharacterId: target.id, abilityId: abilityToUse.id });
          }
        }
      }
    } else if (text.includes('heal') || text.includes('restore') || text.includes('cure')) {
      const weakest = myChars.reduce((a, b) => a.currentHp / a.stats.hp < b.currentHp / b.stats.hp ? a : b);
      for (const char of targetChars) {
        const healAbility = CLASSES[char.classId].abilities.find(a => a.healing && !a.damage);
        if (healAbility) {
          setOrder(char, { type: 'ability', targetCharacterId: weakest.id, abilityId: healAbility.id });
        }
      }
    } else if (text.includes('move') || text.includes('go') || text.includes('walk')
      || text.includes('run') || text.includes('advance') || text.includes('forward')) {
      for (const char of targetChars) {
        let targetPos: Position;
        if (text.includes('center') || text.includes('middle')) {
          targetPos = { x: Math.floor(MAP_WIDTH / 2), y: Math.floor(MAP_HEIGHT / 2) };
        } else if (text.includes('up') || text.includes('north')) {
          targetPos = { x: char.position.x, y: Math.max(0, char.position.y - 8) };
        } else if (text.includes('down') || text.includes('south')) {
          targetPos = { x: char.position.x, y: Math.min(MAP_HEIGHT - 1, char.position.y + 8) };
        } else if (text.includes('left') || text.includes('west')) {
          targetPos = { x: Math.max(0, char.position.x - 8), y: char.position.y };
        } else if (text.includes('right') || text.includes('east')) {
          targetPos = { x: Math.min(MAP_WIDTH - 1, char.position.x + 8), y: char.position.y };
        } else if (text.includes('enemy') || text.includes('opponent')) {
          const nearest = this.findNearest(char.position, enemyChars);
          targetPos = nearest.position;
        } else {
          const dir = char.position.x < MAP_WIDTH / 2 ? 1 : -1;
          targetPos = { x: char.position.x + dir * 8, y: char.position.y };
        }
        setOrder(char, { type: 'move', targetPosition: targetPos });
      }
    } else if (text.includes('defend') || text.includes('guard') || text.includes('hold')) {
      for (const char of targetChars) {
        setOrder(char, { type: 'defend' });
      }
    } else if (text.includes('retreat') || text.includes('back') || text.includes('base')) {
      for (const char of targetChars) {
        setOrder(char, { type: 'retreat' });
      }
    } else {
      // Default: move toward enemy flag
      for (const char of targetChars) {
        setOrder(char, { type: 'move', targetPosition: this.ctf.flag2.position });
      }
    }

    // Update labels
    for (const char of targetChars) {
      const entity = this.characters.get(char.id);
      if (entity && char.currentOrder) {
        const queueLen = this.orderQueues.get(char.id)?.length || 0;
        const label = this.getOrderLabel(char.currentOrder) + (queueLen > 0 ? ` (+${queueLen})` : '');
        entity.setOrderText(label);
      }
    }
  }

  // ─── CONTROL POINTS ────────────────────────────────────────────

  private initControlPoints() {
    const positions = this.gameMap.controlPointPositions;
    const buffs = [
      { type: 'speed' as const, value: 1.1, label: '+10% Speed' },
      { type: 'damage' as const, value: 1.15, label: '+15% Damage' },
      { type: 'defense' as const, value: 1.1, label: '+10% Defense' },
    ];

    for (let i = 0; i < positions.length; i++) {
      const cp: ControlPoint = {
        id: `cp_${i}`,
        position: positions[i],
        owner: null,
        captureProgress: 0,
        capturingTeam: null,
        buff: buffs[i],
      };
      this.controlPoints.push(cp);

      // Visual: pulsing circle
      const px = positions[i].x * TILE_SIZE + TILE_SIZE / 2;
      const py = positions[i].y * TILE_SIZE + TILE_SIZE / 2;
      const container = this.add.container(px, py);

      const ring = this.add.graphics();
      ring.lineStyle(2, 0xffffff, 0.5);
      ring.strokeCircle(0, 0, 14);
      container.add(ring);

      const fill = this.add.graphics();
      fill.setData('fill', fill);
      container.add(fill);

      const label = this.add.text(0, 18, cp.buff.label, {
        fontSize: '7px', color: '#ccc', fontFamily: 'monospace',
      }).setOrigin(0.5);
      container.add(label);

      container.setDepth(7);
      container.setData('ring', ring);
      container.setData('fillGfx', fill);

      this.tweens.add({
        targets: ring,
        alpha: { from: 0.3, to: 0.7 },
        duration: 1200,
        yoyo: true,
        repeat: -1,
      });

      this.cpSprites.set(cp.id, container);
    }
  }

  private updateControlPoints() {
    for (const cp of this.controlPoints) {
      const nearby: Record<string, number> = { player1: 0, player2: 0 };
      this.charData.forEach(char => {
        if (char.isDead) return;
        if (this.tileDist(char.position, cp.position) <= 2) {
          const team = char.owner === this.playerId ? 'player1' : 'player2';
          nearby[team]++;
        }
      });

      const p1 = nearby.player1;
      const p2 = nearby.player2;

      if (p1 > 0 && p2 > 0) {
        // Contested - no progress
      } else if (p1 > 0) {
        if (cp.owner === 'player1') {
          // Already owned, maintain
        } else {
          cp.capturingTeam = 'player1';
          cp.captureProgress = Math.min(100, cp.captureProgress + 10);
          if (cp.captureProgress >= 100) {
            cp.owner = 'player1';
            cp.captureProgress = 100;
            this.sound_.playControlCapture();
            this.showAnnouncement(`POINT CAPTURED: ${cp.buff.label}`, '#4488ff');
          }
        }
      } else if (p2 > 0) {
        if (cp.owner === 'player2') {
          // Already owned, maintain
        } else {
          cp.capturingTeam = 'player2';
          cp.captureProgress = Math.min(100, cp.captureProgress + 10);
          if (cp.captureProgress >= 100) {
            cp.owner = 'player2';
            cp.captureProgress = 100;
            this.sound_.playControlCapture();
            this.showAnnouncement(`ENEMY CAPTURED POINT: ${cp.buff.label}`, '#ff4444');
          }
        }
      } else {
        // Empty - decay
        if (cp.captureProgress > 0 && !cp.owner) {
          cp.captureProgress = Math.max(0, cp.captureProgress - 5);
          if (cp.captureProgress === 0) cp.capturingTeam = null;
        }
      }

      // Update visual
      const container = this.cpSprites.get(cp.id);
      if (container) {
        const fillGfx = container.getData('fillGfx') as Phaser.GameObjects.Graphics;
        fillGfx.clear();
        if (cp.captureProgress > 0) {
          const color = cp.capturingTeam === 'player1' ? 0x4444ff :
            cp.capturingTeam === 'player2' ? 0xff4444 : 0xffffff;
          const alpha = 0.1 + (cp.captureProgress / 100) * 0.4;
          fillGfx.fillStyle(color, alpha);
          fillGfx.fillCircle(0, 0, 12 * (cp.captureProgress / 100));
        }
        if (cp.owner) {
          const ring = container.getData('ring') as Phaser.GameObjects.Graphics;
          ring.clear();
          const ownerColor = cp.owner === 'player1' ? 0x4444ff : 0xff4444;
          ring.lineStyle(2, ownerColor, 0.8);
          ring.strokeCircle(0, 0, 14);
        }
      }
    }
  }

  private getTeamBuffs(owner: string): { speed: number; damage: number; defense: number } {
    const team = owner === this.playerId ? 'player1' : 'player2';
    const buffs = { speed: 1, damage: 1, defense: 1 };
    for (const cp of this.controlPoints) {
      if (cp.owner === team) {
        if (cp.buff.type === 'speed') buffs.speed *= cp.buff.value;
        if (cp.buff.type === 'damage') buffs.damage *= cp.buff.value;
        if (cp.buff.type === 'defense') buffs.defense *= cp.buff.value;
      }
    }
    return buffs;
  }

  // ─── VFX ──────────────────────────────────────────────────────────

  private showAttackVFX(attacker: Character, target: Character) {
    const atkEntity = this.characters.get(attacker.id);
    const tgtEntity = this.characters.get(target.id);
    if (!atkEntity || !tgtEntity) return;
    if (!tgtEntity.fogVisible && target.owner !== this.playerId) return;

    if (attacker.stats.range >= 2) {
      // Ranged: projectile dot
      const dot = this.add.circle(atkEntity.sprite.x, atkEntity.sprite.y, 3, 0xffaa44).setDepth(20);
      this.tweens.add({
        targets: dot,
        x: tgtEntity.sprite.x, y: tgtEntity.sprite.y,
        duration: 200,
        onComplete: () => dot.destroy(),
      });
    } else {
      // Melee: impact flash
      const flash = this.add.circle(tgtEntity.sprite.x, tgtEntity.sprite.y, 8, 0xffffff, 0.6).setDepth(20);
      this.tweens.add({
        targets: flash,
        alpha: 0, scaleX: 1.5, scaleY: 1.5,
        duration: 200,
        onComplete: () => flash.destroy(),
      });
    }
  }

  private showAbilityVFX(caster: Character, target: Character, abilityId: string) {
    const casterEntity = this.characters.get(caster.id);
    const tgtEntity = this.characters.get(target.id);
    if (!casterEntity || !tgtEntity) return;

    if (abilityId.includes('fireball') || abilityId.includes('fire')) {
      // Fireball projectile
      const proj = this.add.circle(casterEntity.sprite.x, casterEntity.sprite.y, 5, 0xff6600).setDepth(20);
      this.tweens.add({
        targets: proj,
        x: tgtEntity.sprite.x, y: tgtEntity.sprite.y,
        duration: 300,
        onComplete: () => {
          // Explosion
          const exp = this.add.circle(tgtEntity.sprite.x, tgtEntity.sprite.y, 4, 0xff4400, 0.8).setDepth(20);
          this.tweens.add({
            targets: exp,
            scaleX: 3, scaleY: 3, alpha: 0,
            duration: 300,
            onComplete: () => exp.destroy(),
          });
          proj.destroy();
        },
      });
    } else if (abilityId.includes('heal')) {
      // Heal particles
      for (let i = 0; i < 5; i++) {
        const p = this.add.circle(
          tgtEntity.sprite.x + (Math.random() - 0.5) * 20,
          tgtEntity.sprite.y + 10,
          3, 0x44ff88, 0.8
        ).setDepth(20);
        this.tweens.add({
          targets: p,
          y: p.y - 25 - Math.random() * 15,
          alpha: 0,
          duration: 600 + Math.random() * 200,
          delay: i * 60,
          onComplete: () => p.destroy(),
        });
      }
    } else if (abilityId.includes('stun') || abilityId.includes('smite')) {
      // Stun flash
      const flash = this.add.circle(tgtEntity.sprite.x, tgtEntity.sprite.y, 16, 0xffff00, 0.6).setDepth(20);
      this.tweens.add({
        targets: flash,
        alpha: 0, scaleX: 2, scaleY: 2,
        duration: 300,
        onComplete: () => flash.destroy(),
      });
    } else if (abilityId.includes('drain')) {
      // Drain arc
      const arc = this.add.graphics().setDepth(20);
      arc.lineStyle(2, 0xaa44ff, 0.8);
      arc.lineBetween(tgtEntity.sprite.x, tgtEntity.sprite.y, casterEntity.sprite.x, casterEntity.sprite.y);
      this.tweens.add({
        targets: arc,
        alpha: 0,
        duration: 400,
        onComplete: () => arc.destroy(),
      });
    } else {
      // Generic: projectile
      const proj = this.add.circle(casterEntity.sprite.x, casterEntity.sprite.y, 4, 0x8888ff).setDepth(20);
      this.tweens.add({
        targets: proj,
        x: tgtEntity.sprite.x, y: tgtEntity.sprite.y,
        duration: 250,
        onComplete: () => proj.destroy(),
      });
    }
  }

  // ─── PATH VISUALIZATION ───────────────────────────────────────────

  private renderPaths() {
    this.pathGraphics.clear();
    this.charData.forEach((char) => {
      if (char.owner !== this.playerId || char.isDead) return;
      if (!char.path || char.path.length === 0) return;

      this.pathGraphics.lineStyle(1.5, 0x44ff88, 0.3);
      const sx = char.position.x * TILE_SIZE + TILE_SIZE / 2;
      const sy = char.position.y * TILE_SIZE + TILE_SIZE / 2;
      this.pathGraphics.beginPath();
      this.pathGraphics.moveTo(sx, sy);
      for (const p of char.path) {
        this.pathGraphics.lineTo(p.x * TILE_SIZE + TILE_SIZE / 2, p.y * TILE_SIZE + TILE_SIZE / 2);
      }
      this.pathGraphics.strokePath();

      // Destination dot
      const last = char.path[char.path.length - 1];
      this.pathGraphics.fillStyle(0x44ff88, 0.5);
      this.pathGraphics.fillCircle(last.x * TILE_SIZE + TILE_SIZE / 2, last.y * TILE_SIZE + TILE_SIZE / 2, 4);
    });
  }

  // ─── MINI-MAP ─────────────────────────────────────────────────────

  private updateMiniMap() {
    const friendly = Array.from(this.charData.values())
      .filter(c => c.owner === this.playerId && !c.isDead);
    const enemies = Array.from(this.charData.values())
      .filter(c => c.owner !== this.playerId && !c.isDead)
      .map(c => ({
        position: c.position,
        visible: this.characters.get(c.id)?.fogVisible ?? false,
      }));

    this.miniMap.update(
      this.gameMap.tiles,
      this.visibleTiles,
      friendly,
      enemies,
      { pos1: this.ctf.flag1.position, pos2: this.ctf.flag2.position },
      this.controlPoints,
      this.cameras.main,
    );
  }

  // ─── UTILITIES ──────────────────────────────────────────────────

  private findNearest(from: Position, targets: Character[]): Character {
    let nearest = targets[0];
    let minDist = Infinity;
    for (const t of targets) {
      const dist = this.tileDist(from, t.position);
      if (dist < minDist) { minDist = dist; nearest = t; }
    }
    return nearest;
  }

  private tileDist(a: Position, b: Position): number {
    return Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
  }

  private getOccupiedPositions(excludeId?: string): Set<string> {
    const occupied = new Set<string>();
    this.charData.forEach((c) => {
      if (!c.isDead && c.id !== excludeId) occupied.add(`${c.position.x},${c.position.y}`);
    });
    return occupied;
  }

  private tickCooldowns() {
    this.charData.forEach(char => {
      for (const id of Object.keys(char.cooldowns)) {
        if (char.cooldowns[id] > 0) char.cooldowns[id]--;
      }
      char.effects = char.effects.filter(e => { e.duration--; return e.duration > 0; });
    });
  }

  private getHpLeader(): string {
    let myHp = 0, oppHp = 0;
    this.charData.forEach(c => {
      if (c.owner === this.playerId) myHp += c.currentHp;
      else oppHp += c.currentHp;
    });
    return myHp >= oppHp ? this.playerId : 'opponent';
  }

  // ─── CAMERA ─────────────────────────────────────────────────────

  private setupCameraControls() {
    const cursors = this.input.keyboard!.createCursorKeys();
    const wasd = {
      up: this.input.keyboard!.addKey('W'),
      down: this.input.keyboard!.addKey('S'),
      left: this.input.keyboard!.addKey('A'),
      right: this.input.keyboard!.addKey('D'),
    };

    this.events.on('update', () => {
      const cam = this.cameras.main;
      const speed = 5;
      if (cursors.left.isDown || wasd.left.isDown) cam.scrollX -= speed;
      if (cursors.right.isDown || wasd.right.isDown) cam.scrollX += speed;
      if (cursors.up.isDown || wasd.up.isDown) cam.scrollY -= speed;
      if (cursors.down.isDown || wasd.down.isDown) cam.scrollY += speed;
    });

    let dragStartX = 0, dragStartY = 0;
    this.input.on('pointerdown', (p: Phaser.Input.Pointer) => {
      if (p.rightButtonDown()) { dragStartX = p.x; dragStartY = p.y; }
    });
    this.input.on('pointermove', (p: Phaser.Input.Pointer) => {
      if (p.rightButtonDown()) {
        this.cameras.main.scrollX -= (p.x - dragStartX) * 0.5;
        this.cameras.main.scrollY -= (p.y - dragStartY) * 0.5;
        dragStartX = p.x; dragStartY = p.y;
      }
    });
    this.input.on('wheel', (_p: unknown, _gx: unknown, _gy: unknown, _gz: unknown, dy: number) => {
      this.cameras.main.zoom = Phaser.Math.Clamp(this.cameras.main.zoom - dy * 0.001, 0.5, 2);
    });
  }

  // ─── HUD ────────────────────────────────────────────────────────

  private createPhaserHUD() {
    const { width } = this.cameras.main;

    this.timerText = this.add.text(width / 2, 8, '5:00', {
      fontSize: '20px',
      color: '#fff',
      fontFamily: '"Orbitron", monospace',
      fontStyle: 'bold',
    }).setOrigin(0.5, 0).setScrollFactor(0).setDepth(100);

    this.scoreText = this.add.text(width / 2, 32, '0 - 0', {
      fontSize: '14px',
      color: '#aaa',
      fontFamily: '"Rajdhani", monospace',
    }).setOrigin(0.5, 0).setScrollFactor(0).setDepth(100);

    this.objectiveText = this.add.text(width / 2, 50, 'CAPTURE THE FLAG', {
      fontSize: '10px',
      color: '#6c63ff',
      fontFamily: 'monospace',
      letterSpacing: 2,
    }).setOrigin(0.5, 0).setScrollFactor(0).setDepth(100);

    const { height } = this.cameras.main;
    this.cooldownBar = this.add.graphics().setScrollFactor(0).setDepth(100);
    this.cooldownText = this.add.text(width / 2, height - 80, 'READY', {
      fontSize: '11px',
      color: '#44ff88',
      fontFamily: 'monospace',
    }).setOrigin(0.5, 0).setScrollFactor(0).setDepth(100);
  }

  private updateTimerDisplay() {
    const mins = Math.floor(this.gameTimeRemaining / 60);
    const secs = this.gameTimeRemaining % 60;
    this.timerText.setText(`${mins}:${secs.toString().padStart(2, '0')}`);
    if (this.gameTimeRemaining <= 30) this.timerText.setColor('#ff4444');
    else if (this.gameTimeRemaining <= 60) this.timerText.setColor('#ffaa44');
  }

  private updateScoreDisplay() {
    const cpDots = this.controlPoints.map(cp => {
      if (cp.owner === 'player1') return '[B]';
      if (cp.owner === 'player2') return '[R]';
      return '[ ]';
    }).join(' ');
    this.scoreText.setText(`${this.ctf.score1} - ${this.ctf.score2}  ${cpDots}`);
  }

  private updateCooldownDisplay() {
    const { width, height } = this.cameras.main;
    this.cooldownBar.clear();

    if (this.commandCooldownRemaining > 0) {
      const progress = this.commandCooldownRemaining / COMMAND_COOLDOWN;
      this.cooldownBar.fillStyle(0xffaa44, 0.3);
      this.cooldownBar.fillRect(width / 2 - 150, height - 78, 300 * progress, 4);
      this.cooldownText.setText(`COOLDOWN ${Math.ceil(this.commandCooldownRemaining / 1000)}s`);
      this.cooldownText.setColor('#ffaa44');
    } else {
      this.cooldownText.setText('READY');
      this.cooldownText.setColor('#44ff88');
    }
  }

  private showAnnouncement(text: string, color: string) {
    const { width, height } = this.cameras.main;
    const announce = this.add.text(width / 2, height / 2 - 40, text, {
      fontSize: '28px',
      color,
      fontFamily: '"Orbitron", monospace',
      fontStyle: 'bold',
    }).setOrigin(0.5).setScrollFactor(0).setDepth(200).setAlpha(0);

    this.tweens.add({
      targets: announce,
      alpha: 1,
      scaleX: { from: 0.5, to: 1 },
      scaleY: { from: 0.5, to: 1 },
      duration: 300,
      ease: 'Back.easeOut',
    });
    this.tweens.add({
      targets: announce,
      alpha: 0,
      y: height / 2 - 80,
      duration: 600,
      delay: 1500,
      onComplete: () => announce.destroy(),
    });
  }

  // ─── STATE ──────────────────────────────────────────────────────

  private applyServerState(state: Record<string, Character>) {
    for (const [id, charState] of Object.entries(state)) {
      this.charData.set(id, charState);
      const entity = this.characters.get(id);
      if (entity) entity.updateFromState(charState);
    }
    this.updateStatusBar();
  }

  private endGame(winner: string, reason: string) {
    if (this.gameOver) return;
    this.gameOver = true;

    if (this.gameTickTimer) this.gameTickTimer.destroy();
    if (this.moveTickTimer) this.moveTickTimer.destroy();
    if (this.secondTimer) this.secondTimer.destroy();

    this.commandBarEl.style.display = 'none';
    this.commandLogEl.style.display = 'none';
    this.statusBarEl.style.display = 'none';
    this.abilityPanelEl.style.display = 'none';
    this.commandInput.destroy();

    const winText = reason === 'flag_captured' ? 'FLAG CAPTURED!' : 'TIME UP!';
    this.showAnnouncement(winText, winner === this.playerId ? '#44ff88' : '#ff4444');

    this.time.delayedCall(2000, () => {
      this.cameras.main.fadeOut(500, 5, 5, 16);
      this.cameras.main.once('camerafadeoutcomplete', () => {
        this.scene.start('ResultScene', { winner, playerId: this.playerId, isLocal: this.isLocal });
      });
    });
  }

  private addCommandLog(sender: string, text: string, status: string) {
    const entry = document.createElement('div');
    entry.className = 'log-entry';
    const color = sender === 'System' ? '#ffcc00' : '#aaa';
    entry.innerHTML = `
      <span class="player" style="color:${color}">${sender}:</span>
      <span class="text">${text}</span>
      <div class="result ${status === 'processing' ? 'processing-indicator' : ''}">${status === 'processing' ? 'Processing...' : status}</div>
    `;
    this.commandLogEl.appendChild(entry);
    this.commandLogEl.scrollTop = this.commandLogEl.scrollHeight;
  }

  private updateCommandLogResult(result: string) {
    const lastEntry = this.commandLogEl.lastElementChild;
    if (lastEntry) {
      const resultEl = lastEntry.querySelector('.result');
      if (resultEl) {
        resultEl.textContent = result;
        resultEl.classList.remove('processing-indicator');
      }
    }
  }

  private updateStatusBar() {
    const myChars = Array.from(this.charData.values()).filter(c => c.owner === this.playerId);
    const oppChars = Array.from(this.charData.values()).filter(c => c.owner !== this.playerId);

    let html = '<div style="display:flex;justify-content:space-between;width:100%">';
    html += '<div>';
    myChars.forEach(c => {
      const pct = Math.max(0, (c.currentHp / c.stats.hp) * 100);
      const flagIcon = c.hasFlag ? ' [FLAG]' : '';
      const dead = c.isDead ? ` (${c.respawnTimer ?? 0}s)` : '';
      const cls = CLASSES[c.classId];
      const ability = cls.abilities[0];
      const abilityCd = ability ? (c.cooldowns[ability.id] || 0) : 0;
      const abilityText = ability
        ? `<span style="color:${abilityCd > 0 ? '#666' : '#8888ff'};font-size:9px">${ability.name} ${abilityCd > 0 ? `(${abilityCd}s)` : '(READY)'}</span>`
        : '';

      // Active effects
      const effectIcons = c.effects.map(e => {
        switch (e.type) {
          case 'stun': return '<span style="color:#ff4444;font-size:9px">STUN</span>';
          case 'slow': return '<span style="color:#4488ff;font-size:9px">SLOW</span>';
          case 'speed_boost': return '<span style="color:#ffcc00;font-size:9px">SPD+</span>';
          case 'damage_boost': return '<span style="color:#ff6600;font-size:9px">DMG+</span>';
          case 'defense_debuff': return '<span style="color:#aa44ff;font-size:9px">DEF-</span>';
          default: return '';
        }
      }).filter(Boolean).join(' ');

      const queueLen = this.orderQueues.get(c.id)?.length || 0;
      const queueText = queueLen > 0 ? ` <span style="color:#ffaa44;font-size:9px">[+${queueLen} queued]</span>` : '';

      html += `<span class="char-status" style="opacity:${c.isDead ? 0.4 : 1}">
        <strong style="color:#8888ff">${c.name}</strong>
        <span style="color:#666;font-size:11px">(${cls.name})</span>
        ${c.isDead ? `<span style="color:#ff4444">${dead}</span>` :
          `<div class="hp-bar"><div class="hp-fill" style="width:${pct}%"></div></div>
          <span>${c.currentHp}/${c.stats.hp}</span>`}
        ${abilityText}${queueText}
        ${effectIcons ? `<span>${effectIcons}</span>` : ''}
        <span style="color:#ffaa44">${flagIcon}</span>
      </span>`;
    });
    html += '</div><div>';
    oppChars.forEach(c => {
      const entity = this.characters.get(c.id);
      if (entity && !entity.fogVisible && !c.isDead) return;
      const pct = Math.max(0, (c.currentHp / c.stats.hp) * 100);
      const flagIcon = c.hasFlag ? ' [FLAG]' : '';
      const cls = CLASSES[c.classId];

      html += `<span class="char-status" style="opacity:${c.isDead ? 0.4 : 1}">
        <strong style="color:#ff8888">${c.name}</strong>
        <span style="color:#666;font-size:11px">(${cls.name})</span>
        ${c.isDead ? '<span style="color:#ff4444"> DEAD</span>' :
          `<div class="hp-bar"><div class="hp-fill" style="width:${pct}%;background:#ff4444"></div></div>
          <span>${c.currentHp}/${c.stats.hp}</span>`}
        <span style="color:#ffaa44">${flagIcon}</span>
      </span>`;
    });
    html += '</div></div>';
    this.statusBarEl.innerHTML = html;
  }

  private updateAbilityPanel() {
    const myChars = Array.from(this.charData.values()).filter(c => c.owner === this.playerId);

    let html = '<h3>Your Team</h3>';
    myChars.forEach(c => {
      const cls = CLASSES[c.classId];
      const animal = ANIMALS[c.animalId];
      const isAlive = !c.isDead;

      html += `<div class="ap-char" style="opacity:${isAlive ? 1 : 0.4}">`;
      html += `<div class="ap-char-name">${c.name}</div>`;
      html += `<div class="ap-char-class">${cls.name} + ${animal.name}</div>`;

      const ability = cls.abilities[0];
      if (ability) {
        const cd = c.cooldowns[ability.id] || 0;
        html += `<div class="ap-ability">`;
        html += `<div class="ap-ability-name">${ability.name}</div>`;
        html += `<div class="ap-ability-desc">${ability.description}</div>`;
        html += `<div class="ap-ability-cd ${cd > 0 ? 'cooldown' : 'ready'}">${cd > 0 ? `CD: ${cd}s` : 'READY'}</div>`;
        html += `</div>`;
      }

      const order = c.currentOrder;
      const queue = this.orderQueues.get(c.id) || [];

      html += `<div class="ap-order">`;
      if (c.isDead) {
        html += `<div class="ap-order-current" style="color:#ff4444">DEAD (${c.respawnTimer ?? 0}s)</div>`;
      } else if (order) {
        html += `<div class="ap-order-current">${this.getOrderLabel(order)}</div>`;
      } else {
        html += `<div class="ap-order-current" style="color:#888">idle</div>`;
      }
      queue.forEach((q, i) => {
        html += `<div class="ap-order-queued">${i + 1}. ${this.getOrderLabel(q)}</div>`;
      });
      html += `</div>`;

      if (c.effects.length > 0) {
        html += `<div class="ap-effects">`;
        const effectMeta: Record<string, { color: string; name: string }> = {
          stun: { color: '#ff4444', name: 'STUN' },
          slow: { color: '#4488ff', name: 'SLOW' },
          speed_boost: { color: '#ffcc00', name: 'SPD+' },
          damage_boost: { color: '#ff6600', name: 'DMG+' },
          defense_debuff: { color: '#aa44ff', name: 'DEF-' },
        };
        c.effects.forEach(e => {
          const meta = effectMeta[e.type] || { color: '#888', name: e.type };
          html += `<span style="color:${meta.color}">${meta.name} (${e.duration}s)</span> `;
        });
        html += `</div>`;
      }

      html += `</div>`;
    });

    const visibleEnemies = Array.from(this.charData.values())
      .filter(c => c.owner !== this.playerId)
      .filter(c => {
        const entity = this.characters.get(c.id);
        return c.isDead || (entity && entity.fogVisible);
      });

    if (visibleEnemies.length > 0) {
      html += '<h3 style="margin-top:8px">Enemies</h3>';
      visibleEnemies.forEach(c => {
        const cls = CLASSES[c.classId];
        html += `<div class="ap-char enemy" style="opacity:${c.isDead ? 0.4 : 1}">`;
        html += `<div class="ap-char-name">${c.name}</div>`;
        html += `<div class="ap-char-class">${cls.name}</div>`;
        if (!c.isDead) {
          const pct = Math.round((c.currentHp / c.stats.hp) * 100);
          html += `<div style="font-size:10px;color:${pct > 50 ? '#66dd88' : '#ff8844'}">${c.currentHp}/${c.stats.hp} HP</div>`;
        } else {
          html += `<div style="font-size:10px;color:#ff4444">DEAD</div>`;
        }
        html += `</div>`;
      });
    }

    this.abilityPanelEl.innerHTML = html;
  }

  update() {
    if (this.commandCooldownRemaining > 0) {
      const prev = this.commandCooldownRemaining;
      this.commandCooldownRemaining = Math.max(0,
        (this.lastCommandTime + COMMAND_COOLDOWN) - Date.now());
      this.updateCooldownDisplay();
      if (prev > 0 && this.commandCooldownRemaining === 0) {
        this.sound_.playCommandReady();
      }
    }
  }

  shutdown() {
    this.commandBarEl.style.display = 'none';
    this.commandLogEl.style.display = 'none';
    this.statusBarEl.style.display = 'none';
    this.abilityPanelEl.style.display = 'none';
    this.commandInput?.destroy();
    if (this.gameTickTimer) this.gameTickTimer.destroy();
    if (this.moveTickTimer) this.moveTickTimer.destroy();
    if (this.secondTimer) this.secondTimer.destroy();
    if (this.miniMap) this.miniMap.destroy();
  }
}
