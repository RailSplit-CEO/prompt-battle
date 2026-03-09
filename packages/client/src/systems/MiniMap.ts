import Phaser from 'phaser';
import { Position, Camp, Structure, Hero, Base, GameState, AnimalType, TileType } from '@prompt-battle/shared';
import { MAP_WIDTH, MAP_HEIGHT, TILE_SIZE } from '../map/MapGenerator';

const MM_SIZE = 140;

const TILE_COLORS: Record<string, number> = {
  grass: 0x5CC96B,
  forest: 0x2E8B4E,
  water: 0x45A5FF,
  hill: 0xDEB245,
  path: 0xEDD9A7,
  bridge: 0xC4A060,
  sand: 0xEED9A0,
  river: 0x3388CC,
  shore: 0xD4C090,
  blue_base: 0x2266CC,
  red_base: 0xCC2222,
};

const TEAM_COLORS = {
  player1: 0x6CC4FF,
  player2: 0xFF6B6B,
  neutral: 0x999999,
};

export class MiniMap {
  private gfx: Phaser.GameObjects.Graphics;
  private scene: Phaser.Scene;
  private mapTiles: TileType[][];
  private scaleX: number;
  private scaleY: number;
  private originX: number;
  private originY: number;
  private terrainTexture: Phaser.GameObjects.RenderTexture | null = null;
  private terrainDirty = true;

  constructor(scene: Phaser.Scene, mapTiles: TileType[][]) {
    this.scene = scene;
    this.mapTiles = mapTiles;
    this.scaleX = MM_SIZE / MAP_WIDTH;
    this.scaleY = MM_SIZE / MAP_HEIGHT;

    const { width, height } = scene.cameras.main;
    this.originX = width - MM_SIZE - 8;
    this.originY = height - MM_SIZE - 8;

    this.gfx = scene.add.graphics();
    this.gfx.setScrollFactor(0);
    this.gfx.setDepth(100);

    // Click-to-pan
    scene.input.on('pointerdown', (pointer: Phaser.Input.Pointer) => {
      const mx = pointer.x - this.originX;
      const my = pointer.y - this.originY;
      if (mx >= 0 && mx <= MM_SIZE && my >= 0 && my <= MM_SIZE) {
        const worldX = (mx / MM_SIZE) * MAP_WIDTH * TILE_SIZE;
        const worldY = (my / MM_SIZE) * MAP_HEIGHT * TILE_SIZE;
        scene.cameras.main.centerOn(worldX, worldY);
      }
    });
  }

  handleClick(pointer: Phaser.Input.Pointer): Position | null {
    const mx = pointer.x - this.originX;
    const my = pointer.y - this.originY;
    if (mx >= 0 && mx <= MM_SIZE && my >= 0 && my <= MM_SIZE) {
      const tileX = Math.floor((mx / MM_SIZE) * MAP_WIDTH);
      const tileY = Math.floor((my / MM_SIZE) * MAP_HEIGHT);
      return { x: tileX, y: tileY };
    }
    return null;
  }

  update(gameState: GameState, viewportRect: { x: number; y: number; w: number; h: number }) {
    this.gfx.clear();

    // Recalculate origin in case of resize
    const { width, height } = this.scene.cameras.main;
    this.originX = width - MM_SIZE - 8;
    this.originY = height - MM_SIZE - 8;

    const ox = this.originX;
    const oy = this.originY;

    // Background + border
    this.gfx.fillStyle(0x0D0A18, 0.85);
    this.gfx.fillRect(ox - 3, oy - 3, MM_SIZE + 6, MM_SIZE + 6);
    this.gfx.lineStyle(1, 0x3D2070, 0.9);
    this.gfx.strokeRect(ox - 3, oy - 3, MM_SIZE + 6, MM_SIZE + 6);

    // Draw terrain tiles
    this.drawTerrain(ox, oy);

    // Draw camps
    this.drawCamps(gameState.camps, ox, oy);

    // Draw structures
    this.drawStructures(gameState.structures, ox, oy);

    // Draw bases with HP indicators
    this.drawBases(gameState.bases, ox, oy);

    // Draw hero positions
    this.drawHeroes(gameState.heroes, ox, oy);

    // Draw viewport rectangle
    this.drawViewport(viewportRect, ox, oy);
  }

  private drawTerrain(ox: number, oy: number) {
    for (let y = 0; y < MAP_HEIGHT; y++) {
      for (let x = 0; x < MAP_WIDTH; x++) {
        const tile = this.mapTiles[y]?.[x];
        const color = TILE_COLORS[tile] ?? 0x333333;
        this.gfx.fillStyle(color, 0.85);
        this.gfx.fillRect(
          ox + x * this.scaleX,
          oy + y * this.scaleY,
          Math.ceil(this.scaleX),
          Math.ceil(this.scaleY),
        );
      }
    }
  }

  private drawCamps(camps: Camp[], ox: number, oy: number) {
    for (const camp of camps) {
      const cx = ox + camp.position.x * this.scaleX + this.scaleX / 2;
      const cy = oy + camp.position.y * this.scaleY + this.scaleY / 2;

      let color: number;
      if (camp.capturedTeam === 'player1') {
        color = TEAM_COLORS.player1;
      } else if (camp.capturedTeam === 'player2') {
        color = TEAM_COLORS.player2;
      } else {
        color = TEAM_COLORS.neutral;
      }

      // Camp dot
      this.gfx.fillStyle(color, 0.9);
      this.gfx.fillCircle(cx, cy, 2.5);
      this.gfx.lineStyle(1, color, 0.6);
      this.gfx.strokeCircle(cx, cy, 3.5);
    }
  }

  private drawStructures(structures: Structure[], ox: number, oy: number) {
    for (const structure of structures) {
      const sx = ox + structure.position.x * this.scaleX + this.scaleX / 2;
      const sy = oy + structure.position.y * this.scaleY + this.scaleY / 2;
      const size = 4;

      let color: number;
      if (structure.destroyedBy === 'player1') {
        color = TEAM_COLORS.player1;
      } else if (structure.destroyedBy === 'player2') {
        color = TEAM_COLORS.player2;
      } else {
        // Alive / neutral structure
        color = 0x8B6633; // brown
      }

      const alive = structure.hp > 0;
      const alpha = alive ? 0.9 : 0.5;

      // Structure square marker
      this.gfx.fillStyle(color, alpha);
      this.gfx.fillRect(sx - size / 2, sy - size / 2, size, size);
      this.gfx.lineStyle(1, color, alpha * 0.8);
      this.gfx.strokeRect(sx - size / 2, sy - size / 2, size, size);
    }
  }

  private drawBases(bases: { player1: Base; player2: Base }, ox: number, oy: number) {
    const drawBase = (base: Base, color: number, label: string) => {
      const bx = ox + base.position.x * this.scaleX + this.scaleX / 2;
      const by = oy + base.position.y * this.scaleY + this.scaleY / 2;

      // Base circle
      this.gfx.fillStyle(color, 0.6);
      this.gfx.fillCircle(bx, by, 5);
      this.gfx.lineStyle(1.5, color, 0.9);
      this.gfx.strokeCircle(bx, by, 5);

      // HP bar below base
      const hpRatio = Math.max(0, base.hp / base.maxHp);
      const barW = 12;
      const barH = 2;
      const barX = bx - barW / 2;
      const barY = by + 7;

      // Background
      this.gfx.fillStyle(0x000000, 0.5);
      this.gfx.fillRect(barX, barY, barW, barH);
      // Fill
      const hpColor = hpRatio > 0.5 ? 0x45E6B0 : hpRatio > 0.25 ? 0xFFD93D : 0xFF4444;
      this.gfx.fillStyle(hpColor, 0.9);
      this.gfx.fillRect(barX, barY, barW * hpRatio, barH);
    };

    drawBase(bases.player1, TEAM_COLORS.player1, 'P1');
    drawBase(bases.player2, TEAM_COLORS.player2, 'P2');
  }

  private drawHeroes(heroes: Record<string, Hero>, ox: number, oy: number) {
    for (const heroId in heroes) {
      const hero = heroes[heroId];
      if (hero.isDead) continue;

      const hx = ox + hero.position.x * this.scaleX + this.scaleX / 2;
      const hy = oy + hero.position.y * this.scaleY + this.scaleY / 2;

      const color = hero.team === 'player1' ? TEAM_COLORS.player1 : TEAM_COLORS.player2;

      // Hero dot (larger than camp dots)
      this.gfx.fillStyle(color, 1);
      this.gfx.fillCircle(hx, hy, 3);

      // Outline for visibility
      this.gfx.lineStyle(1, 0xffffff, 0.5);
      this.gfx.strokeCircle(hx, hy, 3);
    }
  }

  private drawViewport(
    viewportRect: { x: number; y: number; w: number; h: number },
    ox: number, oy: number,
  ) {
    const worldWidth = MAP_WIDTH * TILE_SIZE;
    const worldHeight = MAP_HEIGHT * TILE_SIZE;

    const vx = ox + (viewportRect.x / worldWidth) * MM_SIZE;
    const vy = oy + (viewportRect.y / worldHeight) * MM_SIZE;
    const vw = (viewportRect.w / worldWidth) * MM_SIZE;
    const vh = (viewportRect.h / worldHeight) * MM_SIZE;

    this.gfx.lineStyle(1, 0xffffff, 0.45);
    this.gfx.strokeRect(vx, vy, vw, vh);
  }

  destroy() {
    this.gfx.destroy();
    if (this.terrainTexture) {
      this.terrainTexture.destroy();
    }
  }
}
