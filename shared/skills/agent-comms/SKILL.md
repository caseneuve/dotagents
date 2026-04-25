---
name: agent-comms
description: Communicate with other agents using shared channels, with backend-aware status and notifications (cmux, tmux, or file-only).
---

# agent-comms

Agents communicate through named channels backed by shared JSON files.
The protocol is the same regardless of backend (cmux, tmux, or file-only).
Status, progress, and notifications adapt to whatever is available.

## Common mistakes (read first)

These are the real failure modes we see in production. Do not repeat them.

### 1. OUT is not "end of turn" — it is "end of conversation"

- **OVER** (or no suffix) — your turn is done, the other agent replies.
- **OUT** — the entire exchange is finished. The other agent will NOT be
  woken up. Their `channel_watch` delivery suppresses the turn.

If you end a message with OUT and you were actually expecting a reply, the
receiver sees the message but is never prompted to act on it. The channel
then goes dead.

The `channel_send` tool returns an OUT-misuse warning when your body ends
with OUT but contains `?`, `please`, `can you`, `review this`, `let me
know`, `your turn`, `waiting for`, etc. If you see that warning, resend
the message ending with OVER.

Legitimate OUT uses: `approved`, `task-complete`, final `pong`, any other
definitive closer where no reply is required.

### 2. Do not `channel_unwatch` while a reply is still owed

`channel_unwatch` turns off push delivery for that channel. Any message
the other agent publishes after you unwatch will not reach your
conversation until you watch the channel again.

Only unwatch after the exchange on that channel is fully done (both
sides sent OUT, or one side sent `approved` / `task-complete`). When in
doubt, leave it watched — watches are cheap.

If you realize you unwatched too early, call
`channel_watch(channel, catch_up=true)` to replay missed messages.

### 3. `channel_status` is NOT a message to the other agent

`channel_status` updates the human-facing sidebar only. Other agents do
not see it. If agent A sets `channel_status("reviewing")` and then
waits, agent B has no way to know A is working — B will sit there
silently until it times out.

Rule of thumb:
- Need the human to know? → `channel_status`.
- Need another agent to know / react? → `channel_send`.
- Need both? → call both.

### 4. Trust the orientation message

On session start the extension injects an orientation note telling you
your agent name and your lobby channel. You do not need to guess either.
Do not re-announce presence manually on the lobby — it happens
automatically.

## Setup — automatic

The extension handles setup automatically:
- The lobby channel is **auto-watched** on session start — you don't need to call `channel_watch` for it.
- Your **agent name** and **lobby channel** are delivered in an orientation message at session start (before the first incoming channel message).
- A **presence announcement** is automatically sent when you auto-watch the lobby and when you call `channel_watch` on any other channel.

You're ready to communicate as soon as the orientation message arrives.

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

- **OVER** — your turn is done, the other agent should act.
- **OUT** — conversation finished, no reply expected. Use ONLY when the
  exchange is complete (e.g. after `approved`, `task-complete`, a final
  `pong`). OUT suppresses the receiver's turn — misusing it is the
  number one reason agent conversations silently stall.
- No suffix — same as OVER (other agent acts).

```
channel_send(
  channel: "<channel-name>",
  type: "<message-type>",
  body: "Here are the review findings. OVER"
)
```

Use **OUT** only when the exchange is done and no response is needed:

```
channel_send(
  channel: "<channel-name>",
  type: "approved",
  body: "All fixes verified, looks good. OUT"
)
```

`channel_send` returns an OUT-misuse warning when it detects request-like
phrasing paired with OUT. If you see that warning, resend the message
ending with OVER.

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

- `channel_list` — see all channels and their message counts.
- `channel_status` — update the sidebar status/progress visible to the **human only**. Does NOT send anything on any channel. If another agent needs to know your state, use `channel_send`.
- `channel_unwatch` — stop receiving messages on a channel. Only use when the exchange is fully done; otherwise replies will be silently lost.
- `/agent-name <label>` — set your display name (e.g. `/agent-name reviewer` → `agent-reviewer`). The extension injects a note into your conversation confirming the new name.

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

### file-only (fallback)

Messages work (file-based). Status and progress are no-ops.
Notifications fall back to `osascript` on macOS or `notify-send` on Linux.

Lobby is `file/lobby` — a machine-global channel shared by all Pi agents
running in bare terminals. Any agent on the same machine auto-discovers
others without configuration. Use dedicated task channels for isolation.
