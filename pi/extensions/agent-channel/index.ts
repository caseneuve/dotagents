import type {
  ExtensionAPI,
  ExtensionContext,
} from "@mariozechner/pi-coding-agent";
import { CustomEditor } from "@mariozechner/pi-coding-agent";
import { visibleWidth } from "@mariozechner/pi-tui";
import { Type } from "@sinclair/typebox";
import * as fs from "node:fs";
import * as path from "node:path";
import { createHash } from "node:crypto";
import {
  shouldTriggerTurn,
  isValidMessage,
  detectOutMisuse,
  previewString,
  safeStringify,
  type ChannelMessage,
} from "./core";
import {
  resolveIdentity,
  setLabel,
  identityToData,
  identityFromData,
  generateId,
  type AgentIdentity,
} from "./identity";
import type {
  MessageTransport,
  ParseErrorInfo,
  StatusDisplay,
} from "./interfaces";
import {
  FileTransport,
  UdsTransport,
  HttpTransport,
  readChannelFile,
  writeChannelFile,
  createTransport,
  DEFAULT_CHANNEL_DIR,
} from "./transports";
import { TmuxDisplay, createDisplay, execArgs } from "./displays";

// Re-export types for external consumers
export type { ChannelMessage } from "./core";
export type { MessageTransport, StatusDisplay } from "./interfaces";

// ─── Helpers ──────────────────────────────────────────────────────────

/** Short hash for lobby channel names. */
function shortHash(input: string): string {
  return createHash("sha256").update(input).digest("hex").slice(0, 4);
}

/** Derive the lobby channel from the environment.
 *  Priority: CMUX_WORKSPACE_ID (cmux) → tmux socket+session hash → file/lobby. */
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
        const socket = (process.env.TMUX || "").split(",")[0] || "";
        const hash = shortHash(`${socket}/${session}`);
        return `tmux/${session}-${hash}`;
      }
    } catch {
      /* tmux unavailable */
    }
  }
  return "file/lobby";
}

function makeId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

// Track message IDs published by this agent instance so the subscriber can skip them.
// Capped to prevent unbounded growth in long sessions.
const OWN_IDS_MAX = 1000;
const ownMessageIds = new Set<string>();

function trackOwnMessage(id: string): void {
  ownMessageIds.add(id);
  if (ownMessageIds.size > OWN_IDS_MAX) {
    // Remove oldest entries (Set iterates in insertion order)
    const excess = ownMessageIds.size - OWN_IDS_MAX;
    let removed = 0;
    for (const old of ownMessageIds) {
      ownMessageIds.delete(old);
      if (++removed >= excess) break;
    }
  }
}

// Agent identity: single structure, resolved via identity module.
let identity: AgentIdentity = { id: generateId() };

function agentName(): string {
  return resolveIdentity(identity);
}

// ─── Extension entry ──────────────────────────────────────────────────
export default function (pi: ExtensionAPI) {
  let transport: MessageTransport = new FileTransport(DEFAULT_CHANNEL_DIR);
  const display = createDisplay();
  let ctx: ExtensionContext | undefined;

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

  let identityHintSent = false;

  /** Cap + stringify an arbitrary value for inclusion in session state. */
  function toPreview(value: unknown): string {
    const s = typeof value === "string" ? value : safeStringify(value);
    return previewString(s);
  }

  // Wire transport-level parse errors to the conversation + sidebar log so
  // the agent / human learn about dropped frames instead of only seeing them
  // on stderr. Re-installed whenever the active transport changes.
  function wireParseErrorHook(t: MessageTransport): void {
    t.onParseError = (info: ParseErrorInfo) => {
      const where = info.channel ? ` on channel ${info.channel}` : "";
      const content =
        `⚠️ agent-channel (${info.transport} transport) dropped a malformed frame${where}: ${info.error}. ` +
        `Preview: ${toPreview(info.rawPreview)}`;
      try {
        pi.sendMessage(
          {
            customType: "agent-channel",
            content,
            display: true,
            details: {
              error: "parse-error",
              transport: info.transport,
              channel: info.channel,
              rawPreview: toPreview(info.rawPreview),
              reason: info.error,
            },
          },
          { triggerTurn: false },
        );
      } catch (err) {
        console.error(
          `[agent-channel] failed to report parse error: ${
            err instanceof Error ? err.message : err
          }`,
        );
      }
      display
        .log(
          `${info.transport} parse error: ${info.error}`,
          "warning",
          "channel",
        )
        .catch(() => {});
    };
  }

  // ── on incoming messages, inject them into the conversation ──
  function onIncoming(msgs: ChannelMessage[]) {
    if (commsMuted) return;
    const myName = agentName();
    for (const rawMsg of msgs) {
      // Guard: a broken transport / bad server can hand us objects that
      // aren't valid ChannelMessages. Surface them to the agent instead of
      // crashing when we later touch msg.body / msg.id / etc.
      if (!isValidMessage(rawMsg)) {
        const previewText = toPreview(rawMsg);
        try {
          pi.sendMessage(
            {
              customType: "agent-channel",
              content:
                `⚠️ agent-channel received a malformed message on an active subscription and skipped it. ` +
                `The raw payload was: ${previewText}`,
              display: true,
              details: {
                error: "malformed-message",
                rawPreview: previewText,
              },
            },
            { triggerTurn: false },
          );
        } catch (err) {
          console.error(
            `[agent-channel] failed to inject malformed-message diagnostic: ${
              err instanceof Error ? err.message : err
            }`,
          );
        }
        display
          .log("dropped malformed incoming message", "warning", "channel")
          .catch(() => {});
        continue;
      }

      const msg = rawMsg;

      // Skip own messages (by id tracking and by name)
      if (ownMessageIds.has(msg.id)) continue;
      if (msg.from === myName) continue;

      try {
        const trigger = shouldTriggerTurn(msg);
        const label = `📨 [${msg.channel}] from ${msg.from}: ${msg.type}`;
        const needsHint = !identityHintSent;
        const content = needsHint
          ? `[You are agent "${myName}". Respond on channel ${msg.channel}.]\n${label}\n\n${msg.body}`
          : `${label}\n\n${msg.body}`;

        pi.sendMessage(
          {
            customType: "agent-channel",
            content,
            display: true,
            details: { channelMessage: msg },
          },
          trigger
            ? { triggerTurn: true, deliverAs: "steer" }
            : { triggerTurn: false },
        );

        // Only mark the hint as sent after a successful send so a thrown
        // pi.sendMessage (caught below) doesn't swallow the one-shot hint.
        if (needsHint) identityHintSent = true;

        transport.ack(msg.channel, msg.id).catch(() => {});
        if (ctx?.hasUI) {
          ctx.ui.notify(`${msg.from}: ${msg.type}`, "info");
        }
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : String(err);
        try {
          pi.sendMessage(
            {
              customType: "agent-channel",
              content:
                `⚠️ agent-channel failed to deliver an incoming message (${errMsg}). ` +
                `The message was skipped to keep the session alive.`,
              display: true,
              details: {
                error: errMsg,
                messageId: msg.id,
                channel: msg.channel,
                from: msg.from,
                type: msg.type,
              },
            },
            { triggerTurn: false },
          );
        } catch (innerErr) {
          console.error(
            `[agent-channel] failed to report delivery error: ${
              innerErr instanceof Error ? innerErr.message : innerErr
            }`,
          );
        }
        display
          .log(`delivery error: ${errMsg}`, "error", "channel")
          .catch(() => {});
      }
    }
  }

  // ── Track watched channels for persistence across reloads ──
  const watchedChannels = new Set<string>();
  let commsMuted = true;

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
    // Wire parse-error hook on the initial (file) transport. We'll re-wire
    // after every transport swap below so the hook survives upgrades.
    wireParseErrorHook(transport);
    // Try to upgrade to UDS transport (probe the socket)
    const upgraded = await createTransport();
    if (upgraded.name !== transport.name) {
      transport.unsubscribeAll();
      transport = upgraded;
      wireParseErrorHook(transport);
    }
    if (ctx.hasUI) {
      ctx.ui.setStatus("agent-ch", `channel: ${transport.name}`);
    }
    if (!commsMuted) {
      if (display instanceof TmuxDisplay) display.setup();
      await display.setStatus("agent", "ready", "🟢");
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
    pi.events.emit("agent-channel:name", agentName());
    if (ctx.hasUI) {
      ctx.ui.setStatus("agent-name", agentName());
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

    // Restore watches from session state
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
      transport.subscribe(ch, onIncoming);
    }
    if (latestChannels.length > 0) {
      await display.log(
        `restored watches: ${latestChannels.join(", ")}`,
        "info",
        "channel",
      );
    }

    // Auto-watch the lobby
    const lobbyChannel = resolveLobby();
    let lobbyAutoAnnounced = false;
    if (lobbyChannel && !watchedChannels.has(lobbyChannel)) {
      watchedChannels.add(lobbyChannel);
      transport.subscribe(lobbyChannel, onIncoming);
      // Announce presence on the lobby (same as channel_watch tool)
      const joinMsg: ChannelMessage = {
        id: makeId(),
        channel: lobbyChannel,
        from: agentName(),
        type: "presence",
        body: `${agentName()} is now watching this channel.`,
        timestamp: Date.now(),
      };
      trackOwnMessage(joinMsg.id);
      await transport.publish(joinMsg);
      lobbyAutoAnnounced = true;
      await display.log(
        `auto-watching lobby: ${lobbyChannel}`,
        "info",
        "channel",
      );
    }

    // Orientation: tell the agent its name + lobby + presence state, so it
    // doesn't have to wait for the first incoming message to learn who it
    // is. Non-triggering. Always fires — this is a local session note, not
    // traffic on a channel, so comms-muted has no bearing.
    const orientation = [
      `[agent-channel]`,
      `• Your agent name is "${agentName()}".`,
      lobbyChannel
        ? `• Your lobby channel is "${lobbyChannel}". You are already watching it${
            lobbyAutoAnnounced ? " and have announced presence" : ""
          }.`
        : "• No lobby channel could be resolved for this session.",
      `• Use "channel_send" to talk to other agents and "channel_status" for the sidebar (sidebar is NOT a message to others).`,
      `• End messages with OVER when you expect a reply, OUT only when the conversation is done.`,
      `• Do not call "channel_unwatch" on a channel where you are still expecting a reply.`,
      commsMuted
        ? `• Comms are currently OFF — channel_* tools are blocked until you /comms on.`
        : `• Comms are ON.`,
    ].join("\n");
    try {
      pi.sendMessage(
        {
          customType: "agent-channel",
          content: orientation,
          display: true,
          details: {
            kind: "orientation",
            agentName: agentName(),
            lobbyChannel: lobbyChannel ?? null,
            lobbyAutoAnnounced,
            commsMuted,
          },
        },
        { triggerTurn: false },
      );
      // The orientation message doubles as the identity hint, so the
      // first incoming message doesn't need to prepend it again.
      identityHintSent = true;
    } catch (err) {
      console.error(
        `[agent-channel] failed to inject orientation: ${
          err instanceof Error ? err.message : err
        }`,
      );
    }
  });

  pi.on("session_shutdown", async () => {
    transport.unsubscribeAll();
    if (display instanceof TmuxDisplay && !commsMuted) {
      display.teardown();
    }
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
      "End the body with OVER (or no suffix) when you expect a reply. End with OUT only when the conversation is done and no reply is expected — OUT suppresses the turn on the receiving agent.",
      "When you change state without sending (e.g. channel_status) the other agent sees nothing. If you need them to react, channel_send something.",
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

      trackOwnMessage(msg.id);
      await transport.publish(msg);
      await display.log(
        `sent [${msg.type}] to ${msg.channel}`,
        "info",
        "channel",
      );

      const isOutMessage = /\bOUT$/i.test(params.body.trimEnd());
      const outMisuse = isOutMessage
        ? detectOutMisuse(params.body, params.type)
        : null;

      if (isOutMessage) {
        await display.clearProgress();
        await display.setStatus("agent", "ready", "🟢");
      }

      const isCompletionType = ["task-complete", "approved"].includes(
        params.type,
      );
      if (
        params.notify === true ||
        (params.notify !== false && (isOutMessage || isCompletionType))
      ) {
        await display.notify(
          `Agent ${msg.from}`,
          `${msg.type} on ${msg.channel}`,
        );
      }

      const baseText = `Message sent to channel '${msg.channel}' (id: ${msg.id})`;
      const text = outMisuse
        ? `${baseText}.\n⚠️ OUT-misuse warning: ${outMisuse}. OUT tells the receiver not to reply — if you expected a reply, resend ending with OVER instead.`
        : baseText;

      if (outMisuse) {
        await display.log(`OUT-misuse: ${outMisuse}`, "warning", "channel");
      }

      return {
        content: [{ type: "text", text }],
        details: { message: msg, outMisuse: outMisuse ?? undefined },
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
      const msgs = await transport.read(params.channel, {
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
      const { ackedCount } = await transport.ack(
        params.channel,
        params.message_id,
      );
      await display.log(
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
      // Reset if already watching
      transport.unsubscribe(params.channel);

      // Catch-up: replay unacked messages before starting the subscription
      let caughtUp = 0;
      if (params.catch_up) {
        const unacked = await transport.read(params.channel, { unacked: true });
        const external = unacked.filter(
          (m) => !ownMessageIds.has(m.id) && m.from !== agentName(),
        );
        if (external.length > 0) {
          onIncoming(external);
          caughtUp = external.length;
        }
        if (unacked.length > external.length) {
          await transport.ack(params.channel, "*");
        }
      }

      transport.subscribe(params.channel, onIncoming, { intervalMs: interval });

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
      trackOwnMessage(joinMsg.id);
      await transport.publish(joinMsg);

      await display.setStatus("watching", `📡 ${params.channel}`, "📡");
      await display.log(`watching ${params.channel}`, "info", "channel");

      const watchMode =
        transport.name === "file"
          ? `polling every ${params.interval_seconds || 3}s`
          : "push delivery";
      const catchUpNote =
        caughtUp > 0 ? ` Caught up on ${caughtUp} missed message(s).` : "";
      return {
        content: [
          {
            type: "text",
            text: `Now watching channel '${params.channel}' (${watchMode}). Incoming messages will be injected automatically.${catchUpNote}`,
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
    description:
      "Stop polling a channel. After this call, messages sent to the channel " +
      "will NOT be delivered to your conversation until you watch it again. " +
      "Do not unwatch a channel where you are still expecting a reply.",
    promptSnippet: "Stop background polling on a channel",
    promptGuidelines: [
      "Only unwatch a channel after the exchange on it is completely finished (both sides have sent OUT or one side has sent approved / task-complete).",
      "If you unwatch while another agent still owes you a reply, that reply will be lost to your session until you channel_watch again with catch_up=true.",
    ],
    parameters: Type.Object({
      channel: Type.String({
        description: "Channel identifier to stop watching",
      }),
    }),
    async execute(_toolCallId, params) {
      const wasWatching = watchedChannels.has(params.channel);
      transport.unsubscribe(params.channel);

      watchedChannels.delete(params.channel);
      pi.appendEntry("agent-channel-watches", {
        channels: [...watchedChannels],
      });

      await display.setStatus("watching", "idle", "💤");

      if (!wasWatching) {
        return {
          content: [
            {
              type: "text",
              text: `You were not watching '${params.channel}'. No change.`,
            },
          ],
          details: { wasWatching: false },
        };
      }

      return {
        content: [
          {
            type: "text",
            text:
              `Stopped watching '${params.channel}'. ` +
              `⚠️ Incoming messages on this channel will NOT be delivered to your conversation anymore. ` +
              `If you are still expecting a reply here, call channel_watch(channel, catch_up=true) to resume.`,
          },
        ],
        details: { wasWatching: true },
      };
    },
  });

  // ── Tool: channel_status ──
  pi.registerTool({
    name: "channel_status",
    label: "Channel Status",
    description:
      "Update the sidebar status/progress/log visible to the HUMAN only. " +
      "This is a local UI update — it does NOT send a message on any channel " +
      "and no other agent will see it. If you need another agent to know your " +
      "state, call channel_send instead (optionally with type='status').",
    promptSnippet:
      "Update sidebar status/progress visible to the human operator (no message sent)",
    promptGuidelines: [
      "channel_status only updates the human-facing sidebar. Other agents do not see it.",
      "If another agent is waiting for you, use channel_send, not channel_status — a status change alone will leave them silently waiting.",
      "Pair channel_status (sidebar, for the human) with channel_send (message, for the other agent) whenever both audiences need the update.",
    ],
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
        await display.setStatus("agent", params.status, params.icon || "⚙️");
        parts.push(`status: ${params.status}`);
      }
      if (params.progress !== undefined) {
        if (params.progress < 0) {
          await display.clearProgress();
          parts.push("progress: cleared");
        } else {
          await display.setProgress(
            params.progress,
            params.progress_label || "",
          );
          parts.push(`progress: ${Math.round(params.progress * 100)}%`);
        }
      }
      if (params.log_message) {
        await display.log(params.log_message, params.log_level, "agent");
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
      if (!fs.existsSync(DEFAULT_CHANNEL_DIR)) {
        return {
          content: [{ type: "text", text: "No channels found." }],
          details: { channels: [] },
        };
      }
      const files = fs
        .readdirSync(DEFAULT_CHANNEL_DIR)
        .filter((f) => f.endsWith(".json"));
      const channels = files.map((f) => {
        const ch = f.replace(/\.json$/, "");
        const data = readChannelFile(DEFAULT_CHANNEL_DIR, ch);
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
    if (display instanceof TmuxDisplay) {
      if (commsMuted) {
        display.teardown();
      } else {
        display.setup();
        await display.setStatus("agent", "ready", "🟢");
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

  // ── Command: /transport ──
  pi.registerCommand("transport", {
    description:
      "Switch transport (usage: /transport [file|uds|http <url>|auto])",
    handler: async (args, ctx) => {
      const parts = args.trim().split(/\s+/);
      const mode = parts[0]?.toLowerCase();

      if (!mode) {
        ctx.ui.notify(`Current transport: ${transport.name}`, "info");
        return;
      }

      let newTransport: MessageTransport | null = null;

      switch (mode) {
        case "file":
          newTransport = new FileTransport(DEFAULT_CHANNEL_DIR);
          wireParseErrorHook(newTransport);
          break;
        case "uds": {
          const socketPath =
            parts[1] ||
            process.env.AGENT_UDS_SOCKET ||
            "/tmp/agent-channels.sock";
          newTransport = new UdsTransport(socketPath);
          // Wire the parse-error hook *before* the probe so a malformed
          // probe response is surfaced just like any other parse error.
          wireParseErrorHook(newTransport);
          try {
            await newTransport.read("__probe__");
          } catch {
            ctx.ui.notify(
              `Switched to UDS — warning: relay not responding at ${socketPath}`,
              "warning",
            );
          }
          break;
        }
        case "http": {
          const url = parts[1] || process.env.AGENT_RELAY_URL;
          if (!url) {
            ctx.ui.notify(
              "Usage: /transport http <url> (e.g. http://pi.local:7700)",
              "warning",
            );
            return;
          }
          newTransport = new HttpTransport(url);
          wireParseErrorHook(newTransport);
          try {
            await newTransport.read("__probe__");
          } catch {
            ctx.ui.notify(
              `Switched to HTTP — warning: relay not responding at ${url}`,
              "warning",
            );
          }
          break;
        }
        case "auto":
          newTransport = await createTransport();
          wireParseErrorHook(newTransport);
          break;
        default:
          ctx.ui.notify(
            "Usage: /transport [file|uds|http <url>|auto]",
            "warning",
          );
          return;
      }

      // Migrate subscriptions to new transport
      const channels = [...watchedChannels];
      transport.unsubscribeAll();
      transport = newTransport;

      for (const ch of channels) {
        transport.subscribe(ch, onIncoming);
      }

      ctx.ui.setStatus("agent-ch", `channel: ${transport.name}`);
      ctx.ui.notify(
        `Transport switched to: ${transport.name}${channels.length > 0 ? ` (${channels.length} channels migrated)` : ""}`,
        "info",
      );
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
      const previous = agentName();
      identity = setLabel(identity, name);
      pi.appendEntry("agent-channel-identity", identityToData(identity));
      pi.events.emit("agent-channel:name", agentName());
      ctx.ui.setStatus("agent-name", agentName());
      ctx.ui.notify(`Agent name set to: ${agentName()}`, "info");

      // Tell the agent itself, not just the human. Without this the agent
      // keeps introducing itself with the old name in outgoing messages.
      try {
        pi.sendMessage(
          {
            customType: "agent-channel",
            content:
              `[agent-channel] Your agent name changed from "${previous}" to "${agentName()}". ` +
              `Use the new name when identifying yourself in channel_send bodies.`,
            display: true,
            details: {
              kind: "name-change",
              previous,
              current: agentName(),
            },
          },
          { triggerTurn: false },
        );
      } catch (err) {
        console.error(
          `[agent-channel] failed to inject name-change notice: ${
            err instanceof Error ? err.message : err
          }`,
        );
      }
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
      writeChannelFile(DEFAULT_CHANNEL_DIR, channel, { messages: [] });
      ctx.ui.notify(`Cleared channel '${channel}'`, "info");
    },
  });

  // ── Command: /channel-ls ──
  pi.registerCommand("channel-ls", {
    description: "List all channels and their message counts",
    handler: async (_args, ctx) => {
      if (!fs.existsSync(DEFAULT_CHANNEL_DIR)) {
        ctx.ui.notify("No channels found.", "info");
        return;
      }
      const files = fs
        .readdirSync(DEFAULT_CHANNEL_DIR)
        .filter((f) => f.endsWith(".json"));
      if (files.length === 0) {
        ctx.ui.notify("No channels found.", "info");
        return;
      }
      for (const f of files) {
        const ch = f.replace(/\.json$/, "");
        const data = readChannelFile(DEFAULT_CHANNEL_DIR, ch);
        const unacked = data.messages.filter((m) => !m.acked).length;
        ctx.ui.notify(
          `${ch}: ${data.messages.length} msgs (${unacked} unacked)`,
          "info",
        );
      }
    },
  });
}
