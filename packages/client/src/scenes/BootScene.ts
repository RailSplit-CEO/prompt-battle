import Phaser from 'phaser';

export class BootScene extends Phaser.Scene {
  constructor() {
    super({ key: 'BootScene' });
  }

  preload() {
    this.createPlaceholderTextures();
    this.createTileTextures();
    this.createUITextures();

    const { width, height } = this.cameras.main;

    this.cameras.main.setBackgroundColor('#1B1040');

    // Title
    const titleText = this.add.text(width / 2, height / 2 - 80, 'PROMPT BATTLE', {
      fontSize: '52px',
      color: '#FF6B9D',
      fontFamily: '"Fredoka", sans-serif',
      fontStyle: 'bold',
    }).setOrigin(0.5).setAlpha(0);

    this.tweens.add({
      targets: titleText,
      alpha: 1,
      y: height / 2 - 90,
      scaleX: { from: 0.5, to: 1 },
      scaleY: { from: 0.5, to: 1 },
      duration: 800,
      ease: 'Back.easeOut',
    });

    const subtitle = this.add.text(width / 2, height / 2 - 40, 'LOADING...', {
      fontSize: '14px',
      color: '#8B6DB0',
      fontFamily: '"Nunito", sans-serif',
      fontStyle: 'bold',
      letterSpacing: 6,
    }).setOrigin(0.5).setAlpha(0);

    this.tweens.add({
      targets: subtitle,
      alpha: 0.8,
      duration: 600,
      delay: 400,
    });

    // Loading bar background with cartoon outline
    const barOutline = this.add.graphics();
    barOutline.fillStyle(0x000000, 0.5);
    barOutline.fillRoundedRect(width / 2 - 164, height / 2 + 4, 328, 16, 8);
    barOutline.fillStyle(0x2A1858, 1);
    barOutline.fillRoundedRect(width / 2 - 162, height / 2 + 6, 324, 12, 6);
    barOutline.setAlpha(0);
    this.tweens.add({ targets: barOutline, alpha: 1, duration: 400, delay: 600 });

    // Loading bar fill
    const fill = this.add.graphics();
    fill.setAlpha(0);
    this.tweens.add({ targets: fill, alpha: 1, duration: 400, delay: 600 });

    this.load.on('progress', (v: number) => {
      fill.clear();
      const fillW = 320 * v;
      if (fillW > 0) {
        fill.fillStyle(0xFF6B9D);
        fill.fillRoundedRect(width / 2 - 160, height / 2 + 7, fillW, 10, 5);
        fill.fillStyle(0xffffff, 0.3);
        fill.fillRoundedRect(width / 2 - 160, height / 2 + 7, fillW, 4, 3);
      }
    });

    // Version text
    this.add.text(width / 2, height - 30, 'v0.1.0', {
      fontSize: '11px',
      color: '#4A2580',
      fontFamily: '"Nunito", sans-serif',
      fontStyle: 'bold',
    }).setOrigin(0.5);
  }

  create() {
    this.cameras.main.fadeOut(400, 27, 16, 64);
    this.cameras.main.once('camerafadeoutcomplete', () => {
      this.scene.start('MenuScene');
    });
  }

  private createPlaceholderTextures() {
    const tileColors: Record<string, number> = {
      grass: 0x5CC96B,
      forest: 0x2E8B4E,
      water: 0x45A5FF,
      rock: 0x9B9B9B,
      hill: 0xDEB245,
      bush: 0x65D155,
      path: 0xEDD9A7,
      bridge: 0xC4A060,
      lava: 0xFF5533,
      sand: 0xEED9A0,
      swamp: 0x5A7A44,
      flowers: 0x7BC96B,
      mushroom: 0xBB6644,
      ruins: 0x8888AA,
      gate_open: 0xCCBB88,
      gate_closed: 0x777777,
      switch: 0xFFDD44,
      capture_point: 0xE8C44A,
    };

    for (const [name, color] of Object.entries(tileColors)) {
      const gfx = this.add.graphics();
      gfx.fillStyle(color);
      gfx.fillRect(0, 0, 32, 32);
      gfx.lineStyle(1, 0x000000, 0.2);
      gfx.strokeRect(0, 0, 32, 32);
      if (name === 'forest') {
        gfx.fillStyle(0x1E6B3A);
        gfx.fillCircle(16, 10, 10);
        gfx.fillStyle(0x3AAD5A);
        gfx.fillCircle(16, 12, 7);
        gfx.fillStyle(0x8B6B3A);
        gfx.fillRect(14, 18, 4, 8);
        gfx.fillStyle(0xffffff, 0.15);
        gfx.fillCircle(12, 9, 4);
      } else if (name === 'water') {
        gfx.lineStyle(2, 0x6BC4FF, 0.5);
        gfx.lineBetween(4, 14, 28, 14);
        gfx.lineBetween(8, 22, 24, 22);
        gfx.fillStyle(0xffffff, 0.1);
        gfx.fillCircle(12, 10, 3);
      } else if (name === 'rock') {
        gfx.fillStyle(0x7B7B7B);
        gfx.fillCircle(16, 16, 11);
        gfx.fillStyle(0xABABAB);
        gfx.fillCircle(14, 13, 7);
        gfx.fillStyle(0xffffff, 0.2);
        gfx.fillCircle(12, 11, 4);
      } else if (name === 'hill') {
        gfx.fillStyle(0xC89B30);
        gfx.fillTriangle(16, 4, 4, 28, 28, 28);
        gfx.fillStyle(0xffffff, 0.15);
        gfx.fillTriangle(14, 8, 8, 22, 16, 22);
      } else if (name === 'bush') {
        gfx.fillStyle(0x4DBB45);
        gfx.fillCircle(10, 20, 7);
        gfx.fillCircle(22, 18, 8);
        gfx.fillCircle(16, 13, 6);
        gfx.fillStyle(0xffffff, 0.12);
        gfx.fillCircle(9, 17, 3);
        gfx.fillCircle(20, 15, 3);
      } else if (name === 'path') {
        gfx.fillStyle(0xD4C090, 0.3);
        gfx.fillCircle(12, 10, 2);
        gfx.fillCircle(20, 20, 2);
      } else if (name === 'grass') {
        gfx.fillStyle(0x4AB85A, 0.3);
        gfx.fillCircle(8, 24, 2);
        gfx.fillCircle(24, 8, 2);
      } else if (name === 'lava') {
        gfx.fillStyle(0xFF7722, 0.5);
        gfx.fillCircle(10, 16, 6);
        gfx.fillCircle(22, 14, 5);
      }
      gfx.generateTexture(`tile_${name}`, 32, 32);
      gfx.destroy();
    }

    const classColors: Record<string, number> = {
      warrior: 0xFF5555,
      mage: 0x5577FF,
      archer: 0x55CC55,
      healer: 0xFFDD44,
      rogue: 0xBB55FF,
      paladin: 0xFFAA33,
      necromancer: 0x8855BB,
      bard: 0xFF69B4,
    };

    for (const [cls, color] of Object.entries(classColors)) {
      this.createCharTexture(`char_${cls}_p1`, color, 0x4499FF);
      this.createCharTexture(`char_${cls}_p2`, color, 0xFF5555);
    }

    const selGfx = this.add.graphics();
    // Large bright selection indicator
    selGfx.lineStyle(4, 0xFFD93D, 1);
    selGfx.strokeCircle(20, 20, 18);
    selGfx.lineStyle(2, 0xffffff, 0.6);
    selGfx.strokeCircle(20, 20, 15);
    selGfx.generateTexture('selection_ring', 40, 40);
    selGfx.destroy();
  }

  private createCharTexture(key: string, bodyColor: number, outlineColor: number) {
    const gfx = this.add.graphics();
    // Subtle team-colored disc behind the emoji icon
    gfx.fillStyle(outlineColor, 0.5);
    gfx.fillCircle(16, 16, 14);
    gfx.fillStyle(bodyColor, 0.35);
    gfx.fillCircle(16, 16, 12);
    gfx.generateTexture(key, 32, 32);
    gfx.destroy();
  }

  private createUITextures() {
    // Particle texture
    const particleGfx = this.add.graphics();
    particleGfx.fillStyle(0xffffff);
    particleGfx.fillCircle(4, 4, 4);
    particleGfx.generateTexture('particle', 8, 8);
    particleGfx.destroy();

    // Soft glow texture
    const glowGfx = this.add.graphics();
    glowGfx.fillStyle(0xffffff, 0.6);
    glowGfx.fillCircle(16, 16, 16);
    glowGfx.fillStyle(0xffffff, 0.3);
    glowGfx.fillCircle(16, 16, 12);
    glowGfx.fillStyle(0xffffff, 0.1);
    glowGfx.fillCircle(16, 16, 8);
    glowGfx.generateTexture('glow', 32, 32);
    glowGfx.destroy();

    // Card background texture
    const cardGfx = this.add.graphics();
    cardGfx.fillStyle(0x231250);
    cardGfx.fillRoundedRect(0, 0, 140, 180, 12);
    cardGfx.lineStyle(2, 0x3D2070);
    cardGfx.strokeRoundedRect(0, 0, 140, 180, 12);
    cardGfx.generateTexture('card_bg', 140, 180);
    cardGfx.destroy();

    // Small card background
    const smallCardGfx = this.add.graphics();
    smallCardGfx.fillStyle(0x231250);
    smallCardGfx.fillRoundedRect(0, 0, 110, 140, 10);
    smallCardGfx.lineStyle(2, 0x3D2070);
    smallCardGfx.strokeRoundedRect(0, 0, 110, 140, 10);
    smallCardGfx.generateTexture('small_card_bg', 110, 140);
    smallCardGfx.destroy();

    // Role icon textures
    const roleColors: Record<string, number> = {
      tank: 0xFF5555,
      dps: 0xFF9F43,
      support: 0x45E6B0,
      assassin: 0xBB55FF,
    };
    for (const [role, color] of Object.entries(roleColors)) {
      const g = this.add.graphics();
      g.fillStyle(0x000000, 0.3);
      g.fillCircle(10, 10, 10);
      g.fillStyle(color, 0.4);
      g.fillCircle(10, 10, 9);
      g.fillStyle(color);
      g.fillCircle(10, 10, 6);
      g.fillStyle(0xffffff, 0.3);
      g.fillCircle(8, 8, 3);
      g.generateTexture(`role_${role}`, 20, 20);
      g.destroy();
    }

    // Pickup textures
    const pickupDefs: Record<string, { color: number; symbol: string }> = {
      health_potion: { color: 0x45E6B0, symbol: '+' },
      speed_boost: { color: 0xFFD93D, symbol: '>' },
      damage_boost: { color: 0xFF6B6B, symbol: '!' },
    };
    for (const [name, def] of Object.entries(pickupDefs)) {
      const g = this.add.graphics();
      // Black outline
      g.fillStyle(0x000000, 0.4);
      g.fillCircle(16, 16, 15);
      g.fillStyle(def.color, 0.4);
      g.fillCircle(16, 16, 13);
      g.fillStyle(def.color, 0.9);
      g.fillCircle(16, 16, 10);
      g.fillStyle(0xffffff, 0.5);
      g.fillCircle(16, 16, 6);
      // Cartoon highlight
      g.fillStyle(0xffffff, 0.3);
      g.fillCircle(12, 12, 4);
      g.generateTexture(`pickup_${name}`, 32, 32);
      g.destroy();
    }

    // Archetype icons
    const archColors: Record<string, number> = {
      power: 0xFF6B6B,
      defense: 0x6CC4FF,
      speed: 0x45E6B0,
      magic: 0xC98FFF,
      utility: 0xFFD93D,
    };
    for (const [arch, color] of Object.entries(archColors)) {
      const g = this.add.graphics();
      g.fillStyle(0x000000, 0.3);
      g.fillCircle(8, 8, 8);
      g.fillStyle(color, 0.4);
      g.fillCircle(8, 8, 7);
      g.fillStyle(color);
      g.fillCircle(8, 8, 5);
      g.fillStyle(0xffffff, 0.25);
      g.fillCircle(6, 6, 2);
      g.generateTexture(`arch_${arch}`, 16, 16);
      g.destroy();
    }

    // Control point texture
    const cpGfx = this.add.graphics();
    cpGfx.lineStyle(3, 0xFFD93D, 0.9);
    cpGfx.strokeCircle(16, 16, 14);
    cpGfx.lineStyle(1, 0xffffff, 0.4);
    cpGfx.strokeCircle(16, 16, 10);
    cpGfx.generateTexture('control_point', 32, 32);
    cpGfx.destroy();

    // POI: Lookout post (yellow tower)
    const lookoutGfx = this.add.graphics();
    lookoutGfx.fillStyle(0x000000, 0.5);
    lookoutGfx.fillRoundedRect(10, 4, 12, 24, 3);
    lookoutGfx.fillStyle(0xB8860B);
    lookoutGfx.fillRoundedRect(11, 5, 10, 22, 2);
    lookoutGfx.fillStyle(0xFFD93D);
    lookoutGfx.fillRect(13, 3, 6, 6); // top platform
    lookoutGfx.fillStyle(0xffffff, 0.3);
    lookoutGfx.fillRect(13, 3, 3, 3);
    lookoutGfx.generateTexture('poi_lookout', 32, 32);
    lookoutGfx.destroy();

    // POI: Healing well (green pool)
    const wellGfx = this.add.graphics();
    wellGfx.fillStyle(0x555555);
    wellGfx.fillCircle(16, 16, 14);
    wellGfx.fillStyle(0x333333);
    wellGfx.fillCircle(16, 16, 12);
    wellGfx.fillStyle(0x22AA66, 0.8);
    wellGfx.fillCircle(16, 16, 10);
    wellGfx.fillStyle(0x45E6B0, 0.6);
    wellGfx.fillCircle(16, 16, 7);
    wellGfx.fillStyle(0xffffff, 0.3);
    wellGfx.fillCircle(12, 12, 3);
    wellGfx.generateTexture('poi_healing_well', 32, 32);
    wellGfx.destroy();

    // POI: Treasure cache (orange chest)
    const cacheGfx = this.add.graphics();
    cacheGfx.fillStyle(0x000000, 0.5);
    cacheGfx.fillRoundedRect(6, 10, 20, 16, 3);
    cacheGfx.fillStyle(0xB87333);
    cacheGfx.fillRoundedRect(7, 11, 18, 14, 2);
    cacheGfx.fillStyle(0xFF9F43);
    cacheGfx.fillRoundedRect(8, 12, 16, 12, 2);
    cacheGfx.fillStyle(0xFFD93D);
    cacheGfx.fillRect(14, 14, 4, 4); // lock
    cacheGfx.fillStyle(0xffffff, 0.25);
    cacheGfx.fillRect(9, 13, 7, 3);
    cacheGfx.generateTexture('poi_treasure_cache', 32, 32);
    cacheGfx.destroy();

    // Barricade texture (brown wall)
    const barGfx = this.add.graphics();
    barGfx.fillStyle(0x000000, 0.5);
    barGfx.fillRoundedRect(2, 6, 28, 20, 3);
    barGfx.fillStyle(0x8B4513);
    barGfx.fillRoundedRect(3, 7, 26, 18, 2);
    barGfx.fillStyle(0xA0522D);
    barGfx.fillRect(5, 9, 22, 3);
    barGfx.fillRect(5, 14, 22, 3);
    barGfx.fillRect(5, 19, 22, 3);
    barGfx.lineStyle(1, 0x654321, 0.5);
    barGfx.lineBetween(10, 8, 10, 24);
    barGfx.lineBetween(22, 8, 22, 24);
    barGfx.generateTexture('barricade', 32, 32);
    barGfx.destroy();

    // Trap texture (red/grey spike)
    const trapGfx = this.add.graphics();
    trapGfx.fillStyle(0x888888, 0.6);
    trapGfx.fillCircle(16, 16, 8);
    trapGfx.fillStyle(0xFF4444, 0.5);
    trapGfx.fillTriangle(16, 8, 12, 20, 20, 20);
    trapGfx.fillStyle(0xffffff, 0.2);
    trapGfx.fillCircle(14, 14, 2);
    trapGfx.generateTexture('trap', 32, 32);
    trapGfx.destroy();
  }

  private createTileTextures() {
    const S = 32;
    const g = (fn: (gfx: Phaser.GameObjects.Graphics) => void, name: string) => {
      const gfx = this.add.graphics();
      fn(gfx);
      gfx.generateTexture(`tile_${name}`, S, S);
      gfx.destroy();
    };

    // ── GRASS ──
    g((gfx) => {
      gfx.fillStyle(0x5CC96B); gfx.fillRect(0, 0, S, S);
      gfx.fillStyle(0x6AD97A, 0.4); gfx.fillCircle(8, 8, 6);
      gfx.fillStyle(0x4FB85A, 0.3); gfx.fillCircle(24, 22, 7);
      gfx.lineStyle(1.5, 0x3EA050, 0.5);
      gfx.lineBetween(7, 26, 9, 20); gfx.lineBetween(9, 26, 11, 21);
      gfx.lineBetween(23, 10, 25, 4); gfx.lineBetween(25, 10, 27, 5);
      gfx.lineStyle(1, 0x3A9B48, 0.25); gfx.strokeRect(0, 0, S, S);
    }, 'grass');

    // ── FOREST ──
    g((gfx) => {
      gfx.fillStyle(0x2E8B4E); gfx.fillRect(0, 0, S, S);
      gfx.fillStyle(0x6B4226); gfx.fillRect(14, 18, 5, 14);
      gfx.fillStyle(0x8B5A2B, 0.6); gfx.fillRect(15, 19, 2, 12);
      gfx.fillStyle(0x1B6B32); gfx.fillCircle(16, 8, 12);
      gfx.fillStyle(0x27893F); gfx.fillCircle(10, 11, 8);
      gfx.fillStyle(0x33A84E); gfx.fillCircle(20, 10, 7);
      gfx.fillStyle(0x3DBF58); gfx.fillCircle(16, 6, 6);
      gfx.fillStyle(0xffffff, 0.15); gfx.fillCircle(11, 5, 4);
      gfx.fillStyle(0xffffff, 0.08); gfx.fillCircle(19, 7, 3);
      gfx.lineStyle(1, 0x155528, 0.3); gfx.strokeRect(0, 0, S, S);
    }, 'forest');

    // ── WATER ──
    g((gfx) => {
      gfx.fillStyle(0x3399EE); gfx.fillRect(0, 0, S, S);
      gfx.fillStyle(0x55BBFF, 0.4); gfx.fillCircle(10, 10, 8);
      gfx.fillStyle(0x2277CC, 0.3); gfx.fillCircle(22, 22, 9);
      gfx.lineStyle(2, 0x88DDFF, 0.5);
      gfx.beginPath(); gfx.arc(8, 13, 6, 3.14, 0, true); gfx.strokePath();
      gfx.beginPath(); gfx.arc(22, 13, 6, 3.14, 0, true); gfx.strokePath();
      gfx.lineStyle(1.5, 0x77CCEE, 0.4);
      gfx.beginPath(); gfx.arc(15, 23, 5, 3.14, 0, true); gfx.strokePath();
      gfx.fillStyle(0xffffff, 0.3); gfx.fillCircle(8, 8, 2);
      gfx.fillStyle(0xffffff, 0.2); gfx.fillCircle(24, 14, 1.5);
      gfx.lineStyle(1, 0x2266AA, 0.3); gfx.strokeRect(0, 0, S, S);
    }, 'water');

    // ── ROCK ──
    g((gfx) => {
      gfx.fillStyle(0x7A7A7A); gfx.fillRect(0, 0, S, S);
      gfx.fillStyle(0x666666); gfx.fillRoundedRect(3, 6, 26, 22, 6);
      gfx.fillStyle(0x8E8E8E); gfx.fillRoundedRect(5, 4, 20, 16, 5);
      gfx.fillStyle(0xA0A0A0); gfx.fillRoundedRect(8, 6, 14, 10, 4);
      gfx.lineStyle(1, 0x555555, 0.6);
      gfx.lineBetween(12, 8, 18, 16); gfx.lineBetween(18, 16, 22, 14);
      gfx.lineBetween(14, 12, 10, 18);
      gfx.fillStyle(0xffffff, 0.2); gfx.fillCircle(12, 8, 4);
      gfx.lineStyle(2, 0x444444, 0.5); gfx.strokeRoundedRect(3, 6, 26, 22, 6);
      gfx.lineStyle(1, 0x555555, 0.3); gfx.strokeRect(0, 0, S, S);
    }, 'rock');

    // ── HILL ──
    g((gfx) => {
      gfx.fillStyle(0xD4A940); gfx.fillRect(0, 0, S, S);
      gfx.fillStyle(0xC89B30); gfx.fillTriangle(16, 2, -2, 30, 34, 30);
      gfx.fillStyle(0xDEB245, 0.6); gfx.fillTriangle(16, 6, 4, 28, 24, 28);
      gfx.fillStyle(0xffffff, 0.15); gfx.fillTriangle(12, 6, 4, 24, 16, 24);
      gfx.lineStyle(1.5, 0x6AA840, 0.5);
      gfx.lineBetween(14, 6, 13, 2); gfx.lineBetween(16, 5, 17, 1); gfx.lineBetween(18, 6, 19, 2);
      gfx.lineStyle(1, 0x9A7A20, 0.3); gfx.strokeRect(0, 0, S, S);
    }, 'hill');

    // ── BUSH ──
    g((gfx) => {
      gfx.fillStyle(0x5CC96B); gfx.fillRect(0, 0, S, S);
      gfx.fillStyle(0x339933);
      gfx.fillCircle(10, 22, 9); gfx.fillCircle(24, 19, 10); gfx.fillCircle(16, 14, 8);
      gfx.fillStyle(0x44BB44);
      gfx.fillCircle(12, 20, 6); gfx.fillCircle(22, 17, 7); gfx.fillCircle(15, 12, 5);
      gfx.fillStyle(0xFF5555); gfx.fillCircle(8, 18, 2); gfx.fillCircle(20, 14, 2);
      gfx.fillStyle(0xFF7777); gfx.fillCircle(26, 20, 1.5);
      gfx.fillStyle(0xffffff, 0.12); gfx.fillCircle(10, 18, 3); gfx.fillCircle(20, 14, 3);
      gfx.lineStyle(1, 0x3A9B48, 0.25); gfx.strokeRect(0, 0, S, S);
    }, 'bush');

    // ── PATH ──
    g((gfx) => {
      gfx.fillStyle(0xEDD9A7); gfx.fillRect(0, 0, S, S);
      gfx.fillStyle(0xD4C090, 0.5); gfx.fillCircle(8, 8, 4); gfx.fillCircle(22, 24, 5);
      gfx.fillStyle(0xC4B080, 0.3); gfx.fillCircle(20, 10, 3); gfx.fillCircle(10, 26, 4);
      gfx.fillStyle(0xBBAA88, 0.6);
      gfx.fillCircle(6, 16, 2); gfx.fillCircle(26, 8, 1.5);
      gfx.fillCircle(14, 28, 1.5); gfx.fillCircle(18, 4, 2);
      gfx.lineStyle(1, 0xC0A878, 0.3);
      gfx.lineBetween(10, 0, 10, 32); gfx.lineBetween(22, 0, 22, 32);
      gfx.lineStyle(1, 0xBFA070, 0.2); gfx.strokeRect(0, 0, S, S);
    }, 'path');

    // ── BRIDGE ──
    g((gfx) => {
      gfx.fillStyle(0x3399EE); gfx.fillRect(0, 0, S, S);
      gfx.fillStyle(0x8B6B3A);
      gfx.fillRect(2, 4, 28, 5); gfx.fillRect(2, 12, 28, 5);
      gfx.fillRect(2, 20, 28, 5); gfx.fillRect(2, 28, 28, 4);
      gfx.fillStyle(0xA58050, 0.5);
      gfx.fillRect(4, 5, 24, 2); gfx.fillRect(4, 13, 24, 2);
      gfx.fillRect(4, 21, 24, 2); gfx.fillRect(4, 29, 24, 1);
      gfx.fillStyle(0x2277CC, 0.6);
      gfx.fillRect(2, 9, 28, 3); gfx.fillRect(2, 17, 28, 3); gfx.fillRect(2, 25, 28, 3);
      gfx.fillStyle(0x555555);
      gfx.fillCircle(5, 6, 1); gfx.fillCircle(27, 6, 1);
      gfx.fillCircle(5, 14, 1); gfx.fillCircle(27, 14, 1);
      gfx.fillCircle(5, 22, 1); gfx.fillCircle(27, 22, 1);
      gfx.fillStyle(0x6B4226); gfx.fillRect(0, 0, 3, 32); gfx.fillRect(29, 0, 3, 32);
      gfx.lineStyle(1, 0x4A2E14, 0.4); gfx.strokeRect(0, 0, S, S);
    }, 'bridge');

    // ── LAVA ──
    g((gfx) => {
      gfx.fillStyle(0xCC3300); gfx.fillRect(0, 0, S, S);
      gfx.fillStyle(0xFF6600, 0.7); gfx.fillCircle(10, 12, 8);
      gfx.fillStyle(0xFF9900, 0.5); gfx.fillCircle(22, 20, 9);
      gfx.fillStyle(0xFFCC00, 0.4); gfx.fillCircle(14, 16, 5);
      gfx.fillStyle(0xFFFF66, 0.3); gfx.fillCircle(18, 14, 3);
      gfx.fillStyle(0x661100, 0.6);
      gfx.fillRoundedRect(0, 0, 12, 8, 3); gfx.fillRoundedRect(22, 24, 10, 8, 3);
      gfx.lineStyle(1.5, 0xFFAA33, 0.6);
      gfx.strokeCircle(8, 24, 3); gfx.strokeCircle(26, 8, 2);
      gfx.lineStyle(1, 0x881100, 0.4); gfx.strokeRect(0, 0, S, S);
    }, 'lava');

    // ── SAND ──
    g((gfx) => {
      gfx.fillStyle(0xF0D890); gfx.fillRect(0, 0, S, S);
      gfx.fillStyle(0xE0C880, 0.4); gfx.fillCircle(12, 10, 7); gfx.fillCircle(24, 24, 8);
      gfx.lineStyle(1, 0xD0B870, 0.3);
      gfx.beginPath(); gfx.arc(16, 16, 10, 0.5, 2.5, false); gfx.strokePath();
      gfx.beginPath(); gfx.arc(8, 26, 8, 0.2, 2.8, false); gfx.strokePath();
      gfx.fillStyle(0xC8B068, 0.5);
      gfx.fillCircle(6, 6, 1.5); gfx.fillCircle(20, 14, 1); gfx.fillCircle(28, 28, 1.5);
      gfx.fillStyle(0x88AA44, 0.5);
      gfx.fillRect(26, 2, 2, 6); gfx.fillRect(24, 4, 2, 2);
      gfx.lineStyle(1, 0xD0B060, 0.25); gfx.strokeRect(0, 0, S, S);
    }, 'sand');

    // ── SWAMP ──
    g((gfx) => {
      gfx.fillStyle(0x4A6B3A); gfx.fillRect(0, 0, S, S);
      gfx.fillStyle(0x3A5530, 0.5); gfx.fillCircle(12, 14, 9);
      gfx.fillStyle(0x334D28, 0.4); gfx.fillCircle(22, 22, 8);
      gfx.fillStyle(0x55AA44, 0.7);
      gfx.fillCircle(10, 20, 4); gfx.fillCircle(24, 10, 3);
      gfx.fillStyle(0x4A6B3A); gfx.fillTriangle(10, 20, 12, 18, 14, 20);
      gfx.fillStyle(0x88BB77, 0.4);
      gfx.fillCircle(18, 8, 2); gfx.fillCircle(6, 28, 1.5);
      gfx.lineStyle(2, 0x667744, 0.6);
      gfx.lineBetween(28, 28, 26, 16); gfx.lineBetween(30, 26, 28, 18);
      gfx.fillStyle(0x778855, 0.5); gfx.fillCircle(26, 15, 2);
      gfx.lineStyle(1, 0x3A5530, 0.3); gfx.strokeRect(0, 0, S, S);
    }, 'swamp');

    // ── FLOWERS ──
    g((gfx) => {
      gfx.fillStyle(0x5CC96B); gfx.fillRect(0, 0, S, S);
      gfx.fillStyle(0x6AD97A, 0.3); gfx.fillCircle(16, 16, 10);
      // Pink flower
      gfx.fillStyle(0xFF69B4);
      gfx.fillCircle(8, 10, 3); gfx.fillCircle(12, 8, 3);
      gfx.fillCircle(10, 12, 3); gfx.fillCircle(6, 8, 3);
      gfx.fillStyle(0xFFDD44); gfx.fillCircle(9, 10, 2);
      // Blue flower
      gfx.fillStyle(0x6699FF);
      gfx.fillCircle(24, 22, 2.5); gfx.fillCircle(26, 20, 2.5);
      gfx.fillCircle(22, 20, 2.5); gfx.fillCircle(24, 18, 2.5);
      gfx.fillStyle(0xFFFFAA); gfx.fillCircle(24, 20, 1.5);
      // Red flower
      gfx.fillStyle(0xFF5555);
      gfx.fillCircle(18, 26, 2); gfx.fillCircle(20, 24, 2); gfx.fillCircle(16, 24, 2);
      gfx.fillStyle(0xFFCC44); gfx.fillCircle(18, 25, 1);
      // Stems
      gfx.lineStyle(1, 0x339933, 0.5);
      gfx.lineBetween(9, 13, 9, 18); gfx.lineBetween(24, 23, 24, 28); gfx.lineBetween(18, 27, 18, 30);
      gfx.lineStyle(1, 0x3A9B48, 0.2); gfx.strokeRect(0, 0, S, S);
    }, 'flowers');

    // ── MUSHROOM ──
    g((gfx) => {
      gfx.fillStyle(0x5CC96B); gfx.fillRect(0, 0, S, S);
      // Big mushroom
      gfx.fillStyle(0xEEDDCC); gfx.fillRect(14, 16, 5, 10);
      gfx.fillStyle(0xDD4444); gfx.fillCircle(16, 12, 10);
      gfx.fillStyle(0xCC2222); gfx.fillCircle(16, 14, 9);
      gfx.fillStyle(0xffffff, 0.8);
      gfx.fillCircle(12, 10, 2.5); gfx.fillCircle(20, 9, 2);
      gfx.fillCircle(16, 6, 2); gfx.fillCircle(14, 14, 1.5);
      gfx.fillStyle(0xffffff, 0.15); gfx.fillCircle(12, 8, 5);
      // Small mushroom
      gfx.fillStyle(0xEEDDCC); gfx.fillRect(26, 24, 3, 5);
      gfx.fillStyle(0xDD8844); gfx.fillCircle(27, 22, 4);
      gfx.fillStyle(0xffffff, 0.5); gfx.fillCircle(26, 21, 1);
      gfx.lineStyle(1, 0x3A9B48, 0.2); gfx.strokeRect(0, 0, S, S);
    }, 'mushroom');

    // ── RUINS ──
    g((gfx) => {
      gfx.fillStyle(0x8A8070); gfx.fillRect(0, 0, S, S);
      gfx.fillStyle(0x9A9080);
      gfx.fillRect(2, 14, 12, 18); gfx.fillRect(16, 8, 14, 24);
      gfx.fillStyle(0xA8A090);
      gfx.fillRect(4, 16, 8, 8); gfx.fillRect(18, 10, 10, 10);
      gfx.lineStyle(1, 0x6A6458, 0.5);
      gfx.lineBetween(2, 20, 14, 20); gfx.lineBetween(2, 26, 14, 26);
      gfx.lineBetween(16, 14, 30, 14); gfx.lineBetween(16, 20, 30, 20);
      gfx.lineBetween(8, 14, 8, 32); gfx.lineBetween(22, 8, 22, 32);
      gfx.fillStyle(0x8A8070);
      gfx.fillTriangle(2, 14, 8, 10, 14, 14);
      gfx.fillTriangle(16, 8, 22, 4, 30, 8);
      gfx.fillStyle(0x55AA44, 0.4);
      gfx.fillCircle(4, 16, 3); gfx.fillCircle(28, 10, 2);
      gfx.lineStyle(1, 0x44993A, 0.3);
      gfx.lineBetween(3, 18, 5, 24); gfx.lineBetween(5, 24, 3, 28);
      gfx.fillStyle(0xffffff, 0.1); gfx.fillCircle(20, 12, 4);
      gfx.lineStyle(1.5, 0x5A5448, 0.4); gfx.strokeRect(0, 0, S, S);
    }, 'ruins');

    // ── GATE (CLOSED) ──
    g((gfx) => {
      gfx.fillStyle(0x555555); gfx.fillRect(0, 0, S, S);
      gfx.fillStyle(0x888888);
      gfx.fillRect(4, 0, 3, 32); gfx.fillRect(11, 0, 3, 32);
      gfx.fillRect(18, 0, 3, 32); gfx.fillRect(25, 0, 3, 32);
      gfx.fillStyle(0x777777);
      gfx.fillRect(0, 6, 32, 3); gfx.fillRect(0, 16, 32, 3); gfx.fillRect(0, 26, 32, 3);
      gfx.fillStyle(0xAAAAAA);
      gfx.fillCircle(5, 7, 1.5); gfx.fillCircle(12, 7, 1.5); gfx.fillCircle(19, 7, 1.5); gfx.fillCircle(26, 7, 1.5);
      gfx.fillCircle(5, 17, 1.5); gfx.fillCircle(12, 17, 1.5); gfx.fillCircle(19, 17, 1.5); gfx.fillCircle(26, 17, 1.5);
      gfx.fillCircle(5, 27, 1.5); gfx.fillCircle(12, 27, 1.5); gfx.fillCircle(19, 27, 1.5); gfx.fillCircle(26, 27, 1.5);
      gfx.fillStyle(0xCC8833); gfx.fillRect(13, 12, 6, 7);
      gfx.lineStyle(2, 0xCC8833, 1); gfx.strokeCircle(16, 11, 3);
      gfx.fillStyle(0xFF3333, 0.15); gfx.fillRect(0, 0, S, S);
      gfx.lineStyle(2, 0x333333, 0.6); gfx.strokeRect(0, 0, S, S);
    }, 'gate_closed');

    // ── GATE (OPEN) ──
    g((gfx) => {
      gfx.fillStyle(0xDDCCA0); gfx.fillRect(0, 0, S, S);
      gfx.fillStyle(0x888888);
      gfx.fillRect(0, 0, 4, 32); gfx.fillRect(28, 0, 4, 32);
      gfx.fillStyle(0xC8B888, 0.4); gfx.fillCircle(16, 16, 6);
      gfx.lineStyle(1, 0xAA9968, 0.4);
      gfx.lineBetween(4, 8, 28, 8); gfx.lineBetween(4, 24, 28, 24);
      gfx.fillStyle(0x33FF33, 0.08); gfx.fillRect(0, 0, S, S);
      gfx.lineStyle(1, 0x999977, 0.3); gfx.strokeRect(0, 0, S, S);
    }, 'gate_open');

    // ── SWITCH ──
    g((gfx) => {
      gfx.fillStyle(0x888899); gfx.fillRect(0, 0, S, S);
      gfx.fillStyle(0x777788); gfx.fillRoundedRect(4, 4, 24, 24, 4);
      gfx.fillStyle(0x9999AA); gfx.fillRoundedRect(6, 6, 20, 20, 3);
      gfx.fillStyle(0xBBBBCC); gfx.fillRoundedRect(8, 8, 16, 16, 2);
      gfx.fillStyle(0xCCCCDD, 0.5); gfx.fillRoundedRect(10, 10, 12, 12, 2);
      gfx.fillStyle(0xFFAA33); gfx.fillTriangle(16, 11, 12, 19, 20, 19);
      gfx.fillStyle(0xFFAA33, 0.15); gfx.fillCircle(16, 16, 12);
      gfx.fillStyle(0xffffff, 0.15); gfx.fillCircle(12, 12, 5);
      gfx.lineStyle(1.5, 0x666677, 0.5); gfx.strokeRoundedRect(4, 4, 24, 24, 4);
      gfx.lineStyle(1, 0x666677, 0.3); gfx.strokeRect(0, 0, S, S);
    }, 'switch');

    // ── CAPTURE POINT ──
    g((gfx) => {
      gfx.fillStyle(0xE8C44A); gfx.fillRect(0, 0, S, S);
      gfx.fillStyle(0xD4B040, 0.6); gfx.fillCircle(16, 16, 12);
      gfx.fillStyle(0xF0D060, 0.4); gfx.fillCircle(16, 16, 8);
      gfx.fillStyle(0xFFE880, 0.3); gfx.fillCircle(16, 16, 4);
      gfx.lineStyle(1.5, 0xC09830, 0.6); gfx.strokeCircle(16, 16, 12);
      gfx.lineStyle(1, 0xB08820, 0.3); gfx.strokeRect(0, 0, S, S);
    }, 'capture_point');
  }
}
