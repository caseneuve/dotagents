// ─── Transport + Display interfaces ─────────────────────────────────────
import type { ChannelMessage, FilterOpts } from "./core";

// ─── MessageTransport: messaging over any medium ────────────────────────
export interface MessageTransport {
  /** Transport name, e.g. "file", "uds", "http" */
  readonly name: string;

  /** Publish a message to a channel. */
  publish(msg: ChannelMessage): Promise<void>;

  /** Read messages from a channel with optional filtering. */
  read(channel: string, opts?: FilterOpts): Promise<ChannelMessage[]>;

  /** Ack a message. Supports "last", "*", or specific id. */
  ack(channel: string, messageId: string): Promise<{ ackedCount: number }>;

  /** Subscribe to a channel for push delivery of new messages. */
  subscribe(
    channel: string,
    callback: (msgs: ChannelMessage[]) => void,
    opts?: { intervalMs?: number },
  ): void;

  /** Unsubscribe from a channel. */
  unsubscribe(channel: string): void;

  /** Unsubscribe from all channels. */
  unsubscribeAll(): void;
}

// ─── StatusDisplay: local sidebar/notification output ───────────────────
export interface StatusDisplay {
  /** Display name, e.g. "cmux", "tmux", "noop" */
  readonly name: string;

  /** Set a sidebar status pill. */
  setStatus(key: string, value: string, icon?: string): Promise<void>;

  /** Set sidebar progress bar. */
  setProgress(fraction: number, label: string): Promise<void>;

  /** Clear sidebar progress bar. */
  clearProgress(): Promise<void>;

  /** Append a log line to the sidebar. */
  log(message: string, level?: string, source?: string): Promise<void>;

  /** Send a notification to the human. */
  notify(title: string, body: string): Promise<void>;
}
