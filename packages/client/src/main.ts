import Phaser from 'phaser';
import { BootScene } from './scenes/BootScene';
import { MenuScene } from './scenes/MenuScene';
import { HordeScene } from './scenes/HordeScene';
import { CharactersScene } from './scenes/CharactersScene';
import { PvpMenuScene } from './scenes/PvpMenuScene';
import { AccountScene } from './scenes/AccountScene';
// StoreScene removed — store is now a popup (StorePanel)
import { AuthManager } from './auth/AuthManager';
import { LoginOverlay } from './ui/LoginOverlay';
import { ProfileSetupOverlay } from './ui/ProfileSetupOverlay';
import { FirebaseSync } from './network/FirebaseSync';
import { WalletManager } from './store/WalletManager';
import { InventoryManager } from './store/InventoryManager';
import { EquipService } from './store/EquipService';
import { installDevTools } from './store/dev-tools';
import { ThemeManager } from './store/ThemeManager';
import { PlayerLevelManager } from './store/PlayerLevelManager';
import { BattlePassManager } from './store/BattlePassManager';

async function boot() {
  // Suppress the 10s "game not started" warning — we're in the auth flow
  (window as any).__gameStarted = true;

  const auth = AuthManager.getInstance();

  // 1. Initialize Firebase + set persistence
  await auth.initFirebase();

  // 2. Check for existing session (survives reload)
  const existingUser = await auth.waitForExistingSession();

  if (!existingUser) {
    // Try itch.io desktop app auto-auth (zero clicks, no UI)
    const itchApiKey = (window as any).Itch?.env?.ITCHIO_API_KEY;
    if (itchApiKey) {
      try {
        await auth.signInWithItchApp();
        console.log('[Boot] Auto-signed in via itch.io desktop app');
      } catch (err) {
        console.warn('[Boot] itch.io app auto-auth failed, falling back to login:', err);
      }
    }

    // If still not signed in (no itch app, or itch app auth failed), show LoginOverlay
    if (!auth.currentUser) {
      const loginOverlay = new LoginOverlay();
      let signedIn = false;

      while (!signedIn) {
        const choice = await loginOverlay.show();

        try {
          if (choice === 'google') {
            await auth.signInWithGoogle();
          } else if (choice === 'itch') {
            await auth.signInWithItch();
          } else {
            await auth.signInAsGuest();
          }
          signedIn = true;
        } catch (err: any) {
          const msg = (err as Error).message;
          if (msg === 'POPUP_BLOCKED') {
            loginOverlay.showError('Popup blocked — please allow popups for this site and try again.');
          } else if (msg === 'POPUP_CANCELLED') {
            loginOverlay.showError('');
          } else {
            loginOverlay.showError('Sign-in failed. Please try again.');
            console.warn('[Boot] Sign-in error:', err);
          }
        }
      }

      loginOverlay.hide();
    }
  }

  // 4. Load or create profile for ALL users (including guests)
  if (auth.currentUser) {
    try {
      await auth.loadMyProfile();
      if (!auth.userProfile) {
        const provider = auth.isGuest ? 'anonymous' : 'google';
        const itchUser = auth.isGuest ? null : auth.getPendingItchUser();
        if (itchUser) {
          // Auto-create profile from itch.io info
          try {
            const username = itchUser.username.replace(/[^a-zA-Z0-9_]/g, '_').slice(0, 16);
            await auth.createProfile(auth.currentUser.uid, username, 'gnome', 'itch');
            await auth.loadMyProfile();
          } catch {
            // Fall back to manual profile setup
            const profileSetup = new ProfileSetupOverlay(
              (username) => auth.checkUsernameAvailable(username)
            );
            const { username, icon } = await profileSetup.show();
            await auth.createProfile(auth.currentUser.uid, username, icon, 'itch');
            profileSetup.hide();
            await auth.loadMyProfile();
          }
        } else {
          // Profile setup for Google and guest users — pick a username
          const profileSetup = new ProfileSetupOverlay(
            (username) => auth.checkUsernameAvailable(username)
          );
          const { username, icon } = await profileSetup.show();
          await auth.createProfile(auth.currentUser.uid, username, icon, provider);
          profileSetup.hide();
          await auth.loadMyProfile();
        }
      }
    } catch (err) {
      console.warn('[Boot] Profile load/create failed (deploy database rules?):', err);
      // Continue without profile — social features will be unavailable
    }
  }

  // 5. Set up online presence tracking (for all users with a profile)
  if (auth.currentUser && auth.userProfile) {
    try { auth.setupPresence(); } catch { /* non-critical */ }
  }

  // 5b. Initialize store managers (wallet, inventory, equip)
  if (auth.currentUser) {
    const uid = auth.currentUser.uid;
    WalletManager.getInstance().init(uid);
    InventoryManager.getInstance().init(uid);
    EquipService.getInstance().init(uid);
    ThemeManager.getInstance().init();
    PlayerLevelManager.getInstance().init(uid);
    BattlePassManager.getInstance().init(uid);
  }

  // 5c. Install dev tools in development mode
  const isDev = (import.meta as any).env?.VITE_DEV_MODE === 'true' || localStorage.getItem('pb_dev') === 'true';
  if (isDev) {
    installDevTools();
  }

  // 5d. Show daily reward on login (non-blocking)
  if (auth.currentUser && !auth.isGuest) {
    import('./ui/DailyRewardModal').then(({ DailyRewardModal }) => {
      new DailyRewardModal().show();
    }).catch(() => { /* non-critical */ });
  }

  // 6. Check for active game to rejoin (multiplayer or solo)
  // Escape hatch: ?clearGame=1 in URL clears stuck game state
  if (new URLSearchParams(window.location.search).has('clearGame')) {
    localStorage.removeItem('pb_active_game');
    console.log('[Boot] Cleared active game state via URL param');
    window.history.replaceState({}, '', window.location.pathname);
  }
  const activeGameStr = localStorage.getItem('pb_active_game');
  if (activeGameStr) {
    try {
      const activeGame = JSON.parse(activeGameStr);
      if (Date.now() - activeGame.savedAt < 30 * 60 * 1000 &&
          auth.currentUser && activeGame.playerId === auth.currentUser.uid) {
        const firebase = FirebaseSync.getInstance();
        await firebase.initialize();
        const status = await firebase.getGameStatus(activeGame.gameId);
        if (status === 'playing' || status === 'drafting') {
          (window as any).__reconnectData = activeGame;
        } else {
          localStorage.removeItem('pb_active_game');
        }
      } else {
        localStorage.removeItem('pb_active_game');
      }
    } catch {
      localStorage.removeItem('pb_active_game');
    }
  }

  // 7. Show game container BEFORE creating Phaser (needs non-zero dimensions for WebGL)
  const container = document.getElementById('game-container');
  if (container) {
    container.style.display = 'block';
    void container.offsetHeight;
  }

  const config: Phaser.Types.Core.GameConfig = {
    type: Phaser.AUTO,
    parent: 'game-container',
    width: 1920,
    height: 1080,
    backgroundColor: '#0f1a0a',
    antialias: true,
    roundPixels: false,
    scale: {
      mode: Phaser.Scale.RESIZE,
    },
    scene: [BootScene, MenuScene, PvpMenuScene, AccountScene, HordeScene, CharactersScene],
    physics: {
      default: 'arcade',
      arcade: {
        debug: false,
      },
    },
  };

  const game = new Phaser.Game(config);

  // ─── CRASH MONITORING ───────────────────────────────────────
  // WebGL context loss recovery
  game.events.once('ready', () => {
    const canvas = game.canvas;
    if (canvas) {
      canvas.addEventListener('webglcontextlost', (e) => {
        e.preventDefault();
        console.error('[GPU] WebGL context lost — game will attempt recovery');
        const overlay = document.createElement('div');
        overlay.id = 'gpu-crash-overlay';
        overlay.style.cssText = 'position:fixed;inset:0;z-index:99999;background:rgba(0,0,0,0.9);display:flex;align-items:center;justify-content:center;color:#ff6b6b;font-family:sans-serif;font-size:20px;text-align:center;padding:20px;';
        overlay.innerHTML = '<div>GPU context lost.<br><small style="color:#aaa">Waiting for recovery... If nothing happens, refresh the page.</small></div>';
        document.body.appendChild(overlay);
      });
      canvas.addEventListener('webglcontextrestored', () => {
        console.log('[GPU] WebGL context restored — reloading');
        document.getElementById('gpu-crash-overlay')?.remove();
        window.location.reload();
      });
    }
  });

  // Global error handlers
  window.addEventListener('error', (e) => {
    console.error('[Global]', e.error?.stack || e.message);
  });
  window.addEventListener('unhandledrejection', (e) => {
    console.error('[Unhandled Promise]', e.reason);
  });

  // Prevent Phaser from pausing the game loop when the tab is hidden
  game.loop.sleep = () => {};

  // Prevent Phaser from suspending AudioContext when tab loses focus
  game.sound.pauseOnBlur = false;

  // Web Worker keepalive to bypass browser rAF throttling in background tabs
  const blob = new Blob(
    [`setInterval(function(){postMessage(0)},${Math.round(1000 / 60)})`],
    { type: 'text/javascript' }
  );
  const bgTimer = new Worker(URL.createObjectURL(blob));
  bgTimer.onmessage = () => {
    if (document.hidden) game.loop.step(performance.now());
  };
}

boot().catch((err) => {
  console.error('[Boot] Fatal error:', err);
  // Show game anyway as fallback so it's not a blank screen
  const container = document.getElementById('game-container');
  if (container) container.style.display = 'block';
});
