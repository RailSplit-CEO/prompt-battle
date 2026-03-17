// ─── EmoteSync — Firebase RTDB sync for PvP emotes ──────────────
// Pushes emote events to /games/{gameId}/emotes and listens for
// opponent emotes. Old events (>10s) are ignored on reconnect.

import { getDatabase, ref, push, onChildAdded, off } from 'firebase/database';
import { getFirebaseApp } from '../auth/firebaseApp';

// ── Types ────────────────────────────────────────────────────────

export interface EmoteEvent {
  emoteId: string;
  /** Team number of the player who sent the emote (1 or 2). */
  team: number;
  /** Unix timestamp (ms) when the emote was sent. */
  timestamp: number;
}

/** How far back (ms) to accept emotes on listener attach (avoids replays). */
const RECONNECT_CUTOFF_MS = 10_000;

// ─── EmoteSync class ─────────────────────────────────────────────

export class EmoteSync {
  private gameId: string;
  private unsubscribe: (() => void) | null = null;

  constructor(gameId: string) {
    this.gameId = gameId;
  }

  /**
   * Send an emote to the opponent via Firebase.
   *
   * @param emoteId  The emote item ID (e.g. 'emote_gg').
   * @param team     The local player's team number.
   */
  async sendEmote(emoteId: string, team: number): Promise<void> {
    const db = getDatabase(getFirebaseApp());
    const emotesRef = ref(db, `games/${this.gameId}/emotes`);
    await push(emotesRef, {
      emoteId,
      team,
      timestamp: Date.now(),
    } satisfies EmoteEvent);
  }

  /**
   * Listen for opponent emotes. Only emotes from the *other* team
   * are forwarded to the callback. Old emotes (before the cutoff
   * window) are silently discarded.
   *
   * @param myTeam   The local player's team number.
   * @param callback Invoked for each new opponent emote.
   */
  onEmoteReceived(myTeam: number, callback: (emote: EmoteEvent) => void): void {
    // Clean up any previous listener
    this.stopListening();

    const db = getDatabase(getFirebaseApp());
    const emotesRef = ref(db, `games/${this.gameId}/emotes`);

    // Cutoff: ignore emotes older than RECONNECT_CUTOFF_MS
    const cutoff = Date.now() - RECONNECT_CUTOFF_MS;

    const handler = onChildAdded(emotesRef, (snapshot) => {
      const data = snapshot.val() as EmoteEvent | null;
      if (!data) return;

      // Ignore own emotes
      if (data.team === myTeam) return;

      // Ignore stale emotes from before we attached
      if (data.timestamp < cutoff) return;

      callback(data);
    });

    this.unsubscribe = () => off(emotesRef, 'child_added', handler);
  }

  /** Stop listening for opponent emotes. */
  stopListening(): void {
    if (this.unsubscribe) {
      this.unsubscribe();
      this.unsubscribe = null;
    }
  }

  /** Full cleanup — stop listening and release references. */
  destroy(): void {
    this.stopListening();
  }
}
