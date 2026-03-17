// ─── PurchaseConfirmModal — "Are you sure?" dialog ──────────────
// Follows the same glassmorphism pattern as SettingsPanel.
// Creates a fixed overlay with a small confirmation panel.

import { C } from './UIColors';

export interface PurchaseConfirmOptions {
  itemName: string;
  priceCrowns?: number;
  priceGlory?: number;
  onConfirm: () => void;
  onCancel: () => void;
}

export function showPurchaseConfirm(opts: PurchaseConfirmOptions): void {
  let root: HTMLDivElement | null = null;
  let escHandler: ((e: KeyboardEvent) => void) | null = null;

  const cleanup = () => {
    if (escHandler) {
      window.removeEventListener('keydown', escHandler);
      escHandler = null;
    }
    if (root) {
      root.style.opacity = '0';
      const panel = root.querySelector('[data-confirm-panel]') as HTMLElement | null;
      if (panel) panel.style.transform = 'scale(0.95)';
      const r = root;
      setTimeout(() => r.remove(), 200);
      root = null;
    }
  };

  const doCancel = () => {
    cleanup();
    opts.onCancel();
  };

  const doConfirm = () => {
    cleanup();
    opts.onConfirm();
  };

  // ── Overlay ──
  root = document.createElement('div');
  root.style.cssText = `
    position:fixed;inset:0;z-index:10001;
    background:${C.overlay};backdrop-filter:${C.panelBlur};-webkit-backdrop-filter:${C.panelBlur};
    display:flex;align-items:center;justify-content:center;
    opacity:0;transition:opacity 0.2s ease;
  `;

  root.addEventListener('mousedown', (e) => {
    if (e.target === root) doCancel();
  });

  // ── Panel ──
  const panel = document.createElement('div');
  panel.setAttribute('data-confirm-panel', '');
  panel.style.cssText = `
    width:min(380px,88vw);
    background:${C.panelBg};
    border:2px solid ${C.panelBorder};border-radius:16px;
    padding:28px 24px 22px;box-shadow:${C.panelShadow};
    display:flex;flex-direction:column;align-items:center;gap:16px;
    transform:scale(0.92);transition:transform 0.25s cubic-bezier(0.16,1,0.3,1);
    font-family:"Nunito",sans-serif;text-align:center;
  `;
  root.appendChild(panel);

  // ── Title ──
  const title = document.createElement('h3');
  title.textContent = 'Confirm Purchase';
  title.style.cssText = `
    margin:0;font-size:18px;font-family:"Fredoka",sans-serif;font-weight:700;
    color:${C.gold};letter-spacing:2px;
  `;
  panel.appendChild(title);

  // ── Item name ──
  const itemLine = document.createElement('div');
  itemLine.style.cssText = `
    font-size:15px;font-weight:700;color:${C.textPrimary};
    padding:4px 0;
  `;
  itemLine.textContent = opts.itemName;
  panel.appendChild(itemLine);

  // ── Price line ──
  const priceLine = document.createElement('div');
  priceLine.style.cssText = `
    font-size:14px;color:${C.textSecondary};
    display:flex;align-items:center;gap:6px;justify-content:center;
  `;

  if (opts.priceCrowns != null && opts.priceCrowns > 0) {
    const crownsSpan = document.createElement('span');
    crownsSpan.style.cssText = `color:${C.gold};font-weight:700;`;
    crownsSpan.textContent = `\u{1F451} ${opts.priceCrowns}`;
    priceLine.appendChild(document.createTextNode('This will cost '));
    priceLine.appendChild(crownsSpan);
  } else if (opts.priceGlory != null && opts.priceGlory > 0) {
    const glorySpan = document.createElement('span');
    glorySpan.style.cssText = `color:${C.teal};font-weight:700;`;
    glorySpan.textContent = `\u2B50 ${opts.priceGlory}`;
    priceLine.appendChild(document.createTextNode('This will cost '));
    priceLine.appendChild(glorySpan);
  }
  panel.appendChild(priceLine);

  // ── Divider ──
  const divider = document.createElement('div');
  divider.style.cssText = `
    width:100%;height:1px;background:${C.divider};margin:4px 0;
  `;
  panel.appendChild(divider);

  // ── Buttons ──
  const btnRow = document.createElement('div');
  btnRow.style.cssText = 'display:flex;gap:12px;width:100%;';

  // Cancel
  const cancelBtn = document.createElement('button');
  cancelBtn.textContent = 'Cancel';
  cancelBtn.style.cssText = `
    flex:1;padding:10px 0;border-radius:10px;font-size:13px;font-weight:700;
    font-family:"Nunito",sans-serif;cursor:pointer;transition:all 0.15s;
    background:${C.inputBg};border:1px solid ${C.inputBorder};color:${C.textSecondary};
  `;
  cancelBtn.onmouseenter = () => {
    cancelBtn.style.borderColor = C.inputBorderHi;
    cancelBtn.style.color = C.textPrimary;
    cancelBtn.style.background = C.surfaceHover;
  };
  cancelBtn.onmouseleave = () => {
    cancelBtn.style.borderColor = C.inputBorder;
    cancelBtn.style.color = C.textSecondary;
    cancelBtn.style.background = C.inputBg;
  };
  cancelBtn.onclick = doCancel;
  btnRow.appendChild(cancelBtn);

  // Confirm
  const confirmBtn = document.createElement('button');
  confirmBtn.textContent = 'Confirm';
  confirmBtn.style.cssText = `
    flex:1;padding:10px 0;border-radius:10px;font-size:13px;font-weight:700;
    font-family:"Fredoka",sans-serif;cursor:pointer;transition:all 0.15s;
    background:${C.gold};border:none;color:${C.textDark};
    box-shadow:0 2px 8px rgba(255,217,61,0.25);
  `;
  confirmBtn.onmouseenter = () => {
    confirmBtn.style.background = C.goldDark;
  };
  confirmBtn.onmouseleave = () => {
    confirmBtn.style.background = C.gold;
  };
  confirmBtn.onclick = doConfirm;
  btnRow.appendChild(confirmBtn);

  panel.appendChild(btnRow);

  // ── Hint ──
  const hint = document.createElement('div');
  hint.textContent = 'ESC to cancel';
  hint.style.cssText = `
    font-size:10px;color:${C.textMuted};letter-spacing:0.5px;margin-top:2px;
  `;
  panel.appendChild(hint);

  // ── ESC handler ──
  escHandler = (e: KeyboardEvent) => {
    if (e.key === 'Escape') doCancel();
  };
  window.addEventListener('keydown', escHandler);

  // ── Mount and animate in ──
  document.body.appendChild(root);

  requestAnimationFrame(() => {
    if (root) root.style.opacity = '1';
    panel.style.transform = 'scale(1)';
  });
}
