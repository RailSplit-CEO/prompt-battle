export type SfxKey = string;

// Hyena is called "gnoll" in the audio files
const UNIT_AUDIO_NAME: Record<string, string> = { hyena: 'gnoll' };
const audioName = (type: string) => UNIT_AUDIO_NAME[type] || type;

// All sound files to load (relative to assets/sfx/)
const SOUND_FILES: string[] = [
  // Attack
  'atk_gnoll', 'atk_gnome', 'atk_lizard', 'atk_minotaur', 'atk_panda',
  'atk_rogue', 'atk_shaman', 'atk_skull', 'atk_spider', 'atk_turtle',
  // Spawn
  'spawn_gnoll', 'spawn_gnome', 'spawn_lizard', 'spawn_minotaur', 'spawn_panda',
  'spawn_rogue', 'spawn_shaman', 'spawn_skull', 'spawn_spider', 'spawn_turtle',
  // Death
  'death_gnoll', 'death_gnome', 'death_heavy', 'death_lizard', 'death_minotaur',
  'death_panda', 'death_rogue', 'death_shaman', 'death_skull', 'death_small',
  'death_spider', 'death_troll', 'death_turtle',
  // Charge reactions
  'charge_gnoll', 'charge_gnome', 'charge_lizard', 'charge_minotaur', 'charge_panda',
  'charge_rogue', 'charge_shaman', 'charge_skull', 'charge_spider', 'charge_troll', 'charge_turtle',
  // Yes reactions
  'yes_gnoll', 'yes_gnome', 'yes_lizard', 'yes_minotaur', 'yes_panda',
  'yes_rogue', 'yes_shaman', 'yes_skull', 'yes_spider', 'yes_troll', 'yes_turtle',
  // Confused reactions
  'confused_gnoll', 'confused_gnome', 'confused_lizard', 'confused_minotaur', 'confused_panda',
  'confused_rogue', 'confused_shaman', 'confused_skull', 'confused_spider', 'confused_troll', 'confused_turtle',
  // Combat
  'critical_hit', 'hit_heavy', 'hit_light', 'splash_impact', 'ranged_throw',
  // Abilities
  'troll_slam', 'troll_awaken', 'minotaur_warcry', 'turtle_guard', 'thief_hop',
  'undying_proc', 'gnome_spawn',
  // Resources
  'pickup_carrot', 'pickup_crystal', 'pickup_meat', 'pickup_metal',
  'deposit_carrot', 'deposit_crystal', 'deposit_meat', 'deposit_metal',
  'resource_pickup', 'resource_deliver', 'mining_hit',
  // Game state
  'wave_start', 'victory', 'defeat',
  'nexus_damage', 'nexus_critical', 'nexus_destroyed',
  'camp_captured', 'camp_lost',
  // UI
  'armory_equip', 'button_click', 'move_command', 'no_resources', 'voice_recognized',
  'unit_spawn',
];

// Essential sounds to preload (UI + game state — everything else loads on demand)
const PRELOAD_KEYS = new Set([
  'button_click', 'wave_start', 'victory', 'defeat',
  'nexus_damage', 'nexus_critical', 'nexus_destroyed',
  'camp_captured', 'camp_lost', 'unit_spawn', 'move_command',
]);

const WORLD_W = 6400;
const WORLD_H = 6400;

export class SoundManager {
  private scene: Phaser.Scene;
  private loaded = new Set<string>();
  private muted: boolean;
  private globalVolume = 0.5;
  private loading = new Set<string>(); // tracks in-flight lazy loads

  constructor(scene: Phaser.Scene) {
    this.scene = scene;
    this.muted = localStorage.getItem('pb_sound_muted') === 'true';
  }

  // Fix F: only preload essential sounds; rest load lazily on first play
  static preload(scene: Phaser.Scene) {
    for (const key of PRELOAD_KEYS) {
      scene.load.audio(key, `assets/sfx/${key}.mp3`);
    }
  }

  init() {
    // Track which sounds loaded successfully
    for (const key of SOUND_FILES) {
      if (this.scene.cache.audio.exists(key)) {
        this.loaded.add(key);
      }
    }
  }

  /** Lazy-load a sound on demand. Plays on next request after loading. */
  private lazyLoad(key: string) {
    if (this.loading.has(key) || this.loaded.has(key)) return;
    if (this.scene.cache.audio.exists(key)) {
      this.loaded.add(key);
      return;
    }
    this.loading.add(key);
    this.scene.load.audio(key, `assets/sfx/${key}.mp3`);
    this.scene.load.once('complete', () => {
      this.loading.delete(key);
      if (this.scene.cache.audio.exists(key)) {
        this.loaded.add(key);
      }
    });
    this.scene.load.start(); // kick off the load queue
  }

  hasSound(key: SfxKey): boolean {
    // Remap unit type names for audio lookup
    const remapped = this.remapKey(key);
    return this.loaded.has(remapped) || this.scene.cache.audio.exists(remapped);
  }

  play(key: SfxKey) {
    if (this.muted) return;
    const remapped = this.remapKey(key);
    if (!this.scene.cache.audio.exists(remapped)) {
      this.lazyLoad(remapped);
      return; // will play next time it's requested
    }
    this.scene.sound.play(remapped, { volume: this.globalVolume });
  }

  playGlobal(key: SfxKey) {
    if (this.muted) return;
    const remapped = this.remapKey(key);
    if (!this.scene.cache.audio.exists(remapped)) {
      this.lazyLoad(remapped);
      return;
    }
    this.scene.sound.play(remapped, { volume: this.globalVolume });
  }

  playAt(key: SfxKey, x: number, y: number) {
    if (this.muted) return;
    const remapped = this.remapKey(key);
    if (!this.scene.cache.audio.exists(remapped)) {
      this.lazyLoad(remapped);
      return;
    }

    // Distance-based volume from camera center
    const cam = this.scene.cameras.main;
    const camX = cam.scrollX + cam.width / 2;
    const camY = cam.scrollY + cam.height / 2;
    const dx = x - camX, dy = y - camY;
    const dist = Math.sqrt(dx * dx + dy * dy);

    // Audible range scales with zoom — further zoomed out = hear more
    const audibleRange = Math.max(800, (cam.width / cam.zoom) * 0.8);
    if (dist > audibleRange) return; // too far to hear

    const vol = Math.max(0.05, 1 - dist / audibleRange);
    // Stereo pan based on x position relative to camera
    const pan = Math.max(-1, Math.min(1, (dx / (cam.width / 2)) * 0.6));

    this.scene.sound.play(remapped, {
      volume: vol * this.globalVolume,
      pan,
    });
  }

  playReaction(reaction: 'yes' | 'charge' | 'confused', units?: { type: string }[]) {
    if (this.muted || !units || units.length === 0) return;
    // Pick a representative unit type (most common in group)
    const counts: Record<string, number> = {};
    for (const u of units) {
      counts[u.type] = (counts[u.type] || 0) + 1;
    }
    const topType = Object.entries(counts).sort((a, b) => b[1] - a[1])[0][0];
    const key = `${reaction}_${audioName(topType)}`;
    if (!this.scene.cache.audio.exists(key)) {
      this.lazyLoad(key);
      return;
    }
    this.scene.sound.play(key, { volume: this.globalVolume * 0.7 });
  }

  toggleMute(): boolean {
    this.muted = !this.muted;
    localStorage.setItem('pb_sound_muted', String(this.muted));
    if (this.muted) this.scene.sound.stopAll();
    return this.muted;
  }

  get isMuted(): boolean {
    return this.muted;
  }

  setVolume(vol: number) {
    this.globalVolume = Math.max(0, Math.min(1, vol));
  }

  /** Remap unit type names to audio file names (e.g. hyena → gnoll) */
  private remapKey(key: string): string {
    for (const [from, to] of Object.entries(UNIT_AUDIO_NAME)) {
      if (key.includes(from)) return key.replace(from, to);
    }
    return key;
  }
}
