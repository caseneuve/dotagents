---
title: pi extension package extraction v1 (new repos under ~/git/pi)
status: open
priority: high
type: epic
labels: [pi, packaging, extraction]
created: 2026-05-12
parent: null
blocked-by: []
blocks: [0027.1, 0027.2, 0027.3, 0027.4, 0027.5, 0027.6, 0027.7, 0027.8, 0027.9, 0046]
---

## Context

Move dotagents Pi extensions and resources into independently installable logical package clusters,
with one repository per package under `~/git/pi/`. The initial distribution path is local package
installation for personal machines plus pinned Git installation for reproducible projects; npm is
a possible follow-up.

Agreed package map:

1. `pi-agent-channel`
2. `pi-playwright`
3. `pi-runtime-ui`
4. `pi-conversation-tools`
5. `pi-workbench`
6. `pi-provider-extras`
7. `pi-dotagents-resources`

Constraints:

- use `@earendil-works/*` dependencies and current Pi package conventions
- declare resources explicitly in each Pi manifest
- preserve independent resource filtering inside logical multi-extension packages
- support Linux and macOS for relevant workbench/editor utilities
- keep Tree-sitter dormant and outside stable package manifests
- keep canonical implementations in package repositories after cutover, not duplicated in dotagents

## Acceptance Criteria

- [ ] The seven-repository target map under `~/git/pi/` is implemented and documented.
- [ ] A shared package convention covers manifests, dependencies, tests, platform support, local/Git installation, and experimental lifecycle.
- [ ] `agent-channel` extraction includes the bundled `agent-comms` skill and detached relay operations model.
- [ ] Conversation tools preserve assistant outline, last-assistant-block, bookmarks, and session notes as independently filterable resources.
- [ ] Workbench preserves diff-review aliases plus repo todos, agent journal, cwd editor, and screenshot attachment as independently filterable resources.
- [ ] Runtime UI provides one footer owner and one editor-component owner with optional cross-package integrations.
- [ ] Playwright is installable independently with reproducible runtime dependencies and restrictive policy defaults.
- [ ] Provider extras and themes/prompts are independently installable packages.
- [ ] The complete package set passes isolated local/Git install and composition validation before cutover.
- [ ] Tree-sitter remains explicitly experimental/dormant and is not installed by this epic.

## Sub-tasks

- `0027.1`: extract agent-channel suite
- `0027.2`: extract conversation-tools package
- `0027.3`: extract workbench package
- `0027.4`: extract/rewrite runtime-ui package
- `0027.5`: define package conventions and repository template
- `0027.6`: extract Playwright package
- `0027.7`: extract provider-extras package
- `0027.8`: extract dotagents-resources package
- `0027.9`: validate the extracted package set

## Affected Files

- `todos/0027*.md` — epic and sub-task tracking.
- New repositories under `~/git/pi/` — canonical implementations.
- `pi/*` — current behavior baseline and temporary migration sources until todo `0046` completes.

## Notes

- Install-strategy policy remains in todo `0026`.
- Actual dotagents bootstrap/settings cutover remains in todo `0046`.
- Emacs bridge already lives in `~/git/pi/pi-emacs-bridge` and is out of scope.
- One repository per package is intentional: Pi's Git installer is repository-root oriented, making
  this cleaner than a multi-package monorepo for local/Git-first distribution.
