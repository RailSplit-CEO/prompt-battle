// ─── ItchRedeemModal — itch.io reward key redemption ────────────
// Full-screen modal for entering an itch.io key and receiving Crowns.

import { C } from './UIColors';
import { PaymentService } from '../store/PaymentService';
import { CROWN_PACKAGES } from '@prompt-battle/shared';

export interface ItchRedeemOptions {
  onSuccess: (crownsGranted: number) => void;
  onCancel: () => void;
}

export class ItchRedeemModal {
  private overlay: HTMLDivElement | null = null;

  show(opts: ItchRedeemOptions): void {
    // ── Inject keyframes ──────────────────────────────────────────
    if (!document.getElementById('itch-redeem-modal-styles')) {
      const style = document.createElement('style');
      style.id = 'itch-redeem-modal-styles';
      style.textContent = `
        @keyframes itch-panel-in {
          from { opacity:0; transform:scale(0.94) translateY(16px); }
          to   { opacity:1; transform:scale(1)    translateY(0); }
        }
        @keyframes itch-spinner {
          to { transform:rotate(360deg); }
        }
      `;
      document.head.appendChild(style);
    }

    // ── 1. Overlay ────────────────────────────────────────────────
    const overlay = document.createElement('div');
    this.overlay = overlay;
    overlay.style.cssText = `
      position:fixed;inset:0;z-index:9999;
      background:${C.overlay};
      backdrop-filter:${C.panelBlur};-webkit-backdrop-filter:${C.panelBlur};
      display:flex;align-items:center;justify-content:center;
      font-family:'Nunito',sans-serif;
      opacity:0;transition:opacity 0.35s ease;
    `;

    // Close on backdrop click
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) {
        this.close();
        opts.onCancel();
      }
    });

    // Close on ESC
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        document.removeEventListener('keydown', onKey);
        this.close();
        opts.onCancel();
      }
    };
    document.addEventListener('keydown', onKey);

    // ── 2. Panel ──────────────────────────────────────────────────
    const panel = document.createElement('div');
    panel.style.cssText = `
      position:relative;
      width:min(400px, 94vw);
      background:${C.panelBg};
      border:2px solid ${C.panelBorder};
      border-radius:20px;
      padding:36px 32px 28px;
      box-shadow:${C.panelShadow};
      backdrop-filter:${C.panelBlur};-webkit-backdrop-filter:${C.panelBlur};
      display:flex;flex-direction:column;align-items:center;
      animation:itch-panel-in 0.5s ease-out;
    `;

    // Decorative gold line at top
    const topBar = document.createElement('div');
    topBar.style.cssText = `
      position:absolute;top:-1px;left:15%;right:15%;height:3px;
      background:linear-gradient(90deg, transparent, ${C.gold}, transparent);
      border-radius:0 0 4px 4px;
    `;
    panel.appendChild(topBar);

    // ── 3. Header ─────────────────────────────────────────────────
    const header = document.createElement('div');
    header.textContent = 'Redeem itch.io Key';
    header.style.cssText = `
      font-family:'Fredoka',sans-serif;font-size:24px;font-weight:bold;
      color:${C.gold};text-align:center;margin-bottom:12px;
      text-shadow:0 2px 12px rgba(255,217,61,0.2);
    `;
    panel.appendChild(header);

    // ── 4. Description ────────────────────────────────────────────
    const desc = document.createElement('div');
    desc.textContent = 'Enter your itch.io reward key to receive Crowns.';
    desc.style.cssText = `
      font-size:14px;color:${C.textSecondary};text-align:center;
      margin-bottom:20px;line-height:1.5;
      font-family:'Nunito',sans-serif;
    `;
    panel.appendChild(desc);

    // ── 5. Package selector ───────────────────────────────────────
    const selectorLabel = document.createElement('div');
    selectorLabel.textContent = 'Select Package';
    selectorLabel.style.cssText = `
      font-size:12px;color:${C.textSecondary};text-align:left;
      width:100%;margin-bottom:8px;font-weight:600;letter-spacing:0.5px;
    `;
    panel.appendChild(selectorLabel);

    let selectedPackageId = CROWN_PACKAGES[0].id;

    const packageList = document.createElement('div');
    packageList.style.cssText = `
      width:100%;display:flex;flex-direction:column;gap:6px;
      margin-bottom:18px;max-height:180px;overflow-y:auto;
      padding-right:4px;
    `;

    // Custom scrollbar styling for the list
    packageList.style.scrollbarWidth = 'thin';
    packageList.style.scrollbarColor = `${C.textMuted} transparent`;

    const packageRows: HTMLDivElement[] = [];

    for (const pkg of CROWN_PACKAGES) {
      const row = document.createElement('div');
      row.style.cssText = `
        display:flex;align-items:center;justify-content:space-between;
        padding:10px 14px;border-radius:10px;cursor:pointer;
        background:${pkg.id === selectedPackageId ? C.surfaceActive : C.surface};
        border:2px solid ${pkg.id === selectedPackageId ? C.goldDim : 'transparent'};
        transition:background 0.15s, border-color 0.15s;
      `;

      const left = document.createElement('div');
      left.style.cssText = 'display:flex;align-items:center;gap:10px;';

      const icon = document.createElement('span');
      icon.textContent = pkg.icon;
      icon.style.cssText = 'font-size:20px;';
      left.appendChild(icon);

      const info = document.createElement('div');
      const nameEl = document.createElement('div');
      nameEl.textContent = pkg.name;
      nameEl.style.cssText = `
        font-size:14px;color:${C.textPrimary};font-weight:600;
      `;
      info.appendChild(nameEl);

      const crownsEl = document.createElement('div');
      crownsEl.textContent = `${pkg.crowns.toLocaleString()} Crowns`;
      crownsEl.style.cssText = `
        font-size:11px;color:${C.textMuted};
      `;
      info.appendChild(crownsEl);
      left.appendChild(info);

      const priceEl = document.createElement('div');
      priceEl.textContent = `$${pkg.priceUSD.toFixed(2)}`;
      priceEl.style.cssText = `
        font-size:13px;color:${C.textSecondary};font-weight:600;
        flex-shrink:0;margin-left:8px;
      `;

      row.appendChild(left);
      row.appendChild(priceEl);
      packageRows.push(row);

      row.onmouseenter = () => {
        if (selectedPackageId !== pkg.id) {
          row.style.background = C.surfaceHover;
        }
      };
      row.onmouseleave = () => {
        if (selectedPackageId !== pkg.id) {
          row.style.background = C.surface;
        }
      };

      row.onclick = () => {
        selectedPackageId = pkg.id;
        // Update all rows
        for (let i = 0; i < CROWN_PACKAGES.length; i++) {
          const isSelected = CROWN_PACKAGES[i].id === selectedPackageId;
          packageRows[i].style.background = isSelected ? C.surfaceActive : C.surface;
          packageRows[i].style.borderColor = isSelected ? C.goldDim : 'transparent';
        }
      };

      packageList.appendChild(row);
    }

    panel.appendChild(packageList);

    // ── 6. Key input ──────────────────────────────────────────────
    const keyInput = document.createElement('input');
    keyInput.type = 'text';
    keyInput.placeholder = 'Enter reward key...';
    keyInput.autocomplete = 'off';
    keyInput.spellcheck = false;
    keyInput.style.cssText = `
      width:100%;padding:10px 14px;border-radius:8px;
      background:${C.inputBg};
      border:2px solid ${C.inputBorder};
      color:${C.textPrimary};
      font-family:'Nunito',sans-serif;font-size:15px;
      outline:none;transition:border-color 0.2s;
      box-sizing:border-box;
    `;
    keyInput.onfocus = () => { keyInput.style.borderColor = C.gold; };
    keyInput.onblur = () => { keyInput.style.borderColor = C.inputBorder; };
    panel.appendChild(keyInput);

    // ── Error / Success message area ──────────────────────────────
    const msgEl = document.createElement('div');
    msgEl.style.cssText = `
      font-size:13px;text-align:center;
      min-height:20px;margin:10px 0;
      opacity:0;transition:opacity 0.3s;
      width:100%;
    `;
    panel.appendChild(msgEl);

    // ── 7. Redeem button ──────────────────────────────────────────
    const redeemBtn = document.createElement('button');
    redeemBtn.textContent = 'Redeem';
    redeemBtn.style.cssText = `
      width:100%;padding:12px;border:none;border-radius:10px;
      background:${C.gold};color:#1a1a0a;
      font-family:'Fredoka',sans-serif;font-size:16px;font-weight:bold;
      cursor:pointer;transition:filter 0.15s, transform 0.1s;
      position:relative;
    `;
    redeemBtn.onmouseenter = () => { redeemBtn.style.filter = 'brightness(1.12)'; };
    redeemBtn.onmouseleave = () => { redeemBtn.style.filter = 'brightness(1)'; };
    redeemBtn.onmousedown = () => { redeemBtn.style.transform = 'scale(0.97)'; };
    redeemBtn.onmouseup = () => { redeemBtn.style.transform = 'scale(1)'; };

    redeemBtn.onclick = async () => {
      const rawKey = keyInput.value.trim();
      if (!rawKey) {
        msgEl.textContent = 'Please enter a reward key.';
        msgEl.style.color = C.red;
        msgEl.style.opacity = '1';
        return;
      }

      // Reset message
      msgEl.style.opacity = '0';

      // Show spinner state
      const origText = redeemBtn.textContent;
      redeemBtn.innerHTML = `
        <span style="
          display:inline-block;width:18px;height:18px;
          border:3px solid rgba(26,26,10,0.3);border-top-color:#1a1a0a;
          border-radius:50%;animation:itch-spinner 0.6s linear infinite;
          vertical-align:middle;margin-right:8px;
        "></span>Redeeming...
      `;
      redeemBtn.style.opacity = '0.7';
      redeemBtn.style.pointerEvents = 'none';
      keyInput.style.pointerEvents = 'none';

      try {
        const result = await PaymentService.getInstance().redeemItchKey(rawKey, selectedPackageId);
        if (!result.success) {
          throw new Error(result.error || 'Redemption failed.');
        }
        const crownsGranted = result.crownsGranted ?? 0;

        // Show success
        msgEl.innerHTML = `&#10003; ${crownsGranted.toLocaleString()} Crowns added!`;
        msgEl.style.color = C.teal;
        msgEl.style.opacity = '1';
        redeemBtn.textContent = 'Done!';
        redeemBtn.style.opacity = '1';

        // Close after 2s and notify
        setTimeout(() => {
          this.close();
          opts.onSuccess(crownsGranted);
        }, 2000);
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : 'Redemption failed. Please try again.';
        msgEl.textContent = errMsg;
        msgEl.style.color = C.red;
        msgEl.style.opacity = '1';
        redeemBtn.textContent = origText;
        redeemBtn.style.opacity = '1';
        redeemBtn.style.pointerEvents = 'auto';
        keyInput.style.pointerEvents = 'auto';
      }
    };

    panel.appendChild(redeemBtn);

    // ── 8. "Buy Crowns on itch.io" link ───────────────────────────
    const itchLink = document.createElement('div');
    itchLink.textContent = 'Buy Crowns on itch.io';
    itchLink.style.cssText = `
      color:${C.teal};font-size:13px;cursor:pointer;
      text-align:center;margin-top:16px;
      transition:filter 0.2s;text-decoration:underline;
      text-decoration-color:rgba(69,230,176,0.4);
      text-underline-offset:3px;
    `;
    itchLink.onmouseenter = () => { itchLink.style.filter = 'brightness(1.25)'; };
    itchLink.onmouseleave = () => { itchLink.style.filter = 'brightness(1)'; };
    itchLink.onclick = () => {
      window.open('https://your-game.itch.io/mark-my-hordes', '_blank');
    };
    panel.appendChild(itchLink);

    // ── 9. Cancel link ────────────────────────────────────────────
    const cancelLink = document.createElement('div');
    cancelLink.textContent = 'Cancel';
    cancelLink.style.cssText = `
      color:${C.textMuted};font-size:13px;cursor:pointer;
      text-align:center;margin-top:14px;
      transition:color 0.2s;
    `;
    cancelLink.onmouseenter = () => { cancelLink.style.color = C.textSecondary; };
    cancelLink.onmouseleave = () => { cancelLink.style.color = C.textMuted; };
    cancelLink.onclick = () => {
      this.close();
      opts.onCancel();
    };
    panel.appendChild(cancelLink);

    // ── Mount & fade in ───────────────────────────────────────────
    overlay.appendChild(panel);
    document.body.appendChild(overlay);

    requestAnimationFrame(() => {
      requestAnimationFrame(() => { overlay.style.opacity = '1'; });
    });

    // Focus the key input after animation settles
    setTimeout(() => keyInput.focus(), 400);
  }

  close(): void {
    if (this.overlay) {
      this.overlay.style.opacity = '0';
      const el = this.overlay;
      setTimeout(() => { el.remove(); }, 250);
      this.overlay = null;
    }
  }
}
