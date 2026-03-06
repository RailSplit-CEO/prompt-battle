import { RawCommand } from '@prompt-battle/shared';

export class CommandQueue {
  private queue: RawCommand[] = [];
  private processing = false;
  private onProcess?: (cmd: RawCommand) => Promise<void>;

  setProcessor(handler: (cmd: RawCommand) => Promise<void>) {
    this.onProcess = handler;
  }

  enqueue(cmd: RawCommand) {
    this.queue.push(cmd);
    this.processNext();
  }

  private async processNext() {
    if (this.processing || this.queue.length === 0 || !this.onProcess) return;

    this.processing = true;
    const cmd = this.queue.shift()!;

    try {
      await this.onProcess(cmd);
    } catch (err) {
      console.error('Command processing error:', err);
    }

    this.processing = false;
    this.processNext();
  }

  clear() {
    this.queue = [];
  }

  get length() {
    return this.queue.length;
  }

  get isProcessing() {
    return this.processing;
  }
}
