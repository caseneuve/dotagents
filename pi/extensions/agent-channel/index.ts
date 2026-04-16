import type {
  ExtensionAPI,
  ExtensionContext,
} from "@mariozechner/pi-coding-agent";
import { CustomEditor } from "@mariozechner/pi-coding-agent";
import { truncateToWidth, visibleWidth } from "@mariozechner/pi-tui";
import { Type, type Static } from "@sinclair/typebox";
import { StringEnum } from "@mariozechner/pi-ai";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  channelPath,
  filterMessages,
  ackMessages,
  shouldTriggerTurn,
  type ChannelMessage,
  type ChannelFile,
} from "./core";
import {
  resolveIdentity,
  setLabel,
  identityToData,
  identityFromData,
  generateId,
  type AgentIdentity,
} from "./identity";

// Types re-exported from core
export type { ChannelMessage, ChannelFile };

// ─── Backend interface (pluggable) ─────────────────────────────────────
export interface ChannelBackend {
  /** Unique backend name, e.g. "cmux", "tmux", "file" */
  name: string;
  /** Publish a message to the channel. */
  publish(msg: ChannelMessage): Promise<void>;
  /** Read messages from a channel, optionally filtering. */
  read(
    channel: string,
    opts?: { since?: number; unacked?: boolean; type?: string },
  ): Promise<ChannelMessage[]>;
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
// All backends use the same filesystem directory for messages.
// This keeps it simple and lets any process read/write regardless of backend.

const CHANNEL_DIR = path.join(os.homedir(), ".agent-channels");

function readChannelFile(channel: string): ChannelFile {
  const p = channelPath(CHANNEL_DIR, channel);
  if (!fs.existsSync(p)) return { messages: [] };
  try {
    return JSON.parse(fs.readFileSync(p, "utf-8"));
  } catch {
    return { messages: [] };
  }
}

function writeChannelFile(channel: string, data: ChannelFile): void {
  fs.mkdirSync(CHANNEL_DIR, { recursive: true });
  fs.writeFileSync(
    channelPath(CHANNEL_DIR, channel),
    JSON.stringify(data, null, 2),
  );
}

// ackMessages, filterMessages, shouldTriggerTurn, channelPath imported from ./core

// ─── CmuxBackend ──────────────────────────────────────────────────────
function execArgs(args: string[]): string {
  try {
    return execFileSync(args[0], args.slice(1), {
      encoding: "utf-8",
      timeout: 5000,
    }).trim();
  } catch {
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

class CmuxBackend implements ChannelBackend {
  name = "cmux";

  async publish(msg: ChannelMessage): Promise<void> {
    const file = readChannelFile(msg.channel);
    file.messages.push(msg);
    writeChannelFile(msg.channel, file);
  }

  async read(
    channel: string,
    opts?: { since?: number; unacked?: boolean; type?: string },
  ): Promise<ChannelMessage[]> {
    const file = readChannelFile(channel);
    return filterMessages(file.messages, opts);
  }

  async ack(
    channel: string,
    messageId: string,
  ): Promise<{ ackedCount: number }> {
    const original = readChannelFile(channel);
    const result = ackMessages(original, messageId);
    if (result.ackedCount > 0) writeChannelFile(channel, result.file);
    return { ackedCount: result.ackedCount };
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

class TmuxBackend implements ChannelBackend {
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

  private getOpt(opt: string): string {
    return execArgs(["tmux", "show-options", "-pqv", "-t", this.paneId, opt]);
  }

  /** Configure tmux pane border to show agent status automatically.
   *  Called when comms are turned ON. */
  setup(): void {
    // Enable pane border at top with agent status + progress
    this.setOpt("pane-border-status", "top");
    this.setOpt(
      "pane-border-format",
      " #{@agent-agent}#{?@agent-progress, [#{@agent-progress}],} ",
    );
  }

  /** Restore tmux pane border to its pre-comms state.
   *  Called when comms are turned OFF or session shuts down.
   *  Always unsets rather than restoring — the save/restore pattern is fragile
   *  across pi reloads (each reload captures the previous setup's state as
   *  "original", causing drift). */
  teardown(): void {
    // Clear agent options
    this.unsetOpt("@agent-agent");
    this.unsetOpt("@agent-progress");
    // Remove our border customizations — let tmux fall back to defaults
    this.unsetOpt("pane-border-status");
    this.unsetOpt("pane-border-format");
  }

  // ── Messaging (file-based, shared) ──

  async publish(msg: ChannelMessage): Promise<void> {
    const file = readChannelFile(msg.channel);
    file.messages.push(msg);
    writeChannelFile(msg.channel, file);
  }

  async read(
    channel: string,
    opts?: { since?: number; unacked?: boolean; type?: string },
  ): Promise<ChannelMessage[]> {
    const file = readChannelFile(channel);
    return filterMessages(file.messages, opts);
  }

  async ack(
    channel: string,
    messageId: string,
  ): Promise<{ ackedCount: number }> {
    const original = readChannelFile(channel);
    const result = ackMessages(original, messageId);
    if (result.ackedCount > 0) writeChannelFile(channel, result.file);
    return { ackedCount: result.ackedCount };
  }

  // ── Status → tmux pane title + user options ──

  async setStatus(key: string, value: string, icon?: string): Promise<void> {
    const display = icon ? `${icon} ${value}` : value;
    // Store in pane user option — pane-border-format reads it via #{@agent-*}
    this.setOpt(`@agent-${key}`, display);
  }

  async setProgress(fraction: number, label: string): Promise<void> {
    const filled = Math.round(fraction * 10);
    const bar = "▓".repeat(filled) + "░".repeat(10 - filled);
    const pct = `${Math.round(fraction * 100)}%`;
    const display = `${bar} ${pct}${label ? " " + label : ""}`;
    this.setOpt("@agent-progress", display);
    // Also push to notify-send with dunst replace-id for live-updating progress
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
    // Only show warnings and errors as tmux display-messages.
    // Info-level logs are too noisy for tmux (every send/ack/watch triggers one).
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
    const file = readChannelFile(msg.channel);
    file.messages.push(msg);
    writeChannelFile(msg.channel, file);
  }
  async read(
    channel: string,
    opts?: { since?: number; unacked?: boolean; type?: string },
  ): Promise<ChannelMessage[]> {
    const file = readChannelFile(channel);
    return filterMessages(file.messages, opts);
  }
  async ack(
    channel: string,
    messageId: string,
  ): Promise<{ ackedCount: number }> {
    const original = readChannelFile(channel);
    const result = ackMessages(original, messageId);
    if (result.ackedCount > 0) writeChannelFile(channel, result.file);
    return { ackedCount: result.ackedCount };
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
      // Linux fallback — notify-send if available, otherwise silent
      try {
        execArgs(["notify-send", title, body]);
      } catch {
        /* no notification backend available */
      }
    }
  }
}

// ─── Backend factory ──────────────────────────────────────────────────
function createBackend(): ChannelBackend {
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

// ─── Helpers ──────────────────────────────────────────────────────────

/** Short hash for lobby channel names. */
function shortHash(input: string): string {
  return createHash("sha256").update(input).digest("hex").slice(0, 4);
}

/** Derive the lobby channel from the environment.
 *  Priority: CMUX_WORKSPACE_ID (cmux) → tmux socket+session hash → file/lobby.
 *  The tmux lobby hashes socket_path + session_name so different servers
 *  or sessions never collide, even with generic names like "main".
 *  The file/lobby fallback is a machine-global meeting point for agents
 *  running in bare terminals without tmux or cmux. */
function resolveLobby(): string | undefined {
  if (process.env.CMUX_WORKSPACE_ID) return process.env.CMUX_WORKSPACE_ID;
  if (process.env.TMUX) {
    try {
      const session = execArgs([
        "tmux",
        "display-message",
        "-p",
        "#{session_name}",
      ]);
      if (session) {
        // $TMUX = socket_path,pid,pane_index
        const socket = (process.env.TMUX || "").split(",")[0] || "";
        const hash = shortHash(`${socket}/${session}`);
        return `tmux/${session}-${hash}`;
      }
    } catch {
      /* tmux unavailable */
    }
  }
  // Fallback: machine-global lobby via shared ~/.agent-channels/
  return "file/lobby";
}

function makeId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

// Track message IDs published by this agent instance so the poller can skip them.
// This is more reliable than name comparison (which can fail if name changes mid-session).
const ownMessageIds = new Set<string>();

// Agent identity: single structure, resolved via identity module.
let identity: AgentIdentity = { id: generateId() };

function agentName(): string {
  return resolveIdentity(identity);
}

// ─── Poller: background check for incoming messages ───────────────────
class ChannelPoller {
  private timers: Map<string, ReturnType<typeof setInterval>> = new Map();
  private lastSeen: Map<string, number> = new Map();
  private callback: (msgs: ChannelMessage[]) => void;
  private backend: ChannelBackend;
  private intervalMs: number;

  constructor(
    backend: ChannelBackend,
    callback: (msgs: ChannelMessage[]) => void,
    intervalMs = 3000,
  ) {
    this.backend = backend;
    this.callback = callback;
    this.intervalMs = intervalMs;
  }

  watch(channel: string): void {
    if (this.timers.has(channel)) return;
    this.lastSeen.set(channel, Date.now());
    const timer = setInterval(async () => {
      const since = this.lastSeen.get(channel) || 0;
      const msgs = await this.backend.read(channel, { since });
      // Filter out messages published by this agent instance
      const external = msgs.filter((m) => !ownMessageIds.has(m.id));
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

// ─── Extension entry ──────────────────────────────────────────────────
export default function (pi: ExtensionAPI) {
  const backend = createBackend();
  let ctx: ExtensionContext | undefined;
  let poller: ChannelPoller | undefined;

  // ── register bundled skills ──
  pi.on("resources_discover", async () => {
    return {
      skillPaths: [
        path.join(path.dirname(new URL(import.meta.url).pathname), "skills"),
      ],
    };
  });

  // ── Block channel tools when comms are muted ──
  pi.on("tool_call", async (event) => {
    if (commsMuted && channelToolNames.includes(event.toolName)) {
      return { block: true, reason: "Comms are off. Use /comms on to enable." };
    }
  });

  // ── Radio protocol: shouldTriggerTurn imported from ./core ──

  // ── on incoming messages, inject them into the conversation ──
  function onIncoming(msgs: ChannelMessage[]) {
    // When muted, messages are intentionally skipped (not queued).
    // The poller still advances lastSeen, so these messages won't be re-delivered.
    // They remain unacked and can be retrieved via channel_read if needed.
    if (commsMuted) return;
    const myName = agentName();
    for (const msg of msgs) {
      // Skip own messages
      if (msg.from === myName) continue;

      const trigger = shouldTriggerTurn(msg);
      const label = `📨 [${msg.channel}] from ${msg.from}: ${msg.type}`;
      const content = `${label}\n\n${msg.body}`;

      if (trigger) {
        // sendMessage with triggerTurn wakes idle agents via agent.prompt().
        // When agent is busy, it steers the message into the active turn.
        pi.sendMessage(
          {
            customType: "agent-channel",
            content,
            display: true,
            details: { channelMessage: msg },
          },
          { triggerTurn: true, deliverAs: "steer" },
        );
      } else {
        // Display-only: no turn trigger needed (OUT messages, presence)
        pi.sendMessage(
          {
            customType: "agent-channel",
            content,
            display: true,
            details: { channelMessage: msg },
          },
          { triggerTurn: false },
        );
      }
      // Auto-ack: message was injected into conversation, no need for manual ack
      backend.ack(msg.channel, msg.id).catch(() => {});
      if (ctx?.hasUI) {
        ctx.ui.notify(`${msg.from}: ${msg.type}`, "info");
      }
    }
  }

  // ── Track watched channels for persistence across reloads ──
  const watchedChannels = new Set<string>();
  let commsMuted = true;

  // All channel tool names — used by tool_call blocker when comms are muted
  const channelToolNames = [
    "channel_send",
    "channel_read",
    "channel_ack",
    "channel_watch",
    "channel_unwatch",
    "channel_status",
    "channel_list",
  ];

  // ── lifecycle ──
  pi.on("session_start", async (_event, c) => {
    ctx = c;
    poller = new ChannelPoller(backend, onIncoming);
    if (ctx.hasUI) {
      ctx.ui.setStatus("agent-ch", `channel: ${backend.name}`);
    }
    // Tmux pane border is configured when comms are turned ON (see applyCommsState).
    // On session start, just mark ready if comms happen to be on already.
    if (!commsMuted) {
      if (backend instanceof TmuxBackend) backend.setup();
      await backend.setStatus("agent", "ready", "🟢");
    }

    // Restore or generate agent identity
    let restoredData: { id?: string; label?: string } = {};
    for (const entry of ctx.sessionManager.getEntries()) {
      if (
        entry.type === "custom" &&
        entry.customType === "agent-channel-identity"
      ) {
        const data = (entry as any).data;
        if (data) restoredData = data;
      }
    }
    identity = identityFromData(restoredData, process.env.CMUX_AGENT_NAME);
    if (!restoredData.id && !process.env.CMUX_AGENT_NAME) {
      pi.appendEntry("agent-channel-identity", identityToData(identity));
    }
    // Broadcast name to other extensions (e.g. runtime-footer)
    pi.events.emit("agent-channel:name", agentName());
    if (ctx.hasUI) {
      ctx.ui.setStatus("agent-name", agentName());
      // Install custom editor that shows agent name in the top border.
      // Uses agentName() dynamically so /agent-name changes are reflected without reload.
      const fullTheme = ctx.ui.theme;
      ctx.ui.setEditorComponent((tui, theme, keybindings) => {
        const editor = new (class extends CustomEditor {
          render(width: number): string[] {
            const lines = super.render(width);
            if (lines.length > 0 && width > 0) {
              const label = ` ${agentName()} `;
              const labelWidth = visibleWidth(label);
              if (labelWidth + 2 <= width) {
                const styledLabel = fullTheme.fg("accent", label);
                // Rebuild the border line from scratch — the super.render() line
                // contains ANSI escapes, so raw string slicing breaks widths.
                const b = "─";
                const afterLabel = width - 1 - labelWidth;
                lines[0] =
                  this.borderColor(b) +
                  styledLabel +
                  this.borderColor(b.repeat(afterLabel));
              }
            }
            return lines;
          }
        })(tui, theme, keybindings);
        return editor;
      });
    }

    // Restore watches from session state (take last snapshot — each entry is the full set)
    let latestChannels: string[] = [];
    for (const entry of ctx.sessionManager.getEntries()) {
      if (
        entry.type === "custom" &&
        entry.customType === "agent-channel-watches"
      ) {
        latestChannels = (entry as any).data?.channels ?? [];
      }
    }
    for (const ch of latestChannels) {
      watchedChannels.add(ch);
      poller!.watch(ch);
    }
    if (latestChannels.length > 0) {
      await backend.log(
        `restored watches: ${latestChannels.join(", ")}`,
        "info",
        "channel",
      );
    }

    // Auto-watch the lobby (cmux workspace or tmux session) if available
    const lobbyChannel = resolveLobby();
    if (lobbyChannel && !watchedChannels.has(lobbyChannel)) {
      watchedChannels.add(lobbyChannel);
      poller!.watch(lobbyChannel);
      await backend.log(
        `auto-watching lobby: ${lobbyChannel}`,
        "info",
        "channel",
      );
    }
  });

  pi.on("session_shutdown", async () => {
    poller?.stopAll();
    // Restore tmux pane border on exit (safety net — also done on /comms off)
    if (backend instanceof TmuxBackend && !commsMuted) {
      backend.teardown();
    }
  });

  // ── Inject agent identity + comms protocol into system prompt ──
  pi.on("before_agent_start", async (event) => {
    const name = agentName();
    const commsState = commsMuted ? "off" : "on";
    const lobby = resolveLobby();

    let identitySnippet = `\nYour agent name is "${name}". Use this name when identifying yourself in conversations. Comms are currently ${commsState}.`;

    if (lobby) {
      identitySnippet += `

Comms protocol (lobby: ${lobby}):
- The lobby is for SHORT coordination only — announce what you're doing, where to find results.
- For actual work (code reviews, task exchanges), create a DEDICATED task channel with a descriptive name (e.g. "project/review-feature-x") and announce it on the lobby.
- Never send long content (reviews, diffs, detailed results) on the lobby — it pollutes the shared space.
- End messages with OVER (your turn) or OUT (conversation done, no reply expected).
- For the full protocol (channel naming, timeouts, review format), read the agent-comms skill.`;
    }

    return {
      systemPrompt: event.systemPrompt + identitySnippet,
    };
  });

  // ── Tool: channel_send ──
  pi.registerTool({
    name: "channel_send",
    label: "Channel Send",
    description:
      "Send a message to an inter-agent channel. Other agents polling this channel will receive it. " +
      "Use for non-blocking communication: code reviews, task results, status updates, etc.",
    promptSnippet: "Send a message to an inter-agent communication channel",
    promptGuidelines: [
      "Use channel_send to deliver results, reviews, or status updates to other agents without blocking.",
      "Channel names should be descriptive, e.g. 'myproject/code-review' or 'myproject/task-status'.",
      "Include enough context in the body for the receiver to act independently.",
    ],
    parameters: Type.Object({
      channel: Type.String({
        description: "Channel identifier, e.g. 'myproject/code-review'",
      }),
      type: Type.String({
        description:
          "Message type, e.g. 'code-review', 'task-complete', 'status', 'request'",
      }),
      body: Type.String({
        description:
          "Message body (the actual content — review text, status update, etc.)",
      }),
      to: Type.Optional(
        Type.String({
          description: "Target agent name (optional, for directed messages)",
        }),
      ),
      notify: Type.Optional(
        Type.Boolean({
          description: "Send a notification to the human (default: true)",
        }),
      ),
    }),
    async execute(_toolCallId, params) {
      const msg: ChannelMessage = {
        id: makeId(),
        channel: params.channel,
        from: agentName(),
        to: params.to,
        type: params.type,
        body: params.body,
        timestamp: Date.now(),
      };

      ownMessageIds.add(msg.id);
      await backend.publish(msg);
      await backend.log(
        `sent [${msg.type}] to ${msg.channel}`,
        "info",
        "channel",
      );

      const isOutMessage = /\bOUT$/i.test(params.body.trimEnd());

      // When this agent sends an OUT message, reset to idle state
      // (done before notify so the notification isn't immediately overwritten)
      if (isOutMessage) {
        await backend.clearProgress();
        await backend.setStatus("agent", "ready", "🟢");
      }

      // Notify only on task-completion messages (OUT, task-complete, approved)
      // to avoid noisy notifications on every status/progress update.
      const isCompletionType = ["task-complete", "approved"].includes(
        params.type,
      );
      if (
        params.notify === true ||
        (params.notify !== false && (isOutMessage || isCompletionType))
      ) {
        await backend.notify(
          `Agent ${msg.from}`,
          `${msg.type} on ${msg.channel}`,
        );
      }

      return {
        content: [
          {
            type: "text",
            text: `Message sent to channel '${msg.channel}' (id: ${msg.id})`,
          },
        ],
        details: { message: msg },
      };
    },
  });

  // ── Tool: channel_read ──
  pi.registerTool({
    name: "channel_read",
    label: "Channel Read",
    description:
      "Read messages from an inter-agent channel. Returns unacknowledged messages by default. " +
      "Use this to poll for incoming work, reviews, or status updates from other agents.",
    promptSnippet: "Read messages from an inter-agent communication channel",
    parameters: Type.Object({
      channel: Type.String({ description: "Channel identifier to read from" }),
      unacked_only: Type.Optional(
        Type.Boolean({
          description: "Only return unacknowledged messages (default: true)",
        }),
      ),
      type: Type.Optional(
        Type.String({ description: "Filter by message type" }),
      ),
    }),
    async execute(_toolCallId, params) {
      const unacked = params.unacked_only !== false;
      const msgs = await backend.read(params.channel, {
        unacked,
        type: params.type,
      });

      if (msgs.length === 0) {
        return {
          content: [
            {
              type: "text",
              text: `No ${unacked ? "unacked " : ""}messages on '${params.channel}'`,
            },
          ],
          details: { messages: [] },
        };
      }

      const summary = msgs
        .map(
          (m) =>
            `[id: ${m.id}] [${new Date(m.timestamp).toISOString()}] ${m.from} (${m.type}):\n${m.body}`,
        )
        .join("\n\n---\n\n");

      return {
        content: [
          {
            type: "text",
            text: `${msgs.length} message(s) on '${params.channel}':\n\n${summary}`,
          },
        ],
        details: { messages: msgs },
      };
    },
  });

  // ── Tool: channel_ack ──
  pi.registerTool({
    name: "channel_ack",
    label: "Channel Ack",
    description:
      "Acknowledge a message (mark as received/processed). Acked messages won't appear in unacked reads. " +
      'Use message_id="last" to ack the most recent unacked message, or "*" to ack all unacked messages.',
    promptSnippet: "Acknowledge a channel message as received/processed",
    parameters: Type.Object({
      channel: Type.String({ description: "Channel identifier" }),
      message_id: Type.String({
        description:
          'ID of the message to acknowledge. Use "last" for most recent unacked, or "*" for all unacked.',
      }),
    }),
    async execute(_toolCallId, params) {
      const { ackedCount } = await backend.ack(
        params.channel,
        params.message_id,
      );
      await backend.log(
        `acked ${params.message_id} (${ackedCount} messages)`,
        "info",
        "channel",
      );

      if (ackedCount === 0) {
        return {
          content: [
            {
              type: "text",
              text: `No matching unacked message found for '${params.message_id}' on '${params.channel}'`,
            },
          ],
          details: { ackedCount: 0 },
        };
      }

      const label =
        params.message_id === "*"
          ? `Acknowledged all ${ackedCount} unacked message(s) on '${params.channel}'`
          : `Acknowledged message ${params.message_id} on '${params.channel}'`;

      return {
        content: [{ type: "text", text: label }],
        details: { ackedCount },
      };
    },
  });

  // ── Tool: channel_watch ──
  pi.registerTool({
    name: "channel_watch",
    label: "Channel Watch",
    description:
      "Start polling a channel for new messages in the background. " +
      "When messages arrive, they'll be injected into the conversation automatically. " +
      "Use this to set up non-blocking waiting for results from other agents. " +
      "Set catch_up=true to replay missed messages before polling starts.",
    promptSnippet:
      "Start background polling on a channel for incoming messages",
    promptGuidelines: [
      "Use channel_watch to set up non-blocking monitoring. You can continue working while watching.",
      "Incoming messages will appear as injected context — you don't need to poll manually.",
      "Use catch_up=true when joining a channel late to replay messages you missed.",
    ],
    parameters: Type.Object({
      channel: Type.String({ description: "Channel identifier to watch" }),
      interval_seconds: Type.Optional(
        Type.Number({
          description: "Polling interval in seconds (default: 3)",
        }),
      ),
      catch_up: Type.Optional(
        Type.Boolean({
          description:
            "Replay and ack unread messages before starting the poll (default: false)",
        }),
      ),
    }),
    async execute(_toolCallId, params) {
      const interval = (params.interval_seconds || 3) * 1000;
      if (poller) {
        poller.unwatch(params.channel); // reset if already watching
      } else {
        poller = new ChannelPoller(backend, onIncoming, interval);
      }

      // Catch-up: replay unacked messages before starting the poll
      let caughtUp = 0;
      if (params.catch_up) {
        const unacked = await backend.read(params.channel, { unacked: true });
        const external = unacked.filter(
          (m) => !ownMessageIds.has(m.id) && m.from !== agentName(),
        );
        if (external.length > 0) {
          onIncoming(external); // injects + auto-acks each message
          caughtUp = external.length;
        }
        // Ack any remaining (own messages that were unacked)
        if (unacked.length > external.length) {
          await backend.ack(params.channel, "*");
        }
      }

      poller.watch(params.channel);

      // Persist watch list for restore on reload
      watchedChannels.add(params.channel);
      pi.appendEntry("agent-channel-watches", {
        channels: [...watchedChannels],
      });

      // Auto-announce presence on the channel
      const joinMsg: ChannelMessage = {
        id: makeId(),
        channel: params.channel,
        from: agentName(),
        type: "presence",
        body: `${agentName()} is now watching this channel.`,
        timestamp: Date.now(),
      };
      ownMessageIds.add(joinMsg.id);
      await backend.publish(joinMsg);

      await backend.setStatus("watching", `📡 ${params.channel}`, "📡");
      await backend.log(`watching ${params.channel}`, "info", "channel");

      const catchUpNote =
        caughtUp > 0 ? ` Caught up on ${caughtUp} missed message(s).` : "";
      return {
        content: [
          {
            type: "text",
            text: `Now watching channel '${params.channel}' (polling every ${params.interval_seconds || 3}s). Incoming messages will be injected automatically.${catchUpNote}`,
          },
        ],
        details: { caughtUp },
      };
    },
  });

  // ── Tool: channel_unwatch ──
  pi.registerTool({
    name: "channel_unwatch",
    label: "Channel Unwatch",
    description: "Stop polling a channel.",
    promptSnippet: "Stop background polling on a channel",
    parameters: Type.Object({
      channel: Type.String({
        description: "Channel identifier to stop watching",
      }),
    }),
    async execute(_toolCallId, params) {
      poller?.unwatch(params.channel);

      // Persist watch list for restore on reload
      watchedChannels.delete(params.channel);
      pi.appendEntry("agent-channel-watches", {
        channels: [...watchedChannels],
      });

      await backend.setStatus("watching", "idle", "💤");

      return {
        content: [
          { type: "text", text: `Stopped watching '${params.channel}'` },
        ],
        details: {},
      };
    },
  });

  // ── Tool: channel_status ──
  pi.registerTool({
    name: "channel_status",
    label: "Channel Status",
    description:
      "Update the sidebar status and progress visible to the human. " +
      "Use this to communicate your current state (working, waiting, done, error) " +
      "so the human can monitor multiple agents at a glance.",
    promptSnippet:
      "Update sidebar status/progress visible to the human operator",
    parameters: Type.Object({
      status: Type.Optional(
        Type.String({
          description:
            "Status text, e.g. 'reviewing code', 'waiting for agent-b'",
        }),
      ),
      icon: Type.Optional(
        Type.String({
          description: "Status icon emoji, e.g. '⚙️', '✅', '⏳'",
        }),
      ),
      progress: Type.Optional(
        Type.Number({
          description:
            "Progress fraction 0.0–1.0 (omit to leave unchanged, -1 to clear)",
        }),
      ),
      progress_label: Type.Optional(
        Type.String({ description: "Progress bar label" }),
      ),
      log_message: Type.Optional(
        Type.String({ description: "Append a log line to the sidebar" }),
      ),
      log_level: Type.Optional(
        Type.String({
          description: "Log level: info, success, warning, error",
        }),
      ),
    }),
    async execute(_toolCallId, params) {
      const parts: string[] = [];

      if (params.status) {
        await backend.setStatus("agent", params.status, params.icon || "⚙️");
        parts.push(`status: ${params.status}`);
      }
      if (params.progress !== undefined) {
        if (params.progress < 0) {
          await backend.clearProgress();
          parts.push("progress: cleared");
        } else {
          await backend.setProgress(
            params.progress,
            params.progress_label || "",
          );
          parts.push(`progress: ${Math.round(params.progress * 100)}%`);
        }
      }
      if (params.log_message) {
        await backend.log(params.log_message, params.log_level, "agent");
        parts.push(`logged: ${params.log_message}`);
      }

      return {
        content: [
          {
            type: "text",
            text: `Sidebar updated: ${parts.join(", ") || "no changes"}`,
          },
        ],
        details: {},
      };
    },
  });

  // ── Tool: channel_list ──
  pi.registerTool({
    name: "channel_list",
    label: "Channel List",
    description: "List all known channels (that have message files).",
    promptSnippet: "List all inter-agent channels",
    parameters: Type.Object({}),
    async execute() {
      if (!fs.existsSync(CHANNEL_DIR)) {
        return {
          content: [{ type: "text", text: "No channels found." }],
          details: { channels: [] },
        };
      }
      const files = fs
        .readdirSync(CHANNEL_DIR)
        .filter((f) => f.endsWith(".json"));
      const channels = files.map((f) => {
        const ch = f.replace(/\.json$/, "");
        const data = readChannelFile(ch);
        const unacked = data.messages.filter((m) => !m.acked).length;
        return { name: ch, total: data.messages.length, unacked };
      });

      const summary = channels
        .map((c) => `${c.name}: ${c.total} msgs (${c.unacked} unacked)`)
        .join("\n");
      return {
        content: [
          {
            type: "text",
            text: channels.length ? summary : "No channels found.",
          },
        ],
        details: { channels },
      };
    },
  });

  // ── Shared comms toggle logic ──
  function toggleComms(explicit?: "on" | "off"): boolean {
    if (explicit === "on") commsMuted = false;
    else if (explicit === "off") commsMuted = true;
    else commsMuted = !commsMuted;
    return commsMuted;
  }

  async function applyCommsState(ctx: ExtensionContext): Promise<void> {
    const state = commsMuted ? "OFF 🔇" : "ON 📡";
    pi.events.emit("agent-channel:comms", !commsMuted);
    ctx.ui.setStatus("agent-comms", commsMuted ? "🔇 comms off" : "");
    ctx.ui.notify(`Comms ${state}`, "info");
    // Set up / tear down tmux pane border based on comms state
    if (backend instanceof TmuxBackend) {
      if (commsMuted) {
        backend.teardown();
      } else {
        backend.setup();
        await backend.setStatus("agent", "ready", "🟢");
      }
    }
  }

  // ── Command: /comms ──
  pi.registerCommand("comms", {
    description: "Toggle agent comms on/off (usage: /comms [on|off])",
    handler: async (args, ctx) => {
      const arg = args.trim().toLowerCase();
      toggleComms(arg === "on" ? "on" : arg === "off" ? "off" : undefined);
      await applyCommsState(ctx);
    },
  });

  // ── Shortcut: Ctrl+Shift+M toggles comms ──
  pi.registerShortcut("ctrl+shift+m", {
    description: "Toggle agent comms on/off",
    handler: async (ctx) => {
      toggleComms();
      await applyCommsState(ctx);
    },
  });

  // ── Command: /agent-name ──
  pi.registerCommand("agent-name", {
    description: "Set this agent's name (usage: /agent-name reviewer)",
    handler: async (args, ctx) => {
      const name = args.trim();
      if (!name) {
        ctx.ui.notify(`Current name: ${agentName()}`, "info");
        return;
      }
      identity = setLabel(identity, name);
      pi.appendEntry("agent-channel-identity", identityToData(identity));
      pi.events.emit("agent-channel:name", agentName());
      ctx.ui.setStatus("agent-name", agentName());
      ctx.ui.notify(`Agent name set to: ${agentName()}`, "info");
    },
  });

  // ── Command: /channel-clear ──
  pi.registerCommand("channel-clear", {
    description:
      "Clear all messages from a channel (usage: /channel-clear <channel>)",
    handler: async (args, ctx) => {
      const channel = args.trim();
      if (!channel) {
        ctx.ui.notify("Usage: /channel-clear <channel-name>", "warning");
        return;
      }
      writeChannelFile(channel, { messages: [] });
      ctx.ui.notify(`Cleared channel '${channel}'`, "info");
    },
  });

  // ── Command: /channel-ls ──
  pi.registerCommand("channel-ls", {
    description: "List all channels and their message counts",
    handler: async (_args, ctx) => {
      if (!fs.existsSync(CHANNEL_DIR)) {
        ctx.ui.notify("No channels found.", "info");
        return;
      }
      const files = fs
        .readdirSync(CHANNEL_DIR)
        .filter((f) => f.endsWith(".json"));
      if (files.length === 0) {
        ctx.ui.notify("No channels found.", "info");
        return;
      }
      for (const f of files) {
        const ch = f.replace(/\.json$/, "");
        const data = readChannelFile(ch);
        const unacked = data.messages.filter((m) => !m.acked).length;
        ctx.ui.notify(
          `${ch}: ${data.messages.length} msgs (${unacked} unacked)`,
          "info",
        );
      }
    },
  });
}
