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
  body: "Starting code review for agentic-stuff. Sending results on channel: agentic-stuff/review"
)
channel_watch(channel: "agentic-stuff/review")
```

The other agent sees this on the lobby, starts watching the task channel.

## Acting on messages

When a message arrives, **act on it**. Do not just acknowledge receipt — do the work,
then respond with the result.

Examples:

- `ping` arrives → respond with `pong`
- `review-request` arrives → do the review, send the review back
- `review-response` arrives → read findings, fix issues, send `task-complete` when done
- `task-complete` arrives → verify the work, respond with result or approval
- `request` arrives → do what's asked, send the result

Always:
1. `channel_ack` the message
2. Do the work
3. `channel_send` the result back on the same channel

## Code review workflow example

**Reviewer agent:**
1. Watches lobby → sees "review my changes on `myproject/review`"
2. Watches `myproject/review`
3. Receives `review-request` with diff summary
4. Runs review, writes review file
5. Sends `review-response` with review file path and summary of findings
6. Waits for fixes

**Dev agent:**
1. Announces on lobby: "Sending review request on `myproject/review`"
2. Sends `review-request` on `myproject/review`
3. Watches `myproject/review` for response
4. Receives `review-response` — reads the review file, applies fixes
5. Sends `task-complete` with summary of what was fixed
6. Reviewer verifies, sends `approved` or another `review-response`

## Message type conventions

| type | meaning | expected reaction |
|------|---------|-------------------|
| `ping` | Are you there? | Reply with `pong` |
| `pong` | I'm here | Acknowledge |
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

Messages from watched channels are injected into your conversation automatically.
When one arrives:
1. Acknowledge it: `channel_ack(channel: "...", message_id: "...")`
2. Act on it — do the work described
3. Respond on the same channel with results

**Note:** `channel_watch` only picks up messages sent *after* the watch starts.
To catch up on messages you might have missed, read first:

```
channel_read(channel: <CMUX_WORKSPACE_ID>)
channel_watch(channel: <CMUX_WORKSPACE_ID>)
```

## Other useful tools

- `channel_list` — see all channels and their message counts
- `channel_status` — update sidebar status/progress visible to the human
- `/agent-name <label>` — set your display name (e.g. `/agent-name reviewer` → `agent-reviewer`)
