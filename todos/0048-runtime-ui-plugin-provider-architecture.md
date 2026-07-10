---
title: redesign runtime UI around a plugin/provider architecture
status: open
priority: medium
type: refactor
labels: [pi, ux, follow-up]
created: 2026-07-10
parent: null
blocked-by: [0027.9]
blocks: []
---

## Context

Extraction intentionally preserves the current runtime-footer, editor-status, branch-status, and
cross-extension event/status behavior. A later design may make blocks/providers explicitly
pluggable and define a package-neutral contract for conversation and agent-channel status.

Existing todos `0028` and `0035`–`0039` cover footer configuration features, while `0034` covers the
current single editor-component owner. None defines a general third-party provider architecture, so
this remains a distinct follow-up.

## Acceptance Criteria

- [ ] Inventory current runtime UI ownership and existing event/status contracts after extraction.
- [ ] Decide whether a new provider API is justified versus preserving Pi's existing status/event mechanisms.
- [ ] If justified, define versioning, producer/consumer ownership, missing-provider behavior, and compatibility migration.
- [ ] Add tests for provider registration, collisions, absence, reload, and independent package installation.
- [ ] Preserve a documented rollback path to the extracted behavior.

## Notes

Do not pull this redesign into todo `0027.4`.
