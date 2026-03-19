// ─── PaymentModal — Square Web Payments (Card + Google Pay) ─────
// Full-screen modal overlay for completing a crown purchase via Square.

import { C } from './UIColors';

export interface PaymentModalOptions {
  packageName: string;
  crowns: number;
  amountUSD: number;
  orderId: string;
  onSuccess: (sourceId: string) => void;
  onCancel: () => void;
  onError: (error: string) => void;
}

export class PaymentModal {
  private overlay: HTMLDivElement | null = null;
  private card: any = null;       // Square Card instance
  private googlePay: any = null;  // Square GooglePay instance
  private applePay: any = null;   // Square ApplePay instance

  async show(opts: PaymentModalOptions): Promise<void> {
    // ── Inject keyframes ──────────────────────────────────────────
    if (!document.getElementById('payment-modal-styles')) {
      const style = document.createElement('style');
      style.id = 'payment-modal-styles';
      style.textContent = `
        @keyframes payment-panel-in {
          from { opacity:0; transform:scale(0.94) translateY(16px); }
          to   { opacity:1; transform:scale(1)    translateY(0); }
        }
        @keyframes payment-spinner {
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
      width:min(440px, 94vw);
      background:${C.panelBg};
      border:2px solid ${C.panelBorder};
      border-radius:20px;
      padding:36px 32px 28px;
      box-shadow:${C.panelShadow};
      backdrop-filter:${C.panelBlur};-webkit-backdrop-filter:${C.panelBlur};
      display:flex;flex-direction:column;align-items:center;
      animation:payment-panel-in 0.5s ease-out;
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
    header.textContent = 'Complete Purchase';
    header.style.cssText = `
      font-family:'Fredoka',sans-serif;font-size:24px;font-weight:bold;
      color:${C.gold};text-align:center;margin-bottom:16px;
      text-shadow:0 2px 12px rgba(255,217,61,0.2);
    `;
    panel.appendChild(header);

    // ── 4. Summary ────────────────────────────────────────────────
    const summaryName = document.createElement('div');
    summaryName.textContent = `${opts.packageName} — ${opts.crowns.toLocaleString()} Crowns`;
    summaryName.style.cssText = `
      font-size:15px;color:${C.textPrimary};text-align:center;
      margin-bottom:4px;font-weight:600;
    `;
    panel.appendChild(summaryName);

    const summaryPrice = document.createElement('div');
    summaryPrice.textContent = `$${Math.round(opts.amountUSD)}`;
    summaryPrice.style.cssText = `
      font-size:22px;color:${C.gold};text-align:center;
      font-family:'Fredoka',sans-serif;font-weight:bold;
      margin-bottom:16px;
    `;
    panel.appendChild(summaryPrice);

    // ── 5. Divider ────────────────────────────────────────────────
    const divider1 = document.createElement('div');
    divider1.style.cssText = `
      width:80%;height:1px;margin:0 auto 20px;
      background:linear-gradient(90deg, transparent, ${C.divider}, transparent);
    `;
    panel.appendChild(divider1);

    // ── 6. Card Payment Section ───────────────────────────────────
    const cardLabel = document.createElement('div');
    cardLabel.textContent = 'Pay with Card';
    cardLabel.style.cssText = `
      font-size:13px;color:${C.textSecondary};text-align:left;
      width:100%;margin-bottom:10px;font-weight:600;letter-spacing:0.5px;
    `;
    panel.appendChild(cardLabel);

    const cardContainer = document.createElement('div');
    cardContainer.id = 'sq-card-container';
    cardContainer.style.cssText = `
      width:100%;min-height:90px;margin-bottom:16px;
      border-radius:8px;overflow:hidden;
    `;
    panel.appendChild(cardContainer);

    // Error message area (below card form, above pay button)
    const errorEl = document.createElement('div');
    errorEl.style.cssText = `
      color:${C.red};font-size:13px;text-align:center;
      min-height:0;margin-bottom:8px;opacity:0;transition:opacity 0.3s;
      width:100%;
    `;
    panel.appendChild(errorEl);

    // Pay button
    const payBtn = document.createElement('button');
    payBtn.textContent = `Pay $${Math.round(opts.amountUSD)}`;
    payBtn.style.cssText = `
      width:100%;padding:12px;border:none;border-radius:10px;
      background:${C.gold};color:#1a1a0a;
      font-family:'Fredoka',sans-serif;font-size:16px;font-weight:bold;
      cursor:pointer;transition:filter 0.15s, transform 0.1s;
    `;
    payBtn.onmouseenter = () => { payBtn.style.filter = 'brightness(1.12)'; };
    payBtn.onmouseleave = () => { payBtn.style.filter = 'brightness(1)'; };
    payBtn.onmousedown = () => { payBtn.style.transform = 'scale(0.97)'; };
    payBtn.onmouseup = () => { payBtn.style.transform = 'scale(1)'; };
    panel.appendChild(payBtn);

    // ── 7. "or" Divider ───────────────────────────────────────────
    const orDivider = document.createElement('div');
    orDivider.style.cssText = `
      display:flex;align-items:center;width:100%;margin:18px 0;gap:12px;
    `;
    const orLineL = document.createElement('div');
    orLineL.style.cssText = `flex:1;height:1px;background:${C.divider};`;
    const orText = document.createElement('span');
    orText.textContent = 'or';
    orText.style.cssText = `
      font-size:12px;color:${C.textMuted};font-weight:600;letter-spacing:1px;
    `;
    const orLineR = document.createElement('div');
    orLineR.style.cssText = `flex:1;height:1px;background:${C.divider};`;
    orDivider.appendChild(orLineL);
    orDivider.appendChild(orText);
    orDivider.appendChild(orLineR);

    // Google Pay wrapper — hidden by default, shown only if GPay initializes
    const gpayWrapper = document.createElement('div');
    gpayWrapper.style.cssText = 'width:100%;display:none;';

    // ── 8. Google Pay Section ─────────────────────────────────────
    const gpayContainer = document.createElement('div');
    gpayContainer.id = 'sq-googlepay-container';
    gpayContainer.style.cssText = `
      width:100%;min-height:44px;border-radius:10px;overflow:hidden;
    `;
    gpayWrapper.appendChild(gpayContainer);

    // Only show the "or" divider and GPay section together
    const gpaySection = document.createElement('div');
    gpaySection.style.cssText = 'width:100%;display:none;';
    gpaySection.appendChild(orDivider);
    gpaySection.appendChild(gpayWrapper);
    panel.appendChild(gpaySection);

    // ── 8b. Apple Pay Section (hidden by default) ───────────────
    const apWrapEl = document.createElement('div');
    apWrapEl.id = 'sq-applepay-wrap';
    apWrapEl.style.cssText = 'width:100%;display:none;';
    apWrapEl.innerHTML = `
      <div style="text-align:center;color:${C.textMuted};font:13px 'Nunito',sans-serif;margin:12px 0 8px;">or</div>
      <div id="sq-applepay-container" style="min-height:44px;"></div>
    `;
    panel.appendChild(apWrapEl);

    // ── 9. Cancel Link ────────────────────────────────────────────
    const cancelLink = document.createElement('div');
    cancelLink.textContent = 'Cancel';
    cancelLink.style.cssText = `
      color:${C.textMuted};font-size:13px;cursor:pointer;
      text-align:center;margin-top:20px;
      transition:color 0.2s;
    `;
    cancelLink.onmouseenter = () => { cancelLink.style.color = C.textSecondary; };
    cancelLink.onmouseleave = () => { cancelLink.style.color = C.textMuted; };
    cancelLink.onclick = () => {
      this.close();
      opts.onCancel();
    };
    panel.appendChild(cancelLink);

    overlay.appendChild(panel);
    document.body.appendChild(overlay);

    // Fade in
    requestAnimationFrame(() => {
      requestAnimationFrame(() => { overlay.style.opacity = '1'; });
    });

    // ── 10–13. Initialize Square SDK & payment methods ────────────
    try {
      await this.loadSquareSDK();

      const appId = this.getSquareAppId();
      const locationId = this.getSquareLocationId();
      const payments = (window as any).Square.payments(appId, locationId);

      // 12. Card
      this.card = await payments.card();
      await this.card.attach('#sq-card-container');

      // 13. Payment request for digital wallets (Google Pay, Apple Pay)
      const paymentRequest = payments.paymentRequest({
        countryCode: 'US',
        currencyCode: 'USD',
        total: {
          amount: (opts.amountUSD * 100).toFixed(0),
          label: opts.packageName,
        },
      });

      // Google Pay — gracefully handle unavailability
      try {
        this.googlePay = await payments.googlePay(paymentRequest);
        await this.googlePay.attach('#sq-googlepay-container');

        // Show Google Pay section + "or" divider only on success
        gpaySection.style.display = 'block';
        gpayWrapper.style.display = 'block';
      } catch {
        // Google Pay not available — silently hide the section
        gpaySection.style.display = 'none';
      }

      // Apple Pay — gracefully handle unavailability
      try {
        this.applePay = await payments.applePay(paymentRequest);
        await this.applePay.attach('#sq-applepay-container');
        const apWrap = overlay.querySelector('#sq-applepay-wrap') as HTMLElement;
        if (apWrap) apWrap.style.display = 'block';
      } catch { /* Apple Pay not available */ }
    } catch (err) {
      errorEl.textContent = 'Failed to load payment form. Please try again.';
      errorEl.style.opacity = '1';
      opts.onError(err instanceof Error ? err.message : String(err));
      return;
    }

    // ── 14. Pay button click — tokenize card ──────────────────────
    payBtn.onclick = async () => {
      if (!this.card) return;

      // Reset error
      errorEl.style.opacity = '0';

      // Show loading state
      const origText = payBtn.textContent;
      payBtn.textContent = 'Processing...';
      payBtn.style.opacity = '0.7';
      payBtn.style.pointerEvents = 'none';

      try {
        const result = await this.card.tokenize();
        if (result.status === 'OK') {
          opts.onSuccess(result.token);
          this.close();
        } else {
          const errMsg = result.errors
            ? result.errors.map((e: any) => e.message).join(', ')
            : 'Card verification failed. Please check your details.';
          errorEl.textContent = errMsg;
          errorEl.style.opacity = '1';
          payBtn.textContent = origText;
          payBtn.style.opacity = '1';
          payBtn.style.pointerEvents = 'auto';
        }
      } catch (err) {
        errorEl.textContent = 'Payment failed. Please try again.';
        errorEl.style.opacity = '1';
        payBtn.textContent = origText;
        payBtn.style.opacity = '1';
        payBtn.style.pointerEvents = 'auto';
        opts.onError(err instanceof Error ? err.message : String(err));
      }
    };

    // ── 15a. Apple Pay tokenize flow ─────────────────────────────
    if (this.applePay) {
      this.applePay.addEventListener('ontokenize', (event: any) => {
        const token = event?.detail?.token;
        if (token) opts.onSuccess(token);
      });
    }

    // ── 15. Google Pay tokenize flow ──────────────────────────────
    if (this.googlePay) {
      this.googlePay.addEventListener('payment', async (event: any) => {
        try {
          const result = await this.googlePay.tokenize();
          if (result.status === 'OK') {
            opts.onSuccess(result.token);
            this.close();
          } else {
            const errMsg = result.errors
              ? result.errors.map((e: any) => e.message).join(', ')
              : 'Google Pay verification failed.';
            errorEl.textContent = errMsg;
            errorEl.style.opacity = '1';
          }
        } catch (err) {
          errorEl.textContent = 'Google Pay failed. Please try again.';
          errorEl.style.opacity = '1';
          opts.onError(err instanceof Error ? err.message : String(err));
        }
      });
    }
  }

  close(): void {
    if (this.card) {
      this.card.destroy();
      this.card = null;
    }
    if (this.googlePay) {
      this.googlePay.destroy();
      this.googlePay = null;
    }
    if (this.applePay) {
      this.applePay.destroy();
      this.applePay = null;
    }
    if (this.overlay) {
      this.overlay.style.opacity = '0';
      const el = this.overlay;
      setTimeout(() => { el.remove(); }, 250);
      this.overlay = null;
    }
  }

  // ── Dynamically load Square Web Payments SDK ──────────────────
  private async loadSquareSDK(): Promise<void> {
    if ((window as any).Square) return;

    const env = (import.meta as any).env?.VITE_SQUARE_ENV || 'sandbox';
    const src =
      env === 'production'
        ? 'https://web.squarecdn.com/v1/square.js'
        : 'https://sandbox.web.squarecdn.com/v1/square.js';

    return new Promise<void>((resolve, reject) => {
      const script = document.createElement('script');
      script.src = src;
      script.onload = () => resolve();
      script.onerror = () => reject(new Error('Failed to load Square SDK'));
      document.head.appendChild(script);
    });
  }

  private getSquareAppId(): string {
    return (import.meta as any).env?.VITE_SQUARE_APP_ID || '';
  }

  private getSquareLocationId(): string {
    return (import.meta as any).env?.VITE_SQUARE_LOCATION_ID || '';
  }
}
