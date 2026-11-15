---
title: retire migrated Pi sources from dotagents after package soak
status: open
priority: medium
type: chore
labels: [pi, packaging, cleanup]
created: 2026-07-10
parent: null
blocked-by: [0046]
blocks: []
---

## Current preservation policy (2026-11-15)

The deletion checklist below is historical and superseded. #0046.1 preserves ALL
legacy extension/theme/experiment/skill directories and old worktrees, excluding
them through the native manifest only. Canonical independent `pi/prompts` must
not be treated as migrated duplicates. Workbench duplicate skills remain untouched
until the native handoff passes and lead coordinates a separate follow-up.

No source retirement is authorized by this tranche. After explicit live-setup
approval and recorded adoption, retain the minimum seven-day/five-session/two-project
soak per actively used OS, inventory preserved history/unfinished work, and obtain
separate archive/removal approval with exact source/canonical refs.
Archive candidates include agent-channel/comms, Playwright, Tree-sitter and
subagent experiments; do not modernize them or assume an obsolete source path
must remain active. Verification uses native Pi installation, not bootstrap.

## Historical proposal (superseded; do not execute)

## Context

After package cutover, dotagents retains migrated extension entries plus `pi/themes` and `pi/prompts`
as rollback sources. This is the only todo permitted to remove those migrated copies. Tree-sitter
is excluded from extraction and must remain under `pi/extensions/treesitter` unless a separate todo
gives it an explicit disposition. Removal happens only after explicit soak evidence shows the
package-based configuration is stable.

## Acceptance Criteria

- [ ] At least seven calendar days have elapsed since the recorded `0046` cutover.
- [ ] Soak evidence records at least five normal Pi sessions across at least two projects on each routinely used OS (Linux and macOS when both are in active use).
- [ ] Evidence includes startup, `/reload`, representative global package use, and at least one project-local/selective package use with no move-induced regression or rollback.
- [ ] Confirm every file selected for removal has a canonical package-repository counterpart at a recorded reviewed ref.
- [ ] Remove only migrated extension files/directories plus migrated `pi/themes` and `pi/prompts` copies from dotagents.
- [ ] Retain `pi/extensions/treesitter` and its design/history because it has no extracted package counterpart; ensure it remains excluded from active package manifests/settings.
- [ ] Update tests and docs so no obsolete migrated path-based implementation remains canonical or accidentally loadable.
- [ ] Update rollback guidance from “restore dormant local paths” to “restore recorded package refs or the pre-retirement dotagents revision.”
- [ ] Verify bootstrap and a clean Pi startup after removal.

## Affected Files

- Migrated entries under `pi/extensions/`, plus `pi/themes/*` and `pi/prompts/*` — dormant copies removed.
- `pi/extensions/treesitter/*` — explicitly retained unless separately dispositioned.
- `README.md`, `pi/README.md`, bootstrap tests/docs — retirement and rollback updates.

## Notes

This is downstream adoption cleanup, not part of extraction epic `0027`.
