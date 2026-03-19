import { adminCall } from '../store/dev-tools';
import { WalletManager } from '../store/WalletManager';
import { BattlePassManager } from '../store/BattlePassManager';
import { getAuth } from 'firebase/auth';
import { getFirebaseApp } from '../auth/firebaseApp';
import { getDatabase, ref, get, set } from 'firebase/database';

/**
 * Dev panel — fixed to the right side of the screen.
 * Shows current currency/BP status and provides quick actions.
 * Only mounted when dev mode is active.
 */
export class DevPanel {
  private el: HTMLDivElement;
  private crownsEl!: HTMLSpanElement;
  private gloryEl!: HTMLSpanElement;
  private bpEl!: HTMLSpanElement;
  private unsubs: (() => void)[] = [];

  constructor() {
    this.el = document.createElement('div');
    this.el.id = 'dev-panel';
    this.el.style.cssText = `
      position:fixed;top:50%;right:8px;transform:translateY(-50%);z-index:2147483647;
      background:rgba(20,20,30,0.95);border:2px solid #ff0;
      border-radius:8px;padding:12px 14px;
      font:12px 'Segoe UI',monospace;color:#ddd;
      display:flex;flex-direction:column;gap:6px;min-width:150px;
      pointer-events:auto;
    `;
    this.build();
    // Append to documentElement to ensure it's above everything
    (document.documentElement || document.body).appendChild(this.el);
    this.subscribe();
  }

  private build(): void {
    // Title
    const title = document.createElement('div');
    title.textContent = 'DEV';
    title.style.cssText = 'font:bold 11px monospace;color:#ff0;text-align:center;letter-spacing:2px;margin-bottom:2px;';
    this.el.appendChild(title);

    // Status line: crowns
    this.crownsEl = document.createElement('span');
    this.crownsEl.style.cssText = 'color:#ffd700;font-size:11px;';
    this.el.appendChild(this.crownsEl);

    // Status line: glory
    this.gloryEl = document.createElement('span');
    this.gloryEl.style.cssText = 'color:#c084fc;font-size:11px;';
    this.el.appendChild(this.gloryEl);

    // Status line: BP
    this.bpEl = document.createElement('span');
    this.bpEl.style.cssText = 'color:#5bf;font-size:11px;';
    this.el.appendChild(this.bpEl);

    // Divider
    const hr = document.createElement('div');
    hr.style.cssText = 'border-top:1px solid #444;margin:2px 0;';
    this.el.appendChild(hr);

    // Buttons
    this.addBtn('+1000 Crowns', '#ffd700', async () => {
      const auth = getAuth(getFirebaseApp());
      if (!auth.currentUser) return;
      const db = getDatabase(getFirebaseApp());
      const crownsRef = ref(db, `users/${auth.currentUser.uid}/wallet/crowns`);
      const snap = await get(crownsRef);
      await set(crownsRef, (snap.val() || 0) + 1000);
      console.log('[DEV] Crowns:', (snap.val() || 0) + 1000);
    });
    this.addBtn('Reset Crowns', '#aa8800', async () => {
      const auth = getAuth(getFirebaseApp());
      if (!auth.currentUser) return;
      const db = getDatabase(getFirebaseApp());
      await set(ref(db, `users/${auth.currentUser.uid}/wallet/crowns`), 0);
      console.log('[DEV] Crowns: 0');
    });
    this.addBtn('+1000 Glory', '#c084fc', async () => {
      const auth = getAuth(getFirebaseApp());
      if (!auth.currentUser) return;
      const db = getDatabase(getFirebaseApp());
      const gloryRef = ref(db, `users/${auth.currentUser.uid}/wallet/glory`);
      const snap = await get(gloryRef);
      await set(gloryRef, (snap.val() || 0) + 1000);
      console.log('[DEV] Glory:', (snap.val() || 0) + 1000);
    });
    this.addBtn('Reset Glory', '#8855bb', async () => {
      const auth = getAuth(getFirebaseApp());
      if (!auth.currentUser) return;
      const db = getDatabase(getFirebaseApp());
      await set(ref(db, `users/${auth.currentUser.uid}/wallet/glory`), 0);
      console.log('[DEV] Glory: 0');
    });
    this.addBtn('Toggle BP', '#5bf', async () => {
      const auth = getAuth(getFirebaseApp());
      if (!auth.currentUser) return;
      const db = getDatabase(getFirebaseApp());
      const bpRef = ref(db, `users/${auth.currentUser.uid}/battlePass/premium`);
      const snap = await get(bpRef);
      await set(bpRef, snap.val() !== true);
      console.log('[DEV] Battle Pass premium:', snap.val() !== true);
    });
    this.addBtn('+1000 BP XP', '#4ade80', async (btn) => {
      try {
        const auth = getAuth(getFirebaseApp());
        if (!auth.currentUser) return;
        const token = await auth.currentUser.getIdToken(true);
        const res = await fetch('/api/store/grantBattlePassXp', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify({ xp: 1000 }),
        });
        const data = await res.json();
        btn.textContent = data.success ? `T${data.currentTier}!` : 'ERR';
        setTimeout(() => { btn.textContent = '+1000 BP XP'; }, 1200);
      } catch { btn.textContent = 'ERR'; setTimeout(() => { btn.textContent = '+1000 BP XP'; }, 1200); }
    });
    this.addBtn('Reset BP', '#e85050', async () => {
      const auth = getAuth(getFirebaseApp());
      if (!auth.currentUser) return;
      const db = getDatabase(getFirebaseApp());
      const bpPath = `users/${auth.currentUser.uid}/battlePass`;
      await set(ref(db, `${bpPath}/xp`), 0);
      await set(ref(db, `${bpPath}/claimedFree`), null);
      await set(ref(db, `${bpPath}/claimedPremium`), null);
      console.log('[DEV] Battle Pass reset: XP=0, claims cleared');
    });

    // Divider
    const hr2 = document.createElement('div');
    hr2.style.cssText = 'border-top:1px solid #444;margin:2px 0;';
    this.el.appendChild(hr2);

    this.addBtn('Reset Character', '#f55', async () => {
      if (!confirm('DELETE your account and ALL data?\nThis cannot be undone.')) return;
      const auth = getAuth(getFirebaseApp());
      if (!auth.currentUser) return;
      const uid = auth.currentUser.uid;
      const db = getDatabase(getFirebaseApp());
      // Wipe all user data
      await Promise.all([
        set(ref(db, `users/${uid}`), null),
        set(ref(db, `matchHistory/${uid}`), null),
        set(ref(db, `ratings/${uid}`), null),
        set(ref(db, `friends/${uid}`), null),
      ]);
      // Delete auth account + sign out
      try { await auth.currentUser!.delete(); } catch { /* ok */ }
      try { await auth.signOut(); } catch { /* ok */ }
      window.location.reload();
    });

    this.refresh();
  }

  private addBtn(label: string, color: string, onClick: (btn: HTMLButtonElement) => void): void {
    const btn = document.createElement('button');
    btn.textContent = label;
    btn.style.cssText = `
      background:${color}22;border:1px solid ${color}55;color:${color};
      font:bold 11px 'Segoe UI',sans-serif;padding:4px 8px;border-radius:4px;
      cursor:pointer;text-align:center;transition:background 0.15s;
    `;
    btn.onmouseenter = () => btn.style.background = `${color}44`;
    btn.onmouseleave = () => btn.style.background = `${color}22`;
    btn.onclick = () => onClick(btn);
    this.el.appendChild(btn);
  }

  private refresh(): void {
    const w = WalletManager.getInstance().getWallet();
    this.crownsEl.textContent = `Crowns: ${w.crowns}`;
    this.gloryEl.textContent = `Glory: ${w.glory}`;
    const bp = BattlePassManager.getInstance();
    this.bpEl.textContent = `BP: ${bp.premium ? 'PREMIUM' : 'Free'}`;
  }

  private subscribe(): void {
    this.unsubs.push(WalletManager.getInstance().onChange(() => this.refresh()));
    this.unsubs.push(BattlePassManager.getInstance().onChange(() => this.refresh()));
  }

  destroy(): void {
    for (const unsub of this.unsubs) unsub();
    this.unsubs = [];
    this.el.remove();
  }
}
