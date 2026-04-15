---
name: agent-comms
description: Communicate with other agents using shared channels, with backend-aware status and notifications (cmux, tmux, or file-only).
---

# agent-comms

Agents communicate through named channels backed by shared JSON files.
The protocol is the same regardless of backend (cmux, tmux, or file-only).
Status, progress, and notifications adapt to whatever is available.

## Setup — do this immediately

The lobby channel is **injected into your system prompt** by the extension.
Look for `Comms protocol (lobby: <channel>):` near the end of your prompt.
Use that channel directly — do not re-derive it from environment variables.

Start watching it right away:

```
channel_watch(channel: <lobby>)
```

Every agent in the workspace does this. The lobby is always open.

When you call `channel_watch`, a **presence announcement** is automatically
sent on the channel so other agents know you're listening.

## Lobby vs task channels

The **lobby** (`CMUX_WORKSPACE_ID` or `tmux/<session>`) is for coordination:
- Announcing what you're working on
- Telling others where to find your results
- Short status updates

For longer workflows (code review, multi-step tasks), **create a task channel**
with a descriptive name and announce it on the lobby:

```
channel_send(
  channel: <CMUX_WORKSPACE_ID>,
  type: "status",
  body: "Starting code review for ticket 0042. Sending results on channel: agentic-stuff/review-0042"
)
channel_watch(channel: "agentic-stuff/review-0042")
```

The other agent sees this on the lobby, starts watching the task channel.

### Channel naming convention

Task channels **must** be scoped to the specific task, not shared across tasks:

```
<project>/review-<ticket>      ← code review for a ticket
<project>/deploy-<ticket>      ← deployment coordination
<project>/retro-<date>         ← retrospective discussion
```

**Do not** reuse generic names like `<project>/review` — concurrent tasks will
collide. Once a task is done (OUT), the channel is dead. New task = new channel.

Follow-up work **must** be announced on the lobby first — the other agent is no
longer watching the old task channel after OUT. Never send to a closed channel;
create a new one and announce it on the lobby so the other agent knows to watch it.

## Acting on messages

When a message arrives, **act on it**. Do not just acknowledge receipt — do the work,
then respond with the result.

Examples:

- `ping` arrives → respond with `pong`
- `review-request` arrives → do the review, send the review back
- `review-response` arrives → read findings, fix issues, send `task-complete` when done
- `task-complete` arrives → verify the work, respond with result or approval
- `request` arrives → do what's asked, send the result

Messages received via `channel_watch` are **auto-acknowledged** when injected
into your conversation. You do not need to call `channel_ack` manually for
watched channels.

For messages read via `channel_read` (manual polling), ack them after processing:

```
channel_ack(channel: "...", message_id: "...")
```

## Code review workflow example

**Reviewer agent:**
1. Watches lobby → sees "review my changes on `myproject/review-0042`"
2. Watches `myproject/review-0042`
3. Receives `review-request` with diff summary
4. Runs review, writes review file
5. Sends `review-response` with review file path and summary of findings
6. Waits for fixes

**Dev agent:**
1. Announces on lobby: "Sending review request on `myproject/review-0042`"
2. Sends `review-request` on `myproject/review-0042`
3. Watches `myproject/review-0042` for response
4. Receives `review-response` — reads the review file, applies fixes
5. Sends `task-complete` with summary of what was fixed
6. Reviewer verifies, sends `approved` or another `review-response`

## Message type conventions

| type | meaning | expected reaction |
|------|---------|-------------------|
| `ping` | Are you there? | Reply with `pong` |
| `pong` | I'm here | Acknowledge |
| `presence` | Agent joined channel | Note it (auto-sent by `channel_watch`) |
| `status` | Progress update / announcement | Note it, act if relevant |
| `request` | Do this task | Do it, send result |
| `task-complete` | Work is done | Verify, acknowledge or follow up |
| `review-request` | Please review these changes | Review and send findings |
| `review-response` | Here are review findings | Fix issues, send task-complete |
| `approved` | Looks good | Done, wrap up |

## Sending

End your message with **OVER** or **OUT** to control turn-taking:

- **OVER** — your turn is done, the other agent should act
- **OUT** — conversation finished, no reply expected
- No suffix — same as OVER (other agent acts)

```
channel_send(
  channel: "<channel-name>",
  type: "<message-type>",
  body: "Here are the review findings. OVER"
)
```

Use **OUT** when the exchange is done and no response is needed:

```
channel_send(
  channel: "<channel-name>",
  type: "approved",
  body: "All fixes verified, looks good. OUT"
)
```

## Receiving

Messages from watched channels are injected into your conversation automatically
and **auto-acknowledged**. When one arrives:
1. Act on it — do the work described
2. Respond on the same channel with results

**Note:** `channel_watch` only picks up messages sent *after* the watch starts.
To catch up on messages you might have missed, use the `catch_up` flag:

```
channel_watch(channel: <lobby>, catch_up: true)
```

This replays all unacked messages, injects them into your conversation, acks them,
then starts polling for new ones — all in a single call.

## Joining late

If you start after other agents are already communicating:

1. `channel_list` — discover what channels exist
2. `channel_watch(channel: ..., catch_up: true)` on the lobby and relevant task channels
3. Announce yourself on the lobby

The `catch_up` flag handles read + ack + watch in one step.

## Acknowledging messages

Messages received via `channel_watch` are auto-acked. For `channel_read`, use
`channel_ack` with three modes:

| `message_id` | effect |
|--------------|--------|
| `"<id>"` | Ack a specific message by ID |
| `"last"` | Ack the most recent unacked message on the channel |
| `"*"` | Ack **all** unacked messages on the channel |

Use `"*"` to bulk-clear a channel after catching up.
Use `"last"` when you only care about the latest message.

## Other useful tools

- `channel_list` — see all channels and their message counts
- `channel_status` — update sidebar status/progress visible to the human
- `/agent-name <label>` — set your display name (e.g. `/agent-name reviewer` → `agent-reviewer`)

## Multi-step work

When you have multiple sequential tasks for the same collaborator:

1. **Announce the plan on the lobby** at the start: "Working on N batches.
   Will send review requests sequentially on `<project>/review-<ticket>` channels."
2. **Between steps**, send a heads-up on the lobby before closing the current
   task channel: "Batch 1 done. Batch 2 coming next. Standby. OVER"
3. The collaborating agent **stays on the lobby** until all announced work is
   complete.

This prevents the other agent from going idle between steps. `OUT` on a task
channel means that channel is done — not that all work is done. The lobby is
where continuity lives.

## Timeouts and escalation

When waiting for a response on a task channel:

- **2 minutes, no response** — re-ping the lobby: "Still waiting for reviewer on `<channel>`. Anyone available?"
- **5 minutes, no response** — notify the human: use `channel_status` with a warning log
- **Do not** block silently — always escalate if a task channel goes quiet

This prevents dead-air situations where both sides assume the other is working.

## Review request format

When sending a `review-request`, include enough context for the reviewer to work
independently. Use this structure:

```
## What changed
<Brief summary of the change — what and why>

## Files
<List of changed files with one-line description each>

## How to review
<Exact command to see the diff, e.g. `cd /path && git diff HEAD~1`>

## Tests
<Test results: pass count, failure count, how to re-run>

## Risk
<What could go wrong, edge cases, migration concerns>
```

This avoids the reviewer guessing what to look at or how to verify.

## Backend-specific notes

### cmux (macOS)

Full sidebar support: status pills, progress bar, log lines, notification badges.
Detected automatically when `CMUX_SOCKET_PATH` is set or `cmux` is on PATH.

### tmux (Linux / cross-platform)

Status is shown via tmux pane titles and pane user options.
Notifications use `tmux display-message` by default.

For richer notifications, set `AGENT_NOTIFY_MODE=notify-send` to use
`notify-send`. With dunst, progress bars update in-place via stack tags.

To show agent status in the tmux status bar, add to `tmux.conf`:

```tmux
set -g pane-border-format "#{pane_title}"
set -g pane-border-status top
```

For a status-right integration, use the bundled helper:

```tmux
set -g status-right '#(~/.agent-channels/tmux-status.sh #{pane_id})'
```

### file-only (fallback)

Messages work (file-based). Status and progress are no-ops.
Notifications fall back to `osascript` on macOS or `notify-send` on Linux.
