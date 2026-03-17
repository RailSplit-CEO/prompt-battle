import { C } from './UIColors';

const GOOGLE_SVG = `<svg width="20" height="20" viewBox="0 0 48 48" style="vertical-align:middle;margin-right:10px;">
  <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/>
  <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/>
  <path fill="#FBBC05" d="M10.53 28.59a14.5 14.5 0 0 1 0-9.18l-7.98-6.19a24.0 24.0 0 0 0 0 21.56l7.98-6.19z"/>
  <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/>
</svg>`;

const PRIVACY_TEXT = `Mark My Hordes uses Firebase Authentication to manage sign-in. When you sign in with Google, we receive your display name, email, and profile photo from your Google account — used solely to identify you in-game.

Game settings (audio, keybindings) are stored in localStorage. No tracking cookies are used beyond Firebase session management.

Guest accounts are anonymous Firebase sessions. They persist across page reloads but may be lost if you clear browser data. You can upgrade to Google sign-in anytime.

We do not sell or share your data. All game data is stored securely and associated only with your account ID.`;

export class LoginOverlay {
  private root: HTMLDivElement | null = null;
  private errorEl: HTMLDivElement | null = null;
  private resolve: ((value: 'google' | 'guest' | 'itch') => void) | null = null;

  show(): Promise<'google' | 'guest' | 'itch'> {
    // If already showing, just swap the resolve so next click resolves the new promise
    if (this.root) {
      return new Promise<'google' | 'guest' | 'itch'>((resolve) => {
        this.resolve = resolve;
      });
    }

    return new Promise<'google' | 'guest' | 'itch'>((resolve) => {
      this.resolve = resolve;

      // Inject keyframes
      if (!document.getElementById('login-overlay-styles')) {
        const style = document.createElement('style');
        style.id = 'login-overlay-styles';
        style.textContent = `
          @keyframes login-title-float {
            0%, 100% { transform: translateY(0); }
            50% { transform: translateY(-5px); }
          }
          @keyframes login-glow {
            0%, 100% { box-shadow: 0 0 30px rgba(255,217,61,0.06), 0 8px 40px rgba(0,0,0,0.5); }
            50% { box-shadow: 0 0 50px rgba(255,217,61,0.12), 0 8px 40px rgba(0,0,0,0.5); }
          }
          @keyframes login-panel-in {
            from { opacity: 0; transform: scale(0.94) translateY(16px); }
            to { opacity: 1; transform: scale(1) translateY(0); }
          }
          @keyframes login-sword-left {
            from { opacity: 0; transform: rotate(-30deg) translateX(-20px); }
            to { opacity: 0.7; transform: rotate(-30deg) translateX(0); }
          }
          @keyframes login-sword-right {
            from { opacity: 0; transform: rotate(30deg) scaleX(-1) translateX(-20px); }
            to { opacity: 0.7; transform: rotate(30deg) scaleX(-1) translateX(0); }
          }
        `;
        document.head.appendChild(style);
      }

      // Full screen dark background with center glow (matches MenuScene bg)
      const root = document.createElement('div');
      this.root = root;
      root.style.cssText = `
        position:fixed;inset:0;z-index:10000;
        background:#0f1a0a;
        display:flex;align-items:center;justify-content:center;
        font-family:'Nunito',sans-serif;
        opacity:0;transition:opacity 0.5s ease;
      `;

      // Radial glow (matches MenuScene dark earthy gradient)
      const bgGlow = document.createElement('div');
      bgGlow.style.cssText = `
        position:absolute;top:45%;left:50%;transform:translate(-50%,-50%);
        width:min(800px,150vw);height:min(800px,150vw);border-radius:50%;
        background:radial-gradient(circle, rgba(26,46,16,0.6) 0%, rgba(36,58,24,0.3) 30%, rgba(15,26,10,0) 70%);
        pointer-events:none;
      `;
      root.appendChild(bgGlow);

      // Main panel
      const panel = document.createElement('div');
      panel.style.cssText = `
        position:relative;
        width:min(460px, 94vw);
        background:${C.panelBg};
        border:2px solid ${C.panelBorder};
        border-radius:20px;
        padding:44px 36px 32px;
        box-shadow:${C.panelShadow};
        backdrop-filter:${C.panelBlur};-webkit-backdrop-filter:${C.panelBlur};
        display:flex;flex-direction:column;align-items:center;
        animation: login-panel-in 0.6s ease-out, login-glow 4s ease-in-out infinite;
      `;

      // Paper texture overlay
      const texture = document.createElement('div');
      texture.style.cssText = `
        position:absolute;inset:0;
        background-image:url('assets/ui/panels/SpecialPaper.png');
        background-size:cover;opacity:0.08;
        pointer-events:none;border-radius:inherit;
      `;
      panel.appendChild(texture);

      // Decorative top gold line
      const topBar = document.createElement('div');
      topBar.style.cssText = `
        position:absolute;top:-1px;left:15%;right:15%;height:3px;
        background:linear-gradient(90deg, transparent, ${C.gold}, transparent);
        border-radius:0 0 4px 4px;
      `;
      panel.appendChild(topBar);

      // === TITLE SECTION (matches MenuScene: swords + gold text) ===
      const titleRow = document.createElement('div');
      titleRow.style.cssText = `
        position:relative;margin-bottom:6px;
        display:flex;align-items:center;justify-content:center;
      `;

      // Title text (matches MenuScene Fredoka gold style exactly)
      const title = document.createElement('div');
      title.textContent = 'MARK MY HORDES';
      title.style.cssText = `
        font-family:'Fredoka',sans-serif;font-size:clamp(28px, 5.5vw, 44px);
        font-weight:bold;color:${C.gold};text-align:center;
        line-height:1.1;letter-spacing:2px;
        text-shadow:0 2px 20px rgba(255,217,61,0.25), 0 0 60px rgba(255,217,61,0.08);
        -webkit-text-stroke:1.5px #3a2a10;
        paint-order:stroke fill;
        animation: login-title-float 2.4s ease-in-out infinite;
        position:relative;
      `;

      // Left sword — positioned tight against title
      const swordL = document.createElement('img');
      swordL.src = 'assets/ui/icons/Icon_05.png';
      swordL.style.cssText = `
        width:40px;height:40px;object-fit:contain;
        animation: login-sword-left 0.8s ease-out both;
        animation-delay:0.3s;opacity:0;
        position:absolute;top:50%;right:100%;margin-right:-90px;
        transform-origin:center center;
        translate:0 -50%;
      `;

      // Right sword — positioned tight against title
      const swordR = document.createElement('img');
      swordR.src = 'assets/ui/icons/Icon_05.png';
      swordR.style.cssText = `
        width:40px;height:40px;object-fit:contain;
        animation: login-sword-right 0.8s ease-out both;
        animation-delay:0.3s;opacity:0;
        position:absolute;top:50%;left:100%;margin-left:-100px;
        transform-origin:center center;
        translate:0 -50%;
      `;

      title.appendChild(swordL);
      title.appendChild(swordR);
      titleRow.appendChild(title);
      panel.appendChild(titleRow);

      // Subtitle
      const subtitle = document.createElement('div');
      subtitle.textContent = 'COMMAND YOUR ARMY WITH WORDS';
      subtitle.style.cssText = `
        font-size:11px;color:${C.textSecondary};letter-spacing:4px;
        text-align:center;margin-bottom:28px;font-weight:600;
      `;
      panel.appendChild(subtitle);

      // Divider (matches MenuScene diamond divider)
      const divider = document.createElement('div');
      divider.style.cssText = `
        display:flex;align-items:center;width:75%;margin:0 auto 28px;gap:12px;
      `;
      const mkLine = (dir: string) => {
        const l = document.createElement('div');
        l.style.cssText = `flex:1;height:1px;background:linear-gradient(to ${dir}, transparent, rgba(139,115,85,0.5));`;
        return l;
      };
      const diamond = document.createElement('div');
      diamond.style.cssText = `
        width:8px;height:8px;background:${C.gold};
        transform:rotate(45deg);flex-shrink:0;opacity:0.7;
      `;
      // Small dots at ends (like MenuScene)
      const mkDot = () => {
        const d = document.createElement('div');
        d.style.cssText = `width:5px;height:5px;border-radius:50%;background:rgba(139,115,85,0.5);flex-shrink:0;`;
        return d;
      };
      divider.appendChild(mkDot());
      divider.appendChild(mkLine('right'));
      divider.appendChild(diamond);
      divider.appendChild(mkLine('left'));
      divider.appendChild(mkDot());
      panel.appendChild(divider);

      // Platform detection for itch.io
      const isItchPlatform = (import.meta as any).env?.VITE_PLATFORM === 'itch' || window.location.hostname.includes('itch.zone');

      // --- itch.io sign-in button ---
      const itchBtn = document.createElement('button');
      itchBtn.textContent = 'Sign in with itch.io';
      const itchIsPrimary = isItchPlatform;
      itchBtn.style.cssText = `
        width:100%;max-width:300px;
        height:${itchIsPrimary ? '52px' : '44px'};
        padding:0 24px;
        background:${itchIsPrimary ? '#FA5C5C' : 'transparent'};
        color:${itchIsPrimary ? '#fff' : '#FA5C5C'};
        font-size:${itchIsPrimary ? '16px' : '14px'};
        font-family:'Fredoka',sans-serif;
        font-weight:bold;
        border:${itchIsPrimary ? 'none' : '2px solid rgba(250,92,92,0.45)'};
        border-radius:12px;cursor:pointer;
        display:flex;align-items:center;justify-content:center;
        margin-bottom:12px;
        transition:box-shadow 0.2s, transform 0.15s, background 0.2s, border-color 0.2s;
        box-shadow:${itchIsPrimary ? '0 2px 12px rgba(0,0,0,0.25)' : 'none'};
      `;
      itchBtn.onmouseenter = () => {
        if (itchIsPrimary) {
          itchBtn.style.boxShadow = '0 4px 24px rgba(0,0,0,0.4), 0 0 0 2px rgba(250,92,92,0.4)';
          itchBtn.style.transform = 'translateY(-2px)';
        } else {
          itchBtn.style.borderColor = 'rgba(250,92,92,0.8)';
          itchBtn.style.background = 'rgba(250,92,92,0.1)';
          itchBtn.style.transform = 'translateY(-1px)';
        }
      };
      itchBtn.onmouseleave = () => {
        if (itchIsPrimary) {
          itchBtn.style.boxShadow = '0 2px 12px rgba(0,0,0,0.25)';
        } else {
          itchBtn.style.borderColor = 'rgba(250,92,92,0.45)';
          itchBtn.style.background = 'transparent';
        }
        itchBtn.style.transform = 'translateY(0)';
      };
      itchBtn.onclick = () => {
        (window as any).__menuPlaySfx?.('button_click', 0.3);
        itchBtn.textContent = 'Signing in...';
        itchBtn.disabled = true;
        googleBtn.disabled = true;
        if (this.resolve) this.resolve('itch');
      };

      // --- Google sign-in button ---
      const googleBtn = document.createElement('button');
      const googleIsPrimary = !isItchPlatform;
      googleBtn.innerHTML = `${GOOGLE_SVG} Sign in with Google`;
      googleBtn.style.cssText = `
        width:100%;max-width:300px;
        height:${googleIsPrimary ? '52px' : '44px'};
        padding:0 24px;
        background:${googleIsPrimary ? '#4285F4' : 'transparent'};
        color:${googleIsPrimary ? '#fff' : '#4285F4'};
        font-size:${googleIsPrimary ? '16px' : '14px'};
        font-family:'Nunito',sans-serif;
        font-weight:bold;
        border:${googleIsPrimary ? 'none' : '2px solid rgba(66,133,244,0.45)'};
        border-radius:12px;cursor:pointer;
        display:flex;align-items:center;justify-content:center;
        margin-bottom:12px;
        transition:box-shadow 0.2s, transform 0.15s, background 0.2s, border-color 0.2s;
        box-shadow:${googleIsPrimary ? '0 2px 12px rgba(0,0,0,0.25)' : 'none'};
      `;
      googleBtn.onmouseenter = () => {
        if (googleIsPrimary) {
          googleBtn.style.boxShadow = '0 4px 24px rgba(0,0,0,0.4), 0 0 0 2px rgba(66,133,244,0.4)';
          googleBtn.style.transform = 'translateY(-2px)';
        } else {
          googleBtn.style.borderColor = 'rgba(66,133,244,0.8)';
          googleBtn.style.background = 'rgba(66,133,244,0.1)';
          googleBtn.style.transform = 'translateY(-1px)';
        }
      };
      googleBtn.onmouseleave = () => {
        if (googleIsPrimary) {
          googleBtn.style.boxShadow = '0 2px 12px rgba(0,0,0,0.25)';
        } else {
          googleBtn.style.borderColor = 'rgba(66,133,244,0.45)';
          googleBtn.style.background = 'transparent';
        }
        googleBtn.style.transform = 'translateY(0)';
      };
      googleBtn.onclick = () => {
        (window as any).__menuPlaySfx?.('button_click', 0.3);
        googleBtn.innerHTML = 'Signing in...';
        googleBtn.disabled = true;
        itchBtn.disabled = true;
        if (this.resolve) this.resolve('google');
      };

      // --- Guest text link ---
      const guestLink = document.createElement('span');
      guestLink.textContent = 'Play as Guest';
      guestLink.style.cssText = `
        color:${C.textMuted};
        font-size:13px;font-family:'Nunito',sans-serif;
        cursor:pointer;
        transition:color 0.2s;
        margin-top:4px;margin-bottom:8px;
      `;
      guestLink.onmouseenter = () => { guestLink.style.color = C.textSecondary; };
      guestLink.onmouseleave = () => { guestLink.style.color = C.textMuted; };
      guestLink.onclick = () => {
        (window as any).__menuPlaySfx?.('button_click', 0.3);
        guestLink.textContent = 'Signing in...';
        guestLink.style.pointerEvents = 'none';
        itchBtn.disabled = true;
        googleBtn.disabled = true;
        if (this.resolve) this.resolve('guest');
      };

      // On itch.io platform: itch (primary) -> Google (secondary) -> Guest
      // On own website: Google (primary) -> itch (secondary) -> Guest
      if (isItchPlatform) {
        panel.appendChild(itchBtn);
        panel.appendChild(googleBtn);
      } else {
        panel.appendChild(googleBtn);
        panel.appendChild(itchBtn);
      }
      panel.appendChild(guestLink);

      // Error area
      this.errorEl = document.createElement('div');
      this.errorEl.style.cssText = `
        color:${C.red};font-size:13px;text-align:center;
        min-height:18px;margin:8px 0;opacity:0;transition:opacity 0.3s;
      `;
      panel.appendChild(this.errorEl);

      // Privacy toggle
      const privacyLink = document.createElement('div');
      privacyLink.textContent = 'Privacy Policy';
      privacyLink.style.cssText = `
        color:${C.textMuted};font-size:11px;cursor:pointer;
        transition:color 0.2s;margin-top:4px;
      `;
      privacyLink.onmouseenter = () => { privacyLink.style.color = C.textSecondary; };
      privacyLink.onmouseleave = () => { privacyLink.style.color = C.textMuted; };

      const privacyBox = document.createElement('div');
      privacyBox.textContent = PRIVACY_TEXT;
      privacyBox.style.cssText = `
        max-width:340px;color:${C.textMuted};font-size:10px;line-height:1.6;
        text-align:center;padding:0 16px;
        background:rgba(18,22,14,0.5);border-radius:8px;
        border:1px solid rgba(139,115,85,0.15);
        max-height:0;overflow:hidden;opacity:0;
        transition:max-height 0.4s ease, opacity 0.3s, padding 0.4s, margin 0.4s;
        margin-top:0;
      `;

      let open = false;
      privacyLink.onclick = () => {
        open = !open;
        privacyBox.style.maxHeight = open ? '250px' : '0';
        privacyBox.style.opacity = open ? '1' : '0';
        privacyBox.style.padding = open ? '12px 16px' : '0 16px';
        privacyBox.style.marginTop = open ? '10px' : '0';
      };

      panel.appendChild(privacyLink);
      panel.appendChild(privacyBox);

      // Version at bottom
      const version = document.createElement('div');
      version.textContent = 'v0.2.0';
      version.style.cssText = `font-size:10px;color:rgba(58,74,42,0.6);margin-top:12px;`;
      panel.appendChild(version);

      root.appendChild(panel);
      document.body.appendChild(root);

      requestAnimationFrame(() => {
        requestAnimationFrame(() => { root.style.opacity = '1'; });
      });
    });
  }

  hide(): void {
    if (!this.root) return;
    this.root.style.opacity = '0';
    const el = this.root;
    setTimeout(() => el.remove(), 500);
    this.root = null;
    this.errorEl = null;
    this.resolve = null;
  }

  showError(msg: string): void {
    if (!this.errorEl) return;
    this.errorEl.textContent = msg;
    this.errorEl.style.opacity = '1';
  }
}

/**
 * Show a prompt asking guests to sign in to access a feature.
 * Returns true if user signed in, false if they dismissed.
 */
export function showGuestLoginPrompt(featureName: string): void {
  import('../auth/AuthManager').then(({ AuthManager }) => {
    const auth = AuthManager.getInstance();

    const overlay = document.createElement('div');
    overlay.style.cssText = `
      position:fixed;inset:0;z-index:10001;
      background:rgba(5,8,3,0.82);backdrop-filter:blur(16px);
      display:flex;align-items:center;justify-content:center;
      font-family:'Nunito',sans-serif;
      opacity:0;transition:opacity 0.25s ease;
    `;

    const panel = document.createElement('div');
    panel.style.cssText = `
      max-width:380px;width:90%;padding:32px 28px;text-align:center;
      background:rgba(18,22,14,0.94);border:2px solid rgba(139,115,85,0.45);
      border-radius:16px;box-shadow:0 12px 48px rgba(0,0,0,0.6);
    `;

    // Icon
    const icon = document.createElement('div');
    icon.textContent = '\u{1F512}';
    icon.style.cssText = 'font-size:40px;margin-bottom:16px;';
    panel.appendChild(icon);

    // Title
    const title = document.createElement('div');
    title.textContent = `Sign in to ${featureName}`;
    title.style.cssText = `
      font-family:'Fredoka',sans-serif;font-size:20px;font-weight:700;
      color:#FFD93D;letter-spacing:2px;margin-bottom:10px;
    `;
    panel.appendChild(title);

    // Message
    const msg = document.createElement('div');
    msg.textContent = 'Create an account to unlock purchases, rewards, match history, and social features.';
    msg.style.cssText = 'font-size:13px;color:#a89870;margin-bottom:24px;line-height:1.5;';
    panel.appendChild(msg);

    // Sign in button (Google)
    const signInBtn = document.createElement('button');
    signInBtn.textContent = 'Sign in with Google';
    signInBtn.style.cssText = `
      width:100%;padding:12px;font-size:15px;font-weight:700;
      font-family:'Nunito',sans-serif;
      background:#fff;color:#333;border:none;border-radius:10px;
      cursor:pointer;margin-bottom:10px;transition:all 0.2s;
      box-shadow:0 2px 8px rgba(0,0,0,0.2);
    `;
    signInBtn.onmouseenter = () => { signInBtn.style.transform = 'translateY(-1px)'; };
    signInBtn.onmouseleave = () => { signInBtn.style.transform = 'translateY(0)'; };
    signInBtn.onclick = async () => {
      signInBtn.textContent = 'Signing in...';
      signInBtn.disabled = true;
      try {
        await auth.linkGuestToGoogle();
        window.location.reload();
      } catch {
        signInBtn.textContent = 'Sign in with Google';
        signInBtn.disabled = false;
      }
    };
    panel.appendChild(signInBtn);

    // Not now button
    const notNowBtn = document.createElement('button');
    notNowBtn.textContent = 'Not Now';
    notNowBtn.style.cssText = `
      width:100%;padding:10px;font-size:13px;font-weight:600;
      font-family:'Nunito',sans-serif;
      background:transparent;color:#7a6e56;border:1.5px solid rgba(139,115,85,0.3);
      border-radius:10px;cursor:pointer;transition:all 0.15s;
    `;
    notNowBtn.onmouseenter = () => { notNowBtn.style.borderColor = 'rgba(139,115,85,0.6)'; };
    notNowBtn.onmouseleave = () => { notNowBtn.style.borderColor = 'rgba(139,115,85,0.3)'; };
    notNowBtn.onclick = () => dismiss();
    panel.appendChild(notNowBtn);

    overlay.appendChild(panel);
    overlay.onclick = (e) => { if (e.target === overlay) dismiss(); };
    document.body.appendChild(overlay);
    requestAnimationFrame(() => { overlay.style.opacity = '1'; });

    function dismiss() {
      overlay.style.opacity = '0';
      setTimeout(() => overlay.remove(), 250);
    }
  });
}
