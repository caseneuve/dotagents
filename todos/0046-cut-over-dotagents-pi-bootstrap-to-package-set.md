---
title: cut over dotagents Pi bootstrap to extracted package set
status: open
priority: high
type: chore
labels: [pi, packaging, bootstrap]
created: 2026-07-10
parent: null
blocked-by: [0026, 0027.9]
blocks: []
---

## Context

After the install strategy and extracted packages are validated, dotagents must atomically replace
its broad `pi/extensions`, `pi/themes`, and `pi/prompts` settings paths with an explicit package set.
Dotagents remains the personal agent orchestration, shared-skills, settings-policy, and bootstrap
repository; canonical Pi extension implementations live in their package repositories.

Intended global defaults are `pi-agent-channel`, `pi-runtime-ui`, `pi-conversation-tools`, and
`pi-dotagents-resources`. Playwright is project-local by default. Workbench and provider extras are
selective personal/project capabilities.

## Acceptance Criteria

- [ ] Bootstrap installs/records the approved local global package sources idempotently while preserving unrelated user settings and packages.
- [ ] The obsolete dotagents extension/theme/prompt paths are removed in the same cutover, without a duplicate-loading interval.
- [ ] Existing unrelated packages such as `pi-emacs-bridge` remain configured.
- [ ] The selected theme and all intended global commands, tools, skills, prompts, and UI components load without collisions.
- [ ] Documentation explains global defaults, selective packages, and project-local package settings.
- [ ] A rollback procedure restores the previous path-based configuration.
- [ ] A normal-use soak period is completed before migrated source copies are removed from dotagents.
- [ ] After soak, dotagents contains package-selection policy rather than duplicate live Pi extension implementations.

## Affected Files

- `scripts/bootstrap.clj` — package-set reconciliation and obsolete-path removal.
- `test/unit/bootstrap_pure_test.clj` — pure planning/merge coverage.
- `test/e2e/cases.edn` — isolated bootstrap state assertions.
- `README.md` and `pi/README.md` — canonical installation and ownership model.
- `pi/extensions`, `pi/themes`, `pi/prompts` — migrated copies removed only after soak.

## Notes

The cutover must be reversible and preserve unrelated settings. Do not publish to npm as part of
this item; local paths and pinned Git sources are the initial supported distribution methods.
