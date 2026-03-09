import Phaser from 'phaser';

// ═══════════════════════════════════════════════════════════════
// GEMINI INTEGRATION
// ═══════════════════════════════════════════════════════════════

const GEMINI_API_KEY = (import.meta as any).env?.VITE_GEMINI_API_KEY || '';
const GEMINI_MODEL = 'gemini-2.0-flash';
const GEMINI_URL = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=`;

interface HordeCommand {
  subject: string; // animal type or "all"
  targetType: 'camp' | 'nexus' | 'base' | 'position' | 'defend';
  targetAnimal?: string; // for camp targets
  campIndex?: number; // specific camp index if known
  narration?: string;
}

async function parseWithGemini(
  rawText: string,
  myUnits: { type: string; count: number }[],
  camps: { name: string; animalType: string; owner: string; index: number }[],
  gameTime: number,
): Promise<HordeCommand[] | null> {
  if (!GEMINI_API_KEY) return null;

  const unitList = myUnits.map(u => `  ${u.type}: ${u.count} units`).join('\n');
  const campList = camps.map(c =>
    `  [${c.index}] ${c.name} (${c.animalType}) - ${c.owner}`
  ).join('\n');

  const prompt = `You are the command parser for "Horde Capture", an RTS where the player controls hordes of animals.
The player has these animal armies:
${unitList || '  (no units yet)'}

Available camps on the map:
${campList}

Game time: ${Math.floor(gameTime / 1000)}s

The player can:
- Send a specific animal horde (bunnies, wolves, bears, lions, dragons) or "all" to a target
- Targets: a camp (by animal type or name), the enemy "nexus", their own "base", or "center"
- Commands like "capture", "attack", "go to", "take", "defend", "retreat"
- The player can give MULTIPLE commands in one sentence using "and", "then", "while", commas, etc.
  Examples: "bunnies attack wolf camp and lions go to nexus", "send wolves to bear camp, dragons attack nexus"

PLAYER COMMAND: "${rawText}"

Respond with ONLY a valid JSON ARRAY of commands (no markdown). Each command is an object.
Even for a single command, return an array with one element.
[
  {
    "subject": "<animal type like bunny/wolf/bear/lion/dragon, or all>",
    "targetType": "<camp|nexus|base|position|defend>",
    "targetAnimal": "<animal type of the target camp, if targeting a camp>",
    "campIndex": <index number of specific camp if mentioned by name, or -1>,
    "narration": "<One short dramatic sentence about the order>"
  }
]`;

  try {
    const response = await fetch(GEMINI_URL + GEMINI_API_KEY, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: {
          maxOutputTokens: 256,
          responseMimeType: 'application/json',
        },
      }),
    });

    if (!response.ok) {
      console.warn('Gemini API error:', response.status);
      return null;
    }

    const data = await response.json();
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!text) return null;

    const parsed = JSON.parse(text);
    // Accept both array and single object for backwards compat
    if (Array.isArray(parsed)) return parsed as HordeCommand[];
    return [parsed] as HordeCommand[];
  } catch (err) {
    console.warn('Gemini parse failed, falling back to local:', err);
    return null;
  }
}

// ═══════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════

interface AnimalDef {
  type: string;
  emoji: string;
  hp: number;
  attack: number;
  speed: number; // pixels per second
  tier: number;
}

interface HUnit {
  id: number;
  type: string;
  team: 0 | 1 | 2; // 0 = neutral camp defender
  hp: number;
  maxHp: number;
  attack: number;
  speed: number;
  x: number;
  y: number;
  targetX: number;
  targetY: number;
  attackTimer: number;
  sprite: Phaser.GameObjects.Text | null;
  dead: boolean;
  campId: string | null; // if this unit is a camp defender, which camp
  lungeX: number; // sprite offset during attack lunge
  lungeY: number;
}

interface CampDef {
  id: string;
  name: string;
  type: string;
  x: number;
  y: number;
  guards: number;
  spawnMs: number;
  buff: { stat: string; value: number };
}

interface HCamp {
  id: string;
  name: string;
  animalType: string;
  tier: number;
  guardCount: number; // how many defenders to spawn
  x: number;
  y: number;
  owner: 0 | 1 | 2;
  spawnMs: number;
  spawnTimer: number;
  buff: { stat: string; value: number };
  label: Phaser.GameObjects.Text | null;
  area: Phaser.GameObjects.Arc | null;
  captureBar: Phaser.GameObjects.Graphics | null;
}

interface HNexus {
  team: 1 | 2;
  x: number;
  y: number;
  hp: number;
  maxHp: number;
  container: Phaser.GameObjects.Container | null;
  hpBar: Phaser.GameObjects.Graphics | null;
  hpText: Phaser.GameObjects.Text | null;
}

// ═══════════════════════════════════════════════════════════════
// CONSTANTS
// ═══════════════════════════════════════════════════════════════

const WORLD_W = 3200;
const WORLD_H = 3200;
const P1_BASE = { x: 250, y: WORLD_H - 250 };
const P2_BASE = { x: WORLD_W - 250, y: 250 };

// Each tier is ~10x stronger than the previous
// 1 wolf ≈ 10 bunnies, 1 bear ≈ 10 wolves, 1 lion ≈ 10 bears, 1 dragon ≈ 10 lions
const ANIMALS: Record<string, AnimalDef> = {
  bunny:  { type: 'bunny',  emoji: '🐰', hp: 20,    attack: 4,    speed: 160, tier: 1 },
  wolf:   { type: 'wolf',   emoji: '🐺', hp: 120,   attack: 15,   speed: 140, tier: 2 },
  bear:   { type: 'bear',   emoji: '🐻', hp: 600,   attack: 50,   speed: 100, tier: 3 },
  lion:   { type: 'lion',   emoji: '🦁', hp: 2000,  attack: 150,  speed: 120, tier: 4 },
  dragon: { type: 'dragon', emoji: '🐉', hp: 8000,  attack: 500,  speed: 80,  tier: 5 },
};

// Generate camps in concentric arcs from each nexus corner
function makeCamps(): CampDef[] {
  const camps: CampDef[] = [];
  let idx = 0;

  const bases = [
    { bx: P1_BASE.x, by: P1_BASE.y, centerAngle: -Math.PI / 4, side: 'A' },
    { bx: P2_BASE.x, by: P2_BASE.y, centerAngle: 3 * Math.PI / 4, side: 'B' },
  ];

  for (const { bx, by, centerAngle, side } of bases) {
    // Ring 1: 2 bunny camps
    for (let i = 0; i < 2; i++) {
      const a = centerAngle + (i - 0.5) * 0.5;
      camps.push({
        id: `bunny_${side}_${i}`, name: `🐰 Bunny Camp ${++idx}`,
        type: 'bunny', x: bx + Math.cos(a) * 350, y: by + Math.sin(a) * 350,
        guards: 3, spawnMs: 4000, buff: { stat: 'speed', value: 0.05 },
      });
    }

    // Ring 2: 5 random camps
    const ring2Types = ['wolf', 'bear', 'wolf', 'wolf', 'bear'];
    for (let i = 0; i < 5; i++) {
      const a = centerAngle + (i - 2) * 0.35;
      const t = ring2Types[i];
      const def = ANIMALS[t];
      camps.push({
        id: `${t}_${side}_${i}`, name: `${def.emoji} ${cap(t)} Camp ${++idx}`,
        type: t, x: bx + Math.cos(a) * 750, y: by + Math.sin(a) * 750,
        guards: t === 'wolf' ? 3 : 2, spawnMs: t === 'wolf' ? 6000 : 7500,
        buff: { stat: t === 'wolf' ? 'attack' : 'hp', value: t === 'wolf' ? 0.08 : 0.10 },
      });
    }

    // Ring 3: 3 hard camps
    const ring3Types = ['lion', 'lion', 'bear'];
    for (let i = 0; i < 3; i++) {
      const a = centerAngle + (i - 1) * 0.45;
      const t = ring3Types[i];
      const def = ANIMALS[t];
      camps.push({
        id: `${t}_${side}_r3_${i}`, name: `${def.emoji} ${cap(t)} Camp ${++idx}`,
        type: t, x: bx + Math.cos(a) * 1100, y: by + Math.sin(a) * 1100,
        guards: t === 'lion' ? 2 : 3, spawnMs: t === 'lion' ? 10000 : 7500,
        buff: { stat: 'attack', value: t === 'lion' ? 0.12 : 0.10 },
      });
    }
  }

  // Center dragon camp
  camps.push({
    id: 'dragon_center', name: "🐉 Dragon's Lair",
    type: 'dragon', x: WORLD_W / 2, y: WORLD_H / 2,
    guards: 1, spawnMs: 15000, buff: { stat: 'all', value: 0.15 },
  });

  return camps;
}

function cap(s: string) { return s[0].toUpperCase() + s.slice(1); }

const CAMP_DEFS = makeCamps();
const NEXUS_MAX_HP = 50000;
const MAX_UNITS = 80;
const BASE_SPAWN_MS = 5000;
const ATTACK_CD_MS = 1500;
const COMBAT_RANGE = 80;
const CAMP_RANGE = 120;
const AI_TICK_MS = 4000;
const TEAM_COLORS = { 1: 0x4499FF, 2: 0xFF5555 };
const GOLDEN_ANGLE = 2.39996;

function pdist(a: { x: number; y: number }, b: { x: number; y: number }): number {
  const dx = a.x - b.x, dy = a.y - b.y;
  return Math.sqrt(dx * dx + dy * dy);
}

// ═══════════════════════════════════════════════════════════════
// SCENE
// ═══════════════════════════════════════════════════════════════

export class HordeScene extends Phaser.Scene {
  private units: HUnit[] = [];
  private camps: HCamp[] = [];
  private nexuses: HNexus[] = [];
  private nextId = 0;
  private gameTime = 0;
  private gameOver = false;
  private winner: 1 | 2 | null = null;

  private baseSpawnTimers = { 1: 0, 2: 0 };
  private aiTimer = 0;

  private hudTexts: Record<string, Phaser.GameObjects.Text> = {};
  private textInput: HTMLInputElement | null = null;
  private voiceStatusEl: HTMLDivElement | null = null;
  private transcriptEl: HTMLSpanElement | null = null;

  private wasdKeys!: Record<string, Phaser.Input.Keyboard.Key>;
  private spaceKey!: Phaser.Input.Keyboard.Key;
  private recognition: any = null;
  private isListening = false;

  private isDragging = false;
  private dragPrevX = 0;
  private dragPrevY = 0;

  // Persistent rally points: key = "type_team", value = {x, y}
  // When you command "bunnies attack wolf camp", ALL future bunnies also go there
  private rallyPoints: Record<string, { x: number; y: number }> = {};

  constructor() {
    super({ key: 'HordeScene' });
  }

  create() {
    this.units = [];
    this.camps = [];
    this.nexuses = [];
    this.nextId = 0;
    this.gameTime = 0;
    this.gameOver = false;
    this.winner = null;
    this.baseSpawnTimers = { 1: 0, 2: 0 };
    this.aiTimer = 0;
    this.hudTexts = {};
    this.rallyPoints = {};

    this.cameras.main.setBackgroundColor('#0d1a0d');
    this.drawBackground();
    this.setupCamps();
    this.setupNexuses();
    this.setupCamera();
    this.setupInput();
    this.setupHUD();
    this.events.on('shutdown', () => this.cleanupHTML());

    // Starting bunnies
    for (let i = 0; i < 3; i++) {
      this.spawnUnit('bunny', 1, P1_BASE.x + 50 + i * 20, P1_BASE.y - 50);
      this.spawnUnit('bunny', 2, P2_BASE.x - 50 - i * 20, P2_BASE.y + 50);
    }
  }

  // ─── BACKGROUND ──────────────────────────────────────────────

  private drawBackground() {
    const g = this.add.graphics();

    // Faint concentric rings from each nexus
    for (const [base, color] of [[P1_BASE, 0x4499FF], [P2_BASE, 0xFF5555]] as const) {
      for (const r of [350, 750, 1100]) {
        g.lineStyle(1, color as number, 0.08);
        g.strokeCircle(base.x, base.y, r);
      }
    }

    // Diagonal lane
    g.lineStyle(2, 0xffffff, 0.04);
    g.lineBetween(P1_BASE.x, P1_BASE.y, P2_BASE.x, P2_BASE.y);

    // Subtle grid
    g.lineStyle(1, 0xffffff, 0.015);
    for (let x = 0; x < WORLD_W; x += 200) g.lineBetween(x, 0, x, WORLD_H);
    for (let y = 0; y < WORLD_H; y += 200) g.lineBetween(0, y, WORLD_W, y);
  }

  // ─── CAMPS ───────────────────────────────────────────────────

  private setupCamps() {
    for (const def of CAMP_DEFS) {
      const animalDef = ANIMALS[def.type];

      const area = this.add.circle(def.x, def.y, CAMP_RANGE, 0xFFD93D, 0.06);
      area.setStrokeStyle(2, 0xFFD93D, 0.25);

      const label = this.add.text(def.x, def.y - 50, def.name, {
        fontSize: '14px', color: '#FFD93D', fontFamily: '"Nunito", sans-serif', fontStyle: 'bold',
        stroke: '#000000', strokeThickness: 3,
      }).setOrigin(0.5).setDepth(5);

      const captureBar = this.add.graphics().setDepth(6);

      const camp: HCamp = {
        id: def.id, name: def.name, animalType: def.type, tier: animalDef.tier,
        guardCount: def.guards,
        x: def.x, y: def.y, owner: 0,
        spawnMs: def.spawnMs, spawnTimer: 0, buff: def.buff,
        label, area, captureBar,
      };
      this.camps.push(camp);

      // Spawn real neutral defender units around the camp
      this.spawnCampDefenders(camp);
    }
  }

  private spawnCampDefenders(camp: HCamp) {
    const def = ANIMALS[camp.animalType];
    for (let i = 0; i < camp.guardCount; i++) {
      const angle = (i / camp.guardCount) * Math.PI * 2;
      const gx = camp.x + Math.cos(angle) * 50;
      const gy = camp.y + Math.sin(angle) * 50;
      // Neutral defenders wander near their camp
      const wanderAngle = Math.random() * Math.PI * 2;
      const wanderR = 20 + Math.random() * 40;
      const speedVar = 0.85 + Math.random() * 0.3;
      this.units.push({
        id: this.nextId++, type: camp.animalType, team: 0,
        hp: def.hp * 1.5, maxHp: def.hp * 1.5,
        attack: def.attack * 1.2, speed: def.speed * 0.5 * speedVar,
        x: gx, y: gy,
        targetX: camp.x + Math.cos(wanderAngle) * wanderR,
        targetY: camp.y + Math.sin(wanderAngle) * wanderR,
        attackTimer: 0, sprite: null, dead: false,
        campId: camp.id, lungeX: 0, lungeY: 0,
      });
    }
  }

  // ─── NEXUSES ─────────────────────────────────────────────────

  private setupNexuses() {
    for (const team of [1, 2] as const) {
      const base = team === 1 ? P1_BASE : P2_BASE;
      const c = this.add.container(base.x, base.y).setDepth(8);
      c.add(this.add.circle(0, 0, 50, TEAM_COLORS[team], 0.15));
      c.add(this.add.circle(0, 0, 35, TEAM_COLORS[team], 0.3));
      c.add(this.add.text(0, -5, '👑', { fontSize: '36px' }).setOrigin(0.5));
      c.add(this.add.text(0, -55, team === 1 ? 'YOUR NEXUS' : 'ENEMY NEXUS', {
        fontSize: '14px', color: team === 1 ? '#4499FF' : '#FF5555',
        fontFamily: '"Fredoka", sans-serif', fontStyle: 'bold',
        stroke: '#000', strokeThickness: 3,
      }).setOrigin(0.5));

      this.nexuses.push({
        team, x: base.x, y: base.y,
        hp: NEXUS_MAX_HP, maxHp: NEXUS_MAX_HP,
        container: c,
        hpBar: this.add.graphics().setDepth(9),
        hpText: this.add.text(base.x, base.y + 50, `${NEXUS_MAX_HP}/${NEXUS_MAX_HP}`, {
          fontSize: '12px', color: '#f0e8ff', fontFamily: '"Nunito", sans-serif',
          fontStyle: 'bold', stroke: '#000', strokeThickness: 2,
        }).setOrigin(0.5).setDepth(9),
      });
    }
    this.drawNexusBars();
  }

  private drawNexusBars() {
    for (const n of this.nexuses) {
      const g = n.hpBar!;
      g.clear();
      const pct = Math.max(0, n.hp / n.maxHp);
      const w = 80, h = 8;
      g.fillStyle(0x000000, 0.6);
      g.fillRoundedRect(n.x - w / 2, n.y + 38, w, h, 4);
      g.fillStyle(pct > 0.5 ? 0x45E6B0 : pct > 0.25 ? 0xFFD93D : 0xFF5555);
      g.fillRoundedRect(n.x - w / 2, n.y + 38, w * pct, h, 4);
      n.hpText!.setText(`${Math.max(0, Math.ceil(n.hp))}/${n.maxHp}`);
    }
  }

  // ─── CAMERA ──────────────────────────────────────────────────

  private setupCamera() {
    const cam = this.cameras.main;
    cam.setBounds(0, 0, WORLD_W, WORLD_H);
    cam.centerOn(P1_BASE.x + 400, P1_BASE.y - 400);
    cam.setZoom(0.7);
    this.input.on('wheel', (_ptr: any, _over: any, _dx: number, deltaY: number) => {
      cam.zoom = Phaser.Math.Clamp(cam.zoom + (deltaY > 0 ? -0.05 : 0.05), 0.2, 2.0);
    });

    // Drag to pan
    this.input.on('pointerdown', (ptr: Phaser.Input.Pointer) => {
      if (ptr.rightButtonDown() || ptr.middleButtonDown() || ptr.leftButtonDown()) {
        this.isDragging = true;
        this.dragPrevX = ptr.x;
        this.dragPrevY = ptr.y;
      }
    });
    this.input.on('pointermove', (ptr: Phaser.Input.Pointer) => {
      if (!this.isDragging) return;
      const dx = ptr.x - this.dragPrevX;
      const dy = ptr.y - this.dragPrevY;
      cam.scrollX -= dx / cam.zoom;
      cam.scrollY -= dy / cam.zoom;
      this.dragPrevX = ptr.x;
      this.dragPrevY = ptr.y;
    });
    this.input.on('pointerup', () => { this.isDragging = false; });
  }

  private updateCamera(dt: number) {
    const cam = this.cameras.main;
    const s = 800 * dt / cam.zoom;
    if (this.wasdKeys['W'].isDown) cam.scrollY -= s;
    if (this.wasdKeys['S'].isDown) cam.scrollY += s;
    if (this.wasdKeys['A'].isDown) cam.scrollX -= s;
    if (this.wasdKeys['D'].isDown) cam.scrollX += s;
  }

  // ─── INPUT ───────────────────────────────────────────────────

  private setupInput() {
    this.wasdKeys = {
      W: this.input.keyboard!.addKey('W'),
      A: this.input.keyboard!.addKey('A'),
      S: this.input.keyboard!.addKey('S'),
      D: this.input.keyboard!.addKey('D'),
    };
    this.spaceKey = this.input.keyboard!.addKey('SPACE');

    const input = document.createElement('input');
    input.id = 'horde-cmd-input';
    input.type = 'text';
    input.placeholder = 'Type command... (e.g. "bunnies attack wolf camp")';
    input.style.cssText = `
      position:absolute;bottom:20px;left:50%;transform:translateX(-50%);
      width:520px;padding:10px 18px;font-size:15px;
      background:rgba(13,26,13,0.95);color:#f0e8ff;
      border:2px solid #45E6B0;border-radius:14px;outline:none;z-index:100;
      font-family:'Nunito',sans-serif;font-weight:600;
    `;
    input.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter' && input.value.trim()) {
        this.handleCommand(input.value.trim(), 1);
        input.value = '';
      }
    });
    input.addEventListener('focus', () => { this.input.keyboard!.enabled = false; });
    input.addEventListener('blur', () => { this.input.keyboard!.enabled = true; });
    document.getElementById('game-container')!.appendChild(input);
    this.textInput = input;

    const voiceDiv = document.createElement('div');
    voiceDiv.id = 'horde-voice-status';
    voiceDiv.style.cssText = `
      position:absolute;bottom:70px;left:50%;transform:translateX(-50%);
      padding:8px 18px;background:rgba(13,26,13,0.9);border:2px solid #3D5040;
      border-radius:12px;z-index:100;font-family:'Nunito',sans-serif;
      font-size:13px;color:#8BAA8B;font-weight:600;display:flex;align-items:center;gap:8px;
    `;
    const voiceLabel = document.createElement('span');
    voiceLabel.textContent = '🎤 Hold SPACE to speak';
    const transcript = document.createElement('span');
    transcript.style.cssText = 'color:#FFD93D;max-width:300px;';
    voiceDiv.appendChild(voiceLabel);
    voiceDiv.appendChild(transcript);
    document.getElementById('game-container')!.appendChild(voiceDiv);
    this.voiceStatusEl = voiceDiv;
    this.transcriptEl = transcript;

    this.setupVoice(voiceLabel);
    this.spaceKey.on('down', () => this.startListening());
    this.spaceKey.on('up', () => this.stopListening());
  }

  private setupVoice(label: HTMLSpanElement) {
    const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SR) { label.textContent = 'No speech support'; return; }
    const rec = new SR();
    rec.continuous = false;
    rec.interimResults = true;
    rec.lang = 'en-US';
    rec.onresult = (e: any) => {
      let text = '';
      for (let i = 0; i < e.results.length; i++) text += e.results[i][0].transcript;
      if (this.transcriptEl) this.transcriptEl.textContent = text;
      if (e.results[e.results.length - 1].isFinal && text.trim()) {
        this.handleCommand(text.trim(), 1);
        this.stopListening();
      }
    };
    rec.onerror = () => this.stopListening();
    rec.onend = () => this.stopListening();
    this.recognition = rec;
  }

  private startListening() {
    if (this.isListening || !this.recognition || document.activeElement === this.textInput) return;
    this.isListening = true;
    if (this.voiceStatusEl) this.voiceStatusEl.style.borderColor = '#FF6B6B';
    if (this.transcriptEl) this.transcriptEl.textContent = '';
    try { this.recognition.start(); } catch (_e) { /* */ }
  }

  private stopListening() {
    if (!this.isListening) return;
    this.isListening = false;
    if (this.voiceStatusEl) this.voiceStatusEl.style.borderColor = '#3D5040';
    try { this.recognition?.stop(); } catch (_e) { /* */ }
    setTimeout(() => { if (!this.isListening && this.transcriptEl) this.transcriptEl.textContent = ''; }, 3000);
  }

  // ─── HUD ─────────────────────────────────────────────────────

  private setupHUD() {
    const cam = this.cameras.main;

    // Left panel background
    this.add.rectangle(0, 0, 260, cam.height, 0x000000, 0.45)
      .setOrigin(0, 0).setScrollFactor(0).setDepth(99);

    this.hudTexts['title'] = this.add.text(16, 12, 'HORDE CAPTURE', {
      fontSize: '18px', color: '#45E6B0', fontFamily: '"Fredoka", sans-serif', fontStyle: 'bold',
    }).setScrollFactor(0).setDepth(100);

    this.hudTexts['timer'] = this.add.text(130, 14, '0:00', {
      fontSize: '14px', color: '#FFD93D', fontFamily: '"Fredoka", sans-serif', fontStyle: 'bold',
    }).setOrigin(0, 0).setScrollFactor(0).setDepth(100);

    // Army section
    this.hudTexts['armyHeader'] = this.add.text(16, 44, 'YOUR ARMIES', {
      fontSize: '13px', color: '#4499FF', fontFamily: '"Fredoka", sans-serif', fontStyle: 'bold',
      letterSpacing: 1,
    }).setScrollFactor(0).setDepth(100);

    this.hudTexts['armies'] = this.add.text(16, 64, '', {
      fontSize: '12px', color: '#f0e8ff', fontFamily: '"Nunito", sans-serif', fontStyle: 'bold', lineSpacing: 5,
    }).setScrollFactor(0).setDepth(100);

    // Production section
    this.hudTexts['prodHeader'] = this.add.text(16, 220, 'PRODUCTION', {
      fontSize: '13px', color: '#C98FFF', fontFamily: '"Fredoka", sans-serif', fontStyle: 'bold',
      letterSpacing: 1,
    }).setScrollFactor(0).setDepth(100);

    this.hudTexts['production'] = this.add.text(16, 240, '', {
      fontSize: '12px', color: '#cbb8ee', fontFamily: '"Nunito", sans-serif', fontStyle: '600', lineSpacing: 4,
    }).setScrollFactor(0).setDepth(100);

    // Camps section
    this.hudTexts['campsHeader'] = this.add.text(16, 340, 'CAMPS', {
      fontSize: '13px', color: '#FFD93D', fontFamily: '"Fredoka", sans-serif', fontStyle: 'bold',
      letterSpacing: 1,
    }).setScrollFactor(0).setDepth(100);

    this.hudTexts['camps'] = this.add.text(16, 360, '', {
      fontSize: '11px', color: '#f0e8ff', fontFamily: '"Nunito", sans-serif', fontStyle: '600', lineSpacing: 3,
    }).setScrollFactor(0).setDepth(100);

    // Buffs
    this.hudTexts['buffs'] = this.add.text(16, cam.height - 80, '', {
      fontSize: '11px', color: '#C98FFF', fontFamily: '"Nunito", sans-serif', fontStyle: '600', lineSpacing: 2,
    }).setScrollFactor(0).setDepth(100);

    // Right side: enemy info
    this.add.rectangle(cam.width, 0, 220, 160, 0x000000, 0.35)
      .setOrigin(1, 0).setScrollFactor(0).setDepth(99);

    this.hudTexts['enemyHeader'] = this.add.text(cam.width - 16, 12, 'ENEMY', {
      fontSize: '13px', color: '#FF5555', fontFamily: '"Fredoka", sans-serif', fontStyle: 'bold',
      letterSpacing: 1,
    }).setOrigin(1, 0).setScrollFactor(0).setDepth(100);

    this.hudTexts['enemy'] = this.add.text(cam.width - 16, 32, '', {
      fontSize: '12px', color: '#ffcccc', fontFamily: '"Nunito", sans-serif', fontStyle: '600',
      lineSpacing: 4, align: 'right',
    }).setOrigin(1, 0).setScrollFactor(0).setDepth(100);

    // Feedback (center bottom)
    this.hudTexts['feedback'] = this.add.text(cam.width / 2, cam.height - 115, '', {
      fontSize: '16px', color: '#45E6B0', fontFamily: '"Nunito", sans-serif', fontStyle: 'bold',
    }).setOrigin(0.5).setScrollFactor(0).setDepth(100).setAlpha(0);

    // Help hint (bottom right)
    this.hudTexts['help'] = this.add.text(cam.width - 16, cam.height - 100, [
      'Drag: Pan  |  Scroll: Zoom  |  WASD: Pan',
      'SPACE: Voice  |  Type below: Text',
      '',
      '"bunnies attack wolf camp"',
      '"all attack nexus"',
      '"bunnies attack wolf camp and lions go to nexus"',
      '"wolves defend base, dragons attack center"',
    ].join('\n'), {
      fontSize: '10px', color: '#4A6B4A', fontFamily: '"Nunito", sans-serif', lineSpacing: 2, align: 'right',
    }).setOrigin(1, 1).setScrollFactor(0).setDepth(100);
  }

  private updateHUD() {
    const p1 = this.units.filter(u => u.team === 1 && !u.dead);
    const p2 = this.units.filter(u => u.team === 2 && !u.dead);
    const countBy = (us: HUnit[]) => {
      const c: Record<string, number> = {};
      for (const u of us) c[u.type] = (c[u.type] || 0) + 1;
      return c;
    };
    const p1c = countBy(p1), p2c = countBy(p2);

    // Timer
    const secs = Math.floor(this.gameTime / 1000);
    this.hudTexts['timer']?.setText(`${Math.floor(secs / 60)}:${(secs % 60).toString().padStart(2, '0')}`);

    // ─── YOUR ARMIES (left panel) ───
    const armyLines: string[] = [];
    armyLines.push(`Total: ${p1.length}/${MAX_UNITS}`);
    for (const [type, def] of Object.entries(ANIMALS)) {
      const count = p1c[type] || 0;
      if (count === 0) continue;
      armyLines.push(`${def.emoji} ${cap(type)}:  ${count} units`);
    }
    if (armyLines.length === 1) armyLines.push('  (no units yet)');
    this.hudTexts['armies']?.setText(armyLines.join('\n'));

    // ─── PRODUCTION RATES ───
    // Base always produces 1 bunny / 10s
    const prodLines: string[] = [];
    const prodRates: Record<string, number> = {};
    // Base production
    prodRates['bunny'] = (prodRates['bunny'] || 0) + 60 / (BASE_SPAWN_MS / 1000);
    // Camp production
    const myCamps = this.camps.filter(c => c.owner === 1);
    for (const c of myCamps) {
      prodRates[c.animalType] = (prodRates[c.animalType] || 0) + 60 / (c.spawnMs / 1000);
    }
    for (const [type, rate] of Object.entries(prodRates)) {
      const def = ANIMALS[type];
      if (!def) continue;
      prodLines.push(`${def.emoji} ${cap(type)}: ${rate.toFixed(1)}/min`);
    }
    if (prodLines.length === 0) prodLines.push('  Base: 🐰 6/min');
    this.hudTexts['production']?.setText(prodLines.join('\n'));

    // ─── CAMPS ───
    const yourCamps = this.camps.filter(c => c.owner === 1).length;
    const enemyCamps = this.camps.filter(c => c.owner === 2).length;
    const neutralCamps = this.camps.filter(c => c.owner === 0).length;
    const campLines: string[] = [];
    campLines.push(`🔵 Yours: ${yourCamps}  🔴 Enemy: ${enemyCamps}  ⚪ Neutral: ${neutralCamps}`);
    campLines.push('');
    for (const c of this.camps) {
      const icon = c.owner === 0 ? '⚪' : c.owner === 1 ? '🔵' : '🔴';
      const tag = c.owner === 1 ? ' (YOU)' : c.owner === 2 ? ' (ENEMY)' : '';
      campLines.push(`${icon} ${c.name}${tag}`);
    }
    this.hudTexts['camps']?.setText(campLines.join('\n'));

    // ─── BUFFS ───
    const b = this.getBuffs(1);
    const bl: string[] = [];
    if (b.speed > 0) bl.push(`⚡ Speed +${Math.round(b.speed * 100)}%`);
    if (b.attack > 0) bl.push(`⚔ Attack +${Math.round(b.attack * 100)}%`);
    if (b.hp > 0) bl.push(`❤ HP +${Math.round(b.hp * 100)}%`);
    this.hudTexts['buffs']?.setText(bl.length ? `BUFFS:\n${bl.join('\n')}` : '');

    // ─── ENEMY (right panel) ───
    const enemyLines: string[] = [];
    enemyLines.push(`Total: ${p2.length}`);
    for (const [type, def] of Object.entries(ANIMALS)) {
      const count = p2c[type] || 0;
      if (count === 0) continue;
      enemyLines.push(`${def.emoji} ${cap(type)}: ${count}`);
    }
    enemyLines.push(`Camps: ${enemyCamps}`);
    this.hudTexts['enemy']?.setText(enemyLines.join('\n'));
  }

  // ─── MAIN UPDATE ────────────────────────────────────────────

  update(_time: number, delta: number) {
    if (this.gameOver) return;
    const dt = delta / 1000;
    this.gameTime += delta;
    this.updateCamera(dt);
    this.updateSpawning(delta);
    this.updateMovement(dt);
    this.updateCombat(delta);
    this.updateCampCapture();
    this.updateAI(delta);
    this.cleanupDead();
    this.updateUnitSprites();
    this.updateCampVisuals();
    this.drawNexusBars();
    this.updateHUD();
    this.checkWin();
  }

  // ─── SPAWNING ────────────────────────────────────────────────

  private updateSpawning(delta: number) {
    for (const team of [1, 2] as const) {
      if (this.units.filter(u => u.team === team && !u.dead).length >= MAX_UNITS) continue;
      this.baseSpawnTimers[team] += delta;
      if (this.baseSpawnTimers[team] >= BASE_SPAWN_MS) {
        this.baseSpawnTimers[team] -= BASE_SPAWN_MS;
        const b = team === 1 ? P1_BASE : P2_BASE;
        this.spawnUnit('bunny', team, b.x + (team === 1 ? 60 : -60), b.y + (team === 1 ? -30 : 30));
      }
    }

    for (const camp of this.camps) {
      if (camp.owner === 0) continue;
      if (this.units.filter(u => u.team === camp.owner && !u.dead).length >= MAX_UNITS) continue;
      camp.spawnTimer += delta;
      if (camp.spawnTimer >= camp.spawnMs) {
        camp.spawnTimer -= camp.spawnMs;
        this.spawnUnit(camp.animalType, camp.owner as 1 | 2, camp.x + 20, camp.y + 30);
      }
    }
  }

  // ─── MOVEMENT (horde flocking) ─────────────────────────────

  private updateMovement(dt: number) {
    // Build spatial groups: same type + same team = one horde
    const hordes = new Map<string, HUnit[]>();
    for (const u of this.units) {
      if (u.dead) continue;
      const k = `${u.type}_${u.team}`;
      if (!hordes.has(k)) hordes.set(k, []);
      hordes.get(k)!.push(u);
    }

    // Precompute horde centers
    const hordeCenters = new Map<string, { cx: number; cy: number; count: number }>();
    for (const [k, group] of hordes) {
      let sx = 0, sy = 0;
      for (const u of group) { sx += u.x; sy += u.y; }
      hordeCenters.set(k, { cx: sx / group.length, cy: sy / group.length, count: group.length });
    }

    // Flocking strengths by tier — low tier = tight horde, high tier = more independent
    const COHESION_BY_TIER: Record<number, number> = { 1: 0.7, 2: 0.45, 3: 0.25, 4: 0.15, 5: 0.08 };
    const SEPARATION_DIST = 22; // min distance before pushing apart
    const SEPARATION_FORCE = 60; // push-apart strength

    for (const u of this.units) {
      if (u.dead) continue;

      // Base: move toward target
      const dx = u.targetX - u.x, dy = u.targetY - u.y;
      const d = Math.sqrt(dx * dx + dy * dy);
      if (d < 5) continue; // already there

      const buffMult = u.team !== 0 ? (1 + this.getBuffs(u.team as 1 | 2).speed) : 1;
      const spd = u.speed * buffMult;
      let moveX = (dx / d) * spd;
      let moveY = (dy / d) * spd;

      // Cohesion: steer toward horde center (skip neutral defenders)
      if (u.team !== 0) {
        const k = `${u.type}_${u.team}`;
        const center = hordeCenters.get(k);
        if (center && center.count > 1) {
          const tier = ANIMALS[u.type]?.tier || 1;
          const cohesion = COHESION_BY_TIER[tier] ?? 0.3;
          const cdx = center.cx - u.x, cdy = center.cy - u.y;
          const cd = Math.sqrt(cdx * cdx + cdy * cdy);
          if (cd > 10) {
            // Stronger pull when farther from group
            const pull = Math.min(cd * 0.02, 1.0) * cohesion * spd;
            moveX += (cdx / cd) * pull;
            moveY += (cdy / cd) * pull;
          }
        }
      }

      // Separation: avoid stacking on nearby same-team units
      const horde = hordes.get(`${u.type}_${u.team}`);
      if (horde && horde.length > 1) {
        let sepX = 0, sepY = 0;
        for (const o of horde) {
          if (o === u) continue;
          const ox = u.x - o.x, oy = u.y - o.y;
          const od = Math.sqrt(ox * ox + oy * oy);
          if (od < SEPARATION_DIST && od > 0.1) {
            const push = (SEPARATION_DIST - od) / SEPARATION_DIST;
            sepX += (ox / od) * push;
            sepY += (oy / od) * push;
          }
        }
        moveX += sepX * SEPARATION_FORCE;
        moveY += sepY * SEPARATION_FORCE;
      }

      // Apply movement (cap to speed)
      const moveD = Math.sqrt(moveX * moveX + moveY * moveY);
      const maxMove = spd * dt;
      if (moveD > 0) {
        const scale = Math.min(maxMove, moveD * dt) / moveD;
        u.x += moveX * scale;
        u.y += moveY * scale;
      }

      // Clamp to world bounds
      u.x = Math.max(0, Math.min(WORLD_W, u.x));
      u.y = Math.max(0, Math.min(WORLD_H, u.y));
    }
  }

  // ─── COMBAT ──────────────────────────────────────────────────

  private updateCombat(delta: number) {
    for (const u of this.units) {
      if (u.dead) continue;
      u.attackTimer -= delta;
      if (u.attackTimer > 0) continue;

      // Find closest enemy: team 0 attacks anyone, team 1/2 attack each other AND team 0
      let best: HUnit | null = null, bestD = Infinity;
      for (const o of this.units) {
        if (o.dead || o.team === u.team) continue;
        // Neutral (team 0) fights anyone; players fight neutrals + each other
        if (u.team === 0 && o.team === 0) continue;
        const d = pdist(u, o);
        if (d <= COMBAT_RANGE && d < bestD) { bestD = d; best = o; }
      }

      // Nexus attack (only player units)
      const nex = u.team !== 0 ? this.nexuses.find(n => n.team !== u.team) : null;
      const nexD = nex ? pdist(u, nex) : Infinity;

      if (best) {
        const buffMult = u.team !== 0 ? (1 + this.getBuffs(u.team as 1 | 2).attack) : 1;
        const atk = u.attack * buffMult;
        const uTier = ANIMALS[u.type]?.tier || 1;

        // Tier 3+ get cleave/splash: damage primary + nearby enemies
        const splashRadius = uTier >= 5 ? 60 : uTier >= 4 ? 50 : uTier >= 3 ? 40 : 0;
        const splashTargets: HUnit[] = [best];
        if (splashRadius > 0) {
          for (const o of this.units) {
            if (o === best || o.dead || o.team === u.team) continue;
            if (u.team === 0 && o.team === 0) continue;
            if (pdist(o, best) <= splashRadius) splashTargets.push(o);
          }
        }

        for (const target of splashTargets) {
          const dmg = target === best ? atk : atk * 0.5; // half damage for splash
          target.hp -= dmg;
          if (target.hp <= 0) target.dead = true;

          // Hit flash — kill old tweens first to prevent alpha stuck low
          if (target.sprite) {
            this.tweens.killTweensOf(target.sprite);
            target.sprite.setAlpha(1);
            this.tweens.add({
              targets: target.sprite, alpha: 0.4, duration: 80, yoyo: true,
              onComplete: () => { if (target.sprite) target.sprite.setAlpha(1); },
            });
          }
        }
        u.attackTimer = ATTACK_CD_MS;

        // Cute lunge toward target
        const ldx = best.x - u.x, ldy = best.y - u.y;
        const ld = Math.sqrt(ldx * ldx + ldy * ldy) || 1;
        const lungeAmt = Math.min(20, ld * 0.4);
        u.lungeX = (ldx / ld) * lungeAmt;
        u.lungeY = (ldy / ld) * lungeAmt;
        // Tween lunge back to zero
        this.tweens.add({
          targets: u, lungeX: 0, lungeY: 0,
          duration: 200, ease: 'Back.easeIn',
        });
      } else if (nex && nexD <= COMBAT_RANGE && u.team !== 0) {
        nex.hp -= u.attack * (1 + this.getBuffs(u.team as 1 | 2).attack);
        u.attackTimer = ATTACK_CD_MS;

        // Lunge toward nexus
        const ldx = nex.x - u.x, ldy = nex.y - u.y;
        const ld = Math.sqrt(ldx * ldx + ldy * ldy) || 1;
        const lungeAmt = Math.min(20, ld * 0.4);
        u.lungeX = (ldx / ld) * lungeAmt;
        u.lungeY = (ldy / ld) * lungeAmt;
        this.tweens.add({
          targets: u, lungeX: 0, lungeY: 0,
          duration: 200, ease: 'Back.easeIn',
        });
      }
    }
  }

  // ─── CAMP CAPTURE (real unit combat) ────────────────────────

  private updateCampCapture() {
    for (const camp of this.camps) {
      const defenders = this.units.filter(u => u.campId === camp.id && u.team === 0 && !u.dead);

      // Make neutral defenders wander slowly near their camp
      for (const d of defenders) {
        const distToCamp = pdist(d, camp);
        const distToTarget = pdist(d, { x: d.targetX, y: d.targetY });
        // Only pick new target when arrived or drifted too far — not every frame
        if (distToTarget < 8 || distToCamp > 80) {
          const a = Math.random() * Math.PI * 2;
          const r = 15 + Math.random() * 35;
          d.targetX = camp.x + Math.cos(a) * r;
          d.targetY = camp.y + Math.sin(a) * r;
        }
      }

      if (camp.owner === 0) {
        // Neutral camp: if all defenders dead, whoever is nearby captures it
        if (defenders.length === 0) {
          const nearby = this.units.filter(u => !u.dead && u.team !== 0 && pdist(u, camp) <= CAMP_RANGE);
          const teams = new Set(nearby.map(u => u.team));
          if (teams.size === 1) {
            const winner = [...teams][0] as 1 | 2;
            camp.owner = winner;
            camp.spawnTimer = 0;
            this.showFeedback(
              `${winner === 1 ? 'You' : 'Enemy'} captured ${camp.name}!`,
              winner === 1 ? '#45E6B0' : '#FF6B6B',
            );
          }
        }
      } else {
        // Owned camp: if enemies arrive and no allies defend, reset to neutral with fresh defenders
        const enemy = camp.owner === 1 ? 2 : 1;
        const en = this.units.filter(u => u.team === enemy && !u.dead && pdist(u, camp) <= CAMP_RANGE);
        const al = this.units.filter(u => u.team === camp.owner && !u.dead && pdist(u, camp) <= CAMP_RANGE);
        if (en.length > 0 && al.length === 0) {
          camp.owner = 0;
          camp.spawnTimer = 0;
          this.spawnCampDefenders(camp);
          this.showFeedback(`${camp.name} is contested!`, '#FFD93D');
        }
      }
    }
  }

  // ─── AI ──────────────────────────────────────────────────────

  private updateAI(delta: number) {
    this.aiTimer += delta;
    if (this.aiTimer < AI_TICK_MS) return;
    this.aiTimer -= AI_TICK_MS;

    const aiUnits = this.units.filter(u => u.team === 2 && !u.dead);
    const idle = aiUnits.filter(u => pdist(u, { x: u.targetX, y: u.targetY }) < 20);
    if (idle.length === 0) return;

    // Find best target camp
    const uncaptured = this.camps
      .filter(c => c.owner !== 2)
      .sort((a, b) => a.tier - b.tier || pdist(a, P2_BASE) - pdist(b, P2_BASE));

    const power = idle.reduce((s, u) => s + u.attack * u.hp, 0);
    let target: { x: number; y: number } | null = null;

    for (const c of uncaptured) {
      if (c.owner === 0) {
        // Check strength of neutral defenders at this camp
        const defenders = this.units.filter(u => u.campId === c.id && u.team === 0 && !u.dead);
        const gp = defenders.reduce((s, u) => s + u.attack * u.hp, 0);
        if (power > gp * 1.5) { target = c; break; }
      } else {
        target = c; break;
      }
    }

    if (!target && aiUnits.length > 20) {
      target = this.nexuses.find(n => n.team === 1)!;
    }

    if (target) this.sendUnitsTo(idle, target.x, target.y);

    // Defend nexus
    const nex = this.nexuses.find(n => n.team === 2)!;
    const threats = this.units.filter(u => u.team === 1 && !u.dead && pdist(u, nex) < 300);
    if (threats.length > 0) {
      const defs = aiUnits.filter(u => pdist(u, nex) < 600);
      if (defs.length > 0) this.sendUnitsTo(defs, nex.x, nex.y);
    }
  }

  // ─── UNIT SPRITES ───────────────────────────────────────────

  private updateUnitSprites() {
    // Group units for formation offsets
    const groups = new Map<string, HUnit[]>();
    for (const u of this.units) {
      if (u.dead) continue;
      const k = `${u.type}_${u.team}`;
      if (!groups.has(k)) groups.set(k, []);
      groups.get(k)!.push(u);
    }

    for (const u of this.units) {
      if (u.dead) {
        if (u.sprite) { u.sprite.destroy(); u.sprite = null; }
        continue;
      }
      if (!u.sprite) {
        const def = ANIMALS[u.type];
        // Distinct team colors: gold for neutral, blue for player, bright red for enemy
        const strokeColor = u.team === 0 ? '#DD8800' : u.team === 1 ? '#3388FF' : '#FF3333';
        const thickness = u.team === 2 ? 5 : u.team === 0 ? 4 : 3;
        u.sprite = this.add.text(0, 0, def.emoji, {
          fontSize: '22px',
          stroke: strokeColor,
          strokeThickness: thickness,
        }).setOrigin(0.5).setDepth(20);
      }

      // Sunflower spiral formation offset based on stable unit ID
      // Tighter for horde units (bunnies), wider for big animals
      const tier = ANIMALS[u.type]?.tier || 1;
      const tierSpacing = tier <= 1 ? 8 : tier <= 2 ? 12 : tier >= 4 ? 14 : 10;
      const maxSpread = tier <= 1 ? 35 : tier <= 2 ? 50 : tier >= 4 ? 50 : 40;
      const a = u.id * GOLDEN_ANGLE;
      const grp = groups.get(`${u.type}_${u.team}`) || [u];
      const idx = grp.indexOf(u);
      const r = Math.min(Math.sqrt(idx) * tierSpacing, maxSpread);
      const dispX = u.x + Math.cos(a) * r + (u.lungeX || 0);
      const dispY = u.y + Math.sin(a) * r + (u.lungeY || 0);
      // Smooth sprite position to avoid jitter
      const prev = u.sprite;
      const lerpFactor = 0.3;
      const sx = prev.x + (dispX - prev.x) * lerpFactor;
      const sy = prev.y + (dispY - prev.y) * lerpFactor;
      u.sprite.setPosition(sx, sy);
    }
  }

  private updateCampVisuals() {
    for (const c of this.camps) {
      const color = c.owner === 0 ? 0xFFD93D : TEAM_COLORS[c.owner as 1 | 2];
      c.area?.setFillStyle(color, 0.08);
      c.area?.setStrokeStyle(2, color, 0.3);

      const defenders = this.units.filter(u => u.campId === c.id && u.team === 0 && !u.dead);
      const g = c.captureBar;
      if (g) {
        g.clear();
        if (c.owner === 0 && c.guardCount > 0) {
          // Show capture progress bar: how much HP remains
          const totalMaxHp = c.guardCount * (ANIMALS[c.animalType]?.hp ?? 25) * 1.5;
          const currentHp = defenders.reduce((s, u) => s + Math.max(0, u.hp), 0);
          const pct = Math.max(0, currentHp / totalMaxHp);
          const w = 90, h = 7;
          const bx = c.x - w / 2, by = c.y + 25;
          g.fillStyle(0x000000, 0.6);
          g.fillRoundedRect(bx, by, w, h, 3);
          const barColor = pct > 0.5 ? 0xFFD93D : pct > 0.25 ? 0xFF9F43 : 0xFF5555;
          g.fillStyle(barColor, 0.9);
          g.fillRoundedRect(bx, by, w * pct, h, 3);
        }
      }

      // Label
      if (c.owner === 0 && defenders.length > 0) {
        c.label?.setText(`${c.name} (${defenders.length}/${c.guardCount})`);
        c.label?.setColor('#FFD93D');
      } else {
        const tag = c.owner === 0 ? ' (cleared!)' : c.owner === 1 ? ' [YOU]' : ' [ENEMY]';
        c.label?.setText(c.name + tag);
        c.label?.setColor(c.owner === 0 ? '#45E6B0' : c.owner === 1 ? '#4499FF' : '#FF5555');
      }
    }
  }

  // ─── CLEANUP / WIN ──────────────────────────────────────────

  private cleanupDead() {
    this.units = this.units.filter(u => {
      if (u.dead && u.sprite) { u.sprite.destroy(); u.sprite = null; }
      return !u.dead;
    });
  }

  private checkWin() {
    for (const n of this.nexuses) {
      if (n.hp <= 0) {
        this.gameOver = true;
        this.winner = n.team === 1 ? 2 : 1;
        this.showGameOver();
        return;
      }
    }
  }

  private showGameOver() {
    const cam = this.cameras.main;
    const win = this.winner === 1;
    this.add.rectangle(cam.width / 2, cam.height / 2, cam.width, cam.height, 0x000000, 0.7)
      .setScrollFactor(0).setDepth(200);
    const t = this.add.text(cam.width / 2, cam.height / 2 - 40, win ? 'VICTORY!' : 'DEFEAT', {
      fontSize: '52px', color: win ? '#45E6B0' : '#FF6B6B',
      fontFamily: '"Fredoka", sans-serif', fontStyle: 'bold',
    }).setOrigin(0.5).setScrollFactor(0).setDepth(201);
    const s = Math.floor(this.gameTime / 1000);
    this.add.text(cam.width / 2, cam.height / 2 + 20,
      `Time: ${Math.floor(s / 60)}:${(s % 60).toString().padStart(2, '0')}`, {
        fontSize: '18px', color: '#cbb8ee', fontFamily: '"Nunito", sans-serif', fontStyle: 'bold',
      }).setOrigin(0.5).setScrollFactor(0).setDepth(201);
    const btn = this.add.text(cam.width / 2, cam.height / 2 + 70, 'BACK TO MENU', {
      fontSize: '20px', color: '#45E6B0', fontFamily: '"Fredoka", sans-serif', fontStyle: 'bold',
      backgroundColor: '#0d1a0d', padding: { x: 20, y: 10 },
    }).setOrigin(0.5).setScrollFactor(0).setDepth(201).setInteractive({ useHandCursor: true });
    btn.on('pointerdown', () => { this.cleanupHTML(); this.scene.start('MenuScene'); });
    btn.on('pointerover', () => btn.setColor('#FFD93D'));
    btn.on('pointerout', () => btn.setColor('#45E6B0'));
    this.tweens.add({ targets: t, scaleX: { from: 0.5, to: 1 }, scaleY: { from: 0.5, to: 1 }, duration: 600, ease: 'Back.easeOut' });
  }

  // ─── UNIT MANAGEMENT ────────────────────────────────────────

  private spawnUnit(type: string, team: 1 | 2, x: number, y: number) {
    const def = ANIMALS[type];
    if (!def) return;
    const maxHp = Math.round(def.hp * (1 + this.getBuffs(team).hp));

    // New spawns go to the rally point for this type+team (set by last command)
    let targetX = x, targetY = y;
    const rally = this.rallyPoints[`${type}_${team}`];
    if (rally) {
      const a = this.nextId * GOLDEN_ANGLE;
      const r = Math.sqrt(this.units.filter(u => u.type === type && u.team === team && !u.dead).length) * 18;
      targetX = rally.x + Math.cos(a) * r;
      targetY = rally.y + Math.sin(a) * r;
    }

    // Tighter speed variance so horde units stay together as a mob
    const speedVariance = 0.93 + Math.random() * 0.14;
    this.units.push({
      id: this.nextId++, type, team,
      hp: maxHp, maxHp, attack: def.attack, speed: def.speed * speedVariance,
      x, y, targetX, targetY,
      attackTimer: 0, sprite: null, dead: false,
      campId: null, lungeX: 0, lungeY: 0,
    });
  }

  private sendUnitsTo(units: HUnit[], tx: number, ty: number, setRally = false) {
    // Save rally point per type+team so new spawns also go here
    if (setRally) {
      const types = new Set(units.map(u => u.type));
      const teams = new Set(units.map(u => u.team));
      for (const type of types) {
        for (const team of teams) {
          if (team === 0) continue;
          this.rallyPoints[`${type}_${team}`] = { x: tx, y: ty };
        }
      }
      // If "all" was sent, set rally for every type this team has
      if (types.size > 1) {
        const team = [...teams].find(t => t !== 0);
        if (team != null) {
          for (const type of Object.keys(ANIMALS)) {
            this.rallyPoints[`${type}_${team}`] = { x: tx, y: ty };
          }
        }
      }
    }

    for (let i = 0; i < units.length; i++) {
      const a = i * GOLDEN_ANGLE;
      // Tighter spiral for low-tier horde units, wider for big units
      const tier = ANIMALS[units[i].type]?.tier || 1;
      const spacing = tier <= 1 ? 10 : tier <= 2 ? 14 : 18;
      const r = Math.sqrt(i) * spacing;
      units[i].targetX = tx + Math.cos(a) * r;
      units[i].targetY = ty + Math.sin(a) * r;
    }
  }

  // ─── COMMAND PARSING ─────────────────────────────────────────

  private async handleCommand(text: string, team: 1 | 2) {
    this.showFeedback('Processing command...', '#FFD93D');

    // Build context for Gemini
    const countBy: Record<string, number> = {};
    for (const u of this.units) {
      if (u.team === team && !u.dead) countBy[u.type] = (countBy[u.type] || 0) + 1;
    }
    const myUnits = Object.entries(countBy).map(([type, count]) => ({ type, count }));
    const campCtx = this.camps.map((c, i) => ({
      name: c.name, animalType: c.animalType, index: i,
      owner: c.owner === 0 ? 'NEUTRAL' : c.owner === team ? 'YOURS' : 'ENEMY',
    }));

    // Try Gemini first — it handles multi-command in one shot
    const geminiResults = await parseWithGemini(text, myUnits, campCtx, this.gameTime);

    if (geminiResults && geminiResults.length > 0) {
      let anySuccess = false;
      for (const cmd of geminiResults) {
        if (this.executeGeminiCommand(cmd, team)) anySuccess = true;
      }
      if (anySuccess) return;
    }

    // Fallback to local regex parsing with compound splitting
    // Split on "and", "then", "while", commas, semicolons
    const parts = text.split(/\b(?:and|then|while|also)\b|[,;]/i).map(s => s.trim()).filter(Boolean);
    for (const part of parts) {
      this.executeLocalCommand(part, team);
    }
  }

  private executeGeminiCommand(cmd: HordeCommand, team: 1 | 2): boolean {
    const subject = cmd.subject || 'all';
    let tx = 0, ty = 0, found = false;

    if (cmd.targetType === 'nexus') {
      const n = this.nexuses.find(n2 => n2.team !== team)!;
      tx = n.x; ty = n.y; found = true;
    } else if (cmd.targetType === 'base' || cmd.targetType === 'defend') {
      const b = team === 1 ? P1_BASE : P2_BASE;
      tx = b.x; ty = b.y; found = true;
    } else if (cmd.targetType === 'camp') {
      // Try specific camp index first
      if (cmd.campIndex != null && cmd.campIndex >= 0 && cmd.campIndex < this.camps.length) {
        const c = this.camps[cmd.campIndex];
        tx = c.x; ty = c.y; found = true;
      }
      // Try by animal type
      if (!found && cmd.targetAnimal) {
        const base = team === 1 ? P1_BASE : P2_BASE;
        const cs = this.camps.filter(c => c.animalType === cmd.targetAnimal && c.owner !== team)
          .sort((a, b) => pdist(a, base) - pdist(b, base));
        if (cs.length > 0) { tx = cs[0].x; ty = cs[0].y; found = true; }
      }
    } else if (cmd.targetType === 'position') {
      tx = WORLD_W / 2; ty = WORLD_H / 2; found = true;
    }

    if (!found) return false;

    const sel = this.units.filter(u => u.team === team && !u.dead && (subject === 'all' || u.type === subject));
    if (sel.length === 0) {
      this.showFeedback(`No ${subject} units!`, '#FF6B6B');
      return true;
    }
    this.sendUnitsTo(sel, tx, ty, true);
    const label = subject === 'all' ? 'All units' : `${sel.length} ${subject}(s)`;
    const narration = cmd.narration || `${label} moving out!`;
    this.showFeedback(narration, '#45E6B0');
    return true;
  }

  private executeLocalCommand(text: string, team: 1 | 2) {
    const lo = text.toLowerCase();

    // Split on action words to separate subject from target
    const actionWords = /\b(attack|go\s*to|move\s*to|capture|take|defend|retreat|send\s*to|head\s*to)\b/i;
    const parts = lo.split(actionWords);
    const subjectPart = parts[0] || '';
    const targetPart = parts.length > 2 ? parts.slice(2).join(' ') : parts.length > 1 ? parts[1] : lo;

    let subject: string | 'all' = 'all';
    const animalPatterns: [RegExp, string][] = [
      [/bunn(y|ies)|rabbit/i, 'bunny'],
      [/wol(f|ves)/i, 'wolf'],
      [/bear/i, 'bear'],
      [/lion/i, 'lion'],
      [/dragon/i, 'dragon'],
    ];
    for (const [pat, name] of animalPatterns) {
      if (pat.test(subjectPart)) { subject = name; break; }
    }
    if (/\ball\b/i.test(subjectPart)) subject = 'all';

    let tx = 0, ty = 0, found = false;

    if (/nexus|throne|enemy\s*base/i.test(targetPart)) {
      const n = this.nexuses.find(n2 => n2.team !== team)!;
      tx = n.x; ty = n.y; found = true;
    }

    if (!found && /\b(base|home|retreat|defend)\b/i.test(targetPart)) {
      const b = team === 1 ? P1_BASE : P2_BASE;
      tx = b.x; ty = b.y; found = true;
    }

    // Match specific camp by name+number: "wolf camp 3", "bear camp 12"
    if (!found) {
      const campNumMatch = targetPart.match(/(bunny|wolf|bear|lion|dragon)\s*camp\s*(\d+)/i);
      if (campNumMatch) {
        const campNum = parseInt(campNumMatch[2]);
        const c = this.camps.find(c2 => c2.name.toLowerCase().includes(`camp ${campNum}`));
        if (c) { tx = c.x; ty = c.y; found = true; }
      }
    }

    // Match camp by animal type: "wolf camp" → nearest wolf camp not owned by me
    if (!found) {
      for (const [pat, name] of animalPatterns) {
        if (pat.test(targetPart)) {
          const base = team === 1 ? P1_BASE : P2_BASE;
          const cs = this.camps.filter(c => c.animalType === name && c.owner !== team)
            .sort((a, b) => pdist(a, base) - pdist(b, base));
          if (cs.length > 0) { tx = cs[0].x; ty = cs[0].y; found = true; break; }
        }
      }
    }

    // Match camp by full name words
    if (!found) {
      for (const c of this.camps) {
        const words = c.name.toLowerCase().split(/\s+/).filter(w => w.length > 3);
        if (words.some(w => targetPart.includes(w))) { tx = c.x; ty = c.y; found = true; break; }
      }
    }

    if (!found && /center|middle/i.test(targetPart)) { tx = WORLD_W / 2; ty = WORLD_H / 2; found = true; }

    if (!found && parts.length <= 1) {
      for (const [pat, name] of animalPatterns) {
        if (pat.test(lo)) {
          const base = team === 1 ? P1_BASE : P2_BASE;
          const cs = this.camps.filter(c => c.animalType === name && c.owner !== team)
            .sort((a, b) => pdist(a, base) - pdist(b, base));
          if (cs.length > 0) { tx = cs[0].x; ty = cs[0].y; found = true; subject = 'all'; break; }
        }
      }
    }

    if (!found) {
      this.showFeedback('Try: "bunnies attack wolf camp" or "all go to nexus"', '#FF6B6B');
      return;
    }

    const sel = this.units.filter(u => u.team === team && !u.dead && (subject === 'all' || u.type === subject));
    if (sel.length === 0) {
      this.showFeedback(`No ${subject} units!`, '#FF6B6B');
      return;
    }
    this.sendUnitsTo(sel, tx, ty, true);
    const label = subject === 'all' ? 'All units' : `${sel.length} ${subject}(s)`;
    this.showFeedback(`${label} moving out!`, '#45E6B0');
  }

  private showFeedback(msg: string, color: string) {
    const t = this.hudTexts['feedback'];
    if (!t) return;
    t.setText(msg).setColor(color).setAlpha(1);
    this.tweens.add({ targets: t, alpha: 0, duration: 3000, delay: 1000 });
  }

  // ─── BUFFS ──────────────────────────────────────────────────

  private getBuffs(team: 1 | 2) {
    let speed = 0, attack = 0, hp = 0;
    for (const c of this.camps) {
      if (c.owner !== team) continue;
      const s = c.buff.stat;
      if (s === 'speed') speed += c.buff.value;
      else if (s === 'attack') attack += c.buff.value;
      else if (s === 'hp') hp += c.buff.value;
      else if (s === 'all') { speed += c.buff.value; attack += c.buff.value; hp += c.buff.value; }
    }
    return { speed, attack, hp };
  }

  // ─── CLEANUP ────────────────────────────────────────────────

  private cleanupHTML() {
    this.textInput?.remove(); this.textInput = null;
    this.voiceStatusEl?.remove(); this.voiceStatusEl = null;
    try { this.recognition?.abort(); } catch (_e) { /* */ }
  }
}
