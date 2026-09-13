---
title: Keep the usage overlay background white between cards
status: done
priority: medium
type: bug
labels: []
created: 2026-09-06
parent: null
blocked-by: []
blocks: []
---

## Context

The screenshot after #0068 shows black gutters, empty card slots, and padding
under shorter cards. Nested card background resets restore the terminal default
inside the outer white frame. Pi's truncation helper also emits full SGR resets.

## Acceptance Criteria

- [x] Apply the overlay background once, after composing and truncating each row.
- [x] Gutters, unequal-height columns, empty card slots, and truncation padding stay white.
- [x] Preserve foreground styling, layout, reset counts, and read-only fetch/refresh.
- [x] Verify the registered command with styled ANSI output at narrow and wide widths.

## Affected Files

- `pi/extensions/usage.ts` — background composition.
- `test/pi/usage.test.ts` — terminal background assertions through /usage.
- `pi/README.md` — document continuous white overlay background.

## E2E Spec

GIVEN a dark terminal, three ChatGPT cards, and an OpenRouter error with wrapped text
WHEN /usage renders in two columns
THEN all visible cells inside the overlay, including blank padding, have a white background
AND each row restores the terminal background only after its final cell.

## Notes

Based on the unmerged #0068 branch so reset-credit support remains installed.
Do not merge or push without human approval. Keep pre-existing untracked formatting
work untouched. Agent-channel tools are unavailable; use independent CLI review.

## Verification

- RED: all four parameterized rendering scenarios failed on non-white terminal
  cells before implementation; 27 normalization tests still passed.
- GREEN: all 31 usage tests pass. Render coverage includes even/odd card counts,
  unequal heights, a wrapped OpenRouter error, a truncated account label, and
  widths 80, 91, 120, 180, and 240. Loading and refresh are checked too.
- Selected Pi regression suite: 60 pass across 8 files. Playwright remains excluded
  because of its previously observed missing `@sinclair/typebox` dependency.
- `bb check:pi-extensions`, focused Prettier, and `git diff --check` pass.
- Independent CLI reviewer approved `5916d2f`, traced the real render path, and
  independently reran all 31 usage tests and extension type-checking.
- Not merged or pushed. `/reload` picks up the installed usage.ts symlink.
