---
title: agent channel protocol ux
status: closed
priority: high
type: bug
labels: []
created: 2026-04-25
parent: null
blocked-by: []
blocks: []
---

## Context

Agents are repeatedly getting stuck in broken comm states because the current
extension + skill combination fails to make key protocol rules visible. Issues
observed in the field:

1. **OUT is treated as "turn done"** instead of "conversation done". Agents
   append `OUT` to messages that actually expect a reply, the receiver's
   `shouldTriggerTurn` returns `false`, and the exchange silently dies.
2. **Eager `channel_unwatch`** — agents unwatch while still expecting a
   reply. The reply is published but never delivered to their session. The
   `channel_unwatch` tool response is just "Stopped watching 'X'", giving no
   hint that they've cut themselves off.
3. **Lobby confusion** — agents forget what the lobby channel is, whether
   they announced presence, and sometimes re-announce or skip it entirely.
   The identity-hint system only fires on the first *incoming* message, so a
   silent session never tells the agent anything about its own name or lobby.
4. **`/agent-name` is invisible to the agent.** The command only updates
   `ui.notify` + `ui.setStatus` — no `pi.sendMessage`. The agent keeps
   using the old name in outgoing messages.
5. **`channel_status` vs `channel_send` confusion.** Agents call
   `channel_status` thinking it notifies the other side. It only updates the
   human-facing sidebar, so the partner agent never sees the status update
   and sits idle — or worse, has already unwatched.

## Acceptance Criteria

- [x] Session start injects a non-triggering orientation message with the
      agent's name, the lobby channel, and a note that presence was already
      announced.
- [x] `/agent-name` injects a non-triggering message to the agent telling it
      the new name (in addition to the existing human-facing notify).
- [x] `channel_unwatch` returns an explicit warning that incoming messages
      will no longer be delivered until the agent re-watches.
- [x] `channel_send` detects OUT misuse (message ending in OUT that contains
      a question mark, "please", "can you", "will you", or similar
      reply-expecting phrasing) and returns a warning in the tool output.
- [x] `channel_status` tool description and guidelines make clear it updates
      the sidebar only and does NOT notify other agents.
- [x] Skill doc (`shared/skills/agent-comms/SKILL.md`) has an up-front
      "Common mistakes" section covering OUT vs OVER, unwatch hazards, and
      status vs send.
- [x] Tests: unit tests for OUT-misuse detection; integration tests for the
      session-start orientation message, `/agent-name` injection, and
      `channel_unwatch` warning text.

## Affected Files

- `pi/extensions/agent-channel/index.ts` — session_start orientation,
  `/agent-name` injection, `channel_unwatch` warning, `channel_send` OUT
  detection, `channel_status` description update.
- `pi/extensions/agent-channel/core.ts` — pure helper for OUT-misuse
  detection.
- `pi/extensions/agent-channel/core.test.ts` — tests for the helper.
- `shared/skills/agent-comms/SKILL.md` — Common mistakes section + tighter
  lobby/status/unwatch language.

## Notes

Code-level nudges are belt-and-suspenders: the skill doc is the primary
teaching surface, but doc alone has already failed; runtime feedback is
needed so agents get corrected at the moment of the mistake.
