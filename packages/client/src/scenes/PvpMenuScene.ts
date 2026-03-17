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
    });

    const { width, height } = this.cameras.main;
    const auth = AuthManager.getInstance();
    const isGuest = auth.isGuest;

    // === BACKGROUND ===
    this.cameras.main.setBackgroundColor('#0f1a0a');
    this.cameras.main.fadeIn(400, 15, 26, 10);

    const bg = this.add.graphics().setDepth(0);
    bg.fillStyle(0x0f1a0a, 1);
    bg.fillRect(0, 0, width, height);
    bg.fillStyle(0x1a2e10, 0.6);
    bg.fillCircle(width / 2, height * 0.45, Math.max(width, height) * 0.5);
    bg.fillStyle(0x243a18, 0.3);
    bg.fillCircle(width / 2, height * 0.45, Math.max(width, height) * 0.3);

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
    this.add.text(width / 2 + 2, titleY + 2, 'PVP ARENA', {
      fontSize: '48px', color: '#000000', fontFamily: '"Fredoka", sans-serif', fontStyle: 'bold',
    }).setOrigin(0.5).setAlpha(0.4).setDepth(10);
    const title = this.add.text(width / 2, titleY, 'PVP ARENA', {
      fontSize: '48px', color: '#FFD93D', fontFamily: '"Fredoka", sans-serif', fontStyle: 'bold',
      stroke: '#3a2a10', strokeThickness: 5,
    }).setOrigin(0.5).setAlpha(0).setScale(0.5).setDepth(11);
    this.tweens.add({ targets: title, alpha: 1, scaleX: 1, scaleY: 1, duration: 600, ease: 'Back.easeOut' });

    const subtitle = this.add.text(width / 2, titleY + 40, 'Choose your battle mode', {
      fontSize: '14px', color: '#a89870', fontFamily: '"Nunito", sans-serif', fontStyle: 'bold',
      letterSpacing: 3, stroke: '#0a0f06', strokeThickness: 2,
    }).setOrigin(0.5).setAlpha(0).setDepth(11);
    this.tweens.add({ targets: subtitle, alpha: 0.9, duration: 500, delay: 300 });

    // Divider
    const divY = titleY + 64;
    const divLine = this.add.graphics().setDepth(10);
    divLine.lineStyle(2, 0x8B7355, 0.5);
    divLine.lineBetween(width / 2 - 120, divY, width / 2 + 120, divY);
    divLine.fillStyle(0xFFD93D, 0.7);
    divLine.fillTriangle(width / 2 - 5, divY, width / 2, divY - 5, width / 2 + 5, divY);
    divLine.fillTriangle(width / 2 - 5, divY, width / 2, divY + 5, width / 2 + 5, divY);

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
      false, 400,
    );
    unrankedCard.zone.on('pointerdown', () => this.startQueue('horde_unranked', 'unranked'));

    // Ranked (requires auth)
    const rankedCard = this.createModeCard(
      startX + cardW + cardGap, cardsY, cardW, 'red',
      '🏆', 'RANKED', 'Climb the', 'ladder',
      isGuest, 550,
    );
    if (!isGuest) {
      rankedCard.zone.on('pointerdown', () => this.startQueue('horde_ranked', 'ranked'));
    }

    // Friendly (requires auth)
    const friendlyCard = this.createModeCard(
      startX + (cardW + cardGap) * 2, cardsY, cardW, 'blue',
      '🤝', 'FRIENDLY', 'Challenge', 'a friend',
      isGuest, 700,
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

    const cardW = 320, cardH = 60;

    // Background
    const bg = this.add.graphics();
    bg.fillStyle(0x243a18, 0.85);
    bg.fillRoundedRect(-cardW / 2, -cardH / 2, cardW, cardH, 10);
    bg.lineStyle(2, 0x5a9a4e, 0.6);
    bg.strokeRoundedRect(-cardW / 2, -cardH / 2, cardW, cardH, 10);
    container.add(bg);

    // Emoji + tier name
    const tierText = this.add.text(-cardW / 2 + 16, -8, `${tier.emoji} ${displayName}`, {
      fontSize: '18px', color: tier.color, fontFamily: '"Fredoka", sans-serif', fontStyle: 'bold',
      stroke: '#000', strokeThickness: 2,
    }).setOrigin(0, 0.5);
    container.add(tierText);

    // Rating number
    const rpText = this.add.text(cardW / 2 - 16, -8, `${data.rating} RP`, {
      fontSize: '16px', color: '#d4c8a0', fontFamily: '"Nunito", sans-serif', fontStyle: 'bold',
      stroke: '#000', strokeThickness: 2,
    }).setOrigin(1, 0.5);
    container.add(rpText);

    // Progress bar
    const barW = cardW - 32, barH = 6, barX = -cardW / 2 + 16, barY = 14;
    const barBg = this.add.graphics();
    barBg.fillStyle(0x000000, 0.3);
    barBg.fillRoundedRect(barX, barY, barW, barH, 3);
    barBg.fillStyle(Phaser.Display.Color.HexStringToColor(tier.color).color, 0.7);
    barBg.fillRoundedRect(barX, barY, barW * progress, barH, 3);
    container.add(barBg);

    if (nextLabel) {
      const nextText = this.add.text(cardW / 2 - 16, barY + barH + 2, `→ ${nextLabel}`, {
        fontSize: '10px', color: '#7a6e56', fontFamily: '"Nunito", sans-serif',
      }).setOrigin(1, 0);
      container.add(nextText);
    }

    // W/L
    if (data.gamesPlayed > 0) {
      const wl = this.add.text(-cardW / 2 + 16, barY + barH + 2, `${data.wins}W ${data.losses}L`, {
        fontSize: '10px', color: '#7a6e56', fontFamily: '"Nunito", sans-serif',
      }).setOrigin(0, 0);
      container.add(wl);
    }

    this.tweens.add({ targets: container, alpha: 1, duration: 500, delay: 300 });
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

    // Background
    const bg = this.add.graphics();
    bg.fillStyle(s.fill, locked ? 0.4 : 0.92);
    bg.fillRoundedRect(-w / 2, -h / 2, w, h, 10);
    bg.fillStyle(s.highlight, locked ? 0.03 : 0.08);
    bg.fillRoundedRect(-w / 2 + 4, -h / 2 + 3, w - 8, h / 4, 6);
    bg.lineStyle(2, s.border, locked ? 0.3 : 0.8);
    bg.strokeRoundedRect(-w / 2, -h / 2, w, h, 10);
    container.add(bg);

    // Emoji icon
    const icon = this.add.text(0, -h / 2 + 36, emoji, {
      fontSize: '36px',
    }).setOrigin(0.5).setAlpha(locked ? 0.3 : 1);
    container.add(icon);

    // Title
    const titleText = this.add.text(0, -h / 2 + 76, title, {
      fontSize: '18px', color: locked ? '#666' : '#e8e0c8',
      fontFamily: '"Fredoka", sans-serif', fontStyle: 'bold',
      stroke: '#000', strokeThickness: 2, letterSpacing: 1,
    }).setOrigin(0.5);
    container.add(titleText);

    // Description lines
    const d1 = this.add.text(0, -h / 2 + 102, desc1, {
      fontSize: '12px', color: locked ? '#555' : '#a89870',
      fontFamily: '"Nunito", sans-serif',
    }).setOrigin(0.5);
    container.add(d1);
    const d2 = this.add.text(0, -h / 2 + 118, desc2, {
      fontSize: '12px', color: locked ? '#555' : '#a89870',
      fontFamily: '"Nunito", sans-serif',
    }).setOrigin(0.5);
    container.add(d2);

    // Lock overlay for guests
    if (locked) {
      const lockText = this.add.text(0, h / 2 - 28, '🔒 Sign in required', {
        fontSize: '11px', color: '#FF6B6B', fontFamily: '"Nunito", sans-serif', fontStyle: 'bold',
        stroke: '#000', strokeThickness: 2,
      }).setOrigin(0.5);
      container.add(lockText);
    }

    // Animate in
    this.tweens.add({
      targets: container, alpha: locked ? 0.5 : 1, scaleX: 1, scaleY: 1,
      duration: 500, delay, ease: 'Back.easeOut',
    });

    // Interactive zone
    const zone = this.add.zone(x, y, w, h).setInteractive({ useHandCursor: !locked }).setDepth(13);

    if (!locked) {
      zone.on('pointerover', () => {
        this.tweens.add({ targets: container, scaleX: 1.05, scaleY: 1.05, duration: 150, ease: 'Back.easeOut' });
        bg.clear();
        bg.fillStyle(s.highlight, 0.35);
        bg.fillRoundedRect(-w / 2, -h / 2, w, h, 10);
        bg.fillStyle(0xffffff, 0.06);
        bg.fillRoundedRect(-w / 2 + 4, -h / 2 + 3, w - 8, h / 4, 6);
        bg.lineStyle(2, 0xFFD93D, 0.9);
        bg.strokeRoundedRect(-w / 2, -h / 2, w, h, 10);
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
      });
      zone.on('pointerdown', () => {
        this.playsfx('button_click', 0.4);
        this.tweens.add({ targets: container, scaleX: 0.94, scaleY: 0.94, duration: 60, yoyo: true });
      });
    }

    return { container, zone };
  }

  // ── Queue flow ─────────────────────────────────────────────────────

  private async startQueue(queueName: string, matchType: 'unranked' | 'ranked') {
    if (this.queueActive) return;
    this.queueActive = true;

    const isRanked = matchType === 'ranked';
    this.statusText.setText('Connecting...');
    this.statusText.setColor('#FFD93D');
    this.tweens.add({ targets: this.statusText, alpha: { from: 0, to: 1 }, duration: 300 });

    // Show cancel button
    const { width } = this.cameras.main;
    const cancelY = this.statusText.y + 40;
    this.cancelBtn = this.createMedievalButton(width / 2, cancelY, 160, 40, 'CANCEL', 'red', false);
    this.cancelBtn.zone.on('pointerdown', () => this.cancelQueue());

    try {
      const firebase = FirebaseSync.getInstance();
      await firebase.initialize();

      let dots = 0;
      const label = isRanked ? 'Searching for ranked opponent' : 'Searching for opponent';
      this.dotTimer = this.time.addEvent({
        delay: 500,
        callback: () => {
          dots = (dots + 1) % 4;
          this.statusText.setText(label + '.'.repeat(dots));
        },
        loop: true,
      });
      this.pulseTween = this.tweens.add({
        targets: this.statusText,
        alpha: { from: 1, to: 0.5 },
        duration: 800, yoyo: true, repeat: -1, ease: 'Sine.easeInOut',
      });

      this.matchmaking = new Matchmaking(firebase, queueName);
      const matchResult = await this.matchmaking.joinQueue();

      this.cleanupQueue();

      if (matchResult.gameId) {
        this.playsfx('wave_start', 0.5);
        this.statusText.setText('Opponent found!');
        this.statusText.setColor('#6B9B5E');
        this.statusText.setAlpha(1);

        this.cameras.main.flash(300, 107, 155, 94, false);

        // Fetch opponent UID
        let opponentUid: string | undefined;
        try {
          const meta = await firebase.getGameMeta(matchResult.gameId);
          opponentUid = matchResult.amPlayer1 ? meta.player2 : meta.player1;
        } catch { /* non-critical */ }

        this.time.delayedCall(800, () => {
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
      }
    } catch (err) {
      this.cleanupQueue();
      this.statusText.setText('Error: ' + (err as Error).message);
      this.statusText.setColor('#BB4444');
      this.statusText.setAlpha(1);
    }
  }

  private cancelQueue() {
    if (this.matchmaking) {
      this.matchmaking.leaveQueue().catch(() => {});
    }
    this.cleanupQueue();
    this.statusText.setText('Queue cancelled');
    this.statusText.setColor('#a89870');
    this.statusText.setAlpha(1);
    this.time.delayedCall(1500, () => {
      if (this.statusText?.active) this.statusText.setText('');
    });
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
          // Send invite, close panel, wait for response
          panel.close();
          canvas.style.pointerEvents = 'auto';

          this.statusText.setText('Sending invite...');
          try {
            const { inviteId, gameId } = await auth.sendInvite(friendUid);
            this.statusText.setText('Waiting for response...');

            const { width } = this.cameras.main;
            this.cancelBtn = this.createMedievalButton(width / 2, this.statusText.y + 40, 160, 40, 'CANCEL', 'red', false);
            this.cancelBtn.zone.on('pointerdown', () => {
              this.cleanupQueue();
              this.statusText.setText('Invite cancelled');
              this.statusText.setColor('#a89870');
            });

            const response = await auth.waitForInviteResponse(friendUid, inviteId);
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
            this.cleanupQueue();
            this.statusText.setText('Error: ' + (err as Error).message);
            this.statusText.setColor('#BB4444');
          }
        },
      });

      // Load friends list
      const unsub = auth.onFriendsChanged((friends) => {
        panel.updateFriends(friends);
      });

      const canvas = this.game.canvas;
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
