---
title: runtime footer selective truncation blocks
status: open
priority: medium
type: feature
labels: []
created: 2026-05-16
parent: 0035
blocked-by: []
blocks: []
---

## Context

`runtime-footer` currently supports one global `truncate` width, applied to every block when enabled. Users want to target truncation to specific blocks (for example `cwd` and `model`) while leaving other blocks untruncated.

## Acceptance Criteria

- [ ] Add config support for a truncation target list (proposed: `truncateBlocks`).
- [ ] Backward compatibility: when truncation target list is absent/empty, existing behavior remains (truncate all blocks when `truncate` is set).
- [ ] When truncation target list is present, truncation applies only to listed block ids.
- [ ] Matching semantics are explicit:
  - [ ] `git` in `truncateBlocks` applies to both `git-branch` and `git-diff`.
  - [ ] `sep`/`S` separator pseudo-blocks are never truncation-eligible.
  - [ ] `text:*` inline text blocks are truncation-eligible only when explicitly listed by exact block token.
- [ ] Unknown/invalid ids in truncation target list are ignored safely.
- [ ] README config docs include the new option and behavior.

## Affected Files

- `pi/extensions/runtime-footer.ts` — config parsing and conditional truncation application.
- `pi/README.md` — document targeted truncation config.

## E2E Spec

GIVEN runtime-footer config has `truncate: 12` and no truncation target list
WHEN footer renders
THEN all blocks remain eligible for truncation (current behavior).

GIVEN runtime-footer config has `truncate: 12` and `truncateBlocks: ["cwd", "model"]`
WHEN footer renders
THEN only `cwd` and `model` are truncated, while other blocks render at full width.

## Notes

Keep implementation minimal and avoid changing existing truncation glyph/style semantics.

Shared touchpoints: this item intersects with token parsing introduced/extended by `#0037` and `#0038`; implement against the final token model to avoid churn.
