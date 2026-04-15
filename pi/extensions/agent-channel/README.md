# agent-channel — inter-agent communication for pi

A pi extension that lets independently launched agents communicate
through named channels, with non-blocking polling and cmux sidebar
integration.

## Install

Already installed at `~/.pi/agent/extensions/agent-channel/`. Loaded
automatically on every pi session. Use `/reload` if you edit the source.

## How it works

```
┌─────────────────┐                          ┌─────────────────┐
│  Agent A (pi)   │                          │  Agent B (pi)   │
│                 │   channel_send ──────►   │                 │
│  channel_watch  │◄──── ~/.agent-channels/  │  channel_send   │
│  (polls every   │      project_review.json │                 │
│   3 seconds)    │                          │  channel_status │
│                 │   channel_read ──────►   │  (sidebar 🔍)   │
│  channel_ack    │   channel_ack            │                 │
└────────┬────────┘                          └────────┬────────┘
         │                                            │
         │         cmux sidebar                       │
         │  ┌──────────────────────────┐              │
         └──│  Agent A: reviewing 🔍   │──────────────┘
            │  Agent B: done ✅        │
            │  ▓▓▓▓▓░░░ 60% building  │
            │  [info] found 3 issues   │
            └──────────────────────────┘
```

**Messages** are JSON files in `~/.agent-channels/`. Any number of pi
instances can read/write them. Each message has an `id`, `channel`,
`from`, `to`, `type`, `body`, and `acked` flag.

**Backends** are pluggable. The extension auto-detects cmux (for sidebar
status/progress/logs/notifications). Falls back to a file-only backend
with macOS `osascript` notifications.

## Tools

| Tool | Purpose |
|------|---------|
| `channel_send` | Send a message to a channel |
| `channel_read` | Read (poll) messages from a channel |
| `channel_ack` | Mark a message as received |
| `channel_watch` | Start background polling (auto-injects incoming messages) |
| `channel_unwatch` | Stop background polling |
| `channel_status` | Update cmux sidebar (status pills, progress bar, log lines) |
| `channel_list` | List all channels and message counts |

## Commands

| Command | Purpose |
|---------|---------|
| `/comms [on\|off]` | Toggle agent comms on/off |
| `/channel-clear <name>` | Delete all messages from a channel |
| `/channel-ls` | List channels in the notification bar |

## Keyboard Shortcuts

| Shortcut | Purpose |
|----------|---------|
| `Ctrl+Shift+M` | Toggle agent comms on/off |

## Scenario: Code Review Loop

### Setup

Open two cmux workspaces, each running pi:

**Workspace "Agent-A":**
```
CMUX_AGENT_NAME=agent-a pi
```

**Workspace "Agent-B":**
```
CMUX_AGENT_NAME=agent-b pi
```

### Agent A (the coder)

Tell Agent A:
```
Watch channel "myproject/review" for incoming code reviews.
Continue working on the auth module while you wait.
When a review arrives, ack it, read the feedback, apply fixes,
then send a "fixes-applied" message back on the same channel.
```

Agent A will call `channel_watch("myproject/review")` and continue
working. When Agent B's review arrives, it gets injected into the
conversation automatically.

### Agent B (the reviewer)

Tell Agent B:
```
Review the code in src/auth.ts. When done, send the review on
channel "myproject/review" with type "code-review". Set your
sidebar status while working. Then watch for a "fixes-applied"
reply.
```

Agent B will:
1. `channel_status(status="reviewing auth.ts", icon="🔍")`
2. Read the code, write the review
3. `channel_send(channel="myproject/review", type="code-review", body="...")`
4. `channel_watch("myproject/review")` — waits for Agent A's reply
5. When Agent A sends "fixes-applied", the loop continues

### What the human sees

The cmux sidebar shows:
- **Agent-A**: `reviewing 🔍` → `applying fixes ⚙️` → `done ✅`
- **Agent-B**: `reviewing code 🔍` → `waiting for fixes ⏳` → `done ✅`
- Progress bars, log lines, and notification badges update in real time
- ⌘⇧U jumps to the latest notification from either agent

## Channel naming conventions

Use descriptive, scoped names:
- `project-name/code-review`
- `project-name/task-status`
- `worktree-branch/scout-report`
- `global/build-results`

## Environment variables

| Variable | Purpose |
|----------|---------|
| `CMUX_AGENT_NAME` | Agent identity for message `from` field |
| `PI_SESSION_NAME` | Fallback identity |
| `CMUX_SOCKET_PATH` | Auto-detected; triggers cmux backend |
| `TMUX` | Auto-detected; triggers tmux backend when cmux is not available |
| `AGENT_NOTIFY_MODE` | Notification strategy for tmux backend: `auto`, `tmux`, or `notify-send` |

## Architecture: pluggable backends

The `ChannelBackend` interface is minimal:

```typescript
interface ChannelBackend {
  name: string;
  publish(msg: ChannelMessage): Promise<void>;
  read(channel: string, opts?): Promise<ChannelMessage[]>;
  ack(channel: string, messageId: string): Promise<void>;
  setStatus(key: string, value: string, icon?: string): Promise<void>;
  setProgress(fraction: number, label: string): Promise<void>;
  clearProgress(): Promise<void>;
  log(message: string, level?: string, source?: string): Promise<void>;
  notify(title: string, body: string): Promise<void>;
}
```

Current backends:
- **CmuxBackend** — file-based messages + `cmux` CLI for sidebar/notifications (macOS)
- **TmuxBackend** — file-based messages + tmux pane titles, user options, and `display-message` for status/notifications (Linux / cross-platform). Supports `notify-send` with dunst stack tags for in-place progress updates.
- **FileOnlyBackend** — file-based messages + platform-native notifications (`osascript` on macOS, `notify-send` on Linux). No status bar integration.

Backend selection is automatic:
1. cmux detected (`CMUX_SOCKET_PATH` or `cmux` on PATH) → CmuxBackend
2. tmux session detected (`$TMUX` set) → TmuxBackend
3. Otherwise → FileOnlyBackend

Set `AGENT_NOTIFY_MODE` to override TmuxBackend notification strategy:
- `tmux` — always use `tmux display-message` (default when `notify-send` not found)
- `notify-send` — always use `notify-send` (best with dunst for progress bars)
- `auto` — detect `notify-send` availability at startup (default)

Future backends could add:
- **RemoteBackend** — HTTP/WebSocket for cross-machine agents
- **RedisBackend** — for high-throughput multi-agent systems
