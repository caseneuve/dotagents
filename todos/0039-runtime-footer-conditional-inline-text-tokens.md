---
title: runtime footer conditional inline text tokens
status: in_progress
priority: medium
type: feature
labels: []
created: 2026-05-19
parent: null
blocked-by: []
blocks: []
---

## Context

`runtime-footer` supports inline text blocks (`T:` / `text:`) and explicit separators (`sep`/`S`), but it cannot conditionally render glue text based on neighboring block presence. This makes it hard to express compact layouts like "show prefix only if a previous field exists" or "show suffix only if a next field exists" without duplicating tokens.

## Acceptance Criteria

- [ ] Add conditional inline text DSL for `?T:` / `?text:` (render only when a previous non-separator token in the same side renders non-empty) and `!T:` / `!text:` (render only when a next non-separator token in the same side renders non-empty).
- [ ] Separator tokens are ignored for look-behind/look-ahead checks; whitespace-only inline payloads are treated as empty and never rendered.
- [ ] Runtime footer config docs comment includes examples of the conditional inline text syntax.

## Affected Files

- `pi/extensions/runtime-footer.ts` — token parsing, conditional rendering, and config help text updates.

## E2E Spec

GIVEN footer config side tokens including optional fields and conditional inline text markers
WHEN neighboring renderable blocks become empty or non-empty
THEN `?T:` and `!T:` tokens appear only when their respective previous/next non-separator neighbors render non-empty text.

## Notes

- Keep scope to inline text tokens only (YAGNI for conditional behavior on non-text tokens).
- Preserve existing separator mode behavior and spacing-managed alias behavior.
