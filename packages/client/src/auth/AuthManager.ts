import { getFirebaseApp } from './firebaseApp';
import {
  getAuth,
  signInWithPopup,
  signInAnonymously,
  linkWithPopup,
  GoogleAuthProvider,
  onAuthStateChanged,
  setPersistence,
  browserLocalPersistence,
  signOut as firebaseSignOut,
  Auth,
  User,
} from 'firebase/auth';
import {
  getDatabase,
  ref,
  get,
  set,
  push,
  update,
  remove,
  onValue,
  onChildAdded,
  onDisconnect,
  query,
  orderByChild,
  equalTo,
  limitToLast,
  serverTimestamp,
  Database,
} from 'firebase/database';

// ── Exported interfaces ──────────────────────────────────────────────

export interface UserProfile {
  uid: string;
  username: string;
  icon: string;
  provider: 'google' | 'anonymous';
  createdAt: number;
  lastSeen: number;
  online: boolean;
}

export interface MatchHistoryEntry {
  result: 'win' | 'loss';
  opponentName: string;
  opponentIcon: string;
  opponentUid: string;
  durationMs: number;
  datePlayed: number;
  mapName: string;
}

export interface FriendEntry {
  uid: string;
  username: string;
  icon: string;
  status: 'accepted' | 'pending_sent' | 'pending_received';
  online: boolean;
  lastSeen: number;
}

export interface MatchInvite {
  inviteId: string;
  from: string;
  fromUsername: string;
  fromIcon: string;
  gameId: string;
  status: 'pending' | 'accepted' | 'declined' | 'expired';
  timestamp: number;
  expiresAt: number;
}

// ── AuthManager singleton ────────────────────────────────────────────

export class AuthManager {
  private static instance: AuthManager;

  private auth!: Auth;
  private db!: Database;
  private initialized = false;

  public currentUser: User | null = null;
  public userProfile: UserProfile | null = null;

  private listeners: Array<() => void> = [];
  private profileCache: Map<string, UserProfile> = new Map();

  private constructor() {}

  static getInstance(): AuthManager {
    if (!AuthManager.instance) {
      AuthManager.instance = new AuthManager();
    }
    return AuthManager.instance;
  }

  // ── helpers ──────────────────────────────────────────────────────

  private addListener(unsub: () => void): void {
    this.listeners.push(unsub);
  }

  get isGuest(): boolean {
    return this.currentUser?.isAnonymous ?? true;
  }

  // ── Auth ─────────────────────────────────────────────────────────

  async initFirebase(): Promise<void> {
    if (this.initialized) return;

    const app = getFirebaseApp();
    this.auth = getAuth(app);
    this.db = getDatabase(app);
    await setPersistence(this.auth, browserLocalPersistence);
    this.initialized = true;
  }

  waitForExistingSession(): Promise<User | null> {
    return new Promise<User | null>((resolve) => {
      let settled = false;

      const timeout = setTimeout(() => {
        if (!settled) {
          settled = true;
          unsub();
          resolve(null);
        }
      }, 2000);

      const unsub = onAuthStateChanged(this.auth, (user) => {
        if (!settled) {
          settled = true;
          clearTimeout(timeout);
          unsub();
          this.currentUser = user;
          resolve(user);
        }
      });
    });
  }

  async signInWithGoogle(): Promise<User> {
    const provider = new GoogleAuthProvider();
    const cred = await signInWithPopup(this.auth, provider);
    this.currentUser = cred.user;
    return cred.user;
  }

  async signInAsGuest(): Promise<User> {
    const cred = await signInAnonymously(this.auth);
    this.currentUser = cred.user;
    return cred.user;
  }

  async linkGuestToGoogle(): Promise<User> {
    if (!this.auth.currentUser) {
      throw new Error('No current user to link');
    }
    try {
      const provider = new GoogleAuthProvider();
      const cred = await linkWithPopup(this.auth.currentUser, provider);
      this.currentUser = cred.user;
      return cred.user;
    } catch (err: any) {
      if (err?.code === 'auth/credential-already-in-use') {
        const provider = new GoogleAuthProvider();
        const cred = await signInWithPopup(this.auth, provider);
        this.currentUser = cred.user;
        return cred.user;
      }
      throw err;
    }
  }

  async signOut(): Promise<void> {
    await firebaseSignOut(this.auth);
    this.currentUser = null;
    this.userProfile = null;
  }

  // ── Profile CRUD ─────────────────────────────────────────────────

  async getProfile(uid: string): Promise<UserProfile | null> {
    const snap = await get(ref(this.db, `users/${uid}`));
    if (!snap.exists()) return null;
    return snap.val() as UserProfile;
  }

  async createProfile(
    uid: string,
    username: string,
    icon: string,
    provider: 'google' | 'anonymous',
  ): Promise<void> {
    const lowerName = username.toLowerCase();
    const profile: UserProfile = {
      uid,
      username,
      icon,
      provider,
      createdAt: Date.now(),
      lastSeen: Date.now(),
      online: true,
    };
    const updates: Record<string, any> = {
      [`users/${uid}`]: profile,
      [`usernames/${lowerName}`]: uid,
    };
    await update(ref(this.db), updates);
    this.userProfile = profile;
  }

  async checkUsernameAvailable(username: string): Promise<boolean> {
    const lowerName = username.toLowerCase();
    const snap = await get(ref(this.db, `usernames/${lowerName}`));
    return !snap.exists();
  }

  async loadMyProfile(): Promise<void> {
    if (!this.currentUser) {
      this.userProfile = null;
      return;
    }
    this.userProfile = await this.getProfile(this.currentUser.uid);
  }

  // ── Presence ─────────────────────────────────────────────────────

  setupPresence(): void {
    if (!this.currentUser) return;
    const uid = this.currentUser.uid;

    const connectedRef = ref(this.db, '.info/connected');
    const onlineRef = ref(this.db, `users/${uid}/online`);
    const lastSeenRef = ref(this.db, `users/${uid}/lastSeen`);

    const unsub = onValue(connectedRef, (snap) => {
      if (snap.val() === true) {
        onDisconnect(onlineRef).set(false);
        onDisconnect(lastSeenRef).set(serverTimestamp());
        set(onlineRef, true);
      }
    });
    this.addListener(unsub);
  }

  // ── Match History ────────────────────────────────────────────────

  async writeMatchResult(entry: MatchHistoryEntry): Promise<void> {
    if (!this.currentUser) throw new Error('Not authenticated');
    const uid = this.currentUser.uid;
    const listRef = ref(this.db, `matchHistory/${uid}`);
    await push(listRef, entry);
  }

  async getMatchHistory(limit = 20): Promise<MatchHistoryEntry[]> {
    if (!this.currentUser) throw new Error('Not authenticated');
    const uid = this.currentUser.uid;
    const q = query(
      ref(this.db, `matchHistory/${uid}`),
      limitToLast(limit),
    );
    const snap = await get(q);
    if (!snap.exists()) return [];
    const entries: MatchHistoryEntry[] = [];
    snap.forEach((child) => {
      entries.push(child.val() as MatchHistoryEntry);
    });
    return entries;
  }

  // ── Friends ──────────────────────────────────────────────────────

  async searchByUsername(username: string): Promise<UserProfile | null> {
    const q = query(
      ref(this.db, 'users'),
      orderByChild('username'),
      equalTo(username),
    );
    const snap = await get(q);
    if (!snap.exists()) return null;
    let result: UserProfile | null = null;
    snap.forEach((child) => {
      if (!result) {
        result = child.val() as UserProfile;
      }
    });
    return result;
  }

  async sendFriendRequest(targetUid: string): Promise<void> {
    if (!this.currentUser) throw new Error('Not authenticated');
    const myUid = this.currentUser.uid;
    const now = Date.now();
    const updates: Record<string, any> = {
      [`friends/${myUid}/${targetUid}`]: { status: 'pending_sent', since: now },
      [`friends/${targetUid}/${myUid}`]: { status: 'pending_received', since: now },
    };
    await update(ref(this.db), updates);
  }

  async acceptRequest(friendUid: string): Promise<void> {
    if (!this.currentUser) throw new Error('Not authenticated');
    const myUid = this.currentUser.uid;
    const now = Date.now();
    const updates: Record<string, any> = {
      [`friends/${myUid}/${friendUid}/status`]: 'accepted',
      [`friends/${myUid}/${friendUid}/since`]: now,
      [`friends/${friendUid}/${myUid}/status`]: 'accepted',
      [`friends/${friendUid}/${myUid}/since`]: now,
    };
    await update(ref(this.db), updates);
  }

  async declineRequest(friendUid: string): Promise<void> {
    if (!this.currentUser) throw new Error('Not authenticated');
    const myUid = this.currentUser.uid;
    const updates: Record<string, any> = {
      [`friends/${myUid}/${friendUid}`]: null,
      [`friends/${friendUid}/${myUid}`]: null,
    };
    await update(ref(this.db), updates);
  }

  async removeFriend(friendUid: string): Promise<void> {
    if (!this.currentUser) throw new Error('Not authenticated');
    const myUid = this.currentUser.uid;
    const updates: Record<string, any> = {
      [`friends/${myUid}/${friendUid}`]: null,
      [`friends/${friendUid}/${myUid}`]: null,
    };
    await update(ref(this.db), updates);
  }

  onFriendsChanged(cb: (friends: FriendEntry[]) => void): () => void {
    if (!this.currentUser) throw new Error('Not authenticated');
    const myUid = this.currentUser.uid;
    const friendsRef = ref(this.db, `friends/${myUid}`);

    const unsub = onValue(friendsRef, async (snap) => {
      if (!snap.exists()) {
        cb([]);
        return;
      }

      const raw = snap.val() as Record<string, { status: string; since: number }>;
      const entries: FriendEntry[] = [];

      const fetchPromises = Object.entries(raw).map(async ([friendUid, data]) => {
        let profile = this.profileCache.get(friendUid);
        if (!profile) {
          profile = (await this.getProfile(friendUid)) ?? undefined;
          if (profile) {
            this.profileCache.set(friendUid, profile);
          }
        }

        entries.push({
          uid: friendUid,
          username: profile?.username ?? 'Unknown',
          icon: profile?.icon ?? '',
          status: data.status as FriendEntry['status'],
          online: profile?.online ?? false,
          lastSeen: profile?.lastSeen ?? 0,
        });
      });

      await Promise.all(fetchPromises);
      cb(entries);
    });

    this.addListener(unsub);
    return unsub;
  }

  // ── Invites ──────────────────────────────────────────────────────

  async sendInvite(targetUid: string): Promise<{ inviteId: string; gameId: string }> {
    if (!this.currentUser) throw new Error('Not authenticated');
    if (!this.userProfile) throw new Error('Profile not loaded');

    const myUid = this.currentUser.uid;
    const gameId = push(ref(this.db, 'games')).key!;

    const gameMeta = {
      player1: myUid,
      player2: targetUid,
      mapSeed: Date.now(),
      status: 'waiting_for_invite',
      currentTurn: 0,
      createdAt: Date.now(),
    };
    await set(ref(this.db, `games/${gameId}/meta`), gameMeta);

    const inviteRef = push(ref(this.db, `invites/${targetUid}`));
    const inviteId = inviteRef.key!;

    const now = Date.now();
    const invite: MatchInvite = {
      inviteId,
      from: myUid,
      fromUsername: this.userProfile.username,
      fromIcon: this.userProfile.icon,
      gameId,
      status: 'pending',
      timestamp: now,
      expiresAt: now + 60_000,
    };
    await set(inviteRef, invite);

    // If we disconnect, mark invite as expired
    onDisconnect(ref(this.db, `invites/${targetUid}/${inviteId}/status`)).set('expired');

    return { inviteId, gameId };
  }

  async acceptInvite(inviteId: string): Promise<string> {
    if (!this.currentUser) throw new Error('Not authenticated');
    const myUid = this.currentUser.uid;

    const inviteRef = ref(this.db, `invites/${myUid}/${inviteId}`);
    const snap = await get(inviteRef);
    if (!snap.exists()) throw new Error('Invite not found');

    const invite = snap.val() as MatchInvite;
    const gameId = invite.gameId;

    const updates: Record<string, any> = {
      [`invites/${myUid}/${inviteId}/status`]: 'accepted',
      [`games/${gameId}/meta/status`]: 'drafting',
    };
    await update(ref(this.db), updates);

    return gameId;
  }

  async declineInvite(inviteId: string): Promise<void> {
    if (!this.currentUser) throw new Error('Not authenticated');
    const myUid = this.currentUser.uid;
    await set(ref(this.db, `invites/${myUid}/${inviteId}/status`), 'declined');
  }

  onIncomingInvites(cb: (invite: MatchInvite) => void): () => void {
    if (!this.currentUser) throw new Error('Not authenticated');
    const myUid = this.currentUser.uid;
    const invitesRef = ref(this.db, `invites/${myUid}`);

    const unsub = onChildAdded(invitesRef, (snap) => {
      const invite = snap.val() as MatchInvite;
      if (invite.status === 'pending' && invite.expiresAt > Date.now()) {
        cb(invite);
      }
    });

    this.addListener(unsub);
    return unsub;
  }

  waitForInviteResponse(
    targetUid: string,
    inviteId: string,
  ): Promise<'accepted' | 'declined' | 'expired'> {
    return new Promise<'accepted' | 'declined' | 'expired'>((resolve) => {
      let settled = false;

      const statusRef = ref(this.db, `invites/${targetUid}/${inviteId}/status`);

      const timeout = setTimeout(() => {
        if (!settled) {
          settled = true;
          unsub();
          // Mark as expired in DB
          set(statusRef, 'expired');
          resolve('expired');
        }
      }, 60_000);

      const unsub = onValue(statusRef, (snap) => {
        if (settled) return;
        const status = snap.val() as string | null;
        if (status === 'accepted' || status === 'declined' || status === 'expired') {
          settled = true;
          clearTimeout(timeout);
          unsub();
          resolve(status);
        }
      });

      this.addListener(unsub);
    });
  }

  async cleanupInvite(
    targetUid: string,
    inviteId: string,
    gameId: string,
  ): Promise<void> {
    const updates: Record<string, any> = {
      [`invites/${targetUid}/${inviteId}`]: null,
    };

    // Remove game if it was never accepted (still waiting_for_invite)
    const gameSnap = await get(ref(this.db, `games/${gameId}/meta/status`));
    if (gameSnap.exists() && gameSnap.val() === 'waiting_for_invite') {
      updates[`games/${gameId}`] = null;
    }

    await update(ref(this.db), updates);
  }

  // ── Cleanup ──────────────────────────────────────────────────────

  cleanup(): void {
    for (const unsub of this.listeners) {
      unsub();
    }
    this.listeners = [];
    this.profileCache.clear();
  }
}
