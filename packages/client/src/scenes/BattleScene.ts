import Phaser from 'phaser';
import {
  DraftPick, Character, computeStats, CLASSES, ANIMALS,
  Position, CharacterOrder, CTFState, ControlPoint,
  ConsumableId, CONSUMABLES, rollRandomConsumable,
  POI, Barricade, Trap, XP_THRESHOLDS, LEVEL_STAT_BONUS,
} from '@prompt-battle/shared';
import { CharacterEntity } from '../entities/Character';
import {
  generateMap, GameMap, MAP_WIDTH, MAP_HEIGHT, TILE_SIZE, isPassable,
  SwitchGateLink, POIPlacement,
} from '../map/MapGenerator';
import { findPath } from '../map/Pathfinding';
import { CommandInput } from '../systems/CommandInput';
import { FirebaseSync, SyncSnapshot, RemoteOrderPayload } from '../network/FirebaseSync';
import { generateCharacterName, resetNames } from '../systems/NameGenerator';
import {
  parseCommandWithGemini, GeminiParseResult,
} from '../systems/GeminiCommandParser';
import { SoundManager } from '../systems/SoundManager';
import { MiniMap } from '../systems/MiniMap';

// ─── CONSTANTS ────────────────────────────────────────────────────
const COMMAND_COOLDOWN = 5000;
const GAME_DURATION = 300;
const RESPAWN_TIME = 20;
const TICK_RATE = 750;
const MOVE_TICK = 900;
const BASE_VISION = 5;
const PICKUP_RESPAWN = 25; // seconds
const DOM_POINTS_TO_WIN = 200; // Domination: first to 200 points wins
const DOM_POINTS_PER_TICK = 1; // Points earned per owned control point per second
const ATTACK_INTERVAL = 2000; // ms between auto-attacks per character
const CENTER_CP_MULTIPLIER = 2;

// Activity channel times (in game ticks, TICK_RATE = 750ms)
const SCOUT_CHANNEL_TICKS = 13;   // ~10 seconds
const LOOT_CHANNEL_TICKS = 11;    // ~8 seconds
const BUILD_CHANNEL_TICKS = 8;    // ~6 seconds
const TRAP_CHANNEL_TICKS = 5;     // ~4 seconds
const UPGRADE_CP_TICKS = 11;      // ~8 seconds
const CACHE_RESPAWN_TIME = 45;    // seconds
const LOOKOUT_VISION_RADIUS = 12;
const LOOKOUT_VISION_DURATION = 30; // seconds
const WELL_HEAL_PER_TICK = 8;
const BARRICADE_HP = 80;
const BARRICADE_DECAY = 60;       // seconds
const MAX_TRAPS_PER_TEAM = 3;
const TRAP_DAMAGE = 25;
const TRAP_STUN = 3;
const MAX_INVENTORY = 2;
const XP_KILL = 50;
const XP_CAPTURE_CP = 40;
const XP_LOOT_CACHE = 30;
const XP_SCOUT = 20;

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
  amPlayer1?: boolean;
}

export class BattleScene extends Phaser.Scene {
  private gameId!: string;
  private playerId!: string;
  private isLocal!: boolean;
  private picks!: DraftPick[];
  private isHost = true;
  private opponentId = 'opponent';

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

  // CTF / Domination
  private ctf!: CTFState;
  private flag1Sprite!: Phaser.GameObjects.Container;
  private flag2Sprite!: Phaser.GameObjects.Container;
  private domScore1 = 0;
  private domScore2 = 0;

  // Fog of war (3-state: unexplored / remembered / visible)
  private fogLayer!: Phaser.GameObjects.Graphics;
  private visibleTiles: Set<string> = new Set();
  private exploredTiles: Set<string> = new Set();
  private rememberedTileTextures: Map<string, string> = new Map(); // key -> last seen texture name

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
  private lastAttackTime: Map<string, number> = new Map(); // charId -> timestamp

  // Sound
  private sound_: SoundManager = SoundManager.getInstance();

  // Mini-map
  private miniMap!: MiniMap;

  // Path visualization
  private pathGraphics!: Phaser.GameObjects.Graphics;

  // Map rendering
  private tileLayer!: Phaser.GameObjects.Group;
  private tileSprites: Phaser.GameObjects.Sprite[][] = [];

  // Switch/gate system
  private switchGateLinks: SwitchGateLink[] = [];
  private activatedSwitches: Set<string> = new Set();

  // POIs (lookouts, wells, caches)
  private pois: POI[] = [];
  private poiSprites: Map<string, Phaser.GameObjects.Container> = new Map();
  private poiInteractIndicators: Map<string, Phaser.GameObjects.Container> = new Map();

  // Barricades & Traps
  private barricades: Barricade[] = [];
  private barricadeSprites: Map<string, Phaser.GameObjects.Sprite> = new Map();
  private traps: Trap[] = [];
  private trapSprites: Map<string, Phaser.GameObjects.Sprite> = new Map();

  // Lookout vision zones (temporary revealed areas)
  private lookoutVisionZones: { center: Position; radius: number; expiresAt: number }[] = [];

  // Vision flare (reveals whole map temporarily)
  private visionFlareUntil = 0;

  // Smoke bombs (fog clouds)
  private smokeClouds: { position: Position; radius: number; owner: string; expiresAt: number }[] = [];
  private smokeSprites: Map<string, Phaser.GameObjects.Graphics> = new Map();

  // Damage tracking for XP assists
  private damageDealt: Map<string, Map<string, number>> = new Map(); // targetId -> Map<attackerId, damage>

  // Character selection for direct commands
  private selectedCharId: string | null = null;
  private selectedCharLabel!: Phaser.GameObjects.Text;

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
    this.isHost = data.isLocal || (data.amPlayer1 ?? true);
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

    // Determine opponent's player ID from picks
    const oppPick = this.picks.find(p => p.playerId !== this.playerId);
    if (oppPick) this.opponentId = oppPick.playerId;

    const seed = this.isLocal
      ? Date.now()
      : this.gameId.split('').reduce((a, c) => a + c.charCodeAt(0), 0);
    this.gameMap = generateMap(seed);

    this.renderMap();
    this.createCharacters();
    this.initDomination();
    this.initControlPoints();
    this.spawnPickups();
    this.initPOIs();
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

    this.characters.forEach((charEntity, charId) => {
      const char = this.charData.get(charId);
      if (!char || char.owner !== this.playerId) return;
      charEntity.sprite.on('pointerdown', () => {
        this.selectCharacter(charId);
      });
    });

    // Selected character HUD label (fixed to camera)
    this.selectedCharLabel = this.add.text(
      this.cameras.main.width / 2, 10,
      'Commanding: ALL',
      {
        fontSize: '13px',
        color: '#FFD93D',
        fontFamily: '"Nunito", sans-serif',
        fontStyle: 'bold',
        backgroundColor: '#00000088',
        padding: { x: 8, y: 4 },
      }
    ).setOrigin(0.5, 0).setScrollFactor(0).setDepth(100);

    // Keyboard: Q/E or [/] to cycle, Escape to deselect
    this.input.keyboard!.on('keydown-Q', () => this.cycleSelectedChar(-1));
    this.input.keyboard!.on('keydown-E', () => this.cycleSelectedChar(1));
    this.input.keyboard!.on('keydown-OPEN_BRACKET', () => this.cycleSelectedChar(-1));
    this.input.keyboard!.on('keydown-CLOSED_BRACKET', () => this.cycleSelectedChar(1));
    this.input.keyboard!.on('keydown-ESC', () => this.selectCharacter(null));

    // Ability hotkeys: 1, 2, 3
    this.input.keyboard!.on('keydown-ONE', () => this.useAbilityHotkey(0));
    this.input.keyboard!.on('keydown-TWO', () => this.useAbilityHotkey(1));
    this.input.keyboard!.on('keydown-THREE', () => this.useAbilityHotkey(2));

    this.cameras.main.fadeIn(500, 5, 5, 16);

    if (!this.isLocal && this.isHost) {
      this.startGameLoop();
      this.firebase.onRemoteOrders(this.gameId, (data) => {
        if (data.playerId !== this.playerId) {
          this.applyRemoteOrders(data.playerId, data.orders);
          this.firebase.removeRemoteOrder(this.gameId, data.key);
        }
      });
      this.pushSyncState();
    } else if (!this.isLocal && !this.isHost) {
      this.firebase.onSyncState(this.gameId, (state) => {
        this.applySyncState(state);
      });
      this.secondTimer = this.time.addEvent({
        delay: 1000,
        callback: () => {
          if (!this.gameOver) {
            this.gameTimeRemaining--;
            this.updateTimerDisplay();
          }
        },
        loop: true,
      });
    } else {
      this.startGameLoop();
    }
  }

  // ─── MAP RENDERING ──────────────────────────────────────────────

  private renderMap() {
    this.tileLayer = this.add.group();
    this.tileSprites = [];
    for (let y = 0; y < MAP_HEIGHT; y++) {
      this.tileSprites[y] = [];
      for (let x = 0; x < MAP_WIDTH; x++) {
        const tile = this.gameMap.tiles[y][x];
        const sprite = this.add.sprite(
          x * TILE_SIZE + TILE_SIZE / 2,
          y * TILE_SIZE + TILE_SIZE / 2,
          `tile_${tile}`
        );
        sprite.setDepth(0);
        this.tileLayer.add(sprite);
        this.tileSprites[y][x] = sprite;
      }
    }
    this.switchGateLinks = this.gameMap.switchGateLinks;
  }

  // ─── CHARACTER CREATION ─────────────────────────────────────────

  private createCharacters() {
    const myPicks = this.picks.filter(p => p.playerId === this.playerId);
    const oppPicks = this.picks.filter(p => p.playerId !== this.playerId);

    // For spawns, use actual game role (amPlayer1/isHost), not local perspective
    const mySpawnIsP1 = this.isHost;

    myPicks.forEach((pick, i) => {
      const charData = this.buildCharacter(pick, i, mySpawnIsP1);
      this.charData.set(charData.id, charData);
      const entity = new CharacterEntity(this, charData, true);
      this.characters.set(charData.id, entity);
      this.orderQueues.set(charData.id, []);
    });

    oppPicks.forEach((pick, i) => {
      const charData = this.buildCharacter(pick, i, !mySpawnIsP1);
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

    let visionRange = animal.vision ?? BASE_VISION;
    // Class bonuses
    if (pick.classId === 'archer') visionRange += 1;
    if (pick.classId === 'rogue') visionRange += 1;

    return {
      id: `${pick.playerId}_${pick.classId}_${index}`,
      owner: pick.playerId,
      classId: pick.classId,
      animalId: pick.animalId,
      name,
      stats,
      baseStats: { ...stats },
      currentHp: stats.hp,
      position: { ...spawns[index] },
      cooldowns: {},
      effects: [],
      isDead: false,
      level: 1,
      xp: 0,
      inventory: [],
      respawnTimer: 0,
      currentOrder: null,
      path: [],
      hasFlag: false,
      visionRange,
    };
  }

  // ─── DOMINATION ─────────────────────────────────────────────────

  private initDomination() {
    this.domScore1 = 0;
    this.domScore2 = 0;
    this.ctf = {
      flag1: { position: { x: 0, y: 0 }, homePosition: { x: 0, y: 0 }, carrier: null, isHome: true },
      flag2: { position: { x: 0, y: 0 }, homePosition: { x: 0, y: 0 }, carrier: null, isHome: true },
      score1: 0, score2: 0, capturesNeeded: 999,
    };
  }

  private tickDominationScoring() {
    let p1Points = 0;
    let p2Points = 0;
    for (let i = 0; i < this.controlPoints.length; i++) {
      const cp = this.controlPoints[i];
      const mult = i === 1 ? CENTER_CP_MULTIPLIER : 1; // center CP worth 2x
      if (cp.owner === 'player1') p1Points += DOM_POINTS_PER_TICK * mult;
      if (cp.owner === 'player2') p2Points += DOM_POINTS_PER_TICK * mult;
    }
    if (p1Points > 0 || p2Points > 0) {
      this.domScore1 += p1Points;
      this.domScore2 += p2Points;
      this.updateScoreDisplay();
    }

    if (this.domScore1 >= DOM_POINTS_TO_WIN) {
      this.endGame(this.playerId, 'domination');
    } else if (this.domScore2 >= DOM_POINTS_TO_WIN) {
      this.endGame(this.opponentId, 'domination');
    }
  }

  // ─── PICKUPS ────────────────────────────────────────────────────

  private spawnPickups() {
    const cx = Math.floor(MAP_WIDTH / 2);
    const cy = Math.floor(MAP_HEIGHT / 2);

    const defs: { type: Pickup['type']; pos: Position }[] = [
      { type: 'health_potion', pos: { x: cx, y: cy - 8 } },
      { type: 'health_potion', pos: { x: cx, y: cy + 8 } },
      { type: 'health_potion', pos: { x: cx - 16, y: cy } },
      { type: 'health_potion', pos: { x: cx + 16, y: cy } },
      { type: 'speed_boost', pos: { x: cx - 12, y: cy - 10 } },
      { type: 'speed_boost', pos: { x: cx + 12, y: cy + 10 } },
      { type: 'damage_boost', pos: { x: cx - 10, y: cy + 12 } },
      { type: 'damage_boost', pos: { x: cx + 10, y: cy - 12 } },
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
        health_potion: '#45E6B0', speed_boost: '#FFD93D', damage_boost: '#FF6B6B',
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

  // ─── POI SYSTEM (Lookouts, Wells, Caches) ──────────────────────

  private initPOIs() {
    let poiIdx = 0;
    for (const placement of this.gameMap.poiPlacements) {
      const poi: POI = {
        id: `poi_${poiIdx++}`,
        type: placement.type,
        position: placement.position,
        active: true,
        respawnTimer: 0,
        channelTime: placement.type === 'lookout' ? SCOUT_CHANNEL_TICKS
          : placement.type === 'treasure_cache' ? LOOT_CHANNEL_TICKS : 0,
      };
      this.pois.push(poi);

      const px = placement.position.x * TILE_SIZE + TILE_SIZE / 2;
      const py = placement.position.y * TILE_SIZE + TILE_SIZE / 2;
      const container = this.add.container(px, py).setDepth(6);

      // POI sprite
      const texKey = `poi_${placement.type}`;
      const sprite = this.add.sprite(0, 0, texKey).setScale(0.9);
      container.add(sprite);

      // Label with reward info
      const labelMap = {
        lookout: 'SCOUT',
        healing_well: 'HEAL',
        treasure_cache: 'LOOT',
      };
      const rewardMap = {
        lookout: '+Vision +20XP',
        healing_well: '+HP/tick',
        treasure_cache: '+Item +30XP',
      };
      const colorMap = {
        lookout: '#FFD93D',
        healing_well: '#45E6B0',
        treasure_cache: '#FF9F43',
      };
      const label = this.add.text(0, 16, labelMap[placement.type], {
        fontSize: '7px',
        color: colorMap[placement.type],
        fontFamily: '"Nunito", sans-serif',
        fontStyle: 'bold',
      }).setOrigin(0.5);
      container.add(label);

      const rewardLabel = this.add.text(0, 24, rewardMap[placement.type], {
        fontSize: '6px',
        color: '#cbb8ee',
        fontFamily: '"Nunito", sans-serif',
      }).setOrigin(0.5);
      container.add(rewardLabel);

      // Pulsing animation
      this.tweens.add({
        targets: sprite,
        scaleX: { from: 0.85, to: 0.95 },
        scaleY: { from: 0.85, to: 0.95 },
        alpha: { from: 0.8, to: 1 },
        duration: 1000,
        yoyo: true,
        repeat: -1,
        ease: 'Sine.easeInOut',
      });

      this.poiSprites.set(poi.id, container);

      // Interact indicator (shows when a character is nearby)
      const interactMap = {
        lookout: '>> SCOUT: Reveal map +20XP',
        healing_well: '>> Stand here to heal',
        treasure_cache: '>> LOOT: Random item +30XP',
      };
      const interactLabel = interactMap[placement.type];
      const interactContainer = this.add.container(px, py - 26).setDepth(15).setVisible(false);
      const interactBg = this.add.graphics();
      interactBg.fillStyle(0x000000, 0.8);
      interactBg.fillRoundedRect(-80, -10, 160, 20, 5);
      interactContainer.add(interactBg);
      const interactText = this.add.text(0, 0, interactLabel, {
        fontSize: '8px', color: '#FFD93D',
        fontFamily: '"Nunito", sans-serif', fontStyle: 'bold',
      }).setOrigin(0.5);
      interactContainer.add(interactText);
      this.poiInteractIndicators.set(poi.id, interactContainer);
    }
  }

  private updatePOIs() {
    // Show interact indicators when ally is near a POI
    for (const poi of this.pois) {
      const indicator = this.poiInteractIndicators.get(poi.id);
      if (!indicator) continue;

      if (!poi.active) {
        indicator.setVisible(false);
        const sprite = this.poiSprites.get(poi.id);
        if (sprite) sprite.setAlpha(0.3);
        continue;
      }

      const sprite = this.poiSprites.get(poi.id);
      if (sprite) sprite.setAlpha(1);

      // Check if any allied character is adjacent
      let allyNearby = false;
      this.charData.forEach(char => {
        if (char.owner !== this.playerId || char.isDead) return;
        if (this.tileDist(char.position, poi.position) <= 1) {
          allyNearby = true;
        }
      });

      indicator.setVisible(allyNearby && poi.type !== 'healing_well'); // wells are passive
    }

    // Healing wells: passively heal characters standing on them
    for (const poi of this.pois) {
      if (poi.type !== 'healing_well' || !poi.active) continue;
      this.charData.forEach(char => {
        if (char.isDead) return;
        if (char.position.x === poi.position.x && char.position.y === poi.position.y) {
          if (char.currentHp < char.stats.hp) {
            const heal = Math.min(WELL_HEAL_PER_TICK, char.stats.hp - char.currentHp);
            char.currentHp += heal;
            const entity = this.characters.get(char.id);
            if (entity && heal > 0) entity.showHealing(heal);
          }
        }
      });
    }
  }

  private tickPOIRespawns() {
    for (const poi of this.pois) {
      if (!poi.active && poi.respawnTimer > 0) {
        poi.respawnTimer--;
        if (poi.respawnTimer <= 0) {
          poi.active = true;
        }
      }
    }
  }

  // ─── ACTIVITY CHANNELING ──────────────────────────────────────

  private updateChanneling() {
    this.charData.forEach(char => {
      if (char.isDead || !char.channelActivity) return;

      const activity = char.channelActivity;
      const entity = this.characters.get(char.id);

      // Check if still at the position
      if (char.position.x !== activity.position.x || char.position.y !== activity.position.y) {
        char.channelActivity = null;
        if (entity) entity.setOrderText(char.currentOrder ? this.getOrderLabel(char.currentOrder) : 'idle');
        return;
      }

      // Check if stunned = interrupt
      if (char.effects.some(e => e.type === 'stun')) {
        char.channelActivity = null;
        if (entity) entity.setOrderText('STUNNED');
        return;
      }

      // Tick channel
      activity.ticksRemaining--;

      // Show progress
      if (entity) {
        const totalTicks = this.getChannelTotal(activity.type);
        const progress = Math.round(((totalTicks - activity.ticksRemaining) / totalTicks) * 100);
        const timeLeft = Math.ceil(activity.ticksRemaining * TICK_RATE / 1000);
        entity.setOrderText(`${activity.type.toUpperCase()} ${progress}% (${timeLeft}s)`);
      }

      if (activity.ticksRemaining <= 0) {
        this.completeChannel(char, activity.type);
        char.channelActivity = null;
        char.currentOrder = null;
        if (entity) entity.setOrderText('idle');
      }
    });
  }

  private getChannelTotal(type: string): number {
    switch (type) {
      case 'scout': return SCOUT_CHANNEL_TICKS;
      case 'loot': return LOOT_CHANNEL_TICKS;
      case 'build': return BUILD_CHANNEL_TICKS;
      case 'trap': return TRAP_CHANNEL_TICKS;
      case 'upgrade_cp': return UPGRADE_CP_TICKS;
      default: return 10;
    }
  }

  private completeChannel(char: Character, type: string) {
    const entity = this.characters.get(char.id);
    switch (type) {
      case 'scout': {
        // Grant vision in large radius for 30 seconds
        this.lookoutVisionZones.push({
          center: { ...char.position },
          radius: LOOKOUT_VISION_RADIUS,
          expiresAt: Date.now() + LOOKOUT_VISION_DURATION * 1000,
        });
        this.grantXP(char, XP_SCOUT);
        this.addCommandLog('System', `${char.name} scouted! Vision revealed for ${LOOKOUT_VISION_DURATION}s`, 'activity');
        this.showAnnouncement('LOOKOUT ACTIVATED', '#FFD93D');
        break;
      }
      case 'loot': {
        // Find the cache POI at this position
        const poi = this.pois.find(p =>
          p.type === 'treasure_cache' && p.active &&
          p.position.x === char.position.x && p.position.y === char.position.y
        );
        if (poi) {
          poi.active = false;
          poi.respawnTimer = CACHE_RESPAWN_TIME;
        }
        // Roll random consumable
        if (char.inventory.length < MAX_INVENTORY) {
          const item = rollRandomConsumable();
          char.inventory.push(item);
          const def = CONSUMABLES[item];
          this.grantXP(char, XP_LOOT_CACHE);
          this.addCommandLog('System', `${char.name} looted: ${def.icon} ${def.name}!`, 'activity');
          this.showAnnouncement(`LOOTED: ${def.name}`, '#FF9F43');
        } else {
          this.addCommandLog('System', `${char.name} inventory full! (max ${MAX_INVENTORY})`, 'warning');
        }
        break;
      }
      case 'build': {
        const barricade: Barricade = {
          id: `barricade_${Date.now()}`,
          position: { ...char.position },
          owner: char.owner,
          hp: BARRICADE_HP,
          maxHp: BARRICADE_HP,
          decayTimer: BARRICADE_DECAY,
        };
        this.barricades.push(barricade);
        this.createBarricadeSprite(barricade);
        this.addCommandLog('System', `${char.name} built a barricade!`, 'activity');
        break;
      }
      case 'trap': {
        const teamTraps = this.traps.filter(t => t.owner === char.owner);
        if (teamTraps.length >= MAX_TRAPS_PER_TEAM) {
          // Remove oldest
          const oldest = teamTraps[0];
          this.traps = this.traps.filter(t => t.id !== oldest.id);
          const spr = this.trapSprites.get(oldest.id);
          if (spr) { spr.destroy(); this.trapSprites.delete(oldest.id); }
        }
        const trap: Trap = {
          id: `trap_${Date.now()}`,
          position: { ...char.position },
          owner: char.owner,
          damage: TRAP_DAMAGE,
          stunDuration: TRAP_STUN,
          visible: false,
        };
        this.traps.push(trap);
        this.createTrapSprite(trap);
        this.addCommandLog('System', `${char.name} set a trap!`, 'activity');
        break;
      }
      case 'upgrade_cp': {
        const cp = this.controlPoints.find(c =>
          c.owner === (char.owner === this.playerId ? 'player1' : 'player2') &&
          this.tileDist(char.position, c.position) <= 2
        );
        if (cp && !cp.upgraded) {
          cp.upgraded = true;
          cp.buff.value *= 1.5;
          cp.buff.label = cp.buff.label + ' (UP)';
          this.addCommandLog('System', `${char.name} upgraded control point! Buff increased.`, 'activity');
          this.showAnnouncement('CP UPGRADED!', '#6CC4FF');
        }
        break;
      }
    }
  }

  private startChannel(char: Character, type: 'scout' | 'loot' | 'build' | 'trap' | 'upgrade_cp') {
    char.channelActivity = {
      type,
      ticksRemaining: this.getChannelTotal(type),
      position: { ...char.position },
    };
    char.path = []; // stop moving
    const entity = this.characters.get(char.id);
    if (entity) entity.setOrderText(`${type.toUpperCase()} 0%`);
  }

  // ─── BARRICADES & TRAPS ───────────────────────────────────────

  private createBarricadeSprite(b: Barricade) {
    const px = b.position.x * TILE_SIZE + TILE_SIZE / 2;
    const py = b.position.y * TILE_SIZE + TILE_SIZE / 2;
    const sprite = this.add.sprite(px, py, 'barricade').setDepth(8);
    this.barricadeSprites.set(b.id, sprite);
  }

  private createTrapSprite(t: Trap) {
    const px = t.position.x * TILE_SIZE + TILE_SIZE / 2;
    const py = t.position.y * TILE_SIZE + TILE_SIZE / 2;
    const sprite = this.add.sprite(px, py, 'trap').setDepth(3).setAlpha(0.4);
    // Only visible to the trap owner
    if (t.owner !== this.playerId) sprite.setVisible(false);
    this.trapSprites.set(t.id, sprite);
  }

  private updateBarricadesAndTraps() {
    // Barricade decay
    for (let i = this.barricades.length - 1; i >= 0; i--) {
      const b = this.barricades[i];
      if (b.hp <= 0 || b.decayTimer <= 0) {
        const spr = this.barricadeSprites.get(b.id);
        if (spr) { spr.destroy(); this.barricadeSprites.delete(b.id); }
        this.barricades.splice(i, 1);
      }
    }

    // Trap triggers
    this.charData.forEach(char => {
      if (char.isDead) return;
      for (let i = this.traps.length - 1; i >= 0; i--) {
        const trap = this.traps[i];
        if (trap.owner === char.owner) continue; // don't trigger own traps
        if (char.position.x === trap.position.x && char.position.y === trap.position.y) {
          // Trigger!
          char.currentHp = Math.max(0, char.currentHp - trap.damage);
          char.effects.push({ type: 'stun', duration: trap.stunDuration, value: 1 });
          const entity = this.characters.get(char.id);
          if (entity) {
            entity.showDamage(trap.damage);
            entity.setOrderText('TRAPPED!');
          }
          this.addCommandLog('System', `${char.name} triggered a trap! (-${trap.damage} HP, stunned ${trap.stunDuration}s)`, 'trap');
          if (char.currentHp <= 0) this.killCharacter(char);
          // Remove trap
          const spr = this.trapSprites.get(trap.id);
          if (spr) { spr.destroy(); this.trapSprites.delete(trap.id); }
          this.traps.splice(i, 1);
          break;
        }
      }
    });
  }

  private tickBarricadeDecay() {
    for (const b of this.barricades) {
      b.decayTimer--;
    }
  }

  // Returns true if position is blocked by a barricade
  private isBarricadeAt(pos: Position): boolean {
    return this.barricades.some(b => b.position.x === pos.x && b.position.y === pos.y && b.hp > 0);
  }

  // ─── LEVELING / XP ───────────────────────────────────────────

  private grantXP(char: Character, amount: number) {
    if (char.level >= 5) return; // max level
    char.xp += amount;

    const nextThreshold = XP_THRESHOLDS[char.level] ?? Infinity;
    if (char.xp >= nextThreshold) {
      char.level++;
      this.applyLevelStats(char);
      const entity = this.characters.get(char.id);
      if (entity) {
        this.showLevelUpVFX(entity);
      }
      this.addCommandLog('System', `${char.name} reached LEVEL ${char.level}!`, 'levelup');
      this.showAnnouncement(`${char.name} LEVEL UP! (Lv.${char.level})`, '#FFD93D');
    }
  }

  private applyLevelStats(char: Character) {
    const bonus = 1 + (char.level - 1) * LEVEL_STAT_BONUS;
    char.stats = {
      hp: Math.round(char.baseStats.hp * bonus),
      attack: Math.round(char.baseStats.attack * bonus),
      defense: Math.round(char.baseStats.defense * bonus),
      speed: Math.round(char.baseStats.speed * bonus),
      range: char.baseStats.range, // range doesn't scale
      magic: Math.round(char.baseStats.magic * bonus),
    };
    // Heal the HP difference from level up
    const hpGain = char.stats.hp - char.baseStats.hp * (1 + (char.level - 2) * LEVEL_STAT_BONUS);
    if (hpGain > 0) char.currentHp = Math.min(char.stats.hp, char.currentHp + Math.round(hpGain));
  }

  private showLevelUpVFX(entity: CharacterEntity) {
    // Golden burst
    const burst = this.add.circle(entity.sprite.x, entity.sprite.y, 4, 0xFFD93D, 0.8).setDepth(25);
    this.tweens.add({
      targets: burst,
      scaleX: 4, scaleY: 4, alpha: 0,
      duration: 500, ease: 'Cubic.easeOut',
      onComplete: () => burst.destroy(),
    });
    // Stars
    for (let i = 0; i < 6; i++) {
      const angle = (Math.PI * 2 / 6) * i;
      const star = this.add.text(
        entity.sprite.x + Math.cos(angle) * 4,
        entity.sprite.y + Math.sin(angle) * 4,
        '\u2B50', { fontSize: '10px' }
      ).setOrigin(0.5).setDepth(25);
      this.tweens.add({
        targets: star,
        x: star.x + Math.cos(angle) * 20,
        y: star.y + Math.sin(angle) * 20,
        alpha: 0,
        duration: 600, delay: 100,
        onComplete: () => star.destroy(),
      });
    }
  }

  // ─── CONSUMABLE USE ───────────────────────────────────────────

  private useConsumable(char: Character, itemId: ConsumableId) {
    const idx = char.inventory.indexOf(itemId);
    if (idx === -1) {
      this.addCommandLog('System', `${char.name} doesn't have ${CONSUMABLES[itemId].name}!`, 'warning');
      return;
    }
    char.inventory.splice(idx, 1);
    const def = CONSUMABLES[itemId];
    const entity = this.characters.get(char.id);

    switch (itemId) {
      case 'siege_bomb': {
        // 40 AOE damage in 2-tile radius around character
        this.charData.forEach(target => {
          if (target.owner === char.owner || target.isDead) return;
          if (this.tileDist(char.position, target.position) <= 2) {
            target.currentHp = Math.max(0, target.currentHp - 40);
            const te = this.characters.get(target.id);
            if (te) te.showDamage(40);
            if (target.currentHp <= 0) this.killCharacter(target);
          }
        });
        // VFX: explosion
        if (entity) {
          const exp = this.add.circle(entity.sprite.x, entity.sprite.y, 8, 0xFF6B00, 0.8).setDepth(25);
          this.tweens.add({ targets: exp, scaleX: 5, scaleY: 5, alpha: 0, duration: 400, onComplete: () => exp.destroy() });
        }
        break;
      }
      case 'smoke_bomb': {
        this.smokeClouds.push({
          position: { ...char.position },
          radius: 3,
          owner: char.owner,
          expiresAt: Date.now() + 8000,
        });
        break;
      }
      case 'battle_horn': {
        // All allies +30% damage for 12s
        this.charData.forEach(ally => {
          if (ally.owner === char.owner && !ally.isDead) {
            ally.effects.push({ type: 'damage_boost', duration: 12, value: 1.3 });
          }
        });
        this.showAnnouncement('BATTLE HORN! +30% DMG', '#FF9F43');
        break;
      }
      case 'haste_elixir': {
        char.effects.push({ type: 'speed_boost', duration: 15, value: 2 });
        break;
      }
      case 'iron_skin': {
        char.effects.push({ type: 'iron_skin', duration: 20, value: 1.4 });
        break;
      }
      case 'vision_flare': {
        this.visionFlareUntil = Date.now() + 10000;
        this.showAnnouncement('VISION FLARE! Map revealed!', '#FFD93D');
        break;
      }
      case 'rally_banner': {
        this.charData.forEach(ally => {
          if (ally.owner === char.owner && ally.isDead && (ally.respawnTimer ?? 0) > 8) {
            ally.respawnTimer = Math.max(1, (ally.respawnTimer ?? 0) - 8);
          }
        });
        this.showAnnouncement('RALLY! Respawns accelerated!', '#45E6B0');
        break;
      }
      case 'purge_scroll': {
        // Destroy enemy barricades within 5 tiles
        for (let i = this.barricades.length - 1; i >= 0; i--) {
          const b = this.barricades[i];
          if (b.owner !== char.owner && this.tileDist(char.position, b.position) <= 5) {
            const spr = this.barricadeSprites.get(b.id);
            if (spr) { spr.destroy(); this.barricadeSprites.delete(b.id); }
            this.barricades.splice(i, 1);
          }
        }
        this.showAnnouncement('PURGE! Enemy barricades destroyed!', '#C98FFF');
        break;
      }
    }

    this.addCommandLog('System', `${char.name} used ${def.icon} ${def.name}!`, 'item');
  }

  // ─── FOG OF WAR ─────────────────────────────────────────────────

  private initFogOfWar() {
    this.fogLayer = this.add.graphics();
    this.fogLayer.setDepth(50);
    this.exploredTiles.clear();
    this.rememberedTileTextures.clear();
    this.updateFogOfWar();
  }

  private updateFogOfWar() {
    this.visibleTiles.clear();

    // Vision flare: reveal everything
    const now = Date.now();
    if (this.visionFlareUntil > now) {
      for (let y = 0; y < MAP_HEIGHT; y++) {
        for (let x = 0; x < MAP_WIDTH; x++) {
          this.visibleTiles.add(`${x},${y}`);
        }
      }
    } else {
      // Normal character vision
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

      // Lookout vision zones
      this.lookoutVisionZones = this.lookoutVisionZones.filter(z => z.expiresAt > now);
      for (const zone of this.lookoutVisionZones) {
        for (let dy = -zone.radius; dy <= zone.radius; dy++) {
          for (let dx = -zone.radius; dx <= zone.radius; dx++) {
            if (dx * dx + dy * dy > zone.radius * zone.radius) continue;
            const tx = zone.center.x + dx;
            const ty = zone.center.y + dy;
            if (tx >= 0 && tx < MAP_WIDTH && ty >= 0 && ty < MAP_HEIGHT) {
              this.visibleTiles.add(`${tx},${ty}`);
            }
          }
        }
      }
    }

    // Mark newly visible tiles as explored and cache their current texture
    this.visibleTiles.forEach((key) => {
      this.exploredTiles.add(key);
      const [xs, ys] = key.split(',');
      const x = parseInt(xs), y = parseInt(ys);
      const tile = this.gameMap.tiles[y]?.[x];
      if (tile) {
        this.rememberedTileTextures.set(key, `tile_${tile}`);
      }
    });

    // Draw fog overlay
    this.fogLayer.clear();
    for (let y = 0; y < MAP_HEIGHT; y++) {
      for (let x = 0; x < MAP_WIDTH; x++) {
        const key = `${x},${y}`;
        const px = x * TILE_SIZE;
        const py = y * TILE_SIZE;

        if (this.visibleTiles.has(key)) {
          // Currently visible — show real tile, no overlay
          if (this.tileSprites[y]?.[x]) {
            this.tileSprites[y][x].setTexture(`tile_${this.gameMap.tiles[y][x]}`);
            this.tileSprites[y][x].setVisible(true);
          }
        } else if (this.exploredTiles.has(key)) {
          // Previously seen — show last-known texture with dark hazy overlay
          if (this.tileSprites[y]?.[x]) {
            const remembered = this.rememberedTileTextures.get(key);
            if (remembered) {
              this.tileSprites[y][x].setTexture(remembered);
            }
            this.tileSprites[y][x].setVisible(true);
          }
          this.fogLayer.fillStyle(0x111111, 0.40);
          this.fogLayer.fillRect(px, py, TILE_SIZE, TILE_SIZE);
        } else {
          // Never explored — solid grey, hide tile texture
          if (this.tileSprites[y]?.[x]) {
            this.tileSprites[y][x].setVisible(false);
          }
          this.fogLayer.fillStyle(0x444444, 1.0);
          this.fogLayer.fillRect(px, py, TILE_SIZE, TILE_SIZE);
        }
      }
    }

    // Enemy visibility — only show if currently visible (not in remembered/hazy)
    this.characters.forEach((entity, id) => {
      const char = this.charData.get(id);
      if (!char || char.owner === this.playerId) return;
      const key = `${char.position.x},${char.position.y}`;
      let visible = this.visibleTiles.has(key);
      // Bush concealment: enemies on bush tiles are invisible unless a friendly is within 1 tile
      if (visible && this.gameMap.tiles[char.position.y]?.[char.position.x] === 'bush') {
        const friendlyNearby = Array.from(this.charData.values()).some(f =>
          f.owner === this.playerId && !f.isDead &&
          Math.abs(f.position.x - char.position.x) + Math.abs(f.position.y - char.position.y) <= 1
        );
        if (!friendlyNearby) visible = false;
      }
      entity.setFogVisible(visible);
    });


    // Hide pickups in fog — only show if currently visible
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
        const t = this.gameMap.tiles[cy][cx];
        if (t === 'rock' || t === 'ruins' || t === 'gate_closed') return false;
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
    this.tickPOIRespawns();
    this.tickBarricadeDecay();

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

    // Domination: score points for owned control points each second
    this.tickDominationScoring();

    if (this.gameTimeRemaining <= 0) {
      const winner = this.domScore1 > this.domScore2 ? this.playerId
        : this.domScore2 > this.domScore1 ? this.opponentId
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

    this.checkPickupCollisions();
    this.updatePOIs();
    this.updateChanneling();
    this.updateBarricadesAndTraps();
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

    // Host pushes state to Firebase for the guest
    if (!this.isLocal && this.isHost) {
      this.pushSyncState();
    }
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

      // Check if character stepped on a switch
      const currentTile = this.gameMap.tiles[char.position.y]?.[char.position.x];
      if (currentTile === 'switch') {
        this.triggerSwitch(char.position);
      }

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

  // ─── SWITCH / GATE SYSTEM ──────────────────────────────────────

  private triggerSwitch(pos: Position) {
    const key = `${pos.x},${pos.y}`;
    if (this.activatedSwitches.has(key)) return; // debounce
    this.activatedSwitches.add(key);
    this.time.delayedCall(2000, () => this.activatedSwitches.delete(key));

    for (const link of this.switchGateLinks) {
      if (link.switchPos.x === pos.x && link.switchPos.y === pos.y) {
        for (const gp of link.gatePositions) {
          const current = this.gameMap.tiles[gp.y]?.[gp.x];
          if (current === 'gate_closed') {
            this.gameMap.tiles[gp.y][gp.x] = 'gate_open';
          } else if (current === 'gate_open') {
            this.gameMap.tiles[gp.y][gp.x] = 'gate_closed';
          }
          // Update sprite texture
          if (this.tileSprites[gp.y]?.[gp.x]) {
            this.tileSprites[gp.y][gp.x].setTexture(`tile_${this.gameMap.tiles[gp.y][gp.x]}`);
          }
        }
        // Visual feedback on switch
        const wx = pos.x * TILE_SIZE + TILE_SIZE / 2;
        const wy = pos.y * TILE_SIZE + TILE_SIZE / 2;
        const flash = this.add.circle(wx, wy, 16, 0xFFAA33, 0.5).setDepth(5);
        this.tweens.add({
          targets: flash, alpha: 0, scale: 2, duration: 400,
          onComplete: () => flash.destroy(),
        });
        break;
      }
    }
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
          return;
        }
        char.path = findPath(this.gameMap.tiles, char.position, order.targetPosition,
          char.stats.speed + 2, occupied);
        break;
      }
      case 'scout': {
        // Find nearest lookout
        const lookout = this.pois
          .filter(p => p.type === 'lookout' && p.active)
          .sort((a, b) => this.tileDist(char.position, a.position) - this.tileDist(char.position, b.position))[0];
        if (!lookout) { char.currentOrder = null; return; }
        if (this.tileDist(char.position, lookout.position) <= 0) return; // at position, executeAutoActions handles channel
        char.path = findPath(this.gameMap.tiles, char.position, lookout.position,
          char.stats.speed + 2, occupied);
        break;
      }
      case 'loot': {
        // Find nearest active cache
        const cache = this.pois
          .filter(p => p.type === 'treasure_cache' && p.active)
          .sort((a, b) => this.tileDist(char.position, a.position) - this.tileDist(char.position, b.position))[0];
        if (!cache) { char.currentOrder = null; return; }
        if (this.tileDist(char.position, cache.position) <= 0) return;
        char.path = findPath(this.gameMap.tiles, char.position, cache.position,
          char.stats.speed + 2, occupied);
        break;
      }
      case 'build':
      case 'set_trap': {
        // Build/trap at target position or current position
        if (order.targetPosition && this.tileDist(char.position, order.targetPosition) > 0) {
          char.path = findPath(this.gameMap.tiles, char.position, order.targetPosition,
            char.stats.speed + 2, occupied);
        }
        break;
      }
      case 'use_item': {
        // Instant - handled in executeAutoActions
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
    // Skip if channeling
    if (char.channelActivity) return;

    // Handle activity orders
    if (char.currentOrder) {
      const order = char.currentOrder;

      // Use item - instant
      if (order.type === 'use_item' && order.itemId) {
        this.useConsumable(char, order.itemId);
        char.currentOrder = null;
        return;
      }

      // Scout - at lookout position, start channeling
      if (order.type === 'scout') {
        const lookout = this.pois.find(p =>
          p.type === 'lookout' && p.active &&
          this.tileDist(char.position, p.position) <= 0
        );
        if (lookout) {
          this.startChannel(char, 'scout');
          return;
        }
      }

      // Loot - at cache position, start channeling
      if (order.type === 'loot') {
        const cache = this.pois.find(p =>
          p.type === 'treasure_cache' && p.active &&
          this.tileDist(char.position, p.position) <= 0
        );
        if (cache) {
          this.startChannel(char, 'loot');
          return;
        }
      }

      // Build - at any position, start channeling
      if (order.type === 'build' && !char.channelActivity) {
        this.startChannel(char, 'build');
        return;
      }

      // Set trap - at any position, start channeling
      if (order.type === 'set_trap' && !char.channelActivity) {
        this.startChannel(char, 'trap');
        return;
      }

      // Control order at owned CP - if CP already owned, try to upgrade
      if (order.type === 'control' && order.targetPosition) {
        const cp = this.controlPoints.find(c =>
          c.position.x === order.targetPosition!.x &&
          c.position.y === order.targetPosition!.y
        );
        if (cp && cp.owner === (char.owner === this.playerId ? 'player1' : 'player2')
          && !(cp as any).upgraded
          && this.tileDist(char.position, cp.position) <= 1) {
          this.startChannel(char, 'upgrade_cp');
          return;
        }
      }
    }

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
    // Attack cooldown: limit attack speed
    const now = this.time.now;
    const lastAtk = this.lastAttackTime.get(attacker.id) || 0;
    if (now - lastAtk < ATTACK_INTERVAL) return;
    this.lastAttackTime.set(attacker.id, now);

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
      this.killCharacter(target, attacker.id);
      this.sound_.playKill();
    }
  }

  private killCharacter(char: Character, killerId?: string) {
    char.isDead = true;
    char.respawnTimer = RESPAWN_TIME;
    char.path = [];
    char.currentOrder = null;
    char.channelActivity = null;
    const queue = this.orderQueues.get(char.id);
    if (queue) queue.length = 0;

    // Grant XP to killer
    if (killerId) {
      const killer = this.charData.get(killerId);
      if (killer) this.grantXP(killer, XP_KILL);
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
          this.killCharacter(target, char.id);
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
        this.showAnnouncement(`${target.name} STUNNED!`, '#FFD93D');
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

    // If a character is selected, prefix their name so parsers know who to command
    let commandText = rawText;
    if (this.selectedCharId) {
      const selChar = this.charData.get(this.selectedCharId);
      if (selChar && !selChar.isDead) {
        const hasNameRef = rawText.toLowerCase().includes(selChar.name.toLowerCase());
        if (!hasNameRef) {
          commandText = `${selChar.name}: ${rawText}`;
        }
      }
    }

    this.addCommandLog('You', rawText, 'processing');

    let orders: RemoteOrderPayload[] = [];
    try {
      if (this.hasGemini) {
        const result = await parseCommandWithGemini(
          commandText, this.charData, this.playerId, MAP_WIDTH, MAP_HEIGHT, this.ctf,
          this.controlPoints, this.gameMap.tiles, this.pois,
        );
        orders = this.applyParsedOrders(result);
        this.updateCommandLogResult(result.narration || 'Orders issued!');
      } else {
        orders = this.parseCommandLocally(commandText);
        this.updateCommandLogResult('Orders issued!');
      }
      // Guest: send parsed orders to host via Firebase
      if (!this.isLocal && !this.isHost && orders.length > 0) {
        this.firebase.sendRemoteOrders(this.gameId, this.playerId, orders);
      }
    } catch (err) {
      console.error('Command error:', err);
      try {
        const fallbackOrders = this.parseCommandLocally(commandText);
        this.updateCommandLogResult(this.hasGemini ? '(AI unavailable, used local parser)' : 'Orders issued!');
        if (!this.isLocal && !this.isHost && fallbackOrders.length > 0) {
          this.firebase.sendRemoteOrders(this.gameId, this.playerId, fallbackOrders);
        }
      } catch {
        this.updateCommandLogResult('Error: ' + (err as Error).message);
      }
    }

    this.updateCooldownDisplay();
  }

  private applyParsedOrders(result: GeminiParseResult): RemoteOrderPayload[] {
    const seenChars = new Set<string>();
    const collectedOrders: RemoteOrderPayload[] = [];

    for (const action of result.actions) {
      const char = this.charData.get(action.characterId);
      if (!char || char.isDead || char.owner !== this.playerId) continue;

      const order: CharacterOrder = {
        type: action.type as CharacterOrder['type'],
        targetPosition: action.targetPosition,
        targetCharacterId: action.targetCharacterId,
        abilityId: action.abilityId,
        itemId: action.itemId as ConsumableId | undefined,
      };

      // Queue if this char already got a primary order or if explicitly queued
      const isQueued = action.queued || seenChars.has(action.characterId);
      seenChars.add(action.characterId);

      if (isQueued) {
        const queue = this.orderQueues.get(char.id);
        if (queue && queue.length < 3) {
          queue.push(order);
          collectedOrders.push({ characterId: char.id, order, queued: true });
        }
      } else {
        char.currentOrder = order;
        char.path = [];
        collectedOrders.push({ characterId: char.id, order, queued: false });
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
    return collectedOrders;
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
      case 'scout': return 'SCOUT';
      case 'loot': return 'LOOT';
      case 'build': return 'BUILD';
      case 'set_trap': return 'TRAP';
      case 'use_item': {
        if (order.itemId) return `USE ${CONSUMABLES[order.itemId].name}`;
        return 'USE ITEM';
      }
      default: return '';
    }
  }

  // ─── LOCAL PARSER ───────────────────────────────────────────────

  private parseCommandLocally(rawText: string): RemoteOrderPayload[] {
    const collectedOrders: RemoteOrderPayload[] = [];
    const thenParts = rawText.split(/\s+then\s+/i);
    for (let partIdx = 0; partIdx < thenParts.length; partIdx++) {
      const isQueued = partIdx > 0;
      const clauses = this.splitClauses(thenParts[partIdx]);
      for (const clause of clauses) {
        collectedOrders.push(...this.parseCommandPart(clause.trim(), isQueued));
      }
    }
    return collectedOrders;
  }

  private splitClauses(text: string): string[] {
    const parts = text.split(/\s*,\s*/);
    const myChars = Array.from(this.charData.values())
      .filter(c => c.owner === this.playerId && !c.isDead);
    const charTokens = new Set<string>();
    for (const char of myChars) {
      charTokens.add(CLASSES[char.classId].name.toLowerCase());
      charTokens.add(ANIMALS[char.animalId].name.toLowerCase());
      for (const w of char.name.toLowerCase().split(/\s+/)) {
        if (w.length > 2) charTokens.add(w);
      }
    }
    charTokens.add('all');
    charTokens.add('everyone');
    charTokens.add('my');
    charTokens.add('the');

    const result: string[] = [];
    for (const part of parts) {
      const andPattern = /\s+and\s+/gi;
      let match;
      let lastIdx = 0;
      const splits: string[] = [];
      while ((match = andPattern.exec(part)) !== null) {
        const after = part.slice(match.index + match[0].length).toLowerCase().trim();
        const firstWord = after.split(/\s+/)[0];
        if (charTokens.has(firstWord)) {
          splits.push(part.slice(lastIdx, match.index));
          lastIdx = match.index + match[0].length;
        }
      }
      splits.push(part.slice(lastIdx));
      result.push(...splits.filter(s => s.trim().length > 0));
    }
    return result.length > 0 ? result : [text];
  }

  private resolveCharTargets(text: string, myChars: Character[]): Character[] {
    if (text.includes('all') || text.includes('everyone')) return myChars;
    const matched: Character[] = [];
    for (const char of myChars) {
      const cls = CLASSES[char.classId].name.toLowerCase();
      const animal = ANIMALS[char.animalId].name.toLowerCase();
      const name = char.name.toLowerCase();
      if (text.includes(cls) || text.includes(animal) || text.includes(name)) {
        matched.push(char);
      }
    }
    return matched.length > 0 ? matched : myChars;
  }

  private resolveEnemyTarget(text: string, attackerPos: Position, enemyChars: Character[]): Character | undefined {
    if (enemyChars.length === 0) return undefined;
    for (const enemy of enemyChars) {
      if (text.includes(CLASSES[enemy.classId].name.toLowerCase())
        || text.includes(ANIMALS[enemy.animalId].name.toLowerCase())
        || text.includes(enemy.name.toLowerCase())) {
        return enemy;
      }
    }
    if (text.includes('weakest') || text.includes('lowest') || text.includes('weak')) {
      return enemyChars.reduce((a, b) => a.currentHp / a.stats.hp < b.currentHp / b.stats.hp ? a : b);
    }
    if (text.includes('strongest') || text.includes('highest') || text.includes('strong')) {
      return enemyChars.reduce((a, b) => a.currentHp / a.stats.hp > b.currentHp / b.stats.hp ? a : b);
    }
    if (text.includes('nearest') || text.includes('closest')) {
      return this.findNearest(attackerPos, enemyChars);
    }
    return enemyChars[0];
  }

  private parseMoveTarget(text: string, char: Character, enemyChars: Character[]): Position {
    const coordMatch = text.match(/(?:to\s+)?(\d{1,2})\s*[,\s]\s*(\d{1,2})/);
    if (coordMatch) {
      return {
        x: Phaser.Math.Clamp(parseInt(coordMatch[1]), 0, MAP_WIDTH - 1),
        y: Phaser.Math.Clamp(parseInt(coordMatch[2]), 0, MAP_HEIGHT - 1),
      };
    }
    if (text.includes('center') || text.includes('middle')) {
      return { x: Math.floor(MAP_WIDTH / 2), y: Math.floor(MAP_HEIGHT / 2) };
    }
    // Directional: go all the way to the edge so they keep walking until blocked
    if (text.includes('up') || text.includes('north')) {
      return { x: char.position.x, y: 0 };
    }
    if (text.includes('down') || text.includes('south')) {
      return { x: char.position.x, y: MAP_HEIGHT - 1 };
    }
    if (text.includes('left') || text.includes('west')) {
      return { x: 0, y: char.position.y };
    }
    if (text.includes('right') || text.includes('east')) {
      return { x: MAP_WIDTH - 1, y: char.position.y };
    }
    if (text.includes('flank') && enemyChars.length > 0) {
      const nearest = this.findNearest(char.position, enemyChars);
      const dx = char.position.x - nearest.position.x;
      return dx >= 0
        ? { x: Math.min(MAP_WIDTH - 1, nearest.position.x + 5), y: nearest.position.y }
        : { x: Math.max(0, nearest.position.x - 5), y: nearest.position.y };
    }
    if (text.includes('behind') && enemyChars.length > 0) {
      const nearest = this.findNearest(char.position, enemyChars);
      const dx = nearest.position.x - char.position.x;
      const dy = nearest.position.y - char.position.y;
      return {
        x: Phaser.Math.Clamp(nearest.position.x + Math.sign(dx) * 3, 0, MAP_WIDTH - 1),
        y: Phaser.Math.Clamp(nearest.position.y + Math.sign(dy) * 3, 0, MAP_HEIGHT - 1),
      };
    }
    if (text.includes('enemy') || text.includes('opponent')) {
      if (enemyChars.length > 0) return this.findNearest(char.position, enemyChars).position;
    }
    if (text.includes('home') || text.includes('our base') || text.includes('my base')) {
      return this.gameMap.spawnP1[1];
    }
    if (text.includes('their base') || text.includes('enemy base')) {
      return this.gameMap.spawnP2[1];
    }
    const dir = char.position.x < MAP_WIDTH / 2 ? 1 : -1;
    return { x: char.position.x + dir * 8, y: char.position.y };
  }

  private parseCommandPart(rawText: string, queued: boolean): RemoteOrderPayload[] {
    const text = rawText.toLowerCase();
    const myChars = Array.from(this.charData.values())
      .filter(c => c.owner === this.playerId && !c.isDead);
    const enemyChars = Array.from(this.charData.values())
      .filter(c => c.owner !== this.playerId && !c.isDead);
    if (myChars.length === 0) return [];

    // If a character is selected, commands go to them unless text explicitly names someone else
    let targetChars: Character[];
    if (this.selectedCharId) {
      const selectedChar = this.charData.get(this.selectedCharId);
      if (selectedChar && !selectedChar.isDead && selectedChar.owner === this.playerId) {
        // Check if command explicitly references a different character
        const explicitTargets = this.resolveCharTargets(text, myChars);
        const explicitlyNamed = explicitTargets.length < myChars.length; // user named specific chars
        targetChars = explicitlyNamed ? explicitTargets : [selectedChar];
      } else {
        targetChars = this.resolveCharTargets(text, myChars);
      }
    } else {
      targetChars = this.resolveCharTargets(text, myChars);
    }
    const affectedChars = new Set<string>();

    const partOrders: RemoteOrderPayload[] = [];
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
      affectedChars.add(char.id);
      partOrders.push({ characterId: char.id, order, queued });
    };

    // ── Use consumable item ─────────────────────────────────────────
    if (text.includes('use ') || text.includes('drink ') || text.includes('throw ') || text.includes('activate ')) {
      for (const char of targetChars) {
        // Try to match item name from inventory
        for (const itemId of char.inventory) {
          const def = CONSUMABLES[itemId];
          if (text.includes(def.name.toLowerCase()) || text.includes(itemId.replace(/_/g, ' '))) {
            setOrder(char, { type: 'use_item', itemId });
            break;
          }
        }
        // Fallback: use first item in inventory
        if (!affectedChars.has(char.id) && char.inventory.length > 0) {
          if (text.includes('potion') || text.includes('elixir') || text.includes('bomb')
            || text.includes('horn') || text.includes('scroll') || text.includes('flare')
            || text.includes('banner') || text.includes('item')) {
            setOrder(char, { type: 'use_item', itemId: char.inventory[0] });
          }
        }
      }
      if (affectedChars.size > 0) {
        this.updateOrderLabels(affectedChars);
        return partOrders;
      }
    }

    // ── Scout / lookout ───────────────────────────────────────────
    if (text.includes('scout') || text.includes('lookout') || text.includes('watchtower')) {
      for (const char of targetChars) setOrder(char, { type: 'scout' });
      this.updateOrderLabels(affectedChars);
      return partOrders;
    }

    // ── Loot / treasure / cache ──────────────────────────────────
    if (text.includes('loot') || text.includes('treasure') || text.includes('cache') || text.includes('chest')) {
      for (const char of targetChars) setOrder(char, { type: 'loot' });
      this.updateOrderLabels(affectedChars);
      return partOrders;
    }

    // ── Build barricade ──────────────────────────────────────────
    if (text.includes('build') || text.includes('barricade') || text.includes('fortify')) {
      for (const char of targetChars) setOrder(char, { type: 'build' });
      this.updateOrderLabels(affectedChars);
      return partOrders;
    }

    // ── Set trap ─────────────────────────────────────────────────
    if (text.includes('trap') || text.includes('mine') || text.includes('snare')) {
      for (const char of targetChars) setOrder(char, { type: 'set_trap' });
      this.updateOrderLabels(affectedChars);
      return partOrders;
    }

    // ── Spread out / split up ──────────────────────────────────────
    if (text.includes('spread') || text.includes('split up') || text.includes('scatter')) {
      const cx = targetChars.reduce((s, c) => s + c.position.x, 0) / targetChars.length;
      const cy = targetChars.reduce((s, c) => s + c.position.y, 0) / targetChars.length;
      const angleStep = (Math.PI * 2) / targetChars.length;
      targetChars.forEach((char, i) => {
        const angle = angleStep * i;
        setOrder(char, { type: 'move', targetPosition: {
          x: Phaser.Math.Clamp(Math.round(cx + Math.cos(angle) * 6), 0, MAP_WIDTH - 1),
          y: Phaser.Math.Clamp(Math.round(cy + Math.sin(angle) * 6), 0, MAP_HEIGHT - 1),
        }});
      });
      this.updateOrderLabels(affectedChars);
      return partOrders;
    }

    // ── Capture / control point / take point ─────────────────────────
    if (text.includes('control point') || text.includes('take the point') || text.includes('capture point')
      || text.includes('capture') || text.includes('take point') || text.includes('go to point')
      || text.includes('cap ')) {
      const unowned = this.controlPoints
        .filter(cp => cp.owner !== 'player1')
        .sort((a, b) => this.tileDist(targetChars[0].position, a.position) - this.tileDist(targetChars[0].position, b.position));
      const targetCP = unowned[0] || this.controlPoints[1];
      for (const char of targetChars) setOrder(char, { type: 'control', targetPosition: targetCP.position });
      this.updateOrderLabels(affectedChars);
      return partOrders;
    }

    // ── Go home / retreat to base ─────────────────────────────────
    if (text.includes('bring it home') || text.includes('come home') || text.includes('go home')
      || text.includes('return to base') || text.includes('go to base')) {
      for (const char of targetChars) setOrder(char, { type: 'move', targetPosition: this.gameMap.spawnP1[1] });
      this.updateOrderLabels(affectedChars);
      return partOrders;
    }
    // ── Escort / protect / follow ally ─────────────────────────────
    else if (text.includes('escort') || text.includes('guard carrier')
      || text.includes('protect') || text.includes('follow')) {
      let escortTarget: Character | undefined;
      for (const char of myChars) {
        const cls = CLASSES[char.classId].name.toLowerCase();
        const animal = ANIMALS[char.animalId].name.toLowerCase();
        const name = char.name.toLowerCase();
        if ((text.includes(cls) || text.includes(animal) || text.includes(name))
          && !targetChars.includes(char)) {
          escortTarget = char;
          break;
        }
      }
      if (!escortTarget) escortTarget = myChars[0]; // default to first ally
      if (escortTarget) {
        for (const char of targetChars) {
          if (char.id !== escortTarget.id) setOrder(char, { type: 'escort', targetCharacterId: escortTarget.id });
        }
      }
    }
    // ── Focus fire ─────────────────────────────────────────────────
    else if (text.includes('focus')) {
      const target = this.resolveEnemyTarget(text, targetChars[0].position, enemyChars);
      if (target) {
        for (const char of targetChars) setOrder(char, { type: 'attack', targetCharacterId: target.id });
      }
    }
    // ── Attack / fight ─────────────────────────────────────────────
    else if (text.includes('attack') || text.includes('hit') || text.includes('strike')
      || text.includes('kill') || text.includes('fight') || text.includes('engage')) {
      for (const char of targetChars) {
        const target = this.resolveEnemyTarget(text, char.position, enemyChars);
        if (target) setOrder(char, { type: 'attack', targetCharacterId: target.id });
      }
    }
    // ── Ability / spell / cast ─────────────────────────────────────
    else if (text.includes('ability') || text.includes('skill') || text.includes('spell')
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
            : this.resolveEnemyTarget(text, char.position, enemyChars);
          if (target) setOrder(char, { type: 'ability', targetCharacterId: target.id, abilityId: abilityToUse.id });
        }
      }
    }
    // ── Heal (with optional target ally) ───────────────────────────
    else if (text.includes('heal') || text.includes('restore') || text.includes('cure')) {
      let healTarget: Character | undefined;
      for (const char of myChars) {
        const cls = CLASSES[char.classId].name.toLowerCase();
        const animal = ANIMALS[char.animalId].name.toLowerCase();
        const name = char.name.toLowerCase();
        if (!targetChars.includes(char)
          && (text.includes(cls) || text.includes(animal) || text.includes(name))) {
          healTarget = char;
          break;
        }
      }
      if (!healTarget) healTarget = myChars.reduce((a, b) => a.currentHp / a.stats.hp < b.currentHp / b.stats.hp ? a : b);
      for (const char of targetChars) {
        const healAbility = CLASSES[char.classId].abilities.find(a => a.healing && !a.damage);
        if (healAbility) setOrder(char, { type: 'ability', targetCharacterId: healTarget.id, abilityId: healAbility.id });
      }
    }
    // ── Move / go / walk (+ flank, behind, coordinates) ────────────
    else if (text.includes('move') || text.includes('go') || text.includes('walk')
      || text.includes('run') || text.includes('advance') || text.includes('forward')
      || text.includes('flank') || text.includes('behind') || /\d{1,2}\s*[,\s]\s*\d{1,2}/.test(text)) {
      for (const char of targetChars) setOrder(char, { type: 'move', targetPosition: this.parseMoveTarget(text, char, enemyChars) });
    }
    // ── Patrol ──────────────────────────────────────────────────────
    else if (text.includes('patrol')) {
      for (const char of targetChars) setOrder(char, { type: 'patrol', targetPosition: this.parseMoveTarget(text, char, enemyChars) });
    }
    // ── Defend / guard / hold ──────────────────────────────────────
    else if (text.includes('defend') || text.includes('guard') || text.includes('hold')) {
      for (const char of targetChars) setOrder(char, { type: 'defend' });
    }
    // ── Retreat / fall back ────────────────────────────────────────
    else if (text.includes('retreat') || text.includes('back') || text.includes('base')
      || text.includes('fall back') || text.includes('disengage')) {
      for (const char of targetChars) setOrder(char, { type: 'retreat' });
    }
    // ── Default: move toward nearest unowned control point ──────────
    else {
      const unowned = this.controlPoints
        .filter(cp => cp.owner !== 'player1')
        .sort((a, b) => this.tileDist(targetChars[0].position, a.position) - this.tileDist(targetChars[0].position, b.position));
      const targetCP = unowned[0] || this.controlPoints[1];
      for (const char of targetChars) setOrder(char, { type: 'control', targetPosition: targetCP.position });
    }

    this.updateOrderLabels(affectedChars);
    return partOrders;
  }

  private updateOrderLabels(charIds: Set<string>) {
    for (const id of charIds) {
      const char = this.charData.get(id);
      const entity = this.characters.get(id);
      if (entity && char?.currentOrder) {
        const queueLen = this.orderQueues.get(id)?.length || 0;
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

      const isCenterCP = i === 1;
      const label = this.add.text(0, 16, cp.buff.label, {
        fontSize: '7px', color: '#ccc', fontFamily: 'monospace',
      }).setOrigin(0.5);
      container.add(label);

      const rewardText = isCenterCP ? '2x Score +40XP' : '+Score +40XP';
      const rewardLabel = this.add.text(0, 24, rewardText, {
        fontSize: '6px', color: '#FFD93D', fontFamily: '"Nunito", sans-serif',
      }).setOrigin(0.5);
      container.add(rewardLabel);

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
            // Grant XP to nearby allies
            this.charData.forEach(c => {
              if (c.owner === this.playerId && !c.isDead && this.tileDist(c.position, cp.position) <= 2) {
                this.grantXP(c, XP_CAPTURE_CP);
              }
            });
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
            this.showAnnouncement(`ENEMY CAPTURED POINT: ${cp.buff.label}`, '#FF6B6B');
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
      null,
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
    return myHp >= oppHp ? this.playerId : this.opponentId;
  }

  // ─── CHARACTER SELECTION ───────────────────────────────────────

  private selectCharacter(charId: string | null) {
    this.characters.forEach(c => c.deselect());
    this.selectedCharId = charId;

    if (charId) {
      const entity = this.characters.get(charId);
      const char = this.charData.get(charId);
      if (entity && char) {
        entity.select();
        this.selectedCharLabel.setText(`Commanding: ${char.name} [Q/E cycle, 1-3 abilities, Esc=all]`);
        this.cameras.main.centerOn(entity.sprite.x, entity.sprite.y);
      }
    } else {
      this.selectedCharLabel.setText('Commanding: ALL [Q/E cycle, click=select]');
    }
    this.updateAbilityPanel();
  }

  private cycleSelectedChar(direction: number) {
    const myCharIds = Array.from(this.charData.entries())
      .filter(([, c]) => c.owner === this.playerId && !c.isDead)
      .map(([id]) => id);
    if (myCharIds.length === 0) return;

    if (!this.selectedCharId) {
      this.selectCharacter(direction > 0 ? myCharIds[0] : myCharIds[myCharIds.length - 1]);
      return;
    }

    const idx = myCharIds.indexOf(this.selectedCharId);
    let nextIdx = idx + direction;
    if (nextIdx < 0) nextIdx = myCharIds.length - 1;
    if (nextIdx >= myCharIds.length) nextIdx = 0;
    this.selectCharacter(myCharIds[nextIdx]);
  }

  // ─── ABILITY HOTKEYS ─────────────────────────────────────────────

  private useAbilityHotkey(index: number) {
    if (!this.selectedCharId) return;
    const char = this.charData.get(this.selectedCharId);
    if (!char || char.isDead || char.owner !== this.playerId) return;

    const cls = CLASSES[char.classId];
    const ability = cls.abilities[index];
    if (!ability) return;

    // Check cooldown
    const cd = char.cooldowns[ability.id] || 0;
    if (cd > 0) {
      this.showAnnouncement(`${ability.name} on cooldown (${cd}s)`, '#FFD93D');
      return;
    }

    // Find target: healing → lowest HP ally, offensive → nearest visible enemy
    let targetId: string | undefined;
    if (ability.healing && !ability.damage) {
      const allies = Array.from(this.charData.values())
        .filter(c => c.owner === this.playerId && !c.isDead);
      if (allies.length > 0) {
        targetId = allies.reduce((a, b) =>
          a.currentHp / a.stats.hp < b.currentHp / b.stats.hp ? a : b,
        ).id;
      }
    } else {
      const enemies = Array.from(this.charData.values())
        .filter(c => c.owner !== this.playerId && !c.isDead);
      const visible = enemies.filter(e => {
        const entity = this.characters.get(e.id);
        return entity && entity.fogVisible;
      });
      if (visible.length > 0) {
        targetId = this.findNearest(char.position, visible).id;
      } else if (enemies.length > 0) {
        targetId = this.findNearest(char.position, enemies).id;
      }
    }

    if (!targetId) return;

    const order: CharacterOrder = {
      type: 'ability',
      abilityId: ability.id,
      targetCharacterId: targetId,
    };
    char.currentOrder = order;
    char.path = [];
    const queue = this.orderQueues.get(char.id);
    if (queue) queue.length = 0;

    const entity = this.characters.get(char.id);
    if (entity) entity.setOrderText(ability.name);

    this.updateAbilityPanel();
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
      const speed = 12;
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
      this.cameras.main.zoom = Phaser.Math.Clamp(this.cameras.main.zoom - dy * 0.003, 0.4, 3);
    });
  }

  // ─── HUD ────────────────────────────────────────────────────────

  private createPhaserHUD() {
    const { width } = this.cameras.main;

    this.timerText = this.add.text(width / 2, 8, '5:00', {
      fontSize: '22px',
      color: '#fff',
      fontFamily: '"Fredoka", sans-serif',
      fontStyle: 'bold',
    }).setOrigin(0.5, 0).setScrollFactor(0).setDepth(100);

    this.scoreText = this.add.text(width / 2, 32, '0 - 0', {
      fontSize: '15px',
      color: '#cbb8ee',
      fontFamily: '"Nunito", sans-serif',
      fontStyle: 'bold',
    }).setOrigin(0.5, 0).setScrollFactor(0).setDepth(100);

    this.objectiveText = this.add.text(width / 2, 50, `DOMINATION — First to ${DOM_POINTS_TO_WIN}`, {
      fontSize: '11px',
      color: '#FF6B9D',
      fontFamily: '"Fredoka", sans-serif',
      letterSpacing: 2,
    }).setOrigin(0.5, 0).setScrollFactor(0).setDepth(100);

    const { height } = this.cameras.main;
    this.cooldownBar = this.add.graphics().setScrollFactor(0).setDepth(100);
    this.cooldownText = this.add.text(width / 2, height - 80, 'READY', {
      fontSize: '12px',
      color: '#45E6B0',
      fontFamily: '"Nunito", sans-serif',
      fontStyle: 'bold',
    }).setOrigin(0.5, 0).setScrollFactor(0).setDepth(100);
  }

  private updateTimerDisplay() {
    const mins = Math.floor(this.gameTimeRemaining / 60);
    const secs = this.gameTimeRemaining % 60;
    this.timerText.setText(`${mins}:${secs.toString().padStart(2, '0')}`);
    if (this.gameTimeRemaining <= 30) this.timerText.setColor('#FF6B6B');
    else if (this.gameTimeRemaining <= 60) this.timerText.setColor('#FFD93D');
  }

  private updateScoreDisplay() {
    const myTeam = this.isHost ? 'player1' : 'player2';
    const cpDots = this.controlPoints.map(cp => {
      if (cp.owner === myTeam) return '[B]';
      if (cp.owner && cp.owner !== myTeam) return '[R]';
      return '[ ]';
    }).join(' ');
    const myScore = this.isHost ? this.domScore1 : this.domScore2;
    const oppScore = this.isHost ? this.domScore2 : this.domScore1;
    this.scoreText.setText(`${myScore} - ${oppScore}  ${cpDots}`);
  }

  private updateCooldownDisplay() {
    const { width, height } = this.cameras.main;
    this.cooldownBar.clear();

    if (this.commandCooldownRemaining > 0) {
      const progress = this.commandCooldownRemaining / COMMAND_COOLDOWN;
      this.cooldownBar.fillStyle(0xFFD93D, 0.3);
      this.cooldownBar.fillRect(width / 2 - 150, height - 78, 300 * progress, 4);
      this.cooldownText.setText(`COOLDOWN ${Math.ceil(this.commandCooldownRemaining / 1000)}s`);
      this.cooldownText.setColor('#FFD93D');
    } else {
      this.cooldownText.setText('READY');
      this.cooldownText.setColor('#45E6B0');
    }
  }

  private showAnnouncement(text: string, color: string) {
    const { width, height } = this.cameras.main;
    const announce = this.add.text(width / 2, height / 2 - 40, text, {
      fontSize: '28px',
      color,
      fontFamily: '"Fredoka", sans-serif',
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

  private endGame(winner: string, reason: string) {
    if (this.gameOver) return;
    this.gameOver = true;

    // Host: notify guest of game over
    if (!this.isLocal && this.isHost) {
      const characters: Record<string, Character> = {};
      this.charData.forEach((ch, id) => { characters[id] = ch; });
      const orderQueues: Record<string, CharacterOrder[]> = {};
      this.orderQueues.forEach((q, id) => { orderQueues[id] = [...q]; });
      this.firebase.pushSyncState(this.gameId, {
        characters,
        ctf: this.ctf,
        timeRemaining: this.gameTimeRemaining,
        controlPoints: this.controlPoints,
        orderQueues,
        domScore1: this.domScore1,
        domScore2: this.domScore2,
        gameOver: true,
        winner,
        winReason: reason,
      });
    }

    if (this.gameTickTimer) this.gameTickTimer.destroy();
    if (this.moveTickTimer) this.moveTickTimer.destroy();
    if (this.secondTimer) this.secondTimer.destroy();

    this.commandBarEl.style.display = 'none';
    this.commandLogEl.style.display = 'none';
    this.statusBarEl.style.display = 'none';
    this.abilityPanelEl.style.display = 'none';
    this.commandInput.destroy();

    const winText = reason === 'domination' ? 'DOMINATION!' : 'TIME UP!';
    this.showAnnouncement(winText, winner === this.playerId ? '#45E6B0' : '#FF6B6B');

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
    const color = sender === 'System' ? '#FFD93D' : '#aaa';
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
    const oppChars = Array.from(this.charData.values()).filter(c => c.owner !== this.playerId)
      .filter(c => {
        const entity = this.characters.get(c.id);
        return c.isDead || (entity && entity.fogVisible);
      });

    const effectMeta: Record<string, { color: string; label: string }> = {
      stun: { color: '#FF6B6B', label: 'STUN' },
      slow: { color: '#6CC4FF', label: 'SLOW' },
      speed_boost: { color: '#FFD93D', label: 'SPD+' },
      damage_boost: { color: '#FF9F43', label: 'DMG+' },
      defense_debuff: { color: '#C98FFF', label: 'DEF-' },
    };

    const renderCard = (c: Character, isAlly: boolean) => {
      const cls = CLASSES[c.classId];
      const side = isAlly ? 'ally' : 'enemy';
      const pct = Math.max(0, (c.currentHp / c.stats.hp) * 100);
      const ability = cls.abilities[0];
      const cd = ability ? (c.cooldowns[ability.id] || 0) : 0;

      let card = `<div class="char-card ${side}${c.isDead ? ' dead' : ''}">`;
      card += `<div class="char-info">`;

      // Row 1: name + class + level
      card += `<div class="char-name" style="color:${isAlly ? '#6CC4FF' : '#FF8EC8'}">${c.name}`;
      card += ` <span style="color:#FFD93D;font-size:10px">Lv.${c.level}</span>`;
      card += `</div>`;
      card += `<div class="char-class">${cls.name}</div>`;

      if (c.isDead) {
        card += `<div style="color:#FF6B6B;font-size:11px;font-weight:700">DEAD (${c.respawnTimer ?? 0}s)</div>`;
      } else {
        // Row 2: HP bar
        card += `<div class="char-hp-row">`;
        card += `<div class="hp-bar"><div class="hp-fill ${side}" style="width:${pct}%"></div></div>`;
        card += `<span class="hp-text">${c.currentHp}/${c.stats.hp}</span>`;
        card += `</div>`;

        // Row 2.5: XP bar (allies only)
        if (isAlly && c.level < 5) {
          const xpNeeded = XP_THRESHOLDS[c.level] ?? 999;
          const prevXp = XP_THRESHOLDS[c.level - 1] ?? 0;
          const xpProgress = Math.min(100, ((c.xp - prevXp) / (xpNeeded - prevXp)) * 100);
          card += `<div class="char-xp-row">`;
          card += `<div class="xp-bar"><div class="xp-fill" style="width:${xpProgress}%"></div></div>`;
          card += `<span class="xp-text">${c.xp}/${xpNeeded} XP</span>`;
          card += `</div>`;
        }

        // Row 3: ability + cooldown (allies only show full detail)
        if (ability) {
          card += `<div class="char-ability-row">`;
          card += `<span class="ability-name">${ability.name}</span>`;
          card += `<span class="ability-cd ${cd > 0 ? 'on-cd' : 'ready'}">${cd > 0 ? cd + 's' : 'READY'}</span>`;
          card += `</div>`;
        }

        // Row 3.5: Inventory (allies only)
        if (isAlly && c.inventory.length > 0) {
          card += `<div class="char-inventory">`;
          c.inventory.forEach(itemId => {
            const def = CONSUMABLES[itemId];
            card += `<span class="inv-item" title="${def.name}: ${def.description}">${def.icon} ${def.name}</span>`;
          });
          card += `</div>`;
        } else if (isAlly) {
          card += `<div class="char-inventory"><span style="color:#666;font-size:9px">No items</span></div>`;
        }

        // Row 4: effects
        if (c.effects.length > 0) {
          card += `<div class="char-effects">`;
          c.effects.forEach(e => {
            const meta = effectMeta[e.type] || { color: '#888', label: e.type };
            card += `<span class="effect-badge" style="color:${meta.color}">${meta.label} ${e.duration}s</span>`;
          });
          card += `</div>`;
        }

        // Row 5: current order + channel progress (allies only)
        if (isAlly) {
          const order = c.currentOrder;
          const queueLen = this.orderQueues.get(c.id)?.length || 0;
          const queueSuffix = queueLen > 0 ? ` +${queueLen}` : '';
          let orderText = order ? this.getOrderLabel(order) : 'idle';
          // Channel progress bar
          if (c.channelActivity) {
            const total = this.getChannelTotal(c.channelActivity.type);
            const progress = Math.round(((total - c.channelActivity.ticksRemaining) / total) * 100);
            const timeLeft = Math.ceil(c.channelActivity.ticksRemaining * TICK_RATE / 1000);
            const channelRewardMap: Record<string, string> = {
              scout: 'Reveal map +20XP',
              loot: 'Random item +30XP',
              build: 'Barricade (60s)',
              trap: 'Hidden trap (25dmg+stun)',
              upgrade_cp: 'Buff x1.5',
            };
            const reward = channelRewardMap[c.channelActivity.type] || '';
            orderText = `${c.channelActivity.type.toUpperCase()} ${progress}% (${timeLeft}s) → ${reward}`;
            card += `<div class="char-channel">`;
            card += `<div class="channel-bar"><div class="channel-fill" style="width:${progress}%"></div></div>`;
            card += `</div>`;
          }
          card += `<div class="char-order">${orderText}${queueSuffix}</div>`;
        }
      }

      card += `</div></div>`;
      return card;
    };

    let html = '<div style="display:flex;justify-content:space-between;width:100%;gap:16px">';
    html += `<div class="team-section">${myChars.map(c => renderCard(c, true)).join('')}</div>`;
    if (oppChars.length > 0) {
      html += `<div class="team-section">${oppChars.map(c => renderCard(c, false)).join('')}</div>`;
    }
    html += '</div>';
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

      const isSelected = c.id === this.selectedCharId;
      cls.abilities.forEach((ability, i) => {
        const cd = c.cooldowns[ability.id] || 0;
        const hotkey = isSelected ? `<span class="ap-hotkey">[${i + 1}]</span> ` : '';
        html += `<div class="ap-ability${isSelected ? ' selected' : ''}">`;
        html += `<div class="ap-ability-name">${hotkey}${ability.name}</div>`;
        html += `<div class="ap-ability-desc">${ability.description}</div>`;
        html += `<div class="ap-ability-cd ${cd > 0 ? 'cooldown' : 'ready'}">${cd > 0 ? `CD: ${cd}s` : 'READY'}</div>`;
        html += `</div>`;
      });

      const order = c.currentOrder;
      const queue = this.orderQueues.get(c.id) || [];

      html += `<div class="ap-order">`;
      if (c.isDead) {
        html += `<div class="ap-order-current" style="color:#FF6B6B">DEAD (${c.respawnTimer ?? 0}s)</div>`;
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
          stun: { color: '#FF6B6B', name: 'STUN' },
          slow: { color: '#4488ff', name: 'SLOW' },
          speed_boost: { color: '#FFD93D', name: 'SPD+' },
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
          html += `<div style="font-size:10px;color:#FF6B6B">DEAD</div>`;
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
  // ─── ONLINE SYNC ──────────────────────────────────────────────

  private pushSyncState() {
    const characters: Record<string, Character> = {};
    this.charData.forEach((char, id) => {
      characters[id] = char;
    });
    const orderQueues: Record<string, CharacterOrder[]> = {};
    this.orderQueues.forEach((queue, id) => {
      orderQueues[id] = [...queue];
    });
    const snapshot: SyncSnapshot = {
      characters,
      ctf: this.ctf,
      timeRemaining: this.gameTimeRemaining,
      controlPoints: this.controlPoints,
      orderQueues,
      domScore1: this.domScore1,
      domScore2: this.domScore2,
    };
    if (this.gameOver) {
      snapshot.gameOver = true;
    }
    this.firebase.pushSyncState(this.gameId, snapshot).catch(err => {
      console.error('[Sync] Failed to push state:', err);
    });
  }

  private applyRemoteOrders(playerId: string, orders: RemoteOrderPayload[]) {
    const affectedChars = new Set<string>();
    for (const o of orders) {
      const char = this.charData.get(o.characterId);
      if (!char || char.isDead || char.owner !== playerId) continue;

      if (o.queued) {
        const queue = this.orderQueues.get(char.id);
        if (queue && queue.length < 3) queue.push(o.order);
      } else {
        char.currentOrder = o.order;
        char.path = [];
        const q = this.orderQueues.get(char.id);
        if (q) q.length = 0;
      }
      affectedChars.add(char.id);
    }

    // Update visuals
    for (const id of affectedChars) {
      const char = this.charData.get(id);
      const entity = this.characters.get(id);
      if (entity && char?.currentOrder) {
        const queueLen = this.orderQueues.get(id)?.length || 0;
        const label = this.getOrderLabel(char.currentOrder) + (queueLen > 0 ? ' (+' + queueLen + ')' : '');
        entity.setOrderText(label);
      }
    }
    this.addCommandLog('Opponent', 'issued orders', 'success');
  }

  private applySyncState(state: SyncSnapshot) {
    // Check for game over from host
    if (state.gameOver && state.winner) {
      this.endGame(state.winner, state.winReason || 'unknown');
      return;
    }

    // Update characters
    for (const [id, charState] of Object.entries(state.characters)) {
      const prev = this.charData.get(id);
      this.charData.set(id, charState);

      const entity = this.characters.get(id);
      if (!entity) continue;

      // Update name (host may have different generated names)
      entity.updateFromState(charState);
      entity.updateEffectAuras(charState.effects);

      // Animate position changes
      const prevPos = prev?.position;
      if (prevPos && (prevPos.x !== charState.position.x || prevPos.y !== charState.position.y)) {
        entity.data.position = charState.position;
        if (!entity.isMoving) {
          entity.stepToTile(charState.position.x, charState.position.y);
        }
      } else {
        entity.snapToPosition();
      }

      // Order text
      if (charState.currentOrder) {
        entity.setOrderText(this.getOrderLabel(charState.currentOrder));
      } else {
        entity.setOrderText('idle');
      }

      // Respawn visuals
      if (charState.isDead) {
        entity.showRespawning(charState.respawnTimer ?? 0);
      } else if (prev?.isDead && !charState.isDead) {
        entity.hideRespawn();
      }

      // Flag carrier
      entity.showFlagCarrier(!!charState.hasFlag);
    }

    // Update order queues
    if (state.orderQueues) {
      for (const [id, queue] of Object.entries(state.orderQueues)) {
        this.orderQueues.set(id, [...queue]);
      }
    }

    // Update domination scores from server state
    if (state.ctf) {
      this.ctf = state.ctf;
    }

    // Update timer
    if (state.timeRemaining !== undefined) {
      this.gameTimeRemaining = state.timeRemaining;
      this.updateTimerDisplay();
    }

    // Update control points
    if (state.controlPoints) {
      this.controlPoints = state.controlPoints;
    }

    // Update domination scores
    if (state.domScore1 !== undefined) this.domScore1 = state.domScore1;
    if (state.domScore2 !== undefined) this.domScore2 = state.domScore2;

    // Update visuals
    this.updateScoreDisplay();
    this.updateFogOfWar();
    this.updateMiniMap();
    this.updateStatusBar();
    this.updateAbilityPanel();
    this.renderPaths();
  }


}
