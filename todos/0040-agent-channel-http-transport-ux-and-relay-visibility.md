---
title: agent channel http transport ux and relay visibility
status: done
priority: medium
type: bug
labels: []
created: 2026-05-19
parent: null
blocked-by: []
blocks: []
---

## Context

Agent-channel comms-on orientation lacked explicit transport endpoint details,
`/transport http` UX was verbose (required full URL with scheme), and HTTP SSE
connections could drop with socket hangups due to idle timeout behavior.

## Acceptance Criteria

- [x] Comms-on transport notice includes active transport plus endpoint details (HTTP base URL / UDS socket path).
- [x] `/transport` with no args shows transport plus endpoint details when available.
- [x] `/transport http` accepts shorthand forms (`host:port`, `:port`, `port`) while keeping legacy `/transport http <full-url>` behavior.
- [x] HTTP transport normalizes `0.0.0.0` to loopback for client connections.
- [x] Relay SSE streams stay alive without periodic socket hangups under idle conditions.

## Affected Files

- `pi/extensions/agent-channel/index.ts` — comms-on notices and `/transport` UX.
- `pi/extensions/agent-channel/http-transport.ts` — HTTP URL normalization and exposed base URL.
- `pi/extensions/agent-channel/uds-transport.ts` — exposed socket path for display.
- `shared/relay/server.ts` — SSE keepalive behavior.
- `pi/extensions/agent-channel/README.md` — updated command/transport docs.

## E2E Spec

GIVEN two agents connected to the same relay with comms ON
WHEN one switches transport between UDS and HTTP and the other stays on the opposite transport
THEN messages continue to flow cross-transport, transport notices include endpoint details, and SSE does not idle-disconnect.

## Notes

Keep command semantics explicit: do not infer transport mode from bare URL input.
