import { Matchmaking } from '../network/Matchmaking';
import { FirebaseSync, MatchResult } from '../network/FirebaseSync';
import { QueuePopup } from '../ui/QueuePopup';

export type QueueState = 'idle' | 'queuing' | 'match_found';
export type QueueType = 'unranked' | 'ranked' | 'friendly';

export interface MatchFoundData {
  gameId: string;
  opponentName?: string;
  opponentIcon?: string;
  amPlayer1: boolean;
}

export class QueueManager {
  private static instance: QueueManager | null = null;
  private state: QueueState = 'idle';
  private queueType: QueueType | null = null;
  private startTime = 0;
  private timerInterval: number | null = null;
  private matchData: MatchFoundData | null = null;
  private matchmaking: Matchmaking | null = null;
  private listeners: Array<(state: QueueState, elapsed: number) => void> = [];
  private queuePopup: QueuePopup | null = null;

  static getInstance(): QueueManager {
    if (!QueueManager.instance) QueueManager.instance = new QueueManager();
    return QueueManager.instance;
  }

  getState(): QueueState { return this.state; }
  getQueueType(): QueueType | null { return this.queueType; }
  getElapsed(): number { return this.state === 'queuing' ? Math.floor((Date.now() - this.startTime) / 1000) : 0; }
  isQueuing(): boolean { return this.state === 'queuing'; }

  async startQueue(type: QueueType): Promise<void> {
    if (this.state !== 'idle') return;

    this.queueType = type;
    this.state = 'queuing';
    this.startTime = Date.now();
    this.notify();

    // Start timer
    this.timerInterval = window.setInterval(() => this.notify(), 1000);

    try {
      const firebase = FirebaseSync.getInstance();
      await firebase.initialize();

      this.matchmaking = new Matchmaking(firebase, `horde_${type}`);
      const result: MatchResult = await this.matchmaking.joinQueue();

      // Match found!
      if (result && result.gameId) {
        this.matchData = {
          gameId: result.gameId,
          amPlayer1: result.amPlayer1,
          // MatchResult from FirebaseSync doesn't carry opponent info —
          // these stay undefined for now; QueuePopup handles the fallback.
          opponentName: undefined,
          opponentIcon: undefined,
        };
        this.state = 'match_found';
        this.stopTimer();
        this.notify();
        this.showQueuePop();
      }
    } catch (err) {
      console.warn('[Queue] Error:', err);
      this.cancelQueue();
    }
  }

  cancelQueue(): void {
    if (this.matchmaking) {
      this.matchmaking.leaveQueue().catch(() => {});
      this.matchmaking = null;
    }
    this.stopTimer();
    this.state = 'idle';
    this.queueType = null;
    this.matchData = null;
    this.notify();
  }

  private stopTimer(): void {
    if (this.timerInterval !== null) {
      clearInterval(this.timerInterval);
      this.timerInterval = null;
    }
  }

  private showQueuePop(): void {
    if (!this.matchData) return;
    this.queuePopup = new QueuePopup();
    this.queuePopup.show({
      opponentName: this.matchData.opponentName || 'Opponent',
      opponentIcon: this.matchData.opponentIcon,
      queueType: this.queueType || 'unranked',
      onAccept: () => {
        this.queuePopup = null;
        this.acceptMatch();
      },
      onDecline: () => {
        this.queuePopup = null;
        this.cancelQueue();
      },
      onTimeout: () => {
        this.queuePopup = null;
        // Auto-decline on timeout
        this.cancelQueue();
      },
    });
  }

  private acceptMatch(): void {
    if (!this.matchData) return;
    const data = this.matchData;
    const savedType = this.queueType || 'unranked';
    this.state = 'idle';
    this.queueType = null;
    this.matchData = null;
    this.notify();

    // Store game data for HordeScene to pick up
    const auth = (window as any).__authManager;
    localStorage.setItem('pb_active_game', JSON.stringify({
      gameId: data.gameId,
      playerId: auth?.currentUser?.uid || '',
      amPlayer1: data.amPlayer1,
      isOnline: true,
      matchType: savedType,
      savedAt: Date.now(),
    }));

    // Navigate to game — dispatch custom event that MenuScene listens for
    window.dispatchEvent(new CustomEvent('queue-match-accepted', { detail: data }));
  }

  onChange(cb: (state: QueueState, elapsed: number) => void): () => void {
    this.listeners.push(cb);
    return () => { this.listeners = this.listeners.filter(l => l !== cb); };
  }

  private notify(): void {
    const elapsed = this.getElapsed();
    this.listeners.forEach(cb => cb(this.state, elapsed));
  }

  getQueueMessage(): string {
    const elapsed = this.getElapsed();
    if (elapsed < 30) return 'Searching for opponent...';
    if (elapsed < 60) return 'Expanding search range...';
    if (elapsed < 120) return 'Still searching — hang tight...';
    return 'Long queue — consider trying later';
  }

  formatTime(): string {
    const s = this.getElapsed();
    return `${Math.floor(s / 60)}:${(s % 60).toString().padStart(2, '0')}`;
  }
}
