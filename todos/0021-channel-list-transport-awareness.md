---
title: channel_list is transport-unaware, silently misleading agents on UDS/HTTP
status: open
priority: high
type: bug
labels: []
created: 2026-04-25
parent: null
blocked-by: []
blocks: []
---

## Context

Every channel tool except `channel_list` is transport-aware. `channel_send`,
`channel_read`, `channel_watch`, `channel_ack` all route through the
`MessageTransport` that `createTransport()` picked at session start
(UDS / HTTP / File). `channel_list`, in contrast, always reads the
filesystem:

```ts
// pi/extensions/agent-channel/index.ts (channel_list tool handler)
const files = fs.readdirSync(DEFAULT_CHANNEL_DIR).filter(f => f.endsWith(".json"));
```

This worked when `FileTransport` was the only backend. Since UDS and
HTTP transports shipped, `channel_list` has been showing data from a
completely different data store than the other tools use.

### Observed failure mode

An agent on the UDS relay today:

1. Reads `shared/skills/agent-comms/SKILL.md` and trusts the promise
   that *"channel_send / channel_read / channel_watch always go
   through whatever transport is live; which one is live is
   transparent to the agent"* (the `ac42c49` rewrite).
2. Runs `channel_list` to discover what's reachable.
3. Sees ~50 channels including lobby-shaped UUIDs from other workspaces
   and a variety of `dotagents_review-*`, `agentic-stuff_*`, etc.
4. Assumes those are reachable — sends a `ping` to one of them.
5. The message lands in the relay's in-memory store. Nobody is
   subscribed to it on UDS (the channel only exists as filesystem
   history from past FileTransport usage). The send succeeds at the
   tool layer but nobody receives it.
6. Agent waits. Nothing happens. Concludes the relay is broken, or
   the peer is gone. Neither is true — they were looking at the
   wrong data store all along.

This was the exact trap a cross-workspace ping hit in the session
where this todo was filed. Agent was misled by `channel_list`'s
filesystem output and pinged a UUID-shaped channel that had no live
UDS subscribers.

### Asymmetric impact

- **File transport:** `channel_list` and the other tools use the same
  store. No confusion. What you see is what you can reach.
- **UDS / HTTP transport:** `channel_list` reads the filesystem; the
  other tools reach the relay's in-memory store. The two can be
  completely disjoint. The displayed "channels" include file-transport
  archaeology that's never been near the current relay.

Everyone using the UDS relay (which is now the default on this
machine, and on any machine where `bb relay:start` has been run) is
hitting this.

## Scope — what this is NOT

- Not a doc bug. The doc is consistent with the OTHER tools'
  behavior; `channel_list` is the outlier.
- Not a relay bug. The relay correctly stores what it's told to
  store.
- Not a client-side transport bug. UDS/HTTP transports correctly
  roundtrip messages when both sides are on the same live channel.

## Fix shape

Make `channel_list` query the **active transport**, not the
filesystem.

### 1. Add a `listChannels` RPC to the relay

`shared/relay/server.ts` gains a new ndjson action:

```ts
// alongside read / ack / subscribe / unsubscribe / publish:
case "list_channels": {
  const out = [];
  for (const [channel, msgs] of this.store.allChannels()) {
    const subs = this.subscribers.get(channel)?.size ?? 0;
    out.push({ channel, messageCount: msgs.length, subscriberCount: subs });
  }
  reply(sub, req.reqId, out);
  break;
}
```

Needs a small helper on `ChannelStore` to iterate channels
(the private `channels: Map<string, ChannelMessage[]>` isn't exposed
today).

### 2. Add `listChannels()` to the `MessageTransport` interface

```ts
// pi/extensions/agent-channel/interfaces.ts
interface ChannelInfo {
  channel: string;
  messageCount: number;
  subscriberCount?: number; // UDS/HTTP only; undefined for file
}

interface MessageTransport {
  // ...existing members
  listChannels(): Promise<ChannelInfo[]>;
}
```

Implementations:
- `FileTransport.listChannels()` — the current `readdir` logic, moved
  out of the tool handler. `subscriberCount` is always undefined.
- `UdsTransport.listChannels()` — `this.request({action: "list_channels"})`.
- `HttpTransport.listChannels()` — new endpoint `GET /channels` already
  exists on the relay's HTTP side (used by `createTransport()`'s
  probe); extend the response to include subscriberCount.

### 3. Rewrite the `channel_list` tool to use the active transport

```ts
async execute() {
  const channels = await transport.listChannels();
  // render: "channel: N msgs (S subscribers)" when subscriber count is known
}
```

### 4. Optional — cross-backend flag

A `channel_list(across_all_backends: true)` flag that unions the
active transport's view with the filesystem. Default false so the
simple case is unambiguous. Output clearly labels which backend each
channel comes from.

## Acceptance Criteria

- [ ] `MessageTransport.listChannels(): Promise<ChannelInfo[]>`
      added to `interfaces.ts`.
- [ ] `FileTransport.listChannels` moves the existing readdir logic
      out of the tool handler. Returns `{channel, messageCount}`
      (no subscriberCount).
- [ ] `UdsTransport.listChannels` round-trips the new
      `list_channels` ndjson action.
- [ ] `HttpTransport.listChannels` calls the existing `/channels`
      endpoint (or extends it) and returns the same shape.
- [ ] `shared/relay/server.ts` handles the `list_channels` action on
      UDS and returns `{channel, messageCount, subscriberCount}` per
      channel.
- [ ] `shared/relay/server.ts` `GET /channels` returns the same shape
      (may already; verify).
- [ ] `channel_list` tool output on UDS/HTTP shows only channels the
      relay actually knows about, with subscriber counts where
      available.
- [ ] Skill doc + extension README updated to describe the new
      behavior.
- [ ] Tests:
  - Unit: FileTransport.listChannels returns expected shape.
  - uds.test.ts: publishing on two channels from two transports,
    `listChannels` returns both with correct subscriberCounts.
  - Regression: existing `channel_list` tests still pass.

## Affected Files

- `pi/extensions/agent-channel/interfaces.ts` — new method + ChannelInfo type.
- `pi/extensions/agent-channel/file-transport.ts` — implement listChannels.
- `pi/extensions/agent-channel/uds-transport.ts` — implement listChannels via new RPC.
- `pi/extensions/agent-channel/http-transport.ts` — implement listChannels via HTTP GET.
- `pi/extensions/agent-channel/index.ts` — `channel_list` tool handler delegates.
- `shared/relay/server.ts` — `list_channels` ndjson action + HTTP endpoint verification.
- `shared/relay/store.ts` — expose a channels iterator (small API addition).
- `pi/extensions/agent-channel/uds.test.ts` — new test case.
- `pi/extensions/agent-channel/transports.test.ts` — new test case for file.
- `shared/skills/agent-comms/SKILL.md` — clarify that `channel_list`
  now shows the active transport's channels, with a note on the
  `across_all_backends` flag if implemented.
- `pi/extensions/agent-channel/README.md` — same.

## E2E Spec

GIVEN two agents on the same UDS relay
WHEN both have `channel_watch`'d channel `xw/demo` and only that
THEN `channel_list` on either agent shows `xw/demo` with
     `subscriberCount=2`
AND does NOT show any file-transport-only channels from
    ~/.agent-channels/

GIVEN an agent on FileTransport (no relay running)
WHEN `channel_list` runs
THEN it returns the current filesystem list (backward compatible
     output for file-transport sessions).

## Notes

- Same bug-class signature as the `detectOutMisuse` type-check
  omission from round 9 of the protocol work: docs promise
  transport-transparency, one tool reaches past the transport layer.
- Priority `high` because this is likely the root cause of any
  "messages vanish" / "the relay is broken" reports from agents
  using the UDS backend, which is now the default.
- Implementation is multi-file (relay, interfaces, three transport
  implementations, one tool handler, docs) and warrants a feature
  branch per `AGENTS.md` current rules. Estimated 2–3 hours with
  tests.
- Identified during session where `ac42c49` clarified the
  transport-vs-display distinction. The clarification made the
  existing `channel_list` bug obvious: once you explain that
  transport is pluggable, it's immediately absurd that one tool
  ignores the plug.
