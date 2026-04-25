---
title: agent-channel UDS kB-scale frame corruption
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

Reproduced in a live session today. `ksu8` (another agent on the same
UDS relay) sent me a `review-response` with body ~8KB. My UDS transport
fired an `onParseError` diagnostic:

> ⚠️ agent-channel (uds transport) dropped a malformed frame:
> Expected ',' or '}' after property value in JSON at position 8127
> (line 1 column 8128). Preview: {"type":"message","channel":"...",
> "msg":{"id":"...","body":"Reviewed `32038e3`. ..."

The `onParseError` pipeline worked correctly (that's what 006b80f was
built for) — but the message content itself was lost. `ksu8` had to
re-send a compact version to unstick the review loop.

## Scope — what this is NOT

- **Not `splitJsonFrames`.** splitJsonFrames correctly reassembles
  well-formed chunks; the round-2 tests cover that thoroughly. This
  bug is content-level JSON corruption showing up INSIDE a frame that
  the scanner extracts as brace-balanced.
- **Not the 1 MiB buffer overflow cap.** 8KB is two orders of
  magnitude below that.
- **Not a relay-down scenario.** The relay is up and responding to
  direct `nc -U /tmp/agent-channels.sock` probes with small payloads.

## Hypothesis

Position 8127 / column 8128 is suspiciously close to 8 KiB (8192).
Candidate causes:

1. **UTF-8 decoding across socket chunk boundaries.** Node's
   `sock.setEncoding("utf-8")` is supposed to handle this, but a
   multi-byte character straddling an 8192-byte chunk boundary could
   be dropped or duplicated in some edge case. ksu8's review contained
   em dashes, backticks, and smart punctuation — all multi-byte.
2. **Relay-side content truncation or re-framing.** The relay may be
   encoding frames with a buffer that truncates at 8192 when the body
   exceeds it, either due to a `write()` ceiling or a string buffer
   concatenation limit.
3. **Node `net.Socket` write side.** The relay's `sock.write(JSON.stringify(frame) + "\n")`
   might be getting backpressured at 8192 and our client sees a partial
   write without recovery.

## Acceptance Criteria

- [ ] Reproducer committed: script that sends an 8KB+ body via
      the UDS transport and asserts the receiver's `onIncoming`
      receives it intact (or `onParseError` fires consistently —
      either way the behavior is deterministic).
- [ ] Root cause identified via logs or systematic narrowing
      (byte-pair diff between what the relay `write()`s and what the
      client accumulates in `transport.buffer`).
- [ ] Fix applied at the correct layer (client buffering,
      relay encoding, or Node setEncoding alternative).
- [ ] Regression test in `uds.test.ts` using the existing fake-relay
      scaffold from 006b80f round-2 — send an 8KB+ frame with
      multi-byte UTF-8, assert round-trip intact.

## Affected Files

- `pi/extensions/agent-channel/uds-transport.ts` — likely client-side
  receive path (buffer, setEncoding).
- `shared/relay/server.ts` — relay send path.
- `pi/extensions/agent-channel/uds.test.ts` — regression coverage.

## E2E Spec

GIVEN two sessions connected to the same UDS relay
WHEN one publishes a `review-response` with body > 8 KiB containing
     multi-byte UTF-8 chars (em dashes, backticks, curly quotes)
THEN the receiver's `onIncoming` fires with the full body intact
     AND `onParseError` does NOT fire for that message

## Notes

- Blocks reliable long-form agent-to-agent review. All the recent
  protocol work (rounds 1-8 of agent-channel) depends on >=KB-scale
  review messages; this is a practical deliverability issue for the
  collaboration pattern we've been building.
- Workaround available in-session: split long messages into
  <8KB chunks (ksu8's compact re-send pattern).
- Identified by ksu8 during the round-9 review session (follow-up to
  commit `32038e3`). Deferred out of that commit per scope discipline.
- Surfaced cleanly by the existing `onParseError` hook
  (commits `006b80f`, `cada2e4`). That side is working as designed.
