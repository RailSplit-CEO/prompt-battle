// ─── Skeleton Loading Utilities — shimmer placeholders for async UI ──
// Dark medieval theme matching the game's glassmorphism style.

import { C } from './UIColors';

// ─── Inject shimmer CSS keyframes (call once) ───────────────────────
export function injectSkeletonStyles(): void {
  if (document.getElementById('skeleton-styles')) return;
  const style = document.createElement('style');
  style.id = 'skeleton-styles';
  style.textContent = `
    @keyframes skeleton-shimmer {
      0%   { background-position: -200% 0; }
      100% { background-position: 200% 0; }
    }
    .skeleton-line {
      background: linear-gradient(90deg, ${C.surface} 25%, ${C.surfaceHover} 50%, ${C.surface} 75%);
      background-size: 200% 100%;
      animation: skeleton-shimmer 1.5s ease-in-out infinite;
      border-radius: 4px;
    }
    .skeleton-circle {
      background: linear-gradient(90deg, ${C.surface} 25%, ${C.surfaceHover} 50%, ${C.surface} 75%);
      background-size: 200% 100%;
      animation: skeleton-shimmer 1.5s ease-in-out infinite;
      border-radius: 50%;
    }
    .skeleton-row {
      display: flex;
      align-items: center;
      gap: 12px;
      padding: 10px 14px;
      border-bottom: 1px solid ${C.divider};
    }
  `;
  document.head.appendChild(style);
}

// ─── Create a single skeleton row (friend list, match history, etc.) ─
export function createSkeletonRow(): HTMLDivElement {
  injectSkeletonStyles();

  const row = document.createElement('div');
  row.className = 'skeleton-row';

  // Circle avatar placeholder (40px)
  const circle = document.createElement('div');
  circle.className = 'skeleton-circle';
  circle.style.cssText = 'width:40px;height:40px;flex-shrink:0;';
  row.appendChild(circle);

  // Text lines container
  const lines = document.createElement('div');
  lines.style.cssText = 'display:flex;flex-direction:column;gap:6px;flex:1;';

  // Name line (120px wide)
  const nameLine = document.createElement('div');
  nameLine.className = 'skeleton-line';
  nameLine.style.cssText = 'width:120px;height:12px;';
  lines.appendChild(nameLine);

  // Status line (80px wide)
  const statusLine = document.createElement('div');
  statusLine.className = 'skeleton-line';
  statusLine.style.cssText = 'width:80px;height:10px;';
  lines.appendChild(statusLine);

  row.appendChild(lines);
  return row;
}

// ─── Create multiple skeleton rows ──────────────────────────────────
export function createSkeletonList(count: number): HTMLDivElement {
  const container = document.createElement('div');
  for (let i = 0; i < count; i++) {
    container.appendChild(createSkeletonRow());
  }
  return container;
}

// ─── Create a skeleton card (inventory grid items, etc.) ────────────
export function createSkeletonCard(width: number, height: number): HTMLDivElement {
  injectSkeletonStyles();

  const card = document.createElement('div');
  card.className = 'skeleton-line';
  card.style.cssText = `
    width: ${width}px;
    height: ${height}px;
    border-radius: 8px;
    flex-shrink: 0;
  `;
  return card;
}

// ─── Stagger animation — animate list children in sequentially ──────
export function staggerIn(container: HTMLElement, delayPerItem: number = 50): void {
  const children = container.children;
  for (let i = 0; i < children.length; i++) {
    const el = children[i] as HTMLElement;
    el.style.opacity = '0';
    el.style.transform = 'translateY(8px)';
    el.style.transition = `opacity 0.3s ease ${i * delayPerItem}ms, transform 0.3s ease ${i * delayPerItem}ms`;
    requestAnimationFrame(() => {
      el.style.opacity = '1';
      el.style.transform = 'translateY(0)';
    });
  }
}
