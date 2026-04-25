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
  onTransportError?: (info: TransportErrorInfo) => void;
  // ...existing members unchanged
}
```

`onParseError` was introduced in `006b80f` on the `macos` branch and
has not shipped anywhere external — no downstream consumers to
preserve. Rename cleanly; drop the deprecated-alias dance. Keep
`ParseErrorInfo = Extract<TransportErrorInfo, {kind: "parse-error"}>`
only if something internal still references the name.

### Wiring per transport

- **UdsTransport.subscribe** — attach `.catch` to
  `ensureConnected().then(...)`; fire `kind: "subscribe-failed"`.
  Note: the `subscriptions` Map entry is set BEFORE
  `ensureConnected`, so on transport reconnect the subscription
  auto-resumes. Phrase the diagnostic accordingly (see table below).
- **UdsTransport `sock.on("close")`** — fire `kind: "disconnected"`
  when the socket closes with active subscriptions in the map. Track
  a `wasConnected` flag so a subsequent `ensureConnected` success
  fires `kind: "reconnected"` (and not a duplicate "connected" on the
  first-ever connect).
- **UdsTransport `ensureConnected()` retry paths** — fire
  `kind: "reconnecting"` once per disconnect episode (rate-limited:
  do not emit on every retry attempt or the log becomes noise).
- **HttpTransport SSE reconnect loop** — mirror the three events
  above. **Scope note:** these events apply ONLY to SSE subscriptions.
  Publish / read / ack errors on HttpTransport already reject back to
  the tool caller (fetch throws, tool execute throws, framework
  surfaces) and must NOT be double-reported via the hook.
- **FileTransport** — no-op (polling can't really disconnect; file
  read errors already flow through the existing channel-file code
  path).

### Wiring in `index.ts`

Rename `wireParseErrorHook` → `wireTransportErrorHook`. Dispatch on
`info.kind` to pick the right phrasing and severity level:

| kind                | display.log level | Agent message |
|---------------------|-------------------|---------------|
| `parse-error`       | warning           | existing text |
| `subscribe-failed`  | error             | "⚠️ Subscription to channel X could not be established (`<error>`). If the transport reconnects, your watch will resume automatically; otherwise call `channel_watch` again." |
| `disconnected`      | warning           | "⚠️ Lost connection to `<transport>` transport. Messages published in the last few seconds may not have been delivered. Reconnecting…" |
| `reconnecting`      | info              | (sidebar log only, no `pi.sendMessage` — rate-limited to one per disconnect episode) |
| `reconnected`       | info              | "✅ Reconnected to `<transport>` transport. Subscriptions resumed, but messages published while disconnected were NOT buffered. Call `channel_watch(\"<channel>\", catch_up=true)` to replay missed messages." |
| `publish-failed`    | error             | "⚠️ agent-channel failed to publish on channel X (`<error>`). The message was NOT delivered." |
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
      with a discriminated `kind` field. Clean rename — no deprecated
      alias kept (nothing external consumes the old name yet).
- [ ] All six event kinds fire from their respective sites with
      accurate `error` strings and `channel` populated when known.
- [ ] `publish-failed` fires from BOTH `/agent-name` rename broadcast
      AND `session_start` lobby auto-announce.
- [ ] `channel_watch` end-to-end: start with the UDS relay down,
      call the tool, observe the agent receives a
      `subscribe-failed` diagnostic (not a silent success).
- [ ] Kill the relay mid-session with an active subscription:
      observe a `disconnected` diagnostic appears. Restart the
      relay: observe `reconnected` with the `catch_up=true` hint.
      Only one `reconnecting` sidebar line per disconnect episode
      (not one per retry).
- [ ] `/agent-name` rename with a down relay produces one
      `publish-failed` diagnostic per watched channel.
- [ ] `onIncoming` ack failure shows a sidebar log line but no
      conversation injection.
- [ ] `HttpTransport` publish/read/ack errors continue to throw back
      to the tool caller and are NOT double-reported via
      `onTransportError` (test guards against regression).
- [ ] `wireTransportErrorHook` dispatcher factored so its logic is
      testable without an `ExtensionAPI` — extract as a pure factory
      that takes `pi.sendMessage` + `display` as injected deps. One
      unit test per `kind` asserting the expected
      (level, injected-message-or-none) pair.
- [ ] Tests:
  - unit: dispatcher factory (one case per `kind`).
  - uds-framing test file: extend the existing fake-relay pattern
    to cover:
    - `subscribe-failed` (start with relay down, call subscribe)
    - `disconnected` (kill relay mid-stream)
    - **full state-machine cycle**: subscribe → publish+receive baseline
      → kill relay → observe `disconnected` → restart relay →
      observe `reconnected` with catch_up hint → publish again →
      verify receive still works.
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
  the `reconnected` diagnostic explicitly tells the agent to call
  `channel_watch(..., catch_up=true)` themselves.
- **State-machine gotchas** (from ksu8 review, budget accordingly):
  - `UdsTransport.ensureConnected` is called concurrently from
    publish/subscribe/request. `sock.on("close")` fires once; the
    next `ensureConnected` starts a new connect. Need a
    `wasConnected` flag so a success fires `reconnected` (diagnostic)
    vs a fresh `connected` (silent).
  - `subscribe-failed` triggers on the first `ensureConnected`
    rejection. Don't suppress waiting for "terminal" — the reconnect
    loop is by design non-terminal on UDS. If the transport then
    reconnects, the user will see `reconnected` and can infer the
    subscription resumed. The diagnostic wording must match this
    (don't say "call channel_watch again" — the map already holds the
    entry and auto-resubscribes).
  - `reconnecting` emit rate: one sidebar-log line per disconnect
    episode (on first retry), suppress subsequent attempts until
    success/failure, reset on next disconnect.
- **HttpTransport scope:** `disconnected`/`reconnecting`/`reconnected`
  apply only to SSE subscriptions. Publish/read/ack errors are
  already thrown back to tool callers (fetch rejects, tool execute
  throws) and must not be double-reported via the hook. Regression
  test asserts this.
- **Sizing**: ksu8-adjusted estimate is 2.5–3 h (not the original
  1–2 h). State-machine logic and the dispatcher-factory extraction
  are where the time goes. May split across two commits: runtime
  wiring in one, state-machine polish + tests in a second.
- Paired with `todos/0017` which addressed the UX layer of the same
  problem (agents confused about protocol). This todo addresses the
  runtime layer (technical errors go unreported).
