---
title: "agent-channel: presence announced on lobby even when comms are off"
status: open
priority: medium
type: bug
labels: []
created: 2026-04-21
parent: null
blocked-by: []
blocks: []
---

## Context

When a new pi instance spawns, `session_start` in the agent-channel extension
auto-watches the lobby and publishes a `presence` message. This happens regardless
of the `commsMuted` flag (which defaults to `true`).

Other agents see the presence announcement and may assume the new agent is available
for communication, but it isn't — its channel tools are blocked and incoming messages
are silently dropped.

## Location

`extensions/agent-channel/index.ts`, in the `session_start` handler (~line 195-210):

```typescript
// Auto-watch the lobby
const lobbyChannel = resolveLobby();
if (lobbyChannel && !watchedChannels.has(lobbyChannel)) {
    watchedChannels.add(lobbyChannel);
    transport.subscribe(lobbyChannel, onIncoming);
    // Announce presence on the lobby
    const joinMsg = { ... type: "presence" ... };
    trackOwnMessage(joinMsg.id);
    await transport.publish(joinMsg);       // ← no commsMuted check
}
```

The `commsMuted` guard exists for:
- `tool_call` hook (blocks channel tools when muted)
- `onIncoming` callback (skips message injection when muted)

But NOT for the auto-lobby-watch + presence publish in `session_start`.

## Acceptance Criteria

- [ ] When `commsMuted` is `true` (default), no presence message is published on session start
- [ ] When `commsMuted` is `true`, lobby is not auto-watched (no subscription, no onIncoming)
- [ ] When comms are toggled on (`/comms on`), lobby watch + presence announcement fires then
- [ ] When comms are toggled off (`/comms off`), lobby watch is unsubscribed
- [ ] Existing behavior when comms are on is unchanged

## Affected Files

- `extensions/agent-channel/index.ts` — guard auto-lobby-watch with `!commsMuted`
- `extensions/agent-channel/index.ts` — add lobby watch+announce to `applyCommsState()` on toggle-on

## Notes

- The fix is straightforward: wrap the auto-watch block with `if (!commsMuted)`.
- The toggle-on path (`applyCommsState`) should replicate the lobby watch + presence
  logic so it fires when the user enables comms.
- Toggle-off should unsubscribe the lobby (and possibly send a "departure" message).
