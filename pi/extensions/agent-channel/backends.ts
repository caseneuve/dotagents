// ─── Backends: thin I/O wrappers over core.ts pure functions ────────────
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { execFileSync } from "node:child_process";
import {
  channelPath,
  filterMessages,
  ackMessages,
  type ChannelMessage,
  type ChannelFile,
  type FilterOpts,
} from "./core";

// ─── Backend interface (pluggable) ─────────────────────────────────────
export interface ChannelBackend {
  /** Unique backend name, e.g. "cmux", "tmux", "file" */
  name: string;
  /** Publish a message to the channel. */
  publish(msg: ChannelMessage): Promise<void>;
  /** Read messages from a channel, optionally filtering. */
  read(channel: string, opts?: FilterOpts): Promise<ChannelMessage[]>;
  /** Mark a message as acked. Supports "last" (most recent unacked) and "*" (all unacked). */
  ack(channel: string, messageId: string): Promise<{ ackedCount: number }>;
  /** Set sidebar status (no-op on backends without sidebar). */
  setStatus(key: string, value: string, icon?: string): Promise<void>;
  /** Set sidebar progress (no-op on backends without sidebar). */
  setProgress(fraction: number, label: string): Promise<void>;
  /** Clear sidebar progress. */
  clearProgress(): Promise<void>;
  /** Append a sidebar log line. */
  log(message: string, level?: string, source?: string): Promise<void>;
  /** Send a notification. */
  notify(title: string, body: string): Promise<void>;
}

// ─── File-based channel store (shared between backends) ────────────────
// NOTE: File I/O uses read-mutate-write which is not atomic. Concurrent writes
// from multiple agents can race. This is acceptable for local dev — channel files
// are append-mostly and the worst case is a lost message, not corruption.
// A future improvement could use file locking or append-only logs.
export const CHANNEL_DIR = path.join(os.homedir(), ".agent-channels");

export function readChannelFile(channel: string): ChannelFile {
  const p = channelPath(CHANNEL_DIR, channel);
  if (!fs.existsSync(p)) return { messages: [] };
  try {
    return JSON.parse(fs.readFileSync(p, "utf-8"));
  } catch (err) {
    console.error(
      `[agent-channel] failed to parse ${p}: ${err instanceof Error ? err.message : err}`,
    );
    return { messages: [] };
  }
}

export function writeChannelFile(channel: string, data: ChannelFile): void {
  fs.mkdirSync(CHANNEL_DIR, { recursive: true });
  fs.writeFileSync(
    channelPath(CHANNEL_DIR, channel),
    JSON.stringify(data, null, 2),
  );
}

// ─── Shared messaging methods (identical across all backends) ──────────
function publishMessage(msg: ChannelMessage): void {
  const file = readChannelFile(msg.channel);
  file.messages.push(msg);
  writeChannelFile(msg.channel, file);
}

function readMessages(channel: string, opts?: FilterOpts): ChannelMessage[] {
  const file = readChannelFile(channel);
  return filterMessages(file.messages, opts);
}

function ackMessage(
  channel: string,
  messageId: string,
): { ackedCount: number } {
  const original = readChannelFile(channel);
  const result = ackMessages(original, messageId);
  if (result.ackedCount > 0) writeChannelFile(channel, result.file);
  return { ackedCount: result.ackedCount };
}

// ─── Helpers ──────────────────────────────────────────────────────────
export function execArgs(args: string[]): string {
  try {
    return execFileSync(args[0], args.slice(1), {
      encoding: "utf-8",
      timeout: 5000,
    }).trim();
  } catch (err) {
    console.error(
      `[agent-channel] exec failed: ${args.join(" ")}: ${err instanceof Error ? err.message : err}`,
    );
    return "";
  }
}

function hasCmux(): boolean {
  try {
    execFileSync("cmux", ["ping"], { encoding: "utf-8", timeout: 5000 });
    return true;
  } catch {
    return false;
  }
}

function hasTmux(): boolean {
  return !!process.env.TMUX;
}

function hasNotifySend(): boolean {
  try {
    execFileSync("which", ["notify-send"], {
      encoding: "utf-8",
      timeout: 5000,
    });
    return true;
  } catch {
    return false;
  }
}

// ─── CmuxBackend ──────────────────────────────────────────────────────
class CmuxBackend implements ChannelBackend {
  name = "cmux";

  async publish(msg: ChannelMessage): Promise<void> {
    publishMessage(msg);
  }

  async read(channel: string, opts?: FilterOpts): Promise<ChannelMessage[]> {
    return readMessages(channel, opts);
  }

  async ack(
    channel: string,
    messageId: string,
  ): Promise<{ ackedCount: number }> {
    return ackMessage(channel, messageId);
  }

  async setStatus(key: string, value: string, icon?: string): Promise<void> {
    const args = ["cmux", "set-status", key, value];
    if (icon) args.push("--icon", icon);
    execArgs(args);
  }

  async setProgress(fraction: number, label: string): Promise<void> {
    execArgs(["cmux", "set-progress", String(fraction), "--label", label]);
  }

  async clearProgress(): Promise<void> {
    execArgs(["cmux", "clear-progress"]);
  }

  async log(message: string, level?: string, source?: string): Promise<void> {
    const args = ["cmux", "log"];
    if (level) args.push("--level", level);
    if (source) args.push("--source", source);
    args.push("--", message);
    execArgs(args);
  }

  async notify(title: string, body: string): Promise<void> {
    execArgs(["cmux", "notify", "--title", title, "--body", body]);
  }
}

// ─── TmuxBackend (Linux/cross-platform, tmux status + notifications) ──

/** Notification strategy for TmuxBackend. */
type TmuxNotifyMode = "tmux" | "notify-send" | "auto";

export class TmuxBackend implements ChannelBackend {
  name = "tmux";
  private notifyMode: TmuxNotifyMode;
  private useNotifySend: boolean;
  /** Pane ID for this pi instance — all tmux commands target this pane. */
  private paneId: string;

  constructor(notifyMode: TmuxNotifyMode = "auto") {
    this.notifyMode = notifyMode;
    this.useNotifySend =
      notifyMode === "notify-send" ||
      (notifyMode === "auto" && hasNotifySend());
    // Capture the pane we're running in — never changes, even if focus moves.
    this.paneId =
      process.env.TMUX_PANE ||
      execArgs(["tmux", "display-message", "-p", "#{pane_id}"]) ||
      "";
  }

  // ── Helpers: always target our pane ──

  private setOpt(opt: string, value: string): void {
    execArgs(["tmux", "set-option", "-p", "-t", this.paneId, opt, value]);
  }

  private unsetOpt(opt: string): void {
    execArgs(["tmux", "set-option", "-pu", "-t", this.paneId, opt]);
  }

  /** Configure tmux pane border to show agent status automatically.
   *  Called when comms are turned ON. */
  setup(): void {
    this.setOpt("pane-border-status", "top");
    this.setOpt(
      "pane-border-format",
      " #{@agent-agent}#{?@agent-progress, [#{@agent-progress}],} ",
    );
  }

  /** Restore tmux pane border to its pre-comms state.
   *  Called when comms are turned OFF or session shuts down. */
  teardown(): void {
    this.unsetOpt("@agent-agent");
    this.unsetOpt("@agent-progress");
    this.unsetOpt("pane-border-status");
    this.unsetOpt("pane-border-format");
  }

  // ── Messaging (shared) ──

  async publish(msg: ChannelMessage): Promise<void> {
    publishMessage(msg);
  }

  async read(channel: string, opts?: FilterOpts): Promise<ChannelMessage[]> {
    return readMessages(channel, opts);
  }

  async ack(
    channel: string,
    messageId: string,
  ): Promise<{ ackedCount: number }> {
    return ackMessage(channel, messageId);
  }

  // ── Status → tmux pane title + user options ──

  async setStatus(key: string, value: string, icon?: string): Promise<void> {
    const display = icon ? `${icon} ${value}` : value;
    this.setOpt(`@agent-${key}`, display);
  }

  async setProgress(fraction: number, label: string): Promise<void> {
    const filled = Math.round(fraction * 10);
    const bar = "▓".repeat(filled) + "░".repeat(10 - filled);
    const pct = `${Math.round(fraction * 100)}%`;
    const display = `${bar} ${pct}${label ? " " + label : ""}`;
    this.setOpt("@agent-progress", display);
    if (this.useNotifySend) {
      execArgs([
        "notify-send",
        "-h",
        `int:value:${Math.round(fraction * 100)}`,
        "-h",
        "string:x-dunst-stack-tag:agent-progress",
        "Agent Progress",
        `${label || "working"} ${pct}`,
      ]);
    }
  }

  async clearProgress(): Promise<void> {
    this.unsetOpt("@agent-progress");
  }

  /** Display a centered message in the tmux status bar for this pane's client. */
  private displayMessage(text: string, durationMs: number): void {
    const width = parseInt(
      execArgs([
        "tmux",
        "display-message",
        "-t",
        this.paneId,
        "-p",
        "#{client_width}",
      ]) || "0",
      10,
    );
    const pad =
      width > text.length
        ? " ".repeat(Math.floor((width - text.length) / 2))
        : "";
    execArgs([
      "tmux",
      "display-message",
      "-t",
      this.paneId,
      "-d",
      String(durationMs),
      `${pad}${text}`,
    ]);
  }

  async log(message: string, level?: string, _source?: string): Promise<void> {
    if (level && level !== "info") {
      this.displayMessage(`[${level}] ${message}`, 3000);
    }
  }

  async notify(title: string, body: string): Promise<void> {
    if (this.useNotifySend) {
      execArgs([
        "notify-send",
        "-h",
        "string:x-dunst-stack-tag:agent-notify",
        title,
        body,
      ]);
    } else {
      this.displayMessage(`📡 ${title}: ${body}`, 5000);
    }
  }
}

// ─── FileOnlyBackend (fallback, no sidebar) ───────────────────────────
class FileOnlyBackend implements ChannelBackend {
  name = "file";

  async publish(msg: ChannelMessage): Promise<void> {
    publishMessage(msg);
  }

  async read(channel: string, opts?: FilterOpts): Promise<ChannelMessage[]> {
    return readMessages(channel, opts);
  }

  async ack(
    channel: string,
    messageId: string,
  ): Promise<{ ackedCount: number }> {
    return ackMessage(channel, messageId);
  }

  async setStatus(_key: string, _value: string): Promise<void> {
    /* no-op */
  }

  async setProgress(_fraction: number, _label: string): Promise<void> {
    /* no-op */
  }

  async clearProgress(): Promise<void> {
    /* no-op */
  }

  async log(_message: string): Promise<void> {
    /* no-op */
  }

  async notify(title: string, body: string): Promise<void> {
    if (process.platform === "darwin") {
      execArgs([
        "osascript",
        "-e",
        `display notification "${body}" with title "${title}"`,
      ]);
    } else {
      try {
        execArgs(["notify-send", title, body]);
      } catch {
        /* no notification backend available */
      }
    }
  }
}

// ─── Backend factory ──────────────────────────────────────────────────
export function createBackend(): ChannelBackend {
  if (process.env.CMUX_SOCKET_PATH || hasCmux()) {
    return new CmuxBackend();
  }
  if (hasTmux()) {
    const notifyMode =
      (process.env.AGENT_NOTIFY_MODE as TmuxNotifyMode) || "auto";
    return new TmuxBackend(notifyMode);
  }
  return new FileOnlyBackend();
}
