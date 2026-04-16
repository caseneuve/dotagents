---
title: "Network transport layer: UDS + HTTP/SSE relay"
status: open
priority: high
type: feature
labels: [architecture, networking]
created: 2026-04-16
parent: null
blocked-by: []
blocks: []
---

## Context

Agent communication is currently file-based only (`~/.agent-channels/*.json`),
which limits it to same-machine with 3s polling latency and read-mutate-write
race conditions. The goal is cross-machine communication (Mac + Linux + Raspberry
Pi on the same LAN) with push-based delivery.

Three transport layers:
- **UDS** — local same-machine comms, push-based, replaces file polling
- **HTTP/SSE** — cross-machine comms via relay server, push-based
- **File** — zero-config fallback, kept as-is

This requires splitting the current `ChannelBackend` interface into
`MessageTransport` (messaging) and `StatusDisplay` (sidebar/notifications),
since network messaging is remote but status display is always local.

## Acceptance Criteria
- [ ] `MessageTransport` and `StatusDisplay` interfaces split from `ChannelBackend`
- [ ] Relay server: UDS + HTTP/SSE, keyed pub/sub by channel name
- [ ] `UdsTransport` client: push delivery via local socket
- [ ] `HttpTransport` client: publish via REST, subscribe via SSE
- [ ] `FileTransport` preserved as zero-config fallback (with poller)
- [ ] `MultiTransport` for fan-out to multiple transports
- [ ] Cross-machine lobby resolution (relay-scoped + AGENT_LOBBY override)
- [ ] All existing functionality preserved

## Sub-tasks
- 0015.1: Split ChannelBackend into MessageTransport + StatusDisplay
- 0015.2: Relay server (UDS + HTTP/SSE)
- 0015.3: UdsTransport + HttpTransport clients
- 0015.4: MultiTransport + transport selection logic
- 0015.5: Cross-machine lobby resolution

## Architecture

```
MessageTransport (interface)
  ├── UdsTransport      — connect to local socket, push delivery
  ├── HttpTransport     — connect to relay + SSE, push delivery
  ├── FileTransport     — poll-based, zero deps, always works
  └── MultiTransport    — fan out to multiple transports

StatusDisplay (interface)
  ├── CmuxDisplay       — cmux CLI sidebar integration
  ├── TmuxDisplay       — tmux pane options + display-message
  └── NoopDisplay       — silent fallback

Relay server (single binary)
  ├── UDS: /tmp/agent-channels.sock  (local agents)
  └── HTTP: 0.0.0.0:7700            (remote agents + SSE streams)
```

Transport selection:
```
UDS socket available?  → UdsTransport (+ HttpTransport if relay configured)
Relay URL configured?  → HttpTransport
Neither?               → FileTransport (today's behavior)
```

## Protocol

Channels are string identifiers (same as today). Server is a dumb keyed pub/sub
broker — channels created implicitly on first publish/subscribe.

HTTP:
```
POST   /channels/:channel/messages       → publish
PATCH  /channels/:channel/messages/:id   → ack
GET    /channels/:channel/stream         → subscribe (SSE)
GET    /channels                         → list
```

UDS: NDJSON (newline-delimited JSON) — one `{action, channel, msg?}` object per `\n`.
Simple, debuggable with `socat`, no custom framing parser needed.

Cross-machine scoping:
- Same machine: lobby derived from env (same as today)
- Cross-machine: `relay/${hash_of_server_url}` (8 hex chars) or `AGENT_LOBBY` env override

## Security

The relay has no authentication. Only run it on trusted networks.
`--bind` flag allows restricting to specific interfaces.

## Known limitations (v1)

- In-memory store: relay restart loses undelivered messages. Lightweight WAL is a v1.1 follow-up.
- Cross-transport message ordering is best-effort (clock skew between machines).
- No auth — trusted LAN only.

## Notes
- Relay server in Bun/TypeScript (same stack as extensions)
- Relay lives in `shared/relay/` (serves all runtimes, not just pi)
- Poller becomes a FileTransport implementation detail, not top-level
- Race condition on file writes documented (0010.5) — UDS/HTTP eliminate it
- File pruning concern (0010.5) — server-managed transports don't accumulate files
- Review feedback incorporated from 3h2h
