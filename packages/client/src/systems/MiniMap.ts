import Phaser from 'phaser';
import { TileType, Position, ControlPoint } from '@prompt-battle/shared';
import { MAP_WIDTH, MAP_HEIGHT, TILE_SIZE } from '../map/MapGenerator';

const MM_SIZE = 120;

const TILE_COLORS: Record<TileType, number> = {
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
};

const CP_COLORS: Record<string, number> = {
  player1: 0x6CC4FF,
  player2: 0xFF6B6B,
  neutral: 0xFFD93D,
};

export class MiniMap {
  private gfx: Phaser.GameObjects.Graphics;
  private scene: Phaser.Scene;
  private scaleX: number;
  private scaleY: number;

  constructor(scene: Phaser.Scene) {
    this.scene = scene;
    this.scaleX = MM_SIZE / MAP_WIDTH;
    this.scaleY = MM_SIZE / MAP_HEIGHT;

    const { width, height } = scene.cameras.main;
    this.gfx = scene.add.graphics();
    this.gfx.setScrollFactor(0);
    this.gfx.setDepth(100);
    this.gfx.setPosition(width - MM_SIZE - 8, height - MM_SIZE - 8);
  }

  update(
    tiles: TileType[][],
    visibleTiles: Set<string>,
    friendlyChars: { position: Position }[],
    enemyChars: { position: Position; visible: boolean }[],
    flags: { pos1: Position; pos2: Position } | null,
    controlPoints: ControlPoint[],
    camera: Phaser.Cameras.Scene2D.Camera,
  ) {
    this.gfx.clear();

    // Background border
    this.gfx.fillStyle(0x000000, 0.7);
    this.gfx.fillRect(-2, -2, MM_SIZE + 4, MM_SIZE + 4);

    // Terrain
    for (let y = 0; y < MAP_HEIGHT; y++) {
      for (let x = 0; x < MAP_WIDTH; x++) {
        const inFog = !visibleTiles.has(`${x},${y}`);
        const color = TILE_COLORS[tiles[y][x]] ?? 0x333333;
        this.gfx.fillStyle(color, inFog ? 0.3 : 0.8);
        this.gfx.fillRect(
          x * this.scaleX, y * this.scaleY,
          Math.ceil(this.scaleX), Math.ceil(this.scaleY),
        );
      }
    }

    // Control points
    for (const cp of controlPoints) {
      const cx = cp.position.x * this.scaleX + this.scaleX / 2;
      const cy = cp.position.y * this.scaleY + this.scaleY / 2;
      const color = cp.owner ? CP_COLORS[cp.owner] : CP_COLORS.neutral;
      this.gfx.fillStyle(color, 0.9);
      this.gfx.fillCircle(cx, cy, 3);
    }

    // Flags (only if provided)
    if (flags) {
      this.gfx.fillStyle(0x6CC4FF, 1);
      this.gfx.fillTriangle(
        flags.pos1.x * this.scaleX, flags.pos1.y * this.scaleY - 3,
        flags.pos1.x * this.scaleX + 4, flags.pos1.y * this.scaleY,
        flags.pos1.x * this.scaleX, flags.pos1.y * this.scaleY + 3,
      );
      this.gfx.fillStyle(0xFF6B6B, 1);
      this.gfx.fillTriangle(
        flags.pos2.x * this.scaleX, flags.pos2.y * this.scaleY - 3,
        flags.pos2.x * this.scaleX + 4, flags.pos2.y * this.scaleY,
        flags.pos2.x * this.scaleX, flags.pos2.y * this.scaleY + 3,
      );
    }

    // Characters
    for (const c of friendlyChars) {
      this.gfx.fillStyle(0x6CC4FF, 1);
      this.gfx.fillRect(c.position.x * this.scaleX - 1, c.position.y * this.scaleY - 1, 3, 3);
    }
    for (const c of enemyChars) {
      if (!c.visible) continue;
      this.gfx.fillStyle(0xFF6B6B, 1);
      this.gfx.fillRect(c.position.x * this.scaleX - 1, c.position.y * this.scaleY - 1, 3, 3);
    }

    // Camera viewport rectangle
    const worldWidth = MAP_WIDTH * TILE_SIZE;
    const worldHeight = MAP_HEIGHT * TILE_SIZE;
    const vx = (camera.scrollX / worldWidth) * MM_SIZE;
    const vy = (camera.scrollY / worldHeight) * MM_SIZE;
    const vw = (camera.width / camera.zoom / worldWidth) * MM_SIZE;
    const vh = (camera.height / camera.zoom / worldHeight) * MM_SIZE;
    this.gfx.lineStyle(1, 0xffffff, 0.6);
    this.gfx.strokeRect(vx, vy, vw, vh);
  }

  destroy() {
    this.gfx.destroy();
  }
}
