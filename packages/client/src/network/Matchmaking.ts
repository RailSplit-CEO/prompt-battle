import { FirebaseSync } from './FirebaseSync';

export class Matchmaking {
  private firebase: FirebaseSync;
  private pollInterval?: number;

  constructor(firebase: FirebaseSync) {
    this.firebase = firebase;
  }

  async joinQueue(): Promise<string> {
    const playerId = await this.firebase.joinMatchmakingQueue();
    return this.firebase.waitForMatch(playerId);
  }

  async leaveQueue(): Promise<void> {
    if (this.pollInterval) {
      clearInterval(this.pollInterval);
    }
    await this.firebase.removeFromQueue();
  }
}
