---
title: dotagents pi local install strategy audit
status: open
priority: medium
type: chore
labels: [pi, packaging]
created: 2026-05-12
parent: null
blocked-by: []
blocks: []
---

## Context

Dotagents currently loads Pi extensions through `settings.json` `extensions` path entries.
We want a more robust package-based install strategy (`pi install` with local path/npm/git),
including clear guidance on global vs project-local scope and bootstrap behavior.

This item is intentionally standalone and not part of extraction epic `0027`.

## Acceptance Criteria

- [ ] Document current state (`extensions` path entries, bootstrap wiring, pros/cons).
- [ ] Evaluate package-based alternatives (`pi install /path`, npm, git, global vs `-l`).
- [ ] Recommend one canonical strategy for dotagents local/dev usage and one for team/shared repos.
- [ ] Capture migration steps and rollback plan.

## Affected Files

- `pi/README.md` — installation guidance updates if strategy changes.
- `scripts/bootstrap.clj` — bootstrap behavior updates if needed.
- `README.md` / docs under `docs/` — canonical install workflow documentation.

## Notes

- Keep this work decoupled from the extraction epic.
- Prefer package semantics over ad-hoc path wiring when practical.
