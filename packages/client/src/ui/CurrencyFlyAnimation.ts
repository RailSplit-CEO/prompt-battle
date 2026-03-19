// ─── CurrencyFlyAnimation — Clash Royale-style fly-to-counter ────────
// Spawns currency icons that burst from a source point, hang briefly,
// then fly along staggered curved paths to the HUD counter. The counter
// is frozen during the animation — external listeners should check
// isFrozen() before updating the element. Icons tick the counter up as
// they land, and the final value is applied when the animation finishes.
// Queued: only one animation plays at a time to prevent DOM thrashing.

const ICON_COUNT = 10;
const ICON_COUNT_QUEUED = 6; // fewer icons when animations are queued up
const HANG_MS = 150;          // pause after burst so player registers icons
const STAGGER_MS = 40;        // delay between each icon's flight start
const FLIGHT_MS = 500;        // flight duration per icon
const SPREAD = 24;            // random burst spread (px)
const ICON_SIZE = 22;         // emoji font size
const SAFETY_TIMEOUT = 2000;  // force-cleanup if animation gets stuck

export interface CurrencyFlyOptions {
  type: 'crowns' | 'glory';
  amount: number;
  fromX: number;
  fromY: number;
  toElement: HTMLElement;
  onComplete?: () => void;
}

// ── Frozen elements — external updaters should skip these ────────
const frozenElements = new Set<HTMLElement>();
/** Pending final value to apply when animation ends */
const pendingValues = new Map<HTMLElement, string>();

/** Check if an element is currently being animated — callers should skip updating it */
export function isCurrencyFlyTarget(el: HTMLElement): boolean {
  return frozenElements.has(el);
}

/** Store a pending update for a frozen element — applied when animation ends */
export function setPendingCurrencyValue(el: HTMLElement, value: string): void {
  if (frozenElements.has(el)) {
    pendingValues.set(el, value);
  }
}

/** Pre-freeze an element before an API call so Firebase listeners don't update it */
export function prefreezeElement(el: HTMLElement): void {
  frozenElements.add(el);
}

/** Unfreeze an element that was pre-frozen but never animated (e.g. non-currency reward) */
export function unfreezeElement(el: HTMLElement): void {
  unfreeze(el);
}

// ── Global animation queue ──────────────────────────────────────
let isAnimating = false;
const queue: CurrencyFlyOptions[] = [];

export function playCurrencyFly(opts: CurrencyFlyOptions): void {
  if (opts.amount <= 0) { opts.onComplete?.(); return; }

  if (isAnimating) {
    queue.push(opts);
    return;
  }

  runAnimation(opts);
}

function processQueue(): void {
  isAnimating = false;
  if (queue.length > 0) {
    runAnimation(queue.shift()!);
  }
}

function runAnimation(opts: CurrencyFlyOptions): void {
  isAnimating = true;
  const { type, amount, fromX, fromY, toElement, onComplete } = opts;

  const iconCount = queue.length > 0 ? ICON_COUNT_QUEUED : ICON_COUNT;
  const emoji = type === 'crowns' ? '\u{1F451}' : '\u2605';
  const targetRect = toElement.getBoundingClientRect();
  const toX = targetRect.left + targetRect.width / 2;
  const toY = targetRect.top + targetRect.height / 2;

  // Freeze the element — external listeners will defer updates
  frozenElements.add(toElement);

  // Snapshot current value and prefix
  const rawText = toElement.textContent || '0';
  const startValue = parseInt(rawText.replace(/[^\d]/g, ''), 10) || 0;
  const prefix = rawText.replace(/[\d,]+.*$/, '');

  // Container covers viewport, no pointer events
  const container = document.createElement('div');
  container.style.cssText = `
    position:fixed;inset:0;z-index:9998;pointer-events:none;overflow:hidden;
  `;
  document.body.appendChild(container);

  const perIcon = Math.max(1, Math.round(amount / iconCount));
  let landed = 0;
  let accumulated = 0;

  // Safety timeout — force cleanup if animations get stuck
  const safetyTimer = setTimeout(() => {
    container.remove();
    unfreeze(toElement);
    onComplete?.();
    processQueue();
  }, SAFETY_TIMEOUT);

  function finish(): void {
    clearTimeout(safetyTimer);
    container.remove();
    // Apply final ticked value, then unfreeze so pending Firebase value can land
    toElement.textContent = `${prefix}${(startValue + amount).toLocaleString()}`;
    unfreeze(toElement);
    onComplete?.();
    processQueue();
  }

  for (let i = 0; i < iconCount; i++) {
    const icon = document.createElement('span');
    icon.textContent = emoji;
    // Random burst offset
    const ox = (Math.random() - 0.5) * SPREAD * 2;
    const oy = (Math.random() - 0.5) * SPREAD * 2;
    const startX = fromX + ox - ICON_SIZE / 2;
    const startY = fromY + oy - ICON_SIZE / 2;

    icon.style.cssText = `
      position:fixed;
      left:${startX}px;top:${startY}px;
      font-size:${ICON_SIZE}px;line-height:1;
      opacity:0;
      transform:scale(0);
      transition:none;
      pointer-events:none;
      z-index:9999;
      filter:drop-shadow(0 0 4px ${type === 'crowns' ? 'rgba(255,217,61,0.6)' : 'rgba(192,192,210,0.6)'});
    `;
    container.appendChild(icon);

    // Phase 1: burst in (scale up + fade in)
    requestAnimationFrame(() => {
      icon.style.transition = 'opacity 0.1s ease-out, transform 0.15s ease-out';
      icon.style.opacity = '1';
      icon.style.transform = 'scale(1.1)';
    });

    // Phase 2: fly to target after hang + stagger
    const flyDelay = HANG_MS + i * STAGGER_MS;
    setTimeout(() => {
      // Compute a curved control point offset for variety
      const cpOffsetX = (Math.random() - 0.5) * 120;
      const cpOffsetY = -40 - Math.random() * 80; // arc upward
      const midX = (startX + toX) / 2 + cpOffsetX;
      const midY = (startY + toY) / 2 + cpOffsetY;

      // Use Web Animations API for bezier-like motion via keyframes
      const anim = icon.animate(
        [
          {
            left: `${startX}px`,
            top: `${startY}px`,
            opacity: '1',
            transform: 'scale(1.1)',
            offset: 0,
          },
          {
            left: `${midX}px`,
            top: `${midY}px`,
            opacity: '1',
            transform: 'scale(0.9)',
            offset: 0.5,
          },
          {
            left: `${toX - ICON_SIZE / 2}px`,
            top: `${toY - ICON_SIZE / 2}px`,
            opacity: '0.4',
            transform: 'scale(0.3)',
            offset: 1,
          },
        ],
        {
          duration: FLIGHT_MS,
          easing: 'cubic-bezier(0.4, 0, 0.8, 1)',
          fill: 'forwards',
        },
      );

      anim.onfinish = () => {
        icon.remove();
        landed++;

        // Tick the counter up as each icon lands
        accumulated += perIcon;
        const displayValue = Math.min(startValue + accumulated, startValue + amount);
        toElement.textContent = `${prefix}${displayValue.toLocaleString()}`;

        // Pulse the target element on each landing
        pulseElement(toElement);

        // All done
        if (landed >= iconCount) {
          finish();
        }
      };
    }, flyDelay);
  }
}

/** Unfreeze an element and apply any pending value from Firebase */
function unfreeze(el: HTMLElement): void {
  frozenElements.delete(el);
  const pending = pendingValues.get(el);
  if (pending) {
    pendingValues.delete(el);
    el.textContent = pending;
  }
}

/** Quick scale bounce on an element */
function pulseElement(el: HTMLElement): void {
  el.style.transition = 'none';
  el.style.transform = 'scale(1.18)';
  requestAnimationFrame(() => {
    el.style.transition = 'transform 0.2s cubic-bezier(0.34, 1.56, 0.64, 1)';
    el.style.transform = 'scale(1)';
  });
}
