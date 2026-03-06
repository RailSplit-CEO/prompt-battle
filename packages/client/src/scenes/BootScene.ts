import Phaser from 'phaser';

export class BootScene extends Phaser.Scene {
  constructor() {
    super({ key: 'BootScene' });
  }

  preload() {
    this.createPlaceholderTextures();
    this.createUITextures();

    const { width, height } = this.cameras.main;

    // Dark background
    this.cameras.main.setBackgroundColor('#050510');

    // Animated loading screen
    const titleText = this.add.text(width / 2, height / 2 - 80, 'PROMPT BATTLE', {
      fontSize: '48px',
      color: '#6c63ff',
      fontFamily: '"Orbitron", "Rajdhani", monospace',
      fontStyle: 'bold',
    }).setOrigin(0.5).setAlpha(0);

    this.tweens.add({
      targets: titleText,
      alpha: 1,
      y: height / 2 - 90,
      duration: 800,
      ease: 'Back.easeOut',
    });

    const subtitle = this.add.text(width / 2, height / 2 - 40, 'INITIALIZING...', {
      fontSize: '12px',
      color: '#444',
      fontFamily: 'monospace',
      letterSpacing: 8,
    }).setOrigin(0.5).setAlpha(0);

    this.tweens.add({
      targets: subtitle,
      alpha: 0.7,
      duration: 600,
      delay: 400,
    });

    // Loading bar background
    const barBg = this.add.rectangle(width / 2, height / 2 + 10, 320, 4, 0x1a1a2e);
    barBg.setAlpha(0);
    this.tweens.add({ targets: barBg, alpha: 1, duration: 400, delay: 600 });

    // Loading bar fill with glow
    const fill = this.add.rectangle(width / 2 - 158, height / 2 + 10, 4, 4, 0x6c63ff);
    fill.setOrigin(0, 0.5).setAlpha(0);
    this.tweens.add({ targets: fill, alpha: 1, duration: 400, delay: 600 });

    // Glow behind the fill bar
    const glow = this.add.rectangle(width / 2 - 158, height / 2 + 10, 4, 12, 0x6c63ff, 0.3);
    glow.setOrigin(0, 0.5).setAlpha(0);
    this.tweens.add({ targets: glow, alpha: 1, duration: 400, delay: 600 });

    this.load.on('progress', (v: number) => {
      fill.width = 316 * v;
      glow.width = 316 * v;
    });

    // Version text
    this.add.text(width / 2, height - 30, 'v0.1.0', {
      fontSize: '10px',
      color: '#333',
      fontFamily: 'monospace',
    }).setOrigin(0.5);
  }

  create() {
    // Dramatic transition to menu
    this.cameras.main.fadeOut(400, 5, 5, 16);
    this.cameras.main.once('camerafadeoutcomplete', () => {
      this.scene.start('MenuScene');
    });
  }

  private createPlaceholderTextures() {
    const tileColors: Record<string, number> = {
      grass: 0x3a7d44,
      forest: 0x2d5a27,
      water: 0x2266aa,
      rock: 0x666666,
      hill: 0x8a7d3a,
      bush: 0x4a8a3a,
      path: 0xb8a67a,
    };

    for (const [name, color] of Object.entries(tileColors)) {
      const gfx = this.add.graphics();
      gfx.fillStyle(color);
      gfx.fillRect(0, 0, 32, 32);
      gfx.lineStyle(1, 0x000000, 0.15);
      gfx.strokeRect(0, 0, 32, 32);
      if (name === 'forest') {
        gfx.fillStyle(0x1a4a1a);
        gfx.fillCircle(16, 12, 8);
        gfx.fillStyle(0x3a6a2a);
        gfx.fillCircle(16, 14, 6);
      } else if (name === 'water') {
        gfx.lineStyle(1, 0x4488cc, 0.4);
        gfx.lineBetween(4, 16, 28, 16);
        gfx.lineBetween(8, 22, 24, 22);
      } else if (name === 'rock') {
        gfx.fillStyle(0x555555);
        gfx.fillCircle(16, 16, 10);
        gfx.fillStyle(0x777777);
        gfx.fillCircle(14, 14, 6);
      } else if (name === 'hill') {
        gfx.fillStyle(0x9a8d4a);
        gfx.fillTriangle(16, 4, 4, 28, 28, 28);
        // Arrow-up indicator (range bonus)
        gfx.lineStyle(1, 0xffffff, 0.25);
        gfx.lineBetween(16, 8, 16, 14);
        gfx.lineBetween(16, 8, 13, 11);
        gfx.lineBetween(16, 8, 19, 11);
      } else if (name === 'forest') {
        // Shield indicator (ambush bonus)
        gfx.lineStyle(1, 0xffffff, 0.15);
        gfx.strokeCircle(26, 6, 4);
      } else if (name === 'bush') {
        gfx.fillStyle(0x5a9a4a);
        gfx.fillCircle(10, 20, 6);
        gfx.fillCircle(22, 18, 7);
        gfx.fillCircle(16, 14, 5);
        // Eye indicator (concealment)
        gfx.lineStyle(1, 0xffffff, 0.15);
        gfx.strokeCircle(26, 6, 3);
        gfx.fillStyle(0xffffff, 0.15);
        gfx.fillCircle(26, 6, 1);
      } else if (name === 'path') {
        // Footprint indicator (fast movement)
        gfx.fillStyle(0x000000, 0.1);
        gfx.fillCircle(12, 10, 2);
        gfx.fillCircle(20, 18, 2);
      }
      gfx.generateTexture(`tile_${name}`, 32, 32);
      gfx.destroy();
    }

    const classColors: Record<string, number> = {
      warrior: 0xcc4444,
      mage: 0x4466cc,
      archer: 0x44aa44,
      healer: 0xeedd44,
      rogue: 0x8844aa,
      paladin: 0xddaa44,
      necromancer: 0x664488,
      bard: 0xcc66aa,
    };

    for (const [cls, color] of Object.entries(classColors)) {
      this.createCharTexture(`char_${cls}_p1`, color, 0x4444ff);
      this.createCharTexture(`char_${cls}_p2`, color, 0xff4444);
    }

    const selGfx = this.add.graphics();
    selGfx.lineStyle(2, 0xffff00, 0.9);
    selGfx.strokeCircle(16, 16, 14);
    selGfx.generateTexture('selection_ring', 32, 32);
    selGfx.destroy();
  }

  private createCharTexture(key: string, bodyColor: number, outlineColor: number) {
    const gfx = this.add.graphics();
    gfx.fillStyle(outlineColor);
    gfx.fillCircle(16, 16, 14);
    gfx.fillStyle(bodyColor);
    gfx.fillCircle(16, 16, 12);
    gfx.fillStyle(0xffffff, 0.2);
    gfx.fillCircle(12, 12, 5);
    gfx.generateTexture(key, 32, 32);
    gfx.destroy();
  }

  private createUITextures() {
    // Particle texture (small glowing dot)
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
    cardGfx.fillStyle(0x12122a);
    cardGfx.fillRoundedRect(0, 0, 140, 180, 8);
    cardGfx.lineStyle(1, 0x2a2a4a);
    cardGfx.strokeRoundedRect(0, 0, 140, 180, 8);
    cardGfx.generateTexture('card_bg', 140, 180);
    cardGfx.destroy();

    // Small card background
    const smallCardGfx = this.add.graphics();
    smallCardGfx.fillStyle(0x12122a);
    smallCardGfx.fillRoundedRect(0, 0, 110, 140, 6);
    smallCardGfx.lineStyle(1, 0x2a2a4a);
    smallCardGfx.strokeRoundedRect(0, 0, 110, 140, 6);
    smallCardGfx.generateTexture('small_card_bg', 110, 140);
    smallCardGfx.destroy();

    // Role icon textures
    const roleColors: Record<string, number> = {
      tank: 0xcc4444,
      dps: 0xff8844,
      support: 0x44cc88,
      assassin: 0x8844cc,
    };
    for (const [role, color] of Object.entries(roleColors)) {
      const g = this.add.graphics();
      g.fillStyle(color, 0.3);
      g.fillCircle(10, 10, 10);
      g.fillStyle(color);
      g.fillCircle(10, 10, 6);
      g.generateTexture(`role_${role}`, 20, 20);
      g.destroy();
    }

    // Pickup textures
    const pickupDefs: Record<string, { color: number; symbol: string }> = {
      health_potion: { color: 0x44cc44, symbol: '+' },
      speed_boost: { color: 0xffcc00, symbol: '>' },
      damage_boost: { color: 0xff4444, symbol: '!' },
    };
    for (const [name, def] of Object.entries(pickupDefs)) {
      const g = this.add.graphics();
      g.fillStyle(def.color, 0.3);
      g.fillCircle(16, 16, 14);
      g.fillStyle(def.color, 0.8);
      g.fillCircle(16, 16, 10);
      g.fillStyle(0xffffff, 0.6);
      g.fillCircle(16, 16, 6);
      g.generateTexture(`pickup_${name}`, 32, 32);
      g.destroy();
    }

    // Archetype icons
    const archColors: Record<string, number> = {
      power: 0xff4444,
      defense: 0x4488ff,
      speed: 0x44ff88,
      magic: 0xaa44ff,
      utility: 0xffaa44,
    };
    for (const [arch, color] of Object.entries(archColors)) {
      const g = this.add.graphics();
      g.fillStyle(color, 0.3);
      g.fillCircle(8, 8, 8);
      g.fillStyle(color);
      g.fillCircle(8, 8, 5);
      g.generateTexture(`arch_${arch}`, 16, 16);
      g.destroy();
    }

    // Control point texture (pulsing ring)
    const cpGfx = this.add.graphics();
    cpGfx.lineStyle(2, 0xffffff, 0.8);
    cpGfx.strokeCircle(16, 16, 14);
    cpGfx.lineStyle(1, 0xffffff, 0.3);
    cpGfx.strokeCircle(16, 16, 10);
    cpGfx.generateTexture('control_point', 32, 32);
    cpGfx.destroy();
  }
}
