// ─── SpritePreview — Canvas 2D sprite sheet animator ──────────────
// Pure DOM / Canvas API component (no Phaser dependency).
// Renders a single horde unit's sprite animation on a <canvas>.

import { HORDE_SPRITE_CONFIGS, ANIM_FRAME_RATES, getEffectiveSpriteConfig } from '../sprites/SpriteConfig';
import type { HordeUnitType } from '@prompt-battle/shared';

export class SpritePreview {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private image: HTMLImageElement | null = null;
  private animState: 'idle' | 'walk' | 'attack' = 'idle';
  private frameIndex = 0;
  private frameCount = 1;
  private frameWidth = 192;
  private frameHeight = 192;
  private frameRate = 8;
  private lastFrameTime = 0;
  private rafId = 0;
  private unitType: HordeUnitType | null = null;
  private currentSkinId: string | undefined;

  constructor(width = 280, height = 280) {
    this.canvas = document.createElement('canvas');
    this.canvas.width = width;
    this.canvas.height = height;
    this.canvas.style.cssText =
      'display:block;image-rendering:pixelated;border-radius:12px;background:rgba(0,0,0,0.3);';
    this.ctx = this.canvas.getContext('2d')!;
    this.ctx.imageSmoothingEnabled = false;
  }

  getElement(): HTMLCanvasElement {
    return this.canvas;
  }

  loadUnit(
    unitType: HordeUnitType,
    state: 'idle' | 'walk' | 'attack' = 'idle',
    skinId?: string,
  ): void {
    this.unitType = unitType;
    this.animState = state;
    this.currentSkinId = skinId;

    const config = skinId
      ? getEffectiveSpriteConfig(unitType, skinId)
      : HORDE_SPRITE_CONFIGS[unitType] || null;
    if (!config) return;

    const sheet = config[state];
    this.frameWidth = sheet.frameWidth;
    this.frameHeight = sheet.frameHeight;
    this.frameCount = sheet.frameCount;
    this.frameRate = ANIM_FRAME_RATES[state] || 8;
    this.frameIndex = 0;

    // Load sprite sheet image
    const img = new Image();
    img.src = sheet.path;
    img.onload = () => {
      this.image = img;
      this.lastFrameTime = performance.now();
      this.startLoop();
    };
    img.onerror = () => {
      // Fallback to default skin if skin asset is missing
      if (skinId) this.loadUnit(unitType, state);
    };
  }

  setState(state: 'idle' | 'walk' | 'attack'): void {
    if (this.unitType) this.loadUnit(this.unitType, state, this.currentSkinId);
  }

  getSkinId(): string | undefined {
    return this.currentSkinId;
  }

  private startLoop(): void {
    if (this.rafId) cancelAnimationFrame(this.rafId);
    const tick = (now: number) => {
      this.rafId = requestAnimationFrame(tick);
      const elapsed = now - this.lastFrameTime;
      const interval = 1000 / this.frameRate;
      if (elapsed >= interval) {
        this.lastFrameTime = now - (elapsed % interval);
        this.frameIndex = (this.frameIndex + 1) % this.frameCount;
        this.drawFrame();
      }
    };
    this.rafId = requestAnimationFrame(tick);
    this.drawFrame(); // draw first frame immediately
  }

  private drawFrame(): void {
    if (!this.image) return;
    const { ctx, canvas, frameWidth, frameHeight, frameIndex } = this;
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Center the sprite in the canvas, scaled to fit ~70% of the smaller dimension
    const maxSize = Math.min(canvas.width, canvas.height) * 0.7;
    const scale = maxSize / Math.max(frameWidth, frameHeight);
    const dw = frameWidth * scale;
    const dh = frameHeight * scale;
    const dx = (canvas.width - dw) / 2;
    const dy = (canvas.height - dh) / 2;

    ctx.drawImage(
      this.image,
      frameIndex * frameWidth,
      0,
      frameWidth,
      frameHeight,
      dx,
      dy,
      dw,
      dh,
    );
  }

  destroy(): void {
    if (this.rafId) cancelAnimationFrame(this.rafId);
    this.rafId = 0;
    this.image = null;
  }
}
