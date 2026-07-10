---
title: dotagents pi local install strategy audit
status: open
priority: medium
type: chore
labels: [pi, packaging]
created: 2026-05-12
parent: null
blocked-by: []
blocks: [0046]
---

## Context

Dotagents currently loads Pi extensions through `settings.json` `extensions` path entries.
We want a more robust package-based install strategy (`pi install` with local path/npm/git),
including clear guidance on global vs project-local scope and bootstrap behavior.

This item is intentionally standalone and not part of extraction epic `0027`.

## Acceptance Criteria

- [ ] Document current state (`extensions` path entries, bootstrap wiring, pros/cons).
- [ ] Evaluate package-based alternatives (`pi install /path`, npm, git, global vs `-l`).
- [ ] Recommend local-path packages for dotagents development/personal machines and pinned Git packages for reproducible project/team use; leave npm publication as follow-up work.
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
- Agreed initial distribution order: local paths first, pinned Git second, npm later.
- Agreed global defaults: agent-channel, runtime UI, conversation tools, and dotagents resources.
- Playwright is project-local by default; workbench and provider extras are selective.
- This item defines policy; todo `0046` performs the destructive bootstrap/settings cutover.
