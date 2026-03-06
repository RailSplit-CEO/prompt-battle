import { FirebaseSync, MatchResult } from './FirebaseSync';

export class Matchmaking {
  private firebase: FirebaseSync;

  constructor(firebase: FirebaseSync) {
    this.firebase = firebase;
  }

  async joinQueue(): Promise<MatchResult> {
    return this.firebase.findMatch();
  }

  async leaveQueue(): Promise<void> {
    await this.firebase.removeFromQueue();
  }
}
