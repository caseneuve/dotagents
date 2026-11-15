---
title: automate Playwright browser installation and broader package CI
status: closed
priority: low
type: chore
labels: [pi, playwright, follow-up]
created: 2026-07-10
parent: null
blocked-by: [0027.6]
blocks: []
---


## Closed: approved archive/superseded scope (2026-11-15)

This planned work on the Playwright extension is intentionally not completed or
newly validated by the migration. Approved archive disposition cancels this
remaining implementation/validation plan; closure is NOT a claim that its
features shipped, defects were fixed, or acceptance criteria passed.

Sources, referenced history and scoped unfinished artifacts are preserved.
Evidence: `~/.cache/pi-migration/status.md`,
`evidence/archive-lead-verification.md` and
`archives/retired-experiments-20261115T130304Z/REPORT.md` under the same migration
root. Archive-copy verification is not physical retirement, completed soak or
permission to remove old worktrees. Broader adoption/removal remains #0046/#0047.

## Historical uncompleted plan and criteria (retained unchecked)

## Context

Move-only extraction preserves the current Playwright dependency/lockfile and manual Chromium
installation instructions. A later improvement can make browser binary/version ownership and clean
CI verification more automatic and reproducible.

No existing todo covers Playwright browser lifecycle automation for the extracted package.

## Acceptance Criteria

- [ ] Define ownership and compatibility policy for Playwright library, lockfile, and browser binary versions.
- [ ] Decide whether installation remains explicit or gains a safe package command/script without surprising lifecycle downloads.
- [ ] Add clean-environment CI/smoke coverage for dependency install, browser availability, policy enforcement, and shutdown cleanup.
- [ ] Document cache/storage, update, offline, and failure-recovery behavior on Linux and macOS.

## Notes

Do not block `0027.6` on this automation.
