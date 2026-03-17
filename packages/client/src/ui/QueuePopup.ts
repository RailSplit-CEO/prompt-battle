import { C } from './UIColors';

export interface QueuePopupOptions {
  opponentName: string;
  opponentIcon?: string;
  queueType: string;
  onAccept: () => void;
  onDecline: () => void;
  onTimeout: () => void;
}

export class QueuePopup {
  private overlay: HTMLDivElement | null = null;
  private countdownInterval: number | null = null;

  show(opts: QueuePopupOptions): void {
    if (this.overlay) return;

    const TIMEOUT = 12; // seconds
    let remaining = TIMEOUT;

    const overlay = document.createElement('div');
    overlay.style.cssText = `
      position:fixed;inset:0;z-index:10000;
      background:rgba(5,8,3,0.92);backdrop-filter:blur(20px);-webkit-backdrop-filter:blur(20px);
      display:flex;align-items:center;justify-content:center;
      opacity:0;transition:opacity 0.3s ease;
      font-family:'Nunito',sans-serif;
    `;
    this.overlay = overlay;

    const panel = document.createElement('div');
    panel.style.cssText = `
      text-align:center;
      transform:scale(0.85);transition:transform 0.4s cubic-bezier(0.16,1,0.3,1);
    `;

    // Title
    const title = document.createElement('div');
    title.style.cssText = `font-family:'Fredoka',sans-serif;font-size:36px;font-weight:700;color:${C.teal};text-shadow:0 0 30px rgba(69,230,176,0.3);margin-bottom:12px;`;
    title.textContent = 'MATCH FOUND';
    panel.appendChild(title);

    // Opponent
    const oppLine = document.createElement('div');
    oppLine.style.cssText = `font-size:18px;color:${C.textPrimary};margin-bottom:24px;`;
    oppLine.textContent = `vs ${opts.opponentName}`;
    panel.appendChild(oppLine);

    // Countdown ring (SVG circle)
    const ringSize = 120;
    const ringStroke = 6;
    const radius = (ringSize - ringStroke) / 2;
    const circumference = 2 * Math.PI * radius;

    const ringWrap = document.createElement('div');
    ringWrap.style.cssText = `position:relative;width:${ringSize}px;height:${ringSize}px;margin:0 auto 24px;`;

    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('width', String(ringSize));
    svg.setAttribute('height', String(ringSize));
    svg.style.transform = 'rotate(-90deg)';

    // Background ring
    const bgCircle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    bgCircle.setAttribute('cx', String(ringSize / 2));
    bgCircle.setAttribute('cy', String(ringSize / 2));
    bgCircle.setAttribute('r', String(radius));
    bgCircle.setAttribute('fill', 'none');
    bgCircle.setAttribute('stroke', 'rgba(139,115,85,0.2)');
    bgCircle.setAttribute('stroke-width', String(ringStroke));
    svg.appendChild(bgCircle);

    // Foreground ring
    const fgCircle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    fgCircle.setAttribute('cx', String(ringSize / 2));
    fgCircle.setAttribute('cy', String(ringSize / 2));
    fgCircle.setAttribute('r', String(radius));
    fgCircle.setAttribute('fill', 'none');
    fgCircle.setAttribute('stroke', C.teal);
    fgCircle.setAttribute('stroke-width', String(ringStroke));
    fgCircle.setAttribute('stroke-dasharray', String(circumference));
    fgCircle.setAttribute('stroke-dashoffset', '0');
    fgCircle.setAttribute('stroke-linecap', 'round');
    fgCircle.style.transition = 'stroke-dashoffset 1s linear';
    svg.appendChild(fgCircle);

    ringWrap.appendChild(svg);

    // Timer text centered on ring
    const timerEl = document.createElement('div');
    timerEl.style.cssText = `position:absolute;inset:0;display:flex;align-items:center;justify-content:center;font-family:'Fredoka',sans-serif;font-size:32px;font-weight:700;color:${C.textH1};`;
    timerEl.textContent = String(remaining);
    ringWrap.appendChild(timerEl);

    panel.appendChild(ringWrap);

    // Buttons
    const btnRow = document.createElement('div');
    btnRow.style.cssText = 'display:flex;justify-content:center;gap:20px;';

    const acceptBtn = document.createElement('button');
    acceptBtn.textContent = 'ACCEPT';
    acceptBtn.style.cssText = `
      font-family:'Fredoka',sans-serif;font-size:20px;font-weight:700;
      color:#fff;background:${C.greenDark};border:2px solid ${C.green};border-radius:14px;
      padding:14px 48px;cursor:pointer;transition:all 0.15s;
      box-shadow:0 0 20px rgba(90,154,78,0.3);
    `;
    acceptBtn.onmouseenter = () => { acceptBtn.style.background = '#4a8a3e'; acceptBtn.style.boxShadow = '0 0 30px rgba(90,154,78,0.5)'; };
    acceptBtn.onmouseleave = () => { acceptBtn.style.background = C.greenDark; acceptBtn.style.boxShadow = '0 0 20px rgba(90,154,78,0.3)'; };
    acceptBtn.onclick = () => { this.close(); opts.onAccept(); };
    btnRow.appendChild(acceptBtn);

    const declineBtn = document.createElement('button');
    declineBtn.textContent = 'DECLINE';
    declineBtn.style.cssText = `
      font-family:'Fredoka',sans-serif;font-size:15px;font-weight:600;
      color:${C.textMuted};background:none;border:2px solid rgba(139,115,85,0.3);border-radius:14px;
      padding:14px 32px;cursor:pointer;transition:all 0.15s;
    `;
    declineBtn.onmouseenter = () => { declineBtn.style.color = C.red; declineBtn.style.borderColor = 'rgba(255,107,107,0.4)'; };
    declineBtn.onmouseleave = () => { declineBtn.style.color = C.textMuted; declineBtn.style.borderColor = 'rgba(139,115,85,0.3)'; };
    declineBtn.onclick = () => { this.close(); opts.onDecline(); };
    btnRow.appendChild(declineBtn);

    panel.appendChild(btnRow);
    overlay.appendChild(panel);
    document.body.appendChild(overlay);

    // Animate in
    requestAnimationFrame(() => requestAnimationFrame(() => {
      overlay.style.opacity = '1';
      panel.style.transform = 'scale(1)';
    }));

    // Countdown timer
    this.countdownInterval = window.setInterval(() => {
      remaining--;
      timerEl.textContent = String(remaining);
      const offset = circumference * (1 - remaining / TIMEOUT);
      fgCircle.style.strokeDashoffset = String(offset);
      if (remaining <= 3) timerEl.style.color = C.red;
      if (remaining <= 0) {
        this.close();
        opts.onTimeout();
      }
    }, 1000);

    // Play sound if available
    try { (window as any).__menuPlaySfx?.('wave_start', 0.5); } catch { /* no-op */ }
  }

  close(): void {
    if (this.countdownInterval !== null) {
      clearInterval(this.countdownInterval);
      this.countdownInterval = null;
    }
    if (this.overlay) {
      this.overlay.style.opacity = '0';
      const ol = this.overlay;
      setTimeout(() => ol.remove(), 300);
      this.overlay = null;
    }
  }
}
