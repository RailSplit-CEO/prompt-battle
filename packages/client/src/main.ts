import Phaser from 'phaser';
import { BootScene } from './scenes/BootScene';
import { MenuScene } from './scenes/MenuScene';
import { HordeScene } from './scenes/HordeScene';
import { CharactersScene } from './scenes/CharactersScene';
import { AuthManager } from './auth/AuthManager';
import { LoginOverlay } from './ui/LoginOverlay';
import { ProfileSetupOverlay } from './ui/ProfileSetupOverlay';

async function boot() {
  // Suppress the 10s "game not started" warning — we're in the auth flow
  (window as any).__gameStarted = true;

  const auth = AuthManager.getInstance();

  // 1. Initialize Firebase + set persistence
  await auth.initFirebase();

  // 2. Check for existing session (survives reload)
  const existingUser = await auth.waitForExistingSession();

  if (!existingUser) {
    // 3. Show login screen — loop until successful sign-in
    const loginOverlay = new LoginOverlay();
    let signedIn = false;

    while (!signedIn) {
      const choice = await loginOverlay.show();

      try {
        if (choice === 'google') {
          await auth.signInWithGoogle();
        } else {
          await auth.signInAsGuest();
        }
        signedIn = true;
      } catch (err: any) {
        const msg = (err as Error).message;
        if (msg === 'POPUP_BLOCKED') {
          loginOverlay.showError('Popup blocked — please allow popups for this site and try again.');
        } else if (msg === 'POPUP_CANCELLED') {
          loginOverlay.showError(''); // clear error, user just closed the popup
        } else {
          loginOverlay.showError('Sign-in failed. Please try again.');
          console.warn('[Boot] Sign-in error:', err);
        }
        // Stay on login screen, let user retry
      }
    }

    loginOverlay.hide();
  }

  // 4. For Google users, try loading/creating profile (gracefully handle permission errors)
  if (!auth.isGuest && auth.currentUser) {
    try {
      await auth.loadMyProfile();
      if (!auth.userProfile) {
        const profileSetup = new ProfileSetupOverlay(
          (username) => auth.checkUsernameAvailable(username)
        );
        const { username, icon } = await profileSetup.show();
        await auth.createProfile(auth.currentUser.uid, username, icon, 'google');
        profileSetup.hide();
        await auth.loadMyProfile();
      }
    } catch (err) {
      console.warn('[Boot] Profile load/create failed (deploy database rules?):', err);
      // Continue without profile — social features will be unavailable
    }
  }

  // 5. Set up online presence tracking (only for users with a profile)
  if (auth.currentUser && !auth.isGuest && auth.userProfile) {
    try { auth.setupPresence(); } catch { /* non-critical */ }
  }

  // 6. Show game container BEFORE creating Phaser (needs non-zero dimensions for WebGL)
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
    scene: [BootScene, MenuScene, HordeScene, CharactersScene],
    physics: {
      default: 'arcade',
      arcade: {
        debug: false,
      },
    },
  };

  const game = new Phaser.Game(config);

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
