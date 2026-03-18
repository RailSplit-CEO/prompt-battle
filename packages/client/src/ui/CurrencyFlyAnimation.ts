// ─── CurrencyFlyAnimation — Clash Royale-style fly-to-counter ────────
// Spawns ~10 currency icons that burst from a source point, hang briefly,
// then fly along staggered curved paths to the HUD counter. The counter
// ticks up as each icon lands and pulses on impact.

const ICON_COUNT = 10;
const HANG_MS = 150;          // pause after burst so player registers icons
const STAGGER_MS = 40;        // delay between each icon's flight start
const FLIGHT_MS = 500;        // flight duration per icon
const SPREAD = 24;            // random burst spread (px)
const ICON_SIZE = 22;         // emoji font size

export interface CurrencyFlyOptions {
  type: 'crowns' | 'glory';
  amount: number;
  fromX: number;
  fromY: number;
  toElement: HTMLElement;
  onComplete?: () => void;
}

export function playCurrencyFly(opts: CurrencyFlyOptions): void {
  const { type, amount, fromX, fromY, toElement, onComplete } = opts;
  if (amount <= 0) { onComplete?.(); return; }

  const emoji = type === 'crowns' ? '\u{1F451}' : '\u2605';
  const targetRect = toElement.getBoundingClientRect();
  const toX = targetRect.left + targetRect.width / 2;
  const toY = targetRect.top + targetRect.height / 2;

  // Container covers viewport, no pointer events
  const container = document.createElement('div');
  container.style.cssText = `
    position:fixed;inset:0;z-index:9998;pointer-events:none;overflow:hidden;
  `;
  document.body.appendChild(container);

  const perIcon = Math.max(1, Math.round(amount / ICON_COUNT));
  let landed = 0;
  let accumulated = 0;
  const startValue = parseInt(toElement.textContent || '0', 10) || 0;

  for (let i = 0; i < ICON_COUNT; i++) {
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

        // Tick the counter up
        accumulated += perIcon;
        const displayValue = Math.min(startValue + accumulated, startValue + amount);
        toElement.textContent = String(displayValue);

        // Pulse the target element
        pulseElement(toElement);

        // All done
        if (landed >= ICON_COUNT) {
          // Ensure final value is exact
          toElement.textContent = String(startValue + amount);
          container.remove();
          onComplete?.();
        }
      };
    }, flyDelay);
  }
}

/** Quick scale bounce on an element */
function pulseElement(el: HTMLElement): void {
  // Cancel any in-progress pulse
  el.style.transition = 'none';
  el.style.transform = 'scale(1.18)';
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      el.style.transition = 'transform 0.2s cubic-bezier(0.34, 1.56, 0.64, 1)';
      el.style.transform = 'scale(1)';
    });
  });
}
