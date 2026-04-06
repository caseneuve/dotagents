---
title: experiment with agent communication runtime via sqlite
status: open
priority: medium
type: feature
created: 2026-04-06
parent: null
blocked-by: []
blocks: [0007.1, 0007.2, 0007.3, 0007.4]
---

## Context

We want to test an agent-to-agent communication approach before investing more
in full subagent orchestration. The target workflow is a single-host setup
where agents can be spawned manually or by helper commands, exchange structured
messages through a shared channel, and remain easy to inspect by a human.

SQLite should be the first backend because it is local, durable enough, simple
to debug, and does not require running extra infrastructure.

## Acceptance Criteria

- [ ] There is one documented alpha architecture for agent communication in this
      repo: extension-hosted communication tools backed by a local SQLite
      message store.
- [ ] Agents can exchange structured messages through a shared channel without
      requiring the human to manually relay every step.
- [ ] The communication runtime works with manually started agents and supports
      an optional tmux-based spawn path for convenience.
- [ ] There is a practical path for reviewer/worker automation where review
      artifacts are exchanged through channel messages and file references.
- [ ] Parent conversation context remains compact by default; detailed message
      logs are inspected on demand.

## Affected Files

- `pi/extensions/` — communication extension and optional tmux spawn helpers
- `pi/README.md` — alpha communication architecture and usage
- `test/unit/` — protocol and storage helpers
- `test/e2e/` — end-to-end communication and loop behavior

## E2E Spec

GIVEN two Pi agents connected to the same communication channel
WHEN one agent sends structured task or result messages
THEN the other agent can poll and respond without manual human relay

GIVEN a reviewer/worker flow over the communication channel
WHEN the loop runs for one or more rounds
THEN the system reports progress and completion based on exchanged messages and
review file artifacts

## Notes

This epic is an experiment-first path. Keep the first version small and
inspectable, then decide whether to fold it into the broader subagent
framework.
