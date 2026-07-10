---
title: reorganize Pi extensions into installable packages
status: open
priority: high
type: epic
labels: [pi, packaging, extraction]
created: 2026-05-12
parent: null
blocked-by: []
blocks: []
---

## Context

Reorganize the existing dotagents Pi extensions and resources into seven public repositories owned
by `caseneuve`, with one repository per logical package under `~/git/pi/`:

1. `caseneuve/pi-agent-channel`
2. `caseneuve/pi-playwright`
3. `caseneuve/pi-runtime-ui`
4. `caseneuve/pi-conversation-tools`
5. `caseneuve/pi-workbench`
6. `caseneuve/pi-provider-extras`
7. `caseneuve/pi-dotagents-resources`

This epic is a move-only reorganization. Preserve existing behavior, commands, tools, shortcuts,
configuration, platform support, and tests. Changes are limited to mechanical necessities such as
paths/imports, explicit Pi manifests, dependency metadata, moving tests/docs, and compatibility
fixes required by the currently supported Earendil Pi API (`@earendil-works/*`).

Do not redesign or improve extensions during extraction. Record discovered improvements as
follow-up todos. Initial installation is by local path and immutable Pi-supported Git ref; npm
publication is follow-up `0051`.

## Acceptance Criteria

- [ ] The seven public `github.com/caseneuve/pi-*` repositories exist and are installable by local path and Git.
- [ ] Each repository uses explicit Pi manifest entries so package membership is intentional and each included resource remains filterable through Pi's documented package filtering/config mechanism.
- [ ] Existing extension behavior, resource names/paths exposed by the package, commands, tools, shortcuts, settings, and platform limitations are preserved.
- [ ] Existing tests and relevant documentation move with their canonical implementation and pass using documented commands.
- [ ] Package runtime imports are compatible with the currently supported `@earendil-works/*` Pi API.
- [ ] No redesign, feature work, platform expansion, or daemon hardening is required to close the extraction tasks.
- [ ] The complete extracted package set passes isolated installation and composition validation in `0027.9`.
- [ ] Tree-sitter remains dormant and is not packaged or installed by this epic.
- [ ] Epic `0027` can close after `0027.9`; dotagents adoption and source retirement remain downstream top-level work.

## Sub-tasks

- `0027.1`: move agent-channel suite
- `0027.2`: move conversation-tools package
- `0027.3`: move workbench package
- `0027.4`: move runtime-ui package
- `0027.5`: define minimal package conventions/checklist
- `0027.6`: move Playwright package
- `0027.7`: move provider-extras package
- `0027.8`: move dotagents-resources package
- `0027.9`: validate the extracted package set

Shared conventions: [`docs/pi-package-conventions.md`](../docs/pi-package-conventions.md) (defined by `0027.5`).

## Follow-ups (out of scope)

- `0048`: redesign runtime UI around a plugin/provider architecture
- `0049`: harden agent-channel relay daemon operations
- `0050`: add a cross-platform screenshot picker
- `0051`: publish packages to npm
- `0052`: automate Playwright browser installation and broader CI

## Affected Files

- `todos/0027*.md` — epic and extraction subtasks.
- New public repositories under `github.com/caseneuve/` and local checkouts under `~/git/pi/`.
- `pi/*` — temporary source baseline retained through cutover and soak.

## Notes

- Installation policy remains in `0026`.
- Bootstrap cutover remains in `0046`.
- Dormant source retirement remains in `0047`.
- The repositories consume Earendil Pi APIs but are not owned by the `earendil-works` organization.
- Emacs bridge already lives separately and is out of scope.
