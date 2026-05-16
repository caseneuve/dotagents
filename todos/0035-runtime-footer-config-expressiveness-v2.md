---
title: runtime footer config expressiveness v2
status: done
priority: medium
type: feature
labels: []
created: 2026-05-16
parent: null
blocked-by: []
blocks: [0036, 0037, 0038]
---

## Context

Runtime footer config has become more capable, but users now need finer control over formatting and layout without patching code.

This parent item tracks a small batch of configuration expressiveness improvements requested together:
- selective truncation by block id
- explicit separator placement via a separator pseudo-block
- inline literal text blocks via `text:<payload>`

## Acceptance Criteria

- [ ] Child todo `#0036` (selective truncation blocks) is implemented and documented.
- [ ] Child todo `#0037` (explicit separator block) is implemented and documented.
- [ ] Child todo `#0038` (inline text block) is implemented and documented.
- [ ] README and config docs remain consistent with final behavior.
- [ ] Parent is closed only after all children are done.

## Affected Files

- `pi/extensions/runtime-footer.ts` — config parsing and render behavior changes (through child items).
- `pi/README.md` — runtime-footer config docs for new options.
- `todos/0036-*.md`, `todos/0037-*.md`, `todos/0038-*.md` — implementation split.

## E2E Spec

GIVEN all three child items are completed
WHEN users configure selective truncation, explicit separators, and inline text blocks together
THEN runtime-footer renders predictably, with docs matching behavior.

## Notes

This is a planning/coordination parent and should not accumulate unrelated implementation scope.
