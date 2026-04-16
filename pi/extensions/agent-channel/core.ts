// ─── Pure core: zero I/O, fully testable ────────────────────────────────
import * as path from "node:path";

// ─── Types ──────────────────────────────────────────────────────────────
export interface ChannelMessage {
  id: string;
  channel: string;
  from: string;
  to?: string;
  type: string;
  body: string;
  timestamp: number;
  acked?: boolean;
}

export interface ChannelFile {
  messages: ChannelMessage[];
}

export interface FilterOpts {
  since?: number;
  unacked?: boolean;
  type?: string;
}

// ─── Pure functions ─────────────────────────────────────────────────────

/** Build the filesystem path for a channel name. Pure string→string. */
export function channelPath(channelDir: string, channel: string): string {
  const safe = channel.replace(/[^a-zA-Z0-9._-]/g, "_");
  return path.join(channelDir, `${safe}.json`);
}

/** Filter messages by since/unacked/type. Shared across all backends. */
export function filterMessages(
  msgs: ChannelMessage[],
  opts?: FilterOpts,
): ChannelMessage[] {
  let result = msgs;
  if (opts?.since) result = result.filter((m) => m.timestamp > opts.since!);
  if (opts?.unacked) result = result.filter((m) => !m.acked);
  if (opts?.type) result = result.filter((m) => m.type === opts.type);
  return result;
}

/**
 * Ack messages in a channel file. Returns a NEW ChannelFile — no mutation.
 * Supports three modes: "*" (all), "last" (most recent unacked), or specific id.
 */
export function ackMessages(
  file: ChannelFile,
  messageId: string,
): { file: ChannelFile; ackedCount: number } {
  const messages = file.messages.map((m) => ({ ...m }));
  let ackedCount = 0;

  if (messageId === "*") {
    for (const m of messages) {
      if (!m.acked) {
        m.acked = true;
        ackedCount++;
      }
    }
  } else if (messageId === "last") {
    const unacked = messages.filter((m) => !m.acked);
    const last = unacked[unacked.length - 1];
    if (last) {
      last.acked = true;
      ackedCount = 1;
    }
  } else {
    const msg = messages.find((m) => m.id === messageId);
    if (msg) {
      msg.acked = true;
      ackedCount = 1;
    }
  }

  return { file: { messages }, ackedCount };
}

/**
 * Determine whether an incoming message should trigger an agent turn.
 * Presence messages and OUT-terminated messages do not trigger.
 */
export function shouldTriggerTurn(msg: ChannelMessage): boolean {
  if (msg.type === "presence") return false;
  const trimmed = msg.body.trimEnd();
  if (/\bOUT$/i.test(trimmed)) return false;
  return true;
}
