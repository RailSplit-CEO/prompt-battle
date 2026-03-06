import Phaser from 'phaser';
import { TileType, Position, ControlPoint } from '@prompt-battle/shared';
import { MAP_WIDTH, MAP_HEIGHT, TILE_SIZE } from '../map/MapGenerator';

const MM_SIZE = 72;
const ARROW_SIZE = 5;
const ARROW_GAP = 3;
const LERP = 0.15; // smoothing factor

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

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

export class MiniMap {
  private gfx: Phaser.GameObjects.Graphics;
  private arrowGfx: Phaser.GameObjects.Graphics;
  private scene: Phaser.Scene;
  private scaleX: number;
  private scaleY: number;
  private originX: number;
  private originY: number;

  // Smoothed positions for friendly character dots (charIndex → {x,y})
  private smoothFriendly: { x: number; y: number }[] = [];
  // Smoothed positions for enemy character dots
  private smoothEnemy: { x: number; y: number; vis: boolean }[] = [];
  // Smoothed camera viewport rect
  private smoothVP = { x: 0, y: 0, w: 0, h: 0 };
  private vpInitialized = false;
  // Smoothed arrow target
  private smoothArrowAngle = 0;
  private arrowInitialized = false;

  constructor(scene: Phaser.Scene) {
    this.scene = scene;
    this.scaleX = MM_SIZE / MAP_WIDTH;
    this.scaleY = MM_SIZE / MAP_HEIGHT;

    const { width, height } = scene.cameras.main;
    this.originX = width - MM_SIZE - 8;
    this.originY = height - MM_SIZE - 8;

    this.gfx = scene.add.graphics();
    this.gfx.setScrollFactor(0);
    this.gfx.setDepth(100);
    this.gfx.setPosition(this.originX, this.originY);

    this.arrowGfx = scene.add.graphics();
    this.arrowGfx.setScrollFactor(0);
    this.arrowGfx.setDepth(101);
  }

  update(
    tiles: TileType[][],
    visibleTiles: Set<string>,
    exploredTiles: Set<string>,
    friendlyChars: { position: Position }[],
    enemyChars: { position: Position; visible: boolean }[],
    _flags: { pos1: Position; pos2: Position } | null,
    controlPoints: ControlPoint[],
    camera: Phaser.Cameras.Scene2D.Camera,
    mySpawns: Position[],
    enemySpawns: Position[],
  ) {
    this.gfx.clear();
    this.arrowGfx.clear();

    // Recalculate origin in case of resize
    const { width, height } = this.scene.cameras.main;
    this.originX = width - MM_SIZE - 8;
    this.originY = height - MM_SIZE - 8;
    this.gfx.setPosition(this.originX, this.originY);

    // Background + border
    this.gfx.fillStyle(0x0D0A18, 0.85);
    this.gfx.fillRect(-3, -3, MM_SIZE + 6, MM_SIZE + 6);
    this.gfx.lineStyle(1, 0x3D2070, 0.9);
    this.gfx.strokeRect(-3, -3, MM_SIZE + 6, MM_SIZE + 6);

    // Terrain (batched by fog state for fewer style switches)
    for (let y = 0; y < MAP_HEIGHT; y++) {
      for (let x = 0; x < MAP_WIDTH; x++) {
        const key = `${x},${y}`;
        const visible = visibleTiles.has(key);
        const explored = exploredTiles.has(key);
        const color = TILE_COLORS[tiles[y][x]] ?? 0x333333;

        if (visible) {
          this.gfx.fillStyle(color, 0.85);
        } else if (explored) {
          this.gfx.fillStyle(color, 0.35);
        } else {
          this.gfx.fillStyle(0x222222, 0.9);
        }
        this.gfx.fillRect(
          x * this.scaleX, y * this.scaleY,
          Math.ceil(this.scaleX), Math.ceil(this.scaleY),
        );
      }
    }

    // Deep fog hints
    this.drawFogHints(controlPoints, mySpawns, enemySpawns, visibleTiles, exploredTiles);

    // Control points (always visible)
    for (const cp of controlPoints) {
      const cx = cp.position.x * this.scaleX + this.scaleX / 2;
      const cy = cp.position.y * this.scaleY + this.scaleY / 2;
      const color = cp.owner ? CP_COLORS[cp.owner] : CP_COLORS.neutral;
      this.gfx.lineStyle(1.5, color, 0.9);
      this.gfx.strokeCircle(cx, cy, 3);
      this.gfx.fillStyle(color, 0.9);
      this.gfx.fillCircle(cx, cy, 1.2);
    }

    // --- Smoothed friendly character dots ---
    while (this.smoothFriendly.length < friendlyChars.length) {
      const c = friendlyChars[this.smoothFriendly.length];
      this.smoothFriendly.push({ x: c.position.x * this.scaleX, y: c.position.y * this.scaleY });
    }
    this.smoothFriendly.length = friendlyChars.length;
    for (let i = 0; i < friendlyChars.length; i++) {
      const tx = friendlyChars[i].position.x * this.scaleX;
      const ty = friendlyChars[i].position.y * this.scaleY;
      this.smoothFriendly[i].x = lerp(this.smoothFriendly[i].x, tx, LERP);
      this.smoothFriendly[i].y = lerp(this.smoothFriendly[i].y, ty, LERP);
      this.gfx.fillStyle(0x6CC4FF, 1);
      this.gfx.fillRect(this.smoothFriendly[i].x - 1, this.smoothFriendly[i].y - 1, 2.5, 2.5);
    }

    // --- Smoothed enemy character dots ---
    while (this.smoothEnemy.length < enemyChars.length) {
      const c = enemyChars[this.smoothEnemy.length];
      this.smoothEnemy.push({ x: c.position.x * this.scaleX, y: c.position.y * this.scaleY, vis: c.visible });
    }
    this.smoothEnemy.length = enemyChars.length;
    for (let i = 0; i < enemyChars.length; i++) {
      this.smoothEnemy[i].vis = enemyChars[i].visible;
      if (!this.smoothEnemy[i].vis) continue;
      const tx = enemyChars[i].position.x * this.scaleX;
      const ty = enemyChars[i].position.y * this.scaleY;
      this.smoothEnemy[i].x = lerp(this.smoothEnemy[i].x, tx, LERP);
      this.smoothEnemy[i].y = lerp(this.smoothEnemy[i].y, ty, LERP);
      this.gfx.fillStyle(0xFF6B6B, 1);
      this.gfx.fillRect(this.smoothEnemy[i].x - 1, this.smoothEnemy[i].y - 1, 2.5, 2.5);
    }

    // --- Smoothed camera viewport rectangle ---
    const worldWidth = MAP_WIDTH * TILE_SIZE;
    const worldHeight = MAP_HEIGHT * TILE_SIZE;
    const tvx = (camera.scrollX / worldWidth) * MM_SIZE;
    const tvy = (camera.scrollY / worldHeight) * MM_SIZE;
    const tvw = (camera.width / camera.zoom / worldWidth) * MM_SIZE;
    const tvh = (camera.height / camera.zoom / worldHeight) * MM_SIZE;

    if (!this.vpInitialized) {
      this.smoothVP = { x: tvx, y: tvy, w: tvw, h: tvh };
      this.vpInitialized = true;
    } else {
      this.smoothVP.x = lerp(this.smoothVP.x, tvx, LERP);
      this.smoothVP.y = lerp(this.smoothVP.y, tvy, LERP);
      this.smoothVP.w = lerp(this.smoothVP.w, tvw, LERP);
      this.smoothVP.h = lerp(this.smoothVP.h, tvh, LERP);
    }
    this.gfx.lineStyle(1, 0xffffff, 0.45);
    this.gfx.strokeRect(this.smoothVP.x, this.smoothVP.y, this.smoothVP.w, this.smoothVP.h);

    // Arrow
    this.drawCharArrows(friendlyChars, camera);
  }

  private drawFogHints(
    controlPoints: ControlPoint[],
    mySpawns: Position[],
    enemySpawns: Position[],
    visibleTiles: Set<string>,
    exploredTiles: Set<string>,
  ) {
    const inDeepFog = (x: number, y: number) => {
      const key = `${x},${y}`;
      return !visibleTiles.has(key) && !exploredTiles.has(key);
    };

    const drawBaseZone = (spawns: Position[], color: number) => {
      if (spawns.length === 0) return;
      const minX = Math.min(...spawns.map(s => s.x)) - 2;
      const maxX = Math.max(...spawns.map(s => s.x)) + 2;
      const minY = Math.min(...spawns.map(s => s.y)) - 2;
      const maxY = Math.max(...spawns.map(s => s.y)) + 2;
      for (let y = Math.max(0, minY); y <= Math.min(MAP_HEIGHT - 1, maxY); y++) {
        for (let x = Math.max(0, minX); x <= Math.min(MAP_WIDTH - 1, maxX); x++) {
          if (inDeepFog(x, y)) {
            this.gfx.fillStyle(color, 0.15);
            this.gfx.fillRect(x * this.scaleX, y * this.scaleY,
              Math.ceil(this.scaleX), Math.ceil(this.scaleY));
          }
        }
      }
    };
    drawBaseZone(mySpawns, 0x6CC4FF);
    drawBaseZone(enemySpawns, 0xFF6B6B);

    const CP_R = 3;
    for (const cp of controlPoints) {
      for (let dy = -CP_R; dy <= CP_R; dy++) {
        for (let dx = -CP_R; dx <= CP_R; dx++) {
          if (dx * dx + dy * dy > CP_R * CP_R) continue;
          const tx = cp.position.x + dx;
          const ty = cp.position.y + dy;
          if (tx < 0 || tx >= MAP_WIDTH || ty < 0 || ty >= MAP_HEIGHT) continue;
          if (inDeepFog(tx, ty)) {
            const dist = Math.sqrt(dx * dx + dy * dy);
            this.gfx.fillStyle(0xFFD93D, 0.12 * (1 - dist / CP_R));
            this.gfx.fillRect(tx * this.scaleX, ty * this.scaleY,
              Math.ceil(this.scaleX), Math.ceil(this.scaleY));
          }
        }
      }
    }
  }

  private drawCharArrows(
    friendlyChars: { position: Position }[],
    camera: Phaser.Cameras.Scene2D.Camera,
  ) {
    if (friendlyChars.length === 0) return;

    const avgMX = friendlyChars.reduce((s, c) => s + c.position.x, 0) / friendlyChars.length;
    const avgMY = friendlyChars.reduce((s, c) => s + c.position.y, 0) / friendlyChars.length;
    const dotX = this.originX + avgMX * this.scaleX;
    const dotY = this.originY + avgMY * this.scaleY;

    const mmCX = this.originX + MM_SIZE / 2;
    const mmCY = this.originY + MM_SIZE / 2;
    const dx = dotX - mmCX;
    const dy = dotY - mmCY;
    if (Math.abs(dx) < 1 && Math.abs(dy) < 1) return;

    const targetAngle = Math.atan2(dy, dx);

    // Smooth the angle to avoid jitter
    if (!this.arrowInitialized) {
      this.smoothArrowAngle = targetAngle;
      this.arrowInitialized = true;
    } else {
      // Lerp angles correctly (handle wrap-around)
      let diff = targetAngle - this.smoothArrowAngle;
      while (diff > Math.PI) diff -= Math.PI * 2;
      while (diff < -Math.PI) diff += Math.PI * 2;
      this.smoothArrowAngle += diff * LERP;
    }
    const angle = this.smoothArrowAngle;
    const cosA = Math.cos(angle);
    const sinA = Math.sin(angle);

    // Intersection with minimap rectangle from center
    let t = Infinity;
    if (cosA !== 0) {
      const tR = (MM_SIZE / 2) / cosA;
      const tL = (-MM_SIZE / 2) / cosA;
      if (tR > 0) t = Math.min(t, tR);
      if (tL > 0) t = Math.min(t, tL);
    }
    if (sinA !== 0) {
      const tB = (MM_SIZE / 2) / sinA;
      const tT = (-MM_SIZE / 2) / sinA;
      if (tB > 0) t = Math.min(t, tB);
      if (tT > 0) t = Math.min(t, tT);
    }

    const edgeX = mmCX + cosA * t;
    const edgeY = mmCY + sinA * t;
    const tipX = edgeX + cosA * (ARROW_GAP + ARROW_SIZE);
    const tipY = edgeY + sinA * (ARROW_GAP + ARROW_SIZE);

    const screenW = camera.width;
    const screenH = camera.height;
    if (tipX < 0 || tipX > screenW || tipY < 0 || tipY > screenH) return;

    const inAngle = angle + Math.PI;
    const baseX = tipX + Math.cos(inAngle) * ARROW_SIZE;
    const baseY = tipY + Math.sin(inAngle) * ARROW_SIZE;
    const perpX = Math.cos(inAngle + Math.PI / 2) * ARROW_SIZE * 0.45;
    const perpY = Math.sin(inAngle + Math.PI / 2) * ARROW_SIZE * 0.45;

    const pulse = 0.7 + 0.3 * Math.sin(Date.now() * 0.004);
    this.arrowGfx.fillStyle(0x6CC4FF, pulse);
    this.arrowGfx.fillTriangle(
      tipX, tipY,
      baseX + perpX, baseY + perpY,
      baseX - perpX, baseY - perpY,
    );
  }

  destroy() {
    this.gfx.destroy();
    this.arrowGfx.destroy();
  }
}
