---
title: agent-channel surface hard transport errors to the agent
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

When a hard programmatic error hits the `agent-channel` transport layer
— socket disconnect, subscribe failure, publish failure in an
extension-initiated broadcast, internal ack failure — **the agent is
not told**. Some of these swallow to stderr, some bubble into the
lifecycle handler uncaught, some silently return `void` from a failed
async chain. In every case the agent keeps running as if nothing
happened, which in practice means:

- peer sends a message to a channel the agent thinks it's watching →
  the subscription silently failed at session start → message is lost
  to that session
- agent sends a `review-request` with OVER → transport disconnect
  right after → tool reports success, peer never sees it, both sides
  wait

This is the complement of the work we did in commits `006b80f` and
`cada2e4`, which covered *incoming* frame parse errors via
`onParseError`. Here we extend the same pattern to the other hard
failure modes.

## Scope of the gap (from the audit)

Sites that currently fail silently or only to stderr:

1. **Subscribe failures** at every call site (session_start restore,
   session_start lobby, `channel_watch.execute`, `/transport` swap).
   `UdsTransport.subscribe` does `ensureConnected().then(send)`; a
   connect rejection aborts the `.then` without firing any callback.
   `channel_watch` returns "Now watching..." regardless.
2. **UDS socket close / HTTP SSE stream close** during operation.
   Transport handles reconnection internally but the agent gets no
   signal that their active subscriptions went cold in between.
3. **Extension-initiated publish failures.** The `/agent-name` rename
   broadcast from `d27fca9` uses `.catch(err => console.error(...))`
   per channel — stderr only, nothing to the agent.
4. **session_start lobby auto-announce** (`await transport.publish(joinMsg)`)
   is awaited but uncaught. If it throws, the error bubbles into the
   `session_start` lifecycle handler.
5. **`onIncoming` internal ack** (`transport.ack(...).catch(() => {})`)
   is silently swallowed. Low impact (catch_up replays) but technically
   a hidden error.

**Not in scope:**
- Watcher-presence checks ("is anyone actually subscribed?") — already
  deferred by ksu8 round 4 as too weak a signal on file-transport.
- Automatic retry / re-send. The agent decides what to do on error.

## Proposed fix shape

Generalize the existing `onParseError` hook into `onTransportError` with
a discriminated-union payload, and fire it from every silent site.

```ts
// interfaces.ts
export interface TransportErrorInfo {
  transport: string;                  // "uds" | "http" | "file"
  kind:
    | "parse-error"                   // existing: malformed frame / shape
    | "subscribe-failed"              // subscribe() connect / send rejected
    | "disconnected"                  // transport socket closed unexpectedly
    | "reconnecting"                  // post-close, retry pending
    | "reconnected"                   // back online
    | "publish-failed"                // extension-initiated publish threw
    | "ack-failed";                   // internal ack failed
  channel?: string;
  error: string;
  rawPreview?: string;                // reused for parse-error
}

export interface MessageTransport {
  // rename from onParseError (keep old name as type alias for one cycle
  // to avoid breaking downstream consumers outside this repo).
  onTransportError?: (info: TransportErrorInfo) => void;
  // ...existing members unchanged
}
```

### Wiring per transport

- **UdsTransport.subscribe** — attach `.catch` to
  `ensureConnected().then(...)`; fire `kind: "subscribe-failed"`.
- **UdsTransport `sock.on("close")`** — fire `kind: "disconnected"`
  when the socket closes with active subscriptions in the map.
- **UdsTransport `ensureConnected()` retry paths** — fire
  `kind: "reconnecting"` before each attempt and `kind: "reconnected"`
  in the success callback when prior state was disconnected.
- **HttpTransport SSE reconnect loop** — mirror the three events above.
- **FileTransport** — no-op (polling can't really disconnect; file
  read errors already flow through the existing channel-file code
  path).

### Wiring in `index.ts`

Rename `wireParseErrorHook` → `wireTransportErrorHook`. Dispatch on
`info.kind` to pick the right phrasing and severity level:

| kind                | display.log level | Agent message |
|---------------------|-------------------|---------------|
| `parse-error`       | warning           | existing text |
| `subscribe-failed`  | error             | "⚠️ Subscription to channel X failed (<error>). Your watch is NOT active. Call channel_watch again after the transport recovers." |
| `disconnected`      | warning           | "⚠️ Lost connection to <transport> transport. Messages published in the last few seconds may not have been delivered. Reconnecting…" |
| `reconnecting`      | info              | (sidebar log only, no pi.sendMessage — avoid spam) |
| `reconnected`       | info              | "✅ Reconnected to <transport> transport. Active subscriptions restored." |
| `publish-failed`    | error             | "⚠️ agent-channel failed to publish on channel X (<error>). The message was NOT delivered." |
| `ack-failed`        | info              | (sidebar log only, low urgency; catch_up replays) |

Each non-silent case wraps `pi.sendMessage` in the same try/catch used
by the existing parse-error branch so a diagnostic failure can't crash
the session.

### Call-site changes outside transports

- `/agent-name` rename broadcast: replace the `.catch(err =>
  console.error(...))` with a call that fires the hook.
- session_start lobby auto-announce: wrap in try/catch; on failure,
  fire the hook AND set `lobbyAutoAnnounced = false` so the
  orientation message reflects reality.
- `onIncoming` internal ack: replace the naked `.catch(() => {})` with
  a hook fire for `kind: "ack-failed"` (sidebar-only, no message
  injection).

## Acceptance Criteria

- [ ] `MessageTransport.onTransportError` replaces `onParseError` in
      `interfaces.ts`; `ParseErrorInfo` becomes `TransportErrorInfo`
      with a discriminated `kind` field. `onParseError` kept as a
      deprecated alias exported from `interfaces.ts` for one release
      cycle.
- [ ] All six event kinds fire from their respective sites with
      accurate `error` strings and `channel` populated when known.
- [ ] `channel_watch` end-to-end: start with the UDS relay down,
      call the tool, observe the agent receives a
      `subscribe-failed` diagnostic (not a silent success).
- [ ] Kill the relay mid-session with an active subscription:
      observe a `disconnected` diagnostic appears. Restart the
      relay: observe `reconnected`. No `reconnecting` diagnostic
      injected into the conversation (sidebar only).
- [ ] `/agent-name` rename with a down relay produces one
      `publish-failed` diagnostic per watched channel.
- [ ] `onIncoming` ack failure shows a sidebar log line but no
      conversation injection.
- [ ] Tests:
  - unit: the hook dispatch logic in `wireTransportErrorHook` (each
    `kind` produces the expected message / level).
  - uds-framing test file: extend the existing fake-relay pattern
    to cover `subscribe-failed` and `disconnected` events.
  - regression: existing 159 tests still pass without modification.

## Affected Files

- `pi/extensions/agent-channel/interfaces.ts` — type rename +
  `TransportErrorInfo` discriminated union.
- `pi/extensions/agent-channel/uds-transport.ts` — subscribe catch,
  close-event fire, reconnect tracking.
- `pi/extensions/agent-channel/http-transport.ts` — SSE
  disconnect/reconnect events.
- `pi/extensions/agent-channel/file-transport.ts` — no-op stub update
  (property rename only).
- `pi/extensions/agent-channel/index.ts` — rename hook, dispatch on
  `kind`, fix rename-broadcast and lobby-auto-announce call sites,
  `onIncoming` ack.
- `pi/extensions/agent-channel/core.test.ts` — no changes expected
  (pure-helper tests unaffected).
- `pi/extensions/agent-channel/uds.test.ts` — new `subscribe-failed`
  and `disconnected` test cases using the existing fake-relay
  scaffold.
- `pi/extensions/agent-channel/README.md` — extend the "Handling
  malformed frames" section into "Handling transport errors" with
  the new kinds.
- `shared/skills/agent-comms/SKILL.md` — one paragraph under "Common
  mistakes" pointing at the new diagnostic shape so agents know to
  watch for `subscribe-failed` / `disconnected` messages and how to
  react.

## E2E Spec

GIVEN an agent with an active subscription on channel C on the UDS
  transport
WHEN the UDS relay is killed mid-session and then restarted
THEN the agent receives (in order):
     1. a `disconnected` diagnostic with the transport name
     2. zero or more `reconnecting` sidebar-log lines (no conversation
        injection)
     3. a `reconnected` diagnostic when the socket is back
     4. any messages published on C while disconnected are NOT
        auto-replayed (deferred: separate concern, see note below)

GIVEN an agent calling `channel_watch("foo")` with the UDS relay down
WHEN `ensureConnected` rejects during the subscribe
THEN the tool returns its usual "Now watching..." result, BUT the
     agent also receives a `subscribe-failed` diagnostic within the
     same turn telling them the watch is not active.

## Notes

- **Replay-on-reconnect** is a related but separate concern. When the
  UDS socket reconnects, messages published while we were offline are
  lost on the relay side (not buffered for offline subscribers). The
  right fix there is either server-side per-subscriber queuing or a
  client-side `catch_up` on reconnect. Out of scope for this todo —
  once `disconnected` / `reconnected` diagnostics exist, the agent can
  decide whether to trigger `channel_watch(..., catch_up=true)`
  themselves.
- **Deprecation of `onParseError`**: keep as a `type ParseErrorInfo =
  Extract<TransportErrorInfo, {kind: "parse-error"}>` alias for one
  release cycle; wire both names to the same function pointer so
  external consumers (if any) don't break immediately.
- **Sizing**: all work is in one extension directory, mostly
  mechanical. Estimate 1-2 hours with the tests and docs. Fits a
  single commit per the current checkpoint discipline.
- Paired with `todos/0017` which addressed the UX layer of the same
  problem (agents confused about protocol). This todo addresses the
  runtime layer (technical errors go unreported).
