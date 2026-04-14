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

interface ChannelFile {
  messages: ChannelMessage[];
}

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

function channelPath(channel: string): string {
  const safe = channel.replace(/[^a-zA-Z0-9._-]/g, "_");
  return path.join(CHANNEL_DIR, `${safe}.json`);
}

function readChannelFile(channel: string): ChannelFile {
  const p = channelPath(channel);
  if (!fs.existsSync(p)) return { messages: [] };
  try {
    return JSON.parse(fs.readFileSync(p, "utf-8"));
  } catch {
    return { messages: [] };
  }
}

function writeChannelFile(channel: string, data: ChannelFile): void {
  fs.mkdirSync(CHANNEL_DIR, { recursive: true });
  fs.writeFileSync(channelPath(channel), JSON.stringify(data, null, 2));
}

/** Shared ack logic used by all backends. Mutates file in place, returns count. */
function ackMessages(
  file: ChannelFile,
  messageId: string,
): { ackedCount: number } {
  let ackedCount = 0;
  if (messageId === "*") {
    for (const m of file.messages) {
      if (!m.acked) {
        m.acked = true;
        ackedCount++;
      }
    }
  } else if (messageId === "last") {
    const unacked = file.messages.filter((m) => !m.acked);
    const last = unacked[unacked.length - 1];
    if (last) {
      last.acked = true;
      ackedCount = 1;
    }
  } else {
    const msg = file.messages.find((m) => m.id === messageId);
    if (msg) {
      msg.acked = true;
      ackedCount = 1;
    }
  }
  return { ackedCount };
}

// ─── CmuxBackend ──────────────────────────────────────────────────────
function execArgs(args: string[]): string {
  const { execFileSync } = require("node:child_process");
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
    execArgs(["cmux", "ping"]);
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
    let msgs = file.messages;
    if (opts?.since) msgs = msgs.filter((m) => m.timestamp > opts.since!);
    if (opts?.unacked) msgs = msgs.filter((m) => !m.acked);
    if (opts?.type) msgs = msgs.filter((m) => m.type === opts.type);
    return msgs;
  }

  async ack(
    channel: string,
    messageId: string,
  ): Promise<{ ackedCount: number }> {
    const file = readChannelFile(channel);
    const result = ackMessages(file, messageId);
    if (result.ackedCount > 0) writeChannelFile(channel, file);
    return result;
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
    let msgs = file.messages;
    if (opts?.since) msgs = msgs.filter((m) => m.timestamp > opts.since!);
    if (opts?.unacked) msgs = msgs.filter((m) => !m.acked);
    if (opts?.type) msgs = msgs.filter((m) => m.type === opts.type);
    return msgs;
  }
  async ack(
    channel: string,
    messageId: string,
  ): Promise<{ ackedCount: number }> {
    const file = readChannelFile(channel);
    const result = ackMessages(file, messageId);
    if (result.ackedCount > 0) writeChannelFile(channel, file);
    return result;
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
    // Fallback: macOS osascript
    execArgs([
      "osascript",
      "-e",
      `display notification "${body}" with title "${title}"`,
    ]);
  }
}

// ─── Backend factory ──────────────────────────────────────────────────
function createBackend(): ChannelBackend {
  if (process.env.CMUX_SOCKET_PATH || hasCmux()) {
    return new CmuxBackend();
  }
  return new FileOnlyBackend();
}

// ─── Helpers ──────────────────────────────────────────────────────────
function makeId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

// Track message IDs published by this agent instance so the poller can skip them.
// This is more reliable than name comparison (which can fail if name changes mid-session).
const ownMessageIds = new Set<string>();

// Agent identity: stable per session, persisted across reloads.
// Generated once on first session_start, restored from session state thereafter.
let agentId: string | undefined;
let agentLabel: string | undefined;

function generateId(): string {
  return Math.random().toString(36).slice(2, 6);
}

function agentName(): string {
  // Prefer explicit env, then user-set label, then session-stable id
  if (process.env.CMUX_AGENT_NAME) return process.env.CMUX_AGENT_NAME;
  if (agentLabel) return agentLabel;
  if (agentId) return agentId;
  // Fallback before session_start (shouldn't happen in practice)
  return generateId();
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

  // ── Radio protocol: message endings control turn-taking ──
  // Body ending with OUT  → no reply expected (triggerTurn: false)
  // Body ending with OVER → your turn, act on it (triggerTurn: true)
  // No suffix              → your turn, act on it (triggerTurn: true)
  function shouldTriggerTurn(msg: ChannelMessage): boolean {
    // Presence messages are informational — never wake the agent
    if (msg.type === "presence") return false;
    const trimmed = msg.body.trimEnd();
    // OUT at end of message = conversation done, don't trigger
    if (/\bOUT$/i.test(trimmed)) return false;
    return true;
  }

  // ── on incoming messages, inject them into the conversation ──
  function onIncoming(msgs: ChannelMessage[]) {
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

  // ── lifecycle ──
  pi.on("session_start", async (_event, c) => {
    ctx = c;
    poller = new ChannelPoller(backend, onIncoming);
    if (ctx.hasUI) {
      ctx.ui.setStatus("agent-ch", `channel: ${backend.name}`);
    }
    await backend.setStatus("agent", "ready", "🟢");

    // Restore or generate agent identity
    agentId = undefined;
    agentLabel = undefined;
    for (const entry of ctx.sessionManager.getEntries()) {
      if (
        entry.type === "custom" &&
        entry.customType === "agent-channel-identity"
      ) {
        const data = (entry as any).data;
        if (data?.id) agentId = data.id;
        if (data?.label) agentLabel = data.label;
      }
    }
    if (!agentId && !process.env.CMUX_AGENT_NAME) {
      agentId = generateId();
      pi.appendEntry("agent-channel-identity", { id: agentId });
    }
    // Broadcast name to other extensions (e.g. runtime-footer)
    pi.events.emit("agent-channel:name", agentName());
    if (ctx.hasUI) {
      ctx.ui.setStatus("agent-name", agentName());
      // Install custom editor that shows agent name in the top border
      const name = agentName();
      const fullTheme = ctx.ui.theme;
      ctx.ui.setEditorComponent((tui, theme, keybindings) => {
        const editor = new (class extends CustomEditor {
          render(width: number): string[] {
            const lines = super.render(width);
            if (lines.length > 0 && width > 0) {
              const label = ` ${name} `;
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

    // Auto-watch the lobby (CMUX_WORKSPACE_ID) if available
    const lobbyChannel = process.env.CMUX_WORKSPACE_ID;
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
  });

  // ── Inject agent identity into system prompt ──
  pi.on("before_agent_start", async (event) => {
    const name = agentName();
    const commsState = commsMuted ? "off" : "on";
    const identity = `\nYour agent name is "${name}". Use this name when identifying yourself in conversations. Comms are currently ${commsState}.`;
    return {
      systemPrompt: event.systemPrompt + identity,
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

      if (params.notify !== false) {
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

  const channelToolNames = [
    "channel_send", "channel_read", "channel_ack",
    "channel_watch", "channel_unwatch", "channel_status", "channel_list",
  ];

  // ── Command: /comms ──
  pi.registerCommand("comms", {
    description: "Toggle agent comms on/off (usage: /comms [on|off])",
    handler: async (args, ctx) => {
      const arg = args.trim().toLowerCase();
      if (arg === "on") {
        commsMuted = false;
      } else if (arg === "off") {
        commsMuted = true;
      } else {
        commsMuted = !commsMuted;
      }
      const state = commsMuted ? "OFF 🔇" : "ON 📡";
      pi.events.emit("agent-channel:comms", !commsMuted);
      ctx.ui.setStatus("agent-comms", commsMuted ? "🔇 comms off" : "");
      ctx.ui.notify(`Comms ${state}`, "info");
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
      agentLabel = name;
      pi.appendEntry("agent-channel-identity", {
        id: agentId,
        label: agentLabel,
      });
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
