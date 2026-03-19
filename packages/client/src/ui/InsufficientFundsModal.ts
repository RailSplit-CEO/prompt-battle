// ─── InsufficientFundsModal — "Not enough crowns/glory" popup ────
// Shows when a purchase fails due to insufficient currency.
// For crowns: displays 3 cheapest crown packages to buy.
// For glory: explains how to earn glory.

import { C } from './UIColors';
import { CROWN_PACKAGES } from '@prompt-battle/shared';
import { PaymentService } from '../store/PaymentService';
import { PaymentModal } from './PaymentModal';

export function showInsufficientFunds(currency: 'crowns' | 'glory'): void {
  let root: HTMLDivElement | null = null;
  let escHandler: ((e: KeyboardEvent) => void) | null = null;

  const cleanup = () => {
    if (escHandler) {
      window.removeEventListener('keydown', escHandler);
      escHandler = null;
    }
    if (root) {
      root.style.opacity = '0';
      const panel = root.querySelector('[data-funds-panel]') as HTMLElement | null;
      if (panel) panel.style.transform = 'scale(0.95)';
      const r = root;
      setTimeout(() => r.remove(), 200);
      root = null;
    }
  };

  // ── Overlay ──
  root = document.createElement('div');
  root.style.cssText = `
    position:fixed;inset:0;z-index:10002;
    background:${C.overlay};backdrop-filter:${C.panelBlur};-webkit-backdrop-filter:${C.panelBlur};
    display:flex;align-items:center;justify-content:center;
    opacity:0;transition:opacity 0.2s ease;
  `;
  root.addEventListener('mousedown', (e) => {
    if (e.target === root) cleanup();
  });

  // ── Panel ──
  const panel = document.createElement('div');
  panel.setAttribute('data-funds-panel', '');
  panel.style.cssText = `
    width:min(560px,92vw);
    background:${C.panelBg};
    border:2px solid ${C.panelBorder};border-radius:16px;
    padding:28px 24px 22px;box-shadow:${C.panelShadow};
    display:flex;flex-direction:column;align-items:center;gap:14px;
    transform:scale(0.92);transition:transform 0.25s cubic-bezier(0.16,1,0.3,1);
    font-family:"Nunito",sans-serif;text-align:center;
  `;
  root.appendChild(panel);

  // ── Icon ──
  const icon = document.createElement('div');
  icon.textContent = currency === 'crowns' ? '\u{1F451}' : '\u2605';
  icon.style.cssText = 'font-size:36px;line-height:1;';
  panel.appendChild(icon);

  // ── Title ──
  const title = document.createElement('h3');
  title.textContent = currency === 'crowns' ? 'Not Enough Crowns!' : 'Not Enough Glory!';
  title.style.cssText = `
    margin:0;font-size:18px;font-family:"Fredoka",sans-serif;font-weight:700;
    color:${C.red};letter-spacing:1px;
  `;
  panel.appendChild(title);

  if (currency === 'crowns') {
    // ── Subtitle ──
    const subtitle = document.createElement('div');
    subtitle.textContent = 'Get more crowns to complete your purchase:';
    subtitle.style.cssText = `font-size:13px;color:${C.textSecondary};margin-bottom:4px;`;
    panel.appendChild(subtitle);

    // ── 4 cheapest crown packages ──
    const packages = CROWN_PACKAGES.slice(0, 4);
    const pkgRow = document.createElement('div');
    pkgRow.style.cssText = 'display:flex;gap:10px;width:100%;';

    for (const pkg of packages) {
      const card = document.createElement('button');
      card.style.cssText = `
        flex:1;display:flex;flex-direction:column;align-items:center;gap:6px;
        padding:12px 10px 12px;border-radius:12px;cursor:pointer;
        background:${C.surface};border:2px solid ${C.goldDim};
        transition:all 0.15s ease;position:relative;
      `;
      card.onmouseenter = () => {
        card.style.background = C.surfaceActive;
        card.style.transform = 'translateY(-2px)';
        card.style.borderColor = C.gold;
        card.style.boxShadow = '0 4px 12px rgba(255,217,61,0.2)';
      };
      card.onmouseleave = () => {
        card.style.background = C.surface;
        card.style.transform = 'translateY(0)';
        card.style.borderColor = C.goldDim;
        card.style.boxShadow = 'none';
      };

      // Bonus badge — positioned tag on top-right, matching shop style
      if (pkg.bonusPercent > 0) {
        const bonusBadge = document.createElement('div');
        bonusBadge.textContent = `+${pkg.bonusPercent}% BONUS`;
        bonusBadge.style.cssText = `
          position:absolute;top:-8px;right:-6px;
          font-size:9px;font-weight:700;font-family:"Fredoka",sans-serif;
          color:${C.textDark};background:${C.teal};
          padding:2px 8px;border-radius:6px;letter-spacing:0.5px;
          box-shadow:0 2px 6px rgba(69,230,176,0.3);
          transform:rotate(4deg);
        `;
        card.appendChild(bonusBadge);
      }

      // Package icon
      const pkgIcon = document.createElement('div');
      pkgIcon.textContent = pkg.icon;
      pkgIcon.style.cssText = 'font-size:32px;line-height:1;';
      card.appendChild(pkgIcon);

      // Package name
      const pkgName = document.createElement('div');
      pkgName.textContent = pkg.name;
      pkgName.style.cssText = `
        font-size:11px;font-weight:700;color:${C.textPrimary};
        font-family:"Nunito",sans-serif;text-align:center;
        overflow:hidden;text-overflow:ellipsis;white-space:nowrap;
        width:100%;
      `;
      card.appendChild(pkgName);

      // Crown amount
      const crownsLabel = document.createElement('div');
      crownsLabel.style.cssText = `font-size:14px;font-weight:700;color:${C.gold};font-family:"Fredoka",sans-serif;`;
      crownsLabel.textContent = `${pkg.crowns.toLocaleString()} Crowns`;
      card.appendChild(crownsLabel);

      // Price
      const price = document.createElement('div');
      price.textContent = `$${Math.round(pkg.priceUSD)}`;
      price.style.cssText = `
        font-size:12px;font-weight:700;color:${C.textSecondary};
        font-family:"Nunito",sans-serif;
      `;
      card.appendChild(price);

      card.onclick = async () => {
        cleanup();
        // Trigger Square payment flow
        const platform = PaymentService.getInstance().getPlatform();
        if (platform === 'test') {
          (window as any).__devAddCrowns?.(pkg.crowns);
        } else {
          try {
            const order = await PaymentService.getInstance().createOrder(pkg.id);
            const payModal = new PaymentModal();
            payModal.show({
              packageName: pkg.name,
              crowns: order.crowns,
              amountUSD: pkg.priceUSD,
              orderId: order.orderId,
              onSuccess: async (sourceId: string) => {
                payModal.close();
                await PaymentService.getInstance().completePayment(order.orderId, sourceId, pkg.id);
              },
              onCancel: () => payModal.close(),
              onError: (err) => { payModal.close(); alert(err); },
            });
          } catch (err: any) {
            alert(err.message || 'Failed to start payment');
          }
        }
      };

      pkgRow.appendChild(card);
    }
    panel.appendChild(pkgRow);
  } else {
    // ── Glory: show ways to earn (same card style as crowns) ──
    const subtitle = document.createElement('div');
    subtitle.textContent = 'Earn more glory to complete your purchase:';
    subtitle.style.cssText = `font-size:13px;color:${C.textSecondary};margin-bottom:4px;`;
    panel.appendChild(subtitle);

    const gloryOptions = [
      { icon: '\uD83C\uDFC6', name: 'Battle Pass', desc: 'Claim glory rewards', amount: 'Up to 5,000' },
      { icon: '\u2694\uFE0F', name: 'Win Matches', desc: 'PvP victories', amount: '50-200' },
      { icon: '\uD83C\uDFAF', name: 'Challenges', desc: 'Complete daily tasks', amount: '25-100' },
      { icon: '\uD83D\uDD25', name: 'Win Streak', desc: 'Consecutive wins', amount: '2x bonus' },
    ];

    const gloryRow = document.createElement('div');
    gloryRow.style.cssText = 'display:flex;gap:10px;width:100%;';

    for (const opt of gloryOptions) {
      const card = document.createElement('button');
      card.style.cssText = `
        flex:1;display:flex;flex-direction:column;align-items:center;gap:6px;
        padding:12px 10px 12px;border-radius:12px;cursor:pointer;
        background:${C.surface};border:2px solid rgba(192,192,210,0.35);
        transition:all 0.15s ease;position:relative;
      `;
      card.onmouseenter = () => {
        card.style.background = 'rgba(192,192,210,0.08)';
        card.style.transform = 'translateY(-2px)';
        card.style.borderColor = 'rgba(192,192,210,0.6)';
        card.style.boxShadow = '0 4px 12px rgba(192,192,210,0.2)';
      };
      card.onmouseleave = () => {
        card.style.background = C.surface;
        card.style.transform = 'translateY(0)';
        card.style.borderColor = 'rgba(192,192,210,0.35)';
        card.style.boxShadow = 'none';
      };

      // Icon
      const optIcon = document.createElement('div');
      optIcon.textContent = opt.icon;
      optIcon.style.cssText = 'font-size:32px;line-height:1;';
      card.appendChild(optIcon);

      // Name
      const optName = document.createElement('div');
      optName.textContent = opt.name;
      optName.style.cssText = `
        font-size:11px;font-weight:700;color:${C.textPrimary};
        font-family:"Nunito",sans-serif;text-align:center;
        overflow:hidden;text-overflow:ellipsis;white-space:nowrap;
        width:100%;
      `;
      card.appendChild(optName);

      // Description
      const optDesc = document.createElement('div');
      optDesc.textContent = opt.desc;
      optDesc.style.cssText = `
        font-size:9px;font-weight:700;color:${C.textMuted};
        font-family:"Nunito",sans-serif;text-align:center;
      `;
      card.appendChild(optDesc);

      // Glory amount
      const optAmount = document.createElement('div');
      optAmount.textContent = `\u2605 ${opt.amount}`;
      optAmount.style.cssText = `
        font-size:14px;font-weight:700;color:#C0C0D2;
        font-family:"Fredoka",sans-serif;
      `;
      card.appendChild(optAmount);

      // Action label
      const actionLabel = document.createElement('div');
      actionLabel.textContent = 'EARN';
      actionLabel.style.cssText = `
        font-size:12px;font-weight:700;color:${C.textSecondary};
        font-family:"Nunito",sans-serif;
      `;
      card.appendChild(actionLabel);

      card.onclick = () => {
        cleanup();
      };

      gloryRow.appendChild(card);
    }
    panel.appendChild(gloryRow);
  }

  // ── Divider ──
  const divider = document.createElement('div');
  divider.style.cssText = `width:100%;height:1px;background:${C.divider};margin:4px 0;`;
  panel.appendChild(divider);

  // ── Close button ──
  const closeBtn = document.createElement('button');
  closeBtn.textContent = 'Close';
  closeBtn.style.cssText = `
    width:100%;padding:10px 0;border-radius:10px;font-size:13px;font-weight:700;
    font-family:"Nunito",sans-serif;cursor:pointer;transition:all 0.15s;
    background:${C.inputBg};border:1px solid ${C.inputBorder};color:${C.textSecondary};
  `;
  closeBtn.onmouseenter = () => {
    closeBtn.style.borderColor = C.inputBorderHi;
    closeBtn.style.color = C.textPrimary;
    closeBtn.style.background = C.surfaceHover;
  };
  closeBtn.onmouseleave = () => {
    closeBtn.style.borderColor = C.inputBorder;
    closeBtn.style.color = C.textSecondary;
    closeBtn.style.background = C.inputBg;
  };
  closeBtn.onclick = cleanup;
  panel.appendChild(closeBtn);

  // ── Hint ──
  const hint = document.createElement('div');
  hint.textContent = 'ESC to close';
  hint.style.cssText = `font-size:10px;color:${C.textMuted};letter-spacing:0.5px;margin-top:2px;`;
  panel.appendChild(hint);

  // ── ESC handler ──
  escHandler = (e: KeyboardEvent) => {
    if (e.key === 'Escape') cleanup();
  };
  window.addEventListener('keydown', escHandler);

  // ── Mount and animate in ──
  document.body.appendChild(root);
  requestAnimationFrame(() => {
    if (root) root.style.opacity = '1';
    panel.style.transform = 'scale(1)';
  });
}
