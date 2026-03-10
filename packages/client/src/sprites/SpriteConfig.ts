import { AnimalType } from '@prompt-battle/shared';

export interface SpriteSheetDef {
  key: string;           // Phaser texture key
  path: string;          // URL path (relative to public/)
  frameWidth: number;
  frameHeight: number;
  frameCount: number;
}

export interface EnemySpriteConfig {
  idle: SpriteSheetDef;
  walk: SpriteSheetDef;
  attack: SpriteSheetDef;
  displayScale: number;  // scale to fit on 32px tile grid
  originY: number;       // vertical origin (0.5 = center, 0.7 = lower)
}

// ─── Frame size reference ────────────────────────────────
// Gnome/Gnoll/Skull/HarpoonFish/Shaman/Snake/Spider/Lizard: 192x192
// Panda/Bear(actual): 256x256
// Turtle/Minotaur: 320x320
// Troll: 384x384

export const SPRITE_CONFIGS: Record<AnimalType, EnemySpriteConfig> = {
  // ─── Tier 1 ────────────────────────────────────────────
  rabbit: {
    idle: { key: 'rabbit_idle', path: 'assets/enemies/gnome/Gnome_Idle.png', frameWidth: 192, frameHeight: 192, frameCount: 8 },
    walk: { key: 'rabbit_walk', path: 'assets/enemies/gnome/Gnome_Run.png', frameWidth: 192, frameHeight: 192, frameCount: 6 },
    attack: { key: 'rabbit_attack', path: 'assets/enemies/gnome/Gnome_Attack.png', frameWidth: 192, frameHeight: 192, frameCount: 7 },
    displayScale: 0.16,
    originY: 0.65,
  },
  parrot: {
    idle: { key: 'parrot_idle', path: 'assets/enemies/gnoll/Gnoll_Idle.png', frameWidth: 192, frameHeight: 192, frameCount: 6 },
    walk: { key: 'parrot_walk', path: 'assets/enemies/gnoll/Gnoll_Walk.png', frameWidth: 192, frameHeight: 192, frameCount: 8 },
    attack: { key: 'parrot_attack', path: 'assets/enemies/gnoll/Gnoll_Throw.png', frameWidth: 192, frameHeight: 192, frameCount: 8 },
    displayScale: 0.16,
    originY: 0.65,
  },

  // ─── Tier 2 ────────────────────────────────────────────
  wolf: {
    idle: { key: 'wolf_idle', path: 'assets/enemies/skull/Skull_Idle.png', frameWidth: 192, frameHeight: 192, frameCount: 8 },
    walk: { key: 'wolf_walk', path: 'assets/enemies/skull/Skull_Run.png', frameWidth: 192, frameHeight: 192, frameCount: 6 },
    attack: { key: 'wolf_attack', path: 'assets/enemies/skull/Skull_Attack.png', frameWidth: 192, frameHeight: 192, frameCount: 7 },
    displayScale: 0.18,
    originY: 0.65,
  },
  falcon: {
    idle: { key: 'falcon_idle', path: 'assets/enemies/harpoon_fish/HarpoonFish_Idle.png', frameWidth: 192, frameHeight: 192, frameCount: 8 },
    walk: { key: 'falcon_walk', path: 'assets/enemies/harpoon_fish/HarpoonFish_Run.png', frameWidth: 192, frameHeight: 192, frameCount: 6 },
    attack: { key: 'falcon_attack', path: 'assets/enemies/harpoon_fish/HarpoonFish_Throw.png', frameWidth: 192, frameHeight: 192, frameCount: 8 },
    displayScale: 0.18,
    originY: 0.65,
  },
  goat: {
    idle: { key: 'goat_idle', path: 'assets/enemies/shaman/Shaman_Idle.png', frameWidth: 192, frameHeight: 192, frameCount: 8 },
    walk: { key: 'goat_walk', path: 'assets/enemies/shaman/Shaman_Run.png', frameWidth: 192, frameHeight: 192, frameCount: 4 },
    attack: { key: 'goat_attack', path: 'assets/enemies/shaman/Shaman_Attack.png', frameWidth: 192, frameHeight: 192, frameCount: 10 },
    displayScale: 0.18,
    originY: 0.65,
  },

  // ─── Tier 3 ────────────────────────────────────────────
  bear: {
    idle: { key: 'bear_idle', path: 'assets/enemies/panda/Panda_Idle.png', frameWidth: 256, frameHeight: 256, frameCount: 10 },
    walk: { key: 'bear_walk', path: 'assets/enemies/panda/Panda_Run.png', frameWidth: 256, frameHeight: 256, frameCount: 6 },
    attack: { key: 'bear_attack', path: 'assets/enemies/panda/Panda_Attack.png', frameWidth: 256, frameHeight: 256, frameCount: 13 },
    displayScale: 0.14,
    originY: 0.65,
  },
  viper: {
    idle: { key: 'viper_idle', path: 'assets/enemies/snake/Snake_Idle.png', frameWidth: 192, frameHeight: 192, frameCount: 8 },
    walk: { key: 'viper_walk', path: 'assets/enemies/snake/Snake_Run.png', frameWidth: 192, frameHeight: 192, frameCount: 8 },
    attack: { key: 'viper_attack', path: 'assets/enemies/snake/Snake_Attack.png', frameWidth: 192, frameHeight: 192, frameCount: 6 },
    displayScale: 0.19,
    originY: 0.65,
  },
  deer: {
    idle: { key: 'deer_idle', path: 'assets/enemies/turtle/Turtle_Idle.png', frameWidth: 320, frameHeight: 320, frameCount: 10 },
    walk: { key: 'deer_walk', path: 'assets/enemies/turtle/Turtle_Walk.png', frameWidth: 320, frameHeight: 320, frameCount: 7 },
    attack: { key: 'deer_attack', path: 'assets/enemies/turtle/Turtle_Attack.png', frameWidth: 320, frameHeight: 320, frameCount: 10 },
    displayScale: 0.11,
    originY: 0.65,
  },

  // ─── Tier 4 ────────────────────────────────────────────
  elephant: {
    idle: { key: 'elephant_idle', path: 'assets/enemies/minotaur/Minotaur_Idle.png', frameWidth: 320, frameHeight: 320, frameCount: 16 },
    walk: { key: 'elephant_walk', path: 'assets/enemies/minotaur/Minotaur_Walk.png', frameWidth: 320, frameHeight: 320, frameCount: 8 },
    attack: { key: 'elephant_attack', path: 'assets/enemies/minotaur/Minotaur_Attack.png', frameWidth: 320, frameHeight: 320, frameCount: 12 },
    displayScale: 0.12,
    originY: 0.65,
  },
  lion: {
    idle: { key: 'lion_idle', path: 'assets/enemies/troll/Troll_Idle.png', frameWidth: 384, frameHeight: 384, frameCount: 12 },
    walk: { key: 'lion_walk', path: 'assets/enemies/troll/Troll_Walk.png', frameWidth: 384, frameHeight: 384, frameCount: 10 },
    attack: { key: 'lion_attack', path: 'assets/enemies/troll/Troll_Attack.png', frameWidth: 384, frameHeight: 384, frameCount: 6 },
    displayScale: 0.11,
    originY: 0.65,
  },
};

// ═══════════════════════════════════════════════════════════════
// HORDE MODE SPRITE CONFIGS
// Horde mode has different animal types than battle mode
// ═══════════════════════════════════════════════════════════════

export const HORDE_SPRITE_CONFIGS: Record<string, EnemySpriteConfig> = {
  // ─── Tier 1 ────────────────────────────────────────────
  gnome: {
    idle: { key: 'h_gnome_idle', path: 'assets/enemies/gnome/Gnome_Idle.png', frameWidth: 192, frameHeight: 192, frameCount: 8 },
    walk: { key: 'h_gnome_walk', path: 'assets/enemies/gnome/Gnome_Run.png', frameWidth: 192, frameHeight: 192, frameCount: 6 },
    attack: { key: 'h_gnome_attack', path: 'assets/enemies/gnome/Gnome_Attack.png', frameWidth: 192, frameHeight: 192, frameCount: 7 },
    displayScale: 1.0,
    originY: 0.5,
  },
  turtle: {
    idle: { key: 'h_turtle_idle', path: 'assets/enemies/turtle/Turtle_Idle.png', frameWidth: 320, frameHeight: 320, frameCount: 10 },
    walk: { key: 'h_turtle_walk', path: 'assets/enemies/turtle/Turtle_Walk.png', frameWidth: 320, frameHeight: 320, frameCount: 7 },
    attack: { key: 'h_turtle_attack', path: 'assets/enemies/turtle/Turtle_Attack.png', frameWidth: 320, frameHeight: 320, frameCount: 10 },
    displayScale: 0.65,
    originY: 0.5,
  },

  // ─── Tier 2 ────────────────────────────────────────────
  skull: {
    idle: { key: 'h_skull_idle', path: 'assets/enemies/skull/Skull_Idle.png', frameWidth: 192, frameHeight: 192, frameCount: 8 },
    walk: { key: 'h_skull_walk', path: 'assets/enemies/skull/Skull_Run.png', frameWidth: 192, frameHeight: 192, frameCount: 6 },
    attack: { key: 'h_skull_attack', path: 'assets/enemies/skull/Skull_Attack.png', frameWidth: 192, frameHeight: 192, frameCount: 7 },
    displayScale: 1.2,
    originY: 0.5,
  },
  spider: {
    idle: { key: 'h_spider_idle', path: 'assets/enemies/spider/Spider_Idle.png', frameWidth: 192, frameHeight: 192, frameCount: 8 },
    walk: { key: 'h_spider_walk', path: 'assets/enemies/spider/Spider_Run.png', frameWidth: 192, frameHeight: 192, frameCount: 5 },
    attack: { key: 'h_spider_attack', path: 'assets/enemies/spider/Spider_Attack.png', frameWidth: 192, frameHeight: 192, frameCount: 8 },
    displayScale: 1.2,
    originY: 0.5,
  },
  gnoll: {
    idle: { key: 'h_gnoll_idle', path: 'assets/enemies/gnoll/Gnoll_Idle.png', frameWidth: 192, frameHeight: 192, frameCount: 6 },
    walk: { key: 'h_gnoll_walk', path: 'assets/enemies/gnoll/Gnoll_Walk.png', frameWidth: 192, frameHeight: 192, frameCount: 8 },
    attack: { key: 'h_gnoll_attack', path: 'assets/enemies/gnoll/Gnoll_Throw.png', frameWidth: 192, frameHeight: 192, frameCount: 8 },
    displayScale: 1.1,
    originY: 0.5,
  },

  // ─── Tier 3 ────────────────────────────────────────────
  panda: {
    idle: { key: 'h_panda_idle', path: 'assets/enemies/panda/Panda_Idle.png', frameWidth: 256, frameHeight: 256, frameCount: 10 },
    walk: { key: 'h_panda_walk', path: 'assets/enemies/panda/Panda_Run.png', frameWidth: 256, frameHeight: 256, frameCount: 6 },
    attack: { key: 'h_panda_attack', path: 'assets/enemies/panda/Panda_Attack.png', frameWidth: 256, frameHeight: 256, frameCount: 13 },
    displayScale: 1.0,
    originY: 0.5,
  },
  lizard: {
    idle: { key: 'h_lizard_idle', path: 'assets/enemies/lizard/Lizard_Idle.png', frameWidth: 192, frameHeight: 192, frameCount: 7 },
    walk: { key: 'h_lizard_walk', path: 'assets/enemies/lizard/Lizard_Run.png', frameWidth: 192, frameHeight: 192, frameCount: 6 },
    attack: { key: 'h_lizard_attack', path: 'assets/enemies/lizard/Lizard_Attack.png', frameWidth: 192, frameHeight: 192, frameCount: 9 },
    displayScale: 1.3,
    originY: 0.5,
  },

  // ─── Tier 4 ────────────────────────────────────────────
  minotaur: {
    idle: { key: 'h_minotaur_idle', path: 'assets/enemies/minotaur/Minotaur_Idle.png', frameWidth: 320, frameHeight: 320, frameCount: 16 },
    walk: { key: 'h_minotaur_walk', path: 'assets/enemies/minotaur/Minotaur_Walk.png', frameWidth: 320, frameHeight: 320, frameCount: 8 },
    attack: { key: 'h_minotaur_attack', path: 'assets/enemies/minotaur/Minotaur_Attack.png', frameWidth: 320, frameHeight: 320, frameCount: 12 },
    displayScale: 0.9,
    originY: 0.5,
  },
  shaman: {
    idle: { key: 'h_shaman_idle', path: 'assets/enemies/shaman/Shaman_Idle.png', frameWidth: 192, frameHeight: 192, frameCount: 8 },
    walk: { key: 'h_shaman_walk', path: 'assets/enemies/shaman/Shaman_Run.png', frameWidth: 192, frameHeight: 192, frameCount: 4 },
    attack: { key: 'h_shaman_attack', path: 'assets/enemies/shaman/Shaman_Attack.png', frameWidth: 192, frameHeight: 192, frameCount: 10 },
    displayScale: 1.3,
    originY: 0.5,
  },

  // ─── Tier 5 ────────────────────────────────────────────
  troll: {
    idle: { key: 'h_troll_idle', path: 'assets/enemies/troll/Troll_Idle.png', frameWidth: 384, frameHeight: 384, frameCount: 12 },
    walk: { key: 'h_troll_walk', path: 'assets/enemies/troll/Troll_Walk.png', frameWidth: 384, frameHeight: 384, frameCount: 10 },
    attack: { key: 'h_troll_attack', path: 'assets/enemies/troll/Troll_Attack.png', frameWidth: 384, frameHeight: 384, frameCount: 6 },
    displayScale: 0.85,
    originY: 0.5,
  },
};

// Animation frame rates by state
export const ANIM_FRAME_RATES = {
  idle: 8,
  walk: 10,
  attack: 12,
};
