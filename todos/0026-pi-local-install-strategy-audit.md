---
title: dotagents pi local install strategy audit
status: done
priority: medium
type: chore
labels: [pi, packaging]
created: 2026-05-12
parent: null
blocked-by: []
blocks: [0046]
---


## Delivered audit scope (2026-11-15)

The install-strategy audit is complete for the approved retained/local program:
native `pi install [-l] <path>`, explicit package allowlists and filters, project
trust, local-checkout dependency ownership, independent dotagents skills/prompts,
separate theme ownership, rollback/preservation and deferred adoption gates.
There is no Pi bootstrap or replacement settings reconciler. The old agent-channel/
Playwright defaults and custom-bootstrap policy below are superseded, not delivered.

Evidence: `pi/README.md`; approved native implementation34374cc and final1f127bd,
exact-tree integration3751a53, archive-only integration7610d05; migration
`~/.cache/pi-migration/evidence/dotagents-native/{handoff,review}.md`,
`evidence/composition/final-review.md` and `baseline-review.md` at the migration
cache root. Local source integration is complete; this audit does NOT establish
global settings cutover, soak, publication, remote Git availability, all-OS
verification or real authenticated provider behavior. #0046/#0047/#0051 stay open.

- [x] Audit the old broad loaders/default-all Pi writes and native scope/trust/filter alternatives.
- [x] Record retained ownership, portable helpers, archive exclusions and local native setup.
- [x] Preserve independent resources and record rollback/adoption/soak/release boundaries.

## Historical policy and criteria (superseded where conflicting)

Original unchecked criteria below remain historical; they are not newly asserted
as complete, particularly public immutable-ref distribution and obsolete defaults.

## Current tranche policy (2026-11-15)

#0046.1 implements native independent resources in an isolated worktree only.
No Pi bootstrap or custom settings reconciler; use native `pi install [-l]`.
Independent prompts stay dotagents-owned; themes live in pi-dotagents-resources.
Archive decisions supersede the historical agent-channel/Playwright defaults below.
Live-user adoption, publication and source retirement remain separately gated.
The historical criteria below are not authority to perform those actions.

## Context

Dotagents currently loads Pi extensions through `settings.json` `extensions` path entries.
We want a more robust package-based install strategy (`pi install` with local path/npm/git),
including clear guidance on global vs project-local scope and bootstrap behavior.

This item is intentionally standalone and not part of extraction epic `0027`.

## Acceptance Criteria

- [ ] Document current state (`extensions` path entries, bootstrap wiring, pros/cons).
- [ ] Evaluate package-based alternatives (`pi install /path`, npm, git, global vs `-l`).
- [ ] Recommend local-path packages for dotagents development/personal machines and immutable Pi-supported Git refs from public `github.com/caseneuve/pi-*` repositories for reproducible project/team use; leave npm publication to follow-up `0051`.
- [ ] Define which packages are global defaults versus selective or project-local capabilities.
- [ ] Document committed project `.pi/settings.json` behavior, project trust, automatic missing-package installation, and why committed settings should use portable Git sources rather than personal absolute paths.
- [ ] Define dotagents' long-term ownership: shared skills, agent orchestration, bootstrap, and package-selection policy rather than duplicate Pi extension implementations.
- [ ] Define the experimental lifecycle and manifest-exclusion convention for scaffold-stage work such as Tree-sitter.
- [ ] Capture migration steps and rollback plan for cutover todo `0046`.

## Affected Files

- `pi/README.md` — installation guidance updates if strategy changes.
- `scripts/bootstrap.clj` — bootstrap behavior updates if needed.
- `README.md` / docs under `docs/` — canonical install workflow documentation.

## Notes

- Keep this work decoupled from the extraction epic.
- Prefer package semantics over ad-hoc path wiring when practical.
- Agreed initial distribution order: local paths first, immutable Git refs second, npm later (`0051`).
- Repositories are public and owned by `caseneuve`; `@earendil-works/*` identifies the supported Pi API dependencies, not repository/package ownership.
- Agreed global defaults: agent-channel, runtime UI, conversation tools, and dotagents resources.
- Playwright is project-local by default; workbench and usage are selective.
- This item defines policy; todo `0046` performs the destructive bootstrap/settings cutover.
