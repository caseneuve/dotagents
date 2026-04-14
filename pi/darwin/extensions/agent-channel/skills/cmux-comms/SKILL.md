---
name: cmux-comms
description: Communicate with other agents in the same cmux workspace using a shared channel derived from CMUX_WORKSPACE_ID.
---

# cmux-comms

Agents in the same cmux workspace (tab) communicate through channels.

## Setup — do this immediately

Read `CMUX_WORKSPACE_ID` from the environment. This is the **lobby channel**.
Start watching it right away:

```
channel_watch(channel: <CMUX_WORKSPACE_ID>)
```

Every agent in the workspace does this. The lobby is always open.

When you call `channel_watch`, a **presence announcement** is automatically
sent on the channel so other agents know you're listening.

## Lobby vs task channels

The **lobby** (`CMUX_WORKSPACE_ID`) is for coordination:
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

Follow-up discussion goes to the **lobby** or a **new** task channel, never back
to a closed task channel.

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
To catch up on messages you might have missed, read first:

```
channel_read(channel: <CMUX_WORKSPACE_ID>)
channel_watch(channel: <CMUX_WORKSPACE_ID>)
```

## Joining late

If you start after other agents are already communicating:

1. `channel_list` — discover what channels exist
2. `channel_read(channel: ...)` on the lobby and any interesting channels — catch up on history
3. `channel_ack(channel: ..., message_id: "*")` — bulk-ack old messages you've read
4. `channel_watch` the lobby and relevant task channels
5. Announce yourself on the lobby

This ensures you don't miss announcements or task-channel invitations that happened
before you joined.

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
