import Phaser from 'phaser';
import type { Position } from '@prompt-battle/shared';
import {
  type Faction, type FactionConfig, FACTION_CONFIGS,
  type Resources, type Employee, type EmployeeRole, ROLE_CONFIGS,
  type DepartmentType, type Department, type DepartmentConfig, DEPARTMENT_CONFIGS,
  type ResearchNode, RESEARCH_TREE, type ResearchPath,
  type ProductType, type Product, type ProductConfig, PRODUCT_CONFIGS, type ProductInDev,
  type AttackType, type AttackConfig, ATTACK_CONFIGS, type ActiveAttack,
  type DefenseType, type DefenseConfig, DEFENSE_CONFIGS,
  type Company, type SiliconMindsState, type LobbySlot, type GamePhase, type GameEvent,
  type ActiveSpy, type CEOCommand, type CEOCommandType,
  SM_CONSTANTS, FIRST_NAMES, LAST_NAMES, BOT_NAMES,
} from '@prompt-battle/shared';

// ─── HELPERS ────────────────────────────────────────────────────────

let _uid = 0;
function uid(prefix = 'id'): string { return `${prefix}_${++_uid}_${Date.now().toString(36)}`; }

function pick<T>(arr: T[]): T { return arr[Math.floor(Math.random() * arr.length)]; }
function clamp(v: number, lo: number, hi: number): number { return Math.max(lo, Math.min(hi, v)); }
function randInt(lo: number, hi: number): number { return Math.floor(Math.random() * (hi - lo + 1)) + lo; }
function randFloat(lo: number, hi: number): number { return Math.random() * (hi - lo) + lo; }
function hexToStr(hex: number): string { return '#' + hex.toString(16).padStart(6, '0'); }

function randomName(): string {
  return `${pick(FIRST_NAMES)} ${pick(LAST_NAMES)}`;
}

function makeEmployee(role: EmployeeRole, tick: number): Employee {
  const cfg = ROLE_CONFIGS[role];
  return {
    id: uid('emp'),
    name: randomName(),
    role,
    skill: randInt(3, 8),
    loyalty: randInt(40, 80),
    morale: randInt(50, 90),
    ethics: pick(['low', 'medium', 'high'] as const),
    departmentId: null,
    salary: cfg.baseSalary + randInt(-1, 2),
    hiredAt: tick,
    position: { x: 0, y: 0 },
    targetPosition: null,
    busy: false,
  };
}

const DEPT_GRID_POSITIONS: Record<DepartmentType, Position> = {
  research_lab:     { x: 0, y: 0 },
  data_pipeline:    { x: 2, y: 0 },
  training_cluster: { x: 4, y: 0 },
  eval_safety:      { x: 0, y: 2 },
  product_studio:   { x: 2, y: 2 },
  sales_floor:      { x: 4, y: 2 },
  hr_office:        { x: 0, y: 4 },
  security_ops:     { x: 2, y: 4 },
  legal:            { x: 4, y: 4 },
};

const ALL_ROLES: EmployeeRole[] = Object.keys(ROLE_CONFIGS) as EmployeeRole[];
const ALL_DEPT_TYPES: DepartmentType[] = Object.keys(DEPARTMENT_CONFIGS) as DepartmentType[];
const ALL_ATTACK_TYPES: AttackType[] = Object.keys(ATTACK_CONFIGS) as AttackType[];
const ALL_DEFENSE_TYPES: DefenseType[] = Object.keys(DEFENSE_CONFIGS) as DefenseType[];
const ALL_PRODUCT_TYPES: ProductType[] = Object.keys(PRODUCT_CONFIGS) as ProductType[];

const STARTER_DEPTS: DepartmentType[] = ['research_lab', 'data_pipeline', 'product_studio'];
const STARTER_ROLES: EmployeeRole[] = ['ml_researcher', 'software_engineer', 'data_engineer'];

// ─── SCENE ──────────────────────────────────────────────────────────

export class SiliconMindsScene extends Phaser.Scene {

  // ── state ──
  private gs!: SiliconMindsState;
  private localId!: string;
  private localCompany!: Company;

  // ── phaser graphics ──
  private officeGfx!: Phaser.GameObjects.Graphics;
  private deptTexts: Map<string, Phaser.GameObjects.Text> = new Map();
  private empCircles: Map<string, Phaser.GameObjects.Arc> = new Map();
  private selectionGfx!: Phaser.GameObjects.Graphics;
  private particleGfx!: Phaser.GameObjects.Graphics;

  // ── HUD HTML refs ──
  private smHudRoot!: HTMLDivElement;
  private topBarEl!: HTMLDivElement;
  private rightPanelEl!: HTMLDivElement;
  private bottomBarEl!: HTMLDivElement;
  private eventLogEl!: HTMLDivElement;
  private commandInputEl!: HTMLInputElement;
  private modalEl!: HTMLDivElement;

  // ── interaction ──
  private selectedDeptId: string | null = null;
  private activeView: 'office' | 'research' | 'market' = 'office';
  private tickTimer!: Phaser.Time.TimerEvent;
  private cursors!: Phaser.Types.Input.Keyboard.CursorKeys;
  private wasd!: { W: Phaser.Input.Keyboard.Key; A: Phaser.Input.Keyboard.Key; S: Phaser.Input.Keyboard.Key; D: Phaser.Input.Keyboard.Key };

  // ── event log buffer ──
  private logEntries: { text: string; color: string; tick: number }[] = [];
  private hudDirty = true;

  // ── camera pan ──
  private camSpeed = 8;

  constructor() {
    super({ key: 'SiliconMindsScene' });
  }

  // ═══════════════════════════════════════════════════════════════════
  //  INIT
  // ═══════════════════════════════════════════════════════════════════

  init(data: { lobby: LobbySlot[]; localPlayerIndex: number }) {
    const lobby = data.lobby && data.lobby.length > 0
      ? data.lobby
      : this.createDefaultLobby();
    const localIdx = data.localPlayerIndex ?? 0;
    this.gs = this.createInitialState(lobby, localIdx);
    this.localId = this.gs.localCompanyId;
    this.localCompany = this.gs.companies[this.localId];
  }

  private createDefaultLobby(): LobbySlot[] {
    const factions: Faction[] = ['nexus', 'titan', 'prometheus', 'catalyst'];
    return factions.map((f, i) => ({
      playerId: i === 0 ? 'local' : `bot_${i}`,
      playerName: i === 0 ? 'You' : BOT_NAMES[f],
      faction: f,
      isBot: i !== 0,
      ready: true,
    }));
  }

  // ═══════════════════════════════════════════════════════════════════
  //  CREATE INITIAL STATE
  // ═══════════════════════════════════════════════════════════════════

  private createInitialState(lobby: LobbySlot[], localIdx: number): SiliconMindsState {
    const companies: Record<string, Company> = {};
    let localCompanyId = '';

    for (let i = 0; i < lobby.length; i++) {
      const slot = lobby[i];
      const fc = FACTION_CONFIGS[slot.faction];
      const compId = uid('co');
      if (i === localIdx) localCompanyId = compId;

      // Build research tree
      const research: Record<string, ResearchNode> = {};
      for (const r of RESEARCH_TREE) {
        research[r.id] = { ...r, researched: false, progress: 0, active: false };
      }

      // Build starter departments
      const departments: Record<string, Department> = {};
      let deptIdx = 0;
      for (const dt of STARTER_DEPTS) {
        const dc = DEPARTMENT_CONFIGS[dt];
        const dId = uid('dept');
        departments[dId] = {
          id: dId,
          type: dt,
          level: 1,
          gridPos: { ...DEPT_GRID_POSITIONS[dt] },
          workerIds: [],
          maxWorkers: dc.baseMaxWorkers,
          active: true,
          upgradeCost: dc.upgradeCosts[0] ?? 999999,
        };
        deptIdx++;
      }

      // Build starter employees and auto-assign
      const employees: Record<string, Employee> = {};
      for (let ei = 0; ei < STARTER_ROLES.length; ei++) {
        const emp = makeEmployee(STARTER_ROLES[ei], 0);
        employees[emp.id] = emp;
        // Assign to matching department
        const preferredDept = ROLE_CONFIGS[emp.role].department;
        const matchDept = Object.values(departments).find(d => d.type === preferredDept);
        if (matchDept && matchDept.workerIds.length < matchDept.maxWorkers) {
          matchDept.workerIds.push(emp.id);
          emp.departmentId = matchDept.id;
        }
      }

      // Attack cooldowns
      const attackCooldowns: Record<AttackType, number> = {} as any;
      for (const at of ALL_ATTACK_TYPES) attackCooldowns[at] = 0;

      const company: Company = {
        id: compId,
        name: fc.name,
        faction: slot.faction,
        isBot: slot.isBot,
        isLocal: i === localIdx,
        eliminated: false,
        eliminatedAt: 0,
        eliminatedBy: '',
        resources: {
          capital: SM_CONSTANTS.START_CAPITAL + fc.startingBonusCapital,
          compute: SM_CONSTANTS.START_COMPUTE + fc.startingBonusCompute,
          data: SM_CONSTANTS.START_DATA,
          researchPoints: SM_CONSTANTS.START_RESEARCH,
          reputation: SM_CONSTANTS.START_REPUTATION,
          influence: SM_CONSTANTS.START_INFLUENCE,
        },
        income: 0,
        employees,
        nextEmployeeId: Object.keys(employees).length,
        departments,
        nextDeptId: Object.keys(departments).length,
        research,
        activeResearchId: null,
        modelQuality: 0,
        alignmentScore: 0,
        trainingActive: false,
        trainingProgress: 0,
        products: [],
        productsInDev: [],
        totalRevenue: 0,
        attackCooldowns,
        defenses: [],
        activeSentSpies: [],
        uniqueAbilityCooldown: 0,
        uniqueAbilityUsed: false,
        asiProgress: 0,
        asiStarted: false,
        officeWidth: SM_CONSTANTS.OFFICE_GRID_W,
        officeHeight: SM_CONSTANTS.OFFICE_GRID_H,
      };
      companies[compId] = company;
    }

    // Generate talent market
    const talentMarket: Employee[] = [];
    for (let t = 0; t < SM_CONSTANTS.TALENT_POOL_SIZE; t++) {
      talentMarket.push(makeEmployee(pick(ALL_ROLES), 0));
    }

    return {
      phase: 'playing',
      tick: 0,
      era: 1,
      gameTimeMs: 0,
      matchDurationMs: SM_CONSTANTS.MATCH_DURATION,
      companies,
      localCompanyId,
      lobby,
      maxPlayers: SM_CONSTANTS.MAX_PLAYERS,
      talentMarket,
      events: [],
      activeAttacks: [],
      contestedObjectives: [],
      winnerId: null,
      winCondition: '',
    };
  }

  // ═══════════════════════════════════════════════════════════════════
  //  CREATE (Phaser lifecycle)
  // ═══════════════════════════════════════════════════════════════════

  create() {
    this.cameras.main.setBackgroundColor('#0a0a1a');

    // Set world bounds based on office grid
    const worldW = SM_CONSTANTS.OFFICE_GRID_W * SM_CONSTANTS.TILE_SIZE;
    const worldH = SM_CONSTANTS.OFFICE_GRID_H * SM_CONSTANTS.TILE_SIZE;
    this.cameras.main.setBounds(0, 0, worldW, worldH);
    this.cameras.main.centerOn(worldW / 2, worldH / 2);

    // Graphics layers
    this.officeGfx = this.add.graphics().setDepth(0);
    this.selectionGfx = this.add.graphics().setDepth(5);
    this.particleGfx = this.add.graphics().setDepth(3);

    // Render initial office
    this.renderOffice();
    this.placeEmployeeSprites();

    // Input
    this.setupInput();

    // HUD
    this.buildHUD();

    // Game tick timer
    this.tickTimer = this.time.addEvent({
      delay: SM_CONSTANTS.TICK_RATE,
      callback: () => this.gameTick(),
      loop: true,
    });

    this.addLog('Game started! You are ' + FACTION_CONFIGS[this.localCompany.faction].emoji + ' ' + this.localCompany.name, FACTION_CONFIGS[this.localCompany.faction].colorStr);
    this.addLog('Era 1: Narrow AI -- build your foundation.', '#6CC4FF');
  }

  // ═══════════════════════════════════════════════════════════════════
  //  OFFICE RENDERING
  // ═══════════════════════════════════════════════════════════════════

  private renderOffice() {
    const g = this.officeGfx;
    g.clear();
    const ts = SM_CONSTANTS.TILE_SIZE;
    const gw = SM_CONSTANTS.OFFICE_GRID_W;
    const gh = SM_CONSTANTS.OFFICE_GRID_H;

    // Grid lines
    g.lineStyle(1, 0x1a1a3a, 0.4);
    for (let x = 0; x <= gw; x++) {
      g.lineBetween(x * ts, 0, x * ts, gh * ts);
    }
    for (let y = 0; y <= gh; y++) {
      g.lineBetween(0, y * ts, gw * ts, y * ts);
    }

    // Floor fill
    g.fillStyle(0x0d0d20, 0.5);
    g.fillRect(0, 0, gw * ts, gh * ts);

    // Departments
    const co = this.localCompany;
    for (const dept of Object.values(co.departments)) {
      this.renderDepartment(dept);
    }
  }

  private renderDepartment(dept: Department) {
    const g = this.officeGfx;
    const ts = SM_CONSTANTS.TILE_SIZE;
    const dc = DEPARTMENT_CONFIGS[dept.type];
    const px = dept.gridPos.x * ts;
    const py = dept.gridPos.y * ts;
    const dw = 2 * ts;
    const dh = 2 * ts;

    // Department rectangle
    g.fillStyle(dc.color, 0.25);
    g.fillRect(px + 2, py + 2, dw - 4, dh - 4);
    g.lineStyle(2, dc.color, 0.7);
    g.strokeRect(px + 2, py + 2, dw - 4, dh - 4);

    // Label
    const existingText = this.deptTexts.get(dept.id);
    if (existingText) existingText.destroy();

    const label = this.add.text(px + dw / 2, py + 14, `${dc.emoji} ${dc.label}`, {
      fontSize: '11px',
      color: '#e0d0ff',
      fontFamily: '"Nunito", sans-serif',
      fontStyle: 'bold',
      align: 'center',
    }).setOrigin(0.5, 0).setDepth(2);
    this.deptTexts.set(dept.id, label);

    // Worker count
    const workerLabel = this.add.text(px + dw / 2, py + dh - 14, `${dept.workerIds.length}/${dept.maxWorkers}`, {
      fontSize: '10px',
      color: '#8B6DB0',
      fontFamily: '"Nunito", sans-serif',
      fontStyle: '600',
      align: 'center',
    }).setOrigin(0.5, 1).setDepth(2);
    this.deptTexts.set(dept.id + '_count', workerLabel);

    // Level indicator
    if (dept.level > 1) {
      const lvlLabel = this.add.text(px + dw - 8, py + 6, `Lv${dept.level}`, {
        fontSize: '9px',
        color: '#FFD93D',
        fontFamily: '"Nunito", sans-serif',
        fontStyle: 'bold',
      }).setOrigin(1, 0).setDepth(2);
      this.deptTexts.set(dept.id + '_lvl', lvlLabel);
    }
  }

  private placeEmployeeSprites() {
    const co = this.localCompany;
    const ts = SM_CONSTANTS.TILE_SIZE;

    for (const emp of Object.values(co.employees)) {
      const dept = emp.departmentId ? co.departments[emp.departmentId] : null;
      let px: number, py: number;
      if (dept) {
        const deptPx = dept.gridPos.x * ts + ts;
        const deptPy = dept.gridPos.y * ts + ts;
        const idx = dept.workerIds.indexOf(emp.id);
        const angle = (idx / Math.max(dept.workerIds.length, 1)) * Math.PI * 2;
        px = deptPx + Math.cos(angle) * 30;
        py = deptPy + Math.sin(angle) * 30;
      } else {
        px = randInt(50, SM_CONSTANTS.OFFICE_GRID_W * ts - 50);
        py = randInt(50, SM_CONSTANTS.OFFICE_GRID_H * ts - 50);
      }
      emp.position = { x: px, y: py };
      emp.targetPosition = { x: px, y: py };

      const roleColor = this.getRoleColor(emp.role);
      const circle = this.add.circle(px, py, SM_CONSTANTS.EMPLOYEE_SIZE / 2, roleColor, 0.9).setDepth(4);
      circle.setInteractive({ useHandCursor: true });
      circle.setData('empId', emp.id);
      this.empCircles.set(emp.id, circle);
    }
  }

  private getRoleColor(role: EmployeeRole): number {
    const colors: Record<EmployeeRole, number> = {
      ml_researcher: 0x42A5F5,
      data_engineer: 0x66BB6A,
      ml_engineer: 0xFF7043,
      safety_researcher: 0x26C6DA,
      product_manager: 0xAB47BC,
      software_engineer: 0x5C6BC0,
      salesperson: 0xFFCA28,
      recruiter: 0xEC407A,
      pr_comms: 0xF06292,
      spy: 0x424242,
      security_officer: 0x78909C,
      lawyer: 0x8D6E63,
    };
    return colors[role] ?? 0xffffff;
  }

  private refreshOfficeVisuals() {
    // Clear old texts
    for (const t of this.deptTexts.values()) t.destroy();
    this.deptTexts.clear();

    // Clear old employee circles
    for (const c of this.empCircles.values()) c.destroy();
    this.empCircles.clear();

    this.officeGfx.clear();
    this.renderOffice();
    this.placeEmployeeSprites();
  }

  // ═══════════════════════════════════════════════════════════════════
  //  HUD (HTML overlay)
  // ═══════════════════════════════════════════════════════════════════

  private buildHUD() {
    // Hide battle scene HUD elements if visible
    const heroBar = document.getElementById('hero-bar');
    if (heroBar) heroBar.style.display = 'none';
    const cmdLog = document.getElementById('command-log');
    if (cmdLog) cmdLog.style.display = 'none';
    const statusBar = document.getElementById('status-bar');
    if (statusBar) statusBar.style.display = 'none';
    const abilPanel = document.getElementById('ability-panel');
    if (abilPanel) abilPanel.style.display = 'none';

    // Create SM HUD root
    const existing = document.getElementById('sm-hud');
    if (existing) existing.remove();

    this.smHudRoot = document.createElement('div');
    this.smHudRoot.id = 'sm-hud';
    this.smHudRoot.style.cssText = `
      position: absolute; top: 0; left: 0; width: 100%; height: 100%;
      pointer-events: none; z-index: 15; font-family: 'Nunito', sans-serif;
      color: #e0d0ff; font-size: 13px;
    `;
    document.getElementById('game-container')!.appendChild(this.smHudRoot);

    // Inject styles
    const style = document.createElement('style');
    style.id = 'sm-hud-styles';
    style.textContent = `
      #sm-hud * { box-sizing: border-box; }
      #sm-top-bar {
        position: absolute; top: 0; left: 0; width: 100%;
        padding: 6px 16px; display: flex; align-items: center; gap: 16px;
        background: rgba(26, 16, 48, 0.94); border-bottom: 2px solid #3D2070;
        pointer-events: all; z-index: 20; flex-wrap: wrap;
        backdrop-filter: blur(6px);
      }
      .sm-res { display: flex; align-items: center; gap: 4px; font-size: 13px; font-weight: 700; }
      .sm-res .sm-val { color: #FFD93D; min-width: 36px; text-align: right; }
      .sm-res .sm-label { color: #8B6DB0; font-size: 10px; font-weight: 600; }
      .sm-era { padding: 2px 10px; border-radius: 8px; font-weight: 800; font-size: 12px; letter-spacing: 1px; }
      .sm-era.era1 { background: rgba(66,165,245,0.2); color: #42A5F5; border: 1px solid #42A5F5; }
      .sm-era.era2 { background: rgba(255,202,40,0.2); color: #FFCA28; border: 1px solid #FFCA28; }
      .sm-era.era3 { background: rgba(239,83,80,0.2); color: #EF5350; border: 1px solid #EF5350; }
      .sm-timer { color: #e0d0ff; font-weight: 800; font-size: 15px; margin-left: auto; }

      #sm-right-panel {
        position: absolute; top: 52px; right: 8px; width: 240px;
        background: rgba(26, 16, 48, 0.92); border: 2px solid #3D2070;
        border-radius: 12px; padding: 8px; pointer-events: all; z-index: 20;
        max-height: calc(100% - 160px); overflow-y: auto;
        backdrop-filter: blur(6px);
      }
      .sm-rival { padding: 8px; margin-bottom: 6px; border-radius: 8px; background: rgba(255,255,255,0.03); border: 1px solid #2a1858; }
      .sm-rival-name { font-weight: 700; font-size: 13px; margin-bottom: 4px; }
      .sm-rival-hp { height: 6px; background: #1a1030; border-radius: 3px; overflow: hidden; margin: 4px 0; }
      .sm-rival-hp-fill { height: 100%; border-radius: 3px; transition: width 0.3s; }
      .sm-rival-info { font-size: 10px; color: #8B6DB0; }
      .sm-rival-btn {
        display: inline-block; padding: 3px 10px; margin: 3px 2px 0 0;
        background: rgba(239,83,80,0.15); border: 1px solid rgba(239,83,80,0.4);
        border-radius: 6px; color: #EF5350; font-size: 10px; font-weight: 700;
        cursor: pointer; pointer-events: all; transition: all 0.15s;
      }
      .sm-rival-btn:hover { background: rgba(239,83,80,0.3); }
      .sm-rival-btn.disabled { opacity: 0.35; cursor: default; pointer-events: none; }

      #sm-bottom-bar {
        position: absolute; bottom: 0; left: 0; width: 100%;
        padding: 8px 16px; display: flex; align-items: center; gap: 8px;
        background: rgba(26, 16, 48, 0.94); border-top: 2px solid #3D2070;
        pointer-events: all; z-index: 20; flex-wrap: wrap;
        backdrop-filter: blur(6px);
      }
      .sm-action-btn {
        padding: 5px 14px; border-radius: 8px; font-weight: 700; font-size: 12px;
        cursor: pointer; pointer-events: all; border: 2px solid; transition: all 0.15s;
        font-family: 'Nunito', sans-serif; background: transparent;
        color: #e0d0ff;
      }
      .sm-action-btn:hover { filter: brightness(1.3); transform: scale(1.05); }
      .sm-action-btn.hire { border-color: #66BB6A; color: #66BB6A; }
      .sm-action-btn.research { border-color: #42A5F5; color: #42A5F5; }
      .sm-action-btn.build { border-color: #FF7043; color: #FF7043; }
      .sm-action-btn.ship { border-color: #AB47BC; color: #AB47BC; }
      .sm-action-btn.train { border-color: #FFCA28; color: #FFCA28; }
      .sm-action-btn.defend { border-color: #26C6DA; color: #26C6DA; }

      #sm-cmd-input {
        flex: 1; min-width: 200px; padding: 6px 12px; border-radius: 8px;
        background: rgba(255,255,255,0.06); border: 2px solid #3D2070;
        color: #e0d0ff; font-size: 13px; font-family: 'Nunito', sans-serif;
        outline: none; transition: border-color 0.2s;
      }
      #sm-cmd-input:focus { border-color: #C98FFF; }
      #sm-cmd-input::placeholder { color: #5a4880; }

      #sm-event-log {
        position: absolute; bottom: 60px; left: 12px; width: 340px; max-height: 180px;
        overflow-y: auto; background: rgba(26, 16, 48, 0.88); border: 2px solid #3D2070;
        border-radius: 12px; padding: 8px 10px; pointer-events: all; z-index: 20;
        font-size: 11px;
        mask-image: linear-gradient(to bottom, transparent 0%, #000 15%, #000 100%);
        -webkit-mask-image: linear-gradient(to bottom, transparent 0%, #000 15%, #000 100%);
      }
      .sm-log-entry { padding: 3px 6px; border-bottom: 1px solid #1a1030; }

      #sm-modal {
        position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%);
        background: rgba(26, 16, 48, 0.97); border: 2px solid #C98FFF;
        border-radius: 16px; padding: 20px; pointer-events: all; z-index: 30;
        min-width: 400px; max-width: 700px; max-height: 70vh; overflow-y: auto;
        display: none;
        backdrop-filter: blur(10px);
      }
      #sm-modal h2 { color: #FF6B9D; font-family: 'Fredoka', sans-serif; margin: 0 0 12px 0; font-size: 18px; }
      #sm-modal .sm-close-btn {
        position: absolute; top: 8px; right: 12px; color: #8B6DB0; cursor: pointer;
        font-size: 20px; font-weight: 700; pointer-events: all;
      }
      #sm-modal .sm-close-btn:hover { color: #FF6B9D; }
      .sm-modal-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(180px, 1fr)); gap: 8px; }
      .sm-modal-card {
        padding: 10px; background: rgba(255,255,255,0.04); border: 1px solid #2a1858;
        border-radius: 10px; cursor: pointer; transition: all 0.15s;
      }
      .sm-modal-card:hover { border-color: #C98FFF; background: rgba(201,143,255,0.08); }
      .sm-modal-card.disabled { opacity: 0.4; cursor: default; pointer-events: none; }
      .sm-modal-card .sm-card-title { font-weight: 700; font-size: 13px; margin-bottom: 4px; }
      .sm-modal-card .sm-card-desc { font-size: 10px; color: #8B6DB0; }
      .sm-modal-card .sm-card-cost { font-size: 11px; color: #FFCA28; font-weight: 700; margin-top: 4px; }

      .sm-research-node {
        padding: 8px; margin: 4px 0; border-radius: 8px; background: rgba(255,255,255,0.03);
        border: 1px solid #2a1858; cursor: pointer; transition: all 0.15s;
      }
      .sm-research-node:hover { border-color: #42A5F5; }
      .sm-research-node.researched { border-color: #66BB6A; background: rgba(102,187,106,0.08); }
      .sm-research-node.active { border-color: #FFCA28; background: rgba(255,202,40,0.1); animation: pulse-glow 1.5s infinite; }
      .sm-research-node.locked { opacity: 0.35; cursor: default; }
      @keyframes pulse-glow { 0%,100%{box-shadow:none} 50%{box-shadow:0 0 10px rgba(255,202,40,0.3)} }

      #sm-right-panel::-webkit-scrollbar, #sm-event-log::-webkit-scrollbar, #sm-modal::-webkit-scrollbar { width: 5px; }
      #sm-right-panel::-webkit-scrollbar-track, #sm-event-log::-webkit-scrollbar-track, #sm-modal::-webkit-scrollbar-track { background: rgba(42,24,88,0.4); border-radius: 3px; }
      #sm-right-panel::-webkit-scrollbar-thumb, #sm-event-log::-webkit-scrollbar-thumb, #sm-modal::-webkit-scrollbar-thumb { background: rgba(201,143,255,0.35); border-radius: 3px; }
    `;
    document.head.appendChild(style);

    // Top bar
    this.topBarEl = document.createElement('div');
    this.topBarEl.id = 'sm-top-bar';
    this.smHudRoot.appendChild(this.topBarEl);

    // Right panel (rivals)
    this.rightPanelEl = document.createElement('div');
    this.rightPanelEl.id = 'sm-right-panel';
    this.smHudRoot.appendChild(this.rightPanelEl);

    // Bottom bar
    this.bottomBarEl = document.createElement('div');
    this.bottomBarEl.id = 'sm-bottom-bar';
    this.smHudRoot.appendChild(this.bottomBarEl);

    // Event log
    this.eventLogEl = document.createElement('div');
    this.eventLogEl.id = 'sm-event-log';
    this.smHudRoot.appendChild(this.eventLogEl);

    // Modal
    this.modalEl = document.createElement('div');
    this.modalEl.id = 'sm-modal';
    this.smHudRoot.appendChild(this.modalEl);

    // Build bottom bar content
    this.bottomBarEl.innerHTML = `
      <button class="sm-action-btn hire" id="sm-btn-hire">👥 Hire</button>
      <button class="sm-action-btn research" id="sm-btn-research">🔬 Research</button>
      <button class="sm-action-btn build" id="sm-btn-build">🏗️ Build Dept</button>
      <button class="sm-action-btn ship" id="sm-btn-ship">🚀 Ship Product</button>
      <button class="sm-action-btn train" id="sm-btn-train">🖥️ Train Model</button>
      <button class="sm-action-btn defend" id="sm-btn-defend">🛡️ Defend</button>
      <input type="text" id="sm-cmd-input" placeholder="Type a CEO command... (e.g. hire 2 researchers)" />
    `;

    this.commandInputEl = document.getElementById('sm-cmd-input') as HTMLInputElement;
    this.commandInputEl.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter' && this.commandInputEl.value.trim()) {
        this.processTextCommand(this.commandInputEl.value.trim());
        this.commandInputEl.value = '';
      }
    });

    // Button handlers
    document.getElementById('sm-btn-hire')!.addEventListener('click', () => this.openHireModal());
    document.getElementById('sm-btn-research')!.addEventListener('click', () => this.openResearchModal());
    document.getElementById('sm-btn-build')!.addEventListener('click', () => this.openBuildModal());
    document.getElementById('sm-btn-ship')!.addEventListener('click', () => this.openShipModal());
    document.getElementById('sm-btn-train')!.addEventListener('click', () => this.handleTrainModel());
    document.getElementById('sm-btn-defend')!.addEventListener('click', () => this.openDefendModal());

    this.updateHUD();
  }

  private updateHUD() {
    this.updateTopBar();
    this.updateRivalPanel();
    this.updateEventLog();
  }

  private updateTopBar() {
    const co = this.localCompany;
    const r = co.resources;
    const fc = FACTION_CONFIGS[co.faction];
    const elapsed = this.gs.tick * SM_CONSTANTS.TICK_RATE / 1000;
    const remaining = Math.max(0, SM_CONSTANTS.MATCH_DURATION / 1000 - elapsed);
    const mins = Math.floor(remaining / 60);
    const secs = Math.floor(remaining % 60);
    const empCount = Object.keys(co.employees).length;
    const eraClass = this.gs.era === 1 ? 'era1' : this.gs.era === 2 ? 'era2' : 'era3';
    const eraName = this.gs.era === 1 ? 'NARROW AI' : this.gs.era === 2 ? 'GENERAL AI' : 'SUPERINTELLIGENCE';
    const incomeSign = co.income >= 0 ? '+' : '';

    this.topBarEl.innerHTML = `
      <span class="sm-res">💰 <span class="sm-val">${Math.floor(r.capital)}</span><span class="sm-label">(${incomeSign}${co.income.toFixed(1)}/t)</span></span>
      <span class="sm-res">🖥️ <span class="sm-val">${Math.floor(r.compute)}</span></span>
      <span class="sm-res">📊 <span class="sm-val">${Math.floor(r.data)}</span></span>
      <span class="sm-res">🧪 <span class="sm-val">${Math.floor(r.researchPoints)}</span></span>
      <span class="sm-res">⭐ <span class="sm-val">${Math.floor(r.reputation)}</span></span>
      <span class="sm-res">🏛️ <span class="sm-val">${Math.floor(r.influence)}</span></span>
      <span class="sm-res">👥 <span class="sm-val">${empCount}</span></span>
      <span class="sm-res">🤖 <span class="sm-val">Q${Math.floor(co.modelQuality)}</span><span class="sm-label">model</span></span>
      <span class="sm-era ${eraClass}">Era ${this.gs.era}: ${eraName}</span>
      <span class="sm-timer">${mins}:${secs.toString().padStart(2, '0')}</span>
    `;
  }

  private updateRivalPanel() {
    const rivals = Object.values(this.gs.companies).filter(c => c.id !== this.localId);
    let html = '<div style="font-size:12px;color:#FF6B9D;font-weight:700;margin-bottom:6px;font-family:Fredoka,sans-serif;letter-spacing:1px;">RIVALS</div>';

    for (const rival of rivals) {
      const fc = FACTION_CONFIGS[rival.faction];
      const capPct = Math.max(0, Math.min(100, (rival.resources.capital / (SM_CONSTANTS.START_CAPITAL + fc.startingBonusCapital)) * 100));
      const hpColor = rival.eliminated ? '#666' : capPct > 60 ? fc.colorStr : capPct > 30 ? '#FFCA28' : '#EF5350';
      const statusLabel = rival.eliminated ? ' [ELIMINATED]' : '';

      // Attack buttons
      let attackBtns = '';
      if (!rival.eliminated) {
        const availAttacks = ALL_ATTACK_TYPES.filter(at => {
          const cfg = ATTACK_CONFIGS[at];
          return cfg.era <= this.gs.era && this.localCompany.attackCooldowns[at] <= 0 && this.localCompany.resources.capital >= cfg.cost;
        });
        for (const at of availAttacks.slice(0, 4)) {
          const cfg = ATTACK_CONFIGS[at];
          attackBtns += `<span class="sm-rival-btn" data-attack="${at}" data-target="${rival.id}">${cfg.emoji} ${cfg.label} ($${cfg.cost})</span>`;
        }
        if (availAttacks.length === 0) {
          attackBtns = '<span class="sm-rival-info">No attacks available</span>';
        }
      }

      html += `
        <div class="sm-rival" data-rival="${rival.id}">
          <div class="sm-rival-name" style="color:${fc.colorStr}">${fc.emoji} ${rival.name}${statusLabel}</div>
          <div class="sm-rival-hp"><div class="sm-rival-hp-fill" style="width:${capPct}%;background:${hpColor}"></div></div>
          <div class="sm-rival-info">Model Q: ${Math.floor(rival.modelQuality)} | Rep: ${Math.floor(rival.resources.reputation)} | ASI: ${Math.floor(rival.asiProgress)}%</div>
          <div style="margin-top:4px">${attackBtns}</div>
        </div>
      `;
    }
    this.rightPanelEl.innerHTML = html;

    // Bind attack buttons
    this.rightPanelEl.querySelectorAll('.sm-rival-btn[data-attack]').forEach(btn => {
      (btn as HTMLElement).addEventListener('click', () => {
        const at = (btn as HTMLElement).dataset.attack as AttackType;
        const targetId = (btn as HTMLElement).dataset.target!;
        this.launchAttack(at, targetId);
      });
    });
  }

  private updateEventLog() {
    const recent = this.logEntries.slice(-30);
    let html = '';
    for (const entry of recent) {
      html += `<div class="sm-log-entry" style="color:${entry.color}">${entry.text}</div>`;
    }
    this.eventLogEl.innerHTML = html;
    this.eventLogEl.scrollTop = this.eventLogEl.scrollHeight;
  }

  private addLog(text: string, color: string = '#cbb8ee') {
    const tickStr = `[${Math.floor(this.gs.tick * SM_CONSTANTS.TICK_RATE / 1000)}s] `;
    this.logEntries.push({ text: tickStr + text, color, tick: this.gs.tick });
    this.hudDirty = true;
  }

  // ═══════════════════════════════════════════════════════════════════
  //  MODALS
  // ═══════════════════════════════════════════════════════════════════

  private openModal(title: string, content: string) {
    this.modalEl.style.display = 'block';
    this.modalEl.innerHTML = `
      <span class="sm-close-btn" id="sm-modal-close">&times;</span>
      <h2>${title}</h2>
      ${content}
    `;
    document.getElementById('sm-modal-close')!.addEventListener('click', () => this.closeModal());
  }

  private closeModal() {
    this.modalEl.style.display = 'none';
  }

  // ── HIRE ──
  private openHireModal() {
    const market = this.gs.talentMarket;
    let cards = '';
    for (const emp of market) {
      const rc = ROLE_CONFIGS[emp.role];
      const cost = Math.floor(emp.salary * 10 * FACTION_CONFIGS[this.localCompany.faction].hiringCostMultiplier);
      const canAfford = this.localCompany.resources.capital >= cost;
      cards += `
        <div class="sm-modal-card ${canAfford ? '' : 'disabled'}" data-hire-id="${emp.id}">
          <div class="sm-card-title">${rc.emoji} ${emp.name}</div>
          <div class="sm-card-desc">${rc.label} | Skill: ${emp.skill}/10 | Ethics: ${emp.ethics}</div>
          <div class="sm-card-cost">Hire: $${cost} | Salary: $${emp.salary}/t</div>
        </div>
      `;
    }
    if (market.length === 0) cards = '<div style="color:#8B6DB0">No talent available. Wait for refresh.</div>';

    this.openModal('👥 Talent Market', `<div class="sm-modal-grid">${cards}</div>`);

    this.modalEl.querySelectorAll('.sm-modal-card[data-hire-id]').forEach(card => {
      (card as HTMLElement).addEventListener('click', () => {
        const empId = (card as HTMLElement).dataset.hireId!;
        this.hireFromMarket(empId);
        this.closeModal();
      });
    });
  }

  // ── RESEARCH ──
  private openResearchModal() {
    const co = this.localCompany;
    const paths: ResearchPath[] = ['core', 'scale', 'intelligence', 'alignment', 'offensive', 'defensive'];
    let content = '';

    for (const path of paths) {
      const nodes = RESEARCH_TREE.filter(r => r.path === path);
      content += `<div style="margin-bottom:12px"><div style="font-weight:700;color:#42A5F5;font-size:13px;text-transform:uppercase;margin-bottom:4px">${path}</div>`;
      for (const nodeDef of nodes) {
        const node = co.research[nodeDef.id];
        if (!node) continue;
        const prereqMet = node.prerequisites.every(p => co.research[p]?.researched);
        const eraOk = node.era <= this.gs.era;
        const canResearch = !node.researched && prereqMet && eraOk && co.resources.researchPoints >= node.cost && !co.activeResearchId;
        const cls = node.researched ? 'researched' : node.active ? 'active' : (!prereqMet || !eraOk) ? 'locked' : '';

        const progressBar = node.active ? `<div style="height:4px;background:#1a1030;border-radius:2px;margin-top:4px"><div style="height:100%;width:${(node.progress / node.timeTicks) * 100}%;background:#FFCA28;border-radius:2px"></div></div>` : '';

        content += `
          <div class="sm-research-node ${cls}" data-research-id="${node.id}" ${canResearch ? 'data-can-research="1"' : ''}>
            <div style="font-weight:700;font-size:12px">${node.emoji} ${node.name} ${node.researched ? '✅' : ''} ${node.active ? '⏳' : ''}</div>
            <div style="font-size:10px;color:#8B6DB0">Era ${node.era} | Cost: ${node.cost} RP | Time: ${node.timeTicks} ticks</div>
            <div style="font-size:10px;color:#66BB6A">${node.effect}</div>
            ${progressBar}
          </div>
        `;
      }
      content += '</div>';
    }

    this.openModal('🔬 Research Tree', content);
    this.modalEl.querySelectorAll('.sm-research-node[data-can-research]').forEach(el => {
      (el as HTMLElement).addEventListener('click', () => {
        const rId = (el as HTMLElement).dataset.researchId!;
        this.startResearch(rId);
        this.closeModal();
      });
    });
  }

  // ── BUILD DEPT ──
  private openBuildModal() {
    const co = this.localCompany;
    const builtTypes = new Set(Object.values(co.departments).map(d => d.type));
    let cards = '';

    for (const dt of ALL_DEPT_TYPES) {
      const dc = DEPARTMENT_CONFIGS[dt];
      const built = builtTypes.has(dt);
      const canAfford = co.resources.capital >= dc.buildCost;

      if (built) {
        // Show upgrade option
        const dept = Object.values(co.departments).find(d => d.type === dt)!;
        if (dept.level < 3) {
          const upgCost = dc.upgradeCosts[dept.level - 1] ?? 999999;
          const canUpgrade = co.resources.capital >= upgCost;
          cards += `
            <div class="sm-modal-card ${canUpgrade ? '' : 'disabled'}" data-upgrade-dept="${dept.id}">
              <div class="sm-card-title">${dc.emoji} ${dc.label} (Lv${dept.level} -> ${dept.level + 1})</div>
              <div class="sm-card-desc">+${dc.baseMaxWorkers} max workers</div>
              <div class="sm-card-cost">Upgrade: $${upgCost}</div>
            </div>
          `;
        }
      } else {
        cards += `
          <div class="sm-modal-card ${canAfford ? '' : 'disabled'}" data-build-dept="${dt}">
            <div class="sm-card-title">${dc.emoji} ${dc.label}</div>
            <div class="sm-card-desc">${dc.description} | Max ${dc.baseMaxWorkers} workers</div>
            <div class="sm-card-cost">Build: $${dc.buildCost}</div>
          </div>
        `;
      }
    }

    this.openModal('🏗️ Build / Upgrade Department', `<div class="sm-modal-grid">${cards}</div>`);

    this.modalEl.querySelectorAll('.sm-modal-card[data-build-dept]').forEach(el => {
      (el as HTMLElement).addEventListener('click', () => {
        this.buildDepartment((el as HTMLElement).dataset.buildDept as DepartmentType);
        this.closeModal();
      });
    });
    this.modalEl.querySelectorAll('.sm-modal-card[data-upgrade-dept]').forEach(el => {
      (el as HTMLElement).addEventListener('click', () => {
        this.upgradeDepartment((el as HTMLElement).dataset.upgradeDept!);
        this.closeModal();
      });
    });
  }

  // ── SHIP PRODUCT ──
  private openShipModal() {
    const co = this.localCompany;
    let cards = '';

    for (const pt of ALL_PRODUCT_TYPES) {
      const pc = PRODUCT_CONFIGS[pt];
      const hasResearch = pc.requiredResearch.every(rId => co.research[rId]?.researched);
      const hasDepts = pc.requiredDepartments.every(dt => Object.values(co.departments).some(d => d.type === dt));
      const hasQuality = co.modelQuality >= pc.minModelQuality;
      const alreadyShipped = co.products.some(p => p.type === pt && p.launched);
      const inDev = co.productsInDev.some(p => p.type === pt);
      const canShip = hasResearch && hasDepts && hasQuality && !alreadyShipped && !inDev;

      let status = '';
      if (alreadyShipped) status = '✅ Launched';
      else if (inDev) status = '⏳ In Development';
      else if (!hasResearch) status = '🔒 Missing Research';
      else if (!hasDepts) status = '🔒 Missing Department';
      else if (!hasQuality) status = `🔒 Need Model Q${pc.minModelQuality}`;

      cards += `
        <div class="sm-modal-card ${canShip ? '' : 'disabled'}">
          <div class="sm-card-title">${pc.emoji} ${pc.label}</div>
          <div class="sm-card-desc">Rev: $${pc.baseRevenue}/t | Dev: ${pc.developmentTicks} ticks | Min Q: ${pc.minModelQuality}</div>
          <div class="sm-card-cost">${status}</div>
          ${canShip ? `<span class="sm-rival-btn" data-ship-product="${pt}" style="border-color:#AB47BC;color:#AB47BC;margin-top:4px">Start Development</span>` : ''}
        </div>
      `;
    }

    this.openModal('🚀 Ship Product', `<div class="sm-modal-grid">${cards}</div>`);

    this.modalEl.querySelectorAll('[data-ship-product]').forEach(el => {
      (el as HTMLElement).addEventListener('click', () => {
        this.startProductDev((el as HTMLElement).dataset.shipProduct as ProductType);
        this.closeModal();
      });
    });
  }

  // ── DEFEND ──
  private openDefendModal() {
    const co = this.localCompany;
    let cards = '';

    for (const dt of ALL_DEFENSE_TYPES) {
      const dc = DEFENSE_CONFIGS[dt];
      const hasIt = co.defenses.includes(dt);
      const canAfford = co.resources.capital >= dc.cost;

      cards += `
        <div class="sm-modal-card ${hasIt || !canAfford ? 'disabled' : ''}" data-build-defense="${dt}">
          <div class="sm-card-title">${dc.emoji} ${dc.label} ${hasIt ? '✅' : ''}</div>
          <div class="sm-card-desc">${dc.effect}</div>
          <div class="sm-card-cost">${hasIt ? 'Active' : `Build: $${dc.cost} | Maint: $${dc.maintenanceCost}/t`}</div>
        </div>
      `;
    }

    this.openModal('🛡️ Build Defenses', `<div class="sm-modal-grid">${cards}</div>`);

    this.modalEl.querySelectorAll('[data-build-defense]').forEach(el => {
      (el as HTMLElement).addEventListener('click', () => {
        this.buildDefense((el as HTMLElement).dataset.buildDefense as DefenseType);
        this.closeModal();
      });
    });
  }

  // ═══════════════════════════════════════════════════════════════════
  //  ACTIONS (player commands)
  // ═══════════════════════════════════════════════════════════════════

  private hireFromMarket(empId: string) {
    const idx = this.gs.talentMarket.findIndex(e => e.id === empId);
    if (idx < 0) return;
    const emp = this.gs.talentMarket[idx];
    const cost = Math.floor(emp.salary * 10 * FACTION_CONFIGS[this.localCompany.faction].hiringCostMultiplier);
    if (this.localCompany.resources.capital < cost) {
      this.addLog('Cannot afford to hire ' + emp.name, '#EF5350');
      return;
    }
    this.localCompany.resources.capital -= cost;
    this.gs.talentMarket.splice(idx, 1);

    // Auto-assign to matching department
    const preferredDept = ROLE_CONFIGS[emp.role].department;
    const dept = Object.values(this.localCompany.departments).find(
      d => d.type === preferredDept && d.workerIds.length < d.maxWorkers
    );
    if (dept) {
      dept.workerIds.push(emp.id);
      emp.departmentId = dept.id;
    }

    this.localCompany.employees[emp.id] = emp;
    this.addLog(`Hired ${ROLE_CONFIGS[emp.role].emoji} ${emp.name} (${ROLE_CONFIGS[emp.role].label}, skill ${emp.skill})`, '#66BB6A');
    this.refreshOfficeVisuals();
    this.hudDirty = true;
  }

  private startResearch(researchId: string) {
    const co = this.localCompany;
    const node = co.research[researchId];
    if (!node || node.researched || node.active) return;
    if (co.activeResearchId) {
      this.addLog('Already researching something! Finish current research first.', '#EF5350');
      return;
    }
    const prereqMet = node.prerequisites.every(p => co.research[p]?.researched);
    if (!prereqMet) { this.addLog('Prerequisites not met.', '#EF5350'); return; }
    if (node.era > this.gs.era) { this.addLog('Not available in current era.', '#EF5350'); return; }
    if (co.resources.researchPoints < node.cost) { this.addLog('Not enough research points.', '#EF5350'); return; }

    co.resources.researchPoints -= node.cost;
    node.active = true;
    node.progress = 0;
    co.activeResearchId = researchId;
    this.addLog(`Started researching ${node.emoji} ${node.name}`, '#42A5F5');
    this.hudDirty = true;
  }

  private buildDepartment(dt: DepartmentType) {
    const co = this.localCompany;
    const dc = DEPARTMENT_CONFIGS[dt];
    if (co.resources.capital < dc.buildCost) { this.addLog('Cannot afford department.', '#EF5350'); return; }
    if (Object.values(co.departments).some(d => d.type === dt)) { this.addLog('Already have this department.', '#EF5350'); return; }

    co.resources.capital -= dc.buildCost;
    const dId = uid('dept');
    co.departments[dId] = {
      id: dId,
      type: dt,
      level: 1,
      gridPos: { ...DEPT_GRID_POSITIONS[dt] },
      workerIds: [],
      maxWorkers: dc.baseMaxWorkers,
      active: true,
      upgradeCost: dc.upgradeCosts[0] ?? 999999,
    };
    this.addLog(`Built ${dc.emoji} ${dc.label}`, '#FF7043');
    this.refreshOfficeVisuals();
    this.hudDirty = true;
  }

  private upgradeDepartment(deptId: string) {
    const co = this.localCompany;
    const dept = co.departments[deptId];
    if (!dept || dept.level >= 3) return;
    const dc = DEPARTMENT_CONFIGS[dept.type];
    const cost = dc.upgradeCosts[dept.level - 1] ?? 999999;
    if (co.resources.capital < cost) { this.addLog('Cannot afford upgrade.', '#EF5350'); return; }

    co.resources.capital -= cost;
    dept.level++;
    dept.maxWorkers = dc.baseMaxWorkers * dept.level;
    dept.upgradeCost = dc.upgradeCosts[dept.level - 1] ?? 999999;
    this.addLog(`Upgraded ${dc.emoji} ${dc.label} to Lv${dept.level}`, '#FF7043');
    this.refreshOfficeVisuals();
    this.hudDirty = true;
  }

  private handleTrainModel() {
    const co = this.localCompany;
    if (co.trainingActive) {
      this.addLog('Training is already active!', '#FFCA28');
      return;
    }
    if (!co.research['transformers']?.researched) {
      this.addLog('Need to research Transformer Architecture first!', '#EF5350');
      return;
    }
    if (co.resources.compute < SM_CONSTANTS.COMPUTE_PER_TRAINING_TICK) {
      this.addLog('Not enough compute to start training.', '#EF5350');
      return;
    }
    if (co.resources.data < 1) {
      this.addLog('Not enough data to train.', '#EF5350');
      return;
    }
    const hasCluster = Object.values(co.departments).some(d => d.type === 'training_cluster');
    if (!hasCluster) {
      this.addLog('Need a Training Cluster department!', '#EF5350');
      return;
    }
    co.trainingActive = true;
    this.addLog('Training run started! Model quality will improve.', '#FFCA28');
    this.hudDirty = true;
  }

  private startProductDev(pt: ProductType) {
    const co = this.localCompany;
    const pc = PRODUCT_CONFIGS[pt];
    co.productsInDev.push({
      type: pt,
      startedAt: this.gs.tick,
      completesAt: this.gs.tick + pc.developmentTicks,
      quality: co.modelQuality,
    });
    this.addLog(`Started developing ${pc.emoji} ${pc.label}`, '#AB47BC');
    this.hudDirty = true;
  }

  private buildDefense(dt: DefenseType) {
    const co = this.localCompany;
    const dc = DEFENSE_CONFIGS[dt];
    if (co.defenses.includes(dt)) return;
    if (co.resources.capital < dc.cost) { this.addLog('Cannot afford defense.', '#EF5350'); return; }

    co.resources.capital -= dc.cost;
    co.defenses.push(dt);
    this.addLog(`Built ${dc.emoji} ${dc.label}`, '#26C6DA');
    this.hudDirty = true;
  }

  private launchAttack(at: AttackType, targetId: string) {
    const co = this.localCompany;
    const cfg = ATTACK_CONFIGS[at];
    if (co.attackCooldowns[at] > 0) { this.addLog('Attack on cooldown.', '#EF5350'); return; }
    if (co.resources.capital < cfg.cost) { this.addLog('Cannot afford attack.', '#EF5350'); return; }
    if (cfg.era > this.gs.era) { this.addLog('Not available in current era.', '#EF5350'); return; }

    const target = this.gs.companies[targetId];
    if (!target || target.eliminated) { this.addLog('Invalid target.', '#EF5350'); return; }

    co.resources.capital -= cfg.cost * FACTION_CONFIGS[co.faction].espionageCostMultiplier;
    co.attackCooldowns[at] = cfg.cooldownTicks;

    const attack: ActiveAttack = {
      id: uid('atk'),
      type: at,
      attackerId: co.id,
      targetId,
      startTick: this.gs.tick,
      endTick: this.gs.tick + cfg.durationTicks,
      resolved: false,
      success: false,
      detected: false,
    };
    this.gs.activeAttacks.push(attack);
    this.addLog(`Launched ${cfg.emoji} ${cfg.label} on ${FACTION_CONFIGS[target.faction].emoji} ${target.name}!`, '#EF5350');
    this.hudDirty = true;
  }

  // ═══════════════════════════════════════════════════════════════════
  //  TEXT COMMAND PARSER
  // ═══════════════════════════════════════════════════════════════════

  private processTextCommand(raw: string) {
    const lower = raw.toLowerCase().trim();
    this.addLog(`CEO: "${raw}"`, '#C98FFF');

    // hire [N] [role]
    const hireMatch = lower.match(/^hire\s+(\d+)?\s*(ml.researcher|data.engineer|ml.engineer|safety.researcher|product.manager|software.engineer|salesperson|recruiter|pr.comms|spy|security.officer|lawyer|researcher|engineer)?s?$/i);
    if (hireMatch || lower.startsWith('hire')) {
      const count = hireMatch?.[1] ? parseInt(hireMatch[1]) : 1;
      let roleStr = hireMatch?.[2]?.replace(/[.\s]+/g, '_') ?? '';
      // Aliases
      if (roleStr === 'researcher') roleStr = 'ml_researcher';
      if (roleStr === 'engineer') roleStr = 'software_engineer';
      const role = ALL_ROLES.find(r => r === roleStr);

      let hired = 0;
      for (let i = 0; i < count && i < this.gs.talentMarket.length; i++) {
        const candidate = role
          ? this.gs.talentMarket.find(e => e.role === role)
          : this.gs.talentMarket[0];
        if (candidate) {
          this.hireFromMarket(candidate.id);
          hired++;
        }
      }
      if (hired === 0) this.addLog('No suitable candidates in talent market.', '#EF5350');
      return;
    }

    // research [name]
    if (lower.startsWith('research ')) {
      const name = lower.replace('research ', '').trim();
      const node = RESEARCH_TREE.find(r =>
        r.id === name || r.name.toLowerCase().includes(name) || r.id.includes(name.replace(/\s+/g, '_'))
      );
      if (node) {
        this.startResearch(node.id);
      } else {
        this.addLog('Unknown research: ' + name, '#EF5350');
      }
      return;
    }

    // build [dept]
    if (lower.startsWith('build ')) {
      const name = lower.replace('build ', '').trim().replace(/\s+/g, '_');
      // Check for defense
      const defType = ALL_DEFENSE_TYPES.find(d => d === name || d.includes(name) || DEFENSE_CONFIGS[d].label.toLowerCase().includes(name.replace(/_/g, ' ')));
      if (defType) {
        this.buildDefense(defType);
        return;
      }
      const deptType = ALL_DEPT_TYPES.find(d => d === name || d.includes(name) || DEPARTMENT_CONFIGS[d].label.toLowerCase().includes(name.replace(/_/g, ' ')));
      if (deptType) {
        this.buildDepartment(deptType);
      } else {
        this.addLog('Unknown department: ' + name, '#EF5350');
      }
      return;
    }

    // attack [type] [target]
    if (lower.startsWith('attack ') || lower.startsWith('launch ')) {
      const rest = lower.replace(/^(attack|launch)\s+/, '').trim();
      const parts = rest.split(/\s+on\s+|\s+/);
      const atkName = parts[0]?.replace(/\s+/g, '_');
      const targetName = parts.slice(1).join(' ');

      const atkType = ALL_ATTACK_TYPES.find(a => a === atkName || a.includes(atkName) || ATTACK_CONFIGS[a].label.toLowerCase().includes(atkName.replace(/_/g, ' ')));
      const target = Object.values(this.gs.companies).find(c =>
        c.id !== this.localId && !c.eliminated &&
        (c.name.toLowerCase().includes(targetName) || FACTION_CONFIGS[c.faction].id.includes(targetName))
      );

      if (atkType && target) {
        this.launchAttack(atkType, target.id);
      } else {
        this.addLog('Could not parse attack command. Try: attack ddos on titan', '#EF5350');
      }
      return;
    }

    // ship [product]
    if (lower.startsWith('ship ')) {
      const name = lower.replace('ship ', '').trim().replace(/\s+/g, '_');
      const pt = ALL_PRODUCT_TYPES.find(p => p === name || p.includes(name) || PRODUCT_CONFIGS[p].label.toLowerCase().includes(name.replace(/_/g, ' ')));
      if (pt) {
        this.startProductDev(pt);
      } else {
        this.addLog('Unknown product: ' + name, '#EF5350');
      }
      return;
    }

    // train
    if (lower === 'train' || lower === 'start training' || lower === 'train model') {
      this.handleTrainModel();
      return;
    }

    // status
    if (lower === 'status' || lower === 'status report') {
      this.showStatusReport();
      return;
    }

    // start asi
    if (lower === 'start asi' || lower.includes('asi project') || lower.includes('begin asi')) {
      this.startASI();
      return;
    }

    this.addLog('Unknown command. Try: hire, research, build, attack, ship, train, status', '#EF5350');
  }

  private showStatusReport() {
    const co = this.localCompany;
    const r = co.resources;
    const empCount = Object.keys(co.employees).length;
    const deptCount = Object.keys(co.departments).length;
    const prodCount = co.products.filter(p => p.launched).length;

    this.addLog(`--- STATUS REPORT ---`, '#C98FFF');
    this.addLog(`Capital: $${Math.floor(r.capital)} (${co.income >= 0 ? '+' : ''}${co.income.toFixed(1)}/t)`, '#FFCA28');
    this.addLog(`Compute: ${Math.floor(r.compute)} | Data: ${Math.floor(r.data)} | RP: ${Math.floor(r.researchPoints)}`, '#42A5F5');
    this.addLog(`Rep: ${Math.floor(r.reputation)} | Influence: ${Math.floor(r.influence)}`, '#66BB6A');
    this.addLog(`Staff: ${empCount} | Depts: ${deptCount} | Products: ${prodCount}`, '#e0d0ff');
    this.addLog(`Model Quality: ${Math.floor(co.modelQuality)} | Alignment: ${Math.floor(co.alignmentScore)}`, '#26C6DA');
    if (co.trainingActive) this.addLog(`Training ACTIVE`, '#FFCA28');
    if (co.activeResearchId) this.addLog(`Researching: ${co.research[co.activeResearchId]?.name}`, '#42A5F5');
    if (co.asiStarted) this.addLog(`ASI Progress: ${Math.floor(co.asiProgress)}%`, '#EF5350');
    this.addLog(`--------------------`, '#C98FFF');
  }

  private startASI() {
    const co = this.localCompany;
    if (co.asiStarted) { this.addLog('ASI project already underway!', '#FFCA28'); return; }
    if (!co.research['asi_project']?.researched) {
      this.addLog('Must research ASI Project first!', '#EF5350');
      return;
    }
    co.asiStarted = true;
    this.addLog('ASI PROJECT INITIATED! The race is on!', '#EF5350');
    this.hudDirty = true;
  }

  // ═══════════════════════════════════════════════════════════════════
  //  GAME TICK
  // ═══════════════════════════════════════════════════════════════════

  private gameTick() {
    if (this.gs.phase !== 'playing') return;
    this.gs.tick++;
    this.gs.gameTimeMs = this.gs.tick * SM_CONSTANTS.TICK_RATE;

    // Process each company
    for (const co of Object.values(this.gs.companies)) {
      if (co.eliminated) continue;
      this.tickCompany(co);
    }

    // Process active attacks
    this.processAttacks();

    // Process spies
    this.processSpies();

    // Era check
    if (this.gs.tick >= SM_CONSTANTS.ERA_3_TICK && this.gs.era < 3) {
      this.gs.era = 3;
      this.addLog('ERA 3: SUPERINTELLIGENCE has begun!', '#EF5350');
    } else if (this.gs.tick >= SM_CONSTANTS.ERA_2_TICK && this.gs.era < 2) {
      this.gs.era = 2;
      this.addLog('ERA 2: GENERAL AI -- new research and attacks unlocked!', '#FFCA28');
    }

    // Cooldown ticks for all companies
    for (const co of Object.values(this.gs.companies)) {
      if (co.eliminated) continue;
      for (const at of ALL_ATTACK_TYPES) {
        if (co.attackCooldowns[at] > 0) co.attackCooldowns[at]--;
      }
      if (co.uniqueAbilityCooldown > 0) co.uniqueAbilityCooldown--;
    }

    // Talent market refresh
    if (this.gs.tick % SM_CONSTANTS.TALENT_REFRESH_TICKS === 0) {
      this.gs.talentMarket = [];
      for (let t = 0; t < SM_CONSTANTS.TALENT_POOL_SIZE; t++) {
        this.gs.talentMarket.push(makeEmployee(pick(ALL_ROLES), this.gs.tick));
      }
    }

    // Random events
    if (this.gs.tick % SM_CONSTANTS.EVENT_INTERVAL_TICKS === 0 && this.gs.tick > 0) {
      this.generateRandomEvent();
    }

    // Bot AI (every 4 ticks)
    if (this.gs.tick % 4 === 0) {
      for (const co of Object.values(this.gs.companies)) {
        if (co.isBot && !co.eliminated) this.botAI(co);
      }
    }

    // Win/lose checks
    this.checkWinLose();

    // Clamp resources
    for (const co of Object.values(this.gs.companies)) {
      if (co.eliminated) continue;
      co.resources.reputation = clamp(co.resources.reputation, 0, 100);
      co.resources.influence = clamp(co.resources.influence, 0, 100);
      if (co.resources.capital < 0) co.resources.capital = 0;
      if (co.resources.compute < 0) co.resources.compute = 0;
      if (co.resources.data < 0) co.resources.data = 0;
    }

    this.hudDirty = true;
  }

  private tickCompany(co: Company) {
    const fc = FACTION_CONFIGS[co.faction];
    let totalCost = 0;
    let totalRevenue = 0;

    // Pay salaries
    for (const emp of Object.values(co.employees)) {
      totalCost += emp.salary / SM_CONSTANTS.SALARY_TICK_DIVISOR;
    }

    // Department maintenance
    totalCost += Object.keys(co.departments).length * SM_CONSTANTS.DEPT_MAINTENANCE;

    // Defense maintenance
    for (const def of co.defenses) {
      totalCost += DEFENSE_CONFIGS[def].maintenanceCost;
    }

    // Department production
    for (const dept of Object.values(co.departments)) {
      if (!dept.active) continue;
      const workers = dept.workerIds.map(id => co.employees[id]).filter(Boolean);
      if (workers.length === 0) continue;

      switch (dept.type) {
        case 'research_lab': {
          for (const w of workers) {
            const rate = SM_CONSTANTS.RESEARCH_RATE * (w.skill / 10) * fc.researchMultiplier;
            if (co.resources.compute >= SM_CONSTANTS.COMPUTE_PER_RESEARCH_TICK) {
              co.resources.researchPoints += rate;
              co.resources.compute -= SM_CONSTANTS.COMPUTE_PER_RESEARCH_TICK;
            }
          }
          break;
        }
        case 'data_pipeline': {
          for (const w of workers) {
            co.resources.data += SM_CONSTANTS.DATA_RATE * (w.skill / 10);
          }
          break;
        }
        case 'training_cluster': {
          if (co.trainingActive) {
            for (const w of workers) {
              if (co.resources.compute >= SM_CONSTANTS.COMPUTE_PER_TRAINING_TICK && co.resources.data >= 1) {
                const rate = SM_CONSTANTS.TRAINING_RATE * (w.skill / 10);
                let multiplier = 1;
                if (co.research['moe']?.researched) multiplier *= 2;
                if (co.research['massive_pretrain']?.researched) multiplier *= 1.5;
                co.modelQuality += rate * multiplier;
                co.resources.compute -= SM_CONSTANTS.COMPUTE_PER_TRAINING_TICK;
                co.resources.data -= 0.5;
              }
            }
          }
          break;
        }
        case 'eval_safety': {
          if (co.modelQuality > 0) {
            for (const w of workers) {
              co.alignmentScore += SM_CONSTANTS.SAFETY_RATE * (w.skill / 10);
              if (co.research['rlhf']?.researched) co.modelQuality += 0.05;
            }
          }
          break;
        }
        case 'product_studio': {
          // Progress products in dev
          for (let i = co.productsInDev.length - 1; i >= 0; i--) {
            const pid = co.productsInDev[i];
            if (this.gs.tick >= pid.completesAt) {
              const pc = PRODUCT_CONFIGS[pid.type];
              const product: Product = {
                type: pid.type,
                name: pc.label,
                quality: pid.quality,
                marketShare: 10 + Math.floor(pid.quality / 5),
                revenuePerTick: pc.baseRevenue * (pid.quality / 50),
                launched: true,
                launchedAt: this.gs.tick,
              };
              co.products.push(product);
              co.productsInDev.splice(i, 1);
              if (co.isLocal) {
                this.addLog(`${pc.emoji} ${pc.label} launched! Revenue: $${product.revenuePerTick.toFixed(1)}/t`, '#AB47BC');
              }
            }
          }
          break;
        }
        case 'sales_floor': {
          const launchedProducts = co.products.filter(p => p.launched);
          for (const w of workers) {
            for (const prod of launchedProducts) {
              const rev = SM_CONSTANTS.SALES_RATE * (w.skill / 10) * prod.revenuePerTick;
              totalRevenue += rev;
            }
          }
          break;
        }
        case 'hr_office': {
          for (const w of workers) {
            if (w.role === 'recruiter') {
              if (Math.random() < SM_CONSTANTS.RECRUIT_RATE) {
                this.gs.talentMarket.push(makeEmployee(pick(ALL_ROLES), this.gs.tick));
              }
            }
            if (w.role === 'pr_comms') {
              co.resources.reputation += SM_CONSTANTS.PR_RATE * (w.skill / 10) * fc.reputationMultiplier;
            }
          }
          break;
        }
        case 'security_ops': {
          for (const w of workers) {
            if (w.role === 'security_officer') {
              // Spy detection
              const detectChance = SM_CONSTANTS.SPY_DETECTION_BASE * (w.skill / 10);
              const hasCounterIntel = co.defenses.includes('counter_intel');
              const finalChance = hasCounterIntel ? detectChance * 2 : detectChance;

              // Check incoming spies from other companies
              for (const otherCo of Object.values(this.gs.companies)) {
                if (otherCo.id === co.id || otherCo.eliminated) continue;
                for (let si = otherCo.activeSentSpies.length - 1; si >= 0; si--) {
                  const spy = otherCo.activeSentSpies[si];
                  if (spy.targetCompanyId === co.id && !spy.detected && Math.random() < finalChance) {
                    spy.detected = true;
                    otherCo.activeSentSpies.splice(si, 1);
                    if (co.isLocal) this.addLog('Counter-intel caught an enemy spy!', '#26C6DA');
                    if (otherCo.isLocal) this.addLog('Your spy was detected and eliminated!', '#EF5350');
                  }
                }
              }
            }
          }
          break;
        }
        case 'legal': {
          for (const w of workers) {
            co.resources.influence += SM_CONSTANTS.INFLUENCE_RATE * (w.skill / 10);
          }
          break;
        }
      }
    }

    // Research progression
    if (co.activeResearchId) {
      const node = co.research[co.activeResearchId];
      if (node && !node.researched) {
        // Researchers speed up research
        const researchers = Object.values(co.employees).filter(e => e.role === 'ml_researcher' && e.departmentId);
        const researchBoost = researchers.length > 0 ? 1 + researchers.length * 0.1 : 1;
        node.progress += researchBoost;

        if (node.progress >= node.timeTicks) {
          node.researched = true;
          node.active = false;
          co.activeResearchId = null;
          if (co.isLocal) {
            this.addLog(`Research complete: ${node.emoji} ${node.name} -- ${node.effect}`, '#66BB6A');
          }
          // Apply research effects
          this.applyResearchEffect(co, node);
        }
      }
    }

    // Compute generation from cloud_compute research
    if (co.research['cloud_compute']?.researched) {
      co.resources.compute += 2 * fc.computeMultiplier;
    }
    // Custom silicon
    if (co.research['custom_silicon']?.researched) {
      co.resources.compute += 5 * fc.computeMultiplier;
    }
    // Data licensing
    if (co.research['data_licensing']?.researched) {
      co.resources.data += 0.5;
    }

    // ASI progress
    if (co.asiStarted) {
      const researchers = Object.values(co.employees).filter(e => e.role === 'ml_researcher' && e.departmentId);
      const qualityFactor = Math.max(0.1, co.modelQuality / 100);
      for (const r of researchers) {
        co.asiProgress += SM_CONSTANTS.ASI_PROGRESS_RATE * (r.skill / 10) * qualityFactor;
      }

      if (co.asiProgress >= 100) {
        co.asiProgress = 100;
        // Check alignment
        if (co.alignmentScore >= SM_CONSTANTS.ASI_ALIGNMENT_THRESHOLD) {
          // Safe ASI -- winner!
          this.gs.winnerId = co.id;
          this.gs.winCondition = 'ASI (aligned)';
          this.gs.phase = 'ended';
          if (co.isLocal) {
            this.addLog('YOUR ASI IS ALIGNED! YOU WIN!', '#66BB6A');
          } else {
            this.addLog(`${FACTION_CONFIGS[co.faction].emoji} ${co.name} achieved aligned ASI!`, '#EF5350');
          }
        } else {
          // Rogue ASI check
          const rogueChance = co.alignmentScore < 20
            ? SM_CONSTANTS.ASI_ROGUE_CHANCE_NO_ALIGNMENT
            : SM_CONSTANTS.ASI_ROGUE_CHANCE_LOW_ALIGNMENT;
          if (Math.random() < rogueChance) {
            // Rogue -- everyone loses or the company is destroyed
            co.eliminated = true;
            co.eliminatedAt = this.gs.tick;
            co.eliminatedBy = 'rogue_asi';
            if (co.isLocal) {
              this.addLog('YOUR ASI WENT ROGUE! You are eliminated!', '#EF5350');
            } else {
              this.addLog(`${FACTION_CONFIGS[co.faction].emoji} ${co.name}'s ASI went rogue!`, '#FFCA28');
            }
          } else {
            this.gs.winnerId = co.id;
            this.gs.winCondition = 'ASI (risky but survived)';
            this.gs.phase = 'ended';
          }
        }
      }
    }

    // Net income
    co.resources.capital += totalRevenue - totalCost;
    co.income = totalRevenue - totalCost;
    co.totalRevenue += totalRevenue;
  }

  private applyResearchEffect(co: Company, node: ResearchNode) {
    // Most effects are passively checked in tickCompany
    // Some provide immediate bonuses
    switch (node.id) {
      case 'chain_of_thought':
        co.modelQuality += 5;
        break;
      case 'rlhf':
        co.alignmentScore += 10;
        co.modelQuality += 3;
        break;
      case 'constitutional_ai':
        co.alignmentScore += 15;
        break;
      case 'interpretability':
        co.alignmentScore += 10;
        break;
      case 'recursive_improve':
        // Passive effect: researchers generate extra RP (handled in tick)
        break;
      case 'web_scraping':
        co.resources.data += 20;
        break;
      case 'advanced_cyber':
        // Reduce all attack cooldowns by 30%
        for (const at of ALL_ATTACK_TYPES) {
          co.attackCooldowns[at] = Math.floor(co.attackCooldowns[at] * 0.7);
        }
        break;
    }
  }

  // ── ATTACKS ──
  private processAttacks() {
    for (let i = this.gs.activeAttacks.length - 1; i >= 0; i--) {
      const atk = this.gs.activeAttacks[i];
      if (atk.resolved) continue;
      if (this.gs.tick < atk.endTick) continue;

      atk.resolved = true;
      const cfg = ATTACK_CONFIGS[atk.type];
      const attacker = this.gs.companies[atk.attackerId];
      const target = this.gs.companies[atk.targetId];
      if (!attacker || !target || target.eliminated) continue;

      // Defense modifiers
      let successRate = cfg.successRate;
      if (target.defenses.includes('firewall') && ['ddos', 'data_breach', 'sabotage_training', 'infrastructure_strike'].includes(atk.type)) {
        successRate *= 0.5;
      }
      if (target.defenses.includes('talent_retention') && atk.type === 'talent_poach') {
        successRate *= 0.5;
      }
      if (target.defenses.includes('legal_shield') && atk.type === 'patent_troll') {
        successRate *= 0.3;
      }
      successRate *= FACTION_CONFIGS[attacker.faction].defenseBonusMultiplier > 1 ? 1 : 1; // attacker perspective

      atk.success = Math.random() < successRate;
      atk.detected = Math.random() < cfg.detectionChance;

      if (atk.success) {
        this.resolveAttackSuccess(atk, attacker, target);
      }

      if (atk.detected) {
        attacker.resources.reputation -= cfg.reputationLoss;
        if (target.defenses.includes('pr_shield')) {
          // PR shield reduces rep damage to target from media attacks
        }
        if (target.isLocal) {
          this.addLog(`Detected ${cfg.emoji} ${cfg.label} from ${FACTION_CONFIGS[attacker.faction].emoji} ${attacker.name}!`, '#EF5350');
        }
        if (attacker.isLocal) {
          this.addLog(`Your ${cfg.label} was detected! Reputation -${cfg.reputationLoss}`, '#EF5350');
        }
      }

      if (attacker.isLocal) {
        this.addLog(`${cfg.emoji} ${cfg.label}: ${atk.success ? 'SUCCESS' : 'FAILED'}`, atk.success ? '#66BB6A' : '#EF5350');
      }

      // Remove resolved attacks
      this.gs.activeAttacks.splice(i, 1);
    }
  }

  private resolveAttackSuccess(atk: ActiveAttack, attacker: Company, target: Company) {
    switch (atk.type) {
      case 'talent_poach': {
        const empIds = Object.keys(target.employees);
        if (empIds.length > 0) {
          const stolenId = pick(empIds);
          const emp = target.employees[stolenId];
          // Remove from target
          if (emp.departmentId && target.departments[emp.departmentId]) {
            const dept = target.departments[emp.departmentId];
            dept.workerIds = dept.workerIds.filter(id => id !== stolenId);
          }
          delete target.employees[stolenId];
          // Add to attacker
          emp.departmentId = null;
          attacker.employees[stolenId] = emp;
          if (attacker.isLocal) this.addLog(`Poached ${ROLE_CONFIGS[emp.role].emoji} ${emp.name} from rival!`, '#66BB6A');
        }
        break;
      }
      case 'ddos': {
        // Disable products for duration (already handled by duration)
        for (const p of target.products) {
          if (p.launched) p.revenuePerTick *= 0; // temporary -- gets restored
        }
        // Restore after a delay
        this.time.delayedCall(cfg_ddos_duration(), () => {
          for (const p of target.products) {
            if (p.launched) {
              const pc = PRODUCT_CONFIGS[p.type];
              p.revenuePerTick = pc.baseRevenue * (p.quality / 50);
            }
          }
        });
        break;
      }
      case 'data_breach': {
        attacker.resources.data += target.resources.data * 0.3;
        if (attacker.isLocal) this.addLog('Copied 30% of rival training data!', '#66BB6A');
        break;
      }
      case 'sabotage_training': {
        if (target.trainingActive) {
          target.modelQuality = Math.max(0, target.modelQuality - 10);
          target.trainingActive = false;
          if (target.isLocal) this.addLog('Training run sabotaged! Model quality lost!', '#EF5350');
        }
        break;
      }
      case 'plant_spy': {
        const spy: ActiveSpy = {
          id: uid('spy'),
          companyId: attacker.id,
          targetCompanyId: target.id,
          plantedAt: this.gs.tick,
          detected: false,
          intelGathered: 0,
        };
        attacker.activeSentSpies.push(spy);
        if (attacker.isLocal) this.addLog('Spy planted in rival company!', '#66BB6A');
        break;
      }
      case 'media_leak': {
        const repDamage = 15 + randInt(0, 10);
        target.resources.reputation -= target.defenses.includes('pr_shield') ? repDamage * 0.5 : repDamage;
        if (target.isLocal) this.addLog('Media leak damaged your reputation!', '#EF5350');
        break;
      }
      case 'patent_troll': {
        // Block next product launch for 30 ticks
        for (const pid of target.productsInDev) {
          pid.completesAt += 30;
        }
        if (target.isLocal) this.addLog('Patent troll delayed your product launch!', '#EF5350');
        break;
      }
      case 'hostile_takeover': {
        if (target.resources.capital < attacker.resources.capital / 3) {
          target.eliminated = true;
          target.eliminatedAt = this.gs.tick;
          target.eliminatedBy = attacker.id;
          if (attacker.isLocal) this.addLog(`Hostile takeover of ${target.name} SUCCEEDED!`, '#66BB6A');
          if (target.isLocal) this.addLog('You have been acquired! Game over.', '#EF5350');
        }
        break;
      }
      case 'infrastructure_strike': {
        target.resources.compute = Math.max(0, target.resources.compute - 50);
        target.trainingActive = false;
        if (target.isLocal) this.addLog('Infrastructure strike destroyed compute capacity!', '#EF5350');
        break;
      }
    }
  }

  private processSpies() {
    for (const co of Object.values(this.gs.companies)) {
      if (co.eliminated) continue;
      for (const spy of co.activeSentSpies) {
        if (spy.detected) continue;
        const target = this.gs.companies[spy.targetCompanyId];
        if (!target || target.eliminated) continue;
        const leakedRP = SM_CONSTANTS.SPY_INTEL_RATE;
        if (target.resources.researchPoints >= leakedRP) {
          target.resources.researchPoints -= leakedRP;
          co.resources.researchPoints += leakedRP;
          spy.intelGathered += leakedRP;
        }
      }
    }
  }

  // ── EVENTS ──
  private generateRandomEvent() {
    const eventTypes = [
      { title: 'Compute Auction', desc: 'GPU cluster available at discount!', effect: 'compute_boost', emoji: '🖥️' },
      { title: 'Star Researcher', desc: 'A famous researcher is looking for work.', effect: 'star_hire', emoji: '🌟' },
      { title: 'Government Contract', desc: 'Defense department wants an AI system.', effect: 'gov_contract', emoji: '🏛️' },
      { title: 'Data Breach Scandal', desc: 'Industry-wide security concerns.', effect: 'rep_shake', emoji: '💿' },
      { title: 'Market Boom', desc: 'AI stocks surge! Revenue boost.', effect: 'market_boom', emoji: '📈' },
      { title: 'Regulation Threat', desc: 'New AI regulation proposed.', effect: 'regulation', emoji: '⚖️' },
    ];
    const evt = pick(eventTypes);
    this.addLog(`EVENT: ${evt.emoji} ${evt.title} -- ${evt.desc}`, '#FFD93D');

    // Apply event to all companies
    for (const co of Object.values(this.gs.companies)) {
      if (co.eliminated) continue;
      switch (evt.effect) {
        case 'compute_boost': co.resources.compute += 20; break;
        case 'star_hire': {
          const star = makeEmployee(pick(['ml_researcher', 'safety_researcher', 'ml_engineer'] as EmployeeRole[]), this.gs.tick);
          star.skill = randInt(8, 10);
          star.name = 'Dr. ' + star.name;
          this.gs.talentMarket.push(star);
          break;
        }
        case 'gov_contract': co.resources.capital += 50 + Math.floor(co.resources.influence); break;
        case 'rep_shake': co.resources.reputation -= 5; break;
        case 'market_boom': {
          for (const p of co.products) {
            if (p.launched) p.revenuePerTick *= 1.5;
          }
          break;
        }
        case 'regulation': co.resources.influence -= 5; break;
      }
    }
  }

  // ── WIN / LOSE ──
  private checkWinLose() {
    if (this.gs.phase !== 'playing') return;

    // Bankruptcy
    for (const co of Object.values(this.gs.companies)) {
      if (co.eliminated) continue;
      if (co.resources.capital <= 0 && this.gs.tick > SM_CONSTANTS.MIN_ELIMINATION_TICK) {
        co.eliminated = true;
        co.eliminatedAt = this.gs.tick;
        co.eliminatedBy = 'bankruptcy';
        if (co.isLocal) {
          this.addLog('BANKRUPT! You are eliminated.', '#EF5350');
        } else {
          this.addLog(`${FACTION_CONFIGS[co.faction].emoji} ${co.name} went bankrupt!`, '#FFCA28');
        }
      }
    }

    // Last standing
    const alive = Object.values(this.gs.companies).filter(c => !c.eliminated);
    if (alive.length === 1) {
      this.gs.winnerId = alive[0].id;
      this.gs.winCondition = 'Last company standing';
      this.gs.phase = 'ended';
      this.addLog(`${FACTION_CONFIGS[alive[0].faction].emoji} ${alive[0].name} wins by elimination!`, '#66BB6A');
    }

    // Time up
    if (this.gs.gameTimeMs >= SM_CONSTANTS.MATCH_DURATION) {
      const best = alive.reduce((a, b) => a.modelQuality > b.modelQuality ? a : b, alive[0]);
      if (best) {
        this.gs.winnerId = best.id;
        this.gs.winCondition = 'Highest model quality';
        this.gs.phase = 'ended';
        this.addLog(`Time's up! ${FACTION_CONFIGS[best.faction].emoji} ${best.name} wins with Q${Math.floor(best.modelQuality)}!`, '#66BB6A');
      }
    }

    // Show game over
    if (this.gs.phase === 'ended') {
      this.showGameOver();
    }
  }

  private showGameOver() {
    const winner = this.gs.winnerId ? this.gs.companies[this.gs.winnerId] : null;
    const isLocalWin = winner?.isLocal ?? false;
    const title = isLocalWin ? 'VICTORY!' : 'DEFEAT';
    const color = isLocalWin ? '#66BB6A' : '#EF5350';
    const desc = winner
      ? `${FACTION_CONFIGS[winner.faction].emoji} ${winner.name} wins! (${this.gs.winCondition})`
      : 'No winner.';

    this.openModal(title, `
      <div style="text-align:center;padding:20px">
        <div style="font-size:40px;margin-bottom:12px">${isLocalWin ? '🏆' : '💀'}</div>
        <div style="font-size:18px;color:${color};font-weight:700;margin-bottom:8px">${title}</div>
        <div style="font-size:14px;color:#e0d0ff">${desc}</div>
        <div style="margin-top:20px">
          <button class="sm-action-btn" id="sm-btn-restart" style="border-color:#C98FFF;color:#C98FFF;font-size:14px;padding:8px 24px">Return to Menu</button>
        </div>
      </div>
    `);
    document.getElementById('sm-btn-restart')?.addEventListener('click', () => {
      this.cleanupHUD();
      this.scene.start('MenuScene');
    });
  }

  // ═══════════════════════════════════════════════════════════════════
  //  BOT AI
  // ═══════════════════════════════════════════════════════════════════

  private botAI(co: Company) {
    const fc = FACTION_CONFIGS[co.faction];

    // 1. Hire when departments have empty slots
    for (const dept of Object.values(co.departments)) {
      if (dept.workerIds.length < dept.maxWorkers) {
        const preferredRole = this.getDeptPreferredRole(dept.type);
        const candidate = this.gs.talentMarket.find(e => e.role === preferredRole)
          ?? this.gs.talentMarket[0];
        if (candidate) {
          const cost = Math.floor(candidate.salary * 10 * fc.hiringCostMultiplier);
          if (co.resources.capital >= cost + 100) { // keep buffer
            co.resources.capital -= cost;
            const idx = this.gs.talentMarket.indexOf(candidate);
            if (idx >= 0) this.gs.talentMarket.splice(idx, 1);
            dept.workerIds.push(candidate.id);
            candidate.departmentId = dept.id;
            co.employees[candidate.id] = candidate;
          }
        }
      }
    }

    // 2. Research: pick highest-priority available
    if (!co.activeResearchId) {
      const priorities = ['transformers', 'web_scraping', 'cloud_compute', 'basic_nlp',
        'data_licensing', 'chain_of_thought', 'moe', 'rlhf', 'tool_use',
        'massive_pretrain', 'advanced_cyber', 'ai_security',
        'recursive_improve', 'world_models', 'autonomous_research', 'asi_project'];
      for (const rId of priorities) {
        const node = co.research[rId];
        if (!node || node.researched || node.active) continue;
        if (node.era > this.gs.era) continue;
        if (!node.prerequisites.every(p => co.research[p]?.researched)) continue;
        if (co.resources.researchPoints >= node.cost) {
          co.resources.researchPoints -= node.cost;
          node.active = true;
          node.progress = 0;
          co.activeResearchId = rId;
          break;
        }
      }
    }

    // 3. Build departments when affordable
    const builtTypes = new Set(Object.values(co.departments).map(d => d.type));
    const deptPriority: DepartmentType[] = ['training_cluster', 'sales_floor', 'eval_safety', 'hr_office', 'security_ops', 'legal'];
    for (const dt of deptPriority) {
      if (builtTypes.has(dt)) continue;
      const dc = DEPARTMENT_CONFIGS[dt];
      if (co.resources.capital >= dc.buildCost + 150) {
        co.resources.capital -= dc.buildCost;
        const dId = uid('dept');
        co.departments[dId] = {
          id: dId, type: dt, level: 1,
          gridPos: { ...DEPT_GRID_POSITIONS[dt] },
          workerIds: [], maxWorkers: dc.baseMaxWorkers,
          active: true, upgradeCost: dc.upgradeCosts[0] ?? 999999,
        };
        break;
      }
    }

    // 4. Start training when data + compute available
    if (!co.trainingActive && co.research['transformers']?.researched) {
      const hasCluster = Object.values(co.departments).some(d => d.type === 'training_cluster');
      if (hasCluster && co.resources.compute >= 10 && co.resources.data >= 5) {
        co.trainingActive = true;
      }
    }

    // 5. Ship products when requirements met
    for (const pt of ALL_PRODUCT_TYPES) {
      const pc = PRODUCT_CONFIGS[pt];
      if (co.products.some(p => p.type === pt)) continue;
      if (co.productsInDev.some(p => p.type === pt)) continue;
      const hasResearch = pc.requiredResearch.every(rId => co.research[rId]?.researched);
      const hasDepts = pc.requiredDepartments.every(dt => Object.values(co.departments).some(d => d.type === dt));
      if (hasResearch && hasDepts && co.modelQuality >= pc.minModelQuality) {
        co.productsInDev.push({
          type: pt,
          startedAt: this.gs.tick,
          completesAt: this.gs.tick + pc.developmentTicks,
          quality: co.modelQuality,
        });
        break;
      }
    }

    // 6. Attack rivals (prefer weakest)
    if (Math.random() < 0.3) {
      const rivals = Object.values(this.gs.companies).filter(c => c.id !== co.id && !c.eliminated);
      if (rivals.length > 0) {
        const weakest = rivals.reduce((a, b) => a.resources.capital < b.resources.capital ? a : b);
        const availAttacks = ALL_ATTACK_TYPES.filter(at => {
          const cfg = ATTACK_CONFIGS[at];
          return cfg.era <= this.gs.era && co.attackCooldowns[at] <= 0 && co.resources.capital >= cfg.cost * 2;
        });
        if (availAttacks.length > 0) {
          const at = pick(availAttacks);
          const cfg = ATTACK_CONFIGS[at];
          co.resources.capital -= cfg.cost * FACTION_CONFIGS[co.faction].espionageCostMultiplier;
          co.attackCooldowns[at] = cfg.cooldownTicks;
          this.gs.activeAttacks.push({
            id: uid('atk'), type: at, attackerId: co.id, targetId: weakest.id,
            startTick: this.gs.tick, endTick: this.gs.tick + cfg.durationTicks,
            resolved: false, success: false, detected: false,
          });
          if (weakest.isLocal) {
            this.addLog(`${FACTION_CONFIGS[co.faction].emoji} ${co.name} is attacking you!`, '#EF5350');
          }
        }
      }
    }

    // 7. Build defenses reactively
    if (co.defenses.length < 3 && co.resources.capital > 300) {
      const needed = ALL_DEFENSE_TYPES.filter(d => !co.defenses.includes(d));
      if (needed.length > 0) {
        const dt = pick(needed);
        const dc = DEFENSE_CONFIGS[dt];
        if (co.resources.capital >= dc.cost + 200) {
          co.resources.capital -= dc.cost;
          co.defenses.push(dt);
        }
      }
    }

    // 8. Start ASI if ready
    if (!co.asiStarted && co.research['asi_project']?.researched && co.modelQuality >= 60) {
      co.asiStarted = true;
      this.addLog(`${FACTION_CONFIGS[co.faction].emoji} ${co.name} started the ASI project!`, '#EF5350');
    }
  }

  private getDeptPreferredRole(dt: DepartmentType): EmployeeRole {
    const map: Record<DepartmentType, EmployeeRole> = {
      research_lab: 'ml_researcher',
      data_pipeline: 'data_engineer',
      training_cluster: 'ml_engineer',
      eval_safety: 'safety_researcher',
      product_studio: 'software_engineer',
      sales_floor: 'salesperson',
      hr_office: 'recruiter',
      security_ops: 'security_officer',
      legal: 'lawyer',
    };
    return map[dt];
  }

  // ═══════════════════════════════════════════════════════════════════
  //  INPUT
  // ═══════════════════════════════════════════════════════════════════

  private setupInput() {
    this.cursors = this.input.keyboard!.createCursorKeys();
    this.wasd = {
      W: this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.W),
      A: this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.A),
      S: this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.S),
      D: this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.D),
    };

    // Number keys for department selection
    for (let n = 1; n <= 9; n++) {
      this.input.keyboard!.on(`keydown-${String(n)}`, () => {
        const depts = Object.values(this.localCompany.departments);
        if (n - 1 < depts.length) {
          this.selectedDeptId = depts[n - 1].id;
          this.hudDirty = true;
        }
      });
    }

    // Escape to deselect
    this.input.keyboard!.on('keydown-ESC', () => {
      this.selectedDeptId = null;
      this.closeModal();
      this.hudDirty = true;
    });

    // Tab to cycle views
    this.input.keyboard!.on('keydown-TAB', (event: KeyboardEvent) => {
      event.preventDefault();
      const views: ('office' | 'research' | 'market')[] = ['office', 'research', 'market'];
      const idx = views.indexOf(this.activeView);
      this.activeView = views[(idx + 1) % views.length];
      if (this.activeView === 'research') this.openResearchModal();
      else if (this.activeView === 'market') this.openHireModal();
      else this.closeModal();
    });

    // Click on departments in the game world
    this.input.on('pointerdown', (pointer: Phaser.Input.Pointer) => {
      if (pointer.downElement !== this.game.canvas) return;
      const worldX = pointer.worldX;
      const worldY = pointer.worldY;
      const ts = SM_CONSTANTS.TILE_SIZE;

      // Check if click is on a department
      for (const dept of Object.values(this.localCompany.departments)) {
        const px = dept.gridPos.x * ts;
        const py = dept.gridPos.y * ts;
        if (worldX >= px && worldX <= px + 2 * ts && worldY >= py && worldY <= py + 2 * ts) {
          this.selectedDeptId = dept.id;
          this.hudDirty = true;
          return;
        }
      }
      this.selectedDeptId = null;
      this.hudDirty = true;
    });
  }

  // ═══════════════════════════════════════════════════════════════════
  //  UPDATE (Phaser render loop)
  // ═══════════════════════════════════════════════════════════════════

  update(_time: number, delta: number) {
    if (this.gs.phase !== 'playing' && this.gs.phase !== 'ended') return;

    // Camera pan with WASD / arrows
    const cam = this.cameras.main;
    const speed = this.camSpeed * (delta / 16);
    if (this.cursors.left.isDown || this.wasd.A.isDown) cam.scrollX -= speed;
    if (this.cursors.right.isDown || this.wasd.D.isDown) cam.scrollX += speed;
    if (this.cursors.up.isDown || this.wasd.W.isDown) cam.scrollY -= speed;
    if (this.cursors.down.isDown || this.wasd.S.isDown) cam.scrollY += speed;

    // Employee movement interpolation
    const co = this.localCompany;
    for (const emp of Object.values(co.employees)) {
      const circle = this.empCircles.get(emp.id);
      if (!circle) continue;

      if (emp.targetPosition) {
        const dx = emp.targetPosition.x - emp.position.x;
        const dy = emp.targetPosition.y - emp.position.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist > 1) {
          const moveSpeed = 0.8;
          emp.position.x += dx * moveSpeed * (delta / 500);
          emp.position.y += dy * moveSpeed * (delta / 500);
        } else {
          emp.position.x = emp.targetPosition.x;
          emp.position.y = emp.targetPosition.y;
        }
      }
      circle.setPosition(emp.position.x, emp.position.y);
    }

    // Update employee target positions based on department assignment
    if (this.gs.tick % 8 === 0) {
      this.updateEmployeeTargets();
    }

    // Selection highlight
    this.selectionGfx.clear();
    if (this.selectedDeptId) {
      const dept = co.departments[this.selectedDeptId];
      if (dept) {
        const ts = SM_CONSTANTS.TILE_SIZE;
        const px = dept.gridPos.x * ts;
        const py = dept.gridPos.y * ts;
        const phase = Math.sin(_time / 300) * 0.3 + 0.7;
        const dc = DEPARTMENT_CONFIGS[dept.type];
        this.selectionGfx.lineStyle(3, dc.color, phase);
        this.selectionGfx.strokeRect(px, py, 2 * ts, 2 * ts);
      }
    }

    // Pulse active departments
    this.particleGfx.clear();
    for (const dept of Object.values(co.departments)) {
      if (dept.workerIds.length > 0) {
        const ts = SM_CONSTANTS.TILE_SIZE;
        const px = dept.gridPos.x * ts + ts;
        const py = dept.gridPos.y * ts + ts;
        const pulse = Math.sin(_time / 500 + dept.gridPos.x) * 3 + 5;
        const dc = DEPARTMENT_CONFIGS[dept.type];
        this.particleGfx.fillStyle(dc.color, 0.15);
        this.particleGfx.fillCircle(px, py, pulse + 15);
      }
    }

    // Update HUD periodically
    if (this.hudDirty || this.gs.tick % 2 === 0) {
      this.updateHUD();
      this.hudDirty = false;
    }
  }

  private updateEmployeeTargets() {
    const co = this.localCompany;
    const ts = SM_CONSTANTS.TILE_SIZE;

    for (const emp of Object.values(co.employees)) {
      const dept = emp.departmentId ? co.departments[emp.departmentId] : null;
      if (dept) {
        const deptPx = dept.gridPos.x * ts + ts;
        const deptPy = dept.gridPos.y * ts + ts;
        const idx = dept.workerIds.indexOf(emp.id);
        const total = Math.max(dept.workerIds.length, 1);
        const angle = (idx / total) * Math.PI * 2 + this.gs.tick * 0.02;
        const radius = 20 + (idx % 2) * 12;
        emp.targetPosition = {
          x: deptPx + Math.cos(angle) * radius,
          y: deptPy + Math.sin(angle) * radius,
        };
      } else {
        // Unassigned employees wander
        if (!emp.targetPosition || Math.random() < 0.05) {
          emp.targetPosition = {
            x: randInt(50, co.officeWidth * ts - 50),
            y: randInt(50, co.officeHeight * ts - 50),
          };
        }
      }
    }
  }

  // ═══════════════════════════════════════════════════════════════════
  //  CLEANUP
  // ═══════════════════════════════════════════════════════════════════

  private cleanupHUD() {
    const hudRoot = document.getElementById('sm-hud');
    if (hudRoot) hudRoot.remove();
    const hudStyles = document.getElementById('sm-hud-styles');
    if (hudStyles) hudStyles.remove();
  }

  shutdown() {
    this.cleanupHUD();
    if (this.tickTimer) this.tickTimer.destroy();
  }

  destroy() {
    this.cleanupHUD();
  }
}

// Helper for DDoS duration
function cfg_ddos_duration(): number {
  return ATTACK_CONFIGS.ddos.durationTicks * SM_CONSTANTS.TICK_RATE;
}
