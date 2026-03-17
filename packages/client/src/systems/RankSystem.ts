import { getDatabase, ref, get, set } from 'firebase/database';
import { getFirebaseApp } from '../auth/firebaseApp';
import { AuthManager } from '../auth/AuthManager';

// ── Rating data ──────────────────────────────────────────────────────

export interface PlayerRating {
  rating: number;
  peakRating: number;
  wins: number;
  losses: number;
  streak: number;           // +N win streak, -N loss streak
  gamesPlayed: number;
  tier: string;             // e.g. "knight_3"
  provisional: boolean;
  lastMatchAt: number;
}

// ── Rank tier definitions (medieval themed) ──────────────────────────

export interface RankTierDef {
  name: string;
  min: number;
  max: number;
  divisions: number;        // 0 = no divisions (apex tier)
  divSize: number;
  emoji: string;
  color: string;
}

export const RANK_TIERS: RankTierDef[] = [
  { name: 'Peasant',  min: 100,  max: 499,  divisions: 4, divSize: 100, emoji: '🌾', color: '#8B7355' },
  { name: 'Militia',  min: 500,  max: 899,  divisions: 4, divSize: 100, emoji: '⚔️', color: '#C0C0C0' },
  { name: 'Knight',   min: 900,  max: 1199, divisions: 4, divSize: 75,  emoji: '🛡️', color: '#4a8aBB' },
  { name: 'Baron',    min: 1200, max: 1499, divisions: 4, divSize: 75,  emoji: '🏰', color: '#FFD700' },
  { name: 'Duke',     min: 1500, max: 1799, divisions: 4, divSize: 75,  emoji: '👑', color: '#00CED1' },
  { name: 'King',     min: 1800, max: 2099, divisions: 4, divSize: 75,  emoji: '🦁', color: '#9B59B6' },
  { name: 'Emperor',  min: 2100, max: 2399, divisions: 4, divSize: 75,  emoji: '⚜️', color: '#FF4500' },
  { name: 'Legend',   min: 2400, max: Infinity, divisions: 0, divSize: 0, emoji: '🏆', color: '#FFD93D' },
];

// ── Constants ────────────────────────────────────────────────────────

const DEFAULT_RATING = 1000;
const RATING_FLOOR = 100;
const PROVISIONAL_GAMES = 10;
const K_PROVISIONAL = 40;
const K_STANDARD = 24;
const K_VETERAN = 16;

// ── Pure functions ───────────────────────────────────────────────────

export function ratingToTier(rating: number): { name: string; division: number; emoji: string; color: string } {
  const clamped = Math.max(RATING_FLOOR, rating);
  for (const t of RANK_TIERS) {
    if (clamped >= t.min && clamped <= t.max) {
      if (t.divisions === 0) return { name: t.name, division: 0, emoji: t.emoji, color: t.color };
      const offset = clamped - t.min;
      const div = Math.min(t.divisions - 1, Math.floor(offset / t.divSize));
      return { name: t.name, division: t.divisions - div, emoji: t.emoji, color: t.color };
    }
  }
  return { name: 'Peasant', division: 4, emoji: '🌾', color: '#8B7355' };
}

export function tierDisplayName(rating: number): string {
  const t = ratingToTier(rating);
  if (t.division === 0) return t.name;
  const roman: Record<number, string> = { 1: 'I', 2: 'II', 3: 'III', 4: 'IV' };
  return `${t.name} ${roman[t.division] ?? t.division}`;
}

export function tierKey(rating: number): string {
  const t = ratingToTier(rating);
  if (t.division === 0) return t.name.toLowerCase();
  return `${t.name.toLowerCase()}_${t.division}`;
}

function getKFactor(rating: number, gamesPlayed: number): number {
  if (gamesPlayed < PROVISIONAL_GAMES) return K_PROVISIONAL;
  if (rating >= 2000) return K_VETERAN;
  return K_STANDARD;
}

function expectedScore(ratingA: number, ratingB: number): number {
  return 1 / (1 + Math.pow(10, (ratingB - ratingA) / 400));
}

export function calculateElo(
  myRating: number, oppRating: number, won: boolean, gamesPlayed: number,
): number {
  const K = getKFactor(myRating, gamesPlayed);
  const E = expectedScore(myRating, oppRating);
  const S = won ? 1 : 0;
  const delta = Math.round(K * (S - E));
  return Math.max(RATING_FLOOR, myRating + delta);
}

export function getDefaultRating(): PlayerRating {
  return {
    rating: DEFAULT_RATING,
    peakRating: DEFAULT_RATING,
    wins: 0,
    losses: 0,
    streak: 0,
    gamesPlayed: 0,
    tier: tierKey(DEFAULT_RATING),
    provisional: true,
    lastMatchAt: 0,
  };
}

/** Progress to next division (0-1). Returns 0 for apex tier. */
export function divisionProgress(rating: number): { progress: number; nextLabel: string } {
  const clamped = Math.max(RATING_FLOOR, rating);
  for (const t of RANK_TIERS) {
    if (clamped >= t.min && clamped <= t.max) {
      if (t.divisions === 0) return { progress: 0, nextLabel: '' };
      const offset = clamped - t.min;
      const divIdx = Math.min(t.divisions - 1, Math.floor(offset / t.divSize));
      const divStart = t.min + divIdx * t.divSize;
      const divEnd = divStart + t.divSize;
      const prog = (clamped - divStart) / (divEnd - divStart);

      // Next division label
      const nextDiv = t.divisions - divIdx - 1;
      let nextLabel: string;
      if (nextDiv <= 0) {
        // Next is next tier
        const nextTierIdx = RANK_TIERS.indexOf(t) + 1;
        nextLabel = nextTierIdx < RANK_TIERS.length
          ? `${RANK_TIERS[nextTierIdx].name} IV`
          : 'Legend';
      } else {
        const roman: Record<number, string> = { 1: 'I', 2: 'II', 3: 'III', 4: 'IV' };
        nextLabel = `${t.name} ${roman[nextDiv] ?? nextDiv}`;
      }
      return { progress: Math.min(1, prog), nextLabel };
    }
  }
  return { progress: 0, nextLabel: '' };
}

// ── Firebase read/write ──────────────────────────────────────────────

export async function loadRating(uid: string): Promise<PlayerRating | null> {
  const db = getDatabase(getFirebaseApp());
  const snap = await get(ref(db, `ratings/${uid}`));
  return snap.exists() ? snap.val() as PlayerRating : null;
}

export async function saveRating(data: PlayerRating): Promise<void> {
  const auth = AuthManager.getInstance();
  if (!auth.currentUser) return;
  const uid = auth.currentUser.uid;
  const db = getDatabase(getFirebaseApp());

  // Update tier field
  data.tier = tierKey(data.rating);

  await set(ref(db, `ratings/${uid}`), data);

  // Denormalized leaderboard entry
  if (auth.userProfile) {
    await set(ref(db, `leaderboard/${uid}`), {
      uid,
      username: auth.userProfile.username,
      icon: auth.userProfile.icon,
      rating: data.rating,
      tier: data.tier,
      wins: data.wins,
      losses: data.losses,
    });
  }
}

/**
 * Full rating update after a ranked match.
 * Returns { oldRating, newRating, delta } for display.
 */
export async function updateRatingAfterMatch(
  opponentUid: string, won: boolean,
): Promise<{ oldRating: number; newRating: number; delta: number }> {
  const auth = AuthManager.getInstance();
  if (!auth.currentUser) throw new Error('Not authenticated');
  const myUid = auth.currentUser.uid;

  // Load both ratings
  let myData = await loadRating(myUid) ?? getDefaultRating();
  const oppData = await loadRating(opponentUid) ?? getDefaultRating();

  const oldRating = myData.rating;
  const newRating = calculateElo(myData.rating, oppData.rating, won, myData.gamesPlayed);

  myData = {
    ...myData,
    rating: newRating,
    peakRating: Math.max(myData.peakRating, newRating),
    wins: myData.wins + (won ? 1 : 0),
    losses: myData.losses + (won ? 0 : 1),
    streak: won ? (myData.streak > 0 ? myData.streak + 1 : 1) : (myData.streak < 0 ? myData.streak - 1 : -1),
    gamesPlayed: myData.gamesPlayed + 1,
    provisional: myData.gamesPlayed + 1 < PROVISIONAL_GAMES,
    lastMatchAt: Date.now(),
  };

  await saveRating(myData);

  return { oldRating, newRating, delta: newRating - oldRating };
}
