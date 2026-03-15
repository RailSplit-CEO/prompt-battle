// ─── Silicon Minds: AI Company Warfare ─────────────────────────────────
// Multiplayer competitive strategy — voice-commanded CEO simulator

export interface Position { x: number; y: number; }

// ─── Factions ──────────────────────────────────────────────────────────

export type Faction = 'titan' | 'prometheus' | 'catalyst' | 'specter' | 'openforge' | 'nexus';

export interface FactionConfig {
  id: Faction;
  name: string;
  tagline: string;
  color: number;        // hex
  colorStr: string;     // css
  emoji: string;
  computeMultiplier: number;
  researchMultiplier: number;
  reputationMultiplier: number;
  hiringCostMultiplier: number;
  espionageCostMultiplier: number;
  defenseBonusMultiplier: number;
  startingBonusCapital: number;
  startingBonusCompute: number;
  uniqueAbility: string;
  uniqueAbilityCooldown: number; // ticks
}

export const FACTION_CONFIGS: Record<Faction, FactionConfig> = {
  titan: {
    id: 'titan', name: 'Titan Systems', tagline: 'Throw more GPUs at it.',
    color: 0xE53935, colorStr: '#E53935', emoji: '🔴',
    computeMultiplier: 2.0, researchMultiplier: 1.0, reputationMultiplier: 0.8,
    hiringCostMultiplier: 1.4, espionageCostMultiplier: 1.0, defenseBonusMultiplier: 1.0,
    startingBonusCapital: 0, startingBonusCompute: 50,
    uniqueAbility: 'datacenter_blitz', uniqueAbilityCooldown: 120,
  },
  prometheus: {
    id: 'prometheus', name: 'Prometheus Labs', tagline: 'Alignment first.',
    color: 0x1E88E5, colorStr: '#1E88E5', emoji: '🔵',
    computeMultiplier: 1.0, researchMultiplier: 0.8, reputationMultiplier: 1.5,
    hiringCostMultiplier: 0.9, espionageCostMultiplier: 1.5, defenseBonusMultiplier: 1.3,
    startingBonusCapital: 100, startingBonusCompute: 0,
    uniqueAbility: 'whistleblower_network', uniqueAbilityCooldown: 90,
  },
  catalyst: {
    id: 'catalyst', name: 'Catalyst Ventures', tagline: 'Ship it, fundraise, repeat.',
    color: 0x43A047, colorStr: '#43A047', emoji: '🟢',
    computeMultiplier: 1.0, researchMultiplier: 1.0, reputationMultiplier: 1.0,
    hiringCostMultiplier: 1.0, espionageCostMultiplier: 1.0, defenseBonusMultiplier: 0.7,
    startingBonusCapital: 300, startingBonusCompute: 0,
    uniqueAbility: 'funding_frenzy', uniqueAbilityCooldown: 100,
  },
  specter: {
    id: 'specter', name: 'Specter Group', tagline: 'What we build is classified.',
    color: 0x424242, colorStr: '#616161', emoji: '⚫',
    computeMultiplier: 1.0, researchMultiplier: 1.0, reputationMultiplier: 0.7,
    hiringCostMultiplier: 1.2, espionageCostMultiplier: 0.5, defenseBonusMultiplier: 1.5,
    startingBonusCapital: 0, startingBonusCompute: 0,
    uniqueAbility: 'zero_day', uniqueAbilityCooldown: 150,
  },
  openforge: {
    id: 'openforge', name: 'OpenForge Collective', tagline: 'Open source everything.',
    color: 0xFDD835, colorStr: '#FDD835', emoji: '🟡',
    computeMultiplier: 1.0, researchMultiplier: 1.3, reputationMultiplier: 1.2,
    hiringCostMultiplier: 0.7, espionageCostMultiplier: 2.0, defenseBonusMultiplier: 0.6,
    startingBonusCapital: 0, startingBonusCompute: 0,
    uniqueAbility: 'open_source_bomb', uniqueAbilityCooldown: 180,
  },
  nexus: {
    id: 'nexus', name: 'Nexus AI', tagline: 'Adaptable. Relentless.',
    color: 0xAB47BC, colorStr: '#AB47BC', emoji: '🟣',
    computeMultiplier: 1.1, researchMultiplier: 1.1, reputationMultiplier: 1.1,
    hiringCostMultiplier: 1.0, espionageCostMultiplier: 1.0, defenseBonusMultiplier: 1.0,
    startingBonusCapital: 100, startingBonusCompute: 20,
    uniqueAbility: 'pivot', uniqueAbilityCooldown: 300, // once per game effectively
  },
};

// ─── Resources ─────────────────────────────────────────────────────────

export interface Resources {
  capital: number;       // money — pays for everything
  compute: number;       // GPU-hours — trains models
  data: number;          // training data quality score
  researchPoints: number; // unlocks tech
  reputation: number;    // 0-100, attracts talent & customers
  influence: number;     // 0-100, political power
}

// ─── Employees ─────────────────────────────────────────────────────────

export type EmployeeRole =
  | 'ml_researcher' | 'data_engineer' | 'ml_engineer' | 'safety_researcher'
  | 'product_manager' | 'software_engineer' | 'salesperson' | 'recruiter'
  | 'pr_comms' | 'spy' | 'security_officer' | 'lawyer';

export interface Employee {
  id: string;
  name: string;
  role: EmployeeRole;
  skill: number;         // 1-10
  loyalty: number;       // 0-100
  morale: number;        // 0-100
  ethics: 'low' | 'medium' | 'high';
  departmentId: string | null;
  salary: number;        // capital per tick
  hiredAt: number;       // game tick
  // Visual
  position: Position;    // current pixel position for rendering
  targetPosition: Position | null;
  busy: boolean;         // currently doing a task
}

export interface EmployeeRoleConfig {
  role: EmployeeRole;
  label: string;
  emoji: string;
  baseSalary: number;
  department: DepartmentType; // preferred department
  description: string;
}

export const ROLE_CONFIGS: Record<EmployeeRole, EmployeeRoleConfig> = {
  ml_researcher:    { role: 'ml_researcher',    label: 'ML Researcher',     emoji: '🔬', baseSalary: 8, department: 'research_lab',      description: 'Generates research points' },
  data_engineer:    { role: 'data_engineer',    label: 'Data Engineer',     emoji: '📊', baseSalary: 6, department: 'data_pipeline',     description: 'Processes raw data' },
  ml_engineer:      { role: 'ml_engineer',      label: 'ML Engineer',       emoji: '⚙️', baseSalary: 7, department: 'training_cluster',  description: 'Runs training jobs' },
  safety_researcher:{ role: 'safety_researcher',label: 'Safety Researcher', emoji: '🛡️', baseSalary: 7, department: 'eval_safety',       description: 'Evaluates & aligns models' },
  product_manager:  { role: 'product_manager',  label: 'Product Manager',   emoji: '📋', baseSalary: 6, department: 'product_studio',    description: 'Turns models into products' },
  software_engineer:{ role: 'software_engineer',label: 'Software Engineer', emoji: '💻', baseSalary: 6, department: 'product_studio',    description: 'Builds infrastructure' },
  salesperson:      { role: 'salesperson',      label: 'Salesperson',       emoji: '🤝', baseSalary: 5, department: 'sales_floor',       description: 'Generates revenue' },
  recruiter:        { role: 'recruiter',        label: 'Recruiter',         emoji: '📢', baseSalary: 4, department: 'hr_office',         description: 'Finds new talent' },
  pr_comms:         { role: 'pr_comms',         label: 'PR & Comms',        emoji: '📰', baseSalary: 5, department: 'hr_office',         description: 'Manages reputation' },
  spy:              { role: 'spy',              label: 'Spy',               emoji: '🕵️', baseSalary: 9, department: 'security_ops',      description: 'Espionage operations' },
  security_officer: { role: 'security_officer', label: 'Security Officer',  emoji: '🔒', baseSalary: 6, department: 'security_ops',      description: 'Counter-intelligence' },
  lawyer:           { role: 'lawyer',           label: 'Lawyer',            emoji: '⚖️', baseSalary: 7, department: 'legal',             description: 'IP & regulatory defense' },
};

// ─── Departments ───────────────────────────────────────────────────────

export type DepartmentType =
  | 'research_lab' | 'data_pipeline' | 'training_cluster' | 'eval_safety'
  | 'product_studio' | 'sales_floor' | 'hr_office' | 'security_ops' | 'legal';

export interface Department {
  id: string;
  type: DepartmentType;
  level: number;         // 1-3, higher = more capacity
  gridPos: Position;     // grid position in office
  workerIds: string[];   // employee IDs assigned here
  maxWorkers: number;    // based on level
  active: boolean;
  upgradeCost: number;
}

export interface DepartmentConfig {
  type: DepartmentType;
  label: string;
  emoji: string;
  color: number;
  baseMaxWorkers: number;
  buildCost: number;
  upgradeCosts: number[];  // cost per level [lvl2, lvl3]
  inputs: string[];        // what it consumes
  outputs: string[];       // what it produces
  description: string;
}

export const DEPARTMENT_CONFIGS: Record<DepartmentType, DepartmentConfig> = {
  research_lab:     { type: 'research_lab',     label: 'Research Lab',      emoji: '🔬', color: 0x1565C0, baseMaxWorkers: 4, buildCost: 100,  upgradeCosts: [200, 400],  inputs: ['compute'],          outputs: ['researchPoints'],     description: 'Generates research breakthroughs' },
  data_pipeline:    { type: 'data_pipeline',    label: 'Data Pipeline',     emoji: '📊', color: 0x2E7D32, baseMaxWorkers: 3, buildCost: 80,   upgradeCosts: [150, 300],  inputs: ['capital'],           outputs: ['data'],               description: 'Processes raw data into training data' },
  training_cluster: { type: 'training_cluster', label: 'Training Cluster',  emoji: '🖥️', color: 0xE65100, baseMaxWorkers: 3, buildCost: 150,  upgradeCosts: [300, 600],  inputs: ['compute', 'data'],   outputs: ['modelQuality'],       description: 'Trains AI models' },
  eval_safety:      { type: 'eval_safety',      label: 'Eval & Safety',     emoji: '🛡️', color: 0x00838F, baseMaxWorkers: 3, buildCost: 100,  upgradeCosts: [200, 400],  inputs: ['modelQuality'],      outputs: ['alignmentScore'],     description: 'Evaluates model safety' },
  product_studio:   { type: 'product_studio',   label: 'Product Studio',    emoji: '🚀', color: 0x6A1B9A, baseMaxWorkers: 4, buildCost: 120,  upgradeCosts: [250, 500],  inputs: ['modelQuality'],      outputs: ['products'],           description: 'Ships AI products' },
  sales_floor:      { type: 'sales_floor',      label: 'Sales Floor',       emoji: '💰', color: 0xF9A825, baseMaxWorkers: 3, buildCost: 80,   upgradeCosts: [150, 300],  inputs: ['products'],          outputs: ['capital'],            description: 'Generates revenue from products' },
  hr_office:        { type: 'hr_office',        label: 'HR & Comms',        emoji: '👥', color: 0xAD1457, baseMaxWorkers: 3, buildCost: 60,   upgradeCosts: [120, 240],  inputs: ['capital'],           outputs: ['reputation'],         description: 'Hiring & reputation management' },
  security_ops:     { type: 'security_ops',     label: 'Security Ops',      emoji: '🔒', color: 0x37474F, baseMaxWorkers: 3, buildCost: 100,  upgradeCosts: [200, 400],  inputs: ['capital'],           outputs: ['defense'],            description: 'Espionage & counter-intelligence' },
  legal:            { type: 'legal',            label: 'Legal',             emoji: '⚖️', color: 0x4E342E, baseMaxWorkers: 2, buildCost: 80,   upgradeCosts: [160, 320],  inputs: ['capital'],           outputs: ['influence'],          description: 'IP protection & lobbying' },
};

// ─── Research Tree ─────────────────────────────────────────────────────

export type ResearchPath = 'core' | 'scale' | 'intelligence' | 'alignment' | 'offensive' | 'defensive';

export interface ResearchNode {
  id: string;
  name: string;
  era: 1 | 2 | 3;
  path: ResearchPath;
  cost: number;          // research points
  timeTicks: number;     // ticks to complete once started
  prerequisites: string[];
  effect: string;        // description
  emoji: string;
  // Runtime state
  researched: boolean;
  progress: number;      // 0 to timeTicks
  active: boolean;       // currently being researched
}

export const RESEARCH_TREE: Omit<ResearchNode, 'researched' | 'progress' | 'active'>[] = [
  // ERA 1: Core / Foundations
  { id: 'transformers',       name: 'Transformer Architecture',  era: 1, path: 'core',         cost: 20,  timeTicks: 15, prerequisites: [],                emoji: '🧱', effect: 'Unlocks model training' },
  { id: 'web_scraping',       name: 'Web Scraping',              era: 1, path: 'core',         cost: 15,  timeTicks: 10, prerequisites: [],                emoji: '🌐', effect: 'Unlocks bulk data collection' },
  { id: 'cloud_compute',      name: 'Cloud Compute',             era: 1, path: 'core',         cost: 15,  timeTicks: 10, prerequisites: [],                emoji: '☁️', effect: 'Unlocks GPU rental' },
  { id: 'basic_nlp',          name: 'Basic NLP',                 era: 1, path: 'core',         cost: 25,  timeTicks: 20, prerequisites: ['transformers'],  emoji: '💬', effect: 'Unlocks Chatbot product' },
  { id: 'data_licensing',     name: 'Data Licensing',            era: 1, path: 'core',         cost: 20,  timeTicks: 12, prerequisites: ['web_scraping'],  emoji: '📜', effect: 'Unlocks premium datasets (+data)' },

  // ERA 2: Scale Path
  { id: 'moe',                name: 'Mixture of Experts',        era: 2, path: 'scale',        cost: 50,  timeTicks: 30, prerequisites: ['transformers'],  emoji: '🧩', effect: '2x training efficiency' },
  { id: 'custom_silicon',     name: 'Custom Silicon',            era: 2, path: 'scale',        cost: 80,  timeTicks: 45, prerequisites: ['cloud_compute', 'moe'], emoji: '🔧', effect: 'Build own chips, +100% compute' },
  { id: 'massive_pretrain',   name: 'Massive Pretraining',       era: 2, path: 'scale',        cost: 60,  timeTicks: 35, prerequisites: ['moe'],           emoji: '🏋️', effect: 'Bigger models, +50% quality' },

  // ERA 2: Intelligence Path
  { id: 'chain_of_thought',   name: 'Chain of Thought',          era: 2, path: 'intelligence', cost: 45,  timeTicks: 25, prerequisites: ['basic_nlp'],     emoji: '🧠', effect: 'Reasoning boost, +model quality' },
  { id: 'tool_use',           name: 'Tool Use & Agents',         era: 2, path: 'intelligence', cost: 55,  timeTicks: 30, prerequisites: ['chain_of_thought'], emoji: '🛠️', effect: 'Unlocks Agent product (high revenue)' },
  { id: 'multimodal',         name: 'Multimodal Fusion',         era: 2, path: 'intelligence', cost: 60,  timeTicks: 35, prerequisites: ['chain_of_thought'], emoji: '👁️', effect: 'Unlocks Image Gen product' },

  // ERA 2: Alignment Path
  { id: 'rlhf',               name: 'RLHF',                     era: 2, path: 'alignment',    cost: 40,  timeTicks: 25, prerequisites: ['basic_nlp'],     emoji: '👍', effect: '+safety, +model quality' },
  { id: 'constitutional_ai',  name: 'Constitutional AI',         era: 2, path: 'alignment',    cost: 50,  timeTicks: 30, prerequisites: ['rlhf'],          emoji: '📜', effect: 'Prevents safety incidents' },
  { id: 'interpretability',   name: 'Interpretability',          era: 2, path: 'alignment',    cost: 60,  timeTicks: 35, prerequisites: ['rlhf'],          emoji: '🔍', effect: 'Understand your model (+ASI safety)' },

  // ERA 2: Offensive Path
  { id: 'advanced_cyber',     name: 'Advanced Cyber Ops',        era: 2, path: 'offensive',    cost: 45,  timeTicks: 25, prerequisites: [],                emoji: '💥', effect: 'Stronger attacks, -30% cooldown' },
  { id: 'social_engineering', name: 'Social Engineering AI',     era: 2, path: 'offensive',    cost: 55,  timeTicks: 30, prerequisites: ['advanced_cyber'], emoji: '🎭', effect: 'AI-powered spies (auto-spy)' },
  { id: 'market_manip_ai',    name: 'Market Manipulation AI',    era: 2, path: 'offensive',    cost: 50,  timeTicks: 28, prerequisites: ['advanced_cyber'], emoji: '📉', effect: 'AI finds optimal market attacks' },

  // ERA 2: Defensive Path
  { id: 'ai_security',        name: 'AI Security Systems',       era: 2, path: 'defensive',    cost: 40,  timeTicks: 22, prerequisites: [],                emoji: '🔐', effect: 'Auto-detect spies & cyberattacks' },
  { id: 'encrypted_training', name: 'Encrypted Training',        era: 2, path: 'defensive',    cost: 50,  timeTicks: 28, prerequisites: ['ai_security'],   emoji: '🔏', effect: 'Training runs cant be sabotaged' },
  { id: 'reputation_mgmt_ai', name: 'Reputation Mgmt AI',        era: 2, path: 'defensive',    cost: 45,  timeTicks: 25, prerequisites: ['ai_security'],   emoji: '📣', effect: 'Auto-PR crisis response' },

  // ERA 3: Superintelligence
  { id: 'recursive_improve',  name: 'Recursive Self-Improvement',era: 3, path: 'core',         cost: 100, timeTicks: 40, prerequisites: ['massive_pretrain', 'chain_of_thought'],                     emoji: '🔄', effect: 'AI helps generate research points' },
  { id: 'world_models',       name: 'World Models',              era: 3, path: 'core',         cost: 100, timeTicks: 40, prerequisites: ['tool_use', 'multimodal'],                                   emoji: '🌍', effect: 'AI understands causality' },
  { id: 'autonomous_research',name: 'Autonomous Research',       era: 3, path: 'core',         cost: 120, timeTicks: 50, prerequisites: ['recursive_improve'],                                        emoji: '🤖', effect: 'AI runs experiments independently' },
  { id: 'asi_project',        name: 'ASI Project',               era: 3, path: 'core',         cost: 200, timeTicks: 80, prerequisites: ['recursive_improve', 'world_models', 'autonomous_research'], emoji: '⭐', effect: 'WIN: Build Artificial Superintelligence' },
];

// ─── Products ──────────────────────────────────────────────────────────

export type ProductType = 'chatbot' | 'api_platform' | 'code_assistant' | 'enterprise_ai' | 'image_gen' | 'agent_product' | 'gov_contract';

export interface Product {
  type: ProductType;
  name: string;
  quality: number;       // 1-100
  marketShare: number;   // 0-100
  revenuePerTick: number;
  launched: boolean;
  launchedAt: number;
}

export interface ProductConfig {
  type: ProductType;
  label: string;
  emoji: string;
  baseRevenue: number;
  requiredResearch: string[];
  requiredDepartments: DepartmentType[];
  developmentTicks: number;
  minModelQuality: number;
}

export const PRODUCT_CONFIGS: Record<ProductType, ProductConfig> = {
  chatbot:        { type: 'chatbot',        label: 'Chatbot',          emoji: '💬', baseRevenue: 5,  requiredResearch: ['basic_nlp'],        requiredDepartments: ['product_studio'], developmentTicks: 20, minModelQuality: 10 },
  api_platform:   { type: 'api_platform',   label: 'API Platform',     emoji: '🔌', baseRevenue: 12, requiredResearch: ['basic_nlp'],        requiredDepartments: ['product_studio'], developmentTicks: 30, minModelQuality: 25 },
  code_assistant: { type: 'code_assistant',  label: 'Code Assistant',   emoji: '👨‍💻', baseRevenue: 15, requiredResearch: ['chain_of_thought'], requiredDepartments: ['product_studio'], developmentTicks: 35, minModelQuality: 40 },
  enterprise_ai:  { type: 'enterprise_ai',  label: 'Enterprise AI',    emoji: '🏢', baseRevenue: 25, requiredResearch: ['chain_of_thought'], requiredDepartments: ['product_studio', 'sales_floor'], developmentTicks: 45, minModelQuality: 50 },
  image_gen:      { type: 'image_gen',      label: 'Image Generator',  emoji: '🎨', baseRevenue: 10, requiredResearch: ['multimodal'],       requiredDepartments: ['product_studio'], developmentTicks: 30, minModelQuality: 35 },
  agent_product:  { type: 'agent_product',  label: 'AI Agent',         emoji: '🤖', baseRevenue: 30, requiredResearch: ['tool_use'],         requiredDepartments: ['product_studio'], developmentTicks: 50, minModelQuality: 60 },
  gov_contract:   { type: 'gov_contract',   label: 'Gov Contract',     emoji: '🏛️', baseRevenue: 40, requiredResearch: ['constitutional_ai'], requiredDepartments: ['product_studio', 'legal'], developmentTicks: 60, minModelQuality: 70 },
};

// ─── Attacks & Defense ─────────────────────────────────────────────────

export type AttackType =
  | 'talent_poach' | 'ddos' | 'data_breach' | 'sabotage_training'
  | 'plant_spy' | 'media_leak' | 'patent_troll' | 'hostile_takeover'
  | 'infrastructure_strike';

export interface AttackConfig {
  type: AttackType;
  label: string;
  emoji: string;
  cost: number;
  cooldownTicks: number;
  durationTicks: number;
  successRate: number;     // 0-1 base chance
  effect: string;
  detectionChance: number; // 0-1 chance opponent sees it
  reputationLoss: number;  // if detected
  era: 1 | 2 | 3;         // minimum era to use
}

export const ATTACK_CONFIGS: Record<AttackType, AttackConfig> = {
  talent_poach:         { type: 'talent_poach',         label: 'Poach Talent',          emoji: '🎯', cost: 80,   cooldownTicks: 40,  durationTicks: 5,  successRate: 0.6,  effect: 'Steal a random employee',          detectionChance: 0.3,  reputationLoss: 5,   era: 1 },
  ddos:                 { type: 'ddos',                 label: 'DDoS Attack',           emoji: '🌊', cost: 50,   cooldownTicks: 30,  durationTicks: 20, successRate: 0.8,  effect: 'Products offline, no revenue',     detectionChance: 0.5,  reputationLoss: 8,   era: 1 },
  data_breach:          { type: 'data_breach',          label: 'Data Breach',           emoji: '💿', cost: 120,  cooldownTicks: 60,  durationTicks: 3,  successRate: 0.5,  effect: 'Copy rival training data',         detectionChance: 0.4,  reputationLoss: 15,  era: 2 },
  sabotage_training:    { type: 'sabotage_training',    label: 'Sabotage Training',     emoji: '💣', cost: 150,  cooldownTicks: 80,  durationTicks: 3,  successRate: 0.4,  effect: 'Corrupt active training run',      detectionChance: 0.5,  reputationLoss: 20,  era: 2 },
  plant_spy:            { type: 'plant_spy',            label: 'Plant Spy',             emoji: '🕵️', cost: 100,  cooldownTicks: 100, durationTicks: 10, successRate: 0.5,  effect: 'Embed mole, leaks research',       detectionChance: 0.3,  reputationLoss: 20,  era: 1 },
  media_leak:           { type: 'media_leak',           label: 'Media Leak',            emoji: '📰', cost: 40,   cooldownTicks: 40,  durationTicks: 2,  successRate: 0.7,  effect: 'Damage rival reputation',          detectionChance: 0.2,  reputationLoss: 10,  era: 1 },
  patent_troll:         { type: 'patent_troll',         label: 'Patent Troll',          emoji: '📝', cost: 80,   cooldownTicks: 60,  durationTicks: 30, successRate: 0.6,  effect: 'Block rival product launch',       detectionChance: 0.1,  reputationLoss: 8,   era: 2 },
  hostile_takeover:     { type: 'hostile_takeover',     label: 'Hostile Takeover',       emoji: '🏴', cost: 500,  cooldownTicks: 200, durationTicks: 1,  successRate: 0.3,  effect: 'Acquire rival (if weak enough)',    detectionChance: 1.0,  reputationLoss: 25,  era: 2 },
  infrastructure_strike:{ type: 'infrastructure_strike',label: 'Infrastructure Strike', emoji: '☢️', cost: 300,  cooldownTicks: 150, durationTicks: 3,  successRate: 0.35, effect: 'Destroy rival GPU cluster for 60s', detectionChance: 0.8,  reputationLoss: 35,  era: 3 },
};

export type DefenseType = 'firewall' | 'counter_intel' | 'pr_shield' | 'legal_shield' | 'air_gap' | 'talent_retention';

export interface DefenseConfig {
  type: DefenseType;
  label: string;
  emoji: string;
  cost: number;          // one-time build cost
  maintenanceCost: number; // per tick
  effect: string;
}

export const DEFENSE_CONFIGS: Record<DefenseType, DefenseConfig> = {
  firewall:         { type: 'firewall',         label: 'Firewall',          emoji: '🧱', cost: 100, maintenanceCost: 2, effect: '-50% cyberattack effectiveness' },
  counter_intel:    { type: 'counter_intel',    label: 'Counter-Intel',     emoji: '🔎', cost: 120, maintenanceCost: 3, effect: '2x spy detection rate' },
  pr_shield:        { type: 'pr_shield',        label: 'PR Shield',         emoji: '🛡️', cost: 80,  maintenanceCost: 2, effect: '-50% reputation damage' },
  legal_shield:     { type: 'legal_shield',     label: 'Legal Shield',      emoji: '⚖️', cost: 100, maintenanceCost: 2, effect: 'Counter patent trolls, NDA enforcement' },
  air_gap:          { type: 'air_gap',          label: 'Air Gap',           emoji: '🔐', cost: 200, maintenanceCost: 5, effect: 'Secret projects unhackable (no cloud)' },
  talent_retention: { type: 'talent_retention', label: 'Talent Retention',  emoji: '❤️', cost: 80,  maintenanceCost: 3, effect: '-50% poaching success rate' },
};

// ─── Events ────────────────────────────────────────────────────────────

export interface GameEvent {
  id: string;
  type: 'industry' | 'contested' | 'crisis';
  title: string;
  description: string;
  emoji: string;
  tick: number;          // when it fires
  duration: number;      // how long it lasts (ticks)
  active: boolean;
  targetCompanyId?: string;
  effect: string;
}

// ─── Company State ─────────────────────────────────────────────────────

export interface ActiveAttack {
  id: string;
  type: AttackType;
  attackerId: string;
  targetId: string;
  startTick: number;
  endTick: number;
  resolved: boolean;
  success: boolean;
  detected: boolean;
}

export interface ActiveSpy {
  id: string;
  companyId: string;     // owner
  targetCompanyId: string;
  plantedAt: number;
  detected: boolean;
  intelGathered: number; // research points leaked
}

export interface ProductInDev {
  type: ProductType;
  startedAt: number;
  completesAt: number;
  quality: number;
}

export interface Company {
  id: string;
  name: string;
  faction: Faction;
  isBot: boolean;
  isLocal: boolean;      // controlled by this client
  eliminated: boolean;
  eliminatedAt: number;
  eliminatedBy: string;  // company id

  // Resources
  resources: Resources;
  income: number;        // net capital per tick (revenue - costs)

  // People
  employees: Record<string, Employee>;
  nextEmployeeId: number;

  // Structure
  departments: Record<string, Department>;
  nextDeptId: number;

  // Tech
  research: Record<string, ResearchNode>;
  activeResearchId: string | null;
  modelQuality: number;  // 0-100, result of training
  alignmentScore: number; // 0-100, from safety work
  trainingActive: boolean;
  trainingProgress: number; // 0-100

  // Products
  products: Product[];
  productsInDev: ProductInDev[];
  totalRevenue: number;

  // Combat
  attackCooldowns: Record<AttackType, number>; // remaining ticks
  defenses: DefenseType[];
  activeSentSpies: ActiveSpy[];
  uniqueAbilityCooldown: number;
  uniqueAbilityUsed: boolean;

  // ASI
  asiProgress: number;  // 0-100, the win meter
  asiStarted: boolean;

  // Office layout
  officeWidth: number;   // grid cells
  officeHeight: number;
}

// ─── Game State ────────────────────────────────────────────────────────

export type GamePhase = 'lobby' | 'playing' | 'ended';

export interface LobbySlot {
  playerId: string;
  playerName: string;
  faction: Faction;
  isBot: boolean;
  ready: boolean;
}

export interface SiliconMindsState {
  phase: GamePhase;
  tick: number;
  era: 1 | 2 | 3;
  gameTimeMs: number;
  matchDurationMs: number; // 30 minutes = 1800000

  // Players
  companies: Record<string, Company>;
  localCompanyId: string;

  // Lobby
  lobby: LobbySlot[];
  maxPlayers: number;

  // Global
  talentMarket: Employee[];   // available to hire
  events: GameEvent[];
  activeAttacks: ActiveAttack[];
  contestedObjectives: GameEvent[];

  // Results
  winnerId: string | null;
  winCondition: string;
}

// ─── Parsed Voice Commands ─────────────────────────────────────────────

export type CEOCommandType =
  | 'hire'           // "hire 2 researchers"
  | 'fire'           // "fire the lowest skill engineer"
  | 'assign'         // "assign researchers to project X"
  | 'research'       // "start researching chain of thought"
  | 'build_dept'     // "build a new training cluster"
  | 'upgrade_dept'   // "upgrade the research lab"
  | 'ship_product'   // "ship the chatbot"
  | 'attack'         // "launch DDoS on Titan"
  | 'defend'         // "build a firewall"
  | 'train_model'    // "start a training run"
  | 'unique_ability' // "activate datacenter blitz"
  | 'start_asi'      // "begin the ASI project"
  | 'poach'          // "poach their lead researcher"
  | 'lobby'          // "lobby congress against open source"
  | 'status'         // "how are we doing?" / "status report"
  ;

export interface CEOCommand {
  type: CEOCommandType;
  target?: string;         // target company, department, employee, product, research
  quantity?: number;        // how many (hire 3)
  role?: EmployeeRole;      // which role to hire
  attackType?: AttackType;
  defenseType?: DefenseType;
  productType?: ProductType;
  researchId?: string;
  raw: string;             // original voice text
}

// ─── Constants ─────────────────────────────────────────────────────────

export const SM_CONSTANTS = {
  TICK_RATE: 500,           // ms per game tick
  MATCH_DURATION: 1800000,  // 30 minutes in ms
  MAX_PLAYERS: 6,
  DEFAULT_PLAYERS: 4,

  // Eras (in ticks: 1 tick = 500ms, so 1200 ticks = 10 min)
  ERA_2_TICK: 1200,         // 10 min
  ERA_3_TICK: 2640,         // 22 min
  ESCALATION_TICK: 3000,    // 25 min — everything speeds up

  // Starting resources
  START_CAPITAL: 500,
  START_COMPUTE: 30,
  START_DATA: 10,
  START_RESEARCH: 0,
  START_REPUTATION: 50,
  START_INFLUENCE: 10,

  // Production rates (per worker per tick, scaled by skill/10)
  RESEARCH_RATE: 0.8,       // research points per researcher per tick
  DATA_RATE: 0.5,           // data per data engineer per tick
  TRAINING_RATE: 0.3,       // model quality gain per engineer per tick (needs compute+data)
  SAFETY_RATE: 0.4,         // alignment score per safety researcher per tick
  SALES_RATE: 0.5,          // capital per salesperson per tick (×product revenue)
  RECRUIT_RATE: 0.02,       // chance per recruiter per tick to find new talent
  PR_RATE: 0.3,             // reputation recovery per PR person per tick
  INFLUENCE_RATE: 0.2,      // influence per lawyer per tick

  // Compute costs
  COMPUTE_PER_TRAINING_TICK: 2,
  COMPUTE_PER_RESEARCH_TICK: 0.5,

  // Talent market
  TALENT_POOL_SIZE: 8,
  TALENT_REFRESH_TICKS: 60, // refresh available hires every 30s

  // Economy
  SALARY_TICK_DIVISOR: 10,  // salary cost = salary / 10 per tick
  DEPT_MAINTENANCE: 1,      // capital per dept per tick

  // Combat
  SPY_INTEL_RATE: 0.5,      // research points leaked per tick per spy
  SPY_DETECTION_BASE: 0.02, // chance per tick to detect rival spy

  // ASI
  ASI_PROGRESS_RATE: 0.15,  // per researcher on ASI per tick (scaled by model quality)
  ASI_ALIGNMENT_THRESHOLD: 60, // alignment score needed for safe ASI
  ASI_ROGUE_CHANCE_NO_ALIGNMENT: 0.9,
  ASI_ROGUE_CHANCE_LOW_ALIGNMENT: 0.5,

  // Events
  EVENT_INTERVAL_TICKS: 120, // contested event every 60s
  MIN_ELIMINATION_TICK: 600, // can't be eliminated before 5 min

  // Visual
  OFFICE_GRID_W: 12,
  OFFICE_GRID_H: 8,
  TILE_SIZE: 64,
  EMPLOYEE_SIZE: 16,
};

// ─── Name Generators ───────────────────────────────────────────────────

export const FIRST_NAMES = [
  'Alex', 'Jordan', 'Sam', 'Casey', 'Morgan', 'Riley', 'Quinn', 'Avery',
  'Blake', 'Charlie', 'Dana', 'Ellis', 'Frankie', 'Harper', 'Indigo', 'Jamie',
  'Kai', 'Lennox', 'Mika', 'Noel', 'Oakley', 'Parker', 'Reese', 'Sage',
  'Taylor', 'Val', 'Winter', 'Xen', 'Yuri', 'Zephyr', 'Ash', 'Brook',
  'Cypress', 'Devon', 'Emery', 'Finley', 'Grey', 'Hayden', 'Ivy', 'Jules',
];

export const LAST_NAMES = [
  'Chen', 'Patel', 'Kim', 'Garcia', 'Nguyen', 'Mueller', 'Okafor', 'Silva',
  'Tanaka', 'Petrov', 'Abbas', 'Johansson', 'Bianchi', 'Dubois', 'Kowalski',
  'Santos', 'Yamamoto', 'Chakrabarti', 'Olsen', 'Mendez', 'Park', 'Singh',
  'Reed', 'Fox', 'Cross', 'Stone', 'Wolfe', 'Nash', 'Hale', 'Frost',
];

// ─── Bot AI Personality ────────────────────────────────────────────────

export type BotPersonality = 'aggressive' | 'balanced' | 'defensive' | 'economic' | 'research_focused';

export const BOT_NAMES: Record<Faction, string> = {
  titan: 'Director Zhao',
  prometheus: 'Dr. Elara Voss',
  catalyst: 'Chad Velocity',
  specter: 'The Architect',
  openforge: 'Community Council',
  nexus: 'Aria Singh',
};
