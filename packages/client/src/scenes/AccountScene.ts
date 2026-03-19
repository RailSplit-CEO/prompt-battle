import Phaser from 'phaser';
import { AuthManager } from '../auth/AuthManager';
import { GameSettings } from '../systems/GameSettings';
import { SettingsPanel } from '../systems/SettingsPanel';
import { C } from '../ui/UIColors';
import {
  loadRating, getDefaultRating, ratingToTier, tierDisplayName,
  divisionProgress, PlayerRating,
} from '../systems/RankSystem';

type TabKey = 'overview' | 'characters' | 'ranked' | 'history' | 'friends' | 'inventory' | 'settings';

interface AccountSceneData {
  tab?: TabKey;
}

const TABS: { key: TabKey; label: string; icon: string }[] = [
  { key: 'overview',    label: 'Overview',    icon: '🏠' },
  { key: 'characters',  label: 'Characters',  icon: '⚔️' },
  { key: 'ranked',      label: 'Ranked',      icon: '🏆' },
  { key: 'history',     label: 'History',     icon: '📜' },
  { key: 'friends',     label: 'Friends',     icon: '👥' },
  { key: 'settings',    label: 'Settings',    icon: '⚙️' },
];

export class AccountScene extends Phaser.Scene {
  private activeTab: TabKey = 'overview';
  private contentEl: HTMLDivElement | null = null;
  private tabContainers: Map<TabKey, { container: Phaser.GameObjects.Container; bg: Phaser.GameObjects.Graphics; text: Phaser.GameObjects.Text }> = new Map();
  private muted: boolean = GameSettings.getInstance().get('muteAll');
  private settingsPanel = new SettingsPanel();
  private friendsUnsub?: () => void;
  private floatingShapes: { sprite: Phaser.GameObjects.Image; vx: number; vy: number; rot: number }[] = [];

  // Cached data
  private myRating: PlayerRating | null = null;
  private _resizeHandler: (() => void) | null = null;
  private _resizeTimer: number | null = null;

  constructor() {
    super({ key: 'AccountScene' });
  }

  init(data?: AccountSceneData) {
    this.activeTab = data?.tab || 'overview';
  }

  create() {
    this._resizeHandler = () => {
      if (this._resizeTimer !== null) clearTimeout(this._resizeTimer);
      this._resizeTimer = window.setTimeout(() => { this.scene.restart({ tab: this.activeTab }); }, 200);
    };
    this.scale.on('resize', this._resizeHandler);
    this.events.once('shutdown', () => {
      if (this._resizeHandler) this.scale.off('resize', this._resizeHandler);
      if (this._resizeTimer !== null) clearTimeout(this._resizeTimer);
      this.destroyContent();
      if (this.friendsUnsub) { this.friendsUnsub(); this.friendsUnsub = undefined; }
    });

    const { width, height } = this.cameras.main;

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

    this.createFloatingIcons(width, height);

    // === BACK BUTTON ===
    const backBtn = this.createSmallButton(80, 28, 120, 32, '← BACK', 'yellow');
    backBtn.zone.on('pointerdown', () => {
      this.cameras.main.fadeOut(300, 15, 26, 10);
      this.cameras.main.once('camerafadeoutcomplete', () => {
        this.scene.start('MenuScene');
      });
    });

    // === PROFILE BANNER (async) ===
    const bannerY = 80;
    const bannerContainer = this.add.container(width / 2, bannerY).setDepth(11);
    this.buildBanner(bannerContainer);

    // === TAB BAR ===
    const tabY = bannerY + 70;
    this.buildTabBar(width / 2, tabY);

    // === CONTENT AREA (DOM) ===
    const contentTop = tabY + 40;
    this.createContentDiv(contentTop, width, height);

    // Load initial tab content
    this.switchTab(this.activeTab);

    // === ESC to go back ===
    this.input.keyboard!.on('keydown-ESC', () => {
      this.cameras.main.fadeOut(300, 15, 26, 10);
      this.cameras.main.once('camerafadeoutcomplete', () => {
        this.scene.start('MenuScene');
      });
    });
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

  // ── Banner ─────────────────────────────────────────────────────────

  private async buildBanner(container: Phaser.GameObjects.Container) {
    const auth = AuthManager.getInstance();
    const profile = auth.userProfile;
    const uid = auth.currentUser?.uid;

    // Load rank
    let rating: PlayerRating;
    try {
      rating = uid ? (await loadRating(uid) ?? getDefaultRating()) : getDefaultRating();
    } catch { rating = getDefaultRating(); }
    this.myRating = rating;

    const bw = Math.min(720, this.cameras.main.width - 40);
    const bh = 90;

    // Background
    const bg = this.add.graphics();
    bg.fillStyle(0x182210, 0.92);
    bg.fillRoundedRect(-bw / 2, -bh / 2, bw, bh, 12);
    bg.lineStyle(2, 0x5a9a4e, 0.4);
    bg.strokeRoundedRect(-bw / 2, -bh / 2, bw, bh, 12);
    container.add(bg);

    // Avatar
    const avatarKey = profile?.icon || 'gnome';
    const avatarTexKey = `avatar_${avatarKey}`;
    if (this.textures.exists(avatarTexKey)) {
      const av = this.add.image(-bw / 2 + 50, 0, avatarTexKey).setDisplaySize(56, 56);
      container.add(av);
    }

    // Load equipped cosmetics
    let equipped: any = {};
    try {
      const { InventoryManager } = await import('../store/InventoryManager');
      equipped = InventoryManager.getInstance().getEquipped();
    } catch {}

    // Username + badge
    const name = profile?.username || 'Guest';
    const nameLabel = name;

    const nameText = this.add.text(-bw / 2 + 90, -22, nameLabel, {
      fontSize: '22px', color: '#FFD93D', fontFamily: '"Fredoka", sans-serif', fontStyle: 'bold',
      stroke: '#000', strokeThickness: 2, padding: { top: 2, bottom: 2 },
    }).setOrigin(0, 0.5);
    container.add(nameText);

    // Title (if equipped)
    const titleMap: Record<string, string> = { title_the_magnificent: 'The Magnificent', title_chaos_lord: 'Chaos Lord', title_grand_marshal: 'Grand Marshal', title_doom_bringer: 'Doom Bringer', title_the_eternal: 'The Eternal' };
    const titleText = equipped.profileTitle && equipped.profileTitle !== 'none' ? titleMap[equipped.profileTitle] : '';
    if (titleText) {
      const tText = this.add.text(-bw / 2 + 90, -6, `"${titleText}"`, {
        fontSize: '11px', color: '#7a6e56', fontFamily: '"Nunito", sans-serif', fontStyle: 'italic',
      }).setOrigin(0, 0.5);
      container.add(tText);
    }

    // Level + XP
    let levelLabel = '';
    let xpProgress = 0;
    try {
      const { PlayerLevelManager } = await import('../store/PlayerLevelManager');
      const plm = PlayerLevelManager.getInstance();
      levelLabel = `Lv.${plm.level}`;
      xpProgress = plm.xpForNext > 0 ? plm.xpInLevel / plm.xpForNext : 0;
    } catch { levelLabel = 'Lv.1'; }

    const lvlText = this.add.text(-bw / 2 + 90, 4, levelLabel, {
      fontSize: '13px', color: '#a89870', fontFamily: '"Nunito", sans-serif', fontStyle: '700',
    }).setOrigin(0, 0.5);
    container.add(lvlText);

    // XP bar
    const xpBarW = 120, xpBarH = 6, xpBarX = -bw / 2 + 130, xpBarY = 0;
    const xpBg = this.add.graphics();
    xpBg.fillStyle(0x000000, 0.3);
    xpBg.fillRoundedRect(xpBarX, xpBarY, xpBarW, xpBarH, 3);
    xpBg.fillStyle(0x45E6B0, 0.7);
    xpBg.fillRoundedRect(xpBarX, xpBarY, Math.max(2, xpBarW * xpProgress), xpBarH, 3);
    container.add(xpBg);

    // Currency
    let crowns = 0, glory = 0;
    try {
      const { WalletManager } = await import('../store/WalletManager');
      const wm = WalletManager.getInstance();
      crowns = wm.crowns;
      glory = wm.glory;
    } catch {}

    const currText = this.add.text(-bw / 2 + 90, 20, `👑 ${crowns.toLocaleString()}   ★ ${glory.toLocaleString()}`, {
      fontSize: '11px', color: '#7a6e56', fontFamily: '"Nunito", sans-serif', fontStyle: '600',
      padding: { top: 2, bottom: 2 },
    }).setOrigin(0, 0.5);
    container.add(currText);

    // Rank badge (right side)
    const tier = ratingToTier(rating.rating);
    const tierName = tierDisplayName(rating.rating);
    const rankText = this.add.text(bw / 2 - 16, -12, `${tier.emoji} ${tierName}`, {
      fontSize: '18px', color: tier.color, fontFamily: '"Fredoka", sans-serif', fontStyle: 'bold',
      stroke: '#000', strokeThickness: 2, padding: { top: 2, bottom: 2 },
    }).setOrigin(1, 0.5);
    container.add(rankText);

    const rpText = this.add.text(bw / 2 - 16, 10, `${rating.rating} RP`, {
      fontSize: '14px', color: '#d4c8a0', fontFamily: '"Nunito", sans-serif', fontStyle: 'bold',
    }).setOrigin(1, 0.5);
    container.add(rpText);

    // Join date
    if (profile?.createdAt) {
      const d = new Date(profile.createdAt);
      const dateStr = `Joined ${d.toLocaleString('en', { month: 'short', year: 'numeric' })}`;
      const joinText = this.add.text(bw / 2 - 16, 28, dateStr, {
        fontSize: '10px', color: '#5a6a4a', fontFamily: '"Nunito", sans-serif',
      }).setOrigin(1, 0.5);
      container.add(joinText);
    }

    // Animate in
    container.setAlpha(0).setScale(0.9);
    this.tweens.add({ targets: container, alpha: 1, scaleX: 1, scaleY: 1, duration: 500, ease: 'Back.easeOut' });
  }

  // ── Tab Bar ────────────────────────────────────────────────────────

  private buildTabBar(cx: number, cy: number) {
    const tabW = 90, tabH = 32, gap = 5;
    const totalW = TABS.length * tabW + (TABS.length - 1) * gap;
    const startX = cx - totalW / 2 + tabW / 2;

    for (let i = 0; i < TABS.length; i++) {
      const tab = TABS[i];
      const x = startX + i * (tabW + gap);

      const container = this.add.container(x, cy).setDepth(12);
      const bg = this.add.graphics();
      const isActive = tab.key === this.activeTab;

      this.drawTabBg(bg, tabW, tabH, isActive);
      container.add(bg);

      const text = this.add.text(0, 0, `${tab.icon} ${tab.label}`, {
        fontSize: '11px', fontFamily: '"Nunito", sans-serif', fontStyle: '700',
        color: isActive ? '#FFD93D' : '#a89870',
        padding: { top: 2, bottom: 2 },
      }).setOrigin(0.5);
      container.add(text);

      this.tabContainers.set(tab.key, { container, bg, text });

      // Interactive
      const zone = this.add.zone(x, cy, tabW, tabH).setInteractive({ useHandCursor: true }).setDepth(13);
      zone.on('pointerover', () => {
        if (tab.key !== this.activeTab) {
          bg.clear();
          this.drawTabBg(bg, tabW, tabH, false, true);
          text.setColor('#d4c8a0');
        }
      });
      zone.on('pointerout', () => {
        if (tab.key !== this.activeTab) {
          bg.clear();
          this.drawTabBg(bg, tabW, tabH, false);
          text.setColor('#a89870');
        }
      });
      zone.on('pointerdown', () => {
        this.playsfx('button_click', 0.3);
        this.switchTab(tab.key);
      });

      // Animate in
      container.setAlpha(0);
      this.tweens.add({ targets: container, alpha: 1, duration: 400, delay: 200 + i * 60 });
    }
  }

  private drawTabBg(g: Phaser.GameObjects.Graphics, w: number, h: number, active: boolean, hover = false) {
    if (active) {
      g.fillStyle(0xFFD93D, 0.12);
      g.fillRoundedRect(-w / 2, -h / 2, w, h, 6);
      g.lineStyle(1.5, 0xFFD93D, 0.5);
      g.strokeRoundedRect(-w / 2, -h / 2, w, h, 6);
    } else if (hover) {
      g.fillStyle(0xffffff, 0.05);
      g.fillRoundedRect(-w / 2, -h / 2, w, h, 6);
    } else {
      g.fillStyle(0xffffff, 0.02);
      g.fillRoundedRect(-w / 2, -h / 2, w, h, 6);
    }
  }

  private switchTab(key: TabKey) {
    const prev = this.activeTab;
    this.activeTab = key;

    // Update tab visuals
    for (const [k, { bg, text }] of this.tabContainers) {
      bg.clear();
      const isActive = k === key;
      this.drawTabBg(bg, 90, 32, isActive);
      text.setColor(isActive ? '#FFD93D' : '#a89870');
    }

    this.renderTabContent(key);
  }

  // ── Content Area ───────────────────────────────────────────────────

  private createContentDiv(top: number, width: number, height: number) {
    this.destroyContent();
    const el = document.createElement('div');
    el.id = 'account-content';
    const w = Math.min(800, width - 40);
    el.style.cssText = `
      position:fixed;
      top:${top}px;left:50%;transform:translateX(-50%);
      width:${w}px;max-height:${height - top - 20}px;
      background:rgba(18,22,14,0.92);
      border:2px solid rgba(139,115,85,0.35);
      border-radius:14px;
      backdrop-filter:blur(12px);-webkit-backdrop-filter:blur(12px);
      overflow-y:auto;overflow-x:hidden;
      padding:20px 24px;
      box-sizing:border-box;
      z-index:100;
      font-family:'Nunito',sans-serif;
      color:#d4c8a0;
      scrollbar-width:thin;scrollbar-color:rgba(139,115,85,0.5) rgba(139,115,85,0.15);
      opacity:0;transition:opacity 0.3s ease;
    `;
    document.body.appendChild(el);
    this.contentEl = el;
    requestAnimationFrame(() => { el.style.opacity = '1'; });

    // Inject scrollbar styles
    if (!document.getElementById('account-content-styles')) {
      const style = document.createElement('style');
      style.id = 'account-content-styles';
      style.textContent = `
        #account-content::-webkit-scrollbar { width:5px; }
        #account-content::-webkit-scrollbar-track { background:rgba(139,115,85,0.15);border-radius:3px; }
        #account-content::-webkit-scrollbar-thumb { background:rgba(139,115,85,0.5);border-radius:3px; }
        .acct-section { margin-bottom:20px; }
        .acct-title { font-size:16px;font-weight:800;color:#FFD93D;font-family:'Fredoka',sans-serif;letter-spacing:2px;margin-bottom:12px; }
        .acct-stat-grid { display:grid;grid-template-columns:repeat(auto-fill,minmax(140px,1fr));gap:10px; }
        .acct-stat { background:rgba(255,248,230,0.04);border:1px solid rgba(139,115,85,0.2);border-radius:8px;padding:12px;text-align:center; }
        .acct-stat-val { font-size:22px;font-weight:800;font-family:'Fredoka',sans-serif; }
        .acct-stat-label { font-size:10px;color:#7a6e56;letter-spacing:1px;text-transform:uppercase;margin-top:4px; }
        .acct-match-row { display:flex;align-items:center;gap:10px;padding:8px 12px;border-radius:8px;transition:background 0.15s; }
        .acct-match-row:hover { background:rgba(255,248,230,0.04); }
        .acct-badge { display:inline-block;padding:2px 8px;border-radius:4px;font-size:11px;font-weight:700;color:#fff; }
        .acct-badge-w { background:#3a6a2e; }
        .acct-badge-l { background:#8B3333; }
        .acct-empty { text-align:center;color:#7a6e56;font-style:italic;padding:20px; }
        .acct-friend-row { display:flex;align-items:center;gap:10px;padding:8px 12px;border-radius:8px;transition:background 0.15s; }
        .acct-friend-row:hover { background:rgba(255,248,230,0.04); }
        .acct-avatar { width:36px;height:36px;border-radius:50%;border:2px solid rgba(139,115,85,0.3);object-fit:cover; }
        .acct-online-dot { width:8px;height:8px;border-radius:50%;flex-shrink:0; }
        .acct-btn { padding:6px 14px;border-radius:6px;cursor:pointer;font-size:11px;font-weight:700;font-family:'Nunito',sans-serif;border:1.5px solid;transition:all 0.15s; }
        .acct-btn-green { background:rgba(90,154,78,0.15);border-color:rgba(90,154,78,0.5);color:#5a9a4e; }
        .acct-btn-green:hover { background:rgba(90,154,78,0.3);border-color:#5a9a4e; }
        .acct-btn-red { background:rgba(139,51,51,0.15);border-color:rgba(187,68,68,0.4);color:#FF6B6B; }
        .acct-btn-red:hover { background:rgba(139,51,51,0.3);border-color:#FF6B6B; }
        .acct-btn-gold { background:rgba(255,217,61,0.1);border-color:rgba(255,217,61,0.35);color:#FFD93D; }
        .acct-btn-gold:hover { background:rgba(255,217,61,0.2);border-color:#FFD93D; }
        .acct-input { background:rgba(139,115,85,0.15);border:1.5px solid rgba(139,115,85,0.35);border-radius:6px;padding:8px 12px;color:#d4c8a0;font-size:13px;font-family:'Nunito',sans-serif;outline:none;transition:border-color 0.15s; }
        .acct-input:focus { border-color:rgba(255,217,61,0.5); }
        .acct-divider { height:1px;background:rgba(139,115,85,0.18);margin:16px 0; }
      `;
      document.head.appendChild(style);
    }
  }

  private destroyContent() {
    if (this.contentEl) {
      this.contentEl.remove();
      this.contentEl = null;
    }
  }

  // ── Tab Renderers ──────────────────────────────────────────────────

  private renderTabContent(tab: TabKey) {
    if (!this.contentEl) return;
    // Clear previous friend subscriptions
    if (this.friendsUnsub) { this.friendsUnsub(); this.friendsUnsub = undefined; }

    switch (tab) {
      case 'overview': this.renderOverview(); break;
      case 'characters': this.renderCharacters(); break;
      case 'ranked': this.renderRanked(); break;
      case 'history': this.renderHistory(); break;
      case 'friends': this.renderFriends(); break;
      case 'inventory': this.renderInventory(); break;
      case 'settings': this.renderSettings(); break;
    }
  }

  private async renderOverview() {
    const el = this.contentEl!;
    el.innerHTML = '<div style="text-align:center;color:#7a6e56;padding:20px;">Loading...</div>';

    const auth = AuthManager.getInstance();
    const rating = this.myRating ?? getDefaultRating();
    const tier = ratingToTier(rating.rating);
    const tierName = tierDisplayName(rating.rating);
    const { progress, nextLabel } = divisionProgress(rating.rating);

    // Load recent matches
    let matches: any[] = [];
    try { matches = await auth.getMatchHistory(5); } catch {}
    const wins = matches.filter(m => m.result === 'win').length;
    const losses = matches.filter(m => m.result === 'loss').length;

    el.innerHTML = `
      <div class="acct-section">
        <div class="acct-title">OVERVIEW</div>
        <div class="acct-stat-grid">
          <div class="acct-stat">
            <div class="acct-stat-val" style="color:${tier.color}">${tier.emoji} ${tierName}</div>
            <div class="acct-stat-label">Current Rank</div>
          </div>
          <div class="acct-stat">
            <div class="acct-stat-val" style="color:#FFD93D">${rating.rating}</div>
            <div class="acct-stat-label">Rating Points</div>
          </div>
          <div class="acct-stat">
            <div class="acct-stat-val" style="color:#45E6B0">${rating.wins}</div>
            <div class="acct-stat-label">Ranked Wins</div>
          </div>
          <div class="acct-stat">
            <div class="acct-stat-val" style="color:#FF6B6B">${rating.losses}</div>
            <div class="acct-stat-label">Ranked Losses</div>
          </div>
        </div>
      </div>

      ${progress > 0 ? `
      <div class="acct-section">
        <div style="font-size:12px;color:#7a6e56;margin-bottom:6px;">Progress to ${nextLabel}</div>
        <div style="height:8px;background:rgba(0,0,0,0.3);border-radius:4px;overflow:hidden;">
          <div style="height:100%;width:${Math.round(progress * 100)}%;background:${tier.color};border-radius:4px;opacity:0.8;"></div>
        </div>
      </div>` : ''}

      <div class="acct-section">
        <div class="acct-title">RECENT MATCHES</div>
        ${matches.length > 0 ? matches.reverse().map(m => {
          const date = new Date(m.datePlayed);
          const ago = this.timeAgo(date);
          const dur = `${Math.floor(m.durationMs / 60000)}:${String(Math.floor((m.durationMs % 60000) / 1000)).padStart(2, '0')}`;
          return `<div class="acct-match-row">
            <span class="acct-badge ${m.result === 'win' ? 'acct-badge-w' : 'acct-badge-l'}">${m.result === 'win' ? 'W' : 'L'}</span>
            <span style="flex:1;font-weight:600;">vs ${this.escHtml(m.opponentName)}</span>
            <span style="font-size:11px;color:#7a6e56;">${dur}</span>
            <span style="font-size:10px;color:#5a6a4a;">${ago}</span>
          </div>`;
        }).join('') : '<div class="acct-empty">No matches yet. Play PvP to see your history!</div>'}
      </div>
    `;
  }

  private renderRanked() {
    const el = this.contentEl!;
    const rating = this.myRating ?? getDefaultRating();
    const tier = ratingToTier(rating.rating);
    const tierName = tierDisplayName(rating.rating);
    const { progress, nextLabel } = divisionProgress(rating.rating);
    const wr = rating.gamesPlayed > 0 ? Math.round(100 * rating.wins / rating.gamesPlayed) : 0;

    el.innerHTML = `
      <div class="acct-section" style="text-align:center;">
        <div style="font-size:48px;margin-bottom:4px;">${tier.emoji}</div>
        <div style="font-size:28px;font-weight:800;color:${tier.color};font-family:'Fredoka',sans-serif;text-shadow:0 0 12px ${tier.color}40;">${tierName}</div>
        <div style="font-size:20px;color:#d4c8a0;font-weight:700;margin-top:4px;">${rating.rating} RP</div>
        ${rating.peakRating > rating.rating ? `<div style="font-size:12px;color:#7a6e56;margin-top:2px;">Peak: ${rating.peakRating} RP</div>` : ''}
        ${rating.provisional ? `<div style="font-size:12px;color:#a89870;margin-top:6px;">🔄 Provisional (${rating.gamesPlayed}/10 placement games)</div>` : ''}
      </div>

      ${progress > 0 && nextLabel ? `
      <div class="acct-section">
        <div style="display:flex;justify-content:space-between;font-size:11px;color:#7a6e56;margin-bottom:6px;">
          <span>${tierName}</span><span>${nextLabel}</span>
        </div>
        <div style="height:10px;background:rgba(0,0,0,0.3);border-radius:5px;overflow:hidden;">
          <div style="height:100%;width:${Math.round(progress * 100)}%;background:${tier.color};border-radius:5px;transition:width 0.5s;"></div>
        </div>
      </div>` : ''}

      <div class="acct-divider"></div>

      <div class="acct-stat-grid">
        <div class="acct-stat">
          <div class="acct-stat-val" style="color:#45E6B0">${rating.wins}</div>
          <div class="acct-stat-label">Wins</div>
        </div>
        <div class="acct-stat">
          <div class="acct-stat-val" style="color:#FF6B6B">${rating.losses}</div>
          <div class="acct-stat-label">Losses</div>
        </div>
        <div class="acct-stat">
          <div class="acct-stat-val" style="color:#FFD93D">${wr}%</div>
          <div class="acct-stat-label">Win Rate</div>
        </div>
        <div class="acct-stat">
          <div class="acct-stat-val" style="color:#d4c8a0">${rating.gamesPlayed}</div>
          <div class="acct-stat-label">Games Played</div>
        </div>
      </div>

      ${rating.streak !== 0 ? `
      <div style="text-align:center;margin-top:16px;font-size:14px;font-weight:700;">
        ${rating.streak > 0 ? `<span style="color:#45E6B0">🔥 ${rating.streak} Win Streak</span>` : `<span style="color:#FF6B6B">💀 ${Math.abs(rating.streak)} Loss Streak</span>`}
      </div>` : ''}

      <div class="acct-divider"></div>
      <div style="text-align:center;font-size:12px;color:#5a6a4a;font-style:italic;">Ranked seasons coming soon</div>
    `;
  }

  private async renderHistory() {
    const el = this.contentEl!;
    el.innerHTML = '<div style="text-align:center;color:#7a6e56;padding:20px;">Loading matches...</div>';

    const auth = AuthManager.getInstance();
    let matches: any[] = [];
    try { matches = await auth.getMatchHistory(50); } catch {}
    matches.reverse();

    const wins = matches.filter(m => m.result === 'win').length;
    const losses = matches.filter(m => m.result === 'loss').length;
    const wr = matches.length > 0 ? Math.round(100 * wins / matches.length) : 0;

    el.innerHTML = `
      <div class="acct-section">
        <div class="acct-title">MATCH HISTORY</div>
        ${matches.length > 0 ? `
        <div class="acct-stat-grid" style="margin-bottom:16px;">
          <div class="acct-stat"><div class="acct-stat-val" style="color:#45E6B0">${wins}</div><div class="acct-stat-label">Wins</div></div>
          <div class="acct-stat"><div class="acct-stat-val" style="color:#FF6B6B">${losses}</div><div class="acct-stat-label">Losses</div></div>
          <div class="acct-stat"><div class="acct-stat-val" style="color:#FFD93D">${wr}%</div><div class="acct-stat-label">Win Rate</div></div>
        </div>` : ''}
        ${matches.length > 0 ? matches.map(m => {
          const date = new Date(m.datePlayed);
          const dateStr = date.toLocaleDateString('en', { month: 'short', day: 'numeric' }) + ' ' + date.toLocaleTimeString('en', { hour: '2-digit', minute: '2-digit' });
          const dur = `${Math.floor(m.durationMs / 60000)}:${String(Math.floor((m.durationMs % 60000) / 1000)).padStart(2, '0')}`;
          return `<div class="acct-match-row">
            <span class="acct-badge ${m.result === 'win' ? 'acct-badge-w' : 'acct-badge-l'}">${m.result === 'win' ? 'W' : 'L'}</span>
            <img src="assets/enemies/avatars/${this.escHtml(m.opponentIcon)}.png" class="acct-avatar" style="width:28px;height:28px;" onerror="this.style.display='none'">
            <span style="flex:1;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${this.escHtml(m.opponentName)}</span>
            <span style="font-size:11px;color:#7a6e56;">${dur}</span>
            <span style="font-size:10px;color:#5a6a4a;">${dateStr}</span>
          </div>`;
        }).join('') : '<div class="acct-empty">No matches yet. Play PvP to see your history!</div>'}
      </div>
    `;
  }

  private renderFriends() {
    const el = this.contentEl!;
    el.innerHTML = '<div style="text-align:center;color:#7a6e56;padding:20px;">Loading friends...</div>';

    const auth = AuthManager.getInstance();

    // Add friend search
    const buildUI = (friends: import('../auth/AuthManager').FriendEntry[]) => {
      const accepted = friends.filter(f => f.status === 'accepted').sort((a, b) => (b.online ? 1 : 0) - (a.online ? 1 : 0));
      const incoming = friends.filter(f => f.status === 'pending_received');
      const outgoing = friends.filter(f => f.status === 'pending_sent');

      el.innerHTML = `
        <div class="acct-section">
          <div class="acct-title">FRIENDS</div>
          <div style="display:flex;gap:8px;margin-bottom:16px;">
            <input class="acct-input" id="acct-add-input" placeholder="Add friend by username..." style="flex:1;">
            <button class="acct-btn acct-btn-gold" id="acct-add-btn">Add</button>
          </div>
          <div id="acct-add-feedback" style="font-size:11px;min-height:16px;margin-bottom:8px;"></div>
        </div>

        ${incoming.length > 0 ? `
        <div class="acct-section">
          <div style="font-size:12px;color:#FFD93D;font-weight:700;margin-bottom:8px;">REQUESTS (${incoming.length})</div>
          ${incoming.map(f => `
            <div class="acct-friend-row">
              <img src="assets/enemies/avatars/${this.escHtml(f.icon)}.png" class="acct-avatar" onerror="this.style.display='none'">
              <span style="flex:1;font-weight:600;">${this.escHtml(f.username)}</span>
              <button class="acct-btn acct-btn-green" data-accept="${f.uid}">Accept</button>
              <button class="acct-btn acct-btn-red" data-decline="${f.uid}">Decline</button>
            </div>
          `).join('')}
        </div>` : ''}

        <div class="acct-section">
          <div style="font-size:12px;color:#45E6B0;font-weight:700;margin-bottom:8px;">FRIENDS (${accepted.length})</div>
          ${accepted.length > 0 ? accepted.map(f => `
            <div class="acct-friend-row">
              <div class="acct-online-dot" style="background:${f.online ? '#45E6B0' : 'rgba(139,115,85,0.3)'}"></div>
              <img src="assets/enemies/avatars/${this.escHtml(f.icon)}.png" class="acct-avatar" onerror="this.style.display='none'">
              <span style="flex:1;font-weight:600;">${this.escHtml(f.username)}</span>
              <span style="font-size:10px;color:#7a6e56;">${f.online ? 'Online' : 'Offline'}</span>
              <button class="acct-btn acct-btn-red" data-remove="${f.uid}" style="font-size:10px;padding:4px 8px;">Remove</button>
            </div>
          `).join('') : '<div class="acct-empty">No friends yet. Add someone above!</div>'}
        </div>

        ${outgoing.length > 0 ? `
        <div class="acct-section">
          <div style="font-size:12px;color:#7a6e56;font-weight:700;margin-bottom:8px;">PENDING (${outgoing.length})</div>
          ${outgoing.map(f => `
            <div class="acct-friend-row" style="opacity:0.6;">
              <img src="assets/enemies/avatars/${this.escHtml(f.icon)}.png" class="acct-avatar" onerror="this.style.display='none'">
              <span style="flex:1;font-weight:600;">${this.escHtml(f.username)}</span>
              <span style="font-size:10px;color:#7a6e56;">Pending...</span>
            </div>
          `).join('')}
        </div>` : ''}
      `;

      // Wire up buttons
      el.querySelector('#acct-add-btn')?.addEventListener('click', async () => {
        const input = el.querySelector('#acct-add-input') as HTMLInputElement;
        const feedback = el.querySelector('#acct-add-feedback') as HTMLDivElement;
        const username = input.value.trim();
        if (!username) return;
        feedback.textContent = 'Searching...';
        feedback.style.color = '#a89870';
        try {
          const target = await auth.searchByUsername(username);
          if (!target) { feedback.textContent = 'User not found'; feedback.style.color = '#FF6B6B'; return; }
          if (target.uid === auth.currentUser?.uid) { feedback.textContent = "That's you!"; feedback.style.color = '#FF6B6B'; return; }
          await auth.sendFriendRequest(target.uid);
          feedback.textContent = 'Request sent!';
          feedback.style.color = '#45E6B0';
          input.value = '';
        } catch (e) { feedback.textContent = (e as Error).message; feedback.style.color = '#FF6B6B'; }
      });

      el.querySelectorAll('[data-accept]').forEach(btn => {
        btn.addEventListener('click', () => auth.acceptRequest(btn.getAttribute('data-accept')!));
      });
      el.querySelectorAll('[data-decline]').forEach(btn => {
        btn.addEventListener('click', () => auth.declineRequest(btn.getAttribute('data-decline')!));
      });
      el.querySelectorAll('[data-remove]').forEach(btn => {
        btn.addEventListener('click', () => auth.removeFriend(btn.getAttribute('data-remove')!));
      });
    };

    this.friendsUnsub = auth.onFriendsChanged(buildUI);
  }

  private characterHub: any = null;

  private async renderCharacters() {
    const el = this.contentEl!;
    el.innerHTML = '<div style="text-align:center;color:#7a6e56;padding:20px;">Loading characters...</div>';

    try {
      const { CharacterHub } = await import('../ui/CharacterHub');
      // Hide content area while CharacterHub is open (it creates its own overlay)
      el.style.display = 'none';

      this.characterHub = new CharacterHub();
      this.characterHub.open(() => {
        // On close, restore content area and switch to overview
        el.style.display = '';
        this.characterHub = null;
        this.switchTab('overview');
      });
    } catch (err) {
      el.innerHTML = `<div class="acct-empty">Failed to load characters: ${(err as Error).message}</div>`;
    }
  }

  private inventoryFilter: string = 'all';

  private async renderInventory() {
    const el = this.contentEl!;
    el.innerHTML = '<div style="text-align:center;color:#7a6e56;padding:20px;">Loading inventory...</div>';

    // Load managers
    let inv: any, equip: any, catalog: any;
    try {
      const [invMod, equipMod, catMod] = await Promise.all([
        import('../store/InventoryManager'),
        import('../store/EquipService'),
        import('../store/CatalogService'),
      ]);
      inv = invMod.InventoryManager.getInstance();
      equip = equipMod.EquipService.getInstance();
      catalog = catMod.CatalogService.getInstance();
    } catch {
      el.innerHTML = '<div class="acct-empty">Could not load inventory data.</div>';
      return;
    }

    const owned = inv.getOwnedItems() as string[];
    const equipped = inv.getEquipped();

    // Rarity colors
    const rarityColors: Record<string, string> = {
      common: '#8B8B8B', rare: '#4a8aBB', epic: '#9B59B6', legendary: '#FFD93D',
    };

    // Filter categories for inventory (exclude unit_skin, avatar_portrait, voice_pack — those are in Characters)
    const inventoryCategories: { key: string; label: string; categories: string[] }[] = [
      { key: 'all', label: 'All', categories: [] },
      { key: 'profile', label: 'Profile', categories: ['profile_title', 'profile_border', 'profile_background', 'portrait_frame'] },
      { key: 'emotes', label: 'Emotes', categories: ['emote'] },
      { key: 'effects', label: 'Effects', categories: ['death_effect', 'spawn_effect', 'attack_trail', 'victory_effect'] },
      { key: 'misc', label: 'Misc', categories: ['cursor_pack'] },
      { key: 'equipment', label: 'Equipment', categories: ['equipment_cosmetic'] },
      { key: 'boosters', label: 'Boosters', categories: ['booster'] },
    ];

    // Get catalog metadata for owned items
    const ownedItems = owned.map(id => catalog.getItem(id)).filter(Boolean);

    // Filter by active sub-tab
    const activeFilter = this.inventoryFilter;
    const filterDef = inventoryCategories.find(c => c.key === activeFilter) ?? inventoryCategories[0];
    const filtered = filterDef.categories.length > 0
      ? ownedItems.filter((item: any) => filterDef.categories.includes(item.category))
      : ownedItems.filter((item: any) => !['unit_skin', 'avatar_portrait', 'voice_pack', 'voice_effect'].includes(item.category));

    // Check if item is equipped
    const isEquipped = (item: any): boolean => {
      const eq = equipped;
      switch (item.category) {
        case 'profile_title': return eq.profileTitle === item.id;
        case 'profile_border': return eq.profileBorder === item.id;
        case 'profile_background': return eq.profileBackground === item.id;
        case 'portrait_frame': return eq.portraitFrame === item.id;
        case 'death_effect': return eq.deathEffect === item.id;
        case 'spawn_effect': return eq.spawnEffect === item.id;
        case 'attack_trail': return eq.attackTrail === item.id;
        case 'victory_effect': return eq.victoryEffect === item.id;
        case 'cursor_pack': return eq.cursor === item.id;
        case 'equipment_cosmetic': {
          const et = item.equipType;
          return et ? eq.equipmentSkins?.[et] === item.id : false;
        }
        default: return false;
      }
    };

    // Category display name
    const catLabel = (cat: string) => cat.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());

    el.innerHTML = `
      <div class="acct-section">
        <div class="acct-title">INVENTORY</div>

        <!-- Sub-tab filter bar -->
        <div style="display:flex;gap:6px;margin-bottom:16px;flex-wrap:wrap;" id="inv-filter-bar">
          ${inventoryCategories.map(c => `
            <button class="acct-btn ${c.key === activeFilter ? 'acct-btn-gold' : ''}"
              data-filter="${c.key}"
              style="font-size:11px;padding:4px 12px;${c.key === activeFilter ? '' : 'background:rgba(139,115,85,0.1);border-color:rgba(139,115,85,0.3);color:#a89870;'}">
              ${c.label}${c.key !== 'all' ? '' : ` (${ownedItems.filter((i: any) => !['unit_skin','avatar_portrait','voice_pack','voice_effect'].includes(i.category)).length})`}
            </button>
          `).join('')}
        </div>

        ${filtered.length > 0 ? `
        <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(140px,1fr));gap:10px;">
          ${filtered.map((item: any) => {
            const equipped = isEquipped(item);
            const rc = rarityColors[item.rarity] || '#8B8B8B';
            return `
              <div class="inv-card" data-item-id="${item.id}" style="
                background:rgba(255,248,230,0.04);
                border-left:3px solid ${rc};
                border-top:1px solid rgba(139,115,85,0.2);border-right:1px solid rgba(139,115,85,0.2);border-bottom:1px solid rgba(139,115,85,0.2);
                border-radius:8px;padding:12px 10px;cursor:pointer;
                transition:all 0.15s;position:relative;
              ">
                <div style="font-size:12px;font-weight:700;color:#d4c8a0;margin-bottom:4px;">${this.escHtml(item.name)}</div>
                <div style="font-size:9px;color:#7a6e56;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:8px;">${catLabel(item.category)}</div>
                <div style="font-size:9px;font-weight:700;color:${rc};text-transform:uppercase;margin-bottom:6px;">${item.rarity}</div>
                ${item.category === 'booster'
                  ? `<span class="equip-btn" style="font-size:10px;font-weight:700;color:#FF6B6B;padding:3px 8px;border:1px solid rgba(255,107,107,0.4);border-radius:4px;background:rgba(255,107,107,0.08);cursor:pointer;">🚀 ACTIVATE</span>`
                  : item.category === 'emote'
                    ? `<span style="font-size:10px;font-weight:700;color:#a89870;padding:3px 8px;border:1px solid rgba(139,115,85,0.3);border-radius:4px;">IN-GAME (T)</span>`
                    : equipped
                      ? `<span style="font-size:10px;font-weight:700;color:#45E6B0;padding:3px 8px;border:1px solid rgba(69,230,176,0.4);border-radius:4px;background:rgba(69,230,176,0.1);">EQUIPPED</span>`
                      : `<span class="equip-btn" style="font-size:10px;font-weight:700;color:#FFD93D;padding:3px 8px;border:1px solid rgba(255,217,61,0.35);border-radius:4px;background:rgba(255,217,61,0.08);cursor:pointer;">EQUIP</span>`
                }
              </div>
            `;
          }).join('')}
        </div>` : `<div class="acct-empty">${owned.length === 0 ? 'No items yet. Visit the Store to get cosmetics!' : 'No items in this category.'}</div>`}
      </div>
    `;

    // Wire up filter buttons
    el.querySelectorAll('#inv-filter-bar button').forEach(btn => {
      btn.addEventListener('click', () => {
        this.inventoryFilter = btn.getAttribute('data-filter') || 'all';
        this.renderInventory();
      });
    });

    // Wire up equip/unequip clicks
    el.querySelectorAll('.inv-card').forEach(card => {
      card.addEventListener('click', async () => {
        const itemId = card.getAttribute('data-item-id');
        if (!itemId) return;
        const item = catalog.getItem(itemId);
        if (!item) return;

        // Boosters: activate instead of equip
        if (item.category === 'booster') {
          try {
            const { BoosterManager } = await import('../store/BoosterManager');
            const bm = BoosterManager.getInstance();
            const durations: Record<string, number> = { glory_2x: 3600000, xp_2x: 3600000 };
            const boosterType = item.id.replace('booster_', '');
            const dur = durations[boosterType] || 3600000;
            await bm.activateBooster(boosterType, dur);
            // Show feedback
            const toast = document.createElement('div');
            toast.style.cssText = 'position:fixed;top:20px;left:50%;transform:translateX(-50%);z-index:10000;background:rgba(90,154,78,0.9);color:#fff;padding:10px 24px;border-radius:8px;font-weight:700;font-family:"Nunito",sans-serif;font-size:14px;opacity:0;transition:opacity 0.3s;';
            toast.textContent = `🚀 ${item.name} active for 60 minutes!`;
            document.body.appendChild(toast);
            requestAnimationFrame(() => { toast.style.opacity = '1'; });
            setTimeout(() => { toast.style.opacity = '0'; setTimeout(() => toast.remove(), 300); }, 3000);
          } catch (err) { console.warn('[Booster] Activation failed:', err); }
          return;
        }

        // Emotes: no equip action
        if (item.category === 'emote') return;

        if (isEquipped(item)) {
          await this.unequipItem(equip, item);
        } else {
          await this.equipItem(equip, item);
        }
        this.renderInventory();
      });

      // Hover effects
      (card as HTMLElement).addEventListener('mouseenter', () => {
        (card as HTMLElement).style.background = 'rgba(255,248,230,0.08)';
        (card as HTMLElement).style.transform = 'translateY(-2px)';
      });
      (card as HTMLElement).addEventListener('mouseleave', () => {
        (card as HTMLElement).style.background = 'rgba(255,248,230,0.04)';
        (card as HTMLElement).style.transform = 'translateY(0)';
      });
    });
  }

  private async equipItem(equip: any, item: any) {
    try {
      switch (item.category) {
        case 'profile_title': await equip.equipTitle(item.id); break;
        case 'profile_border': await equip.equipProfileBorder(item.id); break;
        case 'profile_background': await equip.equipItem('profileBackground', item.id); break;
        case 'portrait_frame': await equip.equipItem('portraitFrame', item.id); break;
        case 'death_effect': await equip.equipDeathEffect(item.id); break;
        case 'spawn_effect': await equip.equipSpawnEffect(item.id); break;
        case 'attack_trail': await equip.equipAttackTrail(item.id); break;
        case 'victory_effect': await equip.equipVictoryEffect(item.id); break;
        case 'cursor_pack': await equip.equipCursor(item.id); break;
        case 'equipment_cosmetic':
          if (item.equipType) await equip.equipEquipmentSkin(item.equipType, item.id);
          break;
        case 'emote': break; // emotes don't have equip slot
      }
    } catch (err) { console.warn('[Inventory] Equip failed:', err); }
  }

  private async unequipItem(equip: any, item: any) {
    try {
      switch (item.category) {
        case 'profile_title': await equip.equipTitle('none'); break;
        case 'profile_border': await equip.equipProfileBorder('none'); break;
        case 'profile_background': await equip.equipItem('profileBackground', 'none'); break;
        case 'portrait_frame': await equip.equipItem('portraitFrame', 'none'); break;
        case 'death_effect': await equip.equipDeathEffect('default'); break;
        case 'spawn_effect': await equip.equipSpawnEffect('default'); break;
        case 'attack_trail': await equip.equipAttackTrail('default'); break;
        case 'victory_effect': await equip.equipVictoryEffect('default'); break;
        case 'cursor_pack': await equip.equipCursor('default'); break;
        case 'equipment_cosmetic':
          if (item.equipType) await equip.equipEquipmentSkin(item.equipType, 'default');
          break;
      }
    } catch (err) { console.warn('[Inventory] Unequip failed:', err); }
  }

  private renderSettings() {
    const el = this.contentEl!;
    el.innerHTML = `<div class="acct-section"><div class="acct-title">SETTINGS</div></div>`;
    const container = el.querySelector('.acct-section')!;
    try {
      this.settingsPanel.renderInto(container as HTMLElement);
    } catch {
      el.innerHTML = `<div class="acct-section" style="text-align:center;">
        <div class="acct-title">SETTINGS</div>
        <button class="acct-btn acct-btn-gold" id="acct-open-settings" style="font-size:14px;padding:10px 28px;">⚙️ Open Settings</button>
      </div>`;
      el.querySelector('#acct-open-settings')?.addEventListener('click', () => this.settingsPanel.toggle());
    }
  }

  // ── Helpers ────────────────────────────────────────────────────────

  private timeAgo(date: Date): string {
    const s = Math.floor((Date.now() - date.getTime()) / 1000);
    if (s < 60) return 'just now';
    if (s < 3600) return `${Math.floor(s / 60)}m ago`;
    if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
    return `${Math.floor(s / 86400)}d ago`;
  }

  private escHtml(s: string): string {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  private playsfx(key: string, volume = 0.5) {
    if (this.muted || !this.cache.audio.exists(key)) return;
    this.sound.play(key, { volume });
  }

  // ── Shared UI helpers ──────────────────────────────────────────────

  private createSmallButton(x: number, y: number, w: number, h: number, label: string, color: 'yellow' | 'green' | 'red') {
    const container = this.add.container(x, y).setDepth(12);
    const schemes = {
      green:  { fill: 0x3a6a2e, border: 0x5a9a4e, text: '#e8e0c8' },
      red:    { fill: 0x8B3333, border: 0xBB4444, text: '#e8e0c8' },
      yellow: { fill: 0x7a6a2a, border: 0xAA9944, text: '#e8e0c8' },
    };
    const s = schemes[color];

    const bg = this.add.graphics();
    bg.fillStyle(s.fill, 0.9);
    bg.fillRoundedRect(-w / 2, -h / 2, w, h, 6);
    bg.lineStyle(1.5, s.border, 0.8);
    bg.strokeRoundedRect(-w / 2, -h / 2, w, h, 6);
    container.add(bg);

    const text = this.add.text(0, 0, label, {
      fontSize: '12px', color: s.text, fontFamily: '"Fredoka", sans-serif', fontStyle: 'bold',
      stroke: '#000', strokeThickness: 2,
    }).setOrigin(0.5);
    container.add(text);

    const zone = this.add.zone(x, y, w, h).setInteractive({ useHandCursor: true }).setDepth(13);
    zone.on('pointerover', () => {
      this.tweens.add({ targets: container, scaleX: 1.06, scaleY: 1.06, duration: 100 });
      text.setColor('#FFD93D');
    });
    zone.on('pointerout', () => {
      this.tweens.add({ targets: container, scaleX: 1, scaleY: 1, duration: 100 });
      text.setColor(s.text);
    });
    zone.on('pointerdown', () => {
      this.playsfx('button_click', 0.3);
      this.tweens.add({ targets: container, scaleX: 0.94, scaleY: 0.94, duration: 50, yoyo: true });
    });

    return { container, zone };
  }

  private createFloatingIcons(width: number, height: number) {
    const iconKeys = ['ts_icon1', 'ts_icon2', 'ts_icon3', 'ts_icon4', 'ts_icon5', 'ts_icon6', 'ts_icon10'];
    const available = iconKeys.filter(k => this.textures.exists(k));
    if (available.length === 0) return;
    for (let i = 0; i < 8; i++) {
      const key = available[i % available.length];
      const img = this.add.image(Math.random() * width, Math.random() * height, key)
        .setScale(0.2 + Math.random() * 0.15).setAlpha(0.03 + Math.random() * 0.03).setDepth(1).setAngle(Math.random() * 360);
      this.tweens.add({
        targets: img, alpha: { from: img.alpha, to: img.alpha * 0.3 },
        scaleX: { from: img.scaleX, to: img.scaleX * 1.1 }, scaleY: { from: img.scaleY, to: img.scaleY * 1.1 },
        duration: 3000 + Math.random() * 4000, yoyo: true, repeat: -1, ease: 'Sine.easeInOut', delay: Math.random() * 2000,
      });
      this.floatingShapes.push({ sprite: img, vx: (Math.random() - 0.5) * 0.15, vy: (Math.random() - 0.5) * 0.1, rot: (Math.random() - 0.5) * 0.08 });
    }
  }
}
