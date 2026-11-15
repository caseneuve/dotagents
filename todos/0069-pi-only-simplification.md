---
title: Final Pi-only layout and obsolete runtime retirement
status: in_progress
priority: high
type: refactor
labels: []
created: 2026-11-15
parent: null
blocked-by: []
blocks: []
---

## Context

The user explicitly selected Pi only: root skills/prompts, native packages,
no bootstrap, PATH shims or parallel Agents installation. This supersedes old
Claude/Agents parity guidance. No live installation/configuration changes here.

## Acceptance Criteria

- [ ] Five canonical skills, their real helpers/tests and five canonical prompts
      at root, explicit 5+5 manifest and no extensions/themes.
- [ ] Ownership/reference inventory before tracked-only byte/mode-preserving
      archive of obsolete Claude/Agents, unused shared resources and bootstrap.
- [ ] Active docs/tasks/tests use only canonical paths; actual helpers and native
      resource loader tested with private HOME/non-Git cwd outside /home.
- [ ] Historical bytes/recovery mapping and unfinished product/skill work preserved;
      no unrelated todo falsely completed, dirty/ignored/user work untouched.
- [ ] Independent exact-ref review and bounded proof/handoff; no merge/push/tag.

## Separate gated preparation

Remaining legacy pi/extensions and pi/themes retirement belongs on a distinct
reviewed branch/commit. NOT landable until seven calendar days AND five normal
sessions across two projects per active OS plus explicit exact-scope approval.
The cutover began 2026-11-15T16:20:48Z; no gate completion is claimed. Three
already archived helpers remain unchanged. This task does not close #0047.

## Validation and handoff

Record RED/GREEN, actual checks, inherited missing pinned clj-kondo limitation,
archive proof and exact refs in ~/.cache/pi-migration/evidence/pi-only-final/.
Lead t16 owns live handoff, including external workbench references. typesafe-ai,
settings/auth/HOME/PATH/installations and user terminals are outside scope.
