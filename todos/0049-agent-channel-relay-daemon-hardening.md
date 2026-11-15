---
title: harden agent-channel relay daemon operations
status: closed
priority: medium
type: feature
labels: [pi, relay, follow-up]
created: 2026-07-10
parent: null
blocked-by: [0027.1]
blocks: []
---


## Closed: approved archive/superseded scope (2026-11-15)

This planned work on the retired agent-channel/comms system is intentionally not completed or
newly validated by the migration. Approved archive disposition cancels this
remaining implementation/validation plan; closure is NOT a claim that its
features shipped, defects were fixed, or acceptance criteria passed.

Sources, referenced history and scoped unfinished artifacts are preserved.
Evidence: `~/.cache/pi-migration/status.md`,
`evidence/archive-lead-verification.md` and
`archives/retired-experiments-20261115T130304Z/REPORT.md` under the same migration
root. Archive-copy verification is not physical retirement, completed soak or
permission to remove old worktrees. Broader adoption/removal remains #0046/#0047.

## Historical uncompleted plan and criteria (retained unchecked)

## Context

The extraction preserves the current relay and `bb relay:*` behavior. A later task can turn that
behavior into a more robust standalone daemon UX covering executable layout, config, logs, PID
state, stale processes, upgrades, and OS-specific lifecycle semantics.

Existing relay todos `0015.*`, `0018`, `0020`, `0021`, and `0023` cover transport/protocol behavior
and diagnostics, not the full daemon operations lifecycle described here.

## Acceptance Criteria

- [ ] Define package-owned CLI/bin, config, socket, log, PID/state, and health locations.
- [ ] Define and test start/stop/status/health/logs/restart behavior, including stale PID, dead process, occupied socket, and concurrent invocation cases.
- [ ] Define upgrade/reinstall behavior without orphaning old relay processes or incompatible state.
- [ ] Decide and document Linux/macOS daemon semantics, including whether systemd/launchd integration is provided or explicitly not provided.
- [ ] Preserve file-transport fallback and compatibility with current clients.

## E2E Spec

GIVEN a stopped, running, stale, or partially broken relay on Linux or macOS
WHEN the package-owned daemon CLI performs lifecycle and health operations
THEN it reports accurate state, recovers only when safe, and does not orphan processes or sockets.

## Notes

This is improvement work, not required for move-only extraction `0027.1`.
