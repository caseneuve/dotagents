---
title: Complete user-authorized reversible archive of the legacy Pi source tree
status: done
priority: medium
type: chore
labels: [pi, packaging, cleanup]
created: 2026-07-10
parent: null
blocked-by: [0046]
blocks: []
---

## Current preservation policy (2026-11-15, Pi-only scope)

The deletion checklist below is historical and superseded. #0069 implements the
new explicitly approved root `skills/` + `prompts/` native-only layout and archives
obsolete Claude/Agents/bootstrap/unused shared resources. All five canonical
skills/helpers and five prompts stay active, not migrated duplicates. Workbench
skill duplicates were already removed during the earlier reviewed ownership handoff.

#0069.1 completed historical preparation and independent review of 49 exact
source/theme/test archives; its original not-landable narrative remains intact.
Subsequently the user explicitly approved archiving entire dotagents/pi and
removing it after being told nothing active remains. Per lead t16 that reply
waives the old seven-calendar-day AND five-normal-session/two-project-per-active-OS
gate ONLY for this reversible retirement scope. #0069.2 builds on exact reviewed
c46016a: unchanged49 payloads plus exact CURRENT live master2dc662c pi/README.md
bytes/mode as historical pointer, all50 recovery rows including seven old tests,
and no remaining pi root or compatibility directory. Index `waived:true` /
`completed:false`: no ordinary-use soak completion is claimed. Original cutover
2026-11-15T16:20:48Z/earliest2026-11-22T16:20:48Z remain historical gate metadata.
Three approved #0047.1 helper archives and earlier historical payloads are unchanged.

This item is DONE for complete user-authorized reversible SOURCE retirement on
this revision, including Tree-sitter archive under its explicit no-maintained-
replacement disposition. The historical checklist below is superseded/waived for
this source scope, NOT satisfied by invented ordinary-use evidence. No further
retirement gate or user decision remains. #0069.2 records implementation, isolated
proof, independent review and handoff. Lead alone integrates and verifies actual
host adoption; DONE does not claim ordinary-use soak, product/API delivery,
publication or live host verification. Experiments and unfinished skill/product
work remain preserved without false completion claims. Verification uses native Pi packages and
real helpers; bootstrap is retired. Current recovery policy is archive/README.md.

## Historical proposal (superseded; do not execute)

## Context

After package cutover, dotagents retains migrated extension entries plus `pi/themes` and `pi/prompts`
as rollback sources. This is the only todo permitted to remove those migrated copies. Tree-sitter
is excluded from extraction and must remain under `pi/extensions/treesitter` unless a separate todo
gives it an explicit disposition. Removal happens only after explicit soak evidence shows the
package-based configuration is stable.

## Historical acceptance checklist (superseded/waived, not evidence of completion)

These unchecked historical criteria are retained verbatim as context, not an
active gate or unfinished source-retirement requirement. The explicit user waiver
above authorizes reversible archival of the entire tree, including Tree-sitter;
it does not assert ordinary-use observations or implementation of experiments.

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
