---
title: agent-channel UDS kB-scale frame corruption
status: open
priority: high
type: bug
labels: []
created: 2026-04-25
parent: null
blocked-by: []
blocks: ["0018"]
---

## Context

Reproduced in a live session today. `ksu8` (another agent on the same
UDS relay) sent me a `review-response` with body ~8KB. My UDS transport
fired an `onParseError` diagnostic:

> ⚠️ agent-channel (uds transport) dropped a malformed frame:
> Expected ',' or '}' after property value in JSON at position 8127
> (line 1 column 8128). Preview: {"type":"message","channel":"...",
> "msg":{"id":"...","body":"Reviewed `32038e3`. ...

The `onParseError` pipeline worked correctly (that's what 006b80f was
built for) — but the message content itself was lost. `ksu8` had to
re-send a compact version to unstick the review loop.

## Root cause (ksu8 diagnosis)

**`shared/relay/server.ts:126`** — the relay's UDS subscriber wrapper
does unchecked `socket.write(data)` where `socket` is a Bun.listen
socket, NOT a Node `net.Socket`. Semantics differ:

- **Node** `net.Socket.write(buf)`: auto-buffers overflow in userland,
  returns `false` on backpressure, emits `drain`. Caller can ignore
  return value; bytes still arrive.
- **Bun** `Socket.write(str)`: returns the **number of bytes actually
  written**. Anything beyond that is silently dropped. No userland
  queue, no retry.

For frames below the kernel UDS send buffer size, the whole string
fits in one syscall and return value equals length — everything
works. macOS default `net.local.stream.sendspace` is 8192 bytes. Any
frame near or past that boundary does a partial write, returns a
smaller count, and trailing bytes are dropped. Receiver's
`splitJsonFrames` sees a truncated frame — if the truncation happens
to land after a `}` by luck, the scanner extracts it as balanced, and
`JSON.parse` throws at the chop point:
`"Expected ',' or '}' after property value at position N"` where
N ≈ 8127. Position matches exactly.

Direction: **relay → subscriber only**. Client → relay is safe because
`UdsTransport` uses Node's `net.createConnection` which auto-buffers.
Publish succeeds; fan-out to subscribers truncates.

Bug has been latent since the relay was written. Surfaced now because
agent-to-agent code review generates >8 KiB payloads routinely.

## Scope — what this is NOT

- **Not `splitJsonFrames`.** splitJsonFrames correctly reassembles
  well-formed chunks; the round-2 tests cover that thoroughly. This
  bug is content-level truncation upstream of the scanner.
- **Not the 1 MiB buffer overflow cap.** 8KB is two orders of
  magnitude below that.
- **Not UTF-8 boundary decoding.** The truncation offset matches
  syscall boundaries (8192), not multibyte boundaries.
- **Not a relay-down scenario.** The relay is up and responding to
  direct `nc -U /tmp/agent-channels.sock` probes with small payloads.

## Fix (ksu8's sketch)

Mimic Node's auto-buffering by queuing pending writes per-socket and
flushing on `drain`:

```ts
// shared/relay/server.ts, inside Bun.listen open(socket):
socket.data = { buffer: "", pending: [] as string[] };

const sub: Subscriber = {
  id: ++relay.nextSubId,
  write(data: string) {
    socket.data.pending.push(data);
    flushPending(socket);
  },
};

// helper — walk the queue, write until partial, stop
function flushPending(sock: typeof socket) {
  while (sock.data.pending.length > 0) {
    const head = sock.data.pending[0];
    const buf = Buffer.from(head, "utf-8");
    const n = sock.write(buf);  // Bun returns bytes written
    if (n === buf.length) {
      sock.data.pending.shift();
    } else if (n > 0) {
      // Partial write: replace head with the unwritten tail, stop.
      sock.data.pending[0] = buf.slice(n).toString("utf-8");
      return;
    } else {
      return;  // fully backpressured
    }
  }
}

// and in the socket handlers add:
drain(socket) { flushPending(socket); },
```

**Critical detail:** `Buffer.from(str, "utf-8")` + `buf.slice(n)` is
byte-slicing. Using JS `String.slice(n)` would slice by UTF-16 code
units and re-introduce UTF-8 boundary corruption on the partial-write
path — a subtle secondary bug.

**Also check SSE path** (~line 253 of `server.ts`): if
`ReadableStream.controller.enqueue` has similar "partial enqueue"
semantics in Bun, SSE subscribers hit the same class of bug.
Probably safer since HTTP frames are the one-SSE-`data`-chunk unit,
but worth verifying the bytes-per-enqueue behavior.

## Acceptance Criteria

- [ ] Partial-write queue + `drain` handler implemented on the UDS
      subscriber write path in `shared/relay/server.ts`.
- [ ] Byte-level slicing via `Buffer.from` / `Buffer.slice`, not
      string `.slice()`.
- [ ] SSE path audited for the same class of bug; fix applied if
      present.
- [ ] E2E regression test: start real `RelayServer`, open 2 UDS
      subscribers, publish 16 KiB message from one, assert the other
      receives exact-byte-equal JSON (parse succeeds, fields
      round-trip).
- [ ] Existing `splitJsonFrames` round-2 tests still pass
      unchanged (scoping check).
- [ ] Blocks todo 0018 — land this FIRST, because 0018's
      `disconnected`/`reconnecting` diagnostics can't paper over
      silent payload truncation.

## Repro

```
1. Start relay (`shared/relay/main.ts`).
2. Open 2 UDS subscribers to the same channel.
3. Publish a 16 KiB payload from one subscriber.
4. Today: other subscriber's UdsTransport fires onParseError at
   position ~8127. Message body is lost.
5. After fix: other subscriber receives the full 16 KiB payload,
   JSON.parse succeeds, fields match.
```

## Test gap that let this land

The existing `uds.test.ts` fake-relay scaffold tests `splitJsonFrames`
on contrived byte sequences. There is NO E2E test exercising the real
`RelayServer` + 2 clients + a large payload. ksu8 flagged the same
gap as a "nice-to-have" in round-2 review; today it graduated to
"load-bearing". The fix commit should add the missing E2E coverage.

## Affected Files

- `shared/relay/server.ts` — UDS subscriber write path + drain handler.
- `shared/relay/server.ts` — SSE enqueue path (audit).
- `pi/extensions/agent-channel/uds.test.ts` — E2E regression test
  against the real relay.
- `pi/extensions/agent-channel/uds-transport.ts` — no changes
  expected; client-side splitJsonFrames is already correct.

## E2E Spec

GIVEN two sessions connected to the same UDS relay
WHEN one publishes a `review-response` with body > 8 KiB containing
     multi-byte UTF-8 chars (em dashes, backticks, curly quotes)
THEN the receiver's `onIncoming` fires with the full body intact
     AND `onParseError` does NOT fire for that message
     AND the byte-sequence of the received JSON equals the sent JSON

## Notes

- **Blocks `todos/0018`** (surface hard transport errors) — that todo's
  runtime diagnostics assume the underlying transport is byte-honest.
  Landing 0018 first would paper over this bug, not fix it.
- Workaround available in-session today: split long messages into
  <8KB chunks (the "compact re-send" pattern ksu8 used to get the
  review-response through).
- Identified + diagnosed by ksu8 during the round-9 review session
  following commit `32038e3`. Two-part diagnosis messages on channel
  `EEB2F4AD-0AA2-4477-8CE8-B5955B726D6E`.
- Surfaced cleanly by the existing `onParseError` hook
  (commits `006b80f`, `cada2e4`). That side is working as designed —
  the diagnosis shows the pipeline correctly caught something that
  was silently wrong upstream.
