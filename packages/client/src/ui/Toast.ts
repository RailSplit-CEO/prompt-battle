// ─── Toast Notifications — slide-in toasts from top-right ────────────
// Dark medieval glassmorphism style matching the game's UI theme.

import { C } from './UIColors';

type ToastType = 'success' | 'error' | 'info';

const TOAST_COLORS: Record<ToastType, string> = {
  success: C.teal,
  error: C.red,
  info: C.gold,
};

const TOAST_ICONS: Record<ToastType, string> = {
  success: '\u2713',
  error: '\u2715',
  info: '\u2139',
};

const MAX_VISIBLE = 3;
const AUTO_DISMISS_MS = 3500;
const GAP = 8;
const TOP_OFFSET = 16;

let activeToasts: HTMLDivElement[] = [];
let stylesInjected = false;

function injectToastStyles(): void {
  if (stylesInjected) return;
  stylesInjected = true;
  const style = document.createElement('style');
  style.id = 'toast-styles';
  style.textContent = `
    @keyframes toast-slide-in {
      from { transform: translateX(120%); opacity: 0; }
      to   { transform: translateX(0);    opacity: 1; }
    }
    @keyframes toast-slide-out {
      from { transform: translateX(0);    opacity: 1; }
      to   { transform: translateX(120%); opacity: 0; }
    }
  `;
  document.head.appendChild(style);
}

function repositionToasts(): void {
  let y = TOP_OFFSET;
  for (const toast of activeToasts) {
    toast.style.top = `${y}px`;
    y += toast.offsetHeight + GAP;
  }
}

function removeToast(el: HTMLDivElement): void {
  if (!activeToasts.includes(el)) return;
  el.style.animation = 'toast-slide-out 0.3s ease forwards';
  el.addEventListener('animationend', () => {
    el.remove();
    activeToasts = activeToasts.filter(t => t !== el);
    repositionToasts();
  }, { once: true });
}

export function showToast(message: string, type: ToastType = 'info'): void {
  injectToastStyles();

  // Enforce max visible — dismiss oldest first
  while (activeToasts.length >= MAX_VISIBLE) {
    removeToast(activeToasts[0]);
  }

  const color = TOAST_COLORS[type];
  const icon = TOAST_ICONS[type];

  const toast = document.createElement('div');
  toast.style.cssText = `
    position: fixed;
    right: 16px;
    top: 0px;
    z-index: 99999;
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 10px 16px;
    min-width: 220px;
    max-width: 360px;
    background: ${C.panelBg};
    backdrop-filter: ${C.panelBlur};
    -webkit-backdrop-filter: ${C.panelBlur};
    border: 1px solid ${C.panelBorder};
    border-left: 4px solid ${color};
    border-radius: 8px;
    box-shadow: 0 8px 32px rgba(0,0,0,0.5), 0 0 0 1px rgba(255,217,61,0.04);
    font-family: "Nunito", sans-serif;
    font-size: 13px;
    color: ${C.textPrimary};
    cursor: pointer;
    animation: toast-slide-in 0.3s ease forwards;
    pointer-events: auto;
  `;

  // Icon
  const iconEl = document.createElement('span');
  iconEl.textContent = icon;
  iconEl.style.cssText = `
    font-size: 15px;
    color: ${color};
    flex-shrink: 0;
    width: 18px;
    text-align: center;
    line-height: 1;
  `;
  toast.appendChild(iconEl);

  // Message
  const msgEl = document.createElement('span');
  msgEl.textContent = message;
  msgEl.style.cssText = `
    flex: 1;
    line-height: 1.35;
    word-break: break-word;
  `;
  toast.appendChild(msgEl);

  // Click to dismiss early
  toast.addEventListener('click', () => removeToast(toast));

  // Track and position
  activeToasts.push(toast);
  document.body.appendChild(toast);
  repositionToasts();

  // Auto-dismiss
  setTimeout(() => removeToast(toast), AUTO_DISMISS_MS);
}
