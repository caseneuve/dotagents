---
title: automate Playwright browser installation and broader package CI
status: open
priority: low
type: chore
labels: [pi, playwright, follow-up]
created: 2026-07-10
parent: null
blocked-by: [0027.6]
blocks: []
---

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
