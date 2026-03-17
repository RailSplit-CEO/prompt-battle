import { HordeUnitType } from '../types/store';

// ─── SkinDef Interface ──────────────────────────────────────────

export interface SkinDef {
  id: string;
  unitType: HordeUnitType;
  name: string;
  // Path prefix for skin sprites, relative to assets/enemies/{unitType}/skins/{skinId}/
  // Skin sprites follow same naming: Idle.png, Walk.png, Attack.png
  spritePath: string;
  // Whether this is just a palette swap (reuses same frame dimensions) or new sprites
  isRecolor: boolean;
  // Optional particle effects
  particles?: {
    idle?: { color: string; count: number; speed: number };
    walk?: { color: string; count: number; speed: number };
    attack?: { color: string; count: number; speed: number };
  };
}

// ─── Skin Registry ──────────────────────────────────────────────

export const SKIN_REGISTRY: Record<string, SkinDef> = {
  // ── Gnome ───────────────────────────────────────────────────────
  skin_gnome_frost: {
    id: 'skin_gnome_frost',
    unitType: 'gnome',
    name: 'Frost Gnome',
    spritePath: 'assets/enemies/gnome/skins/skin_gnome_frost/',
    isRecolor: true,
  },
  skin_gnome_golden: {
    id: 'skin_gnome_golden',
    unitType: 'gnome',
    name: 'Golden Gnome',
    spritePath: 'assets/enemies/gnome/skins/skin_gnome_golden/',
    isRecolor: true,
    particles: {
      idle: { color: '#ffd700', count: 4, speed: 0.3 },
    },
  },
  skin_gnome_infernal: {
    id: 'skin_gnome_infernal',
    unitType: 'gnome',
    name: 'Infernal Gnome',
    spritePath: 'assets/enemies/gnome/skins/skin_gnome_infernal/',
    isRecolor: false,
    particles: {
      attack: { color: '#ff4500', count: 12, speed: 2.0 },
    },
  },
  skin_gnome_celestial: {
    id: 'skin_gnome_celestial',
    unitType: 'gnome',
    name: 'Celestial Gnome',
    spritePath: 'assets/enemies/gnome/skins/skin_gnome_celestial/',
    isRecolor: false,
    particles: {
      idle: { color: '#fffacd', count: 8, speed: 0.5 },
      walk: { color: '#fffacd', count: 6, speed: 0.8 },
      attack: { color: '#fff8dc', count: 16, speed: 2.5 },
    },
  },

  // ── Turtle ──────────────────────────────────────────────────────
  skin_turtle_mossy: {
    id: 'skin_turtle_mossy',
    unitType: 'turtle',
    name: 'Mossy Turtle',
    spritePath: 'assets/enemies/turtle/skins/skin_turtle_mossy/',
    isRecolor: true,
  },
  skin_turtle_crystal: {
    id: 'skin_turtle_crystal',
    unitType: 'turtle',
    name: 'Crystal Turtle',
    spritePath: 'assets/enemies/turtle/skins/skin_turtle_crystal/',
    isRecolor: true,
    particles: {
      idle: { color: '#b0e0e6', count: 5, speed: 0.4 },
    },
  },
  skin_turtle_magma: {
    id: 'skin_turtle_magma',
    unitType: 'turtle',
    name: 'Magma Turtle',
    spritePath: 'assets/enemies/turtle/skins/skin_turtle_magma/',
    isRecolor: false,
    particles: {
      attack: { color: '#ff6347', count: 14, speed: 1.8 },
    },
  },
  skin_turtle_ancient: {
    id: 'skin_turtle_ancient',
    unitType: 'turtle',
    name: 'Ancient Turtle',
    spritePath: 'assets/enemies/turtle/skins/skin_turtle_ancient/',
    isRecolor: false,
    particles: {
      idle: { color: '#8b8000', count: 6, speed: 0.3 },
      walk: { color: '#8b8000', count: 5, speed: 0.6 },
      attack: { color: '#daa520', count: 14, speed: 2.2 },
    },
  },

  // ── Skull ───────────────────────────────────────────────────────
  skin_skull_jade: {
    id: 'skin_skull_jade',
    unitType: 'skull',
    name: 'Jade Skull',
    spritePath: 'assets/enemies/skull/skins/skin_skull_jade/',
    isRecolor: true,
  },
  skin_skull_bloodmoon: {
    id: 'skin_skull_bloodmoon',
    unitType: 'skull',
    name: 'Blood Moon Skull',
    spritePath: 'assets/enemies/skull/skins/skin_skull_bloodmoon/',
    isRecolor: true,
    particles: {
      idle: { color: '#8b0000', count: 4, speed: 0.4 },
    },
  },
  skin_skull_phantom: {
    id: 'skin_skull_phantom',
    unitType: 'skull',
    name: 'Phantom Skull',
    spritePath: 'assets/enemies/skull/skins/skin_skull_phantom/',
    isRecolor: false,
    particles: {
      attack: { color: '#c8a2c8', count: 10, speed: 1.6 },
    },
  },
  skin_skull_deathknight: {
    id: 'skin_skull_deathknight',
    unitType: 'skull',
    name: 'Death Knight Skull',
    spritePath: 'assets/enemies/skull/skins/skin_skull_deathknight/',
    isRecolor: false,
    particles: {
      idle: { color: '#2f4f4f', count: 6, speed: 0.5 },
      walk: { color: '#2f4f4f', count: 5, speed: 0.8 },
      attack: { color: '#1a1a2e', count: 18, speed: 2.8 },
    },
  },

  // ── Spider ──────────────────────────────────────────────────────
  skin_spider_widow: {
    id: 'skin_spider_widow',
    unitType: 'spider',
    name: 'Black Widow Spider',
    spritePath: 'assets/enemies/spider/skins/skin_spider_widow/',
    isRecolor: true,
  },
  skin_spider_frost: {
    id: 'skin_spider_frost',
    unitType: 'spider',
    name: 'Frost Spider',
    spritePath: 'assets/enemies/spider/skins/skin_spider_frost/',
    isRecolor: true,
    particles: {
      idle: { color: '#add8e6', count: 5, speed: 0.3 },
    },
  },
  skin_spider_void: {
    id: 'skin_spider_void',
    unitType: 'spider',
    name: 'Void Spider',
    spritePath: 'assets/enemies/spider/skins/skin_spider_void/',
    isRecolor: false,
    particles: {
      attack: { color: '#4b0082', count: 12, speed: 2.0 },
    },
  },
  skin_spider_mech: {
    id: 'skin_spider_mech',
    unitType: 'spider',
    name: 'Mech Spider',
    spritePath: 'assets/enemies/spider/skins/skin_spider_mech/',
    isRecolor: false,
    particles: {
      idle: { color: '#c0c0c0', count: 4, speed: 0.4 },
      walk: { color: '#c0c0c0', count: 6, speed: 1.0 },
      attack: { color: '#00bfff', count: 16, speed: 3.0 },
    },
  },

  // ── Hyena ───────────────────────────────────────────────────────
  skin_hyena_arctic: {
    id: 'skin_hyena_arctic',
    unitType: 'hyena',
    name: 'Arctic Hyena',
    spritePath: 'assets/enemies/hyena/skins/skin_hyena_arctic/',
    isRecolor: true,
  },
  skin_hyena_cursed: {
    id: 'skin_hyena_cursed',
    unitType: 'hyena',
    name: 'Cursed Hyena',
    spritePath: 'assets/enemies/hyena/skins/skin_hyena_cursed/',
    isRecolor: true,
    particles: {
      idle: { color: '#6a0dad', count: 4, speed: 0.35 },
    },
  },
  skin_hyena_warpaint: {
    id: 'skin_hyena_warpaint',
    unitType: 'hyena',
    name: 'Warpaint Hyena',
    spritePath: 'assets/enemies/hyena/skins/skin_hyena_warpaint/',
    isRecolor: false,
    particles: {
      attack: { color: '#dc143c', count: 10, speed: 1.8 },
    },
  },
  skin_hyena_spectral: {
    id: 'skin_hyena_spectral',
    unitType: 'hyena',
    name: 'Spectral Hyena',
    spritePath: 'assets/enemies/hyena/skins/skin_hyena_spectral/',
    isRecolor: false,
    particles: {
      idle: { color: '#e0ffff', count: 8, speed: 0.5 },
      walk: { color: '#e0ffff', count: 6, speed: 0.9 },
      attack: { color: '#f0f8ff', count: 14, speed: 2.4 },
    },
  },

  // ── Rogue ───────────────────────────────────────────────────────
  skin_rogue_nightblade: {
    id: 'skin_rogue_nightblade',
    unitType: 'rogue',
    name: 'Nightblade Rogue',
    spritePath: 'assets/enemies/rogue/skins/skin_rogue_nightblade/',
    isRecolor: true,
  },
  skin_rogue_pirate: {
    id: 'skin_rogue_pirate',
    unitType: 'rogue',
    name: 'Pirate Rogue',
    spritePath: 'assets/enemies/rogue/skins/skin_rogue_pirate/',
    isRecolor: true,
    particles: {
      idle: { color: '#deb887', count: 3, speed: 0.3 },
    },
  },
  skin_rogue_ninja: {
    id: 'skin_rogue_ninja',
    unitType: 'rogue',
    name: 'Ninja Rogue',
    spritePath: 'assets/enemies/rogue/skins/skin_rogue_ninja/',
    isRecolor: false,
    particles: {
      attack: { color: '#1c1c1c', count: 10, speed: 2.5 },
    },
  },
  skin_rogue_assassin: {
    id: 'skin_rogue_assassin',
    unitType: 'rogue',
    name: 'Assassin Rogue',
    spritePath: 'assets/enemies/rogue/skins/skin_rogue_assassin/',
    isRecolor: false,
    particles: {
      idle: { color: '#2d2d2d', count: 5, speed: 0.4 },
      walk: { color: '#2d2d2d', count: 4, speed: 0.7 },
      attack: { color: '#8b0000', count: 14, speed: 3.0 },
    },
  },

  // ── Panda ───────────────────────────────────────────────────────
  skin_panda_red: {
    id: 'skin_panda_red',
    unitType: 'panda',
    name: 'Red Panda',
    spritePath: 'assets/enemies/panda/skins/skin_panda_red/',
    isRecolor: true,
  },
  skin_panda_bamboo: {
    id: 'skin_panda_bamboo',
    unitType: 'panda',
    name: 'Bamboo Panda',
    spritePath: 'assets/enemies/panda/skins/skin_panda_bamboo/',
    isRecolor: true,
    particles: {
      idle: { color: '#7cfc00', count: 4, speed: 0.3 },
    },
  },
  skin_panda_samurai: {
    id: 'skin_panda_samurai',
    unitType: 'panda',
    name: 'Samurai Panda',
    spritePath: 'assets/enemies/panda/skins/skin_panda_samurai/',
    isRecolor: false,
    particles: {
      attack: { color: '#b22222', count: 12, speed: 2.2 },
    },
  },
  skin_panda_jade_emperor: {
    id: 'skin_panda_jade_emperor',
    unitType: 'panda',
    name: 'Jade Emperor Panda',
    spritePath: 'assets/enemies/panda/skins/skin_panda_jade_emperor/',
    isRecolor: false,
    particles: {
      idle: { color: '#00a86b', count: 8, speed: 0.5 },
      walk: { color: '#00a86b', count: 6, speed: 0.8 },
      attack: { color: '#50c878', count: 16, speed: 2.6 },
    },
  },

  // ── Lizard ──────────────────────────────────────────────────────
  skin_lizard_chameleon: {
    id: 'skin_lizard_chameleon',
    unitType: 'lizard',
    name: 'Chameleon Lizard',
    spritePath: 'assets/enemies/lizard/skins/skin_lizard_chameleon/',
    isRecolor: true,
  },
  skin_lizard_dragon: {
    id: 'skin_lizard_dragon',
    unitType: 'lizard',
    name: 'Dragon Lizard',
    spritePath: 'assets/enemies/lizard/skins/skin_lizard_dragon/',
    isRecolor: true,
    particles: {
      idle: { color: '#ff8c00', count: 5, speed: 0.4 },
    },
  },
  skin_lizard_toxic: {
    id: 'skin_lizard_toxic',
    unitType: 'lizard',
    name: 'Toxic Lizard',
    spritePath: 'assets/enemies/lizard/skins/skin_lizard_toxic/',
    isRecolor: false,
    particles: {
      attack: { color: '#39ff14', count: 12, speed: 1.8 },
    },
  },
  skin_lizard_elder_wyrm: {
    id: 'skin_lizard_elder_wyrm',
    unitType: 'lizard',
    name: 'Elder Wyrm Lizard',
    spritePath: 'assets/enemies/lizard/skins/skin_lizard_elder_wyrm/',
    isRecolor: false,
    particles: {
      idle: { color: '#b8860b', count: 7, speed: 0.5 },
      walk: { color: '#b8860b', count: 6, speed: 0.9 },
      attack: { color: '#ff4500', count: 18, speed: 2.8 },
    },
  },

  // ── Minotaur ────────────────────────────────────────────────────
  skin_minotaur_iron: {
    id: 'skin_minotaur_iron',
    unitType: 'minotaur',
    name: 'Iron Minotaur',
    spritePath: 'assets/enemies/minotaur/skins/skin_minotaur_iron/',
    isRecolor: true,
  },
  skin_minotaur_berserker: {
    id: 'skin_minotaur_berserker',
    unitType: 'minotaur',
    name: 'Berserker Minotaur',
    spritePath: 'assets/enemies/minotaur/skins/skin_minotaur_berserker/',
    isRecolor: true,
    particles: {
      idle: { color: '#cc0000', count: 4, speed: 0.4 },
    },
  },
  skin_minotaur_demonic: {
    id: 'skin_minotaur_demonic',
    unitType: 'minotaur',
    name: 'Demonic Minotaur',
    spritePath: 'assets/enemies/minotaur/skins/skin_minotaur_demonic/',
    isRecolor: false,
    particles: {
      attack: { color: '#8b0000', count: 14, speed: 2.2 },
    },
  },
  skin_minotaur_titan: {
    id: 'skin_minotaur_titan',
    unitType: 'minotaur',
    name: 'Titan Minotaur',
    spritePath: 'assets/enemies/minotaur/skins/skin_minotaur_titan/',
    isRecolor: false,
    particles: {
      idle: { color: '#daa520', count: 8, speed: 0.5 },
      walk: { color: '#daa520', count: 7, speed: 0.9 },
      attack: { color: '#ffd700', count: 20, speed: 3.0 },
    },
  },

  // ── Shaman ──────────────────────────────────────────────────────
  skin_shaman_druid: {
    id: 'skin_shaman_druid',
    unitType: 'shaman',
    name: 'Druid Shaman',
    spritePath: 'assets/enemies/shaman/skins/skin_shaman_druid/',
    isRecolor: true,
  },
  skin_shaman_necro: {
    id: 'skin_shaman_necro',
    unitType: 'shaman',
    name: 'Necromancer Shaman',
    spritePath: 'assets/enemies/shaman/skins/skin_shaman_necro/',
    isRecolor: true,
    particles: {
      idle: { color: '#556b2f', count: 5, speed: 0.35 },
    },
  },
  skin_shaman_archmage: {
    id: 'skin_shaman_archmage',
    unitType: 'shaman',
    name: 'Archmage Shaman',
    spritePath: 'assets/enemies/shaman/skins/skin_shaman_archmage/',
    isRecolor: false,
    particles: {
      attack: { color: '#7b68ee', count: 14, speed: 2.0 },
    },
  },
  skin_shaman_void_oracle: {
    id: 'skin_shaman_void_oracle',
    unitType: 'shaman',
    name: 'Void Oracle Shaman',
    spritePath: 'assets/enemies/shaman/skins/skin_shaman_void_oracle/',
    isRecolor: false,
    particles: {
      idle: { color: '#191970', count: 8, speed: 0.5 },
      walk: { color: '#191970', count: 6, speed: 0.8 },
      attack: { color: '#4b0082', count: 18, speed: 2.6 },
    },
  },

  // ── Troll ───────────────────────────────────────────────────────
  skin_troll_moss: {
    id: 'skin_troll_moss',
    unitType: 'troll',
    name: 'Moss Troll',
    spritePath: 'assets/enemies/troll/skins/skin_troll_moss/',
    isRecolor: true,
  },
  skin_troll_volcanic: {
    id: 'skin_troll_volcanic',
    unitType: 'troll',
    name: 'Volcanic Troll',
    spritePath: 'assets/enemies/troll/skins/skin_troll_volcanic/',
    isRecolor: true,
    particles: {
      idle: { color: '#ff4500', count: 5, speed: 0.4 },
    },
  },
  skin_troll_frost_king: {
    id: 'skin_troll_frost_king',
    unitType: 'troll',
    name: 'Frost King Troll',
    spritePath: 'assets/enemies/troll/skins/skin_troll_frost_king/',
    isRecolor: false,
    particles: {
      attack: { color: '#87ceeb', count: 14, speed: 2.0 },
    },
  },
  skin_troll_mountain_god: {
    id: 'skin_troll_mountain_god',
    unitType: 'troll',
    name: 'Mountain God Troll',
    spritePath: 'assets/enemies/troll/skins/skin_troll_mountain_god/',
    isRecolor: false,
    particles: {
      idle: { color: '#808080', count: 8, speed: 0.4 },
      walk: { color: '#808080', count: 7, speed: 0.7 },
      attack: { color: '#a9a9a9', count: 20, speed: 2.8 },
    },
  },
};

// ─── Helper Functions ───────────────────────────────────────────

export function getSkinDef(skinId: string): SkinDef | undefined {
  return SKIN_REGISTRY[skinId];
}

export function getSkinsForUnit(unitType: HordeUnitType): SkinDef[] {
  return Object.values(SKIN_REGISTRY).filter(s => s.unitType === unitType);
}

export function getSkinSpritePath(
  unitType: HordeUnitType,
  skinId: string,
  state: 'idle' | 'walk' | 'attack',
): string {
  const stateFile = state === 'idle' ? 'Idle' : state === 'walk' ? 'Walk' : 'Attack';
  return `assets/enemies/${unitType}/skins/${skinId}/${stateFile}.png`;
}
