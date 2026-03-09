import Phaser from 'phaser';
import { Hero, Position } from '@prompt-battle/shared';
import { CharacterEntity } from '../entities/Character';
import { TILE_SIZE, MAP_WIDTH, MAP_HEIGHT } from '../map/MapGenerator';

// 1/3 of previous size, square
const VP_SCALE = 0.1;
const MERGE_TILE_DIST = 8;
const BORDER_PX = 2;
const BORDER_COLOR = 0xCBB8EE;
const MARGIN = 14;
const VP_ZOOM = 1.0;
const LERP_SPEED = 0.12; // smoothing factor per frame (0..1)

interface Slot {
  camera: Phaser.Cameras.Scene2D.Camera;
  label: Phaser.GameObjects.Text;
  active: boolean;
  charIds: string[];
  // Current (smoothed) screen position & size
  sx: number;
  sy: number;
  w: number;
  h: number;
  // Target screen position
  targetSX: number;
  targetSY: number;
  // Current & target world center for the camera
  centerWorldX: number;
  centerWorldY: number;
  targetWorldX: number;
  targetWorldY: number;
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

export class CharacterViewports {
  private scene: Phaser.Scene;
  private playerId: string;
  private slots: Slot[] = [];
  private borderGfx: Phaser.GameObjects.Graphics;
  private worldW: number;
  private worldH: number;

  constructor(scene: Phaser.Scene, playerId: string) {
    this.scene = scene;
    this.playerId = playerId;
    this.worldW = MAP_WIDTH * TILE_SIZE;
    this.worldH = MAP_HEIGHT * TILE_SIZE;

    this.borderGfx = scene.add.graphics()
      .setScrollFactor(0)
      .setDepth(150);

    for (let i = 0; i < 3; i++) {
      const cam = scene.cameras.add(0, 0, 100, 100, false, `charVP_${i}`);
      cam.setVisible(false);
      cam.setBackgroundColor(0x0D0A18);
      cam.setZoom(VP_ZOOM);
      cam.setBounds(0, 0, this.worldW, this.worldH);
      cam.inputEnabled = false;

      const label = scene.add.text(0, 0, '', {
        fontSize: '10px',
        color: '#cbb8ee',
        fontFamily: '"Nunito", sans-serif',
        fontStyle: 'bold',
        backgroundColor: '#1a1030dd',
        padding: { x: 4, y: 1 },
      }).setScrollFactor(0).setDepth(151).setVisible(false).setOrigin(0, 1);

      this.slots.push({
        camera: cam,
        label,
        active: false,
        charIds: [],
        sx: 0, sy: 0, w: 0, h: 0,
        targetSX: 0, targetSY: 0,
        centerWorldX: 0, centerWorldY: 0,
        targetWorldX: 0, targetWorldY: 0,
      });
    }

    // Ignore our own drawing elements in viewport cameras
    for (const slot of this.slots) {
      slot.camera.ignore(this.borderGfx);
      for (const s of this.slots) {
        slot.camera.ignore(s.label);
      }
    }
  }

  update(
    charData: Map<string, Hero>,
    _charEntities: Map<string, CharacterEntity>,
  ) {
    const mainCam = this.scene.cameras.main;
    const screenW = mainCam.width;
    const screenH = mainCam.height;

    // Square viewports, sized from the shorter screen dimension
    const vpSide = Math.round(Math.min(screenW, screenH) * VP_SCALE);

    // Ensure HUD elements (scrollFactor 0) are hidden in viewport cameras
    this.syncIgnored();

    // Collect alive player heroes
    const myChars: { id: string; pos: Position; wx: number; wy: number; name: string }[] = [];
    charData.forEach((c, id) => {
      if (c.team === (this.playerId as any) && !c.isDead) {
        myChars.push({
          id,
          pos: c.position,
          wx: c.position.x * TILE_SIZE + TILE_SIZE / 2,
          wy: c.position.y * TILE_SIZE + TILE_SIZE / 2,
          name: c.name,
        });
      }
    });

    // Determine which are off-screen on the main camera
    const viewL = mainCam.scrollX;
    const viewR = mainCam.scrollX + screenW / mainCam.zoom;
    const viewT = mainCam.scrollY;
    const viewB = mainCam.scrollY + screenH / mainCam.zoom;

    const offScreen = myChars.filter(c =>
      c.wx < viewL || c.wx > viewR || c.wy < viewT || c.wy > viewB,
    );

    // Group nearby off-screen characters into shared viewports
    const groups: (typeof offScreen)[] = [];
    const used = new Set<string>();
    for (const c of offScreen) {
      if (used.has(c.id)) continue;
      const group = [c];
      used.add(c.id);
      for (const o of offScreen) {
        if (used.has(o.id)) continue;
        if (Math.abs(c.pos.x - o.pos.x) + Math.abs(c.pos.y - o.pos.y) <= MERGE_TILE_DIST) {
          group.push(o);
          used.add(o.id);
        }
      }
      groups.push(group);
    }

    this.borderGfx.clear();

    const camCX = mainCam.scrollX + screenW / (2 * mainCam.zoom);
    const camCY = mainCam.scrollY + screenH / (2 * mainCam.zoom);

    for (let i = 0; i < this.slots.length; i++) {
      const slot = this.slots[i];

      if (i < groups.length) {
        const group = groups[i];
        const cx = group.reduce((s, c) => s + c.wx, 0) / group.length;
        const cy = group.reduce((s, c) => s + c.wy, 0) / group.length;

        // Direction from main camera center to character group
        const angle = Math.atan2(cy - camCY, cx - camCX);

        // Place viewport toward that edge of the screen
        const rangeX = (screenW - vpSide) / 2 - MARGIN;
        const rangeY = (screenH - vpSide) / 2 - MARGIN;
        let sx = screenW / 2 + Math.cos(angle) * rangeX - vpSide / 2;
        let sy = screenH / 2 + Math.sin(angle) * rangeY - vpSide / 2;
        sx = Phaser.Math.Clamp(sx, MARGIN, screenW - vpSide - MARGIN);
        sy = Phaser.Math.Clamp(sy, MARGIN, screenH - vpSide - MARGIN);

        // Prevent overlap with earlier viewports
        for (let j = 0; j < i; j++) {
          const o = this.slots[j];
          if (!o.active) continue;
          if (sx < o.sx + o.w + 6 && sx + vpSide > o.sx - 6 &&
              sy < o.sy + o.h + 6 && sy + vpSide > o.sy - 6) {
            sy = o.sy + o.h + 8;
            if (sy + vpSide > screenH - MARGIN) sy = o.sy - vpSide - 8;
          }
        }

        // Set target positions
        slot.targetSX = sx;
        slot.targetSY = sy;
        slot.targetWorldX = cx;
        slot.targetWorldY = cy;

        // If just becoming active, snap immediately instead of lerping from old pos
        if (!slot.active) {
          slot.sx = sx;
          slot.sy = sy;
          slot.centerWorldX = cx;
          slot.centerWorldY = cy;
        }

        // Smooth lerp toward targets
        slot.sx = lerp(slot.sx, slot.targetSX, LERP_SPEED);
        slot.sy = lerp(slot.sy, slot.targetSY, LERP_SPEED);
        slot.centerWorldX = lerp(slot.centerWorldX, slot.targetWorldX, LERP_SPEED);
        slot.centerWorldY = lerp(slot.centerWorldY, slot.targetWorldY, LERP_SPEED);

        const roundedSX = Math.round(slot.sx);
        const roundedSY = Math.round(slot.sy);

        slot.camera.setViewport(roundedSX, roundedSY, vpSide, vpSide);
        slot.camera.setVisible(true);
        slot.camera.centerOn(slot.centerWorldX, slot.centerWorldY);

        slot.active = true;
        slot.charIds = group.map(c => c.id);
        slot.w = vpSide;
        slot.h = vpSide;

        // Border
        this.borderGfx.lineStyle(BORDER_PX, BORDER_COLOR, 0.9);
        this.borderGfx.strokeRect(
          roundedSX - BORDER_PX, roundedSY - BORDER_PX,
          vpSide + BORDER_PX * 2, vpSide + BORDER_PX * 2,
        );

        // Label
        const names = group.map(c => c.name.split(' ')[0]).join(' & ');
        slot.label.setText(names);
        slot.label.setPosition(roundedSX + 2, roundedSY - 1);
        slot.label.setVisible(true);
      } else {
        slot.camera.setVisible(false);
        slot.active = false;
        slot.charIds = [];
        slot.label.setVisible(false);
      }
    }
  }

  /** Returns charId to snap to, or null if click wasn't on a viewport. */
  handleClick(px: number, py: number): string | null {
    for (const slot of this.slots) {
      if (!slot.active) continue;
      if (px >= slot.sx && px <= slot.sx + slot.w &&
          py >= slot.sy && py <= slot.sy + slot.h) {
        return slot.charIds[0] ?? null;
      }
    }
    return null;
  }

  destroy() {
    for (const slot of this.slots) {
      this.scene.cameras.remove(slot.camera);
      slot.label.destroy();
    }
    this.borderGfx.destroy();
  }

  /** Ignore any scrollFactor-0 game objects in viewport cameras (idempotent). */
  private syncIgnored() {
    for (const child of this.scene.children.list) {
      if ((child as any).scrollFactorX === 0) {
        for (const slot of this.slots) {
          slot.camera.ignore(child);
        }
      }
    }
  }
}
