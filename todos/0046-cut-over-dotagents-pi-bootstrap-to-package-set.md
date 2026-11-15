---
title: adopt native Pi independent resources and extracted packages
status: open
priority: high
type: chore
labels: [pi, packaging, bootstrap]
created: 2026-07-10
parent: null
blocked-by: [0026, 0027.9]
blocks: [0047]
---

## Current policy and tranche boundary (2026-11-15)

The former custom Pi bootstrap/settings-reconciliation plan below is superseded:
there is NO Pi bootstrap or replacement custom installer. #0046.1 removes Pi
actions (including implicit default/all writes) and exposes independent skills
and prompts via the root native manifest in a dedicated worktree.
Use native `pi install [-l] <path>` only.

Live adoption into the active checkout and user settings requires later explicit
live-setup approval; #0046 stays open until that integration and package-selection
verification is authorized and complete. Do not clean up broad user loaders,
set themes, remove workbench copies, or start soak implicitly.

## Remaining adoption acceptance criteria

- [ ] Independently review #0046.1's exact SHA and isolated native handoff.
- [ ] Obtain explicit approval for active-root integration/live setup.
- [ ] Select native personal/project-local package declarations and remove duplicate
      broad loaders using the approved native workflow, preserving unrelated settings.
- [ ] Verify resource ownership, trust, filters, no duplicates and chosen theme.
- [ ] Record exact package refs, cutover date/platforms and explicit soak start.
- [ ] Retain all source/history until separately approved #0047 archive work.

## Historical proposal (superseded; do not execute)

## Context

Adopt the validated local package checkouts in dotagents bootstrap. This is an atomic settings
migration, not an extension redesign and not source retirement. Migrated sources remain dormant in
dotagents as rollback material until follow-up `0047` completes after explicit soak evidence.

Bootstrap owns settings reconciliation only. It does not clone, update, or otherwise manage the Git
lifecycle of `~/git/pi/*`. It verifies required local package paths and reports missing repositories
actionably. Portable project settings use immutable Git sources and Pi's normal trusted-project
missing-package installation.

## Acceptance Criteria

- [ ] Define the exact intended global package paths and selective/project-local package guidance from `0026`/`0027.9`.
- [ ] Bootstrap directly reconciles `settings.json` package entries idempotently; it does not invoke `pi install` and then also edit the same settings.
- [ ] Bootstrap verifies required `~/git/pi/*` paths and fails or warns with actionable clone/setup guidance; it never silently clones or updates them.
- [ ] Add validated package entries and remove the active broad dotagents extension/theme/prompt settings paths atomically, preserving unrelated settings and packages such as `pi-emacs-bridge`.
- [ ] Retain `pi/extensions`, `pi/themes`, and `pi/prompts` as dormant rollback sources; only `0047` may remove them.
- [ ] Verify selected theme and intended resources load without duplicates using the package refs/results approved in `0027.9`.
- [ ] Update bootstrap tests and docs for local defaults, portable Git project settings, ownership under `caseneuve`, and rollback to dormant paths.
- [ ] Record cutover date, tested machines/platforms, package refs, and the start of the soak evidence consumed by `0047`.

## Affected Files

- `scripts/bootstrap.clj`
- `test/unit/bootstrap_pure_test.clj`
- `test/e2e/cases.edn`
- `README.md` and `pi/README.md`
- Pi settings merge policy

## Notes

No npm publication or source deletion occurs here. Extension improvements remain separate follow-ups.
