---
title: agent-channel UDS kB-scale frame corruption
status: closed
priority: high
type: bug
labels: []
created: 2026-04-25
parent: null
blocked-by: []
blocks: ["0018"]
---

## Resolution

Fixed in commit **`5c2ed33`** (`[relay] switch UDS listener from Bun.listen to node:net`).

Chose option 2 (swap to `node:net`) over option 1 (userland
pending-queue + drain in Bun) after design discussion with ksu8. Node's
`net.Socket.write` auto-buffers overflow in userland and always
eventually delivers; the client side has used `node:net.createConnection`
all along with zero compat issues, so the server-side mirror was the
same shim layer. ~0 net lines changed, no UTF-8 byte-slicing gotcha,
battle-tested behavior.

Regression coverage added in `pi/extensions/agent-channel/uds.test.ts`:
- 16 KiB body with multi-byte UTF-8 (em dash, curly quotes, arrows,
  stars, backticks) — byte-exact round-trip across two real
  UdsTransport clients and a real RelayServer.
- 64 KiB stress with UTF-8-pressure-heavy filler.

Both tests verified to fail against the pre-fix Bun.listen relay and
pass against the node:net relay.

### SSE / HTTP path — audited clean

ksu8 architectural audit (no repro needed): the SSE path uses
`ReadableStream.controller.enqueue(Uint8Array)`. Streams-spec semantics
treat each enqueue as an atomic chunk at the stream level — no
partial-enqueue concept, no return-value-is-byte-count. Backpressure
is managed via `controller.desiredSize`, not via silent truncation.
TCP-level fragmentation of a large enqueue on the wire is handled by
the client-side SSE buffer added in round-2 (`http-transport.ts`).
Strictly different primitive from the broken `Bun.Socket.write`;
not affected by this bug class.

## Context (historical, kept for future archaeology)

Reproduced in a live session. `ksu8` (another agent on the same
UDS relay) sent a `review-response` with body ~8KB. My UDS transport
fired an `onParseError` diagnostic:

> ⚠️ agent-channel (uds transport) dropped a malformed frame:
> Expected ',' or '}' after property value in JSON at position 8127
> (line 1 column 8128). Preview: {"type":"message","channel":"...",
> "msg":{"id":"...","body":"Reviewed `32038e3`. ...

The `onParseError` pipeline worked correctly (006b80f) — but the
message content itself was lost. `ksu8` had to re-send a compact
version to unstick the review loop.

### Root cause (ksu8 diagnosis)

`shared/relay/server.ts:126` (pre-fix) — the relay's UDS subscriber
wrapper did unchecked `socket.write(data)` where `socket` was a
`Bun.listen` socket, NOT a Node `net.Socket`. Semantics differ:

- **Node** `net.Socket.write(buf)`: auto-buffers overflow in
  userland, returns `false` on backpressure, emits `drain`. Caller
  can ignore return value; bytes still arrive.
- **Bun** `Socket.write(str)`: returns the **number of bytes
  actually written**. Anything beyond that is silently dropped.
  No userland queue, no retry.

For frames near or past the kernel UDS send buffer (macOS default
`net.local.stream.sendspace` = 8192), `write()` did a partial write,
returned a smaller count, and trailing bytes were dropped.
Receiver's `splitJsonFrames` saw a truncated frame — if the
truncation landed after a `}` by luck, the scanner extracted it
as balanced, and `JSON.parse` threw at the chop point with
"Expected ',' or '}' after property value at position N" where
N ≈ 8127. Position matched syscall boundaries exactly, not multibyte
boundaries — ruling out a UTF-8 decoding hypothesis.

Direction: relay → subscriber only. Client → relay was safe because
`UdsTransport` uses Node's `net.createConnection` which auto-buffers.

Latent since the relay was written; surfaced only when
agent-to-agent code review started generating >8 KiB payloads
routinely.

## Notes / follow-ups not in scope of the fix

- **Receive-side ndjson parser (ksu8 bonus finding).** The relay's
  `socket.on('data')` handler uses `buffer.split("\n")` for request
  framing. Same latent fragility class as the round-2 client-side
  bug: a buggy future client that glues frames without a newline
  would get mis-split. Not exercised today because every Node client
  emits `JSON.stringify(req) + "\n"`. File separately if the failure
  mode ever surfaces — not worth speculative refactoring.
- **Bonus architectural benefit.** Stack consistency: both sides
  (UDS client and UDS server) now use `node:net` end-to-end,
  eliminating the one-primitive-per-side mental model.
