import { FirebaseSync, MatchResult } from './FirebaseSync';

export class Matchmaking {
  private firebase: FirebaseSync;
  private queueName: string;

  constructor(firebase: FirebaseSync, queueName = 'waiting') {
    this.firebase = firebase;
    this.queueName = queueName;
  }

  async joinQueue(): Promise<MatchResult> {
    return this.firebase.findMatch(this.queueName);
  }

  async leaveQueue(): Promise<void> {
    await this.firebase.removeFromQueue(this.queueName);
  }
}
