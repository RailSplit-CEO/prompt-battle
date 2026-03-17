import Phaser from 'phaser';
import { AuthManager } from '../auth/AuthManager';
import { FirebaseSync } from '../network/FirebaseSync';
import { Matchmaking } from '../network/Matchmaking';
import { GameSettings } from '../systems/GameSettings';
import { HORDE_SPRITE_CONFIGS } from '../sprites/SpriteConfig';
import {
  RANK_TIERS, ratingToTier, tierDisplayName, divisionProgress,
  loadRating, getDefaultRating, PlayerRating,
} from '../systems/RankSystem';

export class PvpMenuScene extends Phaser.Scene {
  private muted: boolean = GameSettings.getInstance().get('muteAll');
  private floatingShapes: { sprite: Phaser.GameObjects.Image; vx: number; vy: number; rot: number }[] = [];
  private statusText!: Phaser.GameObjects.Text;
  private matchmaking?: Matchmaking;
  private queueActive = false;
  private dotTimer?: Phaser.Time.TimerEvent;
  private pulseTween?: Phaser.Tweens.Tween;
  private cancelBtn?: { container: Phaser.GameObjects.Container; zone: Phaser.GameObjects.Zone };
  private _resizeHandler: (() => void) | null = null;
  private _resizeTimer: number | null = null;
  private _friendsList: any[] = [];

  constructor() {
    super({ key: 'PvpMenuScene' });
  }

  create() {
    // Rebuild on resize
    this._resizeHandler = () => {
      if (this._resizeTimer !== null) clearTimeout(this._resizeTimer);
      this._resizeTimer = window.setTimeout(() => { this.scene.restart(); }, 200);
    };
    this.scale.on('resize', this._resizeHandler);
    this.events.once('shutdown', () => {
      if (this._resizeHandler) this.scale.off('resize', this._resizeHandler);
      if (this._resizeTimer !== null) clearTimeout(this._resizeTimer);
      this.destroyQueueOverlay();
    });

    const { width, height } = this.cameras.main;
    const auth = AuthManager.getInstance();
    const isGuest = auth.isGuest;

    // === BACKGROUND ===
    this.cameras.main.setBackgroundColor('#0f1a0a');
    this.cameras.main.fadeIn(600, 15, 26, 10);

    const bg = this.add.graphics().setDepth(0);
    bg.fillStyle(0x0f1a0a, 1);
    bg.fillRect(0, 0, width, height);
    bg.fillStyle(0x1a2e10, 0.6);
    bg.fillCircle(width / 2, height * 0.45, Math.max(width, height) * 0.5);
    bg.fillStyle(0x243a18, 0.3);
    bg.fillCircle(width / 2, height * 0.45, Math.max(width, height) * 0.3);

    // === FLOATING DECORATIVE ICONS ===
    this.createFloatingIcons(width, height);

    // === BACKGROUND UNIT VIGNETTES ===
    this.startBackgroundVignettes();

    // === BACK BUTTON ===
    const backBtn = this.createMedievalButton(90, 36, 140, 40, '< BACK', 'yellow', false);
    backBtn.zone.on('pointerdown', () => {
      if (this.queueActive) return;
      this.cameras.main.fadeOut(300, 15, 26, 10);
      this.cameras.main.once('camerafadeoutcomplete', () => {
        this.scene.start('MenuScene');
      });
    });

    // === TITLE ===
    const titleY = height * 0.12;

    // Sword decorations flanking title
    if (this.textures.exists('ts_icon5')) {
      const swordL = this.add.image(width / 2 - 260, titleY + 5, 'ts_icon5')
        .setScale(0.85).setDepth(10).setAngle(-30).setAlpha(0);
      const swordR = this.add.image(width / 2 + 260, titleY + 5, 'ts_icon5')
        .setScale(0.85).setDepth(10).setAngle(30).setFlipX(true).setAlpha(0);
      this.tweens.add({ targets: [swordL, swordR], alpha: 0.7, duration: 800, delay: 400 });
    }

    // Title shadow
    this.add.text(width / 2 + 3, titleY + 3, 'PVP ARENA', {
      fontSize: '48px', color: '#000000', fontFamily: '"Fredoka", sans-serif', fontStyle: 'bold',
    }).setOrigin(0.5).setAlpha(0.4).setDepth(10);

    // Main title with breathing + float
    const title = this.add.text(width / 2, titleY, 'PVP ARENA', {
      fontSize: '48px', color: '#FFD93D', fontFamily: '"Fredoka", sans-serif', fontStyle: 'bold',
      stroke: '#3a2a10', strokeThickness: 6,
    }).setOrigin(0.5).setAlpha(0).setScale(0.5).setDepth(11);
    this.tweens.add({ targets: title, alpha: 1, scaleX: 1, scaleY: 1, duration: 800, ease: 'Back.easeOut' });
    this.tweens.add({
      targets: title, y: { from: titleY, to: titleY + 5 },
      duration: 2400, yoyo: true, repeat: -1, ease: 'Sine.easeInOut',
    });
    this.tweens.add({
      targets: title, scaleX: { from: 1, to: 1.012 }, scaleY: { from: 1, to: 1.012 },
      duration: 1400, yoyo: true, repeat: -1, ease: 'Sine.easeInOut', delay: 800,
    });

    // Subtitle
    const subtitle = this.add.text(width / 2, titleY + 42, 'Choose your battle mode', {
      fontSize: '15px', color: '#a89870', fontFamily: '"Nunito", sans-serif', fontStyle: 'bold',
      letterSpacing: 4, stroke: '#0a0f06', strokeThickness: 3,
    }).setOrigin(0.5).setAlpha(0).setDepth(11);
    this.tweens.add({ targets: subtitle, alpha: 0.9, duration: 600, delay: 500 });

    // Decorative divider with fade-in
    const divY = titleY + 72;
    const divLine = this.add.graphics().setDepth(10);
    divLine.lineStyle(2, 0x8B7355, 0.5);
    divLine.lineBetween(width / 2 - 140, divY, width / 2 + 140, divY);
    divLine.fillStyle(0xFFD93D, 0.7);
    const dx = width / 2, dy = divY;
    divLine.fillTriangle(dx - 5, dy, dx, dy - 5, dx + 5, dy);
    divLine.fillTriangle(dx - 5, dy, dx, dy + 5, dx + 5, dy);
    divLine.fillStyle(0x8B7355, 0.6);
    divLine.fillCircle(width / 2 - 144, divY, 3);
    divLine.fillCircle(width / 2 + 144, divY, 3);
    divLine.setAlpha(0);
    this.tweens.add({ targets: divLine, alpha: 1, duration: 600, delay: 600 });

    // Castle decorations in corners
    if (this.textures.exists('ts_icon1')) {
      this.add.image(40, height - 40, 'ts_icon1').setScale(0.5).setAlpha(0.06).setDepth(1);
      this.add.image(width - 40, height - 40, 'ts_icon1').setScale(0.5).setAlpha(0.06).setDepth(1).setFlipX(true);
    }

    // Version text
    this.add.text(width - 12, height - 8, 'v0.2.0', {
      fontSize: '10px', color: '#3a3a2a', fontFamily: '"Nunito", sans-serif',
    }).setOrigin(1, 1).setDepth(11);

    // === RANK CARD (async load) ===
    const rankCardY = divY + 55;
    const rankContainer = this.add.container(width / 2, rankCardY).setDepth(11).setAlpha(0);

    if (!isGuest) {
      this.loadAndShowRank(rankContainer);
    }

    // === MODE CARDS ===
    const cardsY = rankCardY + (isGuest ? 40 : 80);
    const cardW = 180;
    const cardGap = 24;
    const totalW = cardW * 3 + cardGap * 2;
    const startX = width / 2 - totalW / 2 + cardW / 2;

    // Unranked (always available)
    const unrankedCard = this.createModeCard(
      startX, cardsY, cardW, 'green',
      '⚔️', 'UNRANKED', 'Casual 1v1', 'No rank changes',
      false, 600,
    );
    unrankedCard.zone.on('pointerdown', () => this.startQueue('horde_unranked', 'unranked'));

    // Ranked (requires auth)
    const rankedCard = this.createModeCard(
      startX + cardW + cardGap, cardsY, cardW, 'red',
      '🏆', 'RANKED', 'Climb the', 'ladder',
      isGuest, 750,
    );
    if (!isGuest) {
      rankedCard.zone.on('pointerdown', () => this.startQueue('horde_ranked', 'ranked'));
    }

    // Friendly (requires auth)
    const friendlyCard = this.createModeCard(
      startX + (cardW + cardGap) * 2, cardsY, cardW, 'blue',
      '🤝', 'FRIENDLY', 'Challenge', 'a friend',
      isGuest, 900,
    );
    if (!isGuest) {
      friendlyCard.zone.on('pointerdown', () => this.startFriendlyBattle());
    }

    // === STATUS TEXT (for queue) ===
    this.statusText = this.add.text(width / 2, cardsY + 140, '', {
      fontSize: '16px', color: '#FFD93D', fontFamily: '"Nunito", sans-serif', fontStyle: 'bold',
      stroke: '#0a0f06', strokeThickness: 3,
    }).setOrigin(0.5).setDepth(11);

    // === KEYBOARD: ESC to go back ===
    this.input.keyboard!.on('keydown-ESC', () => {
      if (this.queueActive) {
        this.cancelQueue();
      } else {
        this.cameras.main.fadeOut(300, 15, 26, 10);
        this.cameras.main.once('camerafadeoutcomplete', () => {
          this.scene.start('MenuScene');
        });
      }
    });
  }

  // ── Rank card ──────────────────────────────────────────────────────

  private async loadAndShowRank(container: Phaser.GameObjects.Container) {
    const auth = AuthManager.getInstance();
    if (!auth.currentUser) return;

    let data: PlayerRating;
    try {
      data = await loadRating(auth.currentUser.uid) ?? getDefaultRating();
    } catch {
      data = getDefaultRating();
    }

    const tier = ratingToTier(data.rating);
    const displayName = tierDisplayName(data.rating);
    const { progress, nextLabel } = divisionProgress(data.rating);

    const cardW = 360, cardH = data.provisional ? 78 : 68;
    const tierColor = Phaser.Display.Color.HexStringToColor(tier.color).color;

    // Background with tier-colored left accent
    const bg = this.add.graphics();
    bg.fillStyle(0x243a18, 0.85);
    bg.fillRoundedRect(-cardW / 2, -cardH / 2, cardW, cardH, 10);
    // Tier color left bar
    bg.fillStyle(tierColor, 0.8);
    bg.fillRoundedRect(-cardW / 2, -cardH / 2, 5, cardH, { tl: 10, bl: 10, tr: 0, br: 0 });
    bg.lineStyle(2, 0x5a9a4e, 0.6);
    bg.strokeRoundedRect(-cardW / 2, -cardH / 2, cardW, cardH, 10);
    container.add(bg);

    // Emoji + tier name with glow
    const tierText = this.add.text(-cardW / 2 + 20, -12, `${tier.emoji} ${displayName}`, {
      fontSize: '18px', color: tier.color, fontFamily: '"Fredoka", sans-serif', fontStyle: 'bold',
      stroke: '#000', strokeThickness: 2, padding: { top: 2, bottom: 2 },
    }).setOrigin(0, 0.5);
    container.add(tierText);

    // Rating number + peak
    let rpLabel = `${data.rating} RP`;
    if (data.peakRating > data.rating) rpLabel += `  (Peak: ${data.peakRating})`;
    const rpText = this.add.text(cardW / 2 - 16, -12, rpLabel, {
      fontSize: '15px', color: '#d4c8a0', fontFamily: '"Nunito", sans-serif', fontStyle: 'bold',
      stroke: '#000', strokeThickness: 2,
    }).setOrigin(1, 0.5);
    container.add(rpText);

    // Progress bar (thicker)
    const barW = cardW - 40, barH = 8, barX = -cardW / 2 + 20, barY = 6;
    const barBg = this.add.graphics();
    barBg.fillStyle(0x000000, 0.3);
    barBg.fillRoundedRect(barX, barY, barW, barH, 4);
    barBg.fillStyle(tierColor, 0.85);
    barBg.fillRoundedRect(barX, barY, Math.max(2, barW * progress), barH, 4);
    container.add(barBg);

    // Bottom row: W/L + next label + provisional
    const bottomY = barY + barH + 4;
    const bottomParts: string[] = [];
    if (data.gamesPlayed > 0) {
      const wr = Math.round(100 * data.wins / data.gamesPlayed);
      bottomParts.push(`${data.wins}W ${data.losses}L (${wr}%)`);
    }
    if (data.streak > 2) bottomParts.push(`🔥${data.streak}`);
    if (data.streak < -2) bottomParts.push(`💀${Math.abs(data.streak)}`);

    if (bottomParts.length > 0) {
      const wl = this.add.text(-cardW / 2 + 20, bottomY, bottomParts.join('  '), {
        fontSize: '10px', color: '#7a6e56', fontFamily: '"Nunito", sans-serif',
      }).setOrigin(0, 0);
      container.add(wl);
    }

    if (nextLabel) {
      const nextText = this.add.text(cardW / 2 - 16, bottomY, `→ ${nextLabel}`, {
        fontSize: '10px', color: '#7a6e56', fontFamily: '"Nunito", sans-serif',
      }).setOrigin(1, 0);
      container.add(nextText);
    }

    // Provisional indicator
    if (data.provisional) {
      const provText = this.add.text(0, bottomY + 14, `🔄 Provisional (${data.gamesPlayed}/10 placement games)`, {
        fontSize: '10px', color: '#a89870', fontFamily: '"Nunito", sans-serif', fontStyle: '600',
      }).setOrigin(0.5, 0);
      container.add(provText);
    }

    // Scale + fade in animation
    container.setScale(0.8);
    this.tweens.add({
      targets: container, alpha: 1, scaleX: 1, scaleY: 1,
      duration: 600, delay: 300, ease: 'Back.easeOut',
    });
  }

  // ── Mode cards ─────────────────────────────────────────────────────

  private createModeCard(
    x: number, y: number, w: number, color: 'green' | 'red' | 'blue',
    emoji: string, title: string, desc1: string, desc2: string,
    locked: boolean, delay: number,
  ): { container: Phaser.GameObjects.Container; zone: Phaser.GameObjects.Zone } {
    const h = 200;
    const container = this.add.container(x, y).setDepth(12).setAlpha(0).setScale(0.8);

    const schemes = {
      green:  { fill: 0x3a6a2e, border: 0x5a9a4e, highlight: 0x8BC47A },
      red:    { fill: 0x8B3333, border: 0xBB4444, highlight: 0xDD6666 },
      blue:   { fill: 0x2a5a8a, border: 0x4a8aBB, highlight: 0x6aAADD },
    };
    const s = schemes[color];

    // Shadow
    const shadow = this.add.graphics();
    shadow.fillStyle(0x000000, 0.5);
    shadow.fillRoundedRect(-w / 2 + 3, -h / 2 + 3, w, h, 10);
    container.add(shadow);

    // Background with inner glow
    const bg = this.add.graphics();
    bg.fillStyle(s.fill, locked ? 0.4 : 0.92);
    bg.fillRoundedRect(-w / 2, -h / 2, w, h, 10);
    bg.fillStyle(s.highlight, locked ? 0.03 : 0.08);
    bg.fillRoundedRect(-w / 2 + 4, -h / 2 + 3, w - 8, h / 4, 6);
    bg.lineStyle(2, s.border, locked ? 0.3 : 0.8);
    bg.strokeRoundedRect(-w / 2, -h / 2, w, h, 10);
    // Inner glow line
    bg.lineStyle(1, s.highlight, locked ? 0.05 : 0.15);
    bg.strokeRoundedRect(-w / 2 + 2, -h / 2 + 2, w - 4, h - 4, 8);
    container.add(bg);

    // Corner rivets
    if (!locked) {
      const rivets = this.add.graphics();
      const rivetPositions = [
        [-w / 2 + 10, -h / 2 + 10], [w / 2 - 10, -h / 2 + 10],
        [-w / 2 + 10, h / 2 - 10], [w / 2 - 10, h / 2 - 10],
      ];
      for (const [rx, ry] of rivetPositions) {
        rivets.fillStyle(0x000000, 0.4);
        rivets.fillCircle(rx + 1, ry + 1, 2.5);
        rivets.fillStyle(0x8B7355, 0.9);
        rivets.fillCircle(rx, ry, 2.5);
        rivets.fillStyle(0xffffff, 0.2);
        rivets.fillCircle(rx - 0.5, ry - 0.5, 1);
      }
      container.add(rivets);
    }

    // Emoji icon (padding prevents vertical clipping)
    const icon = this.add.text(0, -h / 2 + 40, emoji, {
      fontSize: '38px', padding: { top: 4, bottom: 4 },
    }).setOrigin(0.5).setAlpha(locked ? 0.3 : 1);
    container.add(icon);

    // Title
    const titleText = this.add.text(0, -h / 2 + 82, title, {
      fontSize: '20px', color: locked ? '#666' : '#e8e0c8',
      fontFamily: '"Fredoka", sans-serif', fontStyle: 'bold',
      stroke: '#000', strokeThickness: 3, letterSpacing: 1,
    }).setOrigin(0.5);
    container.add(titleText);

    // Description lines
    const d1 = this.add.text(0, -h / 2 + 110, desc1, {
      fontSize: '13px', color: locked ? '#555' : '#a89870',
      fontFamily: '"Nunito", sans-serif', fontStyle: '600',
    }).setOrigin(0.5);
    container.add(d1);
    const d2 = this.add.text(0, -h / 2 + 128, desc2, {
      fontSize: '13px', color: locked ? '#555' : '#a89870',
      fontFamily: '"Nunito", sans-serif', fontStyle: '600',
    }).setOrigin(0.5);
    container.add(d2);

    // Lock overlay for guests
    if (locked) {
      const lockText = this.add.text(0, h / 2 - 28, '🔒 Sign in required', {
        fontSize: '11px', color: '#FF6B6B', fontFamily: '"Nunito", sans-serif', fontStyle: 'bold',
        stroke: '#000', strokeThickness: 2, padding: { top: 2, bottom: 2 },
      }).setOrigin(0.5);
      container.add(lockText);
    }

    // Animate in
    this.tweens.add({
      targets: container, alpha: locked ? 0.5 : 1, scaleX: 1, scaleY: 1,
      duration: 600, delay, ease: 'Back.easeOut',
    });

    // Idle breathing for unlocked cards
    if (!locked) {
      this.tweens.add({
        targets: container,
        scaleX: { from: 1, to: 1.012 }, scaleY: { from: 1, to: 1.012 },
        duration: 1600, yoyo: true, repeat: -1, ease: 'Sine.easeInOut',
        delay: delay + 600,
      });
    }

    // Interactive zone
    const zone = this.add.zone(x, y, w, h).setInteractive({ useHandCursor: !locked }).setDepth(13);

    if (!locked) {
      zone.on('pointerover', () => {
        this.playsfx('button_click', 0.12);
        this.tweens.add({ targets: container, scaleX: 1.05, scaleY: 1.05, duration: 150, ease: 'Back.easeOut' });
        bg.clear();
        bg.fillStyle(s.highlight, 0.35);
        bg.fillRoundedRect(-w / 2, -h / 2, w, h, 10);
        bg.fillStyle(0xffffff, 0.06);
        bg.fillRoundedRect(-w / 2 + 4, -h / 2 + 3, w - 8, h / 4, 6);
        bg.lineStyle(2, 0xFFD93D, 0.9);
        bg.strokeRoundedRect(-w / 2, -h / 2, w, h, 10);
        bg.lineStyle(1, s.highlight, 0.2);
        bg.strokeRoundedRect(-w / 2 + 2, -h / 2 + 2, w - 4, h - 4, 8);
        titleText.setColor('#FFD93D');
      });
      zone.on('pointerout', () => {
        this.tweens.add({ targets: container, scaleX: 1, scaleY: 1, duration: 150 });
        bg.clear();
        bg.fillStyle(s.fill, 0.92);
        bg.fillRoundedRect(-w / 2, -h / 2, w, h, 10);
        bg.fillStyle(s.highlight, 0.08);
        bg.fillRoundedRect(-w / 2 + 4, -h / 2 + 3, w - 8, h / 4, 6);
        bg.lineStyle(2, s.border, 0.8);
        bg.strokeRoundedRect(-w / 2, -h / 2, w, h, 10);
        bg.lineStyle(1, s.highlight, 0.15);
        bg.strokeRoundedRect(-w / 2 + 2, -h / 2 + 2, w - 4, h - 4, 8);
        titleText.setColor(locked ? '#666' : '#e8e0c8');
      });
      zone.on('pointerdown', () => {
        this.playsfx('button_click', 0.4);
        this.tweens.add({ targets: container, scaleX: 0.94, scaleY: 0.94, duration: 60, yoyo: true });
      });
    }

    return { container, zone };
  }

  // ── Queue flow — full-screen queue overlay with accept popup ────────

  private queueOverlay: HTMLDivElement | null = null;

  private async startQueue(queueName: string, matchType: 'unranked' | 'ranked') {
    if (this.queueActive) return;
    this.queueActive = true;

    const isRanked = matchType === 'ranked';

    // Build full-screen queue overlay (DOM)
    this.showQueueScreen(isRanked);

    try {
      const firebase = FirebaseSync.getInstance();
      await firebase.initialize();

      this.matchmaking = new Matchmaking(firebase, queueName);
      const matchResult = await this.matchmaking.joinQueue();

      if (!this.queueActive) return; // cancelled while waiting

      if (matchResult.gameId) {
        // Fetch opponent info
        let opponentUid: string | undefined;
        let opponentName = 'Opponent';
        let opponentRating: number | undefined;
        try {
          const meta = await firebase.getGameMeta(matchResult.gameId);
          opponentUid = matchResult.amPlayer1 ? meta.player2 : meta.player1;
          if (opponentUid) {
            const auth = AuthManager.getInstance();
            const [profile, rating] = await Promise.all([
              auth.getProfile(opponentUid),
              auth.getRating(opponentUid),
            ]);
            if (profile) opponentName = profile.username;
            if (rating) opponentRating = rating.rating;
          }
        } catch { /* non-critical */ }

        // Show accept popup (LoL style)
        const accepted = await this.showAcceptPopup(opponentName, opponentRating);

        if (accepted) {
          this.playsfx('wave_start', 0.5);
          this.destroyQueueOverlay();
          this.cameras.main.flash(300, 107, 155, 94, false);

          this.time.delayedCall(400, () => {
            this.cameras.main.fadeOut(400, 15, 26, 10);
            this.cameras.main.once('camerafadeoutcomplete', () => {
              this.scene.start('HordeScene', {
                isOnline: true,
                gameId: matchResult.gameId,
                playerId: firebase.getPlayerId(),
                amPlayer1: matchResult.amPlayer1,
                opponentUid,
                matchType,
                isRanked,
              });
            });
          });
        } else {
          // Declined — leave the game
          this.cancelQueue();
        }
      }
    } catch (err) {
      this.destroyQueueOverlay();
      this.queueActive = false;
      this.statusText.setText('Error: ' + (err as Error).message);
      this.statusText.setColor('#BB4444');
      this.statusText.setAlpha(1);
    }
  }

  private showQueueScreen(isRanked: boolean) {
    this.destroyQueueOverlay();

    const overlay = document.createElement('div');
    overlay.id = 'pvp-queue-overlay';
    overlay.style.cssText = `
      position:fixed;inset:0;z-index:9998;
      background:rgba(5,8,3,0.88);
      backdrop-filter:blur(20px);-webkit-backdrop-filter:blur(20px);
      display:flex;flex-direction:column;align-items:center;justify-content:center;
      font-family:'Nunito',sans-serif;
      opacity:0;transition:opacity 0.4s ease;
    `;

    // Timer
    let elapsed = 0;
    const timerEl = document.createElement('div');
    timerEl.style.cssText = 'font-size:42px;font-weight:800;color:#FFD93D;font-family:"Fredoka",sans-serif;letter-spacing:2px;margin-bottom:8px;';
    timerEl.textContent = '0:00';

    // Label
    const label = document.createElement('div');
    label.style.cssText = 'font-size:16px;color:#a89870;letter-spacing:3px;text-transform:uppercase;margin-bottom:6px;';
    label.textContent = isRanked ? 'SEARCHING FOR RANKED MATCH' : 'SEARCHING FOR MATCH';

    // Animated dots
    const dotsEl = document.createElement('div');
    dotsEl.style.cssText = 'font-size:28px;color:#5a9a4e;letter-spacing:8px;margin-bottom:40px;height:32px;';

    // Pulsing ring animation
    const ring = document.createElement('div');
    ring.style.cssText = `
      width:120px;height:120px;border-radius:50%;
      border:3px solid rgba(255,217,61,0.3);
      box-shadow:0 0 30px rgba(255,217,61,0.1),inset 0 0 30px rgba(255,217,61,0.05);
      display:flex;align-items:center;justify-content:center;
      margin-bottom:32px;
      animation:pvq-pulse 2s ease-in-out infinite;
    `;
    const ringIcon = document.createElement('div');
    ringIcon.style.cssText = 'font-size:48px;';
    ringIcon.textContent = isRanked ? '🏆' : '⚔️';
    ring.appendChild(ringIcon);

    // Cancel button
    const cancelBtn = document.createElement('button');
    cancelBtn.textContent = 'CANCEL';
    cancelBtn.style.cssText = `
      padding:14px 48px;border-radius:10px;cursor:pointer;
      background:rgba(139,51,51,0.6);border:2px solid rgba(187,68,68,0.7);
      color:#FF6B6B;font-family:'Fredoka',sans-serif;font-size:16px;font-weight:700;
      letter-spacing:2px;text-transform:uppercase;
      transition:all 0.2s ease;
      box-shadow:0 4px 16px rgba(0,0,0,0.3);
    `;
    cancelBtn.onmouseenter = () => {
      cancelBtn.style.background = 'rgba(180,60,60,0.8)';
      cancelBtn.style.borderColor = '#FF6B6B';
      cancelBtn.style.transform = 'scale(1.05)';
    };
    cancelBtn.onmouseleave = () => {
      cancelBtn.style.background = 'rgba(139,51,51,0.6)';
      cancelBtn.style.borderColor = 'rgba(187,68,68,0.7)';
      cancelBtn.style.transform = 'scale(1)';
    };
    cancelBtn.onclick = () => this.cancelQueue();

    // Tip text
    const tip = document.createElement('div');
    tip.style.cssText = 'font-size:11px;color:#5a6a4a;margin-top:16px;';
    tip.textContent = 'Press ESC to cancel';

    // Inject pulse animation
    if (!document.getElementById('pvq-styles')) {
      const style = document.createElement('style');
      style.id = 'pvq-styles';
      style.textContent = `
        @keyframes pvq-pulse {
          0%,100% { transform:scale(1); border-color:rgba(255,217,61,0.3); box-shadow:0 0 30px rgba(255,217,61,0.1),inset 0 0 30px rgba(255,217,61,0.05); }
          50% { transform:scale(1.08); border-color:rgba(255,217,61,0.6); box-shadow:0 0 50px rgba(255,217,61,0.2),inset 0 0 40px rgba(255,217,61,0.1); }
        }
        @keyframes pvq-accept-pulse {
          0%,100% { box-shadow:0 0 20px rgba(90,154,78,0.3); }
          50% { box-shadow:0 0 40px rgba(90,154,78,0.6); }
        }
        @keyframes ladder-glow {
          0%,100% { box-shadow:inset 3px 0 0 rgba(255,217,61,0.4); }
          50% { box-shadow:inset 3px 0 0 rgba(255,217,61,0.8); }
        }
        #ladder-sidebar {
          position:absolute;right:24px;top:50%;transform:translateY(-50%);
          width:260px;max-height:80vh;
          background:rgba(18,22,14,0.94);
          border:2px solid rgba(139,115,85,0.45);
          border-radius:16px;
          backdrop-filter:blur(16px);-webkit-backdrop-filter:blur(16px);
          box-shadow:0 12px 48px rgba(0,0,0,0.6);
          display:flex;flex-direction:column;
          font-family:'Nunito',sans-serif;
          opacity:0;transition:opacity 0.6s ease 0.3s;
        }
        #ladder-sidebar.visible { opacity:1; }
        .ladder-header {
          padding:14px 16px 10px;font-size:13px;font-weight:800;
          color:#FFD93D;letter-spacing:3px;text-transform:uppercase;
          font-family:'Fredoka',sans-serif;
          border-bottom:1px solid rgba(139,115,85,0.25);
          flex-shrink:0;
        }
        .ladder-scroll {
          flex:1;overflow-y:auto;overflow-x:hidden;padding:4px 0;
          scrollbar-width:thin;scrollbar-color:rgba(139,115,85,0.5) rgba(139,115,85,0.15);
        }
        .ladder-scroll::-webkit-scrollbar { width:5px; }
        .ladder-scroll::-webkit-scrollbar-track { background:rgba(139,115,85,0.15);border-radius:3px; }
        .ladder-scroll::-webkit-scrollbar-thumb { background:rgba(139,115,85,0.5);border-radius:3px; }
        .tier-header {
          display:flex;align-items:center;gap:8px;
          padding:8px 12px;
          border-bottom:1px solid rgba(139,115,85,0.18);
          position:sticky;top:0;
          background:rgba(18,22,14,0.96);
          z-index:1;
        }
        .tier-bar { width:4px;height:20px;border-radius:2px;flex-shrink:0; }
        .tier-name { font-size:13px;font-weight:700;font-family:'Fredoka',sans-serif;text-shadow:0 0 8px currentColor; }
        .tier-count { font-size:10px;color:#7a6e56;margin-left:auto; }
        .ladder-player {
          display:flex;align-items:center;gap:8px;
          padding:6px 12px 6px 20px;
          transition:background 0.15s ease;
          position:relative;
        }
        .ladder-player:hover { background:rgba(255,248,230,0.05); }
        .ladder-player.is-me {
          background:rgba(255,217,61,0.08);
          animation:ladder-glow 2s ease-in-out infinite;
        }
        .lp-online { width:6px;height:6px;border-radius:50%;flex-shrink:0; }
        .lp-icon { width:22px;height:22px;border-radius:50%;object-fit:cover;border:1px solid rgba(139,115,85,0.3); }
        .lp-name { font-size:12px;font-weight:600;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap; }
        .lp-rating { font-size:11px;color:#7a6e56;font-weight:600;flex-shrink:0; }
        .lp-badge { font-size:9px;color:#a89870;margin-left:4px; }
        .ladder-footer {
          padding:10px 14px;flex-shrink:0;
          border-top:1px solid rgba(139,115,85,0.25);
          background:rgba(255,248,230,0.04);
          border-radius:0 0 14px 14px;
          display:flex;flex-wrap:wrap;gap:8px;
          font-size:11px;color:#7a6e56;
        }
        .ladder-footer span { white-space:nowrap; }
        .lf-highlight { color:#d4c8a0;font-weight:700; }
      `;
      document.head.appendChild(style);
    }

    overlay.appendChild(ring);
    overlay.appendChild(timerEl);
    overlay.appendChild(label);
    overlay.appendChild(dotsEl);
    overlay.appendChild(cancelBtn);
    overlay.appendChild(tip);
    document.body.appendChild(overlay);
    this.queueOverlay = overlay;

    // Ladder sidebar (ranked only, wide screens)
    if (isRanked && this.cameras.main.width >= 900) {
      this.buildLadderSidebar(overlay);
    }

    // Fade in
    requestAnimationFrame(() => { overlay.style.opacity = '1'; });

    // Timer + dots update
    let dotCount = 0;
    const interval = setInterval(() => {
      if (!this.queueOverlay) { clearInterval(interval); return; }
      elapsed++;
      const m = Math.floor(elapsed / 60);
      const s = elapsed % 60;
      timerEl.textContent = `${m}:${s.toString().padStart(2, '0')}`;
      dotCount = (dotCount + 1) % 4;
      dotsEl.textContent = '●'.repeat(dotCount + 1) + '○'.repeat(3 - dotCount);
      // Queue milestone messages
      if (elapsed === 30) label.textContent = 'EXPANDING SEARCH RANGE...';
      else if (elapsed === 60) label.textContent = 'STILL SEARCHING — HANG TIGHT';
      else if (elapsed === 120) { label.textContent = 'LONG QUEUE — CONSIDER TRYING LATER'; label.style.color = '#FF6B6B'; }
    }, 1000);
  }

  private showInviteScreen(friendName: string) {
    this.destroyQueueOverlay();

    const overlay = document.createElement('div');
    overlay.id = 'pvp-queue-overlay';
    overlay.style.cssText = `
      position:fixed;inset:0;z-index:9998;
      background:rgba(5,8,3,0.88);
      backdrop-filter:blur(20px);-webkit-backdrop-filter:blur(20px);
      display:flex;flex-direction:column;align-items:center;justify-content:center;
      font-family:'Nunito',sans-serif;
      opacity:0;transition:opacity 0.4s ease;
    `;

    // Timer
    let elapsed = 0;
    const timerEl = document.createElement('div');
    timerEl.style.cssText = 'font-size:42px;font-weight:800;color:#FFD93D;font-family:"Fredoka",sans-serif;letter-spacing:2px;margin-bottom:8px;';
    timerEl.textContent = '0:00';

    // Label
    const label = document.createElement('div');
    label.style.cssText = 'font-size:16px;color:#a89870;letter-spacing:3px;text-transform:uppercase;margin-bottom:6px;';
    label.textContent = `INVITING ${friendName.toUpperCase()}`;

    // Animated dots
    const dotsEl = document.createElement('div');
    dotsEl.style.cssText = 'font-size:28px;color:#4a8aBB;letter-spacing:8px;margin-bottom:40px;height:32px;';

    // Pulsing ring animation
    const ring = document.createElement('div');
    ring.style.cssText = `
      width:120px;height:120px;border-radius:50%;
      border:3px solid rgba(74,138,187,0.3);
      box-shadow:0 0 30px rgba(74,138,187,0.1),inset 0 0 30px rgba(74,138,187,0.05);
      display:flex;align-items:center;justify-content:center;
      margin-bottom:32px;
      animation:pvq-invite-pulse 2s ease-in-out infinite;
    `;
    const ringIcon = document.createElement('div');
    ringIcon.style.cssText = 'font-size:48px;';
    ringIcon.textContent = '🤝';
    ring.appendChild(ringIcon);

    // Cancel button
    const cancelBtn = document.createElement('button');
    cancelBtn.textContent = 'CANCEL';
    cancelBtn.style.cssText = `
      padding:14px 48px;border-radius:10px;cursor:pointer;
      background:rgba(139,51,51,0.6);border:2px solid rgba(187,68,68,0.7);
      color:#FF6B6B;font-family:'Fredoka',sans-serif;font-size:16px;font-weight:700;
      letter-spacing:2px;text-transform:uppercase;
      transition:all 0.2s ease;
      box-shadow:0 4px 16px rgba(0,0,0,0.3);
    `;
    cancelBtn.onmouseenter = () => {
      cancelBtn.style.background = 'rgba(180,60,60,0.8)';
      cancelBtn.style.borderColor = '#FF6B6B';
      cancelBtn.style.transform = 'scale(1.05)';
    };
    cancelBtn.onmouseleave = () => {
      cancelBtn.style.background = 'rgba(139,51,51,0.6)';
      cancelBtn.style.borderColor = 'rgba(187,68,68,0.7)';
      cancelBtn.style.transform = 'scale(1)';
    };
    cancelBtn.onclick = () => {
      this.destroyQueueOverlay();
      this.cleanupQueue();
      this.statusText.setText('Invite cancelled');
      this.statusText.setColor('#a89870');
    };

    // Tip text
    const tip = document.createElement('div');
    tip.style.cssText = 'font-size:11px;color:#5a6a4a;margin-top:16px;';
    tip.textContent = 'Press ESC to cancel';

    // Inject invite pulse animation
    if (!document.getElementById('pvq-invite-styles')) {
      const style = document.createElement('style');
      style.id = 'pvq-invite-styles';
      style.textContent = `
        @keyframes pvq-invite-pulse {
          0%,100% { transform:scale(1); border-color:rgba(74,138,187,0.3); box-shadow:0 0 30px rgba(74,138,187,0.1),inset 0 0 30px rgba(74,138,187,0.05); }
          50% { transform:scale(1.08); border-color:rgba(74,138,187,0.6); box-shadow:0 0 50px rgba(74,138,187,0.2),inset 0 0 40px rgba(74,138,187,0.1); }
        }
      `;
      document.head.appendChild(style);
    }

    overlay.appendChild(ring);
    overlay.appendChild(timerEl);
    overlay.appendChild(label);
    overlay.appendChild(dotsEl);
    overlay.appendChild(cancelBtn);
    overlay.appendChild(tip);
    document.body.appendChild(overlay);
    this.queueOverlay = overlay;

    // ESC to cancel
    const escHandler = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && this.queueOverlay === overlay) {
        window.removeEventListener('keydown', escHandler);
        this.destroyQueueOverlay();
        this.cleanupQueue();
        this.statusText.setText('Invite cancelled');
        this.statusText.setColor('#a89870');
      }
    };
    window.addEventListener('keydown', escHandler);

    // Fade in
    requestAnimationFrame(() => { overlay.style.opacity = '1'; });

    // Timer + dots update
    let dotCount = 0;
    const interval = setInterval(() => {
      if (!this.queueOverlay || this.queueOverlay !== overlay) { clearInterval(interval); window.removeEventListener('keydown', escHandler); return; }
      elapsed++;
      const m = Math.floor(elapsed / 60);
      const s = elapsed % 60;
      timerEl.textContent = `${m}:${s.toString().padStart(2, '0')}`;
      dotCount = (dotCount + 1) % 4;
      dotsEl.textContent = '●'.repeat(dotCount + 1) + '○'.repeat(3 - dotCount);
      if (elapsed === 30) label.textContent = 'WAITING FOR RESPONSE...';
      else if (elapsed === 50) label.textContent = 'INVITE EXPIRING SOON...';
    }, 1000);
  }

  private async buildLadderSidebar(overlay: HTMLDivElement) {
    const auth = AuthManager.getInstance();
    if (!auth.currentUser) return;
    const myUid = auth.currentUser.uid;

    // Sidebar container
    const sidebar = document.createElement('div');
    sidebar.id = 'ladder-sidebar';

    // Header
    const header = document.createElement('div');
    header.className = 'ladder-header';
    header.textContent = 'RANKED LADDER';
    sidebar.appendChild(header);

    // Scroll area
    const scroll = document.createElement('div');
    scroll.className = 'ladder-scroll';
    sidebar.appendChild(scroll);

    // Footer (filled after data loads)
    const footer = document.createElement('div');
    footer.className = 'ladder-footer';
    sidebar.appendChild(footer);

    overlay.appendChild(sidebar);

    // Show with delay
    requestAnimationFrame(() => { sidebar.classList.add('visible'); });

    // Load data
    let myRating: PlayerRating;
    try {
      myRating = await loadRating(myUid) ?? getDefaultRating();
    } catch {
      myRating = getDefaultRating();
    }

    // Load friends + their ratings
    interface LadderEntry { uid: string; name: string; icon: string; rating: number; online: boolean; isMe: boolean }
    const entries: LadderEntry[] = [];

    // Add self
    entries.push({
      uid: myUid,
      name: auth.userProfile?.username || 'You',
      icon: auth.userProfile?.icon || 'gnome',
      rating: myRating.rating,
      online: true,
      isMe: true,
    });

    // Load friend ratings
    try {
      const friendsPromise = new Promise<void>((resolve) => {
        const unsub = auth.onFriendsChanged(async (friends) => {
          unsub();
          const accepted = friends.filter(f => f.status === 'accepted');
          const ratingPromises = accepted.map(async (f) => {
            try {
              const r = await auth.getRating(f.uid);
              if (r) {
                entries.push({
                  uid: f.uid,
                  name: f.username,
                  icon: f.icon,
                  rating: r.rating,
                  online: f.online,
                  isMe: false,
                });
              }
            } catch { /* skip */ }
          });
          await Promise.all(ratingPromises);
          resolve();
        });
        // Timeout after 5s
        setTimeout(resolve, 5000);
      });
      await friendsPromise;
    } catch { /* continue with just self */ }

    // Build tier → players map (reverse order: Legend first)
    const reversedTiers = [...RANK_TIERS].reverse();
    scroll.innerHTML = '';

    for (const tier of reversedTiers) {
      const tierPlayers = entries
        .filter(e => {
          const t = ratingToTier(e.rating);
          return t.name === tier.name;
        })
        .sort((a, b) => b.rating - a.rating);

      // Tier header
      const tierDiv = document.createElement('div');
      const th = document.createElement('div');
      th.className = 'tier-header';

      const bar = document.createElement('div');
      bar.className = 'tier-bar';
      bar.style.background = tier.color;
      th.appendChild(bar);

      const emoji = document.createElement('span');
      emoji.textContent = tier.emoji;
      emoji.style.fontSize = '16px';
      th.appendChild(emoji);

      const name = document.createElement('span');
      name.className = 'tier-name';
      name.style.color = tier.color;
      name.textContent = tier.name;
      th.appendChild(name);

      if (tierPlayers.length > 0) {
        const count = document.createElement('span');
        count.className = 'tier-count';
        count.textContent = `${tierPlayers.length}`;
        th.appendChild(count);
      }

      tierDiv.appendChild(th);

      // Players in this tier
      for (const p of tierPlayers) {
        const row = document.createElement('div');
        row.className = 'ladder-player' + (p.isMe ? ' is-me' : '');

        // Online dot
        const dot = document.createElement('div');
        dot.className = 'lp-online';
        dot.style.background = p.online ? '#45E6B0' : 'rgba(139,115,85,0.3)';
        row.appendChild(dot);

        // Avatar
        const avatarPath = `assets/enemies/avatars/${p.icon}.png`;
        const img = document.createElement('img');
        img.className = 'lp-icon';
        img.src = avatarPath;
        img.onerror = () => { img.style.display = 'none'; };
        row.appendChild(img);

        // Name
        const nameEl = document.createElement('span');
        nameEl.className = 'lp-name';
        nameEl.style.color = p.isMe ? '#FFD93D' : '#d4c8a0';
        nameEl.textContent = p.isMe ? `★ ${p.name}` : p.name;
        row.appendChild(nameEl);

        // Rating
        const ratingEl = document.createElement('span');
        ratingEl.className = 'lp-rating';
        ratingEl.textContent = `${p.rating}`;
        row.appendChild(ratingEl);

        // Extra badges for self
        if (p.isMe) {
          if (myRating.streak > 2) {
            const streak = document.createElement('span');
            streak.className = 'lp-badge';
            streak.style.color = '#FF6B6B';
            streak.textContent = `🔥${myRating.streak}`;
            row.appendChild(streak);
          }
          if (myRating.peakRating > myRating.rating) {
            const peak = document.createElement('span');
            peak.className = 'lp-badge';
            peak.textContent = `Peak: ${myRating.peakRating}`;
            row.appendChild(peak);
          }

          // Progress bar for self
          const { progress } = divisionProgress(myRating.rating);
          if (progress > 0) {
            const progBar = document.createElement('div');
            progBar.style.cssText = `
              position:absolute;bottom:1px;left:20px;right:12px;height:2px;
              background:rgba(139,115,85,0.2);border-radius:1px;
            `;
            const progFill = document.createElement('div');
            progFill.style.cssText = `
              height:100%;border-radius:1px;
              background:rgba(255,217,61,0.5);
              width:${Math.round(progress * 100)}%;
            `;
            progBar.appendChild(progFill);
            row.appendChild(progBar);
          }
        }

        tierDiv.appendChild(row);
      }

      scroll.appendChild(tierDiv);
    }

    // Footer — your stats
    const wr = myRating.gamesPlayed > 0 ? Math.round(100 * myRating.wins / myRating.gamesPlayed) : 0;
    footer.innerHTML = `
      <span><span class="lf-highlight">${myRating.wins}W</span> ${myRating.losses}L</span>
      <span>${wr}% WR</span>
      ${myRating.streak > 0 ? `<span>🔥 ${myRating.streak} streak</span>` : ''}
      ${myRating.streak < -1 ? `<span>💀 ${Math.abs(myRating.streak)} losses</span>` : ''}
      <span>Peak: <span class="lf-highlight">${myRating.peakRating}</span></span>
    `;

    // Auto-scroll to player's position
    requestAnimationFrame(() => {
      const meEl = scroll.querySelector('.is-me');
      if (meEl) meEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
    });
  }

  private showAcceptPopup(opponentName: string, opponentRating?: number): Promise<boolean> {
    return new Promise((resolve) => {
      const overlay = this.queueOverlay;
      if (!overlay) { resolve(true); return; }

      // Smooth transition: fade content out, then replace
      overlay.style.transition = 'background 0.3s ease';
      overlay.innerHTML = '';
      overlay.style.background = 'rgba(5,8,3,0.92)';

      // Accept container
      const popup = document.createElement('div');
      popup.style.cssText = `
        display:flex;flex-direction:column;align-items:center;
        background:rgba(18,22,14,0.95);
        border:2px solid rgba(90,154,78,0.6);
        border-radius:16px;padding:36px 48px;
        box-shadow:0 0 60px rgba(90,154,78,0.2),0 12px 48px rgba(0,0,0,0.6);
        animation:pvq-accept-pulse 1.5s ease-in-out infinite;
        font-family:'Nunito',sans-serif;
      `;

      // "MATCH FOUND" header
      const header = document.createElement('div');
      header.style.cssText = 'font-size:32px;font-weight:800;color:#5a9a4e;font-family:"Fredoka",sans-serif;letter-spacing:3px;margin-bottom:8px;';
      header.textContent = 'MATCH FOUND';
      popup.appendChild(header);

      // Opponent name + rating
      const opp = document.createElement('div');
      opp.style.cssText = 'font-size:16px;color:#a89870;margin-bottom:8px;';
      opp.textContent = `vs ${opponentName}`;
      popup.appendChild(opp);

      // Opponent tier badge (if rating available)
      if (opponentRating !== undefined) {
        const oppTier = ratingToTier(opponentRating);
        const oppTierName = tierDisplayName(opponentRating);
        const badge = document.createElement('div');
        badge.style.cssText = `
          font-size:13px;color:${oppTier.color};font-weight:700;
          font-family:'Fredoka',sans-serif;margin-bottom:20px;
          text-shadow:0 0 8px ${oppTier.color}40;
        `;
        badge.textContent = `${oppTier.emoji} ${oppTierName} — ${opponentRating} RP`;
        popup.appendChild(badge);
      } else {
        const spacer = document.createElement('div');
        spacer.style.marginBottom = '20px';
        popup.appendChild(spacer);
      }

      // Countdown ring
      let timeLeft = 10;
      const countdown = document.createElement('div');
      countdown.style.cssText = `
        width:80px;height:80px;border-radius:50%;
        border:3px solid #5a9a4e;
        display:flex;align-items:center;justify-content:center;
        font-size:32px;font-weight:800;color:#FFD93D;font-family:"Fredoka",sans-serif;
        margin-bottom:24px;
        transition:border-color 0.3s ease;
      `;
      countdown.textContent = `${timeLeft}`;
      popup.appendChild(countdown);

      // Accept button
      const acceptBtn = document.createElement('button');
      acceptBtn.textContent = 'ACCEPT';
      acceptBtn.style.cssText = `
        padding:14px 56px;border-radius:10px;cursor:pointer;
        background:rgba(58,106,46,0.8);border:2px solid rgba(90,154,78,0.8);
        color:#e8e0c8;font-family:'Fredoka',sans-serif;font-size:18px;font-weight:700;
        letter-spacing:2px;text-transform:uppercase;
        transition:all 0.2s ease;margin-bottom:12px;
        box-shadow:0 4px 20px rgba(90,154,78,0.3);
      `;
      acceptBtn.onmouseenter = () => {
        acceptBtn.style.background = 'rgba(90,154,78,0.9)';
        acceptBtn.style.transform = 'scale(1.06)';
        acceptBtn.style.boxShadow = '0 4px 30px rgba(90,154,78,0.5)';
      };
      acceptBtn.onmouseleave = () => {
        acceptBtn.style.background = 'rgba(58,106,46,0.8)';
        acceptBtn.style.transform = 'scale(1)';
        acceptBtn.style.boxShadow = '0 4px 20px rgba(90,154,78,0.3)';
      };
      popup.appendChild(acceptBtn);

      // Decline button
      const declineBtn = document.createElement('button');
      declineBtn.textContent = 'DECLINE';
      declineBtn.style.cssText = `
        padding:8px 32px;border-radius:8px;cursor:pointer;
        background:transparent;border:1px solid rgba(139,115,85,0.3);
        color:#7a6e56;font-family:'Nunito',sans-serif;font-size:12px;font-weight:600;
        letter-spacing:1px;text-transform:uppercase;
        transition:all 0.2s ease;
      `;
      declineBtn.onmouseenter = () => { declineBtn.style.color = '#FF6B6B'; declineBtn.style.borderColor = 'rgba(255,107,107,0.4)'; };
      declineBtn.onmouseleave = () => { declineBtn.style.color = '#7a6e56'; declineBtn.style.borderColor = 'rgba(139,115,85,0.3)'; };
      popup.appendChild(declineBtn);

      overlay.appendChild(popup);

      let resolved = false;
      const finish = (accepted: boolean) => {
        if (resolved) return;
        resolved = true;
        clearInterval(timer);
        resolve(accepted);
      };

      acceptBtn.onclick = () => finish(true);
      declineBtn.onclick = () => finish(false);

      // Countdown timer with urgency escalation
      const timer = setInterval(() => {
        timeLeft--;
        countdown.textContent = `${timeLeft}`;
        if (timeLeft <= 5) {
          countdown.style.fontSize = '36px';
          countdown.style.borderColor = '#FFD93D';
          countdown.style.color = '#FFD93D';
          countdown.style.boxShadow = '0 0 16px rgba(255,217,61,0.3)';
        }
        if (timeLeft <= 3) {
          countdown.style.borderColor = '#FF6B6B';
          countdown.style.color = '#FF6B6B';
          countdown.style.boxShadow = '0 0 20px rgba(255,107,107,0.4)';
          countdown.style.transform = 'scale(1.1)';
        }
        if (timeLeft <= 0) {
          finish(false); // auto-decline on timeout
        }
      }, 1000);
    });
  }

  private cancelQueue() {
    if (this.matchmaking) {
      this.matchmaking.leaveQueue().catch(() => {});
    }
    this.destroyQueueOverlay();
    this.queueActive = false;
    this.statusText.setText('');
  }

  private destroyQueueOverlay() {
    if (this.queueOverlay) {
      this.queueOverlay.remove();
      this.queueOverlay = null;
    }
  }

  private cleanupQueue() {
    this.queueActive = false;
    if (this.dotTimer) { this.dotTimer.destroy(); this.dotTimer = undefined; }
    if (this.pulseTween) { this.pulseTween.stop(); this.pulseTween = undefined; }
    if (this.cancelBtn) {
      this.cancelBtn.container.destroy();
      this.cancelBtn.zone.destroy();
      this.cancelBtn = undefined;
    }
    this.destroyQueueOverlay();
  }

  // ── Friendly battle ────────────────────────────────────────────────

  private async startFriendlyBattle() {
    if (this.queueActive) return;
    const auth = AuthManager.getInstance();
    if (!auth.currentUser) return;

    this.queueActive = true;
    this.statusText.setText('Opening friends list...');
    this.statusText.setColor('#4a8aBB');
    this.tweens.add({ targets: this.statusText, alpha: { from: 0, to: 1 }, duration: 300 });

    try {
      const { FriendsPanel } = await import('../ui/FriendsPanel');
      const canvas = this.game.canvas;

      const panel = new FriendsPanel({
        onAddFriend: async (username: string) => {
          try {
            const target = await auth.searchByUsername(username);
            if (!target) return { success: false, error: 'User not found' };
            if (target.uid === auth.currentUser?.uid) return { success: false, error: "That's you!" };
            await auth.sendFriendRequest(target.uid);
            return { success: true };
          } catch (e) { return { success: false, error: (e as Error).message }; }
        },
        onAcceptRequest: async (uid: string) => auth.acceptRequest(uid),
        onDeclineRequest: async (uid: string) => auth.declineRequest(uid),
        onRemoveFriend: async (uid: string) => auth.removeFriend(uid),
        onInvite: async (friendUid: string) => {
          // Send invite, close panel, show invite overlay
          const friendEntry = this._friendsList.find((f: any) => f.uid === friendUid);
          const friendName = friendEntry?.username || 'friend';
          panel.close();
          canvas.style.pointerEvents = 'auto';

          this.statusText.setText('');
          try {
            const { inviteId, gameId } = await auth.sendInvite(friendUid);
            this.showInviteScreen(friendName);

            const response = await auth.waitForInviteResponse(friendUid, inviteId);
            this.destroyQueueOverlay();
            this.cleanupQueue();

            if (response === 'accepted') {
              this.playsfx('wave_start', 0.5);
              this.statusText.setText('Friend accepted! Starting...');
              this.statusText.setColor('#6B9B5E');
              this.statusText.setAlpha(1);
              this.cameras.main.flash(300, 107, 155, 94, false);

              this.time.delayedCall(800, () => {
                const firebase = FirebaseSync.getInstance();
                this.cameras.main.fadeOut(400, 15, 26, 10);
                this.cameras.main.once('camerafadeoutcomplete', () => {
                  this.scene.start('HordeScene', {
                    isOnline: true,
                    gameId,
                    playerId: firebase.getPlayerId(),
                    amPlayer1: true,
                    opponentUid: friendUid,
                    matchType: 'friendly' as const,
                  });
                });
              });
            } else {
              this.statusText.setText(response === 'declined' ? 'Invite declined' : 'Invite expired');
              this.statusText.setColor('#a89870');
            }
          } catch (err) {
            this.destroyQueueOverlay();
            this.cleanupQueue();
            this.statusText.setText('Error: ' + (err as Error).message);
            this.statusText.setColor('#BB4444');
          }
        },
      });

      // Load friends list
      const unsub = auth.onFriendsChanged((friends) => {
        this._friendsList = friends;
        panel.updateFriends(friends);
      });

      canvas.style.pointerEvents = 'none';
      panel.open();

      // Handle panel close without invite
      const observer = new MutationObserver(() => {
        if (!document.getElementById('friends-overlay')) {
          observer.disconnect();
          canvas.style.pointerEvents = 'auto';
          unsub();
          if (this.queueActive && !this.cancelBtn) {
            this.queueActive = false;
            this.statusText.setText('');
          }
        }
      });
      observer.observe(document.body, { childList: true });
    } catch {
      this.queueActive = false;
      this.statusText.setText('Could not open friends list');
      this.statusText.setColor('#BB4444');
    }
  }

  // ── Floating decorative icons (from MenuScene) ─────────────────────

  private createFloatingIcons(width: number, height: number) {
    const iconKeys = ['ts_icon1', 'ts_icon2', 'ts_icon3', 'ts_icon4', 'ts_icon5', 'ts_icon6', 'ts_icon10'];
    const available = iconKeys.filter(k => this.textures.exists(k));
    if (available.length === 0) return;

    for (let i = 0; i < 10; i++) {
      const key = available[i % available.length];
      const x = Math.random() * width;
      const y = Math.random() * height;
      const img = this.add.image(x, y, key)
        .setScale(0.25 + Math.random() * 0.15)
        .setAlpha(0.03 + Math.random() * 0.04)
        .setDepth(1)
        .setAngle(Math.random() * 360);

      this.tweens.add({
        targets: img,
        alpha: { from: img.alpha, to: img.alpha * 0.3 },
        scaleX: { from: img.scaleX, to: img.scaleX * 1.1 },
        scaleY: { from: img.scaleY, to: img.scaleY * 1.1 },
        duration: 3000 + Math.random() * 4000,
        yoyo: true, repeat: -1, ease: 'Sine.easeInOut',
        delay: Math.random() * 2000,
      });

      this.floatingShapes.push({
        sprite: img,
        vx: (Math.random() - 0.5) * 0.2,
        vy: (Math.random() - 0.5) * 0.15,
        rot: (Math.random() - 0.5) * 0.1,
      });
    }
  }

  update() {
    for (const shape of this.floatingShapes) {
      shape.sprite.x += shape.vx;
      shape.sprite.y += shape.vy;
      shape.sprite.angle += shape.rot;
      const { width, height } = this.cameras.main;
      if (shape.sprite.x < -40) shape.sprite.x = width + 40;
      if (shape.sprite.x > width + 40) shape.sprite.x = -40;
      if (shape.sprite.y < -40) shape.sprite.y = height + 40;
      if (shape.sprite.y > height + 40) shape.sprite.y = -40;
    }
  }

  // ── Background vignettes (from MenuScene) ─────────────────────────

  private startBackgroundVignettes() {
    const unitTypes = Object.keys(HORDE_SPRITE_CONFIGS).filter(
      t => this.textures.exists(HORDE_SPRITE_CONFIGS[t]?.walk?.key)
    );
    if (unitTypes.length === 0) return;

    const spawn = () => this.spawnVignette(unitTypes);
    this.time.delayedCall(3000, spawn);
    this.time.addEvent({ delay: 8000, loop: true, callback: spawn });
  }

  private spawnVignette(unitTypes: string[]) {
    const { width, height } = this.cameras.main;
    const type = unitTypes[Math.floor(Math.random() * unitTypes.length)];
    const cfg = HORDE_SPRITE_CONFIGS[type];
    const walkKey = cfg.walk.key;
    const animKey = `h_${type}_walk`;

    const edges = [
      { x: -50, y: height * (0.3 + Math.random() * 0.4) },
      { x: width + 50, y: height * (0.3 + Math.random() * 0.4) },
    ];
    const entryIdx = Math.random() < 0.5 ? 0 : 1;
    const start = edges[entryIdx];
    const exit = edges[1 - entryIdx];

    const unit = this.add.sprite(start.x, start.y, walkKey)
      .setDepth(2).setAlpha(0.35).setScale(cfg.displayScale * 0.45);
    if (exit.x < start.x) unit.setFlipX(true);
    if (this.anims.exists(animKey)) {
      unit.play(animKey);
      unit.anims.timeScale = 0.6;
    }

    const dist = Math.hypot(exit.x - start.x, exit.y - start.y);
    this.tweens.add({
      targets: unit, x: exit.x, y: exit.y,
      duration: (dist / 80) * 1000, ease: 'Linear',
      onComplete: () => unit.destroy(),
    });
  }

  // ── Medieval button (copied from MenuScene) ────────────────────────

  private createMedievalButton(
    x: number, y: number, w: number, h: number,
    label: string, color: 'green' | 'red' | 'blue' | 'yellow', isPrimary: boolean,
  ): { container: Phaser.GameObjects.Container; zone: Phaser.GameObjects.Zone } {
    const container = this.add.container(x, y).setDepth(12);
    const schemes = {
      green:  { fill: 0x3a6a2e, border: 0x5a9a4e, highlight: 0x8BC47A, text: '#e8e0c8' },
      red:    { fill: 0x8B3333, border: 0xBB4444, highlight: 0xDD6666, text: '#e8e0c8' },
      blue:   { fill: 0x2a5a8a, border: 0x4a8aBB, highlight: 0x6aAADD, text: '#e8e0c8' },
      yellow: { fill: 0x7a6a2a, border: 0xAA9944, highlight: 0xDDCC66, text: '#e8e0c8' },
    };
    const s = schemes[color];

    const shadow = this.add.graphics();
    shadow.fillStyle(0x000000, 0.5);
    shadow.fillRoundedRect(-w / 2 + 3, -h / 2 + 3, w, h, 8);
    container.add(shadow);

    const bg = this.add.graphics();
    bg.fillStyle(s.fill, 0.95);
    bg.fillRoundedRect(-w / 2, -h / 2, w, h, 8);
    bg.fillStyle(s.highlight, 0.1);
    bg.fillRoundedRect(-w / 2 + 4, -h / 2 + 3, w - 8, h / 3, 4);
    bg.lineStyle(2, s.border, 0.9);
    bg.strokeRoundedRect(-w / 2, -h / 2, w, h, 8);
    container.add(bg);

    const text = this.add.text(0, -1, label, {
      fontSize: '16px', color: s.text, fontFamily: '"Fredoka", sans-serif', fontStyle: 'bold',
      letterSpacing: 1, stroke: '#000000', strokeThickness: 2,
    }).setOrigin(0.5);
    container.add(text);

    if (isPrimary) {
      this.tweens.add({
        targets: container, scaleX: { from: 1, to: 1.012 }, scaleY: { from: 1, to: 1.012 },
        duration: 1400, yoyo: true, repeat: -1, ease: 'Sine.easeInOut',
      });
    }

    const zone = this.add.zone(x, y, w, h).setInteractive({ useHandCursor: true }).setDepth(13);
    zone.on('pointerover', () => {
      this.tweens.add({ targets: container, scaleX: 1.06, scaleY: 1.06, duration: 150, ease: 'Back.easeOut' });
      bg.clear();
      bg.fillStyle(s.highlight, 0.4);
      bg.fillRoundedRect(-w / 2, -h / 2, w, h, 8);
      bg.lineStyle(2, 0xFFD93D, 0.9);
      bg.strokeRoundedRect(-w / 2, -h / 2, w, h, 8);
      text.setColor('#FFD93D');
    });
    zone.on('pointerout', () => {
      this.tweens.add({ targets: container, scaleX: 1, scaleY: 1, duration: 150 });
      bg.clear();
      bg.fillStyle(s.fill, 0.95);
      bg.fillRoundedRect(-w / 2, -h / 2, w, h, 8);
      bg.lineStyle(2, s.border, 0.9);
      bg.strokeRoundedRect(-w / 2, -h / 2, w, h, 8);
      text.setColor(s.text);
    });
    zone.on('pointerdown', () => {
      this.playsfx('button_click', 0.4);
      this.tweens.add({ targets: container, scaleX: 0.94, scaleY: 0.94, duration: 60, yoyo: true });
    });

    return { container, zone };
  }

  private playsfx(key: string, volume = 0.5) {
    if (this.muted || !this.cache.audio.exists(key)) return;
    this.sound.play(key, { volume });
  }
}
