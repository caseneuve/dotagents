// ─── Poller: background polling for incoming channel messages ───────────
import type { ChannelBackend } from "./backends";
import type { ChannelMessage } from "./core";

export class ChannelPoller {
  private timers: Map<string, ReturnType<typeof setInterval>> = new Map();
  private lastSeen: Map<string, number> = new Map();
  private callback: (msgs: ChannelMessage[]) => void;
  private backend: ChannelBackend;
  private intervalMs: number;
  private isOwnMessage: (id: string) => boolean;

  constructor(
    backend: ChannelBackend,
    callback: (msgs: ChannelMessage[]) => void,
    isOwnMessage: (id: string) => boolean,
    intervalMs = 3000,
  ) {
    this.backend = backend;
    this.callback = callback;
    this.isOwnMessage = isOwnMessage;
    this.intervalMs = intervalMs;
  }

  watch(channel: string): void {
    if (this.timers.has(channel)) return;
    this.lastSeen.set(channel, Date.now());
    const timer = setInterval(async () => {
      const since = this.lastSeen.get(channel) || 0;
      const msgs = await this.backend.read(channel, { since });
      // Filter out messages published by this agent instance
      const external = msgs.filter((m) => !this.isOwnMessage(m.id));
      if (external.length > 0) {
        this.lastSeen.set(channel, Math.max(...msgs.map((m) => m.timestamp)));
        this.callback(external);
      } else if (msgs.length > 0) {
        // Still advance lastSeen past own messages to avoid re-reading them
        this.lastSeen.set(channel, Math.max(...msgs.map((m) => m.timestamp)));
      }
    }, this.intervalMs);
    this.timers.set(channel, timer);
  }

  unwatch(channel: string): void {
    const timer = this.timers.get(channel);
    if (timer) {
      clearInterval(timer);
      this.timers.delete(channel);
    }
  }

  stopAll(): void {
    for (const [ch] of this.timers) this.unwatch(ch);
  }
}
