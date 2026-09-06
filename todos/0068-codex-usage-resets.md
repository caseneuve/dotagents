---
title: Show Codex usage limit reset credits in /usage
status: done
priority: medium
type: feature
labels: []
created: 2026-09-06
parent: null
blocked-by: []
blocks: []
---

## Context

Codex reports available usage limit resets, but Pi's /usage overlay ignores them.
The existing read-only wham/usage response includes rate_limit_reset_credits:
available_count is the total; applicable_available_count is separate. A live
response reported 3 available and 0 applicable.

## Acceptance Criteria

- [x] Show available reset credits, including zero, separately from timed windows and add-on credits.
- [x] Show currently applicable credits when reported; never substitute them for the total.
- [x] Missing or malformed reset data does not break existing usage cards or invent a zero.
- [x] Opening and refreshing /usage remain read-only; tests cover the canonical command/render path.
- [x] Update Pi usage documentation and pass focused tests and extension type-checking.

## Affected Files

- `pi/extensions/usage.ts` — response normalization and reset card.
- `test/pi/usage.test.ts` — pure normalization and mocked command/render coverage.
- `pi/README.md` — document reset counts and read-only behavior.

## E2E Spec

GIVEN a mocked wham/usage response with 3 available reset credits and 0 applicable
WHEN the registered /usage command opens its overlay
THEN it renders a Usage limit resets card with 3 available and Currently applicable: 0
AND r refresh updates the count without making any mutating API request.

## Notes

Do not consume resets or add a reset action. Keep existing untracked usage/format.ts
and usage-format.test.ts work untouched. The installed usage.ts is a symlink to
this checkout. Agent-channel tools are unavailable in this session; request an
independent CLI-agent review instead, and do not merge without human approval.

## Verification

- RED: registered-command test rendered existing cards but no reset card; pure
  normalization tests also failed before implementation (`ac217a4`).
- GREEN: `bun test test/pi/usage.test.ts test/pi/usage-format.test.ts` — 37 pass,
  including 28 new tests. `bb check:pi-extensions` and focused Prettier checks pass.
- Broader `bun test test/pi` — 57 pass; Playwright tests cannot load their
  pre-existing missing `@sinclair/typebox` dependency. No unrelated dependency
  changes made.
- Live GET through the installed usage.ts symlink and production normalizer
  rendered `3 available` / `Currently applicable: 0`. No reset consumed.
- Independent CLI Pi reviewer approved `a300f0c..f50bd38`, reran all 28 new tests
  and the type-check, and traced command → fetch → normalize → render/refresh.
- Left on `0068-codex-usage-resets`, not merged or pushed. `/reload` loads the
  updated installed symlink.
