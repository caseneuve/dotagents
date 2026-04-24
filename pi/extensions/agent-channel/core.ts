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

// ─── Message validation ────────────────────────────────────────────────

/** Structural type guard. Any field missing / wrong type → not a message. */
export function isValidMessage(obj: unknown): obj is ChannelMessage {
  if (obj == null || typeof obj !== "object") return false;
  const m = obj as Record<string, unknown>;
  return (
    typeof m.id === "string" &&
    typeof m.channel === "string" &&
    typeof m.from === "string" &&
    typeof m.type === "string" &&
    typeof m.body === "string" &&
    typeof m.timestamp === "number" &&
    Number.isFinite(m.timestamp) &&
    (m.to === undefined || typeof m.to === "string") &&
    (m.acked === undefined || typeof m.acked === "boolean")
  );
}

export interface ParseResult {
  /** Always a well-formed ChannelFile, even on errors (may have empty messages). */
  file: ChannelFile;
  /** Parsed entries that failed isValidMessage() and were skipped. */
  droppedCount: number;
  /** Non-null when the whole payload was unusable (bad JSON or wrong shape). */
  error?: string;
}

/**
 * Safely parse the raw text of a channel file into a ChannelFile.
 * Never throws — returns `{ file: { messages: [] }, error }` on bad JSON or
 * unexpected shape, and drops individual malformed messages when the top-level
 * shape is otherwise fine.
 */
export function parseChannelFile(text: string): ParseResult {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (err) {
    return {
      file: { messages: [] },
      droppedCount: 0,
      error: `invalid JSON: ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  if (raw == null || typeof raw !== "object") {
    return {
      file: { messages: [] },
      droppedCount: 0,
      error: "channel file is not an object",
    };
  }

  const messagesRaw = (raw as { messages?: unknown }).messages;
  if (!Array.isArray(messagesRaw)) {
    return {
      file: { messages: [] },
      droppedCount: 0,
      error: "channel file is missing a `messages` array",
    };
  }

  const valid: ChannelMessage[] = [];
  let dropped = 0;
  for (const entry of messagesRaw) {
    if (isValidMessage(entry)) valid.push(entry);
    else dropped++;
  }
  return { file: { messages: valid }, droppedCount: dropped };
}

// ─── Stream framing ────────────────────────────────────────────────────────

/** Default cap for preview strings. */
export const PREVIEW_MAX = 500;

/** Truncate a string to at most `max` characters, adding a trailing ellipsis
 *  when it actually had to be cut. Pure. */
export function previewString(s: string, max: number = PREVIEW_MAX): string {
  if (s == null) return "";
  return s.length > max ? s.slice(0, max) + "…" : s;
}

/** JSON.stringify that never throws (circular refs / BigInt → `String(v)`). */
export function safeStringify(v: unknown): string {
  try {
    return JSON.stringify(v) ?? String(v);
  } catch {
    return String(v);
  }
}

/**
 * Split a buffer of concatenated JSON frames into complete frames plus any
 * incomplete remainder. Each frame starts with `{` or `[` and is balanced on
 * brackets, ignoring brackets that appear inside JSON string literals.
 *
 * Tolerates:
 *   - whitespace / newlines between frames (what we send today)
 *   - frames glued without a separator ("}{" — observed in the wild)
 *   - frames split across chunks (last incomplete frame goes to `remainder`)
 *
 * Contract notes:
 *   - Between frames, any byte that isn't a JSON opener (`{` / `[`) is
 *     silently skipped — that covers whitespace, leftover newlines, and the
 *     stray bytes we've occasionally seen from buggy relays. Callers that
 *     need to surface upstream corruption should detect it at the parse step
 *     (invalid-JSON-inside-a-frame) or at higher layers.
 *   - Never throws and never calls `JSON.parse`; callers parse the returned
 *     strings and decide how to handle individual parse errors.
 */
export function splitJsonFrames(buf: string): {
  frames: string[];
  remainder: string;
} {
  const frames: string[] = [];
  let depth = 0;
  let inString = false;
  let escape = false;
  let start = -1;

  for (let i = 0; i < buf.length; i++) {
    const c = buf[i];

    if (depth === 0 && start === -1) {
      // Between frames — skip any bytes that aren't a JSON opener.
      if (c === "{" || c === "[") {
        start = i;
        depth = 1;
        // Reset string-scanner state at every frame boundary so a stray
        // escape from a malformed prior chunk can't leak into the next frame.
        inString = false;
        escape = false;
      }
      continue;
    }

    if (inString) {
      if (escape) {
        escape = false;
        continue;
      }
      if (c === "\\") {
        escape = true;
        continue;
      }
      if (c === '"') {
        inString = false;
        continue;
      }
      continue;
    }

    if (c === '"') {
      inString = true;
      continue;
    }
    if (c === "{" || c === "[") {
      depth++;
      continue;
    }
    if (c === "}" || c === "]") {
      depth--;
      if (depth === 0 && start !== -1) {
        frames.push(buf.slice(start, i + 1));
        start = -1;
      }
      continue;
    }
  }

  const remainder = start !== -1 ? buf.slice(start) : "";
  return { frames, remainder };
}
