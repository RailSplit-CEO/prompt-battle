#!/usr/bin/env npx tsx
/**
 * generate-skins.ts — Programmatic Skin Sprite Generator
 *
 * Generates character skin sprite sheets using color manipulation:
 * hue shifts, tinting, and channel remapping. No AI, no cost.
 *
 * Usage:
 *   npx tsx generate-skins.ts [options]
 *
 * Options:
 *   --unit <type>      Generate skins for a specific unit only
 *   --skin <id>        Generate a single specific skin
 *   --dry-run          Show what would be generated without writing files
 *   --skip-existing    Skip skins that already have all output files
 */

import sharp from 'sharp';
import * as fs from 'fs';
import * as path from 'path';

// ─── Color Math ────────────────────────────────────────────────────

function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h = 0;
  if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
  else if (max === g) h = ((b - r) / d + 2) / 6;
  else h = ((r - g) / d + 4) / 6;
  return [h * 360, s, l];
}

function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  h = ((h % 360) + 360) % 360;
  h /= 360;
  if (s === 0) {
    const v = Math.round(l * 255);
    return [v, v, v];
  }
  const hue2rgb = (p: number, q: number, t: number) => {
    if (t < 0) t += 1;
    if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  return [
    Math.round(hue2rgb(p, q, h + 1 / 3) * 255),
    Math.round(hue2rgb(p, q, h) * 255),
    Math.round(hue2rgb(p, q, h - 1 / 3) * 255),
  ];
}

function clamp(v: number): number {
  return Math.max(0, Math.min(255, Math.round(v)));
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

// ─── Color Transforms ──────────────────────────────────────────────

type Transform =
  | { type: 'hueShift'; degrees: number; satMul?: number; lightMul?: number }
  | { type: 'tint'; color: [number, number, number]; strength: number; satMul?: number }
  | { type: 'channelRemap'; r: number; g: number; b: number; contrast?: number; brightness?: number };

function applyTransform(r: number, g: number, b: number, t: Transform): [number, number, number] {
  switch (t.type) {
    case 'hueShift': {
      let [h, s, l] = rgbToHsl(r, g, b);
      h = (h + t.degrees) % 360;
      if (t.satMul !== undefined) s = Math.min(1, s * t.satMul);
      if (t.lightMul !== undefined) l = Math.min(1, Math.max(0, l * t.lightMul));
      return hslToRgb(h, s, l);
    }
    case 'tint': {
      let [h, s, l] = rgbToHsl(r, g, b);
      if (t.satMul !== undefined) s = Math.min(1, s * t.satMul);
      const [gr, gg, gb] = hslToRgb(h, s, l);
      return [
        clamp(lerp(gr, t.color[0], t.strength)),
        clamp(lerp(gg, t.color[1], t.strength)),
        clamp(lerp(gb, t.color[2], t.strength)),
      ];
    }
    case 'channelRemap': {
      const contrast = t.contrast ?? 1;
      const brightness = t.brightness ?? 0;
      return [
        clamp((r * t.r - 128) * contrast + 128 + brightness),
        clamp((g * t.g - 128) * contrast + 128 + brightness),
        clamp((b * t.b - 128) * contrast + 128 + brightness),
      ];
    }
  }
}

// ─── Sprite Specs ──────────────────────────────────────────────────

const ASSETS_DIR = path.resolve(__dirname, 'public/assets/enemies');

interface SpriteState {
  frameCount: number;
  frameWidth: number;
  frameHeight: number;
  basePath: string;
}

interface UnitSpec {
  frameWidth: number;
  frameHeight: number;
  idle: SpriteState;
  walk: SpriteState;
  attack: SpriteState;
}

const UNIT_SPECS: Record<string, UnitSpec> = {
  gnome: {
    frameWidth: 192, frameHeight: 192,
    idle:   { frameCount: 8, frameWidth: 192, frameHeight: 192, basePath: 'gnome/Gnome_Idle.png' },
    walk:   { frameCount: 6, frameWidth: 192, frameHeight: 192, basePath: 'gnome/Gnome_Run.png' },
    attack: { frameCount: 7, frameWidth: 192, frameHeight: 192, basePath: 'gnome/Gnome_Attack.png' },
  },
  turtle: {
    frameWidth: 320, frameHeight: 320,
    idle:   { frameCount: 10, frameWidth: 320, frameHeight: 320, basePath: 'turtle/Turtle_Idle.png' },
    walk:   { frameCount: 7,  frameWidth: 320, frameHeight: 320, basePath: 'turtle/Turtle_Walk.png' },
    attack: { frameCount: 10, frameWidth: 320, frameHeight: 320, basePath: 'turtle/Turtle_Attack.png' },
  },
  skull: {
    frameWidth: 192, frameHeight: 192,
    idle:   { frameCount: 8, frameWidth: 192, frameHeight: 192, basePath: 'skull/Skull_Idle.png' },
    walk:   { frameCount: 6, frameWidth: 192, frameHeight: 192, basePath: 'skull/Skull_Run.png' },
    attack: { frameCount: 7, frameWidth: 192, frameHeight: 192, basePath: 'skull/Skull_Attack.png' },
  },
  spider: {
    frameWidth: 192, frameHeight: 192,
    idle:   { frameCount: 8, frameWidth: 192, frameHeight: 192, basePath: 'spider/Spider_Idle.png' },
    walk:   { frameCount: 5, frameWidth: 192, frameHeight: 192, basePath: 'spider/Spider_Run.png' },
    attack: { frameCount: 8, frameWidth: 192, frameHeight: 192, basePath: 'spider/Spider_Attack.png' },
  },
  hyena: {
    frameWidth: 192, frameHeight: 192,
    idle:   { frameCount: 6, frameWidth: 192, frameHeight: 192, basePath: 'gnoll/Gnoll_Idle.png' },
    walk:   { frameCount: 8, frameWidth: 192, frameHeight: 192, basePath: 'gnoll/Gnoll_Walk.png' },
    attack: { frameCount: 8, frameWidth: 192, frameHeight: 192, basePath: 'gnoll/Gnoll_Throw.png' },
  },
  rogue: {
    frameWidth: 192, frameHeight: 192,
    idle:   { frameCount: 8, frameWidth: 192, frameHeight: 192, basePath: 'skull/Skull_Idle.png' },
    walk:   { frameCount: 6, frameWidth: 192, frameHeight: 192, basePath: 'skull/Skull_Run.png' },
    attack: { frameCount: 7, frameWidth: 192, frameHeight: 192, basePath: 'skull/Skull_Attack.png' },
  },
  panda: {
    frameWidth: 256, frameHeight: 256,
    idle:   { frameCount: 10, frameWidth: 256, frameHeight: 256, basePath: 'panda/Panda_Idle.png' },
    walk:   { frameCount: 6,  frameWidth: 256, frameHeight: 256, basePath: 'panda/Panda_Run.png' },
    attack: { frameCount: 13, frameWidth: 256, frameHeight: 256, basePath: 'panda/Panda_Attack.png' },
  },
  lizard: {
    frameWidth: 192, frameHeight: 192,
    idle:   { frameCount: 7, frameWidth: 192, frameHeight: 192, basePath: 'lizard/Lizard_Idle.png' },
    walk:   { frameCount: 6, frameWidth: 192, frameHeight: 192, basePath: 'lizard/Lizard_Run.png' },
    attack: { frameCount: 9, frameWidth: 192, frameHeight: 192, basePath: 'lizard/Lizard_Attack.png' },
  },
  minotaur: {
    frameWidth: 320, frameHeight: 320,
    idle:   { frameCount: 16, frameWidth: 320, frameHeight: 320, basePath: 'minotaur/Minotaur_Idle.png' },
    walk:   { frameCount: 8,  frameWidth: 320, frameHeight: 320, basePath: 'minotaur/Minotaur_Walk.png' },
    attack: { frameCount: 12, frameWidth: 320, frameHeight: 320, basePath: 'minotaur/Minotaur_Attack.png' },
  },
  shaman: {
    frameWidth: 192, frameHeight: 192,
    idle:   { frameCount: 8,  frameWidth: 192, frameHeight: 192, basePath: 'shaman/Shaman_Idle.png' },
    walk:   { frameCount: 4,  frameWidth: 192, frameHeight: 192, basePath: 'shaman/Shaman_Run.png' },
    attack: { frameCount: 10, frameWidth: 192, frameHeight: 192, basePath: 'shaman/Shaman_Attack.png' },
  },
  troll: {
    frameWidth: 384, frameHeight: 384,
    idle:   { frameCount: 12, frameWidth: 384, frameHeight: 384, basePath: 'troll/Troll_Idle.png' },
    walk:   { frameCount: 10, frameWidth: 384, frameHeight: 384, basePath: 'troll/Troll_Walk.png' },
    attack: { frameCount: 6,  frameWidth: 384, frameHeight: 384, basePath: 'troll/Troll_Attack.png' },
  },
  snake: {
    frameWidth: 192, frameHeight: 192,
    idle:   { frameCount: 8, frameWidth: 192, frameHeight: 192, basePath: 'snake/Snake_Idle.png' },
    walk:   { frameCount: 8, frameWidth: 192, frameHeight: 192, basePath: 'snake/Snake_Run.png' },
    attack: { frameCount: 6, frameWidth: 192, frameHeight: 192, basePath: 'snake/Snake_Attack.png' },
  },
  bear: {
    frameWidth: 192, frameHeight: 192,
    idle:   { frameCount: 8, frameWidth: 192, frameHeight: 192, basePath: 'bear/Bear_Idle.png' },
    walk:   { frameCount: 6, frameWidth: 192, frameHeight: 192, basePath: 'bear/Bear_Run.png' },
    attack: { frameCount: 7, frameWidth: 192, frameHeight: 192, basePath: 'bear/Bear_Attack.png' },
  },
  harpoon_fish: {
    frameWidth: 192, frameHeight: 192,
    idle:   { frameCount: 8, frameWidth: 192, frameHeight: 192, basePath: 'harpoon_fish/HarpoonFish_Idle.png' },
    walk:   { frameCount: 6, frameWidth: 192, frameHeight: 192, basePath: 'harpoon_fish/HarpoonFish_Run.png' },
    attack: { frameCount: 8, frameWidth: 192, frameHeight: 192, basePath: 'harpoon_fish/HarpoonFish_Throw.png' },
  },
};

// ─── Skin Definitions ──────────────────────────────────────────────

interface SkinDef {
  id: string;
  unitType: string;
  name: string;
  transform: Transform;
}

const SKINS: SkinDef[] = [
  // ── Gnome ──
  { id: 'skin_gnome_frost', unitType: 'gnome', name: 'Frost Gnome',
    transform: { type: 'hueShift', degrees: 180, satMul: 0.8 } },
  { id: 'skin_gnome_golden', unitType: 'gnome', name: 'Golden Gnome',
    transform: { type: 'tint', color: [255, 215, 0], strength: 0.45 } },
  { id: 'skin_gnome_infernal', unitType: 'gnome', name: 'Infernal Gnome',
    transform: { type: 'channelRemap', r: 1.6, g: 0.4, b: 0.3, contrast: 1.15 } },
  { id: 'skin_gnome_celestial', unitType: 'gnome', name: 'Celestial Gnome',
    transform: { type: 'tint', color: [220, 200, 255], strength: 0.4, satMul: 0.6 } },

  // ── Turtle ──
  { id: 'skin_turtle_mossy', unitType: 'turtle', name: 'Mossy Turtle',
    transform: { type: 'hueShift', degrees: 90, satMul: 1.2 } },
  { id: 'skin_turtle_crystal', unitType: 'turtle', name: 'Crystal Turtle',
    transform: { type: 'tint', color: [140, 220, 235], strength: 0.4, satMul: 0.7 } },
  { id: 'skin_turtle_magma', unitType: 'turtle', name: 'Magma Turtle',
    transform: { type: 'channelRemap', r: 1.7, g: 0.6, b: 0.2, contrast: 1.2 } },
  { id: 'skin_turtle_ancient', unitType: 'turtle', name: 'Ancient Turtle',
    transform: { type: 'tint', color: [160, 140, 80], strength: 0.5, satMul: 0.5 } },

  // ── Skull ──
  { id: 'skin_skull_jade', unitType: 'skull', name: 'Jade Skull',
    transform: { type: 'hueShift', degrees: 120, satMul: 1.1 } },
  { id: 'skin_skull_bloodmoon', unitType: 'skull', name: 'Blood Moon Skull',
    transform: { type: 'tint', color: [180, 20, 20], strength: 0.5 } },
  { id: 'skin_skull_phantom', unitType: 'skull', name: 'Phantom Skull',
    transform: { type: 'channelRemap', r: 0.6, g: 0.5, b: 1.5, contrast: 1.1, brightness: 15 } },
  { id: 'skin_skull_deathknight', unitType: 'skull', name: 'Death Knight Skull',
    transform: { type: 'channelRemap', r: 0.35, g: 0.4, b: 0.45, contrast: 1.3, brightness: -25 } },

  // ── Spider ──
  { id: 'skin_spider_frost', unitType: 'spider', name: 'Frost Spider',
    transform: { type: 'hueShift', degrees: 200, satMul: 0.7 } },
  { id: 'skin_spider_widow', unitType: 'spider', name: 'Black Widow Spider',
    transform: { type: 'tint', color: [30, 5, 5], strength: 0.55 } },
  { id: 'skin_spider_void', unitType: 'spider', name: 'Void Spider',
    transform: { type: 'channelRemap', r: 0.5, g: 0.2, b: 1.6, contrast: 1.2, brightness: -10 } },
  { id: 'skin_spider_mech', unitType: 'spider', name: 'Mech Spider',
    transform: { type: 'hueShift', degrees: 0, satMul: 0.1, lightMul: 1.1 } },

  // ── Hyena ──
  { id: 'skin_hyena_arctic', unitType: 'hyena', name: 'Arctic Hyena',
    transform: { type: 'hueShift', degrees: 190, satMul: 0.5, lightMul: 1.15 } },
  { id: 'skin_hyena_cursed', unitType: 'hyena', name: 'Cursed Hyena',
    transform: { type: 'tint', color: [100, 20, 160], strength: 0.45 } },
  { id: 'skin_hyena_warpaint', unitType: 'hyena', name: 'Warpaint Hyena',
    transform: { type: 'channelRemap', r: 1.5, g: 0.5, b: 0.4, contrast: 1.25 } },
  { id: 'skin_hyena_spectral', unitType: 'hyena', name: 'Spectral Hyena',
    transform: { type: 'tint', color: [200, 230, 255], strength: 0.5, satMul: 0.3 } },

  // ── Rogue ──
  { id: 'skin_rogue_nightblade', unitType: 'rogue', name: 'Nightblade Rogue',
    transform: { type: 'hueShift', degrees: 220, satMul: 0.6, lightMul: 0.8 } },
  { id: 'skin_rogue_pirate', unitType: 'rogue', name: 'Pirate Rogue',
    transform: { type: 'tint', color: [160, 120, 60], strength: 0.4 } },
  { id: 'skin_rogue_ninja', unitType: 'rogue', name: 'Ninja Rogue',
    transform: { type: 'channelRemap', r: 0.3, g: 0.3, b: 0.35, contrast: 1.3, brightness: -20 } },
  { id: 'skin_rogue_assassin', unitType: 'rogue', name: 'Assassin Rogue',
    transform: { type: 'channelRemap', r: 0.5, g: 0.2, b: 0.2, contrast: 1.4, brightness: -30 } },

  // ── Panda ──
  { id: 'skin_panda_red', unitType: 'panda', name: 'Red Panda',
    transform: { type: 'hueShift', degrees: -30, satMul: 1.4 } },
  { id: 'skin_panda_bamboo', unitType: 'panda', name: 'Bamboo Panda',
    transform: { type: 'tint', color: [80, 180, 60], strength: 0.35 } },
  { id: 'skin_panda_samurai', unitType: 'panda', name: 'Samurai Panda',
    transform: { type: 'channelRemap', r: 1.4, g: 0.4, b: 0.35, contrast: 1.2 } },
  { id: 'skin_panda_jade_emperor', unitType: 'panda', name: 'Jade Emperor Panda',
    transform: { type: 'tint', color: [0, 168, 107], strength: 0.45 } },

  // ── Lizard ──
  { id: 'skin_lizard_chameleon', unitType: 'lizard', name: 'Chameleon Lizard',
    transform: { type: 'hueShift', degrees: 150, satMul: 1.3 } },
  { id: 'skin_lizard_dragon', unitType: 'lizard', name: 'Dragon Lizard',
    transform: { type: 'tint', color: [200, 50, 20], strength: 0.45 } },
  { id: 'skin_lizard_toxic', unitType: 'lizard', name: 'Toxic Lizard',
    transform: { type: 'channelRemap', r: 0.3, g: 1.6, b: 0.3, contrast: 1.15, brightness: 10 } },
  { id: 'skin_lizard_elder_wyrm', unitType: 'lizard', name: 'Elder Wyrm Lizard',
    transform: { type: 'tint', color: [140, 105, 20], strength: 0.5 } },

  // ── Minotaur ──
  { id: 'skin_minotaur_iron', unitType: 'minotaur', name: 'Iron Minotaur',
    transform: { type: 'hueShift', degrees: 0, satMul: 0.15, lightMul: 0.9 } },
  { id: 'skin_minotaur_berserker', unitType: 'minotaur', name: 'Berserker Minotaur',
    transform: { type: 'tint', color: [200, 30, 20], strength: 0.5 } },
  { id: 'skin_minotaur_demonic', unitType: 'minotaur', name: 'Demonic Minotaur',
    transform: { type: 'channelRemap', r: 1.5, g: 0.25, b: 0.2, contrast: 1.3, brightness: -15 } },
  { id: 'skin_minotaur_titan', unitType: 'minotaur', name: 'Titan Minotaur',
    transform: { type: 'tint', color: [240, 230, 210], strength: 0.5, satMul: 0.3 } },

  // ── Shaman ──
  { id: 'skin_shaman_druid', unitType: 'shaman', name: 'Druid Shaman',
    transform: { type: 'hueShift', degrees: 100, satMul: 1.2 } },
  { id: 'skin_shaman_necro', unitType: 'shaman', name: 'Necromancer Shaman',
    transform: { type: 'tint', color: [80, 90, 50], strength: 0.5, satMul: 0.6 } },
  { id: 'skin_shaman_archmage', unitType: 'shaman', name: 'Archmage Shaman',
    transform: { type: 'channelRemap', r: 0.7, g: 0.4, b: 1.5, contrast: 1.1, brightness: 10 } },
  { id: 'skin_shaman_void_oracle', unitType: 'shaman', name: 'Void Oracle Shaman',
    transform: { type: 'channelRemap', r: 0.3, g: 0.15, b: 0.8, contrast: 1.3, brightness: -20 } },

  // ── Troll ──
  { id: 'skin_troll_moss', unitType: 'troll', name: 'Moss Troll',
    transform: { type: 'hueShift', degrees: 80, satMul: 1.1 } },
  { id: 'skin_troll_volcanic', unitType: 'troll', name: 'Volcanic Troll',
    transform: { type: 'tint', color: [200, 60, 10], strength: 0.5 } },
  { id: 'skin_troll_frost_king', unitType: 'troll', name: 'Frost King Troll',
    transform: { type: 'channelRemap', r: 0.4, g: 0.7, b: 1.6, contrast: 1.1, brightness: 20 } },
  { id: 'skin_troll_mountain_god', unitType: 'troll', name: 'Mountain God Troll',
    transform: { type: 'hueShift', degrees: 0, satMul: 0.2, lightMul: 1.1 } },

  // ── Snake ──
  { id: 'skin_snake_coral', unitType: 'snake', name: 'Coral Snake',
    transform: { type: 'channelRemap', r: 1.6, g: 0.4, b: 0.3, contrast: 1.1 } },
  { id: 'skin_snake_golden', unitType: 'snake', name: 'Golden Snake',
    transform: { type: 'tint', color: [255, 215, 0], strength: 0.5 } },
  { id: 'skin_snake_shadow_serpent', unitType: 'snake', name: 'Shadow Serpent',
    transform: { type: 'channelRemap', r: 0.3, g: 0.15, b: 0.5, contrast: 1.4, brightness: -25 } },
  { id: 'skin_snake_ouroboros', unitType: 'snake', name: 'Ouroboros',
    transform: { type: 'tint', color: [180, 160, 220], strength: 0.45, satMul: 0.5 } },

  // ── Bear ──
  { id: 'skin_bear_grizzly', unitType: 'bear', name: 'Grizzly Bear',
    transform: { type: 'hueShift', degrees: -20, satMul: 1.3 } },
  { id: 'skin_bear_armored', unitType: 'bear', name: 'Black Bear',
    transform: { type: 'hueShift', degrees: 0, satMul: 0.15, lightMul: 0.85 } },
  { id: 'skin_bear_spirit', unitType: 'bear', name: 'Polar Bear',
    transform: { type: 'tint', color: [220, 230, 255], strength: 0.55, satMul: 0.2 } },
  { id: 'skin_bear_elder', unitType: 'bear', name: 'Kodiak Bear',
    transform: { type: 'tint', color: [140, 100, 40], strength: 0.5 } },

  // ── Harpoon Fish ──
  { id: 'skin_harpoon_fish_reef', unitType: 'harpoon_fish', name: 'Reef Fish',
    transform: { type: 'hueShift', degrees: 60, satMul: 1.4 } },
  { id: 'skin_harpoon_fish_steel', unitType: 'harpoon_fish', name: 'Steel Fish',
    transform: { type: 'hueShift', degrees: 0, satMul: 0.1, lightMul: 1.05 } },
  { id: 'skin_harpoon_fish_abyssal', unitType: 'harpoon_fish', name: 'Abyssal Fish',
    transform: { type: 'channelRemap', r: 0.3, g: 0.4, b: 1.5, contrast: 1.2, brightness: -15 } },
  { id: 'skin_harpoon_fish_leviathan', unitType: 'harpoon_fish', name: 'Leviathan Fish',
    transform: { type: 'tint', color: [20, 180, 160], strength: 0.5, satMul: 0.6 } },
];

// ─── Processing ────────────────────────────────────────────────────

async function processSprite(
  inputPath: string,
  outputPath: string,
  transform: Transform,
): Promise<void> {
  const { data, info } = await sharp(inputPath)
    .raw()
    .toBuffer({ resolveWithObject: true });

  const pixels = new Uint8Array(data);

  for (let i = 0; i < pixels.length; i += 4) {
    const a = pixels[i + 3];
    if (a === 0) continue; // skip transparent

    const r = pixels[i];
    const g = pixels[i + 1];
    const b = pixels[i + 2];

    const [nr, ng, nb] = applyTransform(r, g, b, transform);
    pixels[i] = nr;
    pixels[i + 1] = ng;
    pixels[i + 2] = nb;
    // alpha unchanged
  }

  await sharp(Buffer.from(pixels), {
    raw: { width: info.width, height: info.height, channels: 4 },
  })
    .png()
    .toFile(outputPath);
}

// ─── Main ──────────────────────────────────────────────────────────

async function main() {
  const args = process.argv.slice(2);
  const getArg = (flag: string): string | undefined => {
    const idx = args.indexOf(flag);
    return idx >= 0 && idx + 1 < args.length ? args[idx + 1] : undefined;
  };
  const hasFlag = (flag: string) => args.includes(flag);

  const unitFilter = getArg('--unit');
  const skinFilter = getArg('--skin');
  const dryRun = hasFlag('--dry-run');
  const skipExisting = hasFlag('--skip-existing');

  let skinsToGenerate = SKINS;
  if (unitFilter) skinsToGenerate = skinsToGenerate.filter(s => s.unitType === unitFilter);
  if (skinFilter) skinsToGenerate = skinsToGenerate.filter(s => s.id === skinFilter);

  if (skipExisting) {
    skinsToGenerate = skinsToGenerate.filter(skin => {
      const outDir = path.join(ASSETS_DIR, skin.unitType, 'skins', skin.id);
      const allExist = ['Idle.png', 'Walk.png', 'Attack.png'].every(f =>
        fs.existsSync(path.join(outDir, f))
      );
      if (allExist) console.log(`  Skipping ${skin.id} (already exists)`);
      return !allExist;
    });
  }

  if (skinsToGenerate.length === 0) {
    console.log('No skins to generate.');
    return;
  }

  const stateFiles: Record<string, string> = { idle: 'Idle.png', walk: 'Walk.png', attack: 'Attack.png' };
  const states: ('idle' | 'walk' | 'attack')[] = ['idle', 'walk', 'attack'];

  console.log(`\n=== Programmatic Skin Generator ===`);
  console.log(`Skins: ${skinsToGenerate.length} (${skinsToGenerate.length * 3} sprite sheets)`);
  if (dryRun) console.log('MODE: DRY RUN\n');
  else console.log('');

  let succeeded = 0;
  let failed = 0;

  for (const skin of skinsToGenerate) {
    const spec = UNIT_SPECS[skin.unitType];
    if (!spec) {
      console.error(`  Unknown unit: ${skin.unitType}`);
      failed++;
      continue;
    }

    const outDir = path.join(ASSETS_DIR, skin.unitType, 'skins', skin.id);
    console.log(`[${skin.id}] ${skin.name} (${skin.transform.type})`);

    if (dryRun) {
      for (const state of states) {
        const st = spec[state];
        console.log(`  ${state}: ${st.frameCount} frames @ ${st.frameWidth}x${st.frameHeight}`);
        console.log(`    Base: ${st.basePath}`);
        console.log(`    Out:  ${path.join(outDir, stateFiles[state])}`);
      }
      succeeded++;
      continue;
    }

    fs.mkdirSync(outDir, { recursive: true });

    try {
      for (const state of states) {
        const st = spec[state];
        const basePath = path.join(ASSETS_DIR, st.basePath);
        const outPath = path.join(outDir, stateFiles[state]);

        if (!fs.existsSync(basePath)) {
          throw new Error(`Base sprite not found: ${basePath}`);
        }

        await processSprite(basePath, outPath, skin.transform);
        console.log(`  ${state} -> ${stateFiles[state]}`);
      }
      succeeded++;
    } catch (err: any) {
      console.error(`  ERROR: ${err.message}`);
      failed++;
    }
  }

  console.log(`\n=== Done: ${succeeded} succeeded, ${failed} failed ===`);
}

main().catch(err => { console.error('Fatal:', err); process.exit(1); });
